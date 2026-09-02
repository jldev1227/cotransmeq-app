// src/routes/api/maps/autocomplete/+server.ts
//
// Proxy híbrido: combina resultados de la tabla `custom_places`
// (lugares registrados manualmente por los usuarios) con HERE Autocomplete.
// Los locales aparecen primero porque son específicos de la operación.
//
// Docs HERE: https://developer.here.com/documentation/geocoding-search-api/dev_guide/topics/endpoint-autocomplete-brief.html
import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const HERE_KEY = env.HERE_MAPS_API_KEY || '';
const HERE_URL = 'https://autocomplete.search.hereapi.com/v1/autocomplete';
const BACKEND_URL = env.BACKEND_INTERNAL_URL || 'http://localhost:4000';

interface HereItem {
	title: string;
	id: string;
	language?: string;
	resultType?: string;
	address?: {
		label?: string;
		city?: string;
		county?: string;
		countyCode?: string;
		countryCode?: string;
		countryName?: string;
		street?: string;
		postalCode?: string;
	};
}

/**
 * Llama al backend NestJS para buscar en `custom_places`.
 * Devuelve [] si el backend no responde, no requiere auth, o falla —
 * la idea es que un fallo en local NO tumbe la experiencia de HERE.
 */
async function fetchLocalPlaces(
	q: string,
	limit: number,
	authToken: string | null
): Promise<any[]> {
	try {
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

		const res = await fetch(
			`${BACKEND_URL}/api/custom-places?q=${encodeURIComponent(q)}&limit=${limit}`,
			{ headers }
		);
		if (!res.ok) return [];
		const data = await res.json();
		return Array.isArray(data?.results) ? data.results : [];
	} catch (e) {
		// Backend caído / no reachable → no rompemos la experiencia
		return [];
	}
}

/**
 * Extrae el token Bearer del cookie `transmeralda_token`.
 * El SvelteKit server no tiene localStorage; lee la cookie que el
 * cliente setea al hacer login (ver auth.ts:145).
 */
function getBearerToken(cookieHeader: string | null | undefined): string | null {
	if (!cookieHeader) return null;
	const cookies = cookieHeader.split(';');
	for (const c of cookies) {
		const [k, v] = c.trim().split('=');
		if (k === 'transmeralda_token' && v) return decodeURIComponent(v);
	}
	return null;
}

export const GET: RequestHandler = async ({ url, request }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const limit = parseInt(url.searchParams.get('limit') ?? '8', 10);
	const countryCode = (url.searchParams.get('countryCode') ?? 'COL').toUpperCase();
	const lang = url.searchParams.get('lang') ?? 'es';

	if (q.length < 3) {
		return json({ results: [] });
	}

	// ─── 1) Resultados locales (custom_places) — primero, sin coords ───
	const token = getBearerToken(request.headers.get('cookie'));
	const local = await fetchLocalPlaces(q, limit, token);
	const localResults = local.map((p) => ({
		id: p.id, // ya viene como "local:cp:<uuid>" desde NestJS
		title: p.title ?? p.nombre,
		subtitle: p.subtitle ?? p.categoria ?? p.address ?? null,
		address: p.address ?? p.nombre,
		source: 'local' as const
	}));

	// ─── 2) Resultados de HERE — sin coordenadas (lookup en 2º paso) ───
	let hereResults: any[] = [];
	let hereError: string | null = null;

	if (HERE_KEY) {
		const params = new URLSearchParams({
			q,
			limit: String(limit),
			apiKey: HERE_KEY,
			in: `countryCode:${countryCode}`,
			lang
		});
		try {
			const res = await fetch(`${HERE_URL}?${params.toString()}`, {
				headers: { Accept: 'application/json' }
			});
			if (!res.ok) {
				const detail = await res.text().catch(() => '');
				console.error('[maps/autocomplete] HERE upstream error', res.status, detail);
				hereError = `HERE Maps error: ${res.status}`;
			} else {
				const data = await res.json();
				const items: HereItem[] = Array.isArray(data?.items) ? data.items : [];
				hereResults = items.map((item) => {
					const a = item.address ?? {};
					const subtitle = [a.city, a.county, a.countryName]
						.filter(Boolean)
						.join(', ');
					return {
						id: item.id,
						title: item.title,
						subtitle,
						address: a.label ?? subtitle ?? item.title,
						source: 'here' as const
					};
				});
			}
		} catch (e: any) {
			console.error('[maps/autocomplete] HERE fetch error', e?.message ?? e);
			hereError = e?.message ?? 'upstream error';
		}
	} else {
		hereError = 'HERE_MAPS_API_KEY no configurada en el servidor';
	}

	// ─── 3) Mezclar: locales primero, luego HERE (sin duplicar por nombre) ───
	const seen = new Set<string>();
	const merged: any[] = [];
	for (const r of localResults) {
		const key = (r.title ?? '').toLowerCase();
		if (key && !seen.has(key)) {
			seen.add(key);
			merged.push(r);
		}
	}
	for (const r of hereResults) {
		const key = (r.title ?? '').toLowerCase();
		if (key && !seen.has(key)) {
			seen.add(key);
			merged.push(r);
		}
	}
	const results = merged.slice(0, limit);

	return json({ results, error: hereError });
};
