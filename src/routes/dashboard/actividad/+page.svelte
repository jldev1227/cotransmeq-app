<script lang="ts">
	/**
	 * Histórico del registro de actividad: quién hizo qué y cuándo, con
	 * filtros por persona, módulo, tipo de acción, área y fechas. El admin ve
	 * a todos; los demás, a la gente de sus áreas (lo decide el backend).
	 *
	 * Filtros y página viven en la URL, como en los directorios.
	 */
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { ArrowLeft } from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		numero as numeroFiltro,
		texto,
		valoresPorDefecto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { listarActividad, opcionesActividad, type RegistroActividad } from '$lib/api/dashboard';
	import { ETIQUETA_ACCION, etiquetaArea, etiquetaModulo } from '$lib/dashboard/modulos';
	import { fechaCorta, horaCorta, iniciales } from '$lib/dashboard/formato';
	import { mascota } from '$lib/mascot';

	const EMPRESA = 'Cotransmeq';
	const POR_PAGINA = 30;

	interface Filtros {
		q: string;
		usuario: string;
		modulo: string;
		accion: string;
		area: string;
		desde: string;
		hasta: string;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		q: texto(),
		usuario: texto(),
		modulo: texto(),
		accion: texto(),
		area: texto(),
		desde: texto(),
		hasta: texto(),
		pagina: numeroFiltro(1)
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	const DEFS_VACIOS = valoresPorDefecto(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leer(page.url));
	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});
	const hayFiltros = $derived(
		!!(
			filtros.q ||
			filtros.usuario ||
			filtros.modulo ||
			filtros.accion ||
			filtros.area ||
			filtros.desde ||
			filtros.hasta
		)
	);

	function poner(cambios: Partial<Filtros>) {
		filtros = { ...filtros, ...cambios, pagina: cambios.pagina ?? 1 };
	}

	let items = $state<RegistroActividad[]>([]);
	let total = $state(0);
	let cargando = $state(true);
	let opciones = $state<{
		usuarios: Array<{ id: string; nombre: string }>;
		modulos: Array<{ id: string }>;
		areas: string[] | null;
	}>({ usuarios: [], modulos: [], areas: null });

	async function cargar() {
		cargando = true;
		try {
			const res = await listarActividad({
				limit: POR_PAGINA,
				pagina: filtros.pagina,
				q: filtros.q || undefined,
				usuario_id: filtros.usuario || undefined,
				modulo: filtros.modulo || undefined,
				accion: filtros.accion || undefined,
				area: filtros.area || undefined,
				desde: filtros.desde || undefined,
				hasta: filtros.hasta || undefined
			});
			items = res.data;
			total = res.meta.total;
		} catch {
			toast.error('No se pudo cargar la actividad');
		} finally {
			cargando = false;
		}
	}
	$effect(() => {
		void filtros;
		untrack(() => void cargar());
	});
	onMount(async () => {
		try {
			opciones = await opcionesActividad();
		} catch {
			/* los filtros quedan sin opciones; la lista sigue sirviendo */
		}
	});

	/// Agrupar por día para que el ojo encuentre «ayer» sin leer fechas.
	const grupos = $derived.by(() => {
		const out: Array<{ dia: string; items: RegistroActividad[] }> = [];
		for (const it of items) {
			const dia = fechaCorta(it.created_at);
			const ultimo = out[out.length - 1];
			if (ultimo && ultimo.dia === dia) ultimo.items.push(it);
			else out.push({ dia, items: [it] });
		}
		return out;
	});

	const AREAS_TODAS = [
		'administracion',
		'operaciones',
		'contabilidad',
		'facturacion',
		'talento_humano',
		'hseq',
		'mantenimiento'
	];
	const areasFiltro = $derived(opciones.areas ?? AREAS_TODAS);

	function tonoDe(nombre: string): number {
		let h = 0;
		for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % 360;
		return h;
	}
</script>

<svelte:head>
	<title>Actividad reciente — {EMPRESA}</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 300 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<a class="ac-volver" href="/dashboard"><ArrowLeft size={14} strokeWidth={2.4} /> Inicio</a>
			<h1 class="dir-titulo">Actividad reciente</h1>
			<p class="dir-desc">
				Quién hizo qué y cuándo. {opciones.areas
					? `Ves lo de ${opciones.areas.map(etiquetaArea).join(', ') || 'tu usuario'}.`
					: 'Como administrador ves a todo el equipo.'}
			</p>
		</div>
	</header>

	<div class="dir-filtros" in:fly={{ y: 12, duration: 350, delay: 80 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				bind:valor={filtros.q}
				onBuscar={(t) => poner({ q: t })}
				placeholder="Descripción, persona o consecutivo…"
				etiqueta="Buscar en la actividad"
			/>
		</div>
		<select
			class="ac-select"
			aria-label="Persona"
			value={filtros.usuario}
			onchange={(e) => poner({ usuario: e.currentTarget.value })}
		>
			<option value="">Todas las personas</option>
			{#each opciones.usuarios as u (u.id)}<option value={u.id}>{u.nombre}</option>{/each}
		</select>
		<select
			class="ac-select"
			aria-label="Módulo"
			value={filtros.modulo}
			onchange={(e) => poner({ modulo: e.currentTarget.value })}
		>
			<option value="">Todos los módulos</option>
			{#each opciones.modulos as m (m.id)}<option value={m.id}>{etiquetaModulo(m.id)}</option
				>{/each}
		</select>
		<select
			class="ac-select"
			aria-label="Acción"
			value={filtros.accion}
			onchange={(e) => poner({ accion: e.currentTarget.value })}
		>
			<option value="">Todas las acciones</option>
			{#each Object.entries(ETIQUETA_ACCION) as [id, etq] (id)}<option value={id}>{etq}</option
				>{/each}
		</select>
		{#if areasFiltro.length > 1}
			<select
				class="ac-select"
				aria-label="Área"
				value={filtros.area}
				onchange={(e) => poner({ area: e.currentTarget.value })}
			>
				<option value="">Todas las áreas</option>
				{#each areasFiltro as a (a)}<option value={a}>{etiquetaArea(a)}</option>{/each}
			</select>
		{/if}
		<input
			type="date"
			class="ac-fecha"
			aria-label="Desde"
			value={filtros.desde}
			max={filtros.hasta || undefined}
			onchange={(e) => poner({ desde: e.currentTarget.value })}
		/>
		<span class="ac-sep" aria-hidden="true">–</span>
		<input
			type="date"
			class="ac-fecha"
			aria-label="Hasta"
			value={filtros.hasta}
			min={filtros.desde || undefined}
			onchange={(e) => poner({ hasta: e.currentTarget.value })}
		/>
		{#if hayFiltros}
			<button type="button" class="btn-ghost" onclick={() => (filtros = { ...DEFS_VACIOS })}
				>Limpiar</button
			>
		{/if}
	</div>

	<div class="dir-lista page-card ac-lista" in:fly={{ y: 12, duration: 350, delay: 140 }}>
		{#if cargando && items.length === 0}
			<p class="ac-estado">Cargando…</p>
		{:else if items.length === 0}
			{@const img = mascota('vacio')}
			<div class="dir-vacio">
				<img src={img.src} alt={img.alt} width="300" height="300" />
				<h3>{hayFiltros ? 'Sin resultados' : 'Todavía no hay actividad'}</h3>
				<p>
					{hayFiltros
						? 'No hay movimientos que coincidan con los filtros.'
						: 'Cuando tu equipo cree o cambie algo, aparecerá aquí.'}
				</p>
			</div>
		{:else}
			<div class:ac-refrescando={cargando}>
				{#each grupos as g (g.dia)}
					<h2 class="ac-dia">{g.dia}</h2>
					<ul class="ac-items">
						{#each g.items as it (it.id)}
							<li class="ac-item">
								<time class="ac-hora" datetime={it.created_at}>{horaCorta(it.created_at)}</time>
								<span class="ac-avatar" style="--h: {tonoDe(it.usuario_nombre)}"
									>{iniciales(it.usuario_nombre)}</span
								>
								<div class="ac-texto">
									<p class="ac-linea"><strong>{it.usuario_nombre}</strong> {it.descripcion}</p>
									<p class="ac-meta">
										<span class="ac-modulo">{etiquetaModulo(it.modulo)}</span>
										<span class="ac-accion">{ETIQUETA_ACCION[it.accion] ?? it.accion}</span>
										{#if it.usuario_areas.length}<span class="ac-areas"
												>{it.usuario_areas.map(etiquetaArea).join(', ')}</span
											>{/if}
									</p>
								</div>
							</li>
						{/each}
					</ul>
				{/each}
			</div>
		{/if}
		<PaginadorLista
			pagina={filtros.pagina}
			{total}
			porPagina={POR_PAGINA}
			{cargando}
			nombreItems="movimientos"
			onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
		/>
	</div>
</div>

<style>
	.ac-volver {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.74rem;
		font-weight: 700;
		color: var(--au-primary-strong);
		text-decoration: none;
	}
	.ac-select,
	.ac-fecha {
		min-height: 40px;
		padding: 0 0.7rem;
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.82rem;
		color: var(--text-primary);
		max-width: 220px;
	}
	.ac-select:focus-visible,
	.ac-fecha:focus-visible {
		outline: none;
		border-color: var(--au-primary);
	}
	.ac-sep {
		color: var(--text-very-muted);
	}
	.ac-lista {
		padding: 0.5rem 1.25rem 0;
	}
	.ac-estado {
		padding: 1.5rem 0;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.ac-refrescando {
		opacity: 0.6;
	}
	.ac-dia {
		margin: 1rem 0 0.25rem;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.ac-items {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ac-item {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.55rem 0;
		border-top: 1px dashed var(--border-subtle);
	}
	.ac-hora {
		flex-shrink: 0;
		width: 4.5rem;
		padding-top: 0.4rem;
		font-size: 0.72rem;
		color: var(--text-very-muted);
		font-variant-numeric: tabular-nums;
	}
	.ac-avatar {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: hsl(var(--h, 160) 45% 92%);
		color: hsl(var(--h, 160) 45% 28%);
		font-size: 0.68rem;
		font-weight: 800;
	}
	.ac-texto {
		min-width: 0;
	}
	.ac-linea {
		margin: 0;
		font-size: 0.84rem;
		line-height: 1.4;
		color: var(--text-secondary);
	}
	.ac-linea strong {
		color: var(--text-primary);
	}
	.ac-meta {
		margin: 0.15rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: 0.68rem;
		color: var(--text-very-muted);
	}
	.ac-modulo {
		font-weight: 700;
		color: var(--au-primary-strong);
	}
	.ac-accion::before,
	.ac-areas::before {
		content: '·';
		margin-right: 0.4rem;
	}
</style>
