<script lang="ts">
	/**
	 * Certificados tributarios (retefuente, reteica, reteiva) por tercero.
	 *
	 * Misma cáscara que extractos y los directorios (`dir-*` de app.css y
	 * `listing/`): cabecera con conteos que filtran, pestañas, filtros en la URL
	 * y `TablaLista`. Lo que antes eran paneles que reemplazaban la tabla
	 * —el detalle del tercero, el historial— ahora son un modal visor y una
	 * pestaña, así volver no pierde la página ni los filtros.
	 *
	 * «Enviar a todos» manda los filtros al servidor, que resuelve a quién: antes
	 * la pantalla enviaba los ids de la página visible y llegaba solo a diez.
	 */
	import { page } from '$app/state';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef } from '@tanstack/table-core';
	import { Eye, FileArchive, Mail, RefreshCw, Send } from 'lucide-svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import CeldaIdentidad from '$lib/components/listing/CeldaIdentidad.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import ModalVisorCertificados from '$lib/components/certificados/ModalVisorCertificados.svelte';
	import ModalEnviarCertificados from '$lib/components/certificados/ModalEnviarCertificados.svelte';
	import ModalImportarZip from '$lib/components/certificados/ModalImportarZip.svelte';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		limpiar as limpiarFiltrosDe,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { mascota } from '$lib/mascot';
	import { certificadosAdminAPI } from '$lib/api/certificadosAdmin';
	import {
		certificadosTerceroAPI,
		type CertificacionEnvio,
		type FiltrosCertificados,
		type ListadoTercerosCertificados,
		type TerceroWithCerts
	} from '$lib/api/certificadosTercero';
	import {
		etiquetaTipo,
		fechaCorta,
		fechaHora,
		mensajeError,
		resumenCertificados
	} from '$lib/components/certificados/certificados';

	const POR_PAGINA = 20;
	const COLOR_CON_CORREO = 'var(--emerald-500)';
	const COLOR_SIN_CORREO = '#f59e0b';

	// ── Filtros en la URL ────────────────────────────────────────────────
	interface Filtros {
		vista: string;
		q: string;
		anio: number;
		tipo: string;
		correo: string;
		pagina: number;
	}
	const DEFS: DefinicionesFiltros<Filtros> = {
		vista: opcion('terceros'),
		q: texto(),
		anio: numero(0),
		tipo: opcion('todos'),
		correo: opcion('todos'),
		pagina: numero(1)
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state<Filtros>(estadoUrl.leer(page.url));

	$effect(() => {
		estadoUrl.escribir(page.url, filtros);
	});

	function ponerFiltro<K extends keyof Filtros>(clave: K, valor: Filtros[K]) {
		filtros = { ...filtros, [clave]: valor, pagina: 1 };
	}
	function limpiarFiltros() {
		filtros = { ...limpiarFiltrosDe(DEFS, filtros), vista: filtros.vista };
	}
	const hayFiltros = $derived(
		!!filtros.q || filtros.anio !== 0 || filtros.tipo !== 'todos' || filtros.correo !== 'todos'
	);

	/** Lo que entiende el backend; el envío masivo usa los mismos. */
	const filtrosApi = $derived<FiltrosCertificados>({
		search: filtros.q || undefined,
		anio: filtros.anio || undefined,
		tipo: filtros.tipo !== 'todos' ? filtros.tipo : undefined,
		correo: filtros.correo === 'con' || filtros.correo === 'sin' ? filtros.correo : undefined
	});

	// ── Terceros ─────────────────────────────────────────────────────────
	let listado = $state<ListadoTercerosCertificados | null>(null);
	let cargando = $state(true);

	$effect(() => {
		if (filtros.vista !== 'terceros') return;
		const f = filtrosApi;
		const p = filtros.pagina;
		void cargar(f, p);
	});

	async function cargar(f: FiltrosCertificados = filtrosApi, p = filtros.pagina) {
		cargando = true;
		try {
			const res = await certificadosTerceroAPI.getTercerosWithCertificados({
				...f,
				page: p,
				limit: POR_PAGINA
			});
			listado = res.data;
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudieron cargar los terceros'));
		} finally {
			cargando = false;
		}
	}

	const conteos = $derived(listado?.conteos);
	const resumen = $derived([
		{ clave: 'todos', etiqueta: 'Terceros', valor: conteos?.terceros ?? 0 },
		{ clave: 'con', etiqueta: 'Con correo', valor: conteos?.con_correo ?? 0, color: COLOR_CON_CORREO },
		{ clave: 'sin', etiqueta: 'Sin correo', valor: conteos?.sin_correo ?? 0, color: COLOR_SIN_CORREO },
		{ clave: 'certificados', etiqueta: 'Certificados', valor: conteos?.certificados ?? 0 }
	]);
	function elegirConteo(clave: string) {
		if (clave !== 'con' && clave !== 'sin') return;
		ponerFiltro('correo', filtros.correo === clave ? 'todos' : clave);
	}

	const segmentosTipo = $derived([
		{ valor: 'todos', etiqueta: 'Todos' },
		...(listado?.tipos ?? []).map((t) => ({ valor: t, etiqueta: etiquetaTipo(t) }))
	]);

	const COLUMNAS: ColumnDef<TerceroWithCerts, any>[] = [
		{ id: 'tercero', header: 'Tercero', enableSorting: false },
		{ id: 'nit', header: 'NIT', enableSorting: false, size: 140 },
		{ id: 'certificados', header: 'Certificados', enableSorting: false },
		{ id: 'envio', header: 'Último envío', enableSorting: false, size: 200 },
		{ id: 'acciones', header: '', enableSorting: false, size: 90 }
	];

	// ── Historial de envíos ──────────────────────────────────────────────
	let envios = $state<CertificacionEnvio[]>([]);
	let totalEnvios = $state(0);
	let cargandoEnvios = $state(false);

	$effect(() => {
		if (filtros.vista !== 'envios') return;
		void cargarEnvios(filtros.pagina);
	});

	async function cargarEnvios(p: number) {
		cargandoEnvios = true;
		try {
			const res = await certificadosTerceroAPI.getEnvios({ page: p, limit: POR_PAGINA });
			envios = res.data.envios ?? [];
			totalEnvios = res.data.total ?? envios.length;
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudo cargar el historial'));
		} finally {
			cargandoEnvios = false;
		}
	}

	const COLUMNAS_ENVIO: ColumnDef<CertificacionEnvio, any>[] = [
		{ id: 'fecha', header: 'Fecha', enableSorting: false, size: 190 },
		{ id: 'tercero', header: 'Tercero', enableSorting: false },
		{ id: 'destino', header: 'Enviado a', enableSorting: false },
		{ id: 'tipo', header: 'Envío', enableSorting: false, size: 130 }
	];

	// ── Modales y acciones ───────────────────────────────────────────────
	let visor = $state<TerceroWithCerts | null>(null);
	let modalVisor = $state(false);
	let modoEnvio = $state<
		| { tipo: 'individual'; tercero: TerceroWithCerts }
		| { tipo: 'masivo'; filtros: FiltrosCertificados; destinatarios: number; descripcion: string }
		| null
	>(null);
	let modalEnvio = $state(false);
	let modalZip = $state(false);
	let sincronizando = $state(false);

	function abrirVisor(t: TerceroWithCerts) {
		visor = t;
		modalVisor = true;
	}

	function abrirEnvio(t: TerceroWithCerts) {
		modoEnvio = { tipo: 'individual', tercero: t };
		modalVisor = false;
		modalEnvio = true;
	}

	/** «retefuente de 2025 y “garcía”»: qué filtros recibe el envío masivo. */
	const descripcionFiltros = $derived(
		[
			filtros.tipo !== 'todos' ? etiquetaTipo(filtros.tipo).toLowerCase() : null,
			filtros.anio ? `año ${filtros.anio}` : null,
			filtros.q ? `«${filtros.q}»` : null
		]
			.filter(Boolean)
			.join(', ')
	);

	/// Con «sin correo» activo no hay a quién enviar; el conteo «con correo»
	/// ya respeta búsqueda, año y tipo.
	const destinatariosMasivo = $derived(filtros.correo === 'sin' ? 0 : (conteos?.con_correo ?? 0));

	function abrirMasivo() {
		modoEnvio = {
			tipo: 'masivo',
			filtros: { ...filtrosApi, correo: undefined },
			destinatarios: destinatariosMasivo,
			descripcion: descripcionFiltros
		};
		modalEnvio = true;
	}

	async function sincronizar() {
		sincronizando = true;
		try {
			const res = await certificadosAdminAPI.syncS3();
			toast.success('Sincronización completa', {
				description: `${res.data.created} nuevos · ${res.data.linked} vinculados a su tercero`
			});
			await cargar();
		} catch (err) {
			toast.error('No se pudo sincronizar', { description: mensajeError(err, 'Error') });
		} finally {
			sincronizando = false;
		}
	}

	function refrescarTrasEnvio() {
		if (filtros.vista === 'envios') void cargarEnvios(filtros.pagina);
		else void cargar();
	}
</script>

<svelte:head>
	<title>Certificados tributarios · Cotransmeq</title>
</svelte:head>

<div class="dir-pagina" in:fade={{ duration: 400 }}>
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Certificados tributarios</h1>
			<p class="dir-desc">
				Retefuente, reteica y reteiva por tercero. Cada tercero los consulta en el portal con el
				enlace que le llega al correo.
			</p>
			{#if filtros.vista === 'terceros'}
				<div class="dir-conteos">
					<ResumenConteos
						conteos={resumen}
						activo={filtros.correo !== 'todos' ? filtros.correo : null}
						onElegir={elegirConteo}
					/>
				</div>
			{/if}
		</div>
		<div class="dir-cabecera-acciones">
			<button
				type="button"
				class="btn-secondary"
				onclick={sincronizar}
				disabled={sincronizando}
				title="Registra los archivos que ya están en el bucket y los vincula a su tercero por NIT"
			>
				<RefreshCw size={15} class={sincronizando ? 'cert-girando' : ''} />
				{sincronizando ? 'Sincronizando…' : 'Sincronizar'}
			</button>
			<button
				type="button"
				class="btn-secondary"
				onclick={abrirMasivo}
				disabled={filtros.vista !== 'terceros' || destinatariosMasivo === 0}
				title={destinatariosMasivo === 0
					? 'Ningún tercero filtrado tiene correo'
					: 'Envía el enlace a todos los terceros filtrados con correo'}
			>
				<Send size={15} />
				Enviar a {destinatariosMasivo}
			</button>
			<button type="button" class="btn-primary" onclick={() => (modalZip = true)}>
				<FileArchive size={16} strokeWidth={2.2} />
				Importar ZIP
			</button>
		</div>
	</header>

	<div in:fly={{ y: 12, duration: 400, delay: 60 }}>
		<TabsVista
			tabs={[
				{ id: 'terceros', label: 'Terceros', cuenta: conteos?.terceros ?? null },
				{ id: 'envios', label: 'Historial de envíos', cuenta: totalEnvios || null }
			]}
			activa={filtros.vista}
			etiqueta="Vistas de certificados"
			onCambiar={(v) => (filtros = { ...filtros, vista: v, pagina: 1 })}
		/>
	</div>

	{#if filtros.vista === 'terceros'}
		<div class="dir-filtros" in:fly={{ y: 12, duration: 300 }}>
			<div class="dir-filtros-buscador">
				<BuscadorLista
					bind:valor={filtros.q}
					onBuscar={(t) => ponerFiltro('q', t)}
					placeholder="Nombre, NIT o correo…"
					etiqueta="Buscar terceros"
				/>
			</div>
			{#if segmentosTipo.length > 2}
				<SegmentosFiltro
					etiqueta="Tipo"
					opciones={segmentosTipo}
					valor={filtros.tipo}
					onCambiar={(v) => ponerFiltro('tipo', v)}
				/>
			{/if}
			<label class="cert-anio">
				<span>Año</span>
				<select
					value={String(filtros.anio)}
					onchange={(e) => ponerFiltro('anio', Number((e.currentTarget as HTMLSelectElement).value))}
				>
					<option value="0">Todos</option>
					{#each listado?.anios ?? [] as a (a)}<option value={String(a)}>{a}</option>{/each}
				</select>
			</label>
			{#if hayFiltros}
				<button type="button" class="btn-secondary" onclick={limpiarFiltros}>Limpiar</button>
			{/if}
		</div>

		<div class="dir-lista" in:fly={{ y: 12, duration: 300, delay: 60 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS}
					datos={listado?.terceros ?? []}
					claveFila={(t) => t.id}
					{cargando}
					onFila={abrirVisor}
					etiqueta="Terceros con certificados"
				>
					{#snippet celda({ columnaId, fila: t })}
						{#if columnaId === 'tercero'}
							<CeldaIdentidad
								titulo={t.nombre_completo}
								subtitulo={t.correo || 'Sin correo registrado'}
								punto={t.correo ? COLOR_CON_CORREO : COLOR_SIN_CORREO}
							/>
						{:else if columnaId === 'nit'}
							<span class="cert-nit">{t.identificacion ?? '—'}</span>
						{:else if columnaId === 'certificados'}
							{@const etiquetas = resumenCertificados(t.certificados_archivo)}
							<div class="cert-chips">
								{#each etiquetas.slice(0, 3) as e (e)}<span class="cert-chip">{e}</span>{/each}
								{#if etiquetas.length > 3}
									<span class="cert-chip cert-chip--mas">+{etiquetas.length - 3}</span>
								{/if}
							</div>
						{:else if columnaId === 'envio'}
							{#if t.ultimo_envio}
								<div class="dir-celda dir-celda--fecha">
									<span>{fechaCorta(t.ultimo_envio.emitido_at)}</span>
									<small>{t.ultimo_envio.email_destino}</small>
								</div>
							{:else}
								<EstadoPunto etiqueta="Nunca enviado" color="#94a3b8" apagado />
							{/if}
						{:else if columnaId === 'acciones'}
							<AccionesFila
								acciones={[
									{
										id: 'enviar',
										etiqueta: 'Enviar por correo',
										icono: Mail,
										onClick: () => abrirEnvio(t),
										oculta: !t.correo
									},
									{ id: 'ver', etiqueta: 'Ver certificados', icono: Eye, onClick: () => abrirVisor(t) }
								]}
							/>
						{/if}
					{/snippet}
					{#snippet vacio()}
						{@const img = mascota(hayFiltros ? 'vacio' : 'exito')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>{hayFiltros ? 'Sin resultados' : 'Todavía no hay certificados'}</h3>
							<p>
								{hayFiltros
									? 'Ningún tercero coincide con estos filtros.'
									: 'Importa el ZIP del año o sincroniza el bucket para traer los que ya están subidos.'}
							</p>
							{#if hayFiltros}
								<button type="button" class="btn-secondary" onclick={limpiarFiltros}
									>Limpiar filtros</button
								>
							{:else}
								<button type="button" class="btn-primary" onclick={() => (modalZip = true)}
									><FileArchive size={16} /> Importar ZIP</button
								>
							{/if}
						</div>
					{/snippet}
				</TablaLista>
			</div>
			<PaginadorLista
				pagina={filtros.pagina}
				total={listado?.total ?? 0}
				porPagina={POR_PAGINA}
				{cargando}
				nombreItems="terceros"
				onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
			/>
		</div>
	{:else}
		<div class="dir-lista" in:fly={{ y: 12, duration: 300 }}>
			<div class="dir-lista-scroll">
				<TablaLista
					columnas={COLUMNAS_ENVIO}
					datos={envios}
					claveFila={(e) => e.id}
					cargando={cargandoEnvios}
					etiqueta="Historial de envíos de certificados"
				>
					{#snippet celda({ columnaId, fila: e })}
						{#if columnaId === 'fecha'}
							<span class="dir-celda--fecha">{fechaHora(e.emitido_at)}</span>
						{:else if columnaId === 'tercero'}
							<div class="dir-celda">
								<span>{e.tercero?.nombre_completo ?? '—'}</span>
								<small>NIT {e.tercero?.identificacion ?? '—'}</small>
							</div>
						{:else if columnaId === 'destino'}
							<span class="cert-correo">{e.email_destino}</span>
						{:else if columnaId === 'tipo'}
							<EstadoPunto
								etiqueta={e.tipo_envio === 'masivo' ? 'Masivo' : 'Individual'}
								color={e.tipo_envio === 'masivo' ? '#6366f1' : COLOR_CON_CORREO}
							/>
						{/if}
					{/snippet}
					{#snippet vacio()}
						{@const img = mascota('vacio')}
						<div class="dir-vacio">
							<img src={img.src} alt={img.alt} width="418" height="418" />
							<h3>Sin envíos todavía</h3>
							<p>Cada correo con certificados queda registrado aquí, con su destino y su fecha.</p>
						</div>
					{/snippet}
				</TablaLista>
			</div>
			<PaginadorLista
				pagina={filtros.pagina}
				total={totalEnvios}
				porPagina={POR_PAGINA}
				cargando={cargandoEnvios}
				nombreItems="envíos"
				onCambiar={(p) => (filtros = { ...filtros, pagina: p })}
			/>
		</div>
	{/if}
</div>

<ModalVisorCertificados
	open={modalVisor}
	tercero={visor}
	oncerrar={() => (modalVisor = false)}
	onenviar={abrirEnvio}
/>

<ModalEnviarCertificados
	open={modalEnvio}
	modo={modoEnvio}
	oncerrar={() => (modalEnvio = false)}
	onenviado={refrescarTrasEnvio}
/>

<ModalImportarZip open={modalZip} oncerrar={() => (modalZip = false)} onimportado={() => cargar()} />

<style>
	.cert-anio {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.cert-anio select {
		padding: 0.4rem 0.6rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font: inherit;
		font-size: 0.82rem;
	}
	.cert-nit {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.82rem;
		letter-spacing: 0.02em;
		color: var(--text-secondary);
	}
	.cert-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.cert-chip {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--bg-base);
		border: 1px solid var(--border-subtle);
		font-size: 0.74rem;
		font-weight: 600;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.cert-chip--mas {
		color: var(--text-muted);
	}
	.cert-correo {
		font-size: 0.84rem;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	:global(.cert-girando) {
		animation: cert-giro 0.9s linear infinite;
	}
	@keyframes cert-giro {
		to {
			transform: rotate(360deg);
		}
	}
</style>
