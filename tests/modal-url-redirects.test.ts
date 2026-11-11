import { describe, expect, it } from 'vitest';
import { load as redirigirCliente } from '../src/routes/dashboard/clientes/agregar/+page';
import { load as redirigirConductor } from '../src/routes/dashboard/conductores/agregar/+page';
import { load as redirigirNomina } from '../src/routes/dashboard/nomina/+page';
import { load as redirigirTerceros } from '../src/routes/dashboard/liquidaciones-terceros/+page';
function capturarRedirect(load: () => unknown): { status: number; location: string } {
	try {
		load();
	} catch (error) {
		return error as { status: number; location: string };
	}
	throw new Error('El loader no redirigió');
}
describe('redirects que conservan referencias de modales', () => {
	it('el redirect de alta de cliente abre el formulario y mantiene los filtros', () => {
		const url = new URL('https://app.transmeralda.com/dashboard/clientes/agregar?q=Wilson&pagina=2');
		const redirect = capturarRedirect(() => redirigirCliente({ url } as never));
		const destino = new URL(redirect.location, url);
		expect(redirect.status).toBe(307);
		expect(destino.pathname).toBe('/dashboard/clientes');
		expect(destino.searchParams.get('modal')).toBe('form-cliente');
		expect(destino.searchParams.get('q')).toBe('Wilson');
		expect(destino.searchParams.get('pagina')).toBe('2');
	});
	it('el redirect de alta de conductor preserva parámetros ajenos', () => {
		const url = new URL('https://app.transmeralda.com/dashboard/conductores/agregar?area=operaciones&modalTab=datos');
		const redirect = capturarRedirect(() => redirigirConductor({ url } as never));
		const destino = new URL(redirect.location, url);
		expect(destino.pathname).toBe('/dashboard/personal');
		expect(destino.searchParams.get('modal')).toBe('form-conductor');
		expect(destino.searchParams.get('tipo')).toBe('conductor');
		expect(destino.searchParams.get('area')).toBe('operaciones');
		expect(destino.searchParams.get('modalTab')).toBe('datos');
	});
	it('el redirect de nómina conserva periodo y referencia de modal', () => {
		const url = new URL('https://app.transmeralda.com/dashboard/nomina?anio=2026&mes=10&modal=historial-nomina&modalId=abc');
		const redirect = capturarRedirect(() => redirigirNomina({ url } as never));
		const destino = new URL(redirect.location, url);
		expect(destino.pathname).toBe('/dashboard/nomina/canvas');
		expect(destino.searchParams.get('anio')).toBe('2026');
		expect(destino.searchParams.get('mes')).toBe('10');
		expect(destino.searchParams.get('modal')).toBe('historial-nomina');
		expect(destino.searchParams.get('modalId')).toBe('abc');
	});
	it('el redirect de liquidaciones de terceros conserva la vista solicitada', () => {
		const url = new URL('https://app.transmeralda.com/dashboard/liquidaciones-terceros?tab=ingresos&anio=2025&mes=11&modal=historial-ingresos&modalId=abc&cliente=Cotrans');
		const redirect = capturarRedirect(() => redirigirTerceros({ url } as never));
		const destino = new URL(redirect.location, url);
		expect(destino.pathname).toBe('/dashboard/liquidaciones-terceros/ingresos/canvas');
		expect(destino.searchParams.get('anio')).toBe('2025');
		expect(destino.searchParams.get('mes')).toBe('11');
		expect(destino.searchParams.get('modal')).toBe('historial-ingresos');
		expect(destino.searchParams.get('modalId')).toBe('abc');
		expect(destino.searchParams.get('cliente')).toBe('Cotrans');
	});
});
