/**
 * Mascota de Cotransmeq en las pantallas de acceso, carga y error.
 *
 * Las imágenes son las mismas de la app móvil (`assets/mascot` en
 * app-mobile-cotransmeq), pasadas a webp en `static/mascot`. Las pantallas
 * no eligen un archivo sino una INTENCIÓN («bienvenida», «procesando»…), igual
 * que en la app: así las dos plataformas reaccionan con la misma cara ante el
 * mismo estado, y cambiar la imagen de un estado es tocar una sola línea.
 */
export const MASCOT_REACTIONS = [
	'saludando',
	'pensando',
	'trabajando',
	'todo-bien',
	'correo-enviado',
	'alerta',
	'sin-resultados',
	'esperando',
	'celebrando'
] as const;

export type MascotReaction = (typeof MASCOT_REACTIONS)[number];

export const mascotAlt: Record<MascotReaction, string> = {
	saludando: 'Mascota de Cotransmeq dando la bienvenida',
	pensando: 'Mascota de Cotransmeq pensando',
	trabajando: 'Mascota de Cotransmeq trabajando con una planilla',
	'todo-bien': 'Mascota de Cotransmeq indicando que todo está bien',
	'correo-enviado': 'Mascota de Cotransmeq mostrando un correo enviado',
	alerta: 'Mascota de Cotransmeq mostrando una alerta',
	'sin-resultados': 'Mascota de Cotransmeq sin encontrar resultados',
	esperando: 'Mascota de Cotransmeq esperando con calma',
	celebrando: 'Mascota de Cotransmeq celebrando'
};

/** Estados funcionales de la interfaz: las pantallas piden uno de estos. */
export const MASCOT_INTENT = {
	bienvenida: 'saludando',
	ayuda: 'pensando',
	procesando: 'trabajando',
	exito: 'todo-bien',
	correoEnviado: 'correo-enviado',
	advertencia: 'alerta',
	vacio: 'sin-resultados',
	espera: 'esperando',
	celebracion: 'celebrando'
} as const satisfies Record<string, MascotReaction>;

export type MascotIntent = keyof typeof MASCOT_INTENT;

export interface Mascota {
	src: string;
	alt: string;
}

export function mascota(intent: MascotIntent): Mascota {
	const reaction = MASCOT_INTENT[intent];
	return { src: `/mascot/${reaction}.webp`, alt: mascotAlt[reaction] };
}
