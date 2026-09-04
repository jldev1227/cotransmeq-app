<script lang="ts">
	/**
	 * Vista de resumen: avance real, alertas accionables y estado del expediente.
	 *
	 * Nada de esta pantalla enseña cumplimiento ficticio:
	 *
	 *  - El avance sale de pasos con evidencia APROBADA y vigente. `EN_REVISION`
	 *    no da crédito parcial, porque un porcentaje que sube al adjuntar un
	 *    archivo es exactamente lo que hay que evitar.
	 *  - `NO_APLICA` sale del denominador, no cuenta como incumplimiento.
	 *  - Un indicador sin insumos aparece como «sin datos», no como 0 %.
	 *  - Cada alerta lleva enlace al sitio donde se corrige. Una alerta sin
	 *    destino es una queja, y a la tercera vez se deja de mirar.
	 */
	import type { AlertaResumen, ResumenPesv } from '$lib/types/pesv-centro';
	import CoberturaDatos from './CoberturaDatos.svelte';
	import EstadoBadge from './EstadoBadge.svelte';
	import EstadoPanel from './EstadoPanel.svelte';
	import {
		ESTADO_INDICADOR,
		ESTADO_REQUISITO,
		SEVERIDAD_ALERTA,
		formatearInstante,
		formatearValor
	} from './estados';

	interface Props {
		resumen: ResumenPesv;
		/** Navega a otra vista del módulo conservando el período. */
		onIrA: (vista: string, extra?: Record<string, string>) => void;
		/** Crea el ciclo del año. Solo se ofrece a quien puede gestionar. */
		onCrearCiclo?: () => void;
		puedeGestionar: boolean;
	}

	let { resumen, onIrA, onCrearCiclo, puedeGestionar }: Props = $props();

	const c = $derived(resumen.cumplimiento);

	/** Navega desde una alerta a la vista que la resuelve, conservando período. */
	function irDesdeAlerta(alerta: AlertaResumen) {
		const url = new URL(alerta.enlace, window.location.origin);
		if (url.pathname === '/dashboard/pesv') {
			const extra: Record<string, string> = {};
			url.searchParams.forEach((valor, clave) => {
				if (clave !== 'vista') extra[clave] = valor;
			});
			onIrA(url.searchParams.get('vista') ?? 'resumen', extra);
		} else {
			window.location.href = alerta.enlace;
		}
	}
</script>

{#if resumen.sinCiclo}
	<!-- Sin ciclo no hay matriz ni metas contra las que medir. Se dice, no se
	     crea uno por su cuenta: sembrar un ciclo es un acto con autoría.
	     `sinCiclo` se ata a una constante porque dentro del `snippet` TypeScript
	     ya no conserva el estrechamiento del `#if`. -->
	{@const faltante = resumen.sinCiclo}
	<EstadoPanel
		tipo="vacio"
		titulo="No hay ciclo PESV para {faltante.anio}"
		mensaje={faltante.mensaje}
		accion={puedeGestionar ? 'Crear el ciclo anual' : undefined}
		onAccion={puedeGestionar ? onCrearCiclo : undefined}
	>
		{#snippet hijos()}
			{#if !puedeGestionar}
				<p>{faltante.accion} Su nivel de acceso no permite crearlo.</p>
			{/if}
		{/snippet}
	</EstadoPanel>
{/if}

<div class="resumen">
	<!-- ── Avance global ──────────────────────────────────────────── -->
	<section class="bloque avance" aria-labelledby="titulo-avance">
		<h2 id="titulo-avance">Avance del expediente</h2>
		{#if c}
			<div class="avance-cuerpo">
				<div class="cifra">
					<span class="numero">{c.avance === null ? '—' : `${c.avance} %`}</span>
					<span class="pie">
						{c.porEstado.CUMPLE} de {c.aplicables} pasos aplicables
					</span>
				</div>
				<div
					class="barra"
					role="img"
					aria-label="Avance {c.avance ?? 0} por ciento: {c.porEstado
						.CUMPLE} de {c.aplicables} pasos"
				>
					<div class="relleno" style="width: {c.avance ?? 0}%"></div>
				</div>
			</div>

			<ul class="estados">
				{#each Object.entries(c.porEstado) as [estado, cantidad] (estado)}
					<li>
						<EstadoBadge token={ESTADO_REQUISITO[estado as keyof typeof ESTADO_REQUISITO]} />
						<span class="cantidad">{cantidad}</span>
					</li>
				{/each}
			</ul>

			<div class="fases">
				{#each c.porFase as f (f.fase)}
					<div class="fase">
						<span class="fase-nombre">{f.etiqueta}</span>
						<span class="fase-valor"
							>{f.avance === null ? 'Sin pasos aplicables' : `${f.avance} %`}</span
						>
						<span class="fase-detalle">{f.cumple} de {f.total}</span>
					</div>
				{/each}
			</div>

			<button type="button" class="enlace-vista" onclick={() => onIrA('matriz')}>
				Abrir la matriz de los 24 pasos
			</button>
		{:else}
			<EstadoPanel
				tipo="sin-datos"
				titulo="Sin ciclo abierto"
				mensaje="No hay matriz que resumir."
			/>
		{/if}
	</section>

	<!-- ── Alertas ────────────────────────────────────────────────── -->
	<section class="bloque alertas" aria-labelledby="titulo-alertas">
		<h2 id="titulo-alertas">Alertas ({resumen.alertas.length})</h2>
		{#if resumen.alertas.length === 0}
			<EstadoPanel
				tipo="vacio"
				titulo="Sin alertas"
				mensaje="Nada pendiente de atención en el período consultado."
			/>
		{:else}
			<ul class="lista-alertas">
				{#each resumen.alertas as a (a.code)}
					<li>
						<button type="button" class="alerta" onclick={() => irDesdeAlerta(a)}>
							<span class="alerta-cantidad" style="color: {SEVERIDAD_ALERTA[a.severidad].color};">
								{a.cantidad}
							</span>
							<span class="alerta-texto">
								<strong>{a.titulo}</strong>
								<span>{a.detalle}</span>
							</span>
							<EstadoBadge token={SEVERIDAD_ALERTA[a.severidad]} />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- ── Tarjetas de estado ─────────────────────────────────────── -->
	<section class="bloque tarjetas" aria-labelledby="titulo-tarjetas">
		<h2 id="titulo-tarjetas">Estado por dominio</h2>
		<div class="rejilla">
			<button type="button" class="tarjeta" onclick={() => onIrA('matriz', { panel: 'bandeja' })}>
				<span class="t-titulo">Evidencias por revisar</span>
				<span class="t-valor">{resumen.evidencias.pendientesRevision}</span>
				<span class="t-pie">
					{resumen.evidencias.rechazadas} rechazadas · {resumen.evidencias.vencidas} vencidas
				</span>
			</button>

			<button type="button" class="tarjeta" onclick={() => onIrA('indicadores')}>
				<span class="t-titulo">Indicadores</span>
				<span class="t-valor">{resumen.indicadores.ok} / {resumen.indicadores.total}</span>
				<span class="t-pie">
					{resumen.indicadores.critico} críticos · {resumen.indicadores.alerta} en alerta ·
					{resumen.indicadores.sinDatos} sin datos
				</span>
			</button>

			<button type="button" class="tarjeta" onclick={() => onIrA('documentos')}>
				<span class="t-titulo">Documentos</span>
				<span class="t-valor">{resumen.documentos.vencidos}</span>
				<span class="t-pie">
					vencidos · {resumen.documentos.porVencer} por vencer ·
					{resumen.documentos.pendientesRevision} sin revisar
				</span>
			</button>

			<button
				type="button"
				class="tarjeta"
				onclick={() => onIrA('operacion', { panel: 'inspecciones' })}
			>
				<span class="t-titulo">Cobertura de preoperacionales</span>
				<span class="t-valor">
					{resumen.inspecciones.indicador
						? formatearValor(
								resumen.inspecciones.indicador.value,
								resumen.inspecciones.indicador.unit
							)
						: 'Sin datos'}
				</span>
				<span class="t-pie">
					{resumen.inspecciones.indicador?.razonSinDatos ??
						'Vehículo-fecha con inspección entregada'}
				</span>
			</button>

			<button
				type="button"
				class="tarjeta"
				onclick={() => onIrA('operacion', { panel: 'mantenimiento' })}
			>
				<span class="t-titulo">Mantenimiento</span>
				<span class="t-valor">{resumen.mantenimiento.vencidos}</span>
				<span class="t-pie">vencidos · {resumen.mantenimiento.proximos} próximos</span>
			</button>

			<button
				type="button"
				class="tarjeta"
				onclick={() => onIrA('operacion', { panel: 'velocidad' })}
			>
				<span class="t-titulo">Excesos de velocidad</span>
				<span class="t-valor">{resumen.velocidad.eventos}</span>
				<span class="t-pie">eventos registrados en el período</span>
			</button>

			<button
				type="button"
				class="tarjeta"
				onclick={() => onIrA('operacion', { panel: 'siniestros' })}
			>
				<span class="t-titulo">Siniestros</span>
				<span class="t-valor">{resumen.siniestros.total}</span>
				<span class="t-pie">
					{resumen.siniestros.conFatalidad} con fatalidad · {resumen.siniestros.sinInvestigar} sin investigar
				</span>
			</button>

			<button type="button" class="tarjeta" onclick={() => onIrA('contratos')}>
				<span class="t-titulo">Servicios sin contrato o FUEC válido</span>
				<span class="t-valor">{resumen.contratos.sinCobertura}</span>
				<span class="t-pie">
					de {resumen.contratos.total} servicios ·
					{resumen.contratos.porcentaje === null
						? 'sin servicios que evaluar'
						: `${resumen.contratos.porcentaje} % cubierto`}
				</span>
			</button>

			<button type="button" class="tarjeta" onclick={() => onIrA('plan')}>
				<span class="t-titulo">Actividades atrasadas</span>
				<span class="t-valor">{resumen.actividades.vencidas}</span>
				<span class="t-pie">
					{resumen.actividades.completadas} completadas · {resumen.actividades.pendientes} pendientes
				</span>
			</button>
		</div>
	</section>

	<!-- ── Indicadores críticos ───────────────────────────────────── -->
	{#if resumen.indicadores.criticos.length > 0}
		<section class="bloque" aria-labelledby="titulo-criticos">
			<h2 id="titulo-criticos">Indicadores fuera de meta</h2>
			<ul class="criticos">
				{#each resumen.indicadores.criticos as i (i.code)}
					<li>
						<button type="button" onclick={() => onIrA('indicadores', { indicador: i.code })}>
							<span class="cod">{i.code}</span>
							<span class="nom">{i.nombre}</span>
							<span class="val">{formatearValor(i.value, i.unit)}</span>
							<span class="meta">
								meta {i.target === null ? 'sin definir' : formatearValor(i.target, i.unit)}
							</span>
							<EstadoBadge token={ESTADO_INDICADOR[i.status]} />
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- ── Calidad de los datos ───────────────────────────────────── -->
	<section class="bloque" aria-labelledby="titulo-cobertura">
		<h2 id="titulo-cobertura">Calidad de los datos del período</h2>
		<CoberturaDatos cobertura={resumen.indicadores.cobertura} />
		<p class="corte">Datos calculados a las {formatearInstante(resumen.fechaCorte)}.</p>
	</section>
</div>

<style>
	.resumen {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.bloque {
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 0.875rem;
		padding: 1.25rem;
	}

	h2 {
		margin: 0 0 0.875rem;
		font-size: 0.8125rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.avance-cuerpo {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		flex-wrap: wrap;
	}

	.cifra {
		display: flex;
		flex-direction: column;
	}

	.numero {
		font-size: 2.5rem;
		font-weight: 700;
		color: #0f172a;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.pie {
		font-size: 0.8125rem;
		color: #64748b;
	}

	.barra {
		flex: 1 1 12rem;
		height: 0.625rem;
		background: #e2e8f0;
		border-radius: 999px;
		overflow: hidden;
	}

	.relleno {
		height: 100%;
		background: #15803d;
		border-radius: 999px;
	}

	.estados {
		list-style: none;
		margin: 1rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.estados li {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.cantidad {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: #0f172a;
	}

	.fases {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.fase {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.625rem 0.75rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
	}

	.fase-nombre {
		font-size: 0.75rem;
		color: #64748b;
	}

	.fase-valor {
		font-size: 1.125rem;
		font-weight: 700;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
	}

	.fase-detalle {
		font-size: 0.75rem;
		color: #64748b;
	}

	.enlace-vista {
		margin-top: 1rem;
		background: none;
		border: none;
		padding: 0.5rem 0;
		color: #0f172a;
		font-weight: 600;
		font-size: 0.875rem;
		text-decoration: underline;
		cursor: pointer;
		min-height: 2.75rem;
	}

	.lista-alertas {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.alerta {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.75rem 0.875rem;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
		cursor: pointer;
		text-align: left;
		min-height: 2.75rem;
	}

	.alerta:hover {
		background: #f8fafc;
	}

	.alerta-cantidad {
		font-size: 1.375rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		min-width: 2.5ch;
		text-align: right;
	}

	.alerta-texto {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.alerta-texto strong {
		font-size: 0.875rem;
		color: #0f172a;
	}

	.alerta-texto span {
		font-size: 0.8125rem;
		color: #64748b;
	}

	.rejilla {
		display: grid;
		/* Rejilla fluida en vez de puntos de ruptura: se adapta sola cuando la
		   barra lateral del dashboard se colapsa. */
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.75rem;
	}

	.tarjeta {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.875rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
		cursor: pointer;
		text-align: left;
		min-height: 2.75rem;
	}

	.tarjeta:hover {
		background: #f1f5f9;
	}

	.t-titulo {
		font-size: 0.75rem;
		color: #64748b;
	}

	.t-valor {
		font-size: 1.5rem;
		font-weight: 700;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	.t-pie {
		font-size: 0.75rem;
		color: #64748b;
	}

	.criticos {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.criticos button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.625rem 0.75rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		cursor: pointer;
		text-align: left;
		min-height: 2.75rem;
	}

	.criticos button:hover {
		background: #f1f5f9;
	}

	.cod {
		font-weight: 700;
		font-size: 0.6875rem;
		letter-spacing: 0.06em;
		color: #64748b;
		min-width: 4ch;
	}

	.nom {
		flex: 1;
		min-width: 10rem;
		font-size: 0.875rem;
		color: #0f172a;
	}

	.val {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: #0f172a;
	}

	.meta {
		font-size: 0.75rem;
		color: #64748b;
	}

	.corte {
		margin: 0.75rem 0 0;
		font-size: 0.75rem;
		color: #64748b;
	}

	button:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 2px;
	}
</style>
