<script lang="ts">
	/**
	 * Sección «HSEQ»: preoperacionales, quién está en servicio (y sin
	 * preoperacional hoy), control de descansos 21-9, fatiga y horarios.
	 */
	import { AlertTriangle, BedDouble, ClipboardCheck, Users } from 'lucide-svelte';
	import Tarjeta from './Tarjeta.svelte';
	import Kpi from './Kpi.svelte';
	import Grafica from './Grafica.svelte';
	import Ranking from './Ranking.svelte';
	import { numero, fechaCorta, horaDelDia, horas } from '$lib/dashboard/formato';
	import { diaCorto } from '$lib/dashboard/periodo';

	interface Props {
		datos: any;
	}
	let { datos }: Props = $props();

	const k = $derived(datos.kpis);
	const horasLabel = Array.from({ length: 24 }, (_, h) => horaDelDia(h));
	const sinPreop = $derived((datos.en_servicio as any[]).filter((c) => !c.preop_hoy));
	const conPreop = $derived((datos.en_servicio as any[]).filter((c) => c.preop_hoy));

	const ESTADO_DESCANSO: Record<string, { etiqueta: string; tono: 'normal' | 'ambar' | 'rojo' }> = {
		alerta: { etiqueta: 'Sin descanso', tono: 'rojo' },
		por_descansar: { etiqueta: 'Por descansar', tono: 'ambar' },
		ok: { etiqueta: 'En ciclo', tono: 'normal' },
		en_descanso: { etiqueta: 'Descansando', tono: 'normal' }
	};
	const RIESGO: Record<string, { etiqueta: string; tono: 'normal' | 'ambar' | 'rojo' }> = {
		alto: { etiqueta: 'Alto', tono: 'rojo' },
		medio: { etiqueta: 'Medio', tono: 'ambar' },
		bajo: { etiqueta: 'Bajo', tono: 'normal' }
	};

	function rangoHoras(p: { desde: number; hasta: number } | null): string {
		return p ? `${horaDelDia(p.desde)} – ${horaDelDia(p.hasta)}` : '—';
	}
</script>

<div class="sec-kpis">
	<Kpi
		etiqueta="Conductores en servicio"
		valor={numero(k.conductores_en_servicio)}
		detalle={`${numero(k.conductores_disponibles)} disponibles · ${numero(k.conductores_programados)} programados`}
		icono={Users}
		href="/dashboard/conductores?estado=servicio"
	/>
	<Kpi
		etiqueta="Sin preoperacional hoy"
		valor={numero(k.sin_preoperacional_hoy)}
		detalle={k.sin_preoperacional_hoy
			? 'En servicio y sin diligenciar el de hoy'
			: 'Todos los que están en servicio lo diligenciaron'}
		tono={k.sin_preoperacional_hoy ? 'rojo' : 'verde'}
		icono={ClipboardCheck}
	/>
	<Kpi
		etiqueta="Preoperacionales del periodo"
		valor={numero(k.preoperacionales)}
		detalle={datos.preoperacionales.promedio_hora
			? `Suelen enviarse hacia las ${datos.preoperacionales.promedio_hora.etiqueta}`
			: 'Sin envíos en el periodo'}
		icono={ClipboardCheck}
		href="/dashboard/formularios?vista=envios"
	/>
	<Kpi
		etiqueta="Alertas de descanso 21-9"
		valor={numero(k.alertas_descanso)}
		detalle={`${numero(k.dias_laborados)} días laborados en el periodo entre todos`}
		tono={k.alertas_descanso ? 'rojo' : 'verde'}
		icono={BedDouble}
	/>
</div>

<div class="sec-rejilla">
	<Tarjeta
		titulo="En servicio sin preoperacional de hoy"
		subtitulo="Están en un servicio y no han enviado el HSEQ-FR-08/09 de hoy"
		columnas={6}
		tono={sinPreop.length ? 'alerta' : 'normal'}
		enlace="/dashboard/conductores?estado=servicio"
	>
		{#if sinPreop.length === 0}
			<p class="sec-ok">
				Los {numero(conPreop.length)} conductores en servicio ya enviaron su preoperacional de hoy.
			</p>
		{:else}
			<p class="sec-conteo">
				<AlertTriangle size={14} strokeWidth={2.4} />
				{numero(sinPreop.length)} de {numero(datos.en_servicio.length)} en servicio
			</p>
			<ul class="sec-lista">
				{#each sinPreop.slice(0, 10) as c (c.id)}
					<li>
						<a href={c.enlace}>
							<span class="sec-lista-titulo">{c.conductor}</span>
							<span class="sec-lista-sub"
								>{c.cliente ?? 'Sin servicio en curso'}{c.placa
									? ` · ${c.placa}`
									: ''}{c.fecha_realizacion
									? ` · desde ${fechaCorta(c.fecha_realizacion)}`
									: ''}</span
							>
						</a>
						{#if c.enlace_servicio}<a class="sec-pastilla" href={c.enlace_servicio}>servicio</a
							>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Tarjeta>

	<Tarjeta
		titulo="Control de descansos 21-9"
		subtitulo={`Días trabajados desde el último descanso (últimos ${datos.descansos.ventana_dias} días de recorridos)`}
		columnas={6}
		tono={datos.descansos.resumen.alerta ? 'alerta' : 'normal'}
		enlace="/dashboard/conductores/recorridos"
	>
		<div class="sec-estados sec-estados--4">
			<span class="sec-estado"
				><span class="sec-estado-n sec-rojo">{numero(datos.descansos.resumen.alerta)}</span><span
					class="sec-estado-etq">Sin descanso ≥{datos.descansos.ciclo}</span
				></span
			>
			<span class="sec-estado"
				><span class="sec-estado-n sec-ambar">{numero(datos.descansos.resumen.por_descansar)}</span
				><span class="sec-estado-etq">Por descansar</span></span
			>
			<span class="sec-estado"
				><span class="sec-estado-n">{numero(datos.descansos.resumen.ok)}</span><span
					class="sec-estado-etq">En ciclo</span
				></span
			>
			<span class="sec-estado"
				><span class="sec-estado-n">{numero(datos.descansos.resumen.en_descanso)}</span><span
					class="sec-estado-etq">Descansando</span
				></span
			>
		</div>
		<Ranking
			items={datos.descansos.items
				.filter((d: any) => d.estado !== 'en_descanso')
				.slice(0, 8)
				.map((d: any) => ({
					etiqueta: d.conductor,
					valor: d.dias_desde_descanso,
					secundario: d.ultimo_descanso
						? `último descanso ${fechaCorta(d.ultimo_descanso)}`
						: 'sin descanso en la ventana',
					valorTexto: `${d.dias_desde_descanso} d · ${ESTADO_DESCANSO[d.estado].etiqueta}`,
					href: d.enlace,
					tono: ESTADO_DESCANSO[d.estado].tono
				}))}
			numerado={false}
			vacio="Sin registros de recorridos recientes"
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Preoperacionales por día"
		subtitulo="Envíos y conductores distintos que los diligenciaron"
		columnas={8}
		enlace="/dashboard/formularios?vista=envios"
	>
		<Grafica
			etiquetas={datos.preoperacionales.por_dia.map((d: any) => diaCorto(d.fecha))}
			series={[
				{
					etiqueta: 'Preoperacionales',
					datos: datos.preoperacionales.por_dia.map((d: any) => d.n)
				},
				{
					etiqueta: 'Conductores',
					datos: datos.preoperacionales.por_dia.map((d: any) => d.conductores),
					color: 'oscuro',
					linea: true
				}
			]}
			alto={230}
		/>
	</Tarjeta>

	<Tarjeta
		titulo="A qué hora diligencian el preoperacional"
		subtitulo={datos.preoperacionales.pico
			? `La mayoría entre ${rangoHoras(datos.preoperacionales.pico)}`
			: 'Por hora de envío'}
		columnas={4}
	>
		<Grafica
			etiquetas={horasLabel}
			series={[{ etiqueta: 'Envíos', datos: datos.preoperacionales.por_hora }]}
			leyenda={false}
			alto={230}
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Quién más diligencia formularios"
		subtitulo="Envíos de formularios dinámicos en el periodo"
		columnas={4}
		enlace="/dashboard/formularios?vista=envios"
	>
		<Ranking
			items={datos.ranking_formularios.map((r: any) => ({
				etiqueta: r.conductor,
				valor: r.total,
				secundario: r.formularios,
				href: r.enlace
			}))}
			unidad="envíos"
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Días laborados acumulados"
		subtitulo={`${numero(k.dias_laborados)} días entre todos en el periodo · quién ha laborado más`}
		columnas={4}
		enlace="/dashboard/conductores/recorridos"
	>
		<Ranking
			items={datos.dias_laborados.map((r: any) => ({
				etiqueta: r.conductor,
				valor: r.laborados,
				secundario: `${r.disponibles} disp. · ${r.descansos} desc.`,
				href: r.enlace
			}))}
			unidad="días"
		/>
	</Tarjeta>

	{#if datos.fatiga}
		<Tarjeta
			titulo="Propensos a fatiga"
			subtitulo={`Horas por jornada (planillas), jornadas de más de ${datos.fatiga.umbral_jornada_larga} h, racha sin descanso y sueño reportado`}
			columnas={4}
			tono={datos.fatiga.resumen.alto ? 'alerta' : 'normal'}
			enlace="/dashboard/recargos"
		>
			<div class="sec-estados">
				<span class="sec-estado"
					><span class="sec-estado-n sec-rojo">{numero(datos.fatiga.resumen.alto)}</span><span
						class="sec-estado-etq">Riesgo alto</span
					></span
				>
				<span class="sec-estado"
					><span class="sec-estado-n sec-ambar">{numero(datos.fatiga.resumen.medio)}</span><span
						class="sec-estado-etq">Medio</span
					></span
				>
				<span class="sec-estado"
					><span class="sec-estado-n">{numero(datos.fatiga.resumen.bajo)}</span><span
						class="sec-estado-etq">Bajo</span
					></span
				>
			</div>
			<Ranking
				items={datos.fatiga.items.slice(0, 8).map((f: any) => ({
					etiqueta: f.conductor,
					valor: f.promedio,
					secundario: `${f.largas} jornadas >${datos.fatiga.umbral_jornada_larga} h${f.sueno_promedio != null ? ` · duerme ${f.sueno_promedio.toFixed(1)} h` : ''}${f.dias_desde_descanso != null ? ` · ${f.dias_desde_descanso} d sin descanso` : ''}`,
					valorTexto: `${horas(f.promedio)}/día · ${RIESGO[f.riesgo].etiqueta}`,
					href: f.enlace,
					tono: RIESGO[f.riesgo].tono
				}))}
				numerado={false}
				vacio="Sin jornadas en planillas del periodo"
			/>
		</Tarjeta>
	{/if}

	{#if datos.hora_realizacion}
		<Tarjeta
			titulo="Hora de realización de los servicios"
			subtitulo={datos.hora_realizacion.promedio
				? `Promedio ${datos.hora_realizacion.promedio.etiqueta} · pico ${rangoHoras(datos.hora_realizacion.pico)}`
				: 'Sin servicios en el periodo'}
			columnas={datos.horas_laboradas ? 6 : 12}
		>
			<Grafica
				etiquetas={horasLabel}
				series={[{ etiqueta: 'Servicios', datos: datos.hora_realizacion.distribucion }]}
				leyenda={false}
				alto={190}
			/>
		</Tarjeta>
	{/if}

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
	.sec-lista > li > a:first-child {
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
		text-decoration: none;
	}
	a.sec-pastilla:hover {
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.sec-estados {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.sec-estados--4 {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.sec-estado {
		display: flex;
		flex-direction: column;
		padding: 0.5rem 0.6rem;
		border-radius: 12px;
		background: var(--bg-base);
		min-width: 0;
	}
	.sec-estado-n {
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-weight: 800;
		color: var(--text-primary);
		line-height: 1.1;
	}
	.sec-rojo {
		color: #b42318;
	}
	.sec-ambar {
		color: #9a6700;
	}
	.sec-estado-etq {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
</style>
