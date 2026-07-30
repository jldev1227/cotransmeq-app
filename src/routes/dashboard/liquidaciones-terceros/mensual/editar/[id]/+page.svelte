<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto, beforeNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import {
		liquidacionesTercerosMensualAPI,
		type AdicionalMensual,
		type ConceptoMensual,
		type LiquidacionMensual,
		type CierreOrigen
	} from '$lib/api/liquidaciones-terceros-mensual';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
	import AutosaveIndicator from '$lib/components/AutosaveIndicator.svelte';
	import CellSelect from '$lib/components/ui/CellSelect.svelte';
	import SelectionStatsFooter from '$lib/components/ui/SelectionStatsFooter.svelte';
	import * as realtimeCollab from '$lib/stores/realtimeCollab';
	import { connectSocket } from '$lib/socketClient';

	$: id = $page.params.id;

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

	beforeNavigate((nav) => {
		if (isDirty) {
			if (!confirm('Hay cambios sin guardar. ¿Seguro que deseas salir?')) {
				nav.cancel();
			}
		}
	});

	// ─── ZOOM (persisted in sessionStorage) ─────────────────────
	let pdfZoom = (() => {
		if (typeof sessionStorage !== 'undefined') {
			const saved = sessionStorage.getItem('liq-tercero-mensual-edit-zoom');
			if (saved) return parseFloat(saved) || 1;
		}
		return 1;
	})();
	$: if (typeof sessionStorage !== 'undefined')
		sessionStorage.setItem('liq-tercero-mensual-edit-zoom', String(pdfZoom));

	let viewportWidth = 0;
	let viewportHeight = 0;
	let resizeObserver: ResizeObserver | null = null;

	function updateViewport() {
		if (typeof window === 'undefined') return;
		viewportWidth = window.innerWidth;
		viewportHeight = window.innerHeight;
	}

	function fitToViewport() {
		if (typeof window === 'undefined' || viewportWidth <= 0) return;
		// Ancho de referencia para la tabla mensual (más angosta que la de placa)
		const REFERENCE_WIDTH_PX = 1400;
		const padding = 360; // sidebar a la derecha
		const availableWidth = Math.max(280, viewportWidth - padding);
		const targetWidth = availableWidth * 0.96;
		pdfZoom = Math.max(0.3, Math.min(2.5, targetWidth / REFERENCE_WIDTH_PX));
	}

	function handleWheel(e: WheelEvent) {
		if (!(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		const delta = e.deltaY < 0 ? 0.05 : -0.05;
		pdfZoom = Math.max(0.3, Math.min(2.5, pdfZoom + delta));
	}

	// ─── SELECCIÓN MÚLTIPLE DE CELDAS (click+drag o Shift+click) ─
	const CELL_SELECTOR =
		'.cell-num, .cell-total, .cell-base, .cell-summary-red, .cell-tfoot-value, input.excel-cell-input-num, input.excel-cell-input-dias, input.excel-cell-input-pct';

	let isSelecting = false;
	let anchorCell: HTMLElement | null = null;
	let selectedCellSet = new Set<HTMLElement>();
	let selectionStats = {
		count: 0,
		nonEmpty: 0,
		sum: 0,
		avg: 0,
		min: 0,
		max: 0,
		allNumeric: true
	};

	function isEditableInput(el: HTMLElement | null): boolean {
		if (!el) return false;
		const tag = el.tagName;
		if (tag === 'INPUT') {
			const t = (el as HTMLInputElement).type;
			return t !== 'checkbox' && t !== 'radio' && t !== 'button' && t !== 'submit';
		}
		if (tag === 'TEXTAREA') return true;
		if ((el as HTMLElement).isContentEditable) return true;
		return false;
	}

	function getCellFromTarget(target: HTMLElement): HTMLElement | null {
		const direct = target.closest<HTMLElement>(CELL_SELECTOR);
		return direct;
	}

	function extractCellNumeric(cell: HTMLElement): { value: number | null; isNumeric: boolean } {
		const input = cell.matches('input') ? (cell as HTMLInputElement) : cell.querySelector('input');
		if (input) {
			const raw = (input.value || '').trim();
			if (raw === '') return { value: null, isNumeric: true };
			const n = parseCOP(raw);
			return { value: isNaN(n) ? null : n, isNumeric: !isNaN(n) };
		}
		const txt = (cell.textContent || '').trim();
		if (txt === '' || txt === '—' || txt === '-') return { value: null, isNumeric: true };
		const cleaned = txt
			.replace(/[^\d,.\-()]/g, '')
			.replace(/\./g, '')
			.replace(',', '.')
			.replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
		if (cleaned === '' || cleaned === '-') return { value: null, isNumeric: true };
		const n = parseFloat(cleaned);
		return { value: isNaN(n) ? null : n, isNumeric: !isNaN(n) };
	}

	function updateSelectionRect(endX: number, endY: number) {
		selectedCellSet.forEach((c) => c.classList.remove('cell-selected'));
		selectedCellSet.clear();
		if (!anchorCell) return;

		const a = anchorCell.getBoundingClientRect();
		const minX = Math.min(a.left, endX);
		const maxX = Math.max(a.right, endX);
		const minY = Math.min(a.top, endY);
		const maxY = Math.max(a.bottom, endY);

		const cells = document.querySelectorAll<HTMLElement>(CELL_SELECTOR);
		cells.forEach((c) => {
			if (!c.isConnected) return;
			const r = c.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) return;
			if (r.left < maxX && r.right > minX && r.top < maxY && r.bottom > minY) {
				c.classList.add('cell-selected');
				selectedCellSet.add(c);
			}
		});
	}

	function computeSelectionStats() {
		const values: number[] = [];
		let allNumeric = true;
		let nonEmpty = 0;
		selectedCellSet.forEach((cell) => {
			const { value, isNumeric } = extractCellNumeric(cell);
			if (!isNumeric) allNumeric = false;
			if (value !== null) {
				values.push(value);
				nonEmpty++;
			}
		});
		const count = selectedCellSet.size;
		const sum = values.reduce((s, v) => s + v, 0);
		const avg = values.length > 0 ? sum / values.length : 0;
		const min = values.length > 0 ? Math.min(...values) : 0;
		const max = values.length > 0 ? Math.max(...values) : 0;
		selectionStats = { count, nonEmpty, sum, avg, min, max, allNumeric };
	}

	function clearSelection() {
		if (selectedCellSet.size === 0 && !anchorCell) return;
		selectedCellSet.forEach((c) => c.classList.remove('cell-selected'));
		selectedCellSet.clear();
		anchorCell = null;
		isSelecting = false;
		selectionStats = {
			count: 0,
			nonEmpty: 0,
			sum: 0,
			avg: 0,
			min: 0,
			max: 0,
			allNumeric: true
		};
	}

	function onGridMouseDown(e: MouseEvent) {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement;
		if (
			target.closest('.cell-select-dropdown') ||
			target.closest('.modal-overlay') ||
			target.closest('.selection-stats-footer') ||
			target.closest('.subtab-nav') ||
			target.closest('.sidebar-card')
		) {
			return;
		}
		const cell = getCellFromTarget(target);
		if (!cell) {
			if (!e.shiftKey && selectedCellSet.size > 0) {
				clearSelection();
			}
			return;
		}
		const isDirectlyOnInput = isEditableInput(target);
		if (isDirectlyOnInput && target.tagName === 'INPUT') {
			const isSelectableInput = target.matches(
				'input.excel-cell-input-num, input.excel-cell-input-dias, input.excel-cell-input-pct'
			);
			if (!isSelectableInput) {
				return;
			}
		}
		e.preventDefault();
		if (e.shiftKey && anchorCell) {
			selectedCellSet.forEach((c) => c.classList.remove('cell-selected'));
			selectedCellSet.clear();
			const a = anchorCell.getBoundingClientRect();
			const b = cell.getBoundingClientRect();
			const minX = Math.min(a.left, b.left);
			const maxX = Math.max(a.right, b.right);
			const minY = Math.min(a.top, b.top);
			const maxY = Math.max(a.bottom, b.bottom);
			document.querySelectorAll<HTMLElement>(CELL_SELECTOR).forEach((c) => {
				if (!c.isConnected) return;
				const r = c.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) return;
				if (r.left < maxX && r.right > minX && r.top < maxY && r.bottom > minY) {
					c.classList.add('cell-selected');
					selectedCellSet.add(c);
				}
			});
			computeSelectionStats();
		} else {
			clearSelection();
			isSelecting = true;
			anchorCell = cell;
			selectedCellSet.add(cell);
			cell.classList.add('cell-selected');
			const gridBody = document.querySelector('.excel-grid-body');
			gridBody?.classList.add('is-selecting');
		}
	}

	function onGridMouseMove(e: MouseEvent) {
		if (!isSelecting || !anchorCell) return;
		e.preventDefault();
		updateSelectionRect(e.clientX, e.clientY);
	}

	function onGridMouseUp(_e: MouseEvent) {
		if (!isSelecting) return;
		isSelecting = false;
		const gridBody = document.querySelector('.excel-grid-body');
		gridBody?.classList.remove('is-selecting');
		computeSelectionStats();
	}

	function onKeyDownSelection(e: KeyboardEvent) {
		if (e.key === 'Escape' && selectedCellSet.size > 0) {
			clearSelection();
		}
	}

	// ─── STATE PRINCIPAL ────────────────────────────────────────
	let loading = true;
	let loadError = '';
	let cabecera: LiquidacionMensual | null = null;
	let adicionales: AdicionalMensual[] = [];
	let conceptos: ConceptoMensual[] = [];
	let cierresOrigen: CierreOrigen[] = [];
	let observaciones = '';

	type TabKey = 'adicionales' | 'gastos' | 'impuestos' | 'anticipos';
	let activeTab: TabKey = 'adicionales';

	// ─── AUTOSAVE (1.2s debounce + Cmd/Ctrl+S para forzar) ─────
	let isDirty = false;
	let isSaving = false;
	let saveError: string | null = null;
	let lastSavedAt: string | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	const SAVE_DELAY = 1200;

	function markDirty() {
		isDirty = true;
		saveError = null;
		scheduleSave();
	}

	function scheduleSave() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(flushSave, SAVE_DELAY);
	}

	async function flushSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (!isDirty || !cabecera || isSaving) return;
		isSaving = true;
		realtimeCollab.setSaveStatus('saving');
		try {
			const resp = await liquidacionesTercerosMensualAPI.guardarBorrador({
				id: cabecera.id,
				mes: cabecera.mes,
				anio: cabecera.anio,
				observaciones: observaciones || null,
				adicionales,
				conceptos
			});
			isDirty = false;
			isSaving = false;
			lastSavedAt = new Date().toISOString();
			realtimeCollab.setSaveStatus('saved', lastSavedAt);
			// Si el backend devolvió totales recalculados, sincronizar la cabecera
			if (resp?.id) {
				cabecera = {
					...cabecera,
					...((resp as any) || {})
				};
			}
		} catch (e: any) {
			isSaving = false;
			saveError = e?.message || 'Error al guardar';
			realtimeCollab.setSaveStatus('error');
			console.error('[mensual] flushSave error:', e);
		}
	}

	function onKeyDownSave(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
			e.preventDefault();
			flushSave();
		}
	}

	// ─── COMPUTED STATS ─────────────────────────────────────────
	$: totalAdicionales = adicionales.reduce(
		(s, a) => s + (Number(a.valor_liquidar) || 0),
		0
	);
	$: totalGastosOp = conceptos
		.filter((c) => c.tipo === 'GASTO_OPERATIVO')
		.reduce((s, c) => s + (Number(c.valor_total) || 0), 0);
	$: totalImpuestos = conceptos
		.filter((c) => c.tipo === 'IMPUESTO')
		.reduce((s, c) => s + (Number(c.valor_total) || 0), 0);
	$: totalAnticipos = conceptos
		.filter((c) => c.tipo === 'ANTICIPO')
		.reduce((s, c) => s + (Number(c.valor_total) || 0), 0);
	$: totalDescuentos = totalGastosOp + totalImpuestos + totalAnticipos;
	$: totalPagar = totalAdicionales - totalDescuentos;
	$: totalAdicionalesCount = adicionales.length;

	// Por placa breakdown
	$: porPlaca = (() => {
		const map = new Map<
			string,
			{ placa: string; count: number; valor: number; terceros: Set<string> }
		>();
		for (const a of adicionales) {
			const k = (a.placa || '—').toUpperCase();
			if (!map.has(k))
				map.set(k, { placa: k, count: 0, valor: 0, terceros: new Set() });
			const item = map.get(k)!;
			item.count++;
			item.valor += Number(a.valor_liquidar) || 0;
			if (a.tercero_nombre) item.terceros.add(a.tercero_nombre);
		}
		return Array.from(map.values())
			.map((x) => ({ ...x, terceros: Array.from(x.terceros) }))
			.sort((a, b) => b.valor - a.valor);
	})();

	$: gastosOpConceptos = conceptos
		.filter((c) => c.tipo === 'GASTO_OPERATIVO')
		.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
	$: impuestosConceptos = conceptos
		.filter((c) => c.tipo === 'IMPUESTO')
		.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
	$: anticiposConceptos = conceptos
		.filter((c) => c.tipo === 'ANTICIPO')
		.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));

	$: adicionalesOrdenados = [...adicionales].sort(
		(a, b) => (a.orden ?? 0) - (b.orden ?? 0)
	);

	// ─── FORMAT HELPERS ─────────────────────────────────────────
	function fmtPlaca(p: string): string {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s || '—';
	}

	function fmtCOP(v: number | string | null | undefined): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(parseFloat(String(v ?? 0)) || 0);
	}

	function fmtCOPNegativo(v: number | string | null | undefined): string {
		return '- ' + fmtCOP(v);
	}

	function fmtCOPInput(v: number | string | null | undefined): string {
		const n = parseFloat(String(v ?? 0)) || 0;
		if (n === 0) return '';
		return (
			'$ ' +
			new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)
		);
	}

	function parseCOP(s: string): number {
		const cleaned = s
			.replace(/[^0-9,.\-]/g, '')
			.replace(/\./g, '')
			.replace(',', '.');
		return parseFloat(cleaned) || 0;
	}

	function adicionalVLiqNeto(adc: AdicionalMensual): number {
		const vLiqGross =
			(Number(adc.valor_unitario) || 0) * (Number(adc.cantidad) || 0);
		const pctAdmin = Number(adc.porcentaje_admin) || 0;
		const vAdmin = Math.round((vLiqGross * pctAdmin) / 100);
		return vLiqGross - vAdmin;
	}

	function adicionalVAdmin(adc: AdicionalMensual): number {
		const vLiqGross =
			(Number(adc.valor_unitario) || 0) * (Number(adc.cantidad) || 0);
		const pctAdmin = Number(adc.porcentaje_admin) || 0;
		return Math.round((vLiqGross * pctAdmin) / 100);
	}

	function calcAdicionalValor(adc: AdicionalMensual): AdicionalMensual {
		const vLiqGross =
			(Number(adc.valor_unitario) || 0) * (Number(adc.cantidad) || 0);
		const vAdmin = adicionalVAdmin(adc);
		return { ...adc, valor_liquidar: vLiqGross - vAdmin, valor_admin: vAdmin };
	}

	// ─── ADICIONALES CRUD ───────────────────────────────────────
	function addAdicionalRow() {
		const nuevo: AdicionalMensual = {
			id: crypto.randomUUID(),
			cliente: 'TRANSMERALDA',
			placa: '',
			tercero_nombre: '',
			recorrido: '',
			fechas: '',
			valor_unitario: 0,
			cantidad: 1,
			porcentaje_admin: 0,
			valor_admin: 0,
			valor_liquidar: 0,
			aplica_impuestos: true,
			orden: adicionales.length
		};
		adicionales = [...adicionales, nuevo];
		markDirty();
	}

	function deleteAdicional(idx: number) {
		adicionales = adicionales.filter((_, i) => i !== idx);
		markDirty();
	}

	function updateAdicionalField(idx: number, field: string, value: any) {
		const next = [...adicionales];
		next[idx] = { ...next[idx], [field]: value };
		if (
			field === 'valor_unitario' ||
			field === 'cantidad' ||
			field === 'porcentaje_admin'
		) {
			const vLiqGross =
				(Number(next[idx].valor_unitario) || 0) *
				(Number(next[idx].cantidad) || 0);
			const pctAdmin = Number(next[idx].porcentaje_admin) || 0;
			const vAdmin = Math.round((vLiqGross * pctAdmin) / 100);
			next[idx].valor_admin = vAdmin;
			next[idx].valor_liquidar = vLiqGross - vAdmin;
		}
		adicionales = next;
		markDirty();
	}

	// ─── CONCEPTOS CRUD ─────────────────────────────────────────
	const CONCEPTOS_GASTOS_OP = [
		'DOTACION',
		'EXAMEN_MEDICO',
		'COMBUSTIBLE',
		'PAPELERIA',
		'GASTOS_DIVERSOS',
		'PEAJES',
		'LAVADO',
		'PARQUEADERO',
		'MANTENIMIENTO'
	];
	const CONCEPTOS_IMPUESTOS = [
		'RETENCION_ICA',
		'AVISOS_TABLEROS',
		'SOBRETASA_BOMBERIL',
		'RETENCION_FUENTE'
	];

	function addConcepto(tipo: 'GASTO_OPERATIVO' | 'IMPUESTO' | 'ANTICIPO', nombre?: string) {
		const concepto = nombre || (tipo === 'ANTICIPO' ? 'ANTICIPO' : '');
		const baseOrden =
			tipo === 'GASTO_OPERATIVO' ? 5000 : tipo === 'IMPUESTO' ? 7000 : 9000;
		const maxOrden = conceptos
			.filter((c) => c.tipo === tipo)
			.reduce((m, c) => Math.max(m, c.orden ?? 0), baseOrden - 1);
		const nuevo: ConceptoMensual = {
			id: crypto.randomUUID(),
			tipo,
			concepto,
			conductor_id: null,
			placa_aplicada: null,
			dias: tipo === 'ANTICIPO' ? 1 : 0,
			valor_unitario: 0,
			porcentaje: tipo === 'IMPUESTO' ? 0 : null,
			valor_total: 0,
			calculado: false,
			observaciones:
				tipo === 'ANTICIPO' ? new Date().toISOString().slice(0, 10) : null,
			orden: maxOrden + 1
		};
		conceptos = [...conceptos, nuevo];
		markDirty();
	}

	function updateConceptoField(idx: number, field: string, value: any) {
		const next = [...conceptos];
		const c = { ...next[idx], [field]: value };
		// Recalcular valor_total según el tipo
		if (c.tipo === 'ANTICIPO' && field === 'valor_unitario') {
			c.valor_total = Number(value) || 0;
		} else if (c.tipo === 'GASTO_OPERATIVO') {
			if (field === 'dias' || field === 'valor_unitario') {
				c.valor_total = (Number(c.dias) || 0) * (Number(c.valor_unitario) || 0);
			}
		} else if (c.tipo === 'IMPUESTO' && field === 'porcentaje') {
			if (c.base_calculo) {
				c.valor_total = (Number(c.base_calculo) || 0) * ((Number(value) || 0) / 100);
			}
		}
		next[idx] = c;
		conceptos = next;
		markDirty();
	}

	function deleteConcepto(idx: number) {
		conceptos = conceptos.filter((_, i) => i !== idx);
		markDirty();
	}

	function recargarTotales() {
		if (!cabecera) return;
		liquidacionesTercerosMensualAPI
			.recalcularTotales(cabecera.id)
			.then((data) => {
				if (cabecera && data) {
					cabecera = { ...cabecera, ...data };
				}
			})
			.catch((e) => console.error('[mensual] recalcularTotales error:', e));
	}

	// ─── ONMOUNT / ONDESTROY ────────────────────────────────────
	onMount(async () => {
		if (!id) {
			loadError = 'ID requerido';
			loading = false;
			return;
		}

		// Init viewport + zoom
		updateViewport();
		window.addEventListener('resize', updateViewport);
		window.addEventListener('wheel', handleWheel, { passive: false });
		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => updateViewport());
			resizeObserver.observe(document.body);
		}

		// Cell selection
		const gridBody = document.querySelector('.excel-grid-body');
		if (gridBody) {
			gridBody.addEventListener('mousedown', onGridMouseDown as EventListener);
		}
		window.addEventListener('mousemove', onGridMouseMove);
		window.addEventListener('mouseup', onGridMouseUp);
		window.addEventListener('keydown', onKeyDownSelection);
		window.addEventListener('keydown', onKeyDownSave);

		connectSocket();

		try {
			const result = await liquidacionesTercerosMensualAPI.obtenerPorId(id);
			if (!result) {
				loadError = 'Liquidación no encontrada';
				return;
			}
			cabecera = result;
			adicionales = (result.adicionales || []).map((a: any) => ({
				...a,
				aplica_impuestos: a.aplica_impuestos !== false
			}));
			conceptos = (result.conceptos || []).map((c: any) => ({ ...c }));
			cierresOrigen = result.cierres_origen || [];
			observaciones = result.observaciones || '';

			// Join realtime room (para presencia)
			const user = $authStore.user;
			if (user) {
				const userName = user.nombre || user.correo || 'Usuario';
				realtimeCollab.initCollab({ id: user.id, name: userName });
				realtimeCollab.joinRoom('liquidacion-tercero-mensual', id, {
					id: user.id,
					name: userName
				});
			}
		} catch (e: any) {
			loadError = e?.message || 'Error al cargar la liquidación';
		} finally {
			loading = false;
		}
	});

	onDestroy(() => {
		realtimeCollab.leaveRoom();
		const gridBody = document.querySelector('.excel-grid-body');
		if (gridBody) {
			gridBody.removeEventListener('mousedown', onGridMouseDown as EventListener);
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', updateViewport);
			window.removeEventListener('wheel', handleWheel);
			window.removeEventListener('mousemove', onGridMouseMove);
			window.removeEventListener('mouseup', onGridMouseUp);
			window.removeEventListener('keydown', onKeyDownSelection);
			window.removeEventListener('keydown', onKeyDownSave);
		}
		if (resizeObserver) resizeObserver.disconnect();
		if (saveTimer) clearTimeout(saveTimer);
		clearSelection();
	});
</script>

<svelte:head>
	<title>Editar Liquidación Mensual · Transmeralda</title>
</svelte:head>

{#if loading}
	<div class="loading-state">
		<div class="spinner"></div>
		<span>Cargando liquidación mensual...</span>
	</div>
{:else if loadError}
	<div class="error-state">
		<p>❌ {loadError}</p>
		<button
			class="btn-back"
			on:click={() => goto('/dashboard/liquidaciones-terceros?tab=mensual')}>Volver</button
		>
	</div>
{:else if cabecera}
	<div class="page-wrap">
		<!-- TOOLBAR -->
		<div class="excel-toolbar">
			<div class="excel-toolbar-left">
				<button
					class="toolbar-btn toolbar-btn-back"
					on:click={() => goto('/dashboard/liquidaciones-terceros?tab=mensual')}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M19 12H5M12 19l-7-7 7-7" />
					</svg>
					Volver al listado
				</button>
				<div class="toolbar-divider"></div>
				<div class="toolbar-info">
					<span class="toolbar-title">Editando Liquidación Mensual de Adicionales</span>
					<span class="toolbar-subtitle">
						{cabecera.consecutivo} · {cabecera.mes ? MESES[cabecera.mes - 1] : ''} {cabecera.anio}
						· {cabecera.estado}
					</span>
				</div>
			</div>
			<div class="excel-toolbar-actions">
				<PresenceAvatars />
				<AutosaveIndicator />
				<div class="zoom-controls">
					<button
						class="zoom-btn"
						on:click={() => (pdfZoom = Math.max(0.3, pdfZoom - 0.05))}
						title="Reducir zoom"
						aria-label="Reducir zoom">−</button
					>
					<span class="zoom-label">{Math.round(pdfZoom * 100)}%</span>
					<button
						class="zoom-btn"
						on:click={() => (pdfZoom = Math.min(2.5, pdfZoom + 0.05))}
						title="Aumentar zoom"
						aria-label="Aumentar zoom">+</button
					>
					<button
						class="zoom-btn zoom-reset"
						on:click={() => (pdfZoom = 1)}
						title="Restablecer zoom al 100%"
						aria-label="Restablecer zoom al 100%">↺</button
					>
					<button
						class="zoom-btn zoom-fit"
						on:click={fitToViewport}
						title="Ajustar al ancho de pantalla"
						aria-label="Ajustar al ancho de pantalla">⤢</button
					>
				</div>
				<button class="toolbar-btn toolbar-btn-amber" on:click={recargarTotales}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<rect x="4" y="2" width="16" height="20" rx="2" />
						<path d="M8 6h8M8 10h8M8 14h4" />
					</svg>
					Recalcular
				</button>
				<button class="toolbar-btn toolbar-btn-dark" on:click={addAdicionalRow}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<line x1="12" y1="5" x2="12" y2="19" />
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
					+ Adicional
				</button>
			</div>
		</div>

		<!-- LAYOUT: TABLA + SIDEBAR -->
		<div class="page-body">
			<!-- GRID BODY (tabla con sub-tabs) -->
			<div class="excel-grid-body" class:has-zoom={pdfZoom !== 1}>
				<div
					class="excel-grid-container"
					style="transform: scale({pdfZoom}); transform-origin: top left; width: {100 /
						pdfZoom}%;"
				>
					<!-- Sub-tab nav -->
					<div class="subtab-nav">
						<button
							class="subtab-btn"
							class:active={activeTab === 'adicionales'}
							on:click={() => (activeTab = 'adicionales')}
						>
							<span class="subtab-icon">📋</span>
							<span>Adicionales</span>
							<span class="subtab-count">{totalAdicionalesCount}</span>
						</button>
						<button
							class="subtab-btn"
							class:active={activeTab === 'gastos'}
							on:click={() => (activeTab = 'gastos')}
						>
							<span class="subtab-icon">🚗</span>
							<span>Gastos Operativos</span>
							<span class="subtab-count">{gastosOpConceptos.length}</span>
						</button>
						<button
							class="subtab-btn"
							class:active={activeTab === 'impuestos'}
							on:click={() => (activeTab = 'impuestos')}
						>
							<span class="subtab-icon">📊</span>
							<span>Impuestos</span>
							<span class="subtab-count">{impuestosConceptos.length}</span>
						</button>
						<button
							class="subtab-btn"
							class:active={activeTab === 'anticipos'}
							on:click={() => (activeTab = 'anticipos')}
						>
							<span class="subtab-icon">💵</span>
							<span>Anticipos</span>
							<span class="subtab-count">{anticiposConceptos.length}</span>
						</button>
					</div>

					<!-- TAB: ADICIONALES -->
					{#if activeTab === 'adicionales'}
						<table class="excel-table adicionales-table">
							<thead>
								<tr>
									<th class="col-row-num">#</th>
									<th class="col-cliente">CLIENTE</th>
									<th class="col-placa">PLACA</th>
									<th class="col-nombre">NOMBRE 3°</th>
									<th class="col-recorrido">RECORRIDO</th>
									<th class="col-fechas">FECHAS</th>
									<th class="col-vr-unit">V/UNIDAD</th>
									<th class="col-cant">CANT</th>
									<th class="col-admon-pct">ADMON (%)</th>
									<th class="col-admon">VALOR ADMON ($)</th>
									<th class="col-total">TOTAL</th>
									<th class="col-vliq">V/LIQUIDAR</th>
									<th class="col-action"></th>
								</tr>
							</thead>
							<tbody>
								{#each adicionalesOrdenados as adc, idx (adc.id)}
									{@const vLiqGross =
										(Number(adc.valor_unitario) || 0) * (Number(adc.cantidad) || 0)}
									{@const vAdmin = adicionalVAdmin(adc)}
									{@const vLiq = vLiqGross - vAdmin}
									<tr class="row-adicional">
										<td class="cell-row-num"><span class="badge-adc">ADC</span></td>
										<td class="cell-cliente">
											<strong>{adc.cliente || 'TRANSMERALDA'}</strong>
										</td>
										<td class="cell-placa">
											<input
												type="text"
												class="excel-cell-input excel-cell-input-center"
												value={adc.placa || ''}
												placeholder="—"
												on:input={(e) =>
													updateAdicionalField(
														idx,
														'placa',
														(e.currentTarget as HTMLInputElement).value.toUpperCase()
													)}
											/>
										</td>
										<td class="cell-nombre">
											<input
												type="text"
												class="excel-cell-input"
												value={adc.tercero_nombre || ''}
												placeholder="Tercero..."
												on:input={(e) =>
													updateAdicionalField(
														idx,
														'tercero_nombre',
														(e.currentTarget as HTMLInputElement).value
													)}
											/>
										</td>
										<td class="cell-recorrido">
											<input
												type="text"
												class="excel-cell-input"
												value={adc.recorrido || ''}
												placeholder="Recorrido..."
												on:input={(e) =>
													updateAdicionalField(
														idx,
														'recorrido',
														(e.currentTarget as HTMLInputElement).value
													)}
											/>
										</td>
										<td class="cell-fechas">
											<input
												type="text"
												class="excel-cell-input excel-cell-input-xs"
												value={adc.fechas || ''}
												placeholder="Ej: 24-may"
												on:input={(e) =>
													updateAdicionalField(
														idx,
														'fechas',
														(e.currentTarget as HTMLInputElement).value
													)}
											/>
										</td>
										<td class="cell-num">
											<input
												type="text"
												class="excel-cell-input excel-cell-input-num"
												value={adc.valor_unitario ? fmtCOPInput(adc.valor_unitario) : ''}
												placeholder="0"
												on:change={(e) =>
													updateAdicionalField(
														idx,
														'valor_unitario',
														parseCOP((e.currentTarget as HTMLInputElement).value)
													)}
											/>
										</td>
										<td class="cell-num cell-center">
											<input
												type="number"
												class="excel-cell-input excel-cell-input-xs"
												min="1"
												value={adc.cantidad || 1}
												on:input={(e) =>
													updateAdicionalField(
														idx,
														'cantidad',
														Number((e.currentTarget as HTMLInputElement).value) || 0
													)}
											/>
										</td>
										<td class="cell-num cell-center">
											<div class="cell-pct-wrap">
												<input
													type="number"
													step="0.01"
													class="excel-cell-input excel-cell-input-pct"
													min="0"
													value={adc.porcentaje_admin ?? ''}
													placeholder="0"
													on:input={(e) =>
														updateAdicionalField(
															idx,
															'porcentaje_admin',
															parseFloat((e.currentTarget as HTMLInputElement).value) || 0
														)}
												/>
												<span class="cell-pct-suffix">%</span>
											</div>
										</td>
										<td class="cell-num cell-red">{fmtCOP(vAdmin)}</td>
										<td class="cell-num">{fmtCOP(vLiqGross)}</td>
										<td class="cell-num cell-bold cell-green">{fmtCOP(vLiq)}</td>
										<td class="cell-action">
											<div class="cell-action-group">
												<button
													class="btn-tax-toggle"
													class:on={adc.aplica_impuestos !== false}
													on:click={() =>
														updateAdicionalField(
															idx,
															'aplica_impuestos',
															!adc.aplica_impuestos
														)}
													title={adc.aplica_impuestos !== false
														? 'Aplica impuestos (clic para excluir)'
														: 'Excluido de impuestos (clic para aplicar)'}
												>
													{adc.aplica_impuestos !== false ? '%' : '⊘'}
												</button>
												<button
													class="btn-exclude"
													on:click={() => deleteAdicional(idx)}
													title="Eliminar adicional">✕</button
												>
											</div>
										</td>
									</tr>
								{/each}

								{#if adicionalesOrdenados.length === 0}
									<tr class="row-empty">
										<td colspan="13"
											>Sin adicionales. Usa el botón "+ Adicional" en la toolbar para
											agregar.</td
										>
									</tr>
								{/if}
							</tbody>
							<tfoot>
								<tr class="row-summary">
									<td colspan="11" class="cell-tfoot-label">SUBTOTAL ADICIONALES</td>
									<td class="cell-tfoot-value cell-summary-green"
										>{fmtCOP(totalAdicionales)}</td
									>
									<td></td>
								</tr>
							</tfoot>
						</table>
					{/if}

					<!-- TAB: GASTOS OPERATIVOS -->
					{#if activeTab === 'gastos'}
						<table class="excel-table conceptos-table">
							<thead>
								<tr>
									<th class="col-concepto">CONCEPTO</th>
									<th class="col-cant">CANT</th>
									<th class="col-vr-unit">V/UNITARIO</th>
									<th class="col-total">TOTAL</th>
									<th class="col-action"></th>
								</tr>
							</thead>
							<tbody>
								{#each gastosOpConceptos as c, idx (c.id)}
									{@const realIdx = conceptos.findIndex((x) => x.id === c.id)}
									<tr class="row-concepto">
										<td class="cell-concepto cell-bold">
											<input
												type="text"
												class="excel-cell-input"
												value={c.concepto?.replace(/_/g, ' ') || ''}
												placeholder="Nombre del gasto"
												on:change={(e) =>
													updateConceptoField(
														realIdx,
														'concepto',
														(e.currentTarget as HTMLInputElement).value
															.toUpperCase()
															.replace(/\s+/g, '_')
													)}
											/>
										</td>
										<td class="cell-input-cell">
											<input
												type="number"
												class="excel-cell-input excel-cell-input-dias"
												value={c.dias || 0}
												on:input={(e) =>
													updateConceptoField(
														realIdx,
														'dias',
														parseFloat((e.currentTarget as HTMLInputElement).value) || 0
													)}
											/>
										</td>
										<td class="cell-num">
											<input
												type="text"
												class="excel-cell-input excel-cell-input-num"
												value={c.valor_unitario ? fmtCOPInput(c.valor_unitario) : ''}
												placeholder="0"
												on:change={(e) =>
													updateConceptoField(
														realIdx,
														'valor_unitario',
														parseCOP((e.currentTarget as HTMLInputElement).value)
													)}
											/>
										</td>
										<td class="cell-total">{fmtCOP(c.valor_total || 0)}</td>
										<td class="cell-action-cell">
											<button
												class="btn-exclude"
												on:click={() => deleteConcepto(realIdx)}
												title="Eliminar gasto">✕</button
											>
										</td>
									</tr>
								{/each}

								{#if gastosOpConceptos.length === 0}
									<tr class="row-empty">
										<td colspan="5">Sin gastos operativos registrados</td>
									</tr>
								{/if}

								<tr class="row-add-concept">
									<td colspan="5">
										<CellSelect
											options={CONCEPTOS_GASTOS_OP}
											placeholder="+ Agregar gasto operativo (ej: DOTACION, COMBUSTIBLE, PEAJES...)"
											onSelect={(val) => addConcepto('GASTO_OPERATIVO', val)}
										/>
									</td>
								</tr>
							</tbody>
							<tfoot>
								<tr class="row-summary">
									<td colspan="3" class="cell-tfoot-label">TOTAL GASTOS OPERATIVOS</td>
									<td class="cell-tfoot-value cell-summary-red">{fmtCOP(totalGastosOp)}</td>
									<td></td>
								</tr>
							</tfoot>
						</table>
					{/if}

					<!-- TAB: IMPUESTOS -->
					{#if activeTab === 'impuestos'}
						<table class="excel-table conceptos-table">
							<thead>
								<tr>
									<th class="col-concepto">CONCEPTO</th>
									<th class="col-pct">%</th>
									<th class="col-vr-unit">BASE IMPONIBLE</th>
									<th class="col-total">VALOR</th>
									<th class="col-action"></th>
								</tr>
							</thead>
							<tbody>
								{#each impuestosConceptos as c (c.id)}
									{@const realIdx = conceptos.findIndex((x) => x.id === c.id)}
									<tr class="row-concepto">
										<td class="cell-concepto cell-bold">
											{c.concepto?.replace(/_/g, ' ')}
										</td>
										<td class="cell-input-cell">
											<div class="cell-pct-wrap">
												<input
													type="number"
													step="0.01"
													class="excel-cell-input excel-cell-input-pct"
													value={c.porcentaje ?? ''}
													placeholder="0"
													on:input={(e) =>
														updateConceptoField(
															realIdx,
															'porcentaje',
															parseFloat((e.currentTarget as HTMLInputElement).value) || 0
														)}
												/>
												<span class="cell-pct-suffix">%</span>
											</div>
										</td>
										<td class="cell-base">{fmtCOP(c.base_calculo || 0)}</td>
										<td class="cell-total">{fmtCOP(c.valor_total || 0)}</td>
										<td class="cell-action-cell">
											<button
												class="btn-exclude"
												on:click={() => deleteConcepto(realIdx)}
												title="Eliminar impuesto">✕</button
											>
										</td>
									</tr>
								{/each}

								{#if impuestosConceptos.length === 0}
									<tr class="row-empty">
										<td colspan="5">Sin impuestos registrados</td>
									</tr>
								{/if}

								<tr class="row-add-concept">
									<td colspan="5">
										<CellSelect
											options={CONCEPTOS_IMPUESTOS}
											placeholder="+ Agregar impuesto o retención..."
											onSelect={(val) => addConcepto('IMPUESTO', val)}
										/>
									</td>
								</tr>
							</tbody>
							<tfoot>
								<tr class="row-summary">
									<td colspan="3" class="cell-tfoot-label">TOTAL IMPUESTOS</td>
									<td class="cell-tfoot-value cell-summary-red">{fmtCOP(totalImpuestos)}</td>
									<td></td>
								</tr>
							</tfoot>
						</table>
					{/if}

					<!-- TAB: ANTICIPOS -->
					{#if activeTab === 'anticipos'}
						<table class="excel-table conceptos-table">
							<thead>
								<tr>
									<th class="col-concepto">CONCEPTO</th>
									<th class="col-fechas">FECHA</th>
									<th class="col-vr-unit">VALOR</th>
									<th class="col-action"></th>
								</tr>
							</thead>
							<tbody>
								{#each anticiposConceptos as c (c.id)}
									{@const realIdx = conceptos.findIndex((x) => x.id === c.id)}
									<tr class="row-concepto row-anticipo">
										<td class="cell-concepto cell-bold">
											<input
												type="text"
												class="excel-cell-input"
												value={c.concepto || ''}
												placeholder="Ej: Combustible, Adelanto..."
												on:change={(e) =>
													updateConceptoField(
														realIdx,
														'concepto',
														(e.currentTarget as HTMLInputElement).value
															.toUpperCase()
															.replace(/\s+/g, '_')
													)}
											/>
										</td>
										<td class="cell-input-cell">
											<input
												type="date"
												class="excel-cell-input"
												value={c.observaciones || ''}
												on:change={(e) =>
													updateConceptoField(
														realIdx,
														'observaciones',
														(e.currentTarget as HTMLInputElement).value
													)}
											/>
										</td>
										<td class="cell-num">
											<input
												type="text"
												class="excel-cell-input excel-cell-input-num"
												value={c.valor_unitario ? fmtCOPInput(c.valor_unitario) : ''}
												placeholder="0"
												on:change={(e) =>
													updateConceptoField(
														realIdx,
														'valor_unitario',
														parseCOP((e.currentTarget as HTMLInputElement).value)
													)}
											/>
										</td>
										<td class="cell-action-cell">
											<button
												class="btn-exclude"
												on:click={() => deleteConcepto(realIdx)}
												title="Eliminar anticipo">✕</button
											>
										</td>
									</tr>
								{/each}

								{#if anticiposConceptos.length === 0}
									<tr class="row-empty">
										<td colspan="4">Sin anticipos registrados</td>
									</tr>
								{/if}

								<tr class="row-add-concept">
									<td colspan="4">
										<button class="add-anticipo-btn" on:click={() => addConcepto('ANTICIPO')}>
											<svg
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2.5"
											>
												<line x1="12" y1="5" x2="12" y2="19" />
												<line x1="5" y1="12" x2="19" y2="12" />
											</svg>
											+ Agregar anticipo
										</button>
									</td>
								</tr>
							</tbody>
							<tfoot>
								<tr class="row-summary">
									<td colspan="2" class="cell-tfoot-label">TOTAL ANTICIPOS</td>
									<td class="cell-tfoot-value cell-summary-red">{fmtCOP(totalAnticipos)}</td>
									<td></td>
								</tr>
							</tfoot>
						</table>
					{/if}
				</div>
			</div>

			<!-- SIDEBAR -->
			<aside class="sidebar">
				<div class="sidebar-header">
					<div class="sidebar-eyebrow">Resumen</div>
					<div class="sidebar-title">{cabecera.consecutivo}</div>
					<div class="sidebar-meta">
						{cabecera.mes ? MESES[cabecera.mes - 1] : ''} {cabecera.anio}
					</div>
					<div class="sidebar-badges">
						<span class="badge-estado" data-estado={cabecera.estado}>{cabecera.estado}</span>
					</div>
					{#if cabecera.creado_por}
						<div class="sidebar-creator">
							👤 {cabecera.creado_por.nombre}
						</div>
					{/if}
				</div>

				<div class="sidebar-card stat-card">
					<div class="stat-label">Adicionales</div>
					<div class="stat-value">{totalAdicionalesCount}</div>
				</div>

				<div class="sidebar-card stat-card stat-card-green">
					<div class="stat-label">V/Liquidar</div>
					<div class="stat-value">{fmtCOP(totalAdicionales)}</div>
				</div>

				<div class="sidebar-card stat-card stat-card-amber">
					<div class="stat-label">Gastos Op.</div>
					<div class="stat-value">{fmtCOP(totalGastosOp)}</div>
				</div>

				<div class="sidebar-card stat-card stat-card-red">
					<div class="stat-label">Impuestos</div>
					<div class="stat-value">{fmtCOP(totalImpuestos)}</div>
				</div>

				<div class="sidebar-card stat-card stat-card-red">
					<div class="stat-label">Anticipos</div>
					<div class="stat-value">{fmtCOP(totalAnticipos)}</div>
				</div>

				<div class="sidebar-card stat-card stat-card-outline">
					<div class="stat-label">Total Descuentos</div>
					<div class="stat-value">{fmtCOP(totalDescuentos)}</div>
				</div>

				<div class="sidebar-card stat-card stat-card-final">
					<div class="stat-label">TOTAL A PAGAR</div>
					<div class="stat-value stat-value-xl">{fmtCOP(totalPagar)}</div>
				</div>

				{#if porPlaca.length > 0}
					<div class="sidebar-card">
						<div class="sidebar-card-title">Por Placa</div>
						<div class="por-placa-list">
							{#each porPlaca as item}
								<div class="por-placa-item">
									<div class="por-placa-placa">{fmtPlaca(item.placa)}</div>
									<div class="por-placa-meta">
										<span class="por-placa-count">{item.count} adc</span>
										<span class="por-placa-valor">{fmtCOP(item.valor)}</span>
									</div>
									{#if item.terceros.length > 0}
										<div class="por-placa-tercero">
											{item.terceros.slice(0, 2).join(' · ')}
											{#if item.terceros.length > 2}
												+{item.terceros.length - 2}
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if cierresOrigen.length > 0}
					<div class="sidebar-card">
						<div class="sidebar-card-title">Cierres Origen ({cierresOrigen.length})</div>
						<div class="cierres-origen-list">
							{#each cierresOrigen as cierre}
								<div class="cierre-origen-item">
									<div class="cierre-origen-placa">{fmtPlaca(cierre.placa)}</div>
									<div class="cierre-origen-cons">{cierre.consecutivo}</div>
									<div class="cierre-origen-bottom">
										<span class="badge-estado badge-estado-xs" data-estado={cierre.estado}
											>{cierre.estado}</span
										>
										<span class="cierre-origen-valor">{fmtCOP(cierre.total_pagar)}</span>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="sidebar-hint">
					<kbd>⌘ / Ctrl + S</kbd> para guardar
				</div>
			</aside>
		</div>
	</div>
{/if}

<SelectionStatsFooter
	count={selectionStats.count}
	nonEmpty={selectionStats.nonEmpty}
	sum={selectionStats.sum}
	avg={selectionStats.avg}
	min={selectionStats.min}
	max={selectionStats.max}
	allNumeric={selectionStats.allNumeric}
	onClear={clearSelection}
/>

<style>
	.loading-state,
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60px 20px;
		color: #94a3b8;
		gap: 16px;
	}
	.error-state p {
		color: #dc2626;
		font-weight: 600;
	}
	.btn-back {
		padding: 8px 16px;
		background: #0f4025;
		color: #fff;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 600;
	}
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #e2e8f0;
		border-top-color: #059669;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.page-wrap {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		z-index: 200;
		background: #f8fafc;
	}

	.excel-toolbar {
		background: #1e2429;
		padding: 10px 18px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-shrink: 0;
		box-shadow: 0 3px 16px rgba(0, 0, 0, 0.4);
	}
	.excel-toolbar-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.toolbar-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border: none;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}
	.toolbar-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.toolbar-btn-back {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
		border: 1px solid rgba(255, 255, 255, 0.2);
	}
	.toolbar-btn-back:hover {
		background: rgba(255, 255, 255, 0.18);
	}
	.toolbar-btn-amber {
		background: #d97706;
		color: #fff;
	}
	.toolbar-btn-amber:hover {
		background: #b45309;
	}
	.toolbar-btn-dark {
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
		border: 1px solid rgba(255, 255, 255, 0.15);
	}
	.toolbar-btn-dark:hover {
		background: rgba(255, 255, 255, 0.2);
	}
	.toolbar-divider {
		width: 1px;
		height: 24px;
		background: rgba(255, 255, 255, 0.15);
	}
	.toolbar-info {
		display: flex;
		flex-direction: column;
	}
	.toolbar-title {
		color: #fff;
		font-weight: 700;
		font-size: 13px;
	}
	.toolbar-subtitle {
		color: rgba(255, 255, 255, 0.5);
		font-size: 11px;
		font-family: monospace;
	}
	.excel-toolbar-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.zoom-controls {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 8px;
		padding: 2px;
	}
	.zoom-btn {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		color: #fff;
		border: none;
		border-radius: 6px;
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.15s;
	}
	.zoom-btn:hover {
		background: rgba(255, 255, 255, 0.18);
	}
	.zoom-reset {
		font-size: 13px;
	}
	.zoom-fit {
		font-size: 14px;
	}
	.zoom-label {
		min-width: 44px;
		text-align: center;
		font-size: 11px;
		font-weight: 600;
		color: #fff;
		font-variant-numeric: tabular-nums;
		padding: 0 4px;
	}

	/* ─── LAYOUT SPLIT ──────────────────────────────────────── */
	.page-body {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	.excel-grid-body {
		flex: 1;
		min-width: 0;
		overflow: auto;
		background: #fff;
		box-shadow: inset 0 4px 24px rgba(0, 0, 0, 0.15);
	}
	.excel-grid-container {
		background: #fff;
		min-width: max-content;
	}

	/* ─── SUB-TABS ─────────────────────────────────────────── */
	.subtab-nav {
		display: flex;
		gap: 2px;
		background: #f1f5f9;
		padding: 8px 12px 0;
		border-bottom: 1px solid #cbd5e1;
		position: sticky;
		top: 0;
		z-index: 5;
	}
	.subtab-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		background: transparent;
		border: none;
		border-radius: 8px 8px 0 0;
		font-size: 12px;
		font-weight: 600;
		color: #64748b;
		cursor: pointer;
		transition: all 0.15s;
		border-bottom: 3px solid transparent;
	}
	.subtab-btn:hover {
		background: #e2e8f0;
		color: #334155;
	}
	.subtab-btn.active {
		background: #fff;
		color: #0f4025;
		border-bottom-color: #059669;
	}
	.subtab-icon {
		font-size: 14px;
	}
	.subtab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		padding: 0 6px;
		height: 18px;
		background: rgba(15, 64, 37, 0.1);
		color: #0f4025;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.subtab-btn.active .subtab-count {
		background: #0f4025;
		color: #fff;
	}

	.excel-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.excel-table th {
		position: sticky;
		top: 49px;
		z-index: 4;
		background: #0f4025;
		color: #fff;
		padding: 8px 10px;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-bottom: 2px solid #0a2e1a;
		text-align: left;
		white-space: nowrap;
	}
	.has-zoom .excel-table th {
		position: static;
	}
	.has-zoom .excel-table {
		border-collapse: separate;
		border-spacing: 0;
	}
	.excel-table td {
		padding: 6px 10px;
		border-bottom: 1px solid #e2e8f0;
		border-right: 1px solid #e2e8f0;
		vertical-align: middle;
	}
	.excel-table td:first-child {
		border-left: 1px solid #e2e8f0;
	}
	.excel-table tr.row-summary td {
		border-right: none;
		border-left: none;
	}
	.excel-table tbody tr:hover {
		background: #f8fafc;
	}
	.adicionales-table,
	.conceptos-table {
		min-width: 1100px;
	}
	.adicionales-table th,
	.conceptos-table th {
		padding: 7px 8px;
	}
	.adicionales-table td,
	.conceptos-table td {
		padding: 5px 8px;
		font-size: 11px;
	}

	/* Column widths */
	.col-row-num {
		width: 50px;
		text-align: center;
	}
	.col-cliente {
		min-width: 120px;
		max-width: 160px;
	}
	.col-placa {
		width: 90px;
		text-align: center;
	}
	.col-nombre {
		min-width: 140px;
	}
	.col-recorrido {
		min-width: 150px;
	}
	.col-fechas {
		width: 110px;
		text-align: center;
	}
	.col-vr-unit {
		width: 110px;
		text-align: right;
	}
	.col-cant {
		width: 60px;
		text-align: center;
	}
	.col-admon-pct {
		width: 70px;
		text-align: center;
	}
	.col-admon {
		width: 100px;
		text-align: right;
	}
	.col-total {
		width: 110px;
		text-align: right;
	}
	.col-vliq {
		width: 110px;
		text-align: right;
	}
	.col-action {
		width: 72px;
		text-align: center;
	}
	.col-concepto {
		min-width: 200px;
	}
	.col-pct {
		width: 80px;
		text-align: center;
	}

	/* Cell styles */
	.cell-row-num {
		text-align: center;
		color: #94a3b8;
		font-family: monospace;
		font-size: 11px;
	}
	.cell-cliente {
		font-size: 12px;
		color: #0f4025;
	}
	.cell-placa {
		font-family: monospace;
		font-weight: 700;
		color: #0f4025;
		text-align: center;
	}
	.cell-nombre {
		font-size: 12px;
		color: #374151;
	}
	.cell-recorrido {
		color: #475569;
	}
	.cell-fechas {
		color: #64748b;
		font-size: 11px;
		text-align: center;
	}
	.cell-concepto {
		font-weight: 500;
		color: #374151;
	}
	.cell-bold {
		font-weight: 700;
	}
	.cell-green {
		color: #059669 !important;
	}
	.cell-red {
		color: #dc2626 !important;
	}
	.cell-center {
		text-align: center;
	}
	.cell-num {
		font-family: monospace;
		font-size: 12px;
		text-align: right;
	}
	.cell-input-cell {
		text-align: center;
	}
	.cell-base {
		font-family: monospace;
		font-size: 11px;
		color: #94a3b8;
		text-align: right;
	}
	.cell-total {
		font-family: monospace;
		font-size: 13px;
		font-weight: 800;
		color: #059669;
		text-align: right;
		white-space: nowrap;
	}
	.cell-action-cell {
		width: 36px;
		text-align: center;
	}
	.cell-action-group {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
	}
	.row-empty td {
		text-align: center;
		color: #94a3b8;
		font-style: italic;
		padding: 24px;
	}
	.row-add-concept td {
		padding: 8px 10px;
		background: #fafbfc;
		border-bottom: 1px solid #e2e8f0;
	}
	.row-concepto td {
		padding: 5px 10px;
	}
	.row-concepto:hover td {
		background: #fafbfc;
	}
	.row-adicional td {
		background: #f7fdf9;
		color: #0f4025;
		font-weight: 600;
	}
	.row-anticipo td {
		background: #f0fdf4;
	}

	.row-summary td {
		background: #f8fafc;
		padding: 8px 10px;
		font-size: 12px;
		color: #374151;
	}
	.cell-tfoot-label {
		font-weight: 600;
		color: #334155;
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.04em;
		text-align: right;
	}
	.cell-tfoot-value {
		font-family: monospace;
		font-size: 13px;
		font-weight: 800;
		color: #0f172a;
		text-align: right;
	}
	.cell-summary-red {
		color: #dc2626 !important;
	}
	.cell-summary-green {
		color: #059669 !important;
	}

	.badge-adc {
		display: inline-block;
		padding: 2px 6px;
		background: #0f4025;
		color: #fff;
		border-radius: 3px;
		font-size: 9px;
		font-weight: 800;
		letter-spacing: 0.06em;
	}

	.btn-tax-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: 4px;
		background: #f1f5f9;
		color: #94a3b8;
		font-size: 12px;
		font-weight: 800;
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-tax-toggle:hover {
		background: #e2e8f0;
	}
	.btn-tax-toggle.on {
		background: #dcfce7;
		color: #16a34a;
	}
	.btn-tax-toggle.on:hover {
		background: #bbf7d0;
	}

	.btn-exclude {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: 4px;
		background: #fef2f2;
		color: #dc2626;
		font-size: 12px;
		font-weight: 800;
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-exclude:hover {
		background: #fee2e2;
	}

	.add-anticipo-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		font-size: 11px;
		font-weight: 700;
		color: #047857;
		background: #ffffff;
		border: 1px solid #10b981;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
		letter-spacing: 0.02em;
	}
	.add-anticipo-btn:hover {
		background: #10b981;
		color: #ffffff;
		border-color: #059669;
	}
	.add-anticipo-btn svg {
		stroke: currentColor;
	}

	.excel-cell-input {
		width: 100%;
		padding: 4px 6px;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		font-size: 12px;
		font-family: inherit;
		color: #0f172a;
		outline: none;
		transition: all 0.12s;
	}
	.excel-cell-input:hover {
		border-color: #e2e8f0;
		background: #fff;
	}
	.excel-cell-input:focus {
		border-color: #059669;
		background: #fff;
		box-shadow: 0 0 0 2px rgba(5, 150, 105, 0.15);
	}
	.excel-cell-input-xs {
		max-width: 80px;
	}
	.excel-cell-input-num {
		font-family: monospace;
		text-align: right;
		font-weight: 600;
	}
	.excel-cell-input-dias {
		max-width: 60px;
		text-align: center;
		font-weight: 600;
	}
	.excel-cell-input-pct {
		max-width: 70px;
		text-align: right;
		font-weight: 600;
		padding-right: 18px;
	}
	.excel-cell-input-center {
		text-align: center;
		font-family: monospace;
		font-weight: 700;
		text-transform: uppercase;
	}
	.cell-pct-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.cell-pct-suffix {
		position: absolute;
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
		font-family: monospace;
		font-size: 11px;
		font-weight: 700;
		color: #94a3b8;
		pointer-events: none;
	}

	/* ─── SIDEBAR ─────────────────────────────────────────── */
	.sidebar {
		width: 320px;
		flex-shrink: 0;
		background: #f8fafc;
		border-left: 1px solid #e2e8f0;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sidebar::-webkit-scrollbar {
		width: 8px;
	}
	.sidebar::-webkit-scrollbar-track {
		background: #e2e8f0;
	}
	.sidebar::-webkit-scrollbar-thumb {
		background: #cbd5e1;
		border-radius: 4px;
	}
	.sidebar::-webkit-scrollbar-thumb:hover {
		background: #94a3b8;
	}

	.sidebar-header {
		padding: 14px 16px;
		background: linear-gradient(135deg, #0f4025, #1a5c38);
		color: #fff;
		border-radius: 10px;
		box-shadow: 0 2px 8px rgba(15, 64, 37, 0.2);
	}
	.sidebar-eyebrow {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.6;
		margin-bottom: 4px;
	}
	.sidebar-title {
		font-size: 16px;
		font-weight: 800;
		font-family: monospace;
		letter-spacing: 0.02em;
	}
	.sidebar-meta {
		font-size: 11px;
		opacity: 0.85;
		margin-top: 2px;
		font-family: monospace;
	}
	.sidebar-badges {
		margin-top: 8px;
	}
	.sidebar-creator {
		font-size: 10px;
		opacity: 0.75;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid rgba(255, 255, 255, 0.15);
	}

	.badge-estado {
		display: inline-flex;
		align-items: center;
		padding: 3px 10px;
		font-size: 9px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
	}
	.badge-estado-xs {
		padding: 2px 6px;
		font-size: 8px;
	}
	.badge-estado[data-estado='BORRADOR'] {
		background: rgba(251, 191, 36, 0.25);
		color: #fef3c7;
	}
	.badge-estado[data-estado='APROBADA'] {
		background: rgba(16, 185, 129, 0.3);
		color: #d1fae5;
	}
	.badge-estado[data-estado='FACTURADA'] {
		background: rgba(59, 130, 246, 0.3);
		color: #dbeafe;
	}
	.badge-estado[data-estado='ANULADA'] {
		background: rgba(239, 68, 68, 0.3);
		color: #fecaca;
	}
	.badge-estado[data-estado='LIQUIDADA'] {
		background: rgba(168, 85, 247, 0.3);
		color: #e9d5ff;
	}

	.sidebar-card {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		padding: 12px 14px;
	}
	.sidebar-card-title {
		font-size: 10px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
		margin-bottom: 8px;
	}

	.stat-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
	}
	.stat-label {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #64748b;
	}
	.stat-value {
		font-family: monospace;
		font-size: 14px;
		font-weight: 800;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
	}
	.stat-card-green {
		background: #f0fdf4;
		border-color: #bbf7d0;
	}
	.stat-card-green .stat-value {
		color: #059669;
	}
	.stat-card-amber {
		background: #fffbeb;
		border-color: #fde68a;
	}
	.stat-card-amber .stat-value {
		color: #b45309;
	}
	.stat-card-red {
		background: #fef2f2;
		border-color: #fecaca;
	}
	.stat-card-red .stat-value {
		color: #dc2626;
	}
	.stat-card-outline {
		background: #f1f5f9;
		border-color: #cbd5e1;
	}
	.stat-card-final {
		background: linear-gradient(135deg, #0f4025, #1a5c38);
		border: none;
		color: #fff;
		padding: 14px 16px;
	}
	.stat-card-final .stat-label {
		color: rgba(255, 255, 255, 0.7);
	}
	.stat-card-final .stat-value {
		color: #bbf7d0;
	}
	.stat-value-xl {
		font-size: 18px;
	}

	.por-placa-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.por-placa-item {
		padding: 8px 10px;
		background: #f8fafc;
		border-radius: 6px;
		border: 1px solid #e2e8f0;
	}
	.por-placa-placa {
		font-family: monospace;
		font-weight: 800;
		color: #0f4025;
		font-size: 12px;
	}
	.por-placa-meta {
		display: flex;
		justify-content: space-between;
		margin-top: 2px;
	}
	.por-placa-count {
		font-size: 10px;
		color: #64748b;
		font-weight: 600;
	}
	.por-placa-valor {
		font-family: monospace;
		font-size: 11px;
		font-weight: 700;
		color: #059669;
	}
	.por-placa-tercero {
		font-size: 10px;
		color: #64748b;
		margin-top: 4px;
		font-style: italic;
	}

	.cierres-origen-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.cierre-origen-item {
		padding: 10px 12px;
		background: linear-gradient(135deg, #0f4025 0%, #1a5c38 100%);
		border-radius: 8px;
		border: 1px solid #0a2e1a;
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.05) inset,
			0 1px 3px rgba(15, 64, 37, 0.25);
		position: relative;
		overflow: hidden;
	}
	.cierre-origen-item::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
		background: #34d399;
	}
	.cierre-origen-placa {
		font-family: monospace;
		font-weight: 800;
		color: #ffffff;
		font-size: 13px;
		letter-spacing: 0.04em;
	}
	.cierre-origen-cons {
		font-family: monospace;
		font-size: 10px;
		color: rgba(255, 255, 255, 0.55);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.cierre-origen-bottom {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid rgba(255, 255, 255, 0.12);
		gap: 8px;
	}
	.cierre-origen-valor {
		font-family: monospace;
		font-size: 12px;
		font-weight: 800;
		color: #bbf7d0;
		font-variant-numeric: tabular-nums;
	}
	.cierre-origen-item .badge-estado-xs,
	.cierre-origen-item .badge-estado-xs[data-estado] {
		background: rgba(255, 255, 255, 0.16) !important;
		color: #ffffff !important;
		border: 1px solid rgba(255, 255, 255, 0.25) !important;
	}

	.sidebar-hint {
		text-align: center;
		font-size: 10px;
		color: #94a3b8;
		padding: 8px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.sidebar-hint kbd {
		display: inline-block;
		padding: 2px 6px;
		background: #fff;
		border: 1px solid #cbd5e1;
		border-bottom-width: 2px;
		border-radius: 4px;
		font-family: monospace;
		font-size: 10px;
		color: #475569;
		font-weight: 700;
	}

	/* ─── SELECCIÓN MÚLTIPLE DE CELDAS ────────────────────── */
	:global(.excel-table .cell-num.cell-selected),
	:global(.excel-table .cell-total.cell-selected),
	:global(.excel-table .cell-base.cell-selected),
	:global(.excel-table .cell-tfoot-value.cell-selected),
	:global(.excel-table .cell-summary-red.cell-selected) {
		background: rgba(16, 185, 129, 0.18) !important;
		box-shadow: inset 0 0 0 1px #10b981;
		color: #047857 !important;
		position: relative;
		z-index: 1;
	}
	:global(.excel-table input.cell-selected) {
		background: rgba(16, 185, 129, 0.15) !important;
		box-shadow: inset 0 0 0 2px #10b981;
	}
	:global(.excel-table tr:hover .cell-selected) {
		background: rgba(16, 185, 129, 0.28) !important;
	}

	/* Cursor "cell" en celdas numéricas para indicar que se pueden arrastrar */
	.excel-table :global(.cell-num),
	.excel-table :global(.cell-total),
	.excel-table :global(.cell-base),
	.excel-table :global(.cell-tfoot-value),
	.excel-table :global(.cell-summary-red),
	.excel-table :global(input.excel-cell-input-num),
	.excel-table :global(input.excel-cell-input-dias),
	.excel-table :global(input.excel-cell-input-pct) {
		cursor: cell;
	}

	.excel-table :global(.cell-num),
	.excel-table :global(.cell-total),
	.excel-table :global(.cell-base),
	.excel-table :global(.cell-tfoot-value),
	.excel-table :global(.cell-summary-red) {
		user-select: none;
		-webkit-user-select: none;
	}

	:global(.excel-grid-body.is-selecting),
	:global(.excel-grid-body.is-selecting *) {
		cursor: cell !important;
		user-select: none !important;
		-webkit-user-select: none !important;
	}

	.excel-grid-body::-webkit-scrollbar {
		width: 8px;
		height: 8px;
	}
	.excel-grid-body::-webkit-scrollbar-track {
		background: #e2e8f0;
	}
	.excel-grid-body::-webkit-scrollbar-thumb {
		background: #cbd5e1;
		border-radius: 4px;
	}
	.excel-grid-body::-webkit-scrollbar-thumb:hover {
		background: #94a3b8;
	}

	@media (max-width: 1100px) {
		.sidebar {
			width: 280px;
		}
	}
	@media (max-width: 900px) {
		.page-body {
			flex-direction: column;
		}
		.sidebar {
			width: 100%;
			max-height: 320px;
			border-left: none;
			border-top: 1px solid #e2e8f0;
		}
	}
</style>
