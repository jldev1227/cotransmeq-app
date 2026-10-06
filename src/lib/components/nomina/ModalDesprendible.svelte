<script lang="ts">
	/**
	 * Vista previa del desprendible dentro del canvas de nómina.
	 *
	 * Es la ÚNICA forma de mostrarlo en el canvas: el botón «Ver desprendible»
	 * del carril, el asistente (`?desprendible=`) y la notificación de firma
	 * (`?preview=1`) llegan todos aquí. Antes los dos primeros abrían una
	 * pestaña nueva y solo la notificación usaba este modal, con lo que el
	 * mismo documento se veía de dos formas según por dónde se entrara.
	 *
	 * El PDF viene ya generado como blob (el mismo de `pdfDesprendible.ts` que
	 * ve el conductor); aquí solo se muestra, se descarga o se abre aparte.
	 * Con el asistente abierto el modal deja libre su columna (regla global de
	 * abajo) para que la conversación siga a la vista.
	 */
	import { Download, ExternalLink, X } from 'lucide-svelte';

	interface Props {
		url: string;
		titulo: string;
		/** Rótulo pequeño sobre el título: «DESPRENDIBLE» o «FIRMA RECIBIDA». */
		etiqueta?: string;
		periodo?: string;
		archivo?: string;
		onclose: () => void;
	}

	let { url, titulo, etiqueta = 'DESPRENDIBLE', periodo = '', archivo = 'desprendible.pdf', onclose }: Props =
		$props();

	function abrirEnPestana() {
		window.open(url, '_blank', 'noopener');
	}

	function teclado(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={teclado} />

<div class="md-fondo" role="dialog" aria-modal="true" aria-label={`${etiqueta} · ${titulo}`}>
	<div class="md-caja">
		<header class="md-cabecera">
			<div class="md-textos">
				<p class="md-etiqueta">{etiqueta}</p>
				<h2 class="md-titulo">{titulo}</h2>
				{#if periodo}<p class="md-periodo">{periodo}</p>{/if}
			</div>
			<div class="md-acciones">
				<a class="btn-secondary md-btn" href={url} download={archivo}>
					<Download size={15} aria-hidden="true" />
					<span>Descargar</span>
				</a>
				<button type="button" class="btn-secondary md-btn" onclick={abrirEnPestana}>
					<ExternalLink size={15} aria-hidden="true" />
					<span>Abrir en pestaña</span>
				</button>
				<button type="button" class="md-cerrar" aria-label="Cerrar" onclick={onclose}>
					<X size={18} />
				</button>
			</div>
		</header>
		<iframe class="md-pdf" src={url} title={`${etiqueta} · ${titulo}`}></iframe>
	</div>
</div>

<style>
	.md-fondo {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		padding: 0.75rem;
		background: rgba(2, 6, 23, 0.75);
		backdrop-filter: blur(4px);
	}
	@media (min-width: 768px) {
		.md-fondo {
			padding: 1.5rem;
		}
	}
	/* Con el asistente abierto se deja libre su columna (420px). */
	@media (min-width: 1024px) {
		:global(html.asistente-abierto) .md-fondo {
			right: 420px;
		}
	}
	.md-caja {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 72rem;
		height: 100%;
		margin: 0 auto;
		overflow: hidden;
		border-radius: 1rem;
		background: #fff;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
	}
	.md-cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e2e8f0;
	}
	.md-textos {
		min-width: 0;
	}
	.md-etiqueta {
		margin: 0;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		color: #047857;
	}
	.md-titulo {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1rem;
		font-weight: 700;
		color: #0f172a;
	}
	.md-periodo {
		margin: 0;
		font-size: 0.75rem;
		color: #64748b;
	}
	.md-acciones {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.5rem;
	}
	.md-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		text-decoration: none;
	}
	.md-cerrar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: #475569;
		cursor: pointer;
	}
	.md-cerrar:hover {
		background: #f1f5f9;
		color: #0f172a;
	}
	.md-pdf {
		flex: 1 1 auto;
		min-height: 0;
		border: none;
		background: #f1f5f9;
	}
	@media (max-width: 640px) {
		.md-btn span {
			display: none;
		}
	}
</style>
