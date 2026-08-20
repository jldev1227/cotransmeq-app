<!--
	Carcasa del constructor: tres zonas en escritorio (paleta · canvas · inspector)
	y dos drawers sobre el canvas en móvil y tablet.

	Aquí vive el autosave, y con él el manejo de conflicto. La regla es explícita:
	ante `REVISION_CONFLICT` el autosave se DETIENE y se pregunta. Nunca se
	sobrescribe en silencio — otra pestaña (u otra persona) guardó algo, y
	machacarlo perdería trabajo sin dejar rastro.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { formulariosAPI, plantillasFormularioAPI, FormApiError } from '$lib/api/formularios';
	import type { BuilderStore } from '$lib/formularios/builder-store.svelte';
	import { toPreviewSections } from '$lib/formularios/builder-store.svelte';
	import { createRunnerState } from '$lib/formularios/runner-state.svelte';
	import type { FieldTemplateDto, FieldType, ValidationIssue } from '$lib/formularios/types';
	import FieldPalette from './FieldPalette.svelte';
	import SectionCard from './SectionCard.svelte';
	import FieldInspector from './FieldInspector.svelte';
	import FormRenderer from './FormRenderer.svelte';
	import ValidationPanel from './ValidationPanel.svelte';

	interface Props {
		store: BuilderStore;
		/** Código HSEQ, para la cabecera. */
		code: string;
		versionNumber: number;
		onpublished?: () => void;
	}

	let { store, code, versionNumber, onpublished }: Props = $props();

	/// Debounce de 800 ms, el del documento. Suficiente para no disparar un PUT
	/// por cada tecla y corto para que un cierre accidental de pestaña no pierda
	/// más de una frase.
	const AUTOSAVE_MS = 800;

	let plantillas = $state<FieldTemplateDto[]>([]);
	let destinoPaleta = $state<{ sectionId: string; parentFieldId: string | null } | null>(null);
	let vista = $state<'canvas' | 'preview'>('canvas');
	let drawer = $state<'paleta' | 'inspector' | null>(null);
	let publicando = $state(false);

	let timer: ReturnType<typeof setTimeout> | null = null;
	/// Solo un PUT en vuelo: dos guardados simultáneos del mismo borrador chocarían
	/// por `revision` y el segundo se anularía a sí mismo.
	let guardando = false;
	let hayCambiosDurante = false;

	onMount(() => {
		plantillasFormularioAPI
			.listar()
			.then((data) => (plantillas = data))
			.catch(() => {
				/// La biblioteca de plantillas es un extra: si falla, el builder sigue
				/// siendo perfectamente usable con la paleta de tipos.
				plantillas = [];
			});

		const onKey = (e: KeyboardEvent) => {
			const mod = e.metaKey || e.ctrlKey;
			if (!mod) return;
			if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
				e.preventDefault();
				store.undo();
			} else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
				e.preventDefault();
				store.redo();
			} else if (e.key.toLowerCase() === 's') {
				e.preventDefault();
				void guardar();
			}
		};
		window.addEventListener('keydown', onKey);

		/// Aviso al cerrar con cambios pendientes. El autosave es rápido, pero un
		/// cierre a los 200 ms de teclear todavía no ha llegado al servidor.
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (store.saveState === 'dirty' || store.saveState === 'saving') e.preventDefault();
		};
		window.addEventListener('beforeunload', onBeforeUnload);

		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('beforeunload', onBeforeUnload);
			if (timer) clearTimeout(timer);
		};
	});

	/**
	 * Programa el autosave cuando el estado pasa a `dirty`.
	 *
	 * `untrack` alrededor de la programación: sin él, leer `saveState` dentro del
	 * efecto lo volvería a disparar en bucle al cambiarlo a `saving`.
	 */
	$effect(() => {
		const estado = store.saveState;
		if (estado !== 'dirty') return;
		untrack(() => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => void guardar(), AUTOSAVE_MS);
		});
	});

	async function guardar(): Promise<boolean> {
		if (!store.editable) return false;
		if (store.saveState === 'conflict') return false;
		if (guardando) {
			hayCambiosDurante = true;
			return false;
		}

		guardando = true;
		hayCambiosDurante = false;
		store.saveState = 'saving';

		try {
			const { data, meta } = await formulariosAPI.guardarVersion(
				store.formId,
				store.versionId,
				store.serialize() as any
			);
			store.applySaved(data);
			store.issues = [...(meta?.validation?.errors ?? []), ...(meta?.validation?.warnings ?? [])];
			return true;
		} catch (err) {
			if (err instanceof FormApiError && err.code === 'REVISION_CONFLICT') {
				const info = err.details as { expected?: number; actual?: number } | null;
				store.markConflict({ expected: info?.expected ?? 0, actual: info?.actual ?? 0 });
				return false;
			}
			if (err instanceof FormApiError && err.code === 'VERSION_IMMUTABLE') {
				store.saveState = 'error';
				toast.error('Esta versión ya está publicada. Clónala para seguir editando.');
				return false;
			}
			if (err instanceof FormApiError && err.code === 'FORM_DEFINITION_INVALID') {
				/// El servidor devuelve los issues: se pintan sobre las cards en vez de
				/// mostrar un toast genérico que no dice dónde está el problema.
				store.issues = (err.details as any)?.errors ?? [];
				store.saveState = 'error';
				toast.error('Hay errores que impiden guardar. Están marcados en las cards.');
				return false;
			}
			store.saveState = 'error';
			toast.error(err instanceof Error ? err.message : 'No se pudo guardar.');
			return false;
		} finally {
			guardando = false;
			/// Si algo cambió mientras el PUT estaba en vuelo, se reprograma: el
			/// `revision` que acabamos de recibir es el que necesita el siguiente.
			const estadoFinal: string = store.saveState;
			if (hayCambiosDurante && estadoFinal !== 'conflict') store.saveState = 'dirty';
		}
	}

	async function publicar() {
		if (publicando) return;
		/// Se guarda antes de publicar: publicar un borrador con cambios sin
		/// enviar congelaría una versión distinta de la que HSEQ tiene en pantalla.
		if (store.saveState === 'dirty' || store.saveState === 'saving') {
			const ok = await guardar();
			if (!ok) return;
		}

		const errores = store.issues.filter((i) => i.severity === 'error');
		if (errores.length) {
			toast.error(`Corrige ${errores.length} error(es) antes de publicar.`);
			return;
		}
		const avisos = store.issues.filter((i) => i.severity === 'warning');
		const mensaje =
			avisos.length > 0
				? `Hay ${avisos.length} advertencia(s). Publicar congela la versión: después solo se podrá clonar. ¿Continuar?`
				: 'Publicar congela la versión: después solo se podrá clonar. ¿Continuar?';
		if (!confirm(mensaje)) return;

		publicando = true;
		try {
			const { meta } = await formulariosAPI.publicarVersion(store.formId, store.versionId);
			if (meta?.alreadyPublished) toast.info('La versión ya estaba publicada.');
			else toast.success(`Versión ${versionNumber} publicada.`);
			onpublished?.();
		} catch (err) {
			if (err instanceof FormApiError) {
				store.issues = (err.details as any)?.errors ?? store.issues;
				toast.error(err.message);
			} else {
				toast.error('No se pudo publicar.');
			}
		} finally {
			publicando = false;
		}
	}

	async function recargarTrasConflicto() {
		try {
			const version = await formulariosAPI.obtenerVersion(store.formId, store.versionId);
			store.applySaved(version);
			toast.success('Borrador recargado con los cambios de la otra sesión.');
		} catch {
			toast.error('No se pudo recargar el borrador.');
		}
	}

	async function duplicarTrasConflicto() {
		try {
			const nueva = await formulariosAPI.clonarVersion(store.formId, store.versionId);
			toast.success(`Se creó la versión ${nueva.versionNumber} con tus cambios pendientes por rehacer.`);
			window.location.href = `/dashboard/formularios/${store.formId}/editar/${nueva.id}`;
		} catch {
			toast.error('No se pudo duplicar la versión.');
		}
	}

	function abrirPaleta(sectionId: string, parentFieldId: string | null = null) {
		destinoPaleta = { sectionId, parentFieldId };
		drawer = 'paleta';
	}

	function insertar(type: FieldType) {
		const destino = destinoPaleta ?? { sectionId: store.sections[0]?.id, parentFieldId: null };
		if (!destino.sectionId) {
			toast.error('Crea una sección primero.');
			return;
		}
		const creado = store.addField(type, destino.sectionId, destino.parentFieldId);
		if (!creado) {
			toast.error('Ese tipo no se puede agregar en este lugar.');
			return;
		}
		/// El drawer se cierra en móvil para dejar ver la card recién creada; en
		/// escritorio la paleta es una columna fija y no molesta.
		if (window.innerWidth < 1100) drawer = null;
	}

	function insertarPlantilla(plantilla: FieldTemplateDto) {
		const destino = destinoPaleta ?? { sectionId: store.sections[0]?.id, parentFieldId: null };
		if (!destino.sectionId) {
			toast.error('Crea una sección primero.');
			return;
		}
		const creado = store.addFromTemplate(plantilla as any, destino.sectionId, destino.parentFieldId);
		if (!creado) toast.error('Esa plantilla no se puede insertar aquí.');
		else if (window.innerWidth < 1100) drawer = null;
	}

	const issuesPorNodo = $derived(store.issuesByNode());
	const errores = $derived(store.issues.filter((i) => i.severity === 'error'));
	const avisos = $derived(store.issues.filter((i) => i.severity === 'warning'));

	const contenedorActivo = $derived.by(() => {
		if (!destinoPaleta?.parentFieldId) return false;
		return true;
	});

	/// El preview usa el MISMO renderer que el portal, alimentado con un estado de
	/// runner desechable. Es lo que garantiza que lo que HSEQ aprueba es lo que el
	/// conductor verá.
	const previewRunner = $derived.by(() =>
		createRunnerState({ sections: toPreviewSections(store.sections) })
	);

	const etiquetaEstado = $derived.by(() => {
		switch (store.saveState) {
			case 'saving':
				return 'Guardando…';
			case 'saved':
				return 'Guardado';
			case 'dirty':
				return 'Cambios sin guardar';
			case 'conflict':
				return 'Conflicto de versión';
			case 'error':
				return 'Error al guardar';
			default:
				return 'Sin cambios';
		}
	});
</script>

<div class="shell">
	<header class="barra">
		<div class="barra__id">
			<span class="barra__code">{code}</span>
			<span class="barra__ver">v{versionNumber}</span>
			<span class="barra__estado barra__estado--{store.status.toLowerCase()}">{store.status}</span>
		</div>

		<input
			class="barra__titulo"
			value={store.title}
			disabled={!store.editable}
			aria-label="Título de la versión"
			oninput={(e) => store.setHeader({ title: e.currentTarget.value })}
		/>

		<div class="barra__acciones">
			<!-- El estado de guardado lleva texto además de color: es la regla de
			     accesibilidad que aplica todo el módulo. -->
			<span
				class="guardado guardado--{store.saveState}"
				role="status"
				aria-live="polite"
			>
				{etiquetaEstado}
			</span>

			<button
				type="button"
				class="btn"
				disabled={!store.canUndo}
				aria-label="Deshacer"
				onclick={() => store.undo()}
			>
				↶
			</button>
			<button
				type="button"
				class="btn"
				disabled={!store.canRedo}
				aria-label="Rehacer"
				onclick={() => store.redo()}
			>
				↷
			</button>

			<button
				type="button"
				class="btn"
				class:btn--activo={vista === 'preview'}
				onclick={() => (vista = vista === 'preview' ? 'canvas' : 'preview')}
			>
				{vista === 'preview' ? 'Editar' : 'Preview'}
			</button>

			{#if store.editable}
				<button
					type="button"
					class="btn btn--primario"
					disabled={publicando || errores.length > 0}
					onclick={publicar}
				>
					{publicando ? 'Publicando…' : 'Publicar'}
				</button>
			{/if}
		</div>
	</header>

	{#if store.saveState === 'conflict'}
		<!-- Bloqueo explícito. No hay "guardar de todas formas": el conflicto
		     significa que hay trabajo de otra sesión que se perdería. -->
		<div class="conflicto" role="alert">
			<div class="conflicto__texto">
				<p class="conflicto__titulo">Otra sesión guardó este borrador</p>
				<p class="conflicto__cuerpo">
					El autosave está detenido para no sobrescribir su trabajo.
					{#if store.conflictInfo}
						Tú tenías la revisión {store.conflictInfo.expected}; el servidor está en la
						{store.conflictInfo.actual}.
					{/if}
				</p>
			</div>
			<div class="conflicto__acciones">
				<button type="button" class="btn" onclick={recargarTrasConflicto}>
					Recargar (descarta lo mío)
				</button>
				<button type="button" class="btn btn--primario" onclick={duplicarTrasConflicto}>
					Duplicar en versión nueva
				</button>
			</div>
		</div>
	{/if}

	{#if !store.editable}
		<div class="aviso" role="note">
			Esta versión está <strong>{store.status}</strong> y no se puede editar. Clónala desde el resumen
			del formulario para crear un borrador nuevo.
		</div>
	{/if}

	<div class="cuerpo" class:cuerpo--preview={vista === 'preview'}>
		{#if vista === 'canvas'}
			<div class="col col--paleta" class:col--abierta={drawer === 'paleta'}>
				<div class="col__head">
					<span class="col__titulo">Paleta</span>
					<button
						type="button"
						class="col__cerrar"
						aria-label="Cerrar paleta"
						onclick={() => (drawer = null)}
					>
						✕
					</button>
				</div>
				<FieldPalette
					templates={plantillas}
					insideContainer={contenedorActivo}
					disabled={!store.editable}
					onpick={insertar}
					ontemplate={insertarPlantilla}
				/>
			</div>

			<div class="col col--canvas">
				<div class="canvas">
					{#each store.sections as section, i (section.id)}
						<SectionCard
							{section}
							{store}
							issues={issuesPorNodo}
							index={i}
							total={store.sections.length}
							onaddfield={abrirPaleta}
						/>
					{/each}

					{#if store.sections.length === 0}
						<div class="canvas__vacio">
							<p class="canvas__vacio-t">Este formulario todavía no tiene secciones</p>
							<p class="canvas__vacio-d">
								Empieza con una sección (por ejemplo «Información del vehículo») y añade sus campos.
							</p>
						</div>
					{/if}

					{#if store.editable}
						<button type="button" class="canvas__agregar" onclick={() => store.addSection()}>
							+ Agregar sección
						</button>
					{/if}

					<ValidationPanel {errores} {avisos} {store} />
				</div>
			</div>

			<div class="col col--insp" class:col--abierta={drawer === 'inspector'}>
				<div class="col__head">
					<span class="col__titulo">Propiedades</span>
					<button
						type="button"
						class="col__cerrar"
						aria-label="Cerrar propiedades"
						onclick={() => (drawer = null)}
					>
						✕
					</button>
				</div>
				<FieldInspector {store} issues={issuesPorNodo} />
			</div>
		{:else}
			<div class="preview">
				<div class="preview__marco">
					<FormRenderer
						runner={previewRunner}
						title={store.title}
						instructions={store.instructions}
						showErrorSummary={false}
					/>
				</div>
				<p class="preview__nota">
					Preview con el mismo renderer del portal. Las reglas condicionales funcionan; los adjuntos
					no se suben desde aquí.
				</p>
			</div>
		{/if}
	</div>

	{#if vista === 'canvas'}
		<!-- Barra inferior de acceso a los drawers. Solo se ve por debajo de
		     1100 px, donde las columnas laterales no caben. -->
		<nav class="movil" aria-label="Paneles del constructor">
			<button
				type="button"
				class="movil__btn"
				class:movil__btn--activo={drawer === 'paleta'}
				onclick={() => (drawer = drawer === 'paleta' ? null : 'paleta')}
			>
				Paleta
			</button>
			<button
				type="button"
				class="movil__btn"
				class:movil__btn--activo={drawer === 'inspector'}
				onclick={() => (drawer = drawer === 'inspector' ? null : 'inspector')}
			>
				Propiedades
			</button>
		</nav>
	{/if}
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--bg-base, #faf7f2);
	}

	.barra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 0.875rem;
		background: var(--bg-surface, #fff);
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.barra__id {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.barra__code {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-primary, #1a1a1a);
	}

	.barra__ver {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.barra__estado {
		padding: 0.0625rem 0.375rem;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: 999px;
	}

	.barra__estado--draft {
		background: #fffbeb;
		color: #92400e;
	}

	.barra__estado--published {
		background: #f0fdf4;
		color: #166534;
	}

	.barra__estado--archived {
		background: var(--gray-50, #f9fafb);
		color: var(--text-muted, #6b6b6b);
	}

	.barra__titulo {
		flex: 1;
		min-width: 10rem;
		min-height: 38px;
		padding: 0.25rem 0.5rem;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		background: none;
		border: 1px solid transparent;
		border-radius: 8px;
	}

	.barra__titulo:hover:not(:disabled) {
		border-color: var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.barra__titulo:focus-visible {
		outline: none;
		background: #fff;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	.barra__acciones {
		display: flex;
		align-items: center;
		gap: 0.3125rem;
		flex-wrap: wrap;
	}

	.guardado {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.5rem;
		min-height: 32px;
		font-size: 0.6875rem;
		font-weight: 600;
		border-radius: 999px;
		background: var(--gray-50, #f9fafb);
		color: var(--text-muted, #6b6b6b);
	}

	.guardado--saved {
		background: #f0fdf4;
		color: #166534;
	}

	.guardado--dirty,
	.guardado--saving {
		background: #fffbeb;
		color: #92400e;
	}

	.guardado--conflict,
	.guardado--error {
		background: #fef2f2;
		color: #991b1b;
	}

	.btn {
		min-height: 38px;
		min-width: 38px;
		padding: 0 0.6875rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 9px;
		cursor: pointer;
	}

	.btn:hover:not(:disabled) {
		background: var(--gray-50, #f9fafb);
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn--activo {
		background: #fff7ed;
		border-color: #fed7aa;
		color: var(--emerald-700, #047857);
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

	.btn:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.conflicto {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 0.875rem;
		background: #fef2f2;
		border-bottom: 1px solid #fecaca;
	}

	.conflicto__titulo {
		font-size: 0.875rem;
		font-weight: 700;
		color: #991b1b;
	}

	.conflicto__cuerpo {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: #b91c1c;
	}

	.conflicto__acciones {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.aviso {
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: #92400e;
		background: #fffbeb;
		border-bottom: 1px solid #fde68a;
	}

	.cuerpo {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 1fr;
		overflow: hidden;
	}

	@media (min-width: 1100px) {
		.cuerpo:not(.cuerpo--preview) {
			grid-template-columns: 17rem 1fr 21rem;
		}
	}

	.col {
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.col--canvas {
		overflow-y: auto;
		background: var(--bg-base, #faf7f2);
	}

	.col__head {
		display: none;
	}

	/* Por debajo de 1100 px las columnas laterales se convierten en drawers.
	   El canvas ocupa todo el ancho, como pide el documento. */
	@media (max-width: 1099px) {
		.col--paleta,
		.col--insp {
			position: fixed;
			inset: auto 0 3.25rem 0;
			z-index: 40;
			max-height: 72vh;
			transform: translateY(110%);
			transition: transform 200ms var(--ease-apple, ease);
			box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.14);
			border-top-left-radius: 16px;
			border-top-right-radius: 16px;
			overflow: hidden;
		}

		.col--abierta {
			transform: translateY(0);
		}

		.col__head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.625rem 0.75rem;
			border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
			background: var(--bg-surface, #fff);
		}

		.col__titulo {
			font-size: 0.75rem;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: var(--text-muted, #6b6b6b);
		}

		.col__cerrar {
			width: 36px;
			height: 36px;
			display: grid;
			place-items: center;
			font: inherit;
			background: none;
			border: none;
			cursor: pointer;
		}
	}

	@media (min-width: 1100px) {
		.col--paleta {
			border-right: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		}

		.col--insp {
			border-left: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		}
	}

	.canvas {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.875rem;
		max-width: 52rem;
		margin: 0 auto;
		width: 100%;
	}

	.canvas__vacio {
		padding: 2.5rem 1rem;
		text-align: center;
		border: 1px dashed var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 14px;
	}

	.canvas__vacio-t {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary, #4a4a4a);
	}

	.canvas__vacio-d {
		margin-top: 0.3125rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-very-muted, #9a9a9a);
	}

	.canvas__agregar {
		align-self: flex-start;
		min-height: 44px;
		padding: 0 1rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--emerald-700, #047857);
		background: #fff;
		border: 1px dashed #fdba74;
		border-radius: 12px;
		cursor: pointer;
	}

	.preview {
		overflow-y: auto;
		padding: 1rem 0.875rem 3rem;
	}

	.preview__marco {
		max-width: 44rem;
		margin: 0 auto;
	}

	.preview__nota {
		max-width: 44rem;
		margin: 1.25rem auto 0;
		padding: 0.625rem 0.75rem;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-muted, #6b6b6b);
		background: var(--gray-50, #f9fafb);
		border-radius: 10px;
	}

	.movil {
		display: flex;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		background: var(--bg-surface, #fff);
		border-top: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	@media (min-width: 1100px) {
		.movil {
			display: none;
		}
	}

	.movil__btn {
		flex: 1;
		min-height: 44px;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-secondary, #4a4a4a);
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 10px;
		cursor: pointer;
	}

	.movil__btn--activo {
		background: #fff7ed;
		border-color: #fed7aa;
		color: var(--emerald-700, #047857);
	}

	@media (prefers-reduced-motion: reduce) {
		.col--paleta,
		.col--insp {
			transition: none;
		}
	}
</style>
