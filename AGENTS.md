# cotransmeq-app

Frontend de Cotransmeq: dashboard administrativo + portal del conductor (SvelteKit, Svelte 5 con runes).

## Este proyecto tiene un gemelo

El mismo producto corre para dos empresas, en cuatro repos:

| | Transmeralda | Cotransmeq |
|---|---|---|
| Frontend | `ingreso-svelte` | `cotransmeq-app` |
| Backend | `backend-nest` | `backend-cotransmeq` |

**Todo arreglo o funcionalidad se aplica en los dos.** No es opcional ni hay que
preguntarlo: un fix que solo aterriza en uno reaparece como incidencia en el otro
días después, cuando ya se dio por resuelto. Esto incluye migraciones, `UPDATE` de
datos y cambios de infraestructura (CORS de bucket, variables de entorno).

Los archivos son idénticos entre repos **salvo la paleta de verdes** (la de
Cotransmeq es la columna derecha):

| Transmeralda | Cotransmeq |
|---|---|
| `#ecfdf5` | `#f0fdf4` |
| `#a7f3d0` | `#bbf7d0` |
| `#065f46` | `#166534` |

Y salvo el membrete de documentos: aquí es `Cotransmeq S.A.S`.

Al replicar, **aplica el mismo parche** en vez de copiar el archivo entero: copiar
pisa divergencias que no conocías. Verifica al terminar que las únicas líneas
distintas sean colores:

```bash
diff "$TF/$f" "$CF/$f" | grep '^[<>]' | grep -vcE '#[0-9a-f]{6}'   # debe dar 0
```

Y ejecuta `npm run check` en los dos, no solo en aquel donde escribiste.

## Ancho: aprovechar el espacio del layout

**Los contenedores de página no llevan `max-width`.** El contenido ocupa el ancho
que le dé el `main` del layout.

```css
/* ✗ mal */
.pagina { padding: 1.25rem 1rem 3rem; max-width: 68rem; margin: 0 auto; }

/* ✓ bien */
.pagina { padding: 1.25rem 1.25rem 3rem; }
```

**Por qué.** El layout ya acota el área útil con su barra lateral. Acotar otra vez
dentro deja franjas muertas a los lados en pantallas anchas, que es donde se
trabaja el dashboard. Y el coste no es solo estético: en una tabla de envíos o en
un checklist de 130 ítems, el ancho desperdiciado se paga en scroll. Un
preoperacional a tres columnas cabe en media pantalla; a una columna son ocho.

Para llenar ese ancho, usa rejillas fluidas en vez de puntos de ruptura:

```css
grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
columns: 3 20rem;   /* listas largas que fluyen, como un checklist */
```

**Lo que sí conserva `max-width`:**

- **Modales y diálogos** (`26rem`, `28rem`, `34rem`): son ventanas centradas, no páginas.
- **Párrafos de texto corrido** (`44rem`): pasado ese ancho la lectura se degrada
  porque el ojo pierde el renglón. Aplica a notas y avisos, no a datos ni tablas.
- **Controles concretos** (`12rem` en un input, `11rem` en un chip): son medidas
  del propio control.

En resumen: acota por legibilidad tipográfica o porque el elemento es una ventana;
nunca «por si acaso» en un contenedor de página.

## Convenciones

**Svelte 5 con runes.** `$state`, `$derived`, `$derived.by`, `$props`. No uses la
sintaxis reactiva antigua (`$:`) en componentes nuevos; queda código con ella y se
migra cuando se toca.

**Comentarios que explican el porqué, en español.** El repo documenta decisiones,
no mecánica. `/** */` para la interfaz de una función o componente; `///` para una
nota de implementación pegada a la línea que la necesita. Lo valioso es el motivo y
lo que se rompió antes:

```ts
/// El jitter evita el efecto manada: veinte conductores que recuperan cobertura
/// en el mismo punto de la ruta reintentarían en el mismo milisegundo.
```

**Prettier con tabs**, comillas simples, sin coma final, ancho 100.

## Comandos

```bash
npm run dev       # vite dev en :5173
npm run check     # svelte-kit sync && svelte-check   ← antes de dar nada por hecho
npm run format    # prettier --write .
npm run lint      # prettier --check . && eslint .
```

`npm run check` arrastra errores preexistentes en pantallas antiguas del dashboard.
Filtra por los archivos que tocaste en vez de leer el total:

```bash
npx svelte-check --tsconfig ./tsconfig.json --output machine 2>&1 | grep -i "<tu-archivo>"
```

Si `node_modules/.bin/prettier` da «Permission denied», invócalo por Node:
`node node_modules/prettier/bin/prettier.cjs --write <archivo>`.

## Portal del conductor: offline primero

`src/routes/public/portal/**` lo usa un conductor en un patio sin cobertura, con
un teléfono de gama baja y al sol. Reglas que no se negocian:

- **IndexedDB es la fuente de verdad** del borrador (`src/lib/offline/forms-db.ts`).
  El servidor recibe un backup, no el original.
- **La pantalla abre sin red**: primero se pinta lo cacheado, luego se reconcilia.
  Nada que necesite una petición para renderizar la primera vez.
- **Los envíos salen por la outbox** (`forms-sync.ts`), nunca con un `fetch` suelto:
  una operación a la vez, con lease, respetando dependencias.
- **Texto además de color**: un punto amarillo frente a uno verde es
  indistinguible al sol.
- **Objetivos táctiles de 44 px** como mínimo.
- **Un error que el conductor no puede corregir no se presenta como «necesita
  corrección»**. Si la operación quedó obsoleta, es ruido: retírala de la cola.

## Documentos y PDF

Dos enfoques conviven, y la elección depende de quién tiene que producir el PDF:

- **Servidor (Puppeteer)** — liquidaciones de terceros. El backend renderiza desde
  un template y el cliente descarga el blob; el preview del cliente solo imita el
  resultado. Los dos parten de `src/lib/styles/pdf-tokens.ts`, que es **espejo
  exacto** del fichero homónimo del backend y hay un test que falla si divergen.
  Úsalo cuando el PDF deba generarse sin navegador (adjuntarlo a un correo, un
  proceso programado).
- **Cliente (`window.print()` + `@media print`)** — envíos de formularios
  dinámicos (`PreviewEnvioPDF.svelte`). El documento que se ve **es** el que se
  imprime. Úsalo cuando el documento se deriva de una estructura dinámica: un
  segundo renderizador en el backend tendría que reimplementar los diecinueve
  tipos de campo y divergiría del primero.

El preview de un formulario dinámico es **adaptativo, no configurable**: la
disposición se deriva del tipo de cada campo y del `color` semántico de sus
opciones (`emerald`, `red`, `amber`, `gray`), nunca de los literales `B`/`M`/`NA`.
Así un formato nuevo se ve bien el día que se publica y sigue funcionando con
cualquier escala que HSEQ invente. No introduzcas plantillas por formato: cada
formato nuevo nacería roto hasta que alguien lo maquete.
