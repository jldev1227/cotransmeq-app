<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fly, fade, scale } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { toast } from 'svelte-sonner';
	import {
		apiClient,
		conductoresSelectAPI,
		diasLaboradosAPI,
		type SegmentoPatron,
		type PatronRecorrido,
		type TipoDia
	} from '$lib/api/apiClient';

	// ═══════════════════════════════════════════════════════
	//  PROPS
	// ═══════════════════════════════════════════════════════
	type Props = {
		open: boolean;
		/** Conductor preseleccionado (ej: cuando se navega con `?conductor=…`) */
		conductorIdInicial?: string;
		mesInicial?: number;
		anioInicial?: number;
		onsaved?: () => void;
		onclose: () => void;
	};

	let {
		open,
		conductorIdInicial,
		mesInicial,
		anioInicial,
		onsaved,
		onclose
	}: Props = $props();

	// ═══════════════════════════════════════════════════════
	//  TIPOS Y ESTADO
	// ═══════════════════════════════════════════════════════
	const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
	const MESES = [
		'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
		'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
	];

	interface Cliente {
		id: string;
		nombre: string;
		nit?: string;
	}

	interface Vehiculo {
		id: string;
		placa: string;
		marca?: string;
		linea?: string;
		modelo?: number;
		conductor_id?: string | null;
	}

	interface Patron {
		idLocal: string;
		tipo: TipoDia;
		color: string;
		vehiculo_id: string | null;
		vehiculo_placa: string;
		cliente_id: string | null;
		cliente_nombre: string;
		hora_inicio: string;
		hora_fin: string;
		horas_conducidas: number;
		km_inicial: number | null;
		km_final: number | null;
		pernocte: boolean;
		observaciones: string;
		fechas: Set<string>;
	}

	// Paleta semántica por TIPO de día. Misma convención que CalendarDiasLaborados
	// y TablaDiasLaborados para que el sistema se lea igual en todos lados.
	const COLOR_POR_TIPO: Record<TipoDia, { bg: string; text: string; border: string; light: string; label: string; dot: string }> = {
		LABORADO:      { bg: '#ea580c', text: '#c2410c', border: '#ea580c50', light: '#d1fae5', label: 'Laborado',      dot: '#ea580c' },
		DISPONIBLE:    { bg: '#2563eb', text: '#1d4ed8', border: '#2563eb50', light: '#dbeafe', label: 'Disponible',    dot: '#2563eb' },
		DESCANSO:      { bg: '#d97706', text: '#b45309', border: '#d9770650', light: '#fed7aa', label: 'Descanso',      dot: '#d97706' },
		MANTENIMIENTO: { bg: '#dc2626', text: '#b91c1c', border: '#dc262650', light: '#fecaca', label: 'Mantenimiento', dot: '#dc2626' }
	};

	const TIPOS_DIA: TipoDia[] = ['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO'];

	// Devuelve la "configuración de campos" según el tipo de patrón.
	// Centraliza la lógica de qué se muestra en el form.
	function camposParaTipo(t: TipoDia) {
		switch (t) {
			case 'LABORADO':
				return {
					requierePlaca: true,
					requiereCliente: true,
					requiereHorario: true,
					requiereHorasConducidas: true,
					requiereKm: true,
					requierePernocte: true
				};
			case 'DISPONIBLE':
				return {
					requierePlaca: false,
					requiereCliente: false,
					requiereHorario: true,
					requiereHorasConducidas: false,
					requiereKm: false,
					requierePernocte: true
				};
			case 'MANTENIMIENTO':
				// La placa es lo único que se pide, y es obligatoria: un día de
				// taller sin vehículo no se puede auditar contra la flota.
				return {
					requierePlaca: true,
					requiereCliente: false,
					requiereHorario: false,
					requiereHorasConducidas: false,
					requiereKm: false,
					requierePernocte: false
				};
			case 'DESCANSO':
			default:
				return {
					requierePlaca: false,
					requiereCliente: false,
					requiereHorario: false,
					requiereHorasConducidas: false,
					requiereKm: false,
					requierePernocte: false
				};
		}
	}

	const hoy = new Date();
	let mes = $state(mesInicial ?? hoy.getMonth() + 1);
	let anio = $state(anioInicial ?? hoy.getFullYear());

	// ═══ SELECCIÓN DE CONDUCTOR (interna al modal) ═══
	// Patrón autocomplete: input con búsqueda + dropdown con
	// resultados, navegación con teclado, chip del seleccionado
	// con botón para cambiar. Igual al usado en ModalFormRecargo.
	interface ConductorItem {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion?: string;
		estado?: string;
	}
	let listaConductores = $state<ConductorItem[]>([]);
	let loadingConductores = $state(false);
	let searchConductor = $state('');
	let conductorSeleccionadoId = $state<string>(conductorIdInicial ?? '');
	let showConductorDropdown = $state(false);
	let highlightConductor = $state(0);

	// Helper: scroll al item resaltado del dropdown
	async function scrollHighlightedIntoView(containerId: string, index: number) {
		await tick();
		const container = document.getElementById(containerId);
		if (!container) return;
		const items = container.querySelectorAll('[data-dropdown-item]');
		if (items[index]) (items[index] as HTMLElement).scrollIntoView({ block: 'nearest' });
	}

	// Conductores filtrados por la búsqueda.
	// El backend ya los entrega ordenados A-Z por nombre, pero
	// reordenamos en el cliente por si el orden no viene.
	const MAX_VISIBLE_SIN_BUSQUEDA = 30;

	// Normaliza texto: minúsculas + sin acentos (Cárdenas == cardenas)
	function norm(s: string): string {
		return (s ?? '')
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');
	}

	let conductoresFiltrados = $derived.by(() => {
		// Búsqueda por TOKENS: cada palabra del término debe aparecer
		// en el blob (no necesariamente consecutivas).
		// Ej: "francisco cardenas" matchea "Francisco Javier Cardenas".
		const tokens = norm(searchConductor.trim())
			.split(/\s+/)
			.filter(Boolean);
		let lista = listaConductores;
		if (tokens.length > 0) {
			lista = lista.filter((c) => {
				const blob = norm(
					[c.nombre, c.apellido, c.numero_identificacion].filter(Boolean).join(' ')
				);
				return tokens.every((t) => blob.includes(t));
			});
		}
		// Asegurar A-Z por nombre, apellido en el cliente
		return [...lista].sort((a, b) => {
			const an = norm(a.nombre);
			const bn = norm(b.nombre);
			if (an !== bn) return an.localeCompare(bn, 'es');
			return norm(a.apellido).localeCompare(norm(b.apellido), 'es');
		});
	});

	// Cuando hay búsqueda, mostrar TODOS los matches (con scroll).
	// Cuando NO hay búsqueda, cap a MAX_VISIBLE_SIN_BUSQUEDA para no abrumar.
	let conductoresVisibles = $derived.by(() => {
		if (searchConductor.trim()) return conductoresFiltrados;
		return conductoresFiltrados.slice(0, MAX_VISIBLE_SIN_BUSQUEDA);
	});
	let hayMasConductores = $derived(
		!searchConductor.trim() &&
			conductoresFiltrados.length > MAX_VISIBLE_SIN_BUSQUEDA
	);
	let hayBusquedaActiva = $derived(searchConductor.trim().length > 0);

	// Mantener highlight en 0 al cambiar la búsqueda
	$effect(() => {
		void searchConductor;
		highlightConductor = 0;
	});

	function seleccionarConductor(c: ConductorItem) {
		conductorSeleccionadoId = c.id;
		showConductorDropdown = false;
		highlightConductor = 0;
		searchConductor = '';
	}

	function limpiarConductor() {
		conductorSeleccionadoId = '';
		searchConductor = '';
		highlightConductor = 0;
		showConductorDropdown = false;
	}

	function handleConductorKeydown(e: KeyboardEvent) {
		if (!showConductorDropdown || conductoresVisibles.length === 0) return;
		const len = conductoresVisibles.length;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightConductor = (highlightConductor + 1) % len;
			scrollHighlightedIntoView('dropdown-conductor-modal', highlightConductor);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightConductor = (highlightConductor - 1 + len) % len;
			scrollHighlightedIntoView('dropdown-conductor-modal', highlightConductor);
		} else if (e.key === 'Enter' && highlightConductor >= 0) {
			e.preventDefault();
			const sel = conductoresVisibles[highlightConductor];
			if (sel) seleccionarConductor(sel);
		} else if (e.key === 'Escape') {
			showConductorDropdown = false;
			highlightConductor = 0;
		}
	}

	// Iniciales para avatar del dropdown
	function iniciales(nombre: string, apellido: string): string {
		const n = nombre?.[0] ?? '?';
		const a = apellido?.[0] ?? '?';
		return (n + a).toUpperCase();
	}

	let conductorActual = $derived.by(() => {
		const c = listaConductores.find((x) => x.id === conductorSeleccionadoId);
		if (!c) return null;
		return c;
	});

	let clientes = $state<Cliente[]>([]);
	let vehiculos = $state<Vehiculo[]>([]);
	let loadingDatos = $state(false);

	let patrones = $state<Patron[]>([]);
	let patronActivoId = $state<string>('');

	let guardando = $state(false);
	let cargaInicial = $state(true);

	// ═══════════════════════════════════════════════════════
	//  HELPERS
	// ═══════════════════════════════════════════════════════
	function uid(): string {
		return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
	}

	function fmtDia(anio: number, mes: number, dia: number): string {
		return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
	}

	function diasDelMes(m: number, a: number): (number | null)[] {
		const primer = new Date(a, m - 1, 1).getDay();
		const total = new Date(a, m, 0).getDate();
		const dias: (number | null)[] = Array(primer).fill(null);
		for (let i = 1; i <= total; i++) dias.push(i);
		while (dias.length % 7 !== 0) dias.push(null);
		return dias;
	}

	function esFuturo(anio: number, mes: number, dia: number): boolean {
		const d = new Date(anio, mes - 1, dia);
		d.setHours(0, 0, 0, 0);
		const h = new Date();
		h.setHours(0, 0, 0, 0);
		return d > h;
	}

	function fmtHoras(hi: string, hf: string): number {
		if (!hi || !hf) return 0;
		const [h1, m1] = hi.split(':').map(Number);
		const [h2, m2] = hf.split(':').map(Number);
		const mins = h2 * 60 + m2 - (h1 * 60 + m1);
		return mins > 0 ? Math.round((mins / 60) * 10) / 10 : 0;
	}

	function colorPatron(idx: number, tipo?: TipoDia) {
		// Si nos pasan el tipo, devolvemos el color semántico por tipo.
		// Si no, caemos al índice (compatibilidad con llamadas existentes).
		if (tipo) return COLOR_POR_TIPO[tipo];
		return COLOR_POR_TIPO.LABORADO;
	}

	/**
	 * Comprime una lista de días del mes en rangos legibles.
	 *   [14,15,16]      → "14-16"
	 *   [14,15,17]      → "14-15, 17"
	 *   [1,2,3,5,7,8,9] → "1-3, 5, 7-9"
	 */
	function comprimirRangoDias(dias: number[]): string {
		const sorted = [...dias].sort((a, b) => a - b);
		if (sorted.length === 0) return '';
		const rangos: string[] = [];
		let i = 0;
		while (i < sorted.length) {
			let j = i;
			while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
			if (j > i) rangos.push(`${sorted[i]}-${sorted[j]}`);
			else rangos.push(`${sorted[i]}`);
			i = j + 1;
		}
		return rangos.join(', ');
	}

	/**
	 * Devuelve un texto humano para los días de un tipo:
	 *   "se registrarán como LABORADO los días 14-16 (3)"
	 *   "se registrarán como DESCANSO los días 1-3, 5, 7-9 (6)"
	 */
	function descripcionDias(tipo: TipoDia, dias: number[]): string {
		const rango = comprimirRangoDias(dias);
		const label = COLOR_POR_TIPO[tipo].label.toLowerCase();
		const n = dias.length;
		if (n === 0) return '';
		return `Se registrarán como ${label} los días ${rango} (${n})`;
	}

	// ═══════════════════════════════════════════════════════
	//  CICLO DE VIDA
	// ═══════════════════════════════════════════════════════
	$effect(() => {
		if (!open) return;
		if (!browser) return;
		// Re-cargar al reabrir
		cargarDatosAuxiliares();
	});

	async function cargarDatosAuxiliares() {
		loadingDatos = true;
		loadingConductores = true;
		cargaInicial = true;
		try {
			const [rClientes, rVehiculos, rConductores] = await Promise.all([
				diasLaboradosAPI.listarClientes(),
				diasLaboradosAPI.listarVehiculos(),
				conductoresSelectAPI
					.listar()
					.catch(() => ({ data: { data: [] as ConductorItem[] } }))
			]);
			clientes = (rClientes.data?.data ?? []) as Cliente[];
			vehiculos = (rVehiculos.data?.data ?? []) as Vehiculo[];
			// El endpoint ya filtra por estado=activo y oculto=false en backend.
			listaConductores = (rConductores.data?.data ?? []) as ConductorItem[];
		} catch (err: any) {
			console.warn('No se pudieron cargar datos auxiliares:', err?.message || err);
			clientes = [];
			vehiculos = [];
			listaConductores = [];
			toast.warning('No se pudieron cargar algunos datos. Puedes escribirlos manualmente.');
		} finally {
			loadingDatos = false;
			loadingConductores = false;
			cargaInicial = false;
		}
	}

	// ═══════════════════════════════════════════════════════
	//  PATRONES
	// ═══════════════════════════════════════════════════════
	function nuevoPatron(tipo: TipoDia = 'LABORADO') {
		const id = uid();
		const defaults = camposParaTipo(tipo);
		const p: Patron = {
			idLocal: id,
			tipo,
			color: COLOR_POR_TIPO[tipo].bg,
			vehiculo_id: null,
			vehiculo_placa: '',
			cliente_id: null,
			cliente_nombre: '',
			hora_inicio: '06:00',
			hora_fin: '18:00',
			horas_conducidas: 12,
			km_inicial: null,
			km_final: null,
			pernocte: false,
			observaciones: '',
			fechas: new Set()
		};
		// Si el tipo no requiere horario, lo dejamos en strings vacíos
		// para que el backend no falle validando.
		if (!defaults.requiereHorario) {
			p.hora_inicio = '';
			p.hora_fin = '';
		}
		patrones = [...patrones, p];
		patronActivoId = id;
		if (defaults.requiereHorario) {
			p.horas_conducidas = fmtHoras(p.hora_inicio, p.hora_fin);
		}
	}

	/**
	 * Cambia el tipo de un patrón existente. Al cambiar:
	 *  - Limpia campos que el nuevo tipo no requiere
	 *  - Conserva fechas y observaciones
	 */
	function cambiarTipoPatron(id: string, nuevoTipo: TipoDia) {
		const p = patrones.find((x) => x.idLocal === id);
		if (!p || p.tipo === nuevoTipo) return;
		const defaults = camposParaTipo(nuevoTipo);

		const cambios: Partial<Patron> = {
			tipo: nuevoTipo,
			color: COLOR_POR_TIPO[nuevoTipo].bg
		};

		// Limpiar campos que ya no aplican
		if (!defaults.requierePlaca) {
			cambios.vehiculo_placa = '';
			cambios.vehiculo_id = null;
		}
		if (!defaults.requiereCliente) {
			cambios.cliente_nombre = '';
			cambios.cliente_id = null;
		}
		if (!defaults.requiereHorario) {
			cambios.hora_inicio = '';
			cambios.hora_fin = '';
		}
		if (!defaults.requiereHorasConducidas) {
			cambios.horas_conducidas = 0;
		}
		if (!defaults.requiereKm) {
			cambios.km_inicial = null;
			cambios.km_final = null;
		}
		if (!defaults.requierePernocte) {
			cambios.pernocte = false;
		}

		actualizarPatron(id, cambios);
	}

	function eliminarPatron(id: string) {
		patrones = patrones.filter((p) => p.idLocal !== id);
		if (patronActivoId === id) {
			patronActivoId = patrones[0]?.idLocal ?? '';
		}
	}

	function patronActivo(): Patron | undefined {
		return patrones.find((p) => p.idLocal === patronActivoId);
	}

	function actualizarPatron(id: string, cambios: Partial<Patron>) {
		patrones = patrones.map((p) => {
			if (p.idLocal !== id) return p;
			return { ...p, ...cambios };
		});
	}

	function onPlacaChange(id: string, placa: string) {
		const v = vehiculos.find((x) => x.placa === placa);
		actualizarPatron(id, {
			vehiculo_placa: placa,
			vehiculo_id: v?.id ?? null
		});
	}

	function onClienteChange(id: string, clienteId: string) {
		const c = clientes.find((x) => x.id === clienteId);
		actualizarPatron(id, {
			cliente_id: clienteId || null,
			cliente_nombre: c?.nombre ?? ''
		});
	}

	// ═══════════════════════════════════════════════════════
	//  CALENDARIO
	// ═══════════════════════════════════════════════════════

	// Para cada día del mes, ¿a qué patrón pertenece? null si no está asignado
	function duenioDelDia(fecha: string): Patron | null {
		for (const p of patrones) {
			if (p.fechas.has(fecha)) return p;
		}
		return null;
	}

	async function toggleDia(dia: number) {
		if (esFuturo(anio, mes, dia)) return;
		const fecha = fmtDia(anio, mes, dia);
		const duenio = duenioDelDia(fecha);
		const activo = patronActivo();

		if (!activo) {
			toast.warning('Primero crea un patrón tocando uno de los estados (Laborado / Disponible / Descanso / Mantenimiento)');
			return;
		}

		if (duenio) {
			// Ya está asignado
			if (duenio.idLocal === activo.idLocal) {
				// Pertenece al patrón activo → lo quitamos
				actualizarPatron(duenio.idLocal, {
					fechas: new Set([...duenio.fechas].filter((f) => f !== fecha))
				});
			} else {
				// Pertenece a OTRO patrón → lo cambiamos de dueño
				const nuevoFechas = new Set(duenio.fechas);
				nuevoFechas.delete(fecha);
				actualizarPatron(duenio.idLocal, { fechas: nuevoFechas });
				actualizarPatron(activo.idLocal, {
					fechas: new Set([...activo.fechas, fecha])
				});
			}
		} else {
			// No está asignado → lo agregamos al patrón activo
			actualizarPatron(activo.idLocal, {
				fechas: new Set([...activo.fechas, fecha])
			});
		}
	}

	function labelPatron(p: Patron): string {
		const tipoLabel = COLOR_POR_TIPO[p.tipo].label;
		const partes: string[] = [tipoLabel];
		if (p.vehiculo_placa) partes.push(p.vehiculo_placa);
		if (p.cliente_nombre) partes.push(p.cliente_nombre);
		return partes.join(' · ');
	}

	// ═══════════════════════════════════════════════════════
	//  ACCIONES RÁPIDAS
	// ═══════════════════════════════════════════════════════
	function aplicarA(mod: 'todos' | 'lv' | 'q1' | 'q2' | 'finde' | 'limpiar') {
		const activo = patronActivo();
		if (!activo) {
			toast.warning('Selecciona un patrón activo o crea uno con los chips de tipo');
			return;
		}
		const total = new Date(anio, mes, 0).getDate();
		const fechas = new Set<string>(activo.fechas);

		for (let d = 1; d <= total; d++) {
			if (esFuturo(anio, mes, d)) continue;
			const dow = new Date(anio, mes - 1, d).getDay();
			const esFinde = dow === 0 || dow === 6;
			const enQ1 = d <= 15;
			const incluir =
				mod === 'todos' ? true :
				mod === 'lv' ? !esFinde :
				mod === 'finde' ? esFinde :
				mod === 'q1' ? enQ1 && !esFuturo(anio, mes, d) :
				mod === 'q2' ? !enQ1 && !esFuturo(anio, mes, d) :
				false;
			if (incluir) {
				fechas.add(fmtDia(anio, mes, d));
			}
		}

		if (mod === 'limpiar') {
			// Limpia SOLO el patrón activo (no toca los demás)
			actualizarPatron(activo.idLocal, { fechas: new Set() });
			return;
		}
		actualizarPatron(activo.idLocal, { fechas });
	}

	function parsearRango(texto: string): number[] {
		// "1-10, 15, 20-25" → [1, 2, ..., 10, 15, 20, ..., 25]
		const nums = new Set<number>();
		const total = new Date(anio, mes, 0).getDate();
		const grupos = texto.split(/[,\s]+/).filter(Boolean);
		for (const g of grupos) {
			if (g.includes('-')) {
				const [a, b] = g.split('-').map((n) => parseInt(n.trim(), 10));
				if (Number.isFinite(a) && Number.isFinite(b)) {
					const lo = Math.max(1, Math.min(a, b));
					const hi = Math.min(total, Math.max(a, b));
					for (let d = lo; d <= hi; d++) nums.add(d);
				}
			} else {
				const n = parseInt(g, 10);
				if (Number.isFinite(n) && n >= 1 && n <= total) nums.add(n);
			}
		}
		return Array.from(nums).sort((a, b) => a - b);
	}

	let rangoTexto = $state('');
	$effect(() => {
		// Mantener rangoTexto sincronizado con el patrón activo
		const activo = patronActivo();
		if (!activo) {
			rangoTexto = '';
			return;
		}
		const dias = Array.from(activo.fechas)
			.map((f) => parseInt(f.slice(8, 10), 10))
			.sort((a, b) => a - b);
		// Comprimir en rangos
		const rangos: string[] = [];
		let i = 0;
		while (i < dias.length) {
			let j = i;
			while (j + 1 < dias.length && dias[j + 1] === dias[j] + 1) j++;
			if (j > i) rangos.push(`${dias[i]}-${dias[j]}`);
			else rangos.push(`${dias[i]}`);
			i = j + 1;
		}
		rangoTexto = rangos.join(', ');
	});

	function aplicarRango() {
		const activo = patronActivo();
		if (!activo) {
			toast.warning('Primero crea un patrón tocando uno de los estados');
			return;
		}
		const dias = parsearRango(rangoTexto);
		if (dias.length === 0) {
			toast.warning('Rango vacío. Ejemplos válidos: 1-10, 15, 20-28');
			return;
		}
		const fechas = new Set<string>();
		for (const d of dias) {
			if (esFuturo(anio, mes, d)) continue;
			fechas.add(fmtDia(anio, mes, d));
		}
		actualizarPatron(activo.idLocal, { fechas });
		const tc = COLOR_POR_TIPO[activo.tipo];
		toast.success(
			`${fechas.size} día${fechas.size === 1 ? '' : 's'} asignado${fechas.size === 1 ? '' : 's'} como ${tc.label}: ${comprimirRangoDias(Array.from(fechas).map((f) => parseInt(f.slice(8, 10), 10)))}`
		);
	}

	// ═══════════════════════════════════════════════════════
	//  RESUMEN
	// ═══════════════════════════════════════════════════════
	let resumen = $derived.by(() => {
		const totalDias = patrones.reduce((s, p) => s + p.fechas.size, 0);
		const totalHoras = patrones.reduce((s, p) => {
			let h = 0;
			if (p.tipo === 'LABORADO') {
				for (const _f of p.fechas) h += p.horas_conducidas || 0;
			}
			return s + h;
		}, 0);

		// Breakdown por tipo: cuenta + días del mes (para mostrar rangos)
		const porTipo: Record<TipoDia, { count: number; dias: number[]; texto: string }> = {
			LABORADO: { count: 0, dias: [], texto: '' },
			DESCANSO: { count: 0, dias: [], texto: '' },
			MANTENIMIENTO: { count: 0, dias: [], texto: '' },
			DISPONIBLE: { count: 0, dias: [], texto: '' }
		};
		for (const p of patrones) {
			if (p.fechas.size === 0) continue;
			porTipo[p.tipo].count += p.fechas.size;
			for (const f of p.fechas) {
				porTipo[p.tipo].dias.push(parseInt(f.slice(8, 10), 10));
			}
		}
		for (const t of TIPOS_DIA) {
			porTipo[t].texto = descripcionDias(t, porTipo[t].dias);
		}

		const errores: string[] = [];
		for (const p of patrones) {
			if (p.fechas.size === 0) continue;
			const defaults = camposParaTipo(p.tipo);
			if (defaults.requierePlaca && !p.vehiculo_placa) {
				errores.push(`Patrón "${labelPatron(p)}" sin placa`);
			}
			if (defaults.requiereHorario) {
				if (!p.hora_inicio || !p.hora_fin) {
					errores.push(`Patrón "${labelPatron(p)}" sin horario`);
				} else if (fmtHoras(p.hora_inicio, p.hora_fin) <= 0) {
					errores.push(`Patrón "${labelPatron(p)}" hora fin <= inicio`);
				}
			}
		}
		return {
			totalPatrones: patrones.filter((p) => p.fechas.size > 0).length,
			totalDias,
			totalHoras,
			porTipo,
			errores
		};
	});

	// Errores "duros" para mostrar en la alerta del modal
	// (los del resumen son a nivel patrón, estos son a nivel guardado).
	let erroresGuardado = $derived.by(() => {
		const e: string[] = [];
		if (!conductorSeleccionadoId) e.push('Selecciona un conductor.');
		if (patrones.length > 0 && resumen.totalDias === 0) {
			e.push('No has asignado ningún día. Crea un patrón y selecciona fechas en el calendario.');
		}
		if (resumen.errores.length > 0) e.push(...resumen.errores);
		return e;
	});

	// ═══════════════════════════════════════════════════════
	//  GUARDAR
	// ═══════════════════════════════════════════════════════
	async function guardar() {
		// La alerta estructurada (erroresGuardado) se muestra siempre
		// que haya errores. Aquí solo bloqueamos el guardado.
		if (erroresGuardado.length > 0) {
			// Scroll al inicio del modal para que la alerta sea visible
			const body = document.querySelector('.modal-body');
			if (body) body.scrollTo({ top: 0, behavior: 'smooth' });
			return;
		}

		guardando = true;
		try {
			const body = {
				conductor_id: conductorSeleccionadoId,
				mes,
				anio,
				patrones: patrones
					.filter((p) => p.fechas.size > 0)
					.map<PatronRecorrido>((p) => {
						const defaults = camposParaTipo(p.tipo);
						const base: PatronRecorrido = {
							tipo: p.tipo,
							fechas: Array.from(p.fechas).sort(),
							observaciones: p.observaciones || null
						};
						// MANTENIMIENTO no genera tramo: la placa viaja en el propio
						// patrón y el backend la guarda en el registro del día.
						if (p.tipo === 'MANTENIMIENTO') {
							base.mantenimiento_vehiculo_id = p.vehiculo_id;
							base.mantenimiento_vehiculo_placa = p.vehiculo_placa;
						}
						// LABORADO y DISPONIBLE llevan segmento (con los campos que apliquen).
						// DESCANSO y MANTENIMIENTO no llevan segmento.
						if (p.tipo === 'LABORADO' || p.tipo === 'DISPONIBLE') {
							const seg: SegmentoPatron = {};
							if (defaults.requiereCliente) {
								seg.cliente_id = p.cliente_id;
								seg.cliente_nombre = p.cliente_nombre || null;
							}
							if (defaults.requierePlaca) {
								seg.vehiculo_id = p.vehiculo_id;
								seg.vehiculo_placa = p.vehiculo_placa;
							}
							if (defaults.requiereHorario) {
								seg.hora_inicio = p.hora_inicio;
								seg.hora_fin = p.hora_fin;
							}
							if (defaults.requiereHorasConducidas) {
								seg.horas_conducidas = p.horas_conducidas;
							}
							if (defaults.requiereKm) {
								seg.km_inicial = p.km_inicial;
								seg.km_final = p.km_final;
							}
							seg.pernocte = defaults.requierePernocte ? p.pernocte : false;
							seg.observaciones = p.observaciones || null;
							base.segmento = seg;
						}
						return base;
					})
			};

			const r = await diasLaboradosAPI.registrosMasivos(body);
			const res = r.data?.resumen;
			if (res) {
				const partes: string[] = [];
				if (res.registros_laborado_creados > 0)
					partes.push(`${res.registros_laborado_creados} laborados`);
				if (res.registros_descanso_creados > 0)
					partes.push(`${res.registros_descanso_creados} descanso`);
				if (res.registros_mantenimiento_creados > 0)
					partes.push(`${res.registros_mantenimiento_creados} mantenimiento`);
				if (res.registros_disponible_creados > 0)
					partes.push(`${res.registros_disponible_creados} disponible`);
				toast.success(`✓ Recorridos guardados (${partes.join(' · ')})`);
			} else {
				toast.success('Recorridos guardados');
			}
			onsaved?.();
			cerrar();
		} catch (err: any) {
			const msg = err?.response?.data?.message || err?.message || 'Error al guardar';
			toast.error(msg);
		} finally {
			guardando = false;
		}
	}

	function cerrar() {
		onclose();
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) cerrar();
	}

	$effect(() => {
		if (open && browser) {
			document.addEventListener('keydown', handleKey);
			return () => document.removeEventListener('keydown', handleKey);
		}
	});

	function cambiarMes(delta: number) {
		let m = mes + delta;
		let a = anio;
		if (m < 1) { m = 12; a--; }
		if (m > 12) { m = 1; a++; }
		mes = m;
		anio = a;
	}

	function cambiarAnio(delta: number) {
		anio = anio + delta;
	}

	function irAHoy() {
		mes = hoy.getMonth() + 1;
		anio = hoy.getFullYear();
	}

	let enMesActual = $derived(mes === hoy.getMonth() + 1 && anio === hoy.getFullYear());

	// Reset al abrir
	$effect(() => {
		if (open) {
			// Si ya hay un patron activo, no resetees
			if (patrones.length === 0) {
				mes = mesInicial ?? hoy.getMonth() + 1;
				anio = anioInicial ?? hoy.getFullYear();
				patronActivoId = '';
				rangoTexto = '';
				conductorSeleccionadoId = conductorIdInicial ?? '';
				searchConductor = '';
			}
		} else {
			// Al cerrar limpiamos
			patrones = [];
			patronActivoId = '';
			rangoTexto = '';
			guardando = false;
			conductorSeleccionadoId = '';
			searchConductor = '';
		}
	});

	// Stats del grid: para cada día, mostrar a qué patrón pertenece
	const patronIdx = $derived.by(() => {
		const m = new Map<string, number>();
		patrones.forEach((p, i) => {
			for (const f of p.fechas) m.set(f, i);
		});
		return m;
	});

	// ═══════════════════════════════════════════════════════
	//  RENDER
	// ═══════════════════════════════════════════════════════
	let diasGrid = $derived(diasDelMes(mes, anio));
</script>

{#if open}
	<div
		class="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-6"
		role="dialog"
		aria-modal="true"
		aria-label="Registrar recorridos"
	>
		<!-- Backdrop -->
		<button
			type="button"
			class="absolute inset-0 cursor-default border-0 p-0"
			style="background: linear-gradient(135deg, rgba(15, 31, 26, 0.40), rgba(10, 20, 16, 0.55)); backdrop-filter: blur(8px) saturate(120%); -webkit-backdrop-filter: blur(8px) saturate(120%);"
			aria-label="Cerrar modal"
			onclick={cerrar}
		></button>

		<!-- Modal container -->
		<div
			class="modal-shell relative w-full"
			style="max-width: 920px; max-height: 94vh; display: flex; flex-direction: column; background-color: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 20px; box-shadow: 0 24px 64px rgba(0,0,0,0.22);"
			in:scale={{ duration: 220, start: 0.96 }}
		>
			<!-- ═══ HEADER ═══ -->
			<div
				class="flex flex-shrink-0 items-start justify-between gap-3 px-6 py-5"
				style="background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%); border-bottom: 1px solid var(--border-subtle); border-radius: 20px 20px 0 0;"
			>
				<div class="flex flex-1 items-start gap-3">
					<div
						class="card-icon flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl"
						style="background: linear-gradient(135deg, #f97316, #ea580c); color: white; box-shadow: 0 4px 16px rgba(249, 115, 22, 0.30);"
					>
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
						</svg>
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span
								class="eyebrow inline-block text-[10px] font-bold uppercase"
								style="letter-spacing: 0.12em; color: #f97316; background: rgba(249, 115, 22, 0.08); padding: 0.2rem 0.55rem; border-radius: 5px; font-family: 'JetBrains Mono', monospace;"
							>
								GC-FR-RC
							</span>
						</div>
						<h2
							class="mt-1.5 text-2xl"
							style="color: var(--bg-charcoal); font-family: 'Fraunces', Georgia, serif; font-weight: 500; letter-spacing: -0.015em; line-height: 1.1;"
						>
							Registrar recorridos
						</h2>
						<p
							class="mt-1 text-[13px]"
							style="color: var(--text-muted); font-family: 'Inter Tight', system-ui, sans-serif;"
						>
							{#if conductorActual}
								{conductorActual.nombre} {conductorActual.apellido} · {MESES[mes - 1]} {anio}
							{:else}
								Selecciona un conductor para comenzar
							{/if}
						</p>
					</div>
				</div>
				<button
					onclick={cerrar}
					class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
					aria-label="Cerrar"
				>
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg
					>
				</button>
			</div>

			<!-- ═══ BODY ═══ -->
			<div
				class="modal-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
			>
				<!-- Selector de conductor (patrón autocomplete, design system landing) -->
				<div
					class="flex flex-shrink-0 flex-col gap-2 rounded-2xl border p-3"
					style="background-color: var(--bg-surface); border-color: var(--border-subtle); box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);"
				>
					<div class="flex items-center justify-between gap-2">
						<span
							class="inline-block text-[10px] font-bold uppercase"
							style="letter-spacing: 0.12em; color: #f97316; background: rgba(249, 115, 22, 0.08); padding: 0.3rem 0.65rem; border-radius: 6px; font-family: 'JetBrains Mono', monospace;"
						>
							Conductor
						</span>
						{#if loadingConductores}
							<span
								class="text-[10px] font-mono uppercase"
								style="color: var(--text-very-muted); letter-spacing: 0.1em;"
							>
								Cargando…
							</span>
						{:else if conductorActual}
							<span
								class="text-[10px] font-mono"
								style="color: var(--text-muted); letter-spacing: 0.05em;"
							>
								{listaConductores.length} disponibles
							</span>
						{:else if hayBusquedaActiva}
							<span
								class="text-[10px] font-mono"
								style="color: {conductoresFiltrados.length === 0 ? '#B91C1C' : '#c2410c'}; letter-spacing: 0.05em; font-weight: 600;"
							>
								{conductoresFiltrados.length} resultado{conductoresFiltrados.length === 1 ? '' : 's'}
							</span>
						{:else}
							<span
								class="text-[10px] font-mono"
								style="color: var(--text-muted); letter-spacing: 0.05em;"
							>
								{listaConductores.length} activos · top {Math.min(MAX_VISIBLE_SIN_BUSQUEDA, listaConductores.length)}
							</span>
						{/if}
					</div>
					<div class="relative">
						{#if conductorActual}
							<!-- Chip del conductor seleccionado (estilo emerald-tinted) -->
							<div
								class="flex items-center gap-3 rounded-xl border-2 px-3 py-2.5"
								style="border-color: #f97316; background-color: rgba(249, 115, 22, 0.04); box-shadow: 0 4px 16px rgba(249, 115, 22, 0.10);"
							>
								<div
									class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
									style="background: linear-gradient(135deg, #f97316, #ea580c); color: white; font-size: 11px; font-weight: 700; box-shadow: 0 2px 6px rgba(249, 115, 22, 0.30);"
								>
									{iniciales(conductorActual.nombre, conductorActual.apellido)}
								</div>
								<div class="min-w-0 flex-1">
									<div
										class="truncate text-sm font-semibold"
										style="color: var(--text-primary); font-family: 'Inter Tight', system-ui, sans-serif;"
									>
										{conductorActual.nombre} {conductorActual.apellido}
									</div>
									{#if conductorActual.numero_identificacion}
										<div
											class="font-mono text-[10px]"
											style="color: #c2410c; letter-spacing: 0.05em;"
										>
											CC {conductorActual.numero_identificacion}
										</div>
									{/if}
								</div>
								<button
									type="button"
									onclick={limpiarConductor}
									aria-label="Cambiar conductor"
									title="Cambiar conductor"
									class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors"
									style="color: #c2410c; background-color: white;"
									onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(249, 115, 22,0.10)')}
									onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'white')}
								>
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
										><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
									>
								</button>
							</div>
						{:else}
							<!-- Input de búsqueda + dropdown -->
							<div class="relative">
								<svg
									class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
									style="color: var(--text-muted);"
									fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
								</svg>
								<input
									type="text"
									bind:value={searchConductor}
									onfocus={() => (showConductorDropdown = true)}
									onblur={() => setTimeout(() => (showConductorDropdown = false), 200)}
									onkeydown={handleConductorKeydown}
									placeholder="Buscar por nombre o cédula…"
									disabled={loadingConductores}
									class="w-full rounded-xl border-2 py-2.5 pr-3 pl-9 text-sm transition-all focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
									style="border-color: rgba(0, 0, 0, 0.12); background-color: white; color: var(--text-primary); font-family: 'Inter Tight', system-ui, sans-serif;"
								/>
							</div>
							{#if showConductorDropdown}
								<div
									id="dropdown-conductor-modal"
									class="absolute z-30 mt-1.5 w-full overflow-y-auto rounded-xl border bg-white"
									style="border-color: var(--border-subtle); box-shadow: 0 12px 32px rgba(249, 115, 22, 0.12); max-height: min(70vh, 480px);"
								>
									{#if conductoresVisibles.length === 0}
										<div class="flex flex-col items-center gap-1.5 p-4 text-center">
											<svg class="h-5 w-5" style="color: var(--text-muted);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
												><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
											</svg>
											<p class="text-xs" style="color: var(--text-muted); font-family: 'Inter Tight', system-ui, sans-serif;">
												{#if searchConductor.trim()}
													Sin coincidencias para "<strong style="color: var(--text-primary);">{searchConductor.trim()}</strong>"
												{:else}
													No hay conductores activos disponibles
												{/if}
											</p>
										</div>
									{:else}
										{#each conductoresVisibles as c, i (c.id)}
											<button
												type="button"
												data-dropdown-item
												onmousedown={(e) => {
													e.preventDefault();
													seleccionarConductor(c);
												}}
												onmouseenter={() => (highlightConductor = i)}
												class="group flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-b-0"
												style="border-color: rgba(0, 0, 0, 0.06); background-color: {highlightConductor === i ? 'rgba(249, 115, 22, 0.08)' : 'white'};"
											>
												<div
													class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors"
													style="background-color: {highlightConductor === i ? '#f97316' : 'rgba(249, 115, 22, 0.12)'}; color: {highlightConductor === i ? 'white' : '#c2410c'};"
												>
													{iniciales(c.nombre, c.apellido)}
												</div>
												<div class="min-w-0 flex-1">
													<div
														class="truncate text-sm font-semibold"
														style="color: {highlightConductor === i ? '#c2410c' : 'var(--text-primary)'}; font-family: 'Inter Tight', system-ui, sans-serif;"
													>
														{c.nombre}
														<span style="color: var(--text-muted); font-weight: 500;">{c.apellido}</span>
													</div>
													{#if c.numero_identificacion}
														<div
															class="font-mono text-[10px]"
															style="color: var(--text-muted); letter-spacing: 0.05em;"
														>
															CC {c.numero_identificacion}
														</div>
													{/if}
												</div>
												{#if highlightConductor === i}
													<svg class="h-4 w-4 flex-shrink-0" style="color: #f97316;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
														><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg
													>
												{/if}
											</button>
										{/each}
										{#if hayMasConductores}
											<div
												class="flex items-center gap-2 border-t px-3 py-2 text-[10px]"
												style="border-color: rgba(0, 0, 0, 0.06); background-color: rgba(245, 158, 11, 0.06); color: #92400E; font-family: 'Inter Tight', system-ui, sans-serif;"
											>
												<svg class="h-3.5 w-3.5 flex-shrink-0" style="color: #B45309;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
													><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg
												>
												Mostrando los primeros {MAX_VISIBLE_SIN_BUSQUEDA} de {conductoresFiltrados.length}. Escribí para buscar uno específico.
											</div>
										{/if}
									{/if}
								</div>
							{/if}
						{/if}
					</div>
				</div>

				<!-- Selector de mes / año -->
				<div
					class="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2.5"
					style="background-color: var(--bg-surface); border-color: var(--border-subtle); box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);"
				>
					<div class="flex items-center gap-1">
						<button
							type="button"
							onclick={() => cambiarAnio(-1)}
							class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
							style="color: var(--text-muted); background-color: var(--bg-base);"
							aria-label="Año anterior"
							title="Año anterior"
							onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'white')}
							onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-base)')}
						>
							<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"
								><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg
							>
						</button>
						<button
							type="button"
							onclick={() => cambiarMes(-1)}
							class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
							style="color: var(--text-secondary); background-color: var(--bg-base);"
							aria-label="Mes anterior"
							title="Mes anterior"
							onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'white')}
							onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-base)')}
						>
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
								><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg
							>
						</button>
						<div
							class="min-w-[150px] px-2 text-center text-sm font-bold uppercase"
							style="color: var(--bg-charcoal); font-family: 'Fraunces', Georgia, serif; font-weight: 500; letter-spacing: 0.05em;"
						>
							{MESES[mes - 1]} {anio}
						</div>
						<button
							type="button"
							onclick={() => cambiarMes(1)}
							class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
							style="color: var(--text-secondary); background-color: var(--bg-base);"
							aria-label="Mes siguiente"
							title="Mes siguiente"
							onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'white')}
							onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-base)')}
						>
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
								><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg
							>
						</button>
						<button
							type="button"
							onclick={() => cambiarAnio(1)}
							class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
							style="color: var(--text-muted); background-color: var(--bg-base);"
							aria-label="Año siguiente"
							title="Año siguiente"
							onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'white')}
							onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-base)')}
						>
							<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"
								><path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M4 5l7 7-7 7" /></svg
							>
						</button>
						{#if !enMesActual}
							<button
								type="button"
								onclick={irAHoy}
								class="apple-transition ml-1 rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors"
								style="color: #c2410c; background-color: rgba(249, 115, 22, 0.10);"
								title="Ir al mes actual"
								aria-label="Ir al mes actual"
								onmouseenter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(249, 115, 22, 0.18)')}
								onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(249, 115, 22, 0.10)')}
							>
								Hoy
							</button>
						{/if}
					</div>
					<p
						class="text-[10px] font-mono uppercase"
						style="color: var(--text-muted); letter-spacing: 0.1em;"
					>
						Solo días pasados y hoy
					</p>
				</div>

				<!-- ALERTA DE ERRORES (estructurada, persistente) -->
				{#if erroresGuardado.length > 0}
					<div
						class="flex flex-shrink-0 items-start gap-2.5 rounded-2xl border p-3"
						role="alert"
						style="background-color: rgba(220, 38, 38, 0.06); border-color: rgba(220, 38, 38, 0.30);"
					>
						<div
							class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
							style="background-color: #dc2626; color: white;"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
							</svg>
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-[12px] font-bold" style="color: #991b1b;">
								{erroresGuardado.length === 1 ? 'Revisa esto antes de guardar' : `Revisa estos ${erroresGuardado.length} puntos antes de guardar`}
							</p>
							<ul class="mt-1 space-y-0.5 text-[11.5px]" style="color: #b91c1c;">
								{#each erroresGuardado as err, i (i)}
									<li class="flex items-start gap-1.5">
										<span class="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full" style="background-color: #dc2626;"></span>
										<span>{err}</span>
									</li>
								{/each}
							</ul>
						</div>
					</div>
				{/if}

				<!-- ═══ STEP 2: TIPO DE DÍA (chips grandes) ═══ -->
				{#if conductorSeleccionadoId}
					<div
						class="flex flex-shrink-0 flex-col gap-2 rounded-2xl border p-3"
						style="background-color: var(--bg-surface); border-color: var(--border-subtle); box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);"
					>
						<div class="flex items-center justify-between">
							<span
								class="inline-block text-[10px] font-bold uppercase"
								style="letter-spacing: 0.12em; color: #f97316; background: rgba(249, 115, 22, 0.08); padding: 0.3rem 0.65rem; border-radius: 6px; font-family: 'JetBrains Mono', monospace;"
							>
								Paso 2 · Estado
							</span>
							<span class="text-[10px]" style="color: var(--text-muted);">
								Toca un estado para crear un nuevo patrón
							</span>
						</div>
						<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
							{#each TIPOS_DIA as t (t)}
								{@const tc = COLOR_POR_TIPO[t]}
								{@const count = patrones.filter((p) => p.tipo === t).length}
								<button
									type="button"
									onclick={() => nuevoPatron(t)}
									class="apple-transition flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left"
									style="background-color: {tc.light}; border-color: {tc.border}; color: {tc.text};"
									title="Crear un nuevo patrón de tipo {tc.label}"
								>
									<div class="flex w-full items-center justify-between">
										<span class="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider">
											<span class="inline-block h-2.5 w-2.5 rounded-full" style="background-color: {tc.dot};"></span>
											{tc.label}
										</span>
										{#if count > 0}
											<span
												class="rounded-full px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums"
												style="background-color: {tc.dot}; color: white;"
											>
												{count}
											</span>
										{/if}
									</div>
									<p class="text-[10.5px] leading-snug" style="color: {tc.text}; opacity: 0.85;">
										{t === 'LABORADO'
											? 'Día con vehículo, cliente, horario y km'
											: t === 'DISPONIBLE'
												? 'Día con horario de disponibilidad y pernocte'
												: t === 'DESCANSO'
													? 'Día de descanso (solo observaciones)'
													: 'Día con mantenimiento del vehículo'}
									</p>
								</button>
							{/each}
						</div>

						<!-- Chips de patrones activos -->
						{#if patrones.length > 0}
							<div class="mt-1 flex flex-wrap items-center gap-1.5">
								<span class="text-[9.5px] font-bold uppercase tracking-wide" style="color: var(--text-muted);">
									Patrones activos:
								</span>
								{#each patrones as p, i (p.idLocal)}
									{@const col = colorPatron(i, p.tipo)}
									{@const isActive = patronActivoId === p.idLocal}
									<button
										type="button"
										onclick={() => (patronActivoId = p.idLocal)}
										class="apple-transition inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
										style="background-color: {isActive ? col.bg : col.light}; border-color: {col.bg}; color: {isActive ? 'white' : col.text};"
										title="Activar patrón #{i + 1} · {p.fechas.size} día{p.fechas.size === 1 ? '' : 's'}"
									>
										<span class="inline-block h-2 w-2 rounded-full" style="background-color: {isActive ? 'white' : col.dot};"></span>
										#{i + 1} · {p.fechas.size}d
										{#if p.vehiculo_placa}· {p.vehiculo_placa}{:else if p.observaciones}· {p.observaciones.slice(0, 14)}{/if}
									</button>
									<button
										type="button"
										onclick={() => eliminarPatron(p.idLocal)}
										class="rounded-full p-0.5 text-red-500 hover:bg-red-50"
										title="Eliminar patrón #{i + 1}"
										aria-label="Eliminar patrón"
									>
										<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- ═══ STEP 3: FORM DEL PATRÓN ACTIVO ═══ -->
				{#if conductorSeleccionadoId && patronActivo()}
					{@const p = patronActivo()!}
					{@const idx = patrones.findIndex((x) => x.idLocal === p.idLocal)}
					{@const col = colorPatron(idx, p.tipo)}
					{@const cfg = camposParaTipo(p.tipo)}
					<div
						class="flex flex-shrink-0 flex-col gap-3 rounded-2xl border p-4"
						style="border-color: {col.border}; background: linear-gradient(180deg, {col.light} 0%, white 60%);"
					>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<span
									class="inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
									style="background-color: {col.bg};"
								>
									{idx + 1}
								</span>
								<div>
									<p class="text-[10px] font-bold uppercase tracking-wider" style="color: {col.text};">
										Paso 3 · Datos del patrón
									</p>
									<p class="text-[14px] font-bold" style="color: var(--bg-charcoal); font-family: 'Fraunces', Georgia, serif; font-weight: 500;">
										{col.label} · {p.fechas.size} día{p.fechas.size === 1 ? '' : 's'}
									</p>
								</div>
							</div>
							<!-- Cambiar tipo de este patrón -->
							<select
								value={p.tipo}
								onchange={(e) => cambiarTipoPatron(p.idLocal, (e.currentTarget as HTMLSelectElement).value as TipoDia)}
								class="apple-transition cursor-pointer rounded-md border px-2 py-1 text-[10px] font-semibold"
								style="border-color: {col.border}; background-color: white; color: {col.text};"
								title="Cambiar el tipo de este patrón"
							>
								{#each TIPOS_DIA as t (t)}
									<option value={t}>{COLOR_POR_TIPO[t].label}</option>
								{/each}
							</select>
						</div>

						<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
							{#if cfg.requierePlaca}
								<label class="block">
									<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">Placa</span>
									<input
										type="text"
										list="dl-vehiculos-list"
										value={p.vehiculo_placa}
										oninput={(e) => onPlacaChange(p.idLocal, (e.currentTarget as HTMLInputElement).value.toUpperCase())}
										placeholder="ABC123"
										class="w-full rounded-lg border px-2 py-1.5 text-xs"
										style="border-color: var(--border-default); background-color: white; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;"
									/>
								</label>
							{/if}
							{#if cfg.requiereCliente}
								<label class="block">
									<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">Cliente</span>
									<input
										type="text"
										list="dl-clientes-list"
										value={p.cliente_nombre}
										oninput={(e) => {
											const val = (e.currentTarget as HTMLInputElement).value;
											const match = clientes.find((c) => c.nombre === val);
											actualizarPatron(p.idLocal, {
												cliente_nombre: val,
												cliente_id: match?.id ?? null
											});
										}}
										placeholder="Nombre del cliente"
										class="w-full rounded-lg border px-2 py-1.5 text-xs"
										style="border-color: var(--border-default); background-color: white; color: var(--text-primary);"
									/>
								</label>
							{/if}
							{#if cfg.requiereHorario}
								<label class="block">
									<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">Hora inicio</span>
									<input
										type="time"
										value={p.hora_inicio}
										oninput={(e) => actualizarPatron(p.idLocal, { hora_inicio: (e.currentTarget as HTMLInputElement).value })}
										class="w-full rounded-lg border px-2 py-1.5 text-xs"
										style="border-color: var(--border-default); background-color: white; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;"
									/>
								</label>
								<label class="block">
									<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">Hora fin</span>
									<input
										type="time"
										value={p.hora_fin}
										oninput={(e) => actualizarPatron(p.idLocal, { hora_fin: (e.currentTarget as HTMLInputElement).value })}
										class="w-full rounded-lg border px-2 py-1.5 text-xs"
										style="border-color: var(--border-default); background-color: white; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;"
									/>
								</label>
							{/if}
							{#if cfg.requiereHorasConducidas}
								<label class="block">
									<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">Horas</span>
									<input
										type="number"
										min="0"
										max="24"
										step="0.5"
										value={p.horas_conducidas}
										oninput={(e) => actualizarPatron(p.idLocal, { horas_conducidas: parseFloat((e.currentTarget as HTMLInputElement).value) || 0 })}
										class="w-full rounded-lg border px-2 py-1.5 text-xs"
										style="border-color: var(--border-default); background-color: white; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;"
									/>
								</label>
							{/if}
							{#if cfg.requiereKm}
								<label class="block">
									<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">KM inicial</span>
									<input
										type="number"
										min="0"
										value={p.km_inicial ?? ''}
										oninput={(e) => {
											const v = (e.currentTarget as HTMLInputElement).value;
											actualizarPatron(p.idLocal, { km_inicial: v ? parseInt(v, 10) : null });
										}}
										placeholder="opcional"
										class="w-full rounded-lg border px-2 py-1.5 text-xs"
										style="border-color: var(--border-default); background-color: white; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;"
									/>
								</label>
								<label class="block">
									<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">KM final</span>
									<input
										type="number"
										min="0"
										value={p.km_final ?? ''}
										oninput={(e) => {
											const v = (e.currentTarget as HTMLInputElement).value;
											actualizarPatron(p.idLocal, { km_final: v ? parseInt(v, 10) : null });
										}}
										placeholder="opcional"
										class="w-full rounded-lg border px-2 py-1.5 text-xs"
										style="border-color: var(--border-default); background-color: white; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;"
									/>
								</label>
							{/if}
							{#if cfg.requierePernocte}
								<label class="flex items-center gap-2 pt-4">
									<input
										type="checkbox"
										checked={p.pernocte}
										onchange={(e) => actualizarPatron(p.idLocal, { pernocte: (e.currentTarget as HTMLInputElement).checked })}
										class="h-4 w-4 rounded"
									/>
									<span class="text-[11px]" style="color: var(--text-secondary);">Pernocte</span>
								</label>
							{/if}
						</div>
						<label class="block">
							<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
								Observaciones {p.tipo === 'DESCANSO' || p.tipo === 'MANTENIMIENTO' ? '' : '(opcional)'}
							</span>
							<textarea
								value={p.observaciones}
								oninput={(e) => actualizarPatron(p.idLocal, { observaciones: (e.currentTarget as HTMLTextAreaElement).value })}
								rows={p.tipo === 'DESCANSO' || p.tipo === 'MANTENIMIENTO' ? 3 : 2}
								placeholder={p.tipo === 'DESCANSO'
									? 'Motivo del descanso (vacaciones, personal, etc.)'
									: p.tipo === 'MANTENIMIENTO'
										? 'Detalle del mantenimiento realizado'
										: p.tipo === 'DISPONIBLE'
											? 'Notas del día disponible...'
											: 'Notas del día...'}
								class="w-full rounded-lg border px-2 py-1.5 text-xs"
								style="border-color: var(--border-default); background-color: white; color: var(--text-primary);"
							></textarea>
						</label>
					</div>
				{/if}

				<!-- ═══ CALENDARIO (full width) ═══ -->
				{#if conductorSeleccionadoId}
					<div
						class="flex flex-shrink-0 flex-col gap-2 rounded-2xl border p-3"
						style="background-color: var(--bg-surface); border-color: var(--border-subtle);"
					>
						<div class="flex items-center justify-between">
							<span
								class="inline-block text-[10px] font-bold uppercase"
								style="letter-spacing: 0.12em; color: #f97316; background: rgba(249, 115, 22, 0.08); padding: 0.3rem 0.65rem; border-radius: 6px; font-family: 'JetBrains Mono', monospace;"
							>
								Paso 4 · Calendario
							</span>
							{#if !patronActivo()}
								<span class="text-[10.5px] font-semibold" style="color: #b45309;">
									↑ Primero selecciona un estado en el paso 2
								</span>
							{:else}
								<span class="text-[10.5px]" style="color: var(--text-muted);">
									Click en los días del <strong style="color: {colorPatron(0, patronActivo()!.tipo).text};">{COLOR_POR_TIPO[patronActivo()!.tipo].label.toLowerCase()}</strong>
								</span>
							{/if}
						</div>
						<!-- Días semana header -->
						<div class="grid grid-cols-7 gap-1.5">
							{#each DIAS_SEMANA as d}
								<div class="py-1 text-center text-[10px] font-bold uppercase tracking-wider" style="color: var(--text-very-muted);">{d}</div>
							{/each}
						</div>
						<!-- Grid -->
						<div class="grid grid-cols-7 gap-1.5">
							{#each diasGrid as dia, i (i)}
								{#if dia === null}
									<div></div>
								{:else}
									{@const fecha = fmtDia(anio, mes, dia)}
									{@const duenio = duenioDelDia(fecha)}
									{@const futuro = esFuturo(anio, mes, dia)}
									{@const col = duenio ? colorPatron(0, duenio.tipo) : null}
									<button
										type="button"
										disabled={futuro}
										onclick={() => toggleDia(dia)}
										class="apple-transition relative flex aspect-square flex-col items-center justify-center rounded-lg border text-[12px] font-semibold"
										style="
											background-color: {col ? col.light : 'white'};
											border-color: {col ? col.border : 'var(--border-subtle)'};
											color: {col ? col.text : 'var(--text-secondary)'};
											opacity: {futuro ? 0.3 : 1};
											cursor: {futuro ? 'not-allowed' : 'pointer'};
										"
										title={futuro
											? 'Día futuro'
											: duenio
												? `${col?.label} · ${labelPatron(duenio)}`
												: 'Click para asignar'}
									>
										<span>{dia}</span>
										{#if col}
											<span class="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full" style="background-color: {col.dot};"></span>
										{/if}
									</button>
								{/if}
							{/each}
						</div>

						<!-- Rango rápido -->
						{#if patronActivo()}
							<div
								class="flex flex-col gap-1.5 rounded-xl border p-2"
								style="background-color: var(--bg-base); border-color: var(--border-subtle);"
							>
								<label class="block">
									<span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide" style="color: var(--text-muted);">
										Rango rápido (ej: 1-10, 15, 25-30) — se asignan al patrón activo ({COLOR_POR_TIPO[patronActivo()!.tipo].label})
									</span>
									<div class="flex gap-1.5">
										<input
											type="text"
											bind:value={rangoTexto}
											placeholder="1-10, 15, 25-30"
											class="flex-1 rounded-lg border px-2 py-1.5 text-xs"
											style="border-color: var(--border-default); background-color: white; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;"
										/>
										<button
											type="button"
											onclick={aplicarRango}
											class="apple-transition rounded-lg px-3 py-1.5 text-[10px] font-semibold"
											style="background-color: {colorPatron(0, patronActivo()!.tipo).bg}; color: white;"
										>
											Aplicar
										</button>
									</div>
								</label>
							</div>
						{/if}

						<!-- Acciones rápidas -->
						{#if patronActivo()}
							<div class="flex flex-wrap items-center gap-1">
								<span class="text-[9.5px] font-bold uppercase tracking-wide" style="color: var(--text-muted);">Atajos:</span>
								{#each [
									{ k: 'todos' as const, label: 'Todos' },
									{ k: 'lv' as const, label: 'L-V' },
									{ k: 'finde' as const, label: 'S-D' },
									{ k: 'q1' as const, label: 'Q1' },
									{ k: 'q2' as const, label: 'Q2' }
								] as acc (acc.k)}
									<button
										type="button"
										onclick={() => aplicarA(acc.k)}
										class="rounded-md border px-2 py-1 text-[10px] font-semibold hover:bg-gray-50"
										style="border-color: var(--border-default); color: var(--text-secondary);"
									>{acc.label}</button>
								{/each}
								<button
									type="button"
									onclick={() => aplicarA('limpiar')}
									class="rounded-md border px-2 py-1 text-[10px] font-semibold hover:bg-red-50"
									style="border-color: var(--border-default); color: #dc2626;"
									title="Quita todos los días del patrón activo (no afecta a los demás patrones)"
								>Limpiar patrón</button>
							</div>
						{/if}

						<!-- Leyenda -->
						<div class="flex flex-wrap gap-x-3 gap-y-1 text-[9.5px]" style="color: var(--text-muted);">
							{#each TIPOS_DIA as t (t)}
								{@const tc = COLOR_POR_TIPO[t]}
								{@const count = resumen.porTipo[t]?.count ?? 0}
								{#if count > 0}
									<span class="inline-flex items-center gap-1">
										<span class="inline-block h-2 w-2 rounded-full" style="background-color: {tc.dot};"></span>
										{tc.label} · {count}
									</span>
								{/if}
							{/each}
							<span class="inline-flex items-center gap-1">
								<span class="inline-block h-2 w-2 rounded-full border" style="background-color: white; border-color: var(--border-default);"></span>
								Sin asignar
							</span>
						</div>
					</div>
				{/if}

				<!-- ═══ RESUMEN (rangos dinámicos) ═══ -->
				{#if resumen.totalDias > 0}
					<div
						class="flex flex-shrink-0 flex-col gap-2 rounded-2xl border p-4"
						style="background-color: var(--bg-surface); border-color: var(--border-subtle); box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);"
					>
						<div class="flex items-center justify-between">
							<span
								class="inline-block text-[10px] font-bold uppercase"
								style="letter-spacing: 0.12em; color: #f97316; background: rgba(249, 115, 22, 0.08); padding: 0.3rem 0.65rem; border-radius: 6px; font-family: 'JetBrains Mono', monospace;"
							>
								Resumen
							</span>
							<span class="text-[10.5px] font-semibold" style="color: var(--text-secondary);">
								{resumen.totalDias} día{resumen.totalDias === 1 ? '' : 's'} · {resumen.totalPatrones} patrón{resumen.totalPatrones === 1 ? '' : 'es'}
								{#if resumen.totalHoras > 0} · {resumen.totalHoras.toFixed(1)}h{/if}
							</span>
						</div>
						<div class="flex flex-col gap-1.5">
							{#each TIPOS_DIA as t (t)}
								{@const tc = COLOR_POR_TIPO[t]}
								{@const item = resumen.porTipo[t]}
								{#if item.count > 0}
									<div
										class="flex items-start gap-2 rounded-xl border px-3 py-2"
										style="background-color: {tc.light}; border-color: {tc.border};"
									>
										<span
											class="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-white"
											style="background-color: {tc.dot};"
										>
											<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
												<path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
											</svg>
										</span>
										<div class="min-w-0 flex-1">
											<p class="text-[11.5px] font-semibold" style="color: {tc.text};">
												{item.texto}
											</p>
										</div>
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/if}

				<!-- Datalists para autocompletar -->
				<datalist id="dl-vehiculos-list">
					{#each vehiculos as v}
						<option value={v.placa}>{[v.marca, v.linea, v.modelo].filter(Boolean).join(' ')}</option>
					{/each}
				</datalist>
				<datalist id="dl-clientes-list">
					{#each clientes as c}
						<option value={c.nombre}>{c.nit ?? ''}</option>
					{/each}
				</datalist>
			</div>

			<!-- ═══ FOOTER ═══ -->
			<div
				class="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t px-5 py-3"
				style="background-color: var(--bg-base); border-color: var(--border-subtle);"
			>
				<div class="flex flex-wrap items-center gap-2 text-[10.5px]" style="color: var(--text-muted);">
					{#if erroresGuardado.length > 0}
						<span
							class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold"
							style="background-color: rgba(220, 38, 38, 0.10); color: #b91c1c;"
						>
							<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
							</svg>
							{erroresGuardado.length} {erroresGuardado.length === 1 ? 'problema' : 'problemas'} por resolver
						</span>
					{:else}
						<span class="font-semibold" style="color: var(--bg-charcoal);">
							{resumen.totalDias} día{resumen.totalDias === 1 ? '' : 's'} en {resumen.totalPatrones} patrón{resumen.totalPatrones === 1 ? '' : 'es'}
						</span>
					{/if}
					{#each TIPOS_DIA as t (t)}
						{@const item = resumen.porTipo[t]}
						{#if item.count > 0}
							{@const tc = COLOR_POR_TIPO[t]}
							<span class="inline-flex items-center gap-1" style="color: {tc.text};">
								<span class="inline-block h-1.5 w-1.5 rounded-full" style="background-color: {tc.dot};"></span>
								{item.count} {tc.label.toLowerCase()}
							</span>
						{/if}
					{/each}
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={cerrar}
						class="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-gray-50"
						style="border-color: var(--border-default); color: var(--text-secondary); background-color: white;"
					>
						Cancelar
					</button>
					<button
						type="button"
						onclick={guardar}
						disabled={guardando || cargaInicial || erroresGuardado.length > 0}
						class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
						style="background: {erroresGuardado.length > 0
							? 'linear-gradient(135deg, #9ca3af, #6b7280)'
							: 'linear-gradient(135deg, #ea580c, #c2410c)'};"
						title={erroresGuardado.length > 0
							? 'Hay ' + erroresGuardado.length + ' problema(s) por resolver'
							: 'Guardar recorridos'}
					>
						{#if guardando}
							<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/>
								<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
							</svg>
							Guardando…
						{:else}
							<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
								><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg
							>
							Guardar recorridos
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-shell {
		/* Permite scroll interno en el body sin desbordar el shell */
		display: flex;
		flex-direction: column;
	}
	.modal-body {
		/* Asegurar que el body haga scroll vertical si el contenido es alto */
		scrollbar-width: thin;
		scrollbar-color: rgba(249, 115, 22, 0.3) transparent;
		scroll-behavior: smooth;
	}
	.modal-body::-webkit-scrollbar {
		width: 8px;
	}
	.modal-body::-webkit-scrollbar-track {
		background: transparent;
	}
	.modal-body::-webkit-scrollbar-thumb {
		background-color: rgba(249, 115, 22, 0.25);
		border-radius: 4px;
	}
	.modal-body::-webkit-scrollbar-thumb:hover {
		background-color: rgba(249, 115, 22, 0.45);
	}
	@media (max-width: 1024px) {
		.modal-body {
			max-height: 80vh;
		}
	}
</style>
