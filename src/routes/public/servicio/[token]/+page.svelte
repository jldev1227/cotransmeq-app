<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { fade } from 'svelte/transition';
	import { serviciosAPI } from '$lib/api/apiClient';
	import {
		getEstadoText,
		getEstadoColor,
		formatCurrency,
		formatDateTime,
		type ServicioConRelaciones
	} from '$lib/types/servicios';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	import distracomLocations from '$lib/data/distracomlocations';

	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
	const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
	const DISTRACOM_ICON_URL =
		import.meta.env.VITE_DISTRACOM_ICON_URL ??
		'https://transmeralda.s3.us-east-2.amazonaws.com/assets/Surtidor.png';

	const DISTRACOM_DEPARTAMENTOS = [
		'cundinamarca',
		'bogotá',
		'bogota',
		'boyacá',
		'boyaca',
		'meta',
		'casanare',
		'vichada'
	];

	// ─── TIPOS ────────────────────────────────────────────────────

	interface DistracomEstacion {
		nombre: string;
		direccion: string;
		ciudad: string;
		departamento: string;
		lat: number;
		lon: number;
		diesel: boolean;
		gasolina: boolean;
		hotel: boolean;
		lubricentro: boolean;
	}
	interface PeajeInfo {
		nombre: string;
		lat: number;
		lon: number;
	}
	interface ParadaSegura {
		nombre: string;
		tipo: 'restaurante' | 'estacion_servicio' | 'hospedaje';
		lat: number;
		lon: number;
	}

	// ─── ESTADO ───────────────────────────────────────────────────

	let servicio: ServicioConRelaciones | null = null;
	let loading = true;
	let error: string | null = null;
	let map: mapboxgl.Map | null = null;
	let drawerOpen = true;

	let distracomMarkers: mapboxgl.Marker[] = [];
	let peajeMarkers: mapboxgl.Marker[] = [];
	let paradaMarkers: mapboxgl.Marker[] = [];

	let peajes: PeajeInfo[] = [];
	let paradasSeguras: ParadaSegura[] = [];
	let loadingPOIs = false;

	let showPeajes = true;
	let showRestaurantes = true;
	let showEstaciones = true;
	let showHospedajes = true;
	let showDistracom = true;

	let originLng = 0,
		originLat = 0,
		destLng = 0,
		destLat = 0;

	function resizeMap() {
		if (map)
			setTimeout(() => {
				map?.resize();
				centerRoute();
			}, 320);
	}
	$: if (map) {
		resizeMap();
		drawerOpen;
	}
	$: token = $page.params.token ?? '';

	$: {
		const getCoord = (servicioCoord: any, municipioCoord: any): number => {
			if (servicioCoord != null && servicioCoord !== 0) return Number(servicioCoord);
			if (municipioCoord != null) {
				const parsed = Number(municipioCoord);
				if (!isNaN(parsed) && parsed !== 0) return parsed;
			}
			return 0;
		};
		originLng = getCoord(servicio?.origen_longitud, servicio?.origen?.longitud);
		originLat = getCoord(servicio?.origen_latitud, servicio?.origen?.latitud);
		destLng = getCoord(servicio?.destino_longitud, servicio?.destino?.longitud);
		destLat = getCoord(servicio?.destino_latitud, servicio?.destino?.latitud);
	}

	// ─── LIFECYCLE ────────────────────────────────────────────────

	onMount(async () => {
		await cargarServicio();
		if (servicio) initMap();
	});

	onDestroy(() => {
		[...distracomMarkers, ...peajeMarkers, ...paradaMarkers].forEach((m) => m.remove());
		map?.remove();
	});

	// ─── API ──────────────────────────────────────────────────────

	async function cargarServicio() {
		try {
			loading = true;
			error = null;
			const response = await serviciosAPI.getByShareToken(token);
			if (response.data.success) servicio = response.data.data;
			else error = response.data.message || 'No se pudo cargar el servicio';
		} catch (err: any) {
			if (err.response?.status === 404) error = 'Este enlace no existe o ha sido revocado';
			else if (err.response?.status === 410) error = 'Este enlace ha expirado';
			else if (err.response?.status === 500) error = 'Error interno del servidor.';
			else error = err.response?.data?.message || 'No se pudo cargar el servicio.';
		} finally {
			loading = false;
		}
	}

	// ─── GEOMETRÍA: DISTANCIA PUNTO → SEGMENTO DE POLILÍNEA ──────
	// Calcula la distancia mínima en km desde un punto al segmento A→B.
	// Crítico porque Mapbox devuelve coordenadas espaciadas — un POI a
	// mitad del trayecto puede quedar lejos de cualquier punto muestreado.

	function distPuntoSegmento(
		pLat: number,
		pLon: number,
		aLat: number,
		aLon: number,
		bLat: number,
		bLon: number
	): number {
		const R = 111.32;
		const cosLat = Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
		const px = (pLon - aLon) * R * cosLat,
			py = (pLat - aLat) * R;
		const dx = (bLon - aLon) * R * cosLat,
			dy = (bLat - aLat) * R;
		const lenSq = dx * dx + dy * dy;
		if (lenSq === 0) return Math.sqrt(px * px + py * py);
		const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
		return Math.sqrt((px - t * dx) ** 2 + (py - t * dy) ** 2);
	}

	function esCercanoPolicromia(
		lat: number,
		lon: number,
		coords: number[][],
		umbralKm: number
	): boolean {
		for (let i = 0; i < coords.length - 1; i++) {
			if (
				distPuntoSegmento(
					lat,
					lon,
					coords[i][1],
					coords[i][0],
					coords[i + 1][1],
					coords[i + 1][0]
				) <= umbralKm
			)
				return true;
		}
		return false;
	}

	// Distancia punto a punto en km
	function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
		const R = 111.32;
		const cosLat = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
		return Math.sqrt(((lat2 - lat1) * R) ** 2 + ((lon2 - lon1) * R * cosLat) ** 2);
	}

	// ─── OVERPASS: PEAJES ─────────────────────────────────────────

	async function obtenerPeajes(routeCoords: number[][]): Promise<PeajeInfo[]> {
		try {
			const lats = routeCoords.map((c) => c[1]);
			const lngs = routeCoords.map((c) => c[0]);
			const bbox = [
				Math.min(...lats) - 0.05,
				Math.min(...lngs) - 0.05,
				Math.max(...lats) + 0.05,
				Math.max(...lngs) + 0.05
			];

			const origenLat = routeCoords[0][1],
				origenLon = routeCoords[0][0];
			const destinoLat = routeCoords[routeCoords.length - 1][1],
				destinoLon = routeCoords[routeCoords.length - 1][0];
			const EXCLUSION_KM = 10;

			const query = `
				[out:json];
				(
					node["barrier"="toll_booth"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
					node["amenity"="toll_booth"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
				);
				out body;
			`;
			const res = await fetch(OVERPASS_API, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `data=${encodeURIComponent(query)}`,
				signal: AbortSignal.timeout(10000)
			});
			if (!res.ok) return [];
			const data = (await res.json()) as { elements?: any[] };

			return (data.elements || [])
				.map((el: any) => ({ nombre: el.tags?.name || 'Peaje', lat: el.lat, lon: el.lon }))
				.filter((p: PeajeInfo) => {
					// Sobre el trazado real (≤ 2 km al segmento más cercano)
					if (!esCercanoPolicromia(p.lat, p.lon, routeCoords, 2)) return false;
					// Fuera del área urbana de origen y destino
					if (distKm(p.lat, p.lon, origenLat, origenLon) <= EXCLUSION_KM) return false;
					if (distKm(p.lat, p.lon, destinoLat, destinoLon) <= EXCLUSION_KM) return false;
					return true;
				});
		} catch (e) {
			console.warn('[Mapa] Peajes no disponibles:', e);
			return [];
		}
	}

	// ─── OVERPASS: PARADAS SEGURAS ────────────────────────────────

	async function obtenerParadasSeguras(routeCoords: number[][]): Promise<ParadaSegura[]> {
		try {
			const lats = routeCoords.map((c) => c[1]);
			const lngs = routeCoords.map((c) => c[0]);
			const bbox = [
				Math.min(...lats) - 0.04,
				Math.min(...lngs) - 0.04,
				Math.max(...lats) + 0.04,
				Math.max(...lngs) + 0.04
			];

			const origenLat = routeCoords[0][1],
				origenLon = routeCoords[0][0];
			const destinoLat = routeCoords[routeCoords.length - 1][1],
				destinoLon = routeCoords[routeCoords.length - 1][0];
			// 15 km de exclusión: evita los cientos de hoteles/restaurantes de las ciudades
			const EXCLUSION_KM = 15;

			const query = `
				[out:json][timeout:20];
				(
					node["amenity"="restaurant"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
					node["amenity"="fuel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
					node["tourism"="hotel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
					node["tourism"="hostel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
					node["tourism"="guest_house"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
				);
				out body;
			`;
			const res = await fetch(OVERPASS_API, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `data=${encodeURIComponent(query)}`,
				signal: AbortSignal.timeout(20000)
			});
			if (!res.ok) return [];
			const data = (await res.json()) as { elements?: any[] };

			return (data.elements || [])
				.map((el: any) => {
					let tipo: ParadaSegura['tipo'] = 'restaurante';
					if (el.tags?.amenity === 'fuel') tipo = 'estacion_servicio';
					if (['hotel', 'hostel', 'guest_house'].includes(el.tags?.tourism)) tipo = 'hospedaje';
					return {
						nombre:
							el.tags?.name ||
							(tipo === 'restaurante'
								? 'Restaurante'
								: tipo === 'estacion_servicio'
									? 'Est. Servicio'
									: 'Hospedaje'),
						tipo,
						lat: el.lat,
						lon: el.lon
					};
				})
				.filter((p: ParadaSegura) => {
					// 1. A ≤ 3 km del trazado real (segmento más cercano)
					if (!esCercanoPolicromia(p.lat, p.lon, routeCoords, 3)) return false;
					// 2. Fuera del radio urbano de origen y destino
					if (distKm(p.lat, p.lon, origenLat, origenLon) <= EXCLUSION_KM) return false;
					if (distKm(p.lat, p.lon, destinoLat, destinoLon) <= EXCLUSION_KM) return false;
					return true;
				})
				.slice(0, 30);
		} catch (e) {
			console.warn('[Mapa] Paradas no disponibles:', e);
			return [];
		}
	}

	// ─── DISTRACOM ────────────────────────────────────────────────

	function obtenerEstacionesCercanas(routeCoords: number[][]): DistracomEstacion[] {
		const lats = routeCoords.map((c) => c[1]);
		const lngs = routeCoords.map((c) => c[0]);
		const bbox = {
			minLat: Math.min(...lats) - 0.5,
			maxLat: Math.max(...lats) + 0.5,
			minLng: Math.min(...lngs) - 0.5,
			maxLng: Math.max(...lngs) + 0.5
		};
		return (distracomLocations as any[])
			.filter((raw) => {
				const depto = (raw.Departamento || '').toLowerCase().trim();
				const lat = Number(raw.Latitud),
					lon = Number(raw.Longitud);
				if (!DISTRACOM_DEPARTAMENTOS.includes(depto)) return false;
				if (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLng || lon > bbox.maxLng)
					return false;
				return esCercanoPolicromia(lat, lon, routeCoords, 50);
			})
			.map((raw) => {
				const servicios: string[] = (raw.Servicios || []).map(
					(s: any) => s.Nombre?.toLowerCase() || ''
				);
				return {
					nombre: raw.NombreEstacion || 'Estación Distracom',
					direccion: raw.Direccion || '',
					ciudad: raw.Ciudad || '',
					departamento: raw.Departamento || '',
					lat: Number(raw.Latitud),
					lon: Number(raw.Longitud),
					diesel: (raw.DIESEL ?? 0) > 0,
					gasolina: (raw.CORRIENTE ?? 0) > 0 || (raw.PREMIUM ?? 0) > 0,
					hotel: raw.Hotel === true,
					lubricentro: servicios.some((s) => s.includes('lubricentro'))
				};
			})
			.slice(0, 6);
	}

	// ─── POPUPS ───────────────────────────────────────────────────

	function popupPeaje(p: PeajeInfo): string {
		const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
		return `
			<div style="padding:12px 14px;min-width:190px;font-family:system-ui,sans-serif;">
				<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
					<div style="width:28px;height:28px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
						<span style="color:#fff;font-weight:700;font-size:12px;">P</span>
					</div>
					<strong style="color:#92400e;font-size:13px;">${p.nombre}</strong>
				</div>
				<span style="display:inline-block;background:#fef3c7;color:#78350f;font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid #fcd34d;margin-bottom:10px;">🛣️ Peaje</span>
				<a href="${mapsUrl}" target="_blank" rel="noopener"
					style="display:flex;align-items:center;justify-content:center;gap:6px;background:#f59e0b;color:#fff;font-size:11px;font-weight:600;padding:6px 10px;border-radius:7px;text-decoration:none;">
					📍 Ver en Google Maps
				</a>
			</div>`;
	}

	function popupParada(p: ParadaSegura): string {
		const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
		const configs = {
			restaurante: {
				bg: '#2196f3',
				light: '#e3f2fd',
				border: '#90caf9',
				dark: '#0d47a1',
				emoji: '🍽️',
				label: 'Restaurante'
			},
			estacion_servicio: {
				bg: '#9c27b0',
				light: '#f3e5f5',
				border: '#ce93d8',
				dark: '#4a148c',
				emoji: '⛽',
				label: 'Estación de Servicio'
			},
			hospedaje: {
				bg: '#009688',
				light: '#e0f2f1',
				border: '#80cbc4',
				dark: '#004d40',
				emoji: '🏨',
				label: 'Hospedaje'
			}
		};
		const c = configs[p.tipo];
		return `
			<div style="padding:12px 14px;min-width:190px;font-family:system-ui,sans-serif;">
				<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
					<div style="width:28px;height:28px;background:${c.bg};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
						<span style="color:#fff;font-size:14px;">${c.emoji}</span>
					</div>
					<strong style="color:${c.dark};font-size:13px;">${p.nombre}</strong>
				</div>
				<span style="display:inline-block;background:${c.light};color:${c.dark};font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid ${c.border};margin-bottom:10px;">${c.emoji} ${c.label}</span>
				<a href="${mapsUrl}" target="_blank" rel="noopener"
					style="display:flex;align-items:center;justify-content:center;gap:6px;background:${c.bg};color:#fff;font-size:11px;font-weight:600;padding:6px 10px;border-radius:7px;text-decoration:none;">
					📍 Ver en Google Maps
				</a>
			</div>`;
	}

	function popupDistracom(e: DistracomEstacion): string {
		const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lon}`;
		const badges = [
			e.diesel &&
				`<span style="background:#e8f5e9;color:#2e7d32;font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid #a5d6a7;">🛢 Diésel</span>`,
			e.gasolina &&
				`<span style="background:#e8f5e9;color:#2e7d32;font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid #a5d6a7;">⛽ Gasolina</span>`,
			e.hotel &&
				`<span style="background:#e3f2fd;color:#1565c0;font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid #90caf9;">🏨 Hotel</span>`,
			e.lubricentro &&
				`<span style="background:#fff3e0;color:#e65100;font-size:10px;padding:2px 7px;border-radius:999px;border:1px solid #ffcc80;">🔧 Lubricentro</span>`
		]
			.filter(Boolean)
			.join('');
		return `
			<div style="padding:12px 14px;min-width:210px;font-family:system-ui,sans-serif;">
				<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
					<img src="${DISTRACOM_ICON_URL}" style="width:22px;height:22px;object-fit:contain;flex-shrink:0;" alt="Distracom" />
					<strong style="color:#1b5e20;font-size:13px;">${e.nombre}</strong>
				</div>
				${e.direccion ? `<p style="color:#555;font-size:11px;margin:0 0 2px;">${e.direccion}</p>` : ''}
				<p style="color:#888;font-size:11px;margin:0 0 10px;">${e.ciudad}, ${e.departamento}</p>
				${badges ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">${badges}</div>` : ''}
				<a href="${mapsUrl}" target="_blank" rel="noopener"
					style="display:flex;align-items:center;justify-content:center;gap:6px;background:#1b5e20;color:#fff;font-size:11px;font-weight:600;padding:6px 10px;border-radius:7px;text-decoration:none;">
					📍 Ver en Google Maps
				</a>
			</div>`;
	}

	// ─── MARKERS ──────────────────────────────────────────────────

	function crearMarkerCirculo(color: string, letra: string): HTMLElement {
		const el = document.createElement('div');
		el.style.cssText = `width:30px;height:30px;`;
		el.innerHTML = `<div style="width:30px;height:30px;background:${color};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,0.3);border:2px solid #fff;cursor:pointer;">
			<span style="color:#fff;font-weight:700;font-size:12px;">${letra}</span>
		</div>`;
		return el;
	}

	function agregarMarkersPeajes(lista: PeajeInfo[]) {
		peajeMarkers.forEach((m) => m.remove());
		peajeMarkers = [];
		if (!map || !showPeajes) return;
		for (const p of lista) {
			const el = crearMarkerCirculo('#f59e0b', 'P');
			const popup = new mapboxgl.Popup({
				offset: [0, -18],
				maxWidth: '240px',
				closeButton: true,
				anchor: 'bottom'
			}).setHTML(popupPeaje(p));
			const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
				.setLngLat([p.lon, p.lat])
				.setPopup(popup)
				.addTo(map!);
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				marker.togglePopup();
			});
			peajeMarkers.push(marker);
		}
	}

	function agregarMarkersParadas(lista: ParadaSegura[]) {
		paradaMarkers.forEach((m) => m.remove());
		paradaMarkers = [];
		if (!map) return;
		const configs = {
			restaurante: { color: '#2196f3', letra: 'R', show: () => showRestaurantes },
			estacion_servicio: { color: '#9c27b0', letra: 'S', show: () => showEstaciones },
			hospedaje: { color: '#009688', letra: 'H', show: () => showHospedajes }
		};
		for (const p of lista) {
			const cfg = configs[p.tipo];
			if (!cfg.show()) continue;
			const el = crearMarkerCirculo(cfg.color, cfg.letra);
			const popup = new mapboxgl.Popup({
				offset: [0, -18],
				maxWidth: '240px',
				closeButton: true,
				anchor: 'bottom'
			}).setHTML(popupParada(p));
			const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
				.setLngLat([p.lon, p.lat])
				.setPopup(popup)
				.addTo(map!);
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				marker.togglePopup();
			});
			paradaMarkers.push(marker);
		}
	}

	function agregarMarkersDistracom(estaciones: DistracomEstacion[]) {
		distracomMarkers.forEach((m) => m.remove());
		distracomMarkers = [];
		if (!map || !showDistracom) return;
		for (const estacion of estaciones) {
			const el = document.createElement('div');
			el.style.cssText = 'width:32px;height:32px;';
			el.innerHTML = `<img src="${DISTRACOM_ICON_URL}" alt="${estacion.nombre}"
				style="width:32px;height:32px;object-fit:contain;cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));"
				draggable="false" />`;
			const popup = new mapboxgl.Popup({
				offset: [0, -30],
				maxWidth: '260px',
				closeButton: true,
				anchor: 'bottom'
			}).setHTML(popupDistracom(estacion));
			const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
				.setLngLat([estacion.lon, estacion.lat])
				.setPopup(popup)
				.addTo(map!);
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				const isOpen = popup.isOpen();
				distracomMarkers.forEach((m) => {
					if (m.getPopup()?.isOpen()) m.togglePopup();
				});
				if (!isOpen) marker.togglePopup();
			});
			distracomMarkers.push(marker);
		}
	}

	// Reactivos a toggles
	$: if (map) agregarMarkersPeajes(peajes);
	$: if (map) agregarMarkersParadas(paradasSeguras);
	$: if (map) {
		distracomMarkers.forEach((m) => {
			m.getElement().style.display = showDistracom ? '' : 'none';
		});
	}

	// ─── MAPA ─────────────────────────────────────────────────────

	function initMap() {
		if (!servicio || !originLat || !originLng) return;
		mapboxgl.accessToken = MAPBOX_TOKEN;
		map = new mapboxgl.Map({
			container: 'map',
			style: 'mapbox://styles/mapbox/outdoors-v12',
			center: [originLng, originLat],
			zoom: 12
		});
		map.addControl(new mapboxgl.NavigationControl(), 'top-right');
		map.on('load', () => {
			if (!map || !servicio) return;

			const originEl = document.createElement('div');
			originEl.innerHTML = `<div class="marker-pin" style="background:#f97316;"><span style="color:#fff;font-weight:700;font-size:16px;">A</span></div>`;
			new mapboxgl.Marker(originEl)
				.setLngLat([originLng, originLat])
				.setPopup(
					new mapboxgl.Popup({ offset: 25 }).setHTML(
						`<div style="padding:8px;"><strong style="color:#f97316;">Origen</strong><br/><span>${servicio.origen_especifico || servicio.origen?.nombre_municipio || 'N/A'}</span></div>`
					)
				)
				.addTo(map);

			if (destLat && destLng) {
				const destEl = document.createElement('div');
				destEl.innerHTML = `<div class="marker-pin" style="background:#ef4444;"><span style="color:#fff;font-weight:700;font-size:16px;">B</span></div>`;
				new mapboxgl.Marker(destEl)
					.setLngLat([destLng, destLat])
					.setPopup(
						new mapboxgl.Popup({ offset: 25 }).setHTML(
							`<div style="padding:8px;"><strong style="color:#ef4444;">Destino</strong><br/><span>${servicio.destino_especifico || servicio.destino?.nombre_municipio || 'N/A'}</span></div>`
						)
					)
					.addTo(map);
				drawRoute();
			} else {
				agregarMarkersDistracom([]);
			}
			centerRoute();
		});
	}

	async function drawRoute() {
		if (!map || !originLat || !originLng || !destLat || !destLng) return;
		try {
			const res = await fetch(
				`https://api.mapbox.com/directions/v5/mapbox/driving/${originLng},${originLat};${destLng},${destLat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
			);
			const data = await res.json();
			if (!data.routes?.length) return;

			const route = data.routes[0].geometry;
			const routeCoords: number[][] = route.coordinates;

			if (map.getSource('route')) {
				map.removeLayer('route');
				map.removeSource('route');
			}
			map.addSource('route', {
				type: 'geojson',
				data: { type: 'Feature', properties: {}, geometry: route }
			});
			map.addLayer({
				id: 'route',
				type: 'line',
				source: 'route',
				layout: { 'line-join': 'round', 'line-cap': 'round' },
				paint: { 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.8 }
			});

			// Distracom es sincrónico — aparece de inmediato sin bloquear
			agregarMarkersDistracom(obtenerEstacionesCercanas(routeCoords));

			// POIs de Overpass — activar loading pill
			loadingPOIs = true;
			try {
				const [peajesData, paradasData] = await Promise.all([
					obtenerPeajes(routeCoords),
					obtenerParadasSeguras(routeCoords)
				]);
				peajes = peajesData;
				paradasSeguras = paradasData;
				agregarMarkersPeajes(peajes);
				agregarMarkersParadas(paradasSeguras);
			} finally {
				loadingPOIs = false;
			}
		} catch (err) {
			console.error('❌ [DRAW ROUTE]', err);
			loadingPOIs = false;
		}
	}

	function centerRoute() {
		if (!map) return;
		const bounds = new mapboxgl.LngLatBounds();
		bounds.extend([originLng, originLat]);
		if (destLat && destLng) bounds.extend([destLng, destLat]);
		map.fitBounds(bounds, { padding: 100, maxZoom: 14, duration: 1000 });
	}

	$: countRestaurantes = paradasSeguras.filter((p) => p.tipo === 'restaurante').length;
	$: countEstaciones = paradasSeguras.filter((p) => p.tipo === 'estacion_servicio').length;
	$: countHospedajes = paradasSeguras.filter((p) => p.tipo === 'hospedaje').length;
</script>

<svelte:head>
	<title>Servicio Compartido - Cotransmeq</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="relative h-screen w-full overflow-hidden bg-gray-50">
	{#if loading}
		<div
			class="flex h-full items-center justify-center bg-gradient-to-br from-orange-50 to-white"
			in:fade
		>
			<div class="text-center">
				<div
					class="mx-auto mb-4 h-20 w-20 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
				></div>
				<p class="text-xl font-semibold text-gray-800">Cargando servicio...</p>
				<p class="text-sm text-gray-500">Por favor espera un momento</p>
			</div>
		</div>
	{:else if error}
		<div
			class="flex h-full items-center justify-center bg-gradient-to-br from-red-50 to-white p-6"
			in:fade
		>
			<div class="max-w-lg text-center">
				<div
					class="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-red-100"
				>
					<svg class="h-12 w-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/>
					</svg>
				</div>
				<h2 class="mb-3 text-3xl font-bold text-gray-900">Enlace no disponible</h2>
				<div class="mb-6 rounded-xl bg-white p-6 shadow-md">
					<p class="text-lg text-gray-700">{error}</p>
				</div>
			</div>
		</div>
	{:else if servicio}
		<!-- ─── MAPA ─── -->
		<div
			id="map"
			class="h-full transition-all duration-300 ease-in-out"
			style={drawerOpen ? 'width: calc(100% - 24rem); margin-right: 24rem;' : 'width: 100%;'}
		></div>

		<!-- Logo -->
		<div class="fixed top-8 left-8 z-40 p-2">
			<img src="/assets/logo_nombre.png" alt="Cotransmeq" class="h-16 w-auto drop-shadow-lg" />
		</div>

		<!-- ─── LOADING POIs ─── -->
		{#if loadingPOIs}
			<div
				class="fixed left-8 z-50 flex items-center gap-3 rounded-2xl border border-orange-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm"
				style="top: 26rem; max-width:320px; height: 52px;"
				in:fade={{ duration: 200 }}
				out:fade={{ duration: 200 }}
			>
				<div class="relative flex h-5 w-5 flex-shrink-0">
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-60"
					></span>
					<span
						class="relative inline-flex h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent"
					></span>
				</div>
				<div class="min-w-0">
					<p class="text-xs font-semibold text-orange-800">Buscando puntos de interés...</p>
					<p class="text-[10px] text-orange-600">
						🛣️ Peajes · 🍽️ Restaurantes · ⛽ Gasolina · 🏨 Hoteles
					</p>
				</div>
			</div>
		{/if}

		<!-- ─── LEYENDA INTERACTIVA ─── -->
		<div
			class="fixed bottom-20 left-8 z-40 rounded-2xl border border-gray-200 bg-white/95 shadow-xl backdrop-blur-sm"
			style="min-width:220px;"
		>
			<div class="border-b border-gray-100 px-4 py-2.5">
				<p class="text-xs font-bold tracking-wider text-gray-500 uppercase">Puntos de interés</p>
			</div>

			<div class="space-y-0.5 p-2">
				<div class="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
					<div
						class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-orange-500"
					>
						<span class="text-[10px] font-bold text-white">A</span>
					</div>
					<span class="text-xs text-gray-600">Origen</span>
				</div>
				<div class="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
					<div
						class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-red-500"
					>
						<span class="text-[10px] font-bold text-white">B</span>
					</div>
					<span class="text-xs text-gray-600">Destino</span>
				</div>

				<div class="my-1 border-t border-gray-100"></div>

				<!-- Peajes -->
				<button
					class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50"
					class:opacity-40={!showPeajes}
					on:click={() => (showPeajes = !showPeajes)}
				>
					<div
						class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-400"
					>
						<span class="text-[10px] font-bold text-white">P</span>
					</div>
					<span class="flex-1 text-left text-xs text-gray-700">Peajes</span>
					{#if loadingPOIs}
						<span
							class="h-3 w-3 animate-spin rounded-full border border-amber-400 border-t-transparent"
						></span>
					{:else if peajes.length > 0}
						<span
							class="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
							>{peajes.length}</span
						>
					{/if}
				</button>

				<!-- Restaurantes -->
				<button
					class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50"
					class:opacity-40={!showRestaurantes}
					on:click={() => {
						showRestaurantes = !showRestaurantes;
						agregarMarkersParadas(paradasSeguras);
					}}
				>
					<div
						class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-500"
					>
						<span class="text-[10px] font-bold text-white">R</span>
					</div>
					<span class="flex-1 text-left text-xs text-gray-700">Restaurantes</span>
					{#if loadingPOIs}
						<span
							class="h-3 w-3 animate-spin rounded-full border border-blue-400 border-t-transparent"
						></span>
					{:else if countRestaurantes > 0}
						<span
							class="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
							>{countRestaurantes}</span
						>
					{/if}
				</button>

				<!-- Estaciones de servicio -->
				<button
					class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50"
					class:opacity-40={!showEstaciones}
					on:click={() => {
						showEstaciones = !showEstaciones;
						agregarMarkersParadas(paradasSeguras);
					}}
				>
					<div
						class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-purple-500"
					>
						<span class="text-[10px] font-bold text-white">S</span>
					</div>
					<span class="flex-1 text-left text-xs text-gray-700">Est. Servicio</span>
					{#if loadingPOIs}
						<span
							class="h-3 w-3 animate-spin rounded-full border border-purple-400 border-t-transparent"
						></span>
					{:else if countEstaciones > 0}
						<span
							class="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700"
							>{countEstaciones}</span
						>
					{/if}
				</button>

				<!-- Hospedajes -->
				<button
					class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50"
					class:opacity-40={!showHospedajes}
					on:click={() => {
						showHospedajes = !showHospedajes;
						agregarMarkersParadas(paradasSeguras);
					}}
				>
					<div
						class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-500"
					>
						<span class="text-[10px] font-bold text-white">H</span>
					</div>
					<span class="flex-1 text-left text-xs text-gray-700">Hospedajes</span>
					{#if loadingPOIs}
						<span
							class="h-3 w-3 animate-spin rounded-full border border-teal-400 border-t-transparent"
						></span>
					{:else if countHospedajes > 0}
						<span
							class="rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700"
							>{countHospedajes}</span
						>
					{/if}
				</button>

				<!-- Distracom -->
				<button
					class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50"
					class:opacity-40={!showDistracom}
					on:click={() => (showDistracom = !showDistracom)}
				>
					<img
						src={DISTRACOM_ICON_URL}
						alt="Distracom"
						class="h-6 w-6 flex-shrink-0 object-contain"
					/>
					<span class="flex-1 text-left text-xs text-gray-700">Distracom</span>
					{#if distracomMarkers.length > 0}
						<span
							class="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700"
							>{distracomMarkers.length}</span
						>
					{/if}
				</button>
			</div>

			<div class="border-t border-gray-100 px-4 py-2">
				<p class="text-[10px] text-gray-400">Click en ítem para mostrar/ocultar</p>
			</div>
		</div>

		<!-- ─── DRAWER INFO ─── -->
		{#if drawerOpen}
			<div
				class="fixed top-0 right-0 z-50 h-full w-96 shadow-2xl"
				transition:fade={{ duration: 300 }}
			>
				<div class="flex h-full flex-col bg-white/90 backdrop-blur-xl">
					<div class="sticky top-0 z-10 flex-shrink-0 border-b border-gray-200/50 bg-white/95 p-6">
						<div class="mb-4 flex items-start justify-between">
							<div>
								<h2 class="text-2xl font-bold text-gray-900">Información del Servicio</h2>
								<p class="mt-1 text-sm text-gray-500">ID: {servicio.id.slice(0, 8)}...</p>
							</div>
							<button
								on:click={() => (drawerOpen = false)}
								aria-label="Cerrar información del servicio"
								class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
							>
								<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>
						<span
							class="inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-semibold"
							style="background-color:{getEstadoColor(
								servicio.estado
							)}15;border-color:{getEstadoColor(servicio.estado)}40;color:{getEstadoColor(
								servicio.estado
							)}"
						>
							{getEstadoText(servicio.estado)}
						</span>
					</div>

					<div class="flex-1 space-y-6 overflow-y-auto p-6">
						<div class="rounded-xl border border-gray-200 bg-white p-4">
							<h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
								<svg
									class="h-5 w-5 text-orange-500"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
									/>
								</svg>
								Ruta
							</h3>
							<div class="space-y-3">
								<div class="flex items-start gap-3">
									<div
										class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 font-semibold text-white"
									>
										A
									</div>
									<div>
										<p class="text-xs text-gray-500">Origen</p>
										<p class="font-medium text-gray-900">
											{servicio.origen_especifico || servicio.origen?.nombre_municipio || 'N/A'}
										</p>
									</div>
								</div>
								<div class="flex items-start gap-3">
									<div
										class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500 font-semibold text-white"
									>
										B
									</div>
									<div>
										<p class="text-xs text-gray-500">Destino</p>
										<p class="font-medium text-gray-900">
											{servicio.destino_especifico || servicio.destino?.nombre_municipio || 'N/A'}
										</p>
									</div>
								</div>
							</div>
						</div>

						{#if servicio.conductor}
							<div class="rounded-xl border border-gray-200 bg-white p-4">
								<h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
									<svg
										class="h-5 w-5 text-blue-500"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
										/>
									</svg>
									Conductor
								</h3>
								<div class="flex items-center gap-3">
									{#if servicio.conductor.foto_url}
										<img
											src={servicio.conductor.foto_url}
											alt={servicio.conductor.nombre}
											class="h-12 w-12 rounded-full object-cover"
										/>
									{:else}
										<div
											class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-600"
										>
											{servicio.conductor.nombre.charAt(0)}{servicio.conductor.apellido.charAt(0)}
										</div>
									{/if}
									<div>
										<p class="font-medium text-gray-900">
											{servicio.conductor.nombre}
											{servicio.conductor.apellido}
										</p>
										{#if servicio.conductor.telefono}
											<p class="text-sm text-gray-600">{servicio.conductor.telefono}</p>
										{/if}
									</div>
								</div>
							</div>
						{/if}

						{#if servicio.vehiculo}
							<div class="rounded-xl border border-gray-200 bg-white p-4">
								<h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
									<svg
										class="h-5 w-5 text-purple-500"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
										/>
									</svg>
									Vehículo
								</h3>
								<div class="space-y-2">
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Placa:</span>
										<span class="font-semibold text-gray-900">{servicio.vehiculo.placa}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Marca:</span>
										<span class="font-medium text-gray-900">{servicio.vehiculo.marca}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Modelo:</span>
										<span class="font-medium text-gray-900">{servicio.vehiculo.modelo}</span>
									</div>
								</div>
							</div>
						{/if}

						{#if servicio.cliente}
							<div class="rounded-xl border border-gray-200 bg-white p-4">
								<h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
									<svg
										class="h-5 w-5 text-amber-500"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
										/>
									</svg>
									Cliente
								</h3>
								<p class="font-medium text-gray-900">{servicio.cliente.nombre}</p>
								{#if servicio.cliente.nit}
									<p class="text-sm text-gray-500">NIT: {servicio.cliente.nit}</p>
								{/if}
							</div>
						{/if}

						<div class="rounded-xl border border-gray-200 bg-white p-4">
							<h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
								<svg
									class="h-5 w-5 text-gray-500"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
									/>
								</svg>
								Fechas
							</h3>
							<div class="space-y-2">
								<div class="flex justify-between">
									<span class="text-sm text-gray-600">Solicitud:</span>
									<span class="text-sm font-medium text-gray-900"
										>{formatDateTime(servicio.fecha_solicitud)}</span
									>
								</div>
								{#if servicio.fecha_realizacion}
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Realización:</span>
										<span class="text-sm font-medium text-gray-900"
											>{formatDateTime(servicio.fecha_realizacion)}</span
										>
									</div>
								{/if}
								{#if servicio.fecha_finalizacion}
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Finalización:</span>
										<span class="text-sm font-medium text-gray-900"
											>{formatDateTime(servicio.fecha_finalizacion)}</span
										>
									</div>
								{/if}
							</div>
						</div>

						{#if servicio.observaciones}
							<div class="rounded-xl border border-gray-200 bg-white p-4">
								<h3 class="mb-2 text-sm font-semibold text-gray-700">Observaciones</h3>
								<p class="text-sm text-gray-600">{servicio.observaciones}</p>
							</div>
						{/if}

						<div class="border-t border-gray-200 pt-4 text-center">
							<p class="text-xs text-gray-400">Enlace compartido de forma segura · Cotransmeq</p>
						</div>
					</div>
				</div>
			</div>
		{/if}

		{#if !drawerOpen}
			<button
				on:click={() => (drawerOpen = true)}
				aria-label="Mostrar información del servicio"
				class="fixed top-4 right-4 z-50 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg transition-shadow hover:shadow-xl"
				transition:fade={{ duration: 200 }}
			>
				<svg class="h-6 w-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			</button>
		{/if}

		<button
			on:click={centerRoute}
			class="fixed right-6 bottom-6 z-40 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg transition-shadow hover:shadow-xl"
		>
			<svg class="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
				/>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
				/>
			</svg>
			<span class="text-sm font-medium text-gray-700">Centrar ruta</span>
		</button>
	{/if}
</div>

<style>
	:global(.marker-pin) {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
		border: 3px solid white;
		cursor: pointer;
	}
	:global(.mapboxgl-popup-content) {
		border-radius: 10px !important;
		padding: 0 !important;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15) !important;
	}
</style>
