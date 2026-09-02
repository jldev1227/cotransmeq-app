<script lang="ts">
	import { fly, fade, scale } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { toast } from 'svelte-sonner';
	import { diasLaboradosAPI } from '$lib/api/apiClient';

	export interface RegistroParaEliminar {
		id: string;
		fecha: string;
		tipo: 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';
		observaciones: string | null;
		segmentos_count: number;
		conductor: { id: string; nombre: string; apellido: string; numero_identificacion: string } | null;
	}

	type Props = {
		open: boolean;
		registro: RegistroParaEliminar | null;
		onclose: () => void;
		onsaved?: () => void;
	};

	let { open, registro, onclose, onsaved }: Props = $props();

	let procesando = $state<boolean>(false);
	let errorMsg = $state<string>('');

	$effect(() => {
		if (open) {
			errorMsg = '';
		}
	});

	const conductorLabel = $derived(
		registro?.conductor
			? `${registro.conductor.nombre} ${registro.conductor.apellido}`
			: '—'
	);

	const tipoLabel: Record<string, string> = {
		LABORADO: 'Día laborado',
		DISPONIBLE: 'Disponible',
		DESCANSO: 'Descanso',
		MANTENIMIENTO: 'Mantenimiento'
	};

	const tipoColor: Record<string, string> = {
		LABORADO: '#ea580c',
		DISPONIBLE: '#2563eb',
		DESCANSO: '#d97706',
		MANTENIMIENTO: '#dc2626'
	};

	async function confirmar() {
		if (!registro) return;
		procesando = true;
		errorMsg = '';
		try {
			const res = await diasLaboradosAPI.eliminarRegistro(registro.id);
			if (res.data?.success) {
				toast.success('Día eliminado');
				onsaved?.();
				onclose();
			} else {
				errorMsg = res.data?.message || 'No se pudo eliminar';
			}
		} catch (err: any) {
			errorMsg = err?.response?.data?.message || err?.message || 'Error al eliminar';
		} finally {
			procesando = false;
		}
	}

	function handleEscape(e: KeyboardEvent) {
		if (e.key === 'Escape' && open && !procesando) onclose();
	}

	$effect(() => {
		if (!browser) return;
		if (open) {
			document.addEventListener('keydown', handleEscape);
			return () => document.removeEventListener('keydown', handleEscape);
		}
	});
</script>

{#if open && registro}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(4px);"
		onclick={() => !procesando && onclose()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="modal-eliminar-registro-title"
		tabindex="-1"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			role="document"
			in:fly={{ y: 12, duration: 280 }}
			out:scale={{ duration: 150, start: 0.98 }}
		>
			<!-- Header -->
			<header class="flex items-start gap-3 px-5 py-4" style="background: #fef2f2;">
				<div
					class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
					style="background: linear-gradient(135deg, #dc2626, #b91c1c); box-shadow: 0 4px 12px rgba(220,38,38,0.25);"
				>
					<svg
						class="h-5 w-5 text-white"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<p
						class="font-mono text-[10px] font-semibold uppercase tracking-wider"
						style="color: #b91c1c;"
					>
						Eliminar día completo
					</p>
					<h2
						id="modal-eliminar-registro-title"
						class="font-display text-base"
						style="color: var(--bg-charcoal); font-weight: 500;"
					>
						{conductorLabel}
					</h2>
					<p class="mt-0.5 text-[11px]" style="color: var(--text-muted);">
						{registro.fecha}
					</p>
				</div>
				<button
					type="button"
					onclick={onclose}
					disabled={procesando}
					class="apple-transition flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-700 disabled:opacity-50"
					aria-label="Cerrar"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</header>

			<!-- Body -->
			<div class="px-5 py-4">
				<div
					class="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px]"
					style="color: var(--text-secondary);"
				>
					<dl class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
						<dt
							class="text-[10px] uppercase tracking-wide"
							style="color: var(--text-muted);"
						>
							Tipo
						</dt>
						<dd class="flex items-center gap-1.5 font-semibold" style="color: var(--text-primary);">
							<span
								class="h-2 w-2 rounded-full"
								style:background-color={tipoColor[registro.tipo] || '#9ca3af'}
							></span>
							{tipoLabel[registro.tipo] || registro.tipo}
						</dd>

						{#if registro.segmentos_count > 0}
							<dt
								class="text-[10px] uppercase tracking-wide"
								style="color: var(--text-muted);"
							>
								Tramos
							</dt>
							<dd style="color: var(--text-primary);">
								{registro.segmentos_count} tramo{registro.segmentos_count === 1 ? '' : 's'}
							</dd>
						{/if}

						{#if registro.observaciones}
							<dt
								class="text-[10px] uppercase tracking-wide"
								style="color: var(--text-muted);"
							>
								Obs.
							</dt>
							<dd class="italic" style="color: var(--text-primary);">
								{registro.observaciones}
							</dd>
						{/if}
					</dl>
				</div>

				<div
					class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px]"
					style="color: #92400e;"
				>
					<svg
						class="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
						/>
					</svg>
					<p>
						Se marcará el día y {registro.segmentos_count > 0
							? `sus ${registro.segmentos_count} tramo${registro.segmentos_count === 1 ? '' : 's'}`
							: 'todos sus tramos'} como <strong>eliminados</strong> (soft delete). No se borra
						físicamente de la base de datos, pero dejarán de verse en el canvas de Recorridos y
						en el calendario. Los bonos asociados también se ocultan.
					</p>
				</div>

				{#if errorMsg}
					<div
						class="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700"
						role="alert"
					>
						<svg
							class="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
							/>
						</svg>
						<p>{errorMsg}</p>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<footer
				class="flex flex-shrink-0 items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3"
			>
				<button
					type="button"
					onclick={onclose}
					disabled={procesando}
					class="apple-transition rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
				>
					Cancelar
				</button>
				<button
					type="button"
					onclick={confirmar}
					disabled={procesando}
					class="apple-transition inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
					style="background: linear-gradient(135deg, #dc2626, #b91c1c); box-shadow: 0 2px 6px rgba(220,38,38,0.25);"
				>
					{#if procesando}
						<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
							<path
								d="M4 12a8 8 0 018-8v0"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
							/>
						</svg>
						Eliminando…
					{:else}
						<svg
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
						Sí, eliminar día
					{/if}
				</button>
			</footer>
		</div>
	</div>
{/if}
