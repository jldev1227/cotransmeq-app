<script lang="ts">
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import {
		getEstadoText,
		getEstadoColor,
		formatDateTime,
		type ServicioConRelaciones,
		type Municipio,
		type RecargoPlanillaResumen
	} from '$lib/types/servicios';
	import { toast } from '$lib/stores/toast';
	import PopoverChip from '$lib/components/ui/PopoverChip.svelte';

	type Props = {
		servicios: ServicioConRelaciones[];
		loadingInicial: boolean;
		cargandoMas: boolean;
		hasMore: boolean;
		totalGeneral: number;
		sortField?: string;
		sortDirection?: 'asc' | 'desc';
		onRefresh?: () => void | Promise<void>;
		onLoadMore?: () => void | Promise<void>;
		onSort?: (field: string, direction: 'asc' | 'desc') => void;
	};

	let {
		servicios,
		loadingInicial,
		cargandoMas,
		hasMore,
		totalGeneral,
		sortField = '',
		sortDirection = 'desc',
		onRefresh,
		onLoadMore,
		onSort
	}: Props = $props();

	let sentinelEl: HTMLDivElement | null = $state(null);
	let observer: IntersectionObserver | null = null;

	$effect(() => {
		if (!sentinelEl) return;
		if (observer) observer.disconnect();

		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && hasMore && !cargandoMas && !loadingInicial) {
						onLoadMore?.();
					}
				}
			},
			{ rootMargin: '200px 0px' }
		);
		observer.observe(sentinelEl);

		return () => observer?.disconnect();
	});

	function divipol(m: Municipio | undefined | null): string {
		if (!m) return '—';
		const dep = String(m.codigo_departamento ?? '').padStart(2, '0');
		const mun = String(m.codigo_municipio ?? '').padStart(5, '0');
		return `${dep}${mun}`;
	}

	function dash(value: string | number | null | undefined): string {
		if (value === null || value === undefined || value === '') return '—';
		return String(value);
	}

	function shortId(id: string): string {
		return id?.slice(0, 8)?.toUpperCase() ?? '—';
	}

	function resumenObservaciones(obs: string | null | undefined): string {
		if (!obs) return '';
		return obs.replace(/\s+/g, ' ').trim();
	}

	function getRecargo(s: ServicioConRelaciones): RecargoPlanillaResumen | null {
		const lista = s.recargos_planillas;
		if (!lista || lista.length === 0) return null;
		return lista[0] ?? null;
	}

	function toNum(v: unknown): number | null {
		if (v === null || v === undefined || v === '') return null;
		const n = typeof v === 'string' ? Number(v) : (v as number);
		return Number.isFinite(n) ? (n as number) : null;
	}

	function formatDecimal(v: unknown, suffix: string = ''): string {
		const n = toNum(v);
		if (n === null) return '—';
		return `${n}${suffix}`;
	}

	function formatSiNo(v: boolean | null | undefined): string {
		if (v === null || v === undefined) return '—';
		return v ? 'Sí' : 'No';
	}

	function diffDias(
		inicio: string | Date | null | undefined,
		fin: string | Date | null | undefined
	): number | null {
		if (!inicio || !fin) return null;
		const a = new Date(inicio).getTime();
		const b = new Date(fin).getTime();
		if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
		const diff = Math.max(0, Math.round((b - a) / 86_400_000));
		return diff;
	}

	function kmData(s: ServicioConRelaciones): {
		ini: number | null;
		fin: number | null;
		total: number | null;
	} {
		const r = getRecargo(s);
		const dias = r?.dias_laborales_planillas ?? [];
		if (dias.length === 0) return { ini: null, fin: null, total: null };
		let ini: number | null = null;
		let fin: number | null = null;
		for (const d of dias) {
			const kmi = toNum(d.kilometraje_inicial);
			const kmf = toNum(d.kilometraje_final);
			if (kmi !== null && (ini === null || kmi < ini)) ini = kmi;
			if (kmf !== null && (fin === null || kmf > fin)) fin = kmf;
		}
		const total = ini !== null && fin !== null && fin >= ini ? fin - ini : null;
		return { ini, fin, total };
	}

	const PROPOSITO_SERVICIO_LABELS: Record<string, string> = {
		personal: 'TRANSPORTE DE PERSONAL',
		personal_y_herramienta: 'TRANSPORTE DE PERSONAL Y HERRAMIENTA',
		'personal y herramienta': 'TRANSPORTE DE PERSONAL Y HERRAMIENTA'
	};

	const CALIFICACION_COLORS: Record<string, 'emerald' | 'amber' | 'red' | 'slate'> = {
		EXCELENTE: 'emerald',
		excelente: 'emerald',
		BUENO: 'emerald',
		bueno: 'emerald',
		REGULAR: 'amber',
		regular: 'amber',
		MALO: 'red',
		malo: 'red',
		DEFICIENTE: 'red',
		deficiente: 'red'
	};

	const ESTADO_CONDUCTOR_LABELS: Record<string, string> = {
		optimo: '✅ Óptimo',
		fatigado: '😴 Fatigado',
		regular: '😐 Regular',
		malo: '❌ Malo'
	};

	function formatPropositoServicio(v: string | null | undefined): string {
		if (!v) return '—';
		return PROPOSITO_SERVICIO_LABELS[v] ?? dash(v);
	}

	function calificacionColor(v: string | null | undefined): 'emerald' | 'amber' | 'red' | 'slate' {
		if (!v) return 'slate';
		return CALIFICACION_COLORS[v] ?? 'slate';
	}

	function formatEstadoConductor(v: string | null | undefined): string {
		if (!v) return '—';
		const key = v.toLowerCase();
		return ESTADO_CONDUCTOR_LABELS[key] ?? v;
	}

	function buildRecargosURL(
		planilla: string,
		mes: number | null | undefined,
		anio: number | null | undefined
	): string {
		const params = new URLSearchParams();
		params.set('search', planilla);
		if (mes != null) params.set('mes', String(mes));
		if (anio != null) params.set('anio', String(anio));
		return `/dashboard/recargos?${params.toString()}`;
	}

	function verDetalle(id: string) {
		goto(`/dashboard/servicios/${id}`);
	}

	function exportarCSV() {
		if (servicios.length === 0) {
			toast.warning('No hay servicios para exportar');
			return;
		}
		const headers = COLUMNAS.map((c) => c.label);
		const filas = servicios.map((s) => COLUMNAS.map((c) => c.value(s)).map((v) => escaparCSV(v)));
		const lineas = [headers, ...filas]
			.map((fila) => fila.map((celda) => `"${celda}"`).join(','))
			.join('\r\n');
		const blob = new Blob(['\uFEFF' + lineas], {
			type: 'text/csv;charset=utf-8;'
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		const fecha = new Date().toISOString().slice(0, 10);
		a.download = `servicios-canvas-${fecha}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		toast.success(`${servicios.length} servicios exportados a CSV`);
	}

	function escaparCSV(valor: unknown): string {
		const str = valor === null || valor === undefined ? '' : String(valor);
		return str.replace(/"/g, '""');
	}

	type Columna = {
		key: string;
		label: string;
		minWidth: string;
		maxWidth?: string;
		align?: 'left' | 'center' | 'right';
		value: (s: ServicioConRelaciones) => string;
		href?: (s: ServicioConRelaciones) => string | null;
		external?: boolean;
		mono?: boolean;
		truncate?: boolean;
		sortable?: boolean;
	};

	function handleSort(col: Columna) {
		if (!col.sortable || !onSort) return;
		if (sortField === col.key) {
			// Toggle: misma columna → invertir dirección
			onSort(col.key, sortDirection === 'asc' ? 'desc' : 'asc');
		} else {
			// Columna nueva → default DESC (más reciente / mayor primero)
			onSort(col.key, 'desc');
		}
	}

	function isSorted(col: Columna, dir: 'asc' | 'desc'): boolean {
		return sortField === col.key && sortDirection === dir;
	}

	const COLUMNAS: Columna[] = [
		{
			key: 'id',
			label: '# SOLICITUD',
			minWidth: '135px',
			mono: true,
			sortable: true,
			value: (s) => shortId(s.id),
			href: (s) => `/dashboard/servicios/${s.id}`
		},
		{
			key: 'fecha_solicitud',
			label: 'FECHA DE SOLICITUD',
			minWidth: '150px',
			sortable: true,
			value: (s) => formatDateTime(s.fecha_solicitud)
		},
		{
			key: 'fecha_realizacion',
			label: 'FECHA DE EJECUCIÓN',
			minWidth: '150px',
			sortable: true,
			value: (s) => (s.fecha_realizacion ? formatDateTime(s.fecha_realizacion) : '—')
		},
		{
			key: 'tiempo_plan',
			label: 'TIEMPO PLANIF. (DÍAS)',
			minWidth: '120px',
			align: 'center',
			sortable: true,
			value: (s) => {
				const d = diffDias(s.fecha_solicitud, s.fecha_realizacion);
				return d === null ? '—' : String(d);
			}
		},
		{
			key: 'dias_serv',
			label: 'N° DÍAS SERVICIO',
			minWidth: '100px',
			align: 'center',
			sortable: true,
			value: (s) => dash(getRecargo(s)?.numero_dias_servicio)
		},
		{
			key: 'cliente',
			label: 'CLIENTE',
			minWidth: '120px',
			maxWidth: '220px',
			truncate: true,
			sortable: true,
			value: (s) => dash(s.cliente?.nombre)
		},
		{
			key: 'objeto',
			label: 'OBSERVACIONES',
			minWidth: '120px',
			maxWidth: '300px',
			truncate: true,
			sortable: true,
			value: (s) => resumenObservaciones(s.observaciones)
		},
		{
			key: 'mun_origen',
			label: 'MUNICIPIO ORIGEN',
			minWidth: '120px',
			maxWidth: '180px',
			truncate: true,
			sortable: true,
			value: (s) => dash(s.origen?.nombre_municipio)
		},
		{
			key: 'div_origen',
			label: 'DIVIPOL ORIGEN',
			minWidth: '110px',
			mono: true,
			sortable: true,
			value: (s) => divipol(s.origen)
		},
		{
			key: 'orig_esp',
			label: 'ORIGEN ESPECÍFICO',
			minWidth: '120px',
			maxWidth: '200px',
			truncate: true,
			sortable: true,
			value: (s) => dash(s.origen_especifico)
		},
		{
			key: 'mun_dest',
			label: 'MUNICIPIO DESTINO',
			minWidth: '120px',
			maxWidth: '180px',
			truncate: true,
			sortable: true,
			value: (s) => dash(s.destino?.nombre_municipio)
		},
		{
			key: 'div_dest',
			label: 'DIVIPOL DESTINO',
			minWidth: '110px',
			mono: true,
			sortable: true,
			value: (s) => divipol(s.destino)
		},
		{
			key: 'dest_esp',
			label: 'DESTINO ESPECÍFICO',
			minWidth: '120px',
			maxWidth: '200px',
			truncate: true,
			sortable: true,
			value: (s) => dash(s.destino_especifico)
		},
		{
			key: 'tiempo_disp',
			label: 'TIEMPO DISP. (HORAS)',
			minWidth: '120px',
			align: 'center',
			sortable: true,
			value: (s) => formatDecimal(getRecargo(s)?.tiempo_disponibilidad_horas, ' h')
		},
		{
			key: 'dur_trayecto',
			label: 'DURACIÓN TRAYECTO',
			minWidth: '130px',
			align: 'center',
			sortable: true,
			value: (s) => formatDecimal(getRecargo(s)?.duracion_trayecto_horas, ' h')
		},
		{
			key: 'tipo',
			label: 'TIPO',
			minWidth: '100px',
			sortable: true,
			value: (s) => formatPropositoServicio(s.proposito_servicio as string)
		},
		{
			key: 'placa',
			label: 'PLACA',
			minWidth: '90px',
			mono: true,
			sortable: true,
			value: (s) => dash(s.vehiculo?.placa)
		},
		{
			key: 'estado',
			label: 'ESTADO',
			minWidth: '110px',
			sortable: true,
			value: (s) => getEstadoText(s.estado)
		},
		{
			key: 'conductor',
			label: 'NOMBRE Y APELLIDO',
			minWidth: '130px',
			maxWidth: '250px',
			truncate: true,
			sortable: true,
			value: (s) =>
				s.conductor ? `${dash(s.conductor.nombre)} ${dash(s.conductor.apellido)}`.trim() : '—'
		},
		{
			key: 'est_cond',
			label: 'EST. CONDUCTOR / DESC.',
			minWidth: '130px',
			sortable: true,
			value: (s) => formatEstadoConductor(getRecargo(s)?.estado_conductor ?? null)
		},
		{
			key: 'trocha',
			label: 'TROCHA',
			minWidth: '80px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.via_trocha ?? null)
		},
		{
			key: 'afirmado',
			label: 'AFIRMADO',
			minWidth: '90px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.via_afirmado ?? null)
		},
		{
			key: 'mixto',
			label: 'MIXTO',
			minWidth: '75px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.via_mixto ?? null)
		},
		{
			key: 'pavimentada',
			label: 'PAVIMENTADA',
			minWidth: '100px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.via_pavimentada ?? null)
		},
		{
			key: 'fuente',
			label: 'FUENTE DE CONSULTA',
			minWidth: '140px',
			sortable: true,
			value: (s) => dash(getRecargo(s)?.fuente_consulta)
		},
		{
			key: 'desniveles',
			label: 'DESNIVELES',
			minWidth: '100px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.riesgo_desniveles ?? null)
		},
		{
			key: 'desliz',
			label: 'DESLIZAMIENTOS',
			minWidth: '115px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.riesgo_deslizamientos ?? null)
		},
		{
			key: 'sena',
			label: 'AUSENCIA SEÑALIZ.',
			minWidth: '125px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.riesgo_sin_senalizacion ?? null)
		},
		{
			key: 'animales',
			label: 'ANIMALES EN VÍA',
			minWidth: '115px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.riesgo_animales ?? null)
		},
		{
			key: 'peatones',
			label: 'PEATONES',
			minWidth: '90px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.riesgo_peatones ?? null)
		},
		{
			key: 'trafico',
			label: 'ALTOS NIVELES TRÁFICO',
			minWidth: '140px',
			align: 'center',
			value: (s) => formatSiNo(getRecargo(s)?.riesgo_trafico_alto ?? null)
		},
		{
			key: 'km_ini',
			label: 'KM INICIAL',
			minWidth: '90px',
			align: 'right',
			sortable: true,
			value: (s) => {
				const { ini } = kmData(s);
				return ini === null ? '—' : new Intl.NumberFormat('es-CO').format(ini);
			}
		},
		{
			key: 'km_fin',
			label: 'KM FINAL',
			minWidth: '85px',
			align: 'right',
			sortable: true,
			value: (s) => {
				const { fin } = kmData(s);
				return fin === null ? '—' : new Intl.NumberFormat('es-CO').format(fin);
			}
		},
		{
			key: 'km_total',
			label: 'KM TOTAL',
			minWidth: '85px',
			align: 'right',
			sortable: true,
			value: (s) => {
				const { total } = kmData(s);
				return total === null ? '—' : new Intl.NumberFormat('es-CO').format(total);
			}
		},
		{
			key: 'calif',
			label: 'CALIFICACIÓN',
			minWidth: '105px',
			align: 'center',
			sortable: true,
			value: (s) => dash(getRecargo(s)?.calificacion_servicio)
		},
		{
			key: 'planilla',
			label: '# PLANILLA',
			minWidth: '120px',
			mono: true,
			sortable: true,
			value: (s) => dash(s.numero_planilla ?? getRecargo(s)?.numero_planilla),
			href: (s) => {
				const r = getRecargo(s);
				const planilla = s.numero_planilla ?? r?.numero_planilla ?? null;
				if (!planilla) return null;
				return buildRecargosURL(planilla, r?.mes ?? null, r?.a_o ?? null);
			},
			external: true
		}
	];

	const totalAncho = COLUMNAS.reduce((acc, c) => {
		const min = parseInt(c.minWidth);
		const max = c.maxWidth ? parseInt(c.maxWidth) : min;
		return acc + Math.max(min, max);
	}, 0);
</script>

<div class="flex min-h-0 flex-1 flex-col" in:fly={{ y: 12, duration: 400, delay: 100 }}>
	<div class="table-card flex min-h-0 flex-1 flex-col overflow-hidden">
		<div
			class="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[rgba(0,0,0,0.06)] bg-[#fcfcfb] px-5 py-3"
		>
			<div class="flex items-center gap-3">
				<span class="eyebrow">Modo Canvas · Sin límite</span>
				<span
					class="font-mono-meta text-[10px] text-[#6B6B6B]"
					style="text-transform: none; letter-spacing: 0.04em;"
				>
					{#if loadingInicial}
						Cargando lote inicial…
					{:else}
						{servicios.length} de {totalGeneral}
						{servicios.length === 1 ? 'servicio' : 'servicios'} ·
						{COLUMNAS.length} columnas
					{/if}
				</span>
			</div>

			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={exportarCSV}
					disabled={loadingInicial || cargandoMas || servicios.length === 0}
					class="btn-secondary"
					title="Exportar a CSV"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"
						/>
					</svg>
					Exportar CSV
				</button>

				<button
					type="button"
					onclick={() => onRefresh?.()}
					disabled={loadingInicial || cargandoMas}
					class="btn-icon"
					title="Refrescar"
					aria-label="Refrescar servicios"
				>
					<svg
						class="h-4 w-4 {loadingInicial || cargandoMas ? 'animate-spin' : ''}"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
						/>
					</svg>
				</button>
			</div>
		</div>

		{#if loadingInicial}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12">
				<div class="spinner"></div>
				<p class="text-sm text-[#6B6B6B]">Cargando lote inicial de servicios…</p>
			</div>
		{:else if servicios.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
				<div
					class="flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white"
				>
					<svg
						class="h-7 w-7 text-[#9A9A9A]"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="1.8"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M3.75 9.75h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5M6 5.25h12a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5H6a1.5 1.5 0 01-1.5-1.5v-12a1.5 1.5 0 011.5-1.5z"
						/>
					</svg>
				</div>
				<div>
					<h3 class="font-display text-lg text-[#1A1A1A]">No hay servicios para mostrar</h3>
					<p class="mt-1 text-sm text-[#6B6B6B]">
						Ajusta los filtros en la vista de lista o crea un nuevo servicio.
					</p>
				</div>
			</div>
		{:else}
			<div class="relative min-h-0 flex-1 overflow-auto" style="background-color: #ffffff;">
				<table
					class="border-collapse text-[12px] text-[#1A1A1A]"
					style="min-width: {totalAncho}px;"
				>
					<thead class="sticky top-0 z-20">
						<tr>
							<th
								class="sticky left-0 z-30 border-r border-b border-[rgba(0,0,0,0.08)] bg-white px-3 py-2.5 text-left align-bottom shadow-[2px_0_4px_rgba(0,0,0,0.04)]"
								style="min-width: {COLUMNAS[0].minWidth};"
							>
								<button
									type="button"
									class="flex w-full items-center justify-between gap-1.5 text-left {COLUMNAS[0].sortable
										? 'cursor-pointer hover:text-[#f97316] transition-colors'
										: 'cursor-default'}"
									onclick={() => handleSort(COLUMNAS[0])}
									disabled={!COLUMNAS[0].sortable}
									title={COLUMNAS[0].sortable ? 'Click para ordenar' : ''}
								>
									<span class="code-badge"># SOLICITUD</span>
									{#if isSorted(COLUMNAS[0], 'asc')}
										<svg
											class="h-3 w-3 flex-shrink-0 text-[#f97316]"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											stroke-width="2.5"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
										</svg>
									{:else if isSorted(COLUMNAS[0], 'desc')}
										<svg
											class="h-3 w-3 flex-shrink-0 text-[#f97316]"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											stroke-width="2.5"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
										</svg>
									{/if}
								</button>
							</th>
							{#each COLUMNAS.slice(1) as col (col.key)}
								<th
									class="border-r border-b border-[rgba(0,0,0,0.06)] bg-[#fcfcfb] px-3 py-2.5 align-bottom whitespace-nowrap"
									style="min-width: {col.minWidth};"
								>
									<button
										type="button"
										class="flex w-full items-center gap-1.5 {col.sortable
											? 'cursor-pointer hover:text-[#f97316] transition-colors'
											: 'cursor-default'} {col.align === 'center'
											? 'justify-center'
											: col.align === 'right'
												? 'justify-end'
												: 'justify-start'}"
										onclick={() => handleSort(col)}
										disabled={!col.sortable}
										title={col.sortable ? 'Click para ordenar' : ''}
									>
										<span class="font-mono-meta text-[10px] leading-tight text-[#6B6B6B]">
											{col.label}
										</span>
										{#if isSorted(col, 'asc')}
											<svg
												class="h-3 w-3 flex-shrink-0 text-[#f97316]"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												stroke-width="2.5"
											>
												<path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
											</svg>
										{:else if isSorted(col, 'desc')}
											<svg
												class="h-3 w-3 flex-shrink-0 text-[#f97316]"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
												stroke-width="2.5"
											>
												<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
											</svg>
										{/if}
									</button>
								</th>
							{/each}
						</tr>
					</thead>

					<tbody>
						{#each servicios as servicio, idx (servicio.id || `tmp-${idx}`)}
							{@const isPar = idx % 2 === 1}
							<tr
								class="table-row border-b border-[rgba(0,0,0,0.04)] align-top uppercase {isPar
									? 'bg-[#fcfcfb]/40'
									: 'bg-white'}"
							>
								<td
									class="sticky left-0 z-10 border-r border-[rgba(0,0,0,0.08)] px-3 py-2 {isPar
										? 'bg-[#fcfcfb]'
										: 'bg-white'} group-hover:bg-[rgba(249, 115, 22,0.05)] shadow-[2px_0_4px_rgba(0,0,0,0.04)]"
									style="min-width: {COLUMNAS[0].minWidth};"
								>
									{#if COLUMNAS[0].href}
										{@const hrefVal = COLUMNAS[0].value(servicio)}
										{@const hrefUrl =
											hrefVal === '—' ? null : (COLUMNAS[0].href?.(servicio) ?? null)}
										{#if hrefUrl}
											<a
												href={hrefUrl}
												class="chip-link"
												onclick={(e) => e.stopPropagation()}
												title="Ver detalle del servicio"
											>
												{hrefVal}
											</a>
										{:else}
											<span class="text-[#C7C7C7]">—</span>
										{/if}
									{:else}
										<span
											class="font-mono-meta text-[11px] tracking-wider text-[#f97316]"
											style="text-transform: uppercase; letter-spacing: 0.08em;"
										>
											{COLUMNAS[0].value(servicio)}
										</span>
									{/if}
								</td>

								{#each COLUMNAS.slice(1) as col, ci (col.key)}
									<td
										class="border-r border-[rgba(0,0,0,0.04)] px-3 py-2 align-top {col.align ===
										'center'
											? 'text-center'
											: col.align === 'right'
												? 'text-right'
												: 'text-left'} {col.truncate ? 'max-w-0' : ''}"
										style="min-width: {col.minWidth};{col.maxWidth
											? ` max-width: ${col.maxWidth};`
											: ''}"
									>
										{#if col.href}
											{@const hrefVal = col.value(servicio)}
											{@const hrefUrl = hrefVal === '—' ? null : (col.href?.(servicio) ?? null)}
											{#if hrefUrl}
												<a
													href={hrefUrl}
													class="chip-link"
													onclick={(e) => e.stopPropagation()}
													title={col.external
														? 'Ir a recargos (filtrado)'
														: 'Ver detalle del servicio'}
												>
													{hrefVal}
													{#if col.external}
														<svg
															class="h-2.5 w-2.5 opacity-60"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
															stroke-width="2"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
															/>
														</svg>
													{/if}
												</a>
											{:else}
												<span class="text-[#C7C7C7]">—</span>
											{/if}
										{:else if col.key === 'estado'}
											{@const color = getEstadoColor(servicio.estado)}
											<span
												class="status-pill"
												style="background-color: {color}1A; color: {color}; border: 1px solid {color}40;"
											>
												{col.value(servicio)}
											</span>
										{:else if col.mono}
											<span
												class="font-mono-meta block text-[11px] whitespace-nowrap text-[#1A1A1A]"
												style="text-transform: none; letter-spacing: 0.02em;"
											>
												{col.value(servicio)}
											</span>
										{:else if col.value(servicio) === '—'}
											<span class="text-[#C7C7C7]">—</span>
										{:else if col.key === 'objeto'}
											<PopoverChip
												text={col.value(servicio)}
												maxLength={60}
												color="amber"
												label="Observaciones completas"
											/>
										{:else if col.key === 'tipo'}
											{@const tipoVal = col.value(servicio)}
											<span
												class="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-orange-800"
												title={tipoVal}
											>
												{tipoVal}
											</span>
										{:else if col.key === 'calif'}
											{@const calVal = col.value(servicio)}
											{@const calColor = calificacionColor(calVal)}
											<span
												class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide {calColor ===
												'emerald'
													? 'border-orange-200 bg-orange-50 text-orange-800'
													: calColor === 'amber'
														? 'border-amber-200 bg-amber-50 text-amber-800'
														: calColor === 'red'
															? 'border-red-200 bg-red-50 text-red-800'
															: 'border-slate-200 bg-slate-50 text-slate-700'}"
												title={calVal}
											>
												{calVal}
											</span>
										{:else if col.truncate}
											<span
												class="block truncate text-[12px] leading-snug text-[#1A1A1A]"
												title={col.value(servicio)}
											>
												{col.value(servicio)}
											</span>
										{:else if ['trocha', 'afirmado', 'mixto', 'pavimentada', 'desniveles', 'desliz', 'sena', 'animales', 'peatones', 'trafico'].includes(col.key)}
											{@const siNoVal = col.value(servicio)}
											<span
												class="inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-[11px] font-bold tracking-wide {siNoVal ===
												'Sí'
													? 'border-orange-200 bg-orange-100 text-orange-700'
													: siNoVal === 'No'
														? 'border-red-200 bg-red-100 text-red-700'
														: 'border-slate-200 bg-slate-50 text-slate-500'}"
												title={siNoVal}
											>
												{siNoVal}
											</span>
										{:else}
											<span class="block text-[12px] leading-snug whitespace-nowrap text-[#1A1A1A]">
												{col.value(servicio)}
											</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>

				<div
					bind:this={sentinelEl}
					class="sticky bottom-0 left-0 z-20 flex h-16 w-full items-center justify-center border-t border-[rgba(0,0,0,0.04)] bg-[#fcfcfb]/95 backdrop-blur"
				>
					{#if cargandoMas}
						<div class="flex items-center gap-2 text-[#6B6B6B]">
							<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>
							<span
								class="font-mono-meta text-[10px]"
								style="text-transform: none; letter-spacing: 0.04em;"
							>
								Cargando 20 más…
							</span>
						</div>
					{:else if hasMore}
						<button
							type="button"
							onclick={() => onLoadMore?.()}
							class="apple-transition flex items-center gap-2 rounded-xl border border-[rgba(249, 115, 22,0.25)] bg-white px-4 py-1.5 text-xs font-semibold text-[#166534] hover:border-[rgba(249, 115, 22,0.4)] hover:bg-[rgba(249, 115, 22,0.06)]"
						>
							<svg
								class="h-3.5 w-3.5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 4.5v15m0 0l-6-6m6 6l6-6M5.25 5.25h13.5"
								/>
							</svg>
							Cargar 20 más
						</button>
					{:else}
						<span
							class="font-mono-meta text-[10px] text-[#9A9A9A]"
							style="text-transform: none; letter-spacing: 0.04em;"
						>
							— Has llegado al final · {servicios.length} de {totalGeneral} servicios —
						</span>
					{/if}
				</div>
			</div>

			<div
				class="flex flex-shrink-0 items-center justify-between border-t border-[rgba(0,0,0,0.06)] bg-[#fcfcfb] px-5 py-2.5"
			>
				<p
					class="font-mono-meta text-[10px] text-[#6B6B6B]"
					style="text-transform: none; letter-spacing: 0.04em;"
				>
					Sin límite · Carga incremental cada 20 al hacer scroll · Click en fila para ver detalle
				</p>
				<p
					class="font-mono-meta text-[10px] text-[#f97316]"
					style="text-transform: none; letter-spacing: 0.04em;"
				>
					{servicios.length}/{totalGeneral} servicios · {COLUMNAS.length} columnas
				</p>
			</div>
		{/if}
	</div>
</div>
