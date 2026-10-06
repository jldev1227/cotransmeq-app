<script lang="ts">
	/**
	 * Panel lateral del asistente de IA.
	 *
	 * Reemplaza al buscador «Ir a un módulo…» de la cabecera: además de llevar al
	 * usuario a una pantalla, consulta datos (conductores, flota, servicios,
	 * clientes…) con sus mismos permisos y los explica en el chat. Lo monta el
	 * layout del dashboard; se abre desde el disparador de la cabecera o con ⌘K.
	 *
	 * El modelo no actúa sobre la pantalla: cuando pide navegar, el backend
	 * manda un evento `navegar` ya validado contra los permisos y aquí se hace el
	 * `goto`. El markdown de la respuesta se escapa y solo admite enlaces internos.
	 */
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import { fade, fly } from 'svelte/transition';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { Lightbulb, Loader2, Search, Send, SquarePen, Sparkles, Square, X } from 'lucide-svelte';
	import { iniciarGuia } from '$lib/stores/guia';
	import type { Guia } from '$lib/guias/motor';
	import { authStore } from '$lib/stores/auth';
	import {
		asistenteAbierto,
		conversacion,
		nuevoIdMensaje,
		type MensajeChat
	} from '$lib/stores/asistente';
	import {
		conversarConAsistente,
		ErrorAsistente,
		type ContextoAsistente
	} from '$lib/api/asistente';
	import { markdownAHtml } from '$lib/utils/markdown-asistente';

	let texto = $state('');
	let enviando = $state(false);
	let abort: AbortController | null = null;
	let lista = $state<HTMLDivElement | null>(null);
	let entrada = $state<HTMLTextAreaElement | null>(null);

	/// Líneas visibles del campo antes de que aparezca su propio scroll, como en
	/// WhatsApp: crece con cada salto de línea (Mayús+Enter) y vuelve a una
	/// línea al enviar. El tope sale del `line-height` real, no de un número a
	/// mano, así que sigue valiendo si cambia la fuente.
	const LINEAS_MAX = 10;
	function ajustarAlto() {
		const el = entrada;
		if (!el) return;
		const linea = parseFloat(getComputedStyle(el).lineHeight) || 20;
		const tope = linea * LINEAS_MAX;
		el.style.height = 'auto';
		const alto = Math.min(el.scrollHeight, tope);
		el.style.height = `${alto}px`;
		el.style.overflowY = el.scrollHeight > tope ? 'auto' : 'hidden';
	}
	$effect(() => {
		void texto;
		ajustarAlto();
	});

	const ruta = $derived($page.url.pathname);
	const primerNombre = $derived(String($authStore.user?.nombre ?? '').split(' ')[0]);
	const sugerencias = $derived(sugerenciasPara(ruta));

	function sugerenciasPara(r: string): string[] {
		if (r.startsWith('/dashboard/servicios'))
			return [
				'¿Cuántos servicios hay planificados este mes?',
				'Programa un servicio para mañana a las 6 a. m.'
			];
		if (r.startsWith('/dashboard/conductores'))
			return ['¿Qué conductores están en vacaciones o incapacidad?', 'Busca al conductor por cédula'];
		if (r.startsWith('/dashboard/flota'))
			return ['¿Qué vehículos están en mantenimiento?', '¿Quién tiene asignada la placa…?'];
		if (r.startsWith('/dashboard/liquidaciones-servicios'))
			return ['¿Qué liquidaciones hay en borrador este mes?', 'Duplica la liquidación … en borrador con el consecutivo …'];
		if (r.startsWith('/dashboard/clientes'))
			return ['¿Qué clientes requieren OSI?', 'Busca el cliente por NIT'];
		if (r.startsWith('/dashboard/nomina'))
			return ['¿Qué liquidaciones de nómina están pendientes?', '¿Cuánto se liquidó en el último periodo?'];
		if (r.startsWith('/dashboard/liquidaciones-terceros'))
			return ['¿Cuánto se les liquidó a los terceros este mes?', '¿Qué cierres están en borrador?'];
		if (r.startsWith('/dashboard/conductores/recorridos'))
			return ['¿Quién tiene más días laborados este mes?', '¿Qué conductores no han registrado recorridos?'];
		return ['¿Qué puedo hacer en esta app?', 'Llévame a nómina', '¿Cuántos servicios hubo este mes?'];
	}

	function contexto(): ContextoAsistente {
		const filtros: Record<string, string> = {};
		$page.url.searchParams.forEach((v, k) => (filtros[k] = v));
		return {
			ruta: `${$page.url.pathname}${$page.url.search}`,
			titulo: typeof document !== 'undefined' ? document.title.split(/[-·|]/)[0].trim() : undefined,
			filtros
		};
	}

	async function bajar() {
		await tick();
		lista?.scrollTo({ top: lista.scrollHeight });
	}

	function actualizarUltimo(cambio: (m: MensajeChat) => MensajeChat) {
		conversacion.update((ms) => [...ms.slice(0, -1), cambio(ms[ms.length - 1])]);
	}

	async function enviar(pregunta = texto) {
		const contenido = pregunta.trim();
		if (!contenido || enviando) return;
		texto = '';
		enviando = true;

		conversacion.update((ms) => [
			...ms,
			{ id: nuevoIdMensaje(), rol: 'usuario', contenido },
			{ id: nuevoIdMensaje(), rol: 'asistente', contenido: '', pasos: [] }
		]);
		void bajar();

		// El historial que viaja es solo texto: la última respuesta (vacía) no va.
		const historial = get(conversacion)
			.slice(0, -1)
			.filter((m) => !m.error && m.contenido)
			.map(({ rol, contenido }) => ({ rol, contenido }));

		abort = new AbortController();
		try {
			await conversarConAsistente(
				historial,
				contexto(),
				(e) => {
					if (e.t === 'texto') {
						actualizarUltimo((m) => ({ ...m, contenido: m.contenido + e.d }));
						void bajar();
					} else if (e.t === 'herramienta') {
						actualizarUltimo((m) => ({ ...m, pasos: [...(m.pasos ?? []), e.etiqueta] }));
						void bajar();
					} else if (e.t === 'navegar') {
						navegar(e.ruta);
					} else if (e.t === 'guia') {
						actualizarUltimo((m) => ({ ...m, guia: e.guia }));
						if (e.iniciar) arrancarGuia(e.guia);
					} else if (e.t === 'error') {
						actualizarUltimo((m) => ({ ...m, contenido: e.mensaje, error: true }));
					}
				},
				abort.signal
			);
		} catch (e) {
			if (!abort.signal.aborted) {
				const mensaje =
					e instanceof ErrorAsistente && e.status === 401
						? 'Tu sesión expiró. Vuelve a iniciar sesión para usar el asistente.'
						: 'No me pude conectar con el asistente. Intenta de nuevo en un momento.';
				actualizarUltimo((m) => ({ ...m, contenido: mensaje, error: true }));
			}
		} finally {
			enviando = false;
			abort = null;
			await tick();
			entrada?.focus();
		}
	}

	/**
	 * El asistente pidió abrir una pantalla. Se navega sin cerrar el panel para
	 * que la conversación siga a la vista; en móvil el panel tapa todo, así que
	 * ahí se cierra.
	 */
	function navegar(destino: string) {
		if (!destino.startsWith('/') || destino.startsWith('//')) return;
		void goto(destino);
		if (window.matchMedia('(max-width: 639px)').matches) asistenteAbierto.set(false);
	}

	/** El panel tapa la derecha de la pantalla: se cierra para que el foco se vea. */
	function arrancarGuia(g: Guia) {
		asistenteAbierto.set(false);
		iniciarGuia(g);
	}

	function detener() {
		abort?.abort();
	}

	function nuevaConversacion() {
		detener();
		conversacion.set([]);
	}

	function teclado(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void enviar();
		} else if (e.key === 'Escape') {
			asistenteAbierto.set(false);
		}
	}

	/** Los enlaces de la respuesta son rutas internas: navegan sin recargar. */
	function clicEnRespuesta(e: MouseEvent) {
		const a = (e.target as HTMLElement).closest('a[data-interno]');
		if (!a) return;
		e.preventDefault();
		navegar(a.getAttribute('href') ?? '/');
	}

	$effect(() => {
		if ($asistenteAbierto) {
			void tick().then(() => entrada?.focus());
			void bajar();
		}
	});

	/// Lo que está fuera del <main> del dashboard (el body fijo de los canvas
	/// Univer, el visor PDF de la liquidación) no sabe del panel: una clase en
	/// <html> y reglas globales en app.css les quitan los 420px de la derecha.
	$effect(() => {
		document.documentElement.classList.toggle('asistente-abierto', $asistenteAbierto);
		return () => document.documentElement.classList.remove('asistente-abierto');
	});
</script>

{#if $asistenteAbierto}
	<button
		type="button"
		class="asis-fondo"
		aria-label="Cerrar asistente"
		onclick={() => asistenteAbierto.set(false)}
		transition:fade={{ duration: 150 }}
	></button>

	<aside class="asis-panel" aria-label="Asistente" transition:fly={{ x: 420, duration: 200 }}>
		<header class="asis-cabecera">
			<div class="asis-titulo">
				<span class="asis-titulo-icono"><Sparkles size={16} strokeWidth={2} /></span>
				<div>
					<p class="asis-titulo-nombre">Asistente</p>
					<p class="asis-titulo-sub">Consulta datos y te lleva a las pantallas</p>
				</div>
			</div>
			<div class="asis-acciones">
				{#if $conversacion.length}
					<button
						type="button"
						class="asis-btn-icono"
						title="Nueva conversación"
						aria-label="Nueva conversación"
						onclick={nuevaConversacion}
					>
						<SquarePen size={16} />
					</button>
				{/if}
				<button
					type="button"
					class="asis-btn-icono"
					aria-label="Cerrar"
					onclick={() => asistenteAbierto.set(false)}
				>
					<X size={16} />
				</button>
			</div>
		</header>

		<!-- El clic solo intercepta los enlaces internos de las respuestas; el rol
		     `log` describe la conversación y no exige interacción por teclado. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<div bind:this={lista} class="asis-lista" role="log" aria-live="polite" onclick={clicEnRespuesta}>
			{#if $conversacion.length === 0}
				<div class="asis-bienvenida">
					<p class="asis-bienvenida-titulo">Hola{primerNombre ? `, ${primerNombre}` : ''}</p>
					<p class="asis-bienvenida-texto">
						Pregúntame por conductores, vehículos, servicios o clientes, pídeme que te lleve a una
						pantalla o que programe un servicio. Antes de guardar algo te pido confirmación.
					</p>
				</div>
				<div class="asis-sugerencias">
					{#each sugerencias as s (s)}
						<button type="button" class="asis-sugerencia" onclick={() => enviar(s)}>{s}</button>
					{/each}
				</div>
			{/if}

			{#each $conversacion as m (m.id)}
				{#if m.rol === 'usuario'}
					<div class="asis-fila-usuario">
						<p class="asis-burbuja-usuario">{m.contenido}</p>
					</div>
				{:else}
					<div class="asis-respuesta-bloque">
						{#if m.pasos?.length}
							<div class="asis-pasos">
								{#each m.pasos as paso, i (i)}
									<span class="asis-paso"><Search size={11} /> {paso}</span>
								{/each}
							</div>
						{/if}
						{#if m.contenido}
							<div class="asis-respuesta" class:asis-respuesta--error={m.error}>
								<!-- markdownAHtml escapa todo el texto y solo genera enlaces internos -->
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html markdownAHtml(m.contenido)}
							</div>
						{/if}
						{#if m.guia}
							<div class="asis-guia">
								<span class="asis-guia-icono"><Lightbulb size={15} strokeWidth={2.2} /></span>
								<div class="asis-guia-texto">
									<p class="asis-guia-titulo">{m.guia.titulo}</p>
									<p class="asis-guia-sub">Guía en pantalla · {m.guia.pasos.length} pasos</p>
								</div>
								<button type="button" class="asis-guia-btn" onclick={() => m.guia && arrancarGuia(m.guia)}>
									Iniciar guía
								</button>
							</div>
						{/if}
						{#if !m.contenido && enviando}
							<div class="asis-pensando">
								<Loader2 size={15} class="asis-girar" />
								{m.pasos?.length ? 'Analizando…' : 'Pensando…'}
							</div>
						{/if}
					</div>
				{/if}
			{/each}
		</div>

		<footer class="asis-pie">
			<div class="asis-entrada">
				<textarea
					bind:this={entrada}
					bind:value={texto}
					onkeydown={teclado}
					rows="1"
					maxlength="2000"
					placeholder="Escribe tu pregunta…"
					aria-label="Pregunta para el asistente"
				></textarea>
				{#if enviando}
					<button type="button" class="asis-enviar asis-enviar--detener" aria-label="Detener" onclick={detener}>
						<Square size={14} fill="currentColor" />
					</button>
				{:else}
					<button
						type="button"
						class="asis-enviar"
						aria-label="Enviar"
						disabled={!texto.trim()}
						onclick={() => enviar()}
					>
						<Send size={15} />
					</button>
				{/if}
			</div>
			<p class="asis-aviso">La IA puede equivocarse. Verifica las cifras importantes en su pantalla.</p>
		</footer>
	</aside>
{/if}

<style>
	.asis-fondo {
		position: fixed;
		inset: 64px 0 0 0;
		z-index: 890;
		border: none;
		background: rgba(15, 23, 42, 0.2);
	}
	@media (min-width: 768px) {
		.asis-fondo {
			display: none;
		}
	}
	.asis-panel {
		position: fixed;
		top: 64px;
		right: 0;
		bottom: 0;
		z-index: 900;
		display: flex;
		flex-direction: column;
		width: 100%;
		background: var(--bg-surface);
		border-left: 1px solid var(--border-subtle);
		box-shadow: -16px 0 48px rgba(0, 0, 0, 0.12);
	}
	@media (min-width: 640px) {
		.asis-panel {
			width: 420px;
		}
	}

	/* ── Cabecera ── */
	.asis-cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.asis-titulo {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.asis-titulo-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: var(--au-tint, #ddf7ea);
		color: var(--emerald-800);
	}
	.asis-titulo-nombre {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.asis-titulo-sub {
		margin: 0;
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.asis-acciones {
		display: flex;
		gap: 0.15rem;
	}
	.asis-btn-icono {
		display: inline-flex;
		padding: 0.4rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.asis-btn-icono:hover {
		background: var(--bg-base);
		color: var(--text-primary);
	}

	/* ── Conversación ── */
	.asis-lista {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		overflow-y: auto;
	}
	.asis-bienvenida {
		padding-top: 1.25rem;
		text-align: center;
	}
	.asis-bienvenida-titulo {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.asis-bienvenida-texto {
		max-width: 18rem;
		margin: 0.25rem auto 0;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.asis-sugerencias {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.asis-sugerencia {
		width: 100%;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: transparent;
		font-family: inherit;
		font-size: 0.85rem;
		color: var(--text-secondary);
		text-align: left;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.asis-sugerencia:hover {
		background: var(--bg-base);
		border-color: var(--border-emphasis);
	}
	.asis-fila-usuario {
		display: flex;
		justify-content: flex-end;
	}
	.asis-burbuja-usuario {
		max-width: 85%;
		margin: 0;
		padding: 0.5rem 0.85rem;
		border-radius: 16px 16px 6px 16px;
		background: var(--bg-charcoal, #1f2937);
		color: var(--text-on-dark, #fff);
		font-size: 0.875rem;
		white-space: pre-wrap;
	}
	.asis-respuesta-bloque {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.asis-pasos {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.asis-paso {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.55rem;
		border-radius: 999px;
		background: var(--bg-base);
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.asis-guia {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.6rem;
		padding: 0.6rem 0.7rem;
		border-radius: 12px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-base);
	}
	.asis-guia-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: var(--emerald-600);
		color: #fff;
	}
	.asis-guia-texto {
		flex: 1;
		min-width: 0;
	}
	.asis-guia-titulo {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-primary);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.asis-guia-sub {
		margin: 0;
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.asis-guia-btn {
		flex-shrink: 0;
		padding: 0.38rem 0.7rem;
		border-radius: 8px;
		font-size: 0.78rem;
		font-weight: 600;
		color: #fff;
		background: var(--emerald-600);
	}
	.asis-guia-btn:hover {
		background: var(--emerald-700);
	}
	.asis-pensando {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	:global(.asis-girar) {
		animation: asis-giro 0.9s linear infinite;
	}
	@keyframes asis-giro {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Markdown de la respuesta ── */
	.asis-respuesta {
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--text-primary);
	}
	.asis-respuesta--error {
		color: #b91c1c;
	}
	.asis-respuesta :global(p) {
		margin: 0 0 0.5rem;
	}
	.asis-respuesta :global(p:last-child) {
		margin-bottom: 0;
	}
	.asis-respuesta :global(h4) {
		margin: 0.75rem 0 0.25rem;
		font-weight: 700;
	}
	.asis-respuesta :global(h4:first-child) {
		margin-top: 0;
	}
	.asis-respuesta :global(ul),
	.asis-respuesta :global(ol) {
		margin: 0 0 0.5rem;
		padding-left: 1.25rem;
	}
	.asis-respuesta :global(ul) {
		list-style: disc;
	}
	.asis-respuesta :global(ol) {
		list-style: decimal;
	}
	.asis-respuesta :global(li) {
		margin: 0.15rem 0;
	}
	.asis-respuesta :global(a) {
		color: var(--emerald-700);
		font-weight: 600;
	}
	.asis-respuesta :global(a:hover) {
		text-decoration: underline;
	}
	.asis-respuesta :global(code) {
		padding: 0 0.25rem;
		border-radius: 0.25rem;
		background: var(--bg-base);
		font-size: 0.8em;
	}
	.asis-respuesta :global(table) {
		width: 100%;
		margin: 0 0 0.5rem;
		border-collapse: collapse;
		font-size: 0.8rem;
	}
	.asis-respuesta :global(th),
	.asis-respuesta :global(td) {
		padding: 0.3rem 0.4rem;
		border-bottom: 1px solid var(--border-subtle);
		text-align: left;
	}
	.asis-respuesta :global(th) {
		font-weight: 600;
		color: var(--text-muted);
	}

	/* ── Entrada ── */
	.asis-pie {
		padding: 0.75rem;
		border-top: 1px solid var(--border-subtle);
	}
	.asis-entrada {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
	}
	.asis-entrada:focus-within {
		border-color: var(--emerald-600);
		box-shadow: 0 0 0 1px var(--emerald-600);
	}
	.asis-entrada textarea {
		flex: 1;
		min-height: 1.5rem;
		/* Sin max-height: el tope de 10 líneas lo pone `ajustarAlto`. */
		line-height: 1.5rem;
		padding: 0;
		overflow-y: hidden;
		border: none;
		background: transparent;
		font-family: inherit;
		font-size: 0.875rem;
		color: var(--text-primary);
		resize: none;
	}
	.asis-entrada textarea:focus {
		outline: none;
		box-shadow: none;
	}
	.asis-entrada textarea::placeholder {
		color: var(--text-very-muted);
	}
	.asis-enviar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 9px;
		background: var(--emerald-700);
		color: #fff;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}
	.asis-enviar:hover {
		background: var(--emerald-800);
	}
	.asis-enviar:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
	.asis-enviar--detener {
		background: var(--bg-base);
		color: var(--text-secondary);
	}
	.asis-enviar--detener:hover {
		background: var(--border-default);
	}
	.asis-aviso {
		margin: 0.4rem 0 0;
		font-size: 0.68rem;
		text-align: center;
		color: var(--text-very-muted);
	}
</style>
