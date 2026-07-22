// ==================== PESV Types ====================

export interface PesvKpis {
	totalConductores: number;
	totalVehiculos: number;
	totalServicios: number;
	totalServiciosRealizados: number;
	totalExcesos: number;
	totalPreoperacionales: number;
	porcentajePreoperacional: number;
}

export interface ChartItem {
	label: string;
	value: number;
	id?: string;
}

export interface PesvCharts {
	vehiculosMasDiasTrabajados: ChartItem[];
	conductoresMasDiasTrabajados: ChartItem[];
	clientesMasDiasTrabajados: ChartItem[];
	vehiculosMasPreoperacionales: ChartItem[];
	excesosVelocidadPorConductor: ChartItem[];
}

export interface PesvDashboardData {
	kpis: PesvKpis;
	charts: PesvCharts;
}

export interface ExcesoVelocidad {
	id: string;
	conductor_id: string;
	vehiculo_id: string;
	mes: number;
	anio: number;
	cantidad: number;
	observaciones: string | null;
	conductor?: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string;
	};
	vehiculo?: {
		id: string;
		placa: string;
		marca: string;
		modelo: string;
	};
}

export interface Preoperacional {
	id: string;
	conductor_id: string;
	vehiculo_id: string;
	fecha: string;
	realizado: boolean;
	observaciones: string | null;
	conductor?: {
		id: string;
		nombre: string;
		apellido: string;
		numero_identificacion: string;
	};
	vehiculo?: {
		id: string;
		placa: string;
	};
}

export interface PesvFilterOptions {
	conductores: { id: string; nombre: string; apellido: string; numero_identificacion: string }[];
	vehiculos: { id: string; placa: string; marca: string | null; modelo: string | null }[];
	clientes: { id: string; nombre: string }[];
	municipios: { id: string; nombre_municipio: string }[];
}

export interface RegistroDiarioPesv {
	id: string;
	dia: number;
	fecha: string;
	conductor: { id: string; nombre: string; numero_identificacion: string | null };
	vehiculo: { id: string; placa: string };
	cliente: { id: string; nombre: string | null };
	origen: string | null;
	destino: string | null;
	num_servicios: number;
	tiempo_conduccion: number;
	tiempo_disponibilidad: number;
	horas_sueno: number | null;
	excesos_velocidad_dia: number;
	preoperacional_realizado: boolean;
	siniestros: number;
	siniestros_detalle: string | null;
	pernocte: boolean;
	observaciones: string | null;
}

export interface PesvFilters {
	mes?: number;
	anio?: number;
}
