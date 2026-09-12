<script lang="ts">
	/**
	 * Buscador de hoja del canvas de nómina.
	 *
	 * Es el mismo planteamiento que `SelectorHojaCierre` en el canvas de cierres
	 * de terceros, y por el mismo motivo: la sheet bar de Univer deja de servir
	 * pasadas ~20 pestañas —los nombres van truncados a 31 caracteres y hay que
	 * arrastrarla en horizontal para llegar al final del abecedario—. Un periodo
	 * de nómina son 25 conductores y creciendo.
	 *
	 * Lo que aporta sobre el `<select>` que había antes:
	 *
	 *   · BUSCA, por nombre o por cédula. Con un desplegable nativo hay que
	 *     recorrer la lista entera, y el nombre de un conductor no siempre se
	 *     recuerda igual que está escrito («MUNOZ» encuentra «MUÑOZ»).
	 *   · Enseña el ESTADO de cada hoja, que es lo que decide si se puede
	 *     editar, aprobar o enviar. Antes había que seleccionar una por una para
	 *     descubrir en cuál estaba cada quien.
	 *   · Enseña si el desprendible YA SE ENVIÓ. Eso no estaba en ninguna parte
	 *     de la interfaz pese a que el backend lo registra desde el principio:
	 *     la pregunta «¿a quién ya se le mandó?» solo se podía responder
	 *     mirando la base.
	 */

	import { claseBadgeEstado } from '$lib/editor/builders/nomina-estado';

	/** Lo mínimo que el selector necesita de cada hoja del libro. */
	export interface HojaSelector {
		conductorId: string;
		liquidacionId: string | null;
		nombre: string;
		cedula: string | null;
		estado: string;
		/** Cuántos días con planilla tiene; 0 se marca porque suele ser un aviso. */
		dias: number;
	}

	/** Resumen de envío por liquidación, tal cual lo devuelve `estadoPeriodo`. */
	export interface EnvioResumen {
		ultimo_enviado: { email_destino: string; enviado_at: string } | null;
		ultimo_error: { email_destino: string; error: string | null; created_at: string } | null;
		enviados: number;
		pruebas: number;
	}

	interface Props {
		hojas: HojaSelector[];
		/** Conductor cuya hoja está activa. */
		activo: string | null;
		/** `liquidacion_id → resumen`. Vacío mientras no haya cargado. */
		envios?: Record<string, EnvioResumen>;
		onSeleccionar: (conductorId: string) => void;
	}

	let { hojas, activo, envios = {}, onSeleccionar }: Props = $props();

	let abierto = $state(false);
	let busqueda = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	/** Índice resaltado para navegar con el teclado. */
	let cursor = $state(0);

	const activoObj = $derived(hojas.find((h) => h.conductorId === activo) ?? null);

	function normalizar(s: string): string {
		// Sin acentos y sin separadores: «MUNOZ» encuentra «MUÑOZ» y «1118532557»
		// encuentra «1.118.532.557».
		return (s || '')
			.toUpperCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^A-Z0-9]/g, '');
	}

	const filtrados = $derived.by(() => {
		const q = normalizar(busqueda);
		if (!q) return hojas;
		return hojas.filter(
			(h) => normalizar(h.nombre).includes(q) || normalizar(h.cedula ?? '').includes(q)
		);
	});

	/// `null` mientras no se sepa (aún no cargó el estado, o la hoja no tiene
	/// liquidación). Se distingue de «no enviada» a propósito: no es lo mismo no
	/// haber mandado nada que no poder saberlo todavía.
	function envio(h: HojaSelector): EnvioResumen | null {
		if (!h.liquidacionId) return null;
		return envios[h.liquidacionId] ?? null;
	}

	const enviadas = $derived(
		hojas.filter((h) => envio(h)?.ultimo_enviado).length
	);

	function abrir() {
		abierto = true;
		busqueda = '';
		cursor = Math.max(
			0,
			hojas.findIndex((h) => h.conductorId === activo)
		);
		queueMicrotask(() => inputEl?.focus());
	}

	function elegir(conductorId: string) {
		abierto = false;
		busqueda = '';
		onSeleccionar(conductorId);
	}

	function teclas(e: KeyboardEvent) {
		if (!abierto) return;
		if (e.key === 'Escape') {
			abierto = false;
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			cursor = Math.min(cursor + 1, filtrados.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			cursor = Math.max(cursor - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const h = filtrados[cursor];
			if (h) elegir(h.conductorId);
		}
	}

	// Al filtrar, el cursor puede quedar fuera de rango.
	$effect(() => {
		if (cursor >= filtrados.length) cursor = 0;
	});

	function fechaCorta(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
	}
</script>

<svelte:window onkeydown={teclas} />

<div class="shn">
	<button
		class="univer-btn univer-btn-dark shn-trigger"
		onclick={() => (abierto ? (abierto = false) : abrir())}
		title="Buscar un conductor por nombre o cédula"
	>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
			/>
		</svg>
		<span class="shn-actual">{activoObj ? activoObj.nombre : 'Buscar conductor'}</span>
		<!-- «enviadas / total»: es el dato que se quiere de un vistazo cuando se
		     está cerrando un periodo, y ahorra abrir el panel para contarlas. -->
		<span class="shn-cuenta" title="{enviadas} de {hojas.length} con desprendible enviado">
			{enviadas}/{hojas.length}
		</span>
	</button>

	{#if abierto}
		<!-- Capa de cierre: un clic fuera cierra el combo. `presentation` porque no
		     aporta semántica; Escape ya está en window. -->
		<div class="shn-fuera" role="presentation" onclick={() => (abierto = false)}></div>

		<div class="shn-panel">
			<input
				bind:this={inputEl}
				bind:value={busqueda}
				class="shn-input"
				type="text"
				placeholder="Nombre o cédula…"
				autocomplete="off"
			/>

			{#if filtrados.length === 0}
				<div class="shn-vacio">Ningún conductor coincide con «{busqueda}».</div>
			{:else}
				<ul class="shn-lista">
					{#each filtrados as h, i (h.conductorId)}
						{@const e = envio(h)}
						<li>
							<button
								class="shn-item"
								class:shn-item-cursor={i === cursor}
								class:shn-item-activo={h.conductorId === activo}
								onclick={() => elegir(h.conductorId)}
								onmouseenter={() => (cursor = i)}
							>
								<span class="shn-nombre">
									{h.nombre}
									{#if h.dias === 0}
										<!-- Sin planilla no es un error, pero sí algo que mirar antes
										     de aprobar: el desprendible saldría sin recargos. -->
										<em class="shn-nota" title="Sin días de planilla en el periodo">
											sin planilla
										</em>
									{/if}
								</span>
								<span class="shn-cedula">{h.cedula ?? ''}</span>

								{#if e?.ultimo_error}
									<span
										class="shn-envio shn-envio--error"
										title="Último intento falló: {e.ultimo_error.error ?? 'sin detalle'}"
									>
										✕ envío
									</span>
								{:else if e?.ultimo_enviado}
									<span
										class="shn-envio shn-envio--ok"
										title="Enviado a {e.ultimo_enviado.email_destino}"
									>
										✓ {fechaCorta(e.ultimo_enviado.enviado_at)}
									</span>
								{:else if h.liquidacionId}
									<span class="shn-envio shn-envio--no" title="Todavía sin enviar">—</span>
								{/if}

								<span class="shn-estado {claseBadgeEstado(h.estado)}">{h.estado}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.shn {
		position: relative;
	}

	.shn-trigger {
		max-width: 280px;
	}
	.shn-actual {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shn-cuenta {
		background: rgba(255, 255, 255, 0.18);
		border-radius: 999px;
		padding: 1px 7px;
		font-size: 10px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.shn-fuera {
		position: fixed;
		inset: 0;
		z-index: 55;
	}

	/* Anclado por la DERECHA, como el de cierres: el disparador vive en la mitad
	   derecha del toolbar y un panel de 420px colgando de `left: 0` se saldría de
	   la ventana, dejando el estado y el envío debajo del carril de acciones. */
	.shn-panel {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		left: auto;
		z-index: 60;
		width: 420px;
		max-width: calc(100vw - 24px);
		background: #fff;
		color: #0f172a;
		border-radius: 8px;
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
		padding: 6px;
	}

	.shn-input {
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 7px 10px;
		font-size: 12.5px;
		font-family: inherit;
		margin-bottom: 5px;
	}
	.shn-input:focus {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: -1px;
	}

	.shn-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 340px;
		overflow-y: auto;
	}

	.shn-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		border-radius: 6px;
		padding: 7px 9px;
		font-size: 12px;
		cursor: pointer;
	}
	.shn-item-cursor {
		background: #f1f5f9;
	}
	.shn-item-activo {
		box-shadow: inset 2px 0 0 var(--emerald-600, #059669);
	}

	.shn-nombre {
		flex: 1;
		min-width: 0;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shn-nota {
		font-weight: 500;
		font-style: italic;
		color: #b45309;
	}
	.shn-cedula {
		color: #64748b;
		font-variant-numeric: tabular-nums;
		font-size: 11px;
	}

	.shn-envio {
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 10px;
		font-weight: 700;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.shn-envio--ok {
		background: #dcfce7;
		color: #166534;
	}
	.shn-envio--error {
		background: #fee2e2;
		color: #991b1b;
	}
	/* El «sin enviar» va apagado a propósito: lo que tiene que saltar a la vista
	   es lo enviado y lo fallido, no la mayoría que todavía no ha salido. */
	.shn-envio--no {
		background: #f1f5f9;
		color: #94a3b8;
	}

	.shn-estado {
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 9.5px;
		font-weight: 700;
		white-space: nowrap;
	}

	.shn-vacio {
		padding: 14px 10px;
		font-size: 12.5px;
		color: #64748b;
		text-align: center;
	}
</style>
