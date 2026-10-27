import {
	ICommandService,
	type ICommandInfo,
	type IWorkbookData,
	type Univer
} from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';

/** Preferencias visuales del workbook actual, aisladas por `unitId` (canvas y periodo). */
export interface PreferenciasHojasOptions {
	persistirOrden?: boolean;
	persistirColores?: boolean;
}

interface PreferenciasGuardadas {
	orden?: string[];
	colores?: Record<string, string>;
}

const PREFIJO = 'univer:sheet-preferences:v1:';
const COMANDOS_PREFERENCIAS = new Set([
	'sheet.command.set-worksheet-order',
	'sheet.command.move-sheet',
	'sheet.command.set-tab-color',
	'sheet.command.insert-sheet',
	'sheet.command.remove-sheet'
]);

function clave(unitId: string): string {
	return `${PREFIJO}${unitId}`;
}

function leer(unitId: string): PreferenciasGuardadas {
	if (typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(clave(unitId));
		if (!raw) return {};
		const valor = JSON.parse(raw) as PreferenciasGuardadas;
		return {
			orden: Array.isArray(valor.orden)
				? valor.orden.filter((id): id is string => typeof id === 'string')
				: undefined,
			colores:
				valor.colores && typeof valor.colores === 'object' && !Array.isArray(valor.colores)
					? Object.fromEntries(
							Object.entries(valor.colores).filter(
								(entry): entry is [string, string] => typeof entry[1] === 'string'
							)
						)
					: undefined
		};
	} catch {
		return {};
	}
}

function ordenFusionado(ordenBase: string[], ordenGuardado: string[] | undefined): string[] {
	const existentes = new Set(ordenBase);
	const conservados = (ordenGuardado ?? []).filter(
		(id, i, todos) => existentes.has(id) && todos.indexOf(id) === i
	);
	const yaIncluidos = new Set(conservados);
	return [...conservados, ...ordenBase.filter((id) => !yaIncluidos.has(id))];
}

/** Aplica las preferencias al snapshot antes de crear Univer; no dispara comandos ni ecos. */
export function aplicarPreferenciasAlSnapshot(
	workbook: IWorkbookData,
	opciones: PreferenciasHojasOptions = {}
): IWorkbookData {
	const guardarOrden = opciones.persistirOrden !== false;
	const guardarColores = opciones.persistirColores !== false;
	if (!guardarOrden && !guardarColores) return workbook;

	const preferencias = leer(workbook.id);
	const sheetOrder = [...(workbook.sheetOrder ?? [])];
	const sheets = { ...workbook.sheets };

	if (guardarOrden && preferencias.orden?.length) {
		const orden = ordenFusionado(sheetOrder, preferencias.orden);
		workbook = { ...workbook, sheetOrder: orden };
	}
	if (guardarColores && preferencias.colores) {
		for (const [sheetId, color] of Object.entries(preferencias.colores)) {
			const sheet = sheets[sheetId];
			if (sheet) sheets[sheetId] = { ...sheet, tabColor: color };
		}
		workbook = { ...workbook, sheets };
	}
	return workbook;
}

/** Color manual guardado, usado después de que algunos engines apliquen sus colores de estado. */
export function colorGuardadoDeHoja(unitId: string, sheetId: string): string | null {
	return leer(unitId).colores?.[sheetId] ?? null;
}

/** Persiste los cambios de color y orden hechos desde la sheet bar de Univer. */
export function observarPreferenciasHojas(
	univer: Univer,
	fUniver: FUniver,
	unitId: string,
	opciones: PreferenciasHojasOptions = {}
): () => void {
	const guardarOrden = opciones.persistirOrden !== false;
	const guardarColores = opciones.persistirColores !== false;
	if ((!guardarOrden && !guardarColores) || typeof window === 'undefined') return () => {};

	let cancelado = false;
	let restaurandoOrden = false;
	let temporizador: ReturnType<typeof setTimeout> | null = null;
	let disposable: { dispose: () => void } | null = null;

	const guardar = () => {
		if (cancelado) return;
		try {
			const workbook = fUniver.getActiveWorkbook();
			const sheets = workbook?.getSheets?.() ?? [];
			if (!sheets.length) return;
			const existentes = sheets.map((sheet) => sheet.getSheetId());
			const anterior = leer(unitId);
			const siguiente: PreferenciasGuardadas = { ...anterior };
			if (guardarOrden) siguiente.orden = existentes;
			if (guardarColores) {
				siguiente.colores = Object.fromEntries(
					sheets.flatMap((sheet) => {
						const color = sheet.getTabColor?.();
						return color ? [[sheet.getSheetId(), color]] : [];
					})
				);
			}
			window.localStorage.setItem(clave(unitId), JSON.stringify(siguiente));
		} catch {
			// La preferencia visual no debe interrumpir el uso del canvas si el
			// navegador bloquea localStorage o el libro todavía se está montando.
		}
	};

	const reconciliarOrdenGuardado = () => {
		if (!guardarOrden || cancelado || restaurandoOrden) return;
		const ordenGuardado = leer(unitId).orden;
		if (!ordenGuardado?.length) return;
		try {
			const workbook = fUniver.getActiveWorkbook();
			const sheets = workbook?.getSheets?.() ?? [];
			const ordenActual = sheets.map((sheet) => sheet.getSheetId());
			const ordenObjetivo = ordenFusionado(ordenActual, ordenGuardado);
			restaurandoOrden = true;
			for (const [index, sheetId] of ordenObjetivo.entries()) {
				const sheet = workbook?.getSheetBySheetId?.(sheetId);
				const posicionActual = workbook
					?.getSheets?.()
					.findIndex((item) => item.getSheetId() === sheetId);
				if (sheet && posicionActual !== index) workbook?.moveSheet?.(sheet, index);
			}
		} catch {
			// Un alta dinámica puede coincidir con el teardown del workbook.
		} finally {
			restaurandoOrden = false;
		}
	};

	const alEjecutar = (info: Readonly<ICommandInfo>) => {
		if (!COMANDOS_PREFERENCIAS.has(info.id) || restaurandoOrden) return;
		const params = info.params as { unitId?: string } | undefined;
		if (params?.unitId && params.unitId !== unitId) return;
		if (temporizador) clearTimeout(temporizador);
		temporizador = setTimeout(() => {
			temporizador = null;
			if (info.id === 'sheet.command.insert-sheet') reconciliarOrdenGuardado();
			guardar();
		}, 0);
	};

	// Los engines que envuelven esta fábrica pueden aplicar colores semánticos
	// justo después de crear el libro. Esperamos a que terminen para observar
	// comandos y evitar guardar esos valores iniciales como preferencias manuales.
	queueMicrotask(() => {
		if (cancelado) return;
		try {
			const commandService = (univer as any).__getInjector?.().get(ICommandService);
			disposable = commandService?.onCommandExecuted?.(alEjecutar) ?? null;
		} catch {
			disposable = null;
		}
	});

	return () => {
		cancelado = true;
		if (temporizador) clearTimeout(temporizador);
		disposable?.dispose();
	};
}
