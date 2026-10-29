<script lang="ts">
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import { mascota } from '$lib/mascot';
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import { recargosApi } from '$lib/api/recargos';
	import { toast } from 'svelte-sonner';
	import { fade, fly } from 'svelte/transition';
	import { Plus, Pencil, Trash2, Clock, ChevronLeft } from 'lucide-svelte';
	import type { ColumnDef } from '@tanstack/table-core';
	import type {
		ConfiguracionSalario,
		CrearConfiguracionSalarioDTO,
		EmpresaDisponible
	} from '$lib/types/recargos';

	// State
	let configuraciones: ConfiguracionSalario[] = [];
	let empresas: EmpresaDisponible[] = [];
	let loading = true;
	/// Sin esto un fallo de red dejaba la página en «No hay configuraciones»,
	/// que se lee como «no existe ninguna» y empuja a crear una que ya estaba.
	let errorCarga: string | null = null;
	let saving = false;
	let searchTerm = '';
	let filtroActivo: 'todos' | 'activos' | 'inactivos' = 'activos';
	let filtroEmpresa = '';
	let filtroSede = '';

	// Modal state
	let modalOpen = false;
	let editingId: string | null = null;
	let deleteLoading = false;

	// Highlight state (socket)
	let recentlyCreated = new Set<string>();
	let recentlyUpdated = new Set<string>();

	// Form state
	let form: CrearConfiguracionSalarioDTO = getEmptyForm();

	/// Semáforo de la columna Estado: hex literal y no `--emerald-*`, porque
	/// cotransmeq remapea esa escala a naranja y «activa» debe seguir en verde.
	const COLOR_ACTIVA = '#16a34a';
	const COLOR_INACTIVA = '#64748b';

	const SEDES: { valor: NonNullable<ConfiguracionSalario['sede']>; etiqueta: string }[] = [
		{ valor: 'YOPAL', etiqueta: 'Yopal' },
		{ valor: 'VILLANUEVA', etiqueta: 'Villanueva' },
		{ valor: 'TAURAMENA', etiqueta: 'Tauramena' }
	];

	const SEGMENTOS_ESTADO = [
		{ valor: 'activos', etiqueta: 'Activas', punto: COLOR_ACTIVA },
		{ valor: 'inactivos', etiqueta: 'Inactivas', punto: COLOR_INACTIVA },
		{ valor: 'todos', etiqueta: 'Todas' }
	];

	/// Columnas de la tabla. Ninguna ordena: la lista llega completa y el orden
	/// que importa (por vigencia) ya lo da la línea de tiempo de arriba.
	const COLUMNAS: ColumnDef<ConfiguracionSalario, any>[] = [
		{ id: 'empresa', header: 'Empresa' },
		{ id: 'sede', header: 'Sede', size: 120 },
		{ id: 'salario', header: 'Salario básico' },
		{ id: 'hora', header: 'Valor hora' },
		{ id: 'horas', header: 'Hrs/mes', size: 90 },
		{ id: 'jornada', header: 'Jornada' },
		{ id: 'festivos', header: 'Festivos', size: 110 },
		{ id: 'vigencia', header: 'Vigencia' },
		{ id: 'estado', header: 'Estado', size: 130 },
		{ id: 'acciones', header: '', size: 100 }
	];

	// User
	$: user = $authStore.user;
	/**
	 * Solo lectura si el nivel efectivo sobre `recargos` no llega a `full`.
	 * Con ello una personalización por ruta puede limitar el módulo sin
	 * depender del rol heredado.
	 * `user` va en la expresión para que se recalcule cuando la sesión termine
	 * de hidratarse.
	 */
	$: isReadOnly =
		!(user && authStore.getAccessLevel('recargos') === 'full');

	// Detección de solapamiento de vigencias para el formulario
	$: solapamientoDetectado = detectarSolapamiento(form, configuraciones, editingId);

	function detectarSolapamiento(
		formActual: CrearConfiguracionSalarioDTO,
		todas: ConfiguracionSalario[],
		idExcluir: string | null
	): { conflictos: ConfiguracionSalario[] } {
		if (!formActual.vigencia_desde) return { conflictos: [] };
		const desde = new Date(formActual.vigencia_desde);
		const hasta = formActual.vigencia_hasta ? new Date(formActual.vigencia_hasta) : null;

		const conflictos = todas.filter((c) => {
			if (c.id === idExcluir) return false;
			if (c.deleted_at) return false;
			// Mismo empresa_id (o ambos null = base)
			if ((c.empresa_id || null) !== (formActual.empresa_id || null)) return false;
			if (c.sede !== formActual.sede) return false;
			const cDesde = new Date(c.vigencia_desde);
			const cHasta = c.vigencia_hasta ? new Date(c.vigencia_hasta) : null;

			// Solapan si los rangos se intersectan
			if (cHasta && cHasta < desde) return false;
			if (hasta && hasta < cDesde) return false;
			return true;
		});
		return { conflictos };
	}

	// Filtered data
	$: filtered = configuraciones.filter((c) => {
		if (filtroActivo === 'activos' && !c.activo) return false;
		if (filtroActivo === 'inactivos' && c.activo) return false;
		if (filtroEmpresa && c.empresa_id !== filtroEmpresa) return false;
		if (filtroSede && c.sede !== filtroSede) return false;
		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			const empNombre = c.clientes?.nombre?.toLowerCase() || '';
			const obs = c.observaciones?.toLowerCase() || '';
			const sede = (c.sede || '').toLowerCase();
			return empNombre.includes(term) || obs.includes(term) || sede.includes(term);
		}
		return true;
	});

	/// «Activas» es el filtro de entrada: no cuenta como filtro puesto.
	$: hayFiltros = !!(searchTerm || filtroEmpresa || filtroSede || filtroActivo !== 'activos');

	$: conteos = [
		{ clave: 'todos', etiqueta: 'Total', valor: configuraciones.length },
		{
			clave: 'activos',
			etiqueta: 'Activas',
			valor: configuraciones.filter((c) => c.activo).length,
			color: COLOR_ACTIVA
		},
		{
			clave: 'inactivos',
			etiqueta: 'Inactivas',
			valor: configuraciones.filter((c) => !c.activo).length,
			color: COLOR_INACTIVA
		}
	];

	// Agrupar configs por (empresa_id, sede) para mostrar el timeline
	$: configsAgrupadas = (() => {
		const grupos = new Map<string, ConfiguracionSalario[]>();
		for (const c of configuraciones) {
			if (c.deleted_at) continue;
			const key = `${c.empresa_id || 'base'}|${c.sede || ''}`;
			if (!grupos.has(key)) grupos.set(key, []);
			grupos.get(key)!.push(c);
		}
		// Ordenar cada grupo por vigencia_desde
		for (const arr of grupos.values()) {
			arr.sort(
				(a, b) => new Date(a.vigencia_desde).getTime() - new Date(b.vigencia_desde).getTime()
			);
		}
		return Array.from(grupos.entries());
	})();

	function getEmptyForm(): CrearConfiguracionSalarioDTO {
		return {
			empresa_id: null,
			salario_basico: 0,
			valor_hora_trabajador: 0,
			horas_mensuales_base: 240,
			vigencia_desde: new Date().toISOString().split('T')[0],
			vigencia_hasta: null,
			activo: true,
			observaciones: '',
			paga_dias_festivos: false,
			porcentaje_festivos: 75,
			seguridad_social: 0,
			administracion: 0,
			prueba_antigeno_covid: 0,
			prestaciones_sociales: 0,
			// Defaults históricos. Si el usuario deja el campo vacío al
			// crear, el backend usa estos mismos valores (default del schema).
			jornada_normal_horas: 10.33,
			jornada_festiva_horas: 7.33,
			sede: null
		};
	}

	async function cargarDatos() {
		loading = true;
		try {
			const [configsRes, empresasRes] = await Promise.all([
				recargosApi.obtenerConfiguracionesSalarios(),
				recargosApi.obtenerEmpresasDisponibles()
			]);
			configuraciones = configsRes;
			empresas = empresasRes;
			errorCarga = null;
		} catch (err) {
			console.error('Error cargando datos:', err);
			toast.error('Error al cargar configuraciones de salarios');
			errorCarga = 'No se pudieron cargar las configuraciones de salarios.';
		} finally {
			loading = false;
		}
	}

	function limpiarFiltros() {
		searchTerm = '';
		filtroActivo = 'activos';
		filtroEmpresa = '';
		filtroSede = '';
	}

	function abrirCrear() {
		editingId = null;
		form = getEmptyForm();
		modalOpen = true;
	}

	function abrirEditar(config: ConfiguracionSalario) {
		editingId = config.id;
		form = {
			empresa_id: config.empresa_id,
			salario_basico: Number(config.salario_basico),
			valor_hora_trabajador: Number(config.valor_hora_trabajador),
			horas_mensuales_base: config.horas_mensuales_base,
			vigencia_desde: config.vigencia_desde ? config.vigencia_desde.split('T')[0] : '',
			vigencia_hasta: config.vigencia_hasta ? config.vigencia_hasta.split('T')[0] : null,
			activo: config.activo,
			observaciones: config.observaciones || '',
			paga_dias_festivos: config.paga_dias_festivos,
			porcentaje_festivos: Number(config.porcentaje_festivos),
			seguridad_social: Number(config.seguridad_social),
			administracion: Number(config.administracion),
			prueba_antigeno_covid: Number(config.prueba_antigeno_covid),
			prestaciones_sociales: Number(config.prestaciones_sociales),
			// Si por algún motivo la BD no trae estos campos (registros
			// muy viejos anteriores a la migración), caemos a los
			// defaults para no romper la edición.
			jornada_normal_horas: Number(config.jornada_normal_horas) || 10.33,
			jornada_festiva_horas: Number(config.jornada_festiva_horas) || 7.33,
			sede: config.sede
		};
		modalOpen = true;
	}

	async function guardar() {
		saving = true;
		try {
			if (editingId) {
				await recargosApi.actualizarConfiguracionSalario(editingId, form);
				toast.success('Configuración actualizada');
			} else {
				await recargosApi.crearConfiguracionSalario(form);
				toast.success('Configuración creada');
			}
			modalOpen = false;
			await cargarDatos();
		} catch (err: any) {
			console.error('Error guardando:', err);
			toast.error(err?.response?.data?.message || 'Error al guardar configuración');
		} finally {
			saving = false;
		}
	}

	/// La confirmación era una fila que se desplegaba bajo la de la tabla; con
	/// `TablaLista` no hay dónde meterla y además era la única pantalla que
	/// confirmaba así. El borrado es el mismo.
	async function pedirEliminar(config: ConfiguracionSalario) {
		const ok = await confirmarEliminacion({
			title: '¿Eliminar esta configuración?',
			message: `Se eliminará la configuración de ${config.clientes?.nombre || 'General'}${
				config.sede ? ` (sede ${etiquetaSede(config.sede)})` : ''
			}. Las planillas que se calculen después ya no la usarán.`
		});
		if (ok) await eliminar(config.id);
	}

	async function eliminar(id: string) {
		deleteLoading = true;
		try {
			await recargosApi.eliminarConfiguracionSalario(id);
			toast.success('Configuración eliminada');
			await cargarDatos();
		} catch (err) {
			console.error('Error eliminando:', err);
			toast.error('Error al eliminar configuración');
		} finally {
			deleteLoading = false;
		}
	}

	async function toggleActivo(config: ConfiguracionSalario) {
		try {
			await recargosApi.actualizarConfiguracionSalario(config.id, { activo: !config.activo });
			toast.success(config.activo ? 'Configuración desactivada' : 'Configuración activada');
			await cargarDatos();
		} catch (err) {
			toast.error('Error al cambiar estado');
		}
	}

	// Formatear moneda
	function formatCurrency(value: number | string): string {
		const num = Number(value);
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 2
		}).format(num);
	}

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return '—';
		const fecha = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00Z');
		return fecha.toLocaleDateString('es-CO', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}

	function etiquetaSede(sede: string | null): string {
		return SEDES.find((s) => s.valor === sede)?.etiqueta ?? sede ?? '';
	}

	function getLabelGrupo(key: string): string {
		const [empresaId, sede] = key.split('|');
		if (empresaId === 'base') return 'General (todas las empresas)';
		const empresa = empresas.find((e) => e.id === empresaId);
		return empresa?.nombre || 'Empresa desconocida';
	}

	// Socket listeners
	function setupSocketListeners() {
		socketUtils.on('config-salario-creada', handleConfigCreada);
		socketUtils.on('config-salario-actualizada', handleConfigActualizada);
		socketUtils.on('config-salario-eliminada', handleConfigEliminada);
	}

	function handleConfigCreada(data: any) {
		recentlyCreated.add(data.configId);
		recentlyCreated = recentlyCreated;
		cargarDatos();
		setTimeout(() => {
			recentlyCreated.delete(data.configId);
			recentlyCreated = recentlyCreated;
		}, 5000);
	}

	function handleConfigActualizada(data: any) {
		recentlyUpdated.add(data.configId);
		recentlyUpdated = recentlyUpdated;
		cargarDatos();
		setTimeout(() => {
			recentlyUpdated.delete(data.configId);
			recentlyUpdated = recentlyUpdated;
		}, 5000);
	}

	function handleConfigEliminada(data: any) {
		cargarDatos();
		toast.info('Una configuración fue eliminada por otro usuario');
	}

	onMount(async () => {
		await cargarDatos();
		setupSocketListeners();
	});

	onDestroy(() => {
		socketUtils.off('config-salario-creada', handleConfigCreada);
		socketUtils.off('config-salario-actualizada', handleConfigActualizada);
		socketUtils.off('config-salario-eliminada', handleConfigEliminada);
	});
</script>

<svelte:head>
	<title>Configuración Salarios - Recargos - Cotransmeq</title>
</svelte:head>

<!-- `conf-pagina` deja crecer la página con su contenido: `.dir-pagina` fija
     la altura para listas con scroll propio y aquí hay tres bloques seguidos. -->
<div class="dir-pagina conf-pagina" in:fade={{ duration: 400 }}>
	<!-- ── CABECERA: título, conteos y acciones ─────────────── -->
	<header class="page-card dir-cabecera" style="padding: 1.25rem 1.5rem;">
		<div class="dir-cabecera-texto">
			<h1 class="dir-titulo">Configuración de salarios</h1>
			<p class="dir-desc">
				Salarios, porcentajes y valores de hora con los que se calculan los recargos.
			</p>
			{#if !loading || configuraciones.length > 0}
				<div class="dir-conteos">
					<ResumenConteos
						{conteos}
						activo={filtroActivo}
						onElegir={(clave) => (filtroActivo = clave as typeof filtroActivo)}
					/>
				</div>
			{/if}
		</div>

		<div class="dir-cabecera-acciones">
			<a href="/dashboard/recargos" class="btn-secondary">
				<ChevronLeft class="h-4 w-4" />
				Volver a recargos
			</a>
			{#if !isReadOnly}
				<button on:click={abrirCrear} class="btn-primary">
					<Plus class="h-4 w-4" />
					Nueva configuración
				</button>
			{/if}
		</div>
	</header>

	{#if loading && configuraciones.length === 0}
		<div class="page-card conf-marco">
			<CargaMascota texto="Cargando configuraciones…" />
		</div>
	{:else if errorCarga && configuraciones.length === 0}
		{@const img = mascota('advertencia')}
		<div class="page-card dir-vacio">
			<img src={img.src} alt={img.alt} width="418" height="418" />
			<h3>No se pudieron cargar las configuraciones</h3>
			<p>{errorCarga} Revisa la conexión e inténtalo de nuevo.</p>
			<button class="btn-secondary" on:click={cargarDatos}>Reintentar</button>
		</div>
	{:else}
		<!-- ── LÍNEA DE TIEMPO de vigencias, por empresa y sede ─── -->
		{#if configsAgrupadas.length > 0}
			<section class="page-card conf-seccion" in:fly={{ y: 12, duration: 400, delay: 80 }}>
				<div class="conf-seccion-cab">
					<h2>Vigencias por empresa</h2>
					<span>
						{configsAgrupadas.length}
						{configsAgrupadas.length === 1 ? 'grupo' : 'grupos'}
					</span>
				</div>
				<div class="conf-grupos">
					{#each configsAgrupadas as [key, configs] (key)}
						<div class="conf-grupo">
							<div class="conf-grupo-cab">
								<strong>
									{getLabelGrupo(key)}
									{#if configs[0]?.sede}
										<span class="conf-grupo-sede">· Sede {etiquetaSede(configs[0].sede)}</span>
									{/if}
								</strong>
								<span>
									{configs.length}
									{configs.length === 1 ? 'vigencia' : 'vigencias'}
								</span>
							</div>
							<div class="conf-chips">
								{#each configs as cfg (cfg.id)}
									{@const jn = Number(cfg.jornada_normal_horas) || 10.33}
									{@const jf = Number(cfg.jornada_festiva_horas) || 7.33}
									{@const jornadaDistinta = jn !== 10.33 || jf !== 7.33}
									<span
										class="conf-chip"
										class:conf-chip--jornada={cfg.activo && jornadaDistinta}
										class:conf-chip--inactiva={!cfg.activo}
										title={`${formatDate(cfg.vigencia_desde)}${cfg.vigencia_hasta ? ' → ' + formatDate(cfg.vigencia_hasta) : ' → ∞'} · ${formatCurrency(cfg.salario_basico)} · Jornada: ${jn.toFixed(2)}h / ${jf.toFixed(2)}h fest`}
									>
										<strong>
											{formatDate(cfg.vigencia_desde)} →
											{cfg.vigencia_hasta ? formatDate(cfg.vigencia_hasta) : 'actualidad'}
										</strong>
										<span aria-hidden="true">·</span>
										{formatCurrency(cfg.salario_basico)}
										{#if jornadaDistinta}
											<span aria-hidden="true">·</span>
											<span
												class="conf-chip-jornada"
												title="Jornada personalizada: {jn.toFixed(2)}h normal / {jf.toFixed(
													2
												)}h festiva"
											>
												<Clock class="h-3 w-3" />
												{jf.toFixed(2)}h
											</span>
										{/if}
									</span>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ── FILTROS A LA VISTA ────────────────────────────────── -->
		<div class="dir-filtros" in:fly={{ y: 12, duration: 400, delay: 100 }}>
			<div class="dir-filtros-buscador">
				<BuscadorLista
					bind:valor={searchTerm}
					onBuscar={(termino) => (searchTerm = termino)}
					placeholder="Empresa, sede u observaciones…"
					etiqueta="Buscar configuraciones"
				/>
			</div>
			<SegmentosFiltro
				etiqueta="Estado"
				opciones={SEGMENTOS_ESTADO}
				valor={filtroActivo}
				onCambiar={(v) => (filtroActivo = v as typeof filtroActivo)}
			/>
			<select bind:value={filtroEmpresa} class="conf-select" aria-label="Empresa">
				<option value="">Todas las empresas</option>
				{#each empresas as emp (emp.id)}
					<option value={emp.id}>{emp.nombre || 'Sin nombre'}</option>
				{/each}
			</select>
			<select bind:value={filtroSede} class="conf-select" aria-label="Sede">
				<option value="">Todas las sedes</option>
				{#each SEDES as s (s.valor)}
					<option value={s.valor}>{s.etiqueta}</option>
				{/each}
			</select>
			<span class="conf-resultado">
				{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
			</span>
			{#if hayFiltros}
				<button type="button" class="btn-secondary" on:click={limpiarFiltros}>Limpiar</button>
			{/if}
		</div>

		<!-- ── TABLA ─────────────────────────────────────────────── -->
		<!-- `TablaLista` deja el scroll horizontal dentro de su marco en escritorio
		     y apila cada fila como tarjeta en el móvil: antes la tabla de diez
		     columnas se recortaba en una pantalla de teléfono. -->
		<div class="dir-lista" in:fly={{ y: 12, duration: 400, delay: 150 }}>
			<TablaLista
				columnas={COLUMNAS}
				datos={filtered}
				claveFila={(c) => c.id}
				onFila={isReadOnly ? undefined : abrirEditar}
				etiqueta="Configuraciones de salarios"
			>
				{#snippet celda({ columnaId, fila: config })}
					{#if columnaId === 'empresa'}
						<div class="dir-celda">
							<span class="conf-empresa">
								{config.clientes?.nombre || 'General (todas)'}
								{#if recentlyCreated.has(config.id)}
									<span class="conf-marca conf-marca--nueva">Nueva</span>
								{:else if recentlyUpdated.has(config.id)}
									<span class="conf-marca conf-marca--actualizada">Actualizada</span>
								{/if}
							</span>
							{#if config.clientes?.nit}<small>NIT {config.clientes.nit}</small>{/if}
						</div>
					{:else if columnaId === 'sede'}
						{#if config.sede}
							<span>{etiquetaSede(config.sede)}</span>
						{:else}
							<span class="dir-nulo">—</span>
						{/if}
					{:else if columnaId === 'salario'}
						<span class="conf-num">{formatCurrency(config.salario_basico)}</span>
					{:else if columnaId === 'hora'}
						<span class="conf-num">{formatCurrency(config.valor_hora_trabajador)}</span>
					{:else if columnaId === 'horas'}
						<span class="conf-num">{config.horas_mensuales_base}</span>
					{:else if columnaId === 'jornada'}
						{@const jn = Number(config.jornada_normal_horas) || 10.33}
						{@const jf = Number(config.jornada_festiva_horas) || 7.33}
						{@const jornadaDistinta = jn !== 10.33 || jf !== 7.33}
						<div class="dir-celda conf-num">
							<span title="Jornada normal (umbral de horas ordinarias)">{jn.toFixed(2)} h</span>
							<small
								class:conf-jornada-distinta={jornadaDistinta}
								title={jornadaDistinta
									? 'Jornada personalizada (domingos/festivos)'
									: 'Jornada festiva (domingos/festivos)'}
							>
								Festiva {jf.toFixed(2)} h
							</small>
						</div>
					{:else if columnaId === 'festivos'}
						{#if config.paga_dias_festivos}
							<span class="conf-num">Sí · {Number(config.porcentaje_festivos)} %</span>
						{:else}
							<span class="dir-nulo">No</span>
						{/if}
					{:else if columnaId === 'vigencia'}
						<div class="dir-celda conf-num">
							<span>{formatDate(config.vigencia_desde)}</span>
							<small
								>→ {config.vigencia_hasta ? formatDate(config.vigencia_hasta) : 'actualidad'}</small
							>
						</div>
					{:else if columnaId === 'estado'}
						<!-- El clic y el teclado no suben a la fila: la fila abre la
						     edición y aquí solo se cambia el estado. -->
						<button
							type="button"
							class="conf-estado"
							disabled={isReadOnly}
							title={isReadOnly ? undefined : config.activo ? 'Desactivar' : 'Activar'}
							on:click|stopPropagation={() => toggleActivo(config)}
							on:keydown={(e) => e.stopPropagation()}
						>
							<EstadoPunto
								etiqueta={config.activo ? 'Activo' : 'Inactivo'}
								color={config.activo ? COLOR_ACTIVA : COLOR_INACTIVA}
								apagado={!config.activo}
							/>
						</button>
					{:else if columnaId === 'acciones'}
						<AccionesFila
							acciones={[
								{
									id: 'editar',
									etiqueta: 'Editar',
									icono: Pencil,
									onClick: () => abrirEditar(config),
									oculta: isReadOnly
								},
								{
									id: 'eliminar',
									etiqueta: 'Eliminar',
									icono: Trash2,
									onClick: () => pedirEliminar(config),
									peligrosa: true,
									oculta: isReadOnly,
									deshabilitada: deleteLoading
								}
							]}
						/>
					{/if}
				{/snippet}

				{#snippet vacio()}
					{@const img = mascota('vacio')}
					<div class="dir-vacio">
						<img src={img.src} alt={img.alt} width="418" height="418" />
						<h3>No hay configuraciones</h3>
						<p>
							{hayFiltros
								? 'No se encontraron configuraciones con los filtros aplicados.'
								: 'Crea la primera configuración de salarios para calcular los recargos.'}
						</p>
						{#if hayFiltros}
							<button class="btn-secondary" on:click={limpiarFiltros}>Limpiar filtros</button>
						{:else if !isReadOnly}
							<button on:click={abrirCrear} class="btn-primary">
								<Plus class="h-4 w-4" />
								Crear configuración
							</button>
						{/if}
					</div>
				{/snippet}
			</TablaLista>
		</div>

		<!-- ── DETALLE de aportes y jornadas, una tarjeta por configuración ── -->
		{#if filtered.length > 0}
			<div class="conf-tarjetas">
				{#each filtered as config (config.id)}
					{@const jn = Number(config.jornada_normal_horas) || 10.33}
					{@const jf = Number(config.jornada_festiva_horas) || 7.33}
					{@const jornadaDistinta = jn !== 10.33 || jf !== 7.33}
					<article
						class="page-card conf-tarjeta"
						class:conf-tarjeta--nueva={recentlyCreated.has(config.id)}
						class:conf-tarjeta--actualizada={recentlyUpdated.has(config.id)}
					>
						<div class="conf-tarjeta-cab">
							<div class="min-w-0">
								<h3>{config.clientes?.nombre || 'Configuración General'}</h3>
								{#if config.sede}<small>Sede {etiquetaSede(config.sede)}</small>{/if}
							</div>
							<EstadoPunto
								etiqueta={config.activo ? 'Activo' : 'Inactivo'}
								color={config.activo ? COLOR_ACTIVA : COLOR_INACTIVA}
								apagado={!config.activo}
							/>
						</div>

						<dl class="conf-valores">
							<div class="conf-valor" class:conf-valor--jornada={jornadaDistinta}>
								<dt><Clock class="h-2.5 w-2.5" /> Jornada normal</dt>
								<dd>{jn.toFixed(2)}h</dd>
							</div>
							<div class="conf-valor" class:conf-valor--jornada={jornadaDistinta}>
								<dt>Jornada festiva</dt>
								<dd>{jf.toFixed(2)}h</dd>
							</div>
							<div class="conf-valor">
								<dt>Seg. social</dt>
								<dd>{formatCurrency(config.seguridad_social)}</dd>
							</div>
							<div class="conf-valor">
								<dt>Administración</dt>
								<dd>{formatCurrency(config.administracion)}</dd>
							</div>
							<div class="conf-valor">
								<dt>Prest. sociales</dt>
								<dd>{formatCurrency(config.prestaciones_sociales)}</dd>
							</div>
							<div class="conf-valor">
								<dt>Antígeno COVID</dt>
								<dd>{formatCurrency(config.prueba_antigeno_covid)}</dd>
							</div>
						</dl>

						{#if config.observaciones}
							<p class="conf-nota">{config.observaciones}</p>
						{/if}

						{#if config.usuarios}
							<p class="conf-autor">Creado por: {config.usuarios.nombre}</p>
						{/if}
					</article>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Modal Crear/Editar. Siempre montado: `ModalBase` decide si se ve y así
     anima también al cerrarse. -->
<ModalBase
	open={modalOpen}
	eyebrow="Configuración de salarios"
	title={editingId ? 'Editar configuración' : 'Nueva configuración'}
	subtitle={editingId
		? 'Modifica los valores de la configuración'
		: 'Define los valores salariales y porcentajes'}
	tamano="md"
	cerrarAlFondo={false}
	bloqueado={saving}
	oncerrar={() => (modalOpen = false)}
>
	<!-- El botón de guardar vive en el pie de `ModalBase`, fuera del <form>:
	     se asocia por `form=` para que Enter y los `required` sigan valiendo. -->
	<form id="form-config-salario" on:submit|preventDefault={guardar}>
		<div class="space-y-5">
			<!-- Empresa + Sede -->
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label
						for="empresa_id"
						class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
					>
						EMPRESA
					</label>
					<select
						id="empresa_id"
						bind:value={form.empresa_id}
						class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
					>
						<option value={null}>General (todas las empresas)</option>
						{#each empresas as emp}
							<option value={emp.id}
								>{emp.nombre || 'Sin nombre'} {emp.nit ? `— ${emp.nit}` : ''}</option
							>
						{/each}
					</select>
				</div>
				<div>
					<label
						for="sede"
						class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
					>
						SEDE
					</label>
					<select
						id="sede"
						bind:value={form.sede}
						class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
					>
						<option value={null}>Sin especificar</option>
						<option value="YOPAL">Yopal</option>
						<option value="VILLANUEVA">Villanueva</option>
						<option value="TAURAMENA">Tauramena</option>
					</select>
				</div>
			</div>
			<!-- Salario + Valor Hora + Horas/Mes -->
			<div class="hint-card space-y-3">
				<div class="flex items-center gap-2">
					<span class="hint-label">💰 VALORES SALARIALES</span>
				</div>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<div>
						<label
							for="salario_basico"
							class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
							>Salario Básico</label
						>
						<input
							id="salario_basico"
							type="number"
							step="0.01"
							min="0"
							bind:value={form.salario_basico}
							required
							class="input-glow font-mono-meta w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
						/>
					</div>
					<div>
						<label
							for="valor_hora"
							class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
							>Valor Hora Trabajador</label
						>
						<input
							id="valor_hora"
							type="number"
							step="0.0001"
							min="0"
							bind:value={form.valor_hora_trabajador}
							required
							class="input-glow font-mono-meta w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
						/>
					</div>
					<div>
						<label
							for="horas_mes"
							class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
							>Horas/Mes Base</label
						>
						<input
							id="horas_mes"
							type="number"
							min="1"
							bind:value={form.horas_mensuales_base}
							class="input-glow font-mono-meta w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
						/>
					</div>
				</div>
			</div>

			<!-- Umbrales de jornada — Configurables por fecha -->
			<div class="hint-card space-y-3">
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<Clock class="h-3.5 w-3.5 text-[#B45309]" />
						<span class="hint-label">⏱️ UMBRALES DE JORNADA</span>
					</div>
					<button
						type="button"
						on:click={() => {
							form.jornada_normal_horas = 10.33;
							form.jornada_festiva_horas = 7.33;
							form = form;
						}}
						class="apple-transition font-mono-meta rounded-md px-2 py-0.5 text-[0.6rem] font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
						title="Restablecer a 10.33h / 7.33h (valores históricos)"
					>
						↺ Defaults
					</button>
				</div>
				<p class="text-[0.7rem] text-[var(--text-muted)]">
					Define a partir de cuántas horas empiezan a contar extras. Cambia estos valores cuando hay
					un cambio de normativa (ej: 15-jul) creando una nueva vigencia con la fecha de inicio.
				</p>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label
							for="jornada_normal_horas"
							class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
						>
							Jornada día normal
							<span
								class="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
								style="background-color: #166534;"
								title="Jornada aplicable de lunes a sábado"
							></span>
						</label>
						<div class="relative">
							<input
								id="jornada_normal_horas"
								type="number"
								step="0.01"
								min="0.5"
								max="24"
								bind:value={form.jornada_normal_horas}
								class="input-glow font-mono-meta w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 pr-9 text-sm"
							/>
							<span
								class="font-mono-meta pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[0.7rem] text-[var(--text-muted)]"
							>
								h
							</span>
						</div>
						<p class="font-mono-meta mt-1 text-[0.6rem] text-[var(--text-very-muted)]">
							Default: 10.33h (10h 20min). Extras a partir de este umbral.
						</p>
					</div>
					<div>
						<label
							for="jornada_festiva_horas"
							class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
						>
							Jornada domingo/festivo
							<span
								class="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
								style="background-color: #B45309;"
								title="Jornada aplicable los domingos y festivos"
							></span>
						</label>
						<div class="relative">
							<input
								id="jornada_festiva_horas"
								type="number"
								step="0.01"
								min="0.5"
								max="24"
								bind:value={form.jornada_festiva_horas}
								class="input-glow font-mono-meta w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 pr-9 text-sm"
							/>
							<span
								class="font-mono-meta pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[0.7rem] text-[var(--text-muted)]"
							>
								h
							</span>
						</div>
						<p class="font-mono-meta mt-1 text-[0.6rem] text-[var(--text-very-muted)]">
							Default: 7.33h (7h 20min). Si trabajás más, se cuenta como extra festiva.
						</p>
					</div>
				</div>
			</div>

			<!-- Porcentajes y deducciones -->
			<div class="hint-card space-y-3">
				<div class="flex items-center gap-2">
					<span class="hint-label">📊 DEDUCCIONES Y APORTES</span>
				</div>
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
					<div>
						<label
							for="seguridad_social"
							class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
							>Seguridad Social</label
						>
						<input
							id="seguridad_social"
							type="number"
							step="0.01"
							min="0"
							bind:value={form.seguridad_social}
							class="input-glow font-mono-meta w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
						/>
					</div>
					<div>
						<label
							for="administracion"
							class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
							>Administración</label
						>
						<input
							id="administracion"
							type="number"
							step="0.01"
							min="0"
							bind:value={form.administracion}
							class="input-glow font-mono-meta w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
						/>
					</div>
					<div>
						<label
							for="prestaciones"
							class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
							>Prest. Sociales</label
						>
						<input
							id="prestaciones"
							type="number"
							step="0.01"
							min="0"
							bind:value={form.prestaciones_sociales}
							class="input-glow font-mono-meta w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
						/>
					</div>
					<div>
						<label
							for="antigeno"
							class="mb-1 block text-xs font-semibold text-[var(--text-secondary)]"
							>Antígeno COVID</label
						>
						<input
							id="antigeno"
							type="number"
							step="0.01"
							min="0"
							bind:value={form.prueba_antigeno_covid}
							class="input-glow font-mono-meta w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
						/>
					</div>
				</div>
			</div>

			<!-- Festivos -->
			<div class="hint-card space-y-3">
				<div class="flex items-center gap-2">
					<span class="hint-label">🎉 DÍAS FESTIVOS</span>
				</div>
				<div class="flex flex-wrap items-center gap-6">
					<label class="flex cursor-pointer items-center gap-2">
						<input
							type="checkbox"
							bind:checked={form.paga_dias_festivos}
							class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
						/>
						<span class="text-sm font-medium text-[var(--text-secondary)]">
							Paga días festivos
						</span>
					</label>
					{#if form.paga_dias_festivos}
						<div class="flex items-center gap-2">
							<label for="porcentaje_festivos" class="text-sm text-[var(--text-muted)]"
								>Porcentaje:</label
							>
							<input
								id="porcentaje_festivos"
								type="number"
								step="0.01"
								min="0"
								max="200"
								bind:value={form.porcentaje_festivos}
								class="input-glow font-mono-meta w-20 rounded-xl border border-[var(--border-default)] bg-white px-2 py-1.5 text-center text-sm"
							/>
							<span class="font-mono-meta text-sm text-[var(--text-muted)]">%</span>
						</div>
					{/if}
				</div>
			</div>

			<!-- Vigencia -->
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label
						for="vigencia_desde"
						class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
					>
						VIGENCIA DESDE *
					</label>
					<input
						id="vigencia_desde"
						type="date"
						bind:value={form.vigencia_desde}
						required
						class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
					/>
				</div>
				<div>
					<label
						for="vigencia_hasta"
						class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
					>
						VIGENCIA HASTA <span class="text-[var(--text-very-muted)]">(opcional)</span>
					</label>
					<input
						id="vigencia_hasta"
						type="date"
						bind:value={form.vigencia_hasta}
						class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
					/>
				</div>
			</div>

			<!-- Alerta de solapamiento -->
			{#if solapamientoDetectado.conflictos.length > 0}
				<div
					class="flex items-start gap-3 rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-yellow-50 p-3"
					role="alert"
				>
					<svg
						class="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
					<div class="min-w-0 flex-1 text-xs text-amber-900">
						<p class="font-semibold">
							Esta vigencia se solapa con {solapamientoDetectado.conflictos.length}
							{solapamientoDetectado.conflictos.length === 1 ? 'configuración' : 'configuraciones'}:
						</p>
						<ul class="mt-1 space-y-0.5 text-amber-800">
							{#each solapamientoDetectado.conflictos as conf}
								<li class="font-mono-meta text-[0.7rem]">
									• {formatDate(conf.vigencia_desde)}
									{#if conf.vigencia_hasta}→ {formatDate(conf.vigencia_hasta)}{:else}→ actualidad{/if}
									· {formatCurrency(conf.salario_basico)}
								</li>
							{/each}
						</ul>
						<p class="mt-1 text-[0.7rem] text-amber-700">
							Los recargos nuevos usarán esta config. Las planillas con días en el rango solapado
							podrían recibir valores incorrectos.
						</p>
					</div>
				</div>
			{/if}

			<!-- Observaciones + Activo -->
			<div>
				<label
					for="observaciones"
					class="font-mono-meta mb-1.5 block text-[0.65rem] text-[var(--text-muted)]"
				>
					OBSERVACIONES
				</label>
				<textarea
					id="observaciones"
					bind:value={form.observaciones}
					rows="2"
					class="input-glow w-full rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
					placeholder="Notas adicionales..."
				></textarea>
			</div>

			<label
				class="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
			>
				<input
					type="checkbox"
					bind:checked={form.activo}
					class="h-4 w-4 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
				/>
				<span class="text-sm font-semibold text-[var(--text-primary)]"> Configuración activa </span>
			</label>
		</div>
	</form>

	{#snippet pie()}
		<button
			type="button"
			on:click={() => (modalOpen = false)}
			disabled={saving}
			class="btn-secondary"
		>
			Cancelar
		</button>
		<button type="submit" form="form-config-salario" disabled={saving} class="btn-primary">
			{#if saving}
				<span class="spinner conf-spinner" aria-hidden="true"></span>
				Guardando…
			{:else}
				{editingId ? 'Guardar cambios' : 'Crear configuración'}
			{/if}
		</button>
	{/snippet}
</ModalBase>

<style>
	.conf-pagina {
		height: auto;
		min-height: 100%;
	}

	/* Selects de la fila de filtros: misma altura y borde que el buscador. */
	.conf-select {
		min-height: 40px;
		padding: 0 0.7rem;
		border: 1.5px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.82rem;
		color: var(--text-primary);
		max-width: 220px;
	}
	.conf-select:focus-visible {
		outline: none;
		border-color: var(--accion);
	}
	.conf-resultado {
		font-size: 0.75rem;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.conf-marco {
		padding: 0;
	}

	/* ── Línea de tiempo ── */
	.conf-seccion {
		padding: 1rem 1.25rem;
	}
	.conf-seccion-cab {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.conf-seccion-cab h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--text-primary);
	}
	.conf-seccion-cab span {
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	/* `min(100%, …)`: en un teléfono la columna no puede pedir más que la pantalla. */
	.conf-grupos {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 24rem), 1fr));
	}
	.conf-grupo {
		padding: 0.75rem;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		background: var(--bg-base);
	}
	.conf-grupo-cab {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		font-size: 0.78rem;
	}
	.conf-grupo-cab strong {
		color: var(--text-primary);
	}
	.conf-grupo-cab > span,
	.conf-grupo-sede {
		font-weight: 500;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.conf-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.conf-chip {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid color-mix(in srgb, var(--accion) 35%, transparent);
		border-radius: 8px;
		background: var(--au-tint);
		color: var(--emerald-800);
		font-size: 0.68rem;
		font-variant-numeric: tabular-nums;
	}
	/* Jornada distinta a la histórica (10,33 h / 7,33 h): ámbar, como aviso. */
	.conf-chip--jornada {
		border-color: #b45309;
		background: rgba(180, 83, 9, 0.08);
		color: #92400e;
	}
	.conf-chip--inactiva {
		border-color: var(--border-default);
		background: var(--bg-surface);
		color: var(--text-muted);
	}
	.conf-chip-jornada {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}

	/* ── Celdas de la tabla ── */
	.conf-num {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.conf-empresa {
		font-weight: 700;
	}
	.conf-marca {
		margin-left: 0.4rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		vertical-align: middle;
	}
	.conf-marca--nueva {
		background: var(--au-tint);
		color: var(--emerald-800);
	}
	.conf-marca--actualizada {
		background: rgba(37, 99, 235, 0.1);
		color: #1d4ed8;
	}
	.conf-jornada-distinta {
		color: #b45309;
		font-weight: 700;
	}
	.conf-estado {
		margin-left: -0.45rem;
		padding: 0.3rem 0.45rem;
		border: 0;
		border-radius: 8px;
		background: none;
		cursor: pointer;
	}
	.conf-estado:hover:not(:disabled),
	.conf-estado:focus-visible {
		background: var(--bg-base);
		outline: none;
	}
	.conf-estado:disabled {
		cursor: default;
	}

	/* ── Tarjetas de detalle ── */
	.conf-tarjetas {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
	}
	@media (min-width: 1280px) {
		.conf-tarjetas {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.conf-tarjeta {
		padding: 1rem 1.1rem;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}
	.conf-tarjeta--nueva {
		border-color: var(--emerald-500);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 15%, transparent);
	}
	.conf-tarjeta--actualizada {
		border-color: #2563eb;
	}
	.conf-tarjeta-cab {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.conf-tarjeta-cab h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--text-primary);
	}
	.conf-tarjeta-cab small {
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.conf-valores {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0;
	}
	.conf-valor {
		padding: 0.55rem 0.65rem;
		border: 1px solid transparent;
		border-radius: 10px;
		background: var(--bg-base);
	}
	.conf-valor--jornada {
		border-color: rgba(180, 83, 9, 0.2);
		background: rgba(180, 83, 9, 0.06);
	}
	.conf-valor dt {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.conf-valor dd {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.conf-nota {
		margin: 0.75rem 0 0;
		padding: 0.55rem 0.65rem;
		border-radius: 10px;
		background: rgba(245, 158, 11, 0.08);
		color: #92400e;
		font-size: 0.75rem;
	}
	.conf-autor {
		margin: 0.75rem 0 0;
		font-size: 0.68rem;
		color: var(--text-very-muted);
	}

	/* Spinner del botón de guardar: el global, a tamaño de texto y en blanco. */
	.conf-spinner {
		width: 14px;
		height: 14px;
		border-width: 2px;
		border-color: rgba(255, 255, 255, 0.35);
		border-top-color: white;
	}
</style>
