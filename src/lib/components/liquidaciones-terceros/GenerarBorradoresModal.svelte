<script lang="ts">
	/**
	 * Generación de borradores de cierres finales desde el canvas.
	 *
	 * Sustituye al viaje por el formulario: aquí se eligen las liquidaciones
	 * de servicio del periodo y las placas, y el job del servidor genera,
	 * **persiste** y anuncia cada hoja según la va creando. El canvas las va
	 * insertando en su sitio alfabético sin recargar.
	 *
	 * Lo que el usuario necesita ver antes de lanzar, y por qué:
	 *
	 *  · **Qué placas ya tienen cierre y en qué estado.** Sin eso, lanzar
	 *    sobre un mes ya trabajado parece inocuo y no lo es.
	 *  · **Qué significa `force_new`.** No crea "otra versión": marca el
	 *    cierre anterior como REEMPLAZADA, y eso no se deshace desde la UI.
	 *  · **Qué hace cancelar.** No aborta la placa en curso ni deshace lo ya
	 *    guardado; esos cierres son válidos y se quedan.
	 */

	import { onMount, onDestroy } from 'svelte';
	import { liquidacionesServiciosAPI } from '$lib/api/liquidaciones-servicios';
	import { borradorQueue, borradorQueueStore } from '$lib/stores/borradorQueue';
	import { claseBadgeEstado } from '$lib/editor/builders/cierres-finales-estado';
	import type { CierreHoja } from '$lib/editor/builders/cierres-finales-identidad';

	interface Props {
		anio: number;
		mes: number;
		/** Hojas ya presentes en el libro. Alimenta los avisos por placa. */
		cierresExistentes: CierreHoja[];
		onClose: () => void;
	}

	let { anio, mes, cierresExistentes, onClose }: Props = $props();

	interface LiqFila {
		id: string;
		consecutivo: string;
		cliente: string;
		estado: string;
		total: number;
	}

	let cargando = $state(true);
	let errorCarga = $state('');
	let liquidaciones = $state<LiqFila[]>([]);
	let seleccionadas = $state<Set<string>>(new Set());
	let busqueda = $state('');

	/** Sin tildes y en minúsculas: buscar «peñalosa» o «penalosa» da igual. */
	function plegar(s: string): string {
		return (s || '')
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase();
	}

	/**
	 * Orden de la lista: cliente A-Z y, dentro de cada cliente, su consecutivo
	 * A-Z. `numeric` para que LS-2 quede antes que LS-10 y no al revés.
	 */
	const liquidacionesOrdenadas = $derived(
		[...liquidaciones].sort(
			(a, b) =>
				a.cliente.localeCompare(b.cliente, 'es', { sensitivity: 'base' }) ||
				a.consecutivo.localeCompare(b.consecutivo, 'es', {
					numeric: true,
					sensitivity: 'base'
				})
		)
	);

	/** Filtro de texto libre: todos los términos han de aparecer en la fila. */
	const liquidacionesVisibles = $derived.by(() => {
		const q = plegar(busqueda).trim();
		if (!q) return liquidacionesOrdenadas;
		const terminos = q.split(/\s+/);
		return liquidacionesOrdenadas.filter((l) => {
			const heno = plegar(`${l.consecutivo} ${l.cliente} ${l.estado}`);
			return terminos.every((t) => heno.includes(t));
		});
	});

	const visiblesSeleccionadas = $derived(
		liquidacionesVisibles.filter((l) => seleccionadas.has(l.id)).length
	);
	const todasVisiblesMarcadas = $derived(
		liquidacionesVisibles.length > 0 &&
			visiblesSeleccionadas === liquidacionesVisibles.length
	);

	/** placa → tercero, sacado del detalle de las liquidaciones elegidas. */
	let placasDetectadas = $state<Array<{ placa: string; tercero: string }>>([]);
	let placasExcluidas = $state<Set<string>>(new Set());
	let cargandoPlacas = $state(false);
	let placasProgreso = $state({ hechas: 0, total: 0 });
	let errorPlacas = $state('');
	/** Consecutivos elegidos cuyo detalle vino sin items de terceros. */
	let sinItems = $state<string[]>([]);

	/**
	 * Detalles ya leídos, por liquidación. Desmarcar y volver a marcar no
	 * cuesta una petición, y con el debounce hace que ir marcando de a una
	 * salga casi gratis después de la primera pasada.
	 */
	const cacheItems = new Map<string, Array<{ placa: string; nombre: string }>>();
	/** Descarta respuestas de una tanda vieja cuando ya salió otra más nueva. */
	let tokenRefresco = 0;
	let temporizador: ReturnType<typeof setTimeout> | null = null;

	let forceNew = $state(false);
	let lanzando = $state(false);
	let errorLanzar = $state('');

	/** Cierres ya existentes, indexados por placa normalizada. */
	const cierrePorPlaca = $derived.by(() => {
		const m = new Map<string, CierreHoja[]>();
		for (const c of cierresExistentes) {
			const k = (c.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
			m.set(k, [...(m.get(k) ?? []), c]);
		}
		return m;
	});

	function normalizar(placa: string): string {
		return (placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	}

	const placasAIncluir = $derived(
		placasDetectadas.filter((p) => !placasExcluidas.has(p.placa)).map((p) => p.placa)
	);

	/** Placas elegidas que ya tienen cierre: son las que `force_new` afecta. */
	const conflictos = $derived(
		placasAIncluir.filter((p) => (cierrePorPlaca.get(normalizar(p)) ?? []).length > 0)
	);

	const job = $derived($borradorQueueStore);
	const enCurso = $derived(
		job != null && (job.status === 'queued' || job.status === 'running')
	);

	onMount(async () => {
		try {
			// El listado viene paginado y hay periodos con más de una página
			// (junio/2026 tiene 113). Con un `limit: 100` sin más, las que
			// sobraban no aparecían y "seleccionar todas" no las incluía:
			// faltaban cierres sin que nada lo dijera. Se recorren las páginas
			// hasta agotarlas.
			const PAGINA = 200;
			const filas: LiqFila[] = [];
			let pagina = 1;
			for (;;) {
				const r = await liquidacionesServiciosAPI.listar({
					mes,
					anio,
					limit: PAGINA,
					page: pagina
				});
				const lote = r.liquidaciones ?? [];
				filas.push(
					...lote.map((l: any) => ({
						id: l.id,
						consecutivo: l.consecutivo,
						cliente: l.cliente?.nombre ?? '—',
						estado: l.estado,
						total: Number(l.total) || 0
					}))
				);
				// `totalPages` es la señal buena; el corte por lote corto es el
				// respaldo si el servidor no la manda.
				const totalPaginas = Number(r.totalPages) || 0;
				if (lote.length < PAGINA) break;
				if (totalPaginas > 0 && pagina >= totalPaginas) break;
				pagina++;
				if (pagina > 50) break; // tope de cordura
			}
			liquidaciones = filas;
		} catch (e: any) {
			errorCarga = e?.message || 'No se pudieron cargar las liquidaciones del periodo';
		} finally {
			cargando = false;
		}
	});

	function alternarLiquidacion(id: string) {
		const s = new Set(seleccionadas);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		seleccionadas = s;
		programarRefrescoPlacas();
	}

	/**
	 * Marcar de a una no debe disparar una tanda por clic: se espera a que el
	 * usuario deje de tocar la lista. El spinner sí se enciende ya, para que
	 * la espera se vea como espera y no como "no hay placas".
	 */
	function programarRefrescoPlacas() {
		if (temporizador) clearTimeout(temporizador);
		temporizador = null;

		if (seleccionadas.size === 0) {
			tokenRefresco++;
			placasDetectadas = [];
			placasExcluidas = new Set();
			placasProgreso = { hechas: 0, total: 0 };
			sinItems = [];
			errorPlacas = '';
			cargandoPlacas = false;
			return;
		}

		cargandoPlacas = true;
		placasProgreso = { hechas: 0, total: seleccionadas.size };
		temporizador = setTimeout(() => {
			temporizador = null;
			void refrescarPlacas();
		}, 450);
	}

	onDestroy(() => {
		if (temporizador) clearTimeout(temporizador);
		tokenRefresco++;
	});

	/**
	 * "Todas" actúa solo sobre lo visible: con un filtro puesto, marcar todas
	 * no debe tocar —ni desmarcar— lo que el filtro esconde.
	 */
	function todasLasLiquidaciones(incluir: boolean) {
		const s = new Set(seleccionadas);
		for (const l of liquidacionesVisibles) {
			if (incluir) s.add(l.id);
			else s.delete(l.id);
		}
		seleccionadas = s;
		programarRefrescoPlacas();
	}

	/** Corre `fn` sobre `items` con como mucho `n` peticiones en vuelo. */
	async function enTandas<T>(items: T[], n: number, fn: (it: T) => Promise<void>) {
		let cursor = 0;
		const obreros = Array.from({ length: Math.min(n, items.length) }, async () => {
			while (cursor < items.length) {
				await fn(items[cursor++]);
			}
		});
		await Promise.all(obreros);
	}

	/**
	 * Lee el detalle de las liquidaciones elegidas para saber qué placas
	 * generarán cierre.
	 *
	 * El listado no trae `terceros_items` —es una lista, no un detalle—, así
	 * que hace falta una petición por liquidación. Con 100 elegidas eso son
	 * 100 peticiones: van de a 6 para no saturar la cola del navegador, se
	 * cachean por id y lo que falle se cuenta y se dice, en vez de
	 * desaparecer en un `catch` vacío y dejar la lista en "0 de 0" sin
	 * explicación.
	 */
	async function refrescarPlacas() {
		const token = ++tokenRefresco;
		const ids = [...seleccionadas];
		if (ids.length === 0) return;

		cargandoPlacas = true;
		errorPlacas = '';

		const pendientes = ids.filter((id) => !cacheItems.has(id));
		let hechas = ids.length - pendientes.length;
		placasProgreso = { hechas, total: ids.length };
		let fallidas = 0;

		await enTandas(pendientes, 6, async (id) => {
			try {
				const d = await liquidacionesServiciosAPI.obtenerPorId(id);
				const items: Array<{ placa: string; nombre: string }> = [];
				for (const it of (d as any)?.terceros_items ?? []) {
					const placa = String(it.placa || '').trim();
					if (!placa) continue;
					items.push({ placa, nombre: it.tercero?.nombre_completo ?? '' });
				}
				cacheItems.set(id, items);
			} catch {
				// Sin cachear: la próxima tanda lo reintenta.
				fallidas++;
			}
			hechas++;
			if (token === tokenRefresco) placasProgreso = { hechas, total: ids.length };
		});

		// Llegó tarde: hay una selección más nueva mandando. No pisar nada.
		if (token !== tokenRefresco) return;

		const porPlaca = new Map<string, string>();
		const vacias: string[] = [];
		for (const id of ids) {
			const items = cacheItems.get(id);
			if (!items) continue;
			if (items.length === 0) {
				vacias.push(liquidaciones.find((l) => l.id === id)?.consecutivo ?? id);
				continue;
			}
			for (const { placa, nombre } of items) {
				// Una placa puede aparecer con dos terceros distintos en el
				// mismo mes: se muestran ambos nombres, porque cada uno será
				// una hoja aparte.
				const previo = porPlaca.get(placa);
				if (previo === undefined) {
					porPlaca.set(placa, nombre || '—');
				} else if (nombre && !previo.includes(nombre)) {
					porPlaca.set(placa, previo === '—' ? nombre : `${previo} · ${nombre}`);
				}
			}
		}

		const nuevas = [...porPlaca.entries()]
			.map(([placa, tercero]) => ({ placa, tercero }))
			.sort((a, b) => a.placa.localeCompare(b.placa, 'es'));

		// Se conservan las exclusiones de placas que siguen estando: añadir una
		// liquidación más no debe deshacer lo que el usuario ya descartó.
		const vivas = new Set(nuevas.map((p) => p.placa));
		placasExcluidas = new Set([...placasExcluidas].filter((p) => vivas.has(p)));
		placasDetectadas = nuevas;
		sinItems = vacias;
		errorPlacas =
			fallidas > 0
				? `${fallidas} liquidación(es) no se pudieron leer; sus placas no están en la lista. Vuelve a marcarlas para reintentar.`
				: '';
		cargandoPlacas = false;
	}

	function alternarPlaca(placa: string) {
		const s = new Set(placasExcluidas);
		if (s.has(placa)) s.delete(placa);
		else s.add(placa);
		placasExcluidas = s;
	}

	function todasLasPlacas(incluir: boolean) {
		placasExcluidas = incluir
			? new Set()
			: new Set(placasDetectadas.map((p) => p.placa));
	}

	async function lanzar() {
		if (seleccionadas.size === 0 || lanzando) return;
		lanzando = true;
		errorLanzar = '';
		try {
			const r = await borradorQueue.start({
				liquidacion_servicio_ids: [...seleccionadas],
				persistir: true,
				anio,
				mes,
				// Vacío = todas. Se manda la lista solo si el usuario excluyó
				// alguna, para no fijar un filtro que el servidor no necesita.
				placas: placasExcluidas.size > 0 ? placasAIncluir : undefined,
				force_new: forceNew
			});
			if (r.status === 'error') errorLanzar = r.error ?? 'Error al lanzar';
		} catch (e: any) {
			errorLanzar = e?.message || 'Error al lanzar la generación';
		} finally {
			lanzando = false;
		}
	}

	function fmtCOP(n: number): string {
		return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && !enCurso) onClose();
	}}
/>

<!--
	El fondo no cierra: un clic despistado tirando 100 liquidaciones ya
	elegidas es demasiado caro. Se sale por la × , por Cancelar o por Esc.
-->
<div class="gbm-backdrop">
	<div class="gbm" role="dialog" aria-modal="true" aria-label="Generar borradores" tabindex="-1">
		<header class="gbm-head">
			<div>
				<h2>Generar borradores</h2>
				<p class="gbm-periodo">
					Periodo {String(mes).padStart(2, '0')}/{anio} · fijado por el canvas
				</p>
			</div>
			<button class="gbm-x" onclick={onClose} disabled={enCurso} aria-label="Cerrar">×</button>
		</header>

		{#if job && (enCurso || job.status === 'complete' || job.status === 'cancelled' || job.status === 'error' || job.status === 'locked')}
			<!-- ── Progreso ─────────────────────────────────────────────── -->
			<section class="gbm-body">
				{#if job.status === 'locked'}
					<div class="gbm-aviso gbm-aviso-ambar">
						<strong>{job.lockedBy?.userName ?? 'Otro usuario'}</strong> está generando
						borradores
						{#if job.lockedBy?.anio && job.lockedBy?.mes}
							en {String(job.lockedBy.mes).padStart(2, '0')}/{job.lockedBy.anio}
						{/if}.
						El bloqueo es por periodo: otros meses siguen disponibles.
					</div>
				{:else}
					<p class="gbm-paso">{job.currentStep}</p>
					<div class="gbm-barra">
						<div class="gbm-barra-fill" style="width: {job.progress}%"></div>
					</div>
					<p class="gbm-pct">{job.progress}%</p>

					{#if job.guardados?.length}
						<p class="gbm-nota">
							{job.guardados.length} cierre(s) creados. Sus hojas ya están en el canvas.
						</p>
					{/if}

					{#if job.fallidos?.length}
						<ul class="gbm-fallidos">
							{#each job.fallidos as f (f.placa)}
								<li><strong>{f.placa}</strong>: {f.error}</li>
							{/each}
						</ul>
					{/if}

					{#if job.status === 'error'}
						<div class="gbm-aviso gbm-aviso-rojo">{job.error}</div>
					{/if}
					{#if job.status === 'cancelled'}
						<div class="gbm-aviso gbm-aviso-ambar">
							Cancelado. Los cierres ya creados se conservan: son válidos.
						</div>
					{/if}
				{/if}
			</section>

			<footer class="gbm-foot">
				{#if enCurso}
					<span class="gbm-hint">
						Al cancelar se detiene tras terminar la placa en curso.
					</span>
					<button class="gbm-btn-ghost" onclick={() => borradorQueue.cancel()}>
						Cancelar generación
					</button>
				{:else}
					<button
						class="gbm-btn-ghost"
						onclick={() => {
							borradorQueue.dismiss();
						}}
					>
						Generar otro
					</button>
					<button class="gbm-btn-primary" onclick={onClose}>Cerrar</button>
				{/if}
			</footer>
		{:else}
			<!-- ── Formulario ───────────────────────────────────────────── -->
			<section class="gbm-body">
				{#if cargando}
					<p class="gbm-nota">Cargando liquidaciones de {String(mes).padStart(2, '0')}/{anio}…</p>
				{:else if errorCarga}
					<div class="gbm-aviso gbm-aviso-rojo">{errorCarga}</div>
				{:else if liquidaciones.length === 0}
					<div class="gbm-aviso gbm-aviso-ambar">
						No hay liquidaciones de servicio en este periodo. Sin ellas no hay nada
						que liquidar a terceros.
					</div>
				{:else}
					<h3 class="gbm-h3">1 · Liquidaciones de servicio</h3>

					<input
						class="gbm-buscador"
						type="search"
						placeholder="Buscar por consecutivo, cliente o estado…"
						aria-label="Buscar liquidaciones"
						bind:value={busqueda}
					/>

					<div class="gbm-acciones-mini">
						<label class="gbm-check-todas">
							<input
								type="checkbox"
								checked={todasVisiblesMarcadas}
								indeterminate={visiblesSeleccionadas > 0 && !todasVisiblesMarcadas}
								disabled={liquidacionesVisibles.length === 0}
								onchange={(e) => todasLasLiquidaciones(e.currentTarget.checked)}
							/>
							<span>
								Seleccionar todas{busqueda.trim() ? ' las visibles' : ''}
							</span>
						</label>
						<span class="gbm-nota">
							{seleccionadas.size} elegida(s) · mostrando {liquidacionesVisibles.length}
							de {liquidaciones.length}
						</span>
					</div>

					{#if liquidacionesVisibles.length === 0}
						<p class="gbm-nota">Ninguna liquidación coincide con «{busqueda}».</p>
					{:else}
						<ul class="gbm-lista gbm-lista-liqs">
							{#each liquidacionesVisibles as l (l.id)}
								<li>
									<label>
										<input
											type="checkbox"
											checked={seleccionadas.has(l.id)}
											onchange={() => alternarLiquidacion(l.id)}
										/>
										<span class="gbm-cons">{l.consecutivo}</span>
										<span class="gbm-cliente">{l.cliente}</span>
										<span class="gbm-estado {claseBadgeEstado(l.estado)}">{l.estado}</span>
										<span class="gbm-total">${fmtCOP(l.total)}</span>
									</label>
								</li>
							{/each}
						</ul>
					{/if}

					<h3 class="gbm-h3">2 · Placas</h3>

					{#if seleccionadas.size === 0}
						<p class="gbm-nota">Elige al menos una liquidación para ver sus placas.</p>
					{:else if cargandoPlacas}
						<div class="gbm-cargando" role="status">
							<span class="gbm-spinner" aria-hidden="true"></span>
							<span>
								Leyendo placas ·
								<strong>{placasProgreso.hechas}/{placasProgreso.total}</strong>
								liquidación(es)
							</span>
						</div>
						<ul class="gbm-esqueleto" aria-hidden="true">
							{#each [0, 1, 2, 3] as i (i)}
								<li></li>
							{/each}
						</ul>
					{:else if placasDetectadas.length === 0}
						<div class="gbm-aviso gbm-aviso-ambar">
							Ninguna de las liquidaciones elegidas tiene items de terceros, así que
							no hay nada que liquidar.
							{#if sinItems.length > 0}
								<br />Sin items: {sinItems.join(', ')}.
							{/if}
						</div>
					{:else}
						<div class="gbm-acciones-mini">
							<button onclick={() => todasLasPlacas(true)}>Todas</button>
							<button onclick={() => todasLasPlacas(false)}>Ninguna</button>
							<span class="gbm-nota">{placasAIncluir.length} de {placasDetectadas.length}</span>
						</div>
						<ul class="gbm-lista gbm-lista-placas">
							{#each placasDetectadas as p (p.placa)}
								{@const existentes = cierrePorPlaca.get(normalizar(p.placa)) ?? []}
								<li>
									<label>
										<input
											type="checkbox"
											checked={!placasExcluidas.has(p.placa)}
											onchange={() => alternarPlaca(p.placa)}
										/>
										<span class="gbm-cons">{p.placa}</span>
										<span class="gbm-cliente">{p.tercero}</span>
										{#each existentes as c (c.id)}
											<span class="gbm-estado {claseBadgeEstado(c.estado)}" title="Ya existe un cierre">
												ya: {c.estado}
											</span>
										{/each}
									</label>
								</li>
							{/each}
						</ul>
						{#if sinItems.length > 0}
							<p class="gbm-nota">
								{sinItems.length} liquidación(es) elegidas no tienen items de terceros
								y no aportan placas: {sinItems.join(', ')}.
							</p>
						{/if}
					{/if}

					{#if errorPlacas}
						<div class="gbm-aviso gbm-aviso-rojo">{errorPlacas}</div>
					{/if}

					{#if conflictos.length > 0}
						<h3 class="gbm-h3">3 · Cierres que ya existen</h3>
						<div class="gbm-aviso gbm-aviso-ambar">
							{conflictos.length} de las placas elegidas ya tienen cierre en este
							periodo.
							{#if !forceNew}
								Sin marcar la casilla de abajo, esas placas se <strong>actualizarán</strong>
								sobre su cierre existente.
							{/if}
						</div>

						<label class="gbm-check-peligro">
							<input type="checkbox" bind:checked={forceNew} />
							<span>
								<strong>Crear cierres nuevos (force_new)</strong>
								<em>
									Marca los cierres actuales de esas placas como
									<strong>REEMPLAZADA</strong> y crea otros desde cero. No hay
									botón para deshacerlo: revertir un REEMPLAZADA es manual.
								</em>
							</span>
						</label>
					{/if}

					{#if errorLanzar}
						<div class="gbm-aviso gbm-aviso-rojo">{errorLanzar}</div>
					{/if}
				{/if}
			</section>

			<footer class="gbm-foot">
				<span class="gbm-hint">
					Las hojas irán apareciendo en el canvas conforme se creen.
				</span>
				<button class="gbm-btn-ghost" onclick={onClose}>Cancelar</button>
				<button
					class="gbm-btn-primary"
					onclick={lanzar}
					disabled={seleccionadas.size === 0 ||
						placasAIncluir.length === 0 ||
						cargandoPlacas ||
						lanzando}
				>
					{#if lanzando}
						Lanzando…
					{:else if cargandoPlacas}
						Leyendo placas…
					{:else}
						Generar {placasAIncluir.length} borrador(es)
					{/if}
				</button>
			</footer>
		{/if}
	</div>
</div>

<style>
	.gbm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 220;
		background: rgb(15 23 42 / 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.gbm {
		background: #fff;
		color: #0f172a;
		border-radius: 12px;
		width: 100%;
		max-width: 680px;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
	}

	.gbm-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 20px 12px;
		border-bottom: 1px solid #e2e8f0;
	}
	.gbm-head h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
	}
	.gbm-periodo {
		margin: 3px 0 0;
		font-size: 12px;
		color: #64748b;
	}
	.gbm-x {
		border: none;
		background: transparent;
		font-size: 22px;
		line-height: 1;
		cursor: pointer;
		color: #64748b;
		padding: 0 4px;
	}
	.gbm-x:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.gbm-body {
		padding: 16px 20px;
		overflow-y: auto;
		flex: 1;
	}

	.gbm-h3 {
		margin: 16px 0 8px;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #475569;
	}
	.gbm-h3:first-child {
		margin-top: 0;
	}

	.gbm-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		overflow: hidden;
	}
	.gbm-lista-placas,
	.gbm-lista-liqs {
		max-height: 220px;
		overflow-y: auto;
	}

	.gbm-buscador {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid #cbd5e1;
		border-radius: 7px;
		padding: 6px 10px;
		font: inherit;
		font-size: 12.5px;
		margin-bottom: 8px;
	}
	.gbm-buscador:focus {
		outline: 2px solid #ea580c;
		outline-offset: -1px;
		border-color: #ea580c;
	}
	.gbm-lista li + li {
		border-top: 1px solid #f1f5f9;
	}
	.gbm-lista label {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		font-size: 12.5px;
		cursor: pointer;
	}
	.gbm-lista label:hover {
		background: #f8fafc;
	}

	.gbm-cons {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		min-width: 88px;
	}
	.gbm-cliente {
		flex: 1;
		color: #475569;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.gbm-estado {
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 9.5px;
		font-weight: 700;
		white-space: nowrap;
	}
	.gbm-total {
		font-variant-numeric: tabular-nums;
		color: #0f172a;
		font-weight: 600;
	}

	.gbm-acciones-mini {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}
	.gbm-check-todas {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
		font-weight: 600;
		color: #334155;
		cursor: pointer;
	}
	.gbm-check-todas input:disabled {
		cursor: not-allowed;
	}
	.gbm-acciones-mini button {
		border: 1px solid #cbd5e1;
		background: #fff;
		border-radius: 6px;
		padding: 3px 9px;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
	}

	.gbm-aviso {
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 12.5px;
		line-height: 1.5;
		margin: 10px 0;
	}
	.gbm-aviso-ambar {
		background: #fffbeb;
		color: #92400e;
		border: 1px solid #fcd34d;
	}
	.gbm-aviso-rojo {
		background: #fef2f2;
		color: #991b1b;
		border: 1px solid #fca5a5;
	}

	.gbm-check-peligro {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		border: 1px solid #fca5a5;
		background: #fef2f2;
		border-radius: 8px;
		padding: 10px 12px;
		cursor: pointer;
	}
	.gbm-check-peligro span {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 12.5px;
	}
	.gbm-check-peligro em {
		font-style: normal;
		color: #7f1d1d;
		line-height: 1.45;
	}

	.gbm-cargando {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #475569;
		margin: 6px 0 8px;
	}
	.gbm-spinner {
		width: 13px;
		height: 13px;
		border: 2px solid #cbd5e1;
		border-top-color: #ea580c;
		border-radius: 50%;
		animation: gbm-gira 0.7s linear infinite;
		flex: none;
	}
	@keyframes gbm-gira {
		to {
			transform: rotate(360deg);
		}
	}

	.gbm-esqueleto {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		overflow: hidden;
	}
	.gbm-esqueleto li {
		height: 33px;
		background: linear-gradient(90deg, #f8fafc 25%, #eef2f7 37%, #f8fafc 63%);
		background-size: 400% 100%;
		animation: gbm-brillo 1.3s ease-in-out infinite;
	}
	.gbm-esqueleto li + li {
		border-top: 1px solid #f1f5f9;
	}
	@keyframes gbm-brillo {
		0% {
			background-position: 100% 50%;
		}
		100% {
			background-position: 0 50%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.gbm-spinner,
		.gbm-esqueleto li {
			animation: none;
		}
	}

	.gbm-nota {
		font-size: 12px;
		color: #64748b;
		margin: 6px 0;
	}

	.gbm-paso {
		font-size: 13px;
		font-weight: 600;
		margin: 0 0 8px;
	}
	.gbm-barra {
		height: 8px;
		background: #e2e8f0;
		border-radius: 999px;
		overflow: hidden;
	}
	.gbm-barra-fill {
		height: 100%;
		background: #ea580c;
		transition: width 0.25s ease;
	}
	.gbm-pct {
		margin: 5px 0 0;
		font-size: 11px;
		color: #64748b;
		font-variant-numeric: tabular-nums;
	}

	.gbm-fallidos {
		margin: 10px 0 0;
		padding-left: 18px;
		font-size: 12px;
		color: #b91c1c;
		max-height: 160px;
		overflow-y: auto;
	}

	.gbm-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px 16px;
		border-top: 1px solid #e2e8f0;
	}
	.gbm-hint {
		flex: 1;
		font-size: 11.5px;
		color: #64748b;
	}

	.gbm-btn-ghost,
	.gbm-btn-primary {
		border: none;
		border-radius: 7px;
		padding: 8px 14px;
		font-size: 12.5px;
		font-weight: 700;
		cursor: pointer;
	}
	.gbm-btn-ghost {
		background: #f1f5f9;
		color: #334155;
	}
	.gbm-btn-primary {
		background: #ea580c;
		color: #fff;
	}
	.gbm-btn-ghost:disabled,
	.gbm-btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
