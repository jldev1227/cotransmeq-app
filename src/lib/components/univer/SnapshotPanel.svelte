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
	import { toast } from 'svelte-sonner';

	interface Props {
		open: boolean;
		scope: 'adicionales' | 'ocasional' | 'nomina';
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
				<div>
					<h2>Historial de versiones</h2>
					<p>{MESES[mes - 1]} {anio}</p>
				</div>
				<div class="snap-header-actions">
					<button class="snap-btn snap-btn-primary" onclick={capturar}>Guardar versión</button>
					<button class="snap-btn" onclick={onClose} aria-label="Cerrar">✕</button>
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
									class="snap-btn snap-btn-danger"
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
						<button class="snap-btn" onclick={() => { confirmando = null; textoConfirmacion = ''; }}>
							Cancelar
						</button>
						<button
							class="snap-btn snap-btn-danger"
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
		background: rgba(15, 23, 42, 0.45);
		display: flex;
		justify-content: flex-end;
	}
	.snap-drawer {
		width: min(760px, 100vw);
		height: 100%;
		background: #fff;
		display: flex;
		flex-direction: column;
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.18);
	}
	.snap-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
	}
	.snap-header h2 { font-size: 15px; font-weight: 700; color: #0f172a; margin: 0; }
	.snap-header p { font-size: 12px; color: #64748b; margin: 2px 0 0; }
	.snap-header-actions { display: flex; align-items: center; gap: 8px; }

	.snap-btn {
		border: 1px solid rgba(0, 0, 0, 0.12);
		background: #fff;
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		color: #334155;
	}
	.snap-btn:hover:not(:disabled) { background: #f8fafc; }
	.snap-btn:disabled { opacity: 0.45; cursor: not-allowed; }
	.snap-btn-primary { background: #ea580c; border-color: #ea580c; color: #fff; }
	.snap-btn-primary:hover:not(:disabled) { background: #c2410c; }
	.snap-btn-danger { background: #b91c1c; border-color: #b91c1c; color: #fff; }
	.snap-btn-danger:hover:not(:disabled) { background: #991b1b; }

	.snap-body { display: grid; grid-template-columns: 260px 1fr; flex: 1; min-height: 0; }
	.snap-list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		border-right: 1px solid rgba(0, 0, 0, 0.08);
	}
	.snap-item {
		width: 100%;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 14px;
		border: none;
		border-bottom: 1px solid rgba(0, 0, 0, 0.05);
		background: none;
		cursor: pointer;
	}
	.snap-item:hover { background: #f8fafc; }
	.snap-item-active { background: #f0fdf4; }
	.snap-version { font-size: 12px; font-weight: 700; color: #0f172a; }
	.snap-origen {
		align-self: flex-start;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 1px 6px;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.06);
		color: #475569;
	}
	.snap-origen-manual { background: rgba(249, 115, 22, 0.12); color: #c2410c; }
	.snap-origen-revert { background: rgba(185, 28, 28, 0.10); color: #b91c1c; }
	.snap-meta { font-size: 11px; color: #64748b; }

	.snap-detalle { padding: 14px 18px; overflow-y: auto; }
	.snap-detalle-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	.snap-detalle-head h3 { font-size: 13px; font-weight: 700; margin: 0; color: #0f172a; }

	.snap-diff { width: 100%; border-collapse: collapse; font-size: 11.5px; }
	.snap-diff th {
		text-align: left;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #64748b;
		padding: 6px 8px;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
	}
	.snap-diff td { padding: 5px 8px; border-bottom: 1px solid rgba(0, 0, 0, 0.04); vertical-align: top; }
	.snap-path { font-family: monospace; color: #334155; word-break: break-all; }
	.snap-antes { color: #b91c1c; text-decoration: line-through; }
	.snap-despues { color: #c2410c; font-weight: 600; }

	.snap-msg { padding: 16px 18px; font-size: 12.5px; color: #64748b; }
	.snap-msg-error { color: #b91c1c; }

	.snap-confirm {
		border-top: 1px solid rgba(0, 0, 0, 0.08);
		background: #fef2f2;
		padding: 14px 18px;
	}
	.snap-confirm p { font-size: 12.5px; color: #7f1d1d; margin: 0 0 8px; }
	.snap-confirm-hint { font-size: 11.5px; }
	.snap-confirm code {
		font-family: monospace;
		background: rgba(0, 0, 0, 0.07);
		padding: 1px 5px;
		border-radius: 3px;
	}
	.snap-input {
		width: 100%;
		border: 1px solid rgba(185, 28, 28, 0.3);
		border-radius: 8px;
		padding: 7px 10px;
		font-size: 12.5px;
		margin-bottom: 10px;
	}
	.snap-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
