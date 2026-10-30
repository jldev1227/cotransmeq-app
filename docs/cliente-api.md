# Cliente de la API

Cómo habla el frontend con el backend: el cliente `apiClient` (base URL,
token, errores, 401, reintentos, deduplicación), las otras formas de llamar
que existen y cuáles son deuda, cómo se descargan y se suben archivos, y qué
archivo de `src/lib/api/` consume qué módulo del backend. Léelo antes de
añadir una llamada nueva, de tocar un archivo de `src/lib/api/` o de
diagnosticar una petición que falla en el navegador y no en `curl`.

Qué devuelve cada endpoint, qué guarda lo protege y qué errores da está en la
referencia del backend: [`backend-cotransmeq/docs/api/`](../../backend-cotransmeq/docs/api/README.md)
(un documento por carpeta de `src/modules/`), con
[autenticacion.md](../../backend-cotransmeq/docs/autenticacion.md),
[middlewares.md](../../backend-cotransmeq/docs/middlewares.md) y
[permisos.md](../../backend-cotransmeq/docs/permisos.md). El login, la cookie y
la guardia de rutas del front están en
[autenticacion-y-permisos.md](./autenticacion-y-permisos.md).

## En corto

- Casi todo pasa por `apiClient`, una instancia de axios en
  [apiClient.ts](../src/lib/api/apiClient.ts). Cada dominio tiene su archivo en
  `src/lib/api/` que envuelve las rutas y devuelve datos ya desenvueltos; los
  componentes no construyen URLs.
- La base es `VITE_API_URL`, **sin** `/api` al final: las rutas ya lo llevan.
- El token sale de `localStorage['transmeralda_token']` en cada petición. El
  nombre es heredado del gemelo: este repo usa la misma clave.
- Un 401 fuera de `/public/*` cierra la sesión local y recarga en
  `/login?redirect=<ruta + consulta>`. No hay renovación de token.
- Lo que no puede ir por `apiClient` (blobs, multipart, streams, `keepalive`)
  y es del dashboard sale por `fetchConSesion`, con la misma base, el mismo
  token y el mismo 401 (ver [abajo](#fetchconsesion)).
- Cerrar sesión con el botón avisa al backend (`POST /api/auth/logout`) antes
  de borrar el token.
- Solo se reintentan lecturas (`GET`, `HEAD`, `OPTIONS`); las mutaciones nunca.
- No hay ninguna función `load` que llame a la API: todo se pide desde el
  navegador (en `onMount` o en efectos).

## `apiClient`

### Base URL

```ts
// fetchConSesion.ts; apiClient la importa de ahí
export const API_BASE = browser
	? (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000'
	: 'http://localhost:4000';
```

La comparten `apiClient`, `publicApiClient`, `fetchConSesion` y las rutas
públicas de los clientes con `fetch` propio. Antes cada uno de esos clientes la
calculaba con `import.meta.env.VITE_API_URL` a secas y, sin la variable, pedía
a `undefined/api/...`.

- `VITE_API_URL` se lee con `import.meta.env`: Vite la **incrusta al
  compilar**. En producción entra como `ARG` de la imagen
  ([Dockerfile](../Dockerfile)). El workflow de este repo no le pasa variables
  al script del servidor (`deploy-cotransmeq-app`), así que el valor sale del
  servidor o del defecto de [compose.proxmox.yml](../compose.proxmox.yml).
  Cambiarla exige recompilar, a diferencia de Sentry, que se lee en tiempo de
  ejecución. El inventario de variables está en
  [variables-de-entorno.md](./variables-de-entorno.md).
- Valor esperado: el **origen** de la API, sin `/api`. Producción
  `https://api-cotransmeq.transmeralda.com` (defecto de `compose.proxmox.yml`);
  local `http://localhost:4000`, que coincide con el respaldo del código. Las
  rutas se escriben `'/api/vehiculos'`, `portalFetch` compone
  `${base}/api${path}` y el socket del dashboard se conecta a esta misma
  variable: con `/api` al final las peticiones irían a `/api/api/...` y
  socket.io leería `/api` como un *namespace*.
- [.env.example](../.env.example) trae `VITE_API_URL=http://localhost:4000`,
  sin sufijo `/api` (hasta el 11-oct-2026 lo traía y rompía las rutas).
- En el servidor (SSR) la base es fija y no se adjunta token; los agentes
  `keep-alive` de esa rama solo cuentan si algún día una `load` usa
  `apiClient`.

### Cabeceras

| Cabecera | Valor | Notas |
|---|---|---|
| `Authorization` | `Bearer <token>` | Solo en el navegador. El interceptor lee `localStorage['transmeralda_token']` en cada petición (no el `authStore`), que es lo que escribe `authStore.login`. |
| `Content-Type` | `application/json` | Se **borra** cuando el cuerpo es `FormData`, para que el navegador ponga el `boundary` del multipart. Pasar `'multipart/form-data'` a mano, como hacen algunas llamadas, sobra. |
| `X-Client` | `transmeralda-web` | Informativa y heredada del gemelo: el backend no la lee. |

### Errores, 401 y cierre de sesión

El interceptor de respuesta decide en este orden:

1. **Cancelación** (`AbortController`: `CanceledError`, `ERR_CANCELED`): se
   rechaza sin reintentar. Antes se reintentaba con backoff y dejaba el
   `loading` colgado varios segundos tras cada cambio de filtro.
2. **401** (si la petición no lleva `silent401()`):
   - Fuera de `/public/*`: `sesionVencida()` (de
     [fetchConSesion.ts](../src/lib/api/fetchConSesion.ts)) borra
     `transmeralda_token`, `transmeralda_user` y la cookie `transmeralda_token`,
     y hace `window.location.href = '/login?redirect=<ruta + consulta>'`
     (recarga completa). Varios 401 a la vez redirigen una sola vez.
   - En `/public/*` (portal del conductor, enlaces públicos) el 401 se propaga
     a quien llamó: ahí no hay sesión de dashboard y sacar al conductor de un
     formulario por un desplegable que no cargó sería peor.
3. **Reintento** si aplica (abajo).
4. Si nada de lo anterior: `console.error('[api] GET /api/... falló (500) tras N ms')`
   y se rechaza con el `AxiosError`.

Lo que conviene saber del 401:

- **No hay renovación de token.** El backend no tiene `/api/auth/refresh`; el
  `authAPI.refreshToken()` que apuntaba ahí, sin que nadie lo llamara, se
  quitó.
- El interceptor no pasa por `authStore.logout()`: conserva la ruta en
  `?redirect=` (como la guardia de `hooks.server.ts`), no en
  `redirect_after_login`.
- **Cerrar sesión sí avisa al backend.** El botón de la cabecera llama a
  `authStore.cerrarSesion()`, que hace `authAPI.logout()` (`POST
  /api/auth/logout`, que cierra la fila de `sesiones`) con el token todavía
  puesto y después `logout()`. Lleva `silent401()` y un tope de 3 s, y los
  errores se ignoran: salir nunca espera a la red ni acaba en otra
  redirección. Los cierres por 401, token vencido o sesión cerrada por un
  administrador van directos a `logout()`, porque la sesión ya no vale.
- `silent401()` se usa en el login (allí un 401 es «credenciales incorrectas»,
  no «sesión vencida») y en las dos lecturas de firma de primas que el
  dashboard hace contra rutas de `conductor-portal`
  ([nomina.ts](../src/lib/api/nomina.ts)).

**Mostrar el error al usuario.** El backend no tiene un envoltorio único (ver
[api/README.md](../../backend-cotransmeq/docs/api/README.md)). El archivo de
`src/lib/api/` de cada dominio desenvuelve `response.data` y traduce el error;
el componente no debería bucear en `err.response.data`. Lo que hay hoy:

| Herramienta | Dónde | Para qué |
|---|---|---|
| `describirErrorApi` | [mensajesError.ts](../src/lib/utils/mensajesError.ts) | Muestra el texto del backend solo si es presentable; traduce los mensajes por defecto de NestJS/Prisma en inglés y cae a un texto por código de estado. |
| `FormApiError` | [formularios.ts](../src/lib/api/formularios.ts) | Errores de dominio de formularios con `code` estable (`REVISION_CONFLICT`, `FORM_DEFINITION_INVALID`…). |
| `PortalApiError` | [formularios-portal.ts](../src/lib/api/formularios-portal.ts) | Igual para el portal y «Mis formularios», con `retryable` y `needsAuth`. |
| `mensajeError`, `llamar`, `mensajeErrorEvaluaciones` | `cartera.ts`, `incidentes.ts`, `viaticos.ts`, `evaluaciones.ts` | Variantes locales del mismo patrón. |

### Reintentos

| Regla | Valor |
|---|---|
| Métodos | Solo `get`, `head`, `options`. `DELETE` y toda mutación quedan fuera. |
| Cuándo | Sin respuesta (red caída, timeout), `408`, `429` o `5xx`. |
| Cuántos | `MAX_RETRIES = 2`: hasta 3 intentos en total. |
| Espera | 800 ms y 1600 ms (backoff exponencial desde `RETRY_BASE_DELAY_MS`). Los comentarios del archivo mencionan un tercer escalón de 3200 ms que con dos reintentos no ocurre. |
| Desactivar | `withoutRetry()` en la llamada. |

Las mutaciones no se reintentan porque el cliente no puede saber cuáles son
idempotentes. Donde sí hace falta reintentar una escritura, lo hace quien lo
sabe: la cola de escrituras de los canvas
([cola-escritura.svelte.ts](../src/lib/editor/canvas/cola-escritura.svelte.ts),
solo escrituras idempotentes) y la outbox del portal
([forms-sync.ts](../src/lib/offline/forms-sync.ts)).

Una descarga pesada es un `GET`: un 5xx la regeneraría hasta tres veces. Las
de SARLAFT pasan `_noRetry` por eso; haz lo mismo con endpoints que generan
documentos.

### Deduplicación

`get`, `delete`, `head` y `options` están parcheados: dos llamadas idénticas en
vuelo (mismo método, URL, `params` y cuerpo) comparten la misma promesa.
Evita que dos componentes que montan a la vez pidan lo mismo dos veces.
Las llamadas con `AbortSignal` no se deduplican: cada consumidor conserva su
propio ciclo de vida y cancelar una lectura no cancela la promesa compartida de
otro componente. `withoutDedup()` también fuerza una petición nueva. La clave
**no** incluye cabeceras ni `responseType`: dos `GET` a la misma URL, uno como
`blob` y otro como JSON, compartirían respuesta.

### Tiempos

`timeout` de 30 s por defecto. Las rutas lentas lo amplían en la propia
llamada (`withTimeout(ms)` o `{ timeout }`): PDF del canvas de terceros 120 s
y ZIP 600 s, envíos de liquidaciones 300 s, PDF de documento de formulario
120 s, evidencias de incidentes 120 s, comprobantes de combustible y lectura de
comprobantes de viáticos 60 s. Una respuesta de más de 5 s deja un
`console.warn('[api] ... tardó N ms')`.

### Opciones por petición

```ts
await apiClient.get('/api/servicios', { params, ...withTimeout(60_000), ...withoutDedup() });
```

| Helper | Efecto |
|---|---|
| `withTimeout(ms)` | Tope propio para esa petición. |
| `withoutRetry()` | No reintenta aunque sea un `GET` que falla con 5xx. |
| `withoutDedup()` | No comparte promesa con otra igual en vuelo. |
| `silent401()` | Un 401 no cierra la sesión: se propaga. |

## `publicApiClient`

Misma base y mismo `timeout`, sin interceptores: no manda `Authorization`, no
redirige en un 401, no reintenta ni deduplica. Lo usan `serviciosPublicAPI`
(el enlace compartido de un servicio) y `certificadosPublicTerceroAPI`.

`serviciosPublicAPI` vive aparte de `serviciosAPI` a propósito: mientras el
único método público colgaba del mismo objeto que `getAll` o `delete`, bastaba
aceptar el autocompletado para sacar una petición autenticada desde una página
pública que nunca tendrá token. Sigue ese criterio con cualquier superficie
pública nueva.

## Otras formas de llamar al backend

Hay `fetch` directos repartidos por el código. Unos tienen motivo (tabla de
abajo); los del dashboard que eran deuda de antes de `apiClient` salen ahora
por [`fetchConSesion`](#fetchconsesion).

**Legítimos** — necesitan algo que axios con este interceptor no da:

| Dónde | Por qué no usa `apiClient` |
|---|---|
| [formularios-portal.ts](../src/lib/api/formularios-portal.ts) (`call()`, `subirBinario`, `hayConexionReal`) | Portal del conductor: token del magic link (`portalSession`), un 401 significa «pide otro enlace» y no «vete a `/login`», y los reintentos los decide la outbox. Topes propios de 30 s (JSON) y 120 s (binario). Ver [portal-del-conductor.md](./portal-del-conductor.md). |
| `portalFetch` / `portalFetchBlob` en [portalStore.ts](../src/lib/stores/portalStore.ts) | Lo mismo para el resto de pantallas del portal (servicios, desprendibles, días). |
| [asistente.ts](../src/lib/api/asistente.ts) (con `fetchConSesion`) | La respuesta es un *stream* de Server-Sent Events sobre `POST`; se lee el cuerpo por trozos. `EventSource` solo hace `GET` y no lleva token. |
| `autoguardadoAPI.guardarAlSalir` ([liquidaciones-servicios.ts](../src/lib/api/liquidaciones-servicios.ts)) y `desuscribirAlCerrarSesion` ([webPush.ts](../src/lib/notificaciones/webPush.ts)), los dos con `fetchConSesion` | `fetch` con `keepalive: true`, que sobrevive al cierre de la pestaña. `sendBeacon` no admite la cabecera `Authorization`. |
| `PUT` a URL prefirmada de S3 | No debe llevar `Authorization` ni cabeceras extra. Ver [Subidas](#subidas). |
| Páginas públicas sin sesión | `/public/*`, `/evaluaciones/[id]`, `validarExtractoPublico`. `/invite/[token]` usa axios crudo: podría usar `publicApiClient`. |
| Rutas de servidor propias (`/api/maps/*`, `/api/auth/recuperar-password/*`) | Se llaman con `fetch` relativo, al propio servidor de SvelteKit (mismo origen). [MapboxSearch.svelte](../src/lib/components/ui/MapboxSearch.svelte) manda el Bearer y la ruta lo reenvía al backend por `BACKEND_INTERNAL_URL`; las pantallas de `/recuperar-password` no llevan sesión. Ver [autenticacion-y-permisos.md](./autenticacion-y-permisos.md). |
| Terceros | Mapbox Directions, Overpass, y la descarga de logos para los PDF. |

### `fetchConSesion`

[fetchConSesion.ts](../src/lib/api/fetchConSesion.ts) es el `fetch` del
dashboard para lo que no va por `apiClient`. Hace lo mismo que el cliente de
axios en lo que importa para la sesión:

- **Base**: exporta `API_BASE` (`VITE_API_URL` con respaldo a
  `http://localhost:4000`), que también importa `apiClient`. Se le pasa la
  ruta (`'/api/salidas-nc'`); una URL absoluta pasa sin tocar.
- **Token**: pone `Authorization: Bearer <transmeralda_token>` si quien llama
  no la puso ya. No toca `Content-Type`, así que un `FormData` sale como
  multipart con su `boundary`.
- **401**: llama a `sesionVencida()`, la misma salida que el interceptor. Con
  `ignorar401: true` no (lo usa la desuscripción de Web Push al cerrar sesión).
- **Respuesta**: devuelve la `Response` tal cual, también la del 401, así que
  `ok`, `json()`, `blob()` y el *stream* del asistente funcionan como antes.

Lo que **no** da: reintentos, deduplicación ni tope de tiempo.

La usan `acciones-correctivas.ts`, `asistencias.ts`, `inducciones.ts`,
`salidas-nc.ts`, `notificaciones.ts`, `liquidaciones-servicios.ts`,
`asistente.ts` y [webPush.ts](../src/lib/notificaciones/webPush.ts), y en
pantallas [servicios/+page.svelte](../src/routes/dashboard/servicios/+page.svelte)
(páginas del canvas y rutograma),
[CalendarServicio.svelte](../src/lib/components/servicios/CalendarServicio.svelte)
y las de `routes/dashboard/evaluaciones/**`.

**No la uses en pantallas sin sesión del equipo.** Las rutas públicas de esos
mismos clientes (`asistenciasAPI.obtenerFormularioPorToken`,
`verificarRespuesta`, `enviarRespuesta` y `induccionesAPI.crear`, que llama el
registro público del visitante) siguen con `fetch` a secas y `API_BASE`: un 401
ahí no es una sesión vencida y no debe llevar al login del dashboard. El portal
del conductor tiene sus propios clientes (tabla de arriba). Por si acaso,
`sesionVencida()` no hace nada en `/public/*`.

Algunos de esos clientes siguen leyendo el token a mano en su
`getAuthHeaders()` (y las páginas de evaluaciones con `authHeaders()`); es
redundante pero inofensivo, porque `fetchConSesion` respeta un `Authorization`
que ya venga. Leer la clave a mano ya mordió: la página de flota y la de
clientes pedían `localStorage.getItem('token')` (la clave real es
`transmeralda_token`) y mandaban `Authorization: Bearer null`.

Regla: lo nuevo va por `apiClient`; si necesita `fetch` y es del dashboard, por
`fetchConSesion`.

**Pendiente en este repo**: `LiquidacionEditor.svelte` y
`PreviewTerceroPDF.svelte` (que en Transmeralda no hacen esta llamada) piden
`POST /api/pdf/from-html` con `fetch`, el token leído a mano y su propio
respaldo de base; no tratan el 401.

## Descargas de archivos

El patrón es siempre el mismo: pedir un `Blob`
(`apiClient.get(url, { responseType: 'blob' })` o `fetch` + `res.blob()`), crear
un `URL.createObjectURL`, simular el clic en un `<a download>` y revocar la URL.
No hay un ayudante común: cada módulo lo repite (`triggerBrowserDownload` en
[sarlaft.ts](../src/lib/api/sarlaft.ts), `descargarBlob` en el detalle de
evaluaciones…). Si escribes otro, empieza por copiar el de `sarlaft.ts`, que
libera la URL con retardo.

**El nombre del archivo y CORS.** El backend pone `Content-Disposition` en una
treintena de respuestas, pero el front (`app.cotransmeq.com`, o
`localhost:5173`) y la API (`api-cotransmeq.transmeralda.com`, o
`localhost:4000`) son orígenes distintos, y el navegador **oculta** a
JavaScript toda cabecera que la respuesta no declare en
`Access-Control-Expose-Headers`. Hoy solo una ruta la declara:
`GET /api/liquidaciones-servicios/:id/csv` (el Excel de una liquidación), en
[liquidaciones-servicios.controller.ts](../../backend-cotransmeq/src/modules/liquidaciones-servicios/liquidaciones-servicios.controller.ts).
El registro de `@fastify/cors` de
[app.ts](../../backend-cotransmeq/src/app.ts) no tiene `exposedHeaders`.

Consecuencias prácticas:

- Lee `Content-Disposition` solo si el endpoint lo expone, y ten **siempre** un
  nombre de respaldo armado en el cliente. `descargarExcel` lo hace bien;
  `parseFilename(...)` de SARLAFT recibe `null` y usa su respaldo.
- Si necesitas el nombre del servidor, añade
  `reply.header('Access-Control-Expose-Headers', 'Content-Disposition')` en ese
  endpoint, o `exposedHeaders: ['Content-Disposition']` en el registro de CORS
  del backend. En los dos backends.

## Subidas

### Multipart a la API

`FormData` + `apiClient.post(url, fd)`: el interceptor quita el
`Content-Type` y el navegador pone el suyo con el `boundary`. El backend acepta
hasta 200 MB por archivo (`@fastify/multipart` en `app.ts`). Como es una
mutación no se reintenta: si el archivo puede ser grande, dale un `timeout`
propio, como las evidencias de incidentes. Ejemplos: `conductoresAPI.uploadFoto`,
`authAPI.uploadMyFirma`, `certificadosAdminAPI.importZip`. El
`BODY_SIZE_LIMIT=20M` de la imagen limita solo a las rutas de servidor de
SvelteKit: las subidas van directas al backend.

### PUT directo a S3 con URL prefirmada

Para que un archivo no viaje dos veces (teléfono → API → S3) ni ocupe un worker
de Fastify mientras sube, dos flujos suben directo al bucket:

| Flujo | Firma | Subida | Confirmación |
|---|---|---|---|
| Adjuntos de formularios del portal (y de «Mis formularios», que reutiliza `subirBinario`) | `POST /api/conductor-portal/formularios/attachments/init` → `uploadUrl`, `checksumSha256` | `portalFormulariosAPI.subirBinario` | `POST .../attachments/:id/complete` |
| Comprobantes de viáticos | `POST /api/viaticos/comprobantes/presign` → `upload_url`, `headers` | `viaticosAPI.subirComprobante` | La `key` viaja en la petición siguiente |

El backend firma con `getS3UploadUrl`
([aws.ts](../../backend-cotransmeq/src/config/aws.ts)): `ContentType` y
`ContentLength` exactos y, en los adjuntos del portal, `ChecksumSHA256` cuando
`FORMS_S3_NATIVE_CHECKSUM` no es `'false'`. Los comprobantes de viáticos se
firman sin checksum. El presigner sube el checksum al *query string*
(`&x-amz-checksum-sha256=…`) y lo firma allí; S3 lo aplica desde la URL.

Reglas del `PUT`, que no se negocian:

- Sin `Authorization`: la firma de la URL es la autorización.
- Ninguna cabecera `x-amz-*`. SigV4 exige que estén en `X-Amz-SignedHeaders`, y
  el backend firmó sin conocerlas: S3 responde
  `403 AccessDenied: There were headers present in the request which were not signed`.
  En concreto, el checksum **no** se reenvía como cabecera.
- `Content-Type` igual al firmado y el mismo número de bytes.

`subirBinario` traduce los fallos para la outbox: sin respuesta →
`NETWORK_ERROR` (la operación vuelve a `PENDING` sin gastar intento); `403` →
`UPLOAD_URL_EXPIRED` (recuperable: se pide otra URL en `init`); `400 BadDigest`
→ `UPLOAD_CHECKSUM_REJECTED` (no recuperable: los bytes no son los que se
firmaron y hay que volver a capturar la evidencia).

**Si una subida falla, mira primero el CORS del bucket.** El `PUT` lleva un
`Content-Type` que no es «simple», así que el navegador manda antes un
`OPTIONS`. Sin una regla CORS del bucket con `PUT` y el origen **exacto** del
front (`https://app.cotransmeq.com`; el dominio sin `app.` no sirve), el
preflight falla, `fetch` lanza sin respuesta y la pantalla dice «Sin conexión
al subir la evidencia» (portal) o «revisa la conexión (o la regla CORS de PUT
del bucket)» (viáticos). En DevTools parece un problema de firma, pero la
petición nunca llegó a AWS. Se comprueba sin el navegador:

```bash
curl -s -i -X OPTIONS "https://<bucket>.s3.<region>.amazonaws.com/prueba.png" \
  -H "Origin: https://app.cotransmeq.com" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type"
```

`200` con `Access-Control-Allow-Origin`: el CORS está bien y el problema es
otro. `403`: falta el origen en la regla de `PUT`. Un cambio de CORS de bucket
se aplica en los dos despliegues (cada empresa tiene su bucket).

## Archivos de `src/lib/api/`

La columna de módulo es la carpeta `src/modules/<x>` del backend; su referencia
está en `backend-cotransmeq/docs/api/<x>.md`. Todas las rutas cuelgan de `/api`.

| Archivo | Módulo del backend | Exporta (principal) | Cómo llama |
|---|---|---|---|
| `acciones-correctivas.ts` | [acciones-correctivas](../../backend-cotransmeq/docs/api/acciones-correctivas.md) | `accionesCorrectivasAPI` (CRUD, causas, seguimientos, aprobaciones, PDF, sugerencias IA) | `fetchConSesion` |
| `api-tokens.ts` | [mcp](../../backend-cotransmeq/docs/api/mcp.md) (`/api/api-tokens`) | `listarConexiones`, `crearConexion`, `revocarConexion`, `URL_MCP`, `NOMBRE_MCP` | `apiClient` |
| `apiClient.ts` | [auth](../../backend-cotransmeq/docs/api/auth.md), [vehiculos](../../backend-cotransmeq/docs/api/vehiculos.md), [conductores](../../backend-cotransmeq/docs/api/conductores.md), [servicios](../../backend-cotransmeq/docs/api/servicios.md), [clientes](../../backend-cotransmeq/docs/api/clientes.md), [dias-laborados](../../backend-cotransmeq/docs/api/dias-laborados.md), [liquidaciones](../../backend-cotransmeq/docs/api/liquidaciones.md) (`/configuraciones-liquidacion`) | `apiClient`, `publicApiClient`, helpers, `authAPI`, `vehiculosAPI`, `conductoresAPI`, `conductoresSelectAPI`, `serviciosAPI`, `serviciosPublicAPI`, `clientesAPI`, `configuracionesLiquidacionAPI`, `bonosAPI`, `bonoConfigVisualAPI`, `diasLaboradosAPI` | axios |
| `app-movil.ts` | [app-usuarios](../../backend-cotransmeq/docs/api/app-usuarios.md) | `estadoEnlaceApp`, `generarEnlaceApp`, `revocarEnlaceApp` | `apiClient` |
| `asistencias.ts` | [asistencias](../../backend-cotransmeq/docs/api/asistencias.md) (también `/api/public/asistencias`) | `asistenciasAPI` | `fetchConSesion`; `fetch` a secas en las rutas públicas |
| `asistente.ts` | [asistente](../../backend-cotransmeq/docs/api/asistente.md) | `asistenteDisponible`, `conversarConAsistente`, `ErrorAsistente` | `fetchConSesion` (SSE) |
| `canvas-anotaciones.ts` | [canvas-anotaciones](../../backend-cotransmeq/docs/api/canvas-anotaciones.md) | `canvasAnotacionesAPI` | `apiClient` |
| `cartera.ts` | [cartera](../../backend-cotransmeq/docs/api/cartera.md) | `carteraAPI`, `mensajeError` | `apiClient` |
| `certificadosAdmin.ts` | [certificados-tributarios](../../backend-cotransmeq/docs/api/certificados-tributarios.md) | `certificadosAdminAPI` | `apiClient` |
| `certificadosTercero.ts` | [certificados-tributarios](../../backend-cotransmeq/docs/api/certificados-tributarios.md) (también `/api/tipos-certificado` y `/api/public/certificados-tercero`) | `certificadosTerceroAPI`, `tiposCertificadoAPI`, `certificadosPublicTerceroAPI` | `apiClient` y `publicApiClient` |
| `combustible.ts` | [combustible](../../backend-cotransmeq/docs/api/combustible.md) | `combustibleAPI` y formateadores | `apiClient` |
| `conductoresDocumentos.ts` | [conductores-documentos](../../backend-cotransmeq/docs/api/conductores-documentos.md) | `conductoresDocumentosAPI` | `apiClient` |
| `dashboard.ts` | [dashboard](../../backend-cotransmeq/docs/api/dashboard.md), [actividad](../../backend-cotransmeq/docs/api/actividad.md) | `seccionesPanel`, `seccionPanel`, `listarActividad`, `opcionesActividad`, `guardarSeguridadSocial`, `aplicarSeguridadSocial` | `apiClient` |
| `evaluaciones.ts` | [evaluaciones](../../backend-cotransmeq/docs/api/evaluaciones.md) | `getEvaluaciones`, `getEvaluacionById`, `createEvaluacion`, `updateEvaluacion`, `deleteEvaluacion`, `obtenerResultado`, `actualizarRespuestasResultado`, `authHeaders`, `mensajeErrorEvaluaciones` | `apiClient` (las páginas usan `fetchConSesion`, más `authHeaders()`) |
| `extractos.ts` | [extractos](../../backend-cotransmeq/docs/api/extractos.md) (también `/api/public/extractos`) | `extractosAPI`, `validarExtractoPublico`, `ErrorValidacionExtracto`, formateadores | `apiClient`; `fetch` en la validación pública |
| `facturacionLiquidaciones.ts` | [facturacion-liquidaciones](../../backend-cotransmeq/docs/api/facturacion-liquidaciones.md) | `facturacionLiquidacionesAPI` | `apiClient` |
| `formularios-documento-pdf.ts` | [formularios-dinamicos](../../backend-cotransmeq/docs/api/formularios-dinamicos.md) (`/api/formularios/documento/pdf`) | `formulariosDocumentoPdfAPI` | `apiClient` (blob) |
| `formularios-portal.ts` | [formularios-dinamicos](../../backend-cotransmeq/docs/api/formularios-dinamicos.md) (`/api/conductor-portal/formularios`) y [conductor-portal](../../backend-cotransmeq/docs/api/conductor-portal.md) (vehículos) | `portalFormulariosAPI`, `PortalApiError`, `hayConexionReal` | `fetch` con token del portal (legítimo) |
| `formularios.ts` | [formularios-dinamicos](../../backend-cotransmeq/docs/api/formularios-dinamicos.md) (también `/api/form-field-templates`) | `formulariosAPI`, `plantillasFormularioAPI`, `asignacionesFormularioAPI`, `enviosFormularioAPI`, `FormApiError` | `apiClient` |
| `incidentes.ts` | [incidentes](../../backend-cotransmeq/docs/api/incidentes.md) | `incidentesAPI`, `mensajeError`, etiquetas | `apiClient` |
| `inducciones.ts` | [inducciones](../../backend-cotransmeq/docs/api/inducciones.md) | `induccionesAPI` | `fetchConSesion`; `fetch` a secas en `crear` (registro público) |
| `liquidaciones-chat.ts` | [liquidaciones-chat](../../backend-cotransmeq/docs/api/liquidaciones-chat.md) | `liquidacionesChatAPI` | `apiClient` |
| `liquidaciones-recordatorios.ts` | [liquidaciones-chat](../../backend-cotransmeq/docs/api/liquidaciones-chat.md) | `liquidacionesRecordatoriosAPI` | `apiClient` |
| `liquidaciones-servicios.ts` | [liquidaciones-servicios](../../backend-cotransmeq/docs/api/liquidaciones-servicios.md), [liquidaciones-terceros](../../backend-cotransmeq/docs/api/liquidaciones-terceros.md) (listado y `migrar`), [operadoras](../../backend-cotransmeq/docs/api/operadoras.md) | `liquidacionesServiciosAPI`, `autoguardadoAPI`, `operadorasAPI`, `liquidacionesTercerosAPI`, `ErrorConflictoAutoguardado` | `fetchConSesion` (también `guardarAlSalir`, con `keepalive`) |
| `liquidaciones-servicios.ts.tmp` | — | Nada: archivo vacío (0 bytes) versionado. Es un residuo y se puede borrar. | — |
| `liquidaciones-terceros-adicionales-snapshots.ts` | [liquidaciones-terceros-adicionales-snapshots](../../backend-cotransmeq/docs/api/liquidaciones-terceros-adicionales-snapshots.md) | `adicionalesSnapshotsAPI` | `apiClient` |
| `liquidaciones-terceros-adicionales.ts` | [liquidaciones-terceros-adicionales](../../backend-cotransmeq/docs/api/liquidaciones-terceros-adicionales.md) | `liquidacionesTercerosAdicionalesAPI` | `apiClient` |
| `liquidaciones-terceros-canvas-pdf.ts` | [liquidaciones-terceros-pdf](../../backend-cotransmeq/docs/api/liquidaciones-terceros-pdf.md) | `liquidacionesTercerosCanvasPdfAPI` | `apiClient` (blob) |
| `liquidaciones-terceros-descuentos.ts` | [liquidaciones-terceros-descuentos](../../backend-cotransmeq/docs/api/liquidaciones-terceros-descuentos.md), además [liquidaciones-terceros-snapshots](../../backend-cotransmeq/docs/api/liquidaciones-terceros-snapshots.md) y [liquidaciones-terceros-pdf](../../backend-cotransmeq/docs/api/liquidaciones-terceros-pdf.md) | `liquidacionesTercerosDescuentosAPI` | `apiClient` |
| `liquidaciones-terceros-envios.ts` | [liquidaciones-terceros-envios](../../backend-cotransmeq/docs/api/liquidaciones-terceros-envios.md) | `liquidacionesTercerosEnviosAPI` | `apiClient` |
| `liquidaciones-terceros-ingresos.ts` | [liquidaciones-terceros-ingresos](../../backend-cotransmeq/docs/api/liquidaciones-terceros-ingresos.md) | `liquidacionesTercerosIngresosAPI` | `apiClient` |
| `liquidaciones-terceros-ocasional.ts` | [liquidaciones-terceros-ocasional](../../backend-cotransmeq/docs/api/liquidaciones-terceros-ocasional.md) y [liquidaciones-terceros-ocasional-snapshots](../../backend-cotransmeq/docs/api/liquidaciones-terceros-ocasional-snapshots.md) | `liquidacionesTercerosOcasionalAPI` | `apiClient` |
| `liquidacionesTercerosPagos.ts` | [liquidaciones-terceros-pagos](../../backend-cotransmeq/docs/api/liquidaciones-terceros-pagos.md) | `liquidacionesTercerosPagosAPI`, `armarPago`, `pagoCompleto` | `apiClient` |
| `mantenimiento.ts` | [mantenimiento](../../backend-cotransmeq/docs/api/mantenimiento.md) | `mantenimientoAPI`, etiquetas y formateadores | `apiClient` |
| `mis-formularios.ts` | [formularios-dinamicos](../../backend-cotransmeq/docs/api/formularios-dinamicos.md) (`/api/mis-formularios`) | `misFormulariosAPI` | `apiClient`; reutiliza `subirBinario` del portal |
| `nomina-canvas.ts` | [nomina-canvas](../../backend-cotransmeq/docs/api/nomina-canvas.md) (`/api/nomina/*`) | `nominaCanvasAPI`, `nominaEnviosAPI`, `nominaNotificacionesAPI`, `nominaBorradoresAPI` | `apiClient` |
| `nomina.ts` | [liquidaciones](../../backend-cotransmeq/docs/api/liquidaciones.md) (incluye `/configuraciones-liquidacion` y `/firmas/liquidacion`), [primas](../../backend-cotransmeq/docs/api/primas.md), [conductor-portal](../../backend-cotransmeq/docs/api/conductor-portal.md) (primas y desprendibles), [conductores](../../backend-cotransmeq/docs/api/conductores.md), [vehiculos](../../backend-cotransmeq/docs/api/vehiculos.md), [clientes](../../backend-cotransmeq/docs/api/clientes.md) (`/api/empresas`) | `obtenerLiquidaciones`, `crearLiquidacion`, `editarLiquidacion`, `previewDesprendibles`, `enviarDesprendibles`, `generatePayslipsZip`, `obtenerPrimas`, `firmarPrima`… | `apiClient` |
| `notificaciones.ts` | [notificaciones](../../backend-cotransmeq/docs/api/notificaciones.md) | `notificacionesApi` | `fetchConSesion` |
| `recargos.ts` | [recargos](../../backend-cotransmeq/docs/api/recargos.md) (y `/api/liquidaciones/preview-recargos` de [liquidaciones](../../backend-cotransmeq/docs/api/liquidaciones.md)) | `recargosApi`, incluida la importación desde Transmeralda (`previewImportarTransmeralda`, `crearEntidadesFaltantesTransmeralda`, `importarDesdeTransmeralda`, `sincronizarConductoresCotransmeqTransmeralda`); `obtenerSiguienteNumeroPlanilla` revalida y `liberarReservaPlanilla` devuelve el número al cerrar | `apiClient` |
| `recorridos-canvas.ts` | [recorridos-canvas](../../backend-cotransmeq/docs/api/recorridos-canvas.md) (`/api/recorridos`) | `recorridosCanvasAPI`, `recorridosSnapshotsAPI` | `apiClient` |
| `salidas-nc.ts` | [salidas-nc](../../backend-cotransmeq/docs/api/salidas-nc.md) | `salidasNCAPI`, etiquetas | `fetchConSesion` |
| `sarlaft.ts` | [formularios-sarlaft](../../backend-cotransmeq/docs/api/formularios-sarlaft.md) | `sarlaftAPI`, etiquetas, `CONTACTO_POR_TIPO` | `apiClient` |
| `sarlaftFields.ts` | — (catálogo de campos del formulario, sin HTTP) | `CAMPOS`, `SECCIONES`, `TABLAS`, `getKeysParaTipo` | — |
| `sesiones.ts` | [sesiones](../../backend-cotransmeq/docs/api/sesiones.md) | `sesionesAPI` | `apiClient` |
| `solicitudes.ts` | [solicitudes-web](../../backend-cotransmeq/docs/api/solicitudes-web.md) (`/api/solicitudes`) | `solicitudesAPI`, etiquetas | `apiClient` |
| `tarifas.ts` | [liquidaciones-servicios](../../backend-cotransmeq/docs/api/liquidaciones-servicios.md) (`/tarifas`) | `tarifasAPI` | `apiClient` |
| `terceros.ts` | [terceros](../../backend-cotransmeq/docs/api/terceros.md) | `tercerosAPI` | `apiClient` |
| `usuarios.ts` | [usuarios](../../backend-cotransmeq/docs/api/usuarios.md), [invitaciones](../../backend-cotransmeq/docs/api/invitaciones.md) | `usuariosAPI`, `hasBonosPlanilla` | `apiClient` |
| `vehiculosDocumentos.ts` | [vehiculos-documentos](../../backend-cotransmeq/docs/api/vehiculos-documentos.md) | `vehiculosDocumentosAPI` | `apiClient` |
| `viaticos.ts` | [viaticos](../../backend-cotransmeq/docs/api/viaticos.md) | `viaticosAPI`, `viaticosEmpresaAPI`, `viaticosFondoAPI`, `comprimirImagen`, etiquetas | `apiClient`; `PUT` a S3 en `subirComprobante` |

Residuos y duplicados que conviene conocer antes de buscar «la» función:

- `extractosAPI` de `apiClient.ts` es código muerto: nadie lo importa (las
  pantallas usan el de `extractos.ts`) y sus rutas (`/extractos/matches`,
  `/sync`, `/next-consecutivo`, `/all`) ya no existen en el backend.
- `certificadosTercero.ts` exporta otro `certificadosAdminAPI` que nadie
  importa; el que se usa es el de `certificadosAdmin.ts`.
- Las funciones de tarifas de `liquidacionesServiciosAPI` no tienen llamadores:
  se usa `tarifasAPI`.

## Añadir una llamada

1. Busca el archivo del dominio en la tabla; si no existe, créalo como
   `src/lib/api/<dominio>.ts` importando `apiClient`.
2. Escribe la ruta completa (`'/api/<modulo>/...'`) y tipa la respuesta.
   Desenvuelve `response.data` aquí y traduce el error, no en el componente.
3. Lecturas: nada especial; ya reintentan y deduplican. Descargas pesadas:
   `withoutRetry()`. Rutas lentas: `withTimeout(ms)`.
4. Mutaciones: no reintentes a mano. Si tiene que sobrevivir a cortes, va por la
   cola que corresponda (outbox del portal, cola de escrituras del canvas).
5. Si la ruta es pública, ponla en un objeto aparte sobre `publicApiClient`.
   Si de verdad necesita `fetch` (stream, `keepalive`) y es del dashboard, usa
   `fetchConSesion`, nunca `fetch` con el token leído a mano.
6. Aplica el mismo cambio en `ingreso-svelte` (los archivos de `src/lib/api/`
   son idénticos salvo los listados abajo).

## Diferencias con Transmeralda

`apiClient.ts` es idéntico en los dos repos; por eso aquí el token también se
llama `transmeralda_token` y la cabecera dice `X-Client: transmeralda-web`. Lo
que sí cambia:

| | Cotransmeq | Transmeralda |
|---|---|---|
| `VITE_API_URL` en producción | `https://api-cotransmeq.transmeralda.com` | `https://api.transmeralda.com` |
| Backend local | `http://localhost:4000` (coincide con el respaldo del código) | `http://localhost:4100`: allí, si falta la variable, el front acaba hablando con el backend de este repo |
| Front | `app.cotransmeq.com`, local `5173` (o `5174`) | `app.transmeralda.com`, local `5273` |
| Variables del build en CI | El workflow no pasa variables; las pone el servidor | El workflow arma los archivos de variables desde `vars` y `secrets` |
| `recargos.ts` | Importa desde Transmeralda y filtra `imported_from_transmeralda` | Importa desde Cotransmeq y filtra `imported_from_cotransmeq`; también incluye `subirPlanilla` (PDF multipart) |
| `sarlaft.ts`, `sarlaftFields.ts` | Códigos `GC-FR-0X` / `GC-FOR-13` y buzones propios | Códigos `SLFT-PTEE-FR-0X` y buzones propios |
| `api-tokens.ts` | `NOMBRE_MCP = 'cotransmeq'` | `NOMBRE_MCP = 'transmeralda'` |
