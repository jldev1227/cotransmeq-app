<script lang="ts">
	/**
	 * Trazabilidad de una liquidación de servicio: quién la creó, quién la
	 * liquidó, aprobó o facturó, y qué cambió en cada edición.
	 *
	 * Reemplaza a dos modales que hacían lo mismo a medias: el del visor (solo
	 * transiciones, y una edición salía «Borrador → Borrador») y el del listado
	 * (mostraba la foto cruda con un total en $0, porque leía un campo que la
	 * foto no tiene). La lectura del historial vive en
	 * `$lib/liquidaciones/trazabilidad.ts`; aquí solo se pinta.
	 *
	 * Es idéntico en los dos repos.
	 */
	import {
		ArrowRightLeft,
		CirclePlus,
		CircleX,
		FileSpreadsheet,
		PencilLine,
		RotateCcw
	} from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import { mascota } from '$lib/mascot';
	import type { HistorialEstado } from '$lib/api/liquidaciones-servicios';
	import {
		COLOR_ESTADO,
		ETIQUETA_ESTADO,
		agruparPorDia,
		construirEventos,
		fechaBogota,
		formatoCOP,
		hitosDe,
		horaBogota,
		type EventoTrazabilidad,
		type TipoEvento
	} from '$lib/liquidaciones/trazabilidad';

	interface Props {
		open: boolean;
		consecutivo: string | null;
		historial: HistorialEstado[];
		cargando?: boolean;
		/** Mensaje si la carga falló: se muestra con «Reintentar», no como «sin registros». */
		error?: string | null;
		oncerrar: () => void;
		onReintentar?: () => void;
		/** Si llega, el pie ofrece descargar el Excel (que trae la trazabilidad). */
		onExcel?: () => void;
		excelCargando?: boolean;
	}

	let {
		open,
		consecutivo,
		historial,
		cargando = false,
		error = null,
		oncerrar,
		onReintentar,
		onExcel,
		excelCargando = false
	}: Props = $props();

	type Filtro = 'todos' | 'estados' | 'ediciones';
	let filtro = $state<Filtro>('todos');

	/// Cada vez que se abre arranca en «Todo»: el filtro de la liquidación
	/// anterior no tiene nada que ver con la de ahora.
	$effect(() => {
		if (open) filtro = 'todos';
	});

	const eventos = $derived(construirEventos(historial));
	const hitos = $derived(hitosDe(eventos));
	const ediciones = $derived(eventos.filter((e) => e.tipo === 'edicion').length);
	const estados = $derived(eventos.length - ediciones);
	const visibles = $derived(
		filtro === 'todos'
			? eventos
			: eventos.filter((e) => (filtro === 'ediciones' ? e.tipo === 'edicion' : e.tipo !== 'edicion'))
	);
	const dias = $derived(agruparPorDia(visibles));

	const subtitulo = $derived(
		eventos.length
			? `${eventos.length} ${eventos.length === 1 ? 'movimiento' : 'movimientos'} · el último el ${fechaBogota(eventos[0].fecha)}`
			: null
	);

	const ICONOS: Record<TipoEvento, typeof CirclePlus> = {
		creacion: CirclePlus,
		edicion: PencilLine,
		estado: ArrowRightLeft,
		anulacion: CircleX,
		reactivacion: RotateCcw
	};

	/// El color del evento: el del estado al que llegó, salvo las ediciones,
	/// que no cambian de estado y van en neutro para no competir.
	function colorDe(e: EventoTrazabilidad): string {
		if (e.tipo === 'edicion') return '#7e8e87';
		if (e.tipo === 'reactivacion') return '#d97706';
		return COLOR_ESTADO[e.estadoNuevo] ?? '#64748b';
	}

	const etiquetaEstado = (estado: string) => ETIQUETA_ESTADO[estado] ?? estado;

	const vacio = mascota('vacio');
	const advertencia = mascota('advertencia');
</script>

<ModalBase
	{open}
	title="Trazabilidad"
	eyebrow={consecutivo ? `OP-FR-07 · ${consecutivo}` : 'OP-FR-07'}
	subtitle={subtitulo}
	tamano="lg"
	{oncerrar}
>
	{#if cargando}
		<CargaMascota texto="Cargando la trazabilidad…" />
	{:else if error}
		<div class="tz-estado">
			<img src={advertencia.src} alt={advertencia.alt} width="120" height="120" />
			<h3>No se pudo cargar la trazabilidad</h3>
			<p>{error}</p>
			{#if onReintentar}
				<button type="button" class="btn-primary" onclick={onReintentar}>Reintentar</button>
			{/if}
		</div>
	{:else if eventos.length === 0}
		<div class="tz-estado">
			<img src={vacio.src} alt={vacio.alt} width="120" height="120" />
			<h3>Todavía no hay movimientos</h3>
			<p>Cuando alguien cree, edite o cambie el estado de la liquidación, quedará aquí.</p>
		</div>
	{:else}
		<section class="tz-hitos" aria-label="Momentos clave">
			{#each hitos as hito (hito.etiqueta)}
				<div class="tz-hito" style="--c: {hito.color}">
					<span class="tz-hito-etiqueta"><span class="tz-punto" aria-hidden="true"></span>{hito.etiqueta}</span>
					<strong>{fechaBogota(hito.fecha)} · {horaBogota(hito.fecha)}</strong>
					<span class="tz-hito-quien">{hito.usuario}</span>
				</div>
			{/each}
			<div class="tz-hito" style="--c: #7e8e87">
				<span class="tz-hito-etiqueta"><span class="tz-punto" aria-hidden="true"></span>Ediciones</span>
				<strong>{ediciones}</strong>
				<span class="tz-hito-quien">{ediciones === 1 ? 'guardado' : 'guardados'} con cambios o sin ellos</span>
			</div>
		</section>

		<div class="tz-filtros">
			<SegmentosFiltro
				etiqueta="Tipo de movimiento"
				valor={filtro}
				opciones={[
					{ valor: 'todos', etiqueta: `Todo (${eventos.length})` },
					{ valor: 'estados', etiqueta: `Estados (${estados})` },
					{ valor: 'ediciones', etiqueta: `Ediciones (${ediciones})` }
				]}
				onCambiar={(v) => (filtro = v as Filtro)}
			/>
		</div>

		{#each dias as dia (dia.clave)}
			<h3 class="tz-dia">{dia.etiqueta}</h3>
			<ol class="tz-linea">
				{#each dia.eventos as e (e.id)}
					{@const Icono = ICONOS[e.tipo]}
					<li class="tz-evento" style="--c: {colorDe(e)}">
						<span class="tz-icono" aria-hidden="true"><Icono size={15} strokeWidth={2.2} /></span>
						<div class="tz-cuerpo">
							<div class="tz-cabeza">
								<strong class="tz-titulo">{e.titulo}</strong>
								<time datetime={e.fecha}>{horaBogota(e.fecha)}</time>
							</div>
							<p class="tz-meta">
								<span>{e.usuario}</span>
								{#if e.tipo !== 'edicion' && e.tipo !== 'creacion' && e.estadoAnterior}
									<span class="tz-transicion">
										<EstadoPunto
											etiqueta={etiquetaEstado(e.estadoAnterior)}
											color={COLOR_ESTADO[e.estadoAnterior] ?? '#64748b'}
											apagado
										/>
										<span aria-hidden="true">→</span>
										<EstadoPunto
											etiqueta={etiquetaEstado(e.estadoNuevo)}
											color={COLOR_ESTADO[e.estadoNuevo] ?? '#64748b'}
										/>
									</span>
								{/if}
								{#if e.total !== null}
									<span class="tz-total">Total {formatoCOP(e.total)}</span>
								{/if}
								{#if e.tipo === 'creacion' && e.servicios !== null}
									<span>{e.servicios} {e.servicios === 1 ? 'servicio' : 'servicios'}</span>
								{/if}
							</p>

							{#if e.motivo}
								<blockquote class="tz-motivo">{e.motivo}</blockquote>
							{/if}

							{#if e.cambios.length}
								<ul class="tz-cambios">
									{#each e.cambios as c (c.etiqueta)}
										<li>
											<span class="tz-campo">{c.etiqueta}</span>
											<span class="tz-antes">{c.antes}</span>
											<span aria-hidden="true">→</span>
											<strong>{c.despues}</strong>
											{#if c.diferencia}
												<span class="tz-dif" class:tz-dif--sube={c.sube}>{c.diferencia}</span>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}

							{#if e.serviciosCambiados.length}
								<ul class="tz-servicios">
									{#each e.serviciosCambiados as s, i (i)}
										<li class="tz-servicio tz-servicio--{s.tipo}">
											<span class="tz-signo" aria-label={s.tipo}
												>{s.tipo === 'agregado' ? '+' : s.tipo === 'quitado' ? '−' : '~'}</span
											>
											{s.texto}
										</li>
									{/each}
									{#if e.serviciosOcultos > 0}
										<li class="tz-mas">y {e.serviciosOcultos} {e.serviciosOcultos === 1 ? 'cambio' : 'cambios'} más en servicios</li>
									{/if}
								</ul>
							{/if}

							{#if e.tipo === 'edicion' && !e.sinComparacion && !e.cambios.length && !e.serviciosCambiados.length}
								<p class="tz-nota">Se guardó sin cambios en valores ni servicios.</p>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="tz-nota tz-nota--centro">No hay movimientos de este tipo.</p>
		{/each}
	{/if}

	{#snippet pie()}
		{#if onExcel && !cargando && !error}
			<button type="button" class="btn-secondary" onclick={onExcel} disabled={excelCargando}>
				<FileSpreadsheet size={15} aria-hidden="true" />
				{excelCargando ? 'Generando…' : 'Descargar Excel'}
			</button>
		{/if}
		<button type="button" class="btn-primary" onclick={oncerrar}>Cerrar</button>
	{/snippet}
</ModalBase>

<style>
	.tz-estado {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 2rem 1rem;
		text-align: center;
	}
	.tz-estado img {
		width: 7.5rem;
		height: auto;
	}
	.tz-estado h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.1rem;
		font-weight: 800;
		color: var(--text-primary);
	}
	.tz-estado p {
		margin: 0;
		max-width: 28rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	/* Momentos clave: una tarjeta por hito en una rejilla fluida. */
	.tz-hitos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.tz-hito {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		min-width: 0;
	}
	.tz-hito-etiqueta {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.tz-punto {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--c);
		flex-shrink: 0;
	}
	.tz-hito strong {
		font-size: 0.85rem;
		color: var(--text-primary);
	}
	.tz-hito-quien {
		font-size: 0.75rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tz-filtros {
		margin-bottom: 0.75rem;
	}

	.tz-dia {
		margin: 1rem 0 0.5rem;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	/* Línea de tiempo: un ícono por evento sobre una línea vertical. */
	.tz-linea {
		position: relative;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.tz-linea::before {
		content: '';
		position: absolute;
		top: 0.5rem;
		bottom: 0.5rem;
		left: 0.9375rem;
		width: 2px;
		background: var(--border-default);
	}
	.tz-evento {
		position: relative;
		display: flex;
		gap: 0.75rem;
		padding: 0.35rem 0;
	}
	.tz-icono {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: 50%;
		background: color-mix(in srgb, var(--c) 12%, var(--bg-surface));
		color: var(--c);
		box-shadow: 0 0 0 3px var(--bg-surface);
	}
	.tz-cuerpo {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.55rem 0.8rem 0.65rem;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
	}
	.tz-cabeza {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.tz-titulo {
		font-size: 0.88rem;
		color: var(--text-primary);
	}
	.tz-cabeza time {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
	.tz-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		margin: 0.2rem 0 0;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.tz-transicion {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.tz-total {
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
		font-weight: 600;
	}
	.tz-motivo {
		margin: 0.5rem 0 0;
		padding: 0.45rem 0.7rem;
		border-left: 3px solid var(--c);
		border-radius: 0 8px 8px 0;
		background: var(--bg-base);
		font-size: 0.82rem;
		color: var(--text-secondary);
	}

	.tz-cambios,
	.tz-servicios {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0.55rem 0 0;
		padding: 0.5rem 0.65rem;
		list-style: none;
		border-radius: 8px;
		background: var(--bg-base);
		font-size: 0.8rem;
	}
	.tz-cambios li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.4rem;
		font-variant-numeric: tabular-nums;
	}
	.tz-campo {
		min-width: 6.5rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.tz-antes {
		color: var(--text-muted);
		text-decoration: line-through;
		text-decoration-color: color-mix(in srgb, var(--text-muted) 60%, transparent);
	}
	.tz-dif {
		padding: 0 0.4rem;
		border-radius: 999px;
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
		font-size: 0.74rem;
		font-weight: 700;
	}
	.tz-dif--sube {
		background: rgba(22, 163, 74, 0.1);
		color: #15803d;
	}
	.tz-servicio {
		display: flex;
		gap: 0.4rem;
		color: var(--text-secondary);
	}
	.tz-signo {
		flex-shrink: 0;
		width: 1rem;
		font-weight: 800;
		text-align: center;
	}
	.tz-servicio--agregado .tz-signo {
		color: #15803d;
	}
	.tz-servicio--quitado .tz-signo {
		color: #b91c1c;
	}
	.tz-servicio--quitado {
		text-decoration: line-through;
		text-decoration-color: color-mix(in srgb, var(--text-muted) 50%, transparent);
	}
	.tz-servicio--modificado .tz-signo {
		color: #b45309;
	}
	.tz-mas {
		padding-left: 1.4rem;
		color: var(--text-muted);
		font-style: italic;
	}
	.tz-nota {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		font-style: italic;
		color: var(--text-muted);
	}
	.tz-nota--centro {
		padding: 1.5rem 0;
		text-align: center;
	}

	@media (max-width: 640px) {
		.tz-hitos {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.tz-campo {
			min-width: 0;
			width: 100%;
		}
	}
</style>
