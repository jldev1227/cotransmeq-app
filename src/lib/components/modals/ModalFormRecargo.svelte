<script lang="ts">
	import { onMount, createEventDispatcher, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import {
		Calendar,
		Check,
		CircleAlert,
		CircleCheck,
		Copy,
		FileText,
		Info,
		LoaderCircle,
		Plus,
		RefreshCw,
		ShieldCheck,
		Trash2,
		TriangleAlert,
		Upload,
		X
	} from 'lucide-svelte';
	import { recargosStore } from '$lib/stores/recargos';
	import { recursos } from '$lib/stores/recursos';
	import { recargosApi } from '$lib/api/recargos';
	import { toast } from 'svelte-sonner';
	import {
		esDomingo,
		getNombreMes,
		convertirHoraADecimal,
		esDiaFestivo,
		calcularValoresMonetarios,
		umbralesDesdeConfig,
		calcularRecargosConContinuacion,
		type ConfigRecargosVigente,
		type PorcentajesRecargo,
		type UmbralesJornada,
		type DiaLaboralRecargo
	} from '$lib/utils/recargosHelpers';
	import { obtenerFestivosCompletos, esDiaFestivoColombiano } from '$lib/utils/festivosColombia';
	import ModalNuevoVehiculo from '../servicios/ModalNuevoVehiculo.svelte';
	import ModalNuevoConductor from '../servicios/ModalNuevoConductor.svelte';
	import ModalNuevaEmpresa from '../servicios/ModalNuevaEmpresa.svelte';
	import MapboxSearch from '../ui/MapboxSearch.svelte';
	import ModalBase from '../ui/ModalBase.svelte';
	import Campo from '../directorio/Campo.svelte';
	import { municipios } from '$lib/stores/municipios';

	// Props
	export let isOpen = false;
	export let recargoId: string | null = null;
	export let currentMonth: number = new Date().getMonth() + 1;
	export let currentYear: number = new Date().getFullYear();

	const dispatch = createEventDispatcher();

	// Estados
	let isLoading = false;
	let isLoadingData = false;
	let isGenerandoPlanilla = false; // Loading específico para generación de planilla
	let editMode = false;
	let lastLoadedRecargoId: string | null = null; // Track para evitar cargar el mismo recargo múltiples veces
	let archivoAdjunto: File | null = null;
	let archivoExistente: string | null = null;
	let archivoExistenteKey: string | null = null;
	let activeTab: 'informacion' | 'condiciones' | 'horarios' = 'informacion';
	let searchConductor = '';
	let searchVehiculo = '';
	let searchEmpresa = '';
	let showConductorDropdown = false;
	let showVehiculoDropdown = false;
	let showEmpresaDropdown = false;

	let mostrarModalEmpresa = false;
	let mostrarModalConductor = false;
	let mostrarModalVehiculo = false;
	let mostrarModalSelectCliente = false;

	// Índices de preselección para navegación con teclado en dropdowns
	let highlightConductor = 0;
	let highlightVehiculo = 0;
	let highlightEmpresa = 0;
	let selectedRow: string | null = null;
	let fromServicio = false; // Indica si el recargo viene de un servicio
	let planillaGenerada = false; // Flag para evitar regenerar automáticamente

	// Toggle para mostrar sección de servicio opcional en creación
	let mostrarServicioInfo = false;

	// Estado para búsqueda de municipios de servicio
	let searchServicioOrigen = '';
	let searchServicioDestino = '';
	let showServicioOrigenDropdown = false;
	let showServicioDestinoDropdown = false;
	let servicioOrigenSeleccionado: any = null;
	let servicioDestinoSeleccionado: any = null;
	let servicioOrigenEspecifico = '';
	let servicioDestinoEspecifico = '';
	let servicioOrigenLatitud: number | null = null;
	let servicioOrigenLongitud: number | null = null;
	let servicioDestinoLatitud: number | null = null;
	let servicioDestinoLongitud: number | null = null;
	let servicioObservaciones = '';
	let servicioProposito: string = 'personal';
	let servicioFechaRealizacion: string = '';

	// Validaciones de horas
	let erroresHoras: { [key: string]: { inicio: string; fin: string } } = {};
	let erroresDias: { [key: string]: string } = {};

	// Empresas que NO reconocen RNDF (Recargo Nocturno Dominical/Festivo)
	// Columnas de recargo de la tabla de días, en el orden en que se muestran.
	const CODIGOS_RECARGO = ['HED', 'HEN', 'HEFD', 'HEFN', 'RNDF', 'RN', 'RD'] as const;

	const EMPRESAS_SIN_RNDF = [
		'cfb258a6-448c-4469-aa71-8eeafa4530ef' // PAREX RESOURCES (COLOMBIA) AG SUCURSAL
	];

	$: excluirRNDF = EMPRESAS_SIN_RNDF.includes(formData.empresaId);

	// Obtener días festivos colombianos del año actual
	$: diasFestivos = obtenerFestivosCompletos(currentYear);
	$: festivosDelMes = diasFestivos.filter((f) => f.mes === currentMonth);

	// ═══════════════════════════════════════════════════════════
	// VIGENCIAS — Para soportar configs distintas por fecha
	// ═══════════════════════════════════════════════════════════

	// Tipos de recargo (todas las versiones) que aplican en el mes actual.
	// Recargado cada vez que cambia mes/año/empresa.
	let tiposVigentes: any[] = [];
	let loadingTiposVigentes = false;

	// Configs salariales que aplican en el rango de días de la planilla.
	let configsEnRango: any[] = [];
	let loadingConfigsRango = false;

	// Cache de config vigente por fecha (clave: YYYY-MM-DD)
	let configPorFechaCache = new Map<string, ConfigRecargosVigente | null>();
	let tiposPorFechaCache = new Map<string, PorcentajesRecargo>();

	/**
	 * Resuelve la config salarial vigente para una fecha concreta.
	 * Si hay varias en el rango, devuelve la que mejor coincida.
	 */
	function getConfigParaFecha(fecha: Date): ConfigRecargosVigente | null {
		const key = fecha.toISOString().split('T')[0];
		if (configPorFechaCache.has(key)) return configPorFechaCache.get(key)!;

		let config: ConfigRecargosVigente | null = null;

		// Buscar la config cuyo rango [vigencia_desde, vigencia_hasta] contiene la fecha
		const candidatas = configsEnRango.filter((c: any) => {
			const desde = new Date(c.vigencia_desde);
			const hasta = c.vigencia_hasta ? new Date(c.vigencia_hasta) : null;
			if (desde > fecha) return false;
			if (hasta && hasta < fecha) return false;
			return true;
		});

		// Prioridad: específica de empresa > base
		const candidata =
			candidatas.find((c: any) => c.empresa_id === formData.empresaId) ||
			candidatas.find((c: any) => c.empresa_id === null) ||
			null;

		if (candidata) {
			const salario = Number(candidata.salario_basico);
			const horas = candidata.horas_mensuales_base || 240;
			const etiqueta = candidata.vigencia_hasta
				? `Vig. hasta ${new Date(candidata.vigencia_hasta).toISOString().split('T')[0]}`
				: `Vig. desde ${new Date(candidata.vigencia_desde).toISOString().split('T')[0]}`;
			// Resolver umbrales de jornada desde la config salarial de
			// este día. Si la BD no trae los nuevos campos (back-compat),
			// umbralesDesdeConfig usa los defaults 10.33 / 7.33.
			const umbrales = umbralesDesdeConfig(candidata);
			config = {
				porcentajes: getPorcentajesParaFecha(fecha),
				valorHora: salario / horas,
				salarioBasico: salario,
				horasMensualesBase: horas,
				configuracionSalarioId: candidata.id,
				etiqueta,
				jornadaNormal: umbrales.jornadaNormal,
				jornadaFestiva: umbrales.jornadaFestiva
			};
		}

		configPorFechaCache.set(key, config);
		return config;
	}

	/**
	 * Resuelve los porcentajes vigentes de los 7 tipos para una fecha concreta.
	 * Para cada codigo, toma la fila con vigencia_desde más reciente <= fecha.
	 */
	function getPorcentajesParaFecha(fecha: Date): PorcentajesRecargo {
		const key = fecha.toISOString().split('T')[0];
		const cached = tiposPorFechaCache.get(key);
		if (cached) return cached;

		const porcentajes: PorcentajesRecargo = {
			HED: 0,
			HEN: 0,
			HEFD: 0,
			HEFN: 0,
			RN: 0,
			RD: 0,
			RNDF: 0
		};
		const seen = new Set<string>();
		const ordenados = [...tiposVigentes].sort(
			(a: any, b: any) =>
				new Date(b.vigencia_desde).getTime() - new Date(a.vigencia_desde).getTime()
		);
		for (const t of ordenados) {
			const desde = new Date(t.vigencia_desde);
			const hasta = t.vigencia_hasta ? new Date(t.vigencia_hasta) : null;
			if (desde > fecha) continue;
			if (hasta && hasta < fecha) continue;
			if (seen.has(t.codigo)) continue;
			seen.add(t.codigo);
			(porcentajes as any)[t.codigo] = Number(t.porcentaje);
		}
		tiposPorFechaCache.set(key, porcentajes);
		return porcentajes;
	}

	/**
	 * Recarga las configs y tipos vigentes del rango de la planilla.
	 * Se dispara cada vez que cambia mes/año/empresa.
	 */
	async function recargarVigencias() {
		if (!diasLaborales || diasLaborales.length === 0) return;
		// Calcular rango
		const dias = diasLaborales
			.filter((d) => d.dia && !d.disponibilidad)
			.map((d) => Number(d.dia))
			.sort((a, b) => a - b);
		if (dias.length === 0) return;

		const fechaDesde = new Date(Date.UTC(currentYear, currentMonth - 1, dias[0]));
		const fechaHasta = new Date(Date.UTC(currentYear, currentMonth - 1, dias[dias.length - 1]));

		// Reset cache
		configPorFechaCache = new Map();
		tiposPorFechaCache = new Map();

		loadingTiposVigentes = true;
		loadingConfigsRango = true;
		try {
			const [tipos, configs] = await Promise.all([
				recargosApi.obtenerTiposRecargoVigentes({
					fecha_desde: fechaDesde.toISOString().split('T')[0],
					fecha_hasta: fechaHasta.toISOString().split('T')[0]
				}),
				recargosApi.obtenerConfigsSalariosEnRango({
					empresa_id: formData.empresaId,
					fecha_desde: fechaDesde.toISOString().split('T')[0],
					fecha_hasta: fechaHasta.toISOString().split('T')[0]
				})
			]);
			tiposVigentes = tipos;
			configsEnRango = configs;
		} catch (err) {
			console.error('Error recargando vigencias:', err);
		} finally {
			loadingTiposVigentes = false;
			loadingConfigsRango = false;
		}
	}

	/**
	 * Detecta si la planilla cruza un cambio de config (ej. día 14 vs día 15).
	 */
	$: cruzaCambioConfig = (() => {
		if (configsEnRango.length < 2) return false;
		const configsUsadas = new Set<string>();
		for (const d of diasLaborales) {
			if (!d.dia || d.disponibilidad) continue;
			const fecha = new Date(Date.UTC(currentYear, currentMonth - 1, Number(d.dia)));
			const cfg = getConfigParaFecha(fecha);
			if (cfg) configsUsadas.add(cfg.configuracionSalarioId ?? cfg.etiqueta);
		}
		return configsUsadas.size > 1;
	})();

	// Recargar vigencias cuando cambien mes/año/empresa o se modifiquen días
	$: if (isOpen && formData.empresaId && currentMonth && currentYear) {
		// debounce básico
		queueMicrotask(recargarVigencias);
	}

	// Función para obtener el máximo día del mes
	function obtenerMaximoDiaMes(mes: number, year: number): number {
		// El día 0 del mes siguiente es el último día del mes actual
		return new Date(year, mes, 0).getDate();
	}

	// Datos del formulario
	let formData = {
		conductorId: '',
		vehiculoId: '',
		empresaId: '',
		tmNumber: '',
		servicio_id: null as string | null,

		// Estado del conductor (valores por defecto aprobados)
		estado_conductor: 'optimo' as 'optimo' | 'fatigado' | 'regular' | 'malo' | null,

		// Condiciones de vía (por defecto trocha)
		via_trocha: true,
		via_afirmado: false,
		via_mixto: false,
		via_pavimentada: false,

		// Riesgos de seguridad (por defecto sin riesgos)
		riesgo_desniveles: false,
		riesgo_deslizamientos: false,
		riesgo_sin_senalizacion: false,
		riesgo_animales: false,
		riesgo_peatones: false,
		riesgo_trafico_alto: false,

		// Evaluación (valores por defecto óptimos)
		fuente_consulta: 'sistema' as 'conductor' | 'gps' | 'cliente' | 'sistema' | null,
		calificacion_servicio: 'bueno' as 'bueno' | 'regular' | 'malo' | null,

		// Métricas de tiempo
		tiempo_disponibilidad_horas: null as number | null,
		duracion_trayecto_horas: null as number | null,
		numero_dias_servicio: null as number | null
	};

	interface DiaLaboral {
		id: string;
		dia: string;
		mes: string;
		año: string;
		hora_inicio: string;
		hora_fin: string;
		kilometraje_inicial: string | null;
		kilometraje_final: string | null;
		es_domingo: boolean;
		es_festivo: boolean;
		pernocte: boolean;
		disponibilidad: boolean;
		continua_siguiente_dia: boolean;
	}

	let diasLaborales: DiaLaboral[] = [
		{
			id: '1',
			dia: '',
			mes: currentMonth.toString(),
			año: currentYear.toString(),
			hora_inicio: '',
			hora_fin: '',
			kilometraje_inicial: null,
			kilometraje_final: null,
			es_domingo: false,
			es_festivo: false,
			pernocte: false,
			disponibilidad: false,
			continua_siguiente_dia: false
		}
	];

	// Store subscriptions
	$: conductores = $recursos.conductores;
	$: vehiculos = $recursos.vehiculos;
	$: empresas = $recursos.clientes;

	// Filtrar opciones basadas en búsqueda
	$: conductoresFiltrados = conductores.filter((c) =>
		`${c.nombre} ${c.apellido}`.toLowerCase().includes(searchConductor.toLowerCase())
	);

	$: vehiculosFiltrados = vehiculos.filter((v) =>
		v.placa.toLowerCase().includes(searchVehiculo.toLowerCase())
	);

	$: empresasFiltradas = empresas.filter((e) =>
		e.nombre.toLowerCase().includes(searchEmpresa.toLowerCase())
	);

	// Resetear highlight cuando cambia el texto de búsqueda — siempre preseleccionar el primer resultado
	$: if (searchConductor !== undefined) highlightConductor = 0;
	$: if (searchVehiculo !== undefined) highlightVehiculo = 0;
	$: if (searchEmpresa !== undefined) highlightEmpresa = 0;

	// Helper para scroll-into-view del elemento destacado en un dropdown
	function scrollHighlightedIntoView(containerId: string, index: number) {
		tick().then(() => {
			const container = document.getElementById(containerId);
			if (!container) return;
			const items = container.querySelectorAll('[data-dropdown-item]');
			if (items[index]) {
				items[index].scrollIntoView({ block: 'nearest' });
			}
		});
	}

	// Handlers for sub-modals
	async function handleEmpresaCreada(empresa: any) {
		// Agregar al store y auto-seleccionar
		recursos.agregarCliente(empresa);
		empresaSeleccionada = empresa.id;
	}

	async function handleConductorCreado(conductor: any) {
		// Agregar al store y auto-seleccionar
		recursos.agregarConductor(conductor);
		conductorSeleccionado = conductor.id;
	}

	async function handleVehiculoCreado(vehiculo: any) {
		// Agregar al store y auto-seleccionar
		recursos.agregarVehiculo(vehiculo);
		vehiculoSeleccionado = vehiculo.id;
	}

	// Keydown handlers para cada dropdown
	function handleConductorKeydown(e: KeyboardEvent) {
		if (!showConductorDropdown || conductoresFiltrados.length === 0) return;
		const len = conductoresFiltrados.length;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightConductor = (highlightConductor + 1) % len;
			scrollHighlightedIntoView('dropdown-conductor', highlightConductor);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightConductor = (highlightConductor - 1 + len) % len;
			scrollHighlightedIntoView('dropdown-conductor', highlightConductor);
		} else if (e.key === 'Enter' && highlightConductor >= 0) {
			e.preventDefault();
			const selected = conductoresFiltrados[highlightConductor];
			if (selected) {
				formData.conductorId = selected.id;
				showConductorDropdown = false;
				highlightConductor = 0;
			}
		} else if (e.key === 'Escape') {
			// Escape cierra solo la lista, no el modal.
			e.stopPropagation();
			showConductorDropdown = false;
			highlightConductor = 0;
		}
	}

	function handleVehiculoKeydown(e: KeyboardEvent) {
		if (!showVehiculoDropdown || vehiculosFiltrados.length === 0) return;
		const len = vehiculosFiltrados.length;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightVehiculo = (highlightVehiculo + 1) % len;
			scrollHighlightedIntoView('dropdown-vehiculo', highlightVehiculo);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightVehiculo = (highlightVehiculo - 1 + len) % len;
			scrollHighlightedIntoView('dropdown-vehiculo', highlightVehiculo);
		} else if (e.key === 'Enter' && highlightVehiculo >= 0) {
			e.preventDefault();
			const selected = vehiculosFiltrados[highlightVehiculo];
			if (selected) {
				formData.vehiculoId = selected.id;
				showVehiculoDropdown = false;
				highlightVehiculo = 0;
			}
		} else if (e.key === 'Escape') {
			// Escape cierra solo la lista, no el modal.
			e.stopPropagation();
			showVehiculoDropdown = false;
			highlightVehiculo = 0;
		}
	}

	function handleEmpresaKeydown(e: KeyboardEvent) {
		if (!showEmpresaDropdown || empresasFiltradas.length === 0) return;
		const len = empresasFiltradas.length;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightEmpresa = (highlightEmpresa + 1) % len;
			scrollHighlightedIntoView('dropdown-empresa', highlightEmpresa);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightEmpresa = (highlightEmpresa - 1 + len) % len;
			scrollHighlightedIntoView('dropdown-empresa', highlightEmpresa);
		} else if (e.key === 'Enter' && highlightEmpresa >= 0) {
			e.preventDefault();
			const selected = empresasFiltradas[highlightEmpresa];
			if (selected) {
				formData.empresaId = selected.id;
				showEmpresaDropdown = false;
				highlightEmpresa = 0;
			}
		} else if (e.key === 'Escape') {
			// Escape cierra solo la lista, no el modal.
			e.stopPropagation();
			showEmpresaDropdown = false;
			highlightEmpresa = 0;
		}
	}

	// Función para obtener el siguiente número de planilla desde el backend
	// (endpoint ligero: NO trae todos los recargos, solo el campo numero_planilla).
	//
	// Modos:
	//   - Auto (al abrir modal): respeta lo que el usuario haya tipeado,
	//     corre una sola vez por sesión del modal.
	//   - Manual (botón Regenerar): { force: true } siempre sobrescribe,
	//     esté o no el campo lleno. Es el "retry" manual que pediste.
	async function generarNumeroPlanilla(opts: { force?: boolean } = {}) {
		if (isGenerandoPlanilla) return; // Evitar múltiples llamadas simultáneas

		// Modo auto: no pisar si el usuario ya escribió algo o ya se generó
		if (!opts.force) {
			if (planillaGenerada) return;
			if (formData.tmNumber) return;
		}

		isGenerandoPlanilla = true;

		try {
			const numero = await recargosApi.obtenerSiguienteNumeroPlanilla();

			formData.tmNumber = numero;
			planillaGenerada = true;
			await tick();

			if (opts.force) {
				toast.success(`Número regenerado: ${numero}`);
			}
		} catch (error) {
			console.error('Error al generar número de planilla:', error);
			toast.error(
				opts.force
					? 'No se pudo regenerar el número. Reintentá o escribilo manualmente.'
					: 'No se pudo generar el número. Reintentá o escribilo manualmente.'
			);
		} finally {
			isGenerandoPlanilla = false;
		}
	}

	// Calcular progreso
	$: tabCompleted = {
		informacion: !!(formData.conductorId && formData.vehiculoId && formData.empresaId),
		condiciones: true, // Siempre validado por defecto (opcional)
		horarios: diasLaborales.some((dia) => dia.dia && dia.hora_inicio && dia.hora_fin)
	};

	$: progress = {
		completed:
			(formData.conductorId ? 1 : 0) +
			(formData.vehiculoId ? 1 : 0) +
			(formData.empresaId ? 1 : 0) +
			1 + // Condiciones siempre cuenta como completado
			(tabCompleted.horarios ? 1 : 0),
		total: 5
	};

	// Obtener conductor seleccionado
	$: conductorSeleccionado = formData.conductorId
		? conductores.find((c) => c.id === formData.conductorId)
		: null;

	// Obtener vehículo seleccionado
	$: vehiculoSeleccionado = formData.vehiculoId
		? vehiculos.find((v) => v.id === formData.vehiculoId)
		: null;

	// Obtener empresa seleccionada
	$: empresaSeleccionada = formData.empresaId
		? empresas.find((e) => e.id === formData.empresaId)
		: null;

	function eliminarDiaLaboral(id: string) {
		if (diasLaborales.length > 1) {
			diasLaborales = diasLaborales.filter((dia) => dia.id !== id);
			// Limpiar errores del día eliminado
			delete erroresHoras[id];
			delete erroresDias[id];
			erroresHoras = erroresHoras;
			erroresDias = erroresDias;
		}
	}

	function validarDia(valor: any): string {
		const numValor = typeof valor === 'string' ? parseInt(valor) : valor;
		const maxDia = obtenerMaximoDiaMes(currentMonth, currentYear);

		if (!valor || valor === '') {
			return '';
		}

		if (isNaN(numValor)) {
			return 'Valor inválido';
		}

		if (numValor < 1) {
			return 'Mínimo: 1';
		}

		if (numValor > maxDia) {
			return `Este mes solo tiene ${maxDia} días`;
		}

		return '';
	}

	function validarHora(id: string, campo: 'inicio' | 'fin', valor: any): string {
		const numValor = typeof valor === 'string' ? parseFloat(valor) : valor;

		if (valor === '' || valor === null || valor === undefined) {
			return '';
		}

		if (isNaN(numValor)) {
			return 'Valor inválido';
		}

		if (numValor < 0) {
			return 'Mínimo: 0 horas';
		}

		if (numValor > 48) {
			return 'Máximo: 48 horas';
		}

		return '';
	}

	/**
	 * Errores de las dos celdas de horario de un día. Además del rango de cada
	 * una, la hora fin tiene que ir después de la de inicio: un turno que pasa
	 * de medianoche se escribe con horas mayores de 24 (20 → 28) o con
	 * «continúa al día siguiente», nunca al revés. Antes esto viajaba al
	 * servidor como `total_horas` negativo, volvía como «Error de validación»
	 * y el modal se cerraba sin señalar la celda.
	 */
	function validarHorasDia(
		id: string,
		dia: Pick<DiaLaboral, 'hora_inicio' | 'hora_fin'>
	): { inicio: string; fin: string } {
		const errores = {
			inicio: validarHora(id, 'inicio', dia.hora_inicio),
			fin: validarHora(id, 'fin', dia.hora_fin)
		};
		const vacia = (v: unknown) => v === '' || v === null || v === undefined;
		if (!errores.inicio && !errores.fin && !vacia(dia.hora_inicio) && !vacia(dia.hora_fin)) {
			const inicio = parseFloat(String(dia.hora_inicio));
			const fin = parseFloat(String(dia.hora_fin));
			if (fin < inicio) errores.fin = `Debe ser mayor que la hora de inicio (${inicio})`;
		}
		return errores;
	}

	function hayErroresEnHorarios(): boolean {
		return (
			Object.values(erroresDias).some(Boolean) ||
			Object.values(erroresHoras).some((e) => e.inicio || e.fin)
		);
	}

	/**
	 * Lleva las incidencias de zod del servidor (`errors`, con `path` tipo
	 * `['dias_laborales', 3, 'hora_fin']`) a la fila y celda del formulario.
	 * Devuelve true si marcó alguna.
	 */
	function marcarErroresDelServidor(error: unknown): boolean {
		const issues = (error as any)?.response?.data?.errors;
		if (!Array.isArray(issues)) return false;
		let marcados = 0;
		for (const issue of issues) {
			const [raiz, indice, campo] = Array.isArray(issue?.path) ? issue.path : [];
			if (raiz !== 'dias_laborales' || typeof indice !== 'number') continue;
			const fila = diasLaborales[indice];
			if (!fila) continue;
			const mensaje = issue.code === 'custom' ? String(issue.message) : 'Valor inválido';
			if (campo === 'dia') {
				erroresDias[fila.id] = mensaje;
			} else {
				if (!erroresHoras[fila.id]) erroresHoras[fila.id] = { inicio: '', fin: '' };
				if (campo === 'hora_inicio') erroresHoras[fila.id].inicio = mensaje;
				else erroresHoras[fila.id].fin = mensaje;
			}
			marcados++;
		}
		if (marcados) {
			erroresDias = erroresDias;
			erroresHoras = erroresHoras;
		}
		return marcados > 0;
	}

	function actualizarDiaLaboral(id: string, campo: keyof DiaLaboral, valor: any) {
		diasLaborales = diasLaborales.map((dia) => {
			if (dia.id === id) {
				const updated = { ...dia, [campo]: valor };

				// Validar día
				if (campo === 'dia') {
					erroresDias[id] = validarDia(valor);
					erroresDias = erroresDias;

					// Si es válido, verificar si es domingo o festivo
					if (!erroresDias[id] && valor) {
						const diaNum = parseInt(valor);
						updated.es_domingo = esDomingo(diaNum, currentMonth, currentYear);
						updated.es_festivo = esDiaFestivoColombiano(diaNum, currentMonth, currentYear);
					}
				}

				// Validar horas: las dos juntas, porque la regla «fin después de
				// inicio» depende de ambas celdas.
				if (campo === 'hora_inicio' || campo === 'hora_fin') {
					erroresHoras[id] = validarHorasDia(id, updated);
					erroresHoras = erroresHoras;
				}

				return updated;
			}
			return dia;
		});
	}

	// Funciones de cálculo de recargos
	function calcularTotalHoras(horaInicio: any, horaFin: any): number {
		if (!horaInicio || !horaFin) return 0;
		const inicio = typeof horaInicio === 'string' ? parseFloat(horaInicio) : horaInicio;
		const fin = typeof horaFin === 'string' ? parseFloat(horaFin) : horaFin;
		if (isNaN(inicio) || isNaN(fin)) return 0;
		return Math.abs(fin - inicio);
	}

	/**
	 * Formatea un valor monetario corto (ej. "$1.2M", "$350K") para mostrar
	 * al lado de las horas en las cards de totales.
	 */
	function formatValorMonetario(valor: number): string {
		if (!valor || valor === 0) return '';
		if (valor >= 1_000_000) return ` · $${(valor / 1_000_000).toFixed(2)}M`;
		if (valor >= 1_000) return ` · $${(valor / 1_000).toFixed(0)}K`;
		return ` · $${valor.toFixed(0)}`;
	}

	/**
	 * Wrapper de formatearCOP desde recargosHelpers.
	 */
	function formatearCOP(valor: number): string {
		if (valor == null) return '—';
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(valor));
	}

	/**
	 * Devuelve la etiqueta de la config aplicable a un día concreto (para badges).
	 */
	function getEtiquetaConfigParaDia(diaNum: number | string): string {
		if (!diaNum) return '';
		const fecha = new Date(Date.UTC(currentYear, currentMonth - 1, Number(diaNum)));
		const cfg = getConfigParaFecha(fecha);
		if (!cfg) return '';
		// Versión corta: ej. "Vig. 1" / "Vig. 2"
		const idx = Array.from(configsEnRango).findIndex(
			(c: any) => c.id === cfg.configuracionSalarioId
		);
		return idx >= 0 ? `Vig. ${idx + 1}` : cfg.etiqueta.slice(0, 18);
	}

	/**
	 * Calcula el desglose monetario agrupado por configuración.
	 * Usado en el resumen del modal cuando la planilla cruza cambios de config.
	 */
	function getDesglosePorConfig(): Map<
		string,
		{ config: ConfigRecargosVigente; dias: number[]; total: number }
	> {
		const desglose = new Map<
			string,
			{ config: ConfigRecargosVigente; dias: number[]; total: number }
		>();
		for (const d of diasLaborales) {
			if (!d.dia || d.disponibilidad) continue;
			const horasTotales = calcularTotalHoras(d.hora_inicio, d.hora_fin);
			if (horasTotales <= 0) continue;

			const recargos = calcularRecargos(d, excluirRNDF);
			const fecha = new Date(Date.UTC(currentYear, currentMonth - 1, Number(d.dia)));
			const cfg = getConfigParaFecha(fecha);
			if (!cfg) continue;
			const valores = calcularValoresMonetarios(recargos, cfg, excluirRNDF);

			const key = cfg.configuracionSalarioId ?? cfg.etiqueta;
			const existing = desglose.get(key);
			if (existing) {
				existing.dias.push(Number(d.dia));
				existing.total += valores.total;
			} else {
				desglose.set(key, { config: cfg, dias: [Number(d.dia)], total: valores.total });
			}
		}
		return desglose;
	}

	/**
	 * Wrapper sobre `calcularRecargosConContinuacion` del helper compartido.
	 * Mantiene la firma corta `(dia, excluirRNDF)` que usaba el modal y
	 * le pasa por dentro los datos del scope (diasLaborales, currentMonth,
	 * currentYear, getConfigParaFecha) que la versión pura del helper
	 * necesita.
	 *
	 * La lógica del cálculo (turnos continuos, almuerzo, RD cap, HEFN
	 * absorption, festivo, etc.) está toda en
	 * `src/lib/utils/recargosHelpers.ts → calcularRecargosConContinuacion`
	 * para que el backend y otras pantallas puedan reutilizarla sin
	 * duplicarla.
	 */
	function calcularRecargos(dia: DiaLaboral, excluirRNDF = false) {
		return calcularRecargosConContinuacion({
			dia: dia as unknown as DiaLaboralRecargo,
			diasLaborales: diasLaborales as unknown as DiaLaboralRecargo[],
			mes: currentMonth,
			año: currentYear,
			getConfigParaFecha,
			excluirRNDF
		});
	}

	function calcularTotales() {
		const totales = {
			totalHoras: 0,
			HED: 0,
			HEN: 0,
			HEFD: 0,
			HEFN: 0,
			RNDF: 0,
			RN: 0,
			RD: 0,
			// Valores monetarios (por tipo y total)
			valorHED: 0,
			valorHEN: 0,
			valorHEFD: 0,
			valorHEFN: 0,
			valorRN: 0,
			valorRD: 0,
			valorRNDF: 0,
			valorTotal: 0
		};

		diasLaborales.forEach((dia) => {
			// Excluir días marcados como disponible
			if (dia.disponibilidad) return;
			const horasTotales = calcularTotalHoras(dia.hora_inicio, dia.hora_fin);
			if (horasTotales > 0) {
				totales.totalHoras += horasTotales;

				const recargos = calcularRecargos(dia, excluirRNDF);

				totales.HED += recargos.HED;
				totales.HEN += recargos.HEN;
				totales.HEFD += recargos.HEFD;
				totales.HEFN += recargos.HEFN;
				totales.RNDF += recargos.RNDF;
				totales.RN += recargos.RN;
				totales.RD += recargos.RD;

				// Calcular valor monetario con la config vigente de ESE día
				if (dia.dia) {
					const fecha = new Date(Date.UTC(currentYear, currentMonth - 1, Number(dia.dia)));
					const config = getConfigParaFecha(fecha);
					if (config) {
						const valores = calcularValoresMonetarios(recargos, config, excluirRNDF);
						totales.valorHED += valores.hed;
						totales.valorHEN += valores.hen;
						totales.valorHEFD += valores.hefd;
						totales.valorHEFN += valores.hefn;
						totales.valorRN += valores.rn;
						totales.valorRD += valores.rd;
						totales.valorRNDF += valores.rndf;
						totales.valorTotal += valores.total;
					}
				}
			}
		});

		return totales;
	}

	function obtenerColorRecargo(tipo: string, valor: number): string {
		if (valor === 0) return 'bg-gray-100 text-gray-600';
		switch (tipo) {
			case 'HED':
				return 'bg-orange-100 text-orange-700';
			case 'HEN':
				return 'bg-blue-100 text-blue-700';
			case 'HEFD':
				return 'bg-yellow-100 text-yellow-700';
			case 'HEFN':
				return 'bg-purple-100 text-purple-700';
			case 'RNDF':
				return 'bg-indigo-100 text-indigo-700';
			case 'RN':
				return 'bg-blue-100 text-blue-700';
			case 'RD':
				return 'bg-red-100 text-red-700';
			default:
				return 'bg-gray-100 text-gray-600';
		}
	}

	// Navegación por teclado entre celdas editables de la tabla de horarios
	// Las columnas navegables son: dia(0), hora_inicio(1), hora_fin(2), km_inicial(3), km_final(4)
	const NAV_COLS = 5; // cantidad de columnas navegables por fila

	function handleHorarioCellKeydown(e: KeyboardEvent) {
		const target = e.currentTarget as HTMLInputElement;
		const row = parseInt(target.dataset.navRow || '-1', 10);
		const col = parseInt(target.dataset.navCol || '-1', 10);
		if (row < 0 || col < 0) return;

		let nextRow = row;
		let nextCol = col;
		let shouldNavigate = false;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				nextRow = row + 1;
				shouldNavigate = true;
				break;
			case 'ArrowUp':
				e.preventDefault();
				nextRow = row - 1;
				shouldNavigate = true;
				break;
			case 'ArrowRight':
				e.preventDefault();
				if (col < NAV_COLS - 1) {
					nextCol = col + 1;
				} else {
					// Última columna → primera columna de siguiente fila
					nextCol = 0;
					nextRow = row + 1;
				}
				shouldNavigate = true;
				break;
			case 'ArrowLeft':
				e.preventDefault();
				if (col > 0) {
					nextCol = col - 1;
				} else {
					// Primera columna → última columna de fila anterior
					nextCol = NAV_COLS - 1;
					nextRow = row - 1;
				}
				shouldNavigate = true;
				break;
			case 'Tab':
				if (!e.shiftKey && col === NAV_COLS - 1) {
					e.preventDefault();
					nextCol = 0;
					nextRow = row + 1;
					shouldNavigate = true;
				} else if (e.shiftKey && col === 0) {
					e.preventDefault();
					nextCol = NAV_COLS - 1;
					nextRow = row - 1;
					shouldNavigate = true;
				} else {
					return; // Tab normal entre columnas adyacentes
				}
				break;
			case 'Enter':
				// Enter baja a la siguiente fila (como Excel)
				e.preventDefault();
				nextRow = row + 1;
				shouldNavigate = true;
				break;
			default:
				return; // no interceptar otras teclas (números, backspace, etc.)
		}

		if (!shouldNavigate) return;

		// Buscar el input destino
		const nextInput = document.querySelector<HTMLInputElement>(
			`input[data-nav-row="${nextRow}"][data-nav-col="${nextCol}"]`
		);
		if (nextInput) {
			nextInput.focus();
			nextInput.select();
		}
	}

	// Copiar horas a días siguientes
	function copiarSeleccionASiguientes() {
		if (!selectedRow || diasLaborales.length <= 1) return;

		const selectedIndex = diasLaborales.findIndex((dia) => dia.id === selectedRow);
		if (selectedIndex === -1 || selectedIndex >= diasLaborales.length - 1) return;

		const diaOrigen = diasLaborales[selectedIndex];
		const diaInicialNum = parseInt(diaOrigen.dia || '1', 10);
		const diasEnMes = new Date(currentYear, currentMonth, 0).getDate();

		const tieneHoras = !!(diaOrigen.hora_inicio || diaOrigen.hora_fin);
		if (!tieneHoras) return;

		diasLaborales = diasLaborales.map((dia, index) => {
			if (index <= selectedIndex) return dia;

			const incremento = index - selectedIndex;
			const nuevoDiaNum = diaInicialNum + incremento;
			const diaValido = nuevoDiaNum > diasEnMes ? diasEnMes.toString() : nuevoDiaNum.toString();

			return {
				...dia,
				dia: diaValido,
				hora_inicio: diaOrigen.hora_inicio,
				hora_fin: diaOrigen.hora_fin,
				kilometraje_inicial: diaOrigen.kilometraje_inicial,
				kilometraje_final: diaOrigen.kilometraje_final
			};
		});
	}

	// Incrementar días siguientes
	function incrementarDiasSiguientes() {
		if (!selectedRow || diasLaborales.length <= 1) return;

		const selectedIndex = diasLaborales.findIndex((dia) => dia.id === selectedRow);
		if (selectedIndex === -1 || selectedIndex >= diasLaborales.length - 1) return;

		const diaOrigen = diasLaborales[selectedIndex];
		const diaInicialNum = parseInt(diaOrigen.dia || '1', 10);
		const diasEnMes = new Date(currentYear, currentMonth, 0).getDate();

		diasLaborales = diasLaborales.map((dia, index) => {
			if (index <= selectedIndex) return dia;

			const incremento = index - selectedIndex;
			const nuevoDiaNum = diaInicialNum + incremento;
			const diaValido = nuevoDiaNum > diasEnMes ? diasEnMes.toString() : nuevoDiaNum.toString();

			return { ...dia, dia: diaValido };
		});
	}

	// Forzar reactividad de totales cuando cambian los diasLaborales
	$: totales = (() => {
		// Acceder a las propiedades relevantes para forzar reactividad
		diasLaborales.forEach((d) => {
			void d.hora_inicio;
			void d.hora_fin;
			void d.dia;
			void d.es_domingo;
			void d.es_festivo;
			void d.disponibilidad;
			void d.continua_siguiente_dia;
		});
		return calcularTotales();
	})();
	$: hayMasDeUnDia = diasLaborales.length > 1;
	$: selectedIndex = selectedRow ? diasLaborales.findIndex((d) => d.id === selectedRow) : -1;
	$: hayDiasSiguientes = selectedIndex !== -1 && selectedIndex < diasLaborales.length - 1;

	// Calcular total de horas trabajadas (suma de todas las jornadas)
	$: totalHorasTrabajadas = diasLaborales.reduce((total, dia) => {
		if (dia.disponibilidad) return total; // Excluir días disponibles
		if (!dia.hora_inicio || !dia.hora_fin) return total;
		const inicio = parseFloat(dia.hora_inicio);
		const fin = parseFloat(dia.hora_fin);
		if (isNaN(inicio) || isNaN(fin)) return total;

		let horas = fin - inicio;
		if (horas < 0) horas += 24; // Manejo de jornadas nocturnas
		return total + horas;
	}, 0);

	// Calcular total de kilometraje (suma de km recorridos por día)
	$: totalKilometraje = diasLaborales.reduce((total, dia) => {
		if (dia.disponibilidad) return total; // Excluir días disponibles
		if (!dia.kilometraje_inicial || !dia.kilometraje_final) return total;
		const inicial = parseFloat(dia.kilometraje_inicial);
		const final = parseFloat(dia.kilometraje_final);
		if (isNaN(inicial) || isNaN(final) || final < inicial) return total;
		return total + (final - inicial);
	}, 0);

	// Sincronizar duracion_trayecto_horas con el total de horas trabajadas
	$: {
		if (totalHorasTrabajadas > 0) {
			formData.duracion_trayecto_horas = totalHorasTrabajadas;
		}
	}

	// Crear filas automáticamente basado en numero_dias_servicio
	$: {
		const numeroDias = formData.numero_dias_servicio;
		if (numeroDias && numeroDias > 0 && !isLoadingData) {
			const diasActuales = diasLaborales.length;

			// Si el número es diferente, ajustar las filas
			if (diasActuales !== numeroDias) {
				if (numeroDias > diasActuales) {
					// Agregar filas vacías
					const filasNuevas = Array.from({ length: numeroDias - diasActuales }, (_, index) => ({
						id: (diasActuales + index + 1).toString(),
						dia: '',
						mes: currentMonth.toString(),
						año: currentYear.toString(),
						hora_inicio: '',
						hora_fin: '',
						kilometraje_inicial: null,
						kilometraje_final: null,
						es_domingo: false,
						es_festivo: false,
						pernocte: false,
						disponibilidad: false,
						continua_siguiente_dia: false
					}));
					diasLaborales = [...diasLaborales, ...filasNuevas];
				} else {
					// Reducir filas (mantener las primeras)
					diasLaborales = diasLaborales.slice(0, numeroDias);
				}
			}
		}
	}

	// Obtener todos los mensajes de error actuales
	$: mensajesError = [
		// Errores de días
		...Object.entries(erroresDias)
			.filter(([_, error]) => error)
			.map(([id, error]) => {
				const dia = diasLaborales.find((d) => d.id === id);
				const diaNum = dia?.dia || '?';
				return `Día ${diaNum}: ${error}`;
			}),
		// Errores de horas
		...Object.entries(erroresHoras)
			.filter(([_, errores]) => errores.inicio || errores.fin)
			.map(([id, errores]) => {
				const dia = diasLaborales.find((d) => d.id === id);
				const diaNum = dia?.dia || '?';
				const mensajes = [];
				if (errores.inicio) mensajes.push(`Día ${diaNum} - Hora Inicio: ${errores.inicio}`);
				if (errores.fin) mensajes.push(`Día ${diaNum} - Hora Fin: ${errores.fin}`);
				return mensajes.join('; ');
			})
	];

	// Cargar datos del recargo a editar
	async function cargarDatosRecargo(id: string) {
		// Evitar cargar el mismo recargo múltiples veces
		if (lastLoadedRecargoId === id && isLoadingData) {
			return;
		}

		try {
			lastLoadedRecargoId = id;
			isLoadingData = true;

			const recargo = await recargosApi.obtenerPorId(id);

			if (recargo) {
				// Verificar si viene de un servicio
				fromServicio = !!recargo.servicio_id;

				// Extraer info del servicio si existe
				if (recargo.servicio_id && (recargo as any).servicio) {
					const svc = (recargo as any).servicio;
					const origen = svc.municipios_servicio_origen_idTomunicipios || null;
					const destino = svc.municipios_servicio_destino_idTomunicipios || null;

					servicioOrigenSeleccionado = origen;
					servicioDestinoSeleccionado = destino;
					searchServicioOrigen = origen?.nombre_municipio || '';
					searchServicioDestino = destino?.nombre_municipio || '';
					servicioOrigenEspecifico = svc.origen_especifico || '';
					servicioDestinoEspecifico = svc.destino_especifico || '';
					servicioOrigenLatitud = svc.origen_latitud || null;
					servicioOrigenLongitud = svc.origen_longitud || null;
					servicioDestinoLatitud = svc.destino_latitud || null;
					servicioDestinoLongitud = svc.destino_longitud || null;
					servicioObservaciones = svc.observaciones || '';
					servicioProposito = svc.proposito_servicio || 'personal';
					if (svc.fecha_realizacion) {
						const date = new Date(svc.fecha_realizacion);
						servicioFechaRealizacion = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
					} else {
						servicioFechaRealizacion = '';
					}
					mostrarServicioInfo = true;
				} else {
					mostrarServicioInfo = false;
				}

				formData = {
					conductorId: recargo.conductor_id,
					vehiculoId: recargo.vehiculo_id,
					empresaId: recargo.empresa_id,
					tmNumber: recargo.numero_planilla || '',
					servicio_id: recargo.servicio_id || null,

					// Estado del conductor
					estado_conductor: (recargo.estado_conductor || null) as
						'optimo' | 'fatigado' | 'regular' | 'malo' | null,

					// Condiciones de vía
					via_trocha: recargo.via_trocha || false,
					via_afirmado: recargo.via_afirmado || false,
					via_mixto: recargo.via_mixto || false,
					via_pavimentada: recargo.via_pavimentada || false,

					// Riesgos de seguridad
					riesgo_desniveles: recargo.riesgo_desniveles || false,
					riesgo_deslizamientos: recargo.riesgo_deslizamientos || false,
					riesgo_sin_senalizacion: recargo.riesgo_sin_senalizacion || false,
					riesgo_animales: recargo.riesgo_animales || false,
					riesgo_peatones: recargo.riesgo_peatones || false,
					riesgo_trafico_alto: recargo.riesgo_trafico_alto || false,

					// Evaluación
					fuente_consulta: (recargo.fuente_consulta || null) as
						'conductor' | 'gps' | 'cliente' | 'sistema' | null,
					calificacion_servicio: (recargo.calificacion_servicio || null) as
						'bueno' | 'regular' | 'malo' | null,

					// Métricas de tiempo
					tiempo_disponibilidad_horas: recargo.tiempo_disponibilidad_horas || null,
					duracion_trayecto_horas: recargo.duracion_trayecto_horas || null,
					numero_dias_servicio: recargo.numero_dias_servicio || null
				};

				if (recargo.planilla_s3key) {
					// TODO: Obtener URL firmada cuando esté implementado
					archivoExistenteKey = recargo.planilla_s3key;
				}

				// Cargar días laborales
				if (recargo.dias_laborales_planillas && recargo.dias_laborales_planillas.length > 0) {
					diasLaborales = recargo.dias_laborales_planillas.map((dia: any) => ({
						id: dia.id,
						dia: dia.dia.toString(),
						mes: currentMonth.toString(),
						año: currentYear.toString(),
						hora_inicio: dia.hora_inicio || '',
						hora_fin: dia.hora_fin || '',
						kilometraje_inicial: dia.kilometraje_inicial || null,
						kilometraje_final: dia.kilometraje_final || null,
						es_domingo: dia.es_domingo || false,
						es_festivo: dia.es_festivo || false,
						pernocte: dia.pernocte || false,
						disponibilidad: dia.disponibilidad || false,
						continua_siguiente_dia: dia.continua_siguiente_dia || false
					}));
				}
				editMode = true;
			}
		} catch (error) {
			console.error('Error cargando recargo:', error);
			toast.error('No se pudo cargar la información del recargo');
		} finally {
			isLoadingData = false;
		}
	}

	// Resetear formulario
	function resetearFormulario() {
		formData = {
			conductorId: '',
			vehiculoId: '',
			empresaId: '',
			tmNumber: '',
			servicio_id: null,

			// Estado del conductor
			estado_conductor: null,

			// Condiciones de vía
			via_trocha: true,
			via_afirmado: false,
			via_mixto: false,
			via_pavimentada: false,

			// Riesgos de seguridad
			riesgo_desniveles: false,
			riesgo_deslizamientos: false,
			riesgo_sin_senalizacion: false,
			riesgo_animales: false,
			riesgo_peatones: false,
			riesgo_trafico_alto: false,

			// Evaluación
			fuente_consulta: 'sistema',
			calificacion_servicio: 'bueno',

			// Métricas de tiempo
			tiempo_disponibilidad_horas: null,
			duracion_trayecto_horas: null,
			numero_dias_servicio: null
		};
		diasLaborales = [
			{
				id: '1',
				dia: '',
				mes: currentMonth.toString(),
				año: currentYear.toString(),
				hora_inicio: '',
				hora_fin: '',
				kilometraje_inicial: null,
				kilometraje_final: null,
				es_domingo: false,
				es_festivo: false,
				pernocte: false,
				disponibilidad: false,
				continua_siguiente_dia: false
			}
		];
		archivoAdjunto = null;
		archivoExistente = null;
		archivoExistenteKey = null;
		activeTab = 'informacion';
		editMode = false;
		fromServicio = false;
		mostrarServicioInfo = false;
		searchServicioOrigen = '';
		searchServicioDestino = '';
		showServicioOrigenDropdown = false;
		showServicioDestinoDropdown = false;
		servicioOrigenSeleccionado = null;
		servicioDestinoSeleccionado = null;
		servicioOrigenEspecifico = '';
		servicioDestinoEspecifico = '';
		servicioOrigenLatitud = null;
		servicioOrigenLongitud = null;
		servicioDestinoLatitud = null;
		servicioDestinoLongitud = null;
		servicioObservaciones = '';
		servicioProposito = 'personal';
		servicioFechaRealizacion = '';
		planillaGenerada = false; // Resetear flag para permitir nueva generación
		isGenerandoPlanilla = false; // Resetear loading de planilla
		lastLoadedRecargoId = null; // Resetear ID del último recargo cargado
	}

	// Handle submit
	async function handleSubmit() {
		// Validaciones
		if (!formData.conductorId || !formData.vehiculoId || !formData.empresaId) {
			toast.error('Por favor, complete conductor, vehículo y empresa');
			activeTab = 'informacion';
			return;
		}

		if (diasLaborales.length === 0) {
			toast.error('Debe agregar al menos un día laboral');
			activeTab = 'horarios';
			return;
		}

		if (diasLaborales.some((dia) => !dia.dia || !dia.hora_inicio || !dia.hora_fin)) {
			toast.error('Complete todos los días laborales agregados');
			activeTab = 'horarios';
			return;
		}

		// Revalidar todas las filas (las cargadas en edición nunca pasaron por
		// `actualizarDiaLaboral`) y frenar aquí: el servidor rechazaría igual,
		// pero con la celda ya marcada se sabe qué corregir.
		for (const dia of diasLaborales) {
			erroresDias[dia.id] = validarDia(dia.dia);
			erroresHoras[dia.id] = validarHorasDia(dia.id, dia);
		}
		erroresDias = erroresDias;
		erroresHoras = erroresHoras;
		if (hayErroresEnHorarios()) {
			toast.error('Revisa los campos marcados en Horarios');
			activeTab = 'horarios';
			return;
		}

		isLoading = true;

		try {
			if (editMode && recargoId) {
				// Para edición, enviar como JSON
				const updateData = {
					conductor_id: formData.conductorId,
					vehiculo_id: formData.vehiculoId,
					empresa_id: formData.empresaId,
					numero_planilla: formData.tmNumber,
					mes: currentMonth,
					año: currentYear,
					servicio_id: formData.servicio_id,

					// Datos del servicio (editables)
					servicio_origen_id: servicioOrigenSeleccionado?.id || null,
					servicio_destino_id: servicioDestinoSeleccionado?.id || null,
					servicio_origen_especifico: servicioOrigenEspecifico || null,
					servicio_destino_especifico: servicioDestinoEspecifico || null,
					servicio_origen_latitud: servicioOrigenLatitud,
					servicio_origen_longitud: servicioOrigenLongitud,
					servicio_destino_latitud: servicioDestinoLatitud,
					servicio_destino_longitud: servicioDestinoLongitud,
					servicio_observaciones: servicioObservaciones || null,
					servicio_proposito: servicioProposito || null,
					servicio_fecha_realizacion: servicioFechaRealizacion
						? new Date(servicioFechaRealizacion).toISOString()
						: null,

					// Estado del conductor
					estado_conductor: formData.estado_conductor,

					// Condiciones de vía
					via_trocha: formData.via_trocha,
					via_afirmado: formData.via_afirmado,
					via_mixto: formData.via_mixto,
					via_pavimentada: formData.via_pavimentada,

					// Riesgos de seguridad
					riesgo_desniveles: formData.riesgo_desniveles,
					riesgo_deslizamientos: formData.riesgo_deslizamientos,
					riesgo_sin_senalizacion: formData.riesgo_sin_senalizacion,
					riesgo_animales: formData.riesgo_animales,
					riesgo_peatones: formData.riesgo_peatones,
					riesgo_trafico_alto: formData.riesgo_trafico_alto,

					// Evaluación
					fuente_consulta: formData.fuente_consulta,
					calificacion_servicio: formData.calificacion_servicio,

					// Métricas de tiempo (convertir a number o null)
					tiempo_disponibilidad_horas: formData.tiempo_disponibilidad_horas
						? parseFloat(formData.tiempo_disponibilidad_horas.toString())
						: null,
					duracion_trayecto_horas: formData.duracion_trayecto_horas
						? parseFloat(formData.duracion_trayecto_horas.toString())
						: null,
					numero_dias_servicio: formData.numero_dias_servicio
						? parseInt(formData.numero_dias_servicio.toString())
						: null,

					dias_laborales: diasLaborales.map((dia) => ({
						dia: parseInt(dia.dia),
						hora_inicio: parseFloat(dia.hora_inicio),
						hora_fin: parseFloat(dia.hora_fin),
						total_horas: parseFloat(dia.hora_fin) - parseFloat(dia.hora_inicio),
						kilometraje_inicial: dia.kilometraje_inicial
							? parseFloat(dia.kilometraje_inicial)
							: null,
						kilometraje_final: dia.kilometraje_final ? parseFloat(dia.kilometraje_final) : null,
						es_domingo: esDomingo(parseInt(dia.dia), currentMonth, currentYear),
						es_festivo: dia.es_festivo,
						pernocte: dia.pernocte,
						disponibilidad: dia.disponibilidad,
						continua_siguiente_dia: dia.continua_siguiente_dia || false
					}))
				};

				// Si hay clave S3 existente y no se adjuntó archivo nuevo, preservarla
				if (archivoExistenteKey && !archivoAdjunto) {
					(updateData as any).planilla_s3key = archivoExistenteKey;
				}

				// TODO: Si hay archivo nuevo, necesitamos subirlo primero o implementar endpoint que acepte multipart
				// Por ahora, la actualización no soporta cambio de archivo
				if (archivoAdjunto) {
					toast.warning(
						'La actualización de archivos no está implementada aún. Se conservará el archivo actual.'
					);
				}

				await recargosStore.actualizarRecargo(recargoId, updateData as any);
			} else {
				// Para creación, enviar como JSON (no FormData por ahora)
				const recargoData: any = {
					conductor_id: formData.conductorId,
					vehiculo_id: formData.vehiculoId,
					empresa_id: formData.empresaId,
					numero_planilla: formData.tmNumber || null,
					mes: currentMonth,
					año: currentYear,
					servicio_id: formData.servicio_id,

					// Datos del servicio (crear si se completó)
					servicio_origen_id: servicioOrigenSeleccionado?.id || null,
					servicio_destino_id: servicioDestinoSeleccionado?.id || null,
					servicio_origen_especifico: servicioOrigenEspecifico || null,
					servicio_destino_especifico: servicioDestinoEspecifico || null,
					servicio_origen_latitud: servicioOrigenLatitud,
					servicio_origen_longitud: servicioOrigenLongitud,
					servicio_destino_latitud: servicioDestinoLatitud,
					servicio_destino_longitud: servicioDestinoLongitud,
					servicio_observaciones: servicioObservaciones || null,
					servicio_proposito: servicioProposito || null,
					servicio_fecha_realizacion: servicioFechaRealizacion
						? new Date(servicioFechaRealizacion).toISOString()
						: null,

					// Estado del conductor
					estado_conductor: formData.estado_conductor,

					// Condiciones de vía
					via_trocha: formData.via_trocha,
					via_afirmado: formData.via_afirmado,
					via_mixto: formData.via_mixto,
					via_pavimentada: formData.via_pavimentada,

					// Riesgos de seguridad
					riesgo_desniveles: formData.riesgo_desniveles,
					riesgo_deslizamientos: formData.riesgo_deslizamientos,
					riesgo_sin_senalizacion: formData.riesgo_sin_senalizacion,
					riesgo_animales: formData.riesgo_animales,
					riesgo_peatones: formData.riesgo_peatones,
					riesgo_trafico_alto: formData.riesgo_trafico_alto,

					// Evaluación
					fuente_consulta: formData.fuente_consulta,
					calificacion_servicio: formData.calificacion_servicio,

					// Métricas de tiempo (convertir a number o null)
					tiempo_disponibilidad_horas: formData.tiempo_disponibilidad_horas
						? parseFloat(formData.tiempo_disponibilidad_horas.toString())
						: null,
					duracion_trayecto_horas: formData.duracion_trayecto_horas
						? parseFloat(formData.duracion_trayecto_horas.toString())
						: null,
					numero_dias_servicio: formData.numero_dias_servicio
						? parseInt(formData.numero_dias_servicio.toString())
						: null,

					dias_laborales: diasLaborales.map((dia) => ({
						dia: parseInt(dia.dia),
						hora_inicio: parseFloat(dia.hora_inicio),
						hora_fin: parseFloat(dia.hora_fin),
						total_horas: parseFloat(dia.hora_fin) - parseFloat(dia.hora_inicio),
						kilometraje_inicial: dia.kilometraje_inicial
							? parseFloat(dia.kilometraje_inicial)
							: null,
						kilometraje_final: dia.kilometraje_final ? parseFloat(dia.kilometraje_final) : null,
						es_domingo: esDomingo(parseInt(dia.dia), currentMonth, currentYear),
						es_festivo: dia.es_festivo,
						pernocte: dia.pernocte,
						disponibilidad: dia.disponibilidad,
						continua_siguiente_dia: dia.continua_siguiente_dia || false
					}))
				};

				// TODO: Si hay archivo, implementar endpoint que acepte multipart
				if (archivoAdjunto) {
					toast.warning('La subida de archivos en creación no está implementada aún.');
				}

				await recargosStore.crearRecargo(recargoData as any);
			}

			handleClose();
		} catch (error) {
			console.error('Error en handleSubmit:', error);

			// Extraer mensaje de error
			let errorMessage = 'Error al procesar el recargo';

			if (error && typeof error === 'object') {
				if ('response' in error && error.response && typeof error.response === 'object') {
					const response = error.response as any;
					if (response.data?.message) {
						errorMessage = response.data.message;
					} else if (response.data?.error) {
						errorMessage = response.data.error;
					}
				} else if ('message' in error) {
					errorMessage = (error as any).message;
				}
			}

			// Si el servidor devolvió incidencias de zod sobre los días, marcar
			// la celda exacta además del toast. El modal sigue abierto.
			if (marcarErroresDelServidor(error)) activeTab = 'horarios';
			toast.error(errorMessage);
		} finally {
			isLoading = false;
		}
	}

	// Handle close
	function handleClose() {
		resetearFormulario();
		isOpen = false;
		dispatch('close');
	}

	// Handle file change
	function handleFileChange(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			archivoAdjunto = target.files[0];
			// Si adjunta archivo nuevo, descartar el existente
			if (archivoAdjunto) {
				archivoExistente = null;
				archivoExistenteKey = null;
			}
		}
	}

	// Cargar recursos al abrir
	// Filtrado reactivo de municipios para servicio
	$: filteredServicioOrigen =
		searchServicioOrigen.length >= 2
			? ($municipios.municipios || [])
					.filter(
						(m: any) =>
							m.nombre_municipio.toLowerCase().includes(searchServicioOrigen.toLowerCase()) ||
							m.nombre_departamento.toLowerCase().includes(searchServicioOrigen.toLowerCase())
					)
					.slice(0, 20)
			: [];

	$: filteredServicioDestino =
		searchServicioDestino.length >= 2
			? ($municipios.municipios || [])
					.filter(
						(m: any) =>
							m.nombre_municipio.toLowerCase().includes(searchServicioDestino.toLowerCase()) ||
							m.nombre_departamento.toLowerCase().includes(searchServicioDestino.toLowerCase())
					)
					.slice(0, 20)
			: [];

	onMount(async () => {
		await recursos.cargarConductores();
		await recursos.cargarVehiculos();
		await recursos.cargarClientes();
		await municipios.cargarTodos();
	});

	// Cargar datos al abrir en modo edición o generar número de planilla en modo creación
	$: {
		if (isOpen && recargoId && !isLoadingData && lastLoadedRecargoId !== recargoId) {
			editMode = true;
			cargarDatosRecargo(recargoId);
		} else if (isOpen && recargoId && isLoadingData) {
		} else if (isOpen && !recargoId && !planillaGenerada && !isGenerandoPlanilla) {
			editMode = false;
			// Auto-generar número de planilla para nuevo recargo
			generarNumeroPlanilla();
		}
	}
</script>

<ModalBase
	open={isOpen}
	eyebrow="{getNombreMes(currentMonth)} {currentYear}"
	title={editMode ? 'Editar Recargo' : 'Nuevo Recargo'}
	subtitle={fromServicio ? 'Vinculado a un servicio' : null}
	tamano="xl"
	bloqueado={isLoading || mostrarModalEmpresa || mostrarModalConductor || mostrarModalVehiculo}
	oncerrar={handleClose}
>
	{#snippet accionesCabecera()}
		<div
			class="rf-progreso"
			title="{progress.completed} de {progress.total} completado"
			aria-label="{progress.completed} de {progress.total} completado"
		>
			<span class="rf-progreso-num">{progress.completed}/{progress.total}</span>
			<span class="rf-progreso-barra" aria-hidden="true">
				<span style="width: {(progress.completed / progress.total) * 100}%;"></span>
			</span>
		</div>
	{/snippet}

	{#snippet cabecera()}
		<!-- Pestañas del formulario. En móvil cada una reparte el ancho y lleva
		     el nombre corto, para que la fila no desborde. -->
		<div class="rf-tabs" role="tablist" aria-label="Secciones del recargo">
			<button
				type="button"
				role="tab"
				class="rf-tab"
				class:activa={activeTab === 'informacion'}
				aria-selected={activeTab === 'informacion'}
				onclick={() => (activeTab = 'informacion')}
			>
				<span class="rf-tab-largo">Información Principal</span>
				<span class="rf-tab-corto">Información</span>
				{#if tabCompleted.informacion}
					<CircleCheck class="rf-tab-check" size={15} strokeWidth={2.5} aria-label="Completo" />
				{/if}
			</button>
			<button
				type="button"
				role="tab"
				class="rf-tab"
				class:activa={activeTab === 'condiciones'}
				aria-selected={activeTab === 'condiciones'}
				onclick={() => (activeTab = 'condiciones')}
			>
				<span class="rf-tab-largo">Condiciones y Evaluación</span>
				<span class="rf-tab-corto">Condiciones</span>
				<span class="rf-tab-opcional">Opcional</span>
				{#if tabCompleted.condiciones}
					<CircleCheck class="rf-tab-check" size={15} strokeWidth={2.5} aria-label="Completo" />
				{/if}
			</button>
			<button
				type="button"
				role="tab"
				class="rf-tab"
				class:activa={activeTab === 'horarios'}
				aria-selected={activeTab === 'horarios'}
				onclick={() => (activeTab = 'horarios')}
			>
				<span class="rf-tab-largo">Horarios de Trabajo</span>
				<span class="rf-tab-corto">Horarios</span>
				{#if tabCompleted.horarios}
					<CircleCheck class="rf-tab-check" size={15} strokeWidth={2.5} aria-label="Completo" />
				{/if}
			</button>
		</div>
	{/snippet}

	{#if isLoadingData}
		<div class="rf-cargando" aria-live="polite">
			<span class="rf-spinner" aria-hidden="true"></span>
			<p>Cargando datos del recargo...</p>
		</div>
	{:else if activeTab === 'informacion'}
		<!-- Tab: Información Principal -->
		<div class="rf" transition:fade={{ duration: 200 }}>
			<section class="rf-seccion">
				<h3 class="rf-titulo">Datos principales</h3>
				<div class="rf-card">
					<div class="rf-grid">
						<!-- Conductor -->
						<Campo id="rf-conductor" label="Conductor" requerido>
							<div class="rf-fila-control">
								<div class="rf-buscador">
									{#if conductorSeleccionado}
										<div class="rf-elegido">
											<div class="rf-elegido-texto">
												<span class="rf-elegido-nombre">
													{conductorSeleccionado.nombre}
													{conductorSeleccionado.apellido}
												</span>
												{#if conductorSeleccionado.numero_identificacion}
													<span class="rf-elegido-sub">
														CC {conductorSeleccionado.numero_identificacion}
													</span>
												{/if}
											</div>
											{#if !fromServicio}
												<button
													type="button"
													onclick={() => {
														formData.conductorId = '';
														searchConductor = '';
													}}
													aria-label="Cambiar conductor"
													class="rf-quitar"
												>
													<X size={16} strokeWidth={2.5} />
												</button>
											{/if}
										</div>
									{:else}
										<input
											id="rf-conductor"
											type="text"
											bind:value={searchConductor}
											onfocus={() => (showConductorDropdown = true)}
											onblur={() => setTimeout(() => (showConductorDropdown = false), 200)}
											onkeydown={handleConductorKeydown}
											placeholder="Buscar conductor por nombre..."
											disabled={fromServicio}
											autocomplete="off"
											class="rf-input"
										/>
										{#if showConductorDropdown && conductoresFiltrados.length > 0}
											<div id="dropdown-conductor" class="rf-lista">
												{#each conductoresFiltrados as conductor, i}
													<button
														type="button"
														data-dropdown-item
														onclick={() => {
															formData.conductorId = conductor.id;
															showConductorDropdown = false;
															highlightConductor = -1;
														}}
														class="rf-opcion"
														class:activa={highlightConductor === i}
													>
														<span class="rf-opcion-nombre">
															{conductor.nombre}
															{conductor.apellido}
														</span>
														{#if conductor.numero_identificacion}
															<span class="rf-opcion-sub">CC {conductor.numero_identificacion}</span
															>
														{/if}
													</button>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
								<button
									type="button"
									onclick={() => (mostrarModalConductor = true)}
									class="rf-btn-icono"
									title="Crear nuevo conductor"
									aria-label="Crear nuevo conductor"
								>
									<Plus size={18} strokeWidth={2.5} />
								</button>
							</div>
						</Campo>

						<!-- Vehículo -->
						<Campo id="rf-vehiculo" label="Vehículo" requerido>
							<div class="rf-fila-control">
								<div class="rf-buscador">
									{#if vehiculoSeleccionado}
										<div class="rf-elegido">
											<div class="rf-elegido-texto">
												<span class="rf-elegido-nombre">{vehiculoSeleccionado.placa}</span>
												{#if vehiculoSeleccionado.marca}
													<span class="rf-elegido-sub">
														{vehiculoSeleccionado.marca}
														{vehiculoSeleccionado.linea || ''}
														{vehiculoSeleccionado.modelo || ''}
													</span>
												{/if}
											</div>
											{#if !fromServicio}
												<button
													type="button"
													onclick={() => {
														formData.vehiculoId = '';
														searchVehiculo = '';
													}}
													aria-label="Cambiar vehículo"
													class="rf-quitar"
												>
													<X size={16} strokeWidth={2.5} />
												</button>
											{/if}
										</div>
									{:else}
										<input
											id="rf-vehiculo"
											type="text"
											bind:value={searchVehiculo}
											onfocus={() => (showVehiculoDropdown = true)}
											onblur={() => setTimeout(() => (showVehiculoDropdown = false), 200)}
											onkeydown={handleVehiculoKeydown}
											placeholder="Buscar vehículo por placa..."
											disabled={fromServicio}
											autocomplete="off"
											class="rf-input"
										/>
										{#if showVehiculoDropdown && vehiculosFiltrados.length > 0}
											<div id="dropdown-vehiculo" class="rf-lista">
												{#each vehiculosFiltrados as vehiculo, i}
													<button
														type="button"
														data-dropdown-item
														onclick={() => {
															formData.vehiculoId = vehiculo.id;
															showVehiculoDropdown = false;
															highlightVehiculo = -1;
														}}
														class="rf-opcion"
														class:activa={highlightVehiculo === i}
													>
														<span class="rf-opcion-nombre">{vehiculo.placa}</span>
														{#if vehiculo.marca}
															<span class="rf-opcion-sub">
																{vehiculo.marca}
																{vehiculo.linea || ''}
																{vehiculo.modelo || ''}
															</span>
														{/if}
													</button>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
								{#if !vehiculoSeleccionado}
									<button
										type="button"
										onclick={() => (mostrarModalVehiculo = true)}
										class="rf-btn-icono"
										title="Crear nuevo vehículo"
										aria-label="Crear nuevo vehículo"
									>
										<Plus size={18} strokeWidth={2.5} />
									</button>
								{/if}
							</div>
						</Campo>

						<!-- Empresa -->
						<Campo id="rf-empresa" label="Empresa" requerido>
							<div class="rf-fila-control">
								<div class="rf-buscador">
									{#if empresaSeleccionada}
										<div class="rf-elegido">
											<div class="rf-elegido-texto">
												<span class="rf-elegido-nombre">{empresaSeleccionada.nombre}</span>
												{#if empresaSeleccionada.nit}
													<span class="rf-elegido-sub">NIT: {empresaSeleccionada.nit}</span>
												{/if}
											</div>
											{#if !fromServicio}
												<button
													type="button"
													onclick={() => {
														formData.empresaId = '';
														searchEmpresa = '';
													}}
													aria-label="Cambiar empresa"
													class="rf-quitar"
												>
													<X size={16} strokeWidth={2.5} />
												</button>
											{/if}
										</div>
									{:else}
										<input
											id="rf-empresa"
											type="text"
											bind:value={searchEmpresa}
											onfocus={() => (showEmpresaDropdown = true)}
											onblur={() => setTimeout(() => (showEmpresaDropdown = false), 200)}
											onkeydown={handleEmpresaKeydown}
											placeholder="Buscar empresa por nombre..."
											disabled={fromServicio}
											autocomplete="off"
											class="rf-input"
										/>
										{#if showEmpresaDropdown && empresasFiltradas.length > 0}
											<div id="dropdown-empresa" class="rf-lista">
												{#each empresasFiltradas as empresa, i}
													<button
														type="button"
														data-dropdown-item
														onclick={() => {
															formData.empresaId = empresa.id;
															showEmpresaDropdown = false;
															highlightEmpresa = -1;
														}}
														class="rf-opcion"
														class:activa={highlightEmpresa === i}
													>
														<span class="rf-opcion-nombre">{empresa.nombre}</span>
														{#if empresa.nit}
															<span class="rf-opcion-sub">NIT: {empresa.nit}</span>
														{/if}
													</button>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
								<button
									type="button"
									onclick={() => (mostrarModalEmpresa = true)}
									class="rf-btn-icono"
									title="Crear nueva empresa"
									aria-label="Crear nueva empresa"
								>
									<Plus size={18} strokeWidth={2.5} />
								</button>
							</div>
						</Campo>

						<!-- Número de planilla -->
						<Campo
							id="tm-number"
							label="Número de Planilla"
							ayuda="Se genera automáticamente; puede escribirlo o regenerarlo."
						>
							<div class="rf-fila-control">
								<div class="rf-buscador">
									<input
										id="tm-number"
										type="text"
										bind:value={formData.tmNumber}
										placeholder={isGenerandoPlanilla ? 'Generando...' : 'TM-0001'}
										class="rf-input rf-input-planilla"
										class:lleno={!!formData.tmNumber}
									/>
									{#if isGenerandoPlanilla}
										<span class="rf-input-spinner" aria-hidden="true">
											<LoaderCircle class="rf-spin" size={18} />
										</span>
									{/if}
								</div>
								<button
									type="button"
									onclick={() => generarNumeroPlanilla({ force: true })}
									disabled={isGenerandoPlanilla}
									aria-label="Regenerar número de planilla"
									title={isGenerandoPlanilla
										? 'Generando...'
										: 'Regenerar número de planilla (consulta el siguiente disponible en el backend)'}
									class="btn-secondary rf-btn-regenerar"
								>
									{#if isGenerandoPlanilla}
										<LoaderCircle class="rf-spin" size={16} />
										<span>Generando…</span>
									{:else}
										<RefreshCw size={16} />
										<span>Regenerar</span>
									{/if}
								</button>
							</div>
						</Campo>
					</div>
				</div>
			</section>

			<!-- Información del Servicio (Editable) -->
			{#if mostrarServicioInfo || fromServicio}
				<section class="rf-seccion">
					<div class="rf-titulo-fila">
						<div>
							<h3 class="rf-titulo">Información del Servicio</h3>
							<p class="rf-titulo-sub">
								{fromServicio
									? 'Editar datos del servicio vinculado'
									: 'Registrar servicio opcional para este recargo'}
							</p>
						</div>
						{#if !fromServicio}
							<button
								type="button"
								onclick={() => {
									mostrarServicioInfo = false;
								}}
								class="rf-quitar"
								aria-label="Ocultar formulario de servicio"
								title="Ocultar formulario de servicio"
							>
								<X size={16} strokeWidth={2.5} />
							</button>
						{/if}
					</div>
					<div class="rf-card">
						<div class="rf-grid">
							<!-- Municipio Origen -->
							<Campo id="rf-servicio-origen" label="Municipio Origen">
								<div class="rf-buscador">
									{#if servicioOrigenSeleccionado}
										<div class="rf-elegido">
											<div class="rf-elegido-texto">
												<span class="rf-elegido-nombre">
													{servicioOrigenSeleccionado.nombre_municipio}
												</span>
												<span class="rf-elegido-sub">
													{servicioOrigenSeleccionado.nombre_departamento}
													<span class="rf-codigo">
														DIVIPOLA: {servicioOrigenSeleccionado.codigo_municipio}
													</span>
												</span>
											</div>
											<button
												type="button"
												onclick={() => {
													servicioOrigenSeleccionado = null;
													searchServicioOrigen = '';
													servicioOrigenEspecifico = '';
													servicioOrigenLatitud = null;
													servicioOrigenLongitud = null;
												}}
												class="rf-quitar"
												aria-label="Cambiar municipio origen"
											>
												<X size={16} strokeWidth={2.5} />
											</button>
										</div>
									{:else}
										<input
											id="rf-servicio-origen"
											type="text"
											bind:value={searchServicioOrigen}
											onfocus={() => (showServicioOrigenDropdown = true)}
											onblur={() => setTimeout(() => (showServicioOrigenDropdown = false), 200)}
											placeholder="Buscar municipio de origen..."
											autocomplete="off"
											class="rf-input"
										/>
										{#if showServicioOrigenDropdown && filteredServicioOrigen.length > 0}
											<div class="rf-lista">
												{#each filteredServicioOrigen as mun}
													<button
														type="button"
														onclick={() => {
															servicioOrigenSeleccionado = mun;
															showServicioOrigenDropdown = false;
															searchServicioOrigen = '';
														}}
														class="rf-opcion"
													>
														<span class="rf-opcion-nombre">{mun.nombre_municipio}</span>
														<span class="rf-opcion-sub">
															{mun.nombre_departamento}
															<span class="rf-codigo">{mun.codigo_municipio}</span>
														</span>
													</button>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
							</Campo>

							<!-- Municipio Destino -->
							<Campo id="rf-servicio-destino" label="Municipio Destino">
								<div class="rf-buscador">
									{#if servicioDestinoSeleccionado}
										<div class="rf-elegido">
											<div class="rf-elegido-texto">
												<span class="rf-elegido-nombre">
													{servicioDestinoSeleccionado.nombre_municipio}
												</span>
												<span class="rf-elegido-sub">
													{servicioDestinoSeleccionado.nombre_departamento}
													<span class="rf-codigo">
														DIVIPOLA: {servicioDestinoSeleccionado.codigo_municipio}
													</span>
												</span>
											</div>
											<button
												type="button"
												onclick={() => {
													servicioDestinoSeleccionado = null;
													searchServicioDestino = '';
													servicioDestinoEspecifico = '';
													servicioDestinoLatitud = null;
													servicioDestinoLongitud = null;
												}}
												class="rf-quitar"
												aria-label="Cambiar municipio destino"
											>
												<X size={16} strokeWidth={2.5} />
											</button>
										</div>
									{:else}
										<input
											id="rf-servicio-destino"
											type="text"
											bind:value={searchServicioDestino}
											onfocus={() => (showServicioDestinoDropdown = true)}
											onblur={() => setTimeout(() => (showServicioDestinoDropdown = false), 200)}
											placeholder="Buscar municipio de destino..."
											autocomplete="off"
											class="rf-input"
										/>
										{#if showServicioDestinoDropdown && filteredServicioDestino.length > 0}
											<div class="rf-lista">
												{#each filteredServicioDestino as mun}
													<button
														type="button"
														onclick={() => {
															servicioDestinoSeleccionado = mun;
															showServicioDestinoDropdown = false;
															searchServicioDestino = '';
														}}
														class="rf-opcion"
													>
														<span class="rf-opcion-nombre">{mun.nombre_municipio}</span>
														<span class="rf-opcion-sub">
															{mun.nombre_departamento}
															<span class="rf-codigo">{mun.codigo_municipio}</span>
														</span>
													</button>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
							</Campo>

							<!-- Dirección Origen Específica -->
							<div class="rf-mapbox">
								<MapboxSearch
									label="Dirección Origen Específica"
									placeholder="Buscar dirección de origen..."
									value={servicioOrigenEspecifico}
									onSelect={(data) => {
										servicioOrigenEspecifico = data.address;
										servicioOrigenLatitud = data.coordinates[1];
										servicioOrigenLongitud = data.coordinates[0];
									}}
								/>
							</div>

							<!-- Dirección Destino Específica -->
							<div class="rf-mapbox">
								<MapboxSearch
									label="Dirección Destino Específica"
									placeholder="Buscar dirección de destino..."
									value={servicioDestinoEspecifico}
									onSelect={(data) => {
										servicioDestinoEspecifico = data.address;
										servicioDestinoLatitud = data.coordinates[1];
										servicioDestinoLongitud = data.coordinates[0];
									}}
								/>
							</div>

							<!-- Fecha de Realización -->
							<Campo id="rf-servicio-fecha" label="Fecha y hora de realización">
								<input
									id="rf-servicio-fecha"
									type="datetime-local"
									bind:value={servicioFechaRealizacion}
									class="rf-input"
								/>
							</Campo>

							<!-- Propósito del Servicio -->
							<Campo id="rf-servicio-proposito" label="Tipo de Servicio">
								<select id="rf-servicio-proposito" bind:value={servicioProposito} class="rf-input">
									<option value="personal">Personal</option>
									<option value="personal_y_herramienta">Personal y Herramienta</option>
								</select>
							</Campo>

							<!-- Observaciones -->
							<Campo id="rf-servicio-observaciones" label="Observaciones del Servicio" completo>
								<textarea
									id="rf-servicio-observaciones"
									bind:value={servicioObservaciones}
									rows="2"
									placeholder="Observaciones adicionales del servicio..."
									class="rf-input"
								></textarea>
							</Campo>
						</div>
					</div>
				</section>
			{:else if !fromServicio}
				<!-- Botón para mostrar formulario de servicio en modo creación -->
				<button
					type="button"
					onclick={() => {
						mostrarServicioInfo = true;
					}}
					class="rf-agregar"
				>
					<Plus size={18} strokeWidth={2.5} />
					Agregar información de servicio (opcional)
				</button>
			{/if}

			<!-- Archivo adjunto -->
			<section class="rf-seccion">
				<h3 class="rf-titulo">Archivo PDF <span class="rf-titulo-nota">Opcional</span></h3>

				{#if archivoExistente}
					<div class="rf-archivo">
						<span class="rf-archivo-icono"><FileText size={20} /></span>
						<div class="rf-archivo-texto">
							<span class="rf-elegido-nombre">Archivo existente</span>
							<span class="rf-elegido-sub">Documento PDF adjunto previamente</span>
						</div>
						<button
							type="button"
							onclick={() => {
								archivoExistente = null;
								archivoExistenteKey = null;
							}}
							aria-label="Eliminar archivo existente"
							class="rf-quitar"
						>
							<Trash2 size={16} />
						</button>
					</div>
				{:else if archivoAdjunto}
					<div class="rf-archivo">
						<span class="rf-archivo-icono"><FileText size={20} /></span>
						<div class="rf-archivo-texto">
							<span class="rf-elegido-nombre">{archivoAdjunto.name}</span>
							<span class="rf-elegido-sub">
								{(archivoAdjunto.size / 1024 / 1024).toFixed(2)} MB
							</span>
						</div>
						<button
							type="button"
							onclick={() => (archivoAdjunto = null)}
							aria-label="Eliminar archivo adjunto"
							class="rf-quitar"
						>
							<Trash2 size={16} />
						</button>
					</div>
				{:else}
					<label class="rf-soltar">
						<span class="rf-archivo-icono"><Upload size={20} /></span>
						<span class="rf-soltar-texto">Haga clic para seleccionar un archivo PDF</span>
						<input
							type="file"
							accept="application/pdf"
							onchange={handleFileChange}
							class="rf-oculto"
						/>
					</label>
				{/if}
			</section>
		</div>
	{:else if activeTab === 'condiciones'}
		<!-- Tab: Condiciones y Evaluación -->
		<div class="rf" transition:fade={{ duration: 200 }}>
			<!-- Banner informativo -->
			<div class="rf-aviso rf-aviso--marca">
				<ShieldCheck class="rf-aviso-icono" size={20} />
				<div>
					<p class="rf-aviso-titulo">Sección Opcional - Preaprobada</p>
					<p class="rf-aviso-texto">
						Esta sección ya está validada con valores óptimos por defecto. Puede modificar los
						campos si desea agregar información específica del servicio, pero no es necesario para
						crear el recargo.
					</p>
				</div>
			</div>

			<!-- Estado del Conductor -->
			<section class="rf-seccion">
				<h3 class="rf-titulo">Estado del Conductor</h3>
				<div class="rf-card">
					<div class="rf-grid">
						<Campo id="estado-conductor" label="Estado Físico/Mental">
							<select id="estado-conductor" bind:value={formData.estado_conductor} class="rf-input">
								<option value={null}>Seleccione...</option>
								<option value="optimo">Óptimo</option>
								<option value="fatigado">Fatigado</option>
								<option value="regular">Regular</option>
								<option value="malo">Malo</option>
							</select>
						</Campo>
					</div>
				</div>
			</section>

			<!-- Tipo de Terreno -->
			<section class="rf-seccion">
				<h3 class="rf-titulo">Tipo de Terreno Transitado</h3>
				<div class="rf-card">
					<div class="rf-chips">
						<label class="rf-chip" class:activo={formData.via_trocha}>
							<input type="checkbox" bind:checked={formData.via_trocha} class="rf-oculto" />
							{#if formData.via_trocha}<Check size={14} strokeWidth={3} />{/if}
							Trocha
						</label>
						<label class="rf-chip" class:activo={formData.via_afirmado}>
							<input type="checkbox" bind:checked={formData.via_afirmado} class="rf-oculto" />
							{#if formData.via_afirmado}<Check size={14} strokeWidth={3} />{/if}
							Afirmado
						</label>
						<label class="rf-chip" class:activo={formData.via_mixto}>
							<input type="checkbox" bind:checked={formData.via_mixto} class="rf-oculto" />
							{#if formData.via_mixto}<Check size={14} strokeWidth={3} />{/if}
							Mixto
						</label>
						<label class="rf-chip" class:activo={formData.via_pavimentada}>
							<input type="checkbox" bind:checked={formData.via_pavimentada} class="rf-oculto" />
							{#if formData.via_pavimentada}<Check size={14} strokeWidth={3} />{/if}
							Pavimentada
						</label>
					</div>
				</div>
			</section>

			<!-- Riesgos de Seguridad -->
			<section class="rf-seccion">
				<h3 class="rf-titulo">Riesgos y Condiciones de Seguridad</h3>
				<div class="rf-card">
					<div class="rf-chips">
						<label class="rf-chip rf-chip--riesgo" class:activo={formData.riesgo_desniveles}>
							<input type="checkbox" bind:checked={formData.riesgo_desniveles} class="rf-oculto" />
							{#if formData.riesgo_desniveles}<TriangleAlert size={14} strokeWidth={2.5} />{/if}
							Desniveles
						</label>
						<label class="rf-chip rf-chip--riesgo" class:activo={formData.riesgo_deslizamientos}>
							<input
								type="checkbox"
								bind:checked={formData.riesgo_deslizamientos}
								class="rf-oculto"
							/>
							{#if formData.riesgo_deslizamientos}<TriangleAlert size={14} strokeWidth={2.5} />{/if}
							Deslizamientos
						</label>
						<label class="rf-chip rf-chip--riesgo" class:activo={formData.riesgo_sin_senalizacion}>
							<input
								type="checkbox"
								bind:checked={formData.riesgo_sin_senalizacion}
								class="rf-oculto"
							/>
							{#if formData.riesgo_sin_senalizacion}<TriangleAlert
									size={14}
									strokeWidth={2.5}
								/>{/if}
							Sin Señalización
						</label>
						<label class="rf-chip rf-chip--riesgo" class:activo={formData.riesgo_animales}>
							<input type="checkbox" bind:checked={formData.riesgo_animales} class="rf-oculto" />
							{#if formData.riesgo_animales}<TriangleAlert size={14} strokeWidth={2.5} />{/if}
							Animales en Vía
						</label>
						<label class="rf-chip rf-chip--riesgo" class:activo={formData.riesgo_peatones}>
							<input type="checkbox" bind:checked={formData.riesgo_peatones} class="rf-oculto" />
							{#if formData.riesgo_peatones}<TriangleAlert size={14} strokeWidth={2.5} />{/if}
							Peatones
						</label>
						<label class="rf-chip rf-chip--riesgo" class:activo={formData.riesgo_trafico_alto}>
							<input
								type="checkbox"
								bind:checked={formData.riesgo_trafico_alto}
								class="rf-oculto"
							/>
							{#if formData.riesgo_trafico_alto}<TriangleAlert size={14} strokeWidth={2.5} />{/if}
							Tráfico Alto
						</label>
					</div>
				</div>
			</section>

			<!-- Evaluación del Servicio -->
			<section class="rf-seccion">
				<h3 class="rf-titulo">Evaluación del Servicio</h3>
				<div class="rf-card">
					<div class="rf-grid">
						<Campo id="fuente-consulta" label="Fuente de Consulta">
							<select id="fuente-consulta" bind:value={formData.fuente_consulta} class="rf-input">
								<option value={null}>Seleccione...</option>
								<option value="conductor">Conductor</option>
								<option value="gps">GPS</option>
								<option value="cliente">Cliente</option>
								<option value="sistema">Sistema</option>
							</select>
						</Campo>
						<Campo id="calificacion-servicio" label="Calificación del Servicio">
							<select
								id="calificacion-servicio"
								bind:value={formData.calificacion_servicio}
								class="rf-input"
							>
								<option value={null}>Seleccione...</option>
								<option value="bueno">Bueno</option>
								<option value="regular">Regular</option>
								<option value="malo">Malo</option>
							</select>
						</Campo>
					</div>
				</div>
			</section>

			<!-- Métricas de Tiempo -->
			<section class="rf-seccion">
				<h3 class="rf-titulo">Métricas de Tiempo</h3>
				<div class="rf-card">
					<div class="rf-grid rf-grid--4">
						<Campo id="tiempo-disponibilidad" label="Tiempo Disponibilidad (horas)">
							<input
								id="tiempo-disponibilidad"
								type="number"
								step="0.1"
								min="0"
								bind:value={formData.tiempo_disponibilidad_horas}
								placeholder="Ej: 12.5"
								class="rf-input rf-num"
							/>
						</Campo>
						<Campo id="duracion-trayecto" label="Duración Trayecto (horas)">
							<input
								id="duracion-trayecto"
								type="number"
								step="0.1"
								min="0"
								value={totalHorasTrabajadas.toFixed(1)}
								disabled
								class="rf-input rf-num"
							/>
						</Campo>
						<Campo id="numero-dias-servicio" label="Número de Días Servicio">
							<input
								id="numero-dias-servicio"
								type="number"
								min="1"
								bind:value={formData.numero_dias_servicio}
								placeholder="Ej: 3"
								class="rf-input rf-num"
							/>
						</Campo>
						<Campo id="total-kilometraje" label="Total Kilometraje (km)">
							<input
								id="total-kilometraje"
								type="number"
								step="0.1"
								min="0"
								value={totalKilometraje.toFixed(1)}
								disabled
								class="rf-input rf-num"
							/>
						</Campo>
					</div>
				</div>
			</section>
		</div>
	{:else if activeTab === 'horarios'}
		<!-- Tab: Horarios de Trabajo -->
		<div class="rf" transition:fade={{ duration: 200 }}>
			<!-- Indicador de festivos colombianos -->
			{#if festivosDelMes.length > 0}
				<div class="rf-aviso rf-aviso--marca">
					<Calendar class="rf-aviso-icono" size={20} />
					<div>
						<p class="rf-aviso-titulo">
							Días Festivos de {getNombreMes(currentMonth)}
							{currentYear}
						</p>
						<p class="rf-aviso-texto">
							{festivosDelMes.length}
							{festivosDelMes.length === 1 ? 'festivo' : 'festivos'}:
							{festivosDelMes.map((f) => `${f.dia} (${f.nombre})`).join(', ')}
						</p>
						<p class="rf-aviso-texto">
							Los días festivos se marcan automáticamente con la etiqueta «Festivo».
						</p>
					</div>
				</div>
			{/if}

			<!-- Panel de acciones de copiado -->
			{#if selectedRow && hayMasDeUnDia}
				<div class="rf-copiado">
					<div class="rf-copiado-fila">
						<span class="rf-copiado-texto">
							<Copy size={16} />
							Fila seleccionada: {selectedIndex + 1} de {diasLaborales.length}
						</span>
						<div class="rf-copiado-acciones">
							<button
								type="button"
								onclick={copiarSeleccionASiguientes}
								disabled={!hayDiasSiguientes}
								class="btn-primary rf-btn-compacto"
							>
								<Copy size={16} />
								Copiar Horas
							</button>
							<button
								type="button"
								onclick={incrementarDiasSiguientes}
								disabled={!hayDiasSiguientes}
								class="btn-secondary rf-btn-compacto"
							>
								<Plus size={16} />
								Incrementar Días
							</button>
							<button type="button" onclick={() => (selectedRow = null)} class="rf-enlace">
								Cancelar
							</button>
						</div>
					</div>
					{#if !hayDiasSiguientes}
						<p class="rf-copiado-nota">No hay días siguientes para aplicar estas acciones</p>
					{/if}
				</div>
			{/if}

			<!-- Mensajes de error -->
			{#if mensajesError.length > 0}
				<div class="rf-errores">
					{#each mensajesError as mensaje}
						<div class="rf-error" role="alert">
							<CircleAlert size={16} />
							<span>{mensaje}</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Botón agregar día - OCULTO: Los días se generan automáticamente según numero_dias_servicio -->

			{#if !formData.numero_dias_servicio || formData.numero_dias_servicio <= 0}
				<!-- Mensaje informativo cuando no hay número de días -->
				<div class="rf-aviso rf-aviso--alerta">
					<Info class="rf-aviso-icono" size={20} />
					<div>
						<p class="rf-aviso-titulo">No hay número de días ingresado</p>
						<p class="rf-aviso-texto">
							Ingrese el <strong>Número de Días Servicio</strong> en la pestaña de
							<button
								type="button"
								onclick={() => (activeTab = 'informacion')}
								class="rf-enlace rf-enlace--linea">Información</button
							>
							para generar automáticamente los horarios de trabajo.
						</p>
					</div>
				</div>
			{:else}
				<!-- Tabla de Recargos -->
				<section class="rf-seccion">
					<h3 class="rf-titulo">Días laborados</h3>
					<div class="rf-tabla-card">
						<table class="rf-tabla">
							<thead>
								<tr>
									<th>Día</th>
									<th>Hora Inicio</th>
									<th>Hora Fin</th>
									<th>KM Inicial</th>
									<th>KM Final</th>
									<th class="rf-centro">KM Recorridos</th>
									<th class="rf-centro">Pernocte</th>
									<th class="rf-centro">Disponible</th>
									<th class="rf-centro" title="Continúa al día siguiente">Cont.</th>
									<th class="rf-centro">Total (h)</th>
									<th class="rf-centro">HED<span class="rf-th-pct">(25%)</span></th>
									<th class="rf-centro">HEN<span class="rf-th-pct">(75%)</span></th>
									<th class="rf-centro">HEFD<span class="rf-th-pct">(100%)</span></th>
									<th class="rf-centro">HEFN<span class="rf-th-pct">(150%)</span></th>
									<th class="rf-centro">RNDF<span class="rf-th-pct">(115%)</span></th>
									<th class="rf-centro">RN<span class="rf-th-pct">(35%)</span></th>
									<th class="rf-centro">RD<span class="rf-th-pct">(75%)</span></th>
									<!-- Columna Acciones REMOVIDA - Los días se generan automáticamente -->
								</tr>
							</thead>
							<tbody>
								{#each diasLaborales as dia, rowIdx (dia.id)}
									{@const recargos = calcularRecargos(dia)}
									{@const totalHoras = calcularTotalHoras(dia.hora_inicio, dia.hora_fin)}
									{@const isSelected = selectedRow === dia.id}
									{@const isDomingo = dia.es_domingo}
									{@const isFestivo = dia.es_festivo}
									{@const maxDia = obtenerMaximoDiaMes(currentMonth, currentYear)}
									{@const kmInicial = dia.kilometraje_inicial
										? parseFloat(dia.kilometraje_inicial)
										: 0}
									{@const kmFinal = dia.kilometraje_final ? parseFloat(dia.kilometraje_final) : 0}
									{@const kmRecorridos = kmFinal > kmInicial ? kmFinal - kmInicial : 0}
									{@const esContinuacion =
										rowIdx > 0 && diasLaborales[rowIdx - 1].continua_siguiente_dia}
									{@const filaContinua =
										!isSelected && !!(dia.continua_siguiente_dia || esContinuacion)}
									{@const filaDisponible = !isSelected && !filaContinua && !!dia.disponibilidad}
									{@const filaDomingo =
										!isSelected && !filaContinua && !filaDisponible && !!isDomingo}
									{@const filaFestivo =
										!isSelected && !filaContinua && !filaDisponible && !filaDomingo && !!isFestivo}

									<tr
										onclick={() => (selectedRow = dia.id)}
										class="rf-fila"
										class:seleccionada={isSelected}
										class:continua={filaContinua}
										class:disponible={filaDisponible}
										class:domingo={filaDomingo}
										class:festivo={filaFestivo}
									>
										<!-- Día -->
										<td>
											<div class="rf-dia">
												<input
													type="number"
													min="1"
													max={maxDia}
													bind:value={dia.dia}
													oninput={(e) =>
														actualizarDiaLaboral(dia.id, 'dia', e.currentTarget.value)}
													onkeydown={handleHorarioCellKeydown}
													data-nav-row={rowIdx}
													data-nav-col="0"
													aria-label="Día"
													aria-invalid={erroresDias[dia.id] ? 'true' : undefined}
													class="rf-celda rf-celda--dia"
													placeholder="1"
												/>
												{#if isFestivo}
													<span class="rf-tag rf-tag--festivo" title="Día festivo">Festivo</span>
												{:else if isDomingo}
													<span class="rf-tag rf-tag--domingo" title="Domingo">Dom.</span>
												{/if}
												{#if cruzaCambioConfig && dia.dia}
													{@const etiquetaCfg = getEtiquetaConfigParaDia(dia.dia)}
													{#if etiquetaCfg}
														<span class="rf-tag rf-tag--config" title={etiquetaCfg}>
															{etiquetaCfg}
														</span>
													{/if}
												{/if}
											</div>
										</td>

										<!-- Hora Inicio -->
										<td>
											<input
												type="number"
												min="0.5"
												max="48"
												step="0.5"
												bind:value={dia.hora_inicio}
												oninput={(e) =>
													actualizarDiaLaboral(dia.id, 'hora_inicio', e.currentTarget.value)}
												onkeydown={handleHorarioCellKeydown}
												data-nav-row={rowIdx}
												data-nav-col="1"
												aria-label="Hora inicio"
												aria-invalid={erroresHoras[dia.id]?.inicio ? 'true' : undefined}
												class="rf-celda"
												placeholder="0.5"
											/>
										</td>

										<!-- Hora Fin -->
										<td>
											<input
												type="number"
												min="0.5"
												max="48"
												step="0.5"
												bind:value={dia.hora_fin}
												oninput={(e) =>
													actualizarDiaLaboral(dia.id, 'hora_fin', e.currentTarget.value)}
												onkeydown={handleHorarioCellKeydown}
												data-nav-row={rowIdx}
												data-nav-col="2"
												aria-label="Hora fin"
												aria-invalid={erroresHoras[dia.id]?.fin ? 'true' : undefined}
												class="rf-celda"
												placeholder="0.5"
											/>
										</td>

										<!-- KM Inicial -->
										<td>
											<input
												type="number"
												bind:value={dia.kilometraje_inicial}
												oninput={(e) =>
													actualizarDiaLaboral(
														dia.id,
														'kilometraje_inicial',
														e.currentTarget.value
													)}
												onkeydown={handleHorarioCellKeydown}
												data-nav-row={rowIdx}
												data-nav-col="3"
												aria-label="Kilometraje inicial"
												class="rf-celda"
												placeholder="0"
											/>
										</td>

										<!-- KM Final -->
										<td>
											<input
												type="number"
												bind:value={dia.kilometraje_final}
												oninput={(e) =>
													actualizarDiaLaboral(dia.id, 'kilometraje_final', e.currentTarget.value)}
												onkeydown={handleHorarioCellKeydown}
												data-nav-row={rowIdx}
												data-nav-col="4"
												aria-label="Kilometraje final"
												class="rf-celda"
												placeholder="0"
											/>
										</td>

										<!-- KM Recorridos (Calculado) -->
										<td class="rf-centro">
											<span class="rf-cifra">
												{kmRecorridos > 0 ? kmRecorridos.toFixed(1) : '-'}
											</span>
										</td>

										<!-- Pernocte -->
										<td class="rf-centro">
											<input
												type="checkbox"
												bind:checked={dia.pernocte}
												onchange={(e) =>
													actualizarDiaLaboral(dia.id, 'pernocte', e.currentTarget.checked)}
												aria-label="Pernocte"
												class="rf-check"
											/>
										</td>

										<!-- Disponible -->
										<td class="rf-centro">
											<input
												type="checkbox"
												bind:checked={dia.disponibilidad}
												onchange={(e) =>
													actualizarDiaLaboral(dia.id, 'disponibilidad', e.currentTarget.checked)}
												aria-label="Disponible"
												class="rf-check"
											/>
										</td>

										<!-- Continúa día siguiente -->
										<td class="rf-centro">
											<input
												type="checkbox"
												bind:checked={dia.continua_siguiente_dia}
												onchange={(e) =>
													actualizarDiaLaboral(
														dia.id,
														'continua_siguiente_dia',
														e.currentTarget.checked
													)}
												aria-label="Continúa al día siguiente"
												class="rf-check rf-check--continua"
												title="Marcar si el servicio continúa al día siguiente"
											/>
										</td>

										<!-- Total Horas -->
										<td class="rf-centro">
											<span class="rf-cifra" class:rf-cifra--disponible={dia.disponibilidad}>
												{#if dia.disponibilidad}
													<span title="Día disponible - no se contabiliza">D</span>
												{:else}
													{totalHoras > 0 ? totalHoras.toFixed(1) : '-'}
												{/if}
											</span>
										</td>

										<!-- HED · HEN · HEFD · HEFN · RNDF · RN · RD -->
										{#each CODIGOS_RECARGO as tipo (tipo)}
											{@const valor = recargos[tipo]}
											<td class="rf-centro">
												{#if dia.disponibilidad}
													<span class="rf-pill bg-gray-100 text-gray-400">-</span>
												{:else}
													<span class="rf-pill {obtenerColorRecargo(tipo, valor)}">
														{valor > 0 ? valor.toFixed(2) : '-'}
													</span>
												{/if}
											</td>
										{/each}

										<!-- Columna Acciones REMOVIDA -->
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</section>

				<!-- Alerta de cruce de config -->
				{#if cruzaCambioConfig}
					<div class="rf-aviso rf-aviso--alerta" role="alert">
						<TriangleAlert class="rf-aviso-icono" size={20} />
						<div>
							<p class="rf-aviso-titulo">Esta planilla cruza un cambio de configuración</p>
							<p class="rf-aviso-texto">
								Los días se calcularán con la config salarial y los % de recargo vigentes en cada
								fecha. Revisa el desglose por config abajo.
							</p>
						</div>
					</div>
				{/if}

				<!-- Resumen de Totales -->
				<section class="rf-seccion">
					<h3 class="rf-titulo">Resumen de recargos</h3>
					<div class="rf-totales">
						<div class="rf-total" style="--tono: #ea580c;">
							<div class="rf-total-cabeza">
								<span class="rf-total-codigo">HED</span>
								<span class="rf-total-pct">{cruzaCambioConfig ? '25%*' : '25%'}</span>
							</div>
							<span class="rf-total-valor">{totales.HED.toFixed(2)}</span>
							<span class="rf-total-desc">
								Hora Extra Diurna{formatValorMonetario(totales.valorHED)}
							</span>
						</div>

						<div class="rf-total" style="--tono: #2563eb;">
							<div class="rf-total-cabeza">
								<span class="rf-total-codigo">HEN</span>
								<span class="rf-total-pct">75%</span>
							</div>
							<span class="rf-total-valor">{totales.HEN.toFixed(2)}</span>
							<span class="rf-total-desc">
								Hora Extra Nocturna{formatValorMonetario(totales.valorHEN)}
							</span>
						</div>

						<div class="rf-total" style="--tono: #ca8a04;">
							<div class="rf-total-cabeza">
								<span class="rf-total-codigo">HEFD</span>
								<span class="rf-total-pct">{cruzaCambioConfig ? '105/115%' : '105%'}</span>
							</div>
							<span class="rf-total-valor">{totales.HEFD.toFixed(2)}</span>
							<span class="rf-total-desc">
								H. Extra Festiva Diurna{formatValorMonetario(totales.valorHEFD)}
							</span>
						</div>

						<div class="rf-total" style="--tono: #9333ea;">
							<div class="rf-total-cabeza">
								<span class="rf-total-codigo">HEFN</span>
								<span class="rf-total-pct">{cruzaCambioConfig ? '155/165%' : '155%'}</span>
							</div>
							<span class="rf-total-valor">{totales.HEFN.toFixed(2)}</span>
							<span class="rf-total-desc">
								H. Extra Festiva Nocturna{formatValorMonetario(totales.valorHEFN)}
							</span>
						</div>

						<div class="rf-total" style="--tono: #4f46e5;">
							<div class="rf-total-cabeza">
								<span class="rf-total-codigo">RNDF</span>
								<span class="rf-total-pct">{cruzaCambioConfig ? '115/125%' : '115%'}</span>
							</div>
							<span class="rf-total-valor">{totales.RNDF.toFixed(2)}</span>
							<span class="rf-total-desc">
								R. Noct. Domin./Festivo{formatValorMonetario(totales.valorRNDF)}
							</span>
						</div>

						<div class="rf-total" style="--tono: #0d9488;">
							<div class="rf-total-cabeza">
								<span class="rf-total-codigo">RN</span>
								<span class="rf-total-pct">35%</span>
							</div>
							<span class="rf-total-valor">{totales.RN.toFixed(2)}</span>
							<span class="rf-total-desc">
								Recargo Nocturno{formatValorMonetario(totales.valorRN)}
							</span>
						</div>

						<div class="rf-total" style="--tono: #dc2626;">
							<div class="rf-total-cabeza">
								<span class="rf-total-codigo">RD</span>
								<span class="rf-total-pct">{cruzaCambioConfig ? '80/90%' : '80%'}</span>
							</div>
							<span class="rf-total-valor">{totales.RD.toFixed(2)}</span>
							<span class="rf-total-desc">
								Recargo Dominical/Festivo{formatValorMonetario(totales.valorRD)}
							</span>
						</div>
					</div>
				</section>

				<!-- Desglose por configuración (cuando cruza cambio) -->
				{#if cruzaCambioConfig}
					{@const desglose = getDesglosePorConfig()}
					<section class="rf-seccion">
						<h3 class="rf-titulo">Desglose por configuración</h3>
						<div class="rf-desglose">
							{#each Array.from(desglose.values()) as item}
								<div class="rf-card rf-desglose-item">
									<div class="rf-desglose-texto">
										<p class="rf-desglose-etiqueta">{item.config.etiqueta}</p>
										<p class="rf-desglose-detalle">
											Valor hora: {formatearCOP(item.config.valorHora)} · Salario: {formatearCOP(
												item.config.salarioBasico
											)}
										</p>
										<p class="rf-desglose-detalle">
											Días: {item.dias.length > 6
												? item.dias.slice(0, 6).join(', ') + ` +${item.dias.length - 6}`
												: item.dias.join(', ')}
										</p>
									</div>
									<p class="rf-desglose-total">{formatearCOP(item.total)}</p>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<!-- Total monetario y estadísticas -->
				<div class="rf-card rf-resumen">
					<div class="rf-resumen-datos">
						<div class="rf-resumen-dato">
							<span>Total Días</span>
							<strong>{diasLaborales.length}</strong>
						</div>
						<div class="rf-resumen-dato">
							<span>Con Datos</span>
							<strong>{diasLaborales.filter((d) => d.hora_inicio && d.hora_fin).length}</strong>
						</div>
						<div class="rf-resumen-dato">
							<span>Total Horas</span>
							<strong>{totales.totalHoras.toFixed(1)}</strong>
						</div>
						<div class="rf-resumen-dato rf-resumen-dato--total">
							<span>Valor Total</span>
							<strong>{formatearCOP(totales.valorTotal)}</strong>
						</div>
					</div>
					<p class="rf-resumen-nota">
						Cálculo según normativa laboral colombiana
						{#if cruzaCambioConfig}· con vigencias por fecha{/if}
					</p>
				</div>
			{/if}
		</div>
	{/if}

	{#snippet pie()}
		<p class="rf-estado">
			<span class="rf-estado-punto" class:completo={progress.completed === progress.total}></span>
			{#if progress.completed === progress.total}
				Formulario completo
			{:else}
				{progress.total - progress.completed} campos pendientes
			{/if}
		</p>
		<button type="button" onclick={handleClose} disabled={isLoading} class="btn-secondary">
			Cancelar
		</button>
		<button
			type="button"
			onclick={handleSubmit}
			disabled={isLoading || progress.completed !== progress.total}
			class="btn-primary"
		>
			{#if isLoading}
				<LoaderCircle class="rf-spin" size={16} />
			{:else}
				<Check size={16} strokeWidth={2.5} />
			{/if}
			{editMode ? 'Actualizar' : 'Crear'} Recargo
		</button>
	{/snippet}
</ModalBase>

<!-- Los modales de creación rápida se abren por encima de este (ModalBase va
     en z-index 10040; ellos traen z-[60]). -->
<div class="rf-submodales">
	<ModalNuevaEmpresa
		isOpen={mostrarModalEmpresa}
		onClose={() => (mostrarModalEmpresa = false)}
		onSuccess={handleEmpresaCreada}
	/>

	<ModalNuevoConductor
		isOpen={mostrarModalConductor}
		onClose={() => (mostrarModalConductor = false)}
		onSuccess={handleConductorCreado}
	/>

	<ModalNuevoVehiculo
		isOpen={mostrarModalVehiculo}
		onClose={() => (mostrarModalVehiculo = false)}
		onSuccess={handleVehiculoCreado}
	/>
</div>

<style>
	/* ── Encabezado: progreso y pestañas ─────────────────────────────── */
	.rf-progreso {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
	}
	.rf-progreso-num {
		font-size: 12px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.rf-progreso-barra {
		width: 64px;
		height: 6px;
		overflow: hidden;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.16);
	}
	.rf-progreso-barra span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: #fff;
		transition: width 0.3s ease;
	}

	.rf-tabs {
		display: flex;
		gap: 4px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.rf-tabs::-webkit-scrollbar {
		display: none;
	}
	.rf-tab {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 14px;
		border: 0;
		border-radius: 12px 12px 0 0;
		background: transparent;
		color: rgba(255, 255, 255, 0.7);
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		white-space: nowrap;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
	}
	.rf-tab:hover {
		color: #fff;
	}
	.rf-tab:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: -2px;
	}
	/* La pestaña activa toma el fondo del cuerpo, como una carpeta. */
	.rf-tab.activa {
		background: var(--bg-base);
		color: var(--text-primary);
	}
	.rf-tab :global(.rf-tab-check) {
		color: var(--color-emerald-400, #34d399);
	}
	.rf-tab.activa :global(.rf-tab-check) {
		color: var(--accion);
	}
	.rf-tab-corto {
		display: none;
	}
	.rf-tab-opcional {
		padding: 2px 7px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.14);
		font-size: 10.5px;
		font-weight: 700;
	}
	.rf-tab.activa .rf-tab-opcional {
		background: var(--border-subtle);
		color: var(--text-muted);
	}

	/* ── Estructura del cuerpo ───────────────────────────────────────── */
	.rf {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.rf-seccion {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.rf-titulo {
		margin: 0;
		color: var(--text-primary);
		font-size: 17px;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.rf-titulo-nota {
		margin-left: 6px;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0;
	}
	.rf-titulo-fila {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.rf-titulo-sub {
		margin: 2px 0 0;
		color: var(--text-muted);
		font-size: 13px;
	}
	.rf-card {
		padding: 16px;
		border-radius: 18px;
		background: var(--bg-surface);
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}
	.rf-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.rf-grid--4 {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	/* `Campo completo` ocupa toda la fila. */
	.rf-grid :global(.de-full) {
		grid-column: 1 / -1;
	}
	.rf-mapbox {
		min-width: 0;
	}

	.rf-cargando {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		min-height: 240px;
		color: var(--text-muted);
		font-size: 14px;
	}
	.rf-cargando p {
		margin: 0;
	}
	.rf-spinner {
		width: 36px;
		height: 36px;
		border-radius: 999px;
		border: 3px solid var(--border-default);
		border-top-color: var(--accion);
		animation: rf-giro 0.7s linear infinite;
	}
	:global(.rf-spin) {
		animation: rf-giro 0.8s linear infinite;
	}
	@keyframes rf-giro {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Controles (mismo aspecto que `.de-input` de ModalEntidad) ───── */
	.rf-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.rf-input::placeholder {
		color: var(--text-very-muted);
		opacity: 1;
	}
	textarea.rf-input {
		resize: vertical;
	}
	.rf-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.rf-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.rf-num {
		font-variant-numeric: tabular-nums;
	}
	.rf-input-planilla {
		padding-right: 40px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.rf-input-planilla.lleno {
		border-color: color-mix(in srgb, var(--accion) 45%, var(--border-default));
		background: color-mix(in srgb, var(--accion) 5%, var(--bg-surface));
	}
	.rf-input-spinner {
		position: absolute;
		top: 50%;
		right: 12px;
		display: grid;
		transform: translateY(-50%);
		color: var(--accion);
	}

	.rf-fila-control {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.rf-buscador {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.rf-btn-icono {
		flex-shrink: 0;
		width: 42px;
		height: 42px;
		display: grid;
		place-items: center;
		border: 1.5px dashed color-mix(in srgb, var(--accion) 45%, var(--border-default));
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--accion);
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.rf-btn-icono:hover {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
	}
	.rf-btn-regenerar {
		flex-shrink: 0;
		min-height: 42px;
		border-radius: 12px;
	}

	/* Entidad elegida: tarjeta con el nombre y el botón para cambiarla. */
	.rf-elegido {
		min-height: 42px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 8px 8px 14px;
		border: 1.5px solid var(--accion);
		border-radius: 12px;
		background: color-mix(in srgb, var(--accion) 6%, var(--bg-surface));
	}
	.rf-elegido-texto,
	.rf-archivo-texto {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.rf-elegido-nombre {
		color: var(--text-primary);
		font-size: 14.5px;
		font-weight: 800;
		overflow-wrap: anywhere;
	}
	.rf-elegido-sub {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font-size: 12.5px;
	}
	.rf-codigo {
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.rf-quitar {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.rf-quitar:hover {
		background: color-mix(in srgb, var(--text-primary) 7%, transparent);
		color: var(--text-primary);
	}

	/* Lista desplegable de búsqueda. */
	.rf-lista {
		position: absolute;
		z-index: 20;
		left: 0;
		right: 0;
		margin-top: 6px;
		max-height: 240px;
		overflow-y: auto;
		padding: 6px;
		border: 1px solid var(--border-default);
		border-radius: 14px;
		background: var(--bg-surface);
		box-shadow: 0 12px 28px rgba(0, 29, 23, 0.14);
	}
	.rf-opcion {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 9px 12px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.rf-opcion:hover {
		background: var(--bg-base);
	}
	.rf-opcion.activa {
		background: color-mix(in srgb, var(--accion) 10%, var(--bg-surface));
	}
	.rf-opcion-nombre {
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 700;
	}
	.rf-opcion-sub {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font-size: 12.5px;
	}

	.rf-agregar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 48px;
		padding: 10px 16px;
		border: 1.5px dashed color-mix(in srgb, var(--accion) 45%, var(--border-default));
		border-radius: 16px;
		background: var(--bg-surface);
		color: var(--accion);
		font: inherit;
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.rf-agregar:hover {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 6%, var(--bg-surface));
	}

	/* ── Archivo adjunto ─────────────────────────────────────────────── */
	.rf-archivo {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 12px 14px 16px;
		border-radius: 18px;
		background: var(--bg-surface);
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}
	.rf-archivo-texto {
		flex: 1;
	}
	.rf-archivo-icono {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		border-radius: 12px;
		background: color-mix(in srgb, var(--accion) 10%, var(--bg-surface));
		color: var(--accion);
	}
	.rf-soltar {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 128px;
		padding: 16px;
		border: 1.5px dashed var(--border-default);
		border-radius: 18px;
		background: var(--bg-surface);
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.rf-soltar:hover,
	.rf-soltar:focus-within {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 4%, var(--bg-surface));
	}
	.rf-soltar-texto {
		color: var(--text-secondary);
		font-size: 13.5px;
		font-weight: 600;
	}
	.rf-oculto {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* ── Avisos ──────────────────────────────────────────────────────── */
	.rf-aviso {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 14px 16px;
		border-radius: 16px;
		border: 1px solid;
	}
	.rf-aviso :global(.rf-aviso-icono) {
		flex-shrink: 0;
		margin-top: 1px;
	}
	.rf-aviso--marca {
		border-color: color-mix(in srgb, var(--accion) 22%, transparent);
		background: color-mix(in srgb, var(--accion) 6%, var(--bg-surface));
		color: var(--text-secondary);
	}
	.rf-aviso--marca :global(.rf-aviso-icono) {
		color: var(--accion);
	}
	.rf-aviso--alerta {
		border-color: #fedf89;
		background: #fffaeb;
		color: #93370d;
	}
	.rf-aviso--alerta :global(.rf-aviso-icono) {
		color: #dc6803;
	}
	.rf-aviso-titulo {
		margin: 0;
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 800;
	}
	.rf-aviso--alerta .rf-aviso-titulo {
		color: #7a2e0e;
	}
	.rf-aviso-texto {
		margin: 4px 0 0;
		font-size: 13px;
		line-height: 1.45;
	}

	/* ── Chips de opciones (terreno, riesgos) ───────────────────────── */
	.rf-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.rf-chip {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 38px;
		padding: 0 14px;
		border: 1.5px solid var(--border-default);
		border-radius: 999px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		font-size: 13.5px;
		font-weight: 700;
		cursor: pointer;
		user-select: none;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}
	.rf-chip:hover {
		border-color: var(--border-emphasis, var(--text-very-muted));
	}
	.rf-chip:has(:focus-visible) {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}
	.rf-chip.activo {
		border-color: var(--accion);
		background: var(--accion);
		color: #fff;
	}
	.rf-chip--riesgo.activo {
		border-color: #b42318;
		background: #fef3f2;
		color: #b42318;
	}

	/* ── Panel de copiado y errores ──────────────────────────────────── */
	.rf-copiado {
		padding: 14px 16px;
		border-radius: 18px;
		background: var(--bg-surface);
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
		border-left: 4px solid var(--accion);
	}
	.rf-copiado-fila {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.rf-copiado-texto {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 700;
	}
	.rf-copiado-acciones {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.rf-btn-compacto {
		min-height: 38px;
		padding: 0 14px;
		border-radius: 12px;
		font-size: 13px;
	}
	.rf-copiado-nota {
		margin: 8px 0 0;
		color: var(--text-muted);
		font-size: 12.5px;
	}
	.rf-enlace {
		padding: 6px 10px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}
	.rf-enlace:hover {
		background: var(--bg-base);
		color: var(--text-primary);
	}
	.rf-enlace--linea {
		padding: 0;
		color: inherit;
		font-size: inherit;
		text-decoration: underline;
	}
	.rf-enlace--linea:hover {
		background: transparent;
		color: inherit;
	}
	.rf-errores {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.rf-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border: 1px solid #fecdca;
		border-radius: 12px;
		background: #fef3f2;
		color: #b42318;
		font-size: 13px;
		font-weight: 600;
	}

	/* ── Tabla de días ───────────────────────────────────────────────── */
	.rf-tabla-card {
		overflow-x: auto;
		border-radius: 18px;
		background: var(--bg-surface);
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}
	.rf-tabla {
		min-width: 100%;
		border-collapse: collapse;
	}
	.rf-tabla th {
		padding: 11px 10px;
		background: var(--bg-base);
		border-bottom: 1px solid var(--border-default);
		color: var(--text-muted);
		font-size: 11.5px;
		font-weight: 800;
		text-align: left;
		white-space: nowrap;
	}
	.rf-th-pct {
		display: block;
		font-size: 10px;
		font-weight: 600;
	}
	.rf-tabla td {
		padding: 7px 10px;
		border-bottom: 1px solid var(--border-subtle);
		white-space: nowrap;
	}
	.rf-tabla tbody tr:last-child td {
		border-bottom: 0;
	}
	.rf-tabla .rf-centro {
		text-align: center;
	}
	.rf-fila {
		cursor: pointer;
		transition: background 0.15s;
	}
	.rf-fila:hover {
		background: var(--bg-base);
	}
	.rf-fila.seleccionada {
		background: color-mix(in srgb, var(--accion) 9%, var(--bg-surface));
		box-shadow: inset 4px 0 0 var(--accion);
	}
	.rf-fila.continua {
		background: #fff7ed;
		box-shadow: inset 4px 0 0 #fb923c;
	}
	.rf-fila.continua:hover {
		background: #ffedd5;
	}
	.rf-fila.disponible {
		background: #ecfdf3;
	}
	.rf-fila.disponible:hover {
		background: #dcfae6;
	}
	.rf-fila.domingo {
		background: #fef3f2;
	}
	.rf-fila.domingo:hover {
		background: #fee4e2;
	}
	.rf-fila.festivo {
		background: color-mix(in srgb, var(--accion) 6%, var(--bg-surface));
	}
	.rf-fila.festivo:hover {
		background: color-mix(in srgb, var(--accion) 11%, var(--bg-surface));
	}
	.rf-dia {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.rf-celda {
		width: 76px;
		min-height: 34px;
		padding: 5px 8px;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 13.5px;
		font-variant-numeric: tabular-nums;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.rf-celda--dia {
		width: 58px;
	}
	.rf-celda:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.rf-celda[aria-invalid='true'] {
		border-color: #dc2626;
		background: #fff8f7;
	}
	.rf-check {
		width: 17px;
		height: 17px;
		accent-color: var(--accion);
		cursor: pointer;
	}
	.rf-check--continua {
		accent-color: #ea580c;
	}
	.rf-tag {
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 800;
	}
	.rf-tag--festivo {
		background: color-mix(in srgb, var(--accion) 14%, var(--bg-surface));
		color: var(--bg-charcoal-deep);
	}
	.rf-tag--domingo {
		background: #fee4e2;
		color: #b42318;
	}
	.rf-tag--config {
		border: 1px solid #fedf89;
		background: #fffaeb;
		color: #b54708;
		font-size: 9.5px;
	}
	.rf-cifra {
		color: var(--text-secondary);
		font-size: 13.5px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.rf-cifra--disponible {
		color: #067647;
	}
	.rf-pill {
		display: inline-flex;
		align-items: center;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	/* ── Totales ─────────────────────────────────────────────────────── */
	.rf-totales {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 10px;
	}
	.rf-total {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}
	.rf-total-cabeza {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.rf-total-codigo {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 800;
	}
	.rf-total-codigo::before {
		content: '';
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--tono);
	}
	.rf-total-pct {
		color: var(--text-muted);
		font-size: 11.5px;
		font-weight: 600;
	}
	.rf-total-valor {
		color: var(--text-primary);
		font-size: 22px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.rf-total-desc {
		color: var(--text-muted);
		font-size: 11.5px;
		line-height: 1.35;
	}

	.rf-desglose {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.rf-desglose-item {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}
	.rf-desglose-texto {
		min-width: 0;
		flex: 1;
	}
	.rf-desglose-etiqueta {
		margin: 0;
		color: var(--text-primary);
		font-size: 13.5px;
		font-weight: 800;
	}
	.rf-desglose-detalle {
		margin: 3px 0 0;
		color: var(--text-muted);
		font-size: 12px;
	}
	.rf-desglose-total {
		margin: 0;
		color: var(--text-primary);
		font-size: 14.5px;
		font-weight: 800;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.rf-resumen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.rf-resumen-datos {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 24px;
	}
	.rf-resumen-dato {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.rf-resumen-dato span {
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}
	.rf-resumen-dato strong {
		color: var(--text-primary);
		font-size: 15px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.rf-resumen-dato--total strong {
		color: var(--color-emerald-700);
		font-size: 18px;
	}
	.rf-resumen-nota {
		margin: 0;
		color: var(--text-muted);
		font-size: 12px;
	}

	/* ── Pie ─────────────────────────────────────────────────────────── */
	.rf-estado {
		margin: 0 auto 0 0;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--text-muted);
		font-size: 13px;
		font-weight: 600;
	}
	.rf-estado-punto {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: #f59e0b;
	}
	.rf-estado-punto.completo {
		background: var(--accion);
	}

	/* Los modales de creación rápida traen `z-[60]`: se suben por encima
	   de ModalBase (10040) y por debajo de las confirmaciones (10050). */
	.rf-submodales :global(.fixed.inset-0) {
		z-index: 10045;
	}

	@media (max-width: 1024px) {
		.rf-grid--4 {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 640px) {
		.rf-grid,
		.rf-grid--4,
		.rf-desglose {
			grid-template-columns: minmax(0, 1fr);
		}
		.rf-tab {
			flex: 1;
			justify-content: center;
			padding: 9px 8px;
			font-size: 12.5px;
		}
		.rf-tab-largo,
		.rf-tab-opcional {
			display: none;
		}
		.rf-tab-corto {
			display: inline;
		}
		.rf-progreso-barra {
			display: none;
		}
		.rf-totales {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.rf-estado {
			flex-basis: 100%;
		}
	}
</style>
