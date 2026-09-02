/**
 * CSS del DOCUMENTO de los previews de canvas.
 *
 * Es el mismo lenguaje visual que
 * `backend-nest/src/modules/liquidaciones-terceros-pdf/liquidaciones-terceros-pdf.template.ts`
 * —rejilla única, cabecera verde, pie gris, columnas de uso interno en
 * gris— pero generalizado: aquí el documento no es una liquidación
 * concreta sino «una o varias tablas con sus totales», que es lo que
 * tienen en común los cuatro canvas del módulo.
 *
 * ── Por qué el CSS vive en un .ts y no en el <style> del componente ──
 * El mismo texto se usa DOS veces: en el preview (escala del lienzo) y en
 * el HTML que se manda al backend para renderizar el PDF (escala 1). El
 * CSS de un componente Svelte va con hashes de scope (`.tbl.svelte-1a2b3c`)
 * y no sirve para el segundo uso. Teniéndolo aquí, preview y PDF son
 * literalmente la misma hoja de estilos y no pueden divergir.
 *
 * Los colores, bordes y cuerpos salen de `pdf-tokens.ts`, que el test
 * `pdf-tokens.spec.ts` del backend compara contra su espejo.
 */

import { pdfCssVars } from '$lib/styles/pdf-tokens';

/**
 * Tablas del documento. Todas comparten rejilla; lo que cambia entre
 * bloques es el CONTENIDO, no el lenguaje visual.
 *
 * Se declaran como lista para escribir la regla base UNA vez, igual que en
 * el template del backend.
 */
const TABLAS = ['.tbl', '.resumen-tbl', '.kv-tbl', '.bloque-tbl'];

/** `.a, .b` → `.a th, .b th` */
const cada = (sufijo: string) => TABLAS.map((t) => `${t} ${sufijo}`).join(',\n');

/**
 * Hoja de estilos del documento.
 *
 * @param escala multiplicador de las medidas tipográficas. 1 = documento
 *   impreso (lo que se manda al backend). El preview usa `ESCALA_PREVIEW`
 *   porque dibuja sobre un lienzo mucho más ancho que una carta.
 * @param conPagina emite la regla `@page`. Solo en el PDF: en el preview
 *   no hace nada y ensucia el `<style>` inyectado.
 */
export function documentoCss(escala = 1, conPagina = false): string {
	return `
${conPagina ? '@page { size: letter landscape; margin: 8mm 8mm 6mm; }' : ''}

/* ── Tokens ─────────────────────────────────────────────────────────
   Espejo de pdf-tokens.ts, verificado por pdf-tokens.spec.ts. */
.doc { ${pdfCssVars(escala)} }

.doc, .doc * { box-sizing: border-box; }
.doc {
  background: #fff;
  color: var(--tpdf-tinta);
  font-family: var(--tpdf-fuente-sans);
  font-size: var(--tpdf-fs-body);
  line-height: 1.3;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── HEADER EDITORIAL ───────────────────────────────────────────── */
.doc .header {
  display: grid;
  grid-template-columns: 100px 1fr 200px;
  border: var(--tpdf-borde-marco) solid var(--tpdf-marco);
  margin-bottom: 3px;
}
.doc .header-logo {
  border-right: var(--tpdf-borde-marco) solid var(--tpdf-marco);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.doc .header-logo img { height: 38px; width: auto; object-fit: contain; }
.doc .header-logo .fallback {
  font-weight: 900;
  font-size: var(--tpdf-fs-head);
  color: var(--tpdf-verde);
  text-align: center;
  line-height: 1.05;
}
.doc .header-title {
  padding: 4px 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.doc .header-title .co {
  font-size: var(--tpdf-fs-seccion);
  font-weight: 800;
  color: var(--tpdf-verde);
  text-transform: uppercase;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.doc .header-title .doc-name {
  font-size: var(--tpdf-fs-foot);
  font-weight: 700;
  color: var(--tpdf-tinta-suave);
  margin-top: 1px;
  line-height: 1.2;
  text-transform: uppercase;
}
.doc .header-meta { border-left: var(--tpdf-borde-marco) solid var(--tpdf-marco); display: flex; }
.doc .header-meta table { width: 100%; border-collapse: collapse; height: 100%; }
.doc .header-meta td {
  padding: 2px 6px;
  font-size: var(--tpdf-fs-head);
  border-bottom: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
}
.doc .header-meta tr:last-child td { border-bottom: none; }
.doc .header-meta td.ml {
  font-weight: 700;
  background: var(--tpdf-interno-bg);
  color: var(--tpdf-tinta-suave);
  white-space: nowrap;
  text-align: right;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  width: 64px;
  border-right: var(--tpdf-borde-rejilla) solid var(--tpdf-marco);
}
.doc .header-meta td.mv {
  font-weight: 800;
  color: var(--tpdf-verde);
  text-align: left;
  font-family: var(--tpdf-fuente-mono);
}

/* ── BANDA DE PERIODO ───────────────────────────────────────────── */
.doc .period {
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-marco);
  margin-bottom: 3px;
  display: flex;
  flex-wrap: wrap;
  background: var(--tpdf-verde-suave);
}
.doc .period .pc {
  padding: 3px 9px;
  border-right: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.doc .period .pc:last-child { border-right: none; flex: 1; }
.doc .period .pc .lbl {
  color: var(--tpdf-tinta-tenue);
  font-weight: 600;
  font-size: var(--tpdf-fs-head);
  text-transform: uppercase;
}
.doc .period .pc .val {
  color: var(--tpdf-verde);
  font-weight: 800;
  font-size: var(--tpdf-fs-foot);
  font-family: var(--tpdf-fuente-mono);
}

/* ════════════════════════════════════════════════════════════════
   REJILLA ÚNICA
   ════════════════════════════════════════════════════════════════ */
${TABLAS.map((t) => `.doc ${t}`).join(',\n')} {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tpdf-fs-body);
  table-layout: fixed;
}

/* Cabecera repetida en cada página cuando la tabla se parte. */
${cada('thead')} { display: table-header-group; }

${cada('th')} {
  background: var(--tpdf-verde);
  color: #fff;
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  font-weight: 700;
  text-align: center;
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-verde-borde);
  font-size: var(--tpdf-fs-head);
  letter-spacing: 0.02em;
  overflow-wrap: break-word;
  line-height: 1.15;
  text-transform: uppercase;
}

${cada('td')} {
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  vertical-align: middle;
  overflow-wrap: break-word;
  line-height: 1.15;
}

${cada('tfoot td')} {
  font-weight: 800;
  background: var(--tpdf-foot-bg);
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-verde-borde);
}

/* Modificadores de celda, comunes a todas las tablas. */
${cada('td.num')},
${cada('td.tc')} { text-align: center; }
/* Sin salto de línea: un consecutivo de dos cifras partido en dos líneas
   ensancha la fila entera y descuadra la rejilla. Antes solo lo tenían los
   importes, y el número de fila se partía en cuanto pasaba de 9.
   (Ojo: dentro de este literal no se pueden usar acentos graves.) */
${cada('td.num')} {
  font-family: var(--tpdf-fuente-mono);
  font-weight: 700;
  white-space: nowrap;
}
${cada('td.mc')} {
  text-align: right;
  font-family: var(--tpdf-fuente-mono);
  font-weight: 700;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
${cada('td.pct')} {
  text-align: center;
  font-family: var(--tpdf-fuente-mono);
  color: var(--tpdf-tinta-tenue);
}
${cada('td.lbl')} {
  text-align: right;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-weight: 700;
}
/* Texto largo (cliente / recorrido): que respire antes de partir palabra. */
${cada('td.long')} { overflow-wrap: normal; word-break: keep-all; }

/* Columnas de uso interno: gris, para que se lean como «no es del cliente». */
${cada('th.col-internal')} {
  background: var(--tpdf-interno-head);
  border-color: var(--tpdf-interno-borde);
}
${cada('td.col-internal')} { background: var(--tpdf-interno-bg); }

/* Signo del importe. Lo decide el adaptador, no la columna. */
${cada('td.neg')} { color: var(--tpdf-rojo); }
${cada('td.pos')} { color: var(--tpdf-verde-texto); }

/* Fila destacada: adicional de COTRANSMEQ, fila de cierre, etc. */
.doc .tbl tbody tr.destacada td,
.doc .bloque-tbl tbody tr.destacada td {
  background: var(--tpdf-verde-suave);
  color: var(--tpdf-verde);
  font-weight: 800;
}
/* Fila excluida: se muestra, tachada, y no suma. */
.doc .tbl tbody tr.excluida td {
  color: var(--tpdf-tinta-tenue);
  text-decoration: line-through;
}

/* ── SECCIONES ──────────────────────────────────────────────────── */
.doc .sec { margin-top: 8px; break-inside: auto; }
.doc .sec:first-of-type { margin-top: 4px; }
.doc .sec-title {
  font-size: var(--tpdf-fs-titulo);
  font-weight: 800;
  color: var(--tpdf-verde);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 0 0 5px;
  padding-bottom: 3px;
  border-bottom: var(--tpdf-borde-marco) solid var(--tpdf-verde);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}
.doc .sec-title .sec-nota {
  font-size: var(--tpdf-fs-head);
  font-weight: 600;
  color: var(--tpdf-tinta-tenue);
  text-transform: none;
  letter-spacing: 0;
  font-family: var(--tpdf-fuente-mono);
}
/* Empuja la sección a una página nueva. En pantalla no hace nada: el
   preview es un lienzo continuo, sin paginar. */
.doc .page-break-before { page-break-before: always; break-before: page; }
.doc .sec-vacio {
  padding: 10px;
  text-align: center;
  color: var(--tpdf-tinta-tenue);
  font-style: italic;
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
}

/* ── BLOQUES (conductores, gastos, anticipos, impuestos) ────────── */
/* Rejilla de sub-tablas. Cada bloque evita partirse entre páginas: un
   conductor con su total en la hoja siguiente no se puede leer. */
.doc .bloques { display: grid; gap: 6px; margin-top: 5px; }
.doc .bloques-1 { grid-template-columns: 1fr; }
.doc .bloques-2 { grid-template-columns: repeat(2, 1fr); }
.doc .bloques-3 { grid-template-columns: repeat(3, 1fr); }
/* Bloque protagonista: ocupa la fila entera de la rejilla (resumen de la
   sección, pago interno por concepto). */
.doc .bloque-full { grid-column: 1 / -1; }
.doc .bloque {
  border: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  break-inside: avoid;
  page-break-inside: avoid;
}
.doc .bloque-head {
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  background: var(--tpdf-interno-bg);
  border-bottom: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  border-left: 4px solid var(--tpdf-verde);
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  font-size: var(--tpdf-fs-head);
}
.doc .bloque-titulo {
  font-size: var(--tpdf-fs-foot);
  font-weight: 800;
  color: var(--tpdf-verde-texto);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.doc .bloque-sub {
  font-family: var(--tpdf-fuente-mono);
  font-weight: 700;
  color: var(--tpdf-tinta-suave);
}
.doc .bloque-etiqueta {
  font-weight: 700;
  color: var(--tpdf-tinta-tenue);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.doc .bloque-pie {
  padding: var(--tpdf-pad-y) var(--tpdf-pad-x);
  background: var(--tpdf-verde-suave);
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-verde);
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--tpdf-fs-foot);
  font-weight: 800;
  color: var(--tpdf-verde-texto);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.doc .bloque-pie .v {
  font-family: var(--tpdf-fuente-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.doc .bloque-vacio {
  padding: 8px;
  text-align: center;
  font-style: italic;
  color: var(--tpdf-tinta-tenue);
}
/* Solo cambia el color: los cuatro bloques comparten estructura, y es lo
   único que hace falta para distinguirlos de un vistazo. */
.doc .bloque-gastos .bloque-head { border-left-color: var(--tpdf-ambar); }
.doc .bloque-gastos .bloque-titulo { color: var(--tpdf-ambar); }
.doc .bloque-gastos .bloque-pie { color: var(--tpdf-ambar); background: #fdf6ec; border-top-color: var(--tpdf-ambar); }
.doc .bloque-anticipos .bloque-head { border-left-color: var(--tpdf-azul); }
.doc .bloque-anticipos .bloque-titulo { color: var(--tpdf-azul); }
.doc .bloque-anticipos .bloque-pie { color: var(--tpdf-azul); background: #eef2ff; border-top-color: var(--tpdf-azul); }
.doc .bloque-impuestos .bloque-head { border-left-color: var(--tpdf-rojo); }
.doc .bloque-impuestos .bloque-titulo { color: var(--tpdf-rojo); }
.doc .bloque-impuestos .bloque-pie { color: var(--tpdf-rojo); background: #fdeeee; border-top-color: var(--tpdf-rojo); }
/* La card de un copropietario: su pie ES el neto a pagar, y va en verde
   pleno como en el PDF de la liquidación. */
.doc .bloque-copropietario .bloque-head {
  background: var(--tpdf-verde);
  border-left-color: var(--tpdf-verde-borde);
}
.doc .bloque-copropietario .bloque-titulo,
.doc .bloque-copropietario .bloque-sub,
.doc .bloque-copropietario .bloque-etiqueta { color: #fff; }
.doc .bloque-copropietario .bloque-pie {
  background: var(--tpdf-verde);
  color: #fff;
  border-top-color: var(--tpdf-verde-borde);
}
/* Pago interno por concepto: MISMA familia verde que la card del
   copropietario, pero un tono más claro y sin fondo pleno en la cabecera.
   Es deliberado: al lado de un neto a pagar tiene que verse que es dinero
   del mismo reparto, y a la vez que no sale hacia nadie. */
.doc .bloque-concepto .bloque-head {
  background: var(--tpdf-verde-claro-bg);
  border-left-color: var(--tpdf-verde-claro);
}
.doc .bloque-concepto .bloque-titulo { color: var(--tpdf-verde-claro); }
/* También la cabecera de la tabla: con el verde oscuro de las demás, el
   bloque se partía en dos y perdía la identidad que lo distingue. */
.doc .bloque-concepto .bloque-tbl th {
  background: var(--tpdf-verde-claro);
  border-color: var(--tpdf-verde-claro);
}
.doc .bloque-concepto .bloque-sub { color: var(--tpdf-verde-texto); font-weight: 700; }
.doc .bloque-concepto .bloque-tbl tbody tr td { background: var(--tpdf-verde-claro-bg); }
/* La fila del concepto manda; el titular cuelga debajo, en pequeño. */
.doc .bloque-concepto .bloque-tbl tbody tr.destacada td {
  font-weight: 800;
  color: var(--tpdf-verde-texto);
}
.doc .bloque-concepto .bloque-tbl tbody tr.hija td {
  font-size: var(--tpdf-fs-micro);
  color: var(--tpdf-tinta-tenue);
}

/* Fila de categoría dentro del bloque de un conductor. */
.doc .bloque-tbl tbody tr.categoria td {
  background: var(--tpdf-verde-suave);
  color: var(--tpdf-verde-texto);
  font-weight: 700;
  text-transform: uppercase;
}
.doc .bloque-tbl tbody tr.hija td.long { padding-left: 14px; color: var(--tpdf-tinta-tenue); }

/* ── RESUMEN FINAL ──────────────────────────────────────────────── */
.doc .resumen {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
  break-inside: avoid;
}
.doc .resumen-tbl {
  width: auto;
  min-width: 340px;
  table-layout: auto;
}
.doc .resumen-tbl td.lbl {
  text-align: left;
  font-weight: 800;
  font-size: var(--tpdf-fs-foot);
  text-transform: uppercase;
}
.doc .resumen-tbl td.mc { font-size: var(--tpdf-fs-foot); }
.doc .resumen-tbl tr.desc td {
  background: var(--tpdf-interno-bg);
  color: var(--tpdf-rojo);
}
.doc .resumen-tbl tr.fuerte td {
  background: var(--tpdf-verde);
  color: #fff;
  font-weight: 900;
  font-size: var(--tpdf-fs-seccion);
  border-color: var(--tpdf-verde-borde);
}

/* Bloque clave/valor a media página (totales de una hoja). */
.doc .kv { margin-top: 6px; break-inside: avoid; }
.doc .kv-tbl { table-layout: fixed; }
.doc .kv-tbl td.lbl { text-align: left; font-weight: 700; }
.doc .kv-tbl tr.desc td { background: var(--tpdf-interno-bg); color: var(--tpdf-rojo); }
.doc .kv-tbl tr.fuerte td {
  background: var(--tpdf-verde-suave);
  color: var(--tpdf-verde-texto);
  font-weight: 900;
  border-top: var(--tpdf-borde-marco) solid var(--tpdf-verde);
}

/* ── FIRMAS ─────────────────────────────────────────────────────── */
.doc .sigs {
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  break-inside: avoid;
}
.doc .sig {
  padding: 4px 10px 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 70px;
}
.doc .sig-lbl {
  font-weight: 800;
  color: var(--tpdf-verde);
  font-size: var(--tpdf-fs-seccion);
  letter-spacing: 0.03em;
}
/* El sello, estampado sobre la caja de LIQUIDADO POR.

   FUERA DEL FLUJO y centrado, con las mismas medidas que el PDF que sale por
   correo: ver .sig-img en liquidaciones-terceros-pdf.template.ts. Dos razones:
   el sello monta sobre la linea de firma como lo haria uno de caucho, y la
   caja no cambia de alto entre un documento sellado y uno que no, asi que un
   cierre aprobado y uno en borrador ocupan las mismas paginas.

   Ojo al editar: este CSS vive dentro de un template literal de TypeScript,
   asi que NO admite acentos graves en los comentarios. */
.doc .sig {
  position: relative;
}
.doc .sig-img {
  position: absolute;
  /* Anclado al FONDO, no centrado.
     El sello mide 120px de alto y la caja de la firma 77px, asi que centrarlo
     por porcentaje siempre lo dejaba desbordando por abajo y montado sobre el
     trazo: no se leia ni el sello ni la linea. Con bottom fijo, su base queda
     unos pixeles POR ENCIMA del trazo y lo que sobra desborda hacia arriba,
     que es donde hay sitio.
     28px = los 26px que hay del fondo de la caja al borde superior de la
     linea, mas dos de aire. */
  bottom: 5px;
  left: 50%;
  transform: translateX(-50%);
  max-height: 120px;
  max-width: 480px;
  width: auto;
  height: auto;
  object-fit: contain;
  /* Se imprime: sin esto Chromium lo omite al no ser texto. */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.doc .sig-line {
  border-top: var(--tpdf-borde-rejilla) solid var(--tpdf-marco);
  margin-top: 26px;
}

/* ── PIE ────────────────────────────────────────────────────────── */
.doc .doc-ft {
  margin-top: 8px;
  padding-top: 4px;
  border-top: var(--tpdf-borde-rejilla) solid var(--tpdf-rejilla);
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: var(--tpdf-fs-micro);
  color: var(--tpdf-tinta-tenue);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.doc .doc-ft .code {
  font-family: var(--tpdf-fuente-mono);
  font-weight: 700;
  color: var(--tpdf-verde-texto);
}
`.trim();
}
