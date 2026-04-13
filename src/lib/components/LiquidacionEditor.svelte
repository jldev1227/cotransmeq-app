<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { apiClient } from '$lib/api/apiClient';
	import { authStore } from '$lib/stores/auth';
	import {
		liquidacionesServiciosAPI,
		type LiquidacionServicio,
		type EstadoLiquidacionServicio,
		type TipoRecargo,
		type HistorialEstado
	} from '$lib/api/liquidaciones-servicios';
	import { tercerosAPI } from '$lib/api/terceros';
	import type { Vehiculo } from '$lib/types/nomina';

	// ─── PROPS ──────────────────────────────────────────────────
	export let editId: string | null = null;
	export let viewMode = false;

	const BACK_URL = '/dashboard/liquidaciones-servicios';
	const COMPANY_NAME = 'COTRANSMEQ S.A.S.';

	// ─── TYPES ──────────────────────────────────────────────────
	interface ClienteBasico { id: string; nit: string; nombre: string; tipo: string; }

	// ─── CONSTANTS ──────────────────────────────────────────────
	const MESES = [
		'ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
		'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'
	];
	const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 1 + i);
	const TIPOS = [
		'TRANSPORTE DE PERSONAL EN CAMIONETA',
		'TRANSPORTE DE PERSONAL EN BUSETA',
		'TRANSPORTE DE PERSONAL EN MICROBUS',
		'TRANSPORTE DE PERSONAL EN BUS',
		'TRANSPORTE ADICIONAL (HORA ADICIONAL)',
		'TRANSPORTE ADICIONAL (KM ADICIONAL)',
		'TRANSPORTE ADICIONAL (DISPONIBILIDAD)',
	];

	// ─── HELPERS ────────────────────────────────────────────────
	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency', currency: 'COP',
			minimumFractionDigits: 0, maximumFractionDigits: 0,
		}).format(parseFloat(String(v)) || 0);

	function fmtCOPInput(v: number | string): string {
		const n = parseFloat(String(v)) || 0;
		if (n === 0) return '';
		return '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
	}

	function fmtCOPDec(v: number | string): string {
		const n = parseFloat(String(v)) || 0;
		if (n === 0) return '';
		return '$ ' + new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
	}

	function parseCOPInput(s: string): number {
		const cleaned = s.replace(/[^0-9,.\-]/g, '').replace(/\./g, '').replace(',', '.');
		return parseFloat(cleaned) || 0;
	}

	const fmtD = (s: string) => {
		if (!s) return '';
		const [y, m, d] = s.split('-');
		return `${d.padStart(2,'0')}-${m.padStart(2,'0')}-${y}`;
	};

	let uid = 0;
	const newRow = () => ({
		id: ++uid, placa: '', placa_search: '', placa_dropdown: false, placa_highlight: 0,
		fecha_ini: '', fecha_fin: '',
		recorrido: '', tipo: TIPOS[0], cant: 1, vr_unit: 0, dcto: 0, planilla: '',
	});

	// ─── DATA CATALOGS ──────────────────────────────────────────
	let clientes: ClienteBasico[] = [];
	let vehiculos: Vehiculo[] = [];
	let tiposRecargo: TipoRecargo[] = [];

	// ─── EDITOR STATE ───────────────────────────────────────────
	let view: 'editor' | 'preview' = 'editor';
	let previewPage: 'liquidacion' | 'recargos' | 'liquidador' | 'terceros' = 'liquidacion';

	function setView(v: 'editor' | 'preview') {
		view = v;
		if (!editId) return;
		const url = new URL($page.url);
		if (v === 'preview') { url.searchParams.set('mode', 'view'); }
		else { url.searchParams.delete('mode'); }
		history.replaceState(history.state, '', url.toString());
	}

	let logoError = false;
	let saving = false;
	let saveError = '';
	let showSuccessAnim = false;
	let successMsg = '';
	let successSub = '';
	let editingId: string | null = null;
	let estadoSeleccionado: EstadoLiquidacionServicio = 'BORRADOR';
	let loadingLiq = !!editId;

	// ─── PRINT STATE ────────────────────────────────────────────
	let printModalOpen = false;
	let isPrinting = false;
	let printSheets = { liquidacion: true, recargos: true, liquidador: true, terceros: true };

	// ─── ZOOM STATE ─────────────────────────────────────────────
	let pdfZoom = (() => {
		if (typeof sessionStorage !== 'undefined') {
			const saved = sessionStorage.getItem('liq_pdf_zoom');
			if (saved) return parseFloat(saved) || 1;
		}
		return 1;
	})();
	$: if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('liq_pdf_zoom', String(pdfZoom));

	// ─── TRAZABILIDAD ───────────────────────────────────────────
	let liqEstado: EstadoLiquidacionServicio = 'BORRADOR';
	let liqFechaLiquidacion: string | null = null;
	let liqFechaAprobacion: string | null = null;
	let liqFechaFacturacion: string | null = null;
	let liqLiquidadoPor: { id: string; nombre: string; correo: string } | null = null;
	let liqAprobadoPor: { id: string; nombre: string; correo: string } | null = null;
	let historialModalOpen = false;
	let historialData: HistorialEstado[] = [];
	let historialLoading = false;
	let loadError = '';

	// Cliente searchable select
	let clienteSearch = '';
	let clienteDropdown = false;
	let clienteHighlight = 0;
	let selectedCliente: ClienteBasico | null = null;

	let hdr = {
		empresa: COMPANY_NAME,
		consecutivo: '',
		mes: MESES[new Date().getMonth()], anio: new Date().getFullYear(),
		operadora: 'PAREX', observaciones: '', osi: '',
	};

	let rows = [newRow()];

	let ext = {
		trans_adic: 0,
		pernote_unit: 0, pernote_cant: 0, iva_pct: 0,
	};

	// ─── AUTO-SAVE DRAFT ────────────────────────────────────────
	function getDraftKey(id?: string | null): string {
		return id ? `liq-svc-draft-${id}` : 'liq-svc-draft-new';
	}
	let draftTimer: ReturnType<typeof setTimeout> | null = null;
	let draftSavedAt = '';
	let draftPaused = false;
	let draftDirty = false;
	let lastDraftHash = '';
	let draftAutoRestored = false;

	function hashStr(s: string): string {
		let h = 5381;
		for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
		return h.toString(36);
	}

	function buildDraftPayload() {
		return {
			ts: Date.now(), editingId, estadoSeleccionado, selectedCliente, hdr,
			rows: rows.map(({ placa_dropdown, placa_highlight, placa_search, ...rest }) => rest),
			ext, recargosRows: recargosRows.map(({ id, ...rest }) => rest), terceroRows, liqCfg,
		};
	}

	function saveDraft() {
		if (draftPaused) return;
		try {
			const payload = buildDraftPayload();
			const json = JSON.stringify(payload);
			const h = hashStr(json);
			if (h === lastDraftHash) return;
			localStorage.setItem(getDraftKey(editingId), json);
			lastDraftHash = h; draftDirty = true;
			const d = new Date();
			draftSavedAt = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
		} catch { /* ignore */ }
	}

	function restoreDraft(forId?: string | null) {
		try {
			const raw = localStorage.getItem(getDraftKey(forId ?? editingId));
			if (!raw) return false;
			const d = JSON.parse(raw);
			draftPaused = true;
			editingId = d.editingId ?? null;
			estadoSeleccionado = d.estadoSeleccionado ?? 'BORRADOR';
			selectedCliente = d.selectedCliente ?? null;
			clienteSearch = '';
			hdr = { ...hdr, ...d.hdr };
			rows = (d.rows || [newRow()]).map((r: any) => ({ ...r, id: ++uid, placa_dropdown: false, placa_highlight: 0, placa_search: '' }));
			ext = { ...ext, ...d.ext };
			liqCfg = { ...liqCfg, ...d.liqCfg };
			recargosRows = (d.recargosRows || []).map((r: any) => ({ ...r, id: ++uid }));
			terceroRows = (d.terceroRows || []).map((t: any) => ({ ...t }));
			setView('editor');
			draftAutoRestored = true;
			lastDraftHash = hashStr(raw);
			setTimeout(() => { draftPaused = false; draftDirty = true; }, 300);
			return true;
		} catch { return false; }
	}

	function clearDraft(forId?: string | null) {
		try { localStorage.removeItem(getDraftKey(forId ?? editingId)); } catch {}
		draftSavedAt = ''; draftDirty = false; lastDraftHash = ''; draftAutoRestored = false;
	}

	function tryAutoRestoreDraft(forId?: string | null) {
		try {
			const raw = localStorage.getItem(getDraftKey(forId));
			if (!raw) return false;
			const d = JSON.parse(raw);
			const age = Date.now() - (d.ts || 0);
			if (age > 48 * 60 * 60 * 1000) { clearDraft(forId); return false; }
			const hasRows = d.rows && d.rows.length > 0 && d.rows.some((r: any) => r.placa);
			if (hasRows || d.selectedCliente) return restoreDraft(forId);
			clearDraft(forId); return false;
		} catch { clearDraft(forId); return false; }
	}

	function scheduleDraftSave() {
		if (draftPaused || view !== 'editor') return;
		if (draftTimer) clearTimeout(draftTimer);
		draftTimer = setTimeout(saveDraft, 2000);
	}

	$: if (view === 'editor' && !draftPaused) {
		void [hdr, rows, ext, recargosRows, terceroRows, liqCfg, selectedCliente, editingId, estadoSeleccionado];
		scheduleDraftSave();
	}

	function handleBeforeUnload(_e: BeforeUnloadEvent) { if (view === 'editor') saveDraft(); }

	// ─── PERMISSIONS ────────────────────────────────────────────
	$: isAdmin = $authStore.user?.rol === 'admin';
	$: canSeeTerceros = isAdmin;

	// ─── MOUNT ──────────────────────────────────────────────────
	onMount(async () => {
		window.addEventListener('beforeunload', handleBeforeUnload);
		await cargarCatalogos();
		if (editId) {
			loadingLiq = true;
			try {
				await cargarParaEditar(editId);
				tryAutoRestoreDraft(editId);
				if (viewMode || $page.url.searchParams.get('mode') === 'view') {
					previewPage = 'liquidacion'; setView('preview');
				}
			} catch (err: any) {
				loadError = err.message || 'No se pudo cargar la liquidación.';
			} finally { loadingLiq = false; }
		} else { tryAutoRestoreDraft(null); }
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') window.removeEventListener('beforeunload', handleBeforeUnload);
		if (draftTimer) clearTimeout(draftTimer);
	});

	async function cargarCatalogos() {
		try {
			const [clientesRes, vehiculosRes, tiposRes] = await Promise.all([
				apiClient.get<{ data: ClienteBasico[] }>('/api/empresas/basicos'),
				apiClient.get<{ data: Vehiculo[] }>('/api/vehiculos'),
				liquidacionesServiciosAPI.obtenerTiposRecargo(),
			]);
			clientes = clientesRes.data?.data || [];
			vehiculos = vehiculosRes.data?.data || [];
			tiposRecargo = tiposRes || [];
		} catch (e) { console.error('Error cargando catálogos', e); }

		// Cargar config del liquidador para defaults
		try {
			const cfg = await liquidacionesServiciosAPI.obtenerConfigLiquidador();
			if (cfg && !editId) {
				liqCfg = {
					salario_basico: cfg.salario_basico ?? liqCfg.salario_basico,
					cargo: cfg.cargo ?? liqCfg.cargo,
					conductor_adicional: cfg.conductor_adicional ?? liqCfg.conductor_adicional,
					prueba_covid: cfg.prueba_covid ?? liqCfg.prueba_covid,
					pct_seg_social: cfg.pct_seg_social ?? liqCfg.pct_seg_social,
					pct_prestaciones: cfg.pct_prestaciones ?? liqCfg.pct_prestaciones,
					pct_admin: cfg.pct_admin ?? liqCfg.pct_admin,
					valor_hora_override: cfg.valor_hora_override ?? liqCfg.valor_hora_override,
				};
			}
		} catch { /* usar defaults hardcoded si falla */ }
	}

	async function retryLoad() {
		if (!editId) return;
		loadError = ''; loadingLiq = true;
		try {
			await cargarCatalogos(); await cargarParaEditar(editId);
			tryAutoRestoreDraft(editId);
			if (viewMode || $page.url.searchParams.get('mode') === 'view') { previewPage = 'liquidacion'; setView('preview'); }
		} catch (err: any) { loadError = err.message || 'No se pudo cargar la liquidación.'; }
		finally { loadingLiq = false; }
	}

	// ─── HISTORIAL ──────────────────────────────────────────────
	async function abrirHistorial() {
		if (!editingId) return;
		historialModalOpen = true; historialLoading = true;
		try { historialData = await liquidacionesServiciosAPI.obtenerHistorial(editingId); }
		catch { historialData = []; }
		finally { historialLoading = false; }
	}

	function getEstadoBadge(estado: string) {
		const map: Record<string, { bg: string; text: string; label: string }> = {
			BORRADOR:  { bg: '#f1f5f9', text: '#64748b', label: 'Borrador' },
			LIQUIDADA: { bg: '#dbeafe', text: '#2563eb', label: 'Liquidada' },
			APROBADA:  { bg: '#fff7ed', text: '#ea580c', label: 'Aprobada' },
			FACTURADA: { bg: '#d1fae5', text: '#059669', label: 'Facturada' },
			ANULADA:   { bg: '#fee2e2', text: '#dc2626', label: 'Anulada' },
		};
		return map[estado] || map.BORRADOR;
	}

	function fmtFecha(s: string | null | undefined) {
		if (!s) return '—';
		return new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
			   new Date(s).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
	}

	// ─── EDIT MODE ──────────────────────────────────────────────
	function resetForm() {
		editingId = null; selectedCliente = null; clienteSearch = '';
		hdr = { empresa: COMPANY_NAME, consecutivo: '', mes: MESES[new Date().getMonth()], anio: new Date().getFullYear(), operadora: 'PAREX', observaciones: '', osi: '' };
		rows = [newRow()];
		ext = { trans_adic: 0, pernote_unit: 0, pernote_cant: 0, iva_pct: 0 };
		recargosRows = []; terceroRows = [];
		estadoSeleccionado = 'BORRADOR';
		liqCfg = { salario_basico: 2210776, cargo: 'Conductor', conductor_adicional: 73693, prueba_covid: 0, pct_seg_social: 22.96, pct_prestaciones: 21.83, pct_admin: 8, valor_hora_override: 0 };
		clearDraft(editId);
	}

	async function cargarParaEditar(id: string) {
		const liq = await liquidacionesServiciosAPI.obtenerPorId(id);
		editingId = liq.id;
		hdr.consecutivo = liq.consecutivo || '';
		hdr.mes = MESES[(liq.mes || 1) - 1] || MESES[0];
		hdr.anio = liq.anio || new Date().getFullYear();
		hdr.observaciones = liq.observaciones || '';
		hdr.osi = liq.osi || '';

		liqEstado = liq.estado || 'BORRADOR';
		liqFechaLiquidacion = liq.fecha_liquidacion || null;
		liqFechaAprobacion = liq.fecha_aprobacion || null;
		liqFechaFacturacion = liq.fecha_facturacion || null;
		liqLiquidadoPor = liq.liquidado_por || null;
		liqAprobadoPor = liq.aprobado_por || null;

		if (liq.cliente) {
			selectedCliente = { id: liq.cliente.id, nombre: liq.cliente.nombre, nit: liq.cliente.nit, tipo: '' };
		} else { selectedCliente = null; }
		clienteSearch = '';

		if (liq.items && liq.items.length > 0) {
			rows = liq.items.map((it: any) => ({
				id: ++uid, placa: it.placa || '', placa_search: '', placa_dropdown: false, placa_highlight: 0,
				fecha_ini: it.fecha_inicial ? it.fecha_inicial.split('T')[0] : '',
				fecha_fin: it.fecha_final ? it.fecha_final.split('T')[0] : '',
				recorrido: it.recorrido || '', tipo: TIPOS[0],
				cant: it.cantidad || 1, vr_unit: it.valor_unitario || 0,
				dcto: it.porcentaje_descuento || 0, planilla: it.numero_planilla || '',
			}));
		} else { rows = [newRow()]; }

		ext = { trans_adic: liq.valor_transporte_adicional || 0, pernote_unit: 0, pernote_cant: 0, iva_pct: liq.porcentaje_iva || 0 };
		const pernItem = liq.items?.find((it: any) => (it.cantidad_pernoctes || 0) > 0);
		if (pernItem) { ext.pernote_unit = pernItem.valor_pernocte_unitario || 0; ext.pernote_cant = pernItem.cantidad_pernoctes || 0; }

		if (liq.recargos_data) {
			const rd = liq.recargos_data as any;
			if (rd.rows && Array.isArray(rd.rows)) {
				recargosRows = rd.rows.map((r: any) => ({
					id: ++uid, empresa: r.empresa || '', planilla: r.planilla || '', placa: r.placa || '', conductor: r.conductor || '',
					days: Array.isArray(r.days) ? [...r.days] : Array(31).fill(0),
					total: r.total || 0, promedio: r.promedio || 0,
					hed: r.hed || 0, hen: r.hen || 0, hefd: r.hefd || 0, hefn: r.hefn || 0, rndf: r.rndf || 0, rn: r.rn || 0, rd: r.rd || 0,
				}));
				for (const row of recargosRows) recalcRecargoRow(row);
			}
			if (rd.liqCfg) {
				liqCfg = {
					salario_basico: rd.liqCfg.salario_basico ?? 2210776, cargo: rd.liqCfg.cargo ?? 'Conductor',
					conductor_adicional: rd.liqCfg.conductor_adicional ?? 73693, prueba_covid: rd.liqCfg.prueba_covid ?? 0,
					pct_seg_social: rd.liqCfg.pct_seg_social ?? 22.96, pct_prestaciones: rd.liqCfg.pct_prestaciones ?? 21.83,
					pct_admin: rd.liqCfg.pct_admin ?? 8, valor_hora_override: rd.liqCfg.valor_hora_override ?? 0,
				};
			}
			if (rd.terceroRows && Array.isArray(rd.terceroRows)) {
				terceroRows = rd.terceroRows.map((t: any, idx: number) => ({
					src_index: t.src_index ?? idx, placa: t.placa ?? (rows[idx]?.placa || ''),
					recorrido: t.recorrido ?? (rows[idx]?.recorrido || ''),
					nombre_tercero: t.nombre_tercero || '', tercero_id: t.tercero_id || '',
					tercero_identificacion: t.tercero_identificacion || '', tercero_tipo_persona: t.tercero_tipo_persona || '',
					fecha_ini: t.fecha_ini ?? (rows[idx]?.fecha_ini || ''), fecha_fin: t.fecha_fin ?? (rows[idx]?.fecha_fin || ''),
					vr_unit: t.vr_unit ?? (parseFloat(String(rows[idx]?.vr_unit)) || 0),
					cant: t.cant ?? (parseFloat(String(rows[idx]?.cant)) || 1),
					pct_admin: t.pct_admin ?? 10, ingreso_extra_global: t.ingreso_extra_global ?? 0, ingresos_extra_aval: t.ingresos_extra_aval ?? 0,
				}));
			}
		} else { recargosRows = []; terceroRows = []; }
		view = 'editor';
		draftPaused = true;
		lastDraftHash = hashStr(JSON.stringify(buildDraftPayload()));
		setTimeout(() => { draftPaused = false; }, 300);
	}

	// ─── CLIENTE SEARCHABLE SELECT ──────────────────────────────
	$: clientesFiltrados = clientes.filter(c => {
		if (!clienteSearch) return true;
		const q = clienteSearch.toLowerCase();
		return c.nombre.toLowerCase().includes(q) || (c.nit || '').toLowerCase().includes(q);
	});
	$: clienteSearch, clienteHighlight = 0;

	function selectCliente(c: ClienteBasico) { selectedCliente = c; clienteSearch = ''; clienteDropdown = false; }
	function clearCliente() { selectedCliente = null; clienteSearch = ''; }

	// ─── PLACA SEARCHABLE ───────────────────────────────────────
	function placasFiltradas(search: string) {
		if (!search) return vehiculos;
		const q = search.toLowerCase();
		return vehiculos.filter(v => v.placa.toLowerCase().includes(q) || (v.marca || '').toLowerCase().includes(q));
	}
	function selectPlaca(rowId: number, v: Vehiculo) { rows = rows.map(r => r.id === rowId ? { ...r, placa: v.placa, placa_search: '', placa_dropdown: false } : r); }
	function clearPlaca(rowId: number) { rows = rows.map(r => r.id === rowId ? { ...r, placa: '', placa_search: '' } : r); }

	// ─── ROW ACTIONS ────────────────────────────────────────────
	function addRow() { rows = [...rows, newRow()]; }
	function delRow(id: number) { rows = rows.filter(r => r.id !== id); }
	function updRow(id: number, k: string, v: any) { rows = rows.map(r => r.id === id ? { ...r, [k]: v } : r); }

	// ─── CALCULATIONS ───────────────────────────────────────────
	function calcRow(r: typeof rows[0]) {
		const sub = (parseFloat(String(r.cant)) || 0) * (parseFloat(String(r.vr_unit)) || 0);
		return { sub, vf: sub * (1 - (parseFloat(String(r.dcto)) || 0) / 100) };
	}

	$: totalSvc   = rows.reduce((a, r) => a + calcRow(r).vf, 0);
	$: valTransAd = parseFloat(String(ext.trans_adic)) || 0;
	$: valRec     = liqTotal;
	$: valPern    = (parseFloat(String(ext.pernote_unit)) || 0) * (parseFloat(String(ext.pernote_cant)) || 0);
	$: subtotal   = totalSvc + valTransAd + valRec + valPern;
	$: ivaVal     = subtotal * ((parseFloat(String(ext.iva_pct)) || 0) / 100);
	$: total      = subtotal + ivaVal;

	// ─── RECARGOS ───────────────────────────────────────────────
	interface RecargoRow {
		id: number; empresa: string; planilla: string; placa: string; conductor: string;
		days: number[]; total: number; promedio: number;
		hed: number; hen: number; hefd: number; hefn: number; rndf: number; rn: number; rd: number;
	}
	let recargosRows: RecargoRow[] = [];

	function newRecargoRow(): RecargoRow {
		return { id: ++uid, empresa: '', planilla: '', placa: '', conductor: '', days: Array(31).fill(0), total: 0, promedio: 0, hed: 0, hen: 0, hefd: 0, hefn: 0, rndf: 0, rn: 0, rd: 0 };
	}
	function addRecargoRow() { recargosRows = [...recargosRows, newRecargoRow()]; }
	function delRecargoRow(id: number) { recargosRows = recargosRows.filter(r => r.id !== id); }

	function recalcRecargoRow(row: RecargoRow) {
		row.total = row.days.slice(0, 31).reduce((s, v) => s + (v || 0), 0);
		const daysWithHours = row.days.slice(0, 31).filter(v => v > 0).length;
		row.promedio = daysWithHours > 0 ? row.total / daysWithHours : 0;
	}

	function updRecargoDay(rowId: number, dayIdx: number, val: string) {
		recargosRows = recargosRows.map(r => {
			if (r.id !== rowId) return r;
			const newDays = [...r.days]; newDays[dayIdx] = parseFloat(val.replace(',', '.')) || 0;
			const updated = { ...r, days: newDays }; recalcRecargoRow(updated); return updated;
		});
	}
	function updRecargoField(rowId: number, field: string, val: string) {
		recargosRows = recargosRows.map(r => {
			if (r.id !== rowId) return r;
			if (['hed','hen','hefd','hefn','rndf','rn','rd'].includes(field)) return { ...r, [field]: parseFloat(val.replace(',', '.')) || 0 };
			return { ...r, [field]: val };
		});
	}

	$: recargosTotals = (() => {
		const t = { days: Array(31).fill(0), total: 0, hed: 0, hen: 0, hefd: 0, hefn: 0, rndf: 0, rn: 0, rd: 0 };
		for (const r of recargosRows) {
			for (let i = 0; i < 31; i++) t.days[i] += r.days[i] || 0;
			t.total += r.total || 0;
			t.hed += r.hed || 0; t.hen += r.hen || 0; t.hefd += r.hefd || 0; t.hefn += r.hefn || 0; t.rndf += r.rndf || 0; t.rn += r.rn || 0; t.rd += r.rd || 0;
		}
		return t;
	})();

	// ─── LIQUIDADOR DE RECARGOS ─────────────────────────────────
	let liqCfg = {
		salario_basico: 2210776, cargo: 'Conductor', conductor_adicional: 73693, prueba_covid: 0,
		pct_seg_social: 22.96, pct_prestaciones: 21.83, pct_admin: 8, valor_hora_override: 0 as number,
	};

	$: valorHoraAuto = liqCfg.salario_basico > 0 ? liqCfg.salario_basico / 220 : 0;
	$: valorHora = liqCfg.valor_hora_override > 0 ? liqCfg.valor_hora_override : valorHoraAuto;

	function fmtDec1(n: number): string { return n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
	function fmtPlaca(p: string): string {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s || '—';
	}

	const codigoToField: Record<string, string> = { HED: 'hed', HEN: 'hen', HEFD: 'hefd', HEFN: 'hefn', RNDF: 'rndf', RN: 'rn', RD: 'rd' };
	const fallbackTipos = [
		{ codigo: 'HED', nombre: 'Hora Extra Diurna', porcentaje: 25, es_hora_extra: true, adicional: false },
		{ codigo: 'HEN', nombre: 'Hora Extra Nocturna', porcentaje: 75, es_hora_extra: true, adicional: false },
		{ codigo: 'RN', nombre: 'Recargo Nocturno', porcentaje: 35, es_hora_extra: false, adicional: false },
		{ codigo: 'HEFD', nombre: 'Hora Extra Festiva Diurna', porcentaje: 100, es_hora_extra: true, adicional: false },
		{ codigo: 'HEFN', nombre: 'Hora Extra Festiva Nocturna', porcentaje: 150, es_hora_extra: true, adicional: false },
		{ codigo: 'RNDF', nombre: 'Recargo Dom/Fest Nocturno', porcentaje: 110, es_hora_extra: false, adicional: true },
		{ codigo: 'RD', nombre: 'Recargo Dominical/Festivo', porcentaje: 75, es_hora_extra: false, adicional: true },
	];

	$: liqLineas = (() => {
		const vh = valorHora;
		const t = recargosTotals;
		const tipos = tiposRecargo.length > 0 ? tiposRecargo : fallbackTipos;
		const lineas: { desc: string; pct: string; vrUnit: number; horas: number; total: number }[] = [
			{ desc: 'CONDUCTOR ADICIONAL', pct: '', vrUnit: liqCfg.conductor_adicional, horas: 0, total: 0 },
		];
		for (const tipo of tipos) {
			const field = codigoToField[tipo.codigo];
			if (!field) continue;
			const horas = (t as any)[field] || 0;
			const pct = tipo.porcentaje;
			const vrUnit = (tipo.es_hora_extra || tipo.adicional) ? vh * (1 + pct / 100) : vh * (pct / 100);
			lineas.push({ desc: `${tipo.nombre.toUpperCase()} ${pct}%`, pct: `${pct}%`, vrUnit, horas, total: vrUnit * horas });
		}
		return lineas;
	})();

	$: liqSubtotal1 = liqLineas.reduce((s, l) => s + l.total, 0);
	$: liqSegSocial = liqSubtotal1 * (liqCfg.pct_seg_social / 100);
	$: liqPrestaciones = liqSubtotal1 * (liqCfg.pct_prestaciones / 100);
	$: liqSubtotal2 = liqSubtotal1 + liqSegSocial + liqPrestaciones;
	$: liqPruebaCovid = liqCfg.prueba_covid;
	$: liqAdmin = liqSubtotal2 * (liqCfg.pct_admin / 100);
	$: liqTotal = liqSubtotal2 + liqPruebaCovid + liqAdmin;

	// ─── TERCEROS ───────────────────────────────────────────────
	interface TerceroRow {
		src_index: number; placa: string; recorrido: string;
		nombre_tercero: string; tercero_id: string; tercero_identificacion: string; tercero_tipo_persona: string;
		fecha_ini: string; fecha_fin: string; vr_unit: number; cant: number;
		pct_admin: number; ingreso_extra_global: number; ingresos_extra_aval: number;
	}
	let terceroRows: TerceroRow[] = [];

	function syncTerceroRows() {
		while (terceroRows.length < rows.length) {
			const idx = terceroRows.length;
			const srcRow = rows[idx];
			terceroRows.push({
				src_index: idx, placa: srcRow?.placa || '', recorrido: srcRow?.recorrido || '',
				nombre_tercero: '', tercero_id: '', tercero_identificacion: '', tercero_tipo_persona: '',
				fecha_ini: srcRow?.fecha_ini || '', fecha_fin: srcRow?.fecha_fin || '',
				vr_unit: parseFloat(String(srcRow?.vr_unit)) || 0, cant: parseFloat(String(srcRow?.cant)) || 1,
				pct_admin: 10, ingreso_extra_global: 0, ingresos_extra_aval: 0,
			});
		}
		terceroRows = terceroRows;
	}
	$: rows.length, syncTerceroRows();

	function delTerceroRow(idx: number) { terceroRows = terceroRows.filter((_, i) => i !== idx); }
	function resetTerceroFromItems() {
		terceroRows = rows.map((r, i) => ({
			src_index: i, placa: r.placa || '', recorrido: r.recorrido || '',
			nombre_tercero: terceroRows[i]?.nombre_tercero || '', tercero_id: terceroRows[i]?.tercero_id || '',
			tercero_identificacion: terceroRows[i]?.tercero_identificacion || '', tercero_tipo_persona: terceroRows[i]?.tercero_tipo_persona || '',
			fecha_ini: r.fecha_ini || '', fecha_fin: r.fecha_fin || '',
			vr_unit: parseFloat(String(r.vr_unit)) || 0, cant: parseFloat(String(r.cant)) || 1,
			pct_admin: terceroRows[i]?.pct_admin ?? 10, ingreso_extra_global: 0, ingresos_extra_aval: terceroRows[i]?.ingresos_extra_aval ?? 0,
		}));
	}

	function getTerceroNombre(placa: string, idx: number): string {
		if (terceroRows[idx]?.nombre_tercero) return terceroRows[idx].nombre_tercero;
		const v = vehiculos.find(veh => veh.placa === placa) as any;
		return v?.propietario_nombre || '';
	}

	// ─── TERCERO SEARCHABLE SELECT ──────────────────────────────
	interface TerceroOption { id: string; nombre_completo: string; identificacion: string | null; tipo_persona: 'PERSONA' | 'EMPRESA'; }
	let terceroSearchIdx = -1;
	let terceroSearchText = '';
	let terceroResults: TerceroOption[] = [];
	let terceroSearching = false;
	let terceroSearchTimer: ReturnType<typeof setTimeout> | null = null;
	let terceroHighlight = 0;

	function openTerceroSearch(idx: number) { terceroSearchIdx = idx; terceroSearchText = ''; terceroResults = []; terceroHighlight = 0; }
	function closeTerceroSearch() { terceroSearchIdx = -1; terceroSearchText = ''; terceroResults = []; }

	function onTerceroInput(idx: number) {
		terceroSearchIdx = idx; terceroHighlight = 0;
		if (terceroSearchTimer) clearTimeout(terceroSearchTimer);
		if (terceroSearchText.length < 1) { terceroResults = []; return; }
		terceroSearchTimer = setTimeout(async () => {
			terceroSearching = true;
			try { terceroResults = await tercerosAPI.buscar(terceroSearchText); }
			catch { terceroResults = []; }
			finally { terceroSearching = false; }
		}, 250);
	}

	function selectTercero(idx: number, t: TerceroOption) {
		terceroRows[idx].tercero_id = t.id; terceroRows[idx].nombre_tercero = t.nombre_completo;
		terceroRows[idx].tercero_identificacion = t.identificacion || ''; terceroRows[idx].tercero_tipo_persona = t.tipo_persona || '';
		terceroRows = terceroRows; closeTerceroSearch();
	}
	function clearTercero(idx: number) {
		terceroRows[idx].tercero_id = ''; terceroRows[idx].nombre_tercero = '';
		terceroRows[idx].tercero_identificacion = ''; terceroRows[idx].tercero_tipo_persona = '';
		terceroRows = terceroRows;
	}

	$: terceroCalcs = terceroRows.map((t, _i) => {
		const vrUnit = parseFloat(String(t.vr_unit)) || 0;
		const cant = parseFloat(String(t.cant)) || 0;
		const totalRow = vrUnit * cant;
		const pctAdmin = t.pct_admin || 0;
		const admon = totalRow * (pctAdmin / 100);
		const vLiquidar = totalRow - admon;
		const srcRow = rows[t.src_index];
		const servicioVf = srcRow ? calcRow(srcRow).vf : 0;
		const extraGlobal = Math.max(servicioVf - totalRow, 0);
		const extraAval = t.ingresos_extra_aval || 0;
		const ingresoTransmeralda = extraGlobal - extraAval;
		return { totalRow, admon, vLiquidar, extraGlobal, extraAval, ingresoTransmeralda, pctAdmin };
	});

	$: tercTotalFacturado = terceroCalcs.reduce((s, c) => s + c.totalRow, 0);
	$: tercTotalAdmon = terceroCalcs.reduce((s, c) => s + c.admon, 0);
	$: tercTotalVLiquidar = terceroCalcs.reduce((s, c) => s + c.vLiquidar, 0);
	$: tercTotalExtraGlobal = terceroCalcs.reduce((s, c) => s + c.extraGlobal, 0);
	$: tercTotalExtraAval = terceroCalcs.reduce((s, c) => s + c.extraAval, 0);
	$: tercTotalIngresoTrans = terceroCalcs.reduce((s, c) => s + c.ingresoTransmeralda, 0);

	$: tercIngresoTotalTercero = tercTotalVLiquidar;
	$: tercAdminCotransmeq = tercTotalAdmon;
	$: tercIngresoExtraTrans = tercTotalIngresoTrans;
	$: tercValTransAdicional = valTransAd;
	$: tercAdminTransAdicional = valTransAd * ((terceroRows[0]?.pct_admin || 10) / 100);
	$: tercIngresoTotalCotransmeq = tercAdminCotransmeq + tercIngresoExtraTrans + tercValTransAdicional + tercAdminTransAdicional;
	$: tercValorTotalFacturar = tercIngresoTotalTercero + tercIngresoTotalCotransmeq;

	interface TerceroPlacaGroup { placa: string; nombre: string; identificacion: string; tipo: string; items: number; totalFacturado: number; vLiquidar: number; }
	$: terceroPlacasGroup = (() => {
		const map = new Map<string, TerceroPlacaGroup>();
		terceroRows.forEach((t, i) => {
			const key = t.placa || `sin-placa-${i}`;
			const calc = terceroCalcs[i];
			if (map.has(key)) {
				const g = map.get(key)!; g.items += 1; g.totalFacturado += calc?.totalRow || 0; g.vLiquidar += calc?.vLiquidar || 0;
			} else {
				map.set(key, { placa: t.placa, nombre: t.nombre_tercero || getTerceroNombre(t.placa, i) || '', identificacion: t.tercero_identificacion || '', tipo: t.tercero_tipo_persona || '', items: 1, totalFacturado: calc?.totalRow || 0, vLiquidar: calc?.vLiquidar || 0 });
			}
		});
		return Array.from(map.values());
	})();

	// Paste handler for recargos
	function handleRecargosPaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text/plain');
		if (!text) return;
		const lines = text.split('\n').filter(l => l.trim());
		if (lines.length === 0) return;
		const firstCols = lines[0].split('\t');
		if (firstCols.length < 10) return;
		e.preventDefault();
		const parsed: RecargoRow[] = [];
		for (const line of lines) {
			const cols = line.split('\t');
			if (cols.length < 10) continue;
			const row = newRecargoRow();
			row.empresa = cols[0]?.trim() || ''; row.planilla = cols[1]?.trim() || '';
			row.placa = cols[2]?.trim() || ''; row.conductor = cols[3]?.trim() || '';
			for (let i = 0; i < 31; i++) row.days[i] = parseFloat((cols[4 + i]?.trim() || '').replace(',', '.')) || 0;
			const off = 35;
			row.hed = parseFloat((cols[off+2]||'').replace(',','.')) || 0;
			row.hen = parseFloat((cols[off+3]||'').replace(',','.')) || 0;
			row.hefd = parseFloat((cols[off+4]||'').replace(',','.')) || 0;
			row.hefn = parseFloat((cols[off+5]||'').replace(',','.')) || 0;
			row.rndf = parseFloat((cols[off+6]||'').replace(',','.')) || 0;
			row.rn = parseFloat((cols[off+7]||'').replace(',','.')) || 0;
			row.rd = parseFloat((cols[off+8]||'').replace(',','.')) || 0;
			recalcRecargoRow(row); parsed.push(row);
		}
		if (parsed.length > 0) recargosRows = [...recargosRows, ...parsed];
	}

	// ─── REGISTRAR / ACTUALIZAR ─────────────────────────────────
	async function registrarLiquidacion() {
		saveError = ''; showSuccessAnim = false;
		if (!selectedCliente) { saveError = 'Selecciona un cliente'; return; }
		if (rows.length === 0) { saveError = 'Agrega al menos un ítem'; return; }
		if (rows.some(r => !r.placa)) { saveError = 'Selecciona la placa en todos los ítems'; return; }

		saving = true;
		try {
			const mesIdx = MESES.indexOf(hdr.mes) + 1;
			const payload = {
				cliente_id: selectedCliente.id, consecutivo: hdr.consecutivo || undefined,
				mes: mesIdx, anio: hdr.anio,
				items: rows.map((r, idx) => {
					const { sub, vf } = calcRow(r);
					return {
						placa: r.placa,
						fecha_inicial: r.fecha_ini || `${hdr.anio}-${String(mesIdx).padStart(2, '0')}-01`,
						fecha_final: r.fecha_fin || `${hdr.anio}-${String(mesIdx).padStart(2, '0')}-01`,
						recorrido: r.recorrido || 'N/A', tipo_servicio: 'HORA_24' as const,
						cantidad: parseFloat(String(r.cant)) || 1, valor_unitario: parseFloat(String(r.vr_unit)) || 0,
						porcentaje_descuento: parseFloat(String(r.dcto)) || 0,
						numero_planilla: r.planilla || undefined,
						cantidad_pernoctes: 0, valor_pernocte_unitario: 0,
						tercero_id: terceroRows[idx]?.tercero_id || null,
					};
				}),
				porcentaje_iva: parseFloat(String(ext.iva_pct)) || 0,
				observaciones: hdr.observaciones || undefined, osi: hdr.osi || undefined,
				valor_transporte_adicional: valTransAd, valor_recargos: valRec,
				recargos_data: { rows: recargosRows, liqCfg, terceroRows },
			};

			if (editingId) {
				await liquidacionesServiciosAPI.actualizar(editingId, payload);
				clearDraft(); successMsg = '¡Liquidación actualizada!'; successSub = 'Los cambios se guardaron correctamente';
			} else {
				await liquidacionesServiciosAPI.crear(payload);
				clearDraft(); successMsg = '¡Liquidación creada!'; successSub = 'Se registró correctamente en el sistema';
			}
			showSuccessAnim = true;
			setTimeout(() => { showSuccessAnim = false; goto(BACK_URL); }, 2200);
		} catch (err: any) { saveError = err.message || 'Error al registrar'; }
		finally { saving = false; }
	}

	function handlePrint() {
		printSheets = { liquidacion: true, recargos: true, liquidador: true, terceros: canSeeTerceros };
		printModalOpen = true;
	}
	function executePrint() {
		printModalOpen = false; isPrinting = true;
		setTimeout(() => { window.print(); setTimeout(() => { isPrinting = false; }, 300); }, 150);
	}
	function toggleAllSheets(checked: boolean) {
		printSheets = { liquidacion: checked, recargos: checked, liquidador: checked, terceros: canSeeTerceros ? checked : false };
	}
	$: printSheetCount = [printSheets.liquidacion, printSheets.recargos, printSheets.liquidador, printSheets.terceros].filter(Boolean).length;

	function handleCancel() { clearDraft(editId); goto(BACK_URL); }
</script>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- TEMPLATE                                                     -->
<!-- ═══════════════════════════════════════════════════════════ -->
{#if loadingLiq}
<div class="page-wrap">
	<div class="topbar"><div class="topbar-l"><img src="/assets/logo.png" alt="Logo" class="t-logo" on:error={() => logoError = true} style={logoError ? 'display:none' : ''} /><div><div class="t-title">⏳ Cargando Liquidación — OP-FR-07</div><div class="t-sub">Gestión y vista previa de liquidaciones de servicios</div></div></div><div style="display:flex;gap:10px"><button class="btn-back" on:click={() => goto(BACK_URL)}>← Volver</button></div></div>
	<div class="loading-center"><div class="spinner"></div><span style="margin-top:12px;color:#64748b;font-size:13px">Cargando liquidación…</span></div>
</div>
{:else if loadError}
<div class="page-wrap">
	<div class="topbar"><div class="topbar-l"><img src="/assets/logo.png" alt="Logo" class="t-logo" on:error={() => logoError = true} style={logoError ? 'display:none' : ''} /><div><div class="t-title">⚠️ Error al cargar — OP-FR-07</div><div class="t-sub">Gestión y vista previa de liquidaciones de servicios</div></div></div><div style="display:flex;gap:10px"><button class="btn-back" on:click={() => goto(BACK_URL)}>← Volver</button></div></div>
	<div class="error-fallback"><div style="font-size:64px;margin-bottom:16px">😵</div><div style="font-size:20px;font-weight:800;color:#1e293b;margin-bottom:8px">No se pudo cargar la liquidación</div><div style="font-size:14px;color:#dc2626;font-weight:600;margin-bottom:8px;padding:10px 20px;background:#fef2f2;border:1px solid #fca5a5;border-radius:10px">{loadError}</div><div style="display:flex;gap:12px;margin-top:24px"><button class="btn-registrar" style="width:auto;margin:0" on:click={retryLoad}>🔄 Reintentar</button><button class="btn-back" on:click={() => goto(BACK_URL)}>← Volver</button></div></div>
</div>
{:else if view === 'editor'}
<div class="page-wrap">
	<!-- TOP BAR -->
	<div class="topbar">
		<div class="topbar-l">
			<img src="/assets/logo.png" alt="Logo" class="t-logo" on:error={() => logoError = true} style={logoError ? 'display:none' : ''} />
			<div><div class="t-title">{editingId ? '✏️ Editar Liquidación' : '📋 Nueva Liquidación'} — OP-FR-07</div><div class="t-sub">Gestión y vista previa de liquidaciones de servicios</div></div>
		</div>
		<div style="display:flex;gap:10px;align-items:center">
			<button class="btn-back" on:click={handleCancel}>← Volver al Listado</button>
			<button class="btn-hdr" on:click={() => { previewPage = 'liquidacion'; setView('preview'); }}>👁 Ver →</button>
		</div>
	</div>

	<!-- AUTOSAVE INDICATOR -->
	<div class="draft-pill">💾 Autoguardado habilitado{draftSavedAt ? ` · último: ${draftSavedAt}` : ''}{#if draftAutoRestored}<span class="draft-restored">♻️ Cambios restaurados</span>{/if}</div>

	<!-- ENCABEZADO -->
	<div class="card">
		<div class="ch">{editingId ? '✏️ Editar Liquidación' : '📋 Encabezado del Documento'}</div>
		<div class="g3" style="margin-bottom:13px">
			<div style="grid-column:span 2"><label>Empresa Emisora</label><input bind:value={hdr.empresa} /></div>
			<div><label>Consecutivo</label><input bind:value={hdr.consecutivo} placeholder="ej. LS-2025-0001" style="font-family:monospace;font-weight:800;font-size:14px" /></div>
		</div>
		<div class="g4">
			<div><label>Mes</label><select bind:value={hdr.mes}>{#each MESES as m}<option>{m}</option>{/each}</select></div>
			<div><label>Año</label><select bind:value={hdr.anio}>{#each YEARS as y}<option value={y}>{y}</option>{/each}</select></div>
			<div>
				<label>Cliente / Empresa</label>
				<div class="ss-wrap">
					{#if selectedCliente}
						<div class="ss-selected"><span>{selectedCliente.nombre}</span><span class="ss-nit">NIT: {selectedCliente.nit}</span><button class="ss-clear" on:click={clearCliente}>✕</button></div>
					{:else}
						<input placeholder="Buscar cliente..." bind:value={clienteSearch} on:focus={() => (clienteDropdown = true)} on:input={() => { clienteDropdown = true; clienteHighlight = 0; }}
							on:keydown={e => {
								if (!clienteDropdown || clientesFiltrados.length === 0) return;
								if (e.key === 'ArrowDown') { e.preventDefault(); clienteHighlight = Math.min(clienteHighlight + 1, clientesFiltrados.length - 1); }
								else if (e.key === 'ArrowUp') { e.preventDefault(); clienteHighlight = Math.max(clienteHighlight - 1, 0); }
								else if (e.key === 'Enter') { e.preventDefault(); selectCliente(clientesFiltrados[clienteHighlight]); }
								else if (e.key === 'Escape') { clienteDropdown = false; }
							}} />
						{#if clienteDropdown && clienteSearch.length > 0}
							<div class="ss-dropdown">{#if clientesFiltrados.length === 0}<div class="ss-empty">Sin resultados</div>{:else}{#each clientesFiltrados as c, ci}<div class="ss-option" class:highlighted={ci === clienteHighlight} on:click={() => selectCliente(c)} on:mouseenter={() => (clienteHighlight = ci)} role="option" aria-selected={ci === clienteHighlight} tabindex="-1"><span class="ss-opt-name">{c.nombre}</span><span class="ss-opt-nit">NIT: {c.nit}</span></div>{/each}{/if}</div>
						{/if}
					{/if}
				</div>
			</div>
			<div><label>NIT (auto)</label><input value={selectedCliente ? selectedCliente.nit : ''} disabled style="background:#f1f5f9;font-weight:700;color:{selectedCliente ? '#9a3412' : '#94a3b8'}" /></div>
		</div>
		<div class="g2" style="margin-top:13px">
			<div><label>Operadora</label><select bind:value={hdr.operadora}><option>PAREX</option><option>GEOPARK</option><option>OTRA</option></select></div>
			<div><label>Orden de Servicio (OSI)</label><input bind:value={hdr.osi} placeholder="OSI-####" style="font-family:monospace;font-weight:700;text-transform:uppercase" /></div>
		</div>
		<div style="margin-top:10px"><label>Observaciones del Documento</label><input bind:value={hdr.observaciones} placeholder="Observaciones para el documento..." /></div>
	</div>

	<!-- ÍTEMS -->
	<div class="card">
		<div class="ch">📊 Ítems de Servicio</div>
		<div class="tbl-s">
			<table class="tbl">
				<thead><tr><th style="width:80px">Placa</th><th style="width:108px">F. Inicial</th><th style="width:108px">F. Final</th><th>Recorrido</th><th style="width:195px">Tipo</th><th style="width:58px">Cant.</th><th style="width:112px">Vr. Unitario</th><th style="width:110px">Subtotal</th><th style="width:64px">Dcto%</th><th style="width:112px">Vr. Final</th><th style="width:86px">Planilla</th><th style="width:34px"></th></tr></thead>
				<tbody>
					{#each rows as row (row.id)}
						{@const { sub, vf } = calcRow(row)}
						<tr>
							<td>
								<div class="ss-wrap">
									{#if row.placa}
										<div class="ss-selected" style="padding:4px 8px;font-size:11px"><span style="font-family:monospace;font-weight:800">{row.placa}</span><button class="ss-clear" style="font-size:12px" on:click={() => clearPlaca(row.id)}>✕</button></div>
									{:else}
										<input style="font-family:monospace;font-weight:700;font-size:11px;text-transform:uppercase;padding:5px 6px" placeholder="placa..." bind:value={row.placa_search} on:focus={() => { row.placa_dropdown = true; }} on:input={() => { row.placa_dropdown = true; row.placa_highlight = 0; }}
											on:keydown={e => {
												const list = placasFiltradas(row.placa_search);
												if (!row.placa_dropdown || list.length === 0) return;
												if (e.key === 'ArrowDown') { e.preventDefault(); row.placa_highlight = Math.min((row.placa_highlight ?? 0) + 1, list.length - 1); }
												else if (e.key === 'ArrowUp') { e.preventDefault(); row.placa_highlight = Math.max((row.placa_highlight ?? 0) - 1, 0); }
												else if (e.key === 'Enter') { e.preventDefault(); selectPlaca(row.id, list[row.placa_highlight ?? 0]); }
												else if (e.key === 'Escape') { row.placa_dropdown = false; }
											}} />
										{#if row.placa_dropdown && row.placa_search.length > 0}
											<div class="ss-dropdown" style="min-width:160px">{#each placasFiltradas(row.placa_search) as v, vi}<div class="ss-option" class:highlighted={vi === row.placa_highlight} on:click={() => selectPlaca(row.id, v)} on:mouseenter={() => { row.placa_highlight = vi; }} role="option" aria-selected={vi === row.placa_highlight} tabindex="-1"><span class="ss-opt-placa">{v.placa}</span><span class="ss-opt-info">{v.tipo || ''} {v.marca || ''}</span></div>{:else}<div class="ss-empty">Sin resultados</div>{/each}</div>
										{/if}
									{/if}
								</div>
							</td>
							<td><input type="date" style="font-size:11px;padding:5px 6px" bind:value={row.fecha_ini} /></td>
							<td><input type="date" style="font-size:11px;padding:5px 6px" bind:value={row.fecha_fin} /></td>
							<td><input style="font-size:11px;padding:5px 6px" placeholder="Ruta / descripción" bind:value={row.recorrido} /></td>
							<td><select style="font-size:11px;padding:5px 6px" bind:value={row.tipo}>{#each TIPOS as t}<option>{t}</option>{/each}</select></td>
							<td><input type="number" style="padding:5px 5px;font-size:12px" bind:value={row.cant} /></td>
							<td><input type="text" inputmode="numeric" style="padding:5px 6px;font-size:12px;text-align:right;font-family:monospace" value={fmtCOPInput(row.vr_unit)} on:focus={e => { e.currentTarget.value = String(row.vr_unit || ''); e.currentTarget.select(); }} on:blur={e => { const v = parseCOPInput(e.currentTarget.value); updRow(row.id, 'vr_unit', v); e.currentTarget.value = fmtCOPInput(v); }} /></td>
							<td class="calc">{COP(sub)}</td>
							<td><input type="number" style="padding:5px 5px;font-size:12px" min="0" max="100" bind:value={row.dcto} /></td>
							<td class="calc-g">{COP(vf)}</td>
							<td><input style="font-size:11px;padding:5px 6px" placeholder="TM-xxxx" bind:value={row.planilla} /></td>
							<td>{#if rows.length > 1}<button class="delbtn" on:click={() => delRow(row.id)}>✕</button>{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<button class="addbtn" on:click={addRow}>＋ Agregar fila</button>
	</div>

	<!-- RECARGOS -->
	<div class="card">
		<div class="ch">📊 Recargos <span class="badge-sm">{recargosRows.length}</span></div>
		<p class="paste-hint">Pega filas copiadas (Ctrl+V / ⌘V) o ingresa manualmente.</p>
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="recargos-scroll" on:paste={handleRecargosPaste}>
			<table class="rtbl">
				<thead><tr><th class="sticky-col rcol-act">✕</th><th class="sticky-col rcol-emp">Empresa</th><th class="rcol-plan">Planilla</th><th class="rcol-plac">Placa</th><th class="rcol-cond">Conductor</th>{#each Array(31) as _, i}<th class="rcol-day">{i + 1}</th>{/each}<th class="rcol-tot">Total</th><th class="rcol-tot">Prom</th><th class="rcol-rec">HED</th><th class="rcol-rec">HEN</th><th class="rcol-rec">HEFD</th><th class="rcol-rec">HEFN</th><th class="rcol-rec">RNDF</th><th class="rcol-rec">RN</th><th class="rcol-rec">RD</th></tr></thead>
				<tbody>
					{#each recargosRows as row (row.id)}
						<tr>
							<td class="sticky-col rcol-act"><button class="delbtn" on:click={() => delRecargoRow(row.id)}>✕</button></td>
							<td class="sticky-col rcol-emp"><input type="text" value={row.empresa} on:input={e => updRecargoField(row.id, 'empresa', e.currentTarget.value)} /></td>
							<td class="rcol-plan"><input type="text" value={row.planilla} on:input={e => updRecargoField(row.id, 'planilla', e.currentTarget.value)} /></td>
							<td class="rcol-plac"><input type="text" value={row.placa} on:input={e => updRecargoField(row.id, 'placa', e.currentTarget.value)} /></td>
							<td class="rcol-cond"><input type="text" value={row.conductor} on:input={e => updRecargoField(row.id, 'conductor', e.currentTarget.value)} /></td>
							{#each Array(31) as _, i}<td class="rcol-day"><input type="number" step="0.5" value={row.days[i] || ''} on:input={e => updRecargoDay(row.id, i, e.currentTarget.value)} /></td>{/each}
							<td class="rcol-tot mono">{row.total.toFixed(1)}</td><td class="rcol-tot mono">{row.promedio.toFixed(1)}</td>
							<td class="rcol-rec"><input type="number" step="0.01" value={row.hed || ''} on:input={e => updRecargoField(row.id, 'hed', e.currentTarget.value)} /></td>
							<td class="rcol-rec"><input type="number" step="0.01" value={row.hen || ''} on:input={e => updRecargoField(row.id, 'hen', e.currentTarget.value)} /></td>
							<td class="rcol-rec"><input type="number" step="0.01" value={row.hefd || ''} on:input={e => updRecargoField(row.id, 'hefd', e.currentTarget.value)} /></td>
							<td class="rcol-rec"><input type="number" step="0.01" value={row.hefn || ''} on:input={e => updRecargoField(row.id, 'hefn', e.currentTarget.value)} /></td>
							<td class="rcol-rec"><input type="number" step="0.01" value={row.rndf || ''} on:input={e => updRecargoField(row.id, 'rndf', e.currentTarget.value)} /></td>
							<td class="rcol-rec"><input type="number" step="0.01" value={row.rn || ''} on:input={e => updRecargoField(row.id, 'rn', e.currentTarget.value)} /></td>
							<td class="rcol-rec"><input type="number" step="0.01" value={row.rd || ''} on:input={e => updRecargoField(row.id, 'rd', e.currentTarget.value)} /></td>
						</tr>
					{/each}
					{#if recargosRows.length === 0}<tr><td colspan="{5 + 31 + 9}" class="empty-rec">Sin recargos. Pega datos o agrega filas manualmente.</td></tr>{/if}
					{#if recargosRows.length > 0}
						<tr class="totals-row"><td class="sticky-col"></td><td class="sticky-col"><b>TOTALES</b></td><td></td><td></td><td></td>{#each Array(31) as _, i}<td class="rcol-day mono">{recargosTotals.days[i].toFixed(1)}</td>{/each}<td class="rcol-tot mono"><b>{recargosTotals.total.toFixed(1)}</b></td><td></td><td class="mono">{recargosTotals.hed.toFixed(2)}</td><td class="mono">{recargosTotals.hen.toFixed(2)}</td><td class="mono">{recargosTotals.hefd.toFixed(2)}</td><td class="mono">{recargosTotals.hefn.toFixed(2)}</td><td class="mono">{recargosTotals.rndf.toFixed(2)}</td><td class="mono">{recargosTotals.rn.toFixed(2)}</td><td class="mono">{recargosTotals.rd.toFixed(2)}</td></tr>
					{/if}
				</tbody>
			</table>
		</div>
		<button class="addbtn" on:click={addRecargoRow}>＋ Agregar fila de recargo</button>
	</div>

	<!-- LIQUIDADOR CONFIG -->
	{#if recargosRows.length > 0}
	<div class="card">
		<div class="ch">💵 Configuración Liquidador de Recargos</div>
		<div class="liq-cfg-grid">
			<div class="liq-cfg-item"><label>Salario Básico ($)</label><input type="text" inputmode="numeric" value={fmtCOPInput(liqCfg.salario_basico)} on:focus={e => { e.currentTarget.value = String(liqCfg.salario_basico || ''); e.currentTarget.select(); }} on:blur={e => { liqCfg.salario_basico = parseCOPInput(e.currentTarget.value); liqCfg = liqCfg; e.currentTarget.value = fmtCOPInput(liqCfg.salario_basico); }} /></div>
			<div class="liq-cfg-item"><label>Cargo</label><input type="text" bind:value={liqCfg.cargo} /></div>
			<div class="liq-cfg-item"><label>Valor Hora ($){liqCfg.valor_hora_override > 0 ? ' ✏️' : ' (auto)'}</label><input type="text" inputmode="decimal" value={fmtCOPDec(liqCfg.valor_hora_override > 0 ? liqCfg.valor_hora_override : Math.round(valorHoraAuto * 10) / 10)} on:focus={e => { e.currentTarget.value = String(liqCfg.valor_hora_override > 0 ? liqCfg.valor_hora_override : Math.round(valorHoraAuto * 10) / 10); e.currentTarget.select(); }} on:blur={e => { const v = parseCOPInput(e.currentTarget.value); const auto = Math.round(valorHoraAuto * 10) / 10; liqCfg.valor_hora_override = (v !== auto && v > 0) ? v : 0; liqCfg = liqCfg; }} /></div>
			<div class="liq-cfg-item"><label>Conductor Adicional ($)</label><input type="text" inputmode="numeric" value={fmtCOPInput(liqCfg.conductor_adicional)} on:focus={e => { e.currentTarget.value = String(liqCfg.conductor_adicional || ''); e.currentTarget.select(); }} on:blur={e => { liqCfg.conductor_adicional = parseCOPInput(e.currentTarget.value); liqCfg = liqCfg; e.currentTarget.value = fmtCOPInput(liqCfg.conductor_adicional); }} /></div>
			<div class="liq-cfg-item"><label>Seg. Social %</label><input type="number" step="0.01" bind:value={liqCfg.pct_seg_social} /></div>
			<div class="liq-cfg-item"><label>Prestaciones %</label><input type="number" step="0.01" bind:value={liqCfg.pct_prestaciones} /></div>
			<div class="liq-cfg-item"><label>Administración %</label><input type="number" step="0.01" bind:value={liqCfg.pct_admin} /></div>
			<div class="liq-cfg-item"><label>Prueba COVID ($)</label><input type="text" inputmode="numeric" value={fmtCOPInput(liqCfg.prueba_covid)} on:focus={e => { e.currentTarget.value = String(liqCfg.prueba_covid || ''); e.currentTarget.select(); }} on:blur={e => { liqCfg.prueba_covid = parseCOPInput(e.currentTarget.value); liqCfg = liqCfg; e.currentTarget.value = fmtCOPInput(liqCfg.prueba_covid); }} /></div>
		</div>
		<div class="liq-summary">
			<span>Subtotal 1: <b>{fmtDec1(liqSubtotal1)}</b></span><span>Seg. Social: <b>{fmtDec1(liqSegSocial)}</b></span>
			<span>Prestaciones: <b>{fmtDec1(liqPrestaciones)}</b></span><span>Admin: <b>{fmtDec1(liqAdmin)}</b></span>
			<span class="liq-total-badge">TOTAL: <b>{fmtDec1(liqTotal)}</b></span>
		</div>
	</div>
	{/if}

	<!-- VALORES ADICIONALES + RESUMEN -->
	<div class="tw">
		<div class="card">
			<div class="ch">💰 Valores Adicionales</div>
			<div style="display:flex;flex-direction:column;gap:12px">
				<div><label>Transporte Adicional</label><input type="text" inputmode="numeric" value={fmtCOPInput(ext.trans_adic)} on:focus={e => { e.currentTarget.value = String(ext.trans_adic || ''); e.currentTarget.select(); }} on:blur={e => { ext.trans_adic = parseCOPInput(e.currentTarget.value); ext = ext; e.currentTarget.value = fmtCOPInput(ext.trans_adic); }} /></div>
				<div class="g2"><div><label>Pernocte — Valor Unitario</label><input type="text" inputmode="numeric" value={fmtCOPInput(ext.pernote_unit)} on:focus={e => { e.currentTarget.value = String(ext.pernote_unit || ''); e.currentTarget.select(); }} on:blur={e => { ext.pernote_unit = parseCOPInput(e.currentTarget.value); ext = ext; e.currentTarget.value = fmtCOPInput(ext.pernote_unit); }} /></div><div><label>Pernocte — Cantidad</label><input type="number" bind:value={ext.pernote_cant} min="0" /></div></div>
				<div style="width:140px"><label>IVA %</label><input type="number" bind:value={ext.iva_pct} min="0" max="100" /></div>
			</div>
		</div>
		<div class="card">
			<div class="ch">📈 Resumen Liquidación</div>
			<div style="padding:2px 0">
				<div class="sl"><span>Valor Total Servicios sin Recargos</span><strong style="color:#9a3412">{COP(totalSvc)}</strong></div>
				<div class="sl"><span style="color:#64748b;font-size:12px">Transporte Adicional</span><strong style="color:#2563eb">{COP(valTransAd)}</strong></div>
				<div class="sl"><span>Valor Total Recargos</span><strong style="color:#2563eb">{COP(valRec)}</strong></div>
				<div class="sl"><span>Pernote ({ext.pernote_cant} noche{ext.pernote_cant !== 1 ? 's' : ''})</span><strong style="color:#7c3aed">{COP(valPern)}</strong></div>
				<div class="sl" style="border-top:2px solid #e2e8f0;margin-top:6px;padding-top:10px"><span>Subtotal</span><strong>{COP(subtotal)}</strong></div>
				<div class="sl"><span style="color:#64748b">IVA {ext.iva_pct}%</span><span>{COP(ivaVal)}</span></div>
				<div class="stotal"><span>TOTAL SERVICIO</span><span>{COP(total)}</span></div>
			</div>
		</div>
	</div>

	<!-- TERCEROS EDITOR -->
	{#if canSeeTerceros && rows.length > 0}
	<div class="card" style="margin-top:18px">
		<div class="ch" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px"><span>👥 Liquidación de Terceros</span><button class="btn-sync-terc" on:click={resetTerceroFromItems}>🔄 Sincronizar desde Servicios</button></div>
		<div class="tbl-s">
			<table class="tbl terc-tbl">
				<thead><tr><th style="width:36px">#</th><th style="width:80px">Placa</th><th style="min-width:170px">Nombre 3°</th><th style="min-width:140px">Descripción</th><th style="width:108px">F. Ini</th><th style="width:108px">F. Fin</th><th style="width:112px">V/Unidad</th><th style="width:64px">Cant.</th><th style="width:112px">Total Fact.</th><th style="width:64px">Admin%</th><th style="width:112px">Admon$</th><th style="width:112px">V/Liquidar</th><th style="width:112px">Ing.Extra Glob.</th><th style="width:112px">Ing.Extra Aval</th><th style="width:112px">Ing. Cotransmeq</th><th style="width:40px"></th></tr></thead>
				<tbody>
					{#each terceroRows as t, i}
						{@const calc = terceroCalcs[i]}
						<tr>
							<td style="text-align:center;color:#94a3b8;font-size:11px">{i+1}</td>
							<td style="font-family:monospace;font-weight:800;font-size:11px;color:#9a3412">{t.placa || '—'}</td>
							<td>
								<div class="ss-wrap terc-ss">
									{#if t.tercero_id && t.nombre_tercero}
										<div class="ss-selected" style="padding:4px 8px;font-size:11px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{t.nombre_tercero}</span><button class="ss-clear" on:click={() => clearTercero(i)} style="font-size:11px;padding:0 3px">✕</button></div>
									{:else}
										<input type="text" placeholder={getTerceroNombre(t.placa, i) || 'Buscar tercero...'} value={terceroSearchIdx === i ? terceroSearchText : ''} on:focus={() => openTerceroSearch(i)} on:blur={() => setTimeout(() => { if (terceroSearchIdx === i) closeTerceroSearch(); }, 200)} on:input={e => { terceroSearchText = e.currentTarget.value; onTerceroInput(i); }}
											on:keydown={e => {
												if (terceroSearchIdx !== i || terceroResults.length === 0) return;
												if (e.key === 'ArrowDown') { e.preventDefault(); terceroHighlight = Math.min(terceroHighlight + 1, terceroResults.length - 1); }
												else if (e.key === 'ArrowUp') { e.preventDefault(); terceroHighlight = Math.max(terceroHighlight - 1, 0); }
												else if (e.key === 'Enter') { e.preventDefault(); selectTercero(i, terceroResults[terceroHighlight]); }
												else if (e.key === 'Escape') { closeTerceroSearch(); }
											}} style="font-size:11px;padding:5px 6px" />
										{#if terceroSearchIdx === i && (terceroResults.length > 0 || terceroSearching || terceroSearchText.length > 0)}
											<div class="ss-dropdown" style="font-size:11px">{#if terceroSearching}<div class="ss-empty">Buscando...</div>{:else if terceroResults.length === 0 && terceroSearchText.length > 0}<div class="ss-empty">Sin resultados</div>{:else}{#each terceroResults as tc, ci}<div class="ss-option" class:highlighted={ci === terceroHighlight} on:click={() => selectTercero(i, tc)} on:mouseenter={() => (terceroHighlight = ci)} role="option" aria-selected={ci === terceroHighlight} tabindex="-1"><span class="ss-opt-name" style="font-size:11px">{tc.nombre_completo}</span><span class="ss-opt-nit" style="font-size:10px">{tc.identificacion || ''} · {tc.tipo_persona === 'EMPRESA' ? '🏢' : '👤'}</span></div>{/each}{/if}</div>
										{/if}
									{/if}
								</div>
							</td>
							<td style="font-size:11px;color:#475569">{t.recorrido || '—'}</td>
							<td><input type="date" bind:value={terceroRows[i].fecha_ini} style="font-size:11px;padding:5px 6px" /></td>
							<td><input type="date" bind:value={terceroRows[i].fecha_fin} style="font-size:11px;padding:5px 6px" /></td>
							<td><input type="text" inputmode="numeric" value={fmtCOPInput(terceroRows[i].vr_unit)} on:focus={e => { e.currentTarget.value = String(terceroRows[i].vr_unit || ''); e.currentTarget.select(); }} on:blur={e => { terceroRows[i].vr_unit = parseCOPInput(e.currentTarget.value); terceroRows = terceroRows; e.currentTarget.value = fmtCOPInput(terceroRows[i].vr_unit); }} style="font-size:12px;padding:5px 6px;text-align:right;font-family:monospace" /></td>
							<td><input type="number" bind:value={terceroRows[i].cant} min="0" step="0.5" style="font-size:12px;padding:5px 5px;text-align:center" /></td>
							<td class="calc-g">{COP(calc?.totalRow || 0)}</td>
							<td><input type="number" bind:value={terceroRows[i].pct_admin} min="0" max="100" step="0.1" style="font-size:12px;padding:5px 5px;text-align:center" /></td>
							<td class="calc" style="color:#dc2626">{COP(calc?.admon || 0)}</td>
							<td class="calc-g">{COP(calc?.vLiquidar || 0)}</td>
							<td class="calc" style="color:#059669;font-weight:700">{COP(calc?.extraGlobal || 0)}</td>
							<td><input type="text" inputmode="numeric" value={fmtCOPInput(terceroRows[i].ingresos_extra_aval)} on:focus={e => { e.currentTarget.value = String(terceroRows[i].ingresos_extra_aval || ''); e.currentTarget.select(); }} on:blur={e => { terceroRows[i].ingresos_extra_aval = parseCOPInput(e.currentTarget.value); terceroRows = terceroRows; e.currentTarget.value = fmtCOPInput(terceroRows[i].ingresos_extra_aval); }} style="font-size:12px;padding:5px 6px;text-align:right;font-family:monospace" /></td>
							<td class="calc" style="color:#2563eb;font-weight:700">{COP(calc?.ingresoTransmeralda || 0)}</td>
							<td style="text-align:center"><button class="btn-del-terc" on:click={() => delTerceroRow(i)}>🗑</button></td>
						</tr>
					{/each}
				</tbody>
				<tfoot><tr class="terc-totals-row"><td colspan="8" style="text-align:right;font-weight:800;text-transform:uppercase;font-size:10px;letter-spacing:.05em">TOTALES</td><td class="calc-g">{COP(tercTotalFacturado)}</td><td></td><td class="calc" style="color:#dc2626;font-weight:700">{COP(tercTotalAdmon)}</td><td class="calc-g">{COP(tercTotalVLiquidar)}</td><td class="calc" style="color:#059669;font-weight:700">{COP(tercTotalExtraGlobal)}</td><td class="calc" style="font-weight:700">{COP(tercTotalExtraAval)}</td><td class="calc" style="color:#2563eb;font-weight:700">{COP(tercTotalIngresoTrans)}</td><td></td></tr></tfoot>
			</table>
		</div>
		<div style="margin-top:16px;padding:14px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
			<h4 style="margin:0 0 10px;font-size:14px;color:#334155">📋 Resumen Terceros</h4>
			<div class="sl"><span>Ingreso Total Tercero (V/Liquidar)</span><strong style="color:#9a3412">{COP(tercIngresoTotalTercero)}</strong></div>
			<div class="sl"><span>Administración Cotransmeq</span><strong style="color:#dc2626">{COP(tercAdminCotransmeq)}</strong></div>
			<div class="sl"><span>Ingreso Extra Cotransmeq</span><strong style="color:#2563eb">{COP(tercIngresoExtraTrans)}</strong></div>
			<div class="sl"><span>Valor Transporte Adicional</span><strong>{COP(tercValTransAdicional)}</strong></div>
			<div class="sl"><span>Admin Trans. Adicional ({terceroRows[0]?.pct_admin || 10}%)</span><strong>{COP(tercAdminTransAdicional)}</strong></div>
			<div class="sl" style="border-top:2px solid #e2e8f0;margin-top:6px;padding-top:8px"><span style="font-weight:700">INGRESO TOTAL COTRANSMEQ</span><strong style="color:#7c3aed">{COP(tercIngresoTotalCotransmeq)}</strong></div>
			<div class="stotal"><span>VALOR TOTAL A FACTURAR</span><span>{COP(tercValorTotalFacturar)}</span></div>
		</div>
	</div>
	{/if}

	<!-- REGISTRAR BUTTON -->
	<div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px">
		<button class="btn-registrar" style="margin-top:0;width:auto" on:click={registrarLiquidacion} disabled={saving}>{#if saving}⏳ {editingId ? 'Actualizando...' : 'Registrando...'}{:else}{editingId ? '💾 Actualizar Liquidación' : '📝 Registrar Liquidación'}{/if}</button>
		<button class="btn-registrar" style="background:#64748b;margin-top:0;width:auto" on:click={handleCancel}>✕ Cancelar</button>
	</div>
	{#if saveError}<div class="save-error">⚠️ {saveError}</div>{/if}
</div>

<!-- PREVIEW / PDF -->
{:else}
<div class="pdf-wrap">
	<div class="pdf-bar">
		<div class="pdf-bar-l"><img src="/assets/logo.png" alt="" class="pb-logo" on:error={(e) => { const el = e.currentTarget as HTMLImageElement; el.style.display='none'; }} /><div><div class="pb-t">{previewPage === 'liquidacion' ? 'OP-FR-07 — Liquidación de Servicios' : previewPage === 'recargos' ? 'OP-FR-06 — Recargos' : previewPage === 'terceros' ? 'GAF-FR-11 — Terceros' : 'OP-FR-06 — Liquidador'}</div><div class="pb-s">{hdr.consecutivo || 'Sin consecutivo'} · {hdr.mes} {hdr.anio} · {selectedCliente?.nombre || 'Sin cliente'}</div></div></div>
		<div style="display:flex;gap:10px;align-items:center">
			<div class="page-tabs">
				<button class="ptab" class:active={previewPage === 'liquidacion'} on:click={() => previewPage = 'liquidacion'}>Hoja 1 · Liquidación</button>
				<button class="ptab" class:active={previewPage === 'recargos'} on:click={() => previewPage = 'recargos'}>Hoja 2 · Recargos</button>
				<button class="ptab" class:active={previewPage === 'liquidador'} on:click={() => previewPage = 'liquidador'}>Hoja 3 · Liquidador</button>
				{#if canSeeTerceros}<button class="ptab" class:active={previewPage === 'terceros'} on:click={() => previewPage = 'terceros'}>Hoja 4 · Terceros</button>{/if}
			</div>
			<div class="zoom-controls"><button class="zoom-btn" on:click={() => pdfZoom = Math.max(0.5, pdfZoom - 0.1)}>−</button><span class="zoom-label">{Math.round(pdfZoom * 100)}%</span><button class="zoom-btn" on:click={() => pdfZoom = Math.min(2, pdfZoom + 0.1)}>+</button><button class="zoom-btn zoom-reset" on:click={() => pdfZoom = 1}>↺</button></div>
			<button class="pbtn pbtn-back" on:click={() => { if (viewMode && editId) goto(BACK_URL); else setView('editor'); }}>{viewMode ? '← Volver' : '← Editar'}</button>
			<button class="pbtn pbtn-print" on:click={handlePrint}>🖨 Imprimir</button>
		</div>
	</div>

	<!-- ESTADO BAR -->
	{#if editingId && liqEstado !== 'BORRADOR'}
	{@const badge = getEstadoBadge(liqEstado)}
	<div class="estado-bar">
		<span class="estado-badge" style="background:{badge.bg};color:{badge.text}">{badge.label}</span>
		{#if liqFechaLiquidacion && ['LIQUIDADA','APROBADA','FACTURADA'].includes(liqEstado)}<span class="estado-info">📋 Liquidada: <strong>{fmtFecha(liqFechaLiquidacion)}</strong>{#if liqLiquidadoPor} por {liqLiquidadoPor.nombre}{/if}</span>{/if}
		{#if liqFechaAprobacion && ['APROBADA','FACTURADA'].includes(liqEstado)}<span class="estado-info">✅ Aprobada: <strong>{fmtFecha(liqFechaAprobacion)}</strong>{#if liqAprobadoPor} por {liqAprobadoPor.nombre}{/if}</span>{/if}
		<button class="btn-historial" on:click={abrirHistorial}>📜 Trazabilidad</button>
	</div>
	{/if}

	<!-- A4 HOJA 1: LIQUIDACIÓN -->
	{#if previewPage === 'liquidacion' || (isPrinting && printSheets.liquidacion)}
	<div class="pdf-body print-sheet">
		<div class="page" style="transform: scale({pdfZoom}); transform-origin: top center;">
			<div class="dh">
				<div class="dh-logo">{#if logoError}<div class="dh-logo-fallback">COTRANS<br/>MEQ</div>{:else}<img src="/assets/logo.png" alt="Logo" on:error={() => logoError = true} style="height:58px;width:auto;object-fit:contain" />{/if}</div>
				<div class="dh-title"><div class="dh-co">{hdr.empresa}</div><div class="dh-doc">LIQUIDACIÓN DE SERVICIOS</div></div>
				<div class="dh-meta"><table class="mt"><tbody><tr><td class="ml">Código:</td><td class="mv">OP-FR-07</td></tr><tr><td class="ml">Versión:</td><td>1</td></tr><tr><td class="ml">Fecha:</td><td>{new Date().toLocaleDateString('es-CO')}</td></tr></tbody></table></div>
				<div class="dh-super"><img src="https://transmeralda.s3.us-east-2.amazonaws.com/assets/supertransporte_logo.png" alt="Supertransporte" /></div>
			</div>
			<div class="pb"><div class="pc"><span class="pclabel">MES:</span><span class="pcval">{hdr.mes}</span></div><div class="pc"><span class="pclabel">AÑO</span><span class="pcval">{hdr.anio}</span></div><div class="pc" style="flex:2"><span class="pclabel">CLIENTE:</span><span class="pcval">{selectedCliente?.nombre || ''}{selectedCliente?.nit ? ` — NIT: ${selectedCliente.nit}` : ''}</span></div><div class="pc pc-consec" style="flex:1.5"><span class="pclabel">CONSECUTIVO LIQUIDACIÓN N°:</span><span class="pcval">&nbsp;{hdr.consecutivo}</span></div></div>
			<table class="st"><thead><tr><th style="width:6.5%">PLACA</th><th style="width:7%">FECHA<br/>INICIAL</th><th style="width:7%">FECHA<br/>FINAL</th><th style="width:22%">RECORRIDO</th><th style="width:15.5%">TIPO DE SERVICIO</th><th style="width:4%">CANT.</th><th style="width:9%">VR. UNITARIO</th><th style="width:9%">SUBTOTAL</th><th style="width:5%">DCTO.</th><th style="width:9%">VR. FINAL</th><th style="width:6%">N° PLANILLA</th></tr></thead>
			<tbody>{#each rows as row (row.id)}{@const { sub, vf } = calcRow(row)}<tr><td><span class="placa">{fmtPlaca(row.placa)}</span></td><td class="tc">{fmtD(row.fecha_ini)}</td><td class="tc">{fmtD(row.fecha_fin)}</td><td style="font-size:7.2pt;line-height:1.3">{row.recorrido}</td><td style="font-size:7pt">{row.tipo}</td><td class="tc" style="font-weight:700">{row.cant}</td><td class="mc">{COP(row.vr_unit)}</td><td class="mc">{COP(sub)}</td><td class="tc">{row.dcto}%</td><td class="mch">{COP(vf)}</td><td class="tc" style="font-family:monospace;font-size:7.2pt">{row.planilla}</td></tr>{/each}{#each Array(Math.max(0, 4 - rows.length)) as _}<tr class="filler">{#each Array(11) as __}<td></td>{/each}</tr>{/each}</tbody>
			<tfoot><tr><td colspan="9" style="text-align:right;color:#9a3412;padding-right:8px;font-size:8pt;font-weight:800">TOTAL SERVICIOS:</td><td class="mch" style="border-left:1px solid #aaa">{COP(totalSvc)}</td><td></td></tr></tfoot></table>
			<div class="bg"><div class="bl"><div class="obs-t">Observaciones:</div><div class="obs-b">{hdr.observaciones}</div><div class="op-row"><div class="op-line"><span class="opl">OPERADORA:</span><span class="opv">{hdr.operadora}</span></div>{#if hdr.osi}<div class="op-line"><span class="opl">OSI:</span><span class="opv">{hdr.osi}</span></div>{/if}</div>
			<div class="pernote-box"><div class="pernote-hd-row"><span style="text-align:left">PERNOCTE</span><span>Vr. Unitario</span><span>Cantidad</span><span>Total</span></div><div class="pernote-val-row"><span style="text-align:left;color:#555">&nbsp;</span><span style="font-family:monospace;font-size:7.5pt">{COP(ext.pernote_unit)}</span><span style="font-weight:700">{ext.pernote_cant}</span><span style="font-weight:800;color:#9a3412">{COP(valPern)}</span></div></div></div>
			<div class="br"><table class="stbl"><tbody><tr><td class="sla" style="padding-left:12px;font-size:7pt">TRANSPORTE ADICIONAL (CORRESPONDIENTE A TIEMPO EXTRA DEL PERSONAL EN SERVICIO)</td><td class="sva" style="padding-right:10px;font-size:7pt">{COP(valTransAd)}</td></tr><tr class="sep-row"><td class="slb" style="padding-left:12px">VALOR TOTAL DEL SERVICIO SIN RECARGOS</td><td class="svb" style="padding-right:10px">{COP(totalSvc)}</td></tr><tr><td class="slb" style="padding-left:12px">VALOR TOTAL RECARGOS</td><td class="svb" style="padding-right:10px">{COP(valRec)}</td></tr><tr><td class="slb" style="padding-left:12px">PERNOTE</td><td class="svb" style="padding-right:10px">{COP(valPern)}</td></tr><tr class="sep-row"><td class="slb" style="padding-left:12px;font-size:8.5pt">SUBTOTAL</td><td class="svb" style="padding-right:10px;font-size:8.5pt">{COP(subtotal)}</td></tr><tr><td class="sla" style="padding-left:12px;font-size:7pt;color:#666">IVA {ext.iva_pct}%</td><td class="sva" style="padding-right:10px;font-size:7pt;color:#666">{COP(ivaVal)}</td></tr><tr><td class="slhi" style="padding-left:12px">TOTAL SERVICIO</td><td class="svhi" style="padding-right:10px">{COP(total)}</td></tr></tbody></table></div></div>
			<div class="sigs"><div class="sig"><div class="sig-lbl">FIRMA AUTORIZADA POR CLIENTE {selectedCliente?.nombre ? `— ${selectedCliente.nombre}` : ''}:</div><div class="sig-line">{selectedCliente?.nombre || ''}{selectedCliente?.nit ? ` — NIT: ${selectedCliente.nit}` : ''}</div></div><div class="sig"><div class="sig-lbl">FIRMA AUTORIZADA POR:</div><div class="sig-line">&nbsp;</div></div></div>
			<div class="doc-ft"><span>OP-FR-07 · Versión 1</span><span>Generado el {new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })}</span><span>{hdr.empresa}</span></div>
		</div>
	</div>
	{/if}

	<!-- A4 HOJA 2: RECARGOS -->
	{#if previewPage === 'recargos' || (isPrinting && printSheets.recargos)}
	<div class="pdf-body pdf-body-landscape print-sheet">
		<div class="page page-landscape" style="transform: scale({pdfZoom}); transform-origin: top center;">
			<div class="dh"><div class="dh-logo">{#if logoError}<div class="dh-logo-fallback">COTRANS<br/>MEQ</div>{:else}<img src="/assets/logo.png" alt="Logo" on:error={() => logoError = true} style="height:46px;width:auto;object-fit:contain" />{/if}</div><div class="dh-title"><div class="dh-co">{hdr.empresa}</div><div class="dh-doc">LIQUIDADOR DE RECARGOS</div></div><div class="dh-meta"><table class="mt"><tbody><tr><td class="ml">Código:</td><td class="mv">OP-FR-06</td></tr><tr><td class="ml">Versión:</td><td>1</td></tr></tbody></table></div><div class="dh-super"><img src="https://transmeralda.s3.us-east-2.amazonaws.com/assets/supertransporte_logo.png" alt="Supertransporte" /></div></div>
			<div class="pb" style="font-size:7pt"><div class="pc"><span class="pclabel">MES:</span><span class="pcval">{hdr.mes}</span></div><div class="pc"><span class="pclabel">AÑO:</span><span class="pcval">{hdr.anio}</span></div><div class="pc" style="flex:2"><span class="pclabel">CLIENTE:</span><span class="pcval">{selectedCliente?.nombre || ''}</span></div></div>
			{#if recargosRows.length > 0}
			<table class="rgt"><thead><tr><th class="rgt-emp">EMPRESA</th><th class="rgt-pla">N° PLANILLA</th><th class="rgt-pla">PLACA</th><th class="rgt-cnd">CONDUCTOR</th>{#each Array(31) as _, i}<th class="rgt-d">{i + 1}</th>{/each}<th class="rgt-t">TOTAL</th><th class="rgt-t">PROM</th></tr></thead>
			<tbody>{#each recargosRows as row (row.id)}<tr><td class="rgt-emp">{(row.empresa || '').toUpperCase()}</td><td class="rgt-pla tc">{row.planilla}</td><td class="rgt-pla tc"><span class="placa">{fmtPlaca(row.placa)}</span></td><td class="rgt-cnd">{(row.conductor || '').toUpperCase()}</td>{#each Array(31) as _, i}<td class="rgt-d tc" style="{row.days[i] > 0 ? 'font-weight:700;color:#9a3412' : 'color:#ccc'}">{row.days[i] ? row.days[i].toFixed(1) : '-'}</td>{/each}<td class="rgt-t tc" style="font-weight:800;color:#9a3412">{row.total.toFixed(1)}</td><td class="rgt-t tc">{row.promedio.toFixed(1)}</td></tr>{/each}
			<tr class="rgt-totals"><td colspan="4" style="text-align:right;font-weight:800;padding-right:6px">TOTALES</td>{#each Array(31) as _, i}<td class="rgt-d tc" style="font-weight:800">{recargosTotals.days[i] ? recargosTotals.days[i].toFixed(1) : ''}</td>{/each}<td class="rgt-t tc" style="font-weight:900;color:#9a3412;font-size:7.5pt">{recargosTotals.total.toFixed(1)}</td><td></td></tr></tbody></table>
			{:else}<div style="text-align:center;padding:40px 20px;color:#94a3b8;font-style:italic;font-size:9pt">Sin datos de recargos.</div>{/if}
			{#if recargosRows.length > 0}
			<div style="margin-top:10px"><div style="font-size:7.5pt;font-weight:800;color:#9a3412;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Consolidado Recargos</div>
			<table class="crt"><thead><tr><th>EMPRESA</th><th>N° PLANILLA</th><th>PLACA</th><th>CONDUCTOR</th><th>HED</th><th>HEN</th><th>HEFD</th><th>HEFN</th><th>RNDF</th><th>RN</th><th>RD</th></tr></thead>
			<tbody>{#each recargosRows as row (row.id)}<tr><td>{(row.empresa || '').toUpperCase()}</td><td class="tc">{row.planilla}</td><td class="tc"><span class="placa">{fmtPlaca(row.placa)}</span></td><td style="font-size:6pt">{(row.conductor || '').toUpperCase()}</td><td class="mc">{row.hed.toFixed(2)}</td><td class="mc">{row.hen.toFixed(2)}</td><td class="mc">{row.hefd.toFixed(2)}</td><td class="mc">{row.hefn.toFixed(2)}</td><td class="mc">{row.rndf.toFixed(2)}</td><td class="mc">{row.rn.toFixed(2)}</td><td class="mc">{row.rd.toFixed(2)}</td></tr>{/each}
			<tr class="rgt-totals"><td colspan="4" style="text-align:right;font-weight:800;padding-right:6px">TOTALES</td><td class="mc" style="font-weight:800">{recargosTotals.hed.toFixed(2)}</td><td class="mc" style="font-weight:800">{recargosTotals.hen.toFixed(2)}</td><td class="mc" style="font-weight:800">{recargosTotals.hefd.toFixed(2)}</td><td class="mc" style="font-weight:800">{recargosTotals.hefn.toFixed(2)}</td><td class="mc" style="font-weight:800">{recargosTotals.rndf.toFixed(2)}</td><td class="mc" style="font-weight:800">{recargosTotals.rn.toFixed(2)}</td><td class="mc" style="font-weight:800">{recargosTotals.rd.toFixed(2)}</td></tr></tbody></table></div>
			{/if}
			<div class="sigs" style="margin-top:14px"><div class="sig"><div class="sig-lbl">FIRMA AUTORIZADA POR CLIENTE:</div><div class="sig-line">{selectedCliente?.nombre || ''}</div></div><div class="sig"><div class="sig-lbl">FIRMA AUTORIZADA POR:</div><div class="sig-line">&nbsp;</div></div></div>
			<div class="doc-ft"><span>OP-FR-06 · Versión 1</span><span>Generado el {new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })}</span><span>{hdr.empresa}</span></div>
		</div>
	</div>
	{/if}

	<!-- A4 HOJA 3: LIQUIDADOR -->
	{#if previewPage === 'liquidador' || (isPrinting && printSheets.liquidador)}
	<div class="pdf-body print-sheet">
		<div class="page" style="transform: scale({pdfZoom}); transform-origin: top center;">
			<div class="dh"><div class="dh-logo">{#if logoError}<div class="dh-logo-fallback">COTRANS<br/>MEQ</div>{:else}<img src="/assets/logo.png" alt="Logo" on:error={() => logoError = true} style="height:58px;width:auto;object-fit:contain" />{/if}</div><div class="dh-title"><div class="dh-co">{hdr.empresa}</div><div class="dh-doc">LIQUIDADOR DE RECARGOS</div></div><div class="dh-meta"><table class="mt"><tbody><tr><td class="ml">Código:</td><td class="mv">OP-FR-06</td></tr><tr><td class="ml">Versión:</td><td>1</td></tr></tbody></table></div><div class="dh-super"><img src="https://transmeralda.s3.us-east-2.amazonaws.com/assets/supertransporte_logo.png" alt="Supertransporte" /></div></div>
			<div class="liq-salary-bar"><div class="liq-sal-row"><span class="liq-sal-lbl">SALARIO BASICO</span><span class="liq-sal-val">$ {liqCfg.salario_basico.toLocaleString('es-CO')}</span><span class="liq-sal-lbl" style="margin-left:auto">CARGO</span><span class="liq-sal-val">{liqCfg.cargo}</span></div><div class="liq-sal-row"><span class="liq-sal-lbl">VALOR HORA TRABAJADOR{liqCfg.valor_hora_override > 0 ? ' (manual)' : ''}</span><span class="liq-sal-val">$ {fmtDec1(valorHora)}</span></div></div>
			<div class="pb"><div class="pc"><span class="pclabel">PERIDO DE LIQUIDACIÓN MES:</span><span class="pcval">{hdr.mes}</span></div><div class="pc"><span class="pclabel">AÑO:</span><span class="pcval">AÑO {hdr.anio}</span></div></div>
			<table class="liq-tbl"><thead><tr><th style="text-align:left;width:50%">DESCRIPCION</th><th style="width:10%">%</th><th style="width:15%">VR UNITARIO</th><th style="width:12%">TOTAL HORAS</th><th style="width:13%">TOTAL</th></tr></thead>
			<tbody>
				{#each liqLineas as linea}<tr><td style="text-align:left;font-weight:600">{linea.desc}</td><td class="tc">{linea.pct}</td><td class="mc">{fmtDec1(linea.vrUnit)}</td><td class="mc">{linea.horas > 0 ? linea.horas.toFixed(1).replace('.', ',') : '-'}</td><td class="mc" style="font-weight:700">{fmtDec1(linea.total)}</td></tr>{/each}
				<tr class="liq-sub-row"><td colspan="4" style="text-align:right;font-weight:800;padding-right:10px">SUBTOTAL 1</td><td class="mc" style="font-weight:800">{fmtDec1(liqSubtotal1)}</td></tr>
				<tr><td style="text-align:left">SEGURIDAD SOCIAL {liqCfg.pct_seg_social.toFixed(2).replace('.', ',')}%</td><td class="tc">{liqCfg.pct_seg_social.toFixed(2).replace('.', ',')}%</td><td></td><td></td><td class="mc">{fmtDec1(liqSegSocial)}</td></tr>
				<tr><td style="text-align:left">PRESTACIONES SOCIALES {liqCfg.pct_prestaciones.toFixed(2).replace('.', ',')}%</td><td class="tc">{liqCfg.pct_prestaciones.toFixed(2).replace('.', ',')}%</td><td></td><td></td><td class="mc">{fmtDec1(liqPrestaciones)}</td></tr>
				<tr class="liq-sub-row"><td colspan="4" style="text-align:right;font-weight:800;padding-right:10px">SUBTOTAL 2</td><td class="mc" style="font-weight:800">{fmtDec1(liqSubtotal2)}</td></tr>
				<tr><td style="text-align:left">PRUEBA COVID ANTIGENO</td><td></td><td class="mc">{fmtDec1(liqCfg.prueba_covid > 0 ? liqCfg.prueba_covid : 0)}</td><td></td><td class="mc">{fmtDec1(liqPruebaCovid)}</td></tr>
				<tr><td style="text-align:left">ADMINISTRACION {liqCfg.pct_admin}%</td><td class="tc">{liqCfg.pct_admin}%</td><td></td><td></td><td class="mc">{fmtDec1(liqAdmin)}</td></tr>
				<tr class="liq-total-row"><td colspan="4" style="text-align:right;font-weight:900;padding-right:10px;font-size:9.5pt">TOTAL</td><td class="mc" style="font-weight:900;font-size:9.5pt;color:#9a3412">{fmtDec1(liqTotal)}</td></tr>
			</tbody></table>
			<div class="sigs" style="margin-top:20px"><div class="sig"><div class="sig-lbl">FIRMA AUTORIZADA POR CLIENTE:</div><div class="sig-line">{selectedCliente?.nombre || ''}</div></div><div class="sig"><div class="sig-lbl">FIRMA AUTORIZADA POR:</div><div class="sig-line">&nbsp;</div></div></div>
			<div class="doc-ft"><span>OP-FR-06 · Versión 1</span><span>Generado el {new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })}</span><span>{hdr.empresa}</span></div>
		</div>
	</div>
	{/if}

	<!-- A4 HOJA 4: TERCEROS -->
	{#if previewPage === 'terceros' || (isPrinting && printSheets.terceros)}
	<div class="pdf-body print-sheet">
		<div class="page" style="transform: scale({pdfZoom}); transform-origin: top center;">
			<div class="dh"><div class="dh-logo">{#if logoError}<div class="dh-logo-fallback">COTRANS<br/>MEQ</div>{:else}<img src="/assets/logo.png" alt="Logo" on:error={() => logoError = true} style="height:58px;width:auto;object-fit:contain" />{/if}</div><div class="dh-title"><div class="dh-co">{hdr.empresa}</div><div class="dh-doc">LIQUIDACIÓN DE INGRESOS RECIBIDOS PARA TERCEROS</div></div><div class="dh-meta"><table class="mt"><tbody><tr><td class="ml">Código:</td><td class="mv">GAF-FR-11</td></tr><tr><td class="ml">Versión:</td><td>1</td></tr><tr><td class="ml">Fecha:</td><td>{new Date().toLocaleDateString('es-CO')}</td></tr></tbody></table></div></div>
			<div class="pb"><div class="pc"><span class="pclabel">MES:</span><span class="pcval">{hdr.mes}</span></div><div class="pc"><span class="pclabel">AÑO:</span><span class="pcval">{hdr.anio}</span></div><div class="pc"><span class="pclabel">CONSECUTIVO:</span><span class="pcval">{hdr.consecutivo || ''}</span></div></div>
			<table class="terc-prev-tbl"><thead><tr><th style="width:35px">#</th><th>PLACA</th><th>NOMBRE DEL TERCERO</th><th>DESCRIPCIÓN SERVICIO</th><th>FECHAS</th><th>VR UNIDAD</th><th>CANT</th><th>TOTAL FACTURADO</th><th>ADMON %</th><th>ADMON $</th><th>V/LIQUIDAR 3°</th></tr></thead>
			<tbody>{#each terceroRows as t, i}{@const calc = terceroCalcs[i]}<tr><td class="tc">{i+1}</td><td class="tc" style="font-weight:600">{fmtPlaca(t.placa)}</td><td style="font-size:7.5pt">{(t.nombre_tercero || getTerceroNombre(t.placa, i) || '').toUpperCase()}</td><td style="font-size:7.5pt">{t.recorrido || ''}</td><td class="tc" style="font-size:7pt;white-space:nowrap">{t.fecha_ini || ''}{t.fecha_fin ? ' - ' + t.fecha_fin : ''}</td><td class="mc">{COP(t.vr_unit)}</td><td class="tc">{t.cant}</td><td class="mc" style="font-weight:700">{COP(calc?.totalRow || 0)}</td><td class="tc">{(calc?.pctAdmin || 0)}%</td><td class="mc" style="color:#b91c1c">{COP(calc?.admon || 0)}</td><td class="mc" style="font-weight:700;color:#9a3412">{COP(calc?.vLiquidar || 0)}</td></tr>{/each}</tbody>
			<tfoot><tr style="font-weight:800;background:#e2e8f0"><td colspan="7" style="text-align:right;padding-right:6px">TOTALES</td><td class="mc">{COP(tercTotalFacturado)}</td><td></td><td class="mc" style="color:#b91c1c">{COP(tercTotalAdmon)}</td><td class="mc" style="color:#9a3412">{COP(tercTotalVLiquidar)}</td></tr></tfoot></table>
			<table class="terc-prev-tbl" style="margin-top:10px"><thead><tr><th style="width:28px">#</th><th>PLACA</th><th>PROPIETARIO</th><th>CC / NIT</th><th>TIPO</th><th style="width:50px">ÍTEMS</th><th>V/LIQUIDAR</th></tr></thead>
			<tbody>{#each terceroPlacasGroup as g, gi}<tr><td class="tc">{gi+1}</td><td class="tc" style="font-weight:700;font-family:monospace">{fmtPlaca(g.placa)}</td><td style="font-size:7.5pt;font-weight:600">{g.nombre.toUpperCase()}</td><td class="tc" style="font-size:7.5pt">{g.identificacion || '—'}</td><td class="tc" style="font-size:7pt">{g.tipo === 'EMPRESA' ? '🏢 EMPRESA' : '👤 PERSONA'}</td><td class="tc">{g.items}</td><td class="mc" style="font-weight:700;color:#9a3412">{COP(g.vLiquidar)}</td></tr>{/each}</tbody>
			<tfoot><tr style="font-weight:800;background:#e2e8f0"><td colspan="5" style="text-align:right;padding-right:6px">TOTAL ({terceroPlacasGroup.length} {terceroPlacasGroup.length === 1 ? 'placa' : 'placas'})</td><td class="tc" style="font-weight:700">{terceroRows.length}</td><td class="mc" style="color:#9a3412">{COP(tercTotalVLiquidar)}</td></tr></tfoot></table>
			<div class="terc-summary-box"><table class="terc-summary-tbl"><tbody>
				<tr><td class="ts-lbl">INGRESO TOTAL TERCERO (V/Liquidar)</td><td class="ts-val" style="color:#9a3412">{COP(tercIngresoTotalTercero)}</td></tr>
				<tr class="ts-sep"><td class="ts-lbl">ADMINISTRACIÓN COTRANSMEQ</td><td class="ts-val" style="color:#b91c1c">{COP(tercAdminCotransmeq)}</td></tr>
				<tr><td class="ts-lbl">INGRESO EXTRA COTRANSMEQ</td><td class="ts-val" style="color:#2563eb">{COP(tercIngresoExtraTrans)}</td></tr>
				<tr><td class="ts-lbl">VALOR TRANSPORTE ADICIONAL</td><td class="ts-val">{COP(tercValTransAdicional)}</td></tr>
				<tr><td class="ts-lbl">ADMIN TRANSPORTE ADICIONAL ({terceroRows[0]?.pct_admin || 10}%)</td><td class="ts-val">{COP(tercAdminTransAdicional)}</td></tr>
				<tr class="ts-total"><td class="ts-lbl">INGRESO TOTAL COTRANSMEQ</td><td class="ts-val" style="color:#7c3aed">{COP(tercIngresoTotalCotransmeq)}</td></tr>
				<tr class="ts-grand"><td class="ts-lbl">VALOR TOTAL A FACTURAR</td><td class="ts-val">{COP(tercValorTotalFacturar)}</td></tr>
			</tbody></table></div>
			<div class="sigs" style="margin-top:18px"><div class="sig"><div class="sig-lbl">LIQUIDADO POR — GERENCIA:</div><div class="sig-line">&nbsp;</div></div><div class="sig"><div class="sig-lbl">FACTURADO POR — FACTURACIÓN:</div><div class="sig-line">&nbsp;</div></div></div>
			<div class="doc-ft"><span>GAF-FR-11 · Versión 1</span><span>Generado el {new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })}</span><span>{hdr.empresa}</span></div>
		</div>
	</div>
	{/if}
</div>
{/if}

<!-- PRINT MODAL -->
{#if printModalOpen}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-bg" on:click|self={() => printModalOpen = false}>
	<div class="modal-box" style="max-width:440px">
		<div class="modal-hd" style="background:linear-gradient(135deg,#9a3412,#c2410c);color:#fff;padding:22px 24px 16px"><span style="font-size:32px">🖨</span><div style="flex:1"><div style="font-size:17px;font-weight:800">Imprimir Liquidación</div><div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:2px">Seleccione las hojas</div></div></div>
		<div class="modal-body">
			<label class="print-check"><input type="checkbox" checked={printSheetCount === (canSeeTerceros ? 4 : 3)} on:change={(e) => toggleAllSheets(e.currentTarget.checked)} /><span style="font-weight:800">Seleccionar todas</span></label>
			<label class="print-check"><input type="checkbox" bind:checked={printSheets.liquidacion} /> 📄 Hoja 1 — Liquidación</label>
			<label class="print-check"><input type="checkbox" bind:checked={printSheets.recargos} /> 📊 Hoja 2 — Recargos</label>
			<label class="print-check"><input type="checkbox" bind:checked={printSheets.liquidador} /> 📋 Hoja 3 — Liquidador</label>
			{#if canSeeTerceros}<label class="print-check"><input type="checkbox" bind:checked={printSheets.terceros} /> 📑 Hoja 4 — Terceros</label>{/if}
		</div>
		<div style="padding:16px 24px 20px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #f1f5f9">
			<button class="btn-estado" style="border-color:#94a3b8;color:#64748b" on:click={() => printModalOpen = false}>Cancelar</button>
			<button class="btn-registrar" style="width:auto;margin:0;padding:10px 22px;font-size:13px" disabled={printSheetCount === 0} on:click={executePrint}>🖨 Imprimir {printSheetCount} {printSheetCount === 1 ? 'hoja' : 'hojas'}</button>
		</div>
	</div>
</div>
{/if}

<!-- HISTORIAL MODAL -->
{#if historialModalOpen}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-bg" on:click|self={() => historialModalOpen = false}>
	<div class="modal-box" style="max-width:580px">
		<div class="modal-hd"><h3>📜 Trazabilidad de Estado</h3><button class="modal-close" on:click={() => historialModalOpen = false}>✕</button></div>
		<div class="modal-body">
			{#if historialLoading}<div class="loading-center"><div class="spinner"></div></div>
			{:else if historialData.length === 0}<div style="text-align:center;padding:40px 0;color:#94a3b8"><span style="font-size:36px">📭</span><p style="margin:10px 0 0;font-size:14px">Sin registros</p></div>
			{:else}
				<div class="historial-timeline">
					{#each historialData as h, i}
						{@const badge = getEstadoBadge(h.estado_nuevo)}
						<div class="historial-entry" class:historial-entry-first={i === 0}>
							<div class="historial-dot" style="background:{badge.bg};border-color:{badge.bg}"></div>
							<div class="historial-card">
								<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
									<div style="display:flex;align-items:center;gap:6px">
										{#if h.estado_anterior}{@const prev = getEstadoBadge(h.estado_anterior)}<span class="historial-tag" style="background:{prev.bg};color:{prev.text}">{prev.label}</span><span style="color:#94a3b8;font-size:14px;font-weight:700">→</span>{/if}
										<span class="historial-tag" style="background:{badge.bg};color:{badge.text}">{badge.label}</span>
									</div>
									<span style="font-size:11.5px;color:#94a3b8;white-space:nowrap">{fmtFecha(h.created_at)}</span>
								</div>
								{#if h.usuario}<div style="font-size:12.5px;color:#475569;margin-top:6px">👤 {h.usuario.nombre || h.usuario.correo}</div>{/if}
								{#if h.motivo}<div style="font-size:12px;color:#64748b;margin-top:4px;font-style:italic">💬 {h.motivo}</div>{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
{/if}

<!-- SUCCESS ANIMATION -->
{#if showSuccessAnim}
<div class="success-overlay">
	<div class="success-content">
		<div class="success-circle"><svg class="success-check" viewBox="0 0 52 52"><circle class="success-circle-bg" cx="26" cy="26" r="24" fill="none" stroke="#fff" stroke-width="2"/><path class="success-check-path" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" d="M14 27l7.8 7.8L38 18"/></svg></div>
		<h2 class="success-title">{successMsg}</h2>
		<p class="success-subtitle">{successSub}</p>
	</div>
</div>
{/if}

<style>
	/* ── LAYOUT ── */
	.page-wrap { padding: 24px 18px 48px; }
	.topbar { background: linear-gradient(135deg, #9a3412 0%, #c2410c 60%, #ea580c 100%); border-radius: 18px; padding: 16px 26px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 10px 40px rgba(154,52,18,.35); }
	.topbar-l { display: flex; align-items: center; gap: 14px; }
	.t-logo { height: 48px; width: 48px; object-fit: contain; background: #fff; border-radius: 12px; padding: 5px; flex-shrink: 0; }
	.t-title { color: #fff; font-size: 18px; font-weight: 800; letter-spacing: -.02em; line-height: 1.2; }
	.t-sub { color: rgba(255,255,255,.65); font-size: 11.5px; margin-top: 2px; }
	.btn-hdr { background: #fff; color: #9a3412; border: none; border-radius: 10px; padding: 10px 22px; font-weight: 800; font-size: 13px; cursor: pointer; box-shadow: 0 2px 16px rgba(0,0,0,.2); transition: all .15s; }
	.btn-hdr:hover { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(0,0,0,.25); }
	.btn-back { background: rgba(255,255,255,.15); color: #fff; border: 1px solid rgba(255,255,255,.25); border-radius: 10px; padding: 10px 22px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all .15s; }
	.btn-back:hover { background: rgba(255,255,255,.25); }
	.card { background: #fff; border-radius: 16px; border: 1px solid #dde3eb; padding: 22px 24px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.05); }
	.ch { font-size: 11px; font-weight: 800; color: #9a3412; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
	.ch::before { content: ''; width: 3px; height: 16px; background: linear-gradient(180deg, #c2410c, #f97316); border-radius: 2px; display: block; }
	label { display: block; font-size: 10.5px; font-weight: 700; color: #6b7e8c; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; }
	input, select { width: 100%; border: 1.5px solid #dde3eb; border-radius: 8px; padding: 8px 11px; font-size: 13px; color: #1a2530; background: #fafbfc; outline: none; transition: all .15s; }
	input:focus, select:focus { border-color: #ea580c; background: #fff; box-shadow: 0 0 0 3px rgba(234,88,12,.1); }
	.g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
	.g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 13px; }
	.g4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
	.tw { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
	/* ── SEARCHABLE SELECT ── */
	.ss-wrap { position: relative; }
	.ss-selected { display: flex; align-items: center; gap: 6px; background: #fff7ed; border: 1.5px solid #fed7aa; border-radius: 8px; padding: 7px 11px; font-size: 13px; font-weight: 600; color: #9a3412; }
	.ss-selected .ss-nit { font-size: 11px; color: #64748b; font-weight: 400; }
	.ss-clear { background: none; border: none; cursor: pointer; font-size: 14px; margin-left: auto; color: #94a3b8; padding: 2px 4px; width: auto; }
	.ss-clear:hover { color: #dc2626; }
	.ss-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 1.5px solid #dde3eb; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.15); z-index: 50; max-height: 220px; overflow-y: auto; margin-top: 4px; }
	.ss-option { padding: 8px 12px; cursor: pointer; font-size: 12.5px; display: flex; justify-content: space-between; align-items: center; transition: background .1s; }
	.ss-option:hover, .ss-option.highlighted { background: #fff7ed; }
	.ss-option .ss-opt-name { font-weight: 600; color: #1e293b; }
	.ss-option .ss-opt-nit { font-size: 11px; color: #94a3b8; }
	.ss-option .ss-opt-placa { font-family: monospace; font-weight: 800; color: #9a3412; font-size: 12px; }
	.ss-option .ss-opt-info { font-size: 10.5px; color: #94a3b8; }
	.ss-empty { padding: 12px; text-align: center; font-size: 12px; color: #94a3b8; }
	/* ── EDITOR TABLE ── */
	.tbl-s { overflow: visible; border: 1px solid #dde3eb; border-radius: 12px; padding-bottom: 8px; }
	.tbl { width: 100%; border-collapse: collapse; font-size: 11.5px; min-width: 1020px; }
	.tbl th { background: linear-gradient(135deg, #fff7ed, #ffedd5); color: #9a3412; font-weight: 800; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; padding: 10px 8px; border-bottom: 2px solid #fed7aa; white-space: nowrap; text-align: left; }
	.tbl td { padding: 8px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
	.tbl tbody tr:hover td { background: #fffbf5; }
	.calc { text-align: right; font-family: monospace; font-size: 11.5px; color: #555; white-space: nowrap; }
	.calc-g { text-align: right; font-family: monospace; font-weight: 700; color: #9a3412; white-space: nowrap; }
	.tbl input { width: 100%; min-width: 0; }
	.addbtn { background: #fff7ed; border: 1.5px dashed #fdba74; color: #9a3412; border-radius: 8px; padding: 8px 22px; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .15s; margin-top: 10px; }
	.addbtn:hover { background: #ffedd5; border-color: #ea580c; }
	.delbtn { background: #fee2e2; border: none; color: #dc2626; border-radius: 6px; padding: 5px 9px; font-size: 10.5px; font-weight: 700; cursor: pointer; width: auto; }
	/* ── RECARGOS ── */
	.badge-sm { display: inline-block; background: #ffedd5; color: #9a3412; font-size: 10px; padding: 1px 7px; border-radius: 10px; font-weight: 700; margin-left: 8px; vertical-align: middle; }
	.paste-hint { margin: 0 0 10px; padding: 10px 14px; background: #fff7ed; border: 1px dashed #fdba74; border-radius: 8px; font-size: 11.5px; color: #9a3412; text-align: center; }
	.recargos-scroll { overflow-x: auto; overflow-y: auto; max-height: 420px; border: 1px solid #dde3eb; border-radius: 10px; }
	.rtbl { border-collapse: collapse; font-size: 10.5px; white-space: nowrap; }
	.rtbl th { background: linear-gradient(135deg, #fff7ed, #ffedd5); color: #9a3412; font-weight: 800; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; padding: 7px 4px; border-bottom: 2px solid #fed7aa; position: sticky; top: 0; z-index: 2; }
	.rtbl td { padding: 3px 3px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
	.rtbl tbody tr:hover td { background: #fffbf5; }
	.rtbl input { border: 1px solid #e0e6ed; border-radius: 4px; font-size: 10.5px; padding: 3px 4px; background: #fff; outline: none; transition: border .15s; }
	.rtbl input:focus { border-color: #ea580c; background: #fff7ed; }
	.rtbl input[type="number"] { width: 48px; text-align: center; font-family: monospace; }
	.rcol-act { width: 28px; text-align: center; }
	.rcol-emp { min-width: 120px; }
	.rcol-emp input { width: 110px; }
	.rcol-plan { min-width: 70px; }
	.rcol-plan input { width: 60px; }
	.rcol-plac { min-width: 65px; }
	.rcol-plac input { width: 55px; }
	.rcol-cond { min-width: 120px; }
	.rcol-cond input { width: 110px; }
	.rcol-day { min-width: 42px; text-align: center; }
	.rcol-day input[type="number"] { width: 38px; }
	.rcol-tot { min-width: 50px; text-align: center; font-weight: 700; }
	.rcol-rec { min-width: 55px; }
	.rcol-rec input[type="number"] { width: 50px; }
	.mono { font-family: monospace; text-align: center; }
	.sticky-col { position: sticky; left: 0; z-index: 1; background: #fff; }
	.rtbl thead .sticky-col { z-index: 3; background: linear-gradient(135deg, #fff7ed, #ffedd5); }
	.totals-row td { background: #fff7ed !important; font-weight: 700; border-top: 2px solid #fed7aa; }
	.empty-rec { text-align: center; padding: 24px !important; color: #94a3b8; font-style: italic; font-size: 12px; }
	/* ── LIQUIDADOR ── */
	.liq-cfg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; padding: 0 0 12px; }
	.liq-cfg-item label { display: block; font-size: 10.5px; font-weight: 700; color: #475569; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .03em; }
	.liq-cfg-item input { width: 100%; padding: 7px 10px; border: 1.5px solid #e0e6ed; border-radius: 8px; font-size: 13px; background: #f8fafc; transition: border .15s; }
	.liq-cfg-item input:focus { border-color: #ea580c; background: #fff7ed; outline: none; }
	.liq-summary { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 10px 14px; background: #fff7ed; border-radius: 8px; font-size: 12px; color: #475569; border: 1px solid #ffedd5; }
	.liq-summary b { color: #9a3412; }
	.liq-total-badge { background: #9a3412; color: #fff; padding: 4px 14px; border-radius: 6px; font-weight: 800; font-size: 13px; margin-left: auto; }
	.liq-total-badge b { color: #fff; }
	.sl { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
	.stotal { display: flex; justify-content: space-between; align-items: center; padding: 10px 0 4px; font-size: 17px; font-weight: 800; color: #9a3412; }
	/* ── TERCEROS ── */
	.terc-tbl input { border: 1px solid #d1d9e0; border-radius: 6px; padding: 5px 6px; font-size: 11.5px; transition: border .15s; }
	.terc-tbl input:focus { border-color: #f97316; outline: none; box-shadow: 0 0 0 2px rgba(249,115,22,.15); }
	.terc-ss { min-width: 160px; }
	.terc-ss .ss-dropdown { min-width: 240px; max-height: 180px; }
	.terc-totals-row td { background: #fff7ed !important; border-top: 2px solid #fed7aa; font-weight: 700; font-size: 11.5px; }
	.btn-sync-terc { background: linear-gradient(135deg, #fff7ed, #ffedd5); color: #9a3412; border: 1px solid #fed7aa; border-radius: 8px; padding: 5px 14px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s; }
	.btn-sync-terc:hover { background: linear-gradient(135deg, #ffedd5, #fed7aa); }
	.btn-del-terc { background: none; border: none; cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: 4px; opacity: .5; transition: all .15s; }
	.btn-del-terc:hover { opacity: 1; background: #fee2e2; }
	/* ── REGISTRAR ── */
	.btn-registrar { display: block; width: 100%; margin-top: 20px; padding: 14px 28px; background: linear-gradient(135deg, #9a3412 0%, #c2410c 60%, #ea580c 100%); color: #fff; border: none; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; transition: all .2s; letter-spacing: .01em; box-shadow: 0 4px 20px rgba(154,52,18,.35); }
	.btn-registrar:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(154,52,18,.45); }
	.btn-registrar:disabled { opacity: .5; cursor: not-allowed; transform: none; box-shadow: none; }
	.save-error { margin-top: 10px; padding: 10px 14px; background: #fef2f2; color: #dc2626; border-radius: 8px; font-size: 12px; font-weight: 600; text-align: center; }
	/* ── DRAFT ── */
	.draft-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; border-radius: 20px; font-size: 11px; font-weight: 600; margin-bottom: 12px; }
	.draft-restored { margin-left: 4px; padding: 2px 8px; background: #fffbeb; color: #92400e; border: 1px solid #fbbf24; border-radius: 10px; font-size: 10px; font-weight: 700; }
	/* ── LOADING ── */
	.loading-center { display: flex; justify-content: center; align-items: center; padding: 48px; flex-direction: column; gap: 12px; }
	.spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #ea580c; border-radius: 50%; animation: spin .6s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.error-fallback { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 24px; text-align: center; }
	/* ── PDF VIEW ── */
	.pdf-wrap { position: fixed; inset: 0; background: #b0b8c2; z-index: 200; display: flex; flex-direction: column; overflow: hidden; }
	.pdf-bar { background: #1e2429; padding: 12px 22px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; box-shadow: 0 3px 16px rgba(0,0,0,.4); }
	.pdf-bar-l { display: flex; align-items: center; gap: 12px; }
	.pb-logo { height: 36px; object-fit: contain; filter: brightness(0) invert(1); opacity: .85; }
	.pb-t { color: #fff; font-weight: 700; font-size: 14px; }
	.pb-s { color: rgba(255,255,255,.45); font-size: 11px; font-family: monospace; margin-top: 1px; }
	.pbtn { border: none; border-radius: 8px; padding: 9px 20px; font-weight: 800; font-size: 13px; cursor: pointer; transition: all .15s; }
	.pbtn-back { background: rgba(255,255,255,.1); color: #fff; border: 1px solid rgba(255,255,255,.2); }
	.pbtn-back:hover { background: rgba(255,255,255,.18); }
	.pbtn-print { background: linear-gradient(135deg, #c2410c, #ea580c); color: #fff; box-shadow: 0 2px 12px rgba(194,65,12,.4); }
	.pbtn-print:hover { transform: translateY(-1px); }
	.page-tabs { display: flex; gap: 2px; background: rgba(255,255,255,.08); border-radius: 8px; padding: 2px; }
	.ptab { border: none; background: transparent; color: rgba(255,255,255,.55); padding: 6px 14px; font-size: 11px; font-weight: 700; border-radius: 6px; cursor: pointer; transition: all .15s; white-space: nowrap; }
	.ptab:hover { color: #fff; background: rgba(255,255,255,.1); }
	.ptab.active { background: rgba(255,255,255,.18); color: #fff; }
	.zoom-controls { display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,.08); border-radius: 8px; padding: 3px; }
	.zoom-btn { border: none; background: rgba(255,255,255,.12); color: #fff; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: center; transition: all .15s; }
	.zoom-btn:hover { background: rgba(255,255,255,.25); }
	.zoom-reset { font-size: 13px; width: 32px; }
	.zoom-label { color: rgba(255,255,255,.7); font-size: 11px; font-weight: 700; font-family: monospace; min-width: 38px; text-align: center; }
	.pdf-body { flex: 1; overflow-y: auto; padding: 28px 20px; display: flex; flex-direction: column; align-items: center; gap: 20px; }
	.pdf-body-landscape { align-items: center; overflow-x: auto; }
	/* ── A4 PAGE ── */
	.page { background: #fff; width: 297mm; max-width: 100%; padding: 12mm 15mm 13mm; font-size: 8.8pt; line-height: 1.35; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 8px 50px rgba(0,0,0,.3); border-radius: 2px; }
	.page-landscape { background: #fff; width: 1400px; max-width: none; padding: 10mm 12mm 12mm; font-size: 8pt; line-height: 1.3; font-family: Arial, Helvetica, sans-serif; box-shadow: 0 8px 50px rgba(0,0,0,.3); border-radius: 2px; }
	.dh { display: grid; grid-template-columns: auto 1fr auto auto; border: 2.5px solid #000; margin-bottom: 3.5px; }
	.dh-logo { border-right: 2px solid #000; padding: 8px 12px; display: flex; align-items: center; justify-content: center; min-width: 100px; }
	.dh-logo img { height: 58px; width: auto; object-fit: contain; }
	.dh-logo-fallback { width: 88px; height: 58px; background: #9a3412; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 7pt; font-weight: 900; text-align: center; line-height: 1.2; }
	.dh-title { padding: 7px 14px; display: flex; flex-direction: column; justify-content: center; }
	.dh-co { font-size: 11pt; font-weight: 900; color: #9a3412; text-transform: uppercase; letter-spacing: -.01em; }
	.dh-doc { font-size: 10pt; font-weight: 700; color: #333; margin-top: 3px; }
	.dh-meta { border-left: 2px solid #000; }
	.dh-super { border-left: 2px solid #000; padding: 4px 8px; display: flex; align-items: center; justify-content: center; min-width: 80px; }
	.dh-super img { height: 50px; width: auto; object-fit: contain; }
	.mt { width: 100%; border-collapse: collapse; height: 100%; }
	.mt td { padding: 3px 10px; font-size: 8pt; border-bottom: 1px solid #999; }
	.mt tr:last-child td { border-bottom: none; }
	.ml { font-weight: 700; background: #f5f5f5; border-right: 1px solid #bbb !important; color: #555; white-space: nowrap; }
	.mv { font-weight: 800; color: #9a3412; }
	.pb { border: 1.5px solid #000; margin-bottom: 3.5px; display: flex; flex-wrap: wrap; background: #fff7ed; font-size: 8.2pt; }
	.pc { padding: 4.5px 9px; border-right: 1px solid #999; display: flex; align-items: center; gap: 4px; white-space: nowrap; }
	.pc:last-child { border-right: none; flex: 1; }
	.pclabel { color: #666; font-weight: 600; font-size: 7.5pt; }
	.pcval { color: #9a3412; font-weight: 900; font-size: 9pt; }
	.pc-consec .pcval { color: #b00; font-family: monospace; font-size: 10pt; }
	.st { width: 100%; border-collapse: collapse; margin-bottom: 4px; font-size: 7.6pt; }
	.st th { background: #ffedd5; color: #9a3412; font-weight: 800; text-align: center; padding: 4px 3px; border: 1px solid #000; font-size: 6.8pt; text-transform: uppercase; line-height: 1.25; }
	.st td { border: 1px solid #bbb; padding: 3px 4px; vertical-align: middle; }
	.st tfoot td { border: 1.5px solid #000; background: #fff7ed; font-weight: 800; }
	.placa { font-family: monospace; font-weight: 900; font-size: 8pt; color: #9a3412; text-align: center; display: block; }
	.mc { text-align: right; font-family: monospace; font-size: 7.6pt; }
	.mch { text-align: right; font-family: monospace; font-size: 7.6pt; font-weight: 900; color: #9a3412; }
	.tc { text-align: center; }
	.filler td { height: 15px; }
	.bg { display: grid; grid-template-columns: 1fr 1fr; border: 1.5px solid #000; }
	.bl { border-right: 1px solid #999; padding: 8px 11px; font-size: 7.6pt; }
	.br { padding: 0; }
	.obs-t { font-weight: 900; font-size: 8pt; color: #9a3412; margin-bottom: 5px; text-transform: uppercase; }
	.obs-b { color: #333; font-size: 7.2pt; min-height: 30px; line-height: 1.5; }
	.op-row { display: flex; align-items: center; gap: 20px; margin-top: 8px; }
	.op-line { display: flex; align-items: center; gap: 6px; font-size: 8pt; }
	.opl { font-weight: 700; color: #555; }
	.opv { font-weight: 900; color: #9a3412; font-size: 9.5pt; }
	.pernote-box { margin-top: 7px; border: 1px solid #fed7aa; border-radius: 3px; overflow: hidden; }
	.pernote-hd-row { background: #ffedd5; display: grid; grid-template-columns: auto 1fr 1fr 1fr; font-size: 6.8pt; font-weight: 800; color: #9a3412; text-align: center; padding: 3px 6px; }
	.pernote-val-row { display: grid; grid-template-columns: auto 1fr 1fr 1fr; font-size: 7.5pt; text-align: center; padding: 3px 6px; }
	.stbl { width: 100%; border-collapse: collapse; font-size: 7.6pt; }
	.stbl td { padding: 3.5px 9px; border-bottom: 1px solid #e2e8e0; }
	.sla { font-weight: 600; color: #444; }
	.sva { font-family: monospace; font-weight: 700; text-align: right; }
	.slb { font-weight: 800; color: #222; font-size: 8pt; }
	.svb { font-family: monospace; font-weight: 800; text-align: right; font-size: 8pt; }
	.slhi { font-weight: 900; color: #9a3412; background: #fff7ed; font-size: 9pt; padding-top: 5px; padding-bottom: 5px; }
	.svhi { font-family: monospace; font-weight: 900; color: #9a3412; background: #fff7ed; text-align: right; font-size: 9pt; padding-top: 5px; padding-bottom: 5px; }
	.sep-row td { border-top: 2px solid #888 !important; padding-top: 5px; }
	.sigs { display: grid; grid-template-columns: 1fr 1fr; border: 1.5px solid #000; margin-top: 6px; }
	.sig { padding: 10px 13px 9px; display: flex; flex-direction: column; min-height: 80px; }
	.sig:first-child { border-right: 1px solid #888; }
	.sig-lbl { font-weight: 800; color: #9a3412; font-size: 8pt; margin-bottom: 4px; }
	.firma-img { display: block; max-height: 60px; max-width: 168px; object-fit: contain; margin: 0 auto 2px; }
	.sig-line { border-top: 1px solid #000; padding-top: 3px; color: #555; font-size: 7pt; font-style: italic; margin-top: auto; }
	.doc-ft { margin-top: 6px; display: flex; justify-content: space-between; font-size: 6.5pt; color: #aaa; border-top: 1px solid #eee; padding-top: 4px; }
	/* ── RECARGOS PDF ── */
	.rgt { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-top: 6px; table-layout: fixed; }
	.rgt th { background: linear-gradient(135deg, #fff7ed, #ffedd5); color: #9a3412; font-weight: 800; font-size: 7pt; text-transform: uppercase; padding: 5px 2px; border: .5px solid #fed7aa; text-align: center; overflow: hidden; }
	.rgt td { padding: 4px 2px; border: .5px solid #dde3eb; vertical-align: middle; font-size: 7pt; overflow: hidden; text-overflow: ellipsis; }
	.rgt-emp { width: 110px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.rgt-pla { width: 42px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.rgt-cnd { width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rgt-d { width: 22px; min-width: 22px; font-size: 6.5pt; text-align: center; }
	.rgt-t { width: 36px; min-width: 36px; font-weight: 700; }
	.rgt-totals td { background: #fff7ed !important; border-top: 1.5px solid #9a3412; font-weight: 800; }
	/* ── CONSOLIDADO RECARGOS ── */
	.crt { width: 100%; border-collapse: collapse; font-size: 7pt; }
	.crt th { background: linear-gradient(135deg, #fff7ed, #ffedd5); color: #9a3412; font-weight: 800; font-size: 6.5pt; text-transform: uppercase; letter-spacing: .03em; padding: 5px 4px; border: .5px solid #fed7aa; text-align: center; }
	.crt td { padding: 4px 4px; border: .5px solid #dde3eb; vertical-align: middle; }
	/* ── LIQUIDADOR PDF ── */
	.liq-salary-bar { margin: 8px 0 6px; padding: 8px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 8pt; }
	.liq-sal-row { display: flex; align-items: center; gap: 12px; padding: 2px 0; }
	.liq-sal-lbl { font-weight: 800; color: #9a3412; text-transform: uppercase; font-size: 7.5pt; }
	.liq-sal-val { font-family: monospace; font-weight: 700; font-size: 8.5pt; }
	.liq-tbl { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 6px; }
	.liq-tbl th { background: linear-gradient(135deg, #fff7ed, #ffedd5); color: #9a3412; font-weight: 800; font-size: 7.5pt; text-transform: uppercase; padding: 7px 6px; border: 1px solid #fed7aa; text-align: center; }
	.liq-tbl td { padding: 6px 6px; border: 1px solid #dde3eb; vertical-align: middle; }
	.liq-tbl tbody tr:hover td { background: #fffbf5; }
	.liq-sub-row td { background: #fff7ed !important; border-top: 1.5px solid #9a3412; }
	.liq-total-row td { background: #9a3412 !important; color: #fff !important; border-top: 2px solid #7c2d12; }
	/* ── TERCEROS PDF ── */
	.terc-prev-tbl { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-top: 6px; }
	.terc-prev-tbl th { background: #9a3412; color: #fff; padding: 5px 4px; font-weight: 700; text-align: center; font-size: 7pt; border: 1px solid #7c2d12; white-space: nowrap; }
	.terc-prev-tbl td { padding: 4px 4px; border: 1px solid #dde3eb; vertical-align: middle; }
	.terc-prev-tbl tbody tr:hover td { background: #fffbf5; }
	.terc-summary-box { margin-top: 14px; padding: 10px 14px; border: 2px solid #9a3412; border-radius: 6px; background: #f8fafc; }
	.terc-summary-tbl { width: 100%; border-collapse: collapse; font-size: 8pt; }
	.terc-summary-tbl td { padding: 5px 8px; }
	.ts-lbl { font-weight: 700; text-align: left; }
	.ts-val { font-weight: 800; text-align: right; font-family: monospace; font-size: 9pt; }
	.ts-sep td { border-top: 1.5px solid #e2e8f0; }
	.ts-total td { border-top: 2px solid #9a3412; background: #fff7ed; font-size: 9pt; }
	.ts-grand td { background: #9a3412; color: #fff; font-size: 10pt; border-radius: 0 0 4px 4px; }
	/* ── ESTADO BAR ── */
	.estado-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 18px; margin: 0 22px 14px; }
	.estado-badge { display: inline-flex; align-items: center; padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
	.estado-info { font-size: 12.5px; color: #475569; display: flex; align-items: center; gap: 4px; }
	.estado-info strong { color: #1e293b; }
	.btn-historial { margin-left: auto; background: linear-gradient(135deg, #9a3412, #c2410c); color: #fff; border: none; border-radius: 8px; padding: 7px 16px; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .15s; box-shadow: 0 2px 8px rgba(154,52,18,.25); }
	.btn-historial:hover { transform: translateY(-1px); }
	.btn-estado { padding: 6px 16px; border: 1.5px solid; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s; background: #fff; width: auto; }
	/* ── HISTORIAL ── */
	.historial-timeline { position: relative; padding-left: 24px; }
	.historial-timeline::before { content: ''; position: absolute; left: 7px; top: 8px; bottom: 8px; width: 2px; background: #e2e8f0; border-radius: 1px; }
	.historial-entry { position: relative; margin-bottom: 16px; }
	.historial-entry:last-child { margin-bottom: 0; }
	.historial-dot { position: absolute; left: -20px; top: 12px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid; box-shadow: 0 0 0 3px #fff; }
	.historial-entry-first .historial-dot { width: 14px; height: 14px; left: -21px; top: 11px; }
	.historial-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; }
	.historial-entry-first .historial-card { background: #fff7ed; border-color: #fed7aa; }
	.historial-tag { display: inline-flex; padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: .03em; }
	/* ── MODALS ── */
	.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px; }
	.modal-box { background: #fff; border-radius: 18px; max-width: 900px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 25px 60px rgba(0,0,0,.25); }
	.modal-hd { padding: 20px 24px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.modal-hd h3 { font-size: 16px; font-weight: 800; color: #9a3412; margin: 0; }
	.modal-close { background: #f1f5f9; border: none; border-radius: 8px; width: 32px; height: 32px; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
	.modal-close:hover { background: #e2e8f0; }
	.modal-body { padding: 20px 24px; }
	.print-check { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px; cursor: pointer; border: 1.5px solid #e2e8f0; background: #fff; margin-bottom: 8px; font-size: 13.5px; font-weight: 600; color: #1e293b; transition: all .15s; }
	.print-check:hover { border-color: #fed7aa; background: #fff7ed; }
	/* ── SUCCESS ── */
	.success-overlay { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, rgba(194,65,12,.95) 0%, rgba(234,88,12,.95) 100%); animation: successFadeIn .35s ease-out; }
	@keyframes successFadeIn { from { opacity:0 } to { opacity:1 } }
	.success-content { text-align: center; animation: successPop .5s cubic-bezier(.175,.885,.32,1.275) .1s both; }
	@keyframes successPop { from { opacity:0; transform:scale(.5) } to { opacity:1; transform:scale(1) } }
	.success-circle { width: 120px; height: 120px; margin: 0 auto 28px; background: rgba(255,255,255,.18); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
	.success-check { width: 72px; height: 72px; }
	.success-circle-bg { stroke-dasharray: 166; stroke-dashoffset: 166; animation: successStroke .6s ease .5s forwards; }
	.success-check-path { stroke-dasharray: 48; stroke-dashoffset: 48; animation: successStroke .4s ease .8s forwards; }
	@keyframes successStroke { to { stroke-dashoffset: 0 } }
	.success-title { font-size: 32px; font-weight: 800; color: #fff; margin: 0 0 8px; }
	.success-subtitle { font-size: 16px; color: rgba(255,255,255,.85); margin: 0; }
	/* ── PRINT ── */
	@media print {
		.pdf-bar { display: none !important; }
		.modal-bg { display: none !important; }
		.pdf-wrap { position: static !important; background: #fff !important; overflow: visible !important; display: block !important; }
		.pdf-body { padding: 0 !important; overflow: visible !important; background: #fff !important; display: block !important; }
		.pdf-body-landscape { overflow-x: visible !important; }
		.print-sheet { page-break-after: always; break-after: page; }
		.print-sheet:last-child { page-break-after: avoid; break-after: avoid; }
		.page { box-shadow: none; margin: 0; border-radius: 0; width: 100%; padding: 6mm 8mm; transform: none !important; }
		.page-landscape { box-shadow: none; margin: 0; border-radius: 0; width: 100%; padding: 4mm 5mm; transform: none !important; }
		.crt { font-size: 6pt; }
		.crt th { font-size: 5.5pt; padding: 3px 2px; }
		.crt td { font-size: 5.5pt; padding: 2px 2px; }
		.page-wrap { display: none !important; }
		.topbar { display: none !important; }
		.estado-bar { display: none !important; }
	}
</style>
