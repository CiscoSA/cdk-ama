# Handoff сессии — ECS CDK Project

## Цель
CDK-проект для деплоя Sharetribe marketplace на AWS ECS Fargate с ALB, SSL и auto-scaling.

## Текущий статус: DEPLOYED (Sharetribe работает)

**AWS Account:** `992382855794` (profile: `ama`)
**Регион:** `us-east-1`
**Stack:** `EcsCdkStack-dev`
**Service URL:** `http://ecscdk-farga-igdkwkipmiwf-2144018952.us-east-1.elb.amazonaws.com`
**Health Check:** `/_status.json` → `{"status":"ok"}`

---

## Что сделано

### Инфраструктура (задеплоена)
1. CDK bootstrap выполнен в аккаунте `992382855794`
2. ECR репозиторий `ecs-app-dev` создан вручную (removalPolicy: RETAIN)
3. Secrets Manager `dev/app-secrets` создан с ключами Sharetribe
4. Docker image собран (Sharetribe multi-stage: deps → builder → runner) и запушен в ECR
5. CDK стек задеплоен и работает
6. Sharetribe приложение работает — `/_status.json` отвечает `{"status":"ok"}`

### Приложение
- Заменена заглушка Express на **Sharetribe Web Template** (React SSR)
- Dockerfile: multi-stage (deps → builder → runner), Node 22 Alpine, yarn
- `REACT_APP_*` переменные передаются как **build args** (React требует их при сборке)

### Исправления, применённые в процессе
- **ECR** — импорт `ecr.Repository.fromRepositoryName()` вместо создания
- **Secrets** — импорт `Secret.fromSecretNameV2()` вместо создания
- **ALB Health Check** — исправлен на `/_status.json` (Sharetribe использует его)
- **Container Health Check** — Dockerfile: `wget http://127.0.0.1:3000/_status.json`
- **ECS Exec** — включён (`enableExecuteCommand: true`)
- **.gitignore** — добавлены `!app/scripts/**/*.js` и `!app/config/**/*.js` (Sharetribe файлы)
- **REACT_APP build args** — Dockerfile принимает `ARG` + `ENV` для React переменных

### CI/CD
- GitHub Actions workflow: триггер на `app` branch
- Build job: собирает Docker с `--build-arg` для `REACT_APP_*`
- Deploy job: запускается только при push в `app`

---

## Что осталось сделать

### Приоритет высокий
1. **GitHub Secrets** — добавить `REACT_APP_SHARETRIBE_SDK_CLIENT_ID`, `REACT_APP_MARKETPLACE_NAME`, `REACT_APP_MARKETPLACE_ROOT_URL`
2. **Best Practices** (файл `BEST_PRACTICES.md`):
   - VPC Flow Logs, ALB access logs, CloudWatch Alarms, Log Group retention

### Приоритет средний
3. Настройка SSL (ACM сертификат + `certificateArn`)
4. Graceful shutdown в server/index.js
5. WAF на ALB

### Приоритет низкий
6. DNS (Route53) на ALB
7. CloudWatch Dashboard
8. Termination protection для prod

---

## Затронутые файлы

| Файл | Описание |
|------|----------|
| `lib/ecs-cdk-stack.ts` | Основной стек (VPC, ECS, ALB, Secrets, Health Check) |
| `bin/ecs-cdk.ts` | Entry point, конфигурация окружений |
| `app/Dockerfile` | Multi-stage сборка Sharetribe (yarn, build args) |
| `app/src/index.js` | Express заглушка (не используется в продакшене) |
| `app/server/index.js` | Sharetribe Express сервер |
| `app/package.json` | Зависимости Sharetribe |
| `app/.dockerignore` | Исключения для Docker |
| `.gitignore` | Исключения для git (scripts, config) |
| `.github/workflows/deploy.yml` | CI/CD pipeline (app branch, build args) |
| `DEPLOY.md` | Инструкция по деплою |
| `BEST_PRACTICES.md` | Анализ и рекомендации |

---

## Запущенные команды

| Команда | Результат |
|---------|-----------|
| `npx cdk bootstrap` | OK |
| `npx cdk deploy --context env=dev` | OK (deployed) |
| `npx cdk destroy --context env=dev` | OK (тестирование с нуля) |
| `docker build --build-arg ... -t ecs-app-dev:latest .` | OK |
| `docker push ...ecs-app-dev:latest` | OK |
| `curl http://<ALB>/_status.json` | OK — `{"status":"ok"}` |
| `aws ecs execute-command` | OK |

---

## Риски/блокеры

1. **REACT_APP_* сборка** — переменные должны быть в Docker build args, не только в ECS secrets
2. **GitHub Secrets** — нужны `REACT_APP_*` для CI/CD сборки
3. **assignPublicIp: true** — для staging/prod лучше false
4. **Нет SSL** — работает только HTTP

---

## Решения принятые в процессе

1. **ECR и Secrets — импорт** — чтобы избежать Circuit Breaker
2. **Health Check — `/_status.json`** — Sharetribe использует его, не `/health`
3. **REACT_APP_* — build args** — React требует их при сборке, не при запуске
4. **Триггер CI/CD — `app` branch** — ветка разработки

---

## Следующий рекомендуемый шаг

1. Добавить GitHub Secrets для `REACT_APP_*`
2. Запушить в `app` для запуска CI/CD
3. Применить Best Practices из `BEST_PRACTICES.md`
