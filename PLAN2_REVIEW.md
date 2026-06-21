# Review of PLAN2.txt Against PLAN.md

## Short Answer

`PLAN2.txt` is partially актуален, but it is not fully reliable for the current project state.
Most important valid points from `PLAN2.txt` are already covered in `PLAN.md`.

The main exception: `PLAN2.txt` includes a cost optimization recommendation for dev NAT Gateway strategy. This is valid enough to consider, but it is not explicitly included in `PLAN.md`.

There are also several inaccurate or outdated statements in `PLAN2.txt`; these should not be copied into the remediation plan without correction.

## Covered In PLAN.md

The following `PLAN2.txt` points are relevant and already covered:

- `assignPublicIp: true` is a production security issue.
  Covered in `PLAN.md`: "ECS tasks are launched in public subnets with public IPs".

- `publicLoadBalancer: true` is acceptable only if tasks remain private.
  Covered in `PLAN.md`: keep ALB public, move ECS tasks to private subnets.

- Secrets are created by CDK with placeholder values.
  Covered in `PLAN.md`: "Production secret is created with a placeholder value and delete policy".

- CloudWatch log group is not controlled explicitly.
  Covered in `PLAN.md`: "No explicit CloudWatch log retention".

- Security group hardening should ensure ALB -> ECS only.
  Covered in `PLAN.md`: private task placement and ALB-only ingress are called out.

- HTTPS redirect / TLS enforcement is missing.
  Covered in `PLAN.md`: "Production can deploy public HTTP without TLS".

- CI/CD needs correction.
  Covered in `PLAN.md`: workflow path is likely wrong, build/test/synth gate is missing, and long-lived AWS keys should be replaced with OIDC.

## Valid But Not Explicitly Covered In PLAN.md

### Dev NAT Gateway cost optimization

`PLAN2.txt` says `natGateways: 1` in dev can cost money even with low traffic, and suggests `natGateways: 0` for dev.

This is актуально as a cost optimization, but the exact recommendation needs nuance:

- If dev ECS tasks are moved to private subnets, they need outbound access for ECR image pulls, CloudWatch logs, Secrets Manager, and package/runtime calls.
- That outbound access can come from NAT Gateway or from VPC endpoints where applicable.
- `natGateways: 0` plus public tasks is cheaper but conflicts with the security direction of moving tasks private.

Recommended addition to `PLAN.md`:

- Add a Priority 3 or cost section:
  - For dev, choose explicitly between low-cost public-task dev and production-like private-task dev.
  - Prefer private tasks for parity; reduce NAT cost with VPC endpoints for ECR, CloudWatch Logs, Secrets Manager, and S3 gateway endpoint where practical.
  - If cost matters more than parity in dev, document that `assignPublicIp: true` is dev-only and never allowed in staging/prod.

## Inaccurate Or Not Current In PLAN2.txt

### "CI/CD has no aws login, docker push step, cdk deploy step"

Not current.

The workflow does have:

- AWS credentials configuration
- ECR login
- Docker build
- Docker push
- CDK deploy

The real CI issue is different:

- The workflow is inside the `ecs-cdk` repository, but deploy step runs `cd ecs-cdk`, which likely points to a non-existent nested directory.
- It pushes `latest`, which should not be used for deployable releases.
- It uses long-lived AWS access keys instead of GitHub OIDC.
- It deploys without a build/test/synth gate.

These are covered correctly in `PLAN.md`.

### "Health check mismatch: ECS `/health`, Docker `/_status.json`"

Only partially relevant.

The project has two Dockerfiles:

- Root `Dockerfile`: `node:20-alpine`, used by CI because workflow runs `docker build ... .`.
- `app/Dockerfile`: `node:22-alpine`, has Docker `HEALTHCHECK` against `/_status.json`.

The active deployment path appears to use the root `Dockerfile`, not `app/Dockerfile`.
The actual critical issue is that ECS health check uses `curl`, while the root runtime image does not install `curl`.

This is covered in `PLAN.md`.

Optional follow-up:

- Decide whether `app/Dockerfile` is legacy/dead code or intended for a different app.
- If it is not used, remove it or document it.
- If it is intended, align endpoints and build context.

### "Docker: Node 22, CDK requires Node >=20"

Not accurate for the active deployment Dockerfile.

The root `Dockerfile` uses `node:20-alpine`.
`app/Dockerfile` uses `node:22-alpine`, but it does not appear to be used by the current CI/CD build.

No action is required unless `app/Dockerfile` becomes the intended deployment image.

### "Docker setup has healthcheck"

Not accurate for the active root Dockerfile.

The root `Dockerfile` has no Dockerfile-level `HEALTHCHECK`.
ECS defines the container health check in the task definition instead.
That is acceptable, but the current command must be fixed because it depends on missing `curl`.

### "This is already production-level architecture"

Directionally fair, but too generous.

The architecture has a good baseline: ECS Fargate, ALB, ECR, autoscaling, Secrets Manager, and multi-env config.
However, the current production readiness is blocked by:

- public task IPs
- possible HTTP-only prod deployment
- missing health check binary
- mutable image tags
- weak deployment healthy-percent default
- placeholder tests
- secret lifecycle concerns

`PLAN.md` treats these as concrete remediation items.

## Recommended Update To PLAN.md

Add one extra item for cost strategy:

```md
### Dev NAT Gateway cost strategy

Evidence:
- dev uses `natGateways: 1`.

Risk:
- NAT Gateway has a fixed monthly cost even for low-traffic dev environments.

Recommended solution:
- Decide per environment:
  - prod/staging: private ECS tasks with NAT or VPC endpoints.
  - dev: either private ECS tasks with VPC endpoints to reduce NAT dependency, or explicitly documented public-task low-cost mode that is forbidden outside dev.

Verification:
- Synthesized dev networking matches the chosen strategy.
- staging/prod always keep ECS tasks private.
```

## Conclusion

`PLAN.md` already covers the security and production-readiness findings from `PLAN2.txt` that matter most.

The only material missing item is the dev NAT Gateway cost strategy.
Several `PLAN2.txt` statements are stale or describe `app/Dockerfile` rather than the root Dockerfile used by the current workflow, so they should be treated as advisory notes, not as authoritative findings.

