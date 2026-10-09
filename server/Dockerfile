# AfwaahTracker API (Express + node-oracledb Thin mode; no Instant Client needed)
# Build context: repository root (the API needs ../database for install/migrations)
#   docker build -f server/Dockerfile -t afwaah-server .
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ ./
COPY database/ /app/database/

# Never bake secrets into the image
RUN rm -f .env && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Install the schema on first start, otherwise apply migrations, then serve
CMD ["sh", "-c", "if [ \"$DB_PREPARE_ON_START\" = \"true\" ]; then node scripts/prepareDb.js || exit 1; fi; exec node server.js"]
