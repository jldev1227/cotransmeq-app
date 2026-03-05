<script lang="ts">
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { createEventDispatcher } from 'svelte';

	export let periodoInicio: string = '';
	export let periodoFin: string = '';
	export let fechasSeleccionadas: string[] = [];

	const dispatch = createEventDispatcher<{ change: string[] }>();

	// Current calendar view month/year
	let viewYear: number;
	let viewMonth: number; // 0-indexed

	// Initialize view to the start of the period (only once)
	let initialized = false;
	$: {
		if (!initialized && periodoInicio) {
			const d = new Date(periodoInicio + 'T00:00:00');
			viewYear = d.getFullYear();
			viewMonth = d.getMonth();
			initialized = true;
		} else if (!initialized && !periodoInicio) {
			const now = new Date();
			viewYear = now.getFullYear();
			viewMonth = now.getMonth();
			initialized = true;
		}
	}

	// Compute min/max allowed dates from periodo
	$: minDate = periodoInicio ? new Date(periodoInicio + 'T00:00:00') : null;
	$: maxDate = periodoFin ? new Date(periodoFin + 'T00:00:00') : null;

	// Build the calendar grid for the current view
	$: calendarDays = buildCalendarDays(viewYear, viewMonth);

	// Create a reactive Set from fechasSeleccionadas so template re-renders on change
	$: selectedSet = new Set(fechasSeleccionadas);

	const diasSemana = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];

	function buildCalendarDays(year: number, month: number): Array<{ date: Date; day: number; inMonth: boolean; dateStr: string }> {
		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0);

		// Monday = 0, Sunday = 6
		let startDow = firstDay.getDay() - 1;
		if (startDow < 0) startDow = 6;

		const days: Array<{ date: Date; day: number; inMonth: boolean; dateStr: string }> = [];

		// Fill blanks before month start
		for (let i = 0; i < startDow; i++) {
			const d = new Date(year, month, -(startDow - 1 - i));
			days.push({ date: d, day: d.getDate(), inMonth: false, dateStr: formatDateStr(d) });
		}

		// Days of the month
		for (let d = 1; d <= lastDay.getDate(); d++) {
			const date = new Date(year, month, d);
			days.push({ date, day: d, inMonth: true, dateStr: formatDateStr(date) });
		}

		// Fill remaining to complete 6 rows (42 cells) or at least full weeks
		const remaining = 42 - days.length;
		for (let i = 1; i <= remaining; i++) {
			const d = new Date(year, month + 1, i);
			days.push({ date: d, day: d.getDate(), inMonth: false, dateStr: formatDateStr(d) });
		}

		return days;
	}

	function formatDateStr(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	function isInRange(dateStr: string): boolean {
		return true;
	}

	function isSelected(dateStr: string): boolean {
		return fechasSeleccionadas.includes(dateStr);
	}

	function toggleDate(dateStr: string) {
		let newFechas: string[];
		if (fechasSeleccionadas.includes(dateStr)) {
			newFechas = fechasSeleccionadas.filter(f => f !== dateStr);
		} else {
			newFechas = [...fechasSeleccionadas, dateStr].sort();
		}

		fechasSeleccionadas = newFechas;
		dispatch('change', newFechas);
	}

	function prevMonth() {
		if (viewMonth === 0) {
			viewMonth = 11;
			viewYear--;
		} else {
			viewMonth--;
		}
	}

	function nextMonth() {
		if (viewMonth === 11) {
			viewMonth = 0;
			viewYear++;
		} else {
			viewMonth++;
		}
	}

	function monthLabel(year: number, month: number): string {
		const d = new Date(year, month, 1);
		return d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
	}

	function isToday(dateStr: string): boolean {
		const today = new Date();
		return dateStr === formatDateStr(today);
	}
</script>

<div class="w-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
	<!-- Navigation header -->
	<div class="mb-4 flex items-center justify-between">
		<button
			type="button"
			on:click={prevMonth}
			class="rounded-lg p-1.5 text-gray-500 hover:bg-orange-50 hover:text-orange-700 transition-colors"
		>
			<ChevronLeft class="h-5 w-5" />
		</button>
		<span class="text-sm font-bold capitalize text-gray-800">
			{monthLabel(viewYear, viewMonth)}
		</span>
		<button
			type="button"
			on:click={nextMonth}
			class="rounded-lg p-1.5 text-gray-500 hover:bg-orange-50 hover:text-orange-700 transition-colors"
		>
			<ChevronRight class="h-5 w-5" />
		</button>
	</div>

	<!-- Day headers -->
	<div class="mb-2 grid grid-cols-7 gap-1">
		{#each diasSemana as dia}
			<div class="rounded-md bg-orange-600 py-1.5 text-center text-xs font-bold text-white">{dia}</div>
		{/each}
	</div>

	<!-- Calendar grid -->
	<div class="grid grid-cols-7 gap-1">
		{#each calendarDays as cell}
			{@const selected = selectedSet.has(cell.dateStr)}
			{@const today = isToday(cell.dateStr)}
			<button
				type="button"
				on:click={() => toggleDate(cell.dateStr)}
				class="relative flex h-9 w-full items-center justify-center rounded-lg text-xs font-medium transition-all duration-150
					{!cell.inMonth ? 'text-gray-400 cursor-pointer hover:bg-orange-50' : ''}
					{cell.inMonth && !selected ? 'text-gray-700 hover:bg-orange-100 hover:text-orange-800 cursor-pointer border border-transparent hover:border-orange-200' : ''}
					{selected ? 'bg-orange-500 text-white font-bold rounded-lg shadow-md ring-2 ring-orange-300 ring-offset-1' : ''}
					{today && !selected ? 'font-bold text-orange-700 ring-2 ring-orange-400 bg-orange-50' : ''}"
			>
				{cell.day}
			</button>
		{/each}
	</div>

	<!-- Footer: count -->
	{#if fechasSeleccionadas.length > 0}
		<div class="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-center">
			<span class="text-sm font-bold text-orange-700">{fechasSeleccionadas.length}</span>
			<span class="text-xs font-medium text-orange-600"> día{fechasSeleccionadas.length !== 1 ? 's' : ''} seleccionado{fechasSeleccionadas.length !== 1 ? 's' : ''}</span>
		</div>
	{/if}
</div>
