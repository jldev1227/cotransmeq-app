<script lang="ts">
	/**
	 * Pestaña «Documentos» de la ficha del conductor: su hoja de vida documental
	 * (PESV y Decreto 1079). Gemela de `DocumentosVehiculo`.
	 *
	 * Tres bloques:
	 *  - Vigencias (licencia, exámenes, cursos, seguridad social, SIMIT,
	 *    antecedentes): siempre se listan todas, con semáforo, porque lo que
	 *    falta también es dato.
	 *  - Identificación y Laboral: lo requerido siempre (cédula, contrato, hoja
	 *    de vida); el resto solo si está cargado, y un «Agregar» con lo demás.
	 *
	 * La licencia muestra su vigencia aunque no haya archivo: la fecha sale de
	 * la ficha del conductor (la que usa el FUEC), y subirla aquí la actualiza.
	 *
	 * Abre su propio visor: a diferencia del vehículo, esta pestaña no vive
	 * dentro de un modal y no hay a quién delegarlo.
	 */
	import {
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
	import VisorDocumentoConductor from './VisorDocumentoConductor.svelte';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import { authStore } from '$lib/stores/auth';
	import { comprimirImagen } from '$lib/api/viaticos';
	import {
		CATEGORIAS_LICENCIA,
		conductoresDocumentosAPI,
		type CategoriaDocumentosConductor,
		type DocumentoConductor,
		type DocumentosConductorRespuesta,
		type EstadoVigencia
	} from '$lib/api/conductoresDocumentos';

	interface Props {
		conductorId: string;
		/** `conductores` en full: subir, corregir y borrar. Si no llega, se calcula de la sesión. */
		puedeEditar?: boolean;
		/** Avisa al padre cuando cambia algo (p. ej. la licencia, que también está en la ficha). */
		oncambio?: () => void;
	}
	let { conductorId, puedeEditar, oncambio }: Props = $props();

	/// El backend aplica lo mismo en las rutas de escritura; esto solo evita
	/// ofrecer un botón que iba a devolver 403.
	const editable = $derived(
		puedeEditar ?? (!!$authStore.user && authStore.getAccessLevel('conductores') === 'full')
	);

	let datos = $state<DocumentosConductorRespuesta | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	/// Fila con el formulario de subida abierto, y la que muestra su historial.
	let subiendo = $state<string | null>(null);
	let historialAbierto = $state<string | null>(null);
	let agregando = $state('');

	// Formulario de subida (uno a la vez).
	let archivo = $state<File | null>(null);
	let fechaVence = $state('');
	let categoriaLicencia = $state('');
	let noAplica = $state(false);
	let guardando = $state(false);

	// Completar fecha de un documento sin fecha.
	let fechaEditando = $state<string | null>(null);
	let fechaNueva = $state('');

	// Visor.
	let viendo = $state<{ doc: DocumentoConductor; titulo: string } | null>(null);

	async function cargar() {
		cargando = !datos;
		error = null;
		try {
			datos = await conductoresDocumentosAPI.listar(conductorId);
		} catch (e: any) {
			error = e?.response?.data?.message ?? 'No se pudieron cargar los documentos.';
		} finally {
			cargando = false;
		}
	}

	/// Solo depende del conductor: `cargar()` lee `datos`, y sin `untrack` cada
	/// respuesta volvía a disparar la carga (la pestaña nunca salía de «Cargando»).
	$effect(() => {
		void conductorId;
		untrack(() => {
			datos = null;
			subiendo = null;
			historialAbierto = null;
			void cargar();
		});
	});

	const vigencias = $derived(datos?.categorias.filter((c) => c.grupo === 'vigencias') ?? []);
	const visibles = (grupo: 'identificacion' | 'laboral') =>
		datos?.categorias.filter((c) => c.grupo === grupo && (c.actual || c.requerido)) ?? [];
	const porAgregar = $derived(
		datos?.categorias.filter((c) => c.grupo !== 'vigencias' && !c.actual && !c.requerido) ?? []
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
		no_aplica: { etiqueta: 'No aplica', tono: 'neutro', icono: CircleMinus },
		faltante: { etiqueta: 'Falta', tono: 'mal', icono: CircleDashed },
		cargado: { etiqueta: 'Cargado', tono: 'ok', icono: CircleCheck }
	};

	const fmtFecha = (iso: string) =>
		new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(
			new Date(`${iso}T12:00:00`)
		);
	const enDias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

	function detalle(c: CategoriaDocumentosConductor): string {
		const v = c.vencimiento;
		/// Una consulta (SIMIT, antecedentes) no vence: toca repetirla.
		const consulta = !!c.etiquetaFecha;
		const base = (() => {
			switch (c.estado) {
				case 'vencido':
					return consulta
						? `Tocaba actualizarla el ${fmtFecha(v!)} · hace ${enDias(Math.abs(c.dias!))}`
						: `Venció el ${fmtFecha(v!)} · hace ${enDias(Math.abs(c.dias!))}`;
				case 'por_vencer':
					if (c.dias === 0) return consulta ? 'Toca actualizarla hoy' : 'Vence hoy';
					return consulta
						? `Toca actualizarla el ${fmtFecha(v!)} · en ${enDias(c.dias!)}`
						: `Vence el ${fmtFecha(v!)} · en ${enDias(c.dias!)}`;
				case 'vigente':
					return consulta ? `Próxima: ${fmtFecha(v!)}` : `Vence el ${fmtFecha(v!)}`;
				case 'sin_fecha':
					return consulta
						? 'Falta la fecha de la próxima consulta'
						: 'Falta la fecha de vencimiento';
				case 'no_aplica':
					return 'No le aplica a este conductor';
				case 'faltante':
					return 'No se ha cargado';
				default:
					return c.actual?.nombre ?? '';
			}
		})();
		const categoria = c.pideCategoriaLicencia
			? (c.categoria_licencia ?? c.actual?.categoria_licencia)
			: null;
		/// La vigencia de la licencia puede venir de la ficha sin soporte: se dice.
		const sinSoporte = !!c.vencimiento && !c.actual?.tiene_archivo;
		return [
			categoria ? `Categoría ${categoria}` : null,
			base,
			sinSoporte ? 'falta el soporte' : null
		]
			.filter(Boolean)
			.join(' · ');
	}

	/// Fecha sugerida: la actual más el ciclo de la categoría (un examen de
	/// 2026-06-16 sugiere 2027-06-16). Solo sugiere; se puede cambiar.
	function sugerirVencimiento(c: CategoriaDocumentosConductor): string {
		const base = c.vencimiento;
		if (!base || !c.cicloMeses) return '';
		const d = new Date(`${base}T12:00:00`);
		d.setMonth(d.getMonth() + c.cicloMeses);
		return d.toISOString().slice(0, 10);
	}

	function abrirSubida(c: CategoriaDocumentosConductor) {
		subiendo = subiendo === c.clave ? null : c.clave;
		archivo = null;
		noAplica = false;
		fechaVence = sugerirVencimiento(c);
		categoriaLicencia = c.categoria_licencia ?? c.actual?.categoria_licencia ?? '';
	}

	async function guardar(c: CategoriaDocumentosConductor) {
		if (!noAplica && !archivo) return toast.error('Elige el archivo');
		if (c.vence && !noAplica && !fechaVence)
			return toast.error(`Indica la fecha: ${(c.etiquetaFecha ?? 'vence el').toLowerCase()}`);
		guardando = true;
		try {
			/// Una foto de celular pasa de 3 MB a unos cientos de KB; los PDF los
			/// comprime el backend cuando tiene Ghostscript.
			const aSubir = archivo ? await comprimirImagen(archivo) : null;
			await conductoresDocumentosAPI.subir(conductorId, {
				categoria: c.clave,
				archivo: aSubir,
				fecha_vencimiento: c.vence && !noAplica ? fechaVence : null,
				categoria_licencia: c.pideCategoriaLicencia ? categoriaLicencia || null : null,
				no_aplica: noAplica
			});
			toast.success(`${c.etiqueta}: actualizado`);
			subiendo = null;
			agregando = '';
			await cargar();
			if (c.pideCategoriaLicencia) oncambio?.();
		} catch (e: any) {
			toast.error(e?.response?.data?.message ?? 'No se pudo subir el documento');
		} finally {
			guardando = false;
		}
	}

	async function guardarFecha(c: CategoriaDocumentosConductor, doc: DocumentoConductor) {
		if (!fechaNueva) return;
		try {
			await conductoresDocumentosAPI.actualizar(conductorId, doc.id, {
				fecha_vencimiento: fechaNueva
			});
			fechaEditando = null;
			await cargar();
			if (c.pideCategoriaLicencia) oncambio?.();
		} catch (e: any) {
			toast.error(e?.response?.data?.message ?? 'No se pudo guardar la fecha');
		}
	}

	async function eliminar(c: CategoriaDocumentosConductor, doc: DocumentoConductor) {
		const ok = await confirmarEliminacion({
			title: `¿Eliminar esta versión de ${c.etiqueta}?`,
			message:
				doc.id === c.actual?.id
					? 'Si había una versión anterior, vuelve a quedar como la actual.'
					: 'Se quita del historial del conductor.'
		});
		if (!ok) return;
		try {
			await conductoresDocumentosAPI.eliminar(conductorId, doc.id);
			await cargar();
			if (c.pideCategoriaLicencia) oncambio?.();
		} catch (e: any) {
			toast.error(e?.response?.data?.message ?? 'No se pudo eliminar');
		}
	}

	const tamano = (n: number) =>
		n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
</script>

{#snippet fila(c: CategoriaDocumentosConductor)}
	{@const e = ESTADO[c.estado]}
	{@const Icono = e.icono}
	<li class="dc-fila dc-fila--{e.tono}">
		<div class="dc-principal">
			<span class="dc-icono" aria-hidden="true"><Icono size={18} /></span>
			<div class="dc-texto">
				<strong>{c.etiqueta}</strong>
				<span class="dc-detalle">{detalle(c)}</span>
			</div>
			<span class="dc-estado">{e.etiqueta}</span>
			<div class="dc-acciones">
				{#if c.actual?.tiene_archivo}
					<button
						type="button"
						class="dc-btn"
						title="Ver documento"
						onclick={() => (viendo = { doc: c.actual!, titulo: c.etiqueta })}
					>
						<Eye size={16} />
					</button>
				{/if}
				{#if c.historial.length}
					<button
						type="button"
						class="dc-btn"
						class:dc-btn--activo={historialAbierto === c.clave}
						title="Versiones anteriores"
						onclick={() => (historialAbierto = historialAbierto === c.clave ? null : c.clave)}
					>
						<History size={16} /><small>{c.historial.length}</small>
					</button>
				{/if}
				{#if editable}
					<button
						type="button"
						class="dc-btn dc-btn--subir"
						class:dc-btn--activo={subiendo === c.clave}
						title={c.actual ? 'Subir versión nueva' : 'Subir documento'}
						onclick={() => abrirSubida(c)}
					>
						<Upload size={16} />
					</button>
					{#if c.actual}
						{@const actual = c.actual}
						<!-- El del vehículo solo borraba versiones del historial; aquí también la
						     actual (un examen subido al conductor equivocado). -->
						<button
							type="button"
							class="dc-btn dc-btn--peligro"
							title="Eliminar la versión actual"
							onclick={() => eliminar(c, actual)}
						>
							<Trash2 size={16} />
						</button>
					{/if}
				{/if}
			</div>
		</div>

		{#if c.estado === 'sin_fecha' && editable && c.actual}
			{@const doc = c.actual}
			{#if fechaEditando === doc.id}
				<div class="dc-form dc-form--linea">
					<label>
						<span>{c.etiquetaFecha ?? 'Vence el'}</span>
						<input type="date" bind:value={fechaNueva} />
					</label>
					<button
						type="button"
						class="btn-primary"
						onclick={() => guardarFecha(c, doc)}
						disabled={!fechaNueva}>Guardar</button
					>
					<button type="button" class="btn-secondary" onclick={() => (fechaEditando = null)}
						>Cancelar</button
					>
				</div>
			{:else}
				<button
					type="button"
					class="dc-completar"
					onclick={() => {
						fechaEditando = doc.id;
						fechaNueva = '';
					}}>Completar la fecha</button
				>
			{/if}
		{/if}

		{#if subiendo === c.clave}
			<div class="dc-form">
				<label class="dc-archivo" class:dc-archivo--lleno={!!archivo}>
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
					<label class="dc-campo">
						<span>{c.etiquetaFecha ?? 'Vence el'}</span>
						<input type="date" bind:value={fechaVence} disabled={noAplica} />
					</label>
				{/if}
				{#if c.pideCategoriaLicencia}
					<label class="dc-campo">
						<span>Categoría</span>
						<select bind:value={categoriaLicencia}>
							<option value="">Sin cambio</option>
							{#each CATEGORIAS_LICENCIA as cl (cl)}<option value={cl}>{cl}</option>{/each}
						</select>
					</label>
				{/if}
				{#if c.puedeNoAplicar}
					<label class="dc-check">
						<input type="checkbox" bind:checked={noAplica} />
						No le aplica a este conductor; el archivo es opcional
					</label>
				{/if}
				{#if c.pideCategoriaLicencia}
					<p class="dc-nota">La fecha y la categoría se copian a la ficha del conductor (FUEC).</p>
				{/if}
				<div class="dc-form-pie">
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
			<ol class="dc-historial">
				{#each c.historial as h (h.id)}
					<li>
						<span class="dc-hist-fecha">
							{h.estado === 'no_aplica'
								? 'No aplicaba'
								: h.fecha_vencimiento
									? `${c.etiquetaFecha ? 'Hasta' : 'Vencía'} ${fmtFecha(h.fecha_vencimiento)}`
									: `Subido ${fmtFecha(h.creado.slice(0, 10))}`}
						</span>
						<span class="dc-hist-nombre" title={h.nombre}>{h.nombre}</span>
						{#if h.tiene_archivo}
							<button
								type="button"
								class="dc-btn"
								title="Ver"
								onclick={() => (viendo = { doc: h, titulo: c.etiqueta })}
							>
								<Eye size={15} />
							</button>
						{/if}
						{#if editable}
							<button
								type="button"
								class="dc-btn dc-btn--peligro"
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
	<div class="dc-error">
		<p>{error}</p>
		<button type="button" class="btn-secondary" onclick={cargar}>Reintentar</button>
	</div>
{:else if datos}
	{@const r = datos.resumen}
	<div class="dc">
		<ResumenConteos
			conteos={[
				{ clave: 'al_dia', etiqueta: 'Al día', valor: `${r.al_dia}/${r.total}`, color: '#16a34a' },
				...(r.por_vencer
					? [{ clave: 'por_vencer', etiqueta: 'Por vencer', valor: r.por_vencer, color: '#d97706' }]
					: []),
				...(r.vencidos
					? [{ clave: 'vencidos', etiqueta: 'Vencidos', valor: r.vencidos, color: '#dc2626' }]
					: []),
				...(r.sin_fecha
					? [{ clave: 'sin_fecha', etiqueta: 'Sin fecha', valor: r.sin_fecha, color: '#d97706' }]
					: []),
				...(r.faltantes
					? [{ clave: 'faltantes', etiqueta: 'Faltan', valor: r.faltantes, color: '#94a3b8' }]
					: [])
			]}
		/>

		<section>
			<h3 class="dc-titulo">Vigencias</h3>
			<ul class="dc-lista">
				{#each vigencias as c (c.clave)}{@render fila(c)}{/each}
			</ul>
		</section>

		{#each [{ g: 'identificacion', t: 'Identificación' }, { g: 'laboral', t: 'Laboral' }] as b (b.g)}
			{@const lista = visibles(b.g as 'identificacion' | 'laboral')}
			{#if lista.length}
				<section>
					<h3 class="dc-titulo">{b.t}</h3>
					<ul class="dc-lista">
						{#each lista as c (c.clave)}{@render fila(c)}{/each}
					</ul>
				</section>
			{/if}
		{/each}

		{#if editable && porAgregar.length}
			<section class="dc-agregar">
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
						<ul class="dc-lista">
							{@render fila(c)}
						</ul>
					{/if}
				{/if}
			</section>
		{/if}
	</div>
{/if}

<VisorDocumentoConductor
	{conductorId}
	doc={viendo?.doc ?? null}
	titulo={viendo?.titulo ?? ''}
	oncerrar={() => (viendo = null)}
/>

<style>
	.dc {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.dc-titulo {
		margin: 0 0 8px;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.dc-lista {
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
	.dc-fila + .dc-fila {
		border-top: 1px solid var(--border-subtle);
	}
	.dc-fila {
		--tono: #64748b;
	}
	.dc-fila--ok {
		--tono: #16a34a;
	}
	.dc-fila--aviso {
		--tono: #d97706;
	}
	.dc-fila--mal {
		--tono: #dc2626;
	}
	.dc-principal {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
	}
	.dc-icono {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--tono);
	}
	.dc-texto {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.dc-texto strong {
		font-size: 0.86rem;
		color: var(--text-primary);
	}
	.dc-detalle {
		font-size: 0.76rem;
		color: var(--text-muted);
	}
	.dc-fila--mal .dc-detalle {
		color: #b91c1c;
	}
	.dc-estado {
		flex-shrink: 0;
		padding: 2px 9px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--tono) 12%, transparent);
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--tono);
		white-space: nowrap;
	}
	.dc-acciones {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}
	.dc-btn {
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
	.dc-btn small {
		font-size: 0.7rem;
		font-weight: 700;
	}
	.dc-btn:hover,
	.dc-btn--activo {
		background: var(--bg-base);
		color: var(--text-primary);
	}
	.dc-btn--subir:hover {
		color: var(--accion);
	}
	.dc-btn--peligro:hover {
		background: #fef2f2;
		color: #b91c1c;
	}
	.dc-completar {
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
	.dc-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 10px;
		margin: 0 12px 12px 40px;
		padding: 12px;
		border-radius: 12px;
		background: var(--bg-base);
	}
	.dc-form--linea {
		align-items: center;
	}
	.dc-form label > span,
	.dc-campo span {
		display: block;
		margin-bottom: 3px;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.dc-form input[type='date'],
	.dc-form select {
		padding: 0.45rem 0.6rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.84rem;
		color: var(--text-primary);
	}
	.dc-archivo {
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
	.dc-archivo span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dc-archivo--lleno {
		border-style: solid;
		border-color: var(--accion);
		color: var(--text-primary);
	}
	.dc-archivo input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.dc-check {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-basis: 100%;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.dc-check input {
		width: 16px;
		height: 16px;
		accent-color: var(--accion);
	}
	.dc-nota {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.74rem;
		color: var(--text-muted);
	}
	.dc-form-pie {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		flex-basis: 100%;
	}

	/* ── Historial ── */
	.dc-historial {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0 12px 12px 40px;
		padding: 6px;
		list-style: none;
		border-radius: 12px;
		background: var(--bg-base);
	}
	.dc-historial li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 2px 4px;
		font-size: 0.78rem;
	}
	.dc-hist-fecha {
		flex-shrink: 0;
		width: 9.5rem;
		font-weight: 700;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.dc-hist-nombre {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-muted);
	}

	.dc-agregar label {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		color: var(--text-muted);
	}
	.dc-agregar select {
		flex: 1;
		padding: 0.5rem 0.65rem;
		border: 1.5px dashed var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.84rem;
		color: var(--text-secondary);
	}
	.dc-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 2rem 1rem;
		text-align: center;
		color: var(--text-secondary);
	}

	@media (max-width: 560px) {
		.dc-estado {
			display: none;
		}
		.dc-form,
		.dc-historial {
			margin-left: 12px;
		}
	}
</style>
