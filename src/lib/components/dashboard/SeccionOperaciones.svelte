<script lang="ts">
	/**
	 * Sección «Operaciones». Arriba lo del periodo (servicios, hora de
	 * realización, clientes); abajo lo de AHORA (quién está en servicio, qué
	 * falta por cerrar o por registrar), que no depende del periodo.
	 *
	 * Los widgets que leen de otros módulos (planillas, liquidaciones) llegan
	 * solo si el usuario puede verlos; si faltan en los datos, no se pintan.
	 */
	import { AlertTriangle, Clock3, Truck, Users } from 'lucide-svelte';
	import Tarjeta from './Tarjeta.svelte';
	import Kpi from './Kpi.svelte';
	import Grafica from './Grafica.svelte';
	import Ranking from './Ranking.svelte';
	import { numero, pesos, pesosCortos, fechaCorta, horaDelDia } from '$lib/dashboard/formato';
	import { diaCorto, mesCorto } from '$lib/dashboard/periodo';

	interface Props {
		datos: any;
	}
	let { datos }: Props = $props();

	const k = $derived(datos.kpis);
	const porDia = $derived(
		datos.servicios_por_dia as Array<{
			fecha: string;
			realizados: number;
			planificados: number;
			en_curso: number;
			cancelados: number;
		}>
	);
	const horasLabel = Array.from({ length: 24 }, (_, h) => horaDelDia(h));
	const ESTADO_LIQ: Record<string, string> = {
		BORRADOR: 'Borrador',
		LIQUIDADA: 'Por aprobar',
		APROBADA: 'Por facturar'
	};

	function rangoHoras(p: { desde: number; hasta: number } | null): string {
		return p ? `${horaDelDia(p.desde)} – ${horaDelDia(p.hasta)}` : '—';
	}
</script>

<div class="sec-kpis">
	<Kpi
		etiqueta="Servicios del periodo"
		valor={numero(k.servicios)}
		detalle={k.por_estado
			.map((e: any) => `${e.cantidad} ${e.etiqueta.toLowerCase()}`)
			.join(' · ') || 'Sin servicios'}
		tono="verde"
		icono={Truck}
		href="/dashboard/servicios"
	/>
	<Kpi
		etiqueta="Conductores en servicio"
		valor={numero(k.ahora.conductores_en_servicio)}
		detalle={`${numero(k.ahora.conductores_programados)} programados · ${numero(k.ahora.conductores_disponibles)} disponibles`}
		icono={Users}
		href="/dashboard/conductores?estado=servicio"
	/>
	<Kpi
		etiqueta="Placas en servicio"
		valor={numero(k.ahora.vehiculos_en_servicio)}
		detalle={`${numero(k.ahora.vehiculos_programados)} programadas · ${numero(k.ahora.vehiculos_disponibles)} disponibles`}
		icono={Truck}
		href="/dashboard/flota?estado=servicio"
	/>
	<Kpi
		etiqueta="Hora promedio de realización"
		valor={datos.hora_realizacion.promedio?.etiqueta ?? '—'}
		detalle={datos.hora_realizacion.pico
			? `La mayoría entre ${rangoHoras(datos.hora_realizacion.pico)}`
			: 'Sin servicios en el periodo'}
		icono={Clock3}
	/>
</div>

<div class="sec-rejilla">
	<Tarjeta
		titulo="Servicios por día"
		subtitulo="Por fecha de realización"
		columnas={8}
		enlace="/dashboard/servicios"
	>
		<Grafica
			etiquetas={porDia.map((d) => diaCorto(d.fecha))}
			series={[
				{ etiqueta: 'Realizados', datos: porDia.map((d) => d.realizados) },
				{ etiqueta: 'Planificados', datos: porDia.map((d) => d.planificados), color: '#64748b' },
				{ etiqueta: 'En curso', datos: porDia.map((d) => d.en_curso), color: '#f59e0b' }
			]}
			apilado
			alto={240}
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Clientes frecuentes"
		subtitulo="Más servicios en el periodo"
		columnas={4}
		enlace="/dashboard/clientes"
	>
		<Ranking
			items={datos.clientes_frecuentes.map((c: any) => ({
				etiqueta: c.nombre,
				valor: c.servicios,
				href: c.enlace
			}))}
			unidad="serv."
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Servicios sin cerrar"
		subtitulo={`En curso desde hace más de ${datos.sin_cerrar.dias} días: ¿se olvidó finalizarlos?`}
		columnas={datos.planillas_sin_dias ? 4 : 6}
		tono={datos.sin_cerrar.total > 0 ? 'alerta' : 'normal'}
		enlace="/dashboard/servicios?estado=en_curso"
	>
		{#if datos.sin_cerrar.total === 0}
			<p class="sec-ok">
				Todo cerrado. Ningún servicio lleva más de {datos.sin_cerrar.dias} días en curso.
			</p>
		{:else}
			<p class="sec-conteo">
				<AlertTriangle size={14} strokeWidth={2.4} />
				{numero(datos.sin_cerrar.total)}
				{datos.sin_cerrar.total === 1 ? 'servicio' : 'servicios'}
			</p>
			<ul class="sec-lista">
				{#each datos.sin_cerrar.items.slice(0, 8) as s (s.id)}
					<li>
						<a href={s.enlace}>
							<span class="sec-lista-titulo">{s.cliente ?? 'Sin cliente'}</span>
							<span class="sec-lista-sub"
								>{s.conductor ?? 'Sin conductor'}{s.placa ? ` · ${s.placa}` : ''} · {fechaCorta(
									s.fecha_realizacion
								)}</span
							>
						</a>
						<span class="sec-pastilla sec-pastilla--ambar">{s.dias} d</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Tarjeta>

	{#if datos.planillas_sin_dias}
		<Tarjeta
			titulo="Planillas sin días registrados"
			subtitulo="Pendientes (P) del periodo sin un solo día cargado"
			columnas={4}
			tono={datos.planillas_sin_dias.total > 0 ? 'alerta' : 'normal'}
			enlace="/dashboard/recargos?estado=pendiente"
		>
			{#if datos.planillas_sin_dias.total === 0}
				<p class="sec-ok">Todas las planillas pendientes del periodo tienen días registrados.</p>
			{:else}
				<p class="sec-conteo">
					<AlertTriangle size={14} strokeWidth={2.4} />
					{numero(datos.planillas_sin_dias.total)}
					{datos.planillas_sin_dias.total === 1 ? 'planilla' : 'planillas'}
				</p>
				<ul class="sec-lista">
					{#each datos.planillas_sin_dias.items.slice(0, 8) as p (p.id)}
						<li>
							<a href={p.enlace}>
								<span class="sec-lista-titulo">{p.conductor}</span>
								<span class="sec-lista-sub"
									>{p.placa} · {p.cliente ?? 'Sin cliente'} · {mesCorto(p.anio, p.mes)}</span
								>
							</a>
							<span class="sec-pastilla">P</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Tarjeta>
	{/if}

	{#if datos.liquidaciones_pendientes}
		<Tarjeta
			titulo="Liquidaciones de servicios pendientes"
			subtitulo="Por aprobar y por facturar, a hoy"
			columnas={datos.planillas_sin_dias ? 4 : 6}
			enlace="/dashboard/liquidaciones-servicios"
		>
			<div class="sec-estados">
				{#each datos.liquidaciones_pendientes.por_estado as e (e.estado)}
					<a class="sec-estado" href={`/dashboard/liquidaciones-servicios?estado=${e.estado}`}>
						<span class="sec-estado-n">{numero(e.cantidad)}</span>
						<span class="sec-estado-etq">{ESTADO_LIQ[e.estado] ?? e.estado}</span>
						<span class="sec-estado-valor">{pesosCortos(e.valor)}</span>
					</a>
				{/each}
			</div>
			<ul class="sec-lista sec-lista--compacta">
				{#each datos.liquidaciones_pendientes.ultimas.slice(0, 5) as l (l.id)}
					<li>
						<a href={l.enlace}>
							<span class="sec-lista-titulo">{l.consecutivo} · {l.cliente ?? 'Sin cliente'}</span>
							<span class="sec-lista-sub">{mesCorto(l.anio, l.mes)} · {pesos(l.total)}</span>
						</a>
						<span class="sec-pastilla">{ESTADO_LIQ[l.estado] ?? l.estado}</span>
					</li>
				{/each}
			</ul>
		</Tarjeta>
	{/if}

	<Tarjeta
		titulo="Hora de realización de los servicios"
		subtitulo={datos.hora_realizacion.pico
			? `Pico entre ${rangoHoras(datos.hora_realizacion.pico)}`
			: 'Distribución por hora del día'}
		columnas={datos.horas_laboradas ? 6 : 12}
	>
		<Grafica
			etiquetas={horasLabel}
			series={[{ etiqueta: 'Servicios', datos: datos.hora_realizacion.distribucion }]}
			leyenda={false}
			alto={190}
		/>
	</Tarjeta>

	{#if datos.horas_laboradas}
		<Tarjeta
			titulo="A qué horas laboran los conductores"
			subtitulo={datos.horas_laboradas.pico
				? `${numero(datos.horas_laboradas.jornadas)} jornadas según ${datos.horas_laboradas.fuente === 'recorridos' ? 'los recorridos de los conductores' : 'las planillas'} · más actividad entre ${rangoHoras(datos.horas_laboradas.pico)}`
				: 'Sin jornadas con hora de inicio y fin en el periodo (ni en planillas ni en recorridos)'}
			columnas={6}
			enlace={datos.horas_laboradas.fuente === 'recorridos'
				? '/dashboard/conductores/recorridos'
				: '/dashboard/recargos'}
		>
			<Grafica
				etiquetas={horasLabel}
				series={[
					{
						etiqueta: 'Jornadas en marcha',
						datos: datos.horas_laboradas.cobertura,
						color: 'oscuro'
					}
				]}
				leyenda={false}
				alto={190}
			/>
		</Tarjeta>
	{/if}
</div>

<style>
	.sec-kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.75rem;
		margin-bottom: 0.85rem;
	}
	.sec-rejilla {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: 0.85rem;
	}
	.sec-ok {
		margin: 0.25rem 0;
		font-size: 0.8rem;
		color: var(--au-dark);
	}
	.sec-conteo {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		font-weight: 800;
		color: #9a6700;
	}
	.sec-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.sec-lista li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0;
		border-top: 1px dashed var(--border-subtle);
		min-width: 0;
	}
	.sec-lista li:first-child {
		border-top: 0;
	}
	.sec-lista--compacta {
		margin-top: 0.6rem;
	}
	.sec-lista a {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		text-decoration: none;
		color: inherit;
	}
	.sec-lista a:hover .sec-lista-titulo {
		color: var(--au-primary-strong);
	}
	.sec-lista-titulo {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sec-lista-sub {
		font-size: 0.7rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sec-pastilla {
		flex-shrink: 0;
		font-size: 0.66rem;
		font-weight: 800;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.sec-pastilla--ambar {
		background: #fdf1d6;
		color: #9a6700;
	}
	.sec-estados {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.sec-estado {
		display: flex;
		flex-direction: column;
		padding: 0.55rem 0.65rem;
		border-radius: 12px;
		background: var(--bg-base);
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}
	.sec-estado:hover {
		background: var(--au-tint);
	}
	.sec-estado-n {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--text-primary);
		line-height: 1.1;
	}
	.sec-estado-etq {
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.sec-estado-valor {
		font-size: 0.72rem;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
</style>
