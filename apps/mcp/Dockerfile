FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
ENV NODE_ENV=production MCP_PORT=3013
USER node
EXPOSE 3013
CMD ["npm", "start"]
