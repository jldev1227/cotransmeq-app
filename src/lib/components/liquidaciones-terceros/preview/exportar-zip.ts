/**
 * Exportación de las hojas de un periodo, una por PDF, dentro de un ZIP.
 *
 * Cada hoja del canvas de cierres es un par placa-propietario, y cada una se
 * archiva por separado: se manda al propietario, se adjunta a su liquidación y
 * se guarda en su carpeta. Un único PDF de cuarenta hojas obliga a partirlo a
 * mano justo después de generarlo, que es el trabajo que esto existe para
 * evitar.
 *
 * La composición del HTML de cada hoja (montar `DocumentoHoja` fuera de la
 * vista y leer su marcado con layout) vive en `componer-hojas.ts`, compartida
 * con el envío por correo: ambos flujos deben producir exactamente el mismo
 * documento.
 */

import { liquidacionesTercerosCanvasPdfAPI } from '$lib/api/liquidaciones-terceros-canvas-pdf';
import { documentoCss } from './documento.css';
import { componerHojasHtml, type HojaAComponer } from './componer-hojas';
import type { ScopePreview } from './columnas';

export type HojaPdf = HojaAComponer;

export interface OpcionesZip {
	/** Progreso de la composición: cuarenta hojas no deben parecer un cuelgue. */
	onProgreso?: (hechas: number, total: number) => void;
	/**
	 * Columnas activas. Si se omite se usan las que el usuario dejó guardadas
	 * para ese canvas, que es lo que ve en el preview.
	 */
	seleccion?: string[];
}

export interface ResultadoZip {
	/** Hojas que llegaron al ZIP. */
	generados: number;
	/** Nombres de las que no se pudieron componer. */
	fallidas: string[];
}

/**
 * Compone las hojas y descarga el ZIP.
 *
 * Una hoja que falle NO aborta el resto: se anota en `fallidas` y se sigue. Con
 * cuarenta hojas, perder las treinta y nueve buenas por una mala sería el peor
 * resultado posible.
 */
export async function exportarZipPdfs(
	scope: ScopePreview,
	hojas: HojaPdf[],
	zipname: string,
	opciones: OpcionesZip = {}
): Promise<ResultadoZip> {
	if (hojas.length === 0) throw new Error('No hay hojas que exportar.');

	const { documentos, fallidas } = await componerHojasHtml(scope, hojas, opciones);

	if (documentos.length === 0) throw new Error('No se pudo componer ninguna hoja.');

	/// Escala 1 y con `@page`: estos SON los documentos impresos.
	const css = documentoCss(1, true);
	const blob = await liquidacionesTercerosCanvasPdfAPI.renderizarZip({ css, documentos, zipname });

	/// El ZIP se descarga y no se abre en una pestaña: el navegador no sabe
	/// mostrarlo, y lo que se quiere es el archivo en disco para repartir los PDF.
	const url = URL.createObjectURL(blob);
	const enlace = document.createElement('a');
	enlace.href = url;
	enlace.download = `${zipname}.zip`;
	document.body.appendChild(enlace);
	enlace.click();
	enlace.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);

	return { generados: documentos.length, fallidas };
}
