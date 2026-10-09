#!/bin/sh
# Chooses the Nginx site configuration at container start:
#   - certificate for $DOMAIN present -> HTTPS site (default.conf)
#   - otherwise                       -> HTTP only, so Let's Encrypt can issue one
set -e
: "${DOMAIN:?DOMAIN must be set (e.g. afwaah.example.com)}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [ -f "$CERT" ]; then
  TEMPLATE=/etc/nginx/afwaah/https.conf.template
  echo "afwaah: certificate found for ${DOMAIN}, serving HTTPS"
else
  TEMPLATE=/etc/nginx/afwaah/http.conf.template
  echo "afwaah: no certificate for ${DOMAIN} yet, serving HTTP only"
fi
envsubst '${DOMAIN}' < "$TEMPLATE" > /etc/nginx/conf.d/afwaah.conf
