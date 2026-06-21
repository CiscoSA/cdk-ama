# Деплой ECS CDK в us-east-1

## Прerequisites

- Docker Desktop запущен
- AWS CLI настроен с профилем `ama` (аккаунт `992382855794`)
- Node.js установлен

## Архитектура

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
└── Secrets: dev/app-secrets

ECR Repository: ecs-app-dev (removalPolicy: RETAIN)
Secrets Manager: dev/app-secrets (removalPolicy: RETAIN)
```

---

## Первичная настройка (выполнить один раз)

### 1. Установить зависимости CDK

```powershell
cd C:\work\kiro\CDK\cdk-ama
npm install
```

### 2. Бутстрап CDK

```powershell
$env:CDK_DEFAULT_REGION='us-east-1'; $env:AWS_PROFILE='ama'; npx cdk bootstrap
```

### 3. Залогиниться в ECR

```powershell
aws ecr get-login-password --region us-east-1 --profile ama | docker login --username AWS --password-stdin 992382855794.dkr.ecr.us-east-1.amazonaws.com
```

### 4. Создать ECR репозиторий

```powershell
aws ecr create-repository --repository-name ecs-app-dev --region us-east-1 --profile ama
```

### 5. Записать секреты в Secrets Manager

```powershell
aws secretsmanager create-secret --name dev/app-secrets --secret-string '{"REACT_APP_SHARETRIBE_SDK_CLIENT_ID":"123","SHARETRIBE_SDK_CLIENT_SECRET":"456","REACT_APP_MARKETPLACE_NAME":"Test","REACT_APP_MARKETPLACE_ROOT_URL":"http://PLACEHOLDER"}' --region us-east-1 --profile ama
```

После деплоя обновить `REACT_APP_MARKETPLACE_ROOT_URL` на реальный URL ALB:

```powershell
aws secretsmanager put-secret-value --secret-id dev/app-secrets --secret-string '{"REACT_APP_SHARETRIBE_SDK_CLIENT_ID":"123","SHARETRIBE_SDK_CLIENT_SECRET":"456","REACT_APP_MARKETPLACE_NAME":"Test","REACT_APP_MARKETPLACE_ROOT_URL":"http://<ALB_DNS>"}' --region us-east-1 --profile ama
```

---

## Деплой с нуля (полная переустановка)

### Шаг 1 — Удалить существующий стек

```powershell
$env:CDK_DEFAULT_REGION='us-east-1'; $env:AWS_PROFILE='ama'; npx cdk destroy --context env=dev
```

Подтверди `y`. ECR репозиторий и Secrets Manager **не удаляются** (removalPolicy: RETAIN).

### Шаг 2 — Пересобрать Docker-образ

```powershell
cd C:\work\kiro\CDK\cdk-ama\app
docker build -t ecs-app-dev:latest .
```

### Шаг 3 — Запушить образ в ECR

```powershell
docker tag ecs-app-dev:latest 992382855794.dkr.ecr.us-east-1.amazonaws.com/ecs-app-dev:latest
docker push 992382855794.dkr.ecr.us-east-1.amazonaws.com/ecs-app-dev:latest
```

### Шаг 4 — Задеплоить CDK стек

```powershell
cd C:\work\kiro\CDK\cdk-ama
$env:CDK_DEFAULT_REGION='us-east-1'; $env:AWS_PROFILE='ama'; npx cdk deploy --context env=dev
```

Подтверди `y`.

### Шаг 5 — Проверить

```powershell
# Health check
curl http://<ALB_DNS>/health

# Основной эндпоинт
curl http://<ALB_DNS>/
```

Ожидаемый ответ:
```json
{"status":"healthy","timestamp":"..."}
{"message":"Hello from ECS Fargate!"}
```

---

## Обновление приложения (без удаления инфры)

### 1. Пересобрать и запушить образ

```powershell
cd C:\work\kiro\CDK\cdk-ama\app
docker build -t ecs-app-dev:latest .
docker tag ecs-app-dev:latest 992382855794.dkr.ecr.us-east-1.amazonaws.com/ecs-app-dev:latest
docker push 992382855794.dkr.ecr.us-east-1.amazonaws.com/ecs-app-dev:latest
```

### 2. Обновить ECS Service (принудительный ребилд)

```powershell
aws ecs update-service --cluster EcsCdkStack-dev-ClusterEB0386A7 --service FargateService --force-new-deployment --region us-east-1 --profile ama
```

---

## Обновление секретов

```powershell
aws secretsmanager put-secret-value --secret-id dev/app-secrets --secret-string '{"REACT_APP_SHARETRIBE_SDK_CLIENT_ID":"новое","SHARETRIBE_SDK_CLIENT_SECRET":"новое","REACT_APP_MARKETPLACE_NAME":"новое","REACT_APP_MARKETPLACE_ROOT_URL":"http://новое"}' --region us-east-1 --profile ama
```

После обновления перезапустить таски:

```powershell
aws ecs update-service --cluster EcsCdkStack-dev-ClusterEB0386A7 --service FargateService --force-new-deployment --region us-east-1 --profile ama
```

---

## (Опционально) Настроить SSL

### 1. Создать сертификат в ACM (us-east-1)

```powershell
aws acm request-certificate --domain-name your-domain.com --validation-method DNS --profile ama --region us-east-1
```

### 2. Дождаться выдачи сертификата (статус `ISSUED`)

```powershell
aws acm describe-certificate --certificate-arn <ARN> --region us-east-1 --profile ama
```

### 3. Перезадеплоить с certificateArn

```powershell
$env:CDK_DEFAULT_REGION='us-east-1'; $env:AWS_PROFILE='ama'; npx cdk deploy --context env=dev --context certificateArn=arn:aws:acm:us-east-1:992382855794:certificate/<ID>
```

---

## Полезные команды

```powershell
# Список стеков
npx cdk list --context env=dev

# Diff (что изменится)
npx cdk diff --context env=dev

# Удалить стек
$env:CDK_DEFAULT_REGION='us-east-1'; $env:AWS_PROFILE='ama'; npx cdk destroy --context env=dev

# Логи ECS тасков
aws logs tail /ecs/EcsCdkStack-dev-TaskDefAppContainer --follow --profile ama --region us-east-1

# Список образов в ECR
aws ecr describe-images --repository-name ecs-app-dev --region us-east-1 --profile ama

# Прочитать секреты
aws secretsmanager get-secret-value --secret-id dev/app-secrets --region us-east-1 --profile ama

# Принудительный ребилд ECS Service
aws ecs update-service --cluster EcsCdkStack-dev-ClusterEB0386A7 --service FargateService --force-new-deployment --region us-east-1 --profile ama
```

---

## ECS Exec — вход в контейнер (аналог docker exec)

### Установить SSM Plugin (один раз)

```powershell
# Windows (winget)
winget install Amazon.ECSCLI

# Или скачать вручную: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html
```

Проверить что плагин установлен:

```powershell
session-manager-plugin
```

### Найти task ID

```powershell
aws ecs list-tasks --cluster EcsCdkStack-dev-ClusterEB0386A7 --region us-east-1 --profile ama
```

Вывод:
```json
{
    "taskArns": [
        "arn:aws:ecs:us-east-1:992382855794:task/EcsCdkStack-dev-ClusterEB0386A7/abc123..."
    ]
}
```

Извлечь task ID из ARN (последняя часть после `/`).

### Войти в контейнер

```powershell
aws ecs execute-command `
  --cluster EcsCdkStack-dev-ClusterEB0386A7 `
  --task <TASK_ID> `
  --container app `
  --interactive `
  --command "/bin/sh" `
  --region us-east-1 `
  --profile ama
```

### Полезные команды внутри контейнера

```sh
# Проверить переменные окружения
env

# Проверить что слушает приложение
netstat -tlnp

# Проверить health check
wget -qO- http://localhost:3000/health

# Посмотреть процессы
ps aux

# Выйти
exit
```

### Удаленный контейнер (non-interactive)

```powershell
# Выполнить команду и выйти
aws ecs execute-command `
  --cluster EcsCdkStack-dev-ClusterEB0386A7 `
  --task <TASK_ID> `
  --container app `
  --command "cat /app/src/index.js" `
  --region us-east-1 `
  --profile ama
```

---

## Структура проекта

```
cdk-ama/
├── bin/ecs-cdk.ts              # Entry point, конфигурация окружений
├── lib/ecs-cdk-stack.ts        # CDK стек (VPC, ECS, ALB, ECR, Secrets)
├── app/
│   ├── Dockerfile              # Сборка контейнера
│   ├── package.json            # Зависимости приложения
│   └── src/index.js            # Express приложение
├── .github/workflows/deploy.yml # CI/CD (GitHub Actions)
├── cdk.json                    # CDK конфигурация
└── DEPLOY.md                   # Этот файл
```

## Multi-environment

| Параметр | dev | staging | prod |
|----------|-----|---------|------|
| AZs | 2 | 2 | 3 |
| NAT Gateways | 1 | 1 | 2 |
| CPU | 256 | 512 | 512 |
| Memory (MB) | 512 | 1024 | 1024 |
| Desired Count | 1 | 2 | 3 |
| Min/Max | 1/3 | 2/5 | 3/20 |

Деплой по окружениям:
```powershell
npx cdk deploy --context env=dev
npx cdk deploy --context env=staging
npx cdk deploy --context env=prod
```
