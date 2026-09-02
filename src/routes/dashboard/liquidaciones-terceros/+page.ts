import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * El módulo ya no tiene listado propio: entra directo al canvas de CIERRES
 * FINALES del periodo en curso. El histórico paginado y el formulario manual
 * de "Nueva liquidación" que vivían aquí eran la capa pre-Univer; los cierres
 * ahora se generan desde el propio canvas con "Generar borradores".
 *
 * Universal (`+page.ts`) y no `+page.server.ts` para que el clic del sidebar
 * sea navegación de cliente, sin round-trip. Y sin `ssr = false`: eso obligaría
 * a cargar el shell entero antes de rebotar.
 */

/**
 * Periodo "actual" en la zona horaria de la operación.
 *
 * Este load corre en el servidor (UTC) en la carga en frío y en el navegador
 * (UTC-5) en las navegaciones de cliente. Sin fijar la zona, el último día del
 * mes a partir de las 19:00 de Colombia el servidor diría "mes siguiente" y el
 * cliente "mes actual" para la MISMA url.
 */
function periodoActualBogota(): { anio: number; mes: number } {
	const partes = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/Bogota',
		year: 'numeric',
		month: 'numeric'
	}).formatToParts(new Date());
	return {
		anio: Number(partes.find((p) => p.type === 'year')?.value),
		mes: Number(partes.find((p) => p.type === 'month')?.value)
	};
}

/// Compat de marcadores: `?tab=` apuntaba a pestañas del listado difunto.
/// `nueva|formulario|nuevo` abría el formulario, que ya no existe, así que cae
/// por defecto en el canvas de cierres.
const DESTINO_POR_TAB: Record<string, string> = {
	mensual: 'ocasional/canvas',
	ocasional: 'ocasional/canvas',
	adicionales: 'adicionales/canvas',
	ingresos: 'ingresos/canvas'
};

export const load: PageLoad = ({ url }) => {
	const actual = periodoActualBogota();

	// Si el enlace ya traía periodo, se respeta; si no, el de hoy.
	const anio = Number(url.searchParams.get('anio')) || actual.anio;
	const mesPedido = Number(url.searchParams.get('mes'));
	const mes = mesPedido >= 1 && mesPedido <= 12 ? mesPedido : actual.mes;

	const destino = DESTINO_POR_TAB[url.searchParams.get('tab') ?? ''] ?? 'canvas';

	// 307 y no 301/308: el destino depende de la fecha de hoy, un redirect
	// permanente lo dejaría cacheado en el navegador para siempre.
	// Ruta ABSOLUTA: `./canvas` se resolvería contra `/dashboard/` y daría 404.
	redirect(307, `/dashboard/liquidaciones-terceros/${destino}?anio=${anio}&mes=${mes}`);
};
