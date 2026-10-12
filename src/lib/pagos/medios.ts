/**
 * Medios de pago, espejo de `backend-nest/src/lib/pagos/medios.ts`.
 *
 * Los usan los abonos de cartera (lo que paga un cliente) y el pago de los
 * cierres de terceros (lo que la empresa le paga a un propietario). La base
 * los fija con un CHECK: añadir uno solo aquí haría fallar el guardado.
 */
export const MEDIOS_PAGO = ['TRANSFERENCIA', 'CONSIGNACION', 'CHEQUE', 'EFECTIVO', 'OTRO'] as const;

export type MedioPago = (typeof MEDIOS_PAGO)[number];

export const ETIQUETA_MEDIO: Record<string, string> = {
	TRANSFERENCIA: 'Transferencia',
	CONSIGNACION: 'Consignación',
	CHEQUE: 'Cheque',
	EFECTIVO: 'Efectivo',
	OTRO: 'Otro'
};

/** Hoy en Colombia como `YYYY-MM-DD`, para el valor por defecto de los campos de fecha. */
export function hoyColombia(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

/**
 * `YYYY-MM-DD` → «10 oct 2026». Se arma a mano y no con `new Date(dia)`: esa
 * lectura es UTC y en Colombia (UTC-5) pinta el día anterior.
 */
export function fechaCorta(dia: string | null | undefined): string {
	if (!dia) return '—';
	const [a, m, d] = dia.slice(0, 10).split('-').map(Number);
	if (!a || !m || !d) return dia;
	const meses = [
		'ene',
		'feb',
		'mar',
		'abr',
		'may',
		'jun',
		'jul',
		'ago',
		'sep',
		'oct',
		'nov',
		'dic'
	];
	return `${d} ${meses[m - 1]} ${a}`;
}

const cop = new Intl.NumberFormat('es-CO', {
	style: 'currency',
	currency: 'COP',
	minimumFractionDigits: 0,
	maximumFractionDigits: 0
});

/** Pesos sin decimales, como el resto de pantallas de dinero. */
export function pesos(v: number | string | null | undefined): string {
	return cop.format(Number(v ?? 0) || 0);
}

/** Suma días a un `YYYY-MM-DD` en UTC, sin que la zona horaria corra la fecha. */
export function sumarDias(dia: string, dias: number): string {
	const d = new Date(`${dia}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return '';
	d.setUTCDate(d.getUTCDate() + dias);
	return d.toISOString().slice(0, 10);
}
