import { redirect } from '@sveltejs/kit';

/// Crear un conductor ya no tiene página propia: se hace en el modal del
/// listado, igual que editarlo. Esta ruta queda para no romper enlaces viejos.
export function load() {
	redirect(307, '/dashboard/conductores?nuevo=1');
}
