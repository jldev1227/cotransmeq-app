<script lang="ts">
	/**
	 * Generación de borradores de nómina desde el canvas.
	 *
	 * Es el gemelo de `GenerarBorradoresModal` de cierres de terceros y
	 * sustituye al viaje por el formulario: aquí se elige el periodo y los
	 * conductores, y el servidor genera, persiste y anuncia cada borrador
	 * según lo va creando.
	 *
	 * Lo que el usuario necesita ver antes de lanzar, y por qué:
	 *
	 *  · **Quién ya tiene liquidación y en qué estado.** Sin eso, lanzar sobre
	 *    un mes ya trabajado parece inocuo y no lo es. Esos van desmarcados y
	 *    solo se tocan pidiéndolo por persona.
	 *  · **Quién no tiene días en el periodo.** Su borrador saldría en cero,
	 *    así que también nace desmarcado.
	 *  · **Qué hace cancelar.** No aborta el conductor en curso ni deshace lo
	 *    ya guardado; esos borradores son válidos y se quedan.
	 */
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		nominaBorradoresAPI,
		type ConductorPrevio,
		type BorradorNominaItem
	} from '$lib/api/nomina-canvas';

	interface Props {
		anio: number;
		mes: number;
		corte?: number | null;
		onClose: () => void;
		/** Se llama al terminar, para que el canvas recargue el periodo. */
		onTerminado?: () => void;
	}

	let { anio, mes, corte = null, onClose, onTerminado }: Props = $props();

	let cargando = $state(true);
	let errorCarga = $state('');
	let etiqueta = $state('');
	let ventana = $state<{ desde: string | null; hasta: string | null }>({
		desde: null,
		hasta: null
	});
	let conductores = $state<ConductorPrevio[]>([]);
	let marcados = $state<Set<string>>(new Set());
	let reemplazar = $state<Set<string>>(new Set());

	let jobId = $state<string | null>(null);
	let lanzando = $state(false);
	let progreso = $state(0);
	let paso = $state('');
	let procesados = $state(0);
	let total = $state(0);
	let resultados = $state<BorradorNominaItem[]>([]);
	let terminado = $state(false);
	let sondeo: ReturnType<typeof setInterval> | null = null;

	const conDias = $derived(conductores.filter((c) => c.dias > 0));
	const conLiquidacion = $derived(conductores.filter((c) => c.liquidacion_id));
	const sinDias = $derived(conductores.filter((c) => c.dias === 0));

	async function cargar() {
		try {
			cargando = true;
			errorCarga = '';
			const r = await nominaBorradoresAPI.previo(anio, mes, corte ?? undefined);
			conductores = r.conductores;
			etiqueta = r.etiqueta;
			ventana = { desde: r.desde, hasta: r.hasta };
			// Marcados por defecto: los que tienen días y no tienen nada
			// guardado. Los demás se piden a mano.
			marcados = new Set(
				r.conductores.filter((c) => c.dias > 0 && !c.liquidacion_id).map((c) => c.conductor_id)
			);
		} catch (e: any) {
			errorCarga = e?.response?.data?.error || 'No se pudo leer el periodo.';
		} finally {
			cargando = false;
		}
	}
	void cargar();

	function alternar(id: string) {
		// Set nuevo, no mutación: asignar la misma referencia no repinta.
		const s = new Set(marcados);
		s.has(id) ? s.delete(id) : s.add(id);
		marcados = s;
		if (!s.has(id)) {
			const r = new Set(reemplazar);
			r.delete(id);
			reemplazar = r;
		}
	}

	function alternarReemplazo(id: string) {
		const r = new Set(reemplazar);
		r.has(id) ? r.delete(id) : r.add(id);
		reemplazar = r;
		if (r.has(id) && !marcados.has(id)) {
			const s = new Set(marcados);
			s.add(id);
			marcados = s;
		}
	}

	async function lanzar() {
		if (marcados.size === 0) {
			toast.error('Marca al menos un conductor');
			return;
		}
		try {
			lanzando = true;
			const r = await nominaBorradoresAPI.generar({
				anio,
				mes,
				corte,
				conductor_ids: [...marcados],
				sobrescribir: [...reemplazar]
			});
			jobId = r.job_id;
			total = r.total;
			iniciarSondeo();
		} catch (e: any) {
			const d = e?.response?.data;
			if (e?.response?.status === 409) {
				toast.error('Ya hay una generación en curso para este periodo', {
					description: d?.locked_by?.userName ? `La lanzó ${d.locked_by.userName}.` : undefined
				});
			} else {
				toast.error(d?.error || 'No se pudo lanzar la generación');
			}
			lanzando = false;
		}
	}

	/**
	 * Sondeo y no solo sockets: si el socket se cae a mitad, el usuario se
	 * queda mirando una barra congelada sobre un job que sí terminó.
	 */
	function iniciarSondeo() {
		detenerSondeo();
		sondeo = setInterval(async () => {
			if (!jobId) return;
			try {
				const j = await nominaBorradoresAPI.estado(jobId);
				progreso = j.progress;
				paso = j.currentStep;
				procesados = j.processed;
				total = j.total;
				resultados = j.items ?? [];
				if (j.status === 'complete' || j.status === 'error' || j.status === 'cancelled') {
					detenerSondeo();
					terminado = true;
					lanzando = false;
					if (j.status === 'error') toast.error(j.error || 'La generación falló');
					else onTerminado?.();
				}
			} catch {
				// Un fallo puntual de red no debe matar el sondeo: el job sigue.
			}
		}, 900);
	}

	function detenerSondeo() {
		if (sondeo) clearInterval(sondeo);
		sondeo = null;
	}
	onDestroy(detenerSondeo);

	async function cancelar() {
		if (!jobId) return;
		const r = await nominaBorradoresAPI.cancelar(jobId);
		if (r.cancelado) toast.info('Cancelado', { description: r.nota });
	}

	const creados = $derived(resultados.filter((r) => r.estado === 'creado').length);
	const reemplazados = $derived(resultados.filter((r) => r.estado === 'reemplazado').length);
	const omitidos = $derived(resultados.filter((r) => r.estado === 'omitido').length);
	const conError = $derived(resultados.filter((r) => r.estado === 'error').length);

	const money = (n: number) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			maximumFractionDigits: 0
		}).format(n || 0);
</script>

<div class="fondo" role="presentation" onclick={() => !lanzando && onClose()}>
	<div
		class="panel"
		role="dialog"
		aria-modal="true"
		aria-label="Generar borradores de nómina"
		onclick={(e) => e.stopPropagation()}
	>
		<header class="cabecera">
			<div>
				<span class="eyebrow">Nómina · {etiqueta || `${mes}/${anio}`}</span>
				<h2>Generar borradores</h2>
				{#if ventana.desde && ventana.hasta}
					<p class="ventana">Del {ventana.desde} al {ventana.hasta}</p>
				{/if}
			</div>
			<button class="cerrar" onclick={onClose} disabled={lanzando} aria-label="Cerrar">✕</button>
		</header>

		{#if cargando}
			<div class="estado"><p>Leyendo el periodo…</p></div>
		{:else if errorCarga}
			<div class="estado estado--error"><p>{errorCarga}</p></div>
		{:else if jobId}
			<div class="cuerpo">
				<div class="barra">
					<div class="barra-fondo"><div class="barra-relleno" style="width:{progreso}%"></div></div>
					<p class="barra-txt">{paso} · {procesados}/{total}</p>
				</div>

				{#if terminado}
					<div class="resumen">
						<span class="pill pill--ok">{creados} creados</span>
						{#if reemplazados}<span class="pill pill--warn">{reemplazados} reemplazados</span>{/if}
						{#if omitidos}<span class="pill">{omitidos} omitidos</span>{/if}
						{#if conError}<span class="pill pill--bad">{conError} con error</span>{/if}
					</div>
				{/if}

				<ul class="resultados">
					{#each resultados as r (r.conductorId)}
						<li class="fila">
							<span class="marca marca--{r.estado}" aria-hidden="true"></span>
							<span class="nombre">{r.nombre}</span>
							<span class="detalle">
								{#if r.estado === 'creado' || r.estado === 'reemplazado'}
									{money(r.sueldoTotal ?? 0)}
								{:else}
									{r.motivo ?? ''}
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			</div>

			<footer class="pie">
				{#if terminado}
					<button class="btn-primary" onclick={onClose}>Cerrar</button>
				{:else}
					<p class="nota">Cancelar no aborta el conductor en curso ni deshace lo ya guardado.</p>
					<button class="btn-secondary" onclick={cancelar}>Cancelar generación</button>
				{/if}
			</footer>
		{:else}
			<div class="cuerpo">
				{#if conLiquidacion.length}
					<div class="aviso aviso--warn">
						<strong>{conLiquidacion.length} conductor(es) ya tienen liquidación</strong> en este periodo.
						Van desmarcados: marca «reemplazar» solo en quien quieras regenerar, y ten en cuenta que eso
						sobrescribe lo guardado.
					</div>
				{/if}
				{#if sinDias.length}
					<div class="aviso">
						<strong>{sinDias.length} sin días en el periodo.</strong> Su borrador saldría en cero, así
						que también nacen desmarcados.
					</div>
				{/if}

				<ul class="lista">
					{#each conductores as c (c.conductor_id)}
						<li class="fila fila--sel" class:fila--gris={c.dias === 0}>
							<label class="chk">
								<input
									type="checkbox"
									checked={marcados.has(c.conductor_id)}
									onchange={() => alternar(c.conductor_id)}
								/>
								<span class="nombre">{c.nombre}</span>
							</label>

							<span class="meta">
								{c.dias} día{c.dias === 1 ? '' : 's'}
								{#if c.placas.length}· {c.placas.join(', ')}{/if}
							</span>

							{#if c.liquidacion_id}
								<label class="chk chk--reemplazo" title="Sobrescribe la liquidación guardada">
									<input
										type="checkbox"
										checked={reemplazar.has(c.conductor_id)}
										onchange={() => alternarReemplazo(c.conductor_id)}
									/>
									<span class="pill pill--warn">{c.estado} · reemplazar</span>
								</label>
							{:else}
								<span class="estimado">{money(c.sueldo_estimado)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>

			<footer class="pie">
				<p class="nota">{marcados.size} de {conductores.length} marcados</p>
				<button class="btn-secondary" onclick={onClose}>Cerrar</button>
				<button class="btn-primary" onclick={lanzar} disabled={lanzando || marcados.size === 0}>
					Generar {marcados.size} borrador{marcados.size === 1 ? '' : 'es'}
				</button>
			</footer>
		{/if}
	</div>
</div>

<style>
	.fondo {
		position: fixed;
		inset: 0;
		background: rgba(15, 31, 26, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		padding: 1rem;
	}
	/* Ventana centrada, no página: aquí el tope de ancho sí corresponde. */
	.panel {
		background: var(--bg-surface, #fff);
		border-radius: 16px;
		width: 100%;
		max-width: 46rem;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
	}
	.cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.1rem 1.25rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.cabecera h2 {
		margin: 0.25rem 0 0;
		font-size: 1.3rem;
		font-weight: 500;
	}
	.ventana {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--text-muted);
		font-family: 'JetBrains Mono', monospace;
	}
	.cerrar {
		background: none;
		border: none;
		font-size: 1.1rem;
		cursor: pointer;
		color: var(--text-muted);
	}
	.cuerpo {
		padding: 1rem 1.25rem;
		overflow-y: auto;
		flex: 1;
	}
	.estado {
		padding: 2.5rem 1.25rem;
		text-align: center;
		color: var(--text-muted);
	}
	.estado--error {
		color: #b91c1c;
	}

	.aviso {
		font-size: 0.85rem;
		line-height: 1.5;
		padding: 0.7rem 0.9rem;
		border-radius: 10px;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		margin-bottom: 0.8rem;
	}
	.aviso--warn {
		background: rgba(245, 158, 11, 0.08);
		border-color: rgba(245, 158, 11, 0.28);
		color: #92400e;
	}

	.lista,
	.resultados {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.fila {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.87rem;
	}
	.fila--gris {
		opacity: 0.55;
	}
	.chk {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		cursor: pointer;
		min-width: 0;
	}
	.chk--reemplazo {
		margin-left: auto;
	}
	.nombre {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-family: 'JetBrains Mono', monospace;
		white-space: nowrap;
	}
	.estimado {
		margin-left: auto;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.detalle {
		margin-left: auto;
		font-size: 0.78rem;
		color: var(--text-muted);
		text-align: right;
	}

	.pill {
		display: inline-block;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.15rem 0.45rem;
		border-radius: 4px;
		background: var(--bg-base);
		color: var(--text-muted);
	}
	.pill--ok {
		background: rgba(16, 185, 129, 0.12);
		color: var(--emerald-700);
	}
	.pill--warn {
		background: rgba(245, 158, 11, 0.14);
		color: #92400e;
	}
	.pill--bad {
		background: rgba(220, 38, 38, 0.1);
		color: #b91c1c;
	}

	.marca {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.marca--creado {
		background: var(--emerald-500);
	}
	.marca--reemplazado {
		background: #f59e0b;
	}
	.marca--omitido {
		background: #cbd5e1;
	}
	.marca--error {
		background: #dc2626;
	}

	.barra {
		margin-bottom: 1rem;
	}
	.barra-fondo {
		height: 8px;
		border-radius: 999px;
		background: var(--bg-base);
		overflow: hidden;
	}
	.barra-relleno {
		height: 100%;
		background: var(--emerald-500);
		transition: width 0.25s ease;
	}
	.barra-txt {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.resumen {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-bottom: 0.8rem;
	}

	.pie {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.9rem 1.25rem;
		border-top: 1px solid var(--border-subtle);
	}
	.nota {
		margin: 0 auto 0 0;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
</style>
