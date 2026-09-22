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
	const indice = $derived(ampliada ? imagenes.indexOf(ampliada) : -1);

	/**
	 * Zoom y paneo.
	 *
	 * Una evidencia no se revisa mirándola entera: se revisa buscando el número
	 * de un extintor, la fecha de una revisión o el rayón de un guardabarros.
	 * Con la imagen ajustada a la pantalla y sin acercamiento había que
	 * descargarla y abrirla en el visor del sistema operativo para leer nada —el
	 * panel servía para comprobar que la foto existe, no para mirarla—.
	 *
	 * `escala` multiplica; `pan` desplaza en píxeles de pantalla desde el centro.
	 */
	const ESCALA_MAX = 8;
	let escala = $state(1);
	let pan = $state({ x: 0, y: 0 });
	let marcoEl = $state<HTMLElement | null>(null);
	let imgEl = $state<HTMLImageElement | null>(null);

	/// `cargando` arranca en true en cada imagen: la anterior no debe quedarse
	/// pintada mientras baja la siguiente, que era lo que hacía parecer que las
	/// flechas no respondían en conexiones lentas.
	let cargando = $state(true);
	let fallo = $state(false);

	function reiniciarVista() {
		escala = 1;
		pan = { x: 0, y: 0 };
	}

	/**
	 * Cuánto puede desplazarse la imagen sin dejar hueco.
	 *
	 * Se calcula contra el tamaño REAL pintado, no contra el del marco: con
	 * `object-fit: contain` una foto vertical dentro de un marco apaisado ocupa
	 * una fracción del ancho, y limitar con el marco la dejaba arrastrarse hasta
	 * salirse de la vista.
	 */
	function limites(): { x: number; y: number } {
		const marco = marcoEl?.getBoundingClientRect();
		const img = imgEl;
		if (!marco || !img?.naturalWidth || !img.naturalHeight) return { x: 0, y: 0 };
		const ajuste = Math.min(marco.width / img.naturalWidth, marco.height / img.naturalHeight);
		const ancho = img.naturalWidth * ajuste * escala;
		const alto = img.naturalHeight * ajuste * escala;
		return {
			x: Math.max(0, (ancho - marco.width) / 2),
			y: Math.max(0, (alto - marco.height) / 2)
		};
	}

	function acotarPan() {
		const l = limites();
		pan = {
			x: Math.min(l.x, Math.max(-l.x, pan.x)),
			y: Math.min(l.y, Math.max(-l.y, pan.y))
		};
	}

	/**
	 * Cambia el zoom dejando quieto el punto que está bajo el cursor.
	 *
	 * Sin esto, acercar siempre tira hacia el centro: el detalle que se quería
	 * mirar se escapa del borde y hay que perseguirlo arrastrando. Con el ancla
	 * en el puntero, la rueda acerca «hacia donde estoy mirando».
	 */
	function zoomEn(nueva: number, clienteX?: number, clienteY?: number) {
		const destino = Math.min(ESCALA_MAX, Math.max(1, nueva));
		const marco = marcoEl?.getBoundingClientRect();
		if (marco && clienteX !== undefined && clienteY !== undefined) {
			const px = clienteX - marco.left - marco.width / 2;
			const py = clienteY - marco.top - marco.height / 2;
			const razon = destino / escala;
			pan = { x: px - (px - pan.x) * razon, y: py - (py - pan.y) * razon };
		}
		escala = destino;
		if (destino === 1) pan = { x: 0, y: 0 };
		else acotarPan();
	}

	/// Arrastre con Pointer Events: cubre ratón, lápiz y dedo con un solo camino,
	/// y `setPointerCapture` mantiene el seguimiento aunque el puntero se salga
	/// del marco a media pasada.
	let arrastre: { x: number; y: number; panX: number; panY: number } | null = $state(null);

	function empezarArrastre(e: PointerEvent) {
		if (escala <= 1) return;
		arrastre = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function seguirArrastre(e: PointerEvent) {
		if (!arrastre) return;
		pan = { x: arrastre.panX + (e.clientX - arrastre.x), y: arrastre.panY + (e.clientY - arrastre.y) };
		acotarPan();
	}

	function soltarArrastre() {
		arrastre = null;
	}

	/// Deslizar para cambiar de imagen, solo sin zoom: con la imagen acercada el
	/// gesto horizontal es paneo, y robárselo para navegar haría imposible mirar
	/// el lado derecho de una foto en un teléfono.
	let tocandoEn: { x: number; y: number } | null = null;

	function tocarInicio(e: TouchEvent) {
		if (escala > 1 || e.touches.length !== 1) return;
		tocandoEn = { x: e.touches[0].clientX, y: e.touches[0].clientY };
	}

	function tocarFin(e: TouchEvent) {
		if (!tocandoEn || imagenes.length < 2) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - tocandoEn.x;
		const dy = t.clientY - tocandoEn.y;
		tocandoEn = null;
		/// El umbral horizontal evita que un scroll torpe cambie de evidencia.
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) mover(dx < 0 ? 1 : -1);
	}

	/// Foco: se guarda quién abrió el visor para devolvérselo al cerrar. Sin esto
	/// el teclado vuelve al principio del documento y hay que recorrer la página
	/// entera para llegar a la siguiente evidencia.
	let disparador: HTMLElement | null = null;
	let dialogoEl = $state<HTMLElement | null>(null);

	function abrir(adjunto: AttachmentDto, origen?: Event) {
		disparador = (origen?.currentTarget as HTMLElement) ?? null;
		ampliada = adjunto;
		cargando = true;
		fallo = false;
		reiniciarVista();
	}

	function cerrar() {
		ampliada = null;
		reiniciarVista();
		disparador?.focus();
		disparador = null;
	}

	function mover(paso: number) {
		if (!ampliada || imagenes.length === 0) return;
		const i = imagenes.indexOf(ampliada);
		if (i === -1) return;
		const siguiente = imagenes[(i + paso + imagenes.length) % imagenes.length];
		if (!siguiente || siguiente === ampliada) return;
		ampliada = siguiente;
		cargando = true;
		fallo = false;
		reiniciarVista();
	}

	function irA(adjunto: AttachmentDto) {
		if (adjunto === ampliada) return;
		ampliada = adjunto;
		cargando = true;
		fallo = false;
		reiniciarVista();
	}

	/// Mientras el visor está abierto la página de detrás no se mueve: rodar la
	/// rueda para acercar dejaba el envío scrolleado en otro sitio al cerrar.
	$effect(() => {
		if (!ampliada) return;
		const previo = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previo;
		};
	});

	/// El foco entra al diálogo al abrirse para que Escape, flechas y Tab operen
	/// sobre el visor y no sobre la página que quedó debajo.
	$effect(() => {
		if (ampliada && dialogoEl) dialogoEl.focus();
	});

	/**
	 * Tab circula DENTRO del visor.
	 *
	 * Es un `aria-modal`, así que dejar que el tabulador se escape a la página de
	 * detrás contradice lo que se le anuncia al lector de pantalla: el usuario
	 * acaba navegando controles que no puede ver.
	 */
	function atraparTab(e: KeyboardEvent) {
		if (e.key !== 'Tab' || !dialogoEl) return;
		const focos = dialogoEl.querySelectorAll<HTMLElement>(
			'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
		);
		if (!focos.length) return;
		const primero = focos[0];
		const ultimo = focos[focos.length - 1];
		const activo = document.activeElement;
		if (e.shiftKey && (activo === primero || activo === dialogoEl)) {
			e.preventDefault();
			ultimo.focus();
		} else if (!e.shiftKey && activo === ultimo) {
			e.preventDefault();
			primero.focus();
		}
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
							onclick={(e) => abrir(adjunto, e)}
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
		if (e.key === 'Escape') cerrar();
		else if (e.key === 'ArrowLeft') mover(-1);
		else if (e.key === 'ArrowRight') mover(1);
		/// `+`, `-` y `0` son los atajos de zoom de cualquier visor; `0` ajusta.
		else if (e.key === '+' || e.key === '=') zoomEn(escala * 1.4);
		else if (e.key === '-' || e.key === '_') zoomEn(escala / 1.4);
		else if (e.key === '0') reiniciarVista();
	}}
/>

{#if ampliada}
	{@const titulo = pregunta(ampliada) ?? CLASES[ampliada.kind] ?? 'Evidencia'}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="evidencia-visor"
		role="dialog"
		aria-modal="true"
		aria-label={`${titulo}${imagenes.length > 1 ? ` · ${indice + 1} de ${imagenes.length}` : ''}`}
		tabindex="-1"
		bind:this={dialogoEl}
		onkeydown={atraparTab}
	>
		<!-- El fondo es un `button` real y no un `div` con `onclick`: cerrar
		     pulsando fuera debe funcionar también con teclado y con lector de
		     pantalla, y así no hace falta silenciar reglas de accesibilidad. -->
		<button
			type="button"
			class="evidencia-visor__fondo"
			aria-label="Cerrar la evidencia ampliada"
			onclick={cerrar}
		></button>

		<div class="evidencia-visor__barra">
			<div class="evidencia-visor__id">
				<span class="evidencia-visor__nombre">{titulo}</span>
				<!-- Tipo, tamaño y hash: son los datos con los que un auditor coteja
				     la evidencia contra la bitácora, y obligaban a cerrar el visor
				     para leerlos en la tarjeta. -->
				<span class="evidencia-visor__meta mono">
					{CLASES[ampliada.kind] ?? ampliada.kind} · {tamano(ampliada.byteSize)} ·
					{ampliada.sha256.slice(0, 10)}…
				</span>
			</div>

			<div class="evidencia-visor__acciones">
				{#if imagenes.length > 1}
					<span class="evidencia-visor__contador mono">{indice + 1} / {imagenes.length}</span>
				{/if}
				<div class="evidencia-visor__zoom" role="group" aria-label="Zoom">
					<button
						type="button"
						class="btn btn--mini btn--visor"
						aria-label="Alejar"
						disabled={escala <= 1}
						onclick={() => zoomEn(escala / 1.4)}>−</button
					>
					<!-- El porcentaje es también el botón de «ajustar»: es donde la gente
					     ya mira para saber a cuánto está, y ahorra un control más. -->
					<button
						type="button"
						class="btn btn--mini btn--visor evidencia-visor__nivel"
						aria-label="Ajustar a la pantalla"
						title="Ajustar a la pantalla"
						disabled={escala === 1 && pan.x === 0 && pan.y === 0}
						onclick={reiniciarVista}>{Math.round(escala * 100)}%</button
					>
					<button
						type="button"
						class="btn btn--mini btn--visor"
						aria-label="Acercar"
						disabled={escala >= ESCALA_MAX}
						onclick={() => zoomEn(escala * 1.4)}>+</button
					>
				</div>
				<a
					class="btn btn--mini btn--visor"
					href={ampliada.url}
					target="_blank"
					rel="noopener noreferrer">Abrir</a
				>
				<button
					type="button"
					class="btn btn--mini btn--primario"
					disabled={enCurso(ampliada.id)}
					onclick={() => ampliada && descargar(ampliada)}
				>
					{descargando.includes(ampliada.id) ? 'Descargando…' : 'Descargar'}
				</button>
				<button type="button" class="btn btn--mini btn--visor" onclick={cerrar}>Cerrar</button>
			</div>
		</div>

		<div class="evidencia-visor__escena">
			{#if imagenes.length > 1}
				<!-- Flechas grandes pegadas a los bordes en vez de dos botones pequeños
				     arriba: el ojo ya está en la imagen, y ahí es donde la mano busca
				     el control para pasar a la siguiente. -->
				<button
					type="button"
					class="evidencia-visor__flecha evidencia-visor__flecha--izq"
					aria-label="Evidencia anterior"
					onclick={() => mover(-1)}>‹</button
				>
				<button
					type="button"
					class="evidencia-visor__flecha evidencia-visor__flecha--der"
					aria-label="Evidencia siguiente"
					onclick={() => mover(1)}>›</button
				>
			{/if}

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="evidencia-visor__marco"
				class:evidencia-visor__marco--firma={ampliada.kind === 'SIGNATURE'}
				class:evidencia-visor__marco--agarrable={escala > 1}
				class:evidencia-visor__marco--agarrando={!!arrastre}
				bind:this={marcoEl}
				onwheel={(e) => {
					e.preventDefault();
					zoomEn(escala * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY);
				}}
				ondblclick={(e) => (escala > 1 ? reiniciarVista() : zoomEn(2.5, e.clientX, e.clientY))}
				onpointerdown={empezarArrastre}
				onpointermove={seguirArrastre}
				onpointerup={soltarArrastre}
				onpointercancel={soltarArrastre}
				ontouchstart={tocarInicio}
				ontouchend={tocarFin}
			>
				{#if cargando && !fallo}
					<p class="evidencia-visor__aviso" aria-live="polite">Cargando la evidencia…</p>
				{/if}

				{#if fallo}
					<!-- Antes aquí quedaba el icono de imagen rota del navegador, que no
					     dice cuál de los dos problemas es. El enlace firmado de S3 caduca
					     y tiene arreglo —recargar pide uno nuevo—, así que se nombra. -->
					<div class="evidencia-visor__aviso evidencia-visor__aviso--error" role="alert">
						<p>No se pudo mostrar esta evidencia.</p>
						<p class="evidencia-visor__pista">
							Lo normal es que el enlace firmado del archivo haya caducado. Recarga la página para
							pedir uno nuevo; si sigue fallando, usa «Abrir».
						</p>
					</div>
				{:else}
					<img
						class="evidencia-visor__img"
						class:evidencia-visor__img--oculta={cargando}
						bind:this={imgEl}
						src={ampliada.url}
						alt={titulo}
						draggable="false"
						style={`transform: translate(${pan.x}px, ${pan.y}px) scale(${escala});`}
						onload={() => {
							cargando = false;
							fallo = false;
						}}
						onerror={() => {
							cargando = false;
							fallo = true;
						}}
					/>
				{/if}
			</div>
		</div>

		{#if imagenes.length > 1}
			<!-- Tira de miniaturas: con siete fotos, llegar a la quinta costaba
			     cuatro pulsaciones de «Siguiente» sin saber qué venía. Aquí se ve el
			     conjunto y se salta directo. -->
			<div class="evidencia-visor__tira" role="tablist" aria-label="Evidencias del envío">
				{#each imagenes as img (img.id)}
					<button
						type="button"
						role="tab"
						class="evidencia-visor__mini"
						class:evidencia-visor__mini--activa={img === ampliada}
						aria-selected={img === ampliada}
						aria-label={pregunta(img) ?? CLASES[img.kind] ?? 'Evidencia'}
						title={pregunta(img) ?? CLASES[img.kind] ?? 'Evidencia'}
						onclick={() => irA(img)}
					>
						<img src={img.url} alt="" loading="lazy" />
					</button>
				{/each}
			</div>
		{/if}
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
		/* Casi opaco. Con 0.88 el formulario de detrás seguía siendo legible y
		   competía con la evidencia: en una foto oscura —un bajo de chasis, una
		   toma de noche— el texto del documento se colaba entre los negros y
		   costaba distinguir qué era la foto y qué la página. */
		background: rgba(9, 18, 15, 0.95);
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

	/* `min-width: 0` para que el nombre largo de una pregunta se recorte en vez
	   de empujar los controles fuera de la barra. */
	.evidencia-visor__id {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.0625rem;
	}

	.evidencia-visor__nombre {
		font-size: 0.875rem;
		font-weight: 600;
		color: #fff;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.evidencia-visor__meta {
		color: rgba(255, 255, 255, 0.62);
	}

	.evidencia-visor__acciones {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.evidencia-visor__contador {
		color: rgba(255, 255, 255, 0.72);
		font-variant-numeric: tabular-nums;
	}

	/* Los tres controles de zoom van pegados como un solo bloque: son una misma
	   operación y separarlos los confundía con las acciones del archivo. */
	.evidencia-visor__zoom {
		display: flex;
	}

	.evidencia-visor__zoom .btn {
		border-radius: 0;
		margin-left: -1px;
	}

	.evidencia-visor__zoom .btn:first-child {
		border-radius: 10px 0 0 10px;
		margin-left: 0;
	}

	.evidencia-visor__zoom .btn:last-child {
		border-radius: 0 10px 10px 0;
	}

	/* Ancho fijo y cifras tabulares: sin esto el bloque entero da un salto cada
	   vez que el porcentaje pasa de 100 a 140 y de 140 a 196. */
	.evidencia-visor__nivel {
		min-width: 4.25rem;
		font-variant-numeric: tabular-nums;
	}

	/* Botonera sobre un velo oscuro: los `.btn` blancos de la página deslumbran
	   y compiten con la imagen, que es lo que hay que mirar. */
	.btn--visor {
		color: #fff;
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.22);
	}

	.btn--visor:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.2);
	}

	/* El foco se marca en blanco y no con el verde de la marca: sobre el velo
	   oscuro el blanco es el único que se ve con seguridad, y de paso esta regla
	   es idéntica en los dos repos. */
	.evidencia-visor :global(.btn:focus-visible),
	.evidencia-visor__mini:focus-visible,
	.evidencia-visor__flecha:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	/* La escena es la que absorbe el alto sobrante; el marco vive dentro para
	   que las flechas puedan colgarse de sus bordes sin taparse con la barra ni
	   con la tira de miniaturas. */
	.evidencia-visor__escena {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	.evidencia-visor__flecha {
		position: absolute;
		top: 50%;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		font-size: 1.5rem;
		line-height: 1;
		color: #fff;
		background: rgba(9, 18, 15, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 50%;
		transform: translateY(-50%);
		cursor: pointer;
	}

	.evidencia-visor__flecha:hover {
		background: rgba(9, 18, 15, 0.85);
	}

	.evidencia-visor__flecha--izq {
		left: 0.5rem;
	}

	.evidencia-visor__flecha--der {
		right: 0.5rem;
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
		position: absolute;
		inset: 0;
		/* Recorta lo que se sale al acercar: sin esto la imagen ampliada se pinta
		   por encima de la barra y de las miniaturas. */
		overflow: hidden;
		background: rgba(9, 18, 15, 0.92);
		border-radius: 10px;
		/* El navegador no debe quedarse con el gesto: sin esto, arrastrar sobre la
		   imagen acercada dispara el scroll de la página en vez de panear. */
		touch-action: none;
	}

	.evidencia-visor__marco--agarrable {
		cursor: grab;
	}

	.evidencia-visor__marco--agarrando {
		cursor: grabbing;
	}

	/* Blanco SOLO detrás de una firma: es trazo oscuro sobre PNG transparente y
	   sobre el velo del visor sería invisible. Una foto ya trae su propio fondo
	   y sobre blanco quedaría recortada por un rectángulo enorme.

	   Y ACOTADO: una firma es un trazo apaisado de pocos cientos de píxeles, así
	   que a pantalla completa se convertía en una pared blanca de 1900×770 con
	   una rúbrica gigante y pixelada en medio, que además apagaba la barra y las
	   miniaturas por contraste. Como tarjeta centrada se lee como lo que es —un
	   papel firmado— y el velo oscuro sigue haciendo de fondo. El `margin: auto`
	   con `inset: 0` la centra en los dos ejes. */
	.evidencia-visor__marco--firma {
		inset: 0;
		width: min(100%, 54rem);
		height: min(100%, 17rem);
		margin: auto;
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
		/* El zoom va en `transform` y no en `width`: no reflota el documento, lo
		   acelera la GPU y el arrastre sigue al dedo sin tirones. */
		transform-origin: center;
		will-change: transform;
		user-select: none;
		-webkit-user-drag: none;
	}

	/* Sin transición mientras se arrastra: interpolar cada paso del paneo hace
	   que la imagen persiga al puntero con retraso. */
	.evidencia-visor__marco:not(.evidencia-visor__marco--agarrando) .evidencia-visor__img {
		transition: transform 0.12s ease-out;
	}

	/* Oculta pero presente: si se desmontara, `bind:this` perdería el elemento y
	   `limites()` no podría medir la imagen recién cargada. */
	.evidencia-visor__img--oculta {
		opacity: 0;
	}

	.evidencia-visor__aviso {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		place-content: center;
		gap: 0.375rem;
		padding: 1.5rem;
		text-align: center;
		font-size: 0.875rem;
		color: rgba(255, 255, 255, 0.75);
	}

	.evidencia-visor__aviso--error {
		color: #fecaca;
	}

	/* Tope de lectura, que es una de las excepciones: es texto corrido dentro de
	   una ventana, no el contenedor de una página. */
	.evidencia-visor__pista {
		max-width: 34rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: rgba(255, 255, 255, 0.6);
	}

	/* La tira lleva su propio panel: las miniaturas de fotos oscuras al 55 % se
	   confundían con el velo y parecía que solo había una evidencia. */
	.evidencia-visor__tira {
		position: relative;
		display: flex;
		gap: 0.375rem;
		overflow-x: auto;
		padding: 0.375rem;
		background: rgba(255, 255, 255, 0.07);
		border-radius: 10px;
		scrollbar-width: thin;
	}

	.evidencia-visor__mini {
		flex: 0 0 auto;
		width: 3.5rem;
		height: 3.5rem;
		padding: 0;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.06);
		border: 2px solid transparent;
		border-radius: 8px;
		cursor: pointer;
		/* Apagadas, pero poco: a 0.55 las fotos oscuras desaparecían contra el velo
		   y la tira parecía tener una sola evidencia. Quien distingue la actual es
		   el borde blanco; la opacidad solo acompaña. */
		opacity: 0.72;
	}

	.evidencia-visor__mini:hover {
		opacity: 0.95;
	}

	.evidencia-visor__mini--activa {
		border-color: #fff;
		opacity: 1;
	}

	.evidencia-visor__mini img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* En pantallas cortas la tira se come el alto de la imagen, que es lo único
	   que importa; y el hover del ratón no existe en táctil. */
	@media (max-height: 560px) {
		.evidencia-visor__tira {
			display: none;
		}
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
