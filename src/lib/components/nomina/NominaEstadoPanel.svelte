<script lang="ts">
	/**
	 * Estado de la hoja ACTIVA del canvas de nómina, en un solo desplegable.
	 *
	 * ANTES: una acción, un botón en el carril. Con la matriz de nómina eso son
	 * hasta tres iconos seguidos —«Liquidar», «Aprobar», «Anular»— que cambian
	 * de número y de sitio según el estado de la hoja, en un carril que ya lleva
	 * once acciones más. El icono del carril es un ancla visual: si se mueve
	 * cada vez que cambias de conductor, deja de serlo.
	 *
	 * AHORA: un icono fijo que abre esto. Es el patrón del canvas de cierres
	 * finales (`CierreEstadoHeader`), con una diferencia deliberada: allí el
	 * flyout contiene un botón «Estado ▾» que abre OTRO menú, porque el bloque
	 * se escribió para vivir en la barra horizontal y solo se reubicó. Aquí el
	 * flyout del carril YA es el desplegable, así que las transiciones se
	 * listan directamente y se ahorra el segundo clic.
	 *
	 * REPARTO DE TRABAJO con la página, que no es arbitrario:
	 *
	 *   · La transición de UNA hoja la ejecuta la página (`onAccion`). Es quien
	 *     tiene el overlay que cubre canvas y carril, la pestaña de Univer que
	 *     hay que repintar y el `version` con el que viaja el compare-and-swap.
	 *   · El HISTORIAL y el LOTE se resuelven aquí, con sus diálogos. No tocan
	 *     la hoja abierta —el historial ni escribe— y meterlos en la página
	 *     serían cien líneas más en un archivo que ya pasa de mil.
	 */

	import { nominaCanvasAPI, type CambioEstado } from '$lib/api/nomina-canvas';
	import {
		accionesDisponibles,
		claseBadgeEstado,
		conteoPorEstado,
		SIN_LIQUIDACION,
		type AccionEstado
	} from '$lib/editor/builders/nomina-estado';

	interface HojaActiva {
		liquidacionId: string | null;
		nombre: string;
		estado: string;
	}

	/** Una hoja del periodo que sigue en BORRADOR, para el lote. */
	interface Borrador {
		liquidacionId: string;
		nombre: string;
	}

	/** Lo mínimo de cada hoja del periodo para contarlas por estado. */
	interface HojaDelPeriodo {
		liquidacionId: string | null;
		estado: string;
	}

	interface Props {
		/** Hoja activa. `null` mientras el libro carga o si no hay hojas. */
		hoja: HojaActiva | null;
		/** Áreas del usuario: deciden qué transiciones se pintan. */
		areas: string | string[] | null | undefined;
		/** Las hojas del periodo en BORRADOR. Vacío = no se ofrece el lote. */
		borradores: Borrador[];
		/**
		 * TODAS las hojas del periodo, para el recuento por estado de la cabecera.
		 * Vacío mientras el libro carga: entonces no se pinta nada.
		 */
		hojas: HojaDelPeriodo[];
		/** Cómo se llama el periodo en los diálogos («21 jul – 20 ago 2026»). */
		periodo: string;
		/** Ejecuta la transición sobre la hoja activa. La página pone el overlay. */
		onAccion: (a: AccionEstado) => void;
		/** El lote cambió estas liquidaciones: la página repinta sus pestañas. */
		onLoteCambiado?: (cambios: CambioEstado[]) => void;
	}

	let { hoja, areas, borradores, hojas, periodo, onAccion, onLoteCambiado }: Props = $props();

	const acciones = $derived<AccionEstado[]>(
		hoja?.liquidacionId ? accionesDisponibles(hoja.estado, areas) : []
	);

	/**
	 * Color del chip SOBRE FONDO OSCURO.
	 *
	 * `claseBadgeEstado` no vale aquí y hay que decirlo: son clases pensadas
	 * para fondo claro, y PAGADA es `text-emerald-900` (#064E3B) sobre un 10%
	 * de opacidad. En este panel eso desaparece —y es justo el estado que uno
	 * viene a mirar—. Los tonos son los de la PESTAÑA de cada hoja
	 * (`COLOR_HOJA_POR_ESTADO`) aclarados hasta que se leen aquí, así que la
	 * asociación color→estado sigue siendo la misma del libro.
	 *
	 * PAGADA va RELLENA en vez de en contorno: es el final del recorrido y
	 * «aprobada» y «pagada» en dos verdes de contorno se confunden de un
	 * vistazo, que es la única forma en que se mira esto.
	 */
	const CHIP: Record<string, { color: string; fondo: string }> = {
		BORRADOR: { color: '#CBD5E1', fondo: 'rgba(255, 255, 255, 0.1)' },
		LIQUIDADA: { color: '#7DD3FC', fondo: 'rgba(14, 165, 233, 0.16)' },
		APROBADA: { color: '#86EFAC', fondo: 'rgba(22, 163, 74, 0.2)' },
		PAGADA: { color: '#06281B', fondo: '#34D399' },
		ANULADA: { color: '#FCA5A5', fondo: 'rgba(185, 28, 28, 0.24)' }
	};

	const CHIP_DESCONOCIDO = { color: '#CBD5E1', fondo: 'rgba(255, 255, 255, 0.1)' };

	// «Sin liquidación» no es un estado, así que no lleva el color de ninguno:
	// apenas un contorno, que pone `.nep-tally-sin`.
	CHIP[SIN_LIQUIDACION] = { color: 'rgba(255, 255, 255, 0.6)', fondo: 'transparent' };

	/**
	 * Los chips del recuento: `conteoPorEstado` decide QUÉ se cuenta —incluido
	 * el grupo aparte de las hojas sin liquidación— y aquí solo se les pone
	 * nombre y color.
	 *
	 * Responde la pregunta de cerrar un periodo —«¿cuántas quedan sin
	 * aprobar?»— que no se podía hacer en ninguna parte del canvas: la insignia
	 * de la barra es de la hoja abierta, el chip del selector cuenta
	 * DESPRENDIBLES ENVIADOS (de ahí que diga 0/24 con una hoja ya pagada) y el
	 * badge del carril solo cuenta borradores. Había que abrir el selector y
	 * recorrer las 24 a ojo.
	 */
	const conteo = $derived(
		conteoPorEstado(hojas).map((g) => ({
			...g,
			etiqueta: g.clave === SIN_LIQUIDACION ? 'sin liquidación' : g.clave.toLowerCase(),
			...(CHIP[g.clave] ?? CHIP_DESCONOCIDO)
		}))
	);

	let enviando = $state(false);
	let mensaje = $state<{ tono: 'error' | 'ok'; texto: string } | null>(null);

	let loteAbierto = $state(false);
	let loteResultado = $state<{
		total: number;
		ok: number;
		fallidos: Array<{ nombre: string; error: string }>;
	} | null>(null);

	let historialAbierto = $state(false);
	let historialCargando = $state(false);
	let historial = $state<
		Array<{
			id: string;
			estado_anterior: string | null;
			estado_nuevo: string;
			motivo: string | null;
			created_at: string;
			usuario: { id: string; nombre: string | null } | null;
		}>
	>([]);

	/** El mensaje útil de un error de axios, no el «Request failed». */
	function textoError(e: any): string {
		return e?.response?.data?.error || e?.message || 'Error desconocido';
	}

	async function abrirHistorial() {
		if (!hoja?.liquidacionId) return;
		historialAbierto = true;
		historialCargando = true;
		mensaje = null;
		try {
			historial = await nominaCanvasAPI.historialEstados(hoja.liquidacionId);
		} catch (e) {
			historial = [];
			mensaje = { tono: 'error', texto: textoError(e) };
		} finally {
			historialCargando = false;
		}
	}

	/**
	 * Pasa a LIQUIDADA todos los borradores del periodo.
	 *
	 * **No es atómico, y es a propósito** (el servidor tampoco lo hace así):
	 * con 25 conductores, deshacer los 24 que salieron bien porque el último
	 * falló no ayuda a nadie. Se enseña el parte con el nombre de cada uno.
	 */
	async function ejecutarLote() {
		if (enviando || !borradores.length) return;
		enviando = true;
		mensaje = null;
		loteResultado = null;
		try {
			const r = await nominaCanvasAPI.cambiarEstadoLote({
				ids: borradores.map((b) => b.liquidacionId),
				estado: 'LIQUIDADA'
			});
			const nombrePor = new Map(borradores.map((b) => [b.liquidacionId, b.nombre]));
			loteResultado = {
				total: r.total,
				ok: r.cambiados.length,
				fallidos: r.fallidos.map((f) => ({
					nombre: nombrePor.get(f.id) ?? f.id,
					error: f.error
				}))
			};
			onLoteCambiado?.(r.cambiados);
		} catch (e) {
			mensaje = { tono: 'error', texto: textoError(e) };
			loteAbierto = false;
		} finally {
			enviando = false;
		}
	}

	function fmtFecha(iso: string): string {
		try {
			return new Date(iso).toLocaleString('es-CO', {
				day: '2-digit',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		loteAbierto = false;
		historialAbierto = false;
	}}
/>

<div class="nep" role="menu">
	{#if hoja}
		<div class="nep-head">
			<span class="nep-nombre">{hoja.nombre}</span>
			<!-- Mismo motivo que los chips de abajo: la insignia clara se apagaba
			     sobre este panel, y PAGADA era la peor de todas. -->
			<span
				class="nep-badge"
				style="color: {(CHIP[hoja.estado] ?? CHIP_DESCONOCIDO).color}; background: {(
					CHIP[hoja.estado] ?? CHIP_DESCONOCIDO
				).fondo};"
			>
				{hoja.estado}
			</span>
		</div>
	{/if}

	<!-- El recuento del PERIODO, no de la hoja: va fuera del `{#if hoja}` porque
	     sigue sirviendo con el libro abierto y ninguna hoja seleccionada. -->
	{#if conteo.length}
		<div class="nep-tally">
			{#each conteo as c (c.clave)}
				<span
					class="nep-tally-chip"
					class:nep-tally-sin={c.clave === SIN_LIQUIDACION}
					style="color: {c.color}; background: {c.fondo};"
					title="{c.n} de {hojas.length} hojas del periodo"
				>
					<b>{c.n}</b>
					{c.etiqueta}
				</span>
			{/each}
		</div>
	{/if}

	{#if !hoja}
		<p class="nep-vacio">Abre la hoja de un conductor para cambiar su estado.</p>
	{:else if !hoja.liquidacionId}
		<p class="nep-vacio">
			Este conductor todavía no tiene liquidación en el periodo, así que no hay estado que mover.
			Créala con «Generar borradores».
		</p>
	{:else if !acciones.length}
		<!-- Sin acciones por una de dos razones, y las dos se explican: el estado
		     es terminal, o sacarla de donde está es cosa de Administración. -->
		<p class="nep-vacio">
			{hoja.estado === 'ANULADA'
				? 'Una liquidación anulada no vuelve: es un estado final.'
				: `Está en ${hoja.estado} y solo Administración puede moverla de ahí.`}
		</p>
	{:else}
		{#each acciones as a (a.estado)}
			<button
				type="button"
				class="nep-item nep-{a.tono}"
				role="menuitem"
				onclick={() => onAccion(a)}
			>
				<span class="nep-ico">
					{#if a.estado === 'LIQUIDADA' && !a.reversion}
						<!-- Calculadora: liquidar es hacer las cuentas. -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<rect x="5" y="3" width="14" height="18" rx="2" />
							<path
								stroke-linecap="round"
								d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h4"
							/>
						</svg>
					{:else if a.estado === 'APROBADA' && !a.reversion}
						<!-- Sello: aprobar congela el documento. -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 3l2.5 1.6 3-.3 1 2.8 2.4 1.8-1.3 2.7 1.3 2.7-2.4 1.8-1 2.8-3-.3L12 20l-2.5-1.6-3 .3-1-2.8L3.1 14l1.3-2.7L3.1 8.6l2.4-1.8 1-2.8 3 .3z"
							/>
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4" />
						</svg>
					{:else if a.estado === 'PAGADA'}
						<!-- Billete: pagada es que el dinero salió. -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<rect x="2" y="6" width="20" height="12" rx="2" />
							<circle cx="12" cy="12" r="2.5" />
							<path stroke-linecap="round" d="M6 12h.01M18 12h.01" />
						</svg>
					{:else if a.estado === 'ANULADA'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<circle cx="12" cy="12" r="9" />
							<path stroke-linecap="round" d="M6 6l12 12" />
						</svg>
					{:else}
						<!-- Flecha de vuelta: cualquier reversión deshace un paso. -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 14l-5-5 5-5" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 9h10a6 6 0 010 12H8" />
						</svg>
					{/if}
				</span>
				<span class="nep-etiqueta">{a.etiqueta}</span>
				{#if a.exigeMotivo}
					<span class="nep-nota">pide motivo</span>
				{/if}
			</button>
		{/each}
	{/if}

	<div class="nep-sep"></div>

	<button
		type="button"
		class="nep-item"
		role="menuitem"
		onclick={abrirHistorial}
		disabled={!hoja?.liquidacionId}
	>
		<span class="nep-ico">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
				<circle cx="12" cy="12" r="9" />
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 7.5V12l3 2" />
			</svg>
		</span>
		<span class="nep-etiqueta">Historial de estados</span>
	</button>

	{#if borradores.length}
		<div class="nep-sep"></div>
		<button
			type="button"
			class="nep-item nep-primario"
			role="menuitem"
			onclick={() => {
				loteResultado = null;
				loteAbierto = true;
			}}
			disabled={enviando}
		>
			<span class="nep-ico">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<path stroke-linecap="round" stroke-linejoin="round" d="M4 7h10M4 12h10M4 17h6" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.5 16.5l2 2 4-4" />
				</svg>
			</span>
			<span class="nep-etiqueta">
				Liquidar {borradores.length} borrador{borradores.length === 1 ? '' : 'es'}
			</span>
		</button>
	{/if}

	{#if mensaje}
		<p class="nep-msg" class:nep-msg-error={mensaje.tono === 'error'}>{mensaje.texto}</p>
	{/if}
</div>

<!-- ── Lote ──────────────────────────────────────────────────────────── -->
{#if loteAbierto}
	<div
		class="nep-backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget && !enviando) loteAbierto = false;
		}}
	>
		<div
			class="nep-dialog"
			role="dialog"
			aria-modal="true"
			aria-label="Liquidar los borradores del periodo"
			tabindex="-1"
		>
			{#if !loteResultado}
				<h3>Liquidar todos los borradores</h3>
				<p class="nep-dialog-sub">
					Pasan a <strong>LIQUIDADA</strong> las {borradores.length} hoja(s) que siguen en BORRADOR en
					{periodo}. Cada una deja registro en su historial.
				</p>
				<p class="nep-dialog-sub">
					En LIQUIDADA la hoja se sigue editando —bonos, vacaciones, conceptos—, pero ya no se
					pueden volver a traer los días desde las planillas.
				</p>
				<p class="nep-dialog-sub">
					No es una operación atómica: si alguna falla, el resto sí se aplica y aquí se dice cuál
					falló.
				</p>
				<ul class="nep-lista">
					{#each borradores as b (b.liquidacionId)}
						<li>{b.nombre}</li>
					{/each}
				</ul>
				<div class="nep-dialog-actions">
					<button class="nep-btn-ghost" onclick={() => (loteAbierto = false)} disabled={enviando}>
						Cancelar
					</button>
					<button class="nep-btn-primary" onclick={ejecutarLote} disabled={enviando}>
						{enviando ? 'Liquidando…' : `Liquidar ${borradores.length}`}
					</button>
				</div>
			{:else}
				<h3>Resultado</h3>
				<p class="nep-dialog-sub">
					{loteResultado.ok} de {loteResultado.total} liquidada(s).
				</p>
				{#if loteResultado.fallidos.length}
					<ul class="nep-fallidos">
						{#each loteResultado.fallidos as f, i (i)}
							<li><strong>{f.nombre}</strong>: {f.error}</li>
						{/each}
					</ul>
				{/if}
				<div class="nep-dialog-actions">
					<button class="nep-btn-primary" onclick={() => (loteAbierto = false)}>Cerrar</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- ── Historial de estados ──────────────────────────────────────────── -->
{#if historialAbierto}
	<div
		class="nep-backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) historialAbierto = false;
		}}
	>
		<div
			class="nep-dialog nep-dialog-wide"
			role="dialog"
			aria-modal="true"
			aria-label="Historial de estados"
			tabindex="-1"
		>
			<h3>Historial de estados{hoja ? ` · ${hoja.nombre}` : ''}</h3>
			{#if historialCargando}
				<p class="nep-dialog-sub">Cargando…</p>
			{:else if !historial.length}
				<p class="nep-dialog-sub">
					Sin registros. Los cambios anteriores a esta versión del sistema no quedaron guardados en
					tabla.
				</p>
			{:else}
				<ol class="nep-timeline">
					{#each historial as h (h.id)}
						<li>
							<span class="nep-tl-estado {claseBadgeEstado(h.estado_nuevo)}">
								{h.estado_nuevo}
							</span>
							<span class="nep-tl-meta">
								{h.estado_anterior ? `desde ${h.estado_anterior} · ` : ''}{fmtFecha(h.created_at)}
								{h.usuario?.nombre ? ` · ${h.usuario.nombre}` : ''}
							</span>
							{#if h.motivo}
								<span class="nep-tl-motivo">{h.motivo}</span>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
			<div class="nep-dialog-actions">
				<button class="nep-btn-primary" onclick={() => (historialAbierto = false)}>Cerrar</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* El desplegable vive dentro del flyout OSCURO del carril
	   (`panelTone: 'dark'`), así que el texto va en claro. Los diálogos, en
	   cambio, son blancos: son ventanas propias, no parte de la barra. */
	.nep {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.nep-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 0 4px 8px;
		margin-bottom: 4px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.12);
	}
	.nep-nombre {
		font-size: 11.5px;
		font-weight: 700;
		color: rgba(255, 255, 255, 0.75);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.nep-badge {
		flex: none;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.nep-tally {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 0 4px 8px;
		margin-bottom: 4px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.12);
	}
	.nep-tally-chip {
		padding: 1px 7px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}
	.nep-tally-chip b {
		font-weight: 800;
	}
	/* «Sin liquidación» no es un estado, así que no lleva el color de ninguno:
	   apenas un contorno sobre el panel oscuro. */
	.nep-tally-sin {
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
	}

	.nep-vacio {
		margin: 2px 4px 6px;
		font-size: 11.5px;
		line-height: 1.45;
		color: rgba(255, 255, 255, 0.55);
	}

	.nep-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 7px 8px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: #e2e8f0;
		font-size: 12.5px;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.nep-item:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
	}
	.nep-item:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.nep-ico {
		flex: none;
		display: flex;
		align-items: center;
	}
	.nep-ico :global(svg) {
		width: 16px;
		height: 16px;
	}
	.nep-etiqueta {
		flex: 1 1 auto;
		min-width: 0;
	}
	.nep-nota {
		flex: none;
		font-size: 10px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.45);
	}

	/* Avanzar en el flujo se pinta; deshacer se deja en el gris del menú. Ver
	   `esReversion()` en el builder: el tono lo decide la dirección.

	   El acento sale del TOKEN y no de un hex: `--emerald-*` es verde en
	   transmeralda y naranja en cotransmeq (ver `app.css`), así que este
	   archivo es el mismo en los dos repos y el diff que los compara no tiene
	   que llevar tres excepciones de color a cuestas. */
	.nep-primario {
		color: var(--emerald-500, #10b981);
	}
	.nep-peligro {
		color: #fca5a5;
	}

	.nep-sep {
		height: 1px;
		margin: 5px 0;
		background: rgba(255, 255, 255, 0.12);
	}

	.nep-msg {
		margin: 6px 4px 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--emerald-500, #10b981);
	}
	.nep-msg-error {
		color: #fca5a5;
	}

	/* ─── Diálogos ──────────────────────────────────────────────────── */
	.nep-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: rgb(15 23 42 / 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.nep-dialog {
		background: #fff;
		color: #0f172a;
		border-radius: 12px;
		padding: 20px;
		width: 100%;
		max-width: 440px;
		box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
	}
	.nep-dialog-wide {
		max-width: 560px;
	}
	.nep-dialog h3 {
		margin: 0 0 6px;
		font-size: 15px;
		font-weight: 700;
	}
	.nep-dialog-sub {
		margin: 0 0 10px;
		font-size: 12.5px;
		line-height: 1.5;
		color: #475569;
	}

	.nep-lista {
		margin: 0;
		padding-left: 18px;
		max-height: 160px;
		overflow-y: auto;
		font-size: 12px;
		color: #334155;
	}

	.nep-dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 14px;
	}
	.nep-btn-ghost,
	.nep-btn-primary {
		border: none;
		border-radius: 7px;
		padding: 8px 14px;
		font-size: 12.5px;
		font-weight: 700;
		cursor: pointer;
	}
	.nep-btn-ghost {
		background: #f1f5f9;
		color: #334155;
	}
	.nep-btn-primary {
		background: var(--emerald-600, #059669);
		color: #fff;
	}
	.nep-btn-ghost:disabled,
	.nep-btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.nep-fallidos {
		margin: 0;
		padding-left: 18px;
		max-height: 220px;
		overflow-y: auto;
		font-size: 12px;
		color: #b91c1c;
	}
	.nep-fallidos li {
		margin-bottom: 4px;
	}

	.nep-timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 340px;
		overflow-y: auto;
	}
	.nep-timeline li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 9px 0;
		border-bottom: 1px solid #f1f5f9;
	}
	.nep-tl-estado {
		align-self: flex-start;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
	}
	.nep-tl-meta {
		font-size: 11.5px;
		color: #64748b;
	}
	.nep-tl-motivo {
		font-size: 12px;
		color: #334155;
		font-style: italic;
	}
</style>
