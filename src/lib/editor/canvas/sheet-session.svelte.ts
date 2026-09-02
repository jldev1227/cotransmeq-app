/**
 * Sesión de colaboración de un LIBRO de canvas.
 *
 * Sirve a los dos tipos: los ANUALES (adicionales, ocasional — 12 hojas,
 * una por mes, room por año) y los de PERIODO (cierres finales — una hoja
 * por placa, room por año:mes).
 *
 * Sustituye a `realtimeCollab` para los canvas anuales. La diferencia que
 * importa: aquel es un singleton de módulo con UNA sola room
 * (`currentTable`/`currentId` a nivel de archivo), sin noción de mes, y
 * registra sus listeners sin hacer `off` previo. Con dos canvas abiertos, o
 * con un cambio de año, eso produce presencia cruzada, indicadores de
 * "Guardado" fantasma y handlers duplicados.
 *
 * Aquí cada libro tiene su propia instancia, sus propios handlers y su propio
 * `dispose()`.
 *
 * PROTOCOLO (ver `backend-nest/src/sockets/sheet.gateway.ts`)
 *   C→S  sheet:join / sheet:leave / sheet:active / sheet:patch
 *   S→C  sheet:presence
 *   S→emisor  sheet:patch:ack | sheet:patch:conflict | sheet:patch:error
 *   S→resto   sheet:patch:applied        ← excluye al emisor
 *   S→todos   sheet:reverted
 */

import type { Socket } from 'socket.io-client';
import { connectSocket } from '$lib/socketClient';

import { sheetRoomKey, requiereMes, type SheetScope } from './sheet-room-key';
export type { SheetScope };

export interface SheetPresenceUser {
	id: string;
	name: string;
	mes: number | null;
	/** Hoja concreta. Solo lo llenan los canvas de periodo. */
	sheetId?: string | null;
	joinedAt: string;
}

export interface SheetPatch {
	mes: number;
	entity_type: string;
	entity_id: string;
	field: string;
	value: string | number | boolean | null;
	base_version: number;
	/**
	 * Cierre al que pertenece la entidad. Obligatorio en `cierres-finales`.
	 *
	 * El servidor podría deducirlo del `entity_id`, pero eso serían dos
	 * consultas por patch en vez de una: la hoja ya sabe de qué cierre es,
	 * así que lo manda.
	 */
	cierre_id?: string;
}

export interface SheetPatchApplied extends SheetPatch {
	scope: SheetScope;
	anio: number;
	version: number;
	/**
	 * Fila única. La usan los canvas donde un cambio no cascadea
	 * (adicionales).
	 */
	row?: any;
	/**
	 * TODAS las filas afectadas. En cierres finales un cambio de `dias`
	 * cascadea a prestaciones, seguridad social y gastos automáticos, así
	 * que el servidor devuelve el conjunto completo.
	 */
	rows?: any[];
	/**
	 * Filas del PIVOTE afectadas. Solo cuando el patch fue sobre un `item`
	 * (alternar `aplica_impuestos` o `excluido`).
	 */
	items?: any[];
	/** Totales del cierre recalculados. Solo en cierres finales. */
	totales?: Record<string, number>;
	/** Cierre al que pertenece el cambio. Solo en cierres finales. */
	cierre_id?: string;
	epoch: number;
	by: { id: string; name: string };
}

export interface SheetSessionOptions {
	scope: SheetScope;
	anio: number;
	/**
	 * Obligatorio para `cierres-finales`, cuyo libro es un PERIODO. Los
	 * scopes anuales lo ignoran: su room es el año entero.
	 */
	mes?: number | null;
	user: { id: string; name: string };
	/** Un cambio de otro usuario, listo para pintar. */
	onRemotePatch?: (p: SheetPatchApplied) => void;
	/**
	 * El servidor aceptó UN patch propio. Trae la fila ya derivada y la
	 * versión nueva, que hay que fusionar en el modelo local: sin ella, el
	 * siguiente patch de esa fila iría con una `base_version` obsoleta y el
	 * servidor lo rechazaría por conflicto contra el propio usuario.
	 */
	onAck?: (a: {
		entity_id: string;
		field: string;
		version: number;
		row?: any;
		rows?: any[];
		items?: any[];
		totales?: Record<string, number>;
	}) => void;
	/**
	 * Cambio de geometría (alta/baja de filas, guardado en lote): hay que releer.
	 *
	 * `cierreId` viene cuando el cambio afecta a UNA hoja concreta. Sin él, el
	 * llamador no puede distinguir «relee este cierre» de «relee el periodo
	 * entero», y acababa recargándolo todo por un bloque de conductor.
	 */
	onInvalidate?: (i: { mes: number; cierreId?: string | null; accion?: string }) => void;
	/** Conflicto de versión: el servidor manda su valor actual. */
	onConflict?: (c: {
		entity_id: string;
		field: string;
		reason: 'version' | 'epoch';
		server_row: any;
	}) => void;
	/** Un periodo fue revertido a un snapshot: hay que rehacer esa hoja. */
	onReverted?: (r: { mes: number; version: number; epoch: number; by: any }) => void;
	onPresence?: (users: SheetPresenceUser[]) => void;
	/**
	 * Cambió el ESTADO de un cierre (solo `cierres-finales`).
	 *
	 * Reaccionar bloqueando la hoja es obligatorio, no cosmético: el
	 * servidor rechaza los patches sobre cierres que ya no son BORRADOR, así
	 * que si la hoja sigue editable el usuario teclea y recibe un error por
	 * cada celda.
	 */
	onEstadoChanged?: (e: {
		cierre_id: string;
		estado: string;
		version: number;
		by: { id: string; name: string };
	}) => void;
	/**
	 * Se creó un cierre nuevo en este periodo (solo `cierres-finales`).
	 *
	 * Lo emite la cola de borradores al room del libro según va guardando,
	 * no al terminar: quien tiene el canvas abierto ve aparecer las hojas
	 * una a una. `cierre` viene con la misma forma que las filas del
	 * listado del periodo, para que la hoja nueva no difiera de sus vecinas.
	 */
	onSheetAdded?: (e: { cierre: any; by: { id: string; name: string } }) => void;
	/**
	 * Alguien cambió el COLOR de una pestaña (solo `cierres-finales`).
	 *
	 * Va aparte de `onEstadoChanged` porque el color no cambia lo que se
	 * puede editar: se aplica con `setTabColor` y ya está, sin remontar ni
	 * recalcular. `color: null` devuelve la hoja al color de su estado.
	 */
	onColorChanged?: (e: {
		cierre_id: string;
		color: string | null;
		by: { id: string; name: string };
	}) => void;
	/**
	 * El servidor rechazó un patch, o el acuse no llegó nunca.
	 *
	 * Antes esto moría en un `console.error` dentro de la sesión: la página
	 * no se enteraba, así que la entidad se quedaba «pendiente» para siempre
	 * y el indicador atascado en «Guardando…».
	 */
	onPatchFallido?: (e: {
		entity_id: string;
		field: string;
		motivo: 'error' | 'timeout';
		error?: string;
	}) => void;
	/** Cambió el estado del socket. Alimenta el «Sin conexión» del header. */
	onConexion?: (conectado: boolean) => void;
}

export interface SheetSession {
	readonly presence: SheetPresenceUser[];
	/** Epoch conocido por mes; viaja en cada patch para invalidar los en vuelo. */
	epochDe: (mes: number) => number;
	setHojaActiva: (mes: number, sheetId?: string | null) => void;
	/** Devuelve el `request_id`, para poder correlacionar el acuse. */
	enviarPatch: (patch: SheetPatch) => string;
	dispose: () => void;
}

export function createSheetSession(opts: SheetSessionOptions): SheetSession {
	const { scope, anio, user } = opts;
	const mes = opts.mes ?? null;
	if (requiereMes(scope) && mes == null) {
		throw new Error(`createSheetSession: el scope "${scope}" requiere mes`);
	}
	const roomKey = sheetRoomKey(scope, anio, mes);
	const socket: Socket = connectSocket();

	let presence = $state<SheetPresenceUser[]>([]);
	const epochs = new Map<number, number>();

	let requestSeq = 0;
	const nextRequestId = () => `${scope}-${anio}-${++requestSeq}`;

	/**
	 * Patches emitidos y aún sin respuesta, por `request_id`.
	 *
	 * La correlación es por PETICIÓN y no por celda porque dos ediciones
	 * rápidas del mismo campo son dos peticiones distintas: correlacionar por
	 * `entity_id + field` hacía que el acuse de la primera diera por buena la
	 * segunda, que podía no haber llegado.
	 *
	 * El servidor ya devuelve `request_id` en cada respuesta
	 * (`sheet.gateway.ts`, helper `responder`); solo faltaba usarlo.
	 */
	interface EnVuelo {
		patch: SheetPatch;
		intentos: number;
		temporizador: ReturnType<typeof setTimeout>;
	}
	const enVuelo = new Map<string, EnVuelo>();

	/** Cuánto se espera un acuse antes de dar el patch por perdido. */
	const TIMEOUT_ACK_MS = 10_000;
	/** Reenvíos antes de rendirse. El patch es idempotente: lleva su versión base. */
	const MAX_REENVIOS = 2;

	function resolverEnVuelo(requestId: string | undefined): SheetPatch | null {
		if (!requestId) return null;
		const registro = enVuelo.get(requestId);
		if (!registro) return null;
		clearTimeout(registro.temporizador);
		enVuelo.delete(requestId);
		return registro.patch;
	}

	function emitirPatch(requestId: string, patch: SheetPatch) {
		socket.emit('sheet:patch', {
			scope,
			anio,
			...patch,
			// En los canvas de periodo el mes lo fija el libro, no el patch.
			...(requiereMes(scope) ? { mes } : {}),
			epoch: epochs.get(patch.mes) ?? 0,
			request_id: requestId,
			user
		});

		const previo = enVuelo.get(requestId);
		const intentos = previo ? previo.intentos : 0;
		if (previo) clearTimeout(previo.temporizador);

		enVuelo.set(requestId, {
			patch,
			intentos,
			temporizador: setTimeout(() => {
				const registro = enVuelo.get(requestId);
				if (!registro) return;

				if (registro.intentos < MAX_REENVIOS) {
					registro.intentos++;
					// Reenviar es seguro: el patch lleva `base_version`, así que
					// si el primero SÍ llegó, el segundo se rechaza por conflicto
					// en vez de aplicarse dos veces.
					emitirPatch(requestId, registro.patch);
					return;
				}

				enVuelo.delete(requestId);
				opts.onPatchFallido?.({
					entity_id: patch.entity_id,
					field: patch.field,
					motivo: 'timeout'
				});
			}, TIMEOUT_ACK_MS)
		});
	}

	// Handlers guardados en variables: `socket.off(evento, handler)` con la
	// referencia exacta. `realtimeCollab.leaveRoom` hace `socket.off(evento)`
	// SIN handler, lo que borra también los listeners de otros consumidores
	// del socket compartido (chat, nómina…).
	const onPresence = (data: any) => {
		if (data?.room !== roomKey) return;
		presence = Array.isArray(data.users) ? data.users : [];
		opts.onPresence?.(presence);
	};

	const onApplied = (p: SheetPatchApplied) => {
		if (p?.scope !== scope || Number(p?.anio) !== anio) return;
		if (typeof p.epoch === 'number') epochs.set(Number(p.mes), p.epoch);
		opts.onRemotePatch?.(p);
	};

	const onConflict = (c: any) => {
		resolverEnVuelo(c?.request_id);
		if (typeof c?.epoch === 'number' && c?.entity_id == null) return;
		opts.onConflict?.({
			entity_id: c?.entity_id,
			field: c?.field,
			reason: c?.reason === 'epoch' ? 'epoch' : 'version',
			server_row: c?.server_row ?? null
		});
	};

	const onAck = (a: any) => {
		resolverEnVuelo(a?.request_id);
		if (!a?.entity_id) return;
		opts.onAck?.({
			entity_id: a.entity_id,
			field: a.field,
			version: Number(a.version),
			row: a.row,
			rows: a.rows,
			items: a.items,
			totales: a.totales
		});
	};

	const onInvalidate = (i: any) => {
		if (i?.scope !== scope || Number(i?.anio) !== anio) return;
		opts.onInvalidate?.({
			mes: Number(i.mes),
			cierreId: i.cierre_id ?? null,
			accion: i.accion
		});
	};

	const onError = (e: any) => {
		const patch = resolverEnVuelo(e?.request_id);
		console.error('[sheet-session] patch rechazado:', e?.error);
		// El llamador NECESITA enterarse: si no, deja la entidad marcada como
		// pendiente y el indicador se queda en «Guardando…» para siempre.
		if (patch) {
			opts.onPatchFallido?.({
				entity_id: patch.entity_id,
				field: patch.field,
				motivo: 'error',
				error: e?.error
			});
		}
	};

	const onSheetAdded = (e: any) => {
		if (e?.scope !== scope || Number(e?.anio) !== anio) return;
		if (requiereMes(scope) && Number(e?.mes) !== mes) return;
		if (!e?.cierre?.id) return;
		opts.onSheetAdded?.({ cierre: e.cierre, by: e.by ?? { id: '', name: '' } });
	};

	const onColorChanged = (e: any) => {
		if (e?.scope !== scope || Number(e?.anio) !== anio) return;
		if (requiereMes(scope) && Number(e?.mes) !== mes) return;
		if (!e?.cierre_id) return;
		opts.onColorChanged?.({
			cierre_id: String(e.cierre_id),
			color: e.color ?? null,
			by: e.by ?? { id: '', name: '' }
		});
	};

	const onEstadoChanged = (e: any) => {
		if (e?.scope !== scope || Number(e?.anio) !== anio) return;
		if (requiereMes(scope) && Number(e?.mes) !== mes) return;
		if (!e?.cierre_id) return;
		opts.onEstadoChanged?.({
			cierre_id: String(e.cierre_id),
			estado: String(e.estado),
			version: Number(e.version),
			by: e.by ?? { id: '', name: '' }
		});
	};

	const onReverted = (r: any) => {
		if (r?.scope !== scope || Number(r?.anio) !== anio) return;
		if (typeof r.epoch === 'number') epochs.set(Number(r.mes), r.epoch);
		opts.onReverted?.({
			mes: Number(r.mes),
			version: Number(r.version),
			epoch: Number(r.epoch),
			by: r.by
		});
	};

	// `off` antes de `on`: si esta sesión se recrea (cambio de año, retry) sin
	// haber pasado por `dispose`, no queremos handlers duplicados procesando
	// cada evento N veces.
	const bind = (evento: string, handler: (...a: any[]) => void) => {
		socket.off(evento, handler);
		socket.on(evento, handler);
	};

	bind('sheet:presence', onPresence);
	bind('sheet:patch:applied', onApplied);
	bind('sheet:patch:ack', onAck);
	bind('sheet:patch:conflict', onConflict);
	bind('sheet:patch:error', onError);
	bind('sheet:invalidate', onInvalidate);
	bind('sheet:reverted', onReverted);
	bind('sheet:estado-changed', onEstadoChanged);
	bind('sheet:sheet-added', onSheetAdded);
	bind('sheet:hoja-color', onColorChanged);

	socket.emit('sheet:join', { scope, anio, mes, user });

	// Rejoin tras reconexión: el servidor pierde la membresía del room.
	const onConnect = () => {
		socket.emit('sheet:join', { scope, anio, mes, user });
		opts.onConexion?.(true);
		// Reenviar lo que quedó sin acuse mientras no había red. Sin esto,
		// esos patches se emitieron al vacío y no vuelve a intentarlo nadie.
		for (const [requestId, registro] of enVuelo) {
			emitirPatch(requestId, registro.patch);
		}
	};
	bind('connect', onConnect);

	const onDisconnect = () => {
		opts.onConexion?.(false);
	};
	bind('disconnect', onDisconnect);

	return {
		get presence() {
			return presence;
		},

		epochDe: (mes: number) => epochs.get(mes) ?? 0,

		/**
		 * Anuncia en qué hoja está el usuario.
		 *
		 * En los canvas anuales la hoja ES el mes. En los de periodo el mes
		 * es fijo y lo que cambia es `sheetId` (la placa), así que se manda
		 * el mes del libro más la hoja concreta.
		 */
		setHojaActiva: (mesActivo: number, sheetId?: string | null) => {
			socket.emit('sheet:active', {
				scope,
				anio,
				mes: requiereMes(scope) ? mes : mesActivo,
				sheet_id: sheetId ?? null
			});
		},

		/**
		 * Emite un patch y devuelve su `request_id`.
		 *
		 * Queda registrado como «en vuelo» hasta que llegue `ack`, `conflict`
		 * o `error`. Si no llega ninguno en 10 s se reenvía hasta dos veces y,
		 * si sigue sin haber respuesta, se avisa por `onPatchFallido`.
		 */
		enviarPatch: (patch: SheetPatch) => {
			const requestId = nextRequestId();
			emitirPatch(requestId, patch);
			return requestId;
		},

		dispose: () => {
			try {
				socket.emit('sheet:leave', { scope, anio, mes });
			} catch {
				/* noop */
			}
			socket.off('sheet:presence', onPresence);
			socket.off('sheet:patch:applied', onApplied);
			socket.off('sheet:patch:ack', onAck);
			socket.off('sheet:patch:conflict', onConflict);
			socket.off('sheet:patch:error', onError);
			socket.off('sheet:invalidate', onInvalidate);
			socket.off('sheet:reverted', onReverted);
			socket.off('sheet:estado-changed', onEstadoChanged);
			socket.off('sheet:sheet-added', onSheetAdded);
			socket.off('sheet:hoja-color', onColorChanged);
			socket.off('connect', onConnect);
			socket.off('disconnect', onDisconnect);
			// Los temporizadores de acuse sobreviven al componente si no se
			// limpian: dispararían `onPatchFallido` sobre una página muerta.
			for (const registro of enVuelo.values()) clearTimeout(registro.temporizador);
			enVuelo.clear();
			presence = [];
		}
	};
}
