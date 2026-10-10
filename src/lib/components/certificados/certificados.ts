/**
 * Utilidades de la pantalla de certificados tributarios (dashboard).
 *
 * Los códigos de tipo llegan en mayúsculas desde la key de S3
 * (`RETEFUENTE`, `RETEICA`…); aquí se traducen a la etiqueta que lee el
 * usuario y se agrupan los archivos por año, que es como los busca
 * contabilidad («los de 2025 de este proveedor»).
 */
import type { TerceroWithCerts } from '$lib/api/certificadosTercero';

export type Certificado = TerceroWithCerts['certificados_archivo'][number];

const TIPOS: Record<string, string> = {
	RETEFUENTE: 'Retefuente',
	RETEICA: 'Reteica',
	RETEIVA: 'Reteiva',
	ICA: 'ICA',
	IVA: 'IVA',
	RETENCIONES: 'Retenciones',
	OTROS: 'Otros'
};

export function etiquetaTipo(codigo: string | null | undefined): string {
	if (!codigo) return 'Otros';
	return TIPOS[codigo] ?? codigo.charAt(0) + codigo.slice(1).toLowerCase();
}

export function tipoDe(c: Certificado): string {
	return c.tipo_certificado?.codigo || c.tipo;
}

/** Años de más reciente a más antiguo; dentro de cada uno, por tipo. */
export function agruparPorAnio(certs: Certificado[]): Array<[number, Certificado[]]> {
	const grupos = new Map<number, Certificado[]>();
	for (const c of certs) {
		if (!grupos.has(c.anio)) grupos.set(c.anio, []);
		grupos.get(c.anio)!.push(c);
	}
	return [...grupos.entries()]
		.sort(([a], [b]) => b - a)
		.map(([anio, lista]) => [anio, lista.sort((x, y) => tipoDe(x).localeCompare(tipoDe(y)))]);
}

/** «Retefuente 2025 · Reteica 2025»: resumen corto para la celda de la tabla. */
export function resumenCertificados(certs: Certificado[]): string[] {
	const vistos = new Set<string>();
	const etiquetas: string[] = [];
	for (const c of [...certs].sort((a, b) => b.anio - a.anio)) {
		const e = `${etiquetaTipo(tipoDe(c))} ${c.anio}`;
		if (!vistos.has(e)) {
			vistos.add(e);
			etiquetas.push(e);
		}
	}
	return etiquetas;
}

export function esImagen(filename: string): boolean {
	return /\.(png|jpe?g|gif|webp|avif)$/i.test(filename);
}

export function fechaHora(iso: string | null | undefined): string {
	if (!iso) return '—';
	return new Date(iso).toLocaleString('es-CO', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

export function fechaCorta(iso: string | null | undefined): string {
	if (!iso) return '—';
	return new Date(iso).toLocaleDateString('es-CO', {
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	});
}

/** Años que ofrece el importador: del actual hacia atrás, sin tope fijo. */
export function aniosImportables(desde = 2020): number[] {
	const actual = new Date().getFullYear();
	return Array.from({ length: actual - desde + 1 }, (_, i) => actual - i);
}

export function mensajeError(err: unknown, porDefecto: string): string {
	const e = err as { response?: { data?: { error?: string; details?: string } }; message?: string };
	return e?.response?.data?.error ?? e?.response?.data?.details ?? e?.message ?? porDefecto;
}
