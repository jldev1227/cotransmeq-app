# Variables de entorno

Todas las variables que lee el frontend, cuándo se leen (al compilar o al
arrancar), si llegan al navegador y si son obligatorias. Léelo al preparar un
entorno nuevo, al añadir una variable o cuando algo funciona en local y no en
producción. Dónde se ponen en producción está en [despliegue.md](./despliegue.md).
Aquí no hay valores: el `.env` local no se versiona y los secretos de
producción viven en el servidor.

## Cómo las lee el código

| Mecanismo | Cuándo se resuelve | ¿Llega al navegador? | Dónde se usa |
|---|---|---|---|
| `import.meta.env.VITE_*` | Al compilar: Vite pega el valor en el bundle | Sí, todas | Clientes de la API, sockets, mapas |
| `$env/dynamic/private` | Al ejecutar, en el servidor | No | [hooks.server.ts](../src/hooks.server.ts), `src/lib/server/**`, `src/routes/api/**` |
| `$env/dynamic/public` | Al ejecutar; solo las que empiezan por `PUBLIC_` | Sí | [hooks.client.ts](../src/hooks.client.ts) |
| `$env/static/public`, `$env/static/private` | — | — | No se usan en el repo. |
| Variables de `adapter-node` | Al arrancar el servidor Node | No | El propio adaptador |

Consecuencias prácticas:

- Cambiar una `VITE_*` exige **volver a compilar** la imagen. Cambiar una de
  `$env/dynamic/*` solo exige reiniciar el contenedor.
- Todo lo que empiece por `VITE_` es público aunque no lo parezca: termina en el
  JavaScript que descarga cualquiera. Nunca una clave privada, un token `sk.*`
  de Mapbox ni credenciales de AWS con ese prefijo.
- En Docker, las `VITE_*` entran como `--build-arg`; el `.dockerignore` excluye
  todos los `.env*` (salvo `.env.example`), así que un `.env` en la carpeta no
  llega al build.

## Inventario

| Variable | Pública o privada | Estática o dinámica | Obligatoria | Para qué |
|---|---|---|---|---|
| `VITE_API_URL` | Pública (bundle) | Estática | Sí | Origen del backend, **sin `/api`**: el código añade `/api/...` y [socket.ts](../src/lib/socket.ts) abre Socket.IO contra este valor. Si falta, [apiClient.ts](../src/lib/api/apiClient.ts) cae a `http://localhost:4000`; otros clientes (`portalStore`, `extractos`, las páginas de desprendibles, `invite`) caen a cadena vacía y piden al propio origen. En el servidor (SSR) `apiClient` usa siempre `http://localhost:4000`. |
| `VITE_SOCKET_URL` | Pública | Estática | Sí (el script de despliegue falla sin ella) | Socket.IO de colaboración de canvas y chat ([socketClient.ts](../src/lib/socketClient.ts)) y del portal ([forms-portal-socket.ts](../src/lib/offline/forms-portal-socket.ts)). Si falta, usan `window.location.origin`, que no sirve Socket.IO. |
| `VITE_MAPBOX_ACCESS_TOKEN` | Pública | Estática | Para los mapas | Token público (`pk.*`) de Mapbox para los mapas del detalle de servicio, el servicio compartido y el servicio en el portal. |
| `VITE_DISTRACOM_ICON_URL` | Pública | Estática | No | Ícono de las estaciones Distracom en los mapas. Ver la trampa de abajo. |
| `PUBLIC_SENTRY_DSN` | Pública | Dinámica | No | Activa Sentry en el navegador; sin ella ni se descarga el SDK. Un DSN solo sirve para enviar eventos. |
| `PUBLIC_SENTRY_ENVIRONMENT` | Pública | Dinámica | No | Entorno de Sentry en el navegador (por defecto `production` o `development`). |
| `SENTRY_DSN` | Privada | Dinámica | No | Activa Sentry en el servidor (SSR y rutas `/api` de SvelteKit). |
| `SENTRY_ENVIRONMENT` | Privada | Dinámica | No | Entorno de Sentry en el servidor (por defecto `NODE_ENV`). |
| `BACKEND_INTERNAL_URL` | Privada | Dinámica | Sí en producción | URL del backend vista desde el servidor de SvelteKit (lugares propios y recuperación de contraseña). Por defecto `http://localhost:4000`. En Proxmox, `http://backend-cotransmeq-nest:4000` dentro de la red de Docker. |
| `HERE_MAPS_API_KEY` | Privada | Dinámica | No | Sugerencias y coordenadas de HERE en `/api/maps/autocomplete` y `/lookup`. Sin ella solo salen los lugares propios y la respuesta trae `error`. Hoy no llega al contenedor de producción. |
| `AZURE_MAPS_KEY` | Privada | Dinámica | No | Geocodificación inversa de `/api/maps/place` (sin llamadores en el front). Sin ella, esa ruta responde 500. Tampoco llega a producción. |
| `PASSWORD_RECOVERY_SECRET` | Privada | Dinámica | Sí, para recuperar contraseña | Firma HMAC de los enlaces de recuperación. Mínimo 32 caracteres (si es más corto se trata como ausente). Cambiarlo invalida los enlaces en circulación. Es solo del front. |
| `PASSWORD_RECOVERY_SERVICE_TOKEN` | Privada | Dinámica | Sí, para recuperar contraseña | Cabecera `x-recovery-token` hacia `/api/auth/recuperacion/*`. Tiene que ser el mismo valor que en el backend. |
| `RESEND_API_KEY` | Privada | Dinámica | Sí, para recuperar contraseña | Clave de Resend para el correo de recuperación. |
| `RESEND_FROM` | Privada | Dinámica | Sí, para recuperar contraseña | Remitente verificado en Resend. |
| `APP_PUBLIC_URL` | Privada | Dinámica | No (en Proxmox se define) | Origen con el que se arma el enlace del correo de recuperación. Sin ella se usa el origen de la petición, que detrás de un proxy puede ser el interno. |
| `EMAIL_LOGO_URL` | Privada | Dinámica | No | Logotipo del correo de recuperación; sin ella va el de la marca, un PNG de Cotransmeq alojado en el bucket de S3 de Transmeralda. No está en `.env.example` ni en `compose.proxmox.yml`. |
| `ORIGIN` | Privada (adaptador) | Al arrancar | Sí detrás de proxy | Origen público para `adapter-node`. En Proxmox, `https://app.cotransmeq.com`. |
| `HOST`, `PORT`, `BODY_SIZE_LIMIT` | Privadas (adaptador) | Al arrancar | Fijadas en el Dockerfile | `0.0.0.0`, `3000` y `20M` (tamaño máximo del cuerpo de una petición). |
| `NODE_ENV` | Privada | Al arrancar | Fijada en el Dockerfile | `production`; es también el entorno por defecto de Sentry en el servidor. |
| `DEPLOY_TARGET` | Compilación | Al compilar | Solo para Docker | `node` elige `adapter-node`; cualquier otro valor, `adapter-vercel` ([svelte.config.js](../svelte.config.js)). |
| `NODE_OPTIONS` | Compilación | Al compilar | — | El Dockerfile da 4096 MB a `vite build`; el job de CI da 6144 MB a `svelte-check`. |

Las de la recuperación de contraseña se leen en cada petición, no al arrancar.
Sin el secreto de firma o sin las de Resend, pedir el enlace responde 503 «no
está configurada en este entorno»; sin `PASSWORD_RECOVERY_SERVICE_TOKEN` el
correo sale, pero guardar la contraseña nueva responde 503.

### Trampas

- **`VITE_API_URL` con `/api` al final rompe todo**: las rutas saldrían como
  `/api/api/...` y Socket.IO tomaría `/api` como espacio de nombres. El
  `.env.example` ya trae el origen sin sufijo (hasta el 11-oct-2026 traía
  `http://localhost:4000/api`).
- **El `.env.example` está incompleto.** Solo trae Mapbox, `VITE_API_URL`,
  `VITE_SOCKET_URL` y las de Sentry. Faltan `BACKEND_INTERNAL_URL`,
  `HERE_MAPS_API_KEY`, `AZURE_MAPS_KEY`, las cuatro de recuperación,
  `APP_PUBLIC_URL` y `EMAIL_LOGO_URL`, que el código lee igual.
- **Mapas sin claves en producción.** `compose.proxmox.yml` no pasa
  `HERE_MAPS_API_KEY` ni `AZURE_MAPS_KEY` al contenedor: el buscador de lugares
  solo devuelve los propios, con «HERE_MAPS_API_KEY no configurada en el
  servidor» en la respuesta. Falla sin ruido al arrancar.
- **`VITE_DISTRACOM_ICON_URL` vacía.** El Dockerfile declara el `ARG` y, si el
  build no lo recibe, Vite lo deja en cadena vacía. El detalle de servicio y el
  servicio compartido usan `??`, que no trata la cadena vacía como ausente: el
  ícono queda con `src=""`. Su valor por defecto, además, apunta al bucket de S3
  de Transmeralda, y `static/assets/` no tiene copia local del surtidor.
- **Una variable de runtime no llega al contenedor solo por estar en el archivo
  de entorno del servidor.** `compose.proxmox.yml` pasa al contenedor únicamente
  las que lista en `environment`; el `--env-file` solo sirve para rellenar los
  `${...}`. Hoy no están listadas las de Sentry ni `EMAIL_LOGO_URL`, así que
  ponerlas en `/etc/cotransmeq/frontend-runtime.env` no las activa, aunque
  `.env.example` diga lo contrario. Hay que añadirlas a `compose.proxmox.yml`.
- **`ADDRESS_HEADER` no está definida.** Sin ella, `getClientAddress()` de
  `adapter-node` devuelve la dirección de quien abre la conexión, que en Proxmox
  es el túnel o el puente de Docker, no el usuario. Los frenos por IP de la
  recuperación de contraseña cuentan entonces a todos los usuarios juntos.

## Lo que ya no se usa

- [env.d.ts](../src/env.d.ts) tipa `VITE_AWS_*`, `VITE_GOOGLE_MAPS_API_KEY`,
  `VITE_WIALON_API_TOKEN`, `VITE_AUTH_SYSTEM`, `VITE_EMPRESAS_SYSTEM`,
  `VITE_CONDUCTORES_SYSTEM` y `VITE_FLOTA_SYSTEM`, que nadie usa. No las
  revivas: una `VITE_AWS_SECRET_*` acabaría en el bundle.
- `VERCEL_DEPLOY.md` habla de `PUBLIC_API_URL`, que el código no lee.

## Entorno local

1. Copia [.env.example](../.env.example) a `.env` y añade
   `BACKEND_INTERNAL_URL`. El backend de Cotransmeq corre en local en el 4000,
   el puerto del ejemplo.
2. Para mapas, una `VITE_MAPBOX_ACCESS_TOKEN` pública y, si hace falta la
   búsqueda de lugares, `HERE_MAPS_API_KEY`.
3. Para probar la recuperación de contraseña, las cuatro variables de
   recuperación y el mismo `PASSWORD_RECOVERY_SERVICE_TOKEN` en el backend.
4. `npm run dev` levanta Vite en el 5173 o, si está ocupado, en el 5174. El
   backend tiene que aceptar ese origen en su CORS (`FRONTEND_URL`,
   `SOCKET_CORS_ORIGINS`); mira en el log en qué puerto arrancó.

Tras cambiar el `.env`, reinicia el servidor de desarrollo.

## Diferencias con Transmeralda

- Su `.env.example` trae además `HERE_MAPS_API_KEY`, `BACKEND_INTERNAL_URL`,
  las variables de recuperación y unas `AWS_*` que el código no lee.
- Allí el backend local corre en el 4100 y el front en el 5273 fijo.
- Su `compose.proxmox.yml` sí pasa las claves de HERE y Azure.
- Allí el detalle de servicio ya usa `||` y un surtidor local
  (`/assets/map/surtidor.png`); solo el servicio compartido conserva `??`.
- Sus variables de producción salen de GitHub (vars y secrets) y el workflow
  falla si falta alguna obligatoria; aquí viven en
  `/etc/cotransmeq/frontend-build.env` y `/etc/cotransmeq/frontend-runtime.env`
  del servidor, y lo único que frena la compilación es el `set -u` del script
  si faltan `VITE_API_URL` o `VITE_SOCKET_URL`.
