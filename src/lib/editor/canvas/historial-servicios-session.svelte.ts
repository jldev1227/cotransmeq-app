/**
 * Sesión de tiempo real del canvas de HISTORIAL DE LIQUIDACIONES DE SERVICIOS.
 *
 * Junta dos protocolos que en este módulo estaban separados:
 *
 *  1. PRESENCIA (`sheet:join` / `sheet:leave` / `sheet:active` /
 *     `sheet:presence`), el mismo de los canvas de terceros. El room es
 *     global para el scope `servicios-historial` (ver `sheet-room-key.ts`):
 *     el filtro de año es una vista, no un libro distinto.
 *
 *  2. EVENTOS DE DOMINIO (`liquidacion-servicio-*`, `facturacion-*`), que el
 *     backend emite con `io.emit` a todo el mundo, sin room.
 *
 * ── Por qué no se usa `socketUtils` ──
 *
 * `src/lib/socket.ts` envuelve el callback en un wrapper de log cuando el
 * socket ya existe y guarda el WRAPPER en su registro, así que `off(evento,
 * callback)` con la referencia original NO desregistra nada. El canvas
 * anterior llamaba justo a ese `off` en `onDestroy`: cada visita a la página
 * dejaba un handler vivo sobre un canvas muerto. Aquí se usa `socketClient`
 * (socket crudo compartido) y se guarda la referencia exacta de cada
 * handler, igual que hace `sheet-session.svelte.ts`.
 *
 * ── Reconexión ──
 *
 * `socketClient` ya reintenta la conexión (10 intentos, backoff 1s→5s). Lo
 * que falta y aporta este módulo es lo que pasa DESPUÉS de reconectar: el
 * servidor perdió la membresía del room (hay que rehacer el join) y, sobre
 * todo, los eventos emitidos mientras no había red NO se reenvían — nadie
 * los almacena. Sin un re-sync, la hoja se queda con datos viejos y sin
 * ninguna señal de que lo está. Por eso cada reconexión dispara `onResync`.
 *
 * El primer `connect` NO dispara re-sync: la carga inicial ya trae los datos
 * frescos y recargarlos otra vez sería un viaje redundante en cada montaje.
 */

import type { Socket } from 'socket.io-client';
import { connectSocket } from '$lib/socketClient';
import { sheetRoomKey, type SheetScope } from './sheet-room-key';

const SCOPE: SheetScope = 'servicios-historial';

export interface HistorialPresenceUser {
	id: string;
	name: string;
	sheetId?: string | null;
	joinedAt: string;
}

/**
 * Cambio de estado/factura de UNA liquidación, ya normalizado.
 *
 * El backend manda formas distintas según el evento: `liquidacion-servicio-*`
 * lleva la entidad entera (salvo `deleted`, que manda solo `{ id }`), y
 * `liquidacion-servicio-facturada` lleva un parche de cuatro campos. La
 * sesión normaliza para que la página no tenga que distinguirlas.
 */
export interface CambioLiquidacion {
	id: string;
	estado?: string;
	factura_id?: string | null;
	numero_factura?: string | null;
	/** La entidad completa, si el evento la traía. */
	entidad?: any;
	actor: { id: string | null; nombre: string } | null;
	etiqueta: string;
}

export interface HistorialSessionOptions {
	user: { id: string; name: string };
	/** Año visible. Solo viaja en el join (el gateway lo valida); no parte el room. */
	anio: number;

	onPresence?: (users: HistorialPresenceUser[]) => void;
	/** Cambió el estado del socket. Alimenta el «Sin conexión» del header. */
	onConexion?: (conectado: boolean) => void;
	/**
	 * Hubo una RECONEXIÓN: los eventos del hueco se perdieron y hay que
	 * releer. Nunca se llama en la primera conexión.
	 */
	onResync?: (motivo: 'reconexion') => void;

	/** Alta de liquidación (incluye la restauración de una eliminada). */
	onLiquidacionCreada?: (c: CambioLiquidacion) => void;
	/** Edición o cambio de estado (liquidar, aprobar, anular, revertir). */
	onLiquidacionActualizada?: (c: CambioLiquidacion) => void;
	/** Soft-delete. El payload trae SOLO `{ id }`. */
	onLiquidacionEliminada?: (c: CambioLiquidacion) => void;
	/** Facturada o desfacturada: parche de estado + factura. */
	onLiquidacionFacturada?: (c: CambioLiquidacion) => void;

	onFacturaCreada?: (f: any, actor: CambioLiquidacion['actor']) => void;
	onFacturaActualizada?: (f: any, actor: CambioLiquidacion['actor']) => void;
	/** Anulación o soft-delete de factura (`tipo` distingue). */
	onFacturaAnulada?: (
		f: any,
		tipo: 'anulada' | 'deleted',
		actor: CambioLiquidacion['actor']
	) => void;

	/** Cambió algo en los ítems de terceros de una liquidación. */
	onTerceroActualizado?: (data: any) => void;
}

export interface HistorialSession {
	readonly presence: HistorialPresenceUser[];
	readonly conectado: boolean;
	/** Anuncia en qué hoja está el usuario (Liquidaciones/Facturas/Terceros). */
	setHojaActiva: (sheetId: string) => void;
	dispose: () => void;
}

/// Lee el sobre `_evento` que el backend adjunta a cada payload.
function meta(data: any): { actor: CambioLiquidacion['actor']; etiqueta: string; tipo?: string } {
	const ev = data?._evento;
	return {
		actor: ev?.actor ?? null,
		etiqueta: ev?.etiqueta ?? '',
		tipo: ev?.tipo
	};
}

export function createHistorialSession(opts: HistorialSessionOptions): HistorialSession {
	const roomKey = sheetRoomKey(SCOPE, opts.anio, null);
	const socket: Socket = connectSocket();

	let presence = $state<HistorialPresenceUser[]>([]);
	let conectado = $state(socket.connected);
	/// Distingue el primer `connect` de una reconexión. Sin esto, montar la
	/// página dispararía un re-sync inmediato sobre datos ya frescos.
	let huboConexionPrevia = socket.connected;
	let hojaActiva: string | null = null;

	// ── Presencia ──

	const onPresence = (data: any) => {
		if (data?.room !== roomKey) return;
		presence = Array.isArray(data.users) ? data.users : [];
		opts.onPresence?.(presence);
	};

	const join = () => {
		socket.emit('sheet:join', {
			scope: SCOPE,
			anio: opts.anio,
			mes: null,
			sheet_id: hojaActiva,
			user: opts.user
		});
	};

	// ── Eventos de dominio ──

	const onCreada = (data: any) => {
		if (!data?.id) return;
		const m = meta(data);
		opts.onLiquidacionCreada?.({
			id: data.id,
			estado: data.estado,
			entidad: data,
			actor: m.actor,
			etiqueta: m.etiqueta
		});
	};

	const onActualizada = (data: any) => {
		if (!data?.id) return;
		const m = meta(data);
		opts.onLiquidacionActualizada?.({
			id: data.id,
			estado: data.estado,
			entidad: data,
			actor: m.actor,
			etiqueta: m.etiqueta
		});
	};

	const onEliminada = (data: any) => {
		if (!data?.id) return;
		const m = meta(data);
		// OJO: este payload trae SOLO `{ id }` (más el sobre). Cualquier
		// consumidor que espere la entidad completa se rompe aquí.
		opts.onLiquidacionEliminada?.({ id: data.id, actor: m.actor, etiqueta: m.etiqueta });
	};

	const onFacturada = (data: any) => {
		if (!data?.id) return;
		const m = meta(data);
		opts.onLiquidacionFacturada?.({
			id: data.id,
			estado: data.estado,
			factura_id: data.factura_id ?? null,
			numero_factura: data.numero_factura ?? null,
			actor: m.actor,
			etiqueta: m.etiqueta
		});
	};

	const onFacturaCreada = (data: any) => {
		if (!data?.id) return;
		opts.onFacturaCreada?.(data, meta(data).actor);
	};

	const onFacturaActualizada = (data: any) => {
		if (!data?.id) return;
		opts.onFacturaActualizada?.(data, meta(data).actor);
	};

	const onFacturaAnulada = (data: any) => {
		if (!data?.id) return;
		const m = meta(data);
		// `facturacion-anulada` cubre DOS cosas: anular (entidad completa) y
		// eliminar (solo `{ id }`). El sobre es lo único que las distingue.
		opts.onFacturaAnulada?.(data, m.tipo === 'deleted' ? 'deleted' : 'anulada', m.actor);
	};

	const onTercero = (data: any) => {
		opts.onTerceroActualizado?.(data);
	};

	// ── Conexión ──

	const onConnect = () => {
		conectado = true;
		opts.onConexion?.(true);
		join();
		if (huboConexionPrevia) {
			// Los eventos emitidos mientras no había red no se reenvían: la
			// única forma de volver a un estado correcto es releer.
			opts.onResync?.('reconexion');
		}
		huboConexionPrevia = true;
	};

	const onDisconnect = () => {
		conectado = false;
		presence = [];
		opts.onPresence?.(presence);
		opts.onConexion?.(false);
	};

	// `off` antes de `on`: si la sesión se recrea sin pasar por `dispose`
	// (cambio de año, retry de carga), no queremos handlers duplicados
	// procesando cada evento N veces.
	const bind = (evento: string, handler: (...a: any[]) => void) => {
		socket.off(evento, handler);
		socket.on(evento, handler);
	};

	bind('sheet:presence', onPresence);
	bind('liquidacion-servicio-created', onCreada);
	bind('liquidacion-servicio-updated', onActualizada);
	bind('liquidacion-servicio-deleted', onEliminada);
	bind('liquidacion-servicio-facturada', onFacturada);
	bind('facturacion-created', onFacturaCreada);
	bind('facturacion-updated', onFacturaActualizada);
	bind('facturacion-anulada', onFacturaAnulada);
	bind('liquidacion-tercero-updated', onTercero);
	bind('connect', onConnect);
	bind('disconnect', onDisconnect);

	// Si el socket YA estaba conectado al montar, `connect` no volverá a
	// dispararse y el join no llegaría nunca.
	if (socket.connected) join();

	return {
		get presence() {
			return presence;
		},
		get conectado() {
			return conectado;
		},

		setHojaActiva: (sheetId: string) => {
			hojaActiva = sheetId;
			socket.emit('sheet:active', {
				scope: SCOPE,
				anio: opts.anio,
				// El gateway exige un mes válido en `sheet:active` aunque el
				// scope sea anual; se manda uno cualquiera del rango 1-12.
				mes: 1,
				sheet_id: sheetId
			});
		},

		dispose: () => {
			try {
				socket.emit('sheet:leave', { scope: SCOPE, anio: opts.anio, mes: null });
			} catch {
				/* noop */
			}
			socket.off('sheet:presence', onPresence);
			socket.off('liquidacion-servicio-created', onCreada);
			socket.off('liquidacion-servicio-updated', onActualizada);
			socket.off('liquidacion-servicio-deleted', onEliminada);
			socket.off('liquidacion-servicio-facturada', onFacturada);
			socket.off('facturacion-created', onFacturaCreada);
			socket.off('facturacion-updated', onFacturaActualizada);
			socket.off('facturacion-anulada', onFacturaAnulada);
			socket.off('liquidacion-tercero-updated', onTercero);
			socket.off('connect', onConnect);
			socket.off('disconnect', onDisconnect);
			presence = [];
		}
	};
}
