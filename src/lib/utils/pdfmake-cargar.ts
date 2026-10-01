/**
 * Carga pdfmake con sus fuentes, una sola vez para toda la app.
 *
 * pdfmake 0.3 cambió dos cosas que rompían la carga que había copiada en
 * cinco sitios: `vfs_fonts` ahora exporta el diccionario de fuentes a secas
 * (antes era `{ pdfMake: { vfs } }`), y las fuentes se registran con
 * `addVirtualFileSystem` en vez de asignando `pdfMake.vfs`. Con la carga
 * antigua `vfs` quedaba `undefined`, pdfmake no encontraba Roboto y
 * `getBlob` no llamaba nunca a su callback: la vista previa del desprendible
 * se quedaba «generando» para siempre y sin error en consola.
 *
 * Solo corre en el cliente: pdfmake toca `window`.
 */
let pdfMakeCargado: Promise<any> | null = null;

export function cargarPdfMake(): Promise<any> {
	if (!pdfMakeCargado) {
		pdfMakeCargado = (async () => {
			const pdfMake: any = (await import('pdfmake/build/pdfmake')).default;
			const modulo: any = await import('pdfmake/build/vfs_fonts');
			const candidato = modulo?.default ?? modulo;
			/// Se aceptan las tres formas que ha tenido el paquete: el vfs a
			/// secas (0.3), `{ vfs }` y `{ pdfMake: { vfs } }` (0.2).
			const vfs = candidato?.pdfMake?.vfs ?? candidato?.vfs ?? candidato;
			if (!vfs || typeof vfs !== 'object' || !Object.keys(vfs).length) {
				throw new Error('No se pudieron cargar las fuentes de pdfmake.');
			}
			if (typeof pdfMake.addVirtualFileSystem === 'function') {
				pdfMake.addVirtualFileSystem(vfs);
			} else {
				pdfMake.vfs = vfs;
			}
			return pdfMake;
		})().catch((e) => {
			/// Un fallo no se queda cacheado: el siguiente intento vuelve a cargar.
			pdfMakeCargado = null;
			throw e;
		});
	}
	return pdfMakeCargado;
}

/**
 * `createPdf(...).getBlob` como promesa que SIEMPRE termina.
 *
 * pdfmake 0.3 genera en una promesa interna y, si algo falla dentro, el
 * callback no se llama ni se lanza nada hacia fuera. Aquí se escucha tanto
 * el callback como la promesa que devuelve, y un plazo máximo convierte
 * cualquier silencio en un error con mensaje.
 */
export function blobDePdf(pdfMake: any, docDefinition: unknown, plazoMs = 60_000): Promise<Blob> {
	return new Promise<Blob>((resolve, reject) => {
		const temporizador = setTimeout(
			() => reject(new Error(`El PDF tardó más de ${Math.round(plazoMs / 1000)} s en generarse.`)),
			plazoMs
		);
		const listo = (blob: Blob) => {
			clearTimeout(temporizador);
			resolve(blob);
		};
		const fallo = (e: unknown) => {
			clearTimeout(temporizador);
			reject(e instanceof Error ? e : new Error(String(e)));
		};
		try {
			const r = pdfMake.createPdf(docDefinition).getBlob(listo);
			if (r && typeof r.then === 'function') r.then(listo, fallo);
		} catch (e) {
			fallo(e);
		}
	});
}
