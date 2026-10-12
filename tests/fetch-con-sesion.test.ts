/**
 * `fetchConSesion`: el `fetch` de los clientes que no pasan por `apiClient`.
 *
 * Lo que se fija es lo que antes faltaba: la base con respaldo (sin
 * `VITE_API_URL` se pedía a `undefined/api/...`), el token, y que un 401 saque
 * al login conservando la ruta — salvo en el portal del conductor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Ubicacion = { pathname: string; search: string; href: string };

let ubicacion: Ubicacion;
let fetchFalso: ReturnType<typeof vi.fn>;

function responder(status: number) {
	fetchFalso.mockResolvedValue(new Response('{}', { status }));
}

/// El módulo guarda una bandera para no redirigir dos veces; se recarga en
/// cada prueba para que no se arrastre de una a otra.
async function cargar() {
	vi.resetModules();
	return import('$lib/api/fetchConSesion');
}

beforeEach(() => {
	ubicacion = { pathname: '/dashboard/servicios', search: '?q=renault', href: '' };
	vi.stubGlobal('window', { location: ubicacion });
	vi.stubGlobal('document', { cookie: '' });
	fetchFalso = vi.fn();
	vi.stubGlobal('fetch', fetchFalso);
	localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fetchConSesion', () => {
	it('compone la URL con la misma base que apiClient y pone el token', async () => {
		localStorage.setItem('transmeralda_token', 'jwt-1');
		responder(200);
		const { fetchConSesion, API_BASE } = await cargar();

		await fetchConSesion('/api/salidas-nc');

		const [url, init] = fetchFalso.mock.calls[0];
		expect(url).toBe(`${API_BASE}/api/salidas-nc`);
		expect(API_BASE).not.toContain('undefined');
		expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-1');
	});

	it('respeta una URL absoluta y un Authorization que ya traiga quien llama', async () => {
		localStorage.setItem('transmeralda_token', 'jwt-1');
		responder(200);
		const { fetchConSesion } = await cargar();

		await fetchConSesion('https://api.ejemplo.test/api/x', {
			headers: { Authorization: 'Bearer otro' }
		});

		const [url, init] = fetchFalso.mock.calls[0];
		expect(url).toBe('https://api.ejemplo.test/api/x');
		expect(new Headers(init.headers).get('Authorization')).toBe('Bearer otro');
	});

	it('no pone Content-Type: con FormData lo decide el navegador', async () => {
		responder(200);
		const { fetchConSesion } = await cargar();

		await fetchConSesion('/api/acciones-correctivas/upload', {
			method: 'POST',
			body: new FormData()
		});

		const [, init] = fetchFalso.mock.calls[0];
		expect(new Headers(init.headers).has('Content-Type')).toBe(false);
	});

	it('ante un 401 borra la sesión y lleva al login con la ruta y la consulta', async () => {
		localStorage.setItem('transmeralda_token', 'jwt-1');
		localStorage.setItem('transmeralda_user', '{}');
		responder(401);
		const { fetchConSesion } = await cargar();

		const res = await fetchConSesion('/api/salidas-nc');

		expect(res.status).toBe(401);
		expect(localStorage.getItem('transmeralda_token')).toBeNull();
		expect(localStorage.getItem('transmeralda_user')).toBeNull();
		expect(ubicacion.href).toBe(
			`/login?redirect=${encodeURIComponent('/dashboard/servicios?q=renault')}`
		);
	});

	it('con ignorar401 devuelve el 401 sin tocar la sesión', async () => {
		localStorage.setItem('transmeralda_token', 'jwt-1');
		responder(401);
		const { fetchConSesion } = await cargar();

		await fetchConSesion('/api/notificaciones/web-push/desuscribir', { ignorar401: true });

		expect(localStorage.getItem('transmeralda_token')).toBe('jwt-1');
		expect(ubicacion.href).toBe('');
	});

	it('en el portal del conductor un 401 no redirige al login del equipo', async () => {
		ubicacion.pathname = '/public/portal/formularios';
		localStorage.setItem('transmeralda_token', 'jwt-1');
		responder(401);
		const { fetchConSesion } = await cargar();

		await fetchConSesion('/api/algo');

		expect(ubicacion.href).toBe('');
		expect(localStorage.getItem('transmeralda_token')).toBe('jwt-1');
	});

	it('cualquier otro error se devuelve tal cual, sin cerrar sesión', async () => {
		localStorage.setItem('transmeralda_token', 'jwt-1');
		responder(500);
		const { fetchConSesion } = await cargar();

		const res = await fetchConSesion('/api/salidas-nc');

		expect(res.status).toBe(500);
		expect(localStorage.getItem('transmeralda_token')).toBe('jwt-1');
	});
});
