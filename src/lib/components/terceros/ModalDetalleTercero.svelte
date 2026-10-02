<script lang="ts">
	import ModalDetalle from '$lib/components/directorio/ModalDetalle.svelte';
	import Dato from '$lib/components/directorio/Dato.svelte';
	import { tercerosAPI } from '$lib/api/terceros';
	import { errorDeApi, avisarErrorGuardado } from '$lib/components/directorio/formulario';

	/** Ficha de consulta de un tercero, con el estilo de la app móvil. */
	interface Props {
		open: boolean;
		terceroId: string | null;
		onclose: () => void;
		oneditar?: (id: string) => void;
	}

	let { open, terceroId, onclose, oneditar }: Props = $props();

	const TIPOS: Record<string, string> = {
		PERSONA: 'Persona natural',
		EMPRESA: 'Empresa',
		PROPIETARIO_VEHICULO: 'Propietario de vehículo',
		PROVEEDOR: 'Proveedor'
	};
	const REGIMENES: Record<string, string> = {
		SIMPLIFICADO: 'Simplificado',
		COMUN: 'Común',
		GRAN_CONTRIBUYENTE: 'Gran contribuyente',
		NO_RESPONSABLE: 'No responsable',
		AUTORRETENEDOR: 'Autorretenedor',
		ORDINARIO: 'Ordinario'
	};

	let t = $state<any>(null);
	let cargando = $state(false);
	let tab = $state('identificacion');

	$effect(() => {
		if (!open || !terceroId) return;
		tab = 'identificacion';
		void cargar(terceroId);
	});

	async function cargar(id: string) {
		cargando = true;
		t = null;
		try {
			t = await tercerosAPI.obtenerPorId(id);
		} catch (e) {
			avisarErrorGuardado(errorDeApi(e, 'No se pudo cargar el tercero.').mensaje, false);
			onclose();
		} finally {
			cargando = false;
		}
	}

	const fecha = (v: unknown) => {
		if (!v) return null;
		const d = new Date(String(v));
		return isNaN(d.getTime())
			? null
			: d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
	};
</script>

<ModalDetalle
	{open}
	eyebrow={t ? `TERCERO · ${(TIPOS[t.tipo_persona] ?? t.tipo_persona).toUpperCase()}` : 'TERCERO'}
	title={t?.nombre_completo?.trim() || 'Tercero sin nombre'}
	subtitle={t?.identificacion ?? (t ? 'Sin identificación' : null)}
	tabs={[
		{ id: 'identificacion', label: 'Identificación' },
		{ id: 'contacto', label: 'Contacto' },
		{ id: 'notas', label: 'Notas' }
	]}
	bind:tabActiva={tab}
	{cargando}
	oncerrar={onclose}
>
	{#snippet children(activa)}
		{#if t}
			<div class="md-grid">
				{#if activa === 'identificacion'}
					<Dato etiqueta="Tipo de tercero" valor={TIPOS[t.tipo_persona] ?? t.tipo_persona} />
					<Dato
						etiqueta={t.tipo_persona === 'EMPRESA' ? 'NIT' : 'Identificación'}
						valor={t.identificacion}
						mono
					/>
					<Dato etiqueta="Régimen fiscal" valor={REGIMENES[t.regimen] ?? t.regimen} />
					<Dato etiqueta="Registrado" valor={fecha(t.created_at)} />
				{:else if activa === 'contacto'}
					<Dato etiqueta="Teléfono" valor={t.telefono} mono />
					<Dato etiqueta="Correo electrónico" valor={t.correo} />
					<Dato etiqueta="Dirección" valor={t.direccion} completo />
				{:else}
					<Dato etiqueta="Notas" valor={t.notas} completo />
				{/if}
			</div>
		{/if}
	{/snippet}

	{#snippet acciones()}
		{#if oneditar && terceroId}
			<button type="button" class="btn-primary" onclick={() => oneditar(terceroId)}>
				Editar tercero
			</button>
		{/if}
	{/snippet}
</ModalDetalle>
