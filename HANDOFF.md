# Handoff сессии — ECS CDK Project

## Цель
Создать CDK-проект для деплоя Node.js веб-приложения на AWS ECS Fargate с ALB, SSL и auto-scaling.

## Что сделано
1. Установлен `aws-cdk` CLI
2. Инициализирован TypeScript CDK проект в `C:\WORK\kiro\CDK\ecs-cdk`
3. Создан стек `EcsCdkStack` с multi-environment support:
   - VPC (3 AZ, NAT Gateway)
   - ECS Cluster с Container Insights
   - Fargate Task Definition (256 CPU, 512 MB)
   - ALB с health check на `/health`
   - Auto-scaling: CPU 70%, Memory 70%, Requests 1000/target
   - Min 2 / Max 10 tasks
   - ECR репозиторий с lifecycle policies
4. Создан Dockerfile (multi-stage, Node.js 20 Alpine)
5. Создано простое Express приложение с `/health` и `/` эндпоинтами
6. Проект компилируется (`npm run build`) и синтезируется (`cdk synth`) без ошибок
7. Реализована поддержка окружений: dev, staging, prod
8. Создан CI/CD pipeline (GitHub Actions) для сборки и пуша Docker-образов в ECR

## Что осталось
- Деплой инфраструктуры: `npx cdk deploy --context env=dev`
- Записать значения секретов в AWS Secrets Manager
- Настройка SSL: создание ACM сертификата и передача `certificateArn`
- Настройка GitHub Secrets для CI/CD (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
- Настройка DNS (Route53) на ALB
- Замена заглушки в `app/` на реальное приложение

## Затронутые файлы

| Файл | Описание |
|------|----------|
| `ecs-cdk/lib/ecs-cdk-stack.ts` | Основной стек (VPC, ECS, ALB, ECR) |
| `ecs-cdk/bin/ecs-cdk.ts` | Entry point с конфигурацией окружений |
| `ecs-cdk/Dockerfile` | Сборка контейнера |
| `ecs-cdk/app/src/index.js` | Node.js приложение |
| `ecs-cdk/app/package.json` | Зависимости приложения |
| `ecs-cdk/.github/workflows/deploy.yml` | CI/CD pipeline (GitHub Actions) |

## Регион деплоя
- **Текущий**: `us-east-1` (из конфигурации AWS CLI)
- Регион берётся из `process.env.CDK_DEFAULT_REGION` в `bin/ecs-cdk.ts`
- Для смены региона:
  ```bash
  # Через env переменную
  CDK_DEFAULT_REGION=eu-west-1 npx cdk deploy
  ```

## CI/CD Pipeline

### Архитектура деплоя
```
Infrastructure (CDK)          Application (CI/CD)
─────────────────────         ─────────────────────
VPC                           GitHub Actions
ECS Cluster                   ↓
ALB                           Build Docker image
ECR Repository ←────────────── Push to ECR
Auto-scaling                  ↓
                              ECS update service
```

### GitHub Actions workflow
- **Триггер**: push в `main` или PR
- **Шаги**:
  1. Сборка Docker-образа
  2. Пush в ECR с тегами: `${{ github.sha }}` и `latest`
  3. Деплой CDK стека в dev окружение

### Настройка GitHub Secrets
```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

### Ручной деплой приложения
```bash
# Сборка и пуш образа
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker build -t ecs-app-dev:latest .
docker tag ecs-app-dev:latest <account>.dkr.ecr.us-east-1.amazonaws.com/ecs-app-dev:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/ecs-app-dev:latest

# Обновление сервиса
aws ecs update-service --cluster EcsCdkStack-dev-Cluster --service FargateService --force-new-deployment
```

## Multi-environment конфигурация

| Параметр | dev | staging | prod |
|----------|-----|---------|------|
| AZs | 2 | 2 | 3 |
| NAT Gateways | 1 | 1 | 2 |
| CPU | 256 | 512 | 512 |
| Memory (MB) | 512 | 1024 | 1024 |
| Desired Count | 1 | 2 | 3 |
| Min Capacity | 1 | 2 | 3 |
| Max Capacity | 3 | 5 | 20 |
| CPU Target % | 80 | 70 | 65 |
| Memory Target % | 80 | 70 | 65 |
| Requests/Target | 500 | 1000 | 1500 |
| NODE_ENV | development | staging | production |

### Secrets

Для каждого окружения настроен AWS Secrets Manager:

| Ключ | Описание |
|------|----------|
| `DATABASE_URL` | Строка подключения к БД |
| `API_KEY` | API ключ приложения |
| `REDIS_URL` | Строка подключения к Redis |

**Управление секретами:**
```bash
# Записать секрет (после деплоя)
aws secretsmanager put-secret-value \
  --secret-id dev/app-secrets \
  --secret-string '{"DATABASE_URL":"postgres://...","API_KEY":"xxx","REDIS_URL":"redis://..."}'

# Прочитать секрет
aws secretsmanager get-secret-value --secret-id dev/app-secrets
```

**Структура секретов:**
```
dev/app-secrets
staging/app-secrets
prod/app-secrets
```

**Деплой по окружениям:**
```bash
npx cdk deploy --context env=dev
npx cdk deploy --context env=staging
npx cdk deploy --context env=prod
```

## Запущенные команды
- `npm run build` — успех
- `npx cdk synth --context env=dev` — успех (warnings: minHealthyPercent)
- `npx cdk list --context env=dev` — успех (EcsCdkStack-dev)

## Риски/блокеры
- Приложение в `app/` — это заглушка. Нужно заменить на реальный код или изменить путь в Dockerfile
- SSL работает только при передаче `certificateArn` через context
- `natGateways: 1` — для production стоит увеличить до 2+ для HA

## Следующий шаг
1. Деплой инфраструктуры: `npx cdk deploy --context env=dev`
2. Настройка GitHub Secrets
3. Push в GitHub для запуска CI/CD
