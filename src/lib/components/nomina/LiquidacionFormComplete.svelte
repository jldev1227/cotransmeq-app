<script lang="ts">
	import { onMount } from 'svelte';
	import Select from 'svelte-select';
	import { obtenerConductores, obtenerVehiculos, obtenerEmpresas, obtenerConfiguracion } from '$lib/api/nomina';
	import type { Conductor, Vehiculo, Empresa, ConfiguracionLiquidacion } from '$lib/types/nomina';
	import { 
		ChevronLeft, 
		ChevronRight, 
		Save, 
		Plus, 
		Trash2, 
		Calendar, 
		Users, 
		Truck,
		DollarSign,
		Calculator,
		FileText
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import CalendarPernote from './CalendarPernote.svelte';

	// Props
	export let mode: 'create' | 'edit' = 'create';
	export let initialData: any = null;
	export let onSubmit: (data: any) => Promise<void>;
	export let loading = false;

	// Datos de catálogos
	let conductores: Conductor[] = [];
	let vehiculos: Vehiculo[] = [];
	let empresas: Empresa[] = [];
	let configuracion: any[] = [];
	let loadingData = true;

	// Estado del formulario
	let currentStep = 1;
	const totalSteps = 3;

	// PASO 1: Datos básicos
	let conductorSelected: { value: string; label: string } | null = null;
	let vehiculosSelected: Array<{ value: string; label: string }> = [];
	let periodo_inicio = '';
	let periodo_fin = '';

	// PASO 2: Días laborados y salarios
	let dias_laborados = 0;
	let dias_laborados_villanueva = 0;
	let dias_laborados_anual = 0;

	// PASO 3: Opciones y ajustes
	let isCheckedAjuste = false;
	let isAjustePorDia = false;
	let isAjusteParex = false;
	let isVacaciones = false;
	let isIncapacidad = false;
	let isCesantias = false;
	let isPrima = false;
	let noDescontarSalud = false;
	let noDescontarPension = false;
	let descontarTransporte = false;

	// Períodos especiales
	let periodo_vacaciones_inicio = '';
	let periodo_vacaciones_fin = '';
	let periodo_incapacidad_inicio = '';
	let periodo_incapacidad_fin = '';

	// Valores financieros
	let cesantias = 0;
	let interes_cesantias = 0;
	let prima = 0;
	let prima_pendiente: number | null = null;

	// Detalles de vehículos
	interface VehiculoDetalle {
		vehiculo: { value: string; label: string };
		bonos: Array<{
			name: string;
			value: number;
			values: Array<{ mes: string; quantity: number }>;
			vehiculo_id: string;
		}>;
		mantenimientos: Array<{
			values: Array<{ mes: string; quantity: number }>;
			value: number;
			vehiculo_id: string;
		}>;
		pernotes: Array<{
			vehiculo_id: string;
			empresa_id: string;
			cantidad: number;
			fechas: string[];
			valor: number;
		}>;
		recargos: Array<{
			vehiculo_id: string;
			empresa_id: string;
			valor: number;
			pag_cliente: boolean;
			mes: string;
		}>;
	}

	let detallesVehiculos: VehiculoDetalle[] = [];
	let mesesRange: string[] = [];

	// Anticipos
	let anticipos: Array<{ id: string; valor: number; fecha: string; concepto: string }> = [];
	let showAnticipoForm = false;
	let nuevoAnticipo = { valor: '', fecha: '', concepto: '' };

	// Conceptos adicionales (ajustes)
	let conceptos_adicionales: Array<{ valor: number; observaciones: string }> = [];
	let showConceptoForm = false;
	let nuevoConcepto = { valor: '', observaciones: '' };

	// Options para selects
	$: conductoresOptions = conductores
		.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
		.map(c => ({
			value: c.id,
			label: `${c.nombre} ${c.apellido || ''}`
		}));

	$: vehiculosOptions = vehiculos
		.sort((a, b) => a.placa.localeCompare(b.placa))
		.map(v => ({
			value: v.id,
			label: v.placa
		}));

	$: empresasOptions = empresas.map(e => ({
		value: e.id,
		label: e.nombre
	}));

	onMount(async () => {
		await cargarDatos();
		if (mode === 'edit' && initialData) {
			cargarDatosIniciales();
		}
	});

	async function cargarDatos() {
		try {
			loadingData = true;
			const [conductoresRes, vehiculosRes, empresasRes, configRes] = await Promise.all([
				obtenerConductores(),
				obtenerVehiculos(),
				obtenerEmpresas(),
				obtenerConfiguracion()
			]);

			conductores = conductoresRes.data || [];
			console.log('📋 Conductores cargados en frontend:', conductores.map(c => ({
				id: c.id,
				nombre: `${c.nombre} ${c.apellido || ''}`,
				salario_base: c.salario_base,
				tipo: typeof c.salario_base
			})));
			vehiculos = vehiculosRes.data || [];
			empresas = empresasRes.data || [];
			
			// Configuración viene como objeto, convertir a array
			if (configRes.data) {
				configuracion = Array.isArray(configRes.data) ? configRes.data : [configRes.data];
			}
		} catch (error) {
			console.error('Error cargando datos:', error);
			toast.error('Error al cargar los datos del formulario');
		} finally {
			loadingData = false;
		}
	}

	function cargarDatosIniciales() {
		if (!initialData) return;

		// Cargar conductor
		conductorSelected = conductoresOptions.find(c => c.value === initialData.conductor_id) || null;

		// Cargar vehículos
		vehiculosSelected = vehiculosOptions.filter(v =>
			initialData.vehiculos?.some((vh: any) => vh.id === v.value)
		);

		// Cargar fechas
		periodo_inicio = initialData.periodo_inicio?.split('T')[0] || initialData.periodo_start?.split('T')[0] || '';
		periodo_fin = initialData.periodo_fin?.split('T')[0] || initialData.periodo_end?.split('T')[0] || '';

		// Cargar días
		dias_laborados = initialData.dias_laborados || 0;
		dias_laborados_villanueva = initialData.dias_laborados_villanueva || 0;
		dias_laborados_anual = initialData.dias_laborados_anual || 0;

		// Cargar checkboxes
		isCheckedAjuste = (initialData.ajuste_salarial ?? 0) > 0;
		isAjustePorDia = !!initialData.ajuste_salarial_por_dia;
		isAjusteParex = (initialData.ajuste_parex ?? 0) > 0;
		noDescontarSalud = (initialData.salud ?? 0) === 0;
		noDescontarPension = (initialData.pension ?? 0) === 0;
		descontarTransporte = initialData.auxilio_transporte === 0;
		isCesantias = (initialData.cesantias ?? 0) > 0 || (initialData.interes_cesantias ?? 0) > 0;
		isPrima = (initialData.prima ?? 0) > 0;
		isVacaciones = !!initialData.periodo_start_vacaciones;
		isIncapacidad = !!initialData.periodo_start_incapacidad;

		// Cargar valores financieros
		cesantias = initialData.cesantias || 0;
		interes_cesantias = initialData.interes_cesantias || 0;
		prima = initialData.prima || 0;
		prima_pendiente = initialData.prima_pendiente || null;

		// Cargar períodos especiales
		if (initialData.periodo_start_vacaciones) {
			periodo_vacaciones_inicio = initialData.periodo_start_vacaciones.split('T')[0];
			periodo_vacaciones_fin = initialData.periodo_end_vacaciones?.split('T')[0] || '';
		}
		if (initialData.periodo_start_incapacidad) {
			periodo_incapacidad_inicio = initialData.periodo_start_incapacidad.split('T')[0];
			periodo_incapacidad_fin = initialData.periodo_end_incapacidad?.split('T')[0] || '';
		}

		// Cargar anticipos
		anticipos = (initialData.anticipos || []).map((a: any) => ({
			id: a.id || Date.now().toString(),
			valor: a.valor,
			fecha: a.fecha?.split('T')[0] || '',
			concepto: a.concepto || ''
		}));

		// Cargar conceptos adicionales
		conceptos_adicionales = initialData.conceptos_adicionales || [];

		// TODO: Cargar detalles de vehículos (bonos, pernotes, recargos, mantenimientos)
	}

	// Actualizar meses cuando cambian las fechas
	$: if (periodo_inicio && periodo_fin) {
		actualizarMeses();
	}

	function actualizarMeses() {
		const inicio = new Date(periodo_inicio + 'T00:00:00');
		const fin = new Date(periodo_fin + 'T00:00:00');
		const meses: string[] = [];
		
		// Iterar mes a mes desde el mes de inicio hasta el mes de fin
		const current = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
		const mesFinYear = fin.getFullYear();
		const mesFinMonth = fin.getMonth();
		
		while (current.getFullYear() < mesFinYear || 
			   (current.getFullYear() === mesFinYear && current.getMonth() <= mesFinMonth)) {
			const mesStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
			meses.push(mesStr);
			current.setMonth(current.getMonth() + 1);
		}
		
		mesesRange = meses;
	}

	// Inicializar detalles de vehículos cuando cambian vehículos o meses
	$: if (vehiculosSelected.length > 0 && mesesRange.length > 0) {
		inicializarDetallesVehiculos();
	}

	function inicializarDetallesVehiculos() {
		const bonosConfiguracion = configuracion.filter(c => 
			c.nombre?.toLowerCase().includes('bono')
		);

		const valorMantenimiento = Number(
			configuracion.find(c => c.nombre === 'Mantenimiento')?.valor || 0
		);

		const valorPernote = Number(
			configuracion.find(c => c.nombre === 'Pernote')?.valor || 0
		);

		detallesVehiculos = vehiculosSelected.map(vehiculo => {
			const detalleExistente = detallesVehiculos.find(
				d => d.vehiculo.value === vehiculo.value
			);

			if (detalleExistente) {
				// Actualizar meses en bonos existentes preservando cantidades
				const bonosActualizados = detalleExistente.bonos.map(bono => ({
					...bono,
					values: mesesRange.map(mes => {
						const existing = bono.values.find(v => v.mes === mes);
						return existing || { mes, quantity: 0 };
					})
				}));

				// Actualizar meses en mantenimientos existentes preservando cantidades
				const mantenimientosActualizados = detalleExistente.mantenimientos.map(mant => ({
					...mant,
					values: mesesRange.map(mes => {
						const existing = mant.values.find(v => v.mes === mes);
						return existing || { mes, quantity: 0 };
					})
				}));

				return {
					...detalleExistente,
					bonos: bonosActualizados,
					mantenimientos: mantenimientosActualizados
				};
			}

			// Crear bonos para cada mes
			const bonos = bonosConfiguracion.map(bono => ({
				name: bono.nombre,
				value: Number(bono.valor || 0),
				values: mesesRange.map(mes => ({ mes, quantity: 0 })),
				vehiculo_id: vehiculo.value
			}));

			// Crear mantenimientos para cada mes
			const mantenimientos = [{
				values: mesesRange.map(mes => ({ mes, quantity: 0 })),
				value: valorMantenimiento,
				vehiculo_id: vehiculo.value
			}];

			return {
				vehiculo,
				bonos,
				mantenimientos,
				pernotes: [],
				recargos: []
			};
		});
	}

	// Manejo de cambios en bonos
	function handleBonoChange(
		vehiculoId: string,
		bonoName: string,
		mes: string,
		quantity: number
	) {
		detallesVehiculos = detallesVehiculos.map(detalle => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				bonos: detalle.bonos.map(bono => {
					if (bono.name !== bonoName) return bono;

					return {
						...bono,
						values: bono.values.map(val =>
							val.mes === mes ? { ...val, quantity } : val
						)
					};
				})
			};
		});
	}

	// Manejo de cambios en mantenimientos
	function handleMantenimientoChange(
		vehiculoId: string,
		mes: string,
		quantity: number
	) {
		detallesVehiculos = detallesVehiculos.map(detalle => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				mantenimientos: detalle.mantenimientos.map(mant => ({
					...mant,
					values: mant.values.map(val =>
						val.mes === mes ? { ...val, quantity } : val
					)
				}))
			};
		});
	}

	// Agregar pernote
	function handleAddPernote(vehiculoId: string) {
		const valorPernote = Number(
			configuracion.find(c => c.nombre === 'Pernote')?.valor || 0
		);

		detallesVehiculos = detallesVehiculos.map(detalle => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				pernotes: [
					...detalle.pernotes,
					{
						vehiculo_id: vehiculoId,
						empresa_id: '',
						cantidad: 0,
						fechas: [],
						valor: valorPernote
					}
				]
			};
		});
	}

	// Actualizar pernote
	function handlePernoteChange(
		vehiculoId: string,
		index: number,
		field: string,
		value: any
	) {
		detallesVehiculos = detallesVehiculos.map(detalle => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				pernotes: detalle.pernotes.map((pernote, i) =>
					i === index ? { ...pernote, [field]: value } : pernote
				)
			};
		});
	}

	// Eliminar pernote
	function handleRemovePernote(vehiculoId: string, index: number) {
		detallesVehiculos = detallesVehiculos.map(detalle => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				pernotes: detalle.pernotes.filter((_, i) => i !== index)
			};
		});
	}

	// Agregar recargo
	function handleAddRecargo(vehiculoId: string) {
		detallesVehiculos = detallesVehiculos.map(detalle => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				recargos: [
					...detalle.recargos,
					{
						vehiculo_id: vehiculoId,
						empresa_id: '',
						valor: 0,
						pag_cliente: false,
						mes: mesesRange[0] || ''
					}
				]
			};
		});
	}

	// Actualizar recargo
	function handleRecargoChange(
		vehiculoId: string,
		index: number,
		field: string,
		value: any
	) {
		detallesVehiculos = detallesVehiculos.map(detalle => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				recargos: detalle.recargos.map((recargo, i) =>
					i === index ? { ...recargo, [field]: value } : recargo
				)
			};
		});
	}

	// Eliminar recargo
	function handleRemoveRecargo(vehiculoId: string, index: number) {
		detallesVehiculos = detallesVehiculos.map(detalle => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				recargos: detalle.recargos.filter((_, i) => i !== index)
			};
		});
	}

	// Manejar anticipos
	function agregarAnticipo() {
		if (!nuevoAnticipo.valor || !nuevoAnticipo.fecha) {
			toast.error('Complete los datos del anticipo');
			return;
		}

		const valor = parseFloat(nuevoAnticipo.valor);
		if (isNaN(valor) || valor <= 0) {
			toast.error('El valor debe ser mayor a 0');
			return;
		}

		anticipos = [
			...anticipos,
			{
				id: Date.now().toString(),
				valor,
				fecha: nuevoAnticipo.fecha,
				concepto: nuevoAnticipo.concepto
			}
		];

		nuevoAnticipo = { valor: '', fecha: '', concepto: '' };
		showAnticipoForm = false;
	}

	function eliminarAnticipo(id: string) {
		anticipos = anticipos.filter(a => a.id !== id);
	}

	// Manejar conceptos adicionales
	function agregarConcepto() {
		if (!nuevoConcepto.valor || !nuevoConcepto.observaciones) {
			toast.error('Complete los datos del concepto');
			return;
		}

		const valor = parseFloat(nuevoConcepto.valor);
		if (isNaN(valor) || valor === 0) {
			toast.error('El valor debe ser diferente de 0');
			return;
		}

		conceptos_adicionales = [
			...conceptos_adicionales,
			{
				valor,
				observaciones: nuevoConcepto.observaciones.trim()
			}
		];

		nuevoConcepto = { valor: '', observaciones: '' };
		showConceptoForm = false;
	}

	function eliminarConcepto(index: number) {
		conceptos_adicionales = conceptos_adicionales.filter((_, i) => i !== index);
	}

	// Cálculos financieros - list all reactive dependencies explicitly so Svelte tracks them
	$: _deps = [
		conductores, conductorSelected, dias_laborados, dias_laborados_villanueva, dias_laborados_anual,
		detallesVehiculos, anticipos, conceptos_adicionales,
		isCheckedAjuste, isAjustePorDia, isAjusteParex, isVacaciones, isIncapacidad,
		isCesantias, isPrima, noDescontarSalud, noDescontarPension, descontarTransporte,
		periodo_vacaciones_inicio, periodo_vacaciones_fin,
		periodo_incapacidad_inicio, periodo_incapacidad_fin,
		cesantias, interes_cesantias, prima, prima_pendiente, configuracion
	];
	$: totales = (_deps, calcularTotales());

	function calcularTotales() {
		const conductor = conductores.find(c => c.id === conductorSelected?.value);
		if (!conductor) {
			return {
				salarioDevengado: 0,
				auxilioTransporte: 0,
				totalBonificaciones: 0,
				totalPernotes: 0,
				totalRecargos: 0,
				totalVacaciones: 0,
				bonificacionVillanueva: 0,
				valorIncapacidad: 0,
				ajusteParex: 0,
				interesCesantias: 0,
				sueldoBruto: 0,
				salud: 0,
				pension: 0,
				saludVacaciones: 0,
				pensionVacaciones: 0,
				totalAnticipos: 0,
				totalAjustesAdicionales: 0,
				totalDeducciones: 0,
				sueldoTotal: 0
			};
		}

		const salarioBase = Number(conductor.salario_base) || 0;
		const salarioDevengado = (salarioBase / 30) * dias_laborados;

		const configAuxilioTransporte = Number(
			configuracion.find(c => c.nombre === 'Auxilio de transporte')?.valor || 0
		);
		const auxilioTransporte = descontarTransporte
			? 0
			: (configAuxilioTransporte / 30) * dias_laborados;

		// Calcular bonificaciones
		const totalBonificaciones = detallesVehiculos.reduce((acc, detalle) => {
			return acc + detalle.bonos.reduce((total, bono) => {
				return total + bono.values.reduce((sum, val) => {
					return sum + val.quantity * bono.value;
				}, 0);
			}, 0);
		}, 0);

		// Calcular pernotes
		const totalPernotes = detallesVehiculos.reduce((acc, detalle) => {
			return acc + detalle.pernotes.reduce((total, pernote) => {
				return total + pernote.cantidad * pernote.valor;
			}, 0);
		}, 0);

		// Calcular recargos
		const totalRecargos = detallesVehiculos.reduce((acc, detalle) => {
			return acc + detalle.recargos.reduce((total, recargo) => {
				return total + recargo.valor;
			}, 0);
		}, 0);

		// Bonificación Villanueva
		let bonificacionVillanueva = 0;
		if (isCheckedAjuste) {
			const salarioVillanueva = Number(
				configuracion.find(c => c.nombre === 'Salario villanueva')?.valor || 0
			);
			const ajusteCalculado = (salarioVillanueva - salarioBase) / 30;

			if (!isAjustePorDia && dias_laborados_villanueva >= 17) {
				bonificacionVillanueva = salarioVillanueva - salarioBase;
			} else {
				bonificacionVillanueva = ajusteCalculado * dias_laborados_villanueva;
			}
		}

		// Ajuste PAREX
		let ajusteParexValor = 0;
		if (isAjusteParex) {
			const PAREX_EMPRESA_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';
			const recargosParex = detallesVehiculos
				.flatMap(d => d.recargos)
				.filter(r => r.empresa_id === PAREX_EMPRESA_ID);
			const totalRecargosParex = recargosParex.reduce((sum, r) => sum + r.valor, 0);
			ajusteParexValor = totalRecargosParex * 0.08;
		}

		// Valor incapacidad
		let valorIncapacidad = 0;
		if (isIncapacidad) {
			const devengado = (salarioBase / 30) * dias_laborados;
			const totalIncapacidad = salarioBase - devengado;
			valorIncapacidad = totalIncapacidad > 0 ? totalIncapacidad : 0;
		}

		// Vacaciones
		let totalVacaciones = 0;
		if (isVacaciones && periodo_vacaciones_inicio && periodo_vacaciones_fin) {
			const inicio = new Date(periodo_vacaciones_inicio + 'T00:00:00');
			const fin = new Date(periodo_vacaciones_fin + 'T00:00:00');
			const diasVacaciones = Math.ceil((fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
			totalVacaciones = (salarioBase / 30) * diasVacaciones;
		}

		// Base de cálculo para salud y pensión
		const baseCalculo = salarioDevengado + valorIncapacidad;

		// Porcentajes de salud y pensión
		const porcentajeSalud = Number(
			configuracion.find(c => c.nombre === 'Salud')?.valor || 0
		) / 100;
		const porcentajePension = Number(
			configuracion.find(c => c.nombre === 'Pensión')?.valor || 0
		) / 100;

		const ajusteParexPorConcepto = ajusteParexValor * 0.5;

		// Deducciones
		const salud = noDescontarSalud ? 0 : baseCalculo * porcentajeSalud + ajusteParexPorConcepto;
		const pension = noDescontarPension ? 0 : baseCalculo * porcentajePension + ajusteParexPorConcepto;
		const saludVacaciones = noDescontarSalud ? 0 : totalVacaciones * porcentajeSalud;
		const pensionVacaciones = noDescontarPension ? 0 : totalVacaciones * porcentajePension;

		const totalAnticipos = anticipos.reduce((sum, a) => sum + a.valor, 0);
		const totalAjustesAdicionales = conceptos_adicionales.reduce((sum, c) => sum + c.valor, 0);

		const totalDeducciones = salud + pension + saludVacaciones + pensionVacaciones + totalAnticipos;

		// Sueldo bruto
		const sueldoBruto =
			salarioDevengado +
			auxilioTransporte +
			totalBonificaciones +
			totalPernotes +
			totalRecargos +
			totalVacaciones +
			bonificacionVillanueva +
			valorIncapacidad +
			interes_cesantias +
			(prima_pendiente || 0) +
			totalAjustesAdicionales;

		const sueldoTotal = sueldoBruto - totalDeducciones;

		return {
			salarioDevengado,
			auxilioTransporte,
			totalBonificaciones,
			totalPernotes,
			totalRecargos,
			totalVacaciones,
			bonificacionVillanueva,
			valorIncapacidad,
			ajusteParex: ajusteParexValor,
			interesCesantias: interes_cesantias,
			sueldoBruto,
			salud,
			pension,
			saludVacaciones,
			pensionVacaciones,
			totalAnticipos,
			totalAjustesAdicionales,
			totalDeducciones,
			sueldoTotal
		};
	}

	// Navegación
	function nextStep() {
		if (!validarPaso()) return;
		if (currentStep < totalSteps) {
			currentStep++;
			window.scrollTo(0, 0);
		}
	}

	function prevStep() {
		if (currentStep > 1) {
			currentStep--;
			window.scrollTo(0, 0);
		}
	}

	// Validación
	function validarPaso(): boolean {
		switch (currentStep) {
			case 1:
				if (!conductorSelected) {
					toast.error('Seleccione un conductor');
					return false;
				}
				if (!periodo_inicio || !periodo_fin) {
					toast.error('Ingrese las fechas del período');
					return false;
				}
				if (vehiculosSelected.length === 0) {
					toast.error('Seleccione al menos un vehículo');
					return false;
				}
				break;
			case 2:
				break;
		}
		return true;
	}

	// Envío del formulario
	async function handleSubmit() {
		if (!validarPaso()) return;

		const payload = {
			id: initialData?.id,
			conductor_id: conductorSelected?.value,
			periodo_inicio,
			periodo_fin,
			periodo_vacaciones_inicio: isVacaciones ? periodo_vacaciones_inicio : null,
			periodo_vacaciones_fin: isVacaciones ? periodo_vacaciones_fin : null,
			periodo_incapacidad_inicio: isIncapacidad ? periodo_incapacidad_inicio : null,
			periodo_incapacidad_fin: isIncapacidad ? periodo_incapacidad_fin : null,
			ajuste_parex: isAjusteParex,
			ajuste_parex_valor: totales.ajusteParex,
			ajuste_por_dia_flag: isAjustePorDia,
			auxilio_transporte: totales.auxilioTransporte,
			sueldo_total: totales.sueldoTotal,
			salario_base: totales.salarioDevengado,
			total_pernotes: totales.totalPernotes,
			total_bonificaciones: totales.totalBonificaciones,
			total_recargos: totales.totalRecargos,
			total_vacaciones: totales.totalVacaciones,
			total_anticipos: totales.totalAnticipos,
			dias_laborados,
			dias_laborados_villanueva,
			dias_laborados_anual,
			ajuste_valor: totales.bonificacionVillanueva,
			valor_incapacidad: totales.valorIncapacidad,
			salud: totales.salud + totales.saludVacaciones,
			pension: totales.pension + totales.pensionVacaciones,
			cesantias,
			interes_cesantias,
			prima,
			prima_pendiente,
			estado: totales.salud > 0 && totales.pension > 0 ? 'Liquidado' : 'Pendiente',
			vehiculos: vehiculosSelected.map(v => v.value),
			detalles_vehiculos: detallesVehiculos,
			anticipos,
			conceptos_adicionales
		};

		await onSubmit(payload);
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0
		}).format(amount);
	}

	// Formateo COP para inputs de texto
	function formatCOPInput(value: number): string {
		if (!value && value !== 0) return '';
		return new Intl.NumberFormat('es-CO').format(value);
	}

	function parseCOPInput(text: string): number {
		const cleaned = text.replace(/[^\d-]/g, '');
		return parseInt(cleaned) || 0;
	}

	function handleCOPFocus(e: FocusEvent) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = parseCOPInput(input.value);
		input.value = raw ? raw.toString() : '';
		input.select();
	}

	function handleCOPBlur(e: FocusEvent) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = parseCOPInput(input.value);
		input.value = raw ? '$ ' + formatCOPInput(raw) : '';
	}

	function formatMes(mes: string): string {
		const [year, month] = mes.split('-');
		const date = new Date(parseInt(year), parseInt(month) - 1);
		return date.toLocaleDateString('es-CO', { month: 'short', year: 'numeric' });
	}
</script>

{#if loadingData}
	<div class="flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div
				class="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
			></div>
			<p class="mt-4 text-gray-600">Cargando datos...</p>
		</div>
	</div>
{:else}
	<div class="mx-auto max-w-7xl p-6">
		<!-- Header -->
		<div class="mb-6">
			<button
				on:click={() => window.history.back()}
				class="mb-4 flex items-center gap-2 text-gray-600 hover:text-gray-900"
			>
				<ChevronLeft class="h-5 w-5" />
				Volver
			</button>
			<h1 class="text-3xl font-bold text-gray-900">
				{mode === 'create' ? 'Nueva Liquidación' : 'Editar Liquidación'}
			</h1>
		</div>

		<!-- Stepper -->
		<div class="mb-8">
			<div class="flex items-center justify-between">
				{#each Array(totalSteps) as _, i}
					<div class="flex {i < totalSteps - 1 ? 'flex-1' : ''} items-center">
						<div
							class="flex h-12 w-12 items-center justify-center rounded-full {currentStep > i + 1
								? 'bg-orange-600'
								: currentStep === i + 1
									? 'bg-orange-500'
									: 'bg-gray-300'} text-lg font-semibold text-white"
						>
							{i + 1}
						</div>
						{#if i < totalSteps - 1}
							<div
								class="mx-2 h-1 flex-1 {currentStep > i + 1 ? 'bg-orange-600' : 'bg-gray-300'}"
							></div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="mt-3 flex justify-between text-sm">
				<span class="{currentStep === 1 ? 'font-medium text-orange-600' : 'text-gray-500'}"
					>Información Básica</span
				>
				<span class="{currentStep === 2 ? 'font-medium text-orange-600' : 'text-gray-500'}"
					>Detalles Vehículos</span
				>
				<span class="{currentStep === 3 ? 'font-medium text-orange-600' : 'text-gray-500'}"
					>Cálculos Finales</span
				>
			</div>
		</div>

		<!-- Contenido del paso -->
		<div class="rounded-xl bg-white p-8 shadow-lg">
			{#if currentStep === 1}
				<!-- PASO 1: Información Básica -->
				<div class="space-y-6">
					<div class="mb-6 flex items-center gap-3">
						<div class="rounded-lg bg-orange-100 p-2">
							<Users class="h-6 w-6 text-orange-600" />
						</div>
						<h2 class="text-2xl font-bold text-gray-900">Información Básica</h2>
					</div>

					<!-- Conductor -->
					<div>
						<label class="mb-2 block text-sm font-medium text-gray-700">
							Conductor <span class="text-red-500">*</span>
						</label>
						<Select
							items={conductoresOptions}
							bind:value={conductorSelected}
							placeholder="Buscar conductor..."
							searchable={true}
							clearable={false}
							--border-radius="0.5rem"
							--border="1px solid #E5E7EB"
							--border-focused="1px solid #10b981"
							--border-hover="1px solid #D1D5DB"
							--padding="0.75rem 1rem"
							--height="42px"
						/>
					</div>

					<!-- Fechas -->
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label class="mb-2 block text-sm font-medium text-gray-700">
								Fecha Inicio <span class="text-red-500">*</span>
							</label>
							<div class="relative">
								<Calendar class="pointer-events-none absolute left-3 top-3 h-5 w-5 text-gray-400" />
								<input
									type="date"
									bind:value={periodo_inicio}
									required
									class="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
								/>
							</div>
						</div>
						<div>
							<label class="mb-2 block text-sm font-medium text-gray-700">
								Fecha Fin <span class="text-red-500">*</span>
							</label>
							<div class="relative">
								<Calendar class="pointer-events-none absolute left-3 top-3 h-5 w-5 text-gray-400" />
								<input
									type="date"
									bind:value={periodo_fin}
									required
									class="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
								/>
							</div>
						</div>
					</div>

					<!-- Vehículos -->
					<div>
						<label class="mb-2 block text-sm font-medium text-gray-700">
							Vehículos <span class="text-red-500">*</span>
						</label>
						<Select
							items={vehiculosOptions}
							bind:value={vehiculosSelected}
							multiple={true}
							placeholder="Buscar vehículos..."
							searchable={true}
							clearable={true}
							--border-radius="0.5rem"
							--border="1px solid #E5E7EB"
							--border-focused="1px solid #10b981"
							--border-hover="1px solid #D1D5DB"
							--padding="0.75rem 1rem"
							--multi-item-bg="#ecfdf5"
							--multi-item-color="#065f46"
							--multi-item-clear-icon-color="#065f46"
						/>
						<p class="mt-1 text-sm text-gray-500">Seleccione uno o más vehículos</p>
					</div>

					<!-- Días laborados -->
					<div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
						<h3 class="mb-4 font-semibold text-gray-900">Días Laborados</h3>
						<div class="grid grid-cols-3 gap-4">
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">Días Totales</label>
								<input
									type="number"
									bind:value={dias_laborados}
									min="0"
									max="31"
									class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
								/>
							</div>
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">Días Villanueva</label>
								<input
									type="number"
									bind:value={dias_laborados_villanueva}
									min="0"
									max="31"
									class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
								/>
							</div>
							<div>
								<label class="mb-2 block text-sm font-medium text-gray-700">Días Anuales</label>
								<input
									type="number"
									bind:value={dias_laborados_anual}
									min="0"
									max="365"
									class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
								/>
							</div>
						</div>
					</div>
				</div>
			{:else if currentStep === 2}
				<!-- PASO 2: Detalles por Vehículo -->
				<div class="space-y-6">
					<div class="mb-6 flex items-center gap-3">
						<div class="rounded-lg bg-blue-100 p-2">
							<Truck class="h-6 w-6 text-blue-600" />
						</div>
						<h2 class="text-2xl font-bold text-gray-900">Detalles por Vehículo</h2>
					</div>

					{#if detallesVehiculos.length === 0}
						<div class="rounded-lg bg-yellow-50 p-6 text-center">
							<p class="text-yellow-800">
								Seleccione vehículos en el paso 1 para continuar
							</p>
						</div>
					{:else}
						{#each detallesVehiculos as detalle, idx (detalle.vehiculo.value)}
							<div class="rounded-lg border border-gray-200 bg-white p-6">
								<div class="mb-4 flex items-center gap-3 border-b border-gray-200 pb-4">
									<Truck class="h-6 w-6 text-gray-600" />
									<h3 class="text-xl font-bold text-gray-900">{detalle.vehiculo.label}</h3>
								</div>

								<!-- Bonificaciones -->
								{#if detalle.bonos.length > 0}
									<div class="mb-6">
										<h4 class="mb-3 font-semibold text-gray-800">Bonificaciones</h4>
										<div class="space-y-4">
											{#each detalle.bonos as bono}
												<div class="rounded-lg bg-orange-50 p-4">
													<div class="mb-2 flex items-center justify-between">
														<span class="font-medium text-orange-900">{bono.name}</span>
														<span class="text-sm text-orange-700">{formatCurrency(bono.value)} / unidad</span>
													</div>
													<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
														{#each bono.values as val}
															<div>
																<label class="mb-1 block text-xs text-gray-600">{formatMes(val.mes)}</label>
																<input
																	type="number"
																	value={val.quantity}
																	on:input={(e) =>
																		handleBonoChange(
																			detalle.vehiculo.value,
																			bono.name,
																			val.mes,
																			parseInt(e.currentTarget.value) || 0
																		)}
																	min="0"
																	class="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
																/>
															</div>
														{/each}
													</div>
												</div>
											{/each}
										</div>
									</div>
								{/if}

								<!-- Mantenimientos -->
								{#if detalle.mantenimientos.length > 0}
									<div class="mb-6">
										<h4 class="mb-3 font-semibold text-gray-800">Mantenimientos</h4>
										{#each detalle.mantenimientos as mant}
											<div class="rounded-lg bg-orange-50 p-4">
												<div class="mb-2 text-sm text-orange-700">
													{formatCurrency(mant.value)} / unidad
												</div>
												<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
													{#each mant.values as val}
														<div>
															<label class="mb-1 block text-xs text-gray-600">{formatMes(val.mes)}</label>
															<input
																type="number"
																value={val.quantity}
																on:input={(e) =>
																	handleMantenimientoChange(
																		detalle.vehiculo.value,
																		val.mes,
																		parseInt(e.currentTarget.value) || 0
																	)}
																min="0"
																class="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
															/>
														</div>
													{/each}
												</div>
											</div>
										{/each}
									</div>
								{/if}

								<!-- Pernotes -->
								<div class="mb-6">
									<div class="mb-3 flex items-center justify-between">
										<h4 class="font-semibold text-gray-800">Pernotes</h4>
										<button
											on:click={() => handleAddPernote(detalle.vehiculo.value)}
											class="flex items-center gap-1 rounded-lg bg-blue-100 px-3 py-1 text-sm text-blue-700 hover:bg-blue-200"
										>
											<Plus class="h-4 w-4" />
											Agregar
										</button>
									</div>
									{#if detalle.pernotes.length > 0}
										<div class="space-y-3">
											{#each detalle.pernotes as pernote, pIdx}
												<div class="rounded-lg border border-blue-200 bg-blue-50 p-4">
													<div class="mb-3 flex items-center justify-between">
														<span class="text-sm font-medium text-blue-900">Pernote #{pIdx + 1}</span>
														<button
															on:click={() => handleRemovePernote(detalle.vehiculo.value, pIdx)}
															class="text-red-600 hover:text-red-800"
														>
															<Trash2 class="h-4 w-4" />
														</button>
													</div>
													<div class="mb-3">
														<label class="mb-1 block text-xs text-gray-700">Empresa</label>
														<Select
															items={empresasOptions}
															value={empresasOptions.find(e => e.value === pernote.empresa_id)}
															on:change={(e) =>
																handlePernoteChange(detalle.vehiculo.value, pIdx, 'empresa_id', e.detail?.value || '')}
															placeholder="Seleccionar..."
															searchable={true}
															--border-radius="0.375rem"
															--font-size="0.875rem"
															--height="36px"
														/>
													</div>
													<!-- Calendario de pernotes -->
													<CalendarPernote
														periodoInicio={periodo_inicio}
														periodoFin={periodo_fin}
														fechasSeleccionadas={pernote.fechas}
														on:change={(e) => {
															const nuevasFechas = e.detail;
															handlePernoteChange(detalle.vehiculo.value, pIdx, 'fechas', nuevasFechas);
															handlePernoteChange(detalle.vehiculo.value, pIdx, 'cantidad', nuevasFechas.length);
														}}
													/>
													<div class="mt-2 flex items-center justify-between text-sm">
														<span class="text-gray-600">
															{pernote.cantidad} día{pernote.cantidad !== 1 ? 's' : ''} × {formatCurrency(pernote.valor)}
														</span>
														<span class="font-semibold text-blue-700">
															{formatCurrency(pernote.cantidad * pernote.valor)}
														</span>
													</div>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-sm text-gray-500">No hay pernotes agregados</p>
									{/if}
								</div>

								<!-- Recargos -->
								<div>
									<div class="mb-3 flex items-center justify-between">
										<h4 class="font-semibold text-gray-800">Recargos</h4>
										<button
											on:click={() => handleAddRecargo(detalle.vehiculo.value)}
											class="flex items-center gap-1 rounded-lg bg-purple-100 px-3 py-1 text-sm text-purple-700 hover:bg-purple-200"
										>
											<Plus class="h-4 w-4" />
											Agregar
										</button>
									</div>
									{#if detalle.recargos.length > 0}
										<div class="space-y-3">
											{#each detalle.recargos as recargo, rIdx}
												<div class="rounded-lg border border-purple-200 bg-purple-50 p-4">
													<div class="mb-3 flex items-center justify-between">
														<span class="text-sm font-medium text-purple-900">Recargo #{rIdx + 1}</span>
														<button
															on:click={() => handleRemoveRecargo(detalle.vehiculo.value, rIdx)}
															class="text-red-600 hover:text-red-800"
														>
															<Trash2 class="h-4 w-4" />
														</button>
													</div>
													<div class="grid grid-cols-3 gap-3">
														<div>
															<label class="mb-1 block text-xs text-gray-700">Empresa</label>
															<Select
																items={empresasOptions}
																value={empresasOptions.find(e => e.value === recargo.empresa_id)}
																on:change={(e) =>
																	handleRecargoChange(detalle.vehiculo.value, rIdx, 'empresa_id', e.detail?.value || '')}
																placeholder="Seleccionar..."
																searchable={true}
																--border-radius="0.375rem"
																--font-size="0.875rem"
																--height="36px"
															/>
														</div>
														<div>
															<label class="mb-1 block text-xs text-gray-700">Mes</label>
															<select
																value={recargo.mes}
																on:change={(e) =>
																	handleRecargoChange(detalle.vehiculo.value, rIdx, 'mes', e.currentTarget.value)}
																class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
															>
																{#each mesesRange as mes}
																	<option value={mes}>{formatMes(mes)}</option>
																{/each}
															</select>
														</div>
														<div>
															<label class="mb-1 block text-xs text-gray-700">Valor</label>
															<input
																type="text"
																inputmode="numeric"
																value={recargo.valor ? '$ ' + formatCOPInput(recargo.valor) : ''}
																on:focus={handleCOPFocus}
																on:blur={handleCOPBlur}
																on:input={(e) =>
																	handleRecargoChange(
																		detalle.vehiculo.value,
																		rIdx,
																		'valor',
																		parseCOPInput(e.currentTarget.value)
																	)}
																class="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
															/>
														</div>
													</div>
													<div class="mt-2">
														<label class="flex items-center text-xs text-gray-700">
															<input
																type="checkbox"
																checked={recargo.pag_cliente}
																on:change={(e) =>
																	handleRecargoChange(
																		detalle.vehiculo.value,
																		rIdx,
																		'pag_cliente',
																		e.currentTarget.checked
																	)}
																class="mr-2 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
															/>
															Pagado por cliente
														</label>
													</div>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-sm text-gray-500">No hay recargos agregados</p>
									{/if}
								</div>
							</div>
						{/each}
					{/if}
				</div>
			{:else if currentStep === 3}
				<!-- PASO 3: Cálculos Finales -->
				<div class="space-y-6">
					<div class="mb-6 flex items-center gap-3">
						<div class="rounded-lg bg-purple-100 p-2">
							<Calculator class="h-6 w-6 text-purple-600" />
						</div>
						<h2 class="text-2xl font-bold text-gray-900">Cálculos y Ajustes</h2>
					</div>

					<!-- Opciones booleanas -->
					<div class="rounded-lg bg-gray-50 p-6">
						<h3 class="mb-4 text-lg font-semibold text-gray-900">Opciones de Liquidación</h3>
						<div class="grid grid-cols-2 gap-4 lg:grid-cols-3">
							<label class="flex cursor-pointer items-center space-x-3">
								<input
									type="checkbox"
									bind:checked={isCheckedAjuste}
									class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								<span class="text-sm font-medium text-gray-700">Ajuste Villanueva</span>
							</label>

							{#if isCheckedAjuste}
								<label class="flex cursor-pointer items-center space-x-3">
									<input
										type="checkbox"
										bind:checked={isAjustePorDia}
										class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
									/>
									<span class="text-sm font-medium text-gray-700">Ajuste por Día</span>
								</label>
							{/if}

							<label class="flex cursor-pointer items-center space-x-3">
								<input
									type="checkbox"
									bind:checked={isAjusteParex}
									class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								<span class="text-sm font-medium text-gray-700">Ajuste PAREX</span>
							</label>

							<label class="flex cursor-pointer items-center space-x-3">
								<input
									type="checkbox"
									bind:checked={isVacaciones}
									class="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
								/>
								<span class="text-sm font-medium text-gray-700">Tiene Vacaciones</span>
							</label>

							<label class="flex cursor-pointer items-center space-x-3">
								<input
									type="checkbox"
									bind:checked={isIncapacidad}
									class="h-5 w-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
								/>
								<span class="text-sm font-medium text-gray-700">Tiene Incapacidad</span>
							</label>

							<label class="flex cursor-pointer items-center space-x-3">
								<input
									type="checkbox"
									bind:checked={isCesantias}
									class="h-5 w-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
								/>
								<span class="text-sm font-medium text-gray-700">Pagar Cesantías</span>
							</label>

							<label class="flex cursor-pointer items-center space-x-3">
								<input
									type="checkbox"
									bind:checked={isPrima}
									class="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
								/>
								<span class="text-sm font-medium text-gray-700">Pagar Prima</span>
							</label>

							<label class="flex cursor-pointer items-center space-x-3">
								<input
									type="checkbox"
									bind:checked={noDescontarSalud}
									class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								<span class="text-sm font-medium text-gray-700">No Descontar Salud</span>
							</label>

							<label class="flex cursor-pointer items-center space-x-3">
								<input
									type="checkbox"
									bind:checked={noDescontarPension}
									class="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								<span class="text-sm font-medium text-gray-700">No Descontar Pensión</span>
							</label>

							<label class="flex cursor-pointer items-center space-x-3">
								<input
									type="checkbox"
									bind:checked={descontarTransporte}
									class="h-5 w-5 rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
								/>
								<span class="text-sm font-medium text-gray-700">Descontar Transporte</span>
							</label>
						</div>
					</div>

					<!-- Períodos especiales -->
					{#if isVacaciones}
						<div class="rounded-lg border border-blue-200 bg-blue-50 p-4">
							<h4 class="mb-3 font-semibold text-blue-900">Período de Vacaciones</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label class="mb-1 block text-sm text-blue-800">Fecha Inicio</label>
									<input
										type="date"
										bind:value={periodo_vacaciones_inicio}
										class="w-full rounded border border-blue-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
									/>
								</div>
								<div>
									<label class="mb-1 block text-sm text-blue-800">Fecha Fin</label>
									<input
										type="date"
										bind:value={periodo_vacaciones_fin}
										class="w-full rounded border border-blue-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
									/>
								</div>
							</div>
						</div>
					{/if}

					{#if isIncapacidad}
						<div class="rounded-lg border border-red-200 bg-red-50 p-4">
							<h4 class="mb-3 font-semibold text-red-900">Período de Incapacidad</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label class="mb-1 block text-sm text-red-800">Fecha Inicio</label>
									<input
										type="date"
										bind:value={periodo_incapacidad_inicio}
										class="w-full rounded border border-red-300 px-3 py-2 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
									/>
								</div>
								<div>
									<label class="mb-1 block text-sm text-red-800">Fecha Fin</label>
									<input
										type="date"
										bind:value={periodo_incapacidad_fin}
										class="w-full rounded border border-red-300 px-3 py-2 focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Cesantías -->
					{#if isCesantias}
						<div class="rounded-lg border border-purple-200 bg-purple-50 p-4">
							<h4 class="mb-3 font-semibold text-purple-900">Cesantías e Intereses</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label class="mb-1 block text-sm text-purple-800">Cesantías</label>
									<input
										type="text"
										inputmode="numeric"
										value={cesantias ? '$ ' + formatCOPInput(cesantias) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) => cesantias = parseCOPInput(e.currentTarget.value)}
										class="w-full rounded border border-purple-300 px-3 py-2 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
									/>
								</div>
								<div>
									<label class="mb-1 block text-sm text-purple-800">Interés Cesantías</label>
									<input
										type="text"
										inputmode="numeric"
										value={interes_cesantias ? '$ ' + formatCOPInput(interes_cesantias) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) => interes_cesantias = parseCOPInput(e.currentTarget.value)}
										class="w-full rounded border border-purple-300 px-3 py-2 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Prima -->
					{#if isPrima}
						<div class="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
							<h4 class="mb-3 font-semibold text-indigo-900">Prima de Servicios</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label class="mb-1 block text-sm text-indigo-800">Prima</label>
									<input
										type="text"
										inputmode="numeric"
										value={prima ? '$ ' + formatCOPInput(prima) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) => prima = parseCOPInput(e.currentTarget.value)}
										class="w-full rounded border border-indigo-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
									/>
								</div>
								<div>
									<label class="mb-1 block text-sm text-indigo-800">Prima Pendiente (opcional)</label>
									<input
										type="text"
										inputmode="numeric"
										value={prima_pendiente ? '$ ' + formatCOPInput(prima_pendiente) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) => prima_pendiente = parseCOPInput(e.currentTarget.value) || null}
										class="w-full rounded border border-indigo-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Anticipos -->
					<div class="rounded-lg border border-gray-200 bg-white p-6">
						<div class="mb-4 flex items-center justify-between">
							<h3 class="text-lg font-semibold text-gray-900">Anticipos</h3>
							<button
								on:click={() => (showAnticipoForm = !showAnticipoForm)}
								class="flex items-center gap-2 rounded-lg bg-orange-100 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-200"
							>
								<Plus class="h-4 w-4" />
								Agregar Anticipo
							</button>
						</div>

						{#if showAnticipoForm}
							<div class="mb-4 rounded-lg bg-gray-50 p-4">
								<div class="grid grid-cols-3 gap-4">
									<div>
										<label class="mb-2 block text-sm font-medium text-gray-700">Valor</label>
										<input
											type="text"
											inputmode="numeric"
											value={nuevoAnticipo.valor ? '$ ' + formatCOPInput(Number(nuevoAnticipo.valor)) : ''}
											on:focus={handleCOPFocus}
											on:blur={handleCOPBlur}
											on:input={(e) => nuevoAnticipo.valor = String(parseCOPInput(e.currentTarget.value))}
											class="w-full rounded border border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
										/>
									</div>
									<div>
										<label class="mb-2 block text-sm font-medium text-gray-700">Fecha</label>
										<input
											type="date"
											bind:value={nuevoAnticipo.fecha}
											class="w-full rounded border border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
										/>
									</div>
									<div>
										<label class="mb-2 block text-sm font-medium text-gray-700">Concepto</label>
										<input
											type="text"
											bind:value={nuevoAnticipo.concepto}
											placeholder="Opcional"
											class="w-full rounded border border-gray-300 px-3 py-2 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
										/>
									</div>
								</div>
								<div class="mt-4 flex gap-2">
									<button
										on:click={agregarAnticipo}
										class="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
									>
										Agregar
									</button>
									<button
										on:click={() => (showAnticipoForm = false)}
										class="rounded-lg bg-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-400"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if anticipos.length > 0}
							<div class="space-y-2">
								{#each anticipos as anticipo (anticipo.id)}
									<div class="flex items-center justify-between rounded-lg bg-gray-50 p-3">
										<div>
											<p class="font-medium text-gray-900">{formatCurrency(anticipo.valor)}</p>
											<p class="text-sm text-gray-600">
												{new Date(anticipo.fecha + (anticipo.fecha?.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('es-CO')}
												{#if anticipo.concepto}
													- {anticipo.concepto}
												{/if}
											</p>
										</div>
										<button
											on:click={() => eliminarAnticipo(anticipo.id)}
											class="text-red-600 hover:text-red-800"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-gray-500">No hay anticipos registrados</p>
						{/if}
					</div>

					<!-- Conceptos adicionales (ajustes) -->
					<div class="rounded-lg border border-gray-200 bg-white p-6">
						<div class="mb-4 flex items-center justify-between">
							<h3 class="text-lg font-semibold text-gray-900">Conceptos Adicionales</h3>
							<button
								on:click={() => (showConceptoForm = !showConceptoForm)}
								class="flex items-center gap-2 rounded-lg bg-blue-100 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-200"
							>
								<Plus class="h-4 w-4" />
								Agregar Concepto
							</button>
						</div>

						{#if showConceptoForm}
							<div class="mb-4 rounded-lg bg-gray-50 p-4">
								<div class="grid grid-cols-2 gap-4">
									<div>
										<label class="mb-2 block text-sm font-medium text-gray-700">Valor</label>
										<input
											type="text"
											inputmode="numeric"
											value={nuevoConcepto.valor ? '$ ' + formatCOPInput(Number(nuevoConcepto.valor)) : ''}
											on:focus={handleCOPFocus}
											on:blur={handleCOPBlur}
											on:input={(e) => nuevoConcepto.valor = String(parseCOPInput(e.currentTarget.value))}
											placeholder="Positivo = Devengo, Negativo = Deducción"
											class="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
										/>
									</div>
									<div>
										<label class="mb-2 block text-sm font-medium text-gray-700">Observaciones</label>
										<input
											type="text"
											bind:value={nuevoConcepto.observaciones}
											placeholder="Descripción del concepto"
											class="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
										/>
									</div>
								</div>
								<div class="mt-4 flex gap-2">
									<button
										on:click={agregarConcepto}
										class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
									>
										Agregar
									</button>
									<button
										on:click={() => (showConceptoForm = false)}
										class="rounded-lg bg-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-400"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if conceptos_adicionales.length > 0}
							<div class="space-y-2">
								{#each conceptos_adicionales as concepto, idx}
									<div class="flex items-center justify-between rounded-lg bg-gray-50 p-3">
										<div>
											<p class="font-medium {concepto.valor > 0 ? 'text-green-700' : 'text-red-700'}">
												{formatCurrency(concepto.valor)}
											</p>
											<p class="text-sm text-gray-600">{concepto.observaciones}</p>
										</div>
										<button
											on:click={() => eliminarConcepto(idx)}
											class="text-red-600 hover:text-red-800"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-gray-500">No hay conceptos adicionales</p>
						{/if}
					</div>

					<!-- Resumen de totales -->
					<div class="rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 p-6">
						<div class="mb-4 flex items-center gap-3">
							<DollarSign class="h-6 w-6 text-orange-600" />
							<h3 class="text-xl font-bold text-gray-900">Resumen de Liquidación</h3>
						</div>
						
						<div class="grid grid-cols-2 gap-4 lg:grid-cols-3">
							<div class="rounded-lg bg-white p-4">
								<p class="text-sm text-gray-600">Salario Devengado</p>
								<p class="text-lg font-bold text-gray-900">{formatCurrency(totales.salarioDevengado)}</p>
							</div>
							<div class="rounded-lg bg-white p-4">
								<p class="text-sm text-gray-600">Bonificaciones</p>
								<p class="text-lg font-bold text-orange-600">{formatCurrency(totales.totalBonificaciones)}</p>
							</div>
							<div class="rounded-lg bg-white p-4">
								<p class="text-sm text-gray-600">Pernotes</p>
								<p class="text-lg font-bold text-blue-600">{formatCurrency(totales.totalPernotes)}</p>
							</div>
							<div class="rounded-lg bg-white p-4">
								<p class="text-sm text-gray-600">Recargos</p>
								<p class="text-lg font-bold text-purple-600">{formatCurrency(totales.totalRecargos)}</p>
							</div>
							<div class="rounded-lg bg-white p-4">
								<p class="text-sm text-gray-600">Salud</p>
								<p class="text-lg font-bold text-red-600">-{formatCurrency(totales.salud + totales.saludVacaciones)}</p>
							</div>
							<div class="rounded-lg bg-white p-4">
								<p class="text-sm text-gray-600">Pensión</p>
								<p class="text-lg font-bold text-red-600">-{formatCurrency(totales.pension + totales.pensionVacaciones)}</p>
							</div>
							<div class="rounded-lg bg-white p-4">
								<p class="text-sm text-gray-600">Anticipos</p>
								<p class="text-lg font-bold text-red-600">-{formatCurrency(totales.totalAnticipos)}</p>
							</div>
							<div class="col-span-2 rounded-lg bg-orange-600 p-4">
								<p class="text-sm text-orange-100">Sueldo Total a Pagar</p>
								<p class="text-2xl font-bold text-white">{formatCurrency(totales.sueldoTotal)}</p>
							</div>
						</div>
					</div>
				</div>
			{/if}

			<!-- Botones de navegación -->
			<div class="mt-8 flex items-center justify-between border-t border-gray-200 pt-6">
				<button
					on:click={prevStep}
					disabled={currentStep === 1}
					class="flex items-center gap-2 rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<ChevronLeft class="h-5 w-5" />
					Anterior
				</button>

				{#if currentStep === totalSteps}
					<button
						on:click={handleSubmit}
						disabled={loading}
						class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-600 px-6 py-3 font-semibold text-white shadow-lg hover:shadow-xl disabled:opacity-50"
					>
						{#if loading}
							<div
								class="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
							></div>
							Guardando...
						{:else}
							<Save class="h-5 w-5" />
							Guardar Liquidación
						{/if}
					</button>
				{:else}
					<button
						on:click={nextStep}
						class="flex items-center gap-2 rounded-lg bg-orange-600 px-6 py-3 font-semibold text-white hover:bg-orange-700"
					>
						Siguiente
						<ChevronRight class="h-5 w-5" />
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
