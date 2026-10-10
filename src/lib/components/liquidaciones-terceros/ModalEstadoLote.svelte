<script lang="ts">
	/**
	 * Cambio de estado EN LOTE de las hojas que el usuario elige.
	 *
	 * El lote del bloque de estado solo sabe «todas las de un estado a otro»
	 * (liquidar todos los borradores). Aquí se elige el estado destino y se
	 * marcan las hojas una a una —o todas las que pueden ir—, mezclando
	 * estados de origen: cada hoja viaja desde el suyo.
	 *
	 * Qué hojas se pueden marcar lo decide la misma máquina de estados que
	 * pinta los botones de una hoja (`transicionesPermitidas`): una que no
	 * puede llegar al destino se ve apagada con el motivo, en vez de
	 * descubrirlo en el parte de fallidos. El servidor valida igual.
	 *
	 * No es atómico, igual que el lote de siempre: con 80 hojas, revertir las
	 * 79 buenas porque una falló no ayuda. El resultado lista las fallidas.
	 */
	import { ArrowRight, Check, Search } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import { liquidacionesTercerosDescuentosAPI } from '$lib/api/liquidaciones-terceros-descuentos';
	import {
		claseBadgeEstado,
		esAdmin,
		transicionesPermitidas,
		type EstadoCierre
	} from '$lib/editor/builders/cierres-finales-estado';
	import type { CierreHoja } from '$lib/editor/builders/cierres-finales-identidad';

	type Hoja = Pick<CierreHoja, 'id' | 'placa' | 'tercero_nombre' | 'consecutivo'> & {
		estado: string;
		version: number;
	};

	interface Props {
		open: boolean;
		hojas: Hoja[];
		anio: number;
		mes: number;
		areas: string | string[] | null | undefined;
		/** Hojas marcadas al abrir (p. ej. la activa). */
		preseleccion?: string[];
		oncerrar: () => void;
		onaplicado: (cambios: Array<{ id: string; estado: string; version: number }>) => void;
	}

	let {
		open,
		hojas,
		anio,
		mes,
		areas,
		preseleccion = [],
		oncerrar,
		onaplicado
	}: Props = $props();

	const DESTINOS: Array<{ estado: EstadoCierre; etiqueta: string; peligro?: boolean }> = [
		{ estado: 'LIQUIDADA', etiqueta: 'Liquidada' },
		{ estado: 'APROBADA', etiqueta: 'Aprobada' },
		{ estado: 'PAGADA', etiqueta: 'Pagada' },
		{ estado: 'BORRADOR', etiqueta: 'Borrador' },
		{ estado: 'ANULADA', etiqueta: 'Anulada', peligro: true }
	];

	/// Solo los destinos que este usuario puede fijar en alguna hoja: un no
	/// administrador no ve Aprobada ni Pagada.
	const destinos = $derived(
		DESTINOS.filter(
			(d) => esAdmin(areas) || (d.estado !== 'APROBADA' && d.estado !== 'PAGADA')
		)
	);

	let hacia = $state<EstadoCierre>('LIQUIDADA');
	let seleccion = $state<Set<string>>(new Set());
	let busqueda = $state('');
	let filtroEstado = $state<string>('todos');
	let motivo = $state('');
	let enviando = $state(false);
	let resultado = $state<{
		ok: number;
		total: number;
		fallidos: Array<{ placa: string | null; error: string }>;
	} | null>(null);

	$effect(() => {
		if (!open) return;
		resultado = null;
		motivo = '';
		busqueda = '';
		filtroEstado = 'todos';
		seleccion = new Set(preseleccion);
	});

	function puedeIr(h: Hoja, destino: EstadoCierre): boolean {
		return transicionesPermitidas(h.estado, areas).includes(destino);
	}
	function motivoNo(h: Hoja): string {
		if (h.estado === hacia) return `Ya está ${hacia}`;
		if (['APROBADA', 'PAGADA', 'FACTURADA'].includes(h.estado) && !esAdmin(areas))
			return `Salir de ${h.estado} es de Administración`;
		return `${h.estado} → ${hacia} no es válido`;
	}

	/// Al cambiar el destino, se sueltan las marcadas que ya no pueden ir.
	$effect(() => {
		const d = hacia;
		const validas = new Set(hojas.filter((h) => puedeIr(h, d)).map((h) => h.id));
		const quedan = [...seleccion].filter((id) => validas.has(id));
		if (quedan.length !== seleccion.size) seleccion = new Set(quedan);
	});

	const conteoEstados = $derived.by(() => {
		const m = new Map<string, number>();
		for (const h of hojas) m.set(h.estado, (m.get(h.estado) ?? 0) + 1);
		return [...m.entries()].sort();
	});

	function normal(t: string) {
		return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
	}
	const visibles = $derived.by(() => {
		const q = normal(busqueda.trim());
		return hojas.filter(
			(h) =>
				(filtroEstado === 'todos' || h.estado === filtroEstado) &&
				(!q || normal(`${h.placa} ${h.tercero_nombre} ${h.consecutivo}`).includes(q))
		);
	});
	const validasVisibles = $derived(visibles.filter((h) => puedeIr(h, hacia)));
	const todasVisiblesMarcadas = $derived(
		validasVisibles.length > 0 && validasVisibles.every((h) => seleccion.has(h.id))
	);

	function alternar(id: string) {
		const s = new Set(seleccion);
		s.has(id) ? s.delete(id) : s.add(id);
		seleccion = s;
	}
	function marcarVisibles() {
		const s = new Set(seleccion);
		for (const h of validasVisibles) todasVisiblesMarcadas ? s.delete(h.id) : s.add(h.id);
		seleccion = s;
	}

	const destinoActual = $derived(DESTINOS.find((d) => d.estado === hacia)!);
	const exigeMotivo = $derived(hacia === 'ANULADA');
	const puedeEnviar = $derived(
		!enviando && seleccion.size > 0 && (!exigeMotivo || motivo.trim().length >= 5)
	);

	async function aplicar() {
		if (!puedeEnviar) return;
		enviando = true;
		try {
			const r = await liquidacionesTercerosDescuentosAPI.cambiarEstadoLote({
				anio,
				mes,
				ids: [...seleccion],
				hacia,
				motivo: exigeMotivo ? motivo.trim() : undefined
			});
			resultado = {
				ok: r.cambiados.length,
				total: r.total,
				fallidos: r.fallidos.map((f) => ({ placa: f.placa, error: f.error }))
			};
			onaplicado(r.cambiados.map((c) => ({ id: c.id, estado: c.estado, version: c.version })));
		} catch (e: any) {
			resultado = {
				ok: 0,
				total: seleccion.size,
				fallidos: [{ placa: null, error: e?.response?.data?.error || e?.message || 'Error' }]
			};
		} finally {
			enviando = false;
		}
	}
</script>

<ModalBase
	{open}
	title="Cambiar estado en lote"
	eyebrow="Cierres finales"
	subtitle="Elige el estado destino y marca las hojas que quieres mover."
	tamano="lg"
	bloqueado={enviando}
	cerrarAlFondo={!enviando}
	{oncerrar}
>
	{#if resultado}
		<div class="el-resultado">
			<div class="el-cifra el-cifra--ok">
				<strong>{resultado.ok}</strong><span>pasaron a {hacia}</span>
			</div>
			<div class="el-cifra" class:el-cifra--error={resultado.fallidos.length > 0}>
				<strong>{resultado.fallidos.length}</strong><span>no se pudieron</span>
			</div>
		</div>
		{#if resultado.fallidos.length}
			<ul class="el-fallidos">
				{#each resultado.fallidos as f, i (i)}
					<li><strong>{f.placa ?? '—'}</strong><span>{f.error}</span></li>
				{/each}
			</ul>
		{/if}
	{:else}
		<div class="el">
			<section>
				<h3 class="el-titulo">Pasar a</h3>
				<div class="el-destinos" role="radiogroup" aria-label="Estado destino">
					{#each destinos as d (d.estado)}
						{@const posibles = hojas.filter((h) => puedeIr(h, d.estado)).length}
						<button
							type="button"
							role="radio"
							aria-checked={hacia === d.estado}
							class="el-destino"
							class:el-destino--activo={hacia === d.estado}
							class:el-destino--peligro={d.peligro}
							onclick={() => (hacia = d.estado)}
						>
							<span class="el-badge {claseBadgeEstado(d.estado)}">{d.estado}</span>
							<small>{posibles} {posibles === 1 ? 'hoja puede' : 'hojas pueden'}</small>
						</button>
					{/each}
				</div>
				{#if exigeMotivo}
					<label class="el-motivo">
						<span>Motivo de la anulación <b>*</b></span>
						<textarea
							rows="2"
							bind:value={motivo}
							placeholder="Queda en el historial de cada hoja."
						></textarea>
					</label>
				{/if}
			</section>

			<section class="el-lista-sec">
				<div class="el-barra">
					<label class="el-buscar">
						<Search size={15} />
						<input
							type="search"
							bind:value={busqueda}
							placeholder="Placa, tercero o consecutivo…"
							aria-label="Buscar hojas"
						/>
					</label>
					<select bind:value={filtroEstado} aria-label="Filtrar por estado actual">
						<option value="todos">Todos los estados ({hojas.length})</option>
						{#each conteoEstados as [estado, n] (estado)}
							<option value={estado}>{estado} ({n})</option>
						{/each}
					</select>
					<button
						type="button"
						class="btn-secondary"
						onclick={marcarVisibles}
						disabled={validasVisibles.length === 0}
					>
						{todasVisiblesMarcadas ? 'Desmarcar' : 'Marcar'} las {validasVisibles.length} que pueden
					</button>
				</div>

				<ul class="el-lista">
					{#each visibles as h (h.id)}
						{@const ok = puedeIr(h, hacia)}
						<li>
							<label class="el-fila" class:el-fila--no={!ok}>
								<input
									type="checkbox"
									checked={seleccion.has(h.id)}
									disabled={!ok}
									onchange={() => alternar(h.id)}
								/>
								<span class="el-placa">{h.placa}</span>
								<span class="el-tercero">
									<span>{h.tercero_nombre || '—'}</span>
									<small>{ok ? h.consecutivo : motivoNo(h)}</small>
								</span>
								<span class="el-badge {claseBadgeEstado(h.estado)}">{h.estado}</span>
								{#if ok && seleccion.has(h.id)}
									<ArrowRight size={14} class="el-flecha" />
									<span class="el-badge {claseBadgeEstado(hacia)}">{hacia}</span>
								{/if}
							</label>
						</li>
					{:else}
						<li class="el-vacio">Ninguna hoja coincide con la búsqueda.</li>
					{/each}
				</ul>
			</section>
		</div>
	{/if}

	{#snippet pie()}
		{#if resultado}
			<button type="button" class="btn-primary" onclick={oncerrar}><Check size={15} /> Listo</button>
		{:else}
			<button type="button" class="btn-secondary" onclick={oncerrar} disabled={enviando}
				>Cancelar</button
			>
			<button
				type="button"
				class={destinoActual.peligro ? 'btn-danger' : 'btn-primary'}
				onclick={aplicar}
				disabled={!puedeEnviar}
			>
				{#if enviando}
					Aplicando…
				{:else}
					Pasar {seleccion.size}
					{seleccion.size === 1 ? 'hoja' : 'hojas'} a {destinoActual.etiqueta.toLowerCase()}
				{/if}
			</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.el {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.el-titulo {
		margin: 0 0 8px;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.el-destinos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: 8px;
	}
	.el-destino {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		padding: 10px 12px;
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		cursor: pointer;
		text-align: left;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.el-destino small {
		font-size: 0.74rem;
		color: var(--text-muted);
	}
	.el-destino--activo {
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.el-destino--peligro.el-destino--activo {
		border-color: #dc2626;
		box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.15);
	}
	.el-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}
	.el-motivo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 12px;
	}
	.el-motivo span {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.el-motivo b {
		color: #dc2626;
	}
	.el-motivo textarea,
	.el-barra select {
		padding: 0.5rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.86rem;
	}
	.el-lista-sec {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.el-barra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.el-buscar {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1 1 14rem;
		padding: 0 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-muted);
	}
	.el-buscar input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0;
		border: 0;
		outline: none;
		background: transparent;
		font: inherit;
		font-size: 0.86rem;
		color: var(--text-primary);
	}
	.el-lista {
		margin: 0;
		padding: 4px;
		list-style: none;
		max-height: 22rem;
		overflow-y: auto;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: var(--bg-surface);
	}
	.el-fila {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 8px;
		border-radius: 9px;
		cursor: pointer;
	}
	.el-fila:hover {
		background: var(--bg-base);
	}
	.el-fila input {
		width: 16px;
		height: 16px;
		flex: none;
		accent-color: var(--accion);
	}
	.el-fila--no {
		cursor: not-allowed;
	}
	.el-fila--no .el-placa,
	.el-fila--no .el-tercero span {
		opacity: 0.45;
	}
	.el-placa {
		flex: none;
		width: 5.5rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		font-size: 0.85rem;
	}
	.el-tercero {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		font-size: 0.84rem;
	}
	.el-tercero span,
	.el-tercero small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.el-tercero small {
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	:global(.el-flecha) {
		flex: none;
		color: var(--text-muted);
	}
	.el-vacio {
		padding: 1.5rem;
		text-align: center;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.el-resultado {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.el-cifra {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 16px 8px;
		border-radius: 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.el-cifra strong {
		font-family: var(--font-display);
		font-size: 1.8rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.el-cifra span {
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.el-cifra--ok strong {
		color: var(--accion);
	}
	.el-cifra--error strong {
		color: #b91c1c;
	}
	.el-fallidos {
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 14rem;
		overflow-y: auto;
	}
	.el-fallidos li {
		display: flex;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 10px;
		background: #fef2f2;
		font-size: 0.82rem;
	}
	.el-fallidos strong {
		color: #991b1b;
		letter-spacing: 0.04em;
	}
	.el-fallidos span {
		color: #7f1d1d;
	}
</style>
