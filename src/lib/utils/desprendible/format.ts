/**
 * Helpers de formato compartidos entre el preview HTML y el PDF.
 */

export function formatCurrency(value: number | string | null | undefined): string {
	const num = Number(value) || 0;
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(num);
}

export function formatCurrencyDecimal(amount: number): string {
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		minimumFractionDigits: 1,
		maximumFractionDigits: 1
	}).format(amount);
}

export function formatDate(dateStr: string | null | undefined): string {
	if (!dateStr) return 'Sin fecha';
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

export function monthAndYear(dateStr: string | null | undefined): string {
	if (!dateStr) return '';
	const date = new Date(dateStr + 'T00:00:00');
	if (isNaN(date.getTime())) return '';
	return date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }).toUpperCase();
}

export function monthAndYearLower(dateStr: string | null | undefined): string {
	if (!dateStr) return '';
	const date = new Date(dateStr + 'T00:00:00');
	if (isNaN(date.getTime())) return '';
	return date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
}

export function safeValue<T>(val: any, def: T): T {
	return val !== undefined && val !== null ? val : def;
}

export function safeString(val: any, def: string = ''): string {
	return val !== undefined && val !== null ? String(val) : def;
}

export function safeNumber(val: any, def: number = 0): number {
	const n = Number(val);
	return Number.isFinite(n) ? n : def;
}

export function parseValuesJson(values: any): any[] {
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

export function parseFechas(fechas: any): string[] {
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
}
