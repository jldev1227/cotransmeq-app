<!--
	Un campo del formulario, en el mismo componente que usan el preview del
	builder y el runner del portal.

	Reglas de diseño que vienen del documento y que conviene no romper:

	  - una sola columna hasta 768 px y objetivos táctiles de 44 px mínimo: se
	    diligencia con guantes, de pie, junto a un vehículo;
	  - el estado nunca se comunica SOLO con color — cada estado lleva texto o
	    icono, porque el sol directo sobre una pantalla de gama baja se come los
	    matices de color;
	  - el mensaje de error se asocia con `aria-describedby` y no solo se pinta
	    debajo, para que un lector de pantalla lo lea al enfocar el campo.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { FormFieldDto } from '$lib/formularios/types';
	import { capabilitiesOf } from '$lib/formularios/types';
	import type { RunnerState } from '$lib/formularios/runner-state.svelte';
	import RepeatableGroupRenderer from './RepeatableGroupRenderer.svelte';

	interface Props {
		field: FormFieldDto;
		runner: RunnerState;
		occurrenceId?: string | null;
		/** Nivel de anidación; solo afecta al espaciado. */
		depth?: number;
		/**
		 * Captura de evidencia. La inyecta el RUNNER del portal; el preview del
		 * builder no la pasa, y así no hay forma de subir un archivo desde el
		 * constructor —que no tiene envío al que colgarlo—.
		 */
		evidence?: Snippet<[{ field: FormFieldDto; occurrenceId: string | null }]>;
	}

	let { field, runner, occurrenceId = null, depth = 0, evidence }: Props = $props();

	const cap = $derived(capabilitiesOf(field.type));
	const fieldState = $derived(runner.stateOf(field.id, occurrenceId));
	const errores = $derived(runner.errorsFor(field.id, occurrenceId));
	const valor = $derived(runner.valueOf(field.id, occurrenceId));
	const seleccionadas = $derived(runner.optionsOf(field.id, occurrenceId));
	const adjuntos = $derived(runner.attachmentsOf(field.id, occurrenceId));

	const inputId = $derived(`f-${field.id}${occurrenceId ? `-${occurrenceId}` : ''}`);
	const errorId = $derived(`${inputId}-error`);
	const helpId = $derived(`${inputId}-help`);

	const describedBy = $derived(
		[errores.length ? errorId : null, field.helpText ? helpId : null].filter(Boolean).join(' ') || undefined
	);

	const disabled = $derived(fieldState.disabled || runner.readonly);

	function onInput(value: unknown) {
		runner.set(field.id, value, occurrenceId);
	}

	function onBlur() {
		runner.markTouched(field.id, occurrenceId);
	}

	/**
	 * Captura la ubicación actual.
	 *
	 * `enableHighAccuracy` con timeout corto: en campo abierto el GPS tarda, y
	 * dejar al conductor esperando indefinidamente con un spinner es peor que
	 * fallar y ofrecer reintentar.
	 */
	let geoEstado = $state<'idle' | 'buscando' | 'error'>('idle');
	function capturarUbicacion() {
		if (!navigator.geolocation) {
			geoEstado = 'error';
			return;
		}
		geoEstado = 'buscando';
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				geoEstado = 'idle';
				onInput({
					lat: Number(pos.coords.latitude.toFixed(6)),
					lng: Number(pos.coords.longitude.toFixed(6)),
					accuracy: Math.round(pos.coords.accuracy)
				});
				onBlur();
			},
			() => {
				geoEstado = 'error';
			},
			{ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
		);
	}

	const ubicacion = $derived(
		valor && typeof valor === 'object' ? (valor as { lat: number; lng: number; accuracy?: number }) : null
	);

	/** Número de decimales permitidos, para el `step` del input numérico. */
	const stepNumerico = $derived(
		field.type === 'INTEGER'
			? '1'
			: field.validation?.precision != null
				? String(1 / 10 ** Number(field.validation.precision))
				: 'any'
	);
</script>

{#if fieldState.visible}
	<div
		class="campo"
		class:campo--error={errores.length > 0}
		class:campo--anidado={depth > 0}
		data-field-key={field.key}
	>
		{#if field.type === 'INFO'}
			<!-- Un INFO no es un control: es texto normativo. Se marca como `note`
			     para que el lector de pantalla no lo anuncie como campo vacío. -->
			<div class="info" role="note">
				<p class="info__titulo">{field.label}</p>
				{#if field.helpText}<p class="info__cuerpo">{field.helpText}</p>{/if}
			</div>
		{:else if cap.children}
			<RepeatableGroupRenderer {field} {runner} {depth} />
		{:else}
			<div class="campo__cabecera">
				<label class="campo__label" for={inputId}>
					{field.label}
					{#if fieldState.required}
						<span class="campo__req" aria-label="obligatorio">*</span>
					{/if}
				</label>
			</div>

			{#if field.helpText}
				<p class="campo__ayuda" id={helpId}>{field.helpText}</p>
			{/if}

			{#if field.type === 'SHORT_TEXT'}
				<input
					id={inputId}
					class="control"
					type="text"
					{disabled}
					maxlength={Number(field.validation?.maxLength ?? 500)}
					placeholder={field.placeholder ?? ''}
					value={(valor as string) ?? ''}
					aria-describedby={describedBy}
					aria-invalid={errores.length > 0}
					oninput={(e) => onInput(e.currentTarget.value)}
					onblur={onBlur}
				/>
			{:else if field.type === 'LONG_TEXT'}
				<textarea
					id={inputId}
					class="control control--area"
					rows="3"
					{disabled}
					maxlength={Number(field.validation?.maxLength ?? 4000)}
					placeholder={field.placeholder ?? ''}
					value={(valor as string) ?? ''}
					aria-describedby={describedBy}
					aria-invalid={errores.length > 0}
					oninput={(e) => onInput(e.currentTarget.value)}
					onblur={onBlur}
				></textarea>
			{:else if field.type === 'INTEGER' || field.type === 'DECIMAL' || field.type === 'CALCULATED'}
				<input
					id={inputId}
					class="control control--num"
					type="number"
					inputmode={field.type === 'INTEGER' ? 'numeric' : 'decimal'}
					step={stepNumerico}
					min={field.validation?.min ?? undefined}
					max={field.validation?.max ?? undefined}
					disabled={disabled || field.type === 'CALCULATED'}
					placeholder={field.placeholder ?? ''}
					value={(valor as number) ?? ''}
					aria-describedby={describedBy}
					aria-invalid={errores.length > 0}
					oninput={(e) => onInput(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
					onblur={onBlur}
				/>
			{:else if field.type === 'BOOLEAN'}
				<!-- Dos botones y no un checkbox: "sin responder" y "no" tienen que
				     poder distinguirse, y un checkbox desmarcado no distingue. -->
				<div class="segmentado" role="group" aria-labelledby={inputId} aria-describedby={describedBy}>
					{#each [{ v: true, t: 'Sí' }, { v: false, t: 'No' }] as opcion (String(opcion.v))}
						<button
							type="button"
							class="segmentado__btn"
							class:segmentado__btn--activo={valor === opcion.v}
							{disabled}
							aria-pressed={valor === opcion.v}
							onclick={() => {
								onInput(valor === opcion.v ? null : opcion.v);
								onBlur();
							}}
						>
							{opcion.t}
						</button>
					{/each}
				</div>
			{:else if field.type === 'DATE'}
				<input
					id={inputId}
					class="control"
					type="date"
					{disabled}
					value={(valor as string) ?? ''}
					aria-describedby={describedBy}
					aria-invalid={errores.length > 0}
					oninput={(e) => onInput(e.currentTarget.value || null)}
					onblur={onBlur}
				/>
			{:else if field.type === 'TIME'}
				<input
					id={inputId}
					class="control"
					type="time"
					{disabled}
					value={(valor as string) ?? ''}
					aria-describedby={describedBy}
					aria-invalid={errores.length > 0}
					oninput={(e) => onInput(e.currentTarget.value || null)}
					onblur={onBlur}
				/>
			{:else if field.type === 'DATETIME'}
				<input
					id={inputId}
					class="control"
					type="datetime-local"
					{disabled}
					value={typeof valor === 'string' ? valor.slice(0, 16) : ''}
					aria-describedby={describedBy}
					aria-invalid={errores.length > 0}
					oninput={(e) =>
						onInput(e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : null)}
					onblur={onBlur}
				/>
			{:else if field.type === 'SINGLE_CHOICE'}
				<div class="opciones" role="radiogroup" aria-describedby={describedBy} aria-invalid={errores.length > 0}>
					{#each field.options as opcion (opcion.id)}
						<button
							type="button"
							class="chip chip--{opcion.color ?? 'neutral'}"
							class:chip--activo={seleccionadas[0] === opcion.value}
							{disabled}
							role="radio"
							aria-checked={seleccionadas[0] === opcion.value}
							onclick={() => {
								runner.setOptions(
									field.id,
									seleccionadas[0] === opcion.value ? [] : [opcion.value],
									occurrenceId
								);
								onBlur();
							}}
						>
							<!-- El check da la señal no cromática que exige el documento:
							     el color por sí solo no basta. -->
							<span class="chip__marca" aria-hidden="true">
								{seleccionadas[0] === opcion.value ? '✓' : ''}
							</span>
							{opcion.label}
						</button>
					{/each}
				</div>
			{:else if field.type === 'MULTIPLE_CHOICE'}
				<div class="opciones" role="group" aria-describedby={describedBy}>
					{#each field.options as opcion (opcion.id)}
						<button
							type="button"
							class="chip chip--{opcion.color ?? 'neutral'}"
							class:chip--activo={seleccionadas.includes(opcion.value)}
							{disabled}
							aria-pressed={seleccionadas.includes(opcion.value)}
							onclick={() => {
								runner.toggleOption(field.id, opcion.value, occurrenceId);
								onBlur();
							}}
						>
							<span class="chip__marca" aria-hidden="true">
								{seleccionadas.includes(opcion.value) ? '✓' : ''}
							</span>
							{opcion.label}
						</button>
					{/each}
				</div>
			{:else if cap.attachment}
				<div class="evidencia" aria-describedby={describedBy}>
					{#if evidence}
						{@render evidence({ field, occurrenceId })}
					{:else}
						<!-- Sin snippet: preview o recibo. Se listan los adjuntos conocidos
						     y se explica que la captura ocurre en el dispositivo. -->
						{#if adjuntos.length}
							<ul class="evidencia__lista">
								{#each adjuntos as adjunto (adjunto.clientAttachmentId)}
									<li class="evidencia__item">
										<span class="evidencia__nombre">
											{adjunto.kind === 'SIGNATURE' ? 'Firma' : adjunto.mimeType}
											· {(adjunto.byteSize / 1024).toFixed(0)} KB
										</span>
									</li>
								{/each}
							</ul>
						{/if}
						{#if !runner.readonly}
							<p class="evidencia__hint">
								{field.type === 'SIGNATURE'
									? 'Se firma en el dispositivo al diligenciar.'
									: 'Se adjunta desde el dispositivo al diligenciar.'}
							</p>
						{/if}
					{/if}
				</div>
			{:else if field.type === 'LOCATION'}
				<div class="ubicacion">
					{#if ubicacion}
						<p class="ubicacion__valor">
							{ubicacion.lat.toFixed(5)}, {ubicacion.lng.toFixed(5)}
							{#if ubicacion.accuracy}<span class="ubicacion__precision">±{ubicacion.accuracy} m</span>{/if}
						</p>
					{/if}
					{#if !disabled}
						<button type="button" class="btn-secundario" onclick={capturarUbicacion}>
							{geoEstado === 'buscando' ? 'Buscando señal…' : ubicacion ? 'Actualizar' : 'Capturar ubicación'}
						</button>
					{/if}
					{#if geoEstado === 'error'}
						<p class="ubicacion__error">No se pudo obtener la ubicación. Puedes reintentar.</p>
					{/if}
				</div>
			{:else if field.type === 'LOOKUP'}
				<!-- El selector real (conductor/vehículo/servicio) lo inyecta la página
				     que conoce esos catálogos. Aquí se muestra el snapshot guardado. -->
				<div class="lookup">
					{#if valor && typeof valor === 'object'}
						<span class="lookup__valor">
							{(valor as any).placa ?? (valor as any).nombre ?? (valor as any).id}
						</span>
					{:else}
						<span class="lookup__vacio">Sin seleccionar</span>
					{/if}
				</div>
			{/if}

			{#if errores.length}
				<p class="campo__error" id={errorId} role="alert">
					{errores[0].message}
				</p>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.campo {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.875rem 1rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 12px;
	}

	.campo--anidado {
		border: none;
		padding: 0.5rem 0;
		background: transparent;
		border-radius: 0;
	}

	/* El borde izquierdo grueso acompaña al texto del error, no lo sustituye. */
	.campo--error {
		border-color: #dc2626;
		box-shadow: inset 3px 0 0 #dc2626;
	}

	.campo__cabecera {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.campo__label {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		line-height: 1.35;
	}

	.campo__req {
		color: #dc2626;
		margin-left: 0.125rem;
	}

	.campo__ayuda {
		font-size: 0.8125rem;
		color: var(--text-muted, #6b6b6b);
		line-height: 1.4;
	}

	.campo__error {
		font-size: 0.8125rem;
		font-weight: 500;
		color: #b91c1c;
		display: flex;
		gap: 0.375rem;
	}

	.campo__error::before {
		content: '⚠';
	}

	.control {
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 0.75rem;
		font: inherit;
		font-size: 0.9375rem;
		color: var(--text-primary, #1a1a1a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
		transition: border-color 120ms ease, box-shadow 120ms ease;
	}

	.control:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	.control:disabled {
		background: var(--gray-50, #f9fafb);
		color: var(--text-muted, #6b6b6b);
	}

	.control--area {
		min-height: 84px;
		resize: vertical;
	}

	.control--num {
		max-width: 12rem;
	}

	.segmentado {
		display: flex;
		gap: 0.5rem;
	}

	.segmentado__btn,
	.chip {
		min-height: 44px;
		min-width: 44px;
		padding: 0.5rem 0.875rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 999px;
		cursor: pointer;
		transition: all 120ms ease;
	}

	.segmentado__btn--activo {
		background: var(--emerald-600, #059669);
		border-color: var(--emerald-600, #059669);
		color: #fff;
	}

	.opciones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.chip__marca {
		display: inline-block;
		width: 0.875rem;
		font-weight: 700;
	}

	.chip--activo {
		border-width: 2px;
		font-weight: 600;
	}

	.chip--emerald.chip--activo {
		background: #fff7ed;
		border-color: #ea580c;
		color: #9a3412;
	}

	.chip--red.chip--activo {
		background: #fef2f2;
		border-color: #dc2626;
		color: #991b1b;
	}

	.chip--gray.chip--activo,
	.chip--neutral.chip--activo {
		background: var(--gray-50, #f9fafb);
		border-color: #6b7280;
		color: #374151;
	}

	.chip:disabled,
	.segmentado__btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.chip:focus-visible,
	.segmentado__btn:focus-visible,
	.btn-secundario:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}

	.info {
		padding: 0.75rem 0.875rem;
		background: #fff7ed;
		border-left: 3px solid var(--emerald-600, #059669);
		border-radius: 8px;
	}

	.info__titulo {
		font-size: 0.9375rem;
		font-weight: 600;
		color: #9a3412;
	}

	.info__cuerpo {
		margin-top: 0.25rem;
		font-size: 0.8438rem;
		color: #c2410c;
		line-height: 1.5;
	}

	.evidencia,
	.ubicacion,
	.lookup {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.evidencia__lista {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		list-style: none;
	}

	.evidencia__item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		background: var(--gray-50, #f9fafb);
		border-radius: 8px;
		font-size: 0.8125rem;
	}

	.evidencia__nombre {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-secondary, #4a4a4a);
	}

	.evidencia__quitar {
		min-height: 32px;
		padding: 0 0.5rem;
		font: inherit;
		font-size: 0.75rem;
		color: #b91c1c;
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: underline;
	}

	.evidencia__hint,
	.lookup__vacio {
		font-size: 0.8125rem;
		color: var(--text-very-muted, #9a9a9a);
		font-style: italic;
	}

	.btn-secundario {
		align-self: flex-start;
		min-height: 44px;
		padding: 0 1rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--emerald-700, #047857);
		background: #fff7ed;
		border: 1px solid #fed7aa;
		border-radius: 10px;
		cursor: pointer;
	}

	.ubicacion__valor,
	.lookup__valor {
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		color: var(--text-secondary, #4a4a4a);
	}

	.ubicacion__precision {
		margin-left: 0.375rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.ubicacion__error {
		font-size: 0.8125rem;
		color: #b91c1c;
	}

	@media (prefers-reduced-motion: reduce) {
		.control,
		.chip,
		.segmentado__btn {
			transition: none;
		}
	}
</style>
