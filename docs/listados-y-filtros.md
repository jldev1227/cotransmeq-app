# Listados y filtros

Cómo funciona cualquier página con búsqueda, filtros, orden, pestañas o
paginación: el núcleo de [src/lib/listing/](../src/lib/listing/), que pone el
estado de la lista en la URL; `coincide()` para filtrar en cliente; la caché de
listas; las trampas que aparecieron al restaurar una página desde un enlace, y
las pruebas que lo fijan. Léelo antes de crear un listado o de tocar los
filtros de uno: no se inventa otro mecanismo.

Los componentes visuales (`TablaLista`, `BuscadorLista`, `PaginadorLista`,
`SegmentosFiltro`, `EstadoPunto`…) están en
[componentes-y-estilos.md](./componentes-y-estilos.md). Las trampas generales
de runes, en [estado-y-stores.md](./estado-y-stores.md).

## La URL es la fuente de verdad

Una vista filtrada se pega en un chat y el compañero ve lo mismo; el botón
atrás deshace el último filtro en vez de sacarte de la página; recargar no
pierde nada. Antes de este núcleo, de 23 páginas con lista solo 8 sincronizaban
algo con la URL (tres de ellas solo la pestaña), ninguna guardaba la página y
había siete valores de debounce distintos.

| Archivo | Qué da |
|---|---|
| [filtros.ts](../src/lib/listing/filtros.ts) | Las definiciones `texto()`, `opcion()`, `numero()`, `bandera()`, `lista()` y las funciones puras `leerDeParams`, `aParams`, `firma`, `contarActivos`, `limpiar`, `valoresPorDefecto`. |
| [urlState.ts](../src/lib/listing/urlState.ts) | `crearEstadoUrl(defs, opciones)`: el puente entre esas definiciones y la barra de direcciones. |
| [texto.ts](../src/lib/listing/texto.ts) | `normalizarTexto()` y `coincide()`, para buscar en cliente. |
| [listingStore.ts](../src/lib/listing/listingStore.ts) | `crearListingStore()`: caché de una o varias listas con revalidación por firma. |

Hoy usan `crearEstadoUrl` 26 páginas: el panel de inicio y, bajo
`dashboard/`, acciones correctivas, actividad, asistencias, cartera,
certificados, clientes, combustible, conductores, evaluaciones, extractos,
flota, formularios, formularios/asignaciones, incidentes, mantenimiento,
recargos, salidas NC, SARLAFT, servicios, solicitudes, terceros, usuarios,
viáticos y los canvas de primas y de análisis de nómina. El listado de
liquidaciones de servicios lleva su estado a la URL (pestaña, filtros de
cabecera, orden, página) también con `goto`, pero a mano en `syncUrl()`, sin el
núcleo.

## Declarar los filtros

Cada página declara qué filtros tiene y cómo viajan; el resto sale del núcleo.

| Definición | Tipo | En la URL |
|---|---|---|
| `texto(porDefecto = '')` | `string` | tal cual |
| `opcion(porDefecto)` | `string`, o una unión con `opcion<'A' \| 'B'>('A')` | tal cual |
| `numero(porDefecto)` | `number` | lo que no sea número vuelve al defecto |
| `bandera(porDefecto = false)` | `boolean` | `1`; ausente cuando es `false` |
| `lista(porDefecto = [])` | `string[]` | separados por coma |

`opcion` tiene dos firmas a propósito: sin la primera, `opcion('TODOS')`
inferiría el tipo literal `'TODOS'` y no encajaría en un campo `string`. Para
un filtro con otra forma, `DefinicionFiltro<T>` acepta `porDefecto`, `aUrl`
(devolver `null` lo deja fuera) y `desdeUrl` (solo recibe cadenas no vacías).

Tres reglas de serialización que no se tocan:

- **Los valores por defecto no se escriben.** `aParams` los omite (las listas
  se comparan elemento a elemento). Una URL limpia y una con todos los
  parámetros en su valor por defecto describen el mismo estado; si se
  escribieran, entrar a una página llenaría la barra de `estado=TODOS&pagina=1`.
- **Los parámetros ajenos se conservan** (`conservarAjenos: true` por defecto):
  aplicar un filtro no borra el `?conductor=<id>` que abre un detalle.
- **Se reemplaza la entrada del historial** (`reemplazar: true` por defecto):
  teclear «villanueva» no deja once entradas que haya que deshacer con atrás.

`firma(DEFS, valores)` resume en una cadena estable (claves ordenadas, sin los
defectos) lo que describe ese estado. Sirve de clave de caché y, sobre todo, de
dependencia de los efectos: ver la trampa del proxy más abajo.

## Escribir siempre con `goto`, nunca con `history.replaceState`

`escribir(urlActual, valores)` combina los parámetros propios con los ajenos y
llama a `goto(destino, { replaceState, noScroll: true, keepFocus: true,
invalidateAll: false })`: la lista no salta arriba al filtrar, el input no
pierde el foco y no se reejecutan los `load` (estas páginas cargan sus datos por
su cuenta). Si la cadena resultante es igual a la actual no navega; sin esa
comprobación, un efecto que escribe y lee la misma URL entra en bucle.

La diferencia con `history.replaceState` no es de estilo: este cambia la barra
de direcciones pero **no** `page.url`, así que el código que compara contra
`page.url` decide con una URL obsoleta. `/dashboard/conductores` lo hacía y su
`cambiarVista()` se equivocaba. Quedan `history.replaceState` legítimos fuera de
los listados —quitar un parámetro de un solo uso como `?nuevo=1` al montar, o
los canvas, que sincronizan periodo y hoja sin crear entradas—; cualquier código
que lea `page.url` después de uno de ellos ve la URL anterior.

`page` se importa de **`$app/state`**, no de `$app/stores`: el store antiguo no
propaga bien en modo runes. Las 26 páginas del núcleo ya lo hacen así.

## Una página nueva, mínima

El patrón de [sarlaft](../src/routes/dashboard/sarlaft/+page.svelte) y
[cartera](../src/routes/dashboard/cartera/+page.svelte), reducido:

```svelte
<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { firma, numero, opcion, texto, type DefinicionesFiltros } from '$lib/listing/filtros';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';

	interface Filtros {
		q: string;
		estado: string;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		q: texto(),
		estado: opcion('TODOS'),
		pagina: numero(1)
	};
	const POR_PAGINA = 20;

	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leerInicial());

	/// La firma lee cada campo: es lo que suscribe a los efectos.
	const firmaConsulta = $derived(firma(DEFS, filtros));

	// Filtros → URL.
	$effect(() => {
		void firmaConsulta;
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	// Filtros → servidor. Un solo disparador: nada de `load()` extra en `onMount`.
	let items = $state<Item[]>([]);
	let total = $state(0);
	let turno = 0;
	$effect(() => {
		void firmaConsulta;
		untrack(() => cargar());
	});
	async function cargar() {
		const yo = ++turno;
		const r = await miApi.listar({ ...filtros, limit: POR_PAGINA });
		if (yo !== turno) return; // solo pinta la última respuesta
		items = r.items;
		total = r.total;
	}

	/// Cambiar un filtro vuelve a la página 1.
	function poner<K extends keyof Filtros>(clave: K, valor: Filtros[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}
</script>

<BuscadorLista valor={filtros.q} onBuscar={(t) => poner('q', t)} etiqueta="Buscar…" />
<!-- …TablaLista, SegmentosFiltro, ResumenConteos… -->
<PaginadorLista
	pagina={filtros.pagina}
	{total}
	porPagina={POR_PAGINA}
	onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
/>
```

Si el «Volver» de un detalle tiene que regresar a esta URL exacta, añade
`afterNavigate(({ to }) => memoria.recordar(to.url.pathname + to.url.search))`
con una memoria de `memoriaListado()` (ver más abajo).

## Trampas al restaurar la página desde la URL

Las cinco aparecieron durante la migración de las páginas al núcleo. El
typecheck y las pruebas unitarias no ven ninguna: solo se notan abriendo un
enlace o recargando, y este repo no tiene e2e que lo haga por ti (ver
«Pruebas»).

1. **Leer el estado inicial con `leerInicial()`.** Lee `window.location`.
   `leer(page.url)` en la inicialización del componente no es de fiar: durante
   la hidratación `page` puede traer todavía la URL anterior —pasó al volver de
   un detalle con «Volver»—, los filtros nacen vacíos y el efecto que escribe
   los borra de la barra antes de que nadie los lea. En el servidor
   `leerInicial()` devuelve los defectos y la hidratación pone lo que toca.
   Diez páginas leen ya de `window.location` (ocho con `leerInicial()`;
   recargos y servicios, a mano); quince siguen arrancando el `$state` con
   `leer(page.url)` y son las primeras sospechosas si un enlace filtrado se
   abre sin filtros.
2. **Leer la URL una sola vez.** Un `$effect` que reacciona a cada cambio de
   `page.url` vuelve a leer la URL que la propia página acaba de escribir y
   puede pisar lo que el usuario tocó. En `servicios`, además, el efecto que
   escribía corría antes que el que leía, y abrir `?q=algo` lo borraba antes de
   usarlo.
3. **El recorte de rango espera a los datos.** Un `?pagina=3` se recorta a 1 si
   el efecto «si la página quedó fuera de rango, ve a la última» corre con la
   lista vacía: `totalPages` vale 1 antes del primer dato. Guárdalo con
   `if (loading || datos.length === 0) return` (ver
   [recargos](../src/routes/dashboard/recargos/+page.svelte)).
4. **Las claves de «volver a la página 1» arrancan con los valores iniciales.**
   Si nacen vacías, la primera pasada las ve «cambiadas» y borra la página que
   venía en la URL. Se toman con `untrack` porque son una foto del arranque, no
   una dependencia.
5. **El efecto depende de la firma, no del objeto.** Un `$state` es un proxy:
   `void filtros` no suscribe a sus propiedades. Con un `bind:valor={filtros.q}`
   la lista se filtraba y la URL se quedaba congelada. `firma(DEFS, filtros)`
   lee cada campo. Las otras dos trampas de runes que aparecen en listados
   —los `Set` y `Map` no se proxifican (crea uno nuevo para la selección) y una
   anotación de tipo sobre la variable estrecha a `never`
   (`$state<T | null>(null)`)— están en [estado-y-stores.md](./estado-y-stores.md).

## Buscar en cliente: `coincide()`

```ts
import { coincide } from '$lib/listing/texto';

const visibles = $derived(
	vehiculos.filter((v) => coincide(filtros.q, [v.placa, v.marca, v.propietario?.nombre]))
);
```

Parte el término en palabras y exige **todas**, en cualquier campo y en
cualquier orden, sin mirar tildes ni mayúsculas (`normalizarTexto` descompone
con NFD y quita las marcas diacríticas). «juan yopal» encuentra al conductor
Juan con sede en Yopal; un `includes` literal no. Existía duplicado en
servicios y en el store de acciones correctivas con implementaciones que no
coincidían, y la misma búsqueda daba resultados distintos según la página.

Cuando el servidor pagina, la búsqueda va al servidor; `coincide()` es para lo
que ya está en memoria (flota, cartera, usuarios, recargos y las respuestas de
asistencias lo usan). Los selectores (`Autocomplete`, `SelectBuscable`) tienen
su propio filtro sin quitar tildes.

## Caché de listas: `crearListingStore`

Para las listas que se revisitan mucho y que el socket ensucia (conductores,
flota, clientes, terceros):

```
entrar          → ¿fresco y limpio? pintar de caché, cero peticiones
                  ¿viejo o sucio?   pintar la caché y revalidar de fondo
evento de socket→ ensuciar (y contar si la lista no está a la vista)
cambiar filtro  → la firma cambia y la caché deja de aplicar
```

`cargar(firma, traer, clave?)` no lanza dos veces la misma petición (deduplica
por clave y firma) y, si falla, deja los datos anteriores junto al error: vaciar
una tabla ya pintada por un corte de red es peor. También ofrece `puedePintar`,
`necesitaFetch`, `ensuciar(clave, visible)`, `parchear(fn)` (reemplazar una fila
ante un `*:actualizado` sin pedir la lista), `ver`, `invalidar` y `reiniciar`.
TTL por defecto: 60 s. Es un `writable` clásico y no runes para que funcione
también en páginas en modo legacy.

La firma de la caché no tiene por qué ser la de la URL. En
[flota](../src/routes/dashboard/flota/+page.svelte) es
`firma(DEFS, { ...filtros, q: '', estado: 'todos' })`: búsqueda y estado se
resuelven en cliente, así que teclear no dispara ninguna petición.

## «Volver» al listado con sus filtros

`memoriaListado(base, opciones)` de
[stores/volverListado.ts](../src/lib/stores/volverListado.ts) guarda en
`sessionStorage` la última URL del listado: el listado llama a `recordar()`
desde `afterNavigate` (cada cambio de filtro pasa por `goto`, así que queda
anotado) y el detalle navega a `url()`. Solo acepta URLs del propio listado;
`clave` separa dos memorias sobre la misma ruta, `acepta` filtra cuáles se
guardan y `descartar` quita parámetros de un solo uso como `?nuevo=1`, que el
listado borra con `replaceState` y sin eso reabrirían el formulario en cada
«Volver». Liquidaciones de servicios tiene la suya en
[stores/volverLiquidaciones.ts](../src/lib/stores/volverLiquidaciones.ts).

El otro extremo del enlace compartido es el guardia de sesión:
[hooks.server.ts](../src/hooks.server.ts) redirige a
`/login?redirect=<pathname + search>`. Con solo el `pathname`, quien abría un
enlace filtrado sin sesión aterrizaba en la lista completa. Ver
[autenticacion-y-permisos.md](./autenticacion-y-permisos.md).

## Pruebas

- **Unitarias (Vitest):** [tests/listing-filtros.test.ts](../tests/listing-filtros.test.ts)
  (ida y vuelta URL ↔ estado, firma, limpieza),
  [tests/listing-store.test.ts](../tests/listing-store.test.ts) y
  [tests/listing-texto.test.ts](../tests/listing-texto.test.ts).
- **E2E:** este repo no tiene Playwright. El gemelo (`ingreso-svelte`) tiene
  `e2e/listados-url.spec.ts`, que abre cada ruta con parámetros y comprueba que
  siguen en la URL tras hidratar y tras recargar, y que un enlace filtrado
  conserva su consulta al pasar por el login. Como `src/lib/listing/` y las
  páginas son las mismas, sirve de referencia; aquí, después de tocar un
  listado, haz esa comprobación a mano: abre la ruta con filtros (valores
  distintos del defecto, que no se escriben), recarga y mira la barra.
  Ver [pruebas-y-calidad.md](./pruebas-y-calidad.md).

## Diferencias con Transmeralda

`src/lib/listing/` es idéntico en los dos repos y las mismas 26 páginas usan
`crearEstadoUrl`, con los mismos patrones de arranque. La única diferencia
relevante es la de las pruebas: Transmeralda tiene el e2e de listados y este
repo no.
