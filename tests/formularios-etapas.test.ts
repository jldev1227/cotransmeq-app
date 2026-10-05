import { describe, expect, it } from 'vitest';
import {
	etapasCerradasDe,
	etiquetaEtapa,
	numeroDeEtapa,
	problemasEtapas,
	progresoEtapas,
	resolverEtapas
} from '$lib/formularios/etapas';

const sec = (settings: Record<string, unknown>, title = 's') => ({ title, settings });

describe('numeroDeEtapa', () => {
	it('acepta número y número como texto; rechaza lo demás', () => {
		expect(numeroDeEtapa(sec({ etapa: 2 }))).toBe(2);
		expect(numeroDeEtapa(sec({ etapa: '3' }))).toBe(3);
		expect(numeroDeEtapa(sec({ etapa: '' }))).toBeNull();
		expect(numeroDeEtapa(sec({ etapa: 'dos' }))).toBeNull();
		expect(numeroDeEtapa(sec({}))).toBeNull();
	});
});

describe('resolverEtapas', () => {
	it('null sin etapas o con una sola', () => {
		expect(resolverEtapas([sec({}), sec({})])).toBeNull();
		expect(resolverEtapas([sec({ etapa: 1 }), sec({ etapa: 1 })])).toBeNull();
		expect(resolverEtapas([])).toBeNull();
	});

	it('agrupa, ordena por número y toma título/firma como el teléfono', () => {
		const etapas = resolverEtapas([
			sec({ etapa: 3, etapaTitulo: 'Cierre' }, 'c'),
			sec({ etapa: 1, etapaTitulo: 'Prealistamiento', etapaFirma: true }, 'a'),
			sec({ etapa: 1 }, 'b'),
			sec({ etapa: 2 }, 'd')
		])!;
		expect(etapas.map((e) => e.numero)).toEqual([1, 2, 3]);
		expect(etapas[0].titulo).toBe('Prealistamiento');
		expect(etapas[0].firma).toBe(true);
		expect(etapas[0].sections.map((s) => s.title)).toEqual(['a', 'b']);
		expect(etapas[1].titulo).toBe('Etapa 2');
		expect(etapas[1].firma).toBe(false);
	});

	it('las secciones sin etapa caen en la primera declarada', () => {
		const etapas = resolverEtapas([sec({}, 'x'), sec({ etapa: 2 }, 'y'), sec({ etapa: 3 }, 'z')])!;
		expect(etapas[0].numero).toBe(2);
		expect(etapas[0].sections.map((s) => s.title)).toEqual(['x', 'y']);
	});
});

describe('etiquetaEtapa', () => {
	it('omite el título cuando es el genérico', () => {
		expect(etiquetaEtapa({ numero: 2, titulo: 'Etapa 2', firma: false, sections: [] }, 3)).toBe(
			'Etapa 2 de 3'
		);
		expect(
			etiquetaEtapa({ numero: 1, titulo: 'Prealistamiento', firma: true, sections: [] }, 3)
		).toBe('Etapa 1 de 3 · Prealistamiento');
	});
});

describe('etapasCerradasDe', () => {
	it('normaliza lo que respaldó el teléfono', () => {
		expect(etapasCerradasDe({ stagesClosed: [2, '1', 1, 0, -3, 'x'] })).toEqual([1, 2]);
		expect(etapasCerradasDe({})).toEqual([]);
		expect(etapasCerradasDe(null)).toEqual([]);
		expect(etapasCerradasDe({ stagesClosed: 'nope' })).toEqual([]);
	});
});

describe('progresoEtapas', () => {
	const etapas = resolverEtapas([sec({ etapa: 1 }), sec({ etapa: 2 }), sec({ etapa: 3 })])!;

	it('null si el formulario no está por etapas', () => {
		expect(progresoEtapas(null, 'DRAFT', {})).toBeNull();
	});

	it('un borrador va en la primera etapa abierta', () => {
		const p = progresoEtapas(etapas, 'DRAFT', { stagesClosed: [1] })!;
		expect(p.cerradas).toEqual([1]);
		expect(p.enCurso?.numero).toBe(2);
		expect(p.completo).toBe(false);
	});

	it('un envío entregado tiene todas las etapas cerradas aunque no venga la lista', () => {
		const p = progresoEtapas(etapas, 'SUBMITTED', {})!;
		expect(p.cerradas).toEqual([1, 2, 3]);
		expect(p.enCurso).toBeNull();
		expect(p.completo).toBe(true);
	});

	it('ignora números cerrados que no son etapas del formulario', () => {
		const p = progresoEtapas(etapas, 'DRAFT', { stagesClosed: [1, 9] })!;
		expect(p.cerradas).toEqual([1]);
	});
});

describe('problemasEtapas', () => {
	it('nada que avisar sin etapas o con etapas correctas', () => {
		expect(problemasEtapas([sec({}), sec({})])).toEqual([]);
		expect(
			problemasEtapas([
				sec({ etapa: 1, etapaTitulo: 'A' }),
				sec({ etapa: 1, etapaTitulo: 'A' }),
				sec({ etapa: 2 })
			])
		).toEqual([]);
	});

	it('avisa huérfanas, saltos, única etapa y títulos en conflicto', () => {
		const mensajes = problemasEtapas([
			sec({}),
			sec({ etapa: 1, etapaTitulo: 'Uno' }),
			sec({ etapa: 1, etapaTitulo: 'Otro' }),
			sec({ etapa: 3 })
		]).map((p) => p.mensaje);
		expect(mensajes.some((m) => m.includes('no declara etapa'))).toBe(true);
		expect(mensajes.some((m) => m.includes('falta la etapa 2'))).toBe(true);
		expect(mensajes.some((m) => m.includes('títulos distintos'))).toBe(true);
		expect(
			problemasEtapas([sec({ etapa: 2 }), sec({ etapa: 2 })]).map((p) => p.mensaje)[0]
		).toContain('una sola etapa');
	});

	it('marca error un número no entero o menor que 1', () => {
		expect(
			problemasEtapas([sec({ etapa: 0 }), sec({ etapa: 1.5 })]).some((p) => p.nivel === 'error')
		).toBe(true);
	});
});
