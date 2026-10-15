<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { clientesAPI } from '$lib/api/apiClient';
	import { listadoClientes } from '$lib/stores/volverListado';
	import { authStore } from '$lib/stores/auth';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import ModalFormCliente from '$lib/components/clientes/ModalFormCliente.svelte';
	import TarifasCliente from '$lib/components/clientes/TarifasCliente.svelte';
	import AnaliticaIndividual from '$lib/components/directorio/AnaliticaIndividual.svelte';
	import { Activity, ArrowLeft, Building2, CalendarDays, Check, FileText, Hash, Info, Mail, MapPin, Pencil, Phone, ReceiptText, Truck, UserRound } from 'lucide-svelte';

	type TipoCliente = 'EMPRESA' | 'PERSONA_NATURAL';
	type Servicio = {
		id: string;
		origen_especifico?: string;
		destino_especifico?: string;
		fecha_realizacion?: string | null;
		fecha_solicitud?: string;
		estado?: string;
		valor?: number | string;
		conductores?: { id: string; nombre: string; apellido: string; telefono?: string | null } | null;
		vehiculos?: { id: string; placa: string; marca?: string | null; modelo?: string | null } | null;
		municipios_servicio_origen_idTomunicipios?: { nombre_municipio: string; nombre_departamento: string } | null;
		municipios_servicio_destino_idTomunicipios?: { nombre_municipio: string; nombre_departamento: string } | null;
	};
	type Cliente = {
		id: string;
		nit: string;
		nombre: string;
		representante?: string | null;
		cedula?: string | null;
		telefono?: string | null;
		direccion?: string | null;
		correo?: string | null;
		municipio_sede?: string | null;
		departamento_sede?: string | null;
		requiere_osi: boolean;
		paga_recargos: boolean;
		tipo: TipoCliente;
		createdAt?: string;
		updatedAt?: string;
		servicio?: Servicio[];
		_count?: { recargos: number; pernotes: number; servicio: number };
	};
	type Tab = 'actividad' | 'info' | 'servicios' | 'tarifas';

	let cliente = $state<Cliente | null>(null);
	let isLoading = $state(true);
	let modalAbierto = $state(false);
	let error: string | null = $state(null);
	const clienteId = $derived(page.params.id as string);
	const puedeVerTarifas = $derived(!!$authStore.user && authStore.getAccessLevel('liquidaciones-servicios') !== null);
	const activeTab = $derived.by((): Tab => {
		const tab = page.url.searchParams.get('tab');
		if (tab === 'info' || tab === 'servicios') return tab;
		if (tab === 'tarifas' && puedeVerTarifas) return tab;
		return 'actividad';
	});
	const nombre = $derived.by((): string => cliente ? cliente.nombre : 'Cliente');
	const iniciales = $derived.by((): string => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((parte: string) => parte[0]).join('').toUpperCase());

	$effect(() => { void clienteId; void loadCliente(); });

	async function loadCliente() {
		isLoading = true;
		error = null;
		try {
			if (!clienteId) throw new Error('No encontramos el identificador del cliente.');
			const response = await clientesAPI.getById(clienteId);
			if (response.data?.success && response.data.data) cliente = response.data.data;
			else if (response.data?.data) cliente = response.data.data;
			else throw new Error('No se encontró el cliente.');
		} catch (err: any) {
			console.error('Error cargando cliente:', err);
			error = err?.response?.data?.message ?? err?.message ?? 'No se pudo cargar el cliente.';
		} finally {
			isLoading = false;
		}
	}

	function cambiarTab(tab: Tab) {
		const url = new URL(page.url);
		if (tab === 'actividad') url.searchParams.delete('tab');
		else url.searchParams.set('tab', tab);
		void goto(url, { keepFocus: true, noScroll: true });
	}
	function volver() { goto(listadoClientes.url()); }
	function texto(valor?: string | null) { return valor?.trim() || 'Sin registrar'; }
	function tipoLabel(tipo?: TipoCliente) { return tipo === 'PERSONA_NATURAL' ? 'Persona natural' : 'Empresa'; }
	function fecha(valor?: string | null) {
		if (!valor) return 'Sin fecha';
		const date = new Date(valor);
		return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
	}
	function estadoServicio(estado?: string) {
		const labels: Record<string, string> = { solicitado: 'Solicitado', en_curso: 'En curso', planificado: 'Planificado', realizado: 'Realizado', cancelado: 'Cancelado' };
		return labels[(estado ?? '').toLowerCase()] ?? estado ?? 'Sin estado';
	}
	function estadoClase(estado?: string) {
		const valor = (estado ?? '').toLowerCase();
		if (valor === 'realizado') return 'estado-realizado';
		if (valor === 'cancelado') return 'estado-cancelado';
		if (valor === 'en_curso') return 'estado-curso';
		return 'estado-pendiente';
	}
</script>

<svelte:head><title>{nombre} · Clientes</title></svelte:head>

<div class="perfil-pagina">
	<div class="perfil-volver">
		<button type="button" class="btn-icon" aria-label="Volver a clientes" onclick={volver}><ArrowLeft size={17} /></button>
		<span class="perfil-miga"><a href="/dashboard/clientes">Clientes</a><span aria-hidden="true">/</span><strong>{nombre}</strong></span>
	</div>

	{#if isLoading}
		<CargaMascota tamano="pantalla" texto="Cargando ficha individual del cliente…" />
	{:else if error}
		<section class="page-card estado-error"><div class="error-icon"><Building2 size={24} /></div><h1>No pudimos cargar la ficha</h1><p>{error}</p><button class="btn-secondary" onclick={volver}><ArrowLeft size={16} /> Volver a clientes</button></section>
	{:else if cliente}
		<div class="perfil-grid">
			<aside class="perfil-aside">
				<section class="perfil-identidad">
					<div class="identidad-cuerpo">
						<div class="identidad-icono"><Building2 size={32} strokeWidth={1.7} /></div>
						<p class="identidad-eyebrow">Ficha de cliente</p>
						<h1>{cliente.nombre}</h1>
						<p class="identidad-subtitulo">{tipoLabel(cliente.tipo)} · NIT {texto(cliente.nit)}</p>
						<div class="identidad-pills">
							<span class="pill-estado"><i></i>Activo</span>
							{#if cliente.requiere_osi}<span>Requiere OSI</span>{/if}
							{#if cliente.paga_recargos}<span>Genera recargos</span>{/if}
						</div>
					</div>
					<div class="identidad-cifras">
						<div><small>Servicios totales</small><strong>{cliente._count?.servicio ?? '—'}</strong></div>
						<div><small>Recargos</small><strong>{cliente._count?.recargos ?? '—'}</strong></div>
					</div>
				</section>

				<section class="page-card resumen-card">
					<p class="card-etiqueta">Contacto y sede principal</p>
					<div class="resumen-lista">
						<p><span><Hash size={16} /></span><b>{texto(cliente.nit)}</b></p>
						<p><span><Phone size={16} /></span><b>{texto(cliente.telefono)}</b></p>
						<p><span><Mail size={16} /></span><b>{texto(cliente.correo)}</b></p>
						<p><span><MapPin size={16} /></span><b>{texto(cliente.direccion)}</b></p>
						<p><span><Building2 size={16} /></span><b>{[cliente.municipio_sede, cliente.departamento_sede].filter(Boolean).join(' · ') || 'Sede sin registrar'}</b></p>
					</div>
				</section>
			</aside>

			<main class="perfil-main">
				<section class="page-card expediente-cabecera">
					<div><p class="card-etiqueta">Relación comercial</p><h2>{activeTab === 'actividad' ? 'Actividad y cobertura del cliente' : 'Expediente del cliente'}</h2><p>Consulta servicios, cobertura geográfica, datos de contacto y operación del cliente.</p></div>
					<button type="button" class="btn-secondary" onclick={() => (modalAbierto = true)}><Pencil size={16} /> Editar cliente</button>
				</section>

				<section class="page-card tabs-card">
					<div class="perfil-tabs" role="tablist" aria-label="Secciones de la ficha del cliente">
						<button type="button" role="tab" aria-selected={activeTab === 'actividad'} class:activo={activeTab === 'actividad'} onclick={() => cambiarTab('actividad')}><span><Activity size={15} /></span> Actividad y cobertura</button>
						<button type="button" role="tab" aria-selected={activeTab === 'info'} class:activo={activeTab === 'info'} onclick={() => cambiarTab('info')}><span><Info size={15} /></span> Información</button>
						<button type="button" role="tab" aria-selected={activeTab === 'servicios'} class:activo={activeTab === 'servicios'} onclick={() => cambiarTab('servicios')}><span><Truck size={15} /></span> Servicios <em>{cliente._count?.servicio ?? 0}</em></button>
						{#if puedeVerTarifas}<button type="button" role="tab" aria-selected={activeTab === 'tarifas'} class:activo={activeTab === 'tarifas'} onclick={() => cambiarTab('tarifas')}><span><ReceiptText size={15} /></span> Tarifas</button>{/if}
					</div>
				</section>

				<section class="page-card contenido-card">
					{#if activeTab === 'actividad'}
						<div class="seccion-titulo"><div><p class="card-etiqueta">Resumen operativo</p><h2>Servicios, zonas y desplazamientos</h2></div><p>Consulta un período o todo el histórico. Las métricas y el mapa usan la misma selección.</p></div>
						<AnaliticaIndividual tipo="cliente" entidadId={cliente.id} />
					{:else if activeTab === 'info'}
						<div class="seccion-titulo"><div><p class="card-etiqueta">Datos del directorio</p><h2>Información del cliente</h2></div><p>Datos de identificación, contacto y cobertura principal.</p></div>
						<div class="datos-grid">
							<div><small>Nombre o razón social</small><strong>{texto(cliente.nombre)}</strong></div>
							<div><small>Tipo de cliente</small><strong>{tipoLabel(cliente.tipo)}</strong></div>
							<div><small>NIT</small><strong>{texto(cliente.nit)}</strong></div>
							<div><small>{cliente.tipo === 'EMPRESA' ? 'Representante legal' : 'Nombre de contacto'}</small><strong>{texto(cliente.representante ?? cliente.nombre)}</strong></div>
							<div><small>Cédula del contacto</small><strong>{texto(cliente.cedula)}</strong></div>
							<div><small>Teléfono</small><strong>{texto(cliente.telefono)}</strong></div>
							<div><small>Correo electrónico</small><strong>{texto(cliente.correo)}</strong></div>
							<div class="ancho"><small>Dirección</small><strong>{texto(cliente.direccion)}</strong></div>
							<div><small>Municipio de la sede</small><strong>{texto(cliente.municipio_sede)}</strong></div>
							<div><small>Departamento de la sede</small><strong>{texto(cliente.departamento_sede)}</strong></div>
							<div><small>Requiere OSI</small><strong>{cliente.requiere_osi ? 'Sí' : 'No'}</strong></div>
							<div><small>Genera recargos</small><strong>{cliente.paga_recargos ? 'Sí' : 'No'}</strong></div>
							<div><small>Registrado</small><strong>{fecha(cliente.createdAt)}</strong></div>
						</div>
					{:else if activeTab === 'servicios'}
						<div class="seccion-titulo"><div><p class="card-etiqueta">Historial del cliente</p><h2>Servicios recientes</h2></div><p>{cliente._count?.servicio ?? 0} servicios en total. La analítica consolida servicios y planillas sin duplicar movimientos.</p></div>
						{#if cliente.servicio?.length}
							<div class="servicios-lista">
								{#each cliente.servicio as servicio (servicio.id)}
									<article class="servicio-item">
										<div class="servicio-icono"><Truck size={18} /></div>
										<div class="servicio-contenido"><div class="servicio-titulo"><strong>{servicio.origen_especifico || servicio.municipios_servicio_origen_idTomunicipios?.nombre_municipio || 'Origen sin registrar'} <span>→</span> {servicio.destino_especifico || servicio.municipios_servicio_destino_idTomunicipios?.nombre_municipio || 'Destino sin registrar'}</strong><span class="estado-servicio {estadoClase(servicio.estado)}">{estadoServicio(servicio.estado)}</span></div>
											<div class="servicio-meta"><span><CalendarDays size={13} /> {fecha(servicio.fecha_realizacion ?? servicio.fecha_solicitud)}</span>{#if servicio.vehiculos}<span><Truck size={13} /> {servicio.vehiculos.placa}</span>{/if}{#if servicio.conductores}<span><UserRound size={13} /> {servicio.conductores.nombre} {servicio.conductores.apellido}</span>{/if}</div>
										</div>
									</article>
								{/each}
							</div>
						{:else}
							<div class="vacio"><FileText size={22} /><strong>No hay servicios recientes</strong><span>El cliente tiene {cliente._count?.servicio ?? 0} servicios en el historial total.</span></div>
						{/if}
					{:else if activeTab === 'tarifas' && puedeVerTarifas}
						<TarifasCliente clienteId={cliente.id} clienteNombre={cliente.nombre} />
					{/if}
				</section>
			</main>
		</div>
	{/if}
</div>

<ModalFormCliente open={modalAbierto} {clienteId} onclose={() => (modalAbierto = false)} onguardado={loadCliente} />

<style>
	.perfil-pagina { min-height: 100%; padding: 1rem; background: var(--bg-base); }
	@media (min-width: 1024px) { .perfil-pagina { padding: 1.5rem 2rem 3rem; } }
	.perfil-volver { display: flex; align-items: center; gap: .75rem; margin-bottom: 1.25rem; }
	.perfil-miga { min-width: 0; display: flex; align-items: center; gap: .5rem; color: var(--text-muted); font-size: .85rem; }
	.perfil-miga a { color: var(--text-muted); text-decoration: none; }
	.perfil-miga a:hover { color: var(--text-primary); }
	.perfil-miga strong { overflow: hidden; color: var(--text-primary); font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
	.perfil-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
	.perfil-aside, .perfil-main { min-width: 0; display: flex; flex-direction: column; gap: 1rem; }
	@media (min-width: 900px) { .perfil-grid { grid-template-columns: minmax(265px, 320px) minmax(0, 1fr); } .perfil-aside { position: sticky; top: 1rem; } }
	.perfil-identidad { overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 20px; background: var(--bg-surface); box-shadow: 0 5px 20px rgba(15,23,42,.045); }
	.identidad-cuerpo { padding: 1.25rem; }
	.identidad-icono { width: 58px; height: 58px; display: grid; place-items: center; margin-bottom: 1rem; border-radius: 17px; color: var(--au-primary); background: var(--au-tint); }
	.identidad-eyebrow, .card-etiqueta { margin: 0; color: var(--text-muted); font-size: .68rem; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
	.identidad-cuerpo h1 { margin: .35rem 0; color: var(--text-primary); font-size: 1.35rem; font-weight: 850; line-height: 1.2; overflow-wrap: anywhere; }
	.identidad-subtitulo { margin: 0; color: var(--text-muted); font-size: .85rem; }
	.identidad-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
	.identidad-pills span { display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-secondary); background: var(--bg-muted); font-size: 10px; font-weight: 800; }
	.identidad-pills .pill-estado { color: #087a57; background: rgba(8,122,87,.07); border-color: rgba(8,122,87,.15); }
	.pill-estado i { width: 6px; height: 6px; border-radius: 50%; background: #087a57; }
	.identidad-cifras { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--border-subtle); }
	.identidad-cifras div { display: grid; gap: 4px; padding: 12px 16px; }
	.identidad-cifras div + div { border-left: 1px solid var(--border-subtle); }
	.identidad-cifras small, .cabecera-dato small { color: var(--text-muted); font-size: 10px; font-weight: 750; }
	.identidad-cifras strong { color: var(--text-primary); font-size: 18px; }
	.page-card { border: 1px solid var(--border-subtle); border-radius: 18px; background: var(--bg-surface); box-shadow: 0 4px 18px rgba(15,23,42,.035); }
	.resumen-card { padding: 1rem; }
	.resumen-lista { display: grid; gap: 5px; margin-top: 10px; }
	.resumen-lista p { min-width: 0; display: flex; align-items: flex-start; gap: 9px; margin: 0; padding: 8px 0; color: var(--text-secondary); font-size: 12px; }
	.resumen-lista p + p { border-top: 1px solid var(--border-subtle); }
	.resumen-lista p span { color: var(--au-primary); }
	.resumen-lista b { min-width: 0; overflow-wrap: anywhere; font-weight: 650; }
	.expediente-cabecera { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.15rem 1.25rem; }
	.expediente-cabecera h2 { margin: 4px 0; color: var(--text-primary); font-size: 1.15rem; font-weight: 850; }
	.expediente-cabecera p:last-child { margin: 0; color: var(--text-muted); font-size: 12px; }
	.expediente-cabecera > button { flex: 0 0 auto; }
	.tabs-card { padding: .45rem; }
	.perfil-tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: thin; }
	.perfil-tabs button { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; flex: 0 0 auto; padding: 0 12px; border: 1px solid transparent; border-radius: 11px; color: var(--text-muted); background: transparent; font-size: 12px; font-weight: 800; cursor: pointer; transition: .16s ease; }
	.perfil-tabs button > span { width: 23px; height: 23px; display: grid; place-items: center; border-radius: 7px; color: inherit; background: var(--bg-muted); }
	.perfil-tabs button.activo { border-color: rgba(8,122,87,.15); color: var(--au-primary); background: var(--au-tint); }
	.perfil-tabs button.activo > span { color: white; background: var(--au-primary); }
	.perfil-tabs em { padding: 2px 6px; border-radius: 8px; background: var(--bg-muted); font-size: 10px; font-style: normal; }
	.contenido-card { min-width: 0; padding: 1.15rem; }
	.seccion-titulo { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; margin-bottom: 1rem; }
	.seccion-titulo h2 { margin: 4px 0 0; color: var(--text-primary); font-size: 1rem; font-weight: 850; }
	.seccion-titulo > p { max-width: 400px; margin: 0; color: var(--text-muted); font-size: 11px; text-align: right; }
	.datos-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
	.datos-grid > div { min-width: 0; display: grid; align-content: start; gap: 5px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: 13px; background: var(--bg-muted); }
	.datos-grid .ancho { grid-column: 1 / -1; }
	.datos-grid small { color: var(--text-muted); font-size: 10px; font-weight: 800; text-transform: uppercase; }
	.datos-grid strong { color: var(--text-primary); font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
	.servicios-lista { display: grid; gap: 8px; }
	.servicio-item { display: flex; gap: 11px; padding: 13px; border: 1px solid var(--border-subtle); border-radius: 14px; background: var(--bg-surface); }
	.servicio-icono { width: 36px; height: 36px; display: grid; flex: 0 0 auto; place-items: center; border-radius: 11px; color: var(--au-primary); background: var(--au-tint); }
	.servicio-contenido { min-width: 0; flex: 1; }
	.servicio-titulo { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
	.servicio-titulo > strong { color: var(--text-primary); font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
	.servicio-titulo > strong span { padding: 0 3px; color: var(--au-primary); }
	.estado-servicio { flex: 0 0 auto; padding: 4px 7px; border-radius: 999px; font-size: 10px; font-weight: 800; }
	.estado-realizado { color: #047857; background: #ecfdf5; }
	.estado-cancelado { color: #b91c1c; background: #fef2f2; }
	.estado-curso { color: #1d4ed8; background: #eff6ff; }
	.estado-pendiente { color: #a16207; background: #fefce8; }
	.servicio-meta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; color: var(--text-muted); font-size: 10px; }
	.servicio-meta span { display: inline-flex; align-items: center; gap: 4px; }
	.vacio { min-height: 160px; display: grid; place-content: center; justify-items: center; gap: 7px; color: var(--text-muted); text-align: center; }
	.vacio strong { color: var(--text-primary); font-size: 13px; }
	.vacio span { font-size: 11px; }
	.estado-error { display: grid; justify-items: center; gap: 8px; padding: 3rem 1rem; text-align: center; }
	.estado-error h1 { margin: 4px 0 0; font-size: 1.2rem; }
	.estado-error p { margin: 0 0 10px; color: var(--text-muted); }
	.error-icon { display: grid; place-items: center; width: 50px; height: 50px; border-radius: 15px; color: #b91c1c; background: #fef2f2; }
	@media (max-width: 620px) { .perfil-pagina { padding: .75rem; } .expediente-cabecera, .seccion-titulo { align-items: flex-start; flex-direction: column; } .seccion-titulo > p { text-align: left; } .expediente-cabecera > button { width: 100%; justify-content: center; } .contenido-card { padding: .85rem; } .datos-grid { grid-template-columns: 1fr; } .datos-grid .ancho { grid-column: auto; } .servicio-titulo { flex-direction: column; } }
</style>
