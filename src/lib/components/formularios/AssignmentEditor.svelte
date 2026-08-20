<!--
	Editor de asignaciones.

	Dos cosas que el formulario impone porque el backend las exige y descubrirlas
	con un 4xx sería peor:

	  1. **La versión no se puede cambiar.** Los envíos ya hechos apuntan a la
	     versión de la asignación; moverla haría que un envío contra la v2 pareciera
	     hecho contra la v3, con campos que no existían. Para cambiar de versión se
	     crea otra asignación y se cierra esta.
	  2. **`ONE_PER_CONTEXT` necesita contexto requerido.** Si nadie exige
	     `vehicleId`, el runner puede enviar sin vehículo y la unicidad degenera a
	     «uno por conductor y período», que no es lo que se configuró. Se avisa aquí
	     y el backend lo repite en `meta.warnings`.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { asignacionesFormularioAPI, FormApiError, type TargetPayload } from '$lib/api/formularios';
	import { conductoresAPI, vehiculosAPI } from '$lib/api/apiClient';
	import { ordenarPorEtiqueta } from '$lib/utils/ordenarOpciones';
	import {
		ASSIGNMENT_FREQUENCIES,
		FREQUENCY_LABELS,
		LIMIT_POLICIES,
		LIMIT_POLICY_LABELS,
		TARGET_TYPES,
		TARGET_TYPE_LABELS,
		type AssignmentDto,
		type AssignmentFrequency,
		type LimitPolicy,
		type TargetType
	} from '$lib/formularios/types';

	interface Props {
		versionId: string;
		existing?: AssignmentDto;
		onclose: () => void;
		onsaved: () => void;
	}

	let { versionId, existing, onclose, onsaved }: Props = $props();

	// Los campos se siembran UNA vez desde `existing` y luego son estado propio
	// del formulario: si siguieran la prop, cualquier recarga del listado padre
	// pisaría lo que el usuario está escribiendo. El padre envuelve el editor en un
	// `{#key}` para remontarlo cuando cambia de asignación, así que la captura
	// inicial es exactamente lo que se quiere.
	// svelte-ignore state_referenced_locally
	const semilla = existing;

	let nombre = $state(semilla?.name ?? '');
	let frecuencia = $state<AssignmentFrequency>(semilla?.frequency ?? 'DAILY');
	let limite = $state<LimitPolicy>(semilla?.limitPolicy ?? 'ONE_PER_CONTEXT');
	let desde = $state(semilla?.startsAt ? semilla.startsAt.slice(0, 16) : '');
	let hasta = $state(semilla?.endsAt ? semilla.endsAt.slice(0, 16) : '');
	let permitirOffline = $state(semilla?.settings?.allowOffline !== false);
	let exigeVehiculo = $state(Boolean(semilla?.contextSchema?.vehicleId?.required));
	let exigeServicio = $state(Boolean(semilla?.contextSchema?.serviceId?.required));

	let targets = $state<TargetPayload[]>(
		semilla?.targets.length
			? semilla.targets.map((t) => ({
					type: t.type,
					conductorId: t.conductorId,
					vehicleId: t.vehicleId,
					sede: t.sede,
					groupKey: t.groupKey
				}))
			: [{ type: 'ALL_CONDUCTORS' }]
	);

	let conductores = $state<{ id: string; nombre: string }[]>([]);
	let vehiculos = $state<{ id: string; placa: string }[]>([]);
	let guardando = $state(false);

	/**
	 * Extrae el array de una respuesta del API existente.
	 *
	 * Los endpoints antiguos del repo no comparten envoltura: unos devuelven el
	 * array directo, otros `{ data: [...] }` y otros `{ conductores: [...] }`.
	 * Se normaliza aquí en vez de asumir una forma, porque asumir la equivocada
	 * dejaría los desplegables vacíos sin ningún error visible.
	 */
	function comoLista(respuesta: unknown): any[] {
		const cuerpo = (respuesta as any)?.data ?? respuesta;
		if (Array.isArray(cuerpo)) return cuerpo;
		if (Array.isArray(cuerpo?.data)) return cuerpo.data;
		for (const valor of Object.values(cuerpo ?? {})) {
			if (Array.isArray(valor)) return valor as any[];
		}
		return [];
	}

	onMount(async () => {
		/// Los catálogos se traen por adelantado aunque con `ALL_CONDUCTORS` no se
		/// usen: cargarlos al cambiar de tipo produciría un desplegable vacío
		/// durante el primer segundo.
		const [c, v] = await Promise.all([
			conductoresAPI.getAll({ limit: 500 }).catch(() => null),
			vehiculosAPI.getAll().catch(() => null)
		]);

		/// Los dos catálogos van ordenados A-Z por lo que se ve en el desplegable.
		/// Elegir treinta targets de una lista sin orden es incómodo y propenso a
		/// repetir o saltarse uno.
		conductores = ordenarPorEtiqueta(
			comoLista(c)
				.map((x) => ({ id: x.id, nombre: `${x.nombre ?? ''} ${x.apellido ?? ''}`.trim() || x.id }))
				.filter((x) => x.id),
			(x) => x.nombre
		);
		vehiculos = ordenarPorEtiqueta(
			comoLista(v)
				.map((x) => ({ id: x.id, placa: x.placa ?? x.id }))
				.filter((x) => x.id),
			(x) => x.placa
		);
	});

	const avisoContexto = $derived(
		limite === 'ONE_PER_CONTEXT' && !exigeVehiculo && !exigeServicio
			? 'Con «uno por período y contexto» hay que exigir al menos un dato de contexto (normalmente el vehículo), o el límite no tendrá efecto.'
			: null
	);

	/// `ALL_CONDUCTORS` no se combina con nada: si ya alcanza a todos, los demás
	/// targets son ruido y confunden a quien lo revise después.
	const tieneTodos = $derived(targets.some((t) => t.type === 'ALL_CONDUCTORS'));

	function agregarTarget(type: TargetType) {
		if (type === 'ALL_CONDUCTORS') {
			targets = [{ type: 'ALL_CONDUCTORS' }];
			return;
		}
		targets = [...targets.filter((t) => t.type !== 'ALL_CONDUCTORS'), { type }];
	}

	function quitarTarget(index: number) {
		targets = targets.filter((_, i) => i !== index);
	}

	function actualizarTarget(index: number, patch: Partial<TargetPayload>) {
		targets = targets.map((t, i) => (i === index ? { ...t, ...patch } : t));
	}

	function validoLocal(): string | null {
		if (!nombre.trim()) return 'La asignación necesita un nombre.';
		if (targets.length === 0) return 'Hace falta al menos un target.';
		for (const t of targets) {
			if (t.type === 'CONDUCTOR' && !t.conductorId) return 'Falta elegir el conductor de un target.';
			if (t.type === 'VEHICLE' && !t.vehicleId) return 'Falta elegir el vehículo de un target.';
			if (t.type === 'SEDE' && !t.sede?.trim()) return 'Falta la sede de un target.';
			if (t.type === 'GROUP' && !t.groupKey?.trim()) return 'Falta la clave de grupo de un target.';
		}
		if (desde && hasta && new Date(hasta) <= new Date(desde)) {
			return 'La fecha de fin debe ser posterior a la de inicio.';
		}
		return null;
	}

	async function guardar() {
		const error = validoLocal();
		if (error) {
			toast.error(error);
			return;
		}

		const contextSchema: Record<string, { required?: boolean }> = {};
		if (exigeVehiculo) contextSchema.vehicleId = { required: true };
		if (exigeServicio) contextSchema.serviceId = { required: true };

		/// El payload limpia las columnas que no corresponden al tipo: el CHECK
		/// `ck_form_assignment_targets_value` rechaza un `SEDE` que además traiga
		/// vehículo, y Zod lo repite antes.
		const limpios: TargetPayload[] = targets.map((t) => ({
			type: t.type,
			conductorId: t.type === 'CONDUCTOR' ? t.conductorId : null,
			vehicleId: t.type === 'VEHICLE' ? t.vehicleId : null,
			sede: t.type === 'SEDE' ? t.sede?.trim() : null,
			groupKey: t.type === 'GROUP' ? t.groupKey?.trim() : null
		}));

		guardando = true;
		try {
			const payload = {
				name: nombre.trim(),
				frequency: frecuencia,
				limitPolicy: limite,
				startsAt: desde ? new Date(desde).toISOString() : null,
				endsAt: hasta ? new Date(hasta).toISOString() : null,
				targets: limpios,
				contextSchema,
				settings: { allowOffline: permitirOffline }
			};

			const { meta } = existing
				? await asignacionesFormularioAPI.actualizar(existing.id, payload)
				: await asignacionesFormularioAPI.crear({ ...payload, versionId });

			for (const aviso of meta?.warnings ?? []) toast.warning(aviso);
			toast.success(existing ? 'Asignación actualizada.' : 'Asignación creada.');
			onsaved();
		} catch (err) {
			if (err instanceof FormApiError) toast.error(err.message);
			else toast.error('No se pudo guardar la asignación.');
		} finally {
			guardando = false;
		}
	}
</script>

<div
	class="overlay"
	role="dialog"
	aria-modal="true"
	aria-labelledby="asig-titulo"
	tabindex="-1"
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
>
	<div class="caja">
		<header class="caja__head">
			<h2 class="caja__titulo" id="asig-titulo">
				{existing ? 'Editar asignación' : 'Nueva asignación'}
			</h2>
			<button type="button" class="caja__cerrar" aria-label="Cerrar" onclick={onclose}>✕</button>
		</header>

		<div class="caja__cuerpo">
			{#if existing}
				<p class="nota">
					La versión de una asignación no se puede cambiar: los envíos ya hechos la referencian. Para
					pasar a otra versión, cierra esta y crea una nueva.
				</p>
			{/if}

			<label class="campo">
				<span class="campo__label">Nombre</span>
				<input class="input" bind:value={nombre} placeholder="Preoperacional camionetas diario" />
			</label>

			<div class="fila">
				<label class="campo">
					<span class="campo__label">Frecuencia</span>
					<select class="input" bind:value={frecuencia}>
						{#each ASSIGNMENT_FREQUENCIES as f (f)}
							<option value={f}>{FREQUENCY_LABELS[f]}</option>
						{/each}
					</select>
				</label>

				<label class="campo">
					<span class="campo__label">Límite</span>
					<select class="input" bind:value={limite}>
						{#each LIMIT_POLICIES as l (l)}
							<option value={l}>{LIMIT_POLICY_LABELS[l]}</option>
						{/each}
					</select>
				</label>
			</div>

			<div class="fila">
				<label class="campo">
					<span class="campo__label">Vigente desde</span>
					<input class="input" type="datetime-local" bind:value={desde} />
				</label>
				<label class="campo">
					<span class="campo__label">Vigente hasta</span>
					<input class="input" type="datetime-local" bind:value={hasta} />
					<span class="campo__hint">Vacío = sin fecha de fin.</span>
				</label>
			</div>

			<fieldset class="grupo">
				<legend class="campo__label">Contexto obligatorio</legend>
				<label class="check">
					<input type="checkbox" bind:checked={exigeVehiculo} />
					Exigir vehículo al abrir el formulario
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={exigeServicio} />
					Exigir servicio
				</label>
				{#if avisoContexto}
					<p class="aviso">{avisoContexto}</p>
				{/if}
			</fieldset>

			<label class="check">
				<input type="checkbox" bind:checked={permitirOffline} />
				Permitir diligenciar sin conexión
			</label>

			<fieldset class="grupo">
				<legend class="campo__label">A quién le aparece</legend>

				<div class="tipos">
					{#each TARGET_TYPES as type (type)}
						<button
							type="button"
							class="tipo"
							disabled={tieneTodos && type !== 'ALL_CONDUCTORS'}
							onclick={() => agregarTarget(type)}
						>
							+ {TARGET_TYPE_LABELS[type]}
						</button>
					{/each}
				</div>

				<ul class="targets">
					{#each targets as target, i (i)}
						<li class="target">
							<span class="target__tipo">{TARGET_TYPE_LABELS[target.type]}</span>

							{#if target.type === 'CONDUCTOR'}
								<select
									class="input input--mini"
									value={target.conductorId ?? ''}
									onchange={(e) => actualizarTarget(i, { conductorId: e.currentTarget.value || null })}
								>
									<option value="">Selecciona conductor…</option>
									{#each conductores as c (c.id)}
										<option value={c.id}>{c.nombre}</option>
									{/each}
								</select>
							{:else if target.type === 'VEHICLE'}
								<select
									class="input input--mini"
									value={target.vehicleId ?? ''}
									onchange={(e) => actualizarTarget(i, { vehicleId: e.currentTarget.value || null })}
								>
									<option value="">Selecciona vehículo…</option>
									{#each vehiculos as v (v.id)}
										<option value={v.id}>{v.placa}</option>
									{/each}
								</select>
							{:else if target.type === 'SEDE'}
								<input
									class="input input--mini"
									placeholder="Sede"
									value={target.sede ?? ''}
									oninput={(e) => actualizarTarget(i, { sede: e.currentTarget.value })}
								/>
							{:else if target.type === 'GROUP'}
								<input
									class="input input--mini"
									placeholder="Clave del grupo"
									value={target.groupKey ?? ''}
									oninput={(e) => actualizarTarget(i, { groupKey: e.currentTarget.value })}
								/>
							{:else}
								<span class="target__nota">Alcanza a todos los conductores activos.</span>
							{/if}

							{#if targets.length > 1}
								<button
									type="button"
									class="target__quitar"
									aria-label="Quitar target {i + 1}"
									onclick={() => quitarTarget(i)}
								>
									✕
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			</fieldset>
		</div>

		<footer class="caja__foot">
			<button type="button" class="btn" onclick={onclose}>Cancelar</button>
			<button type="button" class="btn btn--primario" disabled={guardando} onclick={guardar}>
				{guardando ? 'Guardando…' : existing ? 'Guardar cambios' : 'Crear asignación'}
			</button>
		</footer>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(15, 31, 26, 0.45);
	}

	.caja {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 34rem;
		max-height: 90vh;
		background: var(--bg-surface, #fff);
		border-radius: 16px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
		overflow: hidden;
	}

	.caja__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.caja__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.0625rem;
		font-weight: 600;
	}

	.caja__cerrar {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		font: inherit;
		background: none;
		border: none;
		border-radius: 8px;
		cursor: pointer;
	}

	.caja__cuerpo {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.875rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.caja__foot {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.fila {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.625rem;
	}

	@media (min-width: 560px) {
		.fila {
			grid-template-columns: 1fr 1fr;
		}
	}

	.campo {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
	}

	.campo__label {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.campo__hint {
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.input {
		width: 100%;
		min-height: 42px;
		padding: 0.375rem 0.625rem;
		font: inherit;
		font-size: 0.875rem;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 9px;
	}

	.input--mini {
		min-height: 36px;
		font-size: 0.8125rem;
		flex: 1;
		min-width: 8rem;
	}

	.input:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	.grupo {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 10px;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--text-primary, #1a1a1a);
	}

	.check input {
		width: 18px;
		height: 18px;
		accent-color: var(--emerald-600, #059669);
	}

	.tipos {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.tipo {
		min-height: 34px;
		padding: 0 0.5rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--emerald-700, #047857);
		background: #fff7ed;
		border: 1px solid #fed7aa;
		border-radius: 999px;
		cursor: pointer;
	}

	.tipo:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.targets {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		list-style: none;
	}

	.target {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.375rem 0.5rem;
		background: var(--gray-50, #f9fafb);
		border-radius: 8px;
	}

	.target__tipo {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted, #6b6b6b);
	}

	.target__nota {
		font-size: 0.75rem;
		font-style: italic;
		color: var(--text-very-muted, #9a9a9a);
	}

	.target__quitar {
		margin-left: auto;
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		font: inherit;
		font-size: 0.6875rem;
		color: var(--text-muted, #6b6b6b);
		background: none;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}

	.target__quitar:hover {
		background: #fef2f2;
		color: #b91c1c;
	}

	.nota,
	.aviso {
		font-size: 0.75rem;
		line-height: 1.45;
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
	}

	.nota {
		color: var(--text-muted, #6b6b6b);
		background: var(--gray-50, #f9fafb);
	}

	.aviso {
		color: #92400e;
		background: #fffbeb;
		border: 1px solid #fde68a;
	}

	.btn {
		min-height: 44px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
		cursor: pointer;
	}

	.btn--primario {
		color: #fff;
		background: var(--emerald-600, #059669);
		border-color: var(--emerald-600, #059669);
		font-weight: 600;
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn:focus-visible,
	.tipo:focus-visible,
	.target__quitar:focus-visible,
	.caja__cerrar:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 2px;
	}
</style>
