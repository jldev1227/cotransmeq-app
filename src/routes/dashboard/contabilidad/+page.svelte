<script lang="ts">
	import { fade } from 'svelte/transition';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Conciliaciones from './Conciliaciones.svelte';
	import CertificadosAdmin from './certificados/CertificadosAdmin.svelte';

	let activeTab: 'conciliaciones' | 'certificados' = $state('conciliaciones');

	onMount(() => {
		const tabParam = $page.url.searchParams.get('tab');
		if (tabParam === 'certificados' || tabParam === 'conciliaciones') {
			activeTab = tabParam;
		}
	});

	function setTab(tab: 'conciliaciones' | 'certificados') {
		activeTab = tab;
		const url = new URL(window.location.href);
		url.searchParams.set('tab', tab);
		goto(url.toString(), { replaceState: true });
	}
</script>

<svelte:head>
	<title>Contabilidad · Cotransmeq</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col gap-4 p-6" in:fade={{ duration: 300 }}>
	<div
		class="glass soft-shadow flex flex-col gap-4 rounded-2xl border border-gray-200/50 p-5 lg:flex-row lg:items-center lg:justify-between"
	>
		<div class="flex items-center gap-4">
			<div
				class="soft-shadow flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600"
			>
				<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
					/>
				</svg>
			</div>
			<div>
				<div class="flex items-center gap-2">
					<h1 class="truncate text-xl font-bold text-gray-900">Contabilidad</h1>
					<span
						class="inline-flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700"
					>
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-500"></span>
						Activo
					</span>
				</div>
				<p class="mt-0.5 text-xs text-gray-500">Conciliaciones contables y gestión de certificados tributarios</p>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<button
				onclick={() => setTab('conciliaciones')}
				class="apple-transition flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold {activeTab ===
				'conciliaciones'
					? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-sm'
					: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
					/>
				</svg>
				Conciliaciones
			</button>
			<button
				onclick={() => setTab('certificados')}
				class="apple-transition flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold {activeTab ===
				'certificados'
					? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-sm'
					: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					/>
				</svg>
				Certificados Tributarios
			</button>
		</div>
	</div>

	<div class="flex-1 overflow-auto">
		{#if activeTab === 'conciliaciones'}
			<div in:fade={{ duration: 200 }}>
				<Conciliaciones />
			</div>
		{:else}
			<div in:fade={{ duration: 200 }} class="h-full">
				<CertificadosAdmin embedded={true} />
			</div>
		{/if}
	</div>
</div>
