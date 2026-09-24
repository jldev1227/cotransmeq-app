/**
 * Puente entre el canvas de nómina y el generador del desprendible.
 *
 * El canvas trabaja con `HojaNominaDTO` —lo que arma el servicio del periodo—
 * pero el desprendible se genera desde `pdfDesprendible.ts`, que espera la
 * `Liquidacion` completa con sus recargos, bonos, pernotes y firmas. Esto
 * reúne esas piezas y llama al generador.
 *
 * POR QUÉ NO HAY UNA SEGUNDA MAQUETA. La vista previa del canvas, su
 * exportación a PDF, el ZIP, el portal del conductor y la descarga del
 * dashboard salen TODOS de `pdfDesprendible.ts`. Cualquier documento paralelo
 * —por bonito que fuera— acabaría divergiendo, y el mismo mes tendría dos
 * desprendibles distintos según por dónde se imprimiera.
 *
 * El precio es que hay que pedir la liquidación completa por cada conductor;
 * de ahí la caché y el ritmo secuencial del ZIP.
 */
import { obtenerLiquidacionPorId, obtenerFirmasPorLiquidacion } from '$lib/api/nomina';
import { nominaBorradoresAPI } from '$lib/api/nomina-canvas';
import {
	generarPdfDesprendible,
	generarBlobDesprendible
} from '$lib/utils/pdfDesprendible';

export interface DatosDesprendible {
	liquidacion: any;
	firmas: any[];
	recargosData: any;
}

/**
 * Caché por liquidación durante la sesión del canvas.
 *
 * Sin ella, ver la vista previa y luego exportar el ZIP pediría lo mismo dos
 * veces, y el ZIP de treinta conductores son noventa peticiones.
 */
const cache = new Map<string, DatosDesprendible>();

export function limpiarCacheDesprendibles(): void {
	cache.clear();
}

/** Todo lo que `pdfDesprendible` necesita para una liquidación. */
export async function cargarDatosDesprendible(
	liquidacionId: string
): Promise<DatosDesprendible> {
	const enCache = cache.get(liquidacionId);
	if (enCache) return enCache;

	const respuesta = await obtenerLiquidacionPorId(liquidacionId);
	const liquidacion = (respuesta as any)?.data ?? respuesta;
	if (!liquidacion) throw new Error('No se pudo cargar la liquidación.');

	/**
	 * EL PERIODO SALE DE LA PROPIA LIQUIDACIÓN, no de la pantalla.
	 *
	 * Un corte 21→20 se nombra por el mes en que TERMINA —el 21-ago/20-sep es
	 * «septiembre»— y el día de corte es el del inicio. Derivarlo aquí evita
	 * arrastrar tres parámetros por toda la cadena, y sobre todo evita que el
	 * ZIP pida un conductor con el corte de otro.
	 */
	const fin = String(liquidacion.periodo_fin ?? liquidacion.periodo_end ?? '');
	const ini = String(liquidacion.periodo_inicio ?? liquidacion.periodo_start ?? '');
	const anio = Number(fin.slice(0, 4));
	const mes = Number(fin.slice(5, 7));
	const corte = Number(ini.slice(8, 10));

	// Las firmas y las tablas de recargo son OPCIONALES: sin firma el
	// desprendible sale sin ella, y sin tablas sale sin las páginas de
	// detalle. Ninguna de las dos debe impedir generar el documento.
	const [firmas, recargosData] = await Promise.all([
		obtenerFirmasPorLiquidacion(liquidacionId)
			.then((r: any) => r?.data ?? r ?? [])
			.catch(() => []),
		/**
		 * DESDE EL CANVAS, no desde las planillas.
		 *
		 * Antes llamaba a `obtenerPreviewRecargos`, que lee
		 * `recargos_planillas`. El canvas paga desde su copia del corte
		 * (`liquidaciones_dias`), que es la que se edita en la hoja, así que
		 * en cuanto alguien corregía una hora el comprobante contradecía al
		 * canvas: en WILSON, $1.056.277 impresos contra $1.381.964 pagados.
		 */
		Number.isInteger(anio) && Number.isInteger(mes)
			? nominaBorradoresAPI
					.desprendibleData(liquidacionId, { anio, mes, corte: corte || null })
					.catch(() => null)
			: Promise.resolve(null)
	]);

	const datos: DatosDesprendible = {
		liquidacion,
		firmas: Array.isArray(firmas) ? firmas : [],
		recargosData: { ...(recargosData ?? {}), planillas: recargosData?.planillas ?? [] }
	};
	cache.set(liquidacionId, datos);
	return datos;
}

/** Abre el desprendible en una pestaña. Es la vista previa Y la descarga. */
export async function abrirDesprendible(liquidacionId: string): Promise<void> {
	const { liquidacion, firmas, recargosData } = await cargarDatosDesprendible(liquidacionId);
	await generarPdfDesprendible(liquidacion, firmas, recargosData);
}

/** El mismo desprendible como Blob, para meterlo en el ZIP. */
export async function blobDesprendible(liquidacionId: string): Promise<Blob> {
	const { liquidacion, firmas, recargosData } = await cargarDatosDesprendible(liquidacionId);
	return generarBlobDesprendible(liquidacion, firmas, recargosData);
}
