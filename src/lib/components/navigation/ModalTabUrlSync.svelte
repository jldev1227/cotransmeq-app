<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	interface Props {
		modalRef: string;
		tabs: string[];
		active: string;
		defaultTab?: string;
	}

	let { modalRef, tabs, active = $bindable(), defaultTab }: Props = $props();
	let inicializado = false;
	let aplicandoURL = false;
	let ultimaURL = '';

	function aplicarPestana(url: URL) {
		ultimaURL = url.href;
		if (url.searchParams.get('modal') !== modalRef) return;
		const tabSolicitada = url.searchParams.get('modalTab');
		const tab = tabSolicitada && tabs.includes(tabSolicitada) ? tabSolicitada : defaultTab ?? tabs[0];
		if (tab && tab !== active) {
			aplicandoURL = true;
			active = tab;
			queueMicrotask(() => (aplicandoURL = false));
		}
	}

	afterNavigate(({ to }) => {
		const url = to?.url ?? page.url;
		ultimaURL = url.href;
		if (inicializado) aplicarPestana(url);
	});

	onMount(() => {
		const url = new URL(window.location.href);
		ultimaURL = url.href;
		aplicarPestana(url);
		inicializado = true;
	});

	$effect(() => {
		const pestana = active;
		const tabsValidas = tabs;
		const valorPorDefecto = defaultTab ?? tabsValidas[0];
		const url = page.url;
		if (!inicializado || aplicandoURL || url.href !== ultimaURL) return;
		if (url.searchParams.get('modal') !== modalRef || !tabsValidas.includes(pestana)) return;
		const actual = url.searchParams.get('modalTab') ?? valorPorDefecto;
		if (actual === pestana) return;

		const destino = new URL(url.href);
		if (pestana === valorPorDefecto) destino.searchParams.delete('modalTab');
		else destino.searchParams.set('modalTab', pestana);
		ultimaURL = destino.href;
		void goto(destino.href, {
			replaceState: true,
			noScroll: true,
			keepFocus: true,
			invalidateAll: false
		}).catch(() => (ultimaURL = page.url.href));
	});
</script>
