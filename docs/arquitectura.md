# Arquitectura del frontend

Cómo está montado `cotransmeq-app`: el stack, para qué sirve cada carpeta de
`src/`, las tres zonas de la aplicación y sus layouts, los hooks, el service
worker, las rutas de servidor propias y cómo se decide qué se renderiza en el
servidor. Léelo antes de crear una ruta, mover una pantalla de zona o tocar
algo que se ejecute fuera del navegador. El inventario de pantallas está en
[rutas-y-pantallas.md](./rutas-y-pantallas.md) y la sesión y los permisos en
[autenticacion-y-permisos.md](./autenticacion-y-permisos.md).

## Stack

Rangos declarados en [package.json](../package.json) y versión fijada en
`package-lock.json` a 11-oct-2026.

| Pieza | Declarada | Fijada | Notas |
|---|---|---|---|
| SvelteKit (`@sveltejs/kit`) | `^2.43.2` | 2.70.1 | |
| Svelte | `^5.39.5` | 5.56.7 | Runes; queda código en sintaxis legacy (ver Convenciones). |
| Vite | `^7.1.7` | 7.3.6 | Configuración en [vite.config.ts](../vite.config.ts). |
| TypeScript | `^5.9.2` | 5.9.3 | `strict`, `checkJs`; extiende el `tsconfig` que genera SvelteKit. |
| Tailwind CSS | `^4.1.13` | 4.3.3 | Vía `@tailwindcss/vite`; sin `tailwind.config`: el tema vive en `@theme` de [app.css](../src/app.css), donde los `emerald-*` y `green-*` se remapean al naranja de la marca. |
| `@sveltejs/adapter-node` / `adapter-vercel` | `^5.3.2` / `^6.2.0` | 5.5.7 / 6.3.4 | El build elige uno (ver [despliegue.md](./despliegue.md)). |
| axios | `^1.12.2` | 1.18.1 | Cliente HTTP del dashboard ([cliente-api.md](./cliente-api.md)). |
| socket.io-client | `^4.8.1` | 4.8.3 | Tiempo real ([tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md)). |
| Univer (`@univerjs/*`) | `^0.25.1` | 0.25.1 | Las hojas tipo Excel ([canvas-univer.md](./canvas-univer.md)). |
| mapbox-gl | `^3.17.0` | 3.26.0 | Mapas de servicios. |
| pdfmake, exceljs, chart.js, signature_pad, qrcode | | | Documentos, exportaciones, gráficas, firmas ([documentos-y-pdf.md](./documentos-y-pdf.md)). |
| `@sentry/sveltekit` | `^11.6.0` | 11.6.0 | Opcional, se carga solo con DSN. |
| Vitest | `^4.1.11` | 4.1.11 | [pruebas-y-calidad.md](./pruebas-y-calidad.md). Este repo no tiene Playwright. |

Node 22: es la imagen de Docker (`node:22-bookworm-slim`) y la versión del job
de CI. Gestor de paquetes: npm, con `engine-strict=true` en `.npmrc`.

Hay dependencias declaradas que hoy no importa ningún archivo de `src/`:
`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@azure/storage-blob`,
`html-to-image`, `jsonwebtoken` (solo aparece en un comentario) y
`@tailwindcss/forms` (no se carga con `@plugin` en `app.css`). Antes de usarlas,
recuerda que el navegador no debe tener credenciales de nube: las subidas van a
URLs firmadas por el backend.

## Estructura de `src/`

| Ruta | Qué hay |
|---|---|
| [app.html](../src/app.html) | Plantilla HTML. `lang="es" translate="no"` y `<meta name="google" content="notranslate">`: el traductor del navegador reescribe el DOM y rompe la hidratación. `data-sveltekit-preload-data="hover"`. |
| [app.css](../src/app.css) | Tailwind, estilos de Univer, tokens de color (`@theme`) y las clases compartidas (`dir-*`, botones). Ver [componentes-y-estilos.md](./componentes-y-estilos.md). |
| [app.d.ts](../src/app.d.ts), [env.d.ts](../src/env.d.ts), `pdfmake.d.ts` | Tipos globales: `App.Locals`, `import.meta.env`, pdfmake. |
| [hooks.server.ts](../src/hooks.server.ts) | Guardia de `/dashboard` y Sentry del servidor. |
| [hooks.client.ts](../src/hooks.client.ts) | Recuperación de chunks viejos y Sentry del navegador. |
| [service-worker.ts](../src/service-worker.ts) | Caché del portal offline y avisos Web Push. |
| `routes/` | Páginas, layouts y las rutas de servidor `routes/api/**`. |
| `lib/api/` | Un cliente por dominio del backend; [apiClient.ts](../src/lib/api/apiClient.ts) es la instancia de axios con token, reintentos y deduplicación. |
| `lib/stores/` | Stores de Svelte: sesión ([auth.ts](../src/lib/stores/auth.ts)), portal ([portalStore.ts](../src/lib/stores/portalStore.ts)), toasts, confirmaciones, cachés. Ver [estado-y-stores.md](./estado-y-stores.md). |
| `lib/components/` | Componentes, agrupados por dominio (`servicios/`, `nomina/`, `univer/`…) más los comunes (`ui/`, `listing/`, `common/`, `auth/`). |
| `lib/config/` | [permissions.ts](../src/lib/config/permissions.ts) (espejo del mapa del backend), [menu.ts](../src/lib/config/menu.ts) (entradas del sidebar) y etiquetas de enums. |
| `lib/editor/` | Motor de los canvas de Univer: `builders/` (datos → libro), `business/` (reglas de celda), `canvas/` (sesión, cola de escritura, autoguardado), `univer/` (engines, permisos de celda, plugins, worker de fórmulas). |
| `lib/listing/` | Núcleo de listados con el estado en la URL. Ver [listados-y-filtros.md](./listados-y-filtros.md). |
| `lib/offline/` | IndexedDB, outbox y socket del portal del conductor. Ver [portal-del-conductor.md](./portal-del-conductor.md). |
| `lib/formularios/` | Estado del constructor y del runner de formularios dinámicos, reglas y validación. |
| `lib/server/` | Código **solo de servidor** (SvelteKit impide importarlo desde el navegador): recuperación de contraseña y plantilla de su correo. |
| `lib/recuperacion/` | Reglas de contraseña compartidas por la página y la ruta de servidor. |
| `lib/notificaciones/` | Web Push y la ruta a la que lleva cada notificación (la usan el Header y el service worker). |
| `lib/dashboard/`, `lib/guias/`, `lib/incidentes/`, `lib/liquidaciones/`, `lib/pagos/`, `lib/asistencias/`, `lib/sarlaft/`, `lib/acciones-correctivas/` | Utilidades de un dominio concreto (periodo del panel, motor de guías, medios de pago espejo del backend…). |
| `lib/utils/` | Utilidades transversales: PDF (pdfmake), fechas, festivos, mensajes de error de la API, cálculo de recargos. |
| `lib/styles/pdf-tokens.ts` | Tokens del PDF de terceros, espejo exacto del backend. |
| `lib/types/`, `lib/data/`, `lib/assets/` | Tipos compartidos, datos estáticos (estaciones Distracom) e imágenes que pasan por Vite (logo, firma). |
| [socket.ts](../src/lib/socket.ts) y [socketClient.ts](../src/lib/socketClient.ts) | Los dos clientes de Socket.IO: el general del dashboard y el de colaboración en canvas y chat. |

`static/` se sirve tal cual: logotipos de Cotransmeq en `static/assets/`
(`logo_nombre.webp`, `logo_nombre_white.webp`, `logo.webp`; la tabla de
equivalencias con los del gemelo está en [AGENTS.md](../AGENTS.md)), la mascota
en `static/mascot/`, iconos y `site.webmanifest` (con `start_url: "/"`).

Hay archivos que no son lo que parecen y conviene no tomar como modelo:
[lib/utils/permisos.ts](../src/lib/utils/permisos.ts) está vacío,
`lib/components/Login.svelte` y `lib/components/Dashboard.svelte` no los importa
nadie, `lib/data/acciones-fake.ts` tampoco, y quedan copias sueltas
(`*.bak`, `*.tmp`) dentro de `src/`.

## Las tres zonas

La aplicación son tres superficies con reglas distintas de sesión, layout y
renderizado. Saber en cuál cae una ruta decide casi todo lo demás.

| Zona | Rutas | Sesión | Layout | SSR |
|---|---|---|---|---|
| Dashboard | `/dashboard/**` | JWT administrativo (`transmeralda_token`, nombre heredado), guardia en servidor y en cliente | Barra lateral + cabecera | Sí, pero solo pinta el cargador hasta que hidrata la sesión |
| Portal del conductor | `/public/portal/**` | Token del enlace mágico (`cotransmeq_portal_token`), sin guardia de servidor | Barra superior + menú del portal | No (`ssr = false`) |
| Páginas públicas sueltas | `/`, `/login`, `/recuperar-password/**`, `/invite/[token]`, `/asistencia/[token]`, `/evaluaciones/[id]`, `/presentacion`, `/test-municipios` y el resto de `/public/*` | Ninguna, o un token propio en la URL | El raíz (y el de `/public` para las de `/public/*`) | Sí fuera de `/public`; no dentro |

El layout raíz llama a `authStore.init()` en todas las rutas que no empiezan por
`/public`. Eso incluye `/asistencia/[token]`, `/evaluaciones/[id]` e
`/invite/[token]`: si el navegador conserva un token administrativo vencido, el
401 del perfil hace que el interceptor de `apiClient` mande a `/login` también
desde esas páginas. Una página pública nueva que no deba pasar por eso va bajo
`/public/`.

## Layouts

| Archivo | Cubre | Qué hace |
|---|---|---|
| [routes/+layout.svelte](../src/routes/+layout.svelte) | Todo | Importa `app.css`, monta un único `ToastProvider`, `Tooltip` y `ConfirmHost`, e inicia la sesión fuera de `/public`. |
| [routes/dashboard/+layout.svelte](../src/routes/dashboard/+layout.svelte) | `/dashboard/**` | Sidebar, Header, asistente de IA, guardia de cliente por módulo, revisión de caducidad del token cada 60 s, modal de sesión cerrada por un administrador (evento `sesion-cerrada` del socket) y aviso de reconexión. Envuelve la página en `{#key $page.url.pathname}` para que pasar de `/x/A` a `/x/B` remonte la página. |
| [dashboard/servicios/[id]/+layout.svelte](<../src/routes/dashboard/servicios/[id]/+layout.svelte>) | Detalle de servicio | Vuelve a iniciar la sesión y conecta el socket si no lo está. Hereda el layout del dashboard. |
| Nueve `+layout@.svelte` de canvas | Ver tabla siguiente | Se saltan el layout del dashboard. |
| [routes/public/+layout.svelte](../src/routes/public/+layout.svelte) + `+layout.ts` | `/public/**` | Contenedor `.public-shell`, `noindex` y `ssr = false` para toda la zona. |
| [routes/public/portal/+layout.svelte](../src/routes/public/portal/+layout.svelte) + `+layout.ts` | `/public/portal/**` | Sin sesión pinta solo la página (el login); con sesión, barra superior y menú. Arranca la outbox al iniciar sesión y adopta un service worker nuevo tras 30 s sin interacción. |

### Los canvas escapan del layout del dashboard

El `@` de `+layout@.svelte` reinicia la cadena de layouts en el raíz. Los canvas
lo necesitan porque el `<main>` del dashboard no propaga la altura: dentro de
él, Univer se monta con 0 px de alto o queda recortado. El precio es perder el
guardia del layout del dashboard, y por eso cada uno de estos layouts envuelve
la página en [UniverAuthGuard](../src/lib/components/univer/UniverAuthGuard.svelte)
(inicia la sesión, comprueba el módulo, revisa la caducidad cada 60 s y retiene
a los hijos hasta que la sesión está hidratada), en `UniverShell` (cabecera fija
y un `main` que ocupa el resto del viewport) y monta `AsistenteCanvas`.

| Ruta | `moduleId` del guardia |
|---|---|
| `dashboard/conductores/recorridos` | `recorridos` |
| `dashboard/liquidaciones-servicios/canvas` | `liquidaciones-servicios` |
| `dashboard/liquidaciones-terceros/canvas` | `liquidaciones-terceros` |
| `dashboard/liquidaciones-terceros/adicionales/canvas` | `liquidaciones-terceros-adicionales` |
| `dashboard/liquidaciones-terceros/ingresos/canvas` | `liquidaciones-terceros` |
| `dashboard/liquidaciones-terceros/ocasional/canvas` | `liquidaciones-terceros` |
| `dashboard/nomina/canvas` | `nomina` |
| `dashboard/nomina/primas/canvas` | `nomina` |
| `dashboard/nomina/analisis/canvas` | `nomina` |

`UniverAuthGuard` no escucha el evento `sesion-cerrada`: en un canvas, cerrar la
sesión desde administración no muestra el modal; el usuario se entera en la
siguiente petición rechazada. Si añades un canvas, copia uno de estos layouts y
usa un `moduleId` que exista en `permissions.ts`: `checkAccess` deniega
cualquier módulo desconocido.

Dos páginas del portal usan `+page@public.svelte`, que se queda con el layout de
`/public` y se salta el del portal: son hojas para imprimir o para que las abra
Puppeteer desde el backend, no pantallas para navegar.

## SSR, CSR y `+page.ts`

No hay `+layout.ts` en la raíz, así que rigen los valores por defecto de
SvelteKit: SSR activado, CSR activado, sin prerender.

- **Dashboard.** Se renderiza en el servidor, pero el layout solo pinta el
  cargador (`{#if mounted && user}`), así que la página no se instancia en SSR.
  Sus módulos sí se importan en Node: lo que toque `window` al importarse rompe
  la ruta. Por eso declaran `ssr = false` los canvas (Univer usa WebGL, `window`
  y workers; sin esa línea la ruta ni compila), los de primas y análisis
  (chart.js toca `window` al montar) y `nomina/agregar`.
- **`/public/**`.** `ssr = false` en [public/+layout.ts](../src/routes/public/+layout.ts):
  los datos se piden con tokens que viven en `localStorage`, que el servidor no
  tiene. Las dos páginas `@public` lo repiten en su `+page.ts` porque rompen la
  cadena de layouts y no conviene depender de la herencia.
- **Redirecciones.** Varias rutas antiguas son un `+page.ts` con `redirect()`
  (nómina, liquidaciones de terceros, envíos de formularios, sesiones, altas de
  clientes y conductores). Son universales a propósito: en una navegación de
  cliente no hacen ida y vuelta al servidor. La lista está en
  [rutas-y-pantallas.md](./rutas-y-pantallas.md#redirecciones).
- **Sin `+page.server.ts` ni `+layout.server.ts`.** Todos los datos se piden
  desde el navegador. Consecuencia: en navegación de cliente `hooks.server.ts`
  no vuelve a correr; el guardia de servidor solo actúa en cargas completas.

## Hooks

**[hooks.server.ts](../src/hooks.server.ts).** El `handle` protege `/dashboard`:
lee el JWT de la cookie (o de `Authorization`), lo decodifica, comprueba el
módulo del primer segmento de la ruta con `checkAccess` y redirige al login
conservando la consulta. El detalle y sus trampas están en
[autenticacion-y-permisos.md](./autenticacion-y-permisos.md#el-guardia-del-servidor).
`handleError` deja el error en el log y, si hay `SENTRY_DSN`, reporta los 5xx a
Sentry sin cookies, cabeceras, cuerpos ni query.

**[hooks.client.ts](../src/hooks.client.ts).** Tras un despliegue, una pestaña
abierta pide chunks que ya no existen («Failed to fetch dynamically imported
module»). El hook recarga la página con `?_r=<timestamp>` una sola vez por
sesión (contador en `sessionStorage`) y no hace nada en desarrollo. Con
`PUBLIC_SENTRY_DSN` carga Sentry de forma dinámica (sin DSN el navegador ni
descarga el SDK) e ignora esos errores de chunk.

## Service worker

[service-worker.ts](../src/service-worker.ts) lo registra SvelteKit solo (no hay
`navigator.serviceWorker.register` en el código) y controla todo el origen,
aunque está pensado para el portal:

- Precarga los assets del build y `static/` (menos los `.map`) y los sirve
  cache-first: llevan hash en el nombre.
- Las navegaciones a `/public/portal`, `/public/portal/formularios`,
  `/public/portal/desprendibles`, `/public/portal/servicios` y
  `/public/portal/dias-laborados` (y sus subrutas) van stale-while-revalidate;
  sin caché ni red devuelve el shell de formularios o una página «Sin
  conexión». `/public/portal/viaticos` no está en esa lista y no abre sin red.
- No toca peticiones que no sean `GET`, de otro origen, bajo `/api/`, con
  `token` en la query ni URLs firmadas de S3 (`X-Amz-*`): simular un envío
  offline mentiría al conductor y cachear una URL firmada guarda una credencial.
- Las cachés se llaman `cotransmeq-assets-<version>` y
  `cotransmeq-shell-<version>`; al activar se borran las de versiones
  anteriores y hace `skipWaiting` para no esperar a que se cierre la pestaña.
- Recibe los Web Push de la campana del dashboard y los muestra salvo que haya
  una pestaña del dashboard con el foco; al pulsar el aviso enfoca la app o abre
  la ruta de la notificación.

Lo que hace el portal sin red está en [portal-del-conductor.md](./portal-del-conductor.md)
y los avisos en [tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md).

## Rutas de servidor propias

La API de negocio es el backend. SvelteKit solo expone, en el mismo origen que
la app, lo que necesita una clave que el navegador no puede ver o una firma que
el navegador no puede hacer:

| Ruta | Método | Para qué | Autenticación |
|---|---|---|---|
| [api/maps/autocomplete](../src/routes/api/maps/autocomplete/+server.ts) | GET | Sugerencias de lugares: primero los propios (`custom_places` del backend) y luego HERE Autocomplete, sin duplicar por nombre. | El token (cabecera o cookie) solo se reenvía para los lugares propios; los de HERE salen sin sesión. |
| [api/maps/lookup](../src/routes/api/maps/lookup/+server.ts) | GET | Coordenadas de una sugerencia: `local:cp:<uuid>` va al backend, el resto a HERE Lookup. | Igual que la anterior. |
| [api/maps/custom-place](../src/routes/api/maps/custom-place/+server.ts) | POST | Guarda un lugar propio en el backend y devuelve su id con prefijo `local:cp:`. | Exige token; responde 401 sin él. |
| [api/maps/place](../src/routes/api/maps/place/+server.ts) | GET | Geocodificación inversa con Azure Maps. | Ninguna. Ningún archivo del front la llama hoy. |
| [api/auth/recuperar-password](../src/routes/api/auth/recuperar-password/+server.ts) | POST | Firma el enlace de recuperación y lo manda por Resend. | Pública, con freno por correo y por IP. |
| [api/auth/recuperar-password/[token]](<../src/routes/api/auth/recuperar-password/[token]/+server.ts>) | GET, POST | Valida el enlace y aplica la contraseña nueva vía backend. | Pública, firma HMAC y freno por IP. |

Por qué existen y no van al backend: las claves de HERE, Azure, Resend y el
secreto de firma son `$env/dynamic/private` y nunca llegan al bundle. El backend
tiene su propio módulo `maps` con el mismo proxy, pero es para la app móvil:
`MapboxSearch.svelte` llama a estas rutas con URL relativa. Las rutas de mapas
leen el token de la cabecera `Authorization` antes que de la cookie porque la
cookie dura 7 días y la sesión más.

En producción, `compose.proxmox.yml` de este repo no pasa `HERE_MAPS_API_KEY` ni
`AZURE_MAPS_KEY`: las sugerencias solo traen lugares propios (con un `error` en
la respuesta) y `/api/maps/place` responde 500. Las de mapas sin autenticación,
además, permiten consumir la cuota de HERE y de Azure a cualquiera que conozca
la URL el día que tengan clave.

## Cómo se conectan las piezas

```
                           Navegador
   (dashboard /dashboard/**, portal /public/portal/**, páginas sueltas)
        |                   |                         |                |
        | páginas y assets  | /api/maps/*             | REST /api/**   | PUT a URL
        |                   | /api/auth/recuperar-*   | + Socket.IO    | firmada
        v                   v                         v                v
  +-------------------------------------+    +--------------------------------+  +----+
  | Servidor SvelteKit (adapter-node)   |    | backend-cotransmeq             |  | S3 |
  | hooks.server.ts: guardia /dashboard |    | api-cotransmeq.transmeralda.com|  +----+
  | src/routes/api/**: rutas propias    |    +--------------------------------+
  +-------------------------------------+                  ^
        |        |                                         |
        |        +---- BACKEND_INTERNAL_URL (red Docker) --+
        |
        +----> HERE, Azure Maps, Resend (claves solo en el servidor)
```

El navegador habla con el backend directamente, en otro origen
(`VITE_API_URL`), con el JWT en `Authorization`. El servidor de SvelteKit solo
llama al backend desde las rutas de mapas y de recuperación, por la red interna
de Docker (`BACKEND_INTERNAL_URL`). Las subidas de archivos van del navegador a
S3 con URLs que firma el backend, así que el bucket necesita CORS para el origen
de la app.

## Despliegue y adaptador

[svelte.config.js](../svelte.config.js) usa `adapter-node` cuando
`DEPLOY_TARGET=node` (lo fija el Dockerfile) y `adapter-vercel` en cualquier otro
caso, «para conservar el rollback». Producción corre en Proxmox con la imagen de
Node; el detalle, las variables y la comprobación posterior están en
[despliegue.md](./despliegue.md) y [variables-de-entorno.md](./variables-de-entorno.md).

[vite.config.ts](../vite.config.ts) fija dos cosas que no se tocan sin motivo:

- `worker.format: 'es'`: el worker de fórmulas de Univer hace code-splitting y el
  formato por defecto (`iife`) solo falla en `vite build`, no en desarrollo.
- `resolve.dedupe` y `optimizeDeps.include` de Univer y `@wendellhu/redi`: sin
  ellos Vite empaqueta dos copias y el motor protesta.

No fija puerto: `vite dev` arranca en el 5173 y, si está ocupado, en el 5174
sin más aviso que el log. El backend tiene que aceptar ese origen en su CORS.

## Convenciones

- **Svelte 5 con runes** (`$state`, `$derived`, `$props`, `$effect`) en todo
  componente nuevo. No hay `runes: true` global: cada componente está en un modo
  según la sintaxis que use, y alrededor de 90 de unos 370 `.svelte` siguen en
  legacy (`$:`, `export let`, `<slot>`, `on:click`), entre ellos el layout del
  dashboard, `Sidebar`, `Header` y el layout del portal. Se migran cuando se
  tocan. En código nuevo, `page` sale de `$app/state`; `$app/stores` queda en el
  legacy. Las trampas de runes están en [estado-y-stores.md](./estado-y-stores.md)
  y en [AGENTS.md](../AGENTS.md).
- **Comentarios en español que explican el porqué**: `/** */` para la interfaz de
  una función o componente, `///` para una nota pegada a la línea que la
  necesita. Lo valioso es el motivo y lo que se rompió antes.
- **Prettier** ([.prettierrc](../.prettierrc)): tabulaciones, comillas simples,
  sin coma final, ancho 100, con `prettier-plugin-svelte` y
  `prettier-plugin-tailwindcss` (ordena las clases). Aquí el plugin de Tailwind
  está fijado en 0.6.14 (0.7.4 en Transmeralda) y Prettier ha fallado en los
  `.svelte` de este repo con «getVisitorKeys is not a function»; si te pasa,
  formatea el archivo en `ingreso-svelte` y copia el resultado cambiando la
  marca. Hay archivos sin formatear, empezando por `package.json` (indentado con
  espacios).
- **Espejos del backend.** `lib/config/permissions.ts`, `lib/styles/pdf-tokens.ts`,
  `lib/pagos/medios.ts` y `lib/server/correo-plantilla.ts` copian archivos del
  backend. Un cambio en uno va en el otro, y en los dos repos gemelos.
- **Gemelo.** Todo cambio se aplica también en `ingreso-svelte`; ver
  [AGENTS.md](../AGENTS.md).

## Diferencias con Transmeralda

`ingreso-svelte` tiene la misma estructura y los mismos layouts, hooks y rutas
de servidor. Lo que cambia para este documento:

- Allí `vite.config.ts` fija el puerto 5273 con `strictPort`.
- Sus cachés del service worker se llaman `transmeralda-*` y el token del portal
  `transmeralda_portal_token`.
- Tiene Playwright (`npm run test:e2e`) y `vercel.json`.
- Su `compose.proxmox.yml` sí pasa las claves de HERE y Azure.
