<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { AlertTriangle, BadgeCheck, Clock3, FileSearch, LoaderCircle, RefreshCw } from 'lucide-svelte';
	import { socketUtils } from '$lib/socket';
	import { historialSimit, iniciarConsultaIndividualSimit, type ConsultaSimit, type TipoEntidadSimit } from '$lib/api/simit';

	interface Props {
		tipo: TipoEntidadSimit;
		entidadId: string;
	}

	let { tipo, entidadId }: Props = $props();
	let estado = $state<Awaited<ReturnType<typeof historialSimit>> | null>(null);
	let cargando = $state(true);
	let error = $state('');
	let errorAccion = $state('');
	let consultando = $state(false);
	let solicitud = 0;

	$effect(() => {
		const tipoActual = tipo;
		const idActual = entidadId;
		void cargar(tipoActual, idActual);
	});

	$effect(() => {
		if (estado?.ultimaConsulta?.estado_consulta !== 'en_curso') return;
		const tipoActual = tipo;
		const idActual = entidadId;
		const intervalo = window.setInterval(() => void cargar(tipoActual, idActual, false), 3000);
		return () => window.clearInterval(intervalo);
	});

	onMount(() => socketUtils.on('simit:consulta:actualizada', (evento: {
		tipo: TipoEntidadSimit;
		entidad_id: string;
		consulta_id: string;
		estado_consulta: 'en_curso' | 'sin_deuda' | 'con_deuda' | 'error';
	}) => {
		if (evento.tipo !== tipo || evento.entidad_id !== entidadId) return;
		if (evento.estado_consulta !== 'en_curso') consultando = false;
		void cargar(tipo, entidadId, false);
	}));

	onDestroy(() => {
		solicitud++;
	});

	async function cargar(tipoActual: TipoEntidadSimit, idActual: string, mostrarCargando = true) {
		const idSolicitud = ++solicitud;
		if (mostrarCargando) {
			cargando = true;
			error = '';
		}
		try {
			const resultado = await historialSimit(tipoActual, idActual);
			if (idSolicitud === solicitud) {
				estado = resultado;
				consultando = resultado.ultimaConsulta?.estado_consulta === 'en_curso';
			}
		} catch (e: any) {
			if (idSolicitud === solicitud) error = e?.response?.data?.message ?? 'No se pudo cargar el historial SIMIT.';
		} finally {
			if (idSolicitud === solicitud && mostrarCargando) cargando = false;
		}
	}

	async function consultarAhora() {
		errorAccion = '';
		consultando = true;
		try {
			await iniciarConsultaIndividualSimit(tipo, entidadId);
			await cargar(tipo, entidadId, false);
		} catch (e: any) {
			consultando = false;
			errorAccion = e?.response?.data?.message ?? 'No se pudo iniciar la consulta SIMIT.';
		}
	}

	function formatoFecha(valor?: string | null) {
		if (!valor) return 'Sin consultas registradas';
		return new Intl.DateTimeFormat('es-CO', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'America/Bogota'
		}).format(new Date(valor));
	}

	function formatoDinero(valor?: number | string | null) {
		if (valor == null) return '—';
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			maximumFractionDigits: 0
		}).format(Number(valor));
	}

	function etiqueta(consulta: ConsultaSimit) {
		if (consulta.estado_consulta === 'en_curso') return 'Consulta en curso';
		if (consulta.estado_consulta === 'error') return 'Consulta fallida';
		return consulta.estado_consulta === 'con_deuda' ? 'Con obligaciones pendientes' : 'Sin obligaciones pendientes';
	}
</script>

<section class="simit-panel" aria-labelledby="simit-titulo">
	<header class="simit-cabecera">
		<div class="simit-icono"><FileSearch size={20} /></div>
		<div class="simit-titulo">
			<p>Estado de cuenta</p>
			<h2 id="simit-titulo">SIMIT · {estado?.identificador ?? 'Consultas e historial'}</h2>
		</div>
		<div class="simit-acciones">
			<button type="button" class="simit-consultar" onclick={consultarAhora} disabled={consultando || cargando}>
				{#if consultando}<LoaderCircle size={15} class="simit-girando" />{:else}<RefreshCw size={15} />{/if}
				{consultando ? 'Consultando…' : 'Consultar ahora'}
			</button>
			<div class="simit-programacion"><Clock3 size={15} /> {estado?.programacion.horarios.join(' · ') ?? 'Horario programado'} · Colombia</div>
		</div>
	</header>
	{#if errorAccion}<div class="simit-error" role="alert"><AlertTriangle size={17} /> {errorAccion}</div>{/if}

	{#if cargando}
		<div class="simit-cargando" aria-live="polite">Cargando historial de consultas…</div>
	{:else if error}
		<div class="simit-error" role="alert"><AlertTriangle size={17} /> {error}</div>
	{:else if estado}
		<div class="simit-aviso">
			<Clock3 size={17} />
			<div>
				<strong>Última consulta: {formatoFecha(estado.ultimaConsulta?.consultado_at)}</strong>
				<p>{estado.mensajeIntegracion}</p>
			</div>
		</div>

		{#if estado.ultimaConsulta}
			{@const ultima = estado.ultimaConsulta}
			<div class="simit-estado" class:pendiente={ultima.estado_consulta === 'con_deuda'} class:error={ultima.estado_consulta === 'error'} class:en-curso={ultima.estado_consulta === 'en_curso'}>
				{#if ultima.estado_consulta === 'sin_deuda'}<BadgeCheck size={18} />{:else if ultima.estado_consulta === 'en_curso'}<LoaderCircle size={18} class="simit-girando" />{:else}<AlertTriangle size={18} />{/if}
				<strong>{etiqueta(ultima)}</strong>
				{#if ultima.error}<span>{ultima.error}</span>{/if}
			</div>
			<div class="simit-indicadores">
				<div><small>Comparendos</small><strong>{ultima.comparendos ?? '—'}</strong></div>
				<div><small>Multas</small><strong>{ultima.multas ?? '—'}</strong></div>
				<div><small>Acuerdos de pago</small><strong>{ultima.acuerdos_pago ?? '—'}</strong></div>
				<div><small>Total</small><strong>{formatoDinero(ultima.saldo_total)}</strong></div>
			</div>
			{#if ultima.detalle?.comparendosDetalle?.length}
				<div class="simit-comparendos">
					<div class="simit-historial-titulo"><h3>Detalle de comparendos</h3><span>{ultima.detalle.comparendosDetalle.length}</span></div>
					{#each ultima.detalle.comparendosDetalle as comparendo (comparendo.numeroComparendo)}
						<article class="simit-comparendo">
							<strong>No. {comparendo.numeroComparendo}</strong>
							<div><span>Fecha de imposición</span><b>{comparendo.fechaImposicion ?? 'No disponible'}</b></div>
							<div><span>Hora</span><b>{comparendo.horaImposicion ?? 'No disponible'}</b></div>
							<div class="simit-direccion"><span>Dirección</span><b>{comparendo.direccion ?? 'No disponible'}</b></div>
							{#if comparendo.error}<small class="simit-detalle-error">{comparendo.error}</small>{/if}
						</article>
					{/each}
				</div>
			{/if}
		{:else}
			<div class="simit-vacio">
				<FileSearch size={22} />
				<div><strong>La primera consulta está pendiente</strong><p>El resultado aparecerá después de la próxima ejecución programada.</p></div>
			</div>
		{/if}

		{#if estado.historial.length > 0}
			<div class="simit-historial">
				<div class="simit-historial-titulo"><h3>Historial de consultas</h3><span>{estado.historial.length}</span></div>
				{#each estado.historial as consulta (consulta.id)}
					<article class="simit-fila">
						<div class="simit-fila-icono" class:con-deuda={consulta.estado_consulta === 'con_deuda'} class:error={consulta.estado_consulta === 'error'} class:en-curso={consulta.estado_consulta === 'en_curso'}>
							{#if consulta.estado_consulta === 'sin_deuda'}<BadgeCheck size={16} />{:else if consulta.estado_consulta === 'en_curso'}<LoaderCircle size={16} class="simit-girando" />{:else}<AlertTriangle size={16} />{/if}
						</div>
						<div class="simit-fila-info">
							<strong>{etiqueta(consulta)}</strong>
							<small>{formatoFecha(consulta.consultado_at)} · {consulta.detalle?.resumen ?? consulta.proveedor ?? 'Consulta SIMIT'}</small>
						</div>
						<b>{formatoDinero(consulta.saldo_total)}</b>
					</article>
				{/each}
			</div>
		{/if}
	{/if}
</section>

<style>
	.simit-panel { display: flex; flex-direction: column; gap: 1rem; }
	.simit-cabecera { display: flex; align-items: center; gap: .85rem; }
	.simit-acciones { display: flex; align-items: center; gap: .55rem; margin-left: auto; }
	.simit-consultar { display: inline-flex; align-items: center; justify-content: center; gap: .4rem; min-height: 38px; padding: .45rem .75rem; border: 1px solid var(--border-subtle); border-radius: 10px; color: var(--text-primary); background: var(--bg-surface); font: inherit; font-size: .72rem; font-weight: 750; cursor: pointer; white-space: nowrap; }
	.simit-consultar:hover:not(:disabled) { border-color: var(--au-primary); color: var(--au-primary); }
	.simit-consultar:disabled { opacity: .6; cursor: wait; }
	.simit-girando { animation: simit-spin .9s linear infinite; }
	@keyframes simit-spin { to { transform: rotate(360deg); } }
	.simit-icono { width: 42px; height: 42px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 13px; color: var(--au-primary); background: var(--au-tint); }
	.simit-titulo { min-width: 0; flex: 1; }
	.simit-titulo p { margin: 0; color: var(--text-muted); font-size: .65rem; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
	.simit-titulo h2 { margin: .1rem 0 0; color: var(--text-primary); font-family: var(--font-display); font-size: 1.08rem; font-weight: 850; overflow-wrap: anywhere; }
	.simit-programacion { display: inline-flex; align-items: center; gap: .4rem; padding: .5rem .7rem; border-radius: 10px; color: var(--text-secondary); background: var(--bg-base); font-size: .72rem; font-weight: 700; white-space: nowrap; }
	.simit-aviso, .simit-vacio { display: flex; align-items: flex-start; gap: .65rem; padding: .85rem 1rem; border: 1px solid var(--border-subtle); border-radius: 14px; color: var(--text-secondary); background: var(--bg-base); }
	.simit-aviso > svg { flex: 0 0 auto; color: var(--au-primary); }
	.simit-aviso strong, .simit-vacio strong { color: var(--text-primary); font-size: .82rem; }
	.simit-aviso p, .simit-vacio p { margin: .18rem 0 0; color: var(--text-muted); font-size: .73rem; }
	.simit-estado { display: flex; align-items: center; gap: .55rem; padding: .75rem .9rem; border-radius: 12px; color: #047857; background: rgba(16,185,129,.1); font-size: .8rem; }
	.simit-estado.pendiente { color: #a16207; background: rgba(245,158,11,.12); }
	.simit-estado.en-curso { color: #1d4ed8; background: rgba(59,130,246,.1); }
	.simit-estado.error { color: #b91c1c; background: rgba(220,38,38,.1); }
	.simit-estado span { margin-left: auto; font-size: .72rem; }
	.simit-indicadores { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .6rem; }
	.simit-indicadores > div { display: grid; gap: .28rem; padding: .85rem; border: 1px solid var(--border-subtle); border-radius: 13px; background: var(--bg-surface); }
	.simit-indicadores small { color: var(--text-muted); font-size: .62rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
	.simit-indicadores strong { color: var(--text-primary); font-size: .95rem; }
	.simit-comparendos { display: flex; flex-direction: column; gap: .5rem; }
	.simit-comparendo { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .55rem .8rem; padding: .8rem .9rem; border: 1px solid var(--border-subtle); border-radius: 12px; background: var(--bg-surface); }
	.simit-comparendo > strong { grid-column: 1 / -1; color: var(--text-primary); font-size: .78rem; }
	.simit-comparendo > div { display: grid; gap: .15rem; min-width: 0; }
	.simit-comparendo span { color: var(--text-muted); font-size: .62rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
	.simit-comparendo b { color: var(--text-primary); font-size: .72rem; font-weight: 650; overflow-wrap: anywhere; }
	.simit-comparendo .simit-direccion { grid-column: 1 / -1; }
	.simit-detalle-error { grid-column: 1 / -1; color: #b91c1c; font-size: .68rem; }
	.simit-vacio { align-items: center; padding: 1.2rem; }
	.simit-vacio > svg { flex: 0 0 auto; color: var(--au-primary); }
	.simit-historial { display: flex; flex-direction: column; gap: .45rem; }
	.simit-historial-titulo { display: flex; align-items: center; gap: .5rem; margin: .5rem 0 .2rem; }
	.simit-historial-titulo h3 { margin: 0; color: var(--text-primary); font-size: .84rem; font-weight: 800; }
	.simit-historial-titulo span { padding: .1rem .45rem; border-radius: 999px; color: var(--text-secondary); background: var(--bg-base); font-size: .65rem; font-weight: 800; }
	.simit-fila { display: flex; align-items: center; gap: .7rem; padding: .7rem .8rem; border: 1px solid var(--border-subtle); border-radius: 12px; }
	.simit-fila-icono { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 9px; color: #047857; background: rgba(16,185,129,.1); }
	.simit-fila-icono.con-deuda { color: #a16207; background: rgba(245,158,11,.12); }
	.simit-fila-icono.en-curso { color: #1d4ed8; background: rgba(59,130,246,.1); }
	.simit-fila-icono.error { color: #b91c1c; background: rgba(220,38,38,.1); }
	.simit-fila-info { min-width: 0; flex: 1; display: grid; gap: .15rem; }
	.simit-fila-info strong { color: var(--text-primary); font-size: .75rem; }
	.simit-fila-info small { overflow: hidden; color: var(--text-muted); font-size: .66rem; text-overflow: ellipsis; white-space: nowrap; }
	.simit-fila > b { color: var(--text-primary); font-size: .75rem; white-space: nowrap; }
	.simit-cargando, .simit-error { display: flex; align-items: center; gap: .5rem; padding: 1rem; color: var(--text-muted); font-size: .8rem; }
	.simit-error { color: #b91c1c; }
	@media (max-width: 720px) { .simit-cabecera { flex-wrap: wrap; } .simit-acciones { width: 100%; margin-left: 3.25rem; flex-wrap: wrap; } .simit-estado { align-items: flex-start; flex-wrap: wrap; } .simit-estado span { width: 100%; margin-left: 1.5rem; } .simit-comparendo { grid-template-columns: 1fr 1fr; } }
</style>
