<script lang="ts">
	import ModalEntidad from '$lib/components/directorio/ModalEntidad.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import {
		avisarErrorGuardado,
		avisarErroresValidacion,
		avisarGuardado,
		errorDeApi,
		erroresPorTab,
		hayCambios,
		primeraTabConError,
		type Errores
	} from '$lib/components/directorio/formulario';
	import { tercerosAPI, type Tercero } from '$lib/api/terceros';

	/**
	 * Crear y editar un tercero con el mismo cascarón que flota, conductores y
	 * clientes (`ModalEntidad`). Antes el directorio de terceros tenía su propio
	 * modal, con otro aspecto y el error en un banner en vez de bajo el campo.
	 */
	interface Props {
		open: boolean;
		terceroId?: string | null;
		onclose: () => void;
		onguardado?: (tercero: Tercero) => void;
	}

	let { open, terceroId = null, onclose, onguardado }: Props = $props();

	/// `Tercero` en la API solo declara PERSONA | EMPRESA, pero la base admite
	/// los cuatro de `TipoPersonaEnum`.
	type TipoPersona = Tercero['tipo_persona'] | 'PROPIETARIO_VEHICULO' | 'PROVEEDOR';

	/// Los cuatro de `TipoPersonaEnum`. El modal anterior solo ofrecía los dos
	/// primeros: un tercero importado desde vehículos se abría sin ninguno
	/// marcado.
	const TIPOS: [TipoPersona, string, string][] = [
		['PERSONA', 'Persona natural', 'Identificada con cédula'],
		['EMPRESA', 'Empresa', 'Persona jurídica, con NIT'],
		['PROPIETARIO_VEHICULO', 'Propietario de vehículo', 'Dueño de un vehículo afiliado'],
		['PROVEEDOR', 'Proveedor', 'Presta bienes o servicios']
	];

	const REGIMENES = [
		['', 'Sin especificar'],
		['SIMPLIFICADO', 'Simplificado'],
		['COMUN', 'Común'],
		['GRAN_CONTRIBUYENTE', 'Gran contribuyente'],
		['NO_RESPONSABLE', 'No responsable'],
		['AUTORRETENEDOR', 'Autorretenedor'],
		['ORDINARIO', 'Ordinario']
	] as const;

	const TABS = [
		{ id: 'identificacion', label: 'Identificación' },
		{ id: 'contacto', label: 'Contacto' },
		{ id: 'notas', label: 'Notas' }
	];
	const CAMPO_TAB: Record<string, string> = {
		tipo_persona: 'identificacion',
		nombre_completo: 'identificacion',
		identificacion: 'identificacion',
		regimen: 'identificacion',
		telefono: 'contacto',
		correo: 'contacto',
		direccion: 'contacto',
		notas: 'notas'
	};

	const vacio = () => ({
		tipo_persona: 'PERSONA' as TipoPersona,
		nombre_completo: '',
		identificacion: '',
		regimen: '',
		telefono: '',
		correo: '',
		direccion: '',
		notas: ''
	});

	let form = $state(vacio());
	let original = $state(JSON.stringify(vacio()));
	let errores = $state<Errores>({});
	let intentoGuardar = $state(false);
	let tab = $state('identificacion');
	let cargando = $state(false);
	let guardando = $state(false);

	const editando = $derived(Boolean(terceroId));
	const sucio = $derived(hayCambios(form, JSON.parse(original)));
	const esEmpresa = $derived(form.tipo_persona === 'EMPRESA');

	$effect(() => {
		if (!open) return;
		tab = 'identificacion';
		errores = {};
		intentoGuardar = false;
		const base = vacio();
		form = base;
		original = JSON.stringify(base);
		if (terceroId) void cargar(terceroId);
	});

	async function cargar(id: string) {
		cargando = true;
		try {
			const t = await tercerosAPI.obtenerPorId(id);
			const datos = {
				tipo_persona: t.tipo_persona as TipoPersona,
				nombre_completo: t.nombre_completo ?? '',
				identificacion: t.identificacion ?? '',
				regimen: t.regimen ?? '',
				telefono: t.telefono ?? '',
				correo: t.correo ?? '',
				direccion: t.direccion ?? '',
				notas: t.notas ?? ''
			};
			form = datos;
			original = JSON.stringify(datos);
		} catch (e) {
			avisarErrorGuardado(errorDeApi(e, 'No se pudo cargar el tercero.').mensaje, false);
			onclose();
		} finally {
			cargando = false;
		}
	}

	function validar(): Errores {
		const e: Errores = {};
		if (!form.nombre_completo.trim())
			e.nombre_completo = esEmpresa
				? 'La razón social es obligatoria.'
				: 'El nombre es obligatorio.';
		if (form.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim()))
			e.correo = 'El correo no es válido.';
		return e;
	}

	$effect(() => {
		if (intentoGuardar) errores = validar();
	});

	const textoONull = (v: string) => (v.trim() === '' ? null : v.trim());

	function payload() {
		return {
			tipo_persona: form.tipo_persona,
			nombre_completo: form.nombre_completo.trim(),
			identificacion: textoONull(form.identificacion),
			regimen: form.regimen || null,
			telefono: textoONull(form.telefono),
			correo: textoONull(form.correo),
			direccion: textoONull(form.direccion),
			notas: textoONull(form.notas)
		} as Partial<Tercero>;
	}

	async function guardar() {
		intentoGuardar = true;
		errores = validar();
		if (Object.keys(errores).length) {
			tab =
				primeraTabConError(
					errores,
					CAMPO_TAB,
					TABS.map((t) => t.id)
				) ?? tab;
			avisarErroresValidacion(errores);
			return;
		}
		guardando = true;
		try {
			const datos = payload();
			const t = terceroId
				? await tercerosAPI.actualizar(terceroId, datos)
				: await tercerosAPI.crear(datos);
			avisarGuardado('Tercero', form.nombre_completo.trim(), !editando);
			original = JSON.stringify(form);
			onguardado?.(t);
			onclose();
		} catch (e) {
			const { mensaje } = errorDeApi(e, 'Error al guardar el tercero.');
			if (/identificaci/i.test(mensaje)) {
				errores = { ...errores, identificacion: mensaje };
				tab = 'identificacion';
			} else if (/correo/i.test(mensaje)) {
				errores = { ...errores, correo: mensaje };
				tab = 'contacto';
			}
			avisarErrorGuardado(mensaje, !editando);
		} finally {
			guardando = false;
		}
	}

	const conteo = $derived(erroresPorTab(errores, CAMPO_TAB));
	const inv = (k: string) => (errores[k] ? 'true' : undefined);
</script>

<ModalEntidad
	{open}
	eyebrow={editando ? 'EDITAR TERCERO' : 'NUEVO TERCERO'}
	title={editando ? form.nombre_completo || 'Tercero' : 'Registrar tercero'}
	subtitle={editando
		? form.identificacion || 'Sin identificación'
		: 'Los campos con * son obligatorios.'}
	tabs={TABS}
	bind:tabActiva={tab}
	erroresPorTab={conteo}
	{cargando}
	{guardando}
	{sucio}
	textoGuardar={editando ? 'Guardar cambios' : 'Registrar tercero'}
	onguardar={guardar}
	oncerrar={onclose}
>
	{#snippet children(activa)}
		<div class="de-grid">
			{#if activa === 'identificacion'}
				<fieldset class="tipo de-full">
					<legend>Tipo de tercero</legend>
					{#each TIPOS as [valor, titulo, detalle] (valor)}
						<label class="opcion" class:activa={form.tipo_persona === valor}>
							<input type="radio" name="t-tipo" value={valor} bind:group={form.tipo_persona} />
							<span><strong>{titulo}</strong><small>{detalle}</small></span>
						</label>
					{/each}
				</fieldset>
				<Campo
					id="t-nombre"
					label={esEmpresa ? 'Razón social' : 'Nombre completo'}
					requerido
					error={errores.nombre_completo}
					completo
				>
					<input
						id="t-nombre"
						placeholder={esEmpresa ? 'Ej. Transportes del Llano S.A.S.' : 'Ej. Pedro Antonio Ruiz'}
						class="de-input"
						bind:value={form.nombre_completo}
						aria-invalid={inv('nombre_completo')}
					/>
				</Campo>
				<Campo
					id="t-identificacion"
					label={esEmpresa ? 'NIT' : 'Identificación'}
					error={errores.identificacion}
				>
					<input
						id="t-identificacion"
						class="de-input"
						placeholder={esEmpresa ? '900123456-1' : '12345678'}
						bind:value={form.identificacion}
						aria-invalid={inv('identificacion')}
					/>
				</Campo>
				<Campo id="t-regimen" label="Régimen fiscal">
					<select id="t-regimen" class="de-input" bind:value={form.regimen}>
						{#each REGIMENES as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</Campo>
			{:else if activa === 'contacto'}
				<Campo id="t-telefono" label="Teléfono">
					<input
						id="t-telefono"
						placeholder="Ej. 310 123 4567"
						class="de-input"
						type="tel"
						inputmode="tel"
						bind:value={form.telefono}
					/>
				</Campo>
				<Campo id="t-correo" label="Correo electrónico" error={errores.correo}>
					<input
						id="t-correo"
						placeholder="nombre@correo.com"
						class="de-input"
						type="email"
						bind:value={form.correo}
						aria-invalid={inv('correo')}
					/>
				</Campo>
				<Campo id="t-direccion" label="Dirección" completo>
					<input
						id="t-direccion"
						placeholder="Ej. Calle 15 # 23-45, Yopal"
						class="de-input"
						bind:value={form.direccion}
					/>
				</Campo>
			{:else}
				<Campo id="t-notas" label="Notas" ayuda="Visibles solo para el equipo." completo>
					<textarea
						id="t-notas"
						placeholder="Información útil para el equipo: acuerdos, contactos, observaciones…"
						class="de-input"
						rows="6"
						bind:value={form.notas}
					></textarea>
				</Campo>
			{/if}
		</div>
	{/snippet}
</ModalEntidad>

<style>
	.tipo {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.tipo legend {
		margin-bottom: 6px;
		padding: 0;
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}
	.opcion {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 14px;
		border: 1px solid var(--border-default);
		border-radius: 14px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.opcion.activa {
		border-color: var(--accion);
		background: color-mix(in srgb, var(--accion) 6%, transparent);
	}
	.opcion input {
		margin-top: 3px;
		accent-color: var(--accion);
	}
	.opcion span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.opcion strong {
		color: var(--text-primary);
		font-size: 14px;
	}
	.opcion small {
		color: var(--text-muted);
		font-size: 12.5px;
		line-height: 1.4;
	}
	@media (max-width: 640px) {
		.tipo {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
