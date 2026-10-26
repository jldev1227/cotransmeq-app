<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { MapPin, RefreshCw, Route } from 'lucide-svelte';
	import { fetchConSesion } from '$lib/api/fetchConSesion';

	type EstadoRastreo = 'sin_datos' | 'en_movimiento' | 'detenido' | 'sin_senal';
	interface ServicioRastreo {
		servicio_id: string;
		numero_planilla: string | null;
		fecha_realizacion: string | null;
		estado_servicio: string;
		estado_actual: EstadoRastreo;
		ultimo_punto_at: string | null;
	}

	let servicios = $state<ServicioRastreo[]>([]);
	let busqueda = $state('');
	let cargando = $state(true);
	let actualizando = $state(false);
	let error = $state<string | null>(null);

	const visibles = $derived.by(() => {
		const texto = busqueda.trim().toLocaleLowerCase('es');
		const ordenados = [...servicios].sort((a, b) => {
			const aFecha = Date.parse(a.ultimo_punto_at ?? a.fecha_realizacion ?? '') || 0;
			const bFecha = Date.parse(b.ultimo_punto_at ?? b.fecha_realizacion ?? '') || 0;
			return bFecha - aFecha;
		});
		return texto
			? ordenados.filter((servicio) =>
					(servicio.numero_planilla ?? '').toLocaleLowerCase('es').includes(texto)
				)
			: ordenados;
	});

	const fmt = new Intl.DateTimeFormat('es-CO', {
		timeZone: 'America/Bogota',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

	function fecha(valor: string | null): string {
		if (!valor) return '—';
		const fechaValor = new Date(/^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T12:00:00` : valor);
		return Number.isNaN(fechaValor.getTime()) ? '—' : fmt.format(fechaValor);
	}

	function estado(valor: EstadoRastreo): { texto: string; clase: string } {
		const estados: Record<EstadoRastreo, { texto: string; clase: string }> = {
			sin_datos: { texto: 'Sin datos', clase: 'gps-estado--neutro' },
			en_movimiento: { texto: 'En movimiento', clase: 'gps-estado--movimiento' },
			detenido: { texto: 'Detenido', clase: 'gps-estado--detenido' },
			sin_senal: { texto: 'Sin señal', clase: 'gps-estado--neutro' }
		};
		return estados[valor] ?? estados.sin_datos;
	}

	function estadoServicio(valor: string): string {
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

	async function cargar(): Promise<void> {
		if (servicios.length) actualizando = true;
		else cargando = true;
		error = null;
		try {
			const respuesta = await fetchConSesion('/api/rastreo-servicios');
			if (!respuesta.ok) {
				if (respuesta.status === 403)
					throw new Error('No tienes permiso para consultar los rastreos GPS.');
				throw new Error('No se pudo cargar el listado de rastreos GPS.');
			}
			const cuerpo = await respuesta.json();
			const lista = cuerpo?.data?.servicios ?? cuerpo?.servicios;
			if (!Array.isArray(lista)) throw new Error('El servidor respondió con un listado inválido.');
			servicios = lista;
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo cargar el listado de rastreos GPS.';
		} finally {
			cargando = false;
			actualizando = false;
		}
	}

	onMount(() => void cargar());
</script>

<svelte:head>
	<title>Rastreo GPS de servicios</title>
</svelte:head>

<div class="gps-pagina">
	<header class="gps-cabecera">
		<div>
			<p class="gps-eyebrow">Servicios</p>
			<h1><Route size={23} aria-hidden="true" /> Rastreo GPS</h1>
			<p class="gps-descripcion">
				Consulta recorridos compartidos durante la ejecución de los servicios.
			</p>
		</div>
		<button
			class="gps-refrescar"
			type="button"
			onclick={() => void cargar()}
			disabled={cargando || actualizando}
		>
			<RefreshCw size={16} class={actualizando ? 'girando' : undefined} aria-hidden="true" />
			<span>{actualizando ? 'Actualizando' : 'Actualizar'}</span>
		</button>
	</header>

	<div class="gps-aviso">
		<MapPin size={17} aria-hidden="true" /> La ubicación se comparte con consentimiento; la consultan
		el conductor asignado y personal autorizado de Operaciones, Administración, HSEQ, Mantenimiento y
		Talento Humano. Se conserva durante 90 días.
	</div>

	{#if !cargando && !error && servicios.length > 0}
		<label class="gps-busqueda">
			<span>Buscar por planilla</span>
			<input bind:value={busqueda} placeholder="Número de planilla" autocomplete="off" />
		</label>
	{/if}

	{#if cargando}
		<div class="gps-estado-vacio" role="status">
			<span class="gps-spinner"></span> Cargando servicios con rastreo…
		</div>
	{:else if error}
		<div class="gps-estado-vacio gps-estado-vacio--error" role="alert">
			<p>{error}</p>
			<button type="button" class="gps-reintentar" onclick={() => void cargar()}>Reintentar</button>
		</div>
	{:else if servicios.length === 0}
		<div class="gps-estado-vacio">
			<MapPin size={24} aria-hidden="true" />
			<strong>No hay recorridos disponibles.</strong>
			<p>
				Los servicios aparecen aquí cuando tienen una sesión GPS dentro del periodo de conservación.
			</p>
			<small>El historial GPS se conserva durante 90 días.</small>
		</div>
	{:else if visibles.length === 0}
		<div class="gps-estado-vacio">
			<p>No encontramos planillas que coincidan con “{busqueda}”.</p>
		</div>
	{:else}
		<div class="gps-listado" aria-label="Servicios con rastreo GPS">
			{#each visibles as servicio (servicio.servicio_id)}
				<a
					class="gps-fila"
					href={resolve('/dashboard/rastreo-servicios/[id]', { id: servicio.servicio_id })}
				>
					<span class="gps-fila-icono"><Route size={19} aria-hidden="true" /></span>
					<span class="gps-fila-principal">
						<strong>Planilla {servicio.numero_planilla || 'Sin número'}</strong>
						<small
							>{fecha(servicio.fecha_realizacion)} · Servicio {estadoServicio(
								servicio.estado_servicio
							)}</small
						>
					</span>
					<span class="gps-fila-gps">
						<span class="gps-badge {estado(servicio.estado_actual).clase}"
							>{estado(servicio.estado_actual).texto}</span
						>
						<small>Último punto: {fecha(servicio.ultimo_punto_at)}</small>
					</span>
					<span class="gps-fila-ir">Ver recorrido <span aria-hidden="true">›</span></span>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.gps-pagina {
		padding: 1.5rem 1.25rem 3rem;
	}
	.gps-cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.1rem;
	}
	.gps-eyebrow {
		margin: 0 0 0.25rem;
		color: #6b7280;
		font-size: 0.75rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.gps-cabecera h1 {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin: 0;
		color: #111827;
		font-size: 1.5rem;
		font-weight: 750;
	}
	.gps-cabecera h1 :global(svg) {
		color: #2563eb;
	}
	.gps-descripcion {
		margin: 0.4rem 0 0;
		color: #6b7280;
		font-size: 0.88rem;
	}
	.gps-refrescar,
	.gps-reintentar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-height: 2.75rem;
		padding: 0 0.8rem;
		border: 1px solid #dbeafe;
		border-radius: 0.55rem;
		background: #fff;
		color: #1d4ed8;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 650;
		cursor: pointer;
	}
	.gps-refrescar:disabled {
		cursor: wait;
		opacity: 0.6;
	}
	.girando {
		animation: giro 0.9s linear infinite;
	}
	.gps-aviso {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid #dbeafe;
		border-radius: 0.65rem;
		background: #eff6ff;
		color: #1e40af;
		font-size: 0.8rem;
	}
	.gps-busqueda {
		display: grid;
		gap: 0.3rem;
		width: min(100%, 22rem);
		margin-bottom: 0.85rem;
		color: #475569;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.gps-busqueda input {
		min-height: 2.75rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		color: #111827;
		font: inherit;
		font-weight: 400;
	}
	.gps-listado {
		display: grid;
		gap: 0.65rem;
	}
	.gps-fila {
		display: grid;
		grid-template-columns: auto minmax(10rem, 1fr) minmax(10rem, auto) auto;
		align-items: center;
		gap: 0.8rem;
		min-height: 5.1rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.75rem;
		background: #fff;
		color: inherit;
		text-decoration: none;
		transition:
			border-color 120ms ease,
			box-shadow 120ms ease,
			transform 120ms ease;
	}
	.gps-fila:hover {
		border-color: #93c5fd;
		box-shadow: 0 5px 16px rgb(15 23 42 / 6%);
		transform: translateY(-1px);
	}
	.gps-fila-icono {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		place-items: center;
		border-radius: 0.65rem;
		background: #eff6ff;
		color: #2563eb;
	}
	.gps-fila-principal,
	.gps-fila-gps {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}
	.gps-fila-principal strong {
		color: #111827;
		font-size: 0.86rem;
	}
	.gps-fila-principal small,
	.gps-fila-gps small {
		color: #6b7280;
		font-size: 0.73rem;
	}
	.gps-fila-gps {
		justify-items: start;
	}
	.gps-badge {
		display: inline-flex;
		align-items: center;
		min-height: 1.5rem;
		padding: 0.1rem 0.55rem;
		border-radius: 999px;
		font-size: 0.69rem;
		font-weight: 650;
	}
	.gps-estado--movimiento {
		background: #dcfce7;
		color: #166534;
	}
	.gps-estado--detenido {
		background: #fef3c7;
		color: #92400e;
	}
	.gps-estado--neutro {
		background: #f1f5f9;
		color: #475569;
	}
	.gps-fila-ir {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: #1d4ed8;
		font-size: 0.76rem;
		font-weight: 650;
		white-space: nowrap;
	}
	.gps-fila-ir span {
		font-size: 1.15rem;
	}
	.gps-estado-vacio {
		display: flex;
		min-height: 12rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 1.5rem;
		border: 1px dashed #cbd5e1;
		border-radius: 0.75rem;
		color: #64748b;
		text-align: center;
	}
	.gps-estado-vacio strong {
		color: #334155;
		font-size: 0.9rem;
	}
	.gps-estado-vacio p {
		margin: 0;
		color: #475569;
		font-size: 0.84rem;
	}
	.gps-estado-vacio small {
		font-size: 0.75rem;
	}
	.gps-estado-vacio--error {
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
	@media (max-width: 700px) {
		.gps-pagina {
			padding: 1rem 0.75rem 2rem;
		}
		.gps-cabecera {
			align-items: center;
		}
		.gps-refrescar span {
			display: none;
		}
		.gps-refrescar {
			width: 2.75rem;
			padding: 0;
		}
		.gps-fila {
			grid-template-columns: auto minmax(0, 1fr) auto;
			gap: 0.65rem;
		}
		.gps-fila-gps {
			grid-column: 2;
		}
		.gps-fila-ir {
			grid-column: 3;
			grid-row: 1 / span 2;
		}
	}
</style>
