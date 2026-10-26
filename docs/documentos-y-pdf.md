# Documentos y PDF

Qué caminos hay para producir un documento —PDF, impresión, Excel, ZIP, QR—,
cuál usa cada documento de la app y por qué no se unifican. Léelo antes de
tocar un desprendible, una liquidación imprimible, el documento de un envío de
formulario o un extracto FUEC, y antes de crear un documento nuevo: la
elección del camino decide si el documento puede divergir de sí mismo.

## Los caminos, de un vistazo

| Camino | Quién pinta | Documentos |
|---|---|---|
| **DOM → Chromium del servidor** | El navegador maqueta; el backend añade fuentes embebidas (o nada) y pasa el HTML por Puppeteer | Vista previa de los canvas de terceros y de recorridos; documento de un envío de formulario dinámico; liquidación de servicio y liquidación de un tercero (por `/api/pdf/from-html`) |
| **Plantilla del servidor** | El backend, desde su propio template | SARLAFT, salidas NC, acciones correctivas, inducciones, asistencias, reporte mensual de recargos |
| **Impresión del navegador** (`window.print()` + `@media print`) | El navegador | Respaldo cuando falla el PDF del servidor; cualquier página con `Ctrl+P`, incluido el documento de un envío |
| **pdfmake en el navegador** | Una definición de documento en TypeScript | Desprendible de nómina (también el de la app móvil), prima, intereses de cesantías, consolidado del fondo de viáticos, extracto FUEC |
| **Excel** | `exceljs` en el navegador, o el backend | Libro de un canvas de terceros, historial de liquidaciones de servicios; Excel de la liquidación de servicio (backend) |

La regla que lo ordena todo: **un documento tiene un solo renderizador.** Dos
implementaciones del mismo papel divergen en silencio —el preview se ve de un
color y el PDF de otro, el mismo mes tiene dos desprendibles según por dónde se
descargue— y nadie lo nota hasta que un tercero o un auditor los pone uno al
lado del otro. Cuando hay dos copias inevitables, un test las compara.

## DOM → Chromium del servidor

El documento se maqueta en Svelte, el usuario lo ve, y para el PDF se manda
**ese mismo DOM** al backend, que lo imprime con Chromium. Se usa cuando el
documento se deriva de una estructura dinámica que el front ya sabe pintar: un
renderizador paralelo en el backend tendría que reimplementar los diecinueve
tipos de campo de un formulario (o las columnas configurables de un canvas) y
divergiría a la primera modificación.

| Documento | Componente y hoja de estilos | Exportador | Endpoint |
|---|---|---|---|
| Vista previa de los canvas de cierres, adicionales, ocasional, ingresos y recorridos | [PreviewCanvasModal](../src/lib/components/liquidaciones-terceros/preview/PreviewCanvasModal.svelte), [DocumentoHoja](../src/lib/components/liquidaciones-terceros/preview/DocumentoHoja.svelte), [documento.css.ts](../src/lib/components/liquidaciones-terceros/preview/documento.css.ts); un adaptador por canvas en [preview/datos/](../src/lib/components/liquidaciones-terceros/preview/datos/) | [exportar-pdf.ts](../src/lib/components/liquidaciones-terceros/preview/exportar-pdf.ts), [exportar-zip.ts](../src/lib/components/liquidaciones-terceros/preview/exportar-zip.ts) | `POST /api/liquidaciones-terceros/canvas/pdf` (120 s) y `/canvas/pdf-zip` (600 s: un PDF por hoja) |
| Documento de un envío de formulario dinámico | [PreviewEnvioPDF](../src/lib/components/formularios/PreviewEnvioPDF.svelte), [documento-envio.css.ts](../src/lib/components/formularios/documento-envio.css.ts) | [exportar-pdf-envio.ts](../src/lib/components/formularios/exportar-pdf-envio.ts) | `POST /api/formularios/documento/pdf` (120 s) |

Las dos rutas las atiende el mismo servicio del backend
(`liquidaciones-terceros-pdf/canvas-pdf.service.ts`), que añade las fuentes
embebidas. El contrato es `{ html, css, filename }` y la respuesta, un blob que
se **abre** en una pestaña nueva (casi siempre se quiere mirar antes de
guardar). La URL del blob se revoca al minuto.

Reglas que no se negocian:

- **El CSS del documento vive en un módulo `.ts` que devuelve una cadena, no en
  el `<style>` del componente.** El CSS de un componente Svelte lleva hashes de
  scope (`.tbl.svelte-1a2b3c`) que no sirven para mandarlo a otro sitio, y
  recuperarlo del CSSOM (filtrando `document.styleSheets` por esa clase)
  depende de detalles que cambian entre `vite dev` y el build: cuando el filtro
  falla, el PDF sale con el texto y las imágenes desnudos, sin una sola regla y
  sin ningún error, y nadie lo nota hasta que abre el archivo. Con el módulo, el
  preview y el PDF son literalmente la misma hoja: el componente la inyecta con
  ``<svelte:head>{@html `<style>${css}</style>`}</svelte:head>`` y el
  exportador la importa como valor.
- **Ese CSS global se acota con un atributo** del contenedor (`[data-fdoc]` en
  los envíos) en vez de renombrar clases. Cuidado con los acentos graves dentro
  de la plantilla literal: un comentario CSS que escriba algo entre acentos
  graves cierra la cadena y tumba la función en tiempo de ejecución.
- **El HTML se toma del DOM ya renderizado** (`cloneNode`), sin recomponerlo:
  el PDF no puede salir con otras columnas, otro orden u otros totales que los
  que el usuario está mirando. Antes de mandarlo se quita todo lo `.no-print` y
  se pasan a data-URL las imágenes con ruta relativa (logo, sello): Puppeteer
  usa `setContent`, sin URL base, y una ruta relativa no resuelve contra nada.
  Las URL firmadas de S3 se dejan tal cual; el backend espera a que carguen.
- **Lo único que cambia entre pantalla y papel es la escala.**
  `documentoCss(escala, conPagina)` emite las medidas tipográficas
  multiplicadas (el preview dibuja sobre un lienzo de 2480 px y usa
  `ESCALA_PREVIEW = 1.35`) y, solo para el PDF, la regla
  `@page { size: letter landscape; … }`.

En el PDF de recorridos, la descripción del servicio y el cliente conservan el
texto completo en el preview y se limitan a una sola línea con puntos
suspensivos al exportar. Así esos datos largos no aumentan la altura de las
filas ni desplazan recorridos a páginas adicionales.

El exportador individual y el de lotes usan las rutas locales de marca:
`logo_nombre.webp` para la cabecera y `sello-firma-terceros.webp` para el sello.
La misma imagen se usa en nómina y en la liquidación regular del tercero.

En los envíos de formularios, el bloque `@media print` de
`documento-envio.css.ts` sirve a las dos salidas: el PDF del servidor (Chromium
imprime emulando el medio `print`) y el `Ctrl+P` del navegador, porque las dos
parten del mismo DOM. El portal reutiliza el componente tal cual en
[formularios/envios/[id]/documento](../src/routes/public/portal/formularios/envios/[id]/documento/+page@public.svelte),
una hoja sin la cáscara del portal (`+page@public.svelte`): es lo que la app
móvil descarga para que el conductor tenga firmas y fotos. El preview es
**adaptativo, no configurable**: la disposición sale del tipo de cada campo y
del `color` semántico de sus opciones (`emerald`, `red`, `amber`, `gray`), nunca
de los literales `B`/`M`/`NA`. No hay plantillas por formato: un formato nuevo
nacería roto hasta que alguien lo maquetara. El detalle de los formularios
dinámicos está en [formularios-dinamicos/](./formularios-dinamicos/README_ARQUITECTURA.md).

El ZIP de cierres compone cada hoja fuera de la vista con `componer-hojas.ts`,
el mismo código que usa el envío por correo, y las manda al servidor de una vez.
Por eso el consolidado de un periodo no monta los cuarenta conductores en
pantalla: `exportarPdfCompuesto` los compone fuera y los manda como un cuerpo.

### Liquidaciones por `/api/pdf/from-html`

Dos documentos usan una variante del mismo camino, sin módulo de CSS propio: el
componente copia las hojas a un HTML independiente con todos los estilos de la
página y lo manda a `POST /api/pdf/from-html` (el servicio genérico de
Puppeteer del backend).

- **Liquidación de servicio** ([LiquidacionEditor.svelte](../src/lib/components/LiquidacionEditor.svelte)).
  El modal de impresión deja elegir hojas (liquidación, recargos, liquidador y,
  con permiso, terceros); se montan, se clonan solo los `.print-sheet` y se
  piden en A4 apaisado sin margen. Las páginas con nombre `liqPortrait` y
  `liqLandscape` hacen que la hoja 1 salga en carta vertical y las 2-4 en A4
  apaisado dentro del mismo PDF. Imprimir el DOM vivo producía páginas en
  blanco (los envoltorios del dashboard con `min-height: 100vh` y `flex`): si
  el servidor falla, se abre ese HTML en una ventana aparte y se imprime ahí,
  y solo si el navegador bloquea la ventana se cae a `window.print()` sobre la
  página.
- **Liquidación de un tercero** ([PreviewTerceroPDF.svelte](../src/lib/components/PreviewTerceroPDF.svelte),
  en `/dashboard/liquidaciones-terceros/[id]`): mismo patrón, en carta
  apaisada, con `window.print()` si el servidor falla. **No** usa la plantilla
  `liquidaciones-terceros-pdf.template.ts` del backend ni
  `GET /api/liquidaciones-terceros/:id/pdf`, aunque el cliente
  (`liquidacionesTercerosDescuentosAPI.descargarPdf`) existe.

Los dos cogen el token de `localStorage['transmeralda_token']` y hacen el
`fetch` a mano, sin `apiClient`.

## Tokens compartidos con el backend

[src/lib/styles/pdf-tokens.ts](../src/lib/styles/pdf-tokens.ts) es **espejo
exacto** de `backend-cotransmeq/src/modules/liquidaciones-terceros-pdf/pdf-tokens.ts`.
Es un mapa plano (`verde`, `rejilla`, `fs-body`, `pad-y`…) que `pdfCssVars()`
convierte en custom properties `--tpdf-*`; solo las claves `fs-*` escalan. Las
claves conservan el nombre histórico (`verde`, `verde-borde`…) con valores
**naranja**, igual que `app.css` conserva `--emerald-*`: renombrarlas
obligaría a tocar `documento.css.ts`, que es idéntico al del gemelo y debe
seguir siéndolo.

No hay paquete compartido entre los dos builds, así que el test
`pdf-tokens.spec.ts` del backend lee este archivo del disco
(`../cotransmeq-app/src/lib/styles/pdf-tokens.ts`) y falla si los mapas difieren
(también si se añade una clave en un solo lado, o si se cuela un color que no
sea hex de seis dígitos). Si el archivo no está en esa ruta hermana, por
ejemplo en un checkout aislado del backend, el test se **salta** en vez de
fallar. Al cambiar un token se cambian los dos archivos en el mismo commit.

Aquí los tokens los usan la vista previa de los canvas (`documento.css.ts`) y
su Excel; `PreviewTerceroPDF` no los usa.

Sobre las fuentes: el servicio de PDF de los canvas embebe Fraunces, Inter Tight
y JetBrains Mono (`liquidaciones-terceros-pdf/fonts.ts`), mientras que la app no
descarga ninguna fuente (ver [componentes-y-estilos.md](./componentes-y-estilos.md)).
Si el CSS de un documento nombra una de esas familias —los tokens `fuente-sans`
y `fuente-mono` lo hacen—, el PDF sale con ella y la pantalla con la siguiente
de la pila.

Los demás PDF que genera el backend y el front solo descarga: SARLAFT
(`/api/formularios-sarlaft/:id/pdf`, documentos generados y el ZIP de
evidencia), salidas NC, acciones correctivas, inducciones, asistencias (uno o
varios) y el reporte mensual de recargos. Sus endpoints están en
[cliente-api.md](./cliente-api.md).

## Impresión del navegador

`window.print()` sobre el DOM vivo, con las reglas de impresión de
[app.css](../src/app.css): `@page { size: Letter portrait; margin: 0 }` (va en
la hoja global porque el scope de Svelte rompe `@page`; vertical para no dejar
una hoja apaisada en blanco al principio) y un `@media print` que quita la
cáscara del dashboard y resetea las alturas de `html`, `body` y
`.workbook-page`.

Aquí la impresión del navegador es sobre todo el **respaldo** de los PDF por
`/api/pdf/from-html` y el `Ctrl+P` de cualquier página. Las reglas globales son
amplias: ocultan `aside`, `nav`, todo lo que tenga `sidebar`/`Sidebar` en la
clase, los `header` (salvo dentro de `[data-fdoc]`), cualquier elemento con
`.z-30`, `.z-40` o `.z-50`, `.glass-dark` y `.border-orange-500`. Un elemento
del documento con una de esas clases desaparece del papel. Lo que no debe
imprimirse lleva `.no-print`.

## pdfmake en el navegador

Para documentos de maquetación fija que tienen que ser idénticos por todos los
canales y se arman desde datos.
[pdfmake-cargar.ts](../src/lib/utils/pdfmake-cargar.ts) es la única carga:
`cargarPdfMake()` importa pdfmake y sus fuentes una vez (acepta las tres formas
que ha tenido `vfs_fonts`; un fallo no se queda cacheado) y `blobDePdf()` envuelve
`getBlob` en una promesa que **siempre** termina, con un plazo de 60 s: pdfmake
0.3 puede fallar dentro sin llamar al callback, y la vista previa se quedaba
«generando» para siempre.

pdfmake no lee WebP. Toda imagen de `static/` que se incruste pasa antes a PNG
con un `<canvas>`: `logoPngDataUrl()` de
[pdfControlDias.ts](../src/lib/utils/pdfControlDias.ts) o, en este repo,
también `imageToBase64Url()` de [pdfUtils.ts](../src/lib/utils/pdfUtils.ts). Las
proporciones de los logos de Cotransmeq no son las del gemelo: en pdfmake se
usa `fit: [w, h]` en vez de `width` y `height` a la vez (ver [AGENTS.md](../AGENTS.md)).

### El desprendible de nómina

[pdfDesprendible.ts](../src/lib/utils/pdfDesprendible.ts) **es el
desprendible**. Expone:

| Función | Para |
|---|---|
| `construirDocDefinition(liquidacion, firmas, recargosData)` | Arma el documento sin abrirlo. Todos los cálculos están aquí. |
| `generarPdfDesprendible(...)` | Abrirlo en una pestaña (uso interactivo). |
| `generarBlobDesprendible(...)` | El ZIP del canvas de nómina. |
| `generarBase64Desprendible(...)` | La app móvil. |

Quién lo llama: el canvas de nómina a través de
[editor/canvas/desprendible-nomina.ts](../src/lib/editor/canvas/desprendible-nomina.ts)
(vista previa, PDF suelto y ZIP, con caché por liquidación durante la sesión del
canvas), `nomina/LiquidacionDetalleModal.svelte`, el portal
([public/portal/desprendibles](../src/routes/public/portal/desprendibles/+page.svelte))
y el enlace firmado ([public/desprendible/[token]](../src/routes/public/desprendible/[token]/+page.svelte)).
**La app móvil recibe el mismo documento**: el backend
(`GET /conductor-portal/desprendibles/:id/pdf`) abre con Puppeteer
[public/portal/desprendibles/imprimir/[id]](../src/routes/public/portal/desprendibles/imprimir/[id]/+page@public.svelte)
sembrando una sesión de 180 s que solo lee ese desprendible; la página ejecuta
`generarBase64Desprendible` y publica el resultado en `window.__desprendible`.
El backend tiene además su propia plantilla de desprendible
(`nomina-canvas/desprendible.template.ts`), pero ese es otro documento: ninguna
de las entradas web lo usa, y en `src/lib/api/nomina.ts` las funciones que lo
pedían (`downloadSinglePayslipPdf`, `generatePayslipsZip`) no tienen
llamadores. Volver a «unificar en el PDF del backend» cambiaría el documento
que recibe el conductor.

Queda una excepción heredada: [public/desprendible](../src/routes/public/desprendible/+page.svelte)
(sin `[token]`) arma **otra** maquetación con su propia definición de pdfmake a
partir de un JSON en base64 que llega en `?data=`. Nada en este front ni en el
backend enlaza a ella; no está comprobado si alguna app externa la usa. No la
tomes como referencia.

Desde el **10 de octubre de 2026 la página 1 es el diseño 2**, la maquetación
aprobada en septiembre: cabecera de marca con logo y mascota, franja de
identidad, tarjetas «Información básica», «Adicionales», «Novedades»,
«Deducciones», «Resumen de pago» y firmas con el sello. La pinta
`paginaPrincipalDiseno2()` de
[pdfDesprendibleDiseno.ts](../src/lib/utils/pdfDesprendibleDiseno.ts), que **no
calcula nada**: recibe las líneas ya resueltas para que el diseño no pueda
cambiar una cifra. En el front no hay interruptor: no queda otra maquetación de
la página 1. Las páginas de detalle (recargos por empresa, días sin recargo y
control de días OP-FR-03) usan las piezas `cabeceraSeccion`, `firmaConductor` y
`pieDocumento` del mismo archivo. Lo que cambia por empresa llega en
`MARCA_DISENO`, dentro de `pdfDesprendible.ts`: aquí verde bosque `#14532D` de
fondo, acento naranja `#F97316`, `logo_nombre_white.webp`, la mascota y el sello
corporativo generado desde el logo (`sello-firma-terceros.webp`), con la razón social SERVICIOS Y TRANSPORTES
COTRANSMEQ S.A.S. `pdfDesprendibleDiseno.ts` es idéntico en los dos repos.

Detalles que ya mordieron:

- El neto del resumen es `sueldo_total − interes_cesantias`, y «Total
  ingresos» se deriva del neto más salud, pensión y anticipos, para que el
  resumen cuadre siempre con lo que se paga.
- Los recargos salen **solo** de `liquidacion.recargos` (deduplicados por id y
  respetando la marca `incluir` del preview). No hay vuelta a
  `recargosData.planillas`: es un preview en vivo de todas las planillas del
  periodo y volvía a sumar las que el usuario desmarcó al liquidar.
- Cada planilla de las páginas de detalle lleva el color de su categoría: la
  marca para las que se pagan, azul para las de «bono aparte» (GEOLAB, RED
  SALUD…) y gris para las que no se pagan, en la cabecera y en la barra de
  total.
- Las marcas por día del canvas (`marcas_dias`: ocultar / no sumar) se aplican
  con `aplicarMarcasDias` de [marcasDias.ts](../src/lib/utils/marcasDias.ts).
- La página de control de días OP-FR-03 ([pdfControlDias.ts](../src/lib/utils/pdfControlDias.ts))
  solo la trae el canvas, que pide `/api/recorridos/canvas` con el rango de la
  liquidación. Sin permiso de lectura de `recorridos` el `.catch` la omite sin
  avisar. Cuando está, la de «días sin recargo» no se imprime.

### Otros documentos en pdfmake

| Archivo | Documento | Lo usa |
|---|---|---|
| [pdfPrima.ts](../src/lib/utils/pdfPrima.ts) | Liquidación de prima (RH-FR-30), con `logo_nombre.webp` | canvas de primas, portal |
| [pdfInteresesCesantias.ts](../src/lib/utils/pdfInteresesCesantias.ts) | Intereses de cesantías | `LiquidacionDetalleModal` |
| [pdfConsolidadoFondo.ts](../src/lib/utils/pdfConsolidadoFondo.ts) | Consolidado del fondo de viáticos de operaciones | `viaticos/ResumenViaticos` (la página le pasa `logo_nombre.webp`; el valor por defecto del componente aún es el logo del gemelo) |
| [pdfExtracto.ts](../src/lib/utils/pdfExtracto.ts) + [pdfExtractoDoc.ts](../src/lib/utils/pdfExtractoDoc.ts) | Extracto de contrato FUEC (OP-FR-04) | `dashboard/extractos` |

## Extractos FUEC y QR

[pdfExtractoDoc.ts](../src/lib/utils/pdfExtractoDoc.ts) describe la hoja (página
1, el formato; página 2, el texto de la Resolución 6652/2019) y es **espejo
byte a byte** de `backend-cotransmeq/src/modules/conductor-portal/pdfExtractoDoc.ts`:
el dashboard arma el PDF en el navegador y la app del conductor lo pide al
servidor, y los dos tienen que entregar el mismo documento, que es el que la
policía compara con la página del QR. `pdfExtractoDoc.spec.ts` del backend lo
compara con este archivo (y se salta si no lo encuentra). **Se edita aquí, se
formatea con el Prettier del front y se copia tal cual al backend.** Además es
idéntico al de `ingreso-svelte`, así que un cambio toca cuatro copias: los dos
frentes y los dos backends. No importa nada: ni `$lib`,
ni pdfmake, ni la librería del QR; cargar imágenes y fuentes lo resuelve quien
llama. Se imprime solo el `snapshot` que firmó el servidor: lo impreso es lo que
se validará.

[pdfExtracto.ts](../src/lib/utils/pdfExtracto.ts) pone lo que depende del
navegador: pasa las imágenes a PNG y dibuja el QR con `qrcode`
(`QRCode.toDataURL(urlPublicaExtracto(codigo), OPCIONES_QR_EXTRACTO)`, margen 0,
240 px, corrección `M`). El QR apunta a `${location.origin}/public/extracto/<código>`,
la página pública de verificación. El modal de detalle del extracto pinta en
pantalla un QR con el mismo enlace. `qrcode` también dibuja el enlace a la app
móvil en `perfil/AccesoAppMovil.svelte`, que no es un documento.

## Excel

`exceljs` siempre con `import()` dinámico: pesa cerca de 1 MB y nadie lo
necesita hasta pulsar el botón.

| Archivo | Exporta |
|---|---|
| [preview/exportar-excel.ts](../src/lib/components/liquidaciones-terceros/preview/exportar-excel.ts) | El libro entero de un canvas (cierres, adicionales, ocasional, ingresos y nómina), una pestaña por hoja, a partir del modelo (`DocumentoPreview`) y no del DOM: un libro son doce meses o cuarenta cierres que no están en pantalla. |
| [builders/servicios-historial-excel.ts](../src/lib/editor/builders/servicios-historial-excel.ts) | El historial de liquidaciones de servicios: una fila por ítem con la cabecera repetida, para poder filtrar y ordenar en Excel sin celdas de agrupado. |

[utils/exportTerceroXLSX.ts](../src/lib/utils/exportTerceroXLSX.ts) (una
liquidación de tercero con la estructura del PDF) existe pero nadie lo importa
aquí.

Dos decisiones comunes: los importes se escriben como **número con `numFmt`**,
nunca como «$ 1.234» (un texto no suma, no ordena ni filtra, que es para lo que
se abre el archivo); y el Excel del libro de un canvas escribe **todas** las
columnas, con las internas en gris, aunque el preview tenga apagadas algunas:
la selección de columnas delimita el papel que se entrega al tercero, y el
Excel es la herramienta de trabajo del equipo. En el historial, el pie suma con
fórmula solo las columnas de ítem; las de liquidación van calculadas en JS,
porque un `SUM` sobre una columna repetida multiplicaría cada total.

El Excel de **una liquidación de servicio** lo genera el backend:
`liquidacionesServiciosAPI.descargarExcel(id)` pide
`GET /api/liquidaciones-servicios/:id/csv` —la ruta conserva el nombre por
enlaces viejos, pero devuelve `.xlsx`— y toma el nombre del archivo de
`Content-Disposition`. Lo dispara el botón Excel de `LiquidacionEditor`.

## ZIP e imágenes

- [preview/zip.ts](../src/lib/components/liquidaciones-terceros/preview/zip.ts)
  escribe un ZIP mínimo sin compresión (`crearZip`): solo lleva PDF, que ya
  vienen comprimidos, y así no hace falta una librería. Lo usa el ZIP de
  desprendibles del canvas de nómina; el de cierres lo arma el servidor.
- El ticket de un servicio se comparte como imagen con `html2canvas`
  ([servicios/ModalTicket.svelte](../src/lib/components/servicios/ModalTicket.svelte)).
  La dependencia `html-to-image` no se usa.

## Cuál elegir para un documento nuevo

1. ¿Tiene que existir sin un navegador delante (adjunto de un correo, proceso
   programado)? Plantilla del servidor, o DOM → Chromium si el front ya lo
   pinta y el disparo sale de una pantalla.
2. ¿Se deriva de una estructura dinámica que el front ya renderiza
   (formularios, columnas configurables)? DOM → Chromium, con el CSS en un
   módulo `.ts`.
3. ¿Es un documento oficial de maquetación fija que debe salir idéntico por la
   web, el portal y la app? pdfmake, con una sola función constructora y, si el
   backend necesita el mismo documento, un espejo comparado por test (o la
   página que abre Puppeteer, como el desprendible).
4. ¿Solo hay que imprimir lo que se ve? `window.print()` y `.no-print`.
5. ¿Es para trabajar los datos? Excel con números y `numFmt`.

## Diferencias con Transmeralda

- **Liquidación de servicio.** Allí `LiquidacionEditor` imprime con
  `window.print()` sobre la página, con el `@page` global A4 apaisado; aquí se
  manda a `/api/pdf/from-html` con páginas con nombre.
- **Liquidación de un tercero.** Allí `PreviewTerceroPDF` parte de
  `pdf-tokens.ts`, el PDF lo genera el backend desde su plantilla
  (`GET /api/liquidaciones-terceros/:id/pdf`) y hay exportación a Excel con
  `exportTerceroXLSX`. Aquí, `/api/pdf/from-html`, sin tokens y sin Excel.
- **Tokens.** Mismas claves, valores verdes allí y naranjas aquí.
- **Desprendible.** `pdfDesprendible.ts` diverge bastante: marca, razón social
  y NIT; aquí cada planilla de las páginas de detalle lleva el color de su
  categoría, y allí esas páginas solo imprimen las planillas que respaldan un
  recargo guardado de la liquidación (o que no tienen ni una hora de recargo),
  mientras que aquí no se filtra por ese vínculo. `pdfDesprendibleDiseno.ts`,
  `pdfControlDias.ts`, `pdfExtractoDoc.ts` y `pdfmake-cargar.ts` son idénticos.
- **Logos en pdfmake.** Allí `pdfUtils.imageToBase64Url` no transcodifica y
  `pdfPrima.ts` incrusta un WebP; aquí sí transcodifica a PNG.
- **Vista previa de canvas.** El fallo de rutas de logo y sello de
  `exportar-pdf.ts` es solo de este repo: allí esas rutas existen.
