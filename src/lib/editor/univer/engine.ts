/**
 * Engine Univer para el editor de liquidaciones — basado en PRESETS.
 *
 * Usamos `@univerjs/presets` + `@univerjs/preset-sheets-core` en vez del
 * ensamble manual de plugins low-level. Razón: el preset configura
 * correctamente el input oculto para keyboard, el focus management, el
 * bridge del FormulaBar, y todos los peer-dependencies de Docs/DocsUI
 * que el ensamble manual omitía (eso era la causa de que las arrow keys
 * y el typing no funcionaran en `flex: 1` + `overflow: hidden`).
 *
 * API: `createUniver(...)` devuelve `{ univer, univerAPI }`.
 *   - `univer`     → instancia Univer (para acceder al injector)
 *   - `univerAPI`  → FUniver facade (para createWorkbook, addEvent, etc.)
 *
 * El preset ya carga los CSS de Univer, Design, UI, DocsUI, SheetsUI,
 * SheetsFormulaUI y SheetsNumfmtUI automáticamente (sideEffects: ["*.css"]).
 */

import {
  LocaleType,
  mergeLocales,
  type IWorkbookData
} from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { Univer } from '@univerjs/core';
import { defaultTheme } from '@univerjs/themes';
import { createUniver } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import { anclarEditorDeCelda } from './anclar-editor-celda';
import UniverPresetSheetsCoreEsES from '@univerjs/preset-sheets-core/locales/es-ES';
import UniverPresetSheetsDataValidationEsES from '@univerjs/preset-sheets-data-validation/locales/es-ES';

/**
 * Parche de i18n: `@univerjs/sheets-ui` pide las claves
 * `sheets-ui.info.error` / `sheets-ui.info.forceStringInfo` (alerta de
 * "número almacenado como texto", ej. en columnas # PLANILLA / # FACTURA
 * que son texto pero parecen números). Esas claves SÍ existen en el
 * paquete `@univerjs/sheets-numfmt-ui` (locale es-ES/en-US), pero ese
 * paquete las registra por error bajo el namespace `sheets-numfmt-ui`
 * en vez de `sheets-ui` (bug de la librería, versión 0.25.1). Como el
 * bundle combinado `@univerjs/preset-sheets-core/locales/es-ES` hereda
 * ese mismo bug, `t('sheets-ui.info.forceStringInfo')` nunca encuentra
 * la clave y el usuario ve el key crudo en vez del texto traducido.
 *
 * Parcheamos manualmente el namespace correcto aquí, con MERGE PROFUNDO
 * (no usar `mergeLocales` para esto: internamente hace un
 * `Object.assign` superficial, así que un objeto `{ 'sheets-ui': {...} }`
 * pisaría/borraría TODAS las demás traducciones de `sheets-ui.*` —
 * menús, tooltips, etc. — en vez de solo añadir `info.*`).
 */
function withForceStringInfoPatch(
  baseLocale: Record<string, any>
): Record<string, any> {
  return {
    ...baseLocale,
    'sheets-ui': {
      ...(baseLocale['sheets-ui'] ?? {}),
      info: {
        ...(baseLocale['sheets-ui']?.info ?? {}),
        error: 'Error',
        forceStringInfo: 'Número almacenado como texto'
      }
    }
  };
}

export interface EngineContext {
  univer: Univer;
  fUniver: FUniver;
  unitId: string;
  dispose: () => void;
}

/**
 * Registro de workers RPC creados por instancia de `Univer`, para poder
 * terminarlos explícitamente en `disposeEngine`.
 *
 * POR QUÉ: `@univerjs/rpc`'s `UniverRPCMainThreadPlugin` solo llama
 * `worker.terminate()` en su propio `dispose()` cuando el `workerURL`
 * pasado es un `string`/`URL` (el plugin construye el `Worker` y se
 * queda con la referencia). Si nosotros construimos el `Worker` a mano
 * (ver más abajo, necesario para forzar `{ type: 'module' }`) y lo
 * pasamos como instancia, el plugin detecta `workerURL instanceof
 * Worker` y NO se queda con la referencia (`_internalWorker = null`),
 * así que nunca lo termina. Sin este registro, cada mount/unmount del
 * canvas dejaría un Worker huérfano corriendo en background.
 */
const engineWorkers = new WeakMap<Univer, Worker>();

/// Disposers de `anclarEditorDeCelda`, por instancia. Mismo patrón que los
/// workers: `disposeEngine` los suelta al desmontar el canvas.
const engineAnclas = new WeakMap<Univer, () => void>();

export interface EngineOptions {
  container: HTMLElement;
  /** Snapshot inicial del workbook. */
  workbookData?: IWorkbookData;
  /** Locale. Default: ES_ES. */
  locale?: LocaleType;
  /** Readonly global. */
  readOnly?: boolean;
  /**
   * Footer del preset. Default: `false` (footer desactivado para mantener
   * el layout limpio del editor clásico). Pasar `true` o un objeto con
   * `{ sheetBar, statisticBar, menus, zoomSlider }` para mostrar la
   * barra de Excel (estadísticas de selección, navegación de hojas, etc).
   *
   * Útil para vistas fullscreen como el canvas modal.
   */
  footer?:
    | false
    | {
        sheetBar?: boolean;
        statisticBar?: boolean;
        menus?: boolean;
        zoomSlider?: boolean;
      };
  /**
   * Registra el preset de VALIDACIÓN DE DATOS (checkbox, listas
   * desplegables). Hoy solo lo pide el canvas de ingresos, para el checkbox
   * de la columna INCLUIR.
   *
   * ⚠️ Esto NO ahorra bundle. El `import` de arriba es estático y este
   * fichero lo comparten los cuatro canvas, así que los tres paquetes de
   * validación (~780 KB de fuente ES) acaban en el mismo chunk de Univer
   * —ya de 5,8 MB— lo pida alguien o no. Comprobado en el build: el chunk
   * con `requireCheckbox` es el que cargan cierres, adicionales, ocasional
   * e ingresos por igual.
   *
   * Lo que el flag decide es el COMPORTAMIENTO: los plugins de validación
   * añaden menús de contexto, un panel lateral y renderizadores de celda, y
   * las otras tres hojas no los quieren. Si algún día pesa de verdad, el
   * arreglo es un `import()` dinámico, que obliga a volver async
   * `createLiquidacionEngine` y los cuatro engines que lo envuelven.
   */
  dataValidation?: boolean;
}

export function createLiquidacionEngine(opts: EngineOptions): EngineContext {
  console.log('[editor] createLiquidacionEngine (preset) START');
  const locale = opts.locale ?? LocaleType.ES_ES;

  // ── Worker RPC para fórmulas/numfmt en background ──────────────────
  // BUG FIX (las fórmulas no se calculaban ni al montar el workbook ni
  // al editar una celda referenciada, ej. cambiar el % de un impuesto no
  // actualizaba la columna VALOR):
  //
  // Antes se importaba `@univerjs/preset-sheets-core/worker?url` (la URL
  // cruda al archivo del paquete) y se pasaba directo a `workerURL`. Ese
  // subpath SOLO exporta la función `UniverSheetsCoreWorkerPreset`, no
  // ejecuta nada por sí mismo — nunca se llamaba `createUniver(...)`
  // DENTRO del worker, así que el lado worker nunca registraba el motor
  // de fórmulas ni el canal RPC. El hilo principal quedaba esperando
  // resultados de un worker que jamás iba a responder. Además, ese
  // bundle es un ES module y `@univerjs/rpc` hace `new Worker(url)` sin
  // `{ type: 'module' }` cuando se le pasa un string, lo que agrava el
  // problema (SyntaxError silencioso dentro del worker).
  //
  // Fix (siguiendo el patrón oficial: https://docs.univer.ai/guides/sheets/features/core/worker):
  // 1) `formula.worker.ts` es nuestro propio entry point que SÍ llama
  //    `createUniver({ presets: [UniverSheetsCoreWorkerPreset()] })`.
  // 2) Lo instanciamos con el patrón nativo de Vite
  //    `new Worker(new URL(..., import.meta.url), { type: 'module' })`,
  //    que Vite bundlea correctamente tanto en dev como en build.
  // 3) Pasamos la INSTANCIA de `Worker` (no un string) — el tipo
  //    `IUniverRPCMainThreadConfig.workerURL` acepta `string | URL | Worker`.
  const formulaWorker = new Worker(new URL('./formula.worker.ts', import.meta.url), {
    type: 'module'
  });
  formulaWorker.addEventListener('error', (e) => {
    console.error('[editor] formula worker error', e);
  });

  const { univer, univerAPI: fUniver } = createUniver({
    theme: defaultTheme,
    locale,
    locales: {
      [locale]: withForceStringInfoPatch(
        // Los locales del preset de validación se mezclan SIEMPRE, aunque el
        // preset no se cargue: son unas pocas cadenas y así el `locales` no
        // depende de un flag, que es justo el tipo de condicional que deja a
        // alguien mirando una clave cruda en pantalla.
        mergeLocales(
          {},
          UniverPresetSheetsCoreEsES as unknown as Record<string, any>,
          UniverPresetSheetsDataValidationEsES as unknown as Record<string, any>
        )
      )
    },
    presets: [
      ...(opts.dataValidation
        ? [
            UniverSheetsDataValidationPreset({
              // Sin el editor de reglas en el desplegable: las reglas las pone
              // el canvas, no el usuario. Dejarlo abierto invitaría a cambiar
              // un checkbox por una lista y romper el binding de la columna.
              showEditOnDropdown: false
            })
          ]
        : []),
      UniverSheetsCorePreset({
        container: opts.container,
        // Ocultamos la chrome de Univer porque ya tenemos toolbar propia.
        header: false,
        toolbar: false,
        // Footer configurable: si no se pasa, queda desactivado (default
        // del editor clásico). Pasarlo como objeto habilita la barra de
        // estadísticas + sheet bar + zoom (comportamiento tipo Excel).
        footer: opts.footer ?? false,
        // Mantenemos lo útil para edición de celdas.
        contextMenu: true,
        formulaBar: true,
        statusBarStatistic: true,
        // Worker requerido por el preset (fórmulas, numfmt en background).
        // Ver comentario arriba: instancia propia con `{ type: 'module' }`.
        workerURL: formulaWorker,
        // Forzar el recálculo de TODAS las fórmulas al montar el workbook.
        // Por defecto Univer usa WHEN_EMPTY (solo calcula celdas con fórmula
        // pero sin valor). Mantenemos FORCED como defensa adicional aunque
        // nuestros builders ya cachean `v` junto a `f` en cada celda con
        // fórmula.
        formula: {
          initialFormulaComputing: 0 // CalculationMode.FORCED
        }
      })
    ]
  });

  // Registrar el worker para poder terminarlo en `disposeEngine` (el
  // plugin RPC no lo hace por nosotros cuando le pasamos una instancia
  // de `Worker` en vez de un string/URL — ver comentario arriba).
  engineWorkers.set(univer, formulaWorker);

  // 9) Crear el workbook con el snapshot mínimo si no se provee uno.
  const workbookData: IWorkbookData = opts.workbookData ?? {
    id: `workbook-${Date.now()}`,
    name: 'Liquidación',
    appVersion: '0.25.1',
    locale,
    styles: {},
    sheetOrder: ['sheet-1'],
    sheets: {
      'sheet-1': {
        id: 'sheet-1',
        name: 'Liquidación',
        tabColor: '#0f4025',
        hidden: 0 as any,
        freeze: { startRow: 0, startColumn: 0, ySplit: 0, xSplit: 0 },
        rowCount: 100,
        columnCount: 10,
        zoomRatio: 1,
        scrollTop: 0,
        scrollLeft: 0,
        defaultColumnWidth: 100,
        defaultRowHeight: 24,
        mergeData: [],
        cellData: {} as any,
        rowData: {} as any,
        columnData: {} as any,
        rowHeader: { width: 50 },
        columnHeader: { height: 24 },
        showGridlines: 1 as any,
        rightToLeft: 0 as any
      }
    }
  };
  const unitId = workbookData.id;
  workbookData.id = unitId;

  fUniver.createWorkbook(workbookData);

  // Evita que el editor de celda se despegue de su celda al desplazarse.
  // Se cablea aquí y no en cada engine porque los cuatro canvas del módulo
  // pasan por esta misma fábrica.
  engineAnclas.set(univer, anclarEditorDeCelda(univer, opts.container));

  if (opts.readOnly) {
    try {
      fUniver.getActiveWorkbook()?.setEditable?.(false);
    } catch (e) {
      console.warn('[editor] setEditable(false) failed', e);
    }
  }

  console.log('[editor] createLiquidacionEngine (preset) DONE', { unitId, readOnly: !!opts.readOnly });
  return {
    univer,
    fUniver,
    unitId,
    dispose: () => disposeEngine(univer, fUniver, unitId, opts.container)
  };
}

export function disposeEngine(
  univer: Univer,
  fUniver: FUniver,
  unitId: string,
  container: HTMLElement
): void {
  const soltarAncla = engineAnclas.get(univer);
  if (soltarAncla) {
    try {
      soltarAncla();
    } catch (e) {
      console.warn('[editor] ancla del editor: error al soltar', e);
    }
    engineAnclas.delete(univer);
  }
  try {
    fUniver.disposeUnit(unitId);
  } catch (e) {
    console.warn('[editor] disposeUnit error', e);
  }
  try {
    univer.dispose();
  } catch (e) {
    console.warn('[editor] univer.dispose error', e);
  }
  // Terminar el worker RPC que creamos manualmente (ver comentario en
  // `createLiquidacionEngine`). El plugin no lo hace por nosotros porque
  // le pasamos una instancia de `Worker`, no un string/URL.
  const worker = engineWorkers.get(univer);
  if (worker) {
    try {
      worker.terminate();
    } catch (e) {
      console.warn('[editor] formula worker terminate error', e);
    }
    engineWorkers.delete(univer);
  }
  container.innerHTML = '';
}
