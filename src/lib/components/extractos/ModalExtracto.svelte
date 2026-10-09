<script lang="ts">
	/**
	 * Formulario de un extracto nuevo (o del que reemplaza a otro).
	 *
	 * Lo que se repite sale de los catálogos y de las fichas: elegir el
	 * contratante trae su contrato, NIT y responsable; la placa trae modelo,
	 * marca, clase, número interno, tarjeta y convenio; el conductor trae su
	 * cédula y la vigencia de la licencia. Todo queda editable y, al emitir,
	 * lo corregido vuelve a la ficha para el próximo extracto.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import {
		extractosAPI,
		type Contratante,
		type EmitirExtractoInput,
		type Extracto,
		type OpcionesExtracto
	} from '$lib/api/extractos';

	interface Props {
		open: boolean;
		opciones: OpcionesExtracto;
		/** Extracto que se corrige: se prellena y, al emitir, el viejo queda anulado. */
		base?: Extracto | null;
		oncerrar: () => void;
		onemitido: (extracto: Extracto) => void;
	}
	let { open, opciones, base = null, oncerrar, onemitido }: Props = $props();

	interface Conductor {
		id: string | null;
		nombre: string;
		cedula: string;
		licencia_vigencia: string;
	}
	const conductorVacio = (): Conductor => ({
		id: null,
		nombre: '',
		cedula: '',
		licencia_vigencia: ''
	});

	let contratanteId = $state<string>('');
	let contratanteNombre = $state('');
	let contratanteNit = $state('');
	let contrato = $state('');
	let respNombre = $state('');
	let respCedula = $state('');
	let respTelefono = $state('');
	let respDireccion = $state('');
	let objeto = $state('');
	let origenDestino = $state('');
	let convenio = $state('');
	let desde = $state('');
	let hasta = $state('');
	let placa = $state('');
	let vehiculoId = $state<string | null>(null);
	let modelo = $state('');
	let marca = $state('');
	let clase = $state('');
	let numeroInterno = $state('');
	let tarjeta = $state('');
	let conductores = $state<Conductor[]>([conductorVacio()]);
	let actualizarFichas = $state(true);
	let enviando = $state(false);

	const NUEVO = '__nuevo__';

	$effect(() => {
		if (!open) return;
		untrack(() => (base ? prellenarDesde(base) : limpiar()));
	});

	function limpiar() {
		contratanteId = '';
		contratanteNombre = '';
		contratanteNit = '';
		contrato = '';
		respNombre = respCedula = respTelefono = respDireccion = '';
		objeto = opciones.catalogos.OBJETO[0]?.texto ?? opciones.empresa.objeto_defecto;
		origenDestino = '';
		convenio = 'N/A';
		desde = opciones.vigencia_defecto.desde;
		hasta = opciones.vigencia_defecto.hasta;
		placa = '';
		vehiculoId = null;
		modelo = marca = clase = numeroInterno = tarjeta = '';
		conductores = [conductorVacio()];
		actualizarFichas = true;
	}

	function prellenarDesde(b: Extracto) {
		limpiar();
		const c = opciones.contratantes.find((x) => x.id === b.contratante_id);
		if (c) aplicarContratante(c);
		else {
			contratanteId = NUEVO;
			contratanteNombre = b.contratante_nombre ?? '';
			contratanteNit = b.contratante_nit ?? '';
		}
		contrato = b.contrato_numero ?? contrato;
		respNombre = b.responsable.nombre ?? respNombre;
		respCedula = b.responsable.cedula ?? respCedula;
		respTelefono = b.responsable.telefono ?? respTelefono;
		respDireccion = b.responsable.direccion ?? respDireccion;
		objeto = b.objeto_contrato ?? objeto;
		origenDestino = b.origen_destino ?? '';
		convenio = b.convenio ?? 'N/A';
		desde = b.vigencia_desde;
		hasta = b.vigencia_hasta;
		placa = b.placa ?? '';
		aplicarVehiculo(placa);
		modelo = b.modelo ?? modelo;
		marca = b.marca ?? marca;
		clase = b.clase ?? clase;
		numeroInterno = b.numero_interno ?? numeroInterno;
		tarjeta = b.tarjeta_operacion ?? tarjeta;
		conductores = b.conductores.length
			? b.conductores.map((d) => ({
					id: d.conductor_id,
					nombre: d.nombre,
					cedula: d.cedula ?? '',
					licencia_vigencia: d.licencia_vigencia ?? ''
				}))
			: [conductorVacio()];
	}

	function aplicarContratante(c: Contratante) {
		contratanteId = c.id;
		contratanteNombre = c.nombre;
		contratanteNit = c.nit ?? '';
		contrato = c.numero_contrato ?? '';
		respNombre = c.responsable.nombre ?? '';
		respCedula = c.responsable.cedula ?? '';
		respTelefono = c.responsable.telefono ?? '';
		respDireccion = c.responsable.direccion ?? '';
	}

	function elegirContratante(e: Event) {
		const id = (e.currentTarget as HTMLSelectElement).value;
		if (id === NUEVO) {
			contratanteId = NUEVO;
			contratanteNombre = contratanteNit = contrato = '';
			respNombre = respCedula = respTelefono = respDireccion = '';
			return;
		}
		const c = opciones.contratantes.find((x) => x.id === id);
		if (c) aplicarContratante(c);
		else contratanteId = '';
	}

	const normPlaca = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

	function aplicarVehiculo(p: string) {
		const v = opciones.vehiculos.find((x) => normPlaca(x.placa) === normPlaca(p));
		vehiculoId = v?.id ?? null;
		if (!v) return;
		modelo = v.modelo ?? '';
		marca = v.marca ?? '';
		clase = v.clase ?? '';
		numeroInterno = v.numero_interno ?? '';
		tarjeta = v.tarjeta_operacion ?? '';
		convenio = v.empresa_afiliacion ?? 'N/A';
	}

	function cambiarPlaca(e: Event) {
		placa = normPlaca((e.currentTarget as HTMLInputElement).value);
		aplicarVehiculo(placa);
	}

	function cambiarConductor(i: number, e: Event) {
		const nombre = (e.currentTarget as HTMLInputElement).value;
		const c = opciones.conductores.find(
			(x) => x.nombre.toUpperCase() === nombre.trim().toUpperCase()
		);
		conductores[i] = c
			? {
					id: c.id,
					nombre: c.nombre,
					cedula: c.cedula ?? '',
					licencia_vigencia: c.licencia_vigencia ?? ''
				}
			: { ...conductores[i], id: null, nombre };
	}

	const vehiculoNuevo = $derived(placa.length >= 5 && !vehiculoId);
	const pad4 = (v: string) => (/^\d+$/.test(v.trim()) ? v.trim().padStart(4, '0') : v.trim());
	const numeroPrevisto = $derived(
		`${opciones.empresa.prefijo}${opciones.anio}${pad4(contrato || '0')}${String(opciones.siguiente_consecutivo).padStart(4, '0')}`
	);
	const conductoresValidos = $derived(conductores.filter((c) => c.nombre.trim().length >= 3));
	const valido = $derived(
		contratanteNombre.trim().length >= 2 &&
			contrato.trim().length > 0 &&
			objeto.trim().length >= 3 &&
			origenDestino.trim().length >= 3 &&
			!!desde &&
			!!hasta &&
			hasta >= desde &&
			placa.length >= 5 &&
			conductoresValidos.length > 0
	);

	function sumarDias(ymd: string, n: number) {
		const [a, m, d] = ymd.split('-').map(Number);
		const f = new Date(Date.UTC(a, m - 1, d + n));
		return f.toISOString().slice(0, 10);
	}
	function finDeMes(ymd: string) {
		const [a, m] = ymd.split('-').map(Number);
		return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
	}

	async function emitir() {
		if (!valido || enviando) return;
		enviando = true;
		try {
			const input: EmitirExtractoInput = {
				contratante: {
					id: contratanteId && contratanteId !== NUEVO ? contratanteId : null,
					nombre: contratanteNombre.trim(),
					nit: contratanteNit.trim() || null,
					numero_contrato: contrato.trim(),
					responsable: {
						nombre: respNombre.trim() || null,
						cedula: respCedula.trim() || null,
						telefono: respTelefono.trim() || null,
						direccion: respDireccion.trim() || null
					}
				},
				contrato_numero: contrato.trim(),
				objeto_contrato: objeto.trim(),
				origen_destino: origenDestino.trim(),
				convenio: convenio.trim() || null,
				vigencia_desde: desde,
				vigencia_hasta: hasta,
				vehiculo: {
					id: vehiculoId,
					placa,
					modelo: modelo.trim() || null,
					marca: marca.trim() || null,
					clase: clase.trim() || null,
					numero_interno: numeroInterno.trim() || null,
					tarjeta_operacion: tarjeta.trim() || null
				},
				conductores: conductoresValidos.map((c) => ({
					id: c.id,
					nombre: c.nombre.trim(),
					cedula: c.cedula.trim() || null,
					licencia_vigencia: c.licencia_vigencia || null
				})),
				reemplaza_a_id: base?.id ?? null,
				actualizar_fichas: actualizarFichas
			};
			const creado = await extractosAPI.emitir(input);
			onemitido(creado);
			oncerrar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo emitir el extracto');
		} finally {
			enviando = false;
		}
	}
</script>

<ModalBase
	{open}
	title={base ? `Reemplazar el extracto ${base.consecutivo}` : 'Nuevo extracto de contrato'}
	eyebrow="FUEC · OP-FR-04"
	subtitle={base
		? `El ${base.numero_completo} quedará anulado y este saldrá con el consecutivo ${opciones.siguiente_consecutivo}.`
		: `Consecutivo ${opciones.siguiente_consecutivo} · número previsto ${numeroPrevisto}`}
	tamano="xl"
	cerrarAlFondo={false}
	bloqueado={enviando}
	{oncerrar}
>
	<form
		class="fx"
		onsubmit={(e) => {
			e.preventDefault();
			void emitir();
		}}
	>
		<section class="fx-bloque">
			<h3>Contratante y contrato</h3>
			<div class="fx-grid">
				<label class="fx-campo fx-ancho2">
					<span>Contratante <b>*</b></span>
					<select class="fx-input" value={contratanteId} onchange={elegirContratante}>
						<option value="">— Elegir —</option>
						{#each opciones.contratantes as c (c.id)}
							<option value={c.id}
								>{c.nombre}{c.numero_contrato ? ` · contrato ${c.numero_contrato}` : ''}</option
							>
						{/each}
						<option value={NUEVO}>+ Nuevo contratante…</option>
					</select>
				</label>
				{#if contratanteId === NUEVO}
					<label class="fx-campo fx-ancho2">
						<span>Nombre del contratante <b>*</b></span>
						<input
							class="fx-input"
							bind:value={contratanteNombre}
							maxlength="255"
							placeholder="Razón social tal como va en el extracto"
						/>
					</label>
				{/if}
				<label class="fx-campo">
					<span>NIT</span>
					<input
						class="fx-input"
						bind:value={contratanteNit}
						maxlength="50"
						placeholder="901.528.440-3"
					/>
				</label>
				<label class="fx-campo">
					<span>Contrato No. <b>*</b></span>
					<input class="fx-input" bind:value={contrato} maxlength="40" placeholder="0024" />
				</label>
				<label class="fx-campo fx-ancho4">
					<span>Objeto del contrato <b>*</b></span>
					<input class="fx-input" bind:value={objeto} list="fx-objetos" maxlength="2000" />
					<datalist id="fx-objetos">
						{#each opciones.catalogos.OBJETO as o (o.id)}<option value={o.texto}></option>{/each}
					</datalist>
				</label>
				<label class="fx-campo fx-ancho4">
					<span>Origen - destino <b>*</b></span>
					<input
						class="fx-input"
						bind:value={origenDestino}
						list="fx-origenes"
						maxlength="500"
						placeholder="YOPAL Y SUS VEREDAS ALEDAÑAS CASANARE - OROCUE … (VICEVERSA)"
					/>
					<datalist id="fx-origenes">
						{#each opciones.catalogos.ORIGEN_DESTINO as o (o.id)}<option value={o.texto}
							></option>{/each}
					</datalist>
				</label>
			</div>
		</section>

		<section class="fx-bloque">
			<h3>Responsable del contratante</h3>
			<div class="fx-grid">
				<label class="fx-campo fx-ancho2">
					<span>Nombres y apellidos</span>
					<input class="fx-input" bind:value={respNombre} maxlength="255" />
				</label>
				<label class="fx-campo">
					<span>Cédula</span>
					<input class="fx-input" bind:value={respCedula} maxlength="50" />
				</label>
				<label class="fx-campo">
					<span>Teléfono</span>
					<input class="fx-input" bind:value={respTelefono} maxlength="50" />
				</label>
				<label class="fx-campo fx-ancho4">
					<span>Dirección</span>
					<input class="fx-input" bind:value={respDireccion} maxlength="255" />
				</label>
			</div>
		</section>

		<section class="fx-bloque">
			<h3>Vigencia</h3>
			<div class="fx-grid">
				<label class="fx-campo">
					<span>Fecha inicial <b>*</b></span>
					<input class="fx-input" type="date" bind:value={desde} />
				</label>
				<label class="fx-campo">
					<span>Fecha vencimiento <b>*</b></span>
					<input class="fx-input" type="date" bind:value={hasta} min={desde} />
				</label>
				<div class="fx-campo fx-ancho2 fx-atajos">
					<span>Atajos</span>
					<div>
						<button type="button" class="fx-chip" onclick={() => (hasta = sumarDias(desde, 30))}
							>+30 días</button
						>
						<button type="button" class="fx-chip" onclick={() => (hasta = sumarDias(desde, 35))}
							>+35 días</button
						>
						<button type="button" class="fx-chip" onclick={() => (hasta = finDeMes(desde))}
							>Fin de mes</button
						>
					</div>
				</div>
			</div>
		</section>

		<section class="fx-bloque">
			<h3>Vehículo</h3>
			<div class="fx-grid">
				<label class="fx-campo">
					<span>Placa <b>*</b></span>
					<input
						class="fx-input fx-placa"
						value={placa}
						oninput={cambiarPlaca}
						list="fx-placas"
						maxlength="8"
						placeholder="LLQ895"
						autocomplete="off"
					/>
					<datalist id="fx-placas">
						{#each opciones.vehiculos as v (v.id)}<option value={v.placa}
								>{v.marca ?? ''} {v.modelo ?? ''} · {v.numero_interno ?? 'sin interno'}</option
							>{/each}
					</datalist>
					{#if vehiculoNuevo}<small class="fx-aviso"
							>No está en la flota: se imprime sin ficha.</small
						>{/if}
				</label>
				<label class="fx-campo">
					<span>Modelo</span>
					<input class="fx-input" bind:value={modelo} maxlength="20" />
				</label>
				<label class="fx-campo">
					<span>Marca</span>
					<input class="fx-input" bind:value={marca} maxlength="100" />
				</label>
				<label class="fx-campo">
					<span>Clase</span>
					<input class="fx-input" bind:value={clase} maxlength="100" list="fx-clases" />
					<datalist id="fx-clases">
						<option value="CAMIONETA"></option><option value="MICROBUS"></option><option
							value="BUSETA"
						></option><option value="BUS"></option><option value="AUTOMOVIL"></option><option
							value="CAMPERO"
						></option>
					</datalist>
				</label>
				<label class="fx-campo">
					<span>Número interno</span>
					<input class="fx-input" bind:value={numeroInterno} maxlength="20" placeholder="0108" />
				</label>
				<label class="fx-campo">
					<span>Tarjeta de operación</span>
					<input class="fx-input" bind:value={tarjeta} maxlength="60" />
				</label>
				<label class="fx-campo fx-ancho2">
					<span>Convenio de colaboración empresarial</span>
					<input
						class="fx-input"
						bind:value={convenio}
						list="fx-convenios"
						maxlength="255"
						placeholder="N/A si el vehículo es propio"
					/>
					<datalist id="fx-convenios">
						<option value="N/A"></option>
						{#each opciones.catalogos.CONVENIO as o (o.id)}<option value={o.texto}></option>{/each}
					</datalist>
				</label>
			</div>
		</section>

		<section class="fx-bloque">
			<h3>Conductores <small>(hasta tres)</small></h3>
			<datalist id="fx-conductores">
				{#each opciones.conductores as c (c.id)}<option value={c.nombre}>{c.cedula ?? ''}</option
					>{/each}
			</datalist>
			{#each conductores as c, i (i)}
				<div class="fx-grid fx-conductor">
					<label class="fx-campo fx-ancho2">
						<span
							>Conductor {i + 1}
							{#if i === 0}<b>*</b>{/if}</span
						>
						<input
							class="fx-input"
							value={c.nombre}
							oninput={(e) => cambiarConductor(i, e)}
							list="fx-conductores"
							maxlength="255"
							autocomplete="off"
						/>
						{#if c.nombre.trim().length >= 3 && !c.id}<small class="fx-aviso"
								>No está en conductores: se imprime tal cual.</small
							>{/if}
					</label>
					<label class="fx-campo">
						<span>Cédula</span>
						<input class="fx-input" bind:value={c.cedula} maxlength="50" />
					</label>
					<label class="fx-campo">
						<span>Vigencia licencia</span>
						<input class="fx-input" type="date" bind:value={c.licencia_vigencia} />
					</label>
					{#if conductores.length > 1}
						<button
							type="button"
							class="fx-quitar"
							title="Quitar conductor"
							onclick={() => (conductores = conductores.filter((_, j) => j !== i))}>×</button
						>
					{/if}
				</div>
			{/each}
			{#if conductores.length < 3}
				<button
					type="button"
					class="fx-chip"
					onclick={() => (conductores = [...conductores, conductorVacio()])}
					>+ Otro conductor</button
				>
			{/if}
		</section>

		<label class="fx-check">
			<input type="checkbox" bind:checked={actualizarFichas} />
			<span
				>Guardar en la ficha del vehículo y de los conductores lo que corregí aquí (número interno,
				tarjeta, vigencia de licencia…)</span
			>
		</label>
	</form>

	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={oncerrar} disabled={enviando}
			>Cancelar</button
		>
		<button type="button" class="btn-primary" onclick={emitir} disabled={!valido || enviando}>
			{enviando ? 'Emitiendo…' : base ? 'Emitir reemplazo' : 'Emitir y firmar'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.fx {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.fx-bloque h3 {
		margin: 0 0 8px;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.fx-bloque h3 small {
		font-weight: 600;
		text-transform: none;
		letter-spacing: 0;
	}
	.fx-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}
	.fx-conductor {
		position: relative;
		margin-bottom: 8px;
	}
	.fx-ancho2 {
		grid-column: span 2;
	}
	.fx-ancho4 {
		grid-column: span 4;
	}
	@media (max-width: 720px) {
		.fx-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.fx-ancho4 {
			grid-column: span 2;
		}
	}
	.fx-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.fx-campo > span {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.fx-campo b {
		color: #dc2626;
	}
	.fx-input {
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
	}
	.fx-input:focus {
		outline: none;
		border-color: var(--au-primary);
		box-shadow: 0 0 0 3px var(--au-tint);
	}
	.fx-placa {
		text-transform: uppercase;
		font-weight: 800;
		letter-spacing: 0.08em;
	}
	.fx-aviso {
		font-size: 0.72rem;
		color: #b45309;
	}
	.fx-atajos > div {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding-top: 4px;
	}
	.fx-chip {
		padding: 0.35rem 0.7rem;
		border: 1.5px solid var(--border-default);
		border-radius: 999px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.fx-chip:hover {
		border-color: var(--au-primary);
		color: var(--au-dark);
	}
	.fx-quitar {
		position: absolute;
		right: -4px;
		top: 0;
		width: 22px;
		height: 22px;
		border: none;
		border-radius: 50%;
		background: var(--bg-base);
		color: var(--text-muted);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	.fx-quitar:hover {
		background: #fee2e2;
		color: #b91c1c;
	}
	.fx-check {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}
	.fx-check input {
		margin-top: 3px;
	}
</style>
