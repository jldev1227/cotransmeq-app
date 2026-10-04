/**
 * Módulos del panel: la lista única que pinta el menú lateral.
 *
 * Vivía dentro de `Sidebar.svelte`; se sacó para que la compartiera el
 * buscador «Ir a…» de la cabecera, hoy reemplazado por el asistente de IA. El
 * backend tiene su espejo en `modules/asistente/modulos.ts` (etiqueta y ruta
 * por módulo): si se añade una entrada aquí hay que añadirla allí, o el
 * asistente dirá que esa pantalla no existe. Los permisos se aplican con
 * `checkAccess`, igual que antes.
 */
import type { ComponentType } from 'svelte';
import {
	BookUser,
	Building2,
	Calculator,
	CalendarCheck,
	ClipboardPen,
	HandCoins,
	IdCard,
	LayoutTemplate,
	ListChecks,
	ReceiptText,
	Route,
	ShieldCheck,
	Timer,
	TrafficCone,
	TriangleAlert,
	Truck,
	UserCog,
	Wallet,
	Wrench
} from 'lucide-svelte';

export type MenuItem = {
	id: string;
	label: string;
	/// Componente de `lucide-svelte`, no un nombre de icono. Antes esto era una
	/// cadena que `getIcon()` resolvía contra un mapa de SVG escritos a mano e
	/// inyectados con `{@html}`: un `icon` mal escrito renderizaba un hueco en
	/// silencio. Con el componente, eso es un error de compilación.
	icon: ComponentType;
	badge: string | null;
	href: string;
};

export const MENU_ITEMS: MenuItem[] = [
	// {
	// 	id: 'dashboard',
	// 	label: 'Dashboard',
	// 	icon: LayoutDashboard,
	// 	badge: null,
	// 	href: '/dashboard'
	// },
	{
		id: 'flota',
		label: 'Flota',
		icon: Truck,
		badge: null,
		href: '/dashboard/flota'
	},
	{
		id: 'conductores',
		label: 'Conductores',
		/// Licencia, no «personas»: `Users` era la silueta genérica y competía
		/// con `UserCog` de Equipo. Un conductor se identifica por su pase.
		icon: IdCard,
		badge: null,
		href: '/dashboard/conductores'
	},
	{
		id: 'servicios',
		label: 'Servicios',
		/// Un reloj describía la planilla, no el servicio. `Route` es el trayecto,
		/// que es lo que se despacha aquí, y deja el reloj libre para «Recargos»,
		/// donde el tiempo sí es lo que se liquida.
		icon: Route,
		// badge: '8',
		badge: null,
		href: '/dashboard/servicios'
	},
	{
		id: 'recargos',
		label: 'Recargos',
		/// Un recargo es tiempo (nocturno, festivo, extra), no una fecha del
		/// calendario. Además deja `CalendarCheck` de Asistencias como el
		/// único calendario del menú.
		icon: Timer,
		badge: null,
		href: '/dashboard/recargos'
	},
	{
		id: 'clientes',
		label: 'Clientes',
		icon: Building2,
		badge: null,
		href: '/dashboard/clientes'
	},
	{
		id: 'sarlaft',
		label: 'SARLAFT / PTEE',
		/// Lupa sobre documento: el módulo es debida diligencia sobre terceros,
		/// no el archivo genérico que sugería el icono de documento.
		/// SARLAFT/PTEE es cumplimiento y prevención de riesgo, no búsqueda
		/// documental. `FileSearch` además se confundía con `FileStack`.
		icon: ShieldCheck,
		badge: null,
		href: '/dashboard/sarlaft'
	},
	{
		id: 'asistencias',
		label: 'Asistencias',
		icon: CalendarCheck,
		badge: null,
		href: '/dashboard/asistencias'
	},
	{
		id: 'acciones-correctivas',
		label: 'Acciones C/P',
		/// Antes compartía escudo con PESV y los dos se leían como «seguridad».
		/// Una acción correctiva es una reparación: la llave inglesa lo separa.
		icon: Wrench,
		badge: null,
		href: '/dashboard/acciones-correctivas'
	},
	{
		id: 'evaluaciones',
		label: 'Evaluaciones',
		/// Lista de criterios calificados. Sin portapapeles: ese glifo queda
		/// para «Mis formularios», que es donde de verdad se diligencia.
		icon: ListChecks,
		badge: null,
		href: '/dashboard/evaluaciones'
	},
	{
		id: 'salidas-nc',
		label: 'Salidas NC',
		icon: TriangleAlert,
		badge: null,
		href: '/dashboard/salidas-nc'
	},
	{
		id: 'formularios',
		label: 'Formularios',
		/// El CONSTRUCTOR: se arman plantillas colocando bloques. Distinguirlo
		/// de «Mis formularios» importa más que ningún otro par del menú,
		/// porque son el mismo dominio visto desde los dos lados —quien
		/// diseña el formato y quien lo rellena—.
		icon: LayoutTemplate,
		badge: null,
		href: '/dashboard/formularios'
	},
	{
		/**
		 * Entrada propia y no un enlace dentro de «Formularios».
		 *
		 * `formularios` es el módulo del constructor y solo lo tienen
		 * `administracion`/`hseq`/`operaciones`. `mis-formularios` es
		 * `general: true`, así que esta es la única entrada que ve alguien de
		 * contabilidad o mantenimiento a quien le asignaron un formato —y son
		 * exactamente las personas que necesitan llegar aquí—.
		 */
		id: 'mis-formularios',
		label: 'Mis formularios',
		/// Portapapeles con PLUMA: aquí se diligencia. `ClipboardCheck` era
		/// indistinguible del `ClipboardList` de Evaluaciones a este tamaño.
		icon: ClipboardPen,
		badge: null,
		href: '/dashboard/mis-formularios'
	},
	{
		id: 'nomina',
		label: 'Nómina',
		icon: Wallet,
		badge: null,
		/// El módulo ya no tiene listado: su puerta es el canvas.
		href: '/dashboard/nomina/canvas'
	},
	// {
	// 	id: 'extractos',
	// 	label: 'Extractos',
	// 	icon: FileText,
	// 	badge: null,
	// 	href: '/dashboard/extractos'
	// },
	{
		id: 'liquidaciones-servicios',
		label: 'Liq. Servicios',
		icon: ReceiptText,
		badge: null,
		/// Entra directo al canvas de historial, igual que «Liq. Terceros»: el
		/// listado de `/dashboard/liquidaciones-servicios` es la capa pre-Univer
		/// y sigue accesible por url, pero ya no es la puerta del módulo.
		href: '/dashboard/liquidaciones-servicios'
	},
	{
		id: 'liquidaciones-terceros',
		label: 'Liq. Terceros',
		/// «Liq. Servicios» y «Liq. Terceros» llevaban el mismo recibo, así que
		/// colapsado el menú eran indistinguibles. Terceros es el pago que sale
		/// hacia afuera; de ahí las monedas en la mano.
		icon: HandCoins,
		badge: null,
		href: '/dashboard/liquidaciones-terceros'
	},
	// «Liq. Terceros — Adicionales» se eliminó del menú: el canvas de
	// adicionales se abre desde el selector «Ir a…» del toolbar del canvas
	// de cierres, que es a donde /dashboard/liquidaciones-terceros redirige.
	// OJO: el moduleId `liquidaciones-terceros-adicionales` SIGUE existiendo en
	// `config/permissions.ts` porque el `+layout@.svelte` del canvas se lo pasa
	// a `UniverAuthGuard`, y `checkAccess` deniega todo moduleId desconocido.
	{
		id: 'pesv',
		label: 'PESV',
		/// Seguridad vial, no seguridad a secas: el cono lo dice sin repetir el
		/// escudo que ya usaban «Acciones C/P».
		icon: TrafficCone,
		badge: null,
		href: '/dashboard/pesv'
	},
	{
		id: 'certificados',
		label: 'Certificados',
		icon: Calculator,
		badge: null,
		href: '/dashboard/certificados'
	},
	{
		id: 'terceros',
		label: 'Terceros',
		icon: BookUser,
		badge: null,
		href: '/dashboard/terceros'
	},
	{
		id: 'usuarios',
		label: 'Equipo',
		/// La entrada cubre usuarios, sesiones y directorio: es administración de
		/// cuentas, y el engranaje la distingue de «Conductores», que también son
		/// personas pero no se gestionan aquí.
		icon: UserCog,
		badge: null,
		href: '/dashboard/usuarios'
	}
	// {
	// 	id: 'rutas',
	// 	label: 'Rutas',
	// 	icon: Map,
	// 	badge: null,
	// 	href: '/dashboard/rutas'
	// },
	// {
	// 	id: 'planillas',
	// 	label: 'Planillas',
	// 	icon: Calendar,
	// 	badge: '3',
	// 	href: '/dashboard/planillas'
	// }
	// {
	// 	id: 'reportes',
	// 	label: 'Reportes',
	// 	icon: ChartColumn,
	// 	badge: null,
	// 	href: '/dashboard/reportes'
	// },
	// {
	// 	id: 'configuracion',
	// 	label: 'Configuración',
	// 	icon: Settings,
	// 	badge: null,
	// 	href: '/dashboard/configuracion'
	// }
];
