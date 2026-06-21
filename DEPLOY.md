# Деплой ECS CDK в us-east-1

## Прerequisites

- Docker Desktop запущен
- AWS CLI настроен с профилем `ama`
- Node.js установлен

## Проблема предыдущего деплоя

CDK создаёт ECS Service и ECR одновременно. ECS пытается запустить таск, тянет образ из ECR — а образа там нет. Health check падает → Circuit Breaker → откат всего стека.

**Решение:** сначала создать ECR вручную и запушить образ, потом задеплоить CDK.

---

## Шаг 1 — Установить зависимости CDK

```powershell
cd C:\work\kiro\CDK\cdk-ama
npm install
```

## Шаг 2 — Залогиниться в ECR

```powershell
aws ecr get-login-password --region us-east-1 --profile ama | docker login --username AWS --password-stdin 992382855794.dkr.ecr.us-east-1.amazonaws.com
```

Если логин успешен, увидите: `Login Succeeded`

## Шаг 3 — Создать ECR репозиторий вручную

```powershell
aws ecr create-repository --repository-name ecs-app-dev --region us-east-1 --profile ama
```

## Шаг 4 — Собрать Docker-образ

Dockerfile лежит в `app/`. Собирать из папки `app/`:

```powershell
cd C:\work\kiro\CDK\cdk-ama\app
docker build -t ecs-app-dev:latest .
```

Проверить что образ создался:

```powershell
docker images ecs-app-dev
```

Проверить что образ создался:

```powershell
docker images ecs-app-dev
```

## Шаг 5 — Запушить образ в ECR

```powershell
docker tag ecs-app-dev:latest 992382855794.dkr.ecr.us-east-1.amazonaws.com/ecs-app-dev:latest
docker push 992382855794.dkr.ecr.us-east-1.amazonaws.com/ecs-app-dev:latest
```

Проверить что образ в ECR:

```powershell
aws ecr describe-images --repository-name ecs-app-dev --region us-east-1 --profile ama --query "imageDetails[0:imagePushedAt,imageDigest,imageTags]"
```

## Шаг 6 — Изменить CDK стек (импорт существующего ECR)

Сообщи когда шаги 1-5 выполнены — я поправлю `lib/ecs-cdk-stack.ts`, чтобы CDK **импортировал** существующий ECR репозиторий вместо создания нового.

Изменение в `ecs-cdk-stack.ts`:
```typescript
// Было (создание нового):
this.repository = new ecr.Repository(this, 'Repository', { ... });

// Станет (импорт существующего):
this.repository = ecr.Repository.fromRepositoryName(this, 'Repository', 'ecs-app-dev');
```

## Шаг 7 — Задеплоить CDK стек

```powershell
$env:CDK_DEFAULT_REGION='us-east-1'; $env:AWS_PROFILE='ama'; npx cdk deploy --context env=dev
```

Подтверди когда спросит `(y/n)` — введи `y`.

## Шаг 8 — Проверить деплой

После завершения CDK выведет:

```
Outputs:
EcsCdkStack-dev.LoadBalancerDNS = <DNS>
EcsCdkStack-dev.ServiceURL = http://<DNS>
EcsCdkStack-dev.ECRRepositoryUri = <URI>
```

Открой `ServiceURL` в браузере — должна открыться страница `{"message":"Hello from ECS Fargate!"}`.

Проверить health check:

```powershell
curl http://<DNS>/health
```

Должен вернуть: `{"status":"healthy","timestamp":"..."}`

## Шаг 9 — Записать секреты

```powershell
aws secretsmanager put-secret-value --secret-id dev/app-secrets --secret-string '{"DATABASE_URL":"postgres://user:pass@host:5432/db","API_KEY":"your-api-key","REDIS_URL":"redis://host:6379"}' --profile ama --region us-east-1
```

## Шаг 10 — (Опционально) Настроить SSL

1. Создать сертификат в ACM (us-east-1):
```powershell
aws acm request-certificate --domain-name your-domain.com --validation-method DNS --profile ama --region us-east-1
```

2. Дождаться выдачи сертификата (статус `ISSUED`)

3. Перезадеплоить с `certificateArn`:
```powershell
$env:CDK_DEFAULT_REGION='us-east-1'; $env:AWS_PROFILE='ama'; npx cdk deploy --context env=dev --context certificateArn=arn:aws:acm:us-east-1:992382855794:certificate/ID-СЕРТИФИКАТА
```

---

## Полезные команды

```powershell
# Посмотреть список стеков
npx cdk list --context env=dev

# Посмотреть diff (что изменится)
npx cdk diff --context env=dev

# Удалить стек (все ресурсы)
$env:CDK_DEFAULT_REGION='us-east-1'; $env:AWS_PROFILE='ama'; npx cdk destroy --context env=dev

# Логи ECS тасков
aws logs tail /ecs/EcsCdkStack-dev-TaskDefAppContainer --follow --profile ama --region us-east-1

# Список образов в ECR
aws ecr describe-images --repository-name ecs-app-dev --region us-east-1 --profile ama
```

## Архитектура (что будет создано)

```
VPC (2 AZ)
├── Public Subnets (2) → ALB
├── Private Subnets (2) → ECS Fargate Tasks
└── NAT Gateway (1)

ALB (порт 80)
├── Target Group → ECS Service (порт 3000)
└── Health Check: /health

ECS Cluster
├── Fargate Service (1 task, min 1, max 3)
├── Task: 256 CPU, 512 MB
├── Auto-scaling: CPU 80%, Memory 80%, Requests 500/target
└── Secrets: dev/app-secrets (DATABASE_URL, API_KEY, REDIS_URL)

ECR Repository: ecs-app-dev (создан вручную на шаге 3)
```
