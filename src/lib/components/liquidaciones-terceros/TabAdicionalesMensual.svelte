<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { toast } from 'svelte-sonner';
	import {
		liquidacionesTercerosMensualAPI,
		type LiquidacionMensual
	} from '$lib/api/liquidaciones-terceros-mensual';
	import { connectSocket, getSocket } from '$lib/socketClient';
	import UsuarioBadge from '$lib/components/common/UsuarioBadge.svelte';

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

	function fmtPlaca(p: string) {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s;
	}

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
			ANULADA: '#ef4444'
		};
		return map[estado] || '#9ca3af';
	}

	// ── State ──
	let loading = $state(true);
	let items = $state<LiquidacionMensual[]>([]);
	let total = $state(0);

	let filterAnio = $state<string>('');
	let filterBusqueda = $state('');

	type SortKey = 'created_at' | 'anio' | 'mes' | 'total_pagar';
	type SortDir = 'asc' | 'desc';
	let sortKey: SortKey = $state('created_at');
	let sortDir: SortDir = $state('desc');

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = key === 'mes' || key === 'anio' ? 'desc' : 'desc';
		}
	}

	// ── Sort client-side ──
	let itemsSorted = $derived(
		[...items].sort((a: any, b: any) => {
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
		})
	);

	// ── IDs recién creados (resaltado NUEVO) ──
	const STORAGE_KEY_NUEVAS = 'ltm:nuevas_recientes';
	const STORAGE_KEY_NUEVAS_TTL_MS = 1000 * 60 * 60 * 24;
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
			saveRecienCreadasToStorage();
		} catch {
			/* noop */
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
		} catch {
			/* noop */
		}
	}

	function markRecienCreada(id: string) {
		if (!id) return;
		recienCreadas = new Set([...recienCreadas, id]);
		highlightClearAt = Date.now() + 60_000;
		saveRecienCreadasToStorage();
	}

	// ── Stats ──
	let stats = $derived({
		total: items.length,
		BORRADOR: items.filter((i) => (i.estado || 'BORRADOR') === 'BORRADOR').length,
		LIQUIDADA: items.filter((i) => i.estado === 'LIQUIDADA').length,
		APROBADA: items.filter((i) => i.estado === 'APROBADA').length,
		FACTURADA: items.filter((i) => i.estado === 'FACTURADA').length,
		ANULADA: items.filter((i) => i.estado === 'ANULADA').length,
		totalPagar: items.reduce((s, i) => s + (Number(i.total_pagar) || 0), 0),
		totalAdicionales: items.reduce((s, i) => s + (Number(i.total_adicionales) || 0), 0)
	});

	// ── Cargar lista ──
	async function cargarLista() {
		loading = true;
		try {
			const params: { mes?: number; anio?: number } = {};
			if (filterAnio) params.anio = parseInt(filterAnio);

			const res = await liquidacionesTercerosMensualAPI.listar(params);
			let allItems = res.items || [];
			total = res.total || 0;

			// Búsqueda libre (cliente): por consecutivo, observaciones o nombre del creador
			const term = filterBusqueda.trim().toLowerCase();
			if (term) {
				allItems = allItems.filter((it) => {
					const consecutivo = (it.consecutivo || '').toLowerCase();
					const obs = (it.observaciones || '').toLowerCase();
					const creador = (it.creado_por?.nombre || '').toLowerCase();
					return consecutivo.includes(term) || obs.includes(term) || creador.includes(term);
				});
			}

			items = allItems;
		} catch (e: any) {
			console.error('Error cargando liquidaciones mensuales:', e);
			toast.error(e?.message || 'Error al cargar liquidaciones mensuales');
			items = [];
		} finally {
			loading = false;
		}
	}

	// ── Modal: generar borrador ──
	let generarOpen = $state(false);
	let generarMes = $state(new Date().getMonth() + 1);
	let generarAnio = $state(new Date().getFullYear());
	let generando = $state(false);

	async function confirmarGenerar() {
		if (!generarMes || !generarAnio) {
			toast.error('Selecciona mes y año');
			return;
		}
		generando = true;
		try {
			const result = await liquidacionesTercerosMensualAPI.generarBorrador({
				mes: Number(generarMes),
				anio: Number(generarAnio)
			});
			if (result?.id) {
				markRecienCreada(result.id);
				toast.success(result.message || 'Borrador mensual generado');
			}
			generarOpen = false;
			await cargarLista();
			// Navegar al editor del nuevo borrador
			if (result?.id && result.accion === 'created') {
				goto(`/dashboard/liquidaciones-terceros/mensual/editar/${result.id}`);
			}
		} catch (e: any) {
			toast.error(e?.message || 'Error al generar borrador');
		} finally {
			generando = false;
		}
	}

	// ── Acciones ──
	function verPreview(item: LiquidacionMensual) {
		goto(`/dashboard/liquidaciones-terceros/mensual/${item.id}`);
	}

	function editarLiquidacion(item: LiquidacionMensual) {
		if ((item.estado || 'BORRADOR') !== 'BORRADOR') {
			toast.error('Solo se pueden editar liquidaciones en estado BORRADOR');
			return;
		}
		goto(`/dashboard/liquidaciones-terceros/mensual/editar/${item.id}`);
	}

	// ── Eliminar ──
	let deleteOpen = $state(false);
	let deleteTarget = $state<LiquidacionMensual | null>(null);
	let deleteConfirmText = $state('');
	let deleteProcessing = $state(false);

	function abrirEliminar(item: LiquidacionMensual) {
		if ((item.estado || 'BORRADOR') !== 'BORRADOR') {
			toast.error('Solo se pueden eliminar liquidaciones en estado BORRADOR');
			return;
		}
		deleteTarget = item;
		deleteConfirmText = '';
		deleteOpen = true;
	}

	async function confirmarEliminacion() {
		if (!deleteTarget) return;
		if (deleteConfirmText.trim().toUpperCase() !== 'ELIMINAR') {
			toast.error('Debes escribir ELIMINAR para confirmar');
			return;
		}
		deleteProcessing = true;
		try {
			await liquidacionesTercerosMensualAPI.softDelete(deleteTarget.id);
			toast.success('Liquidación mensual eliminada');
			deleteOpen = false;
			deleteTarget = null;
			deleteConfirmText = '';
			await cargarLista();
		} catch (e: any) {
			toast.error(e?.message || 'Error al eliminar');
		} finally {
			deleteProcessing = false;
		}
	}

	// ── Anular ──
	let anularOpen = $state(false);
	let anularTarget = $state<LiquidacionMensual | null>(null);
	let anularMotivo = $state('');
	let anularProcessing = $state(false);

	function abrirAnular(item: LiquidacionMensual) {
		anularTarget = item;
		anularMotivo = '';
		anularOpen = true;
	}

	async function confirmarAnulacion() {
		if (!anularTarget) return;
		if (!anularMotivo.trim()) {
			toast.error('Indica el motivo de la anulación');
			return;
		}
		anularProcessing = true;
		try {
			await liquidacionesTercerosMensualAPI.cambiarEstado(anularTarget.id, 'ANULADA', anularMotivo.trim());
			toast.success('Liquidación anulada');
			anularOpen = false;
			anularTarget = null;
			anularMotivo = '';
			await cargarLista();
		} catch (e: any) {
			toast.error(e?.message || 'Error al anular');
		} finally {
			anularProcessing = false;
		}
	}

	// ── Cambiar estado (LIQUIDADA) ──
	let estadoLoading = $state<Record<string, boolean>>({});

	async function marcarLiquidada(item: LiquidacionMensual) {
		if (estadoLoading[item.id]) return;
		estadoLoading[item.id] = true;
		const tId = toast.loading('Marcando como liquidada…');
		try {
			await liquidacionesTercerosMensualAPI.cambiarEstado(item.id, 'LIQUIDADA');
			await cargarLista();
			toast.success('Liquidación marcada como LIQUIDADA', { id: tId });
		} catch (e: any) {
			toast.error(e?.message || 'Error al cambiar estado', { id: tId });
		} finally {
			estadoLoading[item.id] = false;
		}
	}

	async function marcarAprobada(item: LiquidacionMensual) {
		if (estadoLoading[item.id]) return;
		estadoLoading[item.id] = true;
		const tId = toast.loading('Aprobando liquidación…');
		try {
			await liquidacionesTercerosMensualAPI.cambiarEstado(item.id, 'APROBADA');
			await cargarLista();
			toast.success('Liquidación aprobada', { id: tId });
		} catch (e: any) {
			toast.error(e?.message || 'Error al aprobar', { id: tId });
		} finally {
			estadoLoading[item.id] = false;
		}
	}

	async function revertirABorrador(item: LiquidacionMensual) {
		if (estadoLoading[item.id]) return;
		estadoLoading[item.id] = true;
		const tId = toast.loading('Revirtiendo a borrador…');
		try {
			await liquidacionesTercerosMensualAPI.cambiarEstado(item.id, 'BORRADOR');
			await cargarLista();
			toast.success('Revertido a BORRADOR', { id: tId });
		} catch (e: any) {
			toast.error(e?.message || 'Error al revertir', { id: tId });
		} finally {
			estadoLoading[item.id] = false;
		}
	}

	// ── Recargar manual ──
	async function recargar() {
		await cargarLista();
	}

	// ── Limpiar filtros ──
	function limpiarFiltros() {
		filterAnio = '';
		filterBusqueda = '';
		cargarLista();
	}

	// ── Years disponibles para filtro ──
	const ANIOS = (() => {
		const current = new Date().getFullYear();
		return [current + 1, current, current - 1, current - 2];
	})();

	// ── Lifecycle ──
	onMount(async () => {
		loadRecienCreadasFromStorage();
		await cargarLista();

		connectSocket();
		const socket = getSocket();
		if (socket) {
			socket.on('row:updated:global', onRowUpdatedGlobal);
			socket.on('liquidacion-tercero-mensual:created', onMensualCreated);
			socket.on('liquidacion-tercero-mensual:deleted', onMensualDeleted);
		}
	});

	onDestroy(() => {
		const socket = getSocket();
		if (socket) {
			socket.off('row:updated:global', onRowUpdatedGlobal);
			socket.off('liquidacion-tercero-mensual:created', onMensualCreated);
			socket.off('liquidacion-tercero-mensual:deleted', onMensualDeleted);
		}
	});

	async function onRowUpdatedGlobal(payload: { id: string }) {
		if (items.some((it) => it.id === payload.id)) {
			await cargarLista();
		}
	}

	async function onMensualCreated(payload: { id: string }) {
		markRecienCreada(payload.id);
		await cargarLista();
	}

	async function onMensualDeleted(payload: { id: string }) {
		await cargarLista();
	}
</script>

<svelte:head>
	<title>Liquidaciones Mensuales de Adicionales · Cotransmeq</title>
</svelte:head>

<svelte:window
	on:keydown={(e) => {
		if (e.key !== 'Escape') return;
		if (generarOpen) generarOpen = false;
		if (deleteOpen) deleteOpen = false;
		if (anularOpen) anularOpen = false;
	}}
/>

<div class="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-6" in:fade={{ duration: 400 }}>
	<!-- ═══════════════════════════════════════════
	     HEADER GLASS
	     ═══════════════════════════════════════════ -->
	<div class="glass soft-shadow flex-shrink-0 rounded-2xl border border-gray-200/50 p-6">
		<div class="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
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
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2zM9 13h6m-3-3v6"
						/>
					</svg>
				</div>
				<div class="min-w-0">
					<h1
						class="flex items-center gap-3 font-display text-2xl text-[#0f1f1a]"
						style="line-height:1.15"
					>
						Liquidaciones Mensuales
						<span class="eyebrow">MENSUAL · ADICIONALES</span>
					</h1>
					<p class="mt-0.5 text-[13px] text-[#6b6b6b]">
						Adicionales consolidados por periodo (mes/año) para liquidación a propietarios
					</p>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2.5">
				<!-- Búsqueda libre -->
				<div class="filter-field" style="width:auto">
					<div class="relative">
						<input
							type="text"
							bind:value={filterBusqueda}
							oninput={() => cargarLista()}
							placeholder="Buscar consecutivo, observaciones…"
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

				<!-- Filtro año -->
				<div class="filter-field" style="width:auto">
					<select
						bind:value={filterAnio}
						onchange={() => cargarLista()}
						class="apple-transition rounded-xl border border-[rgba(0,0,0,0.12)] bg-white/80 px-3 py-2.5 text-[13px] text-[#1a1a1a]"
					>
						<option value="">Todos los años</option>
						{#each ANIOS as y}
							<option value={y}>{y}</option>
						{/each}
					</select>
				</div>

				<!-- Recargar -->
				<button
					onclick={recargar}
					class="apple-transition flex items-center gap-1.5 rounded-xl border border-[rgba(0,0,0,0.12)] bg-white px-3.5 py-2.5 text-[13px] font-semibold text-[#1a1a1a] hover:border-[rgba(0,0,0,0.20)] hover:bg-[#faf7f2]"
					title="Recargar"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				</button>

				<!-- Generar borrador -->
				<button
					onclick={() => (generarOpen = true)}
					class="apple-hover apple-transition emerald-glow flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm hover:from-emerald-600 hover:to-emerald-700"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
					</svg>
					Generar borrador
				</button>
			</div>
		</div>

		<!-- Strip de estadísticas -->
		<div
			class="mt-5 flex flex-wrap items-center gap-3 border-t border-[rgba(0,0,0,0.06)] pt-4"
		>
			<div class="flex items-center gap-2">
				<span
					class="font-mono-meta text-[10px]"
					style="letter-spacing:0.12em;color:#6b6b6b">RESUMEN</span
				>
			</div>

			<div class="flex items-center gap-1.5 rounded-lg bg-white/70 px-2.5 py-1">
				<span class="text-[10px] uppercase tracking-wide text-[#6b6b6b]">Total</span>
				<span class="font-mono text-[12px] font-bold text-[#1a1a1a] tabular-nums"
					>{stats.total}</span
				>
			</div>
			<div class="flex items-center gap-1.5 rounded-lg bg-white/70 px-2.5 py-1">
				<span class="text-[10px] uppercase tracking-wide text-[#6b6b6b]">V/Liquidar</span>
				<span class="font-mono text-[12px] font-bold text-[#047857] tabular-nums"
					>{COP(stats.totalAdicionales)}</span
				>
			</div>
			<div class="flex items-center gap-1.5 rounded-lg bg-white/70 px-2.5 py-1">
				<span class="text-[10px] uppercase tracking-wide text-[#6b6b6b]">Total Pagar</span>
				<span
					class="font-mono text-[12px] font-bold tabular-nums"
					style="color:#065f46">{COP(stats.totalPagar)}</span
				>
			</div>
		</div>
	</div>

	<!-- ═══════════════════════════════════════════
	     TABLA
	     ═══════════════════════════════════════════ -->
	<div
		class="table-card flex min-h-0 flex-1 flex-col"
		in:fly={{ y: 12, duration: 400, delay: 150, easing: quintOut }}
	>
		<!-- Leyenda de estados -->
		<div
			class="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[rgba(0,0,0,0.06)] bg-[#faf7f2]/60 px-5 py-2.5"
		>
			<span class="font-mono-meta text-[10px]" style="letter-spacing:0.12em;color:#6b6b6b"
				>Estados</span
			>
			{#each [{ estado: 'BORRADOR', label: 'Borrador' }, { estado: 'LIQUIDADA', label: 'Liquidada' }, { estado: 'APROBADA', label: 'Aprobada' }, { estado: 'FACTURADA', label: 'Facturada' }, { estado: 'ANULADA', label: 'Anulada' }] as item}
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
				<p class="text-[13px] text-[#6b6b6b]">Cargando liquidaciones mensuales…</p>
			</div>
		{:else if itemsSorted.length === 0}
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
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
						/>
					</svg>
				</div>
				<div class="text-center">
					<h3 class="mb-1 font-display text-[18px] text-[#0f1f1a]">
						No hay liquidaciones mensuales
					</h3>
					<p class="text-[13px] text-[#6b6b6b]">
						Genera un borrador para consolidar los adicionales del mes en curso
					</p>
				</div>
				<button
					class="btn-primary"
					onclick={() => (generarOpen = true)}
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
					</svg>
					Generar primer borrador
				</button>
			</div>
		{:else}
			<!-- Desktop table -->
			<div class="hidden min-h-0 flex-1 overflow-auto lg:block">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="table-header sticky top-0 z-10 backdrop-blur-sm">
							<th class="text-left">Consecutivo</th>
							<th class="text-left">
								<button
									type="button"
									class="apple-transition inline-flex items-center gap-1 hover:text-[#1a1a1a]"
									onclick={() => toggleSort('anio')}
								>
									Periodo
									<svg
										class="h-3 w-3"
										viewBox="0 0 8 12"
										fill="currentColor"
										style="opacity:{sortKey === 'anio' ? 1 : 0.3};transform:rotate({sortKey ===
											'anio' && sortDir === 'asc'
											? 180
											: 0}deg);transition:transform 0.2s,opacity 0.2s"
									>
										<path d="M4 0l4 4H0z" />
										<path d="M4 12L0 8h8z" />
									</svg>
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
									<svg
										class="h-3 w-3"
										viewBox="0 0 8 12"
										fill="currentColor"
										style="opacity:{sortKey === 'total_pagar' ? 1 : 0.3};transform:rotate({sortKey ===
											'total_pagar' && sortDir === 'asc'
											? 180
											: 0}deg);transition:transform 0.2s,opacity 0.2s"
									>
										<path d="M4 0l4 4H0z" />
										<path d="M4 12L0 8h8z" />
									</svg>
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
									<svg
										class="h-3 w-3"
										viewBox="0 0 8 12"
										fill="currentColor"
										style="opacity:{sortKey === 'created_at' ? 1 : 0.3};transform:rotate({sortKey ===
											'created_at' && sortDir === 'asc'
											? 180
											: 0}deg);transition:transform 0.2s,opacity 0.2s"
									>
										<path d="M4 0l4 4H0z" />
										<path d="M4 12L0 8h8z" />
									</svg>
								</button>
							</th>
							<th
								class="sticky right-0 text-center"
								style="background:var(--bg-base);border-bottom:1px solid var(--border-subtle)"
								>Acciones</th
							>
						</tr>
					</thead>
					<tbody class="divide-y divide-[rgba(0,0,0,0.04)] bg-white">
						{#each itemsSorted as item, index (item.id)}
							{@const badge = getEstadoBadge(item.estado || 'BORRADOR')}
							{@const rowBusy = !!estadoLoading[item.id]}
							{@const isNuevo = recienCreadas.has(item.id)}
							{@const highlightActive = isNuevo && Date.now() < highlightClearAt}
							{@const adicionalesCount =
								(item as any)._count?.adicionales ?? (item.adicionales?.length ?? 0)}
							{@const conceptosCount =
								(item as any)._count?.conceptos ?? (item.conceptos?.length ?? 0)}
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
										<span class="code-badge" title="Consecutivo de la liquidación">
											{item.consecutivo}
										</span>
										{#if isNuevo}
											<span class="lt-nuevo-badge" title="Liquidación recién creada">
												<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
												NUEVO
											</span>
										{/if}
									</div>
									<p
										class="mt-0.5 font-mono-meta text-[10px]"
										style="color:#6b6b6b;letter-spacing:0.04em"
									>
										{adicionalesCount} adc · {conceptosCount} cto
									</p>
								</td>
								<td class="px-3.5 py-2.5">
									<div class="flex flex-col leading-tight">
										<span class="font-mono-meta text-[11px]" style="color:#047857">
											{item.mes ? MESES[item.mes - 1] : '—'}
										</span>
										<span
											class="font-mono text-[10px] text-[#9a9a9a]"
											style="letter-spacing:0.04em">{item.anio ?? '—'}</span
										>
									</div>
								</td>
								<td class="px-3.5 py-2.5 text-right">
									<span
										class="font-mono text-[12px] text-[#4a4a4a]"
										style="font-weight:500">{COP(item.total_adicionales ?? 0)}</span
									>
								</td>
								<td class="px-3.5 py-2.5 text-right">
									<span
										class="font-mono text-[12px]"
										style="color:#991b1b;font-weight:600"
										>{COP(item.total_descuentos ?? 0)}</span
									>
								</td>
								<td class="px-3.5 py-2.5 text-right">
									<span
										class="font-mono text-[12.5px]"
										style="color:#065f46;font-weight:700"
										>{COP(item.total_pagar ?? 0)}</span
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
								<td
									class="sticky right-0 px-3.5 py-2.5 backdrop-blur-sm"
									style="background:white"
								>
									<div class="flex items-center justify-center gap-0.5">
										<button
											class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(16,185,129,0.08)] hover:text-[#059669]"
											title="Ver preview"
											onclick={() => verPreview(item)}
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
												disabled={rowBusy}
												onclick={() => marcarLiquidada(item)}
											>
												{#if rowBusy}
													<svg
														class="h-4 w-4 animate-spin"
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

										{#if (item.estado || 'BORRADOR') === 'LIQUIDADA'}
											<button
												class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(16,185,129,0.08)] hover:text-[#059669] disabled:cursor-not-allowed disabled:opacity-40"
												title="Aprobar"
												disabled={rowBusy}
												onclick={() => marcarAprobada(item)}
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
														d="M5 13l4 4L19 7"
													/>
												</svg>
											</button>
											<button
												class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(245,158,11,0.10)] hover:text-[#b45309] disabled:cursor-not-allowed disabled:opacity-40"
												title="Revertir a Borrador"
												disabled={rowBusy}
												onclick={() => revertirABorrador(item)}
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
														d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
													/>
												</svg>
											</button>
										{/if}

										{#if !['ANULADA', 'FACTURADA'].includes(item.estado || 'BORRADOR')}
											<button
												class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(220,38,38,0.08)] hover:text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-40"
												title="Anular"
												disabled={rowBusy}
												onclick={() => abrirAnular(item)}
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

										{#if (item.estado || 'BORRADOR') === 'BORRADOR'}
											<button
												class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(0,0,0,0.05)] hover:text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-40"
												title="Eliminar"
												disabled={rowBusy}
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
										{/if}
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
					{#each itemsSorted as item, index (item.id)}
						{@const badge = getEstadoBadge(item.estado || 'BORRADOR')}
						{@const isNuevo = recienCreadas.has(item.id)}
						{@const highlightActive = isNuevo && Date.now() < highlightClearAt}
						<div
							class="relative flex table-row gap-0 transition-opacity duration-200"
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
										<div class="flex items-center gap-1.5">
											<span class="code-badge">{item.consecutivo}</span>
											{#if isNuevo}
												<span class="lt-nuevo-badge" title="Recién creada">
													<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
													NUEVO
												</span>
											{/if}
										</div>
										<p
											class="mt-1 font-mono-meta text-[10px]"
											style="color:#6b6b6b;letter-spacing:0.04em"
										>
											{item.mes ? MESES[item.mes - 1] : '—'} {item.anio ?? '—'}
										</p>
									</div>
									<span
										class="status-pill"
										style="background:{badge.bg};color:{badge.text};border:1px solid {badge.borderHex}"
										>{badge.label}</span
									>
								</div>
								<div class="mb-2 flex items-center justify-between gap-2">
									<div class="min-w-0">
										{#if item.creado_por}
											<p class="truncate text-[12px] text-[#4a4a4a]">
												{item.creado_por.nombre}
											</p>
											<p class="text-[10px] text-[#9a9a9a]">
												{fmtDate(item.created_at || null)}
											</p>
										{/if}
									</div>
									<div class="text-right">
										<p class="font-mono text-[10px] uppercase text-[#6b6b6b]">Total</p>
										<span
											class="font-mono text-[14px]"
											style="color:#065f46;font-weight:700"
											>{COP(item.total_pagar ?? 0)}</span
										>
									</div>
								</div>
								<div class="flex items-center justify-end gap-0.5">
									<button
										class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(16,185,129,0.08)] hover:text-[#059669]"
										title="Ver"
										onclick={() => verPreview(item)}
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
									{/if}
									{#if (item.estado || 'BORRADOR') === 'BORRADOR'}
										<button
											class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(0,0,0,0.05)] hover:text-[#1a1a1a]"
											title="Eliminar"
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
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- ═══ MODAL: GENERAR BORRADOR ═══ -->
{#if generarOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[9500] flex items-center justify-center bg-[rgba(15,31,26,0.45)] backdrop-blur-sm"
		aria-hidden="true"
		onclick={(e) => {
			if (e.target === e.currentTarget) generarOpen = false;
		}}
	>
		<div
			class="confirm-card w-full max-w-md"
			role="dialog"
			aria-modal="true"
			aria-labelledby="generar-modal-title"
			in:fly={{ y: 20, duration: 400, easing: quintOut }}
		>
			<div class="flex items-center gap-3.5 border-b border-[rgba(0,0,0,0.06)] px-6 pb-4">
				<div
					class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
					style="background:rgba(16,185,129,0.10);color:#047857"
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
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2zM9 13h6"
						/>
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<span class="eyebrow" style="background:rgba(16,185,129,0.10);color:#047857"
						>Borrador mensual</span
					>
					<h3
						id="generar-modal-title"
						class="mt-1.5 font-display text-[18px] text-[#0f1f1a]"
						style="line-height:1.2"
					>
						Generar borrador mensual
					</h3>
					<p class="text-[12px] text-[#6b6b6b]">
						Consolida los adicionales del mes en una sola liquidación
					</p>
				</div>
			</div>
			<div class="px-6 py-5">
				<div class="grid grid-cols-2 gap-3">
					<label class="block">
						<span
							class="filter-field-label mb-1.5 block"
							style="font-size:0.7rem">Mes</span
						>
						<select
							bind:value={generarMes}
							class="apple-transition w-full rounded-xl border border-[rgba(0,0,0,0.12)] bg-white px-3 py-2 text-[13.5px] text-[#1a1a1a] focus:border-emerald-400 focus:outline-none"
						>
							{#each MESES as m, i}
								<option value={i + 1}>{m}</option>
							{/each}
						</select>
					</label>
					<label class="block">
						<span
							class="filter-field-label mb-1.5 block"
							style="font-size:0.7rem">Año</span
						>
						<input
							type="number"
							bind:value={generarAnio}
							class="apple-transition w-full rounded-xl border border-[rgba(0,0,0,0.12)] bg-white px-3 py-2 text-[13.5px] text-[#1a1a1a] focus:border-emerald-400 focus:outline-none"
							min="2020"
							max="2099"
						/>
					</label>
				</div>
				<p
					class="mt-3 rounded-lg border border-[rgba(245,158,11,0.30)] bg-[rgba(245,158,11,0.08)] p-2.5 text-[11.5px] leading-relaxed text-[#92400e]"
				>
					<strong>Idempotente:</strong> si ya existe un borrador para el periodo, se abrirá el existente
					sin duplicar datos.
				</p>
			</div>
			<div
				class="flex justify-end gap-2.5 border-t border-[rgba(0,0,0,0.06)] bg-[#faf7f2]/60 px-6 py-4"
				style="border-radius:0 0 24px 24px"
			>
				<button
					type="button"
					class="btn-secondary"
					onclick={() => (generarOpen = false)}
					disabled={generando}>Cancelar</button
				>
				<button
					type="button"
					class="apple-transition flex items-center gap-1.5 rounded-xl border-none px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
					style="background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 4px 16px rgba(16,185,129,0.30);cursor:pointer"
					onclick={confirmarGenerar}
					disabled={generando}
				>
					{#if generando}
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
							stroke-width="2"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
						</svg>
					{/if}
					{generando ? 'Generando…' : 'Generar borrador'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══ MODAL: ANULAR ═══ -->
{#if anularOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[9500] flex items-center justify-center bg-[rgba(15,31,26,0.45)] backdrop-blur-sm"
		aria-hidden="true"
		onclick={(e) => {
			if (e.target === e.currentTarget) anularOpen = false;
		}}
	>
		<div
			class="confirm-card w-full max-w-md"
			role="dialog"
			aria-modal="true"
			aria-labelledby="anular-mensual-title"
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
						id="anular-mensual-title"
						class="mt-1.5 font-display text-[18px] text-[#0f1f1a]"
						style="line-height:1.2"
					>
						Anular liquidación mensual
					</h3>
					{#if anularTarget}
						<p class="font-mono text-[12px] text-[#6b6b6b]" style="letter-spacing:0.02em">
							{anularTarget.consecutivo} · {anularTarget.mes ? MESES[anularTarget.mes - 1] : ''}
							{anularTarget.anio}
						</p>
					{/if}
				</div>
			</div>
			<div class="px-6 py-5">
				<label
					for="anular-motivo-mensual"
					class="filter-field-label mb-1.5 block"
					style="font-size:0.7rem">Motivo de anulación</label
				>
				<textarea
					id="anular-motivo-mensual"
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
				<button
					type="button"
					class="btn-secondary"
					onclick={() => (anularOpen = false)}
					disabled={anularProcessing}>Cancelar</button
				>
				<button
					type="button"
					class="apple-transition rounded-xl border-none px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
					style="background:linear-gradient(135deg,#dc2626,#b91c1c);box-shadow:0 4px 16px rgba(220,38,38,0.30);cursor:pointer"
					onclick={confirmarAnulacion}
					disabled={anularProcessing || !anularMotivo.trim()}
				>
					{anularProcessing ? 'Anulando…' : 'Anular liquidación'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══ MODAL: ELIMINAR ═══ -->
{#if deleteOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[9500] flex items-center justify-center bg-[rgba(15,31,26,0.45)] backdrop-blur-sm"
		aria-hidden="true"
		onclick={(e) => {
			if (e.target === e.currentTarget) deleteOpen = false;
		}}
	>
		<div
			class="confirm-card w-full max-w-md"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-mensual-title"
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
					<span class="eyebrow" style="background:rgba(0,0,0,0.06);color:#1a1a1a"
						>Eliminación</span
					>
					<h3
						id="delete-mensual-title"
						class="mt-1.5 font-display text-[18px] text-[#0f1f1a]"
						style="line-height:1.2"
					>
						Eliminar liquidación mensual
					</h3>
					{#if deleteTarget}
						<p class="font-mono text-[12px] text-[#6b6b6b]" style="letter-spacing:0.02em">
							{deleteTarget.consecutivo} · {deleteTarget.mes ? MESES[deleteTarget.mes - 1] : ''}
							{deleteTarget.anio}
						</p>
					{/if}
				</div>
			</div>
			<div class="px-6 py-5">
				<p class="mb-3.5 text-[13px] leading-relaxed text-[#4a4a4a]">
					Se marcarán como eliminados la liquidación, sus adicionales y sus conceptos. El registro
					se conserva en base de datos pero dejará de aparecer en el historial.
				</p>
				<label
					for="delete-confirm-mensual"
					class="filter-field-label mb-1.5 block"
					style="font-size:0.7rem"
					>Escribe <strong class="text-[#1a1a1a]">ELIMINAR</strong> para confirmar</label
				>
				<input
					id="delete-confirm-mensual"
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
					onclick={() => (deleteOpen = false)}
					disabled={deleteProcessing}>Cancelar</button
				>
				<button
					type="button"
					class="apple-transition rounded-xl border-none px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40"
					style="background:linear-gradient(135deg,#1a1a1a,#0a0a0a);box-shadow:0 4px 16px rgba(0,0,0,0.20);cursor:pointer"
					onclick={confirmarEliminacion}
					disabled={deleteProcessing ||
						deleteConfirmText.trim().toUpperCase() !== 'ELIMINAR'}
				>
					{deleteProcessing ? 'Eliminando…' : 'Eliminar definitivamente'}
				</button>
			</div>
		</div>
	</div>
{/if}
