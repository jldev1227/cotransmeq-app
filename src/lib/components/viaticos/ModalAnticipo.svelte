<script lang="ts">
	/**
	 * Registrar o editar un anticipo de viáticos.
	 *
	 * Dos formas de entregar el dinero:
	 *  - Transferencia: se puede adjuntar el comprobante (foto o PDF, opcional). Al soltarlo se
	 *    sube y Azure OpenAI lee valor, fecha, número y banco para prellenar el
	 *    formulario; quien registra revisa y corrige. Lo leído se guarda aparte
	 *    para auditar diferencias.
	 *  - Retiro con tarjeta: el conductor retiró con una tarjeta de la empresa;
	 *    solo se indica cuál.
	 *
	 * Cuando viene de una solicitud del conductor (`solicitud`), conductor y
	 * placa quedan fijos: la solicitud nació de un anticipo de esa pareja. El
	 * valor llega con lo pedido y se puede ajustar.
	 */
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		CreditCard,
		FileText,
		Landmark,
		Loader2,
		Lock,
		Sparkles,
		Upload,
		X
	} from 'lucide-svelte';
	import ModalEntidad from '$lib/components/directorio/ModalEntidad.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import SelectBuscable from '$lib/components/common/SelectBuscable.svelte';
	import { conductoresOptions, recursos, vehiculosOptions } from '$lib/stores/recursos';
	import {
		comprimirImagen,
		moneda,
		viaticosAPI,
		type AnticipoDetalle,
		type AnticipoInput,
		type LecturaComprobante,
		type MetodoAnticipo,
		type SolicitudListada
	} from '$lib/api/viaticos';

	interface Props {
		open: boolean;
		/** Anticipo a editar; `null` registra uno nuevo. */
		anticipo?: AnticipoDetalle | null;
		/** Solicitud del conductor que se aprueba con este anticipo. */
		solicitud?: SolicitudListada | null;
		oncerrar: () => void;
		onguardado?: (a: AnticipoDetalle) => void;
	}
	let { open, anticipo = null, solicitud = null, oncerrar, onguardado }: Props = $props();

	const TIPOS = 'image/jpeg,image/png,image/webp,application/pdf';
	const MAX_BYTES = 10 * 1024 * 1024;
	const hoy = () => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};

	interface Comprobante {
		key: string;
		mime_type: string;
		nombre: string;
		/** URL para la vista previa: local recién elegido o firmada del servidor. */
		vista: string | null;
		/** Recién subido en esta apertura (el guardado del anticipo lo verifica). */
		nuevo: boolean;
	}

	function desde(a: AnticipoDetalle | null, s: SolicitudListada | null) {
		return {
			conductor_id: a?.conductor.id ?? s?.conductor.id ?? '',
			vehiculo_id: a?.vehiculo.id ?? s?.vehiculo.id ?? '',
			concepto: a?.concepto ?? (s ? s.anticipo_origen.concepto : ''),
			valor: a ? String(Math.round(a.valor)) : s ? String(Math.round(s.valor_solicitado)) : '',
			metodo: (a?.metodo ?? 'TRANSFERENCIA') as MetodoAnticipo,
			fecha: a?.fecha ?? hoy(),
			numero_comprobante: a?.numero_comprobante ?? '',
			entidad: a?.entidad ?? '',
			tarjeta_cuenta: a?.tarjeta_cuenta ?? ''
		};
	}
	type Form = ReturnType<typeof desde>;

	let form = $state<Form>(desde(null, null));
	let comprobante = $state<Comprobante | null>(null);
	let lectura = $state<LecturaComprobante | null>(null);
	let inicial = $state('');
	let errores = $state<Partial<Record<keyof Form | 'comprobante', string>>>({});
	let guardando = $state(false);
	let subiendo = $state(false);
	let leyendo = $state(false);
	let tab = $state('anticipo');
	let arrastrando = $state(false);
	let inputArchivo: HTMLInputElement | null = $state(null);

	$effect(() => {
		if (!open) return;
		const a = anticipo;
		const s = solicitud;
		untrack(() => {
			form = desde(a, s);
			comprobante = a?.comprobante
				? {
						key: a.comprobante.key ?? '',
						mime_type: a.comprobante.mime_type ?? '',
						nombre: a.comprobante.nombre ?? 'Comprobante',
						vista: a.comprobante.url,
						nuevo: false
					}
				: null;
			lectura = a?.comprobante_lectura ?? null;
			inicial = JSON.stringify(form);
			errores = {};
			tab = 'anticipo';
			void recursos.cargarConductores();
			void recursos.cargarVehiculos();
		});
	});

	const editando = $derived(!!anticipo);
	/// Conductor y placa fijos: vienen de una solicitud (nueva o ya aprobada).
	const parejaFija = $derived(!!solicitud || !!anticipo?.solicitud_id);
	const sucio = $derived(JSON.stringify(form) !== inicial || !!comprobante?.nuevo);
	const valorNumero = $derived(Number(form.valor.replace(/\D/g, '')) || 0);
	const difiereDeLectura = $derived(
		form.metodo === 'TRANSFERENCIA' &&
			lectura?.valor != null &&
			valorNumero > 0 &&
			valorNumero !== lectura.valor
	);
	const inv = (k: keyof Form) => (errores[k] ? 'true' : undefined);

	function valorEscrito(e: Event) {
		const digitos = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 12);
		form.valor = digitos;
	}
	const valorVisible = $derived(form.valor ? Number(form.valor).toLocaleString('es-CO') : '');

	async function elegirArchivo(archivo: File | undefined) {
		if (!archivo) return;
		if (!TIPOS.split(',').includes(archivo.type)) {
			toast.error('El comprobante debe ser una imagen (JPG, PNG, WEBP) o un PDF.');
			return;
		}
		if (archivo.size > MAX_BYTES) {
			toast.error('El comprobante no puede pasar de 10 MB.');
			return;
		}
		subiendo = true;
		errores = { ...errores, comprobante: undefined };
		try {
			const liviano = await comprimirImagen(archivo);
			const subido = await viaticosAPI.subirComprobante(liviano);
			comprobante = {
				...subido,
				nuevo: true,
				vista: liviano.type.startsWith('image/') ? URL.createObjectURL(liviano) : null
			};
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo subir el comprobante');
			return;
		} finally {
			subiendo = false;
		}
		await leer();
	}

	/// Lee el comprobante y prellena lo que el modelo encontró. Si no se puede,
	/// el formulario sigue sirviendo: se escribe a mano.
	async function leer() {
		if (!comprobante?.key) return;
		leyendo = true;
		try {
			const l = await viaticosAPI.leerComprobante(comprobante.key, comprobante.mime_type);
			lectura = l;
			if (l.valor) form.valor = String(l.valor);
			if (l.fecha) form.fecha = l.fecha;
			if (l.numero_comprobante) form.numero_comprobante = l.numero_comprobante;
			if (l.entidad) form.entidad = l.entidad;
			const leidos = [
				l.valor && 'valor',
				l.fecha && 'fecha',
				l.numero_comprobante && 'número'
			].filter(Boolean);
			if (l.confianza === 'baja' || !leidos.length) {
				toast.warning('No parece un comprobante legible. Revisa los datos y escríbelos a mano.');
			} else {
				toast.success(`Leído del comprobante: ${leidos.join(', ')}. Revísalo antes de guardar.`);
			}
		} catch (error) {
			toast.warning(error instanceof Error ? error.message : 'No se pudo leer el comprobante');
		} finally {
			leyendo = false;
		}
	}

	function quitarComprobante() {
		comprobante = null;
		lectura = null;
		if (inputArchivo) inputArchivo.value = '';
	}

	function validar(): boolean {
		const e: typeof errores = {};
		if (!form.conductor_id) e.conductor_id = 'Selecciona el conductor.';
		if (!form.vehiculo_id) e.vehiculo_id = 'Selecciona la placa.';
		if (form.concepto.trim().length < 3) e.concepto = 'Escribe el concepto del anticipo.';
		if (valorNumero <= 0) e.valor = 'Escribe el valor entregado.';
		if (!form.fecha) e.fecha = 'Indica la fecha.';
		if (form.metodo === 'RETIRO_TARJETA' && !form.tarjeta_cuenta.trim()) {
			e.tarjeta_cuenta = 'Indica de qué tarjeta o cuenta salió.';
		}
		errores = e;
		return Object.keys(e).length === 0;
	}

	async function guardar() {
		if (subiendo || leyendo) return;
		if (!validar()) return;
		guardando = true;
		try {
			const transferencia = form.metodo === 'TRANSFERENCIA';
			const input: AnticipoInput = {
				conductor_id: form.conductor_id,
				vehiculo_id: form.vehiculo_id,
				concepto: form.concepto.trim(),
				valor: valorNumero,
				metodo: form.metodo,
				fecha: form.fecha,
				numero_comprobante: transferencia ? form.numero_comprobante.trim() || null : null,
				entidad: transferencia ? form.entidad.trim() || null : null,
				tarjeta_cuenta: transferencia ? null : form.tarjeta_cuenta.trim(),
				comprobante:
					transferencia && comprobante
						? { key: comprobante.key, mime_type: comprobante.mime_type, nombre: comprobante.nombre }
						: null,
				/// La lectura solo acompaña a un comprobante nuevo; si no, el servidor conserva la que había.
				comprobante_lectura: transferencia && comprobante?.nuevo ? lectura : null,
				solicitud_id: solicitud?.id ?? null
			};
			const r = anticipo
				? await viaticosAPI.actualizar(anticipo.id, input)
				: await viaticosAPI.crear(input);
			toast.success(
				solicitud
					? `Solicitud aprobada: anticipo de ${moneda(r.valor)} para ${r.conductor.nombre}`
					: anticipo
						? 'Anticipo actualizado'
						: `Anticipo de ${moneda(r.valor)} registrado`
			);
			onguardado?.(r);
			oncerrar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo guardar el anticipo');
		} finally {
			guardando = false;
		}
	}

	const conductorFijo = $derived(solicitud?.conductor.nombre ?? anticipo?.conductor.nombre ?? '');
	const placaFija = $derived(solicitud?.vehiculo.placa ?? anticipo?.vehiculo.placa ?? '');
</script>

<ModalEntidad
	{open}
	eyebrow={solicitud ? 'APROBAR SOLICITUD' : editando ? 'EDITAR ANTICIPO' : 'NUEVO ANTICIPO'}
	title={solicitud
		? `Anticipo para ${solicitud.conductor.nombre}`
		: editando
			? 'Anticipo de viáticos'
			: 'Registrar anticipo de viáticos'}
	subtitle={solicitud
		? `Solicitó ${moneda(solicitud.valor_solicitado)}. Ajusta el valor si hace falta y registra cómo se entregó.`
		: 'Los campos con * son obligatorios.'}
	tabs={[{ id: 'anticipo', label: 'Anticipo' }]}
	bind:tabActiva={tab}
	guardando={guardando || subiendo || leyendo}
	{sucio}
	textoGuardar={solicitud
		? 'Aprobar y registrar'
		: editando
			? 'Guardar cambios'
			: 'Registrar anticipo'}
	onguardar={guardar}
	{oncerrar}
>
	{#snippet children()}
		<div class="de-grid">
			{#if solicitud?.observaciones}
				<p class="va-nota de-full">
					<strong>Observaciones del conductor:</strong>
					{solicitud.observaciones}
				</p>
			{/if}

			<Campo id="va-conductor" label="Conductor" requerido error={errores.conductor_id}>
				{#if parejaFija}
					<div class="va-fijo"><Lock size={14} /> {conductorFijo}</div>
				{:else}
					<SelectBuscable
						opciones={$conductoresOptions}
						valor={form.conductor_id || null}
						placeholder="Selecciona el conductor"
						placeholderBusqueda="Nombre o documento…"
						onSeleccionar={(v) => (form.conductor_id = v ?? '')}
					/>
				{/if}
			</Campo>
			<Campo id="va-placa" label="Placa" requerido error={errores.vehiculo_id}>
				{#if parejaFija}
					<div class="va-fijo"><Lock size={14} /> {placaFija}</div>
				{:else}
					<SelectBuscable
						opciones={$vehiculosOptions}
						valor={form.vehiculo_id || null}
						placeholder="Selecciona la placa"
						placeholderBusqueda="Placa o marca…"
						onSeleccionar={(v) => (form.vehiculo_id = v ?? '')}
					/>
				{/if}
			</Campo>

			<Campo
				id="va-concepto"
				label="Concepto del anticipo"
				requerido
				completo
				error={errores.concepto}
			>
				<textarea
					id="va-concepto"
					class="de-input"
					rows="2"
					placeholder="Ej. Viaje Yopal – Aguazul, peajes y alimentación"
					bind:value={form.concepto}
					aria-invalid={inv('concepto')}
				></textarea>
			</Campo>

			<div class="de-full va-metodos" role="radiogroup" aria-label="Cómo se entregó el dinero">
				<button
					type="button"
					role="radio"
					aria-checked={form.metodo === 'TRANSFERENCIA'}
					class="va-metodo"
					class:va-metodo--on={form.metodo === 'TRANSFERENCIA'}
					onclick={() => (form.metodo = 'TRANSFERENCIA')}
				>
					<Landmark size={20} />
					<span>
						<strong>Transferencia</strong>
						<small>Con el comprobante del pago, si lo hay</small>
					</span>
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={form.metodo === 'RETIRO_TARJETA'}
					class="va-metodo"
					class:va-metodo--on={form.metodo === 'RETIRO_TARJETA'}
					onclick={() => (form.metodo = 'RETIRO_TARJETA')}
				>
					<CreditCard size={20} />
					<span>
						<strong>Retiro con tarjeta</strong>
						<small>El conductor retiró con una tarjeta de la empresa</small>
					</span>
				</button>
			</div>

			{#if form.metodo === 'TRANSFERENCIA'}
				<div class="de-full" in:fly={{ y: 6, duration: 180 }}>
					<span class="va-etiqueta">Comprobante (opcional)</span>
					{#if comprobante}
						<div class="va-comprobante">
							{#if comprobante.vista && comprobante.mime_type.startsWith('image/')}
								<a href={comprobante.vista} target="_blank" rel="noopener" class="va-miniatura">
									<img src={comprobante.vista} alt="Comprobante" />
								</a>
							{:else}
								<a
									href={comprobante.vista ?? undefined}
									target="_blank"
									rel="noopener"
									class="va-miniatura va-miniatura--pdf"
								>
									<FileText size={28} />
								</a>
							{/if}
							<div class="va-comprobante-info">
								<strong>{comprobante.nombre}</strong>
								{#if subiendo}
									<span class="va-estado"><Loader2 size={14} class="va-gira" /> Subiendo…</span>
								{:else if leyendo}
									<span class="va-estado va-estado--ia">
										<Sparkles size={14} /> Leyendo el comprobante con IA…
									</span>
								{:else if lectura}
									<span class="va-estado va-estado--ia">
										<Sparkles size={14} />
										Leído: {lectura.valor != null
											? moneda(lectura.valor)
											: 'sin valor'}{lectura.fecha
											? ` · ${lectura.fecha.split('-').reverse().join('/')}`
											: ''} · confianza {lectura.confianza}
									</span>
								{/if}
							</div>
							<div class="va-comprobante-acciones">
								{#if comprobante.nuevo && !leyendo && !subiendo}
									<button type="button" class="btn-secondary va-mini" onclick={leer}>
										<Sparkles size={14} /> Volver a leer
									</button>
								{/if}
								<button
									type="button"
									class="va-quitar"
									aria-label="Quitar comprobante"
									onclick={quitarComprobante}
									disabled={subiendo || leyendo}
								>
									<X size={16} />
								</button>
							</div>
						</div>
					{:else}
						<label
							class="va-drop"
							class:va-drop--on={arrastrando}
							class:va-drop--error={!!errores.comprobante}
							ondragover={(e) => {
								e.preventDefault();
								arrastrando = true;
							}}
							ondragleave={() => (arrastrando = false)}
							ondrop={(e) => {
								e.preventDefault();
								arrastrando = false;
								void elegirArchivo(e.dataTransfer?.files?.[0]);
							}}
						>
							{#if subiendo}
								<Loader2 size={22} class="va-gira" />
								<span>Subiendo…</span>
							{:else}
								<Upload size={22} />
								<span><strong>Suelta aquí el comprobante</strong> o haz clic para elegirlo</span>
								<small>Foto o PDF, hasta 10 MB. La IA lee valor, fecha y número.</small>
							{/if}
							<input
								bind:this={inputArchivo}
								type="file"
								accept={TIPOS}
								class="va-oculto"
								onchange={(e) => elegirArchivo(e.currentTarget.files?.[0])}
							/>
						</label>
						{#if errores.comprobante}<p class="va-error">{errores.comprobante}</p>{/if}
					{/if}
				</div>
			{:else}
				<Campo
					id="va-tarjeta"
					label="Tarjeta o cuenta de la que salió"
					requerido
					completo
					error={errores.tarjeta_cuenta}
				>
					<input
						id="va-tarjeta"
						class="de-input"
						placeholder="Ej. Tarjeta débito Bancolombia terminada en 4521"
						bind:value={form.tarjeta_cuenta}
						aria-invalid={inv('tarjeta_cuenta')}
					/>
				</Campo>
			{/if}

			<Campo
				id="va-valor"
				label="Valor"
				requerido
				error={errores.valor}
				ayuda={difiereDeLectura ? `El comprobante dice ${moneda(lectura!.valor!)}.` : undefined}
			>
				<div class="va-dinero">
					<span>$</span>
					<input
						id="va-valor"
						class="de-input"
						inputmode="numeric"
						placeholder="0"
						value={valorVisible}
						oninput={valorEscrito}
						aria-invalid={inv('valor')}
					/>
				</div>
			</Campo>
			<Campo id="va-fecha" label="Fecha" requerido error={errores.fecha}>
				<input
					id="va-fecha"
					type="date"
					class="de-input"
					bind:value={form.fecha}
					aria-invalid={inv('fecha')}
				/>
			</Campo>

			{#if form.metodo === 'TRANSFERENCIA'}
				<Campo id="va-numero" label="Número de comprobante">
					<input
						id="va-numero"
						class="de-input"
						placeholder="Ej. 0000093600"
						bind:value={form.numero_comprobante}
					/>
				</Campo>
				<Campo id="va-entidad" label="Banco o entidad">
					<input
						id="va-entidad"
						class="de-input"
						placeholder="Ej. Bancolombia"
						bind:value={form.entidad}
					/>
				</Campo>
			{/if}
		</div>
	{/snippet}
</ModalEntidad>

<style>
	.va-fijo {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 0 12px;
		border: 1px dashed var(--border-default);
		border-radius: 12px;
		background: var(--bg-muted, #f5f7f6);
		color: var(--text-primary);
		font-weight: 600;
	}
	.va-nota {
		margin: 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--au-tint);
		color: var(--text-primary);
		font-size: 13px;
	}
	.va-metodos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 10px;
	}
	.va-metodo {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border: 1.5px solid var(--border-default);
		border-radius: 14px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.va-metodo span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.va-metodo strong {
		color: var(--text-primary);
		font-size: 14px;
	}
	.va-metodo small {
		font-size: 12px;
	}
	.va-metodo--on {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.va-etiqueta {
		display: block;
		margin-bottom: 6px;
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 700;
	}
	.va-req {
		color: #dc2626;
	}
	.va-drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 22px 16px;
		border: 1.5px dashed var(--border-default);
		border-radius: 14px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		text-align: center;
		font-size: 13px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.va-drop:hover,
	.va-drop--on {
		border-color: var(--au-primary);
		background: var(--au-tint);
	}
	.va-drop--error {
		border-color: #dc2626;
	}
	.va-drop small {
		font-size: 12px;
	}
	.va-oculto {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.va-error {
		margin: 6px 0 0;
		color: #b42318;
		font-size: 12px;
		font-weight: 600;
	}
	.va-comprobante {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px;
		border: 1px solid var(--border-default);
		border-radius: 14px;
		background: var(--bg-surface);
	}
	.va-miniatura {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		overflow: hidden;
		border-radius: 10px;
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.va-miniatura img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.va-comprobante-info {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		font-size: 13px;
	}
	.va-comprobante-info strong {
		overflow: hidden;
		color: var(--text-primary);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.va-estado {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-secondary);
	}
	.va-estado--ia {
		color: var(--au-dark);
		font-weight: 600;
	}
	.va-comprobante-acciones {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.va-mini {
		min-height: 32px !important;
		padding: 0 10px !important;
		font-size: 12px !important;
	}
	.va-quitar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.va-quitar:hover {
		background: #fee2e2;
		color: #b42318;
	}
	.va-dinero {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.va-dinero span {
		color: var(--text-secondary);
		font-weight: 700;
	}
	.va-dinero input {
		flex: 1;
		font-variant-numeric: tabular-nums;
	}
	:global(.va-gira) {
		animation: va-giro 0.9s linear infinite;
	}
	@keyframes va-giro {
		to {
			transform: rotate(360deg);
		}
	}
</style>
