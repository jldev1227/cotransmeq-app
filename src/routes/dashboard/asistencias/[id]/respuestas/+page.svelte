<script lang="ts">
	/**
	 * Firmas recibidas en un formulario de asistencia.
	 *
	 * Misma cáscara que el directorio de asistencias: cabecera con conteos y
	 * acciones, una tarjeta con la ficha del evento, buscador y segmentos a la
	 * vista, y la tabla compartida con selección para eliminar en lote. Las
	 * firmas se abren en el modal de la app (`ModalBase`), sobre una hoja con
	 * su línea de firma, y se bajan como PNG.
	 *
	 * Todo el filtrado y el orden es en memoria: una asistencia tiene decenas
	 * de firmas, no miles, y ya vienen completas del servidor.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef, SortingState } from '@tanstack/table-core';
	import {
		ChevronLeft,
		Download,
		FileSpreadsheet,
		FileText,
		Link2,
		Pencil,
		PenLine,
		Trash2
	} from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import BarraSeleccion from '$lib/components/listing/BarraSeleccion.svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import ModalFormularioAsistencia from '$lib/components/asistencias/ModalFormularioAsistencia.svelte';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import { mascota } from '$lib/mascot';
	import { socketUtils } from '$lib/socket';
	import { coincide } from '$lib/listing/texto';
	import {
		asistenciasAPI,
		type FormularioAsistencia,
		type RespuestaAsistencia
	} from '$lib/api/asistencias';
	import { duracionLegible, etiquetaTipoEvento, fechaEvento } from '$lib/asistencias/eventos';

	const EMPRESA = 'Cotransmeq';
	const VERDE = '#079665';
	const GRIS = '#66756f';
	const AZUL = '#2563eb';

	const formularioId = $derived(page.params.id ?? '');

	let formulario = $state<FormularioAsistencia | null>(null);
	let respuestas = $state<RespuestaAsistencia[]>([]);
	let cargando = $state(true);

	async function cargar() {
		cargando = true;
		try {
			const [f, r] = await Promise.all([
				asistenciasAPI.obtenerFormulario(formularioId),
				asistenciasAPI.obtenerRespuestas(formularioId)
			]);
			formulario = f;
			respuestas = r;
		} catch (error: any) {
			toast.error(error?.message || 'No se pudo cargar la asistencia');
			goto('/dashboard/asistencias');
		} finally {
			cargando = false;
		}
	}

	const onRespuestaCreada = ({ respuesta, formularioId: id }: any) => {
		if (id !== formularioId || !respuesta) return;
		respuestas = [respuesta, ...respuestas];
		toast.success(`${respuesta.nombre_completo} acaba de firmar`);
	};
	onMount(() => {
		void cargar();
		socketUtils.on('asistencias:respuesta:created', onRespuestaCreada);
	});
	onDestroy(() => socketUtils.off('asistencias:respuesta:created', onRespuestaCreada));

	// ── Filtros y orden (en memoria) ─────────────────────────────────────
	let busqueda = $state('');
	let comite = $state('todos');
	let orden = $state<SortingState>([{ id: 'fecha', desc: true }]);

	const SEGMENTOS_COMITE = [
		{ valor: 'todos', etiqueta: 'Todos' },
		{ valor: 'si', etiqueta: 'Del comité', punto: AZUL },
		{ valor: 'no', etiqueta: 'Sin comité', punto: GRIS }
	];

	const filtradas = $derived.by(() => {
		let lista = respuestas;
		if (comite === 'si') lista = lista.filter((r) => r.pertenece_comite === true);
		if (comite === 'no') lista = lista.filter((r) => r.pertenece_comite !== true);
		const q = busqueda.trim();
		if (q) {
			lista = lista.filter((r) =>
				coincide(q, [r.nombre_completo, r.numero_documento, r.cargo, r.nombre_comite])
			);
		}
		const [o] = orden;
		if (!o) return lista;
		const dir = o.desc ? -1 : 1;
		return [...lista].sort((a, b) => {
			switch (o.id) {
				case 'asistente':
					return dir * a.nombre_completo.localeCompare(b.nombre_completo, 'es');
				case 'documento':
					return dir * a.numero_documento.localeCompare(b.numero_documento, 'es', { numeric: true });
				case 'cargo':
					return dir * a.cargo.localeCompare(b.cargo, 'es');
				default:
					return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
			}
		});
	});
	const hayFiltros = $derived(!!busqueda.trim() || comite !== 'todos');
	const delComite = $derived(respuestas.filter((r) => r.pertenece_comite === true).length);

	const resumen = $derived([
		{ clave: 'todos', etiqueta: 'Firmas', valor: respuestas.length },
		{ clave: 'si', etiqueta: 'Del comité', valor: delComite, color: AZUL },
		{
			clave: 'estado',
			etiqueta: 'Estado',
			valor: formulario?.activo ? 'Activo' : 'Inactivo',
			color: formulario?.activo ? VERDE : GRIS
		}
	]);

	// ── Selección y borrado ──────────────────────────────────────────────
	let seleccion = $state<Set<string>>(new Set());
	let eliminando = $state(false);

	async function eliminarRespuestas(ids: string[]) {
		if (!ids.length) return;
		const n = ids.length;
		const ok = await confirmarEliminacion({
			title: n === 1 ? '¿Eliminar esta firma?' : `¿Eliminar ${n} firmas?`,
			message:
				n === 1
					? 'El asistente desaparecerá del acta y tendrá que volver a firmar si hace falta.'
					: 'Los asistentes desaparecerán del acta y tendrán que volver a firmar si hace falta.'
		});
		if (!ok) return;
		eliminando = true;
		try {
			await asistenciasAPI.eliminarRespuestas(ids);
			const borradas = new Set(ids);
			respuestas = respuestas.filter((r) => !borradas.has(r.id));
			seleccion = new Set([...seleccion].filter((id) => !borradas.has(id)));
			toast.success(n === 1 ? 'Firma eliminada' : `${n} firmas eliminadas`);
		} catch (error: any) {
			toast.error(error?.message || 'No se pudieron eliminar las firmas');
		} finally {
			eliminando = false;
		}
	}

	// ── Exportar y enlace ────────────────────────────────────────────────
	function nombreBase(): string {
		return (formulario?.tematica ?? 'asistencia')
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^a-zA-Z0-9]+/g, '_')
			.replace(/^_|_$/g, '')
			.slice(0, 60);
	}

	function exportarCSV() {
		if (!respuestas.length) return toast.error('No hay firmas para exportar');
		const cabeceras = ['Fecha', 'Nombre completo', 'Documento', 'Cargo', 'Teléfono', 'Comité', 'IP', 'Navegador'];
		const filas = filtradas.map((r) => [
			new Date(r.created_at).toLocaleString('es-CO'),
			r.nombre_completo,
			r.numero_documento,
			r.cargo,
			r.numero_telefono,
			r.pertenece_comite ? r.nombre_comite || 'Sí' : 'No',
			r.ip_address || '',
			r.user_agent || ''
		]);
		const csv = [cabeceras, ...filas]
			.map((fila) => fila.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const a = document.createElement('a');
		a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
		a.download = `firmas_${nombreBase()}.csv`;
		a.click();
	}

	let generandoPdf = $state(false);
	async function exportarPDF() {
		if (!respuestas.length) return toast.error('No hay firmas para exportar');
		if (generandoPdf) return;
		generandoPdf = true;
		const id = toast.loading('Generando el acta en PDF…');
		try {
			const blob = await asistenciasAPI.exportarPDF(formularioId);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `asistencia_${nombreBase()}.pdf`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			toast.success('PDF listo', { id });
		} catch (error: any) {
			toast.error(error?.message || 'No se pudo generar el PDF', { id });
		} finally {
			generandoPdf = false;
		}
	}

	async function copiarEnlace() {
		if (!formulario) return;
		try {
			await navigator.clipboard.writeText(asistenciasAPI.generarUrlPublica(formulario.token));
			toast.success('Enlace para firmar copiado');
		} catch {
			toast.error('No se pudo copiar el enlace');
		}
	}

	// ── Modal de firma ───────────────────────────────────────────────────
	let firmaDe = $state<RespuestaAsistencia | null>(null);

	/** «firma-juan-perez-12345678.png»: identifica el archivo sin abrirlo. */
	function nombreArchivoFirma(r: RespuestaAsistencia): string {
		const nombre = r.nombre_completo
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
		return `firma-${nombre}${r.numero_documento ? '-' + r.numero_documento : ''}.png`;
	}

	// ── Edición del formulario ───────────────────────────────────────────
	let editando = $state(false);

	// ── Tabla ────────────────────────────────────────────────────────────
	const COLUMNAS: ColumnDef<RespuestaAsistencia, any>[] = [
		{ id: 'asistente', header: 'Asistente', accessorKey: 'nombre_completo' },
		{ id: 'documento', header: 'Documento', accessorKey: 'numero_documento', size: 140 },
		{ id: 'telefono', header: 'Teléfono', enableSorting: false, size: 140 },
		{ id: 'comite', header: 'Comité', enableSorting: false, size: 180 },
		{ id: 'fecha', header: 'Firmó el', accessorKey: 'created_at', size: 170 },
		{ id: 'firma', header: 'Firma', enableSorting: false, size: 120 },
		{ id: 'acciones', header: '', enableSorting: false, size: 120 }
	];

	function fechaHora(iso: string): string {
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
	const horario = $derived.by(() => {
		if (!formulario || (!formulario.hora_inicio && !formulario.hora_finalizacion)) return '';
		const rango = `${formulario.hora_inicio || '--:--'} – ${formulario.hora_finalizacion || '--:--'}`;
		const dur = duracionLegible(formulario.duracion_minutos);
		return dur ? `${rango} · ${dur}` : rango;
	});
</script>

<svelte:head>
	<title>Firmas · {formulario?.tematica || 'Asistencia'} — {EMPRESA}</title>
</svelte:head>

{#if cargando && !formulario}
	<CargaMascota tamano="pantalla" texto="Cargando la asistencia…" />
{:else if formulario}
	<div class="dir-pagina" in:fade={{ duration: 300 }}>
		<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
			<div class="dir-cabecera-texto">
				<a class="as-volver" href="/dashboard/asistencias">
					<ChevronLeft size={16} strokeWidth={2.4} />
					Asistencias
				</a>
				<span class="as-eyebrow">
					{etiquetaTipoEvento(formulario.tipo_evento, formulario.tipo_evento_otro)} · {fechaEvento(formulario.fecha)}
				</span>
				<h1 class="dir-titulo">{formulario.tematica}</h1>
				{#if formulario.lugar_sede || formulario.nombre_instructor}
					<p class="dir-desc">
						{[formulario.lugar_sede, formulario.nombre_instructor].filter(Boolean).join(' · ')}
					</p>
				{/if}
				<div class="dir-conteos">
					<ResumenConteos
						conteos={resumen}
						activo={comite === 'todos' ? null : comite}
						onElegir={(clave) => {
							if (clave === 'estado') return;
							comite = comite === clave ? 'todos' : clave;
						}}
					/>
				</div>
			</div>

			<div class="dir-cabecera-acciones">
				<button type="button" class="btn-secondary" onclick={copiarEnlace} title="Enlace público para firmar">
					<Link2 size={16} strokeWidth={2} />
					Copiar enlace
				</button>
				<button type="button" class="btn-secondary" onclick={exportarCSV} disabled={!respuestas.length}>
					<FileSpreadsheet size={16} strokeWidth={2} />
					Excel
				</button>
				<button
					type="button"
					class="btn-secondary"
					onclick={exportarPDF}
					disabled={!respuestas.length || generandoPdf}
				>
					<FileText size={16} strokeWidth={2} />
					{generandoPdf ? 'Generando…' : 'PDF'}
				</button>
				<button type="button" class="btn-primary" onclick={() => (editando = true)}>
					<Pencil size={16} strokeWidth={2} />
					Editar
				</button>
			</div>
		</header>

		<!-- ── Ficha del evento ──────────────────────────────────────── -->
		<section class="page-card as-ficha" in:fly={{ y: 12, duration: 400, delay: 80 }}>
			<dl class="as-datos">
				<div>
					<dt>Fecha</dt>
					<dd>{fechaEvento(formulario.fecha)}</dd>
				</div>
				{#if horario}
					<div>
						<dt>Horario</dt>
						<dd>{horario}</dd>
					</div>
				{/if}
				{#if formulario.lugar_sede}
					<div>
						<dt>Lugar</dt>
						<dd>{formulario.lugar_sede}</dd>
					</div>
				{/if}
				{#if formulario.nombre_instructor}
					<div>
						<dt>Instructor</dt>
						<dd>{formulario.nombre_instructor}</dd>
					</div>
				{/if}
				<div>
					<dt>Estado</dt>
					<dd>
						<EstadoPunto
							etiqueta={formulario.activo ? 'Activo · recibe firmas' : 'Inactivo · cerrado'}
							color={formulario.activo ? VERDE : GRIS}
							apagado={!formulario.activo}
						/>
					</dd>
				</div>
				{#if formulario.creado_por}
					<div>
						<dt>Creado por</dt>
						<dd>{formulario.creado_por.nombre}</dd>
					</div>
				{/if}
			</dl>
			{#if formulario.objetivo}
				<div class="as-bloque">
					<span class="as-bloque-titulo">Objetivo</span>
					<p>{formulario.objetivo}</p>
				</div>
			{/if}
			{#if formulario.observaciones}
				<div class="as-bloque">
					<span class="as-bloque-titulo">Observaciones</span>
					<p>{formulario.observaciones}</p>
				</div>
			{/if}
		</section>

		<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 120 }}>
			<div class="dir-filtros-buscador">
				<BuscadorLista
					bind:valor={busqueda}
					onBuscar={(t) => (busqueda = t)}
					placeholder="Nombre, documento, cargo o comité…"
					etiqueta="Buscar asistentes"
				/>
			</div>
			<SegmentosFiltro
				etiqueta="Comité"
				opciones={SEGMENTOS_COMITE}
				valor={comite}
				onCambiar={(v) => (comite = v)}
			/>
		</div>

		<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 160 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS}
					datos={filtradas}
					claveFila={(r) => r.id}
					{cargando}
					{orden}
					onOrdenar={(o) => (orden = o.length ? o : [{ id: 'fecha', desc: true }])}
					onFila={(r) => (firmaDe = r)}
					etiqueta="Asistentes que firmaron"
					{seleccion}
					onSeleccion={(ids) => (seleccion = ids)}
				>
					{#snippet celda({ columnaId, fila: r })}
						{#if columnaId === 'asistente'}
							<CeldaIdentidad titulo={r.nombre_completo} subtitulo={r.cargo || undefined} />
						{:else if columnaId === 'documento'}
							<span class="as-mono">{r.numero_documento || '—'}</span>
						{:else if columnaId === 'telefono'}
							{#if r.numero_telefono}
								<span class="as-mono">{r.numero_telefono}</span>
							{:else}
								<span class="dir-nulo">—</span>
							{/if}
						{:else if columnaId === 'comite'}
							{#if r.pertenece_comite === true}
								<div class="dir-celda">
									<EstadoPunto etiqueta="Sí" color={AZUL} />
									{#if r.nombre_comite}<small title={r.nombre_comite}>{r.nombre_comite}</small>{/if}
								</div>
							{:else if r.pertenece_comite === false}
								<EstadoPunto etiqueta="No" color={GRIS} apagado />
							{:else}
								<span class="dir-nulo">—</span>
							{/if}
						{:else if columnaId === 'fecha'}
							<span class="dir-celda dir-celda--fecha">{fechaHora(r.created_at)}</span>
						{:else if columnaId === 'firma'}
							<span class="as-firma-mini" aria-hidden="true">
								<img src={r.firma} alt="" loading="lazy" draggable="false" />
							</span>
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{ id: 'ver', etiqueta: 'Ver firma', icono: PenLine, onClick: () => (firmaDe = r) },
									{
										id: 'eliminar',
										etiqueta: 'Eliminar firma',
										icono: Trash2,
										onClick: () => eliminarRespuestas([r.id]),
										peligrosa: true
									}
								]}
							/>
						{/if}
					{/snippet}

					{#snippet vacio()}
						{@const img = mascota(hayFiltros ? 'vacio' : 'espera')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>{hayFiltros ? 'Sin resultados' : 'Todavía nadie ha firmado'}</h3>
							<p>
								{hayFiltros
									? 'Ningún asistente coincide con la búsqueda o el filtro de comité.'
									: 'Comparte el enlace con los asistentes; las firmas aparecen aquí en tiempo real.'}
							</p>
							{#if hayFiltros}
								<button
									type="button"
									class="btn-secondary"
									onclick={() => {
										busqueda = '';
										comite = 'todos';
									}}
								>
									Limpiar filtros
								</button>
							{:else}
								<button type="button" class="btn-primary" onclick={copiarEnlace}>
									<Link2 size={16} strokeWidth={2} />
									Copiar enlace para firmar
								</button>
							{/if}
						</div>
					{/snippet}
				</TablaLista>
			</div>
		</div>

		<BarraSeleccion
			cantidad={seleccion.size}
			nombreItems="firmas"
			procesando={eliminando}
			onLimpiar={() => (seleccion = new Set())}
			acciones={[
				{
					id: 'eliminar',
					etiqueta: 'Eliminar',
					icono: Trash2,
					tono: 'peligro',
					onClick: () => eliminarRespuestas([...seleccion])
				}
			]}
		/>
	</div>
{/if}

<!-- ── Modal de firma ─────────────────────────────────────────────────
     La firma va sobre una «hoja» con su línea, como en el acta impresa, y
     se puede bajar como PNG tal cual la trazó el asistente. -->
<ModalBase
	open={firmaDe !== null}
	eyebrow="Firma digital"
	title={firmaDe?.nombre_completo ?? 'Firma'}
	subtitle={firmaDe ? `${firmaDe.cargo ? firmaDe.cargo + ' · ' : ''}firmó el ${fechaHora(firmaDe.created_at)}` : null}
	oncerrar={() => (firmaDe = null)}
>
	{#if firmaDe}
		<figure class="firma-hoja">
			<img src={firmaDe.firma} alt="Firma de {firmaDe.nombre_completo}" draggable="false" />
			<figcaption>
				<span class="firma-linea" aria-hidden="true"></span>
				<span class="firma-nombre">{firmaDe.nombre_completo}</span>
				<span class="firma-doc">
					{#if firmaDe.numero_documento}CC {firmaDe.numero_documento}{:else}Sin documento{/if}
				</span>
			</figcaption>
		</figure>
	{/if}
	{#snippet pie()}
		{#if firmaDe}
			<a class="btn-secondary" href={firmaDe.firma} download={nombreArchivoFirma(firmaDe)}>
				<Download size={16} strokeWidth={2.2} />
				Descargar PNG
			</a>
		{/if}
		<button type="button" class="btn-primary" onclick={() => (firmaDe = null)}>Cerrar</button>
	{/snippet}
</ModalBase>

<ModalFormularioAsistencia
	open={editando}
	{formulario}
	oncerrar={() => (editando = false)}
	onguardado={(f) => (formulario = { ...formulario, ...f })}
/>

<style>
	.as-volver {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-bottom: 0.25rem;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-muted);
		text-decoration: none;
	}
	.as-volver:hover {
		color: var(--au-primary-strong);
	}
	.as-eyebrow {
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--au-primary-strong);
	}

	/* ═══ Ficha del evento ═══ */
	.as-ficha {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		flex-shrink: 0;
	}
	.as-datos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.85rem 1.25rem;
		margin: 0;
	}
	.as-datos dt {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin-bottom: 0.2rem;
	}
	.as-datos dd {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.as-bloque {
		padding-top: 0.85rem;
		border-top: 1px solid var(--border-subtle);
	}
	.as-bloque-titulo {
		display: block;
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin-bottom: 0.3rem;
	}
	.as-bloque p {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.55;
		color: var(--text-secondary);
		max-width: 60rem;
		white-space: pre-line;
	}

	/* ═══ Celdas ═══ */
	.as-mono {
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
		color: var(--text-primary);
	}
	.as-firma-mini {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 96px;
		height: 40px;
		padding: 3px 6px;
		border-radius: 10px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.as-firma-mini img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		display: block;
	}

	/* ═══ Firma en el modal: una hoja con su línea de firma ═══ */
	.firma-hoja {
		margin: 0;
		padding: 1.75rem 1.5rem 1.25rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}
	.firma-hoja img {
		width: 100%;
		max-width: 28rem;
		max-height: 40vh;
		object-fit: contain;
		display: block;
		user-select: none;
	}
	.firma-hoja figcaption {
		width: 100%;
		max-width: 28rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
	}
	/* La línea de firma del acta: con la «x» que marca dónde se firma. */
	.firma-linea {
		position: relative;
		width: 100%;
		height: 1px;
		margin-bottom: 0.5rem;
		background: var(--text-muted);
		opacity: 0.6;
	}
	.firma-linea::before {
		content: '×';
		position: absolute;
		left: 0;
		bottom: 0.2rem;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-muted);
	}
	.firma-nombre {
		font-family: var(--font-display);
		font-size: 1rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--text-primary);
		text-align: center;
	}
	.firma-doc {
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
</style>
