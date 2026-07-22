<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { obtenerFestivosCompletos } from '$lib/utils/festivosColombia';
	import { toast } from '$lib/stores/toast';
	import { apiClient } from '$lib/api/apiClient';

	export type TipoDia = 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';

	export interface SegmentoCalendario {
		id: string;
		cliente_id: string | null;
		cliente_nombre: string | null;
		vehiculo_id: string | null;
		vehiculo_placa: string;
		hora_inicio: string;
		hora_fin: string;
		horas_conducidas: number;
		orden: number;
	}

	export interface RegistroDiaCalendario {
		id: string;
		fecha: string;
		tipo: TipoDia;
		observaciones: string | null;
		segmentos_count: number;
		segmentos: SegmentoCalendario[];
		conductor: { id: string; nombre: string; apellido: string; numero_identificacion: string } | null;
	}

	type Props = {
		mes: number;
		anio: number;
		conductorId?: string;
		refreshKey?: number;
		onMesAnioChange: (mes: number, anio: number) => void;
	};

	let { mes, anio, conductorId, refreshKey, onMesAnioChange }: Props = $props();

	const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
	const MESES = [
		'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
		'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
	];

	let loading = $state(false);
	let registros = $state<RegistroDiaCalendario[]>([]);
	let diaSeleccionado = $state<string | null>(null);
	let fetchToken = 0;

	const COLOR_POR_TIPO: Record<TipoDia, { bg: string; text: string; border: string; dot: string; label: string }> = {
		LABORADO:      { bg: '#ea580c15', text: '#047857', border: '#ea580c40', dot: '#ea580c', label: 'Laborado' },
		DISPONIBLE:    { bg: '#2563eb15', text: '#1d4ed8', border: '#2563eb40', dot: '#2563eb', label: 'Disponible' },
		DESCANSO:      { bg: '#d9770615', text: '#b45309', border: '#d9770640', dot: '#d97706', label: 'Descanso' },
		MANTENIMIENTO: { bg: '#dc262615', text: '#b91c1c', border: '#dc262640', dot: '#dc2626', label: 'Mantenimiento' }
	};

	let festivos = $derived(obtenerFestivosCompletos(anio));

	let eventosPorDia = $derived.by(() => {
		const map = new Map<string, RegistroDiaCalendario[]>();
		for (const r of registros) {
			if (!r.fecha) continue;
			const key = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : '';
			if (!key) continue;
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(r);
		}
		return map;
	});

	let eventosDelDia = $derived(diaSeleccionado ? (eventosPorDia.get(diaSeleccionado) || []) : []);

	let statsMes = $derived.by(() => {
		const base = { total: registros.length, laborados: 0, disponibles: 0, descansos: 0, mantenimiento: 0 };
		for (const r of registros) {
			if (r.tipo === 'LABORADO') base.laborados++;
			else if (r.tipo === 'DISPONIBLE') base.disponibles++;
			else if (r.tipo === 'DESCANSO') base.descansos++;
			else if (r.tipo === 'MANTENIMIENTO') base.mantenimiento++;
		}
		return base;
	});

	function yyyymmdd(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	function isToday(d: Date): boolean {
		const t = new Date();
		return d.getFullYear() === t.getFullYear()
			&& d.getMonth() === t.getMonth()
			&& d.getDate() === t.getDate();
	}

	function buildGrid(mes: number, anio: number) {
		const firstDay = new Date(anio, mes, 1).getDay();
		const daysInMonth = new Date(anio, mes + 1, 0).getDate();
		const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
		const cells: Array<{ date: Date | null; inMonth: boolean }> = [];
		for (let i = 0; i < firstDay; i++) cells.push({ date: null, inMonth: false });
		for (let day = 1; day <= daysInMonth; day++) {
			cells.push({ date: new Date(anio, mes, day), inMonth: true });
		}
		while (cells.length < totalCells) cells.push({ date: null, inMonth: false });
		return cells;
	}

	let grid = $derived(buildGrid(mes, anio));
	let today = new Date();
	let todayKey = $derived(yyyymmdd(today));

	async function cargarCalendario() {
		if (!browser) return;
		const tokenActual = ++fetchToken;
		loading = true;
		try {
			const params: any = { mes: mes + 1, anio };
			if (conductorId) params.conductor_id = conductorId;
			const res = await apiClient.get('/api/dias-laborados/calendar-admin', { params });
			if (tokenActual !== fetchToken) return;
			if (res.data?.success) {
				registros = res.data.data?.registros ?? [];
			} else {
				throw new Error(res.data?.message || 'Error desconocido');
			}
		} catch (err: any) {
			if (tokenActual === fetchToken) {
				console.error('Error cargando calendario días laborados:', err);
				toast.error('Error al cargar el calendario: ' + (err?.response?.data?.message || err.message || ''));
				registros = [];
			}
		} finally {
			if (tokenActual === fetchToken) loading = false;
		}
	}

	$effect(() => {
		void mes; void anio; void conductorId; void refreshKey;
		cargarCalendario();
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
		const key = `${y}-${m}-${d}`;
		diaSeleccionado = diaSeleccionado === key ? null : key;
	}

	function colorForTipo(t: TipoDia) {
		return COLOR_POR_TIPO[t] || COLOR_POR_TIPO.LABORADO;
	}

	function nombreConductor(c: RegistroDiaCalendario['conductor']) {
		if (!c) return '—';
		return `${c.nombre} ${c.apellido}`.trim();
	}
</script>

<div class="flex h-full min-h-0 flex-col gap-3">

	<!-- Stats cards -->
	<div class="grid flex-shrink-0 grid-cols-2 gap-2 lg:grid-cols-5" in:fly={{ y: 8, duration: 250 }}>
		<div class="glass soft-shadow rounded-xl border border-gray-200/50 p-2.5">
			<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Total del mes</p>
			<p class="mt-0.5 text-lg font-bold text-gray-900 tabular-nums">{statsMes.total}</p>
			<p class="text-[9px] text-gray-400">{MESES[mes]} {anio}</p>
		</div>

		<div class="glass soft-shadow rounded-xl border border-orange-200/50 p-2.5" style="border-top: 3px solid #ea580c">
			<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Laborados</p>
			<p class="mt-0.5 text-lg font-bold text-orange-600 tabular-nums">{statsMes.laborados}</p>
		</div>

		<div class="glass soft-shadow rounded-xl border p-2.5" style="border-top: 3px solid #2563eb">
			<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Disponibles</p>
			<p class="mt-0.5 text-lg font-bold text-blue-600 tabular-nums">{statsMes.disponibles}</p>
		</div>

		<div class="glass soft-shadow rounded-xl border p-2.5" style="border-top: 3px solid #d97706">
			<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Descansos</p>
			<p class="mt-0.5 text-lg font-bold text-amber-600 tabular-nums">{statsMes.descansos}</p>
		</div>

		<div class="glass soft-shadow rounded-xl border p-2.5" style="border-top: 3px solid #dc2626">
			<p class="text-[9px] font-medium uppercase tracking-wide text-gray-500">Mantenimiento</p>
			<p class="mt-0.5 text-lg font-bold text-red-600 tabular-nums">{statsMes.mantenimiento}</p>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 gap-3">
		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			{#if loading}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
					<div class="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
					<p class="text-sm text-gray-500">Cargando días laborados...</p>
				</div>
			{:else}
				<div class="glass soft-shadow flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/50">
					<!-- Header del calendario -->
					<div class="flex flex-shrink-0 items-center justify-between border-b border-gray-100 bg-gray-50/60 px-4 py-3">
						<div class="flex items-center gap-2">
							<button onclick={() => cambiarMes(-1)}
								class="apple-transition rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:border-orange-200 hover:bg-orange-50"
								aria-label="Mes anterior">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
								</svg>
							</button>
							<div class="min-w-[180px] text-center">
								<h2 class="text-base font-bold text-gray-900">{MESES[mes]} {anio}</h2>
							</div>
							<button onclick={() => cambiarMes(1)}
								class="apple-transition rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:border-orange-200 hover:bg-orange-50"
								aria-label="Mes siguiente">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
								</svg>
							</button>
							<button onclick={irHoy}
								class="apple-transition rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-orange-200 hover:bg-orange-50">
								Hoy
							</button>
						</div>
						<div class="flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
							<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:#ea580c"></span> Laborado</span>
							<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:#2563eb"></span> Disponible</span>
							<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:#d97706"></span> Descanso</span>
							<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:#dc2626"></span> Mant.</span>
							<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-red-400"></span> Festivo</span>
						</div>
					</div>

					<!-- Días de la semana -->
					<div class="grid grid-cols-7 border-b border-gray-100 bg-gray-50/95 backdrop-blur-sm">
						{#each DIAS_SEMANA as d}
							<div class="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500">{d}</div>
						{/each}
					</div>

					<!-- Grid de días -->
					<div class="grid min-h-0 flex-1 grid-cols-7 overflow-auto">
						{#each grid as cell, i (i)}
							{#if !cell.date}
								<div class="border-b border-r border-gray-100 bg-gray-50/30 min-h-[6.5rem]"></div>
							{:else}
								{@const dateKey = yyyymmdd(cell.date)}
								{@const eventos = eventosPorDia.get(dateKey) || []}
								{@const festivo = festivos.find(f => f.fechaCompleta === dateKey)}
								{@const isCurrentDay = dateKey === todayKey}
								{@const isSelected = diaSeleccionado === dateKey}
								<button
									type="button"
									onclick={() => handleDayClick(cell.date!)}
									class="group relative flex min-h-[6.5rem] flex-col gap-0.5 border-b border-r border-gray-100 p-1.5 text-left apple-transition
										bg-white
										{isSelected ? 'ring-2 ring-inset ring-orange-500' : ''}
										hover:bg-orange-50/40"
									in:fade={{ duration: 150, delay: i * 3 }}
								>
									<div class="flex items-center justify-between">
										<span class="text-xs font-semibold
											{festivo ? 'text-red-600' : 'text-gray-900'}
											{isCurrentDay ? 'flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-white' : ''}">
											{cell.date.getDate()}
										</span>
										{#if festivo}
											<span class="truncate text-[9px] font-medium text-red-500" title={festivo.nombre}>
												{festivo.nombre.length > 8 ? festivo.nombre.substring(0, 8) + '…' : festivo.nombre}
											</span>
										{/if}
									</div>

									{#each eventos.slice(0, 3) as ev (ev.id)}
										{@const c = colorForTipo(ev.tipo)}
										{@const seg0 = ev.segmentos?.[0]}
										<div
											class="flex w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-[10px] font-medium truncate apple-transition"
											style="background-color: {c.bg}; border-color: {c.border}; color: {c.text}"
											title="{c.label} — {nombreConductor(ev.conductor)}{seg0?.cliente_nombre ? ' · ' + seg0.cliente_nombre : ''}{seg0?.vehiculo_placa ? ' · ' + seg0.vehiculo_placa : ''}"
										>
											<span class="h-1.5 w-1.5 flex-shrink-0 rounded-full" style="background-color: {c.dot}"></span>
											<span class="truncate">
												<span class="font-semibold">{nombreConductor(ev.conductor)}</span>
												{#if ev.tipo === 'LABORADO' && ev.segmentos_count > 0}
													<span class="ml-1 inline-flex h-3.5 min-w-[0.9rem] items-center justify-center rounded-full bg-white/60 px-1 text-[8px] font-bold" style="color: {c.text}">
														{ev.segmentos_count}
													</span>
												{/if}
											</span>
										</div>
									{/each}

									{#if eventos.length > 3}
										<span class="text-[9px] font-medium text-gray-400">+{eventos.length - 3} más</span>
									{/if}
								</button>
							{/if}
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Aside: día seleccionado -->
		{#if diaSeleccionado}
			<aside class="glass soft-shadow flex w-80 flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200/50" in:fly={{ x: 20, duration: 200 }}>
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
							<p class="text-xs text-gray-500">Sin registros este día</p>
						</div>
					{:else}
						<div class="space-y-1.5">
							{#each eventosDelDia as ev (ev.id)}
								{@const c = colorForTipo(ev.tipo)}
								<div class="rounded-lg border bg-white p-2" style="border-color: {c.border}">
									<div class="flex items-center justify-between">
										<span class="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
											style="background-color: {c.bg}; border-color: {c.border}; color: {c.text}">
											<span class="h-1 w-1 rounded-full" style="background-color: {c.dot}"></span>
											{c.label}
										</span>
										{#if ev.tipo === 'LABORADO' && ev.segmentos_count > 0}
											<span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-600"
												title="Tramos/cambios de cliente/vehículo en este día">
												<svg class="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
												</svg>
												{ev.segmentos_count} {ev.segmentos_count === 1 ? 'tramo' : 'tramos'}
											</span>
										{/if}
									</div>
									<p class="mt-1.5 truncate text-xs font-semibold text-gray-900">
										👤 {nombreConductor(ev.conductor)}
									</p>
									{#if ev.conductor?.numero_identificacion}
										<p class="text-[10px] text-gray-400">CC {ev.conductor.numero_identificacion}</p>
									{/if}
									{#if ev.tipo === 'LABORADO' && ev.segmentos?.length > 0}
										<div class="mt-1.5 space-y-1 border-t border-gray-100 pt-1.5">
											{#each ev.segmentos as seg (seg.id)}
												<div class="rounded bg-gray-50/70 p-1.5">
													<div class="flex items-center justify-between">
														<span class="font-mono text-[10px] font-semibold text-orange-700">🚚 {seg.vehiculo_placa}</span>
														<span class="text-[9px] text-gray-500">{seg.horas_conducidas}h</span>
													</div>
													<p class="text-[10px] text-gray-500">🕐 {seg.hora_inicio} – {seg.hora_fin}</p>
													{#if seg.cliente_nombre}
														<p class="truncate text-[10px] text-gray-600" title={seg.cliente_nombre}>🏢 {seg.cliente_nombre}</p>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
									{#if ev.tipo !== 'LABORADO' && ev.observaciones}
										<p class="mt-1 truncate text-[10px] text-gray-500" title={ev.observaciones}>📝 {ev.observaciones}</p>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</aside>
		{/if}
	</div>
</div>
