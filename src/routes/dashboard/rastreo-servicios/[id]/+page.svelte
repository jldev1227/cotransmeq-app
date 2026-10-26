<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { ArrowLeft, MapPin } from 'lucide-svelte';
	import { fetchConSesion } from '$lib/api/fetchConSesion';
	import RastreoServicio from '$lib/components/servicios/RastreoServicio.svelte';

	interface ServicioMinimo {
		servicio_id: string;
		numero_planilla: string | null;
		fecha_realizacion: string | null;
		estado_servicio: string;
		estado_actual: 'sin_datos' | 'en_movimiento' | 'detenido' | 'sin_senal';
		ultimo_punto_at: string | null;
	}

	let servicio = $state<ServicioMinimo | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	const servicioId = $derived(page.params.id ?? '');

	const fmtFecha = new Intl.DateTimeFormat('es-CO', {
		timeZone: 'America/Bogota',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});

	function fecha(valor: string | null): string {
		if (!valor) return 'Fecha no registrada';
		const fechaValor = new Date(/^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T12:00:00` : valor);
		return Number.isNaN(fechaValor.getTime()) ? 'Fecha no registrada' : fmtFecha.format(fechaValor);
	}

	function estado(valor: string): string {
		const etiquetas: Record<string, string> = {
			en_curso: 'En curso',
			completado: 'Completado',
			realizado: 'Realizado',
			cancelado: 'Cancelado',
			liquidado: 'Liquidado',
			pendiente: 'Pendiente',
			planificado: 'Planificado'
		};
		return etiquetas[valor] ?? valor.replaceAll('_', ' ');
	}

	$effect(() => {
		const id = servicioId;
		let vigente = true;
		const controlador = new AbortController();
		servicio = null;
		cargando = true;
		error = null;

		void (async () => {
			try {
				const respuesta = await fetchConSesion('/api/rastreo-servicios', {
					signal: controlador.signal
				});
				if (!respuesta.ok) {
					if (respuesta.status === 403)
						throw new Error('No tienes permiso para consultar este recorrido GPS.');
					throw new Error('No encontramos un recorrido disponible para este servicio.');
				}
				const cuerpo = await respuesta.json();
				const lista = cuerpo?.data?.servicios ?? cuerpo?.servicios;
				if (!Array.isArray(lista))
					throw new Error('El servidor respondió con un listado inválido.');
				const encontrado = lista.find((item: ServicioMinimo) => item.servicio_id === id) ?? null;
				servicio = encontrado;
				if (!encontrado)
					error =
						'Este servicio no tiene un recorrido dentro del periodo de conservación de 90 días.';
			} catch (e) {
				if (!vigente || (e instanceof DOMException && e.name === 'AbortError')) return;
				error = e instanceof Error ? e.message : 'No se pudo cargar el servicio.';
			} finally {
				if (vigente) cargando = false;
			}
		})();

		return () => {
			vigente = false;
			controlador.abort();
		};
	});
</script>

<svelte:head>
	<title>Recorrido GPS del servicio</title>
</svelte:head>

<main class="gps-detalle">
	<a class="gps-volver" href={resolve('/dashboard/rastreo-servicios')}
		><ArrowLeft size={17} aria-hidden="true" /> Volver al rastreo GPS</a
	>

	{#if cargando}
		<div class="gps-mensaje" role="status">
			<span class="gps-spinner"></span> Cargando servicio…
		</div>
	{:else if error}
		<div class="gps-mensaje gps-mensaje--error" role="alert">
			<MapPin size={21} aria-hidden="true" />
			<p>{error}</p>
			<small>El acceso y la vigencia del recorrido se comprueban en el servidor.</small>
		</div>
	{:else if servicio}
		<header class="gps-encabezado">
			<div>
				<p class="gps-eyebrow">Vista de rastreo</p>
				<h1>Planilla {servicio.numero_planilla || 'Sin número'}</h1>
				<p>{fecha(servicio.fecha_realizacion)} · Servicio {estado(servicio.estado_servicio)}</p>
			</div>
			<span class="gps-conservacion">Historial de 90 días</span>
		</header>

		<RastreoServicio {servicioId} />
	{/if}
</main>

<style>
	.gps-detalle {
		padding: 1rem 1.25rem 3rem;
	}
	.gps-volver {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.45rem;
		color: #1d4ed8;
		font-size: 0.82rem;
		font-weight: 650;
		text-decoration: none;
	}
	.gps-volver:hover {
		text-decoration: underline;
	}
	.gps-encabezado {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		margin: 0.7rem 0 0.5rem;
	}
	.gps-eyebrow {
		margin: 0 0 0.25rem;
		color: #6b7280;
		font-size: 0.75rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.gps-encabezado h1 {
		margin: 0;
		color: #111827;
		font-size: 1.5rem;
		font-weight: 750;
	}
	.gps-encabezado p:last-child {
		margin: 0.3rem 0 0;
		color: #64748b;
		font-size: 0.82rem;
		text-transform: capitalize;
	}
	.gps-conservacion {
		padding: 0.35rem 0.6rem;
		border-radius: 999px;
		background: #eff6ff;
		color: #1d4ed8;
		font-size: 0.72rem;
		font-weight: 650;
		white-space: nowrap;
	}
	.gps-mensaje {
		display: flex;
		min-height: 12rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1.5rem;
		border: 1px dashed #cbd5e1;
		border-radius: 0.75rem;
		color: #64748b;
		text-align: center;
	}
	.gps-mensaje p,
	.gps-mensaje small {
		margin: 0;
	}
	.gps-mensaje p {
		color: #334155;
		font-size: 0.87rem;
	}
	.gps-mensaje small {
		font-size: 0.75rem;
	}
	.gps-mensaje--error {
		color: #991b1b;
	}
	.gps-spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid #dbeafe;
		border-top-color: #2563eb;
		border-radius: 50%;
		animation: giro 0.8s linear infinite;
	}
	@keyframes giro {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 640px) {
		.gps-detalle {
			padding: 0.75rem 0.65rem 2rem;
		}
		.gps-encabezado {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
