<!--
	El PAPEL de un canvas: un `DocumentoPreview` pintado como documento.

	Vive aparte de `PreviewCanvasModal` porque tiene DOS consumidores y no
	uno. El modal lo monta para que el usuario lo mire y lo exporte a PDF;
	`exportar-zip.ts` lo monta fuera de pantalla, una hoja tras otra, para
	sacar el cuerpo de cada PDF del lote sin enseñarlas.

	Eso solo funciona si es el MISMO marcado: el PDF se renderiza a partir
	de este DOM (ver `exportar-pdf.ts`), así que una segunda implementación
	—un generador de HTML en cadena, por ejemplo— daría un papel distinto en
	el ZIP que en la exportación de a uno, y nadie lo notaría hasta tener
	los dos delante.

	No lleva `<style>` a propósito: la hoja de estilos del documento se
	inyecta como CSS GLOBAL (`documento.css.ts`) porque el mismo texto viaja
	al backend, y unas clases con hash de scope de Svelte no servirían allí.
-->
<script lang="ts">
	import { columnasVisibles, type ScopePreview } from './columnas';
	import { claseDeCelda, textoDeCelda } from './formato';
	import type { DocumentoPreview, LineaResumen, SeccionPreview } from './tipos';

	interface Props {
		scope: ScopePreview;
		documento: DocumentoPreview;
		/** Claves de columna activas. Ver `columnas.ts`. */
		seleccion: string[];
		/** Ancho del lienzo, en px. */
		ancho: number;
		/** Escala de pantalla. El PDF la ignora: allí la pone `@page`. */
		zoom?: number;
		/** Nodo raíz, para medirlo y para sacar de él el cuerpo del PDF. */
		el?: HTMLElement | null;
	}

	let { scope, documento, seleccion, ancho, zoom = 1, el = $bindable(null) }: Props = $props();

	let logoRoto = $state(false);

	const estilo = $derived(
		`width: ${ancho}px; transform: scale(${zoom}); transform-origin: top left;`
	);

	/** Columnas visibles de una sección, ya intersecadas con la selección. */
	function columnasDe(sec: SeccionPreview) {
		return columnasVisibles(scope, seleccion, sec.columnas);
	}

	/**
	 * Reparto del `colgroup` sobre las columnas VISIBLES.
	 *
	 * Se normaliza en vez de usar el peso declarado tal cual: con
	 * `table-layout: fixed`, ocultar media tabla y dejar los anchos
	 * originales deja el resto apelotonado a la izquierda con un hueco al
	 * final.
	 */
	function anchos(cols: Array<{ peso: number }>): number[] {
		const total = cols.reduce((s, c) => s + (c.peso || 1), 0) || 1;
		return cols.map((c) => ((c.peso || 1) * 100) / total);
	}

	/**
	 * Cuántas columnas ocupa la etiqueta «TOTALES» del pie: todas las que
	 * van antes de la primera que sí lleva un total.
	 */
	function colspanTotales(sec: SeccionPreview, cols: Array<{ key: string }>): number {
		const i = cols.findIndex((c) => sec.totales?.[c.key] != null);
		return i <= 0 ? 1 : i;
	}

	function claseLinea(l: LineaResumen): string {
		return l.fuerte ? 'fuerte' : l.descuento ? 'desc' : '';
	}

	const hoy = new Date().toLocaleDateString('es-CO', {
		day: '2-digit',
		month: 'long',
		year: 'numeric'
	});
</script>

<div class="doc" bind:this={el} style={estilo}>
	<!-- Header editorial -->
	<div class="header">
		<div class="header-logo">
			{#if logoRoto}
				<div class="fallback">COTRANS<br />MEQ</div>
			{:else}
				<img
					src="/assets/logo_nombre.webp"
					alt="Cotransmeq S.A.S"
					onerror={() => (logoRoto = true)}
				/>
			{/if}
		</div>
		<div class="header-title">
			<div class="co">TRANSPORTES Y SERVICIOS ESMERALDA S.A.S.</div>
			<div class="doc-name">{documento.titulo}</div>
		</div>
		<div class="header-meta">
			<table>
				<tbody>
					{#each documento.meta as m (m.label)}
						<tr><td class="ml">{m.label}</td><td class="mv">{m.valor}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Banda de periodo -->
	{#if documento.periodo.length}
		<div class="period">
			{#each documento.periodo as p (p.label)}
				<div class="pc">
					<span class="lbl">{p.label}:</span><span class="val">{p.valor}</span>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Secciones -->
	{#each documento.secciones as sec (sec.id)}
		{@const cols = columnasDe(sec)}
		{@const pesos = anchos(cols)}
		<div class="sec" class:page-break-before={sec.saltoDePagina}>
			<div class="sec-title">
				<span>{sec.titulo}</span>
				{#if sec.nota}<span class="sec-nota">{sec.nota}</span>{/if}
			</div>

			{#if sec.columnas.length === 0}
				<!-- Sección sin tabla: solo su bloque clave/valor (los
				     desgloses de descuentos del canvas ocasional). -->
			{:else if cols.length === 0}
				<div class="sec-vacio">Todas las columnas de esta sección están ocultas.</div>
			{:else if sec.filas.length === 0}
				<div class="sec-vacio">{sec.vacio || 'Sin filas.'}</div>
			{:else}
				<table class="tbl">
					<colgroup>
						{#each pesos as w, i (cols[i].key)}
							<col style="width:{w.toFixed(3)}%" />
						{/each}
					</colgroup>
					<thead>
						<tr>
							{#each cols as c (c.key)}
								<th class:col-internal={c.interna}>{c.label}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each sec.filas as fila, i (sec.id + ':' + i)}
							<tr class:destacada={fila.destacada} class:excluida={fila.excluida}>
								{#each cols as c (c.key)}
									<td
										class={claseDeCelda(fila.celdas[c.key], c.tipo)}
										class:col-internal={c.interna}
									>
										{textoDeCelda(fila.celdas[c.key], c.tipo)}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
					{#if sec.totales}
						{@const span = colspanTotales(sec, cols)}
						<tfoot>
							<tr>
								<td class="lbl" colspan={span}>{sec.totalesLabel || 'Totales'}</td>
								{#each cols.slice(span) as c (c.key)}
									<td
										class={claseDeCelda(sec.totales[c.key], c.tipo)}
										class:col-internal={c.interna}
									>
										{textoDeCelda(sec.totales[c.key], c.tipo)}
									</td>
								{/each}
							</tr>
						</tfoot>
					{/if}
				</table>
			{/if}

			{#if sec.bloques?.length}
				<div class="bloques bloques-{sec.bloquesPorFila ?? 3}">
					{#each sec.bloques as b (b.id)}
						<div
							class="bloque bloque-{b.variante ?? 'neutro'}"
							class:bloque-full={b.ancho === 'completo'}
						>
							{#if b.titulo || b.subtitulo || b.etiqueta}
								<div class="bloque-head">
									<span class="bloque-titulo">{b.titulo ?? ''}</span>
									{#if b.subtitulo}<span class="bloque-sub">{b.subtitulo}</span>{/if}
									{#if b.etiqueta}<span class="bloque-etiqueta">{b.etiqueta}</span>{/if}
								</div>
							{/if}
							{#if b.filas.length === 0}
								<div class="bloque-vacio">{b.vacio || 'Sin filas.'}</div>
							{:else}
								<table class="bloque-tbl">
									<colgroup>
										{#each anchos(b.columnas) as w, i (b.columnas[i].key)}
											<col style="width:{w.toFixed(3)}%" />
										{/each}
									</colgroup>
									<thead>
										<tr>
											{#each b.columnas as c (c.key)}<th>{c.label}</th>{/each}
										</tr>
									</thead>
									<tbody>
										{#each b.filas as fila, i (b.id + ':' + i)}
											<tr
												class:categoria={fila.variante === 'categoria'}
												class:hija={fila.variante === 'hija'}
												class:destacada={fila.destacada}
											>
												{#each b.columnas as c (c.key)}
													<td class={claseDeCelda(fila.celdas[c.key], c.tipo)}>
														{textoDeCelda(fila.celdas[c.key], c.tipo)}
													</td>
												{/each}
											</tr>
										{/each}
									</tbody>
								</table>
							{/if}
							{#if b.pie}
								<div class="bloque-pie">
									<span>{b.pie.label}</span>
									<span class="v">{textoDeCelda(b.pie.valor, 'moneda')}</span>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if sec.resumen?.length}
				<div class="kv">
					<table class="kv-tbl">
						<colgroup>
							<col style="width:62%" />
							<col style="width:38%" />
						</colgroup>
						<tbody>
							{#each sec.resumen as l (sec.id + ':' + l.label)}
								<tr class={claseLinea(l)}>
									<td class="lbl">{l.label}</td>
									<td class="mc">{textoDeCelda(l.valor, 'moneda')}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/each}

	<!-- Resumen final -->
	{#if documento.resumen?.length}
		<div class="resumen">
			<table class="resumen-tbl">
				<tbody>
					{#each documento.resumen as l (l.label)}
						<tr class={claseLinea(l)}>
							<td class="lbl">{l.label}</td>
							<td class="mc">{textoDeCelda(l.valor, 'moneda')}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- Firmas -->
	{#if documento.firmas !== false}
		<div class="sigs">
			<div class="sig">
				<div class="sig-lbl">LIQUIDADO POR:</div>
				<!-- `data-rol="sello"` NO es decoración: al exportar, `prepararCuerpo`
				     sustituye por el LOGO cualquier `<img>` cuyo src no sea ya un
				     data-URL —lo hace para que Puppeteer, que renderiza sin URL
				     base, no deje huecos—. Sin esta marca el sello salía convertido
				     en el logo de la cabecera. -->
				{#if documento.sello}
					<img
						class="sig-img"
						data-rol="sello"
						src="/assets/sello-firma-terceros.jpg"
						alt="Sello de Transportes y Servicios Esmeralda S.A.S."
					/>
				{/if}
				<div class="sig-line">&nbsp;</div>
			</div>
			<div class="sig">
				<div class="sig-lbl">REVISADO POR:</div>
				<div class="sig-line">&nbsp;</div>
			</div>
		</div>
	{/if}

	<div class="doc-ft">
		<span class="code">COTRANSMEQ</span>
		<span>Generado el {hoy}</span>
		<span>Transportes y Servicios Esmeralda S.A.S.</span>
	</div>
</div>
