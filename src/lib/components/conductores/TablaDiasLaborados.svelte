<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import {
		apiClient,
		bonosAPI,
		bonoConfigVisualAPI,
		type BonoConfigVisualItem,
		type BonoPlanilla
	} from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { toast } from 'svelte-sonner';
	import ModalConfigBonos from './ModalConfigBonos.svelte';

	export type TipoDia = 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';

	export interface SegmentoTabla {
		id: string;
		registro_dia_id: string;
		orden: number;
		cliente_id: string | null;
		cliente_nombre: string | null;
		vehiculo_id: string | null;
		vehiculo_placa: string;
		hora_inicio: string;
		hora_fin: string;
		horas_conducidas: number;
		km_inicial?: number | null;
		km_final?: number | null;
		pernocte?: boolean | null;
		observaciones: string | null;
	}

	export interface RegistroTabla {
		id: string;
		fecha: string;
		tipo: TipoDia;
		observaciones: string | null;
		/** Vehículo intervenido; solo viene lleno en días de MANTENIMIENTO. */
		mantenimiento_vehiculo_id?: string | null;
		mantenimiento_vehiculo_placa?: string | null;
		created_at?: string;
		updated_at?: string;
		conductor: { id: string; nombre: string; apellido: string; numero_identificacion: string } | null;
		segmentos: SegmentoTabla[];
	}

	// Una fila = 1 recorrido (tramo). Si un día tiene N tramos, se generan N filas.
	// Para días LABORADO sin tramos se genera 1 fila placeholder con segmento = null.
	interface FilaTabla {
		registro: RegistroTabla;
		segmento: SegmentoTabla | null;
	}

	type Props = {
		refreshKey?: number;
		/** Cuando se llega desde un conductor específico (URL `?conductor=<id>`) */
		conductorIdInicial?: string;
		/** Si el usuario actual puede marcar / guardar bonos (permiso individual) */
		canManageBonos?: boolean;
	};

	let { refreshKey, conductorIdInicial, canManageBonos = false }: Props = $props();

	// ═══════════════════════════════
	// RANGO DE FECHAS POR DEFECTO
	// ═══════════════════════════════
	function rangoPorDefecto(): { desde: string; hasta: string } {
		const hoy = new Date();
		const hace90 = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
		const ymd = (d: Date) =>
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		return { desde: ymd(hace90), hasta: ymd(hoy) };
	}

	let filtroDesde = $state(rangoPorDefecto().desde);
	let filtroHasta = $state(rangoPorDefecto().hasta);
	let filtroConductor = $state<string>(conductorIdInicial ?? '');
	let filtroPlaca = $state<string>('');
	let filtroCliente = $state<string>('');
	let filtroRecorrido = $state<string>('');
	let filtroHoraDesde = $state<string>('');
	let filtroHoraHasta = $state<string>('');
	let searchTerm = $state<string>('');
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let loading = $state(false);
	let registros = $state<RegistroTabla[]>([]);

	// ═══════════════════════════════
	// CONFIGURACIONES DE LIQUIDACIÓN VISIBLES
	// Solo se pintan las que tienen `visible = true` en la pivot
	// `bono_config_visual`. El usuario configura cuáles ver desde
	// el modal `ModalConfigBonos`. El valor monetario siempre se
	// lee de aquí (lectura en vivo).
	// ═══════════════════════════════
	let configsActivas = $state<BonoConfigVisualItem[]>([]);
	let totalConfigsDisponibles = $state(0); // para saber cuántas hay en total vs cuántas se muestran
	let loadingConfigs = $state(false);

	// Modal de configuración de visibilidad
	let modalConfigOpen = $state(false);

	// Año a usar para pedir las configs visibles. Por defecto el del rango
	// (si todos los meses son del mismo año); si no, el año actual.
	let anioConfigs = $derived.by(() => {
		const a = (filtroDesde || '').slice(0, 4);
		const b = (filtroHasta || '').slice(0, 4);
		if (a && a === b) return parseInt(a);
		return new Date().getFullYear();
	});

	async function cargarConfigsVisibles() {
		loadingConfigs = true;
		try {
			const res = await bonoConfigVisualAPI.listar(anioConfigs);
			const all = res.data?.data ?? [];
			totalConfigsDisponibles = all.length;
			// Solo pintamos las visibles. Las ocultas existen pero no se renderizan.
			configsActivas = all.filter((c) => c.visible);
		} catch (err: any) {
			console.warn('No se pudieron cargar configuraciones de bonos:', err?.message || err);
			configsActivas = [];
		} finally {
			loadingConfigs = false;
		}
	}

	function onConfigBonosSaved() {
		// Refrescar la lista de visibles cuando el usuario guarda cambios
		// en el modal de configuración.
		cargarConfigsVisibles();
	}

	// ═══════════════════════════════
	// ESTADO DE BONOS
	// ─ Set local de checks indexado por `config_liquidacion_id`
	// ─ Map clave-local → id persistido (para detectar eliminaciones)
	// ═══════════════════════════════
	// clave: `${config_liquidacion_id}::${registro_dia_id}::${segmento_id ?? ''}`
	let checksActivos = $state<Set<string>>(new Set());
	let bonoIdPorClave = $state<Map<string, string>>(new Map());
	let bonosAEliminar = $state<Set<string>>(new Set());
	let guardandoBonos = $state(false);

	function keyBono(
		configId: string,
		registroId: string,
		segmentoId: string | null | undefined
	): string {
		return `${configId}::${registroId}::${segmentoId ?? ''}`;
	}

	function isChecked(
		configId: string,
		registroId: string,
		segmentoId: string | null
	): boolean {
		return checksActivos.has(keyBono(configId, registroId, segmentoId));
	}

	function toggleBono(configId: string, registroId: string, segmentoId: string | null) {
		if (!canManageBonos) {
			toast.warning('No tienes el permiso "bonos-planilla" para modificar bonos');
			return;
		}
		const k = keyBono(configId, registroId, segmentoId);
		const newSet = new Set(checksActivos);
		const wasChecked = newSet.has(k);
		if (wasChecked) {
			newSet.delete(k);
			const idPersistido = bonoIdPorClave.get(k);
			if (idPersistido) {
				const delSet = new Set(bonosAEliminar);
				delSet.add(idPersistido);
				bonosAEliminar = delSet;
			}
		} else {
			newSet.add(k);
			const idPersistido = bonoIdPorClave.get(k);
			if (idPersistido && bonosAEliminar.has(idPersistido)) {
				const delSet = new Set(bonosAEliminar);
				delSet.delete(idPersistido);
				bonosAEliminar = delSet;
			}
		}
		checksActivos = newSet;
	}

	function limpiarBonos() {
		checksActivos = new Set();
		bonosAEliminar = new Set();
		toast.info('Cambios locales descartados');
	}

	async function cargarBonosPersistidos(): Promise<boolean> {
		try {
			const res = await bonosAPI.listar({
				desde: filtroDesde,
				hasta: filtroHasta,
				conductor_id: filtroConductor || undefined
			});
			const bonos: BonoPlanilla[] = res.data?.data ?? [];
			const checks = new Set<string>();
			const map = new Map<string, string>();
			for (const b of bonos) {
				if (!b.config_liquidacion_id) continue;
				const k = keyBono(b.config_liquidacion_id, b.registro_dia_id, b.segmento_id);
				checks.add(k);
				map.set(k, b.id);
			}
			checksActivos = checks;
			bonoIdPorClave = map;
			bonosAEliminar = new Set();
			return true;
		} catch (err: any) {
			console.warn('No se pudieron cargar los bonos persistidos:', err?.message || err);
			return false;
		}
	}

	async function guardarBonos() {
		if (!canManageBonos) {
			toast.error('No tienes el permiso "bonos-planilla" para guardar bonos');
			return;
		}

		type CrearItem = {
			registro_dia_id: string;
			segmento_id: string | null;
			config_liquidacion_id: string;
		};
		const crear: CrearItem[] = [];
		for (const k of checksActivos) {
			if (bonoIdPorClave.has(k)) continue;
			// clave = `${configId}::${registroId}::${segmentoId ?? ''}`
			const idx1 = k.indexOf('::');
			const idx2 = k.indexOf('::', idx1 + 2);
			if (idx1 < 0 || idx2 < 0) continue;
			const configId = k.substring(0, idx1);
			const registroId = k.substring(idx1 + 2, idx2);
			const segmentoId = k.substring(idx2 + 2);
			crear.push({
				registro_dia_id: registroId,
				segmento_id: segmentoId === '' ? null : segmentoId,
				config_liquidacion_id: configId
			});
		}

		const eliminar = Array.from(bonosAEliminar);

		if (crear.length === 0 && eliminar.length === 0) {
			toast.info('No hay cambios para guardar');
			return;
		}

		guardandoBonos = true;
		try {
			const res = await bonosAPI.sincronizar({ crear, eliminar });
			const data = (res?.data ?? {}) as { created?: number; deleted?: number; total?: number };
			const created = Number(data.created ?? 0);
			const deleted = Number(data.deleted ?? 0);

			bonosAEliminar = new Set();
			bonoIdPorClave = new Map();

			const partes: string[] = [];
			if (created > 0) partes.push(`${created} creado${created === 1 ? '' : 's'}`);
			if (deleted > 0) partes.push(`${deleted} eliminado${deleted === 1 ? '' : 's'}`);
			const resumen = partes.length > 0 ? partes.join(' · ') : 'sin cambios';
			toast.success(`✓ Bonos guardados (${resumen})`);

			cargarBonosPersistidos().then((ok) => {
				if (!ok) {
					toast.warning(
						'Bonos guardados, pero no se pudo refrescar la lista. Recarga la página para ver los IDs actualizados.'
					);
				}
			});
		} catch (err: any) {
			const msg = err?.response?.data?.message || err?.message || 'Error al guardar bonos';
			toast.error(msg);
		} finally {
			guardandoBonos = false;
		}
	}

	// ═══════════════════════════════
	// PAGINACIÓN
	// ═══════════════════════════════
	let pagination = $state({ page: 1, limit: 50, total: 0 });
	const totalPages = $derived(Math.max(1, Math.ceil(pagination.total / pagination.limit)));

	// ═══════════════════════════════
	// CARGA DE DATOS
	// ═══════════════════════════════
	function mesesEnRango(desde: string, hasta: string): { mes: number; anio: number }[] {
		const d = new Date(desde + 'T00:00:00');
		const h = new Date(hasta + 'T00:00:00');
		const meses: { mes: number; anio: number }[] = [];
		const cursor = new Date(d.getFullYear(), d.getMonth(), 1);
		const fin = new Date(h.getFullYear(), h.getMonth(), 1);
		while (cursor <= fin) {
			meses.push({ mes: cursor.getMonth() + 1, anio: cursor.getFullYear() });
			cursor.setMonth(cursor.getMonth() + 1);
		}
		return meses;
	}

	let fetchToken = 0;
	async function cargarDatos() {
		if (!browser) return;
		const tokenActual = ++fetchToken;
		loading = true;
		try {
			const meses = mesesEnRango(filtroDesde, filtroHasta);
			if (meses.length === 0) {
				registros = [];
				return;
			}
			const promesas = meses.map((m) =>
				apiClient
					.get('/api/dias-laborados/calendar-admin', {
						params: { mes: m.mes, anio: m.anio, limit: 9999 }
					})
					.catch(() => ({ data: { data: { registros: [] } } }))
			);
			const responses = await Promise.all(promesas);
			if (tokenActual !== fetchToken) return;
			const todosLosRegistros: RegistroTabla[] = [];
			for (const res of responses) {
				const regs: RegistroTabla[] = res.data?.data?.registros ?? [];
				todosLosRegistros.push(...regs);
			}
			const map = new Map<string, RegistroTabla>();
			for (const r of todosLosRegistros) {
				if (!map.has(r.id)) map.set(r.id, r);
			}
			registros = Array.from(map.values()).sort((a, b) =>
				a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0
			);
		} catch (err: any) {
			if (tokenActual === fetchToken) {
				console.error('Error cargando días laborados:', err);
				toast.error('Error al cargar los datos');
				registros = [];
			}
		} finally {
			if (tokenActual === fetchToken) loading = false;
		}
	}

	$effect(() => {
		void filtroDesde;
		void filtroHasta;
		void refreshKey;
		cargarDatos();
		cargarBonosPersistidos();
	});

	$effect(() => {
		void anioConfigs;
		cargarConfigsVisibles();
	});

	// Limpiar el resumen del último sync cuando cambia el rango o el
	// conductor, para que no muestre datos que ya no aplican al set
	// de filas visibles.
	// ═══════════════════════════════
	// OPCIONES DINÁMICAS PARA FILTROS
	// ═══════════════════════════════
	let todosLosSegmentos = $derived.by(() => {
		const out: SegmentoTabla[] = [];
		for (const r of registros) {
			for (const s of r.segmentos || []) out.push(s);
		}
		return out;
	});

	let opcionesConductores = $derived.by(() => {
		const map = new Map<string, { value: string; label: string }>();
		for (const r of registros) {
			if (!r.conductor) continue;
			const key = r.conductor.id;
			if (!map.has(key)) {
				map.set(key, {
					value: key,
					label: `${r.conductor.nombre} ${r.conductor.apellido} · ${r.conductor.numero_identificacion || ''}`
				});
			}
		}
		return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
	});

	let opcionesPlacas = $derived.by(() => {
		const set = new Set<string>();
		for (const s of todosLosSegmentos) {
			if (s.vehiculo_placa) set.add(s.vehiculo_placa);
		}
		return Array.from(set).sort();
	});

	let opcionesClientes = $derived.by(() => {
		const set = new Set<string>();
		for (const s of todosLosSegmentos) {
			if (s.cliente_nombre) set.add(s.cliente_nombre);
		}
		return Array.from(set).sort();
	});

	let opcionesRecorridos = $derived(opcionesClientes);

	// ═══════════════════════════════
	// FILAS VISIBLES (filtros aplicados)
	// ═══════════════════════════════
	let filasFiltradas = $derived.by(() => {
		const desdeT = filtroDesde ? new Date(filtroDesde + 'T00:00:00').getTime() : -Infinity;
		const hastaT = filtroHasta ? new Date(filtroHasta + 'T23:59:59').getTime() : Infinity;
		const horaMin = filtroHoraDesde ? timeToMinutes(filtroHoraDesde) : -1;
		const horaMax = filtroHoraHasta ? timeToMinutes(filtroHoraHasta) : Infinity;
		const term = searchTerm.trim().toLowerCase();
		const tieneHoraFilter = horaMin >= 0 || horaMax < Infinity;
		const tieneTextoFiltro = filtroPlaca || filtroCliente || filtroRecorrido || tieneHoraFilter;

		const filas: FilaTabla[] = [];
		for (const r of registros) {
			if (r.tipo !== 'LABORADO') continue;
			const fechaMs = toLocalDate(r.fecha).getTime();
			if (fechaMs < desdeT || fechaMs > hastaT) continue;
			if (filtroConductor && r.conductor?.id !== filtroConductor) continue;

			const segs = r.segmentos || [];

			if (tieneTextoFiltro) {
				const segsFiltrados = segs.filter((seg) => {
					if (filtroPlaca && seg.vehiculo_placa !== filtroPlaca) return false;
					if (filtroCliente && seg.cliente_nombre !== filtroCliente) return false;
					if (filtroRecorrido && seg.cliente_nombre !== filtroRecorrido) return false;
					if (tieneHoraFilter) {
						const hIni = timeToMinutes(seg.hora_inicio);
						if (hIni < horaMin || hIni > horaMax) return false;
					}
					return true;
				});
				if (segsFiltrados.length === 0) continue;
				for (const seg of segsFiltrados) {
					filas.push({ registro: r, segmento: seg });
				}
				continue;
			}

			if (term) {
				if (segs.length > 0) {
					for (const seg of segs) {
						const blob = [
							r.conductor?.nombre,
							r.conductor?.apellido,
							r.conductor?.numero_identificacion,
							seg.vehiculo_placa,
							seg.cliente_nombre
						]
							.filter(Boolean)
							.join(' ')
							.toLowerCase();
						if (blob.includes(term)) {
							filas.push({ registro: r, segmento: seg });
						}
					}
				} else {
					const blob = [
						r.conductor?.nombre,
						r.conductor?.apellido,
						r.conductor?.numero_identificacion
					]
						.filter(Boolean)
						.join(' ')
						.toLowerCase();
					if (blob.includes(term)) {
						filas.push({ registro: r, segmento: null });
					}
				}
				continue;
			}

			if (segs.length > 0) {
				for (const seg of segs) {
					filas.push({ registro: r, segmento: seg });
				}
			} else {
				filas.push({ registro: r, segmento: null });
			}
		}
		return filas;
	});

	let filasPaginadas = $derived.by(() => {
		const start = (pagination.page - 1) * pagination.limit;
		return filasFiltradas.slice(start, start + pagination.limit);
	});

	$effect(() => {
		void filasFiltradas.length;
		pagination.total = filasFiltradas.length;
		if (pagination.page > totalPages) pagination.page = 1;
	});

	function timeToMinutes(t: string): number {
		if (!t) return 0;
		const [h, m] = t.split(':').map(Number);
		return (h || 0) * 60 + (m || 0);
	}

	// ═══════════════════════════════
	// ESTADÍSTICAS + COLUMNA "VALOR A PAGAR"
	// Se calcula en vivo leyendo `config_liquidacion.valor` actual.
	// ═══════════════════════════════
	function formatCOP(value: number): string {
		// Formato colombiano: separador de miles con "." y decimales con ","
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(value);
	}

	/**
	 * Devuelve el texto para la celda "valor a pagar" del recorrido.
	 * Formato requerido: "25.000 + 20.000 + 15.000" (solo la sumatoria
	 * visual, SIN mostrar el total). Si no hay items marcados → "—".
	 */
	function valorPagarTexto(registroId: string, segmentoId: string | null): string {
		const partes: string[] = [];
		for (const cfg of configsActivas) {
			if (isChecked(cfg.id, registroId, segmentoId)) {
				partes.push(formatCOP(Number(cfg.valor) || 0));
			}
		}
		return partes.length === 0 ? '—' : partes.join(' + ');
	}

	function valorPagarTotal(registroId: string, segmentoId: string | null): number {
		let total = 0;
		for (const cfg of configsActivas) {
			if (isChecked(cfg.id, registroId, segmentoId)) {
				total += Number(cfg.valor) || 0;
			}
		}
		return total;
	}

	let stats = $derived.by(() => {
		const diasUnicos = new Set(filasFiltradas.map((f) => f.registro.id)).size;
		const totalRecorridos = filasFiltradas.length;
		const totalHoras = filasFiltradas.reduce((s, f) => {
			return s + (f.segmento ? Number(f.segmento.horas_conducidas) || 0 : 0);
		}, 0);
		const totalChecks = checksActivos.size;
		// Suma total del valor a pagar en las filas filtradas (para stat)
		const totalPagar = filasFiltradas.reduce(
			(s, f) => s + valorPagarTotal(f.registro.id, f.segmento?.id ?? null),
			0
		);
		return { diasUnicos, totalRecorridos, totalHoras, totalChecks, totalPagar };
	});

	// Cambios pendientes: diferencia entre estado local y BD
	let cambiosPendientes = $derived.by(() => {
		let porCrear = 0;
		for (const k of checksActivos) if (!bonoIdPorClave.has(k)) porCrear++;
		const porEliminar = bonosAEliminar.size;
		return { porCrear, porEliminar, total: porCrear + porEliminar };
	});

	// ═══════════════════════════════
	// SOCKET
	// ═══════════════════════════════
	function handleRegistroActualizado(payload: any) {
		if (!payload) return;
		const nombre = [payload.conductor_nombre, payload.conductor_apellido]
			.filter(Boolean)
			.join(' ');
		const accion = payload.eliminado ? 'eliminó' : 'registró';
		const tipo = payload.tipo || 'día';
		const segs = payload.segmentos_count ?? 0;
		const toastMsg = nombre
			? `${nombre} ${accion} ${tipo}${segs > 0 ? ` (${segs} tramos)` : ''}`
			: 'Registro actualizado';

		toast.info(toastMsg);
		cargarDatos();
	}

	$effect(() => {
		socketUtils.on('dias-laborados:registro-actualizado', handleRegistroActualizado);
		return () => {
			socketUtils.off('dias-laborados:registro-actualizado', handleRegistroActualizado);
		};
	});

	// ═══════════════════════════════
	// HELPERS UI
	// ═══════════════════════════════
	const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
	const MESES = [
		'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
		'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
	];

	function toLocalDate(fecha: string | Date): Date {
		let s: string;
		if (fecha instanceof Date) {
			s = fecha.toISOString().slice(0, 10);
		} else {
			s = String(fecha).slice(0, 10);
		}
		const [y, m, d] = s.split('-').map(Number);
		return new Date(y, (m || 1) - 1, d || 1);
	}

	function formatFechaLarga(fecha: string): { diaSemana: string; dia: string; mes: string; anio: string } {
		const d = toLocalDate(fecha);
		if (Number.isNaN(d.getTime())) return { diaSemana: '—', dia: '—', mes: '—', anio: '—' };
		return {
			diaSemana: DIAS_SEMANA[d.getDay()],
			dia: String(d.getDate()).padStart(2, '0'),
			mes: MESES[d.getMonth()],
			anio: String(d.getFullYear())
		};
	}

	function formatFechaCorta(fecha: string): string {
		const d = toLocalDate(fecha);
		if (Number.isNaN(d.getTime())) return fecha;
		return d.toLocaleDateString('es-CO', {
			weekday: 'short',
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}

	function formatCreatedAt(iso: string | undefined): string {
		if (!iso) return '—';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '—';
		const ahora = new Date();
		const diffMs = ahora.getTime() - d.getTime();
		const diffMin = Math.floor(diffMs / (1000 * 60));
		const diffHoras = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		const hh = String(d.getHours()).padStart(2, '0');
		const mm = String(d.getMinutes()).padStart(2, '0');
		const dia = String(d.getDate()).padStart(2, '0');
		const mes = MESES[d.getMonth()].slice(0, 3);
		const anio = d.getFullYear();

		if (diffMin < 1) return 'hace instantes';
		if (diffMin < 60) return `hace ${diffMin} min`;
		if (diffHoras < 24 && d.getDate() === ahora.getDate()) return `hoy ${hh}:${mm}`;
		if (diffDias === 1) return `ayer ${hh}:${mm}`;
		if (diffDias < 7) return `hace ${diffDias} días · ${hh}:${mm}`;
		return `${dia} ${mes} ${anio} · ${hh}:${mm}`;
	}

	function formatCreatedAtFull(iso: string | undefined): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		const dia = String(d.getDate()).padStart(2, '0');
		const mes = MESES[d.getMonth()];
		const anio = d.getFullYear();
		const hh = String(d.getHours()).padStart(2, '0');
		const mm = String(d.getMinutes()).padStart(2, '0');
		return `${dia} de ${mes} de ${anio} a las ${hh}:${mm}`;
	}

	function nombreConductor(c: RegistroTabla['conductor']): string {
		if (!c) return '—';
		return `${c.nombre} ${c.apellido}`.trim();
	}

	function limpiarFiltros() {
		const def = rangoPorDefecto();
		filtroDesde = def.desde;
		filtroHasta = def.hasta;
		filtroConductor = '';
		filtroPlaca = '';
		filtroCliente = '';
		filtroRecorrido = '';
		filtroHoraDesde = '';
		filtroHoraHasta = '';
		searchTerm = '';
		pagination.page = 1;
	}

	const filtrosActivos = $derived(
		[
			filtroConductor && 'Conductor',
			filtroPlaca && 'Placa',
			filtroCliente && 'Cliente',
			filtroRecorrido && 'Recorrido',
			(filtroHoraDesde || filtroHoraHasta) && 'Intervalo hora',
			searchTerm.trim() && 'Búsqueda'
		].filter(Boolean).length
	);

	function handleSearch() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			pagination.page = 1;
		}, 300);
	}

	function irPagina(p: number) {
		if (p >= 1 && p <= totalPages) {
			pagination.page = p;
		}
	}

	function duracionHM(hi: string, hf: string): string {
		if (!hi || !hf) return '';
		const [h1, m1] = hi.split(':').map(Number);
		const [h2, m2] = hf.split(':').map(Number);
		const mins = h2 * 60 + m2 - (h1 * 60 + m1);
		if (mins <= 0) return '';
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		if (h === 0) return `${m} min`;
		if (m === 0) return `${h}h`;
		return `${h}h ${m}m`;
	}

	// Ancho estimado de cada columna del canvas
	const COL_ANCHOS = {
		fecha: 130,
		conductor: 230,
		orden: 50,
		placa: 100,
		cliente: 230,
		horario: 110,
		horas: 70,
		km: 120,
		pernocte: 80,
		bono: 110,
		valorPagar: 200
	};

	const totalAnchoTabla = $derived.by(() => {
		const base =
			COL_ANCHOS.fecha +
			COL_ANCHOS.conductor +
			COL_ANCHOS.orden +
			COL_ANCHOS.placa +
			COL_ANCHOS.cliente +
			COL_ANCHOS.horario +
			COL_ANCHOS.horas +
			COL_ANCHOS.km +
			COL_ANCHOS.pernocte
		const bonos = configsActivas.length * COL_ANCHOS.bono;
		return base + bonos + COL_ANCHOS.valorPagar;
	});
</script>

<div class="flex h-full min-h-0 flex-col gap-3">
	<!-- ═══ BARRA DE ACCIONES + FILTROS ═══ -->
	<div
		class="glass soft-shadow flex flex-shrink-0 flex-col gap-3 rounded-2xl border border-gray-200/50 p-3"
	>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<svg class="h-3.5 w-3.5" style="color: var(--text-muted);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
				</svg>
				<span class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--text-secondary);">
					Filtros
				</span>
				{#if filtrosActivos > 0}
					<span
						class="flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1.5 text-[9px] font-bold text-white"
						style="background-color: var(--emerald-500);"
					>
						{filtrosActivos}
					</span>
				{/if}
				{#if configsActivas.length > 0}
					<span
						class="ml-1 inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold"
						style="color: #047857;"
					>
						{configsActivas.length}/{totalConfigsDisponibles} visibles
					</span>
				{:else if !loadingConfigs}
					<span
						class="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold"
						style="color: #b45309;"
						title="Ninguna configuración de bonos está marcada como visible para el año del rango. Abre el modal de configuración para activarlas."
					>
						⚠ {totalConfigsDisponibles === 0 ? 'sin configs activas' : 'todas ocultas'}
					</span>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<div class="relative">
					<svg
						class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						type="text"
						bind:value={searchTerm}
						oninput={handleSearch}
						placeholder="Buscar conductor, placa, cliente…"
						class="input-glow apple-transition w-64 rounded-xl border border-gray-200 bg-white py-1.5 pr-3 pl-8 text-xs"
						style="color: var(--text-primary);"
					/>
				</div>
				<button
					onclick={() => cargarDatos()}
					class="apple-transition flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
					style="color: var(--text-secondary);"
				>
					<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
					Actualizar
				</button>
				<button
					onclick={guardarBonos}
					disabled={!canManageBonos || guardandoBonos || cambiosPendientes.total === 0}
					class="apple-hover apple-transition flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
					style="background: {cambiosPendientes.total > 0
						? 'linear-gradient(135deg, #f59e0b, #d97706)'
						: 'linear-gradient(135deg, var(--emerald-500), var(--emerald-600))'};"
					title={!canManageBonos
						? 'No tienes el permiso bonos-planilla'
						: cambiosPendientes.total === 0
							? 'No hay cambios pendientes'
							: `Tienes ${cambiosPendientes.total} cambio${cambiosPendientes.total === 1 ? '' : 's'} pendiente${cambiosPendientes.total === 1 ? '' : 's'}`}
				>
					{#if guardandoBonos}
						<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/>
							<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
						</svg>
						Guardando…
					{:else if cambiosPendientes.total > 0}
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
						</svg>
						<span class="relative">
							{cambiosPendientes.porCrear > 0 && cambiosPendientes.porEliminar > 0
								? 'Guardar cambios'
								: cambiosPendientes.porCrear > 0
									? 'Guardar nuevos'
									: 'Guardar bajas'}
						</span>
						<span class="ml-0.5 inline-flex items-center gap-1 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">
							<span class="relative flex h-1.5 w-1.5">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75"></span>
								<span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-white"></span>
							</span>
							{cambiosPendientes.total}
						</span>
					{:else}
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
						Guardar bonos
						{#if stats.totalChecks > 0}
							<span
								class="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold"
								title="Bonos ya guardados en este rango"
							>
								{stats.totalChecks}
							</span>
						{/if}
					{/if}
				</button>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
			<label class="block">
				<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
					Desde
				</span>
				<input
					type="date"
					bind:value={filtroDesde}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
				/>
			</label>
			<label class="block">
				<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
					Hasta
				</span>
				<input
					type="date"
					bind:value={filtroHasta}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
				/>
			</label>
			<label class="block">
				<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
					Conductor
				</span>
				<select
					bind:value={filtroConductor}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
				>
					<option value="">Todos</option>
					{#each opcionesConductores as o}
						<option value={o.value}>{o.label}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
					Placa
				</span>
				<select
					bind:value={filtroPlaca}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
				>
					<option value="">Todas</option>
					{#each opcionesPlacas as p}
						<option value={p}>{p}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
					Cliente
				</span>
				<select
					bind:value={filtroCliente}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
				>
					<option value="">Todos</option>
					{#each opcionesClientes as c}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
					Recorrido
				</span>
				<select
					bind:value={filtroRecorrido}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
				>
					<option value="">Todos</option>
					{#each opcionesRecorridos as r}
						<option value={r}>{r}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
					Hora desde
				</span>
				<input
					type="time"
					bind:value={filtroHoraDesde}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
				/>
			</label>
			<label class="block">
				<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
					Hora hasta
				</span>
				<input
					type="time"
					bind:value={filtroHoraHasta}
					class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
				/>
			</label>
		</div>

		{#if filtrosActivos > 0}
			<div class="flex justify-end">
				<button
					onclick={limpiarFiltros}
					class="apple-transition text-[10px] font-medium hover:underline"
					style="color: var(--text-muted);"
				>
					Limpiar filtros
				</button>
			</div>
		{/if}

	</div>

	<!-- ═══ STATS ═══ -->
	<div class="grid flex-shrink-0 grid-cols-2 gap-2 lg:grid-cols-5" in:fly={{ y: 8, duration: 250 }}>
		<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-3">
			<p class="text-[10px] font-medium uppercase tracking-wide" style="color: var(--text-muted);">
				Días laborados
			</p>
			<p class="mt-0.5 text-xl font-bold tabular-nums" style="color: var(--bg-charcoal);">
				{stats.diasUnicos}
			</p>
		</div>
		<div class="glass soft-shadow rounded-xl border border-orange-200/50 p-3" style="border-top: 3px solid #ea580c">
			<p class="text-[10px] font-medium uppercase tracking-wide" style="color: var(--text-muted);">
				Recorridos
			</p>
			<p class="mt-0.5 text-xl font-bold tabular-nums" style="color: #ea580c;">
				{stats.totalRecorridos}
			</p>
		</div>
		<div class="glass soft-shadow rounded-xl border border-blue-200/50 p-3" style="border-top: 3px solid #2563eb">
			<p class="text-[10px] font-medium uppercase tracking-wide" style="color: var(--text-muted);">
				Horas conducidas
			</p>
			<p class="mt-0.5 text-xl font-bold tabular-nums" style="color: #1d4ed8;">
				{stats.totalHoras.toFixed(1)}h
			</p>
		</div>
		<div class="glass soft-shadow rounded-xl border border-amber-200/50 p-3" style="border-top: 3px solid {cambiosPendientes.total > 0 ? '#d97706' : '#ea580c'}">
			<p class="text-[10px] font-medium uppercase tracking-wide" style="color: var(--text-muted);">
				Bonos marcados
			</p>
			<p class="mt-0.5 text-xl font-bold tabular-nums" style="color: {cambiosPendientes.total > 0 ? '#b45309' : '#ea580c'};">
				{stats.totalChecks}
			</p>
			{#if cambiosPendientes.total > 0}
				<p class="text-[9px] font-semibold tabular-nums" style="color: #d97706;">
					↳ {cambiosPendientes.total} sin guardar
				</p>
			{:else if stats.totalChecks > 0}
				<p class="text-[9px] font-semibold" style="color: #ea580c;">
					✓ sincronizado
				</p>
			{/if}
		</div>
		<div class="glass soft-shadow rounded-xl border border-orange-200/50 p-3" style="border-top: 3px solid #047857">
			<p class="text-[10px] font-medium uppercase tracking-wide" style="color: var(--text-muted);">
				Total a pagar
			</p>
			<p class="mt-0.5 text-xl font-bold tabular-nums" style="color: #047857;">
				${formatCOP(stats.totalPagar)}
			</p>
			<p class="text-[9px] font-medium" style="color: var(--text-muted);">
				sumando {stats.totalChecks} bonos
			</p>
		</div>
	</div>

	<!-- ═══ LEYENDA DE CONFIGURACIONES ═══ -->
	{#if totalConfigsDisponibles > 0 && configsActivas.length === 0}
		<div
			class="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px]"
			style="color: #92400e;"
		>
			<div class="flex items-center gap-2">
				<svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
				</svg>
				<p>
					Hay <strong>{totalConfigsDisponibles}</strong> configuración{totalConfigsDisponibles === 1 ? '' : 'es'} activa{totalConfigsDisponibles === 1 ? '' : 's'}
					para {anioConfigs}, pero todas están ocultas. Abre <strong>Configurar columnas</strong>
					para decidir cuáles se exponen.
				</p>
			</div>
			{#if canManageBonos}
				<button
					type="button"
					onclick={() => (modalConfigOpen = true)}
					class="apple-transition rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-semibold hover:bg-amber-50"
					style="color: #92400e;"
				>
					Configurar ahora
				</button>
			{/if}
		</div>
	{:else if configsActivas.length > 0}
		<div
			class="flex flex-shrink-0 flex-wrap items-center gap-2 rounded-xl border border-gray-200/50 bg-white/60 px-3 py-2 text-[10px]"
			style="color: var(--text-muted);"
		>
			<span class="font-semibold uppercase tracking-wide">Bonos:</span>
			{#each configsActivas as cfg (cfg.id)}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold"
					style="background: rgba(249, 115, 22, 0.06); color: #047857; border-color: rgba(249, 115, 22, 0.25);"
					title={cfg.nombre}
				>
					{cfg.nombre} · ${formatCOP(Number(cfg.valor) || 0)}
				</span>
			{/each}
			<span class="ml-auto">
				{stats.totalChecks} marcado{stats.totalChecks === 1 ? '' : 's'}
			</span>
			{#if canManageBonos && cambiosPendientes.total > 0}
				<span
					class="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
					style="background: linear-gradient(135deg, #f59e0b, #d97706);"
					title="Cambios aún no guardados en la BD"
				>
					{cambiosPendientes.total} pendiente{cambiosPendientes.total === 1 ? '' : 's'}
				</span>
				<button onclick={limpiarBonos} class="text-[10px] font-medium text-red-600 hover:underline">
					Descartar cambios
				</button>
			{/if}
		</div>
	{/if}

	<!-- ═══ BANNER READ-ONLY ═══ -->
	{#if !canManageBonos}
		<div
			class="flex flex-shrink-0 items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/80 px-3 py-2 text-[11px]"
			style="color: #92400e;"
		>
			<svg class="mt-0.5 h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
			</svg>
			<p>
				<strong>Modo solo lectura.</strong> Puedes revisar los bonos otorgados, pero no
				marcarlos ni guardarlos. Solicita a un administrador el permiso
				<strong>bonos-planilla</strong> desde la página de Usuarios.
			</p>
		</div>
	{/if}

	<!-- ═══ TABLA CANVAS (estilo CanvasServicios) ═══ -->
	<div
		class="glass soft-shadow flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/50"
	>
		<!-- Header del canvas -->
		<div
			class="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-5 py-3"
		>
			<div class="flex items-center gap-3">
				<span class="eyebrow">Modo Canvas · Recorridos</span>
				<span
					class="font-mono-meta text-[10px] text-[#6B6B6B]"
					style="text-transform: none; letter-spacing: 0.04em;"
				>
					{#if loading}
						Cargando…
					{:else}
						{filasFiltradas.length} recorrido{filasFiltradas.length === 1 ? '' : 's'} ·
						{configsActivas.length} columna{configsActivas.length === 1 ? '' : 's'} de bonos
						{#if totalConfigsDisponibles > configsActivas.length}
							· {totalConfigsDisponibles - configsActivas.length} oculta{totalConfigsDisponibles - configsActivas.length === 1 ? '' : 's'}
						{/if}
					{/if}
				</span>
			</div>

			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => (modalConfigOpen = true)}
					class="apple-transition flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-[11px] font-semibold"
					style="border-color: var(--border-default); color: var(--text-secondary);"
					title="Configurar qué items de bonos se exponen como columna en Recorridos (decisión global por año)"
				>
					<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
						/>
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
					Configurar columnas
				</button>
			</div>
		</div>

		{#if loading}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
				<div class="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
				<p class="text-sm" style="color: var(--text-muted);">Cargando recorridos…</p>
			</div>
		{:else if filasFiltradas.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
				<div
					class="flex h-14 w-14 items-center justify-center rounded-2xl"
					style="background-color: var(--bg-base);"
				>
					<svg class="h-7 w-7" style="color: var(--text-very-muted);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
					</svg>
				</div>
				<div>
					<h3 class="mb-1 font-display text-base" style="color: var(--bg-charcoal);">
						Sin recorridos en este rango
					</h3>
					<p class="text-xs" style="color: var(--text-muted);">
						No se encontraron días laborados con los filtros aplicados.
					</p>
				</div>
				{#if filtrosActivos > 0 || filtroDesde !== rangoPorDefecto().desde || filtroHasta !== rangoPorDefecto().hasta}
					<button onclick={limpiarFiltros} class="apple-transition rounded-xl bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700">
						Limpiar filtros
					</button>
				{/if}
			</div>
		{:else}
			<div class="relative min-h-0 flex-1 overflow-auto" style="background-color: #ffffff;">
				<table
					class="border-collapse text-[12px] text-[#1A1A1A]"
					style="min-width: {totalAnchoTabla}px;"
				>
					<thead class="sticky top-0 z-20">
						<tr>
							<th
								class="border-b border-r border-[rgba(0,0,0,0.08)] bg-white px-3 py-2.5 text-left align-bottom"
								style="min-width: {COL_ANCHOS.fecha}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#6B6B6B]">Fecha</span>
							</th>
							<th
								class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-3 py-2.5 text-left align-bottom"
								style="min-width: {COL_ANCHOS.conductor}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#6B6B6B]">Conductor</span>
							</th>
							<th
								class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-3 py-2.5 text-center align-bottom"
								style="min-width: {COL_ANCHOS.orden}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#6B6B6B]">#</span>
							</th>
							<th
								class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-3 py-2.5 text-left align-bottom"
								style="min-width: {COL_ANCHOS.placa}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#6B6B6B]">Placa</span>
							</th>
							<th
								class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-3 py-2.5 text-left align-bottom"
								style="min-width: {COL_ANCHOS.cliente}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#6B6B6B]">Cliente / Recorrido</span>
							</th>
							<th
								class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-3 py-2.5 text-left align-bottom"
								style="min-width: {COL_ANCHOS.horario}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#6B6B6B]">Horario</span>
							</th>
							<th
								class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-3 py-2.5 text-right align-bottom"
								style="min-width: {COL_ANCHOS.horas}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#6B6B6B]">Horas</span>
							</th>
							<th
								class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-3 py-2.5 text-right align-bottom"
								style="min-width: {COL_ANCHOS.km}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#6B6B6B]">KM</span>
							</th>
							<th
								class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-3 py-2.5 text-center align-bottom"
								style="min-width: {COL_ANCHOS.pernocte}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#6B6B6B]">Pernocte</span>
							</th>
							{#each configsActivas as cfg (cfg.id)}
								<th
									class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-2 py-2.5 text-center align-bottom"
									style="min-width: {COL_ANCHOS.bono}px;"
									title={cfg.nombre}
								>
									<div class="flex flex-col items-center gap-0.5">
										<span class="font-mono-meta text-[9px] uppercase tracking-wide text-[#047857]">
											{cfg.nombre}
										</span>
										<span class="font-mono-meta text-[9px] text-[#6B6B6B]" style="text-transform: none;">
											${formatCOP(Number(cfg.valor) || 0)}
										</span>
									</div>
								</th>
							{/each}
							<th
								class="border-b border-r border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-3 py-2.5 text-left align-bottom"
								style="min-width: {COL_ANCHOS.valorPagar}px;"
							>
								<span class="font-mono-meta text-[10px] uppercase tracking-wide text-[#047857]">
									Valor a pagar
								</span>
							</th>
						</tr>
					</thead>

					<tbody>
						{#each filasPaginadas as fila, idx (fila.segmento?.id ?? `placeholder-${fila.registro.id}`)}
							{@const reg = fila.registro}
							{@const seg = fila.segmento}
							{@const segId = seg?.id ?? null}
							{@const fLarga = formatFechaLarga(reg.fecha)}
							{@const textoValor = valorPagarTexto(reg.id, segId)}
							{@const totalValor = valorPagarTotal(reg.id, segId)}
							{@const tieneBono = totalValor > 0}
							<tr
								class="border-b border-[rgba(0,0,0,0.04)] align-top"
								style="background-color: {tieneBono ? 'rgba(249, 115, 22, 0.04)' : 'white'};"
								in:fade={{ duration: 150, delay: Math.min(idx * 8, 200) }}
							>
								<!-- Fecha (sticky left) -->
								<td
									class="border-r border-[rgba(0,0,0,0.08)] px-3 py-2 align-top"
									style="min-width: {COL_ANCHOS.fecha}px; background-color: {tieneBono ? 'rgba(249, 115, 22, 0.04)' : 'white'};"
								>
									<p class="text-xs font-semibold capitalize" style="color: var(--text-primary);">
										{fLarga.diaSemana}
									</p>
									<p class="text-[11px] font-medium tabular-nums" style="color: var(--text-secondary);">
										{fLarga.dia} {fLarga.mes.slice(0, 3)} {fLarga.anio}
									</p>
								</td>
								<!-- Conductor -->
								<td
									class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 align-top"
									style="min-width: {COL_ANCHOS.conductor}px;"
								>
									<p class="truncate text-xs font-semibold" style="color: var(--text-primary);" title={nombreConductor(reg.conductor)}>
										{nombreConductor(reg.conductor)}
									</p>
									{#if reg.conductor?.numero_identificacion}
										<p class="font-mono text-[9px]" style="color: var(--text-very-muted);">
											CC {reg.conductor.numero_identificacion}
										</p>
									{/if}
								</td>
								<!-- # tramo -->
								<td
									class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 text-center align-top"
									style="min-width: {COL_ANCHOS.orden}px;"
								>
									{#if seg}
										<span class="font-mono text-[10px] font-semibold" style="color: var(--text-very-muted);">
											#{seg.orden}
										</span>
									{:else}
										<span class="font-mono text-[10px]" style="color: var(--text-very-muted);">—</span>
									{/if}
								</td>
								<!-- Placa -->
								<td
									class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 align-top"
									style="min-width: {COL_ANCHOS.placa}px;"
								>
									{#if seg}
										<span
											class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold"
											style="background-color: rgba(249, 115, 22, 0.06); color: #047857; border-color: rgba(249, 115, 22, 0.25);"
										>
											🚚 {seg.vehiculo_placa}
										</span>
									{:else if reg.tipo === 'MANTENIMIENTO' && reg.mantenimiento_vehiculo_placa}
										<!-- Un día de taller no tiene tramo, pero sí vehículo: es justo el
											 dato por el que se consulta esta fila. -->
										<span class="font-mono text-[10px] font-semibold" style="color: #b91c1c;">
											🔧 {reg.mantenimiento_vehiculo_placa}
										</span>
									{:else}
										<span class="text-[10px]" style="color: var(--text-very-muted);">—</span>
									{/if}
								</td>
								<!-- Cliente -->
								<td
									class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 align-top"
									style="min-width: {COL_ANCHOS.cliente}px; max-width: 220px;"
								>
									{#if seg}
										<p class="truncate text-xs font-medium" style="color: var(--text-primary);" title={seg.cliente_nombre || ''}>
											{seg.cliente_nombre || '—'}
										</p>
									{:else}
										<span class="inline-flex items-center gap-1.5 text-[10px] font-semibold italic" style="color: #b45309;">
											Sin tramos registrados
										</span>
									{/if}
								</td>
								<!-- Horario -->
								<td
									class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 align-top"
									style="min-width: {COL_ANCHOS.horario}px;"
								>
									{#if seg}
										<p class="font-mono text-[11px] font-semibold tabular-nums" style="color: var(--text-primary);">
											{seg.hora_inicio}–{seg.hora_fin}
										</p>
									{:else}
										<span class="text-[10px]" style="color: var(--text-very-muted);">—</span>
									{/if}
								</td>
								<!-- Horas -->
								<td
									class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 text-right align-top"
									style="min-width: {COL_ANCHOS.horas}px;"
								>
									{#if seg}
										<p class="text-xs font-bold tabular-nums" style="color: var(--text-primary);">
											{Number(seg.horas_conducidas || 0).toFixed(1)}h
										</p>
									{:else}
										<p class="text-xs" style="color: var(--text-very-muted);">—</p>
									{/if}
								</td>
								<!-- KM (inicial → final) -->
								<td
									class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 text-right align-top"
									style="min-width: {COL_ANCHOS.km}px;"
								>
									{#if seg && (seg.km_inicial != null || seg.km_final != null)}
										<p class="font-mono text-[10px] font-semibold tabular-nums" style="color: var(--text-secondary);">
											{seg.km_inicial != null ? formatCOP(seg.km_inicial) : '—'}
										</p>
										<p class="font-mono text-[10px] tabular-nums" style="color: var(--text-very-muted);">
											→
										</p>
										<p class="font-mono text-[10px] font-semibold tabular-nums" style="color: var(--text-primary);">
											{seg.km_final != null ? formatCOP(seg.km_final) : '—'}
										</p>
									{:else}
										<p class="text-[10px]" style="color: var(--text-very-muted);">—</p>
									{/if}
								</td>
								<!-- Pernocte -->
								<td
									class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 text-center align-top"
									style="min-width: {COL_ANCHOS.pernocte}px;"
								>
									{#if seg}
										<span
											class="inline-block rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider"
											style:background-color={seg.pernocte ? 'rgba(194, 65, 12, 0.10)' : 'rgba(107, 114, 128, 0.10)'}
											style:color={seg.pernocte ? '#c2410c' : '#4b5563'}
										>
											{seg.pernocte ? 'SÍ' : 'NO'}
										</span>
									{:else}
										<span class="text-[10px]" style="color: var(--text-very-muted);">—</span>
									{/if}
								</td>
								<!-- Columnas dinámicas: 1 por config activa -->
								{#each configsActivas as cfg (cfg.id)}
									{@const checked = isChecked(cfg.id, reg.id, segId)}
									<td
										class="border-r border-[rgba(0,0,0,0.04)] px-2 py-2 text-center align-top"
										style="min-width: {COL_ANCHOS.bono}px;"
									>
										<button
											type="button"
											onclick={() => toggleBono(cfg.id, reg.id, segId)}
											disabled={!canManageBonos}
											class="apple-transition inline-flex h-6 w-6 items-center justify-center rounded-md border-2 disabled:cursor-not-allowed disabled:opacity-60"
											style:background-color={checked ? '#f97316' : 'white'}
											style:border-color={checked ? '#f97316' : '#d1d5db'}
											style:color={checked ? 'white' : 'transparent'}
											aria-label="Aplicar bono: {cfg.nombre}"
											title={canManageBonos
												? `Aplicar ${cfg.nombre} ($${formatCOP(Number(cfg.valor) || 0)})`
												: 'Solo lectura: no tienes el permiso bonos-planilla'}
										>
											{#if checked}
												<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
													<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
												</svg>
											{/if}
										</button>
									</td>
								{/each}
								<!-- Valor a pagar -->
								<td
									class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 align-top"
									style="min-width: {COL_ANCHOS.valorPagar}px;"
								>
									{#if textoValor === '—'}
										<span class="text-[#C7C7C7]">—</span>
									{:else}
										<p
											class="font-mono text-[11px] font-semibold tabular-nums leading-tight"
											style="color: #047857;"
											title={textoValor}
										>
											{textoValor}
										</p>
										{#if textoValor.includes('+')}
											{@const count = textoValor.split('+').length}
											<p class="font-mono text-[9px] tabular-nums" style="color: var(--text-very-muted);">
												{count} ítem{count === 1 ? '' : 's'}
											</p>
										{/if}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Footer del canvas -->
			<div
				class="flex flex-shrink-0 items-center justify-between border-t border-[rgba(0,0,0,0.06)] bg-[#FAF7F2] px-5 py-2.5"
			>
				<p
					class="font-mono-meta text-[10px] text-[#6B6B6B]"
					style="text-transform: none; letter-spacing: 0.04em;"
				>
					Modo Canvas · {configsActivas.length}/{totalConfigsDisponibles} columna{configsActivas.length === 1 ? '' : 's'} de bonos · scroll horizontal
				</p>
				<p
					class="font-mono-meta text-[10px] text-[#10B981]"
					style="text-transform: none; letter-spacing: 0.04em;"
				>
					{filasPaginadas.length}/{filasFiltradas.length} recorridos · Total a pagar: ${formatCOP(stats.totalPagar)}
				</p>
			</div>

			{#if totalPages > 1}
				<div
					class="flex flex-shrink-0 items-center justify-between border-t border-gray-100 px-4 py-3"
					style="background-color: var(--bg-base);"
				>
					<p class="text-[11px]" style="color: var(--text-muted);">
						Mostrando
						<span class="font-semibold" style="color: var(--text-primary);">
							{(pagination.page - 1) * pagination.limit + 1}–{Math.min(
								pagination.page * pagination.limit,
								pagination.total
							)}
						</span>
						de
						<span class="font-semibold" style="color: var(--text-primary);">
							{pagination.total}
						</span>
						recorridos
					</p>
					<div class="flex items-center gap-1">
						<button
							onclick={() => irPagina(pagination.page - 1)}
							disabled={pagination.page === 1}
							class="apple-transition rounded-lg border border-gray-200 bg-white p-1.5 hover:bg-gray-50 disabled:opacity-40"
							style="color: var(--text-secondary);"
							aria-label="Página anterior"
						>
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
							</svg>
						</button>
						{#each Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
							const start = Math.max(1, Math.min(pagination.page - 2, totalPages - 4));
							return start + i;
						}) as p}
							<button
								onclick={() => irPagina(p)}
								class="apple-transition min-w-[1.75rem] rounded-lg border px-2 py-0.5 text-[11px] font-semibold"
								style:border-color={pagination.page === p ? 'var(--emerald-500)' : 'var(--border-default)'}
								style:background-color={pagination.page === p ? 'var(--emerald-500)' : 'white'}
								style:color={pagination.page === p ? 'white' : 'var(--text-secondary)'}
							>
								{p}
							</button>
						{/each}
						<button
							onclick={() => irPagina(pagination.page + 1)}
							disabled={pagination.page === totalPages}
							class="apple-transition rounded-lg border border-gray-200 bg-white p-1.5 hover:bg-gray-50 disabled:opacity-40"
							style="color: var(--text-secondary);"
							aria-label="Página siguiente"
						>
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
							</svg>
						</button>
					</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- ═══ MODAL: configuración de visibilidad de bonos ═══ -->
	<ModalConfigBonos
		open={modalConfigOpen}
		anio={anioConfigs}
		{canManageBonos}
		onclose={() => (modalConfigOpen = false)}
		onsaved={onConfigBonosSaved}
	/>
</div>
