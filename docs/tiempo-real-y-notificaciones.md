# Tiempo real y notificaciones

Cómo recibe el frontend los cambios en vivo y los avisos: las tres conexiones
de Socket.IO, cómo se autentican, a qué salas se une cada pantalla, qué
eventos escucha y qué hace con ellos, la presencia, la reconexión, el contrato
de eventos con el backend y cómo añadir un evento sin romperlo. La segunda
parte cubre la campana, el Web Push y el service worker. Léelo antes de
escuchar o emitir un evento, de tocar `socket.ts` o `socketClient.ts`, o cuando
«el tiempo real no funciona» o un aviso no llega.

El lado del servidor (salas, catálogo de eventos, `SOCKET_AUTH_MODE`) está en
[tiempo-real.md](../../backend-cotransmeq/docs/tiempo-real.md) y el Web Push
del backend en [integraciones.md](../../backend-cotransmeq/docs/integraciones.md).
El protocolo de sockets de formularios dinámicos tiene su documento:
[formularios-dinamicos/README_API_SOCKET.md](./formularios-dinamicos/README_API_SOCKET.md).

## Tres conexiones

| Cliente | Archivo | Servidor | Token del handshake | Quién lo usa |
|---|---|---|---|---|
| `socketManager` / `socketUtils` | [socket.ts](../src/lib/socket.ts) | `VITE_API_URL` | `authStore.getToken()` | Stores y páginas del dashboard. Conecta solo cuando `authStore` tiene token y usuario, y se desconecta al cerrar sesión. |
| `connectSocket()` / `getSocket()` | [socketClient.ts](../src/lib/socketClient.ts) | `VITE_SOCKET_URL`, o el origen del front si falta | `localStorage['transmeralda_token']` (clave heredada del gemelo) | Canvas (`sheet-session`, sesión del historial), `realtimeCollab`, chat de liquidaciones y los modales de envío de terceros. |
| `connectPortalFormsSocket()` | [forms-portal-socket.ts](../src/lib/offline/forms-portal-socket.ts) | `VITE_SOCKET_URL`, o el origen del front si falta | Token del magic link (`portalSession`) | Portal del conductor, `/public/portal/formularios`. |

En producción las dos variables valen lo mismo
(`https://api-cotransmeq.transmeralda.com`, defecto de
[compose.proxmox.yml](../compose.proxmox.yml)), pero son dos: si falta
`VITE_SOCKET_URL`, los canvas y el chat intentan conectar contra el propio
front, donde no hay servidor de Socket.IO, y no conectan nunca sin dar otro
síntoma. Cada `io()` abre su propia conexión, así que una pestaña del dashboard
con un canvas o el chat abiertos mantiene dos. Solo la de `socket.ts` entra en
la sala privada del usuario (`user-<id>`).

Para escuchar desde el dashboard usa `socketUtils`; el socket crudo de
`socketClient.ts` es para los módulos que gestionan sus propias salas.

## Autenticación

- El token viaja en `auth` **como función**, que socket.io vuelve a evaluar en
  cada intento. Antes era un objeto y el token quedaba congelado al crear el
  socket: tras renovar la sesión todos los reintentos llevaban el viejo.
- Si el token cambia (otro login en la pestaña), `socket.ts` rehace la conexión
  desde cero; `connectSocket()` también la rehace si se le pide con otro token.
- El backend lo verifica en `installSocketAuth`
  ([auth.ts](../../backend-cotransmeq/src/sockets/auth.ts)) según
  `SOCKET_AUTH_MODE`: `permissive` (por defecto: verifica, registra y deja
  pasar), `enforce` (rechaza sin token válido) u `off`.
- Un rechazo llega como `connect_error` con «unauthorized: …». El cliente deja
  de reintentar (`socket.io.reconnection(false)`), pasa a estado `rechazado` y
  espera a que cambie la sesión o a que el usuario pulse «Reintentar». **No**
  cierra la sesión: el resto de la aplicación va por HTTP y quien decide eso
  es el interceptor de `apiClient`.
- El servidor no se fía de los ids del payload: la identidad sale del token
  (`resolveActor`). El id que manda `join-dashboard` solo sirve de respaldo
  mientras el modo no sea `enforce`. El portal hace `forms:join` sin
  `conductorId`: el backend lo deriva del token, o cualquiera podría escuchar
  los avisos de otro conductor.

## Salas por pantalla

Los eventos que el backend emite con `io.emit` llegan a todos sin unirse a
nada. Estas son las salas:

| Pantalla | Conexión | Entra con | Sala | Qué recibe por ella |
|---|---|---|---|---|
| Todo el dashboard (al conectar y al cambiar de usuario) | `socket.ts` | `join-dashboard` | `user-<id>` | `nueva-notificacion`, `sesion-cerrada`, progreso de colas (`borrador:*`, `envio-liq:*`), `asistencias:export:progress`, y `recargo-recalculado` y `recargos-bulk-recalc:*` del recálculo masivo |
| `/dashboard/usuarios`, `/dashboard/directorio` | `socket.ts` | `join-dashboard` al montar, `leave-dashboard` al salir | (presencia global) | `usuarios-online` |
| `/dashboard/evaluaciones/[id]` | `socket.ts` | `join-evaluacion` / `leave-evaluacion` | `evaluacion-<id>` | `nueva-respuesta`, `respuesta-actualizada` |
| Canvas de nómina, recorridos, cierres finales, adicionales, ocasional e ingresos | `socketClient.ts` vía `createSheetSession` | `sheet:join`, `sheet:active`, `sheet:leave` | `sheet:<scope>:<año>` (adicionales, ocasional, ingresos) o `sheet:<scope>:<año>:<mes>` (nómina, recorridos, cierres finales) | `sheet:*` y `envio-liquidacion:actualizado` |
| Canvas del historial de liquidaciones de servicios | `socketClient.ts` vía `createHistorialSession` | `sheet:join` con scope `servicios-historial` | `sheet:servicios-historial` (global: el año es una vista) | `sheet:presence`; el resto son eventos globales |
| Canvas de ocasional (además de su sesión de hoja) | `socketClient.ts` vía `realtimeCollab` | `join-room` / `leave-room` | `row:liquidacion-tercero-ocasional:<año>` | `presence:update`, `typing`, `focus`, `row:updated`, `save-success`, `save-error` |
| Chat de una liquidación de tercero | `socketClient.ts` vía `liquidacionChat` | `chat:join` / `chat:leave` | `chat:liquidacion-tercero:<id>` | `chat:*` |
| Portal: formularios | `forms-portal-socket.ts` | `forms:join` / `forms:leave` | `conductor:<id>:forms` | `forms:*` |

La clave de las salas de hoja se calcula igual en los dos lados:
[sheet-room-key.ts](../src/lib/editor/canvas/sheet-room-key.ts) es espejo exacto
de `backend-cotransmeq/src/sockets/sheet-rooms.ts` (su comentario cita la ruta
del gemelo, `backend-nest`). Si divergen, el cliente se une a una sala y el
servidor emite a otra, sin ningún error visible.

Dos cosas que conviene saber de estas salas:

- **`leave-dashboard` saca al usuario de la presencia de todos.** Las páginas
  de usuarios y directorio lo emiten al desmontarse, y el servidor borra al
  usuario de `usuarios-online` aunque siga en otra pantalla del dashboard.
  Vuelve a aparecer con el siguiente `join-dashboard` (una reconexión o un
  cambio de sesión). No sale de `user-<id>`, así que sus avisos privados siguen
  llegando.
- **`join-evaluacion` no se repite al reconectar.** Tras un corte más largo que
  la ventana de recuperación del servidor (abajo), el detalle de la evaluación
  deja de recibir respuestas hasta recargar.

## Eventos que escucha el front

Por dominio. «Recarga» significa que vuelve a pedir la lista por HTTP; el
socket solo avisa.

| Evento | Dónde | Qué hace |
|---|---|---|
| `nueva-notificacion` | [Header.svelte](../src/lib/components/Header.svelte) | La añade a la campana si `usuario_id` es el propio y suma uno a no leídas. |
| `nueva-notificacion` | Páginas de incidentes, mantenimiento y solicitudes | Recarga si `referencia_tipo` es suyo (`incidente…`, `mant:…` o `preop_malo`, `solicitud_web`). |
| `sesion-cerrada` | Layout del dashboard | Modal con cuenta atrás y cierre de sesión (un administrador la cerró). |
| `usuario-deshabilitado` | Página de usuarios | Si es el propio usuario, aviso y `logout()`. Solo la escucha esa página. |
| `usuarios-online` | Usuarios, directorio | Marca quién está en línea. |
| `servicio:creado`, `:actualizado`, `:estado-actualizado`, `:numero-planilla-actualizado`, `:cancelado`, `:eliminado` | [servicios.ts](../src/lib/stores/servicios.ts) | Parche por id de la lista (insertar, reemplazar, quitar). |
| Los mismos salvo `numero-planilla-actualizado` | Página de servicios | Invalida la caché del canvas y lo recarga si está a la vista. |
| `vehiculo-creado`, `vehiculo-actualizado`, `vehiculo-eliminado` | Página de flota | Invalida y recarga. |
| `cliente:created`, `cliente:updated`, `cliente:deleted` | Página de clientes | Recarga. |
| `conductores:actualizacion-masiva` | Página de conductores | Recarga. |
| `dias-laborados:registro-actualizado` | Página de conductores, `TablaDiasLaborados` | Aviso y recarga. En conductores, si la pestaña está oculta, además una notificación local del navegador (`notificarWeb`, sin Web Push). |
| `conductor:foto-actualizada` | Detalle del conductor | Cambia la foto si es el mismo conductor. |
| `recargo-creado`, `recargo-actualizado`, `recargo-recalculado`, `recargo-eliminado`, `recargos-eliminados`, `recargos-estado-actualizado` | Página de recargos (`recargo-recalculado` también en `LiquidacionFormComplete`) | Actualiza la lista y mete el `valor_pagar` del payload en `valoresPagarByRecargoStore`. |
| `recargos-bulk-recalc:progress`, `recargos-bulk-recalc:done` | Página de recargos | Progreso del recálculo masivo en `bulkRecalcStore`, incluido el que sigue a una importación desde Transmeralda. |
| `config-salario-creada`, `-actualizada`, `-eliminada` | `recargos/configuracion` | Resalta la tarjeta y recarga. |
| `liquidacion-servicio-created`, `-updated`, `-deleted`, `-facturada`, `facturacion-created`, `facturacion-anulada`, `liquidacion-tercero-updated` | Página de liquidaciones de servicios | Entrada en el feed (`socketEventLog`, si el payload trae el sobre `_evento` y no es propia) y caché de la pestaña marcada como sucia. |
| Los anteriores y `facturacion-updated` | Canvas del historial de servicios | Parchea las filas de la hoja. |
| `facturacion-created`, `facturacion-updated`, `facturacion-anulada` | Página de cartera | Recarga resumen y facturas. |
| `asistencias:formulario:created`, `:updated`, `:disabled`, `asistencias:respuesta:created`, `asistencias:export:progress` | Páginas de asistencias | Recarga (con aviso) y progreso de la exportación. |
| `nueva-respuesta`, `respuesta-actualizada` | Detalle de evaluación | Añade o sustituye el resultado. |
| `borrador:queued`, `:start`, `:progress`, `:locked`, `:complete`, `:error`, `:cancelled` | [borradorQueue.ts](../src/lib/stores/borradorQueue.ts) | Estado del job de generación de borradores. |
| `envio-liq:queued`, `:start`, `:progress`, `:item`, `:complete`, `:error`, `:cancelled` | [enviosLiquidaciones.ts](../src/lib/stores/enviosLiquidaciones.ts) | Estado del job de envío por correo. |
| `envio-liquidacion:actualizado` | `EnvioHojaModal`, `EnviosCierresModal` | `ENVIADO` o `ERROR` de cada cierre, para todos los que tienen el libro abierto. |
| `chat:message`, `chat:presence`, `chat:typing`, `chat:recordatorio:nuevo`, `chat:recordatorio:estado` | [liquidacionChat.ts](../src/lib/stores/liquidacionChat.ts) | Mensajes, presencia, «escribiendo» y recordatorios. |
| `sheet:presence`, `sheet:patch:applied`, `:ack`, `:conflict`, `:error`, `sheet:invalidate`, `sheet:reverted`, `sheet:estado-changed`, `sheet:sheet-added`, `sheet:sheet-removed`, `sheet:hoja-color` | [sheet-session.svelte.ts](../src/lib/editor/canvas/sheet-session.svelte.ts) | Protocolo de los canvas; ver [canvas-univer.md](./canvas-univer.md). |
| `presence:update`, `typing`, `typing:stop`, `focus`, `row:updated`, `save-success`, `save-error` | [realtimeCollab.ts](../src/lib/stores/realtimeCollab.ts) | Colaboración por fila. También registra `user-joined` y `user-left`, que el backend no emite. |
| `forms:assignment.changed`, `forms:version.published`, `forms:submission.accepted`, `forms:submission.voided`, `forms:attachment.ready` | [forms-portal-socket.ts](../src/lib/offline/forms-portal-socket.ts) | Nunca aplican datos: disparan un GET de reconciliación o despiertan la outbox. Deduplican por `eventId`. |

El front también **emite** `vehiculo-creado`, `vehiculo-actualizado` y
`vehiculo-eliminado` desde los modales de vehículos. El backend no escucha
esos nombres (los emite él mismo desde `vehiculos.events.ts`), así que esas
tres emisiones no hacen nada.

## Presencia

| Dónde | Fuente | Se pinta en |
|---|---|---|
| Dashboard (quién está conectado) | `usuarios-online` | Usuarios y directorio |
| Un libro de canvas | `sheet:presence`, filtrado por la clave de sala; incluye el mes y la hoja de cada uno | `PresenceAvatars` con la prop `users` |
| Una fila (`realtimeCollab`) | `presence:update`, más `typing` y `focus` por campo | `PresenceAvatars` sin prop |
| El chat | `chat:presence` | `ChatPresenceIndicator` |

[PresenceAvatars.svelte](../src/lib/components/PresenceAvatars.svelte) pinta
hasta cuatro iniciales (`maxVisible`) con un color derivado del id, «+N» y
«N en línea». Acepta la lista por prop porque `realtimeCollab` guarda la
presencia a nivel de módulo: con dos canvas en la misma pestaña, ambos
mostraban la del último que se unió. Está escrito en sintaxis legacy
(`export let`, `$:`).

## Reconexión

Los dos clientes compartidos (`socket.ts` y `socketClient.ts`) siguen la misma
estrategia:

| Ajuste | Valor | Por qué |
|---|---|---|
| `reconnectionAttempts` | `Infinity` | Con 5 (o 10) intentos se rendían en 15 s (o un minuto): un despliegue o un `tsx watch` recompilando dejaban el cliente muerto hasta recargar. |
| `reconnectionDelay` / `reconnectionDelayMax` | 1 s / 10 s | Con el techo de 5 s, cien pestañas martilleaban el backend caído. |
| `randomizationFactor` | 0,5 | Jitter: que no reintenten todos en el mismo milisegundo al arrancar el backend. |
| `timeout` (handshake) | 10 s | El defecto de 20 s frenaba el backoff cuando la red caía sin respuesta. |

Además:

- `io server disconnect` (el servidor cerró la conexión) es el único caso en
  que socket.io no reconecta solo: se reintenta a mano.
- **Despertadores.** El backoff es un `setTimeout`, y el navegador congela los
  temporizadores de las pestañas en segundo plano. `visibilitychange`,
  `online`, `focus` y `pageshow` (vuelta desde el bfcache) fuerzan el intento.
- El servidor tiene `connectionStateRecovery` de 2 minutos: tras un corte breve
  devuelve el id, las salas y los paquetes perdidos, y vuelve a verificar el
  JWT. Si se reinició el proceso no hay nada que recuperar.
- **Volver a conectar no es estar al día.** `socketUtils.onReconnect(cb)` y
  `onSocketReconnect(cb)` avisan en cada reconexión (no en la primera
  conexión). Hoy solo `servicios.ts` usa `onReconnect`. Las sesiones de hoja y
  del historial, `realtimeCollab`, el chat y el portal vuelven a unirse a su
  sala en su propio `connect` (las de hoja reenvían además los patches sin
  acuse). Las demás pantallas no releen: lo emitido durante un corte largo se
  pierde hasta recargar.

**Lo que ve el usuario.** `socketStore` expone `estado` (`inactivo`,
`conectando`, `conectado`, `reconectando`, `rechazado`), `intentos` y
`ultimaConexion`. El chip «En vivo» del `Header` pinta ese estado con colores
de semáforo fijos en hex, a propósito fuera de la paleta: aquí `emerald-*` se
remapea a naranja, que sirve para la marca pero no para decir «conectado». A
partir del tercer intento fallido muestra el error; «Reintentar» llama a
`socketManager.reconectar()`, que tira la conexión y levanta otra. En móvil lo
mismo sale como aviso en el layout.

## Alta y baja de listeners

`socketUtils.on()` **devuelve la función de baja**. Úsala:

```ts
onMount(() => {
	const bajas = [socketUtils.on('cliente:created', recargar), socketUtils.on('cliente:updated', recargar)];
	return () => bajas.forEach((baja) => baja());
});
```

- `off(evento)` sin handler quita los listeners de ese evento de **todos** los
  módulos que comparten el socket. Ya rompió la tabla de días laborados al
  salir de conductores. Ahora deja un aviso en consola.
- Hasta septiembre de 2026 `on()` registraba un envoltorio y `off(evento, cb)`
  no daba de baja nada: cada visita a una página sumaba un listener. Lo fija
  [tests/socket-listeners.test.ts](../tests/socket-listeners.test.ts).
- Con el socket crudo de `socketClient.ts`, guarda la referencia del handler y
  haz `off(evento, handler)`; las sesiones de hoja hacen además `off` antes de
  `on` para no duplicar si se recrean.

## Contrato de eventos con el backend

El desajuste de nombres no da ningún síntoma: la lista simplemente no se
actualiza hasta recargar. Pasó con servicios (el módulo no emitía nada y el
store tenía seis listeners), con flota (escuchaba `vehiculo-creado` y el
backend emitía `vehiculo:oculto`) y con 24 eventos que nadie recogía. De ahí el
contrato:

- **Tablas `EVENTOS_*`.** Los módulos migrados declaran sus nombres en un único
  sitio, `src/modules/<x>/<x>.events.ts`, como
  `export const EVENTOS_SERVICIO = { creado: 'servicio:creado', … } as const`,
  y emiten a través de una función `emitir()` que se traga el fallo (`getIo()`
  lanza si Socket.IO no está montado, como en los tests, y un aviso perdido no
  debe deshacer una operación ya guardada). Hoy: `servicios.events.ts`,
  `vehiculos.events.ts` y `clientes.events.ts`. Los nombres se tomaron de lo
  que el front ya escuchaba. `formularios-dinamicos.events.ts` tiene su tabla
  como `FORM_EVENTS` y emite **después del commit** con payloads de solo ids.
- **El test** [contrato-eventos.test.ts](../../backend-cotransmeq/tests/contrato-eventos.test.ts)
  (con [escanear-eventos.ts](../../backend-cotransmeq/tests/helpers/escanear-eventos.ts))
  lee el texto del backend (`src/**/*.ts`: `.emit('x'`, `emit(destino, 'x'`,
  helpers `emitAlgo('x'` y las tablas `EVENTOS_*`) y el de este repo
  (`../cotransmeq-app/src`, solo los archivos que mencionan `socketUtils`,
  `socketManager`, `socketClient`, `getSocket(` o `socketStore`, buscando
  `.on('x'`). Comprueba que:
  1. ningún listener del front espera un evento que nadie emite (salvo los de
     `EMITIDOS_INDIRECTAMENTE`, cada uno con su motivo; hoy dos de asistencias
     cuyo nombre sale de un ternario);
  2. los nombres siguen una de las convenciones admitidas: `dominio:accion`,
     `dominio:sub:accion`, `kebab-plano` o `forms:assignment.changed`;
  3. ningún nombre se construye interpolando (`` `algo:${x}` ``);
  4. y deja en consola, sin fallar, cuántos eventos se emiten sin consumidor.
- **Lo que no ve**, porque el escaneo es textual: nombres guardados en una
  variable o en un mapa. No cubre los listeners de `realtimeCollab` (mapa de
  handlers), las sesiones de hoja (`bind('sheet:…')`) ni los `FORM_EVENTS` del
  portal; por eso `user-joined` y `user-left` siguen escuchándose sin que nadie
  los emita.

El test corre dentro de la suite del backend, que exige una base desechable
(ver [pruebas.md](../../backend-cotransmeq/docs/pruebas.md)); el test en sí no
toca la base. Para correr solo ese archivo, desde `backend-cotransmeq`:

```bash
npx vitest run tests/contrato-eventos.test.ts
```

### Añadir un evento nuevo

1. **Nombre.** Elige una de las convenciones admitidas; para lo nuevo,
   `dominio:accion` o `dominio:sub:accion`. Siempre literal.
2. **Backend.** Decláralo en la tabla `EVENTOS_<DOMINIO>` del `.events.ts` del
   módulo (créalo si no existe, copiando `servicios.events.ts`) y emite con su
   `emitir()`, fuera de la transacción. Si es para una persona, a su sala
   (`emitToUser(id, …)`); si es de un libro, a la sala del libro. Nada de datos
   personales en un `io.emit` global.
3. **Front.** Escúchalo con el nombre literal y `socketUtils.on(...)` desde un
   store o una página, guardando la baja. Si llega por una sala, asegúrate de
   que la pantalla se une y de que vuelve a unirse al reconectar. Si la
   pantalla mantiene una lista viva, relee con `socketUtils.onReconnect`.
4. **Orden.** Un listener sin emisor hace fallar el test: añade los dos lados
   en el mismo cambio (o el emisor primero). Para renombrar, cambia los dos
   extremos a la vez; el test no avisa de un emisor que se quedó sin oyente.
5. **Gemelo.** Lo mismo en `backend-nest` e `ingreso-svelte`; su test escanea
   `../ingreso-svelte`.

## Notificaciones

### La campana

[notificaciones.ts](../src/lib/stores/notificaciones.ts) guarda las últimas
notificaciones y el contador de no leídas. El `Header`, al montar:

1. `cargar()` (`GET /api/notificaciones?page=1&limit=30`) e `iniciarPolling()`:
   cada 60 s vuelve a pedir solo el contador (`GET /api/notificaciones/no-leidas`).
2. Escucha `nueva-notificacion` y la añade arriba.
3. Escucha los mensajes del service worker y llama a `sincronizarWebPush()`.
4. Si la URL trae `#aviso=<id>` (ventana abierta desde un aviso con la app
   cerrada), la marca como leída y limpia el hash.

Al pulsar una, `rutaDeNotificacion`
([rutaNotificacion.ts](../src/lib/notificaciones/rutaNotificacion.ts)) decide
a qué pantalla llevar según el tipo y la referencia. Marcar como leída es
`PATCH /api/notificaciones/:id/leida` (y `/marcar-todas`). El cliente HTTP de la
campana ([api/notificaciones.ts](../src/lib/api/notificaciones.ts)) usa
`fetch` directo, ver [cliente-api.md](./cliente-api.md#otras-formas-de-llamar-al-backend).

En el backend, `emitNotificacion()`
([sockets/index.ts](../../backend-cotransmeq/src/sockets/index.ts)) hace dos
cosas: manda el Web Push (aunque no haya socket: es para quien no tiene la app
abierta) y emite `nueva-notificacion` a la sala `user-<usuario_id>`. Antes era
un `io.emit` global filtrado en el navegador, y cada cliente recibía las
notificaciones de todos.

### Web Push

[webPush.ts](../src/lib/notificaciones/webPush.ts), con el interruptor
[AvisosNavegador.svelte](../src/lib/components/notificaciones/AvisosNavegador.svelte)
encima del historial de notificaciones:

| Paso | Qué pasa |
|---|---|
| Soporte | `serviceWorker`, `PushManager` y `Notification` en el navegador; si no, `no-soportado`. |
| Clave | `GET /api/notificaciones/web-push/clave` devuelve `{ clave }`, la pública VAPID en base64url, o `null`. Se pide una vez por carga de página. |
| Activar | Solo desde un clic: el navegador bloquea las peticiones de permiso espontáneas. `Notification.requestPermission()`, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` y `POST /web-push/suscripcion`, que la guarda en `usuario_web_push`. Si la suscripción existente se hizo con otra clave (VAPID rotada), se da de baja y se crea otra. |
| Al entrar | `sincronizarWebPush()`: si el permiso ya estaba concedido, reasigna la suscripción al usuario de la sesión actual. El permiso es del navegador, no de la cuenta. Nunca pide permiso. |
| Desactivar | `POST /web-push/desuscribir` y `unsubscribe()`. |
| Cerrar sesión | `desuscribirAlCerrarSesion()`, con `keepalive`, solo en el cierre explícito: el siguiente usuario del equipo no recibe los avisos del anterior. Si la sesión expira sola, los avisos siguen, que es cuando más sirven. |
| Probar | `POST /web-push/prueba` reenvía la última notificación como aviso forzado. |

No pidas permiso de notificaciones al cargar una página: el navegador bloquea
o penaliza las peticiones que no salen de un clic, y pedir permiso no suscribe
nada al Web Push. La página de conductores todavía lo pide en su `onMount`,
para sus avisos locales de días laborados.

### Service worker

[service-worker.ts](../src/service-worker.ts) lo registra SvelteKit
automáticamente. Sirve a dos cosas:

- **Avisos.** En `push`, si hay una pestaña del dashboard visible y con el foco
  no muestra nada (la campana ya avisó por socket), salvo que el aviso venga
  forzado; si no, `showNotification` con `tag` igual al id (un duplicado
  reemplaza en vez de apilar) y `renotify`. En `notificationclick`, si hay una
  ventana del dashboard la enfoca y le manda `ABRIR_NOTIFICACION` (el `Header`
  la marca y navega con `goto`, sin recargar lo que haya a medias); si no, abre
  la ruta de destino con `#aviso=<id>`.
- **Caché del portal offline** (`cotransmeq-assets-*`, `cotransmeq-shell-*`):
  precarga los assets del build y sirve el shell del portal sin red. Nunca
  intercepta la API, mutaciones ni URLs firmadas. Ver
  [portal-del-conductor.md](./portal-del-conductor.md).

### Sin VAPID configurado

Si al backend le falta `VAPID_PUBLIC_KEY` o `VAPID_PRIVATE_KEY` (o no son
válidas), `webPushHabilitado()` devuelve `false` y:

- `GET /web-push/clave` responde `{ clave: null }`; `/suscripcion` y `/prueba`,
  `503` («Los avisos del navegador no están configurados»); `enviarWebPush` no
  manda nada.
- En el front, `estadoWebPush()` da `no-configurado` y el interruptor
  **desaparece**; `sincronizarWebPush()` no hace nada. No se muestra ningún
  error.
- La campana funciona igual, por socket y por el sondeo de 60 s. Lo único que
  se pierde son los avisos del sistema operativo con la app cerrada.

Con las claves puestas, revisa también `VAPID_SUBJECT` en el backend: el
`web-push.service.ts` es el mismo que el del gemelo y, si falta, firma con
`mailto:sistemas@transmeralda.com`.

## Diferencias con Transmeralda

El código de tiempo real es idéntico en los dos repos (`socket.ts`,
`socketClient.ts`, `forms-portal-socket.ts`, `webPush.ts`, las sesiones de
hoja) y también el del backend (`sockets/`, `*.events.ts`, `web-push.service.ts`).
Cambia:

| | Cotransmeq | Transmeralda |
|---|---|---|
| Servidor de sockets (`VITE_API_URL`, `VITE_SOCKET_URL`) | `https://api-cotransmeq.transmeralda.com` | `https://api.transmeralda.com` |
| Test de contrato | `backend-cotransmeq` escanea `../cotransmeq-app` | `backend-nest` escanea `../ingreso-svelte` |
| Cachés del service worker | `cotransmeq-assets-*`, `cotransmeq-shell-*` | `transmeralda-assets-*`, `transmeralda-shell-*` |
| Colores | Chip «En vivo» `#15803d`; avatares `#16a34a` y `#ea580c` en vez de `#079665` y `#f97316` | Chip `#087a57`; avatares empiezan en `#079665` |
