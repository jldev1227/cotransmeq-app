// src/routes/api/maps/custom-place/+server.ts
//
// Recibe una entrada manual (nombre + lat + lng) y la guarda en la
// tabla `custom_places` del backend NestJS. El id devuelto tiene el
// prefijo `local:cp:` para que el lookup la encuentre en próximos usos.
//
// Esta ruta REQUIERE autenticación: el token Bearer se reenvía al backend.
import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const BACKEND_URL = env.BACKEND_INTERNAL_URL || 'http://localhost:4000';

function getBearerToken(cookieHeader: string | null | undefined): string | null {
	if (!cookieHeader) return null;
	const cookies = cookieHeader.split(';');
	for (const c of cookies) {
		const [k, v] = c.trim().split('=');
		if (k === 'transmeralda_token' && v) return decodeURIComponent(v);
	}
	return null;
}

export const POST: RequestHandler = async ({ request }) => {
	const token = getBearerToken(request.headers.get('cookie'));
	if (!token) {
		return json(
			{ error: 'No autenticado. Inicia sesión para guardar lugares personalizados.' },
			{ status: 401 }
		);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Body inválido (se esperaba JSON)' }, { status: 400 });
	}

	const { nombre, latitud, longitud, categoria, descripcion, direccion, municipio_id } = body ?? {};

	if (!nombre || typeof nombre !== 'string' || nombre.trim().length < 2) {
		return json({ error: 'El nombre es obligatorio (mínimo 2 caracteres)' }, { status: 400 });
	}
	const lat = Number(latitud);
	const lng = Number(longitud);
	if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
		return json({ error: 'Latitud inválida' }, { status: 400 });
	}
	if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
		return json({ error: 'Longitud inválida' }, { status: 400 });
	}

	try {
		const res = await fetch(`${BACKEND_URL}/api/custom-places`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({
				nombre: nombre.trim(),
				latitud: lat,
				longitud: lng,
				categoria: categoria || null,
				descripcion: descripcion || null,
				direccion: direccion || null,
				municipio_id: municipio_id || null
			})
		});

		if (!res.ok) {
			const detail = await res.json().catch(() => ({}));
			return json(
				{
					error: detail?.error || `Backend error: ${res.status}`,
					details: detail?.details
				},
				{ status: res.status >= 500 ? 502 : res.status }
			);
		}

		const data = await res.json();
		const rowId = data?.data?.id;
		if (!rowId) {
			return json({ error: 'Respuesta inesperada del backend' }, { status: 502 });
		}
		// Devolvemos el id con el prefijo que entiende el lookup
		return json(
			{
				success: true,
				id: `local:cp:${rowId}`,
				_id: rowId,
				nombre: data.data.nombre,
				latitud: Number(data.data.latitud),
				longitud: Number(data.data.longitud)
			},
			{ status: 201 }
		);
	} catch (e: any) {
		console.error('[maps/custom-place] backend error:', e?.message ?? e);
		return json(
			{ error: 'No se pudo conectar con el backend', details: e?.message },
			{ status: 502 }
		);
	}
};
