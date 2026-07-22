<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { toast } from 'svelte-sonner';
	import {
		accionesCorrectivasAPI,
		type AccionCorrectivaPreventiva,
		type CreateAccionInput,
		type TipoHallazgo,
		type ValoracionRiesgo,
		type TipoAccion,
		type EstadoSeguimiento,
		type EvaluacionCierre,
		type EvaluacionEficacia,
		type ActionStatusGlobal
	} from '$lib/api/acciones-correctivas';
	import BloqueRegistrosSeguimiento from './BloqueRegistrosSeguimiento.svelte';
	import SelectorRiesgo from './SelectorRiesgo.svelte';
	import SelectorEstadoAccion from './SelectorEstadoAccion.svelte';
	import BloqueReplanteo from './BloqueReplanteo.svelte';
	import Step4Approval from './Step4Approval.svelte';
	import Step5ActionStatus from './Step5ActionStatus.svelte';
	import { slide } from 'svelte/transition';
	import {
		TIPOS_HALLAZGO,
		FUENTES_HALLAZGO,
		MATRICES_ACTUALIZAR,
		ESTADOS_EVIDENCIA,
		EVALUACIONES_CIERRE,
		RESULTADOS_CICLO_EFICACIA,
		normalizarTipoHallazgo,
		inicializarMatricesDesdeRegistro,
		serializarMatricesSeleccionadas,
		crearRegistroSeguimientoVacio,
		crearCiclosEficaciaIniciales,
		crearCausasIniciales,
		crearEvidenciaVacia,
		MAX_CAUSAS,
		parseListaCriterios,
		calcularPlazosRiesgo,
		formatFechaDisplay,
		addDays,
		type RegistroSeguimientoForm
	} from '$lib/acciones-correctivas/constants';
	import type { CicloEficacia, EvidenciaEficacia } from '$lib/api/acciones-correctivas';
	import { step5Store } from '$lib/stores/acciones-correctivas';

	type CausaForm = {
		orden: number;
		analisis_causa: string;
		es_causa_raiz: boolean;
		descripcion_plan_accion: string;
		fecha_limite_implementacion: string;
		responsable_ejecucion: string;
		seguimientos: RegistroSeguimientoForm[];
	};

	type TabId = 'causas' | 'identificacion' | 'riesgo' | 'aprobacion' | 'estado' | 'eficacia';

	const TABS: { id: TabId; label: string; icon: string }[] = [
		{ id: 'identificacion', label: 'Identificación', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
		{ id: 'causas', label: 'Causas', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
		{ id: 'riesgo', label: 'Riesgo y Corrección', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
		{ id: 'aprobacion', label: 'Aprobación', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
		{ id: 'estado', label: 'Estado', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
		{ id: 'eficacia', label: 'Eficacia', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' }
	];

	function getTabFromUrl(): TabId {
		if (!browser) return 'causas';
		const tab = new URLSearchParams(window.location.search).get('tab') as TabId | null;
		const valid = TABS.find((t) => t.id === tab);
		return valid ? valid.id : 'causas';
	}

	let activeTab: TabId = 'causas';

	function setTab(tab: TabId) {
		activeTab = tab;
		if (browser) {
			const url = new URL(window.location.href);
			url.searchParams.set('tab', tab);
			window.history.replaceState({}, '', url.toString());
		}
	}

	function mapSeguimientosDesdeApi(
		items?: {
			fecha_seguimiento?: string;
			descripcion_observaciones?: string;
			estado_accion?: string;
			replanteo?: any;
			adjunto_url?: string;
			responsable_seguimiento?: string;
			cargo_responsable_seguimiento?: string;
		}[]
	): RegistroSeguimientoForm[] {
		if (!items?.length) return [crearRegistroSeguimientoVacio()];
		return items.map((s) => ({
			fecha_seguimiento: s.fecha_seguimiento?.split('T')[0] || '',
			descripcion_observaciones: s.descripcion_observaciones || '',
			estado_accion: s.estado_accion || 'En Proceso',
			adjunto_url: s.adjunto_url,
			responsable_seguimiento: s.responsable_seguimiento || '',
			cargo_responsable_seguimiento: s.cargo_responsable_seguimiento || '',
			replanteo: s.replanteo || {
				nueva_fecha_limite: '',
				responsable: '',
				justificacion: '',
				cambios: ''
			}
		}));
	}

	function nuevaCausaVacia(orden: number): CausaForm {
		return {
			orden,
			analisis_causa: '',
			es_causa_raiz: false,
			descripcion_plan_accion: '',
			fecha_limite_implementacion: '',
			responsable_ejecucion: '',
			seguimientos: [crearRegistroSeguimientoVacio()]
		};
	}

	export let accion: AccionCorrectivaPreventiva | null = null;

	console.log(accion);
	export let modoEdicion = false;
	export let onGuardado: () => void = () => {};

	export let isSubmitting = false;

	// Form fields - Sección 1: Identificación del Hallazgo
	let accion_numero = accion?.accion_numero || '';
	let lugar_sede = accion?.lugar_sede || '';
	let proceso_origen_hallazgo = accion?.proceso_origen_hallazgo || '';
	let componente_elemento_referencia = accion?.componente_elemento_referencia || '';
	let fuente_genero_hallazgo = accion?.fuente_genero_hallazgo || '';
	let fuente_hallazgo_otros = accion?.fuente_genero_hallazgo_otros || '';
	let marco_legal_normativo = accion?.marco_legal_normativo || '';
	let variable_categoria_analisis = accion?.variable_categoria_analisis || '';
	let fecha_identificacion_hallazgo = accion?.fecha_identificacion_hallazgo?.split('T')[0] || '';
	let created_at_form = accion?.created_at?.split('T')[0] || new Date().toISOString().split('T')[0];
	let descripcion_hallazgo = accion?.descripcion_hallazgo || '';
	let tipo_hallazgo_detectado: TipoHallazgo | '' = normalizarTipoHallazgo(
		accion?.tipo_hallazgo_detectado
	);
	let tipo_hallazgo_otros = accion?.tipo_hallazgo_otros || '';
	let valoracion_riesgo: ValoracionRiesgo | '' = accion?.valoracion_riesgo || '';
	const matricesIniciales = inicializarMatricesDesdeRegistro(
		accion?.matriz_a_actualizar,
		accion?.requiere_actualizar_matriz
	);
	let matricesSeleccionadas: string[] = matricesIniciales.seleccion;
	let matriz_otros_detalle = matricesIniciales.otrosDetalle;
	let tipo_accion_ejecutar: TipoAccion | '' = accion?.tipo_accion_ejecutar || '';

	// Sección 2: Corrección inmediata
	let aplica_correccion_inmediata = accion?.aplica_correccion_inmediata ?? true;
	let justificacion_no_correccion = accion?.justificacion_no_correccion || '';
	let responsable_correccion = accion?.responsable_correccion || '';
	let correccion_solucion_inmediata = accion?.correccion_solucion_inmediata || '';
	let fecha_implementacion = accion?.fecha_implementacion?.split('T')[0] || '';
	let seguimientosCorreccion: RegistroSeguimientoForm[] = mapSeguimientosDesdeApi(
		accion?.seguimientos_correccion
	);

	// Sección 3: Causas
	let causas: CausaForm[] =
		accion?.causas && accion.causas.length > 0
			? accion.causas.map((c) => ({
					orden: c.orden,
					analisis_causa: c.analisis_causa || '',
					es_causa_raiz: c.es_causa_raiz ?? false,
					descripcion_plan_accion: c.descripcion_plan_accion || '',
					fecha_limite_implementacion: c.fecha_limite_implementacion?.split('T')[0] || '',
					responsable_ejecucion: c.responsable_ejecucion || '',
					seguimientos: mapSeguimientosDesdeApi(c.seguimientos)
				}))
			: crearCausasIniciales();

	// Sección 4: Eficacia
	let fecha_limite_evaluacion_eficacia =
		accion?.fecha_limite_evaluacion_eficacia?.split('T')[0] || '';
	let criterio_evaluacion_eficacia = accion?.criterio_evaluacion_eficacia || '';
	let ciclosEficacia: CicloEficacia[] =
		accion?.ciclos_eficacia && accion.ciclos_eficacia.length > 0
			? accion.ciclos_eficacia.map((c) => ({
					...c,
					fecha_seguimiento: c.fecha_seguimiento?.split('T')[0] || '',
					resultado_ciclo: c.resultado_ciclo || ('' as any),
					criterios_cumplidos: Array.isArray(c.criterios_cumplidos)
						? (c.criterios_cumplidos as string[])
						: []
				}))
			: crearCiclosEficaciaIniciales();

	let evaluaciones_eficacia: EvaluacionEficacia[] = accion?.evaluaciones_eficacia || [];

	let evidenciasEficacia: EvidenciaEficacia[] =
		accion?.evidencias_eficacia && accion.evidencias_eficacia.length > 0
			? accion.evidencias_eficacia.map((e) => ({
					...e,
					fecha: e.fecha?.split('T')[0] || ''
				}))
			: [crearEvidenciaVacia(1)];

	let evaluacion_cierre_eficaz: EvaluacionCierre | '' = accion?.evaluacion_cierre_eficaz || '';

	// Reapertura
	let aplica_reapertura = accion?.aplica_reapertura ?? false;
	let fecha_reapertura = accion?.fecha_reapertura?.split('T')[0] || '';
	let razon_reapertura = accion?.razon_reapertura || '';

	let fecha_cierre_definitivo = accion?.fecha_cierre_definitivo?.split('T')[0] || '';
	let observaciones_cierre = accion?.observaciones_cierre || '';
	let responsable_cierre = accion?.responsable_cierre || '';
	let cargo_responsable_cierre = accion?.cargo_responsable_cierre || '';

	// Reactive logic for deadlines
	$: plazosCalculados = calcularPlazosRiesgo(created_at_form, valoracion_riesgo);

	// Auto-fill dates based on risk
	$: if (plazosCalculados && aplica_correccion_inmediata) {
		if (!fecha_implementacion) fecha_implementacion = plazosCalculados.fecha_correccion;
		if (!fecha_limite_evaluacion_eficacia)
			fecha_limite_evaluacion_eficacia = plazosCalculados.eficacia_1;

		// Update cause implemention dates if empty
		causas = causas.map((c) => ({
			...c,
			fecha_limite_implementacion:
				c.fecha_limite_implementacion || plazosCalculados!.fecha_implementacion
		}));
	}

	// Auto-fill reopening date
	$: if (evaluacion_cierre_eficaz === 'NO EFICAZ' && !aplica_reapertura) {
		aplica_reapertura = true;
		fecha_reapertura = new Date().toISOString().split('T')[0];
	}

	// Banner de Aprobación
	$: approvalBanner = (() => {
		if (!tipo_hallazgo_detectado) return null;

		const esNCMayor =
			tipo_hallazgo_detectado === 'NC Mayor' ||
			tipo_hallazgo_detectado === 'No conformidad mayor' ||
			tipo_hallazgo_detectado === 'NC. MAYOR';

		return esNCMayor
			? 'Requiere aprobación de: Gerencia'
			: 'Requiere aprobación de: Coordinador HSEQ';
	})();

	const RESULTADOS_EFICACIA_UI = {
		EFICAZ: {
			icon: '✅',
			active: 'bg-orange-50 border-orange-500 text-orange-700 shadow-md scale-105',
			inactive: 'bg-[var(--fm-surface)] border-[var(--fm-border)] opacity-60 hover:opacity-100',
			desc: 'Las acciones eliminaron la causa raíz satisfactoriamente.'
		},
		'NO EFICAZ': {
			icon: '❌',
			active: 'bg-red-50 border-red-500 text-red-700 shadow-md scale-105',
			inactive: 'bg-[var(--fm-surface)] border-[var(--fm-border)] opacity-60 hover:opacity-100',
			desc: 'Las acciones no fueron suficientes. Se requiere reapertura.'
		},
		PARCIAL: {
			icon: '⚠️',
			active: 'bg-amber-50 border-amber-500 text-amber-700 shadow-md scale-105',
			inactive: 'bg-[var(--fm-surface)] border-[var(--fm-border)] opacity-60 hover:opacity-100',
			desc: 'Se observa mejora parcial. Otorga plazo para la próxima fecha programada.'
		}
	};

	// Errors
	let errors: { [key: string]: string } = {};

	function formatearFechaRegistro(fecha?: string): string {
		if (!fecha) return '—';
		const [y, m, d] = fecha.split('T')[0].split('-');
		return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-CO', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric'
		});
	}

	$: fechaRegistroDisplay =
		modoEdicion && accion?.created_at
			? formatearFechaRegistro(accion.created_at)
			: formatearFechaRegistro(new Date().toISOString());

	function toggleMatriz(key: string) {
		if (matricesSeleccionadas.includes(key)) {
			matricesSeleccionadas = matricesSeleccionadas.filter((m) => m !== key);
		} else {
			matricesSeleccionadas = [...matricesSeleccionadas, key];
		}
	}

	function buildMatrizActualizar(): string | undefined {
		const items = matricesSeleccionadas.map((key) => {
			if (key === 'Otros' && matriz_otros_detalle.trim()) {
				return `Otros: ${matriz_otros_detalle.trim()}`;
			}
			return key;
		});
		return serializarMatricesSeleccionadas(items);
	}

	function validateSeccion(): boolean {
		// Limpiar errores de la sección 1
		delete errors.accion_numero;
		delete errors.descripcion_hallazgo;
		// Limpiar errores de la sección 3
		delete errors.tipo_accion_ejecutar;
		delete errors.causas;

		let isValid = true;

		if (!accion_numero.trim()) {
			errors.accion_numero = 'El número de acción es requerido';
			isValid = false;
		}

		if (!descripcion_hallazgo.trim()) {
			errors.descripcion_hallazgo = 'La descripción del hallazgo es requerida';
			isValid = false;
		}

		if (!tipo_accion_ejecutar) {
			errors.tipo_accion_ejecutar = 'El tipo de acción es requerido';
			isValid = false;
		}

		errors = errors; // Reactivity
		return isValid;
	}

	$: listaCriteriosEficacia = parseListaCriterios(criterio_evaluacion_eficacia);

	function agregarCausa() {
		if (causas.length < MAX_CAUSAS) {
			causas = [...causas, nuevaCausaVacia(causas.length + 1)];
		} else {
			toast.warning(`Máximo ${MAX_CAUSAS} causas permitidas`);
		}
	}

	function agregarCicloEficacia() {
		ciclosEficacia = [
			...ciclosEficacia,
			{
				numero_ciclo: ciclosEficacia.length + 1,
				fecha_seguimiento: '',
				descripcion: '',
				resultado_ciclo: '' as const,
				responsable: '',
				cargo: '',
				criterios_cumplidos: []
			}
		];
	}

	function agregarEvidencia() {
		evidenciasEficacia = [
			...evidenciasEficacia,
			crearEvidenciaVacia(evidenciasEficacia.length + 1)
		];
	}

	function agregarEvaluacionEficacia() {
		evaluaciones_eficacia = [
			...evaluaciones_eficacia,
			{
				fecha_evaluacion: new Date().toISOString().split('T')[0],
				evaluador: '',
				analisis_evaluacion: ''
			}
		];
	}

	function eliminarEvaluacionEficacia(index: number) {
		evaluaciones_eficacia = evaluaciones_eficacia.filter((_, i) => i !== index);
	}

	function eliminarCicloEficacia(index: number) {
		if (ciclosEficacia.length <= 1) return;
		ciclosEficacia = ciclosEficacia
			.filter((_, i) => i !== index)
			.map((c, i) => ({ ...c, numero_ciclo: i + 1 }));
	}

	async function reabrirAccion() {
		if (!modoEdicion || !accion) return;

		try {
			isSubmitting = true;
			toast.loading('Generando reapertura...', { id: 'reapertura' });

			// Primero guardamos los cambios actuales si los hay
			await handleSubmit();

			// Luego disparamos la duplicación en el backend
			const nuevaAccion = await accionesCorrectivasAPI.duplicar(accion.id);

			// Actualizamos la nueva acción con los datos de reapertura
			await accionesCorrectivasAPI.actualizar(nuevaAccion.id, {
				aplica_reapertura: true,
				fecha_reapertura: fecha_reapertura,
				razon_reapertura: razon_reapertura,
				accion_origen_reapertura: accion.accion_numero
			});

			toast.success('Nueva acción generada por reapertura', { id: 'reapertura' });
			onGuardado();
		} catch (error: any) {
			toast.error('Error al reabrir acción: ' + error.message, { id: 'reapertura' });
		} finally {
			isSubmitting = false;
		}
	}

	function eliminarEvidencia(index: number) {
		if (evidenciasEficacia.length <= 1) return;
		evidenciasEficacia = evidenciasEficacia
			.filter((_, i) => i !== index)
			.map((e, i) => ({ ...e, orden: i + 1 }));
	}

	function toggleCriterioCiclo(index: number, criterio: string, marcado: boolean) {
		const ciclo = ciclosEficacia[index];
		let cumplidos = [...(ciclo.criterios_cumplidos || [])];
		if (marcado) {
			if (!cumplidos.includes(criterio)) cumplidos.push(criterio);
		} else {
			cumplidos = cumplidos.filter((c) => c !== criterio);
		}
		ciclosEficacia[index] = { ...ciclo, criterios_cumplidos: cumplidos };
	}

	function prepararSeguimientosParaApi(regs: RegistroSeguimientoForm[]) {
		return regs
			.filter((s) => s.fecha_seguimiento)
			.map((s) => ({
				fecha_seguimiento: s.fecha_seguimiento,
				descripcion_observaciones: s.descripcion_observaciones?.trim() || undefined,
				estado_accion: s.estado_accion,
				adjunto_url: s.adjunto_url,
				responsable_seguimiento: s.responsable_seguimiento?.trim() || undefined,
				cargo_responsable_seguimiento: s.cargo_responsable_seguimiento?.trim() || undefined,
				replanteo: s.estado_accion === 'Replanteada' ? s.replanteo : undefined
			}));
	}

	async function handleFileUploadGeneric(target: any, key: string, event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		try {
			toast.loading('Subiendo archivo...', { id: 'uploading-gen' });
			const result = await accionesCorrectivasAPI.uploadAdjunto(file);
			target[key] = result.url;
			toast.success('Archivo subido correctamente', { id: 'uploading-gen' });
		} catch (error) {
			toast.error('Error al subir archivo', { id: 'uploading-gen' });
			console.error(error);
		}
	}

	function eliminarCausa(index: number) {
		if (causas.length > 1) {
			causas = causas.filter((_, i) => i !== index);
			// Reordenar
			causas = causas.map((causa, i) => ({ ...causa, orden: i + 1 }));
		}
	}

	function copiarCausa(index: number) {
		if (causas.length >= MAX_CAUSAS) {
			toast.warning(`Máximo ${MAX_CAUSAS} causas permitidas`);
			return;
		}
		const original = causas[index];
		const copia: CausaForm = {
			orden: original.orden + 1,
			analisis_causa: original.analisis_causa,
			es_causa_raiz: false,
			descripcion_plan_accion: original.descripcion_plan_accion,
			fecha_limite_implementacion: original.fecha_limite_implementacion,
			responsable_ejecucion: original.responsable_ejecucion,
			seguimientos: [crearRegistroSeguimientoVacio()]
		};
		const nuevo = [...causas];
		nuevo.splice(index + 1, 0, copia);
		causas = nuevo.map((c, i) => ({ ...c, orden: i + 1 }));
		toast.success('Causa copiada. Ajusta los datos según sea necesario.');
	}

	export async function handleSubmit() {
		if (!validateSeccion()) {
			toast.error('Por favor complete los campos requeridos');
			return;
		}

		isSubmitting = true;

		try {
			// Filtrar y preparar causas válidas
			const causasValidas = causas
				.filter((causa) => causa.analisis_causa.trim())
				.map((causa) => {
					const segs = prepararSeguimientosParaApi(causa.seguimientos);
					const ultimo = segs.at(-1);
					return {
						orden: causa.orden,
						analisis_causa: causa.analisis_causa.trim(),
						es_causa_raiz: causa.es_causa_raiz,
						descripcion_plan_accion: causa.descripcion_plan_accion?.trim() || undefined,
						fecha_limite_implementacion: causa.fecha_limite_implementacion || undefined,
						responsable_ejecucion: causa.responsable_ejecucion?.trim() || undefined,
						seguimientos: segs.length ? segs : undefined,
						...(ultimo && {
							fecha_seguimiento: ultimo.fecha_seguimiento,
							estado_seguimiento: ultimo.estado_accion as EstadoSeguimiento,
							descripcion_observaciones: ultimo.descripcion_observaciones
						})
					};
				});

			const segCorreccion = prepararSeguimientosParaApi(seguimientosCorreccion);
			const ciclosValidos = ciclosEficacia
				.filter((c) => c.fecha_seguimiento)
				.map((c) => ({
					numero_ciclo: c.numero_ciclo,
					fecha_seguimiento: c.fecha_seguimiento,
					descripcion: c.descripcion?.trim() || undefined,
					resultado_ciclo: c.resultado_ciclo || undefined,
					responsable: c.responsable?.trim() || undefined,
					cargo: c.cargo?.trim() || undefined,
					adjunto_url: c.adjunto_url,
					criterios_cumplidos: c.criterios_cumplidos?.length ? c.criterios_cumplidos : undefined
				}));
			const evidenciasValidas = evidenciasEficacia
				.filter((e) => e.tipo_evidencia?.trim() || e.descripcion?.trim())
				.map((e, i) => ({
					orden: e.orden || i + 1,
					tipo_evidencia: e.tipo_evidencia?.trim() || undefined,
					descripcion: e.descripcion?.trim() || undefined,
					fecha: e.fecha || undefined,
					estado_ubicacion: e.estado_ubicacion || undefined,
					adjunto_url: e.adjunto_url
				}));

			const data: CreateAccionInput = {
				accion_numero: accion_numero.trim(),
				lugar_sede: lugar_sede.trim() || undefined,
				proceso_origen_hallazgo: proceso_origen_hallazgo.trim() || undefined,
				componente_elemento_referencia: componente_elemento_referencia.trim() || undefined,
				fuente_genero_hallazgo: fuente_genero_hallazgo.trim() || undefined,
				marco_legal_normativo: marco_legal_normativo.trim() || undefined,
				variable_categoria_analisis: variable_categoria_analisis.trim() || undefined,
				fecha_identificacion_hallazgo: fecha_identificacion_hallazgo || undefined,
				created_at: created_at_form || undefined,
				tipo_hallazgo_otros:
					tipo_hallazgo_detectado?.toLowerCase() === 'otro' ? tipo_hallazgo_otros : undefined,
				fuente_genero_hallazgo_otros:
					fuente_genero_hallazgo?.toLowerCase() === 'otro' ? fuente_hallazgo_otros : undefined,
				descripcion_hallazgo: descripcion_hallazgo.trim() || undefined,
				tipo_hallazgo_detectado: tipo_hallazgo_detectado || undefined,
				aplica_correccion_inmediata,
				justificacion_no_correccion: aplica_correccion_inmediata
					? undefined
					: justificacion_no_correccion,
				responsable_correccion: aplica_correccion_inmediata ? responsable_correccion : undefined,
				correccion_solucion_inmediata: aplica_correccion_inmediata
					? correccion_solucion_inmediata.trim()
					: undefined,
				fecha_implementacion:
					aplica_correccion_inmediata && fecha_implementacion
						? fecha_implementacion
						: undefined,
				valoracion_riesgo: valoracion_riesgo || undefined,
				requiere_actualizar_matriz: matricesSeleccionadas.length > 0,
				matriz_a_actualizar: buildMatrizActualizar(),
				replanteo_correccion:
					aplica_correccion_inmediata && segCorreccion.at(-1)?.estado_accion === 'Replanteada'
						? segCorreccion.at(-1)?.replanteo
						: undefined,
				tipo_accion_ejecutar: tipo_accion_ejecutar || undefined,
				causas: causasValidas.length > 0 ? causasValidas : undefined,
				seguimientos_correccion: aplica_correccion_inmediata ? segCorreccion : undefined,
				fecha_limite_evaluacion_eficacia: fecha_limite_evaluacion_eficacia || undefined,
				criterio_evaluacion_eficacia: criterio_evaluacion_eficacia.trim() || undefined,
				ciclos_eficacia: ciclosValidos.length ? ciclosValidos : undefined,
				evaluaciones_eficacia: evaluaciones_eficacia.length ? evaluaciones_eficacia : undefined,
				evidencias_eficacia: evidenciasValidas.length ? evidenciasValidas : undefined,
				evaluacion_cierre_eficaz: evaluacion_cierre_eficaz || undefined,
				fecha_cierre_definitivo: fecha_cierre_definitivo || undefined,
				observaciones_cierre: observaciones_cierre.trim() || undefined,
				responsable_cierre: responsable_cierre.trim() || undefined,
				cargo_responsable_cierre: cargo_responsable_cierre.trim() || undefined,
				aplica_reapertura,
				fecha_reapertura: aplica_reapertura ? fecha_reapertura : undefined,
				razon_reapertura: aplica_reapertura ? razon_reapertura : undefined
			};

			if (modoEdicion && accion) {
				await accionesCorrectivasAPI.actualizar(accion.id, data);
				toast.success('Acción actualizada exitosamente');
			} else {
				await accionesCorrectivasAPI.crear(data);
				toast.success('Acción creada exitosamente');
			}

			limpiarBorrador();
			onGuardado();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al guardar la acción';
			toast.error(message);
		} finally {
			isSubmitting = false;
		}
	}

	function calcularEstadoGlobalDesdeCausas(): ActionStatusGlobal {
		const estados = causas.map(c => {
			const ultimoSeg = c.seguimientos.filter(s => s.estado_accion).at(-1);
			return ultimoSeg?.estado_accion || 'En Proceso';
		});

		if (estados.length === 0) return 'EN_PROCESO';
		if (estados.every(e => e === 'Cerrada')) return 'CUMPLIDA';
		if (estados.some(e => e === 'Vencida')) return 'VENCIDA';
		if (estados.some(e => e === 'Replanteada')) return 'REPLANTEADA';
		return 'EN_PROCESO';
	}

	let estadoGlobalCalculado: ActionStatusGlobal = 'EN_PROCESO';
	let estadoCambioCounter = 0;

	function calcularYActualizarLocal() {
		if (!accion?.id) return;
		const nuevoEstado = calcularEstadoGlobalDesdeCausas();
		estadoGlobalCalculado = nuevoEstado;
		accion.estado_global = nuevoEstado;
		accion.fecha_actualizacion_estado = new Date().toISOString();
		step5Store.cargarEstado(accion);
	}

	function onEstadoSeguimientoChange() {
		estadoCambioCounter++;
		calcularYActualizarLocal();
	}

	onMount(() => {
		calcularYActualizarLocal();
		activeTab = getTabFromUrl();
		if (browser && !modoEdicion) {
			restaurarBorradorSiExiste();
		} else if (browser && modoEdicion) {
			verificarConflictoBorrador();
		}
	});

	$: if (estadoCambioCounter && accion?.id) {
		calcularYActualizarLocal();
	}

	// ============ AUTOSAVE CACHE ============
	type CacheAccion = {
		updatedAt: number;
		data: {
			accion_numero: string;
			lugar_sede: string;
			proceso_origen_hallazgo: string;
			componente_elemento_referencia: string;
			fuente_genero_hallazgo: string;
			fuente_hallazgo_otros: string;
			marco_legal_normativo: string;
			variable_categoria_analisis: string;
			fecha_identificacion_hallazgo: string;
			created_at_form: string;
			descripcion_hallazgo: string;
			tipo_hallazgo_detectado: string;
			tipo_hallazgo_otros: string;
			valoracion_riesgo: string;
			matricesSeleccionadas: string[];
			matriz_otros_detalle: string;
			tipo_accion_ejecutar: string;
			aplica_correccion_inmediata: boolean;
			justificacion_no_correccion: string;
			responsable_correccion: string;
			correccion_solucion_inmediata: string;
			fecha_implementacion: string;
			seguimientosCorreccion: RegistroSeguimientoForm[];
			causas: CausaForm[];
			fecha_limite_evaluacion_eficacia: string;
			criterio_evaluacion_eficacia: string;
			ciclosEficacia: CicloEficacia[];
			evaluaciones_eficacia: EvaluacionEficacia[];
			evidenciasEficacia: EvidenciaEficacia[];
			evaluacion_cierre_eficaz: string;
			aplica_reapertura: boolean;
			fecha_reapertura: string;
			razon_reapertura: string;
			fecha_cierre_definitivo: string;
			observaciones_cierre: string;
			responsable_cierre: string;
			cargo_responsable_cierre: string;
		};
	};

	function getCacheKey(): string {
		return `accion_draft_${accion?.id || 'new'}`;
	}

	let autosaveTimer: any = null;

	function guardarBorrador() {
		if (!browser) return;
		const cache: CacheAccion = {
			updatedAt: Date.now(),
			data: {
				accion_numero,
				lugar_sede,
				proceso_origen_hallazgo,
				componente_elemento_referencia,
				fuente_genero_hallazgo,
				fuente_hallazgo_otros,
				marco_legal_normativo,
				variable_categoria_analisis,
				fecha_identificacion_hallazgo,
				created_at_form,
				descripcion_hallazgo,
				tipo_hallazgo_detectado,
				tipo_hallazgo_otros,
				valoracion_riesgo,
				matricesSeleccionadas,
				matriz_otros_detalle,
				tipo_accion_ejecutar,
				aplica_correccion_inmediata,
				justificacion_no_correccion,
				responsable_correccion,
				correccion_solucion_inmediata,
				fecha_implementacion,
				seguimientosCorreccion,
				causas,
				fecha_limite_evaluacion_eficacia,
				criterio_evaluacion_eficacia,
				ciclosEficacia,
				evaluaciones_eficacia,
				evidenciasEficacia,
				evaluacion_cierre_eficaz,
				aplica_reapertura,
				fecha_reapertura,
				razon_reapertura,
				fecha_cierre_definitivo,
				observaciones_cierre,
				responsable_cierre,
				cargo_responsable_cierre
			}
		};
		try {
			localStorage.setItem(getCacheKey(), JSON.stringify(cache));
		} catch (e) {
			console.warn('Autosave: localStorage lleno o no disponible', e);
		}
	}

	function limpiarBorrador() {
		if (!browser) return;
		localStorage.removeItem(getCacheKey());
	}

	function aplicarBorrador(cache: CacheAccion) {
		const d = cache.data;
		accion_numero = d.accion_numero;
		lugar_sede = d.lugar_sede;
		proceso_origen_hallazgo = d.proceso_origen_hallazgo;
		componente_elemento_referencia = d.componente_elemento_referencia;
		fuente_genero_hallazgo = d.fuente_genero_hallazgo;
		fuente_hallazgo_otros = d.fuente_hallazgo_otros;
		marco_legal_normativo = d.marco_legal_normativo;
		variable_categoria_analisis = d.variable_categoria_analisis;
		fecha_identificacion_hallazgo = d.fecha_identificacion_hallazgo;
		created_at_form = d.created_at_form;
		descripcion_hallazgo = d.descripcion_hallazgo;
		tipo_hallazgo_detectado = d.tipo_hallazgo_detectado as TipoHallazgo | '';
		tipo_hallazgo_otros = d.tipo_hallazgo_otros;
		valoracion_riesgo = d.valoracion_riesgo as ValoracionRiesgo | '';
		matricesSeleccionadas = d.matricesSeleccionadas;
		matriz_otros_detalle = d.matriz_otros_detalle;
		tipo_accion_ejecutar = d.tipo_accion_ejecutar as TipoAccion | '';
		aplica_correccion_inmediata = d.aplica_correccion_inmediata;
		justificacion_no_correccion = d.justificacion_no_correccion;
		responsable_correccion = d.responsable_correccion;
		correccion_solucion_inmediata = d.correccion_solucion_inmediata;
		fecha_implementacion = d.fecha_implementacion;
		seguimientosCorreccion = d.seguimientosCorreccion;
		causas = d.causas;
		fecha_limite_evaluacion_eficacia = d.fecha_limite_evaluacion_eficacia;
		criterio_evaluacion_eficacia = d.criterio_evaluacion_eficacia;
		ciclosEficacia = d.ciclosEficacia;
		evaluaciones_eficacia = d.evaluaciones_eficacia;
		evidenciasEficacia = d.evidenciasEficacia;
		evaluacion_cierre_eficaz = d.evaluacion_cierre_eficaz as EvaluacionCierre | '';
		aplica_reapertura = d.aplica_reapertura;
		fecha_reapertura = d.fecha_reapertura;
		razon_reapertura = d.razon_reapertura;
		fecha_cierre_definitivo = d.fecha_cierre_definitivo;
		observaciones_cierre = d.observaciones_cierre;
		responsable_cierre = d.responsable_cierre;
		cargo_responsable_cierre = d.cargo_responsable_cierre;
	}

	function restaurarBorradorSiExiste() {
		if (!browser) return;
		const raw = localStorage.getItem(getCacheKey());
		if (!raw) return;
		try {
			const cache: CacheAccion = JSON.parse(raw);
			const hasContent = cache.data.accion_numero?.trim() || cache.data.descripcion_hallazgo?.trim() || cache.data.causas?.some(c => c.analisis_causa?.trim());
			if (!hasContent) {
				localStorage.removeItem(getCacheKey());
				return;
			}
			const toastId = 'restore-draft';
			toast.info('Se encontró un borrador sin guardar', {
				id: toastId,
				description: `Guardado: ${new Date(cache.updatedAt).toLocaleString('es-CO')}`,
				duration: Infinity,
				action: {
					label: 'Restaurar',
					onClick: () => {
						aplicarBorrador(cache);
						toast.success('Borrador restaurado', { id: toastId });
					}
				},
				cancel: {
					label: 'Descartar',
					onClick: () => {
						limpiarBorrador();
						toast.dismiss(toastId);
					}
				}
			});
		} catch (e) {
			localStorage.removeItem(getCacheKey());
		}
	}

	function verificarConflictoBorrador() {
		if (!browser || !accion) return;
		const raw = localStorage.getItem(getCacheKey());
		if (!raw) return;
		try {
			const cache: CacheAccion = JSON.parse(raw);
			const serverUpdatedAt = accion.updated_at ? new Date(accion.updated_at).getTime() : 0;
			if (cache.updatedAt > serverUpdatedAt) {
				toast.warning('Tienes cambios sin guardar localmente más recientes que la versión del servidor', {
					description: `Local: ${new Date(cache.updatedAt).toLocaleString('es-CO')} · Servidor: ${new Date(serverUpdatedAt).toLocaleString('es-CO')}`,
					duration: 8000,
					action: {
						label: 'Restaurar local',
						onClick: () => aplicarBorrador(cache)
					}
				});
			} else {
				localStorage.removeItem(getCacheKey());
			}
		} catch (e) {
			localStorage.removeItem(getCacheKey());
		}
	}

	$: if (browser && !isSubmitting) {
		clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(guardarBorrador, 2000);
	}
</script>

<style>
	:global(.fm-form) {
		--fm-bg: #FFFFFF;
		--fm-surface: #FAFAFA;
		--fm-surface-elevated: #FFFFFF;
		--fm-border: #E4E4E7;
		--fm-border-hover: #D4D4D8;
		--fm-text: #18181B;
		--fm-text-secondary: #52525B;
		--fm-muted: #71717A;
		--fm-focus-ring: rgba(0, 0, 0, 0.08);
		--fm-radius: 8px;
		--fm-radius-lg: 10px;
	}

	.tab-bar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		gap: 2px;
		margin-bottom: 1rem;
		padding: 4px;
		background: var(--fm-surface);
		border: 1px solid var(--fm-border);
		border-radius: var(--fm-radius-lg);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab-bar::-webkit-scrollbar { display: none; }

	.tab-btn {
		flex: 1;
		min-width: max-content;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 14px;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--fm-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--fm-radius);
		cursor: pointer;
		transition: all 0.15s ease;
		white-space: nowrap;
		font-family: inherit;
	}
	.tab-btn:hover {
		color: var(--fm-text);
		background: var(--fm-bg);
	}
	.tab-active {
		color: var(--fm-text);
		background: var(--fm-bg);
		border-color: var(--fm-border);
		font-weight: 600;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}
	@media (max-width: 640px) {
		.tab-btn { padding: 8px 10px; font-size: 11.5px; }
		.tab-btn span { display: none; }
	}
</style>

<div class="mx-auto fm-form">
	<!-- Tab Bar -->
	<nav class="tab-bar" aria-label="Secciones del formulario">
		{#each TABS as tab (tab.id)}
			<button
				type="button"
				class="tab-btn"
				class:tab-active={activeTab === tab.id}
				on:click={() => setTab(tab.id)}
				aria-pressed={activeTab === tab.id}
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={tab.icon} />
				</svg>
				<span>{tab.label}</span>
			</button>
		{/each}
	</nav>

	<!-- Form Sections -->
	<form on:submit|preventDefault={handleSubmit} class="space-y-6" novalidate>

	{#if activeTab === 'identificacion'}
	<div
		class="rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)] p-6"
		transition:fly={{ y: 20 }}
	>
		<h2 class="mb-4 text-base font-semibold text-[var(--fm-text)] tracking-tight">Identificación del Hallazgo</h2>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div>
				<label for="fecha_registro" class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]">
					Fecha de registro
				</label>
				<input
					id="fecha_registro"
					type="date"
					bind:value={created_at_form}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
				/>
				<p class="mt-1 text-xs text-[var(--fm-muted)]">
					{modoEdicion
						? 'Fecha en que se creó el registro en el sistema'
						: 'Se asignará al guardar'}
				</p>
			</div>

			<div>
				<label for="accion_numero" class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]">
					Acción No. *
				</label>
				<input
					id="accion_numero"
					type="text"
					bind:value={accion_numero}
					disabled={modoEdicion}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)] disabled:bg-[var(--fm-surface)] disabled:text-[var(--fm-muted)]"
					placeholder="Ej: A26_01"
					required
				/>
				{#if errors.accion_numero}
					<p class="mt-1 text-sm text-red-600">{errors.accion_numero}</p>
				{/if}
			</div>

			<div>
				<label
					for="tipo_hallazgo_detectado"
					class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
				>
					Tipo de hallazgo
				</label>
				<select
					id="tipo_hallazgo_detectado"
					bind:value={tipo_hallazgo_detectado}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
				>
					<option value="">Seleccionar...</option>
					{#each TIPOS_HALLAZGO as tipo}
						<option value={tipo.value}>{tipo.label}</option>
					{/each}
					{#if tipo_hallazgo_detectado && !TIPOS_HALLAZGO.some((t) => t.value === tipo_hallazgo_detectado)}
						<option value={tipo_hallazgo_detectado}>{tipo_hallazgo_detectado}</option>
					{/if}
				</select>
				{#if tipo_hallazgo_detectado?.toLowerCase() === 'otro'}
					<input
						type="text"
						bind:value={tipo_hallazgo_otros}
						placeholder="Especifique otro tipo..."
						class="mt-2 w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					/>
				{/if}
			</div>

			<div>
				<label
					for="proceso_origen_hallazgo"
					class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
				>
					Proceso donde se origina
				</label>
				<input
					id="proceso_origen_hallazgo"
					type="text"
					bind:value={proceso_origen_hallazgo}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					placeholder="Ej: Operaciones, Gestión HSEQ"
				/>
			</div>

			<div>
				<label for="lugar_sede" class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]">
					Lugar / Sede
				</label>
				<input
					id="lugar_sede"
					type="text"
					bind:value={lugar_sede}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					placeholder="Ej: Sede Principal, instalación del cliente"
				/>
			</div>

			<div>
				<label
					for="fuente_genero_hallazgo"
					class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
				>
					Fuente que generó el hallazgo
				</label>
				<select
					id="fuente_genero_hallazgo"
					bind:value={fuente_genero_hallazgo}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
				>
					<option value="">Seleccionar...</option>
					{#each FUENTES_HALLAZGO as fuente}
						<option value={fuente}>{fuente}</option>
					{/each}
					{#if fuente_genero_hallazgo && !FUENTES_HALLAZGO.includes(fuente_genero_hallazgo)}
						<option value={fuente_genero_hallazgo}>{fuente_genero_hallazgo}</option>
					{/if}
				</select>
				{#if fuente_genero_hallazgo?.toLowerCase() === 'otro'}
					<input
						type="text"
						bind:value={fuente_hallazgo_otros}
						placeholder="Especifique otra fuente..."
						class="mt-2 w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					/>
				{/if}
			</div>

			<div>
				<label
					for="fecha_identificacion_hallazgo"
					class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
				>
					Fecha de identificación del hallazgo
				</label>
				<input
					id="fecha_identificacion_hallazgo"
					type="date"
					bind:value={fecha_identificacion_hallazgo}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
				/>
			</div>

			<div>
				<label
					for="componente_elemento_referencia"
					class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
				>
					Componente / Elemento / Requisito de entrada de referencia
				</label>
				<input
					id="componente_elemento_referencia"
					type="text"
					bind:value={componente_elemento_referencia}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					placeholder="Ej: Procedimiento, registro, programa"
				/>
			</div>

			<div>
				<label for="marco_legal_normativo" class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]">
					Marco legal / Normativo / Contractual que se incumple o aplica
				</label>
				<input
					id="marco_legal_normativo"
					type="text"
					bind:value={marco_legal_normativo}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					placeholder="Ej: Decreto 1072, Norma ISO 9001"
				/>
			</div>

			<div>
				<label
					for="variable_categoria_analisis"
					class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
				>
					Variable / categoría para análisis de tendencias
				</label>
				<input
					id="variable_categoria_analisis"
					type="text"
					bind:value={variable_categoria_analisis}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					placeholder="Ej: Accidentalidad, Incumplimiento, Gestión"
				/>
			</div>

			<div class="md:col-span-2">
				<label for="descripcion_hallazgo" class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]">
					Descripción del hallazgo / No Conformidad / Riesgo Potencial / Oportunidad de Mejora *
				</label>
				<textarea
					id="descripcion_hallazgo"
					bind:value={descripcion_hallazgo}
					rows="4"
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					placeholder="Describa qué ocurrió, dónde y qué requisito se incumple..."
					required
				></textarea>
				{#if errors.descripcion_hallazgo}
					<p class="mt-1 text-sm text-red-600">{errors.descripcion_hallazgo}</p>
				{/if}
			</div>

			<div class="md:col-span-2">
				<span class="mb-2 block text-sm font-medium text-[var(--fm-text)]">
					Requiere actualizar: Matriz Riesgos / Peligros / Impactos / Otros
				</span>
				<div class="flex flex-wrap gap-4">
					{#each MATRICES_ACTUALIZAR as matriz}
						<label class="flex items-center gap-2 text-sm text-[var(--fm-text-secondary)]">
							<input
								type="checkbox"
								checked={matricesSeleccionadas.includes(matriz.key)}
								on:change={() => toggleMatriz(matriz.key)}
								class="h-4 w-4 rounded border-[var(--fm-border)] text-[var(--fm-text)] focus:ring-[var(--fm-focus-ring)]"
							/>
							{matriz.label}
						</label>
					{/each}
				</div>
				{#if matricesSeleccionadas.includes('Otros')}
					<input
						type="text"
						bind:value={matriz_otros_detalle}
						placeholder="Especifique otra matriz u observación"
						class="mt-3 w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2.5 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					/>
				{/if}
			</div>

			<div class="md:col-span-2">
				<label for="tipo_accion_ejecutar" class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]">
					Tipo de acción (Correctiva / Preventiva / Mejora) *
				</label>
				<select
					id="tipo_accion_ejecutar"
					bind:value={tipo_accion_ejecutar}
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)] md:max-w-md"
					required
				>
					<option value="">Seleccionar...</option>
					<option value="CORRECTIVA">Correctiva</option>
					<option value="PREVENTIVA">Preventiva</option>
					<option value="MEJORA">Mejora</option>
				</select>
				{#if errors.tipo_accion_ejecutar}
					<p class="mt-1 text-sm text-red-600">{errors.tipo_accion_ejecutar}</p>
				{/if}
			</div>
		</div>
	</div>
	{/if}

	{#if activeTab === 'riesgo'}
	<div
		class="rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)] p-6"
		transition:fly={{ y: 20 }}
	>
		<div class="mb-6">
			<h2 class="mb-2 text-base font-semibold text-[var(--fm-text)] tracking-tight">Valoración del Riesgo</h2>
			<p class="mb-4 text-xs text-[var(--fm-muted)]">
				Seleccione el nivel de riesgo para calcular automáticamente los plazos de cumplimiento.
			</p>
			<SelectorRiesgo bind:value={valoracion_riesgo} />
		</div>

		{#if plazosCalculados}
			<div class="mb-8 rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface)] p-5" transition:slide>
				<h3 class="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--fm-text)]">
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
						/>
					</svg>
					PLAZOS CALCULADOS (Basados en Fecha de Registro y valoración del Riesgo)
				</h3>
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
					<div class="flex flex-col">
						<span class="text-[10px] font-bold text-[var(--fm-muted)] uppercase">Corrección</span>
						<span class="text-sm font-semibold text-[var(--fm-text)] font-mono"
							>{formatFechaDisplay(plazosCalculados.fecha_correccion)}</span
						>
					</div>
					<div class="flex flex-col">
						<span class="text-[10px] font-bold text-[var(--fm-muted)] uppercase">Plan Aprobado</span>
						<span class="text-sm font-semibold text-[var(--fm-text)] font-mono"
							>{formatFechaDisplay(plazosCalculados.fecha_plan_aprobado)}</span
						>
					</div>
					<div class="flex flex-col">
						<span class="text-[10px] font-bold text-[var(--fm-muted)] uppercase">Implementación</span>
						<span class="text-sm font-semibold text-[var(--fm-text)] font-mono"
							>{formatFechaDisplay(plazosCalculados.fecha_implementacion)}</span
						>
					</div>
					<div class="flex flex-col">
						<span class="text-[10px] font-bold text-[var(--fm-muted)] uppercase">Evaluación Eficacia</span>
						<span class="text-sm font-semibold text-[var(--fm-text)] font-mono"
							>{formatFechaDisplay(plazosCalculados.eficacia_1)}</span
						>
					</div>
				</div>
			</div>
		{/if}

		<hr class="my-6 border-[var(--fm-border)]" />

		<h2 class="mb-1 text-base font-semibold text-[var(--fm-text)] tracking-tight">Corrección o solución inmediata</h2>
		<p class="mb-4 text-xs text-[var(--fm-muted)]">
			Acción de contención inmediata (no elimina la causa raíz).
		</p>

		<div class="mb-6">
			<span class="mb-3 block text-sm font-medium text-[var(--fm-text)]"
				>¿Se formula corrección inmediata?</span
			>
			<div class="flex gap-4">
				<label
					class="flex cursor-pointer items-center gap-2 rounded-[var(--fm-radius)] border border-[var(--fm-border)] px-4 py-2 text-sm transition-colors {aplica_correccion_inmediata
						? 'border-[var(--fm-text)] bg-[var(--fm-text)] text-white'
						: 'hover:bg-[var(--fm-surface)]'}"
				>
					<input
						type="radio"
						bind:group={aplica_correccion_inmediata}
						value={true}
						class="hidden"
					/>
					Sí, se requiere
				</label>
				<label
					class="flex cursor-pointer items-center gap-2 rounded-[var(--fm-radius)] border border-[var(--fm-border)] px-4 py-2 text-sm transition-colors {!aplica_correccion_inmediata
						? 'border-red-500 bg-red-500 text-white'
						: 'hover:bg-[var(--fm-surface)]'}"
				>
					<input
						type="radio"
						bind:group={aplica_correccion_inmediata}
						value={false}
						class="hidden"
					/>
					No se requiere
				</label>
			</div>
		</div>

		{#if !aplica_correccion_inmediata}
			<div transition:slide>
				<label
					for="justificacion_no_correccion"
					class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
				>
					Justificación de por qué no se requiere corrección inmediata
				</label>
				<textarea
					id="justificacion_no_correccion"
					bind:value={justificacion_no_correccion}
					rows="3"
					class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					placeholder="Explique las razones técnicas o de proceso..."
				></textarea>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2" transition:slide>
				<div class="md:col-span-2">
					<label
						for="correccion_solucion_inmediata"
						class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
					>
						Descripción de la corrección o solución inmediata propuesta
					</label>
					<textarea
						id="correccion_solucion_inmediata"
						bind:value={correccion_solucion_inmediata}
						rows="3"
						class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
						placeholder="Ej: suspensión temporal, notificación al proveedor..."
					></textarea>
				</div>

				<div>
					<label
						for="fecha_implementacion"
						class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
					>
						Fecha de implementación
					</label>
					<input
						id="fecha_implementacion"
						type="date"
						bind:value={fecha_implementacion}
						class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					/>
					{#if plazosCalculados}
						<p class="mt-1 text-[10px] font-bold text-[var(--fm-muted)]">
							PLAZO MÁXIMO: {formatFechaDisplay(plazosCalculados.fecha_correccion)}
						</p>
					{/if}
				</div>

				<div>
					<label
						for="responsable_correccion"
						class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]"
					>
						Responsable de la corrección
					</label>
					<input
						id="responsable_correccion"
						type="text"
						bind:value={responsable_correccion}
						class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
						placeholder="Nombre y cargo"
					/>
				</div>
			</div>

			<BloqueRegistrosSeguimiento
				titulo="Seguimiento a la acción planeada (corrección inmediata)"
				bind:registros={seguimientosCorreccion}
				tema="neutral"
			/>
		{/if}
	</div>
	{/if}

	{#if activeTab === 'causas'}
	<div
		class="rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)] p-6"
		transition:fly={{ y: 20 }}
	>
		<h2 class="mb-4 text-base font-semibold text-[var(--fm-text)] tracking-tight">
			Análisis de causas y planes de acción
		</h2>

		<div class="space-y-6">
			<div class="flex items-center justify-between">
				<p class="text-xs text-[var(--fm-muted)]">
					Metodología 5 Por Qué (Consejo Colombiano: hasta 7 niveles; puede agregar más). Resalte
					la causa raíz.
				</p>
				{#if causas.length < MAX_CAUSAS}
					<button
						type="button"
						on:click={agregarCausa}
						class="rounded-[var(--fm-radius)] bg-[var(--fm-text)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--fm-text-secondary)]"
					>
						(+) Nueva Causa
					</button>
				{/if}
			</div>

			{#each causas as causa, index}
				<div class="overflow-hidden rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)]">
					<div class="border-b border-[var(--fm-border)] bg-[var(--fm-surface)] px-4 py-2">
						<div class="flex items-center justify-between">
							<span class="inline-flex items-center gap-2 rounded-full bg-[var(--fm-text)] px-2.5 py-0.5 text-xs font-semibold text-white">
								Causa #{causa.orden}
							</span>
							<div class="flex items-center gap-3">
								{#if causas.length < MAX_CAUSAS}
									<button
										type="button"
										on:click={() => copiarCausa(index)}
										class="inline-flex items-center gap-1 text-xs text-[var(--fm-text-secondary)] hover:text-[var(--fm-text)]"
										title="Copiar esta causa (sin seguimientos) justo después"
									>
										<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
										</svg>
										Copiar
									</button>
								{/if}
								{#if causas.length > 1}
									<button
										type="button"
										on:click={() => eliminarCausa(index)}
										class="text-xs text-red-600 hover:text-red-800"
									>
										Eliminar causa
									</button>
								{/if}
							</div>
						</div>
					</div>
					<div class="space-y-4 bg-[var(--fm-bg)] p-4">
						<div>
							<label class="mb-1 block text-sm font-medium text-[var(--fm-text)]">
								Análisis de causas (5 Por Qué) *
							</label>
							<textarea
								bind:value={causa.analisis_causa}
								rows="5"
								class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
								placeholder="1. ¿Por qué...? 2. ¿Por qué...? 3. ¿Por qué...? Use **negrilla** para la(s) causa(s) raíz."
							></textarea>
						</div>

						<div class="flex items-center gap-6">
							<span class="text-sm font-medium text-[var(--fm-text)]">¿Es la causa raíz?</span>
							<label class="flex items-center gap-2 text-sm">
								<input
									type="radio"
									name="es_causa_raiz_{index}"
									bind:group={causa.es_causa_raiz}
									value={true}
								/>
								Sí
							</label>
							<label class="flex items-center gap-2 text-sm">
								<input
									type="radio"
									name="es_causa_raiz_{index}"
									bind:group={causa.es_causa_raiz}
									value={false}
								/>
								No
							</label>
						</div>

						<div>
							<label class="mb-1 block text-sm font-medium text-[var(--fm-text)]">
								Descripción de la(s) acción / Plan de acción
							</label>
							<textarea
								bind:value={causa.descripcion_plan_accion}
								rows="3"
								class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
								placeholder="Acciones para que no vuelva a suceder o prevenir su presentación..."
							></textarea>
						</div>

						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<label class="mb-1 block text-sm font-medium text-[var(--fm-text)]">
									Fecha límite de implementación y cierre
								</label>
								<input
									type="date"
									bind:value={causa.fecha_limite_implementacion}
									class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
								/>
								{#if plazosCalculados}
									<p class="mt-1 text-[10px] font-bold text-[var(--fm-muted)]">
										PLAZO MÁXIMO: {formatFechaDisplay(plazosCalculados.fecha_implementacion)}
									</p>
								{/if}
							</div>
							<div>
								<label class="mb-1 block text-sm font-medium text-[var(--fm-text)]">
									Responsable de la ejecución
								</label>
								<input
									type="text"
									bind:value={causa.responsable_ejecucion}
									class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
									placeholder="Nombre y cargo"
								/>
							</div>
						</div>

						<BloqueRegistrosSeguimiento
							titulo="Registro de seguimiento (por causa)"
							bind:registros={causa.seguimientos}
							tema="neutral"
							onEstadoChange={onEstadoSeguimientoChange}
						/>
					</div>
				</div>
			{/each}
		</div>
	</div>
	{/if}

	{#if activeTab === 'aprobacion'}
		<Step4Approval {accion} tipoHallazgoDetectado={tipo_hallazgo_detectado} />
	{/if}

	{#if activeTab === 'estado'}
		<Step5ActionStatus {accion} usuarioId={accion?.creado_por_id || null} />
	{/if}

	{#if activeTab === 'eficacia'}
	<div
			class="rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)] p-6"
			transition:fly={{ y: 20 }}
		>
			<h2 class="mb-4 text-base font-semibold text-[var(--fm-text)] tracking-tight">
				Análisis y evaluación de la eficacia
			</h2>

			<div class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]">
						Fecha límite para la evaluación de la eficacia
					</label>
					<input
						type="date"
						bind:value={fecha_limite_evaluacion_eficacia}
						class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
					/>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1.5 block text-sm font-medium text-[var(--fm-text)]">
						Criterio de evaluación de la eficacia
					</label>
					<textarea
						bind:value={criterio_evaluacion_eficacia}
						rows="3"
						class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
						placeholder="Indicadores, evidencias esperadas, condiciones de cierre eficaz..."
					></textarea>
				</div>
			</div>

			<div class="mb-6 rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface)] p-4">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h3 class="text-sm font-semibold text-[var(--fm-text)]">
						Ciclos de seguimiento a la eficacia (mínimo 1)
					</h3>
					<button
						type="button"
						on:click={agregarCicloEficacia}
						class="rounded-[var(--fm-radius)] bg-[var(--fm-text)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--fm-text-secondary)]"
					>
						(+) Agregar ciclo
					</button>
				</div>
				<p class="mb-3 text-xs text-[var(--fm-muted)]">
					Registre cada ciclo de revisión. En cada ciclo marque los criterios de eficacia que se
					cumplieron (defínelos arriba, uno por línea).
				</p>
				<div class="space-y-3">
					{#each ciclosEficacia as ciclo, i}
						<div class="overflow-hidden rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)]">
							<div
								class="flex items-center justify-between border-b border-[var(--fm-border)] bg-[var(--fm-surface)] px-4 py-2"
							>
								<span class="text-xs font-semibold text-[var(--fm-text)]"
									>Ciclo {ciclo.numero_ciclo}</span
								>
								{#if ciclosEficacia.length > 1}
									<button
										type="button"
										on:click={() => eliminarCicloEficacia(i)}
										class="text-xs text-red-600 hover:text-red-800"
									>
										Eliminar ciclo
									</button>
								{/if}
							</div>
							<div class="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
								<div>
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]"
										>Fecha de seguimiento</label
									>
									<input
										type="date"
										bind:value={ciclo.fecha_seguimiento}
										class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
									/>
								</div>
								<div>
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">Responsable</label>
									<input
										type="text"
										bind:value={ciclo.responsable}
										class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
										placeholder="Nombre del responsable"
									/>
								</div>
								<div>
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">Cargo</label>
									<input
										type="text"
										bind:value={ciclo.cargo}
										class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
										placeholder="Cargo del responsable"
									/>
								</div>
								<div class="md:col-span-2">
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">
										Descripción del análisis / actividades
									</label>
									<textarea
										bind:value={ciclo.descripcion}
										rows="2"
										class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
										placeholder="Resumen del análisis realizado en este ciclo..."
									></textarea>
								</div>
								<div class="md:col-span-2">
									<span class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]"
										>Resultado del ciclo</span
									>
									<div
										class="flex flex-wrap gap-4 rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2.5"
									>
										{#each RESULTADOS_CICLO_EFICACIA as res}
											<label class="flex items-center gap-2 text-sm text-[var(--fm-text)]">
												<input
													type="radio"
													name="resultado_ciclo_{i}"
													value={res.value}
													bind:group={ciclo.resultado_ciclo}
													class="border-[var(--fm-border)] text-[var(--fm-text)] focus:ring-[var(--fm-focus-ring)]"
												/>
												{res.label}
											</label>
										{/each}
									</div>
								</div>

								<div class="md:col-span-2">
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]"
										>Adjunto / Evidencia del ciclo</label
									>
									<div class="flex items-center gap-2">
										{#if ciclo.adjunto_url}
											<a
												href={ciclo.adjunto_url}
												target="_blank"
												class="flex flex-1 items-center gap-2 rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-xs text-[var(--fm-text-secondary)]"
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
													/></svg
												>
												Ver documento
											</a>
											<button
												type="button"
												on:click={() => (ciclo.adjunto_url = undefined)}
												class="p-2 text-red-600"
												><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
													/></svg
												></button
											>
										{:else}
											<input
												type="file"
												on:change={(e) => handleFileUploadGeneric(ciclo, 'adjunto_url', e)}
												class="text-xs"
											/>
										{/if}
									</div>
								</div>

								{#if listaCriteriosEficacia.length > 0}
									<div class="md:col-span-2">
										<span class="mb-2 block text-xs font-medium text-[var(--fm-text-secondary)]">
											Criterios cumplidos en este ciclo
										</span>
										<ul
											class="space-y-1.5 rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] p-3"
										>
											{#each listaCriteriosEficacia as criterio}
												<li>
													<label
														class="flex cursor-pointer items-start gap-2 text-sm text-[var(--fm-text)]"
													>
														<input
															type="checkbox"
															checked={ciclo.criterios_cumplidos?.includes(criterio)}
															on:change={(e) =>
																toggleCriterioCiclo(
																	i,
																	criterio,
																	(e.currentTarget as HTMLInputElement).checked
																)}
															class="mt-0.5 rounded border-[var(--fm-border)] text-[var(--fm-text)] focus:ring-[var(--fm-focus-ring)]"
														/>
														<span>{criterio}</span>
													</label>
												</li>
											{/each}
										</ul>
									</div>
								{:else if criterio_evaluacion_eficacia.trim()}
									<p class="text-xs text-amber-700 md:col-span-2">
										Use una línea por criterio en el campo «Criterio de evaluación» para poder
										marcarlos por ciclo.
									</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="mb-6 rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface)] p-4">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h3 class="text-sm font-semibold text-[var(--fm-text)]">
						Evidencias que soportan el cierre eficaz
					</h3>
					<button
						type="button"
						on:click={agregarEvidencia}
						class="rounded-[var(--fm-radius)] bg-[var(--fm-text)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--fm-text-secondary)]"
					>
						(+) Agregar evidencia
					</button>
				</div>
				<div class="space-y-3">
					{#each evidenciasEficacia as ev, i}
						<div class="overflow-hidden rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface-elevated)]">
							<div
								class="flex items-center justify-between border-b border-[var(--fm-border)] bg-[var(--fm-surface)] px-4 py-2"
							>
								<span class="text-xs font-semibold text-[var(--fm-text)]">Evidencia #{i + 1}</span>
								{#if evidenciasEficacia.length > 1}
									<button
										type="button"
										on:click={() => eliminarEvidencia(i)}
										class="text-xs text-red-600 hover:text-red-800"
									>
										Eliminar evidencia
									</button>
								{/if}
							</div>
							<div class="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
								<div>
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">
										Tipo de evidencia o soporte
									</label>
									<input
										type="text"
										bind:value={ev.tipo_evidencia}
										class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
										placeholder="Ej: Acta de reunión, Lista de asistencia, Registro fotográfico"
									/>
								</div>
								<div>
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">Fecha</label>
									<input
										type="date"
										bind:value={ev.fecha}
										class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
									/>
								</div>
								<div class="md:col-span-2">
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]"
										>Descripción específica</label
									>
									<textarea
										bind:value={ev.descripcion}
										rows="2"
										class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
										placeholder="Detalle de la evidencia recolectada..."
									></textarea>
								</div>
								<div>
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]"
										>Estado / Ubicación</label
									>
									<select
										bind:value={ev.estado_ubicacion}
										class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
									>
										<option value="">Seleccionar...</option>
										{#each ESTADOS_EVIDENCIA as est}
											<option value={est.value}>{est.label}</option>
										{/each}
									</select>
								</div>

								<div>
									<label class="mb-1 block text-xs font-medium text-[var(--fm-text-secondary)]">Archivo Adjunto</label
									>
									<div class="flex items-center gap-2">
										{#if ev.adjunto_url}
											<a
												href={ev.adjunto_url}
												target="_blank"
												class="flex flex-1 items-center gap-2 rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-xs text-[var(--fm-text-secondary)]"
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
													/></svg
												>
												Ver soporte
											</a>
											<button
												type="button"
												on:click={() => (ev.adjunto_url = undefined)}
												class="p-2 text-red-600"
												><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
													/></svg
												></button
											>
										{:else}
											<input
												type="file"
												on:change={(e) => handleFileUploadGeneric(ev, 'adjunto_url', e)}
												class="text-xs"
											/>
										{/if}
									</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="rounded-[var(--fm-radius-lg)] border border-[var(--fm-border)] bg-[var(--fm-surface)] p-4">
				<h3 class="mb-3 text-sm font-semibold text-[var(--fm-text)] tracking-tight">Registro del cierre definitivo</h3>
				<div class="mb-6">
					<span class="mb-3 block text-sm font-medium text-[var(--fm-text)]"
						>Resultado final de eficacia</span
					>
					<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
						{#each EVALUACIONES_CIERRE as ev}
							{@const ui = RESULTADOS_EFICACIA_UI[ev.value]}
							<label
								class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all {evaluacion_cierre_eficaz ===
								ev.value
									? ui.active
									: ui.inactive}"
							>
								<input
									type="radio"
									bind:group={evaluacion_cierre_eficaz}
									value={ev.value}
									class="hidden"
								/>
								<span class="text-2xl">{ui.icon}</span>
								<span class="text-sm font-bold tracking-wide uppercase">{ev.label}</span>
								<span class="text-center text-[10px] leading-tight opacity-90">{ui.desc}</span>
							</label>
						{/each}
					</div>
				</div>

				{#if evaluacion_cierre_eficaz === 'NO EFICAZ' || aplica_reapertura}
					<div
						class="mb-6 rounded-lg border border-red-200 bg-red-50/50 p-5 shadow-sm"
						transition:slide
					>
						<div class="mb-4 flex items-center gap-3 text-red-800">
							<span class="text-2xl">⚠️</span>
							<div>
								<h4 class="text-sm font-bold uppercase">REAPERTURA DE ACCIÓN</h4>
								<p class="text-xs">
									El resultado NO EFICAZ requiere reabrir la acción o generar una nueva.
								</p>
							</div>
						</div>
						<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<label class="mb-1 block text-xs font-medium text-red-700"
									>Fecha de Reapertura</label
								>
								<input
									type="date"
									bind:value={fecha_reapertura}
									class="w-full rounded border-red-200 text-sm"
								/>
							</div>
							<div class="md:col-span-2">
								<label class="mb-1 block text-xs font-medium text-red-700"
									>Razón de la Reapertura</label
								>
								<textarea
									bind:value={razon_reapertura}
									rows="2"
									class="w-full rounded border-red-200 text-sm"
									placeholder="Explique por qué las acciones no fueron eficaces..."
								></textarea>
							</div>
							<div class="pt-2 md:col-span-2">
								<button
									type="button"
									on:click={reabrirAccion}
									disabled={isSubmitting}
									class="w-full rounded-lg bg-red-600 py-3 text-sm font-bold text-white shadow-lg transition-colors hover:bg-red-700 disabled:opacity-50"
								>
									Generar Nueva Acción desde Reapertura
								</button>
							</div>
						</div>
					</div>
				{/if}

				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<div>
						<label class="mb-1 block text-sm font-medium text-[var(--fm-text)]"
							>Fecha de cierre definitivo</label
						>
						<input
							type="date"
							bind:value={fecha_cierre_definitivo}
							class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
						/>
					</div>
					<div>
						<label class="mb-1 block text-sm font-medium text-[var(--fm-text)]"
							>Responsable del cierre</label
						>
						<input
							type="text"
							bind:value={responsable_cierre}
							class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
							placeholder="Nombre de quien valida el cierre"
						/>
					</div>
					<div>
						<label class="mb-1 block text-sm font-medium text-[var(--fm-text)]">Cargo</label>
						<input
							type="text"
							bind:value={cargo_responsable_cierre}
							class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
							placeholder="Cargo de quien valida el cierre"
						/>
					</div>
					<div class="md:col-span-2">
						<label class="mb-1 block text-sm font-medium text-[var(--fm-text)]">
							Observaciones del cierre y lecciones aprendidas
						</label>
						<textarea
							bind:value={observaciones_cierre}
							rows="3"
							class="w-full rounded-[var(--fm-radius)] border border-[var(--fm-border)] bg-[var(--fm-surface)] px-3 py-2 text-sm focus:border-[var(--fm-text)] focus:ring-2 focus:ring-[var(--fm-focus-ring)]"
							placeholder="Conclusiones generales sobre la eficacia de las acciones y aprendizajes para el proceso..."
						></textarea>
					</div>
				</div>
			</div>

			{#if Object.values(errors).length > 0}
				<div class="mt-4 rounded-[var(--fm-radius)] bg-red-50 p-2">
					<p class="font-semibold text-red-400">Errores</p>
					{#each Object.keys(errors) as key, idx}
						<p class="text-sm text-red-400">{idx + 1}. {key.replace(/_/g, ' ')}: {errors[key]}</p>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
	</form>
</div>
