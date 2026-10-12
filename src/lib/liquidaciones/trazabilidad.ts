/**
 * Trazabilidad de una liquidación de servicio: convierte el historial
 * (`historial_estado_liquidacion`) en eventos que se leen solos.
 *
 * El historial guarda tres clases de evento —creación, edición y cambio de
 * estado— y casi todos traen una foto (`snapshot`) de la liquidación en ese
 * momento: totales, servicios, OSI, operadora… El modal anterior pintaba todo
 * como cambio de estado (una edición salía «Borrador → Borrador») y no decía
 * qué había cambiado. Aquí cada evento se compara con la foto del anterior y
 * se cuenta: el total subió tanto, se agregó tal servicio, cambió la OSI.
 *
 * Puro y sin `$app/*`: lo usan el visor de la liquidación y el listado, y se
 * prueba en `tests/trazabilidad-liquidacion.test.ts`.
 */
import type { HistorialEstado } from '$lib/api/liquidaciones-servicios';

export type TipoEvento = 'creacion' | 'edicion' | 'estado' | 'anulacion' | 'reactivacion';

export interface CambioCampo {
	etiqueta: string;
	antes: string;
	despues: string;
	/** «+$150.000» / «−$20.000» en los campos de dinero. */
	diferencia?: string;
	/** Para colorear la diferencia: subir no es bueno ni malo, solo se ve. */
	sube?: boolean;
}

export interface CambioServicio {
	tipo: 'agregado' | 'quitado' | 'modificado';
	texto: string;
}

export interface EventoTrazabilidad {
	id: string;
	tipo: TipoEvento;
	titulo: string;
	estadoAnterior: string | null;
	estadoNuevo: string;
	usuario: string;
	/** ISO, tal como viene del servidor. */
	fecha: string;
	motivo: string | null;
	/** Total de la liquidación en ese momento (de la foto), si se guardó. */
	total: number | null;
	/** Servicios de la liquidación en ese momento. */
	servicios: number | null;
	cambios: CambioCampo[];
	serviciosCambiados: CambioServicio[];
	/** Cambios de servicios que no se listan para no hacer eterna la tarjeta. */
	serviciosOcultos: number;
	/** No hay foto anterior con qué comparar (primer evento o foto ausente). */
	sinComparacion: boolean;
}

export const ETIQUETA_ESTADO: Record<string, string> = {
	BORRADOR: 'Borrador',
	LIQUIDADA: 'Liquidada',
	APROBADA: 'Aprobada',
	FACTURADA: 'Facturada',
	ANULADA: 'Anulada'
};

/// Semáforo del listado de liquidaciones. Es lo único que difiere entre los
/// dos repos (cada empresa pinta «facturada» con su color de marca).
export const COLOR_ESTADO: Record<string, string> = {
	BORRADOR: '#64748b',
	LIQUIDADA: '#2563eb',
	APROBADA: '#16a34a',
	FACTURADA: '#c2410c',
	ANULADA: '#dc2626'
};

const TITULO_ESTADO: Record<string, string> = {
	LIQUIDADA: 'Marcó la liquidación como liquidada',
	APROBADA: 'Aprobó la liquidación',
	FACTURADA: 'Facturó la liquidación',
	BORRADOR: 'Devolvió la liquidación a borrador'
};

/// Campos de dinero que se comparan, en el orden en que se muestran. El total
/// va primero: es lo que la gente busca en una trazabilidad.
const CAMPOS_DINERO: Array<[string, string]> = [
	['total', 'Total'],
	['valor_servicios', 'Servicios'],
	['valor_recargos', 'Recargos'],
	['valor_pernoctes', 'Pernoctes'],
	['valor_transporte_adicional', 'Transporte adicional'],
	['valor_iva', 'IVA']
];

const MAX_SERVICIOS = 5;

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES = [
	'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
	'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const fmtCOP = new Intl.NumberFormat('es-CO', {
	style: 'currency',
	currency: 'COP',
	maximumFractionDigits: 0
});

export function formatoCOP(n: number): string {
	return fmtCOP.format(Math.round(n)).replace(/\s/g, ' ');
}

function diferencia(antes: number, despues: number): string {
	const d = Math.round(despues - antes);
	return `${d >= 0 ? '+' : '−'}${formatoCOP(Math.abs(d))}`;
}

type Foto = Record<string, unknown>;

function foto(h: HistorialEstado): Foto | null {
	return h.snapshot && typeof h.snapshot === 'object' ? (h.snapshot as Foto) : null;
}

function numero(v: unknown): number | null {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function texto(v: unknown): string {
	return v === null || v === undefined ? '' : String(v).trim();
}

function recortar(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** «31 mar» a partir de «2026-03-31T00:00:00.000Z» (fechas de calendario, en UTC). */
function diaCorto(v: unknown): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(v));
	return m ? `${Number(m[3])} ${MESES_CORTOS[Number(m[2]) - 1]}` : '';
}

interface ServicioFoto {
	placa?: string;
	fecha_inicial?: string;
	fecha_final?: string;
	recorrido?: string;
	tipo_servicio?: string;
	numero_planilla?: string | null;
	valor_final?: number | string;
	cantidad?: number | string;
}

function serviciosDe(f: Foto | null): ServicioFoto[] | null {
	const items = f?.items;
	return Array.isArray(items) ? (items as ServicioFoto[]) : null;
}

/// La foto no guarda el id del ítem, así que un servicio se reconoce por lo
/// que lo identifica en el documento. Dos servicios iguales en todo cuentan
/// como dos (se comparan como multiconjunto, no como conjunto).
function claveServicio(s: ServicioFoto): string {
	return [s.placa, texto(s.fecha_inicial).slice(0, 10), texto(s.fecha_final).slice(0, 10), texto(s.recorrido), s.tipo_servicio, texto(s.numero_planilla)]
		.map((x) => texto(x).toUpperCase())
		.join('|');
}

function describirServicio(s: ServicioFoto): string {
	const partes = [texto(s.placa), diaCorto(s.fecha_inicial), recortar(texto(s.recorrido), 42)].filter(Boolean);
	const valor = numero(s.valor_final);
	return `${partes.join(' · ')}${valor !== null ? ` · ${formatoCOP(valor)}` : ''}`;
}

function compararServicios(antes: ServicioFoto[], despues: ServicioFoto[]): CambioServicio[] {
	const pendientes = new Map<string, ServicioFoto[]>();
	for (const s of antes) {
		const k = claveServicio(s);
		pendientes.set(k, [...(pendientes.get(k) ?? []), s]);
	}
	const cambios: CambioServicio[] = [];
	for (const s of despues) {
		const k = claveServicio(s);
		const lista = pendientes.get(k);
		if (lista?.length) {
			const viejo = lista.shift()!;
			const va = numero(viejo.valor_final);
			const vb = numero(s.valor_final);
			const ca = numero(viejo.cantidad);
			const cb = numero(s.cantidad);
			if ((va !== null && vb !== null && Math.round(va) !== Math.round(vb)) || (ca !== null && cb !== null && ca !== cb)) {
				const detalle =
					va !== null && vb !== null && Math.round(va) !== Math.round(vb)
						? `${formatoCOP(va)} → ${formatoCOP(vb)}`
						: `cantidad ${ca} → ${cb}`;
				cambios.push({
					tipo: 'modificado',
					texto: `${[texto(s.placa), diaCorto(s.fecha_inicial)].filter(Boolean).join(' · ')}: ${detalle}`
				});
			}
		} else {
			cambios.push({ tipo: 'agregado', texto: describirServicio(s) });
		}
	}
	for (const lista of pendientes.values()) {
		for (const s of lista) cambios.push({ tipo: 'quitado', texto: describirServicio(s) });
	}
	return cambios;
}

function periodoDe(f: Foto): string {
	const mes = numero(f.mes);
	const anio = numero(f.anio);
	if (mes === null || anio === null) return '';
	return `${MESES[mes - 1] ?? mes} ${anio}`;
}

function clienteDe(f: Foto): string {
	const c = f.cliente;
	return c && typeof c === 'object' ? texto((c as Record<string, unknown>).nombre) : texto(c);
}

function compararFotos(a: Foto, b: Foto): CambioCampo[] {
	const cambios: CambioCampo[] = [];
	for (const [clave, etiqueta] of CAMPOS_DINERO) {
		const va = numero(a[clave]);
		const vb = numero(b[clave]);
		if (va === null || vb === null || Math.round(va) === Math.round(vb)) continue;
		cambios.push({
			etiqueta,
			antes: formatoCOP(va),
			despues: formatoCOP(vb),
			diferencia: diferencia(va, vb),
			sube: vb > va
		});
	}
	/// Solo cuenta como cambio si las DOS fotos traen el campo: las de
	/// versiones viejas del editor no guardaban todo, y un campo ausente no es
	/// un campo que alguien vació.
	const tiene = (f: Foto, ...claves: string[]) => claves.every((c) => c in f);
	const textos: Array<[string, boolean, string, string]> = [
		['Cliente', tiene(a, 'cliente') && tiene(b, 'cliente'), clienteDe(a), clienteDe(b)],
		['Periodo', tiene(a, 'mes', 'anio') && tiene(b, 'mes', 'anio'), periodoDe(a), periodoDe(b)],
		['OSI', tiene(a, 'osi') && tiene(b, 'osi'), texto(a.osi), texto(b.osi)],
		['Operadora', tiene(a, 'operadora') && tiene(b, 'operadora'), texto(a.operadora), texto(b.operadora)],
		['IVA %', tiene(a, 'porcentaje_iva') && tiene(b, 'porcentaje_iva'), texto(a.porcentaje_iva), texto(b.porcentaje_iva)],
		[
			'Observaciones',
			tiene(a, 'observaciones') && tiene(b, 'observaciones'),
			recortar(texto(a.observaciones), 60),
			recortar(texto(b.observaciones), 60)
		]
	];
	for (const [etiqueta, comparable, antes, despues] of textos) {
		if (!comparable || antes === despues) continue;
		cambios.push({ etiqueta, antes: antes || '—', despues: despues || '—' });
	}
	return cambios;
}

function tipoYTitulo(h: HistorialEstado): { tipo: TipoEvento; titulo: string } {
	if (h.accion === 'creacion') return { tipo: 'creacion', titulo: 'Creó la liquidación' };
	if (h.accion === 'edicion') return { tipo: 'edicion', titulo: 'Editó la liquidación' };
	if (h.estado_nuevo === 'ANULADA') return { tipo: 'anulacion', titulo: 'Anuló la liquidación' };
	if (h.estado_anterior === 'ANULADA') return { tipo: 'reactivacion', titulo: 'Reactivó la liquidación' };
	if (h.estado_anterior && h.estado_anterior === h.estado_nuevo) {
		return { tipo: 'edicion', titulo: 'Actualizó la liquidación' };
	}
	return { tipo: 'estado', titulo: TITULO_ESTADO[h.estado_nuevo] ?? `Pasó a ${ETIQUETA_ESTADO[h.estado_nuevo] ?? h.estado_nuevo}` };
}

/**
 * Eventos del historial, del más reciente al más antiguo, cada uno con lo que
 * cambió respecto al anterior que tenía foto.
 */
export function construirEventos(historial: HistorialEstado[]): EventoTrazabilidad[] {
	const cronologico = [...historial].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
	let anterior: Foto | null = null;
	const eventos: EventoTrazabilidad[] = [];
	for (const h of cronologico) {
		const actual = foto(h);
		const { tipo, titulo } = tipoYTitulo(h);
		let cambios: CambioCampo[] = [];
		let serviciosCambiados: CambioServicio[] = [];
		const sinComparacion = !actual || !anterior;
		if (actual && anterior) {
			cambios = compararFotos(anterior, actual);
			const sa = serviciosDe(anterior);
			const sb = serviciosDe(actual);
			if (sa && sb) serviciosCambiados = compararServicios(sa, sb);
		}
		const servicios = serviciosDe(actual);
		eventos.push({
			id: h.id,
			tipo,
			titulo,
			estadoAnterior: h.estado_anterior,
			estadoNuevo: h.estado_nuevo,
			usuario: h.usuario?.nombre || h.usuario?.correo || 'Sistema',
			fecha: h.created_at,
			motivo: h.motivo?.trim() || null,
			total: actual ? numero(actual.total) : null,
			servicios: servicios ? servicios.length : actual ? numero(actual.total_items) : null,
			cambios,
			serviciosCambiados: serviciosCambiados.slice(0, MAX_SERVICIOS),
			serviciosOcultos: Math.max(0, serviciosCambiados.length - MAX_SERVICIOS),
			sinComparacion
		});
		if (actual) anterior = actual;
	}
	return eventos.reverse();
}

export interface Hito {
	etiqueta: string;
	fecha: string;
	usuario: string;
	color: string;
}

/**
 * Los momentos clave arriba del modal: quién la creó, y la última vez que se
 * liquidó, aprobó, facturó o anuló. Una liquidación que volvió a borrador y se
 * aprobó de nuevo muestra la aprobación vigente, no la primera.
 */
export function hitosDe(eventos: EventoTrazabilidad[]): Hito[] {
	const cronologico = [...eventos].reverse();
	const hitos: Hito[] = [];
	const creacion = cronologico.find((e) => e.tipo === 'creacion') ?? cronologico[0];
	if (creacion) {
		hitos.push({ etiqueta: 'Creada', fecha: creacion.fecha, usuario: creacion.usuario, color: COLOR_ESTADO.BORRADOR });
	}
	for (const estado of ['LIQUIDADA', 'APROBADA', 'FACTURADA', 'ANULADA']) {
		const ultimo = [...cronologico].reverse().find((e) => e.tipo !== 'edicion' && e.estadoNuevo === estado);
		if (ultimo) {
			hitos.push({ etiqueta: ETIQUETA_ESTADO[estado], fecha: ultimo.fecha, usuario: ultimo.usuario, color: COLOR_ESTADO[estado] });
		}
	}
	return hitos;
}

/// La hora local es UTC−5 todo el año (Colombia no tiene horario de verano):
/// el día se calcula en Bogotá, no en el reloj del navegador.
const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000;
const diaBogota = (iso: string | number | Date) =>
	new Date(new Date(iso).getTime() - OFFSET_BOGOTA_MS).toISOString().slice(0, 10);

export function horaBogota(iso: string): string {
	return new Intl.DateTimeFormat('es-CO', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'America/Bogota'
	}).format(new Date(iso));
}

export function fechaBogota(iso: string): string {
	return new Intl.DateTimeFormat('es-CO', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'America/Bogota'
	}).format(new Date(iso));
}

export interface DiaEventos {
	clave: string;
	etiqueta: string;
	eventos: EventoTrazabilidad[];
}

/** Agrupa por día de Bogotá, conservando el orden (más reciente primero). */
export function agruparPorDia(eventos: EventoTrazabilidad[], ahora: Date = new Date()): DiaEventos[] {
	const hoy = diaBogota(ahora);
	const ayer = diaBogota(ahora.getTime() - 24 * 60 * 60 * 1000);
	const dias: DiaEventos[] = [];
	for (const e of eventos) {
		const clave = diaBogota(e.fecha);
		let dia = dias[dias.length - 1];
		if (!dia || dia.clave !== clave) {
			const etiqueta =
				clave === hoy
					? 'Hoy'
					: clave === ayer
						? 'Ayer'
						: new Intl.DateTimeFormat('es-CO', {
								weekday: 'long',
								day: 'numeric',
								month: 'long',
								year: 'numeric',
								timeZone: 'America/Bogota'
							}).format(new Date(e.fecha));
			dia = { clave, etiqueta: etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1), eventos: [] };
			dias.push(dia);
		}
		dia.eventos.push(e);
	}
	return dias;
}
