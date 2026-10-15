<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { tercerosAPI } from '$lib/api/terceros';
	import AnaliticaIndividual from './AnaliticaIndividual.svelte';
	import ModalFormVehiculo from '$lib/components/vehiculos/ModalFormVehiculo.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { Activity, ArrowLeft, CalendarDays, Gauge, Hash, Info, Mail, MapPin, Pencil, Phone, Truck, UserRound } from 'lucide-svelte';

	type Tipo = 'vehiculo' | 'tercero';
	interface Props { tipo: Tipo; entidadId: string; }
	let { tipo, entidadId }: Props = $props();
	let ficha = $state<any>(null);
	let cargando = $state(true);
	let error = $state('');
	const tab = $derived(page.url.searchParams.get('tab') === 'informacion' ? 'informacion' : 'actividad');
	let editandoVehiculo = $state(false);

	const esVehiculo = $derived(tipo === 'vehiculo');
	const volverA = $derived(esVehiculo ? '/dashboard/flota' : '/dashboard/terceros');
	const nombre = $derived(esVehiculo ? ficha?.placa || 'Vehículo' : ficha?.nombre_completo || 'Tercero');
	const subtitulo = $derived(
		esVehiculo
			? [ficha?.marca, ficha?.linea, ficha?.modelo].filter(Boolean).join(' · ') || 'Ficha de flota'
			: [tipoPersona(ficha?.tipo_persona), ficha?.identificacion].filter(Boolean).join(' · ')
	);
	const iniciales = $derived(
		nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((parte: string) => parte[0]).join('').toUpperCase()
	);
	const campos = $derived.by(() => esVehiculo
		? [
			['Placa', ficha?.placa], ['Estado', ficha?.estado], ['Clase', ficha?.clase_vehiculo],
			['Marca', ficha?.marca], ['Línea', ficha?.linea], ['Modelo', ficha?.modelo],
			['Color', ficha?.color], ['Kilometraje', ficha?.kilometraje == null ? null : Number(ficha.kilometraje).toLocaleString('es-CO') + ' km'],
			['Carrocería', ficha?.tipo_carroceria], ['Combustible', ficha?.combustible],
			['Número de motor', ficha?.numero_motor], ['VIN', ficha?.vin], ['Número de serie', ficha?.numero_serie],
			['Número de chasis', ficha?.numero_chasis], ['Fecha de matrícula', ficha?.fecha_matricula],
			['Tarjeta de operación', ficha?.tarjeta_operacion], ['Número interno', ficha?.numero_interno],
			['Empresa de afiliación', ficha?.empresa_afiliacion], ['Propietario', ficha?.propietario_nombre],
			['Identificación propietario', ficha?.propietario_identificacion]
		]
		: [
			['Nombre o razón social', ficha?.nombre_completo], ['Identificación', ficha?.identificacion],
			['Tipo', tipoPersona(ficha?.tipo_persona)], ['Régimen', ficha?.regimen],
			['Teléfono', ficha?.telefono], ['Correo', ficha?.correo], ['Dirección', ficha?.direccion],
			['Estado', ficha?.activo ? 'Activo' : 'Inactivo'], ['Creado', fecha(ficha?.created_at)],
			['Actualizado', fecha(ficha?.updated_at)], ['Notas', ficha?.notas]
		]
	);

	$effect(() => {
		void tipo;
		void entidadId;
		void cargar();
	});

	function cambiarTab(siguiente: 'informacion' | 'actividad') {
		const url = new URL(page.url);
		if (siguiente === 'actividad') url.searchParams.delete('tab');
		else url.searchParams.set('tab', siguiente);
		void goto(url, { keepFocus: true, noScroll: true });
	}

	async function cargar() {
		cargando = true;
		error = '';
		try {
			if (esVehiculo) {
				const respuesta = await vehiculosAPI.getById(entidadId);
				ficha = respuesta.data?.data ?? respuesta.data;
			} else ficha = await tercerosAPI.obtenerPorId(entidadId);
			if (!ficha) throw new Error('No se encontró la ficha solicitada.');
		} catch (e: any) {
			error = e?.response?.data?.message ?? e?.message ?? 'No se pudo cargar la ficha.';
		} finally {
			cargando = false;
		}
	}

	function tipoPersona(valor?: string) {
		return ({ PERSONA: 'Persona natural', EMPRESA: 'Empresa', PROPIETARIO_VEHICULO: 'Propietario de vehículo', PROVEEDOR: 'Proveedor' }[valor ?? ''] ?? valor ?? 'Sin clasificar');
	}
	function texto(valor: unknown) {
		if (valor == null || valor === '') return 'Sin registrar';
		return String(valor).replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
	}
	function fecha(valor?: string | null) {
		return valor ? new Date(valor).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
	}
</script>

<svelte:head><title>{nombre} · {esVehiculo ? 'Flota' : 'Terceros'}</title></svelte:head>

<div class="perfil-pagina">
	<div class="perfil-volver">
		<button type="button" class="btn-icon" aria-label="Volver al listado" onclick={() => goto(volverA)}>
			<ArrowLeft size={17} />
		</button>
		<span class="perfil-miga">
			<a href={volverA}>{esVehiculo ? 'Flota' : 'Terceros'}</a>
			<span aria-hidden="true">/</span>
			<strong>{nombre}</strong>
		</span>
	</div>

	{#if cargando}
		<CargaMascota tamano="pantalla" texto="Cargando ficha individual…" />
	{:else if error}
		<section class="page-card perfil-error">
			<div class="error-icono"><Truck size={24} /></div>
			<h1>No pudimos cargar la ficha</h1>
			<p>{error}</p>
			<button class="btn-secondary" onclick={() => goto(volverA)}><ArrowLeft size={17} /> Volver al listado</button>
		</section>
	{:else}
		<div class="perfil-grid">
			<aside class="perfil-aside">
				<section class="perfil-identidad">
					<div class="identidad-fondo" aria-hidden="true"><span></span><span></span></div>
					<div class="identidad-cuerpo">
						<div class="identidad-icono" aria-hidden="true">
							{#if esVehiculo}<Truck size={38} strokeWidth={1.65} />{:else}<b>{iniciales || '?'}</b>{/if}
						</div>
						<p class="identidad-eyebrow">{esVehiculo ? 'Vehículo' : tipoPersona(ficha.tipo_persona)}</p>
						<h1>{nombre}</h1>
						<p class="identidad-subtitulo">{subtitulo || 'Ficha individual'}</p>
						<div class="identidad-pills">
							<span><i></i>{esVehiculo ? texto(ficha.estado) : ficha.activo ? 'Activo' : 'Inactivo'}</span>
							{#if esVehiculo && ficha.clase_vehiculo}<span>{texto(ficha.clase_vehiculo)}</span>{/if}
						</div>
					</div>

					{#if esVehiculo}
						<dl class="identidad-cifras">
							<div><dt>Modelo</dt><dd>{ficha.modelo || '—'}</dd></div>
							<div><dt>Kilometraje</dt><dd>{ficha.kilometraje == null ? '—' : Number(ficha.kilometraje).toLocaleString('es-CO')}</dd></div>
							<div><dt>Combustible</dt><dd>{texto(ficha.combustible)}</dd></div>
						</dl>
					{/if}
				</section>

				<section class="page-card resumen-card">
					<p class="card-etiqueta">{esVehiculo ? 'Resumen del vehículo' : 'Datos de contacto'}</p>
					<div class="resumen-lista">
						{#if esVehiculo}
							<p><span><Truck size={16} /></span><b>{texto(ficha.tipo_carroceria || ficha.clase_vehiculo)}</b></p>
							<p><span><Hash size={16} /></span><b>Placa {ficha.placa}</b></p>
							<p><span><UserRound size={16} /></span><b>{ficha.propietario_nombre || 'Propietario sin registrar'}</b></p>
							<p><span><CalendarDays size={16} /></span><b>Matrícula: {fecha(ficha.fecha_matricula) || 'Sin registrar'}</b></p>
						{:else}
							<p><span><Hash size={16} /></span><b>{ficha.identificacion || 'Identificación sin registrar'}</b></p>
							<p><span><Phone size={16} /></span><b>{ficha.telefono || 'Teléfono sin registrar'}</b></p>
							<p><span><Mail size={16} /></span><b>{ficha.correo || 'Correo sin registrar'}</b></p>
							<p><span><MapPin size={16} /></span><b>{ficha.direccion || 'Dirección sin registrar'}</b></p>
						{/if}
					</div>
				</section>
			</aside>

			<main class="perfil-main">
				<section class="page-card expediente-cabecera">
					<div>
						<p class="card-etiqueta">Ficha individual</p>
						<h2>{esVehiculo ? 'Expediente del vehículo' : 'Expediente del tercero'}</h2>
						<p>Consulta la información registrada y la actividad relacionada.</p>
					</div>
					{#if esVehiculo}
						<div class="cabecera-acciones">
						<button type="button" class="btn-secondary" onclick={() => (editandoVehiculo = true)}><Pencil size={16} /> Editar vehículo</button>
						<div class="cabecera-dato">
							<Gauge size={17} />
							<span><small>Kilometraje actual</small><strong>{ficha.kilometraje == null ? 'Sin registrar' : Number(ficha.kilometraje).toLocaleString('es-CO') + ' km'}</strong></span>
						</div>
						</div>
					{/if}
				</section>

				<section class="page-card tabs-card">
					<div class="perfil-tabs" role="tablist" aria-label="Secciones de la ficha">
						<button type="button" role="tab" aria-selected={tab === 'informacion'} class:activo={tab === 'informacion'} onclick={() => cambiarTab('informacion')}>
							<span><Info size={15} /></span> Información
						</button>
						<button type="button" role="tab" aria-selected={tab === 'actividad'} class:activo={tab === 'actividad'} onclick={() => cambiarTab('actividad')}>
							<span><Activity size={15} /></span> Actividad y analítica
						</button>
					</div>
				</section>

				<section class="page-card contenido-card">
					{#if tab === 'actividad'}
						<div class="seccion-titulo">
							<div><p class="card-etiqueta">Sección activa</p><h2>Actividad y analítica</h2></div>
							<p>Indicadores operativos calculados para el período seleccionado.</p>
						</div>
						<AnaliticaIndividual {tipo} {entidadId} />
					{:else}
						<div class="seccion-titulo">
							<div><p class="card-etiqueta">Sección activa</p><h2>{esVehiculo ? 'Información del vehículo' : 'Información del tercero'}</h2></div>
							<p>Datos registrados y relaciones vigentes.</p>
						</div>
						<div class="datos-grid">
							{#each campos as campo}
								<div class:ancho={campo[0] === 'Notas' || campo[0] === 'Dirección'}>
									<small>{campo[0]}</small>
									<strong class:notas={campo[0] === 'Notas'}>{texto(campo[1])}</strong>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			</main>
		</div>
	{/if}
</div>

{#if esVehiculo}
	<ModalFormVehiculo
		open={editandoVehiculo}
		vehiculoId={entidadId}
		onclose={() => (editandoVehiculo = false)}
		onguardado={() => cargar()}
	/>
{/if}

<style>
	.perfil-pagina {
		min-height: 100%;
		padding: 1rem;
		background: var(--bg-base);
	}
	@media (min-width: 1024px) {
		.perfil-pagina { padding: 1.5rem 2rem 3rem; }
	}
	.perfil-volver {
		display: flex;
		align-items: center;
		gap: .75rem;
		margin-bottom: 1.25rem;
	}
	.perfil-miga {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: .5rem;
		color: var(--text-muted);
		font-size: .85rem;
	}
	.perfil-miga a { color: var(--text-muted); text-decoration: none; }
	.perfil-miga a:hover { color: var(--text-primary); }
	.perfil-miga strong {
		overflow: hidden;
		color: var(--text-primary);
		font-weight: 750;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.perfil-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
	}
	.perfil-aside {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.perfil-main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.cabecera-acciones { display: flex; align-items: center; justify-content: flex-end; gap: .75rem; flex-wrap: wrap; }
	@media (min-width: 800px) {
		.perfil-grid { grid-template-columns: 320px minmax(0, 1fr); }
		.perfil-aside { position: sticky; top: 1rem; }
	}
	@media (min-width: 1280px) {
		.perfil-grid { grid-template-columns: 380px minmax(0, 1fr); }
	}
	@media (min-width: 1536px) {
		.perfil-grid { grid-template-columns: 420px minmax(0, 1fr); }
	}
	.perfil-identidad {
		position: relative;
		overflow: hidden;
		padding: 1.5rem;
		border-radius: 24px;
		color: #fff;
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 72%);
		box-shadow: var(--shadow-card);
	}
	.identidad-fondo { position: absolute; inset: 0; pointer-events: none; }
	.identidad-fondo span {
		position: absolute;
		border-radius: 999px;
		background: rgba(255,255,255,.07);
	}
	.identidad-fondo span:first-child { width: 220px; height: 220px; top: -120px; right: -80px; }
	.identidad-fondo span:last-child { width: 110px; height: 110px; bottom: -50px; left: -35px; }
	.identidad-cuerpo {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.identidad-icono {
		width: 88px;
		height: 88px;
		display: grid;
		place-items: center;
		margin-bottom: 1rem;
		border: 3px solid rgba(255,255,255,.25);
		border-radius: 24px;
		color: white;
		background: rgba(255,255,255,.1);
		box-shadow: inset 0 1px rgba(255,255,255,.12);
	}
	.identidad-icono b { font-family: var(--font-display); font-size: 1.8rem; }
	.identidad-eyebrow, .card-etiqueta {
		margin: 0;
		font-size: .62rem;
		font-weight: 800;
		letter-spacing: .11em;
		text-transform: uppercase;
	}
	.identidad-eyebrow { color: rgba(255,255,255,.68); }
	.identidad-cuerpo h1 {
		margin: .3rem 0 0;
		font-family: var(--font-display);
		font-size: clamp(1.55rem, 3vw, 2rem);
		font-weight: 900;
		letter-spacing: -.035em;
	}
	.identidad-subtitulo {
		margin: .25rem 0 0;
		color: rgba(255,255,255,.72);
		font-size: .8rem;
		font-weight: 650;
		text-transform: uppercase;
	}
	.identidad-pills {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: .35rem;
		margin-top: .8rem;
	}
	.identidad-pills span {
		display: inline-flex;
		align-items: center;
		gap: .4rem;
		padding: .28rem .7rem;
		border-radius: 999px;
		color: white;
		background: rgba(255,255,255,.12);
		font-size: .69rem;
		font-weight: 750;
	}
	.identidad-pills i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #6ee7b7;
		box-shadow: 0 0 0 3px rgba(110,231,183,.12);
	}
	.identidad-cifras {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 1.25rem 0 0;
		padding-top: 1rem;
		border-top: 1px solid rgba(255,255,255,.14);
	}
	.identidad-cifras div { min-width: 0; padding: 0 .35rem; text-align: center; }
	.identidad-cifras div + div { border-left: 1px solid rgba(255,255,255,.14); }
	.identidad-cifras dt {
		font-size: .58rem;
		font-weight: 750;
		letter-spacing: .08em;
		text-transform: uppercase;
		color: rgba(255,255,255,.62);
	}
	.identidad-cifras dd {
		overflow: hidden;
		margin: .2rem 0 0;
		color: white;
		font-family: var(--font-display);
		font-size: .84rem;
		font-weight: 850;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.resumen-card { padding: 1rem 1.1rem; }
	.card-etiqueta { color: var(--text-muted); }
	.resumen-lista { display: grid; gap: .4rem; margin-top: .7rem; }
	.resumen-lista p {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: .65rem;
		margin: 0;
		padding: .55rem .6rem;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		color: var(--text-secondary);
		background: var(--bg-surface);
	}
	.resumen-lista p > span {
		width: 30px;
		height: 30px;
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		border-radius: 9px;
		color: var(--au-primary);
		background: var(--au-tint);
	}
	.resumen-lista b {
		min-width: 0;
		overflow: hidden;
		font-size: .78rem;
		font-weight: 680;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.expediente-cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
	}
	.expediente-cabecera h2, .seccion-titulo h2 {
		margin: .15rem 0 0;
		color: var(--bg-charcoal);
		font-family: var(--font-display);
		font-size: 1.05rem;
		font-weight: 850;
	}
	.expediente-cabecera > div > p:last-child, .seccion-titulo > p {
		margin: .2rem 0 0;
		color: var(--text-muted);
		font-size: .76rem;
	}
	.cabecera-dato {
		display: flex;
		align-items: center;
		gap: .65rem;
		padding: .55rem .75rem;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		color: var(--au-primary);
		background: var(--bg-base);
	}
	.cabecera-dato span { display: grid; gap: .08rem; }
	.cabecera-dato small { color: var(--text-muted); font-size: .58rem; font-weight: 750; text-transform: uppercase; letter-spacing: .07em; }
	.cabecera-dato strong { color: var(--text-primary); font-size: .78rem; }
	.tabs-card { padding: .65rem; }
	.perfil-tabs { display: flex; gap: .375rem; overflow-x: auto; scrollbar-width: none; }
	.perfil-tabs::-webkit-scrollbar { display: none; }
	.perfil-tabs button {
		display: inline-flex;
		align-items: center;
		gap: .5rem;
		flex: 0 0 auto;
		padding: .48rem .72rem;
		border: 1px solid transparent;
		border-radius: 12px;
		color: var(--text-secondary);
		background: transparent;
		font-family: inherit;
		font-size: .82rem;
		font-weight: 750;
		cursor: pointer;
	}
	.perfil-tabs button > span {
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 8px;
		color: var(--au-primary);
		background: var(--au-tint);
	}
	.perfil-tabs button.activo {
		border-color: rgba(var(--au-primary-rgb), .25);
		color: var(--au-primary);
		background: rgba(var(--au-primary-rgb), .1);
	}
	.perfil-tabs button.activo > span { color: white; background: var(--au-primary); }
	.contenido-card { padding: 1.5rem; }
	.seccion-titulo {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}
	.seccion-titulo > p { max-width: 26rem; text-align: right; }
	.datos-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 1px;
		overflow: hidden;
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		background: var(--border-subtle);
	}
	.datos-grid > div {
		min-width: 0;
		min-height: 82px;
		display: grid;
		align-content: center;
		gap: .42rem;
		padding: .9rem 1rem;
		background: var(--bg-surface);
	}
	.datos-grid .ancho { grid-column: 1 / -1; }
	.datos-grid small {
		color: var(--text-muted);
		font-size: .61rem;
		font-weight: 800;
		letter-spacing: .08em;
		text-transform: uppercase;
	}
	.datos-grid strong {
		overflow-wrap: anywhere;
		color: var(--text-primary);
		font-size: .84rem;
		line-height: 1.4;
	}
	.datos-grid .notas { font-weight: 600; white-space: pre-line; }
	.perfil-error {
		min-height: 55vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: .75rem;
		text-align: center;
	}
	.perfil-error h1 { margin: 0; font-family: var(--font-display); font-size: 1.15rem; }
	.perfil-error p { margin: 0; color: var(--text-muted); }
	.error-icono {
		width: 48px;
		height: 48px;
		display: grid;
		place-items: center;
		border-radius: 15px;
		color: #b91c1c;
		background: rgba(220,38,38,.1);
	}
	@media (max-width: 640px) {
		.expediente-cabecera, .seccion-titulo { align-items: flex-start; flex-direction: column; }
		.cabecera-dato { width: 100%; }
		.seccion-titulo > p { text-align: left; }
		.contenido-card { padding: 1rem; }
	}
</style>
