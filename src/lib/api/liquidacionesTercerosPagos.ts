import { apiClient } from './apiClient';
import { comprimirImagen } from './viaticos';

/**
 * Pago de los cierres finales de terceros: fecha, medio, referencia y
 * soporte de lo que se le pagó al propietario.
 *
 * El paso a PAGADA sigue yendo por el cambio de estado
 * (`liquidacionesTercerosDescuentosAPI.cambiarEstado` y el lote), que ahora
 * lleva el objeto `pago`. Aquí está lo demás: subir el soporte antes de
 * marcar, leer el pago y completarlo en los PAGADA que no lo tienen.
 */

export interface DatosPago {
	fecha: string;
	medio: string;
	referencia?: string | null;
	observaciones?: string | null;
	comprobante_s3_key?: string | null;
	comprobante_nombre?: string | null;
}

export interface PagoCierre {
	id: string;
	cierre_id: string;
	fecha: string;
	medio: string;
	referencia: string | null;
	valor: number | null;
	tiene_comprobante: boolean;
	comprobante_nombre: string | null;
	observaciones: string | null;
	registrado: string;
	registrado_por: { id: string; nombre: string | null } | null;
	archivado: string | null;
	motivo_archivo: string | null;
}

export interface PagoDeCierre {
	cierre: { id: string; estado: string; placa: string; consecutivo: string; total_pagar: number };
	pago: PagoCierre | null;
	/** PAGADA sin datos: anterior a este registro. */
	sin_registro: boolean;
	historial: PagoCierre[];
}

export const liquidacionesTercerosPagosAPI = {
	/** Sube el soporte y devuelve la clave que viaja con el cambio de estado. */
	subirComprobante: async (archivo: File) => {
		const fd = new FormData();
		fd.append('comprobante', archivo);
		return (await apiClient.post('/api/liquidaciones-terceros-pagos/comprobante', fd)).data
			.data as {
			s3_key: string;
			nombre: string;
		};
	},

	obtener: async (cierreId: string) =>
		(await apiClient.get(`/api/liquidaciones-terceros-pagos/${cierreId}`)).data
			.data as PagoDeCierre,

	porPeriodo: async (anio: number, mes: number) =>
		(await apiClient.get('/api/liquidaciones-terceros-pagos/periodo', { params: { anio, mes } }))
			.data.data as Record<string, PagoCierre>,

	/** Registra o corrige el pago de un cierre que ya está PAGADA. */
	completar: async (cierreId: string, pago: DatosPago) =>
		(await apiClient.put(`/api/liquidaciones-terceros-pagos/${cierreId}`, pago)).data
			.data as PagoDeCierre,

	urlComprobante: async (pagoId: string) =>
		(await apiClient.get(`/api/liquidaciones-terceros-pagos/comprobante/${pagoId}`)).data.data
			.url as string
};

/** Lo que llena el formulario de pago (`CamposPagoCierre`). */
export interface FormPago {
	fecha: string;
	medio: string;
	referencia: string;
	archivo: File | null;
}

/** Fecha y medio son lo mínimo que exige el backend para marcar PAGADA. */
export function pagoCompleto(f: FormPago): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(f.fecha) && !!f.medio;
}

/**
 * Convierte el formulario en el `pago` que viaja con el cambio de estado:
 * sube antes el soporte (comprimido si es foto) y manda solo su clave.
 */
export async function armarPago(f: FormPago): Promise<DatosPago> {
	let comprobante: { s3_key: string; nombre: string } | null = null;
	if (f.archivo) {
		comprobante = await liquidacionesTercerosPagosAPI.subirComprobante(
			await comprimirImagen(f.archivo)
		);
	}
	return {
		fecha: f.fecha,
		medio: f.medio,
		referencia: f.referencia.trim() || null,
		comprobante_s3_key: comprobante?.s3_key ?? null,
		comprobante_nombre: comprobante?.nombre ?? null
	};
}
