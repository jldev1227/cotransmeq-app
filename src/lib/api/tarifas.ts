import { apiClient } from './apiClient';

/**
 * Tarifas de servicios por cliente (`tarifas_servicios`): una por cliente y
 * año, con la operadora cuya tabla de precios aplica.
 *
 * Viven en el módulo `liquidaciones-servicios` del backend: consultar pide ese
 * módulo en `limited` o más (facturación las ve) y escribir pide `full`.
 */

export type OperadoraTarifa = 'PAREX' | 'GEOPARK';

export interface TarifaCliente {
	id: string;
	cliente_id: string;
	/** Nula en filas viejas que se cargaron sin ella. */
	operadora: OperadoraTarifa | null;
	anio: number;
	valor_24h: number;
	valor_12h: number;
	valor_hora: number;
	valor_km: number;
	km_dia: number;
	valor_pernocte: number;
	activo: boolean;
	updated_at: string;
}

export interface TarifaClienteInput {
	operadora: OperadoraTarifa;
	anio: number;
	valor_24h: number;
	valor_12h: number;
	valor_hora: number;
	valor_km: number;
	km_dia: number;
	valor_pernocte: number;
}

/// Prisma serializa los `Decimal` como texto («1125158.00»): se normalizan a
/// número aquí para que ninguna pantalla sume cadenas.
function normalizar(t: Record<string, unknown>): TarifaCliente {
	return {
		id: String(t.id),
		cliente_id: String(t.cliente_id),
		operadora: (t.operadora as OperadoraTarifa | null) ?? null,
		anio: Number(t.anio),
		valor_24h: Number(t.valor_24h),
		valor_12h: Number(t.valor_12h),
		valor_hora: Number(t.valor_hora),
		valor_km: Number(t.valor_km),
		km_dia: Number(t.km_dia),
		valor_pernocte: Number(t.valor_pernocte),
		activo: Boolean(t.activo),
		updated_at: String(t.updated_at)
	};
}

function mensaje(error: unknown, porDefecto: string): Error {
	const e = error as { response?: { data?: { error?: string; message?: string } } };
	return new Error(e?.response?.data?.error || e?.response?.data?.message || porDefecto);
}

export const tarifasAPI = {
	/** Todas las del cliente, activas e inactivas, de la más reciente a la más vieja. */
	async listar(clienteId: string): Promise<TarifaCliente[]> {
		try {
			const { data } = await apiClient.get('/api/liquidaciones-servicios/tarifas', {
				params: { cliente_id: clienteId, incluir_inactivas: '1' }
			});
			return (data as Record<string, unknown>[]).map(normalizar);
		} catch (error) {
			throw mensaje(error, 'No se pudieron cargar las tarifas');
		}
	},

	/** Si el año existía desactivado, el backend lo reactiva con estos valores. */
	async crear(clienteId: string, input: TarifaClienteInput): Promise<TarifaCliente> {
		try {
			const { data } = await apiClient.post('/api/liquidaciones-servicios/tarifas', {
				cliente_id: clienteId,
				...input
			});
			return normalizar(data);
		} catch (error) {
			throw mensaje(error, 'No se pudo crear la tarifa');
		}
	},

	async actualizar(
		id: string,
		cambios: Partial<TarifaClienteInput> & { activo?: boolean }
	): Promise<TarifaCliente> {
		try {
			const { data } = await apiClient.put(`/api/liquidaciones-servicios/tarifas/${id}`, cambios);
			return normalizar(data);
		} catch (error) {
			throw mensaje(error, 'No se pudo guardar la tarifa');
		}
	},

	/** «Eliminar» en el backend solo desactiva: la fila conserva su año. */
	async desactivar(id: string): Promise<void> {
		try {
			await apiClient.delete(`/api/liquidaciones-servicios/tarifas/${id}`);
		} catch (error) {
			throw mensaje(error, 'No se pudo desactivar la tarifa');
		}
	}
};
