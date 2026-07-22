<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { apiClient } from '$lib/api/apiClient';
	import {
		liquidacionesTercerosDescuentosAPI,
		type ConceptoDescuento,
		type ConfiguracionDescuento,
		type GenerarBorradorResult,
		type AdicionalTransmeralda
	} from '$lib/api/liquidaciones-terceros-descuentos';
	import type { Vehiculo } from '$lib/types/nomina';
	import ModalSelectConductor from '$lib/components/ui/ModalSelectConductor.svelte';
	import BorradorProgressModal from '$lib/components/liquidaciones-terceros/BorradorProgressModal.svelte';
	import { borradorQueue } from '$lib/stores/borradorQueue';

	// Cleanup del callback actualmente registrado en borradorQueue.
	// Se ejecuta antes de registrar uno nuevo, al desmontar el componente
	// y cuando el callback se auto-consume. Evita la acumulación de
	// callbacks en el array module-level `completeCallbacks` del store,
	// que era la causa de los N INSERTs concurrentes con el mismo
	// consecutivo (N = veces que se montó/llamó generarBorrador).
	let currentOnCompleteCleanup: (() => void) | null = null;

	function clearOnComplete() {
		if (currentOnCompleteCleanup) {
			try {
				currentOnCompleteCleanup();
			} catch {
				/* ignore */
			}
			currentOnCompleteCleanup = null;
		}
	}

	const MESES = [
		'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
		'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
	];
	const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - 1 + i);

	function fmtPlaca(p: string): string {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s || '—';
	}

	// ─── VEHICLE SELECTION STATE ──────────────────────────────────
	let vehiculos: Vehiculo[] = $state([]);
	let placaSearch = $state('');
	let placaDropdown = $state(false);
	let placaHighlight = $state(0);
	let selectedVehiculo: Vehiculo | null = $state(null);

	// Posición computada del dropdown (position: fixed) para escapar
	// el clip de `overflow-y-auto` de la página raíz. Mismo patrón
	// que `SelectBuscable` (servicios) pero en fixed.
	let placaDropdownPos = $state({ top: 0, left: 0, width: 0 });

	function updatePlacaDropdownPos() {
		if (!placaInputEl) return;
		const rect = placaInputEl.getBoundingClientRect();
		placaDropdownPos = {
			top: rect.bottom + 4,
			left: rect.left,
			width: rect.width
		};
	}

	let selectedMes = $state(MESES[new Date().getMonth()]);
	let selectedAnio = $state(new Date().getFullYear());

	let generating = $state(false);
	let error = $state('');

	// ─── BORRADOR STATE (shared with ExcelCanvasModal) ────────────
	let borradorResults: GenerarBorradorResult[] = $state([]);
	let excludedItemKeys: Set<string> = $state(new Set());
	let configDescuentos: ConfiguracionDescuento[] = $state([]);
	let nominaLoading = $state(false);
	let guardandoPlaca: number | null = $state(null);

	let conductorNameInputs: Record<string, string> = $state({});
	let conductorFromNomina: Record<string, boolean> = $state({});
	let adicionalesPorPlaca: Record<number, AdicionalTransmeralda[]> = $state({});
	let adicionalesTrigger = $state(0);
	function triggerAdicionalesUpdate() { adicionalesTrigger++; }

	let placasTrigger = $state(0);
	function triggerPlacasUpdate() { placasTrigger++; }

	// ─── DERIVED DATA ─────────────────────────────────────────────
	interface TerceroItem {
		tercero: GenerarBorradorResult['terceros'][number];
		liquidacion_servicio: GenerarBorradorResult['liquidacion_servicio'];
		resultIndex: number;
		terceroIndex: number;
		excluded: boolean;
		excludeKey: string;
	}

	function buildTodosTerceros(results: GenerarBorradorResult[], excluded: Set<string>): TerceroItem[] {
		const items: TerceroItem[] = [];
		results.forEach((result, ri) => {
			result.terceros.forEach((tercero, ti) => {
				const ltOriginalId = (tercero.liquidacion_tercero as any)?.liquidacion_tercero_id_original;
				const excludeKey = `${result.liquidacion_servicio.id}::${ltOriginalId || 'unknown'}`;
				items.push({
					tercero,
					liquidacion_servicio: result.liquidacion_servicio,
					resultIndex: ri,
					terceroIndex: ti,
					excluded: excluded.has(excludeKey),
					excludeKey
				});
			});
		});
		return items;
	}

	let todosTerceros: ReturnType<typeof buildTodosTerceros> = $derived(
		buildTodosTerceros(borradorResults, excludedItemKeys)
	);
	let todosTercerosIncluidos = $derived(todosTerceros.filter((t) => !t.excluded));

	let placasUnicas: Array<{
		placa: string;
		nombre: string;
		lt: any;
		conceptos: ConceptoDescuento[];
		totalCostosLaborales: number;
		totalGastosOperativos: number;
		totalImpuestos: number;
		totalDesc: number;
		valorLiquidar: number;
	}> = $derived.by(() => {
		void placasTrigger;
		const map = new Map<string, {
			placa: string;
			nombre: string;
			lt: any;
			conceptos: ConceptoDescuento[];
			totalCostosLaborales: number;
			totalGastosOperativos: number;
			totalImpuestos: number;
			totalDesc: number;
			valorLiquidar: number;
		}>();

		for (const item of todosTerceros) {
			const lt = item.tercero.liquidacion_tercero || {};
			const placa = item.tercero.placa;
			const existing = map.get(placa);

			if (!existing) {
				map.set(placa, {
					placa,
					nombre: lt.tercero?.nombre_completo || 'Sin asignar',
					lt,
					conceptos: item.tercero.conceptos || [],
					totalCostosLaborales: lt.total_costos_laborales || 0,
					totalGastosOperativos: lt.total_gastos_operativos || 0,
					totalImpuestos: lt.total_impuestos || 0,
					totalDesc: (lt.total_costos_laborales || 0) + (lt.total_gastos_operativos || 0) + (lt.total_impuestos || 0),
					valorLiquidar: lt.valor_liquidar || 0,
				});
			} else {
				existing.valorLiquidar += lt.valor_liquidar || 0;
			}
		}

		return Array.from(map.values());
	});

	// ─── ADICIONALES ──────────────────────────────────────────────
	function addAdicionalRow(placaIdx: number) {
		const placa = placasUnicas[placaIdx];
		if (!placa) return;
		const nuevo: AdicionalTransmeralda = {
			id: crypto.randomUUID(),
			cliente: 'COTRANSMEQ',
			placa: placa.placa,
			tercero_nombre: placa.nombre || '',
			recorrido: '',
			fechas: '',
			valor_unitario: 0,
			cantidad: 1,
			valor_liquidar: 0,
		};
		adicionalesPorPlaca = {
			...adicionalesPorPlaca,
			[placaIdx]: [...(adicionalesPorPlaca[placaIdx] || []), nuevo],
		};
		triggerAdicionalesUpdate();
	}

	function deleteAdicional(placaIdx: number, idx: number) {
		const list = [...(adicionalesPorPlaca[placaIdx] || [])];
		list.splice(idx, 1);
		adicionalesPorPlaca = {
			...adicionalesPorPlaca,
			[placaIdx]: list,
		};
		triggerAdicionalesUpdate();
	}

	function updateAdicionalField<K extends keyof AdicionalTransmeralda>(
		placaIdx: number,
		idx: number,
		field: K,
		value: AdicionalTransmeralda[K],
	) {
		const list = [...(adicionalesPorPlaca[placaIdx] || [])];
		const current = list[idx];
		if (!current) return;
		const next: AdicionalTransmeralda = { ...current, [field]: value };
		if (field === 'valor_unitario' || field === 'cantidad') {
			const vUnit = Number(next.valor_unitario) || 0;
			const cant = Number(next.cantidad) || 0;
			next.valor_liquidar = vUnit * cant;
		}
		list[idx] = next;
		adicionalesPorPlaca = {
			...adicionalesPorPlaca,
			[placaIdx]: list,
		};
		triggerAdicionalesUpdate();
	}

	$effect(() => {
		hydrateAdicionalesFromBorrador(borradorResults);
	});

	function hydrateAdicionalesFromBorrador(results: GenerarBorradorResult[]) {
		if (!results || results.length === 0) {
			adicionalesPorPlaca = {};
			return;
		}
		const next: Record<number, AdicionalTransmeralda[]> = {};
		placasUnicas.forEach((placa, idx) => {
			for (const r of results) {
				for (const t of r.terceros || []) {
					if (
						t.placa === placa.placa &&
						Array.isArray(t.items_adicionales) &&
						t.items_adicionales.length > 0
					) {
						next[idx] = t.items_adicionales.map((a) => ({ ...a }));
						return;
					}
				}
			}
		});
		adicionalesPorPlaca = next;
	}

	// ─── EXCLUDE / UNEXCLUDE ──────────────────────────────────────
	function makeItemKey(liqServicioId: string, ltOriginalId: string | undefined | null): string {
		return `${liqServicioId}::${ltOriginalId || 'unknown'}`;
	}

	function toggleExcludeItem(liqServicioId: string, ltOriginalId: string | undefined | null) {
		const key = makeItemKey(liqServicioId, ltOriginalId);
		const next = new Set(excludedItemKeys);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		excludedItemKeys = next;
	}

	// ─── SYNC CONDUCTOR FROM NOMINA ───────────────────────────────
	$effect(() => {
		syncConductorFromNomina(placasUnicas);
	});

	function syncConductorFromNomina(placas: typeof placasUnicas) {
		let changed = false;
		const next = { ...conductorFromNomina };
		placas.forEach((placa, idx) => {
			for (const c of placa.conceptos || []) {
				if (c.tipo !== 'COSTO_LABORAL' || !c.conductor_id || !c.conductor) continue;
				const key = `${idx}::${c.conductor_id}`;
				if (!(key in next)) {
					next[key] = true;
					changed = true;
				}
			}
		});
		if (changed) conductorFromNomina = next;
	}

	// ─── CONCEPT HELPERS ──────────────────────────────────────────
	function syncConceptosToSource(placaPlaca: string, conceptos: ConceptoDescuento[]) {
		const itemsDeLaPlaca = todosTerceros.filter(t => t.tercero.placa === placaPlaca);
		for (const it of itemsDeLaPlaca) {
			it.tercero.conceptos = [...conceptos];
		}
	}

	function recalcularPlacaTotals(placa: any) {
		placa.totalCostosLaborales = placa.conceptos.filter(c => c.tipo === 'COSTO_LABORAL').reduce((s, c) => s + (c.valor_total || 0), 0);
		placa.totalGastosOperativos = placa.conceptos.filter(c => c.tipo === 'GASTO_OPERATIVO').reduce((s, c) => s + (c.valor_total || 0), 0);
		placa.totalImpuestos = placa.conceptos.filter(c => c.tipo === 'IMPUESTO').reduce((s, c) => s + (c.valor_total || 0), 0);
		placa.totalDesc = placa.totalCostosLaborales + placa.totalGastosOperativos + placa.totalImpuestos;
	}

	function getConductorGrupos(conceptos: ConceptoDescuento[]) {
		const SALARIOS = ['SALARIO', 'AUXILIO_TRANSPORTE', 'BONIFICACION', 'OTROS_AUXILIOS', 'RECARGOS'];
		const PRESTACIONES_CON_AUX = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA'];
		const PRESTACIONES_SIN_AUX = ['VACACIONES'];
		const SEGURIDAD = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];

		const conductorBases = new Map<string, { basePrest: number; baseSinAux: number }>();
		for (const c of conceptos) {
			if (c.tipo !== 'COSTO_LABORAL') continue;
			const key = c.conductor_id || 'sin-conductor';
			if (!conductorBases.has(key)) {
				conductorBases.set(key, { basePrest: 0, baseSinAux: 0 });
			}
			const bases = conductorBases.get(key)!;
			if (['SALARIO', 'AUXILIO_TRANSPORTE', 'RECARGOS'].includes(c.concepto)) {
				bases.basePrest += c.valor_total || 0;
			}
			if (['SALARIO', 'RECARGOS'].includes(c.concepto)) {
				bases.baseSinAux += c.valor_total || 0;
			}
		}

		for (const c of conceptos) {
			if (c.tipo !== 'COSTO_LABORAL') continue;
			const key = c.conductor_id || 'sin-conductor';
			const bases = conductorBases.get(key);
			if (!bases) continue;
			if (PRESTACIONES_CON_AUX.includes(c.concepto)) {
				c.base_calculo = bases.basePrest;
				c.valor_total = bases.basePrest * ((c.porcentaje || 0) / 100);
			} else if (PRESTACIONES_SIN_AUX.includes(c.concepto) || SEGURIDAD.includes(c.concepto)) {
				c.base_calculo = bases.baseSinAux;
				c.valor_total = bases.baseSinAux * ((c.porcentaje || 0) / 100);
			}
		}

		const map = new Map<string | null, {
			nombre: string;
			conceptos: ConceptoDescuento[];
			salarios: ConceptoDescuento[];
			prestaciones: ConceptoDescuento[];
			seguridadSocial: ConceptoDescuento[];
			totalConductor: number;
		}>();

		for (const c of conceptos.filter(c => c.tipo === 'COSTO_LABORAL')) {
			const key = c.conductor_id || 'sin-conductor';
			const nombre = c.conductor
				? `${c.conductor.nombre} ${c.conductor.apellido}`
				: 'General / Consolidado';

			if (!map.has(key)) {
				map.set(key, { nombre, conceptos: [], salarios: [], prestaciones: [], seguridadSocial: [], totalConductor: 0 });
			}
			const grupo = map.get(key)!;
			grupo.conceptos.push(c);
			grupo.totalConductor += c.valor_total || 0;

			if (SALARIOS.includes(c.concepto)) {
				grupo.salarios.push(c);
			} else if (PRESTACIONES_CON_AUX.includes(c.concepto) || PRESTACIONES_SIN_AUX.includes(c.concepto)) {
				grupo.prestaciones.push(c);
			} else if (SEGURIDAD.includes(c.concepto)) {
				grupo.seguridadSocial.push(c);
			}
		}

		return Array.from(map.values());
	}

	function updateConceptoDiasPorPlaca(placaIdx: number, conceptoIdx: number, newDias: number) {
		const placa = placasUnicas[placaIdx];
		if (!placa) return;
		const conceptos = placa.conceptos;
		if (!conceptos || !conceptos[conceptoIdx]) return;
		const c = conceptos[conceptoIdx];
		conceptos[conceptoIdx] = { ...c, dias: newDias };
		if (c.valor_unitario) {
			conceptos[conceptoIdx].valor_total = newDias * c.valor_unitario;
		}
		recalcularPlacaTotals(placa);
		syncConceptosToSource(placa.placa, conceptos);
		triggerPlacasUpdate();
	}

	function updateConceptoValorUnitarioPlaca(placaIdx: number, conceptoIdx: number, newValorUnitario: number) {
		const placa = placasUnicas[placaIdx];
		if (!placa) return;
		const conceptos = placa.conceptos;
		if (!conceptos || !conceptos[conceptoIdx]) return;
		const c = conceptos[conceptoIdx];
		conceptos[conceptoIdx] = { ...c, valor_unitario: newValorUnitario };
		if (c.dias) {
			conceptos[conceptoIdx].valor_total = c.dias * newValorUnitario;
		}
		recalcularPlacaTotals(placa);
		syncConceptosToSource(placa.placa, conceptos);
		triggerPlacasUpdate();
	}

	function recalcularBasesPrestacionesSS(conceptos: ConceptoDescuento[]): void {
		const PRESTACIONES_CON_AUX = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA'];
		const PRESTACIONES_SIN_AUX = ['VACACIONES'];
		const SEGURIDAD = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];

		const conductorBases = new Map<string, { basePrest: number; baseSinAux: number }>();
		for (const c of conceptos) {
			if (c.tipo !== 'COSTO_LABORAL') continue;
			const key = c.conductor_id || 'sin-conductor';
			if (!conductorBases.has(key)) {
				conductorBases.set(key, { basePrest: 0, baseSinAux: 0 });
			}
			const bases = conductorBases.get(key)!;
			if (['SALARIO', 'AUXILIO_TRANSPORTE', 'RECARGOS'].includes(c.concepto)) {
				bases.basePrest += c.valor_total || 0;
			}
			if (['SALARIO', 'RECARGOS'].includes(c.concepto)) {
				bases.baseSinAux += c.valor_total || 0;
			}
		}

		for (const c of conceptos) {
			if (c.tipo !== 'COSTO_LABORAL') continue;
			const key = c.conductor_id || 'sin-conductor';
			const bases = conductorBases.get(key);
			if (!bases) continue;
			if (PRESTACIONES_CON_AUX.includes(c.concepto)) {
				c.base_calculo = bases.basePrest;
				c.valor_total = bases.basePrest * ((c.porcentaje || 0) / 100);
			} else if (PRESTACIONES_SIN_AUX.includes(c.concepto) || SEGURIDAD.includes(c.concepto)) {
				c.base_calculo = bases.baseSinAux;
				c.valor_total = bases.baseSinAux * ((c.porcentaje || 0) / 100);
			}
		}
	}

	// ─── NOMINA / IMPUESTOS / GUARDAR ─────────────────────────────
	async function autocompletarNominaPlaca(placaIdx: number) {
		const placa = placasUnicas[placaIdx];
		if (!placa) return;
		nominaLoading = true;
		try {
			const mesIdx = MESES.indexOf(selectedMes) + 1;
			const nomina = await liquidacionesTercerosDescuentosAPI.autocompletarNomina({
				placa: placa.placa,
				mes: mesIdx,
				anio: selectedAnio
			});

			if (nomina.conceptos.length > 0) {
				const itemsDeLaPlaca = todosTerceros.filter(t => t.tercero.placa === placa.placa);
				if (itemsDeLaPlaca.length === 0) return;

				const fuente = itemsDeLaPlaca[0].tercero.conceptos || [];
				const noLaborales = fuente.filter(c => c.tipo !== 'COSTO_LABORAL');
				const tieneImpuestosManuales = noLaborales.some(c => c.tipo === 'IMPUESTO');
				const nuevosConceptos = [
					...nomina.conceptos,
					...noLaborales,
					...(tieneImpuestosManuales ? [] : (nomina.conceptos_impuestos || []))
				];

				for (const it of itemsDeLaPlaca) {
					it.tercero.conceptos = [...nuevosConceptos];
				}

				const conductoresById = new Map<string, { nombre: string; identificacion: string }>();
				for (const c of nomina.conductores || []) {
					conductoresById.set(c.conductor_id, {
						nombre: c.nombre,
						identificacion: c.identificacion || ''
					});
				}

				for (const c of nomina.conceptos) {
					if (c.tipo !== 'COSTO_LABORAL' || !c.conductor_id) continue;
					const key = `${placaIdx}::${c.conductor_id}`;

					let conductorNombre = '';
					let numeroIdentificacion: string | null = null;
					if (c.conductor) {
						conductorNombre = `${c.conductor.nombre} ${c.conductor.apellido}`.trim();
						numeroIdentificacion = c.conductor.numero_identificacion || null;
					} else {
						const fb = conductoresById.get(c.conductor_id);
						if (fb) {
							conductorNombre = fb.nombre;
							numeroIdentificacion = fb.identificacion || null;
						}
					}

					conductorNameInputs[key] = conductorNombre;
					conductorFromNomina[key] = true;
				}
				conductorNameInputs = { ...conductorNameInputs };
				conductorFromNomina = { ...conductorFromNomina };

				recalcularPlacaTotals(placa);
				triggerPlacasUpdate();
			}
		} catch (e: any) {
			error = e.message || 'Error autocompletando desde nómina';
		} finally {
			nominaLoading = false;
		}
	}

	async function calcularImpuestosPlaca(placaIdx: number) {
		const placa = placasUnicas[placaIdx];
		if (!placa) return;
		const ltId = placa.lt?.id;
		if (!ltId) return;
		try {
			const impuestos = await liquidacionesTercerosDescuentosAPI.calcularImpuestos(ltId);
			const itemsDeLaPlaca = todosTerceros.filter(t => t.tercero.placa === placa.placa);
			if (itemsDeLaPlaca.length === 0) return;

			const fuente = itemsDeLaPlaca[0].tercero.conceptos || [];
			const noImpuestos = fuente.filter(c => c.tipo !== 'IMPUESTO');
			const nuevosConceptos = [...noImpuestos, ...impuestos];

			for (const it of itemsDeLaPlaca) {
				it.tercero.conceptos = [...nuevosConceptos];
			}
			recalcularPlacaTotals(placa);
			triggerPlacasUpdate();
		} catch (e: any) {
			error = e.message || 'Error calculando impuestos';
		}
	}

	async function guardarPlaca(placaIdx: number) {
		const placa = placasUnicas[placaIdx];
		if (!placa) return;
		guardandoPlaca = placaIdx;
		try {
			const itemsIncluidos = todosTercerosIncluidos
				.filter((t) => t.tercero.placa === placa.placa)
				.map((t) => (t.tercero.liquidacion_tercero as any)?.liquidacion_tercero_id_original)
				.filter((id): id is string => !!id);
			if (itemsIncluidos.length === 0) {
				error = 'No hay items para guardar en esta placa';
				return;
			}

			recalcularBasesPrestacionesSS(placa.conceptos);

			const firstItem = todosTercerosIncluidos.find(
				(t) => t.tercero.placa === placa.placa
			);
			const liquidacionServicioId = firstItem?.liquidacion_servicio?.id;
			if (!liquidacionServicioId) {
				error = 'No se pudo determinar la liquidación de servicio origen';
				return;
			}

			const terceroId = (placa.lt as any)?.tercero?.id || null;

			await liquidacionesTercerosDescuentosAPI.guardarBorrador({
				liquidacion_servicio_id: liquidacionServicioId,
				placa: placa.placa,
				tercero_id: terceroId,
				mes: selectedMes ? MESES.indexOf(selectedMes) + 1 : (firstItem.liquidacion_servicio.mes as number),
				anio: selectedAnio || firstItem.liquidacion_servicio.anio,
				item_ids: itemsIncluidos,
				conceptos: placa.conceptos,
				adicionales: adicionalesPorPlaca[placaIdx] || [],
			});

			syncConceptosToSource(placa.placa, placa.conceptos);
			error = '';
		} catch (e: any) {
			error = e.message || 'Error guardando borrador';
		} finally {
			guardandoPlaca = null;
		}
	}

	// ─── CONDUCTOR MANAGEMENT ─────────────────────────────────────
	let conductorModalOpen = false;
	let conductorModalPlacaIdx: number | null = null;

	function addConductor(placaIdx: number) {
		conductorModalPlacaIdx = placaIdx;
		conductorModalOpen = true;
	}

	function onConductorSelected(conductor: { id: string; nombre: string; apellido: string; numero_identificacion: string }) {
		if (conductorModalPlacaIdx === null) return;
		const placa = placasUnicas[conductorModalPlacaIdx];
		if (!placa) return;

		const conductorRef = {
			id: conductor.id,
			nombre: conductor.nombre,
			apellido: conductor.apellido,
			numero_identificacion: conductor.numero_identificacion,
		};

		const conceptosBase: ConceptoDescuento[] = [
			{ tipo: 'COSTO_LABORAL', concepto: 'SALARIO', conductor_id: conductor.id, conductor: conductorRef, dias: 30, valor_unitario: 0, valor_total: 0, calculado: false, orden: 0 },
			{ tipo: 'COSTO_LABORAL', concepto: 'AUXILIO_TRANSPORTE', conductor_id: conductor.id, conductor: conductorRef, dias: 30, valor_unitario: 0, valor_total: 0, calculado: false, orden: 1 },
			{ tipo: 'COSTO_LABORAL', concepto: 'BONIFICACION', conductor_id: conductor.id, conductor: conductorRef, dias: 0, valor_unitario: 0, valor_total: 0, calculado: false, orden: 2 },
			{ tipo: 'COSTO_LABORAL', concepto: 'RECARGOS', conductor_id: conductor.id, conductor: conductorRef, dias: 0, valor_unitario: 0, valor_total: 0, calculado: false, orden: 3 },
		];

		placa.conceptos = [...placa.conceptos, ...conceptosBase];

		const key = `${conductorModalPlacaIdx}::${conductor.id}`;
		conductorNameInputs[key] = `${conductor.nombre} ${conductor.apellido}`.trim();
		conductorFromNomina[key] = false;
		conductorNameInputs = { ...conductorNameInputs };
		conductorFromNomina = { ...conductorFromNomina };

		recalcularPlacaTotals(placa);
		syncConceptosToSource(placa.placa, placa.conceptos);
		triggerPlacasUpdate();
		conductorModalOpen = false;
		conductorModalPlacaIdx = null;
	}

	function removeConductor(placaIdx: number, conductorId: string | null, conductorNombre?: string) {
		const placa = placasUnicas[placaIdx];
		if (!placa) return;

		const targetKey = conductorId ?? (conductorNombre === 'General / Consolidado' ? 'sin-conductor' : 'sin-conductor');
		placa.conceptos = placa.conceptos.filter(c => {
			const cKey = c.conductor_id || 'sin-conductor';
			return cKey !== targetKey;
		});

		const prefix = `${placaIdx}::`;
		const nextInputs: Record<string, string> = {};
		const nextFromNomina: Record<string, boolean> = {};
		for (const k of Object.keys(conductorNameInputs)) {
			if (!k.startsWith(prefix)) nextInputs[k] = conductorNameInputs[k];
		}
		for (const k of Object.keys(conductorFromNomina)) {
			if (!k.startsWith(prefix)) nextFromNomina[k] = conductorFromNomina[k];
		}
		conductorNameInputs = nextInputs;
		conductorFromNomina = nextFromNomina;
		recalcularPlacaTotals(placa);
		syncConceptosToSource(placa.placa, placa.conceptos);
		triggerPlacasUpdate();
	}

	function renameConductor(placaIdx: number, conductorId: string | null, newName: string) {
		const placa = placasUnicas[placaIdx];
		if (!placa || !newName.trim()) return;
		for (const c of placa.conceptos) {
			if ((c.conductor_id || null) === conductorId) {
				const parts = newName.trim().split(' ');
				c.conductor = { id: c.conductor_id || '', nombre: parts[0], apellido: parts.slice(1).join(' ') || '', numero_identificacion: '' };
			}
		}
		syncConceptosToSource(placa.placa, placa.conceptos);
		triggerPlacasUpdate();
	}

	function addConceptoPlaca(placaIdx: number, tipo: string, concepto: string, conductorId: string | null, conductorRef?: ConceptoDescuento['conductor'] | null) {
		const placa = placasUnicas[placaIdx];
		if (!placa) return;
		placa.conceptos.push({
			tipo: tipo as any,
			concepto,
			conductor_id: conductorId ?? null,
			conductor: conductorId ? (conductorRef ?? null) : null,
			dias: 0,
			valor_unitario: 0,
			valor_total: 0,
			calculado: false,
			orden: 0
		});
		recalcularPlacaTotals(placa);
		syncConceptosToSource(placa.placa, placa.conceptos);
		triggerPlacasUpdate();
	}

	function removeConceptoPlaca(placaIdx: number, conceptoIdx: number) {
		const placa = placasUnicas[placaIdx];
		if (!placa) return;
		placa.conceptos.splice(conceptoIdx, 1);
		placa.conceptos = [...placa.conceptos];
		recalcularPlacaTotals(placa);
		syncConceptosToSource(placa.placa, placa.conceptos);
		triggerPlacasUpdate();
	}

	// ─── VEHICLE SELECTION ────────────────────────────────────────

	let placaInputEl: HTMLInputElement | null = $state(null);
	let vehiculosFiltrados: Vehiculo[] = $derived.by(() => {
		const q = placaSearch.toLowerCase();
		const filtered = !q
			? vehiculos
			: vehiculos.filter(
					(v) => v.placa.toLowerCase().includes(q) || (v.marca || '').toLowerCase().includes(q)
				);
		return [...filtered].sort((a, b) => a.placa.localeCompare(b.placa));
	});

	function onPlacaFocus() {
		placaDropdown = true;
		updatePlacaDropdownPos();
	}

	function onPlacaInput() {
		placaDropdown = true;
		selectedVehiculo = null;
		placaHighlight = 0;
		updatePlacaDropdownPos();
	}

	function onDocClick(e: MouseEvent) {
		if (!placaDropdown) return;
		const target = e.target as Node;
		const wrap = placaInputEl?.closest('.searchable-select');
		if (wrap && wrap.contains(target)) return;
		placaDropdown = false;
	}

	onMount(() => {
		(async () => {
			try {
				const res = await apiClient.get<{ data: Vehiculo[] }>('/api/vehiculos');
				vehiculos = res.data?.data || [];
			} catch (e) {
				console.error('Error cargando vehículos:', e);
			}
		})();
		document.addEventListener('mousedown', onDocClick);
		return () => {
			document.removeEventListener('mousedown', onDocClick);
			clearOnComplete();
		};
	});

	function selectVehiculo(v: Vehiculo) {
		selectedVehiculo = v;
		placaSearch = v.placa;
		placaDropdown = false;
		placaHighlight = 0;
	}

	function clearVehiculo() {
		selectedVehiculo = null;
		placaSearch = '';
		placaDropdown = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!placaDropdown || vehiculosFiltrados.length === 0) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			placaHighlight = (placaHighlight + 1) % vehiculosFiltrados.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			placaHighlight = (placaHighlight - 1 + vehiculosFiltrados.length) % vehiculosFiltrados.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const highlighted = vehiculosFiltrados[placaHighlight];
			if (highlighted) selectVehiculo(highlighted);
		} else if (e.key === 'Escape') {
			placaDropdown = false;
		}
	}

	// ─── GENERAR BORRADOR (con cola async + socket) ───────────────
	async function generarBorrador() {
		if (!selectedVehiculo) {
			error = 'Seleccione un vehículo';
			return;
		}

		// Limpiar callback anterior antes de iniciar uno nuevo.
		// El store mantiene callbacks en un array module-level; sin
		// este cleanup, un segundo click (o un re-mount) acumula
		// callbacks y un solo `borrador:complete` dispara N
		// `consolidarYGuardar` en paralelo, generando N INSERTs con
		// el mismo consecutivo en el backend.
		clearOnComplete();

		generating = true;
		error = '';

		try {
			const mesIdx = MESES.indexOf(selectedMes) + 1;

			const liqRes = await apiClient.get('/api/liquidaciones-servicios', {
				params: {
					mes: mesIdx,
					anio: selectedAnio,
					placa: selectedVehiculo.placa,
					limit: 1000
				}
			});

			const liquidaciones = liqRes.data?.liquidaciones || [];

			if (liquidaciones.length === 0) {
				error = `No se encontró una liquidación de servicios para la placa ${selectedVehiculo.placa} en ${selectedMes} ${selectedAnio}. Primero debe crear la liquidación de servicios.`;
				generating = false;
				borradorQueue.dismiss();
				return;
			}

			console.log(`[generarBorrador] Enviando ${liquidaciones.length} liquidaciones en UN solo job al backend`);

			// UN SOLO job al backend con TODAS las liquidaciones. El backend
			// procesa internamente cada una con un progress smooth y acumulativo
			// (no se resetea entre liquidaciones, no hay sub-steps confusos).
			const queueResult = await borradorQueue.start({
				liquidacion_servicio_ids: liquidaciones.map((l: any) => l.id),
				placa: selectedVehiculo.placa,
			});

			if (queueResult.status === 'locked') {
				generating = false;
				return;
			}

			// Registrar callback filtrado por jobId Y con auto-cleanup:
			// 1) jobId específico: el callback solo se invoca cuando llega
			//    `borrador:complete` para ESTE job, ignorando eventos de
			//    jobs viejos o concurrentes de otros usuarios.
			// 2) clearOnComplete() adentro: al ejecutarse UNA vez se
			//    desregistra, evitando invocaciones duplicadas si por
			//    algún motivo el socket re-emite el mismo complete.
			if (queueResult.status === 'queued' && queueResult.jobId) {
				const jobId = queueResult.jobId;
				currentOnCompleteCleanup = borradorQueue.onComplete(jobId, async (result) => {
					clearOnComplete();
					console.log(
						`[generarBorrador] onComplete (job ${jobId}): ${result.terceros.length} terceros total`,
					);
					await consolidarYGuardar([result]);
				});
			}
		} catch (e: any) {
			clearOnComplete();
			error = e.message || 'Error generando borrador';
			generating = false;
			borradorQueue.dismiss();
		}
	}

	// ─── Consolidar resultados de todas las liquidaciones y guardar borrador ───
	async function consolidarYGuardar(results: GenerarBorradorResult[]) {
		generating = false;
		borradorResults = results;
		configDescuentos = await liquidacionesTercerosDescuentosAPI.obtenerConfiguracion();

		if (results.length === 0) return;

		const firstResult = results[0];
		const firstTercero = firstResult.terceros.find((t: any) => !t.error);
		if (!firstTercero) {
			error = 'No se encontraron terceros válidos en los resultados';
			borradorQueue.dismiss();
			return;
		}

		// Coleccionar TODOS los items de TODAS las liquidaciones
		const allItemsSet = new Set<string>();
		for (const result of results) {
			for (const t of result.terceros) {
				for (const id of (t.items || [])) {
					if (id) allItemsSet.add(id);
				}
				const idOriginal = (t.liquidacion_tercero as any)?.liquidacion_tercero_id_original;
				if (idOriginal) allItemsSet.add(idOriginal);
			}
		}
		const allItems = Array.from(allItemsSet);
		console.log(`[consolidarYGuardar] Total items consolidados: ${allItems.length} (de ${results.length} liquidaciones)`);

		if (allItems.length === 0) {
			error = 'No hay items de liquidacion_tercero para incluir en la nueva liquidacion';
			borradorQueue.dismiss();
			return;
		}

		try {
			const saveRes = await liquidacionesTercerosDescuentosAPI.guardarBorrador({
				liquidacion_servicio_id: firstResult.liquidacion_servicio.id,
				placa: firstTercero.placa,
				tercero_id: firstTercero.liquidacion_tercero?.tercero_id || null,
				mes: firstResult.liquidacion_servicio.mes,
				anio: firstResult.liquidacion_servicio.anio,
				item_ids: allItems,
				conceptos: firstTercero.conceptos || [],
				adicionales: firstTercero.items_adicionales || [],
			});

			if (saveRes.id) {
				borradorQueue.dismiss();
				goto(`/dashboard/liquidaciones-terceros/editar/${saveRes.id}`);
			}
		} catch (e: any) {
			error = e.message || 'Error guardando borrador';
			borradorQueue.dismiss();
		}
	}

	// ─── RESET / CLOSE ────────────────────────────────────────────
	function resetearBorrador() {
		borradorResults = [];
		excludedItemKeys = new Set();
		conductorNameInputs = {};
		conductorFromNomina = {};
		adicionalesPorPlaca = {};
		adicionalesTrigger = 0;
		placasTrigger = 0;
		configDescuentos = [];
		nominaLoading = false;
		guardandoPlaca = null;
		error = '';
	}

	function cerrarCanvas() {
		resetearBorrador();
	}

	// ─── CONCEPTOS PREDEFINIDOS ───────────────────────────────────
	const CONCEPTOS_LABORALES = [
		'SALARIO', 'AUXILIO_TRANSPORTE', 'BONIFICACION', 'OTROS_AUXILIOS', 'RECARGOS',
		'CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA', 'VACACIONES',
		'SALUD', 'PENSION', 'ARP', 'PARAFISCALES'
	];
	const CONCEPTOS_GASTOS = [
		'DOTACION', 'EXAMEN_MEDICO', 'COMBUSTIBLE', 'PAPELERIA', 'GASTOS_DIVERSOS'
	];
	const CONCEPTOS_IMPUESTOS = [
		'RETENCION_ICA', 'AVISOS_TABLEROS', 'SOBRETASA_BOMBERIL', 'RETENCION_FUENTE'
	];

	// Svelte action: monta el nodo en `document.body` para escapar de
	// cualquier ancestro con `backdrop-filter` / `transform` / `contain`
	// (la clase `.glass` usa `backdrop-filter: blur(24px)` que crea un
	// containing block y hace que `position: fixed` no escape al viewport).
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		node.style.position = 'fixed';
		return {
			destroy() {
				node.remove();
			}
		};
	}
</script>

<svelte:window onscroll={updatePlacaDropdownPos} onresize={updatePlacaDropdownPos} />

<div class="form-container">
	{#if error}
		<div class="alert alert-error">{error}</div>
	{/if}

	<div class="card">
		<h2 class="card-title">Seleccionar Vehículo y Periodo</h2>
		<p class="card-sub">Seleccione la placa del vehículo y el periodo para generar la liquidación de tercero.</p>

		<div class="form-grid">
			<div class="form-field">
				<label class="form-label">Placa del Vehículo</label>
				<div class="searchable-select">
					<div class="searchable-input-wrap">
						<input
							type="text"
							bind:this={placaInputEl}
							bind:value={placaSearch}
							placeholder="Buscar placa, marca o propietario..."
							class="searchable-input"
							oninput={onPlacaInput}
							onfocus={onPlacaFocus}
							onkeydown={handleKeydown}
						/>
						{#if selectedVehiculo}
							<button class="clear-btn" onclick={clearVehiculo}>✕</button>
						{/if}
					</div>
					{#if placaDropdown && vehiculosFiltrados.length > 0}
						<div
							class="dropdown-options dropdown-options-fixed"
							style="top: {placaDropdownPos.top}px; left: {placaDropdownPos.left}px; width: {placaDropdownPos.width}px;"
							use:portal
						>
							{#each vehiculosFiltrados as v, i}
								<div
									class="dropdown-item"
									class:highlighted={i === placaHighlight}
									onmousedown={(e) => { e.preventDefault(); selectVehiculo(v); }}
									onmouseenter={() => (placaHighlight = i)}
									role="option"
									aria-selected={i === placaHighlight}
								>
									<span class="dropdown-placa">{fmtPlaca(v.placa)}</span>
									<span class="dropdown-info">
										{v.marca || ''} {v.modelo || ''}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
				{#if selectedVehiculo}
					<div class="selected-info">
						<span class="selected-placa">{fmtPlaca(selectedVehiculo.placa)}</span>
						<span class="selected-model">{selectedVehiculo.marca || ''} {selectedVehiculo.modelo || ''}</span>
					</div>
				{/if}
			</div>

			<div class="form-field">
				<label class="form-label">Mes de Liquidación</label>
				<select bind:value={selectedMes} class="form-select">
					{#each MESES as m}
						<option value={m}>{m}</option>
					{/each}
				</select>
			</div>

			<div class="form-field">
				<label class="form-label">Año</label>
				<select bind:value={selectedAnio} class="form-select">
					{#each YEARS as y}
						<option value={y}>{y}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="form-actions">
			<button
				class="btn btn-primary"
				onclick={generarBorrador}
				disabled={generating || !selectedVehiculo}
			>
				{#if generating}
					<span class="btn-loading">
						<span class="spinner-sm"></span>
						Generando borrador...
					</span>
				{:else}
					Generar Liquidación de Tercero
				{/if}
			</button>
		</div>
	</div>
</div>

<ModalSelectConductor
	bind:isOpen={conductorModalOpen}
	onSelect={onConductorSelected}
	title="Seleccionar Conductor"
	searchPlaceholder="Buscar por nombre o identificación..."
/>

<style>
	.form-container {
		margin: 0 auto;
	}
	.alert {
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 16px;
		font-size: 14px;
	}
	.alert-error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #dc2626;
	}
	.card {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		padding: 24px;
		margin-bottom: 16px;
		position: relative;
		overflow: visible;
	}
	.card-title {
		font-size: 18px;
		font-weight: 700;
		color: #0f172a;
		margin: 0 0 4px;
	}
	.card-sub {
		font-size: 13px;
		color: #64748b;
		margin: 0 0 20px;
	}
	.form-grid {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr;
		gap: 16px;
		margin-bottom: 20px;
	}
	.form-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.form-label {
		font-size: 13px;
		font-weight: 600;
		color: #374151;
	}
	.form-select {
		padding: 8px 12px;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		font-size: 14px;
		background: #fff;
	}
	.searchable-select {
		position: relative;
	}
	.searchable-input-wrap {
		display: flex;
		align-items: center;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		overflow: hidden;
	}
	.searchable-input {
		flex: 1;
		padding: 8px 12px;
		border: none;
		font-size: 14px;
		outline: none;
	}
	.clear-btn {
		padding: 4px 8px;
		background: none;
		border: none;
		color: #94a3b8;
		cursor: pointer;
		font-size: 14px;
	}
	.searchable-select {
		position: relative;
	}
	.dropdown-options {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		max-height: 240px;
		overflow-y: auto;
		z-index: 9999;
		box-shadow: 0 10px 25px rgba(0,0,0,0.18);
	}
	/* Variante fixed para escapar el clip de `overflow-y: auto` de la
	   página raíz. Mismo patrón que SelectBuscable en servicios pero
	   en fixed porque no podemos escapar del scroll container. */
	.dropdown-options-fixed {
		position: fixed;
		z-index: 9999;
	}
	.dropdown-item {
		padding: 8px 12px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.dropdown-item:hover, .dropdown-item.highlighted {
		background: #f0fdf4;
	}
	.dropdown-placa {
		font-family: monospace;
		font-weight: 600;
		font-size: 14px;
		color: #0f172a;
	}
	.dropdown-info {
		font-size: 12px;
		color: #64748b;
	}
	.selected-info {
		display: flex;
		gap: 12px;
		margin-top: 8px;
		font-size: 13px;
	}
	.selected-placa {
		font-family: monospace;
		font-weight: 600;
		color: #ea580c;
	}
	.selected-model {
		color: #64748b;
	}
	.form-actions {
		display: flex;
		gap: 12px;
	}
	.btn {
		padding: 10px 20px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		border: none;
		transition: all 0.15s;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-primary {
		background: #ea580c;
		color: #fff;
	}
	.btn-primary:hover:not(:disabled) {
		background: #047857;
	}
	.btn-loading {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.spinner-sm {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255,255,255,0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (max-width: 768px) {
		.form-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
