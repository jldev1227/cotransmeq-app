/**
 * Freno de intentos para las rutas de recuperación.
 *
 * Es una ventana deslizante en memoria: por instancia, sin persistencia. No
 * sustituye a un rate limit de verdad —en Vercel cada instancia cuenta por su
 * cuenta y el contador se pierde al reciclarse—, pero corta el caso que de
 * verdad duele: un script pidiendo cientos de correos seguidos con la misma
 * dirección, que llenaría la bandeja del usuario y quemaría la cuota de Resend.
 */

interface Ventana {
	/** Marcas de tiempo de los intentos dentro de la ventana. */
	intentos: number[];
}

const registros = new Map<string, Ventana>();

/** Se limpia el mapa cuando crece; sin esto una instancia larga acumula claves. */
const MAX_CLAVES = 5_000;

export interface Limite {
	/** Intentos permitidos dentro de la ventana. */
	maximo: number;
	ventanaMs: number;
}

/** Tres correos cada cuarto de hora por dirección: suficiente si el primero no llegó. */
export const LIMITE_SOLICITUD: Limite = { maximo: 3, ventanaMs: 15 * 60 * 1000 };

/**
 * Por IP el margen es mucho más ancho a propósito: media empresa sale por la
 * misma IP pública, y con el límite por correo un tope de tres dejaría sin
 * recuperar la contraseña al segundo compañero de la misma oficina.
 */
export const LIMITE_SOLICITUD_IP: Limite = { maximo: 15, ventanaMs: 15 * 60 * 1000 };

/** Verificaciones de token por IP: frena el barrido de firmas a ciegas. */
export const LIMITE_VERIFICACION: Limite = { maximo: 30, ventanaMs: 15 * 60 * 1000 };

/**
 * Registra un intento y dice si se pasó del límite.
 *
 * @returns `true` cuando el intento cabe, `false` cuando hay que rechazarlo.
 */
export function permitir(clave: string, limite: Limite, ahora: number = Date.now()): boolean {
	if (registros.size > MAX_CLAVES) purgar(ahora);

	const ventana = registros.get(clave) ?? { intentos: [] };
	const desde = ahora - limite.ventanaMs;
	const vigentes = ventana.intentos.filter((t) => t > desde);

	if (vigentes.length >= limite.maximo) {
		// El intento rechazado no se registra: si no, un cliente insistente
		// mantendría la ventana llena para siempre y nunca se destrabaría.
		registros.set(clave, { intentos: vigentes });
		return false;
	}

	vigentes.push(ahora);
	registros.set(clave, { intentos: vigentes });
	return true;
}

function purgar(ahora: number): void {
	const limiteMasLargo = Math.max(
		LIMITE_SOLICITUD.ventanaMs,
		LIMITE_SOLICITUD_IP.ventanaMs,
		LIMITE_VERIFICACION.ventanaMs
	);
	for (const [clave, ventana] of registros) {
		if (ventana.intentos.every((t) => t <= ahora - limiteMasLargo)) registros.delete(clave);
	}
}

/** Solo para tests: deja el contador en blanco. */
export function reiniciarLimites(): void {
	registros.clear();
}
