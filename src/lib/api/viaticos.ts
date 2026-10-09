/**
 * Viáticos: anticipos a conductores, los gastos con que los legalizan y las
 * solicitudes de más dinero que hacen desde la app.
 *
 * El saldo lo calcula el servidor (`valor − gastos vigentes`); aquí no se
 * recalcula nada.
 */
import { apiClient } from './apiClient';

export type MetodoAnticipo = 'TRANSFERENCIA' | 'RETIRO_TARJETA';
export type EstadoSolicitud = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
export type FiltroEstadoAnticipo = 'todos' | 'con_saldo' | 'saldo_bajo' | 'agotados';

export const METODO_LABELS: Record<MetodoAnticipo, string> = {
	TRANSFERENCIA: 'Transferencia',
	RETIRO_TARJETA: 'Retiro con tarjeta'
};

export interface Saldo {
	valor: number;
	gastado: number;
	saldo: number;
	porcentaje_restante: number;
	saldo_bajo: boolean;
	agotado: boolean;
}

export interface AnticipoResumen extends Saldo {
	id: string;
	conductor: { id: string; nombre: string; numero_identificacion: string | null };
	vehiculo: { id: string; placa: string; descripcion: string };
	concepto: string;
	metodo: MetodoAnticipo;
	fecha: string;
	numero_comprobante: string | null;
	entidad: string | null;
	tarjeta_cuenta: string | null;
	tiene_comprobante: boolean;
	solicitud_id: string | null;
	solicitud_pendiente: { id: string; valor_solicitado: number; created_at: string } | null;
	creado_por: { id: string; nombre: string } | null;
	created_at: string;
}

export interface AdjuntoGasto {
	id: string;
	mime_type: string;
	byte_size: number;
	original_name: string | null;
	status: 'PENDING' | 'UPLOADED';
	url: string | null;
}

export interface Gasto {
	id: string;
	valor: number;
	descripcion: string | null;
	fecha: string;
	anulado: boolean;
	anulado_at: string | null;
	anulado_por: { id: string; nombre: string } | null;
	motivo_anulacion: string | null;
	created_at: string;
	adjuntos: AdjuntoGasto[];
}

export interface Solicitud {
	id: string;
	anticipo_origen_id: string;
	valor_solicitado: number;
	observaciones: string | null;
	estado: EstadoSolicitud;
	motivo_rechazo: string | null;
	resuelta_por: { id: string; nombre: string } | null;
	resuelta_at: string | null;
	anticipo_generado_id: string | null;
	created_at: string;
}

export interface SolicitudListada extends Solicitud {
	conductor: { id: string; nombre: string; numero_identificacion: string | null };
	vehiculo: { id: string; placa: string };
	anticipo_origen: Saldo & { id: string; concepto: string };
}

export interface LecturaComprobante {
	valor: number | null;
	fecha: string | null;
	numero_comprobante: string | null;
	entidad: string | null;
	cuenta_origen: string | null;
	destinatario: string | null;
	confianza: 'alta' | 'media' | 'baja';
}

export interface AnticipoDetalle extends AnticipoResumen {
	comprobante: {
		url: string | null;
		mime_type: string | null;
		nombre: string | null;
		key?: string;
	} | null;
	comprobante_lectura: LecturaComprobante | null;
	actualizado_por: { id: string; nombre: string } | null;
	updated_at: string;
	gastos: Gasto[];
	solicitudes: Solicitud[];
}

export interface ListadoAnticipos {
	data: AnticipoResumen[];
	meta: { total: number; page: number; limit: number; totalPages: number };
	conteos: Record<FiltroEstadoAnticipo, number>;
	totales: { anticipado: number; gastado: number; saldo: number };
	solicitudes_pendientes: number;
}

export interface AnticipoInput {
	conductor_id: string;
	vehiculo_id: string;
	concepto: string;
	valor: number;
	metodo: MetodoAnticipo;
	fecha: string;
	numero_comprobante?: string | null;
	entidad?: string | null;
	tarjeta_cuenta?: string | null;
	comprobante?: { key: string; mime_type: string; nombre?: string | null } | null;
	comprobante_lectura?: LecturaComprobante | null;
	solicitud_id?: string | null;
}

/// Errores de la API con el mensaje del servidor, no el genérico de axios.
function mensaje(error: unknown, porDefecto: string): Error {
	const e = error as { response?: { data?: { message?: string } } };
	return new Error(e?.response?.data?.message || porDefecto);
}

async function llamar<T>(promesa: Promise<{ data: { data: T } }>, porDefecto: string): Promise<T> {
	try {
		return (await promesa).data.data;
	} catch (error) {
		throw mensaje(error, porDefecto);
	}
}

export const viaticosAPI = {
	async listar(params: {
		q?: string;
		estado?: FiltroEstadoAnticipo;
		desde?: string;
		hasta?: string;
		page?: number;
		limit?: number;
	}): Promise<ListadoAnticipos> {
		try {
			const { data } = await apiClient.get('/api/viaticos/anticipos', { params });
			return data;
		} catch (error) {
			throw mensaje(error, 'No se pudieron cargar los anticipos');
		}
	},
	detalle: (id: string) =>
		llamar<AnticipoDetalle>(
			apiClient.get(`/api/viaticos/anticipos/${id}`),
			'No se pudo cargar el anticipo'
		),
	crear: (input: AnticipoInput) =>
		llamar<AnticipoDetalle>(
			apiClient.post('/api/viaticos/anticipos', input),
			'No se pudo registrar el anticipo'
		),
	actualizar: (id: string, input: AnticipoInput) =>
		llamar<AnticipoDetalle>(
			apiClient.put(`/api/viaticos/anticipos/${id}`, input),
			'No se pudo actualizar el anticipo'
		),
	eliminar: (id: string) =>
		llamar<{ id: string }>(
			apiClient.delete(`/api/viaticos/anticipos/${id}`),
			'No se pudo eliminar el anticipo'
		),
	anularGasto: (gastoId: string, motivo: string) =>
		llamar<AnticipoDetalle>(
			apiClient.post(`/api/viaticos/gastos/${gastoId}/anular`, { motivo }),
			'No se pudo anular el gasto'
		),
	solicitudes: (estado: EstadoSolicitud | 'todas' = 'PENDIENTE') =>
		llamar<SolicitudListada[]>(
			apiClient.get('/api/viaticos/solicitudes', { params: { estado } }),
			'No se pudieron cargar las solicitudes'
		),
	solicitud: (id: string) =>
		llamar<SolicitudListada>(
			apiClient.get(`/api/viaticos/solicitudes/${id}`),
			'No se pudo cargar la solicitud'
		),
	rechazar: (id: string, motivo: string) =>
		llamar<SolicitudListada>(
			apiClient.post(`/api/viaticos/solicitudes/${id}/rechazar`, { motivo }),
			'No se pudo rechazar la solicitud'
		),

	/**
	 * Sube el comprobante directo a S3 y devuelve su clave. El PUT va del
	 * navegador al bucket: si falla sin llegar a AWS, revisa el CORS de PUT.
	 */
	async subirComprobante(
		archivo: File
	): Promise<{ key: string; mime_type: string; nombre: string }> {
		const firmado = await llamar<{
			key: string;
			upload_url: string;
			headers: Record<string, string>;
		}>(
			apiClient.post('/api/viaticos/comprobantes/presign', {
				nombre: archivo.name,
				mime_type: archivo.type,
				byte_size: archivo.size
			}),
			'No se pudo preparar la subida del comprobante'
		);
		let r: Response;
		try {
			r = await fetch(firmado.upload_url, {
				method: 'PUT',
				body: archivo,
				headers: firmado.headers
			});
		} catch {
			/// `fetch` lanza sin respuesta cuando el preflight CORS del bucket rechaza el origen.
			throw new Error(
				'No se pudo subir el comprobante: revisa la conexión (o la regla CORS de PUT del bucket).'
			);
		}
		if (!r.ok)
			throw new Error(`La subida del comprobante falló (${r.status}). Vuelve a intentarlo.`);
		return { key: firmado.key, mime_type: archivo.type, nombre: archivo.name };
	},

	leerComprobante: (key: string, mime_type: string) =>
		llamar<LecturaComprobante>(
			apiClient.post('/api/viaticos/comprobantes/leer', { key, mime_type }, { timeout: 60_000 }),
			'No se pudo leer el comprobante'
		)
};

/**
 * Reduce una foto del comprobante antes de subirla: 1800 px de lado mayor en JPEG 0,75. Una captura de
 * pantalla o una foto de celular pasa de 1–4 MB a 150–400 KB y la IA la sigue leyendo bien. Los PDF y las
 * imágenes que ya son livianas se suben tal cual; si la versión comprimida no pesa menos, también.
 */
export async function comprimirImagen(
	archivo: File,
	ladoMaximo = 1800,
	calidad = 0.75
): Promise<File> {
	if (!archivo.type.startsWith('image/') || archivo.size <= 300 * 1024) return archivo;
	try {
		const bitmap = await createImageBitmap(archivo);
		const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
		const lienzo = document.createElement('canvas');
		lienzo.width = Math.round(bitmap.width * escala);
		lienzo.height = Math.round(bitmap.height * escala);
		const ctx = lienzo.getContext('2d');
		if (!ctx) return archivo;
		/// Fondo blanco: un PNG con transparencia quedaría negro al pasar a JPEG.
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, lienzo.width, lienzo.height);
		ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
		bitmap.close();
		const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, 'image/jpeg', calidad));
		if (!blob || blob.size >= archivo.size) return archivo;
		const nombre = archivo.name.replace(/\.[^.]+$/, '') + '.jpg';
		return new File([blob], nombre, { type: 'image/jpeg' });
	} catch {
		return archivo;
	}
}

const cop = new Intl.NumberFormat('es-CO', {
	style: 'currency',
	currency: 'COP',
	maximumFractionDigits: 0
});
export const moneda = (v: number) => cop.format(v);

export function fechaCorta(iso: string | null | undefined): string {
	if (!iso) return '—';
	/// Un instante (con hora) se muestra en el día local: a las 10 p. m. en
	/// Colombia ya es el día siguiente en UTC y cortar el ISO lo adelantaba.
	/// Una fecha a secas (YYYY-MM-DD) se corta tal cual: no tiene zona.
	if (iso.includes('T')) {
		const f = new Date(iso);
		if (!Number.isNaN(f.getTime())) {
			return f.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
		}
	}
	const [y, m, d] = iso.slice(0, 10).split('-');
	return `${d}/${m}/${y}`;
}

/// Semáforo del saldo: igual en los dos gemelos.
export function colorSaldo(s: Pick<Saldo, 'saldo_bajo' | 'agotado'>): string {
	return s.agotado ? '#ef4444' : s.saldo_bajo ? '#f59e0b' : '#22c55e';
}
export function etiquetaSaldo(s: Pick<Saldo, 'saldo_bajo' | 'agotado'>): string {
	return s.agotado ? 'Agotado' : s.saldo_bajo ? 'Saldo bajo' : 'Con saldo';
}

// ── Tablero y gastos que asume la empresa ───────────────────────────────

export type Agrupacion = 'dia' | 'semana' | 'mes';
export type CategoriaGasto = 'OFICINA' | 'MANTENIMIENTO' | 'CONDUCTOR' | 'BANCARIO' | 'OTRO';
export type MetodoGasto = 'TRANSFERENCIA' | 'RETIRO_TARJETA' | 'EFECTIVO' | 'DEBITO_AUTOMATICO';
/** Quién reconoce el gasto: la empresa o el tercero propietario de la placa. */
export type AsumeGasto = 'EMPRESA' | 'TERCERO';

export const CATEGORIA_LABELS: Record<CategoriaGasto, string> = {
	OFICINA: 'Oficina',
	MANTENIMIENTO: 'Mantenimiento de vehículo',
	CONDUCTOR: 'A un conductor',
	BANCARIO: 'Bancario (4x1000, cuota de manejo)',
	OTRO: 'Otro'
};
export const METODO_GASTO_LABELS: Record<MetodoGasto, string> = {
	TRANSFERENCIA: 'Transferencia',
	RETIRO_TARJETA: 'Retiro con tarjeta',
	EFECTIVO: 'Efectivo',
	DEBITO_AUTOMATICO: 'Débito automático'
};
export const ASUME_LABELS: Record<AsumeGasto, string> = {
	EMPRESA: 'La empresa',
	TERCERO: 'El propietario de la placa'
};

export interface PeriodoViaticos {
	clave: string;
	desde: string;
	hasta: string;
	anticipos: number;
	cantidad_anticipos: number;
	legalizado: number;
	gastos_empresa: number;
	cantidad_gastos_empresa: number;
}

export interface ResumenViaticos {
	rango: { desde: string; hasta: string; agrupar: Agrupacion };
	totales: {
		anticipos: number;
		cantidad_anticipos: number;
		legalizado: number;
		gastos_empresa: number;
		cantidad_gastos_empresa: number;
		/** Gastos directos que asume el propietario de la placa (se le descuentan a él). */
		gastos_tercero: number;
		cantidad_gastos_tercero: number;
		egresos: number;
		en_manos_de_conductores: number;
	};
	periodos: PeriodoViaticos[];
	por_categoria: { categoria: CategoriaGasto; valor: number; cantidad: number }[];
	top_conductores: { id: string; etiqueta: string; valor: number; cantidad: number }[];
	top_placas: { id: string; etiqueta: string; valor: number; cantidad: number }[];
	fondos: { usuario_id: string; nombre: string; saldo: number }[];
}

export interface GastoEmpresa {
	id: string;
	categoria: CategoriaGasto;
	asume: AsumeGasto;
	tercero: { id: string; nombre: string; identificacion: string | null } | null;
	descripcion: string;
	beneficiario: string | null;
	valor: number;
	fecha: string;
	metodo: MetodoGasto;
	numero_comprobante: string | null;
	comprobante: { key: string; mime_type: string | null; nombre: string | null } | null;
	vehiculo: { id: string; placa: string } | null;
	conductor: { id: string; nombre: string } | null;
	creado_por: { id: string; nombre: string } | null;
	created_at: string;
}

export interface GastoEmpresaInput {
	categoria: CategoriaGasto;
	asume: AsumeGasto;
	descripcion: string;
	beneficiario?: string | null;
	valor: number;
	fecha: string;
	metodo: MetodoGasto;
	numero_comprobante?: string | null;
	comprobante?: { key: string; mime_type: string; nombre: string } | null;
	vehiculo_id?: string | null;
	conductor_id?: string | null;
}

export interface ListadoGastosEmpresa {
	data: GastoEmpresa[];
	meta: { total: number; page: number; limit: number; totalPages: number };
	total_valor: number;
}

export const viaticosEmpresaAPI = {
	resumen: (params: { desde: string; hasta: string; agrupar: Agrupacion }) =>
		llamar<ResumenViaticos>(
			apiClient.get('/api/viaticos/resumen', { params }),
			'No se pudo calcular el resumen'
		),

	async gastos(params: {
		q?: string;
		categoria?: CategoriaGasto;
		desde?: string;
		hasta?: string;
		page?: number;
		limit?: number;
	}): Promise<ListadoGastosEmpresa> {
		try {
			const { data } = await apiClient.get('/api/viaticos/gastos-empresa', { params });
			return data;
		} catch (error) {
			throw mensaje(error, 'No se pudieron cargar los gastos de la empresa');
		}
	},
	crear: (input: GastoEmpresaInput) =>
		llamar<GastoEmpresa>(
			apiClient.post('/api/viaticos/gastos-empresa', input),
			'No se pudo registrar el gasto'
		),
	actualizar: (id: string, input: GastoEmpresaInput) =>
		llamar<GastoEmpresa>(
			apiClient.put(`/api/viaticos/gastos-empresa/${id}`, input),
			'No se pudo actualizar el gasto'
		),
	eliminar: (id: string) =>
		llamar<{ id: string }>(
			apiClient.delete(`/api/viaticos/gastos-empresa/${id}`),
			'No se pudo eliminar el gasto'
		)
};

// ── Fondo (saldo) del área de operaciones ───────────────────────────────────
// Ver backend `viaticos-fondo.service.ts`: el saldo es la suma de movimientos;
// un CIERRE marca el fin de un corte sin mover plata (lo que queda arrastra).

export type TipoMovimientoFondo =
	'RECARGA' | 'ANTICIPO' | 'GASTO_EMPRESA' | 'AJUSTE' | 'REVERSO' | 'CIERRE';

export interface MovimientoFondo {
	id: string;
	tipo: TipoMovimientoFondo;
	valor: number;
	observaciones: string | null;
	fecha: string;
	registrado_por: string | null;
	/** Saldo recibido o corrección a mano: se puede editar. Lo de anticipos/gastos, no. */
	editable: boolean;
	anticipo: { id: string; concepto: string; conductor: string; placa: string } | null;
	gasto_empresa: { id: string; categoria: string; descripcion: string } | null;
}

export interface CorteFondo {
	desde: string | null;
	arrastre: number;
	recibido: number;
	anticipos: number;
	gastos: number;
	ajustes: number;
	reversos: number;
	restante: number;
	movimientos: number;
	cerrado: { id: string; fecha: string; por: string | null; observaciones: string | null } | null;
}

export interface FondoViaticos {
	fondo: string;
	/** Si lo que entrega este usuario descuenta del fondo (operaciones); administración no. */
	requiere_fondo: boolean;
	saldo: number;
	base_ultima_recarga: number;
	porcentaje_restante: number;
	saldo_bajo: boolean;
	sin_saldo: boolean;
	ultima_recarga: { valor: number; fecha: string; por: string | null } | null;
	corte_actual: CorteFondo;
	cortes: CorteFondo[];
	movimientos: MovimientoFondo[];
}

export const TIPO_MOVIMIENTO_LABELS: Record<TipoMovimientoFondo, string> = {
	RECARGA: 'Saldo recibido',
	ANTICIPO: 'Anticipo',
	GASTO_EMPRESA: 'Gasto de la empresa',
	AJUSTE: 'Corrección',
	REVERSO: 'Reverso',
	CIERRE: 'Cierre de corte'
};

export interface ConsolidadoFondo {
	fondo: string;
	desde: string;
	hasta: string;
	saldo_inicial: number;
	saldo_final: number;
	totales: {
		recibido: number;
		anticipos: number;
		gastos: number;
		ajustes: number;
		reversos: number;
		cierres: number;
	};
	cierres: {
		id: string;
		fecha: string;
		restante: number;
		por: string | null;
		observaciones: string | null;
	}[];
	movimientos: {
		id: string;
		tipo: TipoMovimientoFondo;
		fecha: string;
		detalle: string;
		entra: number;
		sale: number;
		saldo_antes: number;
		saldo_despues: number;
		registrado_por: string | null;
		observaciones: string | null;
	}[];
}

export const viaticosFondoAPI = {
	consolidado: (params: { desde: string; hasta: string }) =>
		llamar<ConsolidadoFondo>(
			apiClient.get('/api/viaticos/fondo/consolidado', { params }),
			'No se pudo armar el consolidado'
		),
	estado: () =>
		llamar<FondoViaticos>(
			apiClient.get('/api/viaticos/fondo'),
			'No se pudo consultar el saldo del área'
		),
	registrarSaldo: (input: { valor: number; observaciones?: string | null }) =>
		llamar<FondoViaticos>(
			apiClient.post('/api/viaticos/fondo/recargas', input),
			'No se pudo registrar el saldo'
		),
	corregir: (input: { valor: number; observaciones: string }) =>
		llamar<FondoViaticos>(
			apiClient.post('/api/viaticos/fondo/ajustes', input),
			'No se pudo corregir el saldo'
		),
	editarMovimiento: (id: string, input: { valor: number; observaciones: string | null }) =>
		llamar<FondoViaticos>(
			apiClient.patch(`/api/viaticos/fondo/movimientos/${id}`, input),
			'No se pudo editar el movimiento'
		),
	cerrarCorte: (input: { observaciones?: string | null }) =>
		llamar<FondoViaticos>(
			apiClient.post('/api/viaticos/fondo/cierres', input),
			'No se pudo cerrar el corte'
		)
};
