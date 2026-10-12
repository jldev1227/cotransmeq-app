<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import { usuariosAPI, type Usuario } from '$lib/api/usuarios';
	import { authStore } from '$lib/stores/auth';

	/**
	 * Permisos por módulo de un usuario (`usuarios.permisos`): un interruptor
	 * por módulo y «habilitar / deshabilitar todos».
	 *
	 * Mismo contenido y misma llamada (`actualizarPermisos`) que el modal que
	 * vivía dentro de la página. Si el editado es quien está conectado, se
	 * refresca también su sesión para que el menú cambie sin recargar.
	 */
	interface Props {
		open: boolean;
		usuario: Usuario | null;
		oncerrar: () => void;
		onguardado: (usuario: Usuario) => void;
	}

	let { open, usuario, oncerrar, onguardado }: Props = $props();

	const MODULOS = [
		{ id: 'flota', label: 'Flota' },
		{ id: 'conductores', label: 'Conductores' },
		{ id: 'servicios', label: 'Servicios' },
		{ id: 'recargos', label: 'Recargos' },
		{ id: 'clientes', label: 'Clientes' },
		{ id: 'asistencias', label: 'Asistencias' },
		{ id: 'acciones-correctivas', label: 'Acciones C/P' },
		{ id: 'evaluaciones', label: 'Evaluaciones' },
		{ id: 'nomina', label: 'Nómina' },
		{ id: 'usuarios', label: 'Usuarios' }
	];

	let usuarioId = $state('');
	let nombre = $state('');
	let permisos = $state<Record<string, boolean>>({});
	let guardando = $state(false);

	/// Al abrir se completa la lista con TODOS los módulos (los que el usuario
	/// no tiene, en `false`): así el guardado manda el mapa entero y no solo
	/// los que ya venían marcados.
	$effect.pre(() => {
		if (!open || !usuario) return;
		const u = usuario;
		untrack(() => {
			const completos: Record<string, boolean> = {};
			for (const m of MODULOS) completos[m.id] = u.permisos?.[m.id] ?? false;
			usuarioId = u.id;
			nombre = u.nombre;
			permisos = completos;
		});
	});

	function alternar(id: string) {
		permisos = { ...permisos, [id]: !permisos[id] };
	}

	function todos(valor: boolean) {
		const siguientes: Record<string, boolean> = {};
		for (const m of MODULOS) siguientes[m.id] = valor;
		permisos = siguientes;
	}

	async function guardar() {
		if (!usuarioId) return;
		guardando = true;
		try {
			const actualizado = await usuariosAPI.actualizarPermisos(usuarioId, permisos);
			onguardado(actualizado);
			if ($authStore.user && usuarioId === $authStore.user.id)
				authStore.updateUserPermisos(permisos as any);
			toast.success(`Permisos de ${nombre} actualizados`);
			oncerrar();
		} catch {
			toast.error('Error al guardar permisos');
		} finally {
			guardando = false;
		}
	}
</script>

<ModalBase
	{open}
	tamano="md"
	eyebrow="Permisos por módulo"
	title={nombre}
	cerrarAlFondo={false}
	bloqueado={guardando}
	{oncerrar}
>
	<div class="pm">
		<div class="pm-rapidas">
			<span class="pm-rapidas-etiqueta">Acciones rápidas</span>
			<div class="pm-rapidas-botones">
				<button type="button" class="pm-rapida" disabled={guardando} onclick={() => todos(true)}>
					Habilitar todos
				</button>
				<button type="button" class="pm-rapida" disabled={guardando} onclick={() => todos(false)}>
					Deshabilitar todos
				</button>
			</div>
		</div>

		<div class="pm-rejilla">
			{#each MODULOS as m (m.id)}
				{@const activo = permisos[m.id] === true}
				<button
					type="button"
					class="pm-fila"
					class:pm-fila--activa={activo}
					role="switch"
					aria-checked={activo}
					disabled={guardando}
					onclick={() => alternar(m.id)}
				>
					<span class="pm-fila-etiqueta">{m.label}</span>
					<span class="pm-interruptor" class:pm-interruptor--on={activo} aria-hidden="true">
						<span class="pm-perilla"></span>
					</span>
				</button>
			{/each}
		</div>
	</div>

	{#snippet pie()}
		<button type="button" class="btn-secondary" disabled={guardando} onclick={oncerrar}>
			Cancelar
		</button>
		<button type="button" class="btn-primary" disabled={guardando} onclick={guardar}>
			{#if guardando}<Loader2 class="animate-spin" aria-hidden="true" />{/if}
			Guardar permisos
		</button>
	{/snippet}
</ModalBase>

<style>
	.pm {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.pm-rapidas {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.75rem 1rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
	}
	.pm-rapidas-etiqueta {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
	}
	.pm-rapidas-botones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.pm-rapida {
		min-height: 34px;
		padding: 0 0.8rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}
	.pm-rapida:hover:not(:disabled) {
		background: var(--bg-base);
		border-color: var(--border-emphasis);
	}
	.pm-rapida:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Rejilla fluida: dos columnas en el modal de escritorio, una en el móvil. */
	.pm-rejilla {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.5rem;
	}
	.pm-fila {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 48px;
		padding: 0.65rem 0.9rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}
	.pm-fila:hover:not(:disabled) {
		border-color: var(--border-emphasis);
	}
	.pm-fila:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}
	.pm-fila:disabled {
		cursor: not-allowed;
		opacity: 0.7;
	}
	.pm-fila--activa {
		background: var(--au-tint, #ddf7ea);
		border-color: var(--emerald-500);
	}
	.pm-fila-etiqueta {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	/* El mismo interruptor de la columna «Habilitado» de la lista. */
	.pm-interruptor {
		position: relative;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		width: 36px;
		height: 20px;
		border-radius: 999px;
		background: #d1d5db;
		transition: background 0.2s;
	}
	.pm-interruptor--on {
		background: var(--accion);
	}
	.pm-perilla {
		position: absolute;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		transition: transform 0.2s;
	}
	.pm-interruptor--on .pm-perilla {
		transform: translateX(16px);
	}
</style>
