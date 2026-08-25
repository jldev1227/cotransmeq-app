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
 * `body` es la excepción: es el lienzo de la hoja impresa, está por encima del
 * documento y no puede colgar de él.
 */
export function documentoEnvioCss(): string {
	return `
/* ── Documento ─────────────────────────────────────────────────────────
   Sin esquinas redondeadas ni sombras: es un formato, no una tarjeta. */
[data-fdoc] {
	width: 100%;
	padding: 0.75rem;
	background: #fff;
	border: 1px solid #111;
	color: #111;
	font-size: 0.6875rem;
	line-height: 1.3;
}

[data-fdoc] .cab {
	display: grid;
	grid-template-columns: minmax(8rem, 15%) 1fr minmax(11rem, 20%);
	border: 1px solid #111;
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
	padding: 0.375rem 0.5rem;
	font-size: 0.8125rem;
	font-weight: 800;
	text-align: center;
	text-transform: uppercase;
	border-right: 1px solid #111;
}

[data-fdoc] .cab__meta {
	display: flex;
	flex-direction: column;
}

[data-fdoc] .cab__meta > div {
	display: grid;
	grid-template-columns: 4.5rem 1fr;
	flex: 1;
	border-bottom: 1px solid #111;
}

[data-fdoc] .cab__meta > div:last-child {
	border-bottom: none;
}

[data-fdoc] .cab__meta dt {
	padding: 0.125rem 0.3125rem;
	font-size: 0.625rem;
	font-weight: 700;
	background: #f1f5f9;
	border-right: 1px solid #111;
}

[data-fdoc] .cab__meta dd {
	padding: 0.125rem 0.3125rem;
	font-size: 0.625rem;
	font-family: var(--font-mono, monospace);
}

/* Banda de sección: el elemento que estructura todo el formato en papel. */
[data-fdoc] .banda {
	padding: 0.1875rem 0.4375rem;
	font-size: 0.6875rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.02em;
	color: #14532d;
	background: #dcf0e0;
	border: 1px solid #111;
	border-top: none;
	break-after: avoid;
}

[data-fdoc] .ficha {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
	border: 1px solid #111;
	border-top: none;
}

[data-fdoc] .ficha__par {
	display: grid;
	grid-template-columns: 6.5rem 1fr;
	border-bottom: 1px solid #cbd5e1;
}

[data-fdoc] .ficha__par dt {
	padding: 0.1875rem 0.375rem;
	font-size: 0.625rem;
	font-weight: 700;
	text-align: right;
	background: #f8fafc;
	border-right: 1px solid #cbd5e1;
}

[data-fdoc] .ficha__par dd {
	padding: 0.1875rem 0.375rem;
	font-weight: 600;
	overflow-wrap: anywhere;
}

[data-fdoc] .anulado {
	margin-top: 0.375rem;
	padding: 0.3125rem 0.4375rem;
	color: #991b1b;
	background: #fef2f2;
	border: 1px solid #991b1b;
}

/* ── Resumen ───────────────────────────────────────────────────────── */
[data-fdoc] .resumen {
	margin-top: 0.375rem;
	padding: 0.375rem 0.5rem;
	background: #fffbeb;
	border: 1px solid #111;
	border-left: 3px solid #b45309;
}

[data-fdoc] .resumen--limpio {
	background: #f0fdf4;
	border-left-color: #15803d;
}

[data-fdoc] .resumen__t {
	font-size: 0.6875rem;
	font-weight: 800;
}

[data-fdoc] .resumen__pend {
	font-weight: 600;
	color: #92400e;
}

[data-fdoc] .resumen__lista {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
	gap: 0.0625rem 1rem;
	margin-top: 0.25rem;
	padding: 0;
	list-style: none;
	font-size: 0.6875rem;
}

/* ── Cuerpo a dos columnas ─────────────────────────────────────────── */
[data-fdoc] .cuerpo {
	columns: 2;
	column-gap: 0.5rem;
	margin-top: 0.375rem;
}

[data-fdoc] .sec {
	margin-bottom: 0.375rem;
}

[data-fdoc] .sec--ancha {
	margin-top: 0.5rem;
}

/* Cabecera de columnas de estado. \`--n\` es cuántas casillas hay: el mismo
   valor gobierna la cabecera y cada fila, así que no se desalinean. */
[data-fdoc] .cab-estado,
[data-fdoc] .fila {
	display: grid;
	grid-template-columns: 1fr repeat(var(--n, 3), 1.6rem);
	border: 1px solid #111;
	border-top: none;
}

[data-fdoc] .cab-estado {
	background: #e2e8f0;
	font-size: 0.5625rem;
	font-weight: 800;
	text-transform: uppercase;
}

[data-fdoc] .cab-estado__desc {
	padding: 0.125rem 0.375rem;
	text-align: right;
}

[data-fdoc] .cab-estado__c {
	padding: 0.125rem;
	text-align: center;
	border-left: 1px solid #111;
}

/* La descripción va alineada a la DERECHA, pegada a sus casillas: es lo que
   hace el formato en papel y lo que permite seguir la fila sin perderse. */
[data-fdoc] .fila__desc {
	padding: 0.125rem 0.375rem;
	text-align: right;
	overflow-wrap: anywhere;
}

[data-fdoc] .fila__c {
	display: grid;
	place-items: center;
	font-size: 0.6875rem;
	font-weight: 800;
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
	grid-template-columns: 1fr minmax(6rem, 40%);
}

[data-fdoc] .fila__valor {
	padding: 0.125rem 0.375rem;
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

[data-fdoc] .parrafo {
	border: 1px solid #111;
	border-top: none;
	break-inside: avoid;
}

[data-fdoc] .parrafo__k {
	padding: 0.125rem 0.375rem;
	font-size: 0.625rem;
	font-weight: 700;
	background: #f8fafc;
	border-bottom: 1px solid #cbd5e1;
}

[data-fdoc] .parrafo__v {
	padding: 0.25rem 0.375rem;
	white-space: pre-wrap;
	min-height: 1.5rem;
}

[data-fdoc] .nota {
	padding: 0.1875rem 0.375rem;
	font-size: 0.625rem;
	color: #334155;
	background: #f8fafc;
	border: 1px solid #111;
	border-top: none;
}

/* ── Firmas y evidencia ────────────────────────────────────────────── */
[data-fdoc] .firmas {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
	gap: 0.75rem;
	padding: 0.5rem;
	border: 1px solid #111;
	border-top: none;
}

[data-fdoc] .firma {
	display: flex;
	flex-direction: column;
	break-inside: avoid;
}

[data-fdoc] .firma__img {
	display: block;
	width: 100%;
	height: 4.5rem;
	object-fit: contain;
	object-position: center bottom;
	/* Fondo blanco explícito: una firma PNG con transparencia sobre gris se
	   ve sucia al imprimir. */
	background: #fff;
}

[data-fdoc] .firma__falta {
	display: grid;
	place-items: center;
	height: 4.5rem;
	font-style: italic;
	color: #94a3b8;
}

[data-fdoc] .firma__pie {
	padding-top: 0.1875rem;
	font-size: 0.625rem;
	font-weight: 700;
	text-align: center;
	border-top: 1px solid #111;
}

[data-fdoc] .evid,
[data-fdoc] .tabla-wrap {
	padding: 0.375rem;
	border: 1px solid #111;
	border-top: none;
}

[data-fdoc] .galeria {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
	gap: 0.375rem;
	margin-top: 0.25rem;
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
	padding: 0.25rem 0.375rem;
	font-size: 0.625rem;
	background: #f8fafc;
	border: 1px solid #cbd5e1;
}

[data-fdoc] .archivo span {
	color: #64748b;
	font-family: var(--font-mono, monospace);
}

[data-fdoc] .tabla {
	width: 100%;
	border-collapse: collapse;
	margin-top: 0.25rem;
}

[data-fdoc] .tabla th,
[data-fdoc] .tabla td {
	padding: 0.1875rem 0.3125rem;
	text-align: left;
	border: 1px solid #cbd5e1;
}

[data-fdoc] .tabla th {
	font-size: 0.5625rem;
	text-transform: uppercase;
	background: #f1f5f9;
}

[data-fdoc] .pie {
	display: flex;
	justify-content: space-between;
	gap: 1rem;
	flex-wrap: wrap;
	margin-top: 0.5rem;
	padding-top: 0.25rem;
	font-size: 0.5625rem;
	color: #64748b;
	border-top: 1px solid #cbd5e1;
	font-family: var(--font-mono, monospace);
}

/* ── Impresión ─────────────────────────────────────────────────────────
   El documento que se ve ES el que sale. Solo cambia lo que no tiene
   sentido en papel: la barra y el marco exterior. */
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
		font-size: 6.6pt;
	}

	[data-fdoc] .cuerpo {
		column-gap: 4mm;
	}

	[data-fdoc] .fila,
	[data-fdoc] .cab-estado,
	[data-fdoc] .parrafo,
	[data-fdoc] .firma,
	[data-fdoc] .foto {
		break-inside: avoid;
	}

	/* Los fondos de las casillas marcadas son la única señal de estado en el
	   papel junto a la ✕; sin esto Chrome los descarta al imprimir. */
	[data-fdoc] .fila__c--on,
	[data-fdoc] .marca,
	[data-fdoc] .banda,
	[data-fdoc] .cab-estado,
	[data-fdoc] .cab__logo {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}

	/* El logo es lo que identifica el documento como oficial: si la impresión
	   lo descarta, el papel deja de valer como constancia. */
	[data-fdoc] .cab__logo {
		max-height: 14mm;
	}
}

@page {
	size: letter;
	margin: 8mm;
}
`;
}
