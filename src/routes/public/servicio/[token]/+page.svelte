<script lang="ts">
	import { onMount } from 'svelte';
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

	// Mapbox token desde variables de entorno
	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

	let servicio: ServicioConRelaciones | null = null;
	let loading = true;
	let error: string | null = null;
	let map: mapboxgl.Map | null = null;
	let drawerOpen = true;

	// Declarar las variables de coordenadas
	let originLng = 0;
	let originLat = 0;
	let destLng = 0;
	let destLat = 0;

	// Función para redimensionar el mapa cuando el drawer cambia
	function resizeMap() {
		if (map) {
			setTimeout(() => {
				map?.resize();
				centerRoute();
			}, 320); // Esperar a que termine la animación del drawer
		}
	}

	// Observar cambios en drawerOpen para redimensionar el mapa
	$: if (map) {
		resizeMap();
		drawerOpen; // Trigger reactivity
	}

	$: token = $page.params.token;

	// Coordenadas con fallback a municipios
	$: {
		// Helper para obtener coordenada válida (no 0, null, undefined)
		const getCoord = (servicioCoord: any, municipioCoord: any): number => {
			// Si la coordenada del servicio existe y NO es 0, usarla
			if (servicioCoord != null && servicioCoord !== 0) {
				return Number(servicioCoord);
			}
			// Si no, intentar usar la del municipio
			if (municipioCoord != null) {
				const parsed = Number(municipioCoord);
				if (!isNaN(parsed) && parsed !== 0) {
					return parsed;
				}
			}
			// Si ambas fallan, retornar 0
			return 0;
		};

		const _originLng = getCoord(servicio?.origen_longitud, servicio?.origen?.longitud);
		const _originLat = getCoord(servicio?.origen_latitud, servicio?.origen?.latitud);
		const _destLng = getCoord(servicio?.destino_longitud, servicio?.destino?.longitud);
		const _destLat = getCoord(servicio?.destino_latitud, servicio?.destino?.latitud);

		console.log('🔄 [COORDS CALC] Calculando coordenadas:', {
			servicio_origen_lng: servicio?.origen_longitud,
			servicio_origen_lat: servicio?.origen_latitud,
			municipio_origen_lng: servicio?.origen?.longitud,
			municipio_origen_lat: servicio?.origen?.latitud,
			tipo_municipio_lng: typeof servicio?.origen?.longitud,
			tipo_municipio_lat: typeof servicio?.origen?.latitud,
			resultado_originLng: _originLng,
			resultado_originLat: _originLat,
			servicio_destino_lng: servicio?.destino_longitud,
			servicio_destino_lat: servicio?.destino_latitud,
			municipio_destino_lng: servicio?.destino?.longitud,
			municipio_destino_lat: servicio?.destino?.latitud,
			resultado_destLng: _destLng,
			resultado_destLat: _destLat
		});

		originLng = _originLng;
		originLat = _originLat;
		destLng = _destLng;
		destLat = _destLat;
	}

	// Debug logs para coordenadas
	$: if (servicio) {
		console.log('🗺️ [DEBUG COORDS] Servicio cargado:', {
			servicio_id: servicio.id,
			origen_especifico: servicio.origen_especifico,
			destino_especifico: servicio.destino_especifico,
			origen_coords_servicio: {
				lat: servicio.origen_latitud,
				lng: servicio.origen_longitud
			},
			destino_coords_servicio: {
				lat: servicio.destino_latitud,
				lng: servicio.destino_longitud
			},
			origen_municipio: {
				nombre: servicio.origen?.nombre_municipio,
				lat: servicio.origen?.latitud,
				lng: servicio.origen?.longitud,
				objeto_completo: servicio.origen
			},
			destino_municipio: {
				nombre: servicio.destino?.nombre_municipio,
				lat: servicio.destino?.latitud,
				lng: servicio.destino?.longitud,
				objeto_completo: servicio.destino
			},
			coords_finales: {
				originLat,
				originLng,
				destLat,
				destLng
			}
		});
	}

	onMount(async () => {
		await cargarServicio();
		if (servicio) {
			initMap();
		}
	});

	async function cargarServicio() {
		try {
			loading = true;
			error = null;
			console.log('🔄 [PUBLIC] Cargando servicio con token:', token);

			const response = await serviciosAPI.getByShareToken(token);
			console.log('📦 [PUBLIC] Respuesta del servidor:', response.data);

			if (response.data.success) {
				servicio = response.data.data;
				console.log('✅ [PUBLIC] Servicio cargado:', servicio);
			} else {
				error = response.data.message || 'No se pudo cargar el servicio';
				console.error('❌ [PUBLIC] Error del servidor:', error);
			}
		} catch (err: any) {
			console.error('❌ [PUBLIC] Error cargando servicio:', err);
			console.error('📄 [PUBLIC] Detalles del error:', err.response?.data);

			if (err.response?.status === 404) {
				error = 'Este enlace no existe o ha sido revocado';
			} else if (err.response?.status === 410) {
				error = 'Este enlace ha expirado';
			} else if (err.response?.status === 500) {
				error = 'Error interno del servidor. Por favor, contacta al administrador.';
			} else {
				error =
					err.response?.data?.message ||
					'No se pudo cargar el servicio. Verifica que el enlace sea correcto.';
			}
		} finally {
			loading = false;
			console.log(
				'🏁 [PUBLIC] Carga finalizada. Loading:',
				loading,
				'Error:',
				error,
				'Servicio:',
				!!servicio
			);
		}
	}

	function initMap() {
		console.log('🗺️ [INIT MAP] Intentando inicializar mapa:', {
			servicio: !!servicio,
			originLat,
			originLng,
			destLat,
			destLng,
			tiene_origen: !!(originLat && originLng),
			tiene_destino: !!(destLat && destLng)
		});

		if (!servicio || !originLat || !originLng) {
			console.warn('⚠️ [INIT MAP] No se puede inicializar el mapa:', {
				servicio: !!servicio,
				originLat,
				originLng,
				razon: !servicio
					? 'No hay servicio'
					: !originLat || !originLng
						? 'Coordenadas de origen inválidas'
						: 'Desconocido'
			});
			return;
		}

		console.log('✅ [INIT MAP] Inicializando mapa con coordenadas:', { originLng, originLat });

		mapboxgl.accessToken = MAPBOX_TOKEN;

		map = new mapboxgl.Map({
			container: 'map',
			style: 'mapbox://styles/mapbox/outdoors-v12',
			center: [originLng, originLat],
			zoom: 12
		});

		map.on('load', () => {
			console.log('🗺️ [MAP LOADED] Mapa cargado, agregando marcadores');

			if (!map || !servicio) {
				console.warn('⚠️ [MAP LOADED] No hay mapa o servicio');
				return;
			}

			// Marcador de origen
			const originEl = document.createElement('div');
			originEl.className = 'custom-marker origin-marker';
			originEl.innerHTML = `
				<div class="marker-pin" style="background-color: #10b981;">
					<span style="color: white; font-weight: bold; font-size: 16px;">A</span>
				</div>
			`;

			new mapboxgl.Marker(originEl)
				.setLngLat([originLng, originLat])
				.setPopup(
					new mapboxgl.Popup({ offset: 25 }).setHTML(
						`<div style="padding: 8px;">
							<strong style="color: #10b981;">Origen</strong><br/>
							<span>${servicio.origen_especifico || servicio.origen?.nombre_municipio || 'N/A'}</span>
						</div>`
					)
				)
				.addTo(map);

			// Marcador de destino (si existe)
			console.log('🗺️ [DESTINO] Verificando destino:', {
				destLat,
				destLng,
				tiene_destino: !!(destLat && destLng)
			});

			if (destLat && destLng) {
				console.log('✅ [DESTINO] Agregando marcador de destino');
				const destEl = document.createElement('div');
				destEl.className = 'custom-marker dest-marker';
				destEl.innerHTML = `
					<div class="marker-pin" style="background-color: #ef4444;">
						<span style="color: white; font-weight: bold; font-size: 16px;">B</span>
					</div>
				`;

				new mapboxgl.Marker(destEl)
					.setLngLat([destLng, destLat])
					.setPopup(
						new mapboxgl.Popup({ offset: 25 }).setHTML(
							`<div style="padding: 8px;">
								<strong style="color: #ef4444;">Destino</strong><br/>
								<span>${servicio.destino_especifico || servicio.destino?.nombre_municipio || 'N/A'}</span>
							</div>`
						)
					)
					.addTo(map);

				// Dibujar ruta
				console.log('🗺️ [RUTA] Llamando a drawRoute()');
				drawRoute();
			} else {
				console.warn('⚠️ [DESTINO] No hay coordenadas de destino válidas:', { destLat, destLng });
			}

			// Ajustar vista
			console.log('🗺️ [CENTER] Centrando vista del mapa');
			centerRoute();
		});
	}

	async function drawRoute() {
		console.log('🗺️ [DRAW ROUTE] Intentando dibujar ruta:', {
			map: !!map,
			originLat,
			originLng,
			destLat,
			destLng
		});

		if (!map || !originLat || !originLng || !destLat || !destLng) {
			console.warn('⚠️ [DRAW ROUTE] No se puede dibujar ruta - coordenadas incompletas');
			return;
		}

		console.log('✅ [DRAW ROUTE] Solicitando ruta a Mapbox API');

		try {
			const response = await fetch(
				`https://api.mapbox.com/directions/v5/mapbox/driving/${originLng},${originLat};${destLng},${destLat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`
			);

			const data = await response.json();

			console.log('🗺️ [DRAW ROUTE] Respuesta de Mapbox:', {
				routes_count: data.routes?.length || 0,
				has_geometry: !!data.routes?.[0]?.geometry
			});

			if (data.routes && data.routes.length > 0) {
				console.log('✅ [DRAW ROUTE] Dibujando ruta en el mapa');
				const route = data.routes[0].geometry;

				// Añadir la ruta al mapa
				if (map.getSource('route')) {
					map.removeLayer('route');
					map.removeSource('route');
				}

				map.addSource('route', {
					type: 'geojson',
					data: {
						type: 'Feature',
						properties: {},
						geometry: route
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
						'line-color': '#10b981',
						'line-width': 4,
						'line-opacity': 0.8
					}
				});

				console.log('✅ [DRAW ROUTE] Ruta dibujada exitosamente');
			} else {
				console.warn('⚠️ [DRAW ROUTE] No se encontraron rutas en la respuesta');
			}
		} catch (error) {
			console.error('❌ [DRAW ROUTE] Error trazando ruta:', error);
		}
	}

	function centerRoute() {
		console.log('🗺️ [CENTER ROUTE] Centrando ruta:', {
			map: !!map,
			servicio: !!servicio,
			originLat,
			originLng,
			destLat,
			destLng
		});

		if (!map || !servicio) {
			console.warn('⚠️ [CENTER ROUTE] No hay mapa o servicio');
			return;
		}

		const bounds = new mapboxgl.LngLatBounds();
		bounds.extend([originLng, originLat]);

		if (destLat && destLng) {
			bounds.extend([destLng, destLat]);
		}

		console.log('🗺️ [CENTER ROUTE] Ajustando vista a bounds:', bounds);

		map.fitBounds(bounds, {
			padding: 100,
			maxZoom: 14,
			duration: 1000
		});

		console.log('✅ [CENTER ROUTE] Vista centrada exitosamente');
	}
</script>

<svelte:head>
	<title>Servicio Compartido - Cotransmeq</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="relative h-screen w-full overflow-hidden bg-gray-50">
	{#if loading}
		<!-- Loading -->
		<div
			class="flex h-full items-center justify-center bg-gradient-to-br from-orange-50 to-white"
			in:fade
		>
			<div class="text-center">
				<div class="mb-6">
					<div
						class="mx-auto mb-4 h-20 w-20 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
					></div>
					<div class="space-y-2">
						<p class="text-xl font-semibold text-gray-800">Cargando servicio...</p>
						<p class="text-sm text-gray-500">Por favor espera un momento</p>
					</div>
				</div>
				<!-- Logo o branding -->
				<div class="mt-8 flex items-center justify-center space-x-2 text-orange-600">
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<span class="font-semibold">Cotransmeq</span>
				</div>
			</div>
		</div>
	{:else if error}
		<!-- Error -->
		<div
			class="flex h-full items-center justify-center bg-gradient-to-br from-red-50 to-white p-6"
			in:fade
		>
			<div class="max-w-lg text-center">
				<div
					class="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-red-100 shadow-lg"
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

				<!-- Información adicional -->
				<div class="space-y-3 text-sm text-gray-600">
					<p class="flex items-center justify-center space-x-2">
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
								d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span>Verifica que hayas copiado el enlace completo</span>
					</p>
					<p class="flex items-center justify-center space-x-2">
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
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span>El enlace puede haber expirado o sido revocado</span>
					</p>
				</div>

				<!-- Logo -->
				<div class="mt-10 flex items-center justify-center space-x-2 text-gray-400">
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
						/>
					</svg>
					<span class="text-sm font-medium">Cotransmeq</span>
				</div>
			</div>
		</div>
	{:else if servicio}
		<!-- Mapa con transición suave -->
		<div
			id="map"
			class="h-full transition-all duration-300 ease-in-out"
			style={drawerOpen ? 'width: calc(100% - 24rem); margin-right: 24rem;' : 'width: 100%;'}
		></div>

		<!-- Logo Cotransmeq -->
		<div class="fixed top-8 left-8 z-40 p-2">
			<img src="/assets/logo.png" alt="Cotransmeq" class="h-16 w-auto drop-shadow-lg" />
		</div>

		<!-- Drawer de información -->
		{#if drawerOpen}
			<div
				class="fixed top-0 right-0 z-50 h-full w-96 shadow-2xl"
				transition:fade={{ duration: 300 }}
			>
				<div class="flex h-full flex-col bg-white/90 backdrop-blur-xl">
					<!-- Header sticky -->
					<div class="sticky top-0 z-10 flex-shrink-0 border-b border-gray-200/50 bg-white/95 p-6">
						<div class="mb-4 flex items-start justify-between">
							<div>
								<h2 class="text-2xl font-bold text-gray-900">Información del Servicio</h2>
								<p class="mt-1 text-sm text-gray-500">
									ID: {servicio.id.slice(0, 8)}...
								</p>
							</div>
							<button
								on:click={() => (drawerOpen = false)}
								class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
								title="Cerrar"
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

						<!-- Estado -->
						<div class="flex items-center gap-2">
							<span
								class="inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-semibold"
								style="background-color: {getEstadoColor(
									servicio.estado
								)}15; border-color: {getEstadoColor(servicio.estado)}40; color: {getEstadoColor(
									servicio.estado
								)}"
							>
								{getEstadoText(servicio.estado)}
							</span>
						</div>
					</div>

					<!-- Contenido scrollable -->
					<div class="flex-1 space-y-6 overflow-y-auto p-6">
						<!-- Ruta -->
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
								<!-- Origen -->
								<div class="flex items-start gap-3">
									<div
										class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 font-semibold text-white"
									>
										A
									</div>
									<div class="flex-1">
										<p class="text-xs text-gray-500">Origen</p>
										<p class="font-medium text-gray-900">
											{servicio.origen_especifico || servicio.origen?.nombre_municipio || 'N/A'}
										</p>
									</div>
								</div>

								<!-- Destino -->
								<div class="flex items-start gap-3">
									<div
										class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500 font-semibold text-white"
									>
										B
									</div>
									<div class="flex-1">
										<p class="text-xs text-gray-500">Destino</p>
										<p class="font-medium text-gray-900">
											{servicio.destino_especifico || servicio.destino?.nombre_municipio || 'N/A'}
										</p>
									</div>
								</div>
							</div>
						</div>

						<!-- Conductor -->
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

						<!-- Vehículo -->
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
									{#if servicio.vehiculo.color}
										<div class="flex justify-between">
											<span class="text-sm text-gray-600">Color:</span>
											<span class="font-medium text-gray-900">{servicio.vehiculo.color}</span>
										</div>
									{/if}
								</div>
							</div>
						{/if}

						<!-- Cliente -->
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
								<div class="space-y-2">
									<p class="font-medium text-gray-900">{servicio.cliente.nombre}</p>
									{#if servicio.cliente.nit}
										<div class="flex justify-between">
											<span class="text-sm text-gray-600">NIT:</span>
											<span class="font-medium text-gray-900">{servicio.cliente.nit}</span>
										</div>
									{/if}
								</div>
							</div>
						{/if}

						<!-- Fechas -->
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
									<span class="text-sm font-medium text-gray-900">
										{formatDateTime(servicio.fecha_solicitud)}
									</span>
								</div>
								{#if servicio.fecha_realizacion}
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Realización:</span>
										<span class="text-sm font-medium text-gray-900">
											{formatDateTime(servicio.fecha_realizacion)}
										</span>
									</div>
								{/if}
								{#if servicio.fecha_finalizacion}
									<div class="flex justify-between">
										<span class="text-sm text-gray-600">Finalización:</span>
										<span class="text-sm font-medium text-gray-900">
											{formatDateTime(servicio.fecha_finalizacion)}
										</span>
									</div>
								{/if}
							</div>
						</div>

						<!-- Observaciones -->
						{#if servicio.observaciones}
							<div class="rounded-xl border border-gray-200 bg-white p-4">
								<h3 class="mb-2 text-sm font-semibold text-gray-700">Observaciones</h3>
								<p class="text-sm text-gray-600">{servicio.observaciones}</p>
							</div>
						{/if}

						<!-- Footer -->
						<div class="border-t border-gray-200 pt-4">
							<div class="flex items-center justify-center gap-2 text-xs text-gray-500">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
									/>
								</svg>
								<span>Enlace compartido de forma segura</span>
							</div>
							<p class="mt-2 text-center text-xs text-gray-400">Powered by Cotransmeq</p>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Botón para abrir drawer (cuando está cerrado) -->
		{#if !drawerOpen}
			<button
				on:click={() => (drawerOpen = true)}
				class="fixed top-4 right-4 z-50 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg transition-shadow hover:shadow-xl"
				transition:fade={{ duration: 200 }}
				title="Ver información del servicio"
				aria-label="Ver información del servicio"
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

		<!-- Botón centrar ruta -->
		<button
			on:click={centerRoute}
			class="fixed right-6 bottom-6 z-40 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg transition-shadow hover:shadow-xl"
			title="Centrar ruta"
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
	:global(.custom-marker) {
		cursor: pointer;
	}

	:global(.marker-pin) {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
		border: 3px solid white;
	}
</style>
