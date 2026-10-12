# Estado y stores

Dónde vive el estado del frontend: los stores compartidos de
`src/lib/stores/` (qué guarda cada uno, quién lo usa y qué persiste en el
navegador), las fábricas con runes de los `.svelte.ts`, la convivencia de
Svelte 5 con el código legacy y las tres trampas de runes que ya han mordido.
Léelo antes de crear un store, de guardar algo en `localStorage` o de migrar
una página a runes.

Dos temas tienen su propio documento: el estado de filtros y paginación, cuya
fuente de verdad es la URL, en [listados-y-filtros.md](./listados-y-filtros.md);
y el almacenamiento offline del portal (IndexedDB y outbox), en
[portal-del-conductor.md](./portal-del-conductor.md). Los stores que reciben
eventos de socket se repasan también en
[tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md).

## Dónde va cada cosa

| Estado | Dónde | Ejemplo |
|---|---|---|
| Filtros, búsqueda, orden, página | La URL, con `src/lib/listing/` | `?q=renault&pagina=3` |
| Local de un componente | `$state` / `$derived` en el propio componente | un modal abierto, un input |
| Compartido entre componentes o rutas | Store de `svelte/store` en `src/lib/stores/` | sesión, campana, cola de borradores |
| Un objeto con ciclo de vida (se crea y se destruye con la pantalla) | Fábrica con runes en un `.svelte.ts` | sesión de un canvas, runner de un formulario |
| Lista de una página con caché | `crearListingStore` de [listingStore.ts](../src/lib/listing/listingStore.ts) | flota, clientes, conductores, terceros |
| Borradores y envíos del portal | IndexedDB, en [forms-db.ts](../src/lib/offline/forms-db.ts) | base `transmeralda_forms_v1` (nombre heredado del gemelo) |

El servidor es la fuente de verdad de los datos de negocio. Lo que el front
guarda son cachés con caducidad (5 min `recursos` y `servicios`, 10 min
`municipios`, 60 s las listas de `listingStore` y las pestañas de
liquidaciones de servicios) o copias de respaldo.

**Por qué los stores compartidos siguen siendo `writable` clásicos.** Una
página puede estar en modo runes o en modo legacy (Svelte 5 lo decide por
componente), y hoy conviven las dos. La suscripción automática `$store`
funciona en ambos modos; un `$state` exportado desde un `.svelte.ts`, en
cambio, no dispara los bloques `$:` de una página legacy. Con un store se
puede migrar página por página. Lo explican los comentarios de
[listingStore.ts](../src/lib/listing/listingStore.ts) y
[liquidacionesServiciosCache.ts](../src/lib/stores/liquidacionesServiciosCache.ts).

## Stores de `src/lib/stores/`

«Memoria» significa que vive en el módulo y se pierde al recargar.

| Archivo | Qué guarda | Quién lo usa | Persistencia |
|---|---|---|---|
| [acciones-correctivas.ts](../src/lib/stores/acciones-correctivas.ts) | `step4Store` (aprobaciones del paso 4), `step5Store` (estado global del paso 5) y `causaCambioStore`, un contador que hace de bus para que el paso 5 recalcule cuando cambian las causas. Más tablas de flujo de aprobación. | `FormularioAccion`, `Step4Approval`, `Step5ActionStatus` | Memoria |
| [asistencias.ts](../src/lib/stores/asistencias.ts) | `asistenciasStore`: formularios de asistencia con un indicador temporal de alta o cambio. | Nadie lo importa: residuo. | Memoria |
| [asistente.ts](../src/lib/stores/asistente.ts) | `asistenteAbierto`, `railConAsistente` y `conversacion` del asistente de IA. Fuera del panel para que la conversación sobreviva a la navegación. | Componentes de `asistente/`, `UniverSideRail`, layout del dashboard | Memoria |
| [auth.ts](../src/lib/stores/auth.ts) | `authStore`: `{ user, token, isLoading, error }` con `init`, `login`, `logout`, `hasPermission`, `getAccessLevel`, `hasBonosPlanilla`, `updateUserPermisos`. | 56 archivos: `apiClient`, sockets, layouts, guardas de pantalla | `localStorage`: `transmeralda_token`, `transmeralda_user` y `redirect_after_login`. Cookie `transmeralda_token` (7 días, `SameSite=Strict`) para la guardia de `hooks.server.ts` y las rutas `/api/maps/*`. Los nombres son heredados del gemelo. |
| [borradorQueue.ts](../src/lib/stores/borradorQueue.ts) | `borradorQueueStore` (estado del job de generación de borradores de liquidaciones de terceros: progreso, bloqueo por periodo, resultado) y `borradorQueue` (iniciar, cancelar, `onComplete`, `status`). Escucha `borrador:*`. | `GenerarBorradoresModal`, `BorradorProgressModal` | Memoria; el job vive en el servidor y se puede reconsultar |
| [conductor-servicios.ts](../src/lib/stores/conductor-servicios.ts) | Servicios del conductor y el detalle abierto, cargados con `portalFetch`. Paleta de estados y formateadores. | `public/portal/servicios/**` | Memoria |
| [confirm.ts](../src/lib/stores/confirm.ts) | `confirmActual` y las promesas `confirmar()`, `pedirTexto()`, `confirmarEliminacion()`, que sustituyen al `confirm()` del navegador. Las pinta un único `ConfirmHost` en el layout raíz. | 50 archivos | Memoria |
| [enviosLiquidaciones.ts](../src/lib/stores/enviosLiquidaciones.ts) | `enviosLiqStore` y `enviosLiqQueue`: job de envío por correo de liquidaciones de terceros. Escucha `envio-liq:*`. | `EnvioHojaModal`, `EnviosCierresModal` | Memoria; la constancia queda en `liquidacion_tercero_envio` |
| [flota.ts](../src/lib/stores/flota.ts) | `flotaStore`: lista de vehículos con `add/update/removeVehiculo`. | Lo escriben `ModalFormVehiculo` y `ModalConfirmDelete`, pero nadie lo lee: la página de flota usa `listingStore`. Residuo. | Memoria |
| [formularioAbierto.ts](../src/lib/stores/formularioAbierto.ts) | Contador de formularios tipo hoja abiertos; `hayFormularioAbierto` sube los toasts para no tapar el pie del modal en móvil. | `ModalEntidad`, `ModalTanqueo`, `ModalFormServicio`, `ToastProvider` | Memoria |
| [guia.ts](../src/lib/stores/guia.ts) | `guiaActiva`: guía paso a paso en curso (`iniciarGuia`, `irAPaso`, `terminarGuia`). | `AsistentePanel`, `GuiaVisor` | Memoria |
| [liquidacionChat.ts](../src/lib/stores/liquidacionChat.ts) | Chat de una liquidación de tercero: mensajes, presencia, «escribiendo», recordatorios, no leídos. Singleton de módulo con su propio `subscribe/getState` (no el contrato de Svelte). Usa el socket de `socketClient.ts`. | Componentes de `chat/` | `localStorage`: `liq-chat-panel:<liquidacionId>` (panel abierto) y `liq-chat-unread:<liquidacionId>` (no leídos) |
| [liquidacionesServiciosCache.ts](../src/lib/stores/liquidacionesServiciosCache.ts) | Caché por pestaña (`liquidaciones`, `facturas`, `terceros`, `configuracion`) de `/dashboard/liquidaciones-servicios`: datos, firma de filtros, TTL de 60 s, «sucio» por socket. | Esa página; `socketEventLog.ts` toma sus tipos | Memoria |
| [mobileDrawer.ts](../src/lib/stores/mobileDrawer.ts) | Menú lateral abierto en móvil. | `Header`, `Sidebar` | Memoria |
| [municipios.ts](../src/lib/stores/municipios.ts) | Catálogo de municipios y por departamento, con opciones derivadas. Caché de 10 min. | `ModalReporteIncidente`, `ModalFormRecargo`, `ModalFormServicio`, `routes/test-municipios` | Memoria |
| [notificaciones.ts](../src/lib/stores/notificaciones.ts) | Campana: hasta 50 notificaciones en memoria, contador de no leídas, sondeo de 60 s. | `Header`, `ModalNotificaciones` | Memoria |
| [portalStore.ts](../src/lib/stores/portalStore.ts) | `portalSession` (token del magic link, conductor, `expiresAt`) y derivados (`isAuthenticated`, `conductorNombre`, `conductorCedula`, `diasRestantes`); `portalFetch`, `portalFetchBlob`, `expirarSesionPortal`, marca de dispositivo. | 18 archivos: pantallas del portal, `formularios-portal.ts`, outbox, socket del portal, `auth.ts` | `localStorage`: `cotransmeq_portal_token` (la sesión en JSON; se descarta al cargar si venció) y `cotransmeq_portal_home` (`'1'`: «aquí entra un conductor»; sobrevive al logout, la borra un login administrativo) |
| [realtimeCollab.ts](../src/lib/stores/realtimeCollab.ts) | Colaboración por fila (`row:<tabla>:<id>`): presencia, «escribiendo», foco, estado de guardado y cola de cambios que sale por `row:save`. Singleton de módulo con `subscribe/getState`. | `PresenceAvatars`, `AutosaveIndicator`, `totales.service.ts` y los canvas de terceros (casi todos solo para `setSaveStatus`; el de ocasional además hace `joinRoom`) | Memoria |
| [recargos.ts](../src/lib/stores/recargos.ts) | `recargosStore` (planillas, filtros, CRUD, aborto de peticiones), `valoresPagarByRecargoStore` (id → valor a pagar, alimentado por la API y por el socket) y `bulkRecalcStore` (recálculo masivo en curso, incluido el que sigue a una importación desde Transmeralda). | Página de recargos, `ModalFormRecargo` | `localStorage` `recargos.bulkRecalc.v1`: solo `batchId`, ids, total y `startedAt`, para reengancharse al lote tras recargar |
| [recursos.ts](../src/lib/stores/recursos.ts) | Catálogos para selectores: conductores, vehículos y clientes (`/api/servicios/filtros/*`) y municipios. Caché de 5 min. | `ModalFormRecargo`, `ModalFormServicio`, `ModalAnticipo`, `ModalGastoEmpresa`, página de servicios | Memoria |
| [servicio-detalle.ts](../src/lib/stores/servicio-detalle.ts) | Un servicio por id. | `dashboard/servicios/[id]` | Memoria |
| [servicios.ts](../src/lib/stores/servicios.ts) | `serviciosStore`: lista, seleccionado, catálogos, estadísticas, paginación (caché de 5 min) y parche por id con los eventos `servicio:*`. Es el único que relee al reconectar el socket. | Páginas de servicios, `CalendarServicio`, `ModalFormServicio`, `ModalTicket` | Memoria |
| [sidebar.ts](../src/lib/stores/sidebar.ts) | Barra lateral colapsada. | `Header`, layout del dashboard, páginas de acciones correctivas y `servicios/[id]` | `localStorage` `transmeralda_sidebar_collapsed` (nombre heredado) |
| [socketEventLog.ts](../src/lib/stores/socketEventLog.ts) | Feed de hasta 50 eventos de socket de liquidaciones de servicios («Juan pasó LS-045 de BORRADOR a LIQUIDADA»), con `eventosSinVer`. | `SocketEventLogBar`, página de liquidaciones de servicios | Memoria |
| [toast.ts](../src/lib/stores/toast.ts) | API histórica `toast.success(...)`, hoy sobre svelte-sonner. Su `subscribe` está vacío: se conserva por compatibilidad. | 17 archivos | Sin estado |
| [ubicaciones-frecuentes.ts](../src/lib/stores/ubicaciones-frecuentes.ts) | Store «preparatorio» de ubicaciones frecuentes. | Nadie lo importa: residuo. | Memoria |
| [univerShell.ts](../src/lib/stores/univerShell.ts) | Contador de canvas de Univer montados; `enUniverShell` sube los toasts sobre la barra de pestañas. Contador y no booleano porque al pasar de un canvas a otro los dos layouts coexisten un instante. | `UniverShell`, `ToastProvider` | Memoria |
| [volverLiquidaciones.ts](../src/lib/stores/volverLiquidaciones.ts) | Última URL del listado de liquidaciones de servicios (envoltorio de `volverListado`). | `LiquidacionEditor`, páginas de liquidaciones de servicios | `sessionStorage` `/dashboard/liquidaciones-servicios:listado` |
| [volverListado.ts](../src/lib/stores/volverListado.ts) | `memoriaListado(base)`: última URL de cada listado, con filtros, para el «Volver» del detalle. Solo devuelve URLs del propio listado. | 22 archivos | `sessionStorage` `<ruta>:listado` o `<ruta>:listado:<sufijo>` (sobrevive a recargar el detalle y no se cruza entre pestañas) |

Fuera de esta carpeta también hay estado compartido:
`socketStore` en [socket.ts](../src/lib/socket.ts) (estado de la conexión en
tiempo real), `syncState`, `receiptEvents` y `colaEnvios` en
[forms-sync.ts](../src/lib/offline/forms-sync.ts) (outbox del portal) y las
listas con caché de [listingStore.ts](../src/lib/listing/listingStore.ts).

Otras claves de navegador que no pertenecen a un store: `chunk_reload_until` y
`chunk_reload_count` (`sessionStorage`, recuperación de chunks viejos tras un
despliegue en `hooks.client.ts`), `liq_pdf_zoom` (`sessionStorage`,
`LiquidacionEditor`), `primas_cache` y `primas_portal_visibility`
(`sessionStorage`, `nomina.ts`), y en `localStorage`
`prima_email_queue_mock` (`nomina.ts`), `tpdf-preview-cols:v3:<scope>`
(columnas del preview de terceros), `liq-banner-dismissed:<id>`,
`evaluacion_en_progreso` y el borrador local del formulario de acciones
correctivas.

### Reglas para un store nuevo

- **Antes de crear uno, mira si es estado de URL.** Un filtro, una pestaña o
  una página van en la URL; un store los pierde al compartir el enlace.
- `writable` clásico con métodos con nombre (`cargar`, `marcarLeida`…), como
  los existentes. Así sirve a páginas en los dos modos.
- **Nada de datos personales en `localStorage`.** Sobrevive al logout y lo lee
  el siguiente que use el equipo. Lo que se persiste hoy son tokens, la ficha
  del usuario de la sesión, preferencias de interfaz y punteros a jobs.
- Toda lectura de `localStorage` o `sessionStorage` dentro de `try/catch` o
  detrás de `browser`: en SSR no existen y en modo privado pueden lanzar.
- Si escucha socket, guarda la función de baja que devuelve `socketUtils.on()`
  y llámala al destruir (ver
  [tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md)).
- Las claves del portal ya tienen nombre propio (`cotransmeq_…`); las
  heredadas con `transmeralda_` no se pueden renombrar sin migrar lo que ya
  está guardado en los navegadores: cambiar `transmeralda_token` a secas
  cerraría la sesión de todo el mundo.

## Svelte 5 en este repo

El repo está a medio migrar y conviven los dos modos. Recuento orientativo del
11-oct-2026 sobre los 373 `.svelte`:

| Rasgo | Archivos |
|---|---|
| `$props()` | 193 |
| `$state` | 196 |
| `export let` (props legacy) | 67 |
| `$:` (reactivo legacy) | 71 |
| `import ... from '$app/stores'` (legacy) | 53 |
| `import ... from '$app/state'` | 30 |
| `createEventDispatcher` | 24 |

Lo que piden las convenciones ([AGENTS.md](../AGENTS.md)):

- Componentes nuevos con runes: `$props`, `$state`, `$derived`,
  `$derived.by`, `$effect`. Nada de `$:` en código nuevo; lo existente se migra
  cuando se toca.
- `page` desde `$app/state`, no `$app/stores`: el store legacy no propaga bien
  en modo runes.
- Un componente es de un modo o del otro: en cuanto usa un rune, `export let` y
  `$:` dejan de valer en ese archivo. Migrar una página es migrarla entera.
- Cuidado al migrar código legacy que mutaba y reasignaba
  (`set = set`): en legacy funciona por la asignación; en runes no (ver la
  segunda trampa). [recargos/configuracion](../src/routes/dashboard/recargos/configuracion/+page.svelte)
  lo hace hoy con dos `Set` y por eso no puede pasarse a runes sin tocarlo.
- `$effect` con `untrack` cuando el efecto lee algo de lo que no debe depender;
  el patrón de referencia es el de los listados (escribir la URL dependiendo
  de la firma de los filtros y no de `page.url`).

**Fábricas con runes en `.svelte.ts`.** Los objetos que nacen y mueren con una
pantalla se escriben como función que crea el estado y devuelve **getters**:
`createSheetSession` y `createHistorialSession` (sesiones de canvas,
`src/lib/editor/canvas/`), la cola de escrituras
([cola-escritura.svelte.ts](../src/lib/editor/canvas/cola-escritura.svelte.ts)),
`createRunnerState` y `createBuilderStore` (`src/lib/formularios/`). Devolver
`get presence() { return presence; }` y no el valor suelto es lo que mantiene la
reactividad: desestructurar el objeto copia el valor del momento.

**Singletons con suscripción propia.** `realtimeCollab.ts` y
`liquidacionChat.ts` exponen `subscribe(fn)` y `getState()`, pero `fn` no
recibe el valor: no cumplen el contrato de store y `$realtimeCollab` no
funciona. El componente se suscribe y vuelve a leer con `getState()`.
`PresenceAvatars` acepta además la lista por prop, porque el singleton guarda
una sola sala por pestaña.

## Tres trampas de runes que ya han mordido

Están en [AGENTS.md](../AGENTS.md); aquí con un ejemplo cada una.

**1. Un `$state` es un proxy: leer el objeto no suscribe a sus propiedades.**
`void filtros` bastaba en modo legacy; con runes el efecto depende de la
variable, no de sus campos, y no vuelve a correr cuando cambia `filtros.q`. La
lista se filtraba y la URL se quedaba congelada.

```ts
// ✗ no se vuelve a ejecutar al cambiar filtros.q
$effect(() => { void filtros; escribirUrl(); });

// ✓ depende de algo que lee todos los campos
$effect(() => { void firma(DEFS, filtros); escribirUrl(); });
```

**2. Los `Set` y `Map` no se proxifican.** Mutarlos en sitio y reasignar la
misma referencia no es un cambio: no repinta nada.

```ts
// ✗ misma referencia
seleccion.add(id);
seleccion = seleccion;

// ✓ una instancia nueva
const siguiente = new Set(seleccion);
siguiente.has(id) ? siguiente.delete(id) : siguiente.add(id);
seleccion = siguiente;
```

El repo usa las dos salidas válidas: copiar y reasignar
([runner-state.svelte.ts](../src/lib/formularios/runner-state.svelte.ts) con
sus `Map` de respuestas y ocurrencias) o `SvelteSet` de `svelte/reactivity`
([ItemsDisponiblesModal.svelte](../src/lib/components/liquidaciones-terceros/ItemsDisponiblesModal.svelte)).

**3. El tipo va en el rune, no en la variable.** Con la anotación sobre la
variable, TypeScript infiere el tipo a partir del valor inicial y la variable
se estrecha hasta `never`, con errores de `svelte-check` lejos de la
declaración.

```ts
// ✗
let seleccionado: Servicio | null = $state(null);

// ✓
let seleccionado = $state<Servicio | null>(null);
```

## Diferencias con Transmeralda

Los 29 stores existen en los dos repos y son idénticos salvo
`portalStore.ts`, que aquí usa `cotransmeq_portal_token` y
`cotransmeq_portal_home` (en el gemelo, `transmeralda_portal_token` y
`transmeralda_portal_home`), además de diferencias de formato. El resto de
claves de navegador coincide de nombre con el gemelo, incluidas
`transmeralda_token`, `transmeralda_user`, la cookie `transmeralda_token`,
`transmeralda_sidebar_collapsed` y la base IndexedDB `transmeralda_forms_v1`:
el código es el mismo, y no chocan porque cada despliegue tiene su propio
origen. Los recuentos de Svelte 5 de arriba son de este repo; en el gemelo son
parecidos.
