import { redirect } from '@sveltejs/kit';

/// Crear un cliente ya no tiene página propia: se hace en el modal del
/// listado, igual que editarlo. Esta ruta queda para no romper enlaces viejos.
export function load({ url }: { url: URL }) {
	const destino = new URLSearchParams(url.searchParams);
	destino.set('modal', 'form-cliente');
	redirect(307, `/dashboard/clientes?${destino.toString()}`);
}
