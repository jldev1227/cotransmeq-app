<script lang="ts">
	import {
		crearRegistroSeguimientoVacio,
		type RegistroSeguimientoForm
	} from '$lib/acciones-correctivas/constants';
	import SelectorEstadoAccion from './SelectorEstadoAccion.svelte';
	import BloqueReplanteo from './BloqueReplanteo.svelte';
	import { slide } from 'svelte/transition';
	import { accionesCorrectivasAPI } from '$lib/api/acciones-correctivas';
	import { toast } from 'svelte-sonner';

	export let titulo = 'Seguimiento a la acción planeada';
	export let registros: RegistroSeguimientoForm[] = [crearRegistroSeguimientoVacio()];
	export let tema: 'amber' | 'slate' | 'neutral' = 'neutral';
	export let maxRegistros = 12;
	export let onEstadoChange: () => void = () => {};

	const temaClasses = {
		neutral: {
			wrap: 'border-[var(--fm-border)] bg-[var(--fm-surface)]',
			header: 'text-[var(--fm-text)]',
			btn: 'bg-[var(--fm-text)] hover:bg-[var(--fm-text-secondary)]',
			card: 'border-[var(--fm-border)] bg-[var(--fm-bg)]'
		}
	};
	temaClasses.amber = temaClasses.neutral;
	temaClasses.slate = temaClasses.neutral;

	$: clases = temaClasses[tema];

	function agregarRegistro() {
		if (registros.length >= maxRegistros) return;
		registros = [...registros, crearRegistroSeguimientoVacio()];
	}

	async function handleFileUpload(index: number, event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		try {
			toast.loading('Subiendo archivo...', { id: 'uploading' });
			const result = await accionesCorrectivasAPI.uploadAdjunto(file);
			registros[index].adjunto_url = result.url;
			toast.success('Archivo subido correctamente', { id: 'uploading' });
		} catch (error) {
			toast.error('Error al subir archivo', { id: 'uploading' });
			console.error(error);
		}
	}

	function eliminarRegistro(index: number) {
		if (registros.length <= 1) return;
		registros = registros.filter((_, i) => i !== index);
	}
</script>

<div class="mt-4 rounded-[var(--fm-radius-lg)] border p-4 {clases.wrap}">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
		<h4 class="text-sm font-semibold {clases.header}">{titulo}</h4>
		{#if registros.length < maxRegistros}
			<button
				type="button"
				on:click={agregarRegistro}
				class="rounded-[var(--fm-radius)] px-3 py-1.5 text-xs font-medium text-white transition-colors {clases.btn}"
			>
				(+) Nuevo Registro de Seguimiento
			</button>
		{/if}
	</div>
	<p class="mb-3 text-xs text-[var(--fm-muted)]">
		Registre cada revisión (por ejemplo cada 15 días si sigue en proceso). El estado del último
		registro se usa como referencia actual.
	</p>

	<div class="space-y-3">
		{#each registros as registro, index}
			<div class="rounded-[var(--fm-radius-lg)] border p-3 {clases.card}">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-xs font-medium text-[var(--fm-text-secondary)]">Registro #{index + 1}</span>
					{#if registros.length > 1}
						<button
							type="button"
							on:click={() => eliminarRegistro(index)}
							class="text-xs text-red-600 hover:text-red-800"
						>
							Eliminar
						</button>
					{/if}
				</div>
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					<div>
						<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">Fecha de seguimiento</label>
						<input
							type="date"
							bind:value={registro.fecha_seguimiento}
							class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
						/>
					</div>
					<div class="grid grid-cols-1 gap-3 md:grid-cols-2 md:col-span-2">
						<div>
							<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">Nombre del responsable del seguimiento</label>
							<input
								type="text"
								bind:value={registro.responsable_seguimiento}
								class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
								placeholder="Nombre completo"
							/>
						</div>
						<div>
							<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">Cargo del responsable</label>
							<input
								type="text"
								bind:value={registro.cargo_responsable_seguimiento}
								class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
								placeholder="Cargo"
							/>
						</div>
					</div>
					<div class="md:col-span-2">
						<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">
							Descripción del estado / evidencias / observaciones
						</label>
						<textarea
							bind:value={registro.descripcion_observaciones}
							rows="2"
							class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
							placeholder="Gestiones realizadas, evidencias, implementación..."
						></textarea>
					</div>
					<div class="md:col-span-2">
						<label class="mb-2 block text-xs font-medium text-[var(--fm-text-secondary)]">
							Estado de la acción planeada
						</label>
						<SelectorEstadoAccion
							bind:value={registro.estado_accion}
							on:select={() => onEstadoChange()}
						/>

						{#if registro.estado_accion === 'Replanteada'}
							<div transition:slide>
								<BloqueReplanteo bind:replanteo={registro.replanteo} />
							</div>
						{/if}
					</div>

					<div class="md:col-span-2">
						<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]"> Adjunto / Evidencia </label>
						<div class="flex items-center gap-2">
							{#if registro.adjunto_url}
								<a
									href={registro.adjunto_url}
									target="_blank"
									class="flex flex-1 items-center gap-2 rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-xs text-[var(--fm-text-secondary)] hover:bg-[var(--fm-surface)]"
								>
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
									</svg>
									Ver documento adjunto
								</a>
								<button
									type="button"
									on:click={() => (registro.adjunto_url = undefined)}
									class="rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-bg)] p-2 text-red-600 hover:bg-red-50"
									title="Eliminar adjunto"
								>
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
									</svg>
								</button>
							{:else}
								<input
									type="file"
									on:change={(e) => handleFileUpload(index, e)}
									class="w-full text-xs text-[var(--fm-muted)] file:mr-4 file:rounded-[var(--fm-radius)] file:border-0 file:bg-[var(--fm-surface)] file:px-4 file:py-2 file:text-xs file:font-semibold file:text-[var(--fm-text)] hover:file:bg-[var(--fm-border)]"
								/>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/each}
	</div>
</div>
