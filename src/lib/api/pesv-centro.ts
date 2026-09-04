/**
 * Cliente del centro de cumplimiento PESV.
 *
 * Aparte de `pesv.ts`, que sirve al panel heredado. Los dos coexisten durante
 * la transición: retirar el primero ahora dejaría muda la tabla de registros
 * diarios que la gente usa hoy.
 *
 * Todas las funciones devuelven el `data` ya desenvuelto. El backend responde
 * `{ success, data }` y arrastrar ese sobre hasta los componentes obligaría a
 * escribir `.data.data` en cada pantalla.
 */

import { apiClient } from './apiClient';
import type {
	CatalogoPesv,
	CicloPesv,
	DetallePaso,
	EvidenciaBandeja,
	FichaIndicador,
	FilaConciliacion,
	FormacionPesv,
	InformeImportacion,
	MetaPesv,
	PermisosPesv,
	PeriodoIndicador,
	ProgramaPesv,
	RespuestaCobertura,
	RespuestaCumplimiento,
	RespuestaDocumentos,
	RespuestaOperacion,
	ResultadoIndicador,
	ResumenPesv,
	RiesgoPesv
} from '$lib/types/pesv-centro';

const BASE = '/api/pesv/centro';

interface Sobre<T> {
	success: boolean;
	data: T;
}

/** Filtros de período que casi todos los endpoints aceptan. */
export interface FiltrosPeriodo {
	anio?: number;
	trimestre?: number | null;
	mes?: number | null;
}

/**
 * Construye el query string.
 *
 * Omite `null`, `undefined` y cadena vacía: un `?mes=` vacío llegaría al
 * backend como el string `''`, que no es un mes y tampoco es su ausencia.
 */
function query(params: Record<string, string | number | boolean | null | undefined>): string {
	const sp = new URLSearchParams();
	for (const [clave, valor] of Object.entries(params)) {
		if (valor === null || valor === undefined || valor === '') continue;
		sp.set(clave, String(valor));
	}
	const s = sp.toString();
	return s ? `?${s}` : '';
}

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
	const respuesta = await apiClient.get<Sobre<T>>(url, { signal });
	return respuesta.data.data;
}

async function post<T>(url: string, cuerpo?: unknown): Promise<T> {
	const respuesta = await apiClient.post<Sobre<T>>(url, cuerpo ?? {});
	return respuesta.data.data;
}

async function patch<T>(url: string, cuerpo: unknown): Promise<T> {
	const respuesta = await apiClient.patch<Sobre<T>>(url, cuerpo);
	return respuesta.data.data;
}

// ─────────────────────────────────────────────────────────────────────────
//  Catálogo y permisos
// ─────────────────────────────────────────────────────────────────────────

export const obtenerCatalogo = (signal?: AbortSignal) =>
	get<CatalogoPesv>(`${BASE}/catalogo`, signal);

export const obtenerPermisos = (signal?: AbortSignal) =>
	get<PermisosPesv>(`${BASE}/permisos`, signal);

// ─────────────────────────────────────────────────────────────────────────
//  Resumen
// ─────────────────────────────────────────────────────────────────────────

export const obtenerResumen = (f: FiltrosPeriodo, signal?: AbortSignal) =>
	get<ResumenPesv>(`${BASE}/resumen${query({ ...f })}`, signal);

// ─────────────────────────────────────────────────────────────────────────
//  Ciclos
// ─────────────────────────────────────────────────────────────────────────

export const listarCiclos = (signal?: AbortSignal) => get<CicloPesv[]>(`${BASE}/ciclos`, signal);

export const crearCiclo = (datos: {
	anio: number;
	liderId?: string | null;
	liderNombre?: string | null;
	liderCargo?: string | null;
	diasPorVencer?: number;
}) => post<CicloPesv>(`${BASE}/ciclos`, datos);

export const actualizarCiclo = (
	id: string,
	datos: Partial<CicloPesv> & { diasPorVencer?: number }
) => patch<CicloPesv>(`${BASE}/ciclos/${id}`, datos);

export const cerrarCiclo = (id: string) => post<CicloPesv>(`${BASE}/ciclos/${id}/cerrar`);

// ─────────────────────────────────────────────────────────────────────────
//  Matriz de los 24 pasos
// ─────────────────────────────────────────────────────────────────────────

export interface FiltrosCumplimiento extends FiltrosPeriodo {
	fase?: string;
	estado?: string;
	area?: string;
	responsable?: string;
	q?: string;
}

export const obtenerCumplimiento = (f: FiltrosCumplimiento, signal?: AbortSignal) =>
	get<RespuestaCumplimiento>(`${BASE}/cumplimiento${query({ ...f })}`, signal);

export const obtenerDetallePaso = (paso: number, anio: number, signal?: AbortSignal) =>
	get<DetallePaso>(`${BASE}/cumplimiento/${paso}${query({ anio })}`, signal);

export const actualizarRequisito = (
	paso: number,
	anio: number,
	cambio: {
		estado?: string;
		areaResponsable?: string | null;
		responsableId?: string | null;
		fechaLimite?: string | null;
		justificacion?: string | null;
		notas?: string | null;
	}
) => patch<unknown>(`${BASE}/cumplimiento/${paso}${query({ anio })}`, cambio);

// ─────────────────────────────────────────────────────────────────────────
//  Evidencias
// ─────────────────────────────────────────────────────────────────────────

export interface FiltrosEvidencias {
	anio: number;
	estado?: string;
	paso?: number;
	area?: string;
	/** `true` = solo las que aportó el usuario en sesión («mis pendientes»). */
	mias?: boolean;
}

export const listarEvidencias = (f: FiltrosEvidencias, signal?: AbortSignal) =>
	get<EvidenciaBandeja[]>(`${BASE}/evidencias${query({ ...f })}`, signal);

export const firmarSubida = (datos: {
	requirementId: string;
	nombreArchivo: string;
	mimeType: string;
	sizeBytes: number;
	sha256: string;
}) =>
	post<{ objectKey: string; uploadUrl: string; checksumSha256: string; expiraEnSegundos: number }>(
		`${BASE}/evidencias/presign`,
		datos
	);

export const crearEvidencia = (datos: Record<string, unknown>) =>
	post<{ id: string }>(`${BASE}/evidencias`, datos);

export const revisarEvidencia = (
	id: string,
	decision: 'APROBADO' | 'RECHAZADO',
	observacion?: string
) => patch<unknown>(`${BASE}/evidencias/${id}/revision`, { decision, observacion });

export const descargarEvidencia = (id: string) =>
	get<{ url: string; nombreArchivo: string | null }>(`${BASE}/evidencias/${id}/descarga`);

export const retirarEvidencia = async (id: string) => {
	const respuesta = await apiClient.delete<Sobre<unknown>>(`${BASE}/evidencias/${id}`);
	return respuesta.data.data;
};

/**
 * Sube el archivo directo a S3 con la URL firmada.
 *
 * El `PUT` NO pasa por la API: va del navegador a S3. Y el checksum **no** se
 * reenvía como cabecera — viaja firmado en el query string, y añadirlo como
 * `x-amz-checksum-sha256` haría que S3 rechazara la petición entera por
 * cabecera no firmada.
 *
 * Si esto falla, mira el **CORS del bucket** antes que la firma: un preflight
 * rechazado hace que `fetch` lance sin llegar a AWS, y en DevTools se ve igual
 * que un problema de firma.
 */
export async function subirArchivoAS3(uploadUrl: string, archivo: File): Promise<void> {
	const respuesta = await fetch(uploadUrl, {
		method: 'PUT',
		body: archivo,
		headers: { 'Content-Type': archivo.type }
	});
	if (!respuesta.ok) {
		throw new Error(
			`La subida a S3 falló con ${respuesta.status}. Si el navegador no llegó a enviar la petición, revise la regla CORS de PUT del bucket.`
		);
	}
}

/** SHA-256 hexadecimal del archivo, con la API del navegador. */
export async function sha256DelArchivo(archivo: File): Promise<string> {
	const buffer = await archivo.arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// ─────────────────────────────────────────────────────────────────────────
//  Indicadores
// ─────────────────────────────────────────────────────────────────────────

export const obtenerIndicadores = (f: FiltrosPeriodo, signal?: AbortSignal) =>
	get<{
		periodo: PeriodoIndicador;
		ciclo: { id: string; anio: number; nivel: string } | null;
		indicadores: ResultadoIndicador[];
		fechaCorte: string;
	}>(`${BASE}/indicadores${query({ ...f })}`, signal);

export const obtenerIndicador = (codigo: string, f: FiltrosPeriodo, signal?: AbortSignal) =>
	get<{ ficha: FichaIndicador; resultado: ResultadoIndicador }>(
		`${BASE}/indicadores/${codigo}${query({ ...f })}`,
		signal
	);

// ─────────────────────────────────────────────────────────────────────────
//  Metas, riesgos, programas, formación
// ─────────────────────────────────────────────────────────────────────────

export const listarMetas = (anio: number, signal?: AbortSignal) =>
	get<MetaPesv[]>(`${BASE}/metas${query({ anio })}`, signal);

export const crearMeta = (datos: Record<string, unknown>) => post<MetaPesv>(`${BASE}/metas`, datos);

export const actualizarMeta = (id: string, datos: Record<string, unknown>) =>
	patch<MetaPesv>(`${BASE}/metas/${id}`, datos);

export const listarRiesgos = (anio: number, signal?: AbortSignal) =>
	get<RiesgoPesv[]>(`${BASE}/riesgos${query({ anio })}`, signal);

export const crearRiesgo = (datos: Record<string, unknown>) =>
	post<RiesgoPesv>(`${BASE}/riesgos`, datos);

export const actualizarRiesgo = (id: string, datos: Record<string, unknown>) =>
	patch<RiesgoPesv>(`${BASE}/riesgos/${id}`, datos);

export const listarProgramas = (anio: number, signal?: AbortSignal) =>
	get<ProgramaPesv[]>(`${BASE}/programas${query({ anio })}`, signal);

export const crearPrograma = (datos: Record<string, unknown>) =>
	post<ProgramaPesv>(`${BASE}/programas`, datos);

export const cubrirVehiculos = (
	programaId: string,
	vehiculos: Array<{ vehiculoId: string; mecanismo?: string | null }>
) => post<unknown>(`${BASE}/programas/${programaId}/vehiculos`, { vehiculos });

export const listarFormaciones = (anio: number, signal?: AbortSignal) =>
	get<FormacionPesv[]>(`${BASE}/formacion${query({ anio })}`, signal);

export const crearFormacion = (datos: Record<string, unknown>) =>
	post<FormacionPesv>(`${BASE}/formacion`, datos);

export const vincularAsistencia = (id: string, datos: Record<string, unknown>) =>
	post<FormacionPesv>(`${BASE}/formacion/${id}/asistencia`, datos);

// ─────────────────────────────────────────────────────────────────────────
//  Operación segura
// ─────────────────────────────────────────────────────────────────────────

export const obtenerOperacion = (f: FiltrosPeriodo, signal?: AbortSignal) =>
	get<RespuestaOperacion>(`${BASE}/operacion${query({ ...f })}`, signal);

export const crearSiniestro = (datos: Record<string, unknown>) =>
	post<unknown>(`${BASE}/siniestros`, datos);

export const actualizarSiniestro = (id: string, datos: Record<string, unknown>) =>
	patch<unknown>(`${BASE}/siniestros/${id}`, datos);

export const registrarEventoVelocidad = (datos: Record<string, unknown>) =>
	post<unknown>(`${BASE}/velocidad`, datos);

export const crearPlanMantenimiento = (datos: Record<string, unknown>) =>
	post<unknown>(`${BASE}/mantenimiento/planes`, datos);

export const crearEventoMantenimiento = (datos: Record<string, unknown>) =>
	post<unknown>(`${BASE}/mantenimiento/eventos`, datos);

export const ejecutarMantenimiento = (id: string, datos: Record<string, unknown>) =>
	post<unknown>(`${BASE}/mantenimiento/eventos/${id}/ejecutar`, datos);

// ─────────────────────────────────────────────────────────────────────────
//  Documentos
// ─────────────────────────────────────────────────────────────────────────

export interface FiltrosDocumentos {
	ambito?: string;
	tipo?: string;
	estadoVigencia?: string;
	estadoRevision?: string;
	conductor?: string;
	vehiculo?: string;
	q?: string;
}

export const obtenerDocumentos = (f: FiltrosDocumentos, signal?: AbortSignal) =>
	get<RespuestaDocumentos>(`${BASE}/documentos${query({ ...f })}`, signal);

export const normalizarDocumento = (id: string, datos: Record<string, unknown>) =>
	patch<unknown>(`${BASE}/documentos/${id}`, datos);

export const revisarDocumento = (
	id: string,
	decision: 'APROBADO' | 'RECHAZADO',
	observacion?: string
) => patch<unknown>(`${BASE}/documentos/${id}/revision`, { decision, observacion });

export const configurarTipoDocumento = (tipo: string, datos: Record<string, unknown>) =>
	patch<unknown>(`${BASE}/documentos/tipos/${tipo}`, datos);

// ─────────────────────────────────────────────────────────────────────────
//  Contratos y FUEC
// ─────────────────────────────────────────────────────────────────────────

export interface FiltrosCobertura extends FiltrosPeriodo {
	estado?: string;
	cliente?: string;
	vehiculo?: string;
	desde?: string;
	hasta?: string;
}

export const obtenerCoberturaFuec = (f: FiltrosCobertura, signal?: AbortSignal) =>
	get<RespuestaCobertura>(`${BASE}/cobertura-fuec${query({ ...f })}`, signal);

export const listarContratos = (f: { q?: string; estado?: string }, signal?: AbortSignal) =>
	get<unknown[]>(`${BASE}/contratos${query({ ...f })}`, signal);

export const listarFuec = (f: { q?: string; estado?: string }, signal?: AbortSignal) =>
	get<unknown[]>(`${BASE}/fuec${query({ ...f })}`, signal);

export const vincularServicio = (
	servicioId: string,
	vinculo: { contratoId?: string | null; fuecId?: string | null }
) => post<unknown>(`${BASE}/servicios/${servicioId}/vinculo`, vinculo);

/**
 * Importa `extractos.txt`.
 *
 * Por defecto SIMULA. Hay que pasar `simulacion: false` a conciencia: es un
 * proceso que crea miles de filas y no debe dispararse por un clic distraído.
 */
export const importarExtractos = (opciones: { simulacion?: boolean; limite?: number } = {}) =>
	post<InformeImportacion>(`${BASE}/fuec/importar`, { simulacion: true, ...opciones });

export const listarConciliacion = (
	f: { motivo?: string; resuelto?: boolean } = {},
	signal?: AbortSignal
) => get<FilaConciliacion[]>(`${BASE}/fuec/conciliacion${query({ ...f })}`, signal);

export const resolverConciliacion = (id: string) =>
	post<unknown>(`${BASE}/fuec/conciliacion/${id}/resolver`);

// ─────────────────────────────────────────────────────────────────────────
//  Configuración y auditoría
// ─────────────────────────────────────────────────────────────────────────

export const listarPoliticasJornada = (signal?: AbortSignal) =>
	get<
		Array<{
			id: string;
			nombre: string;
			horas_maximas_conduccion: string | number;
			vigente_desde: string;
			vigente_hasta: string | null;
			fundamento: string | null;
		}>
	>(`${BASE}/jornada`, signal);

export const crearPoliticaJornada = (datos: Record<string, unknown>) =>
	post<unknown>(`${BASE}/jornada`, datos);

export const obtenerOpciones = (signal?: AbortSignal) =>
	get<{ vehiculos: Array<{ id: string; placa: string; etiqueta: string }> }>(
		`${BASE}/opciones`,
		signal
	);

export const listarAuditoria = (
	f: { entidad?: string; entidadId?: string; limite?: number } = {},
	signal?: AbortSignal
) =>
	get<
		Array<{
			id: string;
			entidad: string;
			entidad_id: string | null;
			accion: string;
			usuario_nombre: string | null;
			detalle_json: Record<string, unknown>;
			created_at: string;
		}>
	>(`${BASE}/auditoria${query({ ...f })}`, signal);

export const obtenerExpediente = (anio: number) =>
	get<Record<string, unknown>>(`${BASE}/expediente${query({ anio })}`);
