<script lang="ts">
	/**
	 * Reporte de un accidente, incidente o casi-accidente: el mismo modal para
	 * registrar y para corregir.
	 *
	 * Lo que decide el servidor no se repite aquí: la coherencia entre tipo,
	 * gravedad y lesionados la valida el backend y su mensaje se muestra tal
	 * cual. Aquí solo se esconden los campos que no aplican (un casi-accidente
	 * no tiene gravedad) para que no se puedan llenar mal.
	 *
	 * Las evidencias del reporte nuevo se suben DESPUÉS de crearlo, una por
	 * una: si una falla, el reporte ya existe y se puede reintentar desde el
	 * detalle, en vez de perder todo el formulario por una foto.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Paperclip, Plus, Trash2, X } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import SelectBuscable from '$lib/components/common/SelectBuscable.svelte';
	import { municipios as municipiosStore, municipiosArray } from '$lib/stores/municipios';
	import { comprimirImagen } from '$lib/api/viaticos';
	import { confirmar } from '$lib/stores/confirm';
	import {
		incidentesAPI,
		mensajeError,
		hoyColombia,
		TIPO_LABELS,
		SEVERIDAD_LABELS,
		TRAYECTO_LABELS,
		CLASES_EVENTO,
		AUTORIDADES,
		type IncidenteDetalleApi,
		type OpcionesReporte,
		type ReporteIncidente,
		type ServicioCandidato,
		type Severidad,
		type Tercero,
		type TipoIncidente,
		type Trayecto
	} from '$lib/api/incidentes';

	interface Props {
		open: boolean;
		/** Con incidente, corrige su reporte; sin él, registra uno nuevo. */
		incidente?: IncidenteDetalleApi | null;
		oncerrar: () => void;
		onguardado: (detalle: IncidenteDetalleApi) => void;
	}
	let { open, incidente = null, oncerrar, onguardado }: Props = $props();

	const editando = $derived(!!incidente);

	interface Formulario {
		tipo: TipoIncidente;
		fecha: string;
		hora: string;
		lugar: string;
		municipio_id: string | null;
		trayecto: Trayecto;
		tipo_evento: string;
		vehiculo_id: string | null;
		conductor_id: string | null;
		servicio_id: string | null;
		descripcion: string;
		severidad: Severidad | '';
		heridos: number;
		fallecidos: number;
		terceros: Tercero[];
		autoridad: string;
		numero_informe: string;
		costo_directo: string;
		costo_indirecto: string;
	}

	function vacio(): Formulario {
		return {
			tipo: 'ACCIDENTE_TRANSITO',
			fecha: hoyColombia(),
			hora: '',
			lugar: '',
			municipio_id: null,
			trayecto: 'LABORAL',
			tipo_evento: '',
			vehiculo_id: null,
			conductor_id: null,
			servicio_id: null,
			descripcion: '',
			severidad: '',
			heridos: 0,
			fallecidos: 0,
			terceros: [],
			autoridad: '',
			numero_informe: '',
			costo_directo: '',
			costo_indirecto: ''
		};
	}

	function desde(d: IncidenteDetalleApi): Formulario {
		return {
			tipo: d.tipo,
			fecha: d.fecha,
			hora: d.hora ?? '',
			lugar: d.lugar ?? '',
			municipio_id: d.municipio?.id ?? null,
			trayecto: d.trayecto,
			tipo_evento: d.tipo_evento ?? '',
			vehiculo_id: d.vehiculo?.id ?? null,
			conductor_id: d.conductor?.id ?? null,
			servicio_id: d.servicio?.id ?? null,
			descripcion: d.descripcion ?? '',
			severidad: d.severidad ?? '',
			heridos: d.heridos,
			fallecidos: d.fallecidos,
			terceros: d.terceros.map((t) => ({ ...t })),
			autoridad: d.autoridad ?? '',
			numero_informe: d.numero_informe ?? '',
			costo_directo: d.costo_directo !== null ? String(d.costo_directo) : '',
			costo_indirecto: d.costo_indirecto !== null ? String(d.costo_indirecto) : ''
		};
	}

	let form = $state<Formulario>(vacio());
	let inicial = $state('');
	let archivos = $state<File[]>([]);
	let guardando = $state(false);
	let errores = $state<string[]>([]);
	let opciones = $state<OpcionesReporte | null>(null);
	let candidatos = $state<ServicioCandidato[]>([]);

	/// Cada vez que se abre, el formulario arranca del incidente (o vacío) y
	/// se recuerda su forma inicial para avisar de cambios sin guardar.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			form = incidente ? desde(incidente) : vacio();
			inicial = JSON.stringify(form);
			archivos = [];
			errores = [];
			void cargarOpciones();
		});
	});

	async function cargarOpciones() {
		try {
			const [o] = await Promise.all([
				opciones ? Promise.resolve(opciones) : incidentesAPI.opciones(),
				municipiosStore.cargarTodos()
			]);
			opciones = o;
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudieron cargar vehículos y conductores'));
		}
	}

	/// Los servicios candidatos dependen de fecha + vehículo/conductor: se piden
	/// solo cuando cambian esos tres, no con cada tecla del formulario.
	const claveCandidatos = $derived(
		`${form.fecha}|${form.vehiculo_id ?? ''}|${form.conductor_id ?? ''}`
	);
	$effect(() => {
		void claveCandidatos;
		if (!open) return;
		const { fecha, vehiculo_id, conductor_id } = untrack(() => form);
		if (!fecha || (!vehiculo_id && !conductor_id)) {
			candidatos = [];
			return;
		}
		incidentesAPI
			.serviciosCandidatos({ fecha, vehiculo_id, conductor_id })
			.then((l) => (candidatos = l))
			.catch(() => (candidatos = []));
	});

	const opcionesVehiculo = $derived(
		(opciones?.vehiculos ?? []).map((v) => ({
			value: v.id,
			label: v.placa,
			labelSecundario: [v.marca, v.linea].filter(Boolean).join(' ')
		}))
	);
	const opcionesConductor = $derived(
		(opciones?.conductores ?? []).map((c) => ({
			value: c.id,
			label: c.nombre,
			labelSecundario: c.documento ?? undefined
		}))
	);
	const opcionesMunicipio = $derived(
		$municipiosArray.map((m) => ({
			value: m.id,
			label: m.nombre_municipio,
			labelSecundario: m.nombre_departamento
		}))
	);

	const conGravedad = $derived(form.tipo !== 'CASI_ACCIDENTE');
	/// Un incidente, por definición, no deja lesionados: solo se ofrece «solo daños».
	const gravedades = $derived(
		form.tipo === 'INCIDENTE'
			? (['SOLO_DANOS'] as Severidad[])
			: (['SOLO_DANOS', 'LESION_LEVE', 'LESION_GRAVE', 'FATALIDAD'] as Severidad[])
	);
	const conVictimas = $derived(
		form.severidad === 'LESION_LEVE' ||
			form.severidad === 'LESION_GRAVE' ||
			form.severidad === 'FATALIDAD'
	);
	const sucio = $derived(JSON.stringify(form) !== inicial || archivos.length > 0);

	function cambiarTipo(t: TipoIncidente) {
		form.tipo = t;
		if (t === 'CASI_ACCIDENTE') {
			form.severidad = '';
			form.heridos = 0;
			form.fallecidos = 0;
		} else if (t === 'INCIDENTE' && form.severidad && form.severidad !== 'SOLO_DANOS') {
			form.severidad = '';
			form.heridos = 0;
			form.fallecidos = 0;
		}
	}

	function cambiarGravedad(s: Severidad | '') {
		form.severidad = s;
		if (s !== 'LESION_LEVE' && s !== 'LESION_GRAVE' && s !== 'FATALIDAD') {
			form.heridos = 0;
			form.fallecidos = 0;
		}
	}

	function agregarTercero() {
		form.terceros = [
			...form.terceros,
			{ nombre: '', documento: '', placa: '', telefono: '', aseguradora: '', lesionado: false }
		];
	}
	function quitarTercero(i: number) {
		form.terceros = form.terceros.filter((_, j) => j !== i);
	}

	function elegirArchivos(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const nuevos = Array.from(input.files ?? []);
		input.value = '';
		const validos = nuevos.filter((f) =>
			/^(application\/pdf|image\/(png|jpe?g|webp))$/.test(f.type)
		);
		if (validos.length < nuevos.length)
			toast.error('Solo se adjuntan PDF o imágenes (JPG, PNG, WEBP)');
		archivos = [...archivos, ...validos].slice(0, 10);
	}

	const numeroONull = (t: string) => {
		const limpio = t.replace(/[^\d]/g, '');
		return limpio ? Number(limpio) : null;
	};
	const textoONull = (t: string | null | undefined) => (t && t.trim() ? t.trim() : null);

	function cuerpo(): ReporteIncidente {
		return {
			tipo: form.tipo,
			fecha: form.fecha,
			hora: textoONull(form.hora),
			lugar: form.lugar.trim(),
			municipio_id: form.municipio_id,
			trayecto: form.trayecto,
			tipo_evento: textoONull(form.tipo_evento),
			vehiculo_id: form.vehiculo_id,
			conductor_id: form.conductor_id,
			servicio_id: form.servicio_id,
			descripcion: form.descripcion.trim(),
			severidad: conGravedad && form.severidad ? form.severidad : null,
			heridos: conVictimas ? Number(form.heridos) || 0 : 0,
			fallecidos: conVictimas ? Number(form.fallecidos) || 0 : 0,
			terceros: form.terceros
				.filter((t) => t.nombre.trim())
				.map((t) => ({
					nombre: t.nombre.trim(),
					documento: textoONull(t.documento),
					placa: textoONull(t.placa)?.toUpperCase() ?? null,
					telefono: textoONull(t.telefono),
					aseguradora: textoONull(t.aseguradora),
					lesionado: !!t.lesionado
				})),
			autoridad: textoONull(form.autoridad),
			numero_informe: textoONull(form.numero_informe),
			costo_directo: numeroONull(form.costo_directo),
			costo_indirecto: numeroONull(form.costo_indirecto)
		};
	}

	async function guardar() {
		if (guardando) return;
		errores = [];
		guardando = true;
		try {
			const detalle = editando
				? await incidentesAPI.editar(incidente!.id, cuerpo())
				: await incidentesAPI.crear(cuerpo());
			let fallidas = 0;
			for (const f of archivos) {
				try {
					await incidentesAPI.subirEvidencia(detalle.id, await comprimirImagen(f));
				} catch {
					fallidas++;
				}
			}
			toast.success(editando ? 'Reporte actualizado' : `Reporte ${detalle.codigo} registrado`);
			if (fallidas)
				toast.error(`${fallidas} evidencia(s) no se subieron: reinténtalo desde el detalle`);
			const final = archivos.length ? await incidentesAPI.detalle(detalle.id) : detalle;
			inicial = JSON.stringify(form);
			archivos = [];
			onguardado(final);
		} catch (err) {
			const datos = (err as { response?: { data?: { details?: string[] } } })?.response?.data;
			errores = datos?.details?.length
				? datos.details
				: [mensajeError(err, 'No se pudo guardar el reporte')];
		} finally {
			guardando = false;
		}
	}

	async function cerrar() {
		if (guardando) return;
		if (sucio) {
			const ok = await confirmar({
				tone: 'warning',
				title: '¿Descartar el reporte?',
				message: 'Lo que escribiste no se ha guardado.',
				confirmText: 'Descartar',
				cancelText: 'Seguir editando'
			});
			if (!ok) return;
		}
		oncerrar();
	}

	const tamanoArchivo = (b: number) =>
		b > 1024 * 1024
			? `${(b / 1024 / 1024).toFixed(1)} MB`
			: `${Math.max(1, Math.round(b / 1024))} KB`;
</script>

<ModalBase
	{open}
	tamano="lg"
	eyebrow={editando ? `Corregir ${incidente?.codigo ?? ''}` : 'Nuevo reporte · HSEQ'}
	title={editando ? 'Reporte del incidente' : 'Reportar accidente o incidente'}
	subtitle="Los campos con * son obligatorios. La investigación se registra después, en el detalle."
	cerrarAlFondo={false}
	bloqueado={guardando}
	oncerrar={cerrar}
>
	{#snippet children()}
		<form
			class="ri"
			id="form-reporte-incidente"
			onsubmit={(e) => {
				e.preventDefault();
				void guardar();
			}}
		>
			{#if errores.length}
				<div class="ri-errores" role="alert">
					<strong>No se pudo guardar:</strong>
					<ul>
						{#each errores as e}<li>{e}</li>{/each}
					</ul>
				</div>
			{/if}

			<!-- ── Qué pasó ── -->
			<section class="ri-seccion">
				<h3>Qué pasó</h3>
				<div class="ri-tipos" role="radiogroup" aria-label="Tipo de evento">
					{#each Object.entries(TIPO_LABELS) as [valor, t]}
						<button
							type="button"
							role="radio"
							aria-checked={form.tipo === valor}
							class="ri-tipo"
							class:ri-tipo--on={form.tipo === valor}
							onclick={() => cambiarTipo(valor as TipoIncidente)}
						>
							<span class="ri-punto" style="background:{t.color}" aria-hidden="true"></span>
							<span>
								<strong>{t.label}</strong>
								<small>
									{valor === 'ACCIDENTE_TRANSITO'
										? 'Hubo daños, lesionados o víctimas en la vía'
										: valor === 'INCIDENTE'
											? 'Daños menores, sin personas lesionadas'
											: 'Pudo pasar y no pasó: sin daños ni lesiones'}
								</small>
							</span>
						</button>
					{/each}
				</div>

				<div class="ri-grid">
					<Campo id="ri-fecha" label="Fecha" requerido>
						<input
							id="ri-fecha"
							class="ri-input"
							type="date"
							max={hoyColombia()}
							bind:value={form.fecha}
							required
						/>
					</Campo>
					<Campo id="ri-hora" label="Hora aproximada">
						<input id="ri-hora" class="ri-input" type="time" bind:value={form.hora} />
					</Campo>
					<Campo
						id="ri-lugar"
						label="Lugar"
						requerido
						ayuda="Vía, kilómetro, dirección o punto de referencia"
					>
						<input
							id="ri-lugar"
							class="ri-input"
							type="text"
							maxlength="255"
							placeholder="Ej. Vía Yopal–Aguazul, km 12"
							bind:value={form.lugar}
							required
						/>
					</Campo>
					<Campo id="ri-municipio" label="Municipio">
						<SelectBuscable
							opciones={opcionesMunicipio}
							valor={form.municipio_id}
							placeholder="Selecciona el municipio"
							placeholderBusqueda="Municipio o departamento…"
							onSeleccionar={(v) => (form.municipio_id = v)}
						/>
					</Campo>
					<Campo id="ri-trayecto" label="Trayecto">
						<select id="ri-trayecto" class="ri-input" bind:value={form.trayecto}>
							{#each Object.entries(TRAYECTO_LABELS) as [valor, etiqueta]}
								<option value={valor}>{etiqueta}</option>
							{/each}
						</select>
					</Campo>
					<Campo id="ri-clase" label="Clase de evento">
						<select id="ri-clase" class="ri-input" bind:value={form.tipo_evento}>
							<option value="">Sin especificar</option>
							{#each CLASES_EVENTO as c}<option value={c.valor}>{c.etiqueta}</option>{/each}
						</select>
					</Campo>
					<Campo id="ri-descripcion" label="Descripción de los hechos" requerido completo>
						<textarea
							id="ri-descripcion"
							class="ri-input"
							rows="4"
							maxlength="5000"
							placeholder="Qué pasó, en qué orden, condiciones de la vía y del clima…"
							bind:value={form.descripcion}
							required
						></textarea>
					</Campo>
				</div>
			</section>

			<!-- ── Vehículo, conductor y servicio ── -->
			<section class="ri-seccion">
				<h3>Vehículo, conductor y servicio</h3>
				<div class="ri-grid">
					<Campo id="ri-vehiculo" label="Vehículo">
						<SelectBuscable
							opciones={opcionesVehiculo}
							valor={form.vehiculo_id}
							placeholder="Selecciona la placa"
							placeholderBusqueda="Placa o marca…"
							onSeleccionar={(v) => (form.vehiculo_id = v)}
						/>
					</Campo>
					<Campo id="ri-conductor" label="Conductor">
						<SelectBuscable
							opciones={opcionesConductor}
							valor={form.conductor_id}
							placeholder="Selecciona el conductor"
							placeholderBusqueda="Nombre o documento…"
							onSeleccionar={(v) => (form.conductor_id = v)}
						/>
					</Campo>
					<Campo
						id="ri-servicio"
						label="Servicio (opcional)"
						completo
						ayuda={form.vehiculo_id || form.conductor_id
							? candidatos.length
								? 'Servicios de esa placa o conductor alrededor de la fecha'
								: 'No hay servicios de esa placa o conductor alrededor de la fecha'
							: 'Elige primero el vehículo o el conductor'}
					>
						<select
							id="ri-servicio"
							class="ri-input"
							bind:value={form.servicio_id}
							disabled={!candidatos.length && !form.servicio_id}
						>
							<option value={null}>Sin servicio</option>
							{#if form.servicio_id && !candidatos.some((c) => c.id === form.servicio_id) && incidente?.servicio}
								<option value={incidente.servicio.id}>{incidente.servicio.ruta}</option>
							{/if}
							{#each candidatos as s}
								<option value={s.id}>
									{new Date(s.fecha).toLocaleString('es-CO', {
										dateStyle: 'short',
										timeStyle: 'short'
									})} · {s.ruta}{s.cliente ? ` · ${s.cliente}` : ''}{s.placa ? ` · ${s.placa}` : ''}
								</option>
							{/each}
						</select>
					</Campo>
				</div>
			</section>

			<!-- ── Consecuencias ── -->
			{#if conGravedad}
				<section class="ri-seccion">
					<h3>Consecuencias</h3>
					<div class="ri-grid">
						<Campo
							id="ri-gravedad"
							label="Gravedad"
							requerido={form.tipo === 'ACCIDENTE_TRANSITO'}
							ayuda="Una lesión grave o una fatalidad se reporta a la ARL dentro de los 2 días hábiles"
						>
							<select
								id="ri-gravedad"
								class="ri-input"
								value={form.severidad}
								onchange={(e) =>
									cambiarGravedad((e.currentTarget as HTMLSelectElement).value as Severidad | '')}
							>
								<option value="">{form.tipo === 'INCIDENTE' ? 'Sin daños' : 'Selecciona…'}</option>
								{#each gravedades as g}<option value={g}>{SEVERIDAD_LABELS[g]}</option>{/each}
							</select>
						</Campo>
						{#if conVictimas}
							<div class="ri-dos">
								<Campo
									id="ri-heridos"
									label="Lesionados"
									requerido={form.severidad !== 'FATALIDAD'}
								>
									<input
										id="ri-heridos"
										class="ri-input"
										type="number"
										min="0"
										max="500"
										bind:value={form.heridos}
									/>
								</Campo>
								<Campo
									id="ri-fallecidos"
									label="Fallecidos"
									requerido={form.severidad === 'FATALIDAD'}
								>
									<input
										id="ri-fallecidos"
										class="ri-input"
										type="number"
										min="0"
										max="500"
										bind:value={form.fallecidos}
									/>
								</Campo>
							</div>
						{/if}
					</div>
				</section>
			{/if}

			<!-- ── Terceros ── -->
			<section class="ri-seccion">
				<div class="ri-seccion-cab">
					<h3>Terceros involucrados</h3>
					<button type="button" class="btn-secondary ri-btn-mini" onclick={agregarTercero}>
						<Plus size={14} /> Agregar tercero
					</button>
				</div>
				{#if form.terceros.length === 0}
					<p class="ri-nota">Sin terceros: solo el vehículo y el personal propio.</p>
				{/if}
				{#each form.terceros as t, i (i)}
					<div class="ri-tercero">
						<input
							class="ri-input"
							type="text"
							placeholder="Nombre *"
							maxlength="160"
							bind:value={t.nombre}
							aria-label="Nombre del tercero"
						/>
						<input
							class="ri-input"
							type="text"
							placeholder="Documento"
							maxlength="30"
							bind:value={t.documento}
							aria-label="Documento del tercero"
						/>
						<input
							class="ri-input"
							type="text"
							placeholder="Placa"
							maxlength="15"
							bind:value={t.placa}
							aria-label="Placa del tercero"
						/>
						<input
							class="ri-input"
							type="tel"
							placeholder="Teléfono"
							maxlength="30"
							bind:value={t.telefono}
							aria-label="Teléfono del tercero"
						/>
						<input
							class="ri-input"
							type="text"
							placeholder="Aseguradora"
							maxlength="120"
							bind:value={t.aseguradora}
							aria-label="Aseguradora del tercero"
						/>
						<label class="ri-check"
							><input type="checkbox" bind:checked={t.lesionado} /> Lesionado</label
						>
						<button
							type="button"
							class="ri-quitar"
							aria-label="Quitar tercero"
							onclick={() => quitarTercero(i)}
						>
							<Trash2 size={15} />
						</button>
					</div>
				{/each}
			</section>

			<!-- ── Autoridad y costos ── -->
			<section class="ri-seccion">
				<h3>Autoridad y costos</h3>
				<div class="ri-grid">
					<Campo id="ri-autoridad" label="Autoridad que atendió">
						<input
							id="ri-autoridad"
							class="ri-input"
							type="text"
							list="ri-autoridades"
							maxlength="120"
							placeholder="Policía de Tránsito, agente municipal…"
							bind:value={form.autoridad}
						/>
						<datalist id="ri-autoridades">
							{#each AUTORIDADES as a}<option value={a}></option>{/each}
						</datalist>
					</Campo>
					<Campo id="ri-informe" label="N.º de IPAT o informe">
						<input
							id="ri-informe"
							class="ri-input"
							type="text"
							maxlength="60"
							placeholder="Ej. A-000123456"
							bind:value={form.numero_informe}
						/>
					</Campo>
					<Campo
						id="ri-costo-directo"
						label="Costo directo estimado (COP)"
						ayuda="Reparaciones, daños a terceros, deducibles"
					>
						<input
							id="ri-costo-directo"
							class="ri-input"
							type="text"
							inputmode="numeric"
							placeholder="0"
							bind:value={form.costo_directo}
						/>
					</Campo>
					<Campo
						id="ri-costo-indirecto"
						label="Costo indirecto estimado (COP)"
						ayuda="Días fuera de servicio, incapacidades, reemplazos"
					>
						<input
							id="ri-costo-indirecto"
							class="ri-input"
							type="text"
							inputmode="numeric"
							placeholder="0"
							bind:value={form.costo_indirecto}
						/>
					</Campo>
				</div>
			</section>

			<!-- ── Evidencias (solo al registrar; después, desde el detalle) ── -->
			{#if !editando}
				<section class="ri-seccion">
					<div class="ri-seccion-cab">
						<h3>Evidencias</h3>
						<label class="btn-secondary ri-btn-mini">
							<Paperclip size={14} /> Adjuntar
							<input
								type="file"
								accept="application/pdf,image/png,image/jpeg,image/webp"
								multiple
								hidden
								onchange={elegirArchivos}
							/>
						</label>
					</div>
					{#if archivos.length === 0}
						<p class="ri-nota">
							Fotos del sitio, croquis o el IPAT en PDF. Las fotos se reducen antes de subirlas.
						</p>
					{:else}
						<ul class="ri-archivos">
							{#each archivos as f, i (f.name + i)}
								<li>
									<span>{f.name}</span>
									<small>{tamanoArchivo(f.size)}</small>
									<button
										type="button"
										aria-label="Quitar {f.name}"
										onclick={() => (archivos = archivos.filter((_, j) => j !== i))}
									>
										<X size={14} />
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		</form>
	{/snippet}

	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={cerrar} disabled={guardando}
			>Cancelar</button
		>
		<button type="submit" form="form-reporte-incidente" class="btn-primary" disabled={guardando}>
			{guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar reporte'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.ri {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.ri-seccion {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.ri-seccion h3 {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.ri-seccion-cab {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.ri-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 14px 16px;
	}
	.ri-dos {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.ri-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
	}
	textarea.ri-input {
		resize: vertical;
	}
	.ri-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.ri-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}
	.ri-tipos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 10px;
	}
	.ri-tipo {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 14px;
		border: 1px solid var(--border-default);
		border-radius: 14px;
		background: var(--bg-surface);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.ri-tipo strong {
		display: block;
		font-size: 14px;
		color: var(--text-primary);
	}
	.ri-tipo small {
		display: block;
		margin-top: 2px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.ri-tipo--on {
		border-color: var(--emerald-500);
		background: var(--au-tint);
		box-shadow: 0 0 0 1px var(--emerald-500);
	}
	.ri-punto {
		flex-shrink: 0;
		width: 10px;
		height: 10px;
		margin-top: 5px;
		border-radius: 999px;
	}
	.ri-tercero {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)) auto auto;
		align-items: center;
		gap: 8px;
		padding: 10px;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: var(--bg-base);
	}
	.ri-check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.ri-quitar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		color: var(--text-muted);
	}
	.ri-quitar:hover {
		color: #dc2626;
		background: #fef2f2;
	}
	.ri-btn-mini {
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
	}
	.ri-nota {
		margin: 0;
		font-size: 13px;
		color: var(--text-muted);
	}
	.ri-archivos {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.ri-archivos li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		font-size: 13px;
	}
	.ri-archivos li span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ri-archivos li small {
		color: var(--text-muted);
	}
	.ri-archivos li button {
		color: var(--text-muted);
	}
	.ri-errores {
		padding: 12px 14px;
		border: 1px solid #fecaca;
		border-radius: 12px;
		background: #fef2f2;
		color: #991b1b;
		font-size: 13px;
	}
	.ri-errores ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
</style>
