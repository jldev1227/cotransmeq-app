<script lang="ts">
	import ModalDetalle from '$lib/components/directorio/ModalDetalle.svelte';
	import Dato from '$lib/components/directorio/Dato.svelte';
	import { clientesAPI } from '$lib/api/apiClient';
	import { errorDeApi, avisarErrorGuardado } from '$lib/components/directorio/formulario';

	/**
	 * Ficha de consulta de un cliente, con el estilo de la app móvil. Los
	 * servicios y la actividad siguen en la ficha completa.
	 */
	interface Props {
		open: boolean;
		clienteId: string | null;
		onclose: () => void;
		oneditar?: (id: string) => void;
	}

	let { open, clienteId, onclose, oneditar }: Props = $props();

	let c = $state<any>(null);
	let cargando = $state(false);
	let tab = $state('identificacion');

	$effect(() => {
		if (!open || !clienteId) return;
		tab = 'identificacion';
		void cargar(clienteId);
	});

	async function cargar(id: string) {
		cargando = true;
		c = null;
		try {
			const r = (await clientesAPI.getById(id)).data;
			c = r?.data ?? r;
		} catch (e) {
			avisarErrorGuardado(errorDeApi(e, 'No se pudo cargar el cliente.').mensaje, false);
			onclose();
		} finally {
			cargando = false;
		}
	}

	const esEmpresa = $derived(c?.tipo === 'EMPRESA');
	const siNo = (v: unknown) => (v ? 'Sí' : 'No');
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
	eyebrow={c ? (esEmpresa ? 'CLIENTE · EMPRESA' : 'CLIENTE · PERSONA NATURAL') : 'CLIENTE'}
	title={c?.nombre ?? 'Cliente'}
	subtitle={c?.nit ? `${esEmpresa ? 'NIT' : 'C.C.'} ${c.nit}` : null}
	tabs={[
		{ id: 'identificacion', label: 'Identificación' },
		{ id: 'contacto', label: 'Contacto' },
		{ id: 'condiciones', label: 'Condiciones' }
	]}
	bind:tabActiva={tab}
	{cargando}
	oncerrar={onclose}
>
	{#snippet children(activa)}
		{#if c}
			<div class="md-grid">
				{#if activa === 'identificacion'}
					<Dato etiqueta="Tipo" valor={esEmpresa ? 'Empresa' : 'Persona natural'} />
					<Dato etiqueta={esEmpresa ? 'NIT' : 'Documento'} valor={c.nit} mono />
					{#if esEmpresa}
						<Dato etiqueta="Representante legal" valor={c.representante} completo />
					{:else}
						<Dato etiqueta="Cédula" valor={c.cedula} mono />
					{/if}
					<Dato etiqueta="Registrado" valor={fecha(c.createdAt ?? c.created_at)} />
				{:else if activa === 'contacto'}
					<Dato etiqueta="Teléfono" valor={c.telefono} mono />
					<Dato etiqueta="Correo electrónico" valor={c.correo} />
					<Dato etiqueta="Dirección" valor={c.direccion} completo />
				{:else}
					<Dato etiqueta="Requiere OSI" valor={siNo(c.requiere_osi)} />
					<Dato etiqueta="Paga recargos" valor={siNo(c.paga_recargos)} />
					{#if c._count}
						<Dato etiqueta="Servicios" valor={c._count.servicio ?? 0} mono />
						<Dato etiqueta="Recargos" valor={c._count.recargos ?? 0} mono />
					{/if}
				{/if}
			</div>
		{/if}
	{/snippet}

	{#snippet acciones()}
		{#if clienteId}
			<a class="btn-secondary" href={`/dashboard/clientes/${clienteId}`}>Ver ficha completa</a>
			{#if oneditar}
				<button type="button" class="btn-primary" onclick={() => oneditar(clienteId)}>
					Editar cliente
				</button>
			{/if}
		{/if}
	{/snippet}
</ModalDetalle>
