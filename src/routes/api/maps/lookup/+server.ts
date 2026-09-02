// src/routes/api/maps/lookup/+server.ts
//
// Lookup híbrido: si el id empieza con `local:cp:` consulta la tabla
// `custom_places` del backend; si no, consulta HERE Lookup.
//
// Docs HERE: https://developer.here.com/documentation/geocoding-search-api/dev_guide/topics/endpoint-lookup-brief.html
import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const HERE_KEY = env.HERE_MAPS_API_KEY || '';
const HERE_URL = 'https://lookup.search.hereapi.com/v1/lookup';
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

/**
 * Lookup en custom_places del backend NestJS.
 * El id que llega al frontend tiene prefijo `local:cp:`; aquí lo
 * separamos para obtener el UUID interno.
 */
async function lookupLocal(localId: string, authToken: string | null) {
	const uuid = localId.replace(/^local:cp:/, '');
	if (!uuid || uuid === localId) {
		return { error: 'ID local inválido', status: 400 as const };
	}
	try {
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

		const res = await fetch(`${BACKEND_URL}/api/custom-places/${uuid}`, { headers });
		if (!res.ok) {
			const detail = await res.json().catch(() => ({}));
			return {
				error: detail?.error ?? `Backend error: ${res.status}`,
				status: res.status as 400 | 401 | 404 | 500 | 502
			};
		}
		const data = await res.json();
		// data viene con `lat` y `lng` (ya convertidos a number desde Prisma)
		return {
			data: {
				id: localId,
				title: data.title ?? data.nombre,
				address: data.address ?? data.nombre,
				city: data.subtitle ?? null,
				county: null,
				country: null,
				lat: data.lat,
				lng: data.lng
			}
		};
	} catch (e: any) {
		return { error: e?.message ?? 'upstream error', status: 502 as const };
	}
}

async function lookupHere(hereId: string, lang: string) {
	const params = new URLSearchParams({ id: hereId, apiKey: HERE_KEY, lang });
	try {
		const res = await fetch(`${HERE_URL}?${params.toString()}`, {
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => '');
			console.error('[maps/lookup] HERE upstream error', res.status, detail);
			return { error: `HERE Maps error: ${res.status}`, status: 502 as const };
		}
		const data = await res.json();
		const position = data?.position;
		if (!position?.lat || !position?.lng) {
			return { error: 'No se encontraron coordenadas para este lugar', status: 404 as const };
		}
		return {
			data: {
				id: data.id,
				title: data.title,
				address: data.address?.label ?? data.title,
				city: data.address?.city,
				county: data.address?.county,
				country: data.address?.countryName,
				lat: position.lat,
				lng: position.lng
			}
		};
	} catch (e: any) {
		return { error: e?.message ?? 'upstream error', status: 502 as const };
	}
}

export const GET: RequestHandler = async ({ url, request }) => {
	const id = (url.searchParams.get('id') ?? '').trim();
	const lang = url.searchParams.get('lang') ?? 'es';

	if (!id) {
		return json({ error: 'Parámetro "id" es obligatorio' }, { status: 400 });
	}

	// ─── 1) ¿Es un id local? → NestJS ───
	if (id.startsWith('local:cp:')) {
		const token = getBearerToken(request.headers.get('cookie'));
		const result = await lookupLocal(id, token);
		if ('error' in result) {
			return json({ error: result.error }, { status: result.status });
		}
		return json(result.data);
	}

	// ─── 2) Si no, HERE ───
	if (!HERE_KEY) {
		return json({ error: 'HERE_MAPS_API_KEY no configurada en el servidor' }, { status: 500 });
	}
	const result = await lookupHere(id, lang);
	if ('error' in result) {
		return json({ error: result.error }, { status: result.status });
	}
	return json(result.data);
};
