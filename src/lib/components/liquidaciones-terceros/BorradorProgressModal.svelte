<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { createEventDispatcher } from 'svelte';
	import type { BorradorJob } from '$lib/stores/borradorQueue';
	import { borradorQueue } from '$lib/stores/borradorQueue';

	export let open = false;
	export let job: BorradorJob | null = null;

	const dispatch = createEventDispatcher();

	$: isLocked = job?.status === 'locked';
	$: isRunning = job?.status === 'running';
	$: isQueued = job?.status === 'queued';
	$: isComplete = job?.status === 'complete';
	$: isError = job?.status === 'error';
	$: isCancelled = job?.status === 'cancelled';
	$: isDismissible = isComplete || isError || isCancelled;

	function fmtDuration(ms: number) {
		const s = Math.floor(ms / 1000);
		const m = Math.floor(s / 60);
		const sec = s % 60;
		if (m > 0) return `${m}:${sec.toString().padStart(2, '0')}`;
		return `${sec}s`;
	}

	function fmtEta(progress: number, startedAt?: number) {
		if (!startedAt || progress <= 0 || progress >= 100) return '';
		const elapsed = Date.now() - startedAt;
		const total = Math.round(elapsed / (progress / 100));
		const remaining = Math.max(0, total - elapsed);
		const s = Math.floor(remaining / 1000);
		const m = Math.floor(s / 60);
		const sec = s % 60;
		if (m > 0) return `~${m}:${sec.toString().padStart(2, '0')}`;
		return `~${sec}s`;
	}

	function handleCancel() {
		borradorQueue.cancel();
	}

	function handleClose() {
		open = false;
		dispatch('close');
	}

	function handleBackdropClick() {
		if (isDismissible) handleClose();
	}
</script>

{#if open && job}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
		aria-hidden="true"
		on:click={handleBackdropClick}
		in:fade={{ duration: 200 }}
	>
		<div
			class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="borrador-modal-title"
			on:click|stopPropagation
			in:fly={{ y: 20, duration: 300 }}
		>
			<!-- Header -->
			<div class="mb-5 flex items-center gap-3">
				{#if isLocked}
					<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-orange-100">
						<svg class="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
						</svg>
					</div>
				{:else if isComplete}
					<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-orange-100">
						<svg class="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
					</div>
				{:else if isError}
					<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
						<svg class="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
						</svg>
					</div>
				{:else if isCancelled}
					<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-100">
						<svg class="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</div>
				{:else}
					<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-orange-100">
						<svg class="h-5 w-5 animate-spin text-orange-600" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
						</svg>
					</div>
				{/if}
				<div class="min-w-0 flex-1">
					<h2 id="borrador-modal-title" class="text-base font-bold text-gray-900">
						{#if isLocked}
							Borrador en progreso
						{:else if isComplete}
							Borrador generado
						{:else if isError}
							Error en la generación
						{:else if isCancelled}
							Generación cancelada
						{:else}
							Generando borrador
						{/if}
					</h2>
					<p class="mt-0.5 text-xs text-gray-500">
						{#if isLocked && job.lockedBy}
							{job.lockedBy.userName} está trabajando
						{:else if isRunning && job.startedAt}
							Procesando queries a la base de datos
							{#if job.progress > 0 && job.progress < 100}
								· ETA {fmtEta(job.progress, job.startedAt)}
							{/if}
						{:else if isQueued}
							Esperando turno en la cola del servidor
						{:else if isComplete}
							Redirigiendo al editor de liquidación
						{/if}
					</p>
				</div>
			</div>

			<!-- Body -->
			<div class="mb-5">
				{#if isLocked && job.lockedBy}
					<!-- Bloqueo por otro usuario -->
					<div class="rounded-xl border border-orange-200 bg-orange-50 p-4">
						<p class="text-sm font-semibold text-orange-900">
							{job.lockedBy.userName} está generando un borrador
						</p>
						<p class="mt-1 text-xs text-orange-700">
							Paso actual: <span class="font-medium">{job.lockedBy.currentStep}</span>
						</p>
						<div class="mt-3 h-2 overflow-hidden rounded-full bg-orange-200">
							<div
								class="h-full rounded-full bg-orange-500 transition-all duration-500"
								style="width: {job.lockedBy.progress}%"
							></div>
						</div>
						<p class="mt-2 text-[10px] text-orange-600">
							Esta restricción evita que el backend se sature con múltiples generaciones simultáneas. Espera a que termine.
						</p>
					</div>
				{:else if isComplete}
					<!-- Completado -->
					<div class="rounded-xl border border-orange-200 bg-orange-50 p-4">
						<p class="text-sm font-semibold text-orange-900">Borrador listo</p>
						<p class="mt-1 text-xs text-orange-700">
							La liquidación se generó correctamente. Serás redirigido al editor en unos segundos.
						</p>
					</div>
				{:else if isError}
					<!-- Error -->
					<div class="rounded-xl border border-red-200 bg-red-50 p-4">
						<p class="text-sm font-semibold text-red-900">Error durante la generación</p>
						<p class="mt-1 text-xs text-red-700">{job.error || 'Error desconocido'}</p>
					</div>
				{:else if isCancelled}
					<!-- Cancelado -->
					<div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
						<p class="text-sm font-semibold text-gray-900">Generación cancelada</p>
						<p class="mt-1 text-xs text-gray-600">Puedes intentar de nuevo cuando quieras.</p>
					</div>
				{:else}
					<!-- En progreso (queued o running) -->
					<div class="space-y-3">
						<div>
							<div class="mb-1.5 flex items-center justify-between">
								<span class="text-xs font-medium text-gray-700">{job.currentStep}</span>
								<span class="font-mono text-xs font-bold text-orange-700">{job.progress}%</span>
							</div>
							<div class="h-2.5 overflow-hidden rounded-full bg-orange-100">
								<div
									class="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-600 transition-all duration-500 ease-out"
									style="width: {job.progress}%"
								></div>
							</div>
						</div>

						{#if job.total > 0}
							<div class="flex items-center justify-between text-[10px] text-gray-500">Procesando liquidación...</div>
						{:else if isQueued}
							<p class="text-center text-[10px] text-gray-500">En cola, esperando turno...</p>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-end gap-2">
				{#if isDismissible}
					<button
						type="button"
						class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-orange-600 hover:to-orange-700"
						on:click={handleClose}
					>
						Entendido
					</button>
				{:else if isLocked}
					<button
						type="button"
						class="apple-transition rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
						on:click={handleClose}
					>
						Cerrar
					</button>
				{:else}
					<button
						type="button"
						class="apple-transition rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
						on:click={handleCancel}
					>
						Cancelar generación
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
