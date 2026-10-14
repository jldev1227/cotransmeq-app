type SidebarRouteItem = {
	id: string;
	href: string;
};

const ACTIVE_ROUTE_ALIASES: Record<string, string[]> = {
	dashboard: ['/dashboard/actividad'],
	usuarios: ['/dashboard/sesiones', '/dashboard/directorio']
};

/** Resuelve la ruta actual a la entrada del sidebar que le corresponde. */
export function getActiveSectionFromPath(pathname: string, items: SidebarRouteItem[]): string {
	const normalizePath = (path: string) => path.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
	const currentPath = normalizePath(pathname);

	// Usa los enlaces del menú como fuente de verdad. Si un item apunta a una ruta
	// anidada (como el canvas de nómina), la raíz del módulo cubre sus subrutas.
	const candidates = items.flatMap((item) => {
		const href = normalizePath(item.href);
		const moduleRoot = href === '/dashboard' ? href : href.split('/').slice(0, 3).join('/');
		const routes = new Set([
			href,
			...(moduleRoot === '/dashboard' ? [] : [moduleRoot]),
			...(ACTIVE_ROUTE_ALIASES[item.id] ?? [])
		]);

		return [...routes].map((route) => ({ id: item.id, route: normalizePath(route) }));
	})
		.filter(
			({ route }) =>
				currentPath === route || (route !== '/dashboard' && currentPath.startsWith(`${route}/`))
		)
		.sort((a, b) => b.route.length - a.route.length);

	// Inicio solo se activa en su ruta; no debe cubrir todos los módulos.
	return candidates[0]?.id ?? '';
}
