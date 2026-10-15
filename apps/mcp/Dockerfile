# Build from the repository root: docker build -f apps/mcp/Dockerfile .
FROM node:24-alpine AS editor
WORKDIR /source
COPY packages ./packages
COPY config ./config
COPY infra/scripts/generate-integration-composition.mjs ./infra/scripts/
COPY apps/runners/shared ./apps/runners/shared
COPY apps/frontend/package*.json ./apps/frontend/
RUN npm ci --prefix apps/frontend
COPY apps/frontend/src ./apps/frontend/src
COPY apps/frontend/public ./apps/frontend/public
COPY apps/frontend/scripts ./apps/frontend/scripts
COPY apps/frontend/vite.config.ts apps/frontend/tsconfig.json ./apps/frontend/
COPY apps/mcp/src/workflow-editor.html ./apps/mcp/src/workflow-editor.html
RUN VITE_API_URL=http://127.0.0.1:3011 npm run build:workflow-editor --prefix apps/frontend

FROM node:24-alpine
WORKDIR /app
COPY apps/mcp/package.json apps/mcp/package-lock.json ./
RUN npm ci
COPY apps/mcp/src ./src
COPY --from=editor /source/apps/mcp/dist ./dist
ENV NODE_ENV=production MCP_PORT=3013
USER node
EXPOSE 3013
CMD ["npm", "start"]
