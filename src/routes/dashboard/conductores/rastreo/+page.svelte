<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	import {
		ArrowLeft,
		Clock3,
		LocateFixed,
		MapPin,
		RefreshCw,
		Route,
		Search,
		ShieldCheck,
		X
	} from 'lucide-svelte';
	import { fetchConSesion } from '$lib/api/fetchConSesion';
	import { MAPBOX_WARM_STYLE } from '$lib/mapbox';

	type EstadoRastreo = 'sin_datos' | 'en_movimiento' | 'detenido' | 'sin_senal';
	interface ServicioRastreo {
		servicio_id: string;
		sesion_id: string;
		numero_planilla: string | null;
		fecha_realizacion: string | null;
		estado_servicio: string;
		conductor: { nombre: string; apellido: string; foto_signed_url: string | null };
		vehiculo: { placa: string | null };
		cliente: { nombre: string };
		origen: string;
		destino: string;
		destino_latitud: number | null;
		destino_longitud: number | null;
		fotoFirmadaDesde?: number;
		estado_actual: EstadoRastreo;
		ultimo_punto_at: string | null;
		ultimo_punto: {
			latitud: number;
			longitud: number;
			precision_m: number;
			velocidad_mps: number | null;
			capturado_at: string;
		} | null;
	}
	interface Projection {
		servicio_id: string;
		estado: 'calculando' | 'lista' | 'sin_destino' | 'no_disponible';
		distancia_m?: number;
		duracion_s?: number;
		geometry?: GeoJSON.LineString;
	}

	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
	const URL_RASTREO = '/api/rastreo-servicios';
	const URL_DIRECTIONS = 'https://api.mapbox.com/directions/v5/mapbox/driving/';
	const REFRESCO_MS = 15_000;
	const LINE_SOURCE = 'gps-proyeccion-line';
	const DEST_SOURCE = 'gps-proyeccion-destino';

	let contenedorMapa = $state<HTMLDivElement | undefined>(undefined);
	let mapa: mapboxgl.Map | null = null;
	let mapaListo = false;
	let servicios = $state<ServicioRastreo[]>([]);
	let busqueda = $state('');
	let activoId = $state<string | null>(null);
	let fijadoId = $state<string | null>(null);
	let proyeccion = $state<Projection | null>(null);
	let cargando = $state(true);
	let actualizando = $state(false);
	let error = $state<string | null>(null);
	let actualizadoAt = $state<Date | null>(null);
	let temporizador: ReturnType<typeof setInterval> | undefined;
	let temporizadorCierre: ReturnType<typeof setTimeout> | undefined;
	let controladorRuta: AbortController | null = null;
	let claveProyeccion = '';
	let encuadreInicial = false;
	const marcadores = new Map<
		string,
		{ marker: mapboxgl.Marker; element: HTMLButtonElement; foto: HTMLImageElement; iniciales: HTMLSpanElement; nombre: HTMLSpanElement; placa: HTMLSpanElement }
	>();

	const serviciosFiltrados = $derived.by(() => {
		const texto = normalizar(busqueda);
		if (!texto) return servicios;
		return servicios.filter((servicio) =>
			[
				nombreConductor(servicio),
				servicio.vehiculo.placa,
				servicio.cliente.nombre,
				servicio.origen,
				servicio.destino,
				servicio.numero_planilla
			]
				.filter(Boolean)
				.some((valor) => normalizar(String(valor)).includes(texto))
		);
	});
	const ubicables = $derived(
		serviciosFiltrados.filter(
			(servicio) =>
				servicio.ultimo_punto &&
				Number.isFinite(servicio.ultimo_punto.latitud) &&
				Number.isFinite(servicio.ultimo_punto.longitud)
		)
	);
	const conteoIndicadores = $derived.by(() => {
		const conteos = { enMovimiento: 0, detenido: 0, sinSenal: 0 };
		for (const servicio of ubicables) {
			if (servicio.estado_actual === 'en_movimiento') conteos.enMovimiento += 1;
			else if (servicio.estado_actual === 'detenido') conteos.detenido += 1;
			else conteos.sinSenal += 1;
		}
		return conteos;
	});
	const servicioActivo = $derived(
		servicios.find((servicio) => servicio.servicio_id === activoId) ?? null
	);
	const fechaFormato = new Intl.DateTimeFormat('es-CO', {
		timeZone: 'America/Bogota',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	$effect(() => {
		const listaFiltrada = serviciosFiltrados;
		if (mapa && mapaListo) sincronizarMarcadores(listaFiltrada);
	});

	function normalizar(valor: string): string {
		return valor
			.toLocaleLowerCase('es')
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.trim();
	}

	function nombreConductor(servicio: ServicioRastreo): string {
		return [servicio.conductor.nombre, servicio.conductor.apellido].filter(Boolean).join(' ');
	}

	function fecha(valor: string | null | undefined): string {
		if (!valor) return 'Sin lectura';
		const fechaValor = new Date(valor);
		return Number.isNaN(fechaValor.getTime()) ? 'Sin lectura' : fechaFormato.format(fechaValor);
	}

	function estado(valor: EstadoRastreo): { texto: string; clase: string } {
		const estados: Record<EstadoRastreo, { texto: string; clase: string }> = {
			sin_datos: { texto: 'Sin datos', clase: 'neutro' },
			en_movimiento: { texto: 'En movimiento', clase: 'movimiento' },
			detenido: { texto: 'Detenido', clase: 'detenido' },
			sin_senal: { texto: 'Sin señal', clase: 'neutro' }
		};
		return estados[valor] ?? estados.sin_datos;
	}

	async function cargar(): Promise<void> {
		if (actualizando) return;
		actualizando = true;
		error = null;
		try {
			const respuesta = await fetchConSesion(URL_RASTREO);
			if (!respuesta.ok) {
				if (respuesta.status === 403) throw new Error('No tienes permiso para consultar el rastreo GPS.');
				throw new Error('No se pudo actualizar la ubicación de los conductores.');
			}
			const cuerpo = await respuesta.json();
			const lista = cuerpo?.data?.servicios ?? cuerpo?.servicios;
			if (!Array.isArray(lista)) throw new Error('El servidor respondió con datos de rastreo inválidos.');
			const anteriores = new Map(servicios.map((servicio) => [servicio.servicio_id, servicio]));
			const ahora = Date.now();
			servicios = (lista as ServicioRastreo[]).map((servicio) => {
				const anterior = anteriores.get(servicio.servicio_id);
				const reusarFoto =
					anterior?.sesion_id === servicio.sesion_id &&
					anterior.fotoFirmadaDesde != null &&
					ahora - anterior.fotoFirmadaDesde < 50 * 60_000 &&
					!!anterior.conductor.foto_signed_url;
				const foto = reusarFoto
					? anterior!.conductor.foto_signed_url
					: servicio.conductor.foto_signed_url;
				return {
					...servicio,
					fotoFirmadaDesde: foto ? (reusarFoto ? anterior!.fotoFirmadaDesde : ahora) : undefined,
					conductor: { ...servicio.conductor, foto_signed_url: foto }
				};
			});
			actualizadoAt = new Date();
			if (mapa && mapaListo) sincronizarMarcadores(serviciosFiltrados);
			if (activoId) {
				const actual = servicios.find((servicio) => servicio.servicio_id === activoId);
				if (actual) void cargarProyeccion(actual);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo actualizar la ubicación de los conductores.';
		} finally {
			cargando = false;
			actualizando = false;
		}
	}

	function iniciarMapa(): void {
		if (!MAPBOX_TOKEN || !contenedorMapa || mapa) return;
		mapboxgl.accessToken = MAPBOX_TOKEN;
		mapa = new mapboxgl.Map({
			container: contenedorMapa,
			style: MAPBOX_WARM_STYLE,
			projection: 'mercator',
			center: [-74.0721, 4.711],
			zoom: 5,
			pitch: 0,
			bearing: 0,
			maxPitch: 0,
			dragRotate: false,
			touchPitch: false,
			attributionControl: true
		});
		mapa.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
		mapa.on('style.load', forzarVista2D);
		mapa.on('load', () => {
			if (!mapa) return;
			forzarVista2D();
			mapa.addSource(LINE_SOURCE, {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] }
			});
			mapa.addLayer({
				id: LINE_SOURCE + '-borde',
				type: 'line',
				source: LINE_SOURCE,
				filter: ['==', '$type', 'LineString'],
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: { 'line-color': '#fffaf3', 'line-width': 8, 'line-opacity': 0.92 }
			});
			mapa.addLayer({
				id: LINE_SOURCE,
				type: 'line',
				source: LINE_SOURCE,
				filter: ['==', '$type', 'LineString'],
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: { 'line-color': '#b65b38', 'line-width': 4.5, 'line-opacity': 0.95 }
			});
			mapa.addLayer({
				id: LINE_SOURCE + '-destino',
				type: 'circle',
				source: LINE_SOURCE,
				filter: ['==', '$type', 'Point'],
				paint: {
					'circle-radius': 7,
					'circle-color': '#b65b38',
					'circle-stroke-color': '#fffaf3',
					'circle-stroke-width': 3
				}
			});
			mapaListo = true;
			sincronizarMarcadores(serviciosFiltrados);
			actualizarProyeccionEnMapa();
		});
	}

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

	function crearMarcador(servicio: ServicioRastreo) {
		/// Mapbox posiciona el ancla con `transform`; el botón interior puede animarse sin arrastrar el punto del mapa.
		const ancla = document.createElement('div');
		ancla.className = 'gps-marker-anchor';

		const boton = document.createElement('button');
		boton.type = 'button';
		boton.className = 'gps-marker';
		boton.setAttribute('aria-label', 'Ubicación de ' + nombreConductor(servicio) + ', vehículo ' + (servicio.vehiculo.placa || 'sin placa'));

		const avatar = document.createElement('span');
		avatar.className = 'gps-marker__avatar';
		const iniciales = document.createElement('span');
		iniciales.className = 'gps-marker__iniciales';
		iniciales.textContent = nombreConductor(servicio)
			.split(/\s+/)
			.map((parte) => parte[0] ?? '')
			.slice(0, 2)
			.join('')
			.toLocaleUpperCase('es');
		const foto = document.createElement('img');
		foto.alt = '';
		foto.decoding = 'async';
		foto.loading = 'lazy';
		foto.addEventListener('load', () => {
			foto.hidden = false;
			iniciales.hidden = true;
		});
		foto.addEventListener('error', () => {
			foto.hidden = true;
			iniciales.hidden = false;
		});
		avatar.append(iniciales, foto);

		const etiqueta = document.createElement('span');
		etiqueta.className = 'gps-marker__etiqueta';
		const nombre = document.createElement('span');
		nombre.className = 'gps-marker__nombre';
		const placa = document.createElement('span');
		placa.className = 'gps-marker__placa';
		etiqueta.append(nombre, placa);
		boton.append(avatar, etiqueta);
		ancla.append(boton);

		const marcador = new mapboxgl.Marker({ element: ancla, anchor: 'bottom' })
			.setLngLat([servicio.ultimo_punto!.longitud, servicio.ultimo_punto!.latitud])
			.addTo(mapa!);
		const actualizarFoco = () => enfocarServicio(servicio.servicio_id);
		boton.addEventListener('pointerenter', actualizarFoco);
		boton.addEventListener('focus', actualizarFoco);
		boton.addEventListener('click', () => {
			fijadoId = fijadoId === servicio.servicio_id ? null : servicio.servicio_id;
			enfocarServicio(servicio.servicio_id);
			if (servicio.ultimo_punto && mapa) {
				mapa.flyTo({
					center: [servicio.ultimo_punto.longitud, servicio.ultimo_punto.latitud],
					zoom: Math.max(mapa.getZoom(), 13),
					duration: 550
				});
			}
		});

		const registro = { marker: marcador, element: boton, foto, iniciales, nombre, placa };
		actualizarMarcador(registro, servicio);
		return registro;
	}

	function actualizarMarcador(
		registro: ReturnType<typeof crearMarcador>,
		servicio: ServicioRastreo
	): void {
		const punto = servicio.ultimo_punto;
		if (!punto) return;
		registro.marker.setLngLat([punto.longitud, punto.latitud]);
		registro.element.dataset.estado = servicio.estado_actual;
		registro.element.setAttribute(
			'aria-label',
			'Ubicación de ' + nombreConductor(servicio) + ', vehículo ' + (servicio.vehiculo.placa || 'sin placa')
		);
		registro.nombre.textContent = nombreConductor(servicio);
		registro.placa.textContent = servicio.vehiculo.placa || 'Sin placa';
		registro.iniciales.textContent = nombreConductor(servicio)
			.split(/\s+/)
			.map((parte) => parte[0] ?? '')
			.slice(0, 2)
			.join('')
			.toLocaleUpperCase('es');
		const fotoActual = servicio.conductor.foto_signed_url;
		if (fotoActual && registro.foto.src !== fotoActual) {
			registro.foto.hidden = false;
			registro.iniciales.hidden = true;
			registro.foto.src = fotoActual;
		} else if (!fotoActual) {
			registro.foto.removeAttribute('src');
			registro.foto.hidden = true;
			registro.iniciales.hidden = false;
		}
	}

	function sincronizarMarcadores(lista: ServicioRastreo[]): void {
		if (!mapa) return;
		const conUbicacion = lista.filter((servicio) => servicio.ultimo_punto);
		const visibles = new Set(conUbicacion.map((servicio) => servicio.servicio_id));
		for (const [id, registro] of marcadores) {
			if (!visibles.has(id)) {
				registro.marker.remove();
				marcadores.delete(id);
			}
		}
		for (const servicio of conUbicacion) {
			const existente = marcadores.get(servicio.servicio_id);
			if (existente) actualizarMarcador(existente, servicio);
			else marcadores.set(servicio.servicio_id, crearMarcador(servicio));
		}
		if (!encuadreInicial && conUbicacion.length) ajustarEncuadre(conUbicacion);
	}

	function ajustarEncuadre(lista: ServicioRastreo[] = serviciosFiltrados): void {
		if (!mapa || !mapaListo) return;
		const conUbicacion = lista.filter((servicio) => servicio.ultimo_punto);
		if (!conUbicacion.length) return;
		const limites = new mapboxgl.LngLatBounds();
		for (const servicio of conUbicacion) {
			limites.extend([servicio.ultimo_punto!.longitud, servicio.ultimo_punto!.latitud]);
		}
		if (conUbicacion.length === 1) {
			mapa.flyTo({
				center: [conUbicacion[0].ultimo_punto!.longitud, conUbicacion[0].ultimo_punto!.latitud],
				zoom: 12,
				duration: 650
			});
		} else {
			mapa.fitBounds(limites, { padding: { top: 110, right: 90, bottom: 110, left: 90 }, maxZoom: 13, duration: 650 });
		}
		encuadreInicial = true;
	}

	function enfocarServicio(id: string): void {
		if (temporizadorCierre) clearTimeout(temporizadorCierre);
		activoId = id;
		const servicio = servicios.find((item) => item.servicio_id === id);
		if (servicio) void cargarProyeccion(servicio);
	}

	async function cargarProyeccion(servicio: ServicioRastreo): Promise<void> {
		const punto = servicio.ultimo_punto;
		if (!punto || servicio.destino_latitud == null || servicio.destino_longitud == null) {
			claveProyeccion = '';
			proyeccion = { servicio_id: servicio.servicio_id, estado: 'sin_destino' };
			actualizarProyeccionEnMapa();
			return;
		}
		const clave = [
			servicio.servicio_id,
			punto.longitud.toFixed(5),
			punto.latitud.toFixed(5),
			servicio.destino_longitud.toFixed(5),
			servicio.destino_latitud.toFixed(5)
		].join(':');
		if (clave === claveProyeccion) return;
		claveProyeccion = clave;
		controladorRuta?.abort();
		controladorRuta = new AbortController();
		proyeccion = { servicio_id: servicio.servicio_id, estado: 'calculando' };
		actualizarProyeccionEnMapa();
		if (!MAPBOX_TOKEN) {
			proyeccion = { servicio_id: servicio.servicio_id, estado: 'no_disponible' };
			return;
		}
		try {
			const coordenadas = [
				punto.longitud + ',' + punto.latitud,
				servicio.destino_longitud + ',' + servicio.destino_latitud
			].join(';');
			const url =
				URL_DIRECTIONS +
				coordenadas +
				'?alternatives=false&geometries=geojson&overview=full&access_token=' +
				encodeURIComponent(MAPBOX_TOKEN);
			const respuesta = await fetch(url, { signal: controladorRuta.signal });
			if (!respuesta.ok) throw new Error('Mapbox Directions devolvió ' + respuesta.status);
			const cuerpo = await respuesta.json();
			const ruta = cuerpo?.routes?.[0];
			if (!ruta?.geometry?.coordinates?.length) throw new Error('No hay ruta vial para este destino');
			const geometry = ruta.geometry as GeoJSON.LineString;
			proyeccion = {
				servicio_id: servicio.servicio_id,
				estado: 'lista',
				distancia_m: ruta.distance,
				duracion_s: ruta.duration,
				geometry
			};
			actualizarProyeccionEnMapa();
			if (mapa && geometry.coordinates.length) {
				const limites = new mapboxgl.LngLatBounds();
				for (const coordenada of geometry.coordinates) limites.extend(coordenada as [number, number]);
				const movil = window.matchMedia('(max-width: 800px)').matches;
				mapa.fitBounds(limites, {
					padding: { top: 115, right: movil ? 38 : 390, bottom: movil ? 360 : 95, left: 38 },
					maxZoom: 13,
					duration: 650
				});
			}
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			proyeccion = { servicio_id: servicio.servicio_id, estado: 'no_disponible' };
			actualizarProyeccionEnMapa();
		}
	}

	function actualizarProyeccionEnMapa(): void {
		if (!mapa || !mapaListo) return;
		const fuente = mapa.getSource(LINE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
		if (!fuente) return;
		const features: GeoJSON.Feature[] = [];
		if (proyeccion?.estado === 'lista' && proyeccion.geometry) {
			features.push({
				type: 'Feature',
				properties: { tipo: 'ruta' },
				geometry: proyeccion.geometry
			});
			const servicio = servicios.find((item) => item.servicio_id === proyeccion?.servicio_id);
			if (servicio?.destino_latitud != null && servicio.destino_longitud != null) {
				features.push({
					type: 'Feature',
					properties: { tipo: 'destino' },
					geometry: {
						type: 'Point',
						coordinates: [servicio.destino_longitud, servicio.destino_latitud]
					}
				});
			}
		}
		fuente.setData({ type: 'FeatureCollection', features });
	}

	function fijarServicio(servicioId: string): void {
		fijadoId = fijadoId === servicioId ? null : servicioId;
		enfocarServicio(servicioId);
	}

	onMount(() => {
		iniciarMapa();
		void cargar();
		temporizador = setInterval(() => {
			if (document.visibilityState === 'visible') void cargar();
		}, REFRESCO_MS);
	});

	onDestroy(() => {
		if (temporizador) clearInterval(temporizador);
		if (temporizadorCierre) clearTimeout(temporizadorCierre);
		controladorRuta?.abort();
		for (const registro of marcadores.values()) registro.marker.remove();
		marcadores.clear();
		mapa?.remove();
		mapa = null;
	});
</script>

<svelte:head>
	<title>Conductores en servicio · Ubicación en tiempo real</title>
	<meta name="theme-color" content="#f5f1e9" />
</svelte:head>

<main class="rastreo-pantalla">
	{#if MAPBOX_TOKEN}
		<div class="rastreo-mapa" bind:this={contenedorMapa} aria-label="Mapa de conductores en servicio"></div>
	{:else}
		<div class="rastreo-mapa rastreo-mapa--sin-configurar">
			<MapPin size={28} />
			<strong>Mapbox no está configurado</strong>
			<span>Configura VITE_MAPBOX_ACCESS_TOKEN para mostrar el mapa.</span>
		</div>
	{/if}

	<header class="rastreo-barra" class:conductorActivo={servicioActivo !== null}>
		<a class="rastreo-volver" href={resolve('/dashboard/personal?tipo=conductor')} aria-label="Volver a Personal">
			<ArrowLeft size={18} aria-hidden="true" />
		</a>
		<div class="rastreo-titulo">
			<span class="rastreo-titulo__eyebrow">Conductores · Ubicación compartida</span>
			<strong>En servicio ahora</strong>
			<small>{ubicables.length} {ubicables.length === 1 ? 'conductor ubicado' : 'conductores ubicados'} · {serviciosFiltrados.length} {serviciosFiltrados.length === 1 ? 'servicio activo' : 'servicios activos'}</small>
		</div>
		<label class="rastreo-busqueda">
			<Search size={16} aria-hidden="true" />
			<input
				bind:value={busqueda}
				placeholder="Conductor, placa o destino"
				aria-label="Buscar conductor, placa, cliente o destino"
				autocomplete="off"
			/>
			{#if busqueda}
				<button type="button" onclick={() => (busqueda = '')} aria-label="Limpiar búsqueda"><X size={14} /></button>
			{/if}
		</label>
		<button
			class="rastreo-actualizar"
			type="button"
			onclick={() => void cargar()}
			disabled={actualizando}
			aria-label="Actualizar ubicaciones"
			title="Actualizar ubicaciones"
		>
			<RefreshCw size={17} class={actualizando ? 'girando' : undefined} aria-hidden="true" />
		</button>
	</header>

	{#if error}
		<div class="rastreo-alerta" role="alert">
			<span>{error}</span><button type="button" onclick={() => void cargar()}>Reintentar</button>
		</div>
	{/if}

	{#if cargando}
		<div class="rastreo-carga" role="status"><span class="rastreo-spinner"></span> Conectando con los conductores…</div>
	{:else if !error && serviciosFiltrados.length === 0}
		<div class="rastreo-vacio">
			<span class="rastreo-vacio__icono"><MapPin size={22} /></span>
			<strong>{busqueda ? 'No encontramos conductores' : 'No hay conductores compartiendo ubicación'}</strong>
			<span>{busqueda ? 'Prueba con otro nombre, placa o destino.' : 'Los conductores aparecerán al iniciar un servicio y aceptar compartir su ubicación.'}</span>
		</div>
	{:else if !error && ubicables.length === 0}
		<div class="rastreo-vacio rastreo-vacio--compacto">
			<strong>Esperando la primera ubicación GPS</strong>
			<span>{serviciosFiltrados.length} {serviciosFiltrados.length === 1 ? 'servicio activo tiene' : 'servicios activos tienen'} una sesión consentida.</span>
		</div>
	{/if}

	{#if servicioActivo}
		<aside class="rastreo-ficha" aria-live="polite" aria-label="Detalle del conductor enfocado">
			<button class="rastreo-ficha__cerrar" type="button" onclick={() => { fijadoId = null; activoId = null; proyeccion = null; claveProyeccion = ''; controladorRuta?.abort(); actualizarProyeccionEnMapa(); }} aria-label="Cerrar detalle">
				<X size={16} aria-hidden="true" />
			</button>
			<header class="rastreo-ficha__conductor">
				{#if servicioActivo.conductor.foto_signed_url}
					<img src={servicioActivo.conductor.foto_signed_url} alt="" />
				{:else}
					<span>{nombreConductor(servicioActivo).split(/\s+/).map((parte) => parte[0] ?? '').slice(0, 2).join('').toLocaleUpperCase('es')}</span>
				{/if}
				<div>
					<strong>{nombreConductor(servicioActivo)}</strong>
					<small>{servicioActivo.vehiculo.placa || 'Vehículo sin placa'}</small>
				</div>
				<span class="estado-pill estado-pill--{estado(servicioActivo.estado_actual).clase}">
					<span></span>{estado(servicioActivo.estado_actual).texto}
				</span>
			</header>
			<div class="rastreo-ficha__cliente"><span>Cliente</span><strong>{servicioActivo.cliente.nombre}</strong></div>
			<div class="rastreo-ficha__trayecto">
				<div class="trayecto-punto"><span class="trayecto-punto__origen"></span><div><small>Origen</small><strong>{servicioActivo.origen}</strong></div></div>
				<div class="trayecto-conector"></div>
				<div class="trayecto-punto"><span class="trayecto-punto__destino"></span><div><small>Destino</small><strong>{servicioActivo.destino}</strong></div></div>
			</div>
			<div class="rastreo-ficha__pie">
				{#if proyeccion?.servicio_id === servicioActivo.servicio_id && proyeccion.estado === 'calculando'}
					<Route size={15} class="girando" /><span>Calculando ruta al destino…</span>
				{:else if proyeccion?.servicio_id === servicioActivo.servicio_id && proyeccion.estado === 'lista'}
					<Route size={15} /><strong>{((proyeccion.distancia_m ?? 0) / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} km</strong>
					<span>·</span><Clock3 size={14} /><span>{Math.max(1, Math.round((proyeccion.duracion_s ?? 0) / 60))} min por carretera</span>
				{:else if proyeccion?.servicio_id === servicioActivo.servicio_id && proyeccion.estado === 'sin_destino'}
					<Route size={15} /><span>No hay coordenadas para proyectar el destino.</span>
				{:else if proyeccion?.servicio_id === servicioActivo.servicio_id}
					<Route size={15} /><span>Proyección vial no disponible en este momento.</span>
				{:else}
					<Route size={15} /><span>Proyección del destino</span>
				{/if}
			</div>
			<div class="rastreo-ficha__ultima"><Clock3 size={13} /> Último punto · {fecha(servicioActivo.ultimo_punto_at)}</div>
		</aside>
	{/if}

	<footer class="rastreo-pie">
		<div class="rastreo-leyenda">
			<span><i class="punto punto--movimiento"></i> En movimiento <strong class="rastreo-leyenda__conteo">{conteoIndicadores.enMovimiento}</strong></span>
			<span><i class="punto punto--detenido"></i> Detenido <strong class="rastreo-leyenda__conteo">{conteoIndicadores.detenido}</strong></span>
			<span><i class="punto punto--neutro"></i> Sin señal/datos <strong class="rastreo-leyenda__conteo">{conteoIndicadores.sinSenal}</strong></span>
		</div>
		<div class="rastreo-consentimiento"><ShieldCheck size={14} /> Ubicación consentida · Retención 90 días</div>
		{#if actualizadoAt}<small>Actualizado {fechaFormato.format(actualizadoAt)}</small>{/if}
		<button class="rastreo-ajustar" type="button" onclick={() => ajustarEncuadre(serviciosFiltrados)} aria-label="Ver todos los conductores" title="Ver todos los conductores"><LocateFixed size={17} /></button>
	</footer>
</main>

<style>
	:global(html), :global(body) { overflow: hidden; }
	.rastreo-pantalla {
		position: fixed;
		inset: 0;
		z-index: 20;
		overflow: hidden;
		background: #f5f1e9;
		color: #302b25;
		font-family: var(--font-sans, system-ui, sans-serif);
	}
	.rastreo-mapa { position: absolute; inset: 0; }
	.rastreo-mapa--sin-configurar {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: .65rem;
		color: #76543e;
		text-align: center;
	}
	.rastreo-mapa--sin-configurar span { color: #776f67; font-size: .82rem; }
	.rastreo-barra {
		display: flex;
		position: absolute;
		top: 1rem;
		left: 1rem;
		z-index: 3;
		align-items: center;
		gap: .8rem;
		width: min(50rem, calc(100vw - 2rem));
		padding: .65rem;
		border: 1px solid rgb(255 255 255 / 88%);
		border-radius: .95rem;
		background: rgb(255 255 255 / 95%);
		box-shadow: 0 8px 30px rgb(47 39 30 / 13%);
		backdrop-filter: blur(18px);
	}
	.rastreo-barra.conductorActivo { width: min(50rem, calc(100vw - 26rem)); }
	.rastreo-volver, .rastreo-actualizar, .rastreo-busqueda button, .rastreo-ficha__cerrar, .rastreo-ajustar {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		border: 1px solid #eee8df;
		background: #fff;
		color: #785238;
		cursor: pointer;
	}
	.rastreo-volver { width: 2.65rem; height: 2.65rem; border-radius: .7rem; text-decoration: none; }
	.rastreo-titulo { display: flex; min-width: 11rem; flex: 0 0 auto; flex-direction: column; gap: .08rem; }
	.rastreo-titulo__eyebrow { color: #967961; font-size: .59rem; font-weight: 750; letter-spacing: .065em; text-transform: uppercase; }
	.rastreo-titulo strong { color: #302b25; font-size: .94rem; font-weight: 760; }
	.rastreo-titulo small { color: #777069; font-size: .65rem; }
	.rastreo-busqueda {
		display: flex;
		min-width: 10rem;
		min-height: 2.65rem;
		flex: 1 1 auto;
		align-items: center;
		gap: .45rem;
		margin-left: auto;
		padding: 0 .45rem .0 .7rem;
		border: 1px solid #eee8df;
		border-radius: .68rem;
		background: #fcfbf9;
		color: #8b8178;
	}
	.rastreo-busqueda input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #302b25; font: inherit; font-size: .72rem; }
	.rastreo-busqueda input::placeholder { color: #9c948b; }
	.rastreo-busqueda button { width: 1.8rem; height: 1.8rem; border-radius: .45rem; }
	.rastreo-actualizar { width: 2.65rem; height: 2.65rem; border-radius: .7rem; }
	.rastreo-actualizar:disabled { cursor: wait; opacity: .6; }
	.rastreo-alerta {
		display: flex;
		position: absolute;
		top: 5.7rem;
		left: 1rem;
		z-index: 4;
		align-items: center;
		gap: .8rem;
		padding: .7rem .9rem;
		border: 1px solid #f0d0c7;
		border-radius: .7rem;
		background: #fff9f6;
		color: #8d3527;
		font-size: .74rem;
		box-shadow: 0 4px 18px rgb(47 39 30 / 12%);
	}
	.rastreo-alerta button { border: 0; background: transparent; color: #8d3527; font: inherit; font-weight: 700; cursor: pointer; }
	.rastreo-carga, .rastreo-vacio {
		display: flex;
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 2;
		transform: translate(-50%, -50%);
		align-items: center;
		gap: .7rem;
		padding: 1rem 1.2rem;
		border: 1px solid rgb(255 255 255 / 85%);
		border-radius: .85rem;
		background: rgb(255 255 255 / 95%);
		color: #62584e;
		font-size: .8rem;
		text-align: center;
		box-shadow: 0 8px 30px rgb(47 39 30 / 14%);
		backdrop-filter: blur(16px);
	}
	.rastreo-vacio { max-width: min(28rem, calc(100vw - 2rem)); flex-direction: column; padding: 1.5rem; }
	.rastreo-vacio strong { color: #332c26; font-size: .9rem; }
	.rastreo-vacio > span:last-child { color: #776f67; font-size: .74rem; line-height: 1.45; }
	.rastreo-vacio__icono { display: grid; width: 2.75rem; height: 2.75rem; place-items: center; border-radius: 50%; background: #f7ece1; color: #a36342; }
	.rastreo-vacio--compacto { top: auto; bottom: 5.6rem; left: 50%; padding: .85rem 1rem; }
	.rastreo-vacio--compacto strong { font-size: .78rem; }
	.rastreo-ficha {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 3;
		width: min(23rem, calc(100vw - 2rem));
		padding: 1rem;
		border: 1px solid rgb(255 255 255 / 88%);
		border-radius: .95rem;
		background: rgb(255 255 255 / 96%);
		box-shadow: 0 8px 30px rgb(47 39 30 / 14%);
		backdrop-filter: blur(18px);
	}
	.rastreo-ficha__cerrar { position: absolute; top: .65rem; right: .65rem; width: 1.9rem; height: 1.9rem; border-radius: .55rem; }
	.rastreo-ficha__conductor { display: flex; align-items: center; justify-content: space-between; gap: .65rem; padding-right: 1.8rem; }
	.rastreo-ficha__conductor > img, .rastreo-ficha__conductor > span:first-child {
		display: grid;
		width: 2.7rem;
		height: 2.7rem;
		flex: 0 0 auto;
		place-items: center;
		overflow: hidden;
		border: 2px solid #efdfd1;
		border-radius: 50%;
		background: #f7ece1;
		color: #8e583a;
		font-size: .75rem;
		font-weight: 800;
		object-fit: cover;
	}
	.rastreo-ficha__conductor > div { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: .15rem; }
	.rastreo-ficha__conductor > div strong { overflow: hidden; color: #2e2924; font-size: .83rem; text-overflow: ellipsis; white-space: nowrap; }
	.rastreo-ficha__conductor > div small { color: #856044; font-size: .69rem; font-weight: 720; letter-spacing: .035em; }
	.estado-pill { display: inline-flex; flex: 0 0 auto; align-items: center; gap: .35rem; padding: .27rem .45rem; border-radius: 99px; font-size: .59rem; font-weight: 720; }
	.estado-pill > span { width: .42rem; height: .42rem; border-radius: 50%; background: currentColor; }
	.estado-pill--movimiento { background: #e6f3e8; color: #337349; }
	.estado-pill--detenido { background: #fbefd8; color: #8e641f; }
	.estado-pill--neutro { background: #efede9; color: #6c655e; }
	.rastreo-ficha__cliente { display: flex; flex-direction: column; gap: .16rem; margin-top: .85rem; padding-top: .7rem; border-top: 1px solid #f0ece7; }
	.rastreo-ficha__cliente span, .trayecto-punto small { color: #91877d; font-size: .59rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
	.rastreo-ficha__cliente strong { color: #4e443b; font-size: .72rem; }
	.rastreo-ficha__trayecto { display: flex; flex-direction: column; margin-top: .8rem; }
	.trayecto-punto { display: flex; align-items: center; gap: .55rem; }
	.trayecto-punto > div { display: flex; min-width: 0; flex-direction: column; gap: .13rem; }
	.trayecto-punto strong { overflow: hidden; color: #342e28; font-size: .72rem; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
	.trayecto-punto__origen, .trayecto-punto__destino { width: .58rem; height: .58rem; flex: 0 0 auto; border: 2px solid #c27c56; border-radius: 50%; background: white; }
	.trayecto-punto__destino { border-color: #a94731; background: #a94731; }
	.trayecto-conector { height: .65rem; margin-left: .26rem; border-left: 1px dashed #d3c2b2; }
	.rastreo-ficha__pie { display: flex; min-height: 2.2rem; align-items: center; gap: .4rem; margin-top: .75rem; padding: .45rem .55rem; border-radius: .58rem; background: #f8f3ed; color: #74533d; font-size: .67rem; }
	.rastreo-ficha__pie strong { color: #4f3d2e; font-size: .76rem; }
	.rastreo-ficha__ultima { display: flex; align-items: center; gap: .35rem; margin-top: .6rem; color: #8b8178; font-size: .62rem; }
	.rastreo-pie {
		display: flex;
		position: absolute;
		right: 1rem;
		bottom: 1rem;
		left: 1rem;
		z-index: 2;
		max-width: 52rem;
		min-height: 2.6rem;
		align-items: center;
		gap: 1rem;
		margin-inline: auto;
		padding: .4rem .55rem .4rem .85rem;
		border: 1px solid rgb(255 255 255 / 88%);
		border-radius: .8rem;
		background: rgb(255 255 255 / 94%);
		box-shadow: 0 5px 22px rgb(47 39 30 / 12%);
		backdrop-filter: blur(16px);
	}
	.rastreo-leyenda { display: flex; align-items: center; gap: .8rem; }
	.rastreo-leyenda > span, .rastreo-consentimiento { display: inline-flex; align-items: center; gap: .35rem; color: #665d54; font-size: .62rem; white-space: nowrap; }
	.rastreo-leyenda__conteo { display: inline-grid; min-width: 1.1rem; height: 1.1rem; padding: 0 .2rem; place-items: center; border-radius: 999px; background: #f0ece6; color: #51473d; font-size: .58rem; font-weight: 760; font-variant-numeric: tabular-nums; line-height: 1; }
	.punto { width: .48rem; height: .48rem; border-radius: 50%; }
	.punto--movimiento { background: #47835a; }
	.punto--detenido { background: #c18b31; }
	.punto--neutro { background: #99928a; }
	.rastreo-consentimiento { margin-left: auto; color: #796c60; }
	.rastreo-pie > small { color: #8b8178; font-size: .6rem; white-space: nowrap; }
	.rastreo-ajustar { width: 2rem; height: 2rem; margin-left: auto; border-radius: .55rem; }
	.rastreo-consentimiento + small { margin-left: 0; }
	.girando { animation: giro .85s linear infinite; }
	.rastreo-spinner { width: 1rem; height: 1rem; border: 2px solid #eadfd3; border-top-color: #a2613d; border-radius: 50%; animation: giro .85s linear infinite; }
	@keyframes giro { to { transform: rotate(360deg); } }

	:global(.gps-marker-anchor:hover), :global(.gps-marker-anchor:focus-within) { z-index: 1; }
	:global(.gps-marker) {
		display: flex;
		position: relative;
		align-items: center;
		gap: .38rem;
		padding: .2rem .46rem .2rem .2rem;
		border: 1px solid rgb(255 255 255 / 96%);
		border-radius: 999px;
		background: #fffdf9;
		color: #342d27;
		box-shadow: 0 3px 12px rgb(39 32 26 / 24%);
		cursor: pointer;
		white-space: nowrap;
		transition: transform 130ms ease, box-shadow 130ms ease;
	}
	:global(.gps-marker:hover), :global(.gps-marker:focus-visible) { transform: translateY(-2px) scale(1.04); box-shadow: 0 5px 15px rgb(39 32 26 / 30%); outline: 2px solid #b65b38; outline-offset: 2px; }
	:global(.gps-marker__avatar) { display: grid; width: 2rem; height: 2rem; flex: 0 0 auto; place-items: center; overflow: hidden; border: 2px solid #b65b38; border-radius: 50%; background: #f5e8dc; color: #814c32; font: 750 .62rem/1 system-ui, sans-serif; }
	:global(.gps-marker[data-estado='detenido'] .gps-marker__avatar) { border-color: #c18b31; }
	:global(.gps-marker[data-estado='sin_senal'] .gps-marker__avatar), :global(.gps-marker[data-estado='sin_datos'] .gps-marker__avatar) { border-color: #99928a; }
	:global(.gps-marker__avatar img) { width: 100%; height: 100%; object-fit: cover; }
	:global(.gps-marker__avatar img[hidden]), :global(.gps-marker__iniciales[hidden]) { display: none; }
	:global(.gps-marker__etiqueta) { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: .05rem; }
	:global(.gps-marker__nombre) { max-width: 10.5rem; overflow: hidden; color: #39312a; font: 720 .66rem/1.05 system-ui, sans-serif; text-overflow: ellipsis; }
	:global(.gps-marker__placa) { color: #855a40; font: 720 .57rem/1 system-ui, sans-serif; letter-spacing: .055em; }
	:global(.mapboxgl-ctrl-group) { overflow: hidden; border-radius: .7rem !important; box-shadow: 0 3px 12px rgb(39 32 26 / 18%) !important; }
	:global(.mapboxgl-ctrl-group button) { width: 36px !important; height: 36px !important; }
	@media (max-width: 800px) {
		.rastreo-barra { top: .55rem; right: .55rem; left: .55rem; width: auto; gap: .5rem; padding: .5rem; }
		.rastreo-volver, .rastreo-actualizar { width: 2.35rem; height: 2.35rem; }
		.rastreo-titulo { min-width: 0; flex: 0 1 auto; }
		.rastreo-titulo__eyebrow { font-size: .49rem; }
		.rastreo-titulo strong { font-size: .78rem; }
		.rastreo-titulo small { font-size: .56rem; }
		.rastreo-busqueda { min-width: 2.35rem; min-height: 2.35rem; gap: .2rem; padding: 0 .4rem; }
		.rastreo-busqueda input { width: 5rem; font-size: .64rem; }
		.rastreo-busqueda input::placeholder { color: transparent; }
		.rastreo-ficha { top: auto; right: .65rem; bottom: 4.8rem; left: .65rem; width: auto; padding: .8rem; }
		.rastreo-ficha__conductor > img, .rastreo-ficha__conductor > span:first-child { width: 2.35rem; height: 2.35rem; }
		.rastreo-ficha__cliente { margin-top: .55rem; padding-top: .5rem; }
		.rastreo-ficha__trayecto { margin-top: .55rem; }
		.trayecto-punto strong { max-width: calc(100vw - 5rem); }
		.trayecto-conector { height: .45rem; }
		.rastreo-ficha__pie { min-height: 1.9rem; margin-top: .55rem; }
		.rastreo-ficha__ultima { margin-top: .4rem; }
		.rastreo-pie { right: .55rem; bottom: .55rem; left: .55rem; min-height: 2.3rem; gap: .4rem; padding: .35rem .4rem .35rem .6rem; }
		.rastreo-leyenda { gap: .45rem; }
		.rastreo-leyenda > span, .rastreo-consentimiento { gap: .2rem; font-size: .53rem; }
		.rastreo-consentimiento { margin-left: auto; }
		.rastreo-consentimiento :global(svg) { display: none; }
		.rastreo-pie > small { display: none; }
		.rastreo-ajustar { width: 1.8rem; height: 1.8rem; }
		.rastreo-vacio { padding: 1.1rem; }
		.rastreo-vacio--compacto { bottom: 4rem; }
		:global(.gps-marker__avatar) { width: 1.8rem; height: 1.8rem; }
		:global(.gps-marker__nombre) { max-width: 7rem; font-size: .59rem; }
	}
	@media (min-width: 801px) and (max-width: 899px) {
		.rastreo-barra.conductorActivo { width: min(50rem, calc(100vw - 2rem)); }
		.rastreo-ficha { top: 6.2rem; }
	}
	@media (max-width: 480px) {
		.rastreo-pie { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .4rem .5rem; }
		.rastreo-leyenda { grid-column: 1 / -1; justify-content: space-between; width: 100%; }
		.rastreo-consentimiento { grid-column: 1; margin-left: 0; }
		.rastreo-ajustar { grid-column: 2; grid-row: 2; margin-left: 0; }
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.gps-marker) { transition: none; }
		.girando, .rastreo-spinner { animation-duration: 2s; }
	}
</style>
