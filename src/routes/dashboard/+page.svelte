<script lang="ts">
	/**
	 * Panel de inicio.
	 *
	 * El backend dice qué secciones le tocan a este usuario (por área y por
	 * módulos accesibles); aquí se elige una, se le pasa el periodo de la URL y
	 * se pinta. La actividad reciente del equipo va siempre abajo.
	 *
	 * Periodo y sección viven en la URL: un enlace compartido abre lo mismo.
	 */
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth';
	import { mascota } from '$lib/mascot';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { opcion, texto, type DefinicionesFiltros } from '$lib/listing/filtros';
	import { seccionesPanel, seccionPanel, type SeccionPanel } from '$lib/api/dashboard';
	import { rangoDe, type FiltrosPeriodo, type TipoPeriodo } from '$lib/dashboard/periodo';
	import FiltroPeriodo from '$lib/components/dashboard/FiltroPeriodo.svelte';
	import ActividadReciente from '$lib/components/dashboard/ActividadReciente.svelte';
	import SeccionOperaciones from '$lib/components/dashboard/SeccionOperaciones.svelte';
	import SeccionHseq from '$lib/components/dashboard/SeccionHseq.svelte';
	import SeccionMantenimiento from '$lib/components/dashboard/SeccionMantenimiento.svelte';
	import SeccionTalentoHumano from '$lib/components/dashboard/SeccionTalentoHumano.svelte';
	import SeccionFacturacion from '$lib/components/dashboard/SeccionFacturacion.svelte';
	import SeccionContabilidad from '$lib/components/dashboard/SeccionContabilidad.svelte';

	const EMPRESA = 'Cotransmeq';

	// ── Estado en la URL ─────────────────────────────────────────────────
	interface Filtros extends FiltrosPeriodo {
		seccion: string;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		seccion: texto(),
		tipo: opcion<TipoPeriodo>('mes'),
		mes: texto(),
		semana: texto(),
		desde: texto(),
		hasta: texto()
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leer(page.url));
	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});
	const rango = $derived(rangoDe(filtros));

	// ── Secciones ────────────────────────────────────────────────────────
	let secciones = $state<SeccionPanel[]>([]);
	let cargandoSecciones = $state(true);
	const seccionActiva = $derived(
		secciones.find((s) => s.id === filtros.seccion) ?? secciones[0] ?? null
	);

	onMount(async () => {
		try {
			const res = await seccionesPanel();
			secciones = res.secciones;
		} catch {
			toast.error('No se pudo cargar el panel');
		} finally {
			cargandoSecciones = false;
		}
	});

	// ── Datos de la sección activa ───────────────────────────────────────
	let datos = $state<Record<string, unknown> | null>(null);
	/// De qué sección son `datos`. Al cambiar de pestaña, los datos viejos no
	/// sirven para el componente nuevo (otra forma): se muestra el esqueleto
	/// hasta que lleguen los suyos. Al cambiar solo el periodo, la forma es la
	/// misma y los datos viejos se dejan atenuados mientras se refrescan.
	let datosDe = $state<string | null>(null);
	let cargandoDatos = $state(false);
	let consulta = 0;

	const clave = $derived(`${seccionActiva?.id ?? ''}|${rango.desde}|${rango.hasta}`);
	$effect(() => {
		void clave;
		untrack(() => void cargarDatos());
	});

	async function cargarDatos() {
		const sec = seccionActiva;
		if (!sec || !sec.disponible) {
			datos = null;
			datosDe = null;
			return;
		}
		if (datosDe !== sec.id) {
			datos = null;
			datosDe = null;
		}
		const actual = ++consulta;
		cargandoDatos = true;
		try {
			const d = await seccionPanel(sec.id, rango.desde, rango.hasta);
			if (actual === consulta) {
				datos = d;
				datosDe = sec.id;
			}
		} catch {
			if (actual === consulta) {
				datos = null;
				datosDe = null;
				toast.error('No se pudo cargar la sección');
			}
		} finally {
			if (actual === consulta) cargandoDatos = false;
		}
	}

	const user = $derived($authStore.user);
	const saludo = $derived.by(() => {
		const h = new Date().getHours();
		return h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches';
	});
	const hoyLargo = new Date().toLocaleDateString('es-CO', {
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});
</script>

<svelte:head>
	<title>Inicio — {EMPRESA}</title>
</svelte:head>

<div class="pn" in:fade={{ duration: 300 }}>
	<header class="page-card pn-cabecera">
		<div class="pn-cabecera-texto">
			<p class="pn-fecha">{hoyLargo}</p>
			<h1 class="pn-titulo">{saludo}, {user?.nombre?.split(' ')[0] ?? ''}</h1>
			<p class="pn-desc">Lo más reciente de tus áreas y los pendientes que piden atención.</p>
		</div>
		<FiltroPeriodo valor={filtros} onCambiar={(c) => (filtros = { ...filtros, ...c })} />
	</header>

	{#if cargandoSecciones}
		<div class="pn-esqueleto" aria-hidden="true">
			{#each Array(4) as _, i (i)}<div class="pn-hueso"></div>{/each}
		</div>
	{:else if secciones.length === 0}
		{@const img = mascota('vacio')}
		<div class="page-card pn-vacio">
			<img src={img.src} alt={img.alt} width="220" height="220" />
			<h2>Tu usuario no tiene secciones en el panel</h2>
			<p>
				Las secciones dependen de tus áreas y permisos. Pide a administración que revise tu acceso.
			</p>
		</div>
	{:else}
		{#if secciones.length > 1}
			<nav
				class="pn-tabs"
				aria-label="Secciones del panel"
				in:fly={{ y: 8, duration: 300, delay: 60 }}
			>
				{#each secciones as s (s.id)}
					<button
						type="button"
						class="pn-tab"
						class:pn-tab--activa={seccionActiva?.id === s.id}
						aria-pressed={seccionActiva?.id === s.id}
						title={s.descripcion}
						onclick={() => (filtros = { ...filtros, seccion: s.id })}
					>
						{s.titulo}
						{#if !s.disponible}<span class="pn-tab-pronto">pronto</span>{/if}
					</button>
				{/each}
			</nav>
		{/if}

		{#if seccionActiva}
			<section
				class="pn-seccion"
				aria-label={seccionActiva.titulo}
				in:fly={{ y: 10, duration: 350, delay: 100 }}
			>
				{#if !seccionActiva.disponible}
					{@const img = mascota('espera')}
					<div class="page-card pn-vacio">
						<img src={img.src} alt={img.alt} width="200" height="200" />
						<h2>{seccionActiva.titulo} está en construcción</h2>
						<p>{seccionActiva.descripcion}</p>
					</div>
				{:else if !datos || datosDe !== seccionActiva.id}
					<div class="pn-esqueleto" aria-hidden="true">
						{#each Array(4) as _, i (i)}<div class="pn-hueso"></div>{/each}
						<div class="pn-hueso pn-hueso--ancho"></div>
					</div>
				{:else}
					<div class:pn-seccion--refrescando={cargandoDatos}>
						{#if seccionActiva.id === 'operaciones'}
							<SeccionOperaciones {datos} />
						{:else if seccionActiva.id === 'hseq'}
							<SeccionHseq {datos} />
						{:else if seccionActiva.id === 'mantenimiento'}
							<SeccionMantenimiento {datos} />
						{:else if seccionActiva.id === 'talento_humano'}
							<SeccionTalentoHumano {datos} onCambio={cargarDatos} />
						{:else if seccionActiva.id === 'facturacion'}
							<SeccionFacturacion {datos} />
						{:else if seccionActiva.id === 'contabilidad'}
							<SeccionContabilidad {datos} />
						{/if}
					</div>
				{/if}
			</section>
		{/if}
	{/if}

	<div class="pn-actividad" in:fly={{ y: 10, duration: 350, delay: 160 }}>
		<ActividadReciente />
	</div>
</div>

<style>
	.pn {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem;
		min-height: 100%;
	}
	.pn-cabecera {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem 1.5rem;
		padding: 1.25rem 1.5rem;
	}
	.pn-cabecera-texto {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.pn-fecha {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--au-primary-strong);
	}
	.pn-fecha::first-letter {
		text-transform: uppercase;
	}
	.pn-titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.7rem;
		font-weight: 800;
		letter-spacing: -0.025em;
		line-height: 1.15;
		color: var(--text-primary);
	}
	.pn-desc {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.pn-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		padding: 0.3rem;
		background: var(--bg-surface);
		border: 1.5px solid var(--border-default);
		border-radius: 16px;
		align-self: flex-start;
	}
	.pn-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.9rem;
		border: 0;
		border-radius: 12px;
		background: transparent;
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background 0.15s var(--ease-apple),
			color 0.15s var(--ease-apple);
	}
	.pn-tab:hover {
		color: var(--text-primary);
	}
	.pn-tab--activa {
		background: var(--au-dark);
		color: #fff;
	}
	.pn-tab-pronto {
		font-size: 0.6rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-very-muted);
	}
	.pn-tab--activa .pn-tab-pronto {
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
	}
	.pn-seccion--refrescando {
		opacity: 0.6;
		transition: opacity 0.2s;
	}
	.pn-esqueleto {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.75rem;
	}
	.pn-hueso {
		height: 92px;
		border-radius: 16px;
		background: linear-gradient(90deg, var(--bg-surface), var(--bg-base), var(--bg-surface));
		background-size: 200% 100%;
		animation: pn-brillo 1.2s ease-in-out infinite;
		border: 1px solid var(--border-subtle);
	}
	.pn-hueso--ancho {
		grid-column: 1 / -1;
		height: 240px;
	}
	@keyframes pn-brillo {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
	.pn-vacio {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.35rem;
		padding: 2rem 1.5rem;
	}
	.pn-vacio img {
		width: 200px;
		height: auto;
	}
	.pn-vacio h2 {
		margin: 0.5rem 0 0;
		font-family: var(--font-display);
		font-size: 1.1rem;
		font-weight: 800;
		color: var(--text-primary);
	}
	.pn-vacio p {
		margin: 0;
		max-width: 46ch;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.pn-actividad {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
	}
	@media (max-width: 640px) {
		.pn {
			padding: 1rem;
		}
	}
</style>
