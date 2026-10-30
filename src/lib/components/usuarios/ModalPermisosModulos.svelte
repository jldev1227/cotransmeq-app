<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Loader2 } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import PermisosRutasPicker from '$lib/components/permisos/PermisosRutasPicker.svelte';
	import { usuariosAPI, type Usuario } from '$lib/api/usuarios';
	import type { AccessLevel } from '$lib/config/permissions';

	interface Props {
		open: boolean;
		usuario: Usuario | null;
		oncerrar: () => void;
		onguardado: (usuario: Usuario) => void;
	}

	let { open, usuario, oncerrar, onguardado }: Props = $props();

	let usuarioId = $state('');
	let nombre = $state('');
	let areas = $state<string[]>([]);
	let permisosRutas = $state<Record<string, AccessLevel> | null>(null);
	let apertura = $state(0);
	let guardando = $state(false);

	$effect.pre(() => {
		if (!open || !usuario) return;
		const u = usuario;
		untrack(() => {
			usuarioId = u.id;
			nombre = u.nombre;
			areas = Array.isArray(u.area) ? [...u.area] : u.area ? [u.area as string] : [];
			permisosRutas = u.permisos_rutas ?? null;
			apertura += 1;
		});
	});

	async function guardar() {
		if (!usuarioId || guardando) return;
		guardando = true;
		try {
			const actualizado = await usuariosAPI.actualizar(usuarioId, {
				permisos_rutas: permisosRutas
			});
			onguardado(actualizado);
			toast.success(`Permisos de ${nombre} actualizados`);
			oncerrar();
		} catch (err: any) {
			toast.error(err?.response?.data?.error || 'No se pudieron guardar los permisos');
		} finally {
			guardando = false;
		}
	}
</script>

<ModalBase
	{open}
	tamano="lg"
	eyebrow="Permisos por ruta"
	title={nombre || 'Permisos del usuario'}
	cerrarAlFondo={false}
	bloqueado={guardando}
	{oncerrar}
>
	<p class="pm-ayuda">
		Los accesos parten de las áreas asignadas. Puedes limitar las rutas de esta persona, sin superar
		los permisos que le conceden sus áreas.
	</p>
	{#key apertura}
		<PermisosRutasPicker
			idPrefix="personal"
			{areas}
			userId={usuarioId}
			valor={permisosRutas}
			onchange={(valor) => (permisosRutas = valor)}
		/>
	{/key}

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
	.pm-ayuda {
		margin: 0 0 1rem;
		color: var(--text-secondary);
		font-size: 0.82rem;
		line-height: 1.5;
	}
</style>
