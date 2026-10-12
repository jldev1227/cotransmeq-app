/**
 * A qué pantalla lleva una notificación.
 *
 * Vive aparte (sin `$app/*`) porque la usan dos sitios que no comparten
 * contexto: la campana del Header, que navega con `goto`, y el service worker,
 * que abre la ventana al pulsar el aviso del sistema operativo. Si cada uno
 * tuviera su copia, un tipo nuevo acabaría llevando a sitios distintos según
 * por dónde se abra.
 */

export interface NotificacionNavegable {
	tipo: string;
	referencia_id?: string | null;
	referencia_tipo?: string | null;
}

export interface RutaNotificacion {
	url: string;
	/**
	 * Recarga completa en vez de `goto`: el canvas de nómina conserva su caché
	 * si ya estaba abierto y seguiría mostrando el PDF anterior a la firma.
	 */
	recargaCompleta?: boolean;
}

export function rutaDeNotificacion(n: NotificacionNavegable): RutaNotificacion | null {
	const ref = n.referencia_tipo ?? '';
	const id = n.referencia_id;
	if (!id) return null;

	if (ref === 'servicio') return { url: `/dashboard/servicios/${id}` };
	if (ref.startsWith('nomina_desprendible_firmado')) {
		const [, anio, mes, desde] = ref.split(':');
		const params = new URLSearchParams({ liquidacion: id, preview: '1' });
		if (anio && mes && desde) {
			params.set('anio', anio);
			params.set('mes', mes);
			params.set('desde', desde);
		}
		return { url: `/dashboard/nomina/canvas?${params.toString()}`, recargaCompleta: true };
	}
	if (ref === 'preoperacional') return { url: `/dashboard/formularios/envios/${id}` };
	/// Preoperacional con ítems en «Malo», para mantenimiento: abre las novedades
	/// en su propia pantalla, porque el envío completo es del módulo `formularios`,
	/// que el área mantenimiento no tiene (desde allí salta quien sí lo tiene).
	if (ref === 'preop_malo') return { url: `/dashboard/mantenimiento?preoperacional=${id}` };
	/// Plan de mantenimiento vencido o próximo (`mant:<estado>:<km>:<fecha>`):
	/// la referencia es el plan.
	if (ref.startsWith('mant:')) return { url: `/dashboard/mantenimiento?plan=${id}` };
	if (ref.startsWith('dias_laborados:')) {
		/// Recorridos del conductor ese día (`dias_laborados:<fecha>`, la referencia es el conductor).
		const fecha = ref.split(':')[1];
		const params = new URLSearchParams({ desde: fecha, hasta: fecha, conductor: id });
		return { url: `/dashboard/conductores/recorridos?${params.toString()}` };
	}
	if (ref === 'viatico_anticipo') return { url: `/dashboard/viaticos?anticipo=${id}` };
	if (ref === 'viatico_solicitud') return { url: `/dashboard/viaticos?solicitud=${id}` };
	if (ref === 'solicitud_web') return { url: `/dashboard/solicitudes?solicitud=${id}` };
	if (ref === 'ACCION_CORRECTIVA') return { url: `/dashboard/acciones-correctivas/${id}` };
	/// Reporte de un incidente (`incidente`) y su recordatorio de los 15 días
	/// (`incidente_investigacion_pendiente`): la referencia es el incidente.
	if (ref === 'incidente' || ref === 'incidente_investigacion_pendiente')
		return { url: `/dashboard/incidentes/${id}` };
	/// Vencimiento de un documento del vehículo (`docveh:<categoría>:<vence>:<umbral>`):
	/// la referencia es el vehículo; abre su ficha en la pestaña Documentos.
	if (ref.startsWith('docveh:')) return { url: `/dashboard/flota?vehiculo=${id}&tab=documentos` };
	/// Lo mismo para el conductor (`doccond:<categoría>:<vence>:<umbral>`): la
	/// referencia es el conductor; abre su ficha en la pestaña Documentos.
	if (ref.startsWith('doccond:')) return { url: `/dashboard/conductores/${id}?tab=documentos` };
	if (n.tipo.startsWith('FACTURA_'))
		return { url: '/dashboard/liquidaciones-servicios?tab=facturas' };
	if (n.tipo.startsWith('LIQUIDACION_')) return { url: '/dashboard/liquidaciones-servicios' };
	return null;
}
