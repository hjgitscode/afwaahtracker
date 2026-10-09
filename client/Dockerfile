# AfwaahTracker web front end: React production build served by Nginx,
# which also reverse-proxies /api to the Express container.
# Build context: repository root
#   docker build -f client/Dockerfile -t afwaah-client .

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
# The browser calls the API on the same origin (/api), so no API URL or key is built in
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
# default.conf = HTTPS site; http-only.conf = used until a certificate exists
COPY nginx/default.conf /etc/nginx/afwaah/https.conf.template
COPY nginx/http-only.conf /etc/nginx/afwaah/http.conf.template
COPY nginx/proxy_params /etc/nginx/afwaah/proxy_params
COPY nginx/40-afwaah-config.sh /docker-entrypoint.d/40-afwaah-config.sh
RUN chmod +x /docker-entrypoint.d/40-afwaah-config.sh && mkdir -p /var/www/certbot
EXPOSE 80 443
