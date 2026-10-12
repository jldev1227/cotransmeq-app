<script lang="ts">
	import ModalDetalle from '$lib/components/directorio/ModalDetalle.svelte';
	import Dato from '$lib/components/directorio/Dato.svelte';
	import { vehiculosAPI } from '$lib/api/apiClient';
	import { errorDeApi, avisarErrorGuardado } from '$lib/components/directorio/formulario';
	import DocumentosVehiculo from './DocumentosVehiculo.svelte';
	import MantenimientoVehiculo from '$lib/components/mantenimiento/MantenimientoVehiculo.svelte';
	import { authStore } from '$lib/stores/auth';
	import VisorDocumentoVehiculo from './VisorDocumentoVehiculo.svelte';
	import type { DocumentoVehiculo } from '$lib/api/vehiculosDocumentos';

	/** Ficha de consulta de un vehículo, con el estilo de la app móvil. */
	interface Props {
		open: boolean;
		vehiculoId: string | null;
		onclose: () => void;
		/** Sin él no se ofrece «Editar» (usuario de solo lectura). */
		oneditar?: (id: string) => void;
		/** Pestaña con la que abre (p. ej. `documentos` desde un aviso de vencimiento). */
		tabInicial?: string;
	}

	let { open, vehiculoId, onclose, oneditar, tabInicial = 'general' }: Props = $props();

	/// Documento abierto en el visor, encima de la ficha.
	let visor = $state<{ doc: DocumentoVehiculo; titulo: string } | null>(null);

	const ESTADOS: Record<string, { etiqueta: string; color: string }> = {
		disponible: { etiqueta: 'Disponible', color: '#4ade80' },
		programado: { etiqueta: 'Programado', color: '#c4b5fd' },
		servicio: { etiqueta: 'En servicio', color: '#93c5fd' },
		mantenimiento: { etiqueta: 'En mantenimiento', color: '#fcd34d' },
		inactivo: { etiqueta: 'Inactivo', color: '#cbd5e1' },
		desvinculado: { etiqueta: 'Desvinculado', color: '#fca5a5' }
	};

	/// La pestaña Mantenimiento solo para quien tiene ese módulo: la ficha la
	/// ve todo el mundo (`flota` es general) y la API respondería 403.
	const nivelMantenimiento = $derived(
		$authStore.user ? authStore.getAccessLevel('mantenimiento') : null
	);

	let v = $state<any>(null);
	let cargando = $state(false);
	let tab = $state('general');

	$effect(() => {
		if (!open || !vehiculoId) return;
		tab = tabInicial;
		void cargar(vehiculoId);
	});

	async function cargar(id: string) {
		cargando = true;
		v = null;
		try {
			v = (await vehiculosAPI.getById(id)).data.data;
		} catch (e) {
			avisarErrorGuardado(errorDeApi(e, 'No se pudo cargar el vehículo.').mensaje, false);
			onclose();
		} finally {
			cargando = false;
		}
	}

	const km = (n: unknown) =>
		n == null || n === '' ? null : `${Number(n).toLocaleString('es-CO')} km`;
	const conductor = $derived(
		v?.conductores ? `${v.conductores.nombre ?? ''} ${v.conductores.apellido ?? ''}`.trim() : null
	);
</script>

<ModalDetalle
	{open}
	eyebrow="VEHÍCULO"
	title={v?.placa ?? 'Vehículo'}
	iniciales={v?.placa
		? String(v.placa)
				.replace(/[^A-Za-z]/g, '')
				.slice(0, 3)
		: null}
	subtitle={v ? [v.marca, v.linea, v.modelo].filter(Boolean).join(' · ') || null : null}
	estado={v ? (ESTADOS[String(v.estado).toLowerCase()] ?? null) : null}
	tabs={[
		{ id: 'general', label: 'General' },
		{ id: 'tecnico', label: 'Ficha técnica' },
		{ id: 'propietario', label: 'Propietario' },
		{ id: 'documentos', label: 'Documentos' },
		...(nivelMantenimiento ? [{ id: 'mantenimiento', label: 'Mantenimiento' }] : [])
	]}
	bind:tabActiva={tab}
	{cargando}
	oncerrar={onclose}
>
	{#snippet children(activa)}
		{#if v}
			<div class="md-grid">
				{#if activa === 'general'}
					<Dato etiqueta="Placa" valor={v.placa} mono />
					<Dato etiqueta="Clase" valor={v.clase_vehiculo} />
					<Dato etiqueta="Marca" valor={v.marca} />
					<Dato etiqueta="Línea" valor={v.linea} />
					<Dato etiqueta="Modelo" valor={v.modelo} mono />
					<Dato etiqueta="Color" valor={v.color} />
					<Dato etiqueta="Conductor asignado" valor={conductor} completo />
				{:else if activa === 'tecnico'}
					<Dato etiqueta="Tipo de carrocería" valor={v.tipo_carroceria} />
					<Dato etiqueta="Combustible" valor={v.combustible} />
					<Dato etiqueta="Número de motor" valor={v.numero_motor} mono />
					<Dato etiqueta="VIN" valor={v.vin} mono />
					<Dato etiqueta="Número de serie" valor={v.numero_serie} mono />
					<Dato etiqueta="Número de chasis" valor={v.numero_chasis} mono />
					<Dato etiqueta="Kilometraje" valor={km(v.kilometraje)} mono />
					<Dato etiqueta="Fecha de matrícula" valor={v.fecha_matricula} />
				{:else if activa === 'documentos'}
					<!-- Fuera de la rejilla de datos: ocupa todo el ancho. -->
					<div class="md-completo">
						<DocumentosVehiculo
							vehiculoId={v.id}
							puedeEditar={!!oneditar}
							onver={(doc, titulo) => (visor = { doc, titulo })}
						/>
					</div>
				{:else if activa === 'mantenimiento'}
					<div class="md-completo">
						<MantenimientoVehiculo
							vehiculoId={v.id}
							puedeEscribir={nivelMantenimiento === 'full'}
						/>
					</div>
				{:else}
					<Dato etiqueta="Propietario" valor={v.propietario_nombre} completo />
					<Dato etiqueta="Identificación" valor={v.propietario_identificacion} mono />
				{/if}
			</div>
		{/if}
	{/snippet}

	{#snippet acciones()}
		{#if oneditar && vehiculoId}
			<button type="button" class="btn-primary" onclick={() => oneditar(vehiculoId)}>
				Editar vehículo
			</button>
		{/if}
	{/snippet}
</ModalDetalle>

<VisorDocumentoVehiculo
	{vehiculoId}
	doc={visor?.doc ?? null}
	titulo={visor?.titulo ?? ''}
	oncerrar={() => (visor = null)}
/>

<style>
	.md-completo {
		grid-column: 1 / -1;
	}
</style>
