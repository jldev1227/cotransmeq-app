/**
 * Worker de fórmulas para los canvas Univer (ocasional, adicionales,
 * cierres finales, mensual). Sigue exactamente el patrón oficial de
 * Univer para Preset Mode + Web Workers:
 * https://docs.univer.ai/guides/sheets/features/core/worker
 *
 * BUG QUE ESTE ARCHIVO RESUELVE:
 * Antes, `engine.ts` hacía `import ... from '@univerjs/preset-sheets-core/worker?url'`
 * y pasaba esa URL directo a `workerURL`. Ese subpath (`/worker`) SOLO
 * exporta la función `UniverSheetsCoreWorkerPreset` — no ejecuta nada
 * por sí mismo. Es decir, el "worker" nunca llamaba a `createUniver(...)`
 * dentro de su propio hilo, así que NUNCA registraba el motor de
 * fórmulas ni el canal RPC del lado del worker. El resultado: el motor
 * de fórmulas del hilo principal esperaba resultados de un worker que
 * jamás iba a responder (porque no estaba corriendo Univer), y todas
 * las fórmulas quedaban "congeladas" — nunca se recalculaban ni al
 * montar el workbook ni al editar una celda referenciada.
 *
 * Este archivo es el entry point real del worker: importa el preset
 * `UniverSheetsCoreWorkerPreset` y llama `createUniver(...)` DENTRO del
 * worker, tal como indican los ejemplos oficiales de Univer.
 */

import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCoreWorkerPreset } from '@univerjs/preset-sheets-core/worker';
import UniverPresetSheetsCoreEsES from '@univerjs/preset-sheets-core/locales/es-ES';

createUniver({
	locale: LocaleType.ES_ES,
	locales: {
		[LocaleType.ES_ES]: mergeLocales({}, UniverPresetSheetsCoreEsES as unknown as Record<string, any>)
	},
	presets: [UniverSheetsCoreWorkerPreset()]
});
