<script lang="ts">
	/**
	 * Validación pública de un extracto de contrato: a donde lleva el QR
	 * impreso. Sin sesión. Muestra si el documento existe, si su firma cuadra
	 * con lo guardado y en qué estado está (vigente, vencido o anulado).
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		ESTADO_LABELS,
		fechaLarga,
		validarExtractoPublico,
		type ExtractoPublico
	} from '$lib/api/extractos';

	const LOGO = '/assets/logo_nombre.webp';

	let estado = $state<'cargando' | 'ok' | 'error'>('cargando');
	let error = $state('');
	let datos = $state<ExtractoPublico | null>(null);

	onMount(async () => {
		try {
			datos = await validarExtractoPublico(page.params.codigo ?? '');
			estado = 'ok';
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo validar el extracto';
			estado = 'error';
		}
	});

	const veredicto = $derived.by(() => {
		if (!datos) return null;
		if (!datos.firma_valida)
			return {
				tono: 'rojo',
				titulo: 'Firma no válida',
				texto: 'El contenido guardado no coincide con la firma. Este documento no debe aceptarse.'
			};
		if (datos.anulado)
			return {
				tono: 'rojo',
				titulo: 'Extracto anulado',
				texto: `Anulado el ${fechaLarga(datos.anulado.fecha)}${datos.anulado.motivo ? `: ${datos.anulado.motivo}` : ''}.${datos.reemplazado_por ? ` Lo reemplaza el No. ${datos.reemplazado_por}.` : ''}`
			};
		if (datos.estado === 'VENCIDO')
			return {
				tono: 'ambar',
				titulo: 'Extracto auténtico, pero vencido',
				texto: `Su vigencia terminó el ${fechaLarga(datos.vigencia_hasta)}.`
			};
		return {
			tono: 'verde',
			titulo: 'Extracto auténtico y vigente',
			texto: `Emitido por ${datos.empresa.razon_social}. Vigente hasta el ${fechaLarga(datos.vigencia_hasta)}.`
		};
	});
</script>

<svelte:head>
	<title>Validación de extracto · Cotransmeq</title>
</svelte:head>

<main class="vx">
	<header class="vx-cabecera">
		<img src={LOGO} alt="Cotransmeq" width="150" height="52" />
		<div>
			<p class="vx-eyebrow">Validación de extracto de contrato · FUEC</p>
			<h1>{datos ? `No. ${datos.numero}` : 'Extracto de contrato'}</h1>
		</div>
	</header>

	{#if estado === 'cargando'}
		<section class="vx-tarjeta vx-cargando">Validando…</section>
	{:else if estado === 'error' || !datos || !veredicto}
		<section class="vx-tarjeta vx-veredicto vx-rojo">
			<h2>No se encontró el extracto</h2>
			<p>{error || 'El código no corresponde a ningún extracto emitido.'}</p>
		</section>
	{:else}
		<section class="vx-tarjeta vx-veredicto vx-{veredicto.tono}">
			<span class="vx-icono" aria-hidden="true"
				>{veredicto.tono === 'verde' ? '✔' : veredicto.tono === 'ambar' ? '!' : '✕'}</span
			>
			<div>
				<h2>{veredicto.titulo}</h2>
				<p>{veredicto.texto}</p>
			</div>
		</section>

		<section class="vx-tarjeta">
			<dl class="vx-datos">
				<div>
					<dt>Estado</dt>
					<dd>{ESTADO_LABELS[datos.estado]}</dd>
				</div>
				<div>
					<dt>Vigencia</dt>
					<dd>{fechaLarga(datos.vigencia_desde)} → {fechaLarga(datos.vigencia_hasta)}</dd>
				</div>
				<div>
					<dt>Empresa</dt>
					<dd>{datos.empresa.razon_social}<br /><small>NIT {datos.empresa.nit}</small></dd>
				</div>
				<div>
					<dt>Contratante</dt>
					<dd>
						{datos.contratante ?? '—'}<br /><small>Contrato No. {datos.contrato_numero}</small>
					</dd>
				</div>
				<div class="vx-ancho">
					<dt>Objeto</dt>
					<dd>{datos.objeto_contrato ?? '—'}</dd>
				</div>
				<div class="vx-ancho">
					<dt>Origen - destino</dt>
					<dd>{datos.origen_destino ?? '—'}</dd>
				</div>
				<div>
					<dt>Convenio</dt>
					<dd>{datos.convenio ?? 'N/A'}</dd>
				</div>
				<div>
					<dt>Vehículo</dt>
					<dd>
						<strong>{datos.vehiculo.placa ?? '—'}</strong> · {[
							datos.vehiculo.marca,
							datos.vehiculo.modelo,
							datos.vehiculo.clase
						]
							.filter(Boolean)
							.join(' ') || '—'}<br /><small
							>Interno {datos.vehiculo.numero_interno ?? '—'} · Tarjeta de operación {datos.vehiculo
								.tarjeta_operacion ?? '—'}</small
						>
					</dd>
				</div>
				<div class="vx-ancho">
					<dt>Conductores</dt>
					<dd>
						{#each datos.conductores as c, i (i)}
							<div>
								{c.nombre}{c.cedula ? ` · C.C. ${c.cedula}` : ''}{c.licencia_vigencia
									? ` · licencia vigente hasta ${fechaLarga(c.licencia_vigencia)}`
									: ''}
							</div>
						{:else}
							—
						{/each}
					</dd>
				</div>
				<div class="vx-ancho">
					<dt>Firma electrónica</dt>
					<dd>
						<small
							>HMAC-SHA512 · huella {datos.huella ?? '—'} · emitido {datos.emitido_at
								? fechaLarga(datos.emitido_at)
								: '—'}</small
						>
					</dd>
				</div>
			</dl>
			<p class="vx-nota">
				Compare el número, la placa y la huella con el documento impreso. Las cédulas se muestran
				parcialmente por privacidad. Dudas: <a href="mailto:operaciones.cotransmeq@hotmail.com"
					>operaciones.cotransmeq@hotmail.com</a
				>.
			</p>
		</section>
	{/if}
</main>

<style>
	.vx {
		max-width: 44rem;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.vx-cabecera {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.vx-cabecera img {
		height: 52px;
		width: auto;
	}
	.vx-eyebrow {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6b7280;
	}
	.vx h1 {
		margin: 0;
		font-size: 1.25rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.02em;
	}
	.vx-tarjeta {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		padding: 1.1rem 1.25rem;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}
	.vx-cargando {
		text-align: center;
		color: #6b7280;
	}
	.vx-veredicto {
		display: flex;
		gap: 1rem;
		align-items: center;
		border-width: 2px;
	}
	.vx-veredicto h2 {
		margin: 0 0 0.2rem;
		font-size: 1.1rem;
	}
	.vx-veredicto p {
		margin: 0;
		font-size: 0.92rem;
	}
	.vx-icono {
		flex: none;
		width: 46px;
		height: 46px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 1.4rem;
		font-weight: 900;
		color: #fff;
	}
	.vx-verde {
		border-color: #16a34a;
		background: #f0fdf4;
	}
	.vx-verde .vx-icono {
		background: #16a34a;
	}
	.vx-ambar {
		border-color: #d97706;
		background: #fffbeb;
	}
	.vx-ambar .vx-icono {
		background: #d97706;
	}
	.vx-rojo {
		border-color: #dc2626;
		background: #fef2f2;
	}
	.vx-rojo .vx-icono {
		background: #dc2626;
	}
	.vx-datos {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem 1rem;
	}
	.vx-ancho {
		grid-column: span 2;
	}
	@media (max-width: 520px) {
		.vx-datos {
			grid-template-columns: 1fr;
		}
		.vx-ancho {
			grid-column: span 1;
		}
	}
	.vx-datos dt {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #6b7280;
	}
	.vx-datos dd {
		margin: 0;
		font-size: 0.92rem;
		overflow-wrap: anywhere;
	}
	.vx-datos small {
		color: #6b7280;
	}
	.vx-nota {
		margin: 1rem 0 0;
		font-size: 0.78rem;
		color: #6b7280;
	}
	.vx-nota a {
		color: #c2410c;
	}
</style>
