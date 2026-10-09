<script lang="ts">
	/**
	 * Alta y edición de un contratante del catálogo de extractos: contrato,
	 * NIT y el responsable que firma por él. Lo que se cambia aquí sale en los
	 * extractos que se emitan después; los ya emitidos no se tocan.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import { extractosAPI, type Contratante } from '$lib/api/extractos';

	interface Props {
		open: boolean;
		contratante: Contratante | null;
		oncerrar: () => void;
		onguardado: (c: Contratante) => void;
	}
	let { open, contratante, oncerrar, onguardado }: Props = $props();

	let nombre = $state('');
	let nit = $state('');
	let contrato = $state('');
	let rNombre = $state('');
	let rCedula = $state('');
	let rTelefono = $state('');
	let rDireccion = $state('');
	let enviando = $state(false);

	$effect(() => {
		if (!open) return;
		untrack(() => {
			nombre = contratante?.nombre ?? '';
			nit = contratante?.nit ?? '';
			contrato = contratante?.numero_contrato ?? '';
			rNombre = contratante?.responsable.nombre ?? '';
			rCedula = contratante?.responsable.cedula ?? '';
			rTelefono = contratante?.responsable.telefono ?? '';
			rDireccion = contratante?.responsable.direccion ?? '';
		});
	});
	const valido = $derived(nombre.trim().length >= 2);

	async function guardar() {
		if (!valido || enviando) return;
		enviando = true;
		try {
			const input = {
				nombre: nombre.trim(),
				nit: nit.trim() || null,
				numero_contrato: contrato.trim() || null,
				responsable: {
					nombre: rNombre.trim() || null,
					cedula: rCedula.trim() || null,
					telefono: rTelefono.trim() || null,
					direccion: rDireccion.trim() || null
				}
			};
			const r = contratante
				? await extractosAPI.guardarContratante(contratante.id, input)
				: await extractosAPI.crearContratante(input);
			onguardado(r);
			oncerrar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo guardar');
		} finally {
			enviando = false;
		}
	}
</script>

<ModalBase
	{open}
	title={contratante ? 'Editar contratante' : 'Nuevo contratante'}
	eyebrow="CATÁLOGO DE EXTRACTOS"
	tamano="md"
	bloqueado={enviando}
	{oncerrar}
>
	<form
		class="mc"
		onsubmit={(e) => {
			e.preventDefault();
			void guardar();
		}}
	>
		<label class="mc-campo mc-ancho"
			><span>Nombre <b>*</b></span><input
				class="mc-input"
				bind:value={nombre}
				maxlength="255"
			/></label
		>
		<label class="mc-campo"
			><span>NIT</span><input class="mc-input" bind:value={nit} maxlength="50" /></label
		>
		<label class="mc-campo"
			><span>Contrato No.</span><input
				class="mc-input"
				bind:value={contrato}
				maxlength="40"
			/></label
		>
		<h3 class="mc-ancho">Responsable del contratante</h3>
		<label class="mc-campo mc-ancho"
			><span>Nombres y apellidos</span><input
				class="mc-input"
				bind:value={rNombre}
				maxlength="255"
			/></label
		>
		<label class="mc-campo"
			><span>Cédula</span><input class="mc-input" bind:value={rCedula} maxlength="50" /></label
		>
		<label class="mc-campo"
			><span>Teléfono</span><input class="mc-input" bind:value={rTelefono} maxlength="50" /></label
		>
		<label class="mc-campo mc-ancho"
			><span>Dirección</span><input
				class="mc-input"
				bind:value={rDireccion}
				maxlength="255"
			/></label
		>
	</form>
	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={oncerrar} disabled={enviando}
			>Cancelar</button
		>
		<button type="button" class="btn-primary" onclick={guardar} disabled={!valido || enviando}
			>{enviando ? 'Guardando…' : 'Guardar'}</button
		>
	{/snippet}
</ModalBase>

<style>
	.mc {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.mc-ancho {
		grid-column: span 2;
	}
	.mc h3 {
		margin: 6px 0 0;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.mc-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.mc-campo span {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.mc-campo b {
		color: #dc2626;
	}
	.mc-input {
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
	}
	.mc-input:focus {
		outline: none;
		border-color: var(--au-primary);
		box-shadow: 0 0 0 3px var(--au-tint);
	}
</style>
