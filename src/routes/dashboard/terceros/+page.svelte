<script lang="ts">
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import { mascota } from '$lib/mascot';
	import { Eye, Pencil, Trash2 } from 'lucide-svelte';
	import type { ColumnDef, SortingState } from '@tanstack/table-core';
	import { crearListingStore } from '$lib/listing/listingStore';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		firma,
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { tercerosAPI, type Tercero, type TerceroCounts } from '$lib/api/terceros';
	import ModalFormTercero from '$lib/components/terceros/ModalFormTercero.svelte';
	import ModalDetalleTercero from '$lib/components/terceros/ModalDetalleTercero.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { toast } from 'svelte-sonner';

	// ── Permisos ──────────────────────────────────────────────────────
	// `Consulta` (`read`) entra a la pantalla pero no escribe. Se lee
	// `$authStore` a propósito para que el derived se recalcule cuando la
	// sesión termine de hidratarse. El backend aplica lo mismo sobre las
	// rutas de escritura de `terceros`; esto sólo evita ofrecer un botón
	// que iba a devolver 403.
	const puedeEditar = $derived(
		!!$authStore.user && authStore.getAccessLevel('terceros') === 'full'
	);

	const REGIMENES: Record<string, string> = {
		SIMPLIFICADO: 'Simplificado',
		COMUN: 'Común',
		GRAN_CONTRIBUYENTE: 'Gran Contribuyente',
		NO_RESPONSABLE: 'No Responsable',
		AUTORRETENEDOR: 'Autorretenedor',
		ORDINARIO: 'Ordinario'
	};

	const REGIMEN_SHORT: Record<string, string> = {
		SIMPLIFICADO: 'Simplificado',
		COMUN: 'Común',
		GRAN_CONTRIBUYENTE: 'Gran Contrib.',
		NO_RESPONSABLE: 'No Responsable',
		AUTORRETENEDOR: 'Autorretenedor',
		ORDINARIO: 'Ordinario'
	};

	/**
	 * Filtros de la página, en la URL.
	 *
	 * Búsqueda, tipo, orden y página se resuelven en servidor —el endpoint ya
	 * acepta `search`, `tipo_persona`, `sortBy`, `sortOrder`, `page`—, así que
	 * la firma de caché los incluye todos: cualquiera cambia lo que se pide.
	 */
	interface FiltrosTerceros {
		q: string;
		tipo: string;
		orden: string;
		dir: string;
		pagina: number;
	}

	const POR_PAGINA = 24;

	const DEFS: DefinicionesFiltros<FiltrosTerceros> = {
		q: texto(),
		tipo: opcion('TODOS'),
		orden: opcion('nombre_completo'),
		dir: opcion('asc'),
		pagina: numero(1)
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	const listaTerceros = crearListingStore<Tercero>();

	let filtros = $state<FiltrosTerceros>(estadoUrl.leerInicial());

	let terceros = $state<Tercero[]>([]);
	let counts = $state<TerceroCounts>({ total: 0, personas: 0, empresas: 0 });

	/// Crear y editar: `ModalFormTercero`, el mismo cascarón de los demás
	/// directorios.
	let modalTercero = $state<{ abierto: boolean; id: string | null }>({ abierto: false, id: null });

	let showDeleteModal = $state(false);
	let terceroToDelete = $state<Tercero | null>(null);

	let showImportModal = $state(false);
	let isImporting = $state(false);
	let importResult = $state<{ importados: number; duplicados: number; total: number } | null>(null);

	/// Ficha de consulta abierta (id del tercero) o `null`.
	let detalleId = $state<string | null>(null);

	const hasActiveFilter = $derived(filtros.q.trim() !== '' || filtros.tipo !== 'TODOS');

	async function traerTerceros(): Promise<{ items: Tercero[]; total: number }> {
		const params: any = {
			page: filtros.pagina,
			limit: POR_PAGINA,
			sortBy: filtros.orden,
			sortOrder: filtros.dir
		};
		if (filtros.q.trim()) params.search = filtros.q.trim();
		if (filtros.tipo !== 'TODOS') params.tipo_persona = filtros.tipo;

		const response = await tercerosAPI.listar(params);
		/// Los contadores vienen del servidor y cuentan TODO, no la página
		/// actual: son el resumen del directorio, no del filtro.
		if (response.counts) counts = response.counts;

		const items = response.data || [];
		return { items, total: response.pagination?.total ?? items.length };
	}

	const firmaDatos = $derived(firma(DEFS, filtros));

	async function cargar(forzar = false) {
		if (forzar) listaTerceros.invalidar();
		await listaTerceros.cargar(firmaDatos, traerTerceros);
	}

	/// Cambiar cualquier filtro vuelve a la primera página: quedarse en la 7
	/// de un resultado que ahora tiene 2 muestra una tabla vacía.
	function ponerFiltro<K extends keyof FiltrosTerceros>(clave: K, valor: FiltrosTerceros[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	function irPagina(pagina: number) {
		filtros = { ...filtros, pagina };
	}

	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});

	$effect(() => {
		void firmaDatos;
		void cargar();
	});

	/// Estado de la LISTA, que lo gobierna el store.
	const cargandoLista = $derived($listaTerceros._?.cargando ?? false);
	const errorLista = $derived($listaTerceros._?.error || null);

	/// Estado de las OPERACIONES —eliminar, importar—, que antes reutilizaban
	/// las variables de la lista: un borrado en curso ponía el spinner de
	/// «cargando terceros» y su error borraba el de la carga.
	let operando = $state(false);
	let errorOperacion = $state<string | null>(null);

	/// Lo que el marcado sigue llamando `isLoading` y `error`: cualquiera de
	/// las dos cosas deja la interfaz ocupada o con un aviso.
	const isLoading = $derived(cargandoLista || operando);
	const error = $derived(errorOperacion ?? errorLista);
	const totalTerceros = $derived($listaTerceros._?.total ?? 0);

	$effect(() => {
		terceros = $listaTerceros._?.items ?? [];
	});

	function clearFilters() {
		filtros = limpiarFiltrosDe(DEFS, filtros);
	}

	/// El orden también viaja en la URL: compartir «terceros por identificación
	/// descendente» reproduce esa vista, no la de por defecto.
	const COLUMNAS: ColumnDef<Tercero, any>[] = [
		{ id: 'nombre_completo', header: 'Tercero', accessorKey: 'nombre_completo' },
		{ id: 'tipo', header: 'Tipo · Régimen', enableSorting: false, size: 190 },
		{ id: 'identificacion', header: 'Identificación', enableSorting: false, size: 160 },
		{ id: 'contacto', header: 'Contacto', enableSorting: false },
		{ id: 'created_at', header: 'Registrado', accessorKey: 'created_at', size: 160 },
		{ id: 'acciones', header: '', enableSorting: false, size: 130 }
	];

	const SEGMENTOS_TIPO = [
		{ valor: 'TODOS', etiqueta: 'Todos' },
		{ valor: 'PERSONA', etiqueta: 'Personas', punto: '#16a34a' },
		{ valor: 'EMPRESA', etiqueta: 'Empresas', punto: '#f59e0b' }
	];

	const conteos = $derived([
		{ clave: 'TODOS', etiqueta: 'Total', valor: counts.total },
		{ clave: 'PERSONA', etiqueta: 'Personas', valor: counts.personas, color: '#16a34a' },
		{ clave: 'EMPRESA', etiqueta: 'Empresas', valor: counts.empresas, color: '#f59e0b' }
	]);

	/// El orden lo manda la cabecera de la tabla y sigue viajando en la URL.
	const ordenTabla = $derived<SortingState>(
		filtros.orden ? [{ id: filtros.orden, desc: filtros.dir === 'desc' }] : []
	);

	function aplicarOrden(nuevo: SortingState) {
		const primero = nuevo[0];
		filtros = {
			...filtros,
			orden: primero?.id ?? 'nombre_completo',
			dir: primero ? (primero.desc ? 'desc' : 'asc') : 'asc',
			pagina: 1
		};
	}

	function formatFecha(d?: string | null) {
		if (!d) return '—';
		const f = new Date(d);
		if (Number.isNaN(f.getTime())) return '—';
		return f.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	function toggleSort(field: string) {
		if (filtros.orden === field) {
			ponerFiltro('dir', filtros.dir === 'asc' ? 'desc' : 'asc');
		} else {
			filtros = { ...filtros, orden: field, dir: 'asc', pagina: 1 };
		}
	}

	/// `previousPage`, `nextPage` y `getPageNumbers` los reemplaza
	/// `PaginadorLista`, que trae la misma ventana de páginas y estaba copiada
	/// a mano en conductores, clientes, servicios, sarlaft y aquí.

	function initials(name: string): string {
		/// El corte es sobre el nombre ya recortado: `!name` deja pasar una
		/// cadena de espacios, y esa devolvía iniciales vacías —un círculo mudo
		/// en la ficha— en vez de la interrogación.
		const limpio = name?.trim();
		if (!limpio) return '?';
		const parts = limpio.split(/\s+/);
		if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}

	// ─── Crear / editar ───
	function openCreateModal() {
		modalTercero = { abierto: true, id: null };
	}

	function openEditModal(t: Tercero, e?: Event) {
		e?.stopPropagation();
		modalTercero = { abierto: true, id: t.id };
	}

	function openDeleteModal(t: Tercero, e: Event) {
		e.stopPropagation();
		terceroToDelete = t;
		showDeleteModal = true;
	}

	function closeDeleteModal() {
		showDeleteModal = false;
		terceroToDelete = null;
	}

	async function deleteTercero() {
		if (!terceroToDelete) return;
		operando = true;
		try {
			const nombre = terceroToDelete.nombre_completo;
			await tercerosAPI.eliminar(terceroToDelete.id);
			closeDeleteModal();
			toast.success('Tercero eliminado', { description: nombre });
			cargar(true);
		} catch (err: any) {
			closeDeleteModal();
			toast.error('No se pudo eliminar', {
				description: err.response?.data?.message || err.message || 'Error al eliminar'
			});
		} finally {
			operando = false;
		}
	}

	// ─── Importar ───
	function openImportModal() {
		importResult = null;
		showImportModal = true;
	}

	async function importFromVehiculos() {
		isImporting = true;
		try {
			importResult = await tercerosAPI.importarDesdeVehiculos();
			cargar(true);
		} catch (err: any) {
			errorOperacion = err.response?.data?.message || err.message || 'Error al importar';
			showImportModal = false;
		} finally {
			isImporting = false;
		}
	}

	function openDetail(t: Tercero) {
		detalleId = t.id;
	}
</script>

<svelte:head>
	<title>Directorio de Terceros · Cotransmeq</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 400 }}>
	<!-- ── CABECERA: título, conteos y acciones ─────────────── -->
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Terceros</h1>
			<p class="dir-desc">Propietarios y empresas con los que se liquida.</p>
			<div class="dir-conteos">
				<ResumenConteos
					{conteos}
					activo={filtros.tipo === 'TODOS' ? null : filtros.tipo}
					onElegir={(clave) => ponerFiltro('tipo', filtros.tipo === clave ? 'TODOS' : clave)}
				/>
			</div>
		</div>

		<div class="dir-cabecera-acciones">
			{#if puedeEditar}
				<button class="btn-secondary" onclick={openImportModal} title="Importar desde vehículos">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
						/>
					</svg>
					Importar
				</button>
				<button class="btn-primary" onclick={openCreateModal}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
					Nuevo tercero
				</button>
			{/if}
		</div>
	</header>

	<!-- ── FILTROS A LA VISTA: buscador + tipo ───────────────── -->
	<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
		<div class="dir-filtros-buscador">
			<BuscadorLista
				valor={filtros.q}
				onBuscar={(termino) => ponerFiltro('q', termino)}
				placeholder="Nombre, identificación, teléfono o correo…"
				etiqueta="Buscar terceros"
			/>
		</div>
		<SegmentosFiltro
			etiqueta="Tipo"
			opciones={SEGMENTOS_TIPO}
			valor={filtros.tipo}
			onCambiar={(v) => ponerFiltro('tipo', v)}
		/>
		{#if hasActiveFilter}
			<button class="btn-secondary" onclick={clearFilters}>Limpiar</button>
		{/if}
	</div>

	{#if error && terceros.length === 0}
		<div class="alert alert-error" in:fade>
			<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
				/>
			</svg>
			<div class="alert-body">
				<strong>No pudimos cargar el directorio.</strong>
				<span>{error}</span>
			</div>
			<button class="btn-secondary" onclick={() => cargar(true)}>Reintentar</button>
		</div>
	{:else}
		<!-- ── LISTA ───────────────────────────────────────────── -->
		<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 150 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS}
					datos={terceros}
					claveFila={(t) => t.id}
					cargando={isLoading && terceros.length === 0}
					orden={ordenTabla}
					onOrdenar={aplicarOrden}
					onFila={(t) => openDetail(t)}
					etiqueta="Directorio de terceros"
				>
					{#snippet celda({ columnaId, fila: t })}
						{@const nombre = t.nombre_completo?.trim() || 'Sin nombre'}
						{#if columnaId === 'nombre_completo'}
							<CeldaIdentidad
								titulo={nombre}
								subtitulo={t.direccion || undefined}
								iniciales={t.nombre_completo?.trim() ? initials(nombre) : '?'}
								tono={t.tipo_persona === 'EMPRESA' ? '#b45309' : undefined}
							/>
						{:else if columnaId === 'tipo'}
							<div class="dir-celda">
								<span>{t.tipo_persona === 'EMPRESA' ? 'Empresa' : 'Persona'}</span>
								{#if t.regimen}<small>{REGIMEN_SHORT[t.regimen] || t.regimen}</small>{/if}
							</div>
						{:else if columnaId === 'identificacion'}
							<div class="dir-celda">
								{#if t.identificacion}
									<span>{t.identificacion}</span>
								{:else}
									<span class="dir-nulo">Sin registrar</span>
								{/if}
								<small>{t.tipo_persona === 'EMPRESA' ? 'NIT' : 'Cédula'}</small>
							</div>
						{:else if columnaId === 'contacto'}
							{#if t.telefono || t.correo}
								<div class="dir-celda">
									{#if t.telefono}<span>{t.telefono}</span>{/if}
									{#if t.correo}<small>{t.correo}</small>{/if}
								</div>
							{:else}
								<span class="dir-nulo">Sin teléfono ni correo</span>
							{/if}
						{:else if columnaId === 'created_at'}
							<span class="dir-celda dir-celda--fecha">{formatFecha(t.created_at)}</span>
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{ id: 'ver', etiqueta: 'Ver detalle', icono: Eye, onClick: () => openDetail(t) },
									{
										id: 'editar',
										etiqueta: 'Editar',
										icono: Pencil,
										onClick: () => openEditModal(t),
										oculta: !puedeEditar
									},
									{
										id: 'eliminar',
										etiqueta: 'Eliminar',
										icono: Trash2,
										onClick: () => {
											terceroToDelete = t;
											showDeleteModal = true;
										},
										peligrosa: true,
										oculta: !puedeEditar
									}
								]}
							/>
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota('vacio')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>No hay terceros en el directorio</h3>
							<p>
								{hasActiveFilter
									? 'No se encontraron terceros con los filtros aplicados.'
									: 'Importa los propietarios de tu flota o crea un tercero manualmente para empezar.'}
							</p>
							{#if hasActiveFilter}
								<button class="btn-secondary" onclick={clearFilters}>Limpiar filtros</button>
							{:else if puedeEditar}
								<div class="flex flex-wrap justify-center gap-2">
									<button class="btn-secondary" onclick={openImportModal}
										>Importar desde flota</button
									>
									<button class="btn-primary" onclick={openCreateModal}>Crear tercero</button>
								</div>
							{/if}
						</div>
					{/snippet}
				</TablaLista>
			</div>

			<PaginadorLista
				pagina={filtros.pagina}
				total={totalTerceros}
				porPagina={POR_PAGINA}
				cargando={isLoading}
				nombreItems="terceros"
				onCambiar={irPagina}
			/>
		</div>
	{/if}
</div>

<!-- Crear / editar: el mismo modal que flota, conductores y clientes. -->
<ModalFormTercero
	open={modalTercero.abierto}
	terceroId={modalTercero.id}
	onclose={() => (modalTercero = { abierto: false, id: null })}
	onguardado={() => cargar(true)}
/>

<!-- Ficha de consulta: la misma de flota, conductores y clientes. -->
<ModalDetalleTercero
	open={detalleId !== null}
	terceroId={detalleId}
	onclose={() => (detalleId = null)}
	oneditar={puedeEditar
		? (id) => {
				detalleId = null;
				modalTercero = { abierto: true, id };
			}
		: undefined}
/>

<!-- ══════════════════════════════════════════════════════════════
     MODAL: Importar desde Vehículos
     ══════════════════════════════════════════════════════════════ -->
{#if showImportModal}
	<div
		class="modal-backdrop"
		onclick={() => (showImportModal = false)}
		onkeydown={(e) => e.key === 'Escape' && (showImportModal = false)}
		role="presentation"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="modal modal--sm"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="tercero-import-title"
			transition:fly={{ y: 20, duration: 240, easing: quintOut }}
		>
			{#if importResult}
				<div class="confirm-icon" aria-hidden="true">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				</div>
				<span class="eyebrow eyebrow--center">Importación</span>
				<h3 id="tercero-import-title">Importación completada</h3>
				<dl class="result-list">
					<div>
						<dt>Importados</dt>
						<dd class="mono">{importResult.importados}</dd>
					</div>
					<div>
						<dt>Duplicados omitidos</dt>
						<dd class="mono">{importResult.duplicados}</dd>
					</div>
					<div>
						<dt>Total procesados</dt>
						<dd class="mono">{importResult.total}</dd>
					</div>
				</dl>
				<footer class="modal-foot">
					<button class="btn-primary" onclick={() => (showImportModal = false)}>Cerrar</button>
				</footer>
			{:else}
				<div class="import-icon" aria-hidden="true">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
						/>
					</svg>
				</div>
				<span class="eyebrow eyebrow--center">Importar desde flota</span>
				<h3 id="tercero-import-title">Propietarios de vehículos</h3>
				<p class="modal-desc">
					Extraeremos los nombres y cédulas/NIT de los propietarios registrados en la flota
					vehicular y los crearemos como terceros. Los duplicados serán omitidos automáticamente.
				</p>
				<footer class="modal-foot">
					<button class="btn-secondary" onclick={() => (showImportModal = false)}>Cancelar</button>
					{#if puedeEditar}
						<button class="btn-primary" onclick={importFromVehiculos} disabled={isImporting}>
							{#if isImporting}
								<svg class="spin" viewBox="0 0 24 24" fill="none">
									<circle
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										stroke-width="3"
										opacity="0.25"
									/>
									<path
										d="M4 12a8 8 0 018-8v0"
										stroke="currentColor"
										stroke-width="3"
										stroke-linecap="round"
									/>
								</svg>
								Importando…
							{:else}
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
									/>
								</svg>
								Importar ahora
							{/if}
						</button>
					{/if}
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* ═══════════════════════════════════════════════════════════════
	   EYEBROW + TIPOGRAFÍA EDITORIAL
	   ═══════════════════════════════════════════════════════════════ */
	.eyebrow {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #16a34a;
		background: rgba(234, 88, 12, 0.08);
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
		font-family: var(--font-sans);
	}
	.eyebrow--center {
		display: block;
		text-align: center;
		margin: 0 auto 0.5rem;
		width: fit-content;
	}

	h1,
	h3 {
		font-family: var(--font-display);
		color: #0f172a;
		letter-spacing: -0.01em;
	}

	.mono {
		font-family: var(--font-sans);
	}

	/* Dato que falta: se lee como ausencia, no como valor. */
	

	/* ═══════════════════════════════════════════════════════════════
	   PAGINACIÓN
	   ═══════════════════════════════════════════════════════════════ */

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ═══════════════════════════════════════════════════════════════
	   ALERT
	   ═══════════════════════════════════════════════════════════════ */
	.alert {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.95rem 1.1rem;
		border-radius: 12px;
		font-size: 0.88rem;
		margin-bottom: 1rem;
	}
	.alert-error {
		background: rgba(220, 38, 38, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.2);
		color: #991b1b;
	}
	.alert-error svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: #dc2626;
	}
	.alert-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.alert-body strong {
		font-weight: 700;
	}
	.alert-body span {
		font-size: 0.82rem;
		color: #b91c1c;
	}

	/* Botones: los globales de `app.css` (.btn-primary / .btn-secondary),
	   igual que el resto de directorios. */

	.spin {
		width: 14px;
		height: 14px;
		animation: spin 0.8s linear infinite;
	}

	/* ═══════════════════════════════════════════════════════════════
	   MODALES
	   ═══════════════════════════════════════════════════════════════ */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.4), rgba(20, 83, 45, 0.55));
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
		overflow-y: auto;
	}
	.modal {
		width: 100%;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 24px;
		padding: 1.5rem 1.5rem 1.25rem;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.modal--sm {
		max-width: 420px;
	}
	

	
	
	
	
	

	.modal-desc {
		font-size: 0.9rem;
		line-height: 1.6;
		color: #33423d;
		margin: 0;
	}

	.modal-foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		justify-content: flex-end;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		margin-top: 0.25rem;
		padding-top: 1rem;
	}

	/* Detalle */
	
	
	
	
	
	
	

	/* Modal iconos especiales */
	.confirm-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: linear-gradient(135deg, #16a34a, #087a57);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 0.5rem;
		box-shadow: 0 8px 24px rgba(234, 88, 12, 0.3);
	}
	.confirm-icon svg {
		width: 30px;
		height: 30px;
	}

	.import-icon {
		width: 56px;
		height: 56px;
		border-radius: 16px;
		background: linear-gradient(135deg, rgba(234, 88, 12, 0.1), rgba(8, 122, 87, 0.16));
		color: #014339;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 0.5rem;
		box-shadow: 0 4px 16px rgba(234, 88, 12, 0.18);
	}
	.import-icon svg {
		width: 26px;
		height: 26px;
	}

	.result-list {
		background: #fcfcfb;
		border-radius: 12px;
		padding: 0.85rem 1rem;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.result-list > div {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.35rem 0;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.result-list > div:last-child {
		border-bottom: none;
	}
	.result-list dt {
		font-size: 0.78rem;
		color: #64748b;
		margin: 0;
	}
	.result-list dd {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f172a;
	}
</style>
