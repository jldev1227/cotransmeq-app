import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	const destino = new URLSearchParams(url.searchParams);
	destino.set('tipo', 'conductor');
	redirect(307, `/dashboard/personal/${encodeURIComponent(params.id)}?${destino.toString()}`);
};
