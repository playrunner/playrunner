ARG BASE_PATH=.

FROM node:24-alpine AS builder

ARG BASE_PATH
WORKDIR /app
COPY . .
WORKDIR /app/${BASE_PATH}/apps/runners/orchestrator
RUN npm ci
RUN npm run build

FROM node:24-alpine

ARG BASE_PATH
WORKDIR /app

RUN apk add --no-cache docker-cli
COPY . .
RUN cd /app/${BASE_PATH}/apps/runners/orchestrator && npm ci --omit=dev
COPY --from=builder /app/${BASE_PATH}/apps/runners/orchestrator/dist /app/${BASE_PATH}/apps/runners/orchestrator/dist
RUN if [ -f /app/premium/runners/orchestrator/package-lock.json ]; then cd /app/premium/runners/orchestrator && npm ci --omit=dev; elif [ -f /app/premium/runners/orchestrator/package.json ]; then cd /app/premium/runners/orchestrator && npm install --omit=dev; fi

ENV PORT=8080
ENV ORCHESTRATOR_BASE_PATH=${BASE_PATH}
EXPOSE 8080

CMD ["sh", "-lc", "node /app/${ORCHESTRATOR_BASE_PATH}/apps/runners/orchestrator/dist/index.js"]
