import { redirect } from '@sveltejs/kit';

/// Crear un conductor ya no tiene página propia: se hace en el modal del
/// listado, igual que editarlo. Esta ruta queda para no romper enlaces viejos.
export function load({ url }: { url: URL }) {
	const destino = new URLSearchParams(url.searchParams);
	destino.set('tipo', 'conductor');
	destino.set('modal', 'form-conductor');
	redirect(307, `/dashboard/personal?${destino.toString()}`);
}
