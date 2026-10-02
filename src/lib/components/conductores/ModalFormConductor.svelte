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
	import { conductoresAPI } from '$lib/api/apiClient';
	import { normalizarNombrePersona } from '$lib/utils/nombre-persona';

	/**
	 * Crear y editar un conductor en el mismo modal (antes: página `/agregar`
	 * para crear y edición en línea en el detalle, con opciones distintas en
	 * cada sitio). Las pestañas son las del detalle: personal, laboral,
	 * seguridad social y licencia.
	 *
	 * La foto no está aquí: se sube sola, al instante, desde el detalle.
	 */
	interface Props {
		open: boolean;
		conductorId?: string | null;
		onclose: () => void;
		/** Recibe el conductor guardado tal como lo devolvió el servidor. */
		onguardado?: (conductor: any) => void;
	}

	let { open, conductorId = null, onclose, onguardado }: Props = $props();

	/**
	 * Todos los valores de `enum_conductores_estado`, en minúscula como los
	 * guarda la base. El detalle solo conocía seis: un conductor `suspendido`
	 * o `incapacidad` se cargaba como ACTIVO y quedaba activo al guardar
	 * cualquier otro cambio.
	 */
	const ESTADOS = [
		['activo', 'Activo'],
		['disponible', 'Disponible'],
		['programado', 'Programado'],
		['servicio', 'En servicio'],
		['descanso', 'Descanso'],
		['vacaciones', 'Vacaciones'],
		['incapacidad', 'Incapacidad'],
		['suspendido', 'Suspendido'],
		['inactivo', 'Inactivo'],
		['retirado', 'Retirado'],
		['desvinculado', 'Desvinculado']
	] as const;
	/// Nombres viejos que aún llegan de registros antiguos.
	const SINONIMOS_ESTADO: Record<string, string> = {
		incapacitado: 'incapacidad',
		en_servicio: 'servicio'
	};

	const SEDES = [
		['', 'Sin asignar'],
		['YOPAL', 'Yopal'],
		['VILLANUEVA', 'Villanueva'],
		['TAURAMENA', 'Tauramena']
	] as const;
	const TIPOS_ID = [
		['CC', 'Cédula de ciudadanía'],
		['CE', 'Cédula de extranjería'],
		['PA', 'Pasaporte'],
		['TI', 'Tarjeta de identidad']
	] as const;
	const GENEROS = [
		['', 'Sin especificar'],
		['MASCULINO', 'Masculino'],
		['FEMENINO', 'Femenino'],
		['OTRO', 'Otro']
	] as const;
	const SANGRE = [
		['', 'Sin especificar'],
		['A_POSITIVO', 'A+'],
		['A_NEGATIVO', 'A−'],
		['B_POSITIVO', 'B+'],
		['B_NEGATIVO', 'B−'],
		['AB_POSITIVO', 'AB+'],
		['AB_NEGATIVO', 'AB−'],
		['O_POSITIVO', 'O+'],
		['O_NEGATIVO', 'O−']
	] as const;
	const CONTRATOS = [
		['', 'Sin especificar'],
		['INDEFINIDO', 'Término indefinido'],
		['FIJO', 'Término fijo'],
		['OBRA_LABOR', 'Obra o labor'],
		['PRESTACION_SERVICIOS', 'Prestación de servicios']
	] as const;
	const LICENCIAS = ['', 'A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

	const TABS = [
		{ id: 'personal', label: 'Personal' },
		{ id: 'laboral', label: 'Laboral' },
		{ id: 'seguridad', label: 'Seguridad social' },
		{ id: 'licencia', label: 'Licencia' }
	];
	const CAMPO_TAB: Record<string, string> = {
		nombre: 'personal',
		apellido: 'personal',
		tipo_identificacion: 'personal',
		numero_identificacion: 'personal',
		fecha_nacimiento: 'personal',
		genero: 'personal',
		tipo_sangre: 'personal',
		telefono: 'personal',
		email: 'personal',
		direccion: 'personal',
		cargo: 'laboral',
		fecha_ingreso: 'laboral',
		salario_base: 'laboral',
		estado: 'laboral',
		tipo_contrato: 'laboral',
		sede_trabajo: 'laboral',
		eps: 'seguridad',
		fondo_pension: 'seguridad',
		arl: 'seguridad',
		categoria_licencia: 'licencia',
		vencimiento_licencia: 'licencia'
	};

	const hoy = () => new Date().toISOString().split('T')[0];
	const vacio = () => ({
		nombre: '',
		apellido: '',
		tipo_identificacion: 'CC',
		numero_identificacion: '',
		fecha_nacimiento: '',
		genero: '',
		tipo_sangre: '',
		telefono: '',
		email: '',
		direccion: '',
		cargo: 'CONDUCTOR',
		fecha_ingreso: hoy(),
		salario_base: '',
		estado: 'activo',
		tipo_contrato: 'INDEFINIDO',
		sede_trabajo: 'YOPAL',
		eps: '',
		fondo_pension: '',
		arl: '',
		categoria_licencia: '',
		vencimiento_licencia: ''
	});

	let form = $state(vacio());
	let original = $state(JSON.stringify(vacio()));
	let errores = $state<Errores>({});
	let intentoGuardar = $state(false);
	let tab = $state('personal');
	let cargando = $state(false);
	let guardando = $state(false);

	const editando = $derived(Boolean(conductorId));
	const sucio = $derived(hayCambios(form, JSON.parse(original)));
	const nombreCompleto = $derived(`${form.nombre} ${form.apellido}`.trim());

	$effect(() => {
		if (!open) return;
		tab = 'personal';
		errores = {};
		intentoGuardar = false;
		const base = vacio();
		form = base;
		original = JSON.stringify(base);
		if (conductorId) void cargar(conductorId);
	});

	const fecha = (v: unknown) => {
		if (!v) return '';
		const d = new Date(String(v));
		return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
	};

	function normalizarSangre(v: unknown): string {
		const t = String(v ?? '')
			.toUpperCase()
			.replace(/\s+/g, '');
		const mapa: Record<string, string> = {
			'A+': 'A_POSITIVO',
			'A-': 'A_NEGATIVO',
			'B+': 'B_POSITIVO',
			'B-': 'B_NEGATIVO',
			'AB+': 'AB_POSITIVO',
			'AB-': 'AB_NEGATIVO',
			'O+': 'O_POSITIVO',
			'O-': 'O_NEGATIVO'
		};
		return mapa[t] ?? (SANGRE.some(([s]) => s === t) ? t : '');
	}

	function normalizarGenero(v: unknown): string {
		const t = String(v ?? '').toUpperCase();
		if (t === 'M' || t === 'MASCULINO') return 'MASCULINO';
		if (t === 'F' || t === 'FEMENINO') return 'FEMENINO';
		if (t.startsWith('OTRO')) return 'OTRO';
		return '';
	}

	async function cargar(id: string) {
		cargando = true;
		try {
			const r = (await conductoresAPI.getById(id)).data;
			const c = r?.data ?? r;
			const estado = String(c.estado ?? 'activo').toLowerCase();
			const datos = {
				nombre: c.nombre ?? '',
				apellido: c.apellido ?? '',
				tipo_identificacion: c.tipo_identificacion ?? 'CC',
				numero_identificacion: c.numero_identificacion ?? '',
				fecha_nacimiento: fecha(c.fecha_nacimiento),
				genero: normalizarGenero(c.genero),
				tipo_sangre: normalizarSangre(c.tipo_sangre),
				telefono: c.telefono ?? '',
				email: c.email ?? '',
				direccion: c.direccion ?? '',
				cargo: c.cargo ?? 'CONDUCTOR',
				fecha_ingreso: fecha(c.fecha_ingreso),
				salario_base: c.salario_base != null ? String(c.salario_base) : '',
				estado: SINONIMOS_ESTADO[estado] ?? estado,
				tipo_contrato: c.tipo_contrato ?? '',
				sede_trabajo: String(c.sede_trabajo ?? '').toUpperCase(),
				eps: c.eps ?? '',
				fondo_pension: c.fondo_pension ?? '',
				arl: c.arl ?? '',
				categoria_licencia: c.categoria_licencia ?? '',
				vencimiento_licencia: fecha(c.vencimiento_licencia)
			};
			form = datos;
			original = JSON.stringify(datos);
		} catch (e) {
			avisarErrorGuardado(errorDeApi(e, 'No se pudo cargar el conductor.').mensaje, false);
			onclose();
		} finally {
			cargando = false;
		}
	}

	function validar(): Errores {
		const e: Errores = {};
		if (!normalizarNombrePersona(form.nombre)) e.nombre = 'El nombre es obligatorio.';
		if (!normalizarNombrePersona(form.apellido)) e.apellido = 'El apellido es obligatorio.';
		const id = form.numero_identificacion.trim();
		if (!id) e.numero_identificacion = 'La identificación es obligatoria.';
		if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
			e.email = 'El correo no es válido.';
		if (form.salario_base !== '' && form.salario_base != null && !(Number(form.salario_base) >= 0))
			e.salario_base = 'Debe ser un valor numérico.';
		if (
			form.vencimiento_licencia &&
			form.fecha_ingreso &&
			form.vencimiento_licencia < form.fecha_ingreso
		)
			e.vencimiento_licencia = 'Debe ser posterior a la fecha de ingreso.';
		return e;
	}

	$effect(() => {
		if (intentoGuardar) errores = validar();
	});

	const textoONull = (v: unknown) => {
		const t = v == null ? '' : String(v).trim();
		return t === '' ? null : t;
	};

	function payload() {
		return {
			nombre: normalizarNombrePersona(form.nombre),
			apellido: normalizarNombrePersona(form.apellido),
			tipo_identificacion: form.tipo_identificacion,
			numero_identificacion: form.numero_identificacion.trim(),
			fecha_nacimiento: form.fecha_nacimiento || null,
			genero: form.genero || null,
			tipo_sangre: form.tipo_sangre || null,
			telefono: textoONull(form.telefono),
			email: textoONull(form.email),
			direccion: textoONull(form.direccion),
			cargo: textoONull(form.cargo) ?? 'CONDUCTOR',
			fecha_ingreso: form.fecha_ingreso || null,
			salario_base: textoONull(form.salario_base) === null ? null : Number(form.salario_base),
			estado: form.estado,
			tipo_contrato: form.tipo_contrato || null,
			sede_trabajo: form.sede_trabajo || null,
			eps: textoONull(form.eps),
			fondo_pension: textoONull(form.fondo_pension),
			arl: textoONull(form.arl),
			categoria_licencia: form.categoria_licencia || null,
			vencimiento_licencia: form.vencimiento_licencia || null
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
			const r = conductorId
				? await conductoresAPI.update(conductorId, datos)
				: await conductoresAPI.create(datos);
			avisarGuardado('Conductor', `${datos.nombre} ${datos.apellido}`, !editando);
			original = JSON.stringify(form);
			onguardado?.(r.data?.data ?? r.data);
			onclose();
		} catch (e) {
			const { mensaje } = errorDeApi(e, 'Error al guardar el conductor.');
			/// Los choques que el backend explica: identificación y correo repetidos.
			if (/identificaci/i.test(mensaje)) {
				errores = { ...errores, numero_identificacion: mensaje };
				tab = 'personal';
			} else if (/correo|email/i.test(mensaje)) {
				errores = { ...errores, email: mensaje };
				tab = 'personal';
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
	eyebrow={editando ? 'EDITAR CONDUCTOR' : 'NUEVO CONDUCTOR'}
	title={editando ? nombreCompleto || 'Conductor' : 'Registrar conductor'}
	subtitle={editando
		? `${form.tipo_identificacion} ${form.numero_identificacion}`
		: 'Los campos con * son obligatorios.'}
	tabs={TABS}
	bind:tabActiva={tab}
	erroresPorTab={conteo}
	{cargando}
	{guardando}
	{sucio}
	textoGuardar={editando ? 'Guardar cambios' : 'Registrar conductor'}
	onguardar={guardar}
	oncerrar={onclose}
>
	{#snippet children(activa)}
		<div class="de-grid">
			{#if activa === 'personal'}
				<Campo id="c-nombre" label="Nombre" requerido error={errores.nombre}>
					<input
						id="c-nombre"
						placeholder="Ej. JUAN CARLOS"
						class="de-input"
						style="text-transform: uppercase"
						autocomplete="off"
						bind:value={form.nombre}
						aria-invalid={inv('nombre')}
					/>
				</Campo>
				<Campo id="c-apellido" label="Apellido" requerido error={errores.apellido}>
					<input
						id="c-apellido"
						placeholder="Ej. PÉREZ GÓMEZ"
						class="de-input"
						style="text-transform: uppercase"
						autocomplete="off"
						bind:value={form.apellido}
						aria-invalid={inv('apellido')}
					/>
				</Campo>
				<Campo id="c-tipo-id" label="Tipo de identificación">
					<select id="c-tipo-id" class="de-input" bind:value={form.tipo_identificacion}>
						{#each TIPOS_ID as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</Campo>
				<Campo
					id="c-num-id"
					label="Número de identificación"
					requerido
					error={errores.numero_identificacion}
				>
					<input
						id="c-num-id"
						placeholder="Ej. 1098765432"
						class="de-input"
						inputmode="numeric"
						bind:value={form.numero_identificacion}
						aria-invalid={inv('numero_identificacion')}
					/>
				</Campo>
				<Campo id="c-nacimiento" label="Fecha de nacimiento">
					<input
						id="c-nacimiento"
						class="de-input"
						type="date"
						max={hoy()}
						bind:value={form.fecha_nacimiento}
					/>
				</Campo>
				<Campo id="c-genero" label="Género">
					<select id="c-genero" class="de-input" bind:value={form.genero}>
						{#each GENEROS as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</Campo>
				<Campo id="c-sangre" label="Tipo de sangre">
					<select id="c-sangre" class="de-input" bind:value={form.tipo_sangre}>
						{#each SANGRE as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</Campo>
				<Campo id="c-telefono" label="Teléfono" error={errores.telefono}>
					<input
						id="c-telefono"
						placeholder="Ej. 310 123 4567"
						class="de-input"
						type="tel"
						inputmode="tel"
						bind:value={form.telefono}
						aria-invalid={inv('telefono')}
					/>
				</Campo>
				<Campo id="c-email" label="Correo electrónico" error={errores.email} completo>
					<input
						id="c-email"
						placeholder="nombre@correo.com"
						class="de-input"
						type="email"
						autocomplete="off"
						bind:value={form.email}
						aria-invalid={inv('email')}
					/>
				</Campo>
				<Campo id="c-direccion" label="Dirección" completo>
					<input
						id="c-direccion"
						placeholder="Ej. Calle 15 # 23-45, Yopal"
						class="de-input"
						bind:value={form.direccion}
					/>
				</Campo>
			{:else if activa === 'laboral'}
				<Campo id="c-cargo" label="Cargo">
					<input
						id="c-cargo"
						placeholder="Ej. CONDUCTOR"
						class="de-input"
						bind:value={form.cargo}
					/>
				</Campo>
				<Campo id="c-estado" label="Estado">
					<select id="c-estado" class="de-input" bind:value={form.estado}>
						{#each ESTADOS as [v, l] (v)}<option value={v}>{l}</option>{/each}
						{#if !ESTADOS.some(([v]) => v === form.estado)}<option value={form.estado}
								>{form.estado}</option
							>{/if}
					</select>
				</Campo>
				<Campo id="c-ingreso" label="Fecha de ingreso">
					<input id="c-ingreso" class="de-input" type="date" bind:value={form.fecha_ingreso} />
				</Campo>
				<Campo
					id="c-salario"
					label="Salario base"
					ayuda="COP mensuales."
					error={errores.salario_base}
				>
					<input
						id="c-salario"
						placeholder="Ej. 1750905"
						class="de-input"
						type="number"
						min="0"
						step="1000"
						bind:value={form.salario_base}
						aria-invalid={inv('salario_base')}
					/>
				</Campo>
				<Campo id="c-contrato" label="Tipo de contrato">
					<select id="c-contrato" class="de-input" bind:value={form.tipo_contrato}>
						{#each CONTRATOS as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</Campo>
				<Campo id="c-sede" label="Sede de trabajo">
					<select id="c-sede" class="de-input" bind:value={form.sede_trabajo}>
						{#each SEDES as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</Campo>
			{:else if activa === 'seguridad'}
				<Campo id="c-eps" label="EPS">
					<input id="c-eps" placeholder="Ej. Nueva EPS" class="de-input" bind:value={form.eps} />
				</Campo>
				<Campo id="c-pension" label="Fondo de pensión">
					<input
						id="c-pension"
						placeholder="Ej. Porvenir"
						class="de-input"
						bind:value={form.fondo_pension}
					/>
				</Campo>
				<Campo id="c-arl" label="ARL">
					<input id="c-arl" placeholder="Ej. Positiva" class="de-input" bind:value={form.arl} />
				</Campo>
			{:else}
				<Campo id="c-categoria" label="Categoría de licencia">
					<select id="c-categoria" class="de-input" bind:value={form.categoria_licencia}>
						{#each LICENCIAS as v (v)}<option value={v}>{v || 'Sin categoría'}</option>{/each}
					</select>
				</Campo>
				<Campo
					id="c-vencimiento"
					label="Vencimiento de la licencia"
					error={errores.vencimiento_licencia}
				>
					<input
						id="c-vencimiento"
						class="de-input"
						type="date"
						bind:value={form.vencimiento_licencia}
						aria-invalid={inv('vencimiento_licencia')}
					/>
				</Campo>
			{/if}
		</div>
	{/snippet}
</ModalEntidad>
