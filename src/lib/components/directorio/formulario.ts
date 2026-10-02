import { toast } from 'svelte-sonner';

/**
 * Lo que comparten los formularios de directorio: leer los errores del
 * backend, repartirlos por pestaña y avisar con el mismo tono en los tres.
 */

export type Errores = Record<string, string>;

/**
 * Traduce el error de una petición a `{ mensaje, campos }`.
 *
 * El backend responde de varias formas según el módulo —`{ errors: {campo:
 * msg} }`, `{ message }`, `{ error }`, o un objeto plano campo → mensaje—, y
 * cada formulario lo leía a su manera. `campos` se pinta bajo cada input;
 * `mensaje` va al toast.
 */
export function errorDeApi(err: any, porDefecto: string): { mensaje: string; campos: Errores } {
	const data = err?.response?.data ?? err?.data;
	const campos: Errores = {};

	const fuente = data?.errors && typeof data.errors === 'object' ? data.errors : null;
	if (fuente) {
		for (const [k, v] of Object.entries(fuente)) {
			const texto = Array.isArray(v) ? v[0] : ((v as any)?.message ?? v);
			if (typeof texto === 'string') campos[k] = texto;
		}
	}

	const mensaje =
		(typeof data?.message === 'string' && data.message) ||
		(typeof data?.error === 'string' && data.error) ||
		Object.values(campos)[0] ||
		(typeof data === 'string' && data) ||
		err?.message ||
		porDefecto;

	return { mensaje, campos };
}

/** Cuenta los errores de cada pestaña según a cuál pertenece cada campo. */
export function erroresPorTab(
	errores: Errores,
	campoTab: Record<string, string>
): Record<string, number> {
	const conteo: Record<string, number> = {};
	for (const campo of Object.keys(errores)) {
		const tab = campoTab[campo];
		if (tab) conteo[tab] = (conteo[tab] ?? 0) + 1;
	}
	return conteo;
}

/** La primera pestaña con errores, para llevar al usuario a ella. */
export function primeraTabConError(
	errores: Errores,
	campoTab: Record<string, string>,
	orden: string[]
): string | null {
	const conError = new Set(
		Object.keys(errores)
			.map((c) => campoTab[c])
			.filter(Boolean)
	);
	return orden.find((t) => conError.has(t)) ?? null;
}

/** Aviso de validación: uno solo, con cuántos campos faltan. */
export function avisarErroresValidacion(errores: Errores) {
	const n = Object.keys(errores).length;
	toast.error(n === 1 ? 'Revisa un campo del formulario' : `Revisa ${n} campos del formulario`, {
		description: Object.values(errores)[0]
	});
}

/** Aviso de guardado, igual en los tres directorios. */
export function avisarGuardado(entidad: string, nombre: string, creado: boolean) {
	toast.success(creado ? `${entidad} creado` : `${entidad} actualizado`, {
		description: nombre
	});
}

export function avisarErrorGuardado(mensaje: string, creado: boolean) {
	toast.error(creado ? 'No se pudo crear' : 'No se pudieron guardar los cambios', {
		description: mensaje
	});
}

/** Compara dos estados de formulario para saber si hay cambios sin guardar. */
export function hayCambios(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) !== JSON.stringify(b);
}
