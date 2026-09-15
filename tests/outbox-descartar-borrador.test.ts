/**
 * Descartar un borrador: se va del teléfono ya, y del servidor cuando se pueda.
 *
 * ── QUÉ SE PRUEBA Y POR QUÉ ─────────────────────────────────────────────────
 *
 * Abrir un formulario ya crea el borrador, así que entrar a mirar un
 * preoperacional y salirse dejaba una tarjeta a medias que no había forma de
 * quitar. El descarte tiene dos mitades y las dos son fáciles de hacer mal:
 *
 *  1. **Lo local se borra sin pedirle permiso a la red.** Se diligencia en
 *     patios sin cobertura. Si el borrado esperara la respuesta del servidor,
 *     descartar sin señal no haría nada visible y la tarjeta seguiría ahí —el
 *     portal pinta los borradores de IndexedDB, no los del servidor—.
 *  2. **El servidor se entera igual.** Si el descarte se quedara solo en el
 *     teléfono, la fila seguiría viva allá: invisible para el conductor pero
 *     contándose en el explorador del dashboard, que es el montón de formularios
 *     «abiertos» del que se venía. Por eso va por la cola, que sabe esperar a
 *     que vuelva la señal y sobrevive a que cierren la app.
 *
 * Y un tercer caso que ya mordió dos veces en este módulo: una operación que
 * falla con un error que nadie puede corregir se queda BLOQUEADA para siempre y
 * el conductor ve «Necesita corrección» en un formulario que no tiene nada que
 * corregir. Aquí eso son los dos errores que el ejecutor se traga.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const descartarBorradorAPI = vi.fn();

vi.mock('$lib/api/formularios-portal', async (original) => {
	const real = await original<typeof import('$lib/api/formularios-portal')>();
	/// `PortalApiError` se conserva REAL: el código distingue los errores con
	/// `instanceof`, y un doble de la clase haría pasar el test por el camino
	/// equivocado.
	return { ...real, portalFormulariosAPI: { descartarBorrador: descartarBorradorAPI } };
});

/**
 * Doble de IndexedDB en memoria, no `vi.fn()` sueltos.
 *
 * El descarte BORRA de una tabla y ESCRIBE en otra, y lo que hay que comprobar
 * es el estado resultante —qué quedó en la cola, qué borradores sobreviven—, no
 * qué funciones se llamaron. Con mocks sin estado, un `purgar` que borrara las
 * operaciones equivocadas pasaría el test igual.
 */
let operaciones: any[] = [];
let borradosEnCascada: string[] = [];

vi.mock('$lib/offline/forms-db', async (original) => {
	const real = await original<typeof import('$lib/offline/forms-db')>();
	return {
		...real,
		allOperations: async () => [...operaciones],
		enqueueMany: async (nuevas: any[]) => {
			operaciones.push(...nuevas);
		},
		deleteOperation: async (operationId: string) => {
			operaciones = operaciones.filter((o) => o.operationId !== operationId);
		},
		deleteDraftCascade: async (clientSubmissionId: string) => {
			borradosEnCascada.push(clientSubmissionId);
		},
		allDrafts: async () => [],
		getReceipt: async () => undefined,
		getAssignment: async () => undefined
	};
});

const { PortalApiError } = await import('$lib/api/formularios-portal');
const { descartarBorrador, colaEnvios, syncInternals } = await import('$lib/offline/forms-sync');
const { ejecutarDescarteBorrador } = syncInternals;

const ENVIO = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';

function operacion(type: string, aggregateId: string, operationId = crypto.randomUUID()) {
	return {
		operationId,
		type,
		aggregateId,
		dependsOn: [],
		payload: {},
		state: 'PENDING',
		attempts: 0,
		nextAttemptAt: new Date().toISOString(),
		createdAt: new Date().toISOString()
	};
}

beforeEach(() => {
	descartarBorradorAPI.mockReset();
	operaciones = [];
	borradosEnCascada = [];
});

describe('descartarBorrador', () => {
	it('borra el borrador del teléfono y encola el descarte para el servidor', async () => {
		await descartarBorrador(ENVIO);

		expect(borradosEnCascada).toEqual([ENVIO]);
		expect(operaciones).toHaveLength(1);
		expect(operaciones[0]).toMatchObject({ type: 'DISCARD_DRAFT', aggregateId: ENVIO });
	});

	it('NO llama a la API en el momento: sin señal el descarte funciona igual', async () => {
		await descartarBorrador(ENVIO);

		/// Es la diferencia entre poder descartar en un patio sin cobertura y no
		/// poder. La petición la hace la cola cuando haya red.
		expect(descartarBorradorAPI).not.toHaveBeenCalled();
	});

	it('se lleva por delante las operaciones pendientes de ESE envío y solo de ese', async () => {
		operaciones = [
			operacion('BACKUP_DRAFT', ENVIO),
			operacion('INIT_ATTACHMENT', ENVIO),
			operacion('SUBMIT', ENVIO),
			operacion('BACKUP_DRAFT', OTRO)
		];

		await descartarBorrador(ENVIO);

		/// Un `SUBMIT` rezagado entregaría el formulario que el conductor acaba de
		/// descartar, y un `UPLOAD` subiría evidencia de algo que ya no existe.
		const delEnvio = operaciones.filter((o) => o.aggregateId === ENVIO);
		expect(delEnvio).toHaveLength(1);
		expect(delEnvio[0].type).toBe('DISCARD_DRAFT');
		expect(operaciones.filter((o) => o.aggregateId === OTRO)).toHaveLength(1);
	});

	it('el envío descartado NO aparece como «en cola» en el panel', async () => {
		await descartarBorrador(ENVIO);

		/// Sin borrador ni recibo, la fila saldría sin código ni título —«Envío sin
		/// identificar»— con un botón para reintentar algo que para el conductor ya
		/// no existe. Lo pendiente es una petición de borrado, no trabajo suyo.
		expect(get(colaEnvios)).toHaveLength(0);
	});

	it('un envío con trabajo real de por medio sí sigue apareciendo', async () => {
		operaciones = [operacion('SUBMIT', OTRO)];

		await descartarBorrador(ENVIO);

		const cola = get(colaEnvios);
		expect(cola).toHaveLength(1);
		expect(cola[0].clientSubmissionId).toBe(OTRO);
	});
});

describe('ejecutarDescarteBorrador', () => {
	const op = operacion('DISCARD_DRAFT', ENVIO) as never;

	it('pide al servidor que lo retire', async () => {
		descartarBorradorAPI.mockResolvedValue({ id: 'srv-1', deleted: true });

		await expect(ejecutarDescarteBorrador(op)).resolves.toBeUndefined();
		expect(descartarBorradorAPI).toHaveBeenCalledWith(ENVIO);
	});

	it('ya estaba descartado: termina bien, es el reintento de algo que funcionó', async () => {
		descartarBorradorAPI.mockRejectedValue(
			new PortalApiError('SUBMISSION_DISCARDED', 'Ese formulario se descartó.', 409)
		);

		await expect(ejecutarDescarteBorrador(op)).resolves.toBeUndefined();
	});

	it('se entregó antes de que llegara el descarte: tampoco es un fallo', async () => {
		descartarBorradorAPI.mockRejectedValue(
			new PortalApiError('SUBMISSION_IMMUTABLE', 'Un envío entregado no se descarta.', 409)
		);

		/// El servidor hace bien en negarse, pero para la cola esto termina: el
		/// formulario está entregado, que es mejor desenlace que el que se pedía.
		/// Propagarlo dejaría la operación BLOQUEADA para siempre.
		await expect(ejecutarDescarteBorrador(op)).resolves.toBeUndefined();
	});

	it('lo demás SÍ se propaga: un 500 tiene que reintentarse', async () => {
		descartarBorradorAPI.mockRejectedValue(
			new PortalApiError('INTERNAL_ERROR', 'Error interno.', 500)
		);

		await expect(ejecutarDescarteBorrador(op)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
	});
});
