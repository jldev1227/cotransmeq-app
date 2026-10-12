# Canvas Univer

Las hojas tipo Excel del dashboard: qué canvas hay, cómo se monta una página de
canvas, cómo se reparten el trabajo el engine, los builders, los bindings, los
adapters y los permisos de celda, y las trampas que ya costaron horas (el eco
infinito, el autofiltro sin botón, los submenús que no se abren). Léelo antes
de tocar `src/lib/components/univer/`, `src/lib/editor/**` o una ruta
`**/canvas/`.

**Este repo tiene Univer completo.** Hubo una época en que no, y el `AGENTS.md`
del gemelo (`ingreso-svelte`) todavía dice que `cotransmeq-app` no tiene canvas:
está desactualizado. Aquí están los mismos paquetes `@univerjs/*` (todos en
`^0.25.1`), las mismas rutas y prácticamente el mismo `src/lib/editor/`, y los
cambios de canvas se replican entre los dos repos como cualquier otro.

Univer pinta en un `<canvas>` con WebGL: no hay DOM dentro de la hoja ni forma
de inspeccionarla con el inspector del navegador. Casi todo lo raro de este
módulo sale de ahí y de las particularidades de Univer 0.25.1.

Relacionados: el desprendible y la vista previa a PDF en
[documentos-y-pdf.md](./documentos-y-pdf.md); presencia y sockets en
[tiempo-real-y-notificaciones.md](./tiempo-real-y-notificaciones.md); los
permisos por módulo en [autenticacion-y-permisos.md](./autenticacion-y-permisos.md).

## Qué canvas hay

| Canvas | Ruta | Módulo (guardia) | Libro | Engine y builder | Persistencia |
|---|---|---|---|---|---|
| Nómina | `/dashboard/nomina/canvas` | `nomina` | Un periodo; una hoja por conductor | `nomina-engine.ts`, `nomina.builder.ts` | Patches por celda por `sheet-session` (scope `nomina`, room por año y mes). Historial de versiones, vista previa del desprendible, PDF, ZIP, envío y aviso a los conductores |
| Primas | `/dashboard/nomina/primas/canvas` | `nomina` | — | **No monta Univer**: usa la cáscara de canvas (pantalla completa y «Ir a…») con un listado normal | REST |
| Análisis | `/dashboard/nomina/analisis/canvas` | `nomina` | — | **No monta Univer**: filtros, cifras y gráficas de `chart.js` sobre `GET /api/nomina/analisis` | Solo lectura |
| Recorridos | `/dashboard/conductores/recorridos` | `recorridos` | Un corte (`?desde=&hasta=`); una hoja por conductor y una fila por tramo | `recorridos-engine.ts`, `recorridos.builder.ts` | Patches por `sheet-session` (scope `recorridos`); las filas nuevas son borradores locales hasta tener lo mínimo y se dan de alta por REST. Historial de versiones |
| Cierres finales de terceros | `/dashboard/liquidaciones-terceros/canvas` | `liquidaciones-terceros` | Un periodo; una hoja por par placa-propietario | `cierres-finales-engine.ts`, `cierres-finales.builder.ts` | Patches por `sheet-session` (scope `cierres-finales`); el servidor recalcula y devuelve todas las filas afectadas, el cliente solo pinta. Colores de pestaña por `cola-escritura` |
| Adicionales | `/dashboard/liquidaciones-terceros/adicionales/canvas` | `liquidaciones-terceros-adicionales` | Un año; doce hojas | `adicionales-engine.ts`, `adicionales.builder.ts` | Patches por celda por `sheet-session` (scope `adicionales`, room por año). Historial de versiones |
| Ocasional | `/dashboard/liquidaciones-terceros/ocasional/canvas` | `liquidaciones-terceros` | Un año; doce hojas, una cabecera por mes | `ocasional-engine.ts`, `ocasional.builder.ts` | Documento del mes por REST (`guardarBorrador`); anotaciones por `sheet-session`. Historial de versiones. Las filas extra de gastos de vehículo se dan de alta desde `ModalGastosVehiculo` |
| Ingresos | `/dashboard/liquidaciones-terceros/ingresos/canvas` | `liquidaciones-terceros` | Un mes; hojas INGRESOS y ADICIONALES | `ingresos-terceros-engine.ts`, `ingresos-terceros.builder.ts` | La tabla es derivada; la capa editable (INCLUIR, cantidades, conceptos del pie) por REST (`guardar`); anotaciones por `sheet-session` |
| Liquidaciones de servicios | `/dashboard/liquidaciones-servicios/canvas` | `liquidaciones-servicios` | Todo el histórico; hojas Liquidaciones, Facturas y Terceros | `servicios-historial-engine.ts` y sus tres builders | La hoja es de solo lectura. Editar abre `ModalLiquidacion` con el `LiquidacionEditor` completo; presencia y eventos de dominio por `historial-servicios-session` (room global) |

El código de ingresos conserva nombres del gemelo (`ingresos-transmeralda.ts`,
tablas `liquidacion_ingreso_transmeralda*`, el rótulo «INGRESOS DE
TRANSMERALDA» en los comentarios): son los ingresos de la empresa que corre la
app, aquí Cotransmeq.

`/dashboard/nomina` y `/dashboard/liquidaciones-terceros` ya no son listados:
redirigen (307) al canvas del periodo, conservando el periodo si venía en la
URL. Entre canvas se navega con el «Ir a…» del toolbar
(`SelectorCanvasNomina`, `SelectorCanvasTerceros`), que es un `<select>` y no
botones porque la cabecera recorta en silencio lo que desborda.

## Cómo se monta una página de canvas

```
routes/…/canvas/
  +page.ts            export const ssr = false; export const prerender = false;
  +layout@.svelte     UniverAuthGuard moduleId="…" › UniverShell › AsistenteCanvas
  +page.svelte        UniverShell { header: UniverToolbar } › UniverCanvasHost + UniverSideRail
```

- **`ssr = false`**: Univer toca `window` y WebGL; Vite no debe ejecutar su
  grafo de imports en el servidor.
- **El `@` de `+layout@.svelte` no es decorativo.** Sin él la página cuelga de
  `dashboard/+layout.svelte` y el canvas queda dentro de un `<main>` cuya altura
  no se propaga: Univer se monta con 0 px de alto. A cambio se pierde el guardia
  del dashboard, y por eso va
  [UniverAuthGuard](../src/lib/components/univer/UniverAuthGuard.svelte): repite
  `authStore.init()`, `checkAccess` del módulo, el aviso de expiración del token
  y **no pinta los hijos hasta estar listo** (en Svelte el `onMount` del hijo
  corre antes que el del padre, y el canvas leería un usuario nulo). El layout
  pone además la clase `univer-shell-active` en `<html>` y `<body>`, importa
  `toolbar.css` y monta el asistente, porque se salta la cabecera.
- [UniverShell](../src/lib/components/univer/UniverShell.svelte): viewport
  completo (`position: fixed; inset: 0`) y cabecera de altura fija (52 px). Se
  anuncia en [stores/univerShell.ts](../src/lib/stores/univerShell.ts) para que
  los toasts suban por encima de la barra de hojas.
- [UniverCanvasHost](../src/lib/components/univer/UniverCanvasHost.svelte): dueño
  del contenedor (`bind:container`). **Nunca se desmonta**: carga y error son
  capas encima, para que el engine siempre tenga un nodo al que atarse. Es el
  único sitio con los `height: 100% !important` que necesita el árbol de divs
  de Univer.
- [UniverToolbar](../src/lib/components/univer/UniverToolbar.svelte) es el
  contexto (dónde estoy, quién más está, si hay algo sin guardar) y
  [UniverSideRail](../src/lib/components/univer/UniverSideRail.svelte) las
  acciones; [UniverActionOverlay](../src/lib/components/univer/UniverActionOverlay.svelte)
  tapa canvas y carril mientras dura una acción larga del carril.
- El engine se crea en `onMount` con un **token de montaje**: el montaje es
  asíncrono y cambiar de año dos veces seguidas solaparía un montaje con un
  desmontaje; si al volver de un `await` el token ya no es el suyo, aborta. Al
  salir, `disposeEngine()` (o `ctx.dispose()`) libera la unidad, termina el
  worker de fórmulas y vacía el contenedor.

En [vite.config.ts](../vite.config.ts) hay tres ajustes que el canvas necesita:
`worker.format: 'es'` (el worker de fórmulas hace code-splitting y Rollup no lo
admite en IIFE; el fallo solo aparece en `vite build`), `resolve.dedupe` de
`@wendellhu/redi`, `rxjs` y los `@univerjs/*` (dos copias de redi rompen el
motor) y `optimizeDeps.include`. Las hojas de estilo de Univer entran por
[app.css](../src/app.css), después de Tailwind (si no, su reset las anula y el
canvas se dibuja como texto plano) y antes de los tokens de marca (para que
gane la paleta naranja).

## Arquitectura de `src/lib/editor/`

| Capa | Archivos | Responsabilidad |
|---|---|---|
| Fábrica | [univer/engine.ts](../src/lib/editor/univer/engine.ts) | `createLiquidacionEngine(opts)`, la única que crea Univer: presets (núcleo; validación de datos y filtros solo si se piden), locale es-ES con un parche de traducciones que el propio Univer 0.25.1 trae mal, worker de fórmulas propio ([formula.worker.ts](../src/lib/editor/univer/formula.worker.ts), módulo ES), recálculo forzado al montar, sin las marcas de «número almacenado como texto» (las fechas y horas son texto a propósito), cabecera y toolbar de Univer apagadas, editor de celda anclado a su celda al desplazarse. Devuelve `{ univer, fUniver, unitId, dispose }`. |
| Engines | `univer/*-engine.ts` | Un envoltorio por canvas: monta el libro que da el builder, configura la barra de hojas, activa hojas y expone funciones de repintado (`pintarFila`, `pintarCelda`, `sincronizarIncluir`…). Cambiar de hoja dentro de un libro anual no remonta ([activar-hoja.ts](../src/lib/editor/univer/activar-hoja.ts)). |
| Builders | `builders/*.builder.ts` | DTO del servidor → `IWorkbookData`: celdas, estilos, combinaciones y fórmulas con su valor ya calculado, más los bindings de las celdas editables. También la identidad y colores por empresa ([identidad-empresa.ts](../src/lib/editor/builders/identidad-empresa.ts), `colores-canvas.ts`). |
| Bindings y negocio | `business/*-cell-binding.ts` y servicios | Qué celda corresponde a qué entidad y campo (`entityType`, `entityId`, `field`), y la lógica de dominio que el cliente sí hace (costos laborales, totales, reparto entre propietarios, impuestos del ocasional, zona libre de anotaciones). |
| Adapters | `univer/adapters/cell-change-*.ts` | Escuchan los comandos de Univer y convierten una edición del usuario en un patch o una petición, buscando el binding de la celda. Ignoran las escrituras del propio canvas (ver «eco»). |
| Permisos de celda | `univer/cell-permission-*.ts` | El guardia que decide qué se puede escribir y dónde. |
| Cambios remotos | [univer/apply-remote-patch.ts](../src/lib/editor/univer/apply-remote-patch.ts) | Pintar en la hoja viva el cambio de otro usuario, sin remontar ni perder la selección. |
| Plugins | `univer/plugins/` | Filas seleccionadas, estadísticas de la selección, columna de acciones como botones y enlaces entre hojas con doble clic (historial de servicios). |
| Sesión y escritura | `canvas/` | [sheet-session.svelte.ts](../src/lib/editor/canvas/sheet-session.svelte.ts) (presencia y patches por room), [sheet-room-key.ts](../src/lib/editor/canvas/sheet-room-key.ts) (espejo exacto de `sockets/sheet-rooms.ts` del backend: si divergen, cliente y servidor hablan en rooms distintos sin ningún error), `historial-servicios-session.svelte.ts`, [cola-escritura.svelte.ts](../src/lib/editor/canvas/cola-escritura.svelte.ts) (escrituras idempotentes con agrupación por clave y reintento; vive en memoria, así que alimenta un `beforeunload`; no admite altas, salvo que el servidor las haga idempotentes, como el `cliente_key` del editor de liquidaciones), `anotaciones.ts`, `desprendible-nomina.ts`, `autoguardado-liquidacion.ts`. |
| Interruptores | [config/flags.ts](../src/lib/editor/config/flags.ts) | `AUTOSAVE_ENABLED` (emergencia: con `false` el modelo se sigue actualizando pero no se encola nada al backend) y `DEBUG_HIGHLIGHT` (pinta las celdas editables y las bloqueadas para revisar la lista blanca). |

El recorrido de una edición:

```
el usuario escribe ─► sheet.command.set-range-values
   ─► cell-permission: beforeCommandExecuted (¿binding? ¿estado? si no, CustomCommandExecutionError)
   ─► el comando se ejecuta en la hoja
   ─► adapter: onCommandExecuted ─► binding ─► patch (sheet-session) o REST o cola-escritura
   ─► ack del servidor (o conflicto / error) ─► el engine repinta la fila dentro de la guarda
   ─► los demás clientes reciben sheet:patch:applied ─► apply-remote-patch la pinta con la guarda de eco
```

Room por scope (`sheetRoomKey`): `adicionales`, `ocasional` e `ingresos` van
por año (`sheet:<scope>:<año>`); `cierres-finales`, `nomina` y `recorridos`, por
año y mes; `servicios-historial` es global, porque su filtro de año es una vista
y no un libro distinto.

`stores/realtimeCollab.ts` es el mecanismo anterior: un singleton con una sola
room. En los canvas de terceros ya solo alimenta a `AutosaveIndicator` y
`PresenceAvatars`; la persistencia va por `sheet-session` o por REST.
`AutosaveIndicator` acepta un modo detallado (`pendientes`, `fallidas`,
`onReintentar`) y `ultimoGuardado`, que deben pasar los canvas que no escriben
por `realtimeCollab`: si no, enseñan la hora de guardado del canvas anterior.

## La guarda de repintado: sin ella, eco infinito

Toda escritura programática —pintar un cambio remoto, repintar la fila tras el
ack, rellenar una columna calculada— emite el mismo
`sheet.command.set-range-values` que escucha el adapter. Si el adapter no sabe
que quien escribe es el propio canvas, lo toma por una edición del usuario,
emite otro patch, el servidor responde, el canvas vuelve a pintar… y no para.
En el canvas de recorridos se midieron **376.033 escrituras en vuelo en unos
segundos**, con el indicador de guardado disparado. El síntoma no es un error
en consola: es el contador de pendientes subiendo solo. Un conflicto de versión
lo acelera, porque repinta la fila.

Hay dos mecanismos y un canvas usa uno u otro:

- **`isApplyingRemote()` / `suprimirEco(fn)`** de `apply-remote-patch.ts`. Un
  contador (no un booleano: dos patches casi simultáneos se solapan) que se
  suelta en un `queueMicrotask`, porque Univer puede despachar el comando de
  forma asíncrona. `suprimirEco` solo admite funciones síncronas. Lo usan
  nómina, cierres y adicionales; ingresos y ocasional llevan una bandera local
  (`aplicandoRemoto`) con el mismo papel.
- **`repintando(fn)`** de `cell-permission-recorridos.ts`, `-nomina.ts` y
  `-servicios-historial.ts` (recorridos expone además `estaRepintando()`). Una
  ventana síncrona (aceptar una promesa la dejaría abierta durante un `await`
  y cualquier tecla en ese hueco entraría como válida) que restaura el valor
  anterior al cerrarse, porque se anida.

Ojo: **`repintando()` solo abre la puerta del guardia de permisos; al adapter
no le dice nada.** Por eso recorridos le pasa
`isApplyingRemote: () => estaRepintando()`. Al cablear un canvas nuevo, el
`isApplyingRemote` del adapter tiene que estar conectado a la guarda real.
`() => false` compila y arranca bien hasta el primer repintado.

## Permisos de edición por celda

Tres niveles, y los tres son necesarios:

1. **Entrar**: `UniverAuthGuard moduleId` comprueba el acceso al módulo.
2. **Editar**: el nivel `full` de ese módulo (`authStore.getAccessLevel(m) === 'full'`).
   El builder **no registra ningún binding** cuando el usuario no puede editar,
   así que la hoja entera queda de solo lectura sin una segunda regla que
   mantener. En recorridos, además, las columnas de bonos exigen el permiso
   individual `bonos-planilla`.
3. **Cada celda**: **default-deny por binding.** Solo se escribe donde el
   builder registró binding; una celda nueva sin binding no es editable y nadie
   tiene que acordarse de añadirla a una lista negra.

El corte se hace en `ICommandService.beforeCommandExecuted` lanzando
`CustomCommandExecutionError`, porque `SheetInterceptorService` no ve
`set-range-values` ni `set-cell-edit-visible`. El interceptor se deja para los
comandos de estructura (insertar o quitar filas y columnas, y sus mutaciones,
que cubren también el deshacer): la geometría la decide el builder, y una fila
insertada descolocaría fórmulas y bindings. Por eso los gastos extra del
ocasional no se añaden con «insertar fila» sino desde `ModalGastosVehiculo`,
que crea el concepto en la base y deja que el builder lo pinte con su binding.

**No se usa `readOnly: true` para esto.** Baja `WorkbookEditablePermission`,
que en `@univerjs/sheets` 0.25.1 es la misma bandera que decide si pasa
`SetRangeValuesCommand`: bloquearía también los repintados y los cambios de
otros usuarios. El corte por comando sí distingue quién escribe, gracias a la
guarda de repintado.

Cortes propios de cada canvas:

- **Nómina**: además del binding, el estado. Una liquidación APROBADA, PAGADA o
  ANULADA no se toca; para eso está la reversión de estado.
- **Recorridos**: `#`, `DÍA` y `VALOR A PAGAR` son derivadas, y `TIPO DE DÍA`
  no se edita en filas de recorrido (es del día, no del tramo). Insertar y
  eliminar filas sí se permite, solo dentro de la zona de datos.
- **Terceros** (cierres, adicionales, ocasional, ingresos): las filas bajo el
  bloque estructurado son **zona libre** de anotaciones, compartidas por
  `sheet-session` y sin tocar ninguna tabla de negocio.
- **Historial de servicios**: la hoja es de solo lectura para el usuario.
  Editar una liquidación (en el modal) exige `full` y que esté en BORRADOR,
  salvo para el área de Administración, que edita en cualquier estado.

El backend vuelve a comprobar cada patch: ocultar un botón o bloquear una celda
es comodidad, no seguridad.

## Autofiltro

`filtros: true` en `createLiquidacionEngine` solo carga el preset: pone la UI
del desplegable, pero **el botón aparece solo cuando se declara el rango con
`createFilter()`**. Es lo que pasaba en ingresos, adicionales y ocasional: tenían
el preset y ningún botón.

[univer/autofiltro.ts](../src/lib/editor/univer/autofiltro.ts) lo resuelve con
`crearAutofiltros(ctx, rangos, etiqueta)`: rango desde la cabecera (fila 0)
hasta la última fila de ítems, **sin el pie** (dentro del filtro, «TOTALES»
sería un valor más del desplegable y el pie desaparecería al filtrar); una hoja
sin ítems se queda sin desplegable a propósito. El historial de servicios crea
el suyo en `crearFiltros()` de su engine.

- **Nunca sobre la hoja ADICIONALES de ingresos.** Esa hoja esconde ella misma
  las filas no marcadas (`rowData.hd`) y `sincronizarIncluir` las muestra u
  oculta en vivo. Para Univer «quitar el filtro» es mostrar todo lo que ocultó,
  así que un filtro encima volvería a enseñar las filas desmarcadas. Solo la
  hoja INGRESOS lleva autofiltro.
- Los `SUM` del pie siguen sumando lo oculto: el total es el del documento y
  coincide con el del servidor. Recorridos y el historial de servicios usan
  `SUBTOTAL(109, …)` para que su pie siga al filtro.
- Con un filtro puesto, una selección de arriba abajo incluye las filas
  ocultas; el historial de servicios las descarta antes de actuar («filtrar por
  BORRADOR, seleccionar todo y eliminar» borraría también las escondidas).
- **Pendiente:** `recorridos-engine.ts` pasa `filtros: true` pero no crea
  ningún rango, así que según esta regla su hoja no tiene botón de filtro.

## El parche de submenús contextuales

[univer/parche-submenus-contextuales.ts](../src/lib/editor/univer/parche-submenus-contextuales.ts),
instalado una vez por página desde `createLiquidacionEngine`.

El fallo es de Univer 0.25.x: cada ítem con submenú («Insertar»,
«Eliminar»…) guarda `submenuVisible` y `submenuPositionReady`; el efecto que
vuelve a marcar la posición como lista depende solo de `visible`, y el cierre
se aplaza 500 ms. Si el usuario vuelve al ítem antes de esos 500 ms, el
submenú queda montado con `visibility: hidden`. Además, los submenús se montan
en un portal por orden de apertura y uno reabierto puede quedar debajo del que
aún no se cerró. En la práctica: se pasa por «Insertar», por «Eliminar», se
vuelve a «Insertar» y no se despliega nada.

El parche observa el `style` de cada `[data-u-context-menu-submenu]` montado en
`body`, y cuando ve la transición visible → oculto sin desmontar, lo fuerza
visible (con `!important`) y lo sube de `z-index`.

**Al subir Univer, se revisa y, si el fallo ya no está, se quita** (el módulo y
su llamada en `engine.ts`, en los dos repos). Si cambian el contenedor del
portal o el atributo `data-u-context-menu-submenu`, el parche deja de actuar sin
avisar. Para probarlo: abrir el menú contextual y pasar el ratón por A → B → A
en menos de 500 ms. En la misma revisión entran los demás apaños atados a
0.25.1: el parche de traducciones de `engine.ts`, el registro que termina el
worker de fórmulas (el plugin de RPC no lo hace cuando se le pasa una instancia
de `Worker`), la semántica de `WorkbookEditablePermission` y el nombre plural de
la mutación `sheet.mutation.remove-rows` que vigilan los permisos de recorridos.

## Probar un canvas desde la consola

Como la hoja es un `<canvas>`, ni el inspector ni los clics simulados sirven
para mucho: un clic remoto puede resaltar la cabecera sin cambiar la selección
real, y el clic derecho no abre el menú contextual. Este repo no tiene e2e de
canvas; el gemelo tiene uno (`e2e/canvas-historial.spec.ts`) que comprueba lo
de alrededor: contador del toolbar, presencia, botones del carril y tiempo real
entre dos usuarios.

Para tocar la hoja, dos canvas exponen su engine **solo en desarrollo**
(`import.meta.env.DEV`): `window.__recorridosEngine` y `window.__nominaEngine`.
Con su `fUniver` (la facade de Univer 0.25.1):

```js
const eng = window.__recorridosEngine;
const hoja = eng.fUniver.getActiveWorkbook().getActiveSheet();

hoja.getRange(5, 0, 1, 12).activate(); // seleccionar la fila 6 de verdad
await eng.fUniver.executeCommand('sheet.command.insert-row-after');

hoja.getRange(5, 3).setValue('2026-09-20'); // pasa por el guardia y el adapter, como teclear
hoja.getRange(5, 3).getRawValue(); // el valor sin formato de número
```

En local este front corre en el puerto 5173 (5174 si está ocupado) contra el
backend del 4000. Antes de concluir que «el guardia rechaza la inserción»,
comprueba con la facade qué hay seleccionado. Y recuerda que **Univer fusiona
estilos al escribir**: para quitar un fondo hay que mandar `bg: null`; omitirlo
lo deja pegado (así lo hacen el builder de recorridos y el engine de nómina).

## Pruebas

Unitarias (Vitest) en [tests/](../tests/): `cell-change-nomina`,
`recorridos-canvas` y `recorridos-filas`. Prueban bindings y adapters sin
montar Univer. El gemelo tiene bastantes más sobre los mismos módulos (builder
de nómina, historial de servicios, autoguardado, reparto entre propietarios…) y
su e2e de canvas; como `src/lib/editor/` es casi idéntico, sirven de
referencia. Ver [pruebas-y-calidad.md](./pruebas-y-calidad.md).

## Diferencias con Transmeralda

- `src/lib/editor/` tiene los mismos 86 archivos. Difieren la identidad de
  empresa (`identidad-empresa.ts`: marca COTRANSMEQ y bandas en naranjas claros,
  con el texto en negro por contraste), algunos colores de
  `cierres-finales-estado.ts` y `ocasional.builder.ts`, y líneas sueltas de
  ingresos y adicionales.
- En `cierres-finales-estado.ts` el color de la pestaña de un cierre APROBADA
  es naranja (`#ea580c`, con un comentario que todavía dice «verde») y el badge
  usa `orange-*`: un estado pintado con el color de la marca, a un paso del
  ámbar de REEMPLAZADA. Allí es verde.
- `src/lib/components/univer/ModalGastosVehiculo.svelte` solo existe aquí.
  Varios modales del canvas (`ModalEnviarDesprendibles`, `SnapshotPanel`,
  `ModalFilasOcasional`, `ModalFilasIngresos`, `ModalNotificarNomina`…)
  divergen; los componentes de la cáscara son idénticos. Compara con `diff`
  antes de replicar.
- Allí `vite.config.ts` fija el puerto 5273 con `strictPort`; aquí el puerto es
  el de Vite por defecto.
