<script lang="ts">
	/**
	 * Panel de detalle de un indicador.
	 *
	 * Es la pieza que hace auditable el número: fórmula literal, numerador,
	 * denominador, período, fecha de corte, registros incluidos y excluidos con
	 * motivo, y enlaces a los módulos fuente. Un auditor tiene que poder
	 * reproducirlo a mano desde aquí, sin acceso a la base.
	 *
	 * Diálogo modal accesible: foco atrapado, `Esc` cierra, y el botón de cerrar
	 * recibe el foco al abrir para que el teclado no se pierda al fondo.
	 */
	import type { ResultadoIndicador } from '$lib/types/pesv-centro';
	import CoberturaDatos from './CoberturaDatos.svelte';
	import EstadoBadge from './EstadoBadge.svelte';
	import {
		ESTADO_INDICADOR,
		describirTendencia,
		formatearInstante,
		formatearValor
	} from './estados';

	interface Props {
		indicador: ResultadoIndicador;
		onCerrar: () => void;
	}

	let { indicador, onCerrar }: Props = $props();

	let dialogo = $state<HTMLDivElement | null>(null);
	let botonCerrar = $state<HTMLButtonElement | null>(null);

	const token = $derived(ESTADO_INDICADOR[indicador.status]);
	const tendencia = $derived(describirTendencia(indicador.tendencia));

	$effect(() => {
		botonCerrar?.focus();
	});

	function alTeclado(evento: KeyboardEvent) {
		if (evento.key === 'Escape') {
			evento.stopPropagation();
			onCerrar();
			return;
		}
		if (evento.key !== 'Tab' || !dialogo) return;

		/// Atrapa el foco dentro del diálogo. Sin esto, tabular sigue recorriendo
		/// la tabla de detrás y el usuario de teclado acaba en un sitio que no
		/// puede ver.
		const focusables = dialogo.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		if (focusables.length === 0) return;
		const primero = focusables[0];
		const ultimo = focusables[focusables.length - 1];
		if (evento.shiftKey && document.activeElement === primero) {
			evento.preventDefault();
			ultimo.focus();
		} else if (!evento.shiftKey && document.activeElement === ultimo) {
			evento.preventDefault();
			primero.focus();
		}
	}
</script>

<svelte:window on:keydown={alTeclado} />

<div class="fondo">
	<!-- Botón real y no un `div` con `onclick`: cerrar al pulsar fuera tiene que
	     ser alcanzable por teclado, y un `role="presentation"` con manejador deja
	     esa acción solo para el ratón. Se oculta a lectores porque `Esc` ya
	     ofrece lo mismo de forma estándar. -->
	<button type="button" class="tapa" onclick={onCerrar} tabindex="-1" aria-hidden="true"></button>
	<div
		class="dialogo"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-labelledby="detalle-indicador-titulo"
		bind:this={dialogo}
	>
		<header>
			<div>
				<span class="codigo">{indicador.code}</span>
				<h2 id="detalle-indicador-titulo">{indicador.nombre}</h2>
			</div>
			<button type="button" class="cerrar" onclick={onCerrar} bind:this={botonCerrar}>
				<span aria-hidden="true">×</span>
				<span class="sr-only">Cerrar el detalle del indicador</span>
			</button>
		</header>

		<div class="cuerpo">
			<p class="descripcion">{indicador.descripcion}</p>

			<section class="resultado">
				<div class="valor-bloque">
					<span class="etiqueta">Valor del período</span>
					<span class="valor" class:sin-datos={indicador.value === null}>
						{formatearValor(indicador.value, indicador.unit)}
					</span>
					<EstadoBadge {token} tamano="md" />
				</div>

				{#if indicador.razonSinDatos}
					<p class="razon" role="note">{indicador.razonSinDatos}</p>
				{/if}
			</section>

			<section>
				<h3>Cómo se calcula</h3>
				<!-- La fórmula literal, para reproducirla a mano. -->
				<pre class="formula">{indicador.formula}</pre>
				<dl class="variables">
					<div>
						<dt>Numerador</dt>
						<dd>{indicador.numerator ?? 'Sin dato'}</dd>
					</div>
					<div>
						<dt>Denominador</dt>
						<dd>{indicador.denominator ?? 'Sin dato'}</dd>
					</div>
					<div>
						<dt>Meta</dt>
						<dd>
							{indicador.target === null
								? 'Sin meta aprobada'
								: formatearValor(indicador.target, indicador.unit)}
						</dd>
					</div>
					<div>
						<dt>Sentido</dt>
						<dd>{indicador.sentido === 'MAYOR_ES_MEJOR' ? 'Mayor es mejor' : 'Menor es mejor'}</dd>
					</div>
					<div>
						<dt>Frecuencia</dt>
						<dd>{indicador.frecuencia.toLowerCase()}</dd>
					</div>
					<div>
						<dt>Período</dt>
						<dd>
							{indicador.periodo.etiqueta} ({indicador.periodo.desde} a {indicador.periodo.hasta})
						</dd>
					</div>
					<div>
						<dt>Fecha de corte</dt>
						<dd>{formatearInstante(indicador.calculadoAt)}</dd>
					</div>
					<div>
						<dt>Tendencia</dt>
						<dd>{tendencia.texto}</dd>
					</div>
				</dl>
			</section>

			{#if indicador.desglose && indicador.desglose.length > 0}
				<section>
					<h3>Desglose</h3>
					<ul class="desglose">
						{#each indicador.desglose as d (d.etiqueta)}
							<li>
								<span>{d.etiqueta}</span>
								<strong>{formatearValor(d.valor, d.unidad ?? indicador.unit)}</strong>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section>
				<h3>Cobertura de los datos</h3>
				<CoberturaDatos cobertura={indicador.dataCoverage} />
			</section>

			{#if indicador.sources.length > 0}
				<section>
					<h3>Procedencia</h3>
					<ul class="fuentes">
						{#each indicador.sources as f (f.dominio)}
							<li>
								<div>
									<strong>{f.dominio}</strong>
									<span class="registros">{f.registros} registros</span>
								</div>
								{#if f.actionUrl}
									<a href={f.actionUrl}>Ir al módulo fuente</a>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if indicador.issues.length > 0}
				<section>
					<h3>Qué corregir</h3>
					<ul class="incidencias">
						{#each indicador.issues as i (i.code)}
							<li>
								<div class="texto">
									<strong>{i.count > 0 ? `${i.count} · ` : ''}{i.message}</strong>
									<span class="codigo-incidencia">{i.code}</span>
								</div>
								{#if i.actionUrl}
									<a href={i.actionUrl}>Corregir</a>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>
	</div>
</div>

<style>
	.fondo {
		position: fixed;
		inset: 0;
		background: rgb(15 23 42 / 0.45);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 2rem 1rem;
		z-index: 60;
		overflow-y: auto;
	}

	.tapa {
		position: absolute;
		inset: 0;
		border: none;
		background: transparent;
		cursor: default;
		padding: 0;
	}

	.dialogo {
		position: relative;
		background: #ffffff;
		border-radius: 0.875rem;
		width: 100%;
		/* Excepción legítima: es una ventana centrada, no un contenedor de
		   página. */
		max-width: 52rem;
		box-shadow: 0 20px 50px rgb(15 23 42 / 0.25);
		display: flex;
		flex-direction: column;
		max-height: calc(100vh - 4rem);
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem 0.75rem;
		border-bottom: 1px solid #f1f5f9;
	}

	.codigo {
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: #64748b;
	}

	h2 {
		margin: 0.125rem 0 0;
		font-size: 1.125rem;
		font-weight: 700;
		color: #0f172a;
	}

	.cerrar {
		background: none;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		font-size: 1.5rem;
		line-height: 1;
		color: #475569;
		cursor: pointer;
		min-width: 2.75rem;
		min-height: 2.75rem;
	}

	.cerrar:hover {
		background: #f1f5f9;
	}

	.cerrar:focus-visible {
		outline: 2px solid #0f172a;
		outline-offset: 2px;
	}

	.cuerpo {
		padding: 1rem 1.5rem 1.5rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.descripcion {
		margin: 0;
		color: #475569;
		font-size: 0.875rem;
		max-width: 44rem;
	}

	.resultado {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.valor-bloque {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.etiqueta {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.valor {
		font-size: 2rem;
		font-weight: 700;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
	}

	.valor.sin-datos {
		font-size: 1.25rem;
		color: #64748b;
	}

	.razon {
		margin: 0;
		padding: 0.625rem 0.75rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		color: #334155;
		font-size: 0.875rem;
		max-width: 44rem;
	}

	h3 {
		margin: 0 0 0.5rem;
		font-size: 0.8125rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.formula {
		margin: 0 0 0.75rem;
		padding: 0.625rem 0.75rem;
		background: #0f172a;
		color: #e2e8f0;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		/* Una fórmula larga hace scroll dentro de su caja; la página no se
		   desplaza en horizontal. */
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.variables {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	.variables dt {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}

	.variables dd {
		margin: 0.125rem 0 0;
		font-size: 0.875rem;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
	}

	.desglose,
	.fuentes,
	.incidencias {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.desglose li,
	.fuentes li,
	.incidencias li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0.625rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}

	.registros {
		margin-left: 0.5rem;
		color: #64748b;
		font-size: 0.75rem;
	}

	.codigo-incidencia {
		display: block;
		font-size: 0.6875rem;
		color: #64748b;
		letter-spacing: 0.04em;
	}

	.incidencias li {
		background: #fffbeb;
		border-color: #fde68a;
	}

	.incidencias .texto {
		min-width: 0;
	}

	a {
		color: #0f172a;
		font-weight: 600;
		font-size: 0.8125rem;
		white-space: nowrap;
	}

	a:focus-visible {
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
