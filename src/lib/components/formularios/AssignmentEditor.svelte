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
	import {
		Briefcase,
		Building2,
		Check,
		IdCard,
		Info,
		Layers,
		MapPin,
		Plus,
		TriangleAlert,
		Truck,
		UserCog,
		UserRound,
		Users,
		X
	} from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import {
		asignacionesFormularioAPI,
		FormApiError,
		type AudienciaInterna,
		type TargetPayload
	} from '$lib/api/formularios';
	import { AREA_LABELS, AREAS, type Area } from '$lib/config/permissions';
	import { conductoresAPI, vehiculosAPI } from '$lib/api/apiClient';
	import { ordenarPorEtiqueta } from '$lib/utils/ordenarOpciones';
	import {
		ASSIGNMENT_FREQUENCIES,
		FREQUENCY_LABELS,
		LIMIT_POLICIES,
		LIMIT_POLICY_LABELS,
		CONDUCTOR_TARGET_TYPES,
		USER_TARGET_TYPES,
		TARGET_TYPE_LABELS,
		esTargetDeUsuario,
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
					groupKey: t.groupKey,
					usuarioId: t.usuarioId,
					area: t.area,
					cargo: t.cargo
				}))
			: [{ type: 'ALL_CONDUCTORS' }]
	);

	let conductores = $state<{ id: string; nombre: string }[]>([]);
	let vehiculos = $state<{ id: string; placa: string }[]>([]);
	let usuarios = $state<AudienciaInterna['usuarios']>([]);
	let cargosConocidos = $state<string[]>([]);
	let guardando = $state(false);

	/// Prefijo para los `id` de los campos: el editor se remonta con `{#key}`
	/// y no debe chocar con otro formulario abierto en la página.
	const uid = `asig-${Math.random().toString(36).slice(2, 8)}`;

	/// Subtítulo del encabezado: al editar se nombra la versión (que no se
	/// puede cambiar); al crear se explica qué se define aquí.
	const subtitulo = $derived.by(() => {
		const v = existing?.version;
		if (!v) return 'Define quién lo diligencia, con qué frecuencia y durante qué período.';
		return [v.code, v.title, `Versión\u00a0${v.versionNumber}`].filter(Boolean).join(' · ');
	});

	const LIMITE_AYUDA: Record<LimitPolicy, string> = {
		UNLIMITED: 'Se puede enviar las veces que haga falta.',
		ONE_PER_PERIOD: 'Un envío por persona en cada período.',
		ONE_PER_CONTEXT: 'Un envío por persona y período para cada vehículo o servicio.'
	};

	const ICONO_TARGET: Record<TargetType, typeof Users> = {
		ALL_CONDUCTORS: Users,
		CONDUCTOR: UserRound,
		VEHICLE: Truck,
		SEDE: MapPin,
		GROUP: Layers,
		ALL_USERS: Building2,
		USER: UserCog,
		AREA: Briefcase,
		CARGO: IdCard
	};

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
		const [c, v, interna] = await Promise.all([
			conductoresAPI.getAll({ limit: 500 }).catch(() => null),
			vehiculosAPI.getAll().catch(() => null),
			asignacionesFormularioAPI.audienciaInterna().catch(() => null)
		]);

		usuarios = ordenarPorEtiqueta(interna?.usuarios ?? [], (u) => u.nombre);
		cargosConocidos = interna?.cargos ?? [];

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

	/// A un conductor el vehículo se le propone solo (los que tiene asignados);
	/// alguien de administración tendrá que buscarlo a mano en toda la flota. Es
	/// válido, pero conviene decirlo antes de guardar y no descubrirlo al abrir
	/// el formulario.
	const avisoAudienciaInterna = $derived(
		(exigeVehiculo || exigeServicio) && targets.some((t) => esTargetDeUsuario(t.type))
			? 'Esta asignación exige contexto (vehículo o servicio) y alcanza a personal interno: tendrán que elegirlo a mano de toda la flota.'
			: null
	);

	/**
	 * «Todos» es excluyente SOLO dentro de su familia.
	 *
	 * Antes `ALL_CONDUCTORS` reemplazaba el array entero, y eso impedía
	 * exactamente el caso para el que existen los targets de personal interno:
	 * una asignación que alcanza a todos los conductores Y al área de
	 * administración. Ahora `ALL_CONDUCTORS` solo anula los otros targets de
	 * conductor, `ALL_USERS` solo los de usuario, y los dos pueden convivir —que
	 * es la forma de decir «esto le aparece a todo el mundo».
	 */
	const tieneTodosConductores = $derived(targets.some((t) => t.type === 'ALL_CONDUCTORS'));
	const tieneTodosUsuarios = $derived(targets.some((t) => t.type === 'ALL_USERS'));

	function bloqueado(type: TargetType): boolean {
		if (type === 'ALL_CONDUCTORS' || type === 'ALL_USERS') return false;
		return esTargetDeUsuario(type) ? tieneTodosUsuarios : tieneTodosConductores;
	}

	function agregarTarget(type: TargetType) {
		const familiaDeUsuario = esTargetDeUsuario(type);
		/// Los de la OTRA familia se conservan siempre; solo se filtra dentro de
		/// la propia.
		const otros = targets.filter((t) => esTargetDeUsuario(t.type) !== familiaDeUsuario);
		const mismos = targets.filter((t) => esTargetDeUsuario(t.type) === familiaDeUsuario);

		if (type === 'ALL_CONDUCTORS' || type === 'ALL_USERS') {
			targets = [...otros, { type }];
			return;
		}
		targets = [
			...otros,
			...mismos.filter((t) => t.type !== 'ALL_CONDUCTORS' && t.type !== 'ALL_USERS'),
			{ type }
		];
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
			if (t.type === 'CONDUCTOR' && !t.conductorId)
				return 'Falta elegir el conductor de un target.';
			if (t.type === 'VEHICLE' && !t.vehicleId) return 'Falta elegir el vehículo de un target.';
			if (t.type === 'SEDE' && !t.sede?.trim()) return 'Falta la sede de un target.';
			if (t.type === 'GROUP' && !t.groupKey?.trim()) return 'Falta la clave de grupo de un target.';
			if (t.type === 'USER' && !t.usuarioId) return 'Falta elegir el usuario de un target.';
			if (t.type === 'AREA' && !t.area) return 'Falta elegir el área de un target.';
			if (t.type === 'CARGO' && !t.cargo?.trim()) return 'Falta el cargo de un target.';
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
			groupKey: t.type === 'GROUP' ? t.groupKey?.trim() : null,
			usuarioId: t.type === 'USER' ? t.usuarioId : null,
			area: t.type === 'AREA' ? t.area : null,
			cargo: t.type === 'CARGO' ? t.cargo?.trim() : null
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

<ModalBase
	open
	eyebrow="Asignaciones"
	title={existing ? 'Editar asignación' : 'Nueva asignación'}
	subtitle={subtitulo}
	tamano="lg"
	cerrarAlFondo={false}
	bloqueado={guardando}
	oncerrar={onclose}
>
	<div class="ae">
		{#if existing}
			<p class="ae-aviso ae-aviso--info">
				<Info size={16} strokeWidth={2.2} />
				<span>
					La versión de una asignación no se puede cambiar: los envíos ya hechos la referencian.
					Para pasar a otra versión, cierra esta y crea una nueva.
				</span>
			</p>
		{/if}

		<section class="ae-seccion">
			<h3 class="ae-titulo">Datos generales</h3>
			<div class="ae-card ae-grid">
				<Campo id="{uid}-nombre" label="Nombre" requerido completo>
					<input
						id="{uid}-nombre"
						class="ae-input"
						bind:value={nombre}
						placeholder="Preoperacional camionetas diario"
					/>
				</Campo>
				<Campo id="{uid}-desde" label="Vigente desde">
					<input id="{uid}-desde" class="ae-input" type="datetime-local" bind:value={desde} />
				</Campo>
				<Campo id="{uid}-hasta" label="Vigente hasta" ayuda="Vacío = sin fecha de fin.">
					<input id="{uid}-hasta" class="ae-input" type="datetime-local" bind:value={hasta} />
				</Campo>
			</div>
		</section>

		<section class="ae-seccion">
			<h3 class="ae-titulo">Frecuencia y límite</h3>
			<div class="ae-card ae-pila">
				<fieldset class="ae-grupo">
					<legend class="ae-label">Frecuencia</legend>
					<div class="ae-chips">
						{#each ASSIGNMENT_FREQUENCIES as f (f)}
							<label class="ae-chip" class:ae-chip--activo={frecuencia === f}>
								<input
									type="radio"
									name="{uid}-frecuencia"
									value={f}
									class="ae-sr"
									bind:group={frecuencia}
								/>
								{#if frecuencia === f}<Check size={14} strokeWidth={3} />{/if}
								{FREQUENCY_LABELS[f]}
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="ae-grupo">
					<legend class="ae-label">Límite de envíos</legend>
					<div class="ae-opciones">
						{#each LIMIT_POLICIES as l (l)}
							<label class="ae-opcion" class:ae-opcion--activa={limite === l}>
								<input
									type="radio"
									name="{uid}-limite"
									value={l}
									class="ae-sr"
									bind:group={limite}
								/>
								<span class="ae-opcion-texto">
									<span class="ae-opcion-titulo">{LIMIT_POLICY_LABELS[l]}</span>
									<span class="ae-opcion-sub">{LIMITE_AYUDA[l]}</span>
								</span>
								<span class="ae-opcion-check" aria-hidden="true">
									<Check size={13} strokeWidth={3} />
								</span>
							</label>
						{/each}
					</div>
				</fieldset>
			</div>
		</section>

		<section class="ae-seccion">
			<h3 class="ae-titulo">Contexto y conexión</h3>
			<div class="ae-card ae-ajustes">
				<label class="ae-ajuste">
					<span class="ae-ajuste-texto">
						<span class="ae-ajuste-titulo">Exigir vehículo al abrir el formulario</span>
						<span class="ae-ajuste-sub"
							>Quien lo diligencia debe elegir el vehículo antes de empezar.</span
						>
					</span>
					<input type="checkbox" role="switch" class="ae-switch" bind:checked={exigeVehiculo} />
				</label>
				<label class="ae-ajuste">
					<span class="ae-ajuste-texto">
						<span class="ae-ajuste-titulo">Exigir servicio</span>
						<span class="ae-ajuste-sub"
							>Quien lo diligencia debe elegir el servicio al que corresponde.</span
						>
					</span>
					<input type="checkbox" role="switch" class="ae-switch" bind:checked={exigeServicio} />
				</label>
				{#if avisoContexto}
					<p class="ae-aviso">
						<TriangleAlert size={16} strokeWidth={2.2} />
						<span>{avisoContexto}</span>
					</p>
				{/if}
				<label class="ae-ajuste">
					<span class="ae-ajuste-texto">
						<span class="ae-ajuste-titulo">Permitir diligenciar sin conexión</span>
						<span class="ae-ajuste-sub">Útil en rutas o sitios sin señal.</span>
					</span>
					<input type="checkbox" role="switch" class="ae-switch" bind:checked={permitirOffline} />
				</label>
			</div>
		</section>

		<section class="ae-seccion">
			<h3 class="ae-titulo">
				A quién le aparece
				<span class="ae-conteo">{targets.length}</span>
			</h3>
			<div class="ae-card ae-pila">
				<!--
					Dos grupos de botones y no una sola lista: la separación es lo que
					comunica que los targets de un grupo y los del otro NO compiten
					entre sí, y que marcar ambos es una combinación normal.
				-->
				<div class="ae-familias">
					<div class="ae-familia">
						<p class="ae-label">Conductores</p>
						<div class="ae-chips">
							{#each CONDUCTOR_TARGET_TYPES as type (type)}
								<button
									type="button"
									class="ae-chip ae-chip--agregar"
									disabled={bloqueado(type)}
									onclick={() => agregarTarget(type)}
								>
									<Plus size={14} strokeWidth={2.6} />
									{TARGET_TYPE_LABELS[type]}
								</button>
							{/each}
						</div>
					</div>
					<div class="ae-familia">
						<p class="ae-label">Personal interno</p>
						<div class="ae-chips">
							{#each USER_TARGET_TYPES as type (type)}
								<button
									type="button"
									class="ae-chip ae-chip--agregar"
									disabled={bloqueado(type)}
									onclick={() => agregarTarget(type)}
								>
									<Plus size={14} strokeWidth={2.6} />
									{TARGET_TYPE_LABELS[type]}
								</button>
							{/each}
						</div>
					</div>
				</div>

				{#if avisoAudienciaInterna}
					<p class="ae-aviso">
						<TriangleAlert size={16} strokeWidth={2.2} />
						<span>{avisoAudienciaInterna}</span>
					</p>
				{/if}

				{#if targets.length === 0}
					<p class="ae-vacio">Agrega al menos un destinatario con los botones de arriba.</p>
				{:else}
					<ul class="ae-targets">
						{#each targets as target, i (i)}
							{@const Icono = ICONO_TARGET[target.type]}
							<li class="ae-target">
								<span class="ae-target-icono" aria-hidden="true"><Icono size={18} /></span>
								<div class="ae-target-cuerpo">
									<span class="ae-target-tipo">
										{TARGET_TYPE_LABELS[target.type]}
										<span class="ae-target-familia">
											{esTargetDeUsuario(target.type) ? 'Personal interno' : 'Conductores'}
										</span>
									</span>

									{#if target.type === 'CONDUCTOR'}
										<select
											class="ae-input"
											aria-label="Conductor del target {i + 1}"
											value={target.conductorId ?? ''}
											onchange={(e) =>
												actualizarTarget(i, { conductorId: e.currentTarget.value || null })}
										>
											<option value="">Selecciona conductor…</option>
											{#each conductores as c (c.id)}
												<option value={c.id}>{c.nombre}</option>
											{/each}
										</select>
									{:else if target.type === 'VEHICLE'}
										<select
											class="ae-input"
											aria-label="Vehículo del target {i + 1}"
											value={target.vehicleId ?? ''}
											onchange={(e) =>
												actualizarTarget(i, { vehicleId: e.currentTarget.value || null })}
										>
											<option value="">Selecciona vehículo…</option>
											{#each vehiculos as v (v.id)}
												<option value={v.id}>{v.placa}</option>
											{/each}
										</select>
									{:else if target.type === 'SEDE'}
										<input
											class="ae-input"
											aria-label="Sede del target {i + 1}"
											placeholder="Sede"
											value={target.sede ?? ''}
											oninput={(e) => actualizarTarget(i, { sede: e.currentTarget.value })}
										/>
									{:else if target.type === 'GROUP'}
										<input
											class="ae-input"
											aria-label="Clave del grupo del target {i + 1}"
											placeholder="Clave del grupo"
											value={target.groupKey ?? ''}
											oninput={(e) => actualizarTarget(i, { groupKey: e.currentTarget.value })}
										/>
									{:else if target.type === 'USER'}
										<select
											class="ae-input"
											aria-label="Usuario del target {i + 1}"
											value={target.usuarioId ?? ''}
											onchange={(e) =>
												actualizarTarget(i, { usuarioId: e.currentTarget.value || null })}
										>
											<option value="">Selecciona usuario…</option>
											{#each usuarios as u (u.id)}
												<option value={u.id}>{u.nombre}{u.cargo ? ` — ${u.cargo}` : ''}</option>
											{/each}
										</select>
									{:else if target.type === 'AREA'}
										<select
											class="ae-input"
											aria-label="Área del target {i + 1}"
											value={target.area ?? ''}
											onchange={(e) => actualizarTarget(i, { area: e.currentTarget.value || null })}
										>
											<option value="">Selecciona área…</option>
											{#each AREAS as area (area)}
												<option value={area}>{AREA_LABELS[area as Area]}</option>
											{/each}
										</select>
									{:else if target.type === 'CARGO'}
										<!--
											`users.cargo` es texto libre: el `datalist` ofrece los que ya
											existen porque un cargo escrito distinto al de la ficha del
											usuario crea un target que no alcanza a nadie, y sin ningún
											error visible.
										-->
										<input
											class="ae-input"
											aria-label="Cargo del target {i + 1}"
											list="cargos-conocidos"
											placeholder="Cargo"
											value={target.cargo ?? ''}
											oninput={(e) => actualizarTarget(i, { cargo: e.currentTarget.value })}
										/>
									{:else if target.type === 'ALL_USERS'}
										<span class="ae-target-nota">Alcanza a todo el personal interno activo.</span>
									{:else}
										<span class="ae-target-nota">Alcanza a todos los conductores activos.</span>
									{/if}
								</div>

								{#if targets.length > 1}
									<button
										type="button"
										class="ae-quitar"
										aria-label="Quitar target {i + 1}"
										onclick={() => quitarTarget(i)}
									>
										<X size={16} strokeWidth={2.4} />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<datalist id="cargos-conocidos">
					{#each cargosConocidos as cargo (cargo)}
						<option value={cargo}></option>
					{/each}
				</datalist>
			</div>
		</section>
	</div>

	{#snippet pie()}
		<button type="button" class="btn-secondary" disabled={guardando} onclick={onclose}>
			Cancelar
		</button>
		<button type="button" class="btn-primary" disabled={guardando} onclick={guardar}>
			{guardando ? 'Guardando…' : existing ? 'Guardar cambios' : 'Crear asignación'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.ae {
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.ae-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Secciones: título en negrita sobre una tarjeta blanca, como en la app. */
	.ae-seccion {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.ae-titulo {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-primary);
		font-size: 17px;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.ae-conteo {
		min-width: 24px;
		height: 24px;
		padding: 0 7px;
		display: inline-grid;
		place-items: center;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accion) 12%, transparent);
		color: var(--color-emerald-600);
		font-size: 12px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.ae-card {
		padding: 16px;
		border-radius: 18px;
		background: var(--bg-surface);
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}
	.ae-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.ae-grid :global(.de-full) {
		grid-column: 1 / -1;
	}
	.ae-pila {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	/* Controles con el aspecto de `.de-input` de los formularios de directorio. */
	.ae-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		font-variant-numeric: tabular-nums;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.ae-input::placeholder {
		color: var(--text-very-muted);
		opacity: 1;
	}
	.ae-input:focus,
	.ae-input:focus-visible {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}

	.ae-grupo {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ae-label {
		margin: 0;
		padding: 0;
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}

	/* Chips: elección de frecuencia y botones para agregar destinatarios. */
	.ae-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.ae-chip {
		min-height: 38px;
		padding: 0 14px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1.5px solid var(--border-default);
		border-radius: 999px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s,
			color 0.15s;
	}
	.ae-chip:hover:not(:disabled) {
		border-color: var(--border-emphasis);
	}
	.ae-chip:has(input:focus-visible),
	.ae-chip:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.ae-chip--activo,
	.ae-chip--activo:hover:not(:disabled) {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 9%, var(--bg-surface));
		color: var(--color-emerald-600);
	}
	.ae-chip--agregar {
		color: var(--color-emerald-600);
	}
	.ae-chip--agregar:hover:not(:disabled) {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
	}
	.ae-chip:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Tarjetas de opción para el límite de envíos. */
	.ae-opciones {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}
	.ae-opcion {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 14px;
		border: 1.5px solid var(--border-default);
		border-radius: 16px;
		background: var(--bg-surface);
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.ae-opcion:hover {
		border-color: var(--border-emphasis);
	}
	.ae-opcion:has(input:focus-visible) {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.ae-opcion--activa,
	.ae-opcion--activa:hover {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
	}
	.ae-opcion-texto {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.ae-opcion-titulo {
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 800;
	}
	.ae-opcion-sub {
		color: var(--text-muted);
		font-size: 12px;
		line-height: 1.4;
	}
	.ae-opcion-check {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border: 1.5px solid var(--border-default);
		border-radius: 999px;
		color: transparent;
	}
	.ae-opcion--activa .ae-opcion-check {
		border-color: var(--accion);
		background: var(--accion);
		color: #fff;
	}

	/* Ajustes con interruptor, uno por fila. */
	.ae-ajustes {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-block: 8px;
	}
	.ae-ajuste {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 0;
		cursor: pointer;
	}
	.ae-ajuste + .ae-ajuste {
		border-top: 1px solid var(--border-subtle);
	}
	.ae-ajuste-texto {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.ae-ajuste-titulo {
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 700;
	}
	.ae-ajuste-sub {
		color: var(--text-muted);
		font-size: 12px;
	}
	.ae-switch {
		position: relative;
		flex-shrink: 0;
		width: 44px;
		height: 26px;
		margin: 0;
		appearance: none;
		border-radius: 999px;
		background: var(--border-default);
		cursor: pointer;
		transition: background 0.18s;
	}
	.ae-switch::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 20px;
		height: 20px;
		border-radius: 999px;
		background: #fff;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		transition: transform 0.18s;
	}
	.ae-switch:checked {
		background: var(--accion);
	}
	.ae-switch:checked::after {
		transform: translateX(18px);
	}
	.ae-switch:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 22%, transparent);
	}

	/* Destinatarios. */
	.ae-familias {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
	}
	.ae-familia {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.ae-targets {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	/* Rejilla: ícono, tipo y quitar arriba; el control debajo, a todo el ancho
	   disponible (en el teléfono, desde el borde del ícono). */
	.ae-target {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px 12px;
		padding: 12px;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		background: var(--bg-base);
	}
	.ae-target-icono {
		grid-column: 1;
		grid-row: 1;
		width: 38px;
		height: 38px;
		display: grid;
		place-items: center;
		border-radius: 12px;
		background: color-mix(in srgb, var(--accion) 12%, var(--bg-surface));
		color: var(--color-emerald-600);
	}
	.ae-target-cuerpo {
		display: contents;
	}
	.ae-target-tipo {
		grid-column: 2;
		grid-row: 1;
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 2px 8px;
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 800;
		line-height: 1.3;
	}
	.ae-target-familia {
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}
	.ae-target .ae-input,
	.ae-target-nota {
		grid-column: 2 / -1;
		grid-row: 2;
	}
	.ae-target-nota {
		margin-top: -4px;
		color: var(--text-muted);
		font-size: 12px;
	}
	.ae-quitar {
		grid-column: 3;
		grid-row: 1;
		width: 34px;
		height: 34px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border: 1px solid var(--border-default);
		border-radius: 999px;
		background: var(--bg-surface);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.ae-quitar:hover {
		border-color: #fecaca;
		background: #fef2f2;
		color: #b91c1c;
	}
	.ae-quitar:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.ae-vacio {
		margin: 0;
		padding: 14px;
		border: 1.5px dashed var(--border-default);
		border-radius: 16px;
		color: var(--text-muted);
		font-size: 13px;
		text-align: center;
	}

	/* Avisos: ámbar para advertencias, neutro con la marca para información. */
	.ae-aviso {
		margin: 0;
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 14px;
		border: 1px solid #fde68a;
		border-radius: 14px;
		background: #fffbeb;
		color: #92400e;
		font-size: 13px;
		line-height: 1.45;
	}
	.ae-aviso :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}
	.ae-aviso--info {
		border-color: color-mix(in srgb, var(--accion) 22%, transparent);
		background: color-mix(in srgb, var(--accion) 7%, var(--bg-surface));
		color: var(--text-secondary);
	}
	.ae-aviso--info :global(svg) {
		color: var(--color-emerald-600);
	}

	@media (max-width: 640px) {
		.ae-grid,
		.ae-familias,
		.ae-opciones {
			grid-template-columns: minmax(0, 1fr);
		}
		.ae-target .ae-input {
			grid-column: 1 / -1;
		}
	}
</style>
