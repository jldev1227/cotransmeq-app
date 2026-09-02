/**
 * Hoja de estilos del documento de un envío de formulario dinámico.
 *
 * Vive en un módulo TypeScript y NO en el `<style>` del componente por una razón
 * concreta: el PDF lo renderiza Chromium en el servidor a partir del HTML y el
 * CSS que le manda el cliente, y ese CSS tiene que ser un valor que se pueda
 * leer con un `import`. Extraerlo en tiempo de ejecución del CSSOM —recorriendo
 * `document.styleSheets` y filtrando por la clase de scoping de Svelte— parecía
 * más barato, pero depende de detalles que cambian entre `vite dev` y el build:
 * si el filtro falla, el PDF sale con el texto y las imágenes desnudos, sin una
 * sola regla, y el fallo no se nota hasta que alguien abre el PDF.
 *
 * Es el mismo motivo por el que el canvas de terceros tiene su `documento.css.ts`.
 *
 * ── Por qué `[data-fdoc]` y no clases prefijadas ──
 * Al salir del componente, el CSS deja de estar acotado por Svelte y pasa a ser
 * global. En vez de renombrar treinta clases, todo cuelga del atributo que lleva
 * el contenedor del documento: `.fila` de otra pantalla no se ve afectada, y los
 * nombres siguen leyéndose igual dentro del componente.
 *
 * `body` y `@page` son la excepción: son el lienzo de la hoja impresa, están por
 * encima del documento y no pueden colgar de él.
 *
 * ── REGLA DE ALTURA: nada reserva espacio para lo que no existe ──
 * Un preoperacional trae ~130 ítems y una docena de campos de observación que
 * casi siempre vienen vacíos. La versión anterior de esta hoja le daba a CADA
 * observación vacía un bloque de dos partes —banda de etiqueta más cuerpo con
 * `min-height`— que medía unos 40 px aunque no hubiera nada que leer: ocho
 * observaciones en blanco eran un tercio de página de nada.
 *
 * La regla que aplica todo el documento ahora:
 *
 *   · Campo CON valor  → bloque completo, con su banda de etiqueta y su cuerpo.
 *   · Campo SIN valor  → COLAPSA a una fila de una línea («Etiqueta │ Sin
 *                        observaciones»), exactamente igual de alta que una fila
 *                        de checklist.
 *
 * Se colapsa y no se OMITE a propósito. El documento es un registro de
 * auditoría: quien lo revisa tiene que poder distinguir «se preguntó y no se
 * respondió» de «no se preguntó», y borrar el campo hace indistinguibles los dos
 * casos. Colapsar conserva la constancia y cuesta una línea en vez de cuarenta
 * píxeles. Lo mismo vale para evidencia sin adjuntos, tablas sin registros y
 * firmas sin trazo: la constancia se queda, el hueco no.
 *
 * Ningún selector de esta hoja debe volver a fijar `min-height` ni `height` en
 * un contenedor de contenido variable. La única altura fija que queda es la de
 * las imágenes (firma y foto), que sí tienen contenido real que enseñar.
 */
export function documentoEnvioCss(): string {
	return `
/* ── Documento ─────────────────────────────────────────────────────────
   Sin esquinas redondeadas ni sombras: es un formato, no una tarjeta. */
[data-fdoc] {
	width: 100%;
	padding: 0.5rem;
	background: #fff;
	border: 1px solid #111;
	color: #111;
	font-size: 0.6875rem;
	/* Pila propia y no herencia: en el PDF el HTML se monta con \`setContent\`
	   sobre una página vacía, sin la hoja de la aplicación, así que heredar el
	   tipo del \`body\` significa heredar el Times del navegador. */
	font-family: var(--font-sans, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif);
	/* Cifras de ancho fijo: cédulas, placas, fechas y kilometrajes quedan en
	   columna aunque estén en filas distintas, que es como se cotejan. */
	font-variant-numeric: tabular-nums;
	/* Interlineado corto a propósito: el alto de una fila ES el interlineado —no
	   llevan relleno vertical— y con 131 ítems cada décima se paga en páginas. */
	line-height: 1.2;
}

/* ── Normalización propia ──────────────────────────────────────────────
   En pantalla el documento hereda el reset global de la aplicación, pero el PDF
   lo compone Chromium con \`setContent\` sobre una página vacía: allí NO hay
   reset, y los márgenes del agente de usuario reaparecen todos de golpe. El más
   destructivo es el \`margin-inline-start: 40px\` de \`dd\`, que le arranca 40 px al
   valor de cada par de la ficha y de la cabecera y parte los datos en dos
   líneas; los de \`p\`, \`dl\`, \`h1\`, \`h2\` y \`figure\` van metiendo aire entre bloques
   que se diseñaron pegados.

   Va acotado a \`[data-fdoc]\` y ANTES que el resto: las reglas de más abajo
   llevan clase y ganan por especificidad las pocas veces que reponen relleno. */
[data-fdoc] *,
[data-fdoc] *::before,
[data-fdoc] *::after {
	box-sizing: border-box;
}

[data-fdoc] h1,
[data-fdoc] h2,
[data-fdoc] p,
[data-fdoc] dl,
[data-fdoc] dt,
[data-fdoc] dd,
[data-fdoc] ul,
[data-fdoc] li,
[data-fdoc] figure,
[data-fdoc] figcaption,
[data-fdoc] table {
	margin: 0;
	padding: 0;
	font-size: inherit;
	font-weight: inherit;
}

[data-fdoc] ul {
	list-style: none;
}

[data-fdoc] img {
	max-width: 100%;
}

/* ── Cabecera de tres cuerpos, como el formato en papel ──────────────── */
[data-fdoc] .cab {
	display: grid;
	grid-template-columns: minmax(8rem, 15%) 1fr minmax(10rem, 19%);
	border: 1px solid #111;
	break-inside: avoid;
}

[data-fdoc] .cab__marca {
	display: grid;
	place-items: center;
	padding: 0.3125rem 0.5rem;
	border-right: 1px solid #111;
}

/* \`contain\` y no \`cover\`: un logo recortado es un logo mal usado, y las dos
   marcas tienen proporciones distintas. */
[data-fdoc] .cab__logo {
	display: block;
	width: 100%;
	max-height: 2.5rem;
	object-fit: contain;
	object-position: center;
}

[data-fdoc] .cab__titulo {
	display: grid;
	place-items: center;
	padding: 0.25rem 0.5rem;
	font-size: 0.8125rem;
	font-weight: 800;
	line-height: 1.15;
	text-align: center;
	text-transform: uppercase;
	letter-spacing: 0.01em;
	border-right: 1px solid #111;
}

/* El tamaño vive en el contenedor y las columnas se miden en \`em\`, así el
   bloque se reescala entero al cambiar de medio sin que la etiqueta se coma el
   valor y lo parta en dos líneas. */
[data-fdoc] .cab__meta {
	display: flex;
	flex-direction: column;
	font-size: 0.625rem;
}

[data-fdoc] .cab__meta > div {
	display: grid;
	/* 6em es lo que mide «VERSIÓN» en versalita con su relleno: por debajo la
	   etiqueta se corta contra el filete y el bloque parece roto. */
	grid-template-columns: 6em 1fr;
	align-items: center;
	flex: 1;
	border-bottom: 1px solid #111;
}

[data-fdoc] .cab__meta > div:last-child {
	border-bottom: none;
}

[data-fdoc] .cab__meta dt {
	padding: 0.125rem 0.3125rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.03em;
	background: #f1f5f9;
	border-right: 1px solid #111;
}

[data-fdoc] .cab__meta dd {
	padding: 0.125rem 0.3125rem;
	font-weight: 700;
	white-space: nowrap;
}

/* Banda de sección: el elemento que estructura todo el formato en papel. */
[data-fdoc] .banda {
	padding: 0.0625rem 0.375rem;
	font-size: 0.6875rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: #14532d;
	background: #dcf0e0;
	border: 1px solid #111;
	border-top: none;
	/* Una banda al pie de una página con su sección en la siguiente es un título
	   huérfano: nunca se separa de lo que titula. */
	break-after: avoid;
}

/* ── Datos del registro ───────────────────────────────────────────────
   Rejilla de cuatro pares por línea a todo el ancho de la hoja, no una tira
   de pares que se reparte sola: con \`auto-fit\` el número de columnas dependía
   del ancho del visor y la última línea salía coja. Cuatro columnas fijas
   dejan dos líneas exactas y las etiquetas alineadas en vertical, que es lo
   que permite leer el bloque de un vistazo.

   El conductor ocupa dos celdas porque un nombre completo no cabe en una y
   partirlo en dos líneas descuadra toda la fila. */
[data-fdoc] .ficha {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	border: 1px solid #111;
	border-top: none;
	break-inside: avoid;
}

[data-fdoc] .ficha__par {
	display: grid;
	/* Columnas en \`em\`: la etiqueta guarda la misma proporción con su valor en
	   pantalla y en papel, sin una segunda medida que mantener. */
	/* 8.8em es lo que pide «Fecha operativa», la etiqueta más larga del bloque.
	   Se puede fijar a ojo porque estas siete etiquetas son FIJAS —no vienen de
	   la definición del formulario—: con menos, la etiqueta parte en dos líneas y
	   esa línea de más la pagan las cuatro celdas de la fila entera, no solo la
	   que se partió. */
	grid-template-columns: 8.8em minmax(0, 1fr);
	align-items: center;
	border-right: 1px solid #cbd5e1;
	border-bottom: 1px solid #cbd5e1;
}

[data-fdoc] .ficha__par--ancho {
	grid-column: span 2;
}

/* Sin filete a la derecha en la última celda de cada línea: ahí ya está el
   marco exterior de \`.ficha\`. Se enumeran a mano —la 3.ª y la 7.ª— y no con un
   \`nth-child(4n)\`, porque la primera celda ocupa DOS columnas y el conteo de
   hermanos no coincide con el de columnas. */
[data-fdoc] .ficha__par:nth-child(3),
[data-fdoc] .ficha__par:last-child {
	border-right: none;
}

/* Jerarquía dentro del par: la etiqueta es la GUÍA y el valor es el DATO, así
   que la etiqueta va un punto más pequeña, en versalita y en gris, y el valor a
   tamaño de cuerpo y en negra. Además de leerse mejor, la etiqueta pequeña es
   lo que deja «Identificación» en una sola línea dentro de una celda de cuarto
   de hoja. */
[data-fdoc] .ficha__par dt {
	padding: 0.0625rem 0.25rem;
	font-size: 0.5625rem;
	font-weight: 700;
	line-height: 1.25;
	/* Etiqueta a la derecha, pegada a su valor: el mismo recurso que usa la
	   rejilla de checklist para que la vista no se pierda entre columnas. */
	text-align: right;
	/* SIN versalita, al contrario que las bandas y la cabecera de estados. Dos
	   motivos: la versalita cuesta cerca de un tercio de ancho y «Identificación»
	   dejaba de caber en una celda de cuarto de hoja, y además reservar la
	   versalita para lo estructural —bandas de sección y cabecera de columnas—
	   mantiene esas dos jerarquías distinguibles de un vistazo. */
	color: #475569;
	background: #f1f5f9;
	border-right: 1px solid #cbd5e1;
}

[data-fdoc] .ficha__par dd {
	padding: 0.0625rem 0.375rem;
	font-size: 0.6875rem;
	font-weight: 700;
	line-height: 1.25;
	overflow-wrap: anywhere;
}

/* Placa y cédula son lo que un auditor busca primero y lo que teclea en otro
   sistema para cotejar: van en versalita ancha para que destaquen del resto. */
[data-fdoc] .ficha__id {
	font-family: var(--font-mono, ui-monospace, 'SFMono-Regular', Menlo, monospace);
	letter-spacing: 0.04em;
}

/* En pantalla estrecha cuatro columnas dejan la celda en 80 px y el valor se
   parte carácter a carácter. En PAPEL nunca se llega aquí —la hoja mide 204 mm
   de ancho útil—, así que la regla no le cuesta nada al PDF. */
@media screen and (max-width: 52rem) {
	[data-fdoc] .ficha {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

@media screen and (max-width: 30rem) {
	[data-fdoc] .ficha {
		grid-template-columns: minmax(0, 1fr);
	}

	[data-fdoc] .ficha__par--ancho {
		grid-column: auto;
	}
}

[data-fdoc] .anulado {
	margin-top: 0.1875rem;
	padding: 0.1875rem 0.4375rem;
	color: #991b1b;
	background: #fef2f2;
	border: 1px solid #991b1b;
	break-inside: avoid;
}

/* ── Resumen ───────────────────────────────────────────────────────── */
[data-fdoc] .resumen {
	margin-top: 0.1875rem;
	padding: 0.1875rem 0.4375rem;
	background: #fffbeb;
	border: 1px solid #111;
	border-left: 3px solid #b45309;
	break-inside: avoid;
}

[data-fdoc] .resumen--limpio {
	background: #f0fdf4;
	border-left-color: #15803d;
}

/* Titular del documento: lo único que se lee a un brazo de distancia. En \`em\`
   para que crezca y encoja con el cuerpo en vez de quedarse anclado al tamaño
   de pantalla al pasar a papel. */
[data-fdoc] .resumen__t {
	font-size: 1.15em;
	font-weight: 800;
}

[data-fdoc] .resumen__pend {
	font-weight: 600;
	color: #92400e;
}

[data-fdoc] .resumen__lista {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
	gap: 0.0625rem 1rem;
	margin-top: 0.1875rem;
	padding: 0;
	list-style: none;
	font-size: 0.6875rem;
}

/* ── Cuerpo a dos columnas ─────────────────────────────────────────── */
[data-fdoc] .cuerpo {
	columns: 2;
	column-gap: 0.375rem;
	margin-top: 0.1875rem;
}

[data-fdoc] .sec {
	margin-bottom: 0.1875rem;
}

[data-fdoc] .sec--ancha {
	margin-top: 0.3125rem;
}

/* Cabecera de columnas de estado. \`--n\` es cuántas casillas hay: el mismo
   valor gobierna la cabecera y cada fila, así que no se desalinean. */
[data-fdoc] .cab-estado,
[data-fdoc] .fila {
	display: grid;
	grid-template-columns: 1fr repeat(var(--n, 3), 1.35rem);
	border: 1px solid #111;
	border-top: none;
}

[data-fdoc] .cab-estado {
	background: #e2e8f0;
	font-size: 0.5625rem;
	font-weight: 800;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	break-after: avoid;
}

[data-fdoc] .cab-estado__desc {
	padding: 0 0.3125rem;
	text-align: right;
}

[data-fdoc] .cab-estado__c {
	text-align: center;
	border-left: 1px solid #111;
}

/* La descripción va alineada a la DERECHA, pegada a sus casillas: es lo que
   hace el formato en papel y lo que permite seguir la fila sin perderse. */
[data-fdoc] .fila__desc {
	padding: 0 0.3125rem;
	text-align: right;
	overflow-wrap: anywhere;
}

/* La casilla NO fija tamaño de letra. Lo hacía —0.6875rem, en \`rem\` absolutos y
   sin equivalente en el bloque de impresión— y con eso la ✕ salía más grande que
   la descripción que tiene al lado: la casilla se convertía en la celda más alta
   de la fila y estiraba la fila entera 4 px. Con 130 ítems eso era un cuarto de
   hoja gastado en agrandar una marca que ya se ve por el color de su casilla.
   El alto de la fila lo manda la descripción, que es lo que se lee. */
[data-fdoc] .fila__c {
	display: grid;
	place-items: center;
	font-weight: 900;
	line-height: 1;
	border-left: 1px solid #cbd5e1;
}

/* El fondo de la casilla marcada da la lectura en diagonal; la ✕ sobrevive
   a una impresión en blanco y negro. */
[data-fdoc] .fila--ok .fila__c--on {
	background: #bbf7d0;
}

[data-fdoc] .fila--mal .fila__c--on {
	background: #fecaca;
}

[data-fdoc] .fila--alerta .fila__c--on {
	background: #fde68a;
}

[data-fdoc] .fila--neutro .fila__c--on {
	background: #e2e8f0;
}

[data-fdoc] .fila--mal .fila__desc,
[data-fdoc] .fila--alerta .fila__desc {
	font-weight: 700;
}

[data-fdoc] .fila--vacio .fila__desc {
	color: #64748b;
}

[data-fdoc] .fila--libre {
	grid-template-columns: 1fr minmax(6rem, 42%);
}

/* Campo de texto libre SIN respuesta, ya colapsado a un renglón (regla de
   altura, cabecera del módulo). Una sola celda a todo el ancho y NO el par
   etiqueta/valor de \`.fila--libre\`: en los formatos que alternan ítem y
   observación, el filete vertical de esas filas caía al 42% del ancho, muy
   lejos de las columnas de estado de las filas de checklist con las que se
   intercalan, y al bajar por la sección se veía un zigzag de filetes sueltos.
   Una celda continua desaparece del tramado y deja un solo eje vertical.

   La etiqueta se mantiene legible y solo la coletilla va en gris cursiva: lo
   que hay que poder leer es QUÉ se preguntó. */
[data-fdoc] .fila--nota {
	grid-template-columns: 1fr;
}

[data-fdoc] .fila--nota .fila__desc {
	color: #475569;
}

[data-fdoc] .fila__valor {
	padding: 0 0.3125rem;
	font-weight: 700;
	border-left: 1px solid #cbd5e1;
	overflow-wrap: anywhere;
}

[data-fdoc] .vacio {
	font-weight: 400;
	font-style: italic;
	color: #94a3b8;
}

[data-fdoc] .marca {
	padding: 0 0.25rem;
	font-weight: 800;
}

[data-fdoc] .marca--ok {
	color: #14532d;
	background: #bbf7d0;
}

[data-fdoc] .marca--mal {
	color: #7f1d1d;
	background: #fecaca;
}

[data-fdoc] .marca--alerta {
	color: #78350f;
	background: #fde68a;
}

[data-fdoc] .marca--neutro {
	color: #334155;
	background: #e2e8f0;
}

[data-fdoc] .marca--vacio {
	color: #64748b;
}

/* ── Texto libre CON contenido ────────────────────────────────────────
   Este bloque solo se dibuja cuando hay algo que leer; la observación vacía
   se colapsa a una \`.fila--libre\` desde el componente (ver la regla de altura
   en la cabecera del módulo). Por eso aquí NO hay \`min-height\`: el alto lo
   pone el texto, que siempre existe. */
[data-fdoc] .parrafo {
	border: 1px solid #111;
	border-top: none;
	break-inside: avoid;
}

[data-fdoc] .parrafo__k {
	padding: 0.0625rem 0.375rem;
	font-size: 0.625rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.02em;
	color: #334155;
	background: #f1f5f9;
	border-bottom: 1px solid #cbd5e1;
	break-after: avoid;
}

[data-fdoc] .parrafo__v {
	padding: 0.125rem 0.375rem;
	white-space: pre-wrap;
	orphans: 2;
	widows: 2;
}

[data-fdoc] .nota {
	padding: 0.125rem 0.375rem;
	font-size: 0.625rem;
	color: #334155;
	background: #f8fafc;
	border: 1px solid #111;
	border-top: none;
	orphans: 2;
	widows: 2;
	break-inside: avoid;
}

/* ── Firmas y evidencia ────────────────────────────────────────────── */
[data-fdoc] .firmas {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
	gap: 0.5rem;
	padding: 0.375rem;
	border: 1px solid #111;
	border-top: none;
	break-inside: avoid;
}

[data-fdoc] .firma {
	display: flex;
	flex-direction: column;
	justify-content: flex-end;
	break-inside: avoid;
}

[data-fdoc] .firma__img {
	display: block;
	width: 100%;
	height: 4rem;
	object-fit: contain;
	object-position: center bottom;
	/* Fondo blanco explícito: una firma PNG con transparencia sobre gris se
	   ve sucia al imprimir. */
	background: #fff;
}

/* Sin altura fija: una firma que no se registró no reserva el hueco de una que
   sí. Si hay OTRA firma en la misma línea, la rejilla estira esta celda hasta
   igualarla sola; si no hay ninguna, el bloque entero mide una línea. */
[data-fdoc] .firma__falta {
	display: grid;
	/* Abajo y centrado: se apoya en el filete del pie igual que se apoyaría el
	   trazo de una firma, así el hueco se lee como «aquí no firmó nadie» y no
	   como una nota suelta. */
	place-items: end center;
	padding-bottom: 0.0625rem;
	font-style: italic;
	color: #94a3b8;
}

[data-fdoc] .firma__pie {
	padding-top: 0.125rem;
	font-size: 0.625rem;
	font-weight: 700;
	text-align: center;
	border-top: 1px solid #111;
}

[data-fdoc] .evid,
[data-fdoc] .tabla-wrap {
	border: 1px solid #111;
	border-top: none;
	break-inside: avoid;
}

[data-fdoc] .evid > .galeria,
[data-fdoc] .tabla-wrap > .tabla {
	/* El relleno lo pone el contenido y no el contenedor: así el bloque vacío
	   —que ya no llega aquí— no podía dejar un marco con aire dentro. */
	margin: 0.25rem;
	width: calc(100% - 0.5rem);
}

[data-fdoc] .galeria {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
	gap: 0.25rem;
}

[data-fdoc] .foto {
	break-inside: avoid;
}

[data-fdoc] .foto__img {
	display: block;
	width: 100%;
	aspect-ratio: 4 / 3;
	object-fit: cover;
	border: 1px solid #cbd5e1;
}

[data-fdoc] .archivo {
	display: flex;
	flex-direction: column;
	padding: 0.125rem 0.375rem;
	font-size: 0.625rem;
	background: #f8fafc;
	border: 1px solid #cbd5e1;
}

[data-fdoc] .archivo span {
	color: #64748b;
	font-family: var(--font-mono, ui-monospace, monospace);
}

[data-fdoc] .tabla {
	border-collapse: collapse;
}

[data-fdoc] .tabla th,
[data-fdoc] .tabla td {
	padding: 0.0625rem 0.3125rem;
	text-align: left;
	vertical-align: top;
	border: 1px solid #cbd5e1;
}

/* Relativo al cuerpo y no en \`rem\` absolutos: en \`rem\` el encabezado acababa
   siendo MÁS grande que el texto de la tabla al pasar a papel, que es justo lo
   contrario de lo que tiene que pasar. */
[data-fdoc] .tabla th {
	font-size: 0.85em;
	letter-spacing: 0.03em;
	text-transform: uppercase;
	background: #f1f5f9;
}

/* ── Pie ──────────────────────────────────────────────────────────────
   En pantalla cierra el documento; en papel pasa a ser el pie CORRIDO de cada
   hoja (ver el bloque de impresión). */
[data-fdoc] .pie {
	display: flex;
	justify-content: space-between;
	gap: 1rem;
	flex-wrap: wrap;
	margin-top: 0.375rem;
	padding-top: 0.1875rem;
	font-size: 0.5625rem;
	color: #64748b;
	border-top: 1px solid #cbd5e1;
	font-family: var(--font-mono, ui-monospace, monospace);
}

/* ── Impresión ─────────────────────────────────────────────────────────
   El documento que se ve ES el que sale. Solo cambia lo que no tiene
   sentido en papel: la barra, el marco exterior y el pie, que deja de cerrar
   el documento para repetirse en cada hoja.

   Aplica igual con \`window.print()\` y con el PDF del servidor: Puppeteer
   imprime emulando el medio \`print\`, así que este bloque gobierna los dos. */
@media print {
	body {
		background: #fff;
	}

	/* Global a propósito: la barra de herramientas está FUERA del documento, así
	   que acotarla al documento la dejaría visible en el papel. */
	.no-print {
		display: none !important;
	}

	[data-fdoc] {
		padding: 0;
		border: none;
		/* 6pt con interlineado 1,15 deja la fila en ~2,7 mm. Con 131 ítems a dos
		   columnas son unos 180 mm de cuerpo: el checklist entero cabe en la CARA
		   frontal y las firmas y fotos quedan para el reverso, que es exactamente
		   cómo se usa el formato en papel. Bajar más no gana una página y sí
		   empieza a costar legibilidad al sol. */
		font-size: 6pt;
		line-height: 1.15;
	}

	[data-fdoc] .cuerpo {
		column-gap: 3mm;
		/* Se llena la primera columna hasta abajo antes de pasar a la segunda, en
		   vez del reparto equilibrado por defecto: equilibrar deja las dos a media
		   altura y desperdicia el resto de la cara. */
		column-fill: auto;
	}

	/* La cabecera de estados se repite una vez por sección; con diez secciones
	   son diez repeticiones, así que se reduce a lo mínimo legible. */
	[data-fdoc] .cab-estado {
		font-size: 4.6pt;
	}

	[data-fdoc] .banda {
		font-size: 5.6pt;
	}

	[data-fdoc] .cab__titulo {
		font-size: 9pt;
	}

	/* La cabecera y la ficha no compiten con el checklist por el espacio. Basta
	   con mover el tamaño del contenedor: las columnas van en \`em\`. */
	[data-fdoc] .cab__meta {
		font-size: 5.6pt;
	}

	[data-fdoc] .ficha__par dt {
		font-size: 4.9pt;
	}

	[data-fdoc] .ficha__par dd {
		font-size: 6pt;
	}

	[data-fdoc] .resumen__lista {
		font-size: 5.6pt;
	}

	[data-fdoc] .parrafo__k,
	[data-fdoc] .nota,
	[data-fdoc] .archivo,
	[data-fdoc] .firma__pie {
		font-size: 5.6pt;
	}

	/* Una sección partida entre dos columnas deja la mitad de sus ítems SIN la
	   cabecera B·R·M·NA, y ocho marcas en columnas sin nombre no se pueden
	   auditar. \`avoid\` es una petición, no una orden: si la sección no cabe
	   entera en una columna el motor la parte igual, así que una sección larga
	   sigue fluyendo y solo se salvan las que sí caben —que son la mayoría—. */
	[data-fdoc] .sec {
		break-inside: avoid;
	}

	/* Nada de esto se puede partir por la mitad sin dejar de ser legible: media
	   firma, media foto o una etiqueta de observación sin su texto obligan a
	   pasar la hoja para entender un solo dato. Las tablas SÍ se parten a
	   propósito: para eso repiten su encabezado. */
	[data-fdoc] .cab,
	[data-fdoc] .ficha,
	[data-fdoc] .resumen,
	[data-fdoc] .anulado,
	[data-fdoc] .fila,
	[data-fdoc] .cab-estado,
	[data-fdoc] .parrafo,
	[data-fdoc] .nota,
	[data-fdoc] .firmas,
	[data-fdoc] .firma,
	[data-fdoc] .foto,
	[data-fdoc] .evid,
	[data-fdoc] .tabla tr {
		break-inside: avoid;
	}

	/* Una tabla de hallazgos que cruza de hoja repite su encabezado en la
	   siguiente; sin esto, la segunda mitad son columnas sin nombre. */
	[data-fdoc] .tabla thead {
		display: table-header-group;
	}

	/* Los fondos de las casillas marcadas son la única señal de estado en el
	   papel junto a la ✕; sin esto Chrome los descarta al imprimir. */
	[data-fdoc] .fila__c--on,
	[data-fdoc] .marca,
	[data-fdoc] .banda,
	[data-fdoc] .cab-estado,
	[data-fdoc] .cab__meta dt,
	[data-fdoc] .ficha__par dt,
	[data-fdoc] .parrafo__k,
	[data-fdoc] .tabla th,
	[data-fdoc] .resumen,
	[data-fdoc] .cab__logo {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}

	/* El logo es lo que identifica el documento como oficial: si la impresión
	   lo descarta, el papel deja de valer como constancia. */
	[data-fdoc] .cab__logo {
		max-height: 12mm;
	}

	/* Pie CORRIDO. Chrome repite en todas las hojas los elementos
	   \`position: fixed\`, que es el único mecanismo disponible aquí: las cajas de
	   margen de \`@page\` (\`@bottom-center\`) no están implementadas en Chromium.
	   Va en el margen inferior, que por eso es más ancho que los otros tres.

	   Sin numeración de páginas a propósito: \`counter(page)\` solo existe dentro
	   de esas cajas de margen, y la otra vía —\`displayHeaderFooter\` de
	   Puppeteer— la decide el backend, cuyo endpoint solo acepta html, css y
	   filename. Un «Página 1 de 1» impreso en todas las hojas sería peor que no
	   ponerlo: en un registro de auditoría, un dato de paginación falso invita a
	   dudar de que el documento esté completo. Lo que sí viaja en cada hoja es
	   la identidad del registro (código, versión e id del envío), que es lo que
	   permite reunir hojas sueltas. */
	[data-fdoc] .pie {
		position: fixed;
		left: 0;
		right: 0;
		bottom: -6.5mm;
		flex-wrap: nowrap;
		margin: 0;
		padding-top: 0.5mm;
		font-size: 5pt;
		background: #fff;
		border-top: 0.2mm solid #94a3b8;
	}
}

@page {
	size: letter;
	/* 6 mm es el mínimo que imprime completo una láser de oficina sin recortar.
	   Cada milímetro recuperado aquí son dos filas más de checklist. El margen
	   inferior es mayor porque ahí se aloja el pie corrido. */
	margin: 6mm 6mm 11mm;
}
`;
}
