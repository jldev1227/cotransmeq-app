import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const AZURE_KEY = env.AZURE_MAPS_KEY || '';
const REVERSE_URL = 'https://atlas.microsoft.com/search/address/reverse/json';

export const GET: RequestHandler = async ({ url }) => {
	const lat = url.searchParams.get('lat');
	const lon = url.searchParams.get('lng');

	if (!AZURE_KEY) {
		return json(
			{ address: '', lat: 0, lng: 0, error: 'AZURE_MAPS_KEY no configurada en el servidor' },
			{ status: 500 }
		);
	}

	const latNum = lat != null ? parseFloat(lat) : NaN;
	const lonNum = lon != null ? parseFloat(lon) : NaN;
	if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
		return json({ address: '', lat: 0, lng: 0, error: 'lat y lng son requeridos' }, { status: 400 });
	}

	const params = new URLSearchParams({
		'api-version': '1.0',
		query: `${latNum},${lonNum}`,
		'subscription-key': AZURE_KEY,
		language: 'es-ES',
		returnSpeedLimit: 'false',
		returnRoadUse: 'false'
	});

	try {
		const res = await fetch(`${REVERSE_URL}?${params.toString()}`, {
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => '');
			console.error('[maps/place] azure upstream error', res.status, detail);
			return json(
				{ address: '', lat: latNum, lng: lonNum, error: `Azure Maps error: ${res.status}` },
				{ status: 502 }
			);
		}
		const data = await res.json();
		const first = Array.isArray(data?.addresses) ? data.addresses[0] : null;
		const freeform = first?.address?.freeformAddress ?? '';
		return json({ address: freeform, lat: latNum, lng: lonNum });
	} catch (e: any) {
		console.error('[maps/place] fetch error', e?.message ?? e);
		return json(
			{ address: '', lat: latNum, lng: lonNum, error: e?.message ?? 'upstream error' },
			{ status: 502 }
		);
	}
};
