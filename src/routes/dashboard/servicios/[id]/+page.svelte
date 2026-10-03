<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade } from 'svelte/transition';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	import { servicioDetalleStore } from '$lib/stores/servicio-detalle';
	import { serviciosStore } from '$lib/stores/servicios';
	import { labelPropositoServicio } from '$lib/config/proposito-servicio';
	import { sidebarStore } from '$lib/stores/sidebar';
	import distracomLocations from '$lib/data/distracomlocations';
	import EjecucionConductor from '$lib/components/servicios/EjecucionConductor.svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

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

	// ─── STORE ────────────────────────────────────────────────────

	$: servicio = $servicioDetalleStore.servicio;
	$: loading = $servicioDetalleStore.loading;
	$: error = $servicioDetalleStore.error;

	// ─── ESTADO ───────────────────────────────────────────────────

	let map: mapboxgl.Map | null = null;
	let isMapLoaded = false;
	let markers: mapboxgl.Marker[] = [];
	let distracomMarkers: mapboxgl.Marker[] = [];
	let peajeMarkersArr: mapboxgl.Marker[] = [];
	let paradaMarkersArr: mapboxgl.Marker[] = [];

	let distancia = '—';
	let duracion = '—';
	let isNavigating = false;
	let showShareModal = false;
	let generatedShareUrl = '';
	let copySuccess = false;

	// POIs
	let peajes: PeajeInfo[] = [];
	let paradasSeguras: ParadaSegura[] = [];
	let loadingPOIs = false;

	// Toggles capas de riesgo y tráfico
	let showTrafico = true;
	let showRiesgos = true;

	// Estado panel condiciones viales
	interface CondicionVial {
		tipo: 'trafico' | 'riesgo' | 'clima' | 'info';
		nivel: 'ok' | 'moderado' | 'alto' | 'critico';
		titulo: string;
		descripcion: string;
	}
	interface IncidenteVial {
		id: string;
		tipo: string; // accident | road_closure | construction | hazard | weather | congestion
		descripcion: string;
		longDescripcion: string;
		impacto: string; // critical | major | minor | low
		cerrrado: boolean;
		viasAfectadas: string[];
		lat: number;
		lon: number;
	}
	let condicionesViales: CondicionVial[] = [];
	let incidentes: IncidenteVial[] = [];
	let incidenteMarkersArr: mapboxgl.Marker[] = [];
	let loadingCondiciones = false;
	let showIncidentes = true;

	// Incidentes nacionales (viewport — estilo Waze)
	let incidentesNacionales: any[] = [];
	let fetchingNacionales = false;
	let moveendTimer: ReturnType<typeof setTimeout>;

	// Toggles leyenda
	let showPeajes = true;
	let showRestaurantes = true;
	let showEstaciones = true;
	let showHospedajes = true;
	let showDistracom = true;

	// ─── HELPERS ──────────────────────────────────────────────────

	const STATUS_COLOR: Record<string, string> = {
		pendiente: '#F59E0B',
		en_curso: '#3B82F6',
		planificado: '#8B5CF6',
		completado: '#16a34a',
		realizado: '#16a34a',
		cancelado: '#EF4444',
		liquidado: '#6B7280'
	};
	const STATUS_LABEL: Record<string, string> = {
		solicitado: 'Solicitado',
		pendiente: 'Pendiente',
		en_curso: 'En curso',
		planificado: 'Planificado',
		completado: 'Completado',
		realizado: 'Realizado',
		planilla_asignada: 'Planilla asignada',
		cancelado: 'Cancelado',
		liquidado: 'Liquidado'
	};
	/** Chip del estado como en la app móvil (src/lib/service-status.ts): mismo tono en claro y en oscuro. */
	const ESTADO_APP: Record<string, { fondo: string; texto: string }> = {
		en_curso: { fondo: '#FEF3C7', texto: '#92400E' },
		planificado: { fondo: '#EDE9FE', texto: '#6D28D9' },
		solicitado: { fondo: '#DBEAFE', texto: '#1D4ED8' },
		pendiente: { fondo: '#F3F4F6', texto: '#374151' },
		realizado: { fondo: '#D1FAE5', texto: '#047857' },
		completado: { fondo: '#D1FAE5', texto: '#047857' },
		planilla_asignada: { fondo: '#E0E7FF', texto: '#4338CA' },
		liquidado: { fondo: '#CFFAFE', texto: '#0E7490' },
		cancelado: { fondo: '#FEE2E2', texto: '#B91C1C' }
	};
	/** Chip de cada condición de la vía, como el chip de tráfico de la app. */
	const NIVEL_APP: Record<string, { fondo: string; texto: string }> = {
		ok: { fondo: '#DCFCE7', texto: '#166534' },
		moderado: { fondo: '#FEF3C7', texto: '#92400E' },
		alto: { fondo: '#FFEDD5', texto: '#9A3412' },
		critico: { fondo: '#FEE2E2', texto: '#991B1B' }
	};
	const fmtDate = (d: any) =>
		d
			? new Intl.DateTimeFormat('es-CO', {
					day: 'numeric',
					month: 'short',
					year: 'numeric'
				}).format(new Date(d))
			: '—';
	const fmtTime = (d: any) =>
		d
			? new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(d))
			: '—';
	const fmtMin = (m: number) => {
		const h = Math.floor(m / 60),
			r = Math.round(m % 60);
		return h > 0 ? `${h}h ${r}min` : `${r}min`;
	};

	// ─── GEOMETRÍA: DISTANCIA PUNTO → SEGMENTO DE POLILÍNEA ────────
	// Calcula la distancia mínima en km desde un punto (lat/lon)
	// a cualquier segmento de la polilínea de la ruta.
	// Esto es necesario porque Mapbox devuelve puntos espaciados y
	// la ruta entre dos coordenadas puede pasar lejos de los puntos de muestreo.

	function distPuntoSegmento(
		pLat: number,
		pLon: number,
		aLat: number,
		aLon: number,
		bLat: number,
		bLon: number
	): number {
		// Convertir a coordenadas planas aproximadas (suficiente para <500 km)
		const R = 111.32; // km por grado
		const cosLat = Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);

		const px = (pLon - aLon) * R * cosLat;
		const py = (pLat - aLat) * R;
		const dx = (bLon - aLon) * R * cosLat;
		const dy = (bLat - aLat) * R;

		const lenSq = dx * dx + dy * dy;
		if (lenSq === 0) return Math.sqrt(px * px + py * py);

		// Parámetro t: proyección del punto sobre el segmento [0,1]
		const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));

		const nearX = px - t * dx;
		const nearY = py - t * dy;
		return Math.sqrt(nearX * nearX + nearY * nearY);
	}

	function esCercanoPolicromia(
		lat: number,
		lon: number,
		coords: number[][],
		umbralKm: number
	): boolean {
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

	// ─── OVERPASS: PEAJES ─────────────────────────────────────────

	async function obtenerPeajes(routeCoords: number[][]): Promise<PeajeInfo[]> {
		try {
			const lats = routeCoords.map((c) => c[1]);
			const lngs = routeCoords.map((c) => c[0]);
			// Buffer de 0.05° (~5 km) alrededor del bbox de la ruta
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

			// Origen y destino de la ruta
			const origenLat = routeCoords[0][1],
				origenLon = routeCoords[0][0];
			const destinoLat = routeCoords[routeCoords.length - 1][1];
			const destinoLon = routeCoords[routeCoords.length - 1][0];
			const EXCLUSION_KM = 10; // Peajes dentro de 10 km de la ciudad los ignoramos

			const distKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
				const R = 111.32;
				const cosLat = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
				return Math.sqrt(((lat2 - lat1) * R) ** 2 + ((lon2 - lon1) * R * cosLat) ** 2);
			};

			return (data.elements || [])
				.map((el: any) => ({ nombre: el.tags?.name || 'Peaje', lat: el.lat, lon: el.lon }))
				.filter((p: PeajeInfo) => {
					// 1. Debe estar sobre el trazado real de la ruta (≤ 2 km)
					if (!esCercanoPolicromia(p.lat, p.lon, routeCoords, 2)) return false;
					// 2. Excluir peajes dentro del radio urbano de origen o destino
					if (distKm(p.lat, p.lon, origenLat, origenLon) <= EXCLUSION_KM) return false;
					if (distKm(p.lat, p.lon, destinoLat, destinoLon) <= EXCLUSION_KM) return false;
					return true;
				});
		} catch {
			return [];
		}
	}

	// ─── OVERPASS: PARADAS SEGURAS ────────────────────────────────

	async function obtenerParadasSeguras(routeCoords: number[][]): Promise<ParadaSegura[]> {
		try {
			const lats = routeCoords.map((c) => c[1]);
			const lngs = routeCoords.map((c) => c[0]);

			// Origen y destino de la ruta (primer y último punto)
			const origenLat = routeCoords[0][1],
				origenLon = routeCoords[0][0];
			const destinoLat = routeCoords[routeCoords.length - 1][1];
			const destinoLon = routeCoords[routeCoords.length - 1][0];

			// Radio de exclusión alrededor de las ciudades extremas:
			// 15 km en zonas urbanas evita los cientos de hoteles/restaurantes
			// de origen y destino. Solo quedan los del trayecto intermedio.
			const EXCLUSION_KM = 15;

			// Buffer de 0.04° (~4 km) alrededor del bbox
			const bbox = [
				Math.min(...lats) - 0.04,
				Math.min(...lngs) - 0.04,
				Math.max(...lats) + 0.04,
				Math.max(...lngs) + 0.04
			];
			const query = `[out:json][timeout:20];(
				node["amenity"="restaurant"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
				node["amenity"="fuel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
				node["tourism"="hotel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
				node["tourism"="hostel"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
				node["tourism"="guest_house"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
			);out body;`;
			const res = await fetch(OVERPASS_API, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `data=${encodeURIComponent(query)}`,
				signal: AbortSignal.timeout(20000)
			});
			if (!res.ok) return [];
			const data = (await res.json()) as { elements?: any[] };

			// Distancia aproximada entre dos puntos en km (Haversine simplificado)
			const distKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
				const R = 111.32;
				const cosLat = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
				const dLat = (lat2 - lat1) * R;
				const dLon = (lon2 - lon1) * R * cosLat;
				return Math.sqrt(dLat * dLat + dLon * dLon);
			};

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
					// 1. Debe estar a ≤ 3 km del trazado real de la ruta
					if (!esCercanoPolicromia(p.lat, p.lon, routeCoords, 3)) return false;

					// 2. Excluir POIs dentro del radio urbano de origen o destino
					//    Evita los cientos de hoteles/restaurantes de las ciudades extremas
					if (distKm(p.lat, p.lon, origenLat, origenLon) <= EXCLUSION_KM) return false;
					if (distKm(p.lat, p.lon, destinoLat, destinoLon) <= EXCLUSION_KM) return false;

					return true;
				})
				.slice(0, 30);
		} catch {
			return [];
		}
	}

	// ─── DISTRACOM ────────────────────────────────────────────────

	function getEstaciones(routeCoords: number[][]): DistracomEstacion[] {
		if (!routeCoords.length) {
			// Sin ruta: mostrar todas las de departamentos permitidos
			return (distracomLocations as any[]).reduce((acc: DistracomEstacion[], r) => {
				const d = (r.Departamento || '').toLowerCase().trim();
				const lat = Number(r.Latitud),
					lon = Number(r.Longitud);
				if (!DISTRACOM_DEPARTAMENTOS.includes(d) || isNaN(lat) || isNaN(lon)) return acc;
				const srvs: string[] = (r.Servicios || []).map((s: any) => s.Nombre?.toLowerCase() || '');
				acc.push({
					nombre: r.NombreEstacion || 'Distracom',
					direccion: r.Direccion || '',
					ciudad: r.Ciudad || '',
					departamento: r.Departamento || '',
					lat,
					lon,
					diesel: (r.DIESEL ?? 0) > 0,
					gasolina: (r.CORRIENTE ?? 0) > 0 || (r.PREMIUM ?? 0) > 0,
					hotel: r.Hotel === true,
					lubricentro: srvs.some((s) => s.includes('lubricentro'))
				});
				return acc;
			}, []);
		}
		const lats = routeCoords.map((c) => c[1]),
			lngs = routeCoords.map((c) => c[0]);
		const bbox = {
			minLat: Math.min(...lats) - 0.5,
			maxLat: Math.max(...lats) + 0.5,
			minLng: Math.min(...lngs) - 0.5,
			maxLng: Math.max(...lngs) + 0.5
		};
		return (distracomLocations as any[])
			.filter((r) => {
				const d = (r.Departamento || '').toLowerCase().trim(),
					lat = Number(r.Latitud),
					lon = Number(r.Longitud);
				if (!DISTRACOM_DEPARTAMENTOS.includes(d) || isNaN(lat) || isNaN(lon)) return false;
				if (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLng || lon > bbox.maxLng)
					return false;
				return routeCoords.some((c) => Math.abs(lat - c[1]) < 0.45 && Math.abs(lon - c[0]) < 0.45);
			})
			.map((r) => {
				const srvs: string[] = (r.Servicios || []).map((s: any) => s.Nombre?.toLowerCase() || '');
				return {
					nombre: r.NombreEstacion || 'Distracom',
					direccion: r.Direccion || '',
					ciudad: r.Ciudad || '',
					departamento: r.Departamento || '',
					lat: Number(r.Latitud),
					lon: Number(r.Longitud),
					diesel: (r.DIESEL ?? 0) > 0,
					gasolina: (r.CORRIENTE ?? 0) > 0 || (r.PREMIUM ?? 0) > 0,
					hotel: r.Hotel === true,
					lubricentro: srvs.some((s) => s.includes('lubricentro'))
				};
			})
			.slice(0, 6);
	}

	// ─── INCIDENTES VIALES ────────────────────────────────────────

	function tipoLabel(tipo: string): string {
		const labels: Record<string, string> = {
			accident: 'Accidente vial',
			road_closure: 'Cierre de vía',
			construction: 'Obra en vía',
			hazard: 'Peligro en vía',
			weather: 'Condición climática',
			congestion: 'Congestión vehicular',
			disabled_vehicle: 'Vehículo varado'
		};
		return labels[tipo] ?? 'Novedad vial';
	}

	function tipoIcono(tipo: string, cerrado: boolean): { emoji: string; color: string } {
		if (cerrado) return { emoji: '🚧', color: '#DC2626' };
		const map: Record<string, { emoji: string; color: string }> = {
			accident: { emoji: '💥', color: '#c2410c' },
			road_closure: { emoji: '🚧', color: '#DC2626' },
			construction: { emoji: '🏗️', color: '#D97706' },
			hazard: { emoji: '⚠️', color: '#CA8A04' },
			weather: { emoji: '🌧️', color: '#2563EB' },
			congestion: { emoji: '🚗', color: '#7C3AED' },
			disabled_vehicle: { emoji: '🚘', color: '#6B7280' }
		};
		return map[tipo] ?? { emoji: '⚠️', color: '#CA8A04' };
	}

	function popupIncidente(inc: IncidenteVial): string {
		const { emoji, color } = tipoIcono(inc.tipo, inc.cerrrado);
		const impactoLabel: Record<string, string> = {
			critical: '🔴 Crítico',
			major: '🟠 Mayor',
			minor: '🟡 Menor',
			low: '🟢 Bajo'
		};
		const vias =
			inc.viasAfectadas.length > 0
				? `<p style="color:#555;font-size:11px;margin:0 0 6px;">📍 ${inc.viasAfectadas.join(', ')}</p>`
				: '';
		const desc = inc.longDescripcion || inc.descripcion;
		return `<div style="padding:12px 14px;min-width:210px;font-family: var(--font-sans);">
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
				<div style="width:28px;height:28px;background:${color};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;">${emoji}</div>
				<strong style="color:#111;font-size:12px;">${inc.cerrrado ? 'VÍA CERRADA — ' : ''}${tipoLabel(inc.tipo)}</strong>
			</div>
			${vias}
			<p style="color:#333;font-size:11px;margin:0 0 8px;line-height:1.5;">${desc}</p>
			<span style="display:inline-block;background:#f3f4f6;color:#374151;font-size:10px;padding:2px 8px;border-radius:999px;">${impactoLabel[inc.impacto] ?? inc.impacto}</span>
		</div>`;
	}

	function pintarIncidentes() {
		incidenteMarkersArr.forEach((m) => m.remove());
		incidenteMarkersArr = [];
		if (!map || !showIncidentes) return;
		for (const inc of incidentes) {
			const { emoji, color } = tipoIcono(inc.tipo, inc.cerrrado);
			const el = document.createElement('div');
			el.style.cssText = 'width:32px;height:32px;cursor:pointer;';
			// Marcador pulsante para cierres críticos
			const pulsar = inc.cerrrado || inc.impacto === 'critical';
			el.innerHTML = `
				<div style="position:relative;width:32px;height:32px;">
					${pulsar ? `<span style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.35;animation:ping 1.2s cubic-bezier(0,0,0.2,1) infinite;"></span>` : ''}
					<div style="position:relative;width:32px;height:32px;background:${color};border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:15px;">${emoji}</div>
				</div>`;
			const popup = new mapboxgl.Popup({
				offset: [0, -18],
				maxWidth: '260px',
				closeButton: true,
				anchor: 'bottom'
			}).setHTML(popupIncidente(inc));
			const mk = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
				.setLngLat([inc.lon, inc.lat])
				.setPopup(popup)
				.addTo(map!);
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				mk.togglePopup();
			});
			incidenteMarkersArr.push(mk);
		}
	}

	// ─── INCIDENTES NACIONALES (viewport — estilo Waze) ──────────

	const ICON_NACIONAL: Record<string, { color: string; emoji: string }> = {
		accident: { color: '#ef4444', emoji: '💥' },
		road_closure: { color: '#dc2626', emoji: '🚧' },
		construction: { color: '#d97706', emoji: '🏗️' },
		hazard: { color: '#ca8a04', emoji: '⚠️' },
		weather: { color: '#2563eb', emoji: '🌧️' },
		disabled_vehicle: { color: '#6b7280', emoji: '🚘' },
		other: { color: '#7c3aed', emoji: '📍' }
	};

	// Consulta Overpass para incidentes/cierres en el viewport actual
	let lastOverpassFetch = 0;
	const OVERPASS_COOLDOWN_MS = 8000; // mínimo 8s entre requests a Overpass

	async function cargarIncidentesNacionales() {
		if (!map || fetchingNacionales) return;
		// Cooldown global para no saturar Overpass
		const now = Date.now();
		if (now - lastOverpassFetch < OVERPASS_COOLDOWN_MS) return;
		// Solo consultar a zoom útil (>= 11) — bbox muy grande es rechazado
		if (map.getZoom() < 11) return;
		fetchingNacionales = true;
		lastOverpassFetch = now;
		try {
			const bounds = map.getBounds();
			if (!bounds) return;
			const s = bounds.getSouth().toFixed(4);
			const w = bounds.getWest().toFixed(4);
			const n = bounds.getNorth().toFixed(4);
			const e = bounds.getEast().toFixed(4);

			// Solo nodos — más liviano, menos propenso a 400/429
			const query = `[out:json][timeout:10][maxsize:1048576];
(
  node["highway"="construction"](${s},${w},${n},${e});
  node["construction"](${s},${w},${n},${e});
  node["hazard"](${s},${w},${n},${e});
  node["barrier"="block"](${s},${w},${n},${e});
  node["barrier"="jersey_barrier"](${s},${w},${n},${e});
);out body;`;
			const res = await fetch(OVERPASS_API, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `data=${encodeURIComponent(query)}`,
				signal: AbortSignal.timeout(12000)
			});
			if (!res.ok) return;
			const data = (await res.json()) as { elements?: any[] };

			const puntos = (data.elements || [])
				.map((el: any) => {
					const lat = el.lat ?? el.center?.lat;
					const lon = el.lon ?? el.center?.lon;
					if (!lat || !lon) return null;
					let tipo = 'other';
					if (el.tags?.highway === 'construction' || el.tags?.construction) tipo = 'construction';
					else if (el.tags?.hazard) tipo = 'hazard';
					else if (el.tags?.accident) tipo = 'accident';
					else if (el.tags?.barrier) tipo = 'road_closure';
					const nombre =
						el.tags?.name ||
						el.tags?.description ||
						el.tags?.hazard ||
						el.tags?.construction ||
						tipoLabel(tipo);
					return { tipo, nombre, lat, lon, tags: el.tags || {} };
				})
				.filter(Boolean);

			incidentesNacionales = puntos;
			actualzarCapaIncidentesNacionales();
		} catch (e) {
			console.warn('[Incidentes nacionales]', e);
		} finally {
			fetchingNacionales = false;
		}
	}

	function actualzarCapaIncidentesNacionales() {
		if (!map) return;
		const sourceId = 'nacional-incidents-src';
		const layerIds = ['nacional-incidents-circles', 'nacional-incidents-labels'];

		// Limpiar capas anteriores
		layerIds.forEach((id) => {
			if (map!.getLayer(id)) map!.removeLayer(id);
		});
		if (map.getSource(sourceId)) map.removeSource(sourceId);

		if (!showIncidentes || incidentesNacionales.length === 0) return;

		const geojson: GeoJSON.FeatureCollection = {
			type: 'FeatureCollection',
			features: incidentesNacionales.map((inc: any) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [inc.lon, inc.lat] },
				properties: {
					tipo: inc.tipo,
					nombre: inc.nombre,
					color: ICON_NACIONAL[inc.tipo]?.color ?? '#7c3aed',
					emoji: ICON_NACIONAL[inc.tipo]?.emoji ?? '📍'
				}
			}))
		};

		map.addSource(sourceId, { type: 'geojson', data: geojson });

		// Círculo exterior (halo) — efecto Waze
		map.addLayer({
			id: 'nacional-incidents-circles',
			type: 'circle',
			source: sourceId,
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 7, 14, 14],
				'circle-color': ['get', 'color'],
				'circle-opacity': 0.85,
				'circle-stroke-width': 2,
				'circle-stroke-color': '#ffffff',
				'circle-stroke-opacity': 0.9
			}
		});

		// Emoji label encima del círculo
		map.addLayer({
			id: 'nacional-incidents-labels',
			type: 'symbol',
			source: sourceId,
			layout: {
				'text-field': ['get', 'emoji'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 16],
				'text-allow-overlap': true,
				'text-ignore-placement': true
			},
			paint: { 'text-color': '#ffffff' }
		});

		// Click en el círculo → popup
		map.on('click', 'nacional-incidents-circles', (e) => {
			const feat = e.features?.[0];
			if (!feat) return;
			const { tipo, nombre, color, emoji } = feat.properties as any;
			const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];
			const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords[1]},${coords[0]}`;
			new mapboxgl.Popup({ offset: [0, -14], maxWidth: '240px', anchor: 'bottom' })
				.setLngLat(coords)
				.setHTML(
					`<div style="padding:12px 14px;min-width:200px;font-family: var(--font-sans);">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
						<div style="width:28px;height:28px;background:${color};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;">${emoji}</div>
						<strong style="color:#111;font-size:12px;">${tipoLabel(tipo)}</strong>
					</div>
					<p style="color:#555;font-size:11px;margin:0 0 10px;">${nombre}</p>
					<a href="${mapsUrl}" target="_blank" rel="noopener"
						style="display:flex;align-items:center;justify-content:center;gap:5px;background:${color};color:#fff;font-size:11px;font-weight:600;padding:5px 8px;border-radius:6px;text-decoration:none;">
						📍 Ver en Google Maps
					</a>
				</div>`
				)
				.addTo(map!);
		});
		map.on('mouseenter', 'nacional-incidents-circles', () => {
			map!.getCanvas().style.cursor = 'pointer';
		});
		map.on('mouseleave', 'nacional-incidents-circles', () => {
			map!.getCanvas().style.cursor = '';
		});
	}

	// ─── CONDICIONES VIALES (análisis basado en la ruta) ───────────

	async function cargarCondicionesViales(routeCoords: number[][]) {
		loadingCondiciones = true;
		condicionesViales = [];

		try {
			// Calcular bbox de la ruta para consultas
			const lats = routeCoords.map((c) => c[1]);
			const lngs = routeCoords.map((c) => c[0]);
			const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
			const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

			// ─ 1. Llamada sin tráfico (duración base)
			// ─ 2. Llamada con tráfico + incidents para calcular demora y obtener cierres/accidentes
			const oLng0 = routeCoords[0][0],
				oLat0 = routeCoords[0][1];
			const dLng0 = routeCoords[routeCoords.length - 1][0],
				dLat0 = routeCoords[routeCoords.length - 1][1];

			const [resNormal, resTrafico] = await Promise.all([
				fetch(
					`https://api.mapbox.com/directions/v5/mapbox/driving/${oLng0},${oLat0};${dLng0},${dLat0}?overview=false&access_token=${MAPBOX_TOKEN}`
				),
				fetch(
					`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${oLng0},${oLat0};${dLng0},${dLat0}?overview=full&geometries=geojson&steps=true&annotations=congestion&access_token=${MAPBOX_TOKEN}`
				)
			]);

			const nuevasCondiciones: CondicionVial[] = [];

			if (resNormal.ok && resTrafico.ok) {
				const [dataNormal, dataTrafico] = await Promise.all([resNormal.json(), resTrafico.json()]);
				const durNormal = dataNormal.routes?.[0]?.duration ?? 0;
				const durTrafico = dataTrafico.routes?.[0]?.duration ?? 0;

				// ─── PARSEAR INCIDENTS ──────────────────────────────────
				const legs = dataTrafico.routes?.[0]?.legs ?? [];
				const routeGeom = dataTrafico.routes?.[0]?.geometry?.coordinates ?? [];
				const rawIncidents: any[] = legs.flatMap((leg: any) => leg.incidents ?? []);

				const nuevosIncidentes: IncidenteVial[] = rawIncidents
					.filter((inc: any) => inc.geometry_index_start != null && routeGeom.length > 0)
					.map((inc: any) => {
						// Coordenada del punto medio del incidente en la polilínea
						const midIdx = Math.floor(
							(inc.geometry_index_start + (inc.geometry_index_end ?? inc.geometry_index_start)) / 2
						);
						const coord = routeGeom[Math.min(midIdx, routeGeom.length - 1)] ?? routeGeom[0];
						return {
							id: inc.id ?? crypto.randomUUID(),
							tipo: inc.type ?? 'hazard',
							descripcion: inc.description ?? tipoLabel(inc.type),
							longDescripcion: inc.long_description ?? inc.description ?? '',
							impacto: inc.impact ?? 'minor',
							cerrrado: inc.road_is_closed ?? false,
							viasAfectadas: inc.affected_road_names ?? [],
							lon: coord[0],
							lat: coord[1]
						};
					});

				incidentes = nuevosIncidentes;
				pintarIncidentes();

				// Agregar tarjeta de incidentes en panel de condiciones
				const cierres = nuevosIncidentes.filter((i) => i.cerrrado);
				const criticos = nuevosIncidentes.filter(
					(i) => i.impacto === 'critical' || i.impacto === 'major'
				);
				if (cierres.length > 0) {
					nuevasCondiciones.push({
						tipo: 'trafico',
						nivel: 'critico',
						titulo: `🚧 ${cierres.length} cierre(s) de vía detectado(s)`,
						descripcion: `Vías cerradas: ${cierres.map((i) => i.viasAfectadas[0] || i.descripcion).join(' · ')}. Consulte los marcadores 🚧 en el mapa para rutas alternas.`
					});
				} else if (criticos.length > 0) {
					nuevasCondiciones.push({
						tipo: 'trafico',
						nivel: 'alto',
						titulo: `⚠️ ${criticos.length} incidente(s) en la ruta`,
						descripcion: criticos.map((i) => i.descripcion).join(' · ')
					});
				} else if (nuevosIncidentes.length > 0) {
					nuevasCondiciones.push({
						tipo: 'trafico',
						nivel: 'moderado',
						titulo: `ℹ️ ${nuevosIncidentes.length} novedad(es) en la vía`,
						descripcion: nuevosIncidentes.map((i) => i.descripcion).join(' · ')
					});
				} else {
					nuevasCondiciones.push({
						tipo: 'trafico',
						nivel: 'ok',
						titulo: 'Sin incidentes reportados',
						descripcion:
							'No se detectaron cierres, accidentes ni construcciones activas en el trayecto.'
					});
				}

				if (durNormal > 0) {
					const demora = durTrafico - durNormal;
					const porcentaje = (demora / durNormal) * 100;
					const demMin = Math.round(demora / 60);

					if (porcentaje < 10) {
						nuevasCondiciones.push({
							tipo: 'trafico',
							nivel: 'ok',
							titulo: 'Tráfico fluido',
							descripcion:
								'La vía presenta condiciones normales de circulación. No se reportan congestiones en el trayecto.'
						});
					} else if (porcentaje < 30) {
						nuevasCondiciones.push({
							tipo: 'trafico',
							nivel: 'moderado',
							titulo: 'Tráfico moderado',
							descripcion: `Se estima una demora aproximada de ${demMin} min adicionales por condiciones de tráfico en algunos tramos del recorrido.`
						});
					} else if (porcentaje < 60) {
						nuevasCondiciones.push({
							tipo: 'trafico',
							nivel: 'alto',
							titulo: 'Tráfico congestionado',
							descripcion: `Congestión significativa detectada. Demora estimada de ${demMin} min adicionales. Se recomienda considerar ruta alterna o ajustar horario de salida.`
						});
					} else {
						nuevasCondiciones.push({
							tipo: 'trafico',
							nivel: 'critico',
							titulo: 'Tráfico crítico',
							descripcion: `Congestión severa en la vía. Demora estimada de ${demMin} min adicionales. Se recomienda esperar o usar ruta alterna.`
						});
					}
				}
			}

			// Condición de riesgo: revisar si la ruta pasa por zonas de alta amenaza
			// (basado en el departamento/región de la ruta — conocimiento geográfico Colombia)
			const zonasAltoRiesgo = [
				{ lat: 4.5, lon: -75.7, nombre: 'Eje Cafetero', radio: 0.8 }, // Caldas/Risaralda
				{ lat: 1.2, lon: -77.2, nombre: 'Nariño', radio: 1.5 },
				{ lat: 5.8, lon: -75.9, nombre: 'Antioquia Occidental', radio: 1.0 },
				{ lat: 3.4, lon: -76.5, nombre: 'Valle del Cauca', radio: 0.8 }
			];

			const R = 111.32;
			const zonaCercana = zonasAltoRiesgo.find((z) => {
				const dist = Math.sqrt(
					((centerLat - z.lat) * R) ** 2 +
						((centerLng - z.lon) * R * Math.cos((centerLat * Math.PI) / 180)) ** 2
				);
				return dist <= z.radio * R;
			});

			if (zonaCercana) {
				nuevasCondiciones.push({
					tipo: 'riesgo',
					nivel: 'alto',
					titulo: `Zona de riesgo: ${zonaCercana.nombre}`,
					descripcion:
						'La ruta atraviesa una región con historial de movimientos en masa y deslizamientos. Consulte el mapa de riesgo SGC activado en el panel de capas y verifique alertas del IDEAM antes de iniciar el recorrido.'
				});
			} else {
				// Revisar si es zona de llanura (Casanare, Meta, Vichada) — riesgo bajo deslizamientos
				const esLlanura = centerLat > 3 && centerLat < 7 && centerLng > -73.5 && centerLng < -68;
				if (esLlanura) {
					nuevasCondiciones.push({
						tipo: 'riesgo',
						nivel: 'ok',
						titulo: 'Zona de baja amenaza sísmica',
						descripcion:
							'El recorrido transcurre principalmente por la Orinoquia. Riesgo bajo de deslizamientos. Se recomienda precaución en cruces de caños y ríos en época de lluvias.'
					});
				} else {
					nuevasCondiciones.push({
						tipo: 'riesgo',
						nivel: 'moderado',
						titulo: 'Revisar condiciones del terreno',
						descripcion:
							'Active la capa de riesgo SGC para visualizar zonas de amenaza por movimientos en masa a lo largo del recorrido.'
					});
				}
			}

			// Información general de la ruta
			nuevasCondiciones.push({
				tipo: 'info',
				nivel: 'ok',
				titulo: 'Fuentes de información',
				descripcion:
					'Tráfico: Mapbox Traffic API (tiempo real). Riesgo geológico: Servicio Geológico Colombiano (SGC) — Amenaza por Movimientos en Masa v2.'
			});

			condicionesViales = nuevasCondiciones;
		} catch (e) {
			console.warn('[Condiciones viales]', e);
		} finally {
			loadingCondiciones = false;
		}
	}

	// ─── CAPAS MAPA: TRÁFICO Y RIESGO SGC ───────────────────────

	function addTraficoLayer() {
		if (!map) return;
		if (map.getLayer('traffic-layer')) map.removeLayer('traffic-layer');
		if (map.getSource('mapbox-traffic')) map.removeSource('mapbox-traffic');
		map.addSource('mapbox-traffic', {
			type: 'vector',
			url: 'mapbox://mapbox.mapbox-traffic-v1'
		});
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
					'#ea580c',
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
	function addRiesgoLayer() {
		if (!map) return;
		if (map.getLayer('sgc-riesgos-layer')) map.removeLayer('sgc-riesgos-layer');
		if (map.getSource('sgc-riesgos')) map.removeSource('sgc-riesgos');

		// El SGC usa ArcGIS Dynamic Map Service (no tiled).
		// Se consume vía endpoint export con {bbox-epsg-3857} que Mapbox resuelve automáticamente.
		// Fuente: geoportal.sgc.gov.co — Amenaza por Movimientos en Masa nacional 1:500.000
		// Servicio confirmado vía geoportal.sgc.gov.co — Zonificación Amenaza Mov. en Masa CARDIQUE
		// Como fallback usamos el servicio de Zonificacion_Amenazas_Mov_Masa que sí existe
		const SGC_BASE = 'https://geoportal.sgc.gov.co/arcgis/rest/services';
		const SGC_SERVICE =
			'Zonificacion_Amenazas_Mov_Masa/Zonificacion_Amenaza_por_Movimientos_Masa_Cardique/MapServer';
		const tileUrl =
			`${SGC_BASE}/${SGC_SERVICE}/export` +
			'?bbox={bbox-epsg-3857}' +
			'&bboxSR=3857&imageSR=3857' +
			'&size=256,256' +
			'&format=png32' +
			'&transparent=true' +
			'&f=image';

		map.addSource('sgc-riesgos', {
			type: 'raster',
			tiles: [tileUrl],
			tileSize: 256,
			attribution: '© Servicio Geológico Colombiano (SGC)'
		});
		map.addLayer(
			{
				id: 'sgc-riesgos-layer',
				type: 'raster',
				source: 'sgc-riesgos',
				paint: { 'raster-opacity': 0.55 }
			},
			map.getLayer('route') ? 'route' : undefined
		);

		// Manejar error silencioso si el servicio SGC no responde
		map.on('error', (e: any) => {
			if (e?.source === 'sgc-riesgos') {
				console.warn('[SGC] Capa de riesgo no disponible temporalmente:', e.error?.message);
				if (map?.getLayer('sgc-riesgos-layer')) map.removeLayer('sgc-riesgos-layer');
				if (map?.getSource('sgc-riesgos')) map.removeSource('sgc-riesgos');
				showRiesgos = false;
			}
		});
	}

	function removeRiesgoLayer() {
		if (!map) return;
		if (map.getLayer('sgc-riesgos-layer')) map.removeLayer('sgc-riesgos-layer');
		if (map.getSource('sgc-riesgos')) map.removeSource('sgc-riesgos');
	}

	function toggleRiesgosSGC() {
		if (!map) return;
		showRiesgos = !showRiesgos;
		if (showRiesgos) addRiesgoLayer();
		else removeRiesgoLayer();
	}

	// ─── POPUPS ───────────────────────────────────────────────────

	function popupPeaje(p: PeajeInfo): string {
		const url = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
		return `<div style="padding:12px 14px;min-width:190px;font-family: var(--font-sans);">
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
				<div style="width:26px;height:26px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
					<span style="color:#fff;font-weight:700;font-size:11px;">P</span>
				</div>
				<strong style="color:#92400e;font-size:12px;">${p.nombre}</strong>
			</div>
			<span style="display:inline-block;background:#fef3c7;color:#78350f;font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid #fcd34d;margin-bottom:10px;">🛣️ Peaje</span>
			<a href="${url}" target="_blank" rel="noopener"
				style="display:flex;align-items:center;justify-content:center;gap:5px;background:#f59e0b;color:#fff;font-size:11px;font-weight:600;padding:5px 8px;border-radius:6px;text-decoration:none;">
				📍 Ver en Google Maps
			</a>
		</div>`;
	}

	function popupParada(p: ParadaSegura): string {
		const url = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
		const cfg = {
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
				label: 'Est. Servicio'
			},
			hospedaje: {
				bg: '#009688',
				light: '#e0f2f1',
				border: '#80cbc4',
				dark: '#004d40',
				emoji: '🏨',
				label: 'Hospedaje'
			}
		}[p.tipo];
		return `<div style="padding:12px 14px;min-width:190px;font-family: var(--font-sans);">
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
				<div style="width:26px;height:26px;background:${cfg.bg};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
					<span style="font-size:13px;">${cfg.emoji}</span>
				</div>
				<strong style="color:${cfg.dark};font-size:12px;">${p.nombre}</strong>
			</div>
			<span style="display:inline-block;background:${cfg.light};color:${cfg.dark};font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid ${cfg.border};margin-bottom:10px;">${cfg.emoji} ${cfg.label}</span>
			<a href="${url}" target="_blank" rel="noopener"
				style="display:flex;align-items:center;justify-content:center;gap:5px;background:${cfg.bg};color:#fff;font-size:11px;font-weight:600;padding:5px 8px;border-radius:6px;text-decoration:none;">
				📍 Ver en Google Maps
			</a>
		</div>`;
	}

	function popupDistracom(e: DistracomEstacion): string {
		const url = `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lon}`;
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
		return `<div style="padding:12px 14px;min-width:210px;font-family: var(--font-sans);">
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
				<img src="${DISTRACOM_ICON_URL}" style="width:20px;height:20px;object-fit:contain;" alt=""/>
				<strong style="color:#1b5e20;font-size:12px;">${e.nombre}</strong>
			</div>
			${e.direccion ? `<p style="color:#555;font-size:11px;margin:0 0 2px;">${e.direccion}</p>` : ''}
			<p style="color:#999;font-size:11px;margin:0 0 8px;">${e.ciudad}, ${e.departamento}</p>
			${badges ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px;">${badges}</div>` : ''}
			<a href="${url}" target="_blank" rel="noopener noreferrer"
				style="display:flex;align-items:center;justify-content:center;gap:5px;background:#1b5e20;color:#fff;font-size:11px;font-weight:600;padding:5px 8px;border-radius:6px;text-decoration:none;">
				📍 Ver en Google Maps
			</a>
		</div>`;
	}

	// ─── MARKERS ──────────────────────────────────────────────────

	function circuloEl(color: string, letra: string): HTMLElement {
		const el = document.createElement('div');
		el.style.cssText = 'width:28px;height:28px;';
		el.innerHTML = `<div style="width:28px;height:28px;background:${color};border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;cursor:pointer;">
			<span style="color:#fff;font-weight:700;font-size:11px;">${letra}</span>
		</div>`;
		return el;
	}

	function pintarPeajes() {
		peajeMarkersArr.forEach((m) => m.remove());
		peajeMarkersArr = [];
		if (!map || !showPeajes) return;
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
		if (!map) return;
		const cfg = {
			restaurante: { color: '#2196f3', letra: 'R', show: () => showRestaurantes },
			estacion_servicio: { color: '#9c27b0', letra: 'S', show: () => showEstaciones },
			hospedaje: { color: '#009688', letra: 'H', show: () => showHospedajes }
		};
		for (const p of paradasSeguras) {
			const c = cfg[p.tipo];
			if (!c.show()) continue;
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

	function pintarDistracom(routeCoords: number[][] = []) {
		distracomMarkers.forEach((m) => m.remove());
		distracomMarkers = [];
		if (!map || !showDistracom) return;
		for (const est of getEstaciones(routeCoords)) {
			const el = document.createElement('div');
			el.style.cssText = 'width:26px;height:26px;';
			el.innerHTML = `<img src="${DISTRACOM_ICON_URL}" alt="${est.nombre}" style="width:26px;height:26px;object-fit:contain;cursor:pointer;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.28));" draggable="false"/>`;
			const popup = new mapboxgl.Popup({
				offset: [0, -26],
				maxWidth: '255px',
				closeButton: true,
				closeOnClick: false,
				anchor: 'bottom'
			}).setHTML(popupDistracom(est));
			const mk = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
				.setLngLat([est.lon, est.lat])
				.setPopup(popup)
				.addTo(map!);
			el.addEventListener('click', (ev) => {
				ev.stopPropagation();
				const was = popup.isOpen();
				distracomMarkers.forEach((m) => {
					if (m.getPopup()?.isOpen()) m.togglePopup();
				});
				if (!was) mk.togglePopup();
			});
			distracomMarkers.push(mk);
		}
	}

	// Reactivos a toggles
	$: if (map) {
		pintarIncidentes();
		actualzarCapaIncidentesNacionales();
	}
	$: if (map) pintarPeajes();
	$: if (map) pintarParadas();
	$: if (map) {
		distracomMarkers.forEach((m) => {
			m.getElement().style.display = showDistracom ? '' : 'none';
		});
	}

	// ─── MAPA ─────────────────────────────────────────────────────

	function pinEl(color: string, label: string): HTMLDivElement {
		const el = document.createElement('div');
		el.style.cssText = `background:${color};width:32px;height:32px;border-radius:50%;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;`;
		el.innerText = label;
		return el;
	}

	function clearMap() {
		markers.forEach((m) => m.remove());
		markers = [];
		if (map?.getLayer('route')) map.removeLayer('route');
		if (map?.getSource('route')) map.removeSource('route');
		removeTraficoLayer();
		removeRiesgoLayer();
		incidenteMarkersArr.forEach((m) => m.remove());
		incidenteMarkersArr = [];
		incidentes = [];
		incidentesNacionales = [];
		['nacional-incidents-circles', 'nacional-incidents-labels'].forEach((id) => {
			if (map?.getLayer(id)) map.removeLayer(id);
		});
		if (map?.getSource('nacional-incidents-src')) map.removeSource('nacional-incidents-src');
		// toggles no se resetean — buildRoute los restaura
	}

	function initMap() {
		if (!MAPBOX_TOKEN || !servicio || map || !document.getElementById('map')) return;
		const oLat = servicio.origen_latitud || servicio.origen?.latitud;
		const oLng = servicio.origen_longitud || servicio.origen?.longitud;
		if (!oLat || !oLng) return;
		try {
			mapboxgl.accessToken = MAPBOX_TOKEN;
			map = new mapboxgl.Map({
				container: 'map',
				style: 'mapbox://styles/mapbox/outdoors-v12',
				center: [oLng, oLat],
				zoom: 11
			});
			map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
			map.on('load', () => {
				isMapLoaded = true;
			});
			// Actualizar incidentes al mover/hacer zoom
			// Debounce 3s + solo a zoom >= 11 para no saturar Overpass
			map.on('moveend', () => {
				clearTimeout(moveendTimer);
				const z = map!.getZoom();
				if (z >= 11) {
					moveendTimer = setTimeout(() => cargarIncidentesNacionales(), 3000);
				}
			});
		} catch (e) {
			console.error(e);
		}
	}

	async function buildRoute() {
		if (!map || !servicio) return;
		clearMap();
		const oLat = servicio.origen_latitud || servicio.origen?.latitud;
		const oLng = servicio.origen_longitud || servicio.origen?.longitud;
		const dLat = servicio.destino_latitud || servicio.destino?.latitud;
		const dLng = servicio.destino_longitud || servicio.destino?.longitud;
		if (!oLat || !oLng || !dLat || !dLng) {
			pintarDistracom([]);
			return;
		}
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
					paint: { 'line-color': '#15803d', 'line-width': 5, 'line-opacity': 0.8 }
				});
			}

			// Activar tráfico y riesgos directamente (siempre ON al cargar ruta)
			showTrafico = true;
			showRiesgos = true;
			addTraficoLayer();
			addRiesgoLayer();

			// Analizar condiciones viales de la ruta
			cargarCondicionesViales(routeCoords);
			// Cargar incidentes del viewport actual
			cargarIncidentesNacionales();

			// Markers A / B
			const om = new mapboxgl.Marker(pinEl('#15803d', 'A'))
				.setLngLat([oLng, oLat])
				.setPopup(
					new mapboxgl.Popup({ offset: 25 }).setHTML(
						`<div style="padding:10px;font-family: var(--font-sans)"><strong style="color:#15803d">Origen</strong><br/><span style="font-size:12px;">${servicio.origen_especifico || servicio.origen?.nombre_municipio || '—'}</span></div>`
					)
				);
			om.addTo(map!);
			markers.push(om);

			const dm = new mapboxgl.Marker(pinEl('#DC2626', 'B'))
				.setLngLat([dLng, dLat])
				.setPopup(
					new mapboxgl.Popup({ offset: 25 }).setHTML(
						`<div style="padding:10px;font-family: var(--font-sans)"><strong style="color:#DC2626">Destino</strong><br/><span style="font-size:12px;">${servicio.destino_especifico || servicio.destino?.nombre_municipio || '—'}</span></div>`
					)
				);
			dm.addTo(map!);
			markers.push(dm);

			const bounds = new mapboxgl.LngLatBounds();
			bounds.extend([oLng, oLat]);
			bounds.extend([dLng, dLat]);
			map.fitBounds(bounds, { padding: 80, maxZoom: 14 });

			// POIs en paralelo — activar loading antes de los requests
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
				pintarDistracom(routeCoords);
			} finally {
				loadingPOIs = false;
			}
		} catch (e) {
			console.error(e);
			loadingPOIs = false;
		}
	}

	function centerRoute() {
		if (!map || !servicio) return;
		const oLat = servicio.origen_latitud || servicio.origen?.latitud,
			oLng = servicio.origen_longitud || servicio.origen?.longitud;
		const dLat = servicio.destino_latitud || servicio.destino?.latitud,
			dLng = servicio.destino_longitud || servicio.destino?.longitud;
		if (!oLat || !oLng || !dLat || !dLng) return;
		const b = new mapboxgl.LngLatBounds();
		b.extend([oLng, oLat]);
		b.extend([dLng, dLat]);
		map.fitBounds(b, { padding: 80, maxZoom: 14, duration: 900 });
	}

	onMount(async () => {
		const id = $page.params.id;
		if (id) await servicioDetalleStore.obtenerServicio(id);
	});
	$: if (servicio && !map && !loading)
		setTimeout(() => {
			if (document.getElementById('map')) initMap();
		}, 150);
	$: if (isMapLoaded && servicio) buildRoute();

	onDestroy(() => {
		[...distracomMarkers, ...peajeMarkersArr, ...paradaMarkersArr, ...incidenteMarkersArr].forEach(
			(m) => m.remove()
		);
		if (map) {
			clearMap();
			map.remove();
			map = null;
		}
		servicioDetalleStore.limpiar();
	});

	// ─── COMPARTIR ────────────────────────────────────────────────

	async function handleCompartir() {
		if (!servicio) return;
		try {
			let t = servicio.share_token;
			if (!t) t = (await serviciosStore.generarShareToken(servicio.id)) ?? undefined;
			if (!t) {
				alert('Error al generar enlace');
				return;
			}
			generatedShareUrl = `${window.location.origin}/public/servicio/${t}`;
			showShareModal = true;
		} catch {
			alert('Error al compartir');
		}
	}
	function cerrarCompartir() {
		showShareModal = false;
		copySuccess = false;
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(generatedShareUrl);
			copySuccess = true;
			setTimeout(() => {
				copySuccess = false;
			}, 2000);
		} catch {
			alert('Error al copiar');
		}
	}

	// Contadores reactivos
	$: countRestaurantes = paradasSeguras.filter((p) => p.tipo === 'restaurante').length;
	$: countEstaciones = paradasSeguras.filter((p) => p.tipo === 'estacion_servicio').length;
	$: countHospedajes = paradasSeguras.filter((p) => p.tipo === 'hospedaje').length;

	// 🔹 Variables derivadas del servicio (reactivas)
	$: rc = (servicio as any)?.recargos_planillas?.[0];

	$: estadoConductor = rc?.estado_conductor || 'optimo';

	$: viaMixto = rc?.via_mixto ?? true;
	$: viaTrocha = rc?.via_trocha ?? false;
	$: viaAfirmado = rc?.via_afirmado ?? false;
	$: viaPavimentada = rc?.via_pavimentada ?? false;

	$: riesgoPeatones = rc?.riesgo_peatones ?? true;
	$: riesgoDesniveles = rc?.riesgo_desniveles ?? false;
	$: riesgoDeslizamientos = rc?.riesgo_deslizamientos ?? false;
	$: riesgoSinSenalizacion = rc?.riesgo_sin_senalizacion ?? false;
	$: riesgoAnimales = rc?.riesgo_animales ?? false;
	$: riesgoTrafico = rc?.riesgo_trafico_alto ?? false;

	$: calificacion = rc?.calificacion_servicio || 'bueno';

	$: esRealizado = ['realizado', 'completado', 'liquidado'].includes(servicio?.estado ?? '');

	$: esDefault = !rc;
</script>

<svelte:head>
	<title
		>{servicio ? `Servicio ${servicio.id.slice(0, 8).toUpperCase()}` : 'Cargando...'} - Transmeralda</title
	>
</svelte:head>

<div class="flex h-screen w-full flex-col overflow-hidden bg-gray-50" in:fade={{ duration: 400 }}>
	{#if loading}
		<div class="flex flex-1 items-center justify-center bg-white" in:fade>
			<div class="text-center">
				<div
					class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"
				></div>
				<p class="text-sm text-gray-500">Cargando servicio...</p>
			</div>
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center bg-white p-6" in:fade>
			<div class="max-w-xs text-center">
				<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100">
					<svg class="h-6 w-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				</div>
				<p class="mb-4 text-gray-600">{error}</p>
				<button onclick={() => goto('/dashboard/servicios')} class="btn-primary apple-transition">
					Volver
				</button>
			</div>
		</div>
	{:else if servicio}
		<!-- ── ENCABEZADO (como la app móvil) ── -->
		<header class="detalle-header">
			<button
				onclick={() => {
					isNavigating = true;
					goto('/dashboard/servicios');
				}}
				disabled={isNavigating}
				aria-label="Volver a servicios"
				class="detalle-volver"
			>
				<svg
					class="h-5 w-5"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2.4"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7" />
				</svg>
			</button>
			<div class="min-w-0 flex-1">
				<h1 class="detalle-header-titulo">Detalle del servicio</h1>
				<p class="detalle-header-id">{servicio.id.slice(0, 8).toUpperCase()}</p>
			</div>
			<button onclick={handleCompartir} class="btn-primary">
				<svg
					class="h-3.5 w-3.5"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
					/>
				</svg>
				<span class="hidden sm:inline">Compartir</span>
			</button>
		</header>

		<!-- ── ÁREA DESPLAZABLE (estilo de la app móvil) ── -->
		<div class="detalle-fondo flex-1 overflow-y-auto">
			<div class="detalle w-full px-4 py-4 md:px-6">
				<div class="detalle-estado">
					<span
						class="detalle-chip"
						style="background-color: {ESTADO_APP[servicio.estado]?.fondo ??
							'#F3F4F6'}; color: {ESTADO_APP[servicio.estado]?.texto ?? '#374151'}"
					>
						{STATUS_LABEL[servicio.estado] ?? servicio.estado}
					</span>
					{#if servicio.proposito_servicio}
						<span class="detalle-proposito"
							>{labelPropositoServicio(servicio.proposito_servicio)}</span
						>
					{/if}
				</div>

				{#if servicio.observaciones}
					<div class="detalle-card detalle-indicaciones">
						<p class="detalle-indicaciones-titulo">Indicaciones de operaciones</p>
						<p class="detalle-indicaciones-texto">{servicio.observaciones}</p>
					</div>
				{/if}

				<div class="detalle-columnas">
					<div class="detalle-columna">
						<!-- ═══ MAPA (hero) ═══ -->
						<div class="servicio-map-frame detalle-mapa relative overflow-hidden">
							<div id="map" class="h-full w-full"></div>

							<!-- Botón centrar -->
							<button
								onclick={centerRoute}
								class="servicio-map-center-btn apple-transition absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-xl border border-gray-200/50 bg-white/90 px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm backdrop-blur-md hover:bg-white"
							>
								<svg
									class="h-4 w-4 text-emerald-600"
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
								Centrar
							</button>

							<!-- Trip summary overlay (esquina inferior izquierda, encima de la leyenda) -->
							{#if distancia !== '—'}
								<div class="servicio-map-stats" in:fade={{ duration: 300 }}>
									<div class="stat-block">
										<span class="stat-block-label">Distancia</span>
										<span class="stat-block-value">{distancia}</span>
									</div>
									<div class="stat-divider"></div>
									<div class="stat-block">
										<span class="stat-block-label">Tiempo est.</span>
										<span class="stat-block-value">{duracion}</span>
									</div>
								</div>
							{/if}

							<!-- ─── LEYENDA INTERACTIVA (subida para no chocar con stats) ─── -->
							<div
								class="servicio-map-leyenda glass soft-shadow absolute right-3 bottom-3 z-10 overflow-hidden rounded-xl border border-gray-200/50"
								style="min-width:220px;backdrop-filter:blur(12px);"
							>
								<div class="border-b border-gray-100 px-3 py-2">
									<p class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
										Puntos de interés
									</p>
								</div>

								<div class="space-y-px p-1.5">
									<!-- Origen / Destino -->
									<div class="flex items-center gap-2 rounded-lg px-2 py-1">
										<div
											class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500"
										>
											<span style="color:#fff;font-weight:700;font-size:9px;">A</span>
										</div>
										<span class="text-xs font-medium text-gray-700">Origen</span>
									</div>
									<div class="flex items-center gap-2 rounded-lg px-2 py-1">
										<div
											class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-500"
										>
											<span style="color:#fff;font-weight:700;font-size:9px;">B</span>
										</div>
										<span class="text-xs font-medium text-gray-700">Destino</span>
									</div>

									<div class="my-1 border-t border-gray-100"></div>

									<!-- Peajes -->
									<button
										class="apple-transition flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-emerald-50/50"
										class:opacity-40={!showPeajes}
										onclick={() => (showPeajes = !showPeajes)}
									>
										<div
											class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-400"
										>
											<span style="color:#fff;font-weight:700;font-size:9px;">P</span>
										</div>
										<span class="flex-1 text-left text-xs font-medium text-gray-700">Peajes</span>
										{#if peajes.length > 0}
											<span
												class="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
												>{peajes.length}</span
											>
										{/if}
									</button>

									<!-- Restaurantes -->
									<button
										class="apple-transition flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-emerald-50/50"
										class:opacity-40={!showRestaurantes}
										onclick={() => {
											showRestaurantes = !showRestaurantes;
											pintarParadas();
										}}
									>
										<div
											class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-500"
										>
											<span style="color:#fff;font-weight:700;font-size:9px;">R</span>
										</div>
										<span class="flex-1 text-left text-xs font-medium text-gray-700"
											>Restaurantes</span
										>
										{#if countRestaurantes > 0}
											<span
												class="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
												>{countRestaurantes}</span
											>
										{/if}
									</button>

									<!-- Estaciones de servicio -->
									<button
										class="apple-transition flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-emerald-50/50"
										class:opacity-40={!showEstaciones}
										onclick={() => {
											showEstaciones = !showEstaciones;
											pintarParadas();
										}}
									>
										<div
											class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-purple-500"
										>
											<span style="color:#fff;font-weight:700;font-size:9px;">S</span>
										</div>
										<span class="flex-1 text-left text-xs font-medium text-gray-700"
											>Est. Servicio</span
										>
										{#if countEstaciones > 0}
											<span
												class="rounded-md bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700"
												>{countEstaciones}</span
											>
										{/if}
									</button>

									<!-- Hospedajes -->
									<button
										class="apple-transition flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-emerald-50/50"
										class:opacity-40={!showHospedajes}
										onclick={() => {
											showHospedajes = !showHospedajes;
											pintarParadas();
										}}
									>
										<div
											class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-teal-500"
										>
											<span style="color:#fff;font-weight:700;font-size:9px;">H</span>
										</div>
										<span class="flex-1 text-left text-xs font-medium text-gray-700"
											>Hospedajes</span
										>
										{#if countHospedajes > 0}
											<span
												class="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700"
												>{countHospedajes}</span
											>
										{/if}
									</button>

									<!-- Incidentes / Cierres -->
									<button
										class="apple-transition flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-emerald-50/50"
										class:opacity-40={!showIncidentes}
										onclick={() => {
											showIncidentes = !showIncidentes;
											pintarIncidentes();
										}}
									>
										<div
											class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px]"
										>
											🚧
										</div>
										<span class="flex-1 text-left text-xs font-medium text-gray-700"
											>Cierres / Accidentes</span
										>
										{#if loadingCondiciones}
											<span
												class="h-3 w-3 animate-spin rounded-full border border-red-400 border-t-transparent"
											></span>
										{:else if incidentes.length > 0 || incidentesNacionales.length > 0}
											{@const total = incidentes.length + incidentesNacionales.length}
											<span
												class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold {incidentes.some(
													(i) => i.cerrrado
												)
													? 'bg-red-50 text-red-700'
													: 'bg-orange-50 text-orange-700'}">{total}</span
											>
										{/if}
									</button>

									<!-- Distracom -->
									<button
										class="apple-transition flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-emerald-50/50"
										class:opacity-40={!showDistracom}
										onclick={() => (showDistracom = !showDistracom)}
									>
										<img
											src={DISTRACOM_ICON_URL}
											alt="Distracom"
											class="h-5 w-5 flex-shrink-0 object-contain"
										/>
										<span class="flex-1 text-left text-xs font-medium text-gray-700">Distracom</span
										>
										{#if distracomMarkers.length > 0}
											<span
												class="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
												>{distracomMarkers.length}</span
											>
										{/if}
									</button>

									<div class="my-1 border-t border-gray-100"></div>

									<!-- Tráfico en tiempo real -->
									<button
										class="apple-transition flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-emerald-50/50"
										class:opacity-40={!showTrafico}
										onclick={toggleTrafico}
									>
										<div
											class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-orange-400"
										>
											<span style="color:#fff;font-weight:700;font-size:9px;">T</span>
										</div>
										<span class="flex-1 text-left text-xs font-medium text-gray-700">Tráfico</span>
										{#if showTrafico}
											<span
												class="inline-flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700"
											>
												<span class="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
												ON
											</span>
										{/if}
									</button>

									<!-- Riesgo deslizamientos SGC -->
									<button
										class="apple-transition flex w-full items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-emerald-50/50"
										class:opacity-40={!showRiesgos}
										onclick={toggleRiesgosSGC}
									>
										<div
											class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-600"
										>
											<span style="color:#fff;font-weight:700;font-size:9px;">⚠</span>
										</div>
										<span class="flex-1 text-left text-xs font-medium text-gray-700"
											>Riesgo desliz.</span
										>
										{#if showRiesgos}
											<span
												class="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
											>
												<span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
												ON
											</span>
										{/if}
									</button>
								</div>

								<div class="border-t border-gray-100 px-3 py-1.5">
									<p class="text-[9px] font-medium text-gray-400">Click para mostrar/ocultar</p>
								</div>
							</div>
						</div>

						<div class="detalle-seccion">
							<h2 class="detalle-seccion-titulo">Estado de la vía</h2>
						</div>
						{#if loadingCondiciones}
							<div class="detalle-card detalle-fila-cargando">
								<span class="detalle-spinner"></span>
								<span>Analizando condiciones actuales de la vía…</span>
							</div>
						{:else if condicionesViales.length > 0}
							<div class="detalle-card">
								{#each condicionesViales as cond, indice}
									<div class="detalle-condicion" class:detalle-condicion--separada={indice > 0}>
										<span
											class="detalle-chip"
											style="background-color: {NIVEL_APP[cond.nivel]?.fondo}; color: {NIVEL_APP[
												cond.nivel
											]?.texto}"
										>
											{cond.titulo}
										</span>
										<p class="detalle-muted">{cond.descripcion}</p>
									</div>
								{/each}
							</div>
						{/if}
						{#if loadingPOIs}
							<div
								class="detalle-card detalle-fila-cargando"
								in:fade={{ duration: 200 }}
								out:fade={{ duration: 200 }}
							>
								<span class="detalle-spinner"></span>
								<span>Buscando peajes, paradas y estaciones en la ruta…</span>
							</div>
						{/if}

						<!-- Ejecución del conductor (inicio/liberación desde la app) -->
						<EjecucionConductor servicioId={servicio.id} estado={servicio.estado} />
					</div>

					<div class="detalle-columna">
						<div class="detalle-seccion"><h2 class="detalle-seccion-titulo">Recorrido</h2></div>
						<div class="detalle-card">
							<div class="detalle-tramo">
								<span class="detalle-punto detalle-punto--origen"></span>
								<div class="detalle-tramo-texto">
									<p class="detalle-etiqueta">ORIGEN</p>
									<p class="detalle-titulo-card">
										{[servicio.origen?.nombre_municipio, servicio.origen?.nombre_departamento]
											.filter(Boolean)
											.join(', ') ||
											servicio.origen_especifico ||
											'Sin especificar'}
									</p>
									{#if servicio.origen_especifico && servicio.origen?.nombre_municipio && servicio.origen_especifico !== servicio.origen.nombre_municipio}
										<p class="detalle-muted">{servicio.origen_especifico}</p>
									{/if}
								</div>
							</div>
							<div class="detalle-linea"></div>
							<div class="detalle-tramo">
								<span class="detalle-punto detalle-punto--destino"></span>
								<div class="detalle-tramo-texto">
									<p class="detalle-etiqueta">DESTINO</p>
									<p class="detalle-titulo-card">
										{[servicio.destino?.nombre_municipio, servicio.destino?.nombre_departamento]
											.filter(Boolean)
											.join(', ') ||
											servicio.destino_especifico ||
											'Sin especificar'}
									</p>
									{#if servicio.destino_especifico && servicio.destino?.nombre_municipio && servicio.destino_especifico !== servicio.destino.nombre_municipio}
										<p class="detalle-muted">{servicio.destino_especifico}</p>
									{/if}
								</div>
							</div>
							{#if distancia !== '—'}
								<p class="detalle-recorrido-resumen">
									{[distancia, duracion].filter((v) => v !== '—').join(' · ')}
								</p>
							{/if}
						</div>

						<div class="detalle-seccion"><h2 class="detalle-seccion-titulo">Programación</h2></div>
						<div class="detalle-card">
							{#if servicio.fecha_solicitud}
								<div class="detalle-dato">
									<span class="detalle-etiqueta">Solicitado</span><span class="detalle-valor"
										>{fmtDate(servicio.fecha_solicitud)}</span
									>
								</div>
							{/if}
							{#if (servicio as any).fecha_servicio}
								<div class="detalle-dato">
									<span class="detalle-etiqueta">Servicio</span><span class="detalle-valor"
										>{fmtDate((servicio as any).fecha_servicio)}</span
									>
								</div>
							{/if}
							{#if (servicio as any).hora_inicio}
								<div class="detalle-dato">
									<span class="detalle-etiqueta">Hora inicio</span><span class="detalle-valor"
										>{fmtTime((servicio as any).hora_inicio)}</span
									>
								</div>
							{/if}
							{#if (servicio as any).hora_fin}
								<div class="detalle-dato">
									<span class="detalle-etiqueta">Hora fin</span><span class="detalle-valor"
										>{fmtTime((servicio as any).hora_fin)}</span
									>
								</div>
							{/if}
							{#if servicio.fecha_realizacion}
								<div class="detalle-dato">
									<span class="detalle-etiqueta">Realización</span><span class="detalle-valor"
										>{fmtDate(servicio.fecha_realizacion)}</span
									>
								</div>
							{/if}
							{#if servicio.fecha_finalizacion}
								<div class="detalle-dato">
									<span class="detalle-etiqueta">Finalización</span><span class="detalle-valor"
										>{fmtDate(servicio.fecha_finalizacion)}</span
									>
								</div>
							{/if}
							{#if servicio.numero_planilla}
								<div class="detalle-dato">
									<span class="detalle-etiqueta">Planilla</span><span class="detalle-valor"
										>{servicio.numero_planilla}</span
									>
								</div>
							{/if}
						</div>

						<div class="detalle-seccion"><h2 class="detalle-seccion-titulo">Vehículo</h2></div>
						<div class="detalle-card">
							{#if servicio.vehiculo?.placa}
								<span class="detalle-placa">{servicio.vehiculo.placa}</span>
								{#if servicio.vehiculo.marca || servicio.vehiculo.linea || servicio.vehiculo.modelo}
									<p class="detalle-titulo-card">
										{[servicio.vehiculo.marca, servicio.vehiculo.linea, servicio.vehiculo.modelo]
											.filter(Boolean)
											.join(' ')}
									</p>
								{/if}
								{#if servicio.vehiculo.color || servicio.vehiculo.clase_vehiculo || (servicio.vehiculo as any).combustible}
									<p class="detalle-muted">
										{[
											servicio.vehiculo.color,
											servicio.vehiculo.clase_vehiculo,
											(servicio.vehiculo as any).combustible
										]
											.filter(Boolean)
											.join(' · ')}
									</p>
								{/if}
							{:else}
								<p class="detalle-muted">Todavía no hay vehículo asignado a este servicio.</p>
							{/if}
						</div>

						<div class="detalle-seccion"><h2 class="detalle-seccion-titulo">Conductor</h2></div>
						<div class="detalle-card detalle-persona">
							{#if servicio.conductor?.foto_signed_url}
								<img
									src={servicio.conductor.foto_signed_url}
									alt={servicio.conductor.nombre}
									class="detalle-avatar object-cover"
								/>
							{:else if servicio.conductor}
								<div class="detalle-avatar detalle-avatar--iniciales">
									{servicio.conductor.nombre.charAt(0)}{servicio.conductor.apellido.charAt(0)}
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="detalle-titulo-card">
									{servicio.conductor
										? `${servicio.conductor.nombre} ${servicio.conductor.apellido}`
										: 'Sin asignar'}
								</p>
								{#if servicio.conductor?.numero_identificacion || servicio.conductor?.telefono}
									<p class="detalle-muted">
										{[
											servicio.conductor?.numero_identificacion
												? `CC ${servicio.conductor.numero_identificacion}`
												: '',
											servicio.conductor?.telefono ?? ''
										]
											.filter(Boolean)
											.join(' · ')}
									</p>
								{/if}
							</div>
						</div>

						<div class="detalle-seccion"><h2 class="detalle-seccion-titulo">Cliente</h2></div>
						<div class="detalle-card">
							<p class="detalle-titulo-card">
								{servicio.cliente?.nombre || 'Sin cliente asignado'}
							</p>
							{#if servicio.cliente?.nit || (servicio.cliente as any)?.telefono}
								<p class="detalle-muted">
									{[
										servicio.cliente?.nit ? `NIT ${servicio.cliente.nit}` : '',
										(servicio.cliente as any)?.telefono ?? ''
									]
										.filter(Boolean)
										.join(' · ')}
								</p>
							{/if}
						</div>

						<div class="detalle-seccion">
							<h2 class="detalle-seccion-titulo">Vía y riesgos</h2>
							{#if esDefault}<span class="detalle-seccion-detalle">Por defecto</span>{/if}
						</div>
						<div class="detalle-card">
							<div class="detalle-chips">
								<span class="detalle-chip detalle-chip--neutro">
									<span
										class="h-2 w-2 rounded-full {estadoConductor === 'optimo'
											? 'bg-emerald-500'
											: estadoConductor === 'regular'
												? 'bg-amber-500'
												: estadoConductor === 'fatigado'
													? 'bg-orange-500'
													: 'bg-red-500'}"
									></span>
									Conductor {estadoConductor}
								</span>
								{#if viaPavimentada}<span class="detalle-chip detalle-chip--neutro"
										>Pavimentada</span
									>{/if}
								{#if viaMixto}<span class="detalle-chip detalle-chip--neutro">Mixta</span>{/if}
								{#if viaAfirmado}<span class="detalle-chip detalle-chip--neutro">Afirmado</span
									>{/if}
								{#if viaTrocha}<span class="detalle-chip detalle-chip--neutro">Trocha</span>{/if}
								{#if riesgoDeslizamientos}<span class="detalle-chip detalle-chip--alerta"
										>Deslizamientos</span
									>{/if}
								{#if riesgoDesniveles}<span class="detalle-chip detalle-chip--alerta"
										>Desniveles</span
									>{/if}
								{#if riesgoSinSenalizacion}<span class="detalle-chip detalle-chip--alerta"
										>Sin señalización</span
									>{/if}
								{#if riesgoAnimales}<span class="detalle-chip detalle-chip--alerta"
										>Animales en la vía</span
									>{/if}
								{#if riesgoPeatones}<span class="detalle-chip detalle-chip--alerta">Peatones</span
									>{/if}
								{#if riesgoTrafico}<span class="detalle-chip detalle-chip--alerta"
										>Tráfico alto</span
									>{/if}
							</div>
							<!-- Calificación — solo si realizado -->
							{#if esRealizado && rc?.calificacion_servicio}
								{@const estrellas =
									{ excelente: 5, bueno: 5, regular: 3, malo: 2 }[
										calificacion as 'excelente' | 'bueno' | 'regular' | 'malo'
									] ?? 5}
								{@const calColor =
									{
										excelente: 'text-emerald-600',
										bueno: 'text-emerald-600',
										regular: 'text-amber-500',
										malo: 'text-red-500'
									}[calificacion as 'excelente' | 'bueno' | 'regular' | 'malo'] ??
									'text-emerald-600'}
								{@const calLabel =
									{ excelente: 'Excelente', bueno: 'Bueno', regular: 'Regular', malo: 'Malo' }[
										calificacion as 'excelente' | 'bueno' | 'regular' | 'malo'
									] ?? 'Bueno'}
								<div class="detalle-calificacion">
									<span class="detalle-etiqueta">CALIFICACIÓN</span>
									<div class="flex items-center gap-0.5">
										{#each Array(5) as _, i}
											<svg
												class="h-3.5 w-3.5 {i < estrellas ? 'text-amber-400' : 'text-gray-200'}"
												fill="currentColor"
												viewBox="0 0 20 20"
											>
												<path
													d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
												/>
											</svg>
										{/each}
									</div>
									<span class="text-xs font-semibold {calColor}">{calLabel}</span>
								</div>
							{/if}
						</div>
					</div>
				</div>
				<div class="h-8"></div>
			</div>
		</div>

		<!-- MODAL COMPARTIR (ModalBase, estilo de la app) -->
		<ModalBase
			open={showShareModal}
			eyebrow="Compartir"
			title="Enlace del servicio"
			subtitle="Quien tenga el enlace ve el detalle público del servicio, sin iniciar sesión."
			tamano="sm"
			oncerrar={cerrarCompartir}
		>
			<button type="button" onclick={copyLink} class="compartir-enlace">
				<span class="compartir-enlace-etiqueta">Toca para copiar</span>
				<span class="compartir-enlace-url">{generatedShareUrl}</span>
			</button>
			{#snippet pie()}
				<button type="button" class="btn-secondary" onclick={cerrarCompartir}>Cerrar</button>
				<button type="button" class="btn-primary" onclick={copyLink}>
					{copySuccess ? '¡Copiado!' : 'Copiar enlace'}
				</button>
			{/snippet}
		</ModalBase>
	{/if}
</div>

<style>
	:global(#map) {
		width: 100%;
		height: 100%;
	}

	/* ── MAPA: protagonista #1 (más grande) ──────────────────── */
	.servicio-map-frame {
		height: 480px;
		isolation: isolate;
	}
	@media (min-width: 640px) {
		.servicio-map-frame {
			height: 540px;
		}
	}
	@media (min-width: 1024px) {
		.servicio-map-frame {
			height: 600px;
		}
	}
	@media (min-width: 1280px) {
		.servicio-map-frame {
			height: 640px;
		}
	}

	/* Stats overlay sobre el mapa (distancia + tiempo) */
	.servicio-map-stats {
		position: absolute;
		bottom: 0.75rem;
		left: 0.75rem;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.7rem 1.1rem;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(12px);
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 14px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
	}
	.stat-block {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.stat-block-label {
		font-family: var(--font-sans);
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #64748b;
	}
	.stat-block-value {
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-weight: 600;
		color: #0f172a;
		letter-spacing: -0.01em;
		line-height: 1.1;
	}
	.stat-divider {
		width: 1px;
		height: 28px;
		background: rgba(0, 0, 0, 0.08);
	}
	@keyframes ping {
		75%,
		100% {
			transform: scale(2);
			opacity: 0;
		}
	}
	:global(.mapboxgl-marker) {
		will-change: transform;
	}
	:global(.mapboxgl-popup-content) {
		padding: 0 !important;
		border-radius: 12px !important;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18) !important;
		overflow: hidden;
	}
	:global(.mapboxgl-popup-tip) {
		display: none;
	}
	:global(.mapboxgl-ctrl-bottom-right) {
		margin-bottom: 2rem;
		margin-right: 0.75rem;
	}

	/* ── Estilo de la app móvil (detalle del servicio) ──────────────
	   Los colores de marca salen de las variables del tema (--color-emerald-*),
	   que cada web define: verde en Transmeralda, naranja en Cotransmeq. */
	.detalle-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--color-emerald-50);
	}
	@media (min-width: 768px) {
		.detalle-header {
			padding: 0.85rem 1.5rem;
		}
	}
	.detalle-volver {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		border-radius: 999px;
		background: #ffffff;
		color: var(--color-emerald-900);
		box-shadow: 0 4px 12px rgba(1, 67, 57, 0.08);
		transition: transform 0.15s ease;
	}
	.detalle-volver:hover:not(:disabled) {
		transform: translateX(-1px);
	}
	.detalle-volver:disabled {
		opacity: 0.5;
	}
	.detalle-header-titulo {
		font-size: 1.3125rem;
		line-height: 1.65rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--color-gray-950);
	}
	.detalle-header-id {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-gray-600);
	}
	.detalle-fondo {
		background: var(--color-emerald-50);
	}
	.detalle {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.detalle-columnas {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
	}
	@media (min-width: 1024px) {
		.detalle-columnas {
			grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
			gap: 1.25rem;
			align-items: start;
		}
	}
	.detalle-columna {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	.detalle-estado {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
	}
	.detalle-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		align-self: flex-start;
		padding: 0.3rem 0.75rem;
		border-radius: 999px;
		font-size: 0.8125rem;
		font-weight: 800;
	}
	.detalle-chip--neutro {
		background: var(--color-emerald-50);
		color: var(--color-emerald-900);
	}
	.detalle-chip--alerta {
		background: #fff0ed;
		color: #b42318;
	}
	.detalle-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.detalle-proposito {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--color-gray-600);
	}
	/* Tarjeta de la app: blanca, radio 22 y sombra suave verde. */
	.detalle-card {
		display: flex;
		flex-direction: column;
		gap: 0.5625rem;
		padding: 1.0625rem;
		border-radius: 22px;
		background: #ffffff;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}
	.detalle-mapa {
		border-radius: 22px;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
		background: #dbeafe;
	}
	.detalle-seccion {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.25rem;
		padding: 0 0.125rem;
	}
	.detalle-seccion-titulo {
		font-size: 1.3125rem;
		line-height: 1.625rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--color-gray-950);
	}
	.detalle-seccion-detalle {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-gray-600);
	}
	.detalle-titulo-card {
		font-size: 1rem;
		line-height: 1.3125rem;
		font-weight: 800;
		color: var(--color-gray-950);
	}
	.detalle-muted {
		font-size: 0.8125rem;
		line-height: 1.1875rem;
		color: var(--color-gray-600);
	}
	.detalle-etiqueta {
		font-size: 0.6875rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		color: var(--color-gray-600);
	}
	.detalle-valor {
		font-size: 0.875rem;
		font-weight: 700;
		text-align: right;
		color: var(--color-gray-950);
	}
	.detalle-dato {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	/* Indicaciones de operaciones: tarjeta ámbar con borde a la izquierda, como en la app. */
	.detalle-indicaciones {
		border-left: 4px solid #d97706;
		background: #fffbeb;
	}
	.detalle-indicaciones-titulo {
		font-size: 0.8125rem;
		font-weight: 900;
		letter-spacing: 0.025em;
		color: #92400e;
	}
	.detalle-indicaciones-texto {
		font-size: 0.9375rem;
		line-height: 1.375rem;
		color: var(--color-gray-950);
		white-space: pre-line;
	}
	.detalle-condicion {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.detalle-condicion--separada {
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-gray-100);
	}
	.detalle-fila-cargando {
		flex-direction: row;
		align-items: center;
		gap: 0.625rem;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--color-emerald-900);
	}
	.detalle-spinner {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		border-radius: 999px;
		border: 2px solid var(--color-emerald-500);
		border-top-color: transparent;
		animation: detalle-giro 0.8s linear infinite;
	}
	@keyframes detalle-giro {
		to {
			transform: rotate(360deg);
		}
	}
	/* Recorrido vertical con puntos, como en la app. */
	.detalle-tramo {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.detalle-tramo-texto {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		flex: 1;
	}
	.detalle-punto {
		width: 13px;
		height: 13px;
		margin-top: 5px;
		flex-shrink: 0;
		border-radius: 999px;
	}
	.detalle-punto--origen {
		background: var(--color-emerald-500);
	}
	.detalle-punto--destino {
		background: var(--color-emerald-900);
	}
	.detalle-linea {
		width: 2px;
		height: 18px;
		margin-left: 5.5px;
		background: var(--color-emerald-100);
	}
	.detalle-recorrido-resumen {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--color-emerald-900);
	}
	/* Placa: recuadro verde oscuro con letras blancas, como en la app. */
	.detalle-placa {
		align-self: flex-start;
		padding: 0.375rem 0.875rem;
		border-radius: 10px;
		background: var(--color-emerald-900);
		color: #ffffff;
		font-size: 1.1875rem;
		font-weight: 900;
		letter-spacing: 0.08em;
	}
	.detalle-persona {
		flex-direction: row;
		align-items: center;
		gap: 0.875rem;
	}
	.detalle-avatar {
		width: 3rem;
		height: 3rem;
		flex-shrink: 0;
		border-radius: 16px;
	}
	.detalle-avatar--iniciales {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-emerald-100);
		color: var(--color-emerald-900);
		font-weight: 800;
	}
	.detalle-calificacion {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-gray-100);
	}

	/* Enlace del modal de compartir: tarjeta blanca de la app que se copia al tocarla. */
	.compartir-enlace {
		display: flex;
		width: 100%;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.875rem 1rem;
		border-radius: 16px;
		background: #ffffff;
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
		text-align: left;
		transition: box-shadow 0.15s ease;
	}
	.compartir-enlace:hover {
		box-shadow: 0 0 0 2px var(--color-emerald-100);
	}
	.compartir-enlace-etiqueta {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-gray-600);
	}
	.compartir-enlace-url {
		font-size: 0.875rem;
		font-weight: 800;
		color: var(--color-emerald-900);
		overflow-wrap: anywhere;
	}
</style>
