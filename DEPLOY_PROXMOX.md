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

## Recuperación de contraseña

El enlace de «¿Olvidaste tu contraseña?» lo firma y lo envía este front, así
que el contenedor necesita estas variables privadas de runtime (en el mismo
archivo protegido que las de mapas):

- `PASSWORD_RECOVERY_SECRET`: 32 caracteres o más, solo de este front.
- `PASSWORD_RECOVERY_SERVICE_TOKEN`: el MISMO valor que tiene el `.env` del
  backend; con él el front llama a `/api/auth/recuperacion/*`.
- `RESEND_API_KEY` y `RESEND_FROM`: el remitente del correo.

Si falta alguna, la pantalla responde «La recuperación de contraseña no está
configurada en este entorno».

