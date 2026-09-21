/**
 * Adaptador de preview del canvas de RECORRIDOS.
 *
 * Dos diferencias deliberadas respecto a lo que se ve en el canvas:
 *
 *  · En pantalla, un bono es una CASILLA (SÍ/NO). En el papel se imprime su
 *    IMPORTE. El documento existe para contabilizar: una columna de «SÍ» no se
 *    suma, y quien recibe el PDF necesita saber cuánto se pagó, no solo que se
 *    pagó.
 *
 *  · Al pie va un RESUMEN por placa y mes con el número de bonos de cada tipo
 *    —«FST006 · Agosto · 6 de alimentación, 2 de día doble»—, que es la
 *    pregunta que de verdad se le hace a esta hoja y que en la tabla de
 *    recorridos habría que contar a mano fila por fila.
 *
 * Todo va como BLOQUE y no como sección con `columnas`: las columnas de bono
 * dependen de `bono_config_visual` del año, y el catálogo del preview es
 * estático.
 */

import type {
	BloquePreview,
	ColumnaPreview,
	DocumentoPreview,
	FilaPreview,
	SeccionPreview
} from '../tipos';
import { COP, nombreMes } from '../formato';
import type {
	BonoColumna,
	FilaRecorrido,
	HojaRecorridos,
	RecorridosPeriodoDTO
} from '$lib/editor/builders/recorridos.builder';

/** Columnas fijas de la tabla de recorridos, antes de las de bono. */
/**
 * Columnas del formato OP-FR-03, en su orden y con sus rótulos.
 *
 * Los pesos siguen la proporción de los anchos del Excel: la descripción de la
 * labor es con diferencia la más ancha (61 unidades frente a 12-21 del resto),
 * porque es donde se escribe el recorrido completo.
 */
/**
 * Rótulos CORTOS, y es una decisión de impresión, no un descuido.
 *
 * El formato de papel escribe «Tiempo Total de Conducción en la Jornada» en una
 * casilla ancha; aquí esa columna mide siete unidades de cien y el rótulo salía
 * en cinco líneas —partiendo «CONDUCCIÓ / N»—, y como la cabecera se repite en
 * cada página, esas cinco líneas se pagaban una y otra vez. El alto de la fila
 * de cabecera lo fija SIEMPRE el rótulo más largo, así que una sola etiqueta
 * kilométrica engorda las quince columnas a la vez.
 *
 * Se conserva el nombre completo del formato en el `title` de la celda, que es
 * donde el preview lo enseña al pasar el ratón: el dato y su significado no se
 * pierden, solo dejan de ocupar media hoja.
 */
function columnasBase(): ColumnaPreview[] {
	return [
		{ key: 'n', label: '#', tipo: 'numero', peso: 2, fija: true },
		{ key: 'fecha', label: 'Fecha', tipo: 'texto', peso: 5, fija: true },
		{ key: 'dia', label: 'Día', tipo: 'texto', peso: 3 },
		{ key: 'tipo', label: 'Tipo', tipo: 'texto', peso: 5 },
		{ key: 'placa', label: 'Placa', tipo: 'placa', peso: 6 },
		{
			key: 'descripcion',
			/*
			 * 19,8 = 22 menos un 10%, cedido a CLIENTE.
			 *
			 * Se paga: con este ancho la descripción larga pasa de dos líneas a
			 * tres en casi todas las filas, y el documento de un conductor con
			 * 45 recorridos deja de caber en dos hojas. Es una decisión tomada
			 * a sabiendas —los nombres de empresa importan más que apretar el
			 * recuento de páginas—, no un descuido.
			 */
			label: 'Descripción de la labor / recorrido',
			tipo: 'texto',
			peso: 19.8
		},
		{ key: 'hora_ini', label: 'Inicio', tipo: 'texto', peso: 4 },
		{ key: 'hora_fin', label: 'Fin', tipo: 'texto', peso: 4 },
		{
			key: 'horas',
			label: 'Horas',
			titulo: 'Tiempo total de conducción en la jornada',
			tipo: 'numero',
			peso: 4
		},
		{ key: 'pernocte', label: 'Pernocte', tipo: 'texto', peso: 5 },
		{ key: 'cliente', label: 'Cliente', tipo: 'texto', peso: 17.4 }
	];
}

function columnasDeBono(bonos: BonoColumna[]): ColumnaPreview[] {
	return bonos.map((b) => ({
		key: `bono_${b.config_id}`,
		label: b.nombre,
		tipo: 'moneda' as const,
		/*
		 * 6,45 y no 7: el sobrante va a CLIENTE.
		 *
		 * Estas columnas solo muestran un importe de seis dígitos —«$ 26.061»—
		 * y les sobraba ancho, mientras los nombres de empresa se partían en
		 * dos líneas. El ancho se le quitó primero a la descripción, que era el
		 * candidato evidente por ser la más ancha, y salió mal: pasaba a tres
		 * líneas y el documento ganaba una hoja entera. Aquí no cuesta nada,
		 * porque una celda de importe no puede partirse (lleva `nowrap`).
		 */
		peso: 6.45
	}));
}

const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

/**
 * Tipo de día abreviado.
 *
 * «DESCANSO» no cabe en su columna y se derramaba sobre la placa de al lado
 * («DESCANSOFST-006»). Ensanchar la columna obliga a estrechar otra, y la única
 * con holgura es la descripción: al quitarle dos unidades, más filas pasaban a
 * tres líneas y el documento ganaba una hoja entera. Sale más barato acortar el
 * DATO, que además se lee igual de bien bajo un rótulo que ya dice «Tipo».
 */
const TIPO_CORTO: Record<string, string> = {
	LABORADO: 'LAB',
	DESCANSO: 'DESC',
	DISPONIBLE: 'DISP',
	MANTENIMIENTO: 'MANT'
};

/** `2026-08-21` → `21/08/26`. Ver la nota en la fila. */
function fechaCorta(iso: string): string {
	const [a, m, d] = iso.split('-');
	return a && m && d ? `${d}/${m}/${a.slice(2)}` : iso;
}

function diaSemana(iso: string): string {
	const [a, m, d] = iso.split('-').map(Number);
	if (!a || !m || !d) return '';
	return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? '';
}

/**
 * Renglones que tiene la tabla del formato impreso.
 *
 * El OP-FR-03 es una hoja con 31 líneas —un mes—, y se entrega con las que
 * sobran en blanco. Un conductor con tres recorridos dejaba una tabla de tres
 * renglones flotando bajo el encabezado: no parece el formato, parece un
 * recorte, y no deja sitio para anotar a mano lo que falte.
 */
const RENGLONES_MINIMOS = 31;

/** Valor total de los bonos marcados en una fila. */
function totalFila(f: FilaRecorrido, bonos: BonoColumna[]): number {
	let t = 0;
	for (const b of bonos) if (f.bonos?.[b.config_id]) t += b.valor;
	return t;
}

/** Tabla de recorridos de un conductor. */
function bloqueRecorridos(
	hoja: HojaRecorridos,
	bonos: BonoColumna[],
	etiquetaCorte: string
): BloquePreview {
	/**
	 * Ni «Valor a pagar» ni «Firma Operaciones».
	 *
	 * La hoja ya va apretada: a las trece columnas fijas se les suma una por
	 * cada bono visible, y en horizontal cada columna de más estrecha a todas
	 * las demás hasta que la descripción del recorrido deja de leerse.
	 *
	 * Las dos que se van son las que menos aportan al papel. El valor por fila
	 * es la SUMA de unas columnas de bono que ya imprimen su importe al lado, y
	 * el total del conductor sigue estando en el pie del bloque; la casilla de
	 * firma iba vacía por definición, así que gastaba ancho para no decir nada
	 * —el documento ya lleva su firma al pie—.
	 */
	const columnas = [...columnasBase(), ...columnasDeBono(bonos)];

	const filas: FilaPreview[] = hoja.filas.map((f, i) => {
		const celdas: Record<string, unknown> = {
			n: i + 1,
			// `21/08/26` y no `2026-08-21`: el ISO no cabe en su columna y se
			// partía en dos líneas, doblando el alto de TODAS las filas. El año
			// del corte ya está en la cabecera del documento.
			fecha: fechaCorta(f.fecha),
			dia: diaSemana(f.fecha),
			tipo: TIPO_CORTO[f.tipo_dia] ?? f.tipo_dia,
			placa: f.vehiculo_placa ?? '',
			// «Descripción de la Labor / Recorrido» del formato: es la
			// observación del tramo, que es donde se escribe a mano el recorrido.
			descripcion: f.observaciones ?? '',
			cliente: f.cliente_nombre ?? '',
			hora_ini: f.hora_inicio ?? '',
			hora_fin: f.hora_fin ?? '',
			horas: f.horas_conducidas || '',
			pernocte: f.pernocte ? 'SÍ' : 'NO'
		};
		for (const b of bonos) {
			// El IMPORTE, no la casilla: es lo que hace contabilizable el papel.
			// Vacío —y no cero— cuando no se otorgó: una columna llena de «$ 0»
			// esconde los importes que sí están.
			celdas[`bono_${b.config_id}`] = f.bonos?.[b.config_id] ? b.valor : '';
		}
		return { celdas } as FilaPreview;
	});

	/// Se rellena hasta el mínimo del formato. Las filas de relleno no llevan
	/// dato alguno —ni el consecutivo— para que no se confundan con un
	/// recorrido registrado y en blanco.
	while (filas.length < RENGLONES_MINIMOS) {
		const celdas: Record<string, unknown> = {};
		for (const c of columnas) celdas[c.key] = '';
		filas.push({ celdas } as FilaPreview);
	}

	const total = hoja.filas.reduce((n, f) => n + totalFila(f, bonos), 0);

	return {
		id: `recorridos-${hoja.conductor_id}`,
		// NOMBRE y luego apellido, como se presenta una persona.
		titulo: `Nombre conductor: ${`${hoja.nombre} ${hoja.apellido}`.replace(/\s+/g, ' ').trim()}`,
		subtitulo: `C.C.: ${hoja.numero_identificacion ?? '________________'}`,
		/// El corte viaja AQUÍ, a la derecha de la misma fila del nombre, y no
		/// en una banda propia bajo el encabezado: esa banda era una fila
		/// entera —repetida ahora en cada conductor del consolidado— para tres
		/// datos que caben al lado del nombre. Las fechas ISO se caen con ella:
		/// «21 AGO — 20 SEP 2026» ya dice el rango sin repetirlo en otro
		/// formato.
		etiqueta: `Corte: ${etiquetaCorte}`,
		columnas,
		filas,
		pie: { label: 'Total en bonos', valor: total },
		/// Sesenta recorridos no caben en una hoja: que fluya en vez de empujar
		/// una página en blanco por delante.
		partible: true,
		/// Sesenta filas por quince columnas: aquí la calidad se mide en hojas.
		denso: true,
		variante: 'neutro',
		ancho: 'completo',
		vacio: 'Sin recorridos en el periodo.'
	};
}

interface ClaveResumen {
	placa: string;
	mes: number;
}

/**
 * Resumen por PLACA y MES.
 *
 * Se agrupa por la placa del recorrido y no por la del conductor porque un
 * conductor puede cambiar de vehículo dentro del mes, y el conteo que se
 * factura es el del carro.
 *
 * Los recorridos sin placa se agrupan bajo «(sin placa)» en vez de
 * descartarse: si un bono se otorgó sobre una fila sin vehículo, esconderlo
 * haría que el resumen no cuadre con la tabla de arriba y nadie sabría por qué.
 */
export function bloqueResumenPorPlaca(
	dto: RecorridosPeriodoDTO,
	hojas: HojaRecorridos[]
): BloquePreview {
	const bonos = dto.bonos;
	const acumulado = new Map<string, { clave: ClaveResumen; counts: Record<string, number> }>();

	for (const hoja of hojas) {
		for (const f of hoja.filas) {
			const placa = f.vehiculo_placa?.trim() || '(sin placa)';
			const mesFila = Number(f.fecha.slice(5, 7)) || dto.mes;
			const k = `${placa}|${mesFila}`;
			let entrada = acumulado.get(k);
			if (!entrada) {
				entrada = { clave: { placa, mes: mesFila }, counts: {} };
				acumulado.set(k, entrada);
			}
			for (const b of bonos) {
				if (f.bonos?.[b.config_id]) {
					entrada.counts[b.config_id] = (entrada.counts[b.config_id] ?? 0) + 1;
				}
			}
		}
	}

	const columnas: ColumnaPreview[] = [
		{ key: 'placa', label: 'Placa', tipo: 'placa', peso: 8, fija: true },
		{ key: 'mes', label: 'Mes', tipo: 'texto', peso: 8, fija: true },
		...bonos.map((b) => ({
			key: `n_${b.config_id}`,
			label: b.nombre,
			tipo: 'numero' as const,
			peso: 9
		})),
		{ key: 'total_bonos', label: 'Total bonos', tipo: 'numero' as const, peso: 7 },
		{ key: 'valor', label: 'Valor', tipo: 'moneda' as const, peso: 10 }
	];

	const filas: FilaPreview[] = [...acumulado.values()]
		// Placa y luego mes: el lector busca primero su carro.
		.sort(
			(a, b) =>
				a.clave.placa.localeCompare(b.clave.placa, 'es') || a.clave.mes - b.clave.mes
		)
		// Una placa sin ningún bono en el mes no aporta nada al resumen.
		.filter((e) => Object.values(e.counts).some((n) => n > 0))
		.map((e) => {
			const celdas: Record<string, unknown> = {
				placa: e.clave.placa,
				mes: nombreMes(e.clave.mes).toUpperCase()
			};
			let total = 0;
			let valor = 0;
			for (const b of bonos) {
				const n = e.counts[b.config_id] ?? 0;
				celdas[`n_${b.config_id}`] = n || '';
				total += n;
				valor += n * b.valor;
			}
			celdas.total_bonos = total;
			celdas.valor = valor;
			return { celdas } as FilaPreview;
		});

	const valorTotal = filas.reduce((n, f) => n + Number((f.celdas as any).valor || 0), 0);

	return {
		id: 'resumen-bonos',
		titulo: 'Resumen de bonos por placa y mes',
		columnas,
		filas,
		pie: { label: 'Total del periodo', valor: valorTotal },
		variante: 'concepto',
		ancho: 'completo',
		vacio: 'No se otorgaron bonos en el periodo.'
	};
}

function meta(dto: RecorridosPeriodoDTO) {
	return {
		// Los del formato oficial OP-FR-03 v3, para que el PDF sea el mismo
		// documento que se venía llenando a mano.
		titulo: 'CONTROL DÍAS LABORADOS PERSONAL',
		meta: [
			{ label: 'Código', valor: 'OP-FR-03' },
			{ label: 'Versión', valor: '3' },
			{ label: 'Fecha', valor: '2025-01-09' }
		],
		/// Sin banda de periodo: el corte se lee en la cabecera de cada bloque,
		/// a la derecha del nombre del conductor. `periodo` vacío hace que
		/// `DocumentoHoja` no pinte la banda.
		periodo: []
	};
}

/**
 * Documento del preview.
 *
 * Con `conductorId` sale la hoja de esa persona; sin él, el periodo entero.
 * Debajo va siempre el resumen de bonos, calculado sobre las mismas hojas que
 * se están imprimiendo — si no, el resumen contaría bonos que no aparecen en la
 * tabla de arriba.
 */
export function documentoRecorridos(
	dto: RecorridosPeriodoDTO,
	conductorId?: string | null
): DocumentoPreview {
	const hojas = conductorId
		? dto.hojas.filter((h) => h.conductor_id === conductorId)
		: dto.hojas;

	/**
	 * Una SECCIÓN por conductor, y cada una abre hoja.
	 *
	 * En el consolidado del periodo, la planilla de un conductor empezando a
	 * media página debajo de la del anterior no se puede repartir: el papel de
	 * cada persona tiene que poder arrancarse entero. Con un solo conductor
	 * —el caso de «PDF de esta hoja»— esto es exactamente lo de antes: una
	 * sección, sin salto.
	 *
	 * El rótulo de la sección y su nota van solo en la primera: repetir
	 * «Recorridos del periodo» encima de cada conductor es ruido, y el nombre
	 * de cada uno ya encabeza su propio bloque.
	 */
	const secciones: SeccionPreview[] = hojas.map((h, i) => ({
		id: `recorridos-${h.conductor_id}`,
		/// Sin rótulo de sección ni nota: «Recorridos del periodo» repetía el
		/// nombre del formato, que ya está en el encabezado, y la nota explicaba
		/// al lector algo que la propia tabla enseña —una fila por recorrido—.
		/// Entre las dos se llevaban una banda entera en cada conductor.
		titulo: '',
		columnas: [],
		filas: [],
		bloques: [bloqueRecorridos(h, dto.bonos, dto.etiqueta)],
		bloquesPorFila: 1,
		saltoDePagina: i > 0
	}));

	/**
	 * Ni resumen, ni firmas, ni pie — tampoco en el consolidado.
	 *
	 * El consolidado no es otro documento: son las MISMAS planillas, una detrás
	 * de otra, cada una con su encabezado y lista para arrancarse y entregarse.
	 * Meterle al final un resumen y un pie de firmas lo convertía en un
	 * documento distinto del que se imprime por conductor, y añadía una hoja.
	 *
	 * El conteo por placa y mes no se pierde: `bloqueResumen()` se conserva y
	 * se sigue probando, listo para un informe aparte el día que haga falta.
	 */

	// APELLIDO primero, igual que en la pestaña y en la cabecera de la hoja.
	const nombre = conductorId
		? `${hojas[0]?.nombre ?? ''} ${hojas[0]?.apellido ?? ''}`.replace(/\s+/g, ' ').trim()
		: 'PERIODO';

	return {
		...meta(dto),
		secciones,
		/// Sin pie de firmas: son dos líneas en blanco que ocupan un cuarto de
		/// página apaisada para que alguien escriba encima. Quien firma lo hace
		/// sobre el impreso, y ese espacio vale más como renglones.
		firmas: false,
		/// Sin pie de página: la marca ya está en el logo del encabezado y el
		/// periodo en la banda del corte.
		piePagina: false,
		/// En el consolidado, cada conductor abre hoja CON su encabezado: esa
		/// página se arranca y se entrega sola.
		repetirEncabezado: !conductorId,
		sello: false,
		nombreArchivo: `OP-FR-03 ${nombre} ${dto.desde} a ${dto.hasta}`
			.replace(/\s+/g, ' ')
			.trim()
	} as DocumentoPreview;
}

/** Un documento por conductor, para el ZIP. */
export function hojasParaZip(dto: RecorridosPeriodoDTO) {
	return dto.hojas.map((h) => ({
		documento: documentoRecorridos(dto, h.conductor_id),
		nombreArchivo: `${h.apellido} ${h.nombre} ${dto.desde} a ${dto.hasta}`
			.replace(/\s+/g, ' ')
			.trim()
	}));
}

export { COP };
