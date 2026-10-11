<script lang="ts">
	/**
	 * Pestaña «Documentos» de la ficha del vehículo: su hoja de vida documental.
	 *
	 * Tres bloques:
	 *  - Vigencias (SOAT, tecnomecánica, TO, pólizas, preventiva, GPS): siempre
	 *    se listan los ocho, con semáforo, porque lo que falta también es dato.
	 *  - Legales y Operación: solo lo cargado, y un «Agregar» con el resto.
	 *
	 * Cada documento muestra su versión actual; las anteriores van en el
	 * historial. Subir una versión nueva reemplaza la actual (el backend la
	 * pasa a historial). Los que llegaron sin fecha del folder de OneDrive
	 * piden completarla aquí mismo.
	 */
	import {
		ChevronDown,
		CircleCheck,
		CircleAlert,
		CircleX,
		CircleDashed,
		CircleMinus,
		Clock,
		Eye,
		History,
		Plus,
		Trash2,
		Upload
	} from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import {
		vehiculosDocumentosAPI,
		type CategoriaDocumentos,
		type DocumentoVehiculo,
		type DocumentosVehiculoRespuesta,
		type EstadoVigencia
	} from '$lib/api/vehiculosDocumentos';

	interface Props {
		vehiculoId: string;
		/** `flota` en full: subir, corregir y borrar. */
		puedeEditar?: boolean;
		onver: (doc: DocumentoVehiculo, titulo: string) => void;
	}
	let { vehiculoId, puedeEditar = false, onver }: Props = $props();

	let datos = $state<DocumentosVehiculoRespuesta | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	/// Fila con el formulario de subida abierto, y la que muestra su historial.
	let subiendo = $state<string | null>(null);
	let historialAbierto = $state<string | null>(null);
	let agregando = $state('');

	// Formulario de subida (uno a la vez).
	let archivo = $state<File | null>(null);
	let fechaVence = $state('');
	let noAplica = $state(false);
	let guardando = $state(false);

	// Completar fecha de un documento sin fecha.
	let fechaEditando = $state<string | null>(null);
	let fechaNueva = $state('');

	async function cargar() {
		cargando = !datos;
		error = null;
		try {
			datos = await vehiculosDocumentosAPI.listar(vehiculoId);
		} catch (e: any) {
			error = e?.response?.data?.message ?? 'No se pudieron cargar los documentos.';
		} finally {
			cargando = false;
		}
	}

	/// Solo depende del vehículo: `cargar()` lee `datos`, y sin `untrack` cada
	/// respuesta volvía a disparar la carga (la pestaña nunca salía de «Cargando»).
	$effect(() => {
		void vehiculoId;
		untrack(() => {
			datos = null;
			void cargar();
		});
	});

	const vigencias = $derived(datos?.categorias.filter((c) => c.grupo === 'vigencias') ?? []);
	const otrosCargados = (grupo: 'legales' | 'operacion') =>
		datos?.categorias.filter((c) => c.grupo === grupo && c.actual) ?? [];
	const porAgregar = $derived(
		datos?.categorias.filter((c) => c.grupo !== 'vigencias' && !c.actual) ?? []
	);

	// ── Presentación del estado ──
	const ESTADO: Record<
		EstadoVigencia,
		{ etiqueta: string; tono: 'ok' | 'aviso' | 'mal' | 'neutro'; icono: typeof CircleCheck }
	> = {
		vigente: { etiqueta: 'Vigente', tono: 'ok', icono: CircleCheck },
		por_vencer: { etiqueta: 'Por vencer', tono: 'aviso', icono: Clock },
		vencido: { etiqueta: 'Vencido', tono: 'mal', icono: CircleX },
		sin_fecha: { etiqueta: 'Sin fecha', tono: 'aviso', icono: CircleAlert },
		no_aplica: { etiqueta: 'No aplica aún', tono: 'neutro', icono: CircleMinus },
		faltante: { etiqueta: 'Falta', tono: 'mal', icono: CircleDashed },
		cargado: { etiqueta: 'Cargado', tono: 'ok', icono: CircleCheck }
	};

	const fmtFecha = (iso: string) =>
		new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(
			new Date(`${iso}T12:00:00`)
		);

	function detalle(c: CategoriaDocumentos): string {
		const v = c.actual?.fecha_vencimiento;
		switch (c.estado) {
			case 'vencido':
				return `Venció el ${fmtFecha(v!)} · hace ${Math.abs(c.dias!)} ${Math.abs(c.dias!) === 1 ? 'día' : 'días'}`;
			case 'por_vencer':
				return c.dias === 0
					? `Vence hoy`
					: `Vence el ${fmtFecha(v!)} · en ${c.dias} ${c.dias === 1 ? 'día' : 'días'}`;
			case 'vigente':
				return `Vence el ${fmtFecha(v!)}`;
			case 'sin_fecha':
				return 'Falta la fecha de vencimiento';
			case 'no_aplica':
				return 'El vehículo todavía no está obligado';
			case 'faltante':
				return 'No se ha cargado';
			default:
				return c.actual?.nombre ?? '';
		}
	}

	/// Fecha sugerida: la actual más el ciclo de la categoría (un SOAT de
	/// 2026-06-16 sugiere 2027-06-16). Solo sugiere; se puede cambiar.
	function sugerirVencimiento(c: CategoriaDocumentos): string {
		const base = c.actual?.fecha_vencimiento;
		if (!base || !c.cicloMeses) return '';
		const d = new Date(`${base}T12:00:00`);
		d.setMonth(d.getMonth() + c.cicloMeses);
		return d.toISOString().slice(0, 10);
	}

	function abrirSubida(c: CategoriaDocumentos) {
		subiendo = subiendo === c.clave ? null : c.clave;
		archivo = null;
		noAplica = false;
		fechaVence = sugerirVencimiento(c);
	}

	async function guardar(c: CategoriaDocumentos) {
		if (!noAplica && !archivo) return toast.error('Elige el archivo');
		if (c.vence && !noAplica && !fechaVence) return toast.error('Indica la fecha de vencimiento');
		guardando = true;
		try {
			await vehiculosDocumentosAPI.subir(vehiculoId, {
				categoria: c.clave,
				archivo,
				fecha_vencimiento: c.vence && !noAplica ? fechaVence : null,
				no_aplica: noAplica
			});
			toast.success(`${c.etiqueta} actualizado`);
			subiendo = null;
			agregando = '';
			await cargar();
		} catch (e: any) {
			toast.error(e?.response?.data?.message ?? 'No se pudo subir el documento');
		} finally {
			guardando = false;
		}
	}

	async function guardarFecha(doc: DocumentoVehiculo) {
		if (!fechaNueva) return;
		try {
			await vehiculosDocumentosAPI.actualizar(vehiculoId, doc.id, {
				fecha_vencimiento: fechaNueva
			});
			fechaEditando = null;
			await cargar();
		} catch (e: any) {
			toast.error(e?.response?.data?.message ?? 'No se pudo guardar la fecha');
		}
	}

	async function eliminar(c: CategoriaDocumentos, doc: DocumentoVehiculo) {
		const ok = await confirmarEliminacion({
			title: `¿Eliminar esta versión de ${c.etiqueta}?`,
			message:
				doc.id === c.actual?.id
					? 'Si había una versión anterior, vuelve a quedar como la actual.'
					: 'Se quita del historial del vehículo.'
		});
		if (!ok) return;
		try {
			await vehiculosDocumentosAPI.eliminar(vehiculoId, doc.id);
			await cargar();
		} catch (e: any) {
			toast.error(e?.response?.data?.message ?? 'No se pudo eliminar');
		}
	}

	const tamano = (n: number) =>
		n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
</script>

{#snippet fila(c: CategoriaDocumentos)}
	{@const e = ESTADO[c.estado]}
	{@const Icono = e.icono}
	<li class="dv-fila dv-fila--{e.tono}">
		<div class="dv-principal">
			<span class="dv-icono" aria-hidden="true"><Icono size={18} /></span>
			<div class="dv-texto">
				<strong>{c.etiqueta}</strong>
				<span class="dv-detalle">{detalle(c)}</span>
			</div>
			<span class="dv-estado">{e.etiqueta}</span>
			<div class="dv-acciones">
				{#if c.actual?.tiene_archivo}
					<button
						type="button"
						class="dv-btn"
						title="Ver documento"
						onclick={() => onver(c.actual!, c.etiqueta)}
					>
						<Eye size={16} />
					</button>
				{/if}
				{#if c.historial.length}
					<button
						type="button"
						class="dv-btn"
						class:dv-btn--activo={historialAbierto === c.clave}
						title="Versiones anteriores"
						onclick={() => (historialAbierto = historialAbierto === c.clave ? null : c.clave)}
					>
						<History size={16} /><small>{c.historial.length}</small>
					</button>
				{/if}
				{#if puedeEditar}
					<button
						type="button"
						class="dv-btn dv-btn--subir"
						class:dv-btn--activo={subiendo === c.clave}
						title={c.actual ? 'Subir versión nueva' : 'Subir documento'}
						onclick={() => abrirSubida(c)}
					>
						<Upload size={16} />
					</button>
				{/if}
			</div>
		</div>

		{#if c.estado === 'sin_fecha' && puedeEditar && c.actual}
			{@const doc = c.actual}
			{#if fechaEditando === doc.id}
				<div class="dv-form dv-form--linea">
					<label>
						<span>Vence el</span>
						<input type="date" bind:value={fechaNueva} />
					</label>
					<button
						type="button"
						class="btn-primary"
						onclick={() => guardarFecha(doc)}
						disabled={!fechaNueva}>Guardar</button
					>
					<button type="button" class="btn-secondary" onclick={() => (fechaEditando = null)}
						>Cancelar</button
					>
				</div>
			{:else}
				<button
					type="button"
					class="dv-completar"
					onclick={() => {
						fechaEditando = doc.id;
						fechaNueva = '';
					}}>Completar la fecha de vencimiento</button
				>
			{/if}
		{/if}

		{#if subiendo === c.clave}
			<div class="dv-form">
				<label class="dv-archivo" class:dv-archivo--lleno={!!archivo}>
					<input
						type="file"
						accept="application/pdf,image/png,image/jpeg,image/webp"
						disabled={noAplica}
						onchange={(ev) => (archivo = (ev.currentTarget as HTMLInputElement).files?.[0] ?? null)}
					/>
					<Upload size={16} />
					<span
						>{archivo ? `${archivo.name} · ${tamano(archivo.size)}` : 'Elegir PDF o imagen'}</span
					>
				</label>
				{#if c.vence}
					<label class="dv-campo">
						<span>Vence el</span>
						<input type="date" bind:value={fechaVence} disabled={noAplica} />
					</label>
				{/if}
				{#if c.puedeNoAplicar}
					<label class="dv-check">
						<input type="checkbox" bind:checked={noAplica} />
						Aún no le aplica (vehículo nuevo); el archivo es opcional
					</label>
				{/if}
				<div class="dv-form-pie">
					<button
						type="button"
						class="btn-secondary"
						onclick={() => (subiendo = null)}
						disabled={guardando}>Cancelar</button
					>
					<button type="button" class="btn-primary" onclick={() => guardar(c)} disabled={guardando}>
						{guardando ? 'Subiendo…' : 'Guardar'}
					</button>
				</div>
			</div>
		{/if}

		{#if historialAbierto === c.clave}
			<ol class="dv-historial">
				{#each c.historial as h (h.id)}
					<li>
						<span class="dv-hist-fecha">
							{h.estado === 'no_aplica'
								? 'No aplicaba'
								: h.fecha_vencimiento
									? `Vencía ${fmtFecha(h.fecha_vencimiento)}`
									: 'Sin fecha'}
						</span>
						<span class="dv-hist-nombre" title={h.nombre}>{h.nombre}</span>
						{#if h.tiene_archivo}
							<button type="button" class="dv-btn" title="Ver" onclick={() => onver(h, c.etiqueta)}>
								<Eye size={15} />
							</button>
						{/if}
						{#if puedeEditar}
							<button
								type="button"
								class="dv-btn dv-btn--peligro"
								title="Eliminar"
								onclick={() => eliminar(c, h)}
							>
								<Trash2 size={15} />
							</button>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</li>
{/snippet}

{#if cargando}
	<CargaMascota texto="Cargando documentos…" />
{:else if error}
	<div class="dv-error">
		<p>{error}</p>
		<button type="button" class="btn-secondary" onclick={cargar}>Reintentar</button>
	</div>
{:else if datos}
	{@const r = datos.resumen}
	<div class="dv">
		<ResumenConteos
			conteos={[
				{ clave: 'al_dia', etiqueta: 'Al día', valor: `${r.al_dia}/${r.total}`, color: '#16a34a' },
				...(r.por_vencer
					? [{ clave: 'por_vencer', etiqueta: 'Por vencer', valor: r.por_vencer, color: '#d97706' }]
					: []),
				...(r.vencidos
					? [{ clave: 'vencidos', etiqueta: 'Vencidos', valor: r.vencidos, color: '#dc2626' }]
					: []),
				...(r.faltantes
					? [{ clave: 'faltantes', etiqueta: 'Faltan', valor: r.faltantes, color: '#94a3b8' }]
					: [])
			]}
		/>

		<section>
			<h3 class="dv-titulo">Vigencias</h3>
			<ul class="dv-lista">
				{#each vigencias as c (c.clave)}{@render fila(c)}{/each}
			</ul>
		</section>

		{#each [{ g: 'legales', t: 'Documentos legales' }, { g: 'operacion', t: 'Operación' }] as b (b.g)}
			{@const lista = otrosCargados(b.g as 'legales' | 'operacion')}
			{#if lista.length}
				<section>
					<h3 class="dv-titulo">{b.t}</h3>
					<ul class="dv-lista">
						{#each lista as c (c.clave)}{@render fila(c)}{/each}
					</ul>
				</section>
			{/if}
		{/each}

		{#if puedeEditar && porAgregar.length}
			<section class="dv-agregar">
				<label>
					<Plus size={15} />
					<select
						bind:value={agregando}
						onchange={() => {
							const c = porAgregar.find((x) => x.clave === agregando);
							if (c && subiendo !== c.clave) abrirSubida(c);
						}}
					>
						<option value="">Agregar otro documento…</option>
						{#each porAgregar as c (c.clave)}<option value={c.clave}>{c.etiqueta}</option>{/each}
					</select>
				</label>
				{#if agregando}
					{@const c = porAgregar.find((x) => x.clave === agregando)}
					{#if c}
						<ul class="dv-lista">
							{@render fila(c)}
						</ul>
					{/if}
				{/if}
			</section>
		{/if}
	</div>
{/if}

<style>
	.dv {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.dv-titulo {
		margin: 0 0 8px;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.dv-lista {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		overflow: hidden;
		background: var(--bg-surface);
	}
	.dv-fila + .dv-fila {
		border-top: 1px solid var(--border-subtle);
	}
	.dv-fila {
		--tono: #64748b;
	}
	.dv-fila--ok {
		--tono: #16a34a;
	}
	.dv-fila--aviso {
		--tono: #d97706;
	}
	.dv-fila--mal {
		--tono: #dc2626;
	}
	.dv-principal {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
	}
	.dv-icono {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--tono);
	}
	.dv-texto {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.dv-texto strong {
		font-size: 0.86rem;
		color: var(--text-primary);
	}
	.dv-detalle {
		font-size: 0.76rem;
		color: var(--text-muted);
	}
	.dv-fila--mal .dv-detalle {
		color: #b91c1c;
	}
	.dv-estado {
		flex-shrink: 0;
		padding: 2px 9px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--tono) 12%, transparent);
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--tono);
		white-space: nowrap;
	}
	.dv-acciones {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}
	.dv-btn {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 32px;
		min-width: 32px;
		justify-content: center;
		padding: 0 6px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.dv-btn small {
		font-size: 0.7rem;
		font-weight: 700;
	}
	.dv-btn:hover,
	.dv-btn--activo {
		background: var(--bg-base);
		color: var(--text-primary);
	}
	.dv-btn--subir:hover {
		color: var(--accion);
	}
	.dv-btn--peligro:hover {
		background: #fef2f2;
		color: #b91c1c;
	}
	.dv-completar {
		margin: -4px 12px 10px 40px;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--accion);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	/* ── Formularios en línea ── */
	.dv-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 10px;
		margin: 0 12px 12px 40px;
		padding: 12px;
		border-radius: 12px;
		background: var(--bg-base);
	}
	.dv-form--linea {
		align-items: center;
	}
	.dv-form label > span,
	.dv-campo span {
		display: block;
		margin-bottom: 3px;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.dv-form input[type='date'] {
		padding: 0.45rem 0.6rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.84rem;
		color: var(--text-primary);
	}
	.dv-archivo {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1 1 14rem;
		min-width: 0;
		padding: 0.55rem 0.75rem;
		border: 1.5px dashed var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-size: 0.82rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.dv-archivo span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dv-archivo--lleno {
		border-style: solid;
		border-color: var(--accion);
		color: var(--text-primary);
	}
	.dv-archivo input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.dv-check {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-basis: 100%;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.dv-check input {
		width: 16px;
		height: 16px;
		accent-color: var(--accion);
	}
	.dv-form-pie {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		flex-basis: 100%;
	}

	/* ── Historial ── */
	.dv-historial {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0 12px 12px 40px;
		padding: 6px;
		list-style: none;
		border-radius: 12px;
		background: var(--bg-base);
	}
	.dv-historial li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 2px 4px;
		font-size: 0.78rem;
	}
	.dv-hist-fecha {
		flex-shrink: 0;
		width: 9.5rem;
		font-weight: 700;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.dv-hist-nombre {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-muted);
	}

	.dv-agregar label {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		color: var(--text-muted);
	}
	.dv-agregar select {
		flex: 1;
		padding: 0.5rem 0.65rem;
		border: 1.5px dashed var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.84rem;
		color: var(--text-secondary);
	}
	.dv-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 2rem 1rem;
		text-align: center;
		color: var(--text-secondary);
	}

	@media (max-width: 560px) {
		.dv-estado {
			display: none;
		}
		.dv-form,
		.dv-historial {
			margin-left: 12px;
		}
	}
</style>
