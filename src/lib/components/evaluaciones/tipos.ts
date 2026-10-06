/**
 * Vocabulario compartido de las pantallas de evaluaciones.
 *
 * Las cuatro páginas (lista, detalle, crear, editar) y el PDF hablan de los
 * mismos seis tipos de pregunta y del mismo semáforo de puntaje. Antes cada
 * una tenía su propio `getTipoLabel` con etiquetas ligeramente distintas
 * («V/F» en la lista, «Verdadero o Falso» en el detalle). Aquí vive una
 * sola versión, con la larga y la corta.
 */
export type TipoPregunta =
	| 'OPCION_UNICA'
	| 'OPCION_MULTIPLE'
	| 'NUMERICA'
	| 'TEXTO'
	| 'RELACION'
	| 'VERDADERO_FALSO'
	| 'SOPA_LETRAS';

export interface DefinicionTipo {
	valor: TipoPregunta;
	etiqueta: string;
	corta: string;
	/** Una línea para el selector del formulario. */
	ayuda: string;
}

export const TIPOS_PREGUNTA: DefinicionTipo[] = [
	{
		valor: 'OPCION_UNICA',
		etiqueta: 'Opción única',
		corta: 'Única',
		ayuda: 'Varias opciones, una sola correcta.'
	},
	{
		valor: 'OPCION_MULTIPLE',
		etiqueta: 'Opción múltiple',
		corta: 'Múltiple',
		ayuda: 'Varias opciones, puede haber más de una correcta.'
	},
	{
		valor: 'VERDADERO_FALSO',
		etiqueta: 'Verdadero o falso',
		corta: 'V / F',
		ayuda: 'Una afirmación que se marca como verdadera o falsa.'
	},
	{
		valor: 'NUMERICA',
		etiqueta: 'Numérica',
		corta: 'Numérica',
		ayuda: 'El evaluado escribe un número exacto.'
	},
	{
		valor: 'TEXTO',
		etiqueta: 'Texto',
		corta: 'Texto',
		ayuda: 'Respuesta abierta; la califica la IA.'
	},
	{
		valor: 'RELACION',
		etiqueta: 'Relación',
		corta: 'Relación',
		ayuda: 'Pares que el evaluado tiene que emparejar.'
	},
	{
		valor: 'SOPA_LETRAS',
		etiqueta: 'Sopa de letras',
		corta: 'Sopa',
		ayuda: 'Palabras escondidas en una cuadrícula; puntúa por palabras halladas.'
	}
];

// ── Sopa de letras ──────────────────────────────────────────────

/** Lo que define quien diseña la pregunta. */
export interface EntradaSopa {
	palabras: string[];
	tamano: number;
	diagonales: boolean;
}

export interface UbicacionPalabra {
	texto: string;
	fila: number;
	columna: number;
	dFila: number;
	dColumna: number;
}

/** La configuración tal como la guarda el backend (ruta de administración). */
export interface ConfigSopa {
	tamano: number;
	diagonales: boolean;
	cuadricula: string[];
	palabras: UbicacionPalabra[];
}

/** La configuración que ve el evaluado: sin ubicaciones. */
export interface ConfigSopaPublica {
	tamano: number;
	diagonales: boolean;
	cuadricula: string[];
	palabras: string[];
}

/** Una línea marcada entre dos celdas `[fila, columna]`. */
export interface TrazoSopa {
	palabra?: string;
	desde: [number, number];
	hasta: [number, number];
}

/** Misma normalización que el backend: mayúsculas, sin tildes, solo letras y Ñ. */
export function normalizarPalabraSopa(texto: string): string {
	return texto
		.toUpperCase()
		.replace(/Ñ/g, '\u0000')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\u0000/g, 'Ñ')
		.replace(/[^A-ZÑ]/g, '');
}

/** Los textos de las palabras, venga la configuración de admin o pública. */
export function palabrasDeSopa(config: ConfigSopa | ConfigSopaPublica): string[] {
	return config.palabras.map((p) => (typeof p === 'string' ? p : p.texto));
}

/** Trazos de la clave: dónde está cada palabra (solo con la configuración de admin). */
export function trazosDeSopa(config: ConfigSopa | ConfigSopaPublica): TrazoSopa[] {
	/// En el editor las palabras ya vienen como texto (sin ubicación): no hay
	/// clave que dibujar hasta que el backend vuelva a guardar la sopa.
	return config.palabras.flatMap((u) => {
		if (typeof u === 'string') return [];
		const largo = u.texto.length - 1;
		return [
			{
				palabra: u.texto,
				desde: [u.fila, u.columna] as [number, number],
				hasta: [u.fila + u.dFila * largo, u.columna + u.dColumna * largo] as [number, number]
			}
		];
	});
}

/** Celdas que cubre un trazo recto. Vacío si no es recto. */
export function celdasDeTrazo(t: TrazoSopa): [number, number][] {
	const dF = Math.sign(t.hasta[0] - t.desde[0]);
	const dC = Math.sign(t.hasta[1] - t.desde[1]);
	const df = Math.abs(t.hasta[0] - t.desde[0]);
	const dc = Math.abs(t.hasta[1] - t.desde[1]);
	if (dF !== 0 && dC !== 0 && df !== dc) return [];
	const largo = Math.max(df, dc) + 1;
	return Array.from({ length: largo }, (_, k) => [t.desde[0] + dF * k, t.desde[1] + dC * k]);
}

const POR_VALOR = new Map(TIPOS_PREGUNTA.map((t) => [t.valor, t]));

export function etiquetaTipo(tipo: string): string {
	return POR_VALOR.get(tipo as TipoPregunta)?.etiqueta ?? tipo;
}

export function etiquetaTipoCorta(tipo: string): string {
	return POR_VALOR.get(tipo as TipoPregunta)?.corta ?? tipo;
}

/** Semáforo del puntaje: 70 % aprueba, 50 % queda a medias. */
export type TonoPuntaje = 'alto' | 'medio' | 'bajo';

export function porcentaje(obtenido: number, maximo: number): number {
	if (!maximo) return 0;
	return Math.round((obtenido / maximo) * 100);
}

export function tonoPuntaje(obtenido: number, maximo: number): TonoPuntaje {
	const p = maximo ? obtenido / maximo : 0;
	if (p >= 0.7) return 'alto';
	if (p >= 0.5) return 'medio';
	return 'bajo';
}

/** Acierto de una pregunta concreta: todo, parte o nada del puntaje. */
export type Acierto = 'correcta' | 'parcial' | 'incorrecta';

export function acierto(obtenido: number, maximo: number): Acierto {
	if (maximo > 0 && obtenido >= maximo) return 'correcta';
	if (obtenido > 0) return 'parcial';
	return 'incorrecta';
}

export function iniciales(nombre: string): string {
	return nombre
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((p) => p[0]?.toUpperCase() ?? '')
		.join('');
}

export function pluralPreguntas(n: number): string {
	return `${n} pregunta${n === 1 ? '' : 's'}`;
}

export function pluralPuntos(n: number): string {
	return `${n} punto${n === 1 ? '' : 's'}`;
}
