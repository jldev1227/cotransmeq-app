import { apiClient } from './apiClient';

/**
 * Cartera (cuentas por cobrar): saldo y edades por cliente, facturas con su
 * situación de cobro y abonos. El saldo, el estado y el tramo los calcula el
 * backend (`modules/cartera/cartera.calculo.ts`); aquí solo se pintan.
 */

export type EstadoCartera = 'pendiente' | 'abonada' | 'pagada' | 'vencida';
export type TramoEdad = 'corriente' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_mas';

export const TRAMOS: readonly TramoEdad[] = ['corriente', 'd1_30', 'd31_60', 'd61_90', 'd90_mas'];

export const ETIQUETA_TRAMO: Record<TramoEdad, string> = {
	corriente: 'Corriente',
	d1_30: '1–30',
	d31_60: '31–60',
	d61_90: '61–90',
	d90_mas: '+90'
};

/**
 * Colores de semáforo en hex literal y no en `emerald-*`: cotransmeq remapea
 * esa escala a naranja, y «al día» en naranja se leería como alerta.
 */
export const ESTADO_CARTERA: Record<EstadoCartera, { etiqueta: string; color: string }> = {
	pendiente: { etiqueta: 'Pendiente', color: '#2563eb' },
	abonada: { etiqueta: 'Abonada', color: '#d97706' },
	pagada: { etiqueta: 'Pagada', color: '#16a34a' },
	vencida: { etiqueta: 'Vencida', color: '#dc2626' }
};

export type MontosPorTramo = Record<TramoEdad, number>;

export interface ResumenCartera {
	por_cobrar: number;
	vencido: number;
	corriente: number;
	por_vencer_mes: number;
	facturas_abiertas: number;
	facturas_vencidas: number;
	clientes_con_saldo: number;
	edades: MontosPorTramo;
}

export interface FilaClienteCartera {
	cliente_id: string | null;
	nombre: string;
	nit: string | null;
	facturas: number;
	facturas_vencidas: number;
	saldo: number;
	vencido: number;
	edades: MontosPorTramo;
	max_dias_vencida: number;
}

export interface FacturaCartera {
	id: string;
	numero_factura: string;
	cliente: { id: string; nombre: string | null; nit: string | null } | null;
	fecha_emision: string;
	plazo_dias: number;
	fecha_vencimiento: string;
	ajuste_valor: number;
	observaciones: string | null;
	liquidaciones: number;
	abonos: number;
	ultimo_abono: string | null;
	valor: number;
	recibido: number;
	retenciones: number;
	aplicado: number;
	saldo: number;
	estado: EstadoCartera;
	dias_vencida: number;
	tramo: TramoEdad | null;
}

export interface AbonoCartera {
	id: string;
	fecha: string;
	valor: number;
	retefuente: number;
	reteica: number;
	reteiva: number;
	otros_descuentos: number;
	aplicado: number;
	medio: string;
	referencia: string | null;
	tiene_comprobante: boolean;
	comprobante_nombre: string | null;
	observaciones: string | null;
	creado: string;
	creado_por: { id: string; nombre: string | null } | null;
}

export interface DetalleFacturaCartera {
	hoy: string;
	factura: FacturaCartera & {
		estado_factura: 'ACTIVA' | 'ANULADA';
		fecha_facturacion: string;
		facturado_por: { id: string; nombre: string | null } | null;
		suma_liquidaciones: number;
		items: Array<{
			liquidacion_id: string;
			consecutivo: string;
			mes: number;
			anio: number;
			valor: number;
		}>;
	};
	abonos: AbonoCartera[];
}

export interface NuevoAbono {
	fecha: string;
	valor: number;
	retefuente?: number;
	reteica?: number;
	reteiva?: number;
	otros_descuentos?: number;
	medio: string;
	referencia?: string | null;
	observaciones?: string | null;
	comprobante?: File | null;
}

export interface CondicionesFactura {
	valor_total?: number | null;
	fecha_emision?: string | null;
	plazo_dias?: number | null;
	fecha_vencimiento?: string | null;
}

export const carteraAPI = {
	resumen: async () =>
		(await apiClient.get('/api/cartera/resumen')).data.data as {
			hoy: string;
			resumen: ResumenCartera;
			clientes: FilaClienteCartera[];
		},

	facturas: async (filtros: { cliente_id?: string; estado?: string; tramo?: string; q?: string }) =>
		(await apiClient.get('/api/cartera/facturas', { params: filtros })).data.data as {
			hoy: string;
			facturas: FacturaCartera[];
		},

	detalle: async (id: string) =>
		(await apiClient.get(`/api/cartera/facturas/${id}`)).data.data as DetalleFacturaCartera,

	/**
	 * Con comprobante va en multipart; sin él, en JSON. Los campos van ANTES
	 * del archivo: el backend los lee en orden.
	 */
	registrarAbono: async (facturaId: string, a: NuevoAbono) => {
		const { comprobante, ...campos } = a;
		let cuerpo: FormData | Record<string, unknown> = campos;
		if (comprobante) {
			const fd = new FormData();
			for (const [k, v] of Object.entries(campos)) {
				if (v !== undefined && v !== null) fd.append(k, String(v));
			}
			fd.append('comprobante', comprobante);
			cuerpo = fd;
		}
		return (await apiClient.post(`/api/cartera/facturas/${facturaId}/abonos`, cuerpo)).data
			.data as DetalleFacturaCartera;
	},

	eliminarAbono: async (abonoId: string, motivo?: string) =>
		(await apiClient.delete(`/api/cartera/abonos/${abonoId}`, { data: { motivo } })).data
			.data as DetalleFacturaCartera,

	urlComprobante: async (abonoId: string) =>
		(await apiClient.get(`/api/cartera/abonos/${abonoId}/comprobante`)).data.data.url as string,

	actualizarCondiciones: async (facturaId: string, c: CondicionesFactura) =>
		(await apiClient.patch(`/api/cartera/facturas/${facturaId}/condiciones`, c)).data
			.data as DetalleFacturaCartera
};

/** Mensaje útil de un error de la API (zod, dominio o red). */
export function mensajeError(e: any, porDefecto = 'No se pudo completar la operación'): string {
	return e?.response?.data?.message || e?.response?.data?.error || e?.message || porDefecto;
}
