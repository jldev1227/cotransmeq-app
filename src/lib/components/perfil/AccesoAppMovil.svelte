<script lang="ts">
	/**
	 * «App móvil»: enlace de 30 días con el que cualquier usuario entra a la app del teléfono
	 * (lo que ve adentro depende de sus permisos). El enlace completo se ve una sola vez (el backend guarda su
	 * hash); generar otro invalida el anterior y revocarlo cierra las sesiones que abrió.
	 */
	import { onMount } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { Check, CheckCircle2, Copy, Loader2, Share2, Smartphone, X } from 'lucide-svelte';
	import QRCode from 'qrcode';
	import {
		estadoEnlaceApp,
		generarEnlaceApp,
		revocarEnlaceApp,
		type EnlaceAppMovil,
		type EnlaceAppMovilCreado
	} from '$lib/api/app-movil';
	import { toast } from '$lib/stores/toast';
	import { confirmar } from '$lib/stores/confirm';

	let cargando = $state(true);
	let vigente = $state<EnlaceAppMovil | null>(null);
	let nuevo = $state<EnlaceAppMovilCreado | null>(null);
	let qr = $state('');
	let trabajando = $state(false);
	let copiado = $state(false);

	const puedeCompartir = typeof navigator !== 'undefined' && 'share' in navigator;

	onMount(cargar);

	async function cargar() {
		cargando = true;
		try {
			const estado = await estadoEnlaceApp();
			vigente = estado.enlace;
		} catch {
			toast.error('No se pudo consultar tu acceso a la app');
		} finally {
			cargando = false;
		}
	}

	async function generar() {
		if (vigente) {
			const ok = await confirmar({
				title: '¿Generar un enlace nuevo?',
				message:
					'El enlace anterior deja de funcionar y los teléfonos que entraron con él tendrán que usar el nuevo.',
				tone: 'warning',
				confirmText: 'Generar'
			});
			if (!ok) return;
		}
		trabajando = true;
		try {
			nuevo = await generarEnlaceApp();
			vigente = nuevo;
			qr = await QRCode.toDataURL(nuevo.url, { margin: 1, width: 220 });
		} catch (err: unknown) {
			const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
			toast.error(msg ?? 'No se pudo generar el enlace');
		} finally {
			trabajando = false;
		}
	}

	async function revocar() {
		const ok = await confirmar({
			title: '¿Revocar el acceso a la app?',
			message:
				'El enlace deja de funcionar y se cierra la sesión en los teléfonos que entraron con él.',
			tone: 'danger',
			confirmText: 'Revocar'
		});
		if (!ok) return;
		trabajando = true;
		try {
			await revocarEnlaceApp();
			vigente = null;
			nuevo = null;
			toast.success('Acceso a la app revocado');
		} catch {
			toast.error('No se pudo revocar el acceso');
		} finally {
			trabajando = false;
		}
	}

	async function copiar() {
		if (!nuevo) return;
		await navigator.clipboard.writeText(nuevo.url);
		copiado = true;
		setTimeout(() => (copiado = false), 1800);
	}

	async function compartir() {
		if (!nuevo) return;
		try {
			await navigator.share({ title: 'Acceso a la app', url: nuevo.url });
		} catch {
			// Cancelado por el usuario.
		}
	}

	function fecha(iso: string | null) {
		if (!iso) return 'nunca';
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="am" in:fade>
	{#if cargando}
		<p class="am-vacio"><Loader2 size={15} class="am-girar" /> Cargando…</p>
	{:else}
		<p class="am-intro">
			Entra a la app de Cotransmeq desde tu teléfono con tu usuario: verás las secciones que te
			dan tus permisos (servicios, formularios, capacitaciones, asistente…). Abre el enlace en el
			teléfono —o escanea el código— con la app instalada. El acceso dura <strong>30 días</strong>.
		</p>

		{#if nuevo}
			<div class="am-nuevo" transition:slide>
				<div class="am-nuevo-cabecera">
					<p class="am-nuevo-titulo">
						<CheckCircle2 size={15} aria-hidden="true" />
						Enlace listo
					</p>
					<button
						type="button"
						class="am-btn-icono"
						aria-label="Ocultar"
						onclick={() => (nuevo = null)}
					>
						<X size={15} />
					</button>
				</div>
				<p class="am-nuevo-aviso">
					Por seguridad no se vuelve a mostrar. Quien lo tenga entra a la app como tú: envíatelo
					solo a ti.
				</p>
				<div class="am-nuevo-cuerpo">
					{#if qr}
						<img
							class="am-qr"
							src={qr}
							alt="Código QR del enlace a la app"
							width="160"
							height="160"
						/>
					{/if}
					<div class="am-nuevo-acciones">
						<code>{nuevo.url}</code>
						<div class="am-botones">
							<button type="button" class="am-btn am-btn--oscuro" onclick={copiar}>
								{#if copiado}<Check size={14} />{:else}<Copy size={14} />{/if}
								{copiado ? 'Copiado' : 'Copiar'}
							</button>
							{#if puedeCompartir}
								<button type="button" class="am-btn" onclick={compartir}>
									<Share2 size={14} /> Compartir
								</button>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{/if}

		{#if vigente}
			<div class="am-estado">
				<Smartphone size={18} class="am-estado-icono" aria-hidden="true" />
				<div class="am-estado-texto">
					<p class="am-estado-titulo">Enlace vigente hasta {fecha(vigente.vence)}</p>
					<p class="am-estado-meta">
						Generado {fecha(vigente.creado)} · usado {vigente.usos}
						{vigente.usos === 1 ? 'vez' : 'veces'} · último uso {fecha(vigente.ultimo_uso)}
					</p>
				</div>
				<button type="button" class="am-revocar" onclick={revocar} disabled={trabajando}
					>Revocar</button
				>
			</div>
		{/if}

		<div>
			<button type="button" class="am-btn am-btn--primario" onclick={generar} disabled={trabajando}>
				{#if trabajando}<Loader2 size={15} class="am-girar" />{:else}<Smartphone size={15} />{/if}
				{vigente ? 'Generar enlace nuevo' : 'Generar enlace a la app'}
			</button>
		</div>
	{/if}
</div>

<style>
	.am {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.am-intro {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	.am-vacio {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.am-nuevo {
		padding: 1rem;
		border: 1px solid var(--emerald-500);
		border-radius: 14px;
		background: var(--au-tint, #ddf7ea);
	}
	.am-nuevo-cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.am-nuevo-titulo {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--emerald-800);
	}
	.am-nuevo-aviso {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: var(--emerald-800);
	}
	.am-nuevo-cuerpo {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		margin-top: 0.85rem;
	}
	.am-qr {
		flex-shrink: 0;
		border-radius: 10px;
		background: #fff;
		padding: 0.35rem;
	}
	.am-nuevo-acciones {
		display: flex;
		flex: 1;
		min-width: 14rem;
		flex-direction: column;
		gap: 0.6rem;
	}
	.am-nuevo-acciones code {
		display: block;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-size: 0.72rem;
		color: var(--text-secondary);
		word-break: break-all;
	}
	.am-botones {
		display: flex;
		gap: 0.5rem;
	}
	.am-estado {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid var(--border-default);
		border-radius: 12px;
	}
	.am-estado :global(.am-estado-icono) {
		flex-shrink: 0;
		color: var(--emerald-600);
	}
	.am-estado-texto {
		flex: 1;
		min-width: 0;
	}
	.am-estado-titulo {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.am-estado-meta {
		margin: 0.1rem 0 0;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.am-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.25rem;
		padding: 0 0.85rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary);
		cursor: pointer;
	}
	.am-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.am-btn--oscuro {
		border-color: var(--emerald-800);
		background: var(--emerald-800);
		color: #fff;
	}
	.am-btn--primario {
		border-color: var(--emerald-600);
		background: var(--emerald-600);
		color: #fff;
	}
	.am-btn-icono {
		display: inline-flex;
		padding: 0.25rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--emerald-800);
		cursor: pointer;
	}
	.am-revocar {
		flex-shrink: 0;
		border: none;
		background: transparent;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--red-600, #dc2626);
		cursor: pointer;
	}
	:global(.am-girar) {
		animation: am-girar 0.9s linear infinite;
	}
	@keyframes am-girar {
		to {
			transform: rotate(360deg);
		}
	}
</style>
