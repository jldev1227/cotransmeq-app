export interface ReferenciaModalURL {
	key: string;
	id?: string;
	ids?: string[];
	tab?: string;
}

/** La pestaña es estado interno del modal; cambiarla no debe volver a cargar el registro. */
export function mismaReferenciaModal(a: ReferenciaModalURL | null, b: ReferenciaModalURL | null): boolean {
	return (
		a?.key === b?.key &&
		a?.id === b?.id &&
		a?.ids?.join(',') === b?.ids?.join(',')
	);
}

const PARAMS_MODAL = ['modal', 'modalId', 'modalIds', 'modalTab'] as const;

/** Lee la referencia de modal sin interpretar ni alterar el resto de la consulta. */
export function leerReferenciaModalURL(url: URL): ReferenciaModalURL | null {
	const key = url.searchParams.get('modal');
	if (!key) return null;

	const id = url.searchParams.get('modalId') || undefined;
	const ids = url.searchParams
		.get('modalIds')
		?.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	const tab = url.searchParams.get('modalTab') || undefined;

	return {
		key,
		...(id ? { id } : {}),
		...(ids?.length ? { ids } : {}),
		...(tab ? { tab } : {})
	};
}

/** Construye una URL de modal conservando filtros, hash y parámetros ajenos. */
export function escribirReferenciaModalURL(url: URL, referencia: ReferenciaModalURL | null): URL {
	const destino = new URL(url.href);
	const anterior = leerReferenciaModalURL(url);
	const tabConservada =
		referencia &&
		referencia.key === anterior?.key &&
		referencia.id === anterior.id &&
		referencia.tab === undefined
			? anterior.tab
			: undefined;

	for (const parametro of PARAMS_MODAL) destino.searchParams.delete(parametro);
	if (referencia) {
		destino.searchParams.set('modal', referencia.key);
		if (referencia.id) destino.searchParams.set('modalId', referencia.id);
		if (referencia.ids?.length) destino.searchParams.set('modalIds', referencia.ids.join(','));
		const tab = referencia.tab ?? tabConservada;
		if (tab) destino.searchParams.set('modalTab', tab);
	}

	return destino;
}
