# Despliegue en Proxmox

El frontend se ejecuta en CT123 mediante SvelteKit adapter-node y Docker. El
contenedor solo publica `127.0.0.1:3002`; Cloudflare Tunnel es el único punto de
entrada público.

## Construcción

Las variables `VITE_*` se incorporan al bundle durante el build. Nunca use
credenciales AWS, tokens `sk.*` ni secretos privados como variables `VITE_*`.

```sh
docker build \
  --build-arg VITE_API_URL=https://api-cotransmeq.transmeralda.com \
  --build-arg VITE_SOCKET_URL=https://api-cotransmeq.transmeralda.com \
  --build-arg VITE_MAPBOX_ACCESS_TOKEN="$MAPBOX_PUBLIC_TOKEN" \
  -t frontend-cotransmeq:production .
```

## Ejecución

```sh
docker compose -f compose.proxmox.yml up -d
docker compose -f compose.proxmox.yml ps
```

Rollback: vuelva a etiquetar la imagen anterior como `production` y ejecute
`docker compose -f compose.proxmox.yml up -d`.
