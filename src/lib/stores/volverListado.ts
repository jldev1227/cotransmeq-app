/**
 * Última URL de un listado, con sus filtros, para que el «Volver» del detalle
 * regrese a donde estaba el usuario.
 *
 * Los listados ya escriben búsqueda, filtros, orden y página en la URL; pero
 * los «Volver» navegaban a la ruta pelada y había que buscar otra vez lo mismo
 * cada vez que se entraba y salía de un registro. Va en sessionStorage para
 * que sobreviva a recargar el detalle y no se cruce entre pestañas.
 *
 * Solo acepta URLs del propio listado: nunca devuelve una ruta ajena aunque
 * alguien haya escrito otra cosa en el storage.
 *
 * Uso: el listado llama a `recordar()` desde `afterNavigate` (cada filtro,
 * página o pestaña que cambia pasa por `goto`, así que cada estado queda
 * anotado) y el detalle navega a `url()`.
 */
export interface MemoriaListado {
	recordar(url: string): void;
	url(): string;
}

export interface OpcionesMemoria {
	/**
	 * Distingue dos memorias sobre la misma ruta. `/dashboard/formularios`
	 * tiene el catálogo y los envíos en pestañas: el detalle de un formulario
	 * vuelve al catálogo y el de un envío a los envíos, cada uno con sus filtros.
	 */
	clave?: string;
	/** Qué URLs del listado se guardan en esta memoria. Por defecto, todas. */
	acepta?: (params: URLSearchParams) => boolean;
	/** Destino si no hay nada guardado. Por defecto, la ruta del listado. */
	porDefecto?: string;
	/**
	 * Parámetros de un solo uso que no se guardan. `?nuevo=1` abre el
	 * formulario de alta al llegar y el listado lo borra con `replaceState`,
	 * que no pasa por `afterNavigate`: sin quitarlo aquí, cada «Volver»
	 * reabría el formulario.
	 */
	descartar?: string[];
}

export function memoriaListado(base: string, opciones: OpcionesMemoria = {}): MemoriaListado {
	const { clave: sufijo, acepta, porDefecto = base, descartar = [] } = opciones;
	const clave = sufijo ? `${base}:listado:${sufijo}` : `${base}:listado`;
	const esDelListado = (url: string) => {
		if (url !== base && !url.startsWith(base + '?')) return false;
		if (!acepta) return true;
		const consulta = url.indexOf('?');
		return acepta(new URLSearchParams(consulta === -1 ? '' : url.slice(consulta + 1)));
	};
	const limpiar = (url: string) => {
		const consulta = url.indexOf('?');
		if (consulta === -1 || !descartar.length) return url;
		const params = new URLSearchParams(url.slice(consulta + 1));
		for (const p of descartar) params.delete(p);
		const resto = params.toString();
		return resto ? `${base}?${resto}` : base;
	};
	return {
		recordar(url) {
			if (!esDelListado(url)) return;
			try {
				sessionStorage.setItem(clave, limpiar(url));
			} catch {
				/* modo privado o storage bloqueado: se vuelve al listado sin filtros */
			}
		},
		url() {
			try {
				const url = sessionStorage.getItem(clave);
				if (url && esDelListado(url)) return url;
			} catch {
				/* idem */
			}
			return porDefecto;
		}
	};
}

export const listadoServicios = memoriaListado('/dashboard/servicios', { descartar: ['ticket'] });
export const listadoAcciones = memoriaListado('/dashboard/acciones-correctivas');
export const listadoAsistencias = memoriaListado('/dashboard/asistencias');
export const listadoClientes = memoriaListado('/dashboard/clientes', { descartar: ['nuevo'] });
export const listadoConductores = memoriaListado('/dashboard/personal', {
	porDefecto: '/dashboard/personal?tipo=conductor',
	acepta: (params) => params.get('tipo') !== 'administrativo',
	descartar: ['nuevo']
});
export const listadoEvaluaciones = memoriaListado('/dashboard/evaluaciones');
export const listadoSarlaft = memoriaListado('/dashboard/sarlaft');
/// El «listado» de nómina es el canvas: anota el periodo (y la hoja) que se veía.
export const listadoNomina = memoriaListado('/dashboard/nomina/canvas');

/// El catálogo y «Mis formularios» comparten memoria; los envíos llevan la suya.
const esVistaEnvios = (p: URLSearchParams) => p.get('vista') === 'envios';
export const listadoFormularios = memoriaListado('/dashboard/formularios', {
	clave: 'catalogo',
	acepta: (p) => !esVistaEnvios(p)
});
export const listadoEnvios = memoriaListado('/dashboard/formularios', {
	clave: 'envios',
	acepta: esVistaEnvios,
	porDefecto: '/dashboard/formularios?vista=envios'
});
