<script lang="ts">
	/**
	 * Registrar o corregir un tanqueo, con su comprobante.
	 *
	 * Mientras se llena consulta el tanqueo anterior y el siguiente de ese
	 * vehículo a esa fecha: así el odómetro que retrocede se avisa junto al
	 * campo, antes de que el servidor lo rechace. El servidor vuelve a validar
	 * todo; esto solo ahorra el viaje de ida y vuelta.
	 *
	 * El comprobante se sube DESPUÉS de guardar los datos: si el tanqueo no
	 * pasa la validación no queda un archivo suelto en el bucket. Las fotos se
	 * comprimen antes (1800 px, JPEG 0,75), igual que en viáticos.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { FileText, Upload, X } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import SelectBuscable from '$lib/components/common/SelectBuscable.svelte';
	import { confirmar } from '$lib/stores/confirm';
	import { formularioAbierto } from '$lib/stores/formularioAbierto';
	import { comprimirImagen } from '$lib/api/viaticos';
	import {
		COMBUSTIBLE_LABELS,
		MEDIO_PAGO_LABELS,
		aLocalBogota,
		combustibleAPI,
		fechaTanqueo,
		moneda,
		numero,
		type CatalogosCombustible,
		type ContextoVehiculo,
		type MedioPago,
		type Tanqueo,
		type TipoCombustible
	} from '$lib/api/combustible';

	interface Props {
		open: boolean;
		/** Con tanqueo se edita; sin él se registra uno nuevo. */
		tanqueo?: Tanqueo | null;
		catalogos: CatalogosCombustible | null;
		/** Vehículo con el que abrir un registro nuevo (el filtro de la lista). */
		vehiculoInicial?: string | null;
		oncerrar: () => void;
		onguardado: (t: Tanqueo) => void;
	}

	let {
		open,
		tanqueo = null,
		catalogos,
		vehiculoInicial = null,
		oncerrar,
		onguardado
	}: Props = $props();

	const TIPOS_ARCHIVO = 'image/jpeg,image/png,image/webp,application/pdf';
	const MAX_BYTES = 15 * 1024 * 1024;
	/// Más de esto entre dos tanqueos es raro (un bus no hace 3.000 km con un
	/// tanque) y suele ser un dígito de más. Se avisa, no se bloquea: el
	/// anterior pudo quedar sin registrar.
	const SALTO_SOSPECHOSO_KM = 3000;

	interface Form {
		vehiculo_id: string;
		conductor_id: string;
		fecha_hora: string;
		kilometraje: string;
		galones: string;
		valor_total: string;
		tipo_combustible: TipoCombustible;
		estacion: string;
		tanque_lleno: boolean;
		medio_pago: MedioPago | '';
		observaciones: string;
	}

	function combustibleDe(vehiculoId: string): TipoCombustible {
		const v = catalogos?.vehiculos.find((x) => x.id === vehiculoId);
		return v?.combustible?.toUpperCase().startsWith('GASOLINA') ? 'GASOLINA' : 'DIESEL';
	}

	const desde = (t: Tanqueo | null): Form => ({
		vehiculo_id: t?.vehiculo.id ?? vehiculoInicial ?? '',
		conductor_id: t?.conductor?.id ?? '',
		fecha_hora: aLocalBogota(t?.fecha_hora ?? new Date()),
		kilometraje: t ? String(t.kilometraje) : '',
		galones: t ? String(t.galones).replace('.', ',') : '',
		valor_total: t ? String(Math.round(t.valor_total)) : '',
		tipo_combustible:
			t?.tipo_combustible ?? (vehiculoInicial ? combustibleDe(vehiculoInicial) : 'DIESEL'),
		estacion: t?.estacion ?? '',
		tanque_lleno: t?.tanque_lleno ?? true,
		medio_pago: t?.medio_pago ?? '',
		observaciones: t?.observaciones ?? ''
	});

	let form = $state<Form>(desde(null));
	let inicial = $state('');
	let comprobanteActual = $state<{ nombre: string } | null>(null);
	let archivoNuevo = $state<File | null>(null);
	let quitarComprobante = $state(false);
	let errores = $state<Partial<Record<keyof Form, string>>>({});
	let intentado = $state(false);
	let guardando = $state(false);
	let contexto = $state<ContextoVehiculo | null>(null);

	const idForm = `tq-form-${Math.random().toString(36).slice(2, 8)}`;

	/// El modal vive montado para que su salida anime: cada apertura arranca
	/// desde el tanqueo recibido (o en blanco), no desde lo que quedó la vez
	/// anterior.
	$effect(() => {
		if (!open) return;
		const t = tanqueo;
		untrack(() => {
			form = desde(t);
			inicial = JSON.stringify(form);
			comprobanteActual = t?.comprobante ? { nombre: t.comprobante.nombre } : null;
			archivoNuevo = null;
			quitarComprobante = false;
			errores = {};
			intentado = false;
			contexto = null;
		});
		formularioAbierto.entrar();
		return () => formularioAbierto.salir();
	});

	/// Anterior y siguiente a esta fecha, con retardo: se pide al elegir el
	/// vehículo o cambiar la fecha, no con cada tecla.
	$effect(() => {
		if (!open) return;
		const vehiculo = form.vehiculo_id;
		const fecha = form.fecha_hora;
		const excluir = tanqueo?.id;
		if (!vehiculo) {
			contexto = null;
			return;
		}
		const t = setTimeout(async () => {
			try {
				contexto = await combustibleAPI.contexto(vehiculo, fecha, excluir);
			} catch {
				contexto = null;
			}
		}, 300);
		return () => clearTimeout(t);
	});

	const sucio = $derived(JSON.stringify(form) !== inicial || !!archivoNuevo || quitarComprobante);

	const km = $derived(form.kilometraje === '' ? null : Number(form.kilometraje));
	/// Coma o punto decimal, los dos: «12,5» es lo que escribe la gente y
	/// «12.5» lo que imprime la bomba. Nadie tanquea mil galones, así que el
	/// punto nunca es separador de miles aquí.
	const galones = $derived(Number(form.galones.replace(',', '.')) || 0);
	const valor = $derived(Number(form.valor_total) || 0);
	const precioGalon = $derived(galones > 0 && valor > 0 ? valor / galones : null);
	const valorVisible = $derived(
		form.valor_total ? Number(form.valor_total).toLocaleString('es-CO') : ''
	);

	/** Lo que el servidor rechazaría, dicho junto al campo. */
	const errorKm = $derived.by(() => {
		if (km == null || !contexto) return '';
		if (contexto.anterior && km < contexto.anterior.kilometraje)
			return `Es menor que el tanqueo anterior (${numero(contexto.anterior.kilometraje)} km el ${fechaTanqueo(contexto.anterior.fecha_hora)}).`;
		if (contexto.siguiente && km > contexto.siguiente.kilometraje)
			return `Supera al tanqueo siguiente (${numero(contexto.siguiente.kilometraje)} km el ${fechaTanqueo(contexto.siguiente.fecha_hora)}). Revisa la fecha.`;
		return '';
	});

	const avisoKm = $derived.by(() => {
		if (km == null || errorKm || !contexto?.anterior) return '';
		const salto = km - contexto.anterior.kilometraje;
		return salto > SALTO_SOSPECHOSO_KM
			? `Son ${numero(salto)} km desde el tanqueo anterior: revisa que no sobre un dígito.`
			: '';
	});

	const ayudaKm = $derived.by(() => {
		if (!contexto) return 'Lectura del odómetro al tanquear.';
		const partes: string[] = [];
		if (contexto.anterior)
			partes.push(
				`Anterior: ${numero(contexto.anterior.kilometraje)} km (${fechaTanqueo(contexto.anterior.fecha_hora)})`
			);
		else partes.push('Primer tanqueo registrado de este vehículo');
		if (contexto.vehiculo.kilometraje_ficha)
			partes.push(`ficha: ${numero(contexto.vehiculo.kilometraje_ficha)} km`);
		return partes.join(' · ');
	});

	const opcionesVehiculo = $derived(
		(catalogos?.vehiculos ?? []).map((v) => {
			const detalle = [v.marca, v.linea, v.modelo].filter(Boolean).join(' ');
			return {
				value: v.id,
				label: v.placa,
				labelSecundario: detalle || 'Sin detalle',
				searchLabel: `${v.placa} ${detalle}`.toLowerCase()
			};
		})
	);
	const opcionesConductor = $derived(
		(catalogos?.conductores ?? []).map((c) => {
			const nombre = `${c.nombre} ${c.apellido}`.trim();
			const doc = c.numero_identificacion ? `CC ${c.numero_identificacion}` : 'Sin documento';
			return {
				value: c.id,
				label: nombre,
				labelSecundario: doc,
				searchLabel: `${nombre} ${doc}`.toLowerCase()
			};
		})
	);

	function elegirVehiculo(id: string | null) {
		form.vehiculo_id = id ?? '';
		/// Al registrar, el combustible sale de la ficha del vehículo; al
		/// editar se respeta lo que ya tenía el tanqueo.
		if (id && !tanqueo) form.tipo_combustible = combustibleDe(id);
		errores = { ...errores, vehiculo_id: undefined };
	}

	function elegirArchivo(archivo: File | undefined) {
		if (!archivo) return;
		if (!TIPOS_ARCHIVO.split(',').includes(archivo.type)) {
			toast.error('El comprobante debe ser una imagen (JPG, PNG, WEBP) o un PDF.');
			return;
		}
		if (archivo.size > MAX_BYTES) {
			toast.error('El comprobante no puede pasar de 15 MB.');
			return;
		}
		archivoNuevo = archivo;
		quitarComprobante = false;
	}

	function validar(): boolean {
		const e: typeof errores = {};
		if (!form.vehiculo_id) e.vehiculo_id = 'Elige el vehículo';
		if (!form.fecha_hora) e.fecha_hora = 'Indica la fecha y la hora';
		if (km == null || !Number.isInteger(km) || km < 0)
			e.kilometraje = 'Escribe el odómetro en kilómetros';
		else if (errorKm) e.kilometraje = errorKm;
		if (!(galones > 0)) e.galones = 'Los galones deben ser mayores que cero';
		if (!(valor > 0)) e.valor_total = 'El valor debe ser mayor que cero';
		errores = e;
		return Object.keys(e).length === 0;
	}

	async function guardar(ev: SubmitEvent) {
		ev.preventDefault();
		if (guardando) return;
		intentado = true;
		if (!validar()) return;
		guardando = true;
		try {
			const input = {
				vehiculo_id: form.vehiculo_id,
				conductor_id: form.conductor_id || null,
				fecha_hora: form.fecha_hora,
				kilometraje: km!,
				galones,
				valor_total: valor,
				tipo_combustible: form.tipo_combustible,
				estacion: form.estacion.trim() || null,
				tanque_lleno: form.tanque_lleno,
				medio_pago: form.medio_pago || null,
				observaciones: form.observaciones.trim() || null
			};
			let guardado = tanqueo
				? await combustibleAPI.actualizar(tanqueo.id, input)
				: await combustibleAPI.crear(input);
			/// El tanqueo ya quedó: si falla el archivo se avisa, pero no se
			/// pierde lo registrado ni se deja el modal en un estado a medias.
			try {
				if (archivoNuevo) {
					guardado = await combustibleAPI.subirComprobante(
						guardado.id,
						await comprimirImagen(archivoNuevo)
					);
				} else if (quitarComprobante && tanqueo?.comprobante) {
					guardado = await combustibleAPI.quitarComprobante(guardado.id);
				}
			} catch (error) {
				toast.warning(
					`Tanqueo guardado, pero el comprobante no: ${error instanceof Error ? error.message : 'error al subirlo'}`
				);
			}
			toast.success(tanqueo ? 'Tanqueo actualizado' : 'Tanqueo registrado');
			onguardado(guardado);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo guardar el tanqueo');
		} finally {
			guardando = false;
		}
	}

	async function cerrar() {
		if (guardando) return;
		if (
			sucio &&
			!(await confirmar({
				title: '¿Descartar los cambios?',
				message: 'Lo que escribiste en este tanqueo no se ha guardado.',
				tone: 'warning',
				confirmText: 'Descartar',
				cancelText: 'Seguir editando'
			}))
		)
			return;
		oncerrar();
	}

	/// Al corregir un campo con error, el error se va con él.
	$effect(() => {
		if (!intentado) return;
		void [
			form.vehiculo_id,
			form.fecha_hora,
			form.kilometraje,
			form.galones,
			form.valor_total,
			errorKm
		];
		untrack(() => validar());
	});
</script>

<ModalBase
	{open}
	tamano="lg"
	eyebrow={tanqueo ? 'Editar tanqueo' : 'Nuevo tanqueo'}
	title={tanqueo ? `Tanqueo de ${tanqueo.vehiculo.placa}` : 'Registrar tanqueo'}
	subtitle="El rendimiento se mide entre tanqueos de tanque lleno. Los campos con * son obligatorios."
	bloqueado={guardando}
	cerrarAlFondo={false}
	oncerrar={cerrar}
>
	<form id={idForm} class="tq-grid" novalidate onsubmit={guardar}>
		<Campo id="tq-vehiculo" label="Vehículo" requerido error={errores.vehiculo_id}>
			<SelectBuscable
				opciones={opcionesVehiculo}
				valor={form.vehiculo_id || null}
				placeholder="Elige la placa"
				placeholderBusqueda="Placa o marca…"
				onSeleccionar={elegirVehiculo}
			/>
		</Campo>
		<Campo id="tq-conductor" label="Conductor" ayuda="Quien tanqueó (opcional)">
			<SelectBuscable
				opciones={opcionesConductor}
				valor={form.conductor_id || null}
				placeholder="Sin conductor"
				placeholderBusqueda="Nombre o documento…"
				onSeleccionar={(v) => (form.conductor_id = v ?? '')}
			/>
		</Campo>

		<Campo
			id="tq-fecha"
			label="Fecha y hora"
			requerido
			error={errores.fecha_hora}
			ayuda="Hora de Colombia"
		>
			<input
				id="tq-fecha"
				class="tq-input"
				type="datetime-local"
				max={aLocalBogota(new Date())}
				bind:value={form.fecha_hora}
				aria-invalid={errores.fecha_hora ? 'true' : undefined}
			/>
		</Campo>
		<Campo
			id="tq-km"
			label="Odómetro (km)"
			requerido
			error={errores.kilometraje || errorKm}
			ayuda={avisoKm || ayudaKm}
		>
			<input
				id="tq-km"
				class="tq-input tq-num"
				class:tq-aviso={!!avisoKm}
				inputmode="numeric"
				placeholder="Ej. 45320"
				value={form.kilometraje}
				oninput={(e) => (form.kilometraje = e.currentTarget.value.replace(/\D/g, ''))}
				aria-invalid={errores.kilometraje || errorKm ? 'true' : undefined}
			/>
		</Campo>

		<Campo id="tq-galones" label="Galones" requerido error={errores.galones}>
			<input
				id="tq-galones"
				class="tq-input tq-num"
				inputmode="decimal"
				placeholder="Ej. 12,5"
				value={form.galones}
				oninput={(e) => (form.galones = e.currentTarget.value.replace(/[^\d,.]/g, ''))}
				aria-invalid={errores.galones ? 'true' : undefined}
			/>
		</Campo>
		<Campo
			id="tq-valor"
			label="Valor total"
			requerido
			error={errores.valor_total}
			ayuda={precioGalon ? `${moneda(precioGalon)} por galón` : 'Lo pagado en la estación'}
		>
			<input
				id="tq-valor"
				class="tq-input tq-num"
				inputmode="numeric"
				placeholder="$0"
				value={valorVisible}
				oninput={(e) => (form.valor_total = e.currentTarget.value.replace(/\D/g, ''))}
				aria-invalid={errores.valor_total ? 'true' : undefined}
			/>
		</Campo>

		<Campo
			id="tq-lleno"
			label="¿Quedó con tanque lleno?"
			requerido
			completo
			ayuda={form.tanque_lleno
				? 'Cierra un tramo: con el lleno anterior se calcula el rendimiento.'
				: 'Parcial: sus galones se suman al tramo que cierre el próximo lleno.'}
		>
			<div class="tq-chips" role="radiogroup" aria-label="Tanque lleno">
				<button
					type="button"
					role="radio"
					aria-checked={form.tanque_lleno}
					class="tq-chip"
					class:activo={form.tanque_lleno}
					onclick={() => (form.tanque_lleno = true)}>Tanque lleno</button
				>
				<button
					type="button"
					role="radio"
					aria-checked={!form.tanque_lleno}
					class="tq-chip"
					class:activo={!form.tanque_lleno}
					onclick={() => (form.tanque_lleno = false)}>Parcial</button
				>
			</div>
		</Campo>

		<Campo id="tq-tipo" label="Combustible" requerido>
			<div class="tq-chips" role="radiogroup" aria-label="Combustible">
				{#each Object.entries(COMBUSTIBLE_LABELS) as [valorTipo, etiqueta] (valorTipo)}
					<button
						type="button"
						role="radio"
						aria-checked={form.tipo_combustible === valorTipo}
						class="tq-chip"
						class:activo={form.tipo_combustible === valorTipo}
						onclick={() => (form.tipo_combustible = valorTipo as TipoCombustible)}
						>{etiqueta}</button
					>
				{/each}
			</div>
		</Campo>
		<Campo id="tq-medio" label="Medio de pago">
			<select id="tq-medio" class="tq-input" bind:value={form.medio_pago}>
				<option value="">Sin especificar</option>
				{#each Object.entries(MEDIO_PAGO_LABELS) as [valorMedio, etiqueta] (valorMedio)}
					<option value={valorMedio}>{etiqueta}</option>
				{/each}
			</select>
		</Campo>

		<Campo id="tq-estacion" label="Estación">
			<input
				id="tq-estacion"
				class="tq-input"
				maxlength="255"
				placeholder="Ej. EDS Terpel Yopal"
				bind:value={form.estacion}
			/>
		</Campo>
		<Campo id="tq-archivo" label="Comprobante" ayuda="Foto o PDF de la factura (opcional)">
			{#if archivoNuevo || (comprobanteActual && !quitarComprobante)}
				<div class="tq-archivo">
					<FileText size={16} />
					<span>{archivoNuevo?.name ?? comprobanteActual?.nombre}</span>
					<button
						type="button"
						aria-label="Quitar comprobante"
						onclick={() => {
							if (archivoNuevo) archivoNuevo = null;
							else quitarComprobante = true;
						}}><X size={14} /></button
					>
				</div>
			{:else}
				<label class="tq-subir">
					<Upload size={16} /> Elegir archivo
					<input
						type="file"
						accept={TIPOS_ARCHIVO}
						class="tq-oculto"
						onchange={(e) => {
							elegirArchivo(e.currentTarget.files?.[0]);
							e.currentTarget.value = '';
						}}
					/>
				</label>
			{/if}
		</Campo>

		<Campo id="tq-obs" label="Observaciones" completo>
			<textarea
				id="tq-obs"
				class="tq-input"
				rows="2"
				maxlength="2000"
				placeholder="Opcional"
				bind:value={form.observaciones}
			></textarea>
		</Campo>
	</form>

	{#snippet pie()}
		<button type="button" class="btn-secondary" disabled={guardando} onclick={cerrar}>
			Cancelar
		</button>
		<button type="submit" form={idForm} class="btn-primary" disabled={guardando}>
			{#if guardando}<span class="tq-spinner" aria-hidden="true"></span>Guardando…{:else}{tanqueo
					? 'Guardar cambios'
					: 'Registrar tanqueo'}{/if}
		</button>
	{/snippet}
</ModalBase>

<style>
	.tq-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 16px 18px;
	}
	.tq-grid :global(.de-full) {
		grid-column: 1 / -1;
	}

	/* Mismo control que `.de-input` de los modales de directorio. */
	.tq-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	textarea.tq-input {
		resize: vertical;
	}
	.tq-num {
		font-variant-numeric: tabular-nums;
	}
	.tq-input::placeholder {
		color: var(--text-very-muted);
		opacity: 1;
	}
	.tq-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.tq-input[aria-invalid='true'] {
		border-color: #dc2626;
		background: #fff8f7;
	}
	.tq-input.tq-aviso {
		border-color: #d97706;
	}

	.tq-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}
	.tq-chip {
		min-height: 40px;
		padding: 0.45rem 0.9rem;
		border: 1.5px solid var(--border-subtle);
		border-radius: 10px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-secondary);
		background: var(--bg-surface);
	}
	.tq-chip.activo {
		border-color: var(--color-emerald-500);
		background: var(--color-emerald-50);
		color: var(--color-emerald-800);
	}

	.tq-archivo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 42px;
		padding: 0 0.7rem;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		font-size: 13px;
		color: var(--text-primary);
	}
	.tq-archivo span {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tq-subir {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 42px;
		padding: 0 0.85rem;
		border: 1.5px dashed var(--border-subtle);
		border-radius: 12px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.tq-oculto {
		display: none;
	}

	.tq-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: #fff;
		border-radius: 999px;
		animation: tq-giro 0.7s linear infinite;
	}
	@keyframes tq-giro {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.tq-spinner {
			animation-duration: 2s;
		}
	}
</style>
