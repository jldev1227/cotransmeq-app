<script lang="ts">
	/**
	 * Confirmación para retirar un cierre final del periodo.
	 *
	 * POR QUÉ ES UN MODAL Y NO UN `confirm()`:
	 *   Lo que se borra no es «una fila». Un cierre arrastra sus items y sus
	 *   conceptos, y la hoja desaparece del libro para todos los que tengan
	 *   el periodo abierto. Quien pulsa necesita ver QUÉ placa se va, en qué
	 *   estado está y que el borrado es recuperable — que es justo lo que
	 *   quita el miedo a usar la acción.
	 *
	 * POR QUÉ PIDE ESCRIBIR LA PLACA:
	 *   El carril tiene el botón pegado a «Generar borradores» y a «Estado».
	 *   Un clic de más sobre el icono equivocado, con el modal aceptándose
	 *   con Enter, retiraría la hoja en la que se está trabajando. Teclear la
	 *   placa cuesta tres segundos y obliga a leer cuál es.
	 */

	import type { CierreHoja } from '$lib/editor/builders/cierres-finales-identidad';
	import { claseBadgeEstado } from '$lib/editor/builders/cierres-finales-estado';

	interface Props {
		cierre: CierreHoja;
		anio: number;
		mes: number;
		/** `true` mientras corre el borrado: bloquea salidas y el botón. */
		enCurso?: boolean;
		onConfirm: () => void;
		onClose: () => void;
	}

	let { cierre, anio, mes, enCurso = false, onConfirm, onClose }: Props = $props();

	let confirmacion = $state('');

	/// Comparación laxa a propósito: la placa se muestra en mayúsculas y
	/// nadie debería fallar la confirmación por el `caps lock` o un espacio
	/// de más al pegar.
	const coincide = $derived(
		confirmacion.trim().toUpperCase() === (cierre.placa ?? '').trim().toUpperCase()
	);

	const puedeConfirmar = $derived(coincide && !enCurso);

	function confirmar() {
		if (!puedeConfirmar) return;
		onConfirm();
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && !enCurso) onClose();
	}}
/>

<!--
	El fondo no cierra: el mismo criterio que en «Generar borradores». Un clic
	despistado no debe poder ni lanzar ni cancelar una operación de este peso.
-->
<div class="ecm-backdrop">
	<div class="ecm" role="dialog" aria-modal="true" aria-label="Eliminar cierre" tabindex="-1">
		<header class="ecm-head">
			<div>
				<h2>Eliminar el cierre de {cierre.placa}</h2>
				<p class="ecm-periodo">
					Periodo {String(mes).padStart(2, '0')}/{anio}
					{#if cierre.consecutivo}
						· {cierre.consecutivo}
					{/if}
					<span class="ecm-estado {claseBadgeEstado(cierre.estado)}">{cierre.estado}</span>
				</p>
			</div>
			<button class="ecm-x" onclick={onClose} disabled={enCurso} aria-label="Cerrar">×</button>
		</header>

		<div class="ecm-body">
			<ul class="ecm-lista">
				<li>La hoja sale del libro del periodo, con sus items y sus conceptos.</li>
				<li>Quien tenga este periodo abierto verá desaparecer la pestaña.</li>
				<li>
					<strong>Se marca, no se borra.</strong> Queda con fecha de eliminación y contabilidad
					puede recuperarla; no aparece en listados, totales ni PDF.
				</li>
			</ul>

			<label class="ecm-campo">
				<span>
					Escribe <strong>{cierre.placa}</strong> para confirmar
				</span>
				<input
					type="text"
					bind:value={confirmacion}
					disabled={enCurso}
					placeholder={cierre.placa}
					autocomplete="off"
					spellcheck="false"
					onkeydown={(e) => {
						if (e.key === 'Enter') confirmar();
					}}
				/>
			</label>
		</div>

		<footer class="ecm-foot">
			<button class="ecm-btn-ghost" onclick={onClose} disabled={enCurso}>Cancelar</button>
			<button class="ecm-btn-danger" onclick={confirmar} disabled={!puedeConfirmar}>
				{enCurso ? 'Eliminando…' : 'Eliminar cierre'}
			</button>
		</footer>
	</div>
</div>

<style>
	.ecm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 220;
		background: rgb(15 23 42 / 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.ecm {
		background: #fff;
		color: #0f172a;
		border-radius: 12px;
		width: 100%;
		max-width: 460px;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
	}

	.ecm-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1rem 1.15rem 0.75rem;
		border-bottom: 1px solid #e2e8f0;
	}

	.ecm-head h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
	}

	.ecm-periodo {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
		color: #64748b;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	/* Solo la geometría: el color lo pone `claseBadgeEstado` (Tailwind),
	   igual que `.gbm-estado` en «Generar borradores». */
	.ecm-estado {
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 9.5px;
		font-weight: 700;
		white-space: nowrap;
	}

	.ecm-x {
		background: none;
		border: none;
		font-size: 1.35rem;
		line-height: 1;
		color: #94a3b8;
		cursor: pointer;
		padding: 0 0.2rem;
	}

	.ecm-x:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.ecm-body {
		padding: 0.9rem 1.15rem;
	}

	.ecm-lista {
		margin: 0 0 1rem;
		padding-left: 1.1rem;
		font-size: 0.83rem;
		line-height: 1.5;
		color: #334155;
	}

	.ecm-lista li + li {
		margin-top: 0.35rem;
	}

	.ecm-campo {
		display: block;
		font-size: 0.8rem;
		color: #334155;
	}

	.ecm-campo input {
		margin-top: 0.35rem;
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		font-size: 0.9rem;
		font-family: inherit;
	}

	.ecm-campo input:focus {
		outline: none;
		border-color: #dc2626;
		box-shadow: 0 0 0 3px rgb(220 38 38 / 0.12);
	}

	.ecm-foot {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.75rem 1.15rem 1rem;
		border-top: 1px solid #e2e8f0;
	}

	.ecm-btn-ghost,
	.ecm-btn-danger {
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
	}

	.ecm-btn-ghost {
		background: #fff;
		border: 1px solid #cbd5e1;
		color: #334155;
	}

	.ecm-btn-danger {
		background: #dc2626;
		border: 1px solid #dc2626;
		color: #fff;
	}

	.ecm-btn-danger:disabled {
		background: #fca5a5;
		border-color: #fca5a5;
		cursor: not-allowed;
	}

	.ecm-btn-ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
