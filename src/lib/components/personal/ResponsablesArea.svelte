<script lang="ts">
	import { onMount } from 'svelte';
	import { Building2, Check, RefreshCw, Search, UserRound } from 'lucide-svelte';
	import { AREA_LABELS, AREAS, type Area } from '$lib/config/permissions';
	import {
		usuariosAPI,
		type ResponsableArea as ResponsableAreaItem,
		type Usuario
	} from '$lib/api/usuarios';
	import { coincide } from '$lib/listing/texto';
	import { toast } from 'svelte-sonner';

	let usuarios = $state<Usuario[]>([]);
	let responsables = $state<ResponsableAreaItem[]>([]);
	let seleccionados = $state<Record<Area, string>>({} as Record<Area, string>);
	let guardando = $state<Area | ''>('');
	let cargando = $state(true);
	let error = $state('');
	let busqueda = $state('');

	const responsablesActivos = $derived(
		responsables.filter(
			(item) => item.responsable?.activo && item.responsable.area?.includes(item.area)
		).length
	);
	const areasFiltradas = $derived(
		AREAS.filter((area) => {
			const persona = responsables.find((item) => item.area === area)?.responsable;
			return coincide(busqueda, [
				AREA_LABELS[area],
				persona?.nombre,
				persona?.cargo,
				persona?.correo
			]);
		})
	);

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

	function esResponsableValido(area: Area, responsable?: ResponsableAreaItem['responsable']) {
		return Boolean(responsable?.activo && responsable.area?.includes(area));
	}

	async function guardar(area: Area) {
		const usuario_id = seleccionados[area];
		if (!usuario_id || guardando) return;
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
		<div class="areas-panel__intro">
			<p class="areas-panel__eyebrow">PERSONAL · HSEQ / PESV</p>
			<h2>Responsables por área</h2>
			<p>Estas personas reciben las tareas de su área en la planeación HSEQ/PESV.</p>
			<a class="areas-panel__plan-link" href="/dashboard/plan-trabajo#responsables"
				>Volver a la planeación <span aria-hidden="true">→</span></a
			>
		</div>
		<div class="areas-panel__summary" aria-live="polite">
			<strong>{responsablesActivos}<span>/{AREAS.length}</span></strong>
			<small>áreas con responsable activo</small>
		</div>
	</header>

	{#if error}
		<div class="areas-error" role="alert">
			<span>{error}</span>
			<button type="button" onclick={() => void cargar()}><RefreshCw size={15} /> Reintentar</button
			>
		</div>
	{:else}
		<div class="areas-toolbar">
			<label class="areas-search">
				<Search size={16} aria-hidden="true" />
				<span class="sr-only">Buscar área o responsable</span>
				<input
					type="search"
					aria-label="Buscar área o responsable"
					placeholder="Buscar área o persona"
					bind:value={busqueda}
				/>
			</label>
			<span class="areas-visible-count">{areasFiltradas.length} de {AREAS.length} áreas</span>
		</div>

		<div class="areas-table-wrap">
			<table class="areas-table" aria-label="Responsables principales por área">
				<thead>
					<tr
						><th scope="col">Área</th><th scope="col">Responsable actual</th><th scope="col"
							>Asignar persona</th
						><th scope="col"><span class="sr-only">Acciones</span></th></tr
					>
				</thead>
				<tbody>
					{#each areasFiltradas as area (area)}
						{@const item = responsables.find((responsable) => responsable.area === area)}
						{@const actualActivo = esResponsableValido(area, item?.responsable)}
						{@const lista = candidatos(area)}
						<tr>
							<td class="areas-table__identity">
								<div class="area-name">
									<span class="area-icon"><Building2 size={16} /></span>
									<span
										><strong>{AREA_LABELS[area]}</strong><small
											>{lista.length} personas elegibles</small
										></span
									>
								</div>
							</td>
							<td class="areas-table__current">
								<span class="area-cell-label">Responsable actual</span>
								{#if actualActivo && item?.responsable}
									<div class="person-current">
										<span class="person-avatar"><UserRound size={15} /></span>
										<span
											><strong>{item.responsable.nombre}</strong><small
												>{item.responsable.cargo || item.responsable.correo}</small
											></span
										>
										<Check size={16} class="current-check" aria-label="Responsable activo" />
									</div>
								{:else}
									<div class="person-pending">
										<strong
											>{item?.responsable
												? 'Asignación por revisar'
												: 'Sin responsable asignado'}</strong
										>
										<small
											>{item?.responsable
												? 'La persona está inactiva o no pertenece a esta área.'
												: 'Elige una persona para recibir sus tareas.'}</small
										>
									</div>
								{/if}
							</td>
							<td class="areas-table__select">
								<span class="area-cell-label">Elegir responsable de {AREA_LABELS[area]}</span>
								<select
									aria-label={`Elegir responsable de ${AREA_LABELS[area]}`}
									bind:value={seleccionados[area]}
									disabled={cargando || guardando !== ''}
								>
									<option value="">Selecciona una persona</option>
									{#each lista as usuario (usuario.id)}
										<option value={usuario.id}
											>{usuario.nombre} · {usuario.cargo || usuario.correo}</option
										>
									{/each}
								</select>
								{#if !lista.length}<small class="area-no-candidates"
										>No hay personal activo asociado a esta área.</small
									>{/if}
							</td>
							<td class="areas-table__action">
								<button
									type="button"
									disabled={!seleccionados[area] ||
										guardando !== '' ||
										seleccionados[area] === item?.responsable?.id}
									onclick={() => void guardar(area)}
								>
									{#if guardando === area}<RefreshCw size={15} class="spin" />{:else}<Check
											size={15}
										/>{/if}
									Guardar
								</button>
							</td>
						</tr>
					{:else}
						<tr
							><td class="areas-empty" colspan="4"
								>No encontramos áreas o responsables con esa búsqueda.</td
							></tr
						>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.areas-panel {
		display: grid;
		gap: 0.85rem;
		min-width: 0;
	}
	.areas-panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.2rem;
		padding: 1rem 1.2rem;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		background: var(--bg-surface);
	}
	.areas-panel__intro {
		display: grid;
		justify-items: start;
		gap: 0.32rem;
		min-width: 0;
	}
	.areas-panel__eyebrow {
		margin: 0;
		color: var(--au-primary-strong);
		font-size: 0.62rem;
		font-weight: 850;
		letter-spacing: 0.1em;
	}
	.areas-panel__header h2 {
		margin: 0;
		color: var(--text-primary);
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-weight: 820;
		letter-spacing: -0.025em;
	}
	.areas-panel__header p:not(.areas-panel__eyebrow) {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.76rem;
		line-height: 1.45;
	}
	.areas-panel__plan-link {
		margin-top: 0.2rem;
		color: var(--au-primary-strong);
		font-size: 0.72rem;
		font-weight: 800;
		text-decoration: none;
	}
	.areas-panel__plan-link span {
		margin-left: 0.2rem;
	}
	.areas-panel__summary {
		display: grid;
		justify-items: end;
		gap: 0.15rem;
		white-space: nowrap;
	}
	.areas-panel__summary strong {
		color: var(--au-primary-strong);
		font-size: 1.4rem;
		line-height: 1;
	}
	.areas-panel__summary strong span {
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 650;
	}
	.areas-panel__summary small,
	.areas-visible-count {
		color: var(--text-muted);
		font-size: 0.68rem;
	}
	.areas-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		padding: 0.65rem;
		border: 1px solid var(--border-subtle);
		border-radius: 11px;
		background: var(--bg-base);
	}
	.areas-search {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: min(100%, 28rem);
		min-height: 38px;
		padding: 0 0.65rem;
		border: 1px solid var(--border-default);
		border-radius: 9px;
		color: var(--text-muted);
		background: var(--bg-surface);
	}
	.areas-search:focus-within {
		border-color: var(--au-primary-strong);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--au-primary-strong) 12%, transparent);
	}
	.areas-search input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: 0;
		color: var(--text-primary);
		background: transparent;
		font: inherit;
		font-size: 0.76rem;
	}
	.areas-table-wrap {
		width: 100%;
		min-width: 0;
		overflow-x: auto;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: var(--bg-surface);
	}
	.areas-table {
		width: 100%;
		min-width: 820px;
		border-collapse: collapse;
		font-size: 0.76rem;
	}
	.areas-table th {
		padding: 0.7rem 0.8rem;
		border-bottom: 1px solid var(--border-default);
		color: var(--text-muted);
		background: var(--bg-base);
		font-size: 0.62rem;
		font-weight: 850;
		letter-spacing: 0.07em;
		text-align: left;
		text-transform: uppercase;
	}
	.areas-table td {
		padding: 0.72rem 0.8rem;
		border-bottom: 1px solid var(--border-subtle);
		vertical-align: middle;
	}
	.areas-table tbody tr:last-child td {
		border-bottom: 0;
	}
	.areas-table tbody tr:hover td {
		background: color-mix(in srgb, var(--au-primary-strong) 3%, var(--bg-surface));
	}
	.areas-table th:first-child {
		width: 22%;
	}
	.areas-table th:nth-child(2) {
		width: 30%;
	}
	.areas-table th:nth-child(3) {
		width: 37%;
	}
	.areas-table th:last-child {
		width: 11%;
	}
	.area-name,
	.person-current {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}
	.area-name > span:last-child,
	.person-current > span:nth-child(2) {
		display: grid;
		gap: 0.13rem;
		min-width: 0;
	}
	.area-icon {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		flex: 0 0 auto;
		border-radius: 9px;
		color: var(--au-primary-strong);
		background: color-mix(in srgb, var(--au-primary-strong) 9%, var(--bg-surface));
	}
	.area-name strong,
	.person-current strong,
	.person-pending strong {
		color: var(--text-primary);
		font-size: 0.74rem;
		font-weight: 780;
	}
	.area-name small,
	.person-current small,
	.person-pending small,
	.area-no-candidates {
		color: var(--text-muted);
		font-size: 0.64rem;
		line-height: 1.4;
	}
	.person-current {
		gap: 0.45rem;
	}
	.person-avatar {
		display: grid;
		place-items: center;
		width: 29px;
		height: 29px;
		flex: 0 0 auto;
		border-radius: 50%;
		color: var(--au-primary-strong);
		background: color-mix(in srgb, var(--au-primary-strong) 10%, var(--bg-surface));
	}
	:global(.current-check) {
		margin-left: auto;
		color: var(--au-primary-strong);
		flex: 0 0 auto;
	}
	.person-pending {
		display: grid;
		gap: 0.13rem;
	}
	.person-pending strong {
		color: #946200;
	}
	.areas-table__select select {
		width: 100%;
		min-height: 38px;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--border-default);
		border-radius: 9px;
		color: var(--text-primary);
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.71rem;
	}
	.areas-table__select select:focus-visible,
	.areas-table__action button:focus-visible {
		outline: 2px solid var(--au-primary-strong);
		outline-offset: 2px;
	}
	.area-no-candidates {
		display: block;
		margin-top: 0.3rem;
		color: #a16207;
	}
	.areas-table__action {
		text-align: right;
	}
	.areas-table__action button,
	.areas-error button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-height: 36px;
		padding: 0.45rem 0.62rem;
		border: 0;
		border-radius: 9px;
		color: #fff;
		background: var(--au-primary-strong);
		font: inherit;
		font-size: 0.7rem;
		font-weight: 780;
		cursor: pointer;
	}
	.areas-table__action button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.area-cell-label {
		display: none;
	}
	.areas-empty {
		padding: 2rem !important;
		color: var(--text-muted);
		text-align: center;
	}
	.areas-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.8rem 1rem;
		border: 1px solid color-mix(in srgb, #c0392b 25%, var(--border-subtle));
		border-radius: 11px;
		color: #a32c22;
		background: color-mix(in srgb, #c0392b 6%, var(--bg-surface));
		font-size: 0.77rem;
	}
	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 820px) {
		.areas-panel__header {
			align-items: flex-start;
		}
		.areas-table {
			min-width: 760px;
		}
	}
	@media (max-width: 680px) {
		.areas-panel__header {
			gap: 0.8rem;
			padding: 0.9rem;
		}
		.areas-panel__header p:not(.areas-panel__eyebrow) {
			max-width: 34rem;
		}
		.areas-panel__summary small {
			max-width: 6.5rem;
			white-space: normal;
			text-align: right;
		}
		.areas-toolbar {
			align-items: stretch;
			flex-direction: column;
		}
		.areas-search {
			width: 100%;
		}
		.areas-table-wrap {
			border: 0;
			overflow: visible;
			background: transparent;
		}
		.areas-table {
			min-width: 0;
			display: block;
		}
		.areas-table thead {
			display: none;
		}
		.areas-table tbody {
			display: grid;
			gap: 0.6rem;
		}
		.areas-table tr {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			padding: 0.65rem 0.75rem;
			border: 1px solid var(--border-subtle);
			border-radius: 12px;
			background: var(--bg-surface);
		}
		.areas-table td {
			padding: 0.4rem 0;
			border: 0;
		}
		.areas-table tbody tr:hover td {
			background: transparent;
		}
		.areas-table__identity {
			grid-column: 1;
			grid-row: 1;
		}
		.areas-table__current,
		.areas-table__select {
			grid-column: 1 / -1;
		}
		.areas-table__current {
			grid-row: 2;
			padding-top: 0.65rem !important;
			border-top: 1px solid var(--border-subtle) !important;
		}
		.areas-table__select {
			grid-row: 3;
		}
		.areas-table__action {
			grid-column: 2;
			grid-row: 1;
			text-align: right;
		}
		.area-cell-label {
			display: block;
			margin-bottom: 0.28rem;
			color: var(--text-muted);
			font-size: 0.61rem;
			font-weight: 800;
			text-transform: uppercase;
		}
		.areas-empty {
			grid-column: 1 / -1;
		}
	}
</style>
