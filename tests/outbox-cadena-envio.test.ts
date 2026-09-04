/**
 * El ORDEN de la cadena de un envío del portal.
 *
 * Esto prueba una regresión concreta y cara: hasta ahora la cadena empezaba por
 * el `INIT` del primer adjunto, y la fila del envío en el servidor solo la crean
 * el `BACKUP_DRAFT` o el `SUBMIT` —que iba al final—. Un formulario diligenciado
 * sin señal salía a la red pidiendo una URL de subida para un envío que el
 * servidor no conocía y recibía `SUBMISSION_NOT_FOUND`, un 404 que la cola marca
 * `BLOCKED` y no reintenta nunca. El conductor veía «Necesita corrección: Guarda
 * el borrador antes de subir evidencia» sin nada que pudiera corregir.
 *
 * No se prueba `encolarEnvio` sino `construirCadenaEnvio`: la primera escribe en
 * IndexedDB, que aquí no existe, y lo que decide si el envío llega es la cadena,
 * no el almacenamiento. El planificador se replica al final del archivo con la
 * MISMA regla que `claimNextOperation` —dependencias resueltas por ausencia—
 * para comprobar el orden real de salida y no solo la forma del grafo.
 */

import { describe, expect, it } from 'vitest';
import { construirCadenaEnvio } from '$lib/offline/forms-sync';
import type { OutboxOperation, StoredAttachment } from '$lib/offline/forms-db';

const ENVIO = '11111111-1111-4111-8111-111111111111';

function adjunto(id: string, state: StoredAttachment['state'] = 'LOCAL'): StoredAttachment {
	return {
		clientAttachmentId: id,
		clientSubmissionId: ENVIO,
		fieldId: 'campo-1',
		occurrenceId: null,
		kind: 'PHOTO',
		mimeType: 'image/jpeg',
		byteSize: 1024,
		sha256: 'a'.repeat(64),
		originalName: `${id}.jpg`,
		blob: new Blob([]),
		state,
		createdAt: '2026-09-04T10:00:00.000Z'
	} as StoredAttachment;
}

function cadena(adjuntos: StoredAttachment[], descartes: string[] = []) {
	return construirCadenaEnvio({
		clientSubmissionId: ENVIO,
		adjuntos,
		descartesPendientes: descartes,
		offlineCreated: false
	});
}

/** Réplica de la regla de `claimNextOperation`: una dependencia viva bloquea. */
function ordenDeSalida(operaciones: OutboxOperation[]): string[] {
	const cola = [...operaciones];
	const salida: string[] = [];

	while (cola.length) {
		const vivos = new Set(cola.map((o) => o.operationId));
		const indice = cola.findIndex((o) => o.dependsOn.every((dep) => !vivos.has(dep)));
		/// Si nada es elegible hay un ciclo o una dependencia externa: se corta y el
		/// test lo delata comparando contra la secuencia esperada.
		if (indice === -1) break;
		salida.push(cola[indice]!.type);
		cola.splice(indice, 1);
	}

	return salida;
}

describe('construirCadenaEnvio', () => {
	it('pone el backup del borrador ANTES de cualquier init de adjunto', () => {
		const operaciones = cadena([adjunto('a'), adjunto('b')]);

		expect(operaciones[0]!.type).toBe('BACKUP_DRAFT');

		const backup = operaciones[0]!.operationId;
		const inits = operaciones.filter((o) => o.type === 'INIT_ATTACHMENT');
		expect(inits).toHaveLength(2);
		for (const init of inits) expect(init.dependsOn).toContain(backup);
	});

	it('saca el backup primero también al ejecutar la cola', () => {
		const orden = ordenDeSalida(cadena([adjunto('a')]));

		expect(orden).toEqual([
			'BACKUP_DRAFT',
			'INIT_ATTACHMENT',
			'UPLOAD_ATTACHMENT',
			'COMPLETE_ATTACHMENT',
			'SUBMIT'
		]);
	});

	it('encadena init → upload → complete por adjunto', () => {
		const operaciones = cadena([adjunto('a'), adjunto('b')]);

		for (const id of ['a', 'b']) {
			const init = operaciones.find(
				(o) => o.type === 'INIT_ATTACHMENT' && o.payload.clientAttachmentId === id
			)!;
			const upload = operaciones.find(
				(o) => o.type === 'UPLOAD_ATTACHMENT' && o.payload.clientAttachmentId === id
			)!;
			const complete = operaciones.find(
				(o) => o.type === 'COMPLETE_ATTACHMENT' && o.payload.clientAttachmentId === id
			)!;

			expect(upload.dependsOn).toEqual([init.operationId]);
			expect(complete.dependsOn).toEqual([upload.operationId]);
		}
	});

	it('hace que el SUBMIT espere a todos los complete', () => {
		const operaciones = cadena([adjunto('a'), adjunto('b')]);
		const submit = operaciones.at(-1)!;
		const completes = operaciones
			.filter((o) => o.type === 'COMPLETE_ATTACHMENT')
			.map((o) => o.operationId);

		expect(submit.type).toBe('SUBMIT');
		for (const complete of completes) expect(submit.dependsOn).toContain(complete);
	});

	it('sin evidencia que subir no encola backup: el SUBMIT crea la fila', () => {
		const operaciones = cadena([]);

		expect(operaciones.map((o) => o.type)).toEqual(['SUBMIT']);
		expect(operaciones[0]!.dependsOn).toEqual([]);
	});

	it('ignora los adjuntos que ya están en S3', () => {
		const operaciones = cadena([adjunto('a', 'UPLOADED'), adjunto('b')]);

		const conAdjunto = operaciones.filter((o) => o.payload.clientAttachmentId);
		expect(new Set(conAdjunto.map((o) => o.payload.clientAttachmentId))).toEqual(new Set(['b']));
		/// Queda uno por subir, así que la cabeza sigue haciendo falta.
		expect(operaciones[0]!.type).toBe('BACKUP_DRAFT');
	});

	it('no encola backup si TODA la evidencia ya está subida', () => {
		const operaciones = cadena([adjunto('a', 'UPLOADED')]);

		expect(operaciones.map((o) => o.type)).toEqual(['SUBMIT']);
	});

	it('mantiene los descartes pendientes como prerrequisito del envío', () => {
		const operaciones = cadena([adjunto('a')], ['descarte-1', 'descarte-2']);
		const submit = operaciones.at(-1)!;

		expect(submit.dependsOn).toContain('descarte-1');
		expect(submit.dependsOn).toContain('descarte-2');
	});

	it('no inventa dependencias fuera de la cadena', () => {
		const operaciones = cadena([adjunto('a'), adjunto('b')]);
		const propias = new Set(operaciones.map((o) => o.operationId));

		for (const operacion of operaciones) {
			for (const dep of operacion.dependsOn) expect(propias.has(dep)).toBe(true);
		}
	});

	it('deja todas las operaciones listas para ejecutarse', () => {
		const operaciones = cadena([adjunto('a')]);

		for (const operacion of operaciones) {
			expect(operacion.state).toBe('PENDING');
			expect(operacion.attempts).toBe(0);
			expect(operacion.aggregateId).toBe(ENVIO);
		}
	});
});
