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
	if (n.tipo.startsWith('FACTURA_')) return { url: '/dashboard/liquidaciones-servicios?tab=facturas' };
	if (n.tipo.startsWith('LIQUIDACION_')) return { url: '/dashboard/liquidaciones-servicios' };
	return null;
}
