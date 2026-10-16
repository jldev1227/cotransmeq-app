<script lang="ts">
	import { onMount } from 'svelte';
	import { Copy, Download, Loader2, Share2 } from 'lucide-svelte';
	import QRCode from 'qrcode';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

	interface Props {
		open: boolean;
		titulo: string;
		url: string;
		selloSrc: string;
		oncerrar: () => void;
	}

	let { open, titulo, url, selloSrc, oncerrar }: Props = $props();
	let qr = $state('');
	let generando = $state(false);
	let error = $state('');
	let compartirArchivoDisponible = $state(false);

	onMount(() => {
		try {
			const compartirNativo = Reflect.get(navigator, 'share');
			const comprobarArchivos = Reflect.get(navigator, 'canShare');
			if (typeof compartirNativo === 'function' && typeof comprobarArchivos === 'function') {
				const prueba = new File([], 'codigo-qr.png', { type: 'image/png' });
				compartirArchivoDisponible = comprobarArchivos.call(navigator, { files: [prueba] });
			}
		} catch {
			compartirArchivoDisponible = false;
		}
	});

	$effect(() => {
		if (!open || !url) {
			qr = '';
			return;
		}

		let vigente = true;
		generando = true;
		qr = '';
		error = '';
		void generarCodigo(url, selloSrc)
			.then((resultado) => {
				if (vigente) qr = resultado;
			})
			.catch(() => {
				if (vigente) error = 'No se pudo generar el código QR.';
			})
			.finally(() => {
				if (vigente) generando = false;
			});

		return () => {
			vigente = false;
		};
	});

	function cargarImagen(src: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const imagen = new Image();
			imagen.onload = () => resolve(imagen);
			imagen.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
			imagen.src = src;
		});
	}

	async function generarCodigo(destino: string, selloSrc: string) {
		const canvas = document.createElement('canvas');
		await QRCode.toCanvas(canvas, destino, {
			width: 360,
			margin: 2,
			errorCorrectionLevel: 'H',
			color: { dark: '#102b24', light: '#ffffff' }
		});

		const ctx = canvas.getContext('2d');
		const imagenSello = await cargarImagen(selloSrc);
		if (!ctx) throw new Error('Canvas no disponible.');

		/// El nivel H recupera los módulos que cubre la marca, incluso si se imprime.
		const placaAncho = 104;
		const placaAlto = 104;
		const x = (canvas.width - placaAncho) / 2;
		const y = (canvas.height - placaAlto) / 2;
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(x, y, placaAncho, placaAlto);

		// La placa blanca solo despeja módulos del QR; el sello ocupa casi toda
		// esa superficie para que se lea sin debilitar demasiado el código.
		const maxAnchoSello = placaAncho - 4;
		const maxAltoSello = placaAlto - 4;
		const escala = Math.min(maxAnchoSello / imagenSello.naturalWidth, maxAltoSello / imagenSello.naturalHeight);
		const anchoSello = imagenSello.naturalWidth * escala;
		const altoSello = imagenSello.naturalHeight * escala;
		ctx.drawImage(
			imagenSello,
			(canvas.width - anchoSello) / 2,
			(canvas.height - altoSello) / 2,
			anchoSello,
			altoSello
		);
		return canvas.toDataURL('image/png');
	}

	async function copiarEnlace() {
		try {
			await navigator.clipboard.writeText(url);
			toast.success('Enlace copiado');
		} catch {
			toast.error('No se pudo copiar el enlace');
		}
	}

	function nombreArchivo() {
		const limpio = titulo
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-zA-Z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.toLowerCase();
		return 'qr-' + (limpio || 'compartir') + '.png';
	}

	function descargar() {
		if (!qr) return;
		const enlace = document.createElement('a');
		enlace.href = qr;
		enlace.download = nombreArchivo();
		enlace.click();
	}

	async function compartir() {
		if (!qr || !compartirArchivoDisponible) return;
		try {
			const blob = await (await fetch(qr)).blob();
			const archivo = new File([blob], nombreArchivo(), { type: 'image/png' });
			await navigator.share({ title: titulo, text: url, files: [archivo] });
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			toast.error('No se pudo compartir el código QR');
		}
	}
</script>

<ModalBase
	open={open}
	title="Compartir código QR"
	eyebrow="Asistencias y evaluaciones"
	subtitle={titulo}
	tamano="sm"
	oncerrar={oncerrar}
>
	<div class="qr-contenido">
		<div class="qr-marco">
			{#if generando}
				<div class="qr-estado"><Loader2 size={20} class="girar" /> Generando código…</div>
			{:else if error}
				<div class="qr-estado qr-error">{error}</div>
			{:else if qr}
				<img src={qr} alt="Código QR para {titulo}" width="280" height="280" />
			{/if}
		</div>
		<div class="qr-enlace">
			<span>Enlace público</span>
			<code>{url}</code>
		</div>
		<p>Al escanearlo, se abrirá directamente el formulario para responder.</p>
	</div>

	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={copiarEnlace}>
			<Copy size={15} /> Copiar enlace
		</button>
		<button type="button" class="btn-secondary" onclick={descargar} disabled={!qr}>
			<Download size={15} /> Descargar QR
		</button>
		{#if compartirArchivoDisponible}
			<button type="button" class="btn-primary" onclick={compartir} disabled={!qr}>
				<Share2 size={15} /> Compartir QR
			</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.qr-contenido {
		display: grid;
		justify-items: center;
		gap: 1rem;
	}
	.qr-marco {
		width: min(100%, 300px);
		aspect-ratio: 1;
		display: grid;
		place-items: center;
		padding: 0.6rem;
		border: 1px solid var(--border-subtle);
		border-radius: 18px;
		background: #fff;
	}
	.qr-marco img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.qr-estado {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.qr-error {
		color: var(--au-danger, #b42318);
	}
	.qr-enlace {
		width: 100%;
		display: grid;
		gap: 0.3rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: var(--bg-base);
	}
	.qr-enlace span {
		color: var(--text-muted);
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.qr-enlace code {
		color: var(--text-primary);
		font-size: 0.73rem;
		line-height: 1.45;
		word-break: break-all;
	}
	.qr-contenido p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.8rem;
		text-align: center;
	}
	:global(.girar) {
		animation: giro 1s linear infinite;
	}
	@keyframes giro {
		to { transform: rotate(360deg); }
	}
</style>
