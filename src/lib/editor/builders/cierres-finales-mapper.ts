/**
 * Adapta la respuesta de `GET /liquidaciones-terceros-descuentos/:id` a lo
 * que espera `cierres-finales.builder.ts`.
 *
 * Existe como módulo aparte, y no dentro del builder, porque el builder es
 * PURO: recibe datos ya normalizados y devuelve la hoja. Meter aquí la
 * forma del endpoint lo ataría a la API y haría imposible probarlo con
 * datos sintéticos.
 *
 * Lo que resuelve, y que no es obvio:
 *
 *  · Cada item del pivote envuelve un `liquidacion_tercero` con los
 *    importes; el pivote solo aporta el id, el orden y `aplica_impuestos`.
 *    Aplanarlo aquí evita que el builder tenga que saberlo.
 *  · Los items soft-deleted vienen incluidos (el editor antiguo los pinta
 *    tachados para poder restaurarlos). En el canvas no se muestran.
 *  · El mapa de propietarios usa la clave `0::conductorId`. Guardarlo por
 *    `conductorId` a secas es el bug H6 del plan: la exclusión de
 *    propietarios en DOTACION y EXAMEN_MEDICO no se aplicaba nunca.
 */

import type { ConceptoDescuento } from '$lib/api/liquidaciones-terceros-descuentos';
import {
	claveConductor,
	type AdicionalCierre,
	type CierreFinalCompleto,
	type CopropietarioCierre,
	type ItemCierre
} from './cierres-finales.builder';
import { ordenAlfabetico, type CierreHoja } from './cierres-finales-identidad';

function num(v: any): number {
	if (v == null) return 0;
	const n = Number(v);
	return isNaN(n) ? 0 : n;
}

function txt(v: any): string {
	return v == null ? '' : String(v);
}

/** Fila del índice del periodo a partir del detalle completo. */
function hojaDeDetalle(d: any): CierreHoja {
	const tercero_nombre = txt(d.tercero?.nombre_completo);
	return {
		id: d.id,
		consecutivo: txt(d.consecutivo),
		placa: txt(d.placa),
		tercero_id: d.tercero_id ?? null,
		tercero_nombre,
		estado: txt(d.estado) || 'BORRADOR',
		es_multi_propietario: d.es_multi_propietario === true,
		total_pagar: num(d.total_pagar),
		valor_liquidar: num(d.valor_liquidar),
		version: num(d.version) || 1,
		color_hoja: d.color_hoja ?? null,
		orden_alfabetico: ordenAlfabetico({
			placa: txt(d.placa),
			tercero_nombre,
			consecutivo: txt(d.consecutivo)
		}),
		copropietarios: Array.isArray(d.propietarios) ? d.propietarios.length : 0
	};
}

function itemsDeDetalle(d: any): ItemCierre[] {
	return (Array.isArray(d.items) ? d.items : [])
		// Los soft-deleted SÍ entran, marcados como `excluido`. Descartarlos
		// haría que un item excluido desapareciera de la hoja y no hubiera
		// forma de restaurarlo sin regenerar el borrador entero.
		.filter((it: any) => it.liquidacion_tercero)
		.map((it: any): ItemCierre => {
			const lt = it.liquidacion_tercero;
			return {
				pivoteId: it.id,
				liquidacion_servicio_consecutivo: txt(lt.liquidacion?.consecutivo),
				cliente_nombre: txt(lt.liquidacion?.cliente?.nombre),
				placa: txt(lt.placa || d.placa),
				tercero_nombre: txt(lt.tercero?.nombre_completo || d.tercero?.nombre_completo),
				recorrido: txt(lt.recorrido),
				fechas: txt(lt.fechas),
				valor_unitario: num(lt.valor_unitario),
				cantidad: num(lt.cantidad),
				porcentaje_admin: num(lt.porcentaje_admin),
				valor_admin: num(lt.valor_admin),
				total_facturado: num(lt.total_facturado),
				valor_liquidar: num(lt.valor_liquidar),
				numero_planilla: txt(lt.numero_planilla),
				ingreso_extra_global: num(lt.ingreso_extra_global),
				ingresos_extra_aval: num(lt.ingresos_extra_aval),
				numero_factura: txt(it.facturas),
				// `!== false`, no `=== true`: los items antiguos tienen el
				// campo a NULL y el servidor los cuenta como marcados. Usar
				// `=== true` los mostraría como excluidos de la base imponible
				// cuando en realidad sí entran.
				aplica_impuestos: it.aplica_impuestos !== false,
				excluido: !!it.deleted_at
			};
		});
}

function adicionalesDeDetalle(d: any): AdicionalCierre[] {
	return (Array.isArray(d.items_adicionales) ? d.items_adicionales : []).map(
		(a: any, i: number): AdicionalCierre => ({
			// El JSONB de respaldo no tiene id; se sintetiza uno posicional para
			// poder pintarlo. Esas filas NO son editables desde el canvas —no
			// hay a qué hacerles compare-and-swap—, y el builder las marca como
			// derivadas por no traer `version`.
			id: txt(a.id) || `jsonb-${d.id}-${i}`,
			cliente: txt(a.cliente),
			placa: txt(a.placa || d.placa),
			tercero_nombre: a.tercero_nombre ?? null,
			recorrido: a.recorrido ?? null,
			fechas: a.fechas ?? null,
			valor_unitario: num(a.valor_unitario),
			cantidad: num(a.cantidad) || 1,
			porcentaje_admin: num(a.porcentaje_admin),
			valor_admin: num(a.valor_admin),
			valor_liquidar: num(a.valor_liquidar),
			aplica_impuestos: a.aplica_impuestos !== false,
			version: num(a.version) || 1
		})
	);
}

function copropietariosDeDetalle(d: any): CopropietarioCierre[] {
	return (Array.isArray(d.propietarios) ? d.propietarios : []).map(
		(p: any): CopropietarioCierre => ({
			id: p.id,
			nombre: txt(p.nombre || p.tercero?.nombre_completo),
			identificacion: p.identificacion ?? p.tercero?.identificacion ?? null,
			porcentaje: num(p.porcentaje)
		})
	);
}

/**
 * Mapa `0::conductorId` → es propietario.
 *
 * Combina la auto-detección del servidor con los overrides manuales del
 * cierre. El override gana: es la decisión explícita del usuario.
 */
function propietariosDeDetalle(d: any): Record<string, boolean> {
	const out: Record<string, boolean> = {};

	for (const c of (Array.isArray(d.conceptos) ? d.conceptos : []) as any[]) {
		if (!c.conductor_id) continue;
		if (c.conductor?.es_propietario != null) {
			out[claveConductor(c.conductor_id)] = c.conductor.es_propietario === true;
		}
	}

	const overrides = (d.es_propietario_overrides ?? {}) as Record<string, any>;
	for (const [clave, valor] of Object.entries(overrides)) {
		// La columna ha convivido con DOS formatos de clave y hay que aceptar
		// los dos:
		//
		//  · El editor tabular guardaba el `conductorId` CRUDO. Convertirlo a
		//    la clave del cálculo es lo que el canvas antiguo no hacía
		//    (hallazgo H6) y por eso la exclusión no se aplicaba nunca.
		//  · El endpoint de conductores del canvas guarda ya la clave con
		//    prefijo. Volver a prefijarla la dejaba en `0::0::id`, así que el
		//    propietario recién marcado aparecía SIN marcar en el modal y la
		//    hoja le imputaba dotación y examen médico.
		out[clave.startsWith('0::') ? clave : claveConductor(clave)] = valor === true;
	}

	return out;
}

/** Detalle de la API → entrada del builder. */
export function aCierreCompleto(detalle: any): CierreFinalCompleto {
	return {
		hoja: hojaDeDetalle(detalle),
		items: itemsDeDetalle(detalle),
		adicionales: adicionalesDeDetalle(detalle),
		conceptos: (Array.isArray(detalle.conceptos)
			? detalle.conceptos
			: []) as ConceptoDescuento[],
		copropietarios: copropietariosDeDetalle(detalle),
		propietarios: propietariosDeDetalle(detalle)
	};
}

/**
 * Fusiona la fila del índice (`listarPeriodo`) sobre el detalle.
 *
 * El índice es la fuente de verdad del ORDEN y del estado: lo calcula el
 * servidor con la misma clave para todos los clientes. El detalle puede
 * traer un `orden_alfabetico` reconstruido aquí que, si las reglas
 * divergieran, colocaría la hoja en un sitio distinto al de los demás.
 */
export function conHojaDelIndice(
	completo: CierreFinalCompleto,
	hoja: CierreHoja | undefined
): CierreFinalCompleto {
	return hoja ? { ...completo, hoja } : completo;
}
