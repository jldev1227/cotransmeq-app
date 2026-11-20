<script lang="ts">
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import {
		liquidacionesTercerosDescuentosAPI,
		type FacturaFisicaBusqueda
	} from '$lib/api/liquidaciones-terceros-descuentos';

	interface Props {
		onClose: () => void;
		onFacturaFisicaActualizada?: (cambio: {
			cierre_id: string;
			pivote_id: string;
			factura_fisica: boolean;
		}) => void;
	}

	let { onClose, onFacturaFisicaActualizada }: Props = $props();
	let numero = $state('');
	let desde = $state('');
	let hasta = $state('');
	let cargando = $state(false);
	let error = $state('');
	let buscado = $state(false);
	let resultados = $state<FacturaFisicaBusqueda[]>([]);
	let truncado = $state(false);
	let guardandoPorPivote = $state<Record<string, boolean>>({});
	let erroresPorPivote = $state<Record<string, string>>({});

	const meses = [
		'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
		'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
	];

	function etiquetaPeriodo(mes: number, anio: number) {
		return `${meses[mes - 1] ?? mes} ${anio}`;
	}

	function formatoFecha(value: string | null) {
		if (!value) return '—';
		const fecha = new Date(value);
		return Number.isNaN(fecha.getTime())
			? value
			: new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(fecha);
	}

	function formatoCOP(value: number) {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency', currency: 'COP', maximumFractionDigits: 0
		}).format(Number(value) || 0);
	}

	function totalLiquidado() {
		const valoresPorPivote = new Map<string, number>();
		for (const fila of resultados) {
			if (!valoresPorPivote.has(fila.pivote_id)) {
				valoresPorPivote.set(fila.pivote_id, Number(fila.valor_liquidar) || 0);
			}
		}
		return [...valoresPorPivote.values()].reduce((total, valor) => total + valor, 0);
	}

	function actualizarFilasPivote(pivoteId: string, facturaFisica: boolean) {
		resultados = resultados.map((fila) =>
			fila.pivote_id === pivoteId ? { ...fila, factura_fisica: facturaFisica } : fila
		);
	}

	async function alternarFacturaFisica(fila: FacturaFisicaBusqueda) {
		const pivoteId = fila.pivote_id;
		if (!pivoteId || guardandoPorPivote[pivoteId]) return;

		const anterior = fila.factura_fisica;
		const siguiente = !anterior;
		guardandoPorPivote = { ...guardandoPorPivote, [pivoteId]: true };
		erroresPorPivote = { ...erroresPorPivote, [pivoteId]: '' };
		actualizarFilasPivote(pivoteId, siguiente);

		try {
			const respuesta = await liquidacionesTercerosDescuentosAPI.actualizarFacturaFisicaItem(
				pivoteId,
				siguiente
			);
			const valorConfirmado =
				respuesta.items?.find((item: { id: string; factura_fisica: boolean }) => item.id === pivoteId)
					?.factura_fisica ?? siguiente;
			actualizarFilasPivote(pivoteId, valorConfirmado);
			onFacturaFisicaActualizada?.({
				cierre_id: fila.cierre_id,
				pivote_id: pivoteId,
				factura_fisica: valorConfirmado
			});
		} catch (e: any) {
			actualizarFilasPivote(pivoteId, anterior);
			erroresPorPivote = {
				...erroresPorPivote,
				[pivoteId]: e?.response?.data?.error || e?.message || 'No se pudo guardar el cambio.'
			};
		} finally {
			guardandoPorPivote = { ...guardandoPorPivote, [pivoteId]: false };
		}
	}

	async function buscar() {
		const q = numero.trim();
		if (q.length < 2) {
			error = 'Escribe al menos dos caracteres del número de factura.';
			return;
		}
		if (desde && hasta && desde > hasta) {
			error = 'El mes inicial debe ser anterior o igual al mes final.';
			return;
		}

		cargando = true;
		error = '';
		buscado = true;
		try {
			const respuesta = await liquidacionesTercerosDescuentosAPI.buscarFacturaFisica({
				q,
				...(desde ? { desde } : {}),
				...(hasta ? { hasta } : {})
			});
			resultados = respuesta.resultados ?? [];
			truncado = respuesta.truncado === true;
		} catch (e: any) {
			resultados = [];
			error = e?.response?.data?.error || e?.message || 'No se pudo consultar la factura.';
		} finally {
			cargando = false;
		}
	}
</script>

<ModalBase
	open
	eyebrow="Cierres finales · terceros"
	title="Buscar factura física"
	subtitle="Encuentra una factura y revisa el recorrido, la placa, el tercero y el valor liquidado."
	tamano="xl"
	cerrarAlFondo={false}
	oncerrar={onClose}
>
	<form class="bff-filtros" onsubmit={(event) => { event.preventDefault(); void buscar(); }}>
		<label class="bff-campo bff-factura">
			<span>Número de factura</span>
			<input
				type="search"
				placeholder="Ej. TM-6826"
				bind:value={numero}
				disabled={cargando}
			/>
		</label>
		<label class="bff-campo">
			<span>Desde mes</span>
			<input type="month" bind:value={desde} disabled={cargando} />
		</label>
		<label class="bff-campo">
			<span>Hasta mes</span>
			<input type="month" bind:value={hasta} disabled={cargando} />
		</label>
		<button class="bff-buscar" type="submit" disabled={cargando}>
			{cargando ? 'Buscando…' : 'Buscar'}
		</button>
	</form>

	<p class="bff-ayuda">Deja los meses vacíos para buscar en todo el historial.</p>

	{#if error}
		<p class="bff-error" role="alert">{error}</p>
	{/if}

	{#if cargando}
		<div class="bff-vacio">Consultando facturas…</div>
	{:else if buscado && resultados.length === 0 && !error}
		<div class="bff-vacio">No se encontraron facturas para esa búsqueda.</div>
	{:else if resultados.length > 0}
		<p class="bff-resumen">
			{resultados.length} resultado(s). La búsqueda incluye el mes del cierre.
		</p>
		{#if truncado}
			<p class="bff-aviso">Se muestran los primeros 500 resultados. Acota los meses para ver menos registros.</p>
		{/if}
		<div class="bff-tabla-wrap">
			<table class="bff-tabla">
				<thead>
					<tr>
						<th>Factura</th>
						<th>Fecha factura</th>
						<th>Mes cierre</th>
						<th>Placa</th>
						<th>Recorrido</th>
						<th>Fechas del servicio</th>
						<th>Tercero</th>
						<th class="bff-num">Liquidado al tercero</th>
						<th>Física</th>
					</tr>
				</thead>
				<tbody>
					{#each resultados as fila (fila.id)}
						<tr>
							<td>
								<strong>{fila.numero_factura}</strong>
								{#if fila.factura_estado && fila.factura_estado !== 'ACTIVA'}
									<small class="bff-anulada">{fila.factura_estado}</small>
								{/if}
							</td>
							<td>{formatoFecha(fila.fecha_facturacion)}</td>
							<td>{etiquetaPeriodo(fila.mes, fila.anio)}</td>
							<td><strong>{fila.placa || '—'}</strong></td>
							<td class="bff-recorrido">{fila.recorrido || '—'}</td>
							<td>{fila.fechas || '—'}</td>
							<td>{fila.tercero_nombre || 'Sin tercero'}</td>
							<td class="bff-num bff-valor">{formatoCOP(fila.valor_liquidar)}</td>
							<td class="bff-fisica">
								<button
									type="button"
									class:recibida={fila.factura_fisica}
									class="bff-estado"
									aria-pressed={fila.factura_fisica}
									aria-label={fila.factura_fisica ? 'Marcar factura como no física' : 'Marcar factura como física'}
									disabled={guardandoPorPivote[fila.pivote_id]}
									onclick={() => void alternarFacturaFisica(fila)}
								>
									{fila.factura_fisica ? 'Sí' : 'No'}
								</button>
								{#if erroresPorPivote[fila.pivote_id]}
									<small class="bff-error-fila" role="alert">{erroresPorPivote[fila.pivote_id]}</small>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<td colspan="7">Total liquidado al tercero</td>
						<td class="bff-num bff-total">{formatoCOP(totalLiquidado())}</td>
						<td></td>
					</tr>
				</tfoot>
			</table>
		</div>
	{/if}
</ModalBase>

<style>
	.bff-filtros { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; }
	.bff-campo { display: grid; gap: 5px; min-width: 150px; color: #475569; font-size: 11px; font-weight: 700; }
	.bff-factura { flex: 1 1 260px; }
	.bff-campo input { height: 38px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; color: #0f172a; background: #fff; font: inherit; font-weight: 500; }
	.bff-campo input:focus { outline: 2px solid #86efac; border-color: #16a34a; }
	.bff-buscar { height: 38px; padding: 0 18px; border: 0; border-radius: 8px; background: #166534; color: #fff; font-weight: 700; cursor: pointer; }
	.bff-buscar:disabled { opacity: .55; cursor: wait; }
	.bff-ayuda, .bff-resumen { margin: 9px 0 12px; color: #64748b; font-size: 12px; }
	.bff-error, .bff-aviso { margin: 10px 0; padding: 10px 12px; border-radius: 8px; color: #92400e; background: #fffbeb; font-size: 12px; }
	.bff-vacio { padding: 34px 12px; text-align: center; color: #64748b; font-size: 13px; }
	.bff-tabla-wrap { max-height: min(56vh, 600px); overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px; }
	.bff-tabla { width: 100%; border-collapse: collapse; font-size: 12px; }
	.bff-tabla th { position: sticky; top: 0; z-index: 1; padding: 10px 9px; background: #f1f5f9; color: #475569; text-align: left; white-space: nowrap; }
	.bff-tabla td { padding: 9px; border-top: 1px solid #e2e8f0; color: #334155; vertical-align: middle; }
	.bff-tabla tbody tr:hover { background: #f8fafc; }
	.bff-tabla td strong { color: #0f172a; }
	.bff-recorrido { max-width: 320px; white-space: normal; }
	.bff-tabla small { display: block; margin-top: 3px; font-size: 9px; }
	.bff-num { text-align: right !important; white-space: nowrap; }
	.bff-valor { font-weight: 700; color: #14532d !important; }
	.bff-estado { display: inline-flex; padding: 4px 9px; border: 0; border-radius: 999px; color: #92400e; background: #fef3c7; font: inherit; font-weight: 700; cursor: pointer; transition: background-color .15s ease, color .15s ease, opacity .15s ease; }
	.bff-estado.recibida { color: #166534; background: #dcfce7; }
	.bff-estado:hover:not(:disabled) { filter: brightness(.96); }
	.bff-estado:focus-visible { outline: 2px solid #15803d; outline-offset: 2px; }
	.bff-estado:disabled { opacity: .55; cursor: wait; }
	.bff-error-fila { max-width: 160px; color: #b91c1c; white-space: normal; }
	.bff-fisica { min-width: 58px; }
	.bff-tabla tfoot td { position: sticky; bottom: 0; z-index: 1; background: #f1f5f9; color: #0f172a; font-weight: 800; border-top: 2px solid #cbd5e1; }
	.bff-total { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
	.bff-anulada { color: #b91c1c !important; }
	@media (max-width: 760px) { .bff-tabla { min-width: 1080px; } }
</style>
