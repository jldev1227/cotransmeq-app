<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import {
		escribirReferenciaModalURL,
		leerReferenciaModalURL,
		mismaReferenciaModal,
		type ReferenciaModalURL
	} from '$lib/navigation/modal-url';

	export interface EstadoModalURL extends Omit<ReferenciaModalURL, 'key'> {
	key: string;
	open: boolean;
}

	interface Props {
		referencias: EstadoModalURL[];
		onCambio: (referencia: ReferenciaModalURL | null) => void;
	}

	let { referencias, onCambio }: Props = $props();
	let inicializado = false;
	let aplicandoURL = false;
	let ultimaURL = '';
	let referenciaAnterior: ReferenciaModalURL | null = null;

	function referenciaActiva(): ReferenciaModalURL | null {
		let estado: EstadoModalURL | undefined;
		for (const referencia of referencias) {
			if (referencia.open) estado = referencia;
		}
		if (!estado) return null;
		return {
			key: estado.key,
			...(estado.id ? { id: estado.id } : {}),
			...(estado.ids?.length ? { ids: estado.ids } : {}),
			...(estado.tab ? { tab: estado.tab } : {})
		};
	}

	function aplicarURL(url: URL) {
		const referencia = leerReferenciaModalURL(url);
		const destino = referencia && referencias.some((item) => item.key === referencia.key) ? referencia : null;
		ultimaURL = url.href;
		if (mismaReferenciaModal(referenciaActiva(), destino)) return;
		aplicandoURL = true;
		onCambio(destino);
		queueMicrotask(() => (aplicandoURL = false));
	}

	afterNavigate(({ to }) => {
		const url = to?.url ?? page.url;
		ultimaURL = url.href;
		if (inicializado) aplicarURL(url);
	});

	onMount(() => {
		const url = new URL(window.location.href);
		ultimaURL = url.href;
		aplicarURL(url);
		inicializado = true;
	});

	$effect(() => {
		const referencia = referenciaActiva();
		const url = page.url;
		if (!inicializado || aplicandoURL || url.href !== ultimaURL) return;
		const actual = leerReferenciaModalURL(url);
		if (mismaReferenciaModal(actual, referencia)) return;
		if (
			referencia &&
			actual?.key === referencia.key &&
			actual.id === referencia.id &&
			actual.ids?.join(',') === referencia.ids?.join(',') &&
			referencia.tab === undefined
		) return;

		const destino = escribirReferenciaModalURL(url, referencia);
		if (destino.href === url.href) return;
		const reemplazar =
			!referencia ||
			(referenciaAnterior?.key === referencia.key &&
				referenciaAnterior.id === referencia.id &&
				referenciaAnterior.ids?.join(',') === referencia.ids?.join(','));
		referenciaAnterior = referencia;
		ultimaURL = destino.href;
		void goto(destino.href, {
			replaceState: reemplazar,
			noScroll: true,
			keepFocus: true,
			invalidateAll: false
		}).catch(() => (ultimaURL = page.url.href));
	});
</script>
