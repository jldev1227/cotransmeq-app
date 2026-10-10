/**
 * Generador de PDF Desprendible de Nómina usando pdfmake
 * Portado de pdfMaker.tsx (@react-pdf/renderer) a pdfmake - IGUALADO
 */
import type { Liquidacion, FirmaConUrl } from '$lib/types/nomina';
import { aplicarMarcasDias, leerMarcasDias } from '$lib/utils/marcasDias';
import { blobDePdf, cargarPdfMake } from '$lib/utils/pdfmake-cargar';
import {
	logoPngDataUrl,
	paginaControlDias,
	type ControlDias
} from '$lib/utils/pdfControlDias';
import {
	cabeceraSeccion,
	firmaConductor,
	paginaPrincipalDiseno2,
	pieDocumento,
	type LineaDiseno,
	type MarcaDesprendible
} from '$lib/utils/pdfDesprendibleDiseno';

const PAREX_EMPRESA_ID = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';
const GEOPARK_EMPRESA_ID = 'eea5eda5-1b60-45a0-b4c7-606a8c908ff9';

/** Colores e imágenes del diseño 2 para esta empresa. */
const MARCA_DISENO: Omit<MarcaDesprendible, 'razonSocial' | 'nit' | 'logo' | 'mascota' | 'sello'> & {
	logoUrl: string;
	mascotaUrl: string;
	selloUrl: string;
} = {
	nombre: 'Cotransmeq',
	oscuro: '#14532D',
	suave: '#FFEDD5',
	acento: '#F97316',
	kicker: '#FDBA74',
	periodo: '#FFEDD5',
	borde: '#FED7AA',
	fondoSuave: '#FFF7ED',
	logoUrl: '/assets/logo_nombre_white.webp',
	mascotaUrl: '/mascot/trabajando.webp',
	selloUrl: '/assets/sello-firma-terceros.jpg'
};

function formatCurrency(value: number | string | null | undefined): string {
	const num = Number(value) || 0;
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(num);
}

function formatDate(dateStr: string | null | undefined): string {
	if (!dateStr) return 'Sin fecha';
	// Agregar T12:00:00Z para evitar desfase de -1 día por timezone
	const safe = dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00Z';
	const date = new Date(safe);
	if (isNaN(date.getTime())) return 'Sin fecha';
	return date.toLocaleDateString('es-CO', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	});
}

function monthAndYear(dateStr: string | null | undefined): string {
	if (!dateStr) return '';
	const date = new Date(dateStr + 'T00:00:00');
	if (isNaN(date.getTime())) return '';
	return date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).toUpperCase();
}

function safeValue(val: any, def: any = '') {
	return val !== undefined && val !== null ? val : def;
}

function parseValues(values: any): any[] {
	if (Array.isArray(values)) return values;
	if (typeof values === 'string') {
		try {
			const parsed = JSON.parse(values);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

/**
 * Agrupa fechas consecutivas en rangos legibles
 * Ej: ["2024-01-01","2024-01-02","2024-01-03","2024-01-10"] → ["1-3 ene", "10 ene"]
 */
function agruparFechasConsecutivas(fechas: string[]): string[] {
	if (!fechas || fechas.length === 0) return [];

	const sorted = [...fechas].sort();
	const rangos: string[] = [];
	let inicio = sorted[0];
	let fin = sorted[0];

	for (let i = 1; i < sorted.length; i++) {
		const current = new Date(sorted[i] + 'T00:00:00');
		const prev = new Date(fin + 'T00:00:00');
		const diff = (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

		if (diff === 1) {
			fin = sorted[i];
		} else {
			rangos.push(formatearRango(inicio, fin));
			inicio = sorted[i];
			fin = sorted[i];
		}
	}
	rangos.push(formatearRango(inicio, fin));

	return rangos;
}

function formatearRango(inicio: string, fin: string): string {
	const dInicio = new Date(inicio + 'T00:00:00');
	const dFin = new Date(fin + 'T00:00:00');
	const mesInicio = dInicio.toLocaleDateString('es-CO', { month: 'short' });

	if (inicio === fin) {
		return `${dInicio.getDate()} ${mesInicio}`;
	}

	const mesFin = dFin.toLocaleDateString('es-CO', { month: 'short' });
	if (mesInicio === mesFin) {
		return `${dInicio.getDate()}-${dFin.getDate()} ${mesInicio}`;
	}
	return `${dInicio.getDate()} ${mesInicio} - ${dFin.getDate()} ${mesFin}`;
}

/**
 * Calcula la diferencia en días entre dos fechas (inclusiva: cuenta ambos extremos)
 * Ej: del 1 al 5 = 5 días (1, 2, 3, 4, 5)
 */
/**
 * «Licencia de maternidad», «de paternidad» o las dos, por la inicial del
 * género de la ficha. Misma regla que `rotuloLicencia` del canvas: sin género
 * no se adivina.
 */
function rotuloLicencia(genero: string | null | undefined): string {
	const g = String(genero ?? '')
		.trim()
		.toUpperCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	if (g.startsWith('F')) return 'Licencia de maternidad';
	if (g.startsWith('M')) return 'Licencia de paternidad';
	return 'Licencia de maternidad / paternidad';
}

function obtenerDiferenciaDias(startStr: string, endStr: string): number {
	try {
		const start = new Date(startStr + 'T00:00:00');
		const end = new Date(endStr + 'T00:00:00');
		if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
		return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
	} catch {
		return 0;
	}
}

/**
 * Convierte una URL de imagen a base64 data URL
 */
async function imageToBase64Url(url: string): Promise<string> {
	// Si ya es un data URL base64, retornarlo directamente
	if (url.startsWith('data:')) {
		return url;
	}
	const response = await fetch(url);
	const blob = await response.blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

/**
 * Arma el `docDefinition` del desprendible SIN abrirlo.
 *
 * Se extrajo de `generarPdfDesprendible` para que el canvas de nomina pueda
 * producir el mismo documento como Blob y meterlo en un ZIP. El contenido no
 * cambia: lo unico que se movio fuera es la llamada final a `.open()`.
 */
// ─── Días marcados «no sumar» (`marcas_dias`) ────────────────────────────
//
// Se imprimen en la tabla de días —en gris— y NO entran en sus totales ni en
// el neto. Pero su VALOR tiene que verse: si no, el conductor ve horas que no
// sabe cuánto valen ni por qué no se le pagan, y una tabla cuyos días son
// todos «no sumar» salía entera en ceros. Por eso llevan su propia fila de
// totales y su propio consolidado, rotulados como referencia.

const GRIS_NO_SUMA = '#6B7280';
const FONDO_NO_SUMA = '#F3F4F6';
const CODIGOS_TABLA = ['HED', 'RN', 'HEN', 'RD', 'RNDF', 'HEFD', 'HEFN'];

/** Los días que no suman, sin los de disponibilidad (esos ya no suman por otra vía). */
function diasNoSuman(dias: any[]): any[] {
	return dias.filter((d: any) => d.no_suma && !d.disponibilidad);
}

/** «1 día», «13 días»: el recuento de las filas SUMAN / NO SUMAN. */
export const rotuloDias = (n: number): string => `${n} ${n === 1 ? 'día' : 'días'}`;

/** Fila «NO SUMAN» bajo los totales de la tabla de días: días y horas por tipo. */
export function filaTotalesNoSuma(dias: any[]): any[][] {
	const ns = diasNoSuman(dias);
	if (!ns.length) return [];
	const celda = (text: string, bold = false) => ({
		text,
		bold,
		fontSize: 8,
		alignment: 'center' as const,
		color: GRIS_NO_SUMA,
		fillColor: FONDO_NO_SUMA,
		margin: [0, 2, 0, 2]
	});
	const horasDe = (codigo: string) =>
		ns.reduce((s: number, d: any) => {
			const r = d.recargos?.find((rc: any) => rc.tipo_codigo === codigo);
			return s + (r ? Number(r.horas) || 0 : 0);
		}, 0);
	return [
		[
			celda('NO SUMAN', true),
			celda(rotuloDias(ns.length), true),
			celda(ns.reduce((s: number, d: any) => s + (Number(d.total_horas) || 0), 0).toFixed(2), true),
			...CODIGOS_TABLA.map((c) => {
				const h = horasDe(c);
				return celda(h ? h.toFixed(2) : '-');
			})
		]
	];
}

/**
 * Consolidado de los días que no suman: la misma tabla por tipo de recargo que
 * TOTALES CONSOLIDADOS, en gris, y una barra con lo que se reconoce por otro
 * concepto: no es recargo, pero tampoco se pierde.
 */
export function bloqueNoSuman(dias: any[]): any[] {
	const ns = diasNoSuman(dias);
	const tipos = new Map<
		string,
		{ codigo: string; nombre: string; porcentaje: number; base: number; calc: number; horas: number; valor: number }
	>();
	for (const d of ns) {
		for (const r of d.recargos || []) {
			const k = `${r.tipo_codigo}@${r.porcentaje}`;
			const t = tipos.get(k) ?? {
				codigo: r.tipo_codigo,
				nombre: String(r.tipo_nombre ?? r.tipo_codigo),
				porcentaje: Number(r.porcentaje) || 0,
				base: Number(r.valor_hora_base) || 0,
				calc: Number(r.valor_hora_calculada) || 0,
				horas: 0,
				valor: 0
			};
			t.horas += Number(r.horas) || 0;
			t.valor += Number(r.valor_total) || 0;
			tipos.set(k, t);
		}
	}
	if (!tipos.size) return [];
	const lista = [...tipos.values()].sort((a, b) => a.porcentaje - b.porcentaje);
	const total = lista.reduce((s, t) => s + t.valor, 0);
	const txt = (text: string, extra: Record<string, unknown> = {}) => ({
		text,
		fontSize: 9,
		color: GRIS_NO_SUMA,
		alignment: 'center' as const,
		margin: [0, 2, 0, 2],
		...extra
	});
	const cabecera = ['TIPO RECARGO', '%', 'V/BASE', 'V/+ %', 'CANTIDAD', 'VALOR'].map((h, i) =>
		txt(h, { bold: true, fontSize: 8, alignment: i === 0 ? ('left' as const) : ('center' as const), margin: [i === 0 ? 2 : 0, 3, 0, 3] })
	);
	const filas = lista.map((t) => [
		txt(`${t.nombre.toUpperCase()} - ${t.codigo}`, { alignment: 'left' as const, margin: [2, 2, 0, 2] }),
		txt(`${t.porcentaje}%`),
		txt(formatCurrency(t.base)),
		txt(formatCurrency(t.calc)),
		txt(t.horas.toFixed(2)),
		txt(formatCurrency(t.valor), { bold: true })
	]);
	return [
		{
			text: 'DÍAS QUE NO SUMAN · REFERENCIA',
			bold: true,
			fontSize: 10,
			color: GRIS_NO_SUMA,
			alignment: 'center' as const,
			fillColor: FONDO_NO_SUMA,
			margin: [0, 10, 0, 2]
		},
		{
			text: 'No se suman a los recargos, pero se reconocen por otro concepto.',
			fontSize: 8,
			color: GRIS_NO_SUMA,
			alignment: 'center' as const,
			margin: [0, 0, 0, 4]
		},
		{
			table: {
				headerRows: 1,
				widths: ['35%', '10%', '13%', '13%', '13%', '16%'],
				body: [cabecera, ...filas]
			},
			layout: {
				hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5),
				vLineWidth: () => 0.5,
				hLineColor: () => '#E5E7EB',
				vLineColor: () => '#E5E7EB',
				paddingLeft: () => 2,
				paddingRight: () => 2,
				paddingTop: () => 1,
				paddingBottom: () => 1,
				fillColor: (rowIndex: number) => (rowIndex === 0 ? FONDO_NO_SUMA : null)
			}
		},
		{
			table: {
				widths: ['*', 'auto'],
				body: [
					[
						{ text: 'RECONOCIDO POR OTRO CONCEPTO', bold: true, fontSize: 10, color: '#FFFFFF', fillColor: '#9CA3AF', margin: [4, 4, 0, 4] },
						{
							text: formatCurrency(total),
							bold: true,
							fontSize: 10,
							color: '#FFFFFF',
							fillColor: '#9CA3AF',
							alignment: 'right' as const,
							margin: [0, 4, 15, 4]
						}
					]
				]
			},
			layout: 'noBorders'
		}
	];
}

export async function construirDocDefinition(
	item: Liquidacion,
	firmas: FirmaConUrl[] = [],
	recargosData: any = null
): Promise<any> {

	const color = MARCA_DISENO.oscuro;
	const colorBg = MARCA_DISENO.suave;
	const empresa = 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S';
	const nit = '901983227';

	const conductorNombre = `${safeValue(item.conductor?.nombre, 'N/A')}`;
	const conductorCedula = safeValue(
		(item.conductor as any)?.cedula || (item.conductor as any)?.numero_identificacion,
		'N/A'
	);

	// Disponibilidad (viene separada de item.total_recargos en el payload)
	const disponibilidadVal = Number(safeValue(item.disponibilidad, 0));

	// Recargos agrupados por empresa.
	// Fuente ÚNICA: item.recargos (tabla `recargos` con ediciones manuales
	// aplicadas). Deduplicamos por `id` porque el include de Prisma en la
	// query de la liquidación arrastra joins 1:N (dias_laborales_planillas /
	// detalles_recargos_dias) que multiplican las filas del recargo.
	//
	// IMPORTANTE: NO hay fallback a recargosData.planillas. Ese fallback
	// existía para liquidaciones muy viejas donde los recargos automáticos
	// aún no se persistían en la tabla `recargos`, pero hoy siempre se
	// guardan (via `recargos_preview` en `crear` y `actualizar` del backend).
	// El fallback era la raíz de un bug crítico: cuando el usuario desmarcaba
	// todos los recargos del preview y guardaba, `item.recargos` quedaba
	// vacío y el fallback sumaba TODAS las planillas del live preview
	// (incluyendo las desmarcadas) → aparecían en la sumatoria de "OTROS"
	// del PDF. Coincide con la liquidación de Transmeralda donde el
	// `total_recargos` correcto (0) se duplicaba con recargos desmarcados.
	let totalRecargosParex = 0;
	let totalRecargosGeopark = 0;
	let totalRecargosOtros = 0;
	let dedupDebug = { total: 0, unicos: 0 };

	if (item.recargos && item.recargos.length > 0) {
		const unicos = new Map<string, any>();
		for (const r of item.recargos) {
			dedupDebug.total += 1;
			if (!r?.id) continue;
			if (unicos.has(r.id)) continue;
			unicos.set(r.id, r);
		}
		dedupDebug.unicos = unicos.size;

		for (const r of unicos.values()) {
			const valor = Number(r.valor || 0);
			// Respetar la marca "incluir" del preview: si el usuario desmarcó
			// el recargo en la UI (incluir === false), excluirlo de la
			// sumatoria de "OTROS" / PAREX / GEOPARK del desprendible. Sin
			// este filtro, los recargos que el usuario decidió NO incluir
			// en la liquidación seguirían apareciendo en el PDF.
			if (r.incluir === false) continue;
			if (r.empresa_id === PAREX_EMPRESA_ID) {
				totalRecargosParex += valor;
			} else if (r.empresa_id === GEOPARK_EMPRESA_ID) {
				totalRecargosGeopark += valor;
			} else {
				totalRecargosOtros += valor;
			}
		}
	}
	const hayRecargosParex = totalRecargosParex > 0;
	const hayRecargosGeopark = totalRecargosGeopark > 0;

	// CADA BLOQUE DESCUENTA LA SUYA.
	//
	// Había una sola `disponibilidad` para todo el corte y este documento la
	// restaba del cubo MAYOR, bajando al siguiente si sobraba. Era un reparto
	// inventado por el papel —el dato no decía de quién era— y además cada
	// generador se lo inventaba distinto: el que sale por correo empezaba por
	// PAREX en vez de por el mayor, así que el mismo mes podía imprimirse con
	// dos repartos según por dónde se pidiera.
	//
	// Ahora cada cliente con bloque propio tiene su columna y se descuenta de su
	// propia bolsa. `disponibilidad` es la de OTROS, que es lo que venía siendo
	// en las liquidaciones sin PAREX ni GEOPARK.
	const imputar = (bolsa: number, imputado: number) =>
		bolsa - Math.min(Math.max(0, bolsa), Math.max(0, imputado));
	totalRecargosOtros = imputar(totalRecargosOtros, disponibilidadVal);
	totalRecargosParex = imputar(
		totalRecargosParex,
		Number(safeValue((item as any).disponibilidad_parex, 0))
	);
	totalRecargosGeopark = imputar(
		totalRecargosGeopark,
		Number(safeValue((item as any).disponibilidad_geopark, 0))
	);

	console.log('DEBUG RECARGOS', {
		disponibilidadVal,
		totalRecargosParex,
		totalRecargosGeopark,
		totalRecargosOtros,
		recargosRecibidos: dedupDebug.total,
		recargosUnicos: dedupDebug.unicos,
		fuente: item.recargos?.length ? 'item.recargos (tabla)' : 'planillas (fallback)'
	});

	// Bonificaciones agrupadas
	const bonosAgrupados: Record<string, { name: string; quantity: number; totalValue: number }> = {};
	if (item.bonificaciones && item.bonificaciones.length > 0) {
		item.bonificaciones.forEach((b) => {
			const qty = parseValues(b.values).reduce((s: number, v: any) => s + (v.quantity || 0), 0);
			if (bonosAgrupados[b.name]) {
				bonosAgrupados[b.name].quantity += qty;
				bonosAgrupados[b.name].totalValue += qty * Number(b.value);
			} else {
				bonosAgrupados[b.name] = {
					name: b.name,
					quantity: qty,
					totalValue: qty * Number(b.value)
				};
			}
		});
	}

	// Pernotes - fechas agrupadas (igual que pdfMaker)
	// Parsear fechas defensivamente: puede venir como string JSON o como array
	const parseFechas = (fechas: any): string[] => {
		if (Array.isArray(fechas)) return fechas;
		if (typeof fechas === 'string') {
			try {
				const parsed = JSON.parse(fechas);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		}
		return [];
	};

	// Cantidad y valor de pernoctes salen SIEMPRE de las filas de la tabla
	// `pernotes` (cantidad x valor registrado en cada fila). NO se usa el
	// agregado `item.total_pernotes` de la liquidacion: ese campo se calcula
	// con el valor de pernote vigente en la configuracion al momento de
	// guardar, y deja de coincidir con lo registrado si esa configuracion
	// cambia despues (o si la fila se corrigio a mano).
	// Deduplicamos por `id` por si el include de Prisma repite filas.
	const pernotesUnicos: any[] = [];
	if (item.pernotes && item.pernotes.length > 0) {
		const vistosPernotes = new Set<string>();
		(item.pernotes as any[]).forEach((p, idx) => {
			const key = p?.id ?? `sin-id-${idx}`;
			if (vistosPernotes.has(key)) return;
			vistosPernotes.add(key);
			pernotesUnicos.push(p);
		});
	}

	// `cantidad` y `fechas` deberian ir sincronizados; si falta uno usamos el otro.
	const diasDePernote = (p: any): number => {
		const fechas = parseFechas(p.fechas);
		return fechas.length > 0 ? fechas.length : Number(p.cantidad) || 0;
	};

	const cantidadPernotes = pernotesUnicos.reduce((t, p) => t + diasDePernote(p), 0);

	// Fallback al agregado almacenado solo si el payload no trae las filas.
	const totalPernotes =
		pernotesUnicos.length > 0
			? pernotesUnicos.reduce((t, p) => t + diasDePernote(p) * (Number(p.valor) || 0), 0)
			: Number(safeValue(item.total_pernotes, 0));

	let pernoteFechasTexto = '';
	if (pernotesUnicos.length > 0) {
		try {
			const todasLasFechas: string[] = [];
			pernotesUnicos.forEach((pernote) => {
				const fechas = parseFechas(pernote.fechas);
				if (fechas.length > 0) {
					todasLasFechas.push(...fechas);
				}
			});
			const rangos = agruparFechasConsecutivas(todasLasFechas);
			pernoteFechasTexto = rangos.join(', ');
		} catch (error: any) {
			pernoteFechasTexto = error.message || 'Error al recolectar fechas pernoctes';
		}
	}

	// ============================================================
	// PÁGINA 1 · DISEÑO 2
	// ============================================================
	// Los mismos datos y reglas de siempre, pintados con la maquetación
	// aprobada (ver `pdfDesprendibleDiseno.ts`). Ninguna cifra se calcula en el
	// diseño: todo sale de aquí ya resuelto.
	const diasDe = (ini?: string | null, fin?: string | null) =>
		ini && fin ? obtenerDiferenciaDias(String(ini).slice(0, 10), String(fin).slice(0, 10)) : 0;
	const textoDias = (n: number) => (n > 0 ? `${n} día${n === 1 ? '' : 's'}` : '');
	const verDetalle = 'Ver recargos detallados más adelante';

	const basicos: LineaDiseno[] = [
		{
			concepto: 'Salario devengado',
			cantidad: textoDias(Number(safeValue(item.dias_laborados, 0))),
			valor: formatCurrency(item.salario_devengado)
		},
		{ concepto: 'Auxilio de transporte', valor: formatCurrency(item.auxilio_transporte) }
	];
	if (Number(safeValue(item.valor_incapacidad, 0)) > 0) {
		const n =
			diasDe(item.periodo_incapacidad_inicio, item.periodo_incapacidad_fin) ||
			diasDe(item.periodo_start_incapacidad, item.periodo_end_incapacidad);
		basicos.push({ concepto: 'Remuneración por incapacidad', cantidad: textoDias(n) || '-', valor: formatCurrency(item.valor_incapacidad) });
	}
	// Licencia de maternidad o paternidad: se paga y cotiza como el salario.
	if (Number(safeValue((item as any).total_licencia, 0)) > 0) {
		const n = diasDe((item as any).periodo_start_licencia, (item as any).periodo_end_licencia);
		basicos.push({
			concepto: rotuloLicencia((item.conductor as any)?.genero),
			cantidad: textoDias(n) || '-',
			valor: formatCurrency((item as any).total_licencia)
		});
	}
	// Ajuste salarial: siempre se muestra, aunque sea $0.
	basicos.push({
		concepto: 'Bono Nivelación de Salario',
		cantidad: textoDias(Number(safeValue(item.dias_laborados_villanueva, 0))) || '0 días',
		valor: formatCurrency(item.ajuste_salarial || 0)
	});

	const adicionales: LineaDiseno[] = [
		...Object.values(bonosAgrupados)
			.filter((b) => b.quantity > 0)
			.map((b) => ({ concepto: b.name || '', cantidad: String(b.quantity), valor: formatCurrency(b.totalValue) })),
		{ concepto: 'Recargos OTROS', detalle: verDetalle, valor: formatCurrency(totalRecargosOtros) },
		...(hayRecargosParex ? [{ concepto: 'Recargos PAREX', detalle: verDetalle, valor: formatCurrency(totalRecargosParex) }] : []),
		...(hayRecargosGeopark ? [{ concepto: 'Recargos GEOPARK', detalle: verDetalle, valor: formatCurrency(totalRecargosGeopark) }] : []),
		{
			concepto: 'Pernoctes',
			detalle: pernoteFechasTexto || undefined,
			cantidad: String(cantidadPernotes),
			valor: formatCurrency(totalPernotes)
		},
		...(disponibilidadVal > 0 ? [{ concepto: 'Disponibilidad', valor: formatCurrency(disponibilidadVal) }] : [])
	];

	const novedades: LineaDiseno[] = [];
	if (Number(safeValue(item.total_vacaciones, 0)) > 0) {
		const n =
			diasDe(item.periodo_vacaciones_inicio, item.periodo_vacaciones_fin) ||
			diasDe(item.periodo_start_vacaciones, item.periodo_end_vacaciones);
		novedades.push({ concepto: 'Vacaciones', cantidad: `${n} días`, valor: formatCurrency(item.total_vacaciones) });
	}
	for (const c of parseValues(item.conceptos_adicionales)) {
		const negativo = Number(c.valor) < 0;
		novedades.push({
			concepto: c.observaciones || c.concepto || '',
			cantidad: '1',
			valor: `${negativo ? '' : '+'}${formatCurrency(c.valor)}`,
			colorValor: negativo ? '#E60F0F' : '#EA580C'
		});
	}

	// Anticipos: la línea sale por el TOTAL, no por sus hijos (un total
	// tecleado en el canvas no trae detalle y el neto sí lo descuenta).
	const deducciones: LineaDiseno[] = [
		{ concepto: 'Salud', valor: formatCurrency(item.salud) },
		{ concepto: 'Pensión', valor: formatCurrency(item.pension) }
	];
	if (Number(item.total_anticipos) > 0 || (item.anticipos?.length ?? 0) > 0) {
		deducciones.push({ concepto: 'Anticipos', valor: formatCurrency(item.total_anticipos) });
		for (const a of item.anticipos ?? []) {
			deducciones.push({ concepto: a.concepto || a.observaciones || '', valor: '', hija: true });
		}
	}

	// El neto es el de siempre: `sueldo_total` menos los intereses de cesantías,
	// que se pagan aparte. Los ingresos se derivan del neto y las deducciones
	// para que el resumen cuadre siempre con lo que se paga.
	const sueldoAjustado =
		Number(safeValue(item.sueldo_total, 0)) - Number(safeValue(item.interes_cesantias, 0));
	const totalDeducciones =
		Number(safeValue(item.salud, 0)) + Number(safeValue(item.pension, 0)) + Number(safeValue(item.total_anticipos, 0));

	let firmaDelConductor: string | null = null;
	if (firmas && firmas[0]?.presignedUrl) {
		try {
			firmaDelConductor = await imageToBase64Url(firmas[0].presignedUrl);
		} catch {
			// Sin firma queda la línea para firmar a mano.
		}
	}

	const [logoMarca, mascotaMarca, selloMarca] = await Promise.all([
		logoPngDataUrl(MARCA_DISENO.logoUrl),
		logoPngDataUrl(MARCA_DISENO.mascotaUrl),
		logoPngDataUrl(MARCA_DISENO.selloUrl)
	]);

	const marca: MarcaDesprendible = {
		...MARCA_DISENO,
		razonSocial: empresa,
		nit,
		logo: logoMarca,
		mascota: mascotaMarca,
		sello: selloMarca
	};
	const fechaGeneracion = new Date().toLocaleDateString('es-CO');

	const content: any[] = paginaPrincipalDiseno2(
		{
			nombre: conductorNombre,
			cedula: String(conductorCedula),
			diasLaborados: String(safeValue(item.dias_laborados, 0)),
			cargo: (item.conductor as any)?.cargo || 'Conductor',
			mes: monthAndYear(item.periodo_fin),
			periodo: `Periodo del ${formatDate(item.periodo_inicio)} al ${formatDate(item.periodo_fin)}`,
			basicos,
			tituloAdicionales: `Adicionales ${formatDate(item.periodo_inicio)} - ${formatDate(item.periodo_fin)}`,
			adicionales,
			novedades,
			deducciones,
			totalIngresos: formatCurrency(sueldoAjustado + totalDeducciones),
			totalDeducciones: formatCurrency(totalDeducciones),
			neto: formatCurrency(sueldoAjustado),
			firma: firmaDelConductor,
			fechaGeneracion
		},
		marca
	);

	// ============================================================
	// PÁGINA 2+: HORAS EXTRAS Y RECARGOS (si hay recargos planilla)
	// ============================================================
	if (recargosData?.planillas && recargosData.planillas.length > 0 && item.mostrar_recargos) {
		// No descartamos planillas sin `dias`: el modal puede enviar
		// planillas sintéticas (total_valor > 0 pero sin desglose por
		// día) para que el TOTAL del PDF cuadre con el del preview.
		//
		// Las MARCAS del canvas (`marcas_dias`): los días ocultos se van y los
		// que no suman quedan en gris y fuera de los totales. Una planilla que
		// tenía días y se quedó sin ninguno se cae; la sintética, que nunca los
		// tuvo, se queda.
		const planillasOrigen: any[] = recargosData.planillas;
		const planillas: any[] = aplicarMarcasDias(
			planillasOrigen,
			leerMarcasDias((item as any).marcas_dias)
		).filter((p: any, i: number) => (p.dias?.length ?? 0) > 0 || !planillasOrigen[i]?.dias?.length);

		// Paleta de colores según la categoría de la planilla:
		//  - 'pagar'       → naranja (color principal de la marca).
		//  - 'bono_aparte' → azul (GEOLAB, RED SALUD, etc.; se
		//                    reconoce como bono aparte, no como recargo).
		//  - 'no_pagar'    → gris (caso b: días con recorrido sin
		//                    recardo, o solo disponibilidad).
		const COLOR_BONO_APARTE = '#1D4ED8'; // blue-700
		const COLOR_BONO_APARTE_BG = '#DBEAFE'; // blue-100
		const COLOR_NO_PAGAR = '#6B7280'; // gray-500
		const COLOR_NO_PAGAR_BG = '#F3F4F6'; // gray-100

		for (const planilla of planillas) {
			const categoria: string = planilla._categoria || 'pagar';
			const isBonoAparte = categoria === 'bono_aparte';
			const isNoPagar = categoria === 'no_pagar';

			const headerColor = isBonoAparte
				? COLOR_BONO_APARTE
				: isNoPagar
					? COLOR_NO_PAGAR
					: color;
			const headerBg = isBonoAparte
				? COLOR_BONO_APARTE
				: isNoPagar
					? COLOR_NO_PAGAR
					: color;
			// Una planilla 'no_pagar' puede llegar con valor (tiene recargos
			// generados pero no está anclada a un recargo de la liquidación) o
			// sin él (días de disponibilidad, o recorrido sin recargo). El
			// título debe distinguirlos: decir "sin recargo generado" sobre una
			// planilla que sí los tiene es engañoso.
			const tieneValorPlanilla = Number(planilla.total_valor || 0) > 0;
			const sectionTitle = isBonoAparte
				? 'BONO APARTE (no remunerado como recargo)'
				: isNoPagar
					? tieneValorPlanilla
						? 'DÍAS LABORALES (no incluidos en esta liquidación)'
						: 'DÍAS LABORALES (sin recargo generado)'
					: 'HORAS EXTRAS Y RECARGOS';

			// Page break before each planilla group
			content.push({ text: '', pageBreak: 'before' as const });

			const mesNombre = new Date(planilla.año, planilla.mes - 1)
				.toLocaleString('es-CO', { month: 'long' })
				.toUpperCase();
			content.push(
				...cabeceraSeccion(
					isBonoAparte || isNoPagar ? { ...marca, oscuro: headerColor } : marca,
					{
						titulo: sectionTitle.charAt(0) + sectionTitle.slice(1).toLowerCase(),
						subtitulo: `${planilla.empresa?.nombre || 'Sin empresa'} · ${mesNombre} ${planilla.año}`,
						datos: [
							['CONDUCTOR', conductorNombre],
							['C.C.', String(conductorCedula)],
							['VEHÍCULO', planilla.vehiculo?.placa || 'N/A'],
							['MES', `${mesNombre} ${planilla.año}`]
						]
					}
				)
			);

			// Avisos
			const hayFestivosODomingos = planilla.dias?.some((d: any) => d.es_festivo || d.es_domingo);
			const hayDisponibles = planilla.dias?.some((d: any) => d.disponibilidad);
			const hayNoSuman = planilla.dias?.some((d: any) => d.no_suma && !d.disponibilidad);

			if (hayFestivosODomingos) {
				content.push({
					text: 'Aviso: Los días dominicales o festivos se resaltan en naranja.',
					fontSize: 9,
					color: '#92400E',
					bold: true,
					margin: [0, 0, 0, 5]
				});
			}
			if (hayDisponibles && !isBonoAparte) {
				content.push({
					text: 'Aviso: Los días marcados como disponibilidad no son reconocidos. Se muestran en rojo y no suman a los totales.',
					fontSize: 9,
					color: '#B91C1C',
					bold: true,
					margin: [0, 0, 0, 5]
				});
			}

			if (hayNoSuman) {
				content.push({
					text: 'Aviso: Los días en gris no suman a los recargos; se reconocen por otro concepto y su valor se detalla al final.',
					fontSize: 9,
					color: '#6B7280',
					bold: true,
					margin: [0, 0, 0, 5]
				});
			}

			// Empresa info
			const valorHoraBase = planilla.configuracion_salarial?.valor_hora_trabajador || 0;
			content.push({
				table: {
					widths: ['*'],
					body: [
						[
							{
								stack: [
									{
										text: [
											{ text: 'EMPRESA: ', bold: true, fontSize: 10 },
											{ text: planilla.empresa?.nombre || 'N/A', fontSize: 10 },
											...(isBonoAparte
												? [
														{
															text: '  [BONO APARTE]',
															bold: true,
															fontSize: 9,
															color: '#FFFFFF',
															// Lo pintamos luego con un stack badge
														}
													]
												: [])
										]
									},
									{
										text: isBonoAparte
											? `Reconocido como bono aparte — valor/hora base no aplica a esta planilla en el desprendible.`
											: `Valor/Hora Base: ${formatCurrency(valorHoraBase)}`,
										fontSize: 10,
										color: isBonoAparte ? COLOR_BONO_APARTE : '#666',
										margin: [0, 2, 0, 0]
									}
								],
								fillColor: isBonoAparte ? COLOR_BONO_APARTE_BG : MARCA_DISENO.fondoSuave,
								margin: [4, 4, 4, 4]
							}
						]
					]
				},
				layout: {
					hLineWidth: (i: number, node: any) => (i === node.table.body.length ? 1 : 0),
					vLineWidth: () => 0,
					hLineColor: () => MARCA_DISENO.borde,
					paddingLeft: () => 0,
					paddingRight: () => 0,
					paddingTop: () => 0,
					paddingBottom: () => 0
				}
			});

			// Días laborales table
			const dias: any[] = planilla.dias || [];
			// Para planillas de "bono aparte" mostramos solo 3 columnas
			// (DÍA, HORARIO, HORAS) — sin desglose HED/RN/HEN/etc.
			const allHeaders = ['DÍA', 'HORARIO', 'HORAS', 'HED', 'RN', 'HEN', 'RD', 'RNDF', 'HEFD', 'HEFN'];
			const headers = isBonoAparte ? allHeaders.slice(0, 3) : allHeaders;
			const tableWidths = isBonoAparte
				? Array(3).fill('*')
				: Array(allHeaders.length).fill('*');
			const headerRow = headers.map((h) => ({
				text: h,
				bold: true,
				fontSize: 8,
				color: headerColor,
				alignment: 'center' as const,
				margin: [0, 3, 0, 3]
			}));

			const diasRows = dias.map((dia: any, idx: number) => {
				const esDisponible = dia.disponibilidad;
				const esEspecial = dia.es_festivo || dia.es_domingo;
				/// Marcado «no sumar» en el canvas: se ve, pero no cuenta.
				const noSuma = !!dia.no_suma && !esDisponible;
				// Para "bono aparte" usamos un fondo azul claro para todas
				// las filas, manteniendo la legibilidad pero reforzando
				// visualmente que NO es un recargo a pagar.
				const bgColor = isBonoAparte
					? COLOR_BONO_APARTE_BG
					: esDisponible
						? '#FEE2E2'
						: noSuma
							? '#F3F4F6'
							: esEspecial
							? '#FEF3C7'
							: idx % 2 === 0
								? '#ffffff'
								: MARCA_DISENO.fondoSuave;
				const textColor = isBonoAparte
					? '#1E3A8A' // blue-900
					: esDisponible
						? '#B91C1C'
						: noSuma
							? '#9CA3AF'
							: esEspecial
								? '#92400E'
								: '#333333';

				// Extract recargos values from dia.recargos array
				const getRecargo = (codigo: string) => {
					const r = dia.recargos?.find((rc: any) => rc.tipo_codigo === codigo);
					return r ? r.horas : 0;
				};

				const hed = getRecargo('HED');
				const rn = getRecargo('RN');
				const hen = getRecargo('HEN');
				const rd = getRecargo('RD');
				const rndf = getRecargo('RNDF');
				const hefd = getRecargo('HEFD');
				const hefn = getRecargo('HEFN');

				const formatHora = (h: any) => {
					if (!h && h !== 0) return '-';
					const num = Number(h);
					const hh = Math.floor(num).toString().padStart(2, '0');
					const mm = Math.round((num % 1) * 60)
						.toString()
						.padStart(2, '0');
					return `${hh}:${mm}`;
				};

				const cellStyle = {
					fontSize: 8,
					alignment: 'center' as const,
					color: textColor,
					fillColor: bgColor,
					margin: [0, 2, 0, 2]
				};

				const fmtVal = (v: number) => (v !== 0 ? Number(v).toFixed(2) : '-');

				const baseCols = [
					{ text: dia.dia, ...cellStyle },
					{
						text: `${formatHora(dia.hora_inicio)}-${formatHora(dia.hora_fin)}`,
						...cellStyle
					},
					{ text: Number(dia.total_horas || 0).toFixed(2), ...cellStyle }
				];

				if (isBonoAparte) return baseCols;

				return [
					...baseCols,
					{ text: fmtVal(hed), ...cellStyle },
					{ text: fmtVal(rn), ...cellStyle },
					{ text: fmtVal(hen), ...cellStyle },
					{ text: fmtVal(rd), ...cellStyle },
					{ text: fmtVal(rndf), ...cellStyle },
					{ text: fmtVal(hefd), ...cellStyle },
					{ text: fmtVal(hefn), ...cellStyle }
				];
			});

			// Totals row. Para planillas "bono aparte" o "no pagar" (caso
			// informativo: días con disponibilidad o recorrido sin
			// recargo) el total refleja TODO el trabajo realizado
			// (incluyendo días con disponibilidad), porque la planilla es
			// informativa y el usuario quiere ver el total real. Solo
			// para 'pagar' (recargos efectivamente remunerados)
			// excluimos la disponibilidad del total — mismo criterio que
			// el cálculo de recargos monetarios.
			const excluirDisponibilidadDelTotal =
				!isBonoAparte && !isNoPagar;
			/// Los marcados «no sumar» quedan fuera del total en cualquier categoría.
			const diasParaTotal = (
				excluirDisponibilidadDelTotal ? dias.filter((d: any) => !d.disponibilidad) : dias
			).filter((d: any) => !d.no_suma);
			const totHoras = diasParaTotal.reduce(
				(s: number, d: any) => s + (d.total_horas || 0),
				0
			);
			const totDias = diasParaTotal.length;

			const getTotal = (codigo: string) => {
				return dias
					.filter((d: any) => !d.disponibilidad && !d.no_suma)
					.reduce((s: number, d: any) => {
						const r = d.recargos?.find((rc: any) => rc.tipo_codigo === codigo);
						return s + (r ? r.horas : 0);
					}, 0);
			};

			const totalesRowBase = [
				{
					/// Con días «no sumar» debajo, la fila dice qué es y el
					/// recuento va como «N días»: un número suelto en la columna
					/// DÍA se leía como una fecha («13 SUMA» = «el 13 suma»).
					text: hayNoSuman ? 'SUMAN' : totDias.toString(),
					bold: true,
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: isBonoAparte ? COLOR_BONO_APARTE_BG : colorBg,
					margin: [0, 2, 0, 2]
				},
				{
					text: hayNoSuman ? rotuloDias(totDias) : '-',
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: isBonoAparte ? COLOR_BONO_APARTE_BG : colorBg,
					margin: [0, 2, 0, 2]
				},
				{
					text: totHoras.toFixed(2),
					bold: true,
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: isBonoAparte ? COLOR_BONO_APARTE_BG : colorBg,
					margin: [0, 2, 0, 2]
				}
			];
			const totalesRowRecargos = [
				getTotal('HED'),
				getTotal('RN'),
				getTotal('HEN'),
				getTotal('RD'),
					getTotal('RNDF'),
					getTotal('HEFD'),
					getTotal('HEFN'),
				].map((v) => ({
					text: v ? v.toFixed(2) : '0.00',
					bold: true,
					fontSize: 8,
					alignment: 'center' as const,
					fillColor: colorBg,
					margin: [0, 2, 0, 2]
				}));

			const totalesRow = isBonoAparte
				? totalesRowBase
				: [...totalesRowBase, ...totalesRowRecargos];

			content.push({
				table: {
					headerRows: 1,
					widths: tableWidths,
					body: [headerRow, ...diasRows, totalesRow, ...filaTotalesNoSuma(dias)]
				},
				layout: {
					hLineWidth: (i: number, node: any) =>
						i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
					vLineWidth: () => 0.5,
					hLineColor: () => MARCA_DISENO.borde,
					vLineColor: () => MARCA_DISENO.borde,
					paddingLeft: () => 2,
					paddingRight: () => 2,
					paddingTop: () => 1,
					paddingBottom: () => 1
				}
			});

			// Para planillas "bono aparte" omitimos el desglose por tipo
			// y la barra TOTAL: el valor monetario se reconoce como bono
			// aparte, no como recargo dentro de esta planilla.
			if (isBonoAparte) {
				content.push({
					table: {
						widths: ['*'],
						body: [
							[
								{
									text: [
										{
											text: `${totDias} día(s) trabajado(s) · ${totHoras.toFixed(2)} horas  `,
											bold: true,
											fontSize: 10,
											color: COLOR_BONO_APARTE
										},
										{
											text: 'Reconocido como bono aparte (no remunerado como recargo en este desprendible).',
											fontSize: 9,
											color: '#1E3A8A'
										}
									],
									fillColor: COLOR_BONO_APARTE_BG,
									margin: [6, 6, 6, 6]
								}
							]
						]
					},
					layout: {
						hLineWidth: () => 0,
						vLineWidth: () => 0,
						paddingLeft: () => 0,
						paddingRight: () => 0,
						paddingTop: () => 0,
						paddingBottom: () => 0
					},
					margin: [0, 6, 0, 0]
				});
				continue; // saltamos el desglose por tipo y la barra TOTAL
			}

			// TOTALES CONSOLIDADOS header
			content.push({
				table: {
					widths: ['*'],
					body: [
						[
							{
								text: 'TOTALES CONSOLIDADOS',
								bold: true,
								fontSize: 11,
								color,
								alignment: 'center' as const,
								fillColor: colorBg,
								margin: [0, 3, 0, 3]
							}
						]
					]
				},
				layout: {
					hLineWidth: () => 0,
					vLineWidth: () => 0,
					paddingLeft: () => 0,
					paddingRight: () => 0,
					paddingTop: () => 0,
					paddingBottom: () => 0
				}
			});

			// Tipos de recargos consolidados table
			// Aggregate from dias.recargos
			const tiposMap: Record<
				string,
				{
					codigo: string;
					nombre: string;
					porcentaje: number;
					horas: number;
					valor_hora_base: number;
					valor_hora_calculada: number;
					valor_total: number;
					adicional: boolean;
				}
			> = {};

			for (const dia of dias) {
				if (dia.disponibilidad || dia.no_suma) continue;
				for (const rec of dia.recargos || []) {
					if (!tiposMap[rec.tipo_codigo]) {
						tiposMap[rec.tipo_codigo] = {
							codigo: rec.tipo_codigo,
							nombre: rec.tipo_nombre,
							porcentaje: rec.porcentaje,
							horas: 0,
							valor_hora_base: rec.valor_hora_base,
							valor_hora_calculada: rec.valor_hora_calculada,
							adicional: rec.adicional || rec.es_hora_extra,
							valor_total: 0
						};
					}
					tiposMap[rec.tipo_codigo].horas += rec.horas;
					tiposMap[rec.tipo_codigo].valor_total += rec.valor_total;
				}
			}

			const tiposConsolidados = Object.values(tiposMap).sort((a, b) => a.porcentaje - b.porcentaje);

			// Mostramos el desglose por tipo SOLO si hay tipos. Para
			// planillas sintéticas (sin días) tiposConsolidados viene
			// vacío, pero igual necesitamos mostrar el TOTAL del recargo
			// para que cuadre con el total del preview.
			if (tiposConsolidados.length > 0) {
				const recargoHeaderRow = [
					{
						text: 'TIPO RECARGO',
						bold: true,
						fontSize: 8,
						color,
						margin: [2, 3, 0, 3]
					},
					{
						text: '%',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					},
					{
						text: 'V/BASE',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					},
					{
						text: 'V/+ %',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					},
					{
						text: 'CANTIDAD',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					},
					{
						text: 'TOTAL',
						bold: true,
						fontSize: 8,
						color,
						alignment: 'center' as const,
						margin: [0, 3, 0, 3]
					}
				];

				const recargoRows = tiposConsolidados.map((tipo) => [
					{
						text: [
							{ text: tipo.nombre.toUpperCase(), fontSize: 9 },
							{ text: ` - ${tipo.codigo}`, fontSize: 9, color: '#007AFF' }
						],
						margin: [2, 2, 0, 2]
					},
					{
						text: `${tipo.porcentaje}%`,
						fontSize: 9,
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					},
					{
						text: formatCurrency(tipo.valor_hora_base),
						fontSize: 9,
						color: '#666',
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					},
					{
						text: formatCurrency(tipo.valor_hora_calculada),
						fontSize: 9,
						bold: true,
						color,
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					},
					{
						text: tipo.horas.toFixed(2),
						fontSize: 9,
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					},
					{
						text: formatCurrency(tipo.valor_total),
						fontSize: 9,
						bold: true,
						alignment: 'center' as const,
						margin: [0, 2, 0, 2]
					}
				]);

				content.push({
					table: {
						headerRows: 1,
						widths: ['35%', '10%', '13%', '13%', '13%', '16%'],
						body: [recargoHeaderRow, ...recargoRows]
					},
					layout: {
						hLineWidth: (i: number, node: any) =>
							i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
						vLineWidth: () => 0.5,
						hLineColor: () => MARCA_DISENO.borde,
						vLineColor: () => MARCA_DISENO.borde,
						paddingLeft: () => 2,
						paddingRight: () => 2,
						paddingTop: () => 1,
						paddingBottom: () => 1,
						fillColor: (rowIndex: number) => (rowIndex === 0 ? colorBg : null)
					}
				});
			}

			// TOTAL bar: se muestra SIEMPRE que el planilla tenga un
			// total_valor > 0 (incluso si no hay tipos consolidados,
			// p. ej. planillas sintéticas sin desglose por día).
			const totalValor = Number(planilla.total_valor || 0);
			if (totalValor > 0) {
				content.push({
					table: {
						widths: ['*', 'auto'],
						body: [
							[
								{
									text: 'TOTAL',
									color: 'white',
									bold: true,
									fontSize: 10,
									fillColor: isBonoAparte || isNoPagar ? headerColor : MARCA_DISENO.acento,
									margin: [4, 4, 0, 4]
								},
								{
									text: formatCurrency(totalValor),
									color: 'white',
									bold: true,
									fontSize: 10,
									fillColor: isBonoAparte || isNoPagar ? headerColor : MARCA_DISENO.acento,
									alignment: 'right' as const,
									margin: [0, 4, 15, 4]
								}
							]
						]
					},
					layout: {
						hLineWidth: () => 0,
						vLineWidth: () => 0,
						paddingLeft: () => 0,
						paddingRight: () => 0,
						paddingTop: () => 0,
						paddingBottom: () => 0
					}
				});
			} else {
				// Planilla con días pero `total_valor = 0`. Hay dos casos
				// que debemos explicar al usuario para que la sección
				// "TOTALES CONSOLIDADOS" no quede vacía:
				//
				//   a) Todos los días están marcados como disponibilidad.
				//      Por política no se reconocen y no suman a los
				//      recargos.
				//
				//   b) Hay días con recorrido (total_horas > 0) pero sin
				//      detalles de recargo generados (p. ej. porque se
				//      eliminaron manualmente o el cálculo automático no
				//      detectó horas extras). El conductor SÍ trabajó pero
				//      el valor monetario del día es $0.
				const diasDisponibles = (dias || []).filter((d: any) => d.disponibilidad)
					.length;
				const diasConRecorridoSinRecargo = (dias || []).filter(
					(d: any) =>
						!d.disponibilidad &&
						Number(d.total_horas) > 0 &&
						(!Array.isArray(d.recargos) || d.recargos.length === 0)
				).length;

				if (diasDisponibles > 0 || diasConRecorridoSinRecargo > 0) {
					const partes: any[] = [
						{ text: 'TOTAL: $0  ', bold: true, fontSize: 10, color: '#B91C1C' }
					];
					if (diasDisponibles > 0) {
						partes.push({
							text: `${diasDisponibles} día(s) marcado(s) como disponibilidad (no reconocidos). `,
							fontSize: 9,
							color: '#7F1D1D'
						});
					}
					if (diasConRecorridoSinRecargo > 0) {
						partes.push({
							text: `${diasConRecorridoSinRecargo} día(s) con recorrido pero sin recargo generado ($0). `,
							fontSize: 9,
							color: '#7F1D1D'
						});
					}
					content.push({
						table: {
							widths: ['*'],
							body: [
								[
									{
										text: partes,
										fillColor: '#FEE2E2',
										margin: [6, 6, 6, 6]
									}
								]
							]
						},
						layout: {
							hLineWidth: () => 0,
							vLineWidth: () => 0,
							paddingLeft: () => 0,
							paddingRight: () => 0,
							paddingTop: () => 0,
							paddingBottom: () => 0
						}
					});
				}
			}

			// Los días marcados «no sumar»: su valor, aparte y en gris.
			content.push(...bloqueNoSuman(dias));

			// Firma del conductor al pie de cada página de recargos.
			if (firmaDelConductor) {
				content.push(firmaConductor(marca, firmaDelConductor, conductorNombre, String(conductorCedula)));
			}

			content.push(pieDocumento(marca, fechaGeneracion));
		}
	}

	// ============================================================
	// DÍAS SIN RECARGO DEL CORTE
	// ============================================================
	//
	// Descanso, disponibilidad, mantenimiento y vacaciones: días que el
	// conductor registró en el portal —o que caen en su periodo de
	// vacaciones— y que NO generan horas extras ni recargos.
	//
	// Va en su propia tabla y no dentro de la de una planilla porque no
	// pertenecen a ninguna: no tienen empresa, ni vehículo, ni horas. Meterlos
	// ahí obligaría a elegir a cuál colgarlos y dejaría siete columnas de
	// recargo en guiones.
	//
	// Repite la maqueta de las tablas de recargo —título, cabecera verde con
	// conductor y cédula, y la misma retícula gris— para que se lea como una
	// página más del mismo documento y no como un añadido.
	//
	// ⚠️ NO LLEVAN HORARIO, y no es que falte el dato: el portal solo lo pide
	// cuando el día es LABORADO. Por eso la tercera columna es el DETALLE —la
	// observación del conductor, o la placa del taller— y no una hora que
	// habría que inventar.
	//
	// Fuera del `if` de las planillas a propósito: un conductor que pasó el
	// corte entero de descanso no tiene ninguna planilla, y es justo a quien
	// más le hace falta ver estos días impresos.
	const diasSinRecargo: any[] = Array.isArray((recargosData as any)?.dias_sin_recargo)
		? (recargosData as any).dias_sin_recargo
		: [];

	// Con la planilla de control de días (canvas) sobra: esa página ya lista
	// cada día con su tipo. Sin ella —portal, enlace firmado— se mantiene.
	const hayControlDias = !!(recargosData as any)?.control_dias?.filas?.length;
	if (diasSinRecargo.length > 0 && item.mostrar_recargos && !hayControlDias) {
		content.push({ text: '', pageBreak: 'before' as const });

		content.push(
			...cabeceraSeccion(marca, {
				titulo: 'Días sin recargo del corte',
				subtitulo: `Periodo del ${formatDate(item.periodo_inicio)} al ${formatDate(item.periodo_fin)}`,
				datos: [
					['CONDUCTOR', conductorNombre],
					['C.C.', String(conductorCedula)],
					['DÍAS', String(diasSinRecargo.length)]
				]
			})
		);

		content.push({
			text: 'Aviso: Estos días no generan horas extras ni recargos. No suman a los totales del desprendible.',
			fontSize: 9,
			color: '#B91C1C',
			bold: true,
			margin: [0, 0, 0, 5]
		});


		const diaDeLaSemana = (fecha: string): string => {
			const d = new Date(`${fecha}T12:00:00`);
			if (Number.isNaN(d.getTime())) return '';
			return d.toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '').toUpperCase();
		};

		const cabeceraFilas = ['DÍA', 'CONCEPTO', 'DETALLE'].map((h) => ({
			text: h,
			bold: true,
			fontSize: 8,
			color,
			alignment: 'center' as const,
			margin: [0, 3, 0, 3]
		}));

		const filasSinRecargo = diasSinRecargo.map((d: any, idx: number) => {
			const fondo = idx % 2 === 0 ? '#ffffff' : MARCA_DISENO.fondoSuave;
			const celda = (texto: string, alineacion: 'left' | 'center', negrita = false) => ({
				text: texto,
				bold: negrita,
				fontSize: 8,
				color: '#333333',
				alignment: alineacion,
				fillColor: fondo,
				margin: [0, 2, 0, 2]
			});
			const semana = diaDeLaSemana(String(d.fecha ?? ''));
			return [
				celda(`${d.dia ?? ''}${semana ? ` ${semana}` : ''}`, 'center', true),
				celda(String(d.etiqueta ?? ''), 'center'),
				celda(String(d.detalle ?? '-'), 'left')
			];
		});

		const totalSinRecargo = [
			{
				text: `${diasSinRecargo.length}`,
				bold: true,
				fontSize: 8,
				alignment: 'center' as const,
				fillColor: colorBg,
				margin: [0, 2, 0, 2]
			},
			{
				text: 'TOTAL DÍAS',
				bold: true,
				fontSize: 8,
				alignment: 'center' as const,
				fillColor: colorBg,
				margin: [0, 2, 0, 2]
			},
			{
				text: 'No suman a los totales',
				fontSize: 8,
				alignment: 'left' as const,
				fillColor: colorBg,
				margin: [0, 2, 0, 2]
			}
		];

		content.push({
			table: {
				headerRows: 1,
				widths: [60, 110, '*'],
				body: [cabeceraFilas, ...filasSinRecargo, totalSinRecargo]
			},
			layout: {
				hLineWidth: (i: number, node: any) =>
					i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
				vLineWidth: () => 0.5,
				hLineColor: () => MARCA_DISENO.borde,
				vLineColor: () => MARCA_DISENO.borde,
				paddingLeft: () => 2,
				paddingRight: () => 2,
				paddingTop: () => 1,
				paddingBottom: () => 1
			}
		});
	}

	// ============================================================
	// CONTROL DÍAS LABORADOS (OP-FR-03), CON LA FIRMA
	// ============================================================
	//
	// Solo llega desde el canvas de nómina (`desprendible-nomina.ts` la pide
	// al libro de recorridos). El portal y el enlace firmado no la traen y el
	// documento sale como antes.
	const controlDias: ControlDias | null = (recargosData as any)?.control_dias ?? null;
	if (controlDias?.filas?.length) {
		let firmaControl: string | null = null;
		if (firmas && firmas[0]?.presignedUrl) {
			try {
				firmaControl = await imageToBase64Url(firmas[0].presignedUrl);
			} catch {
				// Sin firma queda la línea para firmar a mano.
			}
		}
		content.push(
			...paginaControlDias({
				control: controlDias,
				color,
				colorBg,
				razonSocial: empresa,
				// El logo de la marca, como en el export de recorridos; no el de la página 1.
				logo: await logoPngDataUrl('/assets/logo_nombre.webp'),
				conductorNombre,
				conductorCedula: String(conductorCedula),
				firma: firmaControl,
				borde: MARCA_DISENO.borde,
				fondoSuave: MARCA_DISENO.fondoSuave
			})
		);
	}

	const docDefinition: any = {
		pageSize: 'A4',
		pageMargins: [40, 30, 40, 30],
		content,
		styles: {
			header: {
				fontSize: 13,
				bold: true,
				margin: [0, 0, 0, 2]
			},
			tableHeader: {
				bold: true,
				fontSize: 10
			},
			valueText: {
				fontSize: 12
			}
		},
		defaultStyle: {
			fontSize: 12
		}
	};

	return docDefinition;
}


/** Abre el desprendible en una pestana nueva. */
export async function generarPdfDesprendible(
	item: Liquidacion,
	firmas: FirmaConUrl[] = [],
	recargosData: any = null
): Promise<void> {
	const pdfMake = await cargarPdfMake();
	const docDefinition = await construirDocDefinition(item, firmas, recargosData);
	pdfMake.createPdf(docDefinition).open();
}

/**
 * El mismo desprendible, como Blob.
 *
 * Lo usa el export en ZIP del canvas: treinta pestanas abiertas no son una
 * descarga masiva.
 */
export async function generarBlobDesprendible(
	item: Liquidacion,
	firmas: FirmaConUrl[] = [],
	recargosData: any = null
): Promise<Blob> {
	const pdfMake = await cargarPdfMake();
	const docDefinition = await construirDocDefinition(item, firmas, recargosData);
	return blobDePdf(pdfMake, docDefinition);
}

/**
 * El mismo desprendible, en base64.
 *
 * Lo usa la página que imprime el PDF de la app móvil: Puppeteer la abre desde
 * el backend y recoge este base64 tal cual, así que el móvil recibe
 * EXACTAMENTE el documento del canvas, sin una segunda maqueta.
 */
export async function generarBase64Desprendible(
	item: Liquidacion,
	firmas: FirmaConUrl[] = [],
	recargosData: any = null
): Promise<string> {
	const pdfMake = await cargarPdfMake();
	const docDefinition = await construirDocDefinition(item, firmas, recargosData);
	/// pdfmake 0.3: promesa, sin callback (ver `generarBlobDesprendible`).
	return pdfMake.createPdf(docDefinition).getBase64();
}
