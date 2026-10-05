/**
 * Etapas de un formulario, del lado del portal.
 *
 * Una etapa es un tramo de secciones que el conductor diligencia y cierra por
 * separado dentro de UN SOLO envío que avanza. No son tres envíos: el borrador
 * sigue abierto tras cerrar una etapa y el `POST /submissions` sale una única
 * vez, al final. Es el mismo modelo que `src/lib/form-stages.ts` en la app
 * móvil, y debe seguir dando los mismos grupos para las mismas secciones: si
 * el portal agrupara distinto, HSEQ aprobaría en la vista previa algo que el
 * teléfono muestra de otra manera.
 *
 * ── De dónde sale ──────────────────────────────────────────────────────────
 *
 * De `section.settings`, que el backend expone tal cual desde
 * `form_sections.settings_json`:
 *
 *   { "etapa": 1, "etapaTitulo": "Prealistamiento", "etapaFirma": true }
 *
 * Sin columna ni endpoint nuevos. Un formulario que no declara etapas se
 * comporta como siempre: `resolverEtapas` devuelve `null`.
 *
 * ── Qué cierra el conductor ────────────────────────────────────────────────
 *
 * El teléfono respalda el avance en `device.stagesClosed` del borrador
 * (`form_submissions.device_json`). Un envío entregado tiene todas las etapas
 * cerradas por definición, aunque el envío final no repita la lista.
 */
import type { FormSectionDto } from './types';

type SeccionConSettings = Pick<FormSectionDto, 'settings'>;

export interface Etapa<S extends SeccionConSettings = FormSectionDto> {
	/** Número declarado en `settings.etapa`. Ordena las etapas. */
	numero: number;
	titulo: string;
	/** La etapa se cierra con la firma del conductor. Solo cambia textos. */
	firma: boolean;
	sections: S[];
}

/** Claves de `settings` que gobiernan la etapa. Útil para el editor y las pruebas. */
export const CLAVES_ETAPA = ['etapa', 'etapaTitulo', 'etapaFirma'] as const;

export function numeroDeEtapa(section: SeccionConSettings): number | null {
	const raw = section.settings?.etapa;
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
	/// El JSON puede traer el número como texto si alguien editó la sección a
	/// mano. Se acepta en vez de tratarlo como «sin etapa», que devolvería el
	/// formulario a una sola etapa sin avisar.
	if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
		return Number(raw);
	}
	return null;
}

export function tituloDeEtapa(section: SeccionConSettings): string | null {
	const raw = section.settings?.etapaTitulo;
	return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function firmaDeEtapa(section: SeccionConSettings): boolean {
	return section.settings?.etapaFirma === true;
}

/**
 * Agrupa las secciones por etapa, en el orden de los números.
 *
 * `null` cuando el formulario NO está por etapas: ninguna sección la declara o
 * todas declaran la misma. Las secciones sin `etapa` en un formulario que sí
 * las usa caen en la primera: mejor que sobren en el prealistamiento a que
 * desaparezcan.
 */
export function resolverEtapas<S extends SeccionConSettings>(sections: S[]): Etapa<S>[] | null {
	if (!sections.length) return null;
	const declaradas = sections.map(numeroDeEtapa).filter((n): n is number => n !== null);
	if (!declaradas.length) return null;

	const primera = Math.min(...declaradas);
	const porNumero = new Map<number, Etapa<S>>();

	for (const section of sections) {
		const numero = numeroDeEtapa(section) ?? primera;
		const existente = porNumero.get(numero);
		if (existente) {
			existente.sections.push(section);
			existente.firma = existente.firma || firmaDeEtapa(section);
			continue;
		}
		porNumero.set(numero, {
			numero,
			titulo: tituloDeEtapa(section) ?? `Etapa ${numero}`,
			firma: firmaDeEtapa(section),
			sections: [section]
		});
	}

	if (porNumero.size < 2) return null;
	return [...porNumero.values()].sort((a, b) => a.numero - b.numero);
}

/** «Etapa 2 de 3 · Durante el desplazamiento». */
export function etiquetaEtapa(etapa: Etapa<SeccionConSettings>, total: number): string {
	const base = `Etapa ${etapa.numero} de ${total}`;
	return etapa.titulo && etapa.titulo !== `Etapa ${etapa.numero}`
		? `${base} · ${etapa.titulo}`
		: base;
}

/**
 * Etapas cerradas según lo que respaldó el teléfono.
 *
 * Normaliza lo que venga: números como texto, repetidos, basura. Un envío
 * `SUBMITTED` las tiene todas aunque la lista no venga, así que el llamador
 * debe tratar ese caso aparte (ver `progresoEtapas`).
 */
export function etapasCerradasDe(device: unknown): number[] {
	const crudas = (device as { stagesClosed?: unknown } | null | undefined)?.stagesClosed;
	if (!Array.isArray(crudas)) return [];
	const numeros = crudas.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
	return [...new Set(numeros)].sort((a, b) => a - b);
}

export interface ProgresoEtapas {
	total: number;
	cerradas: number[];
	/** Primera etapa aún abierta; `null` si están todas cerradas. */
	enCurso: Etapa<SeccionConSettings> | null;
	completo: boolean;
}

/**
 * Dónde va un envío dentro de sus etapas.
 *
 * `null` si el formulario no está por etapas: no hay progreso que mostrar.
 */
export function progresoEtapas(
	etapas: Etapa<SeccionConSettings>[] | null,
	status: string,
	device: unknown
): ProgresoEtapas | null {
	if (!etapas) return null;
	const numeros = etapas.map((e) => e.numero);
	const cerradas =
		status === 'SUBMITTED' ? numeros : etapasCerradasDe(device).filter((n) => numeros.includes(n));
	const enCurso = etapas.find((e) => !cerradas.includes(e.numero)) ?? null;
	return { total: etapas.length, cerradas, enCurso, completo: enCurso === null };
}

export interface ProblemaEtapas {
	nivel: 'error' | 'aviso';
	mensaje: string;
}

/**
 * Lo que el constructor debe avisar antes de publicar.
 *
 * No bloquea nada: el motor acepta cualquier numeración. Pero una etapa
 * salteada o una sección huérfana casi siempre son un descuido y, en el
 * teléfono, dan pasos vacíos o secciones que caen en la etapa equivocada.
 */
export function problemasEtapas(sections: SeccionConSettings[]): ProblemaEtapas[] {
	const problemas: ProblemaEtapas[] = [];
	const numeros = sections.map(numeroDeEtapa);
	const declaradas = numeros.filter((n): n is number => n !== null);
	if (!declaradas.length) return problemas;

	const sinEtapa = numeros.filter((n) => n === null).length;
	if (sinEtapa > 0) {
		problemas.push({
			nivel: 'aviso',
			mensaje: `${sinEtapa} ${sinEtapa === 1 ? 'sección no declara' : 'secciones no declaran'} etapa: en el teléfono ${sinEtapa === 1 ? 'caerá' : 'caerán'} en la primera.`
		});
	}

	const distintas = [...new Set(declaradas)].sort((a, b) => a - b);
	if (distintas.length === 1) {
		problemas.push({
			nivel: 'aviso',
			mensaje: `Todas las secciones están en la etapa ${distintas[0]}: el formulario se comportará como de una sola etapa.`
		});
	}
	if (distintas.some((n) => !Number.isInteger(n) || n < 1)) {
		problemas.push({ nivel: 'error', mensaje: 'Los números de etapa deben ser enteros desde 1.' });
	}
	const faltan = distintas.length
		? Array.from({ length: distintas[distintas.length - 1] }, (_, i) => i + 1).filter(
				(n) => !distintas.includes(n)
			)
		: [];
	if (faltan.length) {
		problemas.push({
			nivel: 'aviso',
			mensaje: `La numeración salta: falta la etapa ${faltan.join(', ')}.`
		});
	}

	/// Si el título difiere entre secciones de la misma etapa, el teléfono toma
	/// el de la primera y el resto se pierde en silencio.
	const titulosPorEtapa = new Map<number, Set<string>>();
	for (const s of sections) {
		const n = numeroDeEtapa(s);
		const t = tituloDeEtapa(s);
		if (n === null || t === null) continue;
		if (!titulosPorEtapa.has(n)) titulosPorEtapa.set(n, new Set());
		titulosPorEtapa.get(n)!.add(t);
	}
	for (const [n, titulos] of titulosPorEtapa) {
		if (titulos.size > 1) {
			problemas.push({
				nivel: 'aviso',
				mensaje: `La etapa ${n} tiene títulos distintos (${[...titulos].join(' / ')}); se usará el de la primera sección.`
			});
		}
	}
	return problemas;
}
