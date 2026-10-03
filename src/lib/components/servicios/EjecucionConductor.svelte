<!--
	Ejecución del conductor: lo que hizo el conductor con el servicio desde la app.

	Inicio (hora del servidor y del teléfono), liberación (hora declarada y hora
	en que llegó), el preoperacional con el que lo inició, las fotos de la etapa 2
	(«Durante el desplazamiento», donde van las pausas activas) y el reporte del
	recorrido. «Diferido» = el conductor lo registró sin conexión y la app lo
	envió después; por eso se muestran las dos horas.

	No pinta nada si el conductor no ha iniciado el servicio desde la app.
-->
<script lang="ts">
	import { apiClient } from '$lib/api/apiClient';

	interface Reporte {
		km_final: number | null;
		via_trocha: boolean | null;
		via_afirmado: boolean | null;
		via_mixto: boolean | null;
		via_pavimentada: boolean | null;
		riesgo_desniveles: boolean | null;
		riesgo_deslizamientos: boolean | null;
		riesgo_sin_senalizacion: boolean | null;
		riesgo_animales: boolean | null;
		riesgo_peatones: boolean | null;
		riesgo_trafico_alto: boolean | null;
		estado_conductor: string | null;
		novedades: string | null;
	}
	interface Foto {
		id: string;
		field_key: string | null;
		field_label: string | null;
		pausa_activa: boolean;
		mime_type: string;
		original_name: string | null;
		uploaded_at: string;
		url: string;
	}
	interface EjecucionServicio {
		ejecucion: null | {
			formato_elegido_por_conductor: boolean;
			iniciado_at: string | null;
			iniciado_dispositivo_at: string | null;
			iniciado_diferido: boolean;
			liberado_at: string | null;
			liberado_registrado_at: string | null;
			liberado_dispositivo_at: string | null;
			liberado_diferido: boolean;
			reporte: Reporte | null;
			pausas_activas_cada_horas: number | null;
			recomendaciones: string | null;
			recomendaciones_at: string | null;
		};
		preoperacional: null | {
			submission_id: string;
			code: string;
			nombre: string;
			version_number: number;
			status: string;
			eliminado: boolean;
			business_date: string;
			submitted_at: string | null;
			etapas_cerradas: number[];
			detalle_path: string;
		};
		fotos_desplazamiento: Foto[];
	}

	interface Props {
		servicioId: string;
		/** Cambia cuando el servicio cambia de estado (socket): vuelve a consultar. */
		estado?: string | null;
	}

	const { servicioId, estado = null }: Props = $props();

	let datos = $state<EjecucionServicio | null>(null);
	let visor = $state<number | null>(null);

	$effect(() => {
		const id = servicioId;
		void estado;
		let vigente = true;
		apiClient
			.get(`/api/servicios/${id}/ejecucion`)
			.then((r) => {
				if (vigente) datos = r.data?.data ?? null;
			})
			.catch(() => {
				/// Sección informativa: si falla, simplemente no se muestra.
				if (vigente) datos = null;
			});
		return () => {
			vigente = false;
		};
	});

	const ejecucion = $derived(datos?.ejecucion ?? null);
	const preop = $derived(datos?.preoperacional ?? null);
	const fotos = $derived(datos?.fotos_desplazamiento ?? []);
	const reporte = $derived(ejecucion?.reporte ?? null);

	const fmt = new Intl.DateTimeFormat('es-CO', {
		timeZone: 'America/Bogota',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
	const fmtFecha = (d: string | null) => (d ? fmt.format(new Date(d)) : '—');

	const ESTADO_PREOP: Record<string, { label: string; clase: string }> = {
		SUBMITTED: { label: 'Enviado', clase: 'ejec-badge--emerald' },
		DRAFT: { label: 'Borrador', clase: 'ejec-badge--amber' },
		VOIDED: { label: 'Anulado', clase: 'ejec-badge--red' }
	};

	const VIAS: [keyof Reporte, string][] = [
		['via_trocha', 'Trocha'],
		['via_afirmado', 'Afirmado'],
		['via_mixto', 'Mixto'],
		['via_pavimentada', 'Pavimentada']
	];
	const RIESGOS: [keyof Reporte, string][] = [
		['riesgo_desniveles', 'Desniveles'],
		['riesgo_deslizamientos', 'Deslizamientos'],
		['riesgo_sin_senalizacion', 'Sin señalización'],
		['riesgo_animales', 'Animales'],
		['riesgo_peatones', 'Peatones'],
		['riesgo_trafico_alto', 'Tráfico alto']
	];
	const ESTADO_CONDUCTOR: Record<string, { label: string; punto: string }> = {
		optimo: { label: 'Óptimo', punto: 'bg-emerald-500' },
		regular: { label: 'Regular', punto: 'bg-amber-500' },
		fatigado: { label: 'Fatigado', punto: 'bg-orange-500' },
		malo: { label: 'Malo', punto: 'bg-red-500' }
	};

	const vias = $derived(reporte ? VIAS.filter(([k]) => reporte[k] === true).map(([, l]) => l) : []);
	const riesgos = $derived(
		reporte ? RIESGOS.filter(([k]) => reporte[k] === true).map(([, l]) => l) : []
	);

	function mover(delta: number) {
		if (visor === null || fotos.length === 0) return;
		visor = (visor + delta + fotos.length) % fotos.length;
	}

	function teclado(e: KeyboardEvent) {
		if (visor === null) return;
		if (e.key === 'Escape') visor = null;
		else if (e.key === 'ArrowRight') mover(1);
		else if (e.key === 'ArrowLeft') mover(-1);
	}
	/** Nombres de las tres etapas del preoperacional, como en la app del conductor. */
	const ETAPAS = ['Prealistamiento', 'Desplazamiento', 'Cierre'];
</script>

<svelte:window onkeydown={teclado} />

{#if ejecucion}
	<div class="ejec-seccion">
		<h2 class="ejec-seccion__titulo">Ejecución del servicio</h2>
		<span class="ejec-seccion__detalle">Desde la app del conductor</span>
	</div>
	<section class="ejec-card" aria-label="Ejecución del conductor">
		<div class="ejec-bloques">
			<!-- Inicio -->
			<div class="ejec-bloque">
				<div class="ejec-bloque__titulo">
					<span>Inicio</span>
					{#if ejecucion.iniciado_diferido}
						<span
							class="ejec-badge ejec-badge--amber"
							title="Registrado sin conexión; la app lo envió después">Diferido</span
						>
					{/if}
				</div>
				{#if ejecucion.iniciado_at}
					<div class="ejec-fila">
						<span class="ejec-fila__k">Hora servidor</span>
						<span class="ejec-fila__v">{fmtFecha(ejecucion.iniciado_at)}</span>
					</div>
					<div class="ejec-fila">
						<span class="ejec-fila__k">Hora del teléfono</span>
						<span class="ejec-fila__v">{fmtFecha(ejecucion.iniciado_dispositivo_at)}</span>
					</div>
				{:else}
					<p class="ejec-vacio">Sin iniciar</p>
				{/if}
			</div>

			<!-- Liberación -->
			<div class="ejec-bloque">
				<div class="ejec-bloque__titulo">
					<span>Liberación</span>
					{#if ejecucion.liberado_diferido}
						<span
							class="ejec-badge ejec-badge--amber"
							title="Registrada sin conexión; la app la envió después">Diferida</span
						>
					{/if}
				</div>
				{#if ejecucion.liberado_at}
					<div class="ejec-fila">
						<span class="ejec-fila__k">Hora declarada</span>
						<span class="ejec-fila__v">{fmtFecha(ejecucion.liberado_at)}</span>
					</div>
					<div class="ejec-fila">
						<span class="ejec-fila__k">Registrada</span>
						<span class="ejec-fila__v">{fmtFecha(ejecucion.liberado_registrado_at)}</span>
					</div>
				{:else}
					<p class="ejec-vacio">En curso: aún no se libera</p>
				{/if}
			</div>

			<!-- Preoperacional -->
			<div class="ejec-bloque ejec-bloque--ancho">
				<div class="ejec-bloque__titulo">
					<span>Preoperacional</span>
					{#if preop}
						{@const est = ESTADO_PREOP[preop.status] ?? { label: preop.status, clase: '' }}
						<span class="ejec-badge {est.clase}">{preop.eliminado ? 'Eliminado' : est.label}</span>
					{/if}
				</div>
				{#if preop}
					<p class="ejec-preop" title={preop.nombre}>
						<span class="ejec-preop__codigo">{preop.code}</span>
						{preop.nombre}
					</p>
					<div class="ejec-etapas" aria-label="Etapas del preoperacional">
						{#each ETAPAS as etapa, i}
							{@const cerrada = preop.etapas_cerradas.includes(i + 1)}
							<div class="ejec-etapa" title={cerrada ? `${etapa} cerrada` : `${etapa} abierta`}>
								<span class="ejec-etapa__circulo" class:ejec-etapa__circulo--ok={cerrada}
									>{cerrada ? '✓' : i + 1}</span
								>
								<span class="ejec-etapa__nombre" class:ejec-etapa__nombre--ok={cerrada}
									>{etapa}</span
								>
							</div>
						{/each}
					</div>
					{#if ejecucion.formato_elegido_por_conductor}
						<p class="ejec-nota" title="La clase del vehículo no recomendaba formato">
							Formato elegido por el conductor
						</p>
					{/if}
					{#if !preop.eliminado}
						<a href={preop.detalle_path} class="ejec-enlace">
							Ver envío
							<svg
								class="h-3 w-3"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								stroke-width="2.2"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
							</svg>
						</a>
					{/if}
				{:else}
					<p class="ejec-vacio">Sin preoperacional asociado</p>
				{/if}
			</div>
		</div>

		{#if fotos.length > 0 || ejecucion?.pausas_activas_cada_horas != null}
			<div class="ejec-sub">
				<p class="ejec-sub__titulo">
					{fotos.some((f) => f.pausa_activa) || ejecucion?.pausas_activas_cada_horas != null
						? 'Pausas activas y fotos del recorrido'
						: 'Fotos del recorrido'}
				</p>
				{#if ejecucion?.pausas_activas_cada_horas != null}
					<p class="ejec-texto">
						Pausa activa cada
						<strong>{ejecucion.pausas_activas_cada_horas.toLocaleString('es-CO')} h</strong>
						{#if !fotos.some((f) => f.pausa_activa)}<span class="text-gray-500">· sin fotos</span
							>{/if}
					</p>
				{/if}
				<div class="flex flex-wrap gap-2">
					{#each fotos as foto, i (foto.id)}
						<button
							type="button"
							class="ejec-miniatura"
							onclick={() => (visor = i)}
							title={foto.field_label ?? 'Foto'}
							aria-label={`Ampliar ${foto.field_label ?? 'foto'} ${i + 1}`}
						>
							<img src={foto.url} alt={foto.field_label ?? 'Foto del recorrido'} loading="lazy" />
							{#if foto.pausa_activa}<span class="ejec-miniatura__tag">Pausa</span>{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if reporte}
			<div class="ejec-sub">
				<p class="ejec-sub__titulo">Reporte del conductor</p>
				<div class="flex flex-wrap items-center gap-1.5">
					{#if reporte.estado_conductor}
						{@const ec = ESTADO_CONDUCTOR[reporte.estado_conductor] ?? {
							label: reporte.estado_conductor,
							punto: 'bg-gray-400'
						}}
						<span class="ejec-badge"
							><span class="h-2 w-2 rounded-full {ec.punto}"></span>Conductor {ec.label}</span
						>
					{/if}
					{#if reporte.km_final != null}
						<span class="ejec-badge">Km final {reporte.km_final.toLocaleString('es-CO')}</span>
					{/if}
					{#each vias as via}<span class="ejec-badge ejec-badge--blue">Vía {via}</span>{/each}
					{#each riesgos as riesgo}<span class="ejec-badge ejec-badge--red">⚠️ {riesgo}</span
						>{/each}
				</div>
				{#if reporte.novedades}
					<p class="ejec-texto ejec-texto--parrafo">{reporte.novedades}</p>
				{/if}
			</div>
		{/if}

		{#if ejecucion?.recomendaciones}
			<div class="ejec-sub">
				<p class="ejec-sub__titulo">Recomendaciones del conductor</p>
				<p class="ejec-texto ejec-texto--parrafo">{ejecucion.recomendaciones}</p>
			</div>
		{/if}
	</section>

	{#if visor !== null && fotos[visor]}
		{@const foto = fotos[visor]}
		<div
			class="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 p-4"
			style="background-color: rgba(15, 31, 26, 0.85);"
			role="dialog"
			aria-modal="true"
			aria-label={foto.field_label ?? 'Foto'}
		>
			<button
				type="button"
				class="absolute inset-0 cursor-default"
				aria-label="Cerrar"
				onclick={() => (visor = null)}
			></button>
			<img
				src={foto.url}
				alt={foto.field_label ?? 'Foto'}
				class="relative max-h-[80vh] max-w-full rounded-xl object-contain"
			/>
			<div class="relative flex items-center gap-2 text-sm text-white">
				{#if fotos.length > 1}
					<button
						type="button"
						class="ejec-visor-btn"
						onclick={() => mover(-1)}
						aria-label="Anterior">‹</button
					>
				{/if}
				<span>{foto.field_label ?? 'Foto'} · {fmtFecha(foto.uploaded_at)}</span>
				{#if fotos.length > 1}
					<span class="text-xs opacity-70">{visor + 1}/{fotos.length}</span>
					<button
						type="button"
						class="ejec-visor-btn"
						onclick={() => mover(1)}
						aria-label="Siguiente">›</button
					>
				{/if}
				<a
					href={foto.url}
					target="_blank"
					rel="noopener noreferrer"
					class="ejec-visor-btn px-3 text-xs">Abrir</a
				>
				<button
					type="button"
					class="ejec-visor-btn"
					onclick={() => (visor = null)}
					aria-label="Cerrar">✕</button
				>
			</div>
		</div>
	{/if}
{/if}

<style>
	/* Estilo de la app móvil: título de sección fuera de la tarjeta, tarjeta blanca de radio 22,
	   bloques en menta y chips redondeados. La marca sale de --color-emerald-* (verde o naranja). */
	.ejec-seccion {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.25rem;
		padding: 0 0.125rem;
	}
	.ejec-seccion__titulo {
		font-size: 1.3125rem;
		line-height: 1.625rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--color-gray-950);
	}
	.ejec-seccion__detalle {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-gray-600);
	}
	.ejec-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.0625rem;
		border-radius: 22px;
		background: #ffffff;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}
	.ejec-bloques {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.625rem;
	}
	.ejec-bloque {
		border-radius: 16px;
		background: var(--color-emerald-50);
		padding: 0.75rem 0.875rem;
		min-width: 0;
	}
	/* El preoperacional ocupa la fila completa: las tres etapas llevan nombre. */
	.ejec-bloque--ancho {
		grid-column: 1 / -1;
	}
	.ejec-bloque__titulo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
		font-size: 0.6875rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-gray-600);
	}
	.ejec-fila {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.15rem 0;
	}
	.ejec-fila__k {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-gray-600);
	}
	.ejec-fila__v {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--color-gray-950);
		text-align: right;
	}
	.ejec-vacio {
		font-size: 0.8125rem;
		color: var(--color-gray-600);
	}
	.ejec-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.2rem 0.65rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: var(--color-emerald-900);
		background: var(--color-emerald-50);
		border-radius: 999px;
		white-space: nowrap;
	}
	.ejec-bloque .ejec-badge {
		background: #ffffff;
	}
	.ejec-badge--amber {
		color: #92400e;
		background: #fef3c7 !important;
	}
	.ejec-badge--blue {
		color: #1d4ed8;
		background: #dbeafe !important;
	}
	.ejec-badge--emerald {
		color: #047857;
		background: #d1fae5 !important;
	}
	.ejec-badge--red {
		color: #b42318;
		background: #fff0ed !important;
	}
	.ejec-preop {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.875rem;
		font-weight: 800;
		color: var(--color-gray-950);
	}
	.ejec-preop__codigo {
		color: var(--color-emerald-600);
	}
	.ejec-etapas {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.25rem;
		margin-top: 0.625rem;
	}
	.ejec-etapa {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}
	.ejec-etapa__circulo {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 999px;
		font-size: 0.8125rem;
		font-weight: 800;
		color: var(--color-gray-600);
		background: #ffffff;
		border: 2px solid var(--color-gray-200);
	}
	.ejec-etapa__circulo--ok {
		color: #ffffff;
		background: var(--color-emerald-500);
		border-color: var(--color-emerald-500);
	}
	.ejec-etapa__nombre {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--color-gray-600);
	}
	.ejec-etapa__nombre--ok {
		color: var(--color-emerald-900);
	}
	.ejec-nota {
		margin-top: 0.375rem;
		font-size: 0.6875rem;
		color: var(--color-gray-600);
	}
	.ejec-enlace {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 800;
		color: var(--color-emerald-700);
	}
	.ejec-enlace:hover {
		text-decoration: underline;
	}
	.ejec-sub {
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-gray-100);
	}
	.ejec-sub__titulo {
		margin-bottom: 0.5rem;
		font-size: 0.6875rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-gray-600);
	}
	.ejec-texto {
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-gray-950);
	}
	.ejec-texto--parrafo {
		margin: 0.5rem 0 0;
		line-height: 1.25rem;
		white-space: pre-line;
	}
	.ejec-miniatura {
		position: relative;
		width: 5rem;
		height: 5rem;
		overflow: hidden;
		border-radius: 10px;
		border: 1px solid rgba(0, 0, 0, 0.08);
		background: #f3f4f6;
		cursor: zoom-in;
	}
	.ejec-miniatura img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		/* Si la imagen no carga, que no se desborde el texto alternativo. */
		font-size: 0;
	}
	.ejec-miniatura__tag {
		position: absolute;
		left: 0.25rem;
		bottom: 0.25rem;
		padding: 0 0.3rem;
		font-size: 0.55rem;
		font-weight: 700;
		text-transform: uppercase;
		color: white;
		background: color-mix(in srgb, var(--color-emerald-700, #047857) 85%, transparent);
		border-radius: 4px;
	}
	.ejec-visor-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2rem;
		height: 2rem;
		border-radius: 9999px;
		background: rgba(255, 255, 255, 0.15);
		color: white;
	}
	.ejec-visor-btn:hover {
		background: rgba(255, 255, 255, 0.3);
	}
</style>
