<script lang="ts">
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { confirmActual } from '$lib/stores/confirm';

	/// Único receptor de `confirmar()`: va montado una sola vez en el layout raíz.
	const actual = $derived($confirmActual);
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
	onconfirm={() => actual?.resolve(true)}
	oncancel={() => actual?.resolve(false)}
/>
