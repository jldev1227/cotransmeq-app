<script lang="ts">
	/**
	 * Propietarios de un cierre: entre cuántos y con qué porcentaje se
	 * reparte el valor a pagar de la placa.
	 *
	 * QUÉ RESUELVE. Algunas placas pertenecen a varias personas y el total a
	 * pagar del cierre se divide entre ellas. Hasta ahora los copropietarios
	 * solo podían tocarse desde el editor antiguo; el canvas los pintaba en
	 * modo solo lectura.
	 *
	 * LA REGLA ES UNA CASCADA POR ORDEN, no un reparto directo: el primero de
	 * la lista toma su porcentaje del total y los demás se reparten el
	 * remanente en proporción a sus porcentajes declarados. Por eso los
	 * porcentajes pueden sumar más de 100 (15 + 50 + 50) sin que sea un
	 * error: 15/50/50 significa 15% del total para el primero y 42.5%
	 * efectivo para cada uno de los otros dos. La columna «efectivo» enseña
	 * esa cuenta en vivo, con el mismo espejo que usa la hoja
	 * (`$lib/editor/business/reparto-propietarios.ts`); el que vale es el que
	 * persiste el backend al guardar.
	 *
	 * CON UN SOLO PROPIETARIO NO HAY REPARTO. La lista con un único nombre
	 * (el titular del cierre) es el modo normal de la hoja; al guardar se
	 * envía la lista VACÍA y el backend apaga `es_multi_propietario` y
	 * regenera las 4 filas globales de impuestos. Solo con dos o más se
	 * activa el modo multi.
	 *
	 * EL GUARDADO ES UN REEMPLAZO, no un delta: se manda la lista final y el
	 * servidor deduce altas y bajas, recalcula impuestos por propietario con
	 * cuadre exacto y captura snapshot.
	 */

	import { onMount } from 'svelte';
	import { liquidacionesTercerosDescuentosAPI } from '$lib/api/liquidaciones-terceros-descuentos';
	import { tercerosAPI } from '$lib/api/terceros';
	import { calcularPorcentajesEfectivos } from '$lib/editor/business/reparto-propietarios';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

	interface Props {
		cierreId: string;
		placa: string;
		periodo: string;
		/// Tercero titular del cierre: el seed cuando aún no hay copropietarios.
		terceroTitular: { id: string | null; nombre: string; identificacion: string | null };
		onClose: () => void;
		/// Se llama tras un guardado correcto; la page recarga y remonta la hoja.
		onGuardado: () => void | Promise<void>;
	}

	let { cierreId, placa, periodo, terceroTitular, onClose, onGuardado }: Props = $props();

	interface Fila {
		/// Clave local estable para el `#each` (las filas nuevas no tienen id de BD).
		key: string;
		/// id de la fila en BD; null si se añadió en esta sesión del modal.
		dbId: string | null;
		terceroId: string | null;
		nombre: string;
		identificacion: string | null;
		porcentaje: number;
		/// Concepto/nota de pago libre, ej. "ABONAR A CRÉDITO BANCOOMEVA".
		nota: string;
		/// FALSE = pago interno por concepto: no se le calculan retenciones.
		aplicaRetenciones: boolean;
	}

	let cargando = $state(true);
	let errorCarga = $state('');
	let guardando = $state(false);
	let errorGuardado = $state('');
	let lista = $state<Fila[]>([]);
	/// Payload con el que se abrió el modal, para deshabilitar «Guardar» sin cambios.
	let firmaInicial = $state('');

	// ── Buscador de terceros (typeahead contra la API) ──
	let busqueda = $state('');
	let buscando = $state(false);
	let resultados = $state<
		{ id: string; nombre_completo: string; identificacion: string | null }[]
	>([]);
	let timerBusqueda: ReturnType<typeof setTimeout> | null = null;

	function filaTitular(): Fila {
		return {
			key: 'titular',
			dbId: null,
			terceroId: terceroTitular.id,
			nombre: terceroTitular.nombre || 'Tercero del cierre',
			identificacion: terceroTitular.identificacion,
			porcentaje: 100,
			nota: '',
			aplicaRetenciones: true
		};
	}

	/// Lo que se manda al PUT: con 0–1 propietarios la hoja vuelve al modo
	/// normal, así que el payload es la lista vacía.
	function payloadDe(filas: Fila[]) {
		if (filas.length <= 1) return [];
		return filas.map((f, idx) => ({
			id: f.dbId ?? undefined,
			tercero_id: f.terceroId,
			nombre: f.nombre,
			identificacion: f.identificacion,
			porcentaje: f.porcentaje,
			nota: f.nota.trim() || null,
			aplica_retenciones: f.aplicaRetenciones,
			orden: idx
		}));
	}

	const firma = (filas: Fila[]) =>
		JSON.stringify(
			payloadDe(filas).map((p) => [
				p.id ?? null,
				p.tercero_id,
				p.nombre,
				p.porcentaje,
				p.nota,
				p.aplica_retenciones
			])
		);

	const hayCambios = $derived(firma(lista) !== firmaInicial);

	/// Cascada en vivo, con el orden = posición en la lista.
	const efectivos = $derived(
		calcularPorcentajesEfectivos(
			lista.map((f, idx) => ({ id: f.key, porcentaje: f.porcentaje, orden: idx }))
		)
	);
	const sumaPorcentajes = $derived(lista.reduce((s, f) => s + (Number(f.porcentaje) || 0), 0));
	const idsEnLista = $derived(new Set(lista.map((f) => f.terceroId).filter(Boolean)));

	onMount(async () => {
		try {
			const r = await liquidacionesTercerosDescuentosAPI.obtenerPropietarios(cierreId);
			const filas = (r.propietarios || [])
				.slice()
				.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
				.map(
					(p): Fila => ({
						key: p.id || crypto.randomUUID(),
						dbId: p.id ?? null,
						terceroId: p.tercero_id ?? null,
						nombre: p.nombre,
						identificacion: p.identificacion ?? null,
						porcentaje: Number(p.porcentaje) || 0,
						nota: p.nota ?? '',
						aplicaRetenciones: p.aplica_retenciones !== false
					})
				);
			lista = filas.length > 0 ? filas : [filaTitular()];
			firmaInicial = firma(lista);
		} catch (e: any) {
			errorCarga =
				e?.response?.data?.error || e?.message || 'No se pudieron cargar los propietarios';
		} finally {
			cargando = false;
		}
	});

	function alBuscar(q: string) {
		busqueda = q;
		if (timerBusqueda) clearTimeout(timerBusqueda);
		const texto = q.trim();
		if (texto.length < 2) {
			resultados = [];
			buscando = false;
			return;
		}
		buscando = true;
		timerBusqueda = setTimeout(async () => {
			try {
				const r = await tercerosAPI.buscar(texto);
				resultados = r;
			} catch {
				resultados = [];
			} finally {
				buscando = false;
			}
		}, 300);
	}

	function agregar(t: { id: string; nombre_completo: string; identificacion: string | null }) {
		if (idsEnLista.has(t.id)) return;
		lista = [
			...lista,
			{
				key: crypto.randomUUID(),
				dbId: null,
				terceroId: t.id,
				nombre: t.nombre_completo,
				identificacion: t.identificacion,
				porcentaje: 0,
				nota: '',
				aplicaRetenciones: true
			}
		];
	}

	function quitar(key: string) {
		lista = lista.filter((f) => f.key !== key);
		if (lista.length === 0) lista = [filaTitular()];
	}

	function fijarPorcentaje(key: string, valor: string) {
		const n = Number(valor);
		lista = lista.map((f) =>
			f.key === key ? { ...f, porcentaje: Number.isFinite(n) && n >= 0 ? n : 0 } : f
		);
	}

	function fijarNota(key: string, valor: string) {
		lista = lista.map((f) => (f.key === key ? { ...f, nota: valor.slice(0, 255) } : f));
	}

	function fijarRetenciones(key: string, valor: boolean) {
		lista = lista.map((f) => (f.key === key ? { ...f, aplicaRetenciones: valor } : f));
	}

	function mover(key: string, delta: -1 | 1) {
		const i = lista.findIndex((f) => f.key === key);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= lista.length) return;
		const copia = [...lista];
		[copia[i], copia[j]] = [copia[j], copia[i]];
		lista = copia;
	}

	function restaurarUnico() {
		lista = [filaTitular()];
	}

	async function guardar() {
		if (guardando) return;
		guardando = true;
		errorGuardado = '';
		try {
			await liquidacionesTercerosDescuentosAPI.guardarPropietarios(cierreId, payloadDe(lista));
			await onGuardado();
		} catch (e: any) {
			errorGuardado =
				e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Error desconocido';
			guardando = false;
		}
	}

	const fmtPct = (n: number) =>
		`${(Math.round(n * 100) / 100).toLocaleString('es-CO', { maximumFractionDigits: 2 })}%`;
</script>

<ModalBase
	open={true}
	eyebrow={`Cierre · ${periodo}`}
	title={`Propietarios de ${placa}`}
	subtitle="Reparto en cascada: el primero toma su % del total y los demás se reparten el remanente"
	tamano="lg"
	sinRelleno
	cerrarAlFondo={false}
	bloqueado={guardando}
	oncerrar={onClose}
>
	<div class="pcm-body">
		<!-- ── Buscador de terceros ─────────────────────────────── -->
		<section class="pcm-pane">
			<label class="pcm-buscador">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="11" cy="11" r="7" />
					<path d="M21 21l-4.35-4.35" stroke-linecap="round" />
				</svg>
				<input
					type="search"
					value={busqueda}
					oninput={(e) => alBuscar(e.currentTarget.value)}
					placeholder="Buscar tercero por nombre o identificación…"
					disabled={cargando || guardando}
				/>
			</label>

			{#if cargando}
				<p class="pcm-vacio">Cargando propietarios…</p>
			{:else if errorCarga}
				<p class="pcm-vacio pcm-error">{errorCarga}</p>
			{:else if busqueda.trim().length < 2}
				<p class="pcm-vacio">
					Escribe al menos dos letras para buscar en el catálogo de terceros. Cada
					resultado se añade a la lista con 0% para que teclees su porcentaje.
				</p>
			{:else if buscando}
				<p class="pcm-vacio">Buscando…</p>
			{:else if resultados.length === 0}
				<p class="pcm-vacio">Ningún tercero coincide con «{busqueda}».</p>
			{:else}
				<ul class="pcm-lista">
					{#each resultados as t (t.id)}
						{@const dentro = idsEnLista.has(t.id)}
						<li>
							<button
								type="button"
								class="pcm-fila"
								class:pcm-fila-dentro={dentro}
								onclick={() => agregar(t)}
								disabled={guardando || dentro}
							>
								<span class="pcm-check" aria-hidden="true">{dentro ? '✓' : '+'}</span>
								<span class="pcm-nom">
									<strong>{t.nombre_completo}</strong>
									<small>{t.identificacion || 'sin identificación'}</small>
								</span>
								{#if dentro}<span class="pcm-tag">en la lista</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- ── Lista de propietarios (el orden ES la cascada) ────── -->
		<section class="pcm-pane pcm-pane-sel">
			<h3>Propietarios del cierre ({lista.length})</h3>

			{#if !cargando && !errorCarga}
				<ul class="pcm-sel">
					{#each lista as f, idx (f.key)}
						<li class="pcm-sel-item">
							<div class="pcm-sel-head">
								<div class="pcm-orden">
									<button
										type="button"
										onclick={() => mover(f.key, -1)}
										disabled={guardando || idx === 0}
										aria-label="Subir a {f.nombre}"
										title="Subir en la cascada"
									>↑</button>
									<span>{idx + 1}</span>
									<button
										type="button"
										onclick={() => mover(f.key, 1)}
										disabled={guardando || idx === lista.length - 1}
										aria-label="Bajar a {f.nombre}"
										title="Bajar en la cascada"
									>↓</button>
								</div>
								<span class="pcm-nom">
									<strong>{f.nombre}</strong>
									<small>{f.identificacion || 'sin identificación'}</small>
								</span>
								<button
									type="button"
									class="pcm-quitar"
									onclick={() => quitar(f.key)}
									disabled={guardando}
									title="Quitar de la lista"
									aria-label="Quitar a {f.nombre}"
								>×</button>
							</div>

							<div class="pcm-sel-campos">
								<label class="pcm-pct">
									<span>%</span>
									<input
										class="pcm-input"
										type="number"
										min="0"
										step="0.01"
										value={f.porcentaje}
										oninput={(e) => fijarPorcentaje(f.key, e.currentTarget.value)}
										disabled={guardando}
									/>
								</label>
								{#if lista.length > 1}
									<p class="pcm-efectivo">
										efectivo <strong>{fmtPct(efectivos.get(f.key) ?? 0)}</strong>
										{#if idx === 0}<small>toma su % del total</small>
										{:else}<small>del remanente, en proporción</small>{/if}
									</p>
								{/if}
							</div>

							<input
								class="pcm-nota"
								type="text"
								maxlength="255"
								value={f.nota}
								oninput={(e) => fijarNota(f.key, e.currentTarget.value)}
								placeholder="Concepto del pago (opcional), ej. ABONAR A CRÉDITO BANCOOMEVA"
								disabled={guardando}
							/>

							<label class="pcm-ret" class:pcm-ret-off={!f.aplicaRetenciones}>
								<input
									type="checkbox"
									checked={f.aplicaRetenciones}
									onchange={(e) => fijarRetenciones(f.key, e.currentTarget.checked)}
									disabled={guardando}
								/>
								<span>
									Aplica retenciones sobre su valor a facturar
									{#if !f.aplicaRetenciones}
										<small>pago interno por concepto — no genera egreso real ni tributa</small>
									{/if}
								</span>
							</label>
						</li>
					{/each}
				</ul>

				{#if lista.length > 1}
					{#if Math.abs(sumaPorcentajes - 100) > 0.01}
						<p class="pcm-aviso">
							Los porcentajes suman {fmtPct(sumaPorcentajes)}. No es un error: la
							cascada reparte con los efectivos de la derecha.
						</p>
					{/if}
					{#if lista.length > 4}
						<p class="pcm-aviso">
							Con más de 4 propietarios la matriz de la hoja se recorta por ancho;
							el PDF sí los muestra todos.
						</p>
					{/if}
					<button
						type="button"
						class="btn-secondary pcm-restaurar"
						onclick={restaurarUnico}
						disabled={guardando}
					>
						Restaurar propietario único ({terceroTitular.nombre})
					</button>
				{:else}
					<p class="pcm-vacio">
						Con un solo propietario la hoja funciona en modo normal: sin tablas de
						reparto y con la tabla general de impuestos.
					</p>
				{/if}
			{/if}
		</section>
	</div>

	{#snippet pie()}
		{#if errorGuardado}
			<p class="pcm-error pcm-error-pie">{errorGuardado}</p>
		{/if}
		<button type="button" class="btn-secondary" onclick={onClose} disabled={guardando}>
			Cancelar
		</button>
		<button
			type="button"
			class="btn-primary"
			onclick={guardar}
			disabled={guardando || cargando || !!errorCarga || !hayCambios}
			title={hayCambios ? '' : 'No hay cambios que guardar'}
		>
			{guardando ? 'Guardando…' : 'Guardar y recalcular'}
		</button>
	{/snippet}
</ModalBase>

<style>
	/* Dos columnas que scrollean cada una por su lado: el cuerpo de
	   ModalBase va sin relleno y la rejilla ocupa todo su alto. */
	.pcm-body {
		display: grid;
		grid-template-columns: 1fr 1.15fr;
		gap: 0;
		height: 100%;
		min-height: 0;
	}
	.pcm-pane {
		display: flex;
		flex-direction: column;
		min-height: 0;
		padding: 18px 20px;
		overflow-y: auto;
	}
	.pcm-pane-sel {
		border-left: 1px solid var(--border-subtle);
	}
	.pcm-pane-sel h3 {
		margin: 0 0 10px;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	/* Mismo aspecto que `.de-input` de ModalEntidad, con la lupa dentro. */
	.pcm-buscador {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 0 12px;
		margin-bottom: 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-muted);
		flex: none;
	}
	.pcm-buscador:focus-within {
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.pcm-buscador input {
		border: none;
		outline: none;
		width: 100%;
		padding: 9px 0;
		font-size: 14px;
		font-family: inherit;
		color: var(--text-primary);
		background: transparent;
	}
	.pcm-buscador input:disabled {
		color: var(--text-muted);
	}

	.pcm-lista,
	.pcm-sel {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.pcm-sel {
		gap: 10px;
	}

	.pcm-fila {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border: 1px solid transparent;
		border-radius: 12px;
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}
	.pcm-fila:hover:not(:disabled) {
		background: var(--bg-surface);
	}
	.pcm-fila-dentro {
		background: var(--bg-surface);
		border-color: color-mix(in srgb, var(--accion) 35%, transparent);
	}
	.pcm-fila:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.pcm-check {
		flex: none;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		background: var(--border-subtle);
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 700;
		line-height: 20px;
		text-align: center;
	}
	.pcm-fila-dentro .pcm-check {
		background: var(--accion);
		color: #fff;
	}

	.pcm-nom {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.pcm-nom strong {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pcm-nom small {
		font-size: 11.5px;
		color: var(--text-muted);
	}

	.pcm-tag {
		flex: none;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accion);
	}

	.pcm-sel-item {
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
		padding: 12px 14px;
	}
	.pcm-sel-head {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.pcm-quitar {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--text-muted);
		font-size: 17px;
		line-height: 1;
		cursor: pointer;
	}
	.pcm-quitar:hover:not(:disabled) {
		background: var(--bg-base);
		color: #b42318;
	}
	.pcm-quitar:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.pcm-sel-campos {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-top: 10px;
	}
	.pcm-input {
		width: 92px;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 14px;
		font-family: inherit;
	}
	.pcm-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.pcm-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}



	.pcm-vacio {
		margin: 10px 2px;
		font-size: 13px;
		line-height: 1.5;
		color: var(--text-muted);
	}
	.pcm-error {
		color: #b42318;
		font-size: 12px;
		font-weight: 600;
	}


	.pcm-orden {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
		flex: none;
	}
	.pcm-orden span {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.pcm-orden button {
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
		padding: 2px 5px;
	}
	.pcm-orden button:hover:not(:disabled) {
		background: var(--bg-base);
		color: var(--text-primary);
	}
	.pcm-orden button:disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	.pcm-pct {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.pcm-pct span {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-secondary);
	}

	.pcm-efectivo {
		margin: 0;
		font-size: 12px;
		color: var(--text-secondary);
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}
	.pcm-efectivo strong {
		font-size: 13px;
		color: var(--text-primary);
	}
	.pcm-efectivo small {
		font-size: 11px;
		color: var(--text-muted);
	}

	/* Campo secundario: borde discontinuo hasta que se enfoca. */
	.pcm-nota {
		width: 100%;
		margin-top: 10px;
		min-height: 38px;
		padding: 8px 12px;
		border: 1px dashed var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		font-size: 13px;
		font-family: inherit;
		color: var(--text-primary);
	}
	.pcm-nota::placeholder {
		color: var(--text-very-muted);
	}
	.pcm-nota:focus {
		outline: none;
		border-style: solid;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.pcm-nota:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}

	.pcm-ret {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin-top: 10px;
		padding: 8px 10px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		cursor: pointer;
	}
	.pcm-ret-off {
		background: #fffbeb;
		border-color: #fcd34d;
	}
	.pcm-ret input {
		margin-top: 2px;
		flex: none;
		accent-color: var(--accion);
	}
	.pcm-ret span {
		display: flex;
		flex-direction: column;
		font-size: 12.5px;
		font-weight: 600;
		line-height: 1.3;
		color: var(--text-primary);
	}
	.pcm-ret small {
		font-size: 11px;
		font-weight: 500;
		color: #92400e;
	}

	.pcm-aviso {
		margin: 12px 2px 0;
		font-size: 11.5px;
		line-height: 1.45;
		color: #b45309;
	}

	.pcm-restaurar {
		margin-top: 12px;
		align-self: flex-start;
	}
	.pcm-error-pie {
		margin: 0 auto 0 0;
	}

	@media (max-width: 720px) {
		.pcm-body {
			grid-template-columns: 1fr;
			height: auto;
		}
		.pcm-pane-sel {
			border-left: none;
			border-top: 1px solid var(--border-subtle);
		}
	}
</style>
