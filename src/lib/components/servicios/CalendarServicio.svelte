<script lang="ts">
	/**
	 * Vista de calendario de la gestión de servicios.
	 *
	 * Una sola tarjeta: arriba la barra del mes (navegación, con qué fecha se
	 * ubica cada servicio y el resumen por estado), debajo la cuadrícula y, al
	 * elegir un día, su lista a la derecha. Pulsar un servicio abre la vista
	 * rápida (`ModalDetalleServicio`).
	 *
	 * Antes encima iban siete tarjetas de colores con los mismos conteos que ya
	 * tiene la cabecera de la página, el selector de fecha estaba oculto y el
	 * detalle salía en un drawer cortado contra el borde.
	 */
	import { browser } from '$app/environment';
	import { ChevronLeft, ChevronRight, X } from 'lucide-svelte';
	import CustomCalendar from '$lib/components/common/CustomCalendar.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import ResumenConteos from '$lib/components/listing/ResumenConteos.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import ModalDetalleServicio from './ModalDetalleServicio.svelte';
	import { obtenerFestivosCompletos } from '$lib/utils/festivosColombia';
	import {
		getEstadoColor,
		getEstadoText,
		type EstadoServicio,
		type ServicioConRelaciones
	} from '$lib/types/servicios';
	import { toast } from '$lib/stores/toast';
	import { serviciosStore } from '$lib/stores/servicios';

	type CampoFecha = 'fecha_solicitud' | 'fecha_realizacion' | 'fecha_finalizacion';

	type FiltrosAplicados = {
		estado: EstadoServicio | '';
		conductorId?: string;
		vehiculoId?: string;
		clienteId?: string;
	};

	type Props = {
		mes: number;
		anio: number;
		campoFecha: CampoFecha;
		filtros: FiltrosAplicados;
		/** La búsqueda de la página: el calendario solo muestra lo que coincide. */
		coincide?: (servicio: ServicioConRelaciones) => boolean;
		puedeEditar?: boolean;
		onMesAnioChange: (mes: number, anio: number) => void;
		onCampoFechaChange: (campo: CampoFecha) => void;
		onEditar: (servicio: ServicioConRelaciones) => void;
		onEliminar: (servicio: ServicioConRelaciones) => void;
	};

	let {
		mes = $bindable(),
		anio = $bindable(),
		campoFecha = $bindable(),
		filtros,
		coincide,
		puedeEditar = false,
		onMesAnioChange,
		onCampoFechaChange,
		onEditar,
		onEliminar
	}: Props = $props();

	let loading = $state(false);
	let servicios = $state<ServicioConRelaciones[]>([]);
	let servicioAbierto = $state<ServicioConRelaciones | null>(null);
	let diaSeleccionado = $state<string | null>(null);
	let fetchToken = 0;

	const MESES = [
		'Enero',
		'Febrero',
		'Marzo',
		'Abril',
		'Mayo',
		'Junio',
		'Julio',
		'Agosto',
		'Septiembre',
		'Octubre',
		'Noviembre',
		'Diciembre'
	];
	const CAMPOS: { valor: CampoFecha; etiqueta: string }[] = [
		{ valor: 'fecha_solicitud', etiqueta: 'Solicitud' },
		{ valor: 'fecha_realizacion', etiqueta: 'Realización' },
		{ valor: 'fecha_finalizacion', etiqueta: 'Finalización' }
	];
	const ESTADOS: EstadoServicio[] = [
		'solicitado',
		'planificado',
		'en_curso',
		'realizado',
		'cancelado',
		'liquidado'
	];

	const festivos = $derived(obtenerFestivosCompletos(anio));
	const visibles = $derived(coincide ? servicios.filter(coincide) : servicios);

	/// El día y la hora salen de la MISMA fecha local. Antes el día se tomaba
	/// del ISO en UTC y la hora en hora de Colombia: un servicio del 6 a las
	/// 23:53 aparecía en la casilla del 7 con «23:53».
	function instante(s: ServicioConRelaciones): Date | null {
		const raw = s[campoFecha] || s.fecha_solicitud;
		const d = raw ? new Date(raw) : null;
		return d && !Number.isNaN(d.getTime()) ? d : null;
	}
	const claveLocal = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

	const eventosPorDia = $derived.by(() => {
		const map = new Map<string, ServicioConRelaciones[]>();
		for (const s of visibles) {
			const d = instante(s);
			if (!d) continue;
			const key = claveLocal(d);
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(s);
		}
		for (const lista of map.values()) {
			lista.sort((x, y) => (instante(x)?.getTime() ?? 0) - (instante(y)?.getTime() ?? 0));
		}
		return map;
	});

	const eventosDelDia = $derived(diaSeleccionado ? (eventosPorDia.get(diaSeleccionado) ?? []) : []);

	/// Resumen del mes visible: solo los estados que tienen algo.
	const conteosMes = $derived.by(() => {
		const n = new Map<string, number>();
		for (const s of visibles) n.set(s.estado, (n.get(s.estado) ?? 0) + 1);
		return [
			{ clave: 'total', etiqueta: 'En el mes', valor: visibles.length },
			...ESTADOS.filter((e) => n.get(e)).map((e) => ({
				clave: e,
				etiqueta: getEstadoText(e),
				valor: n.get(e)!,
				color: getEstadoColor(e)
			}))
		];
	});

	async function cargarServiciosCalendario() {
		if (!browser) return;
		const tokenActual = ++fetchToken;
		loading = true;
		try {
			const params = new URLSearchParams({
				mes: String(mes + 1),
				anio: String(anio),
				campo_fecha: campoFecha
			});
			if (filtros.estado) params.set('estado', filtros.estado);
			if (filtros.conductorId) params.set('conductor_id', filtros.conductorId);
			if (filtros.vehiculoId) params.set('vehiculo_id', filtros.vehiculoId);
			if (filtros.clienteId) params.set('cliente_id', filtros.clienteId);

			const baseURL = import.meta.env.VITE_API_URL;
			const token = localStorage.getItem('transmeralda_token');
			const res = await fetch(`${baseURL}/api/servicios/calendar?${params}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : undefined
			});

			if (tokenActual !== fetchToken) return;
			if (!res.ok) throw new Error(`Error ${res.status}`);

			const json = await res.json();
			if (!json.success) throw new Error(json.error || 'Error desconocido');
			servicios = json.data?.servicios ?? [];
		} catch (err) {
			if (tokenActual === fetchToken) {
				console.error('Error cargando calendario:', err);
				toast.error('Error al cargar el calendario: ' + (err instanceof Error ? err.message : ''));
				servicios = [];
			}
		} finally {
			if (tokenActual === fetchToken) loading = false;
		}
	}

	$effect(() => {
		void mes;
		void anio;
		void campoFecha;
		void filtros.estado;
		void filtros.conductorId;
		void filtros.vehiculoId;
		void filtros.clienteId;
		cargarServiciosCalendario();
	});

	function cambiarMes(delta: number) {
		const d = new Date(anio, mes + delta, 1);
		diaSeleccionado = null;
		onMesAnioChange(d.getMonth(), d.getFullYear());
	}

	function irHoy() {
		const t = new Date();
		onMesAnioChange(t.getMonth(), t.getFullYear());
		diaSeleccionado = null;
	}

	const esMesActual = $derived(mes === new Date().getMonth() && anio === new Date().getFullYear());

	async function compartir(servicio: ServicioConRelaciones) {
		try {
			let token = servicio.share_token;
			if (!token) token = (await serviciosStore.generarShareToken(servicio.id)) || undefined;
			if (!token) {
				toast.error('Error al generar enlace compartible');
				return;
			}
			await navigator.clipboard.writeText(`${window.location.origin}/public/servicio/${token}`);
			toast.success('Enlace copiado al portapapeles');
		} catch (err) {
			console.error('Error generando token:', err);
			toast.error('No se pudo copiar el enlace');
		}
	}

	function hora(s: ServicioConRelaciones): string {
		const raw = s[campoFecha] || s.fecha_solicitud;
		if (!raw) return '—';
		return new Intl.DateTimeFormat('es-CO', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(raw));
	}
</script>

<div class="cal">
	<!-- ═══ Barra del mes ═══ -->
	<div class="cal-barra">
		<div class="cal-nav">
			<button
				type="button"
				class="cal-flecha"
				onclick={() => cambiarMes(-1)}
				aria-label="Mes anterior"
			>
				<ChevronLeft size={18} />
			</button>
			<h2 class="cal-mes">{MESES[mes]} <span>{anio}</span></h2>
			<button
				type="button"
				class="cal-flecha"
				onclick={() => cambiarMes(1)}
				aria-label="Mes siguiente"
			>
				<ChevronRight size={18} />
			</button>
			<button type="button" class="btn-secondary cal-hoy" onclick={irHoy} disabled={esMesActual}>
				Hoy
			</button>
		</div>
		<SegmentosFiltro
			etiqueta="Ubicar por"
			opciones={CAMPOS}
			valor={campoFecha}
			onCambiar={(v) => {
				diaSeleccionado = null;
				onCampoFechaChange(v as CampoFecha);
			}}
		/>
	</div>

	{#if !loading}
		<div class="cal-resumen">
			<ResumenConteos conteos={conteosMes} />
			<span class="cal-leyenda">
				<span class="cal-leyenda-hoy"></span> Hoy
				<span class="cal-leyenda-festivo"></span> Festivo
			</span>
		</div>
	{/if}

	<!-- ═══ Cuadrícula + panel del día ═══ -->
	<div class="cal-cuerpo">
		<div class="cal-grilla">
			{#if loading}
				<CargaMascota texto="Cargando servicios del mes…" />
			{:else}
				<CustomCalendar
					{mes}
					{anio}
					{eventosPorDia}
					{festivos}
					{campoFecha}
					{diaSeleccionado}
					onEventClick={(s) => (servicioAbierto = s)}
					onDayClick={(k) => (diaSeleccionado = diaSeleccionado === k ? null : k)}
				/>
			{/if}
		</div>

		{#if diaSeleccionado}
			<aside class="cal-dia" aria-label="Servicios del día">
				<header class="cal-dia-cabeza">
					<div>
						<p class="cal-dia-fecha">
							{new Intl.DateTimeFormat('es-CO', {
								weekday: 'long',
								day: 'numeric',
								month: 'long'
							}).format(new Date(diaSeleccionado + 'T00:00:00'))}
						</p>
						<small
							>{eventosDelDia.length}
							{eventosDelDia.length === 1 ? 'servicio' : 'servicios'}</small
						>
					</div>
					<button
						type="button"
						class="cal-flecha"
						onclick={() => (diaSeleccionado = null)}
						aria-label="Cerrar el día"
					>
						<X size={16} />
					</button>
				</header>
				<div class="cal-dia-lista">
					{#if eventosDelDia.length === 0}
						<p class="cal-dia-vacio">Sin servicios este día.</p>
					{:else}
						{#each eventosDelDia as s (s.id)}
							<button
								type="button"
								class="cal-dia-item"
								style="--c: {getEstadoColor(s.estado)}"
								onclick={() => (servicioAbierto = s)}
							>
								<span class="cal-dia-hora">{hora(s)}</span>
								<span class="cal-dia-texto">
									<strong
										>{s.origen_especifico || s.origen?.nombre_municipio || '—'} → {s.destino_especifico ||
											s.destino?.nombre_municipio ||
											'—'}</strong
									>
									<EstadoPunto
										etiqueta={getEstadoText(s.estado)}
										color={getEstadoColor(s.estado)}
										apagado={s.estado === 'cancelado'}
									/>
									<small>
										{#if s.vehiculo?.placa}<b>{s.vehiculo.placa}</b> ·{/if}
										{s.conductor
											? `${s.conductor.nombre} ${s.conductor.apellido ?? ''}`
											: 'Sin conductor'}
									</small>
									{#if s.cliente?.nombre}<small>{s.cliente.nombre}</small>{/if}
								</span>
							</button>
						{/each}
					{/if}
				</div>
			</aside>
		{/if}
	</div>
</div>

<ModalDetalleServicio
	servicio={servicioAbierto}
	{puedeEditar}
	oncerrar={() => (servicioAbierto = null)}
	oneditar={(s) => {
		servicioAbierto = null;
		onEditar(s);
	}}
	oncompartir={compartir}
	oneliminar={(s) => {
		servicioAbierto = null;
		onEliminar(s);
	}}
/>

<style>
	.cal {
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 22px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
		overflow: hidden;
	}

	/* ── Barra del mes ── */
	.cal-barra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1.25rem;
		padding: 0.9rem 1.1rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.cal-nav {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.cal-mes {
		min-width: 10.5rem;
		margin: 0;
		text-align: center;
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--text-primary);
	}
	.cal-mes span {
		font-weight: 600;
		color: var(--text-muted);
	}
	.cal-flecha {
		display: inline-grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.cal-flecha:hover {
		background: var(--bg-base);
		color: var(--text-primary);
	}
	.cal-hoy {
		margin-left: 6px;
	}
	.cal-hoy:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.cal-resumen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding: 0.6rem 1.1rem;
		border-bottom: 1px solid var(--border-subtle);
		background: var(--bg-base);
	}
	.cal-leyenda {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.cal-leyenda-hoy,
	.cal-leyenda-festivo {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--accion);
	}
	.cal-leyenda-festivo {
		margin-left: 8px;
		background: #dc2626;
	}

	/* ── Cuerpo ── */
	.cal-cuerpo {
		display: flex;
		min-height: 0;
		flex: 1;
	}
	.cal-grilla {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	/* ── Panel del día ── */
	.cal-dia {
		display: flex;
		flex-direction: column;
		width: 20rem;
		flex-shrink: 0;
		border-left: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-base) 60%, var(--bg-surface));
	}
	.cal-dia-cabeza {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
		padding: 0.9rem 1rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.cal-dia-fecha {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 800;
		color: var(--text-primary);
	}
	.cal-dia-fecha::first-letter {
		text-transform: uppercase;
	}
	.cal-dia-cabeza small {
		font-size: 0.76rem;
		color: var(--text-muted);
	}
	.cal-dia-lista {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0.75rem;
		overflow-y: auto;
	}
	.cal-dia-vacio {
		margin: 0;
		padding: 2rem 0;
		text-align: center;
		font-size: 0.84rem;
		color: var(--text-muted);
	}
	.cal-dia-item {
		display: flex;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--border-subtle);
		border-left: 3px solid var(--c);
		border-radius: 12px;
		background: var(--bg-surface);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			background 0.15s,
			box-shadow 0.15s;
	}
	.cal-dia-item:hover {
		background: color-mix(in srgb, var(--c) 6%, var(--bg-surface));
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
	}
	.cal-dia-hora {
		flex-shrink: 0;
		font-size: 0.8rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}
	.cal-dia-texto {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		min-width: 0;
	}
	.cal-dia-texto strong {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.84rem;
		color: var(--text-primary);
	}
	.cal-dia-texto small {
		font-size: 0.74rem;
		color: var(--text-muted);
	}
	.cal-dia-texto b {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--text-secondary);
	}

	/* En pantallas angostas el día va debajo, no al lado. */
	@media (max-width: 900px) {
		.cal-cuerpo {
			flex-direction: column;
		}
		.cal-dia {
			width: auto;
			border-left: 0;
			border-top: 1px solid var(--border-subtle);
		}
	}
</style>
