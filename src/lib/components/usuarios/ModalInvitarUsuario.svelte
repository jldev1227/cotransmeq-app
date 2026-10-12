<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Loader2, Send } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import FormularioUsuario from './FormularioUsuario.svelte';
	import SelectorAreas from './SelectorAreas.svelte';
	import { apiClient } from '$lib/api/apiClient';

	/**
	 * Invitar a alguien por correo: la persona elige su contraseña al aceptar.
	 * `POST /api/invitaciones`, igual que antes de salir de la página.
	 */
	interface Props {
		open: boolean;
		oncerrar: () => void;
		/** Tras enviarla: la página recarga sus invitaciones. */
		onenviada: () => void;
	}

	let { open, oncerrar, onenviada }: Props = $props();

	const idForm = `invitar-usuario-${Math.random().toString(36).slice(2, 8)}`;

	let enviando = $state(false);
	let correo = $state('');
	let areas = $state<string[]>([]);
	let cargo = $state('');
	let error = $state('');

	/// Cada apertura empieza en blanco, como hacía la página al abrirlo.
	$effect.pre(() => {
		if (!open) return;
		untrack(() => {
			correo = '';
			areas = [];
			cargo = '';
			error = '';
		});
	});

	async function enviar() {
		error = '';
		if (!correo) {
			error = 'Ingresa un correo';
			return;
		}
		if (areas.length === 0) {
			error = 'Selecciona al menos un área';
			return;
		}
		try {
			enviando = true;
			await apiClient.post('/api/invitaciones', {
				correo,
				area: areas,
				cargo: cargo || undefined
			});
			toast.success('Invitación enviada');
			oncerrar();
			onenviada();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Error enviando invitación';
		} finally {
			enviando = false;
		}
	}
</script>

<ModalBase
	{open}
	tamano="md"
	eyebrow="Nueva invitación"
	title="Invitar usuario"
	cerrarAlFondo={false}
	bloqueado={enviando}
	{oncerrar}
>
	<FormularioUsuario id={idForm} onenviar={enviar} {error}>
		<Campo id="{idForm}-correo" label="Correo electrónico" requerido>
			<input
				id="{idForm}-correo"
				type="email"
				bind:value={correo}
				class="uf-input"
				placeholder="usuario@empresa.com"
			/>
		</Campo>
		<Campo id="{idForm}-cargo" label="Cargo (opcional)">
			<input
				id="{idForm}-cargo"
				type="text"
				bind:value={cargo}
				class="uf-input"
				placeholder="Ej: Coordinador de operaciones"
			/>
		</Campo>
		<SelectorAreas seleccion={areas} onCambiar={(a) => (areas = a)} requerido />
	</FormularioUsuario>

	{#snippet pie()}
		<button type="button" class="btn-secondary" disabled={enviando} onclick={oncerrar}>
			Cancelar
		</button>
		<button type="submit" form={idForm} class="btn-primary" disabled={enviando}>
			{#if enviando}
				<Loader2 class="animate-spin" aria-hidden="true" />
				Enviando…
			{:else}
				<Send strokeWidth={2} aria-hidden="true" />
				Enviar invitación
			{/if}
		</button>
	{/snippet}
</ModalBase>
