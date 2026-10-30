<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import mapboxgl from 'mapbox-gl';
	import { Clock3, MapPin, Radio, RefreshCw, Route, ShieldCheck } from 'lucide-svelte';
	import { fetchConSesion } from '$lib/api/fetchConSesion';
	import { MAPBOX_WARM_STYLE } from '$lib/mapbox';

	interface SesionRastreo {
		id: string;
		estado: 'activa' | 'finalizada';
		consentimiento_at: string | null;
		version: string;
		plataforma: string;
		iniciado_at: string;
		finalizado_at: string | null;
		motivo_finalizacion: string | null;
	}

	interface PuntoRastreo {
		id: string;
		sesion_id: string;
		latitud: number;
		longitud: number;
		precision_m: number | null;
		velocidad_mps: number | null;
		rumbo_grados: number | null;
		capturado_at: string;
		recibido_at: string;
	}

	interface DatosRastreo {
		sesion_activa: SesionRastreo | null;
		sesiones: SesionRastreo[];
		puntos: PuntoRastreo[];
		estado_actual?: 'sin_datos' | 'en_movimiento' | 'detenido' | 'sin_senal';
	}

	interface Props {
		servicioId: string;
		vista?: 'detalle' | 'mapa';
	}

	const { servicioId, vista = 'detalle' }: Props = $props();
	const mapaCompleto = $derived(vista === 'mapa');
	const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
	const URL_API = (id: string) => `/api/servicios/${encodeURIComponent(id)}/rastreo`;
	const REFRESCO_MS = 30_000;
	const MAX_PUNTOS_MAPA = 5_000;
	const SOURCE_ID = 'rastreo-servicio';

	let datos = $state<DatosRastreo | null>(null);
	let sesionSeleccionadaId = $state<string | null>(null);
	let cargando = $state(true);
	let actualizando = $state(false);
	let error = $state<string | null>(null);
	let noDisponible = $state(false);
	let vencido = $state(false);
	let contenedorMapa: HTMLDivElement;
	let mapa: mapboxgl.Map | null = null;
	let mapaListo = false;
	let temporizador: ReturnType<typeof setInterval> | undefined;
	let controlador: AbortController | null = null;
	let vigente = true;
	let encuadre = '';

	const sesiones = $derived.by(() => {
		if (!datos) return [];
		const combinadas = [...datos.sesiones];
		const activa = datos.sesion_activa;
		if (activa && !combinadas.some((sesion) => sesion.id === activa.id)) {
			combinadas.unshift(activa);
		}
		return combinadas.sort((a, b) => Date.parse(b.iniciado_at) - Date.parse(a.iniciado_at));
	});
	const sesionActual = $derived(
		sesiones.find((sesion) => sesion.id === sesionSeleccionadaId) ?? sesiones[0] ?? null
	);
	const puntosSesion = $derived.by(() => {
		if (!datos || !sesionActual) return [];
		return datos.puntos
			.filter(
				(punto) =>
					punto.sesion_id === sesionActual.id &&
					Number.isFinite(punto.latitud) &&
					Number.isFinite(punto.longitud) &&
					punto.latitud >= -90 &&
					punto.latitud <= 90 &&
					punto.longitud >= -180 &&
					punto.longitud <= 180
			)
			.sort((a, b) => Date.parse(a.capturado_at) - Date.parse(b.capturado_at));
	});
	const ultimoPunto = $derived(puntosSesion.at(-1) ?? null);
	const esVacia = $derived(!cargando && !error && !noDisponible && sesiones.length === 0);
	const fmt = new Intl.DateTimeFormat('es-CO', {
		timeZone: 'America/Bogota',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

	function fecha(valor: string | null | undefined): string {
		if (!valor) return '—';
		const fechaValor = new Date(valor);
		return Number.isNaN(fechaValor.getTime()) ? '—' : fmt.format(fechaValor);
	}

	function etiquetaMotivo(motivo: string | null): string {
		if (!motivo) return 'Sin detalle';
		const etiquetas: Record<string, string> = {
			servicio_liberado: 'Servicio liberado',
			servicio_finalizado: 'Servicio finalizado',
			servicio_cancelado: 'Servicio cancelado',
			usuario_detiene: 'Rastreo detenido por el conductor',
			permiso_revocado: 'Permiso de ubicación revocado',
			error_dispositivo: 'Interrupción del dispositivo'
		};
		return etiquetas[motivo] ?? motivo.replaceAll('_', ' ');
	}

	function velocidad(punto: PuntoRastreo | null): string {
		if (!punto || punto.velocidad_mps === null || !Number.isFinite(punto.velocidad_mps)) return '—';
		return `${Math.max(0, punto.velocidad_mps * 3.6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} km/h`;
	}

	const estadoUltimo = $derived.by(() => {
		if (!datos?.estado_actual || !sesionActual) {
			return { etiqueta: 'Sin datos', clase: 'rt-estado--neutro' };
		}
		const sesionMasReciente = datos.sesion_activa?.id ?? sesiones[0]?.id;
		if (sesionActual.id !== sesionMasReciente) {
			return { etiqueta: 'Sesión histórica', clase: 'rt-estado--neutro' };
		}
		const estados: Record<
			NonNullable<DatosRastreo['estado_actual']>,
			{ etiqueta: string; clase: string }
		> = {
			sin_datos: { etiqueta: 'Sin datos', clase: 'rt-estado--neutro' },
			en_movimiento: { etiqueta: 'En movimiento', clase: 'rt-estado--movimiento' },
			detenido: { etiqueta: 'Detenido', clase: 'rt-estado--detenido' },
			sin_senal: { etiqueta: 'Sin señal', clase: 'rt-estado--neutro' }
		};
		return estados[datos.estado_actual];
	});

	async function cargar(): Promise<void> {
		if (!vigente) return;
		if (!servicioId) {
			datos = null;
			cargando = false;
			actualizando = false;
			return;
		}
		controlador?.abort();
		const solicitud = new AbortController();
		controlador = solicitud;
		if (datos) actualizando = true;
		else cargando = true;
		error = null;
		noDisponible = false;
		vencido = false;

		try {
			const respuesta = await fetchConSesion(URL_API(servicioId), { signal: solicitud.signal });
			if (respuesta.status === 403) {
				noDisponible = true;
				datos = null;
				return;
			}
			if (respuesta.status === 410) {
				vencido = true;
				datos = null;
				return;
			}
			if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

			const cuerpo = (await respuesta.json()) as { data?: DatosRastreo };
			if (
				!cuerpo.data ||
				!Array.isArray(cuerpo.data.sesiones) ||
				!Array.isArray(cuerpo.data.puntos)
			) {
				throw new Error('Respuesta de rastreo inválida');
			}
			datos = cuerpo.data;
			const nuevasSesiones = [
				...cuerpo.data.sesiones,
				...(cuerpo.data.sesion_activa ? [cuerpo.data.sesion_activa] : [])
			];
			if (
				!sesionSeleccionadaId ||
				!nuevasSesiones.some((sesion) => sesion.id === sesionSeleccionadaId)
			) {
				sesionSeleccionadaId =
					cuerpo.data.sesion_activa?.id ??
					[...cuerpo.data.sesiones].sort(
						(a, b) => Date.parse(b.iniciado_at) - Date.parse(a.iniciado_at)
					)[0]?.id ??
					null;
			}
			requestAnimationFrame(() => {
				if (MAPBOX_TOKEN) iniciarMapa();
				actualizarMapa(true);
			});
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			/// El error no incluye cuerpo ni coordenadas: la información de ubicación es sensible.
			error = 'No se pudo cargar el recorrido. Intenta actualizar en unos segundos.';
		} finally {
			if (vigente && !solicitud.signal.aborted) {
				cargando = false;
				actualizando = false;
			}
		}
	}

	function geojson(): GeoJSON.FeatureCollection {
		const todos = puntosSesion;
		const puntos =
			todos.length <= MAX_PUNTOS_MAPA
				? todos
				: Array.from({ length: MAX_PUNTOS_MAPA }, (_, indice) => {
						const indiceOriginal = Math.round(
							(indice * (todos.length - 1)) / (MAX_PUNTOS_MAPA - 1)
						);
						return todos[indiceOriginal];
					});
		const features: GeoJSON.Feature[] = [];
		if (puntos.length > 1) {
			features.push({
				type: 'Feature',
				properties: { tipo: 'recorrido' },
				geometry: {
					type: 'LineString',
					coordinates: puntos.map((punto) => [punto.longitud, punto.latitud])
				}
			});
		}
		if (puntos.length) {
			const extremos = puntos.length === 1 ? [puntos[0]] : [puntos[0], puntos.at(-1)!];
			extremos.forEach((punto, indice) => {
				features.push({
					type: 'Feature',
					properties: { tipo: indice === 0 ? 'inicio' : 'ultimo' },
					geometry: { type: 'Point', coordinates: [punto.longitud, punto.latitud] }
				});
			});
		}
		return { type: 'FeatureCollection', features };
	}

	function actualizarMapa(ajustar: boolean): void {
		if (!mapa || !mapaListo) return;
		const fuente = mapa.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
		if (!fuente) return;
		fuente.setData(geojson());

		const puntos = puntosSesion;
		const firma = `${sesionActual?.id ?? ''}:${puntos.length}:${puntos.at(0)?.id ?? ''}:${puntos.at(-1)?.id ?? ''}`;
		if (!ajustar || !puntos.length || firma === encuadre) return;
		encuadre = firma;
		const limites = new mapboxgl.LngLatBounds();
		puntos.forEach((punto) => limites.extend([punto.longitud, punto.latitud]));
		const padding = mapaCompleto
			? window.innerWidth <= 760
				? { top: 100, right: 28, bottom: 330, left: 28 }
				: { top: 92, right: 32, bottom: 82, left: 392 }
			: 48;
		mapa.fitBounds(limites, { padding, maxZoom: 15, duration: 450 });
	}

	function iniciarMapa(): void {
		if (!MAPBOX_TOKEN || !contenedorMapa || mapa) return;
		mapboxgl.accessToken = MAPBOX_TOKEN;
		mapa = new mapboxgl.Map({
			container: contenedorMapa,
			style: MAPBOX_WARM_STYLE,
			center: [-74.1, 4.6],
			zoom: 5,
			...(mapaCompleto
				? {
						pitch: 0,
						bearing: 0,
						maxPitch: 0,
						projection: 'mercator' as const,
						dragRotate: false,
						pitchWithRotate: false,
						touchPitch: false
					}
				: {}),
			attributionControl: true
		});
		mapa.addControl(
			new mapboxgl.NavigationControl({ showCompass: false }),
			mapaCompleto ? 'bottom-right' : 'top-right'
		);
		mapa.once('load', () => {
			if (!mapa) return;
			mapa.resize();
			mapa.addSource(SOURCE_ID, { type: 'geojson', data: geojson() });
			mapa.addLayer({
				id: `${SOURCE_ID}-linea`,
				type: 'line',
				source: SOURCE_ID,
				filter: ['==', ['get', 'tipo'], 'recorrido'],
				paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': 0.88 }
			});
			mapa.addLayer({
				id: `${SOURCE_ID}-puntos`,
				type: 'circle',
				source: SOURCE_ID,
				filter: ['in', ['get', 'tipo'], ['literal', ['inicio', 'ultimo', 'punto']]],
				paint: {
					'circle-color': [
						'match',
						['get', 'tipo'],
						'inicio',
						'#16a34a',
						'ultimo',
						'#2563eb',
						'#ffffff'
					],
					'circle-radius': ['match', ['get', 'tipo'], 'punto', 2.5, 6],
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 2
				}
			});
			mapaListo = true;
			actualizarMapa(true);
		});
	}

	function cambiarSesion(event: Event): void {
		sesionSeleccionadaId = (event.currentTarget as HTMLSelectElement).value;
		encuadre = '';
		requestAnimationFrame(() => actualizarMapa(true));
	}

	onMount(() => {
		void cargar();
		requestAnimationFrame(() => {
			if (MAPBOX_TOKEN) iniciarMapa();
		});
		temporizador = setInterval(() => {
			if (document.visibilityState === 'visible') void cargar();
		}, REFRESCO_MS);
	});

	onDestroy(() => {
		vigente = false;
		if (temporizador) clearInterval(temporizador);
		controlador?.abort();
		mapa?.remove();
		mapa = null;
	});
</script>

{#if mapaCompleto}
	<div class="rt-pantalla" aria-label="Mapa GPS en tiempo real">
		{#if MAPBOX_TOKEN}
			<div class="rt-pantalla__mapa" bind:this={contenedorMapa}></div>
			{#if puntosSesion.length === 0 && sesionActual}
				<div class="rt-pantalla__sin-puntos"><MapPin size={17} /> Aún no hay puntos GPS para esta sesión.</div>
			{/if}
		{:else}
			<div class="rt-pantalla__sin-mapa">
				<MapPin size={22} /><span>Configura Mapbox para visualizar el recorrido.</span>
			</div>
		{/if}

		<div class="rt-pantalla__cabecera">
			<div class="rt-pantalla__estado">
				<span class="rt-punto" class:rt-punto--activo={sesionActual?.estado === 'activa'}></span>
				<div>
					<strong>{sesionActual?.estado === 'activa' ? 'Rastreo activo' : 'Recorrido GPS'}</strong>
					<span class="rt-badge {estadoUltimo.clase}">{estadoUltimo.etiqueta}</span>
				</div>
			</div>
			<div class="rt-pantalla__controles">
				{#if sesiones.length > 1 && sesionActual}
					<label class="rt-selector rt-selector--pantalla">
						<span>Sesión</span>
						<select value={sesionActual.id} onchange={cambiarSesion}>
							{#each sesiones as sesion (sesion.id)}
								<option value={sesion.id}>
									{fecha(sesion.iniciado_at)} — {sesion.estado === 'activa' ? 'Activa' : 'Finalizada'}
								</option>
							{/each}
						</select>
					</label>
				{/if}
				<button
					class="rt-actualizar rt-actualizar--pantalla"
					type="button"
					onclick={() => void cargar()}
					disabled={cargando || actualizando}
				>
					<RefreshCw size={15} class={actualizando ? 'rt-girando' : undefined} aria-hidden="true" />
					<span>{actualizando ? 'Actualizando' : 'Actualizar'}</span>
				</button>
			</div>
		</div>

		{#if cargando}
			<div class="rt-pantalla__mensaje" role="status"><span class="rt-spinner"></span> Cargando recorrido…</div>
		{:else if error || noDisponible || vencido || esVacia}
			<div class="rt-pantalla__mensaje" role="status">
				{#if error}
					{error}
				{:else if noDisponible}
					El recorrido no está disponible para esta sesión o no tienes acceso.
				{:else if vencido}
					El periodo de conservación del recorrido terminó.
				{:else}
					No hay sesiones de rastreo para este servicio.
				{/if}
			</div>
		{:else if sesionActual}
			<div class="rt-pantalla__datos">
				<div><small>Último punto GPS</small><strong>{fecha(ultimoPunto?.capturado_at)}</strong></div>
				<div><small>Velocidad reportada</small><strong>{velocidad(ultimoPunto)}</strong></div>
				<div><small>Consentimiento</small><strong>{fecha(sesionActual.consentimiento_at)}</strong></div>
			</div>
		{/if}
	</div>
{:else}
<div class="rt-seccion">
	<h2 class="rt-seccion__titulo">
		<Route size={18} aria-hidden="true" /> Rastreo GPS del servicio
	</h2>
	<span class="rt-seccion__detalle">Independiente del rastreo Wialon</span>
</div>

<section class="rt-card" aria-label="Rastreo GPS del servicio" aria-live="polite">
	<div class="rt-cabecera">
		<div class="rt-cabecera__titulo">
			<span class="rt-icono"><Radio size={18} aria-hidden="true" /></span>
			<div>
				<strong>Recorrido compartido desde la app</strong>
				<p>
					Acceso del conductor asignado y personal autorizado de Operaciones, Administración, HSEQ,
					Mantenimiento y Talento Humano.
				</p>
			</div>
		</div>
		<button
			class="rt-actualizar"
			type="button"
			onclick={() => void cargar()}
			disabled={cargando || actualizando}
		>
			<RefreshCw size={15} class={actualizando ? 'rt-girando' : undefined} aria-hidden="true" />
			<span>{actualizando ? 'Actualizando' : 'Actualizar'}</span>
		</button>
	</div>

	{#if cargando}
		<div class="rt-vacio" role="status">
			<span class="rt-spinner"></span> Cargando historial de ubicación…
		</div>
	{:else if error}
		<div class="rt-aviso rt-aviso--error" role="alert">
			<p>{error}</p>
			<button class="rt-enlace" type="button" onclick={() => void cargar()}>Reintentar</button>
		</div>
	{:else if noDisponible}
		<div class="rt-vacio">
			<ShieldCheck size={21} aria-hidden="true" />
			<p>El recorrido no está disponible para esta sesión o no tienes acceso.</p>
			<small>El servidor valida los permisos antes de entregar ubicaciones.</small>
		</div>
	{:else if vencido}
		<div class="rt-vacio">
			<Clock3 size={21} aria-hidden="true" />
			<p>El periodo de conservación del recorrido terminó.</p>
			<small>Los datos GPS se conservan durante 90 días.</small>
		</div>
	{:else if esVacia}
		<div class="rt-vacio">
			<MapPin size={21} aria-hidden="true" />
			<p>No hay sesiones de rastreo para este servicio.</p>
			<small>Los registros de más de 90 días dejan de estar disponibles.</small>
		</div>
	{:else if sesionActual}
		<div class="rt-contenido">
			<div class="rt-resumen">
				<div class="rt-resumen__estado">
					<span class="rt-punto" class:rt-punto--activo={sesionActual.estado === 'activa'}></span>
					<strong
						>{sesionActual.estado === 'activa' ? 'Rastreo activo' : 'Rastreo finalizado'}</strong
					>
					<span class="rt-badge {estadoUltimo.clase}">{estadoUltimo.etiqueta}</span>
				</div>
				{#if sesiones.length > 1}
					<label class="rt-selector">
						<span>Sesión</span>
						<select value={sesionActual.id} onchange={cambiarSesion}>
							{#each sesiones as sesion (sesion.id)}
								<option value={sesion.id}>
									{fecha(sesion.iniciado_at)} — {sesion.estado === 'activa'
										? 'Activa'
										: 'Finalizada'}
								</option>
							{/each}
						</select>
					</label>
				{/if}
			</div>

			<div class="rt-mapa-wrap">
				{#if MAPBOX_TOKEN}
					<div class="rt-mapa" bind:this={contenedorMapa} aria-label="Mapa del recorrido GPS"></div>
					{#if puntosSesion.length === 0}
						<div class="rt-mapa-sobre">
							<MapPin size={17} /> Aún no hay puntos para esta sesión.
						</div>
					{/if}
				{:else}
					<div class="rt-mapa-faltante">
						<MapPin size={22} /><span>Configura Mapbox para visualizar el recorrido.</span>
					</div>
				{/if}
			</div>

			<div class="rt-datos">
				<div class="rt-dato">
					<span class="rt-dato__icono"><Clock3 size={15} aria-hidden="true" /></span>
					<div><small>Inicio</small><strong>{fecha(sesionActual.iniciado_at)}</strong></div>
				</div>
				<div class="rt-dato">
					<span class="rt-dato__icono"><MapPin size={15} aria-hidden="true" /></span>
					<div>
						<small>Último punto GPS</small><strong>{fecha(ultimoPunto?.capturado_at)}</strong>
					</div>
				</div>
				<div class="rt-dato">
					<span class="rt-dato__icono"><Radio size={15} aria-hidden="true" /></span>
					<div><small>Velocidad reportada</small><strong>{velocidad(ultimoPunto)}</strong></div>
				</div>
				<div class="rt-dato">
					<span class="rt-dato__icono"><ShieldCheck size={15} aria-hidden="true" /></span>
					<div>
						<small>Consentimiento</small><strong>{fecha(sesionActual.consentimiento_at)}</strong>
					</div>
				</div>
			</div>

			{#if sesionActual.finalizado_at}
				<div class="rt-finalizacion">
					<span>Finalizó {fecha(sesionActual.finalizado_at)}</span>
					<span>{etiquetaMotivo(sesionActual.motivo_finalizacion)}</span>
				</div>
			{/if}
			<p class="rt-nota">
				El historial se conserva durante 90 días. El estado se calcula en el servidor a partir de
				varias lecturas GPS y puede quedar sin señal cuando no llegan puntos nuevos. No se muestran
				coordenadas exactas.
			</p>
		</div>
	{/if}
</section>
{/if}

<style>
	.rt-pantalla {
		position: fixed;
		z-index: 0;
		inset: 0;
		overflow: hidden;
		background: #f4f1e9;
	}
	.rt-pantalla__mapa {
		position: absolute;
		inset: 0;
	}
	.rt-pantalla__sin-mapa {
		display: grid;
		position: absolute;
		inset: 0;
		place-content: center;
		justify-items: center;
		gap: 0.5rem;
		color: #64748b;
		font-size: 0.82rem;
	}
	.rt-pantalla__sin-puntos {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		z-index: 1;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid rgb(255 255 255 / 72%);
		border-radius: 999px;
		background: rgb(255 255 255 / 92%);
		color: #475569;
		font-size: 0.78rem;
		box-shadow: 0 4px 18px rgb(35 31 24 / 12%);
		pointer-events: none;
	}
	.rt-pantalla__cabecera {
		display: flex;
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 2;
		align-items: center;
		gap: 0.75rem;
		padding: 0.55rem;
		border: 1px solid rgb(255 255 255 / 75%);
		border-radius: 0.85rem;
		background: rgb(255 255 255 / 94%);
		box-shadow: 0 5px 22px rgb(35 31 24 / 13%);
		backdrop-filter: blur(14px);
	}
	.rt-pantalla__estado {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0 0.45rem;
	}
	.rt-pantalla__estado > div {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.rt-pantalla__estado strong {
		color: #29251f;
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.rt-pantalla__controles {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.rt-selector--pantalla {
		gap: 0.35rem;
	}
	.rt-selector--pantalla select {
		max-width: 13rem;
		min-height: 2.5rem;
		font-size: 0.75rem;
	}
	.rt-actualizar--pantalla {
		min-height: 2.5rem;
		border-color: #e9dccb;
		color: #7d4a2d;
	}
	.rt-actualizar--pantalla:hover:not(:disabled) {
		background: #fbf4eb;
	}
	.rt-pantalla__datos {
		display: flex;
		position: absolute;
		right: 1rem;
		bottom: 1rem;
		z-index: 2;
		gap: 1rem;
		padding: 0.7rem 0.95rem;
		border: 1px solid rgb(255 255 255 / 75%);
		border-radius: 0.8rem;
		background: rgb(255 255 255 / 94%);
		box-shadow: 0 5px 22px rgb(35 31 24 / 13%);
		backdrop-filter: blur(14px);
	}
	.rt-pantalla__datos small,
	.rt-pantalla__datos strong {
		display: block;
	}
	.rt-pantalla__datos small {
		margin-bottom: 0.18rem;
		color: #7a746d;
		font-size: 0.65rem;
	}
	.rt-pantalla__datos strong {
		color: #29251f;
		font-size: 0.72rem;
		font-weight: 650;
		white-space: nowrap;
	}
	.rt-pantalla__mensaje {
		display: flex;
		position: absolute;
		right: 1rem;
		bottom: 1rem;
		z-index: 2;
		align-items: center;
		gap: 0.5rem;
		max-width: min(31rem, calc(100vw - 2rem));
		padding: 0.75rem 0.9rem;
		border: 1px solid #ead6cb;
		border-radius: 0.75rem;
		background: rgb(255 255 255 / 95%);
		color: #7c3327;
		font-size: 0.78rem;
		box-shadow: 0 5px 22px rgb(35 31 24 / 13%);
	}
	.rt-seccion {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin: 1.5rem 0 0.6rem;
	}
	.rt-seccion__titulo {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin: 0;
		color: #111827;
		font-size: 1rem;
		font-weight: 700;
	}
	.rt-seccion__titulo :global(svg) {
		color: #2563eb;
	}
	.rt-seccion__detalle {
		color: #6b7280;
		font-size: 0.75rem;
	}
	.rt-card {
		overflow: hidden;
		border: 1px solid #e5e7eb;
		border-radius: 0.85rem;
		background: #fff;
		box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
	}
	.rt-cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.1rem;
		border-bottom: 1px solid #f1f5f9;
	}
	.rt-cabecera__titulo {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.rt-cabecera__titulo strong {
		color: #111827;
		font-size: 0.875rem;
	}
	.rt-cabecera__titulo p {
		margin: 0.2rem 0 0;
		color: #6b7280;
		font-size: 0.75rem;
	}
	.rt-icono,
	.rt-dato__icono {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.65rem;
		background: #eff6ff;
		color: #2563eb;
	}
	.rt-actualizar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 2.75rem;
		padding: 0 0.75rem;
		border: 1px solid #dbeafe;
		border-radius: 0.55rem;
		background: #fff;
		color: #1d4ed8;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 650;
		cursor: pointer;
	}
	.rt-actualizar:hover:not(:disabled) {
		background: #eff6ff;
	}
	.rt-actualizar:disabled {
		cursor: wait;
		opacity: 0.65;
	}
	.rt-girando {
		animation: rt-giro 0.9s linear infinite;
	}
	.rt-contenido {
		padding: 1rem 1.1rem 0.9rem;
	}
	.rt-resumen {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.8rem;
	}
	.rt-resumen__estado {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.55rem;
		color: #374151;
		font-size: 0.84rem;
	}
	.rt-punto {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: #9ca3af;
	}
	.rt-punto--activo {
		background: #16a34a;
		box-shadow: 0 0 0 3px #dcfce7;
	}
	.rt-badge {
		display: inline-flex;
		align-items: center;
		min-height: 1.55rem;
		padding: 0.1rem 0.55rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 650;
	}
	.rt-estado--movimiento {
		color: #166534;
		background: #dcfce7;
	}
	.rt-estado--detenido {
		color: #92400e;
		background: #fef3c7;
	}
	.rt-estado--neutro {
		color: #475569;
		background: #f1f5f9;
	}
	.rt-selector {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		color: #6b7280;
		font-size: 0.75rem;
	}
	.rt-selector select {
		min-height: 2.5rem;
		max-width: min(22rem, 55vw);
		padding: 0.35rem 0.6rem;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		background: #fff;
		color: #111827;
		font: inherit;
	}
	.rt-mapa-wrap {
		position: relative;
		overflow: hidden;
		min-height: 15rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.7rem;
		background: #f1f5f9;
	}
	.rt-mapa {
		position: absolute;
		inset: 0;
		min-height: 15rem;
	}
	.rt-mapa-sobre {
		position: absolute;
		inset: auto 0 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.7rem;
		background: rgb(255 255 255 / 90%);
		color: #475569;
		font-size: 0.78rem;
		pointer-events: none;
	}
	.rt-mapa-faltante {
		display: grid;
		min-height: 15rem;
		place-content: center;
		justify-items: center;
		gap: 0.5rem;
		color: #64748b;
		font-size: 0.82rem;
	}
	.rt-datos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.75rem;
		margin-top: 0.85rem;
	}
	.rt-dato {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
		padding: 0.55rem;
		border: 1px solid #f1f5f9;
		border-radius: 0.6rem;
	}
	.rt-dato__icono {
		width: 2rem;
		height: 2rem;
		border-radius: 0.55rem;
	}
	.rt-dato div {
		min-width: 0;
	}
	.rt-dato small,
	.rt-dato strong {
		display: block;
	}
	.rt-dato small {
		margin-bottom: 0.18rem;
		color: #6b7280;
		font-size: 0.7rem;
	}
	.rt-dato strong {
		overflow: hidden;
		color: #1f2937;
		font-size: 0.78rem;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rt-finalizacion {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin-top: 0.75rem;
		color: #475569;
		font-size: 0.75rem;
	}
	.rt-nota {
		margin: 0.75rem 0 0;
		color: #6b7280;
		font-size: 0.7rem;
		line-height: 1.45;
	}
	.rt-vacio {
		display: flex;
		min-height: 8rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 1.25rem;
		color: #64748b;
		text-align: center;
	}
	.rt-vacio p,
	.rt-vacio small {
		margin: 0;
	}
	.rt-vacio p {
		color: #475569;
		font-size: 0.84rem;
	}
	.rt-vacio small {
		font-size: 0.74rem;
	}
	.rt-spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid #dbeafe;
		border-top-color: #2563eb;
		border-radius: 50%;
		animation: rt-giro 0.8s linear infinite;
	}
	.rt-aviso {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		min-height: 7rem;
		padding: 1rem;
		color: #991b1b;
		font-size: 0.82rem;
		text-align: center;
	}
	.rt-aviso p {
		margin: 0;
	}
	.rt-enlace {
		min-height: 2.75rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid #fecaca;
		border-radius: 0.45rem;
		background: #fff;
		color: #991b1b;
		font: inherit;
		cursor: pointer;
	}
	@keyframes rt-giro {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 760px) {
		.rt-pantalla__cabecera {
			top: 0.65rem;
			right: 0.65rem;
			left: 0.65rem;
			justify-content: space-between;
			gap: 0.3rem;
			padding: 0.45rem;
		}
		.rt-pantalla__estado {
			gap: 0.4rem;
			padding: 0 0.25rem;
		}
		.rt-pantalla__estado strong {
			font-size: 0.72rem;
		}
		.rt-selector--pantalla {
			max-width: 9rem;
		}
		.rt-selector--pantalla > span {
			display: none;
		}
		.rt-selector--pantalla select {
			max-width: 8.5rem;
			padding: 0.25rem;
		}
		.rt-actualizar--pantalla {
			width: 2.5rem;
			padding: 0;
		}
		.rt-actualizar--pantalla span {
			display: none;
		}
		.rt-pantalla__datos {
			right: 0.65rem;
			bottom: calc(50vh + 0.75rem);
			left: 0.65rem;
			justify-content: space-between;
			gap: 0.35rem;
			padding: 0.55rem;
		}
		.rt-pantalla__datos small {
			font-size: 0.58rem;
		}
		.rt-pantalla__datos strong {
			font-size: 0.63rem;
		}
		.rt-pantalla__mensaje {
			right: 0.65rem;
			bottom: calc(50vh + 0.75rem);
			left: 0.65rem;
			justify-content: center;
		}
	}
	@media (max-width: 640px) {
		.rt-seccion {
			align-items: flex-start;
			flex-direction: column;
		}
		.rt-cabecera {
			align-items: flex-start;
		}
		.rt-actualizar span {
			display: none;
		}
		.rt-actualizar {
			width: 2.75rem;
			padding: 0;
		}
		.rt-resumen {
			align-items: flex-start;
			flex-direction: column;
		}
		.rt-selector {
			align-items: flex-start;
			flex-direction: column;
			width: 100%;
		}
		.rt-selector select {
			width: 100%;
			max-width: none;
		}
		.rt-mapa-wrap,
		.rt-mapa,
		.rt-mapa-faltante {
			min-height: 12rem;
		}
	}
</style>
