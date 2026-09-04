<script lang="ts">
	/**
	 * Cobertura de datos de un cálculo: esperados, válidos y excluidos con motivo.
	 *
	 * Es la pieza que impide que un porcentaje mienta. Un 92 % calculado sobre
	 * la mitad de los registros y un 92 % calculado sobre todos se ven idénticos
	 * en una tarjeta; aquí se ve la diferencia, y cada motivo dice cuántos
	 * registros se cayeron y por qué.
	 */
	import type { CoberturaDatos } from '$lib/types/pesv-centro';

	interface Props {
		cobertura: CoberturaDatos;
		/** Compacto para la tarjeta; extendido para el panel de detalle. */
		compacto?: boolean;
	}

	let { cobertura, compacto = false }: Props = $props();

	const porcentaje = $derived(
		cobertura.esperados > 0
			? Math.round((cobertura.validos / cobertura.esperados) * 1000) / 10
			: null
	);

	/// Por debajo del 80 % el resultado se calculó sobre una minoría y hay que
	/// decirlo en voz alta, no dejarlo en una barra de color.
	const parcial = $derived(porcentaje !== null && porcentaje < 80);

	const ETIQUETAS: Record<string, string> = {
		SIN_VEHICULO: 'Sin vehículo identificado',
		SIN_CONDUCTOR: 'Sin conductor identificado',
		SIN_FECHA: 'Sin fecha o dato clave',
		KILOMETRAJE_INVALIDO: 'Kilometraje final menor que el inicial',
		KILOMETRAJE_AUSENTE: 'Recorrido sin kilometraje',
		PLACA_NO_NORMALIZABLE: 'Placa con formato irreconocible',
		IDENTIFICACION_INVALIDA: 'Identificación no utilizable',
		DUPLICADO: 'Registro repetido',
		FUERA_DE_PERIODO: 'Fuera del alcance del cálculo',
		BORRADOR: 'Envío en borrador',
		ANULADO: 'Registro anulado',
		SUSTITUIDO: 'Reemplazado por una corrección',
		SIN_ASIGNACION_PESV: 'Asignación no marcada como preoperacional',
		SIN_POLITICA_VIGENTE: 'Sin política de jornada vigente',
		HORARIO_INCOHERENTE: 'Horario de inicio y fin incoherente'
	};

	const etiqueta = (motivo: string) => ETIQUETAS[motivo] ?? motivo;
</script>

<div class="cobertura" class:compacto>
	<div class="cabecera">
		<span class="titulo">Cobertura de datos</span>
		{#if porcentaje !== null}
			<span class="porcentaje" class:parcial>{porcentaje} %</span>
		{:else}
			<span class="porcentaje sin">Sin registros</span>
		{/if}
	</div>

	{#if cobertura.esperados > 0}
		<div
			class="barra"
			role="img"
			aria-label="{cobertura.validos} de {cobertura.esperados} registros entraron en el cálculo"
		>
			<div class="relleno" class:parcial style="width: {porcentaje}%"></div>
		</div>
		<p class="detalle">
			{cobertura.validos} de {cobertura.esperados} registros entraron en el cálculo.
			{#if cobertura.excluidos > 0}
				<strong>{cobertura.excluidos}</strong> quedaron fuera.
			{/if}
		</p>
	{:else}
		<p class="detalle">No hubo registros que evaluar en el período.</p>
	{/if}

	{#if parcial}
		<p class="aviso" role="note">
			El resultado se calculó sobre menos del 80 % de los registros esperados. Corrija las
			exclusiones para que sea representativo.
		</p>
	{/if}

	{#if !compacto && cobertura.motivos.length > 0}
		<ul class="motivos">
			{#each cobertura.motivos as m (m.motivo)}
				<li>
					<span class="cantidad">{m.cantidad}</span>
					<span class="texto">{etiqueta(m.motivo)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.cobertura {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: #475569;
	}

	.cabecera {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.titulo {
		font-weight: 600;
		color: #334155;
	}

	.porcentaje {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: #15803d;
	}

	.porcentaje.parcial {
		color: #b45309;
	}

	.porcentaje.sin {
		color: #64748b;
		font-weight: 500;
	}

	.barra {
		height: 0.375rem;
		border-radius: 999px;
		background: #e2e8f0;
		overflow: hidden;
	}

	.relleno {
		height: 100%;
		background: #15803d;
		border-radius: 999px;
	}

	.relleno.parcial {
		background: #b45309;
	}

	.detalle {
		margin: 0;
	}

	.aviso {
		margin: 0;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		background: #fffbeb;
		border: 1px solid #fde68a;
		color: #92400e;
	}

	.motivos {
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.25rem 1rem;
	}

	.motivos li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.cantidad {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: #b45309;
		min-width: 2ch;
		text-align: right;
	}

	.compacto .motivos {
		display: none;
	}
</style>
