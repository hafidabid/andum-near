#!/usr/bin/env bash
# ONE-TIME, run ON THE SERVER (needs sudo for nginx + certbot only; docker needs none).
# Creates the nginx vhost for the API and gets a Let's Encrypt cert.
#
#   API_DOMAIN=andum-backend.projectdeadwood.my.id CERT_EMAIL=you@example.com bash setup-server.sh
# DNS for API_DOMAIN must already point at this server, and ports 80/443 must be open.
set -euo pipefail
API_DOMAIN="${API_DOMAIN:-andum-backend.projectdeadwood.my.id}"
API_PORT="${API_HOST_PORT:-8090}"
: "${CERT_EMAIL:?set CERT_EMAIL, used for certificate expiry notices}"

if [ -d /etc/nginx/sites-available ]; then
  CONF=/etc/nginx/sites-available/$API_DOMAIN; LINK=/etc/nginx/sites-enabled/$API_DOMAIN
else
  CONF=/etc/nginx/conf.d/$API_DOMAIN.conf; LINK=""
fi

sudo tee "$CONF" >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $API_DOMAIN;

    client_max_body_size 128k;

    location / {
        proxy_pass http://127.0.0.1:$API_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;   # one hop: the API uses 'trust proxy 1'
        proxy_set_header X-Forwarded-Proto \$scheme;
        # server-sent events (live status stream)
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
NGINX
[ -n "$LINK" ] && sudo ln -sf "$CONF" "$LINK"
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d "$API_DOMAIN" -m "$CERT_EMAIL" --agree-tos --no-eff-email --redirect -n
sudo nginx -t && sudo systemctl reload nginx
echo "nginx + TLS ready for https://$API_DOMAIN  (certbot renews automatically; check: sudo certbot renew --dry-run)"
