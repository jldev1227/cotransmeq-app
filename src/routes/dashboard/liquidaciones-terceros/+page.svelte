<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page as pageStore } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { authStore } from '$lib/stores/auth';
	import {
		liquidacionesTercerosDescuentosAPI,
		type ConceptoDescuento
	} from '$lib/api/liquidaciones-terceros-descuentos';
	import LiquidacionTerceroForm from '$lib/components/LiquidacionTerceroForm.svelte';
	import UsuarioBadge from '$lib/components/common/UsuarioBadge.svelte';
	import HistorialVersionesModal from '$lib/components/liquidaciones-terceros/HistorialVersionesModal.svelte';
	import BorradorProgressModal from '$lib/components/liquidaciones-terceros/BorradorProgressModal.svelte';
	import TabAdicionalesMensual from '$lib/components/liquidaciones-terceros/TabAdicionalesMensual.svelte';
	import { borradorQueueStore, borradorQueue } from '$lib/stores/borradorQueue';
	import { connectSocket, getSocket } from '$lib/socketClient';
	import { toast } from 'svelte-sonner';

	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(parseFloat(String(v)) || 0);

	const MESES = [
		'ENERO',
		'FEBRERO',
		'MARZO',
		'ABRIL',
		'MAYO',
		'JUNIO',
		'JULIO',
		'AGOSTO',
		'SEPTIEMBRE',
		'OCTUBRE',
		'NOVIEMBRE',
		'DICIEMBRE'
	];

	function fmtDate(d: string | null) {
		if (!d) return '—';
		const date = new Date(d);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMin = Math.floor(diffMs / 60000);
		const diffHr = Math.floor(diffMs / 3600000);
		const diffDay = Math.floor(diffMs / 86400000);
		if (diffMin < 1) return 'Ahora';
		if (diffMin < 60) return `hace ${diffMin} min`;
		if (diffHr < 24) return `hace ${diffHr}h`;
		if (diffDay < 7) return `hace ${diffDay}d`;
		return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	function fmtDateFull(d: string | null) {
		if (!d) return '';
		return new Date(d).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	let activeTab: 'historial' | 'formulario' | 'mensual' = $state('historial');

	function readTabFromUrl(url: string | undefined): 'historial' | 'formulario' | 'mensual' {
		if (typeof window === 'undefined') return 'historial';
		try {
			const tab = new URL(url ?? window.location.href).searchParams.get('tab');
			if (tab === 'formulario' || tab === 'nueva' || tab === 'nuevo') return 'formulario';
			if (tab === 'mensual' || tab === 'adicionales') return 'mensual';
			return 'historial';
		} catch {
			return 'historial';
		}
	}

	function setTab(tab: 'historial' | 'formulario' | 'mensual', pushUrl = true) {
		activeTab = tab;
		if (typeof window === 'undefined') return;
		if (!pushUrl) return;
		const url = new URL(window.location.href);
		if (tab === 'historial') url.searchParams.delete('tab');
		else if (tab === 'formulario') url.searchParams.set('tab', 'nueva');
		else if (tab === 'mensual') url.searchParams.set('tab', 'mensual');
		const search = url.searchParams.toString();
		const newUrl = url.pathname + (search ? '?' + search : '') + url.hash;
		window.history.replaceState(window.history.state, '', newUrl);
	}

	let loading = $state(true);
	let historial: Array<{
		id: string;
		consecutivo: string | null;
		placa: string;
		mes: number | null;
		anio: number | null;
		valor_liquidar: number;
		total_costos_laborales: number;
		total_gastos_operativos: number;
		total_impuestos: number;
		total_descuentos: number;
		total_pagar: number;
		estado: string;
		tercero?: { nombre_completo: string } | null;
		created_at?: string;
		creado_por?: { id: string; nombre: string; correo: string } | null;
		snapshot_count?: number;
	}> = $state([]);
	let total = $state(0);
	let page = $state(1);
	const limit = 50;

	let filterPlaca = $state('');
	let filterMes = $state('');
	let filterAnio = $state('');
	let filterBusqueda = $state('');
	let filterBusquedaInput = $state('');
	let mostrarFiltros = $state(false);

	// ── Sort toggle ──
	// Ordena por fecha de creación (desc por defecto). Click en el header
	// de la columna Fecha alterna entre desc y asc.
	type SortKey = 'created_at' | 'placa' | 'anio' | 'mes' | 'total_pagar';
	type SortDir = 'asc' | 'desc';
	let sortKey: SortKey = $state('created_at');
	let sortDir: SortDir = $state('desc');
	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = key === 'placa' ? 'asc' : 'desc';
		}
	}

	// ── IDs de liquidaciones recién creadas (socket) ──
	// Set de IDs que se muestran con un badge "NUEVO" + bg llamativo.
	// Se hidrata desde localStorage para que persistan tras refresh.
	const STORAGE_KEY_NUEVAS = 'lt:nuevas_recientes';
	const STORAGE_KEY_NUEVAS_TTL_MS = 1000 * 60 * 60 * 24; // 24h
	let recienCreadas = $state<Set<string>>(new Set());
	let highlightClearAt = $state<number>(0);

	function loadRecienCreadasFromStorage() {
		if (typeof window === 'undefined') return;
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY_NUEVAS);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Record<string, number>;
			const now = Date.now();
			const fresh = new Set<string>();
			for (const [id, ts] of Object.entries(parsed || {})) {
				if (typeof ts === 'number' && now - ts < STORAGE_KEY_NUEVAS_TTL_MS) {
					fresh.add(id);
				}
			}
			recienCreadas = fresh;
			// Limpiar el storage de los ya vencidos
			saveRecienCreadasToStorage();
		} catch (e) {
			console.warn('[lt-page] No se pudo cargar STORAGE_KEY_NUEVAS:', e);
		}
	}

	function saveRecienCreadasToStorage() {
		if (typeof window === 'undefined') return;
		try {
			const obj: Record<string, number> = {};
			recienCreadas.forEach((id) => {
				obj[id] = Date.now();
			});
			window.localStorage.setItem(STORAGE_KEY_NUEVAS, JSON.stringify(obj));
		} catch (e) {
			console.warn('[lt-page] No se pudo guardar STORAGE_KEY_NUEVAS:', e);
		}
	}

	function markRecienCreada(id: string) {
		if (!id) return;
		recienCreadas = new Set([...recienCreadas, id]);
		highlightClearAt = Date.now() + 60_000; // el highlight animado dura 60s
		saveRecienCreadasToStorage();
	}

	// ── Debounce para el search input ──
	// 1 segundo entre que el usuario deja de tipear y se dispara la query.
	// Cancelamos cualquier timeout pendiente al cambiar el valor (incluido
	// pegar/borrar). Al desmontar la página también cancelamos.
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	const SEARCH_DEBOUNCE_MS = 1000;

	function onSearchInput(value: string) {
		filterBusquedaInput = value;
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(() => {
			filterBusqueda = value;
			page = 1;
			cargarHistorial();
		}, SEARCH_DEBOUNCE_MS);
	}

	// Stats
	let stats = $state({
		total: 0,
		BORRADOR: 0,
		LIQUIDADA: 0,
		APROBADA: 0,
		FACTURADA: 0,
		ANULADA: 0,
		REEMPLAZADA: 0
	});

	onMount(async () => {
		activeTab = readTabFromUrl($pageStore.url.toString());
		loadRecienCreadasFromStorage();
		await cargarHistorial();

		// Refresca el historial cuando el editor (u otra pestaña) persiste
		// cambios en cualquier cierre. El gateway emite `row:updated:global`
		// además del room-scoped `row:updated`, para que esta página reciba
		// las actualizaciones sin tener que unirse a cada room por cierre.
		connectSocket();
		const socket = getSocket();
		if (socket) {
			socket.on('row:updated:global', onRowUpdatedGlobal);
			// Cuando cualquier usuario crea una liquidación nueva (vía form
			// Nueva), recibimos este evento. Marcamos la fila como "NUEVO" y
			// refrescamos la lista en background para que aparezca de una vez.
			socket.on('liquidacion-tercero:created', onLiquidacionTerceroCreated);
			// Cuando se crea o elimina una liquidación MENSUAL, refrescar
			// la lista y, si estamos en el tab mensual, recargar la cabecera.
			socket.on('liquidacion-tercero-mensual:created', onLiquidacionMensualCreated);
			socket.on('liquidacion-tercero-mensual:deleted', onLiquidacionMensualDeleted);
		}
	});

	onDestroy(() => {
		const socket = getSocket();
		if (socket) {
			socket.off('row:updated:global', onRowUpdatedGlobal);
			socket.off('liquidacion-tercero:created', onLiquidacionTerceroCreated);
			socket.off('liquidacion-tercero-mensual:created', onLiquidacionMensualCreated);
			socket.off('liquidacion-tercero-mensual:deleted', onLiquidacionMensualDeleted);
		}
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
	});

	async function onRowUpdatedGlobal(payload: { id: string }) {
		// Si la fila afectada está en la página actual, refresca la lista para
		// reflejar los totales persistidos en backend. Si no, no hace nada
		// (el siguiente load ya traerá los datos correctos).
		if (historial.some((it) => it.id === payload.id)) {
			await cargarHistorial();
		}
	}

	async function onLiquidacionTerceroCreated(payload: { id: string; placa?: string }) {
		// Marca el ID como recién creado y refresca la lista en background.
		// Si la fila entra en la página actual (top de la lista por sort
		// por defecto created_at desc) se mostrará resaltada. Si no, queda
		// en localStorage y se mostrará en cuanto el usuario navegue/filtre.
		markRecienCreada(payload.id);
		// Solo recargamos si estamos en el tab de historial
		if (activeTab === 'historial') {
			await cargarHistorial();
		}
	}

	async function onLiquidacionMensualCreated(payload: { id: string }) {
		// Cuando un usuario genera un nuevo borrador mensual desde otro
		// cliente, refrescamos la lista del tab historial (si está visible)
		// o dejamos que el tab mensual lo recargue al activarse.
		if (activeTab === 'historial') {
			await cargarHistorial();
		}
		toast.info(`Otro usuario creó una liquidación mensual (${payload.id.slice(0, 8)}…)`, {
			description: 'Recarga el tab "Mensual" para verla.'
		});
	}

	async function onLiquidacionMensualDeleted(payload: { id: string }) {
		if (activeTab === 'historial') {
			await cargarHistorial();
		}
	}

	async function cargarHistorial() {
		loading = true;
		try {
			const params: any = { page, limit };
			if (filterPlaca) params.placa = filterPlaca;
			if (filterMes) params.mes = parseInt(filterMes);
			if (filterAnio) params.anio = parseInt(filterAnio);
			if (filterBusqueda) params.busqueda = filterBusqueda;

			const res = await liquidacionesTercerosDescuentosAPI.listarHistorial(params);
			let items = res.items || [];
			total = res.total || 0;

			// Orden client-side (UX): el backend ya ordena, pero el sort
			// toggle es per-columna, así que aplicamos el sort aquí para
			// que el click sea instantáneo sin round-trip al backend.
			items = [...items].sort((a: any, b: any) => {
				const av = a?.[sortKey];
				const bv = b?.[sortKey];
				const dir = sortDir === 'asc' ? 1 : -1;
				if (av == null && bv == null) return 0;
				if (av == null) return 1;
				if (bv == null) return -1;
				if (typeof av === 'string' && typeof bv === 'string') {
					return av.localeCompare(bv) * dir;
				}
				return (Number(av) - Number(bv)) * dir;
			});

			historial = items;

			// Compute stats from all items (not paginated)
			if (page === 1) {
				stats = {
					total: res.total || 0,
					BORRADOR: 0,
					LIQUIDADA: 0,
					APROBADA: 0,
					FACTURADA: 0,
					ANULADA: 0,
					REEMPLAZADA: 0
				};
				// Stats are approximated from current page; for full stats we'd need a separate endpoint
			}
		} catch (e) {
			console.error('Error cargando historial:', e);
		} finally {
			loading = false;
		}
	}

	function fmtPlaca(p: string) {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s;
	}

	function getEstadoBadge(estado: string) {
		const map: Record<
			string,
			{ bg: string; text: string; border: string; borderHex: string; label: string }
		> = {
			BORRADOR: {
				bg: 'rgba(0,0,0,0.04)',
				text: '#4a4a4a',
				border: 'rgba(0,0,0,0.08)',
				borderHex: 'rgba(0,0,0,0.12)',
				label: 'Borrador'
			},
			LIQUIDADA: {
				bg: 'rgba(59,130,246,0.08)',
				text: '#1d4ed8',
				border: 'rgba(59,130,246,0.22)',
				borderHex: 'rgba(59,130,246,0.30)',
				label: 'Liquidada'
			},
			APROBADA: {
				bg: 'rgba(16,185,129,0.10)',
				text: '#047857',
				border: 'rgba(16,185,129,0.25)',
				borderHex: 'rgba(16,185,129,0.35)',
				label: 'Aprobada'
			},
			FACTURADA: {
				bg: 'rgba(139,92,246,0.08)',
				text: '#6d28d9',
				border: 'rgba(139,92,246,0.22)',
				borderHex: 'rgba(139,92,246,0.30)',
				label: 'Facturada'
			},
			ANULADA: {
				bg: 'rgba(220,38,38,0.06)',
				text: '#b91c1c',
				border: 'rgba(220,38,38,0.20)',
				borderHex: 'rgba(220,38,38,0.30)',
				label: 'Anulada'
			},
			REEMPLAZADA: {
				bg: 'rgba(245,158,11,0.08)',
				text: '#b45309',
				border: 'rgba(245,158,11,0.22)',
				borderHex: 'rgba(245,158,11,0.30)',
				label: 'Reemplazada'
			}
		};
		return map[estado] || map.BORRADOR;
	}

	function getEstadoColor(estado: string) {
		const map: Record<string, string> = {
			BORRADOR: '#9ca3af',
			LIQUIDADA: '#3b82f6',
			APROBADA: '#10b981',
			FACTURADA: '#8b5cf6',
			ANULADA: '#ef4444',
			REEMPLAZADA: '#f59e0b'
		};
		return map[estado] || '#9ca3af';
	}

	// Permissions
	let userAreas = $derived(
		Array.isArray($authStore.user?.area)
			? $authStore.user.area
			: $authStore.user?.area
				? [$authStore.user.area]
				: []
	);
	let isAdmin = $derived(userAreas.includes('administracion'));

	// State change — loading tracked per id para poder mostrar spinner
	// en la fila exacta que se está procesando, sin bloquear las demás.
	let estadoLoading = $state<Record<string, boolean>>({});
	let anularModalOpen = $state(false);
	let anularTargetId = $state('');
	let anularMotivo = $state('');

	const ESTADO_LOADING_MSG: Record<string, string> = {
		LIQUIDADA: 'Marcando como liquidada…',
		APROBADA: 'Aprobando liquidación…',
		BORRADOR: 'Revirtiendo a borrador…',
		ANULADA: 'Anulando liquidación…'
	};

	const ESTADO_SUCCESS_MSG: Record<string, string> = {
		LIQUIDADA: 'Liquidación marcada como LIQUIDADA',
		APROBADA: 'Liquidación aprobada',
		BORRADOR: 'Liquidación revertida a BORRADOR',
		ANULADA: 'Liquidación anulada'
	};

	async function cambiarEstado(id: string, estado: string, motivo?: string) {
		if (estadoLoading[id]) return;

		estadoLoading[id] = true;
		const toastId = toast.loading(
			ESTADO_LOADING_MSG[estado] || 'Actualizando estado…'
		);

		try {
			await liquidacionesTercerosDescuentosAPI.cambiarEstado(id, estado, motivo);
			await cargarHistorial();
			toast.success(ESTADO_SUCCESS_MSG[estado] || 'Estado actualizado', {
				id: toastId
			});
		} catch (err: any) {
			toast.error(err.message || 'Error al cambiar estado', { id: toastId });
		} finally {
			estadoLoading[id] = false;
		}
	}

	function abrirAnular(id: string) {
		anularTargetId = id;
		anularMotivo = '';
		anularModalOpen = true;
	}

	async function confirmarAnulacion() {
		if (!anularMotivo.trim()) {
			alert('Debes indicar el motivo de la anulacion');
			return;
		}
		await cambiarEstado(anularTargetId, 'ANULADA', anularMotivo.trim());
		anularModalOpen = false;
		anularTargetId = '';
		anularMotivo = '';
	}

	// Soft delete
	let deleteModalOpen = $state(false);
	let deleteTargetId = $state('');
	let deleteTargetPlaca = $state('');
	let deleteConfirmText = $state('');
	let deleteProcessing = $state(false);

	function abrirEliminar(item: (typeof historial)[number]) {
		deleteTargetId = item.id;
		deleteTargetPlaca = fmtPlaca(item.placa);
		deleteConfirmText = '';
		deleteModalOpen = true;
	}

	async function confirmarEliminacion() {
		if (deleteConfirmText.trim().toUpperCase() !== 'ELIMINAR') {
			alert('Debes escribir ELIMINAR para confirmar');
			return;
		}
		deleteProcessing = true;
		try {
			await liquidacionesTercerosDescuentosAPI.softDelete(deleteTargetId);
			deleteModalOpen = false;
			deleteTargetId = '';
			deleteTargetPlaca = '';
			deleteConfirmText = '';
			await cargarHistorial();
		} catch (err: any) {
			alert(err.message || 'Error al eliminar');
		} finally {
			deleteProcessing = false;
		}
	}

	function abrirPreview(item: (typeof historial)[number]) {
		goto(`/dashboard/liquidaciones-terceros/${item.id}?mode=view`);
	}

	function editarLiquidacion(item: (typeof historial)[number]) {
		if ((item.estado || 'BORRADOR') !== 'BORRADOR') {
			alert('Solo se pueden editar liquidaciones en estado BORRADOR');
			return;
		}
		goto(`/dashboard/liquidaciones-terceros/editar/${item.id}`);
	}

	// Snapshots
	let historialModalOpen = $state(false);
	let historialModalId = $state('');
	let historialModalVersion = $state(0);

	function abrirHistorialVersiones(item: (typeof historial)[number]) {
		historialModalId = item.id;
		historialModalVersion = item.snapshot_count || 0;
		historialModalOpen = true;
	}

	async function limpiarFiltros() {
		if (searchDebounceTimer) {
			clearTimeout(searchDebounceTimer);
			searchDebounceTimer = null;
		}
		filterPlaca = '';
		filterMes = '';
		filterAnio = '';
		filterBusqueda = '';
		filterBusquedaInput = '';
		page = 1;
		await cargarHistorial();
	}

	// ── Borrador queue modal ──
	// $derived: el modal se abre/cierra reactivamente según el estado del store.
	// Se abre para estados activos (queued/running/locked) y se mantiene abierto
	// para complete/error/cancelled hasta que el usuario lo cierre.
	let borradorModalOpen = $derived($borradorQueueStore !== null);
</script>

<svelte:head>
	<title>Liquidaciones de Terceros · Cotransmeq</title>
</svelte:head>

<svelte:window
	on:keydown={(e) => {
		if (e.key !== 'Escape') return;
		if (deleteModalOpen) deleteModalOpen = false;
		if (anularModalOpen) anularModalOpen = false;
	}}
/>

<div class="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-6" in:fade={{ duration: 400 }}>
	<!-- ═══════════════════════════════════════════
	     HEADER GLASS — estilo editorial landing-transmeralda
	     ═══════════════════════════════════════════ -->
	<div
		class="glass soft-shadow flex-shrink-0 rounded-2xl border border-gray-200/50 p-6"
		class:relative={mostrarFiltros}
		class:z-40={mostrarFiltros}
	>
		<div class="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
			<!-- Título — Fraunces serif + eyebrow JetBrains Mono -->
			<div class="flex items-center gap-4">
				<div class="card-icon flex-shrink-0">
					<svg
						class="h-6 w-6"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
				</div>
				<div class="min-w-0">
					<h1 class="flex items-center gap-3 font-display text-2xl text-[#0f1f1a]" style="line-height:1.15">
						Liquidaciones de Terceros
						<span class="eyebrow">GAF-FR-11</span>
					</h1>
					<p class="mt-0.5 text-[13px] text-[#6b6b6b]">
						Liquidación de ingresos para propietarios de vehículos
					</p>
				</div>
			</div>

			<!-- Acciones -->
			<div class="flex flex-wrap items-center gap-2.5">
				<!-- Tabs -->
				<div
					class="inline-flex gap-1 rounded-xl border border-[rgba(0,0,0,0.08)] bg-white/80 p-1 shadow-sm"
				>
					<button
						onclick={() => {
							setTab('historial');
							cargarHistorial();
						}}
						class="apple-transition flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold
							{activeTab === 'historial'
							? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-sm'
							: 'text-[#4a4a4a] hover:bg-[#faf7f2]'}"
					>
						<svg
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M4 6h16M4 10h16M4 14h16M4 18h16"
							/>
						</svg>
						Historial
					</button>
					<button
						onclick={() => setTab('formulario')}
						class="apple-transition flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold
							{activeTab === 'formulario'
							? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-sm'
							: 'text-[#4a4a4a] hover:bg-[#faf7f2]'}"
					>
						<svg
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
						</svg>
						Nueva
					</button>
					<button
						onclick={() => setTab('mensual')}
						class="apple-transition flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold
							{activeTab === 'mensual'
							? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-sm'
							: 'text-[#4a4a4a] hover:bg-[#faf7f2]'}"
					>
						<svg
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
						</svg>
						Mensual
					</button>
				</div>

				<!-- Búsqueda — debounced 1s -->
				<div class="filter-field" style="width:auto">
					<div class="relative">
						<input
							type="text"
							value={filterBusquedaInput}
							oninput={(e) => onSearchInput((e.currentTarget as HTMLInputElement).value)}
							placeholder="Buscar placa, tercero, consecutivo…"
							class="input-glow apple-transition w-72 rounded-xl border border-[rgba(0,0,0,0.12)] bg-white/80 py-2.5 pr-4 pl-10 text-sm text-[#1a1a1a] placeholder:text-[#9a9a9a]"
						/>
						<svg
							class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#9a9a9a]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							/>
						</svg>
					</div>
				</div>

				<!-- Filtros -->
				<button
					onclick={() => (mostrarFiltros = !mostrarFiltros)}
					class="apple-transition flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold
						{mostrarFiltros
						? 'border-[rgba(16,185,129,0.30)] bg-[rgba(16,185,129,0.08)] text-[#065f46]'
						: 'border-[rgba(0,0,0,0.12)] bg-white text-[#1a1a1a] hover:border-[rgba(0,0,0,0.20)] hover:bg-[#faf7f2]'}"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
						/>
					</svg>
					Filtros
				</button>
			</div>
		</div>

		<!-- Panel de filtros expandible — filter-panel editorial -->
		{#if mostrarFiltros}
			<div class="filter-panel" transition:fly={{ y: -8, duration: 250 }}>
				<div class="filter-panel-header">
					<div class="filter-panel-title">Filtros de búsqueda</div>
					<button
						class="filter-close"
						onclick={() => (mostrarFiltros = false)}
						aria-label="Cerrar filtros"
					>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
							><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
						>
					</button>
				</div>
				<div class="filter-grid-4">
					<div class="filter-field">
						<label for="filter-mes" class="filter-field-label">Mes</label>
						<select id="filter-mes" bind:value={filterMes}>
							<option value="">Todos los meses</option>
							{#each MESES as m, i}<option value={i + 1}>{m}</option>{/each}
						</select>
					</div>
					<div class="filter-field">
						<label for="filter-anio" class="filter-field-label">Año</label>
						<select id="filter-anio" bind:value={filterAnio}>
							<option value="">Todos los años</option>
							{#each [2024, 2025, 2026, 2027] as y}<option value={y}>{y}</option>{/each}
						</select>
					</div>
					<div class="filter-field">
						<label for="filter-busqueda" class="filter-field-label">Búsqueda libre</label>
						<input
							id="filter-busqueda"
							type="search"
							value={filterBusquedaInput}
							oninput={(e) => onSearchInput((e.currentTarget as HTMLInputElement).value)}
							placeholder="Placa, tercero, consecutivo…"
						/>
					</div>
				</div>
				<div class="filter-actions">
					<button class="filter-clear" onclick={limpiarFiltros}>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
							><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
						>
						Limpiar filtros
					</button>
					<button class="btn-primary" onclick={cargarHistorial}>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							/></svg
						>
						Buscar
					</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- ═══════════════════════════════════════════
	     TABLA — table-card editorial (landing-transmeralda)
	     ═══════════════════════════════════════════ -->
	{#if activeTab === 'historial'}
		<div
			class="table-card flex min-h-0 flex-1 flex-col"
			in:fly={{ y: 12, duration: 400, delay: 150, easing: quintOut }}
		>
			<!-- Leyenda de estados — strip editorial -->
			<div
				class="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[rgba(0,0,0,0.06)] bg-[#faf7f2]/60 px-5 py-2.5"
			>
				<span class="font-mono-meta text-[10px]" style="letter-spacing:0.12em;color:#6b6b6b"
					>Estados</span
				>
				{#each [{ estado: 'BORRADOR', label: 'Borrador' }, { estado: 'LIQUIDADA', label: 'Liquidada' }, { estado: 'APROBADA', label: 'Aprobada' }, { estado: 'FACTURADA', label: 'Facturada' }, { estado: 'ANULADA', label: 'Anulada' }, { estado: 'REEMPLAZADA', label: 'Reemplazada' }] as item}
					<span class="flex items-center gap-1.5 rounded-full px-2 py-0.5">
						<span
							class="h-2 w-2 flex-shrink-0 rounded-full"
							style="background-color: {getEstadoColor(item.estado)}"
						></span>
						<span class="text-[11px] font-medium text-[#4a4a4a]">{item.label}</span>
					</span>
				{/each}
			</div>

			{#if loading}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
					<div class="spinner" style="width:36px;height:36px;border-width:3px"></div>
					<p class="text-[13px] text-[#6b6b6b]">Cargando liquidaciones…</p>
				</div>
			{:else if historial.length === 0}
				<div class="flex flex-1 flex-col items-center justify-center gap-4 p-12">
					<div class="card-icon" style="opacity:0.45;filter:grayscale(0.4)">
						<svg
							class="h-6 w-6"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
					<div class="text-center">
						<h3 class="mb-1 font-display text-[18px] text-[#0f1f1a]">No hay liquidaciones</h3>
						<p class="text-[13px] text-[#6b6b6b]">
							{filterBusqueda || filterMes || filterAnio
								? 'No se encontraron resultados con los filtros aplicados'
								: 'Comienza creando una nueva liquidación'}
						</p>
					</div>
					{#if filterBusqueda || filterMes || filterAnio}
						<button class="btn-secondary" onclick={limpiarFiltros}>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M6 18L18 6M6 6l12 12"
								/></svg
							>
							Limpiar filtros
						</button>
					{:else}
						<button class="btn-primary" onclick={() => setTab('formulario')}>
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 6v6m0 0v6m0-6h6m-6 0H6"
								/></svg
							>
							Nueva liquidación
						</button>
					{/if}
				</div>
			{:else}
				<!-- Desktop table — header mono uppercase tracking -->
				<div class="hidden min-h-0 flex-1 overflow-auto lg:block">
					<table class="w-full border-collapse text-sm">
						<thead>
							<tr class="table-header sticky top-0 z-10 backdrop-blur-sm">
								<th class="text-left">Consecutivo</th>
								<th class="text-left">
									<button
										type="button"
										class="apple-transition inline-flex items-center gap-1 hover:text-[#1a1a1a]"
										onclick={() => toggleSort('placa')}
									>
										Placa
										<svg class="h-3 w-3" viewBox="0 0 8 12" fill="currentColor" style="opacity:{sortKey === 'placa' ? 1 : 0.3};transform:rotate({sortKey === 'placa' && sortDir === 'asc' ? 180 : 0}deg);transition:transform 0.2s,opacity 0.2s"><path d="M4 0l4 4H0z" /><path d="M4 12L0 8h8z" /></svg>
									</button>
								</th>
								<th class="text-left">Propietario</th>
								<th class="text-left">
									<button
										type="button"
										class="apple-transition inline-flex items-center gap-1 hover:text-[#1a1a1a]"
										onclick={() => toggleSort('anio')}
									>
										Período
										<svg class="h-3 w-3" viewBox="0 0 8 12" fill="currentColor" style="opacity:{sortKey === 'anio' ? 1 : 0.3};transform:rotate({sortKey === 'anio' && sortDir === 'asc' ? 180 : 0}deg);transition:transform 0.2s,opacity 0.2s"><path d="M4 0l4 4H0z" /><path d="M4 12L0 8h8z" /></svg>
									</button>
								</th>
								<th class="text-right">V/Liquidar</th>
								<th class="text-right">Descuentos</th>
								<th class="text-right">
									<button
										type="button"
										class="apple-transition inline-flex items-center gap-1 hover:text-[#1a1a1a]"
										onclick={() => toggleSort('total_pagar')}
									>
										Total Pagar
										<svg class="h-3 w-3" viewBox="0 0 8 12" fill="currentColor" style="opacity:{sortKey === 'total_pagar' ? 1 : 0.3};transform:rotate({sortKey === 'total_pagar' && sortDir === 'asc' ? 180 : 0}deg);transition:transform 0.2s,opacity 0.2s"><path d="M4 0l4 4H0z" /><path d="M4 12L0 8h8z" /></svg>
									</button>
								</th>
								<th class="text-center">Estado</th>
								<th class="text-left">Creado por</th>
								<th class="text-left">
									<button
										type="button"
										class="apple-transition inline-flex items-center gap-1 hover:text-[#1a1a1a]"
										onclick={() => toggleSort('created_at')}
									>
										Fecha
										<svg class="h-3 w-3" viewBox="0 0 8 12" fill="currentColor" style="opacity:{sortKey === 'created_at' ? 1 : 0.3};transform:rotate({sortKey === 'created_at' && sortDir === 'asc' ? 180 : 0}deg);transition:transform 0.2s,opacity 0.2s"><path d="M4 0l4 4H0z" /><path d="M4 12L0 8h8z" /></svg>
									</button>
								</th>
								<th class="text-center">Versión</th>
								<th
									class="sticky right-0 text-center"
									style="background:var(--bg-base);border-bottom:1px solid var(--border-subtle)"
									>Acciones</th
								>
							</tr>
						</thead>
						<tbody class="divide-y divide-[rgba(0,0,0,0.04)] bg-white">
							{#each historial as item, index (item.id)}
								{@const badge = getEstadoBadge(item.estado || 'BORRADOR')}
								{@const totalDesc = item.total_descuentos || 0}
								{@const rowBusy = !!estadoLoading[item.id]}
								{@const isNuevo = recienCreadas.has(item.id)}
								{@const highlightActive = isNuevo && Date.now() < highlightClearAt}
								<tr
									class="table-row transition-opacity duration-200"
									class:opacity-55={rowBusy}
									class:pointer-events-none={rowBusy}
									class:lt-row-new={isNuevo}
									class:lt-row-new-pulse={highlightActive}
									in:fly={{ y: 6, duration: 220, delay: index * 18, easing: quintOut }}
								>
									<td class="px-3.5 py-2.5">
										<div class="flex items-center gap-1.5">
											{#if item.consecutivo}
												<span class="code-badge" title="Consecutivo de la liquidación final">
													{item.consecutivo}
												</span>
											{:else}
												<span class="text-[11px] text-[#9a9a9a] italic">sin consecutivo</span>
											{/if}
											{#if isNuevo}
												<span
													class="lt-nuevo-badge"
													title="Liquidación recién registrada"
												>
													<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
													NUEVO
												</span>
											{/if}
										</div>
									</td>
									<td class="px-3.5 py-2.5">
										<span
											class="font-mono text-[12.5px] font-semibold text-[#1a1a1a]"
											style="letter-spacing:0.02em">{fmtPlaca(item.placa)}</span
										>
									</td>
									<td class="px-3.5 py-2.5">
										<p
											class="max-w-[150px] truncate text-[12.5px] text-[#1a1a1a]"
											title={item.tercero?.nombre_completo}
										>
											{item.tercero?.nombre_completo || '—'}
										</p>
									</td>
									<td class="px-3.5 py-2.5">
										{#if item.mes && item.anio}
											<div class="flex flex-col leading-tight">
												<span class="font-mono-meta text-[10px]" style="color:#047857"
													>{MESES[item.mes - 1]}</span
												>
												<span
													class="font-mono text-[9.5px] text-[#9a9a9a]"
													style="letter-spacing:0.04em">{item.anio}</span
												>
											</div>
										{:else}
											<span class="text-[12px] text-[#9a9a9a]">—</span>
										{/if}
									</td>
									<td class="px-3.5 py-2.5 text-right">
										<span class="font-mono text-[12px] text-[#4a4a4a]" style="font-weight:500"
											>{COP(item.valor_liquidar)}</span
										>
									</td>
									<td class="px-3.5 py-2.5 text-right">
										<span class="font-mono text-[12px]" style="color:#991b1b;font-weight:600"
											>{COP(totalDesc)}</span
										>
									</td>
									<td class="px-3.5 py-2.5 text-right">
										<span class="font-mono text-[12.5px]" style="color:#065f46;font-weight:700"
											>{COP(item.total_pagar)}</span
										>
									</td>
									<td class="px-3.5 py-2.5 text-center">
										<div class="flex items-center justify-center gap-1.5">
											{#if rowBusy}
												<svg
													class="h-3.5 w-3.5 animate-spin"
													style="color:#047857"
													fill="none"
													viewBox="0 0 24 24"
												>
													<circle
														class="opacity-25"
														cx="12"
														cy="12"
														r="10"
														stroke="currentColor"
														stroke-width="4"
													></circle>
													<path
														class="opacity-75"
														fill="currentColor"
														d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
													></path>
												</svg>
											{/if}
											<span
												class="status-pill {badge.bg} {badge.text}"
												style="border:1px solid {badge.borderHex}">{badge.label}</span
											>
										</div>
									</td>
									<td class="px-3.5 py-2.5">
										{#if item.creado_por}
											<UsuarioBadge
												nombre={item.creado_por.nombre}
												correo={item.creado_por.correo}
											/>
										{:else}
											<span class="text-[11px] text-[#9a9a9a] italic">—</span>
										{/if}
									</td>
									<td class="px-3.5 py-2.5">
										<span
											class="text-[12px] text-[#6b6b6b]"
											title={fmtDateFull(item.created_at || null)}
										>
											{fmtDate(item.created_at || null)}
										</span>
									</td>
									<td class="px-3.5 py-2.5 text-center">
										{#if item.snapshot_count && item.snapshot_count > 0}
											<button
												class="apple-transition rounded-md border border-[rgba(139,92,246,0.25)] bg-[rgba(139,92,246,0.08)] px-2 py-0.5 font-mono text-[10px] font-bold text-[#6d28d9] hover:border-[rgba(139,92,246,0.45)] hover:bg-[rgba(139,92,246,0.14)]"
												style="letter-spacing:0.04em"
												onclick={() => abrirHistorialVersiones(item)}
												title="Ver historial de versiones"
											>
												v{item.snapshot_count}
											</button>
										{:else}
											<span class="text-[10px] text-[#9a9a9a]">—</span>
										{/if}
									</td>
									<td
										class="sticky right-0 px-3.5 py-2.5 backdrop-blur-sm"
										style="background:white"
									>
										<div class="flex items-center justify-center gap-0.5">
											<button
												class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(16,185,129,0.08)] hover:text-[#059669]"
												title="Ver PDF"
												onclick={() => abrirPreview(item)}
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.8"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
													/>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
													/>
												</svg>
											</button>
											{#if (item.estado || 'BORRADOR') === 'BORRADOR'}
												<button
													class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(59,130,246,0.08)] hover:text-[#2563eb]"
													title="Editar"
													onclick={() => editarLiquidacion(item)}
												>
													<svg
														class="h-4 w-4"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														stroke-width="1.8"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
														/>
													</svg>
												</button>
												<button
													class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(16,185,129,0.08)] hover:text-[#059669] disabled:cursor-not-allowed disabled:opacity-40"
													title="Liquidar"
													disabled={estadoLoading[item.id]}
													onclick={() => cambiarEstado(item.id, 'LIQUIDADA')}
												>
													{#if estadoLoading[item.id]}
														<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
															<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
															<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
														</svg>
													{:else}
														<svg
															class="h-4 w-4"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
															stroke-width="1.8"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
															/>
														</svg>
													{/if}
												</button>
											{/if}
											{#if (item.estado || 'BORRADOR') === 'LIQUIDADA' && isAdmin}
												<button
													class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(16,185,129,0.08)] hover:text-[#059669] disabled:cursor-not-allowed disabled:opacity-40"
													title="Aprobar"
													disabled={estadoLoading[item.id]}
													onclick={() => cambiarEstado(item.id, 'APROBADA')}
												>
													{#if estadoLoading[item.id]}
														<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
															<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
															<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
														</svg>
													{:else}
														<svg
															class="h-4 w-4"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
															stroke-width="1.8"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M5 13l4 4L19 7"
															/>
														</svg>
													{/if}
												</button>
											{/if}
											{#if (item.estado || 'BORRADOR') === 'LIQUIDADA'}
												<button
													class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(245,158,11,0.10)] hover:text-[#b45309] disabled:cursor-not-allowed disabled:opacity-40"
													title="Revertir a Borrador"
													disabled={estadoLoading[item.id]}
													onclick={() => cambiarEstado(item.id, 'BORRADOR')}
												>
													{#if estadoLoading[item.id]}
														<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
															<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
															<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
														</svg>
													{:else}
														<svg
															class="h-4 w-4"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
															stroke-width="1.8"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
															/>
														</svg>
													{/if}
												</button>
											{/if}
											{#if (item.estado || 'BORRADOR') === 'APROBADA' && isAdmin}
												<button
													class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(245,158,11,0.10)] hover:text-[#b45309] disabled:cursor-not-allowed disabled:opacity-40"
													title="Revertir a Liquidada (solo administradores)"
													disabled={estadoLoading[item.id]}
													onclick={() => cambiarEstado(item.id, 'LIQUIDADA')}
												>
													{#if estadoLoading[item.id]}
														<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
															<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
															<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
														</svg>
													{:else}
														<svg
															class="h-4 w-4"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
															stroke-width="1.8"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
															/>
														</svg>
													{/if}
												</button>
											{/if}
											{#if !['ANULADA', 'FACTURADA', 'REEMPLAZADA'].includes(item.estado || 'BORRADOR')}
												<button
													class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(220,38,38,0.08)] hover:text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-40"
													title="Anular"
													disabled={estadoLoading[item.id]}
													onclick={() => abrirAnular(item.id)}
												>
													<svg
														class="h-4 w-4"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														stroke-width="1.8"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
														/>
													</svg>
												</button>
											{/if}
											<button
												class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(0,0,0,0.05)] hover:text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40"
												title="Eliminar"
												disabled={estadoLoading[item.id]}
												onclick={() => abrirEliminar(item)}
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.8"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
													/>
												</svg>
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Mobile cards -->
				<div class="min-h-0 flex-1 overflow-y-auto lg:hidden">
					<div class="divide-y divide-[rgba(0,0,0,0.05)]">
						{#each historial as item, index (item.id)}
							{@const badge = getEstadoBadge(item.estado || 'BORRADOR')}
							{@const totalDesc = item.total_descuentos || 0}
							{@const rowBusy = !!estadoLoading[item.id]}
							{@const isNuevo = recienCreadas.has(item.id)}
							{@const highlightActive = isNuevo && Date.now() < highlightClearAt}
							<div
								class="relative flex table-row gap-0 transition-opacity duration-200"
								class:opacity-55={rowBusy}
								class:pointer-events-none={rowBusy}
								class:lt-row-new={isNuevo}
								class:lt-row-new-pulse={highlightActive}
								in:fly={{ y: 6, duration: 220, delay: index * 18, easing: quintOut }}
							>
								<div
									class="w-1 flex-shrink-0 rounded-l-sm"
									style="background-color: {getEstadoColor(item.estado || 'BORRADOR')}"
								></div>
								<div class="min-w-0 flex-1 px-4 py-3.5">
									<div class="mb-2 flex items-start justify-between gap-2">
										<div class="min-w-0 flex-1">
											<p
												class="font-mono text-[14px] font-semibold text-[#1a1a1a]"
												style="letter-spacing:0.02em"
											>
												{fmtPlaca(item.placa)}
											</p>
											<div class="mt-1 flex flex-wrap items-center gap-1.5">
												{#if item.consecutivo}
													<span class="code-badge">{item.consecutivo}</span>
												{/if}
												{#if isNuevo}
													<span
														class="lt-nuevo-badge"
														title="Liquidación recién registrada"
													>
														<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
														NUEVO
													</span>
												{/if}
											</div>
											<p class="mt-1 truncate text-[12px] text-[#6b6b6b]">
												{item.tercero?.nombre_completo || 'Sin propietario'}
											</p>
										</div>
										<div class="flex flex-shrink-0 items-center gap-1.5">
											{#if rowBusy}
												<svg
													class="h-3.5 w-3.5 animate-spin"
													style="color:#047857"
													fill="none"
													viewBox="0 0 24 24"
												>
													<circle
														class="opacity-25"
														cx="12"
														cy="12"
														r="10"
														stroke="currentColor"
														stroke-width="4"
													></circle>
													<path
														class="opacity-75"
														fill="currentColor"
														d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
													></path>
												</svg>
											{/if}
											<span
												class="status-pill"
												style="background:{badge.bg};color:{badge.text};border:1px solid {badge.borderHex}"
												>{badge.label}</span
											>
										</div>
									</div>
									<div class="mb-2 flex items-center justify-between gap-2">
										<div>
											{#if item.mes && item.anio}
												<p class="text-[12px] text-[#4a4a4a]">
													<span class="font-mono-meta" style="color:#047857"
														>{MESES[item.mes - 1]}</span
													>
													<span
														class="font-mono text-[10px] text-[#9a9a9a]"
														style="letter-spacing:0.04em">{item.anio}</span
													>
												</p>
											{/if}
											{#if item.creado_por}
												<p class="text-[10px] text-[#9a9a9a]">
													{fmtDate(item.created_at || null)} · {item.creado_por.nombre}
												</p>
											{/if}
										</div>
										<span class="font-mono text-[12.5px]" style="color:#065f46;font-weight:700"
											>{COP(item.total_pagar)}</span
										>
									</div>
									<div class="flex items-center justify-between gap-2">
										<div class="flex items-center gap-1">
											{#if item.snapshot_count && item.snapshot_count > 0}
												<button
													class="apple-transition rounded-md border border-[rgba(139,92,246,0.25)] bg-[rgba(139,92,246,0.08)] px-2 py-0.5 font-mono text-[10px] font-bold text-[#6d28d9] hover:bg-[rgba(139,92,246,0.14)]"
													style="letter-spacing:0.04em"
													onclick={() => abrirHistorialVersiones(item)}
													title="Ver historial de versiones">v{item.snapshot_count}</button
												>
											{/if}
										</div>
										<div class="flex items-center gap-0.5">
											<button
												class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(16,185,129,0.08)] hover:text-[#059669]"
												title="Ver PDF"
												onclick={() => abrirPreview(item)}
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.8"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
													/><path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
													/></svg
												>
											</button>
											{#if (item.estado || 'BORRADOR') === 'BORRADOR'}
												<button
													class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(59,130,246,0.08)] hover:text-[#2563eb]"
													title="Editar"
													onclick={() => editarLiquidacion(item)}
												>
													<svg
														class="h-4 w-4"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														stroke-width="1.8"
														><path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
														/></svg
													>
												</button>
											{/if}
											{#if (item.estado || 'BORRADOR') === 'APROBADA' && isAdmin}
												<button
													class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(245,158,11,0.10)] hover:text-[#b45309] disabled:cursor-not-allowed disabled:opacity-40"
													title="Revertir a Liquidada (solo administradores)"
													disabled={estadoLoading[item.id]}
													onclick={() => cambiarEstado(item.id, 'LIQUIDADA')}
												>
													{#if estadoLoading[item.id]}
														<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
															<circle
																class="opacity-25"
																cx="12"
																cy="12"
																r="10"
																stroke="currentColor"
																stroke-width="4"
															></circle>
															<path
																class="opacity-75"
																fill="currentColor"
																d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
															></path>
														</svg>
													{:else}
														<svg
															class="h-4 w-4"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
															stroke-width="1.8"
															><path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
															/></svg
														>
													{/if}
												</button>
											{/if}
											<button
												class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(220,38,38,0.08)] hover:text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-40"
												title="Eliminar"
												disabled={estadoLoading[item.id]}
												onclick={() => abrirEliminar(item)}
											>
												<svg
													class="h-4 w-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
													stroke-width="1.8"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
													/></svg
												>
											</button>
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Paginación — strip editorial -->
				{#if total > limit}
					<div
						class="flex flex-shrink-0 items-center justify-center gap-3 border-t border-[rgba(0,0,0,0.06)] bg-[#faf7f2]/60 px-5 py-3"
					>
						<button
							class="apple-transition rounded-xl border border-[rgba(0,0,0,0.12)] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#1a1a1a] hover:bg-[#faf7f2] disabled:cursor-not-allowed disabled:opacity-40"
							disabled={page <= 1}
							onclick={() => {
								page--;
								cargarHistorial();
							}}>← Anterior</button
						>
						<span class="font-mono text-[11px] text-[#6b6b6b]" style="letter-spacing:0.04em"
							>Página <strong class="text-[#047857]">{page}</strong> de
							{Math.ceil(total / limit)} · <strong class="text-[#1a1a1a]">{total}</strong> registros</span
						>
						<button
							class="apple-transition rounded-xl border border-[rgba(0,0,0,0.12)] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#1a1a1a] hover:bg-[#faf7f2] disabled:cursor-not-allowed disabled:opacity-40"
							disabled={page >= Math.ceil(total / limit)}
							onclick={() => {
								page++;
								cargarHistorial();
							}}>Siguiente →</button
						>
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- TAB: FORMULARIO -->
	{#if activeTab === 'formulario'}
		<div
			class="glass soft-shadow flex min-h-0 flex-1 flex-col overflow-visible rounded-2xl border border-gray-200/50"
			in:fly={{ y: 12, duration: 400, delay: 150, easing: quintOut }}
		>
			<div class="p-6">
				<LiquidacionTerceroForm />
			</div>
		</div>
	{/if}

	<!-- TAB: MENSUAL — adicionales por mes -->
	{#if activeTab === 'mensual'}
		<div
			class="glass soft-shadow flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/50"
			in:fly={{ y: 12, duration: 400, delay: 150, easing: quintOut }}
		>
			<TabAdicionalesMensual />
		</div>
	{/if}
</div>

<!-- ═══ ANULAR MODAL ═══ -->
{#if anularModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[9500] flex items-center justify-center bg-[rgba(15,31,26,0.45)] backdrop-blur-sm"
		aria-hidden="true"
		onclick={(e) => {
			if (e.target === e.currentTarget) {
				anularModalOpen = false;
			}
		}}
	>
		<div
			class="confirm-card w-full max-w-md"
			role="dialog"
			aria-modal="true"
			aria-labelledby="anular-modal-title"
			in:fly={{ y: 20, duration: 400, easing: quintOut }}
		>
			<div class="flex items-center gap-3.5 border-b border-[rgba(0,0,0,0.06)] px-6 pb-4">
				<div
					class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
					style="background:rgba(220,38,38,0.08);color:#dc2626"
				>
					<svg
						class="h-5 w-5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
						/>
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<span class="eyebrow" style="background:rgba(220,38,38,0.08);color:#dc2626"
						>Acción destructiva</span
					>
					<h3
						id="anular-modal-title"
						class="mt-1.5 font-display text-[18px] text-[#0f1f1a]"
						style="line-height:1.2"
					>
						Anular Liquidación
					</h3>
					<p class="text-[12px] text-[#6b6b6b]">Esta acción marcará la liquidación como anulada</p>
				</div>
			</div>
			<div class="px-6 py-5">
				<label for="anular-motivo" class="filter-field-label mb-1.5 block" style="font-size:0.7rem"
					>Motivo de anulación</label
				>
				<textarea
					id="anular-motivo"
					bind:value={anularMotivo}
					class="input-glow apple-transition w-full resize-none rounded-xl border border-[rgba(0,0,0,0.12)] bg-white px-3.5 py-2.5 text-[13.5px] text-[#1a1a1a] placeholder:text-[#9a9a9a] focus:border-[#dc2626]"
					placeholder="Indique el motivo…"
					rows="3"
				></textarea>
			</div>
			<div
				class="flex justify-end gap-2.5 border-t border-[rgba(0,0,0,0.06)] bg-[#faf7f2]/60 px-6 py-4"
				style="border-radius:0 0 24px 24px"
			>
				<button type="button" class="btn-secondary" onclick={() => (anularModalOpen = false)}
					>Cancelar</button
				>
				<button
					type="button"
					class="apple-transition rounded-xl border-none px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
					style="background:linear-gradient(135deg,#dc2626,#b91c1c);box-shadow:0 4px 16px rgba(220,38,38,0.30);cursor:pointer"
					onclick={confirmarAnulacion}
					disabled={!anularMotivo.trim()}
				>
					Anular liquidación
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══ ELIMINAR MODAL ═══ -->
{#if deleteModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[9500] flex items-center justify-center bg-[rgba(15,31,26,0.45)] backdrop-blur-sm"
		aria-hidden="true"
		onclick={(e) => {
			if (e.target === e.currentTarget) {
				deleteModalOpen = false;
			}
		}}
	>
		<div
			class="confirm-card w-full max-w-md"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-modal-title"
			in:fly={{ y: 20, duration: 400, easing: quintOut }}
		>
			<div class="flex items-center gap-3.5 border-b border-[rgba(0,0,0,0.06)] px-6 pb-4">
				<div
					class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
					style="background:rgba(0,0,0,0.06);color:#1a1a1a"
				>
					<svg
						class="h-5 w-5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
						/>
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<span class="eyebrow" style="background:rgba(0,0,0,0.06);color:#1a1a1a">Eliminación</span>
					<h3
						id="delete-modal-title"
						class="mt-1.5 font-display text-[18px] text-[#0f1f1a]"
						style="line-height:1.2"
					>
						Eliminar Liquidación
					</h3>
					<p class="font-mono text-[12px] text-[#6b6b6b]" style="letter-spacing:0.02em">
						Placa <strong class="text-[#1a1a1a]">{deleteTargetPlaca}</strong> · Esta acción no se puede
						deshacer
					</p>
				</div>
			</div>
			<div class="px-6 py-5">
				<p class="mb-3.5 text-[13px] leading-relaxed text-[#4a4a4a]">
					Se marcarán como eliminados la liquidación, sus items y sus conceptos. El registro se
					conserva en base de datos pero dejará de aparecer en el historial.
				</p>
				<label
					for="delete-confirm-text"
					class="filter-field-label mb-1.5 block"
					style="font-size:0.7rem"
					>Escribe <strong class="text-[#1a1a1a]">ELIMINAR</strong> para confirmar</label
				>
				<input
					id="delete-confirm-text"
					type="text"
					bind:value={deleteConfirmText}
					class="input-glow apple-transition w-full rounded-xl border border-[rgba(0,0,0,0.12)] bg-white px-3.5 py-2.5 font-mono text-[13px] text-[#1a1a1a] outline-none"
					style="letter-spacing:0.12em"
					placeholder="ELIMINAR"
					autocomplete="off"
				/>
			</div>
			<div
				class="flex justify-end gap-2.5 border-t border-[rgba(0,0,0,0.06)] bg-[#faf7f2]/60 px-6 py-4"
				style="border-radius:0 0 24px 24px"
			>
				<button
					type="button"
					class="btn-secondary"
					onclick={() => (deleteModalOpen = false)}
					disabled={deleteProcessing}>Cancelar</button
				>
				<button
					type="button"
					class="apple-transition rounded-xl border-none px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
					style="background:linear-gradient(135deg,#1a1a1a,#0a0a0a);box-shadow:0 4px 16px rgba(0,0,0,0.20);cursor:pointer"
					onclick={confirmarEliminacion}
					disabled={deleteProcessing || deleteConfirmText.trim().toUpperCase() !== 'ELIMINAR'}
				>
					{deleteProcessing ? 'Eliminando…' : 'Eliminar definitivamente'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══ HISTORIAL VERSIONES MODAL ═══ -->
<HistorialVersionesModal
	open={historialModalOpen}
	liquidacionId={historialModalId}
	currentVersion={historialModalVersion}
	on:close={() => (historialModalOpen = false)}
/>

<!-- ═══ BORRADOR PROGRESS MODAL (raíz, fuera de transforms) ═══ -->
<BorradorProgressModal
	open={borradorModalOpen}
	job={$borradorQueueStore}
	on:close={() => {
		borradorQueue.dismiss();
	}}
/>
