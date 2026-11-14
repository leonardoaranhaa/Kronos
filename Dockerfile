# Node builds the panel. The final image adds Python and a CPU-only torch for Kronos-small.
# The venv is created in that image so the interpreter matches it. Weights download on first start into /data.
FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY server ./server
COPY shared ./shared
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG KRONOS_COMMIT=67b630e67f6a18c9e9be918d9b4337c960db1e9a
WORKDIR /opt/kronos
COPY patches/kronos-rope-425.patch /tmp/kronos-rope-425.patch
RUN git init /opt/kronos/source \
  && git -C /opt/kronos/source remote add origin https://github.com/shiyu-coder/Kronos.git \
  && git -C /opt/kronos/source fetch --depth 1 origin "${KRONOS_COMMIT}" \
  && git -C /opt/kronos/source checkout --detach --force FETCH_HEAD \
  && git -C /opt/kronos/source apply /tmp/kronos-rope-425.patch \
  && rm -rf /opt/kronos/source/.git \
  && python3 -m venv /opt/kronos/venv \
  && /opt/kronos/venv/bin/pip install --upgrade pip \
  && /opt/kronos/venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu \
  && grep -Ev '^[[:space:]]*(#|$)' /opt/kronos/source/requirements.txt \
    | grep -Ev '^[[:space:]]*(pandas|torch)([=<>~![:space:]]|$)' > /tmp/kronos-reqs.txt \
  && /opt/kronos/venv/bin/pip install -r /tmp/kronos-reqs.txt "pandas==2.2.3" \
  && rm -f /tmp/kronos-reqs.txt /tmp/kronos-rope-425.patch

WORKDIR /app
COPY --from=web /src/package.json /src/package-lock.json ./
COPY --from=web /src/node_modules ./node_modules
COPY --from=web /src/dist ./dist
COPY --from=web /src/server ./server
COPY --from=web /src/shared ./shared
COPY scripts/supervise.mjs ./scripts/supervise.mjs
COPY reports ./reports

ENV NODE_ENV=production \
    PORT=3000 \
    PUBLIC_READONLY=1 \
    DATA_DIR=/data \
    HF_HOME=/data/huggingface \
    HUGGINGFACE_HUB_CACHE=/data/huggingface/hub \
    TRANSFORMERS_CACHE=/data/huggingface/transformers \
    KRONOS_PYTHON_PATH=/opt/kronos/venv/bin/python \
    KRONOS_REPO_PATH=/opt/kronos/source \
    KRONOS_DEVICE=cpu \
    KRONOS_UPSTREAM_COMMIT=67b630e67f6a18c9e9be918d9b4337c960db1e9a \
    CRAWLER_ENABLED=1 \
    FEED_MODE=binance \
    PYTHONUNBUFFERED=1

EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "scripts/supervise.mjs"]
