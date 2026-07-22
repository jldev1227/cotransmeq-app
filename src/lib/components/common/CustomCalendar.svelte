<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import type { FestivoColombiano } from '$lib/utils/festivosColombia';
	import { getEstadoColor, getEstadoText, type EstadoServicio, type ServicioConRelaciones } from '$lib/types/servicios';

	type Props = {
		mes: number;
		anio: number;
		eventosPorDia: Map<string, ServicioConRelaciones[]>;
		festivos: FestivoColombiano[];
		diaSeleccionado?: string | null;
		onPrevMonth: () => void;
		onNextMonth: () => void;
		onToday: () => void;
		onEventClick: (servicio: ServicioConRelaciones) => void;
		onDayClick?: (date: Date) => void;
	};

	let {
		mes,
		anio,
		eventosPorDia,
		festivos,
		diaSeleccionado = null,
		onPrevMonth,
		onNextMonth,
		onToday,
		onEventClick,
		onDayClick
	}: Props = $props();

	const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
	const MESES = [
		'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
		'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
	];

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

	let eventosPorDiaKey = $derived(new Map(eventosPorDia));
</script>

<div class="glass soft-shadow flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/50">

	<div class="flex flex-shrink-0 items-center justify-between border-b border-gray-100 bg-gray-50/60 px-4 py-3">
		<div class="flex items-center gap-2">
			<button onclick={onPrevMonth}
				class="apple-transition rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:border-orange-200 hover:bg-orange-50"
				aria-label="Mes anterior">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
				</svg>
			</button>

			<div class="min-w-[180px] text-center">
				<h2 class="text-base font-bold text-gray-900">
					{MESES[mes]} {anio}
				</h2>
			</div>

			<button onclick={onNextMonth}
				class="apple-transition rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 hover:border-orange-200 hover:bg-orange-50"
				aria-label="Mes siguiente">
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
				</svg>
			</button>

			<button onclick={onToday}
				class="apple-transition rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-orange-200 hover:bg-orange-50">
				Hoy
			</button>
		</div>

		<div class="flex items-center gap-2 text-[10px] text-gray-500">
			<span class="flex items-center gap-1.5">
				<span class="h-2 w-2 rounded-full bg-orange-500"></span>
				Hoy
			</span>
			<span class="flex items-center gap-1.5">
				<span class="h-2 w-2 rounded-full bg-red-400"></span>
				Festivo
			</span>
		</div>
	</div>

	<div class="grid grid-cols-7 border-b border-gray-100 bg-gray-50/95 backdrop-blur-sm">
		{#each DIAS_SEMANA as dia}
			<div class="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500">
				{dia}
			</div>
		{/each}
	</div>

	<div class="grid min-h-0 flex-1 grid-cols-7 overflow-auto">
		{#each grid as cell, i (i)}
			{#if !cell.date}
				<div class="border-b border-r border-gray-100 bg-gray-50/30 min-h-[6.5rem]"></div>
			{:else}
				{@const dateKey = yyyymmdd(cell.date)}
				{@const eventos = eventosPorDiaKey.get(dateKey) || []}
				{@const festivo = festivos.find(f => f.fechaCompleta === dateKey)}
				{@const isCurrentDay = dateKey === todayKey}
				{@const isSelected = diaSeleccionado === dateKey}
				<button
					type="button"
					onclick={() => onDayClick?.(cell.date!)}
					class="group relative flex min-h-[6.5rem] flex-col gap-0.5 border-b border-r border-gray-100 p-1.5 text-left apple-transition
						bg-white
						{isSelected ? 'ring-2 ring-inset ring-orange-500' : ''}
						hover:bg-orange-50/40"
					in:fade={{ duration: 150, delay: i * 4 }}
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
						<div
							role="button"
							tabindex="0"
							onclick={(e) => { e.stopPropagation(); onEventClick(ev); }}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onEventClick(ev); } }}
							class="group/ev flex w-full cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-left text-[10px] font-medium truncate apple-transition hover:scale-[1.02]"
							style="background-color: {getEstadoColor(ev.estado)}15; border-color: {getEstadoColor(ev.estado)}40; color: {getEstadoColor(ev.estado)}"
							title="{getEstadoText(ev.estado)} — {ev.origen_especifico || ev.origen?.nombre_municipio || ''} → {ev.destino_especifico || ev.destino?.nombre_municipio || ''}"
						>
							<span class="h-1.5 w-1.5 flex-shrink-0 rounded-full" style="background-color: {getEstadoColor(ev.estado)}"></span>
							<span class="truncate">
								{#if ev.vehiculo?.placa}
									<span class="font-mono font-semibold">{ev.vehiculo.placa}</span>
								{/if}
								{#if ev.conductor?.nombre}
									{#if ev.vehiculo?.placa} · {/if}
									<span>{ev.conductor.nombre}</span>
								{/if}
								{#if ev.cliente?.nombre && !ev.vehiculo?.placa && !ev.conductor?.nombre}
									<span class="truncate">{ev.cliente.nombre}</span>
								{/if}
							</span>
						</div>
					{/each}

					{#if eventos.length > 3}
						<span class="text-[9px] font-medium text-gray-400">
							+{eventos.length - 3} más
						</span>
					{/if}
				</button>
			{/if}
		{/each}
	</div>
</div>
