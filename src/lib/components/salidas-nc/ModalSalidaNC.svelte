<script lang="ts">
	/**
	 * Registro y edición de una salida no conforme (ISO 9001 · 8.7).
	 *
	 * Va sobre el cascarón de los formularios de directorio (`ModalEntidad`):
	 * encabezado de marca, pestañas con el conteo de errores, pie con las
	 * acciones y aviso de cambios sin guardar. Las cinco secciones del formato
	 * (identificación, descripción, tratamiento, concesión, verificación) son
	 * cuatro pestañas: la concesión vive dentro de «Tratamiento» porque solo
	 * aparece cuando el tratamiento elegido es una concesión.
	 *
	 * Antes era un modal propio con cabecera roja, campos de Tailwind y una
	 * sola columna de 1 200 px de alto; la validación era un toast que no
	 * decía qué faltaba ni dónde.
	 */
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import ModalEntidad from '$lib/components/directorio/ModalEntidad.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import {
		salidasNCAPI,
		type SalidaNoConforme,
		type ClasificacionNC,
		type TipoDeteccion,
		type TipoSalidaNC,
		type TratamientoSNC,
		type MedioAutorizacion,
		type MetodoVerificacion,
		CLASIFICACION_LABELS,
		TIPO_DETECCION_LABELS,
		TIPO_SALIDA_NC_LABELS,
		TRATAMIENTO_SNC_LABELS,
		MEDIO_AUTORIZACION_LABELS,
		METODO_VERIFICACION_LABELS
	} from '$lib/api/salidas-nc';

	interface Props {
		open: boolean;
		/** SNC a editar; `null` registra una nueva. */
		salida?: SalidaNoConforme | null;
		oncerrar: () => void;
		onguardado?: () => void;
	}
	let { open, salida = null, oncerrar, onguardado }: Props = $props();

	const TABS = [
		{ id: 'identificacion', label: 'Identificación' },
		{ id: 'descripcion', label: 'Descripción' },
		{ id: 'tratamiento', label: 'Tratamiento' },
		{ id: 'verificacion', label: 'Verificación' }
	];

	const hoy = () => new Date().toISOString().split('T')[0];
	const dia = (v?: string | null) => v?.split('T')[0] ?? '';

	function desde(s: SalidaNoConforme | null) {
		return {
			fecha_deteccion: s ? dia(s.fecha_deteccion) : hoy(),
			fecha_evento: s ? dia(s.fecha_evento) : hoy(),
			detectado_por: s?.detectado_por ?? '',
			area_proceso: s?.area_proceso ?? '',
			tipo_deteccion: (s?.tipo_deteccion ?? '') as TipoDeteccion | '',
			tipo_deteccion_otro: s?.tipo_deteccion_otro ?? '',
			vehiculo_placa: s?.vehiculo_placa ?? '',
			ruta_trayecto: s?.ruta_trayecto ?? '',
			turno_horario: s?.turno_horario ?? '',
			conductor_nombre: s?.conductor_nombre ?? '',
			conductor_cedula: s?.conductor_cedula ?? '',
			cliente_contrato: s?.cliente_contrato ?? '',
			servicio_afectado: s?.servicio_afectado ?? '',
			descripcion_nc: s?.descripcion_nc ?? '',
			clasificacion_nc: (s?.clasificacion_nc ?? '') as ClasificacionNC | '',
			tipo_salida_nc: (s?.tipo_salida_nc ?? '') as TipoSalidaNC | '',
			tipo_salida_nc_otro: s?.tipo_salida_nc_otro ?? '',
			tratamiento_seleccionado: (s?.tratamiento_seleccionado ?? '') as TratamientoSNC | '',
			descripcion_accion_tomada: s?.descripcion_accion_tomada ?? '',
			responsable_accion: s?.responsable_accion ?? '',
			fecha_implementacion: dia(s?.fecha_implementacion),
			autoridad_disposicion: s?.autoridad_disposicion ?? '',
			concesion_solicitada: s?.concesion_solicitada ?? false,
			condiciones_concesion: s?.condiciones_concesion ?? '',
			concesion_cliente_nombre: s?.concesion_cliente_nombre ?? '',
			concesion_cliente_fecha: dia(s?.concesion_cliente_fecha),
			concesion_medio: (s?.concesion_medio ?? '') as MedioAutorizacion | '',
			metodo_verificacion: (s?.metodo_verificacion ?? '') as MetodoVerificacion | '',
			metodo_verificacion_otro: s?.metodo_verificacion_otro ?? '',
			resultado_verificacion: s?.resultado_verificacion ?? '',
			cumple_requisitos: (s?.cumple_requisitos === true ? 'SI' : s?.cumple_requisitos === false ? 'NO' : '') as
				| 'SI'
				| 'NO'
				| '',
			responsable_verificacion: s?.responsable_verificacion ?? '',
			fecha_verificacion: dia(s?.fecha_verificacion),
			firma_verificacion: s?.firma_verificacion ?? '',
			conductor_id: s?.conductor_id ?? '',
			vehiculo_id: s?.vehiculo_id ?? '',
			cliente_id: s?.cliente_id ?? '',
			observaciones: s?.observaciones ?? ''
		};
	}
	type Form = ReturnType<typeof desde>;

	let form = $state<Form>(desde(null));
	let inicial = $state('');
	let errores = $state<Partial<Record<keyof Form, string>>>({});
	let guardando = $state(false);
	let tab = $state('identificacion');
	let numero = $state(1);

	/// Cada apertura parte de la SNC recibida (o de una vacía) y guarda la foto
	/// inicial para el aviso de cambios sin guardar. El consecutivo de una nueva
	/// se pide al abrir, no al guardar: es el que se ve en el encabezado.
	$effect(() => {
		if (!open) return;
		const s = salida;
		untrack(() => {
			form = desde(s);
			inicial = JSON.stringify(form);
			errores = {};
			tab = 'identificacion';
			if (s) numero = s.numero_snc;
			else {
				numero = 1;
				salidasNCAPI
					.siguienteNumero()
					.then((n) => (numero = n))
					.catch(() => {});
			}
		});
	});

	const editando = $derived(!!salida);
	const sucio = $derived(JSON.stringify(form) !== inicial);
	const codigo = $derived(`SNC-${String(numero).padStart(4, '0')}`);
	const inv = (k: keyof Form) => (errores[k] ? 'true' : undefined);

	/// Qué pestaña contiene cada campo obligatorio: para contar errores por
	/// pestaña y saltar a la primera que tenga alguno.
	const TAB_DE: Partial<Record<keyof Form, string>> = {
		fecha_deteccion: 'identificacion',
		fecha_evento: 'identificacion',
		detectado_por: 'identificacion',
		area_proceso: 'identificacion',
		tipo_deteccion: 'identificacion',
		tipo_deteccion_otro: 'identificacion',
		descripcion_nc: 'descripcion',
		clasificacion_nc: 'descripcion',
		tipo_salida_nc: 'descripcion',
		tipo_salida_nc_otro: 'descripcion',
		metodo_verificacion_otro: 'verificacion'
	};
	const erroresPorTab = $derived.by(() => {
		const conteo: Record<string, number> = {};
		for (const k of Object.keys(errores) as (keyof Form)[]) {
			const t = TAB_DE[k];
			if (t) conteo[t] = (conteo[t] ?? 0) + 1;
		}
		return conteo;
	});

	function validar(): boolean {
		const e: Partial<Record<keyof Form, string>> = {};
		const falta = 'Obligatorio.';
		if (!form.fecha_deteccion) e.fecha_deteccion = falta;
		if (!form.fecha_evento) e.fecha_evento = falta;
		if (form.fecha_evento && form.fecha_deteccion && form.fecha_evento > form.fecha_deteccion) {
			e.fecha_evento = 'No puede ser posterior a la detección.';
		}
		if (!form.detectado_por.trim()) e.detectado_por = falta;
		if (!form.area_proceso.trim()) e.area_proceso = falta;
		if (!form.tipo_deteccion) e.tipo_deteccion = 'Elige cómo se detectó.';
		if (form.tipo_deteccion === 'OTRO' && !form.tipo_deteccion_otro.trim()) e.tipo_deteccion_otro = falta;
		if (!form.descripcion_nc.trim()) e.descripcion_nc = 'Describe la no conformidad.';
		if (!form.clasificacion_nc) e.clasificacion_nc = 'Elige la clasificación.';
		if (!form.tipo_salida_nc) e.tipo_salida_nc = 'Elige el tipo de salida.';
		if (form.tipo_salida_nc === 'OTRO' && !form.tipo_salida_nc_otro.trim()) e.tipo_salida_nc_otro = falta;
		if (form.metodo_verificacion === 'OTRO' && !form.metodo_verificacion_otro.trim()) {
			e.metodo_verificacion_otro = falta;
		}
		errores = e;
		const primera = TABS.find((t) => erroresPorTabDe(e)[t.id]);
		if (primera) tab = primera.id;
		return Object.keys(e).length === 0;
	}
	function erroresPorTabDe(e: Partial<Record<keyof Form, string>>) {
		const c: Record<string, number> = {};
		for (const k of Object.keys(e) as (keyof Form)[]) {
			const t = TAB_DE[k];
			if (t) c[t] = (c[t] ?? 0) + 1;
		}
		return c;
	}

	async function guardar() {
		if (!validar()) return;
		guardando = true;
		try {
			const data: Record<string, unknown> = { ...form };
			for (const k of Object.keys(data)) if (data[k] === '' || data[k] === null) delete data[k];
			if (form.cumple_requisitos === 'SI') data.cumple_requisitos = true;
			else if (form.cumple_requisitos === 'NO') data.cumple_requisitos = false;
			else delete data.cumple_requisitos;
			if (salida) {
				await salidasNCAPI.actualizar(salida.id, data as any);
				toast.success(`${codigo} actualizada`);
			} else {
				await salidasNCAPI.crear(data as any);
				toast.success(`${codigo} registrada`);
			}
			onguardado?.();
			oncerrar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo guardar la SNC');
		} finally {
			guardando = false;
		}
	}
</script>

<ModalEntidad
	{open}
	eyebrow={editando ? `EDITAR · ${codigo}` : `NUEVA · ${codigo}`}
	title={editando ? 'Salida no conforme' : 'Registrar salida no conforme'}
	subtitle="ISO 9001 · cláusula 8.7. Los campos con * son obligatorios."
	tabs={TABS}
	bind:tabActiva={tab}
	{erroresPorTab}
	{guardando}
	{sucio}
	textoGuardar={editando ? 'Guardar cambios' : 'Registrar SNC'}
	onguardar={guardar}
	{oncerrar}
>
	{#snippet children(activa)}
		{#if activa === 'identificacion'}
			<div class="de-grid">
				<Campo id="snc-fecha-det" label="Fecha de detección" requerido error={errores.fecha_deteccion}>
					<input id="snc-fecha-det" type="date" class="de-input" bind:value={form.fecha_deteccion} aria-invalid={inv('fecha_deteccion')} />
				</Campo>
				<Campo id="snc-fecha-ev" label="Fecha del evento" requerido error={errores.fecha_evento}>
					<input id="snc-fecha-ev" type="date" class="de-input" bind:value={form.fecha_evento} aria-invalid={inv('fecha_evento')} />
				</Campo>
				<Campo id="snc-detectado" label="Detectado por" requerido error={errores.detectado_por}>
					<input id="snc-detectado" class="de-input" placeholder="Nombre de quien detecta" bind:value={form.detectado_por} aria-invalid={inv('detectado_por')} />
				</Campo>
				<Campo id="snc-area" label="Área o proceso" requerido error={errores.area_proceso}>
					<input id="snc-area" class="de-input" placeholder="Ej. Operaciones" bind:value={form.area_proceso} aria-invalid={inv('area_proceso')} />
				</Campo>
				<Campo id="snc-tipo-det" label="Tipo de detección" requerido error={errores.tipo_deteccion}>
					<select id="snc-tipo-det" class="de-input" bind:value={form.tipo_deteccion} aria-invalid={inv('tipo_deteccion')}>
						<option value="">Selecciona…</option>
						{#each Object.entries(TIPO_DETECCION_LABELS) as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</Campo>
				{#if form.tipo_deteccion === 'OTRO'}
					<Campo id="snc-tipo-det-otro" label="¿Cuál?" requerido error={errores.tipo_deteccion_otro}>
						<input id="snc-tipo-det-otro" class="de-input" placeholder="Detalla el tipo de detección" bind:value={form.tipo_deteccion_otro} aria-invalid={inv('tipo_deteccion_otro')} />
					</Campo>
				{/if}

				<p class="snc-seccion de-full">Servicio involucrado</p>
				<Campo id="snc-cliente" label="Cliente o contrato">
					<input id="snc-cliente" class="de-input" placeholder="Cliente o contrato afectado" bind:value={form.cliente_contrato} />
				</Campo>
				<Campo id="snc-conductor" label="Conductor">
					<input id="snc-conductor" class="de-input" placeholder="Nombre y apellido" bind:value={form.conductor_nombre} />
				</Campo>
				<Campo id="snc-cedula" label="Cédula del conductor">
					<input id="snc-cedula" class="de-input" inputmode="numeric" placeholder="Número de cédula" bind:value={form.conductor_cedula} />
				</Campo>
				<Campo id="snc-placa" label="Placa">
					<input id="snc-placa" class="de-input" style="text-transform: uppercase" placeholder="ABC123" bind:value={form.vehiculo_placa} />
				</Campo>
				<Campo id="snc-ruta" label="Ruta o trayecto">
					<input id="snc-ruta" class="de-input" placeholder="Ej. Yopal – Tauramena" bind:value={form.ruta_trayecto} />
				</Campo>
				<Campo id="snc-turno" label="Turno u horario">
					<input id="snc-turno" class="de-input" placeholder="Ej. 06:00 – 18:00" bind:value={form.turno_horario} />
				</Campo>
				<Campo id="snc-servicio" label="Servicio afectado" completo>
					<textarea id="snc-servicio" class="de-input" rows="2" placeholder="Servicio contratado que se vio afectado…" bind:value={form.servicio_afectado}></textarea>
				</Campo>
			</div>
		{:else if activa === 'descripcion'}
			<div class="de-grid">
				<Campo
					id="snc-descripcion"
					label="Descripción de la no conformidad"
					requerido
					completo
					error={errores.descripcion_nc}
					ayuda="Qué requisito se incumplió, cómo se manifestó y qué impacto tuvo en el cliente o el servicio."
				>
					<textarea id="snc-descripcion" class="de-input" rows="5" placeholder="Describe la no conformidad…" bind:value={form.descripcion_nc} aria-invalid={inv('descripcion_nc')}></textarea>
				</Campo>
				<Campo id="snc-clasif" label="Clasificación" requerido error={errores.clasificacion_nc}>
					<select id="snc-clasif" class="de-input" bind:value={form.clasificacion_nc} aria-invalid={inv('clasificacion_nc')}>
						<option value="">Selecciona…</option>
						{#each Object.entries(CLASIFICACION_LABELS) as [v, info] (v)}<option value={v}>{info.label}</option>{/each}
					</select>
				</Campo>
				<Campo id="snc-tipo" label="Tipo de salida" requerido error={errores.tipo_salida_nc}>
					<select id="snc-tipo" class="de-input" bind:value={form.tipo_salida_nc} aria-invalid={inv('tipo_salida_nc')}>
						<option value="">Selecciona…</option>
						{#each Object.entries(TIPO_SALIDA_NC_LABELS) as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</Campo>
				{#if form.clasificacion_nc}
					<p
						class="snc-nota de-full"
						class:snc-nota--alerta={form.clasificacion_nc !== 'MENOR'}
						in:fly={{ y: -4, duration: 180 }}
					>
						<strong>{CLASIFICACION_LABELS[form.clasificacion_nc].label}:</strong>
						{CLASIFICACION_LABELS[form.clasificacion_nc].description}.
					</p>
				{/if}
				{#if form.tipo_salida_nc === 'OTRO'}
					<Campo id="snc-tipo-otro" label="¿Qué tipo de salida?" requerido completo error={errores.tipo_salida_nc_otro}>
						<input id="snc-tipo-otro" class="de-input" placeholder="Detalla el tipo de salida no conforme" bind:value={form.tipo_salida_nc_otro} aria-invalid={inv('tipo_salida_nc_otro')} />
					</Campo>
				{/if}
				<Campo id="snc-obs" label="Observaciones" completo>
					<textarea id="snc-obs" class="de-input" rows="2" placeholder="Observaciones adicionales…" bind:value={form.observaciones}></textarea>
				</Campo>
			</div>
		{:else if activa === 'tratamiento'}
			<div class="de-grid">
				<Campo id="snc-trat" label="Tratamiento aplicado" completo ayuda="ISO 8.7.1 a–d.">
					<select id="snc-trat" class="de-input" bind:value={form.tratamiento_seleccionado}>
						<option value="">Selecciona…</option>
						{#each Object.entries(TRATAMIENTO_SNC_LABELS) as [v, info] (v)}<option value={v}>{info.label} — {info.description}</option>{/each}
					</select>
				</Campo>
				<Campo id="snc-accion" label="Acción tomada" completo ayuda="Acción implementada, recursos utilizados y tiempo de respuesta (ISO 8.7.2 b).">
					<textarea id="snc-accion" class="de-input" rows="4" placeholder="Detalle de la acción implementada…" bind:value={form.descripcion_accion_tomada}></textarea>
				</Campo>
				<Campo id="snc-resp" label="Responsable de la acción">
					<input id="snc-resp" class="de-input" placeholder="Nombre y cargo" bind:value={form.responsable_accion} />
				</Campo>
				<Campo id="snc-fecha-impl" label="Fecha de implementación">
					<input id="snc-fecha-impl" type="date" class="de-input" bind:value={form.fecha_implementacion} />
				</Campo>
				<Campo id="snc-autoridad" label="Autoridad que decidió" completo>
					<input id="snc-autoridad" class="de-input" placeholder="Cargo o nombre de quien autorizó" bind:value={form.autoridad_disposicion} />
				</Campo>

				{#if form.tratamiento_seleccionado === 'CONCESION'}
					<section class="snc-bloque snc-bloque--aviso de-full" in:fly={{ y: 8, duration: 200 }}>
						<header class="snc-bloque-cabecera">
							<span class="snc-bloque-titulo">Concesión formal del cliente</span>
							<span class="snc-bloque-norma">ISO 8.7.1 d · 8.7.2 c</span>
						</header>
						<p class="snc-bloque-texto">
							La concesión <strong>no aplica</strong> si hay riesgo para la seguridad de las personas, la salud
							o el medio ambiente.
						</p>
						<div class="snc-opciones" role="radiogroup" aria-label="¿Se solicitó concesión?">
							<span class="snc-opciones-label">¿Se solicitó concesión?</span>
							<label class="snc-opcion"><input type="radio" bind:group={form.concesion_solicitada} value={true} /> Sí</label>
							<label class="snc-opcion"><input type="radio" bind:group={form.concesion_solicitada} value={false} /> No</label>
						</div>
						{#if form.concesion_solicitada}
							<div class="de-grid" in:fly={{ y: 6, duration: 180 }}>
								<Campo id="snc-cond" label="Condiciones de la concesión" completo>
									<textarea id="snc-cond" class="de-input" rows="3" placeholder="Condiciones bajo las cuales el cliente autoriza continuar…" bind:value={form.condiciones_concesion}></textarea>
								</Campo>
								<Campo id="snc-rep" label="Representante del cliente">
									<input id="snc-rep" class="de-input" placeholder="Nombre" bind:value={form.concesion_cliente_nombre} />
								</Campo>
								<Campo id="snc-fecha-aut" label="Fecha de autorización">
									<input id="snc-fecha-aut" type="date" class="de-input" bind:value={form.concesion_cliente_fecha} />
								</Campo>
								<Campo id="snc-medio" label="Medio de autorización" completo>
									<select id="snc-medio" class="de-input" bind:value={form.concesion_medio}>
										<option value="">Selecciona…</option>
										{#each Object.entries(MEDIO_AUTORIZACION_LABELS) as [v, l] (v)}<option value={v}>{l}</option>{/each}
									</select>
								</Campo>
							</div>
						{/if}
					</section>
				{/if}
			</div>
		{:else}
			<div class="de-grid">
				<p class="snc-nota de-full">
					Confirma si la salida se resolvió conforme a los requisitos (ISO 8.7.1, párrafo final). Si no
					cumple, se escala como acción correctiva.
				</p>
				<Campo id="snc-metodo" label="Método de verificación">
					<select id="snc-metodo" class="de-input" bind:value={form.metodo_verificacion}>
						<option value="">Selecciona…</option>
						{#each Object.entries(METODO_VERIFICACION_LABELS) as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</Campo>
				{#if form.metodo_verificacion === 'OTRO'}
					<Campo id="snc-metodo-otro" label="¿Qué método?" requerido error={errores.metodo_verificacion_otro}>
						<input id="snc-metodo-otro" class="de-input" placeholder="Método de verificación usado" bind:value={form.metodo_verificacion_otro} aria-invalid={inv('metodo_verificacion_otro')} />
					</Campo>
				{/if}
				<Campo id="snc-fecha-ver" label="Fecha de verificación">
					<input id="snc-fecha-ver" type="date" class="de-input" bind:value={form.fecha_verificacion} />
				</Campo>
				<Campo id="snc-resultado" label="Resultado" completo ayuda="Evidencias, mediciones o registros que respaldan el resultado.">
					<textarea id="snc-resultado" class="de-input" rows="3" placeholder="Hallazgos de la verificación…" bind:value={form.resultado_verificacion}></textarea>
				</Campo>

				<div class="snc-opciones de-full" role="radiogroup" aria-label="¿Cumple requisitos después del tratamiento?">
					<span class="snc-opciones-label">¿Cumple requisitos después del tratamiento?</span>
					<label class="snc-opcion snc-opcion--si"><input type="radio" bind:group={form.cumple_requisitos} value="SI" /> Sí, se cierra la SNC</label>
					<label class="snc-opcion snc-opcion--no"><input type="radio" bind:group={form.cumple_requisitos} value="NO" /> No, escalar a acción correctiva</label>
				</div>
				{#if form.cumple_requisitos === 'NO'}
					<p class="snc-nota snc-nota--alerta de-full" in:fly={{ y: -4, duration: 180 }}>
						Se debe escalar como <strong>acción correctiva</strong> según el procedimiento <strong>HSEQ-PR-03</strong>.
					</p>
				{/if}

				<Campo id="snc-resp-ver" label="Responsable de la verificación">
					<input id="snc-resp-ver" class="de-input" placeholder="Nombre — cargo" bind:value={form.responsable_verificacion} />
				</Campo>
				<Campo id="snc-firma" label="Firma del verificador">
					<input id="snc-firma" class="de-input" placeholder="Nombre completo" bind:value={form.firma_verificacion} />
				</Campo>
			</div>
		{/if}
	{/snippet}
</ModalEntidad>

<style>
	.snc-seccion {
		margin: 6px 0 -4px;
		padding-top: 12px;
		border-top: 1px solid var(--border-subtle);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.snc-nota {
		margin: 0;
		padding: 10px 14px;
		border-radius: 12px;
		background: var(--au-tint);
		color: var(--au-dark);
		font-size: 13px;
		line-height: 1.5;
	}
	.snc-nota--alerta {
		background: var(--au-danger-soft);
		color: var(--au-danger);
	}

	.snc-bloque {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		border-radius: 16px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-surface);
	}
	.snc-bloque--aviso {
		border-color: #f3dfb1;
		background: #fffaf0;
	}
	.snc-bloque-cabecera {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}
	.snc-bloque-titulo {
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 800;
		color: var(--text-primary);
	}
	.snc-bloque-norma {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-muted);
	}
	.snc-bloque-texto {
		margin: 0;
		font-size: 13px;
		color: #8a5a00;
	}

	.snc-opciones {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.snc-opciones-label {
		flex-basis: 100%;
		font-size: 13px;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.snc-opcion {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 38px;
		padding: 0 14px;
		border: 1.5px solid var(--border-default);
		border-radius: 999px;
		background: var(--bg-surface);
		font-size: 13px;
		font-weight: 700;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.snc-opcion input {
		accent-color: var(--au-primary);
	}
	.snc-opcion:has(input:checked) {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.snc-opcion--no:has(input:checked) {
		border-color: var(--au-danger);
		background: var(--au-danger-soft);
		color: var(--au-danger);
	}
	.snc-opcion--no input {
		accent-color: var(--au-danger);
	}
</style>
