# ECS Best Practices Review — TODO

> Review performed using AWS ECS Best Practices documentation, CDK Best Practices guide, and Fargate Security Best Practices.
> Date: 2026-06-21

---

## 1. Security

### 1.1 Container & Task Security

- [ ] **Use read-only root filesystem for containers**
  - The container in `ecs-cdk-stack.ts` (line 96-119) does not set `readonlyRootFilesystem: true`.
  - Add `readonlyRootFilesystem: true` to the container definition and mount a temporary volume for writable dirs if needed.

- [ ] **Run containers as non-root user**
  - ✅ Already done — `Dockerfile` line 19: `USER node`.
  - The CDK stack does not override this, so it passes.

- [ ] **Use distroless or scratch-based images**
  - ⚠️ Current Dockerfile uses `node:20-alpine` (minimal but not distroless).
  - Consider migrating to `gcr.io/distroless/nodejs` or a multi-stage build that copies only the runtime.

- [ ] **Remove unnecessary Linux capabilities**
  - Fargate containers already run with reduced capabilities by default. No action required, but verify no `linuxParameters` grant extra capabilities.

- [ ] **Scan application dependencies for vulnerabilities**
  - ✅ ECR `imageScanOnPush: true` is set (line 77).
  - ❌ No CI/CD pipeline or automated scanning for app-level dependencies (`npm audit`, Snyk, etc.) is configured in the project.

### 1.2 Network Security

- [ ] **Do NOT assign public IPs to Fargate tasks in production**
  - ⚠️ `assignPublicIp: true` is set on line 144 of `ecs-cdk-stack.ts`.
  - For production/staging, use private subnets with NAT Gateway (already configured) and set `assignPublicIp: false`.
  - Consider making this configurable per environment (dev can have public IPs for debugging).

- [ ] **Use `awsvpc` network mode with security groups**
  - ✅ Fargate uses `awsvpc` by default — no overlay network.
  - ⚠️ The `ApplicationLoadBalancedFargateService` pattern creates default security groups, but they are not customized.
  - Review and tighten security group ingress/egress rules (e.g., restrict inbound to ALB security group only).

- [ ] **Enable VPC Flow Logs**
  - ❌ Not configured. Add `flowLogs` to the VPC definition (line 69-72).
  - Required for network traffic auditing and troubleshooting.

- [ ] **Configure AWS WAF for the Application Load Balancer**
  - ❌ No WAF attached to the ALB.
  - Consider adding AWS WAF for protection against common web exploits (SQL injection, XSS, etc.).

- [ ] **Encrypt traffic end-to-end**
  - ✅ ALB supports HTTPS when `certificateArn` is provided.
  - ✅ ALB-to-task traffic can be unencrypted within VPC (acceptable for private subnet traffic).
  - ⚠️ Consider mutual TLS (mTLS) or end-to-end encryption for compliance-sensitive workloads.

### 1.3 Secrets & IAM

- [ ] **Use least-privilege IAM roles**
  - ✅ CDK auto-generates task execution role and task role with minimal permissions — no manual IAM policies.
  - ✅ `Secrets Manager` is used for sensitive data (lines 59-67, 104-111).
  - ⚠️ The default task role created by the pattern may have more permissions than needed — review and scope down.

- [ ] **Encrypt ECR images with customer managed KMS key**
  - ✅ Default encryption is enabled (AWS managed key).
  - ⚠️ Consider using a customer managed KMS key for regulatory compliance.

---

## 2. Monitoring & Observability

### 2.1 Logging & Metrics

- [ ] **Container Insights is enabled**
  - ✅ `containerInsightsV2: ecs.ContainerInsights.ENABLED` on line 88.

- [ ] **CloudWatch Logs for containers**
  - ✅ `awsLogs` driver configured with stream prefix `ecs` (line 100).

- [ ] **Create CloudWatch Dashboards for operational visibility**
  - ❌ No dashboards created in the stack.
  - Add custom dashboards showing CPU, memory, request count, target response time, and 5xx errors.

- [ ] **Configure detailed CloudWatch Alarms**
  - ✅ Auto-scaling alarms are configured (CPU, Memory, RequestCount — lines 152-167).
  - ❌ Missing alarms for: ALB 5xx errors, unhealthy hosts, high latency (p99 > threshold), service count deviation.

### 2.2 Runtime Monitoring

- [ ] **Enable GuardDuty Runtime Monitoring for Fargate**
  - ❌ Not configured in the stack.
  - GuardDuty Runtime Monitoring detects malicious or unauthorized behavior in Fargate workloads (file access, process execution, network connections).

---

## 3. High Availability & Resilience

### 3.1 Deployment Configuration

- [ ] **Circuit breaker with rollback**
  - ✅ `circuitBreaker: { rollback: true }` on line 142.

- [ ] **Health checks properly configured**
  - ✅ Container health check: `/health` endpoint with 30s interval, 5s timeout, 3 retries, 60s start period (lines 112-118).
  - ✅ ALB target group health check: `/health` with 30s interval, 2 healthy / 3 unhealthy thresholds (lines 169-174).
  - ✅ Deregistration delay set to 30s (lines 176-179).

- [ ] **Multi-AZ deployment**
  - ✅ Dev: 2 AZs, Staging: 2 AZs, Prod: 3 AZs.
  - ✅ NAT Gateways: Dev/Staging: 1 (single point of failure for outbound traffic), Prod: 2 (HA).

### 3.2 Auto Scaling

- [ ] **Multiple scaling policies configured**
  - ✅ CPU utilization scaling (target: 65-80% depending on environment).
  - ✅ Memory utilization scaling.
  - ✅ Request count per target scaling.
  - ✅ Cooldown values set to 60s (both scale-in and scale-out).

- [ ] **Scale-in / scale-out cooldowns**
  - ⚠️ Consider different scale-in vs scale-out cooldowns (e.g., scale-out: 60s, scale-in: 120-300s) to avoid flapping.

---

## 4. Infrastructure as Code Best Practices (CDK)

### 4.1 Code Organization

- [ ] **Separate stateful and stateless resources into different stacks**
  - ❌ The ECR repository (stateful) and the ECS service (stateless) are in the same stack.
  - Consider splitting into `EcrStack` (stateful, with `RemovalPolicy.RETAIN`) and `EcsStack` (stateless).

- [ ] **Use generated names, not physical names**
  - ⚠️ The ECR repository has a physical name `ecs-app-${envName}` (line 75). This prevents multiple stacks with the same env name from deploying in the same account.
  - ⚠️ The Secrets Manager secret has a physical name `${envName}/app-secrets` (line 60).
  - Consider letting CDK auto-generate names or use unique suffixes.

- [ ] **Commit `cdk.context.json`**
  - ❌ Not present in the project file listing. If VPC lookups or AZ lookups were performed, the context file should be committed.

### 4.2 Testing

- [ ] **Write infrastructure tests**
  - ❌ Tests in `ecs-cdk.test.ts` are completely commented out.
  - Add tests using `aws-cdk-lib/assertions` to verify:
    - Encryption is enabled
    - Security groups are properly configured
    - IAM roles follow least privilege
    - Correct CPU/memory combinations are used
    - Logical IDs of stateful resources remain stable

### 4.3 Compliance Validation

- [ ] **Consider using CDK Nag for compliance checks**
  - ❌ Not installed or configured.
  - Install `cdk-nag` and add `AwsSolutionsChecks` to the app for automated compliance validation (HIPAA, PCI-DSS, etc.).

---

## 5. Operational Excellence

### 5.1 ECR & Image Management

- [ ] **Immutable image tags**
  - ✅ Image tags are not explicitly configured as immutable, but the project uses a configurable `imageTag` param (default: `latest`).
  - ⚠️ Using `latest` is not recommended for production — always use specific tags (commit SHA, build number).

- [ ] **ECR Lifecycle rules**
  - ✅ Max 10 images retained (line 80-82).

### 5.2 Deployment Pipeline

- [ ] **No CI/CD pipeline defined in the project**
  - ❌ There is no CI/CD configuration in the repository.
  - Consider adding a pipeline (CodePipeline, GitHub Actions, etc.) with:
    - Automated build and push to ECR
    - Vulnerability scanning of images
    - Blue/green deployment with CodeDeploy
    - Automated rollback on health check failures

### 5.3 Configuration Management

- [ ] **Environment-specific configuration**
  - ✅ Three environments: dev, staging, prod (lines 9-61 in `bin/ecs-cdk.ts`).
  - ✅ Proper differentiation of resources per environment.

- [ ] **Make decisions at synthesis time, not deployment time**
  - ✅ No CloudFormation `Parameters` or `Conditions` used — all decisions in code.

---

## 6. Dockerfile Best Practices

### 6.1 Image Optimization

- [ ] **Multi-stage build**
  - ✅ Two-stage build: `builder` and final stage (lines 1-21).

- [ ] **Minimal base image**
  - ✅ `node:20-alpine` — minimal, but see note about distroless in §1.1.

- [ ] **No shell or package managers in final image**
  - ⚠️ Alpine images include `apk` and a shell. For production, consider distroless or scratch-based approach.

- [ ] **Dockerfile HEALTHCHECK instruction**
  - ❌ Not set in Dockerfile (health check is managed by ALB, but a `HEALTHCHECK` in the Dockerfile is also recommended for container-level checks).

---

## Summary of Priority Items

| Priority | Category | Issue |
|----------|----------|-------|
| 🔴 HIGH | Security | `assignPublicIp: true` exposes tasks with public IPs |
| 🔴 HIGH | IaC Testing | All unit tests are commented out |
| 🔴 HIGH | Security | Missing `readonlyRootFilesystem: true` for containers |
| 🟡 MEDIUM | Monitoring | No GuardDuty Runtime Monitoring |
| 🟡 MEDIUM | Monitoring | No CloudWatch Dashboards / detailed alarms |
| 🟡 MEDIUM | Network | No VPC Flow Logs |
| 🟡 MEDIUM | Security | Security groups not reviewed/customized |
| 🟡 MEDIUM | IaC | Stateful resources mixed with stateless in one stack |
| 🟢 LOW | Security | Consider distroless base image |
| 🟢 LOW | Operations | No CI/CD pipeline |
| 🟢 LOW | Operations | Consider CDK Nag for compliance validation |
| 🟢 LOW | CDK | Some resources use physical names |

---

*Review generated by AI using AWS ECS Best Practices documentation, CDK Best Practices guide, and Fargate Security Best Practices.*