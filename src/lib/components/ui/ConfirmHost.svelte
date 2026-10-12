<script lang="ts">
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { confirmActual } from '$lib/stores/confirm';

	/// Único receptor de `confirmar()` y `pedirTexto()`: va montado una sola vez
	/// en el layout raíz.
	const actual = $derived($confirmActual);
	const entrada = $derived(actual?.entrada);

	let texto = $state('');

	/// Cada diálogo arranca con su propio valor inicial, no con lo que se
	/// escribió en el anterior.
	$effect(() => {
		texto = actual?.entrada?.valorInicial ?? '';
	});

	const faltaTexto = $derived(!!entrada && entrada.requerido !== false && !texto.trim());

	function aceptar() {
		if (faltaTexto) return;
		actual?.resolve(true, entrada ? texto : undefined);
	}

	/// El diálogo enfoca su botón principal al abrir; aquí el foco tiene que
	/// quedar en el campo, así que se pide en el cuadro siguiente.
	function enfocar(nodo: HTMLTextAreaElement) {
		requestAnimationFrame(() => nodo.focus());
	}

	/// Enter escribe un salto de línea (un motivo puede tener varias);
	/// Ctrl/⌘+Enter acepta sin ir al mouse.
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			aceptar();
		}
	}
</script>

<ConfirmDialog
	open={actual !== null}
	title={actual?.title ?? ''}
	message={actual?.message}
	tone={actual?.tone}
	eyebrow={actual?.eyebrow}
	mascot={actual?.mascot}
	confirmText={actual?.confirmText ?? (actual?.cancelText === null ? 'Entendido' : 'Confirmar')}
	cancelText={actual?.cancelText === undefined ? 'Cancelar' : actual.cancelText}
	confirmDisabled={faltaTexto}
	closeOnBackdrop={!entrada}
	onconfirm={aceptar}
	oncancel={() => actual?.resolve(false)}
>
	{#if entrada}
		<label class="ch-campo">
			<span class="ch-etiqueta">{entrada.label}</span>
			<textarea
				class="ch-texto"
				rows="3"
				bind:value={texto}
				placeholder={entrada.placeholder}
				maxlength={entrada.maxLength}
				use:enfocar
				onkeydown={onKeydown}
			></textarea>
		</label>
	{/if}
</ConfirmDialog>

<style>
	.ch-campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ch-etiqueta {
		color: var(--bg-charcoal-deep);
		font-size: 13px;
		font-weight: 700;
	}
	.ch-texto {
		width: 100%;
		min-height: 84px;
		padding: 10px 12px;
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
		background: #fff;
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		line-height: 1.45;
		resize: vertical;
	}
	.ch-texto:focus {
		outline: none;
		border-color: var(--emerald-500);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--emerald-500) 22%, transparent);
	}
</style>
