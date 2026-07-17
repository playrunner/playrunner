ARG BASE_PATH=.

FROM node:24-alpine

ARG BASE_PATH
WORKDIR /app

RUN apk add --no-cache openssl

COPY . .

WORKDIR /app/${BASE_PATH}/apps/api
RUN npm ci
RUN npm run build:integrations
RUN npx prisma generate

ENV NODE_ENV=production
ENV PORT=8080
ENV API_BASE_PATH=${BASE_PATH}
ENV NODE_PATH=/app/${BASE_PATH}/apps/api/node_modules
EXPOSE 8080

CMD ["npm", "run", "start:cloud"]
