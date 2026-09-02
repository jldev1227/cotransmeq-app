<!--
	Evidencias de un envío: firmas, fotos y archivos adjuntos.

	── Por qué descarga por `fetch` y no con `<a download>` ──
	Las URL que devuelve el backend son enlaces FIRMADOS de S3: apuntan a otro
	origen y caducan. El atributo `download` de un enlace es *same-origin only*;
	cruzando origen el navegador lo ignora y se limita a navegar, así que el
	usuario acababa con la foto abierta en una pestaña —y con un nombre de
	archivo que es el UUID de la clave del bucket— en vez de con el archivo en su
	carpeta de descargas. Por eso se trae el binario con `fetch`, se envuelve en
	un `blob:` del MISMO origen y sobre ese sí funciona `download`, que además
	permite ponerle un nombre que un auditor entienda.

	── Por qué se conserva «Abrir» ──
	El `fetch` cruzado necesita que el bucket publique cabeceras CORS para el
	GET; la navegación directa no. Si la política del bucket cambia, el botón de
	descarga fallará pero «Abrir» seguirá funcionando: es la salida de emergencia
	para que nadie se quede sin ver la evidencia.

	── Miniaturas ──
	Una firma o una foto se juzgan viéndolas, no leyendo su `sha256`. Las
	imágenes se pintan con `<img>` —que sí puede cargar cruzado sin CORS— y se
	amplían en un visor a pantalla completa.
-->
<script lang="ts">
	import { toast } from 'svelte-sonner';
	import type { AttachmentDto, FormVersionDto } from '$lib/formularios/types';

	interface Props {
		/** Solo los adjuntos con `status === 'UPLOADED'`: el resto no tiene binario. */
		adjuntos: AttachmentDto[];
		/** Definición versionada, para nombrar cada evidencia con SU pregunta. */
		definicion: FormVersionDto;
		/** Placa del vehículo; entra en el nombre del archivo descargado. */
		placa?: string | null;
		/** Fecha operativa (`YYYY-MM-DD`); entra en el nombre del archivo. */
		fecha?: string | null;
	}

	const { adjuntos, definicion, placa = null, fecha = null }: Props = $props();

	const CLASES: Record<string, string> = {
		SIGNATURE: 'Firma',
		PHOTO: 'Foto',
		FILE: 'Archivo'
	};

	/**
	 * Extensión del archivo descargado.
	 *
	 * El nombre original es la mejor fuente cuando existe (el teléfono ya sabía
	 * qué estaba subiendo). Si no, se deriva del mimeType: sin extensión el
	 * sistema operativo no sabe con qué abrir el archivo y la descarga queda
	 * inservible aunque el binario esté bien.
	 */
	const EXTENSIONES: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/jpg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/gif': 'gif',
		'image/heic': 'heic',
		'image/heif': 'heif',
		'image/svg+xml': 'svg',
		'application/pdf': 'pdf',
		'application/msword': 'doc',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
		'application/vnd.ms-excel': 'xls',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
		'text/plain': 'txt',
		'text/csv': 'csv',
		'video/mp4': 'mp4',
		'audio/mpeg': 'mp3'
	};

	function extension(adjunto: AttachmentDto): string {
		const delNombre = adjunto.originalName?.match(/\.([A-Za-z0-9]{2,5})$/)?.[1];
		if (delNombre) return delNombre.toLowerCase();
		const tipo = (adjunto.mimeType ?? '').toLowerCase().split(';')[0].trim();
		if (EXTENSIONES[tipo]) return EXTENSIONES[tipo];
		const subtipo = tipo.split('/')[1]?.replace(/[^a-z0-9]/g, '');
		return subtipo || 'bin';
	}

	/** Sin acentos, espacios ni barras: va a un nombre de archivo real. */
	function limpiar(texto: string): string {
		return texto
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^A-Za-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.toLowerCase();
	}

	function esImagen(adjunto: AttachmentDto): boolean {
		return (adjunto.mimeType ?? '').toLowerCase().startsWith('image/');
	}

	/**
	 * Etiqueta de la pregunta a la que se enganchó la evidencia.
	 *
	 * El adjunto solo guarda `fieldId` en su `metadata`; el texto humano vive en
	 * la definición versionada. Sin esto, cinco fotos idénticas en la lista son
	 * indistinguibles.
	 */
	const etiquetasPorCampo = $derived.by(() => {
		const mapa = new Map<string, string>();
		const recorrer = (campos: FormVersionDto['sections'][number]['fields']) => {
			for (const campo of campos) {
				mapa.set(campo.id, campo.label);
				if (campo.children?.length) recorrer(campo.children);
			}
		};
		for (const seccion of definicion.sections ?? []) recorrer(seccion.fields ?? []);
		return mapa;
	});

	function pregunta(adjunto: AttachmentDto): string | null {
		const fieldId = (adjunto.metadata as Record<string, unknown> | null)?.fieldId;
		if (typeof fieldId !== 'string') return null;
		return etiquetasPorCampo.get(fieldId) ?? null;
	}

	/**
	 * Nombre con el que se guarda: tipo + placa + fecha + ordinal.
	 *
	 * El ordinal es por tipo, no global: `foto-abc123-2026-08-26-2.jpg` dice que
	 * es la segunda foto del envío. Sin él, dos fotos del mismo envío se pisarían
	 * en la carpeta de descargas.
	 */
	function nombreArchivo(adjunto: AttachmentDto): string {
		const mismos = adjuntos.filter((a) => a.kind === adjunto.kind);
		const ordinal = mismos.indexOf(adjunto) + 1;
		const partes = [limpiar(CLASES[adjunto.kind] ?? adjunto.kind)];
		if (placa) partes.push(limpiar(placa));
		if (fecha) partes.push(limpiar(fecha));
		if (mismos.length > 1) partes.push(String(ordinal));
		return `${partes.filter(Boolean).join('-')}.${extension(adjunto)}`;
	}

	function tamano(bytes: number | null): string {
		if (!bytes) return '—';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	/// IDs en descarga. Un `SvelteSet` sería lo idiomático, pero un array de
	/// estado se reasigna igual de bien y no añade importaciones.
	let descargando = $state<string[]>([]);
	let descargandoTodo = $state(false);

	const enCurso = (id: string) => descargando.includes(id) || descargandoTodo;

	/**
	 * Trae el binario y lo entrega como descarga del navegador.
	 *
	 * Devuelve `true`/`false` en vez de lanzar para que «Descargar todas» pueda
	 * seguir con las siguientes cuando una falle y resumir al final.
	 */
	async function descargarUno(adjunto: AttachmentDto, silencioso = false): Promise<boolean> {
		if (!adjunto.url) {
			if (!silencioso) toast.error('Esta evidencia no tiene enlace de descarga disponible.');
			return false;
		}

		let objectUrl: string | null = null;
		try {
			const respuesta = await fetch(adjunto.url, { credentials: 'omit', mode: 'cors' });
			if (!respuesta.ok) {
				/// 403 es lo que devuelve S3 cuando la firma expiró: es el caso
				/// habitual si la pestaña lleva rato abierta, y tiene arreglo
				/// (recargar pide URLs nuevas), así que se dice explícitamente.
				throw new Error(
					respuesta.status === 403 || respuesta.status === 401
						? 'El enlace firmado del archivo caducó. Recarga la página para pedir uno nuevo.'
						: `El servidor de archivos respondió ${respuesta.status}.`
				);
			}

			const blob = await respuesta.blob();
			objectUrl = URL.createObjectURL(blob);

			const enlace = document.createElement('a');
			enlace.href = objectUrl;
			enlace.download = nombreArchivo(adjunto);
			enlace.rel = 'noopener';
			document.body.appendChild(enlace);
			enlace.click();
			enlace.remove();
			return true;
		} catch (err) {
			if (!silencioso) {
				/// Un `fetch` cruzado que falla sin respuesta lanza `TypeError` y no
				/// distingue red caída de CORS bloqueado; el mensaje cubre ambos y
				/// apunta a «Abrir», que no depende de CORS.
				const motivo =
					err instanceof TypeError
						? 'No se pudo contactar con el almacén de archivos (enlace caducado, sin conexión o bloqueado por el navegador). Prueba con «Abrir».'
						: err instanceof Error
							? err.message
							: 'Error desconocido al descargar.';
				toast.error(motivo);
			}
			return false;
		} finally {
			/// El `revoke` no puede ir pegado al `click()`: en varios navegadores la
			/// descarga aún no ha leído el blob y se cancelaría. Un segundo basta y
			/// evita dejar el binario retenido en memoria.
			const aLiberar = objectUrl;
			if (aLiberar) setTimeout(() => URL.revokeObjectURL(aLiberar), 1000);
		}
	}

	async function descargar(adjunto: AttachmentDto) {
		descargando = [...descargando, adjunto.id];
		try {
			await descargarUno(adjunto);
		} finally {
			descargando = descargando.filter((id) => id !== adjunto.id);
		}
	}

	/**
	 * Descarga todas, en serie.
	 *
	 * En paralelo el navegador trata la ráfaga como descarga múltiple no
	 * solicitada y bloquea todas menos la primera; en serie cada `click()` es
	 * consecuencia visible de la anterior y pasan.
	 */
	async function descargarTodas() {
		descargandoTodo = true;
		let ok = 0;
		let fallos = 0;
		try {
			for (const adjunto of adjuntos) {
				const logrado = await descargarUno(adjunto, true);
				if (logrado) ok++;
				else fallos++;
				await new Promise((r) => setTimeout(r, 350));
			}
		} finally {
			descargandoTodo = false;
		}

		if (fallos === 0) toast.success(`${ok} evidencia${ok === 1 ? '' : 's'} descargada${ok === 1 ? '' : 's'}.`);
		else if (ok === 0)
			/// Si fallan TODAS a la vez no es mala suerte con una firma: o han
			/// caducado todos los enlaces (recargar los renueva) o el navegador
			/// bloquea la lectura del almacén. Se nombran las dos, con la salida
			/// que sí funciona en el segundo caso.
			toast.error(
				'No se pudo descargar ninguna evidencia. Recarga la página para renovar los enlaces; si sigue fallando, ábrelas una a una con «Abrir».'
			);
		else toast.warning(`${ok} descargada(s), ${fallos} fallida(s). Recarga la página y reintenta las que falten.`);
	}

	/// Visor de imagen ampliada. Guarda el adjunto entero, no solo la URL, para
	/// poder ofrecer la descarga desde el propio visor.
	let ampliada = $state<AttachmentDto | null>(null);

	const imagenes = $derived(adjuntos.filter(esImagen));

	function mover(paso: number) {
		if (!ampliada) return;
		const i = imagenes.indexOf(ampliada);
		if (i === -1) return;
		const siguiente = imagenes[(i + paso + imagenes.length) % imagenes.length];
		if (siguiente) ampliada = siguiente;
	}
</script>

<section class="evidencias">
	<header class="evidencias__cabeza">
		<h2 class="evidencias__titulo">
			Evidencias <span class="evidencias__conteo">{adjuntos.length}</span>
		</h2>
		{#if adjuntos.length > 1}
			<button
				type="button"
				class="btn btn--mini"
				disabled={descargandoTodo}
				onclick={descargarTodas}
			>
				{descargandoTodo ? 'Descargando…' : 'Descargar todas'}
			</button>
		{/if}
	</header>

	{#if adjuntos.length === 0}
		<p class="evidencias__vacio">
			Este envío no tiene evidencias subidas. En un borrador es lo normal: la firma y las fotos se
			capturan al cerrar el formulario.
		</p>
	{:else}
		<ul class="tarjetas">
			{#each adjuntos as adjunto (adjunto.id)}
				{@const titulo = pregunta(adjunto)}
				<li class="tarjeta">
					{#if esImagen(adjunto) && adjunto.url}
						<button
							type="button"
							class="tarjeta__lienzo tarjeta__lienzo--pulsable"
							onclick={() => (ampliada = adjunto)}
							title="Ampliar"
						>
							<img
								class="tarjeta__img"
								class:tarjeta__img--firma={adjunto.kind === 'SIGNATURE'}
								src={adjunto.url}
								alt={titulo ?? CLASES[adjunto.kind] ?? 'Evidencia'}
								loading="lazy"
							/>
						</button>
					{:else}
						<div class="tarjeta__lienzo tarjeta__lienzo--sin">
							<span class="tarjeta__ext">.{extension(adjunto)}</span>
						</div>
					{/if}

					<div class="tarjeta__cuerpo">
						<span class="tarjeta__kind">{CLASES[adjunto.kind] ?? adjunto.kind}</span>
						<p class="tarjeta__pregunta" title={titulo ?? ''}>
							{titulo ?? adjunto.originalName ?? 'Sin pregunta asociada'}
						</p>
						<p class="tarjeta__tec mono">
							{tamano(adjunto.byteSize)} · {adjunto.sha256.slice(0, 10)}…
						</p>
					</div>

					<div class="tarjeta__acciones">
						{#if adjunto.url}
							<button
								type="button"
								class="btn btn--mini btn--primario"
								disabled={enCurso(adjunto.id)}
								onclick={() => descargar(adjunto)}
							>
								{descargando.includes(adjunto.id) ? 'Descargando…' : 'Descargar'}
							</button>
							<a class="btn btn--mini" href={adjunto.url} target="_blank" rel="noopener noreferrer">
								Abrir
							</a>
						{:else}
							<span class="tarjeta__sin">Sin enlace disponible</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!--
	Teclado global del visor: `svelte:window` va al nivel superior del componente
	—Svelte no lo admite dentro de un bloque— y el propio manejador comprueba si
	hay imagen ampliada, así el Escape de la página no compite con el del modal
	de anulación.
-->
<svelte:window
	onkeydown={(e) => {
		if (!ampliada) return;
		if (e.key === 'Escape') ampliada = null;
		else if (e.key === 'ArrowLeft') mover(-1);
		else if (e.key === 'ArrowRight') mover(1);
	}}
/>

{#if ampliada}
	<div class="evidencia-visor" role="dialog" aria-modal="true" aria-label="Evidencia ampliada">
		<!-- El fondo es un `button` real y no un `div` con `onclick`: cerrar
		     pulsando fuera debe funcionar también con teclado y con lector de
		     pantalla, y así no hace falta silenciar reglas de accesibilidad. -->
		<button
			type="button"
			class="evidencia-visor__fondo"
			aria-label="Cerrar la evidencia ampliada"
			onclick={() => (ampliada = null)}
		></button>

		<div class="evidencia-visor__barra">
			<span class="evidencia-visor__nombre">
				{pregunta(ampliada) ?? CLASES[ampliada.kind] ?? 'Evidencia'}
			</span>
			<div class="evidencia-visor__acciones">
				{#if imagenes.length > 1}
					<button type="button" class="btn btn--mini" onclick={() => mover(-1)}>‹ Anterior</button>
					<button type="button" class="btn btn--mini" onclick={() => mover(1)}>Siguiente ›</button>
				{/if}
				<button
					type="button"
					class="btn btn--mini btn--primario"
					onclick={() => ampliada && descargar(ampliada)}
				>
					Descargar
				</button>
				<button type="button" class="btn btn--mini" onclick={() => (ampliada = null)}>Cerrar</button>
			</div>
		</div>

		<div
			class="evidencia-visor__marco"
			class:evidencia-visor__marco--firma={ampliada.kind === 'SIGNATURE'}
		>
			<img
				class="evidencia-visor__img"
				src={ampliada.url}
				alt={pregunta(ampliada) ?? 'Evidencia ampliada'}
			/>
		</div>
	</div>
{/if}

<style>
	.evidencias {
		padding: 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
	}

	.evidencias__cabeza {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.evidencias__titulo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-display, Georgia, serif);
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary, #1a1a1a);
	}

	.evidencias__conteo {
		padding: 0.0625rem 0.4375rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--orange-700, #c2410c);
		background: color-mix(in srgb, var(--orange-700, #c2410c) 10%, transparent);
		border-radius: 999px;
	}

	.evidencias__vacio {
		font-size: 0.8125rem;
		font-style: italic;
		line-height: 1.5;
		color: var(--text-very-muted, #9a9a9a);
	}

	/* Rejilla y no lista: las evidencias son OBJETOS que se comparan de un
	   vistazo, y una columna de filas altas obligaba a bajar por cada foto. */
	.tarjetas {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13.5rem, 1fr));
		gap: 0.75rem;
		list-style: none;
	}

	.tarjeta {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--gray-50, #f9fafb);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 12px;
	}

	.tarjeta__lienzo {
		display: grid;
		place-items: center;
		width: 100%;
		height: 8.5rem;
		padding: 0;
		overflow: hidden;
		background:
			repeating-conic-gradient(
					rgba(0, 0, 0, 0.045) 0% 25%,
					transparent 0% 50%
				)
				50% / 14px 14px;
		border: none;
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.tarjeta__lienzo--pulsable {
		cursor: zoom-in;
	}

	.tarjeta__lienzo--pulsable:focus-visible {
		outline: 2px solid var(--orange-600, #ea580c);
		outline-offset: -2px;
	}

	.tarjeta__img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* Una firma es trazo negro sobre transparente: recortarla («cover») corta
	   el rasgo, y sobre fondo oscuro desaparece. Se muestra entera y sobre
	   blanco explícito. */
	.tarjeta__img--firma {
		object-fit: contain;
		padding: 0.5rem;
		background: #fff;
	}

	.tarjeta__lienzo--sin {
		color: var(--text-very-muted, #9a9a9a);
	}

	.tarjeta__ext {
		font-family: var(--font-mono, monospace);
		font-size: 1rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tarjeta__cuerpo {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		padding: 0.5rem 0.625rem 0.375rem;
	}

	.tarjeta__kind {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--orange-700, #c2410c);
	}

	.tarjeta__pregunta {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		font-size: 0.8125rem;
		line-height: 1.35;
		color: var(--text-primary, #1a1a1a);
	}

	.tarjeta__tec {
		color: var(--text-very-muted, #9a9a9a);
	}

	.tarjeta__acciones {
		display: flex;
		gap: 0.375rem;
		margin-top: auto;
		padding: 0 0.625rem 0.625rem;
	}

	/* Solo DENTRO de la tarjeta los botones se reparten el ancho. Cuando el
	   `flex: 1` vivía en `.btn--mini` se lo llevaba también «Descargar todas»,
	   que es el único hijo flexible de su cabecera y se estiraba de lado a lado
	   de la pantalla. */
	.tarjeta__acciones .btn {
		flex: 1;
	}

	.tarjeta__sin {
		font-size: 0.75rem;
		font-style: italic;
		color: var(--text-very-muted, #9a9a9a);
	}

	/* `evidencia-visor` y no `visor` a secas: `PreviewEnvioPDF` ya usa esa clase
	   en la misma página. El scope de Svelte impide que los estilos se pisen,
	   pero no que un `querySelector('.visor')` —de una prueba o de la consola—
	   agarre el elemento equivocado. El prefijo lo hace inequívoco. */
	.evidencia-visor {
		position: fixed;
		inset: 0;
		/* Por encima del sidebar y de la barra superior del dashboard, que van en
		   z-index alto; con 70 la evidencia ampliada salía por debajo de ellos. */
		z-index: 9990;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: rgba(9, 18, 15, 0.88);
	}

	.evidencia-visor__fondo {
		position: absolute;
		inset: 0;
		padding: 0;
		background: transparent;
		border: none;
		cursor: zoom-out;
	}

	.evidencia-visor__barra {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.evidencia-visor__nombre {
		font-size: 0.875rem;
		font-weight: 600;
		color: #fff;
	}

	.evidencia-visor__acciones {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}



	/* Marco intermedio y no `flex: 1` sobre el `<img>`: un elemento reemplazado
	   dentro de un flex column se estira a su alto intrínseco (1920 px en una
	   foto de teléfono) y se salía por abajo del visor. El marco absorbe el
	   espacio sobrante y la imagen se ancla a él. */
	/* El marco lleva SU propio fondo y no se conforma con el velo del visor: la
	   imagen se ancla a toda la caja y `contain` deja transparente lo que sobra
	   a los lados, por donde se colaba el dashboard de detrás. Pintando el marco,
	   el sobrante es velo y no página. */
	.evidencia-visor__marco {
		position: relative;
		flex: 1;
		min-height: 0;
		background: rgba(9, 18, 15, 0.92);
		border-radius: 10px;
	}

	/* Blanco SOLO detrás de una firma: es trazo oscuro sobre PNG transparente y
	   sobre el velo del visor sería invisible. Una foto ya trae su propio fondo
	   y sobre blanco quedaría recortada por un rectángulo enorme. */
	.evidencia-visor__marco--firma {
		background: #fff;
	}

	/* Anclada con `inset: 0` y no con `height: 100%`: el porcentaje necesita un
	   contenedor de alto DEFINIDO para resolverse, y el del marco lo fija el
	   reparto flex, que llega tarde —la imagen se quedaba con su alto natural—.
	   Contra un contenedor posicionado, `inset` siempre resuelve. */
	.evidencia-visor__img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		border-radius: 10px;
	}



	.mono {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0 0.875rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
		cursor: pointer;
		text-decoration: none;
		white-space: nowrap;
	}

	.btn--mini {
		min-height: 34px;
		padding: 0 0.5625rem;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.btn--primario {
		color: #fff;
		background: var(--orange-700, #c2410c);
		border-color: var(--orange-700, #c2410c);
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.btn:focus-visible {
		outline: 2px solid var(--orange-600, #ea580c);
		outline-offset: 2px;
	}
</style>
