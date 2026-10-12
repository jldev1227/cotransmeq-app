<script lang="ts">
	/**
	 * Detalle de un accidente, incidente o casi-accidente.
	 *
	 * Reúne en una página lo que la Res. 1401 de 2007 pide documentar: el
	 * reporte con sus evidencias, la investigación (equipo, causas inmediatas y
	 * básicas, porqués, lecciones), las acciones correctivas que salieron de ella
	 * y el cierre con fecha y responsable.
	 *
	 * Qué se puede tocar depende del estado y lo decide el servidor; aquí solo
	 * se esconden los controles que darían 409: un reporte cerrado no se edita
	 * (se reabre), y la investigación y las acciones solo se escriben con la
	 * investigación abierta. El «Volver» regresa al listado con sus filtros.
	 */
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { fade } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		ArrowLeft,
		ClipboardCheck,
		ExternalLink,
		Eye,
		FileText,
		Image as IcoImagen,
		Link2Off,
		Paperclip,
		Pencil,
		Plus,
		RotateCcw,
		Search,
		Trash2,
		X
	} from 'lucide-svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import ModalReporteIncidente from '$lib/components/incidentes/ModalReporteIncidente.svelte';
	import ModalAccionIncidente from '$lib/components/incidentes/ModalAccionIncidente.svelte';
	import { authStore } from '$lib/stores/auth';
	import { checkAccess } from '$lib/config/permissions';
	import { confirmar, confirmarEliminacion } from '$lib/stores/confirm';
	import { comprimirImagen } from '$lib/api/viaticos';
	import { listadoIncidentes } from '$lib/incidentes/listado';
	import {
		incidentesAPI,
		mensajeError,
		fechaCorta,
		moneda,
		hoyColombia,
		ESTADO_LABELS,
		SEVERIDAD_LABELS,
		TIPO_LABELS,
		TRAYECTO_LABELS,
		CLASES_EVENTO,
		type DatosInvestigacion,
		type IncidenteDetalleApi
	} from '$lib/api/incidentes';

	const id = $derived(page.params.id ?? '');

	// ─── Permisos ───────────────────────────────────────────────────────────
	const nivel = $derived.by(() => {
		const u = $authStore.user;
		if (!u) return { incidentes: null as string | null, acciones: null as string | null };
		const inc = checkAccess(u.role || u.rol, u.area, 'incidentes', u.permisos_rutas);
		const ac = checkAccess(u.role || u.rol, u.area, 'acciones-correctivas', u.permisos_rutas);
		return { incidentes: inc.allowed ? inc.level : null, acciones: ac.allowed ? ac.level : null };
	});
	const puedeEscribir = $derived(nivel.incidentes === 'full');
	/// Crear la acción nace en el otro módulo: pide también escribir allá.
	const puedeCrearAccion = $derived(puedeEscribir && nivel.acciones === 'full');

	// ─── Datos ──────────────────────────────────────────────────────────────
	let inc = $state<IncidenteDetalleApi | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);

	async function cargar() {
		error = null;
		try {
			aplicar(await incidentesAPI.detalle(id));
		} catch (err) {
			error = mensajeError(err, 'No se pudo abrir el incidente');
		} finally {
			cargando = false;
		}
	}

	$effect(() => {
		void id;
		untrack(() => {
			cargando = true;
			inc = null;
			void cargar();
		});
	});

	/** Toma el detalle que devolvió el servidor y reinicia los formularios locales. */
	function aplicar(d: IncidenteDetalleApi) {
		inc = d;
		inv = copiaInvestigacion(d);
		invInicial = JSON.stringify(inv);
		cierre = {
			fecha_cierre: d.cierre.fecha_cierre ?? hoyColombia(),
			responsable_cierre: d.cierre.responsable_cierre ?? $authStore.user?.nombre ?? '',
			observaciones_cierre: d.cierre.observaciones_cierre ?? ''
		};
		faltantes = [];
	}

	const reporteEditable = $derived(!!inc && inc.estado !== 'CERRADO');
	const investigacionAbierta = $derived(inc?.estado === 'EN_INVESTIGACION');

	// ─── Investigación ──────────────────────────────────────────────────────
	type FormInvestigacion = Omit<DatosInvestigacion, 'analisis_porques' | 'equipo_investigador'> & {
		equipo_investigador: { nombre: string; cargo: string }[];
		analisis_porques: string[];
	};
	function copiaInvestigacion(d: IncidenteDetalleApi): FormInvestigacion {
		const i = d.investigacion;
		return {
			fecha_investigacion: i.fecha_investigacion ?? hoyColombia(),
			equipo_investigador: i.equipo_investigador.length
				? i.equipo_investigador.map((m) => ({ nombre: m.nombre, cargo: m.cargo ?? '' }))
				: [{ nombre: '', cargo: '' }],
			actos_inseguros: i.actos_inseguros ?? '',
			condiciones_inseguras: i.condiciones_inseguras ?? '',
			factores_personales: i.factores_personales ?? '',
			factores_trabajo: i.factores_trabajo ?? '',
			/// Cinco porqués: se muestran los guardados y al menos tres casillas.
			analisis_porques: [...i.analisis_porques, '', '', ''].slice(
				0,
				Math.max(3, i.analisis_porques.length + 1)
			),
			causas_identificadas: i.causas_identificadas ?? '',
			lecciones_aprendidas: i.lecciones_aprendidas ?? ''
		};
	}
	let inv = $state<FormInvestigacion | null>(null);
	let invInicial = $state('');
	const invSucia = $derived(!!inv && JSON.stringify(inv) !== invInicial);
	let guardandoInv = $state(false);

	const nulo = (t: string | null | undefined) => (t && t.trim() ? t.trim() : null);

	async function guardarInvestigacion(silencioso = false): Promise<boolean> {
		if (!inc || !inv) return false;
		guardandoInv = true;
		try {
			const d = await incidentesAPI.guardarInvestigacion(inc.id, {
				fecha_investigacion: nulo(inv.fecha_investigacion),
				equipo_investigador: inv.equipo_investigador
					.filter((m) => m.nombre.trim())
					.map((m) => ({ nombre: m.nombre.trim(), cargo: nulo(m.cargo) })),
				actos_inseguros: nulo(inv.actos_inseguros),
				condiciones_inseguras: nulo(inv.condiciones_inseguras),
				factores_personales: nulo(inv.factores_personales),
				factores_trabajo: nulo(inv.factores_trabajo),
				analisis_porques: inv.analisis_porques.map((p) => p.trim()).filter(Boolean),
				causas_identificadas: nulo(inv.causas_identificadas),
				lecciones_aprendidas: nulo(inv.lecciones_aprendidas)
			});
			aplicar(d);
			if (!silencioso) toast.success('Investigación guardada');
			return true;
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudo guardar la investigación'));
			return false;
		} finally {
			guardandoInv = false;
		}
	}

	// ─── Estado ─────────────────────────────────────────────────────────────
	let cierre = $state({ fecha_cierre: '', responsable_cierre: '', observaciones_cierre: '' });
	let faltantes = $state<string[]>([]);
	let cambiando = $state(false);

	async function iniciarInvestigacion() {
		if (!inc || cambiando) return;
		cambiando = true;
		try {
			aplicar(await incidentesAPI.cambiarEstado(inc.id, 'iniciar_investigacion'));
			toast.success('Investigación iniciada');
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudo iniciar la investigación'));
		} finally {
			cambiando = false;
		}
	}

	async function cerrarIncidente() {
		if (!inc || cambiando) return;
		/// Lo escrito y no guardado en la investigación cuenta para cerrar: se guarda primero.
		if (invSucia && !(await guardarInvestigacion(true))) return;
		cambiando = true;
		faltantes = [];
		try {
			aplicar(
				await incidentesAPI.cambiarEstado(inc.id, 'cerrar', {
					fecha_cierre: cierre.fecha_cierre,
					responsable_cierre: cierre.responsable_cierre.trim(),
					observaciones_cierre: cierre.observaciones_cierre.trim() || undefined
				})
			);
			toast.success('Incidente cerrado');
		} catch (err) {
			const datos = (err as { response?: { data?: { details?: string[] } } })?.response?.data;
			if (datos?.details?.length) faltantes = datos.details;
			else toast.error(mensajeError(err, 'No se pudo cerrar'));
		} finally {
			cambiando = false;
		}
	}

	async function reabrir() {
		if (!inc || cambiando) return;
		const ok = await confirmar({
			tone: 'warning',
			title: `¿Reabrir ${inc.codigo}?`,
			message:
				'Vuelve a «En investigación» y se borra el cierre (fecha y responsable). La investigación se conserva.',
			confirmText: 'Reabrir'
		});
		if (!ok) return;
		cambiando = true;
		try {
			aplicar(await incidentesAPI.cambiarEstado(inc.id, 'reabrir'));
			toast.success('Incidente reabierto');
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudo reabrir'));
		} finally {
			cambiando = false;
		}
	}

	async function eliminar() {
		if (!inc) return;
		const ok = await confirmarEliminacion({
			title: `¿Eliminar ${inc.codigo}?`,
			message:
				'Deja de aparecer en el listado y en los indicadores. Sus evidencias y acciones no se borran.',
			confirmText: 'Eliminar'
		});
		if (!ok) return;
		try {
			await incidentesAPI.eliminar(inc.id);
			toast.success(`${inc.codigo} eliminado`);
			goto(listadoIncidentes.url());
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudo eliminar'));
		}
	}

	// ─── Evidencias ─────────────────────────────────────────────────────────
	let subiendo = $state(false);
	let descripcionEvidencia = $state('');

	async function subirEvidencias(e: Event) {
		if (!inc) return;
		const input = e.currentTarget as HTMLInputElement;
		const archivos = Array.from(input.files ?? []);
		input.value = '';
		if (!archivos.length) return;
		subiendo = true;
		let ok = 0;
		for (const f of archivos) {
			if (!/^(application\/pdf|image\/(png|jpe?g|webp))$/.test(f.type)) {
				toast.error(`${f.name}: solo PDF o imagen`);
				continue;
			}
			try {
				await incidentesAPI.subirEvidencia(inc.id, await comprimirImagen(f), descripcionEvidencia);
				ok++;
			} catch (err) {
				toast.error(`${f.name}: ${mensajeError(err, 'no se pudo subir')}`);
			}
		}
		subiendo = false;
		descripcionEvidencia = '';
		if (ok) {
			toast.success(ok === 1 ? 'Evidencia subida' : `${ok} evidencias subidas`);
			await cargar();
		}
	}

	async function verEvidencia(evId: string) {
		if (!inc) return;
		/// La ventana se abre ANTES de pedir la URL: si se abre después del
		/// `await`, el navegador la trata como emergente y la bloquea.
		const ventana = window.open('', '_blank');
		try {
			const url = await incidentesAPI.urlEvidencia(inc.id, evId);
			if (ventana) ventana.location.href = url;
			else window.open(url, '_blank', 'noopener');
		} catch (err) {
			ventana?.close();
			toast.error(mensajeError(err, 'No se pudo abrir la evidencia'));
		}
	}

	async function quitarEvidencia(evId: string, nombre: string) {
		if (!inc) return;
		const ok = await confirmarEliminacion({
			title: '¿Quitar la evidencia?',
			message: `«${nombre}» deja de aparecer en el reporte.`,
			confirmText: 'Quitar'
		});
		if (!ok) return;
		try {
			await incidentesAPI.eliminarEvidencia(inc.id, evId);
			toast.success('Evidencia quitada');
			await cargar();
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudo quitar la evidencia'));
		}
	}

	// ─── Acciones ───────────────────────────────────────────────────────────
	let modalAccion = $state(false);
	let modalReporte = $state(false);

	async function desvincular(accionId: string, numero: string) {
		if (!inc) return;
		const ok = await confirmar({
			tone: 'warning',
			title: `¿Desvincular ${numero}?`,
			message:
				'La acción sigue en el módulo de acciones correctivas; solo deja de figurar en esta investigación.',
			confirmText: 'Desvincular'
		});
		if (!ok) return;
		try {
			aplicar(await incidentesAPI.desvincularAccion(inc.id, accionId));
			toast.success(`${numero} desvinculada`);
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudo desvincular'));
		}
	}

	// ─── Presentación ───────────────────────────────────────────────────────
	const plazo = $derived.by(() => {
		if (!inc || inc.estado === 'CERRADO') return null;
		const d = inc.plazo.dias_restantes ?? 0;
		const limite = fechaCorta(inc.plazo.limite);
		if (d < 0)
			return {
				texto: `El plazo de 15 días para investigar venció el ${limite} (hace ${-d} ${-d === 1 ? 'día' : 'días'}).`,
				tono: 'mal'
			};
		if (d === 0)
			return { texto: `Hoy (${limite}) vence el plazo de 15 días para investigar.`, tono: 'mal' };
		return {
			texto: `La investigación debe concluir antes del ${limite}: quedan ${d} ${d === 1 ? 'día' : 'días'}.`,
			tono: d <= 3 ? 'aviso' : 'ok'
		};
	});
	const claseEvento = $derived(
		CLASES_EVENTO.find((c) => c.valor === inc?.tipo_evento)?.etiqueta ?? inc?.tipo_evento ?? null
	);
	const tamano = (b: number) =>
		b > 1024 * 1024
			? `${(b / 1024 / 1024).toFixed(1)} MB`
			: `${Math.max(1, Math.round(b / 1024))} KB`;
	const ESTADO_ACCION: Record<string, string> = {
		EN_PROCESO: 'En proceso',
		CERRADA_EFICAZ: 'Cerrada eficaz',
		CERRADA_NO_EFICAZ: 'Cerrada no eficaz',
		VENCIDA: 'Vencida',
		REPLANTEADA: 'Replanteada'
	};
</script>

<svelte:head>
	<title>{inc ? `${inc.codigo} · Incidentes` : 'Incidente'} · Panel</title>
</svelte:head>

{#if cargando}
	<CargaMascota tamano="pantalla" texto="Abriendo el reporte…" />
{:else if error || !inc}
	<div class="dir-pagina">
		<div class="page-card inc-error">
			<h2>No se pudo abrir el reporte</h2>
			<p>{error ?? 'No existe o fue eliminado.'}</p>
			<button class="btn-primary" onclick={() => goto(listadoIncidentes.url())}
				>Volver a incidentes</button
			>
		</div>
	</div>
{:else}
	<div class="dir-pagina inc" in:fade={{ duration: 250 }}>
		<!-- ── Cabecera ── -->
		<header class="page-card inc-cab">
			<div class="inc-cab-fila">
				<button
					class="btn-secondary inc-volver"
					onclick={() => goto(listadoIncidentes.url())}
					aria-label="Volver al listado"
				>
					<ArrowLeft size={16} /> Volver
				</button>
				<div class="inc-cab-texto">
					<p class="inc-eyebrow">
						<span class="inc-tipo-punto" style="background:{TIPO_LABELS[inc.tipo].color}"></span>
						{TIPO_LABELS[inc.tipo].label} · {inc.codigo}
					</p>
					<h1 class="dir-titulo">
						{inc.lugar ?? 'Sin lugar'}{inc.municipio ? `, ${inc.municipio.nombre}` : ''}
					</h1>
					<p class="dir-desc">
						{fechaCorta(inc.fecha)}{inc.hora ? ` · ${inc.hora}` : ''}{inc.vehiculo
							? ` · ${inc.vehiculo.placa}`
							: ''}{inc.conductor ? ` · ${inc.conductor.nombre}` : ''}
					</p>
				</div>
				<EstadoPunto
					etiqueta={ESTADO_LABELS[inc.estado].label}
					color={ESTADO_LABELS[inc.estado].color}
				/>
			</div>
			{#if puedeEscribir}
				<div class="inc-cab-acciones">
					{#if reporteEditable}
						<button class="btn-secondary" onclick={() => (modalReporte = true)}
							><Pencil size={15} /> Corregir reporte</button
						>
					{/if}
					{#if inc.estado === 'REPORTADO'}
						<button class="btn-primary" disabled={cambiando} onclick={iniciarInvestigacion}>
							<Search size={15} /> Iniciar investigación
						</button>
					{:else if inc.estado === 'CERRADO'}
						<button class="btn-secondary" disabled={cambiando} onclick={reabrir}
							><RotateCcw size={15} /> Reabrir</button
						>
					{/if}
					<button class="btn-secondary inc-peligro" onclick={eliminar}
						><Trash2 size={15} /> Eliminar</button
					>
				</div>
			{/if}
			{#if plazo}
				<p class="inc-plazo inc-plazo--{plazo.tono}" role="status">{plazo.texto}</p>
			{/if}
		</header>

		<div class="inc-rejilla">
			<!-- ── Reporte ── -->
			<section class="page-card inc-card">
				<h2>Reporte</h2>
				<dl class="inc-datos">
					<dt>Gravedad</dt>
					<dd>
						{inc.severidad
							? SEVERIDAD_LABELS[inc.severidad]
							: inc.tipo === 'CASI_ACCIDENTE'
								? 'Sin consecuencias'
								: 'Sin daños'}
						{#if inc.heridos || inc.fallecidos}
							<span class="inc-victimas">
								{inc.heridos
									? `${inc.heridos} lesionado${inc.heridos === 1 ? '' : 's'}`
									: ''}{inc.heridos && inc.fallecidos ? ' · ' : ''}{inc.fallecidos
									? `${inc.fallecidos} fallecido${inc.fallecidos === 1 ? '' : 's'}`
									: ''}
							</span>
						{/if}
					</dd>
					<dt>Trayecto</dt>
					<dd>{TRAYECTO_LABELS[inc.trayecto]}</dd>
					{#if claseEvento}<dt>Clase</dt>
						<dd>{claseEvento}</dd>{/if}
					<dt>Vehículo</dt>
					<dd>
						{inc.vehiculo
							? `${inc.vehiculo.placa} · ${[inc.vehiculo.marca, inc.vehiculo.linea].filter(Boolean).join(' ')}`
							: '—'}
					</dd>
					<dt>Conductor</dt>
					<dd>
						{inc.conductor
							? `${inc.conductor.nombre}${inc.conductor.documento ? ` · ${inc.conductor.documento}` : ''}`
							: '—'}
					</dd>
					<dt>Servicio</dt>
					<dd>
						{#if inc.servicio}
							<a href="/dashboard/servicios/{inc.servicio.id}">{inc.servicio.ruta}</a>{inc.servicio
								.cliente
								? ` · ${inc.servicio.cliente}`
								: ''}
						{:else}—{/if}
					</dd>
					<dt>Autoridad</dt>
					<dd>
						{inc.autoridad ?? '—'}{inc.numero_informe
							? ` · IPAT/informe ${inc.numero_informe}`
							: ''}
					</dd>
					<dt>Costo estimado</dt>
					<dd>Directo {moneda(inc.costo_directo)} · Indirecto {moneda(inc.costo_indirecto)}</dd>
					<dt>Reportó</dt>
					<dd>
						{inc.registrado_por?.nombre ?? '—'} · {new Date(inc.created_at).toLocaleString(
							'es-CO',
							{ dateStyle: 'medium', timeStyle: 'short' }
						)}
					</dd>
				</dl>
				<p class="inc-descripcion">{inc.descripcion}</p>
				{#if inc.terceros.length}
					<h3>Terceros involucrados</h3>
					<ul class="inc-terceros">
						{#each inc.terceros as t}
							<li>
								<strong>{t.nombre}</strong>
								<span>
									{[t.documento, t.placa, t.telefono, t.aseguradora].filter(Boolean).join(' · ') ||
										'Sin datos de contacto'}
									{#if t.lesionado}<em>lesionado</em>{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── Evidencias ── -->
			<section class="page-card inc-card">
				<div class="inc-card-cab">
					<h2>Evidencias</h2>
					{#if puedeEscribir && reporteEditable}
						<label class="btn-secondary inc-btn-mini" class:inc-deshabilitado={subiendo}>
							<Paperclip size={14} />
							{subiendo ? 'Subiendo…' : 'Adjuntar'}
							<input
								type="file"
								accept="application/pdf,image/png,image/jpeg,image/webp"
								multiple
								hidden
								disabled={subiendo}
								onchange={subirEvidencias}
							/>
						</label>
					{/if}
				</div>
				{#if puedeEscribir && reporteEditable}
					<input
						class="inc-input"
						type="text"
						maxlength="500"
						placeholder="Descripción para la próxima evidencia (opcional): «foto frontal», «croquis»…"
						bind:value={descripcionEvidencia}
					/>
				{/if}
				{#if inc.evidencias.length === 0}
					<p class="inc-nota">Sin evidencias. Fotos del sitio, croquis o el IPAT escaneado.</p>
				{:else}
					<ul class="inc-evidencias">
						{#each inc.evidencias as ev (ev.id)}
							<li>
								{#if ev.mimetype.startsWith('image/')}<IcoImagen size={18} />{:else}<FileText
										size={18}
									/>{/if}
								<div>
									<strong>{ev.descripcion ?? ev.nombre}</strong>
									<small>{ev.nombre} · {tamano(ev.tamano)} · {ev.subido_por ?? '—'}</small>
								</div>
								<button
									class="inc-icono"
									aria-label="Ver {ev.nombre}"
									onclick={() => verEvidencia(ev.id)}><Eye size={16} /></button
								>
								{#if puedeEscribir && reporteEditable}
									<button
										class="inc-icono inc-icono--peligro"
										aria-label="Quitar {ev.nombre}"
										onclick={() => quitarEvidencia(ev.id, ev.nombre)}
									>
										<Trash2 size={16} />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── Investigación ── -->
			<section class="page-card inc-card inc-card--ancha">
				<div class="inc-card-cab">
					<h2>Investigación</h2>
					{#if investigacionAbierta && puedeEscribir}
						<button
							class="btn-primary inc-btn-mini"
							disabled={guardandoInv || !invSucia}
							onclick={() => guardarInvestigacion()}
						>
							{guardandoInv ? 'Guardando…' : invSucia ? 'Guardar investigación' : 'Guardada'}
						</button>
					{/if}
				</div>

				{#if inc.estado === 'REPORTADO'}
					<p class="inc-nota">
						Aún no se ha iniciado. La Res. 1401 de 2007 pide investigar dentro de los 15 días
						siguientes al evento, con un equipo que incluya al jefe inmediato, un representante del
						COPASST y el responsable de SST.
					</p>
				{:else if inv && investigacionAbierta && puedeEscribir}
					<div class="inc-form">
						<label class="inc-campo inc-campo--corto">
							<span>Fecha de la investigación</span>
							<input
								class="inc-input"
								type="date"
								min={inc.fecha}
								max={hoyColombia()}
								bind:value={inv.fecha_investigacion}
							/>
						</label>

						<fieldset class="inc-campo inc-campo--ancho">
							<legend>Equipo investigador</legend>
							{#each inv.equipo_investigador as m, i (i)}
								<div class="inc-fila">
									<input
										class="inc-input"
										type="text"
										placeholder="Nombre"
										maxlength="160"
										bind:value={m.nombre}
										aria-label="Nombre del integrante {i + 1}"
									/>
									<input
										class="inc-input"
										type="text"
										placeholder="Cargo o rol (jefe inmediato, COPASST, SST…)"
										maxlength="120"
										bind:value={m.cargo}
										aria-label="Cargo del integrante {i + 1}"
									/>
									<button
										type="button"
										class="inc-icono"
										aria-label="Quitar integrante {i + 1}"
										onclick={() =>
											(inv!.equipo_investigador = inv!.equipo_investigador.filter(
												(_, j) => j !== i
											))}
									>
										<X size={15} />
									</button>
								</div>
							{/each}
							<button
								type="button"
								class="inc-agregar"
								onclick={() =>
									(inv!.equipo_investigador = [
										...inv!.equipo_investigador,
										{ nombre: '', cargo: '' }
									])}
							>
								<Plus size={14} /> Agregar integrante
							</button>
						</fieldset>

						<div class="inc-dos">
							<label class="inc-campo">
								<span>Causas inmediatas · actos inseguros</span>
								<textarea
									class="inc-input"
									rows="3"
									bind:value={inv.actos_inseguros}
									placeholder="Lo que hizo o dejó de hacer una persona"
								></textarea>
							</label>
							<label class="inc-campo">
								<span>Causas inmediatas · condiciones inseguras</span>
								<textarea
									class="inc-input"
									rows="3"
									bind:value={inv.condiciones_inseguras}
									placeholder="Estado de la vía, del vehículo, del entorno"
								></textarea>
							</label>
							<label class="inc-campo">
								<span>Causas básicas · factores personales</span>
								<textarea
									class="inc-input"
									rows="3"
									bind:value={inv.factores_personales}
									placeholder="Fatiga, falta de conocimiento, motivación…"
								></textarea>
							</label>
							<label class="inc-campo">
								<span>Causas básicas · factores del trabajo</span>
								<textarea
									class="inc-input"
									rows="3"
									bind:value={inv.factores_trabajo}
									placeholder="Programación, mantenimiento, supervisión, procedimientos…"
								></textarea>
							</label>
						</div>

						<fieldset class="inc-campo inc-campo--ancho">
							<legend>Análisis de porqués</legend>
							{#each inv.analisis_porques as _, i (i)}
								<div class="inc-fila inc-fila--porque">
									<span class="inc-porque-n">¿Por qué? {i + 1}</span>
									<input
										class="inc-input"
										type="text"
										maxlength="1000"
										bind:value={inv.analisis_porques[i]}
										aria-label="Porqué {i + 1}"
									/>
								</div>
							{/each}
							{#if inv.analisis_porques.length < 7}
								<button
									type="button"
									class="inc-agregar"
									onclick={() => (inv!.analisis_porques = [...inv!.analisis_porques, ''])}
								>
									<Plus size={14} /> Otro porqué
								</button>
							{/if}
						</fieldset>

						<label class="inc-campo inc-campo--ancho">
							<span>Causa raíz (conclusión)</span>
							<textarea class="inc-input" rows="2" bind:value={inv.causas_identificadas}></textarea>
						</label>
						<label class="inc-campo inc-campo--ancho">
							<span>Lecciones aprendidas</span>
							<textarea
								class="inc-input"
								rows="2"
								bind:value={inv.lecciones_aprendidas}
								placeholder="Qué se comunica al resto de conductores y procesos"
							></textarea>
						</label>
					</div>
				{:else}
					{@const i = inc.investigacion}
					<dl class="inc-datos">
						<dt>Fecha</dt>
						<dd>{fechaCorta(i.fecha_investigacion)}</dd>
						<dt>Equipo</dt>
						<dd>
							{i.equipo_investigador
								.map((m) => (m.cargo ? `${m.nombre} (${m.cargo})` : m.nombre))
								.join(', ') || '—'}
						</dd>
						<dt>Actos inseguros</dt>
						<dd>{i.actos_inseguros ?? '—'}</dd>
						<dt>Condiciones inseguras</dt>
						<dd>{i.condiciones_inseguras ?? '—'}</dd>
						<dt>Factores personales</dt>
						<dd>{i.factores_personales ?? '—'}</dd>
						<dt>Factores del trabajo</dt>
						<dd>{i.factores_trabajo ?? '—'}</dd>
						<dt>Porqués</dt>
						<dd>
							{#if i.analisis_porques.length}
								<ol class="inc-porques">
									{#each i.analisis_porques as p}<li>{p}</li>{/each}
								</ol>
							{:else}—{/if}
						</dd>
						<dt>Causa raíz</dt>
						<dd>{i.causas_identificadas ?? '—'}</dd>
						<dt>Lecciones aprendidas</dt>
						<dd>{i.lecciones_aprendidas ?? '—'}</dd>
					</dl>
				{/if}
			</section>

			<!-- ── Acciones correctivas ── -->
			<section class="page-card inc-card">
				<div class="inc-card-cab">
					<h2>Acciones correctivas</h2>
					{#if investigacionAbierta && puedeCrearAccion}
						<button class="btn-secondary inc-btn-mini" onclick={() => (modalAccion = true)}
							><Plus size={14} /> Crear o vincular</button
						>
					{/if}
				</div>
				{#if inc.acciones_vinculadas.length === 0}
					<p class="inc-nota">
						{inc.estado === 'REPORTADO'
							? 'Las acciones se registran durante la investigación.'
							: 'Sin acciones. Si la investigación encontró algo que corregir, regístralo aquí: nace en el módulo de acciones correctivas.'}
					</p>
				{:else}
					<ul class="inc-acciones">
						{#each inc.acciones_vinculadas as a (a.id)}
							<li>
								<div>
									<a href="/dashboard/acciones-correctivas/{a.id}"
										><strong>{a.numero}</strong> <ExternalLink size={12} /></a
									>
									<span>{a.descripcion ?? 'Sin descripción'}</span>
									<small>
										{a.tipo
											? `${a.tipo.charAt(0)}${a.tipo.slice(1).toLowerCase()} · `
											: ''}{ESTADO_ACCION[a.estado] ?? a.estado}{a.aprobacion
											? ` · aprobación ${a.aprobacion.toLowerCase()}`
											: ''} · {a.creada_desde_incidente
											? 'creada en esta investigación'
											: 'vinculada'}
									</small>
								</div>
								{#if investigacionAbierta && puedeEscribir}
									<button
										class="inc-icono"
										aria-label="Desvincular {a.numero}"
										onclick={() => desvincular(a.id, a.numero)}
									>
										<Link2Off size={16} />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── Cierre ── -->
			<section class="page-card inc-card">
				<h2>Cierre</h2>
				{#if inc.estado === 'CERRADO'}
					<dl class="inc-datos">
						<dt>Fecha de cierre</dt>
						<dd>{fechaCorta(inc.cierre.fecha_cierre)}</dd>
						<dt>Responsable</dt>
						<dd>{inc.cierre.responsable_cierre ?? '—'}</dd>
						{#if inc.cierre.observaciones_cierre}<dt>Observaciones</dt>
							<dd>{inc.cierre.observaciones_cierre}</dd>{/if}
						<dt>Cerró</dt>
						<dd>{inc.cierre.cerrado_por?.nombre ?? '—'}</dd>
					</dl>
				{:else if investigacionAbierta && puedeEscribir}
					<div class="inc-form">
						<div class="inc-dos">
							<label class="inc-campo">
								<span>Fecha de cierre</span>
								<input
									class="inc-input"
									type="date"
									min={inc.fecha}
									max={hoyColombia()}
									bind:value={cierre.fecha_cierre}
								/>
							</label>
							<label class="inc-campo">
								<span>Responsable del cierre</span>
								<input
									class="inc-input"
									type="text"
									maxlength="255"
									bind:value={cierre.responsable_cierre}
								/>
							</label>
						</div>
						<label class="inc-campo inc-campo--ancho">
							<span>Observaciones</span>
							<textarea
								class="inc-input"
								rows="2"
								maxlength="3000"
								bind:value={cierre.observaciones_cierre}
							></textarea>
						</label>
						{#if faltantes.length}
							<div class="inc-faltan" role="alert">
								<strong>Falta para cerrar:</strong>
								<ul>
									{#each faltantes as f}<li>{f}</li>{/each}
								</ul>
							</div>
						{/if}
						<div>
							<button
								class="btn-primary"
								disabled={cambiando || guardandoInv}
								onclick={cerrarIncidente}
							>
								<ClipboardCheck size={15} /> Cerrar investigación
							</button>
						</div>
					</div>
				{:else}
					<p class="inc-nota">Se cierra cuando la investigación esté completa.</p>
				{/if}
			</section>
		</div>
	</div>

	<ModalReporteIncidente
		open={modalReporte}
		incidente={inc}
		oncerrar={() => (modalReporte = false)}
		onguardado={(d) => {
			modalReporte = false;
			aplicar(d);
		}}
	/>
	<ModalAccionIncidente
		open={modalAccion}
		incidente={inc}
		oncerrar={() => (modalAccion = false)}
		onguardado={(d) => {
			modalAccion = false;
			aplicar(d);
		}}
	/>
{/if}

<style>
	.inc-error {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.inc-error h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	.inc-error p {
		margin: 0;
		color: var(--text-muted);
	}
	.inc-cab {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1.25rem 1.5rem;
	}
	.inc-cab-fila {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.75rem 1.25rem;
	}
	.inc-cab-texto {
		flex: 1;
		min-width: 14rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.inc-volver {
		padding: 6px 12px;
	}
	.inc-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.inc-tipo-punto {
		width: 9px;
		height: 9px;
		border-radius: 999px;
	}
	.inc-cab-acciones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.inc-peligro:hover:not(:disabled) {
		border-color: #dc2626;
		color: #dc2626;
	}
	.inc-plazo {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border-radius: 12px;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.inc-plazo--ok {
		background: #f1f5f4;
		color: var(--text-secondary);
	}
	.inc-plazo--aviso {
		background: #fffbeb;
		color: #92400e;
	}
	.inc-plazo--mal {
		background: #fef2f2;
		color: #991b1b;
	}
	.inc-rejilla {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
		gap: 1rem;
		align-items: start;
	}
	.inc-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	.inc-card--ancha {
		grid-column: 1 / -1;
	}
	.inc-card h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.05rem;
		font-weight: 800;
		color: var(--text-primary);
	}
	.inc-card h3 {
		margin: 0.25rem 0 0;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.inc-card-cab {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.inc-btn-mini {
		padding: 6px 12px;
		font-size: 13px;
		cursor: pointer;
	}
	.inc-deshabilitado {
		opacity: 0.6;
		pointer-events: none;
	}
	.inc-datos {
		display: grid;
		grid-template-columns: minmax(8rem, auto) 1fr;
		gap: 0.4rem 1rem;
		margin: 0;
		font-size: 0.86rem;
	}
	.inc-datos dt {
		color: var(--text-muted);
	}
	.inc-datos dd {
		margin: 0;
		color: var(--text-primary);
		white-space: pre-wrap;
		min-width: 0;
	}
	.inc-datos a,
	.inc-acciones a {
		color: var(--emerald-700);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.inc-victimas {
		margin-left: 6px;
		color: #b42318;
		font-weight: 600;
	}
	.inc-descripcion {
		margin: 0;
		max-width: 44rem;
		padding: 0.75rem 0.9rem;
		border-radius: 12px;
		background: var(--bg-base);
		font-size: 0.88rem;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	.inc-terceros,
	.inc-evidencias,
	.inc-acciones {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.inc-terceros li {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
	}
	.inc-terceros li span {
		color: var(--text-muted);
	}
	.inc-terceros em {
		margin-left: 6px;
		color: #b42318;
		font-style: normal;
		font-weight: 600;
	}
	.inc-evidencias li,
	.inc-acciones li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		color: var(--text-secondary);
	}
	.inc-evidencias li div,
	.inc-acciones li div {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 0.85rem;
	}
	.inc-evidencias strong,
	.inc-acciones strong {
		color: var(--text-primary);
	}
	.inc-evidencias small,
	.inc-acciones small {
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.inc-acciones a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.inc-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 34px;
		height: 34px;
		border-radius: 10px;
		color: var(--text-muted);
	}
	.inc-icono:hover {
		background: var(--bg-base);
		color: var(--text-primary);
	}
	.inc-icono--peligro:hover {
		background: #fef2f2;
		color: #dc2626;
	}
	.inc-nota {
		margin: 0;
		max-width: 44rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.inc-form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.inc-dos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 0.9rem 1rem;
	}
	.inc-campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.inc-campo > span,
	.inc-campo legend {
		padding: 0;
		margin-bottom: 6px;
		font-size: 13px;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.inc-campo--corto {
		max-width: 14rem;
	}
	.inc-input {
		width: 100%;
		min-height: 40px;
		padding: 8px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
	}
	textarea.inc-input {
		resize: vertical;
	}
	.inc-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.inc-fila {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
		gap: 8px;
		align-items: center;
		margin-bottom: 8px;
	}
	.inc-fila--porque {
		grid-template-columns: 6.5rem minmax(0, 1fr);
	}
	.inc-porque-n {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-muted);
	}
	.inc-agregar {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		font-size: 13px;
		font-weight: 600;
		color: var(--emerald-700);
	}
	.inc-porques {
		margin: 0;
		padding-left: 1.1rem;
	}
	.inc-faltan {
		padding: 0.75rem 0.9rem;
		border: 1px solid #fecaca;
		border-radius: 12px;
		background: #fef2f2;
		color: #991b1b;
		font-size: 0.85rem;
	}
	.inc-faltan ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
</style>
