<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { liquidacionesTercerosDescuentosAPI } from '$lib/api/liquidaciones-terceros-descuentos';
	import UsuarioBadge from '$lib/components/common/UsuarioBadge.svelte';
	import DiffSnapshotModal from './DiffSnapshotModal.svelte';

	export let open = false;
	export let liquidacionId = '';
	export let currentVersion = 0;

	let snapshots: Array<{
		id: string;
		version: number;
		rama: string;
		origen: string;
		revertido_de_id: string | null;
		usuario: { id: string; nombre: string; correo: string } | null;
		created_at: string;
		diff: any;
		meta: any;
	}> = [];
	let loading = false;
	let showDiff = false;
	let diffSnapA = '';
	let diffSnapB = '';
	let reverting = false;

	$: if (open && liquidacionId) loadSnapshots();

	async function loadSnapshots() {
		loading = true;
		try {
			snapshots = await liquidacionesTercerosDescuentosAPI.listarSnapshots(liquidacionId);
		} catch (e) {
			console.error('Error loading snapshots:', e);
		} finally {
			loading = false;
		}
	}

	function fmtDate(d: string) {
		const date = new Date(d);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMin = Math.floor(diffMs / 60000);
		const diffHr = Math.floor(diffMs / 3600000);
		const diffDay = Math.floor(diffMs / 86400000);

		if (diffMin < 1) return 'Ahora mismo';
		if (diffMin < 60) return `hace ${diffMin} min`;
		if (diffHr < 24) return `hace ${diffHr}h`;
		if (diffDay < 7) return `hace ${diffDay}d`;
		return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	function fmtDateFull(d: string) {
		return new Date(d).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function origenLabel(o: string) {
		const map: Record<string, { label: string; icon: string }> = {
			manual: { label: 'Cambio manual', icon: '✏️' },
			auto: { label: 'Automático (cron)', icon: '⏰' },
			revert: { label: 'Revertido', icon: '↩️' }
		};
		return map[o] || { label: o, icon: '📋' };
	}

	function openDiff(idx: number) {
		const mainSnap = snapshots.find((s) => s.version === currentVersion);
		const targetSnap = snapshots[idx];
		if (!mainSnap || !targetSnap) return;
		diffSnapA = targetSnap.id;
		diffSnapB = mainSnap.id;
		showDiff = true;
	}

	async function revertir(snapshot: typeof snapshots[number]) {
		if (
			!confirm(
				`¿Revertir a la versión ${snapshot.version}? Esto restaurará el estado de ese momento.`
			)
		)
			return;
		reverting = true;
		try {
			await liquidacionesTercerosDescuentosAPI.revertirASnapshot(liquidacionId, snapshot.id);
			open = false;
			window.location.reload();
		} catch (e: any) {
			alert(e.message || 'Error al revertir');
		} finally {
			reverting = false;
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[9500] flex items-center justify-center bg-[rgba(15,31,26,0.45)] backdrop-blur-sm"
		on:click={() => (open = false)}
		role="presentation"
	>
		<div
			class="confirm-card flex w-full max-w-lg flex-col"
			style="max-height:80vh;padding:0"
			on:click|stopPropagation
			role="dialog"
			aria-modal="true"
			aria-labelledby="historial-versiones-title"
			in:fly={{ y: 20, duration: 400, easing: quintOut }}
		>
			<!-- Header — eyebrow + Fraunces title -->
			<div
				class="flex items-start justify-between gap-3 border-b border-[rgba(0,0,0,0.06)] px-6 pb-4 pt-6"
			>
				<div class="flex items-start gap-3.5">
					<div
						class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
						style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;box-shadow:0 4px 16px rgba(139,92,246,0.30)"
					>
						<svg
							class="h-5 w-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
					<div class="min-w-0">
						<span class="eyebrow" style="background:rgba(139,92,246,0.10);color:#6d28d9"
							>Trazabilidad</span
						>
						<h3
							id="historial-versiones-title"
							class="font-display mt-1.5 text-[18px] text-[#0f1f1a]"
							style="line-height:1.2"
						>
							Historial de Versiones
						</h3>
						<p class="text-[12px] text-[#6b6b6b]">
							Cambios registrados sobre esta liquidación
						</p>
					</div>
				</div>
				<button
					class="filter-close flex-shrink-0"
					aria-label="Cerrar"
					on:click={() => (open = false)}
				>
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"
						><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
					>
				</button>
			</div>

			<!-- Body -->
			<div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
				{#if loading}
					<div class="flex flex-col items-center justify-center py-12">
						<div
							class="spinner"
							style="width:32px;height:32px;border-width:3px;border-color:rgba(139,92,246,0.2);border-top-color:#6d28d9"
						></div>
						<p class="mt-3 text-[12px] text-[#6b6b6b]">Cargando historial…</p>
					</div>
				{:else if snapshots.length === 0}
					<div class="flex flex-col items-center justify-center py-12 text-center">
						<div
							class="flex h-12 w-12 items-center justify-center rounded-xl"
							style="background:rgba(0,0,0,0.04);color:#9a9a9a"
						>
							<svg
								class="h-6 w-6"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						</div>
						<p class="font-display mt-3 text-[16px] text-[#0f1f1a]">Sin historial</p>
						<p class="text-[12px] text-[#6b6b6b]">
							Los snapshots se generan con cada cambio
						</p>
					</div>
				{:else}
					<div class="space-y-2.5">
						{#each snapshots as snap, idx}
							{@const oInfo = origenLabel(snap.origen)}
							{@const isCurrent = snap.version === currentVersion}
							<div
								class="apple-transition group relative flex items-start gap-3 rounded-xl border border-[rgba(0,0,0,0.06)] bg-white p-3.5 hover:border-[rgba(139,92,246,0.30)] hover:bg-[rgba(139,92,246,0.04)]"
							>
								<!-- Timeline dot -->
								<div class="mt-1 flex flex-col items-center">
									<div
										class="h-2.5 w-2.5 flex-shrink-0 rounded-full"
										style="background:{isCurrent
											? 'linear-gradient(135deg,#8b5cf6,#6d28d9)'
											: 'rgba(0,0,0,0.15)'};{isCurrent
											? 'box-shadow:0 0 0 3px rgba(139,92,246,0.18)'
											: ''}"
									></div>
									{#if idx < snapshots.length - 1}
										<div
											class="mt-1 w-px flex-1"
											style="background:linear-gradient(180deg,rgba(0,0,0,0.10),rgba(0,0,0,0.04));min-height:18px"
										></div>
									{/if}
								</div>

								<!-- Content -->
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-2">
										<span
											class="font-mono text-[10.5px] font-bold"
											style="color:#1a1a1a;background:rgba(0,0,0,0.05);padding:2px 7px;border-radius:5px;letter-spacing:0.04em"
										>
											v{snap.version}
										</span>
										{#if isCurrent}
											<span
												class="font-mono-meta"
												style="background:rgba(139,92,246,0.10);color:#6d28d9;padding:2px 8px;border-radius:999px;font-size:9px"
												>Actual</span
											>
										{/if}
										<span class="text-[11px] text-[#6b6b6b]">
											{oInfo.icon}
											{oInfo.label}
										</span>
									</div>

									<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
										{#if snap.usuario}
											<UsuarioBadge
												nombre={snap.usuario.nombre}
												correo={snap.usuario.correo}
											/>
										{:else}
											<span class="text-[11px] text-[#9a9a9a] italic">Sistema (cron)</span>
										{/if}
										<span
											class="font-mono text-[10.5px] text-[#9a9a9a]"
											style="letter-spacing:0.02em"
											title={fmtDateFull(snap.created_at)}
										>
											{fmtDate(snap.created_at)}
										</span>
									</div>

									{#if snap.diff && snap.diff.length > 0}
										<div class="mt-2 inline-flex items-center gap-1.5">
											<span
												class="h-1.5 w-1.5 rounded-full"
												style="background:#b45309"
											></span>
											<span
												class="font-mono text-[10.5px] font-semibold"
												style="color:#b45309;letter-spacing:0.04em"
											>
												{snap.diff.length} cambio{snap.diff.length === 1 ? '' : 's'}
											</span>
										</div>
									{/if}
								</div>

								<!-- Actions -->
								<div
									class="flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
								>
									<button
										class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(139,92,246,0.08)] hover:text-[#6d28d9]"
										title="Ver diff contra versión actual"
										on:click={() => openDiff(idx)}
									>
										<svg
											class="h-3.5 w-3.5"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											stroke-width="1.8"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
											/>
										</svg>
									</button>
									{#if !isCurrent && snap.origen !== 'auto'}
										<button
											class="apple-transition rounded-md p-1.5 text-[#9a9a9a] hover:bg-[rgba(245,158,11,0.10)] hover:text-[#b45309]"
											title="Revertir a esta versión"
											on:click={() => revertir(snap)}
											disabled={reverting}
										>
											<svg
												class="h-3.5 w-3.5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												stroke-width="1.8"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
												/>
											</svg>
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if showDiff}
	<DiffSnapshotModal
		open={showDiff}
		snapshotIdA={diffSnapA}
		snapshotIdB={diffSnapB}
		on:close={() => (showDiff = false)}
	/>
{/if}
