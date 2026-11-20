# TLS & Certbot Setup (Staging / Production Manual Checklist)

This file documents the TLS termination setup using `docker/nginx.tls.conf` and Let's Encrypt (`certbot`). TLS cannot be verified in CI/local tests without a real public domain pointing to the host.

## Initial Certificate Issuance

1. Point DNS (`A`/`AAAA`) for the deployment domain to the VPS public IP.
2. Start Nginx initially with HTTP challenge webroot mounted at `/var/www/certbot`.
3. Issue the certificate:

```bash
certbot certonly --webroot \
  -w /var/www/certbot \
  -d app.example.com \
  --cert-name solva-pos \
  --agree-tos -m ops@example.com --non-interactive
```

4. Mount `/etc/letsencrypt:/etc/letsencrypt:ro` and `./docker/nginx.tls.conf:/etc/nginx/nginx.conf:ro` on the `proxy` container and reload Nginx.

## Automatic Renewal

Add a cron/systemd timer on the VPS host:

```bash
certbot renew --quiet --deploy-hook "docker compose --profile full exec -T proxy nginx -s reload"
```

## Manual Verification Checklist

- [ ] `http://<domain>/` returns `301` redirecting to `https://<domain>/`
- [ ] `https://<domain>/` returns `404`
- [ ] `https://<domain>/health` returns `200` with `Strict-Transport-Security` and `X-App-Version` headers
- [ ] `https://<domain>/assets/<any>.map` returns `404`
- [ ] `certbot renew --dry-run` succeeds
