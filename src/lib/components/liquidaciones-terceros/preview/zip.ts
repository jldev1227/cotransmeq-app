/**
 * Escritor de ZIP mínimo, solo con entradas SIN comprimir (método `store`).
 *
 * ── Por qué a mano y no una librería ──
 * Lo único que se mete en estos ZIP son PDF, y un PDF ya trae sus flujos
 * comprimidos por dentro: pasarlo por deflate ahorra un uno o dos por
 * ciento a cambio de traerse una dependencia entera al bundle. Sin
 * compresión, un ZIP es poco más que los ficheros pegados con una tabla al
 * final, y eso cabe en este fichero.
 *
 * El formato está en APPNOTE.TXT de PKWARE: cabecera local por entrada,
 * directorio central al terminar, y el registro de fin (EOCD) apuntando al
 * directorio. No se emite ZIP64: haría falta pasar de 4 GB o de 65 535
 * ficheros, y un lote de PDF de un periodo no se acerca ni de lejos.
 */

/** Tabla de CRC-32 (polinomio 0xEDB88320), construida una vez. */
const TABLA_CRC = (() => {
	const t = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[i] = c >>> 0;
	}
	return t;
})();

function crc32(datos: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * Fecha y hora en el formato MS-DOS que usa el ZIP.
 *
 * Guarda los segundos en pasos de dos y cuenta los años desde 1980; es una
 * herencia del formato, no una pérdida que importe aquí.
 */
function fechaDos(d: Date): { hora: number; fecha: number } {
	const anio = Math.max(1980, d.getFullYear());
	return {
		hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
		fecha: ((anio - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
	};
}

export interface EntradaZip {
	/** Ruta dentro del ZIP, con extensión. Se codifica en UTF-8. */
	nombre: string;
	datos: Uint8Array;
}

/** Escritor secuencial sobre un buffer que crece por trozos. */
class Escritor {
	private trozos: Uint8Array[] = [];
	private _largo = 0;

	get largo() {
		return this._largo;
	}

	push(b: Uint8Array) {
		this.trozos.push(b);
		this._largo += b.length;
	}

	/** Little-endian, que es como el ZIP guarda todos sus enteros. */
	u16(v: number) {
		const b = new Uint8Array(2);
		new DataView(b.buffer).setUint16(0, v & 0xffff, true);
		this.push(b);
	}

	u32(v: number) {
		const b = new Uint8Array(4);
		new DataView(b.buffer).setUint32(0, v >>> 0, true);
		this.push(b);
	}

	partes() {
		return this.trozos;
	}
}

/**
 * Arma el ZIP y lo devuelve como Blob listo para descargar.
 *
 * @param fecha marca de tiempo de todas las entradas. Se pasa en vez de
 *   tomarla dentro para que el mismo lote sea reproducible si hace falta.
 */
export function crearZip(entradas: EntradaZip[], fecha: Date = new Date()): Blob {
	const { hora, fecha: dosFecha } = fechaDos(fecha);
	const codificador = new TextEncoder();
	const buf = new Escritor();

	/// Lo que el directorio central necesita saber de cada entrada ya escrita.
	const centrales: Array<{
		nombre: Uint8Array;
		crc: number;
		tam: number;
		offset: number;
	}> = [];

	for (const e of entradas) {
		const nombre = codificador.encode(e.nombre);
		const crc = crc32(e.datos);
		const offset = buf.largo;

		// ── Cabecera local ──
		buf.u32(0x04034b50);
		buf.u16(20); // versión necesaria para extraer: 2.0
		// Bit 11: el nombre va en UTF-8. Sin él, un acento se leería con la
		// tabla de códigos del sistema y saldría roto en otro ordenador.
		buf.u16(0x0800);
		buf.u16(0); // método 0 = store
		buf.u16(hora);
		buf.u16(dosFecha);
		buf.u32(crc);
		buf.u32(e.datos.length); // comprimido
		buf.u32(e.datos.length); // sin comprimir
		buf.u16(nombre.length);
		buf.u16(0); // sin campo extra
		buf.push(nombre);
		buf.push(e.datos);

		centrales.push({ nombre, crc, tam: e.datos.length, offset });
	}

	// ── Directorio central ──
	const inicioDirectorio = buf.largo;
	for (const c of centrales) {
		buf.u32(0x02014b50);
		buf.u16(20); // versión del creador
		buf.u16(20); // versión necesaria
		buf.u16(0x0800);
		buf.u16(0);
		buf.u16(hora);
		buf.u16(dosFecha);
		buf.u32(c.crc);
		buf.u32(c.tam);
		buf.u32(c.tam);
		buf.u16(c.nombre.length);
		buf.u16(0); // extra
		buf.u16(0); // comentario
		buf.u16(0); // disco donde empieza
		buf.u16(0); // atributos internos
		buf.u32(0); // atributos externos
		buf.u32(c.offset);
		buf.push(c.nombre);
	}
	const tamDirectorio = buf.largo - inicioDirectorio;

	// ── Fin del directorio central ──
	buf.u32(0x06054b50);
	buf.u16(0); // número de disco
	buf.u16(0); // disco del directorio
	buf.u16(centrales.length);
	buf.u16(centrales.length);
	buf.u32(tamDirectorio);
	buf.u32(inicioDirectorio);
	buf.u16(0); // sin comentario

	return new Blob(buf.partes() as BlobPart[], { type: 'application/zip' });
}

/**
 * Nombre de fichero seguro para un ZIP.
 *
 * Los acentos se transliteran en vez de conservarse: el nombre viaja
 * marcado como UTF-8, pero el fichero acaba en el disco de quien lo abra y
 * las herramientas viejas de Windows siguen leyéndolo con su tabla de
 * códigos. «MUNOZ» se busca igual de bien que «MUÑOZ» y no depende de con
 * qué lo hayan descomprimido.
 */
export function nombreArchivoSeguro(bruto: string): string {
	return (
		(bruto || 'documento')
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^A-Za-z0-9._ -]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/ /g, '_')
			.slice(0, 120) || 'documento'
	);
}

/**
 * Desambigua nombres repetidos dentro del lote.
 *
 * Dos hojas pueden dar el mismo nombre —la misma placa liquidada a dos
 * propietarios con el nombre truncado igual—, y un ZIP con dos entradas
 * homónimas se descomprime pisando una con la otra sin avisar.
 */
export function nombreUnico(base: string, usados: Set<string>): string {
	if (!usados.has(base)) {
		usados.add(base);
		return base;
	}
	for (let i = 2; i < 1000; i++) {
		const cand = `${base}_${i}`;
		if (!usados.has(cand)) {
			usados.add(cand);
			return cand;
		}
	}
	usados.add(base);
	return base;
}
