<script lang="ts">
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { createEventDispatcher } from 'svelte';

	export let periodoInicio: string = '';
	export let periodoFin: string = '';
	export let fechasSeleccionadas: string[] = [];

	const dispatch = createEventDispatcher<{ change: string[] }>();

	let viewYear: number;
	let viewMonth: number; // 0-indexed

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

	$: minDate = periodoInicio ? new Date(periodoInicio + 'T00:00:00') : null;
	$: maxDate = periodoFin ? new Date(periodoFin + 'T00:00:00') : null;

	$: calendarDays = buildCalendarDays(viewYear, viewMonth);

	$: selectedSet = new Set(fechasSeleccionadas);

	const MESES = [
		'enero',
		'febrero',
		'marzo',
		'abril',
		'mayo',
		'junio',
		'julio',
		'agosto',
		'septiembre',
		'octubre',
		'noviembre',
		'diciembre'
	];
	const diasSemana = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];

	function buildCalendarDays(
		year: number,
		month: number
	): Array<{ date: Date; day: number; inMonth: boolean; dateStr: string }> {
		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0);

		let startDow = firstDay.getDay() - 1;
		if (startDow < 0) startDow = 6;

		const days: Array<{ date: Date; day: number; inMonth: boolean; dateStr: string }> = [];

		for (let i = 0; i < startDow; i++) {
			const d = new Date(year, month, -(startDow - 1 - i));
			days.push({ date: d, day: d.getDate(), inMonth: false, dateStr: formatDateStr(d) });
		}

		for (let d = 1; d <= lastDay.getDate(); d++) {
			const date = new Date(year, month, d);
			days.push({ date, day: d, inMonth: true, dateStr: formatDateStr(date) });
		}

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
		if (!minDate && !maxDate) return true;
		const d = new Date(dateStr + 'T00:00:00').getTime();
		if (minDate && d < minDate.getTime()) return false;
		if (maxDate && d > maxDate.getTime()) return false;
		return true;
	}

	function isSelected(dateStr: string): boolean {
		return fechasSeleccionadas.includes(dateStr);
	}

	function toggleDate(dateStr: string) {
		if (!isInRange(dateStr)) return;
		let newFechas: string[];
		if (fechasSeleccionadas.includes(dateStr)) {
			newFechas = fechasSeleccionadas.filter((f) => f !== dateStr);
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
		return `${MESES[month] || ''} ${year}`;
	}

	function isToday(dateStr: string): boolean {
		const today = new Date();
		return dateStr === formatDateStr(today);
	}
</script>

<div class="calendar-wrap">
	<!-- Navigation header -->
	<div class="mb-3 flex items-center justify-between">
		<button
			type="button"
			on:click={prevMonth}
			class="calendar-nav-btn"
			aria-label="Mes anterior"
		>
			<ChevronLeft />
		</button>
		<span class="calendar-month-label">
			{monthLabel(viewYear, viewMonth)}
		</span>
		<button
			type="button"
			on:click={nextMonth}
			class="calendar-nav-btn"
			aria-label="Mes siguiente"
		>
			<ChevronRight />
		</button>
	</div>

	<!-- Day headers -->
	<div class="mb-1.5 grid grid-cols-7 gap-1">
		{#each diasSemana as dia}
			<div class="calendar-day-head">{dia}</div>
		{/each}
	</div>

	<!-- Calendar grid -->
	<div class="grid grid-cols-7 gap-1">
		{#each calendarDays as cell (cell.dateStr)}
			{@const selected = selectedSet.has(cell.dateStr)}
			{@const today = isToday(cell.dateStr)}
			{@const inRange = isInRange(cell.dateStr)}
			<button
				type="button"
				on:click={() => toggleDate(cell.dateStr)}
				disabled={!inRange}
				class="calendar-cell"
				class:is-out-of-month={!cell.inMonth}
				class:is-today={today && !selected && cell.inMonth}
				class:is-selected={selected}
				class:is-disabled={!inRange}
				aria-label={`${cell.day} de ${MESES[viewMonth]} de ${viewYear}`}
				aria-pressed={selected}
			>
				{cell.day}
			</button>
		{/each}
	</div>

	<!-- Footer: count -->
	{#if fechasSeleccionadas.length > 0}
		<div class="calendar-footer">
			<div class="calendar-footer-meta">
				<span class="calendar-footer-dot" aria-hidden="true"></span>
				<span class="calendar-footer-count">
					{fechasSeleccionadas.length}
					día{fechasSeleccionadas.length !== 1 ? 's' : ''} seleccionado{fechasSeleccionadas.length !== 1 ? 's' : ''}
				</span>
			</div>
			<span class="calendar-footer-hint">Pernote</span>
		</div>
	{/if}
</div>
