# ECS/CDK Best Practices Remediation Plan

## Scope

Project reviewed: `ecs-cdk`

Tools used:
- `mcp__aws_ecs.aws_knowledge_aws___search_documentation`
- `mcp__aws_ecs.aws_knowledge_aws___read_documentation`
- `mcp__aws_iac.cdk_best_practices`
- Local checks: `npm run build`, `npm test`, `npx cdk synth --context env=prod`

Reference material checked:
- Amazon ECS container image best practices
- Amazon ECS task and container security best practices
- AWS Security Blog: security considerations for running containers on Amazon ECS
- AWS CDK best practices

Current verification status:
- `npm run build`: passed
- `npm test`: passed, but the test is currently a placeholder and does not validate infrastructure behavior
- `npx cdk synth --context env=prod`: passed with CDK warning for ECS `minHealthyPercent`

## Priority 0 - Fix Before Deployment

### 1. Container health check depends on missing `curl`

Evidence:
- `lib/ecs-cdk-stack.ts` defines the ECS container health check as:
  `curl -f http://localhost:${containerPort}/health || exit 1`
- `Dockerfile` uses `node:20-alpine` and does not install `curl`.
- ECS health check commands run inside the container image, so the command must exist in the image.

Risk:
- Tasks can become `UNHEALTHY` even when the Node.js app is running.
- A deployment can roll back or loop task replacements.

Recommended solution:
- Prefer a Node-based health check so no extra binary is needed:

```ts
healthCheck: {
  command: [
    'CMD-SHELL',
    `node -e "require('http').get('http://127.0.0.1:${containerPort}/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"`,
  ],
  interval: cdk.Duration.seconds(30),
  timeout: cdk.Duration.seconds(5),
  retries: 3,
  startPeriod: cdk.Duration.seconds(60),
}
```

Alternative:
- Install `curl` in the runtime image with `apk add --no-cache curl`, but this increases image surface area and conflicts with the ECS security guidance to keep images minimal.

Verification:
- Build the Docker image.
- Run the container locally and execute the health command inside it.
- Run `npx cdk synth --context env=prod` and confirm the task definition contains the updated command.

### 2. Production can deploy public HTTP without TLS

Evidence:
- `lib/ecs-cdk-stack.ts` falls back to `ApplicationProtocol.HTTP` when `certificateArn` is absent.
- Synthesized prod template contains an HTTP listener on port 80.

Risk:
- Public production traffic can be served without encryption.
- This conflicts with ECS security guidance to use TLS/SSL for public-facing load balancers.

Recommended solution:
- Fail synthesis for `prod` if `certificateArn` is missing.
- Configure HTTPS listener when certificate is present.
- Add HTTP to HTTPS redirect if HTTP remains open.

Implementation direction:

```ts
if (props.envName === 'prod' && !props.certificateArn) {
  throw new Error('certificateArn is required for prod deployments');
}
```

Verification:
- `npx cdk synth --context env=prod` should fail without `certificateArn`.
- `npx cdk synth --context env=prod --context certificateArn=...` should synthesize HTTPS resources.

### 3. ECS tasks are launched in public subnets with public IPs

Evidence:
- `lib/ecs-cdk-stack.ts` sets `assignPublicIp: true`.
- Synthesized template has `AssignPublicIp: ENABLED` and service subnets are public.

Risk:
- Application tasks have direct public network exposure even though traffic should enter through the ALB.
- This weakens network segmentation and increases attack surface.

Recommended solution:
- Run Fargate tasks in private subnets:

```ts
assignPublicIp: false,
taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
```

- Keep only the ALB public.
- Ensure service security group accepts inbound traffic only from the ALB security group.

Verification:
- Synthesized ECS service should have `AssignPublicIp: DISABLED`.
- ECS service subnet list should reference private subnets.

## Priority 1 - Security And Release Correctness

### 4. Mutable `latest` image tag is still a deployment path

Evidence:
- `bin/ecs-cdk.ts` defaults `imageTag` to `latest`.
- `.github/workflows/deploy.yml` pushes both `${{ github.sha }}` and `latest`.
- ECR repository does not enable immutable tags.

Risk:
- A tag can point to a different image later.
- Rollbacks, audits, and incident analysis become ambiguous.
- ECS has software version consistency, but AWS still recommends unique tags and immutable ECR tags.

Recommended solution:
- Remove `latest` as the default for non-dev environments.
- Require `imageTag` for staging/prod.
- Enable ECR immutable tags.
- Push only git SHA tags for deployable releases.

Implementation direction:

```ts
imageTagMutability: ecr.TagMutability.IMMUTABLE,
```

```ts
if (envName !== 'dev' && !app.node.tryGetContext('imageTag')) {
  throw new Error('imageTag is required for staging and prod');
}
```

Verification:
- Synthesized ECR repository should include immutable tag configuration.
- CI should deploy only the git SHA tag.

### 5. ECS rolling deployment can reduce healthy capacity

Evidence:
- CDK synth emits warning `@aws-cdk/aws-ecs:minHealthyPercent`.
- Synthesized ECS service has `MinimumHealthyPercent: 50`.

Risk:
- During deployment, running tasks can drop below desired count.
- For Fargate services behind an ALB, this is usually unnecessary and can reduce availability.

Recommended solution:
- Explicitly configure deployment settings:

```ts
minHealthyPercent: 100,
maxHealthyPercent: 200,
```

Verification:
- `npx cdk synth --context env=prod` should no longer emit the warning.
- Synthesized service should show `MinimumHealthyPercent: 100`.

### 6. GitHub Actions deploy path is probably wrong

Evidence:
- Workflow is located under `ecs-cdk/.github/workflows/deploy.yml`.
- The repo root appears to be `ecs-cdk`.
- Deploy step runs `cd ecs-cdk`, which would look for a nested `ecs-cdk/ecs-cdk` directory.

Risk:
- CI deployment fails before CDK commands run.

Recommended solution:
- Remove `cd ecs-cdk` from the deploy step.
- Add a build/test/synth gate before deployment:

```yaml
run: |
  npm ci
  npm run build
  npm test
  npx cdk synth --context env=dev --context imageTag=${{ github.sha }}
  npx cdk deploy --context env=dev --context imageTag=${{ github.sha }} --require-approval never
```

Verification:
- Run the workflow or reproduce locally from the repository root.

### 7. CI uses long-lived AWS access keys

Evidence:
- Workflow uses `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

Risk:
- Long-lived credentials increase blast radius if GitHub secrets are exposed.

Recommended solution:
- Use GitHub OIDC with `role-to-assume`.
- Scope the deployment role to the least privileges needed for CDK deploy and ECR push.

Verification:
- Workflow no longer references static AWS key secrets.
- AWS CloudTrail shows `AssumeRoleWithWebIdentity`.

## Priority 2 - Runtime Hardening

### 8. App does not handle `SIGTERM` gracefully

Evidence:
- `app/src/index.js` starts Express but does not handle shutdown signals.
- ECS sends `SIGTERM` before `SIGKILL` when stopping a task.

Risk:
- In-flight requests can be dropped during deployments or scale-in.

Recommended solution:
- Store the server returned by `app.listen`.
- On `SIGTERM`, stop accepting new requests and close the server.

Implementation direction:

```js
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
```

Verification:
- Run the app locally, send `SIGTERM`, and confirm it exits cleanly.

### 9. Container root filesystem is writable

Evidence:
- Task container does not set `readonlyRootFilesystem`.

Risk:
- A compromised process has more room to modify the container filesystem.

Recommended solution:
- Enable read-only root filesystem if the application does not need writes:

```ts
readonlyRootFilesystem: true,
```

- If temporary writes are required, add an explicit writable volume or use `/tmp` only if supported by the runtime design.

Verification:
- App starts and health checks pass with read-only root enabled.

### 10. No explicit CloudWatch log retention

Evidence:
- `awsLogs` creates a log group without retention settings.
- Synthesized log group has no `RetentionInDays`.
- CDK best practices recommend defining log retention explicitly.

Risk:
- Logs are retained indefinitely, increasing cost and data exposure.

Recommended solution:
- Create an explicit `logs.LogGroup` with retention and removal policy per environment.
- Pass it to `ecs.LogDrivers.awsLogs`.

Implementation direction:

```ts
const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
  retention: props.envName === 'prod'
    ? logs.RetentionDays.ONE_MONTH
    : logs.RetentionDays.ONE_WEEK,
  removalPolicy: props.envName === 'prod'
    ? cdk.RemovalPolicy.RETAIN
    : cdk.RemovalPolicy.DESTROY,
});
```

Verification:
- Synthesized log group includes `RetentionInDays`.

### 11. No VPC Flow Logs

Evidence:
- VPC is created without flow logs.
- ECS security guidance recommends VPC Flow Logs for traffic analysis to and from long-running tasks.

Risk:
- Network investigations are harder.
- GuardDuty and incident response have less network telemetry.

Recommended solution:
- Enable VPC Flow Logs, at least for staging/prod.
- Set retention on the flow log group.

Verification:
- Synthesized template includes `AWS::EC2::FlowLog`.

### 12. ALB deletion protection is disabled in prod

Evidence:
- Synthesized prod template has `deletion_protection.enabled` set to `false`.

Risk:
- Accidental deletion of the public entry point is easier.

Recommended solution:
- Enable deletion protection for prod:

```ts
this.service.loadBalancer.setAttribute('deletion_protection.enabled', 'true');
```

Verification:
- Synthesized prod ALB has deletion protection enabled.

## Priority 3 - CDK Maintainability

### 13. Physical names reduce deployment flexibility

Evidence:
- ECR repository name is hardcoded as `ecs-app-${props.envName}`.
- Secret name is hardcoded as `${props.envName}/${props.secrets.secretName}`.

Risk:
- Multiple stacks for the same environment in one account/region can conflict.
- Replacement and blue/green infrastructure experiments are harder.

Recommended solution:
- Let CDK generate physical names where practical.
- If stable names are required for CI/CD, export outputs and consume them in the pipeline.
- For secrets, consider importing existing secrets by name for production instead of creating placeholder secrets in the app stack.

Verification:
- Repeated deployments with different stack IDs do not hit name collisions.

### 14. Production secret is created with a placeholder value and delete policy

Evidence:
- `secretsmanager.Secret` is created with a generated `placeholder`.
- Synthesized prod secret has `DeletionPolicy: Delete`.

Risk:
- Production secret lifecycle is tied to the stateless service stack.
- Accidental stack deletion can delete secret material.
- Placeholder generation may not match how real application secrets should be managed.

Recommended solution:
- For prod, import an existing secret:

```ts
secretsmanager.Secret.fromSecretNameV2(this, 'AppSecret', 'prod/app-secrets')
```

- If the stack must create it, use `RemovalPolicy.RETAIN`.

Verification:
- Synthesized prod secret is not deleted with the service stack, or no prod secret resource is created because it is imported.

### 15. Infrastructure test is a placeholder

Evidence:
- `test/ecs-cdk.test.ts` contains an empty SQS example test.

Risk:
- Regressions in ECS configuration will not be caught before deployment.

Recommended solution:
- Replace placeholder with assertions for:
  - ECS service uses Fargate.
  - Tasks run without public IP.
  - Deployment circuit breaker is enabled.
  - `MinimumHealthyPercent` is 100.
  - Log group has retention.
  - ECR tag immutability and scan-on-push are enabled.
  - Prod requires TLS.

Verification:
- `npm test` fails if any of the expected best-practice properties regress.

## Suggested Implementation Order

1. Fix the health check command.
2. Move tasks to private subnets and disable public task IPs.
3. Enforce TLS for prod.
4. Remove mutable `latest` from staging/prod and enable ECR tag immutability.
5. Set ECS deployment percentages explicitly.
6. Fix GitHub Actions path and add build/test/synth gate.
7. Add graceful shutdown to the app.
8. Add log retention, VPC Flow Logs, and prod ALB deletion protection.
9. Rework production secret lifecycle.
10. Replace placeholder tests with real CDK assertions.

## Final Verification Checklist

- `npm run build`
- `npm test`
- `npx cdk synth --context env=dev --context imageTag=test-sha`
- `npx cdk synth --context env=prod --context imageTag=test-sha --context certificateArn=<valid-acm-arn>`
- Confirm prod synth fails when `certificateArn` is omitted.
- Confirm no CDK warning for ECS `minHealthyPercent`.
- Confirm synthesized prod ECS service has `AssignPublicIp: DISABLED`.
- Confirm synthesized prod listener uses HTTPS or redirects HTTP to HTTPS.
- Confirm synthesized ECR repository has immutable image tags.
- Confirm app container health check does not depend on missing binaries.

