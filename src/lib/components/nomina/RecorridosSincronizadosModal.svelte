<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { apiClient } from '$lib/api/apiClient';
	import { toast } from 'svelte-sonner';

	export type TipoDia = 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';

	export interface SegmentoRef {
		id: string;
		registro_dia_id: string;
		orden: number;
		cliente_id: string | null;
		cliente_nombre: string | null;
		vehiculo_id: string | null;
		vehiculo_placa: string;
		hora_inicio: string;
		hora_fin: string;
		horas_conducidas: number;
		km_inicial?: number | null;
		km_final?: number | null;
		pernocte?: boolean | null;
		observaciones: string | null;
	}

	export interface RegistroRef {
		id: string;
		fecha: string;
		tipo: TipoDia | string;
		observaciones: string | null;
		conductor?: { id: string; nombre: string; apellido: string; numero_identificacion: string } | null;
		segmentos: SegmentoRef[];
	}

	export interface FilaReporte {
		fecha: string;
		fechaLabel: string;
		conductor: string;
		actividad: string;
		placa: string;
		descripcion: string;
		hora_inicio: string;
		hora_fin: string;
		km_inicial: number | null;
		km_final: number | null;
		pernocte: string;
		horas_conduccion: number | null;
		cliente: string;
		registro_id: string;
		segmento_id: string | null;
		tiene_bonos: boolean;
		bonos: string[];
	}

	type Props = {
		open: boolean;
		conductorId: string;
		conductorNombre: string;
		desde: string;
		hasta: string;
		/** IDs de (registro_dia_id, segmento_id) que fueron sincronizados — para resaltar */
		clavesSincronizadas?: Array<{ registro_dia_id: string; segmento_id: string | null }>;
		onclose?: () => void;
	};

	let { open, conductorId, conductorNombre, desde, hasta, clavesSincronizadas = [], onclose }: Props =
		$props();

	const dispatch = createEventDispatcher();

	let loading = $state(false);
	let error = '';
	let registros = $state<RegistroRef[]>([]);
	let searchTerm = $state('');
	let onlyHighlighted = $state(false);
	let copied = $state(false);

	// ============= Helpers de formato =============

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
	const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

	function fmtFechaCorta(fecha: string): string {
		const s = String(fecha).slice(0, 10);
		const [y, m, d] = s.split('-').map(Number);
		if (!y || !m || !d) return fecha;
		return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
	}

	function fmtMesAnio(mes: string): string {
		const [y, m] = mes.split('-');
		const idx = parseInt(m) - 1;
		return `${MESES[idx] || ''} ${y}`;
	}

	function fmtNum(n: number | null | undefined, decimals = 1): string {
		if (n == null || isNaN(Number(n))) return '';
		return Number(n).toFixed(decimals);
	}

	function fmtHoras(h: number | null | undefined): string {
		const v = Number(h) || 0;
		if (v <= 0) return '';
		return v % 1 === 0 ? `${v}h` : `${v.toFixed(1)}h`;
	}

	function fmtHora(h: string | null | undefined): string {
		if (!h) return '';
		return h;
	}

	function fmtKm(k: number | null | undefined): string {
		if (k == null) return '';
		return new Intl.NumberFormat('es-CO').format(k);
	}

	function fmtPernocte(p: boolean | null | undefined): string {
		return p ? 'SÍ' : 'NO';
	}

	function fmtActividad(t: string): string {
		const map: Record<string, string> = {
			LABORADO: 'LABORADO',
			DISPONIBLE: 'DISPONIBLE',
			DESCANSO: 'DESCANSO',
			MANTENIMIENTO: 'MANTENIMIENTO'
		};
		return map[t] || t;
	}

	// Paleta warm para badges de actividad (LABORADO esmeralda = acento principal)
	function fmtActividadColor(t: string): { bg: string; fg: string } {
		const map: Record<string, { bg: string; fg: string }> = {
			LABORADO: { bg: 'rgba(249, 115, 22, 0.10)', fg: '#065F46' },
			DISPONIBLE: { bg: 'rgba(249, 115, 22, 0.04)', fg: '#0F1F1A' },
			DESCANSO: { bg: 'rgba(0, 0, 0, 0.04)', fg: '#6B6B6B' },
			MANTENIMIENTO: { bg: 'rgba(245, 158, 11, 0.10)', fg: '#92400E' }
		};
		return map[t] || { bg: 'rgba(0, 0, 0, 0.04)', fg: '#6B6B6B' };
	}

	function nombreConductor(c: RegistroRef['conductor']): string {
		if (!c) return conductorNombre || '—';
		return `${c.nombre || ''} ${c.apellido || ''}`.trim() || conductorNombre || '—';
	}

	function isHighlighted(registroId: string, segmentoId: string | null): boolean {
		return clavesSincronizadas.some(
			(k) => k.registro_dia_id === registroId && k.segmento_id === segmentoId
		);
	}

	// ============= Carga de datos =============

	async function cargarDatos() {
		if (!browser || !conductorId || !desde || !hasta) return;
		loading = true;
		error = '';
		try {
			const d = new Date(desde + 'T00:00:00');
			const h = new Date(hasta + 'T00:00:00');
			const mesesSet = new Set<string>();
			const cursor = new Date(d.getFullYear(), d.getMonth(), 1);
			while (cursor <= h) {
				mesesSet.add(
					`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
				);
				cursor.setMonth(cursor.getMonth() + 1);
			}
			const meses = Array.from(mesesSet);
			const promesas = meses.map((m) =>
				apiClient
					.get('/api/dias-laborados/calendar-admin', {
						params: { mes: m.split('-')[1], anio: m.split('-')[0], limit: 9999 }
					})
					.catch(() => ({ data: { data: { registros: [] } } }))
			);
			const responses = await Promise.all(promesas);
			const map = new Map<string, RegistroRef>();
			for (const res of responses) {
				const regs: RegistroRef[] = res.data?.data?.registros ?? [];
				for (const r of regs) {
					if (r.conductor?.id !== conductorId) continue;
					const fechaNorm = String(r.fecha).slice(0, 10);
					if (fechaNorm < desde || fechaNorm > hasta) continue;
					if (!map.has(r.id)) map.set(r.id, r);
				}
			}
			registros = Array.from(map.values()).sort((a, b) =>
				a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0
			);
		} catch (err: any) {
			console.error('Error cargando recorridos para reporte:', err);
			error = err?.message || 'Error al cargar los recorridos';
			toast.error(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) {
			void conductorId;
			void desde;
			void hasta;
			cargarDatos();
		}
	});

	// ============= Construcción de filas para la tabla =============

	let filas = $derived.by<FilaReporte[]>(() => {
		const out: FilaReporte[] = [];
		for (const r of registros) {
			const segs = r.segmentos || [];
			const fechaLabel = fmtFechaCorta(r.fecha);
			if (segs.length === 0) {
				out.push({
					fecha: r.fecha,
					fechaLabel,
					conductor: nombreConductor(r.conductor),
					actividad: fmtActividad(r.tipo),
					placa: '—',
					descripcion: 'Sin tramos registrados',
					hora_inicio: '',
					hora_fin: '',
					km_inicial: null,
					km_final: null,
					pernocte: 'NO',
					horas_conduccion: 0,
					cliente: '—',
					registro_id: r.id,
					segmento_id: null,
					tiene_bonos: isHighlighted(r.id, null),
					bonos: []
				});
			} else {
				for (const s of segs) {
					out.push({
						fecha: r.fecha,
						fechaLabel,
						conductor: nombreConductor(r.conductor),
						actividad: fmtActividad(r.tipo),
						placa: s.vehiculo_placa || '—',
						descripcion: s.observaciones?.trim() || '—',
						hora_inicio: fmtHora(s.hora_inicio),
						hora_fin: fmtHora(s.hora_fin),
						km_inicial: s.km_inicial ?? null,
						km_final: s.km_final ?? null,
						pernocte: fmtPernocte(s.pernocte),
						horas_conduccion: Number(s.horas_conducidas) || 0,
						cliente: s.cliente_nombre || '—',
						registro_id: r.id,
						segmento_id: s.id,
						tiene_bonos: isHighlighted(r.id, s.id),
						bonos: []
					});
				}
			}
		}
		return out;
	});

	let filasFiltradas = $derived.by(() => {
		const term = searchTerm.trim().toLowerCase();
		return filas.filter((f) => {
			if (onlyHighlighted && !f.tiene_bonos) return false;
			if (!term) return true;
			const blob = [
				f.conductor,
				f.actividad,
				f.placa,
				f.descripcion,
				f.cliente,
				f.fechaLabel
			]
				.join(' ')
				.toLowerCase();
			return blob.includes(term);
		});
	});

	// ============= Resumen =============

	let resumen = $derived.by(() => {
		const totalFilas = filas.length;
		const totalHoras = filas.reduce((s, f) => s + (Number(f.horas_conduccion) || 0), 0);
		const totalKm = filas.reduce((s, f) => s + ((f.km_final ?? 0) - (f.km_inicial ?? 0)), 0);
		const laborados = filas.filter((f) => f.actividad === 'LABORADO').length;
		const highlighted = filas.filter((f) => f.tiene_bonos).length;
		return { totalFilas, totalHoras, totalKm, laborados, highlighted };
	});

	// ============= Export / copy =============

	function buildCsv(): string {
		const headers = [
			'NOMBRES Y APELLIDOS',
			'FECHA',
			'ACTIVIDAD',
			'PLACA',
			'DESCRIPCIÓN DE LA LABOR / RECORRIDO',
			'HORA INICIAL',
			'HORA FINAL',
			'KM INICIAL',
			'KM FINAL',
			'PERNOCTE',
			'HORAS DE CONDUCCIÓN',
			'CLIENTE'
		];
		const escape = (v: any) => {
			const s = (v ?? '').toString();
			return s.includes(',') || s.includes('"') || s.includes('\n')
				? `"${s.replace(/"/g, '""')}"`
				: s;
		};
		const lines = [headers.join(',')];
		for (const f of filasFiltradas) {
			lines.push(
				[
					f.conductor,
					f.fechaLabel,
					f.actividad,
					f.placa,
					f.descripcion,
					f.hora_inicio,
					f.hora_fin,
					f.km_inicial ?? '',
					f.km_final ?? '',
					f.pernocte,
					fmtNum(f.horas_conduccion, 1),
					f.cliente
				]
					.map(escape)
					.join(',')
			);
		}
		return lines.join('\n');
	}

	async function copiarComoCSV() {
		try {
			const csv = buildCsv();
			await navigator.clipboard.writeText(csv);
			copied = true;
			toast.success('Copiado al portapapeles como CSV (Excel)');
			setTimeout(() => (copied = false), 2500);
		} catch (err: any) {
			console.error('Error copiando CSV:', err);
			toast.error('No se pudo copiar al portapapeles');
		}
	}

	function descargarCSV() {
		const csv = buildCsv();
		const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		const conductorSlug = (conductorNombre || 'conductor').replace(/\s+/g, '_');
		a.href = url;
		a.download = `recorridos_${conductorSlug}_${desde}_${hasta}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}

	function handleEsc(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			cerrar();
		}
	}

	function cerrar() {
		onclose?.();
		dispatch('close');
	}

	$effect(() => {
		if (open && browser) {
			window.addEventListener('keydown', handleEsc);
			return () => window.removeEventListener('keydown', handleEsc);
		}
	});

	const mesesCubiertos = $derived.by(() => {
		const set = new Set<string>();
		for (const r of registros) {
			const s = String(r.fecha).slice(0, 7);
			if (s.length === 7) set.add(s);
		}
		return Array.from(set).sort();
	});

	const ahora = new Date();
	const fechaGenerado = ahora.toLocaleDateString('es-CO', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
	const fechaGeneradoLarga = ahora.toLocaleDateString('es-CO', {
		day: '2-digit',
		month: 'long',
		year: 'numeric'
	});
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background-color: rgba(15, 20, 25, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);"
		onclick={cerrar}
		onkeydown={(e) => e.key === 'Escape' && cerrar()}
		role="presentation"
		transition:fade={{ duration: 180 }}
	>
		<div
			class="relative flex h-[92vh] w-full max-w-[90rem] flex-col overflow-hidden bg-white"
			style="border-radius: 24px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18), 0 4px 24px rgba(0, 0, 0, 0.06); font-family: 'Inter Tight', system-ui, sans-serif; color: #1A1A1A;"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-label="Reporte de recorridos del período"
			transition:fly={{ y: 20, duration: 320, easing: quintOut }}
		>
			<!-- ═══ HEADER editorial estilo landing-transmeralda ═══ -->
			<div
				class="flex-shrink-0"
				style="background-color: #FFFFFF; border-bottom: 1px solid rgba(0, 0, 0, 0.08);"
			>
				<!-- Eyebrow + título + meta (3 columnas) -->
				<div
					class="grid items-center gap-3"
					style="grid-template-columns: 1fr auto 1fr; padding: 1.1rem 1.5rem 0.9rem;"
				>
					<!-- Logo + eyebrow -->
					<div class="flex items-center gap-3">
						<img
							src="/assets/logo_nombre.png"
							alt="Logo"
							class="h-12 w-auto object-contain"
							onerror={(e: any) => (e.currentTarget.style.display = 'none')}
						/>
						<span
							style="display: inline-block; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #10B981; background: rgba(249, 115, 22, 0.08); padding: 0.3rem 0.7rem; border-radius: 6px; font-family: 'JetBrains Mono', monospace;"
						>
							Reporte · GAF-FR-REC
						</span>
					</div>

					<!-- Título display (Fraunces) -->
					<div class="text-center">
						<p
							style="font-family: 'Inter Tight', sans-serif; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B; margin: 0 0 0.15rem;"
						>
							Transportes y Servicios Esmeralda S.A.S.
						</p>
						<h2
							style="font-family: 'Fraunces', 'Georgia', serif; font-weight: 500; font-size: 1.5rem; line-height: 1.15; color: #0F1F1A; margin: 0;"
						>
							Reporte de Recorridos
						</h2>
					</div>

					<!-- Meta mono -->
					<div class="flex flex-col items-end gap-0.5">
						<div class="flex items-center gap-1.5">
							<span
								style="font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: #9A9A9A; text-transform: uppercase; letter-spacing: 0.08em;"
								>Código</span
							>
							<span
								style="font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: #1A1A1A; font-weight: 600;"
								>GAF-FR-REC</span
							>
						</div>
						<div class="flex items-center gap-1.5">
							<span
								style="font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: #9A9A9A; text-transform: uppercase; letter-spacing: 0.08em;"
								>Versión</span
							>
							<span
								style="font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: #1A1A1A; font-weight: 600;"
								>1</span
							>
						</div>
						<div class="flex items-center gap-1.5">
							<span
								style="font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; color: #9A9A9A; text-transform: uppercase; letter-spacing: 0.08em;"
								>Generado</span
							>
							<span
								style="font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: #1A1A1A; font-weight: 600;"
								>{fechaGenerado}</span
							>
						</div>
					</div>
				</div>

				<!-- Period bar (base cálida hueso) -->
				<div
					class="flex flex-wrap items-center gap-x-6 gap-y-1.5"
					style="background-color: #FAF7F2; border-top: 1px solid rgba(0, 0, 0, 0.06); padding: 0.7rem 1.5rem; font-size: 0.78rem;"
				>
					<div class="flex items-baseline gap-1.5">
						<span
							style="font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
							>Conductor</span
						>
						<span style="font-weight: 600; color: #0F1F1A;">{conductorNombre || '—'}</span>
					</div>
					<div class="flex items-baseline gap-1.5">
						<span
							style="font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
							>Desde</span
						>
						<span
							style="font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: #0F1F1A; font-weight: 600;"
							>{fmtFechaCorta(desde)}</span
						>
					</div>
					<div class="flex items-baseline gap-1.5">
						<span
							style="font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
							>Hasta</span
						>
						<span
							style="font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: #0F1F1A; font-weight: 600;"
							>{fmtFechaCorta(hasta)}</span
						>
					</div>
					<div class="flex items-baseline gap-1.5">
						<span
							style="font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
							>Períodos</span
						>
						<span
							style="font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: #0F1F1A; font-weight: 600;"
						>
							{mesesCubiertos.map((m) => fmtMesAnio(m)).join(', ') || '—'}
						</span>
					</div>
				</div>

				<!-- Toolbar (botones estilo landing) -->
				<div
					class="flex flex-wrap items-center justify-between gap-3"
					style="background-color: #FFFFFF; border-top: 1px solid rgba(0, 0, 0, 0.06); padding: 0.7rem 1.5rem;"
				>
					<!-- Resumen (chips emerald-tinted) -->
					<div class="flex flex-wrap items-center gap-2">
						<span
							style="font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
							>Resumen</span
						>
						<span
							style="display: inline-flex; align-items: center; padding: 0.2rem 0.6rem; border-radius: 999px; background: rgba(0, 0, 0, 0.04); color: #0F1F1A; font-size: 0.72rem; font-weight: 600; font-family: 'Inter Tight', sans-serif;"
						>
							{resumen.totalFilas} tramos
						</span>
						<span
							style="display: inline-flex; align-items: center; padding: 0.2rem 0.6rem; border-radius: 999px; background: rgba(249, 115, 22, 0.10); color: #065F46; font-size: 0.72rem; font-weight: 600; font-family: 'Inter Tight', sans-serif;"
						>
							{fmtNum(resumen.totalHoras, 1)}h
						</span>
						{#if resumen.totalKm > 0}
							<span
								style="display: inline-flex; align-items: center; padding: 0.2rem 0.6rem; border-radius: 999px; background: rgba(0, 0, 0, 0.04); color: #1A1A1A; font-size: 0.72rem; font-weight: 600; font-family: 'Inter Tight', sans-serif;"
							>
								{fmtNum(resumen.totalKm, 0)} km
							</span>
						{/if}
						{#if resumen.highlighted > 0}
							<span
								style="display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.6rem; border-radius: 999px; background: rgba(249, 115, 22, 0.10); color: #065F46; font-size: 0.72rem; font-weight: 600; font-family: 'Inter Tight', sans-serif; border: 1px solid rgba(249, 115, 22, 0.30);"
							>
								<span
									style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10B981; box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.18);"
								></span>
								{resumen.highlighted} sincronizados
							</span>
						{/if}
					</div>

					<!-- Acciones -->
					<div class="flex items-center gap-2">
						{#if clavesSincronizadas.length > 0}
							<label
								class="flex cursor-pointer items-center gap-1.5"
								style="padding: 0.4rem 0.75rem; border-radius: 10px; background: rgba(249, 115, 22, 0.06); border: 1px solid rgba(249, 115, 22, 0.18); color: #065F46; font-size: 0.76rem; font-weight: 600; font-family: 'Inter Tight', sans-serif; transition: all 0.2s;"
							>
								<input
									type="checkbox"
									bind:checked={onlyHighlighted}
									style="height: 0.85rem; width: 0.85rem; cursor: pointer; border-radius: 4px; border-color: rgba(249, 115, 22, 0.30); accent-color: #10B981;"
								/>
								Solo sincronizados
							</label>
						{/if}

						<div class="relative">
							<svg
								class="pointer-events-none absolute top-1/2 -translate-y-1/2"
								style="left: 0.65rem; height: 0.9rem; width: 0.9rem; color: #9A9A9A;"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
								/>
							</svg>
							<input
								type="text"
								bind:value={searchTerm}
								placeholder="Buscar…"
								style="width: 11rem; border-radius: 10px; border: 1px solid rgba(0, 0, 0, 0.12); background: #FFFFFF; padding: 0.45rem 0.75rem 0.45rem 2rem; font-size: 0.8rem; color: #1A1A1A; font-family: 'Inter Tight', sans-serif; transition: all 0.2s;"
								onfocus={(e) => {
									e.currentTarget.style.borderColor = '#10B981';
									e.currentTarget.style.boxShadow = '0 0 0 3px rgba(249, 115, 22, 0.10)';
									e.currentTarget.style.outline = 'none';
								}}
								onblur={(e) => {
									e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.12)';
									e.currentTarget.style.boxShadow = 'none';
								}}
							/>
						</div>

						<button
							type="button"
							onclick={copiarComoCSV}
							style="display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.45rem 0.85rem; border-radius: 10px; background: #FFFFFF; color: #1A1A1A; border: 1px solid rgba(0, 0, 0, 0.12); font-family: 'Inter Tight', sans-serif; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 0.2s;"
							onmouseenter={(e) => {
								e.currentTarget.style.background = '#FAF7F2';
								e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.20)';
							}}
							onmouseleave={(e) => {
								e.currentTarget.style.background = '#FFFFFF';
								e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.12)';
							}}
							title="Copiar tabla como CSV (pegar en Excel)"
						>
							<svg
								style="height: 0.9rem; width: 0.9rem;"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								{#if copied}
									<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
								{:else}
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
									/>
								{/if}
							</svg>
							{copied ? 'Copiado' : 'Copiar CSV'}
						</button>

						<button
							type="button"
							onclick={descargarCSV}
							style="display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.45rem 0.95rem; border-radius: 10px; background: linear-gradient(135deg, #10B981, #ea580c); color: #FFFFFF; border: none; font-family: 'Inter Tight', sans-serif; font-size: 0.78rem; font-weight: 600; cursor: pointer; box-shadow: 0 4px 16px rgba(249, 115, 22, 0.30); transition: all 0.2s;"
							onmouseenter={(e) => {
								e.currentTarget.style.transform = 'translateY(-1px)';
								e.currentTarget.style.boxShadow = '0 6px 20px rgba(249, 115, 22, 0.40)';
							}}
							onmouseleave={(e) => {
								e.currentTarget.style.transform = 'translateY(0)';
								e.currentTarget.style.boxShadow = '0 4px 16px rgba(249, 115, 22, 0.30)';
							}}
							title="Descargar CSV"
						>
							<svg
								style="height: 0.9rem; width: 0.9rem;"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
								/>
							</svg>
							Descargar
						</button>

						<button
							type="button"
							onclick={cerrar}
							style="display: inline-flex; align-items: center; justify-content: center; height: 2rem; width: 2rem; border-radius: 10px; background: transparent; color: #6B6B6B; border: 1px solid transparent; cursor: pointer; transition: all 0.2s;"
							onmouseenter={(e) => {
								e.currentTarget.style.background = '#FAF7F2';
								e.currentTarget.style.color = '#1A1A1A';
								e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.08)';
							}}
							onmouseleave={(e) => {
								e.currentTarget.style.background = 'transparent';
								e.currentTarget.style.color = '#6B6B6B';
								e.currentTarget.style.borderColor = 'transparent';
							}}
							title="Cerrar (Esc)"
							aria-label="Cerrar"
						>
							<svg
								style="height: 0.95rem; width: 0.95rem;"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				</div>
			</div>

			<!-- ═══ BODY: tabla ═══ -->
			<div class="min-h-0 flex-1 overflow-auto" style="background-color: #FFFFFF;">
				{#if loading}
					<div class="flex h-full flex-col items-center justify-center gap-3 p-12">
						<div
							style="height: 2.5rem; width: 2.5rem; border-radius: 50%; border: 3px solid rgba(249, 115, 22, 0.20); border-top-color: #10B981; animation: spin 1s linear infinite;"
						></div>
						<p style="font-size: 0.85rem; color: #6B6B6B; font-family: 'Inter Tight', sans-serif;">
							Cargando recorridos del período seleccionado…
						</p>
					</div>
				{:else if error}
					<div
						style="margin: 1.5rem; padding: 1rem 1.25rem; border-radius: 12px; background: rgba(239, 68, 68, 0.06); border: 1px solid rgba(239, 68, 68, 0.20); color: #991B1B; font-size: 0.85rem; display: flex; align-items: flex-start; gap: 0.75rem;"
					>
						<svg
							style="height: 1.2rem; width: 1.2rem; color: #DC2626; flex-shrink: 0;"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 9v2m0 4h.01M5.071 19h13.858c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
						<span>{error}</span>
					</div>
				{:else if filasFiltradas.length === 0}
					<div
						class="flex h-full flex-col items-center justify-center gap-3 p-12 text-center"
					>
						<div
							style="display: flex; height: 3.5rem; width: 3.5rem; align-items: center; justify-content: center; border-radius: 16px; background: linear-gradient(135deg, rgba(249, 115, 22, 0.08), rgba(249, 115, 22, 0.15)); color: #10B981;"
						>
							<svg
								style="height: 1.75rem; width: 1.75rem;"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="1.8"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
								/>
							</svg>
						</div>
						<h3
							style="font-family: 'Fraunces', 'Georgia', serif; font-size: 1.15rem; font-weight: 500; color: #0F1F1A; margin: 0;"
						>
							Sin recorridos en este período
						</h3>
						<p style="font-size: 0.82rem; color: #6B6B6B; max-width: 24rem; margin: 0;">
							No se encontraron días registrados para este conductor entre el
							{fmtFechaCorta(desde)} y el {fmtFechaCorta(hasta)}.
						</p>
					</div>
				{:else}
					<table
						class="w-full border-collapse"
						style="font-family: 'Inter Tight', sans-serif; font-size: 0.78rem; color: #1A1A1A;"
					>
						<thead class="sticky top-0 z-10">
							<tr style="background-color: #FAF7F2;">
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: left; min-width: 160px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Nombres y Apellidos
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: left; min-width: 90px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Fecha
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: left; min-width: 100px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Actividad
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: left; min-width: 90px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Placa
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: left; min-width: 220px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Descripción de la Labor / Recorrido
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: left; min-width: 80px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Hora Inicial
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: left; min-width: 80px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Hora Final
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: right; min-width: 80px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Km Inicial
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: right; min-width: 80px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Km Final
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: center; min-width: 80px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Pernocte
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.7rem 0.65rem; text-align: right; min-width: 110px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Horas Conducción
								</th>
								<th
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.08); padding: 0.7rem 0.65rem; text-align: left; min-width: 140px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B;"
								>
									Cliente
								</th>
							</tr>
						</thead>
						<tbody>
							{#each filasFiltradas as fila, i (fila.registro_id + '-' + (fila.segmento_id ?? 'sin-seg'))}
								{@const act = fmtActividadColor(fila.actividad)}
								<tr
									style:background-color={fila.tiene_bonos
										? 'rgba(249, 115, 22, 0.06)'
										: i % 2 === 0
											? '#FFFFFF'
											: '#FAF7F2'}
									style="border-bottom: 1px solid rgba(0, 0, 0, 0.04); transition: background-color 0.2s;"
									onmouseenter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(249, 115, 22, 0.10)')}
									onmouseleave={(e) =>
										(e.currentTarget.style.backgroundColor = fila.tiene_bonos
											? 'rgba(249, 115, 22, 0.06)'
											: i % 2 === 0
												? '#FFFFFF'
												: '#FAF7F2')}
								>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; font-size: 0.78rem; font-weight: 600; color: #0F1F1A; vertical-align: top;"
									>
										<div class="flex flex-wrap items-center gap-1.5">
											<span>{fila.conductor}</span>
											{#if fila.tiene_bonos}
												<span
													style="display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: linear-gradient(135deg, #10B981, #ea580c); color: #FFFFFF; font-family: 'JetBrains Mono', monospace; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; box-shadow: 0 2px 6px rgba(249, 115, 22, 0.25);"
													title="Este tramo tiene bonos sincronizados"
												>
													<svg
														style="height: 0.65rem; width: 0.65rem;"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
														stroke-width="3"
													>
														<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
													</svg>
													Sincronizado
												</span>
											{/if}
										</div>
									</td>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: #0F1F1A; vertical-align: top;"
									>
										{fila.fechaLabel}
									</td>
									<td style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; vertical-align: top;">
										<span
											style:background-color={act.bg}
											style:color={act.fg}
											style="display: inline-block; padding: 0.2rem 0.55rem; border-radius: 999px; font-family: 'JetBrains Mono', monospace; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;"
										>
											{fila.actividad}
										</span>
									</td>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; font-weight: 600; color: #065F46; vertical-align: top;"
									>
										{fila.placa}
									</td>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; font-size: 0.78rem; color: #4A4A4A; vertical-align: top; line-height: 1.45;"
									>
										{fila.descripcion}
									</td>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: #0F1F1A; vertical-align: top;"
									>
										{fila.hora_inicio}
									</td>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: #0F1F1A; vertical-align: top;"
									>
										{fila.hora_fin}
									</td>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: #0F1F1A; vertical-align: top; font-variant-numeric: tabular-nums;"
									>
										{fmtKm(fila.km_inicial)}
									</td>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: #0F1F1A; vertical-align: top; font-variant-numeric: tabular-nums;"
									>
										{fmtKm(fila.km_final)}
									</td>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; text-align: center; vertical-align: top;"
									>
										<span
											style:background-color={fila.pernocte === 'SÍ'
												? 'rgba(245, 158, 11, 0.10)'
												: 'rgba(0, 0, 0, 0.04)'}
											style:color={fila.pernocte === 'SÍ' ? '#92400E' : '#6B6B6B'}
											style="display: inline-block; padding: 0.2rem 0.55rem; border-radius: 999px; font-family: 'JetBrains Mono', monospace; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;"
										>
											{fila.pernocte}
										</span>
									</td>
									<td
										style="border-right: 1px solid rgba(0, 0, 0, 0.04); padding: 0.55rem 0.65rem; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; font-weight: 600; color: #065F46; vertical-align: top; font-variant-numeric: tabular-nums;"
									>
										{fmtHoras(fila.horas_conduccion)}
									</td>
									<td
										style="padding: 0.55rem 0.65rem; font-size: 0.78rem; color: #4A4A4A; vertical-align: top;"
									>
										{fila.cliente}
									</td>
								</tr>
							{/each}
						</tbody>
						<tfoot class="sticky bottom-0">
							<tr style="background-color: #FAF7F2; border-top: 1px solid rgba(0, 0, 0, 0.08);">
								<td
									colspan="10"
									style="padding: 0.7rem 0.85rem; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B; border-right: 1px solid rgba(0, 0, 0, 0.04);"
								>
									Totales
								</td>
								<td
									style="padding: 0.7rem 0.65rem; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; font-weight: 700; color: #065F46; border-right: 1px solid rgba(0, 0, 0, 0.04); font-variant-numeric: tabular-nums;"
								>
									{fmtNum(resumen.totalHoras, 1)}h
								</td>
								<td
									style="padding: 0.7rem 0.65rem; font-family: 'Inter Tight', sans-serif; font-size: 0.72rem; color: #6B6B6B;"
								>
									{filasFiltradas.length} fila{filasFiltradas.length === 1 ? '' : 's'}
								</td>
							</tr>
						</tfoot>
					</table>
				{/if}
			</div>

			<!-- ═══ FOOTER editorial ═══ -->
			<div
				class="flex flex-shrink-0 items-center justify-between"
				style="background-color: #FAF7F2; border-top: 1px solid rgba(0, 0, 0, 0.06); padding: 0.65rem 1.5rem; font-size: 0.72rem; color: #6B6B6B;"
			>
				<span
					style="display: inline-block; padding: 0.2rem 0.5rem; border-radius: 5px; background: rgba(249, 115, 22, 0.08); color: #065F46; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;"
				>
					GAF-FR-REC · V1
				</span>
				<span style="font-family: 'Inter Tight', sans-serif;">
					Generado el {fechaGeneradoLarga} · SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.
				</span>
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
