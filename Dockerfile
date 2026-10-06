FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    WORKEXPERT_DATA_DIR=/opt/workexpert-data \
    WORKEXPERT_API_HOST=0.0.0.0 \
    WORKEXPERT_API_PORT=50832 \
    WORKEXPERT_AGENT_ENGINE=agentscope

WORKDIR /opt/workexpert

COPY package.docker.json ./package.json
COPY README.md README-EN.md ./
COPY bin ./bin
COPY scripts/lib ./scripts/lib
COPY apps/api/dist ./apps/api/dist
COPY apps/renderer/dist ./apps/renderer/dist
COPY runtimes/agentscope-runtime ./runtimes/agentscope-runtime

RUN npm install --omit=dev --no-audit --no-fund
RUN chmod +x bin/workexpert.mjs
RUN mkdir -p /opt/workexpert-data && WORKEXPERT_DATA_DIR=/opt/workexpert-data node bin/workexpert.mjs init

EXPOSE 50832
VOLUME ["/opt/workexpert-data"]

CMD ["node", "bin/workexpert.mjs", "start"]
