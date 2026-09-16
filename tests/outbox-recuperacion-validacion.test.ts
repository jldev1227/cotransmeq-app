/**
 * Reproducción del `VALIDATION_ERROR` ocasional del portal.
 *
 * El caso importante no es que la API responda 400 —eso es fácil de simular—,
 * sino el estado que quedaba después: una operación `BLOCKED`, sin borrador
 * local, que decía al conductor «necesita corrección» aunque no tenía nada que
 * abrir. Aquí se fuerza exactamente ese estado y se verifica que la outbox:
 *
 *  1. recupera el backup propio desde el servidor;
 *  2. reconstruye la cadena con ids y dependencias nuevos;
 *  3. limita el rescate automático a una vez;
 *  4. retira la alerta si tampoco existe una copia remota.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const recuperarBorrador = vi.fn();

vi.mock('$lib/api/formularios-portal', async (original) => {
	const real = await original<typeof import('$lib/api/formularios-portal')>();
	return {
		...real,
		portalFormulariosAPI: { borrador: recuperarBorrador }
	};
});

let operaciones: any[] = [];
let draft: any;

vi.mock('$lib/offline/forms-db', async (original) => {
	const real = await original<typeof import('$lib/offline/forms-db')>();
	return {
		...real,
		allDrafts: async () => (draft ? [draft] : []),
		allOperations: async () => [...operaciones],
		allReceipts: async () => [],
		attachmentsForSubmission: async () => [],
		deleteDraftCascade: async () => {
			draft = undefined;
		},
		deleteOperation: async (operationId: string) => {
			operaciones = operaciones.filter((o) => o.operationId !== operationId);
		},
		enqueueMany: async (nuevas: any[]) => {
			operaciones.push(...nuevas);
		},
		getAssignment: async () => undefined,
		getAttachment: async () => undefined,
		getDraft: async () => draft,
		getMeta: async () => undefined,
		getReceipt: async () => undefined,
		markDraftBlocked: async (_id: string, blocked: unknown) => {
			if (!draft) return;
			if (blocked) draft.blocked = blocked;
			else delete draft.blocked;
		},
		patchAttachment: async () => undefined,
		patchOperation: async (operationId: string, patch: Record<string, unknown>) => {
			const index = operaciones.findIndex((o) => o.operationId === operationId);
			if (index >= 0) operaciones[index] = { ...operaciones[index], ...patch };
		},
		putAttachment: async () => undefined,
		putDraft: async (nuevo: any) => {
			draft = { ...nuevo, updatedAt: '2026-09-16T14:00:00.000Z' };
			return draft;
		},
		putReceipt: async () => undefined,
		setMeta: async () => undefined
	};
});

const { PortalApiError } = await import('$lib/api/formularios-portal');
const { syncInternals } = await import('$lib/offline/forms-sync');
const { manejarError } = syncInternals;

const ENVIO = '11111111-1111-4111-8111-111111111111';
const ASIGNACION = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const CAMPO = '44444444-4444-4444-8444-444444444444';

function operacionAtascada() {
	return {
		operationId: '55555555-5555-4555-8555-555555555555',
		type: 'SUBMIT',
		aggregateId: ENVIO,
		dependsOn: [],
		payload: { offlineCreated: true },
		state: 'RUNNING',
		attempts: 0,
		nextAttemptAt: '2026-09-16T13:00:00.000Z',
		createdAt: '2026-09-16T13:00:00.000Z'
	};
}

function backupServidor() {
	return {
		submission: {
			id: '66666666-6666-4666-8666-666666666666',
			clientSubmissionId: ENVIO,
			assignmentId: ASIGNACION,
			versionId: VERSION,
			status: 'DRAFT',
			context: { vehicleId: '77777777-7777-4777-8777-777777777777' },
			startedAt: '2026-09-16T12:00:00.000Z',
			updatedAt: '2026-09-16T13:05:00.000Z',
			businessDate: '2026-09-16',
			periodKey: '2026-09-16',
			submittedAt: null,
			version: { code: 'HSEQ-FR-08', title: 'Preoperacional' },
			device: { progress: 100 },
			answers: [
				{
					fieldId: CAMPO,
					occurrenceId: null,
					rowIndex: null,
					value: 'B',
					optionValues: ['B']
				}
			],
			attachments: []
		},
		definition: { id: VERSION, title: 'Preoperacional' }
	};
}

beforeEach(() => {
	recuperarBorrador.mockReset();
	draft = undefined;
	operaciones = [operacionAtascada()];
});

describe('recuperación de VALIDATION_ERROR', () => {
	it('restaura el backup y reconstruye el envío en vez de pedir una corrección imposible', async () => {
		recuperarBorrador.mockResolvedValue(backupServidor());
		const original = operaciones[0];

		const resultado = await manejarError(
			original,
			new PortalApiError('VALIDATION_ERROR', 'El envío no tiene el formato esperado.', 400, [
				{ path: 'answers.0.fieldId', message: 'Invalid uuid' }
			])
		);

		expect(resultado).toBe('retry');
		expect(recuperarBorrador).toHaveBeenCalledWith(ENVIO);
		expect(draft).toMatchObject({
			clientSubmissionId: ENVIO,
			assignmentId: ASIGNACION,
			versionId: VERSION,
			progress: 100,
			answers: [{ fieldId: CAMPO, optionValues: ['B'] }]
		});
		expect(draft.blocked).toBeUndefined();

		expect(operaciones).toHaveLength(1);
		expect(operaciones[0]).toMatchObject({
			type: 'SUBMIT',
			aggregateId: ENVIO,
			state: 'PENDING',
			payload: { offlineCreated: true, schemaRecoveryAttempts: 1 }
		});
		expect(operaciones[0].operationId).not.toBe(original.operationId);
	});

	it('retira la operación huérfana si no existe original local ni backup remoto', async () => {
		recuperarBorrador.mockRejectedValue(
			new PortalApiError('SUBMISSION_NOT_FOUND', 'El borrador no existe.', 404)
		);

		const resultado = await manejarError(
			operaciones[0],
			new PortalApiError('VALIDATION_ERROR', 'El envío no tiene el formato esperado.', 400)
		);

		expect(resultado).toBe('ok');
		expect(operaciones).toEqual([]);
	});
});
