FROM cloudflare/cloudflared:2026.10.7 AS cloudflared
FROM node:24-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npx playwright-core install --with-deps --no-shell chromium \
    && apt-get update \
    && apt-get install -y --no-install-recommends novnc openbox tini x11-utils x11vnc xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o node -g node /data /data/profiles /data/profiles/1 /data/profiles/2 /data/profiles/3 /data/profiles/4

COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY src ./src
COPY web ./web
COPY docker/start.sh ./docker/start.sh
RUN sed -i 's/\r$//' docker/start.sh

ENV IDLEBOT_DOCKER=1
USER node
EXPOSE 4096
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:4096/health').then(r=>process.exit(r.status===204?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--", "bash", "/app/docker/start.sh"]
