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
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { socketUtils } from '$lib/socket';
	import { flotaStore } from '$lib/stores/flota';

	/**
	 * Crear y editar un vehículo: el mismo modal para los dos casos, con el
	 * cascarón común de los directorios (`ModalEntidad`).
	 *
	 * Los campos son los que de verdad guarda la tabla `vehiculos`. El modal
	 * anterior pedía «Año» y «Capacidad de pasajeros», que no existen en la base
	 * y el backend descartaba en silencio; y su estado por defecto iba en
	 * mayúsculas (`DISPONIBLE`), que el backend rechaza: crear con el valor por
	 * defecto fallaba siempre.
	 */
	interface Props {
		open: boolean;
		vehiculoId?: string | null;
		onclose: () => void;
		onguardado?: () => void;
	}

	let { open, vehiculoId = null, onclose, onguardado }: Props = $props();

	const CLASES = [
		['automovil', 'Automóvil'],
		['camioneta', 'Camioneta'],
		['campero', 'Campero'],
		['van', 'Van'],
		['microbus', 'Microbús'],
		['buseta', 'Buseta'],
		['bus', 'Bus'],
		['camion', 'Camión'],
		['motocicleta', 'Motocicleta'],
		['otro', 'Otro']
	] as const;

	/// Los valores del enum `enum_vehiculos_estado`, en minúscula como los guarda.
	const ESTADOS = [
		['disponible', 'Disponible'],
		['programado', 'Programado'],
		['servicio', 'En servicio'],
		['mantenimiento', 'En mantenimiento'],
		['inactivo', 'Inactivo'],
		['desvinculado', 'Desvinculado']
	] as const;

	const COMBUSTIBLES = ['DIESEL', 'GASOLINA', 'GAS', 'ELÉCTRICO', 'HÍBRIDO'];

	const TABS = [
		{ id: 'general', label: 'General' },
		{ id: 'tecnico', label: 'Ficha técnica' },
		{ id: 'propietario', label: 'Propietario' }
	];

	const CAMPO_TAB: Record<string, string> = {
		placa: 'general',
		clase_vehiculo: 'general',
		marca: 'general',
		linea: 'general',
		modelo: 'general',
		color: 'general',
		estado: 'general',
		tipo_carroceria: 'tecnico',
		combustible: 'tecnico',
		numero_motor: 'tecnico',
		vin: 'tecnico',
		numero_serie: 'tecnico',
		numero_chasis: 'tecnico',
		kilometraje: 'tecnico',
		fecha_matricula: 'tecnico',
		propietario_nombre: 'propietario',
		propietario_identificacion: 'propietario'
	};

	const vacio = () => ({
		placa: '',
		clase_vehiculo: '',
		marca: '',
		linea: '',
		modelo: '',
		color: '',
		estado: 'disponible',
		tipo_carroceria: '',
		combustible: '',
		numero_motor: '',
		vin: '',
		numero_serie: '',
		numero_chasis: '',
		kilometraje: '',
		fecha_matricula: '',
		propietario_nombre: '',
		propietario_identificacion: ''
	});

	let form = $state(vacio());
	let original = $state(JSON.stringify(vacio()));
	let errores = $state<Errores>({});
	let intentoGuardar = $state(false);
	let tab = $state('general');
	let cargando = $state(false);
	let guardando = $state(false);

	const editando = $derived(Boolean(vehiculoId));
	const sucio = $derived(hayCambios(form, JSON.parse(original)));

	/// Cada apertura empieza de cero; al editar, con lo que hay en el servidor.
	$effect(() => {
		if (!open) return;
		tab = 'general';
		errores = {};
		intentoGuardar = false;
		const base = vacio();
		form = base;
		original = JSON.stringify(base);
		if (vehiculoId) void cargar(vehiculoId);
	});

	async function cargar(id: string) {
		cargando = true;
		try {
			const v = (await vehiculosAPI.getById(id)).data.data;
			const datos = {
				...vacio(),
				...Object.fromEntries(
					Object.keys(vacio()).map((k) => [k, v[k] == null ? '' : String(v[k])])
				),
				clase_vehiculo: (v.clase_vehiculo ?? '').toLowerCase(),
				estado: (v.estado ?? 'disponible').toLowerCase()
			};
			form = datos;
			original = JSON.stringify(datos);
		} catch (e) {
			avisarErrorGuardado(errorDeApi(e, 'No se pudo cargar el vehículo.').mensaje, false);
			onclose();
		} finally {
			cargando = false;
		}
	}

	function validar(): Errores {
		const e: Errores = {};
		const placa = form.placa.trim();
		if (!placa) e.placa = 'La placa es obligatoria.';
		else if (placa.length < 6) e.placa = 'Mínimo 6 caracteres.';
		if (!form.clase_vehiculo) e.clase_vehiculo = 'Selecciona la clase.';
		if (form.marca.trim() && form.marca.trim().length < 2) e.marca = 'Mínimo 2 caracteres.';
		if (form.linea.trim() && form.linea.trim().length < 2) e.linea = 'Mínimo 2 caracteres.';
		if (form.kilometraje != null && form.kilometraje !== '' && !(Number(form.kilometraje) >= 0))
			e.kilometraje = 'Debe ser un número mayor o igual a 0.';
		return e;
	}

	/// Revalida en vivo después del primer intento: el error se va en cuanto
	/// se corrige, sin esperar otro clic.
	$effect(() => {
		if (intentoGuardar) errores = validar();
	});

	/**
	 * Solo lo que tiene valor. Las rutas validan cada texto con `minLength` y
	 * sin `null`, así que un campo vacío se omite en vez de mandarse como `''`.
	 */
	function payload() {
		const p: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(form)) {
			/// Un `<input type="number">` vacío queda en `null`, no en `''`.
			const t = v == null ? '' : String(v).trim();
			if (t !== '') p[k] = t;
		}
		p.placa = form.placa.trim().toUpperCase();
		if (p.kilometraje !== undefined) p.kilometraje = Math.round(Number(form.kilometraje));
		return p;
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
			if (vehiculoId) {
				const vehiculo = (await vehiculosAPI.update(vehiculoId, payload())).data.data;
				socketUtils.emit('vehiculo-actualizado', { vehiculoId, vehiculo });
				flotaStore.updateVehiculo(vehiculoId, vehiculo);
			} else {
				const vehiculo = (await vehiculosAPI.create(payload())).data.data;
				socketUtils.emit('vehiculo-creado', { vehiculo });
				flotaStore.addVehiculo(vehiculo);
			}
			avisarGuardado('Vehículo', form.placa.trim().toUpperCase(), !editando);
			original = JSON.stringify(form);
			onguardado?.();
			onclose();
		} catch (e) {
			const { mensaje } = errorDeApi(e, 'Error al guardar el vehículo.');
			/// El único choque que el backend explica es la placa repetida.
			if (/placa/i.test(mensaje)) {
				errores = { ...errores, placa: mensaje };
				tab = 'general';
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
	eyebrow={editando ? 'EDITAR VEHÍCULO' : 'NUEVO VEHÍCULO'}
	title={editando ? form.placa || 'Vehículo' : 'Registrar vehículo'}
	subtitle={editando
		? [form.marca, form.linea, form.modelo].filter(Boolean).join(' · ')
		: 'Los campos con * son obligatorios.'}
	tabs={TABS}
	bind:tabActiva={tab}
	erroresPorTab={conteo}
	{cargando}
	{guardando}
	{sucio}
	textoGuardar={editando ? 'Guardar cambios' : 'Registrar vehículo'}
	onguardar={guardar}
	oncerrar={onclose}
>
	{#snippet children(activa)}
		<div class="de-grid">
			{#if activa === 'general'}
				<Campo id="v-placa" label="Placa" requerido error={errores.placa}>
					<input
						id="v-placa"
						class="de-input"
						style="text-transform: uppercase"
						placeholder="ABC123"
						bind:value={form.placa}
						aria-invalid={inv('placa')}
					/>
				</Campo>
				<Campo id="v-clase" label="Clase de vehículo" requerido error={errores.clase_vehiculo}>
					<select
						id="v-clase"
						class="de-input"
						bind:value={form.clase_vehiculo}
						aria-invalid={inv('clase_vehiculo')}
					>
						<option value="">Selecciona…</option>
						{#each CLASES as [valor, etiqueta] (valor)}<option value={valor}>{etiqueta}</option
							>{/each}
						<!-- Una clase guardada que no está en la lista no se pierde al editar. -->
						{#if form.clase_vehiculo && !CLASES.some(([v]) => v === form.clase_vehiculo)}
							<option value={form.clase_vehiculo}>{form.clase_vehiculo}</option>
						{/if}
					</select>
				</Campo>
				<Campo id="v-marca" label="Marca" error={errores.marca}>
					<input
						id="v-marca"
						placeholder="Ej. TOYOTA"
						class="de-input"
						bind:value={form.marca}
						aria-invalid={inv('marca')}
					/>
				</Campo>
				<Campo id="v-linea" label="Línea" error={errores.linea}>
					<input
						id="v-linea"
						placeholder="Ej. HILUX"
						class="de-input"
						bind:value={form.linea}
						aria-invalid={inv('linea')}
					/>
				</Campo>
				<Campo id="v-modelo" label="Modelo" ayuda="Año del modelo, p. ej. 2024.">
					<input
						id="v-modelo"
						placeholder="Ej. 2024"
						class="de-input"
						inputmode="numeric"
						bind:value={form.modelo}
					/>
				</Campo>
				<Campo id="v-color" label="Color">
					<input id="v-color" placeholder="Ej. BLANCO" class="de-input" bind:value={form.color} />
				</Campo>
				<Campo id="v-estado" label="Estado">
					<select id="v-estado" class="de-input" bind:value={form.estado}>
						{#each ESTADOS as [valor, etiqueta] (valor)}<option value={valor}>{etiqueta}</option
							>{/each}
					</select>
				</Campo>
			{:else if activa === 'tecnico'}
				<Campo id="v-carroceria" label="Tipo de carrocería">
					<input
						id="v-carroceria"
						placeholder="Ej. DOBLE CABINA"
						class="de-input"
						bind:value={form.tipo_carroceria}
					/>
				</Campo>
				<Campo id="v-combustible" label="Combustible">
					<select id="v-combustible" class="de-input" bind:value={form.combustible}>
						<option value="">Sin especificar</option>
						{#each COMBUSTIBLES as c (c)}<option value={c}>{c}</option>{/each}
						{#if form.combustible && !COMBUSTIBLES.includes(form.combustible)}
							<option value={form.combustible}>{form.combustible}</option>
						{/if}
					</select>
				</Campo>
				<Campo id="v-motor" label="Número de motor">
					<input
						id="v-motor"
						placeholder="Ej. 1GD1234567"
						class="de-input"
						bind:value={form.numero_motor}
					/>
				</Campo>
				<Campo id="v-vin" label="VIN">
					<input
						id="v-vin"
						placeholder="17 caracteres"
						class="de-input"
						style="text-transform: uppercase"
						bind:value={form.vin}
					/>
				</Campo>
				<Campo id="v-serie" label="Número de serie">
					<input
						id="v-serie"
						placeholder="Número de serie"
						class="de-input"
						bind:value={form.numero_serie}
					/>
				</Campo>
				<Campo id="v-chasis" label="Número de chasis">
					<input
						id="v-chasis"
						placeholder="Número de chasis"
						class="de-input"
						bind:value={form.numero_chasis}
					/>
				</Campo>
				<Campo id="v-km" label="Kilometraje" error={errores.kilometraje}>
					<input
						id="v-km"
						placeholder="Ej. 85000"
						class="de-input"
						type="number"
						min="0"
						step="1"
						bind:value={form.kilometraje}
						aria-invalid={inv('kilometraje')}
					/>
				</Campo>
				<Campo id="v-matricula" label="Fecha de matrícula">
					<input id="v-matricula" class="de-input" type="date" bind:value={form.fecha_matricula} />
				</Campo>
			{:else}
				<Campo id="v-prop-nombre" label="Nombre del propietario" completo>
					<input
						id="v-prop-nombre"
						placeholder="Nombre completo o razón social"
						class="de-input"
						bind:value={form.propietario_nombre}
					/>
				</Campo>
				<Campo
					id="v-prop-id"
					label="Identificación del propietario"
					ayuda="Cédula o NIT, sin puntos."
				>
					<input
						id="v-prop-id"
						placeholder="Ej. 1098765432"
						class="de-input"
						inputmode="numeric"
						bind:value={form.propietario_identificacion}
					/>
				</Campo>
			{/if}
		</div>
	{/snippet}
</ModalEntidad>
