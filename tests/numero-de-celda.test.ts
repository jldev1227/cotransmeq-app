import { describe, expect, it } from 'vitest';
import { numeroDeCelda } from '../src/lib/editor/business/numero-de-celda';

describe('numeroDeCelda con importes pegados de otros locales', () => {
	it.each([
		['$79.000', 79000],
		['$ 1.234.567,89', 1234567.89],
		['$79,000', 79000],
		['$1,234.56', 1234.56],
		['78629.9', 78629.9]
	])('interpreta %s como %s', (texto, esperado) => {
		expect(numeroDeCelda(texto, 'es-CO')).toBe(esperado);
	});

	it('conserva la coma decimal en porcentajes', () => {
		expect(numeroDeCelda('21,83')).toBe(21.83);
	});
});
