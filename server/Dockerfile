FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN groupadd --gid 1001 vault && useradd --uid 1001 --gid vault --create-home vault

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/src/ src/

RUN mkdir -p /data /data/users && chown -R vault:vault /data

USER vault
EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "src/index.js"]
