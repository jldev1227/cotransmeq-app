<script lang="ts">
	/**
	 * Envío de desprendibles del periodo, con constancia de lo ya enviado.
	 *
	 * ANTES ERA UN `window.confirm`. Decía cuántos se iban a mandar y nada más:
	 * ni a qué correo, ni a quién ya se le había mandado, ni quién no tiene
	 * correo. Con eso, reenviar un periodo era mandarle otra vez el desprendible
	 * a los veinte que ya lo tenían para alcanzar a los tres que faltaban, y la
	 * pregunta «¿a quién le llegó?» no tenía respuesta en la interfaz —el
	 * backend sí lo registra desde siempre, pero nadie lo miraba—.
	 *
	 * DOS COSAS QUE EL MODAL DECIDE Y NO EL USUARIO:
	 *
	 *   · Solo entran las APROBADAS. Es el primer estado que la máquina
	 *     considera bloqueado; en LIQUIDADA todavía se puede volver a BORRADOR,
	 *     y un desprendible que llega y luego cambia es peor que uno que tarda.
	 *   · Quien no tiene correo aparece, pero no se puede marcar. Esconderlo
	 *     haría que el total cuadrara y el conductor se quedara sin su
	 *     desprendible sin que nadie se entere.
	 *
	 * La preselección deja fuera a quien YA recibió el suyo: el caso corriente
	 * es completar un periodo a medias, no repetirlo entero. Reenviar sigue
	 * siendo posible marcando la casilla a mano.
	 */

	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { nominaEnviosAPI } from '$lib/api/nomina-canvas';

	export interface HojaEnviable {
		/** `null` cuando todavía no se ha generado el borrador de esa hoja. */
		liquidacionId: string | null;
		nombre: string;
		correo: string | null;
		estado: string;
	}

	export interface EnvioResumen {
		ultimo_enviado: { email_destino: string; enviado_at: string } | null;
		ultimo_error: { email_destino: string; error: string | null; created_at: string } | null;
		enviados: number;
		pruebas: number;
	}

	interface Props {
		/** TODAS las hojas del periodo; el modal aplica el filtro de estado. */
		hojas: HojaEnviable[];
		envios: Record<string, EnvioResumen>;
		etiquetaPeriodo: string;
		anio: number;
		mes: number;
		onCerrar: () => void;
		/** Se llama tras encolar, para que el canvas refresque las marcas. */
		onEnviado: () => void;
	}

	let { hojas, envios, etiquetaPeriodo, anio, mes, onCerrar, onEnviado }: Props = $props();

	const ESTADOS_ENVIABLES = ['APROBADA', 'PAGADA'];

	/// Enviable = aprobada Y con borrador generado. Sin liquidación no hay nada
	/// que mandar, aunque el estado que muestre la hoja sea el que sea.
	const aprobadas = $derived(
		hojas.filter((h) => h.liquidacionId && ESTADOS_ENVIABLES.includes(h.estado))
	);
	/// Se desglosa el «fuera» en sus dos motivos reales: una cifra sola hacía
	/// pensar que faltaba aprobar a gente que ni siquiera tiene borrador.
	const sinBorrador = $derived(hojas.filter((h) => !h.liquidacionId).length);
	const sinAprobar = $derived(hojas.length - aprobadas.length - sinBorrador);

	const resumen = (h: HojaEnviable) => (h.liquidacionId ? envios[h.liquidacionId] ?? null : null);
	const yaEnviado = (h: HojaEnviable) => !!resumen(h)?.ultimo_enviado;
	const puedeIr = (h: HojaEnviable) => !!h.correo;

	let marcados = $state<Set<string>>(new Set());
	let asunto = $state('Tu desprendible de nómina — {PERIODO}');
	let mensaje = $state('');
	let enviando = $state(false);

	/// Panel de histórico de UNA liquidación. `null` = cerrado.
	let historialDe = $state<HojaEnviable | null>(null);
	let historial = $state<any[]>([]);
	let cargandoHistorial = $state(false);

	onMount(() => {
		// Preselección: aprobadas, con correo y todavía sin enviar.
		marcados = new Set(
			aprobadas.filter((h) => puedeIr(h) && !yaEnviado(h)).map((h) => h.liquidacionId!)
		);
	});

	function alternar(id: string) {
		const s = new Set(marcados);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		marcados = s;
	}

	function marcarTodos(valor: boolean) {
		marcados = valor
			? new Set(aprobadas.filter(puedeIr).map((h) => h.liquidacionId!))
			: new Set();
	}

	async function verHistorial(h: HojaEnviable) {
		historialDe = h;
		cargandoHistorial = true;
		try {
			historial = await nominaEnviosAPI.historial(h.liquidacionId!);
		} catch {
			historial = [];
			toast.error('No se pudo cargar el histórico de envíos.');
		} finally {
			cargandoHistorial = false;
		}
	}

	async function enviar() {
		const items = aprobadas.filter((h) => marcados.has(h.liquidacionId!) && puedeIr(h));
		if (!items.length) return;
		enviando = true;
		try {
			const r = await nominaEnviosAPI.encolar({
				anio,
				mes,
				items: items.map((h) => ({ liquidacion_id: h.liquidacionId! })),
				asunto: asunto.trim() || 'Tu desprendible de nómina — {PERIODO}',
				mensaje: mensaje.trim() || null
			});
			toast.success(`${r.total} envío(s) en cola.`, {
				description: 'El progreso llega solo; puedes seguir trabajando.',
				duration: 8000
			});
			onEnviado();
			onCerrar();
		} catch (e: any) {
			toast.error(e?.response?.data?.error || e?.message || 'No se pudieron encolar los envíos.');
		} finally {
			enviando = false;
		}
	}

	function fecha(iso: string | null | undefined): string {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleString('es-CO', {
					day: '2-digit',
					month: 'short',
					hour: '2-digit',
					minute: '2-digit'
				});
	}

	const sinCorreo = $derived(aprobadas.filter((h) => !puedeIr(h)).length);
	const total = $derived(marcados.size);
</script>

<div
	class="med-bg"
	role="dialog"
	aria-modal="true"
	aria-labelledby="med-titulo"
	tabindex="-1"
	onkeydown={(e) => {
		if (e.key === 'Escape') onCerrar();
	}}
>
	<div class="med-box">
		<header class="med-hd">
			<div>
				<h2 id="med-titulo">Enviar desprendibles</h2>
				<p class="med-sub">{etiquetaPeriodo}</p>
			</div>
			<button class="med-x" onclick={onCerrar} aria-label="Cerrar">✕</button>
		</header>

		{#if aprobadas.length === 0}
			<p class="med-vacio">
				No hay ninguna hoja <b>APROBADA</b> en este periodo. Solo se envían las aprobadas: en
				LIQUIDADA la nómina todavía puede volver a borrador y cambiar después de haber salido.
			</p>
		{:else}
			<div class="med-barra">
				<span class="med-cuenta">
					{aprobadas.length} aprobada(s)
					{#if sinAprobar}<span class="med-fuera">· {sinAprobar} sin aprobar</span>{/if}
					{#if sinBorrador}<span class="med-fuera">· {sinBorrador} sin borrador</span>{/if}
					{#if sinCorreo}<span class="med-alerta">· {sinCorreo} sin correo</span>{/if}
				</span>
				<span class="med-acciones-lote">
					<button class="med-link" onclick={() => marcarTodos(true)}>Marcar todos</button>
					<button class="med-link" onclick={() => marcarTodos(false)}>Ninguno</button>
				</span>
			</div>

			<ul class="med-lista">
				{#each aprobadas as h (h.liquidacionId!)}
					{@const r = resumen(h)}
					<li class="med-fila" class:med-fila--off={!puedeIr(h)}>
						<label class="med-check">
							<input
								type="checkbox"
								checked={marcados.has(h.liquidacionId!)}
								disabled={!puedeIr(h)}
								onchange={() => alternar(h.liquidacionId!)}
							/>
							<span class="med-nombre">{h.nombre}</span>
						</label>

						<span class="med-correo" class:med-correo--falta={!h.correo}>
							{h.correo ?? 'sin correo registrado'}
						</span>

						{#if r?.ultimo_error}
							<span class="med-marca med-marca--error" title={r.ultimo_error.error ?? ''}>
								✕ rebotó {fecha(r.ultimo_error.created_at)}
							</span>
						{:else if r?.ultimo_enviado}
							<span class="med-marca med-marca--ok">
								✓ {fecha(r.ultimo_enviado.enviado_at)}
								{#if r.enviados > 1}· {r.enviados} envíos{/if}
							</span>
						{:else}
							<span class="med-marca med-marca--no">— sin enviar</span>
						{/if}

						<button
							class="med-link med-hist"
							onclick={() => verHistorial(h)}
							disabled={!r || (r.enviados === 0 && r.pruebas === 0 && !r.ultimo_error)}
							title="Ver todos los intentos de esta liquidación"
						>
							histórico
						</button>
					</li>
				{/each}
			</ul>

			<div class="med-campos">
				<label class="med-campo">
					<span>Asunto</span>
					<input type="text" bind:value={asunto} />
				</label>
				<label class="med-campo">
					<span>Mensaje (opcional)</span>
					<textarea rows="2" bind:value={mensaje} placeholder="Se añade al cuerpo del correo."
					></textarea>
				</label>
				<p class="med-pista">
					<code>{'{PERIODO}'}</code> se reemplaza por el periodo en el asunto.
				</p>
			</div>
		{/if}

		<footer class="med-ft">
			<button class="med-btn" onclick={onCerrar} disabled={enviando}>Cancelar</button>
			<button
				class="med-btn med-btn--ok"
				onclick={enviar}
				disabled={enviando || total === 0}
			>
				{enviando ? 'Encolando…' : total === 0 ? 'Nadie marcado' : `Enviar ${total}`}
			</button>
		</footer>
	</div>

	{#if historialDe}
		<!-- Panel aparte y no una fila que se despliega: el histórico de un
		     conductor puede traer cincuenta intentos y empujaría el resto de la
		     lista fuera de la vista justo cuando se está decidiendo a quién
		     mandar. -->
		<div class="med-box med-box--hist">
			<header class="med-hd">
				<div>
					<h2>Histórico de envíos</h2>
					<p class="med-sub">{historialDe.nombre}</p>
				</div>
				<button class="med-x" onclick={() => (historialDe = null)} aria-label="Cerrar">✕</button>
			</header>

			{#if cargandoHistorial}
				<p class="med-vacio">Cargando…</p>
			{:else if historial.length === 0}
				<p class="med-vacio">Sin intentos registrados para esta liquidación.</p>
			{:else}
				<ol class="med-hist-lista">
					{#each historial as ev (ev.id)}
						<li class="med-hist-fila">
							<span class="med-hist-estado med-hist-estado--{String(ev.estado).toLowerCase()}">
								{ev.estado}
							</span>
							<span class="med-hist-fecha">{fecha(ev.enviado_at ?? ev.created_at)}</span>
							<span class="med-hist-dest">{ev.email_destino}</span>
							<span class="med-hist-quien">{ev.enviado_por ?? '—'}</span>
							{#if ev.es_prueba}<span class="med-hist-prueba">prueba</span>{/if}
							{#if ev.error}<span class="med-hist-error">{ev.error}</span>{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/if}
</div>

<style>
	.med-bg {
		position: fixed;
		inset: 0;
		z-index: 9980;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 24px;
		background: rgba(15, 23, 42, 0.55);
	}

	.med-box {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: min(860px, 100%);
		max-height: min(86vh, 780px);
		padding: 16px 18px;
		background: #fff;
		color: #0f172a;
		border-radius: 12px;
		box-shadow: 0 20px 60px rgba(2, 6, 23, 0.35);
	}

	.med-box--hist {
		width: min(560px, 100%);
	}

	.med-hd {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.med-hd h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
	}
	.med-sub {
		margin: 2px 0 0;
		font-size: 12px;
		color: #64748b;
	}
	.med-x {
		border: none;
		background: transparent;
		font-size: 16px;
		cursor: pointer;
		color: #64748b;
	}

	.med-barra {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		font-size: 12px;
	}
	.med-cuenta {
		font-weight: 600;
	}
	.med-fuera {
		color: #64748b;
		font-weight: 500;
	}
	.med-alerta {
		color: #b45309;
		font-weight: 700;
	}
	.med-acciones-lote {
		display: flex;
		gap: 10px;
	}

	.med-link {
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: var(--emerald-700, #047857);
		cursor: pointer;
		text-decoration: underline;
	}
	.med-link:disabled {
		color: #cbd5e1;
		cursor: not-allowed;
		text-decoration: none;
	}

	.med-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
	}

	.med-fila {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.3fr) auto auto;
		align-items: center;
		gap: 10px;
		padding: 7px 10px;
		font-size: 12px;
		border-bottom: 1px solid #f1f5f9;
	}
	.med-fila:last-child {
		border-bottom: none;
	}
	/* Sin correo se apaga pero NO se esconde: el total cuadraría y el conductor
	   se quedaría sin desprendible sin que nadie se entere. */
	.med-fila--off {
		background: #fffbeb;
	}

	.med-check {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		cursor: pointer;
	}
	.med-nombre {
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.med-correo {
		color: #475569;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 11px;
	}
	.med-correo--falta {
		color: #b45309;
		font-style: italic;
		font-family: inherit;
	}

	.med-marca {
		border-radius: 4px;
		padding: 1px 6px;
		font-size: 10.5px;
		font-weight: 700;
		white-space: nowrap;
	}
	.med-marca--ok {
		background: #dcfce7;
		color: #166534;
	}
	.med-marca--error {
		background: #fee2e2;
		color: #991b1b;
	}
	.med-marca--no {
		background: #f1f5f9;
		color: #94a3b8;
	}

	.med-hist {
		font-size: 11px;
	}

	.med-campos {
		display: grid;
		gap: 8px;
	}
	.med-campo {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 11px;
		font-weight: 700;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.med-campo input,
	.med-campo textarea {
		font: inherit;
		font-size: 13px;
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		color: #0f172a;
		padding: 7px 9px;
		border: 1px solid #cbd5e1;
		border-radius: 7px;
		resize: vertical;
	}
	.med-campo input:focus,
	.med-campo textarea:focus {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: -1px;
	}
	.med-pista {
		margin: 0;
		font-size: 11px;
		color: #64748b;
	}

	.med-vacio {
		padding: 18px 10px;
		font-size: 13px;
		line-height: 1.5;
		color: #475569;
		text-align: center;
	}

	.med-ft {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.med-btn {
		min-height: 38px;
		padding: 0 14px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: #0f172a;
		background: #fff;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		cursor: pointer;
	}
	.med-btn--ok {
		color: #fff;
		background: var(--emerald-700, #047857);
		border-color: var(--emerald-700, #047857);
	}
	.med-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.med-hist-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.med-hist-fila {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		padding: 6px 8px;
		font-size: 11.5px;
		background: #f8fafc;
		border-radius: 6px;
	}
	.med-hist-estado {
		border-radius: 4px;
		padding: 1px 6px;
		font-size: 10px;
		font-weight: 800;
	}
	.med-hist-estado--enviado {
		background: #dcfce7;
		color: #166534;
	}
	.med-hist-estado--error {
		background: #fee2e2;
		color: #991b1b;
	}
	.med-hist-estado--enviando {
		background: #e0f2fe;
		color: #075985;
	}
	.med-hist-fecha {
		font-variant-numeric: tabular-nums;
		color: #475569;
	}
	.med-hist-dest {
		font-family: var(--font-mono, ui-monospace, monospace);
		color: #0f172a;
	}
	.med-hist-quien {
		color: #64748b;
	}
	.med-hist-prueba {
		background: #ede9fe;
		color: #5b21b6;
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 10px;
		font-weight: 700;
	}
	.med-hist-error {
		width: 100%;
		color: #b91c1c;
		overflow-wrap: anywhere;
	}
</style>
