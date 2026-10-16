# Componentes y estilos

Cómo se ve la app y con qué piezas se arma una pantalla: Tailwind 4 y los
tokens de `app.css` (con la paleta naranja de Cotransmeq), la tipografía, los
iconos, la regla de ancho de página y el catálogo de componentes compartidos.
Léelo antes de maquetar una página o un modal y, sobre todo, antes de escribir
un componente «genérico»: casi siempre ya existe uno, y la app tiene el
historial de veinticinco debounces y siete paginadores copiados a mano que lo
demuestra.

Temas vecinos: el núcleo de listados está en
[listados-y-filtros.md](./listados-y-filtros.md); los stores y las trampas de
runes, en [estado-y-stores.md](./estado-y-stores.md); los documentos
imprimibles, en [documentos-y-pdf.md](./documentos-y-pdf.md); el portal y los
canvas tienen su propio documento
([portal-del-conductor.md](./portal-del-conductor.md),
[canvas-univer.md](./canvas-univer.md)).

## Tailwind 4 y `app.css`

No hay `tailwind.config.*`. Tailwind 4 entra por el plugin de Vite
(`@tailwindcss/vite` en [vite.config.ts](../vite.config.ts)) y toda la
configuración vive en [src/app.css](../src/app.css), que importa el layout raíz
([routes/+layout.svelte](../src/routes/+layout.svelte)). Prettier ordena las
clases con `prettier-plugin-tailwindcss` apuntando a esa misma hoja
(`tailwindStylesheet` en `.prettierrc`).

Orden del archivo, de arriba abajo:

| Bloque | Qué hace |
|---|---|
| `@import 'tailwindcss' source('.')` | `source('.')` ancla la detección de clases a `src/`. Sin él, Tailwind sube por el árbol buscando la raíz del proyecto, puede acabar recorriendo directorios ajenos y bloquear el arranque del dev server. |
| `@import` de `@univerjs/*` | Hojas de Univer. Sin ellas el canvas monta pero se dibuja como texto plano. Van después de Tailwind (para que su reset no las anule) y antes de los tokens de marca (para que gane el naranja). |
| `@theme` | Fuentes, escalas `emerald-*` / `green-*` / `gray-*` remapeadas y radios. |
| `:root` | Tokens propios (`--bg-*`, `--text-*`, `--border-*`, `--accion`, `--orange-*`, sombras, `--ease-apple`). |
| `@layer components` | Clases de componente globales (botones, directorio, filtros, alertas…). |
| Sueltos | Un sistema global de modales (`.modal-overlay`, `.modal-box`…; ver abajo), estilos portados de `svelte-select`, impresión global, tokens de acceso (`--au-*`), modales como hoja en móvil y el hueco del asistente. |

`@tailwindcss/forms` está en `devDependencies` pero no se carga (no hay
`@plugin` en `app.css`). `@layer base` solo pone el cursor de mano en todo lo
pulsable: Tailwind 4 dejó los botones con la flecha.

> Con el dev server ya arrancado, Tailwind no genera las clases que **solo**
> aparecen en un archivo recién creado: la pantalla sale casi bien y algunas
> utilidades «no hacen nada». Reiniciar `npm run dev` lo arregla; el build de
> producción no está afectado.

### Colores: la marca va en `emerald-*`, el semáforo en hex

`@theme` redefine `--color-emerald-*` y `--color-green-*` con el **naranja** de
la marca (`#c2410c` en el 500, `#ea580c` en el 400) y `--color-gray-*` con los
slate de la app móvil. Por eso `text-emerald-600` pinta naranja aquí y verde en
Transmeralda sin tocar el marcado: las utilidades de Tailwind **son** los
tokens, y un componente que use `emerald-*` para la marca es idéntico en los
dos repos. Ojo con los extremos de la escala: el 900 es `#14532d`, el verde
bosque secundario, y el 950 un naranja casi marrón (`#431407`).

Tokens de `:root` que conviene conocer:

| Token | Uso |
|---|---|
| `--emerald-500` … `--emerald-700` | Naranja de marca para CSS propio. El nombre se conserva por compatibilidad. |
| `--emerald-800`, `--emerald-deep` | Verde bosque (`#166534`, `#14532d`): acento secundario, texto de énfasis y «aprobado». |
| `--orange-500` … `--orange-800` | Alias de `--emerald-*` para el dashboard, que los usa en unos cien sitios. Dentro de `public/portal/**` manda la definición del propio portal, donde `--orange-700/800` todavía valen verde. |
| `--accion`, `--accion-hover` | Fondo de `.btn-primary` (`#ea580c`). |
| `--bg-base` / `--bg-surface` | Fondo de página (`#fcfcfb`) y de tarjeta (blanco). |
| `--bg-charcoal-deep` | Verde bosque de los encabezados de modal, barra lateral y bloques de marca. |
| `--text-primary` · `--text-secondary` · `--text-muted` · `--text-very-muted` | Jerarquía de texto (slate). |
| `--border-subtle` · `--border-default` · `--border-emphasis` | Bordes. |
| `--shadow-card`, `--shadow-btn`, `--shadow-btn-hover`, `--shadow-soft` | Elevación. |
| `--ease-apple` | Curva de las transiciones (`.apple-transition`). |
| `--au-*` | Paleta de acceso: login, recuperación, invitación, pantallas de carga y de error. `CargaMascota` también la usa. |
| `--radius-lg` … `--radius-3xl` | Radios de la app móvil: 12 · 14 · 22 · 28 px. |

La regla que no se negocia: **lo que es marca usa `emerald-*`; lo que es estado
usa hex literal.** Un botón, el foco o la pestaña activa son marca. «Pagada»,
«vencida», «conectado» son semáforo y tienen que significar lo mismo en las dos
empresas: aquí un «al día» escrito con `text-emerald-600` saldría naranja y se
leería como alerta, pegado al ámbar. Por eso los semáforos viven en módulos de
tokens con hex: `ESTADO_CARTERA` en [api/cartera.ts](../src/lib/api/cartera.ts),
`ESTADO_LABELS` en [api/solicitudes.ts](../src/lib/api/solicitudes.ts),
`COLOR_ESTADO` en [liquidaciones/trazabilidad.ts](../src/lib/liquidaciones/trazabilidad.ts),
`getEstadoColor` en [types/servicios.ts](../src/lib/types/servicios.ts) o el
indicador de socket de [Header.svelte](../src/lib/components/Header.svelte).
Así el archivo es idéntico en los dos repos. La excepción conocida es
`COLOR_ESTADO.FACTURADA`, que cada empresa pinta con su color de marca (aquí
`#c2410c`).

Desviación conocida: en el canvas de cierres,
`COLOR_HOJA_POR_ESTADO.APROBADA` de
[cierres-finales-estado.ts](../src/lib/editor/builders/cierres-finales-estado.ts)
es naranja (`#ea580c`, con un comentario que todavía dice «verde») y su
`claseBadgeEstado` usa `orange-*`: un estado pintado con el color de marca, a
un paso del ámbar de REEMPLAZADA.

Las gráficas de `chart.js` no pueden leer clases: [Grafica.svelte](../src/lib/components/dashboard/Grafica.svelte)
lee los tokens con `getComputedStyle` en tiempo de ejecución, y así la misma
gráfica sale naranja aquí y verde en Transmeralda.

### Clases globales de componente

Antes de escribir CSS para un botón o una cabecera de directorio, mira
`@layer components`:

| Clases | Para qué |
|---|---|
| `.btn-primary`, `.btn-secondary`, `.btn-danger` | Botones de acción; `min-height: 44px`. Son las que espera el pie de `ModalBase`. |
| `.btn-icon` (36 px), `.btn-ghost`, `.help-btn` | Botón de icono, botón sin fondo, ayuda contextual. |
| `.dir-pagina`, `.dir-cabecera`, `.dir-titulo`, `.dir-desc`, `.dir-conteos`, `.dir-cabecera-acciones`, `.dir-filtros`, `.dir-filtros-buscador`, `.dir-lista`, `.dir-vacio`… | Cáscara de una página de directorio: cabecera con título, conteos y acciones, una fila de filtros y la `TablaLista`. La usan Flota, Clientes, Conductores y una veintena más. |
| `.eyebrow` (aquí una píldora naranja), `.page-card`, `.card-icon`, `.table-card`, `.code-badge`, `.chip-link`, `.alert-*`, `.section-error-banner`, `.hint-card`, `.confirm-card`, `.spinner`, `.list-card` | Piezas sueltas de página. |
| `.filter-panel`, `.filter-field`, `.filter-chip`, `.filter-grid`, `.filter-clear`… | Campos dentro de `FilterDrawer`. |
| `.glass`, `.glass-dark`, `.apple-transition`, `.no-print` | Utilidades propias. `.no-print` desaparece al imprimir y al exportar a PDF. |

Fuera de esa capa, este `app.css` trae un **sistema global de modales** «estilo
landing»: `.modal-overlay` / `.modal-bg` / `.modal-backdrop` (fondo con blur),
`.modal-box` / `.modal-content` (36rem; `.modal-xl` 72rem, `.modal-sm` 28rem),
`.modal-header`, `.modal-body`, `.modal-footer`, `.modal-actions`,
`.modal-close`, `.modal-title`, `.modal-sub`, `.modal-form`, `.modal-eyebrow`,
`.modal-icon`, `.modal-readonly-banner`, `.modal-select-card`… Sirve a los
modales que no usan `ModalBase`; para uno nuevo, `ModalBase`.

### Modales en móvil

Por debajo de 768 px, cualquier modal que siga una de las estructuras
reconocidas se convierte en una hoja pegada abajo, a todo el ancho, con asa y
hueco para la barra del teléfono: el fondo de Tailwind
`fixed inset-0 flex justify-center items-center` con un hijo `[role="dialog"]`,
`[aria-modal]`, `[class*="max-w-"]` o `.confirm-card`, y los pares
`.modal-backdrop > .modal`, `.modal-overlay > .modal-box`, `.fondo > .panel`,
`.tapa > .dialogo`, `.idm-backdrop > .idm`. Un modal con otra forma no recibe la
hoja. La entrada anima `translate` y no `transform` a propósito: las
transiciones `fly`/`scale` de Svelte animan `transform` y se pisarían.
`ModalBase` trae su propia regla equivalente por debajo de 640 px.

## Tipografía

Una sola familia en todo el ecosistema, la del sistema (SF Pro en iOS y macOS,
Roboto en Android, Segoe UI en Windows): `--font-sans` y `--font-display` son la
misma pila y `--font-mono` es `ui-monospace`. Nada se descarga. Los títulos son
la misma sans en negrita y el cuerpo lleva `font-variant-numeric: tabular-nums`,
para que las cifras alineen en columna sin monoespaciada.

Quedan restos de estilos anteriores que conviene no copiar: el rótulo de
`app.css` que dice «TIPOGRAFÍA — Geist única» y varios componentes que nombran
`'Geist'`, `'Fraunces'`, `'Inter Tight'` o `'JetBrains Mono'` en su CSS
(`PreviewTerceroPDF.svelte`, `LiquidacionEditor.svelte`,
`evaluaciones/SopaLetras.svelte`, `routes/presentacion/+page.svelte`…). Como
esas fuentes no se cargan, el navegador cae a la siguiente de la pila. La única
página que pide fuentes a Google es
[public/dias-laborados](../src/routes/public/dias-laborados/+page.svelte)
(Barlow, Barlow Condensed y JetBrains Mono). Las fuentes de los PDF del servidor
son otro asunto: ver [documentos-y-pdf.md](./documentos-y-pdf.md).

## Iconos

- **`lucide-svelte`** es la librería de iconos: la importan 113 archivos. Al
  pasar un icono como prop, tipa con `ComponentType` y no con `Component`: los
  iconos de lucide se tipan como componentes clásicos y `Component` los rechaza
  (ver `AccionesFila`). La barra lateral fija grosor y tamaño únicos en
  [SidebarIcon.svelte](../src/lib/components/SidebarIcon.svelte)
  (`SIDEBAR_ICON_STROKE = 1.75`, `SIDEBAR_ICON_SIZE = 20`).
- **`@iconify/svelte`** solo lo usa [routes/presentacion](../src/routes/presentacion/+page.svelte)
  (iconos `ph:`). No hay otro uso.
- Siguen existiendo `<svg>` escritos a mano en más de un centenar de archivos;
  la navegación del portal, por ejemplo, guarda sus iconos como cadenas de
  `path` en [public/portal/+layout.svelte](../src/routes/public/portal/+layout.svelte).

Los logotipos son de Cotransmeq y ninguno se llama como los del gemelo
(`logo_nombre.webp`, `logo_nombre_white.webp`, `logo.webp` solo el símbolo):
una ruta copiada de Transmeralda no da error, deja un hueco. La tabla de
equivalencias está en [AGENTS.md](../AGENTS.md).

## Ancho: los contenedores de página no llevan `max-width`

La versión operativa está en la skill
[diseno-paginas](../.claude/skills/diseno-paginas/SKILL.md) y el resumen en
[AGENTS.md](../AGENTS.md). Lo esencial:

Un `+page.svelte` ocupa todo el ancho que le da su layout. Ni `max-width` ni
`margin: 0 auto` en el envoltorio, y tampoco su versión Tailwind
(`mx-auto max-w-7xl`). Vale para todas las piezas de la cáscara
(`.page-header-inner`, `.page-main`, `.page-body`, `.page-footer-inner`).

| Zona | Quién acota el ancho |
|---|---|
| `dashboard/**` | el `<main>` de `dashboard/+layout.svelte`, junto a la barra lateral |
| `public/portal/**` | `.content` de `public/portal/+layout.svelte`, junto a su barra lateral de escritorio |
| públicas sueltas (`asistencia/[token]`, `public/documento/[token]`, `public/certificados/**`, `public/dias-laborados`) | el viewport |

El porqué: el layout ya acotó el área útil, y acotar otra vez deja franjas
muertas en las pantallas anchas, donde se trabaja el dashboard. El ancho
desperdiciado se paga en scroll: un preoperacional de 130 ítems a tres columnas
cabe en media pantalla; a una columna son ocho.

Para llenar el ancho, rejillas fluidas y no cascadas de `@media`:

```css
grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
columns: 3 20rem; /* listas largas que fluyen, como un checklist */
```

Conservan `max-width` solo cinco casos: **modales y diálogos** (son ventanas),
**tarjetas de autenticación** (`AuthShell`, `.login-card`, `.auth-shell`),
**párrafos de texto corrido** (`44rem`, por legibilidad; no tablas ni datos),
**documentos de tamaño fijo** (una hoja A4 en pantalla) y **controles o celdas
concretos** (`12rem` en un input). Antes de dar una página por hecha:

```bash
grep -n 'max-width\|max-w-\|mx-auto' src/routes/<tu-ruta>/+page.svelte
```

Cada coincidencia tiene que caer en una de esas excepciones.

Desviación conocida: [PortalPage.svelte](../src/lib/components/portal/PortalPage.svelte),
el contenedor de la lista de formularios del portal, todavía lleva
`max-width: 720px` (800 px en escritorio) y `margin: 0 auto`.

## Montados una sola vez

El layout raíz monta tres piezas globales. No se montan en ningún otro sitio:
una segunda instancia duplicaría cada aviso o cada diálogo.

| Componente | Qué hace |
|---|---|
| [ToastProvider](../src/lib/components/ui/ToastProvider.svelte) | El único `<Toaster>` de `svelte-sonner`, abajo al centro. En los canvas sube a 52 px para no tapar la barra de hojas (`enUniverShell` de [stores/univerShell.ts](../src/lib/stores/univerShell.ts)); en móvil sube más mientras hay un formulario de directorio abierto (`hayFormularioAbierto` de `stores/formularioAbierto.ts`). |
| [Tooltip](../src/lib/components/ui/Tooltip.svelte) | Convierte cualquier atributo `title` de la app en un tooltip con estilo, con 350 ms de espera y también al enfocar con teclado. Para un texto de ayuda basta con poner `title`. |
| [ConfirmHost](../src/lib/components/ui/ConfirmHost.svelte) | Pinta los diálogos que piden `confirmar()` y `pedirTexto()`. |

### Avisos

`import { toast } from 'svelte-sonner'` es lo habitual (135 archivos).
[stores/toast.ts](../src/lib/stores/toast.ts) conserva la API antigua
(`toast.success(msg, { description, duration })`, `toast.remove(id)`) y la
delega en sonner: existe porque antes pintaba en un contenedor que no estaba
montado en ningún layout y avisos como «Tu sesión ha expirado» no se veían.
Las dos vías salen por el mismo `<Toaster>`.

### Confirmaciones

Nunca `confirm()`, `alert()` ni `prompt()`: bloquean la pestaña, no se pueden
estilizar y Chrome ofrece silenciarlos para siempre. Hoy no queda ninguno en el
código. En su lugar, [stores/confirm.ts](../src/lib/stores/confirm.ts):

```ts
import { confirmar, confirmarEliminacion, pedirTexto } from '$lib/stores/confirm';

if (!(await confirmarEliminacion({ title: '¿Mover 3 vehículos a la papelera?' }))) return;
const motivo = await pedirTexto({ title: 'Anular', label: 'Motivo' }); // null si cancela
```

`confirmar()` acepta `title`, `message`, `tone` (`danger` · `warning` ·
`success` · `info`, que decide rótulo y mascota), `eyebrow`, `mascot`,
`confirmText` y `cancelText` (`null` lo convierte en un aviso de un solo
botón). Si se abre otra confirmación con una pendiente, la anterior se resuelve
como cancelada: dos diálogos encimados harían que el «Sí» contestara al
equivocado. `pedirTexto()` devuelve el texto recortado; Enter hace salto de
línea y Ctrl/⌘+Enter acepta.

## Catálogo de componentes compartidos

Las cifras de «usos» cuentan archivos que lo importan (octubre de 2026).

### Modales

| Componente | Usos | Para qué | Props principales |
|---|---|---|---|
| [ui/ModalBase](../src/lib/components/ui/ModalBase.svelte) | 65 | Carcasa de todo modal: encabezado verde bosque (`--bg-charcoal-deep`) con rótulo, título y subtítulo; cuerpo sobre `--bg-base`; pie blanco para los botones. Va por encima del canvas (z-index 10040 frente a 9999) y por debajo de las confirmaciones (10050). Escape cierra salvo que haya una confirmación abierta. | `open`, `title`, `oncerrar` (obligatorias); `eyebrow`, `subtitle`, `tamano` (`sm` 440 · `md` 640 · `lg` 860 · `xl` 1120 · `full`), `cerrarAlFondo`, `bloqueado` (impide cerrar mientras se guarda), `sinRelleno`; snippets `pie`, `cabecera`, `accionesCabecera`. |
| [ui/ConfirmDialog](../src/lib/components/ui/ConfirmDialog.svelte) | 14 | La tarjeta de confirmación con la mascota, para modales que necesitan contenido propio (eliminar, restaurar). Enfoca el botón principal al abrir. | `open`, `title`, `message`, `tone`, `mascot`, `confirmText`, `cancelText`, `loading`, `confirmDisabled`, `closeOnBackdrop`, `onconfirm`, `oncancel`, `children`. |
| [common/ModalConfirm](../src/lib/components/common/ModalConfirm.svelte) | 1 | Envoltorio Svelte 4 de `ConfirmDialog` con eventos `confirm`/`cancel`; solo lo usa `dashboard/servicios`. En código nuevo, `confirmar()`. | `isOpen`, `title`, `message`, `type`, `isLoading`. |
| [ui/ModalSelectCliente](../src/lib/components/ui/ModalSelectCliente.svelte) | 1 | Selector en modal con buscador (lo usa `ModalFormServicio`). | `isOpen`, `items`, `selectedValue`, `onSelect`, `onClose`, `icon`. |
| [ui/ModalSelectTercerosOcasionales](../src/lib/components/ui/ModalSelectTercerosOcasionales.svelte) | 1 | Elegir terceros para el canvas ocasional. | `isOpen`, `mes`, `anio`, `onConfirm`. |

La carpeta [modals/](../src/lib/components/modals/) no es genérica pese al
nombre: son los modales de recargos (`ModalFormRecargo`,
`ModalVisualizarRecargo`, `ModalCambiarEstado`, `ModalConfirmarEliminar`,
`ModalConfirmarRestaurar` y `ModalImportarTransmeralda`, que importa planillas
desde Transmeralda) y solo los importa `dashboard/recargos`.

### Cargas y estados vacíos

| Componente | Usos | Para qué | Props principales |
|---|---|---|---|
| [ui/CargaMascota](../src/lib/components/ui/CargaMascota.svelte) | 59 | La espera de toda la app: mascota trabajando, barra de progreso y una línea de estado. Sustituye a los spinners sueltos. `role="status"`, respeta `prefers-reduced-motion`. | `texto` (obligatoria, «Cargando servicios…»), `tamano` (`pantalla` para una página entera, `bloque` para una tabla o pestaña; por defecto `bloque`), `mascota`. |
| [Skeleton](../src/lib/components/Skeleton.svelte) | 1 | Líneas con brillo; solo lo usa `LiquidacionEditor`. | `width`, `height`, `count`, `lines`, `circle`. |

La mascota se pide por **intención**, no por archivo:
[src/lib/mascot.ts](../src/lib/mascot.ts) traduce `bienvenida`, `ayuda`,
`procesando`, `exito`, `correoEnviado`, `advertencia`, `vacio`, `espera` y
`celebracion` a una de las nueve imágenes de `static/mascot/*.webp` (las mismas
de la app móvil de Cotransmeq) con su `alt`. `mascota('vacio')` devuelve
`{ src, alt }`. Así la web y la app reaccionan con la misma cara ante el mismo
estado, y cambiar la imagen de un estado es tocar una línea.

### Listados

Todos en [components/listing/](../src/lib/components/listing/). Cómo se combinan
con la URL está en [listados-y-filtros.md](./listados-y-filtros.md).

| Componente | Usos | Para qué | Props principales |
|---|---|---|---|
| `TablaLista` | 21 | La tabla de directorio, sobre `@tanstack/table-core`. La fila «es» la tarjeta. | `columnas`, `datos`, `claveFila`, `etiqueta` (accesible, obligatoria), `cargando`, `orden` + `onOrdenar` (sin `onOrdenar` las cabeceras no son pulsables: no se finge ordenación), `onFila`, snippets `celda` y `vacio`, `seleccion` + `onSeleccion` (columna propia de casillas, Mayús marca un tramo, «todo» es la página visible). |
| `EstadoPunto` | 31 | **La** forma de mostrar un estado en una fila: un punto de 7 px y la palabra en negrita del mismo color. Es el único color dentro de la fila: nada de pastillas rellenas ni barras laterales de color. | `etiqueta`, `color` (hex del semáforo), `apagado` (gris, para inactivo o retirado). |
| `CeldaIdentidad` | 16 | Primera celda: avatar (foto, iniciales o código ancho como la placa), título y línea gris. | `titulo`, `subtitulo`, `foto`, `iniciales`, `codigo`, `tono`, `punto`. |
| `AccionesFila` | 19 | Iconos grises que se revelan al pasar sobre la fila; el destructivo se pone rojo solo al pasar sobre él. Los clics no suben a la fila. | `acciones` (`{ id, etiqueta, icono, onClick, peligrosa?, oculta?, deshabilitada? }`), `visibles` (3; si sobra exactamente una, se muestra en vez de abrir un menú de una entrada). |
| `BarraSeleccion` | 6 | Barra flotante de acciones masivas. | `cantidad`, `nombreItems`, `acciones` (`tono`: `primario` · `neutro` · `peligro`), `procesando`, `onLimpiar`. |
| `ResumenConteos` | 29 | Conteos de cabecera como chips con punto de color; con `onElegir`, cada chip filtra. Sustituye a las `stat-card` que ocupaban una franja. | `conteos` (`{ clave, etiqueta, valor, color? }`), `activo`, `onElegir`. |
| `SegmentosFiltro` | 25 | Etiqueta y pastillas excluyentes para el filtro más frecuente, a la vista y sin abrir el panel lateral. | `etiqueta`, `opciones` (`{ valor, etiqueta, punto? }`), `valor`, `onCambiar`. |
| `BuscadorLista` | 26 | Campo de búsqueda con el retardo unificado de 300 ms. Enter busca sin esperar; al desmontar cancela lo pendiente. | `valor` (bindable), `onBuscar`, `placeholder`, `retardo`, `deshabilitado`, `etiqueta`. |
| `PaginadorLista` | 29 | El paginador único: «11–20 de 340», ventana de cinco páginas. No decide nada: avisa del número. | `pagina`, `total` (del servidor), `porPagina` (`0` = todas), `onCambiar`, `nombreItems`, `suelto`, `opcionesPorPagina` + `onCambiarPorPagina`. |
| `SelectorMultiple` | 2 | «Varias placas», «varios conductores»: buscador con casillas y pastillas de lo elegido; ignora tildes. | `etiqueta`, `opciones`, `seleccion`, `onCambiar`, `maxPastillas`. |
| [ui/TabsVista](../src/lib/components/ui/TabsVista.svelte) | 18 | Pestañas de vista de páginas y modales de directorio; flechas para moverse. | `tabs` (`{ id, label, cuenta?, errores? }`), `activa` (bindable), `variante` (`claro` sobre la página, `oscuro` sobre el encabezado de un modal), `onCambiar`. |
| [ui/FilterDrawer](../src/lib/components/ui/FilterDrawer.svelte) | 6 | Panel lateral de filtros (Svelte 4). | `open`, `onClose`, `activeCount`, `eyebrow`, `title`, `subtitle`; slots por defecto, `chips` y `footer`. |
| [ui/MultiSelectFilter](../src/lib/components/ui/MultiSelectFilter.svelte) | 2 | Filtro múltiple de cabecera de columna (recargos, liquidaciones de servicios). Lleva el menú a `<body>` para que no lo recorte un ancestro con `transform` u `overflow`. | `selected`, `options`, `labelFn`, `searchable`, `iconOnly`; evento `change`. |

[AccionesDropdown](../src/lib/components/AccionesDropdown.svelte) (servicios y
liquidaciones de servicios) es el menú de acciones de una fila con muchas
acciones: un solo disparador, panel `position: fixed` medido antes de colocarse
y abierto hacia arriba si abajo no cabe.

### Campos y selección

| Componente | Usos | Para qué | Props principales |
|---|---|---|---|
| [Autocomplete](../src/lib/components/Autocomplete.svelte) | 4 | Buscador con desplegable (placas, clientes) en `ModalEditarRegistro`, los dos runners de formularios y los días laborados del portal. El desplegable es `position: fixed`, usa el Visual Viewport para que el teclado del móvil no lo tape y se voltea hacia arriba si no cabe. `allowCustomValue` conserva texto libre aunque no haya coincidencia. Svelte 4. | `value` (el id o, con `allowCustomValue`, texto libre), `options` (`{ id, label }`), `placeholder`, `disabled`, `allowCustomValue` (false por defecto), `maxLength`, `maxResults` (`0` = sin tope, por defecto), `inputId` + `ariaLabel` (necesarios si no va dentro de un `<label>`); eventos `select`, `change`, `clear`; método `setSelected()`. |
| [TimePicker](../src/lib/components/TimePicker.svelte) | 3 | Hora en tramos de 30 minutos más el desfase de días («día siguiente») de [utils/dias-offset.ts](../src/lib/utils/dias-offset.ts). Conserva valores viejos que no están en la lista. Svelte 4. | `value` (`HH:MM`), `diasOffset` (0 a `MAX_OFFSET_DIAS`), `id`, `fechaBase` (para decir la fecha concreta), `disabled`. Se enlazan las dos con `bind:`. |
| [common/SelectBuscable](../src/lib/components/common/SelectBuscable.svelte) | 6 | Select con buscador para modales (viáticos, combustible, incidentes, servicios). | `opciones` (`{ value, label, labelSecundario?, labelTerciario?, searchLabel? }`), `valor`, `onSeleccionar`, `placeholder`, `ariaLabel`, `deshabilitado`. |
| [ui/MapboxSearch](../src/lib/components/ui/MapboxSearch.svelte) | 2 | Búsqueda de direcciones de servicios y recargos. Mezcla lugares registrados por el equipo (`source: 'local'`) con la API de mapas (`'here'`). | `value`, `label`, `required`, `error`, `onSelect`. |
| [ui/PopoverChip](../src/lib/components/ui/PopoverChip.svelte) | 1 | Texto largo truncado en una celda, con popover que escapa del `overflow` de la tabla. | `text`, `maxLength`, `color`, `emptyText`. |
| [ReadonlyField](../src/lib/components/ReadonlyField.svelte) | 1 | Par etiqueta/valor de solo lectura con icono (ficha de conductor). | `value`, `emptyText`, `mono`, `icon`. |

`Autocomplete` y `SelectBuscable` filtran con un `includes` en minúsculas: no
quitan tildes ni aceptan varias palabras. Para filtrar una lista en cliente usa
`coincide()` (ver [listados-y-filtros.md](./listados-y-filtros.md)).

### Calendarios

| Componente | Usos | Para qué |
|---|---|---|
| [common/CustomCalendar](../src/lib/components/common/CustomCalendar.svelte) | 1 | Pese a estar en `common/`, es la cuadrícula mensual **de servicios** (tipos `ServicioConRelaciones`). Semana de lunes a domingo, días vecinos atenuados, tres servicios por día y «+N más»; si el contenedor es angosto se convierte en agenda. Props: `mes`, `anio`, `eventosPorDia`, `festivos`, `campoFecha`, `diaSeleccionado`, `onEventClick`, `onDayClick`. |
| [servicios/CalendarServicio](../src/lib/components/servicios/CalendarServicio.svelte) | 1 | La vista de calendario de `dashboard/servicios`: barra del mes, con qué fecha se ubica cada servicio (solicitud, realización o finalización), resumen por estado, cuadrícula y lista del día; abre `ModalDetalleServicio`. Día y hora salen de la misma fecha local (antes un servicio de las 23:53 caía en la casilla del día siguiente). Props: `mes`, `anio`, `campoFecha` (bindables), `filtros`, `coincide`, `puedeEditar`, `onMesAnioChange`, `onCampoFechaChange`, `onEditar`, `onEliminar`. |
| [conductores/CalendarDiasLaborados](../src/lib/components/conductores/CalendarDiasLaborados.svelte) | 2 | Mes de días laborados de un conductor. |
| [nomina/CalendarPernote](../src/lib/components/nomina/CalendarPernote.svelte) | 1 | Selección de fechas de pernocte; es el único que usa las clases `.calendar-*` de `app.css`. |

La dependencia `svelte-calendar` no se importa en ningún sitio.

### Cáscara y piezas de canvas

`Header`, `Sidebar`, `SidebarCabecera`, `SidebarIcon` y `SessionTimer` los
monta solo [dashboard/+layout.svelte](../src/routes/dashboard/+layout.svelte).
`AutosaveIndicator` y `PresenceAvatars` son de la cabecera de los canvas: ver
[canvas-univer.md](./canvas-univer.md).

### Lo que existe y no usa nadie

Ningún archivo importa estos componentes: no los tomes como referencia sin
comprobar que siguen sirviendo.

- [Dashboard.svelte](../src/lib/components/Dashboard.svelte) y, con él,
  [StatCard.svelte](../src/lib/components/StatCard.svelte), que solo importa
  `Dashboard`.
- [Login.svelte](../src/lib/components/Login.svelte).
- [ui/ModalSelectConductor.svelte](../src/lib/components/ui/ModalSelectConductor.svelte).
- [ui/SortIcon.svelte](../src/lib/components/ui/SortIcon.svelte).
- [ui/data-table/DataTable.svelte](../src/lib/components/ui/data-table/DataTable.svelte):
  la tabla anterior a `TablaLista`.
- [common/UsuarioBadge.svelte](../src/lib/components/common/UsuarioBadge.svelte),
  [ui/CellSelect.svelte](../src/lib/components/ui/CellSelect.svelte) y
  [ui/SelectionStatsFooter.svelte](../src/lib/components/ui/SelectionStatsFooter.svelte),
  que solo existen en este repo.

Tampoco se importan en `src/` las dependencias `svelte-calendar`, `adm-zip` ni
`html-to-image`.

## Diferencias con Transmeralda

- **Paleta.** `ingreso-svelte` remapea `emerald-*` y `green-*` al **verde** de
  su marca y `gray-*` a neutros verdosos; aquí son naranja y slate. No tiene
  los alias `--orange-*`.
- **Tailwind.** Allí la importación es `@import 'tailwindcss'`, sin `source()`.
- **Modales.** El sistema global `.modal-overlay` / `.modal-box` / `.modal-*`
  existe solo aquí.
- **Impresión.** El `@page` global de allí es A4 apaisado con 6 mm de margen;
  aquí, carta vertical sin margen. Allí `app.css` trae además el resaltado
  `.lt-row-new` de liquidaciones de terceros recién creadas.
- Los tres componentes sin uso de la lista anterior (`UsuarioBadge`,
  `CellSelect`, `SelectionStatsFooter`) y `modals/ModalImportarTransmeralda`
  no existen allí.
