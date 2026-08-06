<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { apiClient } from '$lib/api/apiClient';
	import { authStore } from '$lib/stores/auth';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import {
		liquidacionesServiciosAPI,
		type EstadoLiquidacionServicio,
		type TipoRecargo,
		type HistorialEstado
	} from '$lib/api/liquidaciones-servicios';
	import { usuariosAPI, type Firmante } from '$lib/api/usuarios';
	import { tercerosAPI, type Tercero } from '$lib/api/terceros';
	import type { Vehiculo } from '$lib/types/nomina';
	import type { TipoServicioTarifa } from '$lib/api/liquidaciones-servicios.ts';

	// ─── PROPS ──────────────────────────────────────────────────
	/** If provided, loads this liquidación for editing on mount */
	export let editId: string | null = null;
	/** If true, opens directly into preview mode (from listado eye button) */
	export let viewMode = false;

	const BACK_URL = '/dashboard/liquidaciones-servicios';

	// ─── TYPES ──────────────────────────────────────────────────
	interface ClienteBasico {
		id: string;
		nit: string;
		nombre: string;
		tipo: string;
	}

	// ─── CONSTANTS ──────────────────────────────────────────────
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
	const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 1 + i);
	const TIPOS = [
		{
			label: 'TRANSPORTE DE PERSONAL EN CAMIONETA',
			value: 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA'
		},
		{
			label: 'TRANSPORTE DE PERSONAL EN BUSETA',
			value: 'TRANSPORTE_DE_PERSONAL_EN_BUSETA'
		},
		{
			label: 'TRANSPORTE DE PERSONAL EN MICROBUS',
			value: 'TRANSPORTE_DE_PERSONAL_EN_MICROBUS'
		},
		{
			label: 'TRANSPORTE DE PERSONAL EN BUS',
			value: 'TRANSPORTE_DE_PERSONAL_EN_BUS'
		},
		{
			label: 'TRANSPORTE ADICIONAL (HORA ADICIONAL)',
			value: 'TRANSPORTE_ADICIONAL_HORA_ADICIONAL'
		},
		{
			label: 'TRANSPORTE ADICIONAL (KM ADICIONAL)',
			value: 'TRANSPORTE_ADICIONAL_KM_ADICIONAL'
		},
		{
			label: 'TRANSPORTE ADICIONAL (DISPONIBILIDAD)',
			value: 'TRANSPORTE_ADICIONAL_DISPONIBILIDAD'
		}
	];

	// ─── HELPERS ────────────────────────────────────────────────
	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(parseFloat(String(v)) || 0);

	function fmtCOPInput(v: number | string): string {
		const n = parseFloat(String(v)) || 0;
		if (n === 0) return '';
		return '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
	}

	function fmtCOPDec(v: number | string): string {
		const n = parseFloat(String(v)) || 0;
		if (n === 0) return '';
		return (
			'$ ' +
			new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(
				n
			)
		);
	}

	function parseCOPInput(s: string): number {
		const cleaned = s
			.replace(/[^0-9,.\-]/g, '')
			.replace(/\./g, '')
			.replace(',', '.');
		return parseFloat(cleaned) || 0;
	}

	const fmtD = (s: string) => {
		if (!s) return '';
		const [y, m, d] = s.split('-');
		return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
	};

	// --- Fecha helpers: convert ISO dates to short textual form used by liquidador ---
	const MONTH_ABBR = [
		'ENE',
		'FEB',
		'MAR',
		'ABR',
		'MAY',
		'JUN',
		'JUL',
		'AGO',
		'SEP',
		'OCT',
		'NOV',
		'DIC'
	];
	function shortDateFromIso(s: string): string {
		if (!s) return '';
		if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(s).toUpperCase();
		const [, mm, dd] = s.split('-');
		const day = dd.padStart(2, '0');
		const mon = MONTH_ABBR[parseInt(mm, 10) - 1] || '';
		return `${day} ${mon}`;
	}
	function fechasFromPair(ini: string | undefined, fin: string | undefined): string {
		const a = shortDateFromIso(ini || '');
		const b = shortDateFromIso(fin || '');
		if (!a && !b) return '';
		if (a && b) return a === b ? a : `${a} - ${b}`;
		return a || b;
	}

	function getTipoLabel(val: string): string {
		if (!val) return '';
		const found = TIPOS.find((t) => t.value === val);
		return found ? found.label : val.replace(/_/g, ' ');
	}

	let uid = 0;
	const newRow = () => ({
		id: ++uid,
		placa: '',
		placa_search: '',
		placa_dropdown: false,
		placa_highlight: 0,
		fecha_ini: '',
		fecha_fin: '',
		recorrido: '',
		tipo: TIPOS[0].value,
		cant: 1,
		vr_unit: 0,
		dcto: 0,
		planilla: ''
	});

	// ─── DATA CATALOGS ──────────────────────────────────────────
	let clientes: ClienteBasico[] = [];
	let vehiculos: Vehiculo[] = [];
	let tiposRecargo: TipoRecargo[] = [];

	// ─── EDITOR STATE ───────────────────────────────────────────
	let view: 'editor' | 'preview' = 'editor';
	let previewPage: 'liquidacion' | 'recargos' | 'liquidador' | 'terceros' = 'liquidacion';

	// Sync view ↔ ?mode=view query param (replaceState so no history entry)
	function setView(v: 'editor' | 'preview') {
		const wasPreview = view === 'preview';
		view = v;
		// When switching to preview for the first time on a small viewport, fit to screen
		if (
			v === 'preview' &&
			!wasPreview &&
			typeof window !== 'undefined' &&
			window.innerWidth < 1280
		) {
			// Defer to next tick so the DOM has the new page
			setTimeout(() => fitToViewport(), 50);
		}
		if (!editId) return;
		const url = new URL($page.url);
		if (v === 'preview') {
			url.searchParams.set('mode', 'view');
		} else {
			url.searchParams.delete('mode');
		}
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
	let loadingLiq = !!editId; // Start loading immediately if editing

	// ─── PRINT STATE ────────────────────────────────────────────
	let printModalOpen = false;
	let isPrinting = false;
	let printSheets = { liquidacion: true, recargos: true, liquidador: true, terceros: true };

	// ─── ZOOM STATE (persisted in sessionStorage) ──────────────
	let pdfZoom = (() => {
		if (typeof sessionStorage !== 'undefined') {
			const saved = sessionStorage.getItem('liq_pdf_zoom');
			if (saved) return parseFloat(saved) || 1;
		}
		return 1;
	})();
	$: if (typeof sessionStorage !== 'undefined')
		sessionStorage.setItem('liq_pdf_zoom', String(pdfZoom));

	// ─── VIEWPORT INFO (for floating sheet behavior) ───────────
	let viewportWidth = 0;
	let viewportHeight = 0;

	function updateViewport() {
		if (typeof window === 'undefined') return;
		viewportWidth = window.innerWidth;
		viewportHeight = window.innerHeight;
	}

	// Resize observer to update viewport info
	let resizeObserver: ResizeObserver | null = null;

	// ─── FIRMANTES (signatures for PDF) ─────────────────────────
	let firmaGerencia: Firmante | null = null;
	let firmaFacturacion: Firmante | null = null;

	// ─── TRAZABILIDAD (audit trail) ─────────────────────────────
	let liqEstado: EstadoLiquidacionServicio = 'BORRADOR';
	let liqFechaLiquidacion: string | null = null;
	let liqFechaAprobacion: string | null = null;
	let liqFechaFacturacion: string | null = null;
	let liqLiquidadoPor: { id: string; nombre: string; correo: string } | null = null;
	let liqAprobadoPor: { id: string; nombre: string; correo: string } | null = null;
	let historialModalOpen = false;
	let historialData: HistorialEstado[] = [];
	let historialLoading = false;
	let csvLoading = false;
	let loadError = '';

	// Cliente searchable select
	let clienteSearch = '';
	let clienteDropdown = false;
	let clienteHighlight = 0;
	let selectedCliente: ClienteBasico | null = null;

	let hdr = {
		empresa: 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.',
		consecutivo: '',
		mes: MESES[new Date().getMonth()],
		anio: new Date().getFullYear(),
		operadora: 'PAREX',
		observaciones: '',
		osi: ''
	};

	let rows = [newRow()];

	// ─── CONSECUTIVO VALIDATION ─────────────────────────────────
	let consecStatus: 'idle' | 'checking' | 'available' | 'taken' = 'idle';
	let consecTimer: ReturnType<typeof setTimeout> | null = null;

	function onConsecInput() {
		consecStatus = 'idle';
		if (consecTimer) clearTimeout(consecTimer);
		const val = hdr.consecutivo.trim();
		if (!val) {
			consecStatus = 'idle';
			return;
		}
		consecStatus = 'checking';
		consecTimer = setTimeout(async () => {
			try {
				const res = await liquidacionesServiciosAPI.checkConsecutivo(val, editingId || undefined);
				// Only update if the value hasn't changed while we were checking
				if (hdr.consecutivo.trim() === val) {
					consecStatus = res.available ? 'available' : 'taken';
				}
			} catch {
				consecStatus = 'idle';
			}
		}, 500);
	}

	let ext = {
		trans_adic: 0,
		pernote_unit: 0,
		pernote_cant: 0,
		iva_pct: 0
	};

	// ─── AUTO-SAVE DRAFT CACHE ──────────────────────────────────
	function getDraftKey(id?: string | null): string {
		return id ? `liq-svc-draft-${id}` : 'liq-svc-draft-new';
	}
	const DEV = import.meta.env.DEV;
	let draftTimer: ReturnType<typeof setTimeout> | null = null;
	let draftSavedAt = '';
	let draftPaused = false;
	let draftDirty = false;
	let lastDraftHash = '';
	let serverSnapshot: any = null;
	let showDraftDebug = false;
	let draftAutoRestored = false;

	function hashStr(s: string): string {
		let h = 5381;
		for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
		return h.toString(36);
	}

	function buildDraftPayload() {
		return {
			ts: Date.now(),
			editingId,
			estadoSeleccionado,
			selectedCliente,
			hdr,
			rows: rows.map(({ placa_dropdown, placa_highlight, placa_search, ...rest }) => rest),
			ext,
			recargosRows: recargosRows.map(({ id, ...rest }) => rest),
			terceroRows,
			liqCfg
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
			lastDraftHash = h;
			draftDirty = true;
			const d = new Date();
			draftSavedAt = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
		} catch {
			/* localStorage full or SSR */
		}
	}

	function restoreDraft(forId?: string | null) {
		try {
			const key = getDraftKey(forId ?? editingId);
			const raw = localStorage.getItem(key);
			if (!raw) return false;
			const d = JSON.parse(raw);
			draftPaused = true;

			editingId = d.editingId ?? null;
			estadoSeleccionado = d.estadoSeleccionado ?? 'BORRADOR';
			selectedCliente = d.selectedCliente ?? null;
			clienteSearch = '';
			hdr = { ...hdr, ...d.hdr };
			rows = (d.rows || [newRow()]).map((r: any) => ({
				...r,
				id: ++uid,
				placa_dropdown: false,
				placa_highlight: 0,
				placa_search: ''
			}));
			ext = { ...ext, ...d.ext };
			liqCfg = { ...liqCfg, ...d.liqCfg };
			recargosRows = (d.recargosRows || []).map((r: any) => ({ ...r, id: ++uid }));
			terceroRows = (d.terceroRows || []).map((t: any) => ({ ...t }));

			setView('editor');
			draftAutoRestored = true;

			lastDraftHash = hashStr(raw);
			setTimeout(() => {
				draftPaused = false;
				draftDirty = true;
			}, 300);
			return true;
		} catch {
			return false;
		}
	}

	function clearDraft(forId?: string | null) {
		try {
			localStorage.removeItem(getDraftKey(forId ?? editingId));
		} catch {}
		draftSavedAt = '';
		draftDirty = false;
		lastDraftHash = '';
		draftAutoRestored = false;
	}

	/** Try to auto-restore a draft silently — returns true if restored */
	function tryAutoRestoreDraft(forId?: string | null) {
		try {
			const key = getDraftKey(forId);
			const raw = localStorage.getItem(key);
			if (!raw) return false;
			const d = JSON.parse(raw);
			const age = Date.now() - (d.ts || 0);
			if (age > 48 * 60 * 60 * 1000) {
				clearDraft(forId);
				return false;
			}
			const hasRows = d.rows && d.rows.length > 0 && d.rows.some((r: any) => r.placa);
			const hasCliente = !!d.selectedCliente;
			if (hasRows || hasCliente) {
				return restoreDraft(forId);
			} else {
				clearDraft(forId);
				return false;
			}
		} catch {
			clearDraft(forId);
			return false;
		}
	}

	function scheduleDraftSave() {
		if (draftPaused || view !== 'editor') return;
		if (draftTimer) clearTimeout(draftTimer);
		draftTimer = setTimeout(saveDraft, 2000);
	}

	$: if (view === 'editor' && !draftPaused) {
		void [
			hdr,
			rows,
			ext,
			recargosRows,
			terceroRows,
			liqCfg,
			selectedCliente,
			editingId,
			estadoSeleccionado
		];
		scheduleDraftSave();
	}

	function handleBeforeUnload(_e: BeforeUnloadEvent) {
		if (view === 'editor') saveDraft();
	}

	// ─── DEV DEBUG: Diff helper ─────────────────────────────────
	interface DiffEntry {
		field: string;
		server: any;
		cache: any;
	}

	function buildDiffEntries(): DiffEntry[] {
		if (!serverSnapshot) return [];
		const cached = buildDraftPayload();
		const diffs: DiffEntry[] = [];
		for (const k of Object.keys(cached.hdr)) {
			const sv = serverSnapshot.hdr?.[k] ?? '';
			const cv = (cached.hdr as any)[k] ?? '';
			if (JSON.stringify(sv) !== JSON.stringify(cv))
				diffs.push({ field: `hdr.${k}`, server: sv, cache: cv });
		}
		for (const k of Object.keys(cached.ext)) {
			const sv = serverSnapshot.ext?.[k] ?? 0;
			const cv = (cached.ext as any)[k] ?? 0;
			if (JSON.stringify(sv) !== JSON.stringify(cv))
				diffs.push({ field: `ext.${k}`, server: sv, cache: cv });
		}
		for (const k of Object.keys(cached.liqCfg)) {
			const sv = serverSnapshot.liqCfg?.[k] ?? '';
			const cv = (cached.liqCfg as any)[k] ?? '';
			if (JSON.stringify(sv) !== JSON.stringify(cv))
				diffs.push({ field: `liqCfg.${k}`, server: sv, cache: cv });
		}
		if (JSON.stringify(serverSnapshot.selectedCliente) !== JSON.stringify(cached.selectedCliente)) {
			diffs.push({
				field: 'selectedCliente',
				server: serverSnapshot.selectedCliente?.nombre ?? '(null)',
				cache: cached.selectedCliente?.nombre ?? '(null)'
			});
		}
		if ((serverSnapshot.rows?.length ?? 0) !== cached.rows.length) {
			diffs.push({
				field: 'rows.length',
				server: serverSnapshot.rows?.length ?? 0,
				cache: cached.rows.length
			});
		}
		const maxR = Math.max(serverSnapshot.rows?.length ?? 0, cached.rows.length);
		for (let i = 0; i < maxR; i++) {
			const sr = serverSnapshot.rows?.[i];
			const cr = cached.rows[i];
			for (const k of [
				'placa',
				'recorrido',
				'cant',
				'vr_unit',
				'dcto',
				'planilla',
				'fecha_ini',
				'fecha_fin'
			]) {
				const sv = sr?.[k] ?? '';
				const cv = (cr as Record<string, any>)?.[k] ?? '';
				if (JSON.stringify(sv) !== JSON.stringify(cv))
					diffs.push({ field: `rows[${i}].${k}`, server: sv, cache: cv });
			}
		}
		if ((serverSnapshot.recargosRows?.length ?? 0) !== cached.recargosRows.length) {
			diffs.push({
				field: 'recargosRows.length',
				server: serverSnapshot.recargosRows?.length ?? 0,
				cache: cached.recargosRows.length
			});
		}
		if ((serverSnapshot.terceroRows?.length ?? 0) !== cached.terceroRows.length) {
			diffs.push({
				field: 'terceroRows.length',
				server: serverSnapshot.terceroRows?.length ?? 0,
				cache: cached.terceroRows.length
			});
		}
		return diffs;
	}

	$: draftDiffEntries =
		DEV && showDraftDebug
			? (void [hdr, rows, ext, recargosRows, terceroRows, liqCfg, selectedCliente],
				buildDiffEntries())
			: [];

	// ─── PERMISSIONS ────────────────────────────────────────────
	$: userAreas = Array.isArray($authStore.user?.area)
		? $authStore.user.area
		: $authStore.user?.area
			? [$authStore.user.area]
			: [];
	$: isAdmin = userAreas.includes('administracion');
	$: canSeeTerceros = isAdmin || userAreas.includes('facturacion');

	// ─── MOUNT ──────────────────────────────────────────────────
	onMount(async () => {
		window.addEventListener('beforeunload', handleBeforeUnload);
		window.addEventListener('wheel', handleWheel, { passive: false });

		// Initialize viewport tracking
		updateViewport();
		window.addEventListener('resize', updateViewport);
		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => updateViewport());
			const target = document.body;
			if (target) resizeObserver.observe(target);
		}

		await cargarCatalogos();

		if (editId) {
			// Editing existing — load server data first, then auto-restore draft on top
			loadingLiq = true;
			try {
				await cargarParaEditar(editId);
				// Auto-restore draft silently (overwrites inputs with cached values)
				tryAutoRestoreDraft(editId);
				if (viewMode || $page.url.searchParams.get('mode') === 'view') {
					previewPage = 'liquidacion';
					setView('preview');
				}
			} catch (err: any) {
				console.error('Error loading liquidación:', err);
				loadError =
					err.message ||
					'No se pudo cargar la liquidación. Verifica tu conexión e intenta de nuevo.';
			} finally {
				loadingLiq = false;
			}
		} else {
			// New — auto-restore draft silently
			tryAutoRestoreDraft(null);
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined')
			window.removeEventListener('beforeunload', handleBeforeUnload);
		if (typeof window !== 'undefined') window.removeEventListener('resize', updateViewport);
		if (typeof window !== 'undefined') window.removeEventListener('wheel', handleWheel);
		if (resizeObserver) resizeObserver.disconnect();
		if (draftTimer) clearTimeout(draftTimer);
	});

	async function cargarCatalogos() {
		try {
			const [clientesRes, vehiculosRes, tiposRes, firmantesRes, tercerosRes] = await Promise.all([
				apiClient.get<{ data: ClienteBasico[] }>('/api/empresas/basicos'),
				apiClient.get<{ data: Vehiculo[] }>('/api/vehiculos'),
				liquidacionesServiciosAPI.obtenerTiposRecargo(),
				usuariosAPI.firmantes().catch(() => [] as Firmante[]),
				tercerosAPI.listar({
					page: 1,
					limit: 1000
				})
			]);
			clientes = clientesRes.data?.data || [];
			vehiculos = vehiculosRes.data?.data || [];
			tiposRecargo = tiposRes || [];
			firmaGerencia = firmantesRes.find((f: Firmante) => f.cargo === 'Gerencia') || null;
			firmaFacturacion = firmantesRes.find((f: Firmante) => f.cargo === 'Facturación') || null;
			tercerosList = tercerosRes.data || [];
		} catch (e) {
			console.error('Error cargando catálogos', e);
		}

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
					valor_hora_override: cfg.valor_hora_override ?? liqCfg.valor_hora_override
				};
			}
		} catch {
			/* usar defaults hardcoded si falla */
		}
	}

	/** Retry loading after an error */
	async function retryLoad() {
		if (!editId) return;
		loadError = '';
		loadingLiq = true;
		try {
			await cargarCatalogos();
			await cargarParaEditar(editId);
			tryAutoRestoreDraft(editId);
			if (viewMode || $page.url.searchParams.get('mode') === 'view') {
				previewPage = 'liquidacion';
				setView('preview');
			}
		} catch (err: any) {
			loadError =
				err.message || 'No se pudo cargar la liquidación. Verifica tu conexión e intenta de nuevo.';
		} finally {
			loadingLiq = false;
		}
	}

	// ─── HISTORIAL / TRAZABILIDAD ───────────────────────────────
	async function abrirHistorial() {
		if (!editingId) return;
		historialModalOpen = true;
		historialLoading = true;
		try {
			historialData = await liquidacionesServiciosAPI.obtenerHistorial(editingId);
		} catch (e) {
			console.error('Error cargando historial', e);
			historialData = [];
		} finally {
			historialLoading = false;
		}
	}

	// Obtener CSV
	async function obtenerCSV() {
		if (!editingId) return;
		csvLoading = true;
		try {
			const blob = await liquidacionesServiciosAPI.obtenerCSV(editingId);
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'Liquidacion_' + (hdr.consecutivo || editingId) + '.xlsx';
			document.body.appendChild(a);
			a.click();
			window.URL.revokeObjectURL(url);
			document.body.removeChild(a);
		} catch (e) {
			console.error('Error descargando Excel', e);
		} finally {
			csvLoading = false;
		}
	}

	function getEstadoBadge(estado: string) {
		const map: Record<string, { bg: string; text: string; border: string; label: string }> = {
			BORRADOR: { bg: 'rgba(100, 116, 139, 0.10)', text: '#475569', border: 'rgba(100, 116, 139, 0.22)', label: 'Borrador' },
			LIQUIDADA: { bg: 'rgba(249, 115, 22, 0.08)', text: '#ea580c', border: 'rgba(249, 115, 22, 0.25)', label: 'Liquidada' },
			APROBADA: { bg: 'rgba(249, 115, 22, 0.08)', text: '#ea580c', border: 'rgba(249, 115, 22, 0.25)', label: 'Aprobada' },
			FACTURADA: { bg: 'rgba(249, 115, 22, 0.10)', text: '#ea580c', border: 'rgba(249, 115, 22, 0.30)', label: 'Facturada' },
			ANULADA: { bg: 'rgba(220, 38, 38, 0.08)', text: '#dc2626', border: 'rgba(220, 38, 38, 0.25)', label: 'Anulada' }
		};
		return map[estado] || map.BORRADOR;
	}

	function fmtFecha(s: string | null | undefined) {
		if (!s) return '—';
		return (
			new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) +
			' ' +
			new Date(s).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
		);
	}

	/** Compact date for mobile/tablet — only dd/mm/yy, no time/author */
	function fmtFechaShort(s: string | null | undefined): string {
		if (!s) return '—';
		const d = new Date(s);
		const dd = String(d.getDate()).padStart(2, '0');
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const yy = String(d.getFullYear()).slice(-2);
		return `${dd}/${mm}/${yy}`;
	}

	async function cargarParaEditar(id: string) {
		const liq = await liquidacionesServiciosAPI.obtenerPorId(id);
		editingId = liq.id;
		hdr.consecutivo = liq.consecutivo || '';
		hdr.mes = MESES[(liq.mes || 1) - 1] || MESES[0];
		hdr.anio = liq.anio || new Date().getFullYear();
		hdr.observaciones = liq.observaciones || '';
		hdr.osi = liq.osi || '';
		hdr.operadora = liq.operadora || 'PAREX';

		// ── Trazabilidad state ──
		liqEstado = liq.estado || 'BORRADOR';
		liqFechaLiquidacion = liq.fecha_liquidacion || null;
		liqFechaAprobacion = liq.fecha_aprobacion || null;
		liqFechaFacturacion = liq.fecha_facturacion || null;
		liqLiquidadoPor = liq.liquidado_por || null;
		liqAprobadoPor = liq.aprobado_por || null;

		if (liq.cliente) {
			selectedCliente = {
				id: liq.cliente.id,
				nombre: liq.cliente.nombre,
				nit: liq.cliente.nit,
				tipo: ''
			};
		} else {
			selectedCliente = null;
		}
		clienteSearch = '';

		if (liq.items && liq.items.length > 0) {
			rows = liq.items.map((it) => ({
				id: ++uid,
				placa: it.placa || '',
				placa_search: '',
				placa_dropdown: false,
				placa_highlight: 0,
				fecha_ini: it.fecha_inicial ? it.fecha_inicial.split('T')[0] : '',
				fecha_fin: it.fecha_final ? it.fecha_final.split('T')[0] : '',
				recorrido: it.recorrido || '',
				tipo: it.tipo_servicio || '',
				cant: it.cantidad || 1,
				vr_unit: it.valor_unitario || 0,
				dcto: it.porcentaje_descuento || 0,
				planilla: it.numero_planilla || ''
			}));
		} else {
			rows = [newRow()];
		}

		ext = {
			trans_adic: liq.valor_transporte_adicional || 0,
			pernote_unit: 0,
			pernote_cant: 0,
			iva_pct: liq.porcentaje_iva || 0
		};

		ext.pernote_unit = liq.valor_unitario_pernoctes || 0;
		ext.pernote_cant = liq.cantidad_pernoctes || 0;

		if (liq.recargos_data) {
			const rd = liq.recargos_data as any;
			if (rd.rows && Array.isArray(rd.rows)) {
				recargosRows = rd.rows.map((r: any) => ({
					id: ++uid,
					empresa: r.empresa || '',
					planilla: r.planilla || '',
					placa: r.placa || '',
					conductor: r.conductor || '',
					days: Array.isArray(r.days) ? [...r.days] : Array(31).fill(0),
					total: r.total || 0,
					promedio: r.promedio || 0,
					hed: r.hed || 0,
					hen: r.hen || 0,
					hefd: r.hefd || 0,
					hefn: r.hefn || 0,
					rndf: r.rndf || 0,
					rn: r.rn || 0,
					rd: r.rd || 0
				}));
				for (const row of recargosRows) {
					recalcRecargoRow(row);
				}
			}
			if (rd.liqCfg) {
				liqCfg = {
					salario_basico: rd.liqCfg.salario_basico ?? 2210776,
					cargo: rd.liqCfg.cargo ?? 'Conductor',
					conductor_adicional: rd.liqCfg.conductor_adicional ?? 73693,
					prueba_covid: rd.liqCfg.prueba_covid ?? 0,
					pct_seg_social: rd.liqCfg.pct_seg_social ?? 22.96,
					pct_prestaciones: rd.liqCfg.pct_prestaciones ?? 21.83,
					pct_admin: rd.liqCfg.pct_admin ?? 8,
					valor_hora_override: rd.liqCfg.valor_hora_override ?? 0
				};
			}
			if (rd.terceroRows && Array.isArray(rd.terceroRows)) {
				terceroRows = rd.terceroRows.map((t: any, idx: number) => ({
					src_index: t.src_index ?? idx,
					placa: t.placa ?? (rows[idx]?.placa || ''),
					recorrido: t.recorrido ?? (rows[idx]?.recorrido || ''),
					nombre_tercero: t.nombre_tercero || '',
					tercero_id: t.tercero_id || '',
					tercero_identificacion: t.tercero_identificacion || '',
					tercero_tipo_persona: t.tercero_tipo_persona || '',
					fechas:
						(t.fechas ??
							fechasFromPair(t.fecha_ini, t.fecha_fin) ??
							fechasFromPair(rows[idx]?.fecha_ini, rows[idx]?.fecha_fin)) ||
						'',
					vr_unit: t.vr_unit ?? (parseFloat(String(rows[idx]?.vr_unit)) || 0),
					cant: t.cant ?? (parseFloat(String(rows[idx]?.cant)) || 1),
					pct_admin: t.pct_admin ?? 10,
					ingreso_extra_global: t.ingreso_extra_global ?? 0,
					ingresos_extra_aval: t.ingresos_extra_aval ?? 0
				}));
			}
		} else {
			recargosRows = [];
			terceroRows = [];
		}

		// Si hay terceros_items de la nueva tabla, usarlos (prioridad sobre recargos_data.terceroRows)
		if (liq.terceros_items && Array.isArray(liq.terceros_items) && liq.terceros_items.length > 0) {
			terceroRows = liq.terceros_items.map((t: any, idx: number) => ({
				src_index: t.src_index ?? idx,
				placa: t.placa || '',
				recorrido: t.recorrido || '',
				nombre_tercero: t.tercero?.nombre_completo || '',
				tercero_id: t.tercero_id || '',
				tercero_identificacion: t.tercero?.identificacion || '',
				tercero_tipo_persona: t.tercero?.tipo_persona || '',
				fechas: t.fechas || '',
				vr_unit: t.valor_unitario ?? 0,
				cant: t.cantidad ?? 1,
				pct_admin: t.porcentaje_admin ?? 10,
				ingreso_extra_global: t.ingreso_extra_global ?? 0,
				ingresos_extra_aval: t.ingresos_extra_aval ?? 0
			}));
		}

		// Don't force editor view here — onMount will set preview if ?mode=view
		view = 'editor';

		draftPaused = true;
		serverSnapshot = JSON.parse(JSON.stringify(buildDraftPayload()));
		lastDraftHash = hashStr(JSON.stringify(serverSnapshot));
		setTimeout(() => {
			draftPaused = false;
		}, 300);
	}

	// ─── CLIENTE SEARCHABLE SELECT ──────────────────────────────
	$: clientesFiltrados = clientes.filter((c) => {
		if (!clienteSearch) return true;
		const q = clienteSearch.toLowerCase();
		return c.nombre.toLowerCase().includes(q) || (c.nit || '').toLowerCase().includes(q);
	});
	$: (clienteSearch, (clienteHighlight = 0));

	function selectCliente(c: ClienteBasico) {
		selectedCliente = c;
		clienteSearch = '';
		clienteDropdown = false;
	}
	function clearCliente() {
		selectedCliente = null;
		clienteSearch = '';
	}

	// ─── PLACA SEARCHABLE (per row) ─────────────────────────────
	function placasFiltradas(search: string) {
		if (!search) return vehiculos;
		const q = search.toLowerCase();
		return vehiculos.filter(
			(v) => v.placa.toLowerCase().includes(q) || (v.marca || '').toLowerCase().includes(q)
		);
	}

	// El dropdown de placa se renderiza a nivel de body con `position: fixed`
	// porque el contenedor `.tbl-s` tiene `overflow-x: auto` (lo que por
	// especificación CSS fuerza `overflow-y: auto`) y clipea el dropdown.
	// Mismo patrón que `SelectBuscable` en servicios/+page.svelte pero en
	// posición fixed porque no podemos escapar del scroll container.
	let placaDropdownPos = { top: 0, left: 0, width: 160 };
	let activePlacaRowId: number | null = null;
	$: activePlacaRow = activePlacaRowId
		? rows.find((r) => r.id === activePlacaRowId && r.placa_dropdown && r.placa_search?.length > 0)
		: null;

	function updatePlacaDropdownPos(rowId: number) {
		const el = document.querySelector<HTMLElement>(`[data-placa-input-row-id="${rowId}"]`);
		if (!el) return;
		const rect = el.getBoundingClientRect();
		placaDropdownPos = {
			top: rect.bottom + 4,
			left: rect.left,
			width: Math.max(rect.width, 160)
		};
	}

	function openPlacaDropdown(rowId: number) {
		activePlacaRowId = rowId;
		tick().then(() => updatePlacaDropdownPos(rowId));
	}

	function selectPlacaAndClose(rowId: number, v: Vehiculo) {
		selectPlaca(rowId, v);
		activePlacaRowId = null;
	}

	function handlePlacaBlur(rowId: number) {
		// Pequeño delay para permitir clicks en opciones antes de cerrar
		setTimeout(() => {
			const r = rows.find((r) => r.id === rowId);
			if (r) r.placa_dropdown = false;
			if (activePlacaRowId === rowId) activePlacaRowId = null;
		}, 180);
	}

	function selectPlaca(rowId: number, v: Vehiculo) {
		rows = rows.map((r) =>
			r.id === rowId ? { ...r, placa: v.placa, placa_search: '', placa_dropdown: false } : r
		);
	}
	function clearPlaca(rowId: number) {
		rows = rows.map((r) => (r.id === rowId ? { ...r, placa: '', placa_search: '' } : r));
	}

	// ─── ROW ACTIONS ────────────────────────────────────────────
	function addRow() {
		rows = [...rows, newRow()];
	}
	function delRow(id: number) {
		rows = rows.filter((r) => r.id !== id);
	}
	function updRow(id: number, k: string, v: any) {
		rows = rows.map((r) => (r.id === id ? { ...r, [k]: v } : r));
	}

	// ─── CALCULATIONS ───────────────────────────────────────────
	function calcRow(r: (typeof rows)[0]) {
		const sub = (parseFloat(String(r.cant)) || 0) * (parseFloat(String(r.vr_unit)) || 0);
		return { sub, vf: sub * (1 - (parseFloat(String(r.dcto)) || 0) / 100) };
	}

	$: totalSvc = rows.reduce((a, r) => a + calcRow(r).vf, 0);
	$: valRec = liqTotal;
	$: valPern =
		(parseFloat(String(ext.pernote_unit)) || 0) * (parseFloat(String(ext.pernote_cant)) || 0);
	$: subtotal = totalSvc + valRec + valPern;
	$: ivaVal = subtotal * ((parseFloat(String(ext.iva_pct)) || 0) / 100);
	$: total = subtotal + ivaVal;

	// ─── RECARGOS ───────────────────────────────────────────────
	interface RecargoRow {
		id: number;
		empresa: string;
		planilla: string;
		placa: string;
		conductor: string;
		days: number[];
		total: number;
		promedio: number;
		hed: number;
		hen: number;
		hefd: number;
		hefn: number;
		rndf: number;
		rn: number;
		rd: number;
	}

	let recargosRows: RecargoRow[] = [];

	function newRecargoRow(): RecargoRow {
		return {
			id: ++uid,
			empresa: '',
			planilla: '',
			placa: '',
			conductor: '',
			days: Array(31).fill(0),
			total: 0,
			promedio: 0,
			hed: 0,
			hen: 0,
			hefd: 0,
			hefn: 0,
			rndf: 0,
			rn: 0,
			rd: 0
		};
	}

	function addRecargoRow() {
		recargosRows = [...recargosRows, newRecargoRow()];
	}
	function delRecargoRow(id: number) {
		recargosRows = recargosRows.filter((r) => r.id !== id);
	}

	function recalcRecargoRow(row: RecargoRow) {
		const daysUsed = 31;
		row.total = row.days.slice(0, daysUsed).reduce((s, v) => s + (v || 0), 0);
		const daysWithHours = row.days.slice(0, daysUsed).filter((v) => v > 0).length;
		row.promedio = daysWithHours > 0 ? row.total / daysWithHours : 0;
	}

	function updRecargoDay(rowId: number, dayIdx: number, val: string) {
		recargosRows = recargosRows.map((r) => {
			if (r.id !== rowId) return r;
			const newDays = [...r.days];
			newDays[dayIdx] = parseFloat(val.replace(',', '.')) || 0;
			const updated = { ...r, days: newDays };
			recalcRecargoRow(updated);
			return updated;
		});
	}

	function updRecargoField(rowId: number, field: string, val: string) {
		recargosRows = recargosRows.map((r) => {
			if (r.id !== rowId) return r;
			if (['hed', 'hen', 'hefd', 'hefn', 'rndf', 'rn', 'rd'].includes(field)) {
				return { ...r, [field]: parseFloat(val.replace(',', '.')) || 0 };
			}
			return { ...r, [field]: val };
		});
	}

	$: recargosTotals = (() => {
		const t = {
			days: Array(31).fill(0),
			total: 0,
			hed: 0,
			hen: 0,
			hefd: 0,
			hefn: 0,
			rndf: 0,
			rn: 0,
			rd: 0
		};
		for (const r of recargosRows) {
			for (let i = 0; i < 31; i++) t.days[i] += r.days[i] || 0;
			t.total += r.total || 0;
			t.hed += r.hed || 0;
			t.hen += r.hen || 0;
			t.hefd += r.hefd || 0;
			t.hefn += r.hefn || 0;
			t.rndf += r.rndf || 0;
			t.rn += r.rn || 0;
			t.rd += r.rd || 0;
		}
		return t;
	})();

	// ─── LIQUIDADOR DE RECARGOS (Hoja 3) ────────────────────────
	let liqCfg = {
		salario_basico: 2210776,
		cargo: 'Conductor',
		conductor_adicional: 73693,
		prueba_covid: 0,
		pct_seg_social: 22.96,
		pct_prestaciones: 21.83,
		pct_admin: 8,
		valor_hora_override: 0 as number
	};

	$: valorHoraAuto = liqCfg.salario_basico > 0 ? liqCfg.salario_basico / 220 : 0;
	$: valorHora = liqCfg.valor_hora_override > 0 ? liqCfg.valor_hora_override : valorHoraAuto;

	function fmtDec1(n: number): string {
		return n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	}

	/** Formatea placa insertando guión: ABC123 → ABC-123 */
	function fmtPlaca(p: string): string {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s || '—';
	}

	const codigoToField: Record<string, string> = {
		HED: 'hed',
		HEN: 'hen',
		HEFD: 'hefd',
		HEFN: 'hefn',
		RNDF: 'rndf',
		RN: 'rn',
		RD: 'rd'
	};

	const fallbackTipos = [
		{
			codigo: 'HED',
			nombre: 'Hora Extra Diurna',
			porcentaje: 25,
			es_hora_extra: true,
			adicional: false
		},
		{
			codigo: 'HEN',
			nombre: 'Hora Extra Nocturna',
			porcentaje: 75,
			es_hora_extra: true,
			adicional: false
		},
		{
			codigo: 'RN',
			nombre: 'Recargo Nocturno',
			porcentaje: 35,
			es_hora_extra: false,
			adicional: false
		},
		{
			codigo: 'HEFD',
			nombre: 'Hora Extra Festiva Diurna',
			porcentaje: 100,
			es_hora_extra: true,
			adicional: false
		},
		{
			codigo: 'HEFN',
			nombre: 'Hora Extra Festiva Nocturna',
			porcentaje: 150,
			es_hora_extra: true,
			adicional: false
		},
		{
			codigo: 'RNDF',
			nombre: 'Recargo Dom/Fest Nocturno',
			porcentaje: 110,
			es_hora_extra: false,
			adicional: true
		},
		{
			codigo: 'RD',
			nombre: 'Recargo Dominical/Festivo',
			porcentaje: 75,
			es_hora_extra: false,
			adicional: true
		}
	];

	$: liqLineas = (() => {
		const vh = valorHora;
		const t = recargosTotals;
		const tipos = tiposRecargo.length > 0 ? tiposRecargo : fallbackTipos;
		const lineas: { desc: string; pct: string; vrUnit: number; horas: number; total: number }[] = [
			{
				desc: 'CONDUCTOR ADICIONAL',
				pct: '',
				vrUnit: liqCfg.conductor_adicional,
				horas: 0,
				total: 0
			}
		];
		for (const tipo of tipos) {
			const field = codigoToField[tipo.codigo];
			if (!field) continue;
			const horas = (t as any)[field] || 0;
			const pct = tipo.porcentaje;
			const vrUnit = tipo.es_hora_extra || tipo.adicional ? vh * (1 + pct / 100) : vh * (pct / 100);
			const totalVal = vrUnit * horas;
			lineas.push({
				desc: `${tipo.nombre.toUpperCase()} ${pct}%`,
				pct: `${pct}%`,
				vrUnit,
				horas,
				total: totalVal
			});
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

	// ─── TERCEROS (Hoja 4) ──────────────────────────────────────
	interface TerceroRow {
		src_index: number;
		placa: string;
		recorrido: string;
		nombre_tercero: string;
		tercero_id: string;
		tercero_identificacion: string;
		tercero_tipo_persona: string;
		// unified textual fechas field (e.g. "13 FEB" or "13 FEB - 15 FEB")
		fechas: string;
		vr_unit: number;
		cant: number;
		pct_admin: number;
		ingreso_extra_global: number;
		ingresos_extra_aval: number;
	}

	let terceroRows: TerceroRow[] = [];

	function syncTerceroRows() {
		while (terceroRows.length < rows.length) {
			const idx = terceroRows.length;
			const srcRow = rows[idx];
			terceroRows.push({
				src_index: idx,
				placa: srcRow?.placa || '',
				recorrido: srcRow?.recorrido || '',
				nombre_tercero: '',
				tercero_id: '',
				tercero_identificacion: '',
				tercero_tipo_persona: '',
				fechas: fechasFromPair(srcRow?.fecha_ini, srcRow?.fecha_fin) || '',
				vr_unit: parseFloat(String(srcRow?.vr_unit)) || 0,
				cant: parseFloat(String(srcRow?.cant)) || 1,
				pct_admin: 10,
				ingreso_extra_global: 0,
				ingresos_extra_aval: 0
			});
		}
		terceroRows = terceroRows;
	}
	$: (rows.length, syncTerceroRows());

	function delTerceroRow(idx: number) {
		terceroRows = terceroRows.filter((_, i) => i !== idx);
	}

	function resetTerceroFromItems() {
		terceroRows = rows.map((r, i) => ({
			src_index: i,
			placa: r.placa || '',
			recorrido: r.recorrido || '',
			nombre_tercero: terceroRows[i]?.nombre_tercero || '',
			tercero_id: terceroRows[i]?.tercero_id || '',
			tercero_identificacion: terceroRows[i]?.tercero_identificacion || '',
			tercero_tipo_persona: terceroRows[i]?.tercero_tipo_persona || '',
			fechas: terceroRows[i]?.fechas || fechasFromPair(r.fecha_ini, r.fecha_fin) || '',
			vr_unit: parseFloat(String(r.vr_unit)) || 0,
			cant: parseFloat(String(r.cant)) || 1,
			pct_admin: terceroRows[i]?.pct_admin ?? 10,
			ingreso_extra_global: 0,
			ingresos_extra_aval: terceroRows[i]?.ingresos_extra_aval ?? 0
		}));
	}

	function getTerceroNombre(placa: string, idx: number): string {
		if (terceroRows[idx]?.nombre_tercero) return terceroRows[idx].nombre_tercero;
		const v = vehiculos.find((veh) => veh.placa === placa) as any;
		return v?.propietario_nombre || '';
	}

	function levenshtein(a: string, b: string): number {
		const m = a.length,
			n = b.length;
		const dp = Array.from({ length: m + 1 }, (_, i) =>
			Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
		);
		for (let i = 1; i <= m; i++)
			for (let j = 1; j <= n; j++)
				dp[i][j] =
					a[i - 1] === b[j - 1]
						? dp[i - 1][j - 1]
						: 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
		return dp[m][n];
	}

	function wordSim(w: string, candidates: string[]): number {
		// Para cada palabra del candidato, busca el mejor match en el placeholder
		return Math.max(
			...candidates.map((c) => {
				if (c === w) return 1;
				const maxLen = Math.max(w.length, c.length);
				return (maxLen - levenshtein(w, c)) / maxLen;
			})
		);
	}

	function scoreNombre(a: string, b: string): number {
		const norm = (s: string) =>
			s
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '')
				.trim();
		const na = norm(a),
			nb = norm(b);
		if (na === nb) return 1;

		const wa = na.split(/\s+/); // placeholder: ["murales","romero","nelly","maria"]
		const wb = nb.split(/\s+/); // candidato:   ["nelly","morales"]

		const totalScore = wb.reduce((sum, w) => sum + wordSim(w, wa), 0);
		return totalScore / wb.length;
	}

	// ─── TERCERO SEARCHABLE SELECT ──────────────────────────────
	interface TerceroOption {
		id: string;
		nombre_completo: string;
		identificacion: string | null;
		tipo_persona: 'PERSONA' | 'EMPRESA';
	}
	let tercerosList: Tercero[] = [];
	let terceroSearchIdx = -1; // which row has open dropdown (-1 = none)
	let terceroSearchText = '';
	let terceroResults: TerceroOption[] = [];
	let terceroSearching = false;
	let terceroSearchTimer: ReturnType<typeof setTimeout> | null = null;
	let terceroHighlight = 0;

	function openTerceroSearch(idx: number) {
		terceroSearchIdx = idx;
		terceroSearchText = '';
		terceroResults = [];
		terceroHighlight = 0;
	}
	function closeTerceroSearch() {
		terceroSearchIdx = -1;
		terceroSearchText = '';
		terceroResults = [];
	}

	function onTerceroInput(idx: number) {
		terceroSearchIdx = idx;
		terceroHighlight = 0;
		if (terceroSearchTimer) clearTimeout(terceroSearchTimer);
		if (terceroSearchText.length < 1) {
			terceroResults = [];
			return;
		}
		terceroSearchTimer = setTimeout(async () => {
			terceroSearching = true;
			try {
				terceroResults = await tercerosAPI.buscar(terceroSearchText);
			} catch {
				terceroResults = [];
			} finally {
				terceroSearching = false;
			}
		}, 250);
	}

	function selectTercero(idx: number, t: TerceroOption) {
		terceroRows[idx].tercero_id = t.id;
		terceroRows[idx].nombre_tercero = t.nombre_completo;
		terceroRows[idx].tercero_identificacion = t.identificacion || '';
		terceroRows[idx].tercero_tipo_persona = t.tipo_persona || '';
		terceroRows = terceroRows;
		closeTerceroSearch();
	}

	function clearTercero(idx: number) {
		terceroRows[idx].tercero_id = '';
		terceroRows[idx].nombre_tercero = '';
		terceroRows[idx].tercero_identificacion = '';
		terceroRows[idx].tercero_tipo_persona = '';
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
		const ingresoCotransmeq = extraGlobal - extraAval;
		return { totalRow, admon, vLiquidar, extraGlobal, extraAval, ingresoCotransmeq, pctAdmin };
	});

	$: tercTotalFacturado = terceroCalcs.reduce((s, c) => s + c.totalRow, 0);
	$: tercTotalAdmon = terceroCalcs.reduce((s, c) => s + c.admon, 0);
	$: tercTotalVLiquidar = terceroCalcs.reduce((s, c) => s + c.vLiquidar, 0);
	$: tercTotalExtraGlobal = terceroCalcs.reduce((s, c) => s + c.extraGlobal, 0);
	$: tercTotalExtraAval = terceroCalcs.reduce((s, c) => s + c.extraAval, 0);
	$: tercTotalIngresoTrans = terceroCalcs.reduce((s, c) => s + c.ingresoCotransmeq, 0);

	$: tercIngresoTotalTercero = tercTotalVLiquidar;
	$: tercAdminCotransmeq = tercTotalAdmon;
	$: tercIngresoExtraTrans = tercTotalIngresoTrans;
	$: tercIngresoTotalCotransmeq = tercAdminCotransmeq + tercTotalExtraGlobal + valRec + valPern;
	$: tercValorTotalFacturar = tercIngresoTotalTercero + tercIngresoTotalCotransmeq;

	// Grouped summary: unique placas with propietario, documento, tipo, cantidad de items
	interface TerceroPlacaGroup {
		placa: string;
		nombre: string;
		identificacion: string;
		tipo: string;
		items: number;
		totalFacturado: number;
		vLiquidar: number;
	}
	$: terceroPlacasGroup = (() => {
		const map = new Map<string, TerceroPlacaGroup>();
		terceroRows.forEach((t, i) => {
			const key = t.placa || `sin-placa-${i}`;
			const calc = terceroCalcs[i];
			if (map.has(key)) {
				const g = map.get(key)!;
				g.items += 1;
				g.totalFacturado += calc?.totalRow || 0;
				g.vLiquidar += calc?.vLiquidar || 0;
			} else {
				const nombre = t.nombre_tercero || getTerceroNombre(t.placa, i) || '';
				const identificacion = t.tercero_identificacion || '';
				const tipo = t.tercero_tipo_persona || '';
				map.set(key, {
					placa: t.placa,
					nombre,
					identificacion,
					tipo,
					items: 1,
					totalFacturado: calc?.totalRow || 0,
					vLiquidar: calc?.vLiquidar || 0
				});
			}
		});
		return Array.from(map.values());
	})();
	// Paste handler for recargos
	function handleRecargosPaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text/plain');
		if (!text) return;
		const lines = text.split('\n').filter((l) => l.trim());
		if (lines.length === 0) return;
		const firstCols = lines[0].split('\t');
		if (firstCols.length < 10) return;
		e.preventDefault();
		const parsed: RecargoRow[] = [];
		for (const line of lines) {
			const cols = line.split('\t');
			if (cols.length < 10) continue;
			const row = newRecargoRow();
			row.empresa = cols[0]?.trim() || '';
			row.planilla = cols[1]?.trim() || '';
			row.placa = cols[2]?.trim() || '';
			row.conductor = cols[3]?.trim() || '';
			for (let i = 0; i < 31; i++) {
				const v = cols[4 + i]?.trim() || '';
				row.days[i] = parseFloat(v.replace(',', '.')) || 0;
			}
			const off = 35;
			row.hed = parseFloat((cols[off + 2] || '').replace(',', '.')) || 0;
			row.hen = parseFloat((cols[off + 3] || '').replace(',', '.')) || 0;
			row.hefd = parseFloat((cols[off + 4] || '').replace(',', '.')) || 0;
			row.hefn = parseFloat((cols[off + 5] || '').replace(',', '.')) || 0;
			row.rndf = parseFloat((cols[off + 6] || '').replace(',', '.')) || 0;
			row.rn = parseFloat((cols[off + 7] || '').replace(',', '.')) || 0;
			row.rd = parseFloat((cols[off + 8] || '').replace(',', '.')) || 0;
			recalcRecargoRow(row);
			parsed.push(row);
		}
		if (parsed.length > 0) {
			recargosRows = [...recargosRows, ...parsed];
		}
	}

	// ─── REGISTRAR / ACTUALIZAR ─────────────────────────────────
	async function registrarLiquidacion() {
		saveError = '';
		showSuccessAnim = false;
		if (!selectedCliente) {
			saveError = 'Selecciona un cliente';
			return;
		}
		if (rows.length === 0) {
			saveError = 'Agrega al menos un ítem';
			return;
		}
		if (rows.some((r) => !r.placa)) {
			saveError = 'Selecciona la placa en todos los ítems';
			return;
		}

		saving = true;
		try {
			const mesIdx = MESES.indexOf(hdr.mes) + 1;
			const payload = {
				cliente_id: selectedCliente.id,
				consecutivo: hdr.consecutivo || undefined,
				mes: mesIdx,
				anio: hdr.anio,
				items: rows.map((r, idx) => {
					return {
						placa: r.placa,
						fecha_inicial: r.fecha_ini || `${hdr.anio}-${String(mesIdx).padStart(2, '0')}-01`,
						fecha_final: r.fecha_fin || `${hdr.anio}-${String(mesIdx).padStart(2, '0')}-01`,
						recorrido: r.recorrido || 'N/A',
						tipo_servicio: r.tipo as TipoServicioTarifa,
						cantidad: parseFloat(String(r.cant)) || 1,
						valor_unitario: parseFloat(String(r.vr_unit)) || 0,
						porcentaje_descuento: parseFloat(String(r.dcto)) || 0,
						numero_planilla: r.planilla || undefined,
						cantidad_pernoctes: 0,
						valor_pernocte_unitario: 0,
						tercero_id: terceroRows[idx]?.tercero_id || null
					};
				}),
				porcentaje_iva: parseFloat(String(ext.iva_pct)) || 0,
				observaciones: hdr.observaciones || undefined,
				osi: hdr.osi || undefined,
				operadora: hdr.operadora,
				valor_transporte_adicional: 0,
				valor_recargos: valRec,
				valor_pernoctes: ext.pernote_unit * ext.pernote_cant,
				valor_unitario_pernoctes: ext.pernote_unit,
				cantidad_pernoctes: ext.pernote_cant,
				recargos_data: {
					rows: recargosRows,
					liqCfg,
					terceroRows
				},
				terceros_items: terceroRows.map((t, i) => {
					const calc = terceroCalcs[i];
					return {
						tercero_id: t.tercero_id || null,
						placa: t.placa,
						recorrido: t.recorrido || 'N/A',
						fechas: t.fechas || '',
						valor_unitario: parseFloat(String(t.vr_unit)) || 0,
						cantidad: parseFloat(String(t.cant)) || 0,
						porcentaje_admin: parseFloat(String(t.pct_admin)) || 0,
						ingreso_extra_global: calc?.extraGlobal || 0,
						ingresos_extra_aval: parseFloat(String(t.ingresos_extra_aval)) || 0,
						ingreso_empresa: calc?.ingresoCotransmeq || 0,
						src_index: t.src_index ?? i
					};
				})
			};

			if (editingId) {
				await liquidacionesServiciosAPI.actualizar(editingId, payload);
				clearDraft();
				successMsg = '¡Liquidación actualizada!';
				successSub = 'Los cambios se guardaron correctamente';
				showSuccessAnim = true;
				setTimeout(() => {
					showSuccessAnim = false;
					goto(BACK_URL);
				}, 2200);
			} else {
				await liquidacionesServiciosAPI.crear(payload);
				clearDraft();
				successMsg = '¡Liquidación creada!';
				successSub = 'Se registró correctamente en el sistema';
				showSuccessAnim = true;
				setTimeout(() => {
					showSuccessAnim = false;
					goto(BACK_URL);
				}, 2200);
			}
		} catch (err: any) {
			saveError = err.message || 'Error al registrar';
		} finally {
			saving = false;
		}
	}

	function handlePrint() {
		// Reset selections: all checked by default (terceros only if permission)
		printSheets = { liquidacion: true, recargos: true, liquidador: true, terceros: canSeeTerceros };
		printModalOpen = true;
	}

	function executePrint() {
		printModalOpen = false;
		isPrinting = true;
		// Wait for DOM to render all selected sheets
		setTimeout(() => {
			window.print();
			// Restore after print dialog closes
			setTimeout(() => {
				isPrinting = false;
			}, 300);
		}, 150);
	}

	function toggleAllSheets(checked: boolean) {
		printSheets = {
			liquidacion: checked,
			recargos: checked,
			liquidador: checked,
			terceros: canSeeTerceros ? checked : false
		};
	}

	// ─── FIT TO VIEWPORT (one-shot zoom helper) ─────────────────
	// A4 landscape: 297mm × 210mm → 1123px wide at 96dpi (todas las hojas son landscape)
	const LANDSCAPE_WIDTH_PX = 297 * 3.78;

	function fitToViewport() {
		if (typeof window === 'undefined' || viewportWidth <= 0) return;
		// Todas las hojas son A4 landscape
		const pageWidth = LANDSCAPE_WIDTH_PX;
		// Account for body padding (~20px on each side)
		const padding = 40;
		const availableWidth = Math.max(280, viewportWidth - padding);
		// Leave a small margin so the user knows they can scroll
		const targetWidth = availableWidth * 0.95;
		pdfZoom = Math.max(0.3, Math.min(2.5, targetWidth / pageWidth));
	}

	// ─── CMD/CTRL + WHEEL ZOOM (only in preview view) ───────────
	function handleWheel(e: WheelEvent) {
		if (!(e.ctrlKey || e.metaKey)) return;
		if (view !== 'preview') return;
		e.preventDefault();
		const delta = e.deltaY < 0 ? 0.05 : -0.05;
		pdfZoom = Math.max(0.3, Math.min(2.5, pdfZoom + delta));
	}

	$: printSheetCount = [
		printSheets.liquidacion,
		printSheets.recargos,
		printSheets.liquidador,
		printSheets.terceros
	].filter(Boolean).length;

	function handleCancel() {
		clearDraft(editId);
		goto(BACK_URL);
	}

	// ─── WORKBOOK KEYBOARD NAV ────────────────────────────────────
	let wbScrollEl: HTMLElement;
	let activeCellKey = '';

	function colLetter(idx: number): string {
		let s = '';
		let n = idx;
		while (n >= 0) {
			s = String.fromCharCode(65 + (n % 26)) + s;
			n = Math.floor(n / 26) - 1;
		}
		return s;
	}

	function handleWbKeydown(e: KeyboardEvent) {
		if (!e.target) return;
		const target = e.target as HTMLElement;
		const cell = target.closest('[data-cell-key]') as HTMLElement | null;
		if (!cell) return;

		const key = cell.getAttribute('data-cell-key') || '';
		const [row, col] = key.split(':').map(Number);
		if (isNaN(row) || isNaN(col)) return;

		let nextRow = row;
		let nextCol = col;

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			nextRow = row + 1;
		} else if (e.key === 'Enter' && e.shiftKey) {
			e.preventDefault();
			nextRow = row - 1;
		} else if (e.key === 'Escape') {
			e.preventDefault();
			(target as HTMLInputElement).blur();
			return;
		} else {
			return;
		}

		const next = document.querySelector<HTMLElement>(
			`[data-cell-key="${nextRow}:${nextCol}"] input, [data-cell-key="${nextRow}:${nextCol}"] select, [data-cell-key="${nextRow}:${nextCol}"] button, [data-cell-key="${nextRow}:${nextCol}"] .ss-selected`
		);
		if (next) {
			(next as HTMLElement).focus();
		}
	}

	// ─── WORKBOOK ROW INDEXES (for keyboard nav) ──────────────────
	$: liqRowStart = 7 + rows.length + 3 + recargosRows.length;
	$: valRow = liqRowStart + 3;
	$: tercRowStart = valRow + 2;
</script>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- TEMPLATE                                                     -->
<!-- ═══════════════════════════════════════════════════════════ -->
{#if loadingLiq && viewMode}
	<!-- PDF VIEW LOADING STATE -->
	<div class="pdf-wrap">
		<header class="pdf-bar">
			<div class="pdf-bar-inner">
				<div class="pdf-bar-brand">
					<div class="pdf-bar-headings">
						<h1 class="pdf-bar-title">
							Cargando documento
							<span class="liq-loading-dots" aria-hidden="true">
								<span></span><span></span><span></span>
							</span>
						</h1>
						<p class="pdf-bar-sub">
							Vista previa del documento oficial
							<span class="pdf-bar-eyebrow">OP-FR-07 · LIQUIDACIÓN DE SERVICIOS</span>
						</p>
					</div>
				</div>
				<button class="liq-loading-back" on:click={() => goto(BACK_URL)}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
					>
					<span>Volver al Listado</span>
				</button>
			</div>
		</header>
		<div class="pdf-loading-body">
			<div class="pdf-loading-spinner"></div>
			<div class="pdf-loading-text">Cargando liquidación…</div>
		</div>
	</div>
{:else if loadingLiq}
	<div class="liq-loading-page">
		<!-- HEADER (editorial sticky) -->
		<header class="liq-loading-header">
			<div class="liq-loading-header-inner">
				<div class="liq-loading-brand">
					<div class="liq-loading-headings">
						<span class="liq-loading-eyebrow">OP-FR-07 · LIQUIDACIÓN DE SERVICIOS</span>
						<h1 class="liq-loading-title">
							Cargando liquidación
							<span class="liq-loading-dots" aria-hidden="true">
								<span></span><span></span><span></span>
							</span>
						</h1>
						<p class="liq-loading-sub">Gestión y vista previa de liquidaciones de servicios</p>
					</div>
				</div>
				<button class="liq-loading-back" on:click={() => goto(BACK_URL)}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
					>
					<span>Volver al Listado</span>
				</button>
			</div>
		</header>

		<!-- BODY (skeleton cards, editorial) -->
		<div class="liq-loading-body">
			<!-- Card 1: Encabezado del Documento -->
			<article class="liq-loading-card">
				<header class="liq-loading-card-hd">
					<span class="liq-loading-card-eyebrow">SECCIÓN 01</span>
					<h2 class="liq-loading-card-title">Encabezado del documento</h2>
					<p class="liq-loading-card-sub">Datos generales del servicio y del cliente</p>
				</header>

				<div class="liq-loading-fields liq-loading-fields-3" style="margin-top:1.25rem">
					<div class="liq-loading-field liq-loading-field-span2">
						<Skeleton width="120px" height="11px" borderRadius="4px" />
						<Skeleton height="42px" borderRadius="10px" />
					</div>
					<div class="liq-loading-field">
						<Skeleton width="80px" height="11px" borderRadius="4px" />
						<Skeleton height="42px" borderRadius="10px" />
					</div>
				</div>

				<div class="liq-loading-fields liq-loading-fields-4" style="margin-top:0.85rem">
					<div class="liq-loading-field">
						<Skeleton width="36px" height="11px" borderRadius="4px" />
						<Skeleton height="42px" borderRadius="10px" />
					</div>
					<div class="liq-loading-field">
						<Skeleton width="36px" height="11px" borderRadius="4px" />
						<Skeleton height="42px" borderRadius="10px" />
					</div>
					<div class="liq-loading-field">
						<Skeleton width="100px" height="11px" borderRadius="4px" />
						<Skeleton height="42px" borderRadius="10px" />
					</div>
					<div class="liq-loading-field">
						<Skeleton width="60px" height="11px" borderRadius="4px" />
						<Skeleton height="42px" borderRadius="10px" />
					</div>
				</div>

				<div class="liq-loading-fields liq-loading-fields-2" style="margin-top:0.85rem">
					<div class="liq-loading-field">
						<Skeleton width="70px" height="11px" borderRadius="4px" />
						<Skeleton height="42px" borderRadius="10px" />
					</div>
					<div class="liq-loading-field">
						<Skeleton width="130px" height="11px" borderRadius="4px" />
						<Skeleton height="42px" borderRadius="10px" />
					</div>
				</div>

				<div style="margin-top:0.85rem">
					<div class="liq-loading-field">
						<Skeleton width="160px" height="11px" borderRadius="4px" />
						<Skeleton height="42px" borderRadius="10px" />
					</div>
				</div>
			</article>

			<!-- Card 2: Ítems de Servicio (table) -->
			<article class="liq-loading-card">
				<header class="liq-loading-card-hd">
					<span class="liq-loading-card-eyebrow">SECCIÓN 02</span>
					<h2 class="liq-loading-card-title">Ítems de servicio</h2>
					<p class="liq-loading-card-sub">Detalle de placas, fechas y valores por fila</p>
				</header>

				<div class="liq-loading-table" style="margin-top:1.25rem">
					<Skeleton
						height="40px"
						borderRadius="10px"
						baseColor="#fff7ed"
						highlightColor="#fff7ed"
					/>
					{#each Array(5) as _, i}
						<Skeleton height="48px" borderRadius="10px" duration={1.5 + i * 0.08} />
					{/each}
				</div>
			</article>
		</div>
	</div>
{:else if loadError}
	<div class="liq-loading-page">
		<!-- HEADER (editorial sticky, mismo lenguaje que loading) -->
		<header class="liq-loading-header">
			<div class="liq-loading-header-inner">
				<div class="liq-loading-brand">
					<img
						src="/assets/logo_nombre.webp"
						alt="Logo"
						class="liq-loading-logo"
						on:error={() => (logoError = true)}
						style={logoError ? 'display:none' : ''}
					/>
					<div class="liq-loading-headings">
						<span class="liq-loading-eyebrow liq-loading-eyebrow-danger"
							>OP-FR-07 · ERROR DE CARGA</span
						>
						<h1 class="liq-loading-title">No se pudo cargar la liquidación</h1>
						<p class="liq-loading-sub">Gestión y vista previa de liquidaciones de servicios</p>
					</div>
				</div>
				<button class="liq-loading-back" on:click={() => goto(BACK_URL)}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
					>
					<span>Volver al Listado</span>
				</button>
			</div>
		</header>

		<!-- ERROR CARD (editorial alert) -->
		<article class="liq-error-card">
			<div class="liq-error-icon" aria-hidden="true">
				<svg
					width="32"
					height="32"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><circle
						cx="12"
						cy="16"
						r="0.5"
						fill="currentColor"
					/></svg
				>
			</div>
			<div class="liq-error-body">
				<h2 class="liq-error-title">Algo salió mal</h2>
				<div class="liq-error-msg">{loadError}</div>
				<p class="liq-error-hint">
					Esto puede deberse a una conexión inestable, un error del servidor o que la liquidación ya
					no existe.
				</p>
			</div>
			<div class="liq-error-actions">
				<button class="liq-btn-primary" on:click={retryLoad}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg
					>
					<span>Reintentar</span>
				</button>
				<button class="liq-btn-secondary" on:click={() => goto(BACK_URL)}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
					>
					<span>Volver al Listado</span>
				</button>
			</div>
		</article>
	</div>
{:else if view === 'editor'}
	{@const badge = getEstadoBadge(liqEstado)}
	<div class="wb-shell">
		<!-- ═══ TOOLBAR (sticky top, editorial) ═══ -->
		<div class="wb-toolbar">
			<div class="wb-toolbar-l">
				<button class="wb-btn-back" on:click={handleCancel} title="Volver al listado">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
					>
					<span>Volver</span>
				</button>
				<div class="wb-toolbar-divider"></div>
				<div class="wb-toolbar-title">
					<div class="wb-toolbar-t">
						{editingId ? 'Editar Liquidación' : 'Nueva Liquidación'}
						<span class="wb-toolbar-eyebrow">OP-FR-07 · Liquidación de Servicios</span>
						<div class="estado-bar-status">
							<span class="estado-badge estado-badge-{liqEstado.toLowerCase()}">{badge.label}</span>
						</div>
					</div>
					<div class="wb-toolbar-sub">
						{selectedCliente?.nombre || 'Sin cliente'} · {hdr.mes}
						{hdr.anio}
						{#if hdr.consecutivo}· <span class="wb-consec-inline">{hdr.consecutivo}</span>{/if}
					</div>
				</div>
			</div>
			<div class="wb-toolbar-r">
				<div
					class="wb-draft-pill"
					class:wb-draft-saved={draftSavedAt}
					class:wb-draft-active={!draftSavedAt}
				>
					<span class="wb-draft-dot"></span>
					<span class="wb-draft-label">
						{draftSavedAt ? 'Guardado' : 'Autoguardado'}
					</span>
					{#if draftSavedAt}
						<span class="wb-draft-time">{draftSavedAt}</span>
					{/if}
					{#if draftAutoRestored}
						<span class="wb-draft-restored" title="Borrador restaurado automáticamente">♻️</span>
					{/if}
				</div>
				{#if DEV}
					<button class="wb-draft-debug" on:click={() => (showDraftDebug = !showDraftDebug)}>
						🐛 {showDraftDebug ? 'OFF' : 'DBG'}
					</button>
				{/if}
				<div class="wb-toolbar-divider wb-toolbar-divider-r"></div>
				<button
					class="wb-btn-secondary"
					on:click={() => {
						previewPage = 'liquidacion';
						setView('preview');
					}}
					title="Ver vista previa del documento"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle
							cx="12"
							cy="12"
							r="3"
						/></svg
					>
					<span>Vista previa</span>
				</button>
				<button
					class="wb-btn-ghost"
					on:click={handleCancel}
					title={editingId ? 'Cancelar edición y descartar cambios' : 'Cancelar y descartar'}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg
					>
					<span>Cancelar</span>
				</button>
				<button class="wb-btn-primary" on:click={registrarLiquidacion} disabled={saving}>
					{#if saving}
						<span class="wb-btn-spinner"></span>
						<span>Guardando…</span>
					{:else}
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg
						>
						<span>{editingId ? 'Actualizar' : 'Registrar'}</span>
					{/if}
				</button>
			</div>
		</div>

		<!-- ═══ DEV DEBUG ═══ -->
		{#if DEV && showDraftDebug}
			<div class="wb-debug-panel">
				<div class="wb-debug-hd">
					<span>🔍 Draft Debug — Diferencias vs Servidor</span>
					<button on:click={() => (showDraftDebug = false)}>✕</button>
				</div>
				{#if !serverSnapshot}
					<div class="wb-debug-empty">⚠️ No hay snapshot del servidor</div>
				{:else if draftDiffEntries.length === 0}
					<div class="wb-debug-empty">✅ Sin diferencias — el cache coincide con el servidor</div>
				{:else}
					<div class="wb-debug-count">{draftDiffEntries.length} campo(s) modificado(s)</div>
					<table class="wb-debug-tbl">
						<thead><tr><th>Campo</th><th>Servidor</th><th>Cache</th></tr></thead>
						<tbody>
							{#each draftDiffEntries as d}
								<tr>
									<td class="wb-ddf">{d.field}</td>
									<td class="wb-dds"
										>{typeof d.server === 'object' ? JSON.stringify(d.server) : d.server}</td
									>
									<td class="wb-ddc"
										>{typeof d.cache === 'object' ? JSON.stringify(d.cache) : d.cache}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		{/if}

		<!-- ═══ WORKBOOK SCROLL AREA ═══ -->
		<div class="wb-scroll-area" bind:this={wbScrollEl}>
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<div class="workbook" data-wb-root role="grid" tabindex="-1" on:keydown={handleWbKeydown}>
				<!-- ═══ CARD: ATAJOS DE TECLADO (hint editorial) ═══ -->
				<aside class="wb-card wb-card-hint">
					<div class="wb-card-hint-icon" aria-hidden="true">
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							><rect x="2" y="6" width="20" height="12" rx="2" /><path
								d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"
							/></svg
						>
					</div>
					<div class="wb-card-hint-body">
						<span class="wb-card-eyebrow">ATAJOS</span>
						<p class="wb-card-hint-text">
							<kbd>Tab</kbd> siguiente celda · <kbd>Enter</kbd> bajar fila · <kbd>Esc</kbd> salir
						</p>
					</div>
				</aside>

				<!-- ═══ CARD 1: ENCABEZADO DEL DOCUMENTO ═══ -->
				<article class="wb-card">
					<header class="wb-card-hd">
						<span class="wb-card-eyebrow">SECCIÓN 01</span>
						<h2 class="wb-card-title">Encabezado del documento</h2>
						<p class="wb-card-sub">Datos generales del servicio y del cliente</p>
					</header>

					<div class="wb-card-body" data-row-enc="1">
						<!-- Fila 1: Empresa Emisora (350px · +25%) | Cliente | NIT -->
						<div class="wb-enc-row wb-enc-row-3">
							<div class="wb-enc-cell wb-enc-cell-fixed-350">
								<span class="wb-enc-label">Empresa Emisora</span>
								<input
									bind:value={hdr.empresa}
									placeholder="SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S."
								/>
							</div>
							<div class="wb-enc-cell wb-enc-cell-flex">
								<span class="wb-enc-label">Cliente / Empresa</span>
								<div class="ss-wrap">
									{#if selectedCliente}
										<div class="ss-selected">
											<span>{selectedCliente.nombre}</span>
											<span class="ss-nit">NIT: {selectedCliente.nit}</span>
											<button class="ss-clear" on:click={clearCliente}>✕</button>
										</div>
									{:else}
										<input
											class="ss-search"
											placeholder="Buscar cliente..."
											bind:value={clienteSearch}
											on:focus={() => (clienteDropdown = true)}
											on:input={() => {
												clienteDropdown = true;
												clienteHighlight = 0;
											}}
											on:keydown={(e) => {
												if (!clienteDropdown || clientesFiltrados.length === 0) return;
												if (e.key === 'ArrowDown') {
													e.preventDefault();
													clienteHighlight = Math.min(
														clienteHighlight + 1,
														clientesFiltrados.length - 1
													);
													tick().then(() =>
														e.currentTarget?.parentElement
															?.querySelector('.highlighted')
															?.scrollIntoView({ block: 'nearest' })
													);
												} else if (e.key === 'ArrowUp') {
													e.preventDefault();
													clienteHighlight = Math.max(clienteHighlight - 1, 0);
													tick().then(() =>
														e.currentTarget?.parentElement
															?.querySelector('.highlighted')
															?.scrollIntoView({ block: 'nearest' })
													);
												} else if (e.key === 'Enter') {
													e.preventDefault();
													selectCliente(clientesFiltrados[clienteHighlight]);
												} else if (e.key === 'Escape') {
													clienteDropdown = false;
												}
											}}
										/>
										{#if clienteDropdown && clienteSearch.length > 0}
											<div class="ss-dropdown">
												{#if clientesFiltrados.length === 0}
													<div class="ss-empty">Sin resultados</div>
												{:else}
													{#each clientesFiltrados as c, ci}
														<div
															class="ss-option"
															class:highlighted={ci === clienteHighlight}
															on:click={() => selectCliente(c)}
															on:keydown={(e) => e.key === 'Enter' && selectCliente(c)}
															on:mouseenter={() => (clienteHighlight = ci)}
															role="option"
															aria-selected={ci === clienteHighlight}
															tabindex="-1"
														>
															<span class="ss-opt-name">{c.nombre}</span>
															<span class="ss-opt-nit">NIT: {c.nit}</span>
														</div>
													{/each}
												{/if}
											</div>
										{/if}
									{/if}
								</div>
							</div>
							<div class="wb-enc-cell wb-enc-cell-fixed-220">
								<span class="wb-enc-label">NIT <span style="color:#9a9a9a">(auto)</span></span>
								<input
									value={selectedCliente ? selectedCliente.nit : ''}
									disabled
									placeholder="—"
								/>
							</div>
						</div>

						<!-- Fila 2: Consecutivo (350px, mismo width que Empresa) | Mes | Año | Operadora | OSI -->
						<div class="wb-enc-row wb-enc-row-5">
							<div class="wb-enc-cell wb-enc-cell-fixed-350">
								<span class="wb-enc-label">Consecutivo</span>
								<div class="wb-consec-wrap">
									<input
										bind:value={hdr.consecutivo}
										placeholder="ej. LS-2025-0001"
										on:input={onConsecInput}
										class="wb-consec-input"
										class:consec-ok={consecStatus === 'available'}
										class:consec-taken={consecStatus === 'taken'}
									/>
									{#if consecStatus === 'checking'}<span class="consec-badge consec-checking"
											>⏳</span
										>{:else if consecStatus === 'available'}<span
											class="consec-badge consec-ok-badge">✅</span
										>{:else if consecStatus === 'taken'}<span
											class="consec-badge consec-taken-badge">❌</span
										>{/if}
								</div>
							</div>
							<div class="wb-enc-cell wb-enc-cell-flex-110">
								<span class="wb-enc-label">Mes</span>
								<select bind:value={hdr.mes}>
									{#each MESES as m}<option>{m}</option>{/each}
								</select>
							</div>
							<div class="wb-enc-cell wb-enc-cell-flex-110">
								<span class="wb-enc-label">Año</span>
								<select bind:value={hdr.anio}>
									{#each YEARS as y}<option value={y}>{y}</option>{/each}
								</select>
							</div>
							<div class="wb-enc-cell wb-enc-cell-flex-130">
								<span class="wb-enc-label">Operadora</span>
								<select bind:value={hdr.operadora}>
									<option>PAREX</option>
									<option>GEOPARK</option>
									<option>OTRA</option>
								</select>
							</div>
							<div class="wb-enc-cell wb-enc-cell-flex-130">
								<span class="wb-enc-label">OSI</span>
								<input
									bind:value={hdr.osi}
									placeholder="OSI-####"
									style="font-family:'Geist',sans-serif;font-weight:700;text-transform:uppercase"
								/>
							</div>
						</div>

						<!-- Fila 3: Observaciones (ancho completo, hasta el final de OSI/NIT) -->
						<div class="wb-enc-row wb-enc-row-1">
							<div class="wb-enc-cell wb-enc-cell-full">
								<span class="wb-enc-label">Observaciones del documento</span>
								<input
									bind:value={hdr.observaciones}
									placeholder="Notas u observaciones para incluir en el documento..."
								/>
							</div>
						</div>
					</div>
				</article>

				<!-- ═══ CARD 2: ÍTEMS DE SERVICIO ═══ -->
				<article class="wb-card">
					<header class="wb-card-hd wb-card-hd-flex">
						<div class="wb-card-hd-text">
							<span class="wb-card-eyebrow">SECCIÓN 02</span>
							<h2 class="wb-card-title">Ítems de servicio</h2>
							<p class="wb-card-sub">Detalle de placas, fechas y valores por fila</p>
						</div>
						<span class="wb-card-count">{rows.length} {rows.length === 1 ? 'fila' : 'filas'}</span>
					</header>

					<div class="wb-card-body">
						<!-- Ítems header row -->
						<div class="wb-table-wrap">
							<div class="wb-row wb-row-fields wb-row-items" data-row="6">
								<div class="wb-cell wb-th wb-th-sticky wb-cell-placa">Placa</div>
								<div class="wb-cell wb-th wb-cell-date">F. Inicial</div>
								<div class="wb-cell wb-th wb-cell-date">F. Final</div>
								<div class="wb-cell wb-th wb-cell-recorrido">Recorrido</div>
								<div class="wb-cell wb-th wb-cell-tipo-serv">Tipo Servicio</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-num">Cant</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-vr-unit">Vr. Unit</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money-lg">Subtotal</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-num">Dcto %</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money-lg">Vr. Final</div>
								<div class="wb-cell wb-th wb-cell-text">Planilla</div>
								<div class="wb-cell wb-th wb-th-action wb-cell-action">✕</div>
							</div>

							{#each rows as row, i (row.id)}
								{@const { sub, vf } = calcRow(row)}
								<div class="wb-row wb-row-data wb-row-items" data-row={7 + i}>
									<div class="wb-cell wb-cell-sticky wb-cell-placa" data-cell-key={`${7 + i}:1`}>
										<div class="ss-wrap">
											{#if row.placa}
												<div class="ss-selected wb-ss-mini">
													<span style="font-family:'Geist',sans-serif;font-weight:700"
														>{row.placa}</span
													>
													<button class="ss-clear" on:click={() => clearPlaca(row.id)}>✕</button>
												</div>
											{:else}
												<input
													class="ss-search wb-ss-mini"
													placeholder="Placa..."
													data-placa-input-row-id={row.id}
													bind:value={row.placa_search}
													on:focus={() => {
														row.placa_dropdown = true;
														openPlacaDropdown(row.id);
													}}
													on:input={() => {
														row.placa_dropdown = true;
														row.placa_highlight = 0;
														openPlacaDropdown(row.id);
													}}
													on:blur={() => handlePlacaBlur(row.id)}
													on:keydown={(e) => {
														const list = placasFiltradas(row.placa_search);
														if (!row.placa_dropdown || list.length === 0) return;
														if (e.key === 'ArrowDown') {
															e.preventDefault();
															row.placa_highlight = Math.min(
																(row.placa_highlight ?? 0) + 1,
																list.length - 1
															);
														} else if (e.key === 'ArrowUp') {
															e.preventDefault();
															row.placa_highlight = Math.max((row.placa_highlight ?? 0) - 1, 0);
														} else if (e.key === 'Enter') {
															e.preventDefault();
															selectPlaca(row.id, list[row.placa_highlight ?? 0]);
														} else if (e.key === 'Escape') {
															row.placa_dropdown = false;
														}
													}}
												/>
											{/if}
										</div>
									</div>
									<div class="wb-cell wb-cell-date" data-cell-key={`${7 + i}:2`}>
										<input
											type="date"
											bind:value={row.fecha_ini}
											on:change={(e) => updRow(row.id, 'fecha_ini', e.currentTarget.value)}
										/>
									</div>
									<div class="wb-cell wb-cell-date" data-cell-key={`${7 + i}:3`}>
										<input
											type="date"
											bind:value={row.fecha_fin}
											on:change={(e) => updRow(row.id, 'fecha_fin', e.currentTarget.value)}
										/>
									</div>
									<div class="wb-cell wb-cell-recorrido" data-cell-key={`${7 + i}:4`}>
										<input
											bind:value={row.recorrido}
											on:input={(e) => updRow(row.id, 'recorrido', e.currentTarget.value)}
											placeholder="Ruta / descripción"
										/>
									</div>
									<div class="wb-cell wb-cell-tipo-serv" data-cell-key={`${7 + i}:5`}>
										<select
											bind:value={row.tipo}
											on:change={(e) => updRow(row.id, 'tipo', e.currentTarget.value)}
										>
											{#each TIPOS as t}<option value={t.value}>{t.label}</option>{/each}
										</select>
									</div>
									<div class="wb-cell wb-cell-num" data-cell-key={`${7 + i}:6`}>
										<input
											type="number"
											bind:value={row.cant}
											on:input={(e) => updRow(row.id, 'cant', e.currentTarget.value)}
										/>
									</div>
									<div class="wb-cell wb-cell-vr-unit" data-cell-key={`${7 + i}:7`}>
										<input
											type="text"
											inputmode="numeric"
											value={fmtCOPInput(row.vr_unit)}
											on:focus={(e) => {
												e.currentTarget.value = String(row.vr_unit || '');
												e.currentTarget.select();
											}}
											on:blur={(e) => {
												const v = parseCOPInput(e.currentTarget.value);
												updRow(row.id, 'vr_unit', v);
												e.currentTarget.value = fmtCOPInput(v);
											}}
											on:keydown={(e) => {
												if (
													!/[\d,.\-Backspace Tab ArrowLeft ArrowRight Delete Home End]/.test(
														e.key
													) &&
													!e.ctrlKey &&
													!e.metaKey
												)
													e.preventDefault();
											}}
										/>
									</div>
									<div class="wb-cell wb-cell-money-lg wb-cell-calc">{COP(sub)}</div>
									<div class="wb-cell wb-cell-num" data-cell-key={`${7 + i}:8`}>
										<input
											type="number"
											min="0"
											max="100"
											bind:value={row.dcto}
											on:input={(e) => updRow(row.id, 'dcto', e.currentTarget.value)}
										/>
									</div>
									<div class="wb-cell wb-cell-money-lg wb-cell-calc-strong">{COP(vf)}</div>
									<div class="wb-cell wb-cell-text" data-cell-key={`${7 + i}:9`}>
										<span>TM-</span>
										<input
											bind:value={row.planilla}
											on:input={(e) => updRow(row.id, 'planilla', e.currentTarget.value)}
											placeholder="0000"
										/>
									</div>
									<div class="wb-cell wb-cell-action">
										{#if rows.length > 1}<button
												class="wb-btn-del"
												on:click={() => delRow(row.id)}
												title="Eliminar fila">✕</button
											>{/if}
									</div>
								</div>
							{/each}
						</div>

						<button class="wb-btn-add-row" on:click={addRow}>＋ Agregar fila de servicio</button>
					</div>
				</article>

				<!-- ═══ CARD 3: RECARGOS (HOJA 2) ═══ -->
				<article class="wb-card">
					<header class="wb-card-hd wb-card-hd-flex">
						<div class="wb-card-hd-text">
							<span class="wb-card-eyebrow">SECCIÓN 03</span>
							<h2 class="wb-card-title">Recargos <span class="wb-card-title-soft">Hoja 2</span></h2>
							<p class="wb-card-sub">Pega filas con <kbd>⌘V</kbd> / <kbd>Ctrl+V</kbd></p>
						</div>
						<span class="wb-card-count"
							>{recargosRows.length} {recargosRows.length === 1 ? 'fila' : 'filas'}</span
						>
					</header>

					<div class="wb-card-body">
						<div class="wb-table-wrap">
							<div
								class="wb-row wb-row-fields wb-row-fields-recargos wb-row-recargos"
								data-row={7 + rows.length + 1}
							>
								<div class="wb-cell wb-th wb-th-action wb-cell-action">✕</div>
								<div class="wb-cell wb-th wb-cell-wide">Empresa</div>
								<div class="wb-cell wb-th wb-cell-text">Planilla</div>
								<div class="wb-cell wb-th wb-cell-text">Placa</div>
								<div class="wb-cell wb-th wb-cell-wide">Conductor</div>
								{#each Array(31) as _, i}<div class="wb-cell wb-th wb-th-day wb-cell-day">
										{i + 1}
									</div>{/each}
								<div class="wb-cell wb-th wb-th-num wb-cell-money">Total</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money">Prom</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money">HED</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money">HEN</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money">HEFD</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money">HEFN</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money">RNDF</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money">RN</div>
								<div class="wb-cell wb-th wb-th-num wb-cell-money">RD</div>
							</div>

							<div class="wb-paste-zone" on:paste={handleRecargosPaste}>
								{#each recargosRows as row, i (row.id)}
									<div
										class="wb-row wb-row-data wb-row-data-recargos wb-row-recargos"
										data-row={7 + rows.length + 2 + i}
									>
										<div class="wb-cell wb-cell-action">
											<button
												class="wb-btn-del"
												on:click={() => delRecargoRow(row.id)}
												title="Eliminar">✕</button
											>
										</div>

										<div class="wb-cell wb-cell-wide" data-cell-key={`rec-${row.id}-empresa`}>
											<span>{row.empresa}</span>
										</div>

										<div class="wb-cell wb-cell-text" data-cell-key={`rec-${row.id}-planilla`}>
											<span>{row.planilla}</span>
										</div>

										<div class="wb-cell wb-cell-text" data-cell-key={`rec-${row.id}-placa`}>
											<span>{row.placa}</span>
										</div>

										<div class="wb-cell wb-cell-wide" data-cell-key={`rec-${row.id}-conductor`}>
											<span>{row.conductor}</span>
										</div>

										{#each Array(31) as _, j}
											<div class="wb-cell wb-cell-day" data-cell-key={`rec-${row.id}-d${j}`}>
												<span>{row.days[j] ?? ''}</span>
											</div>
										{/each}

										<div class="wb-cell wb-cell-money wb-cell-calc">{row.total.toFixed(1)}</div>
										<div class="wb-cell wb-cell-money wb-cell-calc">{row.promedio.toFixed(1)}</div>

										<div
											class="wb-cell wb-cell-money wb-cell-num"
											data-cell-key={`rec-${row.id}-hed`}
										>
											<span>{row.hed ?? ''}</span>
										</div>

										<div
											class="wb-cell wb-cell-money wb-cell-num"
											data-cell-key={`rec-${row.id}-hen`}
										>
											<span>{row.hen ?? ''}</span>
										</div>

										<div
											class="wb-cell wb-cell-money wb-cell-num"
											data-cell-key={`rec-${row.id}-hefd`}
										>
											<span>{row.hefd ?? ''}</span>
										</div>

										<div
											class="wb-cell wb-cell-money wb-cell-num"
											data-cell-key={`rec-${row.id}-hefn`}
										>
											<span>{row.hefn ?? ''}</span>
										</div>

										<div
											class="wb-cell wb-cell-money wb-cell-num"
											data-cell-key={`rec-${row.id}-rndf`}
										>
											<span>{row.rndf ?? ''}</span>
										</div>

										<div
											class="wb-cell wb-cell-money wb-cell-num"
											data-cell-key={`rec-${row.id}-rn`}
										>
											<span>{row.rn ?? ''}</span>
										</div>

										<div
											class="wb-cell wb-cell-money wb-cell-num"
											data-cell-key={`rec-${row.id}-rd`}
										>
											<span>{row.rd ?? ''}</span>
										</div>
									</div>
								{/each}
								{#if recargosRows.length === 0}
									<div class="wb-empty-row">
										<div class="wb-cell wb-cell-empty">
											<span
												>📋 Sin recargos. Pega datos desde la página de Recargos o agrega filas
												manualmente.</span
											>
										</div>
									</div>
								{/if}
							</div>

							{#if recargosRows.length > 0}
								<div
									class="wb-row wb-row-totals wb-row-recargos"
									data-row={7 + rows.length + 2 + recargosRows.length + 1}
								>
									<div class="wb-cell wb-cell-action"></div>
									<div class="wb-cell wb-cell-wide"><b>TOTALES</b></div>
									<div class="wb-cell wb-cell-text"></div>
									<div class="wb-cell wb-cell-text"></div>
									<div class="wb-cell wb-cell-wide"></div>
									{#each Array(31) as _, i}
										<div class="wb-cell wb-cell-day">
											<b>{recargosTotals.days[i].toFixed(1)}</b>
										</div>
									{/each}
									<div class="wb-cell wb-cell-money wb-cell-calc-strong">
										<b>{recargosTotals.total.toFixed(1)}</b>
									</div>
									<div class="wb-cell wb-cell-money"></div>
									<div class="wb-cell wb-cell-money wb-cell-calc">
										<b>{recargosTotals.hed.toFixed(2)}</b>
									</div>
									<div class="wb-cell wb-cell-money wb-cell-calc">
										<b>{recargosTotals.hen.toFixed(2)}</b>
									</div>
									<div class="wb-cell wb-cell-money wb-cell-calc">
										<b>{recargosTotals.hefd.toFixed(2)}</b>
									</div>
									<div class="wb-cell wb-cell-money wb-cell-calc">
										<b>{recargosTotals.hefn.toFixed(2)}</b>
									</div>
									<div class="wb-cell wb-cell-money wb-cell-calc">
										<b>{recargosTotals.rndf.toFixed(2)}</b>
									</div>
									<div class="wb-cell wb-cell-money wb-cell-calc">
										<b>{recargosTotals.rn.toFixed(2)}</b>
									</div>
									<div class="wb-cell wb-cell-money wb-cell-calc">
										<b>{recargosTotals.rd.toFixed(2)}</b>
									</div>
								</div>
							{/if}
						</div>

						<button class="wb-btn-add-row" on:click={addRecargoRow}
							>＋ Agregar fila de recargo</button
						>
					</div>
				</article>

				<!-- ═══ CARD 4: LIQUIDADOR DE RECARGOS (HOJA 3) ═══ -->
				{#if recargosRows.length > 0}
					<article class="wb-card">
						<header class="wb-card-hd">
							<span class="wb-card-eyebrow">SECCIÓN 04</span>
							<h2 class="wb-card-title">
								Liquidador de recargos <span class="wb-card-title-soft">Hoja 3</span>
							</h2>
							<p class="wb-card-sub">Configuración de salario, prestaciones y administración</p>
						</header>

						<div class="wb-card-body">
							<div class="wb-table-wrap wb-grid-wrap wb-grid-4">
								<!-- Row 1: Salario Básico | Cargo | Conductor Adicional | Valor Hora -->
								<div class="wb-grid-field">
									<span class="wb-grid-label">Salario Básico</span>
									<div class="wb-grid-input" data-cell-key={`${liqRowStart}:1`}>
										<input
											type="text"
											inputmode="numeric"
											value={fmtCOPInput(liqCfg.salario_basico)}
											on:focus={(e) => {
												e.currentTarget.value = String(liqCfg.salario_basico || '');
												e.currentTarget.select();
											}}
											on:blur={(e) => {
												liqCfg.salario_basico = parseCOPInput(e.currentTarget.value);
												liqCfg = liqCfg;
												e.currentTarget.value = fmtCOPInput(liqCfg.salario_basico);
											}}
											on:keydown={(e) => {
												if (
													!/[\d,.\-Backspace Tab ArrowLeft ArrowRight Delete Home End]/.test(
														e.key
													) &&
													!e.ctrlKey &&
													!e.metaKey
												)
													e.preventDefault();
											}}
										/>
									</div>
								</div>
								<div class="wb-grid-field">
									<span class="wb-grid-label">Cargo</span>
									<div class="wb-grid-input" data-cell-key={`${liqRowStart}:3`}>
										<input bind:value={liqCfg.cargo} />
									</div>
								</div>
								<div class="wb-grid-field">
									<span class="wb-grid-label">Conductor Adicional</span>
									<div class="wb-grid-input" data-cell-key={`${liqRowStart}:5`}>
										<input
											type="text"
											inputmode="numeric"
											value={fmtCOPInput(liqCfg.conductor_adicional)}
											on:focus={(e) => {
												e.currentTarget.value = String(liqCfg.conductor_adicional || '');
												e.currentTarget.select();
											}}
											on:blur={(e) => {
												liqCfg.conductor_adicional = parseCOPInput(e.currentTarget.value);
												liqCfg = liqCfg;
												e.currentTarget.value = fmtCOPInput(liqCfg.conductor_adicional);
											}}
											on:keydown={(e) => {
												if (
													!/[\d,.\-Backspace Tab ArrowLeft ArrowRight Delete Home End]/.test(
														e.key
													) &&
													!e.ctrlKey &&
													!e.metaKey
												)
													e.preventDefault();
											}}
										/>
									</div>
								</div>
								<div class="wb-grid-field">
									<span class="wb-grid-label">
										Valor Hora {liqCfg.valor_hora_override > 0 ? '✏️' : '(auto)'}
									</span>
									<div class="wb-grid-input" data-cell-key={`${liqRowStart}:7`}>
										<input
											type="text"
											inputmode="decimal"
											value={fmtCOPDec(
												liqCfg.valor_hora_override > 0
													? liqCfg.valor_hora_override
													: Math.round(valorHoraAuto * 10) / 10
											)}
											on:focus={(e) => {
												e.currentTarget.value = String(
													liqCfg.valor_hora_override > 0
														? liqCfg.valor_hora_override
														: Math.round(valorHoraAuto * 10) / 10
												);
												e.currentTarget.select();
											}}
											on:blur={(e) => {
												const v = parseCOPInput(e.currentTarget.value);
												const auto = Math.round(valorHoraAuto * 10) / 10;
												liqCfg.valor_hora_override = v !== auto && v > 0 ? v : 0;
												liqCfg = liqCfg;
												e.currentTarget.value = fmtCOPDec(
													liqCfg.valor_hora_override > 0 ? liqCfg.valor_hora_override : auto
												);
											}}
											on:keydown={(e) => {
												if (
													!/[\d,.\-Backspace Tab ArrowLeft ArrowRight Delete Home End]/.test(
														e.key
													) &&
													!e.ctrlKey &&
													!e.metaKey
												)
													e.preventDefault();
											}}
											style={liqCfg.valor_hora_override > 0
												? 'border-color:#f59e0b;background:#fffbeb'
												: ''}
										/>
									</div>
								</div>

								<!-- Row 2: Seg. Social % | Prestaciones % | Admin % | Prueba COVID -->
								<div class="wb-grid-field">
									<span class="wb-grid-label">Seg. Social %</span>
									<div class="wb-grid-input" data-cell-key={`${liqRowStart + 1}:1`}>
										<input type="number" step="0.01" bind:value={liqCfg.pct_seg_social} />
									</div>
								</div>
								<div class="wb-grid-field">
									<span class="wb-grid-label">Prestaciones %</span>
									<div class="wb-grid-input" data-cell-key={`${liqRowStart + 1}:3`}>
										<input type="number" step="0.01" bind:value={liqCfg.pct_prestaciones} />
									</div>
								</div>
								<div class="wb-grid-field">
									<span class="wb-grid-label">Admin %</span>
									<div class="wb-grid-input" data-cell-key={`${liqRowStart + 1}:5`}>
										<input type="number" step="0.01" bind:value={liqCfg.pct_admin} />
									</div>
								</div>
								<div class="wb-grid-field">
									<span class="wb-grid-label">Prueba COVID</span>
									<div class="wb-grid-input" data-cell-key={`${liqRowStart + 1}:7`}>
										<input
											type="text"
											inputmode="numeric"
											value={fmtCOPInput(liqCfg.prueba_covid)}
											on:focus={(e) => {
												e.currentTarget.value = String(liqCfg.prueba_covid || '');
												e.currentTarget.select();
											}}
											on:blur={(e) => {
												liqCfg.prueba_covid = parseCOPInput(e.currentTarget.value);
												liqCfg = liqCfg;
												e.currentTarget.value = fmtCOPInput(liqCfg.prueba_covid);
											}}
											on:keydown={(e) => {
												if (
													!/[\d,.\-Backspace Tab ArrowLeft ArrowRight Delete Home End]/.test(
														e.key
													) &&
													!e.ctrlKey &&
													!e.metaKey
												)
													e.preventDefault();
											}}
										/>
									</div>
								</div>
							</div>

							<!-- Totals row (full width summary) -->
							<div class="wb-row wb-row-totals" data-row={liqRowStart + 2}>
								<div class="wb-cell wb-cell-summary">
									<span>Subtotal 1: <b>{fmtDec1(liqSubtotal1)}</b></span>
									<span>Seg. Social: <b>{fmtDec1(liqSegSocial)}</b></span>
									<span>Prestaciones: <b>{fmtDec1(liqPrestaciones)}</b></span>
									<span>Admin: <b>{fmtDec1(liqAdmin)}</b></span>
									<span class="wb-grand-pill">TOTAL: <b>{fmtDec1(liqTotal)}</b></span>
								</div>
							</div>
						</div>
					</article>
				{/if}

				<!-- ═══ CARD 5: VALORES ADICIONALES ═══ -->
				<article class="wb-card">
					<header class="wb-card-hd wb-card-hd-flex">
						<div class="wb-card-hd-text">
							<span class="wb-card-eyebrow">SECCIÓN 05</span>
							<h2 class="wb-card-title">Valores adicionales</h2>
							<p class="wb-card-sub">Pernocte e IVA del servicio</p>
						</div>
						<span class="wb-card-count">Pernocte · IVA</span>
					</header>

					<div class="wb-card-body">
						<div class="wb-table-wrap wb-grid-wrap wb-grid-3">
							<div class="wb-grid-field">
								<span class="wb-grid-label">Pernocte Vr. Unit</span>
								<div class="wb-grid-input" data-cell-key={`${valRow}:1`}>
									<input
										type="text"
										inputmode="numeric"
										value={fmtCOPInput(ext.pernote_unit)}
										on:focus={(e) => {
											e.currentTarget.value = String(ext.pernote_unit || '');
											e.currentTarget.select();
										}}
										on:blur={(e) => {
											ext.pernote_unit = parseCOPInput(e.currentTarget.value);
											ext = ext;
											e.currentTarget.value = fmtCOPInput(ext.pernote_unit);
										}}
										on:keydown={(e) => {
											if (
												!/[\d,.\-Backspace Tab ArrowLeft ArrowRight Delete Home End]/.test(e.key) &&
												!e.ctrlKey &&
												!e.metaKey
											)
												e.preventDefault();
										}}
									/>
								</div>
							</div>
							<div class="wb-grid-field">
								<span class="wb-grid-label">Pernocte Cant.</span>
								<div class="wb-grid-input" data-cell-key={`${valRow}:3`}>
									<input type="number" bind:value={ext.pernote_cant} min="0" />
								</div>
							</div>
							<div class="wb-grid-field">
								<span class="wb-grid-label">IVA %</span>
								<div class="wb-grid-input" data-cell-key={`${valRow}:5`}>
									<input type="number" bind:value={ext.iva_pct} min="0" max="100" />
								</div>
							</div>
						</div>
					</div>
				</article>

				<!-- ═══ CARD 5b: RESUMEN LIQUIDACIÓN ═══ -->
				<article class="wb-card">
					<header class="wb-card-hd wb-card-hd-flex">
						<div class="wb-card-hd-text">
							<span class="wb-card-eyebrow">RESUMEN</span>
							<h2 class="wb-card-title">
								<span class="wb-card-title-icon">📈</span> Resumen Liquidación
							</h2>
							<p class="wb-card-sub">Desglose del total a facturar del servicio</p>
						</div>
						<span class="wb-card-count">Servicios · Recargos · Pernote · IVA · TOTAL</span>
					</header>

					<div class="wb-card-body">
						<div class="resumen-card">
							<div class="resumen-row">
								<span>Valor Total Servicios sin Recargos</span>
								<strong style="color:#ea580c">{COP(totalSvc)}</strong>
							</div>
							<div class="resumen-row">
								<span>Valor Total Recargos</span>
								<strong style="color:#ea580c">{COP(valRec)}</strong>
							</div>
							<div class="resumen-row">
								<span>Pernote ({ext.pernote_cant} noche{ext.pernote_cant !== 1 ? 's' : ''})</span>
								<strong style="color:#ea580c">{COP(valPern)}</strong>
							</div>
							<div class="resumen-row resumen-divider emphasis">
								<span>Subtotal</span>
								<span>{COP(subtotal)}</span>
							</div>
							<div class="resumen-row muted">
								<span>IVA {ext.iva_pct}%</span>
								<span>{COP(ivaVal)}</span>
							</div>
							<div class="resumen-row resumen-total">
								<span>TOTAL SERVICIO</span>
								<span>{COP(total)}</span>
							</div>
						</div>
					</div>
				</article>

				<!-- ═══ CARD 6: LIQUIDACIÓN DE TERCEROS (HOJA 4) ═══ -->
				{#if canSeeTerceros && rows.length > 0}
					<article class="wb-card">
						<header class="wb-card-hd wb-card-hd-flex">
							<div class="wb-card-hd-text">
								<span class="wb-card-eyebrow">SECCIÓN 06</span>
								<h2 class="wb-card-title">
									Liquidación de terceros <span class="wb-card-title-soft">Hoja 4</span>
								</h2>
								<p class="wb-card-sub">Propietarios, valores a liquidar e ingresos</p>
							</div>
							<button
								class="wb-btn-sync"
								on:click={resetTerceroFromItems}
								title="Copiar valores actuales desde Ítems de Servicio"
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg
								>
								<span>Sincronizar</span>
							</button>
						</header>

						<div class="wb-card-body">
							<div class="wb-table-wrap">
								<div class="wb-row wb-row-fields wb-row-terceros" data-row={tercRowStart}>
									<div class="wb-cell wb-th wb-cell-placa">Placa</div>
									<div class="wb-cell wb-th wb-cell-wide">Tercero (Propietario)</div>
									<div class="wb-cell wb-th wb-cell-text">Recorrido</div>
									<div class="wb-cell wb-th wb-cell-text">Fechas</div>
									<div class="wb-cell wb-th wb-th-num wb-cell-money">V/Unidad</div>
									<div class="wb-cell wb-th wb-th-num wb-cell-num">Cant</div>
									<div class="wb-cell wb-th wb-th-num wb-cell-money">Total Fact.</div>
									<div class="wb-cell wb-th wb-th-num wb-cell-num">Admin %</div>
									<div class="wb-cell wb-th wb-th-num wb-cell-money">Admon $</div>
									<div class="wb-cell wb-th wb-th-num wb-cell-money">V/Liquidar</div>
									<div class="wb-cell wb-th wb-th-num wb-cell-money">Extra Glob.</div>
									<div class="wb-cell wb-th wb-th-num wb-cell-money">Extra Aval</div>
									<div class="wb-cell wb-th wb-th-num wb-cell-money">Ing. Cotransmeq</div>
									<div class="wb-cell wb-th wb-th-action wb-cell-action">✕</div>
								</div>

								{#each terceroRows as t, i (i)}
									{@const calc = terceroCalcs[i]}
									<div class="wb-row wb-row-data wb-row-terceros" data-row={tercRowStart + 1 + i}>
										<div class="wb-cell wb-cell-placa wb-cell-mono" style="color:#ea580c">
											{t.placa || '—'}
										</div>
										<div class="wb-cell wb-cell-wide" data-cell-key={`terc-${i}-nombre`}>
											<div class="ss-wrap">
												{#if t.tercero_id && t.nombre_tercero}
													<div class="ss-selected wb-ss-mini">
														<span
															style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
															>{t.nombre_tercero}</span
														>
														<button class="ss-clear" on:click={() => clearTercero(i)}>✕</button>
													</div>
												{:else}
													<input
														class="ss-search wb-ss-mini"
														placeholder={getTerceroNombre(t.placa, i) || 'Buscar tercero...'}
														value={terceroSearchIdx === i ? terceroSearchText : ''}
														on:focus={() => openTerceroSearch(i)}
														on:blur={() =>
															setTimeout(() => {
																if (terceroSearchIdx === i) closeTerceroSearch();
															}, 200)}
														on:input={(e) => {
															terceroSearchText = e.currentTarget.value;
															onTerceroInput(i);
														}}
														on:keydown={(e) => {
															if (terceroSearchIdx !== i) return;
															if (e.key === 'ArrowDown') {
																e.preventDefault();
																terceroHighlight = Math.min(
																	terceroHighlight + 1,
																	terceroResults.length - 1
																);
															} else if (e.key === 'ArrowUp') {
																e.preventDefault();
																terceroHighlight = Math.max(terceroHighlight - 1, 0);
															} else if (e.key === 'Enter') {
																if (terceroResults.length === 0) return;
																e.preventDefault();
																selectTercero(i, terceroResults[terceroHighlight]);
															} else if (e.key === 'Tab') {
																const placeholderName = getTerceroNombre(t.placa, i);
																if (tercerosList.length > 0 && placeholderName) {
																	e.preventDefault();
																	const best = tercerosList
																		.map((tc) => ({
																			tc,
																			score: scoreNombre(placeholderName, tc.nombre_completo)
																		}))
																		.sort((a, b) => b.score - a.score)[0];
																	if (best?.score > 0.2) selectTercero(i, best.tc);
																} else if (terceroResults.length > 0 && terceroHighlight >= 0) {
																	e.preventDefault();
																	selectTercero(i, terceroResults[terceroHighlight]);
																}
															} else if (e.key === 'Escape') {
																closeTerceroSearch();
															}
														}}
													/>
													{#if terceroSearchIdx === i && (terceroResults.length > 0 || terceroSearching || terceroSearchText.length > 0)}
														<div class="ss-dropdown">
															{#if terceroSearching}
																<div class="ss-empty">Buscando...</div>
															{:else if terceroResults.length === 0 && terceroSearchText.length > 0}
																<div class="ss-empty">Sin resultados</div>
															{:else}
																{#each terceroResults as tc, ci}
																	<div
																		class="ss-option"
																		class:highlighted={ci === terceroHighlight}
																		on:click={() => selectTercero(i, tc)}
																		on:keydown={(e) => e.key === 'Enter' && selectTercero(i, tc)}
																		on:mouseenter={() => (terceroHighlight = ci)}
																		role="option"
																		aria-selected={ci === terceroHighlight}
																		tabindex="-1"
																	>
																		<span class="ss-opt-name">{tc.nombre_completo}</span>
																		<span class="ss-opt-nit"
																			>{tc.identificacion || ''} · {tc.tipo_persona === 'EMPRESA'
																				? '🏢'
																				: '👤'}</span
																		>
																	</div>
																{/each}
															{/if}
														</div>
													{/if}
												{/if}
											</div>
										</div>
										<div
											class="wb-cell wb-cell-text wb-cell-text-muted"
											data-cell-key={`terc-${i}-recorrido`}
										>
											{t.recorrido || '—'}
										</div>
										<div class="wb-cell wb-cell-text" data-cell-key={`terc-${i}-fechas`}>
											<input
												bind:value={terceroRows[i].fechas}
												placeholder="ej. 13 FEB"
												style="text-transform:uppercase"
											/>
										</div>
										<div class="wb-cell wb-cell-money" data-cell-key={`terc-${i}-vr`}>
											<input
												type="text"
												inputmode="numeric"
												value={fmtCOPInput(terceroRows[i].vr_unit)}
												on:focus={(e) => {
													e.currentTarget.value = String(terceroRows[i].vr_unit || '');
													e.currentTarget.select();
												}}
												on:blur={(e) => {
													terceroRows[i].vr_unit = parseCOPInput(e.currentTarget.value);
													terceroRows = terceroRows;
													e.currentTarget.value = fmtCOPInput(terceroRows[i].vr_unit);
												}}
												on:keydown={(e) => {
													if (
														!/[\d,.\-Backspace Tab ArrowLeft ArrowRight Delete Home End]/.test(
															e.key
														) &&
														!e.ctrlKey &&
														!e.metaKey
													)
														e.preventDefault();
												}}
											/>
										</div>
										<div class="wb-cell wb-cell-num" data-cell-key={`terc-${i}-cant`}>
											<input type="number" bind:value={terceroRows[i].cant} min="0" step="0.5" />
										</div>
										<div class="wb-cell wb-cell-money wb-cell-calc">{COP(calc?.totalRow || 0)}</div>
										<div class="wb-cell wb-cell-num" data-cell-key={`terc-${i}-pct`}>
											<input
												type="number"
												bind:value={terceroRows[i].pct_admin}
												min="0"
												max="100"
												step="0.1"
											/>
										</div>
										<div class="wb-cell wb-cell-money wb-cell-calc-danger">
											{COP(calc?.admon || 0)}
										</div>
										<div class="wb-cell wb-cell-money wb-cell-calc-strong">
											{COP(calc?.vLiquidar || 0)}
										</div>
										<div class="wb-cell wb-cell-money wb-cell-calc-success">
											{COP(calc?.extraGlobal || 0)}
										</div>
										<div class="wb-cell wb-cell-money" data-cell-key={`terc-${i}-aval`}>
											<input
												type="text"
												inputmode="numeric"
												value={fmtCOPInput(terceroRows[i].ingresos_extra_aval)}
												on:focus={(e) => {
													e.currentTarget.value = String(terceroRows[i].ingresos_extra_aval || '');
													e.currentTarget.select();
												}}
												on:blur={(e) => {
													terceroRows[i].ingresos_extra_aval = parseCOPInput(e.currentTarget.value);
													terceroRows = terceroRows;
													e.currentTarget.value = fmtCOPInput(terceroRows[i].ingresos_extra_aval);
												}}
												on:keydown={(e) => {
													if (
														!/[\d,.\-Backspace Tab ArrowLeft ArrowRight Delete Home End]/.test(
															e.key
														) &&
														!e.ctrlKey &&
														!e.metaKey
													)
														e.preventDefault();
												}}
											/>
										</div>
										<div class="wb-cell wb-cell-money wb-cell-calc-blue">
											{COP(calc?.ingresoCotransmeq || 0)}
										</div>
										<div class="wb-cell wb-cell-action">
											<button
												class="wb-btn-del"
												on:click={() => delTerceroRow(i)}
												title="Eliminar fila tercero">🗑</button
											>
										</div>
									</div>
								{/each}

								<div
									class="wb-row wb-row-totals wb-row-terceros"
									data-row={tercRowStart + 1 + terceroRows.length}
								>
									<!-- 1. Placa -->
									<div class="wb-cell wb-cell-placa"><b>TOTAL</b></div>
									<!-- 2. Tercero (Propietario) -->
									<div class="wb-cell wb-cell-wide"></div>
									<!-- 3. Recorrido -->
									<div class="wb-cell wb-cell-text"></div>
									<!-- 4. Fechas -->
									<div class="wb-cell wb-cell-text"></div>
									<!-- 5. V/Unidad (input en data row → vacío en totales) -->
									<div class="wb-cell wb-cell-money"></div>
									<!-- 6. Cant (input en data row → vacío en totales) -->
									<div class="wb-cell wb-cell-num"></div>
									<!-- 7. Total Fact. -->
									<div class="wb-cell wb-cell-money wb-cell-calc">
										<b>{COP(tercTotalFacturado)}</b>
									</div>
									<!-- 8. Admin % (input en data row → vacío en totales) -->
									<div class="wb-cell wb-cell-num"></div>
									<!-- 9. Admon $ -->
									<div class="wb-cell wb-cell-money wb-cell-calc-danger">
										<b>{COP(tercTotalAdmon)}</b>
									</div>
									<!-- 10. V/Liquidar -->
									<div class="wb-cell wb-cell-money wb-cell-calc-strong">
										<b>{COP(tercTotalVLiquidar)}</b>
									</div>
									<!-- 11. Extra Glob. -->
									<div class="wb-cell wb-cell-money wb-cell-calc-success">
										<b>{COP(tercTotalExtraGlobal)}</b>
									</div>
									<!-- 12. Extra Aval (input en data row → vacío en totales) -->
									<div class="wb-cell wb-cell-money"></div>
									<!-- 13. Ing. Cotransmeq -->
									<div class="wb-cell wb-cell-money wb-cell-calc-blue">
										<b>{COP(tercTotalIngresoTrans)}</b>
									</div>
									<!-- 14. ✕ Action (placeholder con mismo aspecto que el botón de las filas) -->
									<div class="wb-cell wb-cell-action">
										<span class="wb-btn-del wb-btn-del-placeholder" aria-hidden="true">🗑</span>
									</div>
								</div>
							</div>
						</div>
					</article>
				{/if}

				<!-- ═══ CARD 6b: RESUMEN TERCEROS ═══ -->
				{#if canSeeTerceros && rows.length > 0}
					<article class="wb-card">
						<header class="wb-card-hd wb-card-hd-flex">
							<div class="wb-card-hd-text">
								<span class="wb-card-eyebrow">RESUMEN</span>
								<h2 class="wb-card-title">
									<span class="wb-card-title-icon">📋</span> Resumen Terceros
								</h2>
								<p class="wb-card-sub">
									Distribución de ingresos entre tercero, administración y Cotransmeq
								</p>
							</div>
							<span class="wb-card-count">Tercero · Admin · Global · Recargos · TOTAL</span>
						</header>

						<div class="wb-card-body">
							<div class="resumen-card">
								<div class="resumen-row">
									<span>Ingreso Total Tercero (V/Liquidar)</span>
									<strong style="color:#ea580c">{COP(tercIngresoTotalTercero)}</strong>
								</div>
								<div class="resumen-row">
									<span>Administración Cotransmeq</span>
									<strong style="color:#dc2626">{COP(tercAdminCotransmeq)}</strong>
								</div>
								<div class="resumen-row">
									<span>Ingreso Global</span>
									<strong style="color:#059669">{COP(tercTotalExtraGlobal)}</strong>
								</div>
								<div class="resumen-row">
									<span>Recargos</span>
									<strong style="color:#ea580c">{COP(valRec)}</strong>
								</div>
								<div class="resumen-row resumen-divider emphasis">
									<span>INGRESO TOTAL COTRANSMEQ</span>
									<strong style="color:#166534">{COP(tercIngresoTotalCotransmeq)}</strong>
								</div>
								<div class="resumen-row resumen-total">
									<span>VALOR TOTAL A FACTURAR</span>
									<span>{COP(tercValorTotalFacturar)}</span>
								</div>
							</div>
						</div>
					</article>
				{/if}

				{#if saveError}<div class="wb-error-msg">⚠️ {saveError}</div>{/if}
			</div>
		</div>
	</div>
{:else}
	{@const badge = getEstadoBadge(liqEstado)}

	<!-- ═══════════════════════════════════════════════════════════ -->
	<!-- PREVIEW / PDF VIEW                                           -->
	<!-- ═══════════════════════════════════════════════════════════ -->
	<div class="pdf-wrap">
		<header class="pdf-bar">
			<div class="pdf-bar-inner">
				<div class="pdf-bar-brand">
					<div class="pdf-bar-headings">
						<h1 class="pdf-bar-title">
							{previewPage === 'liquidacion'
								? 'Liquidación de Servicios'
								: previewPage === 'recargos'
									? 'Recargos (Horas)'
									: previewPage === 'terceros'
										? 'Liquidación de Terceros'
										: 'Liquidador de Recargos'}
							<div class="estado-bar-status">
								<span class="estado-badge estado-badge-{liqEstado.toLowerCase()}"
									>{badge.label}</span
								>
							</div>
						</h1>
						<p class="pdf-bar-sub">
							{hdr.consecutivo || 'Sin consecutivo'} · {hdr.mes}
							{hdr.anio} · {selectedCliente?.nombre || 'Sin cliente'}
							<span class="pdf-bar-eyebrow">
								{previewPage === 'liquidacion'
									? 'OP-FR-07 · LIQUIDACIÓN DE SERVICIOS'
									: previewPage === 'recargos'
										? 'OP-FR-06 · RECARGOS (HORAS)'
										: previewPage === 'terceros'
											? 'GAF-FR-11 · TERCEROS'
											: 'OP-FR-06 · LIQUIDADOR DE RECARGOS'}
							</span>
						</p>
					</div>
				</div>

				<div class="pdf-bar-tools">
					<!-- Page tabs (Hoja 1-4) -->
					<div class="page-tabs" role="tablist" aria-label="Hojas del documento">
						<button
							class="ptab"
							class:active={previewPage === 'liquidacion'}
							on:click={() => (previewPage = 'liquidacion')}
							role="tab"
							aria-selected={previewPage === 'liquidacion'}
						>
							<span class="ptab-num">1</span>
							<span class="ptab-full">Hoja 1 · Liquidación</span>
							<span class="ptab-short">Hoja 1</span>
						</button>
						<button
							class="ptab"
							class:active={previewPage === 'recargos'}
							on:click={() => (previewPage = 'recargos')}
							role="tab"
							aria-selected={previewPage === 'recargos'}
						>
							<span class="ptab-num">2</span>
							<span class="ptab-full">Hoja 2 · Recargos</span>
							<span class="ptab-short">Hoja 2</span>
						</button>
						<button
							class="ptab"
							class:active={previewPage === 'liquidador'}
							on:click={() => (previewPage = 'liquidador')}
							role="tab"
							aria-selected={previewPage === 'liquidador'}
						>
							<span class="ptab-num">3</span>
							<span class="ptab-full">Hoja 3 · Liquidador</span>
							<span class="ptab-short">Hoja 3</span>
						</button>
						{#if canSeeTerceros}
							<button
								class="ptab"
								class:active={previewPage === 'terceros'}
								on:click={() => (previewPage = 'terceros')}
								role="tab"
								aria-selected={previewPage === 'terceros'}
							>
								<span class="ptab-num">4</span>
								<span class="ptab-full">Hoja 4 · Terceros</span>
								<span class="ptab-short">Hoja 4</span>
							</button>
						{/if}
					</div>

					<!-- Zoom controls -->
					<div class="zoom-controls" aria-label="Controles de zoom">
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
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg
							>
						</button>
						<button
							class="zoom-btn zoom-fit"
							on:click={fitToViewport}
							title="Ajustar al ancho de la pantalla"
							aria-label="Ajustar al ancho de la pantalla"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M4 8V4h4" /><path d="M20 8V4h-4" /><path d="M4 16v4h4" /><path
									d="M20 16v4h-4"
								/></svg
							>
						</button>
					</div>

					<!-- Action buttons -->
					<button
						class="liq-loading-back"
						on:click={() => {
							if (viewMode && editId) {
								goto(BACK_URL);
							} else {
								setView('editor');
							}
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
						>
						<span>{viewMode ? 'Volver' : 'Editar'}</span>
					</button>
					<button class="liq-btn-primary pdf-bar-print" on:click={handlePrint}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path d="M6 9V2h12v7" /><rect x="6" y="14" width="12" height="8" /><path
								d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
							/></svg
						>
						<span class="pbtn-label-full">Imprimir / PDF</span>
						<span class="pbtn-label-short">PDF</span>
					</button>
				</div>
			</div>
		</header>

		<!-- ── ESTADO BAR (trazabilidad) ── -->
		{#if editingId}
			<div class="estado-bar no-print">
				<div class="estado-info-stack">
					<!-- {#if liqFechaLiquidacion && ['BORRADOR', 'LIQUIDADA', 'APROBADA', 'FACTURADA'].includes(liqEstado)}
					<span
						class="estado-info"
						title="Creada: {fmtFecha()}{liqCreadoPor
							? ' por ' + creadaPor.nombre
							: ''}"
					>
						<span class="estado-info-icon" aria-hidden="true">
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path
									d="M14 2v6h6"
								/><path d="M9 14l2 2 4-4" /></svg
							>
						</span>
						<span class="estado-info-short">{fmtFechaShort(liqFechaLiquidacion)}</span>
						<span class="estado-info-full">
							Liquidada: <strong>{fmtFecha(liqFechaLiquidacion)}</strong>{#if liqLiquidadoPor}{' '} Por:
								<strong>{liqLiquidadoPor.nombre}</strong>{/if}
						</span>
					</span>
				{/if} -->
					{#if liqFechaLiquidacion && ['LIQUIDADA', 'APROBADA', 'FACTURADA'].includes(liqEstado)}
						<span
							class="estado-info"
							title="Liquidada: {fmtFecha(liqFechaLiquidacion)}{liqLiquidadoPor
								? ' por ' + liqLiquidadoPor.nombre
								: ''}"
						>
							<span class="estado-info-icon" aria-hidden="true">
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path
										d="M14 2v6h6"
									/><path d="M9 14l2 2 4-4" /></svg
								>
							</span>
							<span class="estado-info-short">{fmtFechaShort(liqFechaLiquidacion)}</span>
							<span class="estado-info-full">
								Liquidada: <strong>{fmtFecha(liqFechaLiquidacion)}</strong
								>{#if liqLiquidadoPor}{' '} Por:
									<strong>{liqLiquidadoPor.nombre}</strong>{/if}
							</span>
						</span>
					{/if}
					{#if liqFechaAprobacion && ['APROBADA', 'FACTURADA'].includes(liqEstado)}
						<span
							class="estado-info"
							title="Aprobada: {fmtFecha(liqFechaAprobacion)}{liqAprobadoPor
								? ' por ' + liqAprobadoPor.nombre
								: ''}"
						>
							<span class="estado-info-icon" aria-hidden="true">
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg
								>
							</span>
							<span class="estado-info-short">{fmtFechaShort(liqFechaAprobacion)}</span>
							<span class="estado-info-full">
								Aprobada: <strong>{fmtFecha(liqFechaAprobacion)}</strong>{#if liqAprobadoPor}{' '} Por:
									<strong>{liqAprobadoPor.nombre}</strong>{/if}
							</span>
						</span>
					{/if}
					{#if liqFechaFacturacion && liqEstado === 'FACTURADA'}
						<span class="estado-info" title="Facturada: {fmtFecha(liqFechaFacturacion)}">
							<span class="estado-info-icon" aria-hidden="true">
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line
										x1="3"
										y1="6"
										x2="21"
										y2="6"
									/><path d="M16 10a4 4 0 0 1-8 0" /></svg
								>
							</span>
							<span class="estado-info-short">{fmtFechaShort(liqFechaFacturacion)}</span>
							<span class="estado-info-full"
								>Facturada: <strong>{fmtFecha(liqFechaFacturacion)}</strong></span
							>
						</span>
					{/if}
				</div>

				<div class="estado-bar-actions">
					<button
						class="liq-btn-secondary estado-btn"
						on:click={obtenerCSV}
						disabled={csvLoading}
						title="Obtener CSV (Excel)"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path
								d="M14 2v6h6"
							/><path d="M12 18v-6" /><path d="M9 15h6" /></svg
						>
						<span>{csvLoading ? 'Generando…' : 'Obtener CSV'}</span>
					</button>
					<button
						class="liq-btn-primary estado-btn"
						disabled={historialLoading}
						on:click={abrirHistorial}
						title="Ver trazabilidad de estados"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg
						>
						<span>Trazabilidad</span>
					</button>
				</div>
			</div>
		{/if}

		<!-- A4 LANDSCAPE — HOJA 1: LIQUIDACIÓN (horizontal, como transmeralda) -->
		{#if (isPrinting && printSheets.liquidacion) || (!isPrinting && previewPage === 'liquidacion')}
			<div class="pdf-body pdf-body-landscape print-sheet print-sheet-landscape">
				<div
					class="page page-landscape"
					style="transform: scale({pdfZoom}); transform-origin: top center;"
				>
					<div class="dh">
						<div class="dh-logo">
							{#if logoError}<div class="dh-logo-fallback">COTRANS<br />MEQ</div>{:else}<img
									src="/assets/logo_nombre.webp"
									alt="Logo"
									on:error={() => (logoError = true)}
									style="height:58px;width:auto;object-fit:contain"
								/>{/if}
						</div>
						<div class="dh-title">
							<div class="dh-co">{hdr.empresa}</div>
							<div class="dh-doc">LIQUIDACIÓN DE SERVICIOS</div>
						</div>
						<div class="dh-meta">
							<table class="mt">
								<tbody
									><tr><td class="ml">Código:</td><td class="mv">OP-FR-07</td></tr><tr
										><td class="ml">Versión:</td><td>2</td></tr
									><tr><td class="ml">Fecha:</td><td>14/08/23</td></tr></tbody
								>
							</table>
						</div>
						<div class="dh-super">
							<img
								src="https://transmeralda.s3.us-east-2.amazonaws.com/assets/supertransporte_logo.png"
								alt="Supertransporte"
							/>
						</div>
					</div>
					<div class="pb">
						<div class="pc">
							<span class="pclabel">MES:</span><span class="pcval">{hdr.mes}</span>
						</div>
						<div class="pc">
							<span class="pclabel">AÑO</span><span class="pcval">{hdr.anio}</span>
						</div>
						<div class="pc" style="flex:2">
							<span class="pclabel">CLIENTE:</span><span class="pcval"
								>{selectedCliente?.nombre || ''}{selectedCliente?.nit
									? ` — NIT: ${selectedCliente.nit}`
									: ''}</span
							>
						</div>
						<div class="pc pc-consec" style="flex:1.5">
							<span class="pclabel">CONSECUTIVO LIQUIDACIÓN N°:</span><span class="pcval"
								>&nbsp;{hdr.consecutivo}</span
							>
						</div>
					</div>
					<table class="st">
						<thead
							><tr
								><th style="width:6.5%">PLACA</th><th style="width:7%">FECHA<br />INICIAL</th><th
									style="width:7%">FECHA<br />FINAL</th
								><th style="width:22%">RECORRIDO</th><th style="width:15.5%">TIPO DE SERVICIO</th
								><th style="width:4%">CANT.</th><th style="width:9%">VR. UNITARIO</th><th
									style="width:9%">SUBTOTAL</th
								><th style="width:5%">DCTO.</th><th style="width:9%">VR. FINAL</th><th
									style="width:6%">N° PLANILLA</th
								></tr
							></thead
						>
						<tbody>
							{#each rows as row (row.id)}
								{@const { sub, vf } = calcRow(row)}
								<tr
									><td><span class="placa">{fmtPlaca(row.placa)}</span></td><td class="tc"
										>{fmtD(row.fecha_ini)}</td
									><td class="tc">{fmtD(row.fecha_fin)}</td><td
										style="font-size:7.2pt;line-height:1.3">{row.recorrido}</td
									><td style="font-size:7pt">{getTipoLabel(row.tipo)}</td><td
										class="tc"
										style="font-weight:700">{row.cant}</td
									><td class="mc">{COP(row.vr_unit)}</td><td class="mc">{COP(sub)}</td><td
										class="tc">{row.dcto}%</td
									><td class="mch">{COP(vf)}</td><td
										class="tc"
										style="font-family:'Geist',sans-serif;font-variant-numeric:tabular-nums;font-size:7.2pt">{row.planilla}</td
									></tr
								>
							{/each}
							{#each Array(Math.max(0, 10 - rows.length)) as _}<tr class="filler"
									>{#each Array(11) as __}<td></td>{/each}</tr
								>{/each}
						</tbody>
						<tfoot
							><tr
								><td
									colspan="9"
									style="text-align:right;color:#ea580c;padding-right:8px;font-size:8pt;font-weight:800;text-transform:uppercase;letter-spacing:0.04em"
									>TOTAL SERVICIOS:</td
								><td class="mch" style="border-left:1px solid #fed7aa">{COP(totalSvc)}</td><td
								></td></tr
							></tfoot
						>
					</table>
					<div class="doc-summary">
						<div class="doc-summary-title">RESUMEN DEL DOCUMENTO</div>
						<div class="doc-summary-grid">
							<div class="doc-summary-left">
								<div class="doc-summary-row">
									<span class="doc-summary-lbl">Observaciones:</span>
									<span class="doc-summary-val">{hdr.observaciones || '—'}</span>
								</div>
								<div class="doc-summary-row">
									<span class="doc-summary-lbl">OPERADORA:</span>
									<span class="doc-summary-val">{hdr.operadora}</span>
								</div>
								{#if hdr.osi}
									<div class="doc-summary-row">
										<span class="doc-summary-lbl">OSI:</span>
										<span class="doc-summary-val">{hdr.osi}</span>
									</div>
								{/if}
								<div class="doc-summary-pernote">
									<div class="doc-summary-pernote-title">PERNOCTE</div>
									<table class="doc-summary-tbl">
										<thead>
											<tr>
												<th>Vr. Unitario</th>
												<th>Cantidad</th>
												<th>Total</th>
											</tr>
										</thead>
										<tbody>
											<tr>
												<td>{COP(ext.pernote_unit)}</td>
												<td>{ext.pernote_cant}</td>
												<td class="doc-summary-strong">{COP(valPern)}</td>
											</tr>
										</tbody>
									</table>
								</div>
							</div>
							<div class="doc-summary-right">
								<table class="doc-summary-totals">
									<tbody>
										<tr>
											<td>VALOR TOTAL DEL SERVICIO SIN RECARGOS</td>
											<td>{COP(totalSvc)}</td>
										</tr>
										<tr>
											<td>VALOR TOTAL RECARGOS</td>
											<td>{COP(valRec)}</td>
										</tr>
										<tr>
											<td>PERNOCTE</td>
											<td>{COP(valPern)}</td>
										</tr>
										<tr class="doc-summary-sub">
											<td>SUBTOTAL</td>
											<td>{COP(subtotal)}</td>
										</tr>
										<tr>
											<td>IVA {ext.iva_pct}%</td>
											<td>{COP(ivaVal)}</td>
										</tr>
										<tr class="doc-summary-grand">
											<td>TOTAL SERVICIO</td>
											<td>{COP(total)}</td>
										</tr>
									</tbody>
								</table>
							</div>
							<div class="doc-summary-sigs">
								<div>
									<div class="doc-summary-siglbl"
										>FIRMA AUTORIZADA POR CLIENTE{selectedCliente?.nombre
											? ` — ${selectedCliente.nombre}`
											: ''}:</div
									>
									<div class="doc-summary-sigline"
										>{selectedCliente?.nombre || ''}{selectedCliente?.nit
											? ` — NIT: ${selectedCliente.nit}`
											: ''}</div
									>
								</div>
								<div>
									<div class="doc-summary-siglbl">FIRMA AUTORIZADA POR:</div>
									<div class="doc-summary-sigline">&nbsp;</div>
								</div>
							</div>
							<div class="doc-summary-ft">
								<span>OP-FR-07 · Versión 2 · 14/08/23</span>
								<span
									>Generado el {new Date().toLocaleDateString('es-CO', {
										day: '2-digit',
										month: 'long',
										year: 'numeric'
									})}</span
								>
								<span>{hdr.empresa}</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- A4 LANDSCAPE — HOJA 2: RECARGOS -->
		{#if (isPrinting && printSheets.recargos) || (!isPrinting && previewPage === 'recargos')}
			<div class="pdf-body pdf-body-landscape print-sheet print-sheet-landscape">
				<div
					class="page page-landscape"
					style="transform: scale({pdfZoom}); transform-origin: top center;"
				>
					<div class="dh">
						<div class="dh-logo">
							{#if logoError}<div class="dh-logo-fallback">COTRANS<br />MEQ</div>{:else}<img
									src="/assets/logo_nombre.webp"
									alt="Logo"
									on:error={() => (logoError = true)}
									style="height:46px;width:auto;object-fit:contain"
								/>{/if}
						</div>
						<div class="dh-title">
							<div class="dh-co">{hdr.empresa}</div>
							<div class="dh-doc">LIQUIDADOR DE RECARGOS</div>
						</div>
						<div class="dh-meta">
							<table class="mt">
								<tbody
									><tr><td class="ml">Código:</td><td class="mv">OP-FR-06</td></tr><tr
										><td class="ml">Versión:</td><td>2</td></tr
									><tr><td class="ml">Fecha:</td><td>14/08/23</td></tr></tbody
								>
							</table>
						</div>
						<div class="dh-super">
							<img
								src="https://transmeralda.s3.us-east-2.amazonaws.com/assets/supertransporte_logo.webp"
								alt="Supertransporte"
							/>
						</div>
					</div>
					<div class="pb" style="font-size:7pt">
						<div class="pc">
							<span class="pclabel">MES:</span><span class="pcval">{hdr.mes}</span>
						</div>
						<div class="pc">
							<span class="pclabel">AÑO:</span><span class="pcval">{hdr.anio}</span>
						</div>
						<div class="pc" style="flex:2">
							<span class="pclabel">CLIENTE:</span><span class="pcval"
								>{selectedCliente?.nombre || ''}</span
							>
						</div>
					</div>
					{#if recargosRows.length > 0}
						<table class="rgt">
							<thead
								><tr
									><th class="rgt-emp">EMPRESA</th><th class="rgt-pla">N° PLANILLA</th><th
										class="rgt-pla">PLACA</th
									><th class="rgt-cnd">CONDUCTOR</th>{#each Array(31) as _, i}<th class="rgt-d"
											>{i + 1}</th
										>{/each}<th class="rgt-t">TOTAL</th><th class="rgt-t">PROM</th></tr
								></thead
							>
							<tbody>
								{#each recargosRows as row (row.id)}<tr
										><td class="rgt-emp">{(row.empresa || '').toUpperCase()}</td><td
											class="rgt-pla tc">{row.planilla}</td
										><td class="rgt-pla tc"><span class="placa">{fmtPlaca(row.placa)}</span></td><td
											class="rgt-cnd">{(row.conductor || '').toUpperCase()}</td
										>{#each Array(31) as _, i}<td
												class="rgt-d tc"
												style={row.days[i] > 0 ? 'font-weight:700;color:#ea580c' : 'color:#cbd5e1'}
												>{row.days[i] ? row.days[i].toFixed(1) : '-'}</td
											>{/each}<td class="rgt-t tc" style="font-weight:800;color:#ea580c"
											>{row.total.toFixed(1)}</td
										><td class="rgt-t tc">{row.promedio.toFixed(1)}</td></tr
									>{/each}
								<tr class="rgt-totals"
									><td colspan="4" style="text-align:right;font-weight:800;padding-right:6px"
										>TOTALES</td
									>{#each Array(31) as _, i}<td class="rgt-d tc" style="font-weight:800"
											>{recargosTotals.days[i] ? recargosTotals.days[i].toFixed(1) : ''}</td
										>{/each}<td
										class="rgt-t tc"
										style="font-weight:900;color:#ea580c;font-size:7.5pt"
										>{recargosTotals.total.toFixed(1)}</td
									><td></td></tr
								>
							</tbody>
						</table>
					{:else}<div
							style="text-align:center;padding:40px 20px;color:#94a3b8;font-style:italic;font-size:9pt"
						>
							Sin datos de recargos.
						</div>{/if}
					{#if recargosRows.length > 0}
						<div style="margin-top:10px">
							<div
								style="font-size:7.5pt;font-weight:800;color:#ea580c;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em"
							>
								Consolidado Recargos
							</div>
							<table class="crt">
								<thead
									><tr
										><th>EMPRESA</th><th>N° PLANILLA</th><th>PLACA</th><th>CONDUCTOR</th><th>HED</th
										><th>HEN</th><th>HEFD</th><th>HEFN</th><th>RNDF</th><th>RN</th><th>RD</th></tr
									></thead
								>
								<tbody
									>{#each recargosRows as row (row.id)}<tr
											><td>{(row.empresa || '').toUpperCase()}</td><td class="tc">{row.planilla}</td
											><td class="tc"><span class="placa">{fmtPlaca(row.placa)}</span></td><td
												style="font-size:6pt">{(row.conductor || '').toUpperCase()}</td
											><td class="mc">{row.hed.toFixed(2)}</td><td class="mc"
												>{row.hen.toFixed(2)}</td
											><td class="mc">{row.hefd.toFixed(2)}</td><td class="mc"
												>{row.hefn.toFixed(2)}</td
											><td class="mc">{row.rndf.toFixed(2)}</td><td class="mc"
												>{row.rn.toFixed(2)}</td
											><td class="mc">{row.rd.toFixed(2)}</td></tr
										>{/each}
									<tr class="rgt-totals"
										><td colspan="4" style="text-align:right;font-weight:800;padding-right:6px"
											>TOTALES</td
										><td class="mc" style="font-weight:800">{recargosTotals.hed.toFixed(2)}</td><td
											class="mc"
											style="font-weight:800">{recargosTotals.hen.toFixed(2)}</td
										><td class="mc" style="font-weight:800">{recargosTotals.hefd.toFixed(2)}</td><td
											class="mc"
											style="font-weight:800">{recargosTotals.hefn.toFixed(2)}</td
										><td class="mc" style="font-weight:800">{recargosTotals.rndf.toFixed(2)}</td><td
											class="mc"
											style="font-weight:800">{recargosTotals.rn.toFixed(2)}</td
										><td class="mc" style="font-weight:800">{recargosTotals.rd.toFixed(2)}</td></tr
									></tbody
								>
							</table>
						</div>
					{/if}
					<div class="sigs" style="margin-top:24px">
						<div class="sig">
							<div class="sig-lbl">FIRMA AUTORIZADA POR CLIENTE:</div>
							<div class="sig-line">{selectedCliente?.nombre || ''}</div>
						</div>
						<div class="sig">
							<div class="sig-lbl">FIRMA AUTORIZADA POR:</div>
							<!-- {#if ['APROBADA', 'FACTURADA'].includes(liqEstado) && firmaGerencia?.firma_signed_url}<img
									class="firma-img"
									src={firmaGerencia.firma_signed_url}
									alt="Firma {firmaGerencia.nombre}"
								/>{/if} -->
							<div class="sig-line">&nbsp;</div>
						</div>
					</div>
					<div class="doc-ft">
						<span>OP-FR-06 · Versión 2 · 14/08/23</span><span
							>Generado el {new Date().toLocaleDateString('es-CO', {
								day: '2-digit',
								month: 'long',
								year: 'numeric'
							})}</span
						><span>{hdr.empresa}</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- A4 LANDSCAPE — HOJA 3: LIQUIDADOR (horizontal, como transmeralda) -->
		{#if (isPrinting && printSheets.liquidador) || (!isPrinting && previewPage === 'liquidador')}
			<div class="pdf-body pdf-body-landscape print-sheet print-sheet-landscape">
				<div
					class="page page-landscape"
					style="transform: scale({pdfZoom}); transform-origin: top center;"
				>
					<div class="dh">
						<div class="dh-logo">
							{#if logoError}<div class="dh-logo-fallback">COTRANS<br />MEQ</div>{:else}<img
									src="/assets/logo_nombre.webp"
									alt="Logo"
									on:error={() => (logoError = true)}
									style="height:58px;width:auto;object-fit:contain"
								/>{/if}
						</div>
						<div class="dh-title">
							<div class="dh-co">{hdr.empresa}</div>
							<div class="dh-doc">LIQUIDADOR DE RECARGOS</div>
						</div>
						<div class="dh-meta">
							<table class="mt">
								<tbody
									><tr><td class="ml">Código:</td><td class="mv">OP-FR-06</td></tr><tr
										><td class="ml">Versión:</td><td>2</td></tr
									><tr><td class="ml">Fecha:</td><td>8/08/23</td></tr></tbody
								>
							</table>
						</div>
						<div class="dh-super">
							<img
								src="https://transmeralda.s3.us-east-2.amazonaws.com/assets/supertransporte_logo.webp"
								alt="Supertransporte"
							/>
						</div>
					</div>
					<div class="liq-salary-bar">
						<div class="liq-sal-group">
							<span class="liq-sal-lbl">SALARIO BASICO</span><span class="liq-sal-val"
								>$ {liqCfg.salario_basico.toLocaleString('es-CO')}</span
							><span class="liq-sal-lbl"
								>VALOR HORA TRABAJADOR{liqCfg.valor_hora_override > 0 ? ' (manual)' : ''}</span
							><span class="liq-sal-val">$ {fmtDec1(valorHora)}</span>
						</div>
						<div class="liq-sal-group">
							<span class="liq-sal-lbl">CARGO</span><span class="liq-sal-val">{liqCfg.cargo}</span>
						</div>
					</div>
					<div class="pb">
						<div class="pc">
							<span class="pclabel">PERIDO DE LIQUIDACIÓN MES:</span><span class="pcval"
								>{hdr.mes}</span
							>
						</div>
						<div class="pc">
							<span class="pclabel">AÑO:</span><span class="pcval">AÑO {hdr.anio}</span>
						</div>
					</div>
					<table class="liq-tbl">
						<thead
							><tr
								><th style="text-align:left;width:50%">DESCRIPCION</th><th style="width:10%">%</th
								><th style="width:15%">VR UNITARIO</th><th style="width:12%">TOTAL HORAS</th><th
									style="width:13%">TOTAL</th
								></tr
							></thead
						>
						<tbody>
							{#each liqLineas as linea}<tr
									><td style="text-align:left;font-weight:600">{linea.desc}</td><td class="tc"
										>{linea.pct}</td
									><td class="mc">{fmtDec1(linea.vrUnit)}</td><td class="mc"
										>{linea.horas > 0 ? linea.horas.toFixed(1).replace('.', ',') : '-'}</td
									><td class="mc" style="font-weight:700">{fmtDec1(linea.total)}</td></tr
								>{/each}
							<tr class="liq-sub-row"
								><td colspan="4" style="text-align:right;font-weight:800;padding-right:10px"
									>SUBTOTAL 1</td
								><td class="mc" style="font-weight:800">{fmtDec1(liqSubtotal1)}</td></tr
							>
							<tr
								><td style="text-align:left"
									>SEGURIDAD SOCIAL {liqCfg.pct_seg_social.toFixed(2).replace('.', ',')}%</td
								><td class="tc">{liqCfg.pct_seg_social.toFixed(2).replace('.', ',')}%</td><td
								></td><td></td><td class="mc">{fmtDec1(liqSegSocial)}</td></tr
							>
							<tr
								><td style="text-align:left"
									>PRESTACIONES SOCIALES {liqCfg.pct_prestaciones.toFixed(2).replace('.', ',')} %</td
								><td class="tc">{liqCfg.pct_prestaciones.toFixed(2).replace('.', ',')}%</td><td
								></td><td></td><td class="mc">{fmtDec1(liqPrestaciones)}</td></tr
							>
							<tr class="liq-sub-row"
								><td colspan="4" style="text-align:right;font-weight:800;padding-right:10px"
									>SUBTOTAL 2</td
								><td class="mc" style="font-weight:800">{fmtDec1(liqSubtotal2)}</td></tr
							>
							<tr
								><td style="text-align:left">PRUEBA COVID ANTIGENO</td><td></td><td class="mc"
									>{fmtDec1(liqCfg.prueba_covid > 0 ? liqCfg.prueba_covid : 0)}</td
								><td></td><td class="mc">{fmtDec1(liqPruebaCovid)}</td></tr
							>
							<tr
								><td style="text-align:left">ADMINISTRACION {liqCfg.pct_admin}%</td><td class="tc"
									>{liqCfg.pct_admin}%</td
								><td></td><td></td><td class="mc">{fmtDec1(liqAdmin)}</td></tr
							>
							<tr class="liq-total-row"
								><td
									colspan="4"
									style="text-align:right;font-weight:900;padding-right:10px;font-size:9.5pt"
									>TOTAL</td
								><td class="mc" style="font-weight:900;font-size:9.5pt;color:#ea580c"
									>{fmtDec1(liqTotal)}</td
								></tr
							>
						</tbody>
					</table>
					<div class="sigs" style="margin-top:10px">
						<div class="sig">
							<div class="sig-lbl">FIRMA AUTORIZADA POR CLIENTE:</div>
							<div class="sig-line">{selectedCliente?.nombre || ''}</div>
						</div>
						<div class="sig">
							<div class="sig-lbl">FIRMA AUTORIZADA POR:</div>
							<!-- {#if ['APROBADA', 'FACTURADA'].includes(liqEstado) && firmaGerencia?.firma_signed_url}<img
									class="firma-img"
									src={firmaGerencia.firma_signed_url}
									alt="Firma {firmaGerencia.nombre}"
								/>{/if} -->
							<div class="sig-line">&nbsp;</div>
						</div>
					</div>
					<div class="doc-ft">
						<span>OP-FR-06 · Versión 2 · 8/08/23</span><span
							>Generado el {new Date().toLocaleDateString('es-CO', {
								day: '2-digit',
								month: 'long',
								year: 'numeric'
							})}</span
						><span>{hdr.empresa}</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- A4 LANDSCAPE — HOJA 4: TERCEROS -->
		{#if (isPrinting && printSheets.terceros) || (!isPrinting && previewPage === 'terceros')}
			<div class="pdf-body pdf-body-landscape print-sheet print-sheet-landscape">
				<div
					class="page page-landscape"
					style="transform: scale({pdfZoom}); transform-origin: top center;"
				>
					<div class="dh">
						<div class="dh-logo">
							{#if logoError}<div class="dh-logo-fallback">COTRANS<br />MEQ</div>{:else}<img
									src="/assets/logo_nombre.webp"
									alt="Logo"
									on:error={() => (logoError = true)}
									style="height:58px;width:auto;object-fit:contain"
								/>{/if}
						</div>
						<div class="dh-title">
							<div class="dh-co">{hdr.empresa}</div>
							<div class="dh-doc">LIQUIDACIÓN DE INGRESOS RECIBIDOS PARA TERCEROS</div>
						</div>
						<div class="dh-meta">
							<table class="mt">
								<tbody
									><tr><td class="ml">Código:</td><td class="mv">GAF-FR-11</td></tr><tr
										><td class="ml">Versión:</td><td>1</td></tr
									><tr
										><td class="ml">Fecha:</td><td>{new Date().toLocaleDateString('es-CO')}</td></tr
									></tbody
								>
							</table>
						</div>
					</div>
					<div class="pb">
						<div class="pc">
							<span class="pclabel">MES:</span><span class="pcval">{hdr.mes}</span>
						</div>
						<div class="pc">
							<span class="pclabel">AÑO:</span><span class="pcval">{hdr.anio}</span>
						</div>
						<div class="pc">
							<span class="pclabel">CONSECUTIVO:</span><span class="pcval"
								>{hdr.consecutivo || ''}</span
							>
						</div>
					</div>
					<table class="terc-prev-tbl">
						<thead
							><tr
								><th style="width:35px">#</th><th>PLACA</th><th>NOMBRE DEL TERCERO</th><th
									>DESCRIPCIÓN SERVICIO</th
								><th>FECHAS</th><th>VR UNIDAD</th><th>CANT</th><th>TOTAL FACTURADO</th><th
									>ADMON %</th
								><th>ADMON $</th><th>V/LIQUIDAR 3°</th></tr
							></thead
						>
						<tbody
							>{#each terceroRows as t, i}{@const calc = terceroCalcs[i]}<tr
									><td class="tc">{i + 1}</td><td class="tc" style="font-weight:600"
										>{fmtPlaca(t.placa)}</td
									><td style="font-size:7.5pt"
										>{(t.nombre_tercero || getTerceroNombre(t.placa, i) || '').toUpperCase()}</td
									><td style="font-size:7.5pt">{t.recorrido || ''}</td><td
										class="tc"
										style="font-size:7pt;white-space:nowrap">{t.fechas || ''}</td
									><td class="mc">{COP(t.vr_unit)}</td><td class="tc">{t.cant}</td><td
										class="mc"
										style="font-weight:700">{COP(calc?.totalRow || 0)}</td
									><td class="tc">{calc?.pctAdmin || 0}%</td><td class="mc" style="color:#b91c1c"
										>{COP(calc?.admon || 0)}</td
									><td class="mc" style="font-weight:700;color:#ea580c"
										>{COP(calc?.vLiquidar || 0)}</td
									></tr
								>{/each}</tbody
						>
						<tfoot
							><tr style="font-weight:800;background:#e2e8f0"
								><td colspan="7" style="text-align:right;padding-right:6px">TOTALES</td><td
									class="mc">{COP(tercTotalFacturado)}</td
								><td></td><td class="mc" style="color:#b91c1c">{COP(tercTotalAdmon)}</td><td
									class="mc"
									style="color:#ea580c">{COP(tercTotalVLiquidar)}</td
								></tr
							></tfoot
						>
					</table>
					<table class="terc-prev-tbl" style="margin-top:10px">
						<thead
							><tr
								><th style="width:28px">#</th><th>PLACA</th><th>PROPIETARIO</th><th>CC / NIT</th><th
									>TIPO</th
								><th style="width:50px">ÍTEMS</th><th>V/LIQUIDAR</th></tr
							></thead
						>
						<tbody
							>{#each terceroPlacasGroup as g, gi}<tr
									><td class="tc">{gi + 1}</td><td
										class="tc"
										style="font-weight:700;font-family:'Geist',sans-serif;font-variant-numeric:tabular-nums">{fmtPlaca(g.placa)}</td
									><td style="font-size:7.5pt;font-weight:600">{g.nombre.toUpperCase()}</td><td
										class="tc"
										style="font-size:7.5pt">{g.identificacion || '—'}</td
									><td class="tc" style="font-size:7pt"
										>{g.tipo === 'EMPRESA' ? '🏢 EMPRESA' : '👤 PERSONA'}</td
									><td class="tc">{g.items}</td><td class="mc" style="font-weight:700;color:#ea580c"
										>{COP(g.vLiquidar)}</td
									></tr
								>{/each}</tbody
						>
						<tfoot
							><tr style="font-weight:800;background:#e2e8f0"
								><td colspan="5" style="text-align:right;padding-right:6px"
									>TOTAL ({terceroPlacasGroup.length}
									{terceroPlacasGroup.length === 1 ? 'placa' : 'placas'})</td
								><td class="tc" style="font-weight:700">{terceroRows.length}</td><td class="mc"
									>{COP(tercTotalVLiquidar)}</td
								></tr
							></tfoot
						>
					</table>
					<div class="terc-summary-box">
						<table class="terc-summary-tbl">
							<tbody>
								<tr
									><td class="ts-lbl">INGRESO TOTAL TERCERO (V/Liquidar)</td><td
										class="ts-val"
										style="color:#ea580c">{COP(tercIngresoTotalTercero)}</td
									></tr
								>
								<tr class="ts-sep"
									><td class="ts-lbl">ADMINISTRACIÓN COTRANSMEQ</td><td
										class="ts-val"
										style="color:#b91c1c">{COP(tercAdminCotransmeq)}</td
									></tr
								>
								<tr
									><td class="ts-lbl">INGRESO EXTRA GLOBAL</td><td
										class="ts-val"
										style="color:#ea580c">{COP(tercTotalExtraGlobal)}</td
									></tr
								>
								<tr
									><td class="ts-lbl">PERNOCTES</td><td class="ts-val" style="color:#ea580c"
										>{COP(valPern)}</td
									></tr
								>
								<tr
									><td class="ts-lbl">RECARGOS</td><td class="ts-val" style="color:#ea580c"
										>{COP(valRec)}</td
									></tr
								>
								<tr class="ts-total"
									><td class="ts-lbl">INGRESO TOTAL COTRANSMEQ</td><td
										class="ts-val"
										style="color:#ea580c">{COP(tercIngresoTotalCotransmeq)}</td
									></tr
								>
								<tr class="ts-grand"
									><td class="ts-lbl">VALOR TOTAL A FACTURAR</td><td class="ts-val"
										>{COP(tercValorTotalFacturar)}</td
									></tr
								>
							</tbody>
						</table>
					</div>
					<div class="sigs" style="margin-top:18px">
						<div class="sig">
							<div class="sig-lbl">LIQUIDADO POR — GERENCIA:</div>
							<!-- {#if ['APROBADA', 'FACTURADA'].includes(liqEstado) && firmaGerencia?.firma_signed_url}<img
									class="firma-img"
									src={firmaGerencia.firma_signed_url}
									alt="Firma {firmaGerencia.nombre}"
								/>{/if} -->
							<div class="sig-line">&nbsp;</div>
						</div>
						<div class="sig">
							<div class="sig-lbl">FACTURADO POR — FACTURACIÓN:</div>
							<!-- {#if liqEstado === 'FACTURADA' && firmaFacturacion?.firma_signed_url}
							<img
									class="firma-img"
									src={firmaFacturacion.firma_signed_url}
									alt="Firma {firmaFacturacion.nombre}"
								/>{/if} -->
							<div class="sig-line">&nbsp;</div>
						</div>
					</div>
					<div class="doc-ft">
						<span>GAF-FR-11 · Versión 1</span><span
							>Generado el {new Date().toLocaleDateString('es-CO', {
								day: '2-digit',
								month: 'long',
								year: 'numeric'
							})}</span
						><span>{hdr.empresa}</span>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}

<!-- ═══ PRINT SHEET SELECTOR MODAL ═══ -->
<!-- ═══ PRINT SHEET SELECTOR MODAL ═══ -->
{#if printModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="print-modal-overlay" on:click|self={() => (printModalOpen = false)}>
		<div class="print-modal">
			<div class="print-modal-hd">
				<span class="print-modal-icon">🖨</span>
				<div>
					<div class="print-modal-title">Imprimir Liquidación</div>
					<div class="print-modal-sub">Seleccione las hojas que desea imprimir</div>
				</div>
			</div>
			<div class="print-modal-body">
				<label class="print-check print-check-all">
					<input
						type="checkbox"
						checked={printSheetCount === (canSeeTerceros ? 4 : 3)}
						on:change={(e) => toggleAllSheets(e.currentTarget.checked)}
					/>
					<span class="print-check-mark"></span>
					<span class="print-check-lbl">Seleccionar todas</span>
				</label>
				<div class="print-divider"></div>
				<label class="print-check">
					<input type="checkbox" bind:checked={printSheets.liquidacion} />
					<span class="print-check-mark"></span>
					<span class="print-check-lbl"
						>📄 Hoja 1 — Liquidación de Servicios <span class="print-check-tag print-tag-landscape">A4 horizontal</span
						></span
					>
				</label>
				<label class="print-check">
					<input type="checkbox" bind:checked={printSheets.recargos} />
					<span class="print-check-mark"></span>
					<span class="print-check-lbl"
						>📊 Hoja 2 — Recargos (Horas) <span class="print-check-tag print-tag-landscape">A4 horizontal</span></span
					>
				</label>
				<label class="print-check">
					<input type="checkbox" bind:checked={printSheets.liquidador} />
					<span class="print-check-mark"></span>
					<span class="print-check-lbl"
						>📋 Hoja 3 — Liquidador de Recargos <span class="print-check-tag print-tag-landscape">A4 horizontal</span
						></span
					>
				</label>
				{#if canSeeTerceros}
					<label class="print-check">
						<input type="checkbox" bind:checked={printSheets.terceros} />
						<span class="print-check-mark"></span>
						<span class="print-check-lbl"
							>📑 Hoja 4 — Terceros <span class="print-check-tag print-tag-landscape">A4 horizontal</span></span
						>
					</label>
				{/if}
			</div>
			<div class="print-modal-ft">
				<button class="print-modal-btn print-modal-cancel" on:click={() => (printModalOpen = false)}
					>Cancelar</button
				>
				<button
					class="print-modal-btn print-modal-go"
					disabled={printSheetCount === 0}
					on:click={executePrint}
				>
					🖨 Imprimir {printSheetCount}
					{printSheetCount === 1 ? 'hoja' : 'hojas'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══ HISTORIAL / TRAZABILIDAD MODAL ═══ -->
{#if historialModalOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="historial-overlay" on:click|self={() => (historialModalOpen = false)}>
		<div class="historial-modal" role="dialog" aria-modal="true" aria-labelledby="historial-title">
			<header class="historial-hd">
				<div class="historial-hd-icon" aria-hidden="true">
					<svg
						width="22"
						height="22"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
						><circle cx="12" cy="12" r="10" /><polyline
							points="12 6 12 12 16 14"
						/></svg
					>
				</div>
				<div class="historial-hd-text">
					<span class="historial-eyebrow">OP-FR-07 · TRAZABILIDAD</span>
					<h2 id="historial-title" class="historial-title">Trazabilidad de Estados</h2>
					<p class="historial-sub">Historial cronológico de cambios de esta liquidación</p>
				</div>
				<button class="historial-close" on:click={() => (historialModalOpen = false)} aria-label="Cerrar modal">
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg
					>
				</button>
			</header>

			<div class="historial-body">
				{#if historialLoading}
					<div class="historial-loading">
						<div class="historial-spinner"></div>
						<span>Cargando historial…</span>
					</div>
				{:else if historialData.length === 0}
					<div class="historial-empty">
						<div class="historial-empty-icon" aria-hidden="true">
							<svg
								width="36"
								height="36"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path
									d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
								/></svg
							>
						</div>
						<p>No hay registros de cambios de estado</p>
						<span class="historial-empty-sub">Cuando se produzcan transiciones se mostrarán aquí</span>
					</div>
				{:else}
					<div class="historial-timeline">
						{#each historialData as h, i}
							{@const badge = getEstadoBadge(h.estado_nuevo)}
							<div class="historial-entry" class:historial-entry-first={i === 0}>
								<div class="historial-dot historial-dot-{h.estado_nuevo.toLowerCase()}" aria-hidden="true">
									<svg
										width="10"
										height="10"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="3"
										stroke-linecap="round"
										stroke-linejoin="round"
										><path d="M20 6L9 17l-5-5" /></svg
									>
								</div>
								<div class="historial-card">
									<div class="historial-card-top">
										<div class="historial-transition">
											{#if h.estado_anterior}
												{@const prev = getEstadoBadge(h.estado_anterior)}
												<span class="estado-badge estado-badge-{h.estado_anterior.toLowerCase()} historial-tag"
													>{prev.label}</span
												>
												<svg
													class="historial-arrow"
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2.4"
													stroke-linecap="round"
													stroke-linejoin="round"
													aria-hidden="true"
													><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></svg
												>
											{/if}
											<span class="estado-badge estado-badge-{h.estado_nuevo.toLowerCase()} historial-tag"
												>{badge.label}</span
											>
										</div>
										<span class="historial-fecha">{fmtFecha(h.created_at)}</span>
									</div>
									{#if h.usuario}
										<div class="historial-user">
											<span class="historial-user-icon" aria-hidden="true">
												<svg
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle
														cx="12"
														cy="7"
														r="4"
													/></svg
												>
											</span>
											<span>{h.usuario.nombre || h.usuario.correo}</span>
										</div>
									{/if}
									{#if h.motivo}
										<div class="historial-motivo">
											<span class="historial-user-icon" aria-hidden="true">
												<svg
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
													><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg
												>
											</span>
											<span>{h.motivo}</span>
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<footer class="historial-ft">
				<button
					class="liq-btn-secondary historial-ft-btn"
					on:click={() => (historialModalOpen = false)}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M15 18l-6-6 6-6" /></svg
					>
					<span>Cerrar</span>
				</button>
			</footer>
		</div>
	</div>
{/if}

<!-- ═══ SUCCESS ANIMATION OVERLAY ═══ -->
{#if showSuccessAnim}
	<div class="success-overlay">
		<div class="success-content">
			<div class="success-circle">
				<svg class="success-check" viewBox="0 0 52 52">
					<circle
						class="success-circle-bg"
						cx="26"
						cy="26"
						r="24"
						fill="none"
						stroke="#fff"
						stroke-width="2"
					/>
					<path
						class="success-check-path"
						fill="none"
						stroke="#fff"
						stroke-width="3.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M14 27l7.8 7.8L38 18"
					/>
				</svg>
			</div>
			<h2 class="success-title">{successMsg}</h2>
			<p class="success-subtitle">{successSub}</p>
			<div class="success-confetti-wrap">
				{#each Array(24) as _, i}
					<div
						class="success-confetti"
						style="--i:{i};--x:{Math.random() * 300 - 150}px;--r:{Math.random() * 540 -
							270}deg;--d:{i * 0.07}s;--c:{[
							'#fb923c',
							'#fdba74',
							'#fed7aa',
							'#fbbf24',
							'#f59e0b',
							'#fff'
						][i % 6]}"
					></div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- ═══════════════════════════════════════════════════════════
     DROPDOWN DE PLACA A NIVEL DE BODY (position: fixed)
     Se renderiza fuera del scroll container `.tbl-s` para no ser
     clipeado por su `overflow-x: auto`. Mismo patrón que
     `SelectBuscable` (servicios) pero en fixed para escapar del clip.
     ═══════════════════════════════════════════════════════════ -->
<svelte:window
	on:scroll={() => activePlacaRowId && updatePlacaDropdownPos(activePlacaRowId)}
	on:resize={() => activePlacaRowId && updatePlacaDropdownPos(activePlacaRowId)}
/>
{#if activePlacaRow}
	<div
		class="ss-dropdown ss-dropdown-fixed"
		style="top: {placaDropdownPos.top}px; left: {placaDropdownPos.left}px; min-width: {placaDropdownPos.width}px;"
	>
		{#each placasFiltradas(activePlacaRow.placa_search) as v, vi}
			<div
				class="ss-option"
				class:highlighted={vi === activePlacaRow.placa_highlight}
				on:mousedown|preventDefault={() => selectPlacaAndClose(activePlacaRow.id, v)}
				on:keydown={(e) => e.key === 'Enter' && selectPlacaAndClose(activePlacaRow.id, v)}
				on:mouseenter={() => {
					activePlacaRow.placa_highlight = vi;
				}}
				role="option"
				aria-selected={vi === activePlacaRow.placa_highlight}
				tabindex="-1"
			>
				<span class="ss-opt-placa">{v.placa}</span>
				<span class="ss-opt-info">{v.tipo || ''} {v.marca || ''}</span>
			</div>
		{:else}
			<div class="ss-empty">Sin resultados</div>
		{/each}
	</div>
{/if}

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- ESTILOS                                                      -->
<!-- ═══════════════════════════════════════════════════════════ -->
<style>
	/* ─ CONSECUTIVO VALIDATION ─ */
	.consec-ok {
		border-color: #ea580c !important;
		box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.25) !important;
	}
	.consec-taken {
		border-color: #ef4444 !important;
		box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.25) !important;
	}
	.consec-badge {
		font-size: 11px;
		font-weight: 600;
	}
	.consec-checking {
		color: #94a3b8;
	}
	.consec-ok-badge {
		color: #ea580c;
	}
	.consec-taken-badge {
		color: #dc2626;
	}

	label {
		display: block;
		font-size: 10.5px;
		font-weight: 700;
		color: #6b7e8c;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 5px;
	}
	input,
	select {
		width: 100%;
		border: 1.5px solid #dde3eb;
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13px;
		color: #1a2530;
		background: #fafbfc;
		outline: none;
		transition: all 0.15s;
	}
	input:focus,
	select:focus {
		border-color: #c2410c;
		background: #fff;
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
	}

	/* ─ SEARCHABLE SELECT ─ */
	.ss-wrap {
		position: relative;
	}
	.ss-selected {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(249, 115, 22, 0.06);
		border: 1.5px solid rgba(249, 115, 22, 0.20);
		border-radius: 8px;
		padding: 7px 11px;
		font-size: 13px;
		font-weight: 600;
		color: #ea580c;
	}
	.ss-selected .ss-nit {
		font-size: 11px;
		color: #64748b;
		font-weight: 400;
	}
	.ss-clear {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 14px;
		margin-left: auto;
		color: #94a3b8;
		padding: 2px 4px;
		width: auto;
	}
	.ss-clear:hover {
		color: #dc2626;
	}
	.ss-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: #fff;
		border: 1.5px solid rgba(15, 23, 42, 0.08);
		border-radius: 10px;
		box-shadow: 0 8px 30px rgba(15, 23, 42, 0.15);
		z-index: 50;
		max-height: 220px;
		overflow-y: auto;
		margin-top: 4px;
	}
	/* Variante renderizada a nivel de body para escapar el clip de
	   `.tbl-s` (overflow-x: auto fuerza overflow-y: auto y clipea el
	   dropdown). Mismo patrón que SelectBuscable en servicios. */
	.ss-dropdown-fixed {
		position: fixed;
		z-index: 9999;
		margin-top: 0;
	}
	.ss-option {
		padding: 8px 12px;
		cursor: pointer;
		font-size: 12.5px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		transition: background 0.1s;
	}
	.ss-option:hover,
	.ss-option.highlighted {
		background: rgba(249, 115, 22, 0.06);
	}
	.ss-option .ss-opt-name {
		font-weight: 600;
		color: #0f172a;
	}
	.ss-option .ss-opt-nit {
		font-size: 11px;
		color: #94a3b8;
	}
	.ss-option .ss-opt-placa {
		font-family: 'Geist', sans-serif;
		font-weight: 800;
		color: #ea580c;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	.ss-option .ss-opt-info {
		font-size: 10.5px;
		color: #94a3b8;
	}
	.ss-empty {
		padding: 12px;
		text-align: center;
		font-size: 12px;
		color: #94a3b8;
	}

	/* ═══════════════════════════════════════════════════════════════
	   LOADING / ERROR STATE — alineado con landing-cotransmeq-design-system
	   (off-white + naranja brand + verde bosque + Geist único)
	   ═══════════════════════════════════════════════════════════════ */
	.liq-loading-page {
		width: 100%;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}

	/* HEADER (sticky blanco editorial) */
	.liq-loading-header {
		background: white;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 20px;
		padding: 1.25rem 1.5rem;
		margin-bottom: 1.5rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
		position: sticky;
		top: 12px;
		z-index: 10;
	}
	.liq-loading-header-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.25rem;
	}
	.liq-loading-brand {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		min-width: 0;
		flex: 1;
	}
	.liq-loading-logo {
		height: 44px;
		width: 44px;
		object-fit: contain;
		background: #f6f6f3;
		border-radius: 12px;
		padding: 5px;
		border: 1px solid rgba(15, 23, 42, 0.06);
		flex-shrink: 0;
	}
	.liq-loading-headings {
		min-width: 0;
		flex: 1;
	}
	.liq-loading-eyebrow {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.25rem 0.6rem;
		border-radius: 9999px;
		font-family: 'Geist', sans-serif;
		margin-bottom: 0.5rem;
	}
	.liq-loading-eyebrow-danger {
		color: #dc2626;
		background: rgba(220, 38, 38, 0.08);
	}
	.liq-loading-title {
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: clamp(1.45rem, 3.6vw, 1.95rem);
		line-height: 1.2;
		color: #0f172a;
		margin: 0.15rem 0 0.3rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		letter-spacing: -0.01em;
	}
	.liq-loading-sub {
		font-size: 0.85rem;
		color: #64748b;
		margin: 0;
		line-height: 1.5;
	}

	/* Dots animados (loading) — pulse naranja brand */
	.liq-loading-dots {
		display: inline-flex;
		gap: 0.2rem;
		margin-left: 0.25rem;
	}
	.liq-loading-dots > span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #f97316;
		opacity: 0.35;
		animation: liq-loading-pulse 1.2s infinite;
	}
	.liq-loading-dots > span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.liq-loading-dots > span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes liq-loading-pulse {
		0%,
		60%,
		100% {
			opacity: 0.35;
			transform: translateY(0);
		}
		30% {
			opacity: 1;
			transform: translateY(-3px);
		}
	}

	/* Botón volver (back-link editorial) */
	.liq-loading-back {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: none;
		border: none;
		color: #64748b;
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		padding: 0.4rem 0.1rem;
		font-family: inherit;
		transition: color 0.2s;
		flex-shrink: 0;
	}
	.liq-loading-back:hover {
		color: #f97316;
	}

	/* BODY (cards contenedor) */
	.liq-loading-body {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Cards (editorial, radius 20px, sombra suave) */
	.liq-loading-card {
		background: white;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 20px;
		padding: 1.5rem 1.5rem 1.75rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}
	.liq-loading-card-hd {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.liq-loading-card-eyebrow {
		display: inline-block;
		width: fit-content;
		max-width: 100%;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.18rem 0.5rem;
		border-radius: 9999px;
		font-family: 'Geist', sans-serif;
		align-self: flex-start;
		flex-shrink: 0;
		white-space: nowrap;
		margin-bottom: 0.4rem;
	}
	.liq-loading-card-title {
		font-family: 'Geist', sans-serif;
		font-weight: 600;
		font-size: 1.25rem;
		line-height: 1.3;
		color: #0f172a;
		margin: 0;
	}
	.liq-loading-card-sub {
		font-size: 0.78rem;
		color: #64748b;
		margin: 0.2rem 0 0;
		line-height: 1.5;
	}

	/* Fields grid */
	.liq-loading-fields {
		display: grid;
		gap: 0.85rem;
	}
	.liq-loading-fields-2 {
		grid-template-columns: 1fr 1fr;
	}
	.liq-loading-fields-3 {
		grid-template-columns: 1fr 1fr 1fr;
	}
	.liq-loading-fields-4 {
		grid-template-columns: repeat(4, 1fr);
	}
	.liq-loading-field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.liq-loading-field-span2 {
		grid-column: span 2;
	}

	/* Tabla de items (stack) */
	.liq-loading-table {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	/* ═══ ERROR CARD (editorial alert, mismo lenguaje) ═══ */
	.liq-error-card {
		background: white;
		border: 1px solid rgba(220, 38, 38, 0.2);
		border-radius: 20px;
		padding: 1.75rem 1.75rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.liq-error-icon {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: rgba(220, 38, 38, 0.08);
		color: #dc2626;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.liq-error-body {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.liq-error-title {
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: 1.4rem;
		line-height: 1.25;
		color: #0f172a;
		margin: 0;
	}
	.liq-error-msg {
		font-size: 0.88rem;
		font-weight: 600;
		color: #991b1b;
		background: rgba(220, 38, 38, 0.06);
		border: 1px solid rgba(220, 38, 38, 0.18);
		border-radius: 12px;
		padding: 0.65rem 0.9rem;
		word-break: break-word;
		line-height: 1.5;
	}
	.liq-error-hint {
		font-size: 0.82rem;
		color: #64748b;
		margin: 0;
		line-height: 1.55;
		max-width: 540px;
	}
	.liq-error-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.liq-btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.7rem 1.25rem;
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
		border: none;
		border-radius: 12px;
		font-family: 'Geist', sans-serif;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
		transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.liq-btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
	}
	.liq-btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.7rem 1.25rem;
		background: white;
		color: #0f172a;
		border: 1px solid rgba(15, 23, 42, 0.12);
		border-radius: 12px;
		font-family: 'Geist', sans-serif;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.liq-btn-secondary:hover {
		background: #f6f6f3;
		border-color: rgba(15, 23, 42, 0.2);
	}

	/* Responsive — tablet ≤ 1279px */
	@media (max-width: 1279px) {
		.liq-loading-page {
			padding: 1.25rem 1rem 3rem;
		}
		.liq-loading-header {
			padding: 1rem 1.25rem;
		}
		.liq-loading-fields-4 {
			grid-template-columns: 1fr 1fr;
		}
		.liq-loading-fields-3 {
			grid-template-columns: 1fr 1fr;
		}
		.liq-loading-card {
			padding: 1.25rem 1.25rem 1.5rem;
		}
	}

	/* Responsive — mobile ≤ 480px */
	@media (max-width: 480px) {
		.liq-loading-page {
			padding: 0.75rem 0.5rem 2rem;
		}
		.liq-loading-header {
			padding: 0.85rem 1rem;
			border-radius: 16px;
		}
		.liq-loading-header-inner {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.75rem;
		}
		.liq-loading-logo {
			height: 36px;
			width: 36px;
		}
		.liq-loading-title {
			font-size: 1.3rem;
		}
		.liq-loading-fields-2,
		.liq-loading-fields-3,
		.liq-loading-fields-4 {
			grid-template-columns: 1fr;
		}
		.liq-loading-field-span2 {
			grid-column: span 1;
		}
		.liq-loading-card {
			padding: 1.1rem 1rem 1.3rem;
			border-radius: 16px;
		}
		.liq-error-card {
			padding: 1.25rem 1.1rem;
		}
		.liq-error-actions {
			flex-direction: column;
			width: 100%;
		}
		.liq-btn-primary,
		.liq-btn-secondary {
			width: 100%;
			justify-content: center;
		}
	}

	/* ─ PDF VIEW LOADING ─ */
	.pdf-loading-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 18px;
		background: #b0b8c2;
	}
	.pdf-loading-spinner {
		width: 40px;
		height: 40px;
		border: 4px solid rgba(255, 255, 255, 0.25);
		border-top-color: #fff;
		border-radius: 50%;
		animation: pdfSpin 0.8s linear infinite;
	}
	.pdf-loading-text {
		font-size: 14px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.85);
		letter-spacing: 0.02em;
	}
	@keyframes pdfSpin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ─ ERROR FALLBACK ─ */

	@keyframes errorBounce {
		0% {
			transform: scale(0.5);
			opacity: 0;
		}
		50% {
			transform: scale(1.1);
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	/* ─ DRAFT INDICATOR ─ */

	@keyframes draftFadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ─ PDF OVERLAY ─ */
	.pdf-wrap {
		position: fixed;
		inset: 0;
		background: #b8c0cc;
		background-image:
			radial-gradient(circle at 0% 0%, rgba(249, 115, 22, 0.06) 0%, transparent 50%),
			radial-gradient(circle at 100% 100%, rgba(249, 115, 22, 0.05) 0%, transparent 55%);
		z-index: 200;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-family: 'Geist', 'Inter', system-ui, -apple-system, sans-serif;
	}

	/* ═══════════════════════════════════════════════════════════════
	   PDF / PREVIEW TOOLBAR — alineado con landing-cotransmeq-design-system
	   (off-white + naranja brand + verde bosque + Geist único)
	   Reemplaza el antiguo dark theme y restos de transmeralda.
	   ═══════════════════════════════════════════════════════════════ */
	.pdf-bar {
		flex-shrink: 0;
		background: rgba(255, 255, 255, 0.82);
		backdrop-filter: blur(20px) saturate(180%);
		-webkit-backdrop-filter: blur(20px) saturate(180%);
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.04);
		padding: 0.85rem 1.5rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
	}
	.pdf-bar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		width: 100%;
		min-width: 0;
	}
	.pdf-bar-brand {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		min-width: 0;
		flex: 1 1 auto;
	}
	.pdf-bar-logo {
		height: 44px;
		width: 44px;
		object-fit: contain;
		background: #f6f6f3;
		border: 1px solid rgba(15, 23, 42, 0.06);
		border-radius: 12px;
		padding: 5px;
		flex-shrink: 0;
	}
	.pdf-bar-headings {
		min-width: 0;
		flex: 1 1 auto;
	}
	.pdf-bar-eyebrow {
		display: inline-block;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #ea580c;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.22rem 0.6rem;
		border-radius: 9999px;
		font-family: 'Geist', sans-serif;
		margin-bottom: 0.3rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.pdf-bar-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: clamp(1.05rem, 1.8vw, 1.35rem);
		line-height: 1.2;
		color: #0f172a;
		margin: 0.05rem 0 0.1rem;
		letter-spacing: -0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pdf-bar-sub {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.78rem;
		color: #64748b;
		margin: 0;
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Tools cluster (tabs + zoom + buttons) */
	.pdf-bar-tools {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-shrink: 0;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	/* Page tabs (Hoja 1-4) */
	.page-tabs {
		display: flex;
		gap: 0.2rem;
		background: #f6f6f3;
		border: 1px solid rgba(15, 23, 42, 0.06);
		border-radius: 10px;
		padding: 0.2rem;
	}
	.ptab {
		border: none;
		background: transparent;
		color: #64748b;
		padding: 0.45rem 0.85rem;
		font-size: 0.78rem;
		font-weight: 600;
		font-family: inherit;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.ptab:hover {
		color: #0f172a;
		background: rgba(249, 115, 22, 0.06);
	}
	.ptab.active {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: white;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.30);
	}
	.ptab.active .ptab-num {
		background: rgba(255, 255, 255, 0.25);
		color: white;
	}
	.ptab-num {
		display: none;
		font-family: 'Geist', sans-serif;
		font-size: 0.65rem;
		font-weight: 700;
		background: rgba(15, 23, 42, 0.06);
		color: #64748b;
		min-width: 18px;
		height: 18px;
		padding: 0 0.3rem;
		border-radius: 4px;
		align-items: center;
		justify-content: center;
	}
	/* Tab labels: full by default, short on mobile */
	.ptab-short {
		display: none;
	}
	.ptab-full {
		display: inline;
	}

	/* Zoom controls */
	.zoom-controls {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		background: white;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 10px;
		padding: 0.2rem;
	}
	.zoom-btn {
		border: none;
		background: transparent;
		color: #0f172a;
		width: 28px;
		height: 28px;
		border-radius: 7px;
		cursor: pointer;
		font-size: 15px;
		font-weight: 700;
		font-family: inherit;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}
	.zoom-btn:hover {
		background: rgba(249, 115, 22, 0.08);
		color: #ea580c;
	}
	.zoom-label {
		font-family: 'Geist', sans-serif;
		font-size: 0.72rem;
		font-weight: 700;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
		min-width: 42px;
		text-align: center;
		letter-spacing: 0.02em;
	}
	.zoom-reset,
	.zoom-fit {
		font-size: 13px;
	}

	/* Print button (gradient naranja brand) */
	.pdf-bar-print {
		padding: 0.6rem 1rem;
	}
	.pbtn-icon,
	.pbtn-label-short {
		display: none;
	}
	.pbtn-label-full {
		display: inline;
	}

	/* Legacy classes (kept for backwards compat with old markup if any) */
	.pbtn {
		border: none;
		border-radius: 10px;
		padding: 9px 18px;
		font-weight: 600;
		font-size: 12.5px;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
	}
	.pbtn-back {
		background: #ffffff;
		color: #0f172a;
		border: 1px solid rgba(15, 23, 42, 0.12);
	}
	.pbtn-back:hover {
		background: #f6f6f3;
		border-color: rgba(15, 23, 42, 0.20);
		transform: translateY(-1px);
	}
	.pbtn-print {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: #fff;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.30);
	}
	.pbtn-print:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.40);
	}
	.zoom-fit {
		font-size: 14px;
		background: rgba(249, 115, 22, 0.08) !important;
		border: 1px solid rgba(249, 115, 22, 0.20) !important;
		color: #ea580c !important;
	}
	.zoom-fit:hover {
		background: rgba(249, 115, 22, 0.16) !important;
	}

	.pdf-body {
		flex: 1;
		overflow: auto;
		padding: 28px 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
		-webkit-overflow-scrolling: touch;
		scroll-behavior: smooth;
		/* Allow native pinch-to-zoom on touch devices */
		touch-action: pan-x pan-y pinch-zoom;
		overscroll-behavior: contain;
	}

	/* ─ A4 PAGE (idéntico a transmeralda) ─ */
	.page {
		background: #fff;
		width: 297mm;
		max-width: 100%;
		padding: 8mm 11mm 13mm;
		font-size: 8.8pt;
		line-height: 1.35;
		font-family: Arial, Helvetica, sans-serif;
		box-shadow: 0 8px 50px rgba(0, 0, 0, 0.3);
		border-radius: 2px;
	}
	/* ─ A4 LANDSCAPE (idéntico a transmeralda) ─ */
	.page-landscape {
		background: #fff;
		width: 1400px;
		max-width: none;
		padding: 10mm 12mm 12mm;
		font-size: 8pt;
		line-height: 1.3;
		font-family: Arial, Helvetica, sans-serif;
		box-shadow: 0 8px 50px rgba(0, 0, 0, 0.3);
		border-radius: 2px;
	}
	/* legacy alias portrait (alias, igual a .page en transmeralda) */
	.page-portrait {
		background: #fff;
		width: 297mm;
		max-width: 100%;
		padding: 8mm 11mm 13mm;
		font-size: 8.8pt;
		line-height: 1.35;
		font-family: Arial, Helvetica, sans-serif;
		box-shadow: 0 8px 50px rgba(0, 0, 0, 0.3);
		border-radius: 2px;
	}

	.dh {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		background: #f6f6f3;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 4px;
		margin-bottom: 4px;
		padding: 4px;
	}
	.dh-logo {
		border-right: 1px solid rgba(15, 23, 42, 0.08);
		padding: 6px 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 100px;
		background: #fff;
		border-radius: 3px;
	}
	.dh-logo img {
		height: 50px;
		width: auto;
		object-fit: contain;
	}
	.dh-logo-fallback {
		width: 80px;
		height: 50px;
		background: linear-gradient(135deg, #f97316, #ea580c);
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		font-size: 6.5pt;
		font-weight: 900;
		text-align: center;
		line-height: 1.2;
		box-shadow: 0 4px 12px rgba(249, 115, 22, 0.25);
	}
	.dh-title {
		padding: 6px 14px;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.dh-co {
		font-size: 10pt;
		font-weight: 900;
		color: #ea580c;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.dh-doc {
		font-size: 9pt;
		font-weight: 700;
		color: #475569;
		margin-top: 2px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.dh-meta {
		border-left: 1px solid rgba(15, 23, 42, 0.08);
		background: #fff;
		border-radius: 3px;
		margin: 2px;
	}
	.dh-super {
		border-left: 1px solid rgba(15, 23, 42, 0.08);
		padding: 4px 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 70px;
		background: #fff;
		border-radius: 3px;
		margin: 2px;
	}
	.dh-super img {
		height: 42px;
		width: auto;
		object-fit: contain;
	}
	.mt {
		width: 100%;
		border-collapse: collapse;
		font-size: 7pt;
	}
	.mt td {
		padding: 2px 8px;
		font-size: 7pt;
		border-bottom: 1px solid rgba(15, 23, 42, 0.06);
	}
	.mt tr:last-child td {
		border-bottom: none;
	}
	.ml {
		font-weight: 700;
		color: #475569;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		font-size: 6.5pt;
		white-space: nowrap;
	}
	.mv {
		font-weight: 800;
		color: #ea580c;
		font-family: 'Geist', sans-serif;
		font-variant-numeric: tabular-nums;
	}

	.pb {
		background: #fff7ed;
		border: 1px solid #fed7aa;
		border-radius: 4px;
		margin-bottom: 4px;
		display: flex;
		flex-wrap: wrap;
		font-size: 7.8pt;
		padding: 3px 6px;
	}
	.pc {
		padding: 3px 9px;
		display: flex;
		align-items: center;
		gap: 5px;
		white-space: nowrap;
		border-right: 1px solid rgba(254, 215, 170, 0.6);
	}
	.pc:last-child {
		border-right: none;
		flex: 1;
	}
	.pclabel {
		color: #92400e;
		font-weight: 700;
		font-size: 6.8pt;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.pcval {
		color: #ea580c;
		font-weight: 900;
		font-size: 8.5pt;
		font-family: 'Geist', sans-serif;
		font-variant-numeric: tabular-nums;
	}
	.pc-consec .pcval {
		color: #ea580c;
		font-family: 'Geist', sans-serif;
		font-size: 10pt;
		font-weight: 900;
	}

	.st {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 4px;
		font-size: 7.4pt;
		background: #fff;
		border: 1px solid #fed7aa;
		border-radius: 4px;
		overflow: hidden;
	}
	.st thead {
		background: #fff7ed;
	}
	.st th {
		background: #fff7ed;
		color: #ea580c;
		font-weight: 800;
		text-align: center;
		padding: 5px 4px;
		border: 1px solid #fed7aa;
		font-size: 6.6pt;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		line-height: 1.25;
	}
	.st td {
		border: 1px solid rgba(254, 215, 170, 0.7);
		padding: 4px 5px;
		vertical-align: middle;
		background: #fff;
		height: 30px;
		box-sizing: border-box;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.st tbody tr {
		height: 30px;
	}
	.st tbody tr:hover td {
		background: #fffaf2;
	}
	.st tfoot td {
		border: 1px solid #fed7aa;
		background: #fff7ed;
		font-weight: 800;
		color: #ea580c;
	}
	.placa {
		font-family: 'Geist', sans-serif;
		font-weight: 900;
		font-size: 7.6pt;
		color: #ea580c;
		text-align: center;
		display: block;
		letter-spacing: 0.02em;
	}
	.mc {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-variant-numeric: tabular-nums;
		font-size: 7.4pt;
		color: #0f172a;
		font-weight: 600;
	}
	.mch {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-variant-numeric: tabular-nums;
		font-size: 7.6pt;
		font-weight: 900;
		color: #ea580c;
	}
	.tc {
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.filler td {
		height: 30px;
		background: #fffaf2;
	}

	.bg {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border: 1.5px solid #000;
	}
	.bl {
		border-right: 1px solid #999;
		padding: 8px 11px;
		font-size: 7.6pt;
	}
	.br {
		padding: 0;
	}
	.obs-t {
		font-weight: 900;
		font-size: 8pt;
		color: #ea580c;
		margin-bottom: 5px;
		text-transform: uppercase;
	}
	.obs-b {
		color: #333;
		font-size: 7.2pt;
		min-height: 30px;
		line-height: 1.5;
	}
	.op-row {
		display: flex;
		align-items: center;
		gap: 20px;
		margin-top: 8px;
	}
	.op-line {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 8pt;
	}
	.opl {
		font-weight: 700;
		color: #555;
	}
	.opv {
		font-weight: 900;
		color: #ea580c;
		font-size: 9.5pt;
	}

	.pernote-box {
		margin-top: 7px;
		border-radius: 3px;
		overflow: hidden;
	}
	.pernote-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 7.5pt;
	}
	.pernote-tbl th {
		background: #fff7ed;
		font-size: 6.8pt;
		font-weight: 800;
		color: #ea580c;
		text-align: center;
		padding: 3px 6px;
		border: 1px solid #fed7aa;
	}
	.pernote-tbl td {
		text-align: center;
		padding: 3px 6px;
		border: 1px solid #fed7aa;
	}

	.stbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 7.6pt;
	}
	.stbl td {
		padding: 3.5px 9px;
		border-bottom: 1px solid #e2e8e0;
	}
	.sla {
		font-weight: 600;
		color: #444;
	}
	.sva {
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.slb {
		font-weight: 800;
		color: #222;
		font-size: 8pt;
	}
	.svb {
		font-family: 'Geist', sans-serif;
		font-weight: 800;
		text-align: right;
		font-size: 8pt;
		font-variant-numeric: tabular-nums;
	}
	.slhi {
		font-weight: 900;
		color: #ea580c;
		background: #ffedd5;
		font-size: 9pt;
		padding-top: 5px;
		padding-bottom: 5px;
	}
	.svhi {
		font-family: 'Geist', sans-serif;
		font-weight: 900;
		color: #ea580c;
		background: #ffedd5;
		text-align: right;
		font-size: 9pt;
		padding-top: 5px;
		padding-bottom: 5px;
		font-variant-numeric: tabular-nums;
	}
	.sep-row td {
		border-top: 2px solid #888 !important;
		padding-top: 5px;
	}

	.sigs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border: 1.5px solid #000;
		margin-top: 6px;
	}
	.sig {
		padding: 10px 13px 9px;
		display: flex;
		flex-direction: column;
		min-height: 70px;
	}
	.sig:first-child {
		border-right: 1px solid #888;
	}
	.sig-lbl {
		font-weight: 800;
		color: #ea580c;
		font-size: 8pt;
	}
	/* .firma-img {
		display: block;
		max-height: 60px;
		max-width: 168px;
		object-fit: contain;
		margin: 0 auto 2px;
	} */
	.sig-line {
		border-top: 1px solid #000;
		padding-top: 3px;
		color: #555;
		font-size: 7pt;
		font-style: italic;
		margin-top: auto;
	}

	.doc-ft {
		margin-top: 6px;
		display: flex;
		justify-content: space-between;
		font-size: 6.5pt;
		color: #aaa;
		border-top: 1px solid #eee;
		padding-top: 4px;
	}

	/* ── RESUMEN FOOTER (al final de HOJA 1) — grid 2 cols para ahorrar espacio ── */
	.doc-summary {
		margin-top: 6px;
		padding: 3mm 5mm 3mm;
		background: #f6f6f3;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 4px;
		font-size: 6.5pt;
		line-height: 1.3;
	}
	.doc-summary-title {
		font-size: 7pt;
		font-weight: 800;
		color: #ea580c;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		text-align: center;
		padding-bottom: 3px;
		margin-bottom: 4px;
		border-bottom: 1px solid rgba(15, 23, 42, 0.1);
	}
	/* Grid 2 columnas: left (obs/pernocte) | right (totals) */
	.doc-summary-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-areas:
			'left right'
			'sigs sigs'
			'ft ft';
		gap: 8px;
	}
	.doc-summary-left {
		grid-area: left;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.doc-summary-right {
		grid-area: right;
		display: flex;
		flex-direction: column;
	}
	.doc-summary-row {
		display: flex;
		gap: 5px;
		font-size: 6.5pt;
		line-height: 1.3;
	}
	.doc-summary-lbl {
		font-weight: 700;
		color: #475569;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		min-width: 75px;
		flex-shrink: 0;
		font-size: 6pt;
	}
	.doc-summary-val {
		color: #0f172a;
		font-weight: 600;
		flex: 1;
		font-size: 6.5pt;
	}
	.doc-summary-pernote {
		margin-top: 4px;
	}
	.doc-summary-pernote-title {
		font-size: 6pt;
		font-weight: 800;
		color: #ea580c;
		background: #fff7ed;
		padding: 1.5px 5px;
		border: 1px solid #fed7aa;
		border-bottom: none;
		display: inline-block;
		letter-spacing: 0.04em;
	}
	.doc-summary-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 6.5pt;
		border: 1px solid #fed7aa;
	}
	.doc-summary-tbl th {
		background: #fff7ed;
		color: #ea580c;
		font-weight: 700;
		padding: 1.5px 4px;
		text-align: center;
		border: 1px solid #fed7aa;
		font-size: 6pt;
		text-transform: uppercase;
	}
	.doc-summary-tbl td {
		padding: 1.5px 4px;
		text-align: center;
		border: 1px solid #fed7aa;
		font-family: 'Geist', sans-serif;
		font-variant-numeric: tabular-nums;
	}
	.doc-summary-strong {
		font-weight: 800;
		color: #ea580c;
	}
	.doc-summary-totals {
		width: 100%;
		border-collapse: collapse;
		font-size: 6.5pt;
	}
	.doc-summary-totals td {
		padding: 1.5px 5px;
		border-bottom: 1px dotted rgba(15, 23, 42, 0.12);
	}
	.doc-summary-totals td:first-child {
		text-align: left;
		color: #475569;
		font-weight: 600;
	}
	.doc-summary-totals td:last-child {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: #0f172a;
	}
	.doc-summary-totals .doc-summary-sub td {
		font-weight: 800;
		color: #0f172a;
		padding-top: 2.5px;
		padding-bottom: 2.5px;
		border-top: 1px solid rgba(15, 23, 42, 0.15);
		border-bottom: 1px solid rgba(15, 23, 42, 0.15);
	}
	.doc-summary-totals .doc-summary-grand td {
		font-weight: 900;
		color: #ea580c;
		font-size: 7.5pt;
		padding-top: 3px;
	}
	/* Firmas: ocupan las 2 columnas (full width) */
	.doc-summary-sigs {
		grid-area: sigs;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
		margin-top: 2px;
		padding-top: 5px;
		border-top: 1px solid rgba(15, 23, 42, 0.1);
	}
	.doc-summary-sigs > div {
		display: flex;
		flex-direction: column;
		min-height: 44px;
	}
	.doc-summary-siglbl {
		font-size: 5.8pt;
		font-weight: 700;
		color: #475569;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 24px;
		line-height: 1.3;
	}
	.doc-summary-sigline {
		font-size: 6.5pt;
		font-weight: 700;
		color: #0f172a;
		border-top: 1px solid #0f172a;
		padding-top: 3px;
		min-height: 12px;
	}
	/* Footer del pie: ocupa las 2 columnas */
	.doc-summary-ft {
		grid-area: ft;
		display: flex;
		justify-content: space-between;
		font-size: 5.8pt;
		color: #64748b;
		margin-top: 2px;
		padding-top: 3px;
		border-top: 1px solid rgba(15, 23, 42, 0.08);
	}

	.pdf-body-landscape {
		align-items: center;
		overflow-x: auto;
	}
	.page-landscape {
		background: #fff;
		width: 1400px;
		max-width: none;
		padding: 10mm 12mm 12mm;
		font-size: 8pt;
		line-height: 1.3;
		font-family: Arial, Helvetica, sans-serif;
		box-shadow: 0 8px 50px rgba(0, 0, 0, 0.3);
		border-radius: 2px;
	}

	.rgt {
		width: 100%;
		border-collapse: collapse;
		font-size: 7.5pt;
		margin-top: 6px;
		table-layout: fixed;
	}
	.rgt th {
		background: #fff7ed;
		color: #ea580c;
		font-weight: 800;
		font-size: 7pt;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		padding: 5px 2px;
		border: 0.5px solid #fed7aa;
		text-align: center;
		overflow: hidden;
	}
	.rgt td {
		padding: 4px 2px;
		border: 0.5px solid #dde3eb;
		vertical-align: middle;
		font-size: 7pt;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rgt-emp {
		width: 110px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rgt-pla {
		width: 42px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rgt-cnd {
		width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rgt-d {
		width: 22px;
		min-width: 22px;
		font-size: 6.5pt;
		text-align: center;
	}
	.rgt-t {
		width: 36px;
		min-width: 36px;
		font-weight: 700;
	}
	.rgt-totals td {
		background: #ffedd5;
		color: #ea580c;
		border-top: 1.5px solid #ea580c;
		font-weight: 800;
	}

	.crt {
		width: 100%;
		border-collapse: collapse;
		font-size: 7pt;
	}
	.crt th {
		background: #fff7ed;
		color: #ea580c;
		font-weight: 800;
		font-size: 6.5pt;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 5px 4px;
		border: 0.5px solid #fed7aa;
		text-align: center;
	}
	.crt td {
		padding: 4px 4px;
		border: 0.5px solid #dde3eb;
		vertical-align: middle;
	}

	.liq-salary-bar {
		margin: 4px 0 4px;
		padding: 5px 14px;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		font-size: 8pt;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.liq-sal-group {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.liq-sal-lbl {
		font-weight: 800;
		color: #ea580c;
		text-transform: uppercase;
		font-size: 7.5pt;
	}
	.liq-sal-val {
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: 8.5pt;
	}
	.liq-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 8pt;
		margin-top: 6px;
	}
	.liq-tbl th {
		background: #fff7ed;
		color: #ea580c;
		font-weight: 800;
		font-size: 7.5pt;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 7px 6px;
		border: 1px solid #fed7aa;
		text-align: center;
	}
	.liq-tbl td {
		padding: 6px 6px;
		border: 1px solid #dde3eb;
		vertical-align: middle;
	}
	.liq-tbl tbody tr:hover td {
		background: #fff7ed;
	}
	.liq-sub-row td {
		background: #fff7ed !important;
		border-top: 1.5px solid #ea580c;
	}
	.liq-total-row td {
		background: #ea580c !important;
		color: #fff !important;
		border-top: 2px solid #9a3412;
	}

	.terc-prev-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 7.5pt;
		margin-top: 6px;
	}
	.terc-prev-tbl th {
		background: #ea580c;
		color: #fff;
		padding: 5px 4px;
		font-weight: 700;
		text-align: center;
		font-size: 7pt;
		border: 1px solid #9a3412;
		white-space: nowrap;
	}
	.terc-prev-tbl td {
		padding: 4px 4px;
		border: 1px solid #dde3eb;
		vertical-align: middle;
	}
	.terc-prev-tbl tbody tr:hover td {
		background: #fff7ed;
	}

	.terc-summary-box {
		margin-top: 14px;
		padding: 10px 14px;
		border: 2px solid #ea580c;
		border-radius: 6px;
		background: #f8fafc;
	}
	.terc-summary-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 8pt;
	}
	.terc-summary-tbl td {
		padding: 5px 8px;
	}
	.ts-lbl {
		font-weight: 700;
		text-align: left;
	}
	.ts-val {
		font-weight: 800;
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-size: 9pt;
		font-variant-numeric: tabular-nums;
	}
	.ts-sep td {
		border-top: 1.5px solid #e2e8f0;
	}
	.ts-total td {
		border-top: 2px solid #ea580c;
		background: #fff7ed;
		font-size: 9pt;
	}
	.ts-grand td {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: #fff;
		font-size: 10pt;
		border-radius: 0 0 4px 4px;
	}

	/* ─ LOADING ─ */
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ═══════════════════════════════════════════════════════════ */
	/* RESPONSIVE — TABLET (≤ 1279px · below XL)                    */
	/* XL ≥ 1280px = desktop (no responsive)                         */
	/* ═══════════════════════════════════════════════════════════ */
	@media (max-width: 1279px) {
		/* PDF body: tighter padding for tablet */
		.pdf-body {
			padding: 18px 12px;
			gap: 16px;
		}

		/* PDF bar: allow wrap */
		.pdf-bar {
			padding: 0.7rem 1rem;
		}
		.pdf-bar-inner {
			gap: 1rem;
		}
		.pdf-bar-logo {
			height: 38px;
			width: 38px;
		}
		.pdf-bar-title {
			font-size: 1.05rem;
		}
		.pdf-bar-sub {
			font-size: 0.72rem;
		}
		.pdf-bar-tools {
			gap: 0.5rem;
		}
		/* Page tabs: show short labels, scroll horizontally */
		.page-tabs {
			order: 3;
			width: 100%;
			overflow-x: auto;
			flex-wrap: nowrap;
			justify-content: flex-start;
			-webkit-overflow-scrolling: touch;
			scrollbar-width: thin;
		}
		.ptab {
			font-size: 0.72rem;
			padding: 0.4rem 0.7rem;
			white-space: nowrap;
			flex-shrink: 0;
		}
		/* Compact zoom & action buttons on tablet */
		.zoom-controls {
			margin-left: auto;
		}
		.zoom-btn {
			width: 30px;
			height: 30px;
		}
		.zoom-label {
			min-width: 38px;
			font-size: 0.7rem;
		}
		.pdf-bar-print {
			padding: 0.55rem 0.85rem;
			font-size: 0.82rem;
		}

		/* Estado bar: allow wrap */
		.estado-bar {
			padding: 0.7rem 0.9rem;
			gap: 1rem;
		}
		.estado-badge {
			padding: 0.28rem 0.6rem;
			font-size: 0.72rem;
		}
		.estado-info {
			font-size: 0.75rem;
		}
	}

	/* ═══════════════════════════════════════════════════════════ */
	/* RESPONSIVE — MOBILE (≤ 768px)                                */
	/* ═══════════════════════════════════════════════════════════ */
	@media (max-width: 768px) {
		/* Inputs */
		input,
		select {
			font-size: 14px;
			padding: 9px 10px;
		}
		label {
			font-size: 10px;
			margin-bottom: 4px;
		}

		/* PDF bar: stack everything */
		.pdf-bar {
			padding: 0.65rem 0.85rem;
		}
		.pdf-bar-inner {
			flex-direction: column;
			align-items: stretch;
			gap: 0.65rem;
		}
		.pdf-bar-logo {
			height: 32px;
			width: 32px;
		}
		.pdf-bar-eyebrow {
			font-size: 0.6rem;
		}
		.pdf-bar-title {
			font-size: 0.95rem;
		}
		.pdf-bar-sub {
			font-size: 0.7rem;
		}
		.pdf-bar-tools {
			width: 100%;
			justify-content: flex-start;
		}
		/* Tabs: numbered + short labels, scrollable */
		.page-tabs {
			width: 100%;
			overflow-x: auto;
			flex-wrap: nowrap;
			justify-content: flex-start;
			-webkit-overflow-scrolling: touch;
		}
		.ptab {
			font-size: 0.7rem;
			padding: 0.4rem 0.65rem;
			white-space: nowrap;
			flex-shrink: 0;
			display: inline-flex;
			align-items: center;
			gap: 0.3rem;
		}
		.ptab-full {
			display: none;
		}
		.ptab-short {
			display: inline;
		}
		.ptab-num {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 16px;
			height: 16px;
			padding: 0 0.25rem;
			border-radius: 50%;
			font-size: 0.6rem;
			font-weight: 800;
		}
		.zoom-controls {
			margin-left: auto;
		}
		.zoom-btn {
			width: 30px;
			height: 30px;
		}
		.pdf-bar-print {
			padding: 0.5rem 0.75rem;
			font-size: 0.78rem;
		}
		/* Show short label on mobile */
		.pbtn-label-full {
			display: none;
		}
		.pbtn-label-short {
			display: inline;
		}

		/* Estado bar: stack + compact mobile */
		.estado-bar {
			padding: 0.65rem 0.75rem;
			gap: 0.6rem;
			border-radius: 12px;
		}
		.estado-bar-status {
			width: 100%;
			flex-direction: row;
			align-items: center;
			gap: 0.6rem;
		}
		.estado-eyebrow {
			font-size: 0.55rem;
		}
		.estado-badge {
			padding: 0.25rem 0.55rem;
			font-size: 0.68rem;
		}
		/* Info stack: tighter, hide long text, show short dates */
		.estado-info-stack {
			gap: 0.35rem 0.6rem;
			width: 100%;
			min-width: 0;
		}
		.estado-info {
			font-size: 0.7rem;
			gap: 0.35rem;
		}
		.estado-info-full {
			display: none;
		}
		.estado-info-short {
			display: inline;
		}
		.estado-info-icon {
			width: 20px;
			height: 20px;
		}
		.estado-info-icon svg {
			width: 11px;
			height: 11px;
		}
		/* Action buttons: full-width on mobile */
		.estado-bar-actions {
			width: 100%;
		}
		.estado-btn {
			flex: 1;
			justify-content: center;
		}

		/* PDF body: floating document viewer — keep A4 size, allow free pan/zoom */
		.pdf-body {
			padding: 14px 8px;
			gap: 14px;
			overflow: auto;
			-webkit-overflow-scrolling: touch;
			justify-content: flex-start;
			touch-action: pan-x pan-y pinch-zoom;
		}
		.pdf-body-landscape {
			overflow: auto;
			justify-content: flex-start;
		}
		/* Page keeps its full A4 size (no max-width clipping) */
		.page {
			max-width: none;
		}
		/* Custom scrollbar styling for document viewer feel */
		.pdf-body::-webkit-scrollbar {
			width: 10px;
			height: 10px;
		}
		.pdf-body::-webkit-scrollbar-track {
			background: rgba(0, 0, 0, 0.1);
		}
		.pdf-body::-webkit-scrollbar-thumb {
			background: rgba(0, 0, 0, 0.35);
			border-radius: 5px;
		}
		.pdf-body::-webkit-scrollbar-thumb:hover {
			background: rgba(0, 0, 0, 0.55);
		}

		/* Modals: full width with margin */
		.print-modal {
			width: 94vw;
			border-radius: 16px;
		}
		.print-modal-hd {
			padding: 18px 18px 12px;
		}
		.print-modal-body {
			padding: 16px 18px;
		}
		.print-modal-ft {
			padding: 12px 18px 16px;
			flex-wrap: wrap;
		}
		.print-modal-btn {
			flex: 1;
			padding: 11px 16px;
		}
		.print-check-lbl {
			font-size: 12.5px;
		}

		.historial-modal {
			width: 94vw;
			max-height: 86vh;
			border-radius: 16px;
		}
		.historial-hd {
			padding: 16px 18px 12px;
		}
		.historial-body {
			padding: 16px 18px;
		}
		.historial-ft {
			padding: 12px 18px 14px;
		}
		.historial-timeline {
			padding-left: 20px;
		}

		/* PDF page (A4 297mm): force smaller on mobile */
		.page {
			padding: 8mm 6mm 8mm;
		}
		.page-landscape {
			padding: 6mm 6mm 8mm;
		}

		/* Success overlay: smaller */
		.success-circle {
			width: 90px;
			height: 90px;
		}
		.success-check {
			width: 54px;
			height: 54px;
		}
		.success-title {
			font-size: 22px;
		}
		.success-subtitle {
			font-size: 13px;
		}
	}

	/* ═══════════════════════════════════════════════════════════ */
	/* RESPONSIVE — SMALL MOBILE (≤ 480px)                          */
	/* ═══════════════════════════════════════════════════════════ */
	@media (max-width: 480px) {
		.historial-card-top {
			flex-direction: column;
			align-items: flex-start;
		}
		.historial-fecha {
			font-size: 10.5px;
		}
	}

	@media print {
		/* ── A4 LANDSCAPE sin márgenes del navegador (clave para evitar páginas en blanco) ── */
		@page {
			size: A4 landscape;
			margin: 0;
		}

		/* Hide toolbar, modals, non-print UI */
		.pdf-bar {
			display: none !important;
		}
		.print-modal-overlay {
			display: none !important;
		}

		/* Make pdf-wrap static so it flows in document */
		.pdf-wrap {
			position: static !important;
			background: #fff !important;
			overflow: visible !important;
			display: block !important;
		}

		/* Each sheet body flows naturally */
		.pdf-body {
			padding: 0 !important;
			overflow: visible !important;
			background: #fff !important;
			display: block !important;
		}
		.pdf-body-landscape {
			overflow-x: visible !important;
		}

		/* Page break after each sheet except last */
		.print-sheet {
			page-break-after: always;
			break-after: page;
		}
		.print-sheet:last-child {
			page-break-after: avoid;
			break-after: avoid;
		}

		/* A4 landscape pages (default) — idéntico a transmeralda */
		.page {
			box-shadow: none;
			margin: 0;
			border-radius: 0;
			width: 100%;
			padding: 5mm 7mm;
			transform: none !important;
		}

		/* A4 landscape pages (recargos) — idéntico a transmeralda */
		.page-landscape {
			box-shadow: none;
			margin: 0;
			border-radius: 0;
			width: 100%;
			padding: 4mm 5mm;
			transform: none !important;
		}

		/* legacy alias portrait */
		.page-portrait {
			box-shadow: none;
			margin: 0;
			border-radius: 0;
			width: 100%;
			padding: 5mm 7mm;
			transform: none !important;
		}

		/* Compact recargos table to fit all 31 days in A4 landscape */
		.rgt {
			font-size: 5pt;
		}
		.rgt th {
			font-size: 4.5pt;
			padding: 2px 1px;
			letter-spacing: 0;
		}
		.rgt td {
			font-size: 4.5pt;
			padding: 1px 1px;
		}
		.rgt-emp {
			width: 60px;
			font-size: 4.5pt;
		}
		.rgt-pla {
			width: 20px;
			font-size: 4.5pt;
		}
		.rgt-cnd {
			width: 55px;
			font-size: 4pt;
		}
		.rgt-d {
			width: 10px;
			min-width: 0;
			font-size: 4.5pt;
		}
		.rgt-t {
			width: 20px;
			min-width: 0;
			font-size: 4.5pt;
		}

		.crt {
			font-size: 6pt;
		}
		.crt th {
			font-size: 5.5pt;
			padding: 3px 2px;
		}
		.crt td {
			font-size: 5.5pt;
			padding: 2px 2px;
		}
	}

	/* ─ PRINT MODAL ─ */
	.print-modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 9000;
		background: rgba(15, 23, 42, 0.55);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		animation: pmFadeIn 0.2s ease-out;
	}
	@keyframes pmFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.print-modal {
		background: #fff;
		border-radius: 20px;
		width: 440px;
		max-width: 94vw;
		box-shadow: 0 25px 80px rgba(0, 0, 0, 0.35);
		overflow: hidden;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		animation: pmSlide 0.25s cubic-bezier(0.22, 0.61, 0.36, 1);
	}
	@keyframes pmSlide {
		from {
			opacity: 0;
			transform: scale(0.9) translateY(20px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}
	.print-modal-hd {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 22px 24px 16px;
		background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
		color: #fff;
	}
	.print-modal-icon {
		font-size: 32px;
	}
	.print-modal-title {
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.print-modal-sub {
		font-size: 12px;
		color: rgba(255, 255, 255, 0.85);
		margin-top: 2px;
	}
	.print-modal-body {
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.print-divider {
		height: 1px;
		background: rgba(15, 23, 42, 0.08);
		margin: 4px 0;
	}
	.print-check {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		border: 1.5px solid rgba(15, 23, 42, 0.08);
		background: #fff;
	}
	.print-check:hover {
		border-color: rgba(249, 115, 22, 0.30);
		background: rgba(249, 115, 22, 0.04);
	}
	.print-check input[type='checkbox'] {
		display: none;
	}
	.print-check-mark {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		border: 2px solid rgba(15, 23, 42, 0.20);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		position: relative;
	}
	.print-check input:checked + .print-check-mark {
		background: linear-gradient(135deg, #f97316, #ea580c);
		border-color: #ea580c;
	}
	.print-check input:checked + .print-check-mark::after {
		content: '✓';
		color: #fff;
		font-size: 14px;
		font-weight: 800;
	}
	.print-check-lbl {
		font-size: 13.5px;
		font-weight: 600;
		color: #0f172a;
		line-height: 1.3;
	}
	.print-check-tag {
		font-size: 10px;
		font-weight: 700;
		color: #64748b;
		background: #f6f6f3;
		padding: 2px 7px;
		border-radius: 4px;
		margin-left: 4px;
	}
	.print-check-tag.print-tag-portrait {
		color: #ea580c;
		background: rgba(249, 115, 22, 0.08);
	}
	.print-check-tag.print-tag-landscape {
		color: #166534;
		background: rgba(22, 101, 52, 0.08);
	}
	.print-check-all {
		background: #f6f6f3;
		border-color: rgba(15, 23, 42, 0.12);
	}
	.print-check-all .print-check-lbl {
		font-weight: 800;
		color: #ea580c;
	}
	.print-modal-ft {
		padding: 16px 24px 20px;
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		border-top: 1px solid rgba(15, 23, 42, 0.08);
	}
	.print-modal-btn {
		border: none;
		border-radius: 10px;
		padding: 11px 22px;
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		font-family: inherit;
	}
	.print-modal-cancel {
		background: white;
		color: #0f172a;
		border: 1px solid rgba(15, 23, 42, 0.12);
	}
	.print-modal-cancel:hover {
		background: #f6f6f3;
		border-color: rgba(15, 23, 42, 0.20);
	}
	.print-modal-go {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: #fff;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.30);
	}
	.print-modal-go:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.40);
	}
	.print-modal-go:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	/* ─ SUCCESS ANIMATION ─ */
	.success-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, rgba(234, 88, 12, 0.95) 0%, rgba(249, 115, 22, 0.95) 100%);
		animation: successFadeIn 0.35s ease-out;
	}
	@keyframes successFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.success-content {
		text-align: center;
		animation: successPop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.1s both;
	}
	@keyframes successPop {
		from {
			opacity: 0;
			transform: scale(0.5);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
	.success-circle {
		width: 120px;
		height: 120px;
		margin: 0 auto 28px;
		background: rgba(255, 255, 255, 0.18);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: successCirclePop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.25s both;
		box-shadow: 0 0 60px rgba(255, 255, 255, 0.2);
	}
	@keyframes successCirclePop {
		from {
			opacity: 0;
			transform: scale(0);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
	.success-check {
		width: 72px;
		height: 72px;
	}
	.success-circle-bg {
		stroke-dasharray: 166;
		stroke-dashoffset: 166;
		animation: successStroke 0.6s ease 0.5s forwards;
	}
	.success-check-path {
		stroke-dasharray: 48;
		stroke-dashoffset: 48;
		animation: successStroke 0.4s ease 0.8s forwards;
	}
	@keyframes successStroke {
		to {
			stroke-dashoffset: 0;
		}
	}
	.success-title {
		font-size: 32px;
		font-weight: 800;
		color: #fff;
		margin: 0 0 8px;
		letter-spacing: -0.5px;
		animation: successSlideUp 0.4s ease 0.45s both;
	}
	.success-subtitle {
		font-size: 16px;
		color: rgba(255, 255, 255, 0.85);
		margin: 0;
		font-weight: 500;
		animation: successSlideUp 0.4s ease 0.6s both;
	}
	@keyframes successSlideUp {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.success-confetti-wrap {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}
	.success-confetti {
		position: absolute;
		top: 40%;
		left: 50%;
		width: 10px;
		height: 10px;
		background: var(--c);
		border-radius: 2px;
		animation: confettiBurst 1.6s ease-out var(--d) forwards;
		opacity: 0;
	}
	.success-confetti:nth-child(2n) {
		width: 8px;
		height: 14px;
		border-radius: 4px;
	}
	.success-confetti:nth-child(3n) {
		width: 14px;
		height: 6px;
		border-radius: 3px;
	}
	@keyframes confettiBurst {
		0% {
			opacity: 1;
			transform: translate(0, 0) rotate(0deg) scale(1);
		}
		100% {
			opacity: 0;
			transform: translate(var(--x), calc(50vh + 100px)) rotate(var(--r)) scale(0.4);
		}
	}

	/* ═══════════════════════════════════════════════════════════════
	   ESTADO BAR — trazabilidad editorial
	   (eyebrow + badge semántico + Heroicons + liq-btn-* del skill)
	   ═══════════════════════════════════════════════════════════════ */
	.estado-bar {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		flex-wrap: wrap;
		background: white;
		border: 1px solid rgba(15, 23, 42, 0.08);
		padding: 0.85rem 1.1rem;
		margin: 0 0 0.85rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
	}

	/* Bloque izquierdo: eyebrow + badge */
	.estado-eyebrow {
		display: inline-block;
		width: fit-content;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #ea580c;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.18rem 0.5rem;
		border-radius: 9999px;
		font-family: 'Geist', sans-serif;
		white-space: nowrap;
	}

	/* Badge con variantes semánticas */
	.estado-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.32rem 0.7rem;
		border-radius: 9999px;
		font-family: 'Geist', sans-serif;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		flex-shrink: 0;
		width: fit-content;
	}
	.estado-badge::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.9;
	}
	.estado-badge-borrador {
		background: rgba(100, 116, 139, 0.1);
		color: #475569;
		border: 1px solid rgba(100, 116, 139, 0.22);
	}
	.estado-badge-liquidada {
		background: rgba(249, 115, 22, 0.08);
		color: #ea580c;
		border: 1px solid rgba(249, 115, 22, 0.25);
	}
	.estado-badge-aprobada {
		background: rgba(249, 115, 22, 0.08);
		color: #ea580c;
		border: 1px solid rgba(249, 115, 22, 0.25);
	}
	.estado-badge-facturada {
		background: rgba(249, 115, 22, 0.10);
		color: #ea580c;
		border: 1px solid rgba(249, 115, 22, 0.30);
	}
	.estado-badge-anulada {
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
		border: 1px solid rgba(220, 38, 38, 0.25);
	}

	/* Centro: info stack (fechas + autores) */
	.estado-info-stack {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		align-items: center;
		flex: 1 1 auto;
		min-width: 0;
	}
	.estado-info {
		font-size: 0.8rem;
		color: #64748b;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		font-family: 'Geist', sans-serif;
	}
	.estado-info strong {
		color: #0f172a;
		font-weight: 600;
	}
	.estado-info-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 7px;
		background: rgba(249, 115, 22, 0.1);
		color: #ea580c;
		flex-shrink: 0;
	}
	.estado-info-icon svg {
		width: 13px;
		height: 13px;
	}
	.estado-info-short {
		display: none;
		font-family: 'Geist', sans-serif;
		font-size: 0.72rem;
		color: #0f172a;
		font-weight: 600;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}
	.estado-info-full {
		display: inline;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Derecha: acciones */
	.estado-bar-actions {
		flex-shrink: 0;
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.estado-btn {
		padding: 0.55rem 0.85rem !important;
		font-size: 0.8rem !important;
	}
	.estado-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none !important;
		box-shadow: none !important;
	}

	/* ═══════════════════════════════════════════════════════════════
	   HISTORIAL / TRAZABILIDAD MODAL — editorial
	   (eyebrow + h2 + Heroicons + estado-badge semántico)
	   ═══════════════════════════════════════════════════════════════ */
	.historial-overlay {
		position: fixed;
		inset: 0;
		z-index: 10000;
		background: rgba(15, 31, 26, 0.45);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		animation: histFadeIn 0.2s ease;
	}
	@keyframes histFadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.historial-modal {
		background: #fff;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 24px;
		width: 620px;
		max-width: 100%;
		max-height: 86vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 25px 60px rgba(15, 23, 42, 0.25), 0 4px 24px rgba(0, 0, 0, 0.08);
		animation: histPop 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		overflow: hidden;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
	}
	@keyframes histPop {
		from {
			opacity: 0;
			transform: scale(0.94) translateY(20px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	/* Header */
	.historial-hd {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.5rem 1.5rem 1.25rem;
		border-bottom: 1px solid rgba(15, 23, 42, 0.06);
	}
	.historial-hd-icon {
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.30);
	}
	.historial-hd-text {
		min-width: 0;
		flex: 1 1 auto;
	}
	.historial-eyebrow {
		display: inline-block;
		width: fit-content;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #ea580c;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.2rem 0.55rem;
		border-radius: 9999px;
		font-family: 'Geist', sans-serif;
		margin-bottom: 0.4rem;
	}
	.historial-title {
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: 1.4rem;
		line-height: 1.25;
		color: #0f172a;
		margin: 0;
		letter-spacing: -0.01em;
	}
	.historial-sub {
		font-size: 0.82rem;
		color: #64748b;
		margin: 0.2rem 0 0;
		line-height: 1.5;
	}
	.historial-close {
		margin-left: auto;
		background: #f6f6f3;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 10px;
		width: 36px;
		height: 36px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #64748b;
		transition: all 0.2s;
		flex-shrink: 0;
	}
	.historial-close:hover {
		background: rgba(220, 38, 38, 0.08);
		border-color: rgba(220, 38, 38, 0.20);
		color: #dc2626;
		transform: rotate(90deg);
	}

	/* Body */
	.historial-body {
		padding: 1.5rem 1.5rem;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}
	.historial-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 0;
		color: #64748b;
		font-size: 0.88rem;
		font-family: 'Geist', sans-serif;
	}
	.historial-spinner {
		width: 22px;
		height: 22px;
		border: 2.5px solid rgba(249, 115, 22, 0.15);
		border-top-color: #f97316;
		border-radius: 50%;
		animation: histSpin 0.7s linear infinite;
	}
	@keyframes histSpin {
		to {
			transform: rotate(360deg);
		}
	}
	.historial-empty {
		text-align: center;
		padding: 3rem 1rem;
		color: #94a3b8;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	.historial-empty-icon {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: rgba(249, 115, 22, 0.08);
		color: #ea580c;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 0.5rem;
	}
	.historial-empty p {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: #64748b;
		font-family: 'Geist', sans-serif;
	}
	.historial-empty-sub {
		font-size: 0.78rem;
		color: #94a3b8;
		max-width: 280px;
		line-height: 1.5;
	}

	/* Timeline */
	.historial-timeline {
		position: relative;
		padding-left: 1.65rem;
	}
	.historial-timeline::before {
		content: '';
		position: absolute;
		left: 0.5rem;
		top: 0.75rem;
		bottom: 0.75rem;
		width: 2px;
		background: linear-gradient(180deg, rgba(249, 115, 22, 0.35), rgba(249, 115, 22, 0.08));
		border-radius: 1px;
	}
	.historial-entry {
		position: relative;
		margin-bottom: 0.85rem;
	}
	.historial-entry:last-child {
		margin-bottom: 0;
	}
	.historial-dot {
		position: absolute;
		left: -1.65rem;
		top: 0.75rem;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.06);
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
	}
	.historial-dot-borrador {
		background: #64748b;
	}
	.historial-dot-liquidada {
		background: #ea580c;
	}
	.historial-dot-aprobada {
		background: #ea580c;
	}
	.historial-dot-facturada {
		background: #ea580c;
	}
	.historial-dot-anulada {
		background: #dc2626;
	}
	.historial-entry-first .historial-dot {
		width: 1.35rem;
		height: 1.35rem;
		left: -1.725rem;
		top: 0.65rem;
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.18);
	}

	/* Card de cada entrada */
	.historial-card {
		background: #f6f6f3;
		border: 1px solid rgba(15, 23, 42, 0.06);
		border-radius: 14px;
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		transition: all 0.2s;
	}
	.historial-card:hover {
		border-color: rgba(249, 115, 22, 0.25);
		box-shadow: 0 2px 12px rgba(249, 115, 22, 0.06);
	}
	.historial-entry-first .historial-card {
		background: white;
		border: 1px solid rgba(249, 115, 22, 0.30);
		box-shadow: 0 2px 12px rgba(249, 115, 22, 0.08);
	}
	.historial-card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.historial-transition {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
	}
	.historial-tag {
		padding: 0.22rem 0.55rem !important;
		font-size: 0.68rem !important;
	}
	.historial-arrow {
		color: #94a3b8;
		flex-shrink: 0;
	}
	.historial-fecha {
		font-family: 'Geist', sans-serif;
		font-size: 0.7rem;
		color: #64748b;
		white-space: nowrap;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}
	.historial-user {
		font-size: 0.78rem;
		color: #64748b;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: 'Geist', sans-serif;
	}
	.historial-user-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		background: rgba(249, 115, 22, 0.10);
		color: #ea580c;
		flex-shrink: 0;
	}
	.historial-motivo {
		font-size: 0.78rem;
		color: #64748b;
		font-style: italic;
		padding: 0.5rem 0.7rem;
		background: white;
		border-left: 2px solid rgba(249, 115, 22, 0.35);
		border-radius: 0 8px 8px 0;
		display: flex;
		align-items: flex-start;
		gap: 0.45rem;
		line-height: 1.5;
	}

	/* Footer */
	.historial-ft {
		padding: 1rem 1.5rem 1.25rem;
		display: flex;
		justify-content: flex-end;
		border-top: 1px solid rgba(15, 23, 42, 0.06);
		background: #f6f6f3;
	}
	.historial-ft-btn {
		padding: 0.6rem 1rem !important;
	}

	/* ═══════════════════════════════════════════════════════════
	   WORKBOOK — SPREADSHEET UI (skill: landing-cotransmeq)
	   Paleta cálida #fcfcfb, tipografía Geist (acento naranja + verde bosque)
	   ═══════════════════════════════════════════════════════════ */
	.wb-shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		max-height: 100vh;
		background: #fcfcfb;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 12.5px;
		color: #0f172a;
	}

	/* ── Toolbar (white sticky editorial) ── */
	.wb-toolbar {
		background: linear-gradient(180deg, #ffffff 0%, #fcfcfb 100%);
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
		padding: 12px 20px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-shrink: 0;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
		z-index: 50;
	}
	.wb-toolbar-l {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		flex: 1;
	}
	.wb-toolbar-r {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.wb-toolbar-divider {
		width: 1px;
		height: 32px;
		background: linear-gradient(180deg, transparent 0%, rgba(15, 23, 42, 0.1) 50%, transparent 100%);
		flex-shrink: 0;
	}
	.wb-toolbar-title {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.wb-toolbar-eyebrow {
		font-family: 'Geist', sans-serif;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #ea580c;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.25rem 0.6rem;
		border-radius: 9999px;
		display: inline-block;
		width: max-content;
		border: 1px solid rgba(249, 115, 22, 0.15);
	}
	.wb-toolbar-t {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: 'Geist', sans-serif;
		color: #0f172a;
		font-size: 1.35rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		line-height: 1.15;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wb-toolbar-sub {
		color: #64748b;
		font-size: 0.78rem;
		margin-top: 1px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wb-consec-inline {
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		color: #ea580c;
		background: rgba(249, 115, 22, 0.1);
		padding: 0 0.4rem;
		border-radius: 4px;
		border: 1px solid rgba(249, 115, 22, 0.2);
		font-variant-numeric: tabular-nums;
	}
	.wb-btn-back {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: #ffffff;
		border: 1px solid rgba(15, 23, 42, 0.10);
		color: #64748b;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0.5rem 0.8rem;
		border-radius: 10px;
		transition: all 0.2s;
		font-family: 'Geist', sans-serif;
	}
	.wb-btn-back:hover {
		color: #ea580c;
		background: rgba(249, 115, 22, 0.06);
		border-color: rgba(249, 115, 22, 0.3);
		transform: translateX(-2px);
	}
	.wb-btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		background: #ffffff;
		color: #0f172a;
		border: 1px solid rgba(15, 23, 42, 0.12);
		border-radius: 10px;
		padding: 0.55rem 0.95rem;
		font-family: 'Geist', sans-serif;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
	}
	.wb-btn-secondary:hover {
		background: #f6f6f3;
		border-color: rgba(15, 23, 42, 0.20);
		transform: translateY(-1px);
	}
	.wb-btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		background: transparent;
		color: #6b6b6b;
		border: 1px solid transparent;
		border-radius: 10px;
		padding: 0.55rem 0.95rem;
		font-family: 'Geist', sans-serif;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.wb-btn-ghost:hover {
		background: rgba(220, 38, 38, 0.06);
		color: #b91c1c;
		border-color: rgba(220, 38, 38, 0.2);
	}
	.wb-btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.6rem 1.1rem;
		background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
		color: #ffffff;
		border: none;
		border-radius: 10px;
		font-family: 'Geist', sans-serif;
		font-size: 0.82rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow:
			0 2px 8px rgba(249, 115, 22, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.15);
		transition: all 0.2s;
		letter-spacing: 0.01em;
	}
	.wb-btn-primary:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow:
			0 6px 16px rgba(249, 115, 22, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.2);
	}
	.wb-btn-primary:active:not(:disabled) {
		transform: translateY(0);
	}
	.wb-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.wb-btn-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #ffffff;
		border-radius: 50%;
		animation: wb-spin 0.7s linear infinite;
	}
	@keyframes wb-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Auto-save chip ── */
	.wb-draft-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0.4rem 0.7rem 0.4rem 0.6rem;
		background: rgba(249, 115, 22, 0.06);
		color: #ea580c;
		border: 1px solid rgba(249, 115, 22, 0.18);
		border-radius: 20px;
		font-size: 0.72rem;
		font-weight: 600;
		font-family: 'Geist', sans-serif;
		transition: all 0.2s;
	}
	.wb-draft-pill.wb-draft-saved {
		background: rgba(249, 115, 22, 0.08);
		border-color: rgba(249, 115, 22, 0.25);
	}
	.wb-draft-pill.wb-draft-active {
		background: rgba(245, 158, 11, 0.06);
		border-color: rgba(245, 158, 11, 0.25);
		color: #92400e;
	}
	.wb-draft-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #f97316;
		position: relative;
		flex-shrink: 0;
	}
	.wb-draft-dot::after {
		content: '';
		position: absolute;
		inset: -3px;
		border-radius: 50%;
		background: #f97316;
		opacity: 0.4;
		animation: wb-pulse 2s ease-in-out infinite;
	}
	.wb-draft-active .wb-draft-dot {
		background: #f59e0b;
	}
	.wb-draft-active .wb-draft-dot::after {
		background: #f59e0b;
	}
	@keyframes wb-pulse {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.4;
		}
		50% {
			transform: scale(2);
			opacity: 0;
		}
	}
	.wb-draft-label {
		letter-spacing: 0.01em;
	}
	.wb-draft-time {
		font-family: 'Geist', sans-serif;
		font-size: 0.68rem;
		color: #c2410c;
		padding-left: 6px;
		border-left: 1px solid rgba(249, 115, 22, 0.2);
		margin-left: 2px;
	}
	.wb-draft-active .wb-draft-time {
		color: #b45309;
		border-left-color: rgba(245, 158, 11, 0.3);
	}
	.wb-draft-restored {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		background: #fbbf24;
		color: #78350f;
		border-radius: 4px;
		font-size: 9.5px;
		font-weight: 700;
		margin-left: 4px;
	}
	.wb-draft-debug {
		padding: 0.3rem 0.6rem;
		background: rgba(99, 102, 241, 0.08);
		color: #4338ca;
		border: 1px solid rgba(99, 102, 241, 0.2);
		border-radius: 8px;
		font-size: 0.7rem;
		font-weight: 700;
		font-family: 'Geist', sans-serif;
		cursor: pointer;
	}

	/* ── Debug panel ── */
	.wb-debug-panel {
		background: #fefce8;
		border-bottom: 1px solid #fbbf24;
		padding: 10px 22px;
		font-size: 11px;
		max-height: 240px;
		overflow: auto;
	}
	.wb-debug-hd {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-weight: 800;
		color: #92400e;
		font-size: 12px;
		margin-bottom: 6px;
	}
	.wb-debug-hd button {
		background: none;
		border: none;
		cursor: pointer;
		color: #92400e;
		font-size: 14px;
	}
	.wb-debug-empty {
		padding: 4px 0;
		color: #a16207;
		font-style: italic;
	}
	.wb-debug-count {
		font-weight: 700;
		color: #dc2626;
		margin-bottom: 6px;
	}
	.wb-debug-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 10px;
		font-family: 'Geist', sans-serif;
	}
	.wb-debug-tbl th {
		background: #fef3c7;
		padding: 4px 8px;
		text-align: left;
		border-bottom: 1px solid #fbbf24;
		font-weight: 800;
		font-size: 9px;
		text-transform: uppercase;
		color: #92400e;
	}
	.wb-debug-tbl td {
		padding: 3px 8px;
		border-bottom: 1px solid #fde68a;
	}
	.wb-ddf {
		font-weight: 700;
		color: #1e40af;
		white-space: nowrap;
	}
	.wb-dds {
		color: #dc2626;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.wb-ddc {
		color: #ea580c;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Scroll area ── */
	.wb-scroll-area {
		flex: 1;
		overflow: auto;
		background: #fcfcfb;
		position: relative;
		-webkit-overflow-scrolling: touch;
	}
	.wb-scroll-area::-webkit-scrollbar {
		height: 10px;
		width: 10px;
	}
	.wb-scroll-area::-webkit-scrollbar-track {
		background: rgba(15, 23, 42, 0.04);
	}
	.wb-scroll-area::-webkit-scrollbar-thumb {
		background: rgba(15, 23, 42, 0.2);
		border-radius: 5px;
	}
	.wb-scroll-area::-webkit-scrollbar-thumb:hover {
		background: rgba(15, 23, 42, 0.3);
	}

	/* ── Workbook (flex-based, each cell has explicit width) ── */
	.workbook {
		display: flex;
		flex-direction: column;
		margin: 0 auto;
		padding: 12px 16px 60px 16px;
		font-variant-numeric: tabular-nums;
	}

	/* ── Table wrappers (horizontal scroll per section) ── */
	.wb-table-wrap {
		overflow-x: auto;
		overflow-y: visible;
		border-radius: 10px;
		border: 1px solid rgba(15, 23, 42, 0.06);
		background: #ffffff;
		margin: 0 0 10px 0;
		-webkit-overflow-scrolling: touch;
	}
	.wb-table-wrap::-webkit-scrollbar {
		height: 8px;
	}
	.wb-table-wrap::-webkit-scrollbar-track {
		background: rgba(249, 115, 22, 0.05);
	}
	.wb-table-wrap::-webkit-scrollbar-thumb {
		background: rgba(249, 115, 22, 0.3);
		border-radius: 4px;
	}
	.wb-table-wrap::-webkit-scrollbar-thumb:hover {
		background: rgba(249, 115, 22, 0.5);
	}

	/* ── Grid layout (Liquidador, Valores adicionales) ── */
	.wb-grid-wrap {
		display: grid;
		width: 100%;
		gap: 14px;
		padding: 16px;
		overflow: visible;
	}
	.wb-grid-4 {
		grid-template-columns: repeat(4, 1fr);
	}
	.wb-grid-3 {
		grid-template-columns: repeat(3, 1fr);
	}
	.wb-grid-field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.wb-grid-label {
		font-family: 'Geist', sans-serif;
		font-size: 0.65rem;
		font-weight: 700;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding-left: 2px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.wb-grid-label::before {
		content: '';
		width: 4px;
		height: 4px;
		background: #f97316;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.wb-grid-input {
		min-width: 0;
	}
	.wb-grid-input input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		font-size: 0.88rem;
		font-family: 'Geist', sans-serif;
		font-weight: 500;
		color: #0f172a;
		background: #ffffff;
		border: 1px solid rgba(15, 23, 42, 0.10);
		border-radius: 10px;
		outline: none;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		min-width: 0;
	}
	.wb-grid-input input:hover:not(:disabled):not(:focus) {
		background: rgba(249, 115, 22, 0.03);
		border-color: rgba(249, 115, 22, 0.25);
	}
	.wb-grid-input input:focus {
		background: #fff;
		border-color: #f97316;
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.10);
	}
	.wb-grid-input input[type='number'] {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-variant-numeric: tabular-nums;
	}

	/* ── Rows ── */
	.wb-row {
		display: flex;
		width: max-content;
		min-width: 100%;
		border-bottom: 1px solid rgba(15, 23, 42, 0.06);
		transition: background 0.15s;
	}
	.wb-row:hover {
		background: rgba(249, 115, 22, 0.03);
	}
	.wb-row-num {
		position: sticky;
		left: 0;
		z-index: 10;
		background: #f6f6f3;
		color: #94a3b8;
		font-size: 0.68rem;
		font-weight: 700;
		font-family: 'Geist', sans-serif;
		font-variant-numeric: tabular-nums;
		padding: 8px 0;
		text-align: center;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid rgba(15, 23, 42, 0.06);
		min-height: 38px;
		width: 40px;
		flex-shrink: 0;
	}

	/* ── Cells (base) ── */
	.wb-cell {
		padding: 5px 6px;
		border-right: 1px solid rgba(15, 23, 42, 0.05);
		display: flex;
		align-items: center;
		min-height: 38px;
		min-width: 0;
		position: relative;
		flex: 0 0 auto;
		background: #ffffff;
	}
	.wb-cell input,
	.wb-cell select {
		width: 100%;
		border: 1px solid transparent;
		background: transparent;
		padding: 5px 8px;
		font-size: 0.85rem;
		font-family: 'Geist', sans-serif;
		color: #0f172a;
		border-radius: 8px;
		outline: none;
		min-width: 0;
		transition: all 0.15s;
	}
	.wb-cell input:hover:not(:disabled):not(:focus),
	.wb-cell select:hover:not(:focus) {
		background: rgba(249, 115, 22, 0.04);
		border-color: rgba(249, 115, 22, 0.2);
	}
	.wb-cell input:focus,
	.wb-cell select:focus,
	.wb-cell input:focus-visible,
	.wb-cell select:focus-visible {
		background: #fff;
		border-color: #f97316;
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
		z-index: 2;
		position: relative;
	}
	.wb-cell input:disabled {
		background: #f6f6f3;
		color: #94a3b8;
		cursor: not-allowed;
	}
	.wb-cell select {
		cursor: pointer;
	}

	/* ── LABEL CELL (visualmente distinto a input) ── */

	.wb-cell-num {
		width: 72px;
		flex: 0 0 72px;
	}
	.wb-cell-money {
		width: 90px;
		flex: 0 0 90px;
	}
	.wb-cell-money-lg {
		width: 140px;
		flex: 0 0 140px;
	}
	.wb-cell-date {
		width: 130px;
		flex: 0 0 130px;
	}
	.wb-cell-text {
		width: 110px;
		flex: 0 0 110px;
	}
	.wb-cell-placa {
		width: 110px;
		flex: 0 0 110px;
	}
	.wb-cell-wide {
		width: 200px;
		flex: 0 0 200px;
	}
	.wb-cell-day {
		width: 44px;
		flex: 0 0 44px;
	}
	.wb-cell-action {
		width: 36px;
		flex: 0 0 36px;
	}
	.wb-cell-summary {
		flex: 1 1 auto;
		min-width: 320px;
	}

	/* Variante wider para campos que necesitan más espacio */
	.wb-cell-tipo-serv {
		width: 230px;
		flex: 0 0 230px;
	}
	.wb-cell-recorrido {
		width: 230px;
		flex: 0 0 230px;
	}
	.wb-cell-vr-unit {
		width: 140px;
		flex: 0 0 140px;
	}

	.wb-th {
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.06), rgba(249, 115, 22, 0.10));
		color: #ea580c;
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		justify-content: center;
		text-align: center;
		padding: 9px 6px;
		min-height: 36px;
		border-bottom: 2px solid rgba(249, 115, 22, 0.25);
		flex: 0 0 auto;
	}

	/* ── Section-specific width overrides ── */
	/* ② Ítems de servicio — distribución proporcional (fracciones de 12)
	   PLACA 1.5 | F.INICIAL 1.0 | F.FINAL 1.0 | RECORRIDO 2.0 | TIPO 2.0
	   CANT 0.5 | VR.UNIT 1.0 | SUBTOTAL 1.0 | DCTO 0.5 | PLANILLA 1.0 | ACTION 0.5 = 12 */
	.wb-row-items {
		width: 100%;
	}
	.wb-row-items .wb-cell-placa {
		flex: 1 1 0;
		min-width: 110px;
	}
	.wb-row-items .wb-cell-date {
		flex: 1 1 0;
		min-width: 100px;
	}
	.wb-row-items .wb-cell-recorrido {
		flex: 2 1 0;
		min-width: 160px;
	}
	.wb-row-items .wb-cell-tipo-serv {
		flex: 2.5 1 0;
		min-width: 160px;
	}
	.wb-row-items .wb-cell-num {
		flex: 0.5 1 0;
		min-width: 60px;
	}
	.wb-row-items .wb-cell-vr-unit {
		flex: 1 1 0;
		min-width: 100px;
	}
	.wb-row-items .wb-cell-money-lg {
		flex: 1 1 0;
		min-width: 100px;
	}
	.wb-row-items .wb-cell-text {
		flex: 1 1 0;
		min-width: 90px;
	}
	.wb-row-items .wb-cell-action {
		flex: 0.5 1 0;
		min-width: 36px;
	}

	/* ⑥ Terceros (Hoja 4) — columnas más anchas */
	.wb-row-terceros .wb-cell-placa {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 130px;
	}
	.wb-row-terceros .wb-cell-wide {
		width: 300px;
		flex: 0 0 300px;
	}
	.wb-row-terceros .wb-cell-text {
		width: 150px;
		flex: 0 0 150px;
	}
	.wb-row-terceros .wb-cell-money {
		width: 130px;
		flex: 0 0 130px;
	}
	.wb-row-terceros .wb-cell-num {
		width: 95px;
		flex: 0 0 95px;
	}

	/* ④ Liquidador de recargos — columnas más anchas */

	/* ⑤ Valores adicionales — columnas más anchas */
	.wb-th-sticky {
		position: sticky;
		z-index: 11;
	}
	.wb-th-num {
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.1), rgba(249, 115, 22, 0.18));
	}
	.wb-th-day {
		padding: 8px 2px;
		font-size: 0.62rem;
	}
	.wb-th-action {
		background: rgba(220, 38, 38, 0.06);
		color: #b91c1c;
	}

	.wb-cell-sticky {
		position: sticky;
		z-index: 8;
		background: #ffffff;
		border-right: 2px solid rgba(15, 23, 42, 0.08);
		box-shadow: 2px 0 4px rgba(0, 0, 0, 0.03);
	}
	.wb-row:hover .wb-cell-sticky {
		background: #fcfcfb;
	}
	.wb-cell-num {
		justify-content: stretch;
	}
	.wb-cell-num input {
		text-align: center;
		font-family: 'Geist', sans-serif;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.wb-cell-money input {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.wb-cell-date input {
		font-size: 0.78rem;
		padding: 4px 6px;
	}

	.wb-cell-calc {
		font-family: 'Geist', sans-serif;
		font-size: 0.78rem;
		color: #64748b;
		justify-content: flex-end;
		text-align: right;
		background: #fcfcfb;
		padding: 0 10px 0 6px;
		font-variant-numeric: tabular-nums;
	}
	.wb-cell-calc-strong {
		font-family: 'Geist', sans-serif;
		font-size: 0.78rem;
		font-weight: 800;
		color: #0f172a;
		justify-content: flex-end;
		text-align: right;
		background: rgba(249, 115, 22, 0.06);
		padding: 0 10px 0 6px;
		font-variant-numeric: tabular-nums;
	}
	.wb-cell-calc-success {
		font-family: 'Geist', sans-serif;
		font-size: 0.78rem;
		font-weight: 700;
		color: #ea580c;
		justify-content: flex-end;
		text-align: right;
		background: rgba(249, 115, 22, 0.08);
		padding: 0 10px 0 6px;
		font-variant-numeric: tabular-nums;
	}
	.wb-cell-calc-primary {
		font-family: 'Geist', sans-serif;
		font-size: 0.78rem;
		font-weight: 800;
		color: #ea580c;
		justify-content: flex-end;
		text-align: right;
		background: rgba(249, 115, 22, 0.08);
		padding: 0 10px 0 6px;
		font-variant-numeric: tabular-nums;
	}
	.wb-cell-calc-danger {
		font-family: 'Geist', sans-serif;
		font-size: 0.78rem;
		font-weight: 700;
		color: #b91c1c;
		justify-content: flex-end;
		text-align: right;
		background: rgba(220, 38, 38, 0.04);
		padding: 0 10px 0 6px;
		font-variant-numeric: tabular-nums;
	}
	.wb-cell-calc-blue {
		font-family: 'Geist', sans-serif;
		font-size: 0.78rem;
		font-weight: 700;
		color: #ea580c;
		justify-content: flex-end;
		text-align: right;
		background: rgba(249, 115, 22, 0.04);
		padding: 0 10px 0 6px;
		font-variant-numeric: tabular-nums;
	}
	.wb-cell-mono {
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: 0.8rem;
		justify-content: center;
		font-variant-numeric: tabular-nums;
	}
	.wb-cell-text-muted {
		font-size: 0.78rem;
		color: #64748b;
	}

	.wb-cell-action {
		justify-content: center;
		padding: 2px;
	}
	.wb-btn-del {
		background: transparent;
		border: none;
		color: #9a9a9a;
		cursor: pointer;
		font-size: 0.9rem;
		padding: 3px 6px;
		border-radius: 6px;
		transition: all 0.15s;
	}
	.wb-btn-del:hover {
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
	}
	.wb-btn-del-placeholder {
		display: inline-block;
		cursor: default;
		opacity: 0.25;
		pointer-events: none;
	}
	.wb-btn-del-placeholder:hover {
		background: transparent;
		color: #9a9a9a;
	}

	/* ═══════════════════════════════════════════════════════════════
	   WORKBOOK CARDS — patrón editorial alineado con landing-cotransmeq
	   (eyebrow pill naranja + h2 Geist 700 + tipografía única)
	   ═══════════════════════════════════════════════════════════════ */
	.wb-card {
		background: white;
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 20px;
		padding: 1.5rem 1.5rem 1.75rem;
		margin-bottom: 1.25rem;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
		box-sizing: border-box;
		width: 100%;
		max-width: 100%;
	}
	.wb-card-hd {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-bottom: 1.1rem;
		min-width: 0;
	}
	.wb-card-hd-flex {
		flex-direction: row;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.wb-card-hd-text {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
		flex: 1 1 auto;
	}
	.wb-card-eyebrow {
		display: inline-block;
		width: fit-content;
		max-width: 100%;
		flex-shrink: 0;
		white-space: nowrap;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #ea580c;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.22rem 0.6rem;
		border-radius: 9999px;
		font-family: 'Geist', sans-serif;
		margin-bottom: 0.35rem;
	}
	.wb-card-title {
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: 1.25rem;
		line-height: 1.3;
		color: #0f172a;
		margin: 0;
		letter-spacing: -0.01em;
		overflow-wrap: anywhere;
	}
	.wb-card-title-soft {
		color: #94a3b8;
		font-weight: 500;
		font-size: 0.95rem;
		margin-left: 0.4rem;
	}
	.wb-card-title-icon {
		display: inline-block;
		margin-right: 0.4rem;
		font-size: 1.1em;
		vertical-align: -0.05em;
	}
	.wb-card-sub {
		font-size: 0.78rem;
		color: #64748b;
		margin: 0.15rem 0 0;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.wb-card-count {
		display: inline-flex;
		align-items: center;
		font-family: 'Geist', sans-serif;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #ea580c;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.28rem 0.6rem;
		border-radius: 9999px;
		flex-shrink: 0;
		flex: 0 0 auto;
		white-space: nowrap;
	}
	.wb-card-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	/* Atajos (hint card más compacto) */
	.wb-card-hint {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.85rem 1.1rem;
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.04), rgba(249, 115, 22, 0.08));
		border: 1px solid rgba(249, 115, 22, 0.15);
	}
	.wb-card-hint-icon {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: white;
		color: #ea580c;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		border: 1px solid rgba(249, 115, 22, 0.18);
	}
	.wb-card-hint-body {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.wb-card-hint-body .wb-card-eyebrow {
		margin-bottom: 0.05rem;
	}
	.wb-card-hint-text {
		font-size: 0.82rem;
		color: #ea580c;
		margin: 0;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.wb-card-hint-text kbd {
		display: inline-block;
		font-family: 'Geist', sans-serif;
		font-size: 0.72rem;
		font-weight: 700;
		background: white;
		border: 1px solid rgba(249, 115, 22, 0.25);
		border-bottom-width: 2px;
		border-radius: 4px;
		padding: 0.05rem 0.4rem;
		color: #ea580c;
		margin: 0 0.1rem;
	}

	/* ── Field header row (column titles) ── */
	.wb-row-fields {
		background: linear-gradient(180deg, rgba(249, 115, 22, 0.02), transparent);
	}

	/* ═══════════════════════════════════════════════════════════
	   ENCABEZADO — Grid limpio con labels pequeños sobre inputs
	   (sin columna de números, sin cells de spreadsheet)
	   Las filas ahora viven dentro de .wb-card-body, sin card propio.
	   ═══════════════════════════════════════════════════════════ */
	.wb-enc-row {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		flex-wrap: wrap;
	}

	.wb-enc-cell {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}

	/* Anchos fijos y flexibles */
	.wb-enc-cell-fixed-350 {
		width: 280px;
		flex: 0 0 280px;
	}
	.wb-enc-cell-fixed-220 {
		width: 200px;
		flex: 0 0 200px;
	}
	.wb-enc-cell-flex {
		flex: 1 1 0;
		min-width: 180px;
	}
	.wb-enc-cell-flex-110 {
		flex: 1 1 0;
		min-width: 100px;
	}
	.wb-enc-cell-flex-130 {
		flex: 1 1 0;
		min-width: 120px;
	}
	.wb-enc-cell-full {
		flex: 1 1 100%;
		min-width: 0;
	}

	.wb-enc-label {
		font-family: 'Geist', sans-serif;
		font-size: 0.62rem;
		font-weight: 700;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		display: flex;
		align-items: center;
		gap: 6px;
		padding-left: 2px;
		line-height: 1;
	}
	.wb-enc-label::before {
		content: '';
		width: 4px;
		height: 4px;
		background: #f97316;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.wb-enc-cell input,
	.wb-enc-cell select {
		width: 100%;
		border: 1px solid rgba(15, 23, 42, 0.10);
		background: #ffffff;
		padding: 9px 12px;
		font-size: 0.85rem;
		font-family: 'Geist', sans-serif;
		color: #0f172a;
		border-radius: 10px;
		outline: none;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		min-width: 0;
	}
	.wb-enc-cell input::placeholder {
		color: #94a3b8;
		font-weight: 400;
	}
	.wb-enc-cell input:hover:not(:disabled):not(:focus),
	.wb-enc-cell select:hover:not(:focus) {
		border-color: rgba(249, 115, 22, 0.4);
		background: #fcfcfb;
	}
	.wb-enc-cell input:focus,
	.wb-enc-cell select:focus {
		border-color: #f97316;
		background: #fff;
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.10);
	}
	.wb-enc-cell input:disabled {
		background: #f6f6f3;
		color: #94a3b8;
		cursor: not-allowed;
		font-family: 'Geist', sans-serif;
		font-weight: 600;
	}
	.wb-enc-cell select {
		cursor: pointer;
	}

	/* Ajuste de searchable select dentro del cell */
	.wb-enc-cell .ss-wrap {
		position: relative;
	}
	.wb-enc-cell .ss-search {
		font-size: 0.85rem;
	}

	/* ── Totals row ── */
	.wb-row-totals {
		background: rgba(249, 115, 22, 0.04);
		border-top: 1px solid rgba(249, 115, 22, 0.3);
		border-bottom: 1px solid rgba(249, 115, 22, 0.3);
		font-weight: 700;
	}
	.wb-row-totals .wb-row-num {
		background: rgba(249, 115, 22, 0.06);
		color: #ea580c;
	}
	.wb-cell-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 20px;
		align-items: center;
		font-size: 0.82rem;
		color: #64748b;
		padding: 10px 14px;
	}
	.wb-cell-summary b {
		color: #0f172a;
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.wb-grand-pill {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: #fff;
		padding: 5px 14px;
		border-radius: 9999px;
		font-weight: 700;
		margin-left: auto;
		font-size: 0.85rem;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.25);
	}
	.wb-grand-pill b {
		color: #fff;
		font-family: 'Geist', sans-serif;
		font-variant-numeric: tabular-nums;
	}

	/* ═══ RESUMEN CARDS (Resumen Liquidación / Resumen Terceros) ═══ */
	.resumen-card {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 2px 0;
	}
	.resumen-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 4px;
		border-bottom: 1px solid #f1f5f9;
		font-size: 0.86rem;
		color: #475569;
		gap: 12px;
	}
	.resumen-row:last-child {
		border-bottom: none;
	}
	.resumen-row > span:first-child {
		flex: 1 1 auto;
		min-width: 0;
	}
	.resumen-row > strong,
	.resumen-row > span:last-child {
		flex: 0 0 auto;
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		color: #0f172a;
		font-size: 0.92rem;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.resumen-row strong {
		color: #0f172a;
	}
	.resumen-row.muted > span:last-child {
		color: #94a3b8;
		font-weight: 500;
	}
	.resumen-row.emphasis {
		font-weight: 700;
		color: #166534;
	}
	.resumen-row.emphasis > span:first-child {
		font-weight: 700;
		color: #166534;
	}
	.resumen-divider {
		border-top: 2px solid #e2e8f0;
		margin-top: 4px;
		padding-top: 12px;
	}
	.resumen-total {
		background: linear-gradient(135deg, #ea580c 0%, #f97316 60%, #fb923c 100%);
		color: #fff;
		padding: 14px 18px;
		border-radius: 12px;
		margin-top: 10px;
		font-size: 0.95rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.30);
		border-bottom: none;
	}
	.resumen-total > span:first-child {
		color: #fff;
		font-weight: 800;
	}
	.resumen-total > span:last-child {
		color: #fff;
		font-family: 'Geist', sans-serif;
		font-weight: 800;
		font-size: 1.05rem;
		font-variant-numeric: tabular-nums;
	}

	/* ── Empty / add row ── */
	.wb-empty-row {
		display: flex;
		min-width: max-content;
		background: #fcfcfb;
		border-bottom: 1px solid rgba(15, 23, 42, 0.05);
	}
	.wb-cell-empty {
		padding: 18px;
		text-align: center;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #94a3b8;
		font-style: italic;
		font-size: 0.82rem;
		flex: 1;
	}
	.wb-btn-add-row {
		display: block;
		margin: 8px 0 16px 14px;
		padding: 8px 18px;
		background: #ffffff;
		border: 1.5px dashed rgba(249, 115, 22, 0.3);
		color: #ea580c;
		border-radius: 10px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		min-width: max-content;
		font-family: 'Geist', sans-serif;
	}
	.wb-btn-add-row:hover {
		background: rgba(249, 115, 22, 0.06);
		border-color: #f97316;
		border-style: solid;
	}

	/* ── Paste zone ── */
	.wb-paste-zone {
		min-width: max-content;
	}

	/* ── Consec input ── */
	.wb-consec-wrap {
		display: flex;
		gap: 6px;
		align-items: center;
		width: 100%;
	}
	.wb-consec-wrap input {
		flex: 1;
		min-width: 0;
	}
	.wb-consec-input {
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}
	.wb-consec-input.consec-ok {
		border-color: #f97316 !important;
		background: rgba(249, 115, 22, 0.06) !important;
	}
	.wb-consec-input.consec-taken {
		border-color: #dc2626 !important;
		background: rgba(220, 38, 38, 0.04) !important;
	}
	.consec-badge {
		font-family: 'Geist', sans-serif;
		font-size: 0.95rem;
		font-weight: 600;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.consec-ok-badge {
		color: #ea580c;
	}
	.consec-taken-badge {
		color: #b91c1c;
	}
	.consec-checking {
		color: #94a3b8;
	}

	/* ── Sync button (inside section band) ── */
	.wb-btn-sync {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: linear-gradient(to right, #f97316, #ea580c);
		color: #ffffff;
		border: 1px solid rgba(249, 115, 22, 0.3);
		border-radius: 10px;
		padding: 0.4rem 0.85rem;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		font-family: 'Geist', sans-serif;
		transition: all 0.2s ease;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}
	.wb-btn-sync:hover {
		background: linear-gradient(to right, #ea580c, #c2410c);
		box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.2), 0 2px 8px rgba(249, 115, 22, 0.25);
		transform: translateY(-1px);
	}
	.wb-btn-sync:active {
		transform: translateY(0);
	}

	/* ── Searchable select (mini) ── */
	.wb-ss-mini {
		font-size: 0.8rem !important;
		padding: 4px 6px !important;
	}
	.ss-search {
		font-size: 0.8rem;
	}
	.ss-selected {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(249, 115, 22, 0.06);
		border: 1px solid rgba(249, 115, 22, 0.20);
		border-radius: 8px;
		padding: 5px 8px;
		font-size: 0.8rem;
		font-weight: 600;
		color: #ea580c;
	}
	.ss-selected .ss-nit {
		font-size: 0.7rem;
		color: #64748b;
		font-weight: 500;
		font-family: 'Geist', sans-serif;
	}

	/* ── Error message ── */
	.wb-error-msg {
		margin: 0 24px 16px;
		padding: 0.85rem 1rem;
		background: rgba(220, 38, 38, 0.06);
		color: #991b1b;
		border: 1px solid rgba(220, 38, 38, 0.25);
		border-radius: 12px;
		font-size: 0.82rem;
		font-weight: 600;
		min-width: max-content;
		font-family: 'Geist', sans-serif;
	}

	/* ═══ RESPONSIVE — TABLET (≤ 1279px) ═══ */
	@media (max-width: 1279px) {
		.wb-toolbar {
			padding: 10px 14px;
			gap: 10px;
		}
		.wb-toolbar-t {
			font-size: 14px;
		}
		.wb-toolbar-sub {
			font-size: 10.5px;
		}
		.wb-toolbar-divider {
			height: 24px;
		}
		.wb-btn-back span,
		.wb-btn-secondary span,
		.wb-btn-ghost span {
			display: none;
		}
		.wb-btn-back,
		.wb-btn-secondary,
		.wb-btn-ghost {
			padding: 0.5rem;
		}
		.wb-draft-pill {
			font-size: 10px;
			padding: 0.3rem 0.55rem;
		}
		.wb-draft-time {
			display: none;
		}
		.wb-grid-4 {
			grid-template-columns: repeat(2, 1fr);
		}
		.wb-enc-cell-fixed-350 {
			width: 220px;
			flex: 0 0 220px;
		}
		.wb-enc-cell-fixed-220 {
			width: 160px;
			flex: 0 0 160px;
		}
	}

	/* ═══ RESPONSIVE — MOBILE (≤ 768px) ═══ */
	@media (max-width: 768px) {
		.wb-toolbar {
			padding: 10px 12px;
			flex-direction: column;
			align-items: stretch;
			gap: 8px;
		}
		.wb-toolbar-l {
			gap: 8px;
		}
		.wb-toolbar-divider {
			display: none;
		}
		.wb-toolbar-r {
			flex-wrap: wrap;
			justify-content: flex-end;
		}
		.wb-toolbar-t {
			font-size: 13px;
		}
		.wb-toolbar-sub {
			font-size: 10px;
		}
		.wb-draft-pill {
			font-size: 9.5px;
		}
		.wb-shell {
			font-size: 11px;
		}
		.wb-grid-4,
		.wb-grid-3 {
			grid-template-columns: 1fr;
		}
		.wb-enc-row {
			flex-direction: column;
			gap: 10px;
		}
		.wb-card {
			padding: 1.25rem 1.1rem 1.4rem;
			border-radius: 16px;
		}
		.wb-card-hd-flex {
			flex-direction: column;
			align-items: flex-start;
		}
		.wb-card-title {
			font-size: 1.1rem;
		}
		.wb-card-hint {
			padding: 0.75rem 0.85rem;
		}
		.wb-enc-cell-fixed-350,
		.wb-enc-cell-fixed-220,
		.wb-enc-cell-flex,
		.wb-enc-cell-flex-110,
		.wb-enc-cell-flex-130,
		.wb-enc-cell-full {
			width: 100%;
			flex: 1 1 100%;
		}
		.wb-card-hd-flex {
			flex-direction: column;
			align-items: flex-start;
		}
		.wb-card-count {
			align-self: flex-start;
		}
	}
</style>
