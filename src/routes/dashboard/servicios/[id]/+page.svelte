<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import mapboxgl from 'mapbox-gl';
	import 'mapbox-gl/dist/mapbox-gl.css';
	import { servicioDetalleStore } from '$lib/stores/servicio-detalle';
	import { serviciosStore } from '$lib/stores/servicios';
	import { sidebarStore } from '$lib/stores/sidebar';

	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

	// Variables reactivas del store
	$: servicio = $servicioDetalleStore.servicio;
	$: loading = $servicioDetalleStore.loading;
	$: error = $servicioDetalleStore.error;
	$: sidebarCollapsed = $sidebarStore;

	// Variables de mapa
	let map: mapboxgl.Map | null = null;
	let isMapLoaded = false;
	let markers: mapboxgl.Marker[] = [];
	let routeCoordinates: number[][] = [];
	let distancia = '0';
	let duracion = '0';

	// Variables de UI
	let isNavigating = false;
	let showShareModal = false;
	let generatedShareUrl = '';
	let copySuccess = false;

	// Función para ajustar el mapa a los bounds de la ruta
	function fitMapToBounds() {
		if (!map || !servicio) return;

		const originLat = servicio.origen_latitud || servicio.origen?.latitud;
		const originLng = servicio.origen_longitud || servicio.origen?.longitud;
		const destLat = servicio.destino_latitud || servicio.destino?.latitud;
		const destLng = servicio.destino_longitud || servicio.destino?.longitud;

		if (!originLat || !originLng || !destLat || !destLng) return;

		const bounds = new mapboxgl.LngLatBounds();
		bounds.extend([originLng, originLat]);
		bounds.extend([destLng, destLat]);
		map.fitBounds(bounds, { padding: 100, maxZoom: 14 });
	}

	// NO redimensionar el mapa cuando el drawer cambia para evitar deformación de marcadores
	// El mapa se mantiene en su tamaño inicial

	// Helper: Obtener color según estado
	function getStatusColor(status: string): string {
		const colors: Record<string, string> = {
			pendiente: '#F59E0B',
			en_curso: '#3B82F6',
			completado: '#10B981',
			cancelado: '#EF4444'
		};
		return colors[status] || '#6B7280';
	}

	// Helper: Formatear fecha
	function formatearFecha(fecha: string | Date): string {
		if (!fecha) return 'No disponible';
		const date = typeof fecha === 'string' ? new Date(fecha) : fecha;
		return new Intl.DateTimeFormat('es-CO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(date);
	}

	// Helper: Formatear duración
	function formatDuration(minutes: number): string {
		const hours = Math.floor(minutes / 60);
		const mins = Math.round(minutes % 60);
		if (hours > 0) {
			return `${hours}h ${mins}min`;
		}
		return `${mins} min`;
	}

	// Helper: Obtener ruta de Mapbox
	async function fetchMapboxRoute(
		originLng: number,
		originLat: number,
		destLng: number,
		destLat: number
	): Promise<number[][]> {
		const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${originLng},${originLat};${destLng},${destLat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;

		const response = await fetch(url);
		const data = await response.json();

		if (data.routes && data.routes.length > 0) {
			const route = data.routes[0];
			distancia = (route.distance / 1000).toFixed(2);
			duracion = formatDuration(route.duration / 60);
			return route.geometry.coordinates;
		}

		return [];
	}

	// Helper: Crear marcador personalizado
	function createMarker(type: 'origin' | 'destination'): HTMLDivElement {
		const el = document.createElement('div');
		el.className = `custom-marker-${type}`;
		el.style.cssText = `
			background-color: ${type === 'origin' ? '#059669' : '#DC2626'};
			width: 32px;
			height: 32px;
			border-radius: 50%;
			border: 3px solid white;
			box-shadow: 0 2px 8px rgba(0,0,0,0.3);
			display: flex;
			align-items: center;
			justify-content: center;
			color: white;
			font-weight: bold;
			font-size: 14px;
		`;
		el.innerText = type === 'origin' ? 'A' : 'B';
		return el;
	}

	// Helper: Crear HTML para popup
	function createPopupHTML(
		type: 'origin' | 'destination',
		title: string,
		subtitle: string
	): string {
		const color = type === 'origin' ? 'orange' : 'red';
		return `
			<div class="p-3">
				<h3 class="font-bold text-${color}-600 mb-1">${title}</h3>
				<p class="text-sm text-gray-700">${subtitle}</p>
			</div>
		`;
	}

	// Limpiar objetos del mapa
	function clearMapObjects() {
		markers.forEach((marker) => marker.remove());
		markers = [];

		if (map?.getLayer('route')) {
			map.removeLayer('route');
		}
		if (map?.getSource('route')) {
			map.removeSource('route');
		}
	}

	// Inicializar mapa
	function initializeMap() {
		console.log('🗺️ [INIT MAP] Intentando inicializar...', {
			hasToken: !!MAPBOX_TOKEN,
			hasServicio: !!servicio,
			mapExists: !!map
		});

		if (!MAPBOX_TOKEN || !servicio || map) {
			console.warn('⚠️ [INIT MAP] No se puede inicializar:', {
				hasToken: !!MAPBOX_TOKEN,
				hasServicio: !!servicio,
				mapExists: !!map
			});
			return;
		}

		// Verificar que el container existe
		const container = document.getElementById('map');
		if (!container) {
			console.error('❌ [INIT MAP] Container #map no encontrado en DOM');
			return;
		}

		console.log('📦 [INIT MAP] Container encontrado:', {
			width: container.offsetWidth,
			height: container.offsetHeight
		});

		const originLat = servicio.origen_latitud || servicio.origen?.latitud;
		const originLng = servicio.origen_longitud || servicio.origen?.longitud;
		const destLat = servicio.destino_latitud || servicio.destino?.latitud;
		const destLng = servicio.destino_longitud || servicio.destino?.longitud;

		console.log('📍 [INIT MAP] Coordenadas:', { originLng, originLat, destLng, destLat });

		if (!originLat || !originLng || !destLat || !destLng) {
			console.warn('⚠️ [INIT MAP] Coordenadas no disponibles');
			return;
		}

		try {
			mapboxgl.accessToken = MAPBOX_TOKEN;

			console.log('🗺️ [INIT MAP] Creando mapa con container ID "map"');

			map = new mapboxgl.Map({
				container: 'map', // Usar ID simple como en la página pública
				style: 'mapbox://styles/mapbox/outdoors-v12',
				center: [originLng, originLat],
				zoom: 12
			});

			console.log('✅ [INIT MAP] Objeto Map creado exitosamente');

			// Verificar canvas inmediatamente después de crear el mapa
			setTimeout(() => {
				const canvas = document.querySelector('#map canvas');
				console.log('🎨 [INIT MAP] Canvas después de crear mapa:', {
					existe: !!canvas,
					width: canvas?.getAttribute('width'),
					height: canvas?.getAttribute('height'),
					style: canvas?.getAttribute('style')
				});
			}, 100);

			// NO agregar controles de navegación (zoom, brújula) según solicitud del usuario

			map.on('load', () => {
				console.log('✅ [INIT MAP] Mapa cargado exitosamente');
				const canvas = map.getCanvas();
				console.log('🎨 [INIT MAP] Canvas al cargar:', {
					width: canvas.width,
					height: canvas.height,
					clientWidth: canvas.clientWidth,
					clientHeight: canvas.clientHeight,
					offsetWidth: canvas.offsetWidth,
					offsetHeight: canvas.offsetHeight
				});
				isMapLoaded = true;
			});

			map.on('error', (e) => {
				console.error('❌ [INIT MAP] Error en el mapa:', e);
			});
		} catch (err) {
			console.error('❌ [INIT MAP] Error inicializando mapa:', err);
		}
	}

	// Crear ruta en el mapa
	async function createRoute() {
		if (!map || !servicio) return;

		clearMapObjects();

		const originLat = servicio.origen_latitud || servicio.origen?.latitud;
		const originLng = servicio.origen_longitud || servicio.origen?.longitud;
		const destLat = servicio.destino_latitud || servicio.destino?.latitud;
		const destLng = servicio.destino_longitud || servicio.destino?.longitud;

		if (!originLat || !originLng || !destLat || !destLng) return;

		try {
			// Obtener coordenadas de la ruta
			routeCoordinates = await fetchMapboxRoute(originLng, originLat, destLng, destLat);

			// Agregar marcadores
			const originMarker = new mapboxgl.Marker(createMarker('origin'))
				.setLngLat([originLng, originLat])
				.setPopup(
					new mapboxgl.Popup({ offset: 25 }).setHTML(
						createPopupHTML(
							'origin',
							'Origen',
							servicio.origen_especifico || servicio.origen?.nombre_municipio || 'Sin especificar'
						)
					)
				);
			originMarker.addTo(map);
			markers.push(originMarker);

			const destMarker = new mapboxgl.Marker(createMarker('destination'))
				.setLngLat([destLng, destLat])
				.setPopup(
					new mapboxgl.Popup({ offset: 25 }).setHTML(
						createPopupHTML(
							'destination',
							'Destino',
							servicio.destino_especifico || servicio.destino?.nombre_municipio || 'Sin especificar'
						)
					)
				);
			destMarker.addTo(map);
			markers.push(destMarker);

			// Agregar ruta
			if (routeCoordinates.length > 0) {
				map.addSource('route', {
					type: 'geojson',
					data: {
						type: 'Feature',
						properties: {},
						geometry: {
							type: 'LineString',
							coordinates: routeCoordinates
						}
					}
				});

				map.addLayer({
					id: 'route',
					type: 'line',
					source: 'route',
					layout: {
						'line-join': 'round',
						'line-cap': 'round'
					},
					paint: {
						'line-color': '#059669',
						'line-width': 5,
						'line-opacity': 0.75
					}
				});

				// Ajustar vista
				const bounds = new mapboxgl.LngLatBounds();
				bounds.extend([originLng, originLat]);
				bounds.extend([destLng, destLat]);
				map.fitBounds(bounds, { padding: 100, maxZoom: 14 });
			}
		} catch (err) {
			console.error('Error creando ruta:', err);
		}
	}

	// Helpers de formato
	function getEstadoText(estado: string): string {
		const estados: Record<string, string> = {
			pendiente: 'Pendiente',
			en_curso: 'En Curso',
			completado: 'Completado',
			cancelado: 'Cancelado'
		};
		return estados[estado] || estado;
	}

	function formatDateTime(fecha: string | Date): string {
		return formatearFecha(fecha);
	}

	function formatCurrency(value: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0
		}).format(value);
	}

	// Lifecycle
	onMount(async () => {
		console.log('🗺️ [MAP PAGE] onMount ejecutándose');
		const id = $page.params.id;
		console.log('🆔 [MAP PAGE] ID del servicio:', id);
		if (id) {
			await servicioDetalleStore.obtenerServicio(id);
		}
	});

	// Inicializar mapa cuando el servicio se cargue Y no exista mapa aún
	$: if (servicio && !map && !loading) {
		console.log('🗺️ [REACTIVE] Servicio cargado, verificando container...');
		// Esperar a que el DOM se actualice y el container exista
		setTimeout(() => {
			const container = document.getElementById('map');
			console.log('� [REACTIVE] Container existe?', !!container);
			if (container) {
				console.log('✅ [REACTIVE] Inicializando mapa');
				initializeMap();
			} else {
				console.warn('⚠️ [REACTIVE] Container no encontrado en DOM');
			}
		}, 150);
	}

	// Crear ruta cuando el mapa esté listo
	$: if (isMapLoaded && servicio) {
		console.log('🛣️ [MAP PAGE] Creando ruta para servicio:', servicio.id);
		createRoute();
	}

	// Debug: Monitorear cambios en las variables
	$: console.log(
		'📊 [MAP PAGE] Estado - loading:',
		loading,
		'error:',
		error,
		'servicio:',
		servicio?.id,
		'map:',
		!!map,
		'mapLoaded:',
		isMapLoaded
	);

	// Limpiar al desmontar
	onDestroy(() => {
		if (map) {
			clearMapObjects();
			map.remove();
			map = null;
		}
		servicioDetalleStore.limpiar();
	});

	// Función para volver atrás
	function handleGoBack() {
		isNavigating = true;
		goto('/dashboard/servicios');
	}

	// Función para centrar la ruta en el mapa
	function centerRoute() {
		if (!map || !servicio) return;

		const originLat = servicio.origen_latitud || servicio.origen?.latitud;
		const originLng = servicio.origen_longitud || servicio.origen?.longitud;
		const destLat = servicio.destino_latitud || servicio.destino?.latitud;
		const destLng = servicio.destino_longitud || servicio.destino?.longitud;

		if (!originLat || !originLng || !destLat || !destLng) return;

		const bounds = new mapboxgl.LngLatBounds();
		bounds.extend([originLng, originLat]);
		bounds.extend([destLng, destLat]);
		map.fitBounds(bounds, {
			padding: 100,
			maxZoom: 14,
			duration: 1000 // Animación suave de 1 segundo
		});
	}

	// Generar y copiar link compartible
	async function handleCompartirServicio() {
		if (!servicio) return;

		try {
			let token = servicio.share_token;

			// Si no tiene token, generarlo
			if (!token) {
				const response = await serviciosStore.generarShareToken(servicio.id);
				token = response;
				if (!token) {
					alert('Error al generar enlace compartible');
					return;
				}
			}

			// Construir URL pública
			generatedShareUrl = `${window.location.origin}/public/servicio/${token}`;

			// Mostrar modal
			showShareModal = true;
		} catch (error) {
			console.error('Error compartiendo servicio:', error);
			alert('Error al compartir servicio');
		}
	}

	// Copiar enlace al portapapeles
	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(generatedShareUrl);
			copySuccess = true;
			setTimeout(() => {
				copySuccess = false;
			}, 2000);
		} catch (error) {
			console.error('Error copiando al portapapeles:', error);
			alert('Error al copiar enlace');
		}
	}

	// Cerrar modal
	function closeShareModal() {
		showShareModal = false;
		copySuccess = false;
	}
</script>

<svelte:head>
	<title>{servicio ? `Servicio ${servicio.id.slice(0, 8)}` : 'Cargando...'} - Cotransmeq</title>
</svelte:head>

<div class="relative min-h-screen w-full">
	{#if loading}
		<div class="flex min-h-screen items-center justify-center bg-white" in:fade={{ duration: 300 }}>
			<div class="text-center">
				<div
					class="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
				></div>
				<p class="font-medium text-gray-600">Cargando servicio...</p>
			</div>
		</div>
	{:else if error}
		<div class="flex min-h-screen items-center justify-center bg-white" in:fade={{ duration: 300 }}>
			<div class="max-w-md text-center">
				<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100">
					<svg class="h-8 w-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				</div>
				<h2 class="mb-2 text-2xl font-bold text-gray-900">Error</h2>
				<p class="mb-6 text-gray-600">{error}</p>
				<button
					on:click={handleGoBack}
					class="apple-transition rounded-xl bg-orange-500 px-6 py-2.5 font-medium text-white hover:bg-orange-600"
				>
					Volver a servicios
				</button>
			</div>
		</div>
	{:else if servicio}
		<!-- Layout principal prioriza la información del servicio -->
		<div class="min-h-screen bg-gray-50/50 backdrop-blur-3xl">
			<!-- Header con navegación -->
			<div class="sticky top-0 z-50 border-b border-white/20 bg-white/80 backdrop-blur-xl">
				<div class="flex items-center justify-between px-4 py-3 md:px-6 md:py-4">
					<div class="flex items-center space-x-2 md:space-x-4">
						<button
							on:click={handleGoBack}
							class="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600 transition-all hover:scale-105 hover:bg-gray-200 md:h-10 md:w-10"
							class:opacity-50={isNavigating}
							disabled={isNavigating}
						>
							<svg
								class="h-4 w-4 md:h-5 md:w-5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M10 19l-7-7m0 0l7-7m-7 7h18"
								/>
							</svg>
						</button>
						<div>
							<h1 class="text-base font-bold text-gray-900 md:text-xl">Detalle del Servicio</h1>
							<p class="text-xs text-gray-500 md:text-sm">
								ID: {servicio.id.slice(0, 8).toUpperCase()}
							</p>
						</div>
					</div>
					<div class="flex items-center space-x-2 md:space-x-3">
						<button
							on:click={handleCompartirServicio}
							class="flex items-center space-x-1 rounded-xl bg-orange-500 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-orange-600 md:space-x-2 md:px-4 md:py-2 md:text-sm"
						>
							<svg
								class="h-3.5 w-3.5 md:h-4 md:w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
								/>
							</svg>
							<span class="hidden sm:inline">Compartir</span>
						</button>
					</div>
				</div>
			</div>

			<!-- DISEÑO LIMPIO Y PROFESIONAL -->
			<div class="min-h-[calc(100vh-6rem)] w-full bg-gray-50 p-4 md:p-6 lg:p-8">
				<div class="flex h-full flex-col gap-4 md:gap-6 lg:flex-row lg:gap-8">
					<!-- COLUMNA IZQUIERDA: Conductor, Vehículo y Cliente - 25% en desktop, full en mobile -->
					<div class="w-full space-y-4 md:space-y-6 lg:w-1/4">
						<!-- CONDUCTOR -->
						<div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:p-6">
							<!-- Foto -->
							<div class="mb-4 flex justify-center md:mb-5">
								{#if servicio.conductor?.foto_signed_url}
									<img
										src={servicio.conductor.foto_signed_url}
										alt={`${servicio.conductor.nombre} ${servicio.conductor.apellido}`}
										class="h-40 w-40 rounded-2xl object-cover shadow-md sm:h-48 sm:w-48 lg:h-56 lg:w-56"
									/>
								{:else if servicio.conductor}
									<div
										class="flex h-40 w-40 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-md sm:h-48 sm:w-48 lg:h-56 lg:w-56"
									>
										<span class="text-5xl font-bold text-white sm:text-6xl lg:text-7xl">
											{servicio.conductor.nombre.charAt(0)}{servicio.conductor.apellido.charAt(0)}
										</span>
									</div>
								{:else}
									<div
										class="flex h-40 w-40 items-center justify-center rounded-2xl bg-gray-200 shadow-2xl sm:h-48 sm:w-48 lg:h-56 lg:w-56"
									>
										<span class="text-5xl font-bold text-gray-400 sm:text-6xl lg:text-7xl">?</span>
									</div>
								{/if}
							</div>

							<!-- Nombre -->
							<div class="mb-4 text-center md:mb-5">
								<h2 class="mb-1 text-lg font-bold text-gray-900 md:text-xl">
									{servicio.conductor?.nombre || 'Sin'}
									{servicio.conductor?.apellido || 'asignar'}
								</h2>
								<p class="text-xs font-medium text-orange-600 md:text-sm">Conductor</p>
							</div>

							<!-- Info -->
							<div class="space-y-2">
								{#if servicio.conductor?.numero_identificacion}
									<div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm">
										<span class="text-gray-600">Cédula</span>
										<span class="font-semibold text-gray-900"
											>{servicio.conductor.numero_identificacion}</span
										>
									</div>
								{:else}
									<div class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
										<p class="text-xs text-blue-800">Cédula pendiente de registrar</p>
									</div>
								{/if}

								{#if servicio.conductor?.telefono}
									<div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm">
										<span class="text-gray-600">Teléfono</span>
										<span class="font-semibold text-gray-900">{servicio.conductor.telefono}</span>
									</div>
								{:else}
									<div class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
										<p class="text-xs text-blue-800">Teléfono pendiente de registrar</p>
									</div>
								{/if}
							</div>
						</div>

						<!-- VEHÍCULO -->
						<div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
							<div class="mb-4 flex items-center gap-2">
								<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
									<svg
										class="h-4 w-4 text-gray-700"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
										/>
									</svg>
								</div>
								<h3 class="text-sm font-bold text-gray-900">Vehículo</h3>
							</div>

							{#if servicio.vehiculo?.placa}
								<div class="mb-3 rounded-lg border-2 border-gray-300 bg-gray-100 p-3 text-center">
									<p class="text-2xl font-black tracking-widest text-gray-900">
										{servicio.vehiculo.placa}
									</p>
								</div>

								<div class="grid grid-cols-2 gap-2 text-xs">
									<div class="rounded bg-gray-50 p-2 text-center">
										<p class="mb-1 text-gray-500">Marca</p>
										<p class="font-bold text-gray-900">
											{servicio.vehiculo.marca || 'Sin especificar'}
										</p>
									</div>
									<div class="rounded bg-gray-50 p-2 text-center">
										<p class="mb-1 text-gray-500">Modelo</p>
										<p class="font-bold text-gray-900">
											{servicio.vehiculo.modelo || 'Sin especificar'}
										</p>
									</div>
								</div>
							{:else}
								<div
									class="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center"
								>
									<div
										class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-200"
									>
										<svg
											class="h-6 w-6 text-gray-400"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
											/>
										</svg>
									</div>
									<p class="mb-1 text-sm font-medium text-gray-900">Sin vehículo asignado</p>
									<p class="text-xs text-gray-500">
										Este servicio aún no tiene un vehículo asociado
									</p>
								</div>
							{/if}
						</div>

						<!-- CLIENTE -->
						<div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
							<div class="mb-4 flex items-center gap-2">
								<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100">
									<svg
										class="h-4 w-4 text-gray-700"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
										/>
									</svg>
								</div>
								<h3 class="text-sm font-bold text-gray-900">Cliente</h3>
							</div>

							{#if servicio.cliente?.razon_social || servicio.cliente?.nombre}
								<div class="space-y-3">
									<div class="rounded-lg bg-gray-50 p-3">
										<p class="mb-1 text-xs text-gray-500">Razón Social</p>
										<p class="text-sm font-bold text-gray-900">
											{servicio.cliente.razon_social || servicio.cliente.nombre}
										</p>
									</div>

									<div class="flex items-center justify-between rounded-lg bg-gray-50 p-2 text-sm">
										<span class="text-gray-600">NIT</span>
										<span class="font-semibold text-gray-900"
											>{servicio.cliente.nit || 'Sin especificar'}</span
										>
									</div>
								</div>
							{:else}
								<div
									class="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center"
								>
									<div
										class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-200"
									>
										<svg
											class="h-6 w-6 text-gray-400"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
											/>
										</svg>
									</div>
									<p class="mb-1 text-sm font-medium text-gray-900">Sin cliente asignado</p>
									<p class="text-xs text-gray-500">
										Este servicio aún no tiene un cliente asociado
									</p>
								</div>
							{/if}
						</div>

						<!-- INFORMACIÓN DE RECARGOS -->
						{#if servicio.recargos_planillas && servicio.recargos_planillas.length > 0}
							{@const recargo = servicio.recargos_planillas[0]}
							<div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
								<div class="mb-4 flex items-center gap-2">
									<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
										<svg
											class="h-4 w-4 text-blue-700"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
											/>
										</svg>
									</div>
									<h3 class="text-sm font-bold text-gray-900">Detalles de Recargo</h3>
								</div>

								<div class="space-y-3">
									<!-- Estado del Conductor -->
									{#if recargo.estado_conductor}
										<div class="rounded-lg bg-gray-50 p-3">
											<p class="mb-1 text-xs text-gray-500">Estado del Conductor</p>
											<div class="flex items-center gap-2">
												<div
													class="h-2 w-2 rounded-full {recargo.estado_conductor === 'optimo'
														? 'bg-orange-500'
														: recargo.estado_conductor === 'regular'
															? 'bg-yellow-500'
															: recargo.estado_conductor === 'fatigado'
																? 'bg-orange-500'
																: 'bg-red-500'}"
												></div>
												<p class="text-sm font-bold text-gray-900 capitalize">
													{recargo.estado_conductor}
												</p>
											</div>
										</div>
									{/if}

									<!-- Condiciones de Vía -->
									{#if recargo.via_trocha || recargo.via_afirmado || recargo.via_mixto || recargo.via_pavimentada}
										<div class="rounded-lg bg-gray-50 p-3">
											<p class="mb-2 text-xs text-gray-500">Condiciones de Vía</p>
											<div class="flex flex-wrap gap-1.5">
												{#if recargo.via_trocha}
													<span
														class="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800"
														>Trocha</span
													>
												{/if}
												{#if recargo.via_afirmado}
													<span
														class="rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800"
														>Afirmado</span
													>
												{/if}
												{#if recargo.via_mixto}
													<span
														class="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800"
														>Mixto</span
													>
												{/if}
												{#if recargo.via_pavimentada}
													<span
														class="rounded bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800"
														>Pavimentada</span
													>
												{/if}
											</div>
										</div>
									{/if}

									<!-- Riesgos de Seguridad -->
									{#if recargo.riesgo_desniveles || recargo.riesgo_deslizamientos || recargo.riesgo_sin_senalizacion || recargo.riesgo_animales || recargo.riesgo_peatones || recargo.riesgo_trafico_alto}
										<div class="rounded-lg bg-red-50 p-3">
											<p class="mb-2 text-xs text-red-600">Riesgos de Seguridad</p>
											<div class="flex flex-wrap gap-1.5">
												{#if recargo.riesgo_desniveles}
													<span
														class="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
														>Desniveles</span
													>
												{/if}
												{#if recargo.riesgo_deslizamientos}
													<span
														class="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
														>Deslizamientos</span
													>
												{/if}
												{#if recargo.riesgo_sin_senalizacion}
													<span
														class="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
														>Sin Señalización</span
													>
												{/if}
												{#if recargo.riesgo_animales}
													<span
														class="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
														>Animales</span
													>
												{/if}
												{#if recargo.riesgo_peatones}
													<span
														class="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
														>Peatones</span
													>
												{/if}
												{#if recargo.riesgo_trafico_alto}
													<span
														class="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
														>Tráfico Alto</span
													>
												{/if}
											</div>
										</div>
									{/if}

									<!-- Calificación del Servicio -->
									{#if recargo.calificacion_servicio}
										<div class="rounded-lg bg-gray-50 p-3">
											<p class="mb-1 text-xs text-gray-500">Calificación del Servicio</p>
											<div class="flex items-center gap-2">
												{#if recargo.calificacion_servicio === 'excelente'}
													<svg
														class="h-5 w-5 text-orange-500"
														fill="currentColor"
														viewBox="0 0 20 20"
													>
														<path
															d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
														/>
													</svg>
												{:else if recargo.calificacion_servicio === 'bueno'}
													<svg
														class="h-5 w-5 text-blue-500"
														fill="currentColor"
														viewBox="0 0 20 20"
													>
														<path
															d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
														/>
													</svg>
												{:else if recargo.calificacion_servicio === 'regular'}
													<svg
														class="h-5 w-5 text-yellow-500"
														fill="currentColor"
														viewBox="0 0 20 20"
													>
														<path
															d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
														/>
													</svg>
												{:else}
													<svg class="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
														<path
															d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
														/>
													</svg>
												{/if}
												<p class="text-sm font-bold text-gray-900 capitalize">
													{recargo.calificacion_servicio}
												</p>
											</div>
										</div>
									{/if}

									<!-- Número de Días de Servicio -->
									{#if recargo.numero_dias_servicio}
										<div
											class="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm"
										>
											<span class="text-gray-600">Días de Servicio</span>
											<span class="font-semibold text-gray-900"
												>{recargo.numero_dias_servicio} días</span
											>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>

					<!-- COLUMNA DERECHA: Mapa y Detalles - 75% en desktop, full en mobile -->
					<div class="flex min-h-[600px] flex-1 flex-col gap-4 md:gap-6 lg:min-h-0">
						<!-- MAPA - 80% altura en desktop, altura fija en mobile -->
						<div
							class="flex h-[400px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:h-auto lg:flex-[80]"
						>
							<!-- Header -->
							<div
								class="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 md:px-6 md:py-4"
							>
								<div class="flex items-center gap-2 md:gap-3">
									<div
										class="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500 md:h-10 md:w-10"
									>
										<svg
											class="h-4 w-4 text-white md:h-5 md:w-5"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
											/>
										</svg>
									</div>
									<h3 class="text-sm font-bold text-gray-900 md:text-base">Ruta del Servicio</h3>
								</div>
								<button
									on:click={centerRoute}
									class="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-600 md:gap-2 md:px-4 md:py-2 md:text-sm"
								>
									<svg
										class="h-3 w-3 md:h-4 md:w-4"
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
									<span class="hidden sm:inline">Centrar</span>
								</button>
							</div>
							<!-- Mapa -->
							<div class="relative flex-1 bg-gray-50">
								<div id="map" class="h-full w-full"></div>
							</div>
						</div>

						<!-- DETALLES - 20% altura en desktop, auto en mobile -->
						<div
							class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:p-6 lg:flex-[20]"
						>
							<div
								class="grid h-full grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3 lg:gap-8"
							>
								<!-- RECORRIDO -->
								<div>
									<div class="mb-3 flex items-center gap-2 md:mb-4">
										<div
											class="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500 md:h-8 md:w-8"
										>
											<svg
												class="h-3.5 w-3.5 text-white md:h-4 md:w-4"
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
										</div>
										<h4 class="text-xs font-bold text-gray-900 md:text-sm">Recorrido</h4>
									</div>

									<div class="space-y-3">
										{#if servicio.origen_especifico}
											<div>
												<div class="mb-1 flex items-center gap-2">
													<div
														class="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white"
													>
														A
													</div>
													<span class="text-xs font-medium text-gray-500">ORIGEN</span>
												</div>
												<p class="line-clamp-2 pl-7 text-sm font-semibold text-gray-900">
													{servicio.origen_especifico}
												</p>
											</div>
										{:else if servicio.origen?.nombre_municipio}
											<div>
												<div class="mb-1 flex items-center gap-2">
													<div
														class="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white"
													>
														A
													</div>
													<span class="text-xs font-medium text-gray-500">ORIGEN</span>
												</div>
												<p class="line-clamp-2 pl-7 text-sm font-semibold text-gray-900">
													{servicio.origen.nombre_municipio}
												</p>
												<p class="mt-1 pl-7 text-xs text-amber-600">Dirección exacta pendiente</p>
											</div>
										{:else}
											<div class="rounded-lg border border-amber-200 bg-amber-50 p-2">
												<p class="text-xs text-amber-800">
													<span class="font-semibold">Origen:</span> Pendiente de configurar
												</p>
											</div>
										{/if}

										{#if servicio.destino_especifico}
											<div>
												<div class="mb-1 flex items-center gap-2">
													<div
														class="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white"
													>
														B
													</div>
													<span class="text-xs font-medium text-gray-500">DESTINO</span>
												</div>
												<p class="line-clamp-2 pl-7 text-sm font-semibold text-gray-900">
													{servicio.destino_especifico}
												</p>
											</div>
										{:else if servicio.destino?.nombre_municipio}
											<div>
												<div class="mb-1 flex items-center gap-2">
													<div
														class="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white"
													>
														B
													</div>
													<span class="text-xs font-medium text-gray-500">DESTINO</span>
												</div>
												<p class="line-clamp-2 pl-7 text-sm font-semibold text-gray-900">
													{servicio.destino.nombre_municipio}
												</p>
												<p class="mt-1 pl-7 text-xs text-amber-600">Dirección exacta pendiente</p>
											</div>
										{:else}
											<div class="rounded-lg border border-amber-200 bg-amber-50 p-2">
												<p class="text-xs text-amber-800">
													<span class="font-semibold">Destino:</span> Pendiente de configurar
												</p>
											</div>
										{/if}

										{#if distancia !== '0'}
											<div class="flex gap-2 pt-2">
												<div class="flex-1 rounded bg-gray-50 p-2 text-center">
													<p class="text-xs text-gray-500">Distancia</p>
													<p class="text-sm font-bold text-gray-900">{distancia} km</p>
												</div>
												<div class="flex-1 rounded bg-gray-50 p-2 text-center">
													<p class="text-xs text-gray-500">Tiempo</p>
													<p class="text-sm font-bold text-gray-900">{duracion}</p>
												</div>
											</div>
										{/if}
									</div>
								</div>

								<!-- ESTADO Y FECHAS -->
								<div>
									<div class="mb-3 flex items-center gap-2 md:mb-4">
										<div
											class="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 md:h-8 md:w-8"
										>
											<svg
												class="h-3.5 w-3.5 text-gray-700 md:h-4 md:w-4"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
												/>
											</svg>
										</div>
										<h4 class="text-xs font-bold text-gray-900 md:text-sm">Estado y Fechas</h4>
									</div>

									<div class="space-y-3">
										<div class="mb-3">
											<span
												class="inline-block rounded-lg px-3 py-1 text-xs font-bold text-white capitalize"
												style="background-color: {getStatusColor(servicio.estado)}"
											>
												{getEstadoText(servicio.estado)}
											</span>
										</div>

										<div class="space-y-2 text-xs">
											{#if servicio.fecha_solicitud}
												<div class="flex items-center justify-between rounded bg-gray-50 p-2">
													<span class="text-gray-600">Solicitud</span>
													<span class="font-bold text-gray-900"
														>{new Date(servicio.fecha_solicitud).toLocaleDateString('es-CO', {
															month: 'short',
															day: 'numeric'
														})}</span
													>
												</div>
											{:else}
												<div class="rounded border border-blue-200 bg-blue-50 p-2">
													<p class="text-xs text-blue-800">Fecha de solicitud pendiente</p>
												</div>
											{/if}

											{#if servicio.fecha_servicio}
												<div class="flex items-center justify-between rounded bg-gray-50 p-2">
													<span class="text-gray-600">Servicio</span>
													<span class="font-bold text-gray-900"
														>{new Date(servicio.fecha_servicio).toLocaleDateString('es-CO', {
															month: 'short',
															day: 'numeric'
														})}</span
													>
												</div>
											{:else}
												<div class="rounded border border-blue-200 bg-blue-50 p-2">
													<p class="text-xs text-blue-800">Fecha de servicio por definir</p>
												</div>
											{/if}

											{#if servicio.hora_inicio}
												<div class="flex items-center justify-between rounded bg-gray-50 p-2">
													<span class="text-gray-600">Inicio</span>
													<span class="font-bold text-gray-900"
														>{new Date(servicio.hora_inicio).toLocaleTimeString('es-CO', {
															hour: '2-digit',
															minute: '2-digit'
														})}</span
													>
												</div>
											{/if}

											{#if servicio.hora_fin}
												<div class="flex items-center justify-between rounded bg-gray-50 p-2">
													<span class="text-gray-600">Fin</span>
													<span class="font-bold text-gray-900"
														>{new Date(servicio.hora_fin).toLocaleTimeString('es-CO', {
															hour: '2-digit',
															minute: '2-digit'
														})}</span
													>
												</div>
											{/if}

											{#if servicio.created_at}
												<div class="flex items-center justify-between rounded bg-gray-50 p-2">
													<span class="text-gray-600">Creación</span>
													<span class="font-bold text-gray-900"
														>{new Date(servicio.created_at).toLocaleDateString('es-CO', {
															month: 'short',
															day: 'numeric'
														})}</span
													>
												</div>
											{/if}
										</div>
									</div>
								</div>

								<!-- OBSERVACIONES -->
								<div>
									<div class="mb-3 flex items-center gap-2 md:mb-4">
										<div
											class="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 md:h-8 md:w-8"
										>
											<svg
												class="h-3.5 w-3.5 text-gray-700 md:h-4 md:w-4"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
												/>
											</svg>
										</div>
										<h4 class="text-xs font-bold text-gray-900 md:text-sm">Observaciones</h4>
									</div>

									{#if servicio.observaciones}
										<div class="rounded-lg bg-gray-50 p-3">
											<p class="text-sm leading-relaxed text-gray-700">{servicio.observaciones}</p>
										</div>
									{:else}
										<div
											class="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center"
										>
											<div
												class="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-200"
											>
												<svg
													class="h-5 w-5 text-gray-400"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
													/>
												</svg>
											</div>
											<p class="mb-1 text-xs font-medium text-gray-700">Sin observaciones</p>
											<p class="text-xs text-gray-500">
												No hay notas adicionales para este servicio
											</p>
										</div>
									{/if}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Modal de compartir servicio -->
		{#if showShareModal}
			<div
				class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
				on:click={closeShareModal}
				transition:fade={{ duration: 200 }}
			>
				<div
					class="mx-4 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
					on:click|stopPropagation
					transition:fly={{ y: 20, duration: 300 }}
				>
					<!-- Header -->
					<div class="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-5">
						<div class="flex items-center justify-between">
							<div class="flex items-center space-x-3">
								<div
									class="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur-md"
								>
									<svg
										class="h-6 w-6 text-white"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
										/>
									</svg>
								</div>
								<div>
									<h3 class="text-xl font-bold text-white">Enlace Generado</h3>
									<p class="text-sm text-orange-100">Comparte este enlace con tu cliente</p>
								</div>
							</div>
							<button
								on:click={closeShareModal}
								class="rounded-lg p-2 text-white/80 transition-all hover:bg-white/10 hover:text-white"
							>
								<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>
					</div>

					<!-- Body -->
					<div class="space-y-4 p-6">
						<!-- Mensaje de éxito -->
						<div
							class="flex items-start space-x-3 rounded-xl border border-orange-200 bg-orange-50 p-4"
						>
							<svg
								class="mt-0.5 h-6 w-6 flex-shrink-0 text-orange-600"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<div>
								<p class="font-semibold text-orange-900">¡Enlace creado exitosamente!</p>
								<p class="mt-1 text-sm text-orange-700">
									Este enlace permite visualizar el servicio sin necesidad de autenticación.
								</p>
							</div>
						</div>

						<!-- Chip con el enlace -->
						<div class="space-y-2">
							<label class="text-sm font-medium text-gray-700">Enlace público:</label>
							<button
								on:click={copyToClipboard}
								class="group relative w-full cursor-pointer rounded-xl border-2 border-gray-200 bg-gray-50 p-4 transition-all duration-200 hover:border-orange-300 hover:bg-gray-100"
							>
								<div class="flex items-center justify-between space-x-3">
									<div class="flex min-w-0 flex-1 items-center space-x-3">
										<div
											class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-orange-500"
										>
											<svg
												class="h-5 w-5 text-white"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
												/>
											</svg>
										</div>
										<div class="min-w-0 flex-1 text-left">
											<p class="mb-1 text-xs font-medium text-gray-500">Click para copiar</p>
											<p class="truncate font-mono text-sm text-gray-900">
												{generatedShareUrl}
											</p>
										</div>
									</div>
									<div class="flex-shrink-0">
										{#if copySuccess}
											<div
												class="flex items-center space-x-2 rounded-lg bg-orange-500 px-3 py-2 text-white"
												transition:fly={{ y: -5, duration: 200 }}
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M5 13l4 4L19 7"
													/>
												</svg>
												<span class="text-sm font-medium">Copiado</span>
											</div>
										{:else}
											<div
												class="rounded-lg bg-gray-200 px-3 py-2 text-gray-600 transition-all duration-200 group-hover:bg-orange-500 group-hover:text-white"
											>
												<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
													/>
												</svg>
											</div>
										{/if}
									</div>
								</div>
							</button>
						</div>

						<!-- Información adicional -->
						<div
							class="flex items-start space-x-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-gray-600"
						>
							<svg
								class="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<p class="text-blue-800">
								Puedes compartir este enlace por WhatsApp, email o cualquier otro medio. El enlace
								permanece activo hasta que lo revoque.
							</p>
						</div>
					</div>

					<!-- Footer -->
					<div class="flex items-center justify-end space-x-3 bg-gray-50 px-6 py-4">
						<button
							on:click={closeShareModal}
							class="rounded-lg px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-200"
						>
							Cerrar
						</button>
						<button
							on:click={copyToClipboard}
							class="flex items-center space-x-2 rounded-lg bg-orange-500 px-4 py-2 font-medium text-white transition-colors hover:bg-orange-600"
						>
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
								/>
							</svg>
							<span>Copiar enlace</span>
						</button>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* Estilos para el mapa - se adapta al contenedor padre */
	:global(#map) {
		width: 100%;
		height: 100%;
	}

	:global(#map .mapboxgl-canvas) {
		width: 100% !important;
		height: 100% !important;
	}

	:global(.mapboxgl-map) {
		width: 100%;
		height: 100%;
		border-radius: 0;
	}

	:global(.mapboxgl-popup-content) {
		padding: 0;
		border-radius: 16px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
		overflow: hidden;
	}

	:global(.mapboxgl-popup-tip) {
		display: none;
	}

	:global(.mapboxgl-ctrl-group) {
		border-radius: 12px;
		overflow: hidden;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		border: none;
	}

	:global(.mapboxgl-ctrl-group button) {
		width: 36px;
		height: 36px;
	}
</style>
