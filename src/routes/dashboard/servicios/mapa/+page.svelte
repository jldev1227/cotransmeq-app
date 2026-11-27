<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	import { MAPBOX_WARM_STYLE } from '$lib/mapbox';
	import {
		ArrowLeft,
		Gauge,
		LocateFixed,
		MapPin,
		Radio,
		RefreshCw,
		Search,
		Truck,
		Wifi,
		WifiOff
	} from 'lucide-svelte';
	import { fetchConSesion } from '$lib/api/fetchConSesion';

	interface UnidadGps {
		id: string;
		placa: string;
		latitud: number | null;
		longitud: number | null;
		velocidadKmh: number | null;
		rumbo: number | null;
		fechaPosicion: string | null;
		tipoVehiculo?: 'camioneta' | 'bus';
	}

	interface ErrorGps {
		code: string;
		message: string;
	}

	interface DiagnosticoWialon {
		unidadesVisiblesWialon: number;
		elementosRecibidos: number;
		unidadesConNombre: number;
		elementosSinNombre: number;
		consultaPlacasBasica: boolean;
		consultaPosicionesFallida: boolean;
		unidadesConPosicion: number;
	}

	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
	const CLIENTE_WIALON = 'Cotransmeq';
	const INTERVALO_ACTUALIZACION_MS = 15_000;

	let contenedorMapa: HTMLDivElement;
	let mapa: mapboxgl.Map | null = null;
	let mapaListo = false;
	let encuadreInicial = false;
	let temporizador: ReturnType<typeof setInterval> | undefined;
	let marcadores = new Map<string, { marker: mapboxgl.Marker; element: HTMLImageElement }>();
	let unidades = $state<UnidadGps[]>([]);
	let placaBuscada = $state('');
	let unidadSeleccionadaId = $state<string | null>(null);
	let cargando = $state(true);
	let actualizando = $state(false);
	let conectandoWialon = $state(false);
	let cuentaWialonConfigurada = $state<boolean | null>(null);
	let diagnosticoWialon = $state<DiagnosticoWialon | null>(null);
	let errorGps = $state<ErrorGps | null>(null);
	let mensajeWialon = $state<string | null>(null);
	let errorAutorizacion = $state(false);
	let codigoAutorizacion = $state<string | null>(null);

	const unidadesVisibles = $derived.by(() => {
		const q = normalizar(placaBuscada);
		return q ? unidades.filter((unidad) => normalizar(unidad.placa).includes(q)) : unidades;
	});
	const unidadSeleccionada = $derived(
		unidades.find((unidad) => unidad.id === unidadSeleccionadaId) ?? null
	);

	function normalizar(valor: string): string {
		return valor
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLocaleLowerCase('es')
			.replace(/[^a-z0-9]/g, '');
	}

	function tieneCoordenadas(unidad: UnidadGps): boolean {
		return (
			typeof unidad.latitud === 'number' &&
			typeof unidad.longitud === 'number' &&
			Number.isFinite(unidad.latitud) &&
			Number.isFinite(unidad.longitud) &&
			Math.abs(unidad.latitud) <= 90 &&
			Math.abs(unidad.longitud) <= 180 &&
			!(unidad.latitud === 0 && unidad.longitud === 0)
		);
	}

	function iconoVehiculo(unidad: UnidadGps): string {
		return unidad.tipoVehiculo === 'bus'
			? `${base}/assets/marker-bus.svg`
			: `${base}/assets/marker-camioneta.png`;
	}

	function mensajeErrorAutorizacion(codigo: string): string {
		switch (codigo) {
			case 'WIALON_CALLBACK_INVALID':
				return 'El backend rechazó los datos del callback. Reinicia la autorización desde este mapa.';
			case 'WIALON_BACKEND_BAD_RESPONSE':
				return 'El backend recibió el callback, pero respondió con un formato inesperado. Revisa que esté actualizado y activo.';
			case 'WIALON_UNEXPECTED_ERROR':
				return 'Ocurrió un error inesperado al validar o guardar la cuenta. Consulta el log del backend para conocer el tipo de error.';
			case 'WIALON_CONNECTION_FAILED':
				return 'El backend devolvió un error genérico. Actualiza el backend y vuelve a iniciar la autorización.';
			case 'WIALON_CALLBACK_INCOMPLETE':
				return 'Wialon no devolvió el token al servidor; no se guardó. Inicia la autorización desde el botón de este mapa.';
			case 'WIALON_AUTH_STATE_INVALID':
				return 'La autorización venció o se inició en otra sesión. Vuelve al mapa y comienza de nuevo.';
			case 'WIALON_LOGIN_FAILED':
				return 'Wialon rechazó el token. Autoriza otra vez y verifica que la cuenta tenga acceso a seguimiento.';
			case 'WIALON_REQUEST_REJECTED':
				return 'Wialon aceptó la cuenta, pero no permitió consultar sus unidades. Revisa permisos y unidades asignadas.';
			case 'WIALON_BACKEND_UNAVAILABLE':
				return 'El token volvió al frontend, pero el backend no respondió; no se pudo guardar.';
			case 'WIALON_STORAGE_FAILED':
				return 'Wialon validó la cuenta, pero no se pudo guardar la credencial en la base de datos.';
			case 'WIALON_TOKEN_INVALID':
				return 'Wialon devolvió un token con formato inválido. Inicia la autorización de nuevo.';
			case 'WIALON_HTTP_ERROR':
				return 'El servidor de Wialon rechazó la solicitud HTTP. Inténtalo de nuevo en unos segundos.';
			case 'WIALON_INVALID_RESPONSE':
				return 'Wialon respondió con un formato inesperado. Inténtalo de nuevo.';
			case 'WIALON_UNAVAILABLE':
				return 'El backend no pudo comunicarse con Wialon. La credencial no se guardó; intenta de nuevo.';
			case 'WIALON_AUTHORIZATION_FAILED':
				return 'Wialon no completó la autorización. Vuelve a intentarlo desde este mapa.';
			default:
				return 'No se pudo completar la conexión con Wialon. Inténtalo de nuevo.';
		}
	}

	function tiempoPosicion(unidad: UnidadGps): string {
		if (!unidad.fechaPosicion) return 'Sin dato GPS';
		const minutos = Math.max(
			0,
			Math.floor((Date.now() - Date.parse(unidad.fechaPosicion)) / 60_000)
		);
		if (minutos < 1) return 'Ahora';
		if (minutos < 60) return `Hace ${minutos} min`;
		const horas = Math.floor(minutos / 60);
		return horas < 24 ? `Hace ${horas} h` : `Hace ${Math.floor(horas / 24)} d`;
	}

	function enfocar(unidad: UnidadGps): void {
		unidadSeleccionadaId = unidad.id;
		if (!mapa || !tieneCoordenadas(unidad)) return;
		mapa.flyTo({
			center: [unidad.longitud!, unidad.latitud!],
			zoom: Math.max(mapa.getZoom(), 12),
			padding: paddingMapa(),
			duration: 650
		});
	}

	function paddingMapa() {
		if (window.innerWidth <= 650) {
			return {
				top: 100,
				right: 45,
				bottom: Math.min(window.innerHeight * 0.42, 320) + 25,
				left: 45
			};
		}
		return { top: 70, right: 70, bottom: 70, left: window.innerWidth <= 900 ? 320 : 390 };
	}

	function actualizarMarcadores(): void {
		if (!mapa || !mapaListo) return;

		const conGps = unidadesVisibles.filter(tieneCoordenadas);
		const idsVisibles = new Set(conGps.map((unidad) => unidad.id));
		for (const [id, entrada] of marcadores) {
			if (idsVisibles.has(id)) continue;
			entrada.marker.remove();
			marcadores.delete(id);
		}

		for (const unidad of conGps) {
			let entrada = marcadores.get(unidad.id);
			if (!entrada) {
				const element = document.createElement('img');
				element.className = 'gps-marcador';
				element.src = iconoVehiculo(unidad);
				element.alt = `Centrar mapa en ${unidad.placa}`;
				element.title = unidad.placa;
				element.draggable = false;
				element.tabIndex = 0;
				element.setAttribute('role', 'button');
				const marker = new mapboxgl.Marker({ element, anchor: 'center' })
					.setLngLat([unidad.longitud!, unidad.latitud!])
					.setPopup(new mapboxgl.Popup({ offset: 18 }).setText(unidad.placa))
					.addTo(mapa);
				const seleccionar = () => {
					const actual = unidades.find((item) => item.id === unidad.id);
					if (actual) enfocar(actual);
				};
				element.addEventListener('click', seleccionar);
				element.addEventListener('keydown', (evento) => {
					if (evento.key === 'Enter' || evento.key === ' ') {
						evento.preventDefault();
						seleccionar();
					}
				});
				entrada = { marker, element };
				marcadores.set(unidad.id, entrada);
			}
			entrada.marker.setLngLat([unidad.longitud!, unidad.latitud!]);
			if (entrada.element.getAttribute('src') !== iconoVehiculo(unidad)) {
				entrada.element.src = iconoVehiculo(unidad);
			}
			entrada.element.classList.toggle('gps-marcador--bus', unidad.tipoVehiculo === 'bus');
			entrada.element.classList.toggle('gps-marcador--activo', unidad.id === unidadSeleccionadaId);
		}

		if (!encuadreInicial && conGps.length > 0) {
			const bounds = new mapboxgl.LngLatBounds();
			for (const unidad of conGps) bounds.extend([unidad.longitud!, unidad.latitud!]);
			if (conGps.length === 1) {
				mapa.flyTo({ center: [conGps[0].longitud!, conGps[0].latitud!], zoom: 12, padding: paddingMapa(), duration: 650 });
			} else {
				mapa.fitBounds(bounds, { padding: paddingMapa(), maxZoom: 12, duration: 650 });
			}
			encuadreInicial = true;
		}
	}

	async function cargarUnidades(): Promise<void> {
		actualizando = true;
		try {
			const response = await fetchConSesion('/api/maps/wialon/unidades');
			const data = await response.json().catch(() => ({}));
			if (typeof data?.configured === 'boolean') cuentaWialonConfigurada = data.configured;
			const diagnostico = data?.diagnostic;
			diagnosticoWialon =
				diagnostico &&
				typeof diagnostico.unidadesVisiblesWialon === 'number' &&
				typeof diagnostico.elementosRecibidos === 'number' &&
				typeof diagnostico.unidadesConNombre === 'number' &&
				typeof diagnostico.elementosSinNombre === 'number' &&
				typeof diagnostico.consultaPlacasBasica === 'boolean' &&
				typeof diagnostico.consultaPosicionesFallida === 'boolean' &&
				typeof diagnostico.unidadesConPosicion === 'number'
					? diagnostico
					: null;
			if (!response.ok) {
				errorGps = {
					code: typeof data?.code === 'string' ? data.code : 'WIALON_ERROR',
					message: typeof data?.error === 'string' ? data.error : 'No se pudo consultar la flota.'
				};
				return;
			}

			cuentaWialonConfigurada = true;
			unidades = Array.isArray(data?.units) ? data.units : [];
			errorGps = null;
			if (!unidadSeleccionadaId || !unidades.some((unidad) => unidad.id === unidadSeleccionadaId)) {
				unidadSeleccionadaId = unidades[0]?.id ?? null;
			}
			actualizarMarcadores();
		} catch {
			errorGps = {
				code: 'WIALON_NETWORK_ERROR',
				message:
					'No se pudo conectar con el servidor de seguimiento. Revisa la conexión e inténtalo de nuevo.'
			};
		} finally {
			cargando = false;
			actualizando = false;
		}
	}

	async function abrirWialon(): Promise<void> {
		if (conectandoWialon) return;
		conectandoWialon = true;
		mensajeWialon = null;
		errorAutorizacion = false;
		codigoAutorizacion = null;
		try {
			const response = await fetchConSesion('/api/maps/wialon/autorizar', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ origin: window.location.origin })
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok || typeof data?.state !== 'string') {
				throw new Error(
					typeof data?.error === 'string'
						? data.error
						: 'No se pudo iniciar la autorización de Wialon.'
				);
			}

			const callback = new URL('/api/maps/wialon/callback', window.location.origin);
			const autorizacion = new URL('https://hosting.wialon.com/login.html');
			for (const [clave, valor] of Object.entries({
				client_id: CLIENTE_WIALON,
				access_type: '768',
				activation_time: '0',
				duration: '0',
				lang: 'es',
				flags: '4',
				redirect_uri: callback.toString(),
				state: data.state
			})) {
				autorizacion.searchParams.set(clave, valor);
			}
			window.location.assign(autorizacion.toString());
		} catch (error) {
			mensajeWialon =
				error instanceof Error ? error.message : 'No se pudo iniciar la autorización de Wialon.';
			errorAutorizacion = true;
		} finally {
			conectandoWialon = false;
		}
	}

	onMount(() => {
		const query = new URLSearchParams(window.location.search);
		const estadoAutorizacion = query.get('wialon');
		if (estadoAutorizacion) {
			if (estadoAutorizacion === 'connected') {
				mensajeWialon = 'Cuenta Wialon conectada y sesión iniciada.';
				errorAutorizacion = false;
				cuentaWialonConfigurada = true;
			} else {
				errorAutorizacion = true;
				const codigo = query.get('code') ?? 'WIALON_CONNECTION_FAILED';
				codigoAutorizacion = /^WIALON_[A-Z_]+$/.test(codigo) ? codigo : 'WIALON_CONNECTION_FAILED';
				mensajeWialon = mensajeErrorAutorizacion(codigoAutorizacion);
			}
			const urlLimpia = new URL(window.location.href);
			urlLimpia.searchParams.delete('wialon');
			urlLimpia.searchParams.delete('code');
			void goto(`${urlLimpia.pathname}${urlLimpia.search}${urlLimpia.hash}`, {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			});
		}

		if (MAPBOX_TOKEN) {
			mapboxgl.accessToken = MAPBOX_TOKEN;
			mapa = new mapboxgl.Map({
				container: contenedorMapa,
				style: MAPBOX_WARM_STYLE,
				projection: 'mercator',
				center: [-74.0721, 4.711],
				zoom: 6,
				pitch: 0,
				bearing: 0,
				maxPitch: 0,
				dragRotate: false,
				touchPitch: false,
				attributionControl: true
			});
			mapa.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
			mapa.on('style.load', forzarVista2D);
			mapa.on('load', () => {
				forzarVista2D();
				mapaListo = true;
				actualizarMarcadores();
			});
		}

		void cargarUnidades();
		temporizador = setInterval(() => void cargarUnidades(), INTERVALO_ACTUALIZACION_MS);

		return () => {
			if (temporizador) clearInterval(temporizador);
			for (const { marker } of marcadores.values()) marker.remove();
			marcadores.clear();
			mapa?.remove();
			mapa = null;
		};
	});

	function forzarVista2D(): void {
		if (!mapa) return;
		mapa.setProjection('mercator');
		mapa.setTerrain(null);
		mapa.setMaxPitch(0);
		mapa.setPitch(0);
		mapa.setBearing(0);
		mapa.dragRotate.disable();
		mapa.touchZoomRotate.disableRotation();
		for (const capa of mapa.getStyle()?.layers ?? []) {
			if (['fill-extrusion', 'hillshade', 'model', 'sky'].includes(capa.type)) {
				mapa.setLayoutProperty(capa.id, 'visibility', 'none');
			}
		}
	}

	$effect(() => {
		unidadesVisibles;
		unidadSeleccionadaId;
		actualizarMarcadores();
	});
</script>

<svelte:head>
	<title>Seguimiento GPS · Servicios - Cotransmeq</title>
</svelte:head>

<div class="mapa-pagina">
	<div class="mapa-cabecera">
		<h1 class="mapa-oculto">Seguimiento de flota</h1>
		<button type="button" class="mapa-volver" onclick={() => goto('/dashboard/servicios')}>
			<ArrowLeft size={17} />
			<span>Servicios</span>
		</button>
		<div class="mapa-cabecera-acciones">
			<div class="mapa-estado" class:mapa-estado--error={!!errorGps}>
				{#if errorGps}<WifiOff size={15} />{:else}<Wifi size={15} />{/if}
				<span
					>{errorGps?.code === 'WIALON_NOT_CONFIGURED'
						? 'Pendiente de configuración'
						: errorGps
							? cuentaWialonConfigurada
								? 'Cuenta vinculada · Wialon sin respuesta'
								: 'Sin conexión'
							: cuentaWialonConfigurada
								? diagnosticoWialon?.consultaPosicionesFallida
									? unidades.length > 0
										? 'Placas visibles · revisar acceso GPS'
										: 'Conectado · revisar acceso GPS'
									: diagnosticoWialon?.unidadesConPosicion === 0 && unidades.length > 0
										? 'Placas visibles · sin posición GPS'
										: 'Conectado con Wialon'
								: actualizando && unidades.length === 0
									? 'Conectando'
									: 'Actualización automática'}</span
				>
			</div>
			<button
				type="button"
				class="mapa-actualizar"
				onclick={() => void cargarUnidades()}
				disabled={actualizando}
			>
				<RefreshCw size={15} class={actualizando ? 'girando' : ''} />
				Actualizar
			</button>
		</div>
	</div>
	{#if mensajeWialon}
		<div
			class="mapa-autorizacion-feedback"
			class:mapa-autorizacion-feedback--error={errorAutorizacion}
			role="status"
		>
			{mensajeWialon}
			{#if errorAutorizacion && codigoAutorizacion}<small>Código: {codigoAutorizacion}</small>{/if}
		</div>
	{/if}

	<main class="mapa-contenido">
		<aside class="mapa-placas">
			<div class="placas-cabecera">
				<div><span>UNIDADES</span><strong>Buscar por placa</strong></div>
				<span class="placas-contador">{unidadesVisibles.length}</span>
			</div>
			<label class="placas-busqueda">
				<Search size={17} />
				<input bind:value={placaBuscada} placeholder="Ej. ABC123" aria-label="Buscar por placa" />
				{#if placaBuscada}
					<button type="button" aria-label="Limpiar búsqueda" onclick={() => (placaBuscada = '')}
						>×</button
					>
				{/if}
			</label>
			<div class="placas-lista">
				{#if cargando}
					<div class="placas-vacio">
						<span class="cargando-punto"></span><strong>Conectando con Wialon…</strong>
					</div>
				{:else if unidadesVisibles.length === 0}
					<div class="placas-vacio">
						<Truck size={21} />
						<strong
							>{placaBuscada
								? 'No encontramos esa placa'
								: cuentaWialonConfigurada
									? 'Wialon no devolvió placas visibles'
									: 'Aún no hay unidades'}</strong
						>
						<span
							>{placaBuscada
								? 'Prueba con otra placa o nombre de unidad.'
								: cuentaWialonConfigurada
									? diagnosticoWialon?.elementosSinNombre
										? `Wialon devolvió ${diagnosticoWialon.elementosSinNombre} unidades sin nombre. Configura el nombre de cada unidad con su placa.`
										: diagnosticoWialon?.consultaPlacasBasica
											? `La consulta de placas de Wialon (flags=1) devolvió ${diagnosticoWialon.unidadesVisiblesWialon} unidades visibles. Revisa que este usuario tenga acceso a las unidades o al grupo que las contiene.`
										: 'La cuenta está conectada, pero Wialon no devolvió unidades para este usuario. Revisa que la cuenta tenga unidades asignadas y permiso para ver sus propiedades básicas.'
									: 'Cuando conectes Wialon, la flota aparecerá aquí.'}</span
						>
					</div>
				{:else}
					{#each unidadesVisibles as unidad (unidad.id)}
						<button
							type="button"
							class="placa-item"
							class:placa-item--activa={unidad.id === unidadSeleccionadaId}
							onclick={() => enfocar(unidad)}
						>
							<span class="placa-punto" class:placa-punto--sin-gps={!tieneCoordenadas(unidad)}
							></span>
							<span class="placa-datos">
								<strong>{unidad.placa}</strong>
								<small>{tiempoPosicion(unidad)}</small>
							</span>
							<span class="placa-velocidad">
								<strong
									>{unidad.velocidadKmh === null ? '—' : Math.round(unidad.velocidadKmh)}</strong
								>
								<small>km/h</small>
							</span>
						</button>
					{/each}
				{/if}
			</div>
			<div class="placas-pie"><span></span> Los datos se actualizan cada 15 segundos</div>
		</aside>

		<section class="mapa-visual" aria-label="Mapa de ubicación GPS">
			<div class="mapa-canvas" bind:this={contenedorMapa}></div>

			{#if errorGps?.code === 'WIALON_NOT_CONFIGURED'}
				<div class="mapa-conectar" role="status">
					<div class="conectar-icono"><Radio size={19} /></div>
					<div class="conectar-texto">
						<strong>Conecta la cuenta de rastreo</strong>
						<p>
							Autoriza tu cuenta en Wialon. Al volver, el servidor guardará la credencial y abrirá
							la sesión automáticamente.
						</p>
						<button
							type="button"
							class="conectar-enlace"
							onclick={() => void abrirWialon()}
							disabled={conectandoWialon}
							>{conectandoWialon ? 'Preparando autorización…' : 'Autorizar con Wialon'}
							<span>↗</span></button
						>
					</div>
				</div>
			{:else if errorGps}
				<div class="mapa-aviso" role="status">
					<WifiOff size={16} />
					<div class="mapa-aviso-contenido">
						<span>{errorGps.message}</span>
						{#if errorGps.code !== 'WIALON_NOT_CONFIGURED'}
							<button
								type="button"
								class="conectar-enlace"
								onclick={() => void abrirWialon()}
								disabled={conectandoWialon}
								>{conectandoWialon ? 'Preparando autorización…' : 'Reautorizar Wialon'}
								<span>↗</span></button
							>
						{/if}
						{#if codigoAutorizacion}<small>Código: {codigoAutorizacion}</small>{/if}
					</div>
				</div>
			{/if}

			{#if !MAPBOX_TOKEN}
				<div class="mapa-sin-token">
					<MapPin size={22} /><strong>Falta configurar Mapbox</strong><span
						>Agrega <code>VITE_MAPBOX_ACCESS_TOKEN</code> al entorno del frontend.</span
					>
				</div>
			{/if}

			{#if unidadSeleccionada && tieneCoordenadas(unidadSeleccionada)}
				<div class="mapa-seleccionada">
					<span class="seleccionada-icono"><LocateFixed size={17} /></span>
					<div><small>UNIDAD SELECCIONADA</small><strong>{unidadSeleccionada.placa}</strong></div>
					<div class="seleccionada-velocidad">
						<Gauge size={15} /><strong
							>{unidadSeleccionada.velocidadKmh === null
								? '—'
								: Math.round(unidadSeleccionada.velocidadKmh)} km/h</strong
						>
					</div>
				</div>
			{/if}
		</section>
	</main>

	{#if errorGps?.code === 'WIALON_NOT_CONFIGURED'}
		<details class="mapa-instrucciones">
			<summary>¿Cómo conectar Wialon por primera vez?</summary>
			<ol>
				<li>Selecciona «Autorizar con Wialon» e inicia sesión con tu usuario.</li>
				<li>Wialon volverá a esta página y la flota se cargará automáticamente.</li>
				<li>El servidor guarda el token cifrado y renueva la sesión cuando Wialon la vence.</li>
			</ol>
			<p>
				La autorización solicita seguimiento en línea y lectura de datos (permisos 256 + 512 = 768).
				Wialon elimina el token si pasan 100 días sin usarse.
			</p>
		</details>
	{/if}
</div>

<style>
	.mapa-pagina {
		position: fixed;
		inset: 0;
		z-index: 20;
		height: 100dvh;
		overflow: hidden;
		box-sizing: border-box;
		background: #f5f8f6;
		--mapa-acento: #166534;
		--mapa-suave: #f0fdf4;
		--mapa-borde: #e4e9e6;
		color: #17221d;
	}
	.mapa-cabecera {
		position: absolute;
		z-index: 5;
		top: 1rem;
		right: 1rem;
		left: 1rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		pointer-events: none;
	}
	.mapa-oculto {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.mapa-volver {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		border: 1px solid var(--mapa-borde);
		border-radius: 0.7rem;
		background: white;
		box-shadow: 0 5px 18px rgb(17 43 29 / 14%);
		color: #617068;
		cursor: pointer;
		font-size: 0.86rem;
		font-weight: 650;
		padding: 0.6rem 0.75rem;
		pointer-events: auto;
	}
	.mapa-volver:hover {
		color: var(--mapa-acento);
	}
	.mapa-cabecera-acciones {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		pointer-events: auto;
	}
	.mapa-estado,
	.mapa-actualizar {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		border: 1px solid var(--mapa-borde);
		border-radius: 0.7rem;
		background: white;
		color: #53635a;
		font-size: 0.78rem;
		font-weight: 650;
		padding: 0.6rem 0.75rem;
	}
	.mapa-estado {
		color: var(--mapa-acento);
	}
	.mapa-estado--error {
		color: #b45309;
		border-color: #f3dfc6;
		background: #fffaf2;
	}
	.mapa-actualizar {
		cursor: pointer;
	}
	.mapa-actualizar:hover:not(:disabled) {
		border-color: #a5c7b7;
		color: var(--mapa-acento);
	}
	.mapa-actualizar:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	:global(.girando) {
		animation: girar 1s linear infinite;
	}
	@keyframes girar {
		to {
			transform: rotate(360deg);
		}
	}
	.mapa-contenido {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.mapa-placas {
		position: absolute;
		z-index: 3;
		top: 4.75rem;
		bottom: 1rem;
		left: 1rem;
		display: flex;
		width: min(22rem, calc(100% - 2rem));
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--mapa-borde);
		border-radius: 0.9rem;
		background: #fff;
		box-shadow: 0 10px 32px rgb(17 43 29 / 18%);
	}
	.placas-cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1rem 0.75rem;
	}
	.placas-cabecera div {
		display: grid;
		gap: 0.2rem;
	}
	.placas-cabecera div span {
		color: #91a097;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.11em;
	}
	.placas-cabecera strong {
		color: #25332b;
		font-size: 0.96rem;
	}
	.placas-contador {
		display: grid;
		min-width: 1.8rem;
		height: 1.8rem;
		place-items: center;
		border-radius: 0.6rem;
		background: var(--mapa-suave);
		color: var(--mapa-acento);
		font-size: 0.78rem;
		font-weight: 750;
	}
	.placas-busqueda {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin: 0 1rem 0.6rem;
		border: 1px solid var(--mapa-borde);
		border-radius: 0.7rem;
		color: #87948c;
		padding: 0.6rem 0.7rem;
	}
	.placas-busqueda:focus-within {
		border-color: #91bca5;
		box-shadow: 0 0 0 3px rgb(4 120 87 / 8%);
	}
	.placas-busqueda input {
		width: 100%;
		border: 0;
		outline: 0;
		background: transparent;
		color: #24342a;
		font: inherit;
		font-size: 0.82rem;
	}
	.placas-busqueda input::placeholder {
		color: #a1aca5;
	}
	.placas-busqueda button {
		border: 0;
		background: transparent;
		color: #829088;
		cursor: pointer;
		font-size: 1.25rem;
		line-height: 1;
	}
	.placas-lista {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.25rem 0.5rem;
	}
	.placa-item {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.65rem;
		border: 0;
		border-radius: 0.65rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0.72rem 0.6rem;
		text-align: left;
	}
	.placa-item:hover {
		background: #f7faf8;
	}
	.placa-item--activa {
		background: var(--mapa-suave);
	}
	.placa-punto {
		flex: 0 0 auto;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: #16a36d;
		box-shadow: 0 0 0 3px rgb(22 163 109 / 12%);
	}
	.placa-punto--sin-gps {
		background: #aab3ad;
		box-shadow: 0 0 0 3px rgb(170 179 173 / 15%);
	}
	.placa-datos {
		display: grid;
		flex: 1;
		min-width: 0;
		gap: 0.18rem;
	}
	.placa-datos strong {
		overflow: hidden;
		color: #27352d;
		font-size: 0.82rem;
		font-weight: 750;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.placa-datos small {
		color: #87948b;
		font-size: 0.69rem;
	}
	.placa-velocidad {
		display: grid;
		min-width: 2.5rem;
		justify-items: end;
		gap: 0.15rem;
	}
	.placa-velocidad strong {
		color: #34483b;
		font-size: 0.84rem;
		font-variant-numeric: tabular-nums;
	}
	.placa-velocidad small {
		color: #87948b;
		font-size: 0.62rem;
	}
	.placas-vacio {
		display: grid;
		min-height: 12rem;
		align-content: center;
		justify-items: center;
		gap: 0.55rem;
		padding: 1.25rem;
		color: #9aa69e;
		text-align: center;
	}
	.placas-vacio strong {
		color: #56665d;
		font-size: 0.82rem;
	}
	.placas-vacio span:not(.cargando-punto) {
		color: #8d9a91;
		font-size: 0.74rem;
		line-height: 1.5;
	}
	.cargando-punto {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--mapa-acento);
		animation: pulso 1s ease-in-out infinite alternate;
	}
	@keyframes pulso {
		to {
			opacity: 0.35;
			transform: scale(0.7);
		}
	}
	.placas-pie {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		border-top: 1px solid #f0f2f0;
		color: #99a49d;
		font-size: 0.65rem;
		padding: 0.7rem 0.9rem;
	}
	.placas-pie span {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: #17a36d;
	}
	.mapa-visual {
		position: absolute;
		inset: 0;
		min-width: 0;
		min-height: 0;
		background: #e7ece8;
	}
	.mapa-canvas {
		position: absolute;
		inset: 0;
	}
	.mapa-conectar,
	.mapa-aviso {
		position: absolute;
		z-index: 2;
		top: 4.75rem;
		left: 24rem;
		display: flex;
		width: min(32rem, calc(100% - 25rem));
		gap: 0.75rem;
		border: 1px solid #e8e8d6;
		border-radius: 0.85rem;
		background: rgb(255 255 252 / 96%);
		box-shadow: 0 12px 32px rgb(27 45 34 / 13%);
		padding: 0.85rem;
		backdrop-filter: blur(10px);
	}
	.mapa-autorizacion-feedback {
		position: absolute;
		z-index: 5;
		top: 4.75rem;
		left: 24rem;
		width: min(32rem, calc(100% - 25rem));
		border: 1px solid #cde7d8;
		border-radius: 0.7rem;
		background: #f1faf4;
		color: #276344;
		font-size: 0.82rem;
		padding: 0.65rem 0.85rem;
	}
	.mapa-autorizacion-feedback--error {
		border-color: #f1dfc7;
		background: #fffaf2;
		color: #9b621c;
	}
	.mapa-autorizacion-feedback small {
		display: block;
		margin-top: 0.2rem;
		font-size: 0.68rem;
	}
	.conectar-icono {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.7rem;
		background: #f2f3e6;
		color: #7b7c37;
	}
	.conectar-texto {
		display: grid;
		gap: 0.28rem;
	}
	.conectar-texto strong {
		color: #30372a;
		font-size: 0.86rem;
	}
	.conectar-texto p {
		margin: 0;
		color: #6b7160;
		font-size: 0.74rem;
		line-height: 1.5;
	}
	code {
		border-radius: 0.25rem;
		background: #f0f2ed;
		color: #415247;
		font-size: 0.9em;
		padding: 0.08rem 0.25rem;
	}
	.conectar-enlace {
		width: fit-content;
		border: 0;
		background: transparent;
		color: #6c6d2d;
		cursor: pointer;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 750;
		padding: 0.15rem 0 0;
	}
	.conectar-enlace:hover {
		text-decoration: underline;
	}
	.mapa-aviso {
		align-items: flex-start;
		border-color: #f1dfc7;
		background: rgb(255 251 244 / 96%);
		color: #9b621c;
		font-size: 0.76rem;
		line-height: 1.45;
	}
	.mapa-aviso-contenido {
		display: grid;
		gap: 0.35rem;
	}
	.mapa-aviso-contenido small {
		color: #8a744e;
		font-size: 0.68rem;
	}
	.mapa-sin-token {
		position: absolute;
		inset: 0;
		z-index: 3;
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 0.55rem;
		background: rgb(246 249 247 / 95%);
		color: #86958b;
		text-align: center;
	}
	.mapa-sin-token strong {
		color: #45564b;
		font-size: 0.9rem;
	}
	.mapa-sin-token span {
		font-size: 0.75rem;
	}
	.mapa-seleccionada {
		position: absolute;
		right: 1rem;
		bottom: 1rem;
		left: auto;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: fit-content;
		max-width: min(34rem, calc(100% - 25rem));
		border: 1px solid rgb(225 232 226 / 90%);
		border-radius: 0.8rem;
		background: rgb(255 255 255 / 94%);
		box-shadow: 0 6px 20px rgb(25 46 33 / 12%);
		padding: 0.65rem 0.8rem;
		backdrop-filter: blur(10px);
	}
	.seleccionada-icono {
		display: grid;
		width: 2rem;
		height: 2rem;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 0.6rem;
		background: var(--mapa-suave);
		color: var(--mapa-acento);
	}
	.mapa-seleccionada > div:nth-child(2) {
		display: grid;
		gap: 0.14rem;
	}
	.mapa-seleccionada small {
		color: #8c9990;
		font-size: 0.58rem;
		font-weight: 800;
		letter-spacing: 0.08em;
	}
	.mapa-seleccionada strong {
		color: #25342b;
		font-size: 0.8rem;
	}
	.seleccionada-velocidad {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-left: 0.35rem;
		border-left: 1px solid var(--mapa-borde);
		color: var(--mapa-acento);
		padding-left: 0.7rem;
	}
	.seleccionada-velocidad strong {
		color: #34483b;
		font-variant-numeric: tabular-nums;
	}
	.mapa-instrucciones {
		position: absolute;
		right: 1.25rem;
		bottom: 1.25rem;
		z-index: 4;
		width: min(30rem, calc(100% - 2.5rem));
		max-height: 50dvh;
		overflow-y: auto;
		border: 1px solid var(--mapa-borde);
		border-radius: 0.8rem;
		background: #fff;
		color: #5e6c63;
		font-size: 0.78rem;
		padding: 0.8rem 1rem;
	}
	.mapa-instrucciones summary {
		color: #34473b;
		cursor: pointer;
		font-weight: 700;
	}
	.mapa-instrucciones ol {
		display: grid;
		gap: 0.4rem;
		padding-left: 1.25rem;
		line-height: 1.5;
	}
	.mapa-instrucciones p {
		margin-bottom: 0;
		line-height: 1.55;
	}
	:global(.gps-marcador) {
		width: 1.9rem;
		height: 1.9rem;
		object-fit: contain;
		cursor: pointer;
		filter: drop-shadow(0 2px 2px rgb(17 43 29 / 35%));
	}
	:global(.gps-marcador--bus) {
		width: 2.3rem;
		height: 1.55rem;
	}
	:global(.gps-marcador--activo) {
		filter: drop-shadow(0 0 3px var(--mapa-acento)) drop-shadow(0 2px 2px rgb(17 43 29 / 35%));
	}
	:global(.gps-marcador:hover),
	:global(.gps-marcador:focus-visible) {
		z-index: 2;
		filter: drop-shadow(0 0 4px var(--mapa-acento));
	}
	:global(.mapa-visual .mapboxgl-ctrl-top-right) {
		top: 4.75rem;
		right: 1rem;
	}
	@media (max-width: 900px) {
		.mapa-placas {
			width: min(18rem, calc(100% - 2rem));
		}
		.mapa-conectar,
		.mapa-aviso,
		.mapa-autorizacion-feedback {
			left: 20rem;
			width: min(32rem, calc(100% - 21rem));
		}
		.mapa-seleccionada {
			max-width: calc(100% - 21rem);
		}
	}
	@media (max-width: 650px) {
		.mapa-cabecera {
			top: 0.65rem;
			right: 0.65rem;
			left: 0.65rem;
		}
		.mapa-cabecera-acciones {
			gap: 0.35rem;
		}
		.mapa-estado span {
			display: none;
		}
		.mapa-actualizar {
			font-size: 0;
		}
		.mapa-volver,
		.mapa-estado,
		.mapa-actualizar {
			padding: 0.55rem;
		}
		.mapa-placas {
			top: auto;
			right: 0.65rem;
			bottom: 0.65rem;
			left: 0.65rem;
			width: auto;
			height: min(42dvh, 20rem);
		}
		.mapa-seleccionada {
			top: 4.5rem;
			right: 0.65rem;
			bottom: auto;
			left: 0.65rem;
			max-width: calc(100% - 1.3rem);
		}
		.mapa-conectar,
		.mapa-aviso,
		.mapa-autorizacion-feedback {
			top: 4.5rem;
			right: 0.65rem;
			left: 0.65rem;
			width: auto;
		}
		:global(.mapa-visual .mapboxgl-ctrl-top-right) {
			top: 8.5rem;
			right: 0.65rem;
		}
		.mapa-instrucciones {
			right: 0.65rem;
			bottom: calc(min(42dvh, 20rem) + 1.3rem);
			width: calc(100% - 1.3rem);
		}
	}
</style>
