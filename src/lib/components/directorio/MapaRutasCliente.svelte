<script lang="ts">
	import { onMount } from 'svelte';
	import { MapPin, Route } from 'lucide-svelte';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';

	interface Punto {
		nombre?: string | null;
		latitud: number | string;
		longitud: number | string;
	}
	interface Ruta {
		servicio_id: string;
		origen: Punto;
		destino: Punto;
	}
	interface Zona {
		nombre: string;
		departamento?: string | null;
		servicios: number;
		latitud?: number | null;
		longitud?: number | null;
	}
	interface Props {
		rutas: Ruta[];
		zonas: Zona[];
		historico: boolean;
		entidad?: 'cliente' | 'conductor' | 'vehiculo';
	}
	let { rutas, zonas, historico, entidad = 'cliente' }: Props = $props();
	const etiquetaEntidad = $derived(
		entidad === 'vehiculo' ? 'del vehículo' : entidad === 'conductor' ? 'del conductor' : 'del cliente'
	);
	const textoSinZonas = $derived(
		historico
			? 'Todavía no hay zonas registradas en el historial.'
			: `No hay zonas registradas para ${entidad === 'vehiculo' ? 'este vehículo' : entidad === 'conductor' ? 'este conductor' : 'este cliente'} en el período. Ajusta las fechas para consultar otro período.`
	);
	let contenedor = $state<HTMLDivElement>();
	let mapa: mapboxgl.Map | null = null;
	let montado = $state(false);
	const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

	const coordenada = (p: Punto): [number, number] => [Number(p.longitud), Number(p.latitud)];
	const rutasValidas = $derived(rutas.filter((ruta) =>
		coordenada(ruta.origen).every(Number.isFinite) && coordenada(ruta.destino).every(Number.isFinite),
	));
	const zonasActivas = $derived(zonas);
	const rutasVisibles = $derived(historico ? [] : rutasValidas);
	const zonasGeorreferenciadas = $derived(zonasActivas.filter((zona) =>
		zona.latitud != null && zona.longitud != null && Number.isFinite(Number(zona.latitud)) && Number.isFinite(Number(zona.longitud)),
	));
	const firma = $derived(JSON.stringify({
		historico,
		rutas: rutasVisibles.map((ruta) => ruta.servicio_id),
		zonas: zonasGeorreferenciadas.map((zona) => [zona.nombre, zona.servicios, zona.latitud, zona.longitud]),
	}));

	onMount(() => {
		montado = true;
		return () => mapa?.remove();
	});

	$effect(() => {
		void firma;
		if (!montado || !contenedor || !token) return;
		mapa?.remove();
		mapboxgl.accessToken = token;
		const instancia = new mapboxgl.Map({
			container: contenedor,
			style: 'mapbox://styles/mapbox/outdoors-v12',
			center: [-74.2, 4.6],
			zoom: 5.1,
			projection: 'mercator',
			pitch: 0,
			maxPitch: 0,
			dragRotate: false,
			touchPitch: false,
			attributionControl: true
		});
		mapa = instancia;
		instancia.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
		instancia.on('load', () => {
			if (mapa !== instancia) return;
			const bounds = new mapboxgl.LngLatBounds();
			const features: GeoJSON.Feature<GeoJSON.Point>[] = zonasGeorreferenciadas.map((zona) => {
				const coordinates: [number, number] = [Number(zona.longitud), Number(zona.latitud)];
				bounds.extend(coordinates);
				return {
					type: 'Feature',
					properties: { nombre: zona.nombre, departamento: zona.departamento ?? '', servicios: zona.servicios },
					geometry: { type: 'Point', coordinates }
				};
			});
			mapa!.addSource('zonas-frecuentes', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features }
			});
			mapa!.addLayer({
				id: 'zona-frecuencia-halo',
				type: 'circle',
				source: 'zonas-frecuentes',
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['get', 'servicios'], 1, 15, 4, 23, 10, 31, 25, 40],
					'circle-color': '#078a62',
					'circle-opacity': 0.2,
					'circle-stroke-width': 1,
					'circle-stroke-color': '#087a57',
					'circle-stroke-opacity': 0.35
				}
			});
			mapa!.addLayer({
				id: 'zona-frecuencia-punto',
				type: 'circle',
				source: 'zonas-frecuentes',
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['get', 'servicios'], 1, 5, 4, 8, 10, 11, 25, 15],
					'circle-color': '#087a57',
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 2
				}
			});
			mapa!.addLayer({
				id: 'zona-frecuencia-etiqueta',
				type: 'symbol',
				source: 'zonas-frecuentes',
				layout: {
					'text-field': ['to-string', ['get', 'servicios']],
					'text-size': 11,
					'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
					'text-allow-overlap': true
				},
				paint: { 'text-color': '#ffffff', 'text-halo-color': '#087a57', 'text-halo-width': 1 }
			});
			mapa!.on('click', 'zona-frecuencia-punto', (evento) => {
				const feature = evento.features?.[0];
				const coords = (feature?.geometry as GeoJSON.Point | undefined)?.coordinates;
				if (!coords) return;
				const nombre = String(feature?.properties?.nombre ?? 'Zona frecuente');
				const departamento = String(feature?.properties?.departamento ?? '');
				const cantidad = Number(feature?.properties?.servicios ?? 0);
				const popupContenido = document.createElement('div');
				const tituloPopup = document.createElement('strong');
				tituloPopup.textContent = nombre;
				popupContenido.append(tituloPopup);
				if (departamento) {
					const ubicacionPopup = document.createElement('div');
					ubicacionPopup.textContent = departamento;
					popupContenido.append(ubicacionPopup);
				}
				const frecuenciaPopup = document.createElement('div');
				frecuenciaPopup.textContent = `${cantidad} ${cantidad === 1 ? 'servicio' : 'servicios'}`;
				popupContenido.append(frecuenciaPopup);
				new mapboxgl.Popup({ offset: 13 })
					.setLngLat(coords as [number, number])
					.setDOMContent(popupContenido)
					.addTo(mapa!);
			});
			mapa!.on('mouseenter', 'zona-frecuencia-punto', () => { if (mapa) mapa.getCanvas().style.cursor = 'pointer'; });
			mapa!.on('mouseleave', 'zona-frecuencia-punto', () => { if (mapa) mapa.getCanvas().style.cursor = ''; });

			if (rutasVisibles.length) {
				const lineas: GeoJSON.Feature<GeoJSON.LineString>[] = rutasVisibles.map((ruta) => {
					const origen = coordenada(ruta.origen);
					const destino = coordenada(ruta.destino);
					bounds.extend(origen).extend(destino);
					return {
						type: 'Feature',
						properties: { servicio_id: ruta.servicio_id },
						geometry: { type: 'LineString', coordinates: [origen, destino] }
					};
				});
				mapa!.addSource('rutas-servicios', { type: 'geojson', data: { type: 'FeatureCollection', features: lineas } });
				mapa!.addLayer({
					id: 'rutas-servicios', type: 'line', source: 'rutas-servicios',
					paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-opacity': 0.5, 'line-dasharray': [2, 2] }
				});
			}
			if (!bounds.isEmpty()) mapa!.fitBounds(bounds, { padding: 58, maxZoom: 10.5, duration: 0 });
		});
	});
</script>

<div class="mapa-panel">
	<div class="mapa-controles">
		<div class="mapa-leyenda"><span class="mapa-punto"><i></i></span><span>Tamaño del punto = frecuencia de servicios</span></div>
	</div>
	{#if !token}
		<div class="sin-mapa"><MapPin size={20} /><strong>Mapbox no está configurado</strong><span>Completa VITE_MAPBOX_ACCESS_TOKEN para habilitar el mapa.</span></div>
	{:else}
		<div class="mapa" bind:this={contenedor} aria-label={`Mapa Mapbox de zonas frecuentes ${etiquetaEntidad}`}></div>
	{/if}
	<div class="mapa-pie">
		<div><Route size={15} /><span>{historico ? 'Cobertura histórica' : rutasVisibles.length + ' rutas del período'}</span></div>
		<div><MapPin size={15} /><span>{zonasGeorreferenciadas.length} zonas en el mapa</span></div>
	</div>
	{#if zonasActivas.length}
		<div class="lista-zonas">
			{#each zonasActivas.slice(0, 8) as zona, indice}
				<div class="zona-item"><span class="zona-ranking">{indice + 1}</span><span class="zona-nombre"><strong>{zona.nombre}</strong><small>{zona.departamento ?? 'Departamento sin registrar'}</small></span><b>{zona.servicios}</b></div>
			{/each}
		</div>
	{:else}
		<div class="sin-zonas">{textoSinZonas}</div>
	{/if}
</div>

<style>
	.mapa-panel { display: grid; gap: 12px; }
	.mapa-controles, .mapa-pie { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
	.mapa-leyenda, .mapa-pie > div { display: flex; align-items: center; gap: 7px; color: var(--text-muted); font-size: 12px; }
	.mapa-punto { width: 18px; height: 18px; display: grid; place-items: center; border: 1px solid rgba(8,122,87,.35); border-radius: 50%; background: rgba(8,122,87,.16); }
	.mapa-punto i { width: 7px; height: 7px; border-radius: 50%; background: #087a57; }
	.mapa { width: 100%; height: clamp(310px, 42vw, 480px); overflow: hidden; border: 1px solid var(--border-subtle); border-radius: 15px; background: #edf2ef; }
	.sin-mapa { min-height: 200px; display: grid; place-content: center; justify-items: center; gap: 7px; padding: 18px; border: 1px dashed var(--border-subtle); border-radius: 15px; color: var(--text-muted); font-size: 13px; text-align: center; }
	.sin-mapa strong { color: var(--text-primary); }
	.mapa-pie { justify-content: flex-start; gap: 20px; padding: 0 2px; }
	.lista-zonas { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }
	.zona-item { min-width: 0; display: flex; align-items: center; gap: 9px; padding: 9px 10px; border: 1px solid var(--border-subtle); border-radius: 12px; background: var(--bg-surface); }
	.zona-ranking { width: 23px; height: 23px; display: grid; flex: 0 0 auto; place-items: center; border-radius: 50%; color: var(--au-primary); background: var(--au-tint); font-size: 11px; font-weight: 850; }
	.zona-nombre { min-width: 0; display: grid; flex: 1; gap: 2px; }
	.zona-nombre strong { overflow: hidden; color: var(--text-primary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
	.zona-nombre small { color: var(--text-muted); font-size: 10px; }
	.zona-item > b { min-width: 24px; padding: 4px 6px; border-radius: 7px; color: #fff; background: var(--au-primary); font-size: 11px; text-align: center; }
	.sin-zonas { padding: 12px; color: var(--text-muted); font-size: 13px; text-align: center; }
	:global(.mapboxgl-popup-content) { border-radius: 10px; font: 600 12px/1.45 system-ui, sans-serif; }
	@media (max-width: 520px) { .mapa { height: 310px; } .mapa-controles { align-items: flex-start; flex-direction: column; } }
</style>
