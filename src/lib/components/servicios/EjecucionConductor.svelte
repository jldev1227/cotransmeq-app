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
	const riesgos = $derived(reporte ? RIESGOS.filter(([k]) => reporte[k] === true).map(([, l]) => l) : []);

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
</script>

<svelte:window onkeydown={teclado} />

{#if ejecucion}
	<section class="glass soft-shadow mt-3 rounded-2xl border border-gray-200/50 p-4" aria-label="Ejecución del conductor">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<div
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600"
				>
					<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
						/>
					</svg>
				</div>
				<p class="text-[10px] font-semibold tracking-widest text-gray-500 uppercase">Ejecución del conductor</p>
			</div>
			<span class="ejec-badge">Desde la app</span>
		</div>

		<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
			<!-- Inicio -->
			<div class="ejec-bloque">
				<div class="ejec-bloque__titulo">
					<span>Inicio</span>
					{#if ejecucion.iniciado_diferido}
						<span class="ejec-badge ejec-badge--amber" title="Registrado sin conexión; la app lo envió después"
							>Diferido</span
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
						<span class="ejec-badge ejec-badge--amber" title="Registrada sin conexión; la app la envió después"
							>Diferida</span
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
			<div class="ejec-bloque">
				<div class="ejec-bloque__titulo">
					<span>Preoperacional</span>
					{#if preop}
						{@const est = ESTADO_PREOP[preop.status] ?? { label: preop.status, clase: '' }}
						<span class="ejec-badge {est.clase}">{preop.eliminado ? 'Eliminado' : est.label}</span>
					{/if}
				</div>
				{#if preop}
					<p class="truncate text-sm font-semibold text-gray-900" title={preop.nombre}>
						<span class="font-mono text-xs text-emerald-700">{preop.code}</span>
						{preop.nombre}
					</p>
					<div class="mt-1.5 flex items-center gap-1" aria-label="Etapas cerradas">
						{#each [1, 2, 3] as etapa}
							<span
								class="ejec-etapa {preop.etapas_cerradas.includes(etapa) ? 'ejec-etapa--ok' : ''}"
								title={preop.etapas_cerradas.includes(etapa) ? `Etapa ${etapa} cerrada` : `Etapa ${etapa} abierta`}
								>{etapa}</span
							>
						{/each}
						{#if ejecucion.formato_elegido_por_conductor}
							<span class="ml-1 text-[11px] text-gray-500" title="La clase del vehículo no recomendaba formato"
								>Formato elegido por el conductor</span
							>
						{/if}
					</div>
					{#if !preop.eliminado}
						<a
							href={preop.detalle_path}
							class="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
						>
							Ver envío
							<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
							</svg>
						</a>
					{/if}
				{:else}
					<p class="ejec-vacio">Sin preoperacional asociado</p>
				{/if}
			</div>
		</div>

		{#if fotos.length > 0}
			<div class="mt-3 border-t border-gray-100 pt-3">
				<p class="mb-2 text-[10px] font-semibold tracking-widest text-gray-500 uppercase">
					{fotos.some((f) => f.pausa_activa) ? 'Pausas activas y fotos del recorrido' : 'Fotos del recorrido'}
				</p>
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
			<div class="mt-3 border-t border-gray-100 pt-3">
				<p class="mb-2 text-[10px] font-semibold tracking-widest text-gray-500 uppercase">Reporte del conductor</p>
				<div class="flex flex-wrap items-center gap-1.5">
					{#if reporte.estado_conductor}
						{@const ec = ESTADO_CONDUCTOR[reporte.estado_conductor] ?? {
							label: reporte.estado_conductor,
							punto: 'bg-gray-400'
						}}
						<span class="ejec-badge"><span class="h-2 w-2 rounded-full {ec.punto}"></span>Conductor {ec.label}</span>
					{/if}
					{#if reporte.km_final != null}
						<span class="ejec-badge">Km final {reporte.km_final.toLocaleString('es-CO')}</span>
					{/if}
					{#each vias as via}<span class="ejec-badge ejec-badge--blue">Vía {via}</span>{/each}
					{#each riesgos as riesgo}<span class="ejec-badge ejec-badge--red">⚠️ {riesgo}</span>{/each}
				</div>
				{#if reporte.novedades}
					<p class="mt-2 text-sm leading-relaxed whitespace-pre-line text-gray-700">{reporte.novedades}</p>
				{/if}
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
			<button type="button" class="absolute inset-0 cursor-default" aria-label="Cerrar" onclick={() => (visor = null)}
			></button>
			<img src={foto.url} alt={foto.field_label ?? 'Foto'} class="relative max-h-[80vh] max-w-full rounded-xl object-contain" />
			<div class="relative flex items-center gap-2 text-sm text-white">
				{#if fotos.length > 1}
					<button type="button" class="ejec-visor-btn" onclick={() => mover(-1)} aria-label="Anterior">‹</button>
				{/if}
				<span>{foto.field_label ?? 'Foto'} · {fmtFecha(foto.uploaded_at)}</span>
				{#if fotos.length > 1}
					<span class="font-mono text-xs opacity-70">{visor + 1}/{fotos.length}</span>
					<button type="button" class="ejec-visor-btn" onclick={() => mover(1)} aria-label="Siguiente">›</button>
				{/if}
				<a href={foto.url} target="_blank" rel="noopener noreferrer" class="ejec-visor-btn px-3 text-xs">Abrir</a>
				<button type="button" class="ejec-visor-btn" onclick={() => (visor = null)} aria-label="Cerrar">✕</button>
			</div>
		</div>
	{/if}
{/if}

<style>
	.ejec-bloque {
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 12px;
		background: #faf7f2;
		padding: 0.75rem;
		min-width: 0;
	}
	.ejec-bloque__titulo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #6b6b6b;
	}
	.ejec-fila {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.15rem 0;
	}
	.ejec-fila__k {
		font-size: 0.75rem;
		color: #6b6b6b;
		font-weight: 500;
	}
	.ejec-fila__v {
		font-size: 0.82rem;
		font-weight: 600;
		color: #0f1f1a;
		text-align: right;
		white-space: nowrap;
	}
	.ejec-vacio {
		font-size: 0.8rem;
		color: #9ca3af;
	}
	.ejec-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.55rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #0f1f1a;
		background: #faf7f2;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 6px;
		white-space: nowrap;
	}
	.ejec-badge--amber {
		color: #92400e;
		background: rgba(245, 158, 11, 0.08);
		border-color: rgba(245, 158, 11, 0.3);
	}
	.ejec-badge--blue {
		color: #1e40af;
		background: rgba(59, 130, 246, 0.08);
		border-color: rgba(59, 130, 246, 0.25);
	}
	.ejec-badge--emerald {
		color: var(--color-emerald-700, #047857);
		background: color-mix(in srgb, var(--color-emerald-500, #10b981) 8%, transparent);
		border-color: color-mix(in srgb, var(--color-emerald-500, #10b981) 25%, transparent);
	}
	.ejec-badge--red {
		color: #b91c1c;
		background: rgba(239, 68, 68, 0.08);
		border-color: rgba(239, 68, 68, 0.25);
	}
	.ejec-etapa {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		font-size: 0.65rem;
		font-weight: 700;
		color: #9ca3af;
		border: 1px solid #d1d5db;
		background: white;
	}
	.ejec-etapa--ok {
		color: white;
		background: var(--color-emerald-500, #10b981);
		border-color: var(--color-emerald-500, #10b981);
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
