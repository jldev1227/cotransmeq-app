<script lang="ts">
	/**
	 * Centro de cumplimiento PESV.
	 *
	 * Esta ruta es un ORQUESTADOR: resuelve período, permisos y navegación, y
	 * delega cada vista en su componente. Antes era un único archivo de casi tres
	 * mil líneas con gráficas, tabla y modales mezclados; cualquier cambio en una
	 * parte obligaba a leerlo entero.
	 *
	 * Siete vistas: resumen, matriz de los 24 pasos, indicadores, operación
	 * segura, documentos, plan anual y contratos/FUEC. Más `historico`, que
	 * conserva la tabla de registros diarios del panel anterior **en solo
	 * lectura**: la información no se pierde, pero el registro manual de
	 * preoperacional ya no se ofrece porque Formularios Dinámicos es la fuente
	 * oficial y dos caminos de captura significan dos verdades.
	 *
	 * La URL es la fuente de verdad de los filtros (`src/lib/listing/`): vista,
	 * período, panel, estado y búsqueda viajan en ella, así que recargar, volver
	 * atrás o compartir un enlace llevan al mismo sitio.
	 */
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { firma, leerDeParams, numero, opcion, texto } from '$lib/listing/filtros';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { toast } from '$lib/stores/toast';

	import BandejaEvidencias from '$lib/components/pesv/BandejaEvidencias.svelte';
	import DetalleIndicador from '$lib/components/pesv/DetalleIndicador.svelte';
	import DetallePasoDialogo from '$lib/components/pesv/DetallePaso.svelte';
	import EstadoPanel from '$lib/components/pesv/EstadoPanel.svelte';
	import MatrizPasos from '$lib/components/pesv/MatrizPasos.svelte';
	import PanelOperacion from '$lib/components/pesv/PanelOperacion.svelte';
	import PlanAnual from '$lib/components/pesv/PlanAnual.svelte';
	import ResumenCumplimiento from '$lib/components/pesv/ResumenCumplimiento.svelte';
	import TablaCoberturaFuec from '$lib/components/pesv/TablaCoberturaFuec.svelte';
	import TablaDocumentos from '$lib/components/pesv/TablaDocumentos.svelte';
	import TarjetaIndicador from '$lib/components/pesv/TarjetaIndicador.svelte';

	import {
		crearCiclo,
		importarExtractos,
		listarEvidencias,
		listarFormaciones,
		listarMetas,
		listarProgramas,
		listarRiesgos,
		obtenerCoberturaFuec,
		obtenerCumplimiento,
		obtenerDetallePaso,
		obtenerDocumentos,
		obtenerIndicadores,
		obtenerOperacion,
		obtenerPermisos,
		obtenerResumen,
		revisarDocumento
	} from '$lib/api/pesv-centro';
	import { listarActividadesPesv } from '$lib/api/actividadesPesv';
	import { obtenerRegistrosDiarios } from '$lib/api/pesv';
	import type { ActividadPesv } from '$lib/types/actividadesPesv';
	import type { RegistroDiarioPesv } from '$lib/types/pesv';
	import type {
		DetallePaso,
		EvidenciaBandeja,
		FormacionPesv,
		MetaPesv,
		PermisosPesv,
		ProgramaPesv,
		RespuestaCobertura,
		RespuestaCumplimiento,
		RespuestaDocumentos,
		RespuestaOperacion,
		ResultadoIndicador,
		ResumenPesv,
		RiesgoPesv
	} from '$lib/types/pesv-centro';
	import { formatearInstante } from '$lib/components/pesv/estados';

	type Vista =
		| 'resumen'
		| 'matriz'
		| 'indicadores'
		| 'operacion'
		| 'documentos'
		| 'plan'
		| 'contratos'
		| 'historico';

	const VISTAS: Array<{ id: Vista; etiqueta: string; descripcion: string }> = [
		{ id: 'resumen', etiqueta: 'Resumen', descripcion: 'Avance global y alertas accionables' },
		{ id: 'matriz', etiqueta: '24 pasos', descripcion: 'Matriz normativa y evidencias' },
		{
			id: 'indicadores',
			etiqueta: 'Indicadores',
			descripcion: 'Las 13 fichas con fórmula y procedencia'
		},
		{
			id: 'operacion',
			etiqueta: 'Operación segura',
			descripcion: 'Inspecciones, velocidad, mantenimiento y siniestros'
		},
		{ id: 'documentos', etiqueta: 'Documentos', descripcion: 'Vencimientos y estado de revisión' },
		{
			id: 'plan',
			etiqueta: 'Plan anual',
			descripcion: 'Actividades, metas, programas y formación'
		},
		{
			id: 'contratos',
			etiqueta: 'Contratos y FUEC',
			descripcion: 'Cobertura contractual por servicio'
		},
		{
			id: 'historico',
			etiqueta: 'Histórico',
			descripcion: 'Registros del panel anterior, en solo lectura'
		}
	];

	const hoy = new Date();

	/**
	 * Definiciones de filtro.
	 *
	 * Los valores por defecto NO se escriben en la URL: una URL limpia y una con
	 * todos los defectos describen el mismo estado.
	 */
	const DEFS = {
		vista: opcion<Vista>('resumen'),
		anio: numero(hoy.getFullYear()),
		trimestre: numero(0),
		mes: numero(0),
		panel: texto(),
		estado: texto(),
		estadoEvidencia: texto(),
		estadoVigencia: texto(),
		ambito: texto(),
		fase: texto(),
		area: texto(),
		indicador: texto(),
		paso: numero(0),
		mias: opcion('no'),
		q: texto()
	};

	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state(
		leerDeParams(DEFS, new URLSearchParams(browser ? window.location.search : ''))
	);

	$effect(() => {
		/// Depende de la FIRMA, no del objeto: un `$state` es un proxy y leer el
		/// objeto no suscribe a sus propiedades, así que `void filtros` dejaría la
		/// URL congelada mientras la vista sí cambia.
		void firma(DEFS, filtros);
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	// ── Estado de carga por vista ────────────────────────────────────────

	let permisos = $state<PermisosPesv | null>(null);
	let errorPermisos = $state<string | null>(null);

	let resumen = $state<ResumenPesv | null>(null);
	let cargandoResumen = $state(false);
	let errorResumen = $state<string | null>(null);

	let cumplimiento = $state<RespuestaCumplimiento | null>(null);
	let cargandoMatriz = $state(false);
	let errorMatriz = $state<string | null>(null);

	let evidencias = $state<EvidenciaBandeja[]>([]);
	let cargandoEvidencias = $state(false);
	let errorEvidencias = $state<string | null>(null);

	let indicadores = $state<ResultadoIndicador[]>([]);
	let cargandoIndicadores = $state(false);
	let errorIndicadores = $state<string | null>(null);

	let operacion = $state<RespuestaOperacion | null>(null);
	let cargandoOperacion = $state(false);
	let errorOperacion = $state<string | null>(null);

	let documentos = $state<RespuestaDocumentos | null>(null);
	let cargandoDocumentos = $state(false);
	let errorDocumentos = $state<string | null>(null);

	let cobertura = $state<RespuestaCobertura | null>(null);
	let cargandoCobertura = $state(false);
	let errorCobertura = $state<string | null>(null);

	let actividades = $state<ActividadPesv[]>([]);
	let metas = $state<MetaPesv[]>([]);
	let programas = $state<ProgramaPesv[]>([]);
	let formaciones = $state<FormacionPesv[]>([]);
	let riesgos = $state<RiesgoPesv[]>([]);
	let cargandoPlan = $state(false);
	let errorPlan = $state<string | null>(null);

	let historico = $state<RegistroDiarioPesv[]>([]);
	let cargandoHistorico = $state(false);
	let errorHistorico = $state<string | null>(null);

	let pasoAbierto = $state<DetallePaso | null>(null);
	let indicadorAbierto = $state<ResultadoIndicador | null>(null);
	let creandoCiclo = $state(false);

	/// Un `AbortController` por vista: cambiar de período mientras una consulta
	/// está en vuelo cancela la anterior, y así una respuesta lenta no pisa a la
	/// que el usuario acaba de pedir.
	const controladores = new Map<string, AbortController>();

	function controlador(clave: string): AbortSignal {
		controladores.get(clave)?.abort();
		const nuevo = new AbortController();
		controladores.set(clave, nuevo);
		return nuevo.signal;
	}

	function esCancelacion(error: unknown): boolean {
		const e = error as { name?: string; code?: string };
		return e?.name === 'CanceledError' || e?.name === 'AbortError' || e?.code === 'ERR_CANCELED';
	}

	function mensaje(error: unknown, respaldo: string): string {
		const e = error as {
			response?: { data?: { error?: { message?: string } } };
			message?: string;
		};
		return e?.response?.data?.error?.message ?? e?.message ?? respaldo;
	}

	/** Período actual, con 0 como «no filtrado». */
	const periodo = $derived({
		anio: filtros.anio,
		trimestre: filtros.trimestre || null,
		mes: filtros.mes || null
	});

	// ── Cargas ───────────────────────────────────────────────────────────

	$effect(() => {
		if (!browser) return;
		void cargarPermisos();
	});

	async function cargarPermisos() {
		try {
			permisos = await obtenerPermisos(controlador('permisos'));
			errorPermisos = null;
		} catch (error) {
			if (esCancelacion(error)) return;
			errorPermisos = mensaje(error, 'No se pudieron consultar sus permisos sobre el módulo.');
		}
	}

	/**
	 * Carga solo la vista visible.
	 *
	 * Cada vista carga por su cuenta y su skeleton no bloquea la ruta entera: el
	 * resumen ya se ve mientras la matriz sigue viniendo.
	 */
	$effect(() => {
		if (!browser) return;
		const vista = filtros.vista;
		const p = { anio: filtros.anio, trimestre: filtros.trimestre, mes: filtros.mes };
		void p;

		switch (vista) {
			case 'resumen':
				void cargarResumen();
				break;
			case 'matriz':
				void cargarMatriz();
				void cargarEvidencias();
				break;
			case 'indicadores':
				void cargarIndicadores();
				break;
			case 'operacion':
				void cargarOperacion();
				break;
			case 'documentos':
				void cargarDocumentos();
				break;
			case 'plan':
				void cargarPlan();
				break;
			case 'contratos':
				void cargarCobertura();
				break;
			case 'historico':
				void cargarHistorico();
				break;
		}
	});

	async function cargarResumen() {
		cargandoResumen = true;
		errorResumen = null;
		try {
			resumen = await obtenerResumen(periodo, controlador('resumen'));
		} catch (error) {
			if (esCancelacion(error)) return;
			errorResumen = mensaje(error, 'No se pudo cargar el resumen del período.');
		} finally {
			cargandoResumen = false;
		}
	}

	async function cargarMatriz() {
		cargandoMatriz = true;
		errorMatriz = null;
		try {
			cumplimiento = await obtenerCumplimiento(
				{
					anio: filtros.anio,
					fase: filtros.fase || undefined,
					estado: filtros.estado || undefined,
					area: filtros.area || undefined,
					q: filtros.q || undefined
				},
				controlador('matriz')
			);
		} catch (error) {
			if (esCancelacion(error)) return;
			cumplimiento = null;
			errorMatriz = mensaje(error, 'No se pudo cargar la matriz de cumplimiento.');
		} finally {
			cargandoMatriz = false;
		}
	}

	async function cargarEvidencias() {
		cargandoEvidencias = true;
		errorEvidencias = null;
		try {
			evidencias = await listarEvidencias(
				{
					anio: filtros.anio,
					estado: filtros.estadoEvidencia || undefined,
					mias: filtros.mias === 'si'
				},
				controlador('evidencias')
			);
		} catch (error) {
			if (esCancelacion(error)) return;
			evidencias = [];
			errorEvidencias = mensaje(error, 'No se pudo cargar la bandeja de evidencias.');
		} finally {
			cargandoEvidencias = false;
		}
	}

	async function cargarIndicadores() {
		cargandoIndicadores = true;
		errorIndicadores = null;
		try {
			const respuesta = await obtenerIndicadores(periodo, controlador('indicadores'));
			indicadores = respuesta.indicadores;
		} catch (error) {
			if (esCancelacion(error)) return;
			indicadores = [];
			errorIndicadores = mensaje(error, 'No se pudieron calcular los indicadores.');
		} finally {
			cargandoIndicadores = false;
		}
	}

	async function cargarOperacion() {
		cargandoOperacion = true;
		errorOperacion = null;
		try {
			operacion = await obtenerOperacion(periodo, controlador('operacion'));
		} catch (error) {
			if (esCancelacion(error)) return;
			operacion = null;
			errorOperacion = mensaje(error, 'No se pudo cargar la operación del período.');
		} finally {
			cargandoOperacion = false;
		}
	}

	async function cargarDocumentos() {
		cargandoDocumentos = true;
		errorDocumentos = null;
		try {
			documentos = await obtenerDocumentos(
				{
					ambito: filtros.ambito || undefined,
					estadoVigencia: filtros.estadoVigencia || undefined,
					q: filtros.q || undefined
				},
				controlador('documentos')
			);
		} catch (error) {
			if (esCancelacion(error)) return;
			documentos = null;
			errorDocumentos = mensaje(error, 'No se pudieron cargar los vencimientos documentales.');
		} finally {
			cargandoDocumentos = false;
		}
	}

	async function cargarCobertura() {
		cargandoCobertura = true;
		errorCobertura = null;
		try {
			cobertura = await obtenerCoberturaFuec(
				{ ...periodo, estado: filtros.estado || undefined },
				controlador('cobertura')
			);
		} catch (error) {
			if (esCancelacion(error)) return;
			cobertura = null;
			errorCobertura = mensaje(error, 'No se pudo evaluar la cobertura contractual.');
		} finally {
			cargandoCobertura = false;
		}
	}

	async function cargarPlan() {
		cargandoPlan = true;
		errorPlan = null;
		const senal = controlador('plan');
		try {
			/// Las actividades vienen del módulo que ya existía; el resto, del
			/// centro. Se piden en paralelo: son independientes.
			const [act, met, prog, form, ries] = await Promise.all([
				listarActividadesPesv({
					anio: filtros.anio,
					estado: filtros.estado || undefined,
					limit: 500
				}),
				listarMetas(filtros.anio, senal).catch(() => [] as MetaPesv[]),
				listarProgramas(filtros.anio, senal).catch(() => [] as ProgramaPesv[]),
				listarFormaciones(filtros.anio, senal).catch(() => [] as FormacionPesv[]),
				listarRiesgos(filtros.anio, senal).catch(() => [] as RiesgoPesv[])
			]);
			actividades = act.actividades ?? [];
			metas = met;
			programas = prog;
			formaciones = form;
			riesgos = ries;
		} catch (error) {
			if (esCancelacion(error)) return;
			errorPlan = mensaje(error, 'No se pudo cargar el plan anual.');
		} finally {
			cargandoPlan = false;
		}
	}

	async function cargarHistorico() {
		cargandoHistorico = true;
		errorHistorico = null;
		try {
			const respuesta = await obtenerRegistrosDiarios({
				mes: filtros.mes || hoy.getMonth() + 1,
				anio: filtros.anio
			});
			historico = respuesta.data ?? [];
		} catch (error) {
			if (esCancelacion(error)) return;
			historico = [];
			errorHistorico = mensaje(error, 'No se pudieron cargar los registros históricos.');
		} finally {
			cargandoHistorico = false;
		}
	}

	// ── Acciones ─────────────────────────────────────────────────────────

	function irA(vista: string, extra: Record<string, string> = {}) {
		filtros = { ...filtros, vista: vista as Vista, ...(extra as Partial<typeof filtros>) };
	}

	async function abrirPaso(paso: number) {
		try {
			pasoAbierto = await obtenerDetallePaso(paso, filtros.anio);
			filtros = { ...filtros, paso };
		} catch (error) {
			toast.error(mensaje(error, 'No se pudo abrir el detalle del paso.'));
		}
	}

	function cerrarPaso() {
		pasoAbierto = null;
		filtros = { ...filtros, paso: 0 };
	}

	async function refrescarPaso() {
		if (!pasoAbierto) return;
		const numeroPaso = pasoAbierto.stepNumber;
		pasoAbierto = await obtenerDetallePaso(numeroPaso, filtros.anio);
		await cargarMatriz();
		await cargarEvidencias();
	}

	function abrirIndicador(codigo: string) {
		indicadorAbierto = indicadores.find((i) => i.code === codigo) ?? null;
		filtros = { ...filtros, indicador: codigo };
	}

	function cerrarIndicador() {
		indicadorAbierto = null;
		filtros = { ...filtros, indicador: '' };
	}

	async function crearCicloDelAnio() {
		if (creandoCiclo) return;
		creandoCiclo = true;
		try {
			await crearCiclo({ anio: filtros.anio });
			toast.success(
				`Ciclo ${filtros.anio} creado con los 24 pasos en estado pendiente. Ninguno nace cumplido.`
			);
			await cargarResumen();
		} catch (error) {
			toast.error(mensaje(error, 'No se pudo crear el ciclo.'));
		} finally {
			creandoCiclo = false;
		}
	}

	async function revisarDoc(id: string, decision: 'APROBADO' | 'RECHAZADO') {
		let observacion: string | undefined;
		if (decision === 'RECHAZADO') {
			/// Un rechazo exige observación —el servidor lo comprueba— así que se
			/// pide antes de mandarlo y no se descubre con un 422.
			const escrita = window.prompt('Motivo del rechazo (obligatorio):');
			if (!escrita?.trim()) return;
			observacion = escrita.trim();
		}
		try {
			await revisarDocumento(id, decision, observacion);
			toast.success(decision === 'APROBADO' ? 'Documento aprobado.' : 'Documento rechazado.');
			await cargarDocumentos();
		} catch (error) {
			toast.error(mensaje(error, 'No se pudo registrar la decisión.'));
		}
	}

	async function ejecutarImportacion() {
		try {
			const informe = await importarExtractos({ simulacion: true });
			toast.success(
				`Simulación: ${informe.filasLeidas} filas leídas, ${informe.importadas} se importarían, ` +
					`${informe.yaExistian} ya existen y ${informe.aConciliacion} irían a conciliación.`
			);
		} catch (error) {
			toast.error(mensaje(error, 'No se pudo simular la importación.'));
		}
	}

	const MESES = [
		'Todos los meses',
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

	const anios = $derived(
		Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - 4 + i).filter(
			(a) => a <= hoy.getFullYear() + 1
		)
	);
</script>

<svelte:head>
	<title>PESV · Centro de cumplimiento</title>
</svelte:head>

<div class="pagina">
	<header class="cabecera">
		<div class="titulo-zona">
			<h1>Plan Estratégico de Seguridad Vial</h1>
			<p class="subtitulo">
				Centro de cumplimiento y trazabilidad · nivel <strong>Avanzado</strong> · 24 pasos y 13
				indicadores
				{#if resumen?.ciclo}
					· ciclo {resumen.ciclo.anio} ({resumen.ciclo.estado.toLowerCase()})
					{#if resumen.ciclo.lider}· líder: {resumen.ciclo.lider}{/if}
				{/if}
			</p>
			{#if resumen}
				<p class="corte">Datos al {formatearInstante(resumen.fechaCorte)}</p>
			{/if}
		</div>

		<div class="periodo-selector">
			<label>
				<span>Año</span>
				<select bind:value={filtros.anio}>
					{#each anios as a (a)}
						<option value={a}>{a}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Trimestre</span>
				<select bind:value={filtros.trimestre}>
					<option value={0}>Todo el año</option>
					<option value={1}>T1</option>
					<option value={2}>T2</option>
					<option value={3}>T3</option>
					<option value={4}>T4</option>
				</select>
			</label>
			<label>
				<span>Mes</span>
				<select bind:value={filtros.mes}>
					{#each MESES as m, i (m)}
						<option value={i}>{m}</option>
					{/each}
				</select>
			</label>
		</div>
	</header>

	{#if errorPermisos}
		<EstadoPanel
			tipo="error"
			mensaje={errorPermisos}
			accion="Reintentar"
			onAccion={cargarPermisos}
		/>
	{:else if !permisos}
		<EstadoPanel tipo="cargando" mensaje="Comprobando sus permisos sobre el módulo…" />
	{:else}
		{#if permisos.nivel === 'read'}
			<p class="aviso-permiso" role="note">
				Su nivel de acceso es de <strong>consulta</strong>. Aportar evidencia, registrar operación y
				gestionar el ciclo corresponden a otras áreas.
			</p>
		{:else if !permisos.puedeRevisar}
			<p class="aviso-permiso" role="note">
				Puede aportar evidencia y registrar operación. La <strong>aprobación</strong> de evidencia corresponde
				a HSEQ o Administración.
			</p>
		{/if}

		<nav class="vistas" aria-label="Vistas del centro PESV">
			{#each VISTAS as v (v.id)}
				<button
					type="button"
					class:activa={filtros.vista === v.id}
					aria-current={filtros.vista === v.id ? 'page' : undefined}
					title={v.descripcion}
					onclick={() => irA(v.id)}
				>
					{v.etiqueta}
				</button>
			{/each}
		</nav>

		<main class="contenido">
			{#if filtros.vista === 'resumen'}
				{#if cargandoResumen && !resumen}
					<EstadoPanel tipo="cargando" mensaje="Consolidando el período…" />
				{:else if errorResumen}
					<EstadoPanel
						tipo="error"
						mensaje={errorResumen}
						accion="Reintentar"
						onAccion={cargarResumen}
					/>
				{:else if resumen}
					<ResumenCumplimiento
						{resumen}
						onIrA={irA}
						onCrearCiclo={crearCicloDelAnio}
						puedeGestionar={permisos.puedeGestionar}
					/>
				{/if}
			{:else if filtros.vista === 'matriz'}
				{#if errorMatriz}
					<EstadoPanel
						tipo="error"
						mensaje={errorMatriz}
						accion="Reintentar"
						onAccion={cargarMatriz}
					/>
				{:else}
					<div class="filtros-matriz">
						<label>
							<span>Fase</span>
							<select bind:value={filtros.fase}>
								<option value="">Todas las fases</option>
								<option value="PLANIFICACION">Planificación</option>
								<option value="IMPLEMENTACION">Implementación</option>
								<option value="SEGUIMIENTO">Seguimiento</option>
								<option value="MEJORA">Mejora</option>
							</select>
						</label>
						<label>
							<span>Estado</span>
							<select bind:value={filtros.estado}>
								<option value="">Todos los estados</option>
								<option value="PENDIENTE">Pendiente</option>
								<option value="EN_PROGRESO">En progreso</option>
								<option value="EN_REVISION">En revisión</option>
								<option value="CUMPLE">Cumple</option>
								<option value="NO_CUMPLE">No cumple</option>
								<option value="NO_APLICA">No aplica</option>
							</select>
						</label>
						<label>
							<span>Área responsable</span>
							<select bind:value={filtros.area}>
								<option value="">Todas las áreas</option>
								<option value="administracion">Administración</option>
								<option value="operaciones">Operaciones</option>
								<option value="hseq">HSEQ</option>
								<option value="mantenimiento">Mantenimiento</option>
								<option value="talento_humano">Talento Humano</option>
							</select>
						</label>
						<label class="buscador">
							<span>Buscar</span>
							<input
								type="search"
								bind:value={filtros.q}
								placeholder="Nombre o descripción del paso"
							/>
						</label>
					</div>

					{#if cumplimiento}
						<MatrizPasos
							filas={cumplimiento.filas}
							resumen={cumplimiento.resumen}
							cargando={cargandoMatriz}
							onAbrirPaso={abrirPaso}
						/>
					{:else if cargandoMatriz}
						<EstadoPanel tipo="cargando" mensaje="Cargando la matriz…" />
					{/if}

					<BandejaEvidencias
						{evidencias}
						cargando={cargandoEvidencias}
						error={errorEvidencias}
						{permisos}
						filtroEstado={filtros.estadoEvidencia}
						soloMias={filtros.mias === 'si'}
						onFiltrar={(cambio) => {
							filtros = {
								...filtros,
								...(cambio.estadoEvidencia !== undefined
									? { estadoEvidencia: cambio.estadoEvidencia }
									: {}),
								...(cambio.mias !== undefined ? { mias: cambio.mias ? 'si' : 'no' } : {})
							};
							void cargarEvidencias();
						}}
						onAbrirPaso={abrirPaso}
						onReintentar={cargarEvidencias}
					/>
				{/if}
			{:else if filtros.vista === 'indicadores'}
				{#if cargandoIndicadores && indicadores.length === 0}
					<EstadoPanel tipo="cargando" mensaje="Calculando los 13 indicadores…" />
				{:else if errorIndicadores}
					<EstadoPanel
						tipo="error"
						mensaje={errorIndicadores}
						accion="Reintentar"
						onAccion={cargarIndicadores}
					/>
				{:else}
					<div class="rejilla-indicadores">
						{#each indicadores as i (i.code)}
							<TarjetaIndicador indicador={i} onAbrir={abrirIndicador} />
						{/each}
					</div>
				{/if}
			{:else if filtros.vista === 'operacion'}
				<PanelOperacion
					datos={operacion}
					cargando={cargandoOperacion}
					error={errorOperacion}
					panel={filtros.panel || 'inspecciones'}
					{permisos}
					onPanel={(p) => (filtros = { ...filtros, panel: p })}
					onReintentar={cargarOperacion}
				/>
			{:else if filtros.vista === 'documentos'}
				<TablaDocumentos
					datos={documentos}
					cargando={cargandoDocumentos}
					error={errorDocumentos}
					{permisos}
					filtroVigencia={filtros.estadoVigencia}
					filtroAmbito={filtros.ambito}
					onFiltrar={(cambio) => {
						filtros = { ...filtros, ...cambio };
						void cargarDocumentos();
					}}
					onRevisar={revisarDoc}
					onReintentar={cargarDocumentos}
				/>
			{:else if filtros.vista === 'plan'}
				<PlanAnual
					{actividades}
					{metas}
					{programas}
					{formaciones}
					{riesgos}
					cargando={cargandoPlan}
					error={errorPlan}
					panel={filtros.panel || 'actividades'}
					filtroEstado={filtros.estado}
					{permisos}
					onPanel={(p) => (filtros = { ...filtros, panel: p })}
					onFiltrarEstado={(e) => {
						filtros = { ...filtros, estado: e };
						void cargarPlan();
					}}
					onReintentar={cargarPlan}
				/>
			{:else if filtros.vista === 'contratos'}
				<TablaCoberturaFuec
					datos={cobertura}
					cargando={cargandoCobertura}
					error={errorCobertura}
					filtroEstado={filtros.estado}
					{permisos}
					onFiltrar={(e) => {
						filtros = { ...filtros, estado: e };
						void cargarCobertura();
					}}
					onReintentar={cargarCobertura}
					onImportar={ejecutarImportacion}
				/>
			{:else if filtros.vista === 'historico'}
				<section class="historico">
					<p class="aviso-historico" role="note">
						Registros del panel PESV anterior. Se conservan íntegros como referencia histórica y
						<strong>ya no admiten edición</strong>: el preoperacional se registra en Formularios
						Dinámicos, los siniestros y los excesos de velocidad tienen su propio registro
						estructurado en «Operación segura». Un segundo camino de captura crearía dos verdades
						sobre el mismo hecho.
					</p>

					{#if cargandoHistorico}
						<EstadoPanel tipo="cargando" mensaje="Cargando registros diarios…" />
					{:else if errorHistorico}
						<EstadoPanel
							tipo="error"
							mensaje={errorHistorico}
							accion="Reintentar"
							onAccion={cargarHistorico}
						/>
					{:else if historico.length === 0}
						<EstadoPanel
							tipo="vacio"
							titulo="Sin registros"
							mensaje="No hay registros diarios para el mes y año seleccionados."
						/>
					{:else}
						<div class="tabla-scroll">
							<table>
								<caption class="sr-only">
									Registros diarios PESV del panel anterior, en solo lectura
								</caption>
								<thead>
									<tr>
										<th scope="col">Fecha</th>
										<th scope="col">Conductor</th>
										<th scope="col">Vehículo</th>
										<th scope="col">Cliente</th>
										<th scope="col">Conducción</th>
										<th scope="col">Sueño</th>
										<th scope="col">Excesos</th>
										<th scope="col">Preoperacional</th>
										<th scope="col">Siniestros</th>
									</tr>
								</thead>
								<tbody>
									{#each historico as r (r.id)}
										<tr>
											<td class="tab">{r.fecha}</td>
											<td>{r.conductor.nombre}</td>
											<td class="placa">{r.vehiculo.placa}</td>
											<td>{r.cliente.nombre}</td>
											<td class="tab">{r.tiempo_conduccion} h</td>
											<td class="tab">{r.horas_sueno ?? '—'}</td>
											<td class="tab">{r.excesos_velocidad_dia}</td>
											<td>{r.preoperacional_realizado ? 'Sí' : 'No'}</td>
											<td class="tab">
												{r.siniestros}
												{#if r.siniestros_detalle}
													<span class="sub">{r.siniestros_detalle}</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</section>
			{/if}
		</main>
	{/if}
</div>

{#if pasoAbierto && permisos}
	<DetallePasoDialogo
		detalle={pasoAbierto}
		anio={filtros.anio}
		{permisos}
		onCerrar={cerrarPaso}
		onCambio={refrescarPaso}
	/>
{/if}

{#if indicadorAbierto}
	<DetalleIndicador indicador={indicadorAbierto} onCerrar={cerrarIndicador} />
{/if}

<style>
	/* Sin `max-width` ni `margin: 0 auto`: el ancho lo acota el `main` del
	   layout del dashboard. Acotar otra vez aquí deja franjas muertas a los
	   lados justo donde se trabaja, y en una matriz de 24 filas con siete
	   columnas eso se paga en scroll. */
	.pagina {
		padding: 1.25rem 1.25rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1.5rem;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
		font-size: 1.375rem;
		font-weight: 700;
		color: #0f172a;
	}

	.subtitulo {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: #475569;
		max-width: 44rem;
	}

	.corte {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: #94a3b8;
	}

	.periodo-selector {
		display: flex;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.periodo-selector label,
	.filtros-matriz label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: #475569;
	}

	select,
	input[type='search'] {
		border: 1px solid #cbd5e1;
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		font-size: 0.875rem;
		min-height: 2.75rem;
		background: #ffffff;
		color: #0f172a;
		/* Medida del propio control. */
		min-width: 9rem;
	}

	.buscador input {
		min-width: 16rem;
	}

	.aviso-permiso {
		margin: 0;
		padding: 0.625rem 0.875rem;
		background: #eff6ff;
		border: 1px solid #bfdbfe;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		color: #1e40af;
		max-width: 44rem;
	}

	.vistas {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		padding: 0.25rem;
		background: #f1f5f9;
		border-radius: 0.75rem;
		width: fit-content;
	}

	.vistas button {
		padding: 0.5rem 1rem;
		border: none;
		background: transparent;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
		min-height: 2.75rem;
	}

	.vistas button:hover {
		color: #0f172a;
	}

	.vistas button.activa {
		background: #ffffff;
		color: #0f172a;
		box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
	}

	.contenido {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.filtros-matriz {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.rejilla-indicadores {
		display: grid;
		/* Rejilla fluida: se adapta al ancho real del `main`, que cambia cuando
		   la barra lateral se colapsa. */
		grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
		gap: 0.875rem;
	}

	.historico {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.aviso-historico {
		margin: 0;
		padding: 0.75rem 0.875rem;
		background: #f8fafc;
		border: 1px solid #cbd5e1;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		color: #475569;
		max-width: 44rem;
	}

	.tabla-scroll {
		overflow-x: auto;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		background: #ffffff;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
		min-width: 55rem;
	}

	thead th {
		position: sticky;
		top: 0;
		background: #f8fafc;
		text-align: left;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid #e2e8f0;
		white-space: nowrap;
	}

	tbody td {
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid #f1f5f9;
		vertical-align: top;
	}

	.tab {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.placa {
		font-weight: 600;
	}

	.sub {
		display: block;
		font-size: 0.75rem;
		color: #64748b;
	}

	button:focus-visible,
	select:focus-visible,
	input:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 2px;
		border-radius: 0.25rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}
</style>
