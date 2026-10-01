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
	'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION' | 'VERDADERO_FALSO';

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
	}
];

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
