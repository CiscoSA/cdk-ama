# ECS/CDK Best Practices — Анализ проекта

## Текущее состояние проекта

| Компонент | Статус |
|-----------|--------|
| VPC | OK — 2 AZ, NAT Gateway |
| ECS Cluster | OK — Container Insights включён |
| Fargate Service | OK — Circuit Breaker, ECS Exec |
| ALB | OK — Health Check на /health |
| Auto-scaling | OK — CPU, Memory, Requests |
| ECR | OK — removalPolicy: RETAIN |
| Secrets Manager | OK — импорт существующего |
| CI/CD | OK — GitHub Actions |

---

## Критические замечания (нужно исправить)

### 1. VPC Flow Logs отсутствуют

**Проблема:** Нет логирования сетевого трафика. При проблемах с сетью невозможно диагностировать.

**Исправление** (`lib/ecs-cdk-stack.ts`):

```typescript
const vpc = new ec2.Vpc(this, 'Vpc', {
  maxAzs,
  natGateways,
  flowLogs: {
    'FlowLog': {
      trafficType: ec2.FlowLogTrafficType.ALL,
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
    },
  },
});
```

### 2. ALB не имеет access logs

**Проблема:** Нет логирования запросов к ALB. Невозможно анализировать трафик и ошибки.

**Исправление** (`lib/ecs-cdk-stack.ts`):

```typescript
// После создания ALB
this.service.loadBalancer.logAccessLogs(
  new s3.Bucket(this, 'AlbLogsBucket', {
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  })
);
```

### 3. Нет CloudWatch Alarms

**Проблема:** Нет оповещений при проблемах с сервисом.

**Исправление** (`lib/ecs-cdk-stack.ts`):

```typescript
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';

// Alarm на 5xx ошибки
const alarm5xx = new cloudwatch.Alarm(this, 'Alarm5xx', {
  metric: this.service.loadBalancer.metrics.httpCodeTarget(
    elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
    { period: cdk.Duration.minutes(5) }
  ),
  threshold: 10,
  evaluationPeriods: 2,
  alarmDescription: '5xx errors detected',
});

// Alarm на unhealthy hosts
const alarmUnhealthy = new cloudwatch.Alarm(this, 'AlarmUnhealthy', {
  metric: this.service.targetGroup.metrics.unhealthyHostCount({
    period: cdk.Duration.minutes(5),
  }),
  threshold: 1,
  evaluationPeriods: 2,
  alarmDescription: 'Unhealthy targets detected',
});
```

### 4. Security Group слишком открыт

**Проблема:** Task Security Group разрешает весь исходящий трафик (0.0.0.0/0).

**Исправление** (`lib/ecs-cdk-stack.ts`):

```typescript
// Ограничить исходящий трафик только необходимыми портами
taskSecurityGroup.addEgressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(443),
  'Allow HTTPS outbound'
);
```

### 5. Log Group без retention

**Проблема:** Логи хранятся бесконечно — растут расходы.

**Исправление** (`lib/ecs-cdk-stack.ts`):

```typescript
const logGroup = new logs.LogGroup(this, 'TaskLogGroup', {
  retention: logs.RetentionDays.TWO_WEEKS,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const container = taskDefinition.addContainer('AppContainer', {
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'ecs',
    logGroup,
  }),
  // ...
});
```

### 6. Container Health Check отсутствует

**Проблема:** Удалён container health check (curl нет в Alpine). ECS не знает о здоровье контейнера на уровне задачи.

**Исправление** — добавить в Dockerfile:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
```

И вернуть в CDK стек:

```typescript
healthCheck: {
  command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1'],
  interval: cdk.Duration.seconds(30),
  timeout: cdk.Duration.seconds(5),
  retries: 3,
  startPeriod: cdk.Duration.seconds(60),
},
```

---

## Важные замечания (стоит улучшить)

### 7. account/region не захардкожены — хорошо, но...

**Текущий код:**
```typescript
env: {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
},
```

**Рекомендация:** Для staging/prod захардкодить или использовать context:

```typescript
env: {
  account: app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT,
  region: app.node.tryGetContext('region') || process.env.CDK_DEFAULT_REGION,
},
```

### 8. Нет termination protection на проде

**Рекомендация** (`bin/ecs-cdk.ts`):

```typescript
new EcsCdkStack(app, `EcsCdkStack-${envName}`, {
  // ...
  terminationProtection: envName === 'prod',
});
```

### 9. Auto-scaling cooldown слишком короткий

**Текущее:** 60 секунд. При резком скачке трафика будет频繁 scaling.

**Рекомендация:**

```typescript
scaling.scaleOnCpuUtilization('CpuScaling', {
  targetUtilizationPercent: cpuTargetUtilization,
  scaleInCooldown: cdk.Duration.seconds(300),   // 5 минут
  scaleOutCooldown: cdk.Duration.seconds(120),  // 2 минуты
});
```

### 10. Secrets keys разные для dev/staging/prod

**Проблема:** dev использует Sharetribe ключи, staging/prod — DATABASE_URL, API_KEY, Redis. Это может привести к ошибкам.

**Рекомендация:** Выровнять ключи или сделать универсальную структуру.

### 11. Нет WAF на ALB

**Рекомендация:** Добавить AWS WAF для защиты от атак:

```typescript
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

const webAcl = new wafv2.CfnWebACL(this, 'WebACL', {
  scope: 'REGIONAL',
  defaultAction: { allow: {} },
  rules: [
    {
      name: 'AWSManagedRulesCommonRuleSet',
      priority: 1,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      visibilityConfig: { /* ... */ },
    },
  ],
  visibilityConfig: { /* ... */ },
});

new wafv2.CfnWebACLAssociation(this, 'WebACLAssociation', {
  resourceArn: this.service.loadBalancer.loadBalancerArn,
  webAclArn: webAcl.attrArn,
});
```

---

## Dockerfile рекомендации

### 12. Multi-stage build для production

**Текущий:** Одноэтапная сборка.

**Рекомендация:**

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
CMD ["node", "src/index.js"]
```

### 13. .dockerignore отсутствует

Создать `app/.dockerignore`:

```
node_modules
npm-debug.log
.git
.env
.env.*
*.md
```

---

## Application рекомендации

### 14. Graceful shutdown

**Текущий:** Нет обработки сигналов.

**Исправление** (`app/src/index.js`):

```javascript
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down');
  server.close(() => process.exit(0));
});
```

### 15. Request logging

**Исправление** (`app/src/index.js`):

```javascript
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
  });
  next();
});
```

### 16. Error handling

**Исправление** (`app/src/index.js`):

```javascript
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});
```

---

## CI/CD рекомендации

### 17. Нет линтера/тестов в pipeline

**Текущий:** Только build и push.

**Рекомендация** (`.github/workflows/deploy.yml`):

```yaml
- name: Lint
  run: npm run lint

- name: Test
  run: npm test
```

### 18. Нет CDK diff перед деплоем

**Рекомендация:**

```yaml
- name: CDK Diff
  run: npx cdk diff --context env=dev

- name: Deploy
  run: npx cdk deploy --context env=dev --require-approval never
```

### 19. Image scanning

**Текущий:** ECR imageScanOnPush: true (при создании). При импорте — не настроить.

**Рекомендация:** Включить scanning через EventBridge:

```yaml
- name: Scan image
  run: |
    aws ecr start-image-scan --repository-name ecs-app-dev --image-id imageTag=$IMAGE_TAG
```

---

## Безопасность

### 20. assignPublicIp: true для Fargate

**Проблема:** Fargate таски имеют публичные IP. Для приватных сервисов лучше использовать NAT Gateway.

**Рекомендация:** Для staging/prod:

```typescript
assignPublicIp: false, // Таски в приватных подсетях
```

### 21. Secrets в environment variables

**Текущий:** Секреты передаются через ECS secrets (хорошо). Но `NODE_ENV` — через environment (ок).

**Проверка:** Убедиться что нет секретов в `environment {}`.

### 22. No SSL/TLS на ALB

**Текущий:** HTTP без сертификата.

**Рекомендация:** Настроить SSL и перенаправление HTTP → HTTPS:

```typescript
this.service.redirectHttp();
```

---

## Мониторинг

### 23. Нет Dashboard

**Рекомендация:**

```typescript
const dashboard = new cloudwatch.Dashboard(this, 'Dashboard');
dashboard.addWidgets(
  new cloudwatch.GraphWidget({
    title: 'Request Count',
    left: [this.service.targetGroup.metrics.requestCount()],
  }),
  new cloudwatch.GraphWidget({
    title: 'Target Response Time',
    left: [this.service.targetGroup.metrics.targetResponseTime()],
  }),
  new cloudwatch.SingleValueWidget({
    title: 'Healthy Hosts',
    metrics: [this.service.targetGroup.metrics.healthyHostCount()],
  }),
);
```

### 24. Container Insights не настроен до конца

**Текущий:** `containerInsightsV2: ecs.ContainerInsights.ENABLED` — ок, но нет alertring на метрики.

---

## Приоритет исправлений

| # | Проблема | Приоритет | Сложность |
|---|----------|-----------|-----------|
| 1 | VPC Flow Logs | Высокий | Низкая |
| 2 | ALB access logs | Высокий | Низкая |
| 3 | CloudWatch Alarms | Высокий | Низкая |
| 5 | Log Group retention | Высокий | Низкая |
| 6 | Container Health Check | Высокий | Низкая |
| 14 | Graceful shutdown | Средний | Низкая |
| 15 | Request logging | Средний | Низкая |
| 4 | Security Group | Средний | Средняя |
| 7 | Termination protection | Средний | Низкая |
| 8 | Auto-scaling cooldown | Средний | Низкая |
| 12 | Multi-stage Dockerfile | Средний | Низкая |
| 13 | .dockerignore | Средний | Низкая |
| 16 | Error handling | Средний | Низкая |
| 20 | assignPublicIp | Низкий | Низкая |
| 22 | SSL/TLS | Низкий | Средняя |
| 9 | WAF | Низкий | Средняя |
| 23 | Dashboard | Низкий | Средняя |
| 10 | Secret keys alignment | Низкий | Средняя |

---

## Быстрые победы (можно сделать сейчас)

1. Добавить VPC Flow Logs (5 строк)
2. Добавить Log Group retention (3 строки)
3. Добавить Container Health Check в Dockerfile (1 строка)
4. Добавить .dockerignore (5 строк)
5. Добавить Graceful shutdown (10 строк)
6. Добавить Request logging (5 строк)
