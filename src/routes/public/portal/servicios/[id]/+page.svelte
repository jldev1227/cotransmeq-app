<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	import { isAuthenticated } from '$lib/stores/portalStore';
	import {
		conductorServiciosStore,
		SERVICIO_STATUS_PALETTE,
		fmtDate,
		fmtMin
	} from '$lib/stores/conductor-servicios';

	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
	const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

	let map: mapboxgl.Map | null = null;
	let isMapLoaded = false;
	let markers: mapboxgl.Marker[] = [];

	let distancia = '—';
	let duracion = '—';
	let loadingRoute = false;

	// Estado local del mapa
	let showTrafico = true;
	let showPOIs = true;

	// POIs
	let peajes: { nombre: string; lat: number; lon: number }[] = [];
	let paradasSeguras: {
		nombre: string;
		tipo: 'restaurante' | 'estacion_servicio' | 'hospedaje';
		lat: number;
		lon: number;
	}[] = [];
	let peajeMarkersArr: mapboxgl.Marker[] = [];
	let paradaMarkersArr: mapboxgl.Marker[] = [];
	let loadingPOIs = false;

	$: servicio = $conductorServiciosStore.detalle;
	$: loading = $conductorServiciosStore.loadingDetalle;
	$: error = $conductorServiciosStore.errorDetalle;

	$: pal = servicio ? SERVICIO_STATUS_PALETTE[servicio.estado] : null;
	$: countPeajes = peajes.length;
	$: countRestaurantes = paradasSeguras.filter((p) => p.tipo === 'restaurante').length;
	$: countEstaciones = paradasSeguras.filter((p) => p.tipo === 'estacion_servicio').length;
	$: countHospedajes = paradasSeguras.filter((p) => p.tipo === 'hospedaje').length;

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
		const px = (pLon - aLon) * R * cosLat;
		const py = (pLat - aLat) * R;
		const dx = (bLon - aLon) * R * cosLat;
		const dy = (bLat - aLat) * R;
		const lenSq = dx * dx + dy * dy;
		if (lenSq === 0) return Math.sqrt(px * px + py * py);
		const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
		const nearX = px - t * dx;
		const nearY = py - t * dy;
		return Math.sqrt(nearX * nearX + nearY * nearY);
	}

	function esCercanoPolicromia(lat: number, lon: number, coords: number[][], umbralKm: number) {
		for (let i = 0; i < coords.length - 1; i++) {
			const d = distPuntoSegmento(
				lat,
				lon,
				coords[i][1],
				coords[i][0],
				coords[i + 1][1],
				coords[i + 1][0]
			);
			if (d <= umbralKm) return true;
		}
		return false;
	}

	async function obtenerPeajes(routeCoords: number[][]) {
		try {
			const lats = routeCoords.map((c) => c[1]);
			const lngs = routeCoords.map((c) => c[0]);
			const bbox = [
				Math.min(...lats) - 0.05,
				Math.min(...lngs) - 0.05,
				Math.max(...lats) + 0.05,
				Math.max(...lngs) + 0.05
			];
			const query = `[out:json];(node["barrier"="toll_booth"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});node["amenity"="toll_booth"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}););out body;`;
			const res = await fetch(OVERPASS_API, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `data=${encodeURIComponent(query)}`,
				signal: AbortSignal.timeout(10000)
			});
			if (!res.ok) return [];
			const data = (await res.json()) as { elements?: any[] };
			const origenLat = routeCoords[0][1],
				origenLon = routeCoords[0][0];
			const destinoLat = routeCoords[routeCoords.length - 1][1];
			const destinoLon = routeCoords[routeCoords.length - 1][0];
			const distKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
				const R = 111.32;
				const cosLat = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
				return Math.sqrt(((lat2 - lat1) * R) ** 2 + ((lon2 - lon1) * R * cosLat) ** 2);
			};
			return (data.elements || [])
				.map((el: any) => ({ nombre: el.tags?.name || 'Peaje', lat: el.lat, lon: el.lon }))
				.filter((p) => {
					if (!esCercanoPolicromia(p.lat, p.lon, routeCoords, 2)) return false;
					if (distKm(p.lat, p.lon, origenLat, origenLon) <= 10) return false;
					if (distKm(p.lat, p.lon, destinoLat, destinoLon) <= 10) return false;
					return true;
				});
		} catch {
			return [];
		}
	}

	async function obtenerParadasSeguras(routeCoords: number[][]) {
		try {
			const lats = routeCoords.map((c) => c[1]);
			const lngs = routeCoords.map((c) => c[0]);
			const origenLat = routeCoords[0][1],
				origenLon = routeCoords[0][0];
			const destinoLat = routeCoords[routeCoords.length - 1][1];
			const destinoLon = routeCoords[routeCoords.length - 1][0];
			const bbox = [
				Math.min(...lats) - 0.04,
				Math.min(...lngs) - 0.04,
				Math.max(...lats) + 0.04,
				Math.max(...lngs) + 0.04
			];
			const query = `[out:json][timeout:15];(
				node["amenity"="restaurant"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
				node["amenity"="fuel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
				node["tourism"="hotel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
			);out body;`;
			const res = await fetch(OVERPASS_API, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `data=${encodeURIComponent(query)}`,
				signal: AbortSignal.timeout(15000)
			});
			if (!res.ok) return [];
			const data = (await res.json()) as { elements?: any[] };
			const distKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
				const R = 111.32;
				const cosLat = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
				return Math.sqrt(((lat2 - lat1) * R) ** 2 + ((lon2 - lon1) * R * cosLat) ** 2);
			};
			return (data.elements || [])
				.map((el: any) => {
					let tipo: 'restaurante' | 'estacion_servicio' | 'hospedaje' = 'restaurante';
					if (el.tags?.amenity === 'fuel') tipo = 'estacion_servicio';
					else if (el.tags?.tourism) tipo = 'hospedaje';
					return {
						nombre: el.tags?.name || (tipo === 'restaurante' ? 'Restaurante' : 'Est. Servicio'),
						tipo,
						lat: el.lat,
						lon: el.lon
					};
				})
				.filter((p) => {
					if (!esCercanoPolicromia(p.lat, p.lon, routeCoords, 3)) return false;
					if (distKm(p.lat, p.lon, origenLat, origenLon) <= 15) return false;
					if (distKm(p.lat, p.lon, destinoLat, destinoLon) <= 15) return false;
					return true;
				})
				.slice(0, 20);
		} catch {
			return [];
		}
	}

	function circuloEl(color: string, letra: string): HTMLElement {
		const el = document.createElement('div');
		el.style.cssText = 'width:30px;height:30px;cursor:pointer;';
		el.innerHTML = `<div style="width:30px;height:30px;background:${color};border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;">
			<span style="color:#fff;font-weight:700;font-size:11px;">${letra}</span>
		</div>`;
		return el;
	}

	function popupPeaje(p: { nombre: string; lat: number; lon: number }): string {
		const url = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
		return `<div style="padding:10px 12px;min-width:170px;font-family:system-ui,sans-serif;">
			<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
				<div style="width:22px;height:22px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
					<span style="color:#fff;font-weight:700;font-size:10px;">P</span>
				</div>
				<strong style="color:#92400e;font-size:11px;">${p.nombre}</strong>
			</div>
			<a href="${url}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:4px;background:#f59e0b;color:#fff;font-size:10px;font-weight:600;padding:5px 8px;border-radius:6px;text-decoration:none;">📍 Google Maps</a>
		</div>`;
	}

	function popupParada(p: { nombre: string; tipo: string; lat: number; lon: number }): string {
		const url = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
		const cfg: Record<string, { bg: string; emoji: string; label: string }> = {
			restaurante: { bg: '#3b82f6', emoji: '🍽️', label: 'Restaurante' },
			estacion_servicio: { bg: '#8b5cf6', emoji: '⛽', label: 'Est. Servicio' },
			hospedaje: { bg: '#14b8a6', emoji: '🏨', label: 'Hospedaje' }
		};
		const c = cfg[p.tipo] ?? cfg.restaurante;
		return `<div style="padding:10px 12px;min-width:170px;font-family:system-ui,sans-serif;">
			<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
				<div style="width:22px;height:22px;background:${c.bg};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
					<span style="font-size:12px;">${c.emoji}</span>
				</div>
				<strong style="color:#0f172a;font-size:11px;">${p.nombre}</strong>
			</div>
			<a href="${url}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:4px;background:${c.bg};color:#fff;font-size:10px;font-weight:600;padding:5px 8px;border-radius:6px;text-decoration:none;">📍 Google Maps</a>
		</div>`;
	}

	function pintarPeajes() {
		peajeMarkersArr.forEach((m) => m.remove());
		peajeMarkersArr = [];
		if (!map || !showPOIs) return;
		for (const p of peajes) {
			const el = circuloEl('#f59e0b', 'P');
			const popup = new mapboxgl.Popup({
				offset: [0, -16],
				maxWidth: '240px',
				closeButton: true,
				anchor: 'bottom'
			}).setHTML(popupPeaje(p));
			const mk = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
				.setLngLat([p.lon, p.lat])
				.setPopup(popup)
				.addTo(map!);
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				mk.togglePopup();
			});
			peajeMarkersArr.push(mk);
		}
	}

	function pintarParadas() {
		paradaMarkersArr.forEach((m) => m.remove());
		paradaMarkersArr = [];
		if (!map || !showPOIs) return;
		const cfg: Record<string, { color: string; letra: string }> = {
			restaurante: { color: '#3b82f6', letra: 'R' },
			estacion_servicio: { color: '#8b5cf6', letra: 'S' },
			hospedaje: { color: '#14b8a6', letra: 'H' }
		};
		for (const p of paradasSeguras) {
			const c = cfg[p.tipo];
			if (!c) continue;
			const el = circuloEl(c.color, c.letra);
			const popup = new mapboxgl.Popup({
				offset: [0, -16],
				maxWidth: '240px',
				closeButton: true,
				anchor: 'bottom'
			}).setHTML(popupParada(p));
			const mk = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
				.setLngLat([p.lon, p.lat])
				.setPopup(popup)
				.addTo(map!);
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				mk.togglePopup();
			});
			paradaMarkersArr.push(mk);
		}
	}

	function addTraficoLayer() {
		if (!map) return;
		if (map.getLayer('traffic-layer')) map.removeLayer('traffic-layer');
		if (map.getSource('mapbox-traffic')) map.removeSource('mapbox-traffic');
		map.addSource('mapbox-traffic', { type: 'vector', url: 'mapbox://mapbox.mapbox-traffic-v1' });
		map.addLayer({
			id: 'traffic-layer',
			type: 'line',
			source: 'mapbox-traffic',
			'source-layer': 'traffic',
			paint: {
				'line-color': [
					'match',
					['get', 'congestion'],
					'low',
					'#22c55e',
					'moderate',
					'#f59e0b',
					'heavy',
					'#f97316',
					'severe',
					'#ef4444',
					'#94a3b8'
				],
				'line-width': 4,
				'line-opacity': 0.9
			}
		});
	}

	function removeTraficoLayer() {
		if (!map) return;
		if (map.getLayer('traffic-layer')) map.removeLayer('traffic-layer');
		if (map.getSource('mapbox-traffic')) map.removeSource('mapbox-traffic');
	}

	function toggleTrafico() {
		if (!map) return;
		showTrafico = !showTrafico;
		if (showTrafico) addTraficoLayer();
		else removeTraficoLayer();
	}

	$: if (map) {
		if (showPOIs) {
			pintarPeajes();
			pintarParadas();
		} else {
			peajeMarkersArr.forEach((m) => m.remove());
			peajeMarkersArr = [];
			paradaMarkersArr.forEach((m) => m.remove());
			paradaMarkersArr = [];
		}
	}

	function pinEl(color: string, label: string): HTMLDivElement {
		const el = document.createElement('div');
		el.style.cssText = `background:${color};width:36px;height:36px;border-radius:50%;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;`;
		el.innerText = label;
		return el;
	}

	function clearMap() {
		markers.forEach((m) => m.remove());
		markers = [];
		if (map?.getLayer('route')) map.removeLayer('route');
		if (map?.getSource('route')) map.removeSource('route');
		removeTraficoLayer();
		peajeMarkersArr.forEach((m) => m.remove());
		peajeMarkersArr = [];
		paradaMarkersArr.forEach((m) => m.remove());
		paradaMarkersArr = [];
	}

	function initMap() {
		console.log('[PORTAL MAP] initMap()', {
			hasToken: !!MAPBOX_TOKEN,
			hasServicio: !!servicio,
			hasMap: !!map
		});
		if (!MAPBOX_TOKEN || !servicio || map) {
			console.warn('[PORTAL MAP] initMap early return', {
				hasToken: !!MAPBOX_TOKEN,
				hasServicio: !!servicio,
				hasMap: !!map
			});
			return;
		}
		// Fallback: usar lat/lon del municipio si servicio.origen_latitud no está set
		const oLat = servicio.origen_latitud ?? servicio.origen?.latitud ?? undefined;
		const oLng = servicio.origen_longitud ?? servicio.origen?.longitud ?? undefined;
		const dLat = servicio.destino_latitud ?? servicio.destino?.latitud ?? undefined;
		const dLng = servicio.destino_longitud ?? servicio.destino?.longitud ?? undefined;
		console.log('[PORTAL MAP] coords', { oLat, oLng, dLat, dLng });
		if (!oLat || !oLng) {
			console.warn('[PORTAL MAP] no origen coords (ni en servicio ni en municipio)');
			return;
		}
		const container = document.getElementById('map');
		if (!container) {
			console.error('[PORTAL MAP] container #map NOT in DOM');
			return;
		}
		const rect = container.getBoundingClientRect();
		console.log('[PORTAL MAP] container size', {
			w: rect.width,
			h: rect.height,
			offsetParent: container.offsetParent?.tagName
		});
		if (rect.width === 0 || rect.height === 0) {
			console.error('[PORTAL MAP] container has ZERO size — mapbox will not render');
		}
		try {
			mapboxgl.accessToken = MAPBOX_TOKEN;
			map = new mapboxgl.Map({
				container,
				style: 'mapbox://styles/mapbox/outdoors-v12',
				center: [oLng, oLat],
				zoom: 10
			});
			map.on('error', (e) => console.error('[PORTAL MAP] mapbox error', e?.error?.message || e));
			map.on('load', () => {
				console.log('[PORTAL MAP] ✅ mapbox load event fired');
				isMapLoaded = true;
			});
			map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
			console.log('[PORTAL MAP] mapbox.Map() created OK');
			// Safety net: forzar resize por si el container midió 0×0 al instanciar
			setTimeout(() => {
				if (map) {
					map.resize();
					console.log('[PORTAL MAP] map.resize() called (safety net)');
				}
			}, 400);
		} catch (e) {
			console.error('[PORTAL MAP] mapbox.Map() threw', e);
		}
	}

	async function buildRoute() {
		if (!map || !servicio) return;
		clearMap();
		const oLat = servicio.origen_latitud ?? servicio.origen?.latitud ?? undefined;
		const oLng = servicio.origen_longitud ?? servicio.origen?.longitud ?? undefined;
		const dLat = servicio.destino_latitud ?? servicio.destino?.latitud ?? undefined;
		const dLng = servicio.destino_longitud ?? servicio.destino?.longitud ?? undefined;
		if (!oLat || !oLng || !dLat || !dLng) return;
		loadingRoute = true;
		try {
			const r = await fetch(
				`https://api.mapbox.com/directions/v5/mapbox/driving/${oLng},${oLat};${dLng},${dLat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`
			);
			const d = await r.json();
			let routeCoords: number[][] = [];
			if (d.routes?.[0]) {
				const route = d.routes[0];
				distancia = `${(route.distance / 1000).toFixed(1)} km`;
				duracion = fmtMin(route.duration / 60);
				routeCoords = route.geometry.coordinates;

				map.addSource('route', {
					type: 'geojson',
					data: {
						type: 'Feature',
						properties: {},
						geometry: { type: 'LineString', coordinates: routeCoords }
					}
				});
				map.addLayer({
					id: 'route',
					type: 'line',
					source: 'route',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': '#ea580c', 'line-width': 5, 'line-opacity': 0.85 }
				});
			}

			if (showTrafico) addTraficoLayer();

			// Markers
			const om = new mapboxgl.Marker(pinEl('#ea580c', 'A'))
				.setLngLat([oLng, oLat])
				.setPopup(
					new mapboxgl.Popup({ offset: 25 }).setHTML(
						`<div style="padding:8px;font-family:system-ui"><strong style="color:#ea580c;font-size:12px;">Origen</strong><br/><span style="font-size:11px;">${servicio.origen_especifico || servicio.origen?.nombre_municipio || ''}</span></div>`
					)
				);
			om.addTo(map!);
			markers.push(om);

			const dm = new mapboxgl.Marker(pinEl('#DC2626', 'B'))
				.setLngLat([dLng, dLat])
				.setPopup(
					new mapboxgl.Popup({ offset: 25 }).setHTML(
						`<div style="padding:8px;font-family:system-ui"><strong style="color:#DC2626;font-size:12px;">Destino</strong><br/><span style="font-size:11px;">${servicio.destino_especifico || servicio.destino?.nombre_municipio || ''}</span></div>`
					)
				);
			dm.addTo(map!);
			markers.push(dm);

			const bounds = new mapboxgl.LngLatBounds();
			bounds.extend([oLng, oLat]);
			bounds.extend([dLng, dLat]);
			map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 600 });

			// Cargar POIs en paralelo
			if (showPOIs && routeCoords.length > 0) {
				loadingPOIs = true;
				try {
					const [peajesData, paradasData] = await Promise.all([
						obtenerPeajes(routeCoords),
						obtenerParadasSeguras(routeCoords)
					]);
					peajes = peajesData;
					paradasSeguras = paradasData;
					pintarPeajes();
					pintarParadas();
				} finally {
					loadingPOIs = false;
				}
			}
		} catch (e) {
			console.error(e);
		} finally {
			loadingRoute = false;
		}
	}

	function centerRoute() {
		if (!map || !servicio) return;
		const oLat = servicio.origen_latitud ?? servicio.origen?.latitud ?? undefined,
			oLng = servicio.origen_longitud ?? servicio.origen?.longitud ?? undefined;
		const dLat = servicio.destino_latitud ?? servicio.destino?.latitud ?? undefined,
			dLng = servicio.destino_longitud ?? servicio.destino?.longitud ?? undefined;
		if (!oLat || !oLng || !dLat || !dLng) return;
		const b = new mapboxgl.LngLatBounds();
		b.extend([oLng, oLat]);
		b.extend([dLng, dLat]);
		map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 600 });
	}

	function back() {
		goto('/public/portal/servicios');
	}

	function openInGoogleMaps() {
		if (!servicio) return;
		const oLat = servicio.origen_latitud ?? servicio.origen?.latitud;
		const oLng = servicio.origen_longitud ?? servicio.origen?.longitud;
		const dLat = servicio.destino_latitud ?? servicio.destino?.latitud;
		const dLng = servicio.destino_longitud ?? servicio.destino?.longitud;
		if (oLat && oLng && dLat && dLng) {
			window.open(
				`https://www.google.com/maps/dir/${oLat},${oLng}/${dLat},${dLng}`,
				'_blank',
				'noopener'
			);
		} else if (servicio.origen_especifico) {
			window.open(
				`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(servicio.origen_especifico)}`,
				'_blank',
				'noopener'
			);
		}
	}

	onMount(async () => {
		if (!$isAuthenticated) {
			goto('/public/portal');
			return;
		}
		const id = $page.params.id;
		if (id) {
			await conductorServiciosStore.cargarDetalle(id);
		}
	});

	// Init del mapa: mismo patrón que el dashboard (funciona probado)
	$: if (servicio && !map && !loading) {
		console.log('[PORTAL MAP] reactive trigger — servicio listo, esperando DOM…');
		setTimeout(() => {
			const c = document.getElementById('map');
			console.log('[PORTAL MAP] after setTimeout, #map exists?', !!c);
			if (c) initMap();
		}, 300);
	}

	$: if (isMapLoaded && servicio) buildRoute();

	onDestroy(() => {
		[...markers, ...peajeMarkersArr, ...paradaMarkersArr].forEach((m) => m.remove());
		if (map) {
			clearMap();
			map.remove();
			map = null;
		}
		conductorServiciosStore.limpiarDetalle();
	});
</script>

<svelte:head>
	<title
		>{servicio
			? `Servicio ${servicio.id.slice(0, 8).toUpperCase()} · Portal`
			: 'Cargando... · Portal'}</title
	>
</svelte:head>

<div class="detalle-page" in:fade={{ duration: 350 }}>
	{#if loading}
		<div class="loading-center">
			<div class="spinner"></div>
			<p>Cargando servicio…</p>
		</div>
	{:else if error}
		<div class="error-center">
			<div class="error-icon-lg">⚠️</div>
			<p class="error-title">No pudimos cargar el servicio</p>
			<p class="error-msg">{error}</p>
			<button class="btn-retry" on:click={back}>Volver</button>
		</div>
	{:else if servicio && pal}
		<!-- ─── HEADER (estilo landing) ─── -->
		<header class="servicio-header">
			<button
				class="servicio-icon-btn"
				on:click={back}
				aria-label="Volver a mis servicios"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
			</button>

			<div class="servicio-brand-icon" aria-hidden="true">
				<svg
					class="h-5 w-5 text-white"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="1.8"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
					/>
				</svg>
			</div>

			<div class="min-w-0 flex-1">
				<span class="servicio-eyebrow">Detalle del servicio</span>
				<h1 class="servicio-title">
					{servicio.origen_especifico || servicio.origen?.nombre_municipio || 'Origen'}
					<span class="servicio-title-arrow" aria-hidden="true">→</span>
					{servicio.destino_especifico || servicio.destino?.nombre_municipio || 'Destino'}
				</h1>
			</div>

			<span
				class="servicio-status-pill"
				style="background-color: {pal.bg}; color: {pal.fg}; border-color: {pal.border}"
			>
				<span class="servicio-status-dot" style="background-color: {pal.dot}"></span>
				{pal.label}
			</span>
		</header>

		<!-- ─── MAPA (altura fija, sin problemas de render) ─── -->
		<section class="map-section">
			<div class="map-frame" class:map-frame--loading={loadingRoute}>
				<div id="map" class="map-canvas"></div>

				<!-- Controles flotantes -->
				<div class="map-controls">
					<button
						class="map-fab"
						on:click={centerRoute}
						aria-label="Centrar ruta"
						title="Centrar"
					>
						<svg
							class="h-4 w-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
							/>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
							/>
						</svg>
					</button>
					<button
						class="map-fab"
						on:click={openInGoogleMaps}
						aria-label="Abrir en Google Maps"
						title="Google Maps"
					>
						<svg
							class="h-4 w-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
							/>
						</svg>
					</button>
				</div>

				<!-- Toggles pill sobre el mapa -->
				<div class="map-toggles">
					<button
						class="toggle-pill"
						class:active={showTrafico}
						on:click={toggleTrafico}
					>
						<span class="toggle-dot" class:on={showTrafico}></span>
						Tráfico
					</button>
					<button
						class="toggle-pill"
						class:active={showPOIs}
						on:click={() => (showPOIs = !showPOIs)}
					>
						<span class="toggle-dot" class:on={showPOIs}></span>
						POIs
					</button>
				</div>

				{#if loadingRoute}
					<div class="map-loading-overlay">
						<div class="spinner-sm"></div>
						<span>Trazando ruta…</span>
					</div>
				{/if}
			</div>

			<!-- Quick stats bar (estilo landing: chips con tinte emerald) -->
			<div class="route-stats">
				<div class="stat-chip">
					<span class="stat-chip-label">Distancia</span>
					<span class="stat-chip-value">{distancia}</span>
				</div>
				<div class="stat-chip">
					<span class="stat-chip-label">Tiempo est.</span>
					<span class="stat-chip-value">{duracion}</span>
				</div>
				{#if countPeajes > 0}
					<div class="stat-chip stat-chip--amber">
						<span class="stat-chip-label">Peajes</span>
						<span class="stat-chip-value">{countPeajes}</span>
					</div>
				{/if}
				{#if countRestaurantes > 0}
					<div class="stat-chip stat-chip--blue">
						<span class="stat-chip-label">Restaurantes</span>
						<span class="stat-chip-value">{countRestaurantes}</span>
					</div>
				{/if}
				{#if countEstaciones > 0}
					<div class="stat-chip stat-chip--purple">
						<span class="stat-chip-label">Est. Servicio</span>
						<span class="stat-chip-value">{countEstaciones}</span>
					</div>
				{/if}
				{#if countHospedajes > 0}
					<div class="stat-chip stat-chip--teal">
						<span class="stat-chip-label">Hospedajes</span>
						<span class="stat-chip-value">{countHospedajes}</span>
					</div>
				{/if}
			</div>
		</section>

		<!-- ─── INFO CARDS ─── -->
		<main class="info-scroll">
			<!-- Vehículo -->
			{#if servicio.vehiculo}
				<section class="card" in:fly={{ y: 20, duration: 400, easing: quintOut }}>
					<header class="card-head">
						<div class="card-icon">
							<svg
								class="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
								/>
							</svg>
						</div>
						<h2 class="card-title">Vehículo asignado</h2>
					</header>
					<div class="vehiculo-block">
						<p class="placa-big">{servicio.vehiculo.placa}</p>
						{#if servicio.vehiculo.marca || servicio.vehiculo.linea || servicio.vehiculo.modelo}
							<p class="vehiculo-desc">
								{[servicio.vehiculo.marca, servicio.vehiculo.linea, servicio.vehiculo.modelo]
									.filter(Boolean)
									.join(' ')}
							</p>
						{/if}
						{#if servicio.vehiculo.color || servicio.vehiculo.clase_vehiculo || servicio.vehiculo.combustible}
							<div class="vehiculo-tags">
								{#if servicio.vehiculo.color}
									<span class="vtag">🎨 {servicio.vehiculo.color}</span>
								{/if}
								{#if servicio.vehiculo.clase_vehiculo}
									<span class="vtag">🚗 {servicio.vehiculo.clase_vehiculo}</span>
								{/if}
								{#if servicio.vehiculo.combustible}
									<span class="vtag">⛽ {servicio.vehiculo.combustible}</span>
								{/if}
							</div>
						{/if}
					</div>
				</section>
			{/if}

			<!-- Recorrido -->
			<section class="card" in:fly={{ y: 20, duration: 400, easing: quintOut, delay: 60 }}>
				<header class="card-head">
					<div class="card-icon">
						<svg
							class="h-4 w-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
							/>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
							/>
						</svg>
					</div>
					<h2 class="card-title">Recorrido</h2>
				</header>
				<div class="recorrido-row">
					<div class="recorrido-pins" aria-hidden="true">
						<div class="rpin origin">A</div>
						<div class="rline"></div>
						<div class="rpin dest">B</div>
					</div>
					<div class="recorrido-locs">
						<div class="rloc">
							<p class="rloc-label">Origen</p>
							<p class="rloc-text">{servicio.origen_especifico || '—'}</p>
							{#if servicio.origen?.nombre_departamento}
								<p class="rloc-sub">
									{servicio.origen.nombre_municipio}, {servicio.origen.nombre_departamento}
								</p>
							{/if}
						</div>
						<div class="rloc">
							<p class="rloc-label">Destino</p>
							<p class="rloc-text">{servicio.destino_especifico || '—'}</p>
							{#if servicio.destino?.nombre_departamento}
								<p class="rloc-sub">
									{servicio.destino.nombre_municipio}, {servicio.destino.nombre_departamento}
								</p>
							{/if}
						</div>
					</div>
				</div>
			</section>

			<!-- Cliente -->
			{#if servicio.cliente}
				<section class="card" in:fly={{ y: 20, duration: 400, easing: quintOut, delay: 120 }}>
					<header class="card-head">
						<div class="card-icon">
							<svg
								class="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
								/>
							</svg>
						</div>
						<h2 class="card-title">Cliente</h2>
					</header>
					<p class="cliente-nombre">{servicio.cliente.nombre || '—'}</p>
					{#if servicio.cliente.nit}
						<p class="cliente-nit">NIT {servicio.cliente.nit}</p>
					{/if}
				</section>
			{/if}

			<!-- Información -->
			<section class="card" in:fly={{ y: 20, duration: 400, easing: quintOut, delay: 180 }}>
				<header class="card-head">
					<div class="card-icon">
						<svg
							class="h-4 w-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
							/>
						</svg>
					</div>
					<h2 class="card-title">Información</h2>
				</header>
				<div class="info-list">
					<div class="info-item">
						<span class="info-key">Solicitud</span>
						<span class="info-val">{fmtDate(servicio.fecha_solicitud)}</span>
					</div>
					{#if servicio.fecha_realizacion}
						<div class="info-item">
							<span class="info-key">Realización</span>
							<span class="info-val">{fmtDate(servicio.fecha_realizacion)}</span>
						</div>
					{/if}
					{#if servicio.fecha_finalizacion}
						<div class="info-item">
							<span class="info-key">Finalización</span>
							<span class="info-val">{fmtDate(servicio.fecha_finalizacion)}</span>
						</div>
					{/if}
					{#if servicio.numero_planilla}
						<div class="info-item">
							<span class="info-key">Planilla</span>
							<span class="info-val info-val--mono">{servicio.numero_planilla}</span>
						</div>
					{/if}
					{#if servicio.proposito_servicio}
						<div class="info-item">
							<span class="info-key">Propósito</span>
							<span class="info-val info-val--capitalize">
								{servicio.proposito_servicio.replace(/_/g, ' ')}
							</span>
						</div>
					{/if}
				</div>
			</section>

			<!-- Loading POIs banner -->
			{#if loadingPOIs}
				<div class="poi-loading" in:fade>
					<div class="spinner-sm"></div>
					<span>Buscando peajes y paradas seguras en la ruta…</span>
				</div>
			{/if}
		</main>
	{/if}
</div>

<style>
	/* ═══════════════════════════════════════
	   TOKENS — landing-transmeralda editorial
	   (consistente con +layout.svelte)
	═══════════════════════════════════════ */
	.detalle-page {
		--bg: #faf7f2;
		--surface: #ffffff;
		--surface-2: #f5f1e8;
		--border: rgba(0, 0, 0, 0.08);
		--border-default: rgba(0, 0, 0, 0.12);
		--text: #1a1a1a;
		--text-2: #4a4a4a;
		--text-3: #6b6b6b;
		--text-4: #9a9a9a;
		--orange-500: #f97316;
		--orange-600: #ea580c;
		--orange-700: #047857;
		--orange-800: #065f46;
		--emerald-tint: rgba(249, 115, 22, 0.08);
		--emerald-tint-hover: rgba(249, 115, 22, 0.14);
		--emerald-border: rgba(249, 115, 22, 0.18);
		--shadow-soft: 0 4px 24px rgba(0, 0, 0, 0.04);
		--ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);

		font-family: 'Inter', 'Inter Tight', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
		min-height: 100%;
		width: 100%;
		max-width: 100%;
		overflow-x: hidden;
		background: var(--bg);
		color: var(--text);
		-webkit-font-smoothing: antialiased;
	}

	/* ═══════════════════════════════════════
	   LOADING / ERROR
	═══════════════════════════════════════ */
	.loading-center,
	.error-center {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 4rem 1.5rem;
		text-align: center;
		flex: 1;
		min-height: 50vh;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid var(--emerald-tint);
		border-top-color: var(--emerald-600);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.spinner-sm {
		width: 16px;
		height: 16px;
		border: 2px solid var(--emerald-tint);
		border-top-color: var(--emerald-600);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		flex-shrink: 0;
	}

	.error-icon-lg {
		font-size: 2.75rem;
	}

	.error-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text);
		margin: 0.5rem 0 0;
	}

	.error-msg {
		font-size: 0.85rem;
		color: var(--text-3);
		margin: 0;
		max-width: 320px;
	}

	.btn-retry {
		margin-top: 0.85rem;
		padding: 0.65rem 1.35rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: white;
		background: linear-gradient(135deg, var(--emerald-500), var(--emerald-600));
		border: none;
		border-radius: 12px;
		cursor: pointer;
		font-family: inherit;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
		transition: all 0.2s var(--ease);
	}

	.btn-retry:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
	}

	/* ═══════════════════════════════════════
	   HEADER (estilo landing servicio-header)
	═══════════════════════════════════════ */
	.servicio-header {
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		padding: 0.85rem 1rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
		position: sticky;
		top: 0;
		z-index: 30;
	}
	@media (min-width: 640px) {
		.servicio-header {
			padding: 0.85rem 1.25rem;
		}
	}

	.servicio-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: #faf7f2;
		color: var(--text-2);
		border: 1px solid var(--border);
		cursor: pointer;
		transition: all 0.2s var(--ease);
		flex-shrink: 0;
	}

	.servicio-icon-btn:hover {
		background: white;
		border-color: var(--emerald-border);
		color: var(--emerald-600);
		transform: translateY(-1px);
	}

	.servicio-brand-icon {
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: linear-gradient(135deg, var(--emerald-500), var(--emerald-600));
		display: none;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
		flex-shrink: 0;
	}

	@media (min-width: 640px) {
		.servicio-brand-icon {
			display: flex;
		}
	}

	.servicio-eyebrow {
		display: inline-block;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--emerald-600);
		background: var(--emerald-tint);
		padding: 0.2rem 0.55rem;
		border-radius: 5px;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
	}

	.servicio-title {
		font-family: 'Fraunces', Georgia, serif;
		font-weight: 500;
		font-size: 0.98rem;
		color: #0f1f1a;
		margin: 0.3rem 0 0;
		line-height: 1.25;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		letter-spacing: -0.01em;
	}

	.servicio-title-arrow {
		color: var(--text-4);
		font-weight: 400;
		margin: 0 0.2rem;
	}

	.servicio-status-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.3rem 0.65rem;
		border-radius: 999px;
		border: 1px solid;
		flex-shrink: 0;
	}

	.servicio-status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	/* ═══════════════════════════════════════
	   MAPA (altura fija, glass + soft-shadow)
	═══════════════════════════════════════ */
	.map-section {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.map-frame {
		position: relative;
		width: 100%;
		/* Altura fija responsive — clave para que mapbox calcule bien el tamaño */
		height: 360px;
		min-height: 360px;
		flex-shrink: 0;
		overflow: hidden;
		border-radius: 20px;
		border: 1px solid var(--border);
		background: #e8e4dc;
		box-shadow: var(--shadow-soft);
		/* FIX: crear stacking context dedicado. En el dashboard lo logra
		   la clase `glass` via `backdrop-filter: blur(20px)`. Sin esto,
		   el canvas WebGL de mapbox queda en un contexto roto (no
		   compone) y no se ve. */
		isolation: isolate;
		will-change: transform;
	}

	@media (min-width: 640px) {
		.map-frame {
			height: 420px;
			min-height: 420px;
		}
	}

	@media (min-width: 1024px) {
		.map-frame {
			height: 500px;
			min-height: 500px;
		}
	}

	.map-canvas {
		width: 100%;
		height: 100%;
	}

	.map-frame--loading .map-canvas {
		opacity: 0.7;
	}

	.map-loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: rgba(255, 255, 255, 0.5);
		backdrop-filter: blur(2px);
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--emerald-700);
		z-index: 5;
		pointer-events: none;
	}

	/* ─── Controles flotantes ─── */
	.map-controls {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		z-index: 10;
	}

	.map-fab {
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(8px);
		border: 1px solid var(--border);
		color: var(--text-2);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
		transition: all 0.2s var(--ease);
	}

	.map-fab:hover {
		color: var(--emerald-600);
		border-color: var(--emerald-border);
		transform: translateY(-1px);
	}

	.map-fab:active {
		transform: scale(0.95);
	}

	/* ─── Toggle pills ─── */
	.map-toggles {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		display: flex;
		gap: 0.35rem;
		z-index: 10;
	}

	.toggle-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.85rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text-2);
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(8px);
		border: 1px solid var(--border);
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
		transition: all 0.2s var(--ease);
	}

	.toggle-pill.active {
		color: var(--emerald-700);
		background: var(--emerald-tint);
		border-color: var(--emerald-border);
	}

	.toggle-pill:active {
		transform: scale(0.96);
	}

	.toggle-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--text-4);
		transition: all 0.2s var(--ease);
	}

	.toggle-dot.on {
		background: var(--emerald-500);
		box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.25);
	}

	/* ═══════════════════════════════════════
	   ROUTE STATS (chips con tinte landing)
	═══════════════════════════════════════ */
	.route-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0;
	}

	.stat-chip {
		flex: 1 1 auto;
		min-width: 110px;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.7rem 0.95rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: var(--shadow-soft);
		transition: all 0.2s var(--ease);
	}

	.stat-chip:hover {
		border-color: var(--emerald-border);
		transform: translateY(-1px);
	}

	.stat-chip--amber:hover {
		border-color: rgba(245, 158, 11, 0.3);
	}

	.stat-chip--blue:hover {
		border-color: rgba(59, 130, 246, 0.3);
	}

	.stat-chip--purple:hover {
		border-color: rgba(139, 92, 246, 0.3);
	}

	.stat-chip--teal:hover {
		border-color: rgba(20, 184, 166, 0.3);
	}

	.stat-chip-label {
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: 'JetBrains Mono', monospace;
	}

	.stat-chip-value {
		font-size: 0.95rem;
		font-weight: 700;
		color: #0f1f1a;
		font-family: 'Fraunces', Georgia, serif;
		letter-spacing: -0.01em;
	}

	/* ═══════════════════════════════════════
	   INFO SCROLL — CARDS
	═══════════════════════════════════════ */
	.info-scroll {
		flex: 1;
		padding: 0 1rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		min-width: 0;
	}

	@media (min-width: 640px) {
		.info-scroll {
			padding: 0 1.25rem 2.5rem;
		}
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.15rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
		box-shadow: var(--shadow-soft);
		min-width: 0;
		max-width: 100%;
		transition: all 0.3s var(--ease);
	}

	.card:hover {
		border-color: var(--emerald-border);
		box-shadow: 0 8px 28px rgba(249, 115, 22, 0.08);
	}

	.card-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.card-icon {
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: linear-gradient(135deg, var(--emerald-500), var(--emerald-600));
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 3px 10px rgba(249, 115, 22, 0.3);
		flex-shrink: 0;
	}

	.card-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--text);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin: 0;
	}

	/* ─── Vehículo ─── */
	.vehiculo-block {
		padding: 0.85rem 1rem;
		background: var(--bg);
		border-radius: 12px;
		min-width: 0;
		overflow: hidden;
	}

	.placa-big {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--emerald-700);
		letter-spacing: 0.08em;
		margin: 0;
		font-family: 'JetBrains Mono', 'Courier New', monospace;
	}

	.vehiculo-desc {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-2);
		margin: 0.25rem 0 0;
	}

	.vehiculo-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.65rem;
	}

	.vtag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
	}

	/* ─── Recorrido ─── */
	.recorrido-row {
		display: flex;
		gap: 1rem;
		align-items: stretch;
		min-width: 0;
	}

	.recorrido-pins {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-top: 0.2rem;
	}

	.rpin {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.78rem;
		font-weight: 700;
		color: white;
		flex-shrink: 0;
	}

	.rpin.origin {
		background: linear-gradient(135deg, var(--emerald-500), var(--emerald-600));
		box-shadow: 0 0 0 3px var(--emerald-tint);
	}

	.rpin.dest {
		background: linear-gradient(135deg, #ef4444, #dc2626);
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18);
	}

	.rline {
		width: 2px;
		flex: 1;
		min-height: 20px;
		background: linear-gradient(to bottom, var(--emerald-500), #dc2626);
		opacity: 0.6;
		margin: 4px 0;
	}

	.recorrido-locs {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 0.85rem;
		min-width: 0;
	}

	.rloc-label {
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin: 0 0 0.15rem;
		font-family: 'JetBrains Mono', monospace;
	}

	.rloc-text {
		font-size: 0.95rem;
		font-weight: 600;
		color: #0f1f1a;
		margin: 0;
		line-height: 1.25;
		word-break: break-word;
	}

	.rloc-sub {
		font-size: 0.72rem;
		color: var(--text-3);
		margin: 0.2rem 0 0;
	}

	/* ─── Cliente ─── */
	.cliente-nombre {
		font-size: 0.95rem;
		font-weight: 600;
		color: #0f1f1a;
		margin: 0;
	}

	.cliente-nit {
		font-size: 0.75rem;
		color: var(--text-3);
		margin: 0.25rem 0 0;
		font-family: 'JetBrains Mono', monospace;
	}

	/* ─── Info list ─── */
	.info-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.info-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.65rem;
		border-radius: 10px;
		min-width: 0;
		transition: background 0.2s var(--ease);
	}

	.info-item:hover {
		background: var(--bg);
	}

	.info-key {
		font-size: 0.78rem;
		color: var(--text-3);
		font-weight: 500;
	}

	.info-val {
		font-size: 0.85rem;
		font-weight: 600;
		color: #0f1f1a;
		text-align: right;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.info-val--mono {
		font-family: 'JetBrains Mono', monospace;
		color: var(--emerald-700);
	}

	.info-val--capitalize {
		text-transform: capitalize;
	}

	/* ─── POI loading ─── */
	.poi-loading {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.75rem 1rem;
		background: var(--emerald-tint);
		border: 1px solid var(--emerald-border);
		border-radius: 14px;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--emerald-700);
	}

	/* ─── Mapbox overrides ─── */
	:global(.mapboxgl-popup-content) {
		padding: 0 !important;
		border-radius: 12px !important;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18) !important;
		overflow: hidden;
	}

	:global(.mapboxgl-popup-tip) {
		display: none;
	}

	:global(.mapboxgl-ctrl-top-right) {
		top: 3.5rem !important;
		right: 0.5rem !important;
	}

	:global(.mapboxgl-ctrl-group) {
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08) !important;
		border-radius: 10px !important;
		overflow: hidden;
		border: 1px solid var(--border) !important;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
