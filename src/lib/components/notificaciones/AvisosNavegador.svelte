<script lang="ts">
	/**
	 * Interruptor de «avisos en este dispositivo» (Web Push), arriba del
	 * historial de notificaciones.
	 *
	 * Es por navegador, no por cuenta: activarlo en la oficina no lo activa en
	 * el portátil. Por eso el texto dice «este dispositivo».
	 */
	import { onMount } from 'svelte';
	import { BellRing, BellOff, Send } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import {
		activarWebPush,
		desactivarWebPush,
		estadoWebPush,
		probarWebPush,
		type EstadoWebPush
	} from '$lib/notificaciones/webPush';

	let estado = $state<EstadoWebPush | null>(null);
	let ocupado = $state(false);

	onMount(async () => {
		estado = await estadoWebPush();
	});

	async function activar() {
		ocupado = true;
		try {
			estado = await activarWebPush();
			if (estado === 'activo') toast.success('Avisos activados en este dispositivo');
			else if (estado === 'bloqueado') toast.error('El navegador bloqueó las notificaciones');
		} catch (err) {
			toast.error('No se pudieron activar', {
				description: err instanceof Error ? err.message : undefined
			});
		} finally {
			ocupado = false;
		}
	}

	async function desactivar() {
		ocupado = true;
		try {
			estado = await desactivarWebPush();
		} finally {
			ocupado = false;
		}
	}

	async function probar() {
		ocupado = true;
		try {
			const r = await probarWebPush();
			if (r.enviados > 0) {
				toast.success('Prueba enviada', {
					description:
						'Debe aparecer en unos segundos. Si no sale, revisa que macOS/Windows permita las notificaciones de Chrome.'
				});
			} else toast.error('No llegó a ningún navegador');
		} catch (err) {
			toast.error('No se pudo enviar la prueba', {
				description: err instanceof Error ? err.message : undefined
			});
		} finally {
			ocupado = false;
		}
	}
</script>

{#if estado && estado !== 'no-soportado' && estado !== 'no-configurado'}
	<div class="av" class:av--activo={estado === 'activo'}>
		<span class="av-icono" aria-hidden="true">
			{#if estado === 'activo'}<BellRing size={16} />{:else}<BellOff size={16} />{/if}
		</span>
		<span class="av-texto">
			{#if estado === 'activo'}
				<strong>Avisos activos en este dispositivo</strong>
				<small>Te llegan aunque no tengas la app abierta.</small>
			{:else if estado === 'bloqueado'}
				<strong>Notificaciones bloqueadas</strong>
				<small>Permítelas desde el candado de la barra de direcciones y recarga.</small>
			{:else}
				<strong>Recibe estos avisos en tu equipo</strong>
				<small>Como notificación del sistema, aunque no tengas la app abierta.</small>
			{/if}
		</span>
		<span class="av-acciones">
			{#if estado === 'activo'}
				<button type="button" class="av-btn" onclick={probar} disabled={ocupado} title="Enviar una prueba">
					<Send size={14} /> Probar
				</button>
				<button type="button" class="av-btn av-btn--sutil" onclick={desactivar} disabled={ocupado}>
					Desactivar
				</button>
			{:else if estado === 'inactivo'}
				<button type="button" class="av-btn av-btn--primario" onclick={activar} disabled={ocupado}>
					Activar
				</button>
			{/if}
		</span>
	</div>
{/if}

<style>
	.av {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 12px 16px 4px;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.av--activo {
		border-color: color-mix(in srgb, var(--emerald-500) 35%, var(--border-subtle));
	}
	.av-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: var(--bg-base);
		color: var(--text-muted);
	}
	.av--activo .av-icono {
		color: var(--emerald-600);
		background: color-mix(in srgb, var(--emerald-500) 12%, var(--bg-surface));
	}
	.av-texto {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.av-texto strong {
		font-size: 0.84rem;
		color: var(--text-primary);
	}
	.av-texto small {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.av-acciones {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.av-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 10px;
		border-radius: 9px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
	}
	.av-btn:hover:not(:disabled) {
		background: var(--bg-base);
	}
	.av-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.av-btn--primario {
		border-color: var(--emerald-600);
		background: var(--emerald-600);
		color: #fff;
	}
	.av-btn--primario:hover:not(:disabled) {
		background: var(--emerald-700, var(--emerald-600));
	}
	.av-btn--sutil {
		border-color: transparent;
		background: transparent;
		color: var(--text-muted);
	}
	@media (max-width: 520px) {
		.av {
			flex-wrap: wrap;
		}
		.av-acciones {
			width: 100%;
			justify-content: flex-end;
		}
	}
</style>
