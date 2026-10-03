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
	import { confirmar } from '$lib/stores/confirm';
	import { toast } from 'svelte-sonner';
	import { Redo2, Undo2, X } from 'lucide-svelte';
	import { formulariosAPI, plantillasFormularioAPI, FormApiError } from '$lib/api/formularios';
	import type { BuilderStore } from '$lib/formularios/builder-store.svelte';
	import { toPreviewSections } from '$lib/formularios/builder-store.svelte';
	import { createRunnerState } from '$lib/formularios/runner-state.svelte';
	import type {
		FieldTemplateDto,
		FieldType,
		ValidationIssue,
		VersionStatus
	} from '$lib/formularios/types';
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
				? `Hay ${avisos.length} advertencia(s). Publicar congela la versión: después solo se podrá clonar.`
				: 'Publicar congela la versión: después solo se podrá clonar.';
		const ok = await confirmar({
			title: '¿Publicar esta versión?',
			message: mensaje,
			tone: 'warning',
			confirmText: 'Publicar'
		});
		if (!ok) return;

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
			toast.success(
				`Se creó la versión ${nueva.versionNumber} con tus cambios pendientes por rehacer.`
			);
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
		const creado = store.addFromTemplate(
			plantilla as any,
			destino.sectionId,
			destino.parentFieldId
		);
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

	const ESTADO_VERSION: Record<VersionStatus, string> = {
		DRAFT: 'Borrador',
		PUBLISHED: 'Publicada',
		ARCHIVED: 'Archivada'
	};

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
			<span class="chip chip--{store.status.toLowerCase()}">
				{ESTADO_VERSION[store.status as VersionStatus] ?? store.status}
			</span>
		</div>

		<!-- En lectura el título es texto y no un input: un input no parte
		     renglones, y en móvil un título largo quedaba en «…microbuses, b…». -->
		{#if store.editable}
			<input
				class="barra__titulo"
				value={store.title}
				disabled={!store.editable}
				aria-label="Título de la versión"
				oninput={(e) => store.setHeader({ title: e.currentTarget.value })}
			/>
		{:else}
			<h1 class="barra__titulo barra__titulo--leer">{store.title}</h1>
		{/if}

		<div class="barra__acciones">
			<!-- El estado de guardado lleva texto además de color: es la regla de
			     accesibilidad que aplica todo el módulo. -->
			<span class="guardado guardado--{store.saveState}" role="status" aria-live="polite">
				{etiquetaEstado}
			</span>

			{#if store.editable}
				<button
					type="button"
					class="icono"
					disabled={!store.canUndo}
					aria-label="Deshacer"
					title="Deshacer (Ctrl+Z)"
					onclick={() => store.undo()}
				>
					<Undo2 size={16} strokeWidth={2.25} />
				</button>
				<button
					type="button"
					class="icono"
					disabled={!store.canRedo}
					aria-label="Rehacer"
					title="Rehacer (Ctrl+Shift+Z)"
					onclick={() => store.redo()}
				>
					<Redo2 size={16} strokeWidth={2.25} />
				</button>
			{/if}

			<button
				type="button"
				class="btn-secondary acc"
				class:acc--activo={vista === 'preview'}
				aria-pressed={vista === 'preview'}
				onclick={() => (vista = vista === 'preview' ? 'canvas' : 'preview')}
			>
				{vista === 'preview' ? 'Editar' : 'Vista previa'}
			</button>

			{#if store.editable}
				<button
					type="button"
					class="btn-primary acc"
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
				<button type="button" class="btn-secondary acc" onclick={recargarTrasConflicto}>
					Recargar (descarta lo mío)
				</button>
				<button type="button" class="btn-primary acc" onclick={duplicarTrasConflicto}>
					Duplicar en versión nueva
				</button>
			</div>
		</div>
	{/if}

	{#if !store.editable}
		<div class="aviso" role="note">
			Esta versión está <strong
				>{(ESTADO_VERSION[store.status as VersionStatus] ?? store.status).toLowerCase()}</strong
			> y no se puede editar. Clónala desde el resumen del formulario para crear un borrador nuevo.
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
						<X size={18} strokeWidth={2.25} />
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
						<X size={18} strokeWidth={2.25} />
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
					Vista previa con el mismo renderer del portal. Las reglas condicionales funcionan; los
					adjuntos no se suben desde aquí.
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
	/* Lenguaje de la app móvil: fondo claro de la marca, superficies blancas,
	   chips de estado en tinte suave y botones de la app. Colores de marca solo
	   por variables del tema. */
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--bg-base);
		font-variant-numeric: tabular-nums;
	}

	/* ─── Barra superior ─────────────────────────────────────────────────── */
	.barra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-subtle);
	}

	.barra__id {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.barra__code {
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: var(--color-emerald-900);
		background: var(--color-emerald-100);
		border-radius: 999px;
		white-space: nowrap;
	}

	.barra__ver {
		display: inline-grid;
		place-items: center;
		min-width: 2rem;
		height: 1.5rem;
		padding: 0 0.4375rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: #fff;
		background: var(--bg-charcoal-deep);
		border-radius: 8px;
	}

	.chip {
		padding: 0.125rem 0.5625rem;
		font-size: 0.75rem;
		font-weight: 700;
		border-radius: 999px;
		white-space: nowrap;
	}

	.chip--draft {
		background: #fef3c7;
		color: #92400e;
	}

	.chip--published {
		background: var(--color-emerald-100);
		color: var(--color-emerald-900);
	}

	.chip--archived {
		background: #f3f4f6;
		color: #374151;
	}

	.barra__titulo {
		flex: 1 1 16rem;
		min-width: 0;
		min-height: 40px;
		padding: 0.25rem 0.5rem;
		font: inherit;
		font-size: 1rem;
		font-weight: 800;
		color: var(--text-primary);
		text-overflow: ellipsis;
		background: none;
		border: 1px solid transparent;
		border-radius: 10px;
	}

	.barra__titulo--leer {
		margin: 0;
		min-height: 0;
		padding: 0.25rem 0.5rem;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}

	.barra__titulo:hover:not(:disabled) {
		border-color: var(--border-subtle);
	}

	.barra__titulo:focus-visible {
		outline: none;
		background: var(--bg-surface);
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}

	.barra__acciones {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.guardado {
		display: inline-flex;
		align-items: center;
		min-height: 30px;
		padding: 0 0.625rem;
		font-size: 0.75rem;
		font-weight: 700;
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-muted);
		white-space: nowrap;
	}

	.guardado--saved {
		background: var(--color-emerald-100);
		color: var(--color-emerald-900);
	}

	.guardado--dirty,
	.guardado--saving {
		background: #fef3c7;
		color: #92400e;
	}

	.guardado--conflict,
	.guardado--error {
		background: #fee2e2;
		color: #991b1b;
	}

	.icono {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		color: var(--text-secondary);
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		cursor: pointer;
	}

	.icono:hover:not(:disabled) {
		background: var(--bg-base);
	}

	.icono:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.icono:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}

	/* Botones compactos de la app. */
	.acc {
		min-height: 36px;
		padding: 0 0.875rem;
		border-radius: 12px;
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	.btn-secondary.acc {
		border-width: 1px;
	}

	.acc--activo {
		color: var(--color-emerald-900);
		background: var(--color-emerald-100);
		border-color: transparent;
	}

	/* Móvil: código y estado arriba, el título en su propio renglón y las
	   acciones debajo, todas del mismo alto. */
	@media (max-width: 720px) {
		.barra {
			padding: 0.75rem;
		}

		.barra__titulo {
			order: 1;
			flex-basis: 100%;
			margin-inline: -0.25rem;
		}

		.barra__acciones {
			order: 2;
			width: 100%;
		}

		.barra__acciones .acc {
			flex: 1 1 auto;
		}
	}

	/* ─── Avisos ─────────────────────────────────────────────────────────── */
	.conflicto {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin: 0.75rem 1rem 0;
		padding: 0.875rem 1rem;
		background: #fef3f2;
		border: 1px solid #fecaca;
		border-radius: 16px;
	}

	.conflicto__titulo {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 800;
		color: #991b1b;
	}

	.conflicto__cuerpo {
		margin: 0.125rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: #b42318;
	}

	.conflicto__acciones {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.aviso {
		margin: 0.75rem 1rem 0;
		padding: 0.75rem 1rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: #92400e;
		background: #fef3c7;
		border-radius: 14px;
	}

	.aviso strong {
		font-weight: 800;
	}

	/* ─── Cuerpo de tres columnas ────────────────────────────────────────── */
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
		background: var(--bg-surface);
	}

	.col--canvas {
		overflow-y: auto;
		background: var(--bg-base);
	}

	.col__head {
		display: none;
	}

	/* Por debajo de 1100 px las columnas laterales se convierten en hojas
	   inferiores, como las de la app. Cerradas se esconden del todo (fuera de
	   pantalla y sin foco): antes asomaba la cabecera «Propiedades» por encima
	   de la barra inferior cuando el panel era más bajo que el desplazamiento. */
	@media (max-width: 1099px) {
		.col--paleta,
		.col--insp {
			position: fixed;
			inset: auto 0 calc(3.75rem + env(safe-area-inset-bottom, 0px)) 0;
			z-index: 40;
			max-height: 72vh;
			transform: translateY(calc(100% + 5rem));
			visibility: hidden;
			transition:
				transform 220ms var(--ease-apple, ease),
				visibility 0s linear 220ms;
			box-shadow: 0 -12px 32px rgba(1, 67, 57, 0.16);
			border-top-left-radius: 22px;
			border-top-right-radius: 22px;
			overflow: hidden;
		}

		.col--abierta {
			transform: translateY(0);
			visibility: visible;
			transition:
				transform 220ms var(--ease-apple, ease),
				visibility 0s;
		}

		.col__head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.75rem 0.75rem 0.625rem 1rem;
			border-bottom: 1px solid var(--border-subtle);
			background: var(--bg-surface);
		}

		.col__titulo {
			font-size: 0.9375rem;
			font-weight: 800;
			color: var(--text-primary);
		}

		.col__cerrar {
			width: 36px;
			height: 36px;
			display: grid;
			place-items: center;
			color: var(--text-secondary);
			background: var(--bg-base);
			border: none;
			border-radius: 999px;
			cursor: pointer;
		}
	}

	@media (min-width: 1100px) {
		.col--paleta {
			border-right: 1px solid var(--border-subtle);
		}

		.col--insp {
			border-left: 1px solid var(--border-subtle);
		}
	}

	.canvas {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1rem;
		width: 100%;
	}

	.canvas__vacio {
		padding: 2.5rem 1rem;
		text-align: center;
		background: var(--bg-surface);
		border-radius: 18px;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}

	.canvas__vacio-t {
		margin: 0;
		font-size: 1rem;
		font-weight: 800;
		color: var(--text-primary);
	}

	.canvas__vacio-d {
		margin: 0.3125rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.canvas__agregar {
		align-self: flex-start;
		min-height: 44px;
		padding: 0 1.125rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 800;
		color: var(--accion);
		background: var(--bg-surface);
		border: 1.5px dashed color-mix(in srgb, var(--accion) 45%, transparent);
		border-radius: 16px;
		cursor: pointer;
	}

	.canvas__agregar:hover {
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
	}

	.canvas__agregar:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}

	@media (max-width: 720px) {
		.canvas {
			padding: 0.75rem;
		}

		.canvas__agregar {
			align-self: stretch;
		}
	}

	.preview {
		overflow-y: auto;
		padding: 1rem 0.875rem 3rem;
	}

	/* El marco del preview NO se acota: replica el ancho real que tendrá el
	   formulario en el dashboard, y acotarlo mentía sobre cómo se ve. */
	.preview__marco {
		width: 100%;
	}

	.preview__nota {
		max-width: 44rem;
		margin: 1.25rem auto 0;
		padding: 0.75rem 1rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-muted);
		background: var(--bg-surface);
		border-radius: 14px;
	}

	/* ─── Barra inferior (móvil y tablet) ────────────────────────────────── */
	.movil {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem calc(0.5rem + env(safe-area-inset-bottom, 0px));
		background: var(--bg-surface);
		border-top: 1px solid var(--border-subtle);
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
		font-size: 0.875rem;
		font-weight: 800;
		color: var(--text-secondary);
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		cursor: pointer;
	}

	.movil__btn--activo {
		color: var(--color-emerald-900);
		background: var(--color-emerald-100);
		border-color: transparent;
	}

	.movil__btn:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.col--paleta,
		.col--insp {
			transition: none;
		}
	}
</style>
