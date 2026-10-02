<!--
	SnapshotPanel — historial de versiones de una hoja, con diff y restauración.

	Drawer lateral compartido por los canvas con versionado. El `scope` decide
	contra qué API habla:
	  · `adicionales` → snapshots por PERIODO (anio, mes)
	  · `nomina`      → snapshots por PERIODO (anio, mes) del libro de nómina
	  · `ocasional`   → snapshots por CABECERA (necesita `cabeceraId`)

	Restaurar es destructivo y cambia la geometría de la hoja, así que exige
	confirmación explícita escribiendo la palabra RESTAURAR. Un `confirm()`
	suelto se acepta por reflejo.
-->
<script lang="ts">
	import { adicionalesSnapshotsAPI, type SnapshotResumen, type SnapshotDiff } from '$lib/api/liquidaciones-terceros-adicionales-snapshots';
	import { liquidacionesTercerosOcasionalAPI } from '$lib/api/liquidaciones-terceros-ocasional';
	import { nominaCanvasAPI } from '$lib/api/nomina-canvas';
	import { recorridosSnapshotsAPI } from '$lib/api/recorridos-canvas';
	import { toast } from 'svelte-sonner';
	import { X } from 'lucide-svelte';

	interface Props {
		open: boolean;
		scope: 'adicionales' | 'ocasional' | 'nomina' | 'recorridos';
		anio: number;
		mes: number;
		/** Obligatorio cuando `scope === 'ocasional'`. */
		cabeceraId?: string | null;
		onClose: () => void;
		/** Tras restaurar: el consumidor debe releer y reconstruir esa hoja. */
		onReverted?: (mes: number) => void;
	}

	let { open, scope, anio, mes, cabeceraId = null, onClose, onReverted }: Props = $props();

	const MESES = [
		'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
		'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
	];

	let cargando = $state(false);
	let error = $state('');
	let snapshots = $state<SnapshotResumen[]>([]);
	let seleccionado = $state<SnapshotResumen | null>(null);
	let diff = $state<SnapshotDiff | null>(null);
	let cargandoDiff = $state(false);
	let confirmando = $state<SnapshotResumen | null>(null);
	let textoConfirmacion = $state('');
	let revirtiendo = $state(false);

	/// Recarga cuando se abre el panel o cambia el periodo.
	$effect(() => {
		if (!open) return;
		void cargar(anio, mes, cabeceraId);
	});

	async function cargar(a: number, m: number, cid: string | null) {
		cargando = true;
		error = '';
		seleccionado = null;
		diff = null;
		try {
			if (scope === 'adicionales') {
				snapshots = await adicionalesSnapshotsAPI.listar(a, m);
			} else if (scope === 'nomina') {
				snapshots = (await nominaCanvasAPI.listarSnapshots(a, m)) as any;
			} else if (scope === 'recorridos') {
				snapshots = (await recorridosSnapshotsAPI.listar(a, m)) as any;
			} else if (cid) {
				snapshots = (await liquidacionesTercerosOcasionalAPI.listarSnapshots(cid)) as any;
			} else {
				snapshots = [];
				error = 'Este mes no tiene borrador, así que no hay versiones que mostrar.';
			}
		} catch (e: any) {
			error = e?.message || 'No se pudo cargar el historial';
		} finally {
			cargando = false;
		}
	}

	async function seleccionar(s: SnapshotResumen) {
		seleccionado = s;
		diff = null;
		// El diff guardado en la fila es el de su captura. Para las versiones
		// automáticas no se calcula, así que se pide bajo demanda.
		if (s.diff && s.diff.length) {
			diff = { fields: s.diff };
			return;
		}
		if (scope === 'recorridos') {
			cargandoDiff = true;
			try {
				const d = await recorridosSnapshotsAPI.diff(s.id);
				// El diff de recorridos llega como lista de cambios por fila; el
				// panel pinta Campo / Antes / Después, así que se aplana aquí en
				// vez de darle otra forma al panel.
				// `path` es la CLAVE del `{#each}` del panel, así que tiene que ser
				// único: dos recorridos del mismo día con el mismo campo tocado
				// darían la misma etiqueta y Svelte aborta el render por claves
				// duplicadas. Por eso lleva el id de la fila delante, aunque solo
				// se muestre la parte legible.
				diff = {
					fields: d.cambios.map((c: any, i: number) => ({
						path: `${i + 1}. ${c.fecha ?? ''} · ${c.campo ?? c.tipo ?? 'fila'}`,
						anterior: Array.isArray(c.antes) ? c.antes.join(', ') : (c.antes ?? ''),
						nuevo: Array.isArray(c.ahora) ? c.ahora.join(', ') : (c.ahora ?? '')
					}))
				} as any;
			} catch (e) {
				console.warn('[snapshot-panel] diff de recorridos falló', e);
				diff = { fields: [] } as any;
			} finally {
				cargandoDiff = false;
			}
			return;
		}
		if (scope !== 'adicionales' && scope !== 'nomina') return;
		cargandoDiff = true;
		try {
			diff =
				scope === 'nomina'
					? await diffDeNomina(s.id)
					: await adicionalesSnapshotsAPI.diff(s.id);
		} catch (e: any) {
			console.warn('[snapshot-panel] diff falló', e);
			diff = { fields: [] };
		} finally {
			cargandoDiff = false;
		}
	}

	/**
	 * El diff de nómina llega por conductor y campo; el panel lo pinta como
	 * una lista plana de Campo / Antes / Después, así que se aplana aquí en
	 * vez de darle otra forma al panel.
	 */
	async function diffDeNomina(id: string) {
		const r: any = await nominaCanvasAPI.diffSnapshot(id);
		return {
			fields: (r?.cambios ?? []).map((c: any) => ({
				campo: `${c.nombre} · ${c.campo}`,
				antes: c.antes,
				despues: c.despues
			}))
		};
	}

	async function capturar() {
		try {
			if (scope === 'adicionales') {
				await adicionalesSnapshotsAPI.capturar(anio, mes);
			} else if (scope === 'nomina') {
				const r = await nominaCanvasAPI.capturarSnapshot(anio, mes);
				if ((r as any).sinCambios) {
					// No es un fallo: no había nada nuevo que guardar. Decirlo
					// evita que alguien pulse tres veces buscando la versión.
					toast.info('No hay cambios desde la última versión');
					await cargar(anio, mes, cabeceraId);
					return;
				}
			} else if (cabeceraId) {
				await liquidacionesTercerosOcasionalAPI.capturarManual(cabeceraId);
			}
			toast.success('Versión guardada');
			await cargar(anio, mes, cabeceraId);
		} catch (e: any) {
			toast.error(e?.message || 'No se pudo guardar la versión');
		}
	}

	async function confirmarRevertir() {
		const s = confirmando;
		if (!s || textoConfirmacion.trim().toUpperCase() !== 'RESTAURAR') return;
		revirtiendo = true;
		try {
			if (scope === 'adicionales') {
				const r = await adicionalesSnapshotsAPI.revertir(s.id);
				toast.success(
					`Restaurada la versión ${s.version}: ${r.restauradas} fila(s) en ${r.cierres_afectados} cierre(s).`
				);
				if (r.cierres_omitidos?.length) {
					// No es un fallo: es una regla de negocio. Pero el usuario
					// tiene que saber que esos cierres NO volvieron atrás.
					toast.warning(
						`${r.cierres_omitidos.length} cierre(s) se omitieron por estar en estado bloqueado: ` +
							r.cierres_omitidos.map((c) => `${c.consecutivo} (${c.estado})`).join(', '),
						{ duration: 10000 }
					);
				}
			} else if (scope === 'nomina') {
				const r = await nominaCanvasAPI.revertirSnapshot(s.id);
				toast.success(
					`Restaurada la versión ${s.version}: ${r.restauradas} liquidación(es).`
				);
				if (r.omitidas?.length) {
					// Regla de negocio, no fallo: un desprendible aprobado o
					// pagado no se reescribe. Pero el usuario tiene que saber
					// cuáles NO volvieron atrás.
					toast.warning(
						`${r.omitidas.length} liquidación(es) se omitieron por estar en estado bloqueado: ` +
							r.omitidas.map((c) => `${c.nombre} (${c.estado})`).join(', '),
						{ duration: 10000 }
					);
				}
			} else if (scope === 'recorridos') {
				const r = await recorridosSnapshotsAPI.revertir(s.id);
				toast.success(
					`Restaurada la versión ${s.version}: ${r.filasRestauradas} fila(s).`
				);
				if (r.fallidas?.length) {
					// Se revierte una transacción POR HOJA: si una falla, las demás
					// sí volvieron atrás, y el usuario tiene que saber cuáles no.
					toast.warning(
						`${r.fallidas.length} conductor(es) no se pudieron restaurar.`,
						{ duration: 10000 }
					);
				}
			} else if (cabeceraId) {
				await liquidacionesTercerosOcasionalAPI.revertirASnapshot(cabeceraId, s.id);
				toast.success(`Restaurada la versión ${s.version}`);
			}
			confirmando = null;
			textoConfirmacion = '';
			onReverted?.(mes);
			await cargar(anio, mes, cabeceraId);
		} catch (e: any) {
			toast.error(e?.message || 'No se pudo restaurar');
		} finally {
			revirtiendo = false;
		}
	}

	function fmtFecha(iso: string): string {
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
		});
	}

	function fmtValor(v: any): string {
		if (v === null || v === undefined) return '—';
		if (typeof v === 'object') return JSON.stringify(v);
		return String(v);
	}

	const ORIGEN_LABEL: Record<string, string> = {
		manual: 'Manual',
		auto: 'Automática',
		revert: 'Restauración'
	};
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="snap-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
		<aside class="snap-drawer" role="dialog" aria-modal="true" aria-label="Historial de versiones">
			<header class="snap-header">
				<div class="snap-header-copy">
					<p class="snap-eyebrow">VERSIONADO</p>
					<h2>Historial de versiones</h2>
					<p class="snap-sub">{MESES[mes - 1]} {anio}</p>
				</div>
				<div class="snap-header-actions">
					<button class="btn-primary snap-btn-sm" onclick={capturar}>Guardar versión</button>
					<button class="snap-close" onclick={onClose} aria-label="Cerrar">
						<X size={16} strokeWidth={2.5} />
					</button>
				</div>
			</header>

			{#if cargando}
				<p class="snap-msg">Cargando…</p>
			{:else if error}
				<p class="snap-msg snap-msg-error">{error}</p>
			{:else if snapshots.length === 0}
				<p class="snap-msg">
					Todavía no hay versiones guardadas de este mes. Usa «Guardar versión» para crear la primera.
				</p>
			{:else}
				<div class="snap-body">
					<ul class="snap-list">
						{#each snapshots as s (s.id)}
							<li>
								<button
									class="snap-item"
									class:snap-item-active={seleccionado?.id === s.id}
									onclick={() => seleccionar(s)}
								>
									<span class="snap-version">v{s.version}</span>
									<span class="snap-origen snap-origen-{s.origen}">
										{ORIGEN_LABEL[s.origen] ?? s.origen}
									</span>
									<span class="snap-meta">
										{fmtFecha(s.created_at)} · {s.usuario?.nombre ?? 'sistema'}
									</span>
									{#if s.totales}
										<span class="snap-meta">
											{s.totales.filas} fila(s) · {s.totales.cierres} cierre(s)
										</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>

					<section class="snap-detalle">
						{#if !seleccionado}
							<p class="snap-msg">Elige una versión para ver qué cambió.</p>
						{:else}
							<div class="snap-detalle-head">
								<h3>Versión {seleccionado.version}</h3>
								<button
									class="btn-danger snap-btn-sm"
									onclick={() => { confirmando = seleccionado; textoConfirmacion = ''; }}
								>
									Restaurar esta versión
								</button>
							</div>

							{#if cargandoDiff}
								<p class="snap-msg">Calculando diferencias…</p>
							{:else if !diff || diff.fields.length === 0}
								<p class="snap-msg">Sin diferencias respecto a la versión anterior.</p>
							{:else}
								<table class="snap-diff">
									<thead>
										<tr><th>Campo</th><th>Antes</th><th>Después</th></tr>
									</thead>
									<tbody>
										{#each diff.fields.slice(0, 200) as f (f.path)}
											<tr>
												<td class="snap-path">{f.path}</td>
												<td class="snap-antes">{fmtValor(f.anterior)}</td>
												<td class="snap-despues">{fmtValor(f.nuevo)}</td>
											</tr>
										{/each}
									</tbody>
								</table>
								{#if diff.fields.length > 200}
									<p class="snap-msg">
										Se muestran los primeros 200 de {diff.fields.length} cambios.
									</p>
								{/if}
							{/if}
						{/if}
					</section>
				</div>
			{/if}

			{#if confirmando}
				<div class="snap-confirm">
					<p>
						Vas a reemplazar <strong>todo el contenido de {MESES[mes - 1]} {anio}</strong>
						por la versión {confirmando.version}. Los cambios posteriores se perderán.
					</p>
					<p class="snap-confirm-hint">Escribe <code>RESTAURAR</code> para confirmar:</p>
					<input
						class="snap-input"
						bind:value={textoConfirmacion}
						placeholder="RESTAURAR"
						autocomplete="off"
					/>
					<div class="snap-confirm-actions">
						<button class="btn-secondary" onclick={() => { confirmando = null; textoConfirmacion = ''; }}>
							Cancelar
						</button>
						<button
							class="btn-danger"
							disabled={revirtiendo || textoConfirmacion.trim().toUpperCase() !== 'RESTAURAR'}
							onclick={confirmarRevertir}
						>
							{revirtiendo ? 'Restaurando…' : 'Restaurar'}
						</button>
					</div>
				</div>
			{/if}
		</aside>
	</div>
{/if}

<style>
	.snap-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9600;
		background: rgba(4, 31, 26, 0.45);
		display: flex;
		justify-content: flex-end;
	}
	.snap-drawer {
		width: min(760px, 100vw);
		height: 100%;
		background: var(--bg-surface);
		display: flex;
		flex-direction: column;
		box-shadow: -8px 0 32px rgba(0, 29, 23, 0.18);
	}
	.snap-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 22px;
		background: var(--bg-charcoal-deep);
	}
	.snap-header-copy {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.snap-eyebrow {
		margin: 0;
		color: rgba(255, 255, 255, 0.62);
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.12em;
	}
	.snap-header h2 {
		margin: 0;
		color: #fff;
		font-family: var(--font-display);
		font-size: 20px;
		line-height: 1.2;
		font-weight: 900;
		letter-spacing: -0.02em;
	}
	.snap-sub {
		margin: 0;
		color: rgba(255, 255, 255, 0.72);
		font-size: 13px;
	}
	.snap-header-actions { display: flex; align-items: center; gap: 10px; }
	.snap-close {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
		cursor: pointer;
	}
	.snap-close:hover { background: rgba(255, 255, 255, 0.16); }

	/* Versión compacta de `btn-*` para acciones dentro de cabeceras. */
	.snap-btn-sm {
		min-height: 36px;
		padding: 0 14px;
		border-radius: 12px;
		font-size: 13px;
		white-space: nowrap;
	}

	.snap-body {
		display: grid;
		grid-template-columns: 260px 1fr;
		flex: 1;
		min-height: 0;
		background: var(--bg-base);
	}
	.snap-list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		background: var(--bg-surface);
		border-right: 1px solid var(--border-subtle);
	}
	.snap-item {
		width: 100%;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 11px 16px;
		border: none;
		border-left: 3px solid transparent;
		border-bottom: 1px solid var(--border-subtle);
		background: none;
		cursor: pointer;
	}
	.snap-item:hover { background: var(--bg-base); }
	.snap-item-active {
		background: color-mix(in srgb, var(--accion) 8%, transparent);
		border-left-color: var(--accion);
	}
	.snap-version { font-size: 13px; font-weight: 800; color: var(--text-primary); }
	.snap-origen {
		align-self: flex-start;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--bg-base);
		color: var(--text-secondary);
	}
	.snap-origen-manual { background: rgba(22, 163, 74, 0.12); color: #166534; }
	.snap-origen-revert { background: rgba(185, 28, 28, 0.10); color: #b91c1c; }
	.snap-meta { font-size: 11px; color: var(--text-muted); }

	.snap-detalle { padding: 16px 20px; overflow-y: auto; }
	.snap-detalle-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}
	.snap-detalle-head h3 { font-size: 15px; font-weight: 800; margin: 0; color: var(--text-primary); }

	.snap-diff {
		width: 100%;
		border-collapse: collapse;
		font-size: 11.5px;
		background: var(--bg-surface);
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	.snap-diff th {
		text-align: left;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		padding: 9px 10px;
		border-bottom: 1px solid var(--border-default);
	}
	.snap-diff td { padding: 6px 10px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
	.snap-path { font-family: var(--font-mono); color: var(--text-secondary); word-break: break-all; }
	.snap-antes { color: #b91c1c; text-decoration: line-through; }
	.snap-despues { color: #166534; font-weight: 600; }

	.snap-msg { padding: 16px 18px; font-size: 13px; color: var(--text-muted); }
	.snap-msg-error { color: #b42318; }

	.snap-confirm {
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-surface);
		padding: 16px 22px;
	}
	.snap-confirm p { font-size: 13px; color: var(--text-primary); margin: 0 0 8px; }
	.snap-confirm-hint { font-size: 12px; color: var(--text-secondary) !important; }
	.snap-confirm code {
		font-family: var(--font-mono);
		background: var(--bg-base);
		padding: 1px 5px;
		border-radius: 4px;
		color: #b42318;
	}
	.snap-input {
		width: 100%;
		box-sizing: border-box;
		min-height: 42px;
		padding: 9px 12px;
		border-radius: 12px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		margin-bottom: 12px;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.snap-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.snap-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
</style>
