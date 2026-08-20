/**
 * Estado de diligenciamiento de un formulario.
 *
 * Lo comparten el PREVIEW del builder y el RUNNER del portal. Esa es la razón de
 * que exista como clase aparte y no dentro de una página: el documento exige que
 * el preview use exactamente el mismo renderer que el conductor, y un renderer
 * compartido necesita un estado compartido. Con dos implementaciones, el preview
 * enseñaría un formulario que se comporta distinto al real.
 *
 * No sabe nada de red, de IndexedDB ni de la outbox: solo respuestas,
 * ocurrencias y adjuntos en memoria. Quien persiste es la capa de arriba.
 */

import {
	capabilitiesOf,
	isContainer,
	SUBMISSION_LIMITS,
	type FormFieldDto,
	type FormSectionDto
} from './types';
import { flattenSections, resolveFieldStates, type FieldState } from './rules';
import {
	answerKey,
	computeProgress,
	validateAnswers,
	type AnswerIssue,
	type DraftAnswer,
	type DraftAttachment
} from './validate-answers';

export interface RunnerInit {
	sections: FormSectionDto[];
	/** Respuestas ya capturadas (reanudar un borrador). */
	answers?: DraftAnswer[];
	attachments?: DraftAttachment[];
	/** Solo lectura: recibo de un envío o preview de una versión publicada. */
	readonly?: boolean;
}

export function createRunnerState(init: RunnerInit) {
	let sections = $state<FormSectionDto[]>(init.sections);
	let readonly = $state(Boolean(init.readonly));

	/// Las respuestas se guardan en un mapa por `fieldId|occurrenceId`, que es la
	/// misma clave que usan los índices únicos de la base. Con un array habría que
	/// buscar linealmente en cada pulsación de tecla.
	let answers = $state<Map<string, DraftAnswer>>(
		new Map((init.answers ?? []).map((a) => [answerKey(a.fieldId, a.occurrenceId), a]))
	);
	let attachments = $state<DraftAttachment[]>(init.attachments ?? []);

	/**
	 * Ocurrencias por contenedor, en orden.
	 *
	 * Se mantiene explícita en vez de derivarse de las respuestas porque una fila
	 * recién añadida todavía no tiene ninguna: si se derivara, añadir una fila y
	 * no escribir nada la haría desaparecer al siguiente render.
	 *
	 * La siembra se calcula ANTES del `$state` y a partir de `init`, no del estado
	 * ya creado: leer el estado reactivo en la inicialización captura solo su valor
	 * inicial y Svelte lo advierte con razón.
	 */
	let occurrences = $state<Map<string, string[]>>(sembrarOcurrencias(init));

	/// Errores mostrados. Vacío hasta que el campo se toca o se intenta enviar:
	/// pintar todo en rojo al abrir un preoperacional de 200 ítems es hostil.
	let touched = $state<Set<string>>(new Set());
	let submitAttempted = $state(false);

	const flat = $derived(flattenSections(sections));
	const fieldById = $derived(new Map(flat.map((f) => [f.field.id, f])));
	/// Índice por clave. Sin él, `valorDe` recorría el árbol entero en CADA
	/// evaluación de condición: con los ~270 campos y ~120 reglas del
	/// preoperacional FR-08 son decenas de miles de recorridos por pulsación de
	/// tecla, y eso se nota en un teléfono de gama baja.
	const fieldByKey = $derived(new Map(flat.map((f) => [f.field.key, f])));

	function valorDe(fieldKey: string, occurrenceId: string | null): unknown {
		const entrada = fieldByKey.get(fieldKey);
		if (!entrada) return undefined;
		const enFila = occurrenceId ? answers.get(answerKey(entrada.field.id, occurrenceId)) : undefined;
		const answer = enFila ?? answers.get(answerKey(entrada.field.id, null));
		if (!answer) return undefined;
		if ((answer.optionValues ?? []).length) return answer.optionValues;
		return answer.value;
	}

	/**
	 * Estados de campo por contexto de ocurrencia.
	 *
	 * Se recalcula ante cualquier cambio de respuesta porque cualquier respuesta
	 * puede ser la condición de una regla. El coste es un recorrido del árbol por
	 * contexto, que en el formulario más grande de HSEQ son unos cientos de nodos.
	 */
	const estadosRaiz = $derived(resolveFieldStates(flat, valorDe, null));

	function estadosDeFila(occurrenceId: string | null): Map<string, FieldState> {
		if (!occurrenceId) return estadosRaiz;
		return resolveFieldStates(flat, valorDe, occurrenceId);
	}

	function stateOf(fieldId: string, occurrenceId: string | null = null): FieldState {
		return (
			estadosDeFila(occurrenceId).get(fieldId) ?? { visible: true, required: false, disabled: false }
		);
	}

	// ── Lectura / escritura de respuestas ────────────────────────────────────

	function get(fieldId: string, occurrenceId: string | null = null): DraftAnswer | undefined {
		return answers.get(answerKey(fieldId, occurrenceId));
	}

	function valueOf(fieldId: string, occurrenceId: string | null = null): unknown {
		return get(fieldId, occurrenceId)?.value;
	}

	function optionsOf(fieldId: string, occurrenceId: string | null = null): string[] {
		return get(fieldId, occurrenceId)?.optionValues ?? [];
	}

	function set(fieldId: string, value: unknown, occurrenceId: string | null = null) {
		if (readonly) return;
		const clave = answerKey(fieldId, occurrenceId);
		const previa = answers.get(clave);
		const siguiente: DraftAnswer = {
			fieldId,
			occurrenceId: occurrenceId ?? null,
			rowIndex: previa?.rowIndex ?? rowIndexOf(fieldId, occurrenceId),
			value,
			optionValues: previa?.optionValues
		};
		const copia = new Map(answers);
		/// Vaciar un campo BORRA la respuesta en vez de guardar `""`: una respuesta
		/// vacía cuenta como respondida para `required` y como fila existente en un
		/// repetible.
		if (value === undefined || value === null || value === '') {
			if ((siguiente.optionValues ?? []).length === 0) copia.delete(clave);
			else copia.set(clave, { ...siguiente, value: null });
		} else {
			copia.set(clave, siguiente);
		}
		answers = copia;
	}

	function setOptions(fieldId: string, optionValues: string[], occurrenceId: string | null = null) {
		if (readonly) return;
		const clave = answerKey(fieldId, occurrenceId);
		const copia = new Map(answers);
		if (optionValues.length === 0) copia.delete(clave);
		else {
			copia.set(clave, {
				fieldId,
				occurrenceId: occurrenceId ?? null,
				rowIndex: rowIndexOf(fieldId, occurrenceId),
				optionValues
			});
		}
		answers = copia;
	}

	/** Alterna una opción de un `MULTIPLE_CHOICE`. */
	function toggleOption(fieldId: string, value: string, occurrenceId: string | null = null) {
		const actuales = optionsOf(fieldId, occurrenceId);
		setOptions(
			fieldId,
			actuales.includes(value) ? actuales.filter((v) => v !== value) : [...actuales, value],
			occurrenceId
		);
	}

	function rowIndexOf(fieldId: string, occurrenceId: string | null): number | null {
		if (!occurrenceId) return null;
		const entrada = fieldById.get(fieldId);
		if (!entrada?.parent) return null;
		const lista = occurrences.get(entrada.parent.id) ?? [];
		const index = lista.indexOf(occurrenceId);
		return index < 0 ? null : index;
	}

	function markTouched(fieldId: string, occurrenceId: string | null = null) {
		const copia = new Set(touched);
		copia.add(answerKey(fieldId, occurrenceId));
		touched = copia;
	}

	// ── Ocurrencias ─────────────────────────────────────────────────────────

	function occurrencesOf(containerId: string): string[] {
		return occurrences.get(containerId) ?? [];
	}

	function addOccurrence(containerId: string): string | null {
		if (readonly) return null;
		const entrada = fieldById.get(containerId);
		if (!entrada || !isContainer(entrada.field.type)) return null;
		const lista = occurrencesOf(containerId);
		const max = Number(entrada.field.validation?.maxRows ?? SUBMISSION_LIMITS.maxOccurrencesPerContainer);
		if (lista.length >= max) return null;

		const id = crypto.randomUUID();
		const copia = new Map(occurrences);
		copia.set(containerId, [...lista, id]);
		occurrences = copia;
		return id;
	}

	function removeOccurrence(containerId: string, occurrenceId: string) {
		if (readonly) return;
		const copia = new Map(occurrences);
		copia.set(
			containerId,
			occurrencesOf(containerId).filter((id) => id !== occurrenceId)
		);
		occurrences = copia;

		/// Las respuestas de la fila se borran con ella. Conservarlas dejaría
		/// respuestas huérfanas que el backend rechazaría al no existir la
		/// ocurrencia en ningún contenedor.
		const answersCopia = new Map(answers);
		for (const [clave, answer] of answers) {
			if (answer.occurrenceId === occurrenceId) answersCopia.delete(clave);
		}
		answers = answersCopia;
		attachments = attachments.filter((a) => a.occurrenceId !== occurrenceId);
	}

	/**
	 * Asegura al menos `minRows` filas en cada contenedor visible.
	 *
	 * Se llama al abrir: un plan de acción con `minRows: 1` debe aparecer con su
	 * primera fila lista, no con un botón "añadir" que el conductor puede pasar
	 * por alto y que luego bloquea el envío.
	 */
	function seedMinRows() {
		for (const { field } of flat) {
			if (!isContainer(field.type)) continue;
			const min = Number(field.validation?.minRows ?? 0);
			const objetivo = Math.max(min, field.required ? 1 : 0);
			let actuales = occurrencesOf(field.id).length;
			while (actuales < objetivo) {
				if (!addOccurrence(field.id)) break;
				actuales += 1;
			}
		}
	}

	// ── Adjuntos ────────────────────────────────────────────────────────────

	function attachmentsOf(fieldId: string, occurrenceId: string | null = null): DraftAttachment[] {
		return attachments.filter(
			(a) => a.fieldId === fieldId && (a.occurrenceId ?? null) === (occurrenceId ?? null)
		);
	}

	function addAttachment(attachment: DraftAttachment) {
		if (readonly) return;
		attachments = [...attachments, attachment];
	}

	function removeAttachment(clientAttachmentId: string) {
		if (readonly) return;
		attachments = attachments.filter((a) => a.clientAttachmentId !== clientAttachmentId);
	}

	// ── Validación y progreso ───────────────────────────────────────────────

	const validation = $derived(
		validateAnswers({
			sections,
			answers: [...answers.values()],
			attachments,
			scope: 'all'
		})
	);

	const progress = $derived(computeProgress(validation));

	/**
	 * Errores que se MUESTRAN.
	 *
	 * Filtra por campos tocados hasta que se intenta enviar. Es la diferencia
	 * entre un formulario que acompaña y uno que regaña: al abrir un
	 * preoperacional de 200 ítems, todos están sin responder y ninguno es todavía
	 * un error del conductor.
	 */
	const visibleErrors = $derived(
		submitAttempted
			? validation.errors
			: validation.errors.filter((e) => touched.has(answerKey(e.fieldId, e.occurrenceId)))
	);

	function errorsFor(fieldId: string, occurrenceId: string | null = null): AnswerIssue[] {
		return visibleErrors.filter(
			(e) => e.fieldId === fieldId && (e.occurrenceId ?? null) === (occurrenceId ?? null)
		);
	}

	/** Marca el intento de envío: a partir de aquí se muestran todos los errores. */
	function attemptSubmit(): boolean {
		submitAttempted = true;
		return validation.errors.length === 0;
	}

	/** Respuestas listas para la outbox. */
	/**
	 * Respuestas como datos PLANOS, listas para salir del runner.
	 *
	 * `$state.snapshot` no es opcional aquí. `answers` es un `$state`, y Svelte 5
	 * envuelve su contenido en Proxies; `IDBObjectStore.put()` y `JSON.stringify`
	 * pasan por el algoritmo de clonado estructurado, que lanza `DataCloneError`
	 * ante un Proxy. Sin esto, cada autosave del borrador abortaba su transacción.
	 *
	 * Es además el límite correcto para hacerlo: esta función es exactamente
	 * «convierte el estado reactivo en payload».
	 */
	function toPayloadAnswers(): DraftAnswer[] {
		return $state.snapshot([...answers.values()]) as DraftAnswer[];
	}

	function replaceSections(nuevas: FormSectionDto[]) {
		sections = nuevas;
	}

	function setReadonly(value: boolean) {
		readonly = value;
	}

	/**
	 * Limpia las respuestas que dependían de un campo cuyo valor cambió.
	 *
	 * Se usa cuando el conductor cambia el vehículo a mitad del formulario: las
	 * respuestas de los ítems dependientes ya no corresponden a ese vehículo, y
	 * arrastrarlas produciría un preoperacional con datos de otro. La UI pide
	 * confirmación antes de llamar a esto.
	 */
	function clearDependents(fieldKey: string) {
		const dependientes = new Set<string>();
		for (const { field } of flat) {
			const rule = field.visibilityRule;
			if (!rule) continue;
			const usa = [...(rule.all ?? []), ...(rule.any ?? [])].some((c) => c.fieldKey === fieldKey);
			if (usa) dependientes.add(rule.effect?.targetFieldKey ?? field.key);
		}
		if (dependientes.size === 0) return;

		const ids = new Set(flat.filter((f) => dependientes.has(f.field.key)).map((f) => f.field.id));
		const copia = new Map(answers);
		for (const [clave, answer] of answers) if (ids.has(answer.fieldId)) copia.delete(clave);
		answers = copia;
	}

	return {
		get sections() {
			return sections;
		},
		get readonly() {
			return readonly;
		},
		get answers() {
			return answers;
		},
		get attachments() {
			return attachments;
		},
		get validation() {
			return validation;
		},
		get visibleErrors() {
			return visibleErrors;
		},
		get progress() {
			return progress;
		},
		get submitAttempted() {
			return submitAttempted;
		},
		get flat() {
			return flat;
		},

		stateOf,
		get,
		valueOf,
		optionsOf,
		set,
		setOptions,
		toggleOption,
		markTouched,
		errorsFor,

		occurrencesOf,
		addOccurrence,
		removeOccurrence,
		seedMinRows,

		attachmentsOf,
		addAttachment,
		removeAttachment,

		attemptSubmit,
		toPayloadAnswers,
		replaceSections,
		setReadonly,
		clearDependents
	};
}

export type RunnerState = ReturnType<typeof createRunnerState>;

/**
 * Reconstruye las ocurrencias de los contenedores a partir de las respuestas
 * guardadas.
 *
 * Al reanudar un borrador, las filas de un repetible solo existen implícitamente
 * en los `occurrenceId` de sus respuestas: sin esta reconstrucción, un plan de
 * acción con tres filas se abriría vacío y el conductor las volvería a escribir.
 */
function sembrarOcurrencias(init: RunnerInit): Map<string, string[]> {
	const mapa = new Map<string, string[]>();
	if (!init.answers?.length) return mapa;

	const plano = flattenSections(init.sections);
	const porId = new Map(plano.map((f) => [f.field.id, f]));

	for (const answer of init.answers) {
		if (!answer.occurrenceId) continue;
		const entrada = porId.get(answer.fieldId);
		if (!entrada?.parent) continue;
		const lista = mapa.get(entrada.parent.id) ?? [];
		if (!lista.includes(answer.occurrenceId)) lista.push(answer.occurrenceId);
		mapa.set(entrada.parent.id, lista);
	}
	return mapa;
}

/** Campo con su ruta legible, para el resumen accesible de errores. */
export function fieldLabelPath(sections: FormSectionDto[], fieldId: string): string {
	for (const section of sections) {
		const buscar = (fields: FormFieldDto[], prefijo: string[]): string | null => {
			for (const field of fields) {
				if (field.id === fieldId) return [...prefijo, field.label].join(' › ');
				const enHijos = buscar(field.children, [...prefijo, field.label]);
				if (enHijos) return enHijos;
			}
			return null;
		};
		const encontrado = buscar(section.fields, [section.title]);
		if (encontrado) return encontrado;
	}
	return '';
}

export { capabilitiesOf };
