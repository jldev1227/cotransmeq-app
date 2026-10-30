<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { AlertTriangle, BadgeCheck, Check, Clock3, FileSearch, LoaderCircle, Play, Save, ShieldAlert } from 'lucide-svelte';
	import { socketUtils } from '$lib/socket';
	import {
		guardarProgramacionSimit,
		historialSimit,
		iniciarConsultaSimitAhora,
		obtenerEjecucionSimit,
		type EjecucionSimit,
		type TipoEntidadSimit
	} from '$lib/api/simit';

	interface FilaSimit {
		id: string;
		tipo: 'vehiculo' | 'conductor';
		nombre: string;
		identificador: string;
		estado: 'sin_consulta' | 'en_curso' | 'sin_deuda' | 'con_deuda' | 'error';
		ultimaConsulta: string | null;
		comparendos: number | null;
		multas: number | null;
		acuerdosPago: number | null;
		saldoTotal: number | null;
		error: string | null;
		requiereAtencion: boolean;
		href: string;
	}

	interface DatosSimit {
		proveedorConfigurado: boolean;
		mensajeIntegracion: string;
		puedeConfigurar: boolean;
		programacion: { cadaHoras: number; horaInicio: string; horarios: string[] };
		periodoDias: number;
		resumen: {
			vehiculos: number;
			conductores: number;
			sinConsulta: number;
			conDeuda: number;
			requierenAtencion: number;
			ultimaConsulta: string | null;
		};
		vehiculos: FilaSimit[];
		conductores: FilaSimit[];
	}

	interface Props { datos: Record<string, unknown>; }
	interface EventoSimit {
		tipo: TipoEntidadSimit;
		entidad_id: string;
		consulta_id: string;
		consultado_at: string;
	}
	let { datos }: Props = $props();
	const simit = $derived(datos as unknown as DatosSimit);
	let filas = $state<FilaSimit[]>([]);
	let tipoActivo = $state<'vehiculo' | 'conductor'>('vehiculo');
	let tipoInicializado = $state(false);
	$effect(() => {
		const vehiculos = simit.vehiculos;
		const personas = simit.conductores;
		filas = [...vehiculos, ...personas];
		if (!tipoInicializado && (vehiculos.length > 0 || personas.length > 0)) {
			tipoActivo = vehiculos.length > 0 ? 'vehiculo' : 'conductor';
			tipoInicializado = true;
		}
	});
	const placas = $derived(filas.filter((fila) => fila.tipo === 'vehiculo'));
	const conductores = $derived(filas.filter((fila) => fila.tipo === 'conductor'));
	const filasVisibles = $derived(tipoActivo === 'vehiculo' ? placas : conductores);
	const resumenVivo = $derived.by(() => ({
		vehiculos: filas.filter((fila) => fila.tipo === 'vehiculo').length,
		conductores: filas.filter((fila) => fila.tipo === 'conductor').length,
		sinConsulta: filas.filter((fila) => fila.estado === 'sin_consulta').length,
		conDeuda: filas.filter((fila) => fila.estado === 'con_deuda' || (fila.saldoTotal ?? 0) > 0).length,
		requierenAtencion: filas.filter((fila) => fila.requiereAtencion).length,
		ultimaConsulta: filas.reduce<string | null>((ultima, fila) =>
			fila.ultimaConsulta && (!ultima || fila.ultimaConsulta > ultima) ? fila.ultimaConsulta : ultima, null)
	}));
	const frecuencias = [1, 2, 3, 4, 6, 8, 12, 24];
	let cadaHoras = $state(simit.programacion.cadaHoras);
	let horaInicio = $state(simit.programacion.horaInicio);
	let guardando = $state(false);
	let iniciando = $state(false);
	let avisoAccion = $state('');
	let errorAccion = $state('');
	let ejecucion = $state<EjecucionSimit | null>(null);
	let paginaActiva = true;

	onMount(() => {
		const dejarDeEscuchar = socketUtils.on('simit:consulta:actualizada', (evento: EventoSimit) => {
			void actualizarFila(evento);
		});
		return () => {
			paginaActiva = false;
			dejarDeEscuchar();
		};
	});

	async function actualizarFila(evento: EventoSimit) {
		if (!filas.some((fila) => fila.tipo === evento.tipo && fila.id === evento.entidad_id)) return;
		try {
			const historial = await historialSimit(evento.tipo, evento.entidad_id);
			if (!paginaActiva || !historial.ultimaConsulta) return;
			const consulta = historial.ultimaConsulta;
			const saldoTotal = consulta.saldo_total == null ? null : Number(consulta.saldo_total);
			const estado = consulta.estado_consulta;
			const requiereAtencion = estado === 'error' || estado === 'con_deuda' || (saldoTotal ?? 0) > 0
				|| Date.now() - new Date(consulta.consultado_at).getTime() >= cadaHoras * 60 * 60 * 1000;
			filas = filas.map((fila) => fila.tipo === evento.tipo && fila.id === evento.entidad_id
				? {
					...fila,
					estado,
					ultimaConsulta: consulta.consultado_at,
					comparendos: consulta.comparendos,
					multas: consulta.multas,
					acuerdosPago: consulta.acuerdos_pago,
					saldoTotal,
					error: consulta.error,
					requiereAtencion
				}
				: fila);
		} catch {
			// La carga inicial y la base de datos siguen siendo la fuente de verdad.
		}
	}

	const horariosVista = $derived.by(() => {
		const [hora, minuto] = horaInicio.split(':').map(Number);
		return Array.from({ length: 24 / cadaHoras }, (_, indice) => {
			const horaProgramada = (hora + indice * cadaHoras) % 24;
			return `${String(horaProgramada).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
		}).sort();
	});

	function mensajeDeError(error: any) {
		return error?.response?.data?.message ?? error?.message ?? 'No se pudo completar la acción.';
	}

	async function guardarHorario() {
		guardando = true;
		avisoAccion = '';
		errorAccion = '';
		try {
			const actualizado = await guardarProgramacionSimit({ cadaHoras, horaInicio });
			cadaHoras = actualizado.cadaHoras;
			horaInicio = actualizado.horaInicio;
			avisoAccion = 'Programación guardada y aplicada al cron.';
		} catch (error) {
			errorAccion = mensajeDeError(error);
		} finally {
			guardando = false;
		}
	}

	async function consultarAhora() {
		if (iniciando || ejecucion?.estado === 'en_curso') return;
		iniciando = true;
		avisoAccion = '';
		errorAccion = '';
		try {
			const inicio = await iniciarConsultaSimitAhora();
			ejecucion = inicio.ejecucion;
			iniciando = false;
			if (inicio.ejecucion.estado === 'completada') {
				avisoAccion = 'Lote SIMIT finalizado.';
				await invalidateAll();
			} else {
				await seguirEjecucion(inicio.ejecucion.id);
			}
		} catch (error) {
			errorAccion = mensajeDeError(error);
			iniciando = false;
		}
	}

	async function seguirEjecucion(id: string) {
		const vence = Date.now() + 10 * 60 * 1000;
		while (paginaActiva && Date.now() < vence) {
			if (ejecucion?.estado !== 'en_curso') break;
			await new Promise((resolve) => setTimeout(resolve, 1800));
			if (!paginaActiva) return;
			try {
				ejecucion = await obtenerEjecucionSimit(id);
			} catch (error) {
				errorAccion = mensajeDeError(error);
				return;
			}
			if (ejecucion.estado === 'error') {
				errorAccion = ejecucion.mensajeError ?? 'La consulta no pudo completarse.';
				return;
			}
			if (ejecucion.estado === 'completada') {
				const fallidas = ejecucion.resultado?.errores ?? 0;
				avisoAccion = fallidas ? `Lote finalizado con ${fallidas} consultas fallidas.` : 'Lote SIMIT finalizado.';
				await invalidateAll();
				return;
			}
		}
		if (paginaActiva && ejecucion?.estado === 'en_curso') {
			avisoAccion = 'La consulta sigue en curso; puedes dejar esta vista abierta para ver el resultado.';
		}
	}

	function fechaHora(valor?: string | null) {
		if (!valor) return 'Sin consultas registradas';
		return new Intl.DateTimeFormat('es-CO', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'America/Bogota'
		}).format(new Date(valor));
	}

	function dinero(valor?: number | null) {
		if (valor == null) return '—';
		return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor);
	}

	function estadoTexto(fila: FilaSimit) {
		if (fila.estado === 'sin_consulta') return 'Sin consulta';
		if (fila.estado === 'en_curso') return 'Consulta en curso';
		if (fila.estado === 'error') return 'Consulta fallida';
		if (fila.estado === 'con_deuda') return 'Obligaciones pendientes';
		return 'Sin obligaciones pendientes';
	}
</script>

<section class="simit-dashboard" aria-label="Estado de cuenta SIMIT">
	<header class="simit-head page-card">
		<div class="simit-head-icon"><FileSearch size={22} /></div>
		<div class="simit-head-copy">
			<p class="simit-eyebrow">Seguimiento diario · últimos {simit.periodoDias} días</p>
			<h2>Estado de cuenta SIMIT</h2>
			<p>Placas y conductores que participaron en servicios recientes.</p>
		</div>
		<div class="simit-ultima"><Clock3 size={16} /><span><small>Última consulta</small><strong>{fechaHora(resumenVivo.ultimaConsulta)}</strong></span></div>
	</header>

	<div class="simit-metricas">
		<div class="page-card simit-metrica"><span>Vehículos</span><strong>{resumenVivo.vehiculos}</strong></div>
		<div class="page-card simit-metrica"><span>Conductores</span><strong>{resumenVivo.conductores}</strong></div>
		<div class="page-card simit-metrica simit-metrica--aviso"><span>Requieren atención</span><strong>{resumenVivo.requierenAtencion}</strong></div>
		<div class="page-card simit-metrica simit-metrica--deuda"><span>Con obligaciones</span><strong>{resumenVivo.conDeuda}</strong></div>
	</div>

	<div class="simit-aviso page-card">
		<ShieldAlert size={18} />
		<p>{simit.mensajeIntegracion} Si una consulta falla, queda marcada como pendiente de atención.</p>
		<span>{resumenVivo.sinConsulta} sin consulta</span>
	</div>

	{#if simit.puedeConfigurar}
		<div class="simit-controles page-card">
			<div class="simit-controles-titulo">
				<div><p>Automatización</p><h3>Programación de consultas</h3></div>
				<button class="simit-ejecutar" type="button" disabled={iniciando || ejecucion?.estado === 'en_curso'} onclick={consultarAhora}>
					<Play size={15} />
					{iniciando || ejecucion?.estado === 'en_curso' ? 'Consultando…' : 'Consultar ahora'}
				</button>
			</div>
			<div class="simit-formulario">
				<label>
					<span>Frecuencia</span>
					<select bind:value={cadaHoras} disabled={guardando}>
						{#each frecuencias as frecuencia}
							<option value={frecuencia}>Cada {frecuencia} {frecuencia === 1 ? 'hora' : 'horas'}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Primera consulta del ciclo</span>
					<input type="time" bind:value={horaInicio} disabled={guardando} />
				</label>
				<div class="simit-proximas">
					<Clock3 size={15} />
					<span>Horarios diarios: <strong>{horariosVista.join(' · ')}</strong> · Colombia</span>
				</div>
				<button class="simit-guardar" type="button" disabled={guardando} onclick={guardarHorario}>
					{#if guardando}<Clock3 size={15} />{:else}<Save size={15} />{/if}
					{guardando ? 'Guardando…' : 'Guardar programación'}
				</button>
			</div>
			{#if ejecucion?.estado === 'en_curso'}
				<div class="simit-progreso" aria-live="polite">
					<div><Clock3 size={15} /><span>Consulta en curso: {ejecucion.procesados} de {ejecucion.total || '…'}</span></div>
					<div class="simit-progreso-fondo"><span style={`width: ${ejecucion.total ? Math.round(ejecucion.procesados / ejecucion.total * 100) : 4}%`}></span></div>
				</div>
			{/if}
			{#if avisoAccion}<p class="simit-mensaje simit-mensaje--ok" role="status"><Check size={15} /> {avisoAccion}</p>{/if}
			{#if errorAccion}<p class="simit-mensaje simit-mensaje--error" role="alert"><AlertTriangle size={15} /> {errorAccion}</p>{/if}
		</div>
	{/if}

	{#if filas.length === 0}
		<div class="page-card simit-vacio"><FileSearch size={25} /><strong>No hay servicios finalizados en esta ventana</strong><p>Cuando se complete un servicio, su placa y conductor aparecerán aquí.</p></div>
	{:else}
		<div class="page-card simit-lista-card">
			<div class="simit-lista-titulo"><div><h3>{tipoActivo === 'vehiculo' ? 'Placas' : 'Conductores'}</h3><p>Abre una ficha para consultar su historial completo.</p></div><span>{filasVisibles.length} registros</span></div>
			<div class="simit-pestanas" role="group" aria-label="Filtrar placas y conductores">
				<button type="button" class:activa={tipoActivo === 'vehiculo'} aria-pressed={tipoActivo === 'vehiculo'} onclick={() => tipoActivo = 'vehiculo'}>
					Placas <span>{placas.length}</span>
				</button>
				<button type="button" class:activa={tipoActivo === 'conductor'} aria-pressed={tipoActivo === 'conductor'} onclick={() => tipoActivo = 'conductor'}>
					Conductores <span>{conductores.length}</span>
				</button>
			</div>
			{#if filasVisibles.length === 0}
				<div class="simit-vacio simit-vacio--tab"><BadgeCheck size={22} /><strong>No hay {tipoActivo === 'vehiculo' ? 'placas' : 'conductores'} en este periodo</strong><p>Las entidades aparecerán cuando participen en un servicio reciente.</p></div>
			{:else}
				<div class="simit-lista">
					{#each filasVisibles as fila (`${fila.tipo}:${fila.id}`)}
					<a class="simit-fila" class:atencion={fila.requiereAtencion} href={fila.href}>
						<div class="simit-fila-icono" class:deuda={fila.estado === 'con_deuda'} class:error={fila.estado === 'error'} class:en-curso={fila.estado === 'en_curso'}>
							{#if fila.estado === 'sin_deuda'}<BadgeCheck size={17} />{:else if fila.estado === 'en_curso'}<LoaderCircle size={17} class="simit-girando" />{:else}<AlertTriangle size={17} />{/if}
						</div>
						<div class="simit-fila-nombre"><strong>{fila.nombre}</strong><small>{fila.tipo === 'vehiculo' ? 'Placa' : 'Conductor'} · {fila.identificador}</small></div>
						<div class="simit-fila-estado"><strong>{estadoTexto(fila)}</strong><small>{fechaHora(fila.ultimaConsulta)}</small></div>
						<div class="simit-fila-cifras"><span>{fila.comparendos ?? '—'} comparendos</span><b>{dinero(fila.saldoTotal)}</b></div>
					</a>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</section>

<style>
	.simit-dashboard { display: flex; flex-direction: column; gap: .9rem; }
	.simit-head { display: flex; align-items: center; gap: .9rem; padding: 1rem 1.2rem; }
	.simit-head-icon { width: 46px; height: 46px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 14px; color: var(--au-primary); background: var(--au-tint); }
	.simit-head-copy { min-width: 0; flex: 1; }
	.simit-head-copy p { margin: .15rem 0 0; color: var(--text-muted); font-size: .75rem; }
	.simit-eyebrow { color: var(--au-primary-strong) !important; font-size: .62rem !important; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
	.simit-head-copy h2 { margin: .15rem 0 0; color: var(--text-primary); font-family: var(--font-display); font-size: 1.15rem; font-weight: 850; }
	.simit-ultima { display: flex; align-items: center; gap: .55rem; padding: .6rem .75rem; border: 1px solid var(--border-subtle); border-radius: 12px; color: var(--au-primary); background: var(--bg-base); }
	.simit-ultima span { display: grid; gap: .1rem; }
	.simit-ultima small { color: var(--text-muted); font-size: .6rem; font-weight: 750; text-transform: uppercase; }
	.simit-ultima strong { color: var(--text-primary); font-size: .72rem; }
	.simit-metricas { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .65rem; }
	.simit-metrica { display: grid; gap: .3rem; padding: .8rem 1rem; }
	.simit-metrica span { color: var(--text-muted); font-size: .67rem; font-weight: 750; }
	.simit-metrica strong { color: var(--text-primary); font-family: var(--font-display); font-size: 1.25rem; font-weight: 900; }
	.simit-metrica--aviso strong { color: #a16207; }
	.simit-metrica--deuda strong { color: #b91c1c; }
	.simit-aviso { display: flex; align-items: center; gap: .65rem; padding: .75rem .9rem; color: #854d0e; background: rgba(245,158,11,.08); }
	.simit-aviso > svg { flex: 0 0 auto; }
	.simit-aviso p { flex: 1; margin: 0; font-size: .73rem; }
	.simit-aviso > span { font-size: .68rem; font-weight: 800; white-space: nowrap; }
	.simit-controles { display: grid; gap: .85rem; padding: 1rem 1.2rem; }
	.simit-controles-titulo { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	.simit-controles-titulo p { margin: 0; color: var(--au-primary-strong); font-size: .62rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
	.simit-controles-titulo h3 { margin: .15rem 0 0; color: var(--text-primary); font-size: .95rem; font-weight: 850; }
	.simit-ejecutar, .simit-guardar { display: inline-flex; align-items: center; justify-content: center; gap: .45rem; min-height: 40px; padding: .55rem .85rem; border: 0; border-radius: 10px; color: white; background: var(--au-primary); font: inherit; font-size: .74rem; font-weight: 800; cursor: pointer; }
	.simit-guardar { color: var(--au-primary-strong); background: var(--au-tint); }
	.simit-ejecutar:disabled, .simit-guardar:disabled { opacity: .55; cursor: wait; }
	.simit-formulario { display: flex; align-items: end; flex-wrap: wrap; gap: .65rem; }
	.simit-formulario label { display: grid; gap: .3rem; min-width: 12rem; }
	.simit-formulario label > span { color: var(--text-muted); font-size: .65rem; font-weight: 750; }
	.simit-formulario select, .simit-formulario input { min-height: 40px; padding: .5rem .65rem; border: 1px solid var(--border-subtle); border-radius: 9px; color: var(--text-primary); background: var(--bg-base); font: inherit; font-size: .75rem; }
	.simit-proximas { display: flex; align-items: center; gap: .45rem; flex: 1; min-width: 15rem; color: var(--text-muted); font-size: .68rem; }
	.simit-proximas svg { flex: 0 0 auto; color: var(--au-primary); }
	.simit-proximas strong { color: var(--text-secondary); }
	.simit-progreso { display: grid; gap: .35rem; color: var(--text-secondary); font-size: .7rem; }
	.simit-progreso > div:first-child { display: flex; align-items: center; gap: .4rem; }
	.simit-progreso-fondo { height: 5px; overflow: hidden; border-radius: 99px; background: var(--bg-base); }
	.simit-progreso-fondo span { display: block; height: 100%; border-radius: inherit; background: var(--au-primary); transition: width .2s ease; }
	.simit-mensaje { display: flex; align-items: center; gap: .4rem; margin: 0; font-size: .72rem; }
	.simit-mensaje--ok { color: #047857; }
	.simit-mensaje--error { color: #b91c1c; }
	.simit-lista-card { padding: 1rem; }
	.simit-lista-titulo { display: flex; align-items: center; justify-content: space-between; gap: .8rem; margin-bottom: .6rem; }
	.simit-lista-titulo h3 { margin: 0; color: var(--text-primary); font-size: .88rem; font-weight: 850; }
	.simit-lista-titulo p { margin: .15rem 0 0; color: var(--text-muted); font-size: .7rem; }
	.simit-lista-titulo > span { color: var(--text-muted); font-size: .68rem; font-weight: 750; }
	.simit-pestanas { display: flex; gap: .35rem; margin-bottom: .75rem; padding: .25rem; border: 1px solid var(--border-subtle); border-radius: 12px; background: var(--bg-base); }
	.simit-pestanas button { display: inline-flex; align-items: center; gap: .45rem; padding: .45rem .7rem; border: 1px solid transparent; border-radius: 9px; color: var(--text-muted); background: transparent; font: inherit; font-size: .72rem; font-weight: 750; cursor: pointer; }
	.simit-pestanas button.activa { border-color: var(--border-subtle); color: var(--au-primary-strong); background: var(--bg-surface); box-shadow: 0 1px 2px rgba(15,23,42,.06); }
	.simit-pestanas button span { min-width: 1.2rem; padding: .08rem .3rem; border-radius: 99px; color: var(--text-secondary); background: var(--bg-base); text-align: center; font-size: .62rem; }
	.simit-vacio--tab { padding: 1.2rem .75rem; }
	.simit-lista { display: flex; flex-direction: column; gap: .4rem; }
	.simit-fila { display: flex; align-items: center; gap: .75rem; padding: .65rem .75rem; border: 1px solid var(--border-subtle); border-radius: 12px; color: inherit; text-decoration: none; transition: border-color .15s, background .15s; }
	.simit-fila:hover { border-color: rgba(var(--au-primary-rgb), .3); background: var(--bg-base); }
	.simit-fila.atencion { border-left: 3px solid #f59e0b; }
	.simit-fila-icono { width: 32px; height: 32px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 10px; color: #047857; background: rgba(16,185,129,.1); }
	.simit-fila-icono.deuda { color: #a16207; background: rgba(245,158,11,.12); }
	.simit-fila-icono.en-curso { color: #1d4ed8; background: rgba(59,130,246,.1); }
	.simit-fila-icono.error { color: #b91c1c; background: rgba(220,38,38,.1); }
	.simit-girando { animation: simit-spin .9s linear infinite; }
	@keyframes simit-spin { to { transform: rotate(360deg); } }
	.simit-fila-nombre, .simit-fila-estado { min-width: 0; display: grid; gap: .15rem; }
	.simit-fila-nombre { flex: 1; }
	.simit-fila-nombre strong { overflow: hidden; color: var(--text-primary); font-size: .78rem; text-overflow: ellipsis; white-space: nowrap; }
	.simit-fila-nombre small, .simit-fila-estado small { color: var(--text-muted); font-size: .65rem; }
	.simit-fila-estado { width: 14rem; }
	.simit-fila-estado strong { color: var(--text-secondary); font-size: .7rem; }
	.simit-fila-cifras { min-width: 7rem; display: grid; justify-items: end; gap: .12rem; }
	.simit-fila-cifras span { color: var(--text-muted); font-size: .64rem; }
	.simit-fila-cifras b { color: var(--text-primary); font-size: .72rem; }
	.simit-vacio { display: grid; justify-items: center; gap: .3rem; padding: 2rem 1rem; text-align: center; color: var(--text-muted); }
	.simit-vacio strong { color: var(--text-primary); font-size: .85rem; }
	.simit-vacio p { margin: 0; font-size: .73rem; }
	@media (max-width: 850px) { .simit-head { align-items: flex-start; flex-wrap: wrap; } .simit-ultima { margin-left: 3.4rem; } .simit-fila { align-items: flex-start; flex-wrap: wrap; } .simit-fila-estado { width: auto; flex: 1; } .simit-fila-cifras { min-width: 100%; display: flex; justify-content: space-between; padding-left: 2.7rem; } .simit-controles-titulo { align-items: flex-start; flex-direction: column; } .simit-formulario label, .simit-proximas { width: 100%; min-width: 0; } .simit-guardar { width: 100%; } }
</style>
