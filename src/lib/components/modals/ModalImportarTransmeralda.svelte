<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import {
		ArrowRight,
		Building2,
		CircleAlert,
		Download,
		FileSearch,
		Search,
		X
	} from 'lucide-svelte';
	import { recargosApi } from '$lib/api/recargos';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

	export let isOpen = false;
	export let mes: number;
	export let año: number;

	const dispatch = createEventDispatcher<{
		imported: {
			importadas: number;
			omitidas: number;
			errores: number;
			vehiculos_creados: number;
			empresas_creadas: number;
			/**
			 * Id del job bulk de recálculo que arrancó el server en
			 * background. El page lo usa para alimentar el
			 * `bulkRecalcStore` y mostrar la barra de progreso global.
			 * `null` si no se importó nada.
			 */
			recalculoBatchId: string | null;
			/**
			 * Ids de las planillas recién creadas. El page las pasa al
			 * `bulkRecalcStore.iniciar(ids)` para que la UI sepa qué
			 * filas están bloqueadas mientras se recalculan.
			 */
			newRecargoIds: string[];
		};
		cancel: void;
	}>();

	// Estado
	let loadingPreview = false;
	let importing = false;
	let creatingEntities = false;
	let preview: {
		mes: number;
		año: number;
		total: number;
		importables: number;
		ya_importadas: number;
		no_importables: number;
		filtradas_por_conductor_inactivo: number;
		vehiculos_a_crear: number;
		empresas_a_crear: number;
		incluir_no_importables: boolean;
		planillas: any[];
	} | null = null;
	let errorMsg: string | null = null;
	let selectedIds = new Set<string>();
	let mostrarNoImportables = false;
	/** Texto del buscador. Filtra solo lo que se VE, nunca lo seleccionado. */
	let busqueda = '';

	$: if (isOpen) {
		selectedIds = new Set();
		preview = null;
		errorMsg = null;
		busqueda = '';
		mostrarNoImportables = false;
		void cargarPreview();
	}

	async function cargarPreview() {
		loadingPreview = true;
		errorMsg = null;
		try {
			preview = await recargosApi.previewImportarTransmeralda(mes, año, mostrarNoImportables);
			// Auto-seleccionar todas las importables nuevas
			selectedIds = new Set(
				preview.planillas
					.filter((p) => !p.ya_importado && p.motivo_no_importable === null)
					.map((p) => p.source_id)
			);
		} catch (err: any) {
			console.error('Error en preview importar transmeralda:', err);
			errorMsg =
				err?.response?.data?.message ||
				err?.message ||
				'No se pudo obtener la vista previa de Transmeralda';
		} finally {
			loadingPreview = false;
		}
	}

	async function crearEntidadesFaltantes() {
		if (!preview) return;
		creatingEntities = true;
		errorMsg = null;
		try {
			const result = await recargosApi.crearEntidadesFaltantesTransmeralda(
				preview.mes,
				preview.año
			);
			const total = (result.vehiculos_creados || 0) + (result.empresas_creadas || 0);
			if (total === 0) {
				toast.info('No hay entidades nuevas para crear');
			} else {
				toast.success(
					`${result.vehiculos_creados} vehículo(s) y ${result.empresas_creadas} empresa(s) creados en Cotransmeq`
				);
			}
			// Re-cargar preview para reflejar los cambios
			await cargarPreview();
		} catch (err: any) {
			errorMsg = err?.response?.data?.message || err?.message || 'No se pudo crear las entidades';
		} finally {
			creatingEntities = false;
		}
	}

	function toggleSelect(sourceId: string) {
		if (selectedIds.has(sourceId)) {
			selectedIds.delete(sourceId);
		} else {
			selectedIds.add(sourceId);
		}
		selectedIds = selectedIds;
	}

	/**
	 * Marca o desmarca las importables VISIBLES, sin tocar el resto.
	 *
	 * Antes reemplazaba la selección entera. Con un buscador eso sería una
	 * trampa: filtras, pulsas «seleccionar todo» y pierdes en silencio lo que
	 * habías marcado con el filtro anterior. Ahora suma y resta sobre lo que
	 * se ve, y lo elegido bajo otra búsqueda sigue ahí.
	 */
	function toggleSelectAll() {
		if (!preview) return;
		const proximo = new Set(selectedIds);
		if (todasVisiblesSeleccionadas) {
			for (const p of importablesVisibles) proximo.delete(p.source_id);
		} else {
			for (const p of importablesVisibles) proximo.add(p.source_id);
		}
		selectedIds = proximo;
	}

	/**
	 * Normaliza para buscar: sin tildes, sin mayúsculas y sin puntuación.
	 *
	 * Las placas se teclean «QLR-098» y se guardan «QLR098»; las cédulas llevan
	 * puntos; y nadie escribe «SALDAÑA» con la eñe correcta a la primera. Sin
	 * esto, el buscador falla justo en los casos en que más se usa.
	 */
	const normalizar = (s: unknown) =>
		String(s ?? '')
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]/g, '');

	/** Los campos por los que tiene sentido buscar una planilla. */
	const textoDe = (p: any) =>
		normalizar(
			[
				p.conductor_nombre,
				p.conductor_identificacion,
				p.vehiculo_placa,
				p.numero_planilla,
				p.empresa_nombre
			].join(' ')
		);

	$: terminos = normalizar(busqueda);
	$: planillasFiltradas = !preview
		? []
		: terminos
			? preview.planillas.filter((p) => textoDe(p).includes(terminos))
			: preview.planillas;

	/**
	 * Importables DE LO QUE SE VE. Es lo que gobierna la casilla de cabecera:
	 * con un filtro puesto, «seleccionar todo» tiene que significar «todo esto»
	 * y no «las 200 de debajo que no estoy mirando».
	 */
	$: importablesVisibles = planillasFiltradas.filter(
		(p) => !p.ya_importado && p.motivo_no_importable === null
	);
	$: todasVisiblesSeleccionadas =
		importablesVisibles.length > 0 &&
		importablesVisibles.every((p) => selectedIds.has(p.source_id));

	$: importablesCount =
		preview?.planillas.filter((p) => !p.ya_importado && p.motivo_no_importable === null).length ??
		0;

	$: haySeleccion = selectedIds.size > 0;

	async function ejecutarImportacion() {
		if (!haySeleccion) return;
		importing = true;
		errorMsg = null;
		try {
			const sourceIds = Array.from(selectedIds);
			const result = await recargosApi.importarDesdeTransmeralda(sourceIds);
			const newRecargoIds = (result.detalle?.importadas || []).map((d) => d.new_id);
			dispatch('imported', {
				importadas: result.importadas,
				omitidas: result.omitidas,
				errores: result.errores,
				vehiculos_creados: result.vehiculos_creados,
				empresas_creadas: result.empresas_creadas,
				recalculoBatchId: result.recalculoBatchId,
				newRecargoIds
			});
			isOpen = false;
		} catch (err: any) {
			errorMsg =
				err?.response?.data?.message || err?.message || 'No se pudo ejecutar la importación';
		} finally {
			importing = false;
		}
	}

	function handleCancel() {
		if (importing) return;
		dispatch('cancel');
		isOpen = false;
	}

	/**
	 * Escape en el buscador con texto lo limpia y no llega al modal; vacío,
	 * sigue hasta `ModalBase`, que cierra.
	 */
	function onBuscarKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && busqueda) {
			event.preventDefault();
			event.stopPropagation();
			busqueda = '';
		}
	}

	const meses = [
		'',
		'Enero',
		'Febrero',
		'Marzo',
		'Abril',
		'Mayo',
		'Junio',
		'Julio',
		'Agosto',
		'Septiembre',
		'Octubre',
		'Noviembre',
		'Diciembre'
	];
</script>

<ModalBase
	open={isOpen}
	eyebrow="Importar · Transmeralda → Cotransmeq"
	title="Planillas de {meses[mes]} {año}"
	subtitle={preview
		? `${preview.total} planilla${preview.total === 1 ? '' : 's'} en origen · ${preview.importables} disponible${preview.importables === 1 ? '' : 's'} para importar`
		: 'Buscando planillas en Transmeralda…'}
	tamano="xl"
	bloqueado={importing || creatingEntities}
	oncerrar={handleCancel}
>
	{#if errorMsg}
		<div class="it-error" role="alert">
			<CircleAlert size={18} strokeWidth={2} />
			<div>
				<strong>Error</strong>
				<p>{errorMsg}</p>
			</div>
		</div>
	{/if}

	{#if loadingPreview}
		<div class="it-estado" aria-live="polite">
			<span class="it-spinner" aria-hidden="true"></span>
			<p>Buscando planillas en Transmeralda…</p>
		</div>
	{:else if preview}
		<!-- Resumen del preview -->
		<section class="it-seccion">
			<h3 class="it-titulo">Resumen</h3>
			<div class="it-resumen">
				<div class="it-stat">
					<span class="it-stat-label">Nuevas</span>
					<span class="it-stat-valor it-stat-valor--marca">{preview.importables}</span>
					<span class="it-stat-nota">Listas para importar</span>
				</div>
				<div class="it-stat">
					<span class="it-stat-label">Ya importadas</span>
					<span class="it-stat-valor">{preview.ya_importadas}</span>
					<span class="it-stat-nota">Duplicados bloqueados</span>
				</div>
				<div class="it-stat">
					<span class="it-stat-label">No importables</span>
					<span class="it-stat-valor" class:it-stat-valor--alerta={preview.no_importables > 0}>
						{preview.no_importables}
					</span>
					<span class="it-stat-nota">Requieren revisión</span>
				</div>
				<div class="it-stat">
					<span class="it-stat-label">A crear</span>
					<span
						class="it-stat-valor"
						class:it-stat-valor--crear={preview.vehiculos_a_crear + preview.empresas_a_crear > 0}
					>
						{preview.vehiculos_a_crear + preview.empresas_a_crear}
					</span>
					<span class="it-stat-nota">
						{preview.vehiculos_a_crear} placas · {preview.empresas_a_crear} empresas
					</span>
				</div>
			</div>
		</section>

		<section class="it-seccion">
			<div class="it-titulo-fila">
				<div>
					<h3 class="it-titulo">Planillas</h3>
					<p class="it-nota">
						{#if busqueda}
							{planillasFiltradas.length} de {preview.planillas.length} coinciden con la búsqueda
						{:else}
							Marca las que quieres traer a Cotransmeq
						{/if}
					</p>
				</div>
				{#if preview.vehiculos_a_crear > 0 || preview.empresas_a_crear > 0}
					<button
						type="button"
						onclick={crearEntidadesFaltantes}
						disabled={creatingEntities || importing}
						class="btn-secondary it-btn-crear"
						title="Crea las placas y empresas faltantes en Cotransmeq sin importar planillas"
					>
						{#if creatingEntities}
							<span class="it-spinner it-spinner--sm" aria-hidden="true"></span>
							Creando…
						{:else}
							<Building2 size={16} strokeWidth={2} />
							Crear recursos
						{/if}
					</button>
				{/if}
			</div>

			<!-- Barra: buscador y mostrar tachadas -->
			<div class="it-barra">
				<!--
					Buscador. Filtra en cliente porque el preview ya trae la lista
					entera: pedirla otra vez al servidor por cada tecla sería un
					viaje a la base de Transmeralda para algo que ya está aquí.
				-->
				<div class="it-buscar">
					<span class="it-buscar-icono" aria-hidden="true">
						<Search size={16} strokeWidth={2} />
					</span>
					<input
						type="search"
						bind:value={busqueda}
						onkeydown={onBuscarKeydown}
						placeholder="Buscar conductor, cédula, placa, planilla o empresa"
						aria-label="Buscar planillas"
						class="it-input"
					/>
					{#if busqueda}
						<button
							type="button"
							onclick={() => (busqueda = '')}
							class="it-buscar-limpiar"
							title="Limpiar búsqueda"
							aria-label="Limpiar búsqueda"
						>
							<X size={14} strokeWidth={2.5} />
						</button>
					{/if}
				</div>

				<!-- Toggle mostrar tachadas -->
				{#if preview.filtradas_por_conductor_inactivo > 0}
					<label
						class="it-toggle"
						title="Mostrar también las planillas filtradas (conductor inactivo, no existe en CM, etc.) para diagnóstico"
					>
						<input
							type="checkbox"
							bind:checked={mostrarNoImportables}
							onchange={cargarPreview}
							class="it-check"
						/>
						Mostrar tachadas
						<span class="it-chip it-chip--neutro it-chip--num">
							+{preview.filtradas_por_conductor_inactivo}
						</span>
					</label>
				{/if}
			</div>

			<!-- Lista de planillas -->
			<div class="it-card it-lista">
				{#if importablesVisibles.length > 0}
					<label class="it-lista-cabecera">
						<input
							type="checkbox"
							checked={todasVisiblesSeleccionadas}
							onchange={toggleSelectAll}
							class="it-check"
						/>
						<span>
							{busqueda ? 'Seleccionar las visibles' : 'Seleccionar todas'}
						</span>
						<span class="it-lista-cuenta">
							{importablesVisibles.length} importable{importablesVisibles.length === 1 ? '' : 's'}
						</span>
					</label>
				{/if}

				{#each planillasFiltradas as p (p.source_id)}
					{@const noImportable = !!p.motivo_no_importable}
					{@const importada = p.ya_importado}
					{@const deshabilitada = noImportable || importada || !p.conductor_activo_en_destino}
					{@const isSelected = selectedIds.has(p.source_id)}
					<label
						class="it-fila"
						class:it-fila--apagada={deshabilitada}
						class:it-fila--tachada={importada}
						class:it-fila--marcada={isSelected}
					>
						<input
							type="checkbox"
							disabled={deshabilitada}
							checked={isSelected}
							onchange={() => toggleSelect(p.source_id)}
							class="it-check"
						/>

						<span class="it-col it-col--conductor">
							<span class="it-principal">{p.conductor_nombre || '—'}</span>
							<span class="it-secundario it-num">CC {p.conductor_identificacion || '—'}</span>
						</span>

						<span class="it-col">
							<span class="it-principal it-num">{p.vehiculo_placa}</span>
							<span class="it-secundario">{p.empresa_nombre}</span>
						</span>

						<span class="it-col">
							<span class="it-principal it-num">
								{p.numero_planilla_normalizado || p.numero_planilla || '—'}
							</span>
							{#if p.numero_planilla_original && p.numero_planilla_original !== p.numero_planilla_normalizado}
								<span
									class="it-chip it-chip--crear it-chip--sm"
									title="Original de Transmeralda. Se importa con prefijo TM-."
								>
									<ArrowRight size={11} strokeWidth={2.5} />
									orig: {p.numero_planilla_original}
								</span>
							{/if}
							<span
								class="it-secundario it-num"
								title={p.dias_lista && p.dias_lista.length > 0
									? `Días laborados: ${p.dias_lista.join(', ')}`
									: 'Sin días registrados'}
							>
								Días {p.dias_rangos || '—'}
							</span>
						</span>

						<span class="it-col it-col--estado">
							{#if importada}
								<span class="it-chip it-chip--neutro">Ya importada</span>
							{:else if noImportable}
								<span
									class="it-chip"
									class:it-chip--alerta={p.conductor_activo_en_destino}
									class:it-chip--peligro={!p.conductor_activo_en_destino}
									title={p.motivo_no_importable}
								>
									{p.motivo_no_importable}
								</span>
							{:else}
								<span class="it-chip it-chip--marca">Nueva</span>
							{/if}
							{#if !importada && !noImportable && p.vehiculo_no_existe_en_destino}
								<span
									class="it-chip it-chip--crear"
									title="Esta placa se creará automáticamente en Cotransmeq al importar"
								>
									+ placa
								</span>
							{/if}
							{#if !importada && !noImportable && p.empresa_no_existe_en_destino}
								<span
									class="it-chip it-chip--crear"
									title="Esta empresa se creará automáticamente en Cotransmeq al importar"
								>
									+ empresa
								</span>
							{/if}
						</span>
					</label>
				{:else}
					<div class="it-estado it-estado--vacio">
						<FileSearch size={32} strokeWidth={1.75} />
						<!--
							Con el buscador puesto, «no hay planillas en TM» sería
							mentira y mandaría a revisar el mes equivocado.
						-->
						<p>
							{#if busqueda}
								Ninguna planilla coincide con «{busqueda}»
							{:else}
								No hay planillas en Transmeralda para {meses[mes]}
								{año}
							{/if}
						</p>
						<p class="it-estado-nota">
							{#if busqueda}
								Hay {preview?.planillas.length ?? 0} planillas en este mes. Prueba con otro texto o limpia
								la búsqueda.
							{:else}
								Verifica que el mes/año tenga recargos cargados en TM.
							{/if}
						</p>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#snippet pie()}
		<span class="it-pie-cuenta">
			{#if preview}
				{selectedIds.size} seleccionada{selectedIds.size === 1 ? '' : 's'} de
				{preview.importables} nuevas
			{/if}
		</span>
		<button type="button" onclick={handleCancel} disabled={importing} class="btn-secondary">
			Cancelar
		</button>
		<button
			type="button"
			onclick={ejecutarImportacion}
			disabled={!haySeleccion || importing}
			class="btn-primary"
		>
			{#if importing}
				<span class="it-spinner it-spinner--sm it-spinner--claro" aria-hidden="true"></span>
				Importando {selectedIds.size}…
			{:else}
				<Download size={16} strokeWidth={2} />
				Importar {selectedIds.size}
			{/if}
		</button>
	{/snippet}
</ModalBase>

<style>
	/* Error de la API, arriba del contenido. */
	.it-error {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin-bottom: 20px;
		padding: 12px 14px;
		border-radius: 14px;
		background: #fef2f2;
		color: #b42318;
		font-size: 13px;
	}
	.it-error :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}
	.it-error strong {
		font-weight: 800;
	}
	.it-error p {
		margin: 2px 0 0;
		font-weight: 600;
	}

	/* Estados del cuerpo: cargando y vacío. */
	.it-estado {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		min-height: 220px;
		color: var(--text-muted);
		font-size: 14px;
		font-weight: 600;
		text-align: center;
	}
	.it-estado p {
		margin: 0;
	}
	.it-estado--vacio {
		gap: 8px;
		min-height: 200px;
		padding: 24px 16px;
		color: var(--text-very-muted);
	}
	.it-estado--vacio p:first-of-type {
		color: var(--text-muted);
	}
	.it-estado-nota {
		font-size: 12.5px;
		font-weight: 500;
	}
	.it-spinner {
		width: 28px;
		height: 28px;
		border-radius: 999px;
		border: 3px solid var(--border-default);
		border-top-color: var(--accion);
		animation: it-giro 0.7s linear infinite;
	}
	.it-spinner--sm {
		width: 14px;
		height: 14px;
		border-width: 2px;
	}
	.it-spinner--claro {
		border-color: rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
	}
	@keyframes it-giro {
		to {
			transform: rotate(360deg);
		}
	}

	/* Secciones: título en negrita sobre tarjetas blancas, como la app. */
	.it-seccion + .it-seccion {
		margin-top: 24px;
	}
	.it-titulo {
		margin: 0 0 10px;
		color: var(--text-primary);
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.it-titulo-fila {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 10px 12px;
		margin-bottom: 12px;
	}
	.it-titulo-fila .it-titulo {
		margin-bottom: 2px;
	}
	.it-nota {
		margin: 0;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}
	.it-num {
		font-variant-numeric: tabular-nums;
	}
	.it-btn-crear {
		min-height: 38px;
		padding: 0 14px;
		border-radius: 12px;
		font-size: 13px;
	}

	.it-card {
		border-radius: 18px;
		background: var(--bg-surface);
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}

	/* Resumen: métricas en tarjetas blancas pequeñas. */
	.it-resumen {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}
	.it-stat {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 14px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.it-stat-label {
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 700;
	}
	.it-stat-valor {
		color: var(--text-primary);
		font-family: var(--font-display);
		font-size: 24px;
		line-height: 1.2;
		font-weight: 900;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.it-stat-valor--marca {
		color: var(--color-emerald-700);
	}
	.it-stat-valor--alerta {
		color: #b45309;
	}
	.it-stat-valor--crear {
		color: #6d28d9;
	}
	.it-stat-nota {
		color: var(--text-very-muted);
		font-size: 11.5px;
		font-weight: 600;
	}

	/* Barra del listado: buscador y «mostrar tachadas». */
	.it-barra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	.it-buscar {
		position: relative;
		flex: 1 1 260px;
		max-width: 420px;
	}
	.it-buscar-icono {
		position: absolute;
		top: 50%;
		left: 12px;
		display: flex;
		color: var(--text-very-muted);
		transform: translateY(-50%);
		pointer-events: none;
	}
	.it-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 36px 9px 38px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.it-input::placeholder {
		color: var(--text-very-muted);
		opacity: 1;
	}
	.it-input::-webkit-search-cancel-button {
		display: none;
	}
	.it-input:focus,
	.it-input:focus-visible {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.it-buscar-limpiar {
		position: absolute;
		top: 50%;
		right: 8px;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-muted);
		transform: translateY(-50%);
		cursor: pointer;
	}
	.it-buscar-limpiar:hover {
		color: var(--text-primary);
	}
	.it-toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 0 14px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}
	.it-toggle:hover {
		border-color: var(--border-emphasis);
	}
	.it-toggle:has(input:focus-visible) {
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.it-check {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		margin: 0;
		accent-color: var(--accion);
		cursor: pointer;
	}
	.it-check:disabled {
		cursor: not-allowed;
	}

	/* Lista: filas dentro de la tarjeta, separadas por líneas suaves. */
	.it-lista {
		overflow: hidden;
	}
	.it-lista-cabecera {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 800;
		cursor: pointer;
	}
	.it-lista-cuenta {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.it-fila {
		display: grid;
		grid-template-columns:
			16px minmax(0, 1.35fr) minmax(0, 1.1fr) minmax(0, 1fr)
			minmax(0, 1.25fr);
		align-items: center;
		gap: 14px;
		padding: 12px 16px;
		border-top: 1px solid var(--border-subtle);
		cursor: pointer;
		transition: background 0.15s;
	}
	.it-fila:first-child {
		border-top: 0;
	}
	.it-fila:hover:not(.it-fila--apagada) {
		background: var(--bg-base);
	}
	.it-fila--marcada {
		background: color-mix(in srgb, var(--accion) 5%, transparent);
	}
	.it-fila--apagada {
		cursor: default;
	}
	.it-fila--apagada > :not(.it-col--estado) {
		opacity: 0.55;
	}
	.it-fila--tachada .it-principal,
	.it-fila--tachada .it-secundario {
		text-decoration: line-through;
	}
	.it-col {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
	}
	.it-col--estado {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
	}
	.it-principal {
		max-width: 100%;
		color: var(--text-primary);
		font-size: 14px;
		line-height: 1.3;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.it-secundario {
		max-width: 100%;
		color: var(--text-muted);
		font-size: 12px;
		line-height: 1.3;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	/* Chips suaves para estados. */
	.it-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 12px;
		line-height: 1.35;
		font-weight: 700;
	}
	.it-chip--sm {
		padding: 1px 8px;
		font-size: 11px;
	}
	.it-chip--num {
		padding: 1px 8px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.it-chip--neutro {
		background: var(--bg-base);
		color: var(--text-secondary);
	}
	.it-chip--marca {
		background: var(--color-emerald-100);
		color: var(--color-emerald-700);
	}
	.it-chip--alerta {
		background: rgba(245, 158, 11, 0.14);
		color: #92400e;
	}
	.it-chip--peligro {
		background: #fef2f2;
		color: #b42318;
	}
	.it-chip--crear {
		background: rgba(124, 58, 237, 0.1);
		color: #5b21b6;
	}

	/* Pie: la cuenta a la izquierda, las acciones a la derecha. */
	.it-pie-cuenta {
		margin-right: auto;
		color: var(--text-muted);
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 860px) {
		.it-resumen {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.it-fila {
			grid-template-columns: 16px minmax(0, 1fr) minmax(0, 1fr);
			align-items: start;
			gap: 8px 12px;
		}
		.it-fila > .it-check {
			grid-row: span 3;
			margin-top: 2px;
		}
		.it-col--conductor {
			grid-column: 2 / -1;
		}
		.it-col--estado {
			grid-column: 2 / -1;
			justify-content: flex-start;
		}
		.it-buscar {
			max-width: none;
		}
	}
	@media (max-width: 640px) {
		.it-pie-cuenta {
			flex-basis: 100%;
			text-align: center;
		}
	}
</style>
