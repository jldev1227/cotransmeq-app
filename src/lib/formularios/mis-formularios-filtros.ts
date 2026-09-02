/**
 * Búsqueda, filtro y orden de las tarjetas de «Mis formularios».
 *
 * Todo en cliente: el listado llega entero en una sola petición (ver
 * `mis-formularios-cache.ts`), así que filtrar es recorrer un array que ya está
 * en memoria. Lo que sí importa es no rehacer trabajo por pulsación, y de eso
 * se encarga `MotorBusqueda`:
 *
 *  1. **Índice normalizado, una vez por lista.** Quitar tildes y pasar a
 *     minúsculas cinco campos por tarjeta es lo caro. Se hace al construir el
 *     motor, no en cada tecla.
 *  2. **Memo de resultados.** Teclear «preop» y borrar hasta «pre» vuelve a
 *     pedir un resultado ya calculado; el memo lo devuelve tal cual. Muere con
 *     la lista que describe, así que no puede quedarse obsoleto: al recargar
 *     los datos se construye un motor nuevo y el viejo se recoge entero.
 */

import type { PortalAssignmentCard } from '$lib/api/formularios-portal';
import { FREQUENCY_LABELS, type AssignmentFrequency } from './types';

export const ESTADOS_FILTRO = ['todos', 'pendientes', 'borradores', 'hechos'] as const;
export type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

export const ESTADO_LABELS: Record<EstadoFiltro, string> = {
	todos: 'Todos',
	pendientes: 'Por diligenciar',
	borradores: 'Con borrador',
	hechos: 'Completados'
};

export const ORDENES = ['urgencia', 'reciente', 'titulo', 'codigo'] as const;
export type Orden = (typeof ORDENES)[number];

export const ORDEN_LABELS: Record<Orden, string> = {
	urgencia: 'Lo pendiente primero',
	reciente: 'Borrador más reciente',
	titulo: 'Nombre (A-Z)',
	codigo: 'Código'
};

export interface Criterios {
	q: string;
	estado: EstadoFiltro;
	frecuencia: string;
	orden: Orden;
}

export const CRITERIOS_POR_DEFECTO: Criterios = {
	q: '',
	estado: 'todos',
	frecuencia: '',
	orden: 'urgencia'
};

export function etiquetaFrecuencia(f: string): string {
	return FREQUENCY_LABELS[f as AssignmentFrequency] ?? f;
}

/// Un solo `Collator` para todo el módulo: instanciarlo dentro del comparador
/// lo crearía una vez por comparación, que es el orden de magnitud del propio
/// ordenamiento.
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/// Marcas diacríticas sueltas que deja el NFD, escapadas en \u: el rango son
/// caracteres combinantes: en crudo el fuente enseña un corchete y nada más.
const DIACRITICOS = /[\u0300-\u036f]/g;

export function normalizar(texto: string): string {
	return texto.toLowerCase().normalize('NFD').replace(DIACRITICOS, '').trim();
}

/** Todo lo buscable de una tarjeta, aplanado y normalizado. */
function heno(a: PortalAssignmentCard): string {
	const partes = [a.code, a.title, a.name, etiquetaFrecuencia(a.frequency)];
	/// El contexto del borrador (la placa, casi siempre) es justo por lo que se
	/// busca cuando hay varios abiertos a la vez: «¿dónde dejé el de la WGY-123?».
	for (const d of a.drafts) {
		for (const valor of Object.values(d.context ?? {})) {
			if (typeof valor === 'string' || typeof valor === 'number') partes.push(String(valor));
		}
	}
	return normalizar(partes.join(' '));
}

function tieneBorrador(a: PortalAssignmentCard): boolean {
	return a.drafts.length > 0;
}

/** Epoch ms del borrador más reciente; 0 si no hay ninguno. */
function ultimoBorrador(a: PortalAssignmentCard): number {
	let max = 0;
	for (const d of a.drafts) {
		const t = new Date(d.updatedAt).getTime();
		if (t > max) max = t;
	}
	return max;
}

function coincideEstado(a: PortalAssignmentCard, estado: EstadoFiltro): boolean {
	switch (estado) {
		case 'pendientes':
			return a.dueState === 'AVAILABLE';
		case 'borradores':
			return tieneBorrador(a);
		case 'hechos':
			return a.dueState !== 'AVAILABLE';
		default:
			return true;
	}
}

function comparador(orden: Orden): (x: PortalAssignmentCard, y: PortalAssignmentCard) => number {
	switch (orden) {
		case 'titulo':
			return (x, y) => collator.compare(x.title, y.title);
		case 'codigo':
			return (x, y) => collator.compare(x.code, y.code);
		case 'reciente':
			return (x, y) => ultimoBorrador(y) - ultimoBorrador(x) || collator.compare(x.title, y.title);
		default:
			/// «Urgencia» es el orden por defecto porque responde a la pregunta con
			/// la que se entra: qué me falta. Accionable primero, y dentro de eso lo
			/// empezado antes que lo que ni se ha abierto — terminar algo a medias
			/// cuesta menos que arrancar de cero.
			return (x, y) => {
				const dx = x.dueState === 'AVAILABLE' ? 0 : 1;
				const dy = y.dueState === 'AVAILABLE' ? 0 : 1;
				if (dx !== dy) return dx - dy;
				const bx = tieneBorrador(x) ? 0 : 1;
				const by = tieneBorrador(y) ? 0 : 1;
				if (bx !== by) return bx - by;
				return ultimoBorrador(y) - ultimoBorrador(x) || collator.compare(x.title, y.title);
			};
	}
}

/// Tope del memo. Una sesión de búsqueda son decenas de claves, no miles; el
/// tope existe para que tecleando sin parar no crezca sin fin.
const TOPE_MEMO = 40;

export class MotorBusqueda {
	readonly lista: readonly PortalAssignmentCard[];
	/** Frecuencias presentes en los datos, para poblar el selector. */
	readonly frecuencias: string[];

	#indice: string[];
	#memo = new Map<string, PortalAssignmentCard[]>();

	constructor(lista: readonly PortalAssignmentCard[]) {
		this.lista = lista;
		this.#indice = lista.map(heno);
		this.frecuencias = [...new Set(lista.map((a) => a.frequency))].sort((x, y) =>
			collator.compare(etiquetaFrecuencia(x), etiquetaFrecuencia(y))
		);
	}

	filtrar(criterios: Criterios): PortalAssignmentCard[] {
		const q = normalizar(criterios.q);
		const clave = `${criterios.estado} ${criterios.frecuencia} ${criterios.orden} ${q}`;
		const memorizado = this.#memo.get(clave);
		if (memorizado) return memorizado;

		/// Un solo recorrido con índice: el «heno» de la tarjeta `i` está en
		/// `#indice[i]`, así que el filtro por texto no vuelve a normalizar nada.
		const salida: PortalAssignmentCard[] = [];
		for (let i = 0; i < this.lista.length; i++) {
			const a = this.lista[i];
			if (!coincideEstado(a, criterios.estado)) continue;
			if (criterios.frecuencia && a.frequency !== criterios.frecuencia) continue;
			if (q && !this.#indice[i].includes(q)) continue;
			salida.push(a);
		}
		salida.sort(comparador(criterios.orden));

		if (this.#memo.size >= TOPE_MEMO) {
			/// FIFO: la primera clave del `Map` es la más antigua insertada.
			const masVieja = this.#memo.keys().next().value;
			if (masVieja !== undefined) this.#memo.delete(masVieja);
		}
		this.#memo.set(clave, salida);
		return salida;
	}
}
