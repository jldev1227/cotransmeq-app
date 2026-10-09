import { MENU_ITEMS } from '$lib/config/menu';
import { AREA_LABELS, type Area } from '$lib/config/permissions';

/**
 * Etiquetas de módulo para el registro de actividad. Salen del menú; lo que
 * no está en el menú (perfil, sesiones, recorridos…) se completa aquí.
 */
const EXTRA: Record<string, string> = {
	perfil: 'Perfil',
	sesiones: 'Sesiones',
	recorridos: 'Recorridos',
	'mis-formularios': 'Mis formularios',
	contabilidad: 'Contabilidad',
	directorio: 'Equipo',
	otros: 'Otros'
};

export function etiquetaModulo(id: string): string {
	return MENU_ITEMS.find((m) => m.id === id)?.label ?? EXTRA[id] ?? id;
}

export function etiquetaArea(id: string): string {
	return AREA_LABELS[id as Area] ?? id;
}

export const ETIQUETA_ACCION: Record<string, string> = {
	crear: 'Creación',
	editar: 'Edición',
	eliminar: 'Eliminación',
	restaurar: 'Restauración',
	estado: 'Cambio de estado',
	otro: 'Otra'
};
