/**
 * El adapter de nómina: de una edición de Univer a un patch de dominio.
 *
 * LO QUE ESTO GUARDA. `SetRangeValuesCommand` admite dos formas para `value`:
 * una MATRIZ indexada por fila y columna, y una ÚNICA `ICellData` que se
 * aplica a todo el rango. El editor de celda —teclear y pulsar Enter, que es
 * el 99 % de lo que hace un usuario— usa la SEGUNDA.
 *
 * El adapter sacaba las coordenadas de las claves de `value`, así que con esa
 * forma leía las claves de la propia `ICellData` (`v`, `p`, `f`), `Number('v')`
 * daba `NaN`, ninguna casaba con un binding y no se emitía ningún patch.
 * Ninguna edición del canvas de nómina llegaba a guardarse, y sin aviso: la
 * celda aceptaba el número y lo perdía al recargar.
 */

import { describe, expect, it } from 'vitest';
import { attachCellChangeNomina } from '../src/lib/editor/univer/adapters/cell-change-nomina';
import {
	clearNominaBindings,
	setNominaBinding
} from '../src/lib/editor/business/nomina-cell-binding';

const UNIT = 'nomina-2026-9';
const HOJA = 'nomina-conductor-1';
const LIQ = 'liq-1';
const FILA = 12;
const COL = 42;

/** Un `fUniver` de mentira: el comando que se emite y la celda que se lee. */
function univerFalso(valorEnCelda: unknown) {
	let handler: ((c: any) => void) | null = null;
	return {
		fUniver: {
			onCommandExecuted(cb: (c: any) => void) {
				handler = cb;
				return { dispose() {} };
			},
			getUniverSheet: () => ({
				getSheetBySheetId: () => ({
					getRange: () => ({ getCellData: () => ({ v: valorEnCelda }) })
				})
			})
		} as any,
		emitir: (params: unknown) =>
			handler?.({ id: 'sheet.command.set-range-values', params })
	};
}

function montar(valorEnCelda: unknown) {
	clearNominaBindings();
	setNominaBinding(UNIT, HOJA, FILA, COL, {
		entityType: 'liquidacion',
		entityId: LIQ,
		field: 'dia|2026-09-20|0|HEFD'
	});
	const patches: any[] = [];
	const invalidos: any[] = [];
	const { fUniver, emitir } = univerFalso(valorEnCelda);
	attachCellChangeNomina({
		fUniver,
		unitId: UNIT,
		onPatch: (p) => patches.push(p),
		onValorInvalido: (a) => invalidos.push(a)
	});
	return { emitir, patches, invalidos };
}

const rango = {
	startRow: FILA,
	endRow: FILA,
	startColumn: COL,
	endColumn: COL
};

describe('adapter de nómina', () => {
	it('emite el patch cuando `value` es una sola celda (el editor al pulsar Enter)', () => {
		const { emitir, patches } = montar(4);
		emitir({ unitId: UNIT, subUnitId: HOJA, range: rango, value: { v: 4, p: null, f: null } });

		expect(patches).toHaveLength(1);
		expect(patches[0].binding.field).toBe('dia|2026-09-20|0|HEFD');
		expect(patches[0].binding.entityId).toBe(LIQ);
		expect(patches[0].valor).toBe(4);
		expect(patches[0]).toMatchObject({ sheetId: HOJA, row: FILA, column: COL });
	});

	it('sigue emitiéndolo con la forma de matriz, que usan otras escrituras', () => {
		const { emitir, patches } = montar(4);
		emitir({
			unitId: UNIT,
			subUnitId: HOJA,
			value: { [FILA]: { [COL]: { v: 4 } } }
		});

		expect(patches).toHaveLength(1);
		expect(patches[0].valor).toBe(4);
	});

	it('no inventa destino para una celda sin binding', () => {
		const { emitir, patches } = montar(4);
		emitir({
			unitId: UNIT,
			subUnitId: HOJA,
			range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
			value: { v: 4 }
		});

		expect(patches).toHaveLength(0);
	});

	it('avisa en vez de mandar un cero cuando lo tecleado no es un número', () => {
		const { emitir, patches, invalidos } = montar('cuatro');
		emitir({ unitId: UNIT, subUnitId: HOJA, range: rango, value: { v: 'cuatro' } });

		expect(patches).toHaveLength(0);
		expect(invalidos).toHaveLength(1);
		expect(invalidos[0].texto).toBe('cuatro');
	});

	it('ignora un rango descomunal: ahí no hay nada editable', () => {
		const { emitir, patches } = montar(4);
		emitir({
			unitId: UNIT,
			subUnitId: HOJA,
			range: { startRow: 0, endRow: 999, startColumn: 0, endColumn: 999 },
			value: { v: 4 }
		});

		expect(patches).toHaveLength(0);
	});
});
