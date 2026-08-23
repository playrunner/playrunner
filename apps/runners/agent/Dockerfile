ARG PLAYWRIGHT_VERSION=v1.62.1-jammy
ARG PLAYWRIGHT_NPM_VERSION=1.62.1
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION} AS builder

WORKDIR /app/agent
COPY agent/package*.json ./
RUN npm ci
COPY agent ./
COPY shared ../shared
RUN npm run build

FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION}
ARG PLAYWRIGHT_VERSION
ARG PLAYWRIGHT_NPM_VERSION
WORKDIR /app/agent
COPY agent/package*.json ./
RUN node -e \
      "const fs = require('fs'); const manifest = require('./package.json'); delete manifest.devDependencies; manifest.dependencies['@playwright/test'] = '${PLAYWRIGHT_NPM_VERSION}'; manifest.dependencies.playwright = '${PLAYWRIGHT_NPM_VERSION}'; fs.writeFileSync('package.json', JSON.stringify(manifest));" && \
    npm install --omit=dev --package-lock=false && \
    node -e "if (!process.argv[1].startsWith('v' + process.argv[2] + '-')) throw new Error('Playwright image/npm version mismatch');" "${PLAYWRIGHT_VERSION}" "${PLAYWRIGHT_NPM_VERSION}"
COPY --from=builder /app/agent/dist ./dist
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates git && \
    rm -rf /var/lib/apt/lists/* && \
    npm install --global pnpm@10.15.1 yarn@1.22.22 && \
    groupadd --gid 1001 playrunner && \
    useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash playrunner && \
    mkdir -p /workspace/repo /workspace/inputs /workspace/playrunner-artifacts && \
    chown playrunner:playrunner /workspace/repo && \
    chmod 0755 /workspace /workspace/inputs /workspace/playrunner-artifacts && \
    chmod +x /app/agent/dist/agent/src/validator-cli.js && \
    ln -s /app/agent/dist/agent/src/validator-cli.js /usr/local/bin/playrunner-validator && \
    ln -s /app/agent/node_modules/.bin/codex /usr/local/bin/codex && \
    ln -s /app/agent/node_modules/.bin/playwright /usr/local/bin/playwright && \
    ln -s /app/agent/node_modules/.bin/vitest /usr/local/bin/vitest && \
    git --version && \
    codex --version && \
    playwright --version && \
    vitest --version && \
    node -e "require.resolve('@bgotink/playwright-coverage')"

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYRUNNER_AGENT_UID=1001
ENV PLAYRUNNER_AGENT_GID=1001
ENV PLAYRUNNER_AGENT_HOME=/home/playrunner

CMD ["node", "dist/agent/src/index.js"]
