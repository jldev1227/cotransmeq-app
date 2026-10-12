<script lang="ts">
	/**
	 * Detalle de una orden de trabajo: datos, repuestos y costos, soportes
	 * (factura, fotos) y su ciclo: abierta → en curso → cerrada, o anulada.
	 *
	 * Cerrar pide la fecha y el kilometraje con que se hizo el trabajo: si es
	 * preventiva, con eso se mueve su plan (aquí se muestra cómo quedará antes
	 * de confirmar).
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Eye, FileText, Image, Paperclip, Trash2, Upload } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import { confirmar, confirmarEliminacion, pedirTexto } from '$lib/stores/confirm';
	import { comprimirImagen } from '$lib/api/viaticos';
	import {
		ESTADO_ORDEN,
		TIPO_ADJUNTO,
		TIPO_ORDEN,
		fecha as fmtFecha,
		km as fmtKm,
		mantenimientoAPI,
		moneda,
		type OrdenDetalle,
		type PlanDetalle,
		type TipoAdjunto
	} from '$lib/api/mantenimiento';

	interface Props {
		open: boolean;
		ordenId: string | null;
		hoy: string;
		puedeEscribir: boolean;
		oncerrar: () => void;
		oneditar: (o: OrdenDetalle) => void;
		/** Algo cambió (estado, adjuntos): la lista de atrás se recarga. */
		oncambio: () => void;
	}
	let { open, ordenId, hoy, puedeEscribir, oncerrar, oneditar, oncambio }: Props = $props();

	let orden = $state<OrdenDetalle | null>(null);
	let plan = $state<PlanDetalle | null>(null);
	let cargando = $state(false);
	let trabajando = $state(false);

	// Cierre en línea
	let cerrando = $state(false);
	let fechaEjec = $state('');
	let kmEjec = $state('');

	// Subida de soportes
	let tipoAdjunto = $state<TipoAdjunto>('FACTURA');
	let subiendo = $state(false);

	$effect(() => {
		if (!open || !ordenId) return;
		const id = ordenId;
		untrack(() => {
			orden = null;
			plan = null;
			cerrando = false;
			void cargar(id);
		});
	});

	async function cargar(id: string) {
		cargando = !orden;
		try {
			orden = await mantenimientoAPI.orden(id);
			plan =
				orden.plan && !orden.plan.eliminado ? await mantenimientoAPI.plan(orden.plan.id) : null;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo abrir la orden');
			oncerrar();
		} finally {
			cargando = false;
		}
	}

	const abierta = $derived(orden?.estado === 'PROGRAMADO' || orden?.estado === 'EN_CURSO');

	function abrirCierre() {
		if (!orden) return;
		cerrando = true;
		/// La fecha de la orden si ya pasó; si estaba programada a futuro, hoy.
		fechaEjec = orden.fecha && orden.fecha <= hoy ? orden.fecha : hoy;
		kmEjec = String(orden.km ?? orden.vehiculo.km_actual ?? '');
	}

	const entero = (t: string) => {
		const n = Number(String(t).replace(/\./g, '').trim());
		return t.trim() !== '' && Number.isFinite(n) ? Math.round(n) : null;
	};

	/// Vista previa de cómo quedará el plan; el cálculo de verdad es del backend.
	function sumarMeses(iso: string, meses: number) {
		const [y, m, d] = iso.split('-').map(Number);
		const total = y * 12 + (m - 1) + meses;
		const anio = Math.floor(total / 12);
		const mes = total - anio * 12;
		const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
		return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
	}
	const previa = $derived.by(() => {
		if (!plan || !orden || orden.tipo !== 'PREVENTIVO') return null;
		const k = entero(kmEjec);
		const proxKm = plan.periodicidad_km && k != null ? k + plan.periodicidad_km : null;
		const proxFecha =
			plan.periodicidad_meses && fechaEjec ? sumarMeses(fechaEjec, plan.periodicidad_meses) : null;
		const atrasada = !!plan.ultima_ejecucion_fecha && fechaEjec < plan.ultima_ejecucion_fecha;
		return { proxKm, proxFecha, atrasada, faltaKm: !!plan.periodicidad_km && k == null };
	});

	async function cambiar(
		estado: 'EN_CURSO' | 'EJECUTADO' | 'CANCELADO',
		extra: Record<string, unknown> = {}
	) {
		if (!orden || trabajando) return;
		trabajando = true;
		try {
			orden = await mantenimientoAPI.cambiarEstado(orden.id, { estado, ...extra });
			if (orden.plan && !orden.plan.eliminado) plan = await mantenimientoAPI.plan(orden.plan.id);
			cerrando = false;
			toast.success(
				estado === 'EN_CURSO'
					? `OT ${orden.consecutivo} en curso`
					: estado === 'EJECUTADO'
						? `OT ${orden.consecutivo} cerrada${orden.tipo === 'PREVENTIVO' && plan ? '; el plan quedó al día' : ''}`
						: `OT ${orden.consecutivo} anulada`
			);
			oncambio();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el estado');
		} finally {
			trabajando = false;
		}
	}

	async function cerrarOrden() {
		if (!fechaEjec) return toast.error('Indica la fecha en que se hizo');
		if (previa?.faltaKm) return toast.error('El plan cuenta por kilómetros: indica el kilometraje');
		await cambiar('EJECUTADO', { fecha_ejecucion: fechaEjec, km_ejecucion: entero(kmEjec) });
	}

	async function anular() {
		if (!orden) return;
		const motivo = await pedirTexto({
			title: `Anular la OT ${orden.consecutivo}`,
			message: 'Queda en el historial como anulada y no suma al costo. No se puede deshacer.',
			tone: 'danger',
			confirmText: 'Anular',
			label: 'Motivo',
			placeholder: 'Por qué se anula',
			maxLength: 1000
		});
		if (motivo) await cambiar('CANCELADO', { motivo });
	}

	async function iniciar() {
		if (!orden) return;
		const ok = await confirmar({
			title: `Pasar la OT ${orden.consecutivo} a «en curso»`,
			message: 'Indica que el vehículo ya está en el taller.',
			tone: 'info',
			confirmText: 'En curso'
		});
		if (ok) await cambiar('EN_CURSO');
	}

	async function subir(ev: Event) {
		const input = ev.currentTarget as HTMLInputElement;
		const archivo = input.files?.[0];
		input.value = '';
		if (!archivo || !orden) return;
		subiendo = true;
		try {
			/// Las fotos del celular pesan 3–4 MB; comprimidas siguen legibles.
			await mantenimientoAPI.subirAdjunto(orden.id, tipoAdjunto, await comprimirImagen(archivo));
			await cargar(orden.id);
			toast.success(`${TIPO_ADJUNTO[tipoAdjunto]} adjuntada`);
			oncambio();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo subir el archivo');
		} finally {
			subiendo = false;
		}
	}

	async function ver(adjuntoId: string) {
		if (!orden) return;
		/// La ventana se abre ANTES de pedir la URL: después de un `await` el
		/// navegador lo trata como ventana emergente y la bloquea.
		const ventana = window.open('', '_blank');
		try {
			const url = await mantenimientoAPI.urlAdjunto(orden.id, adjuntoId);
			if (ventana) ventana.location.href = url;
			else window.location.href = url;
		} catch (e) {
			ventana?.close();
			toast.error(e instanceof Error ? e.message : 'No se pudo abrir el archivo');
		}
	}

	async function quitar(adjuntoId: string, nombre: string) {
		if (!orden) return;
		if (
			!(await confirmarEliminacion({
				title: `¿Quitar «${nombre}»?`,
				message: 'Deja de verse en la orden.'
			}))
		)
			return;
		try {
			await mantenimientoAPI.eliminarAdjunto(orden.id, adjuntoId);
			await cargar(orden.id);
			oncambio();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo quitar');
		}
	}

	const tamano = (n: number) =>
		n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
</script>

<ModalBase
	{open}
	title={orden ? `OT ${orden.consecutivo} · ${orden.vehiculo.placa}` : 'Orden de trabajo'}
	eyebrow={orden ? `ORDEN ${TIPO_ORDEN[orden.tipo].toUpperCase()}` : 'ORDEN DE TRABAJO'}
	subtitle={orden
		? orden.plan
			? `${orden.plan.nombre}${orden.plan.eliminado ? ' (plan eliminado)' : ''}`
			: [orden.vehiculo.marca, orden.vehiculo.linea].filter(Boolean).join(' ') || null
		: null}
	tamano="lg"
	bloqueado={trabajando || subiendo}
	{oncerrar}
>
	{#if cargando || !orden}
		<CargaMascota texto="Abriendo la orden…" />
	{:else}
		{@const o = orden}
		<div class="do">
			<div class="do-estado">
				<EstadoPunto
					etiqueta={ESTADO_ORDEN[o.estado].etiqueta}
					color={ESTADO_ORDEN[o.estado].color}
					apagado={o.estado === 'CANCELADO'}
				/>
				<span class="do-total">{moneda(o.costo)}</span>
			</div>

			<p class="do-trabajo">{o.descripcion}</p>

			<dl class="do-datos">
				<div>
					<dt>Fecha</dt>
					<dd>{fmtFecha(o.fecha)}</dd>
				</div>
				<div>
					<dt>Kilometraje</dt>
					<dd>{fmtKm(o.km)}</dd>
				</div>
				<div>
					<dt>Taller</dt>
					<dd>{o.taller ?? '—'}</dd>
				</div>
				<div>
					<dt>Responsable</dt>
					<dd>{o.responsable ?? '—'}</dd>
				</div>
				<div>
					<dt>Factura</dt>
					<dd>{o.numero_factura ?? '—'}</dd>
				</div>
				<div>
					<dt>Abierta por</dt>
					<dd>{o.creado_por ?? '—'}</dd>
				</div>
				{#if o.estado === 'EJECUTADO'}
					<div>
						<dt>Se hizo el</dt>
						<dd>{fmtFecha(o.fecha_ejecucion)}</dd>
					</div>
					<div>
						<dt>Con</dt>
						<dd>{fmtKm(o.km_ejecucion)}</dd>
					</div>
					<div>
						<dt>Cerrada por</dt>
						<dd>{o.cerrado_por ?? '—'}</dd>
					</div>
				{/if}
			</dl>

			{#if o.estado === 'CANCELADO'}
				<p class="do-aviso do-aviso--gris">
					Anulada{o.anulado_at ? ` el ${fmtFecha(o.anulado_at)}` : ''}: {o.motivo_anulacion ??
						'sin motivo'}
				</p>
			{/if}
			{#if o.observaciones}<p class="do-obs">{o.observaciones}</p>{/if}

			<section>
				<h3 class="do-titulo">Costos</h3>
				<div class="do-costos">
					{#each o.repuestos as r, i (i)}
						<div class="do-costo">
							<span>{r.cantidad} × {r.descripcion}</span>
							<span>{moneda(r.cantidad * r.valor_unitario)}</span>
						</div>
					{:else}
						<div class="do-costo do-costo--vacio"><span>Sin repuestos</span><span></span></div>
					{/each}
					<div class="do-costo">
						<span>Mano de obra</span><span>{moneda(o.costo_mano_obra)}</span>
					</div>
					<div class="do-costo do-costo--total">
						<span>Total</span><span>{moneda(o.costo)}</span>
					</div>
				</div>
			</section>

			<section>
				<h3 class="do-titulo">Soportes</h3>
				<ul class="do-adjuntos">
					{#each o.adjuntos_detalle as a (a.id)}
						{@const Icono = a.mimetype.startsWith('image/') ? Image : FileText}
						<li>
							<Icono size={16} />
							<span class="do-adj-tipo">{TIPO_ADJUNTO[a.tipo] ?? a.tipo}</span>
							<span class="do-adj-nombre" title={a.nombre}>{a.nombre}</span>
							<small>{tamano(a.size)}</small>
							<button type="button" class="do-btn" title="Ver" onclick={() => ver(a.id)}
								><Eye size={15} /></button
							>
							{#if puedeEscribir && o.estado !== 'CANCELADO'}
								<button
									type="button"
									class="do-btn do-btn--peligro"
									title="Quitar"
									onclick={() => quitar(a.id, a.nombre)}><Trash2 size={15} /></button
								>
							{/if}
						</li>
					{:else}
						<li class="do-adj-vacio"><Paperclip size={15} /> Sin factura ni fotos todavía.</li>
					{/each}
				</ul>
				{#if puedeEscribir && o.estado !== 'CANCELADO'}
					<div class="do-subir">
						<select bind:value={tipoAdjunto} aria-label="Tipo de soporte">
							<option value="FACTURA">Factura</option>
							<option value="FOTO">Foto</option>
							<option value="OTRO">Otro</option>
						</select>
						<label class="do-archivo" class:do-archivo--ocupado={subiendo}>
							<input
								type="file"
								accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
								onchange={subir}
								disabled={subiendo}
							/>
							<Upload size={15} />
							{subiendo ? 'Subiendo…' : 'Adjuntar PDF o imagen'}
						</label>
					</div>
				{/if}
			</section>

			{#if cerrando}
				<section class="do-cierre">
					<h3 class="do-titulo">Cerrar la orden</h3>
					<div class="do-cierre-campos">
						<label>
							<span>Se hizo el</span>
							<input type="date" max={hoy} bind:value={fechaEjec} />
						</label>
						<label>
							<span>Kilometraje</span>
							<input inputmode="numeric" bind:value={kmEjec} />
						</label>
					</div>
					{#if previa}
						<p class="do-aviso {previa.atrasada ? 'do-aviso--ambar' : ''}">
							{#if previa.atrasada}
								El plan ya registra un mantenimiento posterior ({fmtFecha(
									plan?.ultima_ejecucion_fecha
								)}): esta orden se cierra pero no lo mueve.
							{:else}
								El plan «{plan?.nombre}» quedará con el próximo a
								<strong
									>{[
										previa.proxKm ? `${previa.proxKm.toLocaleString('es-CO')} km` : null,
										previa.proxFecha ? fmtFecha(previa.proxFecha) : null
									]
										.filter(Boolean)
										.join(' o ') || '—'}</strong
								>.
							{/if}
						</p>
					{/if}
					<div class="do-cierre-pie">
						<button
							type="button"
							class="btn-secondary"
							onclick={() => (cerrando = false)}
							disabled={trabajando}>Cancelar</button
						>
						<button type="button" class="btn-primary" onclick={cerrarOrden} disabled={trabajando}
							>{trabajando ? 'Cerrando…' : 'Confirmar cierre'}</button
						>
					</div>
				</section>
			{/if}
		</div>
	{/if}

	{#snippet pie()}
		{#if orden && puedeEscribir && !cerrando}
			{#if abierta}
				<button type="button" class="btn-secondary do-anular" onclick={anular} disabled={trabajando}
					>Anular</button
				>
				<button
					type="button"
					class="btn-secondary"
					onclick={() => orden && oneditar(orden)}
					disabled={trabajando}>Editar</button
				>
				{#if orden.estado === 'PROGRAMADO'}
					<button type="button" class="btn-secondary" onclick={iniciar} disabled={trabajando}
						>En curso</button
					>
				{/if}
				<button type="button" class="btn-primary" onclick={abrirCierre} disabled={trabajando}
					>Cerrar orden</button
				>
			{:else if orden.estado === 'EJECUTADO'}
				<button type="button" class="btn-secondary" onclick={() => orden && oneditar(orden)}
					>Corregir costos o factura</button
				>
			{/if}
		{/if}
	{/snippet}
</ModalBase>

<style>
	.do {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.do-estado {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.do-total {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.do-trabajo {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text-primary);
		white-space: pre-line;
		max-width: 44rem;
	}
	.do-datos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 10px 16px;
		margin: 0;
	}
	.do-datos dt {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.do-datos dd {
		margin: 2px 0 0;
		font-size: 0.86rem;
		color: var(--text-primary);
	}
	.do-obs {
		margin: 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--bg-base);
		font-size: 0.84rem;
		color: var(--text-secondary);
		white-space: pre-line;
	}
	.do-titulo {
		margin: 0 0 8px;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.do-costos {
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		overflow: hidden;
	}
	.do-costo {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 12px;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.do-costo + .do-costo {
		border-top: 1px solid var(--border-subtle);
	}
	.do-costo span:last-child {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.do-costo--vacio {
		color: var(--text-muted);
		font-style: italic;
	}
	.do-costo--total {
		background: var(--bg-base);
		font-weight: 800;
		color: var(--text-primary);
	}
	.do-adjuntos {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0 0 8px;
		padding: 0;
		list-style: none;
	}
	.do-adjuntos li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		border-radius: 10px;
		font-size: 0.84rem;
		color: var(--text-secondary);
	}
	.do-adjuntos li:hover {
		background: var(--bg-base);
	}
	.do-adj-tipo {
		flex-shrink: 0;
		font-weight: 700;
		color: var(--text-primary);
	}
	.do-adj-nombre {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.do-adj-vacio {
		color: var(--text-muted);
	}
	.do-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.do-btn:hover {
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.do-btn--peligro:hover {
		background: #fef2f2;
		color: #b91c1c;
	}
	.do-subir {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.do-subir select {
		padding: 0.45rem 0.6rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.84rem;
	}
	.do-archivo {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex: 1 1 14rem;
		padding: 0.5rem 0.75rem;
		border: 1.5px dashed var(--border-default);
		border-radius: 10px;
		font-size: 0.84rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.do-archivo:hover {
		border-color: var(--accion);
		color: var(--accion);
	}
	.do-archivo--ocupado {
		opacity: 0.6;
	}
	.do-archivo input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.do-cierre {
		padding: 12px;
		border: 1.5px solid var(--accion);
		border-radius: 14px;
	}
	.do-cierre-campos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 10px;
	}
	.do-cierre-campos label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.do-cierre-campos span {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.do-cierre-campos input {
		padding: 0.5rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.88rem;
	}
	.do-cierre-pie {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 10px;
	}
	.do-aviso {
		margin: 10px 0 0;
		padding: 8px 10px;
		border-radius: 10px;
		background: #f0fdf4;
		font-size: 0.82rem;
		color: #166534;
	}
	.do-aviso--ambar {
		background: #fffbeb;
		color: #92400e;
	}
	.do-aviso--gris {
		margin: 0;
		background: var(--bg-base);
		color: var(--text-secondary);
	}
	.do-anular {
		margin-right: auto;
		color: #b91c1c;
	}
</style>
