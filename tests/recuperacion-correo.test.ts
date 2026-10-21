import { describe, expect, it } from 'vitest';
import { htmlRecuperacion } from '$lib/server/recuperacion/correo';

describe('HTML del correo de recuperación', () => {
	it('usa la ilustración PNG de correo enviado desde el origen del enlace', () => {
		const html = htmlRecuperacion(
			'https://app.cotransmeq.com/recuperar-password/token-de-prueba'
		);

		expect(html).toContain(
			'src="https://app.cotransmeq.com/mascot/png/correo-enviado.png"'
		);
		expect(html).not.toContain('/mascot/png/saludando.png');
	});
});
