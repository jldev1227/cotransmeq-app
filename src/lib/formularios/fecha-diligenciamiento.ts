/**
 * Fecha del formulario: cuándo se empezó a diligenciar.
 *
 * Réplica del contrato de `backend-nest/.../domain/fecha-diligenciamiento.ts`.
 *
 * NO la escribe nadie. La pone el servidor desde `started_at`, que a su vez sale
 * del momento en que el formulario se abrió en el dispositivo. Aquí solo se LEE
 * —para mostrarla— y se calcula la del borrador local, que es lo único que el
 * teléfono puede saber antes de hablar con el servidor.
 *
 * Vive en el contexto del envío y no como campo de la definición: los campos
 * pertenecen a una versión publicada e inmutable, y añadir uno obligaría a
 * republicar todos los formularios invalidando los borradores en curso.
 */

/** Clave dentro del contexto del envío. Igual en el backend. */
export const CLAVE_FECHA_DILIGENCIAMIENTO = 'filledOn';

const FORMATO = /^\d{4}-\d{2}-\d{2}$/;

/** `true` si es una fecha real en `YYYY-MM-DD`. `2026-02-31` no lo es. */
export function esFechaISO(valor: unknown): valor is string {
	if (typeof valor !== 'string' || !FORMATO.test(valor)) return false;
	const fecha = new Date(`${valor}T00:00:00.000Z`);
	return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

/**
 * La fecha local de un instante.
 *
 * No `toISOString()`: eso da la fecha en UTC, y a las 7 de la noche en Colombia
 * ya es el día siguiente en UTC. Un preoperacional de las 22:00 saldría fechado
 * al día siguiente, que es justo el error que esta función evita.
 */
export function fechaLocalDe(instante: Date | string | number = new Date()): string {
	const fecha = instante instanceof Date ? instante : new Date(instante);
	if (Number.isNaN(fecha.getTime())) return fechaLocalDe(new Date());
	const mes = String(fecha.getMonth() + 1).padStart(2, '0');
	const dia = String(fecha.getDate()).padStart(2, '0');
	return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/**
 * Lee la fecha del formulario del contexto de un envío.
 *
 * `null` cuando no la trae o cuando lo que trae no es una fecha: el contexto es
 * JSON libre y los envíos anteriores a este campo no la tienen. Devolver `null`
 * —y no hoy— es lo correcto: un documento firmado no puede mostrar una fecha
 * inventada al vuelo por quien lo está leyendo.
 */
export function fechaDeFormularioDe(contexto: unknown): string | null {
	const valor = (contexto as Record<string, unknown> | null | undefined)?.[
		CLAVE_FECHA_DILIGENCIAMIENTO
	];
	return esFechaISO(valor) ? valor : null;
}

/** `2026-09-04` → `04/09/2026`. Lo que el conductor espera leer. */
export function formatearFechaCorta(iso: string | null): string {
	if (!esFechaISO(iso)) return '—';
	const [a, m, d] = iso.split('-');
	return `${d}/${m}/${a}`;
}
