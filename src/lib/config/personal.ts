export const OPCIONES_VINCULACION = [
	{ value: 'por_definir', label: 'Por definir' },
	{ value: 'vinculacion_directa', label: 'Vinculación directa' },
	{ value: 'contratista', label: 'Contratista' },
	{ value: 'prestador_servicios', label: 'Prestador de servicios' },
	{ value: 'temporal', label: 'Temporal' },
	{ value: 'aprendiz', label: 'Aprendiz' },
	{ value: 'practicante', label: 'Practicante' },
	{ value: 'otro', label: 'Otro' }
] as const;

export type TipoVinculacion = (typeof OPCIONES_VINCULACION)[number]['value'];

export function etiquetaVinculacion(valor?: string | null): string {
	return OPCIONES_VINCULACION.find((opcion) => opcion.value === valor)?.label ?? 'Por definir';
}
