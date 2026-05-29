<script lang="ts">
	import { onMount } from 'svelte';
	import Select from 'svelte-select';
	import {
		obtenerConductores,
		obtenerVehiculos,
		obtenerEmpresas,
		obtenerConfiguraciones
	} from '$lib/api/nomina';
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
	import RecargosPreview from './RecargosPreview.svelte';

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
	let recargosManualesInicializados = false;

	// Estado del formulario
	let currentStep = 1;
	const totalSteps = 3;

	// PASO 1: Datos básicos
	let conductorSelected: { value: string; label: string; salario_base?: number } | null = null;
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
	let isAjusteParexRecargosCompletos = false;
	let diasAjusteDeducciones: number | null = null;
	let isVacaciones = false;
	let isIncapacidad = false;
	let isCesantias = false;
	let isPrima = false;
	let noDescontarSalud = false;
	let noDescontarPension = false;
	let descontarSaludSalario = false;
	let descontarPensionSalario = false;
	let descontarTransporte = false;
	let redondearNetoArriba = false;
	let descontarPesos = false;
	let pesosDescontar = 0;
	let estadoLiquidacion: 'Pendiente' | 'Liquidado' = 'Pendiente';

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
	let disponibilidad = 0;

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
			porcentaje_propietario?: number;
			emisor?: string;
			mes: string;
		}>;
	}

	let detallesVehiculos: VehiculoDetalle[] = [];
	let mesesRange: string[] = [];

	// Preview de recargos
	let recargosPreviewRef: RecargosPreview;
	let totalRecargosPreview = 0;
	let previewRecargosData: any = null;
	let previewRecargosGrupos: Array<{
		key: string;
		vehiculo_id: string;
		vehiculo_placa: string;
		empresa_id: string;
		empresa_nombre: string;
		mes: string;
		valor: number;
		pag_cliente: boolean;
		porcentaje_propietario: number;
		incluir?: boolean;
	}> = [];
	/** Overrides for pagCliente/porcentajePropietario per grupo key — survives step navigation */
	let cachedGrupoOverrides: Record<string, { pagCliente: boolean; porcentajePropietario: number; incluir?: boolean }> =
		{};

	// Anticipos
	let anticipos: Array<{ id: string; valor: number; fecha: string; concepto: string }> = [];
	let showAnticipoForm = false;
	let nuevoAnticipo = { valor: '', fecha: '', concepto: '' };

	// Conceptos adicionales (ajustes)
	let conceptos_adicionales: Array<{ valor: number; observaciones: string }> = [];
	let showConceptoForm = false;
	let nuevoConcepto = { valor: '', observaciones: '' };

	// Options para selects
	$: conductoresOptions = [...conductores]
		.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
		.map((c) => ({
			value: c.id,
			label: `${c.nombre} ${c.apellido || ''}`.trim(),
			salario_base: Number(c.salario_base) || 0
		}));

	$: vehiculosOptions = vehiculos
		.sort((a, b) => a.placa.localeCompare(b.placa))
		.map((v) => ({
			value: v.id,
			label: v.placa
		}));

	$: empresasOptions = empresas.map((e) => ({
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
			const [conductoresRes, vehiculosRes, empresasRes] = await Promise.all([
				obtenerConductores(),
				obtenerVehiculos(),
				obtenerEmpresas()
			]);

			conductores = conductoresRes.data || [];
			vehiculos = vehiculosRes.data || [];
			empresas = empresasRes.data || [];
		} catch (error) {
			console.error('Error cargando datos:', error);
			toast.error('Error al cargar los datos del formulario');
		} finally {
			loadingData = false;
		}
	}

	// Cargar configuraciones basadas en el año del período
	async function cargarConfiguracionesPorPeriodo() {
		if (!periodo_inicio) return;
		try {
			const anio = new Date(periodo_inicio).getFullYear();
			const configRes = await obtenerConfiguraciones(anio);
			if (configRes.data) {
				configuracion = Array.isArray(configRes.data) ? configRes.data : [configRes.data];
			}
		} catch (error) {
			console.error('Error cargando configuraciones:', error);
		}
	}

	function cargarDatosIniciales() {
		if (!initialData) return;

		// Cargar conductor
		conductorSelected =
			conductoresOptions.find((c) => c.value === initialData.conductor_id) || null;

		// Cargar vehículos
		vehiculosSelected = vehiculosOptions.filter((v) =>
			initialData.vehiculos?.some((vh: any) => vh.id === v.value)
		);

		// Cargar fechas
		periodo_inicio =
			initialData.periodo_inicio?.split('T')[0] || initialData.periodo_start?.split('T')[0] || '';
		periodo_fin =
			initialData.periodo_fin?.split('T')[0] || initialData.periodo_end?.split('T')[0] || '';

		// Cargar días
		dias_laborados = initialData.dias_laborados || 0;
		dias_laborados_villanueva = initialData.dias_laborados_villanueva || 0;
		dias_laborados_anual = initialData.dias_laborados_anual || 0;

		// Cargar checkboxes
		isCheckedAjuste =
			(initialData.ajuste_salarial ?? 0) > 0 || (initialData.dias_laborados_villanueva ?? 0) > 0;
		isAjustePorDia = !!initialData.ajuste_salarial_por_dia;
		isAjusteParex = (initialData.ajuste_parex ?? 0) > 0;
		isAjusteParexRecargosCompletos = !!initialData.ajuste_parex_recargos_completos;
		diasAjusteDeducciones = initialData.dias_ajuste_deducciones ?? null;
		noDescontarSalud = (initialData.salud ?? 0) === 0;
		noDescontarPension = (initialData.pension ?? 0) === 0;
		descontarTransporte = initialData.auxilio_transporte === 0;
		isCesantias = (initialData.cesantias ?? 0) > 0 || (initialData.interes_cesantias ?? 0) > 0;
		isPrima = (initialData.prima ?? 0) > 0;
		isVacaciones = !!initialData.periodo_start_vacaciones;
		isIncapacidad = !!initialData.periodo_start_incapacidad;
		estadoLiquidacion = initialData.estado === 'Liquidado' ? 'Liquidado' : 'Pendiente';

		// Cargar valores financieros
		cesantias = initialData.cesantias || 0;
		interes_cesantias = initialData.interes_cesantias || 0;
		prima = initialData.prima || 0;
		prima_pendiente = initialData.prima_pendiente || null;
		disponibilidad = initialData.disponibilidad || 0;

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

		// Los recargos manuales se cargarán en la primera ejecución de inicializarDetallesVehiculos
		// No reseteamos recargosManualesInicializados para evitar sobrescribir cambios del usuario
	}

	// Poblar detallesVehiculos con los datos existentes de la liquidación (bonos, recargos, pernotes, mantenimientos)
	function cargarDetallesVehiculosDesdeData() {
		if (!initialData || recargosManualesInicializados) return;
		recargosManualesInicializados = true;

		const bonificacionesData = initialData.bonificaciones || [];
		const recargosData = initialData.recargos || [];
		const pernotesData = initialData.pernotes || [];
		const mantenimientosData = initialData.mantenimientos || [];

		detallesVehiculos = detallesVehiculos.map((detalle) => {
			const vehiculoId = detalle.vehiculo.value;

			// Cargar bonificaciones existentes para este vehículo
			const bonosVehiculo = bonificacionesData.filter((b: any) => b.vehiculo_id === vehiculoId);
			const bonosActualizados = detalle.bonos.map((bono) => {
				const bonoExistente = bonosVehiculo.find((b: any) => b.name === bono.name);
				if (bonoExistente) {
					// values puede venir como string JSON desde la BD
					const parsedValues =
						typeof bonoExistente.values === 'string'
							? JSON.parse(bonoExistente.values)
							: bonoExistente.values || [];
					return {
						...bono,
						value: Number(bonoExistente.value) || bono.value,
						values: mesesRange.map((mes) => {
							const existing = parsedValues.find((v: any) => v.mes === mes);
							return existing ? { mes, quantity: existing.quantity || 0 } : { mes, quantity: 0 };
						})
					};
				}
				return bono;
			});

			// Cargar mantenimientos existentes para este vehículo
			const mantsVehiculo = mantenimientosData.filter(
				(m: any) => (m.vehiculo_id || m.vehiculoId) === vehiculoId
			);
			const mantenimientosActualizados = detalle.mantenimientos.map((mant) => {
				const mantExistente = mantsVehiculo[0]; // Normalmente solo hay 1 mantenimiento por vehículo
				if (mantExistente) {
					// values puede venir como string JSON desde la BD
					const parsedValues =
						typeof mantExistente.values === 'string'
							? JSON.parse(mantExistente.values)
							: mantExistente.values || [];
					return {
						...mant,
						value: Number(mantExistente.value) || mant.value,
						values: mesesRange.map((mes) => {
							const existing = parsedValues.find((v: any) => v.mes === mes);
							return existing ? { mes, quantity: existing.quantity || 0 } : { mes, quantity: 0 };
						})
					};
				}
				return mant;
			});

			// Cargar pernotes existentes para este vehículo
			const pernotesVehiculo = pernotesData
				.filter((p: any) => p.vehiculo_id === vehiculoId)
				.map((p: any) => {
					// fechas viene como JSON string del backend, parsearlo a array
					let fechas: string[] = [];
					if (Array.isArray(p.fechas)) {
						fechas = p.fechas;
					} else if (typeof p.fechas === 'string') {
						try {
							fechas = JSON.parse(p.fechas);
						} catch {
							fechas = [];
						}
					}
					return {
						vehiculo_id: vehiculoId,
						empresa_id: p.empresa_id || p.clientes?.id || '',
						cantidad: p.cantidad || 0,
						fechas,
						valor: Number(p.valor) || 0
					};
				});

			// Cargar recargos MANUALES existentes para este vehículo (excluir automáticos de planillas)
			const recargosVehiculo = recargosData
				.filter((r: any) => r.vehiculo_id === vehiculoId && !r.es_automatico)
				.map((r: any) => ({
					vehiculo_id: vehiculoId,
					empresa_id: r.empresa_id || r.clientes?.id || '',
					valor: Number(r.valor) || 0,
					pag_cliente: r.pag_cliente || false,
					porcentaje_propietario: Number(r.porcentaje_propietario) || 0,
					emisor: r.emisor || 'COTRANSMEQ',
					mes: r.mes || ''
				}));

			return {
				...detalle,
				bonos: bonosActualizados,
				mantenimientos: mantenimientosActualizados,
				pernotes: pernotesVehiculo.length > 0 ? pernotesVehiculo : detalle.pernotes,
				recargos: recargosVehiculo.length > 0 ? recargosVehiculo : detalle.recargos
			};
		});

		// Restaurar datos de recargos automáticos guardados (para mostrar en resumen antes de que RecargosPreview recalcule)
		const recargosAutomaticosGuardados = recargosData.filter((r: any) => r.es_automatico);
		if (recargosAutomaticosGuardados.length > 0) {
			totalRecargosPreview = recargosAutomaticosGuardados.reduce(
				(sum: number, r: any) => sum + (Number(r.valor) || 0),
				0
			);
			// Restaurar previewRecargosGrupos y cachedGrupoOverrides desde los rows guardados
			previewRecargosGrupos = recargosAutomaticosGuardados.map((r: any) => {
				const empresaNombre =
					empresas.find((e) => e.id === (r.empresa_id || r.clientes?.id))?.nombre ||
					r.clientes?.nombre ||
					'';
				const vehiculoPlaca =
					vehiculosSelected.find((v) => v.value === r.vehiculo_id)?.label ||
					r.vehiculos?.placa ||
					'';
				return {
					key: `${r.vehiculo_id}-${r.mes}-${r.empresa_id}`,
					vehiculo_id: r.vehiculo_id || '',
					vehiculo_placa: vehiculoPlaca,
					empresa_id: r.empresa_id || r.clientes?.id || '',
					empresa_nombre: empresaNombre,
					mes: r.mes || '',
					valor: Number(r.valor) || 0,
					pag_cliente: r.pag_cliente || false,
					porcentaje_propietario: Number(r.porcentaje_propietario) || 0,
					incluir: r.incluir !== false
				};
			});
			// Rebuild overrides cache from saved data
			const overrides: Record<string, { pagCliente: boolean; porcentajePropietario: number; incluir: boolean }> = {};
			for (const g of previewRecargosGrupos) {
				overrides[g.key] = {
					pagCliente: g.pag_cliente,
					porcentajePropietario: g.porcentaje_propietario,
					incluir: g.incluir !== false
				};
			}
			cachedGrupoOverrides = overrides;
		} else if (initialData.total_recargos != null) {
			// Fallback: si no hay es_automatico rows (liquidaciones antiguas), estimar desde total
			const totalRecargosGuardado = Number(initialData.total_recargos) || 0;
			const recargosManualCargados = detallesVehiculos.reduce((acc, detalle) => {
				return acc + detalle.recargos.reduce((total, recargo) => total + recargo.valor, 0);
			}, 0);
			totalRecargosPreview = Math.max(0, totalRecargosGuardado - recargosManualCargados);
		}
	}

	// Actualizar meses cuando cambian las fechas
	$: if (periodo_inicio && periodo_fin) {
		actualizarMeses();
	}

	// Cargar configuraciones cuando se define el periodo de inicio
	$: if (periodo_inicio) {
		cargarConfiguracionesPorPeriodo();
	}

	function actualizarMeses() {
		const inicio = new Date(periodo_inicio + 'T00:00:00');
		const fin = new Date(periodo_fin + 'T00:00:00');
		const meses: string[] = [];

		// Iterar mes a mes desde el mes de inicio hasta el mes de fin
		const current = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
		const mesFinYear = fin.getFullYear();
		const mesFinMonth = fin.getMonth();

		while (
			current.getFullYear() < mesFinYear ||
			(current.getFullYear() === mesFinYear && current.getMonth() <= mesFinMonth)
		) {
			const mesStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
			meses.push(mesStr);
			current.setMonth(current.getMonth() + 1);
		}

		mesesRange = meses;
	}

	// Inicializar detalles de vehículos cuando cambian vehículos, meses o configuración
	$: if (vehiculosSelected.length > 0 && mesesRange.length > 0 && configuracion.length > 0) {
		inicializarDetallesVehiculos();
	}

	function inicializarDetallesVehiculos() {
		const bonosConfiguracion = configuracion.filter((c) =>
			c.nombre?.toLowerCase().includes('bono')
		);

		const valorMantenimiento = Number(
			configuracion.find((c) => c.nombre === 'Mantenimiento')?.valor || 0
		);

		const valorPernote = Number(configuracion.find((c) => c.nombre === 'Pernote')?.valor || 0);

		detallesVehiculos = vehiculosSelected.map((vehiculo) => {
			const detalleExistente = detallesVehiculos.find((d) => d.vehiculo.value === vehiculo.value);

			if (detalleExistente) {
				// Actualizar meses en bonos existentes preservando cantidades
				const bonosActualizados = detalleExistente.bonos.map((bono) => ({
					...bono,
					values: mesesRange.map((mes) => {
						const existing = bono.values.find((v) => v.mes === mes);
						return existing || { mes, quantity: 0 };
					})
				}));

				// Actualizar meses en mantenimientos existentes preservando cantidades
				const mantenimientosActualizados = detalleExistente.mantenimientos.map((mant) => ({
					...mant,
					values: mesesRange.map((mes) => {
						const existing = mant.values.find((v) => v.mes === mes);
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
			const bonos = bonosConfiguracion.map((bono) => ({
				name: bono.nombre,
				value: Number(bono.valor || 0),
				values: mesesRange.map((mes) => ({ mes, quantity: 0 })),
				vehiculo_id: vehiculo.value
			}));

			// Crear mantenimientos para cada mes
			const mantenimientos = [
				{
					values: mesesRange.map((mes) => ({ mes, quantity: 0 })),
					value: valorMantenimiento,
					vehiculo_id: vehiculo.value
				}
			];

			return {
				vehiculo,
				bonos,
				mantenimientos,
				pernotes: [],
				recargos: []
			};
		});

		// En modo edición, poblar con datos existentes después de inicializar
		if (mode === 'edit' && initialData && !recargosManualesInicializados) {
			cargarDetallesVehiculosDesdeData();
		}
	}

	// Manejo de cambios en bonos
	function handleBonoChange(vehiculoId: string, bonoName: string, mes: string, quantity: number) {
		detallesVehiculos = detallesVehiculos.map((detalle) => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				bonos: detalle.bonos.map((bono) => {
					if (bono.name !== bonoName) return bono;

					return {
						...bono,
						values: bono.values.map((val) => (val.mes === mes ? { ...val, quantity } : val))
					};
				})
			};
		});
	}

	// Manejo de cambios en mantenimientos
	function handleMantenimientoChange(vehiculoId: string, mes: string, quantity: number) {
		detallesVehiculos = detallesVehiculos.map((detalle) => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				mantenimientos: detalle.mantenimientos.map((mant) => ({
					...mant,
					values: mant.values.map((val) => (val.mes === mes ? { ...val, quantity } : val))
				}))
			};
		});
	}

	// Agregar pernote
	function handleAddPernote(vehiculoId: string) {
		const valorPernote = Number(configuracion.find((c) => c.nombre === 'Pernote')?.valor || 0);

		detallesVehiculos = detallesVehiculos.map((detalle) => {
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
	function handlePernoteChange(vehiculoId: string, index: number, field: string, value: any) {
		detallesVehiculos = detallesVehiculos.map((detalle) => {
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
		detallesVehiculos = detallesVehiculos.map((detalle) => {
			if (detalle.vehiculo.value !== vehiculoId) return detalle;

			return {
				...detalle,
				pernotes: detalle.pernotes.filter((_, i) => i !== index)
			};
		});
	}

	// Agregar recargo
	function handleAddRecargo(vehiculoId: string) {
		detallesVehiculos = detallesVehiculos.map((detalle) => {
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
						porcentaje_propietario: 0,
						emisor: 'COTRANSMEQ',
						mes: mesesRange[0] || ''
					}
				]
			};
		});
	}

	// Actualizar recargo
	function handleRecargoChange(vehiculoId: string, index: number, field: string, value: any) {
		detallesVehiculos = detallesVehiculos.map((detalle) => {
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
		detallesVehiculos = detallesVehiculos.map((detalle) => {
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
		anticipos = anticipos.filter((a) => a.id !== id);
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
		conductores,
		conductorSelected,
		dias_laborados,
		dias_laborados_villanueva,
		dias_laborados_anual,
		detallesVehiculos,
		anticipos,
		conceptos_adicionales,
		isCheckedAjuste,
		isAjustePorDia,
		isAjusteParex,
		isAjusteParexRecargosCompletos,
		diasAjusteDeducciones,
		isVacaciones,
		isIncapacidad,
		isCesantias,
		isPrima,
		noDescontarSalud,
		noDescontarPension,
		descontarSaludSalario,
		descontarPensionSalario,
		descontarTransporte,
		periodo_vacaciones_inicio,
		periodo_vacaciones_fin,
		periodo_incapacidad_inicio,
		periodo_incapacidad_fin,
		cesantias,
		interes_cesantias,
		prima,
		prima_pendiente,
		configuracion,
		totalRecargosPreview,
		previewRecargosData,
		previewRecargosGrupos,
		disponibilidad
	];
	$: totales = (() => {
		void _deps;
		return calcularTotales();
	})();

	function calcularTotales() {
		const conductor = conductores.find((c) => c.id === conductorSelected?.value);
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
				disponibilidad: 0,
				sueldoBruto: 0,
				salud: 0,
				pension: 0,
				totalAnticipos: 0,
				totalAjustesAdicionales: 0,
				totalDeducciones: 0,
				sueldoTotal: 0
			};
		}

		const salarioBase =
			Number(conductor.salario_base) || Number(conductorSelected?.salario_base) || 0;
		const salarioDevengado = (salarioBase / 30) * dias_laborados;

		const configAuxilioTransporte = Number(
			configuracion.find((c) => c.nombre === 'Auxilio de transporte')?.valor || 0
		);
		const auxilioTransporte = descontarTransporte
			? 0
			: (configAuxilioTransporte / 30) * dias_laborados;

		// Calcular bonificaciones
		const totalBonificaciones = detallesVehiculos.reduce((acc, detalle) => {
			return (
				acc +
				detalle.bonos.reduce((total, bono) => {
					return (
						total +
						bono.values.reduce((sum, val) => {
							return sum + val.quantity * bono.value;
						}, 0)
					);
				}, 0)
			);
		}, 0);

		// Calcular pernotes
		const totalPernotes = detallesVehiculos.reduce((acc, detalle) => {
			return (
				acc +
				detalle.pernotes.reduce((total, pernote) => {
					return total + pernote.cantidad * pernote.valor;
				}, 0)
			);
		}, 0);

		// Calcular recargos (manuales + preview de planillas)
		const recargosManual = detallesVehiculos.reduce((acc, detalle) => {
			return (
				acc +
				detalle.recargos.reduce((total, recargo) => {
					return total + recargo.valor;
				}, 0)
			);
		}, 0);
		const totalRecargos = recargosManual + totalRecargosPreview;

		// Bonificación Ajuste Salarial
		let bonificacionVillanueva = 0;
		if (isCheckedAjuste) {
			const salarioVillanueva = Number(
				configuracion.find((c) => c.nombre === 'Salario villanueva')?.valor || 0
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

			if (isAjusteParexRecargosCompletos) {
				// 8% sobre TODOS los recargos del conductor
				ajusteParexValor = totalRecargos * 0.08;
			} else {
				// 8% solo sobre recargos de PAREX
				const recargosManualParex = detallesVehiculos
					.flatMap((d) => d.recargos)
					.filter((r) => r.empresa_id === PAREX_EMPRESA_ID)
					.reduce((sum, r) => sum + r.valor, 0);

				const recargosPreviewParex = previewRecargosGrupos
					.filter((g: any) => g.empresa_id === PAREX_EMPRESA_ID && g.incluir !== false)
					.reduce((sum: number, g: any) => sum + (g.valor || 0), 0);

				const totalRecargosParex = recargosManualParex + recargosPreviewParex;
				ajusteParexValor = totalRecargosParex * 0.08;
			}
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
			const inicio = new Date(periodo_vacaciones_inicio);
			const fin = new Date(periodo_vacaciones_fin);
			const diasVacaciones =
				Math.ceil((fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
			totalVacaciones = (salarioBase / 30) * diasVacaciones;
		}

		// Ajuste salarial para deducciones: si se especifican días, solo tomar esa fracción
		const ajusteParaDeducciones =
			diasAjusteDeducciones !== null && diasAjusteDeducciones !== undefined
				? (bonificacionVillanueva / 30) * diasAjusteDeducciones
				: bonificacionVillanueva;

		// Base de cálculo para salud y pensión
		// Incluye: salario + vacaciones + ajuste salarial (según días) + recargos PAREX si aplica
		const baseCalculo =  (descontarPensionSalario ? salarioBase : salarioDevengado) + totalVacaciones + ajusteParaDeducciones;

		// Porcentajes de salud y pensión
		const porcentajeSalud =
			Number(configuracion.find((c) => c.nombre === 'Salud')?.valor || 0) / 100;
		const porcentajePension =
			Number(configuracion.find((c) => c.nombre === 'Pensión')?.valor || 0) / 100;

		const ajusteParexPorConcepto = ajusteParexValor * 0.5;

		// Deducciones (unificadas: salud y pensión ya incluyen vacaciones en la base)
		const salud = noDescontarSalud ? 0 : baseCalculo * porcentajeSalud + ajusteParexPorConcepto;
		const pension = noDescontarPension
			? 0
			: baseCalculo * porcentajePension + ajusteParexPorConcepto;

		const totalAnticipos = anticipos.reduce((sum, a) => sum + a.valor, 0);
		const totalAjustesAdicionales = conceptos_adicionales.reduce((sum, c) => sum + c.valor, 0);

		const totalDeducciones = salud + pension + totalAnticipos;

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
			disponibilidad,
			sueldoBruto,
			salud,
			pension,
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
			ajuste_parex_recargos_completos: isAjusteParexRecargosCompletos,
			dias_ajuste_deducciones: diasAjusteDeducciones,
			auxilio_transporte: totales.auxilioTransporte,
			sueldo_total:
				(redondearNetoArriba ? Math.ceil(totales.sueldoTotal) : Math.floor(totales.sueldoTotal)) -
				(descontarPesos ? pesosDescontar : 0),
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
			disponibilidad,
			salud: totales.salud,
			pension: totales.pension,
			cesantias,
			interes_cesantias,
			prima,
			prima_pendiente,
			estado: estadoLiquidacion,
			vehiculos: vehiculosSelected.map((v) => v.value),
			detalles_vehiculos: detallesVehiculos,
			anticipos,
			conceptos_adicionales,
			recargos_preview: previewRecargosGrupos
		};

		await onSubmit(payload);
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.round(amount));
	}

	function formatCurrencyDecimal(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		}).format(amount);
	}

	// Formateo COP para inputs de texto
	function formatCOPInput(value: number): string {
		if (!value && value !== 0) return '';
		return new Intl.NumberFormat('es-CO').format(Math.round(value));
	}

	function parseCOPInput(text: string): number {
		// Remove all non-numeric characters except minus sign
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
		if (!mes) return '-';
		// Formato YYYY-MM
		if (/^\d{4}-\d{2}$/.test(mes)) {
			const [year, month] = mes.split('-');
			const date = new Date(parseInt(year), parseInt(month) - 1);
			return date.toLocaleDateString('es-CO', { month: 'short', year: 'numeric' });
		}
		// Formato nombre de mes (ej: "Diciembre", "Febrero")
		const periodoYear = periodo_inicio
			? periodo_inicio.split('-')[0]
			: (periodo_fin ? periodo_fin.split('-')[0] : String(new Date().getFullYear()));
		return `${mes} ${periodoYear}`;
	}

	function handleRecargosCalculated(event: CustomEvent) {
		const { totalRecargos, detalle, grupos } = event.detail;
		totalRecargosPreview = totalRecargos;
		previewRecargosData = detalle;
		previewRecargosGrupos = grupos || [];
		// Cache per-grupo overrides so they survive step navigation (component re-mount)
		const overrides: Record<string, { pagCliente: boolean; porcentajePropietario: number; incluir?: boolean }> = {};
		for (const g of previewRecargosGrupos) {
			overrides[g.key] = {
				pagCliente: g.pag_cliente,
				porcentajePropietario: g.porcentaje_propietario,
				incluir: g.incluir !== false
			};
		}
		cachedGrupoOverrides = overrides;
	}
</script>

{#if loadingData}
	<div class="flex min-h-[60vh] items-center justify-center">
		<div class="text-center">
			<div
				class="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-orange-600 border-t-transparent"
			></div>
			<p class="mt-3 text-sm text-gray-500">Cargando datos...</p>
		</div>
	</div>
{:else}
	<div class="mx-auto max-w-5xl px-4 py-6">
		<!-- Header -->
		<div class="mb-5 flex items-center justify-between">
			<div class="flex items-center gap-4">
				<button
					on:click={() => window.history.back()}
					class="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
				>
					<ChevronLeft class="h-4 w-4" />
				</button>
				<h1 class="text-xl font-semibold text-gray-900">
					{mode === 'create' ? 'Nueva Liquidación' : 'Editar Liquidación'}
				</h1>
			</div>
			<div class="flex items-center gap-1.5 text-xs text-gray-400">
				{#each ['Info Básica', 'Vehículos', 'Cálculos'] as label, i}
					<button
						on:click={() => {
							if (i + 1 < currentStep) currentStep = i + 1;
						}}
						class="flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition
							{currentStep === i + 1
							? 'bg-orange-600 text-white'
							: currentStep > i + 1
								? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
								: 'bg-gray-100 text-gray-400'}"
					>
						<span class="text-[11px]">{i + 1}</span>
						<span class="hidden sm:inline">{label}</span>
					</button>
					{#if i < 2}
						<div class="h-px w-4 {currentStep > i + 1 ? 'bg-orange-300' : 'bg-gray-200'}"></div>
					{/if}
				{/each}
			</div>
		</div>

		<!-- Contenido del paso -->
		<div class="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
			{#if currentStep === 1}
				<!-- PASO 1: Información Básica -->
				<div class="space-y-5">
					<h2 class="flex items-center gap-2 text-base font-semibold text-gray-800">
						<Users class="h-4 w-4 text-orange-600" />
						Información Básica
					</h2>

					<!-- Conductor -->
					<div>
						<label class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase">
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
							<label class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase">
								Fecha Inicio <span class="text-red-500">*</span>
							</label>
							<input
								type="date"
								bind:value={periodo_inicio}
								required
								class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
							/>
						</div>
						<div>
							<label class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase">
								Fecha Fin <span class="text-red-500">*</span>
							</label>
							<input
								type="date"
								bind:value={periodo_fin}
								required
								class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
							/>
						</div>
					</div>

					<!-- Vehículos -->
					<div>
						<label class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase">
							Vehículos
						</label>
						<Select
							items={vehiculosOptions}
							bind:value={vehiculosSelected}
							multiple={true}
							placeholder="Buscar vehículos..."
							searchable={true}
							clearable={true}
							--border-radius="0.375rem"
							--border="1px solid #E5E7EB"
							--border-focused="1px solid #10b981"
							--border-hover="1px solid #D1D5DB"
							--padding="0.5rem 0.75rem"
							--multi-item-bg="#f3f4f6"
							--multi-item-color="#374151"
							--multi-item-clear-icon-color="#6b7280"
						/>
						<p class="mt-1 text-xs text-gray-400">Opcional — para bonificaciones o recargos</p>
					</div>

					<!-- Días laborados -->
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
								>Días Totales</label
							>
							<input
								type="number"
								bind:value={dias_laborados}
								min="0"
								max="31"
								class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
							/>
						</div>
						<div>
							<label class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
								>Días Ajuste Salarial</label
							>
							<input
								type="number"
								bind:value={dias_laborados_villanueva}
								min="0"
								max="31"
								class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
							/>
						</div>
					</div>
				</div>
			{:else if currentStep === 2}
				<!-- PASO 2: Detalles por Vehículo -->
				<div class="space-y-5">
					<h2 class="flex items-center gap-2 text-base font-semibold text-gray-800">
						<Truck class="h-4 w-4 text-orange-600" />
						Detalles por Vehículo
					</h2>

					{#if detallesVehiculos.length === 0}
						<div class="rounded-md border border-dashed border-gray-300 py-10 text-center">
							<p class="text-sm text-gray-400">
								Sin vehículos seleccionados. Agregue vehículos en el paso 1 si aplica.
							</p>
						</div>
					{:else}
						{#each detallesVehiculos as detalle, idx (detalle.vehiculo.value)}
							<div class="rounded-md border border-gray-200">
								<div class="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
									<Truck class="h-4 w-4 text-gray-500" />
									<h3 class="text-sm font-semibold text-gray-800">{detalle.vehiculo.label}</h3>
								</div>
								<div class="space-y-4 p-4">
									<!-- Bonificaciones -->
									{#if detalle.bonos.length > 0}
										<div>
											<h4 class="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
												Bonificaciones
											</h4>
											<div
												class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
											>
												{#each detalle.bonos as bono}
													<div class="rounded-md border border-gray-100 bg-gray-50 p-3">
														<div class="mb-1.5">
															<span class="block text-xs font-medium text-gray-700"
																>{bono.name}</span
															>
															<span class="text-[11px] text-gray-400"
																>{formatCurrency(bono.value)} / u</span
															>
														</div>
														<div class="space-y-1.5">
															{#each bono.values as val}
																<div>
																	<label class="mb-0.5 block text-[11px] text-gray-400"
																		>{formatMes(val.mes)}</label
																	>
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
																		class="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
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
										<div>
											<h4 class="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
												Mantenimientos
											</h4>
											{#each detalle.mantenimientos as mant}
												<div class="rounded-md border border-gray-100 bg-gray-50 p-3">
													<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
														{#each mant.values as val}
															<div>
																<label class="mb-0.5 block text-[11px] text-gray-400"
																	>{formatMes(val.mes)}</label
																>
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
																	class="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
																/>
															</div>
														{/each}
													</div>
												</div>
											{/each}
										</div>
									{/if}

									<!-- Pernotes -->
									<div>
										<div class="mb-2 flex items-center justify-between">
											<h4 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
												Pernotes
											</h4>
											<button
												on:click={() => handleAddPernote(detalle.vehiculo.value)}
												class="flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
											>
												<Plus class="h-3 w-3" />
												Agregar
											</button>
										</div>
										{#if detalle.pernotes.length > 0}
											<div class="space-y-2">
												{#each detalle.pernotes as pernote, pIdx}
													<div class="rounded-md border border-gray-200 bg-gray-50 p-3">
														<div class="mb-2 flex items-center justify-between">
															<span class="text-xs font-medium text-gray-600"
																>Pernote #{pIdx + 1}</span
															>
															<button
																on:click={() => handleRemovePernote(detalle.vehiculo.value, pIdx)}
																class="text-red-400 hover:text-red-600"
															>
																<Trash2 class="h-3.5 w-3.5" />
															</button>
														</div>
														<div class="mb-2">
															<label class="mb-0.5 block text-[11px] text-gray-400">Empresa</label>
															<Select
																items={empresasOptions}
																value={empresasOptions.find((e) => e.value === pernote.empresa_id)}
																on:change={(e) =>
																	handlePernoteChange(
																		detalle.vehiculo.value,
																		pIdx,
																		'empresa_id',
																		e.detail?.value || ''
																	)}
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
																handlePernoteChange(
																	detalle.vehiculo.value,
																	pIdx,
																	'fechas',
																	nuevasFechas
																);
																handlePernoteChange(
																	detalle.vehiculo.value,
																	pIdx,
																	'cantidad',
																	nuevasFechas.length
																);
															}}
														/>
														<div class="mt-2 flex items-center justify-between text-xs">
															<span class="text-gray-500">
																{pernote.cantidad} día{pernote.cantidad !== 1 ? 's' : ''} × {formatCurrency(
																	pernote.valor
																)}
															</span>
															<span class="font-semibold text-gray-800">
																{formatCurrency(pernote.cantidad * pernote.valor)}
															</span>
														</div>
													</div>
												{/each}
											</div>
										{:else}
											<p class="text-xs text-gray-400">Sin pernotes</p>
										{/if}
									</div>

									<!-- Recargos -->
									<div>
										<div class="mb-2 flex items-center justify-between">
											<h4 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
												Recargos
											</h4>
											<button
												on:click={() => handleAddRecargo(detalle.vehiculo.value)}
												class="flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
											>
												<Plus class="h-3 w-3" />
												Agregar
											</button>
										</div>
										{#if detalle.recargos.length > 0}
											<div class="space-y-2">
												{#each detalle.recargos as recargo, rIdx}
													<div class="rounded-md border border-gray-200 bg-gray-50 p-3">
														<div class="mb-2 flex items-center justify-between">
															<span class="text-xs font-medium text-gray-600"
																>Recargo #{rIdx + 1}</span
															>
															<button
																on:click={() => handleRemoveRecargo(detalle.vehiculo.value, rIdx)}
																class="text-red-400 hover:text-red-600"
															>
																<Trash2 class="h-3.5 w-3.5" />
															</button>
														</div>
														<div class="grid grid-cols-3 gap-2">
															<div>
																<label class="mb-0.5 block text-[11px] text-gray-400">Empresa</label
																>
																<Select
																	items={empresasOptions}
																	value={empresasOptions.find(
																		(e) => e.value === recargo.empresa_id
																	)}
																	on:change={(e) =>
																		handleRecargoChange(
																			detalle.vehiculo.value,
																			rIdx,
																			'empresa_id',
																			e.detail?.value || ''
																		)}
																	placeholder="Seleccionar..."
																	searchable={true}
																	--border-radius="0.375rem"
																	--font-size="0.875rem"
																	--height="36px"
																/>
															</div>
															<div>
																<label class="mb-0.5 block text-[11px] text-gray-400">Mes</label>
																<select
																	value={recargo.mes}
																	on:change={(e) =>
																		handleRecargoChange(
																			detalle.vehiculo.value,
																			rIdx,
																			'mes',
																			e.currentTarget.value
																		)}
																	class="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
																>
																	{#if recargo.mes && !mesesRange.includes(recargo.mes)}
																		<option value={recargo.mes}>{formatMes(recargo.mes)}</option>
																	{/if}
																	{#each mesesRange as mes}
																		<option value={mes}>{formatMes(mes)}</option>
																	{/each}
																</select>
															</div>
															<div>
																<label class="mb-0.5 block text-[11px] text-gray-400">Valor</label>
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
																	class="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
																/>
															</div>
														</div>
														<div class="mt-2 flex flex-wrap items-center gap-4">
															<label class="flex items-center text-xs text-gray-500">
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
																	class="mr-1.5 h-3.5 w-3.5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
																/>
																Pagado por cliente
															</label>
															{#if recargo.pag_cliente}
																<div class="inline-flex items-center gap-1">
																	<label class="text-[11px] text-gray-400">% Propietario</label>
																	<input
																		type="number"
																		value={recargo.porcentaje_propietario || 0}
																		on:input={(e) =>
																			handleRecargoChange(
																				detalle.vehiculo.value,
																				rIdx,
																				'porcentaje_propietario',
																				parseFloat(e.currentTarget.value) || 0
																			)}
																		min="0"
																		max="100"
																		step="1"
																		placeholder="0"
																		class="w-14 rounded border border-gray-200 px-2 py-1 text-center text-xs focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
																	/>
																	<span class="text-[10px] text-gray-400">%</span>
																</div>
															{/if}
															<label class="flex items-center text-xs text-gray-500">
																<input
																		type="checkbox"
																		checked={recargo.emisor === 'TRANSMERALDA'}
																		on:change={(e) =>
																			handleRecargoChange(
																				detalle.vehiculo.value,
																				rIdx,
																				'emisor',
																				e.currentTarget.checked ? 'TRANSMERALDA' : 'COTRANSMEQ'
																			)}
																class="mr-1.5 h-3.5 w-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
															/>
															Transmeralda
														</label>
													</div>
														</div>
													{/each}
												</div>
											{:else}
												<p class="text-xs text-gray-400">Sin recargos</p>
											{/if}
										</div>
									</div>
								</div>
							{/each}
					{/if}

					<!-- Recargos Calculados desde Planillas -->
					<RecargosPreview
						bind:this={recargosPreviewRef}
						conductorId={conductorSelected?.value || ''}
						periodoInicio={periodo_inicio}
						periodoFin={periodo_fin}
						cachedPreviewData={previewRecargosData}
						{cachedGrupoOverrides}
						on:recargosCalculated={handleRecargosCalculated}
					/>
				</div>
			{:else if currentStep === 3}
				<!-- PASO 3: Cálculos Finales -->
				<div class="space-y-5">
					<h2 class="flex items-center gap-2 text-base font-semibold text-gray-800">
						<Calculator class="h-4 w-4 text-orange-600" />
						Cálculos y Ajustes
					</h2>

					<!-- Opciones booleanas -->
					<div class="rounded-md border border-gray-200 p-4">
						<h3 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
							Opciones
						</h3>
						<div class="grid grid-cols-2 gap-x-6 gap-y-2 lg:grid-cols-3">
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={isCheckedAjuste}
									class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								Ajuste Salarial
							</label>
							{#if isCheckedAjuste}
								<label
									class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
								>
									<input
										type="checkbox"
										bind:checked={isAjustePorDia}
										class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
									/>
									Ajuste por Día
								</label>
							{/if}
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={isAjusteParex}
									class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								Ajuste PAREX
							</label>
							{#if isAjusteParex}
								<label
									class="flex cursor-pointer items-center gap-2 py-1 pl-6 text-sm text-gray-700 hover:text-gray-900"
								>
									<input
										type="checkbox"
										bind:checked={isAjusteParexRecargosCompletos}
										class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
									/>
									8% sobre recargos completos
								</label>
							{/if}
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={isVacaciones}
									class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								Vacaciones
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={isIncapacidad}
									class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								Incapacidad
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={isCesantias}
									class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								Pagar Cesantías
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={isPrima}
									class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
								/>
								Pagar Prima
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={noDescontarSalud}
									class="h-4 w-4 rounded border-gray-300 text-red-500 focus:ring-red-400"
								/>
								No Descontar Salud
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={noDescontarPension}
									class="h-4 w-4 rounded border-gray-300 text-red-500 focus:ring-red-400"
								/>
								No Descontar Pensión
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={descontarTransporte}
									class="h-4 w-4 rounded border-gray-300 text-red-500 focus:ring-red-400"
								/>
								Descontar Transporte
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={descontarSaludSalario}
									class="h-4 w-4 rounded border-gray-300 text-red-500 focus:ring-red-400"
								/>
								Descontar Salud del salario
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-gray-700 hover:text-gray-900"
							>
								<input
									type="checkbox"
									bind:checked={descontarPensionSalario}
									class="h-4 w-4 rounded border-gray-300 text-red-500 focus:ring-red-400"
								/>
								Descontar Pensión del salario
							</label>
						</div>
					</div>

					<!-- Días ajuste para deducciones -->
					{#if isCheckedAjuste}
						<div class="rounded-md border border-gray-200 p-4">
							<h3 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Deducciones del Ajuste Salarial
							</h3>
							<div class="flex items-center gap-4">
								<span class="text-sm text-gray-600">Días del ajuste a tomar para deducciones:</span>
								<input
									type="number"
									min="0"
									max="30"
									bind:value={diasAjusteDeducciones}
									placeholder="Todos"
									class="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-orange-500 focus:ring-orange-500"
								/>
								<span class="text-xs text-gray-400">
									{#if diasAjusteDeducciones !== null && diasAjusteDeducciones !== undefined}
										(Ajuste/30 × {diasAjusteDeducciones})
									{:else}
										(Se toma el ajuste completo)
									{/if}
								</span>
							</div>
						</div>
					{/if}

					<!-- Disponibilidad -->
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label for="disponibilidad" class="mb-1.5 block text-xs font-medium tracking-wide text-gray-500 uppercase"
								>Disponibilidad</label
							>
							<input
								id="disponibilidad"
								type="text"
								inputmode="numeric"
								value={disponibilidad ? '$ ' + formatCOPInput(disponibilidad) : ''}
								on:focus={handleCOPFocus}
								on:blur={handleCOPBlur}
								on:input={(e) => {
									const val = parseCOPInput(e.currentTarget.value);
									if (!isNaN(val)) {
										disponibilidad = val;
									}
								}}
								placeholder="$ 0"
								class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
							/>
						</div>
						<div class="flex items-end pb-2">
							{#if disponibilidad > 0}
								<span class="text-xs text-gray-400">Con disponibilidad </span>
							{:else}
								<span class="text-xs text-gray-400">Sin disponibilidad</span>
							{/if}
						</div>
					</div>

					<!-- Períodos especiales -->
					{#if isVacaciones}
						<div class="rounded-md border border-gray-200 p-4">
							<h4 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Vacaciones
							</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label class="mb-1.5 block text-xs text-gray-500">Fecha Inicio</label>
									<input
										type="date"
										bind:value={periodo_vacaciones_inicio}
										class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
									/>
								</div>
								<div>
									<label class="mb-1.5 block text-xs text-gray-500">Fecha Fin</label>
									<input
										type="date"
										bind:value={periodo_vacaciones_fin}
										class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
									/>
								</div>
							</div>
						</div>
					{/if}

					{#if isIncapacidad}
						<div class="rounded-md border border-gray-200 p-4">
							<h4 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Incapacidad
							</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label class="mb-1.5 block text-xs text-gray-500">Fecha Inicio</label>
									<input
										type="date"
										bind:value={periodo_incapacidad_inicio}
										class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
									/>
								</div>
								<div>
									<label class="mb-1.5 block text-xs text-gray-500">Fecha Fin</label>
									<input
										type="date"
										bind:value={periodo_incapacidad_fin}
										class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Cesantías -->
					{#if isCesantias}
						<div class="rounded-md border border-gray-200 p-4">
							<h4 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Cesantías e Intereses
							</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label class="mb-1.5 block text-xs text-gray-500">Cesantías</label>
									<input
										type="text"
										inputmode="numeric"
										value={cesantias ? '$ ' + formatCOPInput(cesantias) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) => (cesantias = parseCOPInput(e.currentTarget.value))}
										class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
									/>
								</div>
								<div>
									<label class="mb-1.5 block text-xs text-gray-500">Interés Cesantías</label>
									<input
										type="text"
										inputmode="numeric"
										value={interes_cesantias ? '$ ' + formatCOPInput(interes_cesantias) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) => (interes_cesantias = parseCOPInput(e.currentTarget.value))}
										class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Prima -->
					{#if isPrima}
						<div class="rounded-md border border-gray-200 p-4">
							<h4 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Prima de Servicios
							</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label class="mb-1.5 block text-xs text-gray-500">Prima</label>
									<input
										type="text"
										inputmode="numeric"
										value={prima ? '$ ' + formatCOPInput(prima) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) => (prima = parseCOPInput(e.currentTarget.value))}
										class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
									/>
								</div>
								<div>
									<label class="mb-1.5 block text-xs text-gray-500"
										>Prima Pendiente (opcional)</label
									>
									<input
										type="text"
										inputmode="numeric"
										value={prima_pendiente ? '$ ' + formatCOPInput(prima_pendiente) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) =>
											(prima_pendiente = parseCOPInput(e.currentTarget.value) || null)}
										class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Anticipos -->
					<div class="rounded-md border border-gray-200 p-4">
						<div class="mb-3 flex items-center justify-between">
							<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Anticipos</h3>
							<button
								on:click={() => (showAnticipoForm = !showAnticipoForm)}
								class="flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
							>
								<Plus class="h-3 w-3" />
								Agregar
							</button>
						</div>

						{#if showAnticipoForm}
							<div class="mb-3 rounded-md bg-gray-50 p-3">
								<div class="grid grid-cols-3 gap-3">
									<div>
										<label class="mb-1 block text-xs text-gray-500">Valor</label>
										<input
											type="text"
											inputmode="numeric"
											value={nuevoAnticipo.valor
												? '$ ' + formatCOPInput(Number(nuevoAnticipo.valor))
												: ''}
											on:focus={handleCOPFocus}
											on:blur={handleCOPBlur}
											on:input={(e) =>
												(nuevoAnticipo.valor = String(parseCOPInput(e.currentTarget.value)))}
											class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
										/>
									</div>
									<div>
										<label class="mb-1 block text-xs text-gray-500">Fecha</label>
										<input
											type="date"
											bind:value={nuevoAnticipo.fecha}
											class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
										/>
									</div>
									<div>
										<label class="mb-1 block text-xs text-gray-500">Concepto</label>
										<input
											type="text"
											bind:value={nuevoAnticipo.concepto}
											placeholder="Opcional"
											class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
										/>
									</div>
								</div>
								<div class="mt-3 flex gap-2">
									<button
										on:click={agregarAnticipo}
										class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700"
									>
										Agregar
									</button>
									<button
										on:click={() => (showAnticipoForm = false)}
										class="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-300"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if anticipos.length > 0}
							<div class="space-y-1">
								{#each anticipos as anticipo (anticipo.id)}
									<div class="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
										<div>
											<span class="text-sm font-medium text-gray-800"
												>{formatCurrency(anticipo.valor)}</span
											>
											<span class="ml-2 text-xs text-gray-400">
												{new Date(anticipo.fecha).toLocaleDateString('es-CO')}
												{#if anticipo.concepto}
													· {anticipo.concepto}{/if}
											</span>
										</div>
										<button
											on:click={() => eliminarAnticipo(anticipo.id)}
											class="text-red-400 hover:text-red-600"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-gray-400">Sin anticipos</p>
						{/if}
					</div>

					<!-- Conceptos adicionales -->
					<div class="rounded-md border border-gray-200 p-4">
						<div class="mb-3 flex items-center justify-between">
							<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
								Conceptos Adicionales
							</h3>
							<button
								on:click={() => (showConceptoForm = !showConceptoForm)}
								class="flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
							>
								<Plus class="h-3 w-3" />
								Agregar
							</button>
						</div>

						{#if showConceptoForm}
							<div class="mb-3 rounded-md bg-gray-50 p-3">
								<div class="grid grid-cols-2 gap-3">
									<div>
										<label class="mb-1 block text-xs text-gray-500">Valor</label>
										<input
											type="text"
											inputmode="numeric"
											value={nuevoConcepto.valor
												? '$ ' + formatCOPInput(Number(nuevoConcepto.valor))
												: ''}
											on:focus={handleCOPFocus}
											on:blur={handleCOPBlur}
											on:input={(e) =>
												(nuevoConcepto.valor = String(parseCOPInput(e.currentTarget.value)))}
											placeholder="+Devengo / -Deducción"
											class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
										/>
									</div>
									<div>
										<label class="mb-1 block text-xs text-gray-500">Observaciones</label>
										<input
											type="text"
											bind:value={nuevoConcepto.observaciones}
											placeholder="Descripción"
											class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
										/>
									</div>
								</div>
								<div class="mt-3 flex gap-2">
									<button
										on:click={agregarConcepto}
										class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700"
									>
										Agregar
									</button>
									<button
										on:click={() => (showConceptoForm = false)}
										class="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-300"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if conceptos_adicionales.length > 0}
							<div class="space-y-1">
								{#each conceptos_adicionales as concepto, idx}
									<div class="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
										<div>
											<span
												class="text-sm font-medium {concepto.valor > 0
													? 'text-orange-700'
													: 'text-red-600'}">{formatCurrency(concepto.valor)}</span
											>
											<span class="ml-2 text-xs text-gray-400">{concepto.observaciones}</span>
										</div>
										<button
											on:click={() => eliminarConcepto(idx)}
											class="text-red-400 hover:text-red-600"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-gray-400">Sin conceptos adicionales</p>
						{/if}
					</div>

					<!-- Detalle de Bonificaciones por Vehículo y Período -->
					{#if detallesVehiculos.length > 0}
						<div class="rounded-md border border-gray-200">
							<div class="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
								<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
									Detalle Bonificaciones
								</h3>
							</div>
							<div class="p-4">
								{#each detallesVehiculos as detalle}
									{@const bonosConCantidad = detalle.bonos.filter((b) =>
										b.values.some((v) => v.quantity > 0)
									)}
									{#if bonosConCantidad.length > 0}
										<div class="mb-3">
											<p class="mb-2 text-xs font-medium text-gray-500">{detalle.vehiculo.label}</p>
											<div class="overflow-x-auto">
												<table class="w-full text-xs">
													<thead>
														<tr class="border-b border-gray-200">
															<th class="py-1.5 text-left font-medium text-gray-500"
																>Bonificación</th
															>
															<th class="py-1.5 text-right font-medium text-gray-500">V. Unit.</th>
															{#each mesesRange as mes}
																<th class="py-1.5 text-center font-medium text-gray-500"
																	>{formatMes(mes)}</th
																>
															{/each}
															<th class="py-2 text-right font-medium text-gray-600">Subtotal</th>
														</tr>
													</thead>
													<tbody>
														{#each bonosConCantidad as bono}
															{@const subtotal = bono.values.reduce(
																(s, v) => s + v.quantity * bono.value,
																0
															)}
															<tr class="border-b border-gray-100">
																<td class="py-2 text-gray-800">{bono.name}</td>
																<td class="py-1.5 text-right text-gray-600"
																	>{formatCurrency(bono.value)}</td
																>
																{#each bono.values as val}
																	<td
																		class="py-1.5 text-center {val.quantity > 0
																			? 'font-semibold text-gray-800'
																			: 'text-gray-300'}">{val.quantity}</td
																	>
																{/each}
																<td class="py-1.5 text-right font-semibold text-orange-700"
																	>{formatCurrency(subtotal)}</td
																>
															</tr>
														{/each}
													</tbody>
													<tfoot>
														<tr class="border-t border-gray-300">
															<td
																colspan={2 + mesesRange.length}
																class="py-1.5 text-right text-xs font-semibold text-gray-600"
																>Total Vehículo:</td
															>
															<td class="py-1.5 text-right text-xs font-bold text-orange-700">
																{formatCurrency(
																	bonosConCantidad.reduce(
																		(acc, b) =>
																			acc + b.values.reduce((s, v) => s + v.quantity * b.value, 0),
																		0
																	)
																)}
															</td>
														</tr>
													</tfoot>
												</table>
											</div>
										</div>
									{/if}
								{/each}
								<div
									class="mt-2 flex items-center justify-between border-t border-gray-200 px-1 pt-3"
								>
									<span class="text-sm font-semibold text-gray-700">Total Bonificaciones</span>
									<span class="text-sm font-bold text-orange-700"
										>{formatCurrency(totales.totalBonificaciones)}</span
									>
								</div>
							</div>
						</div>
					{/if}

					<!-- Detalle de Recargos -->
					{#if detallesVehiculos.some((d) => d.recargos.length > 0) || previewRecargosGrupos.length > 0 || totalRecargosPreview > 0}
						<div class="rounded-md border border-gray-200">
							<div class="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
								<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
									Detalle Recargos
								</h3>
							</div>
							<div class="p-4">
								<!-- Recargos manuales por vehículo -->
								{#each detallesVehiculos as detalle}
									{#if detalle.recargos.length > 0}
										<div class="mb-3">
											<p class="mb-2 text-xs font-medium text-gray-500">
												{detalle.vehiculo.label} <span class="text-gray-400">(manuales)</span>
											</p>
											<div class="overflow-x-auto">
												<table class="w-full text-xs">
													<thead>
														<tr class="border-b border-gray-200">
															<th class="py-1.5 text-left font-medium text-gray-500">Empresa</th>
															<th class="py-1.5 text-center font-medium text-gray-500">Período</th>
															<th class="py-1.5 text-center font-medium text-gray-500"
																>Pag. Cliente</th
															>
															<th class="py-1.5 text-center font-medium text-gray-500">Asume</th>
															<th class="py-1.5 text-center font-medium text-gray-500">Emisor</th>
															<th class="py-1.5 text-right font-medium text-gray-500">Valor</th>
														</tr>
													</thead>
													<tbody>
														{#each detalle.recargos as recargo}
															{@const empresaNombre =
																empresas.find((e) => e.id === recargo.empresa_id)?.nombre ||
																recargo.empresa_id}
															<tr class="border-b border-gray-50">
																<td class="py-1.5 text-gray-700">{empresaNombre}</td>
																<td class="py-1.5 text-center text-gray-600"
																	>{recargo.mes ? formatMes(recargo.mes) : '-'}</td
																>
																<td class="py-1.5 text-center">
																	<span
																		class="text-[11px] {recargo.pag_cliente
																			? 'text-orange-600'
																			: 'text-gray-400'}">{recargo.pag_cliente ? 'Sí' : 'No'}</span
																	>
																</td>
																<td class="py-1.5 text-center">
																	{#if recargo.pag_cliente && (recargo.porcentaje_propietario || 0) > 0}
																		<span class="text-[11px] text-amber-600">Propietario {recargo.porcentaje_propietario}%</span>
																	{:else if recargo.pag_cliente}
																		<span class="text-[11px] text-blue-600">Cliente 100%</span>
																	{:else}
																		<span class="text-[11px] text-gray-400">—</span>
																	{/if}
																</td>
																<td class="py-1.5 text-center">
																	<span class="text-[11px] {recargo.emisor === 'TRANSMERALDA' ? 'text-purple-600' : 'text-teal-600'}">
																		{recargo.emisor === 'TRANSMERALDA' ? 'Transmeralda' : 'Cotransmeq'}
																	</span>
																</td>
																<td class="py-1.5 text-right font-medium text-gray-800"
																	>{formatCurrency(recargo.valor)}</td
																>
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										</div>
									{/if}
								{/each}
								<!-- Recargos calculados desde planillas -->
								{#if previewRecargosGrupos.length > 0}
									<div class="mb-3">
										<p class="mb-2 text-xs font-medium text-gray-500">Recargos de Planillas</p>
										<div class="overflow-x-auto">
											<table class="w-full text-xs">
												<thead>
													<tr class="border-b border-gray-200">
														<th class="py-1.5 text-left font-medium text-gray-500">Vehículo</th>
														<th class="py-1.5 text-left font-medium text-gray-500">Empresa</th>
														<th class="py-1.5 text-center font-medium text-gray-500">Mes</th>
														<th class="py-1.5 text-center font-medium text-gray-500"
															>Pag. Cliente</th
														>
														<th class="py-1.5 text-center font-medium text-gray-500"
															>% Propietario</th
														>
														<th class="py-1.5 text-right font-medium text-gray-500">Valor</th>
													</tr>
												</thead>
												<tbody>
													{#each previewRecargosGrupos as grupo}
														<tr class="border-b border-gray-50">
															<td class="py-1.5 font-medium text-gray-800"
																>{grupo.vehiculo_placa}</td
															>
															<td class="py-1.5 text-gray-700">{grupo.empresa_nombre}</td>
															<td class="py-1.5 text-center text-gray-600"
																>{grupo.mes ? formatMes(grupo.mes) : '-'}</td
															>
															<td class="py-1.5 text-center">
																<span
																	class="text-[11px] {grupo.pag_cliente
																		? 'text-orange-600'
																		: 'text-gray-400'}">{grupo.pag_cliente ? 'Sí' : 'No'}</span
																>
															</td>
															<td class="py-1.5 text-center text-gray-600"
																>{grupo.pag_cliente && grupo.porcentaje_propietario > 0
																	? grupo.porcentaje_propietario + '%'
																	: '—'}</td
															>
															<td class="py-1.5 text-right font-medium text-gray-800"
																>{formatCurrency(grupo.valor)}</td
															>
														</tr>
													{/each}
												</tbody>
												<tfoot>
													<tr class="border-t border-gray-200">
														<td
															colspan="5"
															class="py-1.5 text-right text-xs font-semibold text-gray-600"
															>Subtotal Planillas:</td
														>
														<td class="py-1.5 text-right text-xs font-bold text-gray-800"
															>{formatCurrency(totalRecargosPreview)}</td
														>
													</tr>
												</tfoot>
											</table>
										</div>
									</div>
								{:else if totalRecargosPreview > 0}
									<div
										class="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-xs"
									>
										<div>
											<span class="font-medium text-gray-600">Recargos de Planillas</span>
											{#if !previewRecargosData && mode === 'edit'}
												<span class="ml-1 text-[11px] text-gray-400">(guardado)</span>
											{/if}
										</div>
										<span class="font-semibold text-gray-800"
											>{formatCurrency(totalRecargosPreview)}</span
										>
									</div>
								{/if}
								<div
									class="mt-2 flex items-center justify-between border-t border-gray-200 px-1 pt-3"
								>
									<span class="text-sm font-semibold text-gray-700">Total Recargos</span>
									<span class="text-sm font-bold text-orange-700"
										>{formatCurrency(totales.totalRecargos)}</span
									>
								</div>
							</div>
						</div>
					{/if}

					<!-- Detalle de Pernotes -->
					{#if detallesVehiculos.some((d) => d.pernotes.length > 0)}
						<div class="rounded-md border border-gray-200">
							<div class="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
								<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
									Detalle Pernotes
								</h3>
							</div>
							<div class="p-4">
								{#each detallesVehiculos as detalle}
									{#if detalle.pernotes.length > 0}
										<div class="mb-3">
											<p class="mb-2 text-xs font-medium text-gray-500">{detalle.vehiculo.label}</p>
											<div class="overflow-x-auto">
												<table class="w-full text-xs">
													<thead>
														<tr class="border-b border-gray-200">
															<th class="py-1.5 text-left font-medium text-gray-500">Empresa</th>
															<th class="py-1.5 text-center font-medium text-gray-500">Cant.</th>
															<th class="py-1.5 text-right font-medium text-gray-500">V. Unit.</th>
															<th class="py-1.5 text-right font-medium text-gray-500">Subtotal</th>
														</tr>
													</thead>
													<tbody>
														{#each detalle.pernotes as pernote}
															{@const empresaNombre =
																empresas.find((e) => e.id === pernote.empresa_id)?.nombre ||
																pernote.empresa_id}
															<tr class="border-b border-gray-50">
																<td class="py-1.5 text-gray-700">{empresaNombre}</td>
																<td class="py-1.5 text-center text-gray-600">{pernote.cantidad}</td>
																<td class="py-1.5 text-right text-gray-600"
																	>{formatCurrency(pernote.valor)}</td
																>
																<td class="py-1.5 text-right font-medium text-gray-800"
																	>{formatCurrency(pernote.cantidad * pernote.valor)}</td
																>
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										</div>
									{/if}
								{/each}
								<div
									class="mt-2 flex items-center justify-between border-t border-gray-200 px-1 pt-3"
								>
									<span class="text-sm font-semibold text-gray-700">Total Pernotes</span>
									<span class="text-sm font-bold text-orange-700"
										>{formatCurrency(totales.totalPernotes)}</span
									>
								</div>
							</div>
						</div>
					{/if}

					<!-- Detalle de Ajustes -->
					{#if isCheckedAjuste || isAjusteParex}
						<div class="rounded-md border border-gray-200">
							<div class="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
								<h3 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
									Detalle Ajustes
								</h3>
							</div>
							<div class="space-y-3 p-4">
								{#if isCheckedAjuste}
									{@const salarioBase = Number(
										conductores.find((c) => c.id === conductorSelected?.value)?.salario_base || 0
									)}
									{@const salarioVillanueva = Number(
										configuracion.find((c) => c.nombre === 'Salario villanueva')?.valor || 0
									)}
									{@const diferencia = salarioVillanueva - salarioBase}
									<div>
										<p class="mb-2 text-xs font-medium text-gray-500">Ajuste Salarial</p>
										<table class="w-full text-xs">
											<tbody>
												<tr class="border-b border-gray-50">
													<td class="py-1 text-gray-500">Salario Base</td>
													<td class="py-1 text-right font-medium text-gray-700"
														>{formatCurrency(salarioBase)}</td
													>
												</tr>
												<tr class="border-b border-gray-50">
													<td class="py-1 text-gray-500">Salario Ajuste Salarial</td>
													<td class="py-1 text-right font-medium text-gray-700"
														>{formatCurrency(salarioVillanueva)}</td
													>
												</tr>
												<tr class="border-b border-gray-50">
													<td class="py-1 text-gray-500">Diferencia</td>
													<td class="py-1 text-right font-medium text-gray-700"
														>{formatCurrency(diferencia)}</td
													>
												</tr>
												<tr class="border-b border-gray-50">
													<td class="py-1 text-gray-500">Días × Modalidad</td>
													<td class="py-1 text-right font-medium text-gray-700"
														>{dias_laborados_villanueva} · {isAjustePorDia
															? 'Por día'
															: dias_laborados_villanueva >= 17
																? 'Completo'
																: 'Por día'}</td
													>
												</tr>
												<tr class="border-t border-gray-200">
													<td class="py-1.5 font-semibold text-gray-700">Total Ajuste</td>
													<td class="py-1.5 text-right font-bold text-orange-700"
														>{formatCurrency(totales.bonificacionVillanueva)}</td
													>
												</tr>
											</tbody>
										</table>
									</div>
								{/if}

								{#if isAjusteParex}
									{@const PAREX_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef'}
									{@const recargosManualParex = detallesVehiculos
										.flatMap((d) => d.recargos)
										.filter((r) => r.empresa_id === PAREX_ID)
										.reduce((s, r) => s + r.valor, 0)}
									{@const recargosPreviewParex =
											previewRecargosGrupos
												.filter((g: any) => g.empresa_id === PAREX_ID && g.incluir !== false)
												.reduce((s: number, g: any) => s + (g.valor || 0), 0)}
									{@const totalRecargosParex = recargosManualParex + recargosPreviewParex}
									<div>
										<p class="mb-2 text-xs font-medium text-gray-500">Ajuste PAREX (8%)</p>
										<table class="w-full text-xs">
											<tbody>
												<tr class="border-b border-gray-50">
													<td class="py-1 text-gray-500">Empresa</td>
													<td class="py-1 text-right font-medium text-gray-700"
														>{empresas.find((e) => e.id === PAREX_ID)?.nombre || 'PAREX'}</td
													>
												</tr>
												<tr class="border-b border-gray-50">
													<td class="py-1 text-gray-500">Total Recargos PAREX</td>
													<td class="py-1 text-right font-medium text-gray-700"
														>{formatCurrency(totalRecargosParex)}</td
													>
												</tr>
												<tr class="border-b border-gray-50">
													<td class="py-1 text-gray-500">Porcentaje</td>
													<td class="py-1 text-right font-medium text-gray-700">8%</td>
												</tr>
												<tr class="border-t border-gray-200">
													<td class="py-1.5 font-semibold text-gray-700">Ajuste PAREX</td>
													<td class="py-1.5 text-right font-bold text-orange-700"
														>{formatCurrency(totales.ajusteParex)}</td
													>
												</tr>
												<tr class="border-b border-gray-50">
													<td class="py-1 text-gray-500">50% → Salud</td>
													<td class="py-1 text-right font-medium text-red-500"
														>{formatCurrency(totales.ajusteParex * 0.5)}</td
													>
												</tr>
												<tr class="border-b border-gray-50">
													<td class="py-1 text-gray-500">50% → Pensión</td>
													<td class="py-1 text-right font-medium text-red-500"
														>{formatCurrency(totales.ajusteParex * 0.5)}</td
													>
												</tr>
											</tbody>
										</table>
									</div>
								{/if}
							</div>
						</div>
					{/if}

					<!-- Resumen de Liquidación -->
					<div class="rounded-lg border border-gray-200 bg-white">
						<!-- Header -->
						<div class="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
							<DollarSign class="h-5 w-5 text-gray-400" />
							<h3 class="text-sm font-semibold tracking-wide text-gray-700 uppercase">
								Resumen de Liquidación
							</h3>
						</div>

						<div class="grid grid-cols-1 gap-0 lg:grid-cols-2">
							<!-- Devengados -->
							<div class="border-b border-gray-200 p-5 lg:border-r lg:border-b-0">
								<h4 class="mb-3 text-xs font-bold tracking-wider text-orange-600 uppercase">
									Devengados
								</h4>
								<table class="w-full text-sm">
									<tbody>
										<tr class="border-b border-gray-100">
											<td class="py-2 text-gray-600">Salario ({dias_laborados} días)</td>
											<td class="py-2 text-right font-medium text-gray-900"
												>{formatCurrency(totales.salarioDevengado)}</td
											>
										</tr>
										<tr class="border-b border-gray-100">
											<td class="py-2 text-gray-600">Auxilio de Transporte</td>
											<td class="py-2 text-right font-medium text-gray-900"
												>{formatCurrency(totales.auxilioTransporte)}</td
											>
										</tr>
										<tr class="border-b border-gray-100">
											<td class="py-2 text-gray-600">Bonificaciones</td>
											<td class="py-2 text-right font-medium text-orange-600"
												>{formatCurrency(totales.totalBonificaciones)}</td
											>
										</tr>
										<tr class="border-b border-gray-100">
											<td class="py-2 text-gray-600">Pernotes</td>
											<td class="py-2 text-right font-medium text-orange-600"
												>{formatCurrency(totales.totalPernotes)}</td
											>
										</tr>
										<tr class="border-b border-gray-100">
											<td class="py-2 text-gray-600">Recargos</td>
											<td class="py-2 text-right font-medium text-orange-600"
												>{formatCurrency(totales.totalRecargos)}</td
											>
										</tr>
										{#if totales.bonificacionVillanueva > 0}
											<tr class="border-b border-gray-100">
												<td class="py-2 text-gray-600">Ajuste Salarial</td>
												<td class="py-2 text-right font-medium text-orange-600"
													>{formatCurrency(totales.bonificacionVillanueva)}</td
												>
											</tr>
										{/if}
										{#if totales.valorIncapacidad > 0}
											<tr class="border-b border-gray-100">
												<td class="py-2 text-gray-600">Incapacidad</td>
												<td class="py-2 text-right font-medium text-gray-900"
													>{formatCurrency(totales.valorIncapacidad)}</td
												>
											</tr>
										{/if}
										{#if totales.totalVacaciones > 0}
											<tr class="border-b border-gray-100">
												<td class="py-2 text-gray-600">Vacaciones</td>
												<td class="py-2 text-right font-medium text-gray-900"
													>{formatCurrency(totales.totalVacaciones)}</td
												>
											</tr>
										{/if}
										{#if totales.interesCesantias > 0}
											<tr class="border-b border-gray-100">
												<td class="py-2 text-gray-600">Interés Cesantías</td>
												<td class="py-2 text-right font-medium text-gray-900"
													>{formatCurrency(totales.interesCesantias)}</td
												>
											</tr>
										{/if}
										{#if totales.totalAjustesAdicionales !== 0}
											<tr class="border-b border-gray-100">
												<td class="py-2 text-gray-600">Conceptos Adicionales</td>
												<td
													class="py-2 text-right font-medium {totales.totalAjustesAdicionales > 0
														? 'text-orange-600'
														: 'text-red-600'}">{formatCurrency(totales.totalAjustesAdicionales)}</td
												>
											</tr>
										{/if}
									</tbody>
									<tfoot>
										<tr class="border-t-2 border-gray-300">
											<td class="py-3 font-bold text-gray-800">Total Devengado</td>
											<td class="py-3 text-right">
												<span class="font-bold text-gray-900"
													>{formatCurrency(totales.sueldoBruto)}</span
												>
												{#if totales.sueldoBruto % 1 !== 0}
													<span class="block text-[10px] text-gray-400"
														>{formatCurrencyDecimal(totales.sueldoBruto)}</span
													>
												{/if}
											</td>
										</tr>
									</tfoot>
								</table>
							</div>

							<!-- Deducciones -->
							<div class="p-5">
								<h4 class="mb-3 text-xs font-bold tracking-wider text-red-500 uppercase">
									Deducciones
								</h4>
								<table class="w-full text-sm">
									<tbody>
										<tr class="border-b border-gray-100">
											<td class="py-2 text-gray-600"
												>Salud (4%){totales.ajusteParex > 0 ? ' + PAREX' : ''}</td
											>
											<td class="py-2 text-right font-medium text-red-500"
												>-{formatCurrency(totales.salud)}</td
											>
										</tr>
										<tr class="border-b border-gray-100">
											<td class="py-2 text-gray-600"
												>Pensión (4%){totales.ajusteParex > 0 ? ' + PAREX' : ''}</td
											>
											<td class="py-2 text-right font-medium text-red-500"
												>-{formatCurrency(totales.pension)}</td
											>
										</tr>
										{#if totales.totalAnticipos > 0}
											<tr class="border-b border-gray-100">
												<td class="py-2 text-gray-600">Anticipos</td>
												<td class="py-2 text-right font-medium text-red-500"
													>-{formatCurrency(totales.totalAnticipos)}</td
												>
											</tr>
										{/if}
									</tbody>
									<tfoot>
										<tr class="border-t-2 border-gray-300">
											<td class="py-3 font-bold text-red-700">Total Deducciones</td>
											<td class="py-3 text-right">
												<span class="font-bold text-red-600"
													>-{formatCurrency(totales.totalDeducciones)}</span
												>
												{#if totales.totalDeducciones % 1 !== 0}
													<span class="block text-[10px] text-red-300"
														>-{formatCurrencyDecimal(totales.totalDeducciones)}</span
													>
												{/if}
											</td>
										</tr>
									</tfoot>
								</table>
							</div>
						</div>

						<!-- Total a Pagar -->
						<div class="rounded-b-lg border-t border-gray-200 bg-gray-900 px-6 py-5">
							<div class="flex items-center justify-between">
								<div>
									<span class="text-sm font-bold tracking-wider text-gray-400 uppercase"
										>Total a Pagar</span
									>
									{#if totales.sueldoTotal % 1 !== 0}
										<label class="mt-2 flex cursor-pointer items-center gap-2">
											<input
												type="checkbox"
												bind:checked={redondearNetoArriba}
												class="rounded border-gray-600 bg-gray-800 text-orange-500 focus:ring-orange-500 focus:ring-offset-gray-900"
											/>
											<span class="text-[11px] text-gray-500">Aproximar hacia arriba</span>
										</label>
									{/if}
									<label class="mt-2 flex cursor-pointer items-center gap-2">
										<input
											type="checkbox"
											bind:checked={descontarPesos}
											class="rounded border-gray-600 bg-gray-800 text-red-500 focus:ring-red-500 focus:ring-offset-gray-900"
										/>
										<span class="text-[11px] text-gray-500">Descontar Pesos</span>
									</label>
									<input type="number" bind:value={pesosDescontar} />
								</div>
								<div class="text-right">
									<span class="text-3xl font-bold text-orange-400">
										{formatCurrency(
											(redondearNetoArriba
												? Math.ceil(totales.sueldoTotal)
												: Math.floor(totales.sueldoTotal)) - (descontarPesos ? pesosDescontar : 0)
										)}
									</span>
									{#if totales.sueldoTotal % 1 !== 0}
										<span class="block text-xs text-gray-500"
											>{formatCurrencyDecimal(totales.sueldoTotal)}</span
										>
									{/if}
								</div>
							</div>
						</div>
					</div>

					<!-- Estado de la liquidación -->
					<div
						class="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-5 py-4"
					>
						<div class="flex items-center gap-3">
							<div
								class="h-3 w-3 rounded-full {estadoLiquidacion === 'Liquidado'
									? 'bg-orange-500'
									: 'bg-gray-400'}"
							></div>
							<span class="text-sm font-semibold text-gray-700"
								>{estadoLiquidacion === 'Liquidado' ? 'Liquidado' : 'Pendiente'}</span
							>
						</div>
						<button
							type="button"
							on:click={() =>
								(estadoLiquidacion = estadoLiquidacion === 'Pendiente' ? 'Liquidado' : 'Pendiente')}
							class="rounded-md px-4 py-2 text-xs font-semibold tracking-wide uppercase transition-colors {estadoLiquidacion ===
							'Pendiente'
								? 'bg-orange-600 text-white hover:bg-orange-700'
								: 'bg-gray-200 text-gray-700 hover:bg-gray-300'}"
						>
							{estadoLiquidacion === 'Pendiente' ? 'Marcar Liquidada' : 'Marcar Pendiente'}
						</button>
					</div>
				</div>
			{/if}

			<!-- Botones de navegación -->
			<div class="mt-8 flex items-center justify-between border-t border-gray-200 pt-6">
				<button
					on:click={prevStep}
					disabled={currentStep === 1}
					class="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<ChevronLeft class="h-4 w-4" />
					Anterior
				</button>

				{#if currentStep === totalSteps}
					<button
						on:click={handleSubmit}
						disabled={loading}
						class="flex items-center gap-2 rounded-md bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
					>
						{#if loading}
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
							></div>
							Guardando...
						{:else}
							<Save class="h-4 w-4" />
							Guardar Liquidación
						{/if}
					</button>
				{:else}
					<button
						on:click={nextStep}
						class="flex items-center gap-2 rounded-md bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
					>
						Siguiente
						<ChevronRight class="h-4 w-4" />
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
