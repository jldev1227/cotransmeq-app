<script lang="ts">
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import {
		ChevronDown,
		Search,
		Target,
		UsersRound,
		CalendarDays,
		Check,
		TriangleAlert,
		UserPlus,
		X
	} from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import { numero, opcion, texto, type DefinicionesFiltros } from '$lib/listing/filtros';
	import { coincide } from '$lib/listing/texto';
	import { toast } from '$lib/stores/toast';
	import { planTrabajoApi, type DestinatarioRol } from '$lib/api/plan-trabajo';
	import type { Area } from '$lib/config/permissions';

	let planes = $state<any[]>([]);
	let planId = $state('');
	let gestion = $state<any>(null);
	let indicadores = $state<any[]>([]);
	let cargando = $state(true);
	let ocupada = $state(false);
	let error = $state('');
	let ocurrenciaFoco = $state('');
	interface FiltrosActividades {
		q: string;
		estado: 'TODAS' | 'PENDIENTES' | 'ATRASADAS' | 'COMPLETADAS' | 'NO_APLICA';
		pagina: number;
		porPagina: number;
		actividad: string;
	}
	const DEFS_ACTIVIDADES: DefinicionesFiltros<FiltrosActividades> = {
		q: texto(),
		estado: opcion<FiltrosActividades['estado']>('TODAS'),
		pagina: numero(1),
		porPagina: numero(20),
		actividad: texto()
	};
	const estadoUrlActividades = crearEstadoUrl(DEFS_ACTIVIDADES);
	let filtrosActividades = $state<FiltrosActividades>(estadoUrlActividades.leerInicial());
	let busquedaActividades = $state(filtrosActividades.q);
	$effect(() => estadoUrlActividades.escribir(page.url, filtrosActividades));
	let selectorCargoActivo = $state('');
	let cargoExpandido = $state('');
	let configuracionAreasAbierta = $state(false);
	let busquedaUsuariosCargo = $state<Record<string, string>>({});
	let areasPorCargo = $state<Record<string, Area | ''>>({});
	let rolesSeleccionados = $state<Record<string, Record<DestinatarioRol, string[]>>>({});
	let conductoresSeleccionados = $state<Record<string, Record<DestinatarioRol, string[]>>>({});
	let rolActivoPorOcurrencia = $state<Record<string, DestinatarioRol>>({});
	let trimestre = $state<number | null>(Math.ceil((new Date().getMonth() + 1) / 3));
	let bandas = $state<Record<number, { adecuado: string; riesgo: string; critico: string }>>({});
	let manual = $state<Record<number, { cumple: boolean; observacion: string; id?: string }>>({
		1: { cumple: false, observacion: '' },
		2: { cumple: false, observacion: '' }
	});
	let areasSinResponsable = $derived(
		(gestion?.areas ?? []).filter(
			(area: any) => !area.responsable?.activo || !area.responsable.area?.includes(area.area)
		)
	);
	let cargosSinArea = $derived(
		(gestion?.cargos ?? []).filter((grupo: any) => !areasPorCargo[grupo.cargo])
	);

	const roles: DestinatarioRol[] = ['RESPONSABLE', 'COLABORADOR', 'SUPLENTE'];
	const rolesConfigurables: DestinatarioRol[] = ['COLABORADOR', 'SUPLENTE'];
	const filtrosActividad = [
		{ id: 'TODAS', label: 'Todas' },
		{ id: 'PENDIENTES', label: 'Pendientes' },
		{ id: 'ATRASADAS', label: 'Atrasadas' },
		{ id: 'COMPLETADAS', label: 'Completadas' },
		{ id: 'NO_APLICA', label: 'No aplica' }
	] as const;

	function estaAtrasada(ocurrencia: any) {
		if (ocurrencia.estado !== 'PENDIENTE') return false;
		const vencimiento = new Date(`${ocurrencia.fecha_vencimiento}T00:00:00`);
		const hoy = new Date();
		hoy.setHours(0, 0, 0, 0);
		return vencimiento < hoy;
	}

	function porcentajeVisual(valor: number | null | undefined) {
		return Math.min(100, Math.max(0, valor ?? 0));
	}

	function ocurrenciasVisibles(actividad: any) {
		return actividad.ocurrencias.filter((ocurrencia: any) => {
			switch (filtrosActividades.estado) {
				case 'PENDIENTES':
					return ocurrencia.estado === 'PENDIENTE' && !estaAtrasada(ocurrencia);
				case 'ATRASADAS':
					return estaAtrasada(ocurrencia);
				case 'COMPLETADAS':
					return ocurrencia.estado === 'COMPLETADA';
				case 'NO_APLICA':
					return ocurrencia.estado === 'NO_APLICA';
				default:
					return true;
			}
		});
	}

	function coincideActividad(actividad: any) {
		const campos = [
			actividad.actividad,
			actividad.responsable_cargos,
			actividad.unidad_programa,
			actividad.alcance,
			actividad.es_pesv ? 'PESV' : 'HSEQ',
			...Object.values(actividad.datos_fuente ?? {}),
			...actividad.ocurrencias.map(
				(ocurrencia: any) =>
					`${ocurrencia.mes} ${ocurrencia.estado} ${ocurrencia.fecha_vencimiento}`
			)
		];
		return coincide(filtrosActividades.q, campos) && ocurrenciasVisibles(actividad).length > 0;
	}

	let actividadesFiltradas = $derived.by(
		() => gestion?.plan.actividades.filter(coincideActividad) ?? []
	);
	let totalPaginasActividades = $derived(
		Math.max(
			1,
			Math.ceil(
				actividadesFiltradas.length /
					(filtrosActividades.porPagina || Math.max(1, actividadesFiltradas.length))
			)
		)
	);
	let actividadesPaginadas = $derived.by(() => {
		const porPagina = filtrosActividades.porPagina || Math.max(1, actividadesFiltradas.length);
		const inicio = (filtrosActividades.pagina - 1) * porPagina;
		return actividadesFiltradas.slice(inicio, inicio + porPagina);
	});

	$effect(() => {
		if (cargando || !gestion) return;
		if (filtrosActividades.pagina > totalPaginasActividades) {
			filtrosActividades = { ...filtrosActividades, pagina: totalPaginasActividades };
		}
	});

	function buscarActividades(termino: string) {
		filtrosActividades = { ...filtrosActividades, q: termino, pagina: 1, actividad: '' };
	}

	function cambiarFiltroActividades(estado: (typeof filtrosActividad)[number]['id']) {
		filtrosActividades = { ...filtrosActividades, estado, pagina: 1, actividad: '' };
	}

	function toggleActividad(id: string) {
		filtrosActividades = {
			...filtrosActividades,
			actividad: filtrosActividades.actividad === id ? '' : id
		};
	}

	function cambiarPaginaActividades(pagina: number) {
		filtrosActividades = { ...filtrosActividades, pagina, actividad: '' };
	}

	function cambiarTamanoPaginaActividades(tamano: number) {
		filtrosActividades = { ...filtrosActividades, porPagina: tamano, pagina: 1, actividad: '' };
	}

	function resumenOcurrenciasVisibles(actividad: any) {
		const ocurrencias = ocurrenciasVisibles(actividad);
		const completadas = ocurrencias.filter((o: any) => o.estado === 'COMPLETADA').length;
		const atrasadas = ocurrencias.filter((o: any) => estaAtrasada(o)).length;
		return { total: ocurrencias.length, completadas, atrasadas };
	}

	function etiquetaRol(rol: DestinatarioRol) {
		return rol === 'RESPONSABLE'
			? 'Responsable'
			: rol === 'COLABORADOR'
				? 'Colaborador'
				: 'Suplente';
	}

	function claveRolCargo(cargo: string, rol: DestinatarioRol) {
		return `${cargo}::${rol}`;
	}

	function alternarDetalleCargo(cargo: string) {
		if (cargoExpandido === cargo) {
			cargoExpandido = '';
			selectorCargoActivo = '';
			return;
		}
		cargoExpandido = cargo;
		selectorCargoActivo = '';
	}

	function abrirSelectorCargo(cargo: string, rol: DestinatarioRol) {
		const clave = claveRolCargo(cargo, rol);
		selectorCargoActivo = selectorCargoActivo === clave ? '' : clave;
		if (selectorCargoActivo) busquedaUsuariosCargo[clave] = '';
	}

	function usuariosDisponibles(cargo: string, rol: DestinatarioRol) {
		const clave = claveRolCargo(cargo, rol);
		const termino = busquedaUsuariosCargo[clave] ?? '';
		return (gestion?.usuarios ?? [])
			.filter((usuario: any) => coincide(termino, [usuario.nombre, usuario.correo]))
			.slice(0, 30);
	}

	function cambiarAsignacionCargo(
		cargo: string,
		rol: DestinatarioRol,
		usuarioId: string,
		asignado: boolean
	) {
		const actual = rolesSeleccionados[cargo]?.[rol] ?? [];
		rolesSeleccionados[cargo][rol] = asignado
			? actual.includes(usuarioId)
				? actual
				: [...actual, usuarioId]
			: actual.filter((id) => id !== usuarioId);
	}

	function quitarAsignacionCargo(cargo: string, rol: DestinatarioRol, usuarioId: string) {
		cambiarAsignacionCargo(cargo, rol, usuarioId, false);
	}

	function buscarUsuarioCargo(cargo: string, rol: DestinatarioRol, event: Event) {
		busquedaUsuariosCargo[claveRolCargo(cargo, rol)] = (
			event.currentTarget as HTMLInputElement
		).value;
	}

	function usuarioPorId(id: string) {
		return gestion?.usuarios.find((usuario: any) => usuario.id === id);
	}

	function iniciales(nombre: string) {
		return nombre
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((parte) => parte[0])
			.join('')
			.toLocaleUpperCase('es-CO');
	}

	async function cargar() {
		cargando = true;
		error = '';
		try {
			planes = await planTrabajoApi.listar();
			if (!planId && planes.length) planId = planes[0].id;
			if (!planId) return;
			gestion = await planTrabajoApi.gestion(planId);
			if (ocurrenciaFoco) {
				const indiceActividad = gestion.plan.actividades.findIndex((actividad: any) =>
					actividad.ocurrencias.some((ocurrencia: any) => ocurrencia.id === ocurrenciaFoco)
				);
				if (indiceActividad >= 0) {
					const porPagina =
						filtrosActividades.porPagina || Math.max(1, gestion.plan.actividades.length);
					filtrosActividades = {
						...filtrosActividades,
						pagina: Math.floor(indiceActividad / Math.max(1, porPagina)) + 1,
						actividad: gestion.plan.actividades[indiceActividad].id
					};
				}
			}
			indicadores = await planTrabajoApi.indicadores(planId, trimestre ?? undefined);
			const referencias: typeof bandas = {};
			for (const indicador of indicadores)
				referencias[indicador.numero] = {
					adecuado: indicador.bandas_referencia?.adecuado ?? '',
					riesgo: indicador.bandas_referencia?.riesgo ?? '',
					critico: indicador.bandas_referencia?.critico ?? ''
				};
			bandas = referencias;
			const cargos: typeof rolesSeleccionados = {};
			const areasSeleccionadas: Record<string, Area | ''> = {};
			for (const grupo of gestion.cargos) {
				cargos[grupo.cargo] = { RESPONSABLE: [], COLABORADOR: [], SUPLENTE: [] };
				areasSeleccionadas[grupo.cargo] = grupo.area ?? '';
				for (const asignacion of grupo.asignaciones)
					cargos[grupo.cargo][asignacion.rol as DestinatarioRol]?.push(asignacion.usuario_id);
			}
			rolesSeleccionados = cargos;
			areasPorCargo = areasSeleccionadas;
			const drivers: Record<string, Record<DestinatarioRol, string[]>> = {};
			for (const actividad of gestion.plan.actividades) {
				for (const ocurrencia of actividad.ocurrencias) {
					drivers[ocurrencia.id] = { RESPONSABLE: [], COLABORADOR: [], SUPLENTE: [] };
					for (const asignacion of ocurrencia.asignaciones.filter(
						(a: any) => a.destinatario_tipo === 'CONDUCTOR'
					)) {
						drivers[ocurrencia.id][asignacion.rol as DestinatarioRol]?.push(
							asignacion.destinatario_id
						);
					}
				}
			}
			conductoresSeleccionados = drivers;
			manual = { 1: { cumple: false, observacion: '' }, 2: { cumple: false, observacion: '' } };
			for (const indicador of indicadores.filter((i) => i.fuente === 'MANUAL')) {
				manual[indicador.numero] = {
					cumple: indicador.documento_cumple ?? false,
					observacion: indicador.observacion ?? '',
					id: indicador.id ?? undefined
				};
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'No fue posible cargar el plan.';
		} finally {
			cargando = false;
		}
	}

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		planId = params.get('planId') ?? '';
		ocurrenciaFoco = params.get('ocurrenciaId') ?? '';
		if (ocurrenciaFoco) {
			busquedaActividades = '';
			filtrosActividades = { ...filtrosActividades, q: '', estado: 'TODAS', pagina: 1 };
		}
		void cargar().then(async () => {
			if (!ocurrenciaFoco) return;
			await tick();
			document
				.getElementById(`ocurrencia-${ocurrenciaFoco}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
	});

	async function seleccionarPlan(id: string) {
		planId = id;
		busquedaActividades = '';
		filtrosActividades = {
			...filtrosActividades,
			q: '',
			estado: 'TODAS',
			pagina: 1,
			actividad: ''
		};
		ocurrenciaFoco = '';
		await cargar();
	}

	async function cambiarTrimestre(value: string) {
		trimestre = value ? Number(value) : null;
		try {
			if (planId) indicadores = await planTrabajoApi.indicadores(planId, trimestre ?? undefined);
			const referencias: typeof bandas = {};
			for (const indicador of indicadores)
				referencias[indicador.numero] = {
					adecuado: indicador.bandas_referencia?.adecuado ?? '',
					riesgo: indicador.bandas_referencia?.riesgo ?? '',
					critico: indicador.bandas_referencia?.critico ?? ''
				};
			bandas = referencias;
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo cambiar el periodo.');
		}
	}

	async function guardarCargo(cargo: string) {
		try {
			const seleccion = rolesSeleccionados[cargo] ?? {
				RESPONSABLE: [],
				COLABORADOR: [],
				SUPLENTE: []
			};
			const asignaciones = rolesConfigurables.flatMap((rol) =>
				seleccion[rol].map((usuario_id) => ({ usuario_id, rol }))
			);
			await planTrabajoApi.asignarCargo(planId, cargo, areasPorCargo[cargo] || null, asignaciones);
			selectorCargoActivo = '';
			toast.success('Área, colaboradores y suplentes guardados.');
			await cargar();
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo guardar el cargo.');
		}
	}

	async function activar() {
		ocupada = true;
		try {
			await planTrabajoApi.activar(planId);
			toast.success('Plan activado; los recordatorios comenzarán según el calendario.');
			await cargar();
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo activar el plan.');
		} finally {
			ocupada = false;
		}
	}

	async function asignarConductores(id: string) {
		try {
			const asignaciones = roles.flatMap((rol) =>
				(conductoresSeleccionados[id]?.[rol] ?? []).map((conductor_id) => ({ conductor_id, rol }))
			);
			await planTrabajoApi.asignarConductores(id, asignaciones);
			toast.success('Conductores asignados y avisados.');
			await cargar();
		} catch (cause) {
			toast.error(
				cause instanceof Error ? cause.message : 'No se pudieron asignar los conductores.'
			);
		}
	}

	async function completar(id: string) {
		try {
			await planTrabajoApi.completar(id);
			toast.success('Ocurrencia completada.');
			await cargar();
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo cerrar la ocurrencia.');
		}
	}

	async function noAplica(id: string) {
		const motivo = window.prompt('Justifica por qué esta actividad no aplica:')?.trim();
		if (!motivo) return;
		try {
			await planTrabajoApi.marcarNoAplica(id, motivo);
			toast.success('Excepción aprobada y registrada.');
			await cargar();
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo registrar la excepción.');
		}
	}

	async function cambiarEvidencia(actividad: any, event: Event) {
		const requiere = (event.currentTarget as HTMLInputElement).checked;
		try {
			await planTrabajoApi.requiereEvidencia(actividad.id, requiere);
			actividad.requiere_evidencia = requiere;
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo actualizar el requisito.');
		}
	}

	async function subirArchivo(ocurrenciaId: string, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const archivo = input.files?.[0];
		if (!archivo) return;
		try {
			await planTrabajoApi.subirEvidenciaOcurrencia(ocurrenciaId, archivo);
			toast.success('Soporte cargado.');
			await cargar();
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo subir el soporte.');
		} finally {
			input.value = '';
		}
	}

	async function guardarIndicador(numero: number) {
		try {
			const saved = await planTrabajoApi.guardarIndicador(planId, numero, manual[numero]);
			manual[numero] = { ...manual[numero], id: saved.id };
			indicadores = await planTrabajoApi.indicadores(planId, trimestre ?? undefined);
			toast.success('Indicador actualizado.');
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo guardar el indicador.');
		}
	}

	async function guardarBandas(numero: number) {
		try {
			await planTrabajoApi.guardarBandas(planId, numero, bandas[numero]);
			indicadores = await planTrabajoApi.indicadores(planId, trimestre ?? undefined);
			toast.success('Bandas de referencia guardadas.');
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudieron guardar las bandas.');
		}
	}

	async function subirSoporteIndicador(numero: number, event: Event) {
		const archivo = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!archivo) return;
		try {
			if (!manual[numero].id) {
				const saved = await planTrabajoApi.guardarIndicador(planId, numero, manual[numero]);
				manual[numero] = { ...manual[numero], id: saved.id };
			}
			await planTrabajoApi.subirEvidenciaIndicador(manual[numero].id!, archivo);
			indicadores = await planTrabajoApi.indicadores(planId, trimestre ?? undefined);
			toast.success('Evidencia documental cargada.');
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : 'No se pudo subir el documento.');
		}
	}

	async function abrirEvidencia(id: string) {
		try {
			const archivo = await planTrabajoApi.urlEvidencia(id);
			window.open(archivo.url, '_blank', 'noopener');
		} catch {
			toast.error('No se pudo abrir el soporte.');
		}
	}

	function cambiarConductores(id: string, rol: DestinatarioRol, event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		conductoresSeleccionados[id][rol] = Array.from(
			select.selectedOptions,
			(option) => option.value
		);
	}
</script>

<svelte:head><title>Plan anual HSEQ/PESV</title></svelte:head>

<main class="plan-page">
	<header class="page-card plan-header">
		<div class="plan-heading">
			<p class="eyebrow">CENTRO DE CONTROL · HSEQ / PESV</p>
			<h1>Plan de trabajo {gestion?.plan.anio ?? ''}</h1>
			<p>Una vista común para anticipar vencimientos, medir resultados y seguir cada compromiso.</p>
		</div>
		<div class="plan-header-actions">
			{#if gestion}
				<span class="plan-status" class:plan-status-active={gestion.plan.recordatorios_activos}>
					<span aria-hidden="true"></span>{gestion.plan.recordatorios_activos
						? 'Recordatorios activos'
						: 'Plan en preparación'}
				</span>
			{/if}
			{#if planes.length}
				<label class="plan-picker"
					>Plan anual<select
						aria-label="Plan anual"
						value={planId}
						onchange={(event) => seleccionarPlan(event.currentTarget.value)}
					>
						{#each planes as plan}<option value={plan.id}>{plan.nombre}</option>{/each}
					</select></label
				>
			{/if}
		</div>
	</header>

	{#if cargando}
		<p class="state">Cargando plan…</p>
	{:else if error}
		<p class="state error">{error}</p>
	{:else if !gestion}
		<section class="panel empty">
			<h2>No hay un plan cargado</h2>
			<p>Importa el Excel 2026 con el comando documentado del backend.</p>
		</section>
	{:else}
		<nav class="plan-tabs" aria-label="Secciones del plan">
			<a href="#indicadores">Indicadores</a>
			<a href="#responsables">Responsables</a>
			<a href="#actividades">Actividades y ocurrencias</a>
		</nav>
		{@const resumen = planes.find((p) => p.id === planId)?.resumen}
		<section class="summary-grid">
			<article class="stat-card">
				<span class="stat-icon"><CalendarDays size={17} /></span><span class="stat-label"
					>Actividades</span
				><strong class="stat-value">{resumen?.actividades ?? 0}</strong><span class="stat-note"
					>Incluidas en el plan anual</span
				>
			</article>
			<article class="stat-card">
				<span class="stat-icon"><Target size={17} /></span><span class="stat-label"
					>Ocurrencias</span
				><strong class="stat-value">{resumen?.ocurrencias ?? 0}</strong><span class="stat-note"
					>Compromisos programados</span
				>
			</article>
			<article class="stat-card">
				<span class="stat-icon stat-icon-good"><Check size={17} /></span><span class="stat-label"
					>Ejecutadas</span
				><strong class="stat-value">{resumen?.ejecutadas ?? 0}</strong><span class="stat-note"
					>Cerradas con seguimiento</span
				>
			</article>
			<article class="stat-card stat-card-alert">
				<span class="stat-icon stat-icon-alert"><TriangleAlert size={17} /></span><span
					class="stat-label">Atrasadas</span
				><strong class="stat-value">{resumen?.atrasadas ?? 0}</strong><span class="stat-note"
					>Requieren atención</span
				>
			</article>
		</section>

		<section id="indicadores" class="page-card section-panel">
			<div class="section-head">
				<div>
					<p class="section-kicker">RESULTADOS Y METAS</p>
					<h2>Indicadores del plan</h2>
					<p>
						El avance y la meta quedan visibles; abre el registro para editar evidencia y bandas.
					</p>
				</div>
				<label class="period-picker"
					>Periodo<select
						bind:value={trimestre}
						onchange={(event) => cambiarTrimestre(event.currentTarget.value)}
						><option value={null}>Anual</option><option value={1}>Trimestre 1</option><option value={2}
							>Trimestre 2</option
						><option value={3}>Trimestre 3</option><option value={4}>Trimestre 4</option></select
					></label
				>
			</div>
			<div class="kpi-grid">
				{#each indicadores as indicador}
					<article class="kpi-card">
						<div class="kpi-card-heading">
							<span class="kpi-number">0{indicador.numero}</span>
							<span class="kpi-kind"><Target size={15} /> Indicador</span>
							<span
								class="kpi-status"
								class:kpi-status-good={indicador.cumple === true}
								class:kpi-status-pending={indicador.cumple === null}
							>
								{indicador.cumple === null
									? 'Pendiente de evidencia'
									: indicador.cumple
										? 'Cumple la meta'
										: 'Por debajo de la meta'}
							</span>
						</div>
						<strong class="kpi-name">{indicador.nombre}</strong>
						<div class="kpi-reading">
							<div class="kpi-value">
								{indicador.valor === null ? '—' : `${indicador.valor}%`}<small
									>{indicador.valor === null ? 'Sin dato' : 'avance'}</small
								>
							</div>
							<div class="kpi-target">
								<span>Meta principal</span><strong>{indicador.meta}%</strong>
							</div>
						</div>
						{#if indicador.valor !== null}
							<div
								class="target-meter"
								role="img"
								aria-label={`Avance ${indicador.valor} por ciento; meta ${indicador.meta} por ciento`}
							>
								<span
									class="target-meter-fill"
									style={`width:${porcentajeVisual(indicador.valor)}%`}
								></span>
								<span class="target-meter-mark" style={`left:${porcentajeVisual(indicador.meta)}%`}
								></span>
							</div>
							<div class="meter-caption">
								<span>0%</span><span>Resultado {indicador.valor}%</span><span
									>Meta {indicador.meta}%</span
								>
							</div>
						{/if}
						<details class="kpi-settings">
							<summary>Registro, evidencia y bandas</summary>
							<div class="kpi-settings-content">
								{#if indicador.fuente === 'MANUAL'}
									<div class="manual-row">
										<label
											><input type="checkbox" bind:checked={manual[indicador.numero].cumple} /> Documento
											aprobado y firmado</label
										>
										<input
											class="text-input"
											placeholder="Observación"
											bind:value={manual[indicador.numero].observacion}
										/>
										<div class="manual-actions">
											<button class="secondary" onclick={() => guardarIndicador(indicador.numero)}
												>Guardar registro</button
											>
											<input
												type="file"
												accept="application/pdf,image/*,.docx,.xlsx"
												aria-label="Adjuntar evidencia documental"
												onchange={(event) => subirSoporteIndicador(indicador.numero, event)}
											/>
											{#each indicador.evidencias ?? [] as evidencia}<button
													class="link-button"
													onclick={() => abrirEvidencia(evidencia.id)}
													>{evidencia.nombre_archivo}</button
												>{/each}
										</div>
									</div>
								{/if}
								<div class="reference-bands">
									<strong>Bandas de referencia del Excel</strong><label
										>Adecuado<input
											class="text-input"
											bind:value={bandas[indicador.numero].adecuado}
										/></label
									><label
										>Riesgo<input
											class="text-input"
											bind:value={bandas[indicador.numero].riesgo}
										/></label
									><label
										>Crítico<input
											class="text-input"
											bind:value={bandas[indicador.numero].critico}
										/></label
									><button class="quiet" onclick={() => guardarBandas(indicador.numero)}
										>Guardar bandas</button
									>
								</div>
							</div>
						</details>
					</article>
				{/each}
			</div>
		</section>

		<section id="responsables" class="page-card section-panel">
			<div class="section-head config-head">
				<div>
					<p class="section-kicker">CONFIGURACIÓN DEL PLAN</p>
					<h2>Áreas responsables</h2>
					<p>
						Relaciona cada cargo del Excel con un área. El responsable se define en Personal; aquí
						puedes añadir colaboradores y suplentes.
					</p>
					<a class="area-owners-link" href="/dashboard/personal?tipo=responsables"
						>Administrar responsables por área <ChevronDown size={14} /></a
					>
					<div class="config-overview" aria-live="polite">
						<span>{gestion.cargos.length - cargosSinArea.length} de {gestion.cargos.length} cargos vinculados</span>
						<span>{gestion.areas.length - areasSinResponsable.length} de {gestion.areas.length} áreas con responsable</span>
					</div>
					{#if cargosSinArea.length || areasSinResponsable.length}
						<p class="config-incomplete">
							{#if cargosSinArea.length && areasSinResponsable.length}
								{cargosSinArea.length} cargos sin área · {areasSinResponsable.length} áreas sin responsable
							{:else if cargosSinArea.length}
								{cargosSinArea.length} cargos sin área
							{:else}
								{areasSinResponsable.length} áreas sin responsable en Personal
							{/if}
						</p>
					{/if}
				</div>
				<div class="config-actions">
					<button
						type="button"
						class="secondary config-toggle"
						aria-expanded={configuracionAreasAbierta}
						aria-controls="cargo-area-config"
						onclick={() => (configuracionAreasAbierta = !configuracionAreasAbierta)}
						>{configuracionAreasAbierta ? 'Ocultar cargos' : 'Editar cargos'}
						<ChevronDown
							size={15}
							class={configuracionAreasAbierta ? 'compact-chevron-open' : ''}
						/></button
					>
					<button
						class="primary"
						disabled={ocupada ||
							gestion.plan.recordatorios_activos ||
							cargosSinArea.length > 0 ||
							areasSinResponsable.length > 0}
						onclick={activar}
						>{gestion.plan.recordatorios_activos
							? 'Recordatorios activos'
							: cargosSinArea.length || areasSinResponsable.length
								? 'Completa la configuración'
								: 'Activar plan y recordatorios'}</button
					>
				</div>
			</div>
			<div
				id="cargo-area-config"
				class="cargo-grid"
				class:config-grid-hidden={!configuracionAreasAbierta}
			>
				{#each gestion.cargos as grupo, indice (grupo.cargo)}
					{@const areaSeleccionada = gestion.areas.find(
						(item: any) => item.area === areasPorCargo[grupo.cargo]
					)}
					{@const responsableValido = Boolean(
						areaSeleccionada?.responsable?.activo &&
						areaSeleccionada.responsable.area?.includes(areaSeleccionada.area)
					)}
					{@const totalExtras =
						(rolesSeleccionados[grupo.cargo]?.COLABORADOR?.length ?? 0) +
						(rolesSeleccionados[grupo.cargo]?.SUPLENTE?.length ?? 0)}
					<article class="cargo-card" class:cargo-card-expanded={cargoExpandido === grupo.cargo}>
						<div class="cargo-compact-row">
							<div class="cargo-title">
								<span class="cargo-index">{String(indice + 1).padStart(2, '0')}</span>
								<div><small>CARGO</small><strong>{grupo.cargo}</strong></div>
							</div>
							<label class="cargo-area-select">
								<span class="sr-only">Área responsable para {grupo.cargo}</span>
								<select
									id={`area-cargo-${indice}`}
									aria-label={`Área responsable para ${grupo.cargo}`}
									bind:value={areasPorCargo[grupo.cargo]}
								>
									<option value="" disabled={gestion.plan.estado === 'ACTIVO'}
										>Seleccionar área</option
									>
									{#each gestion.areas as area (area.area)}
										<option value={area.area}>{area.etiqueta}</option>
									{/each}
								</select>
							</label>
							<span
								class="cargo-manager"
								class:cargo-manager-pending={!responsableValido}
								title={responsableValido
									? `Responsable del área ${areaSeleccionada.etiqueta}`
									: 'Asigna un responsable desde Personal'}
							>
								<span class="owner-status"></span>
								{responsableValido ? areaSeleccionada.responsable.nombre : 'Responsable pendiente'}
							</span>
							<button
								type="button"
								class="cargo-extras-toggle"
								aria-expanded={cargoExpandido === grupo.cargo}
								aria-controls={`extras-${indice}`}
								aria-label={`${cargoExpandido === grupo.cargo ? 'Ocultar' : 'Editar'} colaboradores y suplentes de ${grupo.cargo}`}
								onclick={() => alternarDetalleCargo(grupo.cargo)}
							>
								<UsersRound size={15} />
								{totalExtras ? `${totalExtras} extras` : 'Añadir extras'}
								<ChevronDown
									size={14}
									class={cargoExpandido === grupo.cargo ? 'compact-chevron-open' : ''}
								/>
							</button>
							<button
								class="secondary save-cargo"
								disabled={ocupada}
								onclick={() => guardarCargo(grupo.cargo)}>Guardar</button
							>
						</div>
						{#if cargoExpandido === grupo.cargo}
							<div class="cargo-details" id={`extras-${indice}`}>
								{#if !areasPorCargo[grupo.cargo]}
									<p class="cargo-area-owner cargo-area-owner-pending">
										Selecciona el área que recibirá las actividades.
									</p>
								{:else if !responsableValido}
									<p class="cargo-area-owner cargo-area-owner-pending">
										Asigna un responsable activo a {areaSeleccionada?.etiqueta} desde Personal.
									</p>
								{:else}
									<p class="cargo-area-owner">
										<span class="owner-status"></span>Las tareas llegarán a
										<strong>{areaSeleccionada.responsable.nombre}</strong>
										· {areaSeleccionada.etiqueta}
									</p>
								{/if}
								<div class="cargo-roles">
									{#each rolesConfigurables as rol (rol)}
										{@const clave = claveRolCargo(grupo.cargo, rol)}
										{@const idsAsignados = rolesSeleccionados[grupo.cargo]?.[rol] ?? []}
										<div
											class="cargo-role-card"
											class:cargo-role-card-open={selectorCargoActivo === clave}
										>
											<div class="cargo-role-heading">
												<span>{etiquetaRol(rol)}</span>
												<span
													class="role-count"
													aria-label={`${idsAsignados.length} personas asignadas`}
													>{idsAsignados.length}</span
												>
											</div>
											<div class="role-assignees">
												{#if idsAsignados.length}
													{#each idsAsignados as usuarioId (usuarioId)}
														{@const usuario = usuarioPorId(usuarioId)}
														{#if usuario}
															<div
																class="assigned-person"
																title={`${usuario.nombre} · ${usuario.correo}`}
															>
																<span class="person-avatar">{iniciales(usuario.nombre)}</span>
																<span class="person-name">{usuario.nombre}</span>
																<button
																	type="button"
																	class="person-remove"
																	aria-label={`Quitar a ${usuario.nombre} como ${etiquetaRol(rol)} del cargo ${grupo.cargo}`}
																	onclick={() => quitarAsignacionCargo(grupo.cargo, rol, usuarioId)}
																	><X size={13} /></button
																>
															</div>
														{/if}
													{/each}
												{:else}
													<span class="role-empty">Aún sin asignar</span>
												{/if}
											</div>
											<button
												type="button"
												class="role-add"
												aria-label={`${selectorCargoActivo === clave ? 'Cerrar selector de' : 'Asignar'} ${etiquetaRol(rol)} para ${grupo.cargo}`}
												aria-expanded={selectorCargoActivo === clave}
												onclick={() => abrirSelectorCargo(grupo.cargo, rol)}
												><UserPlus size={15} />{selectorCargoActivo === clave
													? 'Cerrar selector'
													: 'Asignar persona'}</button
											>
											{#if selectorCargoActivo === clave}
												{@const usuarios = usuariosDisponibles(grupo.cargo, rol)}
												<div class="cargo-picker-panel">
													<label class="cargo-picker-search">
														<Search size={15} aria-hidden="true" />
														<span class="sr-only">Buscar usuarios</span>
														<input
															type="search"
															aria-label={`Buscar personas para ${etiquetaRol(rol)} en ${grupo.cargo}`}
															value={busquedaUsuariosCargo[clave] ?? ''}
															placeholder="Filtrar por nombre o correo"
															oninput={(event) => buscarUsuarioCargo(grupo.cargo, rol, event)}
														/>
													</label>
													<div
														class="cargo-picker-results"
														role="group"
														aria-label={`Usuarios disponibles para ${etiquetaRol(rol)} en ${grupo.cargo}`}
													>
														{#each usuarios as usuario (usuario.id)}
															<label class="cargo-user-option">
																<input
																	type="checkbox"
																	checked={idsAsignados.includes(usuario.id)}
																	onchange={(event) =>
																		cambiarAsignacionCargo(
																			grupo.cargo,
																			rol,
																			usuario.id,
																			event.currentTarget.checked
																		)}
																/>
																<span class="person-avatar">{iniciales(usuario.nombre)}</span>
																<span class="cargo-user-copy"
																	><strong>{usuario.nombre}</strong><small>{usuario.correo}</small
																	></span
																>
																{#if idsAsignados.includes(usuario.id)}<span
																		class="user-selected-icon"
																		aria-hidden="true"><Check size={15} /></span
																	>{/if}
															</label>
														{:else}
															<p class="cargo-users-empty">
																No hay usuarios con ese nombre o correo.
															</p>
														{/each}
													</div>
													{#if usuarios.length === 30}
														<p class="cargo-picker-hint">
															Mostrando hasta 30 coincidencias. Refina la búsqueda para encontrar
															otra persona.
														</p>
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</article>
				{/each}
			</div>
		</section>

		<section id="actividades" class="page-card section-panel">
			<div class="section-head">
				<div>
					<p class="section-kicker">EJECUCIÓN Y SOPORTES</p>
					<h2>Actividades y ocurrencias</h2>
					<p>Encuentra una actividad por nombre, cargo o alcance; filtra los meses por estado.</p>
				</div>
				<span class="activity-count"
					>{actividadesFiltradas.length} de {gestion.plan.actividades.length} actividades</span
				>
			</div>
			<div class="activity-toolbar">
				<BuscadorLista
					bind:valor={busquedaActividades}
					onBuscar={buscarActividades}
					placeholder="Buscar actividad, cargo, público…"
					etiqueta="Buscar actividades por nombre, cargo o alcance"
				/>
				<div class="activity-filters" role="group" aria-label="Filtrar ocurrencias">
					{#each filtrosActividad as filtro (filtro.id)}
						<button
							type="button"
							class:filter-active={filtrosActividades.estado === filtro.id}
							aria-pressed={filtrosActividades.estado === filtro.id}
							onclick={() => cambiarFiltroActividades(filtro.id)}>{filtro.label}</button
						>
					{/each}
				</div>
			</div>
			<div class="activity-list">
				<div class="activity-table-wrap">
					<table class="activity-table" aria-label="Actividades del plan" aria-busy={cargando}>
						<colgroup>
							<col class="activity-column-name" />
							<col class="activity-column-owner" />
							<col class="activity-column-scope" />
							<col class="activity-column-progress" />
							<col class="activity-column-action" />
						</colgroup>
						<thead>
							<tr>
								<th scope="col">Actividad</th>
								<th scope="col">Responsables</th>
								<th scope="col">Alcance</th>
								<th scope="col">Ocurrencias</th>
								<th scope="col"><span class="sr-only">Detalle</span></th>
							</tr>
						</thead>
						<tbody>
							{#each actividadesPaginadas as actividad (actividad.id)}
								{@const resumen = resumenOcurrenciasVisibles(actividad)}
								{@const abierta = filtrosActividades.actividad === actividad.id}
								<tr class:activity-row-open={abierta}>
									<td>
										<div class="activity-table-name">
											<strong>{actividad.actividad}</strong>
											<span class="tag">{actividad.es_pesv ? 'PESV' : 'HSEQ'}</span>
										</div>
										<small>{actividad.unidad_programa || 'Actividad del plan anual'}</small>
									</td>
									<td class="activity-cargo" title={actividad.responsable_cargos || 'Sin cargo definido'}>
										<div class="activity-cell-clamp">{actividad.responsable_cargos || 'Sin cargo definido'}</div>
									</td>
									<td class="activity-scope" title={actividad.alcance || 'Sin alcance definido'}>
										<div class="activity-cell-clamp">{actividad.alcance || '—'}</div>
									</td>
									<td>
										<div class="occurrence-summary">
											<strong>{resumen.total} {resumen.total === 1 ? 'mes' : 'meses'}</strong>
											<div class="occurrence-summary-meta">
												<span>{resumen.completadas} completadas</span>
												{#if resumen.atrasadas}<span class="late-count"
														>{resumen.atrasadas} atrasadas</span
													>{/if}
											</div>
										</div>
									</td>
									<td class="activity-expand-cell">
										<button
											type="button"
											class="activity-expand"
											class:activity-expand-open={abierta}
											aria-expanded={abierta}
											aria-controls={`actividad-detalle-${actividad.id}`}
											aria-label={`${abierta ? 'Ocultar' : 'Ver'} ocurrencias de ${actividad.actividad}`}
											onclick={() => toggleActividad(actividad.id)}
											><ChevronDown size={17} /></button
										>
									</td>
								</tr>
								{#if abierta}
									<tr class="activity-expanded-row">
										<td colspan="5">
											<div id={`actividad-detalle-${actividad.id}`} class="activity-detail">
												<div class="activity-body">
													<label class="check-row"
														><input
															type="checkbox"
															checked={actividad.requiere_evidencia}
															onchange={(event) => cambiarEvidencia(actividad, event)}
														/> Requiere soporte para cerrar</label
													>
													{#if actividad.alcance}<p class="muted">
															Público: {actividad.alcance}
														</p>{/if}
													{#each ocurrenciasVisibles(actividad) as ocurrencia (ocurrencia.id)}
														<div id="ocurrencia-{ocurrencia.id}" class="occurrence-row">
															<div class="occurrence-info">
																<span class="occurrence-month"
																	><CalendarDays size={16} />{new Date(
																		`${gestion.plan.anio}-${String(ocurrencia.mes).padStart(2, '0')}-01T12:00:00`
																	).toLocaleDateString('es-CO', { month: 'long' })}</span
																><strong
																	>Vence {new Date(
																		`${ocurrencia.fecha_vencimiento}T12:00:00`
																	).toLocaleDateString('es-CO')}</strong
																><span
																	class="occurrence-state"
																	class:occurrence-state-late={estaAtrasada(ocurrencia)}
																	>{estaAtrasada(ocurrencia)
																		? 'Atrasada'
																		: ocurrencia.estado.replaceAll('_', ' ')}</span
																>
																{#each gestion.evidencias.filter((e: any) => e.objetivo_id === ocurrencia.id) as evidencia}<button
																		class="link-button"
																		onclick={() => abrirEvidencia(evidencia.id)}
																		>{evidencia.nombre_archivo}</button
																	>{/each}
															</div>
															<div class="driver-assignment">
																<div class="role-tabs" aria-label="Rol de conductores asignados">
																	{#each roles as rol}<button
																			type="button"
																			class:role-active={(rolActivoPorOcurrencia[ocurrencia.id] ??
																				'RESPONSABLE') === rol}
																			onclick={() => (rolActivoPorOcurrencia[ocurrencia.id] = rol)}
																			>{etiquetaRol(rol)}</button
																		>{/each}
																</div>
																<label class="driver-select"
																	>Conductores · {etiquetaRol(
																		rolActivoPorOcurrencia[ocurrencia.id] ?? 'RESPONSABLE'
																	)}
																	<select
																		multiple
																		size="3"
																		aria-label="Conductores asignados"
																		onchange={(event) =>
																			cambiarConductores(
																				ocurrencia.id,
																				rolActivoPorOcurrencia[ocurrencia.id] ?? 'RESPONSABLE',
																				event
																			)}
																	>
																		{#each gestion.conductores as conductor}<option
																				value={conductor.id}
																				selected={conductoresSeleccionados[ocurrencia.id]?.[
																					rolActivoPorOcurrencia[ocurrencia.id] ?? 'RESPONSABLE'
																				]?.includes(conductor.id)}
																				>{conductor.nombre}
																				{conductor.apellido} · {conductor.numero_identificacion}</option
																			>{/each}
																	</select>
																</label>
																<button
																	class="secondary"
																	onclick={() => asignarConductores(ocurrencia.id)}
																	><UsersRound size={15} />Guardar conductores</button
																>
															</div>
															<div class="occurrence-actions">
																<label class="upload-control"
																	>Añadir soporte<input
																		type="file"
																		accept="application/pdf,image/*,.docx,.xlsx"
																		aria-label="Subir soporte de la actividad"
																		onchange={(event) => subirArchivo(ocurrencia.id, event)}
																	/></label
																>
																{#if ocurrencia.estado === 'PENDIENTE'}<div
																		class="occurrence-action-buttons"
																	>
																		<button class="primary" onclick={() => completar(ocurrencia.id)}
																			><Check size={15} />Completar</button
																		><button class="quiet" onclick={() => noAplica(ocurrencia.id)}
																			>No aplica…</button
																		>
																	</div>{/if}
															</div>
														</div>
													{/each}
												</div>
											</div>
										</td>
									</tr>
								{/if}
							{/each}
							{#if actividadesFiltradas.length === 0}
								<tr>
									<td colspan="5">
										<div class="activity-empty">
											<span class="activity-empty-icon"><Search size={20} /></span>
											<strong>No hay coincidencias</strong>
											<span>Ajusta la búsqueda o el estado seleccionado.</span>
										</div>
									</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
				<PaginadorLista
					pagina={filtrosActividades.pagina}
					total={actividadesFiltradas.length}
					porPagina={filtrosActividades.porPagina}
					opcionesPorPagina={[10, 20, 50, 0]}
					nombreItems="actividades"
					onCambiar={cambiarPaginaActividades}
					onCambiarPorPagina={cambiarTamanoPaginaActividades}
					suelto
				/>
			</div>
		</section>
	{/if}
</main>

<style>
	.plan-page {
		display: grid;
		gap: 1.15rem;
		width: 100%;
		min-width: 0;
		min-height: 100%;
		box-sizing: border-box;
		padding: 1.5rem;
		color: var(--text-primary);
	}
	.plan-header,
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem 1.5rem;
	}
	.plan-header {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		flex-wrap: wrap;
		align-items: flex-end;
		min-height: 10rem;
		padding: 1.7rem 1.9rem;
		border-color: transparent;
		background: linear-gradient(118deg, var(--au-dark), var(--au-dark-2));
		color: #fff;
	}
	.plan-header::after {
		position: absolute;
		z-index: -1;
		top: -9rem;
		right: 12%;
		width: 28rem;
		height: 28rem;
		border: 1px solid color-mix(in srgb, var(--au-eyebrow) 25%, transparent);
		border-radius: 50%;
		background: radial-gradient(
			circle at 48% 52%,
			color-mix(in srgb, var(--au-primary) 32%, transparent),
			transparent 67%
		);
		content: '';
	}
	.plan-heading {
		display: grid;
		gap: 0.4rem;
		min-width: min(100%, 32rem);
	}
	.plan-heading h1 {
		margin: 0;
		color: #fff;
		font-family: var(--font-display);
		font-size: clamp(1.8rem, 3vw, 2.5rem);
		font-weight: 850;
		letter-spacing: -0.04em;
		line-height: 1.08;
	}
	.plan-heading p:last-child {
		max-width: 48rem;
		margin: 0;
		color: color-mix(in srgb, #fff 78%, var(--au-eyebrow));
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.eyebrow,
	.section-kicker {
		margin: 0;
		color: var(--au-primary-strong);
		font-size: 0.7rem;
		font-weight: 850;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.plan-header .eyebrow {
		color: var(--au-eyebrow);
	}
	.plan-header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
	}
	.plan-status {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.58rem 0.78rem;
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.75rem;
		font-weight: 750;
		backdrop-filter: blur(10px);
	}
	.plan-status span {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--au-eyebrow);
		box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1);
	}
	.plan-status-active {
		border-color: color-mix(in srgb, var(--au-eyebrow) 50%, transparent);
		color: #fff;
	}
	.plan-status-active span {
		background: #7ee0aa;
	}
	.plan-picker,
	.period-picker,
	.reference-bands label {
		display: grid;
		gap: 0.4rem;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 750;
	}
	.plan-picker {
		color: rgba(255, 255, 255, 0.75);
	}
	.plan-picker select,
	.period-picker select {
		min-width: 12rem;
	}
	.plan-header select {
		border-color: rgba(255, 255, 255, 0.45);
	}
	.plan-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-self: flex-start;
		padding: 0.3rem;
		border: 1px solid var(--border-default);
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: var(--shadow-card);
	}
	.plan-tabs a {
		padding: 0.5rem 0.9rem;
		border-radius: 12px;
		color: var(--text-muted);
		font-size: 0.82rem;
		font-weight: 750;
		text-decoration: none;
		transition:
			background 0.15s,
			color 0.15s,
			transform 0.15s;
	}
	.plan-tabs a:hover {
		transform: translateY(-1px);
		background: color-mix(in srgb, var(--au-primary-strong) 9%, white);
		color: var(--au-dark);
	}
	.summary-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.85rem;
	}
	.summary-grid .stat-card {
		display: grid;
		grid-template-columns: 2.5rem 1fr;
		grid-template-areas: 'icon label' 'icon value' 'note note';
		align-items: center;
		gap: 0.08rem 0.75rem;
		min-width: 0;
		padding: 1rem 1.15rem;
		border-radius: 18px;
		transition:
			transform 0.18s,
			border-color 0.18s,
			box-shadow 0.18s;
	}
	.summary-grid .stat-card:hover {
		transform: translateY(-2px);
		border-color: color-mix(in srgb, var(--au-primary-strong) 25%, var(--border-subtle));
		box-shadow: var(--shadow-card-hover);
	}
	.stat-icon {
		display: grid;
		grid-area: icon;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 14px;
		background: color-mix(in srgb, var(--au-primary-strong) 10%, white);
		color: var(--au-primary-strong);
	}
	.stat-icon-good {
		background: #e7f6ec;
		color: #26824d;
	}
	.stat-icon-alert {
		background: #fff0e9;
		color: #b54732;
	}
	.summary-grid .stat-label {
		grid-area: label;
		color: var(--text-muted);
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}
	.summary-grid .stat-value {
		grid-area: value;
		color: var(--au-dark);
		font-size: 1.8rem;
		font-weight: 850;
		line-height: 1.15;
	}
	.stat-note {
		grid-area: note;
		margin-top: 0.45rem;
		color: var(--text-very-muted);
		font-size: 0.75rem;
	}
	.stat-card-alert .stat-value,
	.stat-card-alert .stat-label {
		color: #a94735;
	}
	.section-panel {
		display: grid;
		gap: 1.25rem;
		width: 100%;
		min-width: 0;
		scroll-margin-top: 1.25rem;
	}
	#responsables.section-panel {
		gap: 0.75rem;
		padding: 1rem 1.25rem;
	}
	.config-head {
		align-items: center;
	}
	.config-head > .config-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		flex: 0 0 auto;
	}
	.config-actions .primary,
	.config-toggle {
		min-height: 2.45rem;
		white-space: nowrap;
	}
	.config-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
	}
	.config-toggle :global(svg) {
		transition: transform 0.18s ease;
	}
	.config-toggle :global(.compact-chevron-open) {
		transform: rotate(180deg);
	}
	.config-overview {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 700;
	}
	.config-incomplete {
		width: fit-content;
		margin: 0.05rem 0 0;
		padding: 0.32rem 0.55rem;
	}
	.config-grid-hidden {
		display: none;
	}
	.section-head {
		align-items: flex-end;
	}
	.section-head > div {
		display: grid;
		gap: 0.34rem;
	}
	.section-head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.2rem, 1.6vw, 1.5rem);
		font-weight: 850;
		letter-spacing: -0.025em;
	}
	.section-head p:not(.section-kicker) {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.85rem;
		line-height: 1.5;
	}
	.area-owners-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		width: fit-content;
		color: var(--au-primary-strong);
		font-size: 0.76rem;
		font-weight: 750;
		text-decoration: none;
	}
	.area-owners-link :global(svg) {
		transform: rotate(-90deg);
	}
	.config-incomplete {
		margin: 0.1rem 0 0;
		padding: 0.55rem 0.7rem;
		border: 1px solid color-mix(in srgb, #d97706 24%, var(--border-subtle));
		border-radius: 9px;
		color: #a16207;
		background: color-mix(in srgb, #f59e0b 7%, var(--bg-surface));
		font-size: 0.7rem;
		font-weight: 650;
	}
	.activity-count {
		flex: 0 0 auto;
		padding: 0.45rem 0.65rem;
		border: 1px solid var(--border-default);
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 750;
	}
	.panel {
		border: 1px solid var(--border-default);
		border-radius: 18px;
		background: var(--bg-surface);
		padding: 1.25rem;
		box-shadow: var(--shadow-card);
	}
	.kpi-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}
	.kpi-card {
		display: grid;
		gap: 0.9rem;
		min-width: 0;
		padding: 1.25rem 1.35rem;
		border: 1px solid var(--border-subtle);
		border-radius: 18px;
		background: linear-gradient(
			145deg,
			var(--bg-surface),
			color-mix(in srgb, var(--bg-base) 70%, white)
		);
		box-shadow: var(--shadow-card);
		transition:
			transform 0.18s,
			border-color 0.18s,
			box-shadow 0.18s;
	}
	.kpi-card:hover {
		transform: translateY(-2px);
		border-color: color-mix(in srgb, var(--au-primary-strong) 25%, var(--border-subtle));
		box-shadow: var(--shadow-card-hover);
	}
	.kpi-card-heading {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}
	.kpi-number {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		flex: 0 0 auto;
		border-radius: 12px;
		background: var(--au-dark);
		color: white !important;
		font-size: 0.82rem !important;
		font-weight: 850;
	}
	.kpi-kind {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--text-muted) !important;
		font-size: 0.72rem !important;
		font-weight: 750;
	}
	.kpi-status {
		margin-left: auto;
		padding: 0.37rem 0.6rem;
		border-radius: 999px;
		background: #fff2e8;
		color: #a84931 !important;
		font-size: 0.68rem !important;
		font-weight: 800;
		text-align: center;
	}
	.kpi-status-good {
		background: #e9f6ed;
		color: #277647 !important;
	}
	.kpi-status-pending {
		background: var(--bg-base);
		color: var(--text-muted) !important;
	}
	.kpi-name {
		min-height: 2.8em;
		color: var(--text-primary);
		font-size: 0.96rem;
		line-height: 1.4;
	}
	.kpi-reading {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
	}
	.kpi-value {
		display: grid;
		gap: 0.15rem;
		color: var(--au-dark);
		font-size: clamp(2rem, 3vw, 2.75rem);
		font-weight: 900;
		letter-spacing: -0.06em;
		line-height: 1;
	}
	.kpi-value small {
		color: var(--text-muted);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0;
	}
	.kpi-target {
		display: grid;
		gap: 0.2rem;
		justify-items: end;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
	}
	.kpi-target span {
		color: var(--text-muted);
		font-size: 0.67rem;
		font-weight: 750;
	}
	.kpi-target strong {
		color: var(--au-primary-strong);
		font-size: 1.05rem;
	}
	.target-meter {
		position: relative;
		height: 0.62rem;
		overflow: visible;
		border-radius: 999px;
		background: var(--border-subtle);
	}
	.target-meter-fill {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--au-primary), var(--au-dark-2));
	}
	.target-meter-mark {
		position: absolute;
		top: 50%;
		width: 0.9rem;
		height: 0.9rem;
		border: 3px solid var(--bg-surface);
		border-radius: 50%;
		background: #f1a33c;
		box-shadow: 0 0 0 1px color-mix(in srgb, #f1a33c 45%, white);
		transform: translate(-50%, -50%);
	}
	.meter-caption {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		color: var(--text-very-muted);
		font-size: 0.66rem;
		font-weight: 700;
	}
	.kpi-settings {
		border-top: 1px solid var(--border-subtle);
		padding-top: 0.7rem;
	}
	.kpi-settings summary {
		color: var(--au-primary-strong);
		font-size: 0.75rem;
		font-weight: 800;
		cursor: pointer;
		list-style: none;
	}
	.kpi-settings summary::-webkit-details-marker {
		display: none;
	}
	.kpi-settings summary::after {
		float: right;
		content: '+';
		font-size: 1rem;
		line-height: 0.8;
	}
	.kpi-settings[open] summary::after {
		content: '−';
	}
	.kpi-settings-content {
		display: grid;
		gap: 0.75rem;
		padding-top: 0.75rem;
	}
	.manual-row {
		display: grid;
		grid-template-columns: minmax(14rem, 1fr) minmax(14rem, 1fr);
		align-items: center;
		gap: 0.65rem;
		padding: 0.25rem 0;
	}
	.manual-row label,
	.check-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-secondary);
		font-size: 0.8rem;
		font-weight: 700;
	}
	.manual-row input[type='checkbox'],
	.check-row input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--au-primary-strong);
	}
	.manual-actions {
		display: flex;
		grid-column: 1/-1;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.reference-bands {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		align-items: end;
		gap: 0.6rem;
		border-top: 1px solid var(--border-subtle);
		padding-top: 0.75rem;
	}
	.reference-bands > strong {
		grid-column: 1/-1;
		color: var(--text-secondary);
		font-size: 0.76rem;
	}
	.text-input,
	select {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		border: 1px solid var(--border-emphasis);
		border-radius: 10px;
		padding: 0.6rem 0.7rem;
		color: var(--text-primary);
		background: var(--bg-surface);
		font: inherit;
	}
	.reference-bands .quiet {
		grid-column: 1/-1;
		justify-self: start;
	}
	.cargo-grid {
		display: grid;
		gap: 0.35rem;
		width: 100%;
	}
	.cargo-card {
		min-width: 0;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: var(--bg-surface);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.cargo-card-expanded,
	.cargo-card:focus-within {
		border-color: color-mix(in srgb, var(--au-primary-strong) 34%, var(--border-subtle));
		background: color-mix(in srgb, var(--au-primary-strong) 1.5%, var(--bg-surface));
	}
	.cargo-compact-row {
		display: grid;
		grid-template-columns:
			minmax(220px, 1.35fr) minmax(190px, 0.8fr) minmax(130px, 0.65fr)
			auto auto;
		align-items: center;
		gap: 0.65rem;
		min-height: 62px;
		padding: 0.5rem 0.7rem;
	}
	.cargo-title {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
	}
	.cargo-index {
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		flex: 0 0 auto;
		border-radius: 10px;
		background: color-mix(in srgb, var(--au-primary-strong) 9%, white);
		color: var(--au-primary-strong);
		font-size: 0.65rem;
		font-weight: 850;
	}
	.cargo-title > div {
		display: grid;
		gap: 0.08rem;
		min-width: 0;
	}
	.cargo-title small {
		color: var(--text-very-muted);
		font-size: 0.55rem;
		font-weight: 850;
		letter-spacing: 0.09em;
	}
	.cargo-title strong {
		display: -webkit-box;
		overflow: hidden;
		color: var(--text-primary);
		font-size: 0.78rem;
		line-height: 1.25;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
	}
	.cargo-area-select {
		display: block;
		min-width: 0;
	}
	.cargo-area-select select {
		min-height: 36px;
		padding: 0.42rem 0.6rem;
		border-radius: 9px;
		font-size: 0.72rem;
	}
	.cargo-manager {
		display: inline-flex;
		align-items: center;
		gap: 0.38rem;
		min-width: 0;
		max-width: 180px;
		overflow: hidden;
		color: var(--text-secondary);
		font-size: 0.68rem;
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cargo-manager-pending {
		color: #a16207;
	}
	.cargo-manager-pending .owner-status {
		background: #d97706;
	}
	.owner-status {
		width: 7px;
		height: 7px;
		flex: 0 0 auto;
		border-radius: 50%;
		background: #15966b;
	}
	.cargo-extras-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-height: 34px;
		padding: 0.4rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 8px;
		color: var(--text-muted);
		background: transparent;
		font: inherit;
		font-size: 0.68rem;
		font-weight: 750;
		white-space: nowrap;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s,
			border-color 0.15s;
	}
	.cargo-extras-toggle:hover {
		border-color: var(--border-subtle);
		color: var(--au-primary-strong);
		background: var(--bg-base);
	}
	.cargo-extras-toggle:focus-visible {
		outline: 2px solid var(--au-primary-strong);
		outline-offset: 2px;
	}
	.cargo-extras-toggle :global(svg) {
		flex: 0 0 auto;
		transition: transform 0.18s ease;
	}
	.cargo-extras-toggle :global(.compact-chevron-open) {
		transform: rotate(180deg);
	}
	.save-cargo {
		min-height: 34px;
		padding: 0.4rem 0.65rem;
		font-size: 0.68rem;
		white-space: nowrap;
	}
	.cargo-details {
		display: grid;
		gap: 0.65rem;
		padding: 0.65rem 0.75rem 0.75rem;
		border-top: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-base) 42%, var(--bg-surface));
	}
	.cargo-area-owner {
		display: flex;
		align-items: center;
		gap: 0.32rem;
		margin: 0;
		color: var(--text-muted);
		font-size: 0.7rem;
	}
	.cargo-area-owner strong {
		color: var(--text-primary);
	}
	.cargo-area-owner-pending {
		color: #a16207;
	}
	.cargo-roles {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-items: start;
		gap: 0.55rem;
	}
	.cargo-role-card {
		display: grid;
		align-content: start;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.65rem;
		border: 1px solid var(--border-subtle);
		border-radius: 11px;
		background: var(--bg-surface);
		transition:
			background 0.16s,
			border-color 0.16s,
			box-shadow 0.16s;
	}
	.cargo-role-card-open {
		border-color: color-mix(in srgb, var(--au-primary-strong) 38%, var(--border-subtle));
		background: var(--bg-surface);
		box-shadow: 0 6px 18px color-mix(in srgb, var(--au-primary-strong) 8%, transparent);
	}
	.cargo-role-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 800;
	}
	.role-count {
		display: grid;
		place-items: center;
		min-width: 1.35rem;
		height: 1.35rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--bg-surface);
		color: var(--text-muted);
		font-size: 0.65rem;
		font-weight: 800;
	}
	.role-assignees {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: 0.35rem;
		min-height: 2rem;
		max-height: 5.8rem;
		overflow: auto;
	}
	.assigned-person {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		max-width: 100%;
		padding: 0.22rem 0.28rem;
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		background: var(--bg-surface);
	}
	.person-avatar {
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		flex: 0 0 auto;
		border-radius: 50%;
		background: color-mix(in srgb, var(--au-primary-strong) 12%, white);
		color: var(--au-primary-strong);
		font-size: 0.57rem;
		font-weight: 850;
	}
	.person-name {
		max-width: 9rem;
		overflow: hidden;
		color: var(--text-secondary);
		font-size: 0.65rem;
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.person-remove {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		flex: 0 0 auto;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--text-very-muted);
		cursor: pointer;
	}
	.person-remove:hover {
		background: #fff0e9;
		color: #a94735;
	}
	.role-empty {
		display: inline-flex;
		align-items: center;
		min-height: 1.9rem;
		padding: 0.3rem 0.55rem;
		border: 1px dashed var(--border-emphasis);
		border-radius: 10px;
		color: var(--text-very-muted);
		font-size: 0.67rem;
	}
	.role-add {
		display: inline-flex;
		align-items: center;
		justify-self: start;
		gap: 0.4rem;
		padding: 0.42rem 0.6rem;
		border: 1px dashed color-mix(in srgb, var(--au-primary-strong) 40%, var(--border-default));
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--au-primary-strong);
		font: inherit;
		font-size: 0.68rem;
		font-weight: 800;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.role-add:hover {
		border-color: var(--au-primary-strong);
		background: color-mix(in srgb, var(--au-primary-strong) 6%, white);
	}
	.cargo-picker-panel {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		padding-top: 0.25rem;
		animation: picker-enter 0.16s ease-out both;
	}
	.cargo-picker-search {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--border-emphasis);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-very-muted);
	}
	.cargo-picker-search:focus-within {
		border-color: var(--au-primary-strong);
		color: var(--au-primary-strong);
	}
	.cargo-picker-search input {
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text-primary);
		font: inherit;
		font-size: 0.7rem;
	}
	.cargo-picker-results {
		display: grid;
		gap: 0.15rem;
		max-height: 14rem;
		overflow-y: auto;
		padding: 0.15rem;
	}
	.cargo-user-option {
		display: grid;
		grid-template-columns: auto 1.4rem minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		padding: 0.42rem;
		border-radius: 10px;
		cursor: pointer;
		transition: background 0.12s;
	}
	.cargo-user-option:hover {
		background: color-mix(in srgb, var(--au-primary-strong) 7%, white);
	}
	.cargo-user-option > input {
		width: 0.95rem;
		height: 0.95rem;
		margin: 0;
		accent-color: var(--au-primary-strong);
	}
	.cargo-user-copy {
		display: grid;
		min-width: 0;
	}
	.cargo-user-copy strong,
	.cargo-user-copy small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cargo-user-copy strong {
		color: var(--text-primary);
		font-size: 0.67rem;
		font-weight: 750;
	}
	.cargo-user-copy small {
		color: var(--text-muted);
		font-size: 0.61rem;
	}
	.user-selected-icon {
		color: var(--au-primary-strong);
	}
	.cargo-users-empty,
	.cargo-picker-hint {
		margin: 0;
		padding: 0.4rem;
		color: var(--text-muted);
		font-size: 0.66rem;
		line-height: 1.4;
	}
	@keyframes picker-enter {
		from {
			transform: translateY(-0.2rem);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	.driver-select select {
		width: 100%;
		min-height: 5.8rem;
		padding: 0.4rem;
		font-size: 0.72rem;
	}
	.save-cargo {
		white-space: nowrap;
	}
	.driver-assignment {
		display: grid;
		align-content: start;
		gap: 0.65rem;
		min-width: 0;
	}
	.driver-assignment .secondary {
		justify-self: start;
	}
	.driver-select {
		display: grid;
		gap: 0.4rem;
		min-width: 0;
		color: var(--text-secondary);
		font-size: 0.76rem;
		font-weight: 750;
	}
	.role-tabs {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.role-tabs button,
	.activity-filters button {
		border: 1px solid var(--border-default);
		border-radius: 999px;
		padding: 0.42rem 0.65rem;
		background: var(--bg-surface);
		color: var(--text-muted);
		font-size: 0.7rem;
		font-weight: 750;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.role-tabs .role-active,
	.activity-filters .filter-active {
		border-color: var(--au-primary-strong);
		background: color-mix(in srgb, var(--au-primary-strong) 9%, white);
		color: var(--au-dark);
	}
	.primary,
	.secondary,
	.quiet,
	.link-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		border: 0;
		border-radius: 10px;
		padding: 0.62rem 0.82rem;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 800;
		cursor: pointer;
		transition:
			transform 0.15s,
			filter 0.15s;
	}
	.primary:hover:not(:disabled),
	.secondary:hover,
	.quiet:hover {
		transform: translateY(-1px);
		filter: brightness(0.98);
	}
	.primary {
		background: var(--au-primary-strong);
		color: white;
		box-shadow: 0 5px 14px color-mix(in srgb, var(--au-primary-strong) 18%, transparent);
	}
	.primary:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.secondary {
		background: color-mix(in srgb, var(--au-primary-strong) 10%, white);
		color: var(--au-dark);
	}
	.quiet,
	.link-button {
		background: transparent;
		color: var(--au-primary-strong);
	}
	.activity-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.85rem;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		background: var(--bg-base);
	}
	.activity-toolbar > :global(.buscador) {
		flex: 1 1 24rem;
		max-width: 32rem;
		min-width: 16rem;
	}
	.activity-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.activity-filters button {
		padding: 0.48rem 0.72rem;
	}
	.activity-list {
		display: grid;
		gap: 0.35rem;
		width: 100%;
		min-width: 0;
	}
	.activity-table-wrap {
		width: 100%;
		min-width: 0;
		overflow: auto;
		border: 1px solid var(--border-default);
		border-radius: 15px;
		background: var(--bg-surface);
	}
	.activity-table {
		width: 100%;
		min-width: 920px;
		table-layout: fixed;
		border-collapse: collapse;
		border-spacing: 0;
		font-size: 0.78rem;
	}
	.activity-column-name {
		width: 29%;
	}
	.activity-column-owner {
		width: 21%;
	}
	.activity-column-scope {
		width: 25%;
	}
	.activity-column-progress {
		width: 19%;
	}
	.activity-column-action {
		width: 6%;
	}
	.activity-table th {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 0.78rem 0.85rem;
		border-right: 1px solid var(--border-subtle);
		border-bottom: 1px solid var(--border-default);
		background: var(--bg-base);
		color: var(--text-muted);
		font-size: 0.64rem;
		font-weight: 850;
		letter-spacing: 0.07em;
		text-align: left;
		text-transform: uppercase;
	}
	.activity-table th:last-child {
		border-right: 0;
	}
	.activity-table td {
		padding: 0.78rem 0.65rem;
		border-right: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent);
		border-bottom: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		vertical-align: middle;
	}
	.activity-table td:last-child {
		border-right: 0;
	}
	.activity-table tbody tr:nth-child(even):not(.activity-expanded-row) td {
		background: color-mix(in srgb, var(--au-primary-strong) 2%, var(--bg-surface));
	}
	.activity-table tbody tr:not(.activity-expanded-row):hover td {
		background: color-mix(in srgb, var(--au-primary-strong) 3%, var(--bg-surface));
	}
	.activity-table .activity-row-open td {
		border-bottom-color: color-mix(in srgb, var(--au-primary-strong) 17%, var(--border-subtle));
		background: color-mix(in srgb, var(--au-primary-strong) 4%, var(--bg-surface));
	}
	.activity-table-name {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.48rem;
		min-width: 0;
	}
	.activity-table-name strong {
		display: -webkit-box;
		min-width: 0;
		flex: 1 1 12rem;
		overflow: hidden;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		color: var(--text-primary);
		font-size: 0.8rem;
		line-height: 1.4;
	}
	.activity-table td > small {
		margin-top: 0.2rem;
		overflow: hidden;
		color: var(--text-muted);
		font-size: 0.68rem;
		line-height: 1.4;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
	}
	.activity-cargo,
	.activity-scope {
		max-width: none;
	}
	.activity-cell-clamp {
		display: -webkit-box;
		overflow: hidden;
		overflow-wrap: anywhere;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-height: 1.45;
	}
	.activity-cargo {
		color: var(--text-secondary);
		font-weight: 650;
	}
	.occurrence-summary {
		display: grid;
		gap: 0.22rem;
		white-space: nowrap;
	}
	.occurrence-summary > strong {
		color: var(--text-primary);
		font-size: 0.76rem;
	}
	.occurrence-summary-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.55rem;
		color: var(--text-muted);
		font-size: 0.63rem;
	}
	.occurrence-summary-meta .late-count {
		color: #ad4935;
		font-weight: 750;
	}
	.activity-expand-cell {
		text-align: center;
	}
	.activity-expand {
		display: inline-grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--au-primary-strong);
		cursor: pointer;
		transition:
			transform 0.16s ease,
			background 0.16s ease,
			border-color 0.16s ease;
	}
	.activity-expand:hover {
		border-color: color-mix(in srgb, var(--au-primary-strong) 35%, var(--border-subtle));
		background: color-mix(in srgb, var(--au-primary-strong) 7%, white);
	}
	.activity-expand-open {
		transform: rotate(180deg);
	}
	.activity-expanded-row > td {
		padding: 0 !important;
		background: var(--bg-base);
	}
	.activity-detail {
		padding: 0.8rem;
		animation: picker-enter 0.16s ease-out both;
	}
	.tag {
		flex: 0 0 auto;
		padding: 0.34rem 0.58rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--au-primary-strong) 8%, white);
		color: var(--au-primary-strong);
		font-size: 0.66rem;
		font-weight: 850;
		letter-spacing: 0.03em;
	}
	.activity-body {
		display: grid;
		gap: 0.8rem;
		padding: 0.15rem;
	}
	.activity-body > .check-row,
	.activity-body > .muted {
		padding: 0.7rem 0.8rem;
		border-radius: 12px;
		background: var(--bg-base);
	}
	.activity-body > .muted {
		line-height: 1.5;
	}
	.occurrence-row {
		display: grid;
		grid-template-columns: minmax(12rem, 0.72fr) minmax(19rem, 1.35fr) minmax(15rem, 0.9fr);
		align-items: start;
		gap: 1rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		background: linear-gradient(120deg, var(--bg-base), var(--bg-surface));
		scroll-margin-top: 1.25rem;
	}
	.occurrence-info {
		display: grid;
		align-content: start;
		justify-items: start;
		gap: 0.4rem;
		min-width: 0;
	}
	.occurrence-month {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--au-primary-strong) !important;
		font-size: 0.86rem !important;
		font-weight: 850;
		text-transform: capitalize;
	}
	.occurrence-info > strong {
		color: var(--text-primary);
		font-size: 0.76rem;
	}
	.occurrence-state {
		padding: 0.32rem 0.55rem;
		border-radius: 999px;
		background: #e9f6ed;
		color: #277647 !important;
		font-size: 0.66rem !important;
		font-weight: 800;
	}
	.occurrence-state-late {
		background: #fff0e9;
		color: #ad4935 !important;
	}
	.link-button {
		justify-content: flex-start;
		max-width: 100%;
		padding: 0.2rem 0;
		overflow-wrap: anywhere;
		text-align: left;
		text-decoration: underline;
	}
	.occurrence-actions {
		display: grid;
		align-content: start;
		gap: 0.75rem;
		min-width: 0;
	}
	.upload-control {
		display: grid;
		gap: 0.4rem;
		color: var(--text-secondary);
		font-size: 0.74rem;
		font-weight: 750;
	}
	.upload-control input {
		width: 100%;
		min-width: 0;
		color: var(--text-muted);
		font-size: 0.7rem;
	}
	.occurrence-action-buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}
	.activity-empty {
		display: grid;
		justify-items: center;
		gap: 0.35rem;
		padding: 2rem 1rem;
		border: 1px dashed var(--border-emphasis);
		border-radius: 16px;
		color: var(--text-muted);
		text-align: center;
	}
	.activity-empty-icon {
		margin-bottom: 0.2rem;
		color: var(--au-primary-strong);
	}
	.activity-empty strong {
		color: var(--text-primary);
		font-size: 0.88rem;
	}
	.activity-empty span {
		font-size: 0.78rem;
	}
	.state {
		padding: 2rem;
		color: var(--text-muted);
	}
	.error {
		color: #b42318;
	}
	.empty h2 {
		margin: 0;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		clip-path: inset(50%);
	}
	@media (min-width: 1500px) {
		.kpi-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 1250px) {
		.cargo-roles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.cargo-role-card:last-child {
			grid-column: auto;
		}
	}
	@media (max-width: 1050px) {
		.summary-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.occurrence-row {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.occurrence-info {
			grid-column: 1/-1;
		}
	}
	@media (max-width: 760px) {
		#responsables.section-panel {
			padding: 0.9rem;
		}
		.config-head {
			align-items: flex-start;
		}
		.config-actions {
			width: 100%;
		}
		.config-actions .primary {
			flex: 1;
		}
		.plan-page {
			padding: 1rem;
		}
		.plan-header {
			min-height: 0;
			padding: 1.35rem;
		}
		.plan-header-actions {
			align-items: stretch;
			width: 100%;
		}
		.plan-picker,
		.plan-header-actions .plan-status {
			flex: 1;
		}
		.plan-picker select {
			min-width: 0;
		}
		.section-head {
			align-items: flex-start;
			flex-direction: column;
		}
		.kpi-grid {
			grid-template-columns: 1fr;
		}
		.activity-toolbar {
			align-items: stretch;
		}
		.activity-toolbar > :global(.buscador) {
			width: 100%;
			min-width: 0;
			min-height: 2.6rem;
		}
		.activity-filters {
			flex-wrap: nowrap;
			overflow-x: auto;
			padding-bottom: 0.1rem;
		}
		.activity-filters button {
			flex: 0 0 auto;
		}
		.occurrence-row {
			grid-template-columns: 1fr;
		}
		.occurrence-info {
			grid-column: auto;
		}
	}
	@media (max-width: 520px) {
		.summary-grid {
			grid-template-columns: 1fr 1fr;
			gap: 0.55rem;
		}
		.summary-grid .stat-card {
			grid-template-columns: 2rem 1fr;
			gap: 0.08rem 0.55rem;
			padding: 0.8rem;
		}
		.stat-icon {
			width: 2rem;
			height: 2rem;
		}
		.summary-grid .stat-value {
			font-size: 1.55rem;
		}
		.cargo-card {
			padding: 0;
		}
		.cargo-compact-row {
			grid-template-columns: minmax(0, 1fr) auto auto;
			gap: 0.35rem;
			padding: 0.5rem;
		}
		.cargo-title {
			grid-column: 1;
			grid-row: 1;
		}
		.cargo-area-select {
			grid-column: 1 / 3;
			grid-row: 2;
		}
		.cargo-manager {
			grid-column: 3;
			grid-row: 2;
			max-width: 112px;
			justify-self: end;
		}
		.cargo-extras-toggle {
			grid-column: 2;
			grid-row: 1;
		}
		.save-cargo {
			grid-column: 3;
			grid-row: 1;
			width: auto;
			padding: 0.4rem 0.5rem;
		}
		.cargo-roles {
			grid-template-columns: 1fr;
		}
		.cargo-role-card:last-child {
			grid-column: auto;
		}
		.manual-row,
		.reference-bands {
			grid-template-columns: 1fr;
		}
		.reference-bands > strong,
		.reference-bands .quiet {
			grid-column: auto;
		}
		.plan-tabs {
			width: 100%;
			overflow-x: auto;
			flex-wrap: nowrap;
		}
		.plan-tabs a {
			flex: 0 0 auto;
		}
	}
</style>
