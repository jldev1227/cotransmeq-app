# Portal del conductor

Cómo está hecho `src/routes/public/portal/**`: la sesión por enlace mágico, las
pantallas y la API que consume cada una, el modo sin conexión de los
formularios (IndexedDB como fuente de verdad, la outbox, los recibos), lo que
hace el service worker y las reglas de UX que no se negocian. Léelo antes de
tocar cualquier cosa del portal o de `src/lib/offline/`.

El usuario es un conductor en un patio sin cobertura, con un teléfono de gama
baja y al sol, que puede tardar dos horas en una inspección. Casi todas las
decisiones de este documento salen de ahí: perder ese trabajo, o hacerle creer
que se envió algo que sigue en el teléfono, es el peor fallo posible.

Documentos relacionados: el constructor y el contrato de los formularios
dinámicos en [formularios-dinamicos/](./formularios-dinamicos/README_ARQUITECTURA.md)
(su `README_FRONTEND_OFFLINE.md` es la especificación original del modo
offline: útil para el porqué, pero en algunos puntos ya no coincide con el
código, ver más abajo); la autenticación completa en
[autenticacion-y-permisos.md](./autenticacion-y-permisos.md); sockets y Web
Push en [tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md);
los PDF del portal en [documentos-y-pdf.md](./documentos-y-pdf.md).

## Reglas que no se negocian

| Regla | Dónde se cumple |
|---|---|
| **IndexedDB es la fuente de verdad del borrador.** El servidor recibe una copia de respaldo, no el original. | [forms-db.ts](../src/lib/offline/forms-db.ts), runner de formularios |
| **La pantalla abre sin red**: primero se pinta lo cacheado y luego se reconcilia. | Lista y runner de formularios; el shell lo sirve el service worker |
| **Los envíos salen por la outbox**, nunca con un `fetch` suelto: una operación a la vez, con lease, respetando dependencias. | [forms-sync.ts](../src/lib/offline/forms-sync.ts) |
| **Texto además de color.** Un punto amarillo frente a uno verde es indistinguible al sol. | [SyncStatus](../src/lib/components/formularios/SyncStatus.svelte) siempre dice el estado con palabras y el icono es un carácter, no un matiz |
| **Objetivos táctiles de 44 px** como mínimo. | `.btn-primary`, `.btn-secondary`, `.btn-danger` (`min-height: 44px`) y los botones propios del portal |
| **Un error que el conductor no puede corregir no se presenta como «necesita corrección».** Si la operación quedó obsoleta, se retira de la cola. | `manejarError` y las reparaciones de arranque de `forms-sync.ts` (ver abajo, con la excepción que queda) |
| **Un 401 pausa; no borra.** | outbox y `cerrarSesion` del layout |

Estas reglas valen hoy para **Formularios**, la única sección con modo offline
completo. Las demás pantallas se abren sin red porque el service worker guarda
su shell, pero piden sus datos al servidor (ver la tabla de pantallas).

## Sesión: enlace mágico, no el login del dashboard

El conductor escribe su cédula en `/public/portal`; el backend le manda un
enlace al correo (`POST /api/conductor-portal/solicitar-acceso`). Al abrir el
enlace, `?token=` se valida con `GET /api/conductor-portal/verificar-token`
(tres intentos de 15 s con pausa creciente; avisa a los 5 s si la conexión va
lenta; un 401 es una respuesta, no se reintenta) y la sesión se guarda. Un
token en la URL **siempre** se valida, aunque haya otra sesión guardada. Los
enlaces con `?desprendible=`, `?prima=` o `?tab=` aterrizan en Pagos con ese
documento resaltado, y sin ellos el destino es también **Pagos**
(`/public/portal/desprendibles`).

[stores/portalStore.ts](../src/lib/stores/portalStore.ts):

| Pieza | Qué hace |
|---|---|
| `portalSession` | `{ token, conductor, expiresAt }` en `localStorage['cotransmeq_portal_token']`. Al arrancar se descarta si venció. |
| `portalFetch(path, opts)` / `portalFetchBlob` | `fetch` a `${VITE_API_URL}/api${path}` con el token del portal. **No** se usa `apiClient` en el portal: ese cliente manda el JWT del dashboard y convierte un 401 en `window.location.href = '/login'`, sacando al conductor del formulario a medio diligenciar. |
| `expirarSesionPortal()` | Cierra la sesión y lleva a `/public/portal` con `replaceState`. Nunca a `/login`. |
| `cotransmeq_portal_home` | Marca «en este dispositivo entra un conductor». Sobrevive al logout y a la caducidad; con ella, `/` y `/login` devuelven al conductor a su login. Solo la borra un login administrativo. Para entrar como administrador desde ese teléfono: `/login?admin=1` o escribir la dirección en la barra (`entradaDirectaAlLogin()`). |

`portalSession.logout()` lo llaman también los manejadores de 401 de medio
portal, así que **no borra nada local**. El único que limpia es el «Cerrar
sesión» deliberado del [layout](../src/routes/public/portal/+layout.svelte), y
solo si `hayTrabajoPendiente()` dice que no queda ni un borrador ni una
operación en la outbox: el dispositivo puede ser la única copia. Lo que se
limpia entonces es la caché de lectura (recibos, asignaciones, definiciones),
que es lo que se le quedaba al siguiente conductor.

## Pantallas y API

Todas cuelgan de [public/portal/+layout.svelte](../src/routes/public/portal/+layout.svelte)
(`ssr = false`): barra superior, menú lateral en escritorio, navegación
inferior en móvil con el mismo orden que la app (Formularios, Servicios,
Capacitaciones, Días laborados, Viáticos, Pagos). El layout arranca la outbox en cuanto hay sesión,
para todo el portal.

| Ruta | Pantalla | API | Sin red |
|---|---|---|---|
| `/public/portal` | Login por cédula y validación del enlace | `solicitar-acceso`, `verificar-token` | — |
| `/formularios` | Por diligenciar, borradores, cola y «Últimos envíos» | `GET /conductor-portal/formularios` (lista), `/:assignmentId` (definición, con ETag), `/submissions` (historial); socket de formularios | Sí: IndexedDB |
| `/formularios/[assignmentId]` | Runner: el conductor diligencia | definición con ETag; `GET /conductor-portal/dias-laborados/vehiculos` para la placa; el resto por la outbox | Sí |
| `/formularios/envios/[id]` | Recibo. `pendiente-<clientSubmissionId>` muestra el recibo local de algo que aún está en la cola; un UUID pide el detalle | `GET /conductor-portal/formularios/submissions/:id` | El recibo pendiente, sí |
| `/formularios/envios/[id]/documento` | El documento imprimible del envío (`PreviewEnvioPDF`), sin la cáscara del portal. Lo descarga la app móvil | el mismo detalle | No |
| `/servicios`, `/servicios/[id]` | Servicios asignados, solo lectura | `GET /conductor-portal/servicios`, `/servicios/:id` ([stores/conductor-servicios.ts](../src/lib/stores/conductor-servicios.ts)) | Solo el shell |
| `/capacitaciones` | Cursos, evaluaciones y certificados del conductor; cada acceso usa un ticket SSO de un solo uso. La carga y los errores se anuncian, y se puede reintentar con teclado. | `POST /conductor-portal/capacitaciones/lanzar` | Requiere conexión |
| `/dias-laborados` | Registrar y corregir días y tramos | `/conductor-portal/dias-laborados/clientes`, `/vehiculos`, `/registros` (`GET ?mes=`, `POST`, `DELETE /:fecha`) | Solo el shell; ver abajo |
| `/viaticos` | Consulta de anticipos y saldo (reportar gastos va por la app) | `GET /conductor-portal/viaticos`, `/viaticos/:id` | No: no está en el shell del service worker |
| `/desprendibles` | Pagos: desprendibles y primas, firma | `/conductor-portal/desprendibles`, `/primas`, `/desprendibles/:id/datos`, `/primas/:id/enriquecida`, `POST …/:id/firmar` | Solo el shell |
| `/desprendibles/imprimir/[id]` | No es una pantalla: la abre Puppeteer desde el backend para que la app móvil reciba el mismo desprendible que la web | `/conductor-portal/desprendibles/:id/datos` | — |

Los PDF de Pagos (desprendible y prima) se generan en el navegador con
pdfmake, igual que en el dashboard: ver [documentos-y-pdf.md](./documentos-y-pdf.md).

**Días laborados no usa la outbox.** Guarda un borrador por día en
`localStorage` (`dias-laborados:bor:<conductorId>:<fecha>`, versionado con
`BORRADOR_VERSION`, hoy 4: subirla invalida los borradores viejos del
teléfono) y lo envía con un `portalFetch` directo; si falla, el borrador sigue
ahí. Al abrir un día, el borrador local tiene prioridad sobre el servidor, por
eso hay que subir la versión cuando cambia la forma de los datos: si no, un
arreglo del backend no se nota en el teléfono y al guardar resucita lo viejo.

## Formularios: IndexedDB como fuente de verdad

[forms-db.ts](../src/lib/offline/forms-db.ts) es la **única** capa que habla con
IndexedDB; si cada pantalla abriera su conexión, una migración de esquema
tendría que coordinarse entre todas. No se usa `localStorage`: es síncrono
(bloquea la UI mientras el conductor escribe), tiene un tope de unos 5 MB y solo
guarda texto, así que una foto ocuparía un tercio más en base64. IndexedDB
guarda `Blob` tal cual.

Base `transmeralda_forms_v1` (el nombre viene del gemelo: el archivo es
idéntico en los dos repos y no hay choque porque IndexedDB es por origen),
versión de esquema **2** (es la versión de los stores locales; no tiene nada
que ver con las versiones de los formularios):

| Store | Clave | Contenido |
|---|---|---|
| `definitions` | `versionId` | Árbol del formulario publicado, con su ETag. Se podan las que ya no corresponden a ninguna asignación, salvo las que tienen un borrador abierto. |
| `assignments` | `assignmentId` | Tarjetas de lo que le corresponde al conductor. Se **reemplazan** enteras: el servidor es la autoridad y una asignación retirada daría una tarjeta que el envío rechazaría. |
| `drafts` | `clientSubmissionId` | Contexto (p. ej. `vehicleId`), respuestas, progreso, `blocked` si el servidor lo rechazó. Índice por asignación. |
| `attachments` | `clientAttachmentId` | El `Blob` comprimido, su `sha256`, estado (`LOCAL` → `INITIALIZED` → `UPLOADED`, o `FAILED`), `serverId` y la URL firmada de subida. |
| `outbox` | `operationId` | Operaciones pendientes (ver abajo). Índices por estado, envío y próxima ejecución. |
| `receipts` | `clientSubmissionId` | Acuses de lo entregado, con el `conductorId` dueño. La migración v1 → v2 vació los recibos viejos, que no lo tenían. |
| `meta` | `key` | `installationId` (identifica el dispositivo y es el dueño de los leases), `lastSyncAt`, la caché de placas y marcas de reparaciones hechas. |

Detalles que ya mordieron:

- **`updatedAt` es monotónico**: el máximo entre «ahora» y el anterior más un
  milisegundo. Un teléfono cuyo reloj se atrasa haría ganar al respaldo viejo.
- **El borrador se normaliza con un JSON de ida y vuelta** (`clonable`) antes de
  guardarlo. IndexedDB rechaza los Proxies de `$state` con un `DataCloneError`
  que no dice qué campo falló, y un olvido de `$state.snapshot` en el origen no
  rompía una pantalla: congelaba el autoguardado en silencio y se descubría al
  firmar, con el formulario al 100 %.
- **Los recibos se leen por conductor** (`allReceipts(conductorId)`): IndexedDB
  es del origen, no de la sesión, y un `getAll()` mostraba los del conductor que
  usó antes el teléfono.
- **La cuota se mide antes de aceptar evidencia** (`quotaInfo`). Sin espacio se
  conserva el texto y se bloquean solo los adjuntos. `navigator.storage.persist()`
  se pide tras el primer borrador con adjuntos, no al abrir: pedirlo sin nada
  que perder hace que el conductor lo rechace.
- Las fotos se comprimen antes de guardarlas ([forms-media.ts](../src/lib/offline/forms-media.ts)):
  1920 px de lado mayor y JPEG 0,82, de 3-8 MB a 300-600 KB. El `sha256` se
  calcula sobre el binario **final**: es el que el servidor comprueba contra S3.
- Las placas se cachean en `meta` cuando el runner trae el catálogo: con varios
  borradores del mismo preoperacional lo único que los distingue es el vehículo,
  y la lista tiene que pintarlo sin red.

### El runner

[formularios/[assignmentId]](../src/routes/public/portal/formularios/[assignmentId]/+page.svelte):

- Carga primero de IndexedDB; después revalida la definición con
  `If-None-Match` (un `304` no descarga nada: el árbol de un preoperacional pesa
  cientos de KB).
- **Guarda en local a los 250 ms** de cada cambio y, cada 30 s mientras la
  pantalla está abierta, encola un respaldo al servidor (`encolarBackup`: si ya
  hay uno pendiente para ese envío no añade otro; la operación lee el borrador
  vigente al ejecutarse).
- **Enviar no hace un POST**: pide confirmación («después de enviar no podrás
  editar»), encola la cadena completa con `encolarEnvio` y navega al recibo
  `envios/pendiente-<id>`. El conductor puede cerrar la app en ese momento.
- Cambiar de vehículo pide confirmación antes de limpiar las respuestas que
  dependían de él.
- Un conductor puede llevar varios borradores de la misma asignación a la vez
  (uno por vehículo): la lista los muestra todos y siempre ofrece «Empezar
  otro».

## La outbox

[forms-sync.ts](../src/lib/offline/forms-sync.ts) es de lo que depende que no se
pierda una inspección. Cinco decisiones la gobiernan:

1. **Una operación a la vez, con lease.** `claimNextOperation` lee y toma el
   lease (180 s, porque una subida puede tardar 120) en la **misma** transacción
   de IndexedDB. `BroadcastChannel('transmeralda-forms-sync')` solo despierta a
   las otras pestañas; no da exclusión: dos pestañas podrían anunciarse a la vez.
   Los leases huérfanos de una pestaña cerrada a mitad de subida se liberan al
   arrancar y en cada ronda.
2. **Las dependencias se respetan.** Una operación es elegible si está
   `PENDING` o `RETRY`, su `nextAttemptAt` venció, no tiene lease vivo y ninguna
   de sus dependencias sigue en la cola: se resuelven **por ausencia**, porque
   una operación completada se borra. Dentro de eso, FIFO.
3. **`navigator.onLine` no basta.** Cada ronda confirma conectividad con
   `hayConexionReal()` (`GET …/formularios/ping`, 4 s): cualquier respuesta HTTP
   vale, incluso un 401 o un 404; un portal cautivo no puede responder por el
   dominio de la API sin romper TLS.
4. **Un 4xx de validación no se reintenta**: se marca `BLOCKED` y el borrador
   queda editable con el detalle.
5. **Un 401 pausa; no borra**: la operación vuelve a `PENDING` sin gastar un
   intento y la fase pasa a `paused-auth` hasta que haya sesión.

La cadena de un envío la construye `construirCadenaEnvio` (pura y con test,
porque su orden decide si el envío llega entero):

```
BACKUP_DRAFT ─┬─► INIT_ATTACHMENT ─► UPLOAD_ATTACHMENT ─► COMPLETE_ATTACHMENT ─┐
              └─► (una terna por adjunto pendiente)                          ├─► SUBMIT
                          DISCARD_ATTACHMENT pendientes del mismo envío ───────┘
```

- La cabeza `BACKUP_DRAFT` existe porque la fila del envío en el servidor solo
  la crean el respaldo o el `SUBMIT`, y el `SUBMIT` va al final: sin ella, un
  formulario hecho sin señal empezaba por un `INIT` contra un envío que el
  servidor no conocía (`SUBMISSION_NOT_FOUND`, un 404 que dejaba el borrador
  bloqueado para siempre). Si no hay adjuntos que subir, no hace falta cabeza.
- El `SUBMIT` depende también de los descartes de adjuntos en cola: el servidor
  rechaza un envío que no declara toda su evidencia (`ATTACHMENT_NOT_DECLARED`).
- Quitar una foto ya inicializada encola `DISCARD_ATTACHMENT` con el `serverId`
  y retira de la cola las subidas de ese adjunto. Descartar un borrador lo borra
  en el acto del teléfono y encola `DISCARD_DRAFT` (borrado lógico e idempotente
  en el servidor).
- La subida a S3 es un `PUT` a la URL firmada. El checksum va **dentro** de la
  URL (`&x-amz-checksum-sha256=…`), firmado: no hay cabecera que reenviar ni
  campo aparte que guardar. Un `403` (`UPLOAD_URL_EXPIRED`) borra la URL y el
  reintento pasa otra vez por `init`; un `400 BadDigest`
  (`UPLOAD_CHECKSUM_REJECTED`) marca el adjunto `FAILED` y hay que recapturarlo.
  El `README_FRONTEND_OFFLINE.md` todavía describe la cabecera y un campo
  `uploadChecksum` que ya no existen.

Qué hace con cada error (`manejarError`):

| Caso | Resultado |
|---|---|
| 401 | `PENDING` sin gastar intento; fase `paused-auth`. |
| Red caída o petición abortada | `PENDING`; fase `offline`; nueva ronda en 30 s o al volver la red. |
| `SUBMISSION_DISCARDED` (409) | El envío se descartó desde otro sitio: se purga todo lo local. No se bloquea. |
| `VALIDATION_ERROR` del sobre HTTP | Describe el protocolo, no las respuestas: se reconstruye la cadena **una vez** con el código vigente. Si vuelve a fallar, queda bloqueado como «reparación técnica». |
| Otro error no reintentable (4xx) | `BLOCKED` y `draft.blocked` con el código y el mensaje. |
| Reintentable (red, 408, 429, 5xx y `ATTACHMENT_MISSING`, que es un 422 pero significa «aún se está subiendo evidencia») | `RETRY` con backoff 1 s, 2 s, 4 s, 8 s, 30 s y tope de 5 min, con jitter para que veinte conductores que recuperan señal en el mismo punto no reintenten en el mismo milisegundo. |

Cada operación que termina, sea cual sea, intenta `limpiarSiCompleto`: borra
borrador y blobs **solo** si hay recibo y no queda ninguna operación de ese
envío. Borrar antes dejaría un `UPLOAD` sin su blob.

Al arrancar (`startSync`, idempotente; lo llaman el layout y las pantallas), y
antes de mirar el estado, la outbox se repara a sí misma, porque una operación
`BLOCKED` no se reintenta nunca:

- `purgarObsoletasTrasRecibo`: retira los `BACKUP_DRAFT` y `DISCARD_ATTACHMENT`
  de envíos que ya tienen recibo. Eran operaciones rezagadas que dejaban un
  borrador ya entregado en «Necesita corrección» para siempre.
- `rescatarBloqueadosSinBorrador`: devuelve a la cola, una vez por instalación,
  lo bloqueado con `SUBMISSION_NOT_FOUND` por el orden viejo de la cadena.
- `repararBloqueosTecnicos`: intenta una vez reconstruir lo bloqueado por
  `VALIDATION_ERROR`.

El despertar lo dan `online`, `focus`, `visibilitychange`, el socket de
formularios ([forms-portal-socket.ts](../src/lib/offline/forms-portal-socket.ts):
conexión propia con el token del portal; sus eventos solo invalidan y piden un
GET, nunca aplican cambios) y un pulso de 60 s, porque Safari puede congelar
temporizadores durante horas.

Estado observable para la UI:

| Store | Qué dice |
|---|---|
| `syncState` | `phase` (`idle`, `checking`, `syncing`, `offline`, `paused-auth`, `blocked`), operaciones y **envíos** pendientes (un envío con dos fotos son siete operaciones; el conductor cuenta formularios), bloqueados, técnicos, antigüedad de lo más viejo, último error. |
| `colaEnvios` | La cola envío a envío, con código y título (del borrador o, si ya no existe, del recibo), si está bloqueado, si es técnico y si se puede abrir. Lo bloqueado va primero. Un envío que solo tiene pendiente su `DISCARD_DRAFT` no se lista. |
| `receiptEvents` | Último recibo recibido, también desde otras pestañas. |

`SyncStatus` lo pinta en tres variantes (`chip`, `control`, `panel`), siempre
con texto y con la antigüedad de lo pendiente («la más vieja de hace 2 h»), y
**nombra** cada envío en cola con una salida: abrirlo, reintentarlo o
descartarlo (en dos toques sobre el propio botón).

Lo que falta para cumplir del todo la regla de los errores no corregibles: solo
`SyncStatus` distingue «Necesita reparación técnica» de «Necesita corrección».
La tarjeta del borrador en la lista dice «Necesita corrección» y el aviso del
runner «corrige lo señalado» para cualquier bloqueo, también los técnicos.

## Recibos: manda el servidor, IndexedDB es respaldo

«Últimos envíos» en la lista de formularios usa el historial del servidor
(`GET …/formularios/submissions`, ocho como mucho) en cuanto ha respondido una
vez en la sesión: es lo único que prueba que la fila sigue en la base, e
incluye lo enviado desde otro teléfono. Mientras no haya respondido, se cae a
los recibos locales del conductor, con el mismo tope para que la sección no
cambie de tamaño al perder cobertura. Un fallo posterior **no** vacía lo ya
traído. El recibo local también es lo que ve quien acaba de enviar en modo
avión (`envios/pendiente-<id>`), para que la confirmación no dependa de la red.

## Service worker

[src/service-worker.ts](../src/service-worker.ts) lo registra SvelteKit para
toda la app. Lo importante es lo que **no** hace:

- **No intercepta mutaciones.** Ningún `POST`, `PUT` o `DELETE` pasa por él:
  simular un éxito offline haría ver «enviado» algo que no salió del teléfono.
- **No cachea datos personales.** Cache Storage se comparte entre pestañas y
  sobrevive al logout; los datos del conductor viven en IndexedDB.
- **No toca** nada que no sea `GET` del propio origen, nada bajo `/api/`, ni
  URLs con `?token=` (el enlace mágico) o parámetros `X-Amz-*` (URLs firmadas).

Estrategias:

| Petición | Estrategia |
|---|---|
| Assets del build y archivos de `static/` (sin los `.map`) | Precacheados en `install` uno a uno (un fallo no impide instalar) y servidos cache-first: llevan hash en el nombre. |
| Navegación a `/public/portal`, `/formularios`, `/desprendibles`, `/servicios`, `/dias-laborados` y sus subrutas | Stale-while-revalidate: abre al instante con lo cacheado y actualiza por detrás. Solo se cachea una respuesta `ok` del propio origen, nunca una redirección al login. Sin caché ni red, devuelve el shell de formularios o una página mínima «Sin conexión» (503). |
| Todo lo demás | Red, sin caché. |

Las cachés llevan la versión del build en el nombre (`cotransmeq-assets-*`,
`cotransmeq-shell-*`); `activate` borra las viejas del proyecto. `install` hace
`skipWaiting` para que un despliegue no espere a que se cierren pestañas que en
un teléfono pueden durar semanas, pero el JavaScript de una pestaña abierta
sigue siendo el viejo: el layout del portal recarga al detectar el cambio de
worker solo tras 30 s sin interacción (para entonces el autoguardado de 250 ms
ya terminó) o de inmediato si la pestaña está oculta. El mismo worker atiende
los avisos Web Push del dashboard (ver
[tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md)).

## Componentes del portal

| Componente | Para qué |
|---|---|
| [PortalHeader](../src/lib/components/portal/PortalHeader.svelte) | Cabecera de cada pantalla: color de marca, rótulo, título, una línea corta de contexto y la mascota; `acciones` para el chip de sincronización. Misma pieza en todas para que el título no salte al cambiar de pestaña. |
| [PortalSection](../src/lib/components/portal/PortalSection.svelte) | Bloque con título. `tono="accion"` (lo que hay que hacer: tarjetas elevadas) frente a `tono="historial"` (lo ya hecho: fondo hundido, sin sombra). |
| [PortalPage](../src/lib/components/portal/PortalPage.svelte) | Contenedor de la lista de formularios, con el hueco inferior de la barra de navegación. Lleva `max-width: 720px` (800 en escritorio) y `margin: 0 auto`, contra la regla de ancho de [componentes-y-estilos.md](./componentes-y-estilos.md). |
| [SyncStatus](../src/lib/components/formularios/SyncStatus.svelte) | Estado de la outbox; ver arriba. |

El logotipo del portal es `logo_nombre_white.webp`, la versión en blanco para
la barra oscura (`theme-color` `#14532d`); los logos del gemelo no existen
aquí.

## Diferencias con Transmeralda

- Allí la sesión se guarda en `transmeralda_portal_token`, la marca del
  dispositivo en `transmeralda_portal_home` y las cachés del service worker se
  llaman `transmeralda-*`.
- `forms-db.ts`, `forms-sync.ts`, `forms-media.ts` y `forms-portal-socket.ts`
  son idénticos en los dos repos (de ahí los nombres `transmeralda_*` de la
  base y del canal).
- Tras validar el enlace sin parámetros, Transmeralda aterriza en
  **Formularios**; aquí, en Pagos.
- El `enviar()` del runner de allí vuelve a comprobar `enviando` después de la
  confirmación; el de aquí solo lo comprueba al entrar.
- Las páginas `desprendibles` y `dias-laborados` de aquí están formateadas con
  otra indentación; compáralas con `diff -w` antes de replicar un cambio.
