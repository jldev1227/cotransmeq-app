import { redirect } from '@sveltejs/kit';

/// Crear un cliente ya no tiene página propia: se hace en el modal del
/// listado, igual que editarlo. Esta ruta queda para no romper enlaces viejos.
export function load() {
	redirect(307, '/dashboard/clientes?nuevo=1');
}
