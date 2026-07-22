<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import CustomCalendar from '$lib/components/common/CustomCalendar.svelte';
	import DrawerDetalleServicio from './DrawerDetalleServicio.svelte';
	import { obtenerFestivosCompletos } from '$lib/utils/festivosColombia';
	import { getEstadoColor, getEstadoText, type EstadoServicio, type ServicioConRelaciones } from '$lib/types/servicios';
	import { toast } from '$lib/stores/toast';
	import { serviciosStore } from '$lib/stores/servicios';

	type FiltrosAplicados = {
		estado: EstadoServicio | '';
		conductorId?: string;
		vehiculoId?: string;
		clienteId?: string;
	};

	type Props = {
		mes: number;
		anio: number;
		campoFecha: 'fecha_solicitud' | 'fecha_realizacion' | 'fecha_finalizacion';
		filtros: FiltrosAplicados;
		onMesAnioChange: (mes: number, anio: number) => void;
		onCampoFechaChange: (campo: 'fecha_solicitud' | 'fecha_realizacion' | 'fecha_finalizacion') => void;
		onEditar: (servicio: ServicioConRelaciones) => void;
		onEliminar: (servicio: ServicioConRelaciones) => void;
	};

	let {
		mes = $bindable(),
		anio = $bindable(),
		campoFecha = $bindable(),
		filtros,
		onMesAnioChange,
		onCampoFechaChange,
		onEditar,
		onEliminar
	}: Props = $props();

	let loading = $state(false);
	let servicios = $state<ServicioConRelaciones[]>([]);
	let servicioDrawer = $state<ServicioConRelaciones | null>(null);
	let total = $state(0);
	let diaSeleccionado = $state<string | null>(null);
	let fetchToken = 0;

	let festivos = $derived(obtenerFestivosCompletos(anio));

	let eventosPorDia = $derived.by(() => {
		const map = new Map<string, ServicioConRelaciones[]>();
		for (const s of servicios) {
			const fechaRaw = s[campoFecha] || s.fecha_solicitud;
			if (!fechaRaw) continue;
			const key = fechaRaw.split('T')[0];
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(s);
		}
		return map;
	});

	let eventosDelDia = $derived(diaSeleccionado ? (eventosPorDia.get(diaSeleccionado) || []) : []);

	let statsMes = $derived.by(() => {
		const base = {
			total: servicios.length,
			solicitado: 0,
			en_curso: 0,
			planificado: 0,
			realizado: 0,
			cancelado: 0,
			liquidado: 0
		};
		for (const s of servicios) {
			const estado = (s.estado || '').toLowerCase();
			if (estado === 'solicitado') base.solicitado++;
			else if (estado === 'en_curso') base.en_curso++;
			else if (estado === 'planificado') base.planificado++;
			else if (estado === 'realizado') base.realizado++;
			else if (estado === 'cancelado') base.cancelado++;
			else if (estado === 'liquidado') base.liquidado++;
		}
		return base;
	});

	const MESES_NOMBRES = [
		'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
		'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
	];

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

			if (!res.ok) {
				throw new Error(`Error ${res.status}`);
			}

			const json = await res.json();
			if (json.success) {
				servicios = json.data?.servicios ?? [];
				total = json.data?.total ?? 0;
			} else {
				throw new Error(json.error || 'Error desconocido');
			}
		} catch (err) {
			if (tokenActual === fetchToken) {
				console.error('Error cargando calendario:', err);
				toast.error('Error al cargar el calendario: ' + (err instanceof Error ? err.message : ''));
				servicios = [];
				total = 0;
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
		let nuevoMes = mes + delta;
		let nuevoAnio = anio;
		if (nuevoMes < 0) { nuevoMes = 11; nuevoAnio--; }
		else if (nuevoMes > 11) { nuevoMes = 0; nuevoAnio++; }
		onMesAnioChange(nuevoMes, nuevoAnio);
	}

	function irHoy() {
		const t = new Date();
		onMesAnioChange(t.getMonth(), t.getFullYear());
		diaSeleccionado = null;
	}

	function handleDayClick(date: Date) {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		diaSeleccionado = `${y}-${m}-${d}`;
	}

	function abrirDrawer(servicio: ServicioConRelaciones) {
		servicioDrawer = servicio;
	}

	function cerrarDrawer() {
		servicioDrawer = null;
	}

	async function handleTicket(servicio: ServicioConRelaciones) {
		try {
			let token = servicio.share_token;
			if (!token) {
				token = (await serviciosStore.generarShareToken(servicio.id)) || undefined;
			}
			if (!token) {
				toast.error('Error al generar enlace compartible');
				return;
			}
			const shareUrl = `${window.location.origin}/public/servicio/${token}`;
			await navigator.clipboard.writeText(shareUrl);
			toast.success('Enlace copiado al portapapeles');
		} catch (err) {
			console.error('Error generando token:', err);
			toast.error('Error al generar ticket');
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col gap-3">

	<div class="hidden">
		<input type="hidden" bind:value={campoFecha} />
	</div>

	<div class="grid flex-shrink-0 grid-cols-3 gap-2 lg:grid-cols-7" in:fly={{ y: 8, duration: 250 }}>
		<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-2.5">
			<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Total del mes</p>
			<p class="mt-0.5 text-lg font-bold text-gray-900 tabular-nums">{statsMes.total}</p>
			<p class="text-[9px] text-gray-400">{MESES_NOMBRES[mes]} {anio}</p>
		</div>

		<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-2.5">
			<div class="flex items-start justify-between">
				<div>
					<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Solicitados</p>
					<p class="mt-0.5 text-lg font-bold text-blue-600 tabular-nums">{statsMes.solicitado}</p>
				</div>
				<div class="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-blue-400 to-blue-600">
					<svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				</div>
			</div>
		</div>

		<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-2.5">
			<div class="flex items-start justify-between">
				<div>
					<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">En Curso</p>
					<p class="mt-0.5 text-lg font-bold text-amber-600 tabular-nums">{statsMes.en_curso}</p>
				</div>
				<div class="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-amber-600">
					<svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
					</svg>
				</div>
			</div>
		</div>

		<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-2.5">
			<div class="flex items-start justify-between">
				<div>
					<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Planificados</p>
					<p class="mt-0.5 text-lg font-bold text-violet-600 tabular-nums">{statsMes.planificado}</p>
				</div>
				<div class="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-400 to-violet-600">
					<svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
					</svg>
				</div>
			</div>
		</div>

		<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-2.5">
			<div class="flex items-start justify-between">
				<div>
					<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Realizados</p>
					<p class="mt-0.5 text-lg font-bold text-orange-600 tabular-nums">{statsMes.realizado}</p>
				</div>
				<div class="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-orange-400 to-orange-600">
					<svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				</div>
			</div>
		</div>

		<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-2.5">
			<div class="flex items-start justify-between">
				<div>
					<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Cancelados</p>
					<p class="mt-0.5 text-lg font-bold text-red-600 tabular-nums">{statsMes.cancelado}</p>
				</div>
				<div class="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-red-400 to-red-600">
					<svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				</div>
			</div>
		</div>

		<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-2.5">
			<div class="flex items-start justify-between">
				<div>
					<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Liquidados</p>
					<p class="mt-0.5 text-lg font-bold text-cyan-600 tabular-nums">{statsMes.liquidado}</p>
				</div>
				<div class="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-cyan-400 to-cyan-600">
					<svg class="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
				</div>
			</div>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 gap-3">
		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			{#if loading}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
				<div class="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
				<p class="text-sm text-gray-500">Cargando servicios del mes...</p>
			</div>
			{:else}
				<CustomCalendar
					{mes}
					{anio}
					eventosPorDia={eventosPorDia}
					festivos={festivos}
					{diaSeleccionado}
					onPrevMonth={() => cambiarMes(-1)}
					onNextMonth={() => cambiarMes(1)}
					onToday={irHoy}
					onEventClick={abrirDrawer}
					onDayClick={handleDayClick}
				/>
			{/if}
		</div>

		{#if diaSeleccionado}
			<aside class="glass soft-shadow flex w-72 flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200/50" in:fly={{ x: 20, duration: 200 }}>
				<div class="flex items-center justify-between border-b border-gray-100 bg-gray-50/60 px-3 py-2.5">
					<div>
						<p class="text-[10px] font-medium uppercase tracking-wider text-gray-500">Día seleccionado</p>
						<p class="text-sm font-bold text-gray-900">
							{new Date(diaSeleccionado + 'T00:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
						</p>
					</div>
					<button onclick={() => diaSeleccionado = null}
						class="apple-transition rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						aria-label="Cerrar">
						<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="flex-1 overflow-y-auto p-2">
					{#if eventosDelDia.length === 0}
						<div class="flex flex-col items-center justify-center gap-1 py-8 text-center">
							<svg class="h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
							</svg>
							<p class="text-xs text-gray-500">Sin servicios este día</p>
						</div>
					{:else}
						<div class="space-y-1.5">
							{#each eventosDelDia as ev (ev.id)}
								<button onclick={() => abrirDrawer(ev)}
									class="w-full rounded-lg border bg-white p-2 text-left apple-transition hover:border-orange-300 hover:bg-orange-50/40"
									style="border-color: {getEstadoColor(ev.estado)}40">
									<div class="flex items-center justify-between">
										<span class="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
											style="background-color: {getEstadoColor(ev.estado)}15; border-color: {getEstadoColor(ev.estado)}40; color: {getEstadoColor(ev.estado)}">
											<span class="h-1 w-1 rounded-full" style="background-color: {getEstadoColor(ev.estado)}"></span>
											{getEstadoText(ev.estado)}
										</span>
									</div>
									<p class="mt-1.5 truncate text-xs font-semibold text-gray-900">
										{ev.origen_especifico || ev.origen?.nombre_municipio || '—'}
										<span class="text-gray-400">→</span>
										{ev.destino_especifico || ev.destino?.nombre_municipio || '—'}
									</p>
									{#if ev.vehiculo?.placa}
										<p class="mt-0.5 font-mono text-[10px] font-semibold text-orange-700">{ev.vehiculo.placa}</p>
									{/if}
									{#if ev.conductor?.nombre}
										<p class="text-[10px] text-gray-500">{ev.conductor.nombre} {ev.conductor.apellido || ''}</p>
									{/if}
									{#if ev.cliente?.nombre && !ev.vehiculo?.placa && !ev.conductor?.nombre}
										<p class="text-[10px] text-gray-500">{ev.cliente.nombre}</p>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</aside>
		{/if}
	</div>
</div>

<DrawerDetalleServicio
	servicio={servicioDrawer}
	onClose={cerrarDrawer}
	onEdit={(s) => { cerrarDrawer(); onEditar(s); }}
	onTicket={handleTicket}
	onDelete={(s) => { cerrarDrawer(); onEliminar(s); }}
/>
