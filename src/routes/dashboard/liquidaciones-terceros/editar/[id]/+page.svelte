<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { goto, beforeNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import {
		liquidacionesTercerosDescuentosAPI,
		type ConceptoDescuento,
		type AdicionalTransmeralda
	} from '$lib/api/liquidaciones-terceros-descuentos';
	import ModalSelectConductor from '$lib/components/ui/ModalSelectConductor.svelte';
	import PresenceAvatars from '$lib/components/PresenceAvatars.svelte';
	import AutosaveIndicator from '$lib/components/AutosaveIndicator.svelte';
	import ChatLiquidacionFab from '$lib/components/chat/ChatLiquidacionFab.svelte';
	import CellSelect from '$lib/components/ui/CellSelect.svelte';
	import SelectionStatsFooter from '$lib/components/ui/SelectionStatsFooter.svelte';
	import * as realtimeCollab from '$lib/stores/realtimeCollab';
	import { connectSocket } from '$lib/socketClient';

	$: id = $page.params.id;

	beforeNavigate((nav) => {
		const s = realtimeCollab.getState();
		if (s.saveStatus === 'editing' || s.saveStatus === 'saving') {
			if (!confirm('Hay cambios sin guardar. ¿Seguro que deseas salir?')) {
				nav.cancel();
			}
		}
	});

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
	const CONCEPTOS_LABORALES = [
		'SALARIO',
		'AUXILIO_TRANSPORTE',
		'BONIFICACION',
		'OTROS_AUXILIOS',
		'RECARGOS',
		'CESANTIAS',
		'INTERESES_CESANTIAS',
		'PRIMA',
		'VACACIONES',
		'SALUD',
		'PENSION',
		'ARP',
		'PARAFISCALES'
	];
	const CONCEPTOS_GASTOS = [
		'DOTACION',
		'EXAMEN_MEDICO',
		'COMBUSTIBLE',
		'PAPELERIA',
		'GASTOS_DIVERSOS'
	];
	const CONCEPTOS_IMPUESTOS = [
		'RETENCION_ICA',
		'AVISOS_TABLEROS',
		'SOBRETASA_BOMBERIL',
		'RETENCION_FUENTE'
	];

	// ─── GASTOS OPERATIVOS AUTOMÁTICOS ─────────────────────
	// Estos 5 conceptos se inicializan automáticamente en el orden definido
	// por `ORDEN_GASTOS_CANONICO` cada vez que se carga la liquidación.
	// DOTACION, EXAMEN_MEDICO y GASTOS_DIVERSOS se calculan automáticamente
	// por defecto, pero el usuario puede editarlos manualmente (override).
	// Cuando un campo se edita, se marca como `calculado: false` y el
	// auto-cálculo lo respeta. PAPELERIA y COMBUSTIBLE siempre son 100%
	// manuales.
	const ORDEN_GASTOS_CANONICO: Record<string, number> = {
		DOTACION: 1,
		EXAMEN_MEDICO: 2,
		COMBUSTIBLE: 3,
		PAPELERIA: 4,
		GASTOS_DIVERSOS: 5
	};
	// Lista de gastos que se auto-crean al cargar la liquidación, en orden
	// canónico de aparición en la tabla.
	const GASTOS_AUTOMATICOS_ORDEN = Object.keys(ORDEN_GASTOS_CANONICO);
	const CONCEPTOS_CALCULADOS_AUTO = new Set(['DOTACION', 'EXAMEN_MEDICO', 'GASTOS_DIVERSOS']);
	const VALOR_DOTACION = 3985;
	const VALOR_EXAMEN_MEDICO = 2882;
	// Tarifa fija de GASTOS_DIVERSOS que se suma al porcentaje del total facturado.
	// Fórmula: valor_total = TARIFA_FIJA_GASTOS_DIVERSOS + (PORCENTAJE × Σ total facturado)
	const TARIFA_FIJA_GASTOS_DIVERSOS = 20000;
	// Porcentaje aplicado a GASTOS_DIVERSOS sobre el TOTAL facturado
	// de los items de liquidación (0.4% = 4 por mil).
	const PORCENTAJE_GASTO_POR_ITEM = 0.004; // 0.4%
	const ORDEN_BASE_GASTO = 5000; // después de los laborales (que van de 0-4999)
	const ORDEN_BASE_GASTO_NO_CANONICO =
		ORDEN_BASE_GASTO + Object.keys(ORDEN_GASTOS_CANONICO).length; // 5005
	const ORDEN_BASE_IMPUESTO = 7000; // después de gastos operativos

	// Orden canónico de impuestos (asegura que se muestren siempre en este orden)
	const ORDEN_IMPUESTOS: Record<string, number> = {
		RETENCION_ICA: 1,
		AVISOS_TABLEROS: 2,
		SOBRETASA_BOMBERIL: 3,
		RETENCION_FUENTE: 4
	};

	let loading = true;
	let loadError = '';
	let cierre: any = null;
	let borradorResults: any[] = [];
	let placasUnicas: any[] = [];
	let todosTerceros: any[] = [];
	let todosTercerosIncluidos: any[] = [];
	let excludedItemKeys = new Set<string>();
	let aplicaImpuestosByPivote: Record<string, boolean> = {};
	let adicionalesPorPlaca: Record<number, AdicionalTransmeralda[]> = {};
	let conductorNameInputs: Record<string, string> = {};
	let conductorFromNomina: Record<string, boolean> = {};
	/// Override manual de propietario por conductor. Si el conductor está en
	/// este map, gana sobre la auto-detección. La clave es `0::conductorId`.
	let conductorEsPropietarioOverride: Record<string, boolean> = {};
	/// Estado efectivo (auto-detectado o override). Es lo que usa la lógica
	/// de DOTACION. Nunca se persiste, se recomputa al cargar.
	let conductorEsPropietario: Record<string, boolean> = {};
	/// Map conductorId → "auto" | "manual", para mostrar el badge correcto
	/// en la UI y distinguir origen del flag.
	let conductorPropietarioOrigen: Record<string, 'auto' | 'manual'> = {};
	let nominaLoading = false;
	let conductorModalOpen = false;
	let conductorModalPlacaIdx: number | null = null;

	let sortKey: string | null = 'facturas';
	let sortDir: 'asc' | 'desc' = 'asc';

	// ─── ZOOM (persisted in sessionStorage) ─────────────────────
	let pdfZoom = (() => {
		if (typeof sessionStorage !== 'undefined') {
			const saved = sessionStorage.getItem('liq-tercero-edit-zoom');
			if (saved) return parseFloat(saved) || 1;
		}
		return 1;
	})();
	$: if (typeof sessionStorage !== 'undefined')
		sessionStorage.setItem('liq-tercero-edit-zoom', String(pdfZoom));

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
		// Reference width: the table at 100% is ~1820px (matching the PDF view)
		const REFERENCE_WIDTH_PX = 1820;
		const padding = 40;
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
		'.cell-num, .cell-total, .cell-base, .cell-section-total, .cell-section-pct, .cell-tfoot-value, .cell-summary-red, input.excel-cell-input-num, input.excel-cell-input-dias, input.excel-cell-input-pct';

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
		// Primero intenta matchear el target directamente (puede ser un input o un td)
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

	function clearSelection(reason: string = '') {
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
		// Solo botón principal (0 = izquierdo)
		if (e.button !== 0) return;
		const target = e.target as HTMLElement;

		// Ignorar si el click es en un dropdown del CellSelect, modal, o el footer
		if (
			target.closest('.cell-select-dropdown') ||
			target.closest('.modal-overlay') ||
			target.closest('.selection-stats-footer')
		) {
			return;
		}

		const cell = getCellFromTarget(target);
		if (!cell) {
			// Si el usuario hace click fuera de cualquier celda numérica y hay selección, la limpiamos
			if (!e.shiftKey && selectedCellSet.size > 0) {
				clearSelection('click fuera de celdas');
			}
			return;
		}

		// CRÍTICO: si el click es DIRECTAMENTE sobre un input editable,
		// no iniciamos selección de celdas (dejamos que el usuario edite/seleccione texto).
		// Solo iniciamos selección cuando el click es sobre el TD o sobre un input numérico
		// de los que están en la lista CELL_SELECTOR.
		const isDirectlyOnInput = isEditableInput(target);
		if (isDirectlyOnInput && target.tagName === 'INPUT') {
			// Si el input es uno de los inputs numéricos seleccionables, sí iniciamos selección
			const isSelectableInput = target.matches('input.excel-cell-input-num, input.excel-cell-input-dias, input.excel-cell-input-pct');
			if (!isSelectableInput) {
				return;
			}
		}

		e.preventDefault();
		// Shift+click extiende desde el anchor existente; click normal empieza nueva selección
		if (e.shiftKey && anchorCell) {
			// Extender: marcar todas las celdas en el rectángulo anchor..cell
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
			clearSelection('nueva selección');
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
		// No limpiamos anchorCell aquí para permitir Shift+click que extienda la selección
		// anchorCell se limpia en clearSelection() o cuando se inicia una nueva selección
	}

	function onKeyDownSelection(e: KeyboardEvent) {
		if (e.key === 'Escape' && selectedCellSet.size > 0) {
			clearSelection('Escape');
		}
	}

	$: currentPlaca = placasUnicas[0] || null;

	/**
	 * Calcula el `valor_liquidar` NETO de un adicional (facturado − admon).
	 * Es la ÚNICA fuente de verdad para el valor a liquidar del adicional:
	 * - Si el adicional tiene `porcentaje_admin`, se resta del facturado.
	 * - Si no, el neto = facturado.
	 *
	 * Cualquier consumidor (TOTALES, base imponible, totalLiquidar del cierre,
	 * PDF) debe usar este helper o `currentAdicionales` (que ya está
	 * normalizado) para garantizar consistencia con la fila de la tabla.
	 */
	function adicionalVLiqNeto(adc: any): number {
		const vLiqGross = (Number(adc?.valor_unitario) || 0) * (Number(adc?.cantidad) || 0);
		const pctAdmin = Number(adc?.porcentaje_admin) || 0;
		const vAdmin = Math.round((vLiqGross * pctAdmin) / 100);
		return vLiqGross - vAdmin;
	}
	function adicionalVAdmin(adc: any): number {
		const vLiqGross = (Number(adc?.valor_unitario) || 0) * (Number(adc?.cantidad) || 0);
		const pctAdmin = Number(adc?.porcentaje_admin) || 0;
		return Math.round((vLiqGross * pctAdmin) / 100);
	}

	/**
	 * Adicionales normalizados: cada entrada trae su `valor_liquidar` ya
	 * recalculado como NETO (facturado − admon). Esto evita inconsistencias
	 * entre el V/LIQUIDAR total, la base imponible y el PDF cuando el
	 * `valor_liquidar` almacenado en la base de datos es el valor bruto
	 * (anterior a este fix).
	 */
	$: currentAdicionales = (adicionalesPorPlaca[0] || []).map((adc: any) => ({
		...adc,
		valor_liquidar: adicionalVLiqNeto(adc)
	}));
	$: periodDisplay =
		borradorResults.length > 0
			? `${MESES[borradorResults[0].liquidacion_servicio.mes - 1]} ${borradorResults[0].liquidacion_servicio.anio}`
			: '';
	$: consecutivosDisplay = borradorResults
		.map((r) => r.liquidacion_servicio.consecutivo)
		.filter(Boolean)
		.join(', ');
	$: facturasCierreDisplay =
		(cierre as any)?.facturas ||
		borradorResults
			.map((r) => r.liquidacion_servicio?.facturas)
			.filter(Boolean)
			.join(', ');

	$: placaItems = currentPlaca
		? todosTerceros.filter((t) => t.tercero.placa === currentPlaca.placa)
		: [];
	$: placaItemsIncluidos = currentPlaca
		? todosTercerosIncluidos.filter((t) => t.tercero.placa === currentPlaca.placa)
		: [];

	/**
	 * Array combinado de items reales + adicionales Cotransmeq en una forma
	 * uniforme, para poder sumarlos todos juntos en la fila de TOTALES.
	 * - Items: pasan tal cual con `_esAdicional: false`.
	 * - Adicionales: se mapean a la forma del item con `_esAdicional: true`.
	 *   - `valor_liquidar` = adc.valor_liquidar (es lo que suma)
	 *   - `total_facturado` = adc.valor_liquidar (cuenta como facturado)
	 *   - `valor_admin`, `ingreso_extra_global`, `ingresos_extra_aval` = 0
	 *   - `ingresoTransmeraldaDelta` = -vLiq (para que reste en ING. COTRANSMEQ)
	 */
	$: itemsConAdicionales = [
		...placaItemsIncluidos.map((item) => ({ ...item, _esAdicional: false })),
		...currentAdicionales.map((adc, adcIdx) => {
			const vLiqGross =
				(Number(adc.valor_unitario) || 0) * (Number(adc.cantidad) || 0);
			const vAdmin = adicionalVAdmin(adc);
			const vLiqNeto = vLiqGross - vAdmin;
			return {
				_esAdicional: true,
				_adcIdx: adcIdx,
				_adc: adc,
				tercero: {
					placa: adc.placa || currentPlaca?.placa,
					liquidacion_tercero: {
						valor_admin: vAdmin,
						total_facturado: vLiqGross,
						valor_liquidar: vLiqNeto,
						ingreso_extra_global: 0,
						ingresos_extra_aval: 0
					}
				}
			};
		})
	];

	$: sortedPlacaItems = placaItems
		.map((item, originalIdx) => ({ item, originalIdx }))
		.sort((a, b) => {
			if (!sortKey) return a.originalIdx - b.originalIdx;
			const va = getSortValue(a.item, sortKey);
			const vb = getSortValue(b.item, sortKey);
			let cmp = 0;
			if (typeof va === 'number' && typeof vb === 'number') {
				cmp = va - vb;
			} else {
				cmp = String(va).localeCompare(String(vb), 'es', { sensitivity: 'base' });
			}
			return sortDir === 'asc' ? cmp : -cmp;
		})
		.map((wrapped) => wrapped.item);

	$: conductorGrupos = currentPlaca ? getConductorGrupos(currentPlaca.conceptos || []) : [];
	// Gastos: ordenados por `orden` (canónico: DOTACION, EXAMEN_MEDICO, COMBUSTIBLE,
	// PAPELERIA, GASTOS_DIVERSOS; luego los no canónicos en su orden de inserción).
	$: gastos = currentPlaca
		? (currentPlaca.conceptos || [])
				.filter((c: any) => c.tipo === 'GASTO_OPERATIVO')
				.sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0))
		: [];
	// Impuestos y anticipos también se ordenan por `orden` para mantener
	// consistencia visual con su sección.
	$: impuestos = currentPlaca
		? (currentPlaca.conceptos || [])
				.filter((c: any) => c.tipo === 'IMPUESTO')
				.sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0))
		: [];
	$: anticipos = currentPlaca
		? (currentPlaca.conceptos || [])
				.filter((c: any) => c.tipo === 'ANTICIPO')
				.sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0))
		: [];

	$: totalValorLiquidar = placaItemsIncluidos.reduce(
		(s, item) => s + (item.tercero.liquidacion_tercero?.valor_liquidar || 0),
		0
	);
	$: totalAdicionales = currentAdicionales.reduce((s, a) => s + (Number(a.valor_liquidar) || 0), 0);
	$: totalDescuentos = currentPlaca ? currentPlaca.totalDesc || 0 : 0;
	$: totalServicio = totalValorLiquidar + totalAdicionales;
	$: totalPagar = totalServicio - totalDescuentos;

	// Sumatoria de valor_liquidar de los items marcados con `aplica_impuestos`
	// MÁS los adicionales con `aplica_impuestos !== false`.
	// Es la base que el backend usa para RETENCION_ICA, AVISOS_TABLEROS,
	// SOBRETASA_BOMBERIL. RETENCION_FUENTE usa TODOS los items + adicionales
	// gravados (ver `baseRetencionFuentePlaca` abajo).
	$: baseImpuestosPlaca =
		placaItemsIncluidos.reduce((s, item) => {
			const pivoteId = item.pivoteId;
			const aplica = aplicaImpuestosByPivote[pivoteId] !== false;
			if (!aplica) return s;
			return s + (item.tercero.liquidacion_tercero?.valor_liquidar || 0);
		}, 0) +
		currentAdicionales
			.filter((a) => a.aplica_impuestos !== false)
			.reduce((s, a) => s + (Number(a.valor_liquidar) || 0), 0);

	// Base para RETENCION_FUENTE: TODOS los items (sin filtrar por toggle)
	// + adicionales con `aplica_impuestos !== false`.
	$: baseRetencionFuentePlaca =
		placaItemsIncluidos.reduce(
			(s, item) => s + (item.tercero.liquidacion_tercero?.valor_liquidar || 0),
			0
		) +
		currentAdicionales
			.filter((a) => a.aplica_impuestos !== false)
			.reduce((s, a) => s + (Number(a.valor_liquidar) || 0), 0);

	function toggleSort(key: string) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = 'asc';
		}
	}

	function getSortValue(item: any, key: string): string | number {
		const lt = item.tercero.liquidacion_tercero || {};
		const porcentajeAdmin = lt.porcentaje_admin ?? 0;
		const ingresoExtraGlobal = lt.ingreso_extra_global ?? 0;
		const ingresosExtraAval = lt.ingresos_extra_aval ?? 0;
		const ingresoTransmeralda = ingresoExtraGlobal - ingresosExtraAval;
		switch (key) {
			case 'rowNum':
				return 0;
			case 'cliente':
				return item.liquidacion_servicio.cliente?.nombre || '';
			case 'consecutivo':
				return item.liquidacion_servicio.consecutivo || '';
			case 'placa':
				return item.tercero.placa || '';
			case 'nombre':
				return lt.tercero?.nombre_completo || '';
			case 'recorrido':
				return lt.recorrido || '';
			case 'fechas':
				return lt.fechas || '';
			case 'valorUnitario':
				return lt.valor_unitario || 0;
			case 'cantidad':
				return lt.cantidad || 0;
			case 'porcentajeAdmin':
				return porcentajeAdmin;
			case 'valorAdmin':
				return lt.valor_admin || 0;
			case 'totalFacturado':
				return lt.total_facturado || 0;
			case 'valorLiquidar':
				return lt.valor_liquidar || 0;
			case 'numeroPlanilla':
				return lt.item?.numero_planilla || '';
			case 'ingresoExtraGlobal':
				return ingresoExtraGlobal;
			case 'ingresosExtraAval':
				return ingresosExtraAval;
			case 'ingresoTransmeralda':
				return ingresoTransmeralda;
			case 'facturas':
				return (item as any).facturas || '';
			default:
				return '';
		}
	}

	function sortIcon(key: string): string {
		if (sortKey !== key) return '↕';
		return sortDir === 'asc' ? '↑ ASC' : '↓ DESC';
	}

	// Mapa reactivo de iconos: Svelte 4 no re-evalúa llamadas a funciones en el
	// template cuando cambia el estado interno, así que derivamos un objeto
	// explícitamente con `$:` para que el indicador de sort se actualice al
	// cambiar `sortKey` o `sortDir`.
	$: sortIcons = (() => {
		const keys = [
			'cliente',
			'consecutivo',
			'placa',
			'nombre',
			'recorrido',
			'fechas',
			'valorUnitario',
			'cantidad',
			'porcentajeAdmin',
			'valorAdmin',
			'totalFacturado',
			'valorLiquidar',
			'numeroPlanilla',
			'ingresoExtraGlobal',
			'ingresosExtraAval',
			'ingresoTransmeralda',
			'facturas'
		];
		const out: Record<string, string> = {};
		for (const k of keys) {
			out[k] = sortKey === k ? (sortDir === 'asc' ? '↑ ASC' : '↓ DESC') : '↕';
		}
		return out;
	})();

	function fmtPlaca(p: string): string {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s || '—';
	}

	function fmtCOP(v: number | string): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(parseFloat(String(v)) || 0);
	}

	function fmtCOPNegativo(v: number | string): string {
		return '- ' + fmtCOP(v);
	}

	function fmtCOPInput(v: number | string): string {
		const n = parseFloat(String(v)) || 0;
		if (n === 0) return '';
		return '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
	}

	function parseCOP(s: string): number {
		const cleaned = s
			.replace(/[^0-9,.\-]/g, '')
			.replace(/\./g, '')
			.replace(',', '.');
		return parseFloat(cleaned) || 0;
	}

	function getConductorGrupos(conceptos: ConceptoDescuento[]) {
		const SALARIOS = [
			'SALARIO',
			'AUXILIO_TRANSPORTE',
			'BONIFICACION',
			'OTROS_AUXILIOS',
			'RECARGOS'
		];
		const PRESTACIONES_CON_AUX = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA'];
		const PRESTACIONES_SIN_AUX = ['VACACIONES'];
		const SEGURIDAD = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];

		const conductorBases = new Map<string, { basePrest: number; baseSinAux: number }>();
		for (const c of conceptos) {
			if (c.tipo !== 'COSTO_LABORAL') continue;
			const key = c.conductor_id || 'sin-conductor';
			if (!conductorBases.has(key)) conductorBases.set(key, { basePrest: 0, baseSinAux: 0 });
			const bases = conductorBases.get(key)!;
			if (['SALARIO', 'AUXILIO_TRANSPORTE', 'RECARGOS'].includes(c.concepto))
				bases.basePrest += c.valor_total || 0;
			if (['SALARIO', 'RECARGOS'].includes(c.concepto)) bases.baseSinAux += c.valor_total || 0;
		}
		for (const c of conceptos) {
			if (c.tipo !== 'COSTO_LABORAL') continue;
			const key = c.conductor_id || 'sin-conductor';
			const bases = conductorBases.get(key);
			if (!bases) continue;
			if (PRESTACIONES_CON_AUX.includes(c.concepto)) {
				c.base_calculo = bases.basePrest;
				c.valor_total = bases.basePrest * ((c.porcentaje || 0) / 100);
			} else if (PRESTACIONES_SIN_AUX.includes(c.concepto) || SEGURIDAD.includes(c.concepto)) {
				c.base_calculo = bases.baseSinAux;
				c.valor_total = bases.baseSinAux * ((c.porcentaje || 0) / 100);
			}
		}

		const map = new Map<
			string | null,
			{
				nombre: string;
				conceptos: ConceptoDescuento[];
				salarios: ConceptoDescuento[];
				prestaciones: ConceptoDescuento[];
				seguridadSocial: ConceptoDescuento[];
				totalConductor: number;
			}
		>();
		for (const c of conceptos.filter((c) => c.tipo === 'COSTO_LABORAL')) {
			const key = c.conductor_id || 'sin-conductor';
			const nombre = c.conductor
				? `${c.conductor.nombre} ${c.conductor.apellido}`
				: 'General / Consolidado';
			if (!map.has(key))
				map.set(key, {
					nombre,
					conceptos: [],
					salarios: [],
					prestaciones: [],
					seguridadSocial: [],
					totalConductor: 0
				});
			const grupo = map.get(key)!;
			grupo.conceptos.push(c);
			grupo.totalConductor += c.valor_total || 0;
			if (SALARIOS.includes(c.concepto)) grupo.salarios.push(c);
			else if (
				PRESTACIONES_CON_AUX.includes(c.concepto) ||
				PRESTACIONES_SIN_AUX.includes(c.concepto)
			)
				grupo.prestaciones.push(c);
			else if (SEGURIDAD.includes(c.concepto)) grupo.seguridadSocial.push(c);
		}
		return Array.from(map.values());
	}

	function handleArrowNav(e: KeyboardEvent, currentRow: number, currentCol: number) {
		const inputs = document.querySelectorAll<HTMLInputElement>(
			'input.excel-cell-input[data-row][data-col]'
		);
		let targetRow = currentRow,
			targetCol = currentCol;
		if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
			e.preventDefault();
			targetRow = currentRow + 1;
		} else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
			e.preventDefault();
			targetRow = currentRow - 1;
		} else if (
			e.key === 'ArrowRight' &&
			(e.currentTarget as HTMLInputElement).selectionStart ===
				(e.currentTarget as HTMLInputElement).value.length
		) {
			e.preventDefault();
			targetCol = currentCol + 1;
		} else if (
			e.key === 'ArrowLeft' &&
			(e.currentTarget as HTMLInputElement).selectionStart === 0
		) {
			e.preventDefault();
			targetCol = currentCol - 1;
		} else return;
		const target = Array.from(inputs).find(
			(el) =>
				parseInt(el.dataset.row || '-1') === targetRow &&
				parseInt(el.dataset.col || '-1') === targetCol
		);
		if (target) {
			target.focus();
			target.select();
		}
	}

	function getConductorInputKey(conductorId: string | null): string {
		return `0::${conductorId || 'sin-conductor'}`;
	}

	function syncConductorFromNomina() {
		if (!currentPlaca) return;
		const next = { ...conductorFromNomina };
		let changed = false;
		for (const c of currentPlaca.conceptos || []) {
			if (c.tipo !== 'COSTO_LABORAL' || !c.conductor_id || !c.conductor) continue;
			const key = getConductorInputKey(c.conductor_id);
			if (!(key in next)) {
				next[key] = true;
				changed = true;
			}
		}
		if (changed) conductorFromNomina = next;
	}

	$: if (currentPlaca) syncConductorFromNomina();

	function recalcularPlacaTotals(placa: any) {
		if (!placa) return;
		const conceptos = placa.conceptos || [];
		placa.totalCostosLaborales = conceptos
			.filter((c: any) => c.tipo === 'COSTO_LABORAL')
			.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
		placa.totalGastosOperativos = conceptos
			.filter((c: any) => c.tipo === 'GASTO_OPERATIVO')
			.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
		placa.totalImpuestos = conceptos
			.filter((c: any) => c.tipo === 'IMPUESTO')
			.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
		placa.totalAnticipos = conceptos
			.filter((c: any) => c.tipo === 'ANTICIPO')
			.reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
		placa.totalDesc =
			placa.totalCostosLaborales + placa.totalGastosOperativos + placa.totalImpuestos + placa.totalAnticipos;
	}

	function triggerPlacasUpdate() {
		placasUnicas = [...placasUnicas];
	}

	function syncConceptosToSource(placaPlaca: string, conceptos: ConceptoDescuento[]) {
		for (const result of borradorResults) {
			for (const t of result.terceros) {
				if (t.placa === placaPlaca) {
					t.conceptos = conceptos;
					return;
				}
			}
		}
	}

	function recalcularBasesPrestacionesSS(conceptos: ConceptoDescuento[]) {
		const PRESTACIONES_CON_AUX = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA'];
		const PRESTACIONES_SIN_AUX = ['VACACIONES'];
		const SEGURIDAD = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];
		const bases = new Map<string, { basePrest: number; baseSinAux: number }>();
		for (const c of conceptos) {
			if (c.tipo !== 'COSTO_LABORAL') continue;
			const key = c.conductor_id || 'sin-conductor';
			if (!bases.has(key)) bases.set(key, { basePrest: 0, baseSinAux: 0 });
			const b = bases.get(key)!;
			if (['SALARIO', 'AUXILIO_TRANSPORTE', 'RECARGOS'].includes(c.concepto))
				b.basePrest += c.valor_total || 0;
			if (['SALARIO', 'RECARGOS'].includes(c.concepto)) b.baseSinAux += c.valor_total || 0;
		}
		for (const c of conceptos) {
			if (c.tipo !== 'COSTO_LABORAL') continue;
			const key = c.conductor_id || 'sin-conductor';
			const b = bases.get(key);
			if (!b) continue;
			if (PRESTACIONES_CON_AUX.includes(c.concepto)) {
				c.base_calculo = b.basePrest;
				c.valor_total = b.basePrest * ((c.porcentaje || 0) / 100);
			} else if (PRESTACIONES_SIN_AUX.includes(c.concepto) || SEGURIDAD.includes(c.concepto)) {
				c.base_calculo = b.baseSinAux;
				c.valor_total = b.baseSinAux * ((c.porcentaje || 0) / 100);
			}
		}
	}

	// ─── GASTOS OPERATIVOS AUTOMÁTICOS ─────────────────────

	/**
	 * Suma los días liquidados de SALARIO de los conductores.
	 * Si `soloNoPropietarios` es true (default), excluye a los conductores
	 * marcados como `es_propietario: true` (no se les descuenta DOTACION ni
	 * EXAMEN_MEDICO).
	 *
	 * IMPORTANTE: la key debe coincidir con la usada en `toggleConductorPropietario`
	 * (vía `getConductorInputKey`) para que el lookup de propietarios funcione.
	 */
	function sumDiasSalarioConductores(
		conceptos: ConceptoDescuento[],
		soloNoPropietarios: boolean = true
	): number {
		let total = 0;
		const seen = new Set<string>();
		for (const c of conceptos) {
			if (c.tipo !== 'COSTO_LABORAL' || c.concepto !== 'SALARIO') continue;
			const key = getConductorInputKey(c.conductor_id);
			if (seen.has(key)) continue;
			seen.add(key);
			if (soloNoPropietarios && conductorEsPropietario[key]) continue;
			total += Number(c.dias) || 0;
		}
		return total;
	}

	/**
	 * Suma el TOTAL (total_facturado) de los items de liquidación.
	 * NO incluye VALOR ADMON ni V/LIQUIDAR — solo el total facturado por servicio.
	 */
	function sumTotalItemsLiquidacionPara(itemsIncluidos: any[]): number {
		return itemsIncluidos.reduce(
			(s, item) => s + (item.tercero?.liquidacion_tercero?.total_facturado || 0),
			0
		);
	}

	/**
	 * Recalcula los valores de los conceptos automáticos en la placa indicada.
	 * - DOTACION: `dias` = Σ días de SALARIO de conductores NO propietarios,
	 *   `valor_unitario` = $3.985, `valor_total` = dias × valor_unitario.
	 * - EXAMEN_MEDICO: `dias` = Σ días de SALARIO de conductores NO propietarios,
	 *   `valor_unitario` = $2.882, `valor_total` = dias × valor_unitario.
	 *   (Los propietarios NO generan examen médico, igual que DOTACION.)
	 * - GASTOS_DIVERSOS: `dias` = 1, `valor_unitario` = 0.4% × Σ total facturado de items,
	 *   `valor_total` = TARIFA_FIJA_GASTOS_DIVERSOS ($20.000) + 0.4% × total facturado.
	 *
	 * Si un gasto tiene `calculado === false` (override manual del usuario), se
	 * respeta su valor y NO se sobreescribe. PAPELERIA nunca se toca.
	 */
	function recalcularGastosOperativosAutomaticosPara(
		placa: any,
		itemsIncluidos: any[],
		adicionales: any[] = []
	): boolean {
		if (!placa) return false;
		const conceptos = placa.conceptos;
		// DOTACION y EXAMEN_MEDICO: solo cuentan conductores NO propietarios.
		const totalDiasDotacion = sumDiasSalarioConductores(conceptos, true);
		const totalDiasExamen = sumDiasSalarioConductores(conceptos, true);
		// Base para GASTOS_DIVERSOS: total facturado de items + valor_liquidar
		// BRUTO de los adicionales Cotransmeq (cada adicional cuenta como
		// parte del servicio que se está prestando en la liquidación).
		const totalItemsFacturado = sumTotalItemsLiquidacionPara(itemsIncluidos);
		const totalAdicionales = (adicionales || []).reduce(
			(s: number, a: any) =>
				s +
				(Number(a.valor_unitario) || 0) * (Number(a.cantidad) || 0),
			0
		);
		const totalItems = totalItemsFacturado + totalAdicionales;

		const porcentajeUnitario = Math.round(totalItems * PORCENTAJE_GASTO_POR_ITEM);

		let changed = false;
		for (let i = 0; i < conceptos.length; i++) {
			const c = conceptos[i];
			if (c.tipo !== 'GASTO_OPERATIVO') continue;
			// Respetar override manual: si el usuario editó el valor, no tocarlo
			if (c.calculado === false) continue;
			if (c.concepto === 'DOTACION') {
				const newDias = totalDiasDotacion;
				const newUnit = VALOR_DOTACION;
				const newTotal = newDias * newUnit;
				if (
					Number(c.dias) !== newDias ||
					Number(c.valor_unitario) !== newUnit ||
					Number(c.valor_total) !== newTotal
				) {
					conceptos[i] = { ...c, dias: newDias, valor_unitario: newUnit, valor_total: newTotal, calculado: true };
					changed = true;
				}
			} else if (c.concepto === 'EXAMEN_MEDICO') {
				const newDias = totalDiasExamen;
				const newUnit = VALOR_EXAMEN_MEDICO;
				const newTotal = newDias * newUnit;
				if (
					Number(c.dias) !== newDias ||
					Number(c.valor_unitario) !== newUnit ||
					Number(c.valor_total) !== newTotal
				) {
					conceptos[i] = { ...c, dias: newDias, valor_unitario: newUnit, valor_total: newTotal, calculado: true };
					changed = true;
				}
			} else if (c.concepto === 'GASTOS_DIVERSOS') {
				const newDias = 1;
				// valor_unitario = tarifa fija de configuración + 0,4% del total facturado
				// (el popover muestra el desglose al hacer hover)
				const newUnit = TARIFA_FIJA_GASTOS_DIVERSOS + porcentajeUnitario;
				const newTotal = newUnit * newDias; // = unitario × cantidad
				if (
					Number(c.dias) !== newDias ||
					Number(c.valor_unitario) !== newUnit ||
					Number(c.valor_total) !== newTotal
				) {
					conceptos[i] = { ...c, dias: newDias, valor_unitario: newUnit, valor_total: newTotal, calculado: true };
					changed = true;
				}
			}
		}
		return changed;
	}

	/**
	 * Asegura que existan los 4 gastos operativos por defecto en el orden correcto.
	 * Crea los que falten, ordena los automáticos y recalcula sus valores.
	 * - DOTACION, EXAMEN_MEDICO y GASTOS_DIVERSOS inician como auto-calculados
	 *   (`calculado: true`); el usuario puede editarlos para hacer override manual.
	 * - PAPELERIA inicia como 100% manual (el usuario edita dias y valor unitario
	 *   libremente; el auto-cálculo nunca la toca).
	 */
	function ensureDefaultGastosOperativosPara(
		placa: any,
		itemsIncluidos: any[],
		adicionales: any[] = []
	): boolean {
		if (!placa) return false;
		const conceptos = [...(placa.conceptos || [])];
		const gastosExistentes = conceptos.filter((c: any) => c.tipo === 'GASTO_OPERATIVO');
		const conceptosPresentes = new Set(gastosExistentes.map((c: any) => c.concepto));
		let changed = false;

		for (const nombre of GASTOS_AUTOMATICOS_ORDEN) {
			if (conceptosPresentes.has(nombre)) continue;
			const esAuto = CONCEPTOS_CALCULADOS_AUTO.has(nombre);
			const usaCantidadFija = nombre === 'GASTOS_DIVERSOS';
			conceptos.push({
				tipo: 'GASTO_OPERATIVO',
				concepto: nombre,
				conductor_id: null,
				conductor: null,
				dias: usaCantidadFija ? 1 : 0,
				valor_unitario: 0,
				valor_total: 0,
				calculado: esAuto,
				orden: ORDEN_BASE_GASTO + (ORDEN_GASTOS_CANONICO[nombre] ?? 0) - 1
			} as any);
			changed = true;
		}

		for (const c of conceptos) {
			if (c.tipo !== 'GASTO_OPERATIVO') continue;
			const canon = ORDEN_GASTOS_CANONICO[c.concepto];
			if (canon !== undefined && c.orden !== ORDEN_BASE_GASTO + canon - 1) {
				c.orden = ORDEN_BASE_GASTO + canon - 1;
				changed = true;
			}
			// Para GASTOS_DIVERSOS mantener siempre dias=1
			if (c.concepto === 'GASTOS_DIVERSOS' && Number(c.dias) !== 1) {
				c.dias = 1;
				c.valor_total = c.dias * (c.valor_unitario || 0);
				changed = true;
			}
		}

		if (changed) {
			placa.conceptos = conceptos;
		}
		const recalculated = recalcularGastosOperativosAutomaticosPara(
			placa,
			itemsIncluidos,
			adicionales
		);
		return changed || recalculated;
	}

	/**
	 * Re-ordena los impuestos al orden canónico:
	 * ICA → AVISOS_TABLEROS → SOBRETASA_BOMBERIL → RETENCION_FUENTE
	 */
	function applyImpuestosOrdenCanonicoPara(placa: any): boolean {
		if (!placa) return false;
		const conceptos = placa.conceptos;
		let changed = false;
		let nextOrden = ORDEN_BASE_IMPUESTO;
		for (const c of conceptos) {
			if (c.tipo !== 'IMPUESTO') continue;
			const canon = ORDEN_IMPUESTOS[c.concepto];
			const newOrden = canon ? ORDEN_BASE_IMPUESTO + canon - 1 : nextOrden++;
			if (c.orden !== newOrden) {
				c.orden = newOrden;
				changed = true;
			}
		}
		return changed;
	}

	/**
	 * Re-ordena los gastos operativos al orden canónico:
	 * DOTACION → EXAMEN_MEDICO → COMBUSTIBLE → PAPELERIA → GASTOS_DIVERSOS.
	 * Los gastos no listados (ej. "Peajes", "Lavado") se renderizan después
	 * de los 5 canónicos, en el orden en que se agregaron (sin orden garantizado).
	 */
	function applyGastosOrdenCanonicoPara(placa: any): boolean {
		if (!placa) return false;
		const conceptos = placa.conceptos;
		let changed = false;
		// 1) Fijar posición exacta de los gastos canónicos
		for (const c of conceptos) {
			if (c.tipo !== 'GASTO_OPERATIVO') continue;
			const canon = ORDEN_GASTOS_CANONICO[c.concepto];
			if (canon === undefined) continue;
			const newOrden = ORDEN_BASE_GASTO + canon - 1;
			if (c.orden !== newOrden) {
				c.orden = newOrden;
				changed = true;
			}
		}
		// 2) Empujar gastos no canónicos a `orden >= ORDEN_BASE_GASTO_NO_CANONICO`
		//    (manteniendo el orden relativo entre ellos)
		let nextOrden = ORDEN_BASE_GASTO_NO_CANONICO;
		for (const c of conceptos) {
			if (c.tipo !== 'GASTO_OPERATIVO') continue;
			if (ORDEN_GASTOS_CANONICO[c.concepto] !== undefined) continue;
			if ((c.orden || 0) < nextOrden) {
				c.orden = nextOrden;
				changed = true;
			}
			nextOrden = Math.max(nextOrden, c.orden || 0) + 1;
		}
		return changed;
	}

	// Wrappers que operan sobre la placa actual (currentPlaca)
	function ensureDefaultGastosOperativos() {
		const changed = ensureDefaultGastosOperativosPara(
			currentPlaca,
			placaItemsIncluidos,
			currentAdicionales
		);
		if (changed) triggerPlacasUpdate();
	}

	function recalcularGastosOperativosAutomaticos() {
		const changed = recalcularGastosOperativosAutomaticosPara(
			currentPlaca,
			placaItemsIncluidos,
			currentAdicionales
		);
		if (changed) {
			triggerPlacasUpdate();
			// Persistir los gastos recalculados (DOTACION, EXAMEN_MEDICO,
			// GASTOS_DIVERSOS) al backend, junto con el recalculo de totales.
			realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
			enqueueTotalesCierre();
		}
	}

	function applyImpuestosOrdenCanonico() {
		if (applyImpuestosOrdenCanonicoPara(currentPlaca)) triggerPlacasUpdate();
	}

	function applyGastosOrdenCanonico() {
		if (applyGastosOrdenCanonicoPara(currentPlaca)) triggerPlacasUpdate();
	}

	function updateConceptoDias(conceptoIdx: number, newDias: number) {
		if (!currentPlaca) return;
		const c = currentPlaca.conceptos[conceptoIdx];
		if (!c) return;
		const eraSalario = c.tipo === 'COSTO_LABORAL' && c.concepto === 'SALARIO';
		const isGastoAuto =
			c.tipo === 'GASTO_OPERATIVO' && CONCEPTOS_CALCULADOS_AUTO.has(c.concepto);
		// Si el usuario edita un gasto auto-calculado, marcar como override manual
		// para que `recalcularGastosOperativosAutomaticosPara` no lo sobreescriba.
		const manualOverride = isGastoAuto && Number(c.dias) !== newDias;
		currentPlaca.conceptos[conceptoIdx] = {
			...c,
			dias: newDias,
			valor_total: newDias * (c.valor_unitario || 0),
			...(manualOverride ? { calculado: false } : {})
		};
		recalcularBasesPrestacionesSS(currentPlaca.conceptos);
		if (eraSalario) {
			// Cambian los días base de DOTACION y EXAMEN_MEDICO
			recalcularGastosOperativosAutomaticos();
		}
		recalcularPlacaTotals(currentPlaca);
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function updateConceptoValorUnitarioPlaca(conceptoIdx: number, newVU: number) {
		if (!currentPlaca) return;
		const c = currentPlaca.conceptos[conceptoIdx];
		if (!c) return;
		const dias = c.dias || 0;
		const isGastoAuto =
			c.tipo === 'GASTO_OPERATIVO' && CONCEPTOS_CALCULADOS_AUTO.has(c.concepto);
		// Si el usuario edita un gasto auto-calculado, marcar como override manual
		// para que `recalcularGastosOperativosAutomaticosPara` no lo sobreescriba.
		const manualOverride = isGastoAuto && Number(c.valor_unitario) !== newVU;
		currentPlaca.conceptos[conceptoIdx] = {
			...c,
			valor_unitario: newVU,
			valor_total: dias * newVU,
			...(manualOverride ? { calculado: false } : {})
		};
		recalcularBasesPrestacionesSS(currentPlaca.conceptos);
		recalcularPlacaTotals(currentPlaca);
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	/**
	 * Quita el override manual de un gasto auto-calculado y deja que el
	 * auto-cálculo tome el control otra vez. El usuario lo llama desde un
	 * botón "↺ AUTO" en la fila del gasto.
	 */
	function resetGastoToAuto(conceptoIdx: number) {
		if (!currentPlaca) return;
		const c = currentPlaca.conceptos[conceptoIdx];
		if (!c) return;
		currentPlaca.conceptos[conceptoIdx] = { ...c, calculado: true };
		recalcularGastosOperativosAutomaticos();
		recalcularPlacaTotals(currentPlaca);
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function updateConceptoPorcentaje(conceptoIdx: number, newPct: number) {
		if (!currentPlaca) return;
		const c = currentPlaca.conceptos[conceptoIdx];
		if (!c) return;
		currentPlaca.conceptos[conceptoIdx] = { ...c, porcentaje: newPct };
		if (c.base_calculo)
			currentPlaca.conceptos[conceptoIdx].valor_total = c.base_calculo * (newPct / 100);
		recalcularPlacaTotals(currentPlaca);
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function removeConceptoPlaca(conceptoIdx: number) {
		if (!currentPlaca) return;
		currentPlaca.conceptos.splice(conceptoIdx, 1);
		recalcularBasesPrestacionesSS(currentPlaca.conceptos);
		recalcularPlacaTotals(currentPlaca);
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function addConceptoPlaca(
		tipo: string,
		concepto: string,
		conductorId: string | null,
		conductorRef: any
	) {
		if (!currentPlaca) return;
		// Si es un gasto canónico, asignarle su posición fija. Si no, asignarle
		// un `orden` después del rango canónico (y después de los demás gastos
		// no canónicos ya existentes).
		let newOrden: number;
		const canon = ORDEN_GASTOS_CANONICO[concepto];
		if (tipo === 'GASTO_OPERATIVO' && canon !== undefined) {
			newOrden = ORDEN_BASE_GASTO + canon - 1;
		} else {
			const maxNoCanonico = currentPlaca.conceptos
				.filter(
					(c: any) =>
						c.tipo === 'GASTO_OPERATIVO' &&
						ORDEN_GASTOS_CANONICO[c.concepto] === undefined
				)
				.reduce((m: number, c: any) => Math.max(m, c.orden || 0), ORDEN_BASE_GASTO_NO_CANONICO - 1);
			newOrden = Math.max(maxNoCanonico + 1, ORDEN_BASE_GASTO_NO_CANONICO);
		}
		currentPlaca.conceptos.push({
			tipo,
			concepto,
			conductor_id: conductorId,
			conductor: conductorRef,
			dias: 0,
			valor_unitario: 0,
			valor_total: 0,
			calculado: false,
			orden: newOrden
		});
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function toggleExcludeItem(liqServicioId: string, ltOriginalId: string) {
		const key = `${liqServicioId}::${ltOriginalId}`;
		if (excludedItemKeys.has(key)) excludedItemKeys.delete(key);
		else excludedItemKeys.add(key);
		excludedItemKeys = new Set(excludedItemKeys);
	}

	async function toggleAplicaImpuestosItem(item: any) {
		const pivoteId = item.pivoteId;
		const current = aplicaImpuestosByPivote[pivoteId] !== false;
		const next = !current;
		const prev = { ...aplicaImpuestosByPivote };
		aplicaImpuestosByPivote = { ...aplicaImpuestosByPivote, [pivoteId]: next };
		try {
			await liquidacionesTercerosDescuentosAPI.toggleAplicaImpuestosItem(pivoteId, next);
			await calcularImpuestosPlaca();
		} catch (e) {
			aplicaImpuestosByPivote = prev;
			console.error('Error toggle aplica_impuestos:', e);
		}
	}

	function autocompletarNominaPlaca() {
		if (!currentPlaca) return;
		nominaLoading = true;
		const mes = borradorResults[0]?.liquidacion_servicio.mes;
		const anio = borradorResults[0]?.liquidacion_servicio.anio;
		if (!mes || !anio) {
			nominaLoading = false;
			return;
		}
		liquidacionesTercerosDescuentosAPI
			.autocompletarNomina({ placa: currentPlaca.placa, mes, anio })
			.then((nominaData) => {
				// Merge: conservamos los gastos operativos que ya tenía la placa
				// (DOTACION, EXAMEN_MEDICO, COMBUSTIBLE, PAPELERIA, GASTOS_DIVERSOS —
				// COMBUSTIBLE y PAPELERIA son editables, no auto) y los impuestos
				// ya calculados. La nómina solo trae COSTO_LABORAL.
				const nominaConceptos = nominaData.conceptos.map((c: any) => ({ ...c }));
				const nominaCostos = nominaConceptos.filter((c: any) => c.tipo === 'COSTO_LABORAL');
				const placaNoCostos = currentPlaca.conceptos.filter(
					(c: any) => c.tipo !== 'COSTO_LABORAL'
				);
				currentPlaca.conceptos = [...nominaCostos, ...placaNoCostos];
				// Asegurar que los 5 gastos automáticos existan y estén en orden
				// canónico, y recalcularlos con los nuevos días de salario de los
				// conductores. (COMBUSTIBLE y PAPELERIA no son auto, pero se
				// asegura de que existan como filas editables).
				ensureDefaultGastosOperativos();
				applyGastosOrdenCanonico();
				applyImpuestosOrdenCanonico();
				recalcularPlacaTotals(currentPlaca);
				syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
				triggerPlacasUpdate();
				realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
				enqueueTotalesCierre();
			})
			.catch((e) => console.error('Error autocompletar nómina:', e))
			.finally(() => {
				nominaLoading = false;
			});
	}

	function calcularImpuestosPlaca() {
		if (!currentPlaca) return;
		liquidacionesTercerosDescuentosAPI
			.calcularImpuestos(id || '')
			.then((conceptos) => {
				// Deduplicar IMPUESTO por `concepto` para evitar acumulaciones
				// si el backend (o el auto-cálculo al cargar) ya creó 4 filas.
				const impuestosUnicos: any[] = [];
				const seen = new Set<string>();
				for (const c of conceptos) {
					if (seen.has(c.concepto)) continue;
					seen.add(c.concepto);
					impuestosUnicos.push(c);
				}
				const existing = currentPlaca.conceptos.filter((c: any) => c.tipo !== 'IMPUESTO');
				currentPlaca.conceptos = [...existing, ...impuestosUnicos];
				// Forzar el orden canónico: ICA → AVISOS_TABLEROS → SOBRETASA_BOMBERIL → RETENCION_FUENTE
				applyImpuestosOrdenCanonico();
				recalcularPlacaTotals(currentPlaca);
				syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
				triggerPlacasUpdate();
				realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
				// Persistir los totales frescos (incluye el nuevo total_impuestos
				// y el total_pagar recalculado con el valor_liquidar actual).
				enqueueTotalesCierre();
			})
			.catch((e) => console.error('Error calcular impuestos:', e));
	}

	function cargarAnticiposPlaca() {
		if (!currentPlaca) return;
		const mes = borradorResults[0]?.liquidacion_servicio.mes;
		const anio = borradorResults[0]?.liquidacion_servicio.anio;
		if (!mes || !anio) return;
		liquidacionesTercerosDescuentosAPI
			.obtenerAnticiposVehiculo({ placa: currentPlaca.placa, mes, anio })
			.then((data) => {
				const existing = currentPlaca.conceptos.filter((c: any) => c.tipo !== 'ANTICIPO');
				const nuevos = data.anticipos.map((a: any, idx: number) => ({
					tipo: 'ANTICIPO',
					concepto: a.concepto || 'ANTICIPO',
					dias: 1,
					valor_unitario: a.valor,
					valor_total: a.valor,
					observaciones: a.fecha ? new Date(a.fecha).toISOString().slice(0, 10) : null,
					calculado: true,
					orden: 9000 + idx,
				}));
				currentPlaca.conceptos = [...existing, ...nuevos];
				recalcularPlacaTotals(currentPlaca);
				syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
				triggerPlacasUpdate();
				realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
			})
			.catch((e) => console.error('Error cargar anticipos:', e));
	}

	function addAnticipoRow() {
		if (!currentPlaca) return;
		const maxOrden = currentPlaca.conceptos.reduce(
			(m: number, c: any) => Math.max(m, c.orden || 0),
			0
		);
		currentPlaca.conceptos.push({
			tipo: 'ANTICIPO',
			concepto: '',
			dias: 1,
			valor_unitario: 0,
			valor_total: 0,
			observaciones: new Date().toISOString().slice(0, 10),
			calculado: false,
			orden: maxOrden + 1,
		});
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function updateAnticipoConcepto(conceptoIdx: number, nuevoConcepto: string) {
		if (!currentPlaca) return;
		const c = currentPlaca.conceptos[conceptoIdx];
		if (!c) return;
		currentPlaca.conceptos[conceptoIdx] = { ...c, concepto: nuevoConcepto };
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function updateGastoConcepto(conceptoIdx: number, nuevoConcepto: string) {
		if (!currentPlaca) return;
		const c = currentPlaca.conceptos[conceptoIdx];
		if (!c) return;
		const normalized = nuevoConcepto.trim().toUpperCase().replace(/\s+/g, '_');
		if (!normalized || normalized === c.concepto) return;
		currentPlaca.conceptos[conceptoIdx] = { ...c, concepto: normalized };
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function updateAnticipoValor(conceptoIdx: number, nuevoValor: number) {
		if (!currentPlaca) return;
		const c = currentPlaca.conceptos[conceptoIdx];
		if (!c) return;
		currentPlaca.conceptos[conceptoIdx] = {
			...c,
			valor_unitario: nuevoValor,
			valor_total: nuevoValor,
			dias: 1,
		};
		recalcularPlacaTotals(currentPlaca);
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function updateAnticipoFecha(conceptoIdx: number, nuevaFecha: string) {
		if (!currentPlaca) return;
		const c = currentPlaca.conceptos[conceptoIdx];
		if (!c) return;
		currentPlaca.conceptos[conceptoIdx] = { ...c, observaciones: nuevaFecha };
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function addAdicionalRow() {
		const adc: AdicionalTransmeralda = {
			cliente: '',
			placa: currentPlaca?.placa || '',
			tercero_nombre: currentPlaca?.nombre || '',
			recorrido: '',
			fechas: '',
			valor_unitario: 0,
			cantidad: 1,
			valor_liquidar: 0,
			porcentaje_admin: 0,
			aplica_impuestos: true
		};
		adicionalesPorPlaca = { ...adicionalesPorPlaca, 0: [...(adicionalesPorPlaca[0] || []), adc] };
		realtimeCollab.enqueueAdicionalesChanges(adicionalesPorPlaca[0] || []);
		syncCierreValorLiquidarFromAdicionales();
		// El nuevo adicional pasa a ser parte de la base de GASTOS_DIVERSOS
		recalcularGastosOperativosAutomaticos();
	}

	function deleteAdicional(idx: number) {
		const arr = [...(adicionalesPorPlaca[0] || [])];
		arr.splice(idx, 1);
		adicionalesPorPlaca = { ...adicionalesPorPlaca, 0: arr };
		realtimeCollab.enqueueAdicionalesChanges(adicionalesPorPlaca[0] || []);
		syncCierreValorLiquidarFromAdicionales();
		// El adicional eliminado sale de la base de GASTOS_DIVERSOS
		recalcularGastosOperativosAutomaticos();
	}

	function updateAdicionalField(idx: number, field: string, value: any) {
		const arr = [...(adicionalesPorPlaca[0] || [])];
		arr[idx] = { ...arr[idx], [field]: value };
		if (field === 'valor_unitario' || field === 'cantidad' || field === 'porcentaje_admin') {
			// valor_liquidar = (valor_unitario × cantidad) − admon
			// El admon se descuenta del total facturado para obtener lo que
			// efectivamente se liquida al tercero.
			const vLiqGross =
				(Number(arr[idx].valor_unitario) || 0) * (Number(arr[idx].cantidad) || 0);
			const pctAdmin = Number(arr[idx].porcentaje_admin) || 0;
			const vAdmin = Math.round((vLiqGross * pctAdmin) / 100);
			arr[idx].valor_liquidar = vLiqGross - vAdmin;
		}
		adicionalesPorPlaca = { ...adicionalesPorPlaca, 0: arr };
		realtimeCollab.enqueueAdicionalesChanges(adicionalesPorPlaca[0] || []);
		syncCierreValorLiquidarFromAdicionales();
		// Si cambió el valor o la cantidad, el adicional pasa a sumar diferente
		// a la base de GASTOS_DIVERSOS (0,4% × total facturado de items + adicionales)
		if (field === 'valor_unitario' || field === 'cantidad') {
			recalcularGastosOperativosAutomaticos();
		}
		// Si cambió el flag de impuestos, el valor, la cantidad o el % de
		// administración, recalcular impuestos en backend (afecta la base de
		// RETENCION_ICA, AVISOS_TABLEROS, SOBRETASA_BOMBERIL y
		// RETENCION_FUENTE). Sin esto, `c.base_calculo` de cada IMPUESTO
		// quedaría desincronizado con la `baseImpuestosPlaca` del cliente.
		if (
			field === 'aplica_impuestos' ||
			field === 'valor_unitario' ||
			field === 'cantidad' ||
			field === 'porcentaje_admin'
		) {
			// IMPORTANTE: hay que esperar a que el save del realtime collab
			// (delay 800ms) se complete antes de pedir el recálculo, porque
			// el backend lee los adicionales de la DB. Si llamamos
			// inmediatamente, leería el estado VIEJO y mostraría el adicional
			// como excluido cuando debería estar incluido (o viceversa).
			setTimeout(() => calcularImpuestosPlaca(), 1000);
		}
	}

	/**
	 * Recalcula el `valor_liquidar` del cierre (items + adicionales) y lo encola
	 * como cambio del cierre vía socket. Esto asegura que el historial de
	 * liquidaciones muestre el valor total real (incluyendo los adicionales
	 * Cotransmeq) para TODOS los usuarios, no solo en este navegador.
	 *
	 * El backend persiste los seis campos en la tabla `liquidacion_tercero_final`
	 * y emite `row:updated:global`, que la página de historial escucha para
	 * refrescar la fila afectada en tiempo real.
	 */
	function syncCierreValorLiquidarFromAdicionalesPara(
		placaActual: any,
		itemsIncluidos: any[],
		adicionalesArr: any[],
		totalDescuentosCierre: number,
		cierreRef: any
	) {
		// Normalizar al NETO (facturado − admon) con el mismo helper que la UI
		// para que coincida con el V/LIQUIDAR total y la base imponible,
		// incluso si `valor_liquidar` quedó en la DB con el valor bruto
		// anterior a este fix.
		const adicionalesSum = adicionalesArr.reduce(
			(s, a) => s + adicionalVLiqNeto(a),
			0
		);
		const itemsSum = itemsIncluidos.reduce(
			(s, i) => s + (i.tercero?.liquidacion_tercero?.valor_liquidar || 0),
			0
		);
		const newValorLiquidar = itemsSum + adicionalesSum;
		if (cierreRef) {
			cierreRef.valor_liquidar = newValorLiquidar;
		}

		enqueueTotalesCierre();
		return newValorLiquidar;
	}

	/**
	 * Encola vía realtime collab la actualización de los seis campos de totales
	 * del cierre (`valor_liquidar`, `total_costos_laborales`, `total_gastos_operativos`,
	 * `total_impuestos`, `total_descuentos`, `total_pagar`). El socket gateway
	 * los persiste y emite `row:updated:global` para refrescar la página de
	 * historial en todos los clientes conectados.
	 */
	function enqueueTotalesCierre() {
		if (!cierre) return;
		const placa = currentPlaca;
		if (!placa) return;

		// Usar `currentAdicionales` (normalizado a NETO) para que el cierre
		// siempre refleje el mismo cálculo que muestra la tabla.
		const adicionalesArr = currentAdicionales;
		const itemsSum = placaItemsIncluidos.reduce(
			(s, i) => s + (i.tercero?.liquidacion_tercero?.valor_liquidar || 0),
			0
		);
		const adicionalesSum = adicionalesArr.reduce(
			(s, a) => s + (Number(a.valor_liquidar) || 0),
			0
		);
		const valor_liquidar = itemsSum + adicionalesSum;

		const conceptos = placa.conceptos || [];
		const toNum = (v: any) => Number(v) || 0;
		const total_costos_laborales = conceptos
			.filter((c: any) => c.tipo === 'COSTO_LABORAL')
			.reduce((s: number, c: any) => s + toNum(c.valor_total), 0);
		const total_gastos_operativos = conceptos
			.filter((c: any) => c.tipo === 'GASTO_OPERATIVO')
			.reduce((s: number, c: any) => s + toNum(c.valor_total), 0);
		const total_impuestos = conceptos
			.filter((c: any) => c.tipo === 'IMPUESTO')
			.reduce((s: number, c: any) => s + toNum(c.valor_total), 0);
		const total_anticipos = conceptos
			.filter((c: any) => c.tipo === 'ANTICIPO')
			.reduce((s: number, c: any) => s + toNum(c.valor_total), 0);
		const total_descuentos =
			total_costos_laborales + total_gastos_operativos + total_impuestos + total_anticipos;
		const total_pagar = valor_liquidar - total_descuentos;

		realtimeCollab.enqueueCierreChanges({
			valor_liquidar,
			total_costos_laborales,
			total_gastos_operativos,
			total_impuestos,
			total_descuentos,
			total_pagar
		});
	}

	function syncCierreValorLiquidarFromAdicionales() {
		if (!currentPlaca) return;
		syncCierreValorLiquidarFromAdicionalesPara(
			currentPlaca,
			placaItemsIncluidos,
			adicionalesPorPlaca[0] || [],
			cierre?.total_descuentos || 0,
			cierre
		);
	}

	function addConductor() {
		conductorModalPlacaIdx = 0;
		conductorModalOpen = true;
	}

	async function onConductorSelected(conductor: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string;
	}) {
		if (conductorModalPlacaIdx === null || !currentPlaca) return;
		const conductorRef = {
			id: conductor.id,
			nombre: conductor.nombre,
			apellido: conductor.apellido,
			numero_identificacion: conductor.numero_identificacion
		};
		const conceptosBase: ConceptoDescuento[] = [
			{
				tipo: 'COSTO_LABORAL',
				concepto: 'SALARIO',
				conductor_id: conductor.id,
				conductor: conductorRef,
				dias: 30,
				valor_unitario: 0,
				valor_total: 0,
				calculado: false,
				orden: 0
			},
			{
				tipo: 'COSTO_LABORAL',
				concepto: 'AUXILIO_TRANSPORTE',
				conductor_id: conductor.id,
				conductor: conductorRef,
				dias: 30,
				valor_unitario: 0,
				valor_total: 0,
				calculado: false,
				orden: 1
			},
			{
				tipo: 'COSTO_LABORAL',
				concepto: 'BONIFICACION',
				conductor_id: conductor.id,
				conductor: conductorRef,
				dias: 0,
				valor_unitario: 0,
				valor_total: 0,
				calculado: false,
				orden: 2
			},
			{
				tipo: 'COSTO_LABORAL',
				concepto: 'RECARGOS',
				conductor_id: conductor.id,
				conductor: conductorRef,
				dias: 0,
				valor_unitario: 0,
				valor_total: 0,
				calculado: false,
				orden: 3
			}
		];
		currentPlaca.conceptos = [...currentPlaca.conceptos, ...conceptosBase];
		const key = `0::${conductor.id}`;
		conductorNameInputs = {
			...conductorNameInputs,
			[key]: `${conductor.nombre} ${conductor.apellido}`.trim()
		};
		conductorFromNomina = { ...conductorFromNomina, [key]: false };
		// No seteamos override: el estado efectivo se calculará reactivamente
		// desde auto-detección. Si el conductor nuevo es el propietario del
		// vehículo, se auto-detectará.
		await tick();
		// Nuevo conductor: cambian los días base de DOTACION, EXAMEN_MEDICO
		// y GASTOS_DIVERSOS (PAPELERIA es 100% manual)
		recalcularGastosOperativosAutomaticos();
		recalcularPlacaTotals(currentPlaca);
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		conductorModalOpen = false;
		conductorModalPlacaIdx = null;
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	async function removeConductor(conductorId: string | null, conductorNombre: string) {
		if (!currentPlaca) return;
		const targetKey = conductorId ?? 'sin-conductor';
		const inputKey = getConductorInputKey(conductorId);
		currentPlaca.conceptos = currentPlaca.conceptos.filter(
			(c: any) => (c.conductor_id || 'sin-conductor') !== targetKey
		);
		const nextInputs: Record<string, string> = {};
		const nextFromNomina: Record<string, boolean> = {};
		const nextOverride: Record<string, boolean> = {};
		for (const k of Object.keys(conductorNameInputs)) {
			if (!k.startsWith('0::')) nextInputs[k] = conductorNameInputs[k];
		}
		for (const k of Object.keys(conductorFromNomina)) {
			if (!k.startsWith('0::')) nextFromNomina[k] = conductorFromNomina[k];
		}
		for (const k of Object.keys(conductorEsPropietarioOverride)) {
			if (!k.startsWith('0::')) nextOverride[k] = conductorEsPropietarioOverride[k];
		}
		conductorNameInputs = nextInputs;
		conductorFromNomina = nextFromNomina;
		conductorEsPropietarioOverride = nextOverride;
		await tick();
		// Conductor eliminado: recalcular DOTACION, EXAMEN_MEDICO y
		// GASTOS_DIVERSOS (PAPELERIA es 100% manual)
		recalcularGastosOperativosAutomaticos();
		recalcularPlacaTotals(currentPlaca);
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	function renameConductor(conductorId: string | null, newName: string) {
		if (!currentPlaca || !newName.trim()) return;
		for (const c of currentPlaca.conceptos) {
			if ((c.conductor_id || null) === conductorId) {
				const parts = newName.trim().split(' ');
				c.conductor = {
					id: c.conductor_id || '',
					nombre: parts[0],
					apellido: parts.slice(1).join(' ') || '',
					numero_identificacion: ''
				};
			}
		}
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	async function toggleConductorPropietario(conductorId: string | null) {
		const key = getConductorInputKey(conductorId);
		// Si el estado efectivo actual es true, el toggle pone false (y viceversa).
		// El nuevo valor SIEMPRE va al override (es un cambio explícito del usuario).
		const currentEffective = !!conductorEsPropietario[key];
		conductorEsPropietarioOverride = {
			...conductorEsPropietarioOverride,
			[key]: !currentEffective
		};
		// Persistir en backend via realtime collab
		realtimeCollab.enqueuePropietarioOverridesChanges(conductorEsPropietarioOverride);
		// CRÍTICO: esperar a que el reactivo `$: conductorEsPropietario` se ejecute.
		// Sin esto, `sumDiasSalarioConductores` leería el valor VIEJO de
		// `conductorEsPropietario` (aún no re-calculado) y la DOTACION quedaría
		// invertida respecto al toggle.
		await tick();
		// Recalcular DOTACION y EXAMEN_MEDICO: ambos excluyen propietarios.
		recalcularGastosOperativosAutomaticos();
		recalcularPlacaTotals(currentPlaca);
		syncConceptosToSource(currentPlaca.placa, currentPlaca.conceptos);
		triggerPlacasUpdate();
		realtimeCollab.enqueueConceptosChanges(currentPlaca.conceptos);
	}

	/**
	 * Normaliza un string para comparación fuzzy de nombres:
	 * lowercase, sin tildes, sin espacios extra, sin caracteres especiales.
	 */
	function normalizeName(s: string): string {
		return (s || '')
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '') // quitar tildes
			.replace(/[^a-z0-9\s]/g, ' ') // quitar símbolos
			.replace(/\s+/g, ' ')
			.trim();
	}

	/**
	 * Compara dos identificaciones permitiendo formatos equivalentes:
	 * con/sin puntos, comas, espacios, ceros a la izquierda.
	 */
	function idsMatch(a: any, b: any): boolean {
		if (!a || !b) return false;
		const cleanA = String(a).replace(/[\D]/g, '');
		const cleanB = String(b).replace(/[\D]/g, '');
		if (!cleanA || !cleanB) return false;
		// Comparar últimos 6+ dígitos (las cédulas colombianas son 6-10 dígitos)
		const tail = (s: string) => s.slice(-8);
		return tail(cleanA) === tail(cleanB);
	}

	/**
	 * Estado efectivo de propietario: override manual > auto-detección.
	 * Se recomputa cada vez que cambian los overrides o el cierre.
	 */
	$: conductorEsPropietario = (() => {
		const out: Record<string, boolean> = {};
		const origen: Record<string, 'auto' | 'manual'> = {};
		const seen = new Set<string>();

		// ── DEBUG: log del tercero, vehículo y conductores ──
		const veh = (cierre as any)?.vehiculo;
		const tercero = (cierre as any)?.tercero;
		const conductores = (currentPlaca?.conceptos || [])
			.filter((c: any) => c.tipo === 'COSTO_LABORAL' && c.conductor)
			.reduce((acc: any[], c: any) => {
				if (acc.find((a) => a.conductor_id === c.conductor_id)) return acc;
				acc.push({
					conductor_id: c.conductor_id,
					nombre: `${c.conductor.nombre || ''} ${c.conductor.apellido || ''}`.trim(),
					numero_identificacion: c.conductor.numero_identificacion
				});
				return acc;
			}, []);

		for (const c of currentPlaca?.conceptos || []) {
			if (c.tipo !== 'COSTO_LABORAL' || !c.conductor) continue;
			const key = getConductorInputKey(c.conductor_id);
			if (seen.has(key)) continue;
			seen.add(key);

			const condId = c.conductor.numero_identificacion;
			const condNombre = `${c.conductor.nombre || ''} ${c.conductor.apellido || ''}`.trim();
			const propId = veh?.propietario_identificacion;
			const propNombre = veh?.propietario_nombre;
			// Fallback: el TERCERO del cierre suele ser el dueño del vehículo
			const tercId = tercero?.identificacion;
			const tercNombre = tercero?.nombre_completo;

			let matchResult: { matched: boolean; by: 'id-vehiculo' | 'nombre-vehiculo' | 'id-tercero' | 'nombre-tercero' | 'override' | 'none'; detalle: string } = {
				matched: false,
				by: 'none',
				detalle: ''
			};

			if (key in conductorEsPropietarioOverride) {
				const v = conductorEsPropietarioOverride[key];
				out[key] = v;
				origen[key] = 'manual';
				matchResult = {
					matched: v === true,
					by: 'override',
					detalle: `override manual = ${v}`
				};
			} else {
				// 1) Intentar contra vehiculo.propietario_*
				if (propId && condId && idsMatch(propId, condId)) {
					out[key] = true;
					origen[key] = 'auto';
					matchResult = {
						matched: true,
						by: 'id-vehiculo',
						detalle: `Vehiculo CC match: "${propId}" === "${condId}"`
					};
				} else if (propNombre && condNombre && normalizeName(propNombre) === normalizeName(condNombre)) {
					out[key] = true;
					origen[key] = 'auto';
					matchResult = {
						matched: true,
						by: 'nombre-vehiculo',
						detalle: `Vehiculo Nombre match: "${propNombre}" === "${condNombre}"`
					};
				} else if (tercId && condId && idsMatch(tercId, condId)) {
					// 2) Fallback: TERCERO del cierre
					out[key] = true;
					origen[key] = 'auto';
					matchResult = {
						matched: true,
						by: 'id-tercero',
						detalle: `Tercero CC match: "${tercId}" === "${condId}"`
					};
				} else if (
					tercNombre &&
					condNombre &&
					normalizeName(tercNombre) === normalizeName(condNombre)
				) {
					out[key] = true;
					origen[key] = 'auto';
					matchResult = {
						matched: true,
						by: 'nombre-tercero',
						detalle: `Tercero Nombre match: "${tercNombre}" === "${condNombre}"`
					};
				} else {
					out[key] = false;
					origen[key] = 'manual';
					const triedIdVeh = propId && condId ? `Vehiculo CC "${propId}" vs "${condId}"` : '(veh sin CC)';
					const triedNomVeh = propNombre && condNombre
						? `Vehiculo Nombre "${propNombre}" vs "${condNombre}"`
						: '(veh sin nombre)';
					const triedIdTerc = tercId && condId ? `Tercero CC "${tercId}" vs "${condId}"` : '(terc sin CC)';
					const triedNomTerc = tercNombre && condNombre
						? `Tercero Nombre "${tercNombre}" vs "${condNombre}"`
						: '(terc sin nombre)';
					matchResult = {
						matched: false,
						by: 'none',
						detalle: `Sin match. Probó: ${triedIdVeh}; ${triedNomVeh}; ${triedIdTerc}; ${triedNomTerc}`
					};
				}
			}

			const icon = matchResult.matched ? '✅' : '❌';
		}

		conductorPropietarioOrigen = origen;
		return out;
	})();

	function onConductorNameInput(key: string, value: string) {
		conductorNameInputs = { ...conductorNameInputs, [key]: value };
	}

	// ─── LOAD DATA ───────────────────────────────────────────────
	onMount(async () => {
		if (!id) {
			loadError = 'ID requerido';
			loading = false;
			return;
		}

		// Init viewport + zoom listeners
		updateViewport();
		window.addEventListener('resize', updateViewport);
		window.addEventListener('wheel', handleWheel, { passive: false });
		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => updateViewport());
			resizeObserver.observe(document.body);
		}

		// Listeners de selección múltiple de celdas (Ctrl/Cmd + drag)
		const gridBody = document.querySelector('.excel-grid-body');
		if (gridBody) {
			gridBody.addEventListener('mousedown', onGridMouseDown as EventListener);
			gridBody.addEventListener('click', onGridClick as EventListener);
		}
		window.addEventListener('mousemove', onGridMouseMove);
		window.addEventListener('mouseup', onGridMouseUp);
		window.addEventListener('keydown', onKeyDownSelection);

		connectSocket();

		try {
			cierre = await liquidacionesTercerosDescuentosAPI.obtenerPorId(id);
			const estado = cierre.estado || 'BORRADOR';
			if (estado !== 'BORRADOR') {
				alert(`Esta liquidación está en estado ${estado}. Solo se pueden editar borradores.`);
				goto(`/dashboard/liquidaciones-terceros/${id}?mode=view`);
				return;
			}

			// Build borradorResults shape from cierre data
			const liqServicio = cierre.liquidacion_servicio;
			borradorResults = [
				{
					liquidacion_servicio: liqServicio,
					terceros: [
						{
							placa: cierre.placa,
							liquidacion_tercero: cierre,
							conceptos: (cierre.conceptos || []).map((c: any) => ({ ...c })),
							resumen_nomina: {},
							conductores: [],
							items_adicionales: cierre.adicionales || []
						}
					]
				}
			];

			// Build todosTerceros from cierre items. Cada item del pivote puede
			// pertenecer a una liquidación de servicio DISTINTA (varios clientes
			// en el mismo mes/placa), por eso leemos su `liquidacion` propia.
			const items = cierre.items || [];
			const nextAplicaImpuestos: Record<string, boolean> = {};
			todosTerceros = items.map((item: any) => {
				const lt = item.liquidacion_tercero || {};
				const ownLiq = lt.liquidacion;
				// Si el item trae su propia liquidación, la usamos; si no,
				// caemos al `liqServicio` principal del cierre.
				const liqForRow = ownLiq
					? {
							id: ownLiq.id,
							consecutivo: ownLiq.consecutivo,
							mes: ownLiq.mes,
							anio: ownLiq.anio,
							cliente: ownLiq.cliente,
							facturas: (ownLiq.factura_items || [])
								.map((fi: any) => fi.factura?.numero_factura)
								.filter(Boolean)
								.join(', ')
						}
					: liqServicio;
				nextAplicaImpuestos[item.id] = item.aplica_impuestos !== false;
				return {
					pivoteId: item.id,
					liquidacion_servicio: liqForRow,
					facturas: item.facturas || liqForRow.facturas || '',
					tercero: {
						placa: cierre.placa,
						liquidacion_tercero: lt
					}
				};
			});
			todosTercerosIncluidos = [...todosTerceros];
			aplicaImpuestosByPivote = nextAplicaImpuestos;

			// Build placasUnicas — recalcular totales desde los conceptos
			// reales en vez de confiar en las columnas almacenadas (que pueden
			// estar desactualizadas).
			const conceptosIniciales = (cierre.conceptos || []).map((c: any) => ({ ...c }));
			const calcTotal = (tipo: string) => conceptosIniciales.filter((c: any) => c.tipo === tipo).reduce((s: number, c: any) => s + (c.valor_total || 0), 0);
			const totalCostosInit = calcTotal('COSTO_LABORAL');
			const totalGastosInit = calcTotal('GASTO_OPERATIVO');
			const totalImpuestosInit = calcTotal('IMPUESTO');
			const totalAnticiposInit = calcTotal('ANTICIPO');

			placasUnicas = [
				{
					placa: cierre.placa,
					nombre: cierre.tercero?.nombre_completo || '',
					conceptos: conceptosIniciales,
					totalCostosLaborales: totalCostosInit,
					totalGastosOperativos: totalGastosInit,
					totalImpuestos: totalImpuestosInit,
					totalAnticipos: totalAnticiposInit,
					totalDesc: totalCostosInit + totalGastosInit + totalImpuestosInit + totalAnticiposInit
				}
			];

			// CRÍTICO: cargar `conductorEsPropietarioOverride` ANTES de la primera
			// recalculación de gastos operativos. Si lo dejamos para después, el
			// primer `recalcularGastosOperativosAutomaticosPara` se ejecuta con
			// `conductorEsPropietario` aún vacío (los propietarios no se
			// excluyen) y DOTACION/EXAMEN_MEDICO quedan con valores incorrectos
			// que se sobreescriben a los almacenados en DB.
			conductorEsPropietarioOverride =
				(cierre.es_propietario_overrides as Record<string, boolean>) || {};
			// Forzar la actualización reactiva de `conductorEsPropietario` (que
			// combina override + auto-detección) antes de leerlo.
			await tick();

			// Inicializar los 5 gastos operativos por defecto (DOTACION, EXAMEN_MEDICO,
			// COMBUSTIBLE, PAPELERIA, GASTOS_DIVERSOS) en orden canónico, y
			// recalcular sus valores automáticos según los conductores (excluyendo
			// propietarios) y los items actuales.
			//
			// IMPORTANTE: `adicionalesPorPlaca` se inicializa ANTES del ensure/recalc
			// para que GASTOS_DIVERSOS (0,4% × Σ total facturado) considere también
			// el valor_liquidar de los adicionales Cotransmeq en su base.
			adicionalesPorPlaca = {
				0: (cierre.adicionales || []).map((a: any) => ({
					...a,
					aplica_impuestos: a.aplica_impuestos !== false
				}))
			};

			{
				const placaInicial = placasUnicas[0];
				const itemsIniciales = todosTercerosIncluidos.filter(
					(t) => t.tercero.placa === placaInicial.placa
				);
				ensureDefaultGastosOperativosPara(
					placaInicial,
					itemsIniciales,
					adicionalesPorPlaca[0] || []
				);
				applyGastosOrdenCanonicoPara(placaInicial);
				applyImpuestosOrdenCanonicoPara(placaInicial);
				recalcularPlacaTotals(placaInicial);
				placasUnicas = [...placasUnicas];
			}

			// El estado efectivo (`conductorEsPropietario`) ya está computado y
			// los gastos ya se recalcularon correctamente arriba. Forzamos un
			// re-render para asegurar que el `Object.keys(...).some(...)` refleje
			// el estado actual.
			if (Object.keys(conductorEsPropietario).some((k) => conductorEsPropietario[k])) {
				recalcularGastosOperativosAutomaticosPara(
					placasUnicas[0],
					placaItemsIncluidos,
					adicionalesPorPlaca[0] || []
				);
				recalcularPlacaTotals(placasUnicas[0]);
				placasUnicas = [...placasUnicas];
			}

			// Sincronizar el parche de localStorage con el valor_liquidar real
			// (items + adicionales). Se hace al cargar para que la página del
			// historial muestre el valor correcto aunque el usuario aún no
			// haya editado un adicional en esta sesión.
			{
				const placaInicial = placasUnicas[0];
				const itemsIniciales = todosTercerosIncluidos.filter(
					(t) => t.tercero.placa === placaInicial.placa
				);
				syncCierreValorLiquidarFromAdicionalesPara(
					placaInicial,
					itemsIniciales,
					cierre.adicionales || [],
					cierre.total_descuentos || 0,
					cierre
				);
			}

			// Si el cierre aún no tiene conceptos IMPUESTO predefinidos, los
			// calculamos desde la configuración de impuestos + base imponible.
			// El backend persiste los conceptos automáticamente; recargamos el
			// cierre para que la UI muestre la sección IMPUESTOS Y RETENCIONES
			// poblada apenas se carga la página, sin necesidad de tocar el toggle.
			const tieneImpuestos = (cierre.conceptos || []).some(
				(c: any) => c.tipo === 'IMPUESTO'
			);
			if (!tieneImpuestos) {
				try {
					await liquidacionesTercerosDescuentosAPI.calcularImpuestos(id || '');
					// Recargar el cierre para incluir los conceptos IMPUESTO recién persistidos
					cierre = await liquidacionesTercerosDescuentosAPI.obtenerPorId(id || '');
					// Reflejar los nuevos impuestos en la placa en memoria y aplicar
					// el orden canónico (RETENCION_ICA, AVISOS_TABLEROS, ...)
					const conceptosActualizados = (cierre.conceptos || []).map((c: any) => ({
						...c
					}));
					placasUnicas[0].conceptos = conceptosActualizados;
					applyImpuestosOrdenCanonicoPara(placasUnicas[0]);
					recalcularPlacaTotals(placasUnicas[0]);
					placasUnicas = [...placasUnicas];
				} catch (e) {
					console.error('Error auto-calculando impuestos al cargar:', e);
				}
			} else {
				// Ya tiene impuestos guardados: solo aseguramos el orden canónico
				applyImpuestosOrdenCanonicoPara(placasUnicas[0]);
				placasUnicas = [...placasUnicas];
			}

			// Init realtime collab
			const user = $authStore.user;
			if (user) {
				const userName = user.nombre || user.correo || 'Usuario';
				realtimeCollab.initCollab({ id: user.id, name: userName });
				realtimeCollab.joinRoom('liquidacion-tercero-final', id, { id: user.id, name: userName });
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
			gridBody.removeEventListener('click', onGridClick as EventListener);
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', updateViewport);
			window.removeEventListener('wheel', handleWheel);
			window.removeEventListener('mousemove', onGridMouseMove);
			window.removeEventListener('mouseup', onGridMouseUp);
			window.removeEventListener('keydown', onKeyDownSelection);
		}
		if (resizeObserver) resizeObserver.disconnect();
		clearSelection();
	});
</script>

<svelte:head>
	<title>Editar Liquidación · Cotransmeq</title>
</svelte:head>

{#if loading}
	<div class="loading-state">
		<div class="spinner"></div>
		<span>Cargando liquidación...</span>
	</div>
{:else if loadError}
	<div class="error-state">
		<p>❌ {loadError}</p>
		<button class="btn-back" on:click={() => goto('/dashboard/liquidaciones-terceros')}
			>Volver</button
		>
	</div>
{:else if currentPlaca}
	<div class="page-wrap">
		<!-- TOOLBAR -->
		<div class="excel-toolbar">
			<div class="excel-toolbar-left">
				<button
					class="toolbar-btn toolbar-btn-back"
					on:click={() => goto('/dashboard/liquidaciones-terceros')}
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
					<span class="toolbar-title">Editando Liquidación de Tercero</span>
					<span class="toolbar-subtitle">
						{fmtPlaca(currentPlaca.placa)} · {currentPlaca.nombre} · {consecutivosDisplay} · {periodDisplay}
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
						aria-label="Reducir zoom"
					>
						−
					</button>
					<span class="zoom-label">{Math.round(pdfZoom * 100)}%</span>
					<button
						class="zoom-btn"
						on:click={() => (pdfZoom = Math.min(2.5, pdfZoom + 0.05))}
						title="Aumentar zoom"
						aria-label="Aumentar zoom"
					>
						+
					</button>
					<button
						class="zoom-btn zoom-reset"
						on:click={() => (pdfZoom = 1)}
						title="Restablecer zoom al 100%"
						aria-label="Restablecer zoom al 100%"
					>
						↺
					</button>
					<button
						class="zoom-btn zoom-fit"
						on:click={fitToViewport}
						title="Ajustar al ancho de pantalla"
						aria-label="Ajustar al ancho de pantalla"
					>
						⤢
					</button>
				</div>
				<button
					class="toolbar-btn toolbar-btn-blue"
					on:click={autocompletarNominaPlaca}
					disabled={nominaLoading}
				>
					{#if nominaLoading}
						<span class="spinner-sm"></span>
					{:else}
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path
								d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
							/>
						</svg>
					{/if}
					Autocompletar Nómina
				</button>
				<button class="toolbar-btn toolbar-btn-amber" on:click={calcularImpuestosPlaca}>
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
					Calcular Impuestos
				</button>
				<button class="toolbar-btn toolbar-btn-dark" on:click={addConductor}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
						<circle cx="9" cy="7" r="4" />
						<path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
					</svg>
					+ Conductor
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

		<!-- GRID BODY -->
		<div class="excel-grid-body" class:has-zoom={pdfZoom !== 1}>
			<div
				class="excel-grid-container"
				style="transform: scale({pdfZoom}); transform-origin: top left; width: {100 /
					pdfZoom}%;"
			>
				<table class="excel-table items-table">
					<thead>
						<tr>
							<th class="col-row-num">#</th>
							<th
								class="col-cliente sortable"
								class:sort-active={sortKey === 'cliente'}
								on:click={() => toggleSort('cliente')}
							>
								<span>CLIENTE</span><span class="sort-icon">{sortIcons.cliente}</span>
							</th>
							<th
								class="col-liq sortable"
								class:sort-active={sortKey === 'consecutivo'}
								on:click={() => toggleSort('consecutivo')}
							>
								<span># LIQ</span><span class="sort-icon">{sortIcons.consecutivo}</span>
							</th>
							<th
								class="col-placa sortable"
								class:sort-active={sortKey === 'placa'}
								on:click={() => toggleSort('placa')}
							>
								<span>PLACA</span><span class="sort-icon">{sortIcons.placa}</span>
							</th>
							<th
								class="col-nombre sortable"
								class:sort-active={sortKey === 'nombre'}
								on:click={() => toggleSort('nombre')}
							>
								<span>NOMBRE 3°</span><span class="sort-icon">{sortIcons.nombre}</span>
							</th>
							<th
								class="col-recorrido sortable"
								class:sort-active={sortKey === 'recorrido'}
								on:click={() => toggleSort('recorrido')}
							>
								<span>RECORRIDO</span><span class="sort-icon">{sortIcons.recorrido}</span>
							</th>
							<th
								class="col-fechas sortable"
								class:sort-active={sortKey === 'fechas'}
								on:click={() => toggleSort('fechas')}
							>
								<span>FECHAS</span><span class="sort-icon">{sortIcons.fechas}</span>
							</th>
							<th
								class="col-vr-unit sortable"
								class:sort-active={sortKey === 'valorUnitario'}
								on:click={() => toggleSort('valorUnitario')}
							>
								<span>V/UNIDAD</span><span class="sort-icon">{sortIcons.valorUnitario}</span>
							</th>
							<th
								class="col-cant sortable"
								class:sort-active={sortKey === 'cantidad'}
								on:click={() => toggleSort('cantidad')}
							>
								<span>CANT</span><span class="sort-icon">{sortIcons.cantidad}</span>
							</th>
							<th
								class="col-admon-pct sortable"
								class:sort-active={sortKey === 'porcentajeAdmin'}
								on:click={() => toggleSort('porcentajeAdmin')}
							>
								<span>ADMON (%)</span><span class="sort-icon">{sortIcons.porcentajeAdmin}</span>
							</th>
							<th
								class="col-admon sortable"
								class:sort-active={sortKey === 'valorAdmin'}
								on:click={() => toggleSort('valorAdmin')}
							>
								<span>VALOR ADMON ($)</span><span class="sort-icon">{sortIcons.valorAdmin}</span>
							</th>
							<th
								class="col-total sortable"
								class:sort-active={sortKey === 'totalFacturado'}
								on:click={() => toggleSort('totalFacturado')}
							>
								<span>TOTAL</span><span class="sort-icon">{sortIcons.totalFacturado}</span>
							</th>
							<th
								class="col-vliq sortable"
								class:sort-active={sortKey === 'valorLiquidar'}
								on:click={() => toggleSort('valorLiquidar')}
							>
								<span>V/LIQUIDAR</span><span class="sort-icon">{sortIcons.valorLiquidar}</span>
							</th>
							<th
								class="col-planilla sortable"
								class:sort-active={sortKey === 'numeroPlanilla'}
								on:click={() => toggleSort('numeroPlanilla')}
							>
								<span># PLANILLA</span><span class="sort-icon">{sortIcons.numeroPlanilla}</span>
							</th>
							<th
								class="col-ing-global sortable"
								class:sort-active={sortKey === 'ingresoExtraGlobal'}
								on:click={() => toggleSort('ingresoExtraGlobal')}
							>
								<span>ING. EXTRA GLOBAL</span><span class="sort-icon"
									>{sortIcons.ingresoExtraGlobal}</span
								>
							</th>
							<th
								class="col-ing-aval sortable"
								class:sort-active={sortKey === 'ingresosExtraAval'}
								on:click={() => toggleSort('ingresosExtraAval')}
							>
								<span>ING. EXTRAS AVAL</span><span class="sort-icon"
									>{sortIcons.ingresosExtraAval}</span
								>
							</th>
							<th
								class="col-ing-trans sortable"
								class:sort-active={sortKey === 'ingresoTransmeralda'}
								on:click={() => toggleSort('ingresoTransmeralda')}
							>
								<span>ING. COTRANSMEQ</span><span class="sort-icon"
									>{sortIcons.ingresoTransmeralda}</span
								>
							</th>
							<th
								class="col-factura sortable"
								class:sort-active={sortKey === 'facturas'}
								on:click={() => toggleSort('facturas')}
							>
								<span># FACTURA</span><span class="sort-icon">{sortIcons.facturas}</span>
							</th>
							<th class="col-action"></th>
						</tr>
					</thead>
					<tbody>
						{#each sortedPlacaItems as item, itemIdx}
							{@const lt = item.tercero.liquidacion_tercero || {}}
							{@const ltOriginalId = (lt as any).liquidacion_tercero_id_original || lt.id}
							{@const excluded = excludedItemKeys.has(
								`${item.liquidacion_servicio.id}::${ltOriginalId}`
							)}
							{@const porcentajeAdmin = lt.porcentaje_admin ?? 0}
							{@const valorAdmin = lt.valor_admin ?? 0}
							{@const totalFacturado = lt.total_facturado ?? 0}
							{@const valorLiquidar = lt.valor_liquidar ?? 0}
							{@const ingresoExtraGlobal = lt.ingreso_extra_global ?? 0}
							{@const ingresosExtraAval = lt.ingresos_extra_aval ?? 0}
							{@const ingresoTransmeralda = ingresoExtraGlobal - ingresosExtraAval}
							{@const originalRowNum = itemIdx + 1}
							<tr class:row-excluded={excluded}>
								<td class="cell-row-num">{originalRowNum}</td>
								<td class="cell-cliente">{item.liquidacion_servicio.cliente?.nombre || '—'}</td>
								<td class="cell-consecutivo">{item.liquidacion_servicio.consecutivo}</td>
								<td class="cell-placa">{fmtPlaca(item.tercero.placa)}</td>
								<td class="cell-nombre">{lt.tercero?.nombre_completo || 'Sin asignar'}</td>
								<td class="cell-recorrido">{lt.recorrido || '—'}</td>
								<td class="cell-fechas">{lt.fechas || '—'}</td>
								<td class="cell-num">{fmtCOP(lt.valor_unitario || 0)}</td>
								<td class="cell-num cell-center">{lt.cantidad || 0}</td>
								<td class="cell-num cell-center"
									>{porcentajeAdmin ? porcentajeAdmin.toFixed(2) + '%' : '—'}</td
								>
								<td class="cell-num cell-red">{fmtCOP(valorAdmin)}</td>
								<td class="cell-num cell-bold">{fmtCOP(totalFacturado)}</td>
								<td class="cell-num cell-bold cell-green">{fmtCOP(valorLiquidar)}</td>
								<td class="cell-planilla">{lt.item?.numero_planilla || '—'}</td>
								<td class="cell-num cell-green">{fmtCOP(ingresoExtraGlobal)}</td>
								<td class="cell-num">{fmtCOP(ingresosExtraAval)}</td>
								<td class="cell-num cell-bold cell-blue">{fmtCOP(ingresoTransmeralda)}</td>
								<td class="cell-factura">{(item as any).facturas || '—'}</td>
								<td>
									<div class="cell-action-group">
										<button
											class="btn-tax-toggle"
											class:on={aplicaImpuestosByPivote[item.pivoteId] !== false}
											on:click={() => toggleAplicaImpuestosItem(item)}
											title={aplicaImpuestosByPivote[item.pivoteId] !== false ? 'Aplica impuestos' : 'Excluido de impuestos'}
										>
											{aplicaImpuestosByPivote[item.pivoteId] !== false ? '%' : '⊘'}
										</button>
										<button
											class="btn-exclude"
											class:excluded
											on:click={() => toggleExcludeItem(item.liquidacion_servicio.id, ltOriginalId)}
											title={excluded ? 'Reactivar' : 'Excluir'}
										>
											{excluded ? '↺' : '✕'}
										</button>
									</div>
								</td>
							</tr>
						{/each}

						{#if currentAdicionales.length > 0}
							{#each currentAdicionales as adc, adcIdx}
								{@const vLiqGross =
									(Number(adc.valor_unitario) || 0) * (Number(adc.cantidad) || 0)}
								{@const vAdmin = adicionalVAdmin(adc)}
								{@const vLiq = vLiqGross - vAdmin}
								<tr class="row-adicional">
									<td class="cell-row-num"><span class="badge-adc">ADC</span></td>
									<td class="cell-cliente"><strong>{adc.cliente || 'COTRANSMEQ'}</strong></td>
									<td class="cell-consecutivo">—</td>
									<td class="cell-placa">{fmtPlaca(adc.placa || currentPlaca.placa)}</td>
									<td class="cell-nombre">{adc.tercero_nombre || currentPlaca.nombre || '—'}</td>
									<td class="cell-recorrido">
										<input
											type="text"
											class="excel-cell-input"
											value={adc.recorrido || ''}
											placeholder="Recorrido..."
											on:input={(e) =>
												updateAdicionalField(
													adcIdx,
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
											placeholder="Ej: 24-abr"
											on:input={(e) =>
												updateAdicionalField(
													adcIdx,
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
													adcIdx,
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
													adcIdx,
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
														adcIdx,
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
									<td class="cell-planilla">—</td>
									<td class="cell-num">$ 0</td>
									<td class="cell-num">$ 0</td>
									<td class="cell-num cell-bold cell-negativo">{fmtCOPNegativo(vLiq)}</td>
									<td class="cell-factura">—</td>
									<td class="cell-action">
										<button
											class="btn-tax-toggle"
											class:on={adc.aplica_impuestos !== false}
											on:click={() =>
												updateAdicionalField(
													adcIdx,
													'aplica_impuestos',
													!adc.aplica_impuestos
												)}
											title={adc.aplica_impuestos !== false
												? 'Aplica impuestos (clic para excluir)'
												: 'Excluido de impuestos (clic para aplicar)'}
										>
											{adc.aplica_impuestos !== false ? '%' : '⊘'}
										</button>
										<button class="btn-exclude" on:click={() => deleteAdicional(adcIdx)}>✕</button>
									</td>
								</tr>
							{/each}
						{/if}

						{#if itemsConAdicionales.length > 0}
							<tr class="row-items-totals">
								<td colspan="10" class="cell-bold">TOTALES</td>
								<td class="cell-num cell-red"
									>{fmtCOP(
										itemsConAdicionales.reduce(
											(s, i) => s + (i.tercero?.liquidacion_tercero?.valor_admin || 0),
											0
										)
									)}</td
								>
								<td class="cell-num cell-bold"
									>{fmtCOP(
										itemsConAdicionales.reduce(
											(s, i) => s + (i.tercero?.liquidacion_tercero?.total_facturado || 0),
											0
										)
									)}</td
								>
								<td class="cell-num cell-bold cell-green"
									>{fmtCOP(
										itemsConAdicionales.reduce(
											(s, i) => s + (i.tercero?.liquidacion_tercero?.valor_liquidar || 0),
											0
										)
									)}</td
								>
								<td class="cell-planilla"></td>
								<td class="cell-num cell-green"
									>{fmtCOP(
										itemsConAdicionales.reduce(
											(s, i) => s + (i.tercero?.liquidacion_tercero?.ingreso_extra_global || 0),
											0
										)
									)}</td
								>
								<td class="cell-num"
									>{fmtCOP(
										itemsConAdicionales.reduce(
											(s, i) => s + (i.tercero?.liquidacion_tercero?.ingresos_extra_aval || 0),
											0
										)
									)}</td
								>
								<td class="cell-num cell-bold cell-blue"
									>{fmtCOP(
										itemsConAdicionales.reduce((s, i) => {
											const lt2 = i.tercero?.liquidacion_tercero;
											// Para los adicionales, ING. COTRANSMEQ resta el vLiq
											// (representado como un número negativo en la fila).
											if (i._esAdicional) {
												return s - (lt2?.valor_liquidar || 0);
											}
											return (
												s +
												((lt2?.ingreso_extra_global || 0) - (lt2?.ingresos_extra_aval || 0))
											);
										}, 0)
									)}</td
								>
								<td class="cell-factura"></td>
								<td class="cell-action"></td>
							</tr>
						{/if}

						<tr class="row-section-header row-descuentos-header">
							<td colspan="19">
								<span class="section-icon">💼</span>DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO
							</td>
						</tr>

						{#each conductorGrupos as grupo, grupoIdx}
							{@const grupoConductorId = grupo.conceptos[0]?.conductor_id || null}
							{@const inputKey = getConductorInputKey(grupoConductorId)}
							{@const isFromNomina = !!conductorFromNomina[inputKey]}
							{@const grupoNumeroIdentificacion =
								grupo.conceptos[0]?.conductor?.numero_identificacion || ''}
							{@const grupoNombreDisplay = grupo.conceptos[0]?.conductor
								? `${grupo.conceptos[0].conductor.nombre} ${grupo.conceptos[0].conductor.apellido}`.trim()
								: grupo.nombre}

							<tr class="row-section-header row-conductor-header">
								<td colspan="19">
									<span class="section-icon">👤</span>
									{#if grupoConductorId}
										<span class="conductor-display-name">"{grupoNombreDisplay}"</span>
										{#if isFromNomina}<span class="badge-nomina">Nómina</span>{/if}
										{#if grupoNumeroIdentificacion}<span class="badge-cedula"
												>CC {grupoNumeroIdentificacion}</span
											>{/if}
									{:else}
										<input
											type="text"
											class="conductor-name-inline"
											placeholder="Nombre del conductor"
											value={conductorNameInputs[inputKey] ?? ''}
											on:input={(e) =>
												onConductorNameInput(inputKey, (e.currentTarget as HTMLInputElement).value)}
											on:change={(e) => {
												const v = (e.currentTarget as HTMLInputElement).value.trim();
												if (v) renameConductor(grupoConductorId, v);
											}}
										/>
									{/if}
									<label
										class="propietario-toggle"
										class:propietario-auto={conductorPropietarioOrigen[inputKey] === 'auto' && conductorEsPropietario[inputKey]}
										class:propietario-manual={conductorPropietarioOrigen[inputKey] === 'manual' && conductorEsPropietario[inputKey]}
										title={conductorPropietarioOrigen[inputKey] === 'auto'
											? 'Propietario auto-detectado (coincide con el propietario del vehículo). Toca para sobreescribir.'
											: 'Si es propietario, NO se le descuenta DOTACION'}
									>
										<input
											type="checkbox"
											checked={!!conductorEsPropietario[inputKey]}
											on:change={() => toggleConductorPropietario(grupoConductorId)}
										/>
										<span class="propietario-label">
											Propietario
											{#if conductorPropietarioOrigen[inputKey] === 'auto' && conductorEsPropietario[inputKey]}
												<span class="propietario-origen" title="Auto-detectado por número de identificación">· AUTO</span>
											{:else if conductorPropietarioOrigen[inputKey] === 'manual' && conductorEsPropietario[inputKey]}
												<span class="propietario-origen" title="Marcado manualmente">· MANUAL</span>
											{/if}
										</span>
									</label>
									<button
										class="btn-remove-conductor-inline"
										on:click={() => removeConductor(grupoConductorId, grupo.nombre)}>✕</button
									>
								</td>
							</tr>

							<tr class="row-conductor-subheader">
								<td colspan="2" class="cell-subheader">CONCEPTO</td>
								<td class="cell-subheader cell-subheader-center">DIAS / PORCENTAJE</td>
								<td class="cell-subheader cell-subheader-right">VALOR</td>
								<td class="cell-subheader cell-subheader-right">TOTAL</td>
								<td colspan="14" class="cell-action-cell"></td>
							</tr>

							{#each grupo.salarios as c}
								{@const cIdx = currentPlaca.conceptos.indexOf(c)}
								<tr class="row-concepto">
									<td colspan="2" class="cell-concepto cell-bold"
										>{c.concepto.replace(/_/g, ' ')}</td
									>
									<td class="cell-input-cell">
										<input
											type="number"
											class="excel-cell-input excel-cell-input-dias"
											value={c.dias || 0}
											data-row={cIdx}
											data-col="0"
											on:input={(e) =>
												updateConceptoDias(
													cIdx,
													parseFloat((e.currentTarget as HTMLInputElement).value) || 0
												)}
											on:keydown={(e) => handleArrowNav(e, cIdx, 0)}
										/>
									</td>
									<td class="cell-num">
										<input
											type="text"
											class="excel-cell-input excel-cell-input-num"
											value={c.valor_unitario ? fmtCOPInput(c.valor_unitario) : ''}
											placeholder="0"
											data-row={cIdx}
											data-col="1"
											on:change={(e) =>
												updateConceptoValorUnitarioPlaca(
													cIdx,
													parseCOP((e.currentTarget as HTMLInputElement).value)
												)}
											on:keydown={(e) => handleArrowNav(e, cIdx, 1)}
										/>
									</td>
									<td class="cell-total">{fmtCOP(c.valor_total || 0)}</td>
									<td colspan="13" class="cell-base"></td>
									<td class="cell-action-cell">
										<button class="btn-exclude" on:click={() => removeConceptoPlaca(cIdx)}
											>✕</button
										>
									</td>
								</tr>
							{/each}

							{#if grupo.prestaciones.length > 0}
								{@const totalPrest = grupo.prestaciones.reduce(
									(s, c) => s + (c.valor_total || 0),
									0
								)}
								{@const pctPrest = grupo.prestaciones.reduce((s, c) => s + (c.porcentaje || 0), 0)}
								<tr class="row-section-header row-prestaciones-header">
									<td colspan="2" class="cell-section-label"
										><span class="section-icon">📋</span>PRESTACIONES SOCIALES</td
									>
									<td class="cell-section-pct"
										><span class="pct-value">{pctPrest ? pctPrest.toFixed(2) : '0.00'}%</span></td
									>
									<td class="cell-action-cell"></td>
									<td class="cell-section-total">{fmtCOP(totalPrest)}</td>
									<td colspan="14" class="cell-action-cell"></td>
								</tr>
								{#each grupo.prestaciones as c}
									{@const cIdx = currentPlaca.conceptos.indexOf(c)}
									<tr class="row-concepto row-sub-concepto">
										<td colspan="2" class="cell-concepto cell-sub"
											>{c.concepto.replace(/_/g, ' ')}</td
										>
										<td class="cell-input-cell">
											<div class="cell-pct-wrap">
												<input
													type="number"
													step="0.01"
													class="excel-cell-input excel-cell-input-pct"
													value={c.porcentaje || ''}
													data-row={cIdx}
													data-col="2"
													on:input={(e) =>
														updateConceptoPorcentaje(
															cIdx,
															parseFloat((e.currentTarget as HTMLInputElement).value) || 0
														)}
													on:keydown={(e) => handleArrowNav(e, cIdx, 2)}
												/>
												<span class="cell-pct-suffix">%</span>
											</div>
										</td>
										<td class="cell-base"></td>
										<td class="cell-total">{fmtCOP(c.valor_total || 0)}</td>
										<td colspan="13" class="cell-base"></td>
										<td class="cell-action-cell">
											<button class="btn-exclude" on:click={() => removeConceptoPlaca(cIdx)}
												>✕</button
											>
										</td>
									</tr>
								{/each}
							{/if}

							{#if grupo.seguridadSocial.length > 0}
								{@const totalSS = grupo.seguridadSocial.reduce(
									(s, c) => s + (c.valor_total || 0),
									0
								)}
								{@const pctSS = grupo.seguridadSocial.reduce((s, c) => s + (c.porcentaje || 0), 0)}
								<tr class="row-section-header row-seguridad-header">
									<td colspan="2" class="cell-section-label"
										><span class="section-icon">🛡️</span>SEGURIDAD SOCIAL</td
									>
									<td class="cell-section-pct"
										><span class="pct-value-seguridad-social"
											>{pctSS ? pctSS.toFixed(2) : '0.00'}%</span
										></td
									>
									<td class="cell-action-cell"></td>
									<td class="cell-section-total">{fmtCOP(totalSS)}</td>
									<td colspan="14" class="cell-action-cell"></td>
								</tr>
								{#each grupo.seguridadSocial as c}
									{@const cIdx = currentPlaca.conceptos.indexOf(c)}
									<tr class="row-concepto row-sub-concepto">
										<td colspan="2" class="cell-concepto cell-sub"
											>{c.concepto.replace(/_/g, ' ')}</td
										>
										<td class="cell-input-cell">
											<div class="cell-pct-wrap">
												<input
													type="number"
													step="0.01"
													class="excel-cell-input excel-cell-input-pct"
													value={c.porcentaje || ''}
													data-row={cIdx}
													data-col="2"
													on:input={(e) =>
														updateConceptoPorcentaje(
															cIdx,
															parseFloat((e.currentTarget as HTMLInputElement).value) || 0
														)}
													on:keydown={(e) => handleArrowNav(e, cIdx, 2)}
												/>
												<span class="cell-pct-suffix">%</span>
											</div>
										</td>
										<td class="cell-base"></td>
										<td class="cell-total">{fmtCOP(c.valor_total || 0)}</td>
										<td colspan="13" class="cell-base"></td>
										<td class="cell-action-cell">
											<button class="btn-exclude" on:click={() => removeConceptoPlaca(cIdx)}
												>✕</button
											>
										</td>
									</tr>
								{/each}
							{/if}

							<tr class="row-add-concept">
								<td colspan="2">
									<CellSelect
										options={CONCEPTOS_LABORALES}
										placeholder="+ Agregar concepto laboral..."
										onSelect={(val) =>
											addConceptoPlaca(
												'COSTO_LABORAL',
												val,
												grupoConductorId,
												grupo.conceptos[0]?.conductor || null
											)}
									/>
								</td>
								<td colspan="17" class="cell-action-cell"></td>
							</tr>

							{@const totalSalarios = grupo.salarios.reduce((s, c) => s + (c.valor_total || 0), 0)}
							{@const totalPrestacionesConductor = grupo.prestaciones.reduce(
								(s, c) => s + (c.valor_total || 0),
								0
							)}
							{@const totalSeguridadConductor = grupo.seguridadSocial.reduce(
								(s, c) => s + (c.valor_total || 0),
								0
							)}
							<tr class="row-conductor-total">
								<td colspan="3" class="cell-tfoot-label">Ingresos</td>
								<td class="cell-action-cell"></td>
								<td class="cell-tfoot-value">{fmtCOP(totalSalarios)}</td>
								<td colspan="14" class="cell-action-cell"></td>
							</tr>
							<tr class="row-conductor-total">
								<td colspan="3" class="cell-tfoot-label">Prestaciones</td>
								<td class="cell-action-cell"></td>
								<td class="cell-tfoot-value">{fmtCOP(totalPrestacionesConductor)}</td>
								<td colspan="14" class="cell-action-cell"></td>
							</tr>
							<tr class="row-conductor-total">
								<td colspan="3" class="cell-tfoot-label">Seguridad social</td>
								<td class="cell-action-cell"></td>
								<td class="cell-tfoot-value">{fmtCOP(totalSeguridadConductor)}</td>
								<td colspan="14" class="cell-action-cell"></td>
							</tr>
							<tr class="row-conductor-total row-conductor-grand-total">
								<td colspan="3" class="cell-tfoot-label cell-tfoot-label-main"
									>VALOR TOTAL CONDUCTOR</td
								>
								<td class="cell-action-cell"></td>
								<td class="cell-tfoot-value cell-tfoot-value-main"
									>{fmtCOP(grupo.totalConductor)}</td
								>
								<td colspan="14" class="cell-action-cell"></td>
							</tr>
						{/each}

					<tr class="row-section-header row-gastos-header">
						<td colspan="19"><span class="section-icon">🚗</span>GASTOS DE VEHÍCULO</td>
					</tr>
					{#if gastos.length > 0}
						<tr class="row-gastos-subheader">
							<td colspan="2" class="cell-subheader">CONCEPTO</td>
							<td class="cell-subheader cell-subheader-center">CANTIDAD</td>
							<td class="cell-subheader cell-subheader-right">V/UNITARIO</td>
							<td class="cell-subheader cell-subheader-right">TOTAL</td>
							<td colspan="13" class="cell-action-cell"></td>
							<td class="cell-action-cell"></td>
						</tr>
					{/if}
				{#each gastos as c}
					{@const cIdx = currentPlaca.conceptos.indexOf(c)}
					{@const esAutoGasto = CONCEPTOS_CALCULADOS_AUTO.has(c.concepto)}
					{@const esManualOverride = esAutoGasto && c.calculado === false}
					{@const esGastosDiversos = c.concepto === 'GASTOS_DIVERSOS'}
					{@const mostrarPopover = esGastosDiversos && !esManualOverride}
					{@const totalFacturadoItemsGD = sumTotalItemsLiquidacionPara(placaItemsIncluidos)}
					{@const totalAdicionalesGD = currentAdicionales.reduce(
						(s, a) =>
							s +
							(Number(a.valor_liquidar) ||
								(Number(a.valor_unitario) || 0) * (Number(a.cantidad) || 0)),
						0
					)}
					{@const totalBaseGD = totalFacturadoItemsGD + totalAdicionalesGD}
					{@const porcentajeGD = Math.round(totalBaseGD * PORCENTAJE_GASTO_POR_ITEM)}
						<tr
							class="row-concepto"
							class:row-concepto-auto={esAutoGasto && !esManualOverride}
							class:row-concepto-manual={esManualOverride}
						>
							<td colspan="2" class="cell-concepto cell-bold">
								<input
									type="text"
									class="excel-cell-input"
									value={c.concepto.replace(/_/g, ' ')}
									placeholder="Nombre del gasto"
									on:change={(e) =>
										updateGastoConcepto(
											cIdx,
											(e.currentTarget as HTMLInputElement).value
										)}
								/>
							</td>
							<td class="cell-input-cell">
								<input
									type="number"
									class="excel-cell-input excel-cell-input-dias"
									value={c.dias || 0}
									data-row={cIdx}
									data-col="0"
									on:input={(e) =>
										updateConceptoDias(
											cIdx,
											parseFloat((e.currentTarget as HTMLInputElement).value) || 0
										)}
									on:keydown={(e) => handleArrowNav(e, cIdx, 0)}
								/>
							</td>
							<td
								class="cell-num"
								class:cell-num-config={mostrarPopover}
								class:cell-num-has-config={mostrarPopover}
							>
								<input
									type="text"
									class="excel-cell-input excel-cell-input-num"
									value={c.valor_unitario ? fmtCOPInput(c.valor_unitario) : ''}
									placeholder="0"
									data-row={cIdx}
									data-col="1"
									on:change={(e) =>
										updateConceptoValorUnitarioPlaca(
											cIdx,
											parseCOP((e.currentTarget as HTMLInputElement).value)
										)}
									on:keydown={(e) => handleArrowNav(e, cIdx, 1)}
								/>
							{#if mostrarPopover}
								<span class="config-triangle" aria-hidden="true"></span>
								<div class="config-popover">
									<div class="config-popover-title">⚙ Desglose de configuración</div>
									<div class="config-popover-row">
										<span class="cp-label">Tarifa fija:</span>
										<span class="cp-val cp-fija">{fmtCOP(TARIFA_FIJA_GASTOS_DIVERSOS)}</span>
									</div>
									<div class="config-popover-row">
										<span class="cp-label">0,4% × base total:</span>
										<span class="cp-val cp-base">{fmtCOP(porcentajeGD ?? 0)}</span>
									</div>
									<div class="config-popover-divider"></div>
									<div class="config-popover-subtitle">Composición de la base</div>
									<div class="config-popover-row">
										<span class="cp-label cp-sub">Σ Total facturado (items):</span>
										<span class="cp-val">{fmtCOP(totalFacturadoItemsGD)}</span>
									</div>
									<div class="config-popover-row">
										<span class="cp-label cp-sub">Σ V/Liquidar (adicionales):</span>
										<span class="cp-val">{fmtCOP(totalAdicionalesGD)}</span>
									</div>
									<div class="config-popover-row cp-total">
										<span class="cp-label">Base total:</span>
										<span class="cp-val">{fmtCOP(totalBaseGD)}</span>
									</div>
									<div class="config-popover-row cp-total">
										<span class="cp-label">V/Unitario:</span>
										<span class="cp-val">{fmtCOP(c.valor_unitario || 0)}</span>
									</div>
									<div class="config-popover-row cp-total">
										<span class="cp-label">Cantidad:</span>
										<span class="cp-val">× {c.dias || 1}</span>
									</div>
									<div class="config-popover-row cp-grand-total">
										<span class="cp-label">Total:</span>
										<span class="cp-val">{fmtCOP(c.valor_total || 0)}</span>
									</div>
								</div>
							{/if}
							</td>
							<td class="cell-total">{fmtCOP(c.valor_total || 0)}</td>
							<td colspan="13" class="cell-action-cell"></td>
							<td class="cell-actions-wide">
								<div class="cell-action-group">
									{#if esManualOverride}
										<button
											class="btn-reset-auto"
											on:click={() => resetGastoToAuto(cIdx)}
											title="Restablecer al cálculo automático"
										>↺</button>
									{/if}
									{#if !esAutoGasto}
										<button
											class="btn-exclude"
											on:click={() => removeConceptoPlaca(cIdx)}
											title="Eliminar gasto"
											>✕</button
										>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
					{#if gastos.length === 0}
						<tr class="row-empty"><td colspan="5">Sin gastos registrados</td></tr>
					{/if}
					{#if gastos.length > 0}
						<tr class="row-gastos-total">
							<td colspan="4" class="cell-bold cell-row-total-label"
								>TOTAL GASTOS DE VEHÍCULO</td
							>
							<td class="cell-total cell-bold cell-red"
								>{fmtCOP(
									gastos.reduce((s: number, c: any) => s + (c.valor_total || 0), 0)
								)}</td
							>
							<td colspan="14" class="cell-action-cell"></td>
						</tr>
					{/if}
					<tr class="row-add-concept">
						<td colspan="5">
							<CellSelect
								options={CONCEPTOS_GASTOS}
								placeholder="+ Escribe o selecciona un gasto (ej: Peajes, Lavado, etc.)"
								onSelect={(val) => addConceptoPlaca('GASTO_OPERATIVO', val, null, null)}
							/>
						</td>
						<td colspan="14" class="cell-action-cell"></td>
					</tr>

						<tr class="row-section-header row-anticipos-header">
							<td colspan="4">
								<div class="anticipos-header-cell">
									<span><span class="section-icon">💵</span>ANTICIPOS DEL VEHÍCULO</span>
								</div>
							</td>
							<td colspan="15">
								<button class="add-anticipo-btn" on:click={addAnticipoRow}>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
										<line x1="12" y1="5" x2="12" y2="19" />
										<line x1="5" y1="12" x2="19" y2="12" />
									</svg>
									+ Agregar anticipo
								</button>
							</td>
						</tr>
						{#if anticipos.length > 0}
							<tr class="row-anticipos-subheader">
								<td colspan="2" class="cell-subheader">CONCEPTO</td>
								<td class="cell-subheader cell-subheader-center">FECHA</td>
								<td colspan="2" class="cell-subheader cell-subheader-right">VALOR</td>
								<td colspan="13" class="cell-action-cell"></td>
							</tr>
							{#each anticipos as c}
								{@const cIdx = currentPlaca.conceptos.indexOf(c)}
								<tr class="row-concepto row-anticipo">
									<td colspan="2" class="cell-concepto cell-bold">
										<input
											type="text"
											class="excel-cell-input"
											value={c.concepto || ''}
											placeholder="Ej: Combustible, Adelanto..."
											on:change={(e) => updateAnticipoConcepto(cIdx, (e.currentTarget as HTMLInputElement).value)}
										/>
									</td>
									<td class="cell-input-cell">
										<input
											type="date"
											class="excel-cell-input"
											value={c.observaciones || ''}
											on:change={(e) => updateAnticipoFecha(cIdx, (e.currentTarget as HTMLInputElement).value)}
										/>
									</td>
									<td colspan="2" class="cell-num">
										<input
											type="text"
											class="excel-cell-input excel-cell-input-num"
											value={c.valor_unitario ? fmtCOPInput(c.valor_unitario) : ''}
											placeholder="0"
											on:change={(e) => updateAnticipoValor(cIdx, parseCOP((e.currentTarget as HTMLInputElement).value))}
										/>
									</td>
									<td colspan="13" class="cell-base"></td>
									<td class="cell-action-cell">
										<button class="btn-exclude" on:click={() => removeConceptoPlaca(cIdx)}>✕</button>
									</td>
								</tr>
							{/each}
						{/if}
						{#if anticipos.length === 0}
							<tr class="row-empty"><td colspan="4">Sin anticipos registrados</td></tr>
						{/if}
						{#if anticipos.length > 0}
							<tr class="row-anticipos-total">
								<td colspan="4" class="cell-bold">TOTAL ANTICIPOS</td>
								<td colspan="2" class="cell-total cell-bold cell-red">{fmtCOP(anticipos.reduce((s: number, c: any) => s + (c.valor_total || 0), 0))}</td>
								<td colspan="13"></td>
							</tr>
						{/if}

					<tr class="row-section-header row-impuestos-header">
						<td colspan="19"><span class="section-icon">📊</span>IMPUESTOS Y RETENCIONES</td>
					</tr>
					{#if currentPlaca}
						<tr class="row-impuestos-base">
							<td colspan="3" class="cell-base-label"
								>Base imponible (Σ valor_liquidar con impuestos):</td
							>
							<td class="cell-base">{fmtCOP(baseImpuestosPlaca)}</td>
							<td colspan="15"></td>
						</tr>
					{/if}
					{#if impuestos.length > 0}
						<tr class="row-impuestos-subheader">
							<td colspan="2" class="cell-subheader">CONCEPTO</td>
							<td class="cell-subheader cell-subheader-center">PORCENTAJE</td>
							<td class="cell-subheader cell-subheader-right">BASE IMPONIBLE</td>
							<td class="cell-subheader cell-subheader-right">VALOR</td>
							<td colspan="13" class="cell-action-cell"></td>
							<td class="cell-action-cell"></td>
						</tr>
					{/if}
					{#each impuestos as c}
						{@const cIdx = currentPlaca.conceptos.indexOf(c)}
						<tr class="row-concepto">
							<td colspan="2" class="cell-concepto cell-bold">{c.concepto.replace(/_/g, ' ')}</td>
							<td class="cell-input-cell">
								<div class="cell-pct-wrap">
									<input
										type="number"
										step="0.01"
										class="excel-cell-input excel-cell-input-pct"
										value={c.porcentaje || ''}
										data-row={cIdx}
										data-col="2"
										on:input={(e) =>
											updateConceptoPorcentaje(
												cIdx,
												parseFloat((e.currentTarget as HTMLInputElement).value) || 0
											)}
										on:keydown={(e) => handleArrowNav(e, cIdx, 2)}
									/>
									<span class="cell-pct-suffix">%</span>
								</div>
							</td>
							<td class="cell-base">{fmtCOP(c.base_calculo || 0)}</td>
							<td class="cell-total">{fmtCOP(c.valor_total || 0)}</td>
							<td colspan="13" class="cell-action-cell"></td>
							<td class="cell-action-cell"
								><button class="btn-exclude" on:click={() => removeConceptoPlaca(cIdx)}
									>✕</button
								></td
							>
						</tr>
					{/each}
					{#if impuestos.length === 0}
						<tr class="row-empty"><td colspan="5">Sin impuestos registrados</td></tr>
					{/if}
					{#if impuestos.length > 0}
						<tr class="row-impuestos-total">
							<td colspan="4" class="cell-bold cell-row-total-label"
								>TOTAL IMPUESTOS Y RETENCIONES</td
							>
							<td class="cell-total cell-bold cell-red"
								>{fmtCOP(
									impuestos.reduce((s: number, c: any) => s + (c.valor_total || 0), 0)
								)}</td
							>
							<td colspan="14" class="cell-action-cell"></td>
						</tr>
					{/if}
					<tr class="row-add-concept">
						<td colspan="2">
							<CellSelect
								options={CONCEPTOS_IMPUESTOS}
								placeholder="+ Agregar impuesto o retención..."
								onSelect={(val) => addConceptoPlaca('IMPUESTO', val, null, null)}
							/>
						</td>
						<td colspan="17" class="cell-action-cell"></td>
					</tr>
					</tbody>
					<tfoot>
						<tr class="row-summary">
							<td colspan="2" class="cell-tfoot-label">TOTAL DESCUENTOS</td>
							<td></td><td></td>
							<td class="cell-tfoot-value cell-summary-red">{fmtCOP(totalDescuentos)}</td>
							<td colspan="14" class="cell-action-cell"></td>
						</tr>
						<tr class="row-summary row-summary-pagar">
							<td colspan="2" class="cell-tfoot-label cell-tfoot-label-pagar">TOTAL A PAGAR</td>
							<td></td><td></td>
							<td class="cell-tfoot-value cell-tfoot-value-pagar">{fmtCOP(totalPagar)}</td>
							<td colspan="14" class="cell-action-cell"></td>
						</tr>
					</tfoot>
				</table>
			</div>
		</div>
	</div>
{/if}

<ModalSelectConductor
	bind:isOpen={conductorModalOpen}
	onSelect={onConductorSelected}
	title="Seleccionar Conductor"
	searchPlaceholder="Buscar por nombre o identificación..."
/>

{#if currentPlaca && borradorResults.length > 0}
	<ChatLiquidacionFab
		liquidacionId={id || ''}
		liquidacionInfo={{
			placa: currentPlaca.placa,
			mes: borradorResults[0].liquidacion_servicio.mes || 0,
			anio: borradorResults[0].liquidacion_servicio.anio || 0,
			consecutivo: borradorResults
				.map((r) => r.liquidacion_servicio.consecutivo)
				.filter(Boolean)
				.join(', ')
		}}
	/>
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
	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #e2e8f0;
		border-top-color: #ea580c;
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
	.toolbar-btn-blue {
		background: #2563eb;
		color: #fff;
	}
	.toolbar-btn-blue:hover:not(:disabled) {
		background: #1d4ed8;
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

	.excel-grid-body {
		flex: 1;
		width: 100%;
		min-width: 0;
		overflow: auto;
		background: #fff;
		box-shadow: inset 0 4px 24px rgba(0, 0, 0, 0.15);
	}
	.excel-grid-container {
		background: #fff;
		border-radius: 4px;
		border: 1px solid #cbd5e1;
		min-width: max-content;
	}

	.excel-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.excel-table th {
		position: sticky;
		top: 0;
		z-index: 10;
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
	/* Sticky headers break visually when the parent uses transform: scale().
	   Disable sticky when zoom is active so the header scrolls with the table
	   and the columns stay perfectly aligned with the body rows. */
	.has-zoom .excel-table th {
		position: static;
	}
	.has-zoom .excel-table {
		border-collapse: separate;
		border-spacing: 0;
	}
	.excel-table th.sortable {
		cursor: pointer;
		user-select: none;
		transition: background 0.15s;
	}
	.excel-table th.sortable:hover {
		background: #1a5c38;
	}
	.sort-icon {
		display: inline-block;
		font-size: 10px;
		opacity: 0.3;
		transition:
			opacity 0.15s,
			color 0.15s;
		margin-left: 2px;
	}
	.excel-table th.sortable:hover .sort-icon {
		opacity: 0.6;
	}
	.excel-table th.sort-active .sort-icon {
		opacity: 1;
		background: rgba(0, 0, 0, 0.35);
		color: #fef3c7;
		font-weight: 800;
		font-size: 9px;
		padding: 2px 7px;
		border-radius: 10px;
		letter-spacing: 0.06em;
		margin-left: 4px;
	}
	.excel-table th.sort-active {
		background: #b45309;
		box-shadow: inset 0 -3px 0 0 #fbbf24;
		color: #fff;
	}
	.excel-table th.sort-active:hover {
		background: #c2410c;
	}
	.excel-table th.col-nombre,
	.excel-table th.col-vr-unit,
	.excel-table th.col-vliq,
	.excel-table th.col-planilla,
	.excel-table th.col-action {
		border-left: 1px solid rgba(255, 255, 255, 0.15);
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
	/* Section/header rows span the full table — no inner vertical lines */
	.excel-table tr.row-section-header td,
	.excel-table tr.row-items-totals td,
	.excel-table tr.row-conductor-total td,
	.excel-table tr.row-summary td {
		border-right: none;
		border-left: none;
	}
	.excel-table tbody tr:hover {
		background: #f8fafc;
	}
	.items-table {
		min-width: 1400px;
	}
	.items-table th {
		padding: 7px 8px;
	}
	.items-table td {
		padding: 5px 8px;
		font-size: 11px;
	}

	.col-row-num {
		width: 16px;
		text-align: center;
	}
	.col-cliente {
		min-width: 120px;
		max-width: 160px;
	}
	.col-liq {
		width: 80px;
	}
	.col-placa {
		width: 80px;
	}
	.col-nombre {
		min-width: 120px;
		max-width: 160px;
	}
	.col-recorrido {
		min-width: 140px;
	}
	.col-fechas {
		width: 150px;
	}
	.col-vr-unit {
		width: 100px;
		text-align: right;
	}
	.col-cant {
		width: 50px;
		text-align: center;
	}
	.col-admon-pct {
		width: 60px;
		text-align: center;
	}
	.col-admon {
		width: 90px;
		text-align: right;
	}
	.col-total {
		width: 100px;
		text-align: right;
	}
	.col-vliq {
		width: 100px;
		text-align: right;
	}
	.col-planilla {
		width: 80px;
	}
	.col-ing-global {
		width: 110px;
		text-align: right;
	}
	.col-ing-aval {
		width: 100px;
		text-align: right;
	}
	.col-ing-trans {
		width: 110px;
		text-align: right;
	}
	.col-factura {
		width: 80px;
	}
	.col-action {
		width: 64px;
		text-align: center;
	}

	.cell-row-num {
		text-align: center;
		color: #94a3b8;
		font-family: monospace;
		font-size: 11px;
	}
	.cell-cliente {
		font-size: 12px;
		color: #0f4025;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell-consecutivo {
		font-family: monospace;
		font-weight: 600;
		font-size: 11px;
		color: #0f4025;
		text-align: center;
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell-recorrido {
		color: #475569;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell-fechas {
		color: #64748b;
		font-size: 11px;
		text-align: center;
	}
	.cell-planilla {
		font-family: monospace;
		font-size: 11px;
		color: #64748b;
		text-align: center;
	}
	.cell-factura {
		font-family: monospace;
		font-size: 11px;
		color: #64748b;
	}
	.cell-concepto {
		font-weight: 500;
		color: #374151;
	}
	.cell-bold {
		font-weight: 700;
	}
	.cell-green {
		color: #ea580c !important;
	}
	.cell-red {
		color: #dc2626 !important;
	}
	.cell-blue {
		color: #2563eb !important;
	}
	.cell-center {
		text-align: center;
	}
	.cell-num {
		font-family: monospace;
		font-size: 12px;
		text-align: right;
	}
	.cell-sub {
		padding-left: 16px !important;
		color: #64748b;
		font-size: 11px;
	}

	.cell-negativo {
		color: #b91c1c !important;
		font-weight: 800;
	}

	.row-section-header td {
		padding: 12px 16px;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-bottom: 2px solid;
	}
	.section-icon {
		margin-right: 8px;
		font-size: 14px;
	}
	.row-prestaciones-header td {
		background: #ecfdf5;
		color: #065f46;
		border-top: 3px solid #f97316;
		border-bottom-color: #a7f3d0;
	}
	.row-seguridad-header td {
		background: #eff6ff;
		color: #1e40af;
		border-top: 3px solid #3b82f6;
		border-bottom-color: #bfdbfe;
	}
	.row-descuentos-header td {
		background: #0f4025;
		color: #fff;
		font-weight: 800;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 12px 16px;
		border-top: 3px solid #0a2e1a;
		border-bottom: 2px solid #0a2e1a;
	}
	.row-gastos-header td {
		background: #fffbeb;
		color: #92400e;
		border-top: 3px solid #f59e0b;
		border-bottom-color: #fde68a;
	}
	.row-impuestos-header td {
		background: #fef2f2;
		color: #991b1b;
		border-top: 3px solid #ef4444;
		border-bottom-color: #fecaca;
	}
	.row-anticipos-header td {
		background: #f0fdf4;
		color: #065f46;
		border-top: 3px solid #f97316;
		border-bottom-color: #a7f3d0;
	}
	.anticipos-header-cell {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.row-anticipos-subheader td {
		background: #f8fafc;
		color: #475569;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 6px 10px;
		border-bottom: 1px solid #cbd5e1;
	}
	.row-anticipo td {
		background: #f0fdf4;
		border-bottom: 1px solid #e2e8f0;
	}
	.row-anticipo:hover td {
		background: #ecfdf5;
	}
	.row-anticipos-total td {
		background: #f0fdf4;
		border-top: 2px solid #86efac;
		font-weight: 800;
		color: #065f46;
		padding: 8px 10px;
	}
	.row-gastos-subheader td {
		background: #f8fafc;
		color: #475569;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 6px 10px;
		border-bottom: 1px solid #cbd5e1;
	}
	.row-gastos-total td {
		background: #fffbeb;
		border-top: 2px solid #fbbf24;
		font-weight: 800;
		color: #92400e;
		padding: 8px 10px;
	}
	.row-gastos-total .cell-row-total-label {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 10px;
	}
	.row-impuestos-subheader td {
		background: #f8fafc;
		color: #475569;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 6px 10px;
		border-bottom: 1px solid #cbd5e1;
	}
	.row-impuestos-total td {
		background: #fef2f2;
		border-top: 2px solid #fca5a5;
		font-weight: 800;
		color: #991b1b;
		padding: 8px 10px;
	}
	.row-impuestos-total .cell-row-total-label {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 10px;
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
		border: 1px solid #f97316;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
		letter-spacing: 0.02em;
	}
	.add-anticipo-btn:hover {
		background: #f97316;
		color: #ffffff;
		border-color: #ea580c;
	}
	.add-anticipo-btn svg {
		stroke: currentColor;
	}

	/* ─── GASTOS OPERATIVOS AUTOMÁTICOS ────────────────────── */
	.row-concepto.row-concepto-auto td {
		background: #f8fafc;
	}
	.row-concepto.row-concepto-auto:hover td {
		background: #f1f5f9;
	}
	/* Fila con override manual: highlight cálido para distinguir del modo auto */
	.row-concepto.row-concepto-manual td {
		background: #fffbeb;
		box-shadow: inset 3px 0 0 #d97706;
	}
	.row-concepto.row-concepto-manual:hover td {
		background: #fef3c7;
	}
	/* Botón "↺ AUTO" en filas con override manual para volver al cálculo automático */
	.btn-reset-auto {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		height: 24px;
		font-size: 14px;
		font-weight: 800;
		color: #92400e;
		background: #fef3c7;
		border: 1px solid #fcd34d;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
	}
	.btn-reset-auto:hover {
		background: #fde68a;
		border-color: #d97706;
		color: #78350f;
	}
	/* Celda de acciones de gastos: ancho automático (sin el límite de 24px de
	   .cell-action-cell) para que quepan los dos botones con gap. */
	.cell-actions-wide {
		width: auto;
		min-width: 56px;
		text-align: center;
		padding: 4px 6px !important;
		white-space: nowrap;
	}
	.gasto-auto-name {
		font-weight: 700;
		color: #475569;
		text-transform: capitalize;
		font-size: 12px;
		letter-spacing: 0.02em;
	}
	.gasto-auto-badge {
		display: inline-block;
		margin-left: 6px;
		padding: 1px 6px;
		background: #dbeafe;
		color: #1d4ed8;
		border: 1px solid #bfdbfe;
		border-radius: 999px;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		vertical-align: middle;
	}
	.gasto-auto-dias {
		display: inline-block;
		color: #94a3b8;
		font-family: monospace;
		font-size: 12px;
	}
	.gasto-auto-val {
		display: inline-block;
		font-family: monospace;
		font-size: 12px;
		font-weight: 700;
		color: #475569;
	}
	/* Celda de V/Unitario con config: muestra triángulo indicador + popover on hover */
	.cell-num-config {
		position: relative;
	}
	.config-triangle {
		position: absolute;
		top: 0;
		right: 0;
		width: 0;
		height: 0;
		border-style: solid;
		border-width: 0 8px 8px 0;
		border-color: transparent #ca8a04 transparent transparent;
		pointer-events: none;
	}
	.config-popover {
		visibility: hidden;
		opacity: 0;
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 50;
		min-width: 280px;
		padding: 10px 12px;
		background: #fffbeb;
		border: 1.5px solid #ca8a04;
		border-radius: 8px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
		font-size: 11px;
		color: #422006;
		transition: opacity 0.15s, visibility 0.15s;
		pointer-events: none;
	}
	/* Flecha del popover apuntando hacia arriba */
	.config-popover::before {
		content: '';
		position: absolute;
		top: -8px;
		right: 6px;
		width: 0;
		height: 0;
		border-style: solid;
		border-width: 0 8px 8px 8px;
		border-color: transparent transparent #ca8a04 transparent;
	}
	.config-popover::after {
		content: '';
		position: absolute;
		top: -6px;
		right: 7px;
		width: 0;
		height: 0;
		border-style: solid;
		border-width: 0 7px 7px 7px;
		border-color: transparent transparent #fffbeb transparent;
	}
	.cell-num-has-config:hover .config-popover,
	.cell-num-has-config:focus-within .config-popover {
		visibility: visible;
		opacity: 1;
	}
	.config-popover-title {
		font-weight: 800;
		font-size: 11.5px;
		color: #713f12;
		margin-bottom: 6px;
		padding-bottom: 5px;
		border-bottom: 1px solid #fde68a;
	}
	.config-popover-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 2px 0;
		gap: 12px;
	}
	.cp-label {
		color: #713f12;
		font-weight: 600;
	}
	.cp-val {
		font-family: 'Courier New', monospace;
		font-weight: 700;
		color: #14532d;
	}
	.cp-fija {
		color: #a16207;
	}
	.cp-base {
		color: #166534;
	}
	.config-popover-divider {
		height: 1px;
		background: #fde68a;
		margin: 5px 0;
	}
	.config-popover-subtitle {
		font-size: 10.5px;
		font-weight: 700;
		color: #92400e;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 2px 0 2px;
	}
	.cp-sub {
		color: #92400e;
		font-weight: 500;
		font-size: 11px;
		padding-left: 8px;
		position: relative;
	}
	.cp-sub::before {
		content: '↳';
		position: absolute;
		left: -2px;
		color: #d97706;
		font-weight: 700;
	}
	.cp-total .cp-label,
	.cp-total .cp-val {
		font-weight: 700;
		color: #422006;
	}
	.cp-grand-total {
		margin-top: 4px;
		padding-top: 5px;
		border-top: 1.5px solid #ca8a04;
	}
	.cp-grand-total .cp-label,
	.cp-grand-total .cp-val {
		font-weight: 900;
		font-size: 12.5px;
		color: #14532d;
	}
	.cell-total.cell-total-auto {
		color: #94a3b8 !important;
		font-style: italic;
	}
	.excel-cell-input-readonly {
		background: #f1f5f9 !important;
		color: #64748b !important;
		font-weight: 700;
		cursor: not-allowed;
		border-color: #e2e8f0 !important;
	}
	.row-impuestos-base td {
		background: #fff1f2;
		color: #881337;
		font-style: italic;
		font-size: 11px;
	}
	.row-impuestos-base .cell-base {
		font-weight: 700;
		font-style: normal;
		color: #9f1239;
	}
	.row-conductor-header td {
		background: #f8fafc;
		color: #0f172a;
		border-top: 3px solid #e2e8f0;
		border-bottom-color: #e2e8f0;
	}

	.cell-section-label {
		font-weight: 700;
	}
	.cell-section-pct {
		text-align: center;
	}
	.pct-value {
		font-family: monospace;
		font-size: 12px;
		font-weight: 700;
		color: #ea580c;
		background: rgba(234, 88, 12, 0.08);
		padding: 2px 8px;
		border-radius: 6px;
	}
	.pct-value-seguridad-social {
		font-family: monospace;
		font-size: 12px;
		font-weight: 700;
		color: #1d4ed8;
		background: rgba(234, 88, 12, 0.08);
		padding: 2px 8px;
		border-radius: 6px;
	}
	.cell-section-total {
		text-align: right;
		font-family: monospace;
		font-size: 13px;
		font-weight: 800;
		color: #ea580c;
	}

	.row-concepto td {
		padding: 5px 10px;
		border-bottom: 1px solid #e2e8f0;
	}
	.row-concepto:hover td {
		background: #fafbfc;
	}
	.row-sub-concepto td {
		background: #fafbfc;
	}
	.row-sub-concepto:hover td {
		background: #f5f6f8;
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
		color: #ea580c;
		text-align: right;
		white-space: nowrap;
	}
	.cell-action-cell {
		width: 24px;
		min-width: 24px;
		max-width: 24px;
		text-align: center;
		padding: 4px 2px !important;
	}
	.cell-action-group {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
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

	.row-conductor-subheader td {
		background: #f1f5f9;
		color: #475569;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 6px 10px;
		border-bottom: 1px solid #cbd5e1;
	}
	.cell-subheader {
		color: #475569;
	}
	.cell-subheader-center {
		text-align: center;
	}
	.cell-subheader-right {
		text-align: right;
		min-width: 130px;
	}

	.row-conductor-total td {
		background: #f8fafc;
		padding: 6px 10px;
		border-top: 1px solid #e2e8f0;
		font-size: 11px;
		color: #475569;
	}
	.cell-tfoot-label {
		font-weight: 600;
		color: #334155;
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.04em;
	}
	.cell-tfoot-value {
		font-family: monospace;
		font-size: 12px;
		font-weight: 700;
		color: #0f172a;
		text-align: right;
	}
	.row-conductor-grand-total td {
		background: #f0fdf4;
		border-top: 2px solid #86efac;
		border-bottom: 2px solid #86efac;
		padding: 8px 10px;
	}
	.cell-tfoot-label-main {
		font-size: 12px;
		font-weight: 800;
		color: #065f46;
		letter-spacing: 0.06em;
	}
	.cell-tfoot-value-main {
		font-size: 16px;
		font-weight: 800;
		color: #047857;
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
		border-color: #ea580c;
		background: #fff;
		box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.15);
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
	.row-summary td {
		background: #f8fafc;
		padding: 8px 10px;
		font-size: 12px;
		color: #374151;
	}
	.cell-summary-red {
		color: #dc2626 !important;
	}
	.row-summary-main td {
		background: #f0fdf4;
		border-top: 2px solid #86efac;
	}
	.row-summary-main .cell-tfoot-value {
		font-size: 18px;
		font-weight: 800;
		color: #047857;
	}
	.row-summary-pagar td {
		background: #0f4025;
	}
	.row-summary-pagar .cell-tfoot-label-pagar {
		color: #fff !important;
		font-size: 14px;
		font-weight: 800;
		letter-spacing: 0.04em;
	}
	.row-summary-pagar .cell-tfoot-value-pagar {
		color: #bbf7d0 !important;
		font-size: 20px;
		font-weight: 800;
		font-family: monospace;
	}

	.row-excluded {
		background: #f5f5f5 !important;
		opacity: 0.55;
		text-decoration: line-through;
	}
	.row-excluded td {
		color: #94a3b8 !important;
	}
	.row-add-concept td {
		padding: 6px 10px;
		background: #fafbfc;
		border-bottom: 1px solid #e2e8f0;
	}
	.row-empty td {
		text-align: center;
		color: #94a3b8;
		font-style: italic;
		padding: 16px;
	}
	.row-items-totals td {
		background: #f0fdf4;
		border-top: 2px solid #86efac;
		font-weight: 700;
		font-size: 11px;
		color: #065f46;
		padding: 7px 8px;
	}
	.row-adicional td {
		background: #f7fdf9;
		color: #0f4025;
		font-weight: 600;
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
	.badge-nomina {
		display: inline-flex;
		align-items: center;
		padding: 2px 6px;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #1d4ed8;
		background: #dbeafe;
		border: 1px solid #bfdbfe;
		border-radius: 999px;
		margin-left: 8px;
	}
	.badge-cedula {
		display: inline-flex;
		align-items: center;
		padding: 2px 6px;
		font-size: 10px;
		font-weight: 600;
		font-family: monospace;
		color: #475569;
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		border-radius: 999px;
		margin-left: 6px;
	}

	.conductor-display-name {
		font-weight: 700;
		color: #0f172a;
	}
	.conductor-name-inline {
		padding: 3px 8px;
		border: 1px solid #e2e8f0;
		border-radius: 4px;
		font-size: 12px;
		color: #0f172a;
		width: 200px;
		outline: none;
	}
	.conductor-name-inline:focus {
		border-color: #ea580c;
		box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.15);
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
	.btn-exclude.excluded {
		background: #dcfce7;
		color: #16a34a;
	}
	.btn-exclude.excluded:hover {
		background: #bbf7d0;
	}
	.btn-remove-conductor-inline {
		background: none;
		border: none;
		color: #94a3b8;
		cursor: pointer;
		font-size: 14px;
		padding: 4px;
		margin-left: 8px;
	}
	.btn-remove-conductor-inline:hover {
		color: #dc2626;
	}
	.propietario-toggle {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-left: 12px;
		padding: 3px 9px;
		border-radius: 6px;
		background: #fef3c7;
		border: 1px solid #fcd34d;
		cursor: pointer;
		font-size: 11px;
		font-weight: 700;
		color: #92400e;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		user-select: none;
		transition: all 0.15s;
	}
	.propietario-toggle:hover {
		background: #fde68a;
	}
	.propietario-toggle input[type='checkbox'] {
		margin: 0;
		cursor: pointer;
		accent-color: #d97706;
	}
	.propietario-toggle:has(input:checked) {
		background: #fed7aa;
		border-color: #ea580c;
		color: #9a3412;
	}
	.propietario-toggle.propietario-auto {
		background: #ddd6fe;
		border-color: #7c3aed;
		color: #5b21b6;
	}
	.propietario-toggle.propietario-auto:has(input:checked) {
		background: #c4b5fd;
		border-color: #6d28d9;
		color: #4c1d95;
	}
	.propietario-origen {
		font-size: 9px;
		letter-spacing: 0.06em;
		opacity: 0.85;
		margin-left: 2px;
	}
	.spinner-sm {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
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

	/* ─── SELECCIÓN MÚLTIPLE DE CELDAS ────────────────────── */
	.excel-table .cell-num.cell-selected,
	.excel-table .cell-total.cell-selected,
	.excel-table .cell-base.cell-selected,
	.excel-table .cell-section-total.cell-selected,
	.excel-table .cell-section-pct.cell-selected,
	.excel-table .cell-tfoot-value.cell-selected,
	.excel-table .cell-summary-red.cell-selected {
		background: rgba(249, 115, 22, 0.18) !important;
		box-shadow: inset 0 0 0 1px #f97316;
		color: #047857 !important;
		position: relative;
		z-index: 1;
	}
	.excel-table input.cell-selected {
		background: rgba(249, 115, 22, 0.15) !important;
		box-shadow: inset 0 0 0 2px #f97316;
	}
	.excel-table tr:hover .cell-selected {
		background: rgba(249, 115, 22, 0.28) !important;
	}

	/* Cursor "cell" en celdas numéricas para indicar que se pueden arrastrar */
	.excel-table .cell-num,
	.excel-table .cell-total,
	.excel-table .cell-base,
	.excel-table .cell-section-total,
	.excel-table .cell-section-pct,
	.excel-table .cell-tfoot-value,
	.excel-table .cell-summary-red,
	.excel-table input.excel-cell-input-num,
	.excel-table input.excel-cell-input-dias,
	.excel-table input.excel-cell-input-pct {
		cursor: cell;
	}

	/* Deshabilitar selección de texto SOLO en celdas numéricas puras (sin input).
	   Los inputs mantienen su selección de texto nativa. */
	.excel-table .cell-num,
	.excel-table .cell-total,
	.excel-table .cell-base,
	.excel-table .cell-section-total,
	.excel-table .cell-section-pct,
	.excel-table .cell-tfoot-value,
	.excel-table .cell-summary-red {
		user-select: none;
		-webkit-user-select: none;
	}

	/* Mientras se arrastra para seleccionar, cursor cell en todo el body */
	.excel-grid-body.is-selecting,
	.excel-grid-body.is-selecting * {
		cursor: cell !important;
		user-select: none !important;
		-webkit-user-select: none !important;
	}

	.row-add-concept td {
		position: relative;
		z-index: 5;
	}
	.row-add-concept .cell-select-wrap {
		width: 100%;
	}
</style>
