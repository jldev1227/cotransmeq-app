import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const destino = new URLSearchParams(url.searchParams);
	destino.set('tipo', 'administrativo');
	redirect(307, `/dashboard/personal?${destino.toString()}`);
};
