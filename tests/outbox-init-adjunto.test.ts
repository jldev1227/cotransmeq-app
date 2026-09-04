/**
 * La red de seguridad del `INIT`: crear el borrador que el servidor no tiene.
 *
 * La cadena nueva ya pone un `BACKUP_DRAFT` por delante, así que esto no debería
 * activarse en un envío encolado por esta versión. Se prueba porque cubre lo que
 * el orden NO puede cubrir: los teléfonos que ya tienen en cola una cadena vieja
 * —sin cabeza, atascada en `SUBMISSION_NOT_FOUND`— y los envíos cuya fila
 * desapareció del servidor después de crearse (borrador descartado desde otro
 * dispositivo, restauración de la base, front apuntando a otro backend).
 *
 * Sin esto habría que pedirle a cada conductor que rehiciera a mano un
 * formulario que ya dio por entregado.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const iniciarAdjunto = vi.fn();
const guardarBorrador = vi.fn();
const getDraft = vi.fn();

vi.mock('$lib/api/formularios-portal', async (original) => {
	const real = await original<typeof import('$lib/api/formularios-portal')>();
	/// `PortalApiError` se conserva REAL: el código distingue los errores con
	/// `instanceof`, así que un doble de la clase haría pasar el test por el
	/// camino equivocado.
	return { ...real, portalFormulariosAPI: { iniciarAdjunto, guardarBorrador } };
});

vi.mock('$lib/offline/forms-db', async (original) => {
	const real = await original<typeof import('$lib/offline/forms-db')>();
	return { ...real, getDraft };
});

const { PortalApiError } = await import('$lib/api/formularios-portal');
const { syncInternals } = await import('$lib/offline/forms-sync');
const { iniciarAdjuntoAsegurando } = syncInternals;

const ENVIO = '11111111-1111-4111-8111-111111111111';

const ADJUNTO = {
	clientAttachmentId: 'adj-1',
	clientSubmissionId: ENVIO,
	fieldId: 'campo-1',
	occurrenceId: null,
	kind: 'PHOTO',
	mimeType: 'image/jpeg',
	byteSize: 2048,
	sha256: 'b'.repeat(64),
	originalName: 'foto.jpg'
} as never;

const BORRADOR = {
	clientSubmissionId: ENVIO,
	assignmentId: 'asig-1',
	versionId: 'ver-1',
	context: {},
	answers: [],
	progress: 40,
	updatedAt: '2026-09-04T10:00:00.000Z',
	createdAt: '2026-09-04T09:00:00.000Z'
};

const noExiste = () =>
	new PortalApiError('SUBMISSION_NOT_FOUND', 'Guarda el borrador antes de subir evidencia.', 404, {
		clientSubmissionId: ENVIO
	});

const OK = { attachmentId: 'srv-1', uploadUrl: 'https://s3/put', alreadyUploaded: false };

beforeEach(() => {
	iniciarAdjunto.mockReset();
	guardarBorrador.mockReset();
	getDraft.mockReset();
});

describe('iniciarAdjuntoAsegurando', () => {
	it('no toca el borrador cuando el init funciona', async () => {
		iniciarAdjunto.mockResolvedValue(OK);

		await expect(iniciarAdjuntoAsegurando(ADJUNTO)).resolves.toEqual(OK);
		expect(guardarBorrador).not.toHaveBeenCalled();
		expect(iniciarAdjunto).toHaveBeenCalledTimes(1);
	});

	it('crea el borrador que falta y reintenta una vez', async () => {
		iniciarAdjunto.mockRejectedValueOnce(noExiste()).mockResolvedValueOnce(OK);
		getDraft.mockResolvedValue(BORRADOR);
		guardarBorrador.mockResolvedValue({ id: 'srv-envio', status: 'DRAFT', alreadySubmitted: false });

		await expect(iniciarAdjuntoAsegurando(ADJUNTO)).resolves.toEqual(OK);

		expect(guardarBorrador).toHaveBeenCalledTimes(1);
		/// Con el borrador del dispositivo, no con uno vacío: lo que se sube es el
		/// trabajo del conductor, que es justamente lo que había que salvar.
		expect(guardarBorrador).toHaveBeenCalledWith(
			ENVIO,
			expect.objectContaining({ assignmentId: 'asig-1', versionId: 'ver-1', progress: 40 })
		);
		expect(iniciarAdjunto).toHaveBeenCalledTimes(2);
	});

	it('no insiste más de una vez', async () => {
		iniciarAdjunto.mockRejectedValue(noExiste());
		getDraft.mockResolvedValue(BORRADOR);
		guardarBorrador.mockResolvedValue({ alreadySubmitted: false });

		await expect(iniciarAdjuntoAsegurando(ADJUNTO)).rejects.toThrow(PortalApiError);
		expect(iniciarAdjunto).toHaveBeenCalledTimes(2);
		expect(guardarBorrador).toHaveBeenCalledTimes(1);
	});

	it('sin borrador local no inventa nada: el 404 es la verdad', async () => {
		iniciarAdjunto.mockRejectedValue(noExiste());
		getDraft.mockResolvedValue(undefined);

		await expect(iniciarAdjuntoAsegurando(ADJUNTO)).rejects.toMatchObject({
			code: 'SUBMISSION_NOT_FOUND'
		});
		expect(guardarBorrador).not.toHaveBeenCalled();
		expect(iniciarAdjunto).toHaveBeenCalledTimes(1);
	});

	it('si el servidor dice que ya se entregó, deja el error original', async () => {
		/// «No existe» y «ya entregado» son incompatibles: hay algo más roto que el
		/// orden de la cola, y reintentar solo cambiaría el error por otro.
		iniciarAdjunto.mockRejectedValue(noExiste());
		getDraft.mockResolvedValue(BORRADOR);
		guardarBorrador.mockResolvedValue({ id: 'srv-envio', status: 'SUBMITTED', alreadySubmitted: true });

		await expect(iniciarAdjuntoAsegurando(ADJUNTO)).rejects.toMatchObject({
			code: 'SUBMISSION_NOT_FOUND'
		});
		expect(iniciarAdjunto).toHaveBeenCalledTimes(1);
	});

	it('deja pasar cualquier otro error sin tocar el borrador', async () => {
		iniciarAdjunto.mockRejectedValue(
			new PortalApiError('ATTACHMENT_TOO_LARGE', 'El archivo supera el límite.', 413, null)
		);
		getDraft.mockResolvedValue(BORRADOR);

		await expect(iniciarAdjuntoAsegurando(ADJUNTO)).rejects.toMatchObject({
			code: 'ATTACHMENT_TOO_LARGE'
		});
		expect(guardarBorrador).not.toHaveBeenCalled();
	});
});
