<script lang="ts">
	import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, TriangleAlert } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		obtenerAnaliticaIndividual,
		type AnaliticaIndividual as DatosAnalitica,
		type TipoEntidadAnalitica
	} from '$lib/api/analiticaIndividual';
	import MapaRutasCliente from './MapaRutasCliente.svelte';

	interface Props {
		tipo: TipoEntidadAnalitica;
		entidadId: string;
	}

	let { tipo, entidadId }: Props = $props();
	type ModoPeriodo = 'mes' | 'semana' | 'rango';
	const hoy = new Date();
	let datos = $state<DatosAnalitica | null>(null);
	let cargando = $state(false);
	let error = $state<string | null>(null);
	let ultimoPedido = 0;

	const iso = (fecha: Date) => {
		const y = fecha.getFullYear();
		const m = String(fecha.getMonth() + 1).padStart(2, '0');
		const d = String(fecha.getDate()).padStart(2, '0');
		return [y, m, d].join('-');
	};
	const fechaUrl = (valor: string | null) => {
		if (!valor || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(valor)) return null;
		const fecha = new Date(valor + 'T12:00:00');
		return iso(fecha) === valor ? fecha : null;
	};
	const modo = $derived.by((): ModoPeriodo => {
		const valor = page.url.searchParams.get('periodo');
		return valor === 'semana' || valor === 'rango' ? valor : 'mes';
	});
	const historico = $derived(tipo === 'cliente' && (page.url.searchParams.get('vista') === 'historico' || page.url.searchParams.get('mapa') === 'historico'));
	const ancla = $derived(fechaUrl(page.url.searchParams.get('fecha')) ?? (modo === 'rango' ? fechaUrl(page.url.searchParams.get('desde')) : null) ?? hoy);
	const desdeManual = $derived(iso(fechaUrl(page.url.searchParams.get('desde')) ?? new Date(ancla.getFullYear(), ancla.getMonth(), 1)));
	const hastaManual = $derived(iso(fechaUrl(page.url.searchParams.get('hasta')) ?? new Date(ancla.getFullYear(), ancla.getMonth() + 1, 0)));
	const rangoValido = $derived(desdeManual <= hastaManual);
	const periodo = $derived.by(() => {
		if (modo === 'rango') return { desde: desdeManual, hasta: hastaManual };
		if (modo === 'semana') {
			const inicio = new Date(ancla);
			const dia = inicio.getDay() || 7;
			inicio.setDate(inicio.getDate() - dia + 1);
			const fin = new Date(inicio);
			fin.setDate(fin.getDate() + 6);
			return { desde: iso(inicio), hasta: iso(fin) };
		}
		return {
			desde: iso(new Date(ancla.getFullYear(), ancla.getMonth(), 1)),
			hasta: iso(new Date(ancla.getFullYear(), ancla.getMonth() + 1, 0))
		};
	});
	const firma = $derived([tipo, entidadId, modo, periodo.desde, periodo.hasta, historico].join(':'));
	const tituloPeriodo = $derived(
		modo === 'mes'
			? ancla.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
			: new Date(periodo.desde + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
				+ ' – ' + new Date(periodo.hasta + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
	);

	$effect(() => {
		void firma;
		void cargar();
	});

	async function cargar() {
		const pedido = ++ultimoPedido;
		if (!historico && modo === 'rango' && !rangoValido) {
			datos = null;
			cargando = false;
			error = 'La fecha inicial no puede ser posterior a la final.';
			return;
		}
		const { desde, hasta } = periodo;
		cargando = true;
		error = null;
		datos = null;
		try {
			const respuesta = await obtenerAnaliticaIndividual(tipo, entidadId, desde, hasta, historico);
			if (pedido === ultimoPedido) datos = respuesta;
		} catch (e: any) {
			if (pedido === ultimoPedido)
				error = e?.response?.data?.message ?? 'No se pudo cargar la actividad de este período.';
		} finally {
			if (pedido === ultimoPedido) cargando = false;
		}
	}

	function actualizarUrl(cambios: Record<string, string | null>) {
		const url = new URL(page.url);
		for (const [clave, valor] of Object.entries(cambios)) {
			if (valor === null) url.searchParams.delete(clave);
			else url.searchParams.set(clave, valor);
		}
		/// Elegir una fecha vuelve al período en todas las métricas y en el mapa.
		url.searchParams.delete('mapa');
		url.searchParams.delete('vista');
		void goto(url, { keepFocus: true, noScroll: true });
	}

	function cambiarVista(vista: 'periodo' | 'historico') {
		const url = new URL(page.url);
		url.searchParams.delete('mapa');
		if (vista === 'historico') url.searchParams.set('vista', 'historico');
		else url.searchParams.delete('vista');
		void goto(url, { keepFocus: true, noScroll: true });
	}

	function cambiarModo(siguiente: ModoPeriodo) {
		if (siguiente === 'rango') {
			actualizarUrl({
				periodo: siguiente,
				fecha: null,
				desde: periodo.desde,
				hasta: periodo.hasta
			});
			return;
		}
		actualizarUrl({ periodo: siguiente, fecha: iso(modo === 'rango' ? fechaUrl(desdeManual) ?? ancla : ancla), desde: null, hasta: null });
	}

	function mover(direccion: number) {
		const siguiente = modo === 'semana'
			? new Date(ancla.getFullYear(), ancla.getMonth(), ancla.getDate() + direccion * 7)
			: new Date(ancla.getFullYear(), ancla.getMonth() + direccion, Math.min(ancla.getDate(), 28));
		actualizarUrl({ periodo: modo, fecha: iso(siguiente), desde: null, hasta: null });
	}

	function cambiarRango(campo: 'desde' | 'hasta', valor: string) {
		if (!fechaUrl(valor)) return;
		let desde = campo === 'desde' ? valor : desdeManual;
		let hasta = campo === 'hasta' ? valor : hastaManual;
		if (desde > hasta) {
			if (campo === 'desde') hasta = desde;
			else desde = hasta;
		}
		actualizarUrl({ periodo: 'rango', fecha: null, desde, hasta });
	}

	const ETIQUETAS: Record<string, string> = {
		servicios_desplazamientos: 'Servicios y desplazamientos',
		dias_laborados: 'Días laborados',
		dias_disponible: 'Días disponible',
		dias_descanso: 'Días de descanso',
		dias_mantenimiento: 'Días en mantenimiento',
			dias_registrados: 'Días con registro',
			dias_sin_registro: 'Días sin registro',
		kilometros: 'Kilómetros recorridos',
		horas_conducidas: 'Horas conducidas',
		nomina_total: 'Nómina del período',
		recargos_nomina: 'Recargos pagados',
		bonificaciones: 'Bonificaciones',
		formularios: 'Formatos diligenciados',
		preoperacionales: 'Preoperacionales',
		asistencias: 'Asistencias registradas',
		evaluaciones: 'Evaluaciones realizadas',
		puntaje_evaluaciones: 'Puntaje promedio',
			extractos_vencidos: 'FUEC vencidos',
		conductores_distintos: 'Conductores distintos',
		ordenes_mantenimiento: 'Órdenes de mantenimiento',
		costo_mantenimiento: 'Costo de mantenimiento',
		actas_entrega: 'Actas de entrega',
		recargos_generados: 'Recargos generados',
			documentos_vencidos: 'Documentos vencidos',
			documentos_por_vencer: 'Documentos por vencer',
			documentos_sin_vigencia: 'Documentos sin vigencia',
		planillas: 'Planillas',
		tramos_recorrido: 'Tramos registrados',
			dias_con_servicios: 'Días con servicios',
			promedio_servicios_semana: 'Promedio semanal',
		vehiculos_propios: 'Vehículos afiliados',
		liquidaciones_finales: 'Liquidaciones finales',
		total_liquidado: 'Total liquidado'
	};
	const DINERO = new Set([
		'nomina_total',
		'recargos_nomina',
		'bonificaciones',
		'costo_mantenimiento',
		'recargos_generados',
		'total_liquidado'
	]);
	const formatear = (clave: string, valor: number) => {
		if (DINERO.has(clave))
			return valor.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
		if (clave === 'kilometros') return `${valor.toLocaleString('es-CO')} km`;
		if (clave === 'horas_conducidas') return `${valor.toLocaleString('es-CO')} h`;
		return valor.toLocaleString('es-CO');
	};
	const fecha = (valor: string) => new Date(`${valor.slice(0, 10)}T12:00:00`).toLocaleDateString('es-CO');
	const nombreCampo = (valor: string) =>
		valor.replaceAll('_', ' ').replace(/^./, (letra) => letra.toUpperCase());
</script>

<section class="analitica" aria-label="Actividad individual">
	{#if tipo === 'cliente'}
		<div class="vista-general" role="group" aria-label="Alcance de la actividad">
			<button type="button" class:activo={!historico} aria-pressed={!historico} onclick={() => cambiarVista('periodo')}>Período</button>
			<button type="button" class:activo={historico} aria-pressed={historico} onclick={() => cambiarVista('historico')}>Histórico</button>
		</div>
	{/if}
	{#if !historico}
	<div class="periodo">
		<div class="modos" aria-label="Tipo de período">
			{#each ['mes', 'semana', 'rango'] as opcion}
				<button type="button" class:activo={modo === opcion} onclick={() => cambiarModo(opcion as ModoPeriodo)}>
					{opcion === 'mes' ? 'Mes' : opcion === 'semana' ? 'Semana' : 'Rango'}
				</button>
			{/each}
		</div>
		{#if modo === 'rango'}
			<div class="fechas">
				<label>Desde <input type="date" value={desdeManual} onchange={(evento) => cambiarRango('desde', evento.currentTarget.value)} /></label>
				<label>Hasta <input type="date" value={hastaManual} onchange={(evento) => cambiarRango('hasta', evento.currentTarget.value)} /></label>
			</div>
		{:else}
			<div class="navegacion">
				<button type="button" aria-label="Período anterior" onclick={() => mover(-1)}><ChevronLeft size={16} /></button>
				<span><CalendarDays size={15} /> {tituloPeriodo}</span>
				<button type="button" aria-label="Período siguiente" onclick={() => mover(1)}><ChevronRight size={16} /></button>
			</div>
		{/if}
	</div>
	{:else}
		<p class="alcance-historico">Resumen de toda la actividad registrada del cliente.</p>
	{/if}

	{#if datos?.faltantes?.length}
		<div class="aviso">
			<TriangleAlert size={17} />
				<div><strong>Información por completar</strong><span>{datos.faltantes.map(nombreCampo).join(', ')}</span></div>
		</div>
	{/if}

	{#if cargando && !datos}
		<div class="estado"><span class="gira"><RefreshCw size={18} /></span> Calculando actividad…</div>
	{:else if error}
		<div class="estado error"><span>{error}</span><button type="button" onclick={cargar}>Reintentar</button></div>
	{:else if datos}
			{#if Object.values(datos.resumen).every((valor) => Number(valor) === 0)}
				<div class="sin-movimientos">
					<strong>{historico ? 'Sin movimientos registrados' : 'Sin movimientos en este período'}</strong>
					<span>{historico ? 'Aún no hay actividad registrada para este cliente.' : modo === 'rango' ? 'Ajusta las fechas para consultar otro período.' : 'Usa las flechas o cambia el tipo de período para consultar otras fechas.'}</span>
				</div>
			{/if}
		<div class="metricas">
			{#each Object.entries(datos.resumen) as [clave, valor]}
				<article>
					<span>{ETIQUETAS[clave] ?? clave.replaceAll('_', ' ')}</span>
					<strong>{formatear(clave, valor)}</strong>
				</article>
			{/each}
		</div>

		{#if datos.extracto}
			<div class="bloque">
					<h4>{datos.extracto.es_vigente ? 'FUEC vigente' : 'Último FUEC registrado'}</h4>
					<p><a class="enlace-registro" href={`/dashboard/extractos?extracto=${datos.extracto.id}`}><strong>{datos.extracto.numero_completo ?? datos.extracto.consecutivo}</strong> · {datos.extracto.vehiculo_placa ?? 'Sin placa'} ↗</a></p>
				<p class:vence={datos.extracto.dias_para_vencer <= 30}>
					{datos.extracto.vencido
						? `Venció hace ${Math.abs(datos.extracto.dias_para_vencer)} días`
						: `Vence en ${datos.extracto.dias_para_vencer} días`}
				</p>
			</div>
		{:else if tipo === 'conductor'}
			<div class="aviso"><TriangleAlert size={17} /><span>No tiene un extracto vigente.</span></div>
		{/if}

		{#if tipo !== 'conductor' && datos.fuecs_vigentes?.length}
			<div class="bloque">
				<h4>FUEC vigentes · {datos.fuecs_vigentes.length}</h4>
				<ul>
					{#each datos.fuecs_vigentes as fuec (fuec.id)}
						<li><a class="enlace-registro" href={`/dashboard/extractos?extracto=${fuec.id}`}>{fuec.numero_completo} · {fuec.vehiculo_placa ?? 'Sin placa'} · vence {fecha(fuec.vigencia_hasta)} ↗</a></li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if tipo === 'vehiculo' && !datos.fuecs_vigentes?.length && datos.fuecs_recientes?.length}
			<div class="bloque">
				<h4>Últimos FUEC del vehículo</h4>
				<ul>
					{#each datos.fuecs_recientes as fuec (fuec.id)}
						<li><a class="enlace-registro" href={`/dashboard/extractos?extracto=${fuec.id}`}>{fuec.numero_completo} · venció {fecha(fuec.vigencia_hasta)} ↗</a></li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if tipo === 'conductor' && datos.fuecs_vencidos_periodo?.length}
			<div class="bloque">
				<h4>FUEC vencidos en el período · {datos.resumen.extractos_vencidos}</h4>
				<ul>
					{#each datos.fuecs_vencidos_periodo as fuec (fuec.id)}
						<li><a class="enlace-registro" href={`/dashboard/extractos?extracto=${fuec.id}`}>{fuec.numero_completo} · {fuec.vehiculo_placa ?? 'Sin placa'} · venció {fecha(fuec.vigencia_hasta)} ↗</a></li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if datos.detalle?.preoperacionales?.length}
			<div class="bloque">
				<h4>Preoperacionales del período · {datos.detalle.preoperacionales.length}</h4>
				<ul>
					{#each datos.detalle.preoperacionales as envio (envio.id)}
						<li><a class="enlace-registro" href={`/dashboard/formularios/envios/${envio.id}`}>{fecha(envio.fecha)} · {envio.nombre} ↗</a></li>
					{/each}
				</ul>
			</div>
		{/if}

			{#if tipo === 'cliente' && (datos.sede?.municipio || datos.sede?.departamento)}
				<div class="bloque">
					<h4>Sede principal</h4>
					<p><strong>{datos.sede?.municipio ?? 'Municipio sin registrar'}</strong>{datos.sede?.departamento ? ` · ${datos.sede.departamento}` : ''}</p>
				</div>
			{/if}

		{#if datos.zonas?.length}
			<div class="bloque">
				<h4>Zonas frecuentes</h4>
				<div class="chips">{#each datos.zonas as zona}<span>{zona.nombre} · {zona.servicios}</span>{/each}</div>
			</div>
		{/if}

		{#if tipo === 'cliente'}
			<div class="bloque mapa-bloque">
				<div class="mapa-cabecera">
					<div><h4>Zonas frecuentes del cliente</h4><p>Ubicaciones agrupadas a partir de los orígenes y destinos de sus servicios.</p></div>
					<span class="mapa-periodo">{historico ? 'Histórico' : tituloPeriodo}</span>
				</div>
				<MapaRutasCliente rutas={datos.rutas ?? []} zonas={datos.zonas ?? []} {historico} />
			</div>
		{/if}

		{#if datos.detalle?.mantenimientos?.length}
			<div class="bloque">
				<h4>Jornadas en mantenimiento</h4>
				<ul>
					{#each datos.detalle.mantenimientos as item}
						<li><strong>{fecha(item.fecha)}</strong> · {item.placa ?? item.conductor ?? 'Sin relación registrada'}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if datos.detalle?.ordenes?.length}
			<div class="bloque">
				<h4>Órdenes de mantenimiento</h4>
				<ul>
					{#each datos.detalle.ordenes as orden}
						<li><strong>#{orden.consecutivo}</strong> · {orden.descripcion ?? orden.estado} {orden.costo != null ? `· ${formatear('costo_mantenimiento', Number(orden.costo))}` : ''}</li>
					{/each}
				</ul>
			</div>
		{/if}

			{#if datos.detalle?.documentos?.length}
				<div class="bloque">
					<h4>Vigencia documental del vehículo</h4>
					<ul class="documentos">
						{#each datos.detalle.documentos as documento}
							<li>
								<div><strong>{nombreCampo(documento.tipo_documento ?? documento.categoria)}</strong>{documento.numero ? ` · ${documento.numero}` : ''}</div>
								<span class:vencido={documento.vencido} class:por-vencer={documento.dias_para_vencer != null && documento.dias_para_vencer >= 0 && documento.dias_para_vencer <= 30}>
									{documento.dias_para_vencer == null
										? 'Sin fecha de vencimiento'
										: documento.vencido
											? `Vencido hace ${Math.abs(documento.dias_para_vencer)} días`
											: `Vence en ${documento.dias_para_vencer} días`}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

		{#if datos.detalle?.conductores?.length}
			<div class="bloque">
				<h4>Conductores que usaron el vehículo</h4>
				<div class="chips">{#each datos.detalle.conductores as conductor}<span>{conductor.nombre}</span>{/each}</div>
			</div>
		{/if}

		{#if datos.detalle?.propietario}
			<div class="bloque">
				<h4>Propietario vigente</h4>
				<p><strong>{datos.detalle.propietario.nombre ?? 'Sin nombre'}</strong> · {datos.detalle.propietario.identificacion ?? 'Sin identificación'}</p>
				<p>Los cierres y liquidaciones anteriores conservan el tercero con el que fueron generados.</p>
			</div>
		{/if}

		{#if datos.vehiculos?.length}
			<div class="bloque">
				<h4>Vehículos asociados</h4>
				<ul>{#each datos.vehiculos as vehiculo}<li><strong>{vehiculo.placa}</strong> {vehiculo.marca ?? ''} {vehiculo.linea ?? ''}</li>{/each}</ul>
			</div>
		{/if}

		{#if datos.liquidaciones?.length}
			<div class="bloque">
				<h4>Liquidaciones finales del período</h4>
				<ul>{#each datos.liquidaciones as cierre}<li><strong>{cierre.consecutivo}</strong> · {cierre.mes}/{cierre.anio} · {formatear('total_liquidado', Number(cierre.total_pagar))}</li>{/each}</ul>
			</div>
		{/if}

		{#if datos.notas}
			<div class="bloque"><h4>Notas</h4><p class="prelinea">{datos.notas}</p></div>
		{/if}
	{/if}
</section>

<style>
	.analitica { display: grid; gap: 16px; }
	.vista-general { display: inline-flex; width: fit-content; padding: 3px; border: 1px solid var(--border-subtle); border-radius: 12px; background: var(--bg-muted); }
	.vista-general button { min-height: 36px; padding: 0 14px; border: 0; border-radius: 9px; background: transparent; color: var(--text-muted); font-weight: 750; cursor: pointer; }
	.vista-general button.activo { background: var(--bg-surface); color: var(--au-primary); box-shadow: 0 1px 4px rgba(0,0,0,.08); }
	.alcance-historico { margin: -4px 0 0; color: var(--text-muted); font-size: 13px; }
	.periodo { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
	.modos { display: flex; padding: 3px; border: 1px solid var(--border-subtle); border-radius: 12px; background: var(--bg-muted); }
	.modos button { min-height: 34px; padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: var(--text-muted); font-weight: 750; cursor: pointer; }
	.modos button.activo { background: var(--bg-surface); color: var(--au-primary); box-shadow: 0 1px 4px rgba(0,0,0,.08); }
	.navegacion { display: flex; align-items: center; gap: 6px; }
	.navegacion button { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--bg-surface); cursor: pointer; }
	.navegacion span { min-width: 168px; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 13px; font-weight: 800; text-transform: capitalize; }
	.fechas { display: flex; gap: 8px; flex-wrap: wrap; }
	.fechas label { display: grid; gap: 4px; color: var(--text-muted); font-size: 11px; font-weight: 800; text-transform: uppercase; }
	.fechas input { min-height: 38px; border: 1px solid var(--border-subtle); border-radius: 10px; padding: 0 10px; color: var(--text-primary); background: var(--bg-surface); }
	.metricas { display: grid; grid-template-columns: repeat(auto-fit, minmax(142px, 1fr)); gap: 10px; }
	.metricas article { min-width: 0; padding: 14px; border: 1px solid var(--border-subtle); border-radius: 15px; background: var(--bg-surface); }
	.metricas span { display: block; min-height: 30px; color: var(--text-muted); font-size: 11px; font-weight: 800; line-height: 1.3; text-transform: uppercase; letter-spacing: .035em; }
	.metricas strong { display: block; margin-top: 7px; color: var(--text-primary); font-size: 20px; line-height: 1.1; overflow-wrap: anywhere; }
	.aviso { display: flex; align-items: flex-start; gap: 9px; padding: 11px 13px; border: 1px solid #fcd34d; border-radius: 13px; color: #92400e; background: #fffbeb; font-size: 13px; }
	.aviso div { display: grid; gap: 2px; }
	.aviso span { text-transform: capitalize; }
		.sin-movimientos { display: grid; gap: 3px; padding: 13px 14px; border: 1px dashed var(--border-subtle); border-radius: 13px; color: var(--text-muted); background: var(--bg-muted); font-size: 13px; }
		.sin-movimientos strong { color: var(--text-primary); }
	.estado { min-height: 120px; display: flex; align-items: center; justify-content: center; gap: 9px; color: var(--text-muted); }
	.estado.error { flex-direction: column; color: #b91c1c; }
	.estado button { min-height: 38px; padding: 0 14px; border: 0; border-radius: 10px; color: white; background: var(--au-primary); cursor: pointer; }
	.gira { animation: giro 1s linear infinite; }
	.bloque { padding: 14px; border: 1px solid var(--border-subtle); border-radius: 15px; background: var(--bg-surface); }
	.bloque h4 { margin: 0 0 9px; font-size: 13px; }
	.bloque p { margin: 4px 0; font-size: 13px; }
	.bloque .vence { color: #b45309; font-weight: 800; }
	.enlace-registro { color: var(--au-primary); font-weight: 750; text-decoration: none; overflow-wrap: anywhere; }
	.enlace-registro:hover { text-decoration: underline; }
	.chips { display: flex; gap: 7px; flex-wrap: wrap; }
	.chips span { padding: 6px 9px; border-radius: 999px; color: var(--au-primary); background: var(--au-tint); font-size: 12px; font-weight: 750; }
	.bloque ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; font-size: 13px; }
		.documentos { padding-left: 0 !important; list-style: none; }
		.documentos li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-subtle); }
		.documentos li:last-child { border-bottom: 0; }
		.documentos span { color: var(--text-muted); font-size: 12px; font-weight: 750; text-align: right; }
		.documentos span.vencido { color: #b91c1c; }
		.documentos span.por-vencer { color: #b45309; }
	.prelinea { white-space: pre-line; }
	@keyframes giro { to { transform: rotate(360deg); } }
	@media (max-width: 520px) { .periodo, .fechas { align-items: stretch; flex-direction: column; } .modos { width: 100%; } .modos button { flex: 1; } .navegacion { width: 100%; justify-content: space-between; } }
</style>
