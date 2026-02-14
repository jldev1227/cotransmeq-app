<script lang="ts">
	import { onMount, createEventDispatcher, tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { recargosStore } from '$lib/stores/recargos';
	import { recursos } from '$lib/stores/recursos';
	import { recargosApi } from '$lib/api/recargos';
	import { toast } from 'svelte-sonner';
	import {
		esDomingo,
		getNombreMes,
		convertirHoraADecimal,
		esDiaFestivo
	} from '$lib/utils/recargosHelpers';
	import { obtenerFestivosCompletos, esDiaFestivoColombiano } from '$lib/utils/festivosColombia';

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

	// Índices de preselección para navegación con teclado en dropdowns
	let highlightConductor = -1;
	let highlightVehiculo = -1;
	let highlightEmpresa = -1;
	let selectedRow: string | null = null;
	let fromServicio = false; // Indica si el recargo viene de un servicio
	let planillaGenerada = false; // Flag para evitar regenerar automáticamente

	// Validaciones de horas
	let erroresHoras: { [key: string]: { inicio: string; fin: string } } = {};
	let erroresDias: { [key: string]: string } = {};

	// Constantes para cálculo de recargos
	const HORAS_LIMITE = {
		JORNADA_NORMAL: 10,
		INICIO_NOCTURNO: 19,
		FIN_NOCTURNO: 6
	};

	// Obtener días festivos colombianos del año actual
	$: diasFestivos = obtenerFestivosCompletos(currentYear);
	$: festivosDelMes = diasFestivos.filter((f) => f.mes === currentMonth);

	// Función para obtener el máximo día del mes
	function obtenerMaximoDiaMes(mes: number, year: number): number {
		// El día 0 del mes siguiente es el último día del mes actual
		return new Date(year, mes, 0).getDate();
	}

	// Función auxiliar para normalizar hora a rango 0-24
	function normalizarHora(hora: number): number {
		return hora % 24;
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

		// Condiciones de vía (por defecto pavimentada)
		via_trocha: false,
		via_afirmado: false,
		via_mixto: false,
		via_pavimentada: true,

		// Riesgos de seguridad (por defecto sin riesgos)
		riesgo_desniveles: false,
		riesgo_deslizamientos: false,
		riesgo_sin_senalizacion: false,
		riesgo_animales: false,
		riesgo_peatones: false,
		riesgo_trafico_alto: false,

		// Evaluación (valores por defecto óptimos)
		fuente_consulta: 'sistema' as 'conductor' | 'gps' | 'cliente' | 'sistema' | null,
		calificacion_servicio: 'excelente' as 'excelente' | 'bueno' | 'regular' | 'malo' | null,

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
			disponibilidad: false
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

	// Resetear highlight cuando cambia el texto de búsqueda o la lista filtrada
	$: if (searchConductor !== undefined) highlightConductor = -1;
	$: if (searchVehiculo !== undefined) highlightVehiculo = -1;
	$: if (searchEmpresa !== undefined) highlightEmpresa = -1;

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
				highlightConductor = -1;
			}
		} else if (e.key === 'Escape') {
			showConductorDropdown = false;
			highlightConductor = -1;
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
				highlightVehiculo = -1;
			}
		} else if (e.key === 'Escape') {
			showVehiculoDropdown = false;
			highlightVehiculo = -1;
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
				highlightEmpresa = -1;
			}
		} else if (e.key === 'Escape') {
			showEmpresaDropdown = false;
			highlightEmpresa = -1;
		}
	}

	// Función para obtener el último número de planilla y generar el siguiente
	async function generarNumeroPlanilla() {
		if (isGenerandoPlanilla) return; // Evitar múltiples llamadas simultáneas
		
		isGenerandoPlanilla = true;
		
		try {
			const token = localStorage.getItem('transmeralda_token');
			if (!token) {
				console.error('❌ No hay token de autenticación');
				toast.error('No hay sesión activa');
				return;
			}

			// Obtener todos los recargos ordenados por fecha de creación
			const response = await fetch('https://backend-cotransmeq-production.up.railway.app/api/recargos', {
				headers: {
					'Authorization': `Bearer ${token}`
				}
			});

			if (!response.ok) {
				console.error('Error al obtener recargos:', response.statusText);
				toast.error('Error al consultar recargos');
				return;
			}

			const data = await response.json();
			console.log('📦 Respuesta de la API:', data);
			
			// La respuesta puede venir como array directo o como objeto con propiedad 'data' o 'recargos'
			let recargos = Array.isArray(data) ? data : (data.data || data.recargos || []);
			
			if (!Array.isArray(recargos)) {
				console.error('❌ La respuesta no contiene un array de recargos:', data);
				recargos = [];
			}

			console.log('📋 Total de recargos:', recargos.length);
			console.log('📋 Recargos completos:', recargos);
			
			// Filtrar solo los que tienen numero_planilla y extraer el número
			const numerosExistentes = recargos
				.filter((r: any) => r.numero_planilla)
				.map((r: any) => {
					// Extraer el número del formato "TM-0001" o similar
					const match = r.numero_planilla.match(/(\d+)$/);
					return match ? parseInt(match[1], 10) : 0;
				})
				.filter((n: number) => !isNaN(n));

			console.log('📊 Números de planilla existentes:', numerosExistentes);
			console.log('📊 Recargos con planilla:', recargos.filter((r: any) => r.numero_planilla));

			// Encontrar el número más alto
			const ultimoNumero = numerosExistentes.length > 0 
				? Math.max(...numerosExistentes) 
				: 0;

			console.log('🔢 Último número:', ultimoNumero);

			// Generar el siguiente número con formato TM-0001
			const siguienteNumero = (ultimoNumero + 1).toString().padStart(4, '0');
			const nuevoNumero = `TM-${siguienteNumero}`;
			
			// Setear el valor y esperar a que se actualice el DOM
			formData.tmNumber = nuevoNumero;
			await tick(); // Esperar a que Svelte actualice el DOM
			
			// Ahora marcar como generado para evitar regeneración
			planillaGenerada = true;
			
			console.log('✅ Número de planilla generado:', formData.tmNumber);
			toast.success(`Número generado: ${nuevoNumero}`);
		} catch (error) {
			console.error('❌ Error al generar número de planilla:', error);
			toast.error('Error al generar número de planilla');
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

	// Funciones de gestión de días laborales
	function agregarDiaLaboral() {
		if (diasLaborales.length < 15) {
			diasLaborales = [
				...diasLaborales,
				{
					id: Date.now().toString(),
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
					disponibilidad: false
				}
			];
		}
	}

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

				// Validar horas
				if (campo === 'hora_inicio') {
					if (!erroresHoras[id]) erroresHoras[id] = { inicio: '', fin: '' };
					erroresHoras[id].inicio = validarHora(id, 'inicio', valor);
					erroresHoras = erroresHoras;
				}

				if (campo === 'hora_fin') {
					if (!erroresHoras[id]) erroresHoras[id] = { inicio: '', fin: '' };
					erroresHoras[id].fin = validarHora(id, 'fin', valor);
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

	function calcularRecargos(dia: DiaLaboral) {
		const diaNum = parseInt(dia.dia);
		const horaInicio =
			typeof dia.hora_inicio === 'string' ? parseFloat(dia.hora_inicio) : dia.hora_inicio || 0;
		const horaFin = typeof dia.hora_fin === 'string' ? parseFloat(dia.hora_fin) : dia.hora_fin || 0;
		const totalHoras = calcularTotalHoras(dia.hora_inicio, dia.hora_fin);

		if (
			!dia.dia ||
			!dia.hora_inicio ||
			!dia.hora_fin ||
			totalHoras <= 0 ||
			isNaN(horaInicio) ||
			isNaN(horaFin)
		) {
			return { HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RN: 0, RD: 0 };
		}

		const esDomingoOFestivo = dia.es_domingo || dia.es_festivo;
		let hed = 0,
			hen = 0,
			hefd = 0,
			hefn = 0,
			rn = 0,
			rd = 0;

		// Calcular recargo nocturno SOLO en las primeras 10 horas (jornada normal)
		// RN no aplica a horas extras porque HEN/HEFN ya incluyen recargo nocturno
		let horaActual = horaInicio;
		const horaLimiteRN = Math.min(horaInicio + totalHoras, horaInicio + HORAS_LIMITE.JORNADA_NORMAL);
		
		while (horaActual < horaLimiteRN) {
			const horaDelDia = normalizarHora(horaActual);
			const siguienteHora = Math.min(horaActual + 0.5, horaLimiteRN);

			// Verificar si está en período nocturno (19:00-23:59 o 00:00-06:00)
			if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
				rn += siguienteHora - horaActual;
			}

			horaActual = siguienteHora;
		}

		if (esDomingoOFestivo) {
			// Recargo dominical/festivo
			rd = Math.min(totalHoras, HORAS_LIMITE.JORNADA_NORMAL);

			// Horas extras festivas (después de las primeras 10 horas)
			if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL) {
				const horasExtras = totalHoras - HORAS_LIMITE.JORNADA_NORMAL;

				// Calcular cuántas horas extras son nocturnas
				const horaInicioExtras = horaInicio + HORAS_LIMITE.JORNADA_NORMAL;
				let horasExtrasNocturnas = 0;

				let horaActualExtra = horaInicioExtras;
				while (horaActualExtra < horaFin) {
					const horaDelDia = normalizarHora(horaActualExtra);
					const siguienteHora = Math.min(horaActualExtra + 0.5, horaFin);

					if (
						horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO ||
						horaDelDia < HORAS_LIMITE.FIN_NOCTURNO
					) {
						horasExtrasNocturnas += siguienteHora - horaActualExtra;
					}

					horaActualExtra = siguienteHora;
				}

				hefn = Math.min(horasExtrasNocturnas, horasExtras);
				hefd = horasExtras - hefn;
			}
		} else {
			// Día normal
			if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL) {
				const horasExtras = totalHoras - HORAS_LIMITE.JORNADA_NORMAL;

				// Calcular cuántas horas extras son nocturnas
				const horaInicioExtras = horaInicio + HORAS_LIMITE.JORNADA_NORMAL;
				let horasExtrasNocturnas = 0;

				let horaActualExtra = horaInicioExtras;
				while (horaActualExtra < horaFin) {
					const horaDelDia = normalizarHora(horaActualExtra);
					const siguienteHora = Math.min(horaActualExtra + 0.5, horaFin);

					if (
						horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO ||
						horaDelDia < HORAS_LIMITE.FIN_NOCTURNO
					) {
						horasExtrasNocturnas += siguienteHora - horaActualExtra;
					}

					horaActualExtra = siguienteHora;
				}

				hen = Math.min(horasExtrasNocturnas, horasExtras);
				hed = horasExtras - hen;
			}
		}

		return {
			HED: parseFloat(hed.toFixed(1)),
			HEN: parseFloat(hen.toFixed(1)),
			HEFD: parseFloat(hefd.toFixed(1)),
			HEFN: parseFloat(hefn.toFixed(1)),
			RN: parseFloat(rn.toFixed(1)),
			RD: parseFloat(rd.toFixed(1))
		};
	}

	function calcularTotales() {
		const totales = { totalHoras: 0, HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RN: 0, RD: 0 };

		diasLaborales.forEach((dia) => {
			const horasTotales = calcularTotalHoras(dia.hora_inicio, dia.hora_fin);
			if (horasTotales > 0) {
				totales.totalHoras += horasTotales;
				const recargos = calcularRecargos(dia);
				totales.HED += recargos.HED;
				totales.HEN += recargos.HEN;
				totales.HEFD += recargos.HEFD;
				totales.HEFN += recargos.HEFN;
				totales.RN += recargos.RN;
				totales.RD += recargos.RD;
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
		});
		return calcularTotales();
	})();
	$: hayMasDeUnDia = diasLaborales.length > 1;
	$: selectedIndex = selectedRow ? diasLaborales.findIndex((d) => d.id === selectedRow) : -1;
	$: hayDiasSiguientes = selectedIndex !== -1 && selectedIndex < diasLaborales.length - 1;

	// Calcular total de horas trabajadas (suma de todas las jornadas)
	$: totalHorasTrabajadas = diasLaborales.reduce((total, dia) => {
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
				console.log(`📅 Ajustando días laborales: ${diasActuales} → ${numeroDias}`);
				
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
						disponibilidad: false
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
			console.log('⏭️  Ya se está cargando este recargo, saltando...');
			return;
		}
		
		try {
			console.log('📥 Cargando recargo para edición, ID:', id);
			lastLoadedRecargoId = id;
			isLoadingData = true;
			
			const recargo = await recargosApi.obtenerPorId(id);

			if (recargo) {
				console.log('📦 Recargo obtenido:', recargo);
				// Verificar si viene de un servicio
				fromServicio = !!recargo.servicio_id;

				formData = {
					conductorId: recargo.conductor_id,
					vehiculoId: recargo.vehiculo_id,
					empresaId: recargo.empresa_id,
					tmNumber: recargo.numero_planilla || '',
					servicio_id: recargo.servicio_id || null,

					// Estado del conductor
					estado_conductor: recargo.estado_conductor || null,

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
					fuente_consulta: recargo.fuente_consulta || null,
					calificacion_servicio: recargo.calificacion_servicio || null,

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
					console.log('📋 Cargando días laborales:', recargo.dias_laborales_planillas);

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
						disponibilidad: dia.disponibilidad || false
					}));

					console.log('✅ Días laborales cargados:', diasLaborales);
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
			via_trocha: false,
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
			fuente_consulta: null,
			calificacion_servicio: null,

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
				disponibilidad: false
			}
		];
		archivoAdjunto = null;
		archivoExistente = null;
		archivoExistenteKey = null;
		activeTab = 'informacion';
		editMode = false;
		fromServicio = false;
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
						disponibilidad: dia.disponibilidad
					}))
				};
				console.log('📤 Datos de actualización a enviar:', JSON.stringify(updateData, null, 2));

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
						disponibilidad: dia.disponibilidad
					}))
				};
				console.log('📤 Datos a enviar al backend:', JSON.stringify(recargoData, null, 2));

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
	onMount(async () => {
		await recursos.cargarConductores();
		await recursos.cargarVehiculos();
		await recursos.cargarClientes();
	});

	// Cargar datos al abrir en modo edición o generar número de planilla en modo creación
	$: {
		if (isOpen && recargoId && !isLoadingData && lastLoadedRecargoId !== recargoId) {
			console.log('🔵 Modo EDICIÓN - ID:', recargoId);
			editMode = true;
			cargarDatosRecargo(recargoId);
		} else if (isOpen && recargoId && isLoadingData) {
			console.log('🔒 Ya se está cargando este recargo, saltando...');
		} else if (isOpen && !recargoId && !planillaGenerada && !isGenerandoPlanilla) {
			console.log('🟢 Modo CREACIÓN - Generando planilla...');
			editMode = false;
			// Solo generar si estamos en modo creación y no se ha generado antes
			generarNumeroPlanilla();
		} else if (isOpen && !recargoId && planillaGenerada) {
			console.log('🟡 Modo CREACIÓN - Planilla ya generada:', formData.tmNumber);
		}
	}
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="relative max-h-[67.5vh] w-full max-w-7xl overflow-hidden rounded-2xl bg-white shadow-2xl"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<!-- Header -->
			<div class="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="flex h-12 w-12 items-center justify-center rounded-xl {editMode
								? 'bg-gradient-to-br from-blue-500 to-blue-600'
								: 'bg-gradient-to-br from-orange-500 to-orange-600'}"
						>
							<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								{#if editMode}
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
									/>
								{:else}
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 4v16m8-8H4"
									/>
								{/if}
							</svg>
						</div>
						<div>
							<h2 class="text-xl font-bold text-gray-900">
								{editMode ? 'Editar Recargo' : 'Nuevo Recargo'}
							</h2>
							<div class="flex items-center gap-2">
								<p class="text-sm text-gray-600">
									{getNombreMes(currentMonth)}
									{currentYear}
								</p>
								{#if fromServicio}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"
									>
										<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
											/>
										</svg>
										Desde Servicio
									</span>
								{/if}
							</div>
						</div>
					</div>

					<!-- Progreso -->
					<div class="flex items-center gap-4">
						<div class="text-right">
							<div class="text-sm font-medium text-gray-700">
								{progress.completed}/{progress.total} completado
							</div>
							<div class="mt-1 h-2 w-32 overflow-hidden rounded-full bg-gray-200">
								<div
									class="h-full {editMode
										? 'bg-blue-500'
										: 'bg-orange-500'} transition-all duration-300"
									style="width: {(progress.completed / progress.total) * 100}%"
								></div>
							</div>
						</div>

						<button
							on:click={handleClose}
							disabled={isLoading}
							class="rounded-lg p-2 transition-colors hover:bg-gray-100 disabled:opacity-50"
						>
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					</div>
				</div>

				<!-- Tabs -->
				<div class="mt-4 flex gap-2">
					<button
						on:click={() => (activeTab = 'informacion')}
						class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors {activeTab ===
						'informacion'
							? editMode
								? 'bg-blue-100 text-blue-700'
								: 'bg-orange-100 text-orange-700'
							: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
							/>
						</svg>
						<span>Información Principal</span>
						{#if tabCompleted.informacion}
							<svg class="h-4 w-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
								<path
									fill-rule="evenodd"
									d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
									clip-rule="evenodd"
								/>
							</svg>
						{/if}
					</button>

					<button
						on:click={() => (activeTab = 'condiciones')}
						class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors {activeTab ===
						'condiciones'
							? editMode
								? 'bg-blue-100 text-blue-700'
								: 'bg-orange-100 text-orange-700'
							: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
							/>
						</svg>
						<span>Condiciones y Evaluación</span>
						<span class="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">Opcional</span>
						{#if tabCompleted.condiciones}
							<svg class="h-4 w-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
								<path
									fill-rule="evenodd"
									d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
									clip-rule="evenodd"
								/>
							</svg>
						{/if}
					</button>

					<button
						on:click={() => (activeTab = 'horarios')}
						class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors {activeTab ===
						'horarios'
							? editMode
								? 'bg-blue-100 text-blue-700'
								: 'bg-orange-100 text-orange-700'
							: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span>Horarios de Trabajo</span>
						{#if tabCompleted.horarios}
							<svg class="h-4 w-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
								<path
									fill-rule="evenodd"
									d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
									clip-rule="evenodd"
								/>
							</svg>
						{/if}
					</button>
				</div>
			</div>

			<!-- Body -->
			<div class="max-h-[calc(67.5vh-200px)] overflow-y-auto p-6">
				{#if isLoadingData}
					<div class="flex items-center justify-center py-12">
						<div class="text-center">
							<div
								class="h-12 w-12 border-4 {editMode
									? 'border-blue-500'
									: 'border-orange-500'} mx-auto mb-4 animate-spin rounded-full border-t-transparent"
							></div>
							<p class="text-gray-600">Cargando datos del recargo...</p>
						</div>
					</div>
				{:else if activeTab === 'informacion'}
					<!-- Tab: Información Principal -->
					<div class="space-y-6" transition:fade={{ duration: 200 }}>
						<!-- Grid de 2 columnas para campos principales -->
						<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
							<!-- Conductor -->
							<div>
								<label class="mb-2 block text-sm font-semibold text-gray-800">
									<div class="flex items-center gap-2">
										<svg
											class="h-5 w-5 text-orange-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
											/>
										</svg>
										Conductor
										<span class="text-red-500">*</span>
									</div>
								</label>
								<div class="relative">
									{#if conductorSeleccionado}
										<div
											class="flex items-center justify-between rounded-xl border-2 border-orange-500 bg-orange-50 px-4 py-3"
										>
											<div>
												<div class="font-medium text-gray-900">
													{conductorSeleccionado.nombre}
													{conductorSeleccionado.apellido}
												</div>
												{#if conductorSeleccionado.telefono}
													<div class="text-sm text-gray-600">{conductorSeleccionado.telefono}</div>
												{/if}
											</div>
											{#if !fromServicio}
												<button
													on:click={() => {
														formData.conductorId = '';
														searchConductor = '';
													}}
													class="rounded-lg p-2 transition-colors hover:bg-orange-100"
												>
													<svg
														class="h-5 w-5 text-gray-600"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M6 18L18 6M6 6l12 12"
														/>
													</svg>
												</button>
											{/if}
										</div>
									{:else}
										<input
											type="text"
											bind:value={searchConductor}
											on:focus={() => (showConductorDropdown = true)}
											on:blur={() => setTimeout(() => (showConductorDropdown = false), 200)}
											on:keydown={handleConductorKeydown}
											placeholder="Buscar conductor por nombre..."
											disabled={fromServicio}
											class="w-full rounded-xl border-2 border-gray-300 px-4 py-3 transition-all focus:border-orange-500 focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
										/>
										{#if showConductorDropdown && conductoresFiltrados.length > 0}
											<div
												id="dropdown-conductor"
												class="absolute z-20 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg"
											>
												{#each conductoresFiltrados as conductor, i}
													<button
														data-dropdown-item
														on:click={() => {
															formData.conductorId = conductor.id;
															showConductorDropdown = false;
															highlightConductor = -1;
														}}
														class="w-full border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 {highlightConductor === i ? 'bg-orange-100' : 'hover:bg-gray-50'}"
													>
														<div class="font-medium text-gray-900">
															{conductor.nombre}
															{conductor.apellido}
														</div>
														{#if conductor.telefono}
															<div class="text-sm text-gray-600">{conductor.telefono}</div>
														{/if}
													</button>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
							</div>

							<!-- Vehículo -->
							<div>
								<label class="mb-2 block text-sm font-semibold text-gray-800">
									<div class="flex items-center gap-2">
										<svg
											class="h-5 w-5 text-orange-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M13 10V3L4 14h7v7l9-11h-7z"
											/>
										</svg>
										Vehículo
										<span class="text-red-500">*</span>
									</div>
								</label>
								<div class="relative">
									{#if vehiculoSeleccionado}
										<div
											class="flex items-center justify-between rounded-xl border-2 border-orange-500 bg-orange-50 px-4 py-3"
										>
											<div>
												<div class="font-medium text-gray-900">{vehiculoSeleccionado.placa}</div>
												{#if vehiculoSeleccionado.marca}
													<div class="text-sm text-gray-600">
														{vehiculoSeleccionado.marca}
														{vehiculoSeleccionado.linea || ''}
														{vehiculoSeleccionado.modelo || ''}
													</div>
												{/if}
											</div>
											{#if !fromServicio}
												<button
													on:click={() => {
														formData.vehiculoId = '';
														searchVehiculo = '';
													}}
													class="rounded-lg p-2 transition-colors hover:bg-orange-100"
												>
													<svg
														class="h-5 w-5 text-gray-600"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M6 18L18 6M6 6l12 12"
														/>
													</svg>
												</button>
											{/if}
										</div>
									{:else}
										<input
											type="text"
											bind:value={searchVehiculo}
											on:focus={() => (showVehiculoDropdown = true)}
											on:blur={() => setTimeout(() => (showVehiculoDropdown = false), 200)}
											on:keydown={handleVehiculoKeydown}
											placeholder="Buscar vehículo por placa..."
											disabled={fromServicio}
											class="w-full rounded-xl border-2 border-gray-300 px-4 py-3 transition-all focus:border-orange-500 focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
										/>
										{#if showVehiculoDropdown && vehiculosFiltrados.length > 0}
											<div
												id="dropdown-vehiculo"
												class="absolute z-20 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg"
											>
												{#each vehiculosFiltrados as vehiculo, i}
													<button
														data-dropdown-item
														on:click={() => {
															formData.vehiculoId = vehiculo.id;
															showVehiculoDropdown = false;
															highlightVehiculo = -1;
														}}
														class="w-full border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 {highlightVehiculo === i ? 'bg-orange-100' : 'hover:bg-gray-50'}"
													>
														<div class="font-medium text-gray-900">{vehiculo.placa}</div>
														{#if vehiculo.marca}
															<div class="text-sm text-gray-600">
																{vehiculo.marca}
																{vehiculo.linea || ''}
																{vehiculo.modelo || ''}
															</div>
														{/if}
													</button>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
							</div>

							<!-- Empresa -->
							<div>
								<label class="mb-2 block text-sm font-semibold text-gray-800">
									<div class="flex items-center gap-2">
										<svg
											class="h-5 w-5 text-orange-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
											/>
										</svg>
										Empresa
										<span class="text-red-500">*</span>
									</div>
								</label>
								<div class="relative">
									{#if empresaSeleccionada}
										<div
											class="flex items-center justify-between rounded-xl border-2 border-orange-500 bg-orange-50 px-4 py-3"
										>
											<div>
												<div class="font-medium text-gray-900">{empresaSeleccionada.nombre}</div>
												{#if empresaSeleccionada.nit}
													<div class="text-sm text-gray-600">NIT: {empresaSeleccionada.nit}</div>
												{/if}
											</div>
											{#if !fromServicio}
												<button
													on:click={() => {
														formData.empresaId = '';
														searchEmpresa = '';
													}}
													class="rounded-lg p-2 transition-colors hover:bg-orange-100"
												>
													<svg
														class="h-5 w-5 text-gray-600"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M6 18L18 6M6 6l12 12"
														/>
													</svg>
												</button>
											{/if}
										</div>
									{:else}
										<input
											type="text"
											bind:value={searchEmpresa}
											on:focus={() => (showEmpresaDropdown = true)}
											on:blur={() => setTimeout(() => (showEmpresaDropdown = false), 200)}
											on:keydown={handleEmpresaKeydown}
											placeholder="Buscar empresa por nombre..."
											disabled={fromServicio}
											class="w-full rounded-xl border-2 border-gray-300 px-4 py-3 transition-all focus:border-orange-500 focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60"
										/>
										{#if showEmpresaDropdown && empresasFiltradas.length > 0}
											<div
												id="dropdown-empresa"
												class="absolute z-20 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg"
											>
												{#each empresasFiltradas as empresa, i}
													<button
														data-dropdown-item
														on:click={() => {
															formData.empresaId = empresa.id;
															showEmpresaDropdown = false;
															highlightEmpresa = -1;
														}}
														class="w-full border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 {highlightEmpresa === i ? 'bg-orange-100' : 'hover:bg-gray-50'}"
													>
														<div class="font-medium text-gray-900">{empresa.nombre}</div>
														{#if empresa.nit}
															<div class="text-sm text-gray-600">NIT: {empresa.nit}</div>
														{/if}
													</button>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
							</div>
							<!-- Número de planilla -->
							<div>
								<label class="mb-2 block text-sm font-semibold text-gray-800">
									<div class="flex items-center gap-2">
										<svg
											class="h-5 w-5 text-orange-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
											/>
										</svg>
										Número de Planilla (Generado Automáticamente)
									</div>
								</label>
								<div class="flex gap-2">
									<div class="relative flex-1">
										<input
											type="text"
											bind:value={formData.tmNumber}
											placeholder={isGenerandoPlanilla ? 'Generando...' : 'TM-0001'}
											disabled={isGenerandoPlanilla}
											class="w-full rounded-xl border-2 px-4 transition-all focus:ring-2 focus:ring-orange-200 {formData.tmNumber
												? 'border-orange-500 bg-orange-50 py-5.5'
												: 'border-gray-300 py-3'} focus:border-orange-500 disabled:cursor-wait disabled:opacity-70"
										/>
										{#if isGenerandoPlanilla}
											<div class="absolute right-3 top-1/2 -translate-y-1/2">
												<svg
													class="h-5 w-5 animate-spin text-orange-600"
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
													/>
													<path
														class="opacity-75"
														fill="currentColor"
														d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
													/>
												</svg>
											</div>
										{/if}
									</div>
									<button
										type="button"
										on:click={generarNumeroPlanilla}
										disabled={isGenerandoPlanilla}
										class="rounded-xl border-2 px-4 py-3 transition-all focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:opacity-50 {isGenerandoPlanilla
											? 'border-gray-300 bg-gray-100 text-gray-400'
											: 'border-orange-500 bg-orange-50 text-orange-600 hover:bg-orange-100'}"
										title={isGenerandoPlanilla ? 'Generando...' : 'Regenerar número de planilla'}
									>
										{#if isGenerandoPlanilla}
											<svg
												class="h-5 w-5 animate-spin"
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
												/>
												<path
													class="opacity-75"
													fill="currentColor"
													d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
												/>
											</svg>
										{:else}
											<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
												/>
											</svg>
										{/if}
									</button>
								</div>
							</div>
						</div>
						<!-- Archivo adjunto -->
						<div>
							<label class="mb-2 block text-sm font-semibold text-gray-800">
								<div class="flex items-center gap-2">
									<svg
										class="h-5 w-5 text-orange-600"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
										/>
									</svg>
									Archivo PDF (Opcional)
								</div>
							</label>

							{#if archivoExistente}
								<div
									class="flex items-center gap-3 rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-3"
								>
									<svg
										class="h-10 w-10 text-blue-500"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
										/>
									</svg>
									<div class="flex-1">
										<p class="font-medium text-gray-900">Archivo existente</p>
										<p class="text-sm text-gray-600">Documento PDF adjunto previamente</p>
									</div>
									<button
										on:click={() => {
											archivoExistente = null;
											archivoExistenteKey = null;
										}}
										class="rounded-lg p-2 transition-colors hover:bg-blue-100"
									>
										<svg
											class="h-5 w-5 text-gray-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
											/>
										</svg>
									</button>
								</div>
							{:else if archivoAdjunto}
								<div
									class="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4"
								>
									<svg
										class="h-10 w-10 text-orange-500"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
										/>
									</svg>
									<div class="flex-1">
										<p class="font-medium text-gray-900">{archivoAdjunto.name}</p>
										<p class="text-sm text-gray-600">
											{(archivoAdjunto.size / 1024 / 1024).toFixed(2)} MB
										</p>
									</div>
									<button
										on:click={() => (archivoAdjunto = null)}
										class="rounded-lg p-2 transition-colors hover:bg-orange-100"
									>
										<svg
											class="h-5 w-5 text-gray-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
											/>
										</svg>
									</button>
								</div>
							{:else}
								<label
									class="flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 transition-all hover:border-orange-500 hover:bg-orange-50"
								>
									<svg
										class="mb-2 h-8 w-8 text-gray-400"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
										/>
									</svg>
									<p class="text-sm text-gray-600">Haga clic para seleccionar un archivo PDF</p>
									<input
										type="file"
										accept="application/pdf"
										on:change={handleFileChange}
										class="hidden"
									/>
								</label>
							{/if}
						</div>
					</div>
				{:else if activeTab === 'condiciones'}
					<!-- Tab: Condiciones y Evaluación -->
					<div class="space-y-6" transition:fade={{ duration: 200 }}>
						<!-- Banner informativo -->
						<div class="rounded-lg border border-green-200 bg-green-50 p-4">
							<div class="flex gap-3">
								<svg class="h-5 w-5 flex-shrink-0 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
								<div>
									<h4 class="font-semibold text-green-900">Sección Opcional - Preaprobada</h4>
									<p class="mt-1 text-sm text-green-800">
										Esta sección ya está validada con valores óptimos por defecto. Puede modificar los campos si desea agregar información específica del servicio, pero no es necesario para crear el recargo.
									</p>
								</div>
							</div>
						</div>

						<!-- Estado del Conductor -->
						<div class="rounded-lg border border-gray-200 bg-white p-4">
							<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-800">
								<svg
									class="h-5 w-5 text-blue-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
									/>
								</svg>
								Estado del Conductor
							</h3>
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700">
										Estado Físico/Mental
									</label>
									<select
										bind:value={formData.estado_conductor}
										class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
									>
										<option value={null}>Seleccione...</option>
										<option value="optimo">✅ Óptimo</option>
										<option value="fatigado">😴 Fatigado</option>
										<option value="regular">😐 Regular</option>
										<option value="malo">❌ Malo</option>
									</select>
								</div>
							</div>
						</div>

						<!-- Tipo de Terreno -->
						<div class="rounded-lg border border-gray-200 bg-white p-4">
							<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-800">
								<svg
									class="h-5 w-5 text-amber-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
									/>
								</svg>
								Tipo de Terreno Transitado
							</h3>
							<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.via_trocha
										? 'border-orange-500 bg-orange-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.via_trocha}
										class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
									/>
									<span class="text-sm font-medium">🏞️ Trocha</span>
								</label>
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.via_afirmado
										? 'border-orange-500 bg-orange-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.via_afirmado}
										class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
									/>
									<span class="text-sm font-medium">🪨 Afirmado</span>
								</label>
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.via_mixto
										? 'border-orange-500 bg-orange-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.via_mixto}
										class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
									/>
									<span class="text-sm font-medium">🔀 Mixto</span>
								</label>
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.via_pavimentada
										? 'border-orange-500 bg-orange-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.via_pavimentada}
										class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
									/>
									<span class="text-sm font-medium">🛣️ Pavimentada</span>
								</label>
							</div>
						</div>

						<!-- Riesgos de Seguridad -->
						<div class="rounded-lg border border-gray-200 bg-white p-4">
							<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-800">
								<svg
									class="h-5 w-5 text-red-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
									/>
								</svg>
								Riesgos y Condiciones de Seguridad
							</h3>
							<div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.riesgo_desniveles
										? 'border-red-500 bg-red-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.riesgo_desniveles}
										class="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
									/>
									<span class="text-sm font-medium">⛰️ Desniveles</span>
								</label>
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.riesgo_deslizamientos
										? 'border-red-500 bg-red-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.riesgo_deslizamientos}
										class="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
									/>
									<span class="text-sm font-medium">🪨 Deslizamientos</span>
								</label>
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.riesgo_sin_senalizacion
										? 'border-red-500 bg-red-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.riesgo_sin_senalizacion}
										class="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
									/>
									<span class="text-sm font-medium">🚫 Sin Señalización</span>
								</label>
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.riesgo_animales
										? 'border-red-500 bg-red-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.riesgo_animales}
										class="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
									/>
									<span class="text-sm font-medium">🐄 Animales en Vía</span>
								</label>
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.riesgo_peatones
										? 'border-red-500 bg-red-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.riesgo_peatones}
										class="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
									/>
									<span class="text-sm font-medium">🚶 Peatones</span>
								</label>
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 p-3 transition-colors hover:bg-gray-50 {formData.riesgo_trafico_alto
										? 'border-red-500 bg-red-50'
										: ''}"
								>
									<input
										type="checkbox"
										bind:checked={formData.riesgo_trafico_alto}
										class="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
									/>
									<span class="text-sm font-medium">🚗 Tráfico Alto</span>
								</label>
							</div>
						</div>

						<!-- Evaluación del Servicio -->
						<div class="rounded-lg border border-gray-200 bg-white p-4">
							<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-800">
								<svg
									class="h-5 w-5 text-yellow-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
									/>
								</svg>
								Evaluación del Servicio
							</h3>
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700">
										Fuente de Consulta
									</label>
									<select
										bind:value={formData.fuente_consulta}
										class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
									>
										<option value={null}>Seleccione...</option>
										<option value="conductor">👤 Conductor</option>
										<option value="gps">📍 GPS</option>
										<option value="cliente">🏢 Cliente</option>
										<option value="sistema">💻 Sistema</option>
									</select>
								</div>
								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700">
										Calificación del Servicio
									</label>
									<select
										bind:value={formData.calificacion_servicio}
										class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
									>
										<option value={null}>Seleccione...</option>
										<option value="excelente">⭐⭐⭐⭐⭐ Excelente</option>
										<option value="bueno">⭐⭐⭐⭐ Bueno</option>
										<option value="regular">⭐⭐⭐ Regular</option>
										<option value="malo">⭐⭐ Malo</option>
									</select>
								</div>
							</div>
						</div>

						<!-- Métricas de Tiempo -->
						<div class="rounded-lg border border-gray-200 bg-white p-4">
							<h3 class="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-800">
								<svg
									class="h-5 w-5 text-indigo-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
								Métricas de Tiempo
							</h3>
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700">
										Tiempo Disponibilidad (horas)
									</label>
									<input
										type="number"
										step="0.1"
										min="0"
										bind:value={formData.tiempo_disponibilidad_horas}
										placeholder="Ej: 12.5"
										class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
									/>
								</div>
								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700">
										Duración Trayecto (horas)
									</label>
									<input
										type="number"
										step="0.1"
										min="0"
										value={totalHorasTrabajadas.toFixed(1)}
										disabled
										class="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600 cursor-not-allowed"
									/>
								</div>
								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700">
										Número de Días Servicio
									</label>
									<input
										type="number"
										min="1"
										bind:value={formData.numero_dias_servicio}
										placeholder="Ej: 3"
										class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
									/>
								</div>
								<div>
									<label class="mb-2 block text-sm font-medium text-gray-700">
										Total Kilometraje (km)
									</label>
									<input
										type="number"
										step="0.1"
										min="0"
										value={totalKilometraje.toFixed(1)}
										disabled
										class="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600 cursor-not-allowed"
									/>
								</div>
							</div>
						</div>
					</div>
				{:else if activeTab === 'horarios'}
					<!-- Tab: Horarios de Trabajo -->
					<div class="space-y-4" transition:fade={{ duration: 200 }}>
						<!-- Indicador de festivos colombianos -->
						{#if festivosDelMes.length > 0}
							<div class="rounded-lg border border-orange-200 bg-orange-50 p-3">
								<div class="flex items-center gap-2">
									<svg
										class="h-5 w-5 text-orange-600"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
										/>
									</svg>
									<div class="flex-1">
										<h4 class="text-sm font-semibold text-orange-800">
											Días Festivos de {getNombreMes(currentMonth)}
											{currentYear}
										</h4>
										<p class="mt-1 text-xs text-orange-700">
											{festivosDelMes.length}
											{festivosDelMes.length === 1 ? 'festivo' : 'festivos'}:
											{festivosDelMes.map((f) => `${f.dia} (${f.nombre})`).join(', ')}
										</p>
										<p class="mt-1 text-xs text-orange-600">
											Los días festivos se marcan automáticamente con 🎉
										</p>
									</div>
								</div>
							</div>
						{/if}

						<!-- Panel de acciones de copiado -->
						{#if selectedRow && hayMasDeUnDia}
							<div class="rounded-lg border border-blue-200 bg-blue-50 p-3">
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<svg
											class="h-4 w-4 text-blue-600"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
											/>
										</svg>
										<span class="text-sm font-medium text-blue-800">
											Fila seleccionada: {selectedIndex + 1} de {diasLaborales.length}
										</span>
									</div>
									<div class="flex gap-2">
										<button
											on:click={copiarSeleccionASiguientes}
											disabled={!hayDiasSiguientes}
											class="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
										>
											<svg
												class="h-3.5 w-3.5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
												/>
											</svg>
											Copiar Horas
										</button>
										<button
											on:click={incrementarDiasSiguientes}
											disabled={!hayDiasSiguientes}
											class="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
										>
											<svg
												class="h-3.5 w-3.5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M12 4v16m8-8H4"
												/>
											</svg>
											Incrementar Días
										</button>
										<button
											on:click={() => (selectedRow = null)}
											class="rounded-lg px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100"
										>
											Cancelar
										</button>
									</div>
								</div>
								{#if !hayDiasSiguientes}
									<div class="mt-2 text-xs text-gray-600">
										No hay días siguientes para aplicar estas acciones
									</div>
								{/if}
							</div>
						{/if}

						<!-- Botón para agregar días y mensajes de error -->
						<div class="mb-3 flex items-center justify-between gap-4">
							<!-- Mensajes de error -->
							<div class="flex-1">
								{#if mensajesError.length > 0}
									<div class="flex flex-col gap-1">
										{#each mensajesError as mensaje}
											<div
												class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600"
											>
												<svg
													class="h-4 w-4 flex-shrink-0"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
													/>
												</svg>
												<span>{mensaje}</span>
											</div>
										{/each}
									</div>
								{/if}
							</div>

							<!-- Botón agregar día - OCULTO: Los días se generan automáticamente según numero_dias_servicio -->
							<!-- 
							<button
								on:click={agregarDiaLaboral}
								disabled={diasLaborales.length >= 15}
								class="flex flex-shrink-0 items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 4v16m8-8H4"
									/>
								</svg>
								Agregar Día
								{#if diasLaborales.length < 15}
									<span class="text-xs opacity-75">({diasLaborales.length}/15)</span>
								{/if}
							</button>
							-->
						</div>

						<!-- Tabla de Recargos -->
						<div class="overflow-x-auto rounded-lg border border-gray-200">
							<table class="min-w-full divide-y divide-gray-200">
								<thead class="bg-gray-50">
									<tr>
										<th
											class="px-3 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											Día
										</th>
										<th
											class="px-3 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											Hora Inicio
										</th>
										<th
											class="px-3 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											Hora Fin
										</th>
										<th
											class="px-3 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											KM Inicial
										</th>
										<th
											class="px-3 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											KM Final
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											KM Recorridos
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											Pernocte
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											Disponible
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											Total (h)
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											HED<br /><span class="text-[10px] font-normal">(25%)</span>
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											HEN<br /><span class="text-[10px] font-normal">(75%)</span>
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											HEFD<br /><span class="text-[10px] font-normal">(100%)</span>
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											HEFN<br /><span class="text-[10px] font-normal">(150%)</span>
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											RN<br /><span class="text-[10px] font-normal">(35%)</span>
										</th>
										<th
											class="px-3 py-3 text-center text-xs font-medium tracking-wider text-gray-500 uppercase"
										>
											RD<br /><span class="text-[10px] font-normal">(75%)</span>
										</th>
										<!-- Columna Acciones REMOVIDA - Los días se generan automáticamente -->
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-200 bg-white">
									{#each diasLaborales as dia, rowIdx (dia.id)}
										{@const recargos = calcularRecargos(dia)}
										{@const totalHoras = calcularTotalHoras(dia.hora_inicio, dia.hora_fin)}
										{@const isSelected = selectedRow === dia.id}
										{@const isDomingo = dia.es_domingo}
										{@const isFestivo = dia.es_festivo}
										{@const maxDia = obtenerMaximoDiaMes(currentMonth, currentYear)}
										{@const kmInicial = dia.kilometraje_inicial ? parseFloat(dia.kilometraje_inicial) : 0}
										{@const kmFinal = dia.kilometraje_final ? parseFloat(dia.kilometraje_final) : 0}
										{@const kmRecorridos = kmFinal > kmInicial ? kmFinal - kmInicial : 0}
										<tr
											on:click={() => (selectedRow = dia.id)}
											class="cursor-pointer transition-colors {isSelected
												? 'border-l-4 border-blue-500 bg-blue-50'
												: isDomingo
													? 'bg-red-50 hover:bg-red-100'
													: isFestivo
														? 'bg-orange-50 hover:bg-orange-100'
														: 'hover:bg-gray-50'}"
										>
											<!-- Día -->
											<td class="px-3 py-2 whitespace-nowrap">
												<div class="flex items-center gap-2">
													<input
														type="number"
														min="1"
														max={maxDia}
														bind:value={dia.dia}
														on:input={(e) =>
															actualizarDiaLaboral(dia.id, 'dia', e.currentTarget.value)}
														on:keydown={handleHorarioCellKeydown}
														data-nav-row={rowIdx}
														data-nav-col="0"
														class="w-14 rounded border px-2 py-1 text-sm focus:ring-1 {erroresDias[
															dia.id
														]
															? 'border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500'
															: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'}"
														placeholder="1"
													/>
													{#if isFestivo}
														<span class="text-lg" title="Día festivo">🎉</span>
													{:else if isDomingo}
														<span class="text-lg" title="Domingo">🌞</span>
													{:else}
														<span class="text-lg" title="Día normal">📆</span>
													{/if}
												</div>
											</td>

											<!-- Hora Inicio -->
											<td class="px-3 py-2 whitespace-nowrap">
												<input
													type="number"
													min="0.5"
													max="48"
													step="0.5"
													bind:value={dia.hora_inicio}
													on:input={(e) =>
														actualizarDiaLaboral(dia.id, 'hora_inicio', e.currentTarget.value)}
													on:keydown={handleHorarioCellKeydown}
													data-nav-row={rowIdx}
													data-nav-col="1"
													class="w-20 rounded border px-2 py-1 text-sm focus:ring-1 {erroresHoras[
														dia.id
													]?.inicio
														? 'border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500'
														: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'}"
													placeholder="0.5"
												/>
											</td>

											<!-- Hora Fin -->
											<td class="px-3 py-2 whitespace-nowrap">
												<input
													type="number"
													min="0.5"
													max="48"
													step="0.5"
													bind:value={dia.hora_fin}
													on:input={(e) =>
														actualizarDiaLaboral(dia.id, 'hora_fin', e.currentTarget.value)}
													on:keydown={handleHorarioCellKeydown}
													data-nav-row={rowIdx}
													data-nav-col="2"
													class="w-20 rounded border px-2 py-1 text-sm focus:ring-1 {erroresHoras[
														dia.id
													]?.fin
														? 'border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500'
														: 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'}"
													placeholder="0.5"
												/>
											</td>

											<!-- KM Inicial -->
											<td class="px-3 py-2 whitespace-nowrap">
												<input
													type="number"
													bind:value={dia.kilometraje_inicial}
													on:input={(e) =>
														actualizarDiaLaboral(
															dia.id,
															'kilometraje_inicial',
															e.currentTarget.value
														)}
													on:keydown={handleHorarioCellKeydown}
													data-nav-row={rowIdx}
													data-nav-col="3"
													class="w-20 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
													placeholder="0"
												/>
											</td>

											<!-- KM Final -->
											<td class="px-3 py-2 whitespace-nowrap">
												<input
													type="number"
													bind:value={dia.kilometraje_final}
													on:input={(e) =>
														actualizarDiaLaboral(
															dia.id,
															'kilometraje_final',
															e.currentTarget.value
														)}
													on:keydown={handleHorarioCellKeydown}
													data-nav-row={rowIdx}
													data-nav-col="4"
													class="w-20 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
													placeholder="0"
												/>
											</td>

											<!-- KM Recorridos (Calculado) -->
											<td class="px-3 py-2 text-center whitespace-nowrap">
												<span class="text-sm font-semibold text-gray-700">
													{kmRecorridos > 0 ? kmRecorridos.toFixed(1) : '-'}
												</span>
											</td>

											<!-- Pernocte -->
											<td class="px-3 py-2 text-center">
												<input
													type="checkbox"
													bind:checked={dia.pernocte}
													on:change={(e) =>
														actualizarDiaLaboral(dia.id, 'pernocte', e.currentTarget.checked)}
													class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
												/>
											</td>

											<!-- Disponible -->
											<td class="px-3 py-2 text-center">
												<input
													type="checkbox"
													bind:checked={dia.disponibilidad}
													on:change={(e) =>
														actualizarDiaLaboral(dia.id, 'disponibilidad', e.currentTarget.checked)}
													class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
												/>
											</td>
											<!-- Total Horas -->
											<td class="px-3 py-2 text-center whitespace-nowrap">
												<span class="text-sm font-semibold text-gray-700">
													{totalHoras > 0 ? totalHoras.toFixed(1) : '-'}
												</span>
											</td>

											<!-- HED -->
											<td class="px-3 py-2 text-center">
												<span
													class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium {obtenerColorRecargo(
														'HED',
														recargos.HED
													)}"
												>
													{recargos.HED > 0 ? recargos.HED.toFixed(1) : '-'}
												</span>
											</td>

											<!-- HEN -->
											<td class="px-3 py-2 text-center">
												<span
													class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium {obtenerColorRecargo(
														'HEN',
														recargos.HEN
													)}"
												>
													{recargos.HEN > 0 ? recargos.HEN.toFixed(1) : '-'}
												</span>
											</td>

											<!-- HEFD -->
											<td class="px-3 py-2 text-center">
												<span
													class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium {obtenerColorRecargo(
														'HEFD',
														recargos.HEFD
													)}"
												>
													{recargos.HEFD > 0 ? recargos.HEFD.toFixed(1) : '-'}
												</span>
											</td>

											<!-- HEFN -->
											<td class="px-3 py-2 text-center">
												<span
													class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium {obtenerColorRecargo(
														'HEFN',
														recargos.HEFN
													)}"
												>
													{recargos.HEFN > 0 ? recargos.HEFN.toFixed(1) : '-'}
												</span>
											</td>

											<!-- RN -->
											<td class="px-3 py-2 text-center">
												<span
													class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium {obtenerColorRecargo(
														'RN',
														recargos.RN
													)}"
												>
													{recargos.RN > 0 ? recargos.RN.toFixed(1) : '-'}
												</span>
											</td>

											<!-- RD -->
											<td class="px-3 py-2 text-center">
												<span
													class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium {obtenerColorRecargo(
														'RD',
														recargos.RD
													)}"
												>
													{recargos.RD > 0 ? recargos.RD.toFixed(1) : '-'}
												</span>
											</td>

											<!-- Columna Acciones REMOVIDA -->
										</tr>
									{/each}
								</tbody>
							</table>
						</div>

						<!-- Resumen de Totales -->
						<div class="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
							<!-- HED Card -->
							<div
								class="rounded-lg border border-orange-200 bg-gradient-to-br from-orange-50 to-orange-100 p-4"
							>
								<div class="mb-2 flex items-center justify-between">
									<span class="text-xs font-medium text-orange-700">HED</span>
									<span class="text-xs text-orange-600">25%</span>
								</div>
								<div class="text-2xl font-bold text-orange-800">{totales.HED.toFixed(1)}</div>
								<div class="mt-1 text-[10px] text-orange-600">Hora Extra Diurna</div>
							</div>

							<!-- HEN Card -->
							<div
								class="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-4"
							>
								<div class="mb-2 flex items-center justify-between">
									<span class="text-xs font-medium text-blue-700">HEN</span>
									<span class="text-xs text-blue-600">75%</span>
								</div>
								<div class="text-2xl font-bold text-blue-800">{totales.HEN.toFixed(1)}</div>
								<div class="mt-1 text-[10px] text-blue-600">Hora Extra Nocturna</div>
							</div>

							<!-- HEFD Card -->
							<div
								class="rounded-lg border border-yellow-200 bg-gradient-to-br from-yellow-50 to-yellow-100 p-4"
							>
								<div class="mb-2 flex items-center justify-between">
									<span class="text-xs font-medium text-yellow-700">HEFD</span>
									<span class="text-xs text-yellow-600">100%</span>
								</div>
								<div class="text-2xl font-bold text-yellow-800">{totales.HEFD.toFixed(1)}</div>
								<div class="mt-1 text-[10px] text-yellow-600">H. Extra Festiva Diurna</div>
							</div>

							<!-- HEFN Card -->
							<div
								class="rounded-lg border border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100 p-4"
							>
								<div class="mb-2 flex items-center justify-between">
									<span class="text-xs font-medium text-purple-700">HEFN</span>
									<span class="text-xs text-purple-600">150%</span>
								</div>
								<div class="text-2xl font-bold text-purple-800">{totales.HEFN.toFixed(1)}</div>
								<div class="mt-1 text-[10px] text-purple-600">H. Extra Festiva Nocturna</div>
							</div>

							<!-- RN Card -->
							<div
								class="rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50 to-indigo-100 p-4"
							>
								<div class="mb-2 flex items-center justify-between">
									<span class="text-xs font-medium text-indigo-700">RN</span>
									<span class="text-xs text-indigo-600">35%</span>
								</div>
								<div class="text-2xl font-bold text-indigo-800">{totales.RN.toFixed(1)}</div>
								<div class="mt-1 text-[10px] text-indigo-600">Recargo Nocturno</div>
							</div>

							<!-- RD Card -->
							<div
								class="rounded-lg border border-red-200 bg-gradient-to-br from-red-50 to-red-100 p-4"
							>
								<div class="mb-2 flex items-center justify-between">
									<span class="text-xs font-medium text-red-700">RD</span>
									<span class="text-xs text-red-600">75%</span>
								</div>
								<div class="text-2xl font-bold text-red-800">{totales.RD.toFixed(1)}</div>
								<div class="mt-1 text-[10px] text-red-600">Recargo Dominical/Festivo</div>
							</div>
						</div>

						<!-- Estadísticas adicionales -->
						<div
							class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3"
						>
							<div class="flex items-center gap-4 text-xs text-gray-600">
								<div>
									<span class="font-medium">Total Días:</span>
									<span class="ml-1 font-bold text-gray-800">{diasLaborales.length}</span>
								</div>
								<div>
									<span class="font-medium">Con Datos:</span>
									<span class="ml-1 font-bold text-gray-800">
										{diasLaborales.filter((d) => d.hora_inicio && d.hora_fin).length}
									</span>
								</div>
								<div>
									<span class="font-medium">Total Horas:</span>
									<span class="ml-1 font-bold text-gray-800">{totales.totalHoras.toFixed(1)}</span>
								</div>
							</div>
							<div class="text-[10px] text-gray-500 italic">
								Cálculo según normativa laboral colombiana
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div
				class="sticky bottom-0 flex items-center justify-between border-t border-gray-200 bg-white px-6 py-4"
			>
				<div class="flex items-center gap-2 text-sm text-gray-600">
					<div
						class="h-2 w-2 rounded-full {progress.completed === progress.total
							? 'bg-orange-500'
							: 'bg-amber-500'}"
					></div>
					{#if progress.completed === progress.total}
						Formulario completo
					{:else}
						{progress.total - progress.completed} campos pendientes
					{/if}
				</div>

				<div class="flex gap-3">
					<button
						on:click={handleClose}
						disabled={isLoading}
						class="rounded-lg border border-gray-300 px-6 py-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
					>
						Cancelar
					</button>
					<button
						on:click={handleSubmit}
						disabled={isLoading || progress.completed !== progress.total}
						class="flex items-center gap-2 px-6 py-2 {editMode
							? 'bg-blue-500 hover:bg-blue-600'
							: 'bg-orange-500 hover:bg-orange-600'} rounded-lg text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if isLoading}
							<div
								class="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
							></div>
						{:else}
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5 13l4 4L19 7"
								/>
							</svg>
						{/if}
						{editMode ? 'Actualizar' : 'Crear'} Recargo
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
