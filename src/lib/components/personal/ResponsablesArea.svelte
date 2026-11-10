<script lang="ts">
	import { onMount } from 'svelte';
	import { Building2, Check, RefreshCw, UserRound } from 'lucide-svelte';
	import { AREA_LABELS, AREAS, type Area } from '$lib/config/permissions';
	import {
		usuariosAPI,
		type ResponsableArea as ResponsableAreaItem,
		type Usuario
	} from '$lib/api/usuarios';
	import { toast } from 'svelte-sonner';

	let usuarios = $state<Usuario[]>([]);
	let responsables = $state<ResponsableAreaItem[]>([]);
	let seleccionados = $state<Record<Area, string>>({} as Record<Area, string>);
	let guardando = $state<Area | ''>('');
	let cargando = $state(true);
	let error = $state('');

	async function cargar() {
		cargando = true;
		error = '';
		try {
			const [listaUsuarios, listaResponsables] = await Promise.all([
				usuariosAPI.listar(),
				usuariosAPI.listarResponsablesArea()
			]);
			usuarios = listaUsuarios;
			responsables = listaResponsables;
			seleccionados = Object.fromEntries(
				listaResponsables.map(({ area, responsable }) => [area, responsable?.id ?? ''])
			) as Record<Area, string>;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'No se pudieron cargar los responsables.';
		} finally {
			cargando = false;
		}
	}

	function candidatos(area: Area) {
		return usuarios.filter(
			(usuario) => usuario.activo && Array.isArray(usuario.area) && usuario.area.includes(area)
		);
	}

	async function guardar(area: Area) {
		const usuario_id = seleccionados[area];
		if (!usuario_id) return;
		guardando = area;
		try {
			const actualizado = await usuariosAPI.actualizarResponsableArea(area, usuario_id);
			responsables = responsables.map((item) => (item.area === area ? actualizado : item));
			toast.success(`Responsable de ${actualizado.etiqueta} actualizado.`);
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo guardar el responsable.');
		} finally {
			guardando = '';
		}
	}

	onMount(() => void cargar());
</script>

<section class="areas-panel" aria-label="Responsables por área" aria-busy={cargando}>
	<header class="areas-panel__header">
		<div>
			<p class="areas-panel__eyebrow">ORGANIZACIÓN Y SEGUIMIENTO</p>
			<h2>Responsables por área</h2>
			<p>Define quién recibe las actividades del plan asociadas a cada área.</p>
		</div>
		<div class="areas-panel__summary">
			<strong>{responsables.filter((item) => item.responsable?.activo && item.responsable.area?.includes(item.area)).length}<span>/{AREAS.length}</span></strong>
			<small>áreas con responsable activo</small>
		</div>
	</header>

	{#if error}
		<div class="areas-error" role="alert">
			<span>{error}</span>
			<button type="button" onclick={() => void cargar()}><RefreshCw size={15} /> Reintentar</button>
		</div>
	{:else}
		<div class="areas-grid">
			{#each AREAS as area (area)}
				{@const item = responsables.find((responsable) => responsable.area === area)}
				{@const lista = candidatos(area)}
				{@const actualActivo = Boolean(item?.responsable?.activo && item.responsable.area?.includes(area))}
				<article class="area-card" class:area-card--assigned={actualActivo}>
					<div class="area-card__top">
						<span class="area-card__icon"><Building2 size={17} /></span>
						<div class="area-card__title">
							<h3>{AREA_LABELS[area]}</h3>
							<span class:status-pending={!actualActivo} class="area-status">
								{actualActivo ? 'Responsable activo' : 'Pendiente de asignar'}
							</span>
						</div>
					</div>

					{#if actualActivo && item?.responsable}
						<div class="area-card__current">
							<span class="person-avatar"><UserRound size={16} /></span>
							<span><strong>{item.responsable.nombre}</strong><small>{item.responsable.cargo || item.responsable.correo}</small></span>
							<Check class="current-check" size={17} aria-label="Asignado" />
						</div>
					{:else if item?.responsable}
						<p class="area-card__inactive">La asignación anterior ya no pertenece a esta área o está inactiva.</p>
					{:else}
					<p class="area-card__hint">Aún no hay una persona definida para recibir sus actividades.</p>
				{/if}

					<label class="area-card__select-label" for={`responsable-${area}`}>Elegir responsable</label>
					<div class="area-card__actions">
						<select id={`responsable-${area}`} bind:value={seleccionados[area]} disabled={cargando || guardando === area}>
							<option value="">Selecciona una persona</option>
							{#each lista as usuario (usuario.id)}
								<option value={usuario.id}>{usuario.nombre} · {usuario.cargo || usuario.correo}</option>
							{/each}
						</select>
						<button type="button" disabled={!seleccionados[area] || guardando === area || cargando} onclick={() => void guardar(area)}>
							{#if guardando === area}<RefreshCw size={15} class="spin" />{:else}<Check size={15} />{/if}
							Guardar
						</button>
					</div>
					{#if !lista.length}
						<small class="area-card__no-candidates">No hay personal administrativo activo asociado a esta área.</small>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</section>

<style>
	.areas-panel { display: grid; gap: 1rem; }
	.areas-panel__header { display: flex; align-items: center; justify-content: space-between; gap: 1.2rem; padding: 1.2rem 1.3rem; border: 1px solid var(--border-subtle); border-radius: 16px; background: var(--bg-surface); }
	.areas-panel__header > div:first-child { display: grid; gap: .35rem; }
	.areas-panel__eyebrow { margin: 0; color: var(--au-primary-strong); font-size: .62rem; font-weight: 850; letter-spacing: .11em; }
	.areas-panel__header h2 { margin: 0; color: var(--text-primary); font-family: var(--font-display); font-size: 1.25rem; letter-spacing: -.025em; }
	.areas-panel__header p:last-child { margin: 0; color: var(--text-muted); font-size: .8rem; }
	.areas-panel__summary { display: grid; justify-items: end; gap: .15rem; white-space: nowrap; }
	.areas-panel__summary strong { color: var(--au-primary-strong); font-size: 1.4rem; line-height: 1; }
	.areas-panel__summary strong span { color: var(--text-muted); font-size: .82rem; font-weight: 650; }
	.areas-panel__summary small { color: var(--text-muted); font-size: .68rem; }
	.areas-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); gap: .75rem; }
	.area-card { display: grid; align-content: start; gap: .75rem; min-width: 0; padding: 1rem; border: 1px solid var(--border-subtle); border-radius: 14px; background: var(--bg-surface); transition: border-color .16s ease, box-shadow .16s ease; }
	.area-card--assigned { border-color: color-mix(in srgb, var(--au-primary-strong) 25%, var(--border-subtle)); }
	.area-card__top { display: flex; align-items: center; gap: .65rem; }
	.area-card__icon { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; border-radius: 11px; color: var(--au-primary-strong); background: color-mix(in srgb, var(--au-primary-strong) 9%, var(--bg-surface)); }
	.area-card__title { display: grid; gap: .12rem; min-width: 0; }
	.area-card__title h3 { margin: 0; color: var(--text-primary); font-size: .92rem; font-weight: 800; }
	.area-status { color: var(--au-primary-strong); font-size: .67rem; font-weight: 700; }
	.area-status.status-pending { color: var(--text-muted); }
	.area-card__current { display: flex; align-items: center; gap: .6rem; min-width: 0; padding: .62rem .7rem; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--bg-base); }
	.person-avatar { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 auto; border-radius: 50%; color: var(--au-primary-strong); background: color-mix(in srgb, var(--au-primary-strong) 12%, var(--bg-surface)); }
	.area-card__current > span:nth-child(2) { display: grid; min-width: 0; }
	.area-card__current strong { overflow: hidden; color: var(--text-primary); font-size: .76rem; text-overflow: ellipsis; white-space: nowrap; }
	.area-card__current small { overflow: hidden; color: var(--text-muted); font-size: .67rem; text-overflow: ellipsis; white-space: nowrap; }
	:global(.current-check) { margin-left: auto; flex: 0 0 auto; color: var(--au-primary-strong); }
	.area-card__hint, .area-card__inactive { min-height: 2.2rem; margin: 0; color: var(--text-muted); font-size: .72rem; line-height: 1.45; }
	.area-card__inactive { color: var(--color-warning, #a16207); }
	.area-card__select-label { margin-bottom: -.48rem; color: var(--text-secondary); font-size: .68rem; font-weight: 750; }
	.area-card__actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .45rem; }
	.area-card__actions select { min-width: 0; height: 40px; padding: 0 .65rem; border: 1px solid var(--border-subtle); border-radius: 9px; color: var(--text-primary); background: var(--bg-base); font: inherit; font-size: .72rem; }
	.area-card__actions button, .areas-error button { display: inline-flex; align-items: center; justify-content: center; gap: .35rem; min-height: 40px; padding: .55rem .72rem; border: 0; border-radius: 9px; color: white; background: var(--au-primary-strong); font: inherit; font-size: .7rem; font-weight: 750; cursor: pointer; }
	.area-card__actions button:disabled { opacity: .48; cursor: not-allowed; }
	.area-card__no-candidates { color: var(--text-muted); font-size: .66rem; }
	.areas-error { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .9rem 1rem; border: 1px solid color-mix(in srgb, #dc2626 25%, var(--border-subtle)); border-radius: 12px; color: var(--text-primary); background: var(--bg-surface); font-size: .78rem; }
	.areas-error button { min-height: 34px; }
	:global(.spin) { animation: spin .9s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (max-width: 520px) { .areas-panel__header { align-items: flex-start; padding: 1rem; } .areas-panel__summary { padding-top: .15rem; } .areas-panel__summary small { max-width: 5.5rem; white-space: normal; text-align: right; } }
</style>
