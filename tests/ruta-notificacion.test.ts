/**
 * `rutaDeNotificacion`: a qué pantalla lleva cada aviso de la campana.
 *
 * Lo que fija es lo que se revisó a mano el 11-oct-2026 pulsando un aviso de
 * cada tipo: los que abren el registro concreto, los que solo pueden abrir una
 * pestaña, y los dos que estaban mal (la factura creada caía en la pestaña de
 * liquidaciones y el saldo del fondo de viáticos no llevaba a ningún sitio).
 */
import { describe, expect, it } from 'vitest';
import { rutaDeNotificacion } from '../src/lib/notificaciones/rutaNotificacion';

const ID = '11111111-2222-3333-4444-555555555555';

describe('rutaDeNotificacion', () => {
	it('sin referencia no navega', () => {
		expect(rutaDeNotificacion({ tipo: 'GENERAL', referencia_id: null })).toBeNull();
	});

	it('abre el registro al que apunta la referencia', () => {
		const casos: Array<[string, string]> = [
			['servicio', `/dashboard/servicios/${ID}`],
			['preoperacional', `/dashboard/formularios/envios/${ID}`],
			['solicitud_web', `/dashboard/solicitudes?solicitud=${ID}`],
			['ACCION_CORRECTIVA', `/dashboard/acciones-correctivas/${ID}`],
			['incidente', `/dashboard/incidentes/${ID}`],
			['incidente_investigacion_pendiente', `/dashboard/incidentes/${ID}`],
			['preop_malo', `/dashboard/mantenimiento?preoperacional=${ID}`],
			['mant:vencido:120000:2026-10-01', `/dashboard/mantenimiento?plan=${ID}`],
			['viatico_anticipo', `/dashboard/viaticos?anticipo=${ID}`],
			['viatico_solicitud', `/dashboard/viaticos?solicitud=${ID}`],
			['docveh:SOAT:2026-11-03:30', `/dashboard/flota?vehiculo=${ID}&tab=documentos`],
			['doccond:LICENCIA:2026-11-03:30', `/dashboard/conductores/${ID}?tab=documentos`]
		];
		for (const [referencia_tipo, url] of casos) {
			expect(
				rutaDeNotificacion({ tipo: 'GENERAL', referencia_id: ID, referencia_tipo })?.url,
				referencia_tipo
			).toBe(url);
		}
	});

	it('días laborados: los recorridos del conductor ese día', () => {
		expect(
			rutaDeNotificacion({
				tipo: 'GENERAL',
				referencia_id: ID,
				referencia_tipo: 'dias_laborados:2026-10-11'
			})?.url
		).toBe(`/dashboard/conductores/recorridos?desde=2026-10-11&hasta=2026-10-11&conductor=${ID}`);
	});

	it('desprendible firmado: el canvas de nómina con recarga completa', () => {
		const ruta = rutaDeNotificacion({
			tipo: 'GENERAL',
			referencia_id: ID,
			referencia_tipo: 'nomina_desprendible_firmado:2026:9:21'
		});
		expect(ruta?.url).toBe(
			`/dashboard/nomina/canvas?liquidacion=${ID}&preview=1&anio=2026&mes=9&desde=21`
		);
		expect(ruta?.recargaCompleta).toBe(true);
	});

	it('saldo bajo del fondo de viáticos: el resumen de viáticos', () => {
		expect(
			rutaDeNotificacion({ tipo: 'GENERAL', referencia_id: ID, referencia_tipo: 'viatico_fondo' })
				?.url
		).toBe('/dashboard/viaticos');
	});

	it('liquidación de servicios: la propia liquidación en modo lectura', () => {
		for (const tipo of [
			'LIQUIDACION_CREADA',
			'LIQUIDACION_PENDIENTE',
			'LIQUIDACION_ACTUALIZADA',
			'LIQUIDACION_ANULADA'
		]) {
			expect(rutaDeNotificacion({ tipo, referencia_id: ID })?.url, tipo).toBe(
				`/dashboard/liquidaciones-servicios/${ID}?mode=view`
			);
		}
	});

	it('factura con número: la pestaña Facturas filtrada por ese número', () => {
		for (const tipo of ['LIQUIDACION_FACTURADA', 'FACTURA_ANULADA']) {
			expect(
				rutaDeNotificacion({ tipo, referencia_id: ID, referencia_tipo: 'factura:4627' })?.url,
				tipo
			).toBe('/dashboard/liquidaciones-servicios?tab=facturas&busqueda=4627');
		}
	});

	it('factura sin número (avisos anteriores a la huella): la pestaña Facturas', () => {
		for (const tipo of ['LIQUIDACION_FACTURADA', 'FACTURA_ANULADA']) {
			expect(rutaDeNotificacion({ tipo, referencia_id: ID })?.url, tipo).toBe(
				'/dashboard/liquidaciones-servicios?tab=facturas'
			);
		}
	});

	it('actividad PESV: el módulo ya no existe, no navega', () => {
		expect(
			rutaDeNotificacion({
				tipo: 'ACTIVIDAD_PESV_ASIGNADA',
				referencia_id: ID,
				referencia_tipo: 'actividad_pesv'
			})
		).toBeNull();
	});
});
