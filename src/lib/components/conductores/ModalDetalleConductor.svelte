<script lang="ts">
	import ModalDetalle from '$lib/components/directorio/ModalDetalle.svelte';
	import Dato from '$lib/components/directorio/Dato.svelte';
	import { conductoresAPI } from '$lib/api/apiClient';
	import { errorDeApi, avisarErrorGuardado } from '$lib/components/directorio/formulario';

	/**
	 * Ficha de consulta de un conductor, con el estilo de la app móvil. La ficha
	 * completa (foto, días laborados, recorridos) sigue en su página.
	 */
	interface Props {
		open: boolean;
		conductorId: string | null;
		onclose: () => void;
		oneditar?: (id: string) => void;
	}

	let { open, conductorId, onclose, oneditar }: Props = $props();

	const ESTADOS: Record<string, { etiqueta: string; color: string }> = {
		activo: { etiqueta: 'Activo', color: '#4ade80' },
		disponible: { etiqueta: 'Disponible', color: '#4ade80' },
		programado: { etiqueta: 'Programado', color: '#c4b5fd' },
		servicio: { etiqueta: 'En servicio', color: '#93c5fd' },
		descanso: { etiqueta: 'Descanso', color: '#a5f3fc' },
		vacaciones: { etiqueta: 'Vacaciones', color: '#7dd3fc' },
		incapacidad: { etiqueta: 'Incapacidad', color: '#fcd34d' },
		suspendido: { etiqueta: 'Suspendido', color: '#fdba74' },
		inactivo: { etiqueta: 'Inactivo', color: '#cbd5e1' },
		retirado: { etiqueta: 'Retirado', color: '#fca5a5' },
		desvinculado: { etiqueta: 'Desvinculado', color: '#fca5a5' }
	};
	const TIPOS_ID: Record<string, string> = {
		CC: 'Cédula de ciudadanía',
		CE: 'Cédula de extranjería',
		PA: 'Pasaporte',
		TI: 'Tarjeta de identidad'
	};
	const SANGRE: Record<string, string> = {
		A_POSITIVO: 'A+',
		A_NEGATIVO: 'A−',
		B_POSITIVO: 'B+',
		B_NEGATIVO: 'B−',
		AB_POSITIVO: 'AB+',
		AB_NEGATIVO: 'AB−',
		O_POSITIVO: 'O+',
		O_NEGATIVO: 'O−'
	};
	const CONTRATOS: Record<string, string> = {
		INDEFINIDO: 'Término indefinido',
		FIJO: 'Término fijo',
		OBRA_LABOR: 'Obra o labor',
		PRESTACION_SERVICIOS: 'Prestación de servicios'
	};

	let c = $state<any>(null);
	let cargando = $state(false);
	let tab = $state('personal');

	$effect(() => {
		if (!open || !conductorId) return;
		tab = 'personal';
		void cargar(conductorId);
	});

	async function cargar(id: string) {
		cargando = true;
		c = null;
		try {
			const r = (await conductoresAPI.getById(id)).data;
			c = r?.data ?? r;
		} catch (e) {
			avisarErrorGuardado(errorDeApi(e, 'No se pudo cargar el conductor.').mensaje, false);
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
	const pesos = (v: unknown) =>
		v == null || v === '' ? null : `$ ${Number(v).toLocaleString('es-CO')}`;
	const titulo = (v: unknown) =>
		v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase() : null;
	const nombre = $derived(c ? `${c.nombre ?? ''} ${c.apellido ?? ''}`.trim() : 'Conductor');
</script>

<ModalDetalle
	{open}
	eyebrow="CONDUCTOR"
	title={nombre}
	subtitle={c ? `${c.tipo_identificacion ?? 'CC'} ${c.numero_identificacion ?? ''}` : null}
	foto={c?.foto_signed_url ?? null}
	estado={c ? (ESTADOS[String(c.estado).toLowerCase()] ?? null) : null}
	tabs={[
		{ id: 'personal', label: 'Personal' },
		{ id: 'laboral', label: 'Laboral' },
		{ id: 'seguridad', label: 'Seguridad social' },
		{ id: 'licencia', label: 'Licencia' }
	]}
	bind:tabActiva={tab}
	{cargando}
	oncerrar={onclose}
>
	{#snippet children(activa)}
		{#if c}
			<div class="md-grid">
				{#if activa === 'personal'}
					<Dato
						etiqueta="Tipo de identificación"
						valor={TIPOS_ID[c.tipo_identificacion] ?? c.tipo_identificacion}
					/>
					<Dato etiqueta="Número de identificación" valor={c.numero_identificacion} mono />
					<Dato etiqueta="Fecha de nacimiento" valor={fecha(c.fecha_nacimiento)} />
					<Dato etiqueta="Género" valor={titulo(c.genero)} />
					<Dato etiqueta="Tipo de sangre" valor={SANGRE[c.tipo_sangre] ?? c.tipo_sangre} />
					<Dato etiqueta="Teléfono" valor={c.telefono} mono />
					<Dato etiqueta="Correo electrónico" valor={c.email} completo />
					<Dato etiqueta="Dirección" valor={c.direccion} completo />
				{:else if activa === 'laboral'}
					<Dato etiqueta="Cargo" valor={c.cargo} />
					<Dato etiqueta="Sede de trabajo" valor={titulo(c.sede_trabajo)} />
					<Dato etiqueta="Fecha de ingreso" valor={fecha(c.fecha_ingreso)} />
					<Dato etiqueta="Tipo de contrato" valor={CONTRATOS[c.tipo_contrato] ?? c.tipo_contrato} />
					<Dato etiqueta="Salario base" valor={pesos(c.salario_base)} mono />
				{:else if activa === 'seguridad'}
					<Dato etiqueta="EPS" valor={c.eps} />
					<Dato etiqueta="Fondo de pensión" valor={c.fondo_pension} />
					<Dato etiqueta="ARL" valor={c.arl} />
				{:else}
					<Dato etiqueta="Categoría" valor={c.categoria_licencia} />
					<Dato etiqueta="Vencimiento" valor={fecha(c.vencimiento_licencia)} />
				{/if}
			</div>
		{/if}
	{/snippet}

	{#snippet acciones()}
		{#if conductorId}
			<a class="btn-secondary" href={`/dashboard/conductores/${conductorId}`}>Ver ficha completa</a>
			{#if oneditar}
				<button type="button" class="btn-primary" onclick={() => oneditar(conductorId)}>
					Editar conductor
				</button>
			{/if}
		{/if}
	{/snippet}
</ModalDetalle>
