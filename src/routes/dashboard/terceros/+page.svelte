<script lang="ts">
	import { page } from '$app/state';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
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

<div class="terceros-page" in:fly={{ y: 20, duration: 500, easing: quintOut }}>
	<!-- ═══ BARRA DE PÁGINA ═══
	     Título, acciones y filtros en un solo bloque. Antes eran dos tarjetas
	     apiladas —un hero editorial con párrafo y una franja de stats, más una
	     barra de filtros aparte— que gastaban ~340 px antes de la primera
	     tarjeta. Los contadores no se pierden: viven ahora dentro de los chips
	     de tipo, que es donde además se usan para filtrar.
	-->
	<header class="page-toolbar" in:fade={{ duration: 400 }}>
		<div class="toolbar-top">
			<div class="toolbar-title">
				<div class="card-icon-sm" aria-hidden="true">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
						/>
					</svg>
				</div>
				<h1>Propietarios y empresas</h1>
			</div>

			<div class="toolbar-actions">
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
			</div>
		</div>

		<div class="toolbar-filters">
			<div class="search-wrap">
				<BuscadorLista
					valor={filtros.q}
					onBuscar={(termino) => ponerFiltro('q', termino)}
					placeholder="Buscar por nombre, identificación, teléfono o correo…"
					etiqueta="Buscar terceros"
				/>
			</div>

			<div class="filter-group">
				<button
					class="chip"
					class:chip--active={filtros.tipo === 'TODOS'}
					onclick={() => ponerFiltro('tipo', 'TODOS')}
				>
					Todos
					<span class="chip-count">{counts.total}</span>
				</button>
				<button
					class="chip"
					class:chip--active={filtros.tipo === 'PERSONA'}
					onclick={() => ponerFiltro('tipo', 'PERSONA')}
				>
					<span class="stat-dot stat-dot--persona" aria-hidden="true"></span>
					Personas
					<span class="chip-count">{counts.personas}</span>
				</button>
				<button
					class="chip"
					class:chip--active={filtros.tipo === 'EMPRESA'}
					onclick={() => ponerFiltro('tipo', 'EMPRESA')}
				>
					<span class="stat-dot stat-dot--empresa" aria-hidden="true"></span>
					Empresas
					<span class="chip-count">{counts.empresas}</span>
				</button>
			</div>

			<div class="sort-group">
				<span class="sort-label">Ordenar</span>
				<button
					class="sort-btn"
					class:sort-btn--active={filtros.orden === 'nombre_completo'}
					onclick={() => toggleSort('nombre_completo')}
				>
					Nombre
					{#if filtros.orden === 'nombre_completo'}
						<svg
							class="h-3 w-3"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2.4"
						>
							{#if filtros.dir === 'asc'}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M4.5 15.75l7.5-7.5 7.5 7.5"
								/>
							{:else}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19.5 8.25l-7.5 7.5-7.5-7.5"
								/>
							{/if}
						</svg>
					{/if}
				</button>
				<button
					class="sort-btn"
					class:sort-btn--active={filtros.orden === 'created_at'}
					onclick={() => toggleSort('created_at')}
				>
					Reciente
					{#if filtros.orden === 'created_at'}
						<svg
							class="h-3 w-3"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2.4"
						>
							{#if filtros.dir === 'asc'}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M4.5 15.75l7.5-7.5 7.5 7.5"
								/>
							{:else}
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19.5 8.25l-7.5 7.5-7.5-7.5"
								/>
							{/if}
						</svg>
					{/if}
				</button>
			</div>

			{#if hasActiveFilter}
				<button class="clear-btn" onclick={clearFilters}>
					<svg
						class="h-3.5 w-3.5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
					Limpiar
				</button>
			{/if}
		</div>
	</header>

	<!-- ═══ CONTENIDO ═══ -->
	{#if isLoading && terceros.length === 0}
		<div class="state-block" in:fade>
			<div class="spin-ring" aria-hidden="true"></div>
			<p>Cargando directorio…</p>
		</div>
	{:else if error && terceros.length === 0}
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
	{:else if terceros.length === 0}
		<div class="empty-state" in:fade>
			<div class="empty-icon">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.4">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
					/>
				</svg>
			</div>
			<span class="eyebrow eyebrow--center">Sin registros</span>
			<h2>No hay terceros en el directorio</h2>
			<p>Importa los propietarios de tu flota o crea un tercero manualmente para empezar.</p>
			<div class="empty-cta">
				<button class="btn-secondary" onclick={openImportModal}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
						/>
					</svg>
					Importar desde flota
				</button>
				<button class="btn-primary" onclick={openCreateModal}>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
					Crear tercero
				</button>
			</div>
		</div>
	{:else}
		<!-- ── LISTA DE CARDS ── -->
		<div class="cards-grid" in:fade={{ duration: 400, delay: 120 }}>
			{#each terceros as t, idx (t.id)}
				<!-- `nombre_completo` es NOT NULL en la base, pero NOT NULL admite la
				     cadena vacía: esas fichas salían con el título en blanco y el
				     avatar mudo, sin nada que indicara de quién eran. -->
				{@const nombre = t.nombre_completo?.trim() || 'Sin nombre'}
				<div
					class="tercero-card"
					onclick={() => openDetail(t)}
					onkeydown={(e) =>
						(e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openDetail(t))}
					role="button"
					tabindex="0"
					in:fly={{ y: 14, duration: 320, delay: idx * 35, easing: quintOut }}
				>
					<header class="card-head">
						<div class="avatar avatar--{t.tipo_persona.toLowerCase()}">
							<span>{t.nombre_completo?.trim() ? initials(nombre) : '?'}</span>
						</div>
						<div class="card-head-text">
							<h3 class:valor-vacio={!t.nombre_completo?.trim()}>{nombre}</h3>
							<span class="tipo-pill tipo-pill--{t.tipo_persona.toLowerCase()}">
								{#if t.tipo_persona === 'EMPRESA'}
									<svg
										class="h-3 w-3"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2.2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
										/>
									</svg>
									Empresa
								{:else}
									<svg
										class="h-3 w-3"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2.2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
										/>
									</svg>
									Persona
								{/if}
							</span>
						</div>
					</header>

					<dl class="card-data">
						<!-- La identificación se pinta siempre, aunque falte. Es lo que
						     distingue a un tercero de otro, así que su ausencia es un dato
						     —una ficha a medio llenar— y no un motivo para ocultar la fila.
						     Además garantiza que el `<dl>` nunca quede vacío: al ir entre
						     dos bordes, vacío dejaba una banda hueca y descuadraba el pie
						     respecto a las fichas vecinas. -->
						<div class="data-row">
							<dt>
								<svg
									class="h-3 w-3"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									stroke-width="2"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zM6 10.5h.008v.008H6V10.5zm0 3h.008v.008H6V13.5zm0 3h.008v.008H6V16.5z"
									/>
								</svg>
								{t.tipo_persona === 'EMPRESA' ? 'NIT' : 'Cédula'}
							</dt>
							{#if t.identificacion}
								<dd class="mono">{t.identificacion}</dd>
							{:else}
								<dd class="valor-vacio">Sin registrar</dd>
							{/if}
						</div>

						{#if t.regimen}
							<div class="data-row">
								<dt>
									<svg
										class="h-3 w-3"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-11.302 0c1.413-.074 2.86-.18 4.302-.323a48.4 48.4 0 014.302.323 1.866 1.866 0 011.976 2.192M12 3v1.5M12 21v-1.5"
										/>
									</svg>
									Régimen
								</dt>
								<dd>{REGIMEN_SHORT[t.regimen] || t.regimen}</dd>
							</div>
						{/if}

						{#if t.telefono}
							<div class="data-row">
								<dt>
									<svg
										class="h-3 w-3"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
										/>
									</svg>
									Teléfono
								</dt>
								<dd class="mono">{t.telefono}</dd>
							</div>
						{/if}

						{#if t.correo}
							<div class="data-row data-row--truncate">
								<dt>
									<svg
										class="h-3 w-3"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										stroke-width="2"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
										/>
									</svg>
									Correo
								</dt>
								<dd class="truncate">{t.correo}</dd>
							</div>
						{/if}

						<!-- Sin teléfono ni correo no hay forma de contactar al tercero.
						     Decirlo es más útil que dejar el hueco: distingue «no tiene»
						     de «no cargó todavía». -->
						{#if !t.telefono && !t.correo}
							<p class="sin-contacto">Sin teléfono ni correo</p>
						{/if}
					</dl>

					<footer class="card-foot">
						<span class="card-link">
							Ver detalle
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
								/>
							</svg>
						</span>
						<div class="card-actions" onclick={(e) => e.stopPropagation()} role="presentation">
							<button
								type="button"
								class="icon-btn"
								title="Editar"
								aria-label="Editar {t.nombre_completo}"
								onclick={(e) => openEditModal(t, e)}
							>
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
									/>
								</svg>
							</button>
							<button
								type="button"
								class="icon-btn icon-btn--danger"
								title="Eliminar"
								aria-label="Eliminar {t.nombre_completo}"
								onclick={(e) => openDeleteModal(t, e)}
							>
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
									/>
								</svg>
							</button>
						</div>
					</footer>
				</div>
			{/each}
		</div>

		<!-- ── PAGINACIÓN ── -->
		<PaginadorLista
			pagina={filtros.pagina}
			total={totalTerceros}
			porPagina={POR_PAGINA}
			cargando={isLoading}
			nombreItems="terceros"
			onCambiar={irPagina}
		/>
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
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* ═══════════════════════════════════════════════════════════════
	   PAGE BASE — fondo cálido + tipografía editorial
	   ═══════════════════════════════════════════════════════════════ */
	.terceros-page {
		min-height: 100vh;
		background: #fcfcfb;
		font-family: 'Inter Tight', system-ui, sans-serif;
		color: #1a1a1a;
		padding: 1.5rem 1.25rem 3rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   EYEBROW + TIPOGRAFÍA EDITORIAL
	   ═══════════════════════════════════════════════════════════════ */
	.eyebrow {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
		font-family: 'JetBrains Mono', monospace;
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
		font-family: 'Fraunces', Georgia, serif;
		color: #0f172a;
		letter-spacing: -0.01em;
	}

	.mono {
		font-family: 'JetBrains Mono', monospace;
	}

	/* ═══════════════════════════════════════════════════════════════
	   BARRA DE PÁGINA — título, acciones y filtros en un solo bloque
	   ═══════════════════════════════════════════════════════════════ */
	.page-toolbar {
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		padding: 0.85rem 1rem;
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		box-shadow: var(--shadow-card);
	}
	.toolbar-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.toolbar-title {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}
	.toolbar-title h1 {
		font-size: 1.25rem;
		font-weight: 500;
		line-height: 1.2;
		margin: 0;
	}
	.toolbar-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		flex-shrink: 0;
	}
	.toolbar-filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-subtle);
	}

	/* El contador vive dentro del chip que filtra por ese mismo tipo. Antes
	   era una franja de stats aparte, que repetía la palabra «Personas» a
	   dos centímetros del chip «Personas» y no se podía pulsar. */
	.chip-count {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--text-muted);
	}
	/* El contador toma el color del chip activo en vez de fijar un tono propio:
	   así no hay que mantener una pareja de verdes por repo. */
	.chip--active .chip-count {
		color: inherit;
	}
	.stat-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	/* Literal y no `var(--emerald-500)`: en cotransmeq ese token es naranja,
	   pero esta pantalla es verde en los dos repos. */
	.stat-dot--persona {
		background: #f97316;
	}
	.stat-dot--empresa {
		background: #3b82f6;
	}

	.search-wrap {
		position: relative;
		flex: 1;
		min-width: 240px;
	}
	.search-icon {
		position: absolute;
		left: 0.9rem;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		color: #9a9a9a;
		pointer-events: none;
	}
	.search-input {
		width: 100%;
		padding: 0.6rem 0.9rem 0.6rem 2.5rem;
		font-family: inherit;
		font-size: 0.88rem;
		color: #1a1a1a;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 10px;
		outline: none;
		transition: all 0.2s;
	}
	.search-input::placeholder {
		color: #9a9a9a;
	}
	.search-input:focus {
		background: white;
		border-color: rgba(249, 115, 22, 0.4);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
	}

	.filter-group {
		display: flex;
		gap: 0.35rem;
		padding: 0.25rem;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 12px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.8rem;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #4a4a4a;
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.chip:hover {
		color: #0f172a;
	}
	.chip--active {
		background: white;
		color: #166534;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}

	.sort-group {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding-left: 0.25rem;
	}
	.sort-label {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
	}
	.sort-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.7rem;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #6b6b6b;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.sort-btn:hover {
		color: #0f172a;
		background: rgba(0, 0, 0, 0.03);
	}
	.sort-btn--active {
		color: #166534;
		background: rgba(249, 115, 22, 0.08);
		border-color: rgba(249, 115, 22, 0.15);
	}

	.clear-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.75rem;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #6b6b6b;
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.clear-btn:hover {
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.3);
		background: rgba(220, 38, 38, 0.04);
	}

	/* ═══════════════════════════════════════════════════════════════
	   LIST CARDS (grid)
	   ═══════════════════════════════════════════════════════════════ */
	/* Rejilla fluida en vez de cuatro puntos de ruptura: el ancho real del
	   `main` cambia al colapsar la barra lateral, y una cascada de `@media`
	   se queda clavada en 4 columnas justo cuando sobra sitio para 6. */
	.cards-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		gap: 1.1rem;
	}

	.tercero-card {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 20px;
		padding: 1.25rem;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: inherit;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
		transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		outline: none;
	}
	.tercero-card:hover,
	.tercero-card:focus-visible {
		transform: translateY(-3px);
		border-color: rgba(249, 115, 22, 0.3);
		box-shadow: 0 12px 32px rgba(249, 115, 22, 0.12);
	}

	.card-head {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.card-head-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.card-head-text h3 {
		font-size: 1.02rem;
		font-weight: 600;
		line-height: 1.3;
		margin: 0;
		color: #0f172a;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.avatar {
		flex-shrink: 0;
		width: 44px;
		height: 44px;
		border-radius: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.avatar--persona {
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.14), rgba(234, 88, 12, 0.18));
		color: #166534;
	}
	.avatar--empresa {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.14), rgba(37, 99, 235, 0.18));
		color: #1e40af;
	}

	.tipo-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.55rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border-radius: 5px;
		width: fit-content;
	}
	.tipo-pill--persona {
		background: rgba(249, 115, 22, 0.08);
		color: #c2410c;
	}
	.tipo-pill--empresa {
		background: rgba(59, 130, 246, 0.1);
		color: #1d4ed8;
	}

	.card-data {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		margin: 0;
		padding: 0.85rem 0;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
		/* Absorbe el alto sobrante para que el pie quede abajo. La rejilla ya
		   estira todas las fichas de una fila a la misma altura, pero sin esto
		   el «Ver detalle» de una ficha con un solo dato subía a media tarjeta
		   y no cuadraba con el de al lado. */
		flex: 1;
	}

	/* Dato que falta: se lee como ausencia, no como valor. */
	.valor-vacio {
		color: #9a9a9a;
		font-style: italic;
	}
	.sin-contacto {
		margin: 0;
		font-size: 0.75rem;
		color: #9a9a9a;
		font-style: italic;
	}
	.data-row {
		display: grid;
		grid-template-columns: 100px 1fr;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.82rem;
		min-height: 22px;
	}
	.data-row dt {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
		margin: 0;
	}
	.data-row dt svg {
		color: #9a9a9a;
		flex-shrink: 0;
	}
	.data-row dd {
		margin: 0;
		font-size: 0.85rem;
		color: #0f172a;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.data-row dd.mono {
		font-size: 0.78rem;
	}

	.card-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.card-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: #f97316;
		transition: gap 0.2s;
	}
	.card-link svg {
		width: 14px;
		height: 14px;
	}
	.tercero-card:hover .card-link {
		gap: 0.65rem;
	}

	.card-actions {
		display: flex;
		gap: 0.25rem;
	}
	.icon-btn {
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 8px;
		color: #6b6b6b;
		cursor: pointer;
		transition: all 0.2s;
	}
	.icon-btn svg {
		width: 14px;
		height: 14px;
	}
	.icon-btn:hover {
		color: #f97316;
		border-color: rgba(249, 115, 22, 0.3);
		background: rgba(249, 115, 22, 0.06);
	}
	.icon-btn--danger:hover {
		color: #dc2626;
		border-color: rgba(220, 38, 38, 0.3);
		background: rgba(220, 38, 38, 0.06);
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
	.pagination-info {
		font-size: 0.78rem;
		color: #6b6b6b;
		margin: 0;
	}
	.pagination-info .mono {
		color: #0f172a;
		font-weight: 700;
	}
	.pagination-controls {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.page-arrow,
	.page-num {
		min-width: 32px;
		height: 32px;
		padding: 0 0.5rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		color: #4a4a4a;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.page-arrow svg {
		width: 14px;
		height: 14px;
	}
	.page-arrow:hover:not(:disabled),
	.page-num:hover {
		background: #fcfcfb;
		color: #0f172a;
	}
	.page-arrow:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.page-num--active {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
		box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);
	}
	.page-num--active:hover {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
	}
	.page-ellipsis {
		padding: 0 0.4rem;
		color: #9a9a9a;
		font-size: 0.78rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   ESTADOS (loading / error / empty)
	   ═══════════════════════════════════════════════════════════════ */
	.state-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		padding: 4rem 1.5rem;
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 20px;
		color: #6b6b6b;
		font-size: 0.88rem;
	}
	.spin-ring {
		width: 32px;
		height: 32px;
		border: 2.5px solid rgba(249, 115, 22, 0.15);
		border-top-color: #f97316;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 4rem 1.5rem;
		background: white;
		border: 1px dashed rgba(0, 0, 0, 0.12);
		border-radius: 24px;
		text-align: center;
	}
	.empty-state h2 {
		font-size: 1.4rem;
		font-weight: 500;
		margin: 0.25rem 0 0;
	}
	.empty-state p {
		font-size: 0.9rem;
		color: #4a4a4a;
		max-width: 420px;
		margin: 0;
		line-height: 1.6;
	}
	.empty-icon {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(234, 88, 12, 0.12));
		color: #f97316;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.5rem;
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.12);
	}
	.empty-icon svg {
		width: 32px;
		height: 32px;
	}
	.empty-cta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		justify-content: center;
		margin-top: 1rem;
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
		font-family: 'Inter Tight', system-ui, sans-serif;
		font-size: 0.85rem;
		font-weight: 600;
		border-radius: 11px;
		cursor: pointer;
		transition: all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.btn-primary {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.28);
	}
	.btn-primary:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
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
		color: #1a1a1a;
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
		background: linear-gradient(135deg, rgba(15, 31, 26, 0.4), rgba(10, 20, 16, 0.55));
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
		color: #6b6b6b;
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
		color: #4a4a4a;
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
		color: #1a1a1a;
		background: #fcfcfb;
		border: 1px solid rgba(0, 0, 0, 0.1);
		border-radius: 10px;
		outline: none;
		transition: all 0.2s;
	}
	.input::placeholder {
		color: #9a9a9a;
	}
	.input:focus {
		background: white;
		border-color: rgba(249, 115, 22, 0.4);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
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
		color: #4a4a4a;
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
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.1), rgba(234, 88, 12, 0.14));
		color: #166534;
		border-color: rgba(249, 115, 22, 0.35);
	}
	.seg--active.seg--empresa {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(37, 99, 235, 0.14));
		color: #1e40af;
		border-color: rgba(59, 130, 246, 0.35);
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
		color: #6b6b6b;
		font-family: 'JetBrains Mono', monospace;
		margin: 0;
	}
	.detail-data dd {
		margin: 0;
		font-size: 0.92rem;
		color: #0f172a;
		font-weight: 500;
	}
	.detail-data dd a {
		color: #f97316;
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
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 0.5rem;
		box-shadow: 0 8px 24px rgba(249, 115, 22, 0.3);
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
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.1), rgba(234, 88, 12, 0.16));
		color: #166534;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 0.5rem;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.18);
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
		color: #6b6b6b;
		margin: 0;
	}
	.result-list dd {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f172a;
	}

	.card-icon {
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: linear-gradient(135deg, #f97316, #ea580c);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	}
	.card-icon svg {
		width: 24px;
		height: 24px;
	}
</style>
