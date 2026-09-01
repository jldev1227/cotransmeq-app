<script lang="ts">
	/**
	 * Control de estado de la hoja ACTIVA del canvas de cierres finales.
	 *
	 * Vive en la toolbar oscura, así que hereda la familia `univer-btn`.
	 *
	 * Tres cosas que no son obvias:
	 *
	 * 1. **Manda `base_version`.** N usuarios miran el mismo header a la vez.
	 *    Sin CAS, dos clics simultáneos en "Aprobar" y "Anular" los resuelve
	 *    el orden de llegada y el segundo pisa al primero. El servidor
	 *    responde 409 con el estado real y aquí se muestra en vez de callar.
	 *
	 * 2. **Los botones que pinta son los que el usuario PUEDE ejecutar**, no
	 *    todos los válidos. Un no-administrador no ve "Aprobar" en absoluto.
	 *    El servidor valida igual: esto es ergonomía, no seguridad.
	 *
	 * 3. **La acción de lote no es atómica.** Con 80 hojas, revertir las 79
	 *    buenas porque la última falló no ayuda; se muestra el parte de
	 *    fallidos con la placa de cada una.
	 */

	import { liquidacionesTercerosDescuentosAPI } from '$lib/api/liquidaciones-terceros-descuentos';
	import {
		accionesDisponibles,
		claseBadgeEstado,
		type AccionEstado
	} from '$lib/editor/builders/cierres-finales-estado';

	interface CierreActivo {
		id: string;
		placa: string;
		tercero_nombre: string;
		estado: string;
		version: number;
	}

	interface Props {
		/** Hoja activa. `null` mientras el libro carga o si no hay hojas. */
		cierre: CierreActivo | null;
		anio: number;
		mes: number;
		/** Áreas del usuario; decide qué acciones se pintan. */
		areas: string | string[] | null | undefined;
		/** Cuántas hojas del periodo están en BORRADOR (para el lote). */
		borradores?: number;
		/** El servidor aceptó el cambio: el llamador actualiza su store. */
		onCambiado?: (r: { id: string; estado: string; version: number }) => void;
		/** Cambio en lote aplicado. */
		onLoteCambiado?: (
			r: Array<{ id: string; estado: string; version: number }>
		) => void;
		/**
		 * Perdimos la carrera: el servidor manda su estado real. El llamador
		 * debe refrescar la hoja, porque puede haber pasado a solo lectura.
		 */
		onConflicto?: (r: { id: string; estado: string; version: number }) => void;
	}

	let {
		cierre,
		anio,
		mes,
		areas,
		borradores = 0,
		onCambiado,
		onLoteCambiado,
		onConflicto
	}: Props = $props();

	let abierto = $state(false);
	let enviando = $state(false);
	let mensaje = $state<{ tono: 'error' | 'ok'; texto: string } | null>(null);

	/** Acción pendiente de confirmar (las que exigen motivo, y el lote). */
	let confirmando = $state<AccionEstado | null>(null);
	let motivo = $state('');

	let loteAbierto = $state(false);
	let loteResultado = $state<{
		total: number;
		ok: number;
		fallidos: Array<{ placa: string | null; error: string }>;
	} | null>(null);

	let historialAbierto = $state(false);
	let historial = $state<
		Array<{
			id: string;
			estado_anterior: string | null;
			estado_nuevo: string;
			motivo: string | null;
			fecha: string;
			usuario: { nombre: string } | null;
		}>
	>([]);
	let historialCargando = $state(false);

	const acciones = $derived(
		cierre ? accionesDisponibles(cierre.estado, areas) : []
	);

	function cerrarMenus() {
		abierto = false;
		confirmando = null;
		motivo = '';
	}

	/** Extrae el mensaje útil de un error de axios. */
	function textoError(e: any): string {
		return e?.response?.data?.error || e?.message || 'Error desconocido';
	}

	async function ejecutar(accion: AccionEstado) {
		if (!cierre || enviando) return;

		if (accion.exigeMotivo && !motivo.trim()) {
			confirmando = accion;
			abierto = false;
			return;
		}

		enviando = true;
		mensaje = null;
		try {
			const r = await liquidacionesTercerosDescuentosAPI.cambiarEstado(
				cierre.id,
				accion.estado,
				motivo.trim() || undefined,
				cierre.version
			);
			onCambiado?.({
				id: cierre.id,
				estado: r?.estado ?? accion.estado,
				version: Number(r?.version ?? cierre.version + 1)
			});
			mensaje = { tono: 'ok', texto: `Estado: ${r?.estado ?? accion.estado}` };
			cerrarMenus();
		} catch (e: any) {
			const data = e?.response?.data;
			if (data?.code === 'VERSION_CONFLICT') {
				// No es un fallo del usuario: alguien llegó antes. Se sincroniza
				// con el servidor en vez de dejar el header mintiendo.
				onConflicto?.({
					id: cierre.id,
					estado: String(data.estado_servidor ?? cierre.estado),
					version: Number(data.version_servidor ?? cierre.version)
				});
				mensaje = {
					tono: 'error',
					texto: `Otro usuario lo dejó en ${data.estado_servidor ?? '—'}.`
				};
			} else {
				mensaje = { tono: 'error', texto: textoError(e) };
			}
			confirmando = null;
			motivo = '';
		} finally {
			enviando = false;
		}
	}

	async function ejecutarLote() {
		if (enviando) return;
		enviando = true;
		mensaje = null;
		loteResultado = null;
		try {
			const r = await liquidacionesTercerosDescuentosAPI.cambiarEstadoLote({
				anio,
				mes,
				desde: 'BORRADOR',
				hacia: 'LIQUIDADA'
			});
			loteResultado = {
				total: r.total,
				ok: r.cambiados.length,
				fallidos: r.fallidos.map((f) => ({ placa: f.placa, error: f.error }))
			};
			onLoteCambiado?.(
				r.cambiados.map((c) => ({
					id: c.id,
					estado: c.estado,
					version: c.version
				}))
			);
		} catch (e: any) {
			mensaje = { tono: 'error', texto: textoError(e) };
			loteAbierto = false;
		} finally {
			enviando = false;
		}
	}

	async function abrirHistorial() {
		if (!cierre) return;
		historialAbierto = true;
		historialCargando = true;
		try {
			historial = await liquidacionesTercerosDescuentosAPI.historialEstados(cierre.id);
		} catch (e) {
			historial = [];
			mensaje = { tono: 'error', texto: textoError(e) };
		} finally {
			historialCargando = false;
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
		if (e.key === 'Escape') {
			cerrarMenus();
			loteAbierto = false;
			historialAbierto = false;
		}
	}}
/>

<div class="ceh">
	{#if cierre}
		<span class="ceh-badge {claseBadgeEstado(cierre.estado)}" title="Estado de la hoja activa">
			{cierre.estado}
		</span>

		{#if acciones.length}
			<div class="ceh-menu-wrap">
				<button
					class="univer-btn univer-btn-dark"
					onclick={() => (abierto = !abierto)}
					disabled={enviando}
					title="Cambiar el estado de {cierre.placa}"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					Estado
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
						<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
					</svg>
				</button>

				{#if abierto}
					<div class="ceh-menu" role="menu">
						<div class="ceh-menu-head">{cierre.placa} · {cierre.tercero_nombre || 'sin tercero'}</div>
						{#each acciones as a (a.estado)}
							<button
								class="ceh-menu-item ceh-{a.tono}"
								role="menuitem"
								onclick={() => ejecutar(a)}
								disabled={enviando}
							>
								{a.etiqueta}
							</button>
						{/each}
						<div class="ceh-menu-sep"></div>
						<button class="ceh-menu-item" role="menuitem" onclick={abrirHistorial}>
							Ver historial de estados
						</button>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Sin acciones: o está en un estado terminal, o el usuario no
			     tiene permiso para moverlo. Se ofrece igualmente el historial. -->
			<button
				class="univer-btn univer-btn-dark"
				onclick={abrirHistorial}
				title="Ver quién cambió el estado y cuándo"
			>
				Historial de estados
			</button>
		{/if}
	{/if}

	{#if borradores > 0}
		<button
			class="univer-btn univer-btn-green"
			onclick={() => {
				loteResultado = null;
				loteAbierto = true;
			}}
			disabled={enviando}
			title="Pasar a LIQUIDADA las {borradores} hoja(s) en BORRADOR del periodo"
		>
			Liquidar {borradores} borrador{borradores === 1 ? '' : 'es'}
		</button>
	{/if}

	{#if mensaje}
		<span class="ceh-msg" class:ceh-msg-error={mensaje.tono === 'error'}>
			{mensaje.texto}
		</span>
	{/if}
</div>

<!-- ── Confirmación con motivo (anulación) ───────────────────────────── -->
{#if confirmando && cierre}
	<div
		class="ceh-backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) cerrarMenus();
		}}
	>
		<div class="ceh-dialog" role="dialog" aria-modal="true" aria-label="Motivo del cambio de estado" tabindex="-1">
			<h3>{confirmando.etiqueta} · {cierre.placa}</h3>
			<p class="ceh-dialog-sub">
				Esta acción queda registrada con tu nombre en el historial del cierre.
			</p>
			<label class="ceh-field">
				<span>Motivo</span>
				<textarea bind:value={motivo} rows="3" placeholder="Explica por qué se anula esta liquidación"></textarea>
			</label>
			<div class="ceh-dialog-actions">
				<button class="ceh-btn-ghost" onclick={cerrarMenus} disabled={enviando}>Cancelar</button>
				<button
					class="ceh-btn-danger"
					onclick={() => confirmando && ejecutar(confirmando)}
					disabled={enviando || !motivo.trim()}
				>
					{enviando ? 'Aplicando…' : confirmando.etiqueta}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── Lote ──────────────────────────────────────────────────────────── -->
{#if loteAbierto}
	<div
		class="ceh-backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget && !enviando) loteAbierto = false;
		}}
	>
		<div class="ceh-dialog" role="dialog" aria-modal="true" aria-label="Liquidar borradores del periodo" tabindex="-1">
			{#if !loteResultado}
				<h3>Liquidar todos los borradores</h3>
				<p class="ceh-dialog-sub">
					Se pasarán a <strong>LIQUIDADA</strong> las {borradores} hoja(s) en BORRADOR
					del periodo {String(mes).padStart(2, '0')}/{anio}. Cada hoja queda en solo
					lectura y deja registro en su historial.
				</p>
				<p class="ceh-dialog-sub">
					No es una operación atómica: si alguna falla, el resto sí se aplica y se
					te dirá cuál falló.
				</p>
				<div class="ceh-dialog-actions">
					<button class="ceh-btn-ghost" onclick={() => (loteAbierto = false)} disabled={enviando}>
						Cancelar
					</button>
					<button class="ceh-btn-primary" onclick={ejecutarLote} disabled={enviando}>
						{enviando ? 'Liquidando…' : `Liquidar ${borradores}`}
					</button>
				</div>
			{:else}
				<h3>Resultado</h3>
				<p class="ceh-dialog-sub">
					{loteResultado.ok} de {loteResultado.total} liquidada(s).
				</p>
				{#if loteResultado.fallidos.length}
					<ul class="ceh-fallidos">
						{#each loteResultado.fallidos as f, i (i)}
							<li><strong>{f.placa ?? '—'}</strong>: {f.error}</li>
						{/each}
					</ul>
				{/if}
				<div class="ceh-dialog-actions">
					<button class="ceh-btn-primary" onclick={() => (loteAbierto = false)}>Cerrar</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- ── Historial de estados ──────────────────────────────────────────── -->
{#if historialAbierto}
	<div
		class="ceh-backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) historialAbierto = false;
		}}
	>
		<div class="ceh-dialog ceh-dialog-wide" role="dialog" aria-modal="true" aria-label="Historial de estados" tabindex="-1">
			<h3>Historial de estados{cierre ? ` · ${cierre.placa}` : ''}</h3>
			{#if historialCargando}
				<p class="ceh-dialog-sub">Cargando…</p>
			{:else if !historial.length}
				<p class="ceh-dialog-sub">
					Sin registros. Los cambios anteriores a esta versión del sistema no
					quedaron guardados en tabla.
				</p>
			{:else}
				<ol class="ceh-timeline">
					{#each historial as h (h.id)}
						<li>
							<span class="ceh-tl-estado {claseBadgeEstado(h.estado_nuevo)}">{h.estado_nuevo}</span>
							<span class="ceh-tl-meta">
								{h.estado_anterior ? `desde ${h.estado_anterior} · ` : ''}{fmtFecha(h.fecha)}
								{h.usuario ? ` · ${h.usuario.nombre}` : ''}
							</span>
							{#if h.motivo}
								<span class="ceh-tl-motivo">{h.motivo}</span>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
			<div class="ceh-dialog-actions">
				<button class="ceh-btn-primary" onclick={() => (historialAbierto = false)}>Cerrar</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.ceh {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.ceh-badge {
		display: inline-flex;
		align-items: center;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.ceh-menu-wrap {
		position: relative;
	}

	.ceh-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 60;
		min-width: 220px;
		background: #fff;
		border-radius: 8px;
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
		padding: 5px;
		color: #0f172a;
	}

	.ceh-menu-head {
		padding: 6px 10px 8px;
		font-size: 11px;
		font-weight: 700;
		color: #64748b;
		border-bottom: 1px solid #e2e8f0;
		margin-bottom: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ceh-menu-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 8px 10px;
		border: none;
		background: transparent;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 600;
		color: #0f172a;
		cursor: pointer;
	}
	.ceh-menu-item:hover:not(:disabled) {
		background: #f1f5f9;
	}
	.ceh-menu-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.ceh-primario {
		color: #047857;
	}
	.ceh-peligro {
		color: #b91c1c;
	}

	.ceh-menu-sep {
		height: 1px;
		background: #e2e8f0;
		margin: 4px 0;
	}

	.ceh-msg {
		font-size: 11px;
		font-weight: 600;
		color: #a7f3d0;
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ceh-msg-error {
		color: #fca5a5;
	}

	.ceh-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: rgb(15 23 42 / 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.ceh-dialog {
		background: #fff;
		color: #0f172a;
		border-radius: 12px;
		padding: 20px;
		width: 100%;
		max-width: 420px;
		box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
	}
	.ceh-dialog-wide {
		max-width: 560px;
	}

	.ceh-dialog h3 {
		margin: 0 0 6px;
		font-size: 15px;
		font-weight: 700;
	}

	.ceh-dialog-sub {
		margin: 0 0 10px;
		font-size: 12.5px;
		line-height: 1.5;
		color: #475569;
	}

	.ceh-field {
		display: block;
		margin-bottom: 14px;
	}
	.ceh-field span {
		display: block;
		font-size: 11px;
		font-weight: 700;
		color: #475569;
		margin-bottom: 4px;
	}
	.ceh-field textarea {
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 13px;
		font-family: inherit;
		resize: vertical;
	}

	.ceh-dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 14px;
	}

	.ceh-btn-ghost,
	.ceh-btn-primary,
	.ceh-btn-danger {
		border: none;
		border-radius: 7px;
		padding: 8px 14px;
		font-size: 12.5px;
		font-weight: 700;
		cursor: pointer;
	}
	.ceh-btn-ghost {
		background: #f1f5f9;
		color: #334155;
	}
	.ceh-btn-primary {
		background: #059669;
		color: #fff;
	}
	.ceh-btn-danger {
		background: #dc2626;
		color: #fff;
	}
	.ceh-btn-ghost:disabled,
	.ceh-btn-primary:disabled,
	.ceh-btn-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.ceh-fallidos {
		margin: 0;
		padding-left: 18px;
		max-height: 220px;
		overflow-y: auto;
		font-size: 12px;
		color: #b91c1c;
	}
	.ceh-fallidos li {
		margin-bottom: 4px;
	}

	.ceh-timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 340px;
		overflow-y: auto;
	}
	.ceh-timeline li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 9px 0;
		border-bottom: 1px solid #f1f5f9;
	}
	.ceh-tl-estado {
		align-self: flex-start;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
	}
	.ceh-tl-meta {
		font-size: 11.5px;
		color: #64748b;
	}
	.ceh-tl-motivo {
		font-size: 12px;
		color: #334155;
		font-style: italic;
	}
</style>
