<script lang="ts">
	import type { Replanteo } from '$lib/api/acciones-correctivas';

	export let replanteo: Replanteo = {
		nueva_fecha_limite: '',
		responsable: '',
		justificacion: '',
		cambios: ''
	};
	export let disabled = false;
</script>

<div class="mt-4 rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface)] p-4">
	<div class="mb-3 flex items-center gap-2 text-[var(--fm-text)]">
		<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
		</svg>
		<h4 class="text-sm font-bold uppercase tracking-wide">Detalles del Replanteo</h4>
	</div>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<div>
			<label class="mb-1 block text-xs font-semibold text-[var(--fm-text)]">Nueva Fecha Límite</label>
			<input
				type="date"
				bind:value={replanteo.nueva_fecha_limite}
				class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
				{disabled}
			/>
		</div>
		<div>
			<label class="mb-1 block text-xs font-semibold text-[var(--fm-text)]">Responsable del Replanteo</label>
			<input
				type="text"
				bind:value={replanteo.responsable}
				placeholder="Nombre y cargo"
				class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
				{disabled}
			/>
		</div>
		<div class="md:col-span-2">
			<label class="mb-1 block text-xs font-semibold text-[var(--fm-text)]">Justificación del Cambio</label>
			<textarea
				bind:value={replanteo.justificacion}
				rows="2"
				placeholder="¿Por qué se requiere replantear la fecha?"
				class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
				{disabled}
			></textarea>
		</div>
		<div class="md:col-span-2">
			<label class="mb-1 block text-xs font-semibold text-[var(--fm-text)]">Cambios en el Plan de Acción</label>
			<textarea
				bind:value={replanteo.cambios}
				rows="2"
				placeholder="Describa si hay cambios en las actividades planeadas"
				class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
				{disabled}
			></textarea>
		</div>
	</div>
</div>
