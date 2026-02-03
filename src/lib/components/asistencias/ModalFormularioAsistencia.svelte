<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		asistenciasAPI,
		type CreateFormularioInput,
		type TipoEvento
	} from '$lib/api/asistencias';

	export let isOpen = false;
	export let formularioEdit: any = null;

	const dispatch = createEventDispatcher();

	// Form fields
	let tematica = '';
	let objetivo = '';
	let fecha = '';
	let horaInicio = '';
	let horaFinalizacion = '';
	let tipoEvento: TipoEvento = 'capacitacion';
	let tipoEventoOtro = '';
	let lugarSede = '';
	let nombreInstructor = '';
	let observaciones = '';
	let isSubmitting = false;

	const tiposEvento: Array<{ value: TipoEvento; label: string }> = [
		{ value: 'capacitacion', label: 'Capacitación' },
		{ value: 'asesoria', label: 'Asesoría' },
		{ value: 'charla', label: 'Charla' },
		{ value: 'induccion', label: 'Inducción' },
		{ value: 'reunion', label: 'Reunión' },
		{ value: 'divulgacion', label: 'Divulgación' },
		{ value: 'otro', label: 'Otro' }
	];

	$: if (isOpen && formularioEdit) {
		tematica = formularioEdit.tematica || '';
		objetivo = formularioEdit.objetivo || '';
		fecha = formularioEdit.fecha ? formularioEdit.fecha.split('T')[0] : '';
		horaInicio = formularioEdit.hora_inicio || '';
		horaFinalizacion = formularioEdit.hora_finalizacion || '';
		tipoEvento = formularioEdit.tipo_evento || 'capacitacion';
		tipoEventoOtro = formularioEdit.tipo_evento_otro || '';
		lugarSede = formularioEdit.lugar_sede || '';
		nombreInstructor = formularioEdit.nombre_instructor || '';
		observaciones = formularioEdit.observaciones || '';
	}

	$: if (isOpen && !formularioEdit) {
		resetForm();
	}

	function resetForm() {
		tematica = '';
		objetivo = '';
		fecha = new Date().toISOString().split('T')[0];
		horaInicio = '';
		horaFinalizacion = '';
		tipoEvento = 'capacitacion';
		tipoEventoOtro = '';
		lugarSede = '';
		nombreInstructor = '';
		observaciones = '';
	}

	function closeModal() {
		isOpen = false;
		resetForm();
		dispatch('close');
	}

	async function handleSubmit() {
		if (!tematica.trim()) {
			toast.error('La temática es requerida');
			return;
		}

		if (!fecha) {
			toast.error('La fecha es requerida');
			return;
		}

		if (tipoEvento === 'otro' && !tipoEventoOtro.trim()) {
			toast.error('Debe especificar el tipo de evento');
			return;
		}

		isSubmitting = true;

		try {
			const data: CreateFormularioInput = {
				tematica: tematica.trim(),
				objetivo: objetivo.trim() || undefined,
				fecha: new Date(fecha).toISOString(),
				hora_inicio: horaInicio || undefined,
				hora_finalizacion: horaFinalizacion || undefined,
				tipo_evento: tipoEvento,
				tipo_evento_otro: tipoEvento === 'otro' ? tipoEventoOtro.trim() : undefined,
				lugar_sede: lugarSede.trim() || undefined,
				nombre_instructor: nombreInstructor.trim() || undefined,
				observaciones: observaciones.trim() || undefined
			};

			let formulario;

			if (formularioEdit) {
				formulario = await asistenciasAPI.actualizarFormulario(formularioEdit.id, data);
				console.log('📝 [Modal] Formulario actualizado desde API:', formulario);
			} else {
				formulario = await asistenciasAPI.crearFormulario(data);
				console.log('📝 [Modal] Formulario creado desde API:', formulario);
				toast.success('Formulario creado exitosamente');
			}

			console.log('📝 [Modal] Emitiendo evento save con formulario:', formulario);
			dispatch('save', { formulario });
			closeModal();
		} catch (error: any) {
			toast.error(error.message || 'Error al guardar el formulario');
		} finally {
			isSubmitting = false;
		}
	}
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
		on:click={closeModal}
		on:keydown={(e) => e.key === 'Escape' && closeModal()}
		role="button"
		tabindex="0"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="max-h-[40rem] w-full max-w-3xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			transition:fly={{ y: 50, duration: 300 }}
		>
			<!-- Header -->
			<div class="mb-6 flex items-center justify-between">
				<h2 class="text-2xl font-bold text-gray-900">
					{formularioEdit ? 'Editar Formulario' : 'Nuevo Formulario'}
				</h2>
				<button
					on:click={closeModal}
					class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
					disabled={isSubmitting}
				>
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<form on:submit|preventDefault={handleSubmit} class="space-y-4">
				<!-- Temática (requerido) -->
				<div>
					<label for="tematica" class="mb-2 block text-sm font-medium text-gray-700">
						Temática del Evento <span class="text-red-500">*</span>
					</label>
					<input
						id="tematica"
						type="text"
						bind:value={tematica}
						placeholder="Ej: Seguridad y Salud en el Trabajo"
						class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
						disabled={isSubmitting}
						required
					/>
				</div>

				<!-- Objetivo -->
				<div>
					<label for="objetivo" class="mb-2 block text-sm font-medium text-gray-700">
						Objetivo del Evento
					</label>
					<textarea
						id="objetivo"
						bind:value={objetivo}
						placeholder="Describe el objetivo o propósito del evento..."
						rows="3"
						class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
						disabled={isSubmitting}
					/>
				</div>

				<!-- Tipo de Evento -->
				<div>
					<label for="tipoEvento" class="mb-2 block text-sm font-medium text-gray-700">
						Tipo de Evento <span class="text-red-500">*</span>
					</label>
					<select
						id="tipoEvento"
						bind:value={tipoEvento}
						class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
						disabled={isSubmitting}
						required
					>
						{#each tiposEvento as tipo}
							<option value={tipo.value}>{tipo.label}</option>
						{/each}
					</select>
				</div>

				<!-- Tipo Evento Otro (condicional) -->
				{#if tipoEvento === 'otro'}
					<div transition:fly={{ y: -10, duration: 300 }}>
						<label for="tipoEventoOtro" class="mb-2 block text-sm font-medium text-gray-700">
							Especificar Tipo de Evento <span class="text-red-500">*</span>
						</label>
						<input
							id="tipoEventoOtro"
							type="text"
							bind:value={tipoEventoOtro}
							placeholder="Especifique el tipo de evento"
							class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
							disabled={isSubmitting}
							required
						/>
					</div>
				{/if}

				<!-- Fecha, Hora Inicio, Hora Fin -->
				<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
					<div>
						<label for="fecha" class="mb-2 block text-sm font-medium text-gray-700">
							Fecha <span class="text-red-500">*</span>
						</label>
						<input
							id="fecha"
							type="date"
							bind:value={fecha}
							class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
							disabled={isSubmitting}
							required
						/>
					</div>

					<div>
						<label for="horaInicio" class="mb-2 block text-sm font-medium text-gray-700">
							Hora Inicio
						</label>
						<input
							id="horaInicio"
							type="time"
							bind:value={horaInicio}
							class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
							disabled={isSubmitting}
						/>
					</div>

					<div>
						<label for="horaFin" class="mb-2 block text-sm font-medium text-gray-700">
							Hora Finalización
						</label>
						<input
							id="horaFin"
							type="time"
							bind:value={horaFinalizacion}
							class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
							disabled={isSubmitting}
						/>
					</div>
				</div>

				<!-- Lugar/Sede -->
				<div>
					<label for="lugarSede" class="mb-2 block text-sm font-medium text-gray-700">
						Lugar / Sede
					</label>
					<input
						id="lugarSede"
						type="text"
						bind:value={lugarSede}
						placeholder="Ej: Oficina Principal, Sede Sur, Virtual"
						class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
						disabled={isSubmitting}
					/>
				</div>

				<!-- Nombre del Instructor -->
				<div>
					<label for="nombreInstructor" class="mb-2 block text-sm font-medium text-gray-700">
						Nombre del Instructor / Facilitador
					</label>
					<input
						id="nombreInstructor"
						type="text"
						bind:value={nombreInstructor}
						placeholder="Ej: Juan Pérez - ARL Sura"
						class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
						disabled={isSubmitting}
					/>
				</div>

				<!-- Observaciones -->
				<div>
					<label for="observaciones" class="mb-2 block text-sm font-medium text-gray-700">
						Observaciones
					</label>
					<textarea
						id="observaciones"
						bind:value={observaciones}
						placeholder="Observaciones o comentarios adicionales sobre el evento..."
						rows="3"
						class="w-full rounded-xl border border-gray-300 px-4 py-2.5 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 focus:outline-none"
						disabled={isSubmitting}
					/>
				</div>

				<!-- Buttons -->
				<div class="flex items-center justify-end gap-3 border-t pt-4">
					<button
						type="button"
						on:click={closeModal}
						class="rounded-xl border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-50"
						disabled={isSubmitting}
					>
						Cancelar
					</button>
					<button
						type="submit"
						class="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-2.5 font-medium text-white shadow-lg transition-all hover:shadow-orange-500/50 disabled:cursor-not-allowed disabled:opacity-50"
						disabled={isSubmitting}
					>
						{#if isSubmitting}
							<svg
								class="h-5 w-5 animate-spin"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								/>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								/>
							</svg>
							<span>Guardando...</span>
						{:else}
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5 13l4 4L19 7"
								/>
							</svg>
							<span>{formularioEdit ? 'Actualizar' : 'Crear Formulario'}</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
