<!--
	Documento de un envío de formulario dinámico.

	Reproduce la estructura de los formatos HSEQ en papel (FR-08, FR-10, FR-33),
	que es la que operaciones ya sabe leer:

	  · Cabecera de tres cuerpos: membrete, título y bloque Código/Versión/Fecha.
	  · Rejilla densa con la DESCRIPCIÓN alineada a la derecha, pegada a sus
	    casillas de estado.
	  · El estado como COLUMNAS marcadas (B · R · M · NA), no como una etiqueta
	    suelta por ítem: ciento treinta pastillas de colores son ruido, ciento
	    treinta marcas en una columna se leen en diagonal de un vistazo.
	  · Bandas de sección a todo el ancho del bloque.
	  · Dos bloques en paralelo, como el FR-10, para que un preoperacional entre
	    en una hoja en vez de en ocho pantallas.

	── Adaptativo, no configurable ──
	No hay plantilla por formato. La disposición se DERIVA del tipo de cada campo
	y del catálogo de opciones (ver `formaDe` y `catalogoComun`), así que un
	formulario nuevo se ve bien el día que se publica. Mantener una plantilla por
	formato significaría que cada formato nuevo nace roto hasta que alguien lo
	repare.

	── El color sale del catálogo ──
	Las opciones ya traen `color` semántico (`emerald`, `red`, `amber`, `gray`).
	Se mapea eso y no los literales `B`/`M`/`NA`, así funciona igual con
	Cumple/No cumple, Completo/Incompleto o cualquier escala futura.

	── El PDF ──
	`window.print()` con el bloque `@media print` del final: el documento que se
	ve ES el que se imprime. Un segundo renderizador en el servidor tendría que
	reimplementar los diecinueve tipos de campo y divergiría de este.
-->
<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { documentoEnvioCss } from './documento-envio.css';
	import { exportarPdfEnvio } from './exportar-pdf-envio';
	import type {
		AnswerDto,
		AttachmentDto,
		FormFieldDto,
		FormOptionDto,
		FormSectionDto,
		FormVersionDto,
		SubmissionDetailDto
	} from '$lib/formularios/types';

	interface Props {
		envio: SubmissionDetailDto;
		definicion: FormVersionDto;
		/** Membrete del documento. */
		empresa?: string;
		/**
		 * Logo de la cabecera.
		 *
		 * Ruta de `static/` y no un `import` de Vite: es lo que ya hacen el
		 * Sidebar y los documentos de liquidaciones, y una ruta absoluta sobrevive
		 * a la ventana de impresión sin depender del hash del build.
		 */
		logo?: string;
	}

	let {
		envio,
		definicion,
		empresa = 'Cotransmeq S.A.S',
		logo = '/assets/logo_nombre.webp'
	}: Props = $props();

	// ── Índices ──────────────────────────────────────────────────────────────

	/// Las respuestas llegan planas; el documento recorre el árbol de campos. Sin
	/// este índice cada campo haría un `find` sobre las 130 respuestas.
	const respuestasPorCampo = $derived.by(() => {
		const mapa = new Map<string, AnswerDto[]>();
		for (const a of envio.answers ?? []) {
			const lista = mapa.get(a.fieldId);
			if (lista) lista.push(a);
			else mapa.set(a.fieldId, [a]);
		}
		return mapa;
	});

	/**
	 * Adjuntos por campo.
	 *
	 * El vínculo va por `metadata.fieldId` y no por `answerId`: una firma o una
	 * foto NO generan fila en `form_answers` —su valor vive en `form_attachments`—
	 * así que `answerId` es nulo justo en los dos casos que hay que enseñar.
	 */
	const adjuntosPorCampo = $derived.by(() => {
		const mapa = new Map<string, AttachmentDto[]>();
		for (const at of envio.attachments ?? []) {
			if (at.status !== 'UPLOADED') continue;
			const fieldId = String(at.metadata?.fieldId ?? '');
			if (!fieldId) continue;
			const lista = mapa.get(fieldId);
			if (lista) lista.push(at);
			else mapa.set(fieldId, [at]);
		}
		return mapa;
	});

	// ── Clasificación ────────────────────────────────────────────────────────

	type Forma = 'checklist' | 'escalar' | 'bloque' | 'firma' | 'evidencia' | 'tabla' | 'nota';

	/**
	 * Qué disposición merece un campo.
	 *
	 * `checklist` gobierna el diseño: un `SINGLE_CHOICE` de pocas opciones es un
	 * ítem de inspección y va a la rejilla de estados. Uno de veinte opciones es un
	 * desplegable y se lee mejor como par etiqueta/valor.
	 */
	function formaDe(field: FormFieldDto): Forma {
		switch (field.type) {
			case 'SIGNATURE':
				return 'firma';
			case 'PHOTO':
			case 'FILE':
				return 'evidencia';
			case 'LONG_TEXT':
				return 'bloque';
			case 'INFO':
				return 'nota';
			case 'REPEATABLE_GROUP':
			case 'MATRIX':
				return 'tabla';
			case 'SINGLE_CHOICE':
				return field.options.length > 0 && field.options.length <= 5 ? 'checklist' : 'escalar';
			default:
				return 'escalar';
		}
	}

	/// `gray` queda deliberadamente apagado: «No aplica» no es un hallazgo y no
	/// debe competir por la atención con un ítem en MALO.
	const TONOS: Record<string, string> = {
		emerald: 'ok',
		green: 'ok',
		red: 'mal',
		rose: 'mal',
		amber: 'alerta',
		yellow: 'alerta',
		orange: 'alerta',
		gray: 'neutro',
		slate: 'neutro'
	};

	function tonoDeOpcion(opcion: FormOptionDto | undefined): string {
		return TONOS[String(opcion?.color ?? '').toLowerCase()] ?? 'neutro';
	}

	function etiquetaOpcion(field: FormFieldDto, valor: string): string {
		return field.options.find((o) => o.value === valor)?.label ?? valor;
	}

	/**
	 * Abreviatura para la cabecera de una columna de estado.
	 *
	 * El formato en papel titula las columnas `B R M NA`, que es justo el `value`
	 * del catálogo. Se prefiere ese token corto al `label` completo porque la
	 * columna mide dos caracteres; si el token es largo, se recorta el label.
	 */
	function abreviatura(opcion: FormOptionDto): string {
		return opcion.value.length <= 3 ? opcion.value : opcion.label.slice(0, 3).toUpperCase();
	}

	/**
	 * Catálogo compartido por todos los checklist de un tramo, o `null`.
	 *
	 * Es lo que permite dibujar las columnas de estado UNA vez como cabecera en
	 * vez de repetir la etiqueta en cada fila. Solo tiene sentido si todos los
	 * ítems se puntúan con la misma escala, que es el caso de los formatos HSEQ.
	 * Cuando una sección mezcla escalas se cae a la etiqueta por fila, que ocupa
	 * más pero no miente.
	 */
	function catalogoComun(campos: FormFieldDto[]): FormOptionDto[] | null {
		const checklists = campos.filter((f) => formaDe(f) === 'checklist');
		if (checklists.length === 0) return null;
		const firma = (f: FormFieldDto) => f.options.map((o) => o.value).join('|');
		const referencia = firma(checklists[0]);
		if (!checklists.every((f) => firma(f) === referencia)) return null;
		return checklists[0].options;
	}

	// ── Valores ──────────────────────────────────────────────────────────────

	function respuestaDe(field: FormFieldDto): AnswerDto | undefined {
		return respuestasPorCampo.get(field.id)?.[0];
	}

	/** Valor marcado de un checklist, o `null` si no se respondió. */
	function valorMarcado(field: FormFieldDto): string | null {
		const respuesta = respuestaDe(field);
		if (!respuesta) return null;
		if (respuesta.optionValues.length > 0) return respuesta.optionValues[0];
		const valor = respuesta.value;
		return valor == null || valor === '' ? null : String(valor);
	}

	/**
	 * Valor ya legible para persona.
	 *
	 * `null` cuando no hay respuesta, que NO es lo mismo que una respuesta vacía:
	 * el documento lo marca y eso es información auditable, no un hueco que
	 * disimular.
	 */
	function valorLegible(field: FormFieldDto): string | null {
		const respuesta = respuestaDe(field);
		if (!respuesta) return null;

		if (respuesta.optionValues.length > 0) {
			return respuesta.optionValues.map((v) => etiquetaOpcion(field, v)).join(', ');
		}

		const valor = respuesta.value;
		if (valor == null || valor === '') return null;
		if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
		if (Array.isArray(valor)) return valor.map((v) => etiquetaOpcion(field, String(v))).join(', ');
		if (field.type === 'DATE') return formatearFecha(String(valor));
		if (field.type === 'DATETIME') return formatearFechaHora(String(valor));

		if (typeof valor === 'object') {
			/// `LOCATION` es el caso real de un valor objeto; el resto cae al JSON
			/// para que un dato inesperado se VEA en vez de desaparecer.
			const punto = valor as Record<string, unknown>;
			if (punto.lat != null && punto.lng != null) return `${punto.lat}, ${punto.lng}`;
			return JSON.stringify(valor);
		}
		return String(valor);
	}

	function formatearFecha(iso: string): string {
		const [a, m, d] = iso.slice(0, 10).split('-');
		return a && m && d ? `${d}/${m}/${a}` : iso;
	}

	function formatearFechaHora(iso: string): string {
		const fecha = new Date(iso);
		return Number.isNaN(fecha.getTime())
			? iso
			: fecha.toLocaleString('es-CO', {
					day: '2-digit',
					month: '2-digit',
					year: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				});
	}

	/**
	 * Filas de un contenedor repetible, indexadas por id de campo hijo.
	 *
	 * Se agrupa por `occurrenceId` y no por `rowIndex`: `rowIndex` solo da el orden
	 * de presentación y puede repetirse, mientras que `occurrenceId` es lo que
	 * identifica una fila de verdad.
	 */
	function agruparOcurrencias(field: FormFieldDto): Record<string, string>[] {
		const porOcurrencia = new Map<string, Record<string, string>>();
		for (const hijo of field.children) {
			for (const respuesta of respuestasPorCampo.get(hijo.id) ?? []) {
				const clave = respuesta.occurrenceId ?? `fila-${respuesta.rowIndex ?? 0}`;
				const fila = porOcurrencia.get(clave) ?? {};
				fila[hijo.id] =
					respuesta.optionValues.length > 0
						? respuesta.optionValues.map((v) => etiquetaOpcion(hijo, v)).join(', ')
						: respuesta.value == null || respuesta.value === ''
							? '—'
							: String(respuesta.value);
				porOcurrencia.set(clave, fila);
			}
		}
		return [...porOcurrencia.values()];
	}

	// ── Estructura ───────────────────────────────────────────────────────────

	/// Campos visibles de una sección, aplanando contenedores que no son tabla: un
	/// grupo sin ocurrencias es solo una envoltura y sus hijos se leen mejor al
	/// mismo nivel que el resto.
	function camposDe(section: FormSectionDto): FormFieldDto[] {
		const salida: FormFieldDto[] = [];
		const recorrer = (campos: FormFieldDto[]) => {
			for (const f of campos) {
				if (f.children.length > 0 && formaDe(f) !== 'tabla') recorrer(f.children);
				else salida.push(f);
			}
		};
		recorrer(section.fields);
		return salida;
	}

	/**
	 * Tramos consecutivos de la misma forma dentro de una sección.
	 *
	 * Consecutivos, no agrupados globalmente: el orden del formato es el que el
	 * conductor diligenció y el que operaciones espera al cotejar contra el papel.
	 * Reordenar por tipo daría una rejilla más compacta y un documento que no se
	 * puede comparar con el original.
	 */
	function tramosDe(section: FormSectionDto): { forma: Forma; campos: FormFieldDto[] }[] {
		const tramos: { forma: Forma; campos: FormFieldDto[] }[] = [];
		for (const field of camposDe(section)) {
			const forma = formaDe(field);
			const ultimo = tramos[tramos.length - 1];
			if (ultimo && ultimo.forma === forma) ultimo.campos.push(field);
			else tramos.push({ forma, campos: [field] });
		}
		return tramos;
	}

	const secciones = $derived((definicion.sections ?? []).filter((s) => camposDe(s).length > 0));

	/// Las secciones se reparten en dos columnas paralelas —como el FR-10— salvo
	/// las que llevan firmas, evidencia o tablas, que necesitan el ancho completo
	/// para que la imagen o la rejilla sean legibles.
	function seccionAncha(section: FormSectionDto): boolean {
		return camposDe(section).some((f) => {
			const forma = formaDe(f);
			return forma === 'firma' || forma === 'evidencia' || forma === 'tabla';
		});
	}

	const seccionesEstrechas = $derived(secciones.filter((s) => !seccionAncha(s)));
	const seccionesAnchas = $derived(secciones.filter(seccionAncha));

	// ── Hallazgos ────────────────────────────────────────────────────────────

	/**
	 * Los ítems que NO salieron bien, extraídos al encabezado.
	 *
	 * Es la razón de ser del documento: de 131 ítems, los dos en MALO son lo único
	 * que exige una acción, y enterrarlos en la página cuatro entre 129 iguales es
	 * como no reportarlos.
	 */
	const hallazgos = $derived.by(() => {
		const salida: { label: string; valor: string; tono: string }[] = [];
		for (const section of secciones) {
			for (const field of camposDe(section)) {
				if (formaDe(field) !== 'checklist') continue;
				const marcado = valorMarcado(field);
				if (!marcado) continue;
				const opcion = field.options.find((o) => o.value === marcado);
				const tono = tonoDeOpcion(opcion);
				if (tono !== 'mal' && tono !== 'alerta') continue;
				salida.push({ label: field.label, valor: opcion?.label ?? marcado, tono });
			}
		}
		return salida;
	});

	const totalChecklist = $derived(
		secciones.reduce((n, s) => n + camposDe(s).filter((f) => formaDe(f) === 'checklist').length, 0)
	);

	const sinResponder = $derived(
		secciones.reduce(
			(n, s) =>
				n + camposDe(s).filter((f) => formaDe(f) === 'checklist' && !valorMarcado(f)).length,
			0
		)
	);

	/// Referencia al documento vivo: el PDF se compone a partir de ESTE DOM, no de
	/// una segunda pasada de renderizado que podría diferir de lo que se ve.
	let documento = $state<HTMLElement | null>(null);
	let exportando = $state(false);

	async function exportar() {
		if (!documento || exportando) return;
		exportando = true;
		try {
			const nombre = [
				envio.version?.code ?? 'formulario',
				envio.vehiculo?.placa ?? envio.conductor?.numeroIdentificacion ?? '',
				envio.businessDate ?? ''
			]
				.filter(Boolean)
				.join('_');
			await exportarPdfEnvio(documento, nombre);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo generar el PDF.');
		} finally {
			exportando = false;
		}
	}
</script>

<!-- La hoja del documento se inyecta como estilo global: vive fuera del
     componente para que el exportador a PDF pueda mandarla al servidor tal cual.
     Todo cuelga de `[data-fdoc]`, así que no alcanza a nada más de la página. -->
<svelte:head>
	{@html `<style data-fdoc-css>${documentoEnvioCss()}</style>`}
</svelte:head>

<div class="visor">
	<div class="barra no-print">
		<div class="barra__info">
			<strong>{definicion.title}</strong>
			<span>{envio.version?.code ?? ''} · v{envio.version?.versionNumber ?? ''}</span>
		</div>
		<button type="button" class="barra__btn" onclick={exportar} disabled={exportando}>
			{exportando ? 'Generando…' : 'Exportar PDF'}
		</button>
	</div>

	<article data-fdoc bind:this={documento}>
		<!-- Cabecera de tres cuerpos, como el formato en papel. -->
		<header class="cab">
			<div class="cab__marca">
				<img class="cab__logo" src={logo} alt={empresa} />
			</div>
			<h1 class="cab__titulo">{definicion.title}</h1>
			<dl class="cab__meta">
				<div>
					<dt>Código</dt>
					<dd>{envio.version?.code ?? '—'}</dd>
				</div>
				<div>
					<dt>Versión</dt>
					<dd>{envio.version?.versionNumber ?? '—'}</dd>
				</div>
				<div>
					<dt>Fecha</dt>
					<dd>{envio.businessDate ?? '—'}</dd>
				</div>
			</dl>
		</header>

		<!-- Datos del registro: pares densos a varias columnas, como el bloque
		     «DATOS Y CONTROL DE DOCUMENTOS» del FR-10. -->
		<h2 class="banda">Datos del registro</h2>
		<dl class="ficha">
			<div class="ficha__par">
				<dt>{envio.actor?.kind === 'USER' ? 'Diligenciado por' : 'Conductor'}</dt>
				<dd>{envio.actor?.nombre ?? '—'}</dd>
			</div>
			<div class="ficha__par">
				<dt>Identificación</dt>
				<dd>{envio.conductor?.numeroIdentificacion ?? '—'}</dd>
			</div>
			<div class="ficha__par">
				<dt>Placa</dt>
				<dd>{envio.vehiculo?.placa ?? '—'}</dd>
			</div>
			<div class="ficha__par">
				<dt>Fecha operativa</dt>
				<dd>{envio.businessDate ?? '—'}</dd>
			</div>
			<div class="ficha__par">
				<dt>Entregado</dt>
				<dd>{envio.submittedAt ? formatearFechaHora(envio.submittedAt) : 'Sin entregar'}</dd>
			</div>
			<div class="ficha__par">
				<dt>Estado</dt>
				<dd>
					{envio.status === 'SUBMITTED'
						? 'Entregado'
						: envio.status === 'VOIDED'
							? 'Anulado'
							: 'Borrador'}
				</dd>
			</div>
		</dl>

		{#if envio.status === 'VOIDED'}
			<p class="anulado">
				<strong>Envío anulado.</strong>
				{envio.voidReason ?? 'Sin motivo registrado.'} Las respuestas se conservan como constancia.
			</p>
		{/if}

		{#if totalChecklist > 0}
			<div class="resumen" class:resumen--limpio={hallazgos.length === 0}>
				<p class="resumen__t">
					{#if hallazgos.length === 0}
						Sin novedades · {totalChecklist} ítems verificados en conformidad
					{:else}
						{hallazgos.length} de {totalChecklist} ítems requieren atención
					{/if}
					{#if sinResponder > 0}<span class="resumen__pend">
							· {sinResponder} sin responder</span
						>{/if}
				</p>
				{#if hallazgos.length > 0}
					<ul class="resumen__lista">
						{#each hallazgos as h}
							<li><b class="marca marca--{h.tono}">{h.valor}</b> {h.label}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		<!-- Cuerpo a dos columnas paralelas. `columns` y no `grid`: las secciones
		     fluyen y se equilibran solas sin repartirlas a mano. -->
		<div class="cuerpo">
			{#each seccionesEstrechas as section (section.id)}
				{@const catalogo = catalogoComun(camposDe(section))}
				<section class="sec">
					<h2 class="banda">{section.title}</h2>

					{#if catalogo}
						<!-- Cabecera de estados: se dibuja UNA vez por sección en vez de
						     repetir la etiqueta en cada una de las 130 filas. -->
						<div class="cab-estado" style={`--n:${catalogo.length}`}>
							<span class="cab-estado__desc">Descripción</span>
							{#each catalogo as o (o.id)}
								<span class="cab-estado__c" title={o.label}>{abreviatura(o)}</span>
							{/each}
						</div>
					{/if}

					{#each tramosDe(section) as tramo}
						{#if tramo.forma === 'checklist' && catalogo}
							{#each tramo.campos as field (field.id)}
								{@const marcado = valorMarcado(field)}
								{@const opcion = field.options.find((o) => o.value === marcado)}
								{@const tono = marcado ? tonoDeOpcion(opcion) : 'vacio'}
								<div class="fila fila--{tono}" style={`--n:${catalogo.length}`}>
									<span class="fila__desc">{field.label}</span>
									{#each catalogo as o (o.id)}
										<span class="fila__c" class:fila__c--on={o.value === marcado}>
											{o.value === marcado ? '✕' : ''}
										</span>
									{/each}
								</div>
							{/each}
						{:else if tramo.forma === 'checklist'}
							<!-- Escalas mezcladas en la misma sección: sin cabecera común, el
							     valor va escrito en la fila. -->
							{#each tramo.campos as field (field.id)}
								{@const marcado = valorMarcado(field)}
								{@const opcion = field.options.find((o) => o.value === marcado)}
								<div class="fila fila--libre">
									<span class="fila__desc">{field.label}</span>
									<span class="fila__valor marca marca--{marcado ? tonoDeOpcion(opcion) : 'vacio'}">
										{opcion?.label ?? marcado ?? '—'}
									</span>
								</div>
							{/each}
						{:else if tramo.forma === 'escalar'}
							{#each tramo.campos as field (field.id)}
								{@const valor = valorLegible(field)}
								<div class="fila fila--libre">
									<span class="fila__desc">{field.label}</span>
									<span class="fila__valor" class:vacio={valor === null}>{valor ?? '—'}</span>
								</div>
							{/each}
						{:else if tramo.forma === 'bloque'}
							{#each tramo.campos as field (field.id)}
								{@const valor = valorLegible(field)}
								<div class="parrafo">
									<p class="parrafo__k">{field.label}</p>
									<p class="parrafo__v" class:vacio={valor === null}>{valor ?? '—'}</p>
								</div>
							{/each}
						{:else if tramo.forma === 'nota'}
							{#each tramo.campos as field (field.id)}
								<p class="nota">{field.helpText || field.label}</p>
							{/each}
						{/if}
					{/each}
				</section>
			{/each}
		</div>

		<!-- Firmas, evidencia y tablas: ancho completo. -->
		{#each seccionesAnchas as section (section.id)}
			<section class="sec sec--ancha">
				<h2 class="banda">{section.title}</h2>
				{#each tramosDe(section) as tramo}
					{#if tramo.forma === 'firma'}
						<div class="firmas">
							{#each tramo.campos as field (field.id)}
								{@const adjuntos = adjuntosPorCampo.get(field.id) ?? []}
								<figure class="firma">
									{#if adjuntos.length && adjuntos[0].url}
										<img class="firma__img" src={adjuntos[0].url} alt="Firma de {field.label}" />
									{:else}
										<div class="firma__falta">Sin firma registrada</div>
									{/if}
									<figcaption class="firma__pie">{field.label}</figcaption>
								</figure>
							{/each}
						</div>
					{:else if tramo.forma === 'evidencia'}
						{#each tramo.campos as field (field.id)}
							{@const adjuntos = adjuntosPorCampo.get(field.id) ?? []}
							<div class="evid">
								<p class="parrafo__k">{field.label}</p>
								{#if adjuntos.length === 0}
									<p class="vacio">Sin evidencia adjunta</p>
								{:else}
									<div class="galeria">
										{#each adjuntos as at (at.id)}
											{#if at.mimeType?.startsWith('image/') && at.url}
												<figure class="foto">
													<img
														class="foto__img"
														src={at.url}
														alt={at.originalName ?? field.label}
													/>
												</figure>
											{:else}
												<!-- Un PDF adjunto no se puede incrustar en el impreso; se
												     deja constancia de que existe. -->
												<div class="archivo">
													<b>{at.originalName ?? 'Archivo'}</b>
													<span>{at.mimeType}</span>
												</div>
											{/if}
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					{:else if tramo.forma === 'tabla'}
						{#each tramo.campos as field (field.id)}
							{@const filas = agruparOcurrencias(field)}
							<div class="tabla-wrap">
								<p class="parrafo__k">{field.label}</p>
								{#if filas.length === 0}
									<p class="vacio">Sin registros</p>
								{:else}
									<table class="tabla">
										<thead>
											<tr>
												{#each field.children as hijo (hijo.id)}<th>{hijo.label}</th>{/each}
											</tr>
										</thead>
										<tbody>
											{#each filas as fila}
												<tr>
													{#each field.children as hijo (hijo.id)}<td>{fila[hijo.id] ?? '—'}</td
														>{/each}
												</tr>
											{/each}
										</tbody>
									</table>
								{/if}
							</div>
						{/each}
					{:else if tramo.forma === 'escalar' || tramo.forma === 'checklist'}
						{#each tramo.campos as field (field.id)}
							{@const valor = valorLegible(field)}
							<div class="fila fila--libre">
								<span class="fila__desc">{field.label}</span>
								<span class="fila__valor" class:vacio={valor === null}>{valor ?? '—'}</span>
							</div>
						{/each}
					{:else if tramo.forma === 'bloque'}
						{#each tramo.campos as field (field.id)}
							{@const valor = valorLegible(field)}
							<div class="parrafo">
								<p class="parrafo__k">{field.label}</p>
								<p class="parrafo__v" class:vacio={valor === null}>{valor ?? '—'}</p>
							</div>
						{/each}
					{/if}
				{/each}
			</section>
		{/each}

		<footer class="pie">
			<span>{empresa} · {envio.version?.code ?? ''} v{envio.version?.versionNumber ?? ''}</span>
			<span>{envio.id}</span>
		</footer>
	</article>
</div>

<style>
	/* Sin `max-width`: el documento ocupa el ancho que le dé el layout, que es
	   justo lo que permite las dos columnas paralelas. */
	.visor {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
	}

	.barra {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.625rem 0.875rem;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
		border-radius: 12px;
	}

	.barra__info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: 0.8125rem;
	}

	.barra__info span {
		font-size: 0.6875rem;
		color: var(--text-secondary, #4a4a4a);
		font-family: var(--font-mono, monospace);
	}

	.barra__btn {
		min-height: 40px;
		padding: 0 1rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 700;
		color: #fff;
		background: var(--emerald-600, #059669);
		border: none;
		border-radius: 10px;
		cursor: pointer;
	}

	.barra__btn:disabled {
		opacity: 0.6;
		cursor: progress;
	}
</style>
