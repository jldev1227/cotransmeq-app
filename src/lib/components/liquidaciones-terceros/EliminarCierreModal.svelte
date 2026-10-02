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

	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
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

	/// El foco va al campo de la placa: el botón de confirmar arranca
	/// deshabilitado y no puede recibirlo.
	let campo = $state<HTMLInputElement | null>(null);
	$effect(() => {
		campo?.focus();
	});
</script>

<!--
	El fondo no cierra: el mismo criterio que en «Generar borradores». Un clic
	despistado no debe poder ni lanzar ni cancelar una operación de este peso.
-->
<ConfirmDialog
	open
	title={`¿Eliminar el cierre de ${cierre.placa}?`}
	tone="danger"
	eyebrow="ELIMINAR CIERRE"
	confirmText="Eliminar cierre"
	loadingText="Eliminando…"
	loading={enCurso}
	confirmDisabled={!puedeConfirmar}
	closeOnBackdrop={false}
	onconfirm={confirmar}
	oncancel={onClose}
>
	<p class="ecm-periodo">
		Periodo {String(mes).padStart(2, '0')}/{anio}
		{#if cierre.consecutivo}
			· {cierre.consecutivo}
		{/if}
		<span class="ecm-estado {claseBadgeEstado(cierre.estado)}">{cierre.estado}</span>
	</p>

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
			bind:this={campo}
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
</ConfirmDialog>

<style>
	.ecm-periodo {
		margin: 0;
		font-size: 13px;
		color: var(--text-muted);
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

	.ecm-lista {
		margin: 0;
		padding-left: 1.1rem;
		list-style: disc;
		font-size: 14px;
		line-height: 21px;
		color: var(--text-muted);
	}

	.ecm-lista li + li {
		margin-top: 0.35rem;
	}

	.ecm-campo {
		display: block;
		font-size: 13px;
		color: var(--text-primary);
	}

	.ecm-campo input {
		margin-top: 0.4rem;
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		font-size: 15px;
		font-family: inherit;
	}

	.ecm-campo input:focus {
		outline: none;
		border-color: #b42318;
		box-shadow: 0 0 0 3px rgb(180 35 24 / 0.12);
	}
</style>
