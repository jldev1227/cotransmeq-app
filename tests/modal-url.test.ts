import { describe, expect, it } from 'vitest';
import {
	escribirReferenciaModalURL,
	leerReferenciaModalURL,
	mismaReferenciaModal
} from '../src/lib/navigation/modal-url';

describe('referencias de modales en URL', () => {
	it('lee el modal, el registro, la selección y la pestaña', () => {
		const url = new URL(
			'https://app.cotransmeq.com/dashboard/recargos?search=Wilson&modal=detalle-recargo&modalId=a91&modalTab=auditoria&modalIds=uno,dos'
		);

		expect(leerReferenciaModalURL(url)).toEqual({
			key: 'detalle-recargo',
			id: 'a91',
			ids: ['uno', 'dos'],
		tab: 'auditoria'
		});
	});

	it('identifica el desprendible para regenerar la preview al recargar', () => {
		const url = new URL(
			'https://app.transmeralda.com/dashboard/nomina/canvas?anio=2026&mes=11&modal=ver-desprendible&modalId=liq-123'
		);

		expect(leerReferenciaModalURL(url)).toEqual({
			key: 'ver-desprendible',
			id: 'liq-123'
		});
		expect(url.searchParams.get('anio')).toBe('2026');
		expect(url.searchParams.get('mes')).toBe('11');
	});

	it('actualiza un modal preservando filtros y hash', () => {
		const url = new URL('https://app.cotransmeq.com/dashboard/recargos?search=Wilson&mes=11#tabla');
		const destino = escribirReferenciaModalURL(url, {
			key: 'detalle-recargo',
			id: 'a91',
			tab: 'auditoria'
		});

		expect(destino.pathname).toBe('/dashboard/recargos');
		expect(destino.searchParams.get('search')).toBe('Wilson');
		expect(destino.searchParams.get('mes')).toBe('11');
		expect(destino.searchParams.get('modal')).toBe('detalle-recargo');
		expect(destino.searchParams.get('modalId')).toBe('a91');
		expect(destino.searchParams.get('modalTab')).toBe('auditoria');
		expect(destino.hash).toBe('#tabla');
	});

	it('al cerrar, elimina solo los parámetros del modal', () => {
		const url = new URL(
			'https://app.cotransmeq.com/dashboard/recargos?estado=pendiente&modal=detalle-recargo&modalId=a91&modalTab=auditoria&modalIds=uno,dos'
		);
		const destino = escribirReferenciaModalURL(url, null);

		expect(destino.searchParams.get('estado')).toBe('pendiente');
		expect(destino.searchParams.has('modal')).toBe(false);
		expect(destino.searchParams.has('modalId')).toBe(false);
		expect(destino.searchParams.has('modalIds')).toBe(false);
		expect(destino.searchParams.has('modalTab')).toBe(false);
	});

	it('conserva la pestaña al actualizar la misma referencia de modal', () => {
		const url = new URL(
			'https://app.cotransmeq.com/dashboard/recargos?estado=pendiente&modal=detalle-recargo&modalId=a91&modalTab=auditoria'
		);
		const destino = escribirReferenciaModalURL(url, { key: 'detalle-recargo', id: 'a91' });

		expect(destino.searchParams.get('estado')).toBe('pendiente');
		expect(destino.searchParams.get('modalTab')).toBe('auditoria');
	});

	it('cambiar solo la pestaña no cambia la identidad del modal ni su registro', () => {
		expect(
			mismaReferenciaModal(
				{ key: 'detalle-recargo', id: 'a91', tab: 'detalles' },
				{ key: 'detalle-recargo', id: 'a91', tab: 'auditoria' }
			)
		).toBe(true);
	});
});
