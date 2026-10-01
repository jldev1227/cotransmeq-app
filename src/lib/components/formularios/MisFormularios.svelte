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
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth';
	import { mascota } from '$lib/mascot';
	import { Search, ChevronRight, RefreshCw, Trash2 } from 'lucide-svelte';
	import { MisFormulariosError, misFormulariosAPI } from '$lib/api/mis-formularios';
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
		/**
		 * Pintar la cabecera de bienvenida (saludo, mascota y cifras) encima de la
		 * lista. La enciende la ruta propia; la pestaña de `/dashboard/formularios`
		 * ya tiene su propia cabecera y solo quiere la lista.
		 */
		conCabecera?: boolean;
	}

	let {
		base = '/dashboard/mis-formularios',
		sincronizarUrl = false,
		conCabecera = false
	}: Props = $props();

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

	/// Borrador cuyo descarte está en vuelo. Bloquea su botón para que un doble
	/// toque no mande dos peticiones.
	let descartando = $state<string | null>(null);

	/**
	 * Descarta un borrador propio.
	 *
	 * Este runner NO tiene almacenamiento local —a diferencia del portal, que
	 * lleva outbox e IndexedDB—, así que aquí basta con pedírselo al servidor y
	 * recargar la lista. El borrado es lógico: lo escrito no se destruye.
	 */
	async function descartar(clientSubmissionId: string, etiqueta: string) {
		if (!confirm(`¿Descartar el borrador de ${etiqueta}?`)) return;
		descartando = clientSubmissionId;
		try {
			await misFormulariosAPI.descartarBorrador(clientSubmissionId);
			/// `forzar`: la caché acaba de quedarse obsoleta y sin esto la tarjeta
			/// descartada seguiría en pantalla hasta que caducara sola.
			await cargar({ forzar: true });
			toast.success('Borrador descartado.');
		} catch (err) {
			toast.error(
				err instanceof MisFormulariosError ? err.message : 'No se pudo descartar el borrador.'
			);
		} finally {
			descartando = null;
		}
	}

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

	/** Primer nombre para el saludo, como en la app móvil. */
	const primerNombre = $derived(($authStore.user?.nombre ?? '').trim().split(/\s+/)[0] || '');

	/// Cifras de la cabecera. Las de `meta` las calcula el servidor sobre todo
	/// lo asignado; si aún no llegaron se cuenta sobre lo cargado.
	const cifras = $derived({
		pendientes: meta?.pending ?? asignaciones.filter((a) => a.dueState === 'AVAILABLE').length,
		borradores: meta?.drafts ?? asignaciones.reduce((n, a) => n + a.drafts.length, 0),
		completados: asignaciones.filter((a) => a.dueState === 'DONE').length
	});

	/** Las dos últimas cifras del código, como la insignia de la app. */
	function insignia(code: string): string {
		const m = code.match(/(\d{1,2})\s*$/);
		return m ? m[1].padStart(2, '0') : code.slice(-2).toUpperCase();
	}

	const ESTADO_TARJETA: Record<PortalAssignmentCard['dueState'], { texto: string; color: string }> =
		{
			AVAILABLE: { texto: 'Disponible', color: '#16a34a' },
			DONE: { texto: 'Completado', color: '#16a34a' },
			NOT_YET: { texto: 'Aún no', color: '#94a3b8' },
			EXPIRED: { texto: 'Vencido', color: '#b42318' },
			PAUSED: { texto: 'Pausado', color: '#f59e0b' }
		};

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
	{#if conCabecera}
		{@const saludo = mascota('procesando')}
		<!-- Cabecera de la app móvil: bloque oscuro con el saludo y la mascota,
		     y debajo las tres cifras del día. -->
		<header class="mis-hero">
			<div class="mis-hero-glow" aria-hidden="true"></div>
			<div class="mis-hero-texto">
				<span class="mis-hero-eyebrow">Centro de operaciones</span>
				<h1 class="mis-hero-titulo">Hola{primerNombre ? `, ${primerNombre}` : ''}</h1>
				<p class="mis-hero-sub">Tus formatos, borradores y tareas de hoy en un solo lugar.</p>
			</div>
			<img class="mis-hero-mascota" src={saludo.src} alt={saludo.alt} width="418" height="418" />
		</header>

		<div class="mis-cifras">
			<div class="mis-cifra">
				<span class="mis-cifra-valor">{cifras.pendientes}</span>
				<span class="mis-cifra-label">Por diligenciar</span>
			</div>
			<div class="mis-cifra">
				<span class="mis-cifra-valor">{cifras.borradores}</span>
				<span class="mis-cifra-label">En borrador</span>
			</div>
			<div class="mis-cifra">
				<span class="mis-cifra-valor">{cifras.completados}</span>
				<span class="mis-cifra-label">Completados</span>
			</div>
		</div>
	{/if}

	{#if cargando}
		<div class="mis-estado">
			<span class="spinner" aria-hidden="true"></span>
			<p>Cargando tus formularios…</p>
		</div>
	{:else if error && asignaciones.length === 0}
		{@const img = mascota('advertencia')}
		<div class="mis-estado">
			<img src={img.src} alt={img.alt} width="418" height="418" />
			<p class="mis-estado-error">{error}</p>
			<button type="button" class="btn-secondary" onclick={() => void cargar({ forzar: true })}>
				Reintentar
			</button>
		</div>
	{:else if asignaciones.length === 0}
		{@const img = mascota('vacio')}
		<!--
			Mensaje explícito sobre el porqué: la causa casi siempre es que la
			asignación no incluye su área, no que el módulo esté vacío. Decir solo
			«no hay nada» mandaría a la persona a preguntar por soporte.
		-->
		<div class="mis-estado">
			<img src={img.src} alt={img.alt} width="418" height="418" />
			<h3>No tienes formularios asignados</h3>
			<p>
				Aparecen aquí cuando alguien de HSEQ o administración crea una asignación que alcanza a tu
				área, tu cargo o a ti.
			</p>
		</div>
	{:else}
		{#if error}
			<!-- Falló un refresco, pero las tarjetas de antes siguen siendo útiles. -->
			<p class="mis-aviso" role="status">{error} Se muestra lo último que se pudo cargar.</p>
		{/if}

		<!-- ── Buscador y filtros ── -->
		<div class="mis-controles">
			<label class="mis-buscador">
				<Search size={18} strokeWidth={1.8} aria-hidden="true" />
				<span class="sr-only">Buscar entre tus formularios</span>
				<input
					type="search"
					autocomplete="off"
					placeholder="Buscar formato o código"
					value={entrada}
					oninput={(e) => alTeclear(e.currentTarget.value)}
				/>
			</label>

			<div class="mis-segmentos" role="group" aria-label="Filtrar por estado">
				{#each ESTADOS_FILTRO as e (e)}
					<button
						type="button"
						class="mis-segmento"
						class:mis-segmento--activo={estado === e}
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
					class="mis-select"
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
				class="mis-select"
				value={orden}
				onchange={(e) => cambiarFiltro(() => (orden = e.currentTarget.value as Orden))}
			>
				{#each ORDENES as o (o)}
					<option value={o}>{ORDEN_LABELS[o]}</option>
				{/each}
			</select>

			{#if hayFiltros}
				<button type="button" class="btn-secondary" onclick={limpiarFiltros}>Limpiar</button>
			{/if}

			<button
				type="button"
				class="btn-icon mis-actualizar"
				class:mis-actualizar--girando={revalidando}
				onclick={() => void cargar({ forzar: true })}
				disabled={revalidando}
				title={revalidando ? 'Actualizando…' : 'Volver a consultar al servidor'}
				aria-label="Actualizar"
			>
				<RefreshCw size={16} strokeWidth={1.8} />
			</button>
		</div>

		<!-- ── Formatos asignados ── -->
		<div class="mis-seccion">
			<h2 class="mis-seccion-titulo">Formatos asignados</h2>
			<span class="mis-seccion-detalle" aria-live="polite">
				{#if hayFiltros}
					{resultados.length} de {asignaciones.length}
				{:else}
					{asignaciones.length} {asignaciones.length === 1 ? 'resultado' : 'resultados'}
				{/if}
			</span>
		</div>

		{#if resultados.length === 0}
			{@const img = mascota('vacio')}
			<div class="mis-estado">
				<img src={img.src} alt={img.alt} width="418" height="418" />
				<p>Ningún formulario coincide con la búsqueda.</p>
				<button type="button" class="btn-secondary" onclick={limpiarFiltros}
					>Quitar los filtros</button
				>
			</div>
		{/if}

		{#if disponibles.length}
			<ul class="mis-lista">
				{#each disponibles as a (a.assignmentId)}
					{@const est = ESTADO_TARJETA[a.dueState]}
					<li class="mis-tarjeta">
						<a class="mis-tarjeta-cabeza" href="{base}/{a.assignmentId}?nuevo=1">
							<span class="mis-insignia">{insignia(a.code)}</span>
							<span class="mis-tarjeta-texto">
								<span class="mis-tarjeta-titulo">{a.title}</span>
								<span class="mis-tarjeta-meta">
									{a.code} · {etiquetaFrecuencia(a.frequency)}
									{#if a.requiresContext.length}· pide {a.requiresContext.join(', ')}{/if}
								</span>
							</span>
							<ChevronRight class="mis-chevron" size={20} strokeWidth={1.8} aria-hidden="true" />
						</a>

						<div class="mis-tarjeta-pie">
							<span class="mis-pill" style="--c:{est.color}">{est.texto}</span>
							<span class="mis-tarjeta-estado">
								{#if a.drafts.length}
									{a.drafts.length} {a.drafts.length === 1 ? 'borrador' : 'borradores'}
								{:else}
									Listo para iniciar
								{/if}
							</span>
						</div>

						<!--
							Un botón POR borrador, igual que en el portal: con
							`ONE_PER_CONTEXT` es normal llevar varios abiertos a la vez, y
							ofrecer solo el último dejaba el resto inalcanzable.
						-->
						{#if a.drafts.length}
							<ul class="mis-borradores">
								{#each a.drafts as d (d.clientSubmissionId)}
									<li class="mis-borrador">
										<a
											class="mis-borrador-enlace"
											href="{base}/{a.assignmentId}?draft={d.clientSubmissionId}"
										>
											<span class="mis-borrador-barra" aria-hidden="true">
												<span style="width:{d.progress}%"></span>
											</span>
											<span class="mis-borrador-texto">
												Continuar · {d.progress}% · {haceCuanto(d.updatedAt)}
											</span>
										</a>
										<!-- Abrir el formulario ya crea el borrador, así que entrar a
										     mirar y salirse dejaba una tarjeta a medias sin forma de
										     quitarla. Discreto: descartar es la acción rara. -->
										<button
											type="button"
											class="mis-borrador-descartar"
											disabled={descartando === d.clientSubmissionId}
											title="Descartar borrador"
											aria-label="Descartar borrador"
											onclick={() => descartar(d.clientSubmissionId, a.title)}
										>
											<Trash2 size={15} strokeWidth={1.8} />
										</button>
									</li>
								{/each}
							</ul>
							<a
								class="mis-tarjeta-accion mis-tarjeta-accion--otro"
								href="{base}/{a.assignmentId}?nuevo=1"
							>
								Empezar otro
							</a>
						{:else}
							<a class="mis-tarjeta-accion" href="{base}/{a.assignmentId}?nuevo=1">Diligenciar</a>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if completados.length}
			<div class="mis-seccion mis-seccion--sub">
				<h2 class="mis-seccion-titulo">Ya completados en este período</h2>
				<span class="mis-seccion-detalle">{completados.length}</span>
			</div>
			<ul class="mis-lista">
				{#each completados as a (a.assignmentId)}
					{@const est = ESTADO_TARJETA[a.dueState]}
					<li class="mis-tarjeta mis-tarjeta--hecha">
						<div class="mis-tarjeta-cabeza">
							<span class="mis-insignia mis-insignia--hecha">{insignia(a.code)}</span>
							<span class="mis-tarjeta-texto">
								<span class="mis-tarjeta-titulo">{a.title}</span>
								<span class="mis-tarjeta-meta">{a.code} · {etiquetaFrecuencia(a.frequency)}</span>
							</span>
						</div>
						<div class="mis-tarjeta-pie">
							<span class="mis-pill" style="--c:{est.color}">{est.texto}</span>
							<span class="mis-tarjeta-estado">
								{#if a.submittedThisPeriod}✓ {a.submittedThisPeriod}
									{a.submittedThisPeriod === 1 ? 'envío' : 'envíos'}{/if}
							</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if restantes > 0}
			<button type="button" class="btn-secondary mis-mas" onclick={() => (tope += TANDA)}>
				Mostrar {Math.min(restantes, TANDA)} más ({restantes} sin mostrar)
			</button>
		{/if}
	{/if}
</section>

<style>
	.mis {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	/* ── Cabecera: el hero de la app ── */
	.mis-hero {
		position: relative;
		display: flex;
		align-items: flex-start;
		min-height: 200px;
		padding: 1.5rem 1.5rem 3rem;
		border-radius: 28px;
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 70%);
		color: #fff;
		overflow: hidden;
		isolation: isolate;
	}
	.mis-hero-glow {
		position: absolute;
		right: -14%;
		top: -35%;
		width: 60%;
		aspect-ratio: 1;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.06);
		z-index: -1;
	}
	.mis-hero-texto {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-width: 58%;
		z-index: 1;
	}
	@media (min-width: 768px) {
		.mis-hero-texto {
			max-width: 34rem;
		}
	}
	.mis-hero-eyebrow {
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--au-eyebrow);
	}
	.mis-hero-titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.7rem, 4vw, 2.3rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1.1;
		color: #fff;
	}
	.mis-hero-sub {
		margin: 0;
		font-size: 0.92rem;
		line-height: 1.5;
		color: var(--au-hero-text);
	}
	.mis-hero-mascota {
		position: absolute;
		right: -0.75rem;
		bottom: -0.5rem;
		width: 9.5rem;
		height: 9.5rem;
		object-fit: contain;
		pointer-events: none;
		filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.25));
	}
	@media (min-width: 768px) {
		.mis-hero-mascota {
			right: 1.5rem;
			bottom: -1rem;
			width: 14rem;
			height: 14rem;
		}
	}

	/* ── Cifras del día ── */
	.mis-cifras {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.6rem;
		margin-top: -2.4rem;
		padding: 0 0.75rem;
		z-index: 2;
	}
	.mis-cifra {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.85rem 0.5rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 18px;
		box-shadow: 0 12px 28px rgba(20, 83, 45, 0.1);
		text-align: center;
	}
	.mis-cifra-valor {
		font-size: 1.5rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--emerald-700);
		line-height: 1.1;
	}
	.mis-cifra:first-child .mis-cifra-valor {
		color: var(--emerald-800);
	}
	.mis-cifra-label {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--text-muted);
	}

	/* ── Estados ── */
	.mis-estado {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 1rem;
		text-align: center;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 22px;
	}
	.mis-estado img {
		width: 9rem;
		height: 9rem;
		object-fit: contain;
	}
	.mis-estado h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.mis-estado p {
		margin: 0;
		max-width: 30rem;
		font-size: 0.9rem;
		line-height: 1.55;
		color: var(--text-muted);
	}
	.mis-estado-error {
		color: var(--au-danger) !important;
		font-weight: 600;
	}
	.mis-aviso {
		margin: 0;
		padding: 0.6rem 0.85rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: #92400e;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 12px;
	}

	/* ── Controles ── */
	.mis-controles {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}
	.mis-buscador {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex: 1 1 16rem;
		max-width: 34rem;
		min-height: 48px;
		padding: 0 1rem;
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: 999px;
		color: var(--text-muted);
	}
	.mis-buscador:focus-within {
		border-color: var(--emerald-500);
		box-shadow: 0 0 0 4px rgba(var(--au-primary-rgb), 0.12);
	}
	.mis-buscador input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font: inherit;
		font-size: 0.95rem;
		color: var(--text-primary);
	}
	.mis-buscador input:focus {
		outline: none;
	}
	.mis-buscador input::placeholder {
		color: var(--text-very-muted);
	}
	.mis-segmentos {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.15rem;
		padding: 0.25rem;
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: 14px;
	}
	.mis-segmento {
		padding: 0.45rem 0.75rem;
		border: none;
		border-radius: 10px;
		background: transparent;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.mis-segmento:hover {
		color: var(--text-primary);
		background: var(--bg-base);
	}
	.mis-segmento--activo {
		background: var(--au-tint);
		color: var(--emerald-800);
		font-weight: 700;
	}
	.mis-select {
		min-height: 40px;
		max-width: 13rem;
		padding: 0 2rem 0 0.85rem;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-primary);
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
	}
	.mis-actualizar {
		margin-left: auto;
	}
	.mis-actualizar--girando :global(svg) {
		animation: girar 0.9s linear infinite;
	}
	@keyframes girar {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Secciones ── */
	.mis-seccion {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.35rem;
	}
	.mis-seccion--sub {
		margin-top: 0.75rem;
	}
	.mis-seccion-titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--text-primary);
	}
	.mis-seccion-detalle {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
	}

	/* ── Tarjetas: la lista de la app ── */
	.mis-lista {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	@media (min-width: 1024px) {
		.mis-lista {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (min-width: 1536px) {
		.mis-lista {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.mis-tarjeta {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 1rem 1.1rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 22px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
		content-visibility: auto;
		contain-intrinsic-size: auto 9rem;
	}
	.mis-tarjeta:hover {
		border-color: rgba(var(--au-primary-rgb), 0.35);
		box-shadow: 0 8px 28px rgba(var(--au-primary-rgb), 0.1);
	}
	.mis-tarjeta--hecha {
		opacity: 0.8;
	}
	.mis-tarjeta-cabeza {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}
	.mis-insignia {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		border-radius: 14px;
		background: var(--au-tint);
		color: var(--emerald-800);
		font-size: 1rem;
		font-weight: 800;
		letter-spacing: 0.02em;
	}
	.mis-insignia--hecha {
		background: var(--bg-base);
		color: var(--text-muted);
	}
	.mis-tarjeta-texto {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
		flex: 1;
	}
	.mis-tarjeta-titulo {
		font-size: 1rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		line-height: 1.25;
		color: var(--text-primary);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.mis-tarjeta-meta {
		font-size: 0.78rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.mis-tarjeta :global(.mis-chevron) {
		flex-shrink: 0;
		color: var(--emerald-500);
	}
	.mis-tarjeta-pie {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.mis-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		background: var(--au-tint);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--c, var(--emerald-800));
	}
	.mis-pill::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--c, var(--emerald-500));
	}
	.mis-tarjeta-estado {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-muted);
	}

	/* Borradores */
	.mis-borradores {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.mis-borrador {
		display: flex;
		align-items: stretch;
		gap: 0.35rem;
	}
	.mis-borrador-enlace {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.6rem 0.8rem;
		border-radius: 12px;
		background: #fffbeb;
		border: 1px solid #fde68a;
		color: #92400e;
		font-size: 0.8rem;
		font-weight: 700;
		text-decoration: none;
	}
	.mis-borrador-barra {
		display: block;
		height: 4px;
		border-radius: 999px;
		background: rgba(146, 64, 14, 0.15);
		overflow: hidden;
	}
	.mis-borrador-barra span {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: #f59e0b;
	}
	.mis-borrador-descartar {
		flex: 0 0 auto;
		width: 40px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-muted);
		cursor: pointer;
	}
	.mis-borrador-descartar:hover:not(:disabled) {
		color: var(--au-danger);
		background: var(--au-danger-soft);
		border-color: transparent;
	}
	.mis-borrador-descartar:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.mis-tarjeta-accion {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		margin-top: auto;
		padding: 0 1rem;
		border-radius: 14px;
		background: var(--emerald-500);
		color: #fff;
		font-size: 0.9rem;
		font-weight: 800;
		text-decoration: none;
		box-shadow: 0 6px 16px rgba(var(--au-primary-rgb), 0.25);
		transition: background-color 0.15s ease;
	}
	.mis-tarjeta-accion:hover {
		background: var(--emerald-600);
	}
	.mis-tarjeta-accion--otro {
		background: transparent;
		color: var(--emerald-800);
		border: 1.5px solid var(--emerald-500);
		box-shadow: none;
	}
	.mis-tarjeta-accion--otro:hover {
		background: var(--au-tint);
	}

	.mis-mas {
		align-self: center;
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
