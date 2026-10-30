# Despliegue

Cómo se construye la imagen del frontend, cómo llega a producción, qué hace el
script del servidor si algo falla y qué comprobar después. Léelo antes de
cambiar el `Dockerfile`, `compose.proxmox.yml`, el workflow o una variable de
entorno de producción, y cuando un despliegue se quede a medias. Las variables
están explicadas en [variables-de-entorno.md](./variables-de-entorno.md).

## Qué está vigente

**Producción corre en Proxmox**, en el contenedor LXC CT123, como una imagen de
Docker con `adapter-node` detrás de Cloudflare Tunnel, y se despliega sola con
cada push a `main` desde [deploy-proxmox.yml](../.github/workflows/deploy-proxmox.yml).
Lo respaldan el workflow, [compose.proxmox.yml](../compose.proxmox.yml)
(`ORIGIN: https://app.cotransmeq.com`), [ops/deploy-proxmox.sh](../ops/deploy-proxmox.sh)
y [DEPLOY_PROXMOX.md](../DEPLOY_PROXMOX.md).

**Vercel queda como configuración de respaldo.** [svelte.config.js](../svelte.config.js)
sigue eligiendo `adapter-vercel` por defecto («para conservar el rollback»),
pero este repo no tiene `vercel.json`. Desde el repositorio no se puede saber si
Vercel sigue compilando cada push: eso depende de la integración con GitHub
configurada en Vercel, que no está aquí. [VERCEL_DEPLOY.md](../VERCEL_DEPLOY.md)
está desactualizado (habla de `PUBLIC_API_URL` y de un backend en Railway).

## La imagen

[Dockerfile](../Dockerfile), en cuatro etapas sobre `node:22-bookworm-slim`
(idéntico al de Transmeralda):

| Etapa | Qué hace |
|---|---|
| `dependencies` | `npm ci` con `package.json` y `package-lock.json`. |
| `build` | Recibe `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_MAPBOX_ACCESS_TOKEN` y `VITE_DISTRACOM_ICON_URL` como `ARG`, fija `DEPLOY_TARGET=node` (elige `adapter-node`) y `NODE_OPTIONS=--max-old-space-size=4096`, y corre `npm run build`. |
| `production-dependencies` | `npm ci --omit=dev`: el servidor de Node carga desde `node_modules` las dependencias de producción. |
| `runtime` | Copia `node_modules` y `build/`, corre como el usuario `node` con `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000` y `BODY_SIZE_LIMIT=20M`, expone el 3000 y arranca con `node build`. |

El `HEALTHCHECK` pide `http://127.0.0.1:3000/login` cada 30 s (5 s de espera,
20 s de gracia al arrancar, 3 reintentos). `.dockerignore` deja fuera
`node_modules`, `.svelte-kit`, `build`, `.git` y todos los `.env*` salvo
`.env.example`: las `VITE_*` solo entran como `--build-arg`.

## El contenedor

[compose.proxmox.yml](../compose.proxmox.yml) define el servicio `frontend`:

- Imagen `frontend-cotransmeq:production`, contenedor `frontend-cotransmeq`,
  `restart: unless-stopped`, límites de 1 CPU, 1 GB de memoria y 512 procesos.
- Publica solo `127.0.0.1:3002:3000`: el único punto de entrada público es
  Cloudflare Tunnel.
- Se une a la red externa `backend-cotransmeq_default` para llegar al backend
  como `http://backend-cotransmeq-nest:4000` (`BACKEND_INTERNAL_URL`).
- Pasa al contenedor `ORIGIN`, `APP_PUBLIC_URL`, `BACKEND_INTERNAL_URL`,
  `PASSWORD_RECOVERY_SECRET`, `PASSWORD_RECOVERY_SERVICE_TOKEN`,
  `RESEND_API_KEY` y `RESEND_FROM`. **No pasa `HERE_MAPS_API_KEY` ni
  `AZURE_MAPS_KEY`**: en producción el buscador de lugares solo devuelve los
  lugares propios.
- Los valores por defecto de las `VITE_*` en el bloque `build` apuntan a
  `https://api-cotransmeq.transmeralda.com`, pero el script del servidor pasa
  sus propios `--build-arg`.

**Solo llegan al contenedor las variables listadas en `environment`.** El
`--env-file` con que se arranca solo rellena los `${...}` del archivo. Para
activar Sentry (`PUBLIC_SENTRY_DSN`, `SENTRY_DSN`…), `EMAIL_LOGO_URL` o las
claves de mapas hay que añadirlas aquí; ponerlas solo en el archivo de entorno
del servidor no hace nada. Tampoco se define `ADDRESS_HEADER`, lo que afecta a
los frenos por IP (ver [variables-de-entorno.md](./variables-de-entorno.md#trampas)).

## Seguridad del navegador

El frontend aplica CSP desde `svelte.config.js`: SvelteKit genera nonces para
las páginas dinámicas y hashes para las prerenderizadas. La política permite
los orígenes usados por la API, Socket.IO, Iconify, mapas y almacenamiento de
archivos. En desarrollo permite `localhost` y `127.0.0.1` para el backend:
CSP compara esos hosts literalmente. Esas entradas se omiten en producción y
en el despliegue `node`. Así se protegen scripts sin bloquear los SVG, imágenes
ni workers que usa la app. `hooks.server.ts` añade HSTS y las cabeceras de tipo,
framing, referer y permisos a las respuestas de la aplicación. Cloudflare fuerza
HTTPS
para `app.cotransmeq.com` con una regla que conserva ruta y consulta.

En producción Vite elimina las llamadas de la app a `console.log`, `console.info`,
`console.debug` y `console.warn`; `console.error` sigue disponible para errores.

## El workflow

[.github/workflows/deploy-proxmox.yml](../.github/workflows/deploy-proxmox.yml)
corre con cada push a `main` y a mano (`workflow_dispatch`). El grupo de
concurrencia `cotransmeq-app-production` no cancela un despliegue en curso: el
siguiente espera.

**Job `verificar` (Tipos, `svelte-check`).** En `ubuntu-latest`, con Node 22:
`npm ci`, `svelte-kit sync` y `svelte-check --tsconfig ./tsconfig.json
--threshold error`, con 6 GB para Node. Corre en un runner de GitHub y no en el
servidor para no quitarle CPU y memoria a producción. Si encuentra un solo error
de tipos, `deploy` no arranca y la versión viva no se toca. Los avisos no
bloquean; los errores sí, así que el repo tiene que quedar en cero errores.

**Job `deploy`.** Necesita `verificar`. Corre en el runner propio del servidor
(etiquetas `self-hosted, linux, x64, cotransmeq-ct123, cotransmeq-app`), en el
entorno `production` de GitHub y con 90 minutos de límite. Hace checkout del
commit exacto y llama a `sudo /usr/local/sbin/deploy-cotransmeq-app <sha>`. No
pasa ninguna variable desde GitHub: la compilación y el runtime salen de
archivos del servidor.

| Archivo del servidor | Qué lleva |
|---|---|
| `/etc/cotransmeq/frontend-build.env` | `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_MAPBOX_ACCESS_TOKEN`, `VITE_DISTRACOM_ICON_URL` |
| `/etc/cotransmeq/frontend-runtime.env` | Los valores con que se rellenan los `${...}` de `compose.proxmox.yml` (recuperación de contraseña y Resend) |

Una variable nueva de producción va en dos sitios: el archivo del servidor y la
sección `environment` de `compose.proxmox.yml`.

## El script del servidor

El workflow ejecuta `/usr/local/sbin/deploy-cotransmeq-app`; la versión
versionada es [ops/deploy-proxmox.sh](../ops/deploy-proxmox.sh). Desde el repo no
se puede comprobar que la copia instalada sea idéntica: si cambias el script,
hay que reinstalarlo en el servidor.

1. Valida que el SHA tenga 40 caracteres hexadecimales y que el checkout del
   runner esté en ese commit.
2. Exige el lock global montado en `/mnt/proxmox-deploy-lock` y espera turno con
   `flock` hasta 60 minutos: los cuatro despliegues que comparten el host
   Proxmox compilan de uno en uno.
3. Carga `/etc/cotransmeq/frontend-build.env` (con `set -u`, si faltan
   `VITE_API_URL` o `VITE_SOCKET_URL` el script se detiene), recuerda la imagen
   que está corriendo y construye `frontend-cotransmeq:<sha>` con la etiqueta
   `com.cotransmeq.git-sha`; luego la etiqueta como `:production`.
4. Recrea solo el servicio `frontend` (`docker compose --project-name
   cotransmeq-app --env-file /etc/cotransmeq/frontend-runtime.env up -d
   --no-deps --force-recreate`).
5. Espera hasta 120 s a que el contenedor esté `healthy` y pide
   `http://127.0.0.1:3002/login`.
6. Si algo de eso falla, vuelve a etiquetar la imagen anterior como
   `:production`, levanta el contenedor con el mismo archivo de runtime y
   termina con error.

| Código de salida | Motivo |
|---|---|
| 64 | El SHA recibido no es válido. |
| 65 | El checkout no coincide con el commit pedido. |
| 75 | No consiguió el turno de compilación en 60 minutos. |
| 78 | El lock global no está montado. |
| 1 | El contenedor nuevo no pasó el healthcheck (se restauró el anterior), o falló un comando, por ejemplo porque falta el archivo de entorno. |

El script no borra imágenes antiguas: cada despliegue deja una
`frontend-cotransmeq:<sha>`.

**Rollback manual** ([DEPLOY_PROXMOX.md](../DEPLOY_PROXMOX.md)): etiquetar la
imagen anterior como `frontend-cotransmeq:production` y ejecutar
`docker compose -f compose.proxmox.yml up -d` con el archivo de entorno del
servidor.

## Vercel

Si algún día se vuelve a Vercel:

- El build sin `DEPLOY_TARGET` usa `adapter-vercel`. Las `VITE_*` se configuran
  en Vercel para el build y las de `$env/dynamic/*` para el runtime.
- Este repo no tiene `vercel.json` (Transmeralda sí: cabeceras de caché para
  `/_app/immutable/*` y `nosniff`). En la imagen de Node, los archivos de
  `/_app/immutable/` los sirve `adapter-node` con caché de un año.
- Los frenos de intentos y la lista de enlaces consumidos de la recuperación de
  contraseña son memoria de cada instancia; en Vercel hay varias.
- El marcador `BUILD_MARKER` de [hooks.client.ts](../src/hooks.client.ts) se
  cambia a mano para forzar nombres de chunk nuevos cuando la caché del borde
  sirve versiones viejas.

## Lista de comprobación después de desplegar

1. En GitHub Actions, los dos jobs en verde; el log de `deploy` termina en
   «Despliegue de cotransmeq-app completado en `<sha>`».
2. En CT123, `docker ps` muestra `frontend-cotransmeq` como `healthy`, y
   `docker inspect` muestra en sus etiquetas `com.cotransmeq.git-sha` con el
   commit desplegado.
3. `https://app.cotransmeq.com/login` carga y se puede entrar; `/dashboard`
   pinta la barra lateral con los módulos del usuario y la paleta naranja.
4. En la pestaña Red del navegador, las peticiones van a
   `https://api-cotransmeq.transmeralda.com` y no a `localhost:4000`: las
   `VITE_*` del archivo del servidor llegaron al build.
5. No aparece el aviso «Reconectando» ni «Sin conexión», y un canvas
   (`/dashboard/nomina/canvas`, por ejemplo) abre y muestra la presencia: Socket.IO,
   `VITE_SOCKET_URL` y el worker de fórmulas de Univer funcionan.
6. El buscador de lugares (en el modal de un servicio o de un recargo) devuelve
   los lugares propios. Mientras no haya claves de HERE en `compose.proxmox.yml`,
   el aviso «HERE_MAPS_API_KEY no configurada» es lo esperado.
7. `/recuperar-password` con un correo cualquiera responde el mensaje neutro y
   no «no está configurada en este entorno».
8. El portal `/public/portal` carga y, con sesión, `/public/portal/formularios`
   abre en modo avión tras una visita con red (service worker nuevo).
9. Una pestaña abierta antes del despliegue se recupera sola al navegar (recarga
   por chunk viejo, como mucho una vez por sesión).
10. Si Sentry está configurado (en `compose.proxmox.yml`), los errores llegan.
11. Si el despliegue falló, el script ya restauró la imagen anterior: revisa
    `docker logs frontend-cotransmeq` y el log del job antes de reintentar.

## Diferencias con Transmeralda

- Corre en CT121, con el runner `self-hosted, linux, x64, transmeralda-ct121,
  ingreso-svelte` y el grupo de concurrencia `ingreso-svelte-production`.
- Su job `deploy` arma los archivos de entorno con las `vars` y los `secrets`
  de GitHub (y falla si falta alguna obligatoria) y se los pasa al script; el
  rollback usa `/etc/transmeralda/frontend-runtime.env`. Su script comprueba
  además que los archivos de entorno existan (código 66).
- Imagen `frontend-transmeralda`, proyecto `ingreso-svelte`, red
  `backend-nest_default`, backend interno `http://backend-nest:4000`, dominio
  `https://app.transmeralda.com` y API `https://api.transmeralda.com`.
- Su `compose.proxmox.yml` sí pasa `HERE_MAPS_API_KEY` y `AZURE_MAPS_KEY`.
- Tiene `vercel.json`.
