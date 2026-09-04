<script lang="ts">
	import { page as pageState } from '$app/state';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		salidasNCAPI,
		type SalidaNoConforme,
		type FiltrosSalidasNC,
		type ClasificacionNC,
		type TipoDeteccion,
		type TipoSalidaNC,
		type EstadoSNC,
		type TratamientoSNC,
		type EstadisticasSNC,
		type MedioAutorizacion,
		type MetodoVerificacion,
		CLASIFICACION_LABELS,
		TIPO_DETECCION_LABELS,
		TIPO_SALIDA_NC_LABELS,
		ESTADO_SNC_LABELS,
		TRATAMIENTO_SNC_LABELS,
		MEDIO_AUTORIZACION_LABELS,
		METODO_VERIFICACION_LABELS
	} from '$lib/api/salidas-nc';
	import { conductoresAPI, clientesAPI, vehiculosAPI } from '$lib/api/apiClient';

	// ── Estado ──
	let salidas = $state<SalidaNoConforme[]>([]);
	let estadisticas = $state<EstadisticasSNC | null>(null);
	let isLoading = $state(true);
	let isLoadingStats = $state(true);

	let total = $state(0);
	let totalPages = 0;

	/**
	 * Filtros en la URL.
	 *
	 * Seis filtros que hasta ahora no salían de la memoria: recargar la página
	 * los perdía todos. Y la búsqueda no tenía retardo: cada tecla lanzaba una
	 * petición al servidor.
	 */
	interface FiltrosSalidas {
		q: string;
		clasificacion: string;
		estado: string;
		deteccion: string;
		desde: string;
		hasta: string;
		pagina: number;
	}

	const POR_PAGINA = 10;

	const DEFS: DefinicionesFiltros<FiltrosSalidas> = {
		q: texto(),
		clasificacion: opcion(''),
		estado: opcion(''),
		deteccion: opcion(''),
		desde: texto(),
		hasta: texto(),
		pagina: numero(1)
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<FiltrosSalidas>(estadoUrl.leer(pageState.url));

	$effect(() => {
		estadoUrl.escribir(pageState.url, filtros);
	});

	$effect(() => {
		void filtros;
		cargarSalidas();
	});

	function ponerFiltro<K extends keyof FiltrosSalidas>(clave: K, valor: FiltrosSalidas[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}

	// Modal formulario
	let showModal = $state(false);
	let modoEdicion = $state(false);
	let salidaEditar: SalidaNoConforme | null = null;

	// Modal eliminar
	let showDeleteModal = $state(false);
	let salidaEliminar = $state<{ id: string; numero: number } | null>(null);

	// Datos para selectores
	let conductores: any[] = [];
	let clientes: any[] = [];
	let vehiculos: any[] = [];

	// ── Form data ──
	let form = $state(resetForm());

	function resetForm() {
		return {
			fecha_deteccion: new Date().toISOString().split('T')[0],
			fecha_evento: new Date().toISOString().split('T')[0],
			detectado_por: '',
			area_proceso: '',
			tipo_deteccion: '' as TipoDeteccion | '',
			tipo_deteccion_otro: '',
			vehiculo_placa: '',
			ruta_trayecto: '',
			turno_horario: '',
			conductor_nombre: '',
			conductor_cedula: '',
			cliente_contrato: '',
			servicio_afectado: '',
			descripcion_nc: '',
			clasificacion_nc: '' as ClasificacionNC | '',
			tipo_salida_nc: '' as TipoSalidaNC | '',
			tipo_salida_nc_otro: '',
			tratamiento_seleccionado: '' as TratamientoSNC | '',
			descripcion_accion_tomada: '',
			responsable_accion: '',
			fecha_implementacion: '',
			autoridad_disposicion: '',
			concesion_solicitada: false,
			condiciones_concesion: '',
			concesion_cliente_nombre: '',
			concesion_cliente_fecha: '',
			concesion_medio: '' as MedioAutorizacion | '',
			metodo_verificacion: '' as MetodoVerificacion | '',
			metodo_verificacion_otro: '',
			resultado_verificacion: '',
			cumple_requisitos: '' as 'SI' | 'NO' | '',
			responsable_verificacion: '',
			fecha_verificacion: '',
			firma_verificacion: '',
			conductor_id: '',
			vehiculo_id: '',
			cliente_id: '',
			observaciones: ''
		};
	}

	let siguienteNumero = $state(1);
	let isSaving = $state(false);

	onMount(async () => {
		await Promise.all([cargarSalidas(), cargarEstadisticas(), cargarDatosSelectores()]);
	});

	async function cargarDatosSelectores() {
		try {
			const [condRes, cliRes, vehRes] = await Promise.all([
				conductoresAPI.getAll(),
				clientesAPI.getAll(),
				vehiculosAPI.getAll()
			]);
			conductores = condRes.data?.data || condRes.data || [];
			clientes = cliRes.data?.data || cliRes.data || [];
			vehiculos = vehRes.data?.data || vehRes.data || [];
		} catch (e) {
			console.error('Error cargando selectores:', e);
		}
	}

	async function cargarSalidas() {
		isLoading = true;
		try {
			const parametros: FiltrosSalidasNC = {
				page: filtros.pagina,
				limit: POR_PAGINA,
				...(filtros.q && { busqueda: filtros.q }),
				...(filtros.clasificacion && { clasificacion_nc: filtros.clasificacion as ClasificacionNC }),
				...(filtros.estado && { estado: filtros.estado as EstadoSNC }),
				...(filtros.deteccion && { tipo_deteccion: filtros.deteccion as TipoDeteccion }),
				...(filtros.desde && { fecha_desde: filtros.desde }),
				...(filtros.hasta && { fecha_hasta: filtros.hasta })
			};

			const res = await salidasNCAPI.listar(parametros);
			salidas = res.salidas;
			total = res.total;
			totalPages = res.totalPages;
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Error al cargar';
			toast.error(msg);
			salidas = [];
		} finally {
			isLoading = false;
		}
	}

	async function cargarEstadisticas() {
		isLoadingStats = true;
		try {
			estadisticas = await salidasNCAPI.estadisticas();
		} catch (e) {
			console.error('Error stats:', e);
		} finally {
			isLoadingStats = false;
		}
	}

	/// La recarga la dispara el efecto que observa `filtros`; estas funciones
	/// solo cambian el estado.
	function aplicarFiltros() {
		filtros = { ...filtros, pagina: 1 };
	}

	function limpiarFiltros() {
		filtros = limpiarFiltrosDe(DEFS, filtros);
	}

	function cambiarPagina(p: number) {
		filtros = { ...filtros, pagina: p };
	}

	async function abrirModalCrear() {
		form = resetForm();
		modoEdicion = false;
		salidaEditar = null;
		try {
			siguienteNumero = await salidasNCAPI.siguienteNumero();
		} catch (e) {
			siguienteNumero = 1;
		}
		showModal = true;
	}

	function abrirModalEditar(salida: SalidaNoConforme) {
		salidaEditar = salida;
		modoEdicion = true;
		siguienteNumero = salida.numero_snc;
		form = {
			fecha_deteccion: salida.fecha_deteccion?.split('T')[0] || '',
			fecha_evento: salida.fecha_evento?.split('T')[0] || '',
			detectado_por: salida.detectado_por || '',
			area_proceso: salida.area_proceso || '',
			tipo_deteccion: salida.tipo_deteccion || '',
			tipo_deteccion_otro: salida.tipo_deteccion_otro || '',
			vehiculo_placa: salida.vehiculo_placa || '',
			ruta_trayecto: salida.ruta_trayecto || '',
			turno_horario: salida.turno_horario || '',
			conductor_nombre: salida.conductor_nombre || '',
			conductor_cedula: salida.conductor_cedula || '',
			cliente_contrato: salida.cliente_contrato || '',
			servicio_afectado: salida.servicio_afectado || '',
			descripcion_nc: salida.descripcion_nc || '',
			clasificacion_nc: salida.clasificacion_nc || '',
			tipo_salida_nc: salida.tipo_salida_nc || '',
			tipo_salida_nc_otro: salida.tipo_salida_nc_otro || '',
			tratamiento_seleccionado: salida.tratamiento_seleccionado || '',
			descripcion_accion_tomada: salida.descripcion_accion_tomada || '',
			responsable_accion: salida.responsable_accion || '',
			fecha_implementacion: salida.fecha_implementacion?.split('T')[0] || '',
			autoridad_disposicion: salida.autoridad_disposicion || '',
			concesion_solicitada: salida.concesion_solicitada || false,
			condiciones_concesion: salida.condiciones_concesion || '',
			concesion_cliente_nombre: salida.concesion_cliente_nombre || '',
			concesion_cliente_fecha: salida.concesion_cliente_fecha?.split('T')[0] || '',
			concesion_medio: salida.concesion_medio || '',
			metodo_verificacion: salida.metodo_verificacion || '',
			metodo_verificacion_otro: salida.metodo_verificacion_otro || '',
			resultado_verificacion: salida.resultado_verificacion || '',
			cumple_requisitos: salida.cumple_requisitos === true ? 'SI' : salida.cumple_requisitos === false ? 'NO' : '',
			responsable_verificacion: salida.responsable_verificacion || '',
			fecha_verificacion: salida.fecha_verificacion?.split('T')[0] || '',
			firma_verificacion: salida.firma_verificacion || '',
			conductor_id: salida.conductor_id || '',
			vehiculo_id: salida.vehiculo_id || '',
			cliente_id: salida.cliente_id || '',
			observaciones: salida.observaciones || ''
		};
		showModal = true;
	}

	function cerrarModal() {
		showModal = false;
		salidaEditar = null;
		modoEdicion = false;
	}

	// Cuando seleccionan un conductor del dropdown, llenar nombre y cédula
	function onConductorSelect() {
		if (form.conductor_id) {
			const c = conductores.find((x: any) => x.id === form.conductor_id);
			if (c) {
				form.conductor_nombre = `${c.nombre} ${c.apellido}`;
				form.conductor_cedula = c.numero_identificacion;
			}
		}
	}

	// Cuando seleccionan un vehículo del dropdown, llenar placa
	function onVehiculoSelect() {
		if (form.vehiculo_id) {
			const v = vehiculos.find((x: any) => x.id === form.vehiculo_id);
			if (v) {
				form.vehiculo_placa = v.placa;
			}
		}
	}

	async function guardar() {
		// Validar campos requeridos
		if (
			!form.fecha_deteccion ||
			!form.fecha_evento ||
			!form.detectado_por ||
			!form.area_proceso ||
			!form.tipo_deteccion ||
			!form.descripcion_nc ||
			!form.clasificacion_nc ||
			!form.tipo_salida_nc
		) {
			toast.error('Complete todos los campos obligatorios');
			return;
		}

		isSaving = true;
		try {
			const data: any = { ...form };
			// Limpiar campos vacíos
			Object.keys(data).forEach((k) => {
				if (data[k] === '' || data[k] === null) delete data[k];
			});

			// Convertir cumple_requisitos de string a boolean
			if (data.cumple_requisitos === 'SI') data.cumple_requisitos = true;
			else if (data.cumple_requisitos === 'NO') data.cumple_requisitos = false;
			else delete data.cumple_requisitos;

			if (modoEdicion && salidaEditar) {
				await salidasNCAPI.actualizar(salidaEditar.id, data);
				toast.success('Salida no conforme actualizada');
			} else {
				await salidasNCAPI.crear(data);
				toast.success('Salida no conforme registrada');
			}

			cerrarModal();
			await Promise.all([cargarSalidas(), cargarEstadisticas()]);
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Error al guardar';
			toast.error(msg);
		} finally {
			isSaving = false;
		}
	}

	function abrirModalEliminar(id: string, numero: number) {
		salidaEliminar = { id, numero };
		showDeleteModal = true;
	}

	async function confirmarEliminacion() {
		if (!salidaEliminar) return;
		try {
			await salidasNCAPI.eliminar(salidaEliminar.id);
			toast.success('Salida no conforme eliminada');
			await Promise.all([cargarSalidas(), cargarEstadisticas()]);
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Error al eliminar';
			toast.error(msg);
		} finally {
			showDeleteModal = false;
			salidaEliminar = null;
		}
	}

	async function descargarPDF(id: string, numeroSnc: number) {
		try {
			toast.info('Generando PDF...');
			await salidasNCAPI.descargarPDF(id, numeroSnc);
			toast.success(`PDF SNC-${String(numeroSnc).padStart(4, '0')} descargado`);
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Error al generar PDF';
			toast.error(msg);
		}
	}

	function formatearFecha(fecha: string | undefined): string {
		if (!fecha) return 'N/A';
		const [year, month, day] = fecha.split('T')[0].split('-');
		return `${day}/${month}/${year}`;
	}

	function getClasificacionBadge(c: ClasificacionNC) {
		const map: Record<string, string> = {
			CRITICA: 'bg-red-100 text-red-700 border border-red-200',
			MAYOR: 'bg-orange-100 text-orange-700 border border-orange-200',
			MENOR: 'bg-yellow-100 text-yellow-700 border border-yellow-200'
		};
		return map[c] || 'bg-gray-100 text-gray-700';
	}

	function getEstadoBadge(e: EstadoSNC) {
		const map: Record<string, string> = {
			ABIERTA: 'bg-red-100 text-red-700 border border-red-200',
			EN_TRATAMIENTO: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
			CERRADA: 'bg-orange-100 text-orange-700 border border-orange-200'
		};
		return map[e] || 'bg-gray-100 text-gray-700';
	}
</script>

<svelte:head>
	<title>Salidas No Conformidades · Cotransmeq</title>
</svelte:head>

<div class="p-6">
	<!-- Header -->
	<div class="mb-6" in:fade={{ duration: 400 }}>
		<h1 class="mb-2 text-2xl font-bold text-gray-900">Salidas No Conformes</h1>
		<p class="text-gray-600">Registro y control de salidas no conformes (ISO 8.7.2)</p>
	</div>

	<!-- Estadísticas -->
	{#if !isLoadingStats && estadisticas}
		<div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4" transition:fade>
			<!-- Total -->
			<div class="glass rounded-xl border border-gray-200 p-5" in:fly={{ y: 20, delay: 100 }}>
				<div class="flex items-center justify-between">
					<div>
						<p class="mb-1 text-sm text-gray-600">Total SNC</p>
						<p class="text-3xl font-bold text-gray-900">{estadisticas.total}</p>
					</div>
					<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-slate-400 to-slate-600 shadow-lg shadow-slate-500/30">
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
						</svg>
					</div>
				</div>
			</div>

			<!-- Abiertas -->
			<div class="glass rounded-xl border border-gray-200 p-5" in:fly={{ y: 20, delay: 200 }}>
				<div class="flex items-center justify-between">
					<div>
						<p class="mb-1 text-sm text-gray-600">Abiertas</p>
						<p class="text-3xl font-bold text-red-600">
							{estadisticas.porEstado.find((e) => e.estado === 'ABIERTA')?.count ?? 0}
						</p>
					</div>
					<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-400 to-red-600 shadow-lg shadow-red-500/30">
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
					</div>
				</div>
			</div>

			<!-- En Tratamiento -->
			<div class="glass rounded-xl border border-gray-200 p-5" in:fly={{ y: 20, delay: 300 }}>
				<div class="flex items-center justify-between">
					<div>
						<p class="mb-1 text-sm text-gray-600">En Tratamiento</p>
						<p class="text-3xl font-bold text-yellow-600">
							{estadisticas.porEstado.find((e) => e.estado === 'EN_TRATAMIENTO')?.count ?? 0}
						</p>
					</div>
					<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-lg shadow-yellow-500/30">
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					</div>
				</div>
			</div>

			<!-- Cerradas -->
			<div class="glass rounded-xl border border-gray-200 p-5" in:fly={{ y: 20, delay: 400 }}>
				<div class="flex items-center justify-between">
					<div>
						<p class="mb-1 text-sm text-gray-600">Cerradas</p>
						<p class="text-3xl font-bold text-emerald-600">
							{estadisticas.porEstado.find((e) => e.estado === 'CERRADA')?.count ?? 0}
						</p>
					</div>
					<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/30">
						<svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Filtros y Controles -->
	<div class="glass mb-6 rounded-xl border border-gray-200 p-6" in:fly={{ y: 20, delay: 500 }}>
		<div class="mb-4 flex flex-col gap-4 lg:flex-row">
			<!-- Búsqueda -->
			<div class="flex-1">
				<BuscadorLista
					valor={filtros.q}
					onBuscar={(termino) => ponerFiltro('q', termino)}
					placeholder="Buscar por conductor, placa, descripción, área…"
					etiqueta="Buscar salidas no conformes"
				/>
			</div>

			<!-- Botón Nueva SNC -->
			<button
				onclick={abrirModalCrear}
				class="apple-transition flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-red-600 px-6 py-2.5 whitespace-nowrap text-white shadow-lg shadow-red-500/30 hover:from-red-600 hover:to-red-700"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
				</svg>
				Registrar SNC
			</button>
		</div>

		<!-- Filtros avanzados -->
		<div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
			<div>
				<label for="clasificacionFiltro" class="mb-1.5 block text-sm font-medium text-gray-700">Clasificación</label>
				<select id="clasificacionFiltro" value={filtros.clasificacion}
					onchange={(e) => ponerFiltro('clasificacion', e.currentTarget.value)} class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-emerald-500/50">
					<option value="">Todas</option>
					{#each Object.entries(CLASIFICACION_LABELS) as [val, info]}
						<option value={val}>{info.label}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="estadoFiltro" class="mb-1.5 block text-sm font-medium text-gray-700">Estado</label>
				<select id="estadoFiltro" value={filtros.estado}
					onchange={(e) => ponerFiltro('estado', e.currentTarget.value)} class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-emerald-500/50">
					<option value="">Todos</option>
					{#each Object.entries(ESTADO_SNC_LABELS) as [val, info]}
						<option value={val}>{info.label}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="tipoDeteccionFiltro" class="mb-1.5 block text-sm font-medium text-gray-700">Tipo Detección</label>
				<select id="tipoDeteccionFiltro" value={filtros.deteccion}
					onchange={(e) => ponerFiltro('deteccion', e.currentTarget.value)} class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-emerald-500/50">
					<option value="">Todos</option>
					{#each Object.entries(TIPO_DETECCION_LABELS) as [val, label]}
						<option value={val}>{label}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="fechaDesde" class="mb-1.5 block text-sm font-medium text-gray-700">Desde</label>
				<input id="fechaDesde" type="date" value={filtros.desde}
					onchange={(e) => ponerFiltro('desde', e.currentTarget.value)} class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-emerald-500/50" />
			</div>

			<div>
				<label for="fechaHasta" class="mb-1.5 block text-sm font-medium text-gray-700">Hasta</label>
				<input id="fechaHasta" type="date" value={filtros.hasta}
					onchange={(e) => ponerFiltro('hasta', e.currentTarget.value)} class="apple-transition w-full rounded-lg border border-gray-200 bg-white/80 px-4 py-2.5 text-gray-900 focus:ring-2 focus:ring-emerald-500/50" />
			</div>
		</div>

		<div class="flex gap-3">
			<button onclick={aplicarFiltros} class="apple-transition rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-800">
				Aplicar Filtros
			</button>
			<button onclick={limpiarFiltros} class="apple-transition rounded-lg border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
				Limpiar
			</button>
		</div>
	</div>

	<!-- Tabla -->
	<div class="glass overflow-hidden rounded-xl border border-gray-200" in:fly={{ y: 20, delay: 600 }}>
		{#if isLoading}
			<div class="flex items-center justify-center py-20">
				<div class="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
				<span class="ml-3 text-gray-500">Cargando...</span>
			</div>
		{:else if salidas.length === 0}
			<div class="py-20 text-center">
				<svg class="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
				<p class="mt-4 text-gray-500">No hay salidas no conformes registradas</p>
				<button onclick={abrirModalCrear} class="mt-4 rounded-lg bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600">
					Registrar primera SNC
				</button>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-200 bg-gray-50/80">
							<th class="px-4 py-3 text-left font-semibold text-gray-700">N° SNC</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-700">Fecha</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-700">Detectado por</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-700">Conductor</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-700">Vehículo</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-700">Clasificación</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-700">Tipo Salida</th>
							<th class="px-4 py-3 text-left font-semibold text-gray-700">Estado</th>
							<th class="px-4 py-3 text-center font-semibold text-gray-700">Acciones</th>
						</tr>
					</thead>
					<tbody>
						{#each salidas as salida, i}
							<tr
								class="border-b border-gray-100 transition-colors hover:bg-gray-50/60"
								in:fly={{ y: 10, delay: i * 30 }}
							>
								<td class="px-4 py-3">
									<span class="font-mono font-bold text-gray-900">SNC-{String(salida.numero_snc).padStart(4, '0')}</span>
								</td>
								<td class="px-4 py-3 text-gray-600">{formatearFecha(salida.fecha_deteccion)}</td>
								<td class="px-4 py-3 text-gray-700">{salida.detectado_por}</td>
								<td class="px-4 py-3 text-gray-700">
									{#if salida.conductor_nombre}
										<div class="text-sm font-medium">{salida.conductor_nombre}</div>
										{#if salida.conductor_cedula}
											<div class="text-xs text-gray-400">CC {salida.conductor_cedula}</div>
										{/if}
									{:else}
										<span class="text-gray-400">—</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-gray-700">
									{salida.vehiculo_placa || '—'}
								</td>
								<td class="px-4 py-3">
									<span class="inline-block rounded-full px-2.5 py-1 text-xs font-semibold {getClasificacionBadge(salida.clasificacion_nc)}">
										{CLASIFICACION_LABELS[salida.clasificacion_nc]?.label || salida.clasificacion_nc}
									</span>
								</td>
								<td class="px-4 py-3">
									<span class="text-xs text-gray-600" title={TIPO_SALIDA_NC_LABELS[salida.tipo_salida_nc]}>
										{TIPO_SALIDA_NC_LABELS[salida.tipo_salida_nc]?.substring(0, 25) || salida.tipo_salida_nc}
									</span>
								</td>
								<td class="px-4 py-3">
									<span class="inline-block rounded-full px-2.5 py-1 text-xs font-semibold {getEstadoBadge(salida.estado)}">
										{ESTADO_SNC_LABELS[salida.estado]?.label || salida.estado}
									</span>
								</td>
								<td class="px-4 py-3 text-center">
									<div class="flex items-center justify-center gap-1">
										<button
											onclick={() => descargarPDF(salida.id, salida.numero_snc)}
											class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600"
											title="Descargar PDF"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
											</svg>
										</button>
										<button
											onclick={() => abrirModalEditar(salida)}
											class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
											title="Editar"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
											</svg>
										</button>
										<button
											onclick={() => abrirModalEliminar(salida.id, salida.numero_snc)}
											class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
											title="Eliminar"
										>
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
											</svg>
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Paginación: el bloque manual que había aquí lo reemplaza el
			     componente compartido, que trae la misma ventana de páginas. -->
			<PaginadorLista
				pagina={filtros.pagina}
				{total}
				porPagina={POR_PAGINA}
				cargando={isLoading}
				nombreItems="salidas"
				onCambiar={cambiarPagina}
			/>
		{/if}
	</div>
</div>

<!-- ═══════════════════════════════════════════════ -->
<!-- MODAL FORMULARIO SNC                           -->
<!-- ═══════════════════════════════════════════════ -->
{#if showModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" transition:fade={{ duration: 200 }}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="relative flex w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl"
			style="max-height: 90vh;"
			in:fly={{ y: 30, duration: 300 }}
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Header del modal -->
			<div class="flex shrink-0 items-center justify-between rounded-t-2xl border-b border-gray-200 bg-gradient-to-r from-red-500 to-red-600 px-8 py-5">
				<div>
					<h2 class="text-xl font-bold text-white">
						{modoEdicion ? 'Editar' : 'Registrar'} Salida No Conforme
					</h2>
					<p class="text-sm text-red-100">
						SNC-{String(siguienteNumero).padStart(4, '0')}
					</p>
				</div>
				<button onclick={cerrarModal} aria-label="Cerrar" class="rounded-lg p-2 text-white/80 transition-colors hover:bg-white/20 hover:text-white">
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto px-8 py-6">
				<!-- ═══ SECCIÓN 1: Identificación ═══ -->
				<div class="mb-8">
					<div class="mb-5 flex items-center gap-3">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-sm font-bold text-red-600">1</div>
						<h3 class="text-lg font-bold text-gray-900">Identificación de la Salida No Conforme</h3>
					</div>

					<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
						<!-- Número SNC (auto) -->
						<div>
							<!-- svelte-ignore a11y_label_has_associated_control -->
						<label class="mb-1.5 block text-sm font-medium text-gray-700">N° de SNC</label>
							<input type="text" value="SNC-{String(siguienteNumero).padStart(4, '0')}" disabled class="w-full rounded-lg border border-gray-200 bg-gray-100 px-4 py-2.5 text-gray-500" />
						</div>

						<!-- Fecha detección -->
						<div>
							<label for="fecha_deteccion" class="mb-1.5 block text-sm font-medium text-gray-700">
								Fecha Detección <span class="text-red-500">*</span>
							</label>
							<input id="fecha_deteccion" type="date" bind:value={form.fecha_deteccion} class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<!-- Fecha evento -->
						<div>
							<label for="fecha_evento" class="mb-1.5 block text-sm font-medium text-gray-700">
								Fecha del Evento <span class="text-red-500">*</span>
							</label>
							<input id="fecha_evento" type="date" bind:value={form.fecha_evento} class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<!-- Detectado por -->
						<div>
							<label for="detectado_por" class="mb-1.5 block text-sm font-medium text-gray-700">
								Detectado por <span class="text-red-500">*</span>
							</label>
							<input id="detectado_por" type="text" bind:value={form.detectado_por} placeholder="Nombre de quien detecta" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<!-- Área / Proceso -->
						<div>
							<label for="area_proceso" class="mb-1.5 block text-sm font-medium text-gray-700">
								Área / Proceso <span class="text-red-500">*</span>
							</label>
							<input id="area_proceso" type="text" bind:value={form.area_proceso} placeholder="Ej: Operaciones, Logística" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<!-- Tipo de Detección -->
						<div>
							<label for="tipo_deteccion" class="mb-1.5 block text-sm font-medium text-gray-700">
								Tipo de Detección <span class="text-red-500">*</span>
							</label>
							<select id="tipo_deteccion" bind:value={form.tipo_deteccion} class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20">
								<option value="">Seleccione...</option>
								{#each Object.entries(TIPO_DETECCION_LABELS) as [val, label]}
									<option value={val}>{label}</option>
								{/each}
							</select>
						</div>

						{#if form.tipo_deteccion === 'OTRO'}
							<div>
								<label for="tipo_deteccion_otro" class="mb-1.5 block text-sm font-medium text-gray-700">Especifique tipo</label>
								<input id="tipo_deteccion_otro" type="text" bind:value={form.tipo_deteccion_otro} placeholder="Detalle el tipo de detección" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
							</div>
						{/if}

						<!-- Conductor nombre -->
						<div>
							<label for="conductor_nombre" class="mb-1.5 block text-sm font-medium text-gray-700">Nombre Conductor</label>
							<input id="conductor_nombre" type="text" bind:value={form.conductor_nombre} placeholder="Nombre y apellido" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<!-- Conductor cédula -->
						<div>
							<label for="conductor_cedula" class="mb-1.5 block text-sm font-medium text-gray-700">Cédula Conductor</label>
							<input id="conductor_cedula" type="text" bind:value={form.conductor_cedula} placeholder="Número de cédula" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<!-- Placa vehículo -->
						<div>
							<label for="vehiculo_placa" class="mb-1.5 block text-sm font-medium text-gray-700">Placa Vehículo</label>
							<input id="vehiculo_placa" type="text" bind:value={form.vehiculo_placa} placeholder="Ej: ABC123" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<!-- Ruta/Trayecto -->
						<div>
							<label for="ruta_trayecto" class="mb-1.5 block text-sm font-medium text-gray-700">Ruta / Trayecto</label>
							<input id="ruta_trayecto" type="text" bind:value={form.ruta_trayecto} placeholder="Ej: Yopal - Tauramena" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<!-- Turno/Horario -->
						<div>
							<label for="turno_horario" class="mb-1.5 block text-sm font-medium text-gray-700">Turno / Horario</label>
							<input id="turno_horario" type="text" bind:value={form.turno_horario} placeholder="Ej: 06:00 - 18:00" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<!-- Cliente / Contrato -->
						<div>
							<label for="cliente_contrato" class="mb-1.5 block text-sm font-medium text-gray-700">Cliente / Contrato</label>
							<input id="cliente_contrato" type="text" bind:value={form.cliente_contrato} placeholder="Nombre del cliente o descripción del contrato" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>
					</div>

					<!-- Servicio Afectado (textarea full width) -->
					<div class="mt-4">
						<label for="servicio_afectado" class="mb-1.5 block text-sm font-medium text-gray-700">Servicio Afectado</label>
						<textarea id="servicio_afectado" bind:value={form.servicio_afectado} rows="2" placeholder="Descripción del servicio contratado que fue afectado..." class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20"></textarea>
					</div>
				</div>

				<!-- ═══ SECCIÓN 2: Descripción de la NC ═══ -->
				<div class="mb-6">
					<div class="mb-5 flex items-center gap-3">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-sm font-bold text-red-600">2</div>
						<h3 class="text-lg font-bold text-gray-900">Descripción de la Salida No Conforme <span class="text-sm font-normal text-gray-500">(ISO 8.7.2 a)</span></h3>
					</div>

					<!-- Descripción detallada -->
					<div class="mb-4">
						<label for="descripcion_nc" class="mb-1.5 block text-sm font-medium text-gray-700">
							Descripción detallada de la NC <span class="text-red-500">*</span>
						</label>
						<p class="mb-2 text-xs text-gray-500">
							Describa con precisión: ¿Qué requisito fue incumplido? ¿Cómo se manifestó? ¿Cuál es el impacto en el cliente o en el servicio?
						</p>
						<textarea id="descripcion_nc" bind:value={form.descripcion_nc} rows="4" placeholder="Descripción detallada de la no conformidad..." class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20"></textarea>
					</div>

					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<!-- Clasificación NC -->
						<div>
							<label for="clasificacion_nc" class="mb-1.5 block text-sm font-medium text-gray-700">
								Clasificación de la NC <span class="text-red-500">*</span>
							</label>
							<select id="clasificacion_nc" bind:value={form.clasificacion_nc} class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20">
								<option value="">Seleccione...</option>
								{#each Object.entries(CLASIFICACION_LABELS) as [val, info]}
									<option value={val}>{info.label} — {info.description}</option>
								{/each}
							</select>
							{#if form.clasificacion_nc}
								<p class="mt-1.5 text-xs {form.clasificacion_nc === 'CRITICA' ? 'text-red-600' : form.clasificacion_nc === 'MAYOR' ? 'text-orange-600' : 'text-yellow-600'}">
									{CLASIFICACION_LABELS[form.clasificacion_nc]?.description}
									{#if form.clasificacion_nc === 'CRITICA' || form.clasificacion_nc === 'MAYOR'}
										— <strong>Se abre Acción Correctiva</strong>
									{/if}
								</p>
							{/if}
						</div>

						<!-- Tipo de Salida NC -->
						<div>
							<label for="tipo_salida_nc" class="mb-1.5 block text-sm font-medium text-gray-700">
								Tipo de Salida No Conforme <span class="text-red-500">*</span>
							</label>
							<select id="tipo_salida_nc" bind:value={form.tipo_salida_nc} class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20">
								<option value="">Seleccione...</option>
								{#each Object.entries(TIPO_SALIDA_NC_LABELS) as [val, label]}
									<option value={val}>{label}</option>
								{/each}
							</select>
						</div>
					</div>

					{#if form.tipo_salida_nc === 'OTRO'}
						<div class="mt-4">
							<label for="tipo_salida_nc_otro" class="mb-1.5 block text-sm font-medium text-gray-700">Especifique el tipo</label>
							<input id="tipo_salida_nc_otro" type="text" bind:value={form.tipo_salida_nc_otro} placeholder="Detalle el tipo de salida no conforme" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>
					{/if}

					<!-- Observaciones -->
					<div class="mt-4">
						<label for="observaciones" class="mb-1.5 block text-sm font-medium text-gray-700">Observaciones</label>
						<textarea id="observaciones" bind:value={form.observaciones} rows="2" placeholder="Observaciones adicionales..." class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20"></textarea>
					</div>
				</div>

				<!-- ═══ SECCIÓN 3: Tratamiento Aplicado (ISO 8.7.1 a-d / 8.7.2 b-c) ═══ -->
				<div class="mb-6">
					<div class="mb-5 flex items-center gap-3">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-sm font-bold text-red-600">3</div>
						<h3 class="text-lg font-bold text-gray-900">Tratamiento Aplicado <span class="text-sm font-normal text-gray-500">(ISO 8.7.1 a-d / 8.7.2 b-c)</span></h3>
					</div>

					<!-- Tratamiento seleccionado -->
					<div class="mb-4">
						<label for="tratamiento_seleccionado" class="mb-1.5 block text-sm font-medium text-gray-700">
							Tratamiento Seleccionado <span class="text-sm font-normal text-gray-400">(ISO 8.7.1)</span>
						</label>
						<select id="tratamiento_seleccionado" bind:value={form.tratamiento_seleccionado} class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20">
							<option value="">Seleccione...</option>
							{#each Object.entries(TRATAMIENTO_SNC_LABELS) as [val, info]}
								<option value={val}>{info.label} — {info.description}</option>
							{/each}
						</select>
						{#if form.tratamiento_seleccionado && TRATAMIENTO_SNC_LABELS[form.tratamiento_seleccionado]}
							<p class="mt-1.5 text-xs text-blue-600">
								<strong>{TRATAMIENTO_SNC_LABELS[form.tratamiento_seleccionado].label}:</strong>
								{TRATAMIENTO_SNC_LABELS[form.tratamiento_seleccionado].description}
							</p>
						{/if}
					</div>

					<!-- Descripción de la acción tomada -->
					<div class="mb-4">
						<label for="descripcion_accion_tomada" class="mb-1.5 block text-sm font-medium text-gray-700">
							Descripción de la Acción Tomada <span class="text-sm font-normal text-gray-400">(ISO 8.7.2 b)</span>
						</label>
						<p class="mb-2 text-xs text-gray-500">
							Describa detalladamente la acción implementada, los recursos utilizados y el tiempo de respuesta
						</p>
						<textarea id="descripcion_accion_tomada" bind:value={form.descripcion_accion_tomada} rows="4" placeholder="Detalle de la acción implementada, recursos utilizados, tiempo de respuesta..." class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20"></textarea>
					</div>

					<!-- Responsable, Fecha, Autoridad -->
					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div>
							<label for="responsable_accion" class="mb-1.5 block text-sm font-medium text-gray-700">
								Responsable de la Acción
							</label>
							<input id="responsable_accion" type="text" bind:value={form.responsable_accion} placeholder="Nombre y cargo" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<div>
							<label for="fecha_implementacion" class="mb-1.5 block text-sm font-medium text-gray-700">
								Fecha de Implementación
							</label>
							<input id="fecha_implementacion" type="date" bind:value={form.fecha_implementacion} class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>

						<div>
							<label for="autoridad_disposicion" class="mb-1.5 block text-sm font-medium text-gray-700">
								Autoridad que Decidió
							</label>
							<input id="autoridad_disposicion" type="text" bind:value={form.autoridad_disposicion} placeholder="Cargo o nombre de quien autorizó" class="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-gray-900 focus:border-red-400 focus:ring-2 focus:ring-red-400/20" />
						</div>
					</div>
				</div>

				<!-- ═══ SECCIÓN 4: Concesión Formal del Cliente (ISO 8.7.1 d / 8.7.2 c) ═══ -->
				<!-- Solo visible si tratamiento_seleccionado === CONCESION -->
				{#if form.tratamiento_seleccionado === 'CONCESION'}
					<div class="mb-6 rounded-xl border border-amber-200 bg-amber-50/50 p-6" transition:fly={{ y: 10, duration: 200 }}>
						<div class="mb-5 flex items-center gap-3">
							<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-sm font-bold text-amber-600">4</div>
							<h3 class="text-lg font-bold text-gray-900">Concesión Formal del Cliente <span class="text-sm font-normal text-gray-500">(ISO 8.7.1 d / 8.7.2 c)</span></h3>
						</div>

						<!-- ¿Se solicitó concesión? -->
						<div class="mb-4">
							<!-- svelte-ignore a11y_label_has_associated_control -->
							<label class="mb-1.5 block text-sm font-medium text-gray-700">¿Se solicitó concesión?</label>
							<div class="flex items-center gap-6">
								<label class="flex cursor-pointer items-center gap-2">
									<input type="radio" bind:group={form.concesion_solicitada} value={true} class="h-4 w-4 text-amber-500 focus:ring-amber-400" />
									<span class="text-sm font-medium text-gray-700">Sí</span>
								</label>
								<label class="flex cursor-pointer items-center gap-2">
									<input type="radio" bind:group={form.concesion_solicitada} value={false} class="h-4 w-4 text-amber-500 focus:ring-amber-400" />
									<span class="text-sm font-medium text-gray-700">No</span>
								</label>
							</div>
							<p class="mt-1.5 text-xs text-amber-700">
								⚠️ La concesión <strong>NO aplica</strong> cuando hay riesgo para la seguridad de las personas, salud o medio ambiente.
							</p>
						</div>

						{#if form.concesion_solicitada}
							<!-- Condiciones de la concesión -->
							<div class="mb-4" transition:fly={{ y: 10, duration: 200 }}>
								<label for="condiciones_concesion" class="mb-1.5 block text-sm font-medium text-gray-700">
									Condiciones de la Concesión
								</label>
								<p class="mb-2 text-xs text-gray-500">
									Describa las condiciones bajo las cuales el cliente autoriza a continuar el servicio
								</p>
								<textarea id="condiciones_concesion" bind:value={form.condiciones_concesion} rows="3" placeholder="Condiciones bajo las cuales el cliente autoriza continuar el servicio..." class="w-full rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-gray-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"></textarea>
							</div>

							<!-- Autorización del cliente -->
							<div class="grid grid-cols-1 gap-4 md:grid-cols-3" transition:fly={{ y: 10, duration: 200 }}>
								<div>
									<label for="concesion_cliente_nombre" class="mb-1.5 block text-sm font-medium text-gray-700">
										Representante del Cliente
									</label>
									<input id="concesion_cliente_nombre" type="text" bind:value={form.concesion_cliente_nombre} placeholder="Nombre del representante" class="w-full rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-gray-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" />
								</div>

								<div>
									<label for="concesion_cliente_fecha" class="mb-1.5 block text-sm font-medium text-gray-700">
										Fecha de Autorización
									</label>
									<input id="concesion_cliente_fecha" type="date" bind:value={form.concesion_cliente_fecha} class="w-full rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-gray-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20" />
								</div>

								<div>
									<label for="concesion_medio" class="mb-1.5 block text-sm font-medium text-gray-700">
										Medio de Autorización
									</label>
									<select id="concesion_medio" bind:value={form.concesion_medio} class="w-full rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-gray-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20">
										<option value="">Seleccione...</option>
										{#each Object.entries(MEDIO_AUTORIZACION_LABELS) as [val, label]}
											<option value={val}>{label}</option>
										{/each}
									</select>
								</div>
							</div>
						{/if}
					</div>
				{/if}

				<!-- ═══ SECCIÓN 5: Verificación de Conformidad Post-Corrección (ISO 8.7.1 párrafo final) ═══ -->
				<div class="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50/80 to-cyan-50/50 p-6">
					<div class="mb-4 flex items-center gap-3">
						<div class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">5</div>
						<div>
							<h3 class="text-lg font-bold text-gray-900">Verificación de Conformidad <span class="text-sm font-normal text-gray-500">(ISO 8.7.1 párrafo final)</span></h3>
							<p class="text-xs text-gray-500">Obligatoria — Confirma si la salida NC fue resuelta conforme a requisitos</p>
						</div>
					</div>

					<!-- Método de verificación -->
					<div class="mb-4">
						<!-- svelte-ignore a11y-label-has-associated-control -->
						<label class="mb-1.5 block text-sm font-medium text-gray-700">Método de Verificación</label>
						<select bind:value={form.metodo_verificacion} class="w-full rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-gray-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20">
							<option value="">Seleccione método...</option>
							{#each Object.entries(METODO_VERIFICACION_LABELS) as [val, label]}
								<option value={val}>{label}</option>
							{/each}
						</select>
					</div>

					<!-- Otro método (condicional) -->
					{#if form.metodo_verificacion === 'OTRO'}
						<div class="mb-4" transition:fly={{ y: -10, duration: 200 }}>
							<label for="metodo_verificacion_otro" class="mb-1.5 block text-sm font-medium text-gray-700">Especifique el método</label>
							<input id="metodo_verificacion_otro" type="text" bind:value={form.metodo_verificacion_otro} placeholder="Describir método de verificación utilizado..." class="w-full rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-gray-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
						</div>
					{/if}

					<!-- Resultado de la verificación -->
					<div class="mb-4">
						<label for="resultado_verificacion" class="mb-1.5 block text-sm font-medium text-gray-700">Resultado de la Verificación</label>
						<textarea id="resultado_verificacion" bind:value={form.resultado_verificacion} rows="3" placeholder="Describa los hallazgos de la verificación realizada..." class="w-full rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-gray-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"></textarea>
						<p class="mt-1 text-xs text-gray-400">Incluya evidencias, mediciones o registros que respalden el resultado</p>
					</div>

					<!-- ¿Cumple requisitos? -->
					<div class="mb-4">
						<!-- svelte-ignore a11y-label-has-associated-control -->
						<label class="mb-2 block text-sm font-medium text-gray-700">¿Cumple requisitos después del tratamiento?</label>
						<div class="flex gap-6">
							<label class="flex cursor-pointer items-center gap-2">
								<input type="radio" bind:group={form.cumple_requisitos} value="SI" class="h-4 w-4 border-gray-300 text-green-600 focus:ring-green-500" />
								<span class="text-sm font-medium text-green-700">✅ Sí — Cierre de la SNC</span>
							</label>
							<label class="flex cursor-pointer items-center gap-2">
								<input type="radio" bind:group={form.cumple_requisitos} value="NO" class="h-4 w-4 border-gray-300 text-red-600 focus:ring-red-500" />
								<span class="text-sm font-medium text-red-700">❌ No — Escalar AC</span>
							</label>
						</div>

						{#if form.cumple_requisitos === 'SI'}
							<div class="mt-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800" transition:fly={{ y: -5, duration: 200 }}>
								✅ La salida no conforme será <strong>cerrada</strong>. El servicio cumple con los requisitos especificados.
							</div>
						{:else if form.cumple_requisitos === 'NO'}
							<div class="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" transition:fly={{ y: -5, duration: 200 }}>
								⚠️ Se debe escalar como <strong>Acción Correctiva</strong> según procedimiento <strong>HSEQ-PR-03</strong>.
							</div>
						{/if}
					</div>

					<!-- Responsable, Fecha, Firma -->
					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div>
							<label for="responsable_verificacion" class="mb-1.5 block text-sm font-medium text-gray-700">Responsable (nombre y cargo)</label>
							<input id="responsable_verificacion" type="text" bind:value={form.responsable_verificacion} placeholder="Nombre — Cargo" class="w-full rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-gray-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
						</div>
						<div>
							<label for="fecha_verificacion" class="mb-1.5 block text-sm font-medium text-gray-700">Fecha de Verificación</label>
							<input id="fecha_verificacion" type="date" bind:value={form.fecha_verificacion} class="w-full rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-gray-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
						</div>
						<div>
							<label for="firma_verificacion" class="mb-1.5 block text-sm font-medium text-gray-700">Firma del Verificador</label>
							<input id="firma_verificacion" type="text" bind:value={form.firma_verificacion} placeholder="Nombre completo" class="w-full rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-gray-900 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
						</div>
					</div>
				</div>
			</div>

			<!-- Footer del modal -->
			<div class="flex shrink-0 items-center justify-end gap-3 rounded-b-2xl border-t border-gray-200 bg-gray-50 px-8 py-4">
				<button onclick={cerrarModal} class="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
					Cancelar
				</button>
				<button
					onclick={guardar}
					disabled={isSaving}
					class="apple-transition flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-red-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-red-500/30 hover:from-red-600 hover:to-red-700 disabled:opacity-50"
				>
					{#if isSaving}
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
					{/if}
					{modoEdicion ? 'Actualizar' : 'Registrar'} SNC
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal de confirmación de eliminación -->
{#if showDeleteModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" transition:fade={{ duration: 200 }}>
		<div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" in:fly={{ y: 20, duration: 300 }}>
			<div class="mb-4 flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
					<svg class="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
				</div>
				<div>
					<h3 class="text-lg font-bold text-gray-900">Eliminar Salida No Conforme</h3>
					<p class="text-sm text-gray-600">
						¿Está seguro de eliminar SNC-{salidaEliminar ? String(salidaEliminar.numero).padStart(4, '0') : ''}?
					</p>
				</div>
			</div>
			<div class="flex justify-end gap-3">
				<button onclick={() => { showDeleteModal = false; salidaEliminar = null; }} class="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
					Cancelar
				</button>
				<button onclick={confirmarEliminacion} class="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600">
					Eliminar
				</button>
			</div>
		</div>
	</div>
{/if}
