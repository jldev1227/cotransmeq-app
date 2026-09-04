/**
 * Pruebas del contrato PESV en el frontend.
 *
 * Cubren la lógica que decide QUÉ se pinta, que es donde se cuela el
 * cumplimiento ficticio: un `null` convertido en «0 %», un estado sin token que
 * se queda en blanco, una fecha que se desplaza un día al formatearla.
 *
 * El renderizado de los componentes no se prueba aquí porque el repo no tiene
 * `@testing-library/svelte` instalado; lo que sí se prueba es todo lo que los
 * componentes consumen, y `e2e/pesv-navegacion.spec.ts` cubre el render y la
 * navegación contra la aplicación real.
 */

import { describe, expect, it } from 'vitest';
import {
	ESTADO_COBERTURA,
	ESTADO_INDICADOR,
	ESTADO_REQUISITO,
	ESTADO_REVISION,
	ESTADO_VIGENCIA,
	SEVERIDAD_ALERTA,
	TOKEN_DESCONOCIDO,
	describirPlazo,
	describirTendencia,
	etiquetaArea,
	formatearFecha,
	formatearFraccion,
	formatearValor
} from '../src/lib/components/pesv/estados';
import { CODIGOS_INDICADOR } from '../src/lib/types/pesv-centro';
import type {
	EstadoCobertura,
	EstadoIndicador,
	EstadoRequisito,
	EstadoRevision,
	EstadoVigencia
} from '../src/lib/types/pesv-centro';

describe('formateo de valores de indicador', () => {
	it('un valor nulo se muestra como «Sin datos», nunca como 0', () => {
		// Es la regla central del módulo: un 0 % de cumplimiento es un hallazgo;
		// un «no hay con qué calcularlo» es un problema de captura.
		expect(formatearValor(null, 'PERCENT')).toBe('Sin datos');
		expect(formatearValor(null, 'COUNT')).toBe('Sin datos');
		expect(formatearValor(null, 'CURRENCY')).toBe('Sin datos');
		expect(formatearValor(null, 'RATE')).toBe('Sin datos');
	});

	it('un cero real sí se muestra como cero', () => {
		// Cero siniestros con operación es un dato legítimo y tiene que verse.
		expect(formatearValor(0, 'COUNT')).toBe('0');
		expect(formatearValor(0, 'PERCENT')).toBe('0 %');
	});

	it('NaN e Infinity se tratan como ausencia de dato', () => {
		expect(formatearValor(Number.NaN, 'PERCENT')).toBe('Sin datos');
		expect(formatearValor(Number.POSITIVE_INFINITY, 'PERCENT')).toBe('Sin datos');
	});

	it('cada unidad lleva su sufijo', () => {
		expect(formatearValor(92.5, 'PERCENT')).toBe('92,5 %');
		expect(formatearValor(4, 'RATE')).toBe('4 por millón km');
		expect(formatearValor(12, 'COUNT')).toBe('12');
		expect(formatearValor(1500000, 'CURRENCY')).toContain('1.500.000');
	});
});

describe('fracción numerador/denominador', () => {
	it('el denominador cero se dice con palabras, no como «/ 0»', () => {
		expect(formatearFraccion(3, 0)).toBe('3 / sin denominador');
		expect(formatearFraccion(3, null)).toBe('3 / sin denominador');
	});

	it('sin ninguno de los dos lo declara', () => {
		expect(formatearFraccion(null, null)).toBe('Sin numerador ni denominador');
	});

	it('con ambos formatea la fracción', () => {
		expect(formatearFraccion(45, 60)).toBe('45 / 60');
	});
});

describe('fechas', () => {
	it('no desplaza la fecha un día al formatear', () => {
		// `new Date('2026-03-01')` en Bogotá da el 28 de febrero a las 19:00; sin
		// leer los componentes en UTC, la tabla pintaría el día anterior.
		expect(formatearFecha('2026-03-01')).toContain('01');
		expect(formatearFecha('2026-03-01')).toContain('2026');
		expect(formatearFecha('2026-01-01')).toContain('2026');
	});

	it('acepta un instante ISO y se queda con la parte de fecha', () => {
		expect(formatearFecha('2026-03-01T00:00:00.000Z')).toContain('01');
	});

	it('el nulo no se convierte en una fecha inventada', () => {
		expect(formatearFecha(null)).toBe('—');
		expect(formatearFecha(undefined)).toBe('—');
	});
});

describe('plazos', () => {
	it('distingue vencido, hoy y pendiente', () => {
		expect(describirPlazo(-3)).toBe('Venció hace 3 días');
		expect(describirPlazo(-1)).toBe('Venció hace 1 día');
		expect(describirPlazo(0)).toBe('Vence hoy');
		expect(describirPlazo(1)).toBe('Faltan 1 día');
		expect(describirPlazo(30)).toBe('Faltan 30 días');
	});

	it('sin plazo no se inventa uno', () => {
		expect(describirPlazo(null)).toBe('Sin plazo');
		expect(describirPlazo(undefined)).toBe('Sin plazo');
	});
});

describe('tendencia', () => {
	it('sin período anterior lo dice en vez de mostrar una flecha plana', () => {
		const t = describirTendencia({ direccion: 'SIN_COMPARACION', delta: null, favorable: null });
		expect(t.texto).toContain('Sin período anterior');
	});

	it('interpreta subida y bajada con el signo de la meta', () => {
		const sube = describirTendencia({ direccion: 'SUBE', delta: 5, favorable: true });
		expect(sube.icono).toBe('▲');
		expect(sube.favorable).toBe(true);

		const baja = describirTendencia({ direccion: 'BAJA', delta: -5, favorable: true });
		expect(baja.icono).toBe('▼');
		expect(baja.favorable).toBe(true);
	});
});

describe('tokens de estado', () => {
	const ESTADOS_INDICADOR: EstadoIndicador[] = ['OK', 'ALERTA', 'CRITICO', 'SIN_DATOS'];
	const ESTADOS_REQUISITO: EstadoRequisito[] = [
		'PENDIENTE',
		'EN_PROGRESO',
		'EN_REVISION',
		'CUMPLE',
		'NO_CUMPLE',
		'NO_APLICA'
	];
	const ESTADOS_REVISION: EstadoRevision[] = ['PENDIENTE', 'APROBADO', 'RECHAZADO'];
	const ESTADOS_VIGENCIA: EstadoVigencia[] = ['SIN_FECHA', 'VIGENTE', 'POR_VENCER', 'VENCIDO'];
	const ESTADOS_COBERTURA: EstadoCobertura[] = [
		'CUBIERTO',
		'SIN_CONTRATO',
		'SIN_FUEC',
		'VENCIDO',
		'VEHICULO_NO_COINCIDE',
		'CONDUCTOR_NO_COINCIDE',
		'DOCUMENTOS_NO_VIGENTES',
		'FUEC_ANULADO'
	];

	it('todo estado del contrato tiene token: ninguno se pinta en blanco', () => {
		for (const e of ESTADOS_INDICADOR) expect(ESTADO_INDICADOR[e]).toBeDefined();
		for (const e of ESTADOS_REQUISITO) expect(ESTADO_REQUISITO[e]).toBeDefined();
		for (const e of ESTADOS_REVISION) expect(ESTADO_REVISION[e]).toBeDefined();
		for (const e of ESTADOS_VIGENCIA) expect(ESTADO_VIGENCIA[e]).toBeDefined();
		for (const e of ESTADOS_COBERTURA) expect(ESTADO_COBERTURA[e]).toBeDefined();
	});

	it('cada token trae etiqueta, icono y descripción, no solo color', () => {
		// El color es un canal secundario: hay daltonismo, pantallas malas y
		// capturas en blanco y negro pegadas en un informe.
		const todos = [
			...Object.values(ESTADO_INDICADOR),
			...Object.values(ESTADO_REQUISITO),
			...Object.values(ESTADO_REVISION),
			...Object.values(ESTADO_VIGENCIA),
			...Object.values(ESTADO_COBERTURA),
			...Object.values(SEVERIDAD_ALERTA)
		];
		for (const t of todos) {
			expect(t.etiqueta.length).toBeGreaterThan(0);
			expect(t.icono.length).toBeGreaterThan(0);
			expect(t.descripcion.length).toBeGreaterThan(0);
			expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it('los colores son hex literales y no dependen de la marca', () => {
		// Cotransmeq reasigna la escala `emerald`/`green` de Tailwind a naranja.
		// Si estos estados usaran esas utilidades, «cumple» se vería igual que
		// «alerta» en aquel despliegue.
		expect(ESTADO_INDICADOR.OK.color).toBe('#15803d');
		expect(ESTADO_INDICADOR.ALERTA.color).toBe('#b45309');
		expect(ESTADO_INDICADOR.CRITICO.color).toBe('#b91c1c');
		expect(ESTADO_INDICADOR.OK.color).not.toBe(ESTADO_INDICADOR.ALERTA.color);
	});

	it('«sin datos» explica que no es un cero', () => {
		expect(ESTADO_INDICADOR.SIN_DATOS.descripcion).toContain('No es un cero');
	});

	it('un estado desconocido cae en un token neutro y no revienta', () => {
		const token = ESTADO_INDICADOR['INVENTADO' as EstadoIndicador] ?? TOKEN_DESCONOCIDO;
		expect(token).toBe(TOKEN_DESCONOCIDO);
		expect(token.etiqueta).toBe('—');
	});
});

describe('áreas', () => {
	it('traduce las áreas conocidas', () => {
		expect(etiquetaArea('hseq')).toBe('HSEQ');
		expect(etiquetaArea('talento_humano')).toBe('Talento Humano');
	});

	it('sin área lo dice; un área desconocida se muestra tal cual', () => {
		expect(etiquetaArea(null)).toBe('Sin asignar');
		expect(etiquetaArea('area_nueva')).toBe('area_nueva');
	});
});

describe('catálogo de indicadores', () => {
	it('son exactamente los trece del nivel avanzado', () => {
		expect(CODIGOS_INDICADOR).toHaveLength(14);
		// Catorce códigos para trece indicadores: el 3 se desagrega en RSVI y GRV,
		// tal como los numera la metodología (3.1 y 3.2).
		expect(CODIGOS_INDICADOR).toContain('RSVI');
		expect(CODIGOS_INDICADOR).toContain('GRV');
	});

	it('no hay códigos repetidos', () => {
		expect(new Set(CODIGOS_INDICADOR).size).toBe(CODIGOS_INDICADOR.length);
	});
});
