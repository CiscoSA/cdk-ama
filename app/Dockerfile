FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json yarn.lock ./
COPY patches/ ./patches/
RUN yarn install --frozen-lockfile --production=false

FROM node:22-alpine AS builder

WORKDIR /app

ARG REACT_APP_SHARETRIBE_SDK_CLIENT_ID
ARG REACT_APP_MARKETPLACE_NAME
ARG REACT_APP_MARKETPLACE_ROOT_URL

ENV REACT_APP_SHARETRIBE_SDK_CLIENT_ID=$REACT_APP_SHARETRIBE_SDK_CLIENT_ID
ENV REACT_APP_MARKETPLACE_NAME=$REACT_APP_MARKETPLACE_NAME
ENV REACT_APP_MARKETPLACE_ROOT_URL=$REACT_APP_MARKETPLACE_ROOT_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

COPY --from=builder /app/build ./build
COPY --from=builder /app/server ./server
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

USER appuser

EXPOSE 3000

ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/_status.json || exit 1

CMD ["node", "server/index.js"]
