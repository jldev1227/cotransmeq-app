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

	// Modal state
	let showModal = $state(false);
	let editingTercero = $state<Tercero | null>(null);
	let isSaving = $state(false);
	let modalError = $state<string | null>(null);

	let form = $state(resetForm());

	function resetForm() {
		return {
			nombre_completo: '',
			identificacion: '',
			telefono: '',
			correo: '',
			direccion: '',
			tipo_persona: 'PERSONA' as 'PERSONA' | 'EMPRESA',
			regimen: '' as string,
			notas: ''
		};
	}

	let showDeleteModal = $state(false);
	let terceroToDelete = $state<Tercero | null>(null);

	let showImportModal = $state(false);
	let isImporting = $state(false);
	let importResult = $state<{ importados: number; duplicados: number; total: number } | null>(null);

	let showDetail = $state(false);
	let detailTercero = $state<Tercero | null>(null);

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

	// ─── CRUD Modal ───
	function openCreateModal() {
		editingTercero = null;
		form = resetForm();
		modalError = null;
		showModal = true;
	}

	function openEditModal(t: Tercero, e?: Event) {
		e?.stopPropagation();
		editingTercero = t;
		form = {
			nombre_completo: t.nombre_completo,
			identificacion: t.identificacion || '',
			telefono: t.telefono || '',
			correo: t.correo || '',
			direccion: t.direccion || '',
			tipo_persona: t.tipo_persona,
			regimen: t.regimen || '',
			notas: t.notas || ''
		};
		modalError = null;
		showModal = true;
	}

	function closeModal() {
		showModal = false;
		editingTercero = null;
		modalError = null;
	}

	async function saveTercero() {
		if (!form.nombre_completo.trim()) {
			modalError = 'El nombre es requerido';
			return;
		}
		isSaving = true;
		modalError = null;
		try {
			const payload: any = {
				nombre_completo: form.nombre_completo.trim(),
				identificacion: form.identificacion.trim() || null,
				telefono: form.telefono.trim() || null,
				correo: form.correo.trim() || null,
				direccion: form.direccion.trim() || null,
				tipo_persona: form.tipo_persona,
				regimen: form.regimen || null,
				notas: form.notas.trim() || null
			};

			if (editingTercero) {
				await tercerosAPI.actualizar(editingTercero.id, payload);
			} else {
				await tercerosAPI.crear(payload);
			}
			closeModal();
			cargar(true);
		} catch (err: any) {
			modalError = err.response?.data?.message || err.message || 'Error al guardar';
		} finally {
			isSaving = false;
		}
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
			await tercerosAPI.eliminar(terceroToDelete.id);
			closeDeleteModal();
			cargar(true);
		} catch (err: any) {
			errorOperacion = err.response?.data?.message || err.message || 'Error al eliminar';
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
		detailTercero = t;
		showDetail = true;
	}

	function closeDetail() {
		showDetail = false;
		detailTercero = null;
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

<!-- ══════════════════════════════════════════════════════════════
     MODAL: Crear / Editar Tercero
     ══════════════════════════════════════════════════════════════ -->
{#if showModal}
	<div
		class="modal-backdrop"
		onclick={closeModal}
		onkeydown={(e) => e.key === 'Escape' && closeModal()}
		role="presentation"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="modal modal--md"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="tercero-modal-title"
			transition:fly={{ y: 24, duration: 280, easing: quintOut }}
		>
			<header class="modal-head">
				<div>
					<span class="eyebrow">{editingTercero ? 'Editar registro' : 'Nuevo registro'}</span>
					<h2 id="tercero-modal-title">
						{editingTercero ? 'Editar tercero' : 'Nuevo tercero'}
					</h2>
				</div>
				<button class="modal-close" onclick={closeModal} aria-label="Cerrar">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</header>

			{#if modalError}
				<div class="alert alert-error" in:fly={{ y: -8, duration: 240 }}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
						/>
					</svg>
					<strong>{modalError}</strong>
				</div>
			{/if}

			<form
				onsubmit={(e) => {
					e.preventDefault();
					saveTercero();
				}}
				class="modal-form"
			>
				<!-- Tipo persona -->
				<div class="field">
					<span class="field-label">Tipo de tercero</span>
					<div class="segmented">
						<button
							type="button"
							class="seg"
							class:seg--active={form.tipo_persona === 'PERSONA'}
							class:seg--persona={form.tipo_persona === 'PERSONA'}
							onclick={() => (form.tipo_persona = 'PERSONA')}
						>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
								/>
							</svg>
							Persona natural
						</button>
						<button
							type="button"
							class="seg"
							class:seg--active={form.tipo_persona === 'EMPRESA'}
							class:seg--empresa={form.tipo_persona === 'EMPRESA'}
							onclick={() => (form.tipo_persona = 'EMPRESA')}
						>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
								/>
							</svg>
							Empresa
						</button>
					</div>
				</div>

				<div class="field">
					<label for="t-nombre" class="field-label">
						{form.tipo_persona === 'EMPRESA' ? 'Razón social' : 'Nombre completo'}
						<span class="field-required">*</span>
					</label>
					<input
						id="t-nombre"
						type="text"
						bind:value={form.nombre_completo}
						required
						class="input"
						placeholder={form.tipo_persona === 'EMPRESA'
							? 'Transportes del Valle S.A.S.'
							: 'Juan Carlos Pérez'}
					/>
				</div>

				<div class="field-grid">
					<div class="field">
						<label for="t-ident" class="field-label">
							{form.tipo_persona === 'EMPRESA' ? 'NIT' : 'Cédula'}
						</label>
						<input
							id="t-ident"
							type="text"
							bind:value={form.identificacion}
							class="input"
							placeholder={form.tipo_persona === 'EMPRESA' ? '900123456-1' : '12345678'}
						/>
					</div>
					<div class="field">
						<label for="t-regimen" class="field-label">Régimen fiscal</label>
						<select id="t-regimen" bind:value={form.regimen} class="input">
							<option value="">Sin especificar</option>
							{#each Object.entries(REGIMENES) as [key, label]}
								<option value={key}>{label}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="field-grid">
					<div class="field">
						<label for="t-tel" class="field-label">Teléfono</label>
						<input
							id="t-tel"
							type="tel"
							bind:value={form.telefono}
							class="input"
							placeholder="3201234567"
						/>
					</div>
					<div class="field">
						<label for="t-correo" class="field-label">Correo</label>
						<input
							id="t-correo"
							type="email"
							bind:value={form.correo}
							class="input"
							placeholder="correo@ejemplo.com"
						/>
					</div>
				</div>

				<div class="field">
					<label for="t-dir" class="field-label">Dirección</label>
					<input
						id="t-dir"
						type="text"
						bind:value={form.direccion}
						class="input"
						placeholder="Calle 15 #23-45, Ciudad"
					/>
				</div>

				<div class="field">
					<label for="t-notas" class="field-label">Notas</label>
					<textarea
						id="t-notas"
						bind:value={form.notas}
						rows="3"
						class="input"
						placeholder="Observaciones adicionales…"
					></textarea>
				</div>

				<footer class="modal-foot">
					<button type="button" class="btn-secondary" onclick={closeModal}>Cancelar</button>
					<button type="submit" class="btn-primary" disabled={isSaving}>
						{#if isSaving}
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
							Guardando…
						{:else}
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
							</svg>
							{editingTercero ? 'Actualizar' : 'Crear tercero'}
						{/if}
					</button>
				</footer>
			</form>
		</div>
	</div>
{/if}

<!-- ══════════════════════════════════════════════════════════════
     MODAL: Detalle del tercero
     ══════════════════════════════════════════════════════════════ -->
{#if showDetail && detailTercero}
	<div
		class="modal-backdrop"
		onclick={closeDetail}
		onkeydown={(e) => e.key === 'Escape' && closeDetail()}
		role="presentation"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="modal modal--md"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="tercero-detail-title"
			transition:fly={{ y: 24, duration: 280, easing: quintOut }}
		>
			<header class="modal-head">
				<div>
					<span class="eyebrow">
						{detailTercero.tipo_persona === 'EMPRESA' ? 'Empresa' : 'Persona natural'}
					</span>
					<h2 id="tercero-detail-title" class:valor-vacio={!detailTercero.nombre_completo?.trim()}>
						{detailTercero.nombre_completo?.trim() || 'Sin nombre'}
					</h2>
				</div>
				<button class="modal-close" onclick={closeDetail} aria-label="Cerrar">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</header>

			<dl class="detail-data">
				<div>
					<dt>{detailTercero.tipo_persona === 'EMPRESA' ? 'NIT' : 'Cédula'}</dt>
					{#if detailTercero.identificacion}
						<dd class="mono">{detailTercero.identificacion}</dd>
					{:else}
						<dd class="valor-vacio">Sin registrar</dd>
					{/if}
				</div>
				{#if detailTercero.regimen}
					<div>
						<dt>Régimen fiscal</dt>
						<dd>{REGIMENES[detailTercero.regimen] || detailTercero.regimen}</dd>
					</div>
				{/if}
				{#if detailTercero.telefono}
					<div>
						<dt>Teléfono</dt>
						<dd class="mono">{detailTercero.telefono}</dd>
					</div>
				{/if}
				{#if detailTercero.correo}
					<div>
						<dt>Correo</dt>
						<dd><a href="mailto:{detailTercero.correo}">{detailTercero.correo}</a></dd>
					</div>
				{/if}
				{#if detailTercero.direccion}
					<div>
						<dt>Dirección</dt>
						<dd>{detailTercero.direccion}</dd>
					</div>
				{/if}
				<div>
					<dt>Creado</dt>
					<dd>
						{new Date(detailTercero.created_at).toLocaleDateString('es-CO', {
							year: 'numeric',
							month: 'long',
							day: 'numeric'
						})}
					</dd>
				</div>
				{#if detailTercero.notas}
					<div>
						<dt>Notas</dt>
						<dd>{detailTercero.notas}</dd>
					</div>
				{/if}
			</dl>

			<footer class="modal-foot">
				{#if puedeEditar}
					<button
						class="btn-secondary"
						onclick={(e) => {
							if (detailTercero) {
								closeDetail();
								openEditModal(detailTercero, e);
							}
						}}
					>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
							/>
						</svg>
						Editar
					</button>
				{/if}
				<button class="btn-primary" onclick={closeDetail}>Cerrar</button>
			</footer>
		</div>
	</div>
{/if}

<!-- ══════════════════════════════════════════════════════════════
     MODAL: Confirmar Eliminación
     ══════════════════════════════════════════════════════════════ -->
{#if showDeleteModal && terceroToDelete}
	<div
		class="modal-backdrop"
		onclick={closeDeleteModal}
		onkeydown={(e) => e.key === 'Escape' && closeDeleteModal()}
		role="presentation"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="modal modal--sm"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="alertdialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="tercero-delete-title"
			transition:fly={{ y: 20, duration: 240, easing: quintOut }}
		>
			<div class="danger-icon" aria-hidden="true">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
					/>
				</svg>
			</div>
			<span class="eyebrow eyebrow--danger">Acción irreversible</span>
			<h3 id="tercero-delete-title">Eliminar tercero</h3>
			<p class="modal-desc">
				¿Estás seguro que deseas eliminar a
				<strong>{terceroToDelete.nombre_completo}</strong>? Esta acción no se puede deshacer.
			</p>
			<footer class="modal-foot">
				<button class="btn-secondary" onclick={closeDeleteModal}>Cancelar</button>
				{#if puedeEditar}
					<button class="btn-danger" onclick={deleteTercero}>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
							/>
						</svg>
						Sí, eliminar
					</button>
				{/if}
			</footer>
		</div>
	</div>
{/if}

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
	.eyebrow--danger {
		color: #b91c1c;
		background: rgba(220, 38, 38, 0.08);
	}

	h1,
	h2,
	h3 {
		font-family: var(--font-display);
		color: #0f172a;
		letter-spacing: -0.01em;
	}

	.mono {
		font-family: var(--font-sans);
	}

	/* Dato que falta: se lee como ausencia, no como valor. */
	.valor-vacio {
		color: #94a3b8;
		font-style: italic;
	}
	.data-row dd.mono {
		font-size: 0.78rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   PAGINACIÓN
	   ═══════════════════════════════════════════════════════════════ */
	.pagination {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.5rem;
		padding: 0.85rem 1.25rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 14px;
	}
	.pagination-info .mono {
		color: #0f172a;
		font-weight: 700;
	}
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

	/* ═══════════════════════════════════════════════════════════════
	   BOTONES
	   ═══════════════════════════════════════════════════════════════ */
	.btn-primary,
	.btn-secondary,
	.btn-danger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.65rem 1.15rem;
		font-family: var(--font-sans);
		font-size: 0.85rem;
		font-weight: 600;
		border-radius: 11px;
		cursor: pointer;
		transition: all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.btn-primary {
		background: linear-gradient(135deg, #16a34a, #087a57);
		color: white;
		box-shadow: 0 4px 16px rgba(234, 88, 12, 0.28);
	}
	.btn-primary:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(234, 88, 12, 0.4);
	}
	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.btn-primary svg,
	.btn-secondary svg,
	.btn-danger svg {
		width: 15px;
		height: 15px;
	}

	.btn-secondary {
		background: white;
		color: #0f172a;
		border-color: rgba(0, 0, 0, 0.12);
	}
	.btn-secondary:hover:not(:disabled) {
		background: #fcfcfb;
		border-color: rgba(0, 0, 0, 0.2);
	}

	.btn-danger {
		background: linear-gradient(135deg, #dc2626, #b91c1c);
		color: white;
		box-shadow: 0 4px 16px rgba(220, 38, 38, 0.28);
	}
	.btn-danger:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(220, 38, 38, 0.4);
	}

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
	.modal--md {
		max-width: 560px;
	}

	.modal-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.modal-head h2 {
		font-size: 1.4rem;
		font-weight: 500;
		margin: 0.35rem 0 0;
		color: #0f172a;
	}
	.modal-close {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 8px;
		color: #64748b;
		cursor: pointer;
		transition: all 0.2s;
	}
	.modal-close svg {
		width: 16px;
		height: 16px;
	}
	.modal-close:hover {
		color: #0f172a;
		border-color: rgba(0, 0, 0, 0.2);
	}

	.modal-desc {
		font-size: 0.9rem;
		line-height: 1.6;
		color: #33423d;
		margin: 0;
	}
	.modal-desc strong {
		color: #0f172a;
		font-weight: 600;
	}

	.modal-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	@media (min-width: 540px) {
		.field-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	.field-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: #0f172a;
	}
	.field-required {
		color: #dc2626;
		margin-left: 0.1rem;
	}
	.input {
		width: 100%;
		padding: 0.6rem 0.85rem;
		font-family: inherit;
		font-size: 0.88rem;
		color: #0f172a;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		outline: none;
		transition: all 0.2s;
	}
	.input::placeholder {
		color: #94a3b8;
	}
	.input:focus {
		background: white;
		border-color: rgba(234, 88, 12, 0.4);
		box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.1);
	}
	textarea.input {
		resize: vertical;
		font-family: inherit;
		line-height: 1.5;
	}

	.segmented {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.seg {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.65rem 0.8rem;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		background: #fcfcfb;
		color: #33423d;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.seg svg {
		width: 16px;
		height: 16px;
	}
	.seg:hover {
		color: #0f172a;
		border-color: rgba(0, 0, 0, 0.15);
	}
	.seg--active.seg--persona {
		background: linear-gradient(135deg, rgba(234, 88, 12, 0.1), rgba(8, 122, 87, 0.14));
		color: #014339;
		border-color: rgba(234, 88, 12, 0.35);
	}
	.seg--active.seg--empresa {
		background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(217, 119, 6, 0.14));
		color: #92400e;
		border-color: rgba(245, 158, 11, 0.35);
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
	.detail-data {
		background: #fcfcfb;
		border-radius: 14px;
		padding: 1rem 1.15rem;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.detail-data > div {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.65rem 0;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.detail-data > div:last-child {
		border-bottom: none;
	}
	.detail-data dt {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
		font-family: var(--font-sans);
		margin: 0;
	}
	.detail-data dd {
		margin: 0;
		font-size: 0.92rem;
		color: #0f172a;
		font-weight: 500;
	}
	.detail-data dd a {
		color: #16a34a;
		text-decoration: none;
	}
	.detail-data dd a:hover {
		text-decoration: underline;
	}

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

	.danger-icon {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: rgba(220, 38, 38, 0.08);
		color: #dc2626;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 0.5rem;
		border: 1px solid rgba(220, 38, 38, 0.15);
	}
	.danger-icon svg {
		width: 26px;
		height: 26px;
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
