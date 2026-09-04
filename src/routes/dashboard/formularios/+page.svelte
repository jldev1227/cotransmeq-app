<!--
	Formularios dinámicos: catálogo y envíos en la MISMA pantalla.

	Antes eran dos rutas. `/formularios` listaba los formatos y `/formularios/envios`
	los registros diligenciados, y quien gestiona el módulo saltaba entre las dos
	todo el día: el formato y lo que la gente contestó con él no son dos temas, son
	el mismo visto desde dos lados. La lista de envíos vive ahora aquí, con sus
	filtros completos, detrás de una pestaña que se puede enlazar (`?vista=envios`).

	Las dos vistas comparten cabecera y métricas, y **los envíos se cargan solo
	cuando se abre su pestaña**: el catálogo lee metadatos y la lista de envíos
	recorre `form_submissions`, que es una consulta de otro coste. Pagarla al
	entrar penalizaría a quien solo viene a publicar una versión.

	Muestra, por formulario, su versión publicada Y su borrador. Las dos a la vez
	porque son estados independientes: se puede estar editando la v3 mientras los
	conductores siguen diligenciando la v2, y ocultar una de las dos haría creer que
	un cambio ya está en la calle cuando no lo está.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import {
		bandera,
		numero,
		opcion,
		texto,
		type DefinicionesFiltros
	} from '$lib/listing/filtros';
	import { onMount } from 'svelte';
	import { fechaDeFormularioDe } from '$lib/formularios/fecha-diligenciamiento';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import {
		asignacionesFormularioAPI,
		enviosFormularioAPI,
		formulariosAPI,
		FormApiError,
		type FiltrosEnvios
	} from '$lib/api/formularios';
	import {
		SUBMISSION_STATUS_LABELS,
		type FormDefinitionDto,
		type SubmissionStatus,
		type SubmissionSummaryDto
	} from '$lib/formularios/types';
	import CabeceraFormularios from '$lib/components/formularios/CabeceraFormularios.svelte';
	import MisFormularios from '$lib/components/formularios/MisFormularios.svelte';
	import TarjetasMetricas from '$lib/components/formularios/TarjetasMetricas.svelte';
	import type { Metrica } from '$lib/components/formularios/TarjetasMetricas.svelte';

	/**
	 * Tres vistas del módulo.
	 *
	 * `mis-formularios` no es una vista de gestión sino el diligenciamiento
	 * propio, y está aquí por comodidad de quien gestiona el módulo. La ruta que
	 * de verdad habilita la función es `/dashboard/mis-formularios`, que tiene
	 * permiso `general: true` y por tanto alcanza a las áreas que NO pueden
	 * entrar a esta pantalla —contabilidad, mantenimiento, talento humano—, que
	 * son justamente a quienes hay que poder asignarles un formato.
	 */
	type Vista = 'catalogo' | 'envios' | 'mis-formularios';

	const VISTAS: Vista[] = ['catalogo', 'envios', 'mis-formularios'];

	let vista = $state<Vista>('catalogo');

	// ── Catálogo ───────────────────────────────────────────────────────────────

	let formularios = $state<FormDefinitionDto[]>([]);
	let cargando = $state(true);
	let busqueda = $state('');
	let incluirArchivados = $state(false);
	let pagina = $state(1);
	let totalPages = $state(1);
	let total = $state(0);

	let modalCrear = $state(false);
	let creando = $state(false);
	let nuevoCode = $state('');
	let nuevoNombre = $state('');
	let nuevoDescripcion = $state('');

	/// Debounce de la búsqueda: teclear "preoperacional" son 15 peticiones sin él.
	let timerBusqueda: ReturnType<typeof setTimeout> | null = null;

	// ── Envíos ─────────────────────────────────────────────────────────────────

	let envios = $state<SubmissionSummaryDto[]>([]);
	let cargandoEnvios = $state(false);
	let enviosCargadosAlguna = $state(false);
	let exportando = $state(false);
	let paginaEnvios = $state(1);
	let totalPagesEnvios = $state(1);
	let totalEnvios = $state(0);

	let filtroFormId = $state('');
	let filtroVersionId = $state('');
	let filtroAssignmentId = $state('');
	let filtroAssignmentNombre = $state('');
	let filtroEstado = $state<SubmissionStatus | ''>('');
	let filtroBusqueda = $state('');
	let filtroDesde = $state('');
	let filtroHasta = $state('');

	let timerBusquedaEnvios: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Catálogo completo para el selector de la lista de envíos y para la métrica
	 * de publicados.
	 *
	 * Es una petición aparte de la paginada de arriba: el catálogo se filtra y se
	 * pagina de 20 en 20, y el selector necesita todos los formatos aunque el
	 * usuario esté buscando «preoperacional».
	 */
	let catalogoTotal = $state<FormDefinitionDto[]>([]);
	let catalogoTotalCompleto = $state(true);

	/// Las versiones del formulario elegido: sin filtrar por versión no se pueden
	/// desplegar las respuestas en el CSV.
	const versionesDisponibles = $derived(
		catalogoTotal.find((f) => f.id === filtroFormId)?.versions ?? []
	);

	// ── Métricas ───────────────────────────────────────────────────────────────

	const DIAS_PERIODO = 30;

	/// Fecha de negocio en horario LOCAL, no `toISOString()`: en Bogotá (UTC-5) el
	/// UTC de las 7 p. m. ya es el día siguiente, y el período saldría corrido.
	function fechaLocal(d: Date): string {
		const mes = String(d.getMonth() + 1).padStart(2, '0');
		const dia = String(d.getDate()).padStart(2, '0');
		return `${d.getFullYear()}-${mes}-${dia}`;
	}

	const desdePeriodo = fechaLocal(new Date(Date.now() - (DIAS_PERIODO - 1) * 86400000));

	let cargandoMetricas = $state(true);
	let mPublicados = $state<number | null>(null);
	let mCatalogo = $state<number | null>(null);
	let mAsignacionesActivas = $state<number | null>(null);
	let mEntregados = $state<number | null>(null);
	let mBorradores = $state<number | null>(null);
	let mAnulados = $state<number | null>(null);

	const metricas = $derived<Metrica[]>([
		{
			id: 'publicados',
			etiqueta: 'Publicados',
			valor: mPublicados,
			detalle: mCatalogo == null ? null : `de ${mCatalogo} en el catálogo`,
			tono: 'emerald'
		},
		{
			id: 'asignaciones',
			etiqueta: 'Asignaciones activas',
			valor: mAsignacionesActivas,
			detalle: 'formatos en la calle ahora',
			tono: 'indigo'
		},
		{
			id: 'entregados',
			etiqueta: `Entregados · ${DIAS_PERIODO} d`,
			valor: mEntregados,
			detalle: `desde el ${desdePeriodo}`,
			tono: 'cyan',
			activa: vista === 'envios' && filtroEstado === 'SUBMITTED' && filtroDesde === desdePeriodo,
			onactivar: () => filtrarEnvios({ estado: 'SUBMITTED', desde: desdePeriodo })
		},
		{
			id: 'borradores',
			etiqueta: 'Borradores en curso',
			valor: mBorradores,
			detalle: 'empezados y sin entregar',
			tono: 'ambar',
			activa: vista === 'envios' && filtroEstado === 'DRAFT' && !filtroDesde,
			onactivar: () => filtrarEnvios({ estado: 'DRAFT', desde: '' })
		},
		{
			id: 'anulados',
			etiqueta: `Anulados · ${DIAS_PERIODO} d`,
			valor: mAnulados,
			detalle: `desde el ${desdePeriodo}`,
			tono: 'rojo',
			activa: vista === 'envios' && filtroEstado === 'VOIDED' && filtroDesde === desdePeriodo,
			onactivar: () => filtrarEnvios({ estado: 'VOIDED', desde: desdePeriodo })
		}
	]);

	/**
	 * Contadores del período.
	 *
	 * Cada uno es un `count` real del backend pedido con `limit: 1`: se lee
	 * `meta.total`, no la longitud de la página. `allSettled` en vez de `all`
	 * porque si falla el contador de anulados el resto de la fila sigue siendo
	 * cierto; el que falla se queda en `null` y la tarjeta pinta «—».
	 */
	async function cargarMetricas() {
		cargandoMetricas = true;

		const [catalogo, activas, entregados, borradores, anulados] = await Promise.allSettled([
			formulariosAPI.listar({ limit: 100 }),
			asignacionesFormularioAPI.listar({ status: 'ACTIVE', limit: 1 }),
			enviosFormularioAPI.listar({ status: 'SUBMITTED', businessDateFrom: desdePeriodo, limit: 1 }),
			enviosFormularioAPI.listar({ status: 'DRAFT', limit: 1 }),
			enviosFormularioAPI.listar({ status: 'VOIDED', businessDateFrom: desdePeriodo, limit: 1 })
		]);

		if (catalogo.status === 'fulfilled') {
			catalogoTotal = catalogo.value.data;
			mCatalogo = catalogo.value.meta?.total ?? catalogo.value.data.length;
			/// El endpoint no filtra por «tiene versión publicada», así que se cuenta
			/// sobre lo traído. Si el catálogo pasa de 100 formatos la cuenta sería
			/// parcial: se avisa en la tarjeta en vez de dar un número engañoso.
			catalogoTotalCompleto = catalogo.value.data.length >= (mCatalogo ?? 0);
			mPublicados = catalogo.value.data.filter((f) => f.activeVersion != null).length;
		}
		if (activas.status === 'fulfilled') mAsignacionesActivas = activas.value.meta?.total ?? null;
		if (entregados.status === 'fulfilled') mEntregados = entregados.value.meta?.total ?? null;
		if (borradores.status === 'fulfilled') mBorradores = borradores.value.meta?.total ?? null;
		if (anulados.status === 'fulfilled') mAnulados = anulados.value.meta?.total ?? null;

		cargandoMetricas = false;
	}

	// ── Carga ──────────────────────────────────────────────────────────────────

	async function cargar() {
		cargando = true;
		try {
			const { data, meta } = await formulariosAPI.listar({
				page: pagina,
				limit: 20,
				search: busqueda.trim() || undefined,
				includeDeleted: incluirArchivados || undefined
			});
			formularios = data;
			total = meta.total ?? 0;
			totalPages = meta.totalPages ?? 1;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo cargar el catálogo.');
		} finally {
			cargando = false;
		}
	}

	function filtrosEnvios(): FiltrosEnvios {
		return {
			page: paginaEnvios,
			limit: 25,
			formId: filtroFormId || undefined,
			versionId: filtroVersionId || undefined,
			assignmentId: filtroAssignmentId || undefined,
			status: filtroEstado || undefined,
			search: filtroBusqueda.trim() || undefined,
			businessDateFrom: filtroDesde || undefined,
			businessDateTo: filtroHasta || undefined
		};
	}

	async function cargarEnvios() {
		cargandoEnvios = true;
		try {
			const { data, meta } = await enviosFormularioAPI.listar(filtrosEnvios());
			envios = data;
			totalEnvios = meta.total ?? 0;
			totalPagesEnvios = meta.totalPages ?? 1;
			enviosCargadosAlguna = true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudieron cargar los envíos.');
		} finally {
			cargandoEnvios = false;
		}
	}

	onMount(async () => {
		/// La pestaña y los filtros viven en la URL: así el enlace «ver los envíos
		/// de esta asignación» sigue siendo un enlace, y la pantalla se puede
		/// compartir tal cual está.
		const desdeUrl = estadoUrl.leer(page.url);
		vista = VISTAS.includes(desdeUrl.vista as Vista) ? (desdeUrl.vista as Vista) : 'catalogo';
		filtroFormId = desdeUrl.formId;
		filtroVersionId = desdeUrl.versionId;
		filtroAssignmentId = desdeUrl.assignmentId;
		filtroEstado = desdeUrl.estado as SubmissionStatus | '';
		filtroBusqueda = desdeUrl.q;
		filtroDesde = desdeUrl.desde;
		filtroHasta = desdeUrl.hasta;

		/// Lo que faltaba: el catálogo también restaura su estado. Antes se
		/// perdían al recargar y la pantalla volvía sin filtrar.
		busqueda = desdeUrl.cat_q;
		pagina = Math.max(1, desdeUrl.cat_pagina);
		incluirArchivados = desdeUrl.archivados;

		void cargar();
		void cargarMetricas();
		if (filtroAssignmentId) void nombrarAsignacion(filtroAssignmentId);
		if (vista === 'envios') void cargarEnvios();
	});

	/// El filtro por asignación llega como uuid desde el listado de asignaciones.
	/// Un uuid crudo en un chip no le dice nada a nadie, así que se resuelve su
	/// nombre; si falla, el chip enseña el uuid recortado y el filtro sigue vivo.
	async function nombrarAsignacion(id: string) {
		try {
			const a = await asignacionesFormularioAPI.obtener(id);
			filtroAssignmentNombre = a.name;
		} catch {
			filtroAssignmentNombre = `${id.slice(0, 8)}…`;
		}
	}

	// ── Sincronía con la URL ───────────────────────────────────────────────────

	/**
	 * Estado completo de la página como filtros.
	 *
	 * La vista de ENVÍOS ya viajaba en la URL —y bien—. Lo que faltaba era el
	 * CATÁLOGO: su búsqueda, su página y el conmutador de archivados se
	 * quedaban en memoria, así que recargar el catálogo filtrado lo devolvía
	 * sin filtrar.
	 *
	 * Los nombres de los parámetros que ya existían no se tocan, para no romper
	 * enlaces guardados.
	 */
	const DEFS_URL: DefinicionesFiltros<{
		vista: string;
		formId: string;
		versionId: string;
		assignmentId: string;
		estado: string;
		q: string;
		desde: string;
		hasta: string;
		cat_q: string;
		cat_pagina: number;
		archivados: boolean;
	}> = {
		vista: opcion('catalogo'),
		formId: texto(),
		versionId: texto(),
		assignmentId: texto(),
		estado: opcion(''),
		q: texto(),
		desde: texto(),
		hasta: texto(),
		/// Prefijados para no chocar con los de la vista de envíos, que usan
		/// `q` a secas.
		cat_q: texto(),
		cat_pagina: numero(1),
		archivados: bandera(false)
	};

	const estadoUrl = crearEstadoUrl(DEFS_URL);

	function sincronizarUrl() {
		estadoUrl.escribir(page.url, {
			vista,
			formId: filtroFormId,
			versionId: filtroVersionId,
			assignmentId: filtroAssignmentId,
			estado: filtroEstado,
			q: filtroBusqueda.trim(),
			desde: filtroDesde,
			hasta: filtroHasta,
			cat_q: busqueda.trim(),
			cat_pagina: pagina,
			archivados: incluirArchivados
		});
	}

	/// El catálogo también sincroniza: antes solo lo hacían los envíos.
	$effect(() => {
		void busqueda;
		void pagina;
		void incluirArchivados;
		sincronizarUrl();
	});

	function cambiarVista(destino: Vista) {
		vista = destino;
		if (destino === 'envios' && !enviosCargadosAlguna) void cargarEnvios();
		sincronizarUrl();
	}

	/** Salta a la pestaña de envíos con un filtro concreto puesto. */
	function filtrarEnvios(f: { estado: SubmissionStatus | ''; desde: string }) {
		const yaEstaba = vista === 'envios' && filtroEstado === f.estado && filtroDesde === f.desde;
		/// Segundo clic sobre la misma tarjeta = quitar el filtro. Es lo que espera
		/// quien la usa como interruptor, y sin ello no hay forma de volver a
		/// «todos» sin buscar el selector.
		filtroEstado = yaEstaba ? '' : f.estado;
		filtroDesde = yaEstaba ? '' : f.desde;
		filtroHasta = '';
		paginaEnvios = 1;
		vista = 'envios';
		sincronizarUrl();
		void cargarEnvios();
	}

	function limpiarFiltrosEnvios() {
		filtroFormId = '';
		filtroVersionId = '';
		filtroAssignmentId = '';
		filtroAssignmentNombre = '';
		filtroEstado = '';
		filtroBusqueda = '';
		filtroDesde = '';
		filtroHasta = '';
		paginaEnvios = 1;
		sincronizarUrl();
		void cargarEnvios();
	}

	const hayFiltrosEnvios = $derived(
		Boolean(
			filtroFormId ||
			filtroVersionId ||
			filtroAssignmentId ||
			filtroEstado ||
			filtroBusqueda ||
			filtroDesde ||
			filtroHasta
		)
	);

	// ── Interacciones del catálogo ─────────────────────────────────────────────

	function onBuscar(valor: string) {
		busqueda = valor;
		pagina = 1;
		if (timerBusqueda) clearTimeout(timerBusqueda);
		timerBusqueda = setTimeout(cargar, 350);
	}

	function cambiarFiltroEnvios(fn: () => void) {
		fn();
		paginaEnvios = 1;
		sincronizarUrl();
		void cargarEnvios();
	}

	function onBuscarEnvios(valor: string) {
		filtroBusqueda = valor;
		paginaEnvios = 1;
		if (timerBusquedaEnvios) clearTimeout(timerBusquedaEnvios);
		timerBusquedaEnvios = setTimeout(() => {
			sincronizarUrl();
			void cargarEnvios();
		}, 350);
	}

	/// El slug se deriva del nombre; el código lo escribe HSEQ porque es
	/// documental (`HSEQ-FR-08`) y no se puede inventar.
	const slugPropuesto = $derived(
		nuevoNombre
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
	);

	async function crear() {
		if (!nuevoCode.trim() || !nuevoNombre.trim()) {
			toast.error('El código y el nombre son obligatorios.');
			return;
		}
		creando = true;
		try {
			const creado = await formulariosAPI.crear({
				code: nuevoCode.trim(),
				name: nuevoNombre.trim(),
				description: nuevoDescripcion.trim() || null
			});
			toast.success(`${creado.code} creado. Se abrió su borrador v1.`);
			const draft = creado.draftVersion;
			if (draft) await goto(`/dashboard/formularios/${creado.id}/editar/${draft.id}`);
			else await goto(`/dashboard/formularios/${creado.id}`);
		} catch (err) {
			if (err instanceof FormApiError && err.code === 'FORM_CODE_TAKEN') {
				toast.error(err.message);
			} else {
				toast.error(err instanceof Error ? err.message : 'No se pudo crear el formulario.');
			}
		} finally {
			creando = false;
		}
	}

	async function archivar(form: FormDefinitionDto) {
		if (
			!confirm(
				`Archivar «${form.code} — ${form.name}»? Los envíos históricos se conservan y el formulario deja de aparecer en el catálogo.`
			)
		)
			return;
		try {
			await formulariosAPI.archivar(form.id);
			toast.success('Formulario archivado.');
			await Promise.all([cargar(), cargarMetricas()]);
		} catch (err) {
			if (err instanceof FormApiError && err.code === 'FORM_HAS_ACTIVE_ASSIGNMENTS') {
				toast.error(err.message);
			} else {
				toast.error('No se pudo archivar.');
			}
		}
	}

	async function restaurar(form: FormDefinitionDto) {
		try {
			await formulariosAPI.restaurar(form.id);
			toast.success('Formulario restaurado.');
			await Promise.all([cargar(), cargarMetricas()]);
		} catch {
			toast.error('No se pudo restaurar.');
		}
	}

	async function exportar() {
		exportando = true;
		try {
			const blob = await enviosFormularioAPI.exportarCsv({
				...filtrosEnvios(),
				page: 1,
				limit: 100
			});
			/// Descarga con `URL.createObjectURL` y revocación inmediata: sin revocar,
			/// cada export deja el blob en memoria hasta recargar la página.
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `envios-formularios-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			if (!filtroVersionId) {
				toast.info('Sin filtrar por versión, el CSV trae solo la cabecera de cada envío.');
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo exportar.');
		} finally {
			exportando = false;
		}
	}

	function fecha(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}

	function fechaHora(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	/// Flechas entre pestañas: es lo que espera un lector de pantalla de un
	/// `tablist`, y el Tab solo no da la vuelta. Con tres pestañas el recorrido
	/// tiene que ser circular en los dos sentidos, no un simple alternar.
	function navegarPestanas(e: KeyboardEvent) {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		e.preventDefault();
		const paso = e.key === 'ArrowRight' ? 1 : -1;
		const destino = VISTAS[(VISTAS.indexOf(vista) + paso + VISTAS.length) % VISTAS.length];
		cambiarVista(destino);
		document.getElementById(`pestana-${destino}`)?.focus();
	}
</script>

<svelte:head><title>Formularios · Cotransmeq</title></svelte:head>

<div class="pagina">
	<CabeceraFormularios
		titulo="Formularios dinámicos"
		subtitulo="Constructor de formatos HSEQ, asignaciones y registros diligenciados por los conductores."
	>
		{#snippet acciones()}
			<a class="btn" href="/dashboard/formularios/asignaciones">Asignaciones</a>
			<button type="button" class="btn btn--primario" onclick={() => (modalCrear = true)}>
				+ Nuevo formulario
			</button>
		{/snippet}
	</CabeceraFormularios>

	<TarjetasMetricas {metricas} cargando={cargandoMetricas} />

	{#if !catalogoTotalCompleto}
		<p class="aviso">
			El catálogo pasa de 100 formatos: «Publicados» cuenta sobre los 100 primeros.
		</p>
	{/if}

	<div class="pestanas" role="tablist" aria-label="Vistas del módulo">
		<button
			type="button"
			id="pestana-catalogo"
			class="pestana"
			class:pestana--on={vista === 'catalogo'}
			role="tab"
			aria-selected={vista === 'catalogo'}
			aria-controls="panel-catalogo"
			tabindex={vista === 'catalogo' ? 0 : -1}
			onclick={() => cambiarVista('catalogo')}
			onkeydown={navegarPestanas}
		>
			Catálogo
			<span class="pestana__cuenta">{total}</span>
		</button>
		<button
			type="button"
			id="pestana-envios"
			class="pestana"
			class:pestana--on={vista === 'envios'}
			role="tab"
			aria-selected={vista === 'envios'}
			aria-controls="panel-envios"
			tabindex={vista === 'envios' ? 0 : -1}
			onclick={() => cambiarVista('envios')}
			onkeydown={navegarPestanas}
		>
			Envíos
			{#if enviosCargadosAlguna}<span class="pestana__cuenta">{totalEnvios}</span>{/if}
		</button>
		<button
			type="button"
			id="pestana-mis-formularios"
			class="pestana"
			class:pestana--on={vista === 'mis-formularios'}
			role="tab"
			aria-selected={vista === 'mis-formularios'}
			aria-controls="panel-mis-formularios"
			tabindex={vista === 'mis-formularios' ? 0 : -1}
			onclick={() => cambiarVista('mis-formularios')}
			onkeydown={navegarPestanas}
		>
			Mis formularios
		</button>
	</div>

	{#if vista === 'catalogo'}
		<div
			id="panel-catalogo"
			role="tabpanel"
			aria-labelledby="pestana-catalogo"
			class="panel"
			tabindex="0"
		>
			<div class="filtros">
				<label class="filtros__buscar">
					<span class="sr-only">Buscar formulario</span>
					<input
						type="search"
						class="input"
						placeholder="Buscar por código, nombre o descripción…"
						value={busqueda}
						oninput={(e) => onBuscar(e.currentTarget.value)}
					/>
				</label>
				<label class="filtros__check">
					<input
						type="checkbox"
						checked={incluirArchivados}
						onchange={(e) => {
							incluirArchivados = e.currentTarget.checked;
							pagina = 1;
							void cargar();
						}}
					/>
					Ver archivados
				</label>
				<span class="filtros__total">{total} formulario{total === 1 ? '' : 's'}</span>
			</div>

			{#if cargando}
				<div class="estado" aria-busy="true" aria-live="polite">Cargando catálogo…</div>
			{:else if formularios.length === 0}
				<div class="estado">
					<p class="estado__t">
						{busqueda ? `Sin resultados para «${busqueda}»` : 'Todavía no hay formularios'}
					</p>
					<p class="estado__d">
						Crea el primero con su código HSEQ. Se abrirá un borrador v1 listo para construir.
					</p>
				</div>
			{:else}
				<!-- Rejilla fluida: en un monitor ancho caben tres o cuatro formatos por
				     fila. Una lista de filas a pantalla completa deja el 60 % del ancho
				     vacío y obliga a hacer scroll para ver doce formatos. -->
				<ul class="lista">
					{#each formularios as form (form.id)}
						<li class="tarjeta" class:tarjeta--archivada={form.deletedAt}>
							<div class="tarjeta__id">
								<span class="tarjeta__code">{form.code}</span>
								{#if form.deletedAt}
									<span class="pill pill--archivada">Archivado</span>
								{/if}
								<div class="tarjeta__versiones">
									{#if form.activeVersion}
										<a
											class="pill pill--pub"
											href={`/dashboard/formularios/${form.id}/preview/${form.activeVersion.id}`}
										>
											Publicada v{form.activeVersion.versionNumber}
										</a>
									{:else}
										<span class="pill pill--sin">Sin publicar</span>
									{/if}

									{#if form.draftVersion}
										<a
											class="pill pill--draft"
											href={`/dashboard/formularios/${form.id}/editar/${form.draftVersion.id}`}
										>
											Borrador v{form.draftVersion.versionNumber}
										</a>
									{/if}
								</div>
							</div>

							<div class="tarjeta__cuerpo">
								<a class="tarjeta__nombre" href={`/dashboard/formularios/${form.id}`}>{form.name}</a
								>
								{#if form.description}
									<p class="tarjeta__desc">{form.description}</p>
								{/if}
								<p class="tarjeta__meta">
									Actualizado {fecha(form.updatedAt)}
									{#if form.counts}
										· {form.counts.assignments} asignación{form.counts.assignments === 1
											? ''
											: 'es'}
										· {form.counts.submissions} envío{form.counts.submissions === 1 ? '' : 's'}
									{/if}
								</p>
							</div>

							<div class="tarjeta__acciones">
								{#if form.deletedAt}
									<button type="button" class="btn btn--mini" onclick={() => restaurar(form)}>
										Restaurar
									</button>
								{:else}
									<a class="btn btn--mini" href={`/dashboard/formularios/${form.id}`}>Abrir</a>
									<button
										type="button"
										class="btn btn--mini"
										onclick={() =>
											cambiarFiltroEnvios(() => {
												filtroFormId = form.id;
												filtroVersionId = '';
												vista = 'envios';
											})}
									>
										Envíos
									</button>
									<button
										type="button"
										class="btn btn--mini btn--peligro"
										onclick={() => archivar(form)}
									>
										Archivar
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>

				{#if totalPages > 1}
					<nav class="paginacion" aria-label="Paginación del catálogo">
						<button
							type="button"
							class="btn btn--mini"
							disabled={pagina <= 1}
							onclick={() => {
								pagina -= 1;
								void cargar();
							}}
						>
							Anterior
						</button>
						<span class="paginacion__estado">Página {pagina} de {totalPages}</span>
						<button
							type="button"
							class="btn btn--mini"
							disabled={pagina >= totalPages}
							onclick={() => {
								pagina += 1;
								void cargar();
							}}
						>
							Siguiente
						</button>
					</nav>
				{/if}
			{/if}
		</div>
	{:else if vista === 'mis-formularios'}
		<div
			id="panel-mis-formularios"
			role="tabpanel"
			aria-labelledby="pestana-mis-formularios"
			class="panel"
			tabindex="0"
		>
			<!--
				El MISMO componente que monta `/dashboard/mis-formularios`, con la base
				de rutas de aquella para que el runner y el «volver» sean coherentes:
				el runner vive en un solo sitio y no se duplica por pestaña.
			-->
			<MisFormularios base="/dashboard/mis-formularios" />
		</div>
	{:else}
		<!--
			Explorador de envíos.

			Los filtros son ESTRUCTURADOS (formulario, versión, asignación, estado,
			rango de fechas de negocio) y la búsqueda libre solo mira conductor y
			placa. No hay búsqueda dentro de las respuestas a propósito: sería un LIKE
			sobre `form_answers` sin índice, con millones de filas.

			El CSV solo despliega columnas por pregunta cuando se filtra por una
			versión concreta. Formularios distintos —o versiones distintas del mismo—
			no comparten preguntas, y mezclarlas produciría un archivo ilegible.
		-->
		<div
			id="panel-envios"
			role="tabpanel"
			aria-labelledby="pestana-envios"
			class="panel"
			tabindex="0"
		>
			<div class="filtros-envios">
				<label class="filtro filtro--ancho">
					<span class="filtro__label">Buscar</span>
					<input
						class="input"
						type="search"
						placeholder="Nombre, cédula o placa…"
						value={filtroBusqueda}
						oninput={(e) => onBuscarEnvios(e.currentTarget.value)}
					/>
				</label>

				<label class="filtro">
					<span class="filtro__label">Formulario</span>
					<select
						class="input"
						value={filtroFormId}
						onchange={(e) =>
							cambiarFiltroEnvios(() => {
								filtroFormId = e.currentTarget.value;
								/// La versión se limpia al cambiar de formulario: una versión de
								/// otro formulario devolvería cero resultados sin explicación.
								filtroVersionId = '';
							})}
					>
						<option value="">Todos</option>
						{#each catalogoTotal as f (f.id)}
							<option value={f.id}>{f.code} — {f.name}</option>
						{/each}
					</select>
				</label>

				<label class="filtro">
					<span class="filtro__label">Versión</span>
					<select
						class="input"
						value={filtroVersionId}
						disabled={!filtroFormId}
						onchange={(e) => cambiarFiltroEnvios(() => (filtroVersionId = e.currentTarget.value))}
					>
						<option value="">Todas</option>
						{#each versionesDisponibles as v (v.id)}
							<option value={v.id}>v{v.versionNumber} · {v.status}</option>
						{/each}
					</select>
				</label>

				<label class="filtro">
					<span class="filtro__label">Estado</span>
					<select
						class="input"
						value={filtroEstado}
						onchange={(e) =>
							cambiarFiltroEnvios(
								() => (filtroEstado = e.currentTarget.value as SubmissionStatus | '')
							)}
					>
						<option value="">Todos</option>
						<option value="SUBMITTED">Entregados</option>
						<option value="VOIDED">Anulados</option>
						<option value="DRAFT">Borradores</option>
					</select>
				</label>

				<label class="filtro">
					<span class="filtro__label">Desde</span>
					<input
						class="input"
						type="date"
						value={filtroDesde}
						onchange={(e) => cambiarFiltroEnvios(() => (filtroDesde = e.currentTarget.value))}
					/>
				</label>

				<label class="filtro">
					<span class="filtro__label">Hasta</span>
					<input
						class="input"
						type="date"
						value={filtroHasta}
						onchange={(e) => cambiarFiltroEnvios(() => (filtroHasta = e.currentTarget.value))}
					/>
				</label>
			</div>

			<div class="barra-envios">
				<p class="conteo">
					{totalEnvios} envío{totalEnvios === 1 ? '' : 's'}
					{#if hayFiltrosEnvios}<span class="conteo__nota">con los filtros puestos</span>{/if}
				</p>

				{#if filtroAssignmentId}
					<!-- El filtro por asignación no tiene selector propio: llega por enlace
					     desde el listado de asignaciones. Sin este chip sería un filtro
					     invisible, y la lista parecería vacía sin motivo. -->
					<span class="chip-filtro">
						Asignación: {filtroAssignmentNombre || filtroAssignmentId.slice(0, 8)}
						<button
							type="button"
							class="chip-filtro__x"
							aria-label="Quitar el filtro por asignación"
							onclick={() =>
								cambiarFiltroEnvios(() => {
									filtroAssignmentId = '';
									filtroAssignmentNombre = '';
								})}
						>
							×
						</button>
					</span>
				{/if}

				<div class="barra-envios__acciones">
					{#if hayFiltrosEnvios}
						<button type="button" class="btn btn--mini" onclick={limpiarFiltrosEnvios}>
							Limpiar filtros
						</button>
					{/if}
					<button type="button" class="btn btn--mini" disabled={exportando} onclick={exportar}>
						{exportando ? 'Generando…' : 'Exportar CSV'}
					</button>
				</div>
			</div>

			{#if cargandoEnvios}
				<div class="estado" aria-busy="true">Cargando envíos…</div>
			{:else if envios.length === 0}
				<div class="estado">Sin envíos que coincidan con los filtros.</div>
			{:else}
				<!-- La tabla scrollea en su propio contenedor: la página nunca desborda en
				     horizontal, ni en un portátil de 13". -->
				<div class="tabla-scroll">
					<table class="tabla">
						<thead>
							<tr>
								<th scope="col">Formulario</th>
								<th scope="col">Diligenciado por</th>
								<th scope="col">Vehículo</th>
								<!-- Cuándo se diligenció, que es la fecha del documento. Ojo: los
								     filtros Desde/Hasta siguen consultando por `business_date`, la
								     fecha con la que el servidor cuenta los períodos. -->
								<th scope="col">Fecha formulario</th>
								<th scope="col">Enviado</th>
								<th scope="col">Estado</th>
								<th scope="col"><span class="sr-only">Acciones</span></th>
							</tr>
						</thead>
						<tbody>
							{#each envios as envio (envio.id)}
								<tr class:fila--anulada={envio.status === 'VOIDED'}>
									<td>
										<span class="mono">{envio.version?.code ?? '—'}</span>
										<span class="sub">
											v{envio.version?.versionNumber} · {envio.assignment?.name ?? ''}
										</span>
									</td>
									<td>
										<!--
											El autor puede ser un conductor o un usuario interno: desde
											que una asignación alcanza a las dos poblaciones, leer solo
											`conductor` dejaba media lista con un guion. El sufijo del
											tipo evita que «Juan Pérez» sea ambiguo.
										-->
										{envio.actor?.nombre ?? '—'}
										{#if envio.conductor?.numeroIdentificacion}
											<span class="sub mono">{envio.conductor.numeroIdentificacion}</span>
										{:else if envio.actor?.kind === 'USER'}
											<span class="sub">Personal interno</span>
										{/if}
									</td>
									<td class="mono">{envio.vehiculo?.placa ?? '—'}</td>
									<td class="mono">
										{fechaDeFormularioDe(envio.context) ?? envio.businessDate ?? '—'}
									</td>
									<td class="mono">{fechaHora(envio.submittedAt)}</td>
									<td>
										<span class="chip chip--{envio.status.toLowerCase()}">
											{SUBMISSION_STATUS_LABELS[envio.status]}
										</span>
									</td>
									<td>
										<a class="btn btn--mini" href={`/dashboard/formularios/envios/${envio.id}`}>
											Ver
										</a>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				{#if totalPagesEnvios > 1}
					<nav class="paginacion" aria-label="Paginación de envíos">
						<button
							type="button"
							class="btn btn--mini"
							disabled={paginaEnvios <= 1}
							onclick={() => {
								paginaEnvios -= 1;
								void cargarEnvios();
							}}
						>
							Anterior
						</button>
						<span class="paginacion__estado">Página {paginaEnvios} de {totalPagesEnvios}</span>
						<button
							type="button"
							class="btn btn--mini"
							disabled={paginaEnvios >= totalPagesEnvios}
							onclick={() => {
								paginaEnvios += 1;
								void cargarEnvios();
							}}
						>
							Siguiente
						</button>
					</nav>
				{/if}
			{/if}
		</div>
	{/if}
</div>

{#if modalCrear}
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="crear-titulo"
		tabindex="-1"
		onkeydown={(e) => {
			if (e.key === 'Escape') modalCrear = false;
		}}
	>
		<div class="modal__caja">
			<h2 class="modal__titulo" id="crear-titulo">Nuevo formulario</h2>

			<label class="campo">
				<span class="campo__label">Código HSEQ</span>
				<input
					class="input input--mono"
					placeholder="HSEQ-FR-08"
					bind:value={nuevoCode}
					autocomplete="off"
				/>
				<span class="campo__hint">Es el código documental. Debe ser único.</span>
			</label>

			<label class="campo">
				<span class="campo__label">Nombre</span>
				<input
					class="input"
					placeholder="Preoperacional de camionetas"
					bind:value={nuevoNombre}
					autocomplete="off"
				/>
				{#if slugPropuesto}
					<span class="campo__hint">Slug: <code>{slugPropuesto}</code></span>
				{/if}
			</label>

			<label class="campo">
				<span class="campo__label">Descripción (opcional)</span>
				<textarea class="input input--area" rows="2" bind:value={nuevoDescripcion}></textarea>
			</label>

			<div class="modal__acciones">
				<button type="button" class="btn" onclick={() => (modalCrear = false)}>Cancelar</button>
				<button type="button" class="btn btn--primario" disabled={creando} onclick={crear}>
					{creando ? 'Creando…' : 'Crear y construir'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1.25rem 1.25rem 3rem;
	}

	.aviso {
		padding: 0.4375rem 0.625rem;
		font-size: 0.75rem;
		color: #92400e;
		background: #fffbeb;
		border-left: 3px solid #f59e0b;
		border-radius: 6px;
	}

	/* Pestañas: la línea inferior es la que marca la seleccionada, no un relleno.
	   Ocupan una sola línea de 38 px y no roban altura a la tabla. */
	.pestanas {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.pestana {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 38px;
		padding: 0 0.75rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-muted, #6b6b6b);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		cursor: pointer;
	}

	.pestana:hover {
		color: var(--text-primary, #1a1a1a);
	}

	.pestana:focus-visible {
		outline: 2px solid var(--orange-600, #ea580c);
		outline-offset: -2px;
	}

	.pestana--on {
		color: var(--orange-700, #c2410c);
		border-bottom-color: var(--orange-600, #ea580c);
	}

	.pestana__cuenta {
		padding: 0.0625rem 0.375rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--text-secondary, #4a4a4a);
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 999px;
	}

	/* `tabindex="0"` en el panel: es lo que manda el patrón de pestañas para que,
	   al tabular desde la pestaña activa, el foco entre en su contenido. El
	   contorno se dibuja por dentro para no montarse sobre la línea de pestañas. */
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.panel:focus-visible {
		outline: 2px solid var(--orange-600, #ea580c);
		outline-offset: -2px;
	}

	.filtros {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.filtros__buscar {
		flex: 1;
		min-width: 14rem;
	}

	.filtros__check {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--text-secondary, #4a4a4a);
	}

	.filtros__check input {
		width: 18px;
		height: 18px;
		accent-color: var(--orange-600, #ea580c);
	}

	.filtros__total {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.filtros-envios {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
		gap: 0.5rem;
		padding: 0.75rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 12px;
	}

	.filtro {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		min-width: 0;
	}

	.filtro--ancho {
		grid-column: span 2;
	}

	.filtro__label {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.barra-envios {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.barra-envios__acciones {
		display: flex;
		gap: 0.375rem;
		margin-left: auto;
	}

	.conteo {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.conteo__nota {
		margin-left: 0.375rem;
		font-family: var(--font-sans, sans-serif);
		font-style: italic;
	}

	.chip-filtro {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.25rem 0.125rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: #3730a3;
		background: #eef2ff;
		border: 1px solid #c7d2fe;
		border-radius: 999px;
	}

	.chip-filtro__x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		font-size: 0.9375rem;
		line-height: 1;
		color: inherit;
		background: none;
		border: none;
		border-radius: 999px;
		cursor: pointer;
	}

	.chip-filtro__x:hover {
		background: #c7d2fe;
	}

	.input {
		width: 100%;
		min-height: 40px;
		padding: 0.375rem 0.625rem;
		font: inherit;
		font-size: 0.8125rem;
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 9px;
	}

	.input--mono {
		font-family: var(--font-mono, monospace);
	}

	.input--area {
		min-height: 4rem;
		resize: vertical;
	}

	.input:focus-visible {
		outline: none;
		border-color: var(--orange-600, #ea580c);
		box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.18);
	}

	/* Catálogo en rejilla fluida. `auto-fill` y no `auto-fit`: con dos formatos en
	   un monitor ancho, `auto-fit` los estiraría a media pantalla cada uno. */
	.lista {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr));
		gap: 0.625rem;
		list-style: none;
		padding: 0;
	}

	.tarjeta {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
		box-shadow: var(--shadow-card, 0 4px 24px rgba(0, 0, 0, 0.04));
	}

	.tarjeta--archivada {
		opacity: 0.72;
		background: var(--gray-50, #f9fafb);
	}

	.tarjeta__id {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.tarjeta__code {
		font-family: var(--font-mono, monospace);
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, #1a1a1a);
	}

	.tarjeta__cuerpo {
		flex: 1;
		min-width: 0;
	}

	.tarjeta__nombre {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
		text-decoration: none;
	}

	.tarjeta__nombre:hover {
		text-decoration: underline;
	}

	.tarjeta__desc {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		color: var(--text-muted, #6b6b6b);
		line-height: 1.4;
	}

	.tarjeta__meta {
		margin-top: 0.25rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.tarjeta__versiones {
		display: flex;
		gap: 0.3125rem;
		flex-wrap: wrap;
		margin-left: auto;
	}

	.pill {
		padding: 0.1875rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 600;
		border-radius: 999px;
		text-decoration: none;
		white-space: nowrap;
	}

	.pill--pub {
		background: #f0fdf4;
		color: #166534;
		border: 1px solid #bbf7d0;
	}

	.pill--draft {
		background: #fffbeb;
		color: #92400e;
		border: 1px solid #fde68a;
	}

	.pill--sin,
	.pill--archivada {
		background: var(--gray-50, #f9fafb);
		color: var(--text-muted, #6b6b6b);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.tarjeta__acciones {
		display: flex;
		gap: 0.3125rem;
		flex-wrap: wrap;
	}

	.tabla-scroll {
		overflow-x: auto;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 12px;
	}

	.tabla {
		width: 100%;
		min-width: 52rem;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.tabla th {
		padding: 0.5rem 0.625rem;
		text-align: left;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
		background: var(--gray-50, #f9fafb);
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		white-space: nowrap;
	}

	.tabla td {
		padding: 0.5rem 0.625rem;
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		vertical-align: top;
	}

	.tabla tr:last-child td {
		border-bottom: none;
	}

	.fila--anulada {
		background: #fef2f2;
	}

	.mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		/* Tabulares aquí sí: son columnas que se leen en vertical. */
		font-variant-numeric: tabular-nums;
	}

	.sub {
		display: block;
		margin-top: 0.0625rem;
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.chip {
		padding: 0.125rem 0.4375rem;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: 999px;
		white-space: nowrap;
	}

	.chip--submitted {
		background: #f0fdf4;
		color: #166534;
	}

	.chip--voided {
		background: #fef2f2;
		color: #991b1b;
	}

	.chip--draft {
		background: #fffbeb;
		color: #92400e;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
		background: #fff;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
		cursor: pointer;
		text-decoration: none;
	}

	.btn--mini {
		min-height: 36px;
		padding: 0 0.625rem;
		font-size: 0.8125rem;
	}

	.btn:hover:not(:disabled) {
		background: var(--gray-50, #f9fafb);
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn:focus-visible {
		outline: 2px solid var(--orange-600, #ea580c);
		outline-offset: 2px;
	}

	.btn--primario {
		color: #fff;
		background: var(--orange-600, #ea580c);
		border-color: var(--orange-600, #ea580c);
		font-weight: 600;
	}

	.btn--primario:hover:not(:disabled) {
		background: var(--orange-700, #c2410c);
	}

	.btn--peligro {
		color: #b91c1c;
	}

	.btn--peligro:hover:not(:disabled) {
		background: #fef2f2;
		border-color: #fecaca;
	}

	.estado {
		padding: 2.5rem 1rem;
		text-align: center;
		background: var(--bg-surface, #fff);
		border: 1px dashed var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 14px;
		color: var(--text-muted, #6b6b6b);
	}

	.estado__t {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-secondary, #4a4a4a);
	}

	.estado__d {
		margin-top: 0.3125rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-very-muted, #9a9a9a);
	}

	.paginacion {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
	}

	.paginacion__estado {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		color: var(--text-muted, #6b6b6b);
	}

	.modal {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(15, 31, 26, 0.45);
	}

	.modal__caja {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		max-width: 26rem;
		padding: 1.125rem;
		background: var(--bg-surface, #fff);
		border-radius: 16px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
	}

	.modal__titulo {
		font-family: var(--font-display, Georgia, serif);
		font-size: 1.125rem;
		font-weight: 600;
	}

	.modal__acciones {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.campo {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
	}

	.campo__label {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
	}

	.campo__hint {
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.campo__hint code {
		font-family: var(--font-mono, monospace);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
