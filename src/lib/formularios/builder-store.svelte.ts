/**
 * Estado del constructor de formularios.
 *
 * Decisiones que conviene entender antes de tocar esto:
 *
 * **Los nodos nuevos NO llevan `id` al servidor.** El backend valida que cada
 * `id` recibido pertenezca a la versión y rechaza los que no (`resolvePlan` →
 * `FORM_DEFINITION_INVALID`). Aquí se generan ids locales para poder seleccionar
 * y arrastrar cards antes de guardarlas, y se marcan con `isNew`; al serializar
 * se omiten y el servidor asigna los definitivos. Sin esa distinción, la primera
 * card creada haría fallar el autosave.
 *
 * **El orden es la posición en el array.** No se guarda `sortOrder` en el
 * estado local: el servidor lo recalcula por posición al guardar, así que
 * mantener un número aparte solo abriría la puerta a que las dos fuentes
 * discrepen tras un drag.
 *
 * **Undo/redo por instantáneas, no por diffs.** Cada mutación guarda una copia
 * estructural del árbol, con tope de 50. Un árbol de 800 campos ronda unos
 * cientos de KB, así que el histórico completo se mueve en pocos MB: es más
 * memoria que un diff, pero un diff sobre un árbol con reordenamientos y
 * reparentados es exactamente donde aparecen los bugs de undo.
 */

import {
	DEFINITION_LIMITS,
	capabilitiesOf,
	isContainer,
	toKey,
	type FieldType,
	type FormFieldDto,
	type FormOptionDto,
	type FormSectionDto,
	type FormVersionDto,
	type Rule,
	type ValidationIssue
} from './types';

// ─── Nodos locales ───────────────────────────────────────────────────────────

export interface BuilderOption {
	id: string;
	isNew: boolean;
	value: string;
	label: string;
	color: string | null;
	score: number | null;
	metadata: Record<string, unknown>;
}

export interface BuilderField {
	id: string;
	isNew: boolean;
	key: string;
	type: FieldType;
	label: string;
	helpText: string | null;
	placeholder: string | null;
	required: boolean;
	config: Record<string, unknown>;
	validation: Record<string, unknown>;
	visibilityRule: Rule | null;
	defaultValue: unknown;
	options: BuilderOption[];
	children: BuilderField[];
}

export interface BuilderSection {
	id: string;
	isNew: boolean;
	key: string;
	title: string;
	description: string | null;
	settings: Record<string, unknown>;
	fields: BuilderField[];
}

export type SelectionKind = 'section' | 'field' | null;

export interface Selection {
	kind: SelectionKind;
	id: string | null;
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

const HISTORY_LIMIT = 50;

/** Id local. El prefijo lo hace obvio en cualquier log o inspector. */
function localId(): string {
	return `local-${crypto.randomUUID()}`;
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

// ─── Conversión desde/hacia la API ───────────────────────────────────────────

function optionFromDto(dto: FormOptionDto): BuilderOption {
	return {
		id: dto.id,
		isNew: false,
		value: dto.value,
		label: dto.label,
		color: dto.color,
		score: dto.score,
		metadata: dto.metadata ?? {}
	};
}

function fieldFromDto(dto: FormFieldDto): BuilderField {
	return {
		id: dto.id,
		isNew: false,
		key: dto.key,
		type: dto.type,
		label: dto.label,
		helpText: dto.helpText,
		placeholder: dto.placeholder,
		required: dto.required,
		config: dto.config ?? {},
		validation: dto.validation ?? {},
		visibilityRule: dto.visibilityRule ?? null,
		defaultValue: dto.defaultValue ?? null,
		options: (dto.options ?? []).map(optionFromDto),
		children: (dto.children ?? []).map(fieldFromDto)
	};
}

function sectionFromDto(dto: FormSectionDto): BuilderSection {
	return {
		id: dto.id,
		isNew: false,
		key: dto.key,
		title: dto.title,
		description: dto.description,
		settings: dto.settings ?? {},
		fields: (dto.fields ?? []).map(fieldFromDto)
	};
}

/** Convierte el árbol local al DTO que consume `FormRenderer` (preview). */
export function toPreviewSections(sections: BuilderSection[]): FormSectionDto[] {
	const field = (f: BuilderField, index: number, parentId: string | null): FormFieldDto => ({
		id: f.id,
		key: f.key,
		parentFieldId: parentId,
		type: f.type,
		label: f.label,
		helpText: f.helpText,
		placeholder: f.placeholder,
		required: f.required,
		sortOrder: (index + 1) * 100,
		config: f.config,
		validation: f.validation as any,
		visibilityRule: f.visibilityRule,
		defaultValue: f.defaultValue,
		options: f.options.map((o, i) => ({
			id: o.id,
			value: o.value,
			label: o.label,
			color: o.color,
			score: o.score,
			sortOrder: (i + 1) * 100,
			metadata: o.metadata
		})),
		children: f.children.map((c, i) => field(c, i, f.id))
	});

	return sections.map((s, si) => ({
		id: s.id,
		key: s.key,
		title: s.title,
		description: s.description,
		sortOrder: (si + 1) * 100,
		settings: s.settings,
		fields: s.fields.map((f, i) => field(f, i, null))
	}));
}

// ─── Plantillas de card por tipo ─────────────────────────────────────────────

/**
 * Opciones por defecto de los tipos de selección.
 *
 * Un `SINGLE_CHOICE` sin opciones es un error de publicación, así que la card
 * nace ya usable con el patrón que HSEQ usa en casi todos sus formatos.
 */
const OPCIONES_POR_DEFECTO: Partial<Record<FieldType, { value: string; label: string; color?: string }[]>> = {
	SINGLE_CHOICE: [
		{ value: 'C', label: 'Cumple', color: 'emerald' },
		{ value: 'NC', label: 'No cumple', color: 'red' },
		{ value: 'NA', label: 'No aplica', color: 'gray' }
	],
	MULTIPLE_CHOICE: [
		{ value: 'opcion_1', label: 'Opción 1' },
		{ value: 'opcion_2', label: 'Opción 2' }
	]
};

function nuevoCampo(type: FieldType, etiqueta?: string): BuilderField {
	const label = etiqueta ?? 'Nuevo campo';
	const campo: BuilderField = {
		id: localId(),
		isNew: true,
		key: '',
		type,
		label,
		helpText: null,
		placeholder: null,
		required: false,
		config: {},
		validation: {},
		visibilityRule: null,
		defaultValue: null,
		options: (OPCIONES_POR_DEFECTO[type] ?? []).map((o) => ({
			id: localId(),
			isNew: true,
			value: o.value,
			label: o.label,
			color: o.color ?? null,
			score: null,
			metadata: {}
		})),
		children: []
	};

	/// Un contenedor sin hijos tampoco se puede publicar: nace con una columna.
	if (isContainer(type)) {
		campo.children = [nuevoCampo('SHORT_TEXT', 'Descripción')];
	}
	if (type === 'LOOKUP') campo.config = { source: 'VEHICLE' };
	if (type === 'CALCULATED') campo.config = { formula: '' };

	return campo;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export interface BuilderInit {
	formId: string;
	version: FormVersionDto;
}

export function createBuilderStore(init: BuilderInit) {
	let formId = $state(init.formId);
	let versionId = $state(init.version.id);
	let status = $state(init.version.status);
	let revision = $state(init.version.revision);

	let title = $state(init.version.title);
	let description = $state(init.version.description);
	let instructions = $state(init.version.instructions);
	let settings = $state<Record<string, unknown>>(init.version.settings ?? {});
	let sections = $state<BuilderSection[]>((init.version.sections ?? []).map(sectionFromDto));

	let selection = $state<Selection>({ kind: null, id: null });
	let saveState = $state<SaveState>('idle');
	let lastSavedAt = $state<string | null>(null);
	let issues = $state<ValidationIssue[]>([]);
	let conflictInfo = $state<{ expected: number; actual: number } | null>(null);

	/// El histórico guarda instantáneas del árbol MÁS la cabecera: renombrar la
	/// versión y deshacerlo tiene que funcionar igual que mover una card.
	interface Snapshot {
		title: string;
		description: string | null;
		instructions: string | null;
		sections: BuilderSection[];
	}
	let past = $state<Snapshot[]>([]);
	let future = $state<Snapshot[]>([]);

	const snapshot = (): Snapshot => ({
		title,
		description,
		instructions,
		sections: clone(sections)
	});

	const restore = (s: Snapshot) => {
		title = s.title;
		description = s.description;
		instructions = s.instructions;
		sections = s.sections;
	};

	/**
	 * Registra el estado ANTES de mutar y marca el borrador como sucio.
	 *
	 * Se llama al principio de cada mutación, no al final: el undo tiene que
	 * devolver al estado previo, y capturar después ya perdió ese estado.
	 */
	function mutate(fn: () => void) {
		past = [...past.slice(-(HISTORY_LIMIT - 1)), snapshot()];
		future = [];
		fn();
		if (saveState !== 'conflict') saveState = 'dirty';
	}

	// ── Búsqueda en el árbol ────────────────────────────────────────────────

	function walkFields(
		fields: BuilderField[],
		parent: BuilderField | null,
		section: BuilderSection,
		visit: (f: BuilderField, parent: BuilderField | null, section: BuilderSection, siblings: BuilderField[]) => void
	) {
		for (const field of fields) {
			visit(field, parent, section, fields);
			if (field.children.length) walkFields(field.children, field, section, visit);
		}
	}

	function allFields(): { field: BuilderField; parent: BuilderField | null; section: BuilderSection; siblings: BuilderField[] }[] {
		const out: { field: BuilderField; parent: BuilderField | null; section: BuilderSection; siblings: BuilderField[] }[] = [];
		for (const section of sections) {
			walkFields(section.fields, null, section, (field, parent, sec, siblings) =>
				out.push({ field, parent, section: sec, siblings })
			);
		}
		return out;
	}

	function findField(id: string) {
		return allFields().find((e) => e.field.id === id) ?? null;
	}

	function findSection(id: string) {
		return sections.find((s) => s.id === id) ?? null;
	}

	// ── Claves ──────────────────────────────────────────────────────────────

	/**
	 * Clave única derivada de la etiqueta.
	 *
	 * La unicidad es por VERSIÓN (así lo exige `uq_form_fields_key`), no por
	 * sección: buscar solo entre hermanos generaría duplicados que el publish
	 * rechazaría después, cuando ya hay cincuenta cards encima.
	 */
	function claveUnica(base: string, excluirId?: string): string {
		const usadas = new Set(
			allFields()
				.filter((e) => e.field.id !== excluirId)
				.map((e) => e.field.key)
				.filter(Boolean)
		);
		const raiz = toKey(base);
		if (!usadas.has(raiz)) return raiz;
		for (let i = 2; i < 1000; i += 1) {
			const intento = `${raiz}_${i}`;
			if (!usadas.has(intento)) return intento;
		}
		return `${raiz}_${Date.now()}`;
	}

	function claveSeccionUnica(base: string, excluirId?: string): string {
		const usadas = new Set(sections.filter((s) => s.id !== excluirId).map((s) => s.key));
		const raiz = toKey(base, 'seccion');
		if (!usadas.has(raiz)) return raiz;
		for (let i = 2; i < 1000; i += 1) {
			const intento = `${raiz}_${i}`;
			if (!usadas.has(intento)) return intento;
		}
		return `${raiz}_${Date.now()}`;
	}

	// ── Mutaciones: secciones ───────────────────────────────────────────────

	function addSection(titulo = 'Nueva sección') {
		if (sections.length >= DEFINITION_LIMITS.maxSections) return null;
		const seccion: BuilderSection = {
			id: localId(),
			isNew: true,
			key: claveSeccionUnica(titulo),
			title: titulo,
			description: null,
			settings: {},
			fields: []
		};
		mutate(() => {
			sections = [...sections, seccion];
		});
		selection = { kind: 'section', id: seccion.id };
		return seccion;
	}

	function updateSection(id: string, patch: Partial<BuilderSection>) {
		const seccion = findSection(id);
		if (!seccion) return;
		mutate(() => {
			Object.assign(seccion, patch);
			/// Renombrar el título NO renombra la clave si ya se fijó: la clave es
			/// lo que referencian informes y reglas, y cambiarla en silencio los
			/// rompería.
		});
	}

	function removeSection(id: string) {
		mutate(() => {
			sections = sections.filter((s) => s.id !== id);
		});
		if (selection.id === id) selection = { kind: null, id: null };
	}

	function duplicateSection(id: string) {
		const seccion = findSection(id);
		if (!seccion) return;
		const copia = clone(seccion);
		reidentificar(copia);
		copia.title = `${seccion.title} (copia)`;
		copia.key = claveSeccionUnica(copia.title);
		for (const campo of recorrer(copia.fields)) campo.key = claveUnica(campo.label);
		mutate(() => {
			const index = sections.findIndex((s) => s.id === id);
			sections = [...sections.slice(0, index + 1), copia, ...sections.slice(index + 1)];
		});
		selection = { kind: 'section', id: copia.id };
	}

	function moveSection(id: string, delta: -1 | 1) {
		const index = sections.findIndex((s) => s.id === id);
		if (index < 0) return;
		const destino = index + delta;
		if (destino < 0 || destino >= sections.length) return;
		mutate(() => {
			const copia = [...sections];
			[copia[index], copia[destino]] = [copia[destino], copia[index]];
			sections = copia;
		});
	}

	/** Reordena por el resultado de un drag (`finalize` de svelte-dnd-action). */
	function reorderSections(nuevoOrden: BuilderSection[]) {
		mutate(() => {
			sections = nuevoOrden;
		});
	}

	// ── Mutaciones: campos ──────────────────────────────────────────────────

	function* recorrer(fields: BuilderField[]): Generator<BuilderField> {
		for (const field of fields) {
			yield field;
			yield* recorrer(field.children);
		}
	}

	/** Reasigna ids locales tras un `clone`, para que la copia sea un nodo nuevo. */
	function reidentificar(nodo: BuilderSection | BuilderField) {
		nodo.id = localId();
		nodo.isNew = true;
		if ('fields' in nodo) {
			for (const campo of nodo.fields) reidentificar(campo);
			return;
		}
		for (const opcion of nodo.options) {
			opcion.id = localId();
			opcion.isNew = true;
		}
		for (const hijo of nodo.children) reidentificar(hijo);
	}

	function addField(type: FieldType, sectionId: string, parentFieldId: string | null = null) {
		const seccion = findSection(sectionId);
		if (!seccion) return null;

		const campo = nuevoCampo(type);
		campo.key = claveUnica(campo.label);
		for (const hijo of recorrer(campo.children)) hijo.key = claveUnica(hijo.label);

		if (parentFieldId) {
			const padre = findField(parentFieldId);
			if (!padre) return null;
			/// Un contenedor dentro de otro contenedor no se puede almacenar: el
			/// esquema solo tiene una columna de ocurrencia. Se bloquea aquí en vez
			/// de dejar que el publish lo rechace más tarde.
			if (isContainer(type)) return null;
			if (padre.field.children.length >= DEFINITION_LIMITS.maxChildrenPerContainer) return null;
			mutate(() => {
				padre.field.children = [...padre.field.children, campo];
			});
		} else {
			mutate(() => {
				seccion.fields = [...seccion.fields, campo];
			});
		}

		selection = { kind: 'field', id: campo.id };
		return campo;
	}

	/** Inserta una card desde una plantilla de la biblioteca (copia el snapshot). */
	function addFromTemplate(
		plantilla: { fieldType: FieldType; template: Record<string, any> },
		sectionId: string,
		parentFieldId: string | null = null
	) {
		const seccion = findSection(sectionId);
		if (!seccion) return null;

		const t = plantilla.template ?? {};
		const campo: BuilderField = {
			id: localId(),
			isNew: true,
			key: '',
			type: (t.type as FieldType) ?? plantilla.fieldType,
			label: t.label ?? 'Card',
			helpText: t.helpText ?? null,
			placeholder: t.placeholder ?? null,
			required: Boolean(t.required),
			config: clone(t.config ?? {}),
			validation: clone(t.validation ?? {}),
			visibilityRule: null,
			defaultValue: t.defaultValue ?? null,
			options: (t.options ?? []).map((o: any) => ({
				id: localId(),
				isNew: true,
				value: o.value,
				label: o.label,
				color: o.color ?? null,
				score: o.score ?? null,
				metadata: o.metadata ?? {}
			})),
			children: (t.children ?? []).map((c: any) => ({
				id: localId(),
				isNew: true,
				key: '',
				type: c.type,
				label: c.label,
				helpText: c.helpText ?? null,
				placeholder: c.placeholder ?? null,
				required: Boolean(c.required),
				config: clone(c.config ?? {}),
				validation: clone(c.validation ?? {}),
				visibilityRule: null,
				defaultValue: c.defaultValue ?? null,
				options: (c.options ?? []).map((o: any) => ({
					id: localId(),
					isNew: true,
					value: o.value,
					label: o.label,
					color: o.color ?? null,
					score: o.score ?? null,
					metadata: o.metadata ?? {}
				})),
				children: []
			}))
		};

		/// La regla de visibilidad NO se copia: referenciaría `fieldKey` que no
		/// existen en este formulario, y el publish lo rechazaría.
		campo.key = claveUnica(campo.label);
		for (const hijo of recorrer(campo.children)) hijo.key = claveUnica(hijo.label);

		if (parentFieldId) {
			const padre = findField(parentFieldId);
			if (!padre || isContainer(campo.type)) return null;
			mutate(() => {
				padre.field.children = [...padre.field.children, campo];
			});
		} else {
			mutate(() => {
				seccion.fields = [...seccion.fields, campo];
			});
		}
		selection = { kind: 'field', id: campo.id };
		return campo;
	}

	function updateField(id: string, patch: Partial<BuilderField>) {
		const entrada = findField(id);
		if (!entrada) return;
		mutate(() => {
			/// Cambiar de tipo tiene que limpiar lo que el tipo nuevo no admite: un
			/// SHORT_TEXT con opciones o un texto con hijos son errores de
			/// publicación, y dejarlos ahí "por si acaso" los esconde hasta el final.
			if (patch.type && patch.type !== entrada.field.type) {
				const cap = capabilitiesOf(patch.type);
				if (!cap.options) patch.options = [];
				else if (entrada.field.options.length === 0) {
					patch.options = (OPCIONES_POR_DEFECTO[patch.type] ?? []).map((o) => ({
						id: localId(),
						isNew: true,
						value: o.value,
						label: o.label,
						color: o.color ?? null,
						score: null,
						metadata: {}
					}));
				}
				if (!cap.children) patch.children = [];
				else if (entrada.field.children.length === 0) {
					const hijo = nuevoCampo('SHORT_TEXT', 'Descripción');
					hijo.key = claveUnica(hijo.label);
					patch.children = [hijo];
				}
				/// `validation` es específica del tipo: conservar `maxFiles` en un
				/// campo de texto dejaría una clave que ningún validador aplica.
				patch.validation = {};
			}
			Object.assign(entrada.field, patch);
		});
	}

	function renameFieldKey(id: string, nuevaClave: string) {
		const entrada = findField(id);
		if (!entrada) return;
		const anterior = entrada.field.key;
		const clave = claveUnica(nuevaClave, id);
		mutate(() => {
			entrada.field.key = clave;
			/// Renombrar arrastra las reglas que apuntaban a la clave anterior. Sin
			/// esto, cada renombrado dejaría reglas muertas que el publish rechaza
			/// con `RULE_FIELD_UNKNOWN` y que HSEQ tendría que arreglar a mano.
			for (const { field } of allFields()) {
				const rule = field.visibilityRule;
				if (!rule) continue;
				if (rule.effect?.targetFieldKey === anterior) rule.effect.targetFieldKey = clave;
				for (const condicion of [...(rule.all ?? []), ...(rule.any ?? [])]) {
					if (condicion.fieldKey === anterior) condicion.fieldKey = clave;
				}
			}
		});
	}

	function removeField(id: string) {
		const entrada = findField(id);
		if (!entrada) return;
		mutate(() => {
			const index = entrada.siblings.findIndex((f) => f.id === id);
			entrada.siblings.splice(index, 1);
			/// Las reglas que referenciaban el campo borrado se limpian: dejarlas
			/// convertiría el publish en una lista de errores sobre campos que ya no
			/// están y que nadie puede localizar.
			for (const { field } of allFields()) {
				const rule = field.visibilityRule;
				if (!rule) continue;
				const referencia =
					rule.effect?.targetFieldKey === entrada.field.key ||
					[...(rule.all ?? []), ...(rule.any ?? [])].some((c) => c.fieldKey === entrada.field.key);
				if (referencia) field.visibilityRule = null;
			}
		});
		if (selection.id === id) selection = { kind: null, id: null };
	}

	function duplicateField(id: string) {
		const entrada = findField(id);
		if (!entrada) return;
		const copia = clone(entrada.field);
		reidentificar(copia);
		copia.label = `${entrada.field.label} (copia)`;
		copia.key = claveUnica(copia.label);
		copia.visibilityRule = null;
		for (const hijo of recorrer(copia.children)) hijo.key = claveUnica(hijo.label);
		mutate(() => {
			const index = entrada.siblings.findIndex((f) => f.id === id);
			entrada.siblings.splice(index + 1, 0, copia);
		});
		selection = { kind: 'field', id: copia.id };
	}

	/**
	 * Mueve un campo entre hermanos.
	 *
	 * Existe además del drag porque el drag no es accesible con teclado ni con
	 * lector de pantalla, y el builder tiene que poder usarse sin ratón.
	 */
	function moveField(id: string, delta: -1 | 1) {
		const entrada = findField(id);
		if (!entrada) return;
		const index = entrada.siblings.findIndex((f) => f.id === id);
		const destino = index + delta;
		if (destino < 0 || destino >= entrada.siblings.length) return;
		mutate(() => {
			const copia = [...entrada.siblings];
			[copia[index], copia[destino]] = [copia[destino], copia[index]];
			entrada.siblings.splice(0, entrada.siblings.length, ...copia);
		});
	}

	/** Reordena los campos de una sección tras un drag. */
	function reorderSectionFields(sectionId: string, nuevoOrden: BuilderField[]) {
		const seccion = findSection(sectionId);
		if (!seccion) return;
		mutate(() => {
			seccion.fields = nuevoOrden;
		});
	}

	function reorderChildren(parentFieldId: string, nuevoOrden: BuilderField[]) {
		const padre = findField(parentFieldId);
		if (!padre) return;
		mutate(() => {
			padre.field.children = nuevoOrden;
		});
	}

	/** Mueve un campo a otra sección (drag entre columnas del canvas). */
	function moveFieldToSection(fieldId: string, sectionId: string, index: number) {
		const entrada = findField(fieldId);
		const seccion = findSection(sectionId);
		if (!entrada || !seccion) return;
		mutate(() => {
			const desde = entrada.siblings.findIndex((f) => f.id === fieldId);
			const [campo] = entrada.siblings.splice(desde, 1);
			seccion.fields.splice(Math.max(0, Math.min(index, seccion.fields.length)), 0, campo);
		});
	}

	// ── Opciones ────────────────────────────────────────────────────────────

	function addOption(fieldId: string, base?: { value: string; label: string }) {
		const entrada = findField(fieldId);
		if (!entrada) return;
		if (entrada.field.options.length >= DEFINITION_LIMITS.maxOptionsPerField) return;
		const usados = new Set(entrada.field.options.map((o) => o.value));
		let value = base?.value ?? `opcion_${entrada.field.options.length + 1}`;
		let i = 2;
		while (usados.has(value)) value = `${base?.value ?? 'opcion'}_${i++}`;
		mutate(() => {
			entrada.field.options = [
				...entrada.field.options,
				{
					id: localId(),
					isNew: true,
					value,
					label: base?.label ?? `Opción ${entrada.field.options.length + 1}`,
					color: null,
					score: null,
					metadata: {}
				}
			];
		});
	}

	function updateOption(fieldId: string, optionId: string, patch: Partial<BuilderOption>) {
		const entrada = findField(fieldId);
		const opcion = entrada?.field.options.find((o) => o.id === optionId);
		if (!entrada || !opcion) return;
		const valorAnterior = opcion.value;
		mutate(() => {
			Object.assign(opcion, patch);
			/// Igual que con las claves: renombrar un `value` arrastra las reglas
			/// que lo comparaban. Es el fallo más silencioso del módulo — la
			/// observación condicional deja de pedirse y nadie se entera.
			if (patch.value && patch.value !== valorAnterior) {
				for (const { field } of allFields()) {
					const rule = field.visibilityRule;
					if (!rule) continue;
					for (const condicion of [...(rule.all ?? []), ...(rule.any ?? [])]) {
						if (condicion.fieldKey !== entrada.field.key) continue;
						if (Array.isArray(condicion.value)) {
							condicion.value = condicion.value.map((v) => (v === valorAnterior ? patch.value : v));
						} else if (condicion.value === valorAnterior) {
							condicion.value = patch.value;
						}
					}
				}
			}
		});
	}

	function removeOption(fieldId: string, optionId: string) {
		const entrada = findField(fieldId);
		if (!entrada) return;
		mutate(() => {
			entrada.field.options = entrada.field.options.filter((o) => o.id !== optionId);
		});
	}

	function reorderOptions(fieldId: string, nuevoOrden: BuilderOption[]) {
		const entrada = findField(fieldId);
		if (!entrada) return;
		mutate(() => {
			entrada.field.options = nuevoOrden;
		});
	}

	// ── Reglas ──────────────────────────────────────────────────────────────

	function setRule(fieldId: string, rule: Rule | null) {
		const entrada = findField(fieldId);
		if (!entrada) return;
		mutate(() => {
			entrada.field.visibilityRule = rule;
		});
	}

	// ── Cabecera ────────────────────────────────────────────────────────────

	function setHeader(patch: { title?: string; description?: string | null; instructions?: string | null }) {
		mutate(() => {
			if (patch.title !== undefined) title = patch.title;
			if (patch.description !== undefined) description = patch.description;
			if (patch.instructions !== undefined) instructions = patch.instructions;
		});
	}

	// ── Undo / redo ─────────────────────────────────────────────────────────

	function undo() {
		const anterior = past.at(-1);
		if (!anterior) return;
		future = [snapshot(), ...future.slice(0, HISTORY_LIMIT - 1)];
		past = past.slice(0, -1);
		restore(anterior);
		if (saveState !== 'conflict') saveState = 'dirty';
	}

	function redo() {
		const siguiente = future[0];
		if (!siguiente) return;
		past = [...past.slice(-(HISTORY_LIMIT - 1)), snapshot()];
		future = future.slice(1);
		restore(siguiente);
		if (saveState !== 'conflict') saveState = 'dirty';
	}

	// ── Serialización ───────────────────────────────────────────────────────

	/**
	 * Payload de `PUT .../versions/:id`.
	 *
	 * Los ids locales se OMITEN: el servidor rechaza cualquier id que no
	 * pertenezca a la versión, así que enviarlos haría fallar el primer guardado
	 * de cada card nueva.
	 */
	function serialize() {
		const opcion = (o: BuilderOption, index: number) => ({
			...(o.isNew ? {} : { id: o.id }),
			value: o.value,
			label: o.label,
			color: o.color,
			score: o.score,
			sortOrder: (index + 1) * 100,
			metadata: o.metadata
		});

		const campo = (f: BuilderField, index: number): Record<string, unknown> => ({
			...(f.isNew ? {} : { id: f.id }),
			key: f.key,
			type: f.type,
			label: f.label,
			helpText: f.helpText,
			placeholder: f.placeholder,
			required: f.required,
			sortOrder: (index + 1) * 100,
			config: f.config,
			validation: f.validation,
			visibilityRule: f.visibilityRule,
			defaultValue: f.defaultValue,
			...(f.options.length ? { options: f.options.map(opcion) } : {}),
			...(f.children.length ? { children: f.children.map((c, i) => campo(c, i)) } : {})
		});

		return {
			title,
			description,
			instructions,
			settings,
			sections: sections.map((s, si) => ({
				...(s.isNew ? {} : { id: s.id }),
				key: s.key,
				title: s.title,
				description: s.description,
				sortOrder: (si + 1) * 100,
				settings: s.settings,
				fields: s.fields.map((f, i) => campo(f, i))
			})),
			revision
		};
	}

	/**
	 * Sustituye el árbol por lo que devolvió el servidor.
	 *
	 * Es lo que convierte los nodos locales en nodos con id real. Sin este paso,
	 * el segundo autosave volvería a enviarlos sin `id` y crearía duplicados.
	 */
	function applySaved(version: FormVersionDto) {
		versionId = version.id;
		status = version.status;
		revision = version.revision;
		title = version.title;
		description = version.description;
		instructions = version.instructions;
		settings = version.settings ?? {};
		sections = (version.sections ?? []).map(sectionFromDto);
		lastSavedAt = new Date().toISOString();
		saveState = 'saved';
		conflictInfo = null;
		/// El histórico se conserva: deshacer después de guardar es una acción
		/// legítima y el siguiente guardado la persistirá.
	}

	function markConflict(info: { expected: number; actual: number } | null) {
		saveState = 'conflict';
		conflictInfo = info;
	}

	// ── Issues de validación (vienen del backend) ───────────────────────────

	/**
	 * Indexa los issues por id de nodo.
	 *
	 * El backend los devuelve con una ruta posicional (`sections[0].fields[2]`)
	 * porque no conoce los ids locales. Aquí se resuelve esa ruta contra el árbol
	 * actual para poder marcar la card exacta.
	 */
	function issuesByNode(): Map<string, ValidationIssue[]> {
		const mapa = new Map<string, ValidationIssue[]>();
		const push = (id: string, issue: ValidationIssue) => {
			const lista = mapa.get(id) ?? [];
			lista.push(issue);
			mapa.set(id, lista);
		};

		for (const issue of issues) {
			const nodo = resolvePath(issue.path);
			if (nodo) push(nodo, issue);
		}
		return mapa;
	}

	function resolvePath(path: string): string | null {
		const secMatch = /^sections\[(\d+)\]/.exec(path);
		if (!secMatch) return null;
		const seccion = sections[Number(secMatch[1])];
		if (!seccion) return null;

		const resto = path.slice(secMatch[0].length);
		if (!resto.startsWith('.fields[')) return seccion.id;

		/// Se recorre la cadena `.fields[i]` / `.children[j]` para bajar por el
		/// árbol. La ruta puede terminar en `.options[k]` o en `.key`, y en los dos
		/// casos el issue pertenece visualmente a la card.
		let actual: BuilderField | null = null;
		let coleccion: BuilderField[] = seccion.fields;
		const segmentos = resto.matchAll(/\.(fields|children)\[(\d+)\]/g);
		for (const [, , indice] of segmentos) {
			actual = coleccion[Number(indice)] ?? null;
			if (!actual) return seccion.id;
			coleccion = actual.children;
		}
		return actual?.id ?? seccion.id;
	}

	// ── Estadísticas para la cabecera ───────────────────────────────────────

	const stats = $derived({
		sections: sections.length,
		fields: allFields().length,
		answerable: allFields().filter((e) => capabilitiesOf(e.field.type).slot !== 'none').length,
		required: allFields().filter((e) => e.field.required).length,
		rules: allFields().filter((e) => e.field.visibilityRule).length
	});

	return {
		// lectura reactiva
		get formId() {
			return formId;
		},
		get versionId() {
			return versionId;
		},
		get status() {
			return status;
		},
		get revision() {
			return revision;
		},
		get title() {
			return title;
		},
		get description() {
			return description;
		},
		get instructions() {
			return instructions;
		},
		get sections() {
			return sections;
		},
		get selection() {
			return selection;
		},
		set selection(value: Selection) {
			selection = value;
		},
		get saveState() {
			return saveState;
		},
		set saveState(value: SaveState) {
			saveState = value;
		},
		get lastSavedAt() {
			return lastSavedAt;
		},
		get issues() {
			return issues;
		},
		set issues(value: ValidationIssue[]) {
			issues = value;
		},
		get conflictInfo() {
			return conflictInfo;
		},
		get canUndo() {
			return past.length > 0;
		},
		get canRedo() {
			return future.length > 0;
		},
		get stats() {
			return stats;
		},
		/** `true` si el borrador es editable. Una publicada se abre en lectura. */
		get editable() {
			return status === 'DRAFT';
		},

		// consultas
		findField,
		findSection,
		allFields,
		issuesByNode,

		// mutaciones
		addSection,
		updateSection,
		removeSection,
		duplicateSection,
		moveSection,
		reorderSections,
		addField,
		addFromTemplate,
		updateField,
		renameFieldKey,
		removeField,
		duplicateField,
		moveField,
		reorderSectionFields,
		reorderChildren,
		moveFieldToSection,
		addOption,
		updateOption,
		removeOption,
		reorderOptions,
		setRule,
		setHeader,
		undo,
		redo,

		// persistencia
		serialize,
		applySaved,
		markConflict
	};
}

export type BuilderStore = ReturnType<typeof createBuilderStore>;
