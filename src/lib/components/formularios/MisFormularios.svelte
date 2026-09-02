<!--
	«Mis formularios»: lo que a MÍ me toca diligenciar, para un usuario del
	dashboard.

	Se monta desde dos sitios y por eso es un componente y no una página:

	  - `/dashboard/mis-formularios`, ruta propia con permiso `general: true`,
	    que es la que alcanza a las áreas sin acceso al constructor. Es la que de
	    verdad habilita la función.
	  - la pestaña «Mis formularios» de `/dashboard/formularios`, para quien
	    gestiona el módulo y no quiere cambiar de pantalla.

	No es el portal del conductor reescrito: aquí NO hay IndexedDB, ni outbox, ni
	socket. Un usuario de oficina está en línea, y arrastrar 1.700 líneas de
	sincronización offline a una pantalla de escritorio añadiría una fuente de
	fallos —dos identidades compartiendo la misma base local del navegador— para
	resolver un problema que aquí no existe.

	── Buscar y filtrar: por qué en cliente ────────────────────────────────────

	`GET /api/mis-formularios` no pagina ni acepta filtros; devuelve todas las
	asignaciones que alcanzan al usuario. Con los datos ya en memoria, pedirle al
	servidor que filtre sería una petición por pulsación para reordenar un array
	que ya tenemos. El trabajo se reparte así:

	  - `mis-formularios-cache.ts` guarda la respuesta (stale-while-revalidate),
	    para que el ir y venir al runner no repita la consulta.
	  - `mis-formularios-filtros.ts` construye el índice normalizado una vez por
	    lista y memoriza los resultados por criterio.
	  - aquí solo queda el estado de la pantalla y su reflejo en la URL.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { MisFormulariosError } from '$lib/api/mis-formularios';
	import type { PortalAssignmentCard, PortalListMeta } from '$lib/api/formularios-portal';
	import { cargarLista, listaCacheada } from '$lib/formularios/mis-formularios-cache';
	import {
		CRITERIOS_POR_DEFECTO,
		ESTADOS_FILTRO,
		ESTADO_LABELS,
		MotorBusqueda,
		ORDENES,
		ORDEN_LABELS,
		etiquetaFrecuencia,
		type EstadoFiltro,
		type Orden
	} from '$lib/formularios/mis-formularios-filtros';

	interface Props {
		/** Base de las rutas del runner. La pestaña y la ruta propia comparten una. */
		base?: string;
		/**
		 * Escribir los filtros en la query string.
		 *
		 * Apagado por defecto **a propósito**. `/dashboard/formularios` ya es dueña
		 * de su URL (`?vista=`, `?estado=`, `?q=`…) y reescribe la query entera al
		 * cambiar de pestaña: si la pestaña incrustada también escribiera, cada una
		 * borraría los parámetros de la otra. Lo enciende la ruta propia, que no
		 * comparte la URL con nadie.
		 */
		sincronizarUrl?: boolean;
	}

	let { base = '/dashboard/mis-formularios', sincronizarUrl = false }: Props = $props();

	// ── Datos ──────────────────────────────────────────────────────────────────

	/// Arranca de la caché si la hay: volver del runner pinta la lista en el
	/// primer frame en vez de enseñar «Cargando…» otra vez.
	const inicial = listaCacheada();

	let asignaciones = $state<PortalAssignmentCard[]>(inicial?.data ?? []);
	let meta = $state<PortalListMeta | null>(inicial?.meta ?? null);
	let cargando = $state(inicial === null);
	/// Revalidando con datos ya pintados. Es un estado distinto de `cargando`:
	/// bloquear la pantalla por un refresco que quizá no cambie nada sería peor
	/// que enseñar lo de hace diez segundos.
	let revalidando = $state(false);
	let error = $state<string | null>(null);

	/// Testigo de vida. La petición se comparte entre quien la pidió y quien
	/// llegue mientras vuela, así que no se puede abortar sin romperle la carga
	/// al otro; lo que sí se puede es no aplicar una respuesta tardía.
	let vivo = true;

	async function cargar({ forzar = false } = {}) {
		if (forzar || asignaciones.length) revalidando = true;
		try {
			const lista = await cargarLista({ forzar });
			if (!vivo) return;
			asignaciones = lista.data;
			meta = lista.meta;
			error = null;
		} catch (err) {
			if (!vivo) return;
			/// Si ya hay tarjetas en pantalla, un refresco fallido no las borra: se
			/// avisa arriba y se sigue trabajando con lo que había.
			error =
				err instanceof MisFormulariosError ? err.message : 'No se pudieron cargar tus formularios.';
		} finally {
			if (vivo) {
				cargando = false;
				revalidando = false;
			}
		}
	}

	onMount(() => {
		void cargar();

		/**
		 * Refresco al volver a la pestaña.
		 *
		 * Sustituye al socket del portal, cuyo gateway solo admite rooms de
		 * conductor. Cubre el caso real —HSEQ asigna algo mientras la pantalla
		 * está abierta en otra pestaña— sin abrir una segunda conexión ni
		 * sondear en bucle.
		 */
		function alVolver() {
			if (document.visibilityState === 'visible') void cargar({ forzar: true });
		}
		document.addEventListener('visibilitychange', alVolver);
		return () => {
			vivo = false;
			if (temporizadorBusqueda) clearTimeout(temporizadorBusqueda);
			document.removeEventListener('visibilitychange', alVolver);
		};
	});

	// ── Criterios ──────────────────────────────────────────────────────────────

	/**
	 * La query string, leída UNA vez al montar.
	 *
	 * `untrack` porque es una semilla, no una fuente: a partir de aquí manda el
	 * estado del componente, y volver a leer la URL cada vez que `reflejarUrl`
	 * la reescribe sería un bucle.
	 *
	 * Y solo si `sincronizarUrl`. Incrustado en `/dashboard/formularios` la
	 * query es de la página anfitriona, donde `?q=` es la búsqueda del catálogo:
	 * adoptarla aquí filtraría las tarjetas por lo que se escribió en otro
	 * buscador.
	 */
	const paramsIniciales = untrack(() =>
		sincronizarUrl ? $page.url.searchParams : new URLSearchParams()
	);

	function estadoValido(v: string | null): EstadoFiltro {
		return ESTADOS_FILTRO.includes(v as EstadoFiltro)
			? (v as EstadoFiltro)
			: CRITERIOS_POR_DEFECTO.estado;
	}

	function ordenValido(v: string | null): Orden {
		return ORDENES.includes(v as Orden) ? (v as Orden) : CRITERIOS_POR_DEFECTO.orden;
	}

	/// Lo que se teclea, sin filtrar todavía.
	let entrada = $state(paramsIniciales.get('q') ?? '');
	/// Lo que de verdad filtra, tras el rebote. Separar los dos es lo que evita
	/// recalcular y reescribir la URL trece veces al escribir «preoperacional».
	let q = $state(paramsIniciales.get('q') ?? '');
	let estado = $state<EstadoFiltro>(estadoValido(paramsIniciales.get('estado')));
	let frecuencia = $state(paramsIniciales.get('frecuencia') ?? '');
	let orden = $state<Orden>(ordenValido(paramsIniciales.get('orden')));

	let temporizadorBusqueda: ReturnType<typeof setTimeout> | null = null;

	/// 200 ms: por debajo del umbral en que se nota el retardo al teclear, y por
	/// encima de la cadencia de pulsación de quien escribe rápido.
	const REBOTE_MS = 200;

	function alTeclear(valor: string) {
		entrada = valor;
		if (temporizadorBusqueda) clearTimeout(temporizadorBusqueda);
		temporizadorBusqueda = setTimeout(() => {
			q = valor;
			tope = TANDA;
			reflejarUrl();
		}, REBOTE_MS);
	}

	function cambiarFiltro(fn: () => void) {
		fn();
		/// Cambiar de criterio devuelve el revelado al principio: seguir en la
		/// cuarta tanda tras una búsqueda nueva enseñaría el final de una lista
		/// que ya no es la que se estaba mirando.
		tope = TANDA;
		reflejarUrl();
	}

	function limpiarFiltros() {
		if (temporizadorBusqueda) clearTimeout(temporizadorBusqueda);
		entrada = CRITERIOS_POR_DEFECTO.q;
		cambiarFiltro(() => {
			q = CRITERIOS_POR_DEFECTO.q;
			estado = CRITERIOS_POR_DEFECTO.estado;
			frecuencia = CRITERIOS_POR_DEFECTO.frecuencia;
			orden = CRITERIOS_POR_DEFECTO.orden;
		});
	}

	const hayFiltros = $derived(
		Boolean(q || estado !== 'todos' || frecuencia || orden !== CRITERIOS_POR_DEFECTO.orden)
	);

	/**
	 * Refleja los criterios en la query string.
	 *
	 * Parte de los parámetros que ya hay en vez de construir una URL limpia: así
	 * un `?draft=` o cualquier parámetro que añada la ruta más adelante sobrevive
	 * a un cambio de filtro.
	 *
	 * `replaceState` porque teclear en un buscador no es navegar: apilar una
	 * entrada de historial por pulsación convertiría el «atrás» del navegador en
	 * un deshacer de filtros, y saldría de la pantalla trece pulsaciones después.
	 */
	function reflejarUrl() {
		if (!sincronizarUrl) return;
		const params = new URLSearchParams($page.url.searchParams);
		const poner = (clave: string, valor: string, porDefecto: string) => {
			if (valor && valor !== porDefecto) params.set(clave, valor);
			else params.delete(clave);
		};
		poner('q', q.trim(), CRITERIOS_POR_DEFECTO.q);
		poner('estado', estado, CRITERIOS_POR_DEFECTO.estado);
		poner('frecuencia', frecuencia, '');
		poner('orden', orden, CRITERIOS_POR_DEFECTO.orden);

		const query = params.toString();
		void goto(query ? `?${query}` : $page.url.pathname, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	// ── Filtrado ───────────────────────────────────────────────────────────────

	/// Un motor por lista. Al recargar los datos se construye uno nuevo —con su
	/// índice y su memo— y el viejo se recoge entero: el memo no puede quedarse
	/// describiendo tarjetas que ya no existen.
	const motor = $derived(new MotorBusqueda(asignaciones));
	const resultados = $derived(motor.filtrar({ q, estado, frecuencia, orden }));

	/**
	 * Revelado por tandas.
	 *
	 * Con una asignación por área y turno, un supervisor de flota pasa de las
	 * cien tarjetas. Pintarlas todas de golpe cuesta un `layout` de cien nodos en
	 * el hilo principal justo cuando la pantalla tiene que responder a la
	 * siguiente tecla. Se pintan 24 —lo que cabe en pantalla y algo más— y el
	 * resto bajo demanda.
	 */
	const TANDA = 24;
	let tope = $state(TANDA);

	const visibles = $derived(resultados.slice(0, tope));
	const restantes = $derived(resultados.length - visibles.length);

	/// `AVAILABLE` arriba: es lo accionable. El resto son tarjetas de consulta.
	const disponibles = $derived(visibles.filter((a) => a.dueState === 'AVAILABLE'));
	const completados = $derived(visibles.filter((a) => a.dueState !== 'AVAILABLE'));

	function haceCuanto(iso: string): string {
		const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
		if (minutos < 1) return 'hace un momento';
		if (minutos < 60) return `hace ${minutos} min`;
		const horas = Math.round(minutos / 60);
		if (horas < 24) return `hace ${horas} h`;
		return `hace ${Math.round(horas / 24)} d`;
	}
</script>

<section class="mis">
	{#if cargando}
		<p class="estado">Cargando tus formularios…</p>
	{:else if error && asignaciones.length === 0}
		<p class="estado estado--error">{error}</p>
		<button type="button" class="btn" onclick={() => void cargar({ forzar: true })}>
			Reintentar
		</button>
	{:else if asignaciones.length === 0}
		<!--
			Mensaje explícito sobre el porqué: la causa casi siempre es que la
			asignación no incluye su área, no que el módulo esté vacío. Decir solo
			«no hay nada» mandaría a la persona a preguntar por soporte.
		-->
		<p class="estado">
			No tienes formularios asignados. Aparecen aquí cuando alguien de HSEQ o
			administración crea una asignación que alcanza a tu área, tu cargo o a ti.
		</p>
	{:else}
		{#if error}
			<!-- Falló un refresco, pero las tarjetas de antes siguen siendo útiles. -->
			<p class="aviso" role="status">{error} Se muestra lo último que se pudo cargar.</p>
		{/if}

		<div class="controles">
			<div class="buscador">
				<label class="sr-only" for="mis-buscar">Buscar entre tus formularios</label>
				<input
					id="mis-buscar"
					class="campo"
					type="search"
					autocomplete="off"
					placeholder="Buscar por código, nombre, frecuencia o placa…"
					value={entrada}
					oninput={(e) => alTeclear(e.currentTarget.value)}
				/>
			</div>

			<div class="chips" role="group" aria-label="Filtrar por estado">
				{#each ESTADOS_FILTRO as e (e)}
					<button
						type="button"
						class="chip"
						class:chip--activo={estado === e}
						aria-pressed={estado === e}
						onclick={() => cambiarFiltro(() => (estado = e))}
					>
						{ESTADO_LABELS[e]}
					</button>
				{/each}
			</div>

			<!-- Solo las frecuencias que existen en los datos: un selector con seis
			     opciones de las que cinco no filtran nada es ruido. -->
			{#if motor.frecuencias.length > 1}
				<label class="sr-only" for="mis-frecuencia">Frecuencia</label>
				<select
					id="mis-frecuencia"
					class="campo campo--select"
					value={frecuencia}
					onchange={(e) => cambiarFiltro(() => (frecuencia = e.currentTarget.value))}
				>
					<option value="">Toda frecuencia</option>
					{#each motor.frecuencias as f (f)}
						<option value={f}>{etiquetaFrecuencia(f)}</option>
					{/each}
				</select>
			{/if}

			<label class="sr-only" for="mis-orden">Ordenar por</label>
			<select
				id="mis-orden"
				class="campo campo--select"
				value={orden}
				onchange={(e) => cambiarFiltro(() => (orden = e.currentTarget.value as Orden))}
			>
				{#each ORDENES as o (o)}
					<option value={o}>{ORDEN_LABELS[o]}</option>
				{/each}
			</select>

			{#if hayFiltros}
				<button type="button" class="btn" onclick={limpiarFiltros}>Limpiar</button>
			{/if}

			<button
				type="button"
				class="btn btn--icono"
				onclick={() => void cargar({ forzar: true })}
				disabled={revalidando}
				title="Volver a consultar al servidor"
			>
				{revalidando ? 'Actualizando…' : 'Actualizar'}
			</button>
		</div>

		<p class="resumen" aria-live="polite">
			{#if hayFiltros}
				{resultados.length} de {asignaciones.length}
				{asignaciones.length === 1 ? 'formulario' : 'formularios'}
			{:else if meta}
				{meta.pending} por diligenciar · {meta.drafts} en borrador · al {meta.today}
			{:else}
				{asignaciones.length} {asignaciones.length === 1 ? 'formulario' : 'formularios'}
			{/if}
		</p>

		{#if resultados.length === 0}
			<p class="estado">
				Ningún formulario coincide con la búsqueda.
				<button type="button" class="enlace" onclick={limpiarFiltros}>Quitar los filtros</button>
			</p>
		{/if}

		{#if disponibles.length}
			<ul class="tarjetas">
				{#each disponibles as a (a.assignmentId)}
					<li class="tarjeta">
						<div class="tarjeta__cabeza">
							<span class="tarjeta__code">{a.code}</span>
							<span class="tarjeta__titulo">{a.title}</span>
							<span class="tarjeta__meta">
								{etiquetaFrecuencia(a.frequency)}
								{#if a.requiresContext.length}· pide {a.requiresContext.join(', ')}{/if}
							</span>
						</div>

						<!--
							Un botón POR borrador, igual que en el portal: con
							`ONE_PER_CONTEXT` es normal llevar varios abiertos a la vez, y
							ofrecer solo el último dejaba el resto inalcanzable.
						-->
						{#if a.drafts.length}
							<ul class="borradores">
								{#each a.drafts as d (d.clientSubmissionId)}
									<li>
										<a class="borrador" href="{base}/{a.assignmentId}?draft={d.clientSubmissionId}">
											Continuar borrador · {d.progress}% · {haceCuanto(d.updatedAt)}
										</a>
									</li>
								{/each}
							</ul>
						{/if}

						<a class="tarjeta__accion" href="{base}/{a.assignmentId}?nuevo=1">
							{a.drafts.length ? 'Empezar otro' : 'Diligenciar'}
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		{#if completados.length}
			<h3 class="subtitulo">Ya completados en este período</h3>
			<ul class="tarjetas">
				{#each completados as a (a.assignmentId)}
					<li class="tarjeta tarjeta--hecha">
						<span class="tarjeta__code">{a.code}</span>
						<span class="tarjeta__titulo">{a.title}</span>
						<span class="tarjeta__meta">{etiquetaFrecuencia(a.frequency)}</span>
						<span class="tarjeta__badge">✓ {a.submittedThisPeriod}</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if restantes > 0}
			<button type="button" class="btn btn--mas" onclick={() => (tope += TANDA)}>
				Mostrar {Math.min(restantes, TANDA)} más ({restantes} sin mostrar)
			</button>
		{/if}
	{/if}
</section>

<style>
	.mis {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.estado {
		margin: 0;
		padding: 1.5rem 0;
		/* Texto corrido: pasado este ancho el ojo pierde el renglón. */
		max-width: 46rem;
		color: var(--text-muted, #64748b);
	}

	.estado--error {
		color: var(--red-600, #dc2626);
	}

	.aviso {
		margin: 0;
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
		color: var(--amber-800, #92400e);
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 8px;
	}

	/* Barra de controles: fluye y se reparte el ancho que le dé el layout, sin
	   puntos de ruptura que haya que mantener a mano. */
	.controles {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.buscador {
		/* Crece con el ancho disponible, pero acotado como control: un buscador de
		   1.600 px es un renglón vacío, no más información. */
		flex: 1 1 16rem;
		max-width: 32rem;
	}

	.campo {
		width: 100%;
		min-height: 36px;
		padding: 0 0.75rem;
		font: inherit;
		font-size: 0.85rem;
		color: inherit;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 8px;
	}

	.campo--select {
		width: auto;
		/* Medida del propio control: sin tope, el `select` se estira al texto de
		   la opción más larga y desplaza a los demás controles. */
		max-width: 14rem;
		cursor: pointer;
	}

	.campo:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 1px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.chip {
		min-height: 36px;
		padding: 0 0.75rem;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-muted, #64748b);
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 999px;
		cursor: pointer;
	}

	.chip--activo {
		color: var(--emerald-700, #047857);
		background: #f0fdf4;
		border-color: #bbf7d0;
	}

	.resumen {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-muted, #64748b);
	}

	.subtitulo {
		margin: 0.75rem 0 0;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted, #64748b);
	}

	.tarjetas {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tarjeta {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 12px;
		/* El navegador se salta el layout y el pintado de las tarjetas que quedan
		   fuera de la ventana. `contain-intrinsic-size` le da la altura estimada
		   para que la barra de scroll no salte al llegar a ellas. */
		content-visibility: auto;
		contain-intrinsic-size: auto 9rem;
	}

	.tarjeta--hecha {
		opacity: 0.75;
	}

	.tarjeta__cabeza {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.tarjeta__code {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--emerald-700, #047857);
	}

	.tarjeta__titulo {
		font-weight: 600;
		line-height: 1.3;
	}

	.tarjeta__meta {
		font-size: 0.75rem;
		color: var(--text-muted, #64748b);
	}

	.borradores {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.borrador,
	.tarjeta__accion {
		display: block;
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
		font-weight: 500;
		text-align: center;
		text-decoration: none;
		border-radius: 8px;
	}

	.borrador {
		color: var(--amber-800, #92400e);
		background: #fffbeb;
		border: 1px solid #fde68a;
	}

	.tarjeta__accion {
		margin-top: auto;
		color: #fff;
		background: var(--emerald-600, #059669);
	}

	.tarjeta__badge {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
	}

	.btn {
		align-self: flex-start;
		min-height: 36px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.8rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border, #e2e8f0);
		border-radius: 8px;
		cursor: pointer;
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.btn--icono {
		margin-left: auto;
		color: var(--text-muted, #64748b);
	}

	.btn--mas {
		align-self: center;
	}

	.enlace {
		padding: 0;
		font: inherit;
		color: var(--emerald-700, #047857);
		background: none;
		border: 0;
		text-decoration: underline;
		cursor: pointer;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
