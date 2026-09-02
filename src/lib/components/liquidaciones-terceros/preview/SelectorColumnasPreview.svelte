<!--
	Selector de columnas del preview.

	Delimita qué columnas salen en el documento —y por tanto en el PDF—,
	que es la diferencia entre el papel que se le entrega al tercero y el
	que usa el equipo para revisar. Las columnas marcadas «de uso interno»
	van en un grupo aparte, apagadas por defecto y en gris: es información
	nuestra, no del cliente.

	La selección se guarda por canvas (`localStorage`), así que abrir el
	preview del mes siguiente respeta lo que el usuario eligió la última vez.
-->
<script lang="ts">
	import type { ColumnaPreview } from './tipos';
	import { CATALOGO, seleccionPorDefecto, type ScopePreview } from './columnas';

	interface Props {
		scope: ScopePreview;
		seleccion: string[];
		onCambio: (keys: string[]) => void;
	}

	let { scope, seleccion, onCambio }: Props = $props();

	let abierto = $state(false);

	const catalogo = $derived(CATALOGO[scope]);
	const normales = $derived(catalogo.filter((c) => !c.interna));
	const internas = $derived(catalogo.filter((c) => c.interna));
	const activas = $derived(new Set(seleccion));
	const cuenta = $derived(`${seleccion.length}/${catalogo.length}`);

	function alternar(col: ColumnaPreview) {
		if (col.fija) return;
		const next = activas.has(col.key)
			? seleccion.filter((k) => k !== col.key)
			: [...seleccion, col.key];
		onCambio(next);
	}

	function todas(incluirInternas: boolean) {
		onCambio(catalogo.filter((c) => incluirInternas || !c.interna).map((c) => c.key));
	}

	function restablecer() {
		onCambio(seleccionPorDefecto(scope));
	}

	/// Clic fuera: cierra el panel. Sin esto hay que volver al botón, que
	/// con el panel abierto queda tapado por él en pantallas estrechas.
	function fueraDelPanel(node: HTMLElement) {
		const onDown = (e: MouseEvent) => {
			if (!node.contains(e.target as Node)) abierto = false;
		};
		document.addEventListener('mousedown', onDown, true);
		return {
			destroy: () => document.removeEventListener('mousedown', onDown, true)
		};
	}
</script>

<div class="cols-wrap" use:fueraDelPanel>
	<button
		class="cols-btn"
		onclick={() => (abierto = !abierto)}
		title="Elegir qué columnas salen en el documento y en el PDF"
		aria-expanded={abierto}
	>
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M4 5h16M4 5v14M10 5v14M16 5v14M20 5v14"
			/>
		</svg>
		Columnas
		<span class="cols-count">{cuenta}</span>
	</button>

	{#if abierto}
		<div class="cols-panel">
			<div class="cols-panel-head">
				<span>Columnas del documento</span>
				<button class="cols-link" onclick={restablecer}>Restablecer</button>
			</div>

			<div class="cols-group-label">
				<span>Documento</span>
				<button class="cols-link" onclick={() => todas(false)}>Todas</button>
			</div>
			{#each normales as col (col.key)}
				<label class="cols-item" class:is-fija={col.fija} title={col.nota ?? ''}>
					<input
						type="checkbox"
						checked={activas.has(col.key)}
						disabled={col.fija}
						onchange={() => alternar(col)}
					/>
					<span class="cols-item-label">{col.label}</span>
					{#if col.fija}<span class="cols-tag">fija</span>{/if}
				</label>
			{/each}

			{#if internas.length}
				<div class="cols-group-label cols-group-interna">
					<span>Uso interno</span>
					<button class="cols-link" onclick={() => todas(true)}>Todas</button>
				</div>
				{#each internas as col (col.key)}
					<label class="cols-item cols-item-interna" title={col.nota ?? ''}>
						<input type="checkbox" checked={activas.has(col.key)} onchange={() => alternar(col)} />
						<span class="cols-item-label">{col.label}</span>
					</label>
				{/each}
				<p class="cols-nota">
					Las columnas de uso interno no forman parte del documento que se entrega al tercero.
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.cols-wrap {
		position: relative;
		display: inline-flex;
	}
	.cols-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 11px;
		border-radius: 7px;
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s;
	}
	.cols-btn:hover {
		background: rgba(255, 255, 255, 0.2);
	}
	.cols-count {
		font-family: 'SF Mono', 'JetBrains Mono', monospace;
		font-size: 10.5px;
		padding: 1px 5px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.16);
	}
	.cols-panel {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		z-index: 40;
		width: 268px;
		max-height: 62vh;
		overflow-y: auto;
		padding: 10px;
		border-radius: 10px;
		background: #fff;
		border: 1px solid #e2e8f0;
		box-shadow: 0 14px 40px rgba(15, 23, 42, 0.28);
		color: #0f172a;
	}
	.cols-panel-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		font-size: 12px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #0f4025;
		padding-bottom: 7px;
		border-bottom: 1px solid #e2e8f0;
	}
	.cols-group-label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin: 9px 0 3px;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #64748b;
	}
	.cols-group-interna {
		color: #475569;
		border-top: 1px solid #e2e8f0;
		padding-top: 8px;
	}
	.cols-link {
		border: none;
		background: none;
		padding: 0;
		font-size: 10.5px;
		font-weight: 700;
		color: #1d4ed8;
		cursor: pointer;
		text-transform: none;
		letter-spacing: 0;
	}
	.cols-link:hover {
		text-decoration: underline;
	}
	.cols-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 5px;
		border-radius: 5px;
		font-size: 12.5px;
		cursor: pointer;
	}
	.cols-item:hover {
		background: #f1f5f9;
	}
	.cols-item.is-fija {
		cursor: default;
		color: #64748b;
	}
	.cols-item-interna .cols-item-label {
		color: #475569;
		font-style: italic;
	}
	.cols-item-label {
		flex: 1;
		min-width: 0;
	}
	.cols-tag {
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.cols-nota {
		margin: 8px 2px 0;
		font-size: 10.5px;
		line-height: 1.45;
		color: #64748b;
	}
</style>
