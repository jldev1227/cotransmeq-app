<script lang="ts">
	/**
	 * Sección «Talento humano»: vinculados y sus datos pendientes, licencias,
	 * seguridad social por defecto, nómina del periodo y mes a mes, mejor
	 * pagados, quién labora más y control 21-9.
	 */
	import { AlertTriangle, BadgeCheck, BedDouble, IdCard, Wallet } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { confirmar } from '$lib/stores/confirm';
	import Tarjeta from './Tarjeta.svelte';
	import Kpi from './Kpi.svelte';
	import Grafica from './Grafica.svelte';
	import Ranking from './Ranking.svelte';
	import { numero, pesos, pesosCortos, fechaCorta } from '$lib/dashboard/formato';
	import { aplicarSeguridadSocial, guardarSeguridadSocial } from '$lib/api/dashboard';

	interface Props {
		datos: any;
		onCambio?: () => void;
	}
	let { datos, onCambio }: Props = $props();

	const k = $derived(datos.kpis);
	const MESES = [
		'ene',
		'feb',
		'mar',
		'abr',
		'may',
		'jun',
		'jul',
		'ago',
		'sep',
		'oct',
		'nov',
		'dic'
	];
	function etiquetaPeriodo(p: { periodo_start: string; periodo_end: string }): string {
		const [a, m, d] = p.periodo_start.split('-').map(Number);
		const [, m2, d2] = p.periodo_end.split('-').map(Number);
		return m === m2
			? `${d}–${d2} ${MESES[m - 1]} ${String(a).slice(2)}`
			: `${d} ${MESES[m - 1]} – ${d2} ${MESES[m2 - 1]} ${String(a).slice(2)}`;
	}

	const ESTADO_DESCANSO: Record<string, { etiqueta: string; tono: 'normal' | 'ambar' | 'rojo' }> = {
		alerta: { etiqueta: 'Sin descanso', tono: 'rojo' },
		por_descansar: { etiqueta: 'Por descansar', tono: 'ambar' },
		ok: { etiqueta: 'En ciclo', tono: 'normal' },
		en_descanso: { etiqueta: 'Descansando', tono: 'normal' }
	};

	// ── Seguridad social por defecto ──
	let eps = $state<string>(datos.seguridad_social.defecto.eps ?? '');
	let fondo = $state<string>(datos.seguridad_social.defecto.fondo_pension ?? '');
	let arl = $state<string>(datos.seguridad_social.defecto.arl ?? '');
	let guardando = $state(false);
	let aplicando = $state(false);
	const sinDato = $derived(
		datos.seguridad_social.sin_dato as { eps: number; fondo_pension: number; arl: number }
	);
	const totalSinDato = $derived(sinDato.eps + sinDato.fondo_pension + sinDato.arl);

	async function guardar() {
		guardando = true;
		try {
			await guardarSeguridadSocial({
				eps: eps.trim() || null,
				fondo_pension: fondo.trim() || null,
				arl: arl.trim() || null
			});
			toast.success('Seguridad social por defecto guardada');
		} catch (e: any) {
			toast.error(e?.response?.data?.message || 'No se pudo guardar');
		} finally {
			guardando = false;
		}
	}

	async function aplicar() {
		const ok = await confirmar({
			title: '¿Aplicar la seguridad social por defecto?',
			message: `Se completará la EPS, el fondo de pensión y la ARL de los conductores vinculados que no los tengan (${sinDato.eps} sin EPS, ${sinDato.fondo_pension} sin fondo, ${sinDato.arl} sin ARL). Los que ya tienen dato no cambian.`
		});
		if (!ok) return;
		aplicando = true;
		try {
			const r = await aplicarSeguridadSocial();
			toast.success(`Listo: ${r.eps} EPS, ${r.fondo_pension} fondos y ${r.arl} ARL completados`);
			onCambio?.();
		} catch (e: any) {
			toast.error(e?.response?.data?.message || 'No se pudo aplicar');
		} finally {
			aplicando = false;
		}
	}
</script>

<div class="sec-kpis">
	<Kpi
		etiqueta="Conductores vinculados"
		valor={numero(k.vinculados)}
		detalle={k.por_contrato.map((c: any) => `${c.n} ${c.tipo}`).join(' · ') ||
			'Con tipo de contrato y fecha de ingreso'}
		tono="verde"
		icono={BadgeCheck}
		href="/dashboard/conductores"
	/>
	<Kpi
		etiqueta="Con datos pendientes"
		valor={numero(k.con_pendientes)}
		detalle={k.activos_sin_contrato
			? `+ ${numero(k.activos_sin_contrato)} activos sin tipo de contrato o fecha de ingreso`
			: 'Fichas incompletas entre los vinculados'}
		tono={k.con_pendientes ? 'ambar' : 'verde'}
		icono={IdCard}
	/>
	<Kpi
		etiqueta="Licencias vencidas"
		valor={numero(k.licencias_vencidas)}
		detalle={`${numero(k.licencias_proximas)} vencen en los próximos ${datos.licencias.proximos_dias} días`}
		tono={k.licencias_vencidas ? 'rojo' : k.licencias_proximas ? 'ambar' : 'verde'}
		icono={AlertTriangle}
	/>
	{#if datos.nomina}
		<Kpi
			etiqueta="Nómina del periodo (neto)"
			valor={pesosCortos(datos.nomina.periodo.neto)}
			detalle={`${numero(datos.nomina.periodo.liquidaciones)} liquidaciones · salud y pensión ${pesosCortos(datos.nomina.periodo.salud + datos.nomina.periodo.pension)}`}
			icono={Wallet}
			href="/dashboard/nomina/canvas"
		/>
	{:else}
		<Kpi
			etiqueta="Alertas de descanso 21-9"
			valor={numero(k.alertas_descanso)}
			detalle="Conductores sin descanso en más de 21 días"
			tono={k.alertas_descanso ? 'rojo' : 'verde'}
			icono={BedDouble}
		/>
	{/if}
</div>

<div class="sec-rejilla">
	<Tarjeta
		titulo="Pendientes por diligenciar"
		subtitulo="Qué le falta a la ficha de cada vinculado"
		columnas={7}
		tono={datos.pendientes.items.length ? 'alerta' : 'normal'}
		enlace="/dashboard/conductores"
	>
		{#if datos.pendientes.items.length === 0}
			<p class="sec-ok">Todas las fichas de los vinculados están completas.</p>
		{:else}
			<div class="sec-campos">
				{#each datos.pendientes.por_campo as f (f.campo)}
					<span class="sec-campo"><strong>{f.n}</strong> sin {f.etiqueta}</span>
				{/each}
			</div>
			<ul class="sec-lista">
				{#each datos.pendientes.items.slice(0, 12) as c (c.id)}
					<li>
						<a href={c.enlace}>
							<span class="sec-lista-titulo">{c.conductor}</span>
							<span class="sec-lista-sub">Falta: {c.faltan.join(', ')}</span>
						</a>
						<span class="sec-pastilla sec-pastilla--ambar">{c.faltan.length}</span>
					</li>
				{/each}
			</ul>
			{#if datos.sin_contrato.length}
				<p class="sec-nota">
					Además, {numero(k.activos_sin_contrato)} conductores activos no tienen tipo de contrato o fecha
					de ingreso, así que no cuentan como vinculados: {datos.sin_contrato
						.slice(0, 5)
						.map((c: any) => c.conductor)
						.join(', ')}{k.activos_sin_contrato > 5 ? '…' : ''}.
				</p>
			{/if}
		{/if}
	</Tarjeta>

	<Tarjeta
		titulo="Seguridad social por defecto"
		subtitulo="EPS, fondo de pensión y ARL de la empresa, para completar fichas de una vez"
		columnas={5}
	>
		<div class="sec-form">
			<label class="sec-campo-form"
				><span>EPS</span><input
					type="text"
					bind:value={eps}
					placeholder="Ej. Nueva EPS"
					disabled={!datos.seguridad_social.puede_editar}
				/></label
			>
			<label class="sec-campo-form"
				><span>Fondo de pensión</span><input
					type="text"
					bind:value={fondo}
					placeholder="Ej. Porvenir"
					disabled={!datos.seguridad_social.puede_editar}
				/></label
			>
			<label class="sec-campo-form"
				><span>ARL</span><input
					type="text"
					bind:value={arl}
					placeholder="Ej. Sura"
					disabled={!datos.seguridad_social.puede_editar}
				/></label
			>
		</div>
		<p class="sec-nota">
			Sin dato hoy: <strong>{sinDato.eps}</strong> sin EPS ·
			<strong>{sinDato.fondo_pension}</strong>
			sin fondo · <strong>{sinDato.arl}</strong> sin ARL.
		</p>
		{#if datos.seguridad_social.puede_editar}
			<div class="sec-acciones">
				<button type="button" class="btn-secondary" onclick={guardar} disabled={guardando}
					>{guardando ? 'Guardando…' : 'Guardar por defecto'}</button
				>
				<button
					type="button"
					class="btn-primary"
					onclick={aplicar}
					disabled={aplicando ||
						totalSinDato === 0 ||
						(!eps.trim() && !fondo.trim() && !arl.trim())}
					>{aplicando ? 'Aplicando…' : `Completar a los que no tienen`}</button
				>
			</div>
		{:else}
			<p class="sec-nota">
				Solo quien tiene permiso completo sobre conductores puede cambiar esto.
			</p>
		{/if}
	</Tarjeta>

	<Tarjeta
		titulo="Licencias vencidas o por vencer"
		subtitulo={`Próximos ${datos.licencias.proximos_dias} días`}
		columnas={4}
		tono={k.licencias_vencidas ? 'alerta' : 'normal'}
		enlace="/dashboard/conductores"
	>
		{#if datos.licencias.items.length === 0}
			<p class="sec-ok">Ninguna licencia vencida ni por vencer.</p>
		{:else}
			<ul class="sec-lista">
				{#each datos.licencias.items as l (l.id)}
					<li>
						<a href={l.enlace}>
							<span class="sec-lista-titulo">{l.conductor}</span>
							<span class="sec-lista-sub"
								>{l.categoria ?? 'Sin categoría'} · {l.dias < 0
									? `venció el ${fechaCorta(l.vence)}`
									: `vence el ${fechaCorta(l.vence)}`}</span
							>
						</a>
						<span class="sec-pastilla {l.dias < 0 ? 'sec-pastilla--rojo' : 'sec-pastilla--ambar'}"
							>{l.dias < 0 ? `${Math.abs(l.dias)} d` : `${l.dias} d`}</span
						>
					</li>
				{/each}
			</ul>
		{/if}
	</Tarjeta>

	{#if datos.nomina}
		<Tarjeta
			titulo="Nómina mes a mes"
			subtitulo="Neto pagado, salud + pensión y base prestacional por periodo de liquidación"
			columnas={8}
			enlace="/dashboard/nomina/canvas"
		>
			<Grafica
				etiquetas={datos.nomina.historico.map(etiquetaPeriodo)}
				series={[
					{ etiqueta: 'Neto', datos: datos.nomina.historico.map((h: any) => h.neto) },
					{
						etiqueta: 'Base prestacional',
						datos: datos.nomina.historico.map((h: any) => h.base),
						color: 'oscuro'
					},
					{
						etiqueta: 'Salud + pensión',
						datos: datos.nomina.historico.map((h: any) => h.salud_pension),
						color: '#f59e0b'
					}
				]}
				formato="pesos"
				alto={240}
			/>
			<div class="sec-totales">
				<span
					><small>Neto del periodo</small><strong>{pesos(datos.nomina.periodo.neto)}</strong></span
				>
				<span
					><small>Base prestacional</small><strong
						>{pesos(datos.nomina.periodo.base_prestacional)}</strong
					></span
				>
				<span><small>Salud</small><strong>{pesos(datos.nomina.periodo.salud)}</strong></span>
				<span><small>Pensión</small><strong>{pesos(datos.nomina.periodo.pension)}</strong></span>
				<span><small>Recargos</small><strong>{pesos(datos.nomina.periodo.recargos)}</strong></span>
				<span
					><small>Bonificaciones</small><strong>{pesos(datos.nomina.periodo.bonificaciones)}</strong
					></span
				>
			</div>
		</Tarjeta>

		<Tarjeta
			titulo="Mejor pagados"
			subtitulo="Neto en el periodo"
			columnas={4}
			enlace="/dashboard/nomina/canvas"
		>
			<Ranking
				items={datos.nomina.mejor_pagados.map((m: any) => ({
					etiqueta: m.conductor,
					valor: m.neto,
					secundario: `${m.dias} días · base ${pesosCortos(m.base)}`,
					href: m.enlace
				}))}
				formato="pesos"
				vacio="Sin liquidaciones en el periodo"
			/>
		</Tarjeta>
	{/if}

	<Tarjeta
		titulo="Quién labora más"
		subtitulo="Días laborados en el periodo (recorridos)"
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

	<Tarjeta
		titulo="Control de descansos 21-9"
		subtitulo={`Días trabajados desde el último descanso (últimos ${datos.descansos.ventana_dias} días)`}
		columnas={8}
		tono={datos.descansos.resumen.alerta ? 'alerta' : 'normal'}
		enlace="/dashboard/conductores/recorridos"
	>
		<div class="sec-estados">
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
				.slice(0, 10)
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
	.sec-nota {
		margin: 0.6rem 0 0;
		font-size: 0.74rem;
		color: var(--text-muted);
		line-height: 1.4;
	}
	.sec-campos {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.6rem;
	}
	.sec-campo {
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: var(--bg-base);
		font-size: 0.7rem;
		color: var(--text-secondary);
	}
	.sec-campo strong {
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
		white-space: nowrap;
	}
	.sec-pastilla--rojo {
		background: #fde8e8;
		color: #b42318;
	}
	.sec-pastilla--ambar {
		background: #fdf1d6;
		color: #9a6700;
	}
	.sec-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.5rem;
	}
	.sec-campo-form {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.sec-campo-form input {
		min-height: 38px;
		padding: 0 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
		color: var(--text-primary);
	}
	.sec-campo-form input:focus-visible {
		outline: none;
		border-color: var(--au-primary);
	}
	.sec-acciones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.sec-totales {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.sec-totales span {
		display: flex;
		flex-direction: column;
		padding: 0.5rem 0.65rem;
		border-radius: 12px;
		background: var(--bg-base);
	}
	.sec-totales small {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.sec-totales strong {
		font-size: 0.86rem;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.sec-estados {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
		margin-bottom: 0.75rem;
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
