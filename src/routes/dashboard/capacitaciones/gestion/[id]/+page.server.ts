import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => ({
  cursoId: params.id,
  aviso: url.searchParams.get('aviso') ?? ''
});
