import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const anio = Number(url.searchParams.get('anio'));
	const mes = Number(url.searchParams.get('mes'));
	return {
		anioInicial: Number.isInteger(anio) && anio >= 2000 && anio <= 2100 ? anio : undefined,
		mesInicial: Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : undefined
	};
};
