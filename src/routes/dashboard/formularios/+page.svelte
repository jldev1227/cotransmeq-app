<!--
	Catálogo de formularios dinámicos.

	Muestra, por formulario, su versión publicada Y su borrador. Las dos a la vez
	porque son estados independientes: se puede estar editando la v3 mientras los
	conductores siguen diligenciando la v2, y ocultar una de las dos haría creer que
	un cambio ya está en la calle cuando no lo está.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { formulariosAPI, FormApiError } from '$lib/api/formularios';
	import type { FormDefinitionDto } from '$lib/formularios/types';

	let formularios = $state<FormDefinitionDto[]>([]);
	let cargando = $state(true);
	let busqueda = $state('');
	let incluirArchivados = $state(false);
	let page = $state(1);
	let totalPages = $state(1);
	let total = $state(0);

	let modalCrear = $state(false);
	let creando = $state(false);
	let nuevoCode = $state('');
	let nuevoNombre = $state('');
	let nuevoDescripcion = $state('');

	/// Debounce de la búsqueda: teclear "preoperacional" son 15 peticiones sin él.
	let timerBusqueda: ReturnType<typeof setTimeout> | null = null;

	async function cargar() {
		cargando = true;
		try {
			const { data, meta } = await formulariosAPI.listar({
				page,
				limit: 20,
				search: busqueda.trim() || undefined,
				includeDeleted: incluirArchivados || undefined
			});
			formularios = data;
			total = meta.total ?? 0;
			totalPages = meta.totalPages ?? 1;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo cargar el catálogo.');
		} finally {
			cargando = false;
		}
	}

	onMount(cargar);

	function onBuscar(valor: string) {
		busqueda = valor;
		page = 1;
		if (timerBusqueda) clearTimeout(timerBusqueda);
		timerBusqueda = setTimeout(cargar, 350);
	}

	/// El slug se deriva del nombre; el código lo escribe HSEQ porque es
	/// documental (`HSEQ-FR-08`) y no se puede inventar.
	const slugPropuesto = $derived(
		nuevoNombre
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
	);

	async function crear() {
		if (!nuevoCode.trim() || !nuevoNombre.trim()) {
			toast.error('El código y el nombre son obligatorios.');
			return;
		}
		creando = true;
		try {
			const creado = await formulariosAPI.crear({
				code: nuevoCode.trim(),
				name: nuevoNombre.trim(),
				description: nuevoDescripcion.trim() || null
			});
			toast.success(`${creado.code} creado. Se abrió su borrador v1.`);
			const draft = creado.draftVersion;
			if (draft) await goto(`/dashboard/formularios/${creado.id}/editar/${draft.id}`);
			else await goto(`/dashboard/formularios/${creado.id}`);
		} catch (err) {
			if (err instanceof FormApiError && err.code === 'FORM_CODE_TAKEN') {
				toast.error(err.message);
			} else {
				toast.error(err instanceof Error ? err.message : 'No se pudo crear el formulario.');
			}
		} finally {
			creando = false;
		}
	}

	async function archivar(form: FormDefinitionDto) {
		if (
			!confirm(
				`Archivar «${form.code} — ${form.name}»? Los envíos históricos se conservan y el formulario deja de aparecer en el catálogo.`
			)
		)
			return;
		try {
			await formulariosAPI.archivar(form.id);
			toast.success('Formulario archivado.');
			await cargar();
		} catch (err) {
			if (err instanceof FormApiError && err.code === 'FORM_HAS_ACTIVE_ASSIGNMENTS') {
				toast.error(err.message);
			} else {
				toast.error('No se pudo archivar.');
			}
		}
	}

	async function restaurar(form: FormDefinitionDto) {
		try {
			await formulariosAPI.restaurar(form.id);
			toast.success('Formulario restaurado.');
			await cargar();
		} catch {
			toast.error('No se pudo restaurar.');
		}
	}

	function fecha(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
	}
</script>

<svelte:head><title>Formularios · Transmeralda</title></svelte:head>

<div class="pagina">
	<header class="cabecera">
		<div>
			<h1 class="cabecera__titulo">Formularios dinámicos</h1>
			<p class="cabecera__sub">
				Constructor de formatos HSEQ, asignaciones y envíos de los conductores.
			</p>
		</div>
		<div class="cabecera__acciones">
			<a class="btn" href="/dashboard/formularios/asignaciones">Asignaciones</a>
			<a class="btn" href="/dashboard/formularios/envios">Envíos</a>
			<button type="button" class="btn btn--primario" onclick={() => (modalCrear = true)}>
				+ Nuevo formulario
			</button>
		</div>
	</header>

	<div class="filtros">
		<label class="filtros__buscar">
			<span class="sr-only">Buscar formulario</span>
			<input
				type="search"
				class="input"
				placeholder="Buscar por código, nombre o descripción…"
				value={busqueda}
				oninput={(e) => onBuscar(e.currentTarget.value)}
			/>
		</label>
		<label class="filtros__check">
			<input
				type="checkbox"
				checked={incluirArchivados}
				onchange={(e) => {
					incluirArchivados = e.currentTarget.checked;
					page = 1;
					void cargar();
				}}
			/>
			Ver archivados
		</label>
		<span class="filtros__total">{total} formulario{total === 1 ? '' : 's'}</span>
	</div>

	{#if cargando}
		<div class="skeleton" aria-busy="true" aria-live="polite">Cargando catálogo…</div>
	{:else if formularios.length === 0}
		<div class="vacio">
			<p class="vacio__t">
				{busqueda ? `Sin resultados para «${busqueda}»` : 'Todavía no hay formularios'}
			</p>
			<p class="vacio__d">
				Crea el primero con su código HSEQ. Se abrirá un borrador v1 listo para construir.
			</p>
		</div>
	{:else}
		<ul class="lista">
			{#each formularios as form (form.id)}
				<li class="tarjeta" class:tarjeta--archivada={form.deletedAt}>
					<div class="tarjeta__id">
						<span class="tarjeta__code">{form.code}</span>
						{#if form.deletedAt}
							<span class="pill pill--archivada">Archivado</span>
						{/if}
					</div>

					<div class="tarjeta__cuerpo">
						<a class="tarjeta__nombre" href={`/dashboard/formularios/${form.id}`}>{form.name}</a>
						{#if form.description}
							<p class="tarjeta__desc">{form.description}</p>
						{/if}
						<p class="tarjeta__meta">
							Actualizado {fecha(form.updatedAt)}
							{#if form.counts}
								· {form.counts.assignments} asignación{form.counts.assignments === 1 ? '' : 'es'}
								· {form.counts.submissions} envío{form.counts.submissions === 1 ? '' : 's'}
							{/if}
						</p>
					</div>

					<div class="tarjeta__versiones">
						{#if form.activeVersion}
							<a
								class="pill pill--pub"
								href={`/dashboard/formularios/${form.id}/preview/${form.activeVersion.id}`}
							>
								Publicada v{form.activeVersion.versionNumber}
							</a>
						{:else}
							<span class="pill pill--sin">Sin publicar</span>
						{/if}

						{#if form.draftVersion}
							<a
								class="pill pill--draft"
								href={`/dashboard/formularios/${form.id}/editar/${form.draftVersion.id}`}
							>
								Borrador v{form.draftVersion.versionNumber}
							</a>
						{/if}
					</div>

					<div class="tarjeta__acciones">
						{#if form.deletedAt}
							<button type="button" class="btn btn--mini" onclick={() => restaurar(form)}>
								Restaurar
							</button>
						{:else}
							<a class="btn btn--mini" href={`/dashboard/formularios/${form.id}`}>Abrir</a>
							<button type="button" class="btn btn--mini btn--peligro" onclick={() => archivar(form)}>
								Archivar
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		{#if totalPages > 1}
			<nav class="paginacion" aria-label="Paginación del catálogo">
				<button
					type="button"
					class="btn btn--mini"
					disabled={page <= 1}
					onclick={() => {
						page -= 1;
						void cargar();
					}}
				>
					Anterior
				</button>
				<span class="paginacion__estado">Página {page} de {totalPages}</span>
				<button
					type="button"
					class="btn btn--mini"
					disabled={page >= totalPages}
					onclick={() => {
						page += 1;
						void cargar();
					}}
				>
					Siguiente
				</button>
			</nav>
		{/if}
	{/if}
</div>

{#if modalCrear}
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="crear-titulo"
		tabindex="-1"
		onkeydown={(e) => {
			if (e.key === 'Escape') modalCrear = false;
		}}
	>
		<div class="modal__caja">
			<h2 class="modal__titulo" id="crear-titulo">Nuevo formulario</h2>

			<label class="campo">
				<span class="campo__label">Código HSEQ</span>
				<input
					class="input input--mono"
					placeholder="HSEQ-FR-08"
					bind:value={nuevoCode}
					autocomplete="off"
				/>
				<span class="campo__hint">Es el código documental. Debe ser único.</span>
			</label>

			<label class="campo">
				<span class="campo__label">Nombre</span>
				<input
					class="input"
					placeholder="Preoperacional de camionetas"
					bind:value={nuevoNombre}
					autocomplete="off"
				/>
				{#if slugPropuesto}
					<span class="campo__hint">Slug: <code>{slugPropuesto}</code></span>
				{/if}
			</label>

			<label class="campo">
				<span class="campo__label">Descripción (opcional)</span>
				<textarea class="input input--area" rows="2" bind:value={nuevoDescripcion}></textarea>
			</label>

			<div class="modal__acciones">
				<button type="button" class="btn" onclick={() => (modalCrear = false)}>Cancelar</button>
				<button type="button" class="btn btn--primario" disabled={creando} onclick={crear}>
					{creando ? 'Creando…' : 'Crear y construir'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem 1rem 3rem;
		max-width: 72rem;
		margin: 0 auto;
	}

	.cabecera {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.875rem;
	}

	.cabecera__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.cabecera__sub {
		margin-top: 0.1875rem;
		font-size: 0.875rem;
		color: var(--text-muted, #6b6b6b);
	}

	.cabecera__acciones {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.filtros {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.filtros__buscar {
		flex: 1;
		min-width: 14rem;
	}

	.filtros__check {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--text-secondary, #4a4a4a);
	}

	.filtros__check input {
		width: 18px;
		height: 18px;
		accent-color: var(--emerald-600, #059669);
	}

	.filtros__total {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.input {
		width: 100%;
		min-height: 44px;
		padding: 0.4375rem 0.75rem;
		font: inherit;
		font-size: 0.875rem;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
	}

	.input--mono {
		font-family: var(--font-mono, monospace);
	}

	.input--area {
		min-height: 4rem;
		resize: vertical;
	}

	.input:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	.lista {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		list-style: none;
	}

	.tarjeta {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
		box-shadow: var(--shadow-card, 0 4px 24px rgba(0, 0, 0, 0.04));
	}

	@media (min-width: 900px) {
		.tarjeta {
			grid-template-columns: 7rem 1fr auto auto;
			align-items: center;
			gap: 0.875rem;
		}
	}

	.tarjeta--archivada {
		opacity: 0.72;
		background: var(--gray-50, #f9fafb);
	}

	.tarjeta__id {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.tarjeta__code {
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, #1a1a1a);
	}

	.tarjeta__cuerpo {
		min-width: 0;
	}

	.tarjeta__nombre {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		text-decoration: none;
	}

	.tarjeta__nombre:hover {
		text-decoration: underline;
	}

	.tarjeta__desc {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		color: var(--text-muted, #6b6b6b);
		line-height: 1.4;
	}

	.tarjeta__meta {
		margin-top: 0.25rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.tarjeta__versiones {
		display: flex;
		gap: 0.3125rem;
		flex-wrap: wrap;
	}

	.pill {
		padding: 0.1875rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 600;
		border-radius: 999px;
		text-decoration: none;
		white-space: nowrap;
	}

	.pill--pub {
		background: #f0fdf4;
		color: #166534;
		border: 1px solid #bbf7d0;
	}

	.pill--draft {
		background: #fffbeb;
		color: #92400e;
		border: 1px solid #fde68a;
	}

	.pill--sin,
	.pill--archivada {
		background: var(--gray-50, #f9fafb);
		color: var(--text-muted, #6b6b6b);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.tarjeta__acciones {
		display: flex;
		gap: 0.3125rem;
		flex-wrap: wrap;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
		cursor: pointer;
		text-decoration: none;
	}

	.btn--mini {
		min-height: 36px;
		padding: 0 0.625rem;
		font-size: 0.8125rem;
	}

	.btn:hover:not(:disabled) {
		background: var(--gray-50, #f9fafb);
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.btn--primario {
		color: #fff;
		background: var(--emerald-600, #059669);
		border-color: var(--emerald-600, #059669);
		font-weight: 600;
	}

	.btn--primario:hover:not(:disabled) {
		background: var(--emerald-700, #047857);
	}

	.btn--peligro {
		color: #b91c1c;
	}

	.btn--peligro:hover:not(:disabled) {
		background: #fef2f2;
		border-color: #fecaca;
	}

	.skeleton,
	.vacio {
		padding: 2.5rem 1rem;
		text-align: center;
		background: var(--bg-surface, #fff);
		border: 1px dashed var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 14px;
		color: var(--text-muted, #6b6b6b);
	}

	.vacio__t {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary, #4a4a4a);
	}

	.vacio__d {
		margin-top: 0.3125rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-very-muted, #9a9a9a);
	}

	.paginacion {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
	}

	.paginacion__estado {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
	}

	.modal {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(15, 31, 26, 0.45);
	}

	.modal__caja {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		max-width: 26rem;
		padding: 1.125rem;
		background: var(--bg-surface, #fff);
		border-radius: 16px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
	}

	.modal__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.125rem;
		font-weight: 600;
	}

	.modal__acciones {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.campo {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
	}

	.campo__label {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.campo__hint {
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.campo__hint code {
		font-family: var(--font-mono, monospace);
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
