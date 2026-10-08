<script lang="ts">
	/**
	 * Historial de notificaciones del usuario.
	 *
	 * Va sobre `ModalBase`, como el resto de modales: encabezado verde con el
	 * conteo de sin leer, cuerpo agrupado por día (Hoy, Ayer, fecha) y el
	 * paginador común en el pie. Cada tipo lleva su icono y su tono en vez de
	 * un emoji, y el estado vacío es la mascota.
	 *
	 * Antes vivía dentro de `Header.svelte` con su propia tarjeta, flechas
	 * «← →» y un bug: «Marcar todas como leídas» actualizaba el contador del
	 * header pero no las filas abiertas, que seguían marcadas como nuevas.
	 *
	 * La navegación al pulsar una notificación la decide quien abre el modal
	 * (`onabrir`): depende de rutas del dashboard que este componente no
	 * necesita conocer.
	 */
	import type { ComponentType } from 'svelte';
	import {
		Ban,
		Bell,
		CalendarClock,
		ClipboardList,
		FilePen,
		FilePlus2,
		ListChecks,
		RefreshCw,
		CheckCheck,
		AlarmClock,
		Receipt,
		ReceiptText,
		Route,
		ClipboardCheck,
		CalendarDays
	} from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import { mascota } from '$lib/mascot';
	import { notificacionesApi, type Notificacion } from '$lib/api/notificaciones';
	import { notificacionesStore } from '$lib/stores/notificaciones';

	interface Props {
		open: boolean;
		oncerrar: () => void;
		/** Se llama tras marcarla como leída; aquí se navega a su referencia. */
		onabrir: (n: Notificacion) => void;
	}
	let { open, oncerrar, onabrir }: Props = $props();

	const POR_PAGINA = 20;

	let notifs = $state<Notificacion[]>([]);
	let total = $state(0);
	let pagina = $state(1);
	let cargando = $state(false);
	let error = $state(false);

	const noLeidas = $derived($notificacionesStore.noLeidas);

	async function cargar() {
		cargando = true;
		error = false;
		try {
			const res = await notificacionesApi.listar(pagina, POR_PAGINA);
			notifs = res.notificaciones;
			total = res.total;
		} catch {
			error = true;
		} finally {
			cargando = false;
		}
	}

	/// Cada apertura empieza en la primera página.
	$effect(() => {
		if (!open) return;
		pagina = 1;
		void cargar();
	});

	async function marcarTodas() {
		await notificacionesStore.marcarTodasLeidas();
		notifs = notifs.map((n) => ({ ...n, leida: true }));
	}

	async function abrir(n: Notificacion) {
		if (!n.leida) {
			await notificacionesStore.marcarLeida(n.id);
			notifs = notifs.map((x) => (x.id === n.id ? { ...x, leida: true } : x));
		}
		onabrir(n);
	}

	// ── Presentación ─────────────────────────────────────────────────────
	type Tono = 'verde' | 'azul' | 'ambar' | 'rojo' | 'gris';
	const TIPOS: Record<string, { icono: ComponentType; tono: Tono; etiqueta: string }> = {
		LIQUIDACION_CREADA: { icono: FilePlus2, tono: 'verde', etiqueta: 'Liquidación' },
		LIQUIDACION_ACTUALIZADA: { icono: FilePen, tono: 'azul', etiqueta: 'Liquidación' },
		LIQUIDACION_PENDIENTE: { icono: ClipboardList, tono: 'ambar', etiqueta: 'Liquidación' },
		LIQUIDACION_ANULADA: { icono: Ban, tono: 'rojo', etiqueta: 'Liquidación' },
		ACTIVIDAD_PESV_ASIGNADA: { icono: ListChecks, tono: 'verde', etiqueta: 'PESV' },
		ACTIVIDAD_PESV_ACTUALIZADA: { icono: RefreshCw, tono: 'azul', etiqueta: 'PESV' },
		ACTIVIDAD_PESV_VENCIDA: { icono: CalendarClock, tono: 'rojo', etiqueta: 'PESV' },
		LIQUIDACION_FACTURADA: { icono: ReceiptText, tono: 'verde', etiqueta: 'Facturación' },
		FACTURA_ANULADA: { icono: Receipt, tono: 'rojo', etiqueta: 'Facturación' },
		ACCION_CORRECTIVA_RECORDATORIO: { icono: AlarmClock, tono: 'ambar', etiqueta: 'Acción correctiva' }
	};
	/// Las GENERAL se distinguen por su referencia: sin esto, los avisos de
	/// servicio caían en la campana genérica.
	const POR_REFERENCIA: Record<string, { icono: ComponentType; tono: Tono; etiqueta: string }> = {
		servicio: { icono: Route, tono: 'azul', etiqueta: 'Servicio' },
		preoperacional: { icono: ClipboardCheck, tono: 'verde', etiqueta: 'Preoperacional' },
		dias_laborados: { icono: CalendarDays, tono: 'azul', etiqueta: 'Días laborados' }
	};
	const tipoDe = (n: Notificacion) =>
		TIPOS[n.tipo] ??
		/// `dias_laborados:<fecha>` lleva la fecha pegada: se compara por el prefijo.
		(n.referencia_tipo ? POR_REFERENCIA[n.referencia_tipo.split(':')[0]] : undefined) ?? {
			icono: Bell,
			tono: 'gris' as Tono,
			etiqueta: 'General'
		};

	function claveDia(iso: string) {
		const d = new Date(iso);
		return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
	}
	function etiquetaDia(iso: string) {
		const d = new Date(iso);
		const hoy = new Date();
		const ayer = new Date();
		ayer.setDate(hoy.getDate() - 1);
		if (claveDia(iso) === claveDia(hoy.toISOString())) return 'Hoy';
		if (claveDia(iso) === claveDia(ayer.toISOString())) return 'Ayer';
		return d.toLocaleDateString('es-CO', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			...(d.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' } : {})
		});
	}
	const grupos = $derived.by(() => {
		const mapa = new Map<string, { etiqueta: string; items: Notificacion[] }>();
		for (const n of notifs) {
			const k = claveDia(n.created_at);
			if (!mapa.has(k)) mapa.set(k, { etiqueta: etiquetaDia(n.created_at), items: [] });
			mapa.get(k)!.items.push(n);
		}
		return [...mapa.entries()];
	});

	function hace(iso: string) {
		const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
		if (mins < 1) return 'ahora';
		if (mins < 60) return `hace ${mins} min`;
		const horas = Math.floor(mins / 60);
		if (horas < 24) return `hace ${horas} h`;
		return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
	}
</script>

<ModalBase
	{open}
	eyebrow="Centro de avisos"
	title="Notificaciones"
	subtitle={noLeidas > 0
		? `${noLeidas} sin leer de ${total}`
		: total
			? `Todo al día · ${total} en total`
			: null}
	tamano="md"
	sinRelleno
	{oncerrar}
>
	{#snippet accionesCabecera()}
		{#if noLeidas > 0}
			<button type="button" class="nt-marcar" onclick={marcarTodas}>
				<CheckCheck size={15} strokeWidth={2.2} />
				Marcar todas como leídas
			</button>
		{/if}
	{/snippet}

	{#if cargando && notifs.length === 0}
		<ul class="nt-lista" aria-busy="true">
			{#each Array(5) as _, i (i)}
				<li class="nt-fila nt-fila--esqueleto">
					<span class="nt-icono nt-esq"></span>
					<span class="nt-texto"><span class="nt-esq nt-esq--l"></span><span class="nt-esq nt-esq--c"></span></span>
				</li>
			{/each}
		</ul>
	{:else if error}
		{@const img = mascota('advertencia')}
		<div class="nt-vacio">
			<img src={img.src} alt={img.alt} width="418" height="418" />
			<h3>No pudimos cargar las notificaciones</h3>
			<button type="button" class="btn-secondary" onclick={cargar}>Reintentar</button>
		</div>
	{:else if notifs.length === 0}
		{@const img = mascota('exito')}
		<div class="nt-vacio">
			<img src={img.src} alt={img.alt} width="418" height="418" />
			<h3>No tienes notificaciones</h3>
			<p>Aquí aparecerán los avisos de liquidaciones, servicios y actividades del PESV.</p>
		</div>
	{:else}
		<div class="nt-cuerpo" class:nt-cuerpo--cargando={cargando}>
			{#each grupos as [clave, grupo] (clave)}
				<section class="nt-grupo">
					<h3 class="nt-dia">{grupo.etiqueta}</h3>
					<ul class="nt-lista">
						{#each grupo.items as n (n.id)}
							{@const t = tipoDe(n)}
							{@const Icono = t.icono}
							<li>
								<button
									type="button"
									class="nt-fila"
									class:nt-fila--nueva={!n.leida}
									onclick={() => abrir(n)}
								>
									<span class="nt-icono nt-icono--{t.tono}" aria-hidden="true">
										<Icono size={17} strokeWidth={2} />
									</span>
									<span class="nt-texto">
										<span class="nt-titulo">
											{n.titulo}
											{#if !n.leida}<span class="nt-punto" aria-label="Sin leer"></span>{/if}
										</span>
										<span class="nt-mensaje">{n.mensaje}</span>
										<span class="nt-meta">{t.etiqueta} · {hace(n.created_at)}</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}

	{#snippet pie()}
		{#if total > POR_PAGINA}
			<div class="nt-paginador">
				<PaginadorLista
					{pagina}
					{total}
					porPagina={POR_PAGINA}
					{cargando}
					nombreItems="notificaciones"
					suelto
					onCambiar={(p) => {
						pagina = p;
						void cargar();
					}}
				/>
			</div>
		{:else}
			<button type="button" class="btn-secondary" onclick={oncerrar}>Cerrar</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.nt-marcar {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 32px;
		padding: 0 12px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
		font-family: inherit;
		font-size: 12px;
		font-weight: 700;
		white-space: nowrap;
		cursor: pointer;
	}
	.nt-marcar:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.nt-cuerpo {
		padding: 6px 0 10px;
		transition: opacity 0.15s ease;
	}
	.nt-cuerpo--cargando {
		opacity: 0.55;
	}
	.nt-grupo + .nt-grupo {
		margin-top: 4px;
	}
	.nt-dia {
		position: sticky;
		top: 0;
		z-index: 1;
		margin: 0;
		padding: 10px 22px 6px;
		background: var(--bg-base);
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.nt-lista {
		list-style: none;
		margin: 0;
		padding: 0 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.nt-fila {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		width: 100%;
		padding: 12px;
		border: 1px solid transparent;
		border-radius: 16px;
		background: var(--bg-surface);
		text-align: left;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.nt-fila:hover {
		border-color: var(--border-default);
	}
	.nt-fila--nueva {
		background: var(--au-tint);
	}
	.nt-fila--nueva:hover {
		border-color: rgba(var(--au-primary-rgb), 0.35);
	}

	.nt-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 12px;
		flex-shrink: 0;
	}
	/* Tonos semáforo: iguales en los dos gemelos. */
	.nt-icono--verde {
		background: #dcfce7;
		color: #15803d;
	}
	.nt-icono--azul {
		background: #dbeafe;
		color: #1d4ed8;
	}
	.nt-icono--ambar {
		background: #fef3c7;
		color: #b45309;
	}
	.nt-icono--rojo {
		background: #fee2e2;
		color: #b91c1c;
	}
	.nt-icono--gris {
		background: var(--bg-base);
		color: var(--text-muted);
	}

	.nt-texto {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.nt-titulo {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 800;
		color: var(--text-primary);
	}
	.nt-punto {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--au-primary);
		flex-shrink: 0;
	}
	.nt-mensaje {
		font-size: 13px;
		line-height: 1.45;
		color: var(--text-secondary);
	}
	.nt-meta {
		margin-top: 2px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-very-muted);
	}

	.nt-vacio {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 32px 24px 36px;
		text-align: center;
	}
	.nt-vacio img {
		width: 8.5rem;
		height: 8.5rem;
		object-fit: contain;
	}
	.nt-vacio h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 800;
		color: var(--text-primary);
	}
	.nt-vacio p {
		margin: 0;
		max-width: 22rem;
		font-size: 13px;
		color: var(--text-muted);
	}

	.nt-paginador {
		flex: 1;
	}

	.nt-esq {
		display: block;
		border-radius: 8px;
		background: linear-gradient(90deg, var(--bg-base) 25%, #eef3f1 50%, var(--bg-base) 75%);
		background-size: 200% 100%;
		animation: nt-brillo 1.2s linear infinite;
	}
	.nt-icono.nt-esq {
		border-radius: 12px;
	}
	.nt-esq--l {
		width: 60%;
		height: 12px;
	}
	.nt-esq--c {
		width: 85%;
		height: 10px;
		margin-top: 6px;
	}
	.nt-fila--esqueleto {
		cursor: default;
	}
	@keyframes nt-brillo {
		to {
			background-position: -200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.nt-esq {
			animation: none;
		}
	}
</style>
