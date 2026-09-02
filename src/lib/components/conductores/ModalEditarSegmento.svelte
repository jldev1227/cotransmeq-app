<script lang="ts">
	import { fly, fade, scale } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { diasLaboradosAPI, type SegmentoPatron } from '$lib/api/apiClient';
	import TimePicker from '$lib/components/TimePicker.svelte';

	export interface SegmentoEditable {
		id: string;
		registro_dia_id: string;
		cliente_id: string | null;
		cliente_nombre: string | null;
		vehiculo_id: string | null;
		vehiculo_placa: string | null;
		hora_inicio: string | null;
		hora_fin: string | null;
		inicio_dia_siguiente?: boolean;
		fin_dia_siguiente?: boolean;
		horas_conducidas: number | null;
		km_inicial: number | null;
		km_final: number | null;
		pernocte: boolean;
		orden: number;
		observaciones: string | null;
	}

	export interface RegistroContexto {
		id: string;
		fecha: string;
		tipo: 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';
		conductor: { id: string; nombre: string; apellido: string; numero_identificacion: string } | null;
	}

	type Props = {
		open: boolean;
		segmento: SegmentoEditable | null;
		registro: RegistroContexto | null;
		onclose: () => void;
		onsaved?: (segmentoActualizado: any) => void;
	};

	let { open, segmento, registro, onclose, onsaved }: Props = $props();

	// Estado del formulario
	let clienteId = $state<string | null>(null);
	let clienteNombre = $state<string>('');
	let vehiculoId = $state<string | null>(null);
	let vehiculoPlaca = $state<string>('');
	let horaInicio = $state<string>('');
	let horaFin = $state<string>('');
	let inicioDiaSiguiente = $state<boolean>(false);
	let finDiaSiguiente = $state<boolean>(false);
	let horasConducidas = $state<number>(0);
	let kmInicial = $state<number | null>(null);
	let kmFinal = $state<number | null>(null);
	let pernocte = $state<boolean>(false);
	let observaciones = $state<string>('');
	let guardando = $state<boolean>(false);
	let errorMsg = $state<string>('');

	// Catálogos
	let clientes = $state<Array<{ id: string; nombre: string; nit?: string }>>([]);
	let vehiculos = $state<Array<{ id: string; placa: string; marca?: string; linea?: string }>>([]);
	let loadingCatalogos = $state<boolean>(false);

	function cargarCatalogos() {
		loadingCatalogos = true;
		Promise.all([
			diasLaboradosAPI.listarClientes().catch(() => ({ data: { data: [] } })),
			diasLaboradosAPI.listarVehiculos().catch(() => ({ data: { data: [] } }))
		])
			.then(([rC, rV]) => {
				clientes = (rC.data?.data ?? []) as any;
				vehiculos = (rV.data?.data ?? []) as any;
			})
			.finally(() => {
				loadingCatalogos = false;
			});
	}

	function hidratarFormulario() {
		if (!segmento) return;
		clienteId = segmento.cliente_id ?? null;
		clienteNombre = segmento.cliente_nombre ?? '';
		vehiculoId = segmento.vehiculo_id ?? null;
		vehiculoPlaca = segmento.vehiculo_placa ?? '';
		horaInicio = segmento.hora_inicio ?? '';
		horaFin = segmento.hora_fin ?? '';
		inicioDiaSiguiente = segmento.inicio_dia_siguiente ?? false;
		finDiaSiguiente = segmento.fin_dia_siguiente ?? false;
		horasConducidas = Number(segmento.horas_conducidas) || 0;
		kmInicial = segmento.km_inicial ?? null;
		kmFinal = segmento.km_final ?? null;
		pernocte = segmento.pernocte ?? false;
		observaciones = segmento.observaciones ?? '';
		errorMsg = '';
	}

	$effect(() => {
		if (open) {
			hidratarFormulario();
			if (clientes.length === 0 && vehiculos.length === 0) cargarCatalogos();
		}
	});

	function onClienteChange(id: string) {
		clienteId = id || null;
		if (id) {
			const c = clientes.find((x) => x.id === id);
			if (c) clienteNombre = c.nombre;
		}
	}

	function onVehiculoChange(id: string) {
		vehiculoId = id || null;
		if (id) {
			const v = vehiculos.find((x) => x.id === id);
			if (v) vehiculoPlaca = v.placa;
		}
	}

	function validar(): string | null {
		if (kmInicial != null && kmFinal != null && kmFinal < kmInicial) {
			return 'KM final debe ser mayor o igual a KM inicial';
		}
		if (horaInicio && horaFin) {
			const toMins = (h: string, next: boolean) =>
				h.split(':').reduce((a, v) => a * 60 + Number(v), 0) + (next ? 24 * 60 : 0);
			const inicioMins = toMins(horaInicio, inicioDiaSiguiente);
			const finMins = toMins(horaFin, finDiaSiguiente);
			if (finMins <= inicioMins) {
				return 'Hora fin debe ser posterior a hora inicio (usa el +1 si cruza medianoche)';
			}
		}
		if (horasConducidas < 0 || horasConducidas > 24) {
			return 'Horas conducidas debe estar entre 0 y 24';
		}
		return null;
	}

	async function guardar() {
		if (!segmento) return;
		const err = validar();
		if (err) {
			errorMsg = err;
			return;
		}
		errorMsg = '';
		guardando = true;
		try {
			const payload: Partial<SegmentoPatron> & {
				inicio_dia_siguiente?: boolean;
				fin_dia_siguiente?: boolean;
			} = {
				cliente_id: clienteId,
				cliente_nombre: clienteNombre || null,
				vehiculo_id: vehiculoId,
				vehiculo_placa: vehiculoPlaca || null,
				hora_inicio: horaInicio || null,
				hora_fin: horaFin || null,
				inicio_dia_siguiente: inicioDiaSiguiente,
				fin_dia_siguiente: finDiaSiguiente,
				horas_conducidas: horasConducidas,
				km_inicial: kmInicial,
				km_final: kmFinal,
				pernocte,
				observaciones: observaciones || null
			};
			const res = await diasLaboradosAPI.editarSegmento(segmento.id, payload);
			if (res.data?.success) {
				toast.success('Recorrido actualizado');
				onsaved?.(res.data.data);
				onclose();
			} else {
				errorMsg = res.data?.message || 'No se pudo actualizar';
			}
		} catch (err: any) {
			errorMsg = err?.response?.data?.message || err?.message || 'Error al guardar';
		} finally {
			guardando = false;
		}
	}

	function handleEscape(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) onclose();
	}

	$effect(() => {
		if (!browser) return;
		if (open) {
			document.addEventListener('keydown', handleEscape);
			return () => document.removeEventListener('keydown', handleEscape);
		}
	});

	const conductorLabel = $derived(
		registro?.conductor
			? `${registro.conductor.nombre} ${registro.conductor.apellido}`
			: '—'
	);

	const fechaLabel = $derived(registro?.fecha ?? '');
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(4px);"
		onclick={onclose}
		onkeydown={(e) => e.key === 'Enter' && guardar()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="modal-editar-segmento-title"
		tabindex="-1"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			role="document"
			in:fly={{ y: 12, duration: 280 }}
			out:scale={{ duration: 150, start: 0.98 }}
		>
			<!-- Header -->
			<header
				class="flex flex-shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-5 py-4"
				style="background: linear-gradient(135deg, #f0fdf4, #d1fae5);"
			>
				<div class="flex items-start gap-3">
					<div
						class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
						style="background: linear-gradient(135deg, #ea580c, #c2410c); box-shadow: 0 4px 12px rgba(249, 115, 22,0.25);"
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
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							/>
						</svg>
					</div>
					<div>
						<p
							class="font-mono text-[10px] font-semibold uppercase tracking-wider"
							style="color: #c2410c;"
						>
							Editar recorrido
						</p>
						<h2
							id="modal-editar-segmento-title"
							class="font-display text-lg"
							style="color: var(--bg-charcoal); font-weight: 500;"
						>
							{conductorLabel}
						</h2>
						<p class="mt-0.5 text-[11px]" style="color: var(--text-muted);">
							{fechaLabel} · Tramo #{segmento?.orden ?? '—'}
						</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onclose}
					class="apple-transition flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-700"
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
			<div class="flex-1 overflow-y-auto px-5 py-4">
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<!-- Placa -->
					<label class="block">
						<span
							class="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
							style="color: var(--text-muted);"
						>
							Placa / Vehículo
						</span>
						<select
							value={vehiculoId ?? ''}
							onchange={(e) => onVehiculoChange((e.currentTarget as HTMLSelectElement).value)}
							class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
							style="color: var(--text-primary); font-family: 'JetBrains Mono', monospace;"
							disabled={loadingCatalogos}
						>
							<option value="">— Sin vehículo —</option>
							{#each vehiculos as v (v.id)}
								<option value={v.id}>{v.placa}{v.marca ? ` · ${v.marca}` : ''}</option>
							{/each}
						</select>
					</label>

					<!-- Cliente -->
					<label class="block">
						<span
							class="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
							style="color: var(--text-muted);"
						>
							Cliente / Recorrido
						</span>
						<select
							value={clienteId ?? ''}
							onchange={(e) => onClienteChange((e.currentTarget as HTMLSelectElement).value)}
							class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
							style="color: var(--text-primary);"
							disabled={loadingCatalogos}
						>
							<option value="">— Sin cliente —</option>
							{#each clientes as c (c.id)}
								<option value={c.id}>{c.nombre}</option>
							{/each}
						</select>
					</label>

					<!-- Hora inicio -->
					<label class="block">
						<span
							class="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
							style="color: var(--text-muted);"
						>
							Hora inicio
						</span>
						<TimePicker
							bind:value={horaInicio}
							bind:dayOffset={inicioDiaSiguiente}
							placeholder="Inicio"
						/>
					</label>

					<!-- Hora fin -->
					<label class="block">
						<span
							class="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
							style="color: var(--text-muted);"
						>
							Hora fin
						</span>
						<TimePicker
							bind:value={horaFin}
							bind:dayOffset={finDiaSiguiente}
							placeholder="Fin"
						/>
					</label>

					<!-- Horas conducidas -->
					<label class="block">
						<span
							class="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
							style="color: var(--text-muted);"
						>
							Horas conducidas
						</span>
						<input
							type="number"
							min="0"
							max="24"
							step="0.5"
							bind:value={horasConducidas}
							class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
							style="font-family: 'JetBrains Mono', monospace;"
						/>
					</label>

					<!-- Pernocte -->
					<label class="flex items-center gap-2 self-end pb-2">
						<input
							type="checkbox"
							bind:checked={pernocte}
							class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
						/>
						<span class="text-xs" style="color: var(--text-secondary);">
							Pernocte (noche fuera de casa)
						</span>
					</label>

					<!-- KM inicial -->
					<label class="block">
						<span
							class="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
							style="color: var(--text-muted);"
						>
							KM inicial
						</span>
						<input
							type="number"
							min="0"
							value={kmInicial ?? ''}
							oninput={(e) => {
								const v = (e.currentTarget as HTMLInputElement).value;
								kmInicial = v ? parseInt(v, 10) : null;
							}}
							placeholder="opcional"
							class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
							style="font-family: 'JetBrains Mono', monospace;"
						/>
					</label>

					<!-- KM final -->
					<label class="block">
						<span
							class="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
							style="color: var(--text-muted);"
						>
							KM final
						</span>
						<input
							type="number"
							min="0"
							value={kmFinal ?? ''}
							oninput={(e) => {
								const v = (e.currentTarget as HTMLInputElement).value;
								kmFinal = v ? parseInt(v, 10) : null;
							}}
							placeholder="opcional"
							class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
							style="font-family: 'JetBrains Mono', monospace;"
						/>
					</label>

					<!-- Observaciones (full width) -->
					<label class="block sm:col-span-2">
						<span
							class="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
							style="color: var(--text-muted);"
						>
							Observaciones
						</span>
						<textarea
							bind:value={observaciones}
							rows="2"
							placeholder="Notas del tramo (opcional)…"
							class="apple-transition w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs"
						></textarea>
					</label>
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
					class="apple-transition rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
				>
					Cancelar
				</button>
				<button
					type="button"
					onclick={guardar}
					disabled={guardando}
					class="apple-transition inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
					style="background: linear-gradient(135deg, #ea580c, #c2410c); box-shadow: 0 2px 6px rgba(249, 115, 22,0.25);"
				>
					{#if guardando}
						<svg class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25" />
							<path
								d="M4 12a8 8 0 018-8v0"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
							/>
						</svg>
						Guardando…
					{:else}
						<svg
							class="h-3.5 w-3.5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
						Guardar cambios
					{/if}
				</button>
			</footer>
		</div>
	</div>
{/if}
