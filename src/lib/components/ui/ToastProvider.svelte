<script lang="ts">
	import { Toaster } from 'svelte-sonner';
	import { Check, Info, LoaderCircle, TriangleAlert, X } from 'lucide-svelte';
	import { enUniverShell } from '$lib/stores/univerShell';
	import { hayFormularioAbierto } from '$lib/stores/formularioAbierto';

	/**
	 * Único `<Toaster>` de la app, montado en el layout raíz.
	 *
	 * Abajo al centro en todas las pantallas: es la franja que menos se usa —
	 * arriba están el header, el buscador y, en los canvas, los selectores y el
	 * indicador de autoguardado— y queda a la vista sin importar de qué lado
	 * esté lo que uno mira. Montar más de uno duplicaría cada aviso: svelte-sonner
	 * pinta la misma cola en todas sus instancias.
	 *
	 * El aspecto sigue al de los diálogos de confirmación (verde profundo de la
	 * marca, esquinas amplias), sin mascota: un aviso que aparece varias veces
	 * por minuto no debe pesar tanto como una confirmación.
	 */

	/// En los canvas, los 24 px por defecto dejarían el toast ENCIMA de la barra
	/// de pestañas y del zoom, que es con lo que se navega entre hojas.
	const offset = $derived($enUniverShell ? { bottom: 52 } : { bottom: 24 });

	/// En móvil el formulario de directorio es una hoja pegada abajo, con su
	/// pie de botones donde caen los toasts: mientras esté abierto, suben.
	const mobileOffset = $derived({ bottom: $hayFormularioAbierto ? 88 : 16, left: 16, right: 16 });
</script>

<Toaster
	position="bottom-center"
	{offset}
	{mobileOffset}
	gap={10}
	visibleToasts={4}
	closeButton
	toastOptions={{ class: 'tm-toast' }}
>
	<!-- Íconos de trazo propios: los de sonner son círculos rellenos y,
	     dentro del círculo de color, se veían como un círculo dentro de otro
	     y descentrados. -->
	{#snippet successIcon()}<Check size={16} strokeWidth={3} />{/snippet}
	{#snippet errorIcon()}<X size={16} strokeWidth={3} />{/snippet}
	{#snippet warningIcon()}<TriangleAlert size={15} strokeWidth={2.5} />{/snippet}
	{#snippet infoIcon()}<Info size={16} strokeWidth={2.5} />{/snippet}
	{#snippet loadingIcon()}<LoaderCircle
			size={16}
			strokeWidth={2.5}
			class="tm-toast-spin"
		/>{/snippet}
	{#snippet closeIcon()}<X size={12} strokeWidth={2.5} />{/snippet}
</Toaster>

<style>
	/* Los selectores repiten `[data-styled='true']` para ganarle en
	   especificidad a los estilos base de svelte-sonner sin `!important`. */
	:global([data-sonner-toast][data-styled='true'].tm-toast) {
		--tm-icono: #fdba74;
		--tm-icono-bg: rgba(253, 186, 116, 0.16);
		align-items: flex-start;
		gap: 12px;
		padding: 14px 16px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 18px;
		background: var(--bg-charcoal-deep);
		color: #fff;
		box-shadow:
			0 16px 40px rgba(0, 29, 23, 0.28),
			0 2px 8px rgba(0, 0, 0, 0.08);
		font-family: inherit;
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast[data-type='success']) {
		--tm-icono: #86efac;
		--tm-icono-bg: rgba(134, 239, 172, 0.14);
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast[data-type='error']) {
		--tm-icono: #fca5a5;
		--tm-icono-bg: rgba(252, 165, 165, 0.16);
		/* El error se distingue de un vistazo sin volverse una alarma roja. */
		box-shadow:
			inset 3px 0 0 #f87171,
			0 16px 40px rgba(0, 29, 23, 0.28),
			0 2px 8px rgba(0, 0, 0, 0.08);
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast[data-type='warning']) {
		--tm-icono: #fcd34d;
		--tm-icono-bg: rgba(252, 211, 77, 0.16);
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast[data-type='info']) {
		--tm-icono: #93c5fd;
		--tm-icono-bg: rgba(147, 197, 253, 0.16);
	}

	:global([data-sonner-toast][data-styled='true'].tm-toast [data-icon]) {
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		margin: -3px 0 0;
		border-radius: 999px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--tm-icono);
		background: var(--tm-icono-bg);
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast [data-icon] svg) {
		flex-shrink: 0;
		margin: 0;
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast[data-type='loading']) {
		--tm-icono: #fff;
		--tm-icono-bg: rgba(255, 255, 255, 0.12);
	}
	:global(.tm-toast-spin) {
		animation: tm-toast-giro 0.8s linear infinite;
	}
	@keyframes -global-tm-toast-giro {
		to {
			transform: rotate(360deg);
		}
	}

	:global([data-sonner-toast][data-styled='true'].tm-toast [data-content]) {
		gap: 3px;
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast [data-title]) {
		color: #fff;
		font-family: var(--font-display);
		font-size: 14px;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: -0.01em;
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast [data-description]) {
		color: rgba(255, 255, 255, 0.72);
		font-size: 13px;
		line-height: 1.45;
	}

	/* Acción principal: botón claro, igual de legible en cualquier tipo. */
	:global([data-sonner-toast][data-styled='true'].tm-toast [data-button]) {
		height: 30px;
		padding: 0 12px;
		border-radius: 10px;
		background: #fff;
		color: var(--bg-charcoal-deep);
		font-size: 12.5px;
		font-weight: 800;
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast [data-cancel]) {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}

	:global([data-sonner-toast][data-styled='true'].tm-toast [data-close-button]) {
		border: 1px solid rgba(255, 255, 255, 0.16);
		background: var(--bg-charcoal-deep);
		color: rgba(255, 255, 255, 0.8);
	}
	:global([data-sonner-toast][data-styled='true'].tm-toast:hover [data-close-button]:hover) {
		background: #fff;
		border-color: #fff;
		color: var(--bg-charcoal-deep);
	}
</style>
