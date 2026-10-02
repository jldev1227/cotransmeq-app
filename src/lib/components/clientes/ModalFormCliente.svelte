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
	import { clientesAPI } from '$lib/api/apiClient';

	/**
	 * Crear y editar un cliente en el mismo modal (antes: página `/agregar`
	 * para crear y edición en línea, sin validación, en el detalle).
	 *
	 * Solo se envían los campos editables. El detalle mandaba el registro
	 * entero —con `createdAt`, `_count` y relaciones— y un correo vacío como
	 * `''`, que el backend rechaza por formato.
	 */
	interface Props {
		open: boolean;
		clienteId?: string | null;
		onclose: () => void;
		onguardado?: (cliente: any) => void;
	}

	let { open, clienteId = null, onclose, onguardado }: Props = $props();

	type Tipo = 'EMPRESA' | 'PERSONA_NATURAL';

	const TABS = [
		{ id: 'identificacion', label: 'Identificación' },
		{ id: 'contacto', label: 'Contacto' },
		{ id: 'condiciones', label: 'Condiciones' }
	];
	const CAMPO_TAB: Record<string, string> = {
		tipo: 'identificacion',
		nombre: 'identificacion',
		nit: 'identificacion',
		representante: 'identificacion',
		cedula: 'identificacion',
		telefono: 'contacto',
		correo: 'contacto',
		direccion: 'contacto'
	};

	const vacio = () => ({
		tipo: 'EMPRESA' as Tipo,
		nombre: '',
		nit: '',
		representante: '',
		cedula: '',
		telefono: '',
		correo: '',
		direccion: '',
		requiere_osi: false,
		paga_recargos: false
	});

	let form = $state(vacio());
	let original = $state(JSON.stringify(vacio()));
	let errores = $state<Errores>({});
	let intentoGuardar = $state(false);
	let tab = $state('identificacion');
	let cargando = $state(false);
	let guardando = $state(false);

	const editando = $derived(Boolean(clienteId));
	const sucio = $derived(hayCambios(form, JSON.parse(original)));
	const esEmpresa = $derived(form.tipo === 'EMPRESA');

	$effect(() => {
		if (!open) return;
		tab = 'identificacion';
		errores = {};
		intentoGuardar = false;
		const base = vacio();
		form = base;
		original = JSON.stringify(base);
		if (clienteId) void cargar(clienteId);
	});

	async function cargar(id: string) {
		cargando = true;
		try {
			const r = (await clientesAPI.getById(id)).data;
			const c = r?.data ?? r;
			const datos = {
				tipo: (c.tipo === 'EMPRESA' ? 'EMPRESA' : 'PERSONA_NATURAL') as Tipo,
				nombre: c.nombre ?? '',
				nit: c.nit ?? '',
				representante: c.representante ?? '',
				cedula: c.cedula ?? '',
				telefono: c.telefono ?? '',
				correo: c.correo ?? '',
				direccion: c.direccion ?? '',
				requiere_osi: Boolean(c.requiere_osi),
				paga_recargos: Boolean(c.paga_recargos)
			};
			form = datos;
			original = JSON.stringify(datos);
		} catch (e) {
			avisarErrorGuardado(errorDeApi(e, 'No se pudo cargar el cliente.').mensaje, false);
			onclose();
		} finally {
			cargando = false;
		}
	}

	function validar(): Errores {
		const e: Errores = {};
		if (!form.nombre.trim())
			e.nombre = esEmpresa ? 'La razón social es obligatoria.' : 'El nombre es obligatorio.';
		if (!form.nit.trim())
			e.nit = esEmpresa ? 'El NIT es obligatorio.' : 'La cédula es obligatoria.';
		if (esEmpresa && !form.representante.trim())
			e.representante = 'El representante legal es obligatorio.';
		if (!form.telefono.trim()) e.telefono = 'El teléfono es obligatorio.';
		if (form.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim()))
			e.correo = 'El correo no es válido.';
		if (!form.direccion.trim()) e.direccion = 'La dirección es obligatoria.';
		return e;
	}

	$effect(() => {
		if (intentoGuardar) errores = validar();
	});

	const textoONull = (v: string) => (v.trim() === '' ? null : v.trim());

	function payload() {
		return {
			tipo: form.tipo,
			nombre: form.nombre.trim(),
			nit: textoONull(form.nit),
			representante: esEmpresa ? textoONull(form.representante) : null,
			/// El backend exige cédula a una persona natural; si no se escribió
			/// aparte, es el mismo número de documento.
			cedula: esEmpresa ? null : (textoONull(form.cedula) ?? textoONull(form.nit)),
			telefono: textoONull(form.telefono),
			correo: textoONull(form.correo),
			direccion: textoONull(form.direccion),
			requiere_osi: form.requiere_osi,
			paga_recargos: form.paga_recargos
		};
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
			const r = clienteId
				? await clientesAPI.update(clienteId, datos)
				: await clientesAPI.create(datos);
			avisarGuardado('Cliente', datos.nombre, !editando);
			original = JSON.stringify(form);
			onguardado?.(r.data?.data ?? r.data);
			onclose();
		} catch (e) {
			const { mensaje } = errorDeApi(e, 'Error al guardar el cliente.');
			if (/NIT/i.test(mensaje)) {
				errores = { ...errores, nit: mensaje };
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
	eyebrow={editando ? 'EDITAR CLIENTE' : 'NUEVO CLIENTE'}
	title={editando ? form.nombre || 'Cliente' : 'Registrar cliente'}
	subtitle={editando
		? `${esEmpresa ? 'NIT' : 'C.C.'} ${form.nit}`
		: 'Los campos con * son obligatorios.'}
	tabs={TABS}
	bind:tabActiva={tab}
	erroresPorTab={conteo}
	{cargando}
	{guardando}
	{sucio}
	textoGuardar={editando ? 'Guardar cambios' : 'Registrar cliente'}
	onguardar={guardar}
	oncerrar={onclose}
>
	{#snippet children(activa)}
		<div class="de-grid">
			{#if activa === 'identificacion'}
				<fieldset class="tipo de-full">
					<legend>Tipo de cliente</legend>
					<label class="opcion" class:activa={esEmpresa}>
						<input type="radio" name="cl-tipo" value="EMPRESA" bind:group={form.tipo} />
						<span><strong>Empresa</strong><small>Persona jurídica</small></span>
					</label>
					<label class="opcion" class:activa={!esEmpresa}>
						<input type="radio" name="cl-tipo" value="PERSONA_NATURAL" bind:group={form.tipo} />
						<span><strong>Persona natural</strong><small>Persona física</small></span>
					</label>
				</fieldset>
				<Campo
					id="cl-nombre"
					label={esEmpresa ? 'Razón social' : 'Nombre completo'}
					requerido
					error={errores.nombre}
					completo
				>
					<input
						id="cl-nombre"
						placeholder={esEmpresa
							? 'Ej. Transportes del Llano S.A.S.'
							: 'Ej. María Fernanda López'}
						class="de-input"
						bind:value={form.nombre}
						aria-invalid={inv('nombre')}
					/>
				</Campo>
				<Campo
					id="cl-nit"
					label={esEmpresa ? 'NIT' : 'Número de documento'}
					requerido
					error={errores.nit}
				>
					<input
						id="cl-nit"
						placeholder={esEmpresa ? 'Ej. 900123456-1' : 'Ej. 1098765432'}
						class="de-input"
						bind:value={form.nit}
						aria-invalid={inv('nit')}
					/>
				</Campo>
				{#if esEmpresa}
					<Campo
						id="cl-representante"
						label="Representante legal"
						requerido
						error={errores.representante}
					>
						<input
							id="cl-representante"
							placeholder="Nombre del representante legal"
							class="de-input"
							bind:value={form.representante}
							aria-invalid={inv('representante')}
						/>
					</Campo>
				{:else}
					<Campo
						id="cl-cedula"
						label="Cédula"
						ayuda="Si la dejas vacía, se usa el número de documento."
						error={errores.cedula}
					>
						<input
							id="cl-cedula"
							placeholder="Ej. 1098765432"
							class="de-input"
							inputmode="numeric"
							bind:value={form.cedula}
							aria-invalid={inv('cedula')}
						/>
					</Campo>
				{/if}
			{:else if activa === 'contacto'}
				<Campo id="cl-telefono" label="Teléfono" requerido error={errores.telefono}>
					<input
						id="cl-telefono"
						placeholder="Ej. 310 123 4567"
						class="de-input"
						type="tel"
						inputmode="tel"
						bind:value={form.telefono}
						aria-invalid={inv('telefono')}
					/>
				</Campo>
				<Campo id="cl-correo" label="Correo electrónico" error={errores.correo}>
					<input
						id="cl-correo"
						placeholder="facturacion@empresa.com"
						class="de-input"
						type="email"
						bind:value={form.correo}
						aria-invalid={inv('correo')}
					/>
				</Campo>
				<Campo id="cl-direccion" label="Dirección" requerido error={errores.direccion} completo>
					<textarea
						id="cl-direccion"
						placeholder="Ej. Calle 15 # 23-45, Yopal"
						class="de-input"
						rows="3"
						bind:value={form.direccion}
						aria-invalid={inv('direccion')}
					></textarea>
				</Campo>
			{:else}
				<label class="opcion de-full" class:activa={form.requiere_osi}>
					<input type="checkbox" bind:checked={form.requiere_osi} />
					<span
						><strong>Requiere OSI</strong><small
							>Sus servicios llevan orden de servicio (OSI) en la liquidación.</small
						></span
					>
				</label>
				<label class="opcion de-full" class:activa={form.paga_recargos}>
					<input type="checkbox" bind:checked={form.paga_recargos} />
					<span
						><strong>Paga recargos</strong><small
							>Se le liquidan los recargos por servicios adicionales.</small
						></span
					>
				</label>
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
