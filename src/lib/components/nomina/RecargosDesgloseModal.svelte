<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import {
		Calendar,
		Building2,
		Truck,
		DollarSign,
		Clock,
		ChevronDown,
		ChevronRight,
		FileText,
		Settings2,
		TrendingUp,
		RefreshCw,
		Loader2
	} from 'lucide-svelte';
	import type { PreviewRecargosResponse } from '$lib/api/nomina';
	import { recargosApi } from '$lib/api/recargos';
	import { toast } from 'svelte-sonner';

	type Props = {
		open: boolean;
		previewData: PreviewRecargosResponse | null;
		conductorNombre?: string;
		periodoInicio: string;
		periodoFin: string;
	};
	let {
		open = false,
		previewData = null,
		conductorNombre = '',
		periodoInicio,
		periodoFin
	}: Props = $props();

	const dispatch = createEventDispatcher();

	const MESES = [
		'',
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

	const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

	// El backend envía `fecha` como string formateado por toLocaleDateString
	// con day:'2-digit', month:'short', year:'numeric' → ej: "20 jul 2026"
	// también puede llegar como ISO "2026-07-20T00:00:00.000Z" o "2026-07-20".
	// Esta función normaliza siempre al formato "DD/MM/YYYY".
	function normalizarFecha(fechaStr: string | null | undefined): {
		corta: string;
		diaNum: number;
		mes: number;
		año: number;
		fecha: Date;
	} {
		const fallback = {
			corta: '—',
			diaNum: -1,
			mes: 0,
			año: 0,
			fecha: new Date(NaN)
		};
		if (!fechaStr) return fallback;

		let y = 0,
			m = 0,
			d = 0;

		// Intento 1: ISO "YYYY-MM-DD" o "YYYY-MM-DDT..."
		if (/^\d{4}-\d{1,2}-\d{1,2}/.test(fechaStr)) {
			const s = fechaStr.substring(0, 10);
			const parts = s.split('-').map(Number);
			[y, m, d] = parts;
		} else {
			// Intento 2: formato español "20 jul 2026" o "20 de julio de 2026"
			const lower = fechaStr.toLowerCase();
			const mesMap: Record<string, number> = {
				ene: 1,
				enero: 1,
				feb: 2,
				febrero: 2,
				mar: 3,
				marzo: 3,
				abr: 4,
				abril: 4,
				may: 5,
				mayo: 5,
				jun: 6,
				junio: 6,
				jul: 7,
				julio: 7,
				ago: 8,
				agosto: 8,
				sep: 9,
				set: 9,
				sept: 9,
				septiembre: 9,
				oct: 10,
				octubre: 10,
				nov: 11,
				noviembre: 11,
				dic: 12,
				diciembre: 12
			};
			const tokens = lower.replace(/de/g, '').split(/\s+/).filter(Boolean);
			for (const t of tokens) {
				if (/^\d{1,2}$/.test(t) && d === 0) d = parseInt(t);
				else if (mesMap[t] && m === 0) m = mesMap[t];
				else if (/^\d{4}$/.test(t)) y = parseInt(t);
			}
		}

		if (!y || !m || !d) return fallback;

		const fecha = new Date(Date.UTC(y, m - 1, d));
		const diaNum = fecha.getUTCDay();
		return {
			corta: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`,
			diaNum,
			mes: m,
			año: y,
			fecha
		};
	}

	// Set de planillas expandidas (por defecto todas expandidas la primera vez)
	let expandedPlanillas: Set<string> = $state(new Set());

	// Set de días expandidos (para ver el desglose por tipo de recargo)
	let expandedDias: Set<string> = $state(new Set());

	// Planillas que se están recalculando (id → true mientras la request está en vuelo)
	let recalculandoPlanillas: Set<string> = $state(new Set());

	// Tab activa: empresa | vehiculo | mes | tipo | planillas
	let tabActiva: 'empresa' | 'vehiculo' | 'mes' | 'tipo' | 'planillas' = $state('planillas');

	/**
	 * Suma los valor_total de los recargos de un día (helper para el total)
	 */
	function totalValorPlanilla(planilla: any): number {
		let total = 0;
		for (const dia of planilla.dias || []) {
			if (dia.disponibilidad) continue;
			for (const r of dia.recargos || []) {
				total += Number(r.valor_total) || 0;
			}
		}
		return total;
	}

	/**
	 * Recalcula una planilla con la config salarial y % de tipos vigentes
	 * en cada día. NO modifica las horas — solo regenera los snapshots
	 * (porcentaje_aplicado, valor_hora_calculado, valor_calculado,
	 * configuracion_salario_id, fecha_aplicacion).
	 *
	 * Al terminar, emite `recargoRecalculado` para que el padre recargue
	 * el preview y muestre los valores actualizados.
	 */
	async function handleRecalcular(planillaId: string) {
		if (recalculandoPlanillas.has(planillaId)) return;
		// Capturamos el total antes para mostrar la diferencia en el toast
		const planilla = previewData?.planillas.find((p) => p.planilla_id === planillaId);
		const totalAntes = planilla ? totalValorPlanilla(planilla) : 0;

		recalculandoPlanillas = new Set([...recalculandoPlanillas, planillaId]);
		try {
			await recargosApi.recalcular(planillaId);
			// Mostramos toast de inmediato (es local al modal)
			toast.success('Recargo recalculado', {
				description:
					'La planilla ahora usa la config salarial y los % vigentes por día.'
			});
			// CRÍTICO: el nombre del evento debe ser PLURAL (`recargosRecalculados`)
			// para que el padre (`LiquidacionFormComplete.svelte`) lo escuche
			// y re-fetchee el preview. Sin esto, el modal sigue mostrando los
			// valores viejos aunque el backend ya haya recalculado.
			dispatch('recargosRecalculados', { planillaId });
		} catch (err: any) {
			console.error('Error recalculando recargo:', err);
			toast.error(err?.response?.data?.message || 'Error al recalcular el recargo');
		} finally {
			const next = new Set(recalculandoPlanillas);
			next.delete(planillaId);
			recalculandoPlanillas = next;
		}
	}

	function cerrar() {
		dispatch('close');
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) cerrar();
	}

	$effect(() => {
		if (browser && open) {
			document.addEventListener('keydown', handleKeydown);
			return () => document.removeEventListener('keydown', handleKeydown);
		}
	});

	// Planillas que aportan al período seleccionado: el backend ya filtra los
	// días por rango, así que una planilla cuyos días caen todos fuera del
	// período llega con `dias: []` y `total_dias: 0`. La ocultamos de TODAS
	// las tabs y, en consecuencia, las stat cards del header se calculan
	// sobre estas (no sobre `previewData.resumen` que el backend agrega
	// incluyendo las planillas con días fuera del rango).
	let planillasVisibles = $derived(
		(previewData?.planillas || []).filter((p) => (p.dias?.length || 0) > 0)
	);

	// Stats derivados del período: se calculan en el frontend para que
	// el header refleje únicamente lo que el usuario ve. Coinciden con
	// los totales de la liquidación porque el backend ya excluyó los días
	// fuera del rango al calcular los `total_*` de cada planilla.
	let statsPeriodo = $derived({
		totalRecargos: planillasVisibles.reduce(
			(sum, p) => sum + (Number(p.total_valor) || 0),
			0
		),
		planillas: planillasVisibles.length,
		dias: planillasVisibles.reduce((sum, p) => sum + (Number(p.total_dias) || 0), 0),
		horas: planillasVisibles.reduce((sum, p) => sum + (Number(p.total_horas) || 0), 0),
		festivos: planillasVisibles.reduce(
			(sum, p) => sum + (Number(p.total_festivos) || 0),
			0
		)
	});

	// Cuando se abre el modal, expandir todas las planillas por defecto
	$effect(() => {
		if (open && planillasVisibles.length) {
			const todasKeys = new Set(planillasVisibles.map((p) => p.planilla_id));
			expandedPlanillas = todasKeys;
		}
	});

	function togglePlanilla(planillaId: string) {
		const next = new Set(expandedPlanillas);
		if (next.has(planillaId)) next.delete(planillaId);
		else next.add(planillaId);
		expandedPlanillas = next;
	}

	function toggleDia(diaKey: string) {
		const next = new Set(expandedDias);
		if (next.has(diaKey)) next.delete(diaKey);
		else next.add(diaKey);
		expandedDias = next;
	}

	function expandAllPlanillas() {
		if (!previewData?.planillas) return;
		expandedPlanillas = new Set(previewData.planillas.map((p) => p.planilla_id));
	}

	function collapseAllPlanillas() {
		expandedPlanillas = new Set();
		expandedDias = new Set();
	}

	let recalculandoTodas = $state(false);
	let progresoRecalc = $state({ actuales: 0, total: 0 });

	/**
	 * Recalcula TODAS las planillas en paralelo. Útil cuando hubo un cambio
	 * de tarifario (ej: nuevo tarifario desde 15-jul) y se quieren aplicar
	 * a todas las planillas del período de una sola vez.
	 *
	 * Procesa hasta 3 planillas en paralelo para no saturar la BD.
	 */
	async function handleRecalcularTodas() {
		if (!previewData?.planillas?.length) return;
		const planillas = previewData.planillas;
		if (
			!confirm(
				`Vas a recalcular ${planillas.length} planilla(s) con la config salarial y los % de tipos vigentes por día. Esta acción no modifica las horas, solo los valores monetarios. ¿Continuar?`
			)
		) {
			return;
		}

		recalculandoTodas = true;
		progresoRecalc = { actuales: 0, total: planillas.length };
		const todos = new Set(planillas.map((p) => p.planilla_id));
		recalculandoPlanillas = todos;

		const CONCURRENCY = 3;
		const resultados: Array<{ id: string; ok: boolean; diff?: number; error?: string }> = [];

		for (let i = 0; i < planillas.length; i += CONCURRENCY) {
			const batch = planillas.slice(i, i + CONCURRENCY);
			const r = await Promise.allSettled(
				batch.map(async (p) => {
					try {
						await recargosApi.recalcular(p.planilla_id);
						return { id: p.planilla_id, ok: true };
					} catch (err: any) {
						return {
							id: p.planilla_id,
							ok: false,
							error: err?.response?.data?.message || 'Error desconocido'
						};
					}
				})
			);
			for (const r2 of r) {
				if (r2.status === 'fulfilled') resultados.push(r2.value);
			}
			progresoRecalc = { actuales: Math.min(i + CONCURRENCY, planillas.length), total: planillas.length };
		}

		const okCount = resultados.filter((r) => r.ok).length;
		const errCount = resultados.filter((r) => !r.ok).length;

		if (errCount === 0) {
			toast.success(`${okCount} planilla(s) recalculada(s)`);
		} else {
			toast.warning(`${okCount} ok, ${errCount} con error`);
		}

		// Limpiar estado y avisar al padre para que recargue el preview
		recalculandoPlanillas = new Set();
		recalculandoTodas = false;
		dispatch('recargosRecalculados', { resultados });
	}

	// ── Agregaciones ──

	interface ResumenEmpresa {
		empresaId: string;
		empresaNombre: string;
		planillas: number;
		dias: number;
		horas: number;
		total: number;
		planillaIds: string[];
	}
	interface ResumenVehiculo {
		vehiculoId: string;
		vehiculoPlaca: string;
		planillas: number;
		dias: number;
		horas: number;
		total: number;
		planillaIds: string[];
	}
	interface ResumenMes {
		key: string; // YYYY-MM
		año: number;
		mes: number;
		mesLabel: string;
		planillas: number;
		dias: number;
		horas: number;
		total: number;
		planillaIds: string[];
	}
	interface ResumenTipo {
		codigo: string;
		nombre: string;
		// Importante: la clave del Map es (codigo, porcentaje) para diferenciar
		// las filas cuando una planilla cruza un cambio de tarifario (ej: HEFN
		// 155% antes del 15-jul, 165% desde el 15-jul). Si dos días del mismo
		// tipo se calcularon con % distintos, esto se muestra como dos filas
		// separadas y el usuario ve exactamente cuánto generó cada %.
		porcentaje: number;
		esHoraExtra: boolean;
		adicional: boolean;
		totalHoras: number;
		totalValor: number;
		configuraciones: Set<string>; // IDs de config salarial distintas (info)
		dias: Set<string>; // Días (YYYY-MM-DD) donde aparece este combo
	}

	function resumenPorEmpresa(): ResumenEmpresa[] {
		if (!planillasVisibles) return [];
		const map = new Map<string, ResumenEmpresa>();
		for (const p of planillasVisibles) {
			const id = p.empresa.id;
			if (!map.has(id)) {
				map.set(id, {
					empresaId: id,
					empresaNombre: p.empresa.nombre,
					planillas: 0,
					dias: 0,
					horas: 0,
					total: 0,
					planillaIds: []
				});
			}
			const e = map.get(id)!;
			e.planillas += 1;
			e.dias += p.total_dias;
			e.horas += p.total_horas;
			e.total += p.total_valor;
			e.planillaIds.push(p.planilla_id);
		}
		return Array.from(map.values()).sort((a, b) => b.total - a.total);
	}

	function resumenPorVehiculo(): ResumenVehiculo[] {
		if (!planillasVisibles) return [];
		const map = new Map<string, ResumenVehiculo>();
		for (const p of planillasVisibles) {
			const id = p.vehiculo.id;
			if (!map.has(id)) {
				map.set(id, {
					vehiculoId: id,
					vehiculoPlaca: p.vehiculo.placa,
					planillas: 0,
					dias: 0,
					horas: 0,
					total: 0,
					planillaIds: []
				});
			}
			const v = map.get(id)!;
			v.planillas += 1;
			v.dias += p.total_dias;
			v.horas += p.total_horas;
			v.total += p.total_valor;
			v.planillaIds.push(p.planilla_id);
		}
		return Array.from(map.values()).sort((a, b) => a.vehiculoPlaca.localeCompare(b.vehiculoPlaca));
	}

	function resumenPorMes(): ResumenMes[] {
		if (!planillasVisibles) return [];
		const map = new Map<string, ResumenMes>();
		for (const p of planillasVisibles) {
			const key = `${p.año}-${String(p.mes).padStart(2, '0')}`;
			if (!map.has(key)) {
				map.set(key, {
					key,
					año: p.año,
					mes: p.mes,
					mesLabel: `${MESES[p.mes] || p.mes} ${p.año}`,
					planillas: 0,
					dias: 0,
					horas: 0,
					total: 0,
					planillaIds: []
				});
			}
			const m = map.get(key)!;
			m.planillas += 1;
			m.dias += p.total_dias;
			m.horas += p.total_horas;
			m.total += p.total_valor;
			m.planillaIds.push(p.planilla_id);
		}
		return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
	}

	function resumenPorTipo(): ResumenTipo[] {
		// IMPORTANTE: NO usamos `previewData.resumen_tipos` del backend porque
		// viene agregado sobre TODAS las planillas crudas (incluyendo las que
		// ocultamos por estar fuera del período). Recalculamos desde los días
		// visibles para que este tab sea coherente con el resto.
		//
		// Clave del Map: `${codigo}@${porcentaje}` — esto garantiza que si un
		// mismo tipo se calculó con % distintos (ej: HEFN 155% antes del 15-jul
		// y 165% desde el 15-jul) aparezcan como DOS filas separadas, cada una
		// con su total de horas y valor. Antes esto se mezclaba en una sola fila
		// mostrando el % del PRIMER detalle encontrado (engañoso).
		if (!planillasVisibles) return [];
		const map = new Map<string, ResumenTipo>();
		for (const p of planillasVisibles) {
			for (const dia of p.dias || []) {
				if (dia.disponibilidad) continue;
				// Construir una key de día estable a partir del `dia.fecha` (que
				// ya viene formateado por el backend como "20 jul 2026") o, en
				// su defecto, mes/año/dia.
				const fechaKey = (() => {
					if (typeof dia.fecha === 'string' && dia.fecha) {
						// Formatos posibles: ISO "2026-07-05" o "20 jul 2026"
						const iso = dia.fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
						if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
						// "20 jul 2026" — no es ideal pero sirve como desambiguador
						return dia.fecha;
					}
					return `${p.año}-${String(p.mes).padStart(2, '0')}-${String(dia.dia).padStart(2, '0')}`;
				})();

				for (const r of dia.recargos || []) {
					const key = `${r.tipo_codigo}@${r.porcentaje}`;
					if (!map.has(key)) {
						map.set(key, {
							codigo: r.tipo_codigo,
							nombre: r.tipo_nombre,
							porcentaje: r.porcentaje,
							esHoraExtra: !!r.es_hora_extra,
							adicional: !!r.adicional,
							totalHoras: 0,
							totalValor: 0,
							configuraciones: new Set(),
							dias: new Set()
						});
					}
					const t = map.get(key)!;
					t.totalHoras += Number(r.horas) || 0;
					t.totalValor += Number(r.valor_total) || 0;
					t.dias.add(fechaKey);
				}
			}
		}
		// Orden: HED, HEN, HEFD, HEFN, RN, RD, RNDF, luego resto. Dentro del
		// mismo codigo, los % más bajos primero (cronológico: tarifario viejo
		// antes que el nuevo).
		const orden: Record<string, number> = {
			HED: 1, HEN: 2, HEFD: 3, HEFN: 4, RN: 5, RD: 6, RNDF: 7
		};
		return Array.from(map.values()).sort((a, b) => {
			const oa = orden[a.codigo] ?? 99;
			const ob = orden[b.codigo] ?? 99;
			if (oa !== ob) return oa - ob;
			if (a.porcentaje !== b.porcentaje) return a.porcentaje - b.porcentaje;
			return a.nombre.localeCompare(b.nombre);
		});
	}

	// ── Formateo ──

	// Moneda en pesos colombianos con 2 decimales (peso por peso).
	// No redondeamos: solo fijamos 2 decimales para mostrar centavos.
	function fmtCOP(amount: number | null | undefined): string {
		const v = Number(amount) || 0;
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(v);
	}

	// Versión sin símbolo para usar en tablas angostas
	function fmtCOPPlain(amount: number | null | undefined): string {
		const v = Number(amount) || 0;
		return new Intl.NumberFormat('es-CO', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(v);
	}

	// Para la cabecera de la config destinada, mostramos salario y valor hora
	// completos (sin compactar) para que el usuario vea los números reales.
	function fmtCOPFull(amount: number | null | undefined): string {
		const v = Number(amount) || 0;
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(v);
	}

	function fmtHoras(h: number | null | undefined): string {
		const v = Number(h) || 0;
		if (v <= 0) return '0h';
		return v % 1 === 0 ? `${v}h` : `${v.toFixed(2)}h`;
	}

	function fmtHoraDecimal(h: number | null | undefined): string {
		const v = Number(h) || 0;
		if (v <= 0) return '—';
		const horas = Math.floor(v);
		const minutos = Math.round((v - horas) * 60);
		return `${horas}:${String(minutos).padStart(2, '0')}`;
	}

	function fmtConfigLabel(cfg: any): string {
		if (!cfg) return '—';
		return `Salario ${fmtCOPFull(cfg.salario_basico)} · ${fmtCOPFull(cfg.valor_hora_trabajador)}/h · ${cfg.horas_mensuales_base}h/mes`;
	}

	// Color por código de recargo (paleta consistente con el resto del sistema)
	function colorTipo(codigo: string): { bg: string; fg: string; bar: string } {
		const map: Record<string, { bg: string; fg: string; bar: string }> = {
			HED: { bg: 'rgba(249, 115, 22, 0.10)', fg: '#9A3412', bar: '#F97316' },
			HEN: { bg: 'rgba(59, 130, 246, 0.10)', fg: '#1E3A8A', bar: '#3B82F6' },
			HEFD: { bg: 'rgba(234, 179, 8, 0.10)', fg: '#854D0E', bar: '#EAB308' },
			HEFN: { bg: 'rgba(168, 85, 247, 0.10)', fg: '#6B21A8', bar: '#A855F7' },
			RN: { bg: 'rgba(20, 184, 166, 0.10)', fg: '#115E59', bar: '#14B8A6' },
			RD: { bg: 'rgba(239, 68, 68, 0.10)', fg: '#991B1B', bar: '#EF4444' },
			RNDF: { bg: 'rgba(99, 102, 241, 0.10)', fg: '#3730A3', bar: '#6366F1' }
		};
		return map[codigo] || { bg: 'rgba(107, 114, 128, 0.10)', fg: '#374151', bar: '#6B7280' };
	}
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
			class="relative flex h-[94vh] w-full max-w-[96rem] flex-col overflow-hidden bg-white"
			style="border-radius: 20px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18), 0 4px 24px rgba(0, 0, 0, 0.06); font-family: 'Inter Tight', system-ui, sans-serif; color: #1A1A1A;"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-label="Desglose detallado de recargos de planillas"
			transition:fly={{ y: 20, duration: 320, easing: quintOut }}
		>
			<!-- ═══ HEADER ═══ -->
			<div
				class="flex-shrink-0"
				style="background: linear-gradient(180deg, #FFFFFF 0%, #F9FAFB 100%); border-bottom: 1px solid rgba(0, 0, 0, 0.08);"
			>
				<div class="flex items-center justify-between gap-4 px-6 py-4">
					<div class="flex min-w-0 items-center gap-3">
						<div
							class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
							style="background: linear-gradient(135deg, #10B981, #059669); box-shadow: 0 6px 16px rgba(16, 185, 129, 0.30);"
						>
							<TrendingUp class="h-5 w-5 text-white" />
						</div>
						<div class="min-w-0">
							<p
								style="display: inline-block; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #065F46; background: rgba(16, 185, 129, 0.08); padding: 0.25rem 0.65rem; border-radius: 6px; font-family: 'JetBrains Mono', monospace;"
							>
								Desglose · Recargos
							</p>
							<h2
								class="truncate font-display"
								style="font-size: 1.4rem; font-weight: 500; color: #0F1F1A; margin-top: 0.35rem; line-height: 1.1;"
							>
								Detalle de recargos por día, tipo y configuración
							</h2>
							<p
								class="font-mono-meta"
								style="font-size: 0.7rem; color: #6B7280; margin-top: 0.2rem;"
							>
								{conductorNombre ? `${conductorNombre} · ` : ''}Período {periodoInicio} → {periodoFin}
							</p>
						</div>
					</div>
					<button
						onclick={cerrar}
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900"
						aria-label="Cerrar"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<!-- Stat cards (resumen rápido) — calculadas sobre planillasVisibles -->
				{#if previewData}
					<div class="grid grid-cols-2 gap-2 border-t border-gray-100 px-6 py-3 sm:grid-cols-5">
						<div
							class="rounded-lg px-3 py-2"
							style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(5, 150, 105, 0.04)); border: 1px solid rgba(16, 185, 129, 0.15);"
						>
							<p style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #047857; font-family: 'JetBrains Mono', monospace;">
								Total recargos
							</p>
							<p class="mt-0.5 font-display" style="font-size: 1.15rem; font-weight: 700; color: #0F1F1A;">
								{fmtCOP(statsPeriodo.totalRecargos)}
							</p>
						</div>
						<div class="rounded-lg bg-gray-50 px-3 py-2" style="border: 1px solid rgba(0,0,0,0.06);">
							<p style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">
								Planillas
							</p>
							<p class="mt-0.5 font-display" style="font-size: 1.15rem; font-weight: 700; color: #0F1F1A;">
								{statsPeriodo.planillas}
							</p>
						</div>
						<div class="rounded-lg bg-gray-50 px-3 py-2" style="border: 1px solid rgba(0,0,0,0.06);">
							<p style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">
								Días trabajados
							</p>
							<p class="mt-0.5 font-display" style="font-size: 1.15rem; font-weight: 700; color: #0F1F1A;">
								{statsPeriodo.dias}
							</p>
						</div>
						<div class="rounded-lg bg-gray-50 px-3 py-2" style="border: 1px solid rgba(0,0,0,0.06);">
							<p style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">
								Horas
							</p>
							<p class="mt-0.5 font-display" style="font-size: 1.15rem; font-weight: 700; color: #0F1F1A;">
								{fmtHoras(statsPeriodo.horas)}
							</p>
						</div>
						<div class="rounded-lg bg-gray-50 px-3 py-2" style="border: 1px solid rgba(0,0,0,0.06);">
							<p style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">
								Festivos
							</p>
							<p class="mt-0.5 font-display" style="font-size: 1.15rem; font-weight: 700; color: #0F1F1A;">
								{statsPeriodo.festivos}
							</p>
						</div>
					</div>
				{/if}

				<!-- Tabs -->
				<div
					class="flex items-center gap-1 overflow-x-auto border-t border-gray-100 px-6"
					style="background-color: #FAFAFA;"
				>
					{#each [
						{ id: 'planillas', label: 'Por día / planilla', icon: FileText },
						{ id: 'empresa', label: 'Por empresa', icon: Building2 },
						{ id: 'vehiculo', label: 'Por vehículo', icon: Truck },
						{ id: 'mes', label: 'Por mes', icon: Calendar },
						{ id: 'tipo', label: 'Por tipo', icon: Settings2 }
					] as tab}
						<button
							onclick={() => (tabActiva = tab.id as any)}
							class="flex items-center gap-1.5 border-b-2 px-3 py-2.5 font-mono-meta transition-colors"
							style="font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; {tabActiva === tab.id
								? 'color: #047857; border-bottom-color: #10B981;'
								: 'color: #6B7280; border-bottom-color: transparent;'}"
						>
							<tab.icon class="h-3.5 w-3.5" />
							{tab.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- ═══ BODY (scrollable) ═══ -->
			<div class="flex-1 overflow-y-auto" style="background-color: #F9FAFB;">
				{#if !previewData || !previewData.planillas?.length}
					<div class="flex h-full flex-col items-center justify-center py-16 text-center">
						<div
							class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
							style="background-color: #F3F4F6;"
						>
							<FileText class="h-7 w-7 text-gray-400" />
						</div>
						<h3 class="font-display" style="font-size: 1.1rem; font-weight: 500; color: #0F1F1A;">
							Sin recargos para mostrar
						</h3>
						<p style="font-size: 0.8rem; color: #6B7280; margin-top: 0.4rem;">
							No se encontraron recargos en el período seleccionado. Pulsa "Recalcular" en la sección
							de planillas.
						</p>
					</div>
				{:else if planillasVisibles.length === 0}
					<div class="flex h-full flex-col items-center justify-center py-16 text-center">
						<div
							class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
							style="background-color: #FEF3C7;"
						>
							<Calendar class="h-7 w-7" style="color: #B45309;" />
						</div>
						<h3 class="font-display" style="font-size: 1.1rem; font-weight: 500; color: #0F1F1A;">
							Sin recargos dentro del período
						</h3>
						<p style="font-size: 0.8rem; color: #6B7280; margin-top: 0.4rem; max-width: 28rem;">
							Hay {previewData.planillas.length} planilla{previewData.planillas.length !== 1 ? 's' : ''}
							registrada{previewData.planillas.length !== 1 ? 's' : ''}, pero sus días caen fuera
							del rango seleccionado ({periodoInicio} → {periodoFin}). Amplía el período o revisa
							las planillas directamente.
						</p>
					</div>
				{:else}
					<div class="p-5">
						<!-- ══════ TAB: Por día / planilla ══════ -->
						{#if tabActiva === 'planillas'}
							<div class="mb-3 flex items-center justify-between gap-3">
								<p style="font-size: 0.75rem; color: #6B7280;">
									Haz clic en una planilla para ver el desglose por día. Cada día muestra
									los tipos de recargo, horas, porcentaje y valor.
								</p>
								<div class="flex shrink-0 items-center gap-2">
									<button
										onclick={expandAllPlanillas}
										class="font-mono-meta rounded-md px-2 py-1 transition-colors hover:bg-gray-100"
										style="font-size: 0.65rem; color: #047857;"
									>
										Expandir todo
									</button>
									<button
										onclick={collapseAllPlanillas}
										class="font-mono-meta rounded-md px-2 py-1 transition-colors hover:bg-gray-100"
										style="font-size: 0.65rem; color: #6B7280;"
									>
										Colapsar todo
									</button>
									<button
										onclick={handleRecalcularTodas}
										disabled={recalculandoTodas ||
											!previewData?.planillas?.length ||
											recalculandoPlanillas.size > 0}
										class="font-mono-meta flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all disabled:cursor-not-allowed disabled:opacity-50"
										style="font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: white; background: linear-gradient(135deg, #4F46E5, #4338CA);"
										title="Re-procesa TODAS las planillas con la config vigente por día (ej: tras cambio de tarifario)"
									>
										{#if recalculandoTodas}
											<Loader2 class="h-3 w-3 animate-spin" />
											{progresoRecalc.actuales}/{progresoRecalc.total}
										{:else}
											<RefreshCw class="h-3 w-3" />
											Recalcular todas
										{/if}
									</button>
								</div>
							</div>

						<!-- Planillas con días dentro del período seleccionado -->
						<div class="space-y-3">
							{#each planillasVisibles as planilla (planilla.planilla_id)}
									{@const isExpanded = expandedPlanillas.has(planilla.planilla_id)}
									{@const config = planilla.configuracion_salarial}
									<div
										class="overflow-hidden rounded-xl border bg-white transition-shadow"
										style="border-color: {isExpanded
											? 'rgba(16, 185, 129, 0.35)'
											: 'rgba(0, 0, 0, 0.08)'}; box-shadow: {isExpanded
											? '0 4px 12px rgba(16, 185, 129, 0.08)'
											: '0 1px 2px rgba(0, 0, 0, 0.04)'};"
									>
										<!-- Planilla header -->
										<button
											onclick={() => togglePlanilla(planilla.planilla_id)}
											class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors"
											style="background: linear-gradient(180deg, #FFFFFF 0%, #FAFAFA 100%);"
										>
											<div class="flex min-w-0 flex-1 items-center gap-3">
												<div
													class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
													style="background: linear-gradient(135deg, {isExpanded
														? '#10B981, #059669'
														: '#F3F4F6, #E5E7EB'}); color: {isExpanded ? 'white' : '#6B7280'};"
												>
													{#if isExpanded}
														<ChevronDown class="h-4 w-4" />
													{:else}
														<ChevronRight class="h-4 w-4" />
													{/if}
												</div>
												<div class="min-w-0 flex-1">
													<div class="flex flex-wrap items-center gap-2">
														<span
															style="display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #047857; background: rgba(16, 185, 129, 0.08); padding: 0.2rem 0.55rem; border-radius: 6px; font-family: 'JetBrains Mono', monospace;"
														>
															<FileText class="h-2.5 w-2.5" />
															{planilla.numero_planilla || 'Sin número'}
														</span>
														<span style="font-size: 0.85rem; font-weight: 600; color: #0F1F1A;">
															{planilla.vehiculo.placa}
														</span>
														<span style="font-size: 0.75rem; color: #6B7280;">·</span>
														<span style="font-size: 0.85rem; color: #0F1F1A;">
															{planilla.empresa.nombre}
														</span>
														<span style="font-size: 0.75rem; color: #6B7280;">·</span>
														<span style="font-size: 0.8rem; color: #6B7280;">
															{MESES[planilla.mes] || planilla.mes} {planilla.año}
														</span>
													</div>
													<div
														class="mt-1 flex flex-wrap items-center gap-3"
														style="font-size: 0.7rem; color: #6B7280;"
													>
														<span>
															<span style="font-weight: 600; color: #0F1F1A;">{planilla.total_dias}</span> días
														</span>
														<span>·</span>
														<span>
															<span style="font-weight: 600; color: #0F1F1A;">{fmtHoras(planilla.total_horas)}</span> trabajadas
														</span>
														<span>·</span>
														<span>
															<span style="font-weight: 600; color: #0F1F1A;">{planilla.dias?.filter((d) => d.disponibilidad).length || 0}</span> disponibles
														</span>
													</div>
												</div>
											</div>
											<div class="shrink-0 text-right">
												<p
													class="font-display"
													style="font-size: 1.1rem; font-weight: 700; color: #047857;"
												>
													{fmtCOP(planilla.total_valor)}
												</p>
												<p style="font-size: 0.6rem; color: #6B7280; margin-top: 0.1rem;">
													{planilla.dias?.length || 0} día{planilla.dias?.length !== 1 ? 's' : ''} calculado{(planilla.dias?.length || 0) !== 1 ? 's' : ''}
												</p>
											</div>
										</button>

										<!-- Planilla body -->
										{#if isExpanded}
											<div
												class="border-t px-4 py-3"
												style="border-color: rgba(16, 185, 129, 0.15); background-color: #FAFAFA;"
											>
												<!-- Config salarial usada -->
												{#if config}
													<div
														class="mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
														style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(79, 70, 229, 0.04)); border: 1px solid rgba(99, 102, 241, 0.15);"
													>
														<Settings2 class="h-3.5 w-3.5" style="color: #4F46E5;" />
														<span
															style="font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #4338CA; font-family: 'JetBrains Mono', monospace;"
														>
															Config destinada
														</span>
														<span style="font-size: 0.75rem; color: #312E81;">
															{fmtConfigLabel(config)}
														</span>
														{#if config.paga_dias_festivos}
															<span
																style="display: inline-flex; align-items: center; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #92400E; background: rgba(245, 158, 11, 0.10); padding: 0.15rem 0.5rem; border-radius: 6px; font-family: 'JetBrains Mono', monospace;"
															>
																Paga festivos: {config.porcentaje_festivos}%
															</span>
														{/if}
														<!-- Botón recalcular con config vigente -->
														<button
															onclick={() => handleRecalcular(planilla.planilla_id)}
															disabled={recalculandoPlanillas.has(planilla.planilla_id)}
															class="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono-meta transition-all disabled:cursor-not-allowed disabled:opacity-60"
															style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #4338CA; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25);"
															title="Re-procesa este recargo con la config salarial y los % de tipos vigentes en cada día (no modifica las horas de los días)"
														>
															{#if recalculandoPlanillas.has(planilla.planilla_id)}
																<Loader2 class="h-3 w-3 animate-spin" />
																Recalculando...
															{:else}
																<RefreshCw class="h-3 w-3" />
																Recalcular con config vigente
															{/if}
														</button>
													</div>
												{/if}

												<!-- Días -->
												<div class="space-y-1.5">
													{#each planilla.dias || [] as dia (dia.fecha + dia.dia)}
														{@const diaKey = `${planilla.planilla_id}-${dia.fecha}-${dia.dia}`}
														{@const isDiaExpanded = expandedDias.has(diaKey)}
														{@const isDisp = dia.disponibilidad}
														{@const fechaFmt = normalizarFecha(dia.fecha)}
														{@const diaSemana = fechaFmt.diaNum >= 0 ? DIAS_SEMANA[fechaFmt.diaNum] : ''}
														<div
															class="overflow-hidden rounded-lg border"
															style="border-color: {isDisp
																? 'rgba(0, 0, 0, 0.06)'
																: isDiaExpanded
																	? 'rgba(16, 185, 129, 0.30)'
																	: 'rgba(0, 0, 0, 0.08)'}; background-color: {isDisp
																? 'rgba(0, 0, 0, 0.02)'
																: 'white'};"
														>
															<button
																onclick={() => !isDisp && toggleDia(diaKey)}
																class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors"
																disabled={isDisp}
																style={isDisp
																	? 'cursor: default;'
																	: 'cursor: pointer;'}
															>
																<div class="flex min-w-0 items-center gap-2.5">
																	<div
																		class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono-meta"
																		style="font-size: 0.65rem; font-weight: 700; background: {isDisp
																			? '#F3F4F6'
																			: dia.es_festivo
																				? 'rgba(245, 158, 11, 0.12)'
																				: dia.es_domingo
																					? 'rgba(168, 85, 247, 0.10)'
																					: 'rgba(16, 185, 129, 0.08)'}; color: {isDisp
																			? '#9CA3AF'
																			: dia.es_festivo
																				? '#92400E'
																				: dia.es_domingo
																					? '#6B21A8'
																					: '#047857'};"
																	>
																		{String(dia.dia).padStart(2, '0')}
																	</div>
																	<div class="min-w-0">
																		<div class="flex flex-wrap items-center gap-1.5">
																				<span style="font-size: 0.78rem; font-weight: 600; color: {isDisp ? '#9CA3AF' : '#0F1F1A'};">
																					{diaSemana} {fechaFmt.corta}
																				</span>
																			<span style="font-size: 0.7rem; color: #6B7280;">
																				{dia.nombre_dia}
																			</span>
																			{#if dia.es_festivo}
																				<span
																					style="display: inline-flex; align-items: center; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #92400E; background: rgba(245, 158, 11, 0.12); padding: 0.1rem 0.45rem; border-radius: 4px; font-family: 'JetBrains Mono', monospace;"
																				>
																					🎉 Festivo
																				</span>
																			{:else if dia.es_domingo}
																				<span
																					style="display: inline-flex; align-items: center; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B21A8; background: rgba(168, 85, 247, 0.10); padding: 0.1rem 0.45rem; border-radius: 4px; font-family: 'JetBrains Mono', monospace;"
																				>
																					Dom
																				</span>
																			{/if}
																			{#if isDisp}
																				<span
																					style="display: inline-flex; align-items: center; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; background: rgba(0, 0, 0, 0.05); padding: 0.1rem 0.45rem; border-radius: 4px; font-family: 'JetBrains Mono', monospace;"
																				>
																					Disponible
																				</span>
																			{/if}
																		</div>
																		<div class="mt-0.5" style="font-size: 0.7rem; color: #6B7280;">
																			{#if !isDisp}
																				{fmtHoraDecimal(dia.hora_inicio)} → {fmtHoraDecimal(dia.hora_fin)}
																				<span style="color: #0F1F1A; font-weight: 600;">· {fmtHoras(dia.total_horas)}</span>
																			{:else}
																				Sin horas trabajadas
																			{/if}
																		</div>
																	</div>
																</div>
																<div class="flex shrink-0 items-center gap-2">
																	{#if !isDisp && (dia.recargos?.length || 0) > 0}
																		<div class="text-right">
																			<p style="font-size: 0.85rem; font-weight: 700; color: #047857;">
																				{fmtCOP(dia.total_valor_dia)}
																			</p>
																			<p style="font-size: 0.6rem; color: #6B7280;">
																				{dia.recargos.length} tipo{dia.recargos.length !== 1 ? 's' : ''}
																			</p>
																		</div>
																		<div style="color: {isDiaExpanded ? '#10B981' : '#9CA3AF'};">
																			{#if isDiaExpanded}
																				<ChevronDown class="h-4 w-4" />
																			{:else}
																				<ChevronRight class="h-4 w-4" />
																			{/if}
																		</div>
																	{:else}
																		<span style="font-size: 0.7rem; color: #9CA3AF;">—</span>
																	{/if}
																</div>
															</button>

															<!-- Detalle del día -->
															{#if isDiaExpanded && !isDisp && (dia.recargos?.length || 0) > 0}
																<div
																	class="border-t px-3 py-2"
																	style="border-color: rgba(16, 185, 129, 0.15); background-color: #F9FAFB;"
																>
																	<table class="w-full" style="font-size: 0.7rem;">
																		<thead>
																			<tr style="color: #6B7280;">
																				<th class="py-1 text-left font-mono-meta" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;">Tipo</th>
																				<th class="py-1 text-right font-mono-meta" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;">Horas</th>
																				<th class="py-1 text-right font-mono-meta" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;">%</th>
																				<th class="py-1 text-right font-mono-meta" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;">$/h base</th>
																				<th class="py-1 text-right font-mono-meta" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;">$/h aplicada</th>
																				<th class="py-1 text-right font-mono-meta" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;">Valor</th>
																			</tr>
																		</thead>
																		<tbody>
																			{#each dia.recargos as r}
																				{@const c = colorTipo(r.tipo_codigo)}
																				<tr style="border-top: 1px dashed rgba(0, 0, 0, 0.06);">
																					<td class="py-1.5">
																						<div class="flex items-center gap-1.5">
																							<span
																								style="display: inline-block; width: 4px; height: 18px; border-radius: 2px; background-color: {c.bar};"
																							></span>
																							<div>
																								<p style="font-weight: 700; color: {c.fg}; font-family: 'JetBrains Mono', monospace; font-size: 0.7rem;">
																									{r.tipo_codigo}
																								</p>
																								<p style="font-size: 0.65rem; color: #6B7280;">
																									{r.tipo_nombre}
																								</p>
																							</div>
																							{#if r.adicional}
																								<span
																									style="font-size: 0.55rem; color: #9333EA; background: rgba(168, 85, 247, 0.08); padding: 0.05rem 0.3rem; border-radius: 3px; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.04em;"
																								>
																									Adic
																								</span>
																							{/if}
																						</div>
																					</td>
																					<td class="py-1.5 text-right font-mono-meta" style="font-weight: 600; color: #0F1F1A;">
																						{fmtHoras(r.horas)}
																					</td>
																					<td class="py-1.5 text-right font-mono-meta" style="color: #6B7280;">
																						{r.porcentaje}%
																					</td>
																					<td class="py-1.5 text-right font-mono-meta" style="color: #6B7280;">
																						{fmtCOPPlain(r.valor_hora_base)}
																					</td>
																					<td class="py-1.5 text-right font-mono-meta" style="color: #6B7280;">
																						{fmtCOPPlain(r.valor_hora_calculada)}
																					</td>
																					<td class="py-1.5 text-right font-mono-meta" style="font-weight: 700; color: #047857;">
																						{fmtCOP(r.valor_total)}
																					</td>
																				</tr>
																			{/each}
																			<tr style="border-top: 2px solid rgba(16, 185, 129, 0.30);">
																				<td colspan="5" class="py-1.5 text-right" style="font-size: 0.7rem; font-weight: 600; color: #0F1F1A;">
																					Total día
																				</td>
																				<td class="py-1.5 text-right font-display" style="font-weight: 700; color: #047857; font-size: 0.85rem;">
																					{fmtCOP(dia.total_valor_dia)}
																				</td>
																			</tr>
																		</tbody>
																	</table>
																</div>
															{/if}
														</div>
													{/each}
												</div>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						<!-- ══════ TAB: Por empresa ══════ -->
						{#if tabActiva === 'empresa'}
							{@const resumen = resumenPorEmpresa()}
							<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
								<table class="w-full" style="font-size: 0.8rem;">
									<thead style="background-color: #F9FAFB;">
										<tr>
											<th class="px-4 py-2.5 text-left" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">
												<Building2 class="mr-1 inline h-3 w-3" /> Empresa
											</th>
											<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Planillas</th>
											<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Días</th>
											<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Horas</th>
											<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Total</th>
											<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">% del total</th>
										</tr>
									</thead>
									<tbody>
										{#each resumen as r}
											{@const pct = statsPeriodo.totalRecargos ? (r.total / statsPeriodo.totalRecargos) * 100 : 0}
											<tr class="transition-colors hover:bg-gray-50" style="border-top: 1px solid rgba(0, 0, 0, 0.06);">
												<td class="px-4 py-2.5" style="font-weight: 600; color: #0F1F1A;">{r.empresaNombre}</td>
												<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #6B7280;">{r.planillas}</td>
												<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #0F1F1A;">{r.dias}</td>
												<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #0F1F1A;">{fmtHoras(r.horas)}</td>
												<td class="px-4 py-2.5 text-right font-display" style="font-weight: 700; color: #047857;">{fmtCOP(r.total)}</td>
												<td class="px-4 py-2.5 text-right" style="min-width: 140px;">
													<div class="flex items-center justify-end gap-2">
														<div class="h-1.5 w-16 overflow-hidden rounded-full" style="background-color: rgba(16, 185, 129, 0.12);">
															<div
																class="h-full rounded-full"
																style="width: {pct}%; background: linear-gradient(90deg, #10B981, #059669);"
															></div>
														</div>
														<span class="font-mono-meta" style="font-size: 0.7rem; color: #6B7280; min-width: 36px; text-align: right;">
															{pct.toFixed(1)}%
														</span>
													</div>
												</td>
											</tr>
										{/each}
									</tbody>
									<tfoot>
										<tr style="background-color: #F9FAFB; border-top: 2px solid rgba(0, 0, 0, 0.08);">
											<td class="px-4 py-2.5" style="font-weight: 700; color: #0F1F1A;">Total</td>
											<td class="px-4 py-2.5 text-right font-mono-meta" style="font-weight: 700; color: #0F1F1A;">
												{resumen.reduce((s, r) => s + r.planillas, 0)}
											</td>
											<td class="px-4 py-2.5 text-right font-mono-meta" style="font-weight: 700; color: #0F1F1A;">
												{resumen.reduce((s, r) => s + r.dias, 0)}
											</td>
											<td class="px-4 py-2.5 text-right font-mono-meta" style="font-weight: 700; color: #0F1F1A;">
												{fmtHoras(resumen.reduce((s, r) => s + r.horas, 0))}
											</td>
											<td class="px-4 py-2.5 text-right font-display" style="font-weight: 700; color: #047857;">
												{fmtCOP(resumen.reduce((s, r) => s + r.total, 0))}
											</td>
											<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #6B7280;">100%</td>
										</tr>
									</tfoot>
								</table>
							</div>
						{/if}

						<!-- ══════ TAB: Por vehículo ══════ -->
						{#if tabActiva === 'vehiculo'}
							{@const resumen = resumenPorVehiculo()}
							<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
								<table class="w-full" style="font-size: 0.8rem;">
									<thead style="background-color: #F9FAFB;">
										<tr>
											<th class="px-4 py-2.5 text-left" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">
												<Truck class="mr-1 inline h-3 w-3" /> Vehículo (placa)
											</th>
											<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Planillas</th>
											<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Días</th>
											<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Horas</th>
											<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Total</th>
										</tr>
									</thead>
									<tbody>
										{#each resumen as r}
											<tr class="transition-colors hover:bg-gray-50" style="border-top: 1px solid rgba(0, 0, 0, 0.06);">
												<td class="px-4 py-2.5" style="font-weight: 600; color: #0F1F1A;">{r.vehiculoPlaca}</td>
												<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #6B7280;">{r.planillas}</td>
												<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #0F1F1A;">{r.dias}</td>
												<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #0F1F1A;">{fmtHoras(r.horas)}</td>
												<td class="px-4 py-2.5 text-right font-display" style="font-weight: 700; color: #047857;">{fmtCOP(r.total)}</td>
											</tr>
										{/each}
									</tbody>
									<tfoot>
										<tr style="background-color: #F9FAFB; border-top: 2px solid rgba(0, 0, 0, 0.08);">
											<td class="px-4 py-2.5" style="font-weight: 700; color: #0F1F1A;">Total</td>
											<td class="px-4 py-2.5 text-right font-mono-meta" style="font-weight: 700; color: #0F1F1A;">
												{resumen.reduce((s, r) => s + r.planillas, 0)}
											</td>
											<td class="px-4 py-2.5 text-right font-mono-meta" style="font-weight: 700; color: #0F1F1A;">
												{resumen.reduce((s, r) => s + r.dias, 0)}
											</td>
											<td class="px-4 py-2.5 text-right font-mono-meta" style="font-weight: 700; color: #0F1F1A;">
												{fmtHoras(resumen.reduce((s, r) => s + r.horas, 0))}
											</td>
											<td class="px-4 py-2.5 text-right font-display" style="font-weight: 700; color: #047857;">
												{fmtCOP(resumen.reduce((s, r) => s + r.total, 0))}
											</td>
										</tr>
									</tfoot>
								</table>
							</div>
						{/if}

						<!-- ══════ TAB: Por mes ══════ -->
						{#if tabActiva === 'mes'}
							{@const resumen = resumenPorMes()}
							<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{#each resumen as r}
									<div
										class="rounded-xl border bg-white p-4 transition-shadow hover:shadow-md"
										style="border-color: rgba(0, 0, 0, 0.08);"
									>
										<div class="mb-2 flex items-center gap-2">
											<Calendar class="h-3.5 w-3.5" style="color: #047857;" />
											<p class="font-display" style="font-size: 1rem; font-weight: 600; color: #0F1F1A;">
												{r.mesLabel}
											</p>
										</div>
										<p
											class="font-display"
											style="font-size: 1.3rem; font-weight: 700; color: #047857; line-height: 1.1;"
										>
											{fmtCOP(r.total)}
										</p>
										<div
											class="mt-2 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2"
											style="font-size: 0.7rem; color: #6B7280;"
										>
											<div>
												<p style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;">Planillas</p>
												<p style="font-weight: 600; color: #0F1F1A;">{r.planillas}</p>
											</div>
											<div>
												<p style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;">Días</p>
												<p style="font-weight: 600; color: #0F1F1A;">{r.dias}</p>
											</div>
											<div>
												<p style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;">Horas</p>
												<p style="font-weight: 600; color: #0F1F1A;">{fmtHoras(r.horas)}</p>
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}

						<!-- ══════ TAB: Por tipo ══════ -->
						{#if tabActiva === 'tipo'}
							{@const resumen = resumenPorTipo()}
							{@const codigosUnicos = Array.from(new Set(resumen.map((r) => r.codigo)))}
							{@const porcentajesPorCodigo = codigosUnicos.map((codigo) => ({
								codigo,
								filas: resumen.filter((r) => r.codigo === codigo)
							}))}
							{@const granTotalHoras = resumen.reduce((s, r) => s + r.totalHoras, 0)}
							{@const granTotalValor = resumen.reduce((s, r) => s + r.totalValor, 0)}
							{@const hayMultiplesTarifas = resumen.length > codigosUnicos.length}
							<div class="space-y-3">
								<!-- Banner explicativo cuando hay más de una tarifa por tipo -->
								{#if hayMultiplesTarifas}
									<div
										class="flex items-start gap-2 rounded-lg px-3 py-2"
										style="background: linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(217, 119, 6, 0.04)); border: 1px solid rgba(245, 158, 11, 0.25);"
									>
										<Settings2 class="mt-0.5 h-3.5 w-3.5 shrink-0" style="color: #B45309;" />
										<p style="font-size: 0.72rem; color: #78350F; line-height: 1.4;">
											<strong style="font-weight: 700;">Cambio de tarifario detectado.</strong>
											El mismo tipo de recargo se calculó con porcentajes distintos según el
											día (ej: tarifario viejo y nuevo vigentes en el mismo período). Cada fila
											muestra el total generado a ese %.
										</p>
									</div>
								{/if}

								<!-- Tabla principal: una fila por (tipo, %) -->
								<div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
									<table class="w-full" style="font-size: 0.8rem;">
										<thead style="background-color: #F9FAFB;">
											<tr>
												<th class="px-4 py-2.5 text-left" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">
													<Settings2 class="mr-1 inline h-3 w-3" /> Tipo de recargo
												</th>
												<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">% aplicado</th>
												<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Categoría</th>
												<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Horas</th>
												<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Días</th>
												<th class="px-4 py-2.5 text-right" style="font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-family: 'JetBrains Mono', monospace;">Total</th>
											</tr>
										</thead>
										<tbody>
											{#each porcentajesPorCodigo as grupo}
												{#each grupo.filas as r, idxFila}
													{@const c = colorTipo(r.codigo)}
													{@const totalPorCodigo = grupo.filas.reduce((s, x) => s + x.totalHoras, 0)}
													{@const pctGrupoHoras = totalPorCodigo > 0 ? (r.totalHoras / totalPorCodigo) * 100 : 0}
													<tr
														class="transition-colors hover:bg-gray-50"
														style="border-top: {idxFila === 0 ? '1px solid rgba(0, 0, 0, 0.06)' : '1px dashed rgba(0, 0, 0, 0.04)'};"
													>
														<td class="px-4 py-2.5">
															<div class="flex items-center gap-2">
																<span
																	style="display: inline-block; width: 4px; height: {grupo.filas.length > 1 ? '18px' : '22px'}; border-radius: 2px; background-color: {c.bar};"
																></span>
																<div>
																	<p style="font-weight: 700; color: {c.fg}; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem;">
																		{r.codigo}
																	</p>
																	<p style="font-size: 0.7rem; color: #6B7280;">{r.nombre}</p>
																</div>
															</div>
														</td>
														<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #0F1F1A; font-weight: 600;">
															<span
																style="display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; font-weight: 700; {grupo.filas.length > 1 ? `background: ${c.bg}; color: ${c.fg};` : ''}"
															>
																{r.porcentaje}%
															</span>
														</td>
														<td class="px-4 py-2.5 text-right" style="font-size: 0.7rem; color: #6B7280;">
															{r.esHoraExtra ? 'Hora extra' : 'Recargo'}
														</td>
														<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #0F1F1A; font-weight: 600;">
															{fmtHoras(r.totalHoras)}
															{#if grupo.filas.length > 1}
																<div
																	class="mt-1 h-1 w-16 overflow-hidden rounded-full"
																	style="background-color: {c.bg}; margin-left: auto;"
																>
																	<div
																		class="h-full rounded-full"
																		style="width: {pctGrupoHoras}%; background-color: {c.bar};"
																	></div>
																</div>
															{/if}
														</td>
														<td class="px-4 py-2.5 text-right font-mono-meta" style="color: #6B7280;">
															{r.dias.size}
														</td>
														<td class="px-4 py-2.5 text-right font-display" style="font-weight: 700; color: #047857;">
															{fmtCOP(r.totalValor)}
														</td>
													</tr>
												{/each}
												<!-- Subtotal por código cuando hay varias tarifas -->
												{#if grupo.filas.length > 1}
													{@const subTotalHoras = grupo.filas.reduce((s, x) => s + x.totalHoras, 0)}
													{@const subTotalValor = grupo.filas.reduce((s, x) => s + x.totalValor, 0)}
													<tr style="background-color: rgba(0, 0, 0, 0.015);">
														<td colspan="3" class="px-4 py-1.5 text-right" style="font-size: 0.65rem; font-weight: 600; color: #6B7280; text-transform: uppercase; letter-spacing: 0.04em;">
															Subtotal {grupo.codigo} (todas las tarifas)
														</td>
														<td class="px-4 py-1.5 text-right font-mono-meta" style="font-size: 0.72rem; font-weight: 600; color: #374151;">
															{fmtHoras(subTotalHoras)}
														</td>
														<td class="px-4 py-1.5 text-right" style="font-size: 0.72rem; color: #6B7280;">—</td>
														<td class="px-4 py-1.5 text-right font-mono-meta" style="font-size: 0.75rem; font-weight: 700; color: #047857;">
															{fmtCOP(subTotalValor)}
														</td>
													</tr>
												{/if}
											{/each}
										</tbody>
										<tfoot>
											<tr style="background-color: #F9FAFB; border-top: 2px solid rgba(0, 0, 0, 0.08);">
												<td class="px-4 py-2.5" style="font-weight: 700; color: #0F1F1A;">Total general</td>
												<td class="px-4 py-2.5"></td>
												<td class="px-4 py-2.5"></td>
												<td class="px-4 py-2.5 text-right font-mono-meta" style="font-weight: 700; color: #0F1F1A;">
													{fmtHoras(granTotalHoras)}
												</td>
												<td class="px-4 py-2.5 text-right" style="font-size: 0.7rem; color: #6B7280;">
													{resumen.reduce((s, r) => s + r.dias.size, 0)}
												</td>
												<td class="px-4 py-2.5 text-right font-display" style="font-weight: 700; color: #047857;">
													{fmtCOP(granTotalValor)}
												</td>
											</tr>
										</tfoot>
									</table>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- ═══ FOOTER ═══ -->
			<div
				class="flex-shrink-0 px-6 py-3"
				style="background: linear-gradient(180deg, #F9FAFB 0%, #F3F4F6 100%); border-top: 1px solid rgba(0, 0, 0, 0.08);"
			>
				<div class="flex items-center justify-between gap-3">
					<p style="font-size: 0.7rem; color: #6B7280;">
						💡 Cada fila muestra la configuración salarial que se aplicó en su día correspondiente
						(snapshot inmutable).
					</p>
					<button
						onclick={cerrar}
						class="font-mono-meta rounded-lg px-4 py-2 transition-colors"
						style="font-size: 0.75rem; font-weight: 600; color: white; background: #0F1F1A; text-transform: uppercase; letter-spacing: 0.04em;"
					>
						Cerrar
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
