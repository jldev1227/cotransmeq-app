/**
 * Vocabulario visual de los estados PESV.
 *
 * **Los colores son hex literales y no clases de Tailwind, a propósito.**
 * Cotransmeq reasigna la escala `emerald-*`/`green-*` de Tailwind a naranja en
 * su `app.css`, así que un `text-emerald-700` para «cumple» se vería naranja
 * allí y chocaría con el ámbar de «alerta». Los estados semafóricos tienen que
 * significar lo mismo en los dos despliegues; el color de marca solo manda en
 * la cáscara (botones, foco, pestaña activa), donde sí se usan las utilidades.
 *
 * Y **cada estado lleva etiqueta e icono además del color.** La regla viene del
 * portal del conductor —un punto amarillo y uno verde son indistinguibles al
 * sol— y vale igual aquí: hay daltonismo, hay pantallas malas y hay capturas en
 * blanco y negro pegadas en un informe de auditoría.
 */

import type {
	EstadoCobertura,
	EstadoIndicador,
	EstadoRequisito,
	EstadoRevision,
	EstadoVigencia,
	SeveridadAlerta,
	UnidadIndicador
} from '$lib/types/pesv-centro';

export interface TokenEstado {
	etiqueta: string;
	/** Texto sobre el fondo claro. Contraste ≥ 4.5:1 sobre `fondo`. */
	color: string;
	fondo: string;
	borde: string;
	/** Símbolo textual: sobrevive a una captura en blanco y negro. */
	icono: string;
	/** Explicación corta, para el `title` y el lector de pantalla. */
	descripcion: string;
}

/// Paleta semántica. Verde real, ámbar real, rojo real, gris real — ninguna
/// depende de la marca.
const VERDE = { color: '#15803d', fondo: '#f0fdf4', borde: '#bbf7d0' };
const AMBAR = { color: '#b45309', fondo: '#fffbeb', borde: '#fde68a' };
const ROJO = { color: '#b91c1c', fondo: '#fef2f2', borde: '#fecaca' };
const GRIS = { color: '#475569', fondo: '#f8fafc', borde: '#e2e8f0' };
const AZUL = { color: '#1d4ed8', fondo: '#eff6ff', borde: '#bfdbfe' };
const MORADO = { color: '#6d28d9', fondo: '#f5f3ff', borde: '#ddd6fe' };

export const ESTADO_INDICADOR: Record<EstadoIndicador, TokenEstado> = {
	OK: {
		...VERDE,
		etiqueta: 'En meta',
		icono: '✓',
		descripcion: 'El valor cumple la meta aprobada.'
	},
	ALERTA: {
		...AMBAR,
		etiqueta: 'En alerta',
		icono: '!',
		descripcion: 'Fuera de meta, dentro del umbral de alerta configurado.'
	},
	CRITICO: {
		...ROJO,
		etiqueta: 'Crítico',
		icono: '×',
		descripcion: 'Fuera de meta y del umbral de alerta.'
	},
	SIN_DATOS: {
		...GRIS,
		etiqueta: 'Sin datos',
		icono: '–',
		/// Es el estado más importante de este mapa: distingue «no hay con qué
		/// calcularlo» de «se calculó y salió cero».
		descripcion: 'No hay insumos suficientes o falta la meta. No es un cero.'
	}
};

export const ESTADO_REQUISITO: Record<EstadoRequisito, TokenEstado> = {
	PENDIENTE: { ...GRIS, etiqueta: 'Pendiente', icono: '○', descripcion: 'Sin trabajo iniciado.' },
	EN_PROGRESO: {
		...AZUL,
		etiqueta: 'En progreso',
		icono: '◐',
		descripcion: 'El área responsable está trabajando en el requisito.'
	},
	EN_REVISION: {
		...AMBAR,
		etiqueta: 'En revisión',
		icono: '⏳',
		descripcion: 'Hay evidencia aportada esperando decisión de HSEQ.'
	},
	CUMPLE: {
		...VERDE,
		etiqueta: 'Cumple',
		icono: '✓',
		descripcion: 'Todos los soportes obligatorios están aprobados y vigentes.'
	},
	NO_CUMPLE: {
		...ROJO,
		etiqueta: 'No cumple',
		icono: '×',
		descripcion: 'Declarado incumplido, con justificación registrada.'
	},
	NO_APLICA: {
		...MORADO,
		etiqueta: 'No aplica',
		icono: '—',
		descripcion: 'Exceptuado con justificación. No cuenta como incumplimiento.'
	}
};

export const ESTADO_REVISION: Record<EstadoRevision, TokenEstado> = {
	PENDIENTE: {
		...AMBAR,
		etiqueta: 'Pendiente',
		icono: '⏳',
		descripcion: 'Aportada. Todavía no acredita nada.'
	},
	APROBADO: {
		...VERDE,
		etiqueta: 'Aprobada',
		icono: '✓',
		descripcion: 'Revisada y aceptada por HSEQ.'
	},
	RECHAZADO: {
		...ROJO,
		etiqueta: 'Rechazada',
		icono: '×',
		descripcion: 'No acredita. Se conserva en el historial.'
	}
};

export const ESTADO_VIGENCIA: Record<EstadoVigencia, TokenEstado> = {
	SIN_FECHA: {
		...GRIS,
		etiqueta: 'Sin fecha',
		icono: '?',
		descripcion: 'No tiene fecha de vencimiento registrada.'
	},
	VIGENTE: {
		...VERDE,
		etiqueta: 'Vigente',
		icono: '✓',
		descripcion: 'Dentro de su período de validez.'
	},
	POR_VENCER: {
		...AMBAR,
		etiqueta: 'Por vencer',
		icono: '!',
		descripcion: 'Dentro de la ventana de preaviso configurada.'
	},
	VENCIDO: { ...ROJO, etiqueta: 'Vencido', icono: '×', descripcion: 'Ya no habilita.' }
};

export const ESTADO_COBERTURA: Record<EstadoCobertura, TokenEstado> = {
	CUBIERTO: {
		...VERDE,
		etiqueta: 'Cubierto',
		icono: '✓',
		descripcion: 'Contrato, FUEC, vehículo, conductor y documentos en regla.'
	},
	SIN_CONTRATO: {
		...ROJO,
		etiqueta: 'Sin contrato',
		icono: '×',
		descripcion: 'El servicio no está relacionado con ningún contrato.'
	},
	SIN_FUEC: {
		...ROJO,
		etiqueta: 'Sin FUEC',
		icono: '×',
		descripcion: 'No hay extracto que ampare el desplazamiento.'
	},
	VENCIDO: {
		...ROJO,
		etiqueta: 'Vigencia expirada',
		icono: '×',
		descripcion: 'La fecha del servicio cae fuera de la vigencia.'
	},
	VEHICULO_NO_COINCIDE: {
		...AMBAR,
		etiqueta: 'Vehículo no coincide',
		icono: '!',
		descripcion: 'El vehículo del servicio no figura en el extracto.'
	},
	CONDUCTOR_NO_COINCIDE: {
		...AMBAR,
		etiqueta: 'Conductor no coincide',
		icono: '!',
		descripcion: 'El conductor del servicio no figura en el extracto.'
	},
	DOCUMENTOS_NO_VIGENTES: {
		...AMBAR,
		etiqueta: 'Documentos no vigentes',
		icono: '!',
		descripcion: 'SOAT, RTM o tarjeta de operación vencidos o sin aprobar.'
	},
	FUEC_ANULADO: {
		...ROJO,
		etiqueta: 'FUEC anulado',
		icono: '×',
		descripcion: 'El extracto fue anulado y no ampara nada.'
	}
};

export const SEVERIDAD_ALERTA: Record<SeveridadAlerta, TokenEstado> = {
	CRITICA: { ...ROJO, etiqueta: 'Crítica', icono: '×', descripcion: 'Requiere acción inmediata.' },
	ALTA: {
		...AMBAR,
		etiqueta: 'Alta',
		icono: '!',
		descripcion: 'Requiere acción en el corto plazo.'
	},
	MEDIA: {
		...AZUL,
		etiqueta: 'Media',
		icono: '·',
		descripcion: 'Conviene atenderla antes del cierre.'
	},
	INFORMATIVA: {
		...GRIS,
		etiqueta: 'Informativa',
		icono: 'i',
		descripcion: 'Señala una captura pendiente, no un incumplimiento.'
	}
};

export const SEVERIDAD_SINIESTRO: Record<string, TokenEstado> = {
	FATALIDAD: {
		...ROJO,
		etiqueta: 'Fatalidad',
		icono: '×',
		descripcion: 'Evento con personas fallecidas.'
	},
	LESION_GRAVE: {
		...ROJO,
		etiqueta: 'Lesión grave',
		icono: '×',
		descripcion: 'Lesiones de gravedad.'
	},
	LESION_LEVE: { ...AMBAR, etiqueta: 'Lesión leve', icono: '!', descripcion: 'Lesiones menores.' },
	SOLO_DANOS: {
		...AZUL,
		etiqueta: 'Solo daños',
		icono: '·',
		descripcion: 'Daños materiales, sin lesionados.'
	}
};

export const NIVEL_RIESGO: Record<string, TokenEstado> = {
	BAJO: { ...VERDE, etiqueta: 'Bajo', icono: '·', descripcion: 'Riesgo aceptable.' },
	MEDIO: { ...AMBAR, etiqueta: 'Medio', icono: '·', descripcion: 'Requiere controles.' },
	ALTO: { ...ROJO, etiqueta: 'Alto', icono: '!', descripcion: 'Requiere controles y seguimiento.' },
	CRITICO: { ...ROJO, etiqueta: 'Crítico', icono: '×', descripcion: 'Requiere acción inmediata.' }
};

/** Token neutro para un valor que no está en ningún mapa. */
export const TOKEN_DESCONOCIDO: TokenEstado = {
	...GRIS,
	etiqueta: '—',
	icono: '?',
	descripcion: 'Estado no reconocido.'
};

// ─────────────────────────────────────────────────────────────────────────
//  Formato de valores
// ─────────────────────────────────────────────────────────────────────────

const MONEDA = new Intl.NumberFormat('es-CO', {
	style: 'currency',
	currency: 'COP',
	maximumFractionDigits: 0
});
const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

/**
 * Formatea el valor de un indicador.
 *
 * `null` NUNCA se convierte en «0». Devuelve «Sin datos», que es lo que
 * significa. Es la regla que impide que la pantalla enseñe cumplimiento
 * ficticio, y por eso vive aquí y no repartida por cada tarjeta.
 */
export function formatearValor(valor: number | null, unidad: UnidadIndicador): string {
	if (valor === null || valor === undefined || !Number.isFinite(valor)) return 'Sin datos';
	switch (unidad) {
		case 'PERCENT':
			return `${NUMERO.format(valor)} %`;
		case 'CURRENCY':
			return MONEDA.format(valor);
		case 'RATE':
			return `${NUMERO.format(valor)} por millón km`;
		case 'COUNT':
		default:
			return NUMERO.format(valor);
	}
}

/** Numerador/denominador legible, o el motivo por el que no hay. */
export function formatearFraccion(numerador: number | null, denominador: number | null): string {
	if (numerador === null && denominador === null) return 'Sin numerador ni denominador';
	if (denominador === null || denominador === 0) {
		return `${numerador ?? '—'} / sin denominador`;
	}
	return `${numerador ?? '—'} / ${NUMERO.format(denominador)}`;
}

/** Fecha `YYYY-MM-DD` a texto local, sin desplazarla de día. */
export function formatearFecha(iso: string | null | undefined): string {
	if (!iso) return '—';
	const soloFecha = iso.slice(0, 10);
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(soloFecha);
	if (!m) return iso;
	/// Se construye en UTC y se formatea en UTC. `new Date('2026-03-01')` en
	/// Bogotá da el 28 de febrero a las 19:00, y la fecha se pintaría un día
	/// antes.
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('es-CO', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

export function formatearInstante(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString('es-CO', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'America/Bogota'
	});
}

/** Cuánto queda para una fecha, en palabras. */
export function describirPlazo(dias: number | null | undefined): string {
	if (dias === null || dias === undefined) return 'Sin plazo';
	if (dias < 0) return `Venció hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'}`;
	if (dias === 0) return 'Vence hoy';
	return `Faltan ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

export const ETIQUETAS_AREA: Record<string, string> = {
	administracion: 'Administración',
	operaciones: 'Operaciones',
	contabilidad: 'Contabilidad',
	facturacion: 'Facturación',
	talento_humano: 'Talento Humano',
	hseq: 'HSEQ',
	mantenimiento: 'Mantenimiento'
};

export const etiquetaArea = (area: string | null | undefined): string =>
	area ? (ETIQUETAS_AREA[area] ?? area) : 'Sin asignar';

/** Dirección de la tendencia en texto e icono, ya interpretada por la meta. */
export function describirTendencia(t: {
	direccion: string;
	delta: number | null;
	favorable: boolean | null;
}): { texto: string; icono: string; favorable: boolean | null } {
	if (t.direccion === 'SIN_COMPARACION') {
		return { texto: 'Sin período anterior comparable', icono: '·', favorable: null };
	}
	if (t.direccion === 'IGUAL')
		return { texto: 'Igual que el período anterior', icono: '=', favorable: null };
	const signo = t.direccion === 'SUBE' ? '▲' : '▼';
	const delta = t.delta === null ? '' : ` ${NUMERO.format(Math.abs(t.delta))}`;
	return {
		texto: `${t.direccion === 'SUBE' ? 'Sube' : 'Baja'}${delta} respecto al período anterior`,
		icono: signo,
		favorable: t.favorable
	};
}
