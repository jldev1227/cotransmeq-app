<script lang="ts">
	/**
	 * Sección «Mantenimiento»: estado de cada placa según su último
	 * preoperacional, ítems que más fallan, mantenimientos del periodo,
	 * kilometraje y documentos vencidos o por vencer.
	 */
	import { AlertTriangle, FileWarning, Gauge, Wrench } from 'lucide-svelte';
	import Tarjeta from './Tarjeta.svelte';
	import Kpi from './Kpi.svelte';
	import Grafica from './Grafica.svelte';
	import Ranking from './Ranking.svelte';
	import { numero, fechaCorta } from '$lib/dashboard/formato';
	import { diaCorto } from '$lib/dashboard/periodo';

	interface Props {
		datos: any;
	}
	let { datos }: Props = $props();

	const k = $derived(datos.kpis);
	const vencidos = $derived((datos.vencimientos.items as any[]).filter((d) => d.dias < 0));
	const proximos = $derived((datos.vencimientos.items as any[]).filter((d) => d.dias >= 0));
</script>

<div class="sec-kpis">
	<Kpi
		etiqueta="Placas con novedades"
		valor={numero(k.con_novedades)}
		detalle={`Según el último preoperacional de cada placa · ${numero(k.placas_revisadas)} revisadas en el periodo`}
		tono={k.con_novedades ? 'ambar' : 'verde'}
		icono={AlertTriangle}
		href="/dashboard/flota"
	/>
	<Kpi
		etiqueta="Mantenimientos del periodo"
		valor={numero(k.mantenimientos)}
		detalle={`${numero(k.vehiculos_mantenimiento)} placas en mantenimiento ahora`}
		icono={Wrench}
		href="/dashboard/conductores/recorridos"
	/>
	<Kpi
		etiqueta="Documentos vencidos"
		valor={numero(k.documentos_vencidos)}
		detalle={`${numero(k.documentos_proximos)} vencen en los próximos ${datos.vencimientos.proximos_dias} días`}
		tono={k.documentos_vencidos ? 'rojo' : k.documentos_proximos ? 'ambar' : 'verde'}
		icono={FileWarning}
		href="/dashboard/flota"
	/>
	<Kpi
		etiqueta="Placas en servicio"
		valor={numero(k.vehiculos_en_servicio)}
		detalle={`${numero(k.vehiculos_disponibles)} disponibles`}
		icono={Gauge}
		href="/dashboard/flota?estado=servicio"
	/>
</div>

<div class="sec-rejilla">
	<Tarjeta
		titulo="Estado de los vehículos"
		subtitulo="Ítems reportados en Malo en el último preoperacional de cada placa"
		columnas={7}
		tono={datos.estado_vehiculos.length ? 'alerta' : 'normal'}
		enlace="/dashboard/flota"
	>
		{#if datos.estado_vehiculos.length === 0}
			<p class="sec-ok">Ninguna placa tiene novedades en su último preoperacional.</p>
		{:else}
			<ul class="sec-vehiculos">
				{#each datos.estado_vehiculos as v (v.vehiculo_id)}
					<li class="sec-vehiculo">
						<div class="sec-vehiculo-cab">
							<a class="sec-placa" href={v.enlace}>{v.placa}</a>
							<span class="sec-vehiculo-meta"
								>{v.items.length}
								{v.items.length === 1 ? 'novedad' : 'novedades'} · {fechaCorta(v.fecha)}{v.conductor
									? ` · ${v.conductor}`
									: ''}</span
							>
							<a class="sec-pastilla" href={v.enlace_preoperacional}>ver preoperacional</a>
						</div>
						<ul class="sec-items">
							{#each v.items as it (it.key)}
								<li>
									<strong>{it.label}</strong>{#if it.observacion}<span>
											— {it.observacion}</span
										>{/if}
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		{/if}
	</Tarjeta>

	<Tarjeta
		titulo="Documentos vencidos o por vencer"
		subtitulo={`SOAT, tecnomecánica, pólizas y tarjeta de operación · próximos ${datos.vencimientos.proximos_dias} días`}
		columnas={5}
		tono={vencidos.length ? 'alerta' : 'normal'}
		enlace="/dashboard/flota"
	>
		{#if datos.vencimientos.por_categoria.length === 0}
			<p class="sec-ok">Todos los documentos están al día.</p>
		{:else}
			<div class="sec-categorias">
				{#each datos.vencimientos.por_categoria as c (c.categoria)}
					<span class="sec-categoria">
						<span class="sec-categoria-etq">{c.etiqueta}</span>
						{#if c.vencidos}<span class="sec-rojo">{c.vencidos} venc.</span>{/if}
						{#if c.proximos}<span class="sec-ambar">{c.proximos} próx.</span>{/if}
					</span>
				{/each}
			</div>
			<ul class="sec-lista">
				{#each datos.vencimientos.items.slice(0, 10) as d (d.id)}
					<li>
						<a href={d.enlace}>
							<span class="sec-lista-titulo">{d.placa} · {d.etiqueta}</span>
							<span class="sec-lista-sub"
								>{d.dias < 0
									? `Venció el ${fechaCorta(d.vence)}`
									: d.dias === 0
										? 'Vence hoy'
										: `Vence el ${fechaCorta(d.vence)}`}</span
							>
						</a>
						<span class="sec-pastilla {d.dias < 0 ? 'sec-pastilla--rojo' : 'sec-pastilla--ambar'}"
							>{d.dias < 0 ? `${Math.abs(d.dias)} d vencido` : `${d.dias} d`}</span
						>
					</li>
				{/each}
			</ul>
		{/if}
	</Tarjeta>

	<Tarjeta
		titulo="Ítems que más fallan"
		subtitulo="Respuestas en Malo en los preoperacionales del periodo"
		columnas={4}
		enlace="/dashboard/formularios?vista=envios"
	>
		<Ranking
			items={datos.items_malos.map((i: any) => ({
				etiqueta: i.label,
				valor: i.n,
				secundario: `${i.placas} ${i.placas === 1 ? 'placa' : 'placas'}`
			}))}
			unidad="veces"
			vacio="Sin ítems en Malo en el periodo"
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Placas más propensas"
		subtitulo="Novedades en preoperacionales + mantenimientos del periodo"
		columnas={4}
		enlace="/dashboard/flota"
	>
		<Ranking
			items={datos.propensas.map((p: any) => ({
				etiqueta: p.placa,
				valor: p.puntaje,
				secundario: `${p.novedades} novedades · ${p.mantenimientos} mant.`,
				valorTexto: `${p.novedades + p.mantenimientos}`,
				href: p.enlace
			}))}
			vacio="Sin novedades ni mantenimientos en el periodo"
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Mayor kilometraje"
		subtitulo="Último kilometraje final reportado en un preoperacional (o el de la ficha)"
		columnas={4}
		enlace="/dashboard/flota"
	>
		<Ranking
			items={datos.kilometraje.map((v: any) => ({
				etiqueta: v.placa,
				valor: v.km,
				secundario: v.fecha ? fechaCorta(v.fecha) : 'ficha',
				valorTexto: `${numero(v.km)} km`,
				href: v.enlace
			}))}
			vacio="Sin kilometraje reportado"
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Mantenimientos por día"
		subtitulo="Días de mantenimiento registrados en recorridos"
		columnas={7}
		enlace="/dashboard/conductores/recorridos"
	>
		<Grafica
			etiquetas={datos.mantenimientos.por_dia.map((d: any) => diaCorto(d.fecha))}
			series={[
				{
					etiqueta: 'Mantenimientos',
					datos: datos.mantenimientos.por_dia.map((d: any) => d.n),
					color: 'oscuro'
				}
			]}
			leyenda={false}
			alto={200}
		/>
	</Tarjeta>

	<Tarjeta
		titulo="Últimos mantenimientos"
		subtitulo={`${numero(datos.mantenimientos.total)} en el periodo`}
		columnas={5}
		enlace="/dashboard/conductores/recorridos"
	>
		{#if datos.mantenimientos.ultimos.length === 0}
			<p class="sec-ok">Sin mantenimientos registrados en el periodo.</p>
		{:else}
			<ul class="sec-lista">
				{#each datos.mantenimientos.ultimos as m (m.id)}
					<li>
						{#if m.enlace}
							<a href={m.enlace}>
								<span class="sec-lista-titulo"
									>{m.placa ?? 'Sin placa'} · {fechaCorta(m.fecha)}</span
								>
								<span class="sec-lista-sub"
									>{m.observaciones || `Registrado por ${m.conductor}`}</span
								>
							</a>
						{:else}
							<span class="sec-lista-texto">
								<span class="sec-lista-titulo"
									>{m.placa ?? 'Sin placa'} · {fechaCorta(m.fecha)}</span
								>
								<span class="sec-lista-sub"
									>{m.observaciones || `Registrado por ${m.conductor}`}</span
								>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Tarjeta>
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
	.sec-vehiculos {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sec-vehiculo {
		padding: 0.6rem 0.75rem;
		border-radius: 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.sec-vehiculo-cab {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.sec-placa {
		font-family: var(--font-mono);
		font-size: 0.82rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		color: var(--text-primary);
		text-decoration: none;
		padding: 0.1rem 0.45rem;
		border-radius: 6px;
		background: var(--bg-base);
	}
	.sec-placa:hover {
		color: var(--au-primary-strong);
	}
	.sec-vehiculo-meta {
		flex: 1;
		font-size: 0.7rem;
		color: var(--text-muted);
	}
	.sec-items {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.sec-items li {
		font-size: 0.76rem;
		color: var(--text-secondary);
		padding-left: 0.9rem;
		position: relative;
	}
	.sec-items li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.45em;
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: #ef4444;
	}
	.sec-items strong {
		color: var(--text-primary);
		font-weight: 600;
	}
	.sec-categorias {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.6rem;
	}
	.sec-categoria {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		background: var(--bg-base);
		font-size: 0.7rem;
		color: var(--text-secondary);
	}
	.sec-categoria-etq {
		font-weight: 700;
		color: var(--text-primary);
	}
	.sec-rojo {
		color: #b42318;
		font-weight: 800;
	}
	.sec-ambar {
		color: #9a6700;
		font-weight: 800;
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
	.sec-lista a,
	.sec-lista-texto {
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
		white-space: nowrap;
	}
	a.sec-pastilla:hover {
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.sec-pastilla--rojo {
		background: #fde8e8;
		color: #b42318;
	}
	.sec-pastilla--ambar {
		background: #fdf1d6;
		color: #9a6700;
	}
</style>
