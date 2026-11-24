<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		ArrowLeft,
		Check,
		ExternalLink,
		Eye,
		FileSpreadsheet,
		FileText,
		MapPin,
		Pencil,
		Save,
		X
	} from 'lucide-svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { numero, opcion, texto, type DefinicionesFiltros } from '$lib/listing/filtros';
	import {
		induccionesAPI,
		type EstadisticasInducciones,
		type FiltrosInduccion,
		type InduccionVisitante,
		type Sede,
		type TemasInformados,
		type UpdateInduccionInput
	} from '$lib/api/inducciones';

	const EMPRESA = 'Cotransmeq';
	const POR_PAGINA = 20;
	const SEDES: Record<Sede, string> = {
		yopal: 'Sede Yopal',
		villanueva: 'Sede Villanueva',
		ambas: 'Yopal y Villanueva',
		lugar_prestacion: 'Lugar de prestación'
	};
	const TEMAS: { id: keyof TemasInformados; label: string }[] = [
		{ id: 'peligros_riesgos', label: 'Peligros y riesgos de las instalaciones' },
		{ id: 'normas_comportamiento', label: 'Normas de comportamiento' },
		{ id: 'uso_epp', label: 'Uso de elementos de protección personal' },
		{ id: 'prohibicion_alcohol_drogas', label: 'Prohibición de alcohol y sustancias psicoactivas' },
		{ id: 'manejo_residuos', label: 'Manejo y clasificación de residuos' },
		{ id: 'uso_agua_energia', label: 'Uso racional de agua y energía' },
		{ id: 'procedimiento_derrames', label: 'Procedimiento ante derrames' },
		{ id: 'alarma_evacuacion', label: 'Alarma y rutas de evacuación' },
		{ id: 'pasos_emergencia', label: 'Actuación ante emergencias' },
		{ id: 'numeros_emergencia', label: 'Números de emergencia' },
		{ id: 'seguridad_vial', label: 'Seguridad vial' }
	];
	const COLUMNAS: ColumnDef<InduccionVisitante, any>[] = [
		{ id: 'fecha', header: 'Fecha', accessorKey: 'fecha', size: 150 },
		{ id: 'visitante', header: 'Visitante', accessorKey: 'visitante_nombre', size: 230 },
		{ id: 'entidad', header: 'Empresa', accessorKey: 'visitante_entidad' },
		{ id: 'sede', header: 'Sede', accessorKey: 'sede', size: 170 },
		{ id: 'temas', header: 'Temas', accessorKey: 'porcentaje_conformidad', size: 90 },
		{ id: 'acciones', header: 'Acciones', enableSorting: false, size: 180 }
	];

	interface Filtros {
		q: string;
		sede: string;
		desde: string;
		hasta: string;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		q: texto(),
		sede: opcion(''),
		desde: texto(),
		hasta: texto(),
		pagina: numero(1)
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leerInicial());
	let busqueda = $state(untrack(() => filtros.q));
	$effect(() => estadoUrl.escribir(page.url, filtros));

	let registros = $state<InduccionVisitante[]>([]);
	let paginacion = $state({ total: 0, page: 1, limit: POR_PAGINA, totalPages: 0 });
	let estadisticas = $state<EstadisticasInducciones | null>(null);
	let cargando = $state(true);
	let errorCarga = $state('');
	let detalle = $state<InduccionVisitante | null>(null);
	let modal = $state<'detalle' | 'editar' | null>(null);
	let guardando = $state(false);
	let exportando = $state<string | null>(null);
	let borrador = $state({
		sede: 'yopal' as Sede,
		fecha: '',
		visitante_nombre: '',
		visitante_cargo: '',
		visitante_cedula: '',
		visitante_entidad: '',
		responsable_nombre: '',
		responsable_cargo: '',
		responsable_cedula: '',
		observaciones: '',
		temas: Object.fromEntries(TEMAS.map(({ id }) => [id, false])) as unknown as TemasInformados
	});
	let solicitud = 0;

	const puedeEditar = $derived.by(() => {
		const usuario = $authStore.user;
		return (
			checkAccess(usuario?.area, 'asistencias', usuario?.permisos_rutas, usuario?.id).level ===
			'full'
		);
	});

	function cambiar<K extends keyof Filtros>(clave: K, valor: Filtros[K]) {
		filtros = { ...filtros, [clave]: valor, ...(clave === 'pagina' ? {} : { pagina: 1 }) };
	}

	function fechaIso(dia: string, final = false): string | undefined {
		if (!dia) return undefined;
		return new Date(`${dia}T${final ? '23:59:59.999' : '00:00:00'}-05:00`).toISOString();
	}

	async function cargar() {
		const id = ++solicitud;
		cargando = true;
		errorCarga = '';
		try {
			const params: FiltrosInduccion = {
				search: filtros.q || undefined,
				sede: (filtros.sede || undefined) as Sede | undefined,
				fecha_desde: fechaIso(filtros.desde),
				fecha_hasta: fechaIso(filtros.hasta, true),
				page: filtros.pagina,
				limit: POR_PAGINA
			};
			const resultado = await induccionesAPI.obtenerTodos(params);
			if (id !== solicitud) return;
			registros = resultado.data;
			paginacion = resultado.pagination;
		} catch (error) {
			if (id === solicitud)
				errorCarga =
					error instanceof Error ? error.message : 'No se pudieron cargar las inducciones';
		} finally {
			if (id === solicitud) cargando = false;
		}
	}

	async function cargarEstadisticas() {
		try {
			estadisticas = await induccionesAPI.obtenerEstadisticas();
		} catch {
			// La tabla sigue disponible aunque falle el resumen.
		}
	}

	$effect(() => {
		void filtros;
		untrack(() => void cargar());
	});
	$effect(() => {
		untrack(() => void cargarEstadisticas());
	});

	function fechaLegible(valor: string, incluirHora = false) {
		if (!valor) return '—';
		return new Intl.DateTimeFormat('es-CO', {
			timeZone: 'America/Bogota',
			dateStyle: 'medium',
			...(incluirHora ? { timeStyle: 'short' as const } : {})
		}).format(new Date(valor));
	}

	function fechaLocalInput(valor: string) {
		const fecha = new Date(valor);
		const partes = new Intl.DateTimeFormat('sv-SE', {
			timeZone: 'America/Bogota',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(fecha);
		return partes.replace(' ', 'T');
	}

	async function abrirDetalle(id: string) {
		try {
			detalle = await induccionesAPI.obtenerPorId(id);
			modal = 'detalle';
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo abrir el registro');
		}
	}

	async function abrirEdicion(id: string) {
		await abrirDetalle(id);
		if (detalle?.id === id) editarDetalle();
	}

	function editarDetalle() {
		if (!detalle || !puedeEditar) return;
		borrador = {
			sede: detalle.sede,
			fecha: fechaLocalInput(detalle.fecha),
			visitante_nombre: detalle.visitante_nombre,
			visitante_cargo: detalle.visitante_cargo,
			visitante_cedula: detalle.visitante_cedula,
			visitante_entidad: detalle.visitante_entidad,
			responsable_nombre: detalle.responsable_nombre ?? '',
			responsable_cargo: detalle.responsable_cargo ?? '',
			responsable_cedula: detalle.responsable_cedula ?? '',
			observaciones: detalle.observaciones ?? '',
			temas: Object.fromEntries(
				TEMAS.map(({ id }) => [id, Boolean(detalle?.temas_informados?.[id])])
			) as unknown as TemasInformados
		};
		modal = 'editar';
	}

	async function guardar(event: SubmitEvent) {
		event.preventDefault();
		if (!detalle || !puedeEditar || guardando) return;
		guardando = true;
		const datos: UpdateInduccionInput = {
			sede: borrador.sede,
			fecha: new Date(`${borrador.fecha}:00-05:00`).toISOString(),
			visitante_nombre: borrador.visitante_nombre.trim(),
			visitante_cargo: borrador.visitante_cargo.trim(),
			visitante_cedula: borrador.visitante_cedula.trim(),
			visitante_entidad: borrador.visitante_entidad.trim(),
			temas_informados: { ...borrador.temas },
			observaciones: borrador.observaciones.trim(),
			responsable_nombre: borrador.responsable_nombre.trim(),
			responsable_cargo: borrador.responsable_cargo.trim(),
			responsable_cedula: borrador.responsable_cedula.trim()
		};
		try {
			detalle = await induccionesAPI.actualizar(detalle.id, datos);
			modal = 'detalle';
			toast.success('Inducción actualizada');
			void cargar();
			void cargarEstadisticas();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo guardar');
		} finally {
			guardando = false;
		}
	}

	async function exportar(tipo: 'excel' | 'pdf', registro: InduccionVisitante) {
		exportando = `${registro.id}:${tipo}`;
		try {
			if (tipo === 'excel')
				await induccionesAPI.descargarExcel(registro.id, registro.visitante_nombre);
			else await induccionesAPI.descargarPDF(registro.id, registro.visitante_nombre);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo exportar el registro');
		} finally {
			exportando = null;
		}
	}
</script>

<svelte:head>
	<title>Inducciones visitantes — {EMPRESA}</title>
</svelte:head>

<main class="inducciones-page">
	<header class="page-heading">
		<div>
			<a class="back-link" href="/dashboard/asistencias"><ArrowLeft size={16} /> Asistencias</a>
			<p class="eyebrow">HSEQ · HSEQ-FR-66</p>
			<h1>Inducciones de visitantes</h1>
			<p class="subtitle">
				Consulta y administra los registros enviados desde el formulario público.
			</p>
		</div>
		<a class="public-link" href="/public/inducciones" target="_blank" rel="noreferrer">
			<ExternalLink size={16} /> Abrir formulario público
		</a>
	</header>

	<section class="stats" aria-label="Resumen de inducciones">
		<div class="stat"><span>Registros</span><strong>{estadisticas?.total ?? '—'}</strong></div>
		<div class="stat">
			<span>Últimos 30 días</span><strong>{estadisticas?.ultimo_mes ?? '—'}</strong>
		</div>
		<div class="stat">
			<span>Conformidad promedio</span><strong
				>{estadisticas ? `${estadisticas.promedio_conformidad}%` : '—'}</strong
			>
		</div>
	</section>

	<section class="filters" aria-label="Filtros de inducciones">
		<BuscadorLista
			bind:valor={busqueda}
			onBuscar={(termino) => cambiar('q', termino.trim())}
			placeholder="Buscar visitante, empresa o cédula…"
			etiqueta="Buscar inducciones"
		/>
		<select
			aria-label="Filtrar por sede"
			value={filtros.sede}
			onchange={(e) => cambiar('sede', e.currentTarget.value)}
		>
			<option value="">Todas las sedes</option>
			{#each Object.entries(SEDES) as [key, label]}
				<option value={key}>{label}</option>
			{/each}
		</select>
		<label class="date-filter"
			><span>Desde</span><input
				type="date"
				value={filtros.desde}
				onchange={(e) => cambiar('desde', e.currentTarget.value)}
			/></label
		>
		<label class="date-filter"
			><span>Hasta</span><input
				type="date"
				value={filtros.hasta}
				onchange={(e) => cambiar('hasta', e.currentTarget.value)}
			/></label
		>
		{#if filtros.q || filtros.sede || filtros.desde || filtros.hasta}
			<button
				class="reset-button"
				type="button"
				onclick={() => {
					busqueda = '';
					filtros = { q: '', sede: '', desde: '', hasta: '', pagina: 1 };
				}}>Limpiar</button
			>
		{/if}
	</section>

	<section class="results" aria-label="Registros de inducción">
		<div class="results-heading">
			<strong>{paginacion.total.toLocaleString('es-CO')} registros</strong><span
				>Ordenados del más reciente al más antiguo</span
			>
		</div>
		{#if errorCarga}
			<div class="empty-state error-state">{errorCarga}</div>
		{:else}
			<TablaLista
				columnas={COLUMNAS}
				datos={registros}
				claveFila={(registro) => registro.id}
				{cargando}
				etiqueta="Registros de inducción HSEQ-FR-66"
			>
				{#snippet celda({ columnaId, fila: registro })}
					{#if columnaId === 'fecha'}
						<div class="dir-celda">
							<span>{fechaLegible(registro.fecha)}</span><small
								>{fechaLegible(registro.fecha, true).split(',').at(-1)?.trim()}</small
							>
						</div>
					{:else if columnaId === 'visitante'}
						<div class="dir-celda">
							<strong>{registro.visitante_nombre}</strong><small
								>{registro.visitante_cedula} · {registro.visitante_cargo}</small
							>
						</div>
					{:else if columnaId === 'entidad'}
						<span>{registro.visitante_entidad}</span>
					{:else if columnaId === 'sede'}
						<span class="site-chip"><MapPin size={13} />{SEDES[registro.sede]}</span>
					{:else if columnaId === 'temas'}
						<span class="compliance-chip">{registro.porcentaje_conformidad}%</span>
					{:else if columnaId === 'acciones'}
						<div class="row-actions">
							<button
								type="button"
								class="icon-button"
								title="Ver registro"
								aria-label="Ver registro"
								onclick={() => void abrirDetalle(registro.id)}><Eye size={17} /></button
							>
							{#if puedeEditar}<button
									type="button"
									class="icon-button"
									title="Editar registro"
									aria-label="Editar registro"
									onclick={() => void abrirEdicion(registro.id)}><Pencil size={17} /></button
								>{/if}
							<button
								type="button"
								class="icon-button"
								title="Descargar Excel"
								aria-label="Descargar Excel"
								disabled={exportando === `${registro.id}:excel`}
								onclick={() => void exportar('excel', registro)}
								><FileSpreadsheet size={17} /></button
							>
							<button
								type="button"
								class="icon-button"
								title="Descargar formato imprimible"
								aria-label="Descargar formato imprimible"
								disabled={exportando === `${registro.id}:pdf`}
								onclick={() => void exportar('pdf', registro)}><FileText size={17} /></button
							>
						</div>
					{/if}
				{/snippet}
				{#snippet vacio()}No hay registros que coincidan con estos filtros.{/snippet}
			</TablaLista>
			<PaginadorLista
				pagina={paginacion.page}
				total={paginacion.total}
				porPagina={POR_PAGINA}
				{cargando}
				nombreItems="inducciones"
				onCambiar={(pagina) => cambiar('pagina', pagina)}
			/>
		{/if}
	</section>
</main>

{#if modal && detalle}
	<div class="modal-backdrop">
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
			<header class="modal-header">
				<div>
					<p class="eyebrow">HSEQ-FR-66 · {modal === 'editar' ? 'Edición' : 'Registro'}</p>
					<h2 id="modal-title">
						{modal === 'editar' ? 'Editar inducción' : detalle.visitante_nombre}
					</h2>
				</div>
				<button
					class="icon-button"
					type="button"
					aria-label="Cerrar"
					onclick={() => {
						modal = null;
					}}><X size={19} /></button
				>
			</header>
			{#if modal === 'detalle'}
				<div class="modal-content">
					<div class="detail-grid">
						<div><span>Fecha</span><strong>{fechaLegible(detalle.fecha, true)}</strong></div>
						<div><span>Sede</span><strong>{SEDES[detalle.sede]}</strong></div>
						<div><span>Documento</span><strong>{detalle.visitante_cedula}</strong></div>
						<div><span>Cargo</span><strong>{detalle.visitante_cargo || '—'}</strong></div>
						<div><span>Empresa</span><strong>{detalle.visitante_entidad}</strong></div>
						<div>
							<span>Responsable</span><strong
								>{detalle.responsable_nombre || '—'}{detalle.responsable_cargo
									? ` · ${detalle.responsable_cargo}`
									: ''}</strong
							>
						</div>
					</div>
					<div class="topic-section">
						<div class="section-title">
							<strong>Temas informados</strong><span
								>{detalle.porcentaje_conformidad}% conformidad</span
							>
						</div>
						<div class="topic-list">
							{#each TEMAS as tema}<div class:topic-yes={detalle.temas_informados?.[tema.id]}>
									<span class="topic-check"
										>{#if detalle.temas_informados?.[tema.id]}<Check size={14} />{:else}<X
												size={14}
											/>{/if}</span
									>{tema.label}
								</div>{/each}
						</div>
					</div>
					{#if detalle.observaciones}<div class="observations">
							<span>Observaciones</span>
							<p>{detalle.observaciones}</p>
						</div>{/if}
					<div class="signatures">
						<div>
							<span>Firma visitante</span>{#if detalle.visitante_firma}<img
									src={detalle.visitante_firma}
									alt="Firma de {detalle.visitante_nombre}"
								/>{:else}<small>Sin firma</small>{/if}
						</div>
						<div>
							<span>Firma responsable</span>{#if detalle.responsable_firma}<img
									src={detalle.responsable_firma}
									alt="Firma de {detalle.responsable_nombre || 'responsable'}"
								/>{:else}<small>Sin firma</small>{/if}
						</div>
					</div>
				</div>
				<footer class="modal-footer">
					{#if puedeEditar}<button type="button" class="secondary-button" onclick={editarDetalle}
							><Pencil size={16} /> Editar</button
						>{/if}
					<button
						type="button"
						class="secondary-button"
						onclick={() => void exportar('excel', detalle!)}
						><FileSpreadsheet size={16} /> Excel</button
					>
					<button
						type="button"
						class="secondary-button"
						onclick={() => void exportar('pdf', detalle!)}><FileText size={16} /> Imprimible</button
					>
				</footer>
			{:else}
				<form class="edit-form" onsubmit={guardar}>
					<div class="form-grid">
						<label
							>Fecha y hora<input
								type="datetime-local"
								required
								bind:value={borrador.fecha}
							/></label
						>
						<label
							>Sede<select bind:value={borrador.sede}
								>{#each Object.entries(SEDES) as [key, label]}<option value={key}>{label}</option
									>{/each}</select
							></label
						>
						<label
							>Nombre del visitante<input
								required
								maxlength="255"
								bind:value={borrador.visitante_nombre}
							/></label
						>
						<label
							>Cédula<input required maxlength="50" bind:value={borrador.visitante_cedula} /></label
						>
						<label
							>Cargo<input required maxlength="255" bind:value={borrador.visitante_cargo} /></label
						>
						<label
							>Empresa o entidad<input
								required
								maxlength="255"
								bind:value={borrador.visitante_entidad}
							/></label
						>
						<label
							>Responsable<input maxlength="255" bind:value={borrador.responsable_nombre} /></label
						>
						<label
							>Cargo del responsable<input
								maxlength="255"
								bind:value={borrador.responsable_cargo}
							/></label
						>
						<label
							>Cédula del responsable<input
								maxlength="50"
								bind:value={borrador.responsable_cedula}
							/></label
						>
					</div>
					<fieldset>
						<legend>Temas informados</legend>
						<div class="edit-topic-grid">
							{#each TEMAS as tema}<label class="edit-topic"
									><input
										type="checkbox"
										bind:checked={borrador.temas[tema.id]}
									/>{tema.label}</label
								>{/each}
						</div>
					</fieldset>
					<label class="observations-field"
						>Observaciones<textarea rows="3" bind:value={borrador.observaciones}></textarea></label
					>
					<p class="signature-note">
						Las firmas originales se conservan tal como fueron enviadas y no se reemplazan al editar
						los datos.
					</p>
					<footer class="modal-footer">
						<button
							type="button"
							class="secondary-button"
							onclick={() => {
								modal = 'detalle';
							}}
							disabled={guardando}>Cancelar</button
						><button type="submit" class="primary-button" disabled={guardando}
							><Save size={16} />{guardando ? 'Guardando…' : 'Guardar cambios'}</button
						>
					</footer>
				</form>
			{/if}
		</div>
	</div>
{/if}

<style>
	.inducciones-page {
		padding: 1.25rem;
		color: var(--text-primary, #17221d);
	}
	.page-heading {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 18px;
		background: var(--bg-surface, #fff);
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--text-muted, #60716a);
		text-decoration: none;
		font-size: 0.84rem;
		margin-bottom: 0.8rem;
	}
	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--au-dark, #087451);
		font-size: 0.69rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		font-size: clamp(1.45rem, 2vw, 2rem);
		letter-spacing: -0.035em;
	}
	.subtitle {
		margin: 0.35rem 0 0;
		color: var(--text-muted, #64756d);
	}
	.public-link,
	.primary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: 42px;
		padding: 0 1rem;
		border: 0;
		border-radius: 11px;
		background: var(--au-dark, #087451);
		color: #fff;
		font: inherit;
		font-size: 0.88rem;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.8rem;
		margin: 1rem 0;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1rem 1.2rem;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 14px;
		background: var(--bg-surface, #fff);
	}
	.stat span,
	.detail-grid span,
	.signatures span,
	.observations span {
		color: var(--text-muted, #687971);
		font-size: 0.76rem;
	}
	.stat strong {
		font-size: 1.35rem;
		font-variant-numeric: tabular-nums;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.65rem;
		padding: 0.85rem;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 14px;
		background: var(--bg-surface, #fff);
	}
	.filters select,
	.date-filter input {
		min-height: 42px;
		padding: 0 0.65rem;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 10px;
		background: var(--bg-surface, #fff);
		color: var(--text-primary, #17221d);
		font: inherit;
	}
	.date-filter {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--text-muted, #687971);
		font-size: 0.78rem;
	}
	.icon-button {
		display: inline-grid;
		place-items: center;
		width: 36px;
		height: 36px;
		flex: none;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 10px;
		background: var(--bg-surface, #fff);
		color: var(--text-muted, #52665c);
		cursor: pointer;
	}
	.reset-button {
		border: 0;
		background: transparent;
		color: var(--au-dark, #087451);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
	}
	.results {
		margin-top: 1rem;
		overflow: hidden;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 15px;
		background: var(--bg-surface, #fff);
	}
	.results-heading {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.1rem;
		border-bottom: 1px solid var(--border-default, #e6eeea);
	}
	.results-heading span {
		color: var(--text-muted, #687971);
		font-size: 0.8rem;
	}
	.site-chip,
	.compliance-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.28rem 0.55rem;
		border-radius: 999px;
		background: var(--au-tint, #e7f7ef);
		color: var(--au-dark, #087451);
		font-size: 0.77rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.row-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.35rem;
		white-space: nowrap;
	}
	.icon-button:hover:not(:disabled) {
		border-color: var(--au-dark, #087451);
		color: var(--au-dark, #087451);
	}
	.icon-button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.empty-state {
		padding: 3.5rem 1rem;
		text-align: center;
		color: var(--text-muted, #687971);
	}
	.error-state {
		color: #a02b2b;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(11, 28, 22, 0.56);
	}
	.modal {
		display: flex;
		flex-direction: column;
		width: min(920px, 100%);
		max-height: min(92vh, 1000px);
		overflow: hidden;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 18px;
		background: var(--bg-surface, #fff);
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
	}
	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.15rem 1.35rem;
		border-bottom: 1px solid var(--border-default, #e6eeea);
	}
	.modal-header h2 {
		margin: 0;
		font-size: 1.3rem;
	}
	.modal-content,
	.edit-form {
		overflow: auto;
		padding: 1.25rem 1.35rem;
	}
	.detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 1rem;
	}
	.detail-grid div {
		display: flex;
		flex-direction: column;
		gap: 0.28rem;
	}
	.detail-grid strong {
		font-size: 0.9rem;
	}
	.topic-section {
		margin-top: 1.4rem;
	}
	.section-title {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.55rem;
	}
	.section-title span {
		color: var(--au-dark, #087451);
		font-weight: 700;
		font-size: 0.85rem;
	}
	.topic-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		gap: 0.45rem;
	}
	.topic-list > div {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.55rem 0.65rem;
		border-radius: 9px;
		background: #fff5f3;
		color: #7f4039;
		font-size: 0.82rem;
	}
	.topic-list > .topic-yes {
		background: var(--au-tint, #e7f7ef);
		color: var(--au-dark, #087451);
	}
	.topic-check {
		display: inline-grid;
		place-items: center;
		width: 19px;
		height: 19px;
		flex: none;
		border-radius: 50%;
		background: rgba(120, 60, 50, 0.1);
	}
	.topic-yes .topic-check {
		background: rgba(8, 116, 81, 0.12);
	}
	.observations {
		margin-top: 1rem;
		padding: 0.8rem;
		border-radius: 10px;
		background: var(--bg-subtle, #f5f8f6);
	}
	.observations p {
		margin: 0.3rem 0 0;
		white-space: pre-wrap;
	}
	.signatures {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}
	.signatures > div {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-height: 100px;
		padding: 0.7rem;
		border: 1px solid var(--border-default, #e6eeea);
		border-radius: 10px;
	}
	.signatures img {
		width: 100%;
		height: 90px;
		object-fit: contain;
	}
	.signatures small {
		color: var(--text-muted, #687971);
	}
	.modal-footer {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.55rem;
		padding: 1rem 1.35rem;
		border-top: 1px solid var(--border-default, #e6eeea);
	}
	.secondary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 40px;
		padding: 0 0.85rem;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 10px;
		background: var(--bg-surface, #fff);
		color: var(--text-primary, #17221d);
		font: inherit;
		font-size: 0.84rem;
		font-weight: 650;
		cursor: pointer;
	}
	.primary-button {
		min-height: 40px;
	}
	.form-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.8rem;
	}
	.form-grid label,
	.observations-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		color: var(--text-primary, #25342c);
		font-size: 0.82rem;
		font-weight: 650;
	}
	.form-grid input,
	.form-grid select,
	.observations-field textarea {
		min-height: 40px;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 9px;
		background: var(--bg-surface, #fff);
		color: var(--text-primary, #17221d);
		font: inherit;
		font-weight: 400;
	}
	.edit-form fieldset {
		margin: 1rem 0;
		padding: 0.8rem;
		border: 1px solid var(--border-default, #dce7e1);
		border-radius: 11px;
	}
	.edit-form legend {
		padding: 0 0.35rem;
		font-size: 0.86rem;
		font-weight: 750;
	}
	.edit-topic-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		gap: 0.55rem;
	}
	.edit-topic {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		color: var(--text-primary, #293b31);
		font-size: 0.82rem;
	}
	.edit-topic input {
		margin-top: 0.12rem;
		accent-color: var(--au-dark, #087451);
	}
	.observations-field textarea {
		resize: vertical;
	}
	.signature-note {
		margin: 0.8rem 0 0;
		color: var(--text-muted, #687971);
		font-size: 0.78rem;
	}
	.edit-form .modal-footer {
		margin: 1rem -1.35rem -1.25rem;
	}
	@media (max-width: 800px) {
		.page-heading {
			align-items: flex-start;
			flex-direction: column;
		}
		.public-link {
			width: 100%;
		}
		.stats {
			gap: 0.5rem;
		}
		.stat {
			padding: 0.8rem;
		}
		.filters > * {
			flex: 1 1 100%;
		}
		.results-heading {
			flex-direction: column;
			gap: 0.2rem;
		}
		.signatures {
			grid-template-columns: 1fr;
		}
	}
</style>
