<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Select from 'svelte-select';
	import {
		obtenerConductores,
		obtenerVehiculos,
		obtenerEmpresas,
		obtenerConfiguraciones,
		obtenerPreviewRecargos,
		type PreviewRecargosResponse
	} from '$lib/api/nomina';
	import { bonosAPI } from '$lib/api/apiClient';
	import type { Conductor, Vehiculo, Empresa } from '$lib/types/nomina';
	import {
		ChevronLeft,
		ChevronRight,
		Save,
		Plus,
		Trash2,
		Users,
		Truck,
		DollarSign,
		Calculator
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import CalendarPernote from './CalendarPernote.svelte';
	import RecargosPreview from './RecargosPreview.svelte';
	import RecorridosSincronizadosModal from './RecorridosSincronizadosModal.svelte';

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
	let loadingPreviewRecargos = false;
	let errorPreviewRecargos = '';
	let datosInicialesCargados = false;

	// Estado del formulario
	// (Single page layout — sin steps)

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
	let isAjusteGeopark = false;

	// Ajustes de empresas para base prestacional
	let ajusteParexValor = 0;
	let ajusteGeoparkValor = 0;

	let isAjusteRecargosCompletos = false;
	let diasAjusteDeducciones: number | null = null;
	let isVacaciones = false;
	let isIncapacidad = false;
	let isCesantias = false;
	let noDescontarSalud = false;
	let noDescontarPension = false;
	let descontarSaludSalario = false;
	let descontarPensionSalario = false;
	let descontarTransporte = false;
	let redondearNetoArriba = false;
	let ajustePesos: -5 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 5 = 0;
	let estadoLiquidacion: 'Pendiente' | 'Liquidado' = 'Pendiente';

	// Períodos especiales
	let periodo_vacaciones_inicio = '';
	let valor_vacaciones = '';
	let periodo_vacaciones_fin = '';
	let periodo_incapacidad_inicio = '';
	let periodo_incapacidad_fin = '';

	// Valores financieros
	let cesantias = 0;
	let interes_cesantias = 0;
	let disponibilidad = 0;

	const MESES_NOMBRES = [
		'',
		'Enero',
		'Febrero',
		'Marzo',
		'Abril',
		'Mayo',
		'Junio',
		'Julio',
		'Agosto',
		'Septiembre',
		'Octubre',
		'Noviembre',
		'Diciembre'
	];

	interface GrupoRecargo {
		key: string;
		vehiculoId: string;
		vehiculoPlaca: string;
		mes: number;
		año: number;
		mesLabel: string;
		empresaId: string;
		empresaNombre: string;
		totalValor: number;
		pagCliente: boolean;
		porcentajePropietario: number;
	}

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
			id?: string;
			vehiculo_id: string;
			empresa_id: string;
			valor: number;
			pag_cliente: boolean;
			mes: string;
			es_override?: boolean;
			origen_planilla_id?: string | null;
			numero_planilla?: string | null;
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
		origen_planilla_id?: string | null;
	}> = [];

	// ═══════════════════════════════════════════════════════════════
	//  SINCRONIZACIÓN DE BONIFICACIONES DESDE RECORRIDOS
	//  Lee los `registro_dia_laboral_bono` persistidos (que el usuario
	//  marcó en la pestaña Recorridos de Conductores) y autocompleta
	//  los inputs de cantidad en la sección "Bonificaciones" agrupando
	//  por (config_liquidacion.nombre, vehiculo, mes).
	//
	//  Pensado como el equivalente compacto de RecargosPreview pero
	//  para bonificaciones: el usuario click "Sincronizar", se
	//  consultan los bonos en el rango del período y se rellenan las
	//  celdas matching. Después puede ajustar manualmente.
	// ═══════════════════════════════════════════════════════════════
	let sincronizandoBonos = false;
	let ultimoSyncBonosResumen: {
		items: number;
		porConfig: Array<{ nombre: string; count: number }>;
		porVehiculo: Array<{ vehiculo_id: string; count: number; placa?: string }>;
		ts: number;
	} | null = null;

	// Modal de recorridos sincronizados
	let modalRecorridosOpen = false;
	let clavesSincronizadas: Array<{ registro_dia_id: string; segmento_id: string | null }> = [];

	function abrirModalRecorridos() {
		if (!conductorSelected?.value || !periodo_inicio || !periodo_fin) {
			toast.warning('Selecciona conductor y un período antes de consultar recorridos');
			return;
		}
		modalRecorridosOpen = true;
	}

	function placaDeVehiculoId(vehiculoId: string): string | null {
		const v = vehiculos.find((x) => x.id === vehiculoId);
		return v?.placa ?? null;
	}

	function idDePlaca(placa: string): string | null {
		const v = vehiculos.find((x) => x.placa === placa);
		return v?.id ?? null;
	}

	async function sincronizarBonificacionesDesdeRecorridos() {
		if (!conductorSelected?.value || !periodo_inicio || !periodo_fin) {
			toast.warning('Selecciona conductor y un período antes de sincronizar');
			return;
		}
		if (detallesVehiculos.length === 0) {
			toast.warning('Agrega al menos un vehículo para sincronizar bonificaciones');
			return;
		}

		sincronizandoBonos = true;
		try {
			const res = await bonosAPI.listar({
				desde: periodo_inicio,
				hasta: periodo_fin,
				conductor_id: conductorSelected.value
			});
			const bonos: any[] = res.data?.data ?? [];

			// Guardar las claves (registro_dia_id, segmento_id) de los bonos
			// que se aplicaron para resaltarlas en el modal de recorridos.
			clavesSincronizadas = bonos
				.filter((b) => b.vehiculo_id && b.config_liquidacion?.nombre)
				.map((b) => ({
					registro_dia_id: b.registro_dia_id,
					segmento_id: b.segmento_id ?? null
				}));

			if (bonos.length === 0) {
				toast.info('No hay bonos persistidos en este período para este conductor.', {
					description:
					'Ve a Conductores → Recorridos y marca los bonos con checkboxes. Luego vuelve aquí y sincroniza.'
				});
				return;
			}

			// Indexar para match rápido:
			//   - por nombre de config: mapa de nombre lowercase → items
			//   - por vehiculo_id + mes → conteo
			interface Clave {
				vehiculoId: string;
				configNombre: string;
				mes: string;
			}
			const counts = new Map<string, number>();
			const porConfig = new Map<string, number>();
			const porVehiculo = new Map<string, number>();
			let itemsConsiderados = 0;

			for (const bono of bonos) {
				const configNombre = bono.config_liquidacion?.nombre?.trim();
				const vehiculoId = bono.vehiculo_id;
				const fechaStr: string | null = bono.fecha ?? null;
				if (!configNombre || !vehiculoId || !fechaStr) {
					// No se puede asociar (ej: bono sin segmento) — lo saltamos
					continue;
				}
				const fechaOnly = fechaStr.length > 10 ? fechaStr.substring(0, 10) : fechaStr;
				const mes = fechaOnly.substring(0, 7); // "YYYY-MM"
				const key = `${vehiculoId}|${configNombre.toLowerCase()}|${mes}`;
				counts.set(key, (counts.get(key) || 0) + 1);
				porConfig.set(configNombre, (porConfig.get(configNombre) || 0) + 1);
				porVehiculo.set(vehiculoId, (porVehiculo.get(vehiculoId) || 0) + 1);
				itemsConsiderados++;
			}

			if (itemsConsiderados === 0) {
				toast.info('Los bonos persistidos no tienen segmento (vehículo) o fecha asociable.', {
					description: 'Solo se sincronizan bonos vinculados a un tramo con vehículo.'
				});
				return;
			}

			// Aplicar al estado `detallesVehiculos`
			let aplicados = 0;
			const detalleNuevo = detallesVehiculos.map((detalle) => {
				const vehiculoId = detalle.vehiculo.value;
				const bonosActualizados = detalle.bonos.map((bono) => {
					const valuesActualizados = bono.values.map((val) => {
						const key = `${vehiculoId}|${bono.name.toLowerCase()}|${val.mes}`;
						const q = counts.get(key) || 0;
						if (q > 0) {
							aplicados += q;
						}
						return { ...val, quantity: q };
					});
					return { ...bono, values: valuesActualizados };
				});
				return { ...detalle, bonos: bonosActualizados };
			});

			detallesVehiculos = detalleNuevo;

			ultimoSyncBonosResumen = {
				items: itemsConsiderados,
				porConfig: Array.from(porConfig.entries())
					.sort((a, b) => b[1] - a[1])
					.map(([nombre, count]) => ({ nombre, count })),
				porVehiculo: Array.from(porVehiculo.entries())
					.sort((a, b) => b[1] - a[1])
					.map(([vehiculo_id, count]) => ({
						vehiculo_id,
						count,
						placa: placaDeVehiculoId(vehiculo_id) ?? vehiculo_id.slice(0, 6)
					})),
				ts: Date.now()
			};

			const breakdown = ultimoSyncBonosResumen.porConfig
				.slice(0, 4)
				.map((c) => `${c.nombre} ×${c.count}`)
				.join(' · ');
			toast.success(
				`✓ ${aplicados} unidad${aplicados === 1 ? '' : 'es'} sincronizada${aplicados === 1 ? '' : 's'} desde recorridos`,
				{
					description: breakdown || `${itemsConsiderados} bonos en el período`,
					duration: 5000
				}
			);
		} catch (err: any) {
			console.error('Error sincronizando bonos desde recorridos:', err);
			toast.error(err?.message || 'Error al sincronizar bonificaciones desde recorridos');
		} finally {
			sincronizandoBonos = false;
		}
	}
	/** Overrides for pagCliente/porcentajePropietario per grupo key — survives step navigation */
	let cachedGrupoOverrides: Record<string, { pagCliente: boolean; porcentajePropietario: number }> =
		{};

	// `previewRecargosGrupos` puede venir expandido (1 entrada por planilla origen)
	// para soportar upsert idempotente en backend. Para la UI, deduplicamos por
	// `key` (vehiculo + mes + empresa) para mostrar 1 fila por grupo.
	$: previewRecargosGruposDedup = (() => {
		const seen = new Set<string>();
		const out: any[] = [];
		for (const g of previewRecargosGrupos || []) {
			if (!g.key || seen.has(g.key)) continue;
			seen.add(g.key);
			out.push(g);
		}
		return out;
	})();

	// Anticipos
	let anticipos: Array<{ id: string; valor: number; fecha: string; concepto: string }> = [];
	let showAnticipoForm = false;
	let nuevoAnticipo = { valor: '', fecha: '', concepto: '' };

	// Conceptos adicionales (ajustes)
	let conceptos_adicionales: Array<{ valor: number; observaciones: string }> = [];
	let showConceptoForm = false;
	let nuevoConcepto = { valor: '', observaciones: '' };

	// Resumen móvil (toggle en pantallas pequeñas)
	let showMobileResumen = false;

	// Options para selects
	$: conductoresOptions = [...conductores]
		.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
		.map((c) => ({
			value: c.id,
			label: `${c.nombre || ''} ${c.apellido || ''}`,
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

	$: canLoad = !!(conductorSelected && periodo_inicio && periodo_fin);

	// Dispara la carga del preview de recargos de planillas cuando el formulario
	// tiene los datos mínimos (conductor + período). El `RecargosPreview` también
	// tiene su propio trigger reactivo, pero este garantiza que se dispare incluso
	// si la referencia todavía no está bindeada al primer render.
	$: if (canLoad && recargosPreviewRef && typeof recargosPreviewRef.cargarPreview === 'function') {
		recargosPreviewRef.cargarPreview();
	}

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
		isAjusteGeopark = (initialData.ajuste_geopark ?? 0) > 0;
		isAjusteRecargosCompletos = !!initialData.ajuste_parex_recargos_completos;
		diasAjusteDeducciones = initialData.dias_ajuste_deducciones ?? null;
		noDescontarSalud = (initialData.salud ?? 0) === 0;
		noDescontarPension = (initialData.pension ?? 0) === 0;
		descontarSaludSalario = !!initialData.descontar_salud_salario;
		descontarPensionSalario = !!initialData.descontar_pension_salario;
		descontarTransporte = initialData.auxilio_transporte === 0;
		isCesantias = (initialData.cesantias ?? 0) > 0 || (initialData.interes_cesantias ?? 0) > 0;
		isVacaciones = !!initialData.periodo_start_vacaciones;
		isIncapacidad = !!initialData.periodo_start_incapacidad;
		estadoLiquidacion = initialData.estado === 'Liquidado' ? 'Liquidado' : 'Pendiente';

		// Cargar valores financieros
		cesantias = initialData.cesantias || 0;
		interes_cesantias = initialData.interes_cesantias || 0;
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

		// Marcar flag para que inicializarDetallesVehiculos cargue los datos existentes
		datosInicialesCargados = false;
	}

	// Poblar detallesVehiculos con los datos existentes de la liquidación (bonos, recargos, pernotes, mantenimientos)
	function cargarDetallesVehiculosDesdeData() {
		if (!initialData || datosInicialesCargados) return;
		datosInicialesCargados = true;

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
					id: r.id, // ID de la fila de BD (necesario para revertir override)
					vehiculo_id: vehiculoId,
					empresa_id: r.empresa_id || r.clientes?.id || '',
					valor: Number(r.valor) || 0,
					pag_cliente: r.pag_cliente || false,
					mes: r.mes || '',
					es_override: !!r.es_override,
					origen_planilla_id: r.origen_planilla_id || null,
					numero_planilla: r.numero_planilla || null
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
			totalRecargosPreview = recargosAutomaticosGuardados
				.filter((r: any) => r.incluir !== false)
				.reduce((sum: number, r: any) => sum + (Number(r.valor) || 0), 0);
			// Restaurar previewRecargosGrupos. Expandir cada recargo automático
			// (1 entrada por origen_planilla_id) para que coincida con la forma
			// que emite el RecargosPreview. Dedupear por key para evitar duplicar
			// entradas en el mismo grupo al mostrar totales.
			const gruposPorKey: Record<string, any> = {};
			for (const r of recargosAutomaticosGuardados) {
				const empresaNombre =
					empresas.find((e) => e.id === (r.empresa_id || r.clientes?.id))?.nombre ||
					r.clientes?.nombre ||
					'';
				const vehiculoPlaca =
					vehiculosSelected.find((v) => v.value === r.vehiculo_id)?.label ||
					r.vehiculos?.placa ||
					'';
				const key = `${r.vehiculo_id}-${r.mes}-${r.empresa_id}`;
				if (!gruposPorKey[key]) {
					gruposPorKey[key] = {
						key,
						vehiculo_id: r.vehiculo_id || '',
						vehiculo_placa: vehiculoPlaca,
						empresa_id: r.empresa_id || r.clientes?.id || '',
						empresa_nombre: empresaNombre,
						mes: r.mes || '',
						valor: 0,
						pag_cliente: r.pag_cliente || false,
						porcentaje_propietario: Number(r.porcentaje_propietario) || 0,
						emisor: r.emisor || null,
						numero_planilla: r.numero_planilla || null,
						origen_planilla_id: r.origen_planilla_id || null,
						origenPlanillaIds: [],
						incluir: r.incluir !== false
					};
				}
				const grupo = gruposPorKey[key];
				// Sumar valor si hay varios recargos automáticos en el mismo grupo
				grupo.valor += Number(r.valor) || 0;
				// Acumular origen_planilla_id
				if (r.origen_planilla_id && !grupo.origenPlanillaIds.includes(r.origen_planilla_id)) {
					grupo.origenPlanillaIds.push(r.origen_planilla_id);
				}
			}
			previewRecargosGrupos = Object.values(gruposPorKey);
			// Rebuild overrides cache from saved data
			const overrides: Record<string, { pagCliente: boolean; porcentajePropietario: number; incluir?: boolean }> = {};
			for (const g of previewRecargosGrupos) {
				overrides[g.key] = {
					pagCliente: g.pag_cliente,
					porcentajePropietario: g.porcentaje_propietario,
					incluir: g.incluir
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

	// Garantizar que vehiculosSelected siempre sea un array.
	// svelte-select puede emitir `undefined` al hacer clear, lo que rompe
	// handleMultiItemClear internamente y los `.length` del template.
	$: if (!Array.isArray(vehiculosSelected)) {
		vehiculosSelected = [];
	}

	// Inicializar detalles de vehículos cuando cambian vehículos, meses o configuración
	$: if (
		Array.isArray(vehiculosSelected) &&
		vehiculosSelected.length > 0 &&
		mesesRange.length > 0 &&
		configuracion.length > 0
	) {
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
		if (mode === 'edit' && initialData && !datosInicialesCargados) {
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
		isAjusteGeopark,
		isAjusteRecargosCompletos,
		diasAjusteDeducciones,
		isVacaciones,
		isIncapacidad,
		isCesantias,
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
		configuracion,
		totalRecargosPreview,
		previewRecargosGrupos,
		cachedGrupoOverrides,
		previewRecargosData,
		valor_vacaciones,
		disponibilidad,
		ajustePesos
	];
	$: totales = (() => {
		void _deps;
		return calcularTotales();
	})();

	// Total a pagar: se usa en la UI y se envía al backend como sueldo_total.
	// Ya no se aplica redondeo hacia arriba: se respeta el cálculo crudo y solo se
	// permite el ajuste manual (positivo o negativo) definido por el usuario.
	$: totalAPagarVisual = Math.round(totales.sueldoTotal) + ajustePesos;

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
				ajusteGeopark: 0,
				totalRecargosParex: 0,
				totalRecargosGeopark: 0,
				interesCesantias: 0,
				disponibilidad: 0,
				sueldoBruto: 0,
				baseCalculo: 0,
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

		// Calcular recargos: solo manuales (los automáticos van por su propio canal)
		const recargosManual = detallesVehiculos.reduce((acc, detalle) => {
			return (
				acc +
				detalle.recargos.reduce((total, recargo: any) => {
					if (recargo.es_automatico) return total;
					return total + (recargo.valor || 0);
				}, 0)
			);
		}, 0);

		// Set de origen_planilla_id que tienen un override manual. Cuando un
		// automático tiene un override, el automático NO debe sumarse al total
		// (lo reemplaza el valor del manual). Esto evita doble conteo.
		const origenesConOverride = new Set<string>(
			detallesVehiculos
				.flatMap((d) => d.recargos || [])
				.filter((r: any) => r.es_override && r.origen_planilla_id)
				.map((r: any) => r.origen_planilla_id as string)
		);

		// `previewRecargosGrupos` puede venir expandido (1 entrada por cada
		// `origen_planilla_id` que compone el grupo, todas con el mismo `valor`
		// = total del grupo). Para cálculos agregados hay que deduplicar por
		// `key` antes de sumar, si no se duplica el valor del grupo.
		// Para el override, en cambio, hay que razonar a nivel de grupo: un grupo
		// se considera "completamente sobreescrito" solo si TODAS sus planillas
		// tienen override. Si al menos una planilla del grupo no está
		// sobreescrita, el grupo aporta al total (con su valor completo, ya que
		// no se almacena el desglose por planilla).
		const origenesPorGrupo: Record<string, Set<string>> = {};
		for (const g of previewRecargosGrupos || []) {
			if (!g?.key || !g.origen_planilla_id) continue;
			if (!origenesPorGrupo[g.key]) origenesPorGrupo[g.key] = new Set();
			origenesPorGrupo[g.key].add(g.origen_planilla_id);
		}
		const gruposCompletamenteOverridden = new Set<string>();
		for (const [key, set] of Object.entries(origenesPorGrupo)) {
			let allOverridden = true;
			for (const o of set) {
				if (!origenesConOverride.has(o)) {
					allOverridden = false;
					break;
				}
			}
			if (allOverridden) gruposCompletamenteOverridden.add(key);
		}

		// Solo sumar preview si está marcado para incluir. Deduplicar por key
		// para no contar N veces el mismo grupo (RecargosPreview emite 1
		// entrada por planilla origen, todas con `valor = total del grupo`).
		const seenKeys = new Set<string>();
		const recargosPreviewIncluidosCalc = (previewRecargosGrupos || [])
			.filter((g: any) => g.incluir !== false)
			.filter((g: any) => {
				// Excluir grupos completamente sobreescritos manualmente
				if (gruposCompletamenteOverridden.has(g.key)) return false;
				// Dedupe por key
				if (seenKeys.has(g.key)) return false;
				seenKeys.add(g.key);
				return true;
			})
			.reduce((acc: number, g: any) => acc + (g.valor || 0), 0);

		const totalRecargos = recargosManual + recargosPreviewIncluidosCalc;

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

		// Ajuste PAREX (se activa si está marcado el check de PAREX o el de "8% sobre recargos completos")
		let totalRecargosParex = 0;
		if (isAjusteParex || isAjusteRecargosCompletos) {
			const PAREX_EMPRESA_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';

			if (isAjusteRecargosCompletos) {
				// 8% sobre TODOS los recargos del conductor (ya sin overrides)
				ajusteParexValor = totalRecargos * 0.08;
			} else {
				const recargosManualParex = detallesVehiculos
					.flatMap((d) => d.recargos)
					.filter((r) => r.empresa_id === PAREX_EMPRESA_ID)
					.reduce((sum, r) => sum + r.valor, 0);

				let recargosPreviewParex = 0;

				if (previewRecargosGrupos?.length) {
					// Dedupe por key (cada grupo viene expandido en N entradas con
					// el mismo `valor` = total del grupo) y excluir grupos
					// completamente sobreescritos manualmente.
					const seen = new Set<string>();
					recargosPreviewParex = previewRecargosGrupos
						.filter((g: any) => g.empresa_id === PAREX_EMPRESA_ID && g.incluir !== false)
						.filter((g: any) => {
							if (gruposCompletamenteOverridden.has(g.key)) return false;
							if (seen.has(g.key)) return false;
							seen.add(g.key);
							return true;
						})
						.reduce((sum: number, g: any) => sum + (g.valor || 0), 0);
				}

				totalRecargosParex = recargosManualParex + recargosPreviewParex;

				ajusteParexValor = totalRecargosParex * 0.08;
			}
		}

		// Ajuste Geopark
		let totalRecargosGeopark = 0;
		if (isAjusteGeopark) {
			const GEOPARK_EMPRESA_ID = 'eea5eda5-1b60-45a0-b4c7-606a8c908ff9';

			// 8% solo sobre recargos de Geopark
			const recargosManualGeopark = detallesVehiculos
				.flatMap((d) => d.recargos)
				.filter((r) => r.empresa_id === GEOPARK_EMPRESA_ID)
				.reduce((sum, r) => sum + r.valor, 0);

			let recargosPreviewGeopark = 0;
			if (previewRecargosGrupos) {
				const seen = new Set<string>();
				recargosPreviewGeopark = previewRecargosGrupos
					.filter((p: any) => p.empresa_id === GEOPARK_EMPRESA_ID && p.incluir !== false)
					.filter((p: any) => {
						if (gruposCompletamenteOverridden.has(p.key)) return false;
						if (seen.has(p.key)) return false;
						seen.add(p.key);
						return true;
					})
					.reduce((sum: number, p: any) => sum + (p.valor || 0), 0);
			}

			totalRecargosGeopark = recargosManualGeopark + recargosPreviewGeopark;
			ajusteGeoparkValor = totalRecargosGeopark * 0.08;
		}

		// Valor incapacidad
		let valorIncapacidad = 0;
		if (isIncapacidad) {
			const devengado = (salarioBase / 30) * dias_laborados;
			const totalIncapacidad = salarioBase - devengado;
			valorIncapacidad = totalIncapacidad > 0 ? totalIncapacidad : 0;
		}

		// Vacaciones
		// Si el usuario digitó valor_vacaciones manualmente, ese es el que manda.
		// Si no, se calcula automáticamente desde las fechas (salarioBase / 30 × días).
		let totalVacaciones = 0;
		const valorVacacionesManual = Number(valor_vacaciones) || 0;
		if (valorVacacionesManual > 0) {
			totalVacaciones = valorVacacionesManual;
		} else if (isVacaciones && periodo_vacaciones_inicio && periodo_vacaciones_fin) {
			const inicio = new Date(periodo_vacaciones_inicio);
			const fin = new Date(periodo_vacaciones_fin);
			const diasVacaciones =
				Math.ceil((fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
			totalVacaciones = (salarioBase / 30) * diasVacaciones;
		}

		// Ajuste salarial para base prestacional y deducciones: si se especifican días,
		// solo tomar esa fracción del ajuste salarial (Villanueva). Si no, se toma completo.
		const ajusteParaBase =
			diasAjusteDeducciones !== null && diasAjusteDeducciones !== undefined
				? (bonificacionVillanueva / 30) * diasAjusteDeducciones
				: bonificacionVillanueva;

		// Total de conceptos adicionales (necesario para el IBC de la base)
		const totalAjustesAdicionales = conceptos_adicionales.reduce(
			(sum, c) => sum + c.valor,
			0
		);

		// Recargos completos de PAREX / GEOPARK a adicionar a la base prestacional.
		// Si "Ajuste PAREX recargos completos" está activo (con o sin PAREX marcado),
		// se toma el total de recargos del conductor (manual + planillas, ya sin
		// duplicados por overrides). Si no, se toman solo los recargos de la
		// empresa PAREX. Si el flag de PAREX no está activo, no se suman recargos
		// a la base por este concepto.
		const recargosAjusteParaBase =
			isAjusteParex || isAjusteRecargosCompletos
				? isAjusteRecargosCompletos
					? totalRecargos
					: totalRecargosParex
				: 0;
		const recargosGeoparkParaBase = isAjusteGeopark ? totalRecargosGeopark : 0;

		// Base de cálculo para salud y pensión (IBC).
		// Componentes incluidos cuando NO se marca "Descontar del Salario Base":
		//   - Salario devengado
		//   - Vacaciones (si aplica)
		//   - Fracción del ajuste salarial (Villanueva) según diasAjusteDeducciones
		//   - 100% de los recargos de PAREX (si isAjusteParex) o de TODOS los
		//     recargos (si isAjusteRecargosCompletos)
		//   - 100% de los recargos de Geopark (si isAjusteGeopark)
		// Auxilio de transporte, bonificaciones y conceptos adicionales NO entran
		// en la base prestacional (van al sueldo bruto pero no al IBC).
		// Si descontarSaludSalario / descontarPensionSalario está activo, la base
		// es el salario base puro (IBC reducido). Cada deducción tiene su flag
		// independiente, así que una puede usar IBC y la otra no.
		const baseCalculoSalud = descontarSaludSalario
			? salarioBase
			: salarioDevengado +
				totalVacaciones +
				ajusteParaBase +
				recargosAjusteParaBase +
				recargosGeoparkParaBase;
		const baseCalculoPension = descontarPensionSalario
			? salarioBase
			: salarioDevengado +
				totalVacaciones +
				ajusteParaBase +
				recargosAjusteParaBase +
				recargosGeoparkParaBase;
		// La "Base Prestacional" del resumen refleja la base efectiva mayor que se usa
		// (cuando algún flag está activo, se reduce al salario base del conductor)
		const baseCalculo = Math.max(baseCalculoSalud, baseCalculoPension);

		// Porcentajes de salud y pensión
		const porcentajeSalud =
			Number(configuracion.find((c) => c.nombre === 'Salud')?.valor || 0) / 100;
		const porcentajePension =
			Number(configuracion.find((c) => c.nombre === 'Pensión')?.valor || 0) / 100;

		// Deducciones (unificadas: salud y pensión ya incluyen vacaciones + ajuste salarial
		// + 100% de los recargos de PAREX/GEOPARK en la base, por lo que NO se suma
		// ningún porcentaje adicional del 8% por separado).
		const salud = noDescontarSalud ? 0 : baseCalculoSalud * porcentajeSalud;

		const pension = noDescontarPension ? 0 : baseCalculoPension * porcentajePension;

		const totalAnticipos = anticipos.reduce((sum, a) => sum + Number(a.valor), 0);

		const totalDeducciones = salud + pension + totalAnticipos;

		// Sueldo bruto
		const sueldoBruto =
			salarioDevengado +
			auxilioTransporte +
			totalBonificaciones +
			totalPernotes +
			totalRecargos +
			Number(valor_vacaciones) +
			bonificacionVillanueva +
			valorIncapacidad +
			interes_cesantias +
			totalAjustesAdicionales;

		const sueldoTotal = sueldoBruto - totalDeducciones;

		return {
			salarioDevengado,
			auxilioTransporte,
			totalBonificaciones,
			totalPernotes,
			totalRecargos,
			totalRecargosParex,
			totalRecargosGeopark,
			totalVacaciones,
			bonificacionVillanueva,
			valorIncapacidad,
			ajusteParex: ajusteParexValor,
			ajusteGeopark: ajusteGeoparkValor,
			interesCesantias: interes_cesantias,
			disponibilidad,
			sueldoBruto,
			baseCalculo,
			salud,
			pension,
			totalAnticipos,
			totalAjustesAdicionales,
			totalDeducciones,
			sueldoTotal
		};
	}

	// Navegación
	// (Single page layout — sin navegación entre steps)

	// Validación
	function validarFormulario(): boolean {
		if (!conductorSelected) {
			toast.error('Seleccione un conductor');
			return false;
		}
		if (!periodo_inicio || !periodo_fin) {
			toast.error('Ingrese las fechas del período');
			return false;
		}
		return true;
	}

	// Envío del formulario
	async function handleSubmit() {
		if (!validarFormulario()) return;

		// Defensa en profundidad: limpiar recargos automáticos que se hayan colado
		// en detalle.recargos (deberían ir solo en recargos_preview).
		const detallesLimpios = detallesVehiculos.map((d: any) => ({
			...d,
			recargos: (d.recargos || []).filter((r: any) => !r.es_automatico)
		}));

		// Solo enviar los grupos de preview marcados con incluir !== false
		const recargosPreviewIncluidos = (previewRecargosGrupos || []).filter(
			(g: any) => g.incluir !== false
		);

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
			ajuste_geopark: isAjusteGeopark,
			ajuste_parex_valor: totales.ajusteParex,
			ajuste_por_dia_flag: isAjustePorDia,
			ajuste_parex_recargos_completos: isAjusteRecargosCompletos,
			dias_ajuste_deducciones: diasAjusteDeducciones,
			descontar_salud_salario: descontarSaludSalario,
			descontar_pension_salario: descontarPensionSalario,
			auxilio_transporte: totales.auxilioTransporte,
			sueldo_total: totalAPagarVisual,
			salario_base: totales.salarioDevengado,
			total_pernotes: totales.totalPernotes,
			total_bonificaciones: totales.totalBonificaciones,
			total_recargos: totales.totalRecargos,
			total_vacaciones: Number(valor_vacaciones),
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
			estado: estadoLiquidacion,
			vehiculos: vehiculosSelected.map((v) => v.value),
			detalles_vehiculos: detallesLimpios,
			anticipos,
			conceptos_adicionales,
			recargos_preview: recargosPreviewIncluidos
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

	function formatCurrencyFloor(amount: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(Math.floor(amount));
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

	function formatMes(mes: string | number): string {
		if (typeof mes !== 'string') {
			console.warn('mes inválido:', mes);
			return '';
		}

		const [year, month] = mes.split('-');

		const date = new Date(parseInt(year), parseInt(month) - 1);

		return date.toLocaleDateString('es-CO', {
			month: 'short',
			year: 'numeric'
		});
	}

	function handleRecargosCalculated(event: CustomEvent) {
		const { totalRecargos, detalle, grupos } = event.detail;
		totalRecargosPreview = totalRecargos;
		previewRecargosData = detalle;
		// `grupos` puede venir expandido (1 entrada por planilla origen) para
		// permitir upsert idempotente. Lo guardamos tal cual para enviar al backend.
		previewRecargosGrupos = grupos || [];
		// Cache per-grupo overrides (deduplicado por key) para que sobrevivan al
		// re-mount del componente cuando el usuario navega entre steps.
		const overrides: Record<
			string,
			{ pagCliente: boolean; porcentajePropietario: number; incluir?: boolean }
		> = {};
		const seen = new Set<string>();
		for (const g of previewRecargosGrupos) {
			if (seen.has(g.key)) continue;
			seen.add(g.key);
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
			<div class="spinner mx-auto"></div>
			<p class="mt-3 text-sm text-[var(--text-muted)]">Cargando datos...</p>
		</div>
	</div>
{:else}
	<div class="mx-auto px-4 py-6">
		<!-- Header -->
		<div class="mb-5 flex items-center justify-between">
			<div class="flex items-center gap-4">
				<button
					on:click={() => window.history.back()}
					class="apple-transition flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-default)] bg-white text-[var(--text-muted)] hover:border-[var(--border-emphasis)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
				>
					<ChevronLeft class="h-4 w-4" />
				</button>
				<div>
					<span class="eyebrow">Liquidaciones · {mode === 'create' ? 'Nueva' : 'Editar'}</span>
					<h1 class="font-display mt-1 text-2xl font-normal tracking-tight text-[var(--text-primary)]">
						{mode === 'create' ? 'Nueva Liquidación' : 'Editar Liquidación'}
					</h1>
				</div>
			</div>
		</div>

		<!-- Layout 2 columnas: form (izq) + resumen sticky (der) -->
		<div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_500px]">
			<!-- COLUMNA IZQUIERDA: Formulario -->
			<div class="space-y-5 min-w-0">
				<!-- Sección: Período y Conductor -->
				<div class="rounded-xl border border-[var(--border-subtle)] bg-white p-5 shadow-[var(--shadow-card)]">
				<!-- PASO 1: Información Básica -->
				<div class="space-y-5">
					<h2 class="flex items-center gap-2 font-display text-base font-medium text-[var(--text-primary)]">
						<Users class="h-4 w-4 text-[var(--emerald-600)]" />
						Información Básica
					</h2>

					<!-- Conductor -->
					<div>
						<label
							for="conductor-select"
							class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
						>
							Conductor <span class="text-[#DC2626]">*</span>
						</label>
						<div id="conductor-select">
							<Select
								items={conductoresOptions}
								bind:value={conductorSelected}
								placeholder="Buscar conductor..."
								searchable={true}
								clearable={false}
								--border-radius="0.625rem"
								--border="1px solid var(--border-default)"
								--border-focused="1px solid var(--emerald-500)"
								--border-hover="1px solid var(--border-emphasis)"
								--padding="0.65rem 0.85rem"
								--height="42px"
							/>
						</div>
					</div>

					<!-- Fechas -->
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label
								for="periodo_inicio"
								class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
							>
								Fecha Inicio <span class="text-[#DC2626]">*</span>
							</label>
							<input
								id="periodo_inicio"
								type="date"
								bind:value={periodo_inicio}
								required
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							/>
						</div>
						<div>
							<label
								for="periodo_fin"
								class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
							>
								Fecha Fin <span class="text-[#DC2626]">*</span>
							</label>
							<input
								id="periodo_fin"
								type="date"
								bind:value={periodo_fin}
								required
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							/>
						</div>
					</div>

					<!-- Vehículos: el selector de vehículos ahora vive en la sección
					     "Vehículos y Detalles" para evitar loops de bind:value duplicado. -->

					<!-- Días laborados -->
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label
								for="dias_laborados"
								class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
								>Días Totales</label
							>
							<input
								id="dias_laborados"
								type="number"
								bind:value={dias_laborados}
								min="0"
								max="31"
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							/>
						</div>
						<div>
							<label
								for="dias_laborados_villanueva"
								class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
								>Días Ajuste Salarial</label
							>
							<input
								id="dias_laborados_villanueva"
								type="number"
								bind:value={dias_laborados_villanueva}
								min="0"
								max="31"
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							/>
						</div>
					</div>
				</div>
				</div>
				<!-- /Sección: Período y Conductor -->

				<!-- Sección: Vehículos y Detalles -->
				<div class="rounded-xl border border-[var(--border-subtle)] bg-white p-5 shadow-[var(--shadow-card)]">
					<div class="mb-4 flex items-start justify-between gap-3">
						<div class="flex items-center gap-2">
							<div class="card-icon-sm">
								<Truck class="h-4 w-4 text-white" />
							</div>
							<div>
								<h2 class="font-display text-base font-medium text-[var(--text-primary)]">
									Vehículos y Detalles
								</h2>
								<p class="font-mono-meta text-[0.6rem] text-[var(--text-muted)]">
									Bonificaciones · Mantenimientos · Pernotes · Recargos
								</p>
							</div>
						</div>
						<!-- Botones: consulta y sincronización de bonificaciones desde recorridos -->
						<div class="flex items-center gap-1.5">
							<!-- Consultar recorridos (modal general, no auto-abre) -->
							<button
								type="button"
								on:click={abrirModalRecorridos}
								disabled={!conductorSelected?.value || !periodo_inicio || !periodo_fin}
								class="apple-transition flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-60"
								title={!conductorSelected?.value
									? 'Selecciona un conductor primero'
									: !periodo_inicio || !periodo_fin
										? 'Define el período'
										: 'Ver los recorridos del conductor en el período'}
							>
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
								</svg>
								Consultar recorridos
							</button>
							<!-- Sincronizar bonificaciones desde recorridos -->
							<button
								type="button"
								on:click={sincronizarBonificacionesDesdeRecorridos}
								disabled={sincronizandoBonos ||
									!conductorSelected?.value ||
									!periodo_inicio ||
									!periodo_fin ||
									detallesVehiculos.length === 0}
								class="apple-transition flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
								style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; border-color: transparent;"
								title={!conductorSelected?.value
									? 'Selecciona un conductor primero'
									: !periodo_inicio || !periodo_fin
										? 'Define el período'
										: detallesVehiculos.length === 0
											? 'Agrega al menos un vehículo'
											: 'Sincroniza las bonificaciones marcadas en la pestaña Recorridos de Conductores'}
							>
								{#if sincronizandoBonos}
									<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
										<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
										<path d="M4 12a8 8 0 018-8v0" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
									</svg>
									Sincronizando…
								{:else}
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
									</svg>
									Sincronizar desde recorridos
								{/if}
							</button>
						</div>
					</div>

					<!-- Resumen del último sync (transitorio) -->
					{#if ultimoSyncBonosResumen && ultimoSyncBonosResumen.items > 0}
						<div
							class="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200/60 bg-indigo-50/60 px-3 py-2 text-[11px]"
							style="color: #3730a3;"
						>
							<svg class="h-3.5 w-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
							</svg>
							<span class="font-semibold">
								Sincronización: {ultimoSyncBonosResumen.items} bono{ultimoSyncBonosResumen.items === 1 ? '' : 's'} aplicado{ultimoSyncBonosResumen.items === 1 ? '' : 's'}
							</span>
							<span class="text-indigo-700/70">·</span>
							{#each ultimoSyncBonosResumen.porConfig.slice(0, 4) as item (item.nombre)}
								<span
									class="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold"
								>
									{item.nombre} <span class="text-indigo-600">×{item.count}</span>
								</span>
							{/each}
							{#if ultimoSyncBonosResumen.porVehiculo.length > 1}
								<span class="text-indigo-700/70">·</span>
								<span class="text-[10px] text-indigo-700/80">
									en {ultimoSyncBonosResumen.porVehiculo.map((v) => v.placa ?? v.vehiculo_id.slice(0, 6)).join(', ')}
								</span>
							{/if}
						</div>
					{/if}

					<!-- Selector de vehículos -->
					<div class="mb-4">
						<span class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]">
							Vehículos
						</span>
						<Select
							items={vehiculosOptions}
							bind:value={vehiculosSelected}
							multiple={true}
							placeholder="Buscar vehículos..."
							searchable={true}
							clearable={true}
							on:change={(e) => {
								// Normalizar siempre a array (svelte-select a veces emite undefined
								// desde handleMultiItemClear cuando se remueve el último chip).
								// NO usamos on:clear porque svelte-select v5 lo dispara también
								// al remover UN SOLO chip (no solo al limpiar todo), lo que
								// vaciaría la selección completa en lugar de solo ese item.
								vehiculosSelected = Array.isArray(e.detail) ? e.detail : [];
							}}
							--border-radius="0.5rem"
							--border="1px solid var(--border-default)"
							--border-focused="1px solid var(--emerald-500)"
							--border-hover="1px solid var(--border-emphasis)"
							--padding="0.5rem 0.75rem"
							--multi-item-bg="rgba(249,115,22,0.10)"
							--multi-item-color="var(--emerald-700)"
							--multi-item-clear-icon-color="var(--text-muted)"
						/>
						<p class="mt-1 text-xs text-[var(--text-very-muted)]">Opcional — para bonificaciones o recargos</p>
					</div>

					{#if !Array.isArray(vehiculosSelected) || vehiculosSelected.length === 0}
						<div class="rounded-xl border border-dashed border-[var(--border-default)] py-10 text-center">
							<p class="text-sm text-[var(--text-very-muted)]">
								Sin vehículos seleccionados. Agregue vehículos arriba si aplica.
							</p>
						</div>
					{:else}
						{#each detallesVehiculos as detalle, idx (detalle.vehiculo.value)}
							<div class="rounded-xl border border-[var(--border-subtle)]">
								<div
									class="flex items-center gap-2 rounded-t-xl border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3"
								>
									<Truck class="h-4 w-4 text-[var(--text-muted)]" />
									<h3 class="text-sm font-semibold text-[var(--text-primary)]">
										{detalle.vehiculo.label}
									</h3>
								</div>
								<div class="space-y-4 p-4">
									<!-- Bonificaciones -->
									{#if detalle.bonos.length > 0}
										<div>
											<h4 class="font-mono-meta mb-2 text-[0.65rem] text-[var(--text-muted)]">
												Bonificaciones
											</h4>
											<div
												class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
											>
												{#each detalle.bonos as bono}
													<div
														class="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
													>
														<div class="mb-1.5">
															<span class="block text-xs font-medium text-[var(--text-primary)]"
																>{bono.name}</span
															>
															<span class="text-[11px] text-[var(--text-very-muted)]"
																>{formatCurrency(bono.value)} / u</span
															>
														</div>
														<div class="space-y-1.5">
															{#each bono.values as val}
																<div>
																	<span
																		class="font-mono-meta mb-0.5 block text-[0.6rem] text-[var(--text-muted)]"
																		>{formatMes(val.mes)}</span
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
																		class="input-glow w-full rounded-lg border border-[var(--border-default)] bg-white px-2 py-1 text-sm"
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
											<h4 class="font-mono-meta mb-2 text-[0.65rem] text-[var(--text-muted)]">
												Mantenimientos
											</h4>
											{#each detalle.mantenimientos as mant}
												<div
													class="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
												>
													<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
														{#each mant.values as val}
															<div>
																<span
																	class="font-mono-meta mb-0.5 block text-[0.6rem] text-[var(--text-muted)]"
																	>{formatMes(val.mes)}</span
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
																	class="input-glow w-full rounded-lg border border-[var(--border-default)] bg-white px-2 py-1 text-sm"
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
										<div class="section-header">
											<span class="section-header-label">
												<span class="section-header-dot" aria-hidden="true"></span>
												Pernotes
												{#if detalle.pernotes.length > 0}
													<span class="section-header-count">{detalle.pernotes.length}</span>
												{/if}
											</span>
											<button
												on:click={() => handleAddPernote(detalle.vehiculo.value)}
												class="help-btn"
											>
												<Plus />
												Agregar
											</button>
										</div>
										{#if detalle.pernotes.length > 0}
											<div class="space-y-2">
												{#each detalle.pernotes as pernote, pIdx}
													<div class="item-card">
														<div class="item-card-header">
															<span class="item-card-tag">
																<span class="item-card-tag-dot" aria-hidden="true"></span>
																Pernote #{pIdx + 1}
															</span>
															<button
																on:click={() => handleRemovePernote(detalle.vehiculo.value, pIdx)}
																class="item-card-remove"
																aria-label="Eliminar pernote"
															>
																<Trash2 />
															</button>
														</div>
														<div class="mb-2">
															<span
																class="font-mono-meta mb-0.5 block text-[0.6rem] text-[var(--text-muted)]"
																>Empresa</span
															>
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
																--border-radius="0.5rem"
																--font-size="0.875rem"
																--height="36px"
																--border="1px solid var(--border-default)"
																--border-focused="1px solid var(--emerald-500)"
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
														<div class="item-card-summary">
															<span class="item-card-summary-label">
																{pernote.cantidad} día{pernote.cantidad !== 1 ? 's' : ''} × {formatCurrency(
																	pernote.valor
																)}
															</span>
															<span class="item-card-summary-value">
																{formatCurrency(pernote.cantidad * pernote.valor)}
															</span>
														</div>
													</div>
												{/each}
											</div>
										{:else}
											<p
												class="rounded-lg border border-dashed border-[var(--border-subtle)] py-2.5 text-center text-xs text-[var(--text-very-muted)]"
											>
												Sin pernotes
											</p>
										{/if}
									</div>

									<!-- Recargos -->
									<div>
										<div class="section-header">
											<span class="section-header-label">
												<span class="section-header-dot" aria-hidden="true"></span>
												Recargos
												{#if detalle.recargos.length > 0}
													<span class="section-header-count">{detalle.recargos.length}</span>
												{/if}
											</span>
											<button
												on:click={() => handleAddRecargo(detalle.vehiculo.value)}
												class="help-btn"
											>
												<Plus />
												Agregar
											</button>
										</div>
										{#if detalle.recargos.length > 0}
											<div class="space-y-2">
												{#each detalle.recargos as recargo, rIdx}
													<div class="item-card" style:border-color={recargo.es_override ? 'rgba(245, 158, 11, 0.30)' : ''}>
														<div class="item-card-header">
															<span class="item-card-tag" style:background-color={recargo.es_override ? 'rgba(245, 158, 11, 0.10)' : ''} style:color={recargo.es_override ? '#92400E' : ''}>
																<span class="item-card-tag-dot" aria-hidden="true" style:background-color={recargo.es_override ? '#F59E0B' : ''} style:box-shadow={recargo.es_override ? '0 0 0 2px rgba(245, 158, 11, 0.18)' : ''}></span>
																Recargo #{rIdx + 1}
																{#if recargo.es_override}
																	<span
																		class="ml-1 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800"
																		title="Este recargo sobreescribe un automático de planilla. Elimínalo para revertir."
																	>
																		<svg
																			class="h-2.5 w-2.5"
																			fill="none"
																			stroke="currentColor"
																			viewBox="0 0 24 24"
																			stroke-width="2.5"
																		>
																			<path
																				stroke-linecap="round"
																				stroke-linejoin="round"
																				d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
																			/>
																		</svg>
																		Override
																	</span>
																{/if}
															</span>
															<button
																on:click={() => handleRemoveRecargo(detalle.vehiculo.value, rIdx)}
																class="item-card-remove"
																aria-label="Eliminar recargo"
															>
																<Trash2 />
															</button>
														</div>
														<div class="grid grid-cols-3 gap-2">
															<div>
																<span
																	class="font-mono-meta mb-0.5 block text-[0.6rem] text-[var(--text-muted)]"
																	>Empresa</span
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
																	--border-radius="0.5rem"
																	--font-size="0.875rem"
																	--height="36px"
																	--border="1px solid var(--border-default)"
																	--border-focused="1px solid var(--emerald-500)"
																/>
															</div>
															<div>
																<label
																	for="recargo-mes-{detalle.vehiculo.value}-{rIdx}"
																	class="font-mono-meta mb-0.5 block text-[0.6rem] text-[var(--text-muted)]"
																	>Mes</label
																>
																<select
																	id="recargo-mes-{detalle.vehiculo.value}-{rIdx}"
																	value={recargo.mes}
																	on:change={(e) =>
																		handleRecargoChange(
																			detalle.vehiculo.value,
																			rIdx,
																			'mes',
																			e.currentTarget.value
																		)}
																	class="input-glow w-full rounded-lg border border-[var(--border-default)] bg-white px-2 py-1.5 text-sm"
																>
																	{#each mesesRange as mes}
																		<option value={mes}>{formatMes(mes)}</option>
																	{/each}
																</select>
															</div>
															<div>
																<label
																	for="recargo-valor-{detalle.vehiculo.value}-{rIdx}"
																	class="font-mono-meta mb-0.5 block text-[0.6rem] text-[var(--text-muted)]"
																	>Valor</label
																>
																<input
																	id="recargo-valor-{detalle.vehiculo.value}-{rIdx}"
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
																	class="input-glow w-full rounded-lg border border-[var(--border-default)] bg-white px-2 py-1.5 text-sm"
																/>
															</div>
														</div>
														<div class="mt-2">
															<label class="flex items-center text-xs text-[var(--text-muted)]">
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
																	class="mr-1.5 h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
																/>
																Pagado por cliente
															</label>
														</div>
													</div>
												{/each}
											</div>
										{:else}
											<p class="text-xs text-[var(--text-very-muted)]">Sin recargos</p>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					{/if}

					<!-- Recargos Calculados desde Planillas -->
					<div class="mt-4">
						<RecargosPreview
							bind:this={recargosPreviewRef}
							conductorId={conductorSelected?.value || ''}
							periodoInicio={periodo_inicio}
							periodoFin={periodo_fin}
							cachedPreviewData={previewRecargosData}
							{cachedGrupoOverrides}
							recargosExistentes={initialData?.recargos || []}
							on:recargosCalculated={handleRecargosCalculated}
						/>
					</div>
				</div>
				<!-- /Sección: Vehículos y Detalles -->

				<!-- Sección: Ajustes y Períodos Especiales -->
				<div
					class="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-white p-5 shadow-[var(--shadow-card)]"
				>
					<div class="mb-4 flex items-center gap-2">
						<div class="card-icon-sm">
							<Calculator class="h-4 w-4 text-white" />
						</div>
						<div>
							<h2 class="font-display text-base font-medium text-[var(--text-primary)]">
								Ajustes y Períodos Especiales
							</h2>
							<p class="font-mono-meta text-[0.6rem] text-[var(--text-muted)]">
								Opciones de cálculo · Vacaciones · Incapacidad · Cesantías
							</p>
						</div>
					</div>

					<!-- Opciones booleanas -->
					<div class="rounded-xl border border-[var(--border-subtle)] p-4">
						<h3 class="font-mono-meta mb-3 text-[0.65rem] text-[var(--text-muted)]">
							Opciones
						</h3>
						<div class="grid grid-cols-2 gap-x-6 gap-y-2 lg:grid-cols-3">
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={isCheckedAjuste}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
								/>
								Ajuste Salarial
							</label>
							{#if isCheckedAjuste}
								<label
									class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
								>
									<input
										type="checkbox"
										bind:checked={isAjustePorDia}
										class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
									/>
									Ajuste por Día
								</label>
							{/if}
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={isAjusteGeopark}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[#2563EB]"
								/>
								Ajuste GEOPARK
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={isAjusteParex}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
								/>
								Ajuste PAREX
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={isAjusteRecargosCompletos}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
								/>
								8% sobre recargos completos
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={isVacaciones}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
								/>
								Vacaciones
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={isIncapacidad}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
								/>
								Incapacidad
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={isCesantias}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
								/>
								Pagar Cesantías
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={noDescontarSalud}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[#DC2626]"
								/>
								No Descontar Salud
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={noDescontarPension}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[#DC2626]"
								/>
								No Descontar Pensión
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={descontarSaludSalario}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[#DC2626]"
								/>
								Descontar Salud del Salario Base
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={descontarPensionSalario}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[#DC2626]"
								/>
								Descontar Pensión del Salario Base
							</label>
							<label
								class="flex cursor-pointer items-center gap-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							>
								<input
									type="checkbox"
									bind:checked={descontarTransporte}
									class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[#DC2626]"
								/>
								Descontar Transporte
							</label>
						</div>
					</div>

					<!-- Días ajuste para deducciones -->
					{#if isCheckedAjuste}
						<div class="rounded-xl border border-[var(--border-subtle)] p-4">
							<h3 class="font-mono-meta mb-3 text-[0.65rem] text-[var(--text-muted)]">
								Deducciones del Ajuste Salarial
							</h3>
							<div class="flex items-center gap-4">
								<span class="text-sm text-[var(--text-secondary)]"
									>Días del ajuste a tomar para deducciones:</span
								>
								<input
									type="number"
									min="0"
									max="30"
									bind:value={diasAjusteDeducciones}
									placeholder="Todos"
									class="input-glow w-24 rounded-xl border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm"
								/>
								<span class="text-xs text-[var(--text-very-muted)]">
									{#if diasAjusteDeducciones !== null && diasAjusteDeducciones !== undefined}
										(Ajuste: {formatCurrency(
											(configuracion.find((c) => c.nombre === 'Salario villanueva')?.valor || 0) -
												totales.salarioDevengado
										)}/30 × {diasAjusteDeducciones})
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
							<label
								for="disponibilidad"
								class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
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
								class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
							/>
						</div>
						<div class="flex items-end pb-2">
							{#if disponibilidad > 0}
								<span class="text-xs text-[var(--text-very-muted)]">Con disponibilidad </span>
							{:else}
								<span class="text-xs text-[var(--text-very-muted)]">Sin disponibilidad</span>
							{/if}
						</div>
					</div>

					<!-- Períodos especiales -->
					{#if isVacaciones}
						<div class="rounded-xl border border-[var(--border-subtle)] p-4">
							<h4 class="font-mono-meta mb-3 text-[0.65rem] text-[var(--text-muted)]">
								Vacaciones
							</h4>
							<div class="grid grid-cols-3 gap-4">
								<div>
									<label
										for="valor_vacaciones"
										class="font-mono-meta mb-1.5 block text-[0.6rem] text-[var(--text-muted)]"
										>Valor Vacaciones</label
									>
									<input
										id="valor_vacaciones"
										placeholder={`Sugerido: ${formatCurrency(totales.totalVacaciones)}`}
										type="text"
										inputmode="numeric"
										value={valor_vacaciones ? '$ ' + formatCOPInput(Number(valor_vacaciones)) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) =>
											(valor_vacaciones = String(parseCOPInput(e.currentTarget.value)))}
										class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
									/>
								</div>
								<div>
									<label
										for="periodo_vacaciones_inicio"
										class="font-mono-meta mb-1.5 block text-[0.6rem] text-[var(--text-muted)]"
										>Fecha Inicio</label
									>
									<input
										id="periodo_vacaciones_inicio"
										type="date"
										bind:value={periodo_vacaciones_inicio}
										class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
									/>
								</div>
								<div>
									<label
										for="periodo_vacaciones_fin"
										class="font-mono-meta mb-1.5 block text-[0.6rem] text-[var(--text-muted)]"
										>Fecha Fin</label
									>
									<input
										id="periodo_vacaciones_fin"
										type="date"
										bind:value={periodo_vacaciones_fin}
										class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
									/>
								</div>
							</div>
						</div>
					{/if}

					{#if isIncapacidad}
						<div class="rounded-xl border border-[var(--border-subtle)] p-4">
							<h4 class="font-mono-meta mb-3 text-[0.65rem] text-[var(--text-muted)]">
								Incapacidad
							</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label
										for="periodo_incapacidad_inicio"
										class="font-mono-meta mb-1.5 block text-[0.6rem] text-[var(--text-muted)]"
										>Fecha Inicio</label
									>
									<input
										id="periodo_incapacidad_inicio"
										type="date"
										bind:value={periodo_incapacidad_inicio}
										class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
									/>
								</div>
								<div>
									<label
										for="periodo_incapacidad_fin"
										class="font-mono-meta mb-1.5 block text-[0.6rem] text-[var(--text-muted)]"
										>Fecha Fin</label
									>
									<input
										id="periodo_incapacidad_fin"
										type="date"
										bind:value={periodo_incapacidad_fin}
										class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Cesantías -->
					{#if isCesantias}
						<div class="rounded-xl border border-[var(--border-subtle)] p-4">
							<h4 class="font-mono-meta mb-3 text-[0.65rem] text-[var(--text-muted)]">
								Cesantías e Intereses
							</h4>
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label
										for="cesantias"
										class="font-mono-meta mb-1.5 block text-[0.6rem] text-[var(--text-muted)]"
										>Cesantías</label
									>
									<input
										id="cesantias"
										type="text"
										inputmode="numeric"
										placeholder="$ 0"
										value={cesantias ? '$ ' + formatCOPInput(cesantias) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) => (cesantias = parseCOPInput(e.currentTarget.value))}
										class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
									/>
								</div>
								<div>
									<label
										for="interes_cesantias"
										class="font-mono-meta mb-1.5 block text-[0.6rem] text-[var(--text-muted)]"
										>Interés Cesantías</label
									>
									<input
										id="interes_cesantias"
										type="text"
										inputmode="numeric"
										placeholder="$ 0"
										value={interes_cesantias ? '$ ' + formatCOPInput(interes_cesantias) : ''}
										on:focus={handleCOPFocus}
										on:blur={handleCOPBlur}
										on:input={(e) => (interes_cesantias = parseCOPInput(e.currentTarget.value))}
										class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
									/>
								</div>
							</div>
						</div>
					{/if}

					<!-- Anticipos -->
					<div class="rounded-xl border border-[var(--border-subtle)] p-4">
						<div class="mb-3 flex items-center justify-between">
							<h3 class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">Anticipos</h3>
							<button
								on:click={() => (showAnticipoForm = !showAnticipoForm)}
								class="help-btn apple-transition"
							>
								<Plus class="h-3 w-3" />
								Agregar
							</button>
						</div>

						{#if showAnticipoForm}
							<div
								class="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
							>
								<div class="grid grid-cols-3 gap-3">
									<div>
										<label
											for="nuevo-anticipo-valor"
											class="font-mono-meta mb-1 block text-[0.6rem] text-[var(--text-muted)]"
											>Valor</label
										>
										<input
											id="nuevo-anticipo-valor"
											placeholder="$ 0"
											type="text"
											inputmode="numeric"
											value={nuevoAnticipo.valor
												? '$ ' + formatCOPInput(Number(nuevoAnticipo.valor))
												: ''}
											on:focus={handleCOPFocus}
											on:blur={handleCOPBlur}
											on:input={(e) =>
												(nuevoAnticipo.valor = String(parseCOPInput(e.currentTarget.value)))}
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm"
										/>
									</div>
									<div>
										<label
											for="nuevo-anticipo-fecha"
											class="font-mono-meta mb-1 block text-[0.6rem] text-[var(--text-muted)]"
											>Fecha</label
										>
										<input
											id="nuevo-anticipo-fecha"
											type="date"
											bind:value={nuevoAnticipo.fecha}
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm"
										/>
									</div>
									<div>
										<label
											for="nuevo-anticipo-concepto"
											class="font-mono-meta mb-1 block text-[0.6rem] text-[var(--text-muted)]"
											>Concepto</label
										>
										<input
											id="nuevo-anticipo-concepto"
											type="text"
											bind:value={nuevoAnticipo.concepto}
											placeholder="Opcional"
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm"
										/>
									</div>
								</div>
								<div class="mt-3 flex gap-2">
									<button
										on:click={agregarAnticipo}
										class="btn-primary apple-transition"
									>
										Agregar
									</button>
									<button
										on:click={() => (showAnticipoForm = false)}
										class="btn-secondary apple-transition"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if anticipos.length > 0}
							<div class="space-y-1">
								{#each anticipos as anticipo (anticipo.id)}
									<div
										class="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2"
									>
										<div>
											<span class="text-sm font-semibold text-[var(--text-primary)]"
												>{formatCurrency(anticipo.valor)}</span
											>
											<span class="ml-2 text-xs text-[var(--text-very-muted)]">
												{new Date(anticipo.fecha).toLocaleDateString('es-CO')}
												{#if anticipo.concepto}
													· {anticipo.concepto}{/if}
											</span>
										</div>
										<button
											on:click={() => eliminarAnticipo(anticipo.id)}
											class="apple-transition rounded-lg p-1 text-[#DC2626] hover:bg-[rgba(220,38,38,0.08)]"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-[var(--text-very-muted)]">Sin anticipos</p>
						{/if}
					</div>

					<!-- Conceptos adicionales -->
					<div class="rounded-xl border border-[var(--border-subtle)] p-4">
						<div class="mb-3 flex items-center justify-between">
							<h3 class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
								Conceptos Adicionales
							</h3>
							<button
								on:click={() => (showConceptoForm = !showConceptoForm)}
								class="help-btn apple-transition"
							>
								<Plus class="h-3 w-3" />
								Agregar
							</button>
						</div>

						{#if showConceptoForm}
							<div
								class="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
							>
								<div class="grid grid-cols-2 gap-3">
									<div>
										<label
											for="nuevo-concepto-valor"
											class="font-mono-meta mb-1 block text-[0.6rem] text-[var(--text-muted)]"
											>Valor</label
										>
										<input
											id="nuevo-concepto-valor"
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
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm"
										/>
									</div>
									<div>
										<label
											for="nuevo-concepto-observaciones"
											class="font-mono-meta mb-1 block text-[0.6rem] text-[var(--text-muted)]"
											>Observaciones</label
										>
										<input
											id="nuevo-concepto-observaciones"
											type="text"
											bind:value={nuevoConcepto.observaciones}
											placeholder="Descripción"
											class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-1.5 text-sm"
										/>
									</div>
								</div>
								<div class="mt-3 flex gap-2">
									<button
										on:click={agregarConcepto}
										class="btn-primary apple-transition"
									>
										Agregar
									</button>
									<button
										on:click={() => (showConceptoForm = false)}
										class="btn-secondary apple-transition"
									>
										Cancelar
									</button>
								</div>
							</div>
						{/if}

						{#if conceptos_adicionales.length > 0}
							<div class="space-y-1">
								{#each conceptos_adicionales as concepto, idx}
									<div
										class="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2"
									>
										<div>
											<span
												class="text-sm font-semibold {concepto.valor > 0
													? 'text-[var(--emerald-700)]'
													: 'text-[#DC2626]'}">{formatCurrency(concepto.valor)}</span
											>
											<span class="ml-2 text-xs text-[var(--text-very-muted)]"
												>{concepto.observaciones}</span
											>
										</div>
										<button
											on:click={() => eliminarConcepto(idx)}
											class="apple-transition rounded-lg p-1 text-[#DC2626] hover:bg-[rgba(220,38,38,0.08)]"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-xs text-[var(--text-very-muted)]">Sin conceptos adicionales</p>
						{/if}
					</div>

					<!-- Detalle de Bonificaciones por Vehículo y Período -->
					{#if detallesVehiculos.length > 0}
						<div class="rounded-xl border border-[var(--border-subtle)]">
							<div
								class="rounded-t-xl border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-2.5"
							>
								<h3 class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
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
											<p class="mb-2 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
												{detalle.vehiculo.label}
											</p>
											<div class="overflow-x-auto">
												<table class="w-full text-xs">
													<thead>
														<tr class="table-header">
															<th class="py-1.5 text-left">Bonificación</th>
															<th class="py-1.5 text-right">V. Unit.</th>
															{#each mesesRange as mes}
																<th class="py-1.5 text-center">{formatMes(mes)}</th>
															{/each}
															<th class="py-2 text-right text-[var(--text-secondary)]">
																Subtotal
															</th>
														</tr>
													</thead>
													<tbody class="divide-y divide-[var(--border-subtle)]">
														{#each bonosConCantidad as bono}
															{@const subtotal = bono.values.reduce(
																(s, v) => s + v.quantity * bono.value,
																0
															)}
															<tr>
																<td class="py-2 text-[var(--text-primary)]">{bono.name}</td>
																<td class="py-1.5 text-right text-[var(--text-secondary)]"
																	>{formatCurrency(bono.value)}</td
																>
																{#each bono.values as val}
																	<td
																		class="py-1.5 text-center {val.quantity > 0
																			? 'font-semibold text-[var(--text-primary)]'
																			: 'text-[var(--text-very-muted)]'}">{val.quantity}</td
																	>
																{/each}
																<td
																	class="py-1.5 text-right font-semibold text-[var(--emerald-700)]"
																	>{formatCurrency(subtotal)}</td
																>
															</tr>
														{/each}
													</tbody>
													<tfoot>
														<tr class="border-t border-[var(--border-emphasis)]">
															<td
																colspan={2 + mesesRange.length}
																class="py-1.5 text-right font-mono-meta text-[0.65rem] text-[var(--text-secondary)]"
															>
																Total Vehículo:
															</td>
															<td
																class="py-1.5 text-right font-mono-meta text-[0.7rem] font-bold text-[var(--emerald-700)]"
															>
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
									class="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] px-1 pt-3"
								>
									<span class="text-sm font-semibold text-[var(--text-secondary)]"
										>Total Bonificaciones</span
									>
									<span class="text-sm font-bold text-[var(--emerald-700)]"
										>{formatCurrency(totales.totalBonificaciones)}</span
									>
								</div>
							</div>
						</div>
					{/if}

					<!-- Detalle de Recargos -->
					{#if detallesVehiculos.some((d) => d.recargos.length > 0) || previewRecargosGrupos.length > 0 || totalRecargosPreview > 0}
						<div class="rounded-xl border border-[var(--border-subtle)]">
							<div
								class="rounded-t-xl border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-2.5"
							>
								<h3 class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
									Detalle Recargos
								</h3>
							</div>
							<div class="p-4">
								<!-- Recargos manuales por vehículo -->
								{#each detallesVehiculos as detalle}
									{#if detalle.recargos.length > 0}
										<div class="mb-3">
											<p class="mb-2 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
												{detalle.vehiculo.label} <span class="text-[var(--text-very-muted)]"
													>(manuales)</span
												>
											</p>
											<div class="overflow-x-auto">
												<table class="w-full text-xs">
													<thead>
														<tr class="table-header">
															<th class="py-1.5 text-left">Empresa</th>
															<th class="py-1.5 text-center">Período</th>
															<th class="py-1.5 text-center">Pag. Cliente</th>
															<th class="py-1.5 text-right">Valor</th>
														</tr>
													</thead>
													<tbody class="divide-y divide-[var(--border-subtle)]">
														{#each detalle.recargos as recargo}
															{@const empresaNombre =
																empresas.find((e) => e.id === recargo.empresa_id)?.nombre ||
																recargo.empresa_id}
															<tr>
																<td class="py-1.5 text-[var(--text-secondary)]">
																	{empresaNombre}
																</td>
																<td class="py-1.5 text-center text-[var(--text-secondary)]"
																	>{recargo.mes ? formatMes(recargo.mes) : '-'}</td
																>
																<td class="py-1.5 text-center">
																	<span
																		class="text-[11px] {recargo.pag_cliente
																			? 'text-[#C2410C]'
																			: 'text-[var(--text-very-muted)]'}">{recargo.pag_cliente
																			? 'Sí'
																			: 'No'}</span
																	>
																</td>
																<td
																	class="py-1.5 text-right font-semibold text-[var(--text-primary)]"
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
										<p class="mb-2 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
											Recargos de Planillas
										</p>
										<div class="overflow-x-auto">
											<table class="w-full text-xs">
												<thead>
													<tr class="table-header">
														<th class="py-1.5 text-left">Vehículo</th>
														<th class="py-1.5 text-left">Empresa</th>
														<th class="py-1.5 text-center">Mes</th>
														<th class="py-1.5 text-center">Pag. Cliente</th>
														<th class="py-1.5 text-center">% Propietario</th>
														<th class="py-1.5 text-right">Valor</th>
													</tr>
												</thead>
												<tbody class="divide-y divide-[var(--border-subtle)]">
													{#each previewRecargosGruposDedup as grupo (grupo.key)}
														<tr>
															<td class="py-1.5 font-semibold text-[var(--text-primary)]"
																>{grupo.vehiculo_placa}</td
															>
															<td class="py-1.5 text-[var(--text-secondary)]">
																{grupo.empresa_nombre}
															</td>
															<td class="py-1.5 text-center text-[var(--text-secondary)]"
																>{grupo.mes ? formatMes(grupo.mes) : '-'}</td
															>
															<td class="py-1.5 text-center">
																<span
																	class="text-[11px] {grupo.pag_cliente
																		? 'text-[#C2410C]'
																		: 'text-[var(--text-very-muted)]'}">{grupo.pag_cliente
																		? 'Sí'
																		: 'No'}</span
																>
															</td>
															<td class="py-1.5 text-center text-[var(--text-secondary)]"
																>{grupo.pag_cliente && grupo.porcentaje_propietario > 0
																	? grupo.porcentaje_propietario + '%'
																	: '—'}</td
															>
															<td
																class="py-1.5 text-right font-semibold text-[var(--text-primary)]"
																>{formatCurrency(grupo.valor)}</td
															>
														</tr>
													{/each}
												</tbody>
												<tfoot>
													<tr class="border-t border-[var(--border-subtle)]">
														<td
															colspan="5"
															class="py-1.5 text-right font-mono-meta text-[0.65rem] text-[var(--text-secondary)]"
														>
															Subtotal Planillas:
														</td>
														<td
															class="py-1.5 text-right font-mono-meta text-[0.7rem] font-bold text-[var(--text-primary)]"
															>{formatCurrency(totalRecargosPreview)}</td
														>
													</tr>
												</tfoot>
											</table>
										</div>
									</div>
								{:else if totalRecargosPreview > 0}
									<div
										class="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-xs"
									>
										<div>
											<span class="font-semibold text-[var(--text-secondary)]"
												>Recargos de Planillas</span
											>
											{#if !previewRecargosData && mode === 'edit'}
												<span class="ml-1 text-[11px] text-[var(--text-very-muted)]"
													>(guardado)</span
												>
											{/if}
										</div>
										<span class="font-semibold text-[var(--text-primary)]"
											>{formatCurrency(totalRecargosPreview)}</span
										>
									</div>
								{/if}
								<div
									class="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] px-1 pt-3"
								>
									<span class="text-sm font-semibold text-[var(--text-secondary)]"
										>Total Recargos</span
									>
									<span class="text-sm font-bold text-[#C2410C]"
										>{formatCurrency(totales.totalRecargos)}</span
									>
								</div>
							</div>
						</div>
					{/if}

					<!-- Detalle de Pernotes -->
					{#if detallesVehiculos.some((d) => d.pernotes.length > 0)}
						<div class="rounded-xl border border-[var(--border-subtle)]">
							<div
								class="rounded-t-xl border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-2.5"
							>
								<h3 class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
									Detalle Pernotes
								</h3>
							</div>
							<div class="p-4">
								{#each detallesVehiculos as detalle}
									{#if detalle.pernotes.length > 0}
										<div class="mb-3">
											<p class="mb-2 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
												{detalle.vehiculo.label}
											</p>
											<div class="overflow-x-auto">
												<table class="w-full text-xs">
													<thead>
														<tr class="table-header">
															<th class="py-1.5 text-left">Empresa</th>
															<th class="py-1.5 text-center">Cant.</th>
															<th class="py-1.5 text-right">V. Unit.</th>
															<th class="py-1.5 text-right">Subtotal</th>
														</tr>
													</thead>
													<tbody class="divide-y divide-[var(--border-subtle)]">
														{#each detalle.pernotes as pernote}
															{@const empresaNombre =
																empresas.find((e) => e.id === pernote.empresa_id)?.nombre ||
																pernote.empresa_id}
															<tr>
																<td class="py-1.5 text-[var(--text-secondary)]">
																	{empresaNombre}
																</td>
																<td class="py-1.5 text-center text-[var(--text-secondary)]">
																	{pernote.cantidad}
																</td>
																<td class="py-1.5 text-right text-[var(--text-secondary)]"
																	>{formatCurrency(pernote.valor)}</td
																>
																<td
																	class="py-1.5 text-right font-semibold text-[var(--text-primary)]"
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
									class="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] px-1 pt-3"
								>
									<span class="text-sm font-semibold text-[var(--text-secondary)]"
										>Total Pernotes</span
									>
									<span class="text-sm font-bold text-[var(--emerald-700)]"
										>{formatCurrency(totales.totalPernotes)}</span
									>
								</div>
							</div>
						</div>
					{/if}

					<!-- Detalle de Ajustes -->
					{#if isCheckedAjuste || isAjusteParex}
						<div class="rounded-xl border border-[var(--border-subtle)]">
							<div
								class="rounded-t-xl border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-2.5"
							>
								<h3 class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
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
										<p class="mb-2 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
											Ajuste Salarial
										</p>
										<table class="w-full text-xs">
											<tbody class="divide-y divide-[var(--border-subtle)]">
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Salario Base</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]"
														>{formatCurrency(salarioBase)}</td
													>
												</tr>
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Salario Ajuste Salarial</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]"
														>{formatCurrency(salarioVillanueva)}</td
													>
												</tr>
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Diferencia</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]"
														>{formatCurrency(diferencia)}</td
													>
												</tr>
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Días × Modalidad</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]"
														>{dias_laborados_villanueva} · {isAjustePorDia
															? 'Por día'
															: dias_laborados_villanueva >= 17
																? 'Completo'
																: 'Por día'}</td
													>
												</tr>
												<tr class="border-t-2 border-[var(--border-emphasis)]">
													<td class="py-1.5 font-bold text-[var(--text-primary)]">
														Total Ajuste
													</td>
													<td class="py-1.5 text-right font-bold text-[var(--emerald-700)]"
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
									{@const recargosPreviewParex = previewRecargosGrupos
										.filter((g: any) => g.empresa_id === PAREX_ID && g.incluir !== false)
										.reduce((s: number, g: any) => s + (g.valor || 0), 0)}
									{@const totalRecargosParex = recargosManualParex + recargosPreviewParex}
									<div>
										<p class="mb-2 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
											Ajuste PAREX (8%)
										</p>
										<table class="w-full text-xs">
											<tbody class="divide-y divide-[var(--border-subtle)]">
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Empresa</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]"
														>{empresas.find((e) => e.id === PAREX_ID)?.nombre || 'PAREX'}</td
													>
												</tr>
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Total Recargos PAREX</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]"
														>{formatCurrency(totalRecargosParex)}</td
													>
												</tr>
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Porcentaje</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]">
														8%
													</td>
												</tr>
												<tr class="border-t-2 border-[var(--border-emphasis)]">
													<td class="py-1.5 font-bold text-[var(--text-primary)]">
														Ajuste PAREX
													</td>
													<td class="py-1.5 text-right font-bold text-[#C2410C]"
														>{formatCurrency(totales.ajusteParex)}</td
													>
												</tr>
											</tbody>
										</table>
									</div>
								{/if}

								{#if isAjusteGeopark}
									{@const GEOPARK_ID = 'eea5eda5-1b60-45a0-b4c7-606a8c908ff9'}
									{@const recargosPreviewParex =
										previewRecargosGrupos
											?.filter((p: any) => p.empresa?.id === GEOPARK_ID)
											.reduce((s: number, p: any) => s + (p.total_valor || 0), 0) || 0}
									{@const totalRecargos = totales.totalRecargosGeopark + recargosPreviewParex}
									<div>
										<p class="mb-2 font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
											Ajuste GEOPARK (8%)
										</p>
										<table class="w-full text-xs">
											<tbody class="divide-y divide-[var(--border-subtle)]">
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Empresa</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]"
														>{empresas.find((e) => e.id === GEOPARK_ID)?.nombre || 'GEOPARK'}</td
													>
												</tr>
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Total Recargos GEOPARK</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]"
														>{formatCurrency(totalRecargos)}</td
													>
												</tr>
												<tr>
													<td class="py-1 text-[var(--text-muted)]">Porcentaje</td>
													<td class="py-1 text-right font-semibold text-[var(--text-secondary)]">
														8%
													</td>
												</tr>
												<tr class="border-t-2 border-[var(--border-emphasis)]">
													<td class="py-1.5 font-bold text-[var(--text-primary)]">
														Ajuste GEOPARK
													</td>
													<td class="py-1.5 text-right font-bold text-[var(--emerald-700)]"
														>{formatCurrency(totales.ajusteGeopark)}</td
													>
												</tr>
											</tbody>
										</table>
									</div>
								{/if}
							</div>
						</div>
					{/if}

					<!-- Estado de la liquidación -->
					<div
						class="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 py-4"
					>
						<div class="flex items-center gap-3">
							<div
								class="h-3 w-3 rounded-full {estadoLiquidacion === 'Liquidado'
									? 'bg-[var(--emerald-500)] shadow-[0_0_0_3px_rgba(249,115,22,0.20)]'
									: 'bg-[var(--text-very-muted)]'}"
							></div>
							<span class="text-sm font-semibold text-[var(--text-secondary)]"
								>{estadoLiquidacion === 'Liquidado' ? 'Liquidado' : 'Pendiente'}</span
							>
						</div>
						<button
							type="button"
							on:click={() =>
								(estadoLiquidacion = estadoLiquidacion === 'Pendiente' ? 'Liquidado' : 'Pendiente')}
							class="apple-transition rounded-lg border border-[var(--border-default)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--border-emphasis)] hover:bg-[var(--bg-surface)]"
						>
							{estadoLiquidacion === 'Pendiente' ? 'Marcar Liquidada' : 'Marcar Pendiente'}
						</button>
					</div>
				</div>
				<!-- /Sección: Ajustes y Períodos Especiales -->
			</div>
			<!-- /COLUMNA IZQUIERDA -->

			<!-- COLUMNA DERECHA: Resumen sticky -->
			<aside class="hidden lg:block sticky top-0">
				<div class="space-y-4">
					<!-- Card: Total a Pagar (dark hero) -->
					<div
						class="overflow-hidden rounded-2xl border border-[var(--border-subtle)] shadow-[var(--shadow-card)]"
					>
						<div
							class="px-5 py-5"
							style="background: linear-gradient(135deg, #0F1F1A, #0A1410);"
						>
							<span class="font-mono-meta text-[0.65rem] text-[#9A9A9A]">Total a Pagar</span>
							<div class="mt-1 flex items-baseline justify-between gap-2">
								<span class="font-display text-2xl font-medium text-[#34D399] sm:text-3xl">
									{formatCurrency(totalAPagarVisual)}
								</span>
							</div>
							{#if totales.sueldoTotal % 1 !== 0}
								<span class="block text-[11px] text-[#6B6B6B]"
									>{formatCurrencyDecimal(totales.sueldoTotal)}</span
								>
							{/if}

							<!-- Ajuste ±$ -->
							<div class="mt-3">
								<label
									for="ajuste-pesos"
									class="font-mono-meta mb-1 block text-[0.6rem] text-[#9A9A9A]"
									>Ajuste manual ±$</label
								>
								<div class="inline-flex overflow-hidden rounded-lg border border-[#374151]">
									{#each [-5, -3, -2, -1, 0, 1, 2, 3, 5] as const as val}
										<button
											type="button"
											on:click={() => (ajustePesos = val)}
											class="apple-transition px-2 py-1 text-[11px] font-medium {ajustePesos ===
											val
												? val < 0
													? 'bg-[#DC2626] text-white'
													: 'bg-[var(--emerald-500)] text-white'
												: 'bg-[#1F2937] text-[#9A9A9A] hover:bg-[#374151] hover:text-[#E5E7EB]'}"
										>
											{val > 0 ? `+${val}` : val}
										</button>
									{/each}
								</div>
							</div>

							{#if ajustePesos !== 0}
								<span
									class="mt-2 block font-mono-meta text-[0.6rem] {ajustePesos > 0
										? 'text-[#FBBF24]'
										: 'text-[#FCA5A5]'}"
								>
									(ajuste {ajustePesos > 0 ? `+${ajustePesos}` : ajustePesos} · se envía al backend)
								</span>
							{/if}
						</div>
					</div>

					<!-- Card: Desglose financiero -->
					<div
						class="rounded-2xl border border-[var(--border-subtle)] bg-white shadow-[var(--shadow-card)]"
					>
						<div
							class="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 py-3"
						>
							<DollarSign class="h-4 w-4 text-[var(--text-muted)]" />
							<h3 class="font-mono-meta text-[0.7rem] text-[var(--text-secondary)]">
								Desglose Financiero
							</h3>
						</div>

						<div class="space-y-4 p-5">
							<!-- Devengados -->
							<div>
								<h4 class="font-mono-meta mb-2 text-[0.65rem] text-[var(--emerald-600)]">
									Devengados
								</h4>
								<table class="w-full text-xs">
									<tbody class="divide-y divide-[var(--border-subtle)]">
										<tr>
											<td class="py-1.5 text-[var(--text-secondary)]"
												>Salario ({dias_laborados} días)</td
											>
											<td class="py-1.5 text-right font-semibold text-[var(--text-primary)]"
												>{formatCurrency(totales.salarioDevengado)}</td
											>
										</tr>
										<tr>
											<td class="py-1.5 text-[var(--text-secondary)]">Aux. Transporte</td>
											<td class="py-1.5 text-right font-semibold text-[var(--text-primary)]"
												>{formatCurrency(totales.auxilioTransporte)}</td
											>
										</tr>
										{#if totales.totalBonificaciones > 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]">Bonificaciones</td>
												<td class="py-1.5 text-right font-semibold text-[var(--emerald-600)]"
													>{formatCurrency(totales.totalBonificaciones)}</td
												>
											</tr>
										{/if}
										{#if totales.totalPernotes > 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]">Pernotes</td>
												<td class="py-1.5 text-right font-semibold text-[var(--emerald-600)]"
													>{formatCurrency(totales.totalPernotes)}</td
												>
											</tr>
										{/if}
										{#if totales.totalRecargos > 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]">Recargos</td>
												<td class="py-1.5 text-right font-semibold text-[var(--emerald-600)]"
													>{formatCurrency(totales.totalRecargos)}</td
												>
											</tr>
										{/if}
										{#if totales.bonificacionVillanueva > 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]">Ajuste Salarial</td>
												<td class="py-1.5 text-right font-semibold text-[var(--emerald-600)]"
													>{formatCurrency(totales.bonificacionVillanueva)}</td
												>
											</tr>
										{/if}
										{#if totales.valorIncapacidad > 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]">Incapacidad</td>
												<td class="py-1.5 text-right font-semibold text-[var(--text-primary)]"
													>{formatCurrency(totales.valorIncapacidad)}</td
												>
											</tr>
										{/if}
										{#if totales.totalVacaciones > 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]">Vacaciones</td>
												<td class="py-1.5 text-right font-semibold text-[var(--text-primary)]"
													>{formatCurrency(Number(valor_vacaciones))}</td
												>
											</tr>
										{/if}
										{#if totales.interesCesantias > 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]">Interés Cesantías</td>
												<td class="py-1.5 text-right font-semibold text-[var(--text-primary)]"
													>{formatCurrency(totales.interesCesantias)}</td
												>
											</tr>
										{/if}
										{#if cesantias > 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]">Cesantías</td>
												<td class="py-1.5 text-right font-semibold text-[var(--text-primary)]"
													>{formatCurrency(cesantias)}</td
												>
											</tr>
										{/if}
										{#if totales.totalAjustesAdicionales !== 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]"
													>Conceptos Adicionales</td
												>
												<td
													class="py-1.5 text-right font-semibold {totales.totalAjustesAdicionales >
													0
														? 'text-[var(--emerald-600)]'
														: 'text-[#DC2626]'}">{formatCurrency(totales.totalAjustesAdicionales)}</td
												>
											</tr>
										{/if}
									</tbody>
									<tfoot>
										<tr class="border-t-2 border-[var(--border-emphasis)]">
											<td class="pt-2 text-sm font-bold text-[var(--text-primary)]"
												>Total Bruto</td
											>
											<td class="pt-2 text-right text-sm font-bold text-[var(--text-primary)]"
												>{formatCurrency(totales.sueldoBruto)}</td
											>
										</tr>
									</tfoot>
								</table>
							</div>

							<!-- Deducciones -->
							<div>
								<h4 class="font-mono-meta mb-2 text-[0.65rem] text-[#DC2626]">Deducciones</h4>
								<table class="w-full text-xs">
									<tbody class="divide-y divide-[var(--border-subtle)]">
										<tr>
											<td class="py-1.5 text-[var(--text-secondary)]"
												>Salud (4%){descontarSaludSalario ? ' (Base)' : ''}</td
											>
											<td class="py-1.5 text-right font-semibold text-[#DC2626]"
												>-{formatCurrency(totales.salud)}</td
											>
										</tr>
										<tr>
											<td class="py-1.5 text-[var(--text-secondary)]"
												>Pensión (4%){descontarPensionSalario ? ' (Base)' : ''}</td
											>
											<td class="py-1.5 text-right font-semibold text-[#DC2626]"
												>-{formatCurrency(totales.pension)}</td
											>
										</tr>
										{#if totales.totalAnticipos > 0}
											<tr>
												<td class="py-1.5 text-[var(--text-secondary)]">Anticipos</td>
												<td class="py-1.5 text-right font-semibold text-[#DC2626]"
													>-{formatCurrency(totales.totalAnticipos)}</td
												>
											</tr>
										{/if}
									</tbody>
									<tfoot>
										<tr class="border-t-2 border-[var(--border-emphasis)]">
											<td class="pt-2 text-sm font-bold text-[#991B1B]">Total Deducciones</td>
											<td class="pt-2 text-right text-sm font-bold text-[#DC2626]"
												>-{formatCurrency(totales.totalDeducciones)}</td
											>
										</tr>
									</tfoot>
								</table>
							</div>

							<!-- Base prestacional -->
							<div
								class="rounded-lg border border-[rgba(220,38,38,0.20)] bg-[rgba(220,38,38,0.04)] p-3"
							>
								<div class="flex items-center justify-between">
									<span class="font-mono-meta text-[0.65rem] text-[#991B1B]"
										>Base Prestacional</span
									>
									<span class="text-sm font-bold text-[#991B1B]"
										>{formatCurrency(totales.baseCalculo)}</span
									>
								</div>
							</div>
						</div>
					</div>

					<!-- Botones de acción sticky al final del resumen -->
					<div class="flex flex-col gap-2">
						<button
							on:click={handleSubmit}
							disabled={loading}
							class="apple-transition flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-btn)] hover:shadow-[var(--shadow-btn-hover)] disabled:opacity-50"
							style="background: linear-gradient(135deg, #f97316, #ea580c);"
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
						<button
							type="button"
							on:click={() => window.history.back()}
							class="btn-secondary apple-transition"
						>
							Cancelar
						</button>
					</div>
				</div>
			</aside>
		</div>
		<!-- /Grid 2 columnas -->

		<!-- ═══ RESUMEN MÓVIL: al final de la página en mobile, oculto en desktop (lg+) ═══ -->
		<div class="mt-6 lg:hidden">
			<button
				type="button"
				class="apple-transition flex w-full items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-white px-4 py-3 text-sm font-semibold text-[var(--text-secondary)] shadow-[var(--shadow-card)] hover:bg-[var(--bg-base)]"
				on:click={() => (showMobileResumen = !showMobileResumen)}
			>
				<span class="flex items-center gap-2">
					<DollarSign class="h-4 w-4 text-[var(--emerald-600)]" />
					{showMobileResumen ? 'Ocultar desglose' : 'Ver desglose'}
				</span>
				<span class="font-display text-sm font-bold text-[var(--emerald-700)]">
					{formatCurrency(totalAPagarVisual)}
				</span>
			</button>
			{#if showMobileResumen}
				<div
					class="mt-3 space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-white p-4 shadow-[var(--shadow-card)]"
				>
					<!-- Total a pagar -->
					<div class="text-center">
						<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
							>Total a Pagar</span
						>
						<div class="font-display text-2xl font-medium text-[var(--emerald-700)]">
							{formatCurrency(totalAPagarVisual)}
						</div>
					</div>

					<!-- Devengado / Deducciones -->
					<div class="grid grid-cols-2 gap-2 text-xs">
						<div
							class="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2"
						>
							<div class="font-mono-meta text-[0.6rem] text-[var(--text-muted)]">
								Devengado
							</div>
							<div class="font-bold text-[var(--text-primary)]">
								{formatCurrency(totales.sueldoBruto)}
							</div>
						</div>
						<div
							class="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2"
						>
							<div class="font-mono-meta text-[0.6rem] text-[var(--text-muted)]">
								Deducciones
							</div>
							<div class="font-bold text-[#DC2626]">
								-{formatCurrency(totales.totalDeducciones)}
							</div>
						</div>
					</div>

					<!-- Base Prestacional -->
					<div
						class="rounded-lg border border-[rgba(220,38,38,0.20)] bg-[rgba(220,38,38,0.04)] p-2.5"
					>
						<div class="flex items-center justify-between">
							<span class="font-mono-meta text-[0.65rem] text-[#991B1B]"
								>Base Prestacional</span
							>
							<span class="text-sm font-bold text-[#991B1B]">
								{formatCurrency(totales.baseCalculo)}
							</span>
						</div>
					</div>

					<!-- Desglose conceptos (mismo que el aside de desktop) -->
					<details class="rounded-lg border border-[var(--border-subtle)] bg-white">
						<summary
							class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]"
						>
							Desglose de conceptos
						</summary>
						<div class="space-y-1.5 px-3 pb-3 text-xs">
							<div class="flex items-center justify-between">
								<span class="text-[var(--text-muted)]">Salario devengado</span>
								<span class="font-mono text-[var(--text-primary)]"
									>{formatCurrency(totales.salarioDevengado)}</span
								>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[var(--text-muted)]">Auxilio de transporte</span>
								<span class="font-mono text-[var(--text-primary)]"
									>{formatCurrency(totales.auxilioTransporte)}</span
								>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[var(--text-muted)]">Bonificaciones</span>
								<span class="font-mono text-[var(--text-primary)]"
									>{formatCurrency(totales.totalBonificaciones)}</span
								>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[var(--text-muted)]">Pernotes</span>
								<span class="font-mono text-[var(--text-primary)]"
									>{formatCurrency(totales.totalPernotes)}</span
								>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[var(--text-muted)]">Recargos</span>
								<span class="font-mono font-semibold text-[var(--emerald-700)]"
									>{formatCurrency(totales.totalRecargos)}</span
								>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[var(--text-muted)]">Ajuste PAREX</span>
								<span class="font-mono text-[var(--text-primary)]"
									>{formatCurrency(totales.ajusteParex)}</span
								>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[var(--text-muted)]">Ajuste Geopark</span>
								<span class="font-mono text-[var(--text-primary)]"
									>{formatCurrency(totales.ajusteGeopark)}</span
								>
							</div>
							<div class="flex items-center justify-between border-t border-[var(--border-subtle)] pt-1.5">
								<span class="font-semibold text-[var(--text-primary)]">Sueldo bruto</span>
								<span class="font-mono font-semibold text-[var(--text-primary)]"
									>{formatCurrency(totales.sueldoBruto)}</span
								>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[#DC2626]">− Salud</span>
								<span class="font-mono text-[#DC2626]">{formatCurrency(totales.salud)}</span>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[#DC2626]">− Pensión</span>
								<span class="font-mono text-[#DC2626]"
									>{formatCurrency(totales.pension)}</span
								>
							</div>
							<div class="flex items-center justify-between">
								<span class="text-[#DC2626]">− Anticipos</span>
								<span class="font-mono text-[#DC2626]"
									>{formatCurrency(totales.totalAnticipos)}</span
								>
							</div>
						</div>
					</details>

					<!-- Botón guardar en mobile -->
					<button
						type="button"
						on:click={handleSubmit}
						disabled={loading}
						class="apple-transition flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-btn)] disabled:opacity-50"
						style="background: linear-gradient(135deg, #f97316, #ea580c);"
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
				</div>
			{/if}
		</div>
	</div>

	<!-- Modal: Reporte de recorridos del período (estilo PreviewTerceroPDF) -->
	<RecorridosSincronizadosModal
		open={modalRecorridosOpen}
		conductorId={conductorSelected?.value || ''}
		conductorNombre={conductorSelected?.label || ''}
		desde={periodo_inicio}
		hasta={periodo_fin}
		clavesSincronizadas={clavesSincronizadas}
		onclose={() => (modalRecorridosOpen = false)}
	/>
{/if}
