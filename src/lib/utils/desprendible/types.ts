/**
 * Tipos para la vista de desprendible.
 *
 * La idea central: buildDesprendible() produce una estructura de vista
 * intermedia (DesprendibleView) que luego puede renderizarse de dos
 * formas: como HTML (preview en el canvas) o como PDF (pdfmake).
 *
 * Esto garantiza que el preview y el PDF nunca diverjan.
 */

export type SectionType = 'header' | 'empleado' | 'adicionales' | 'conceptos' | 'disponibilidad' | 'deducciones' | 'resumen' | 'firma' | 'metadatos';

export type CellColor = 'default' | 'emerald' | 'blue' | 'orange' | 'red' | 'muted';

export interface DesprendibleCell {
	label: string;
	value: string;
	color?: CellColor;
	subtext?: string;
	bold?: boolean;
	align?: 'left' | 'right' | 'center';
}

export interface DesprendibleSection {
	type: SectionType;
	title?: string;
	subtitle?: string;
	columns?: number;
	rows?: DesprendibleCell[][];
	body?: any[][];
	note?: string;
}

export interface DesprendibleRecargoDetallado {
	vehiculoPlaca: string;
	empresaNombre: string;
	mesLabel: string;
	conductorNombre: string;
	conductorCedula: string;
	valorHoraBase: number;
	dias: Array<{
		dia: number;
		horario: string;
		horas: number;
		hed: number;
		rn: number;
		hen: number;
		rd: number;
		rndf: number;
		hefd: number;
		hefn: number;
		bgColor: string;
		textColor: string;
	}>;
	totales: {
		dias: number;
		horas: number;
		hed: number;
		rn: number;
		hen: number;
		rd: number;
		rndf: number;
		hefd: number;
		hefn: number;
	};
	tiposConsolidados: Array<{
		codigo: string;
		nombre: string;
		porcentaje: number;
		valorHoraBase: number;
		valorHoraCalculada: number;
		horas: number;
		valorTotal: number;
	}>;
	totalValor: number;
	hayFestivosODomingos: boolean;
	hayDisponibles: boolean;
}

export interface DesprendibleView {
	header: {
		empresa: string;
		nit: string;
		comprobanteLabel: string;
		mesLabel: string;
		mesLabelLower: string;
		periodoCompletoLabel: string;
		logo: string | null;
	};
	empleado: DesprendibleCell[][];
	adicionales: {
		title: string;
		periodoLabel: string;
		header: string[];
		rows: any[][];
	};
	conceptosAdicionales: {
		title: string;
		header?: string[];
		rows: any[][];
	} | null;
	disponibilidad: {
		title: string;
		rows: DesprendibleCell[][];
	} | null;
	deducciones: {
		title: string;
		rows: DesprendibleCell[][];
	};
	resumen: {
		title: string;
		rows: DesprendibleCell[][];
	};
	recargosDetallados: DesprendibleRecargoDetallado[];
	generadoEn: string;
}

export const PAREX_EMPRESA_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';
export const GEOPARK_EMPRESA_ID = 'eea5eda5-1b60-45a0-b4c7-606a8c908ff9';
