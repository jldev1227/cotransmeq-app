/**
 * Feature flag de emergencia: deshabilita el autosave mientras diagnosticamos
 * los bugs de Univer. El frontend sigue actualizando el modelo en memoria,
 * pero NO encola cambios al backend hasta que se reabra esto.
 *
 * Para reactivar: poner `false`.
 */
export const AUTOSAVE_ENABLED = true;

/**
 * Feature flag de debug: pinta las celdas editables con fondo naranja y las
 * bloqueadas con rojo soft, para verificar visualmente que la whitelist de
 * `cell-permission.ts` está bien aplicada.
 *
 * Activar: poner `true`.
 */
export const DEBUG_HIGHLIGHT = false;
