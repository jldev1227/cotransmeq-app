<script lang="ts">
	/**
	 * Conductores de un cierre: quiénes entran, cuántos días y cuál es el
	 * propietario del vehículo.
	 *
	 * QUÉ RESUELVE. La sección «DESCUENTOS POR LA PRESTACIÓN DEL SERVICIO» es
	 * un recuadro por conductor —salario, prestaciones, seguridad social— y
	 * hasta ahora solo podía nacer de la nómina del mes. Si un conductor no
	 * estaba liquidado en nómina no había forma de añadirlo, y si sobraba uno
	 * no había forma de quitarlo.
	 *
	 * POR QUÉ IMPORTA LA MARCA DE PROPIETARIO. Al dueño del vehículo no se le
	 * imputan DOTACION ni EXAMEN_MEDICO: los dos se calculan sobre los días
	 * de los conductores NO propietarios. Marcarlo mal no es cosmético, cambia
	 * el valor a pagar. Por eso el pie del modal muestra en vivo los días que
	 * quedan causando esos gastos: la consecuencia se ve antes de guardar, no
	 * después en la hoja.
	 *
	 * POR QUÉ CASILLA Y NO BOTÓN DE RADIO. En la práctica el propietario es
	 * uno, y un radio se leería mejor. Pero el dato es un booleano POR
	 * conductor (`es_propietario_overrides`), así que un radio no podría
	 * representar un cierre que ya tuviera dos marcados y al guardar
	 * descartaría uno en silencio. La casilla dice exactamente lo que hay.
	 *
	 * EL GUARDADO ES UN REEMPLAZO, no un delta: se manda la lista final y el
	 * servidor deduce altas y bajas. Mandar las dos cosas por separado abriría
	 * la puerta a que una petición perdida dejara el cierre a medias.
	 */

	import { onMount } from 'svelte';
	import {
		liquidacionesTercerosDescuentosAPI,
		type ConceptoDescuento,
		type ConductorSelect
	} from '$lib/api/liquidaciones-terceros-descuentos';
	import { claveConductor } from '$lib/editor/builders/cierres-finales.builder';

	interface Props {
		cierreId: string;
		placa: string;
		periodo: string;
		/// Conceptos del cierre. De aquí salen los conductores ya presentes.
		conceptos: ConceptoDescuento[];
		/// Mapa `0::conductorId` → es propietario, tal y como lo entrega el detalle.
		propietarios: Record<string, boolean>;
		onClose: () => void;
		/// Se llama tras un guardado correcto; la page recarga y remonta la hoja.
		onGuardado: (r: { agregados: number; eliminados: number }) => void | Promise<void>;
	}

	let { cierreId, placa, periodo, conceptos, propietarios, onClose, onGuardado }: Props =
		$props();

	/**
	 * Días de partida de un conductor nuevo: CERO.
	 *
	 * Espejo de `BLOQUE_CONDUCTOR_MANUAL.DIAS_POR_DEFECTO` en el servidor, que
	 * es quien manda: si divergen, el modal enseñaría un número y la hoja
	 * saldría con otro.
	 *
	 * Cero y no un mes completo porque los días trabajados son un dato del
	 * mes, no una suposición: un valor sembrado mete plata en la liquidación
	 * que nadie tecleó. Lo que sí llega puesto es el precio unitario de cada
	 * concepto, que es tarifa.
	 *
	 * Valen para SALARIO y AUXILIO_TRANSPORTE, los dos que se cuentan por día
	 * trabajado. BONIFICACION (bonos) y RECARGOS (horas) también nacen en cero
	 * y se ajustan en la hoja.
	 */
	const DIAS_POR_DEFECTO = 0;

	interface Seleccionado {
		id: string;
		nombre: string;
		identificacion: string;
		dias: number;
		esPropietario: boolean;
		/// Ya estaba en el cierre al abrir el modal. Cambia el aviso al quitarlo.
		yaEstaba: boolean;
	}

	let catalogo = $state<ConductorSelect[]>([]);
	let cargandoCatalogo = $state(true);
	let errorCatalogo = $state('');
	let busqueda = $state('');
	let guardando = $state(false);
	let errorGuardado = $state('');

	let seleccion = $state<Seleccionado[]>(iniciales());

	/**
	 * Estado de partida, leído de los conceptos del cierre.
	 *
	 * La fila de SALARIO es la que define el bloque de un conductor: es la
	 * única que lleva `dias`, y las prestaciones cuelgan de ella.
	 */
	function iniciales(): Seleccionado[] {
		const out: Seleccionado[] = [];
		const vistos = new Set<string>();
		for (const c of conceptos ?? []) {
			if (c.tipo !== 'COSTO_LABORAL' || c.concepto !== 'SALARIO') continue;
			const id = c.conductor_id;
			if (!id || vistos.has(id)) continue;
			vistos.add(id);
			const nom = [c.conductor?.nombre, c.conductor?.apellido].filter(Boolean).join(' ');
			out.push({
				id,
				nombre: nom || 'Conductor sin nombre',
				identificacion: c.conductor?.numero_identificacion || '',
				dias: Number(c.dias) || 0,
				esPropietario: propietarios?.[claveConductor(id)] === true,
				yaEstaba: true
			});
		}
		return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
	}

	const seleccionados = $derived(new Set(seleccion.map((s) => s.id)));

	const filtrados = $derived.by(() => {
		const q = busqueda.trim().toLowerCase();
		if (!q) return catalogo;
		return catalogo.filter((c) => {
			const nom = `${c.nombre} ${c.apellido}`.toLowerCase();
			return nom.includes(q) || (c.numero_identificacion ?? '').toLowerCase().includes(q);
		});
	});

	/**
	 * Días que causan DOTACION y EXAMEN_MEDICO.
	 *
	 * Es la misma cuenta que hace `totalDiasNoPropietarios` en el servidor.
	 * Aquí se reproduce SOLO para previsualizar: no se manda, no se guarda y
	 * no decide nada. Lo que vale es lo que recalcula el backend al guardar.
	 */
	const diasQueCausanGastos = $derived(
		seleccion.reduce((s, c) => (c.esPropietario ? s : s + (Number(c.dias) || 0)), 0)
	);

	const hayCambios = $derived.by(() => {
		const antes = iniciales();
		if (antes.length !== seleccion.length) return true;
		const porId = new Map(antes.map((a) => [a.id, a]));
		return seleccion.some((s) => {
			const a = porId.get(s.id);
			return !a || a.dias !== s.dias || a.esPropietario !== s.esPropietario;
		});
	});

	function alternar(c: ConductorSelect) {
		const i = seleccion.findIndex((s) => s.id === c.id);
		if (i >= 0) {
			seleccion = seleccion.filter((s) => s.id !== c.id);
			return;
		}
		seleccion = [
			...seleccion,
			{
				id: c.id,
				nombre: [c.nombre, c.apellido].filter(Boolean).join(' '),
				identificacion: c.numero_identificacion || '',
				dias: DIAS_POR_DEFECTO,
				esPropietario: false,
				yaEstaba: false
			}
		].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
	}

	function quitar(id: string) {
		seleccion = seleccion.filter((s) => s.id !== id);
	}

	function fijarDias(id: string, valor: string) {
		const n = Number(valor);
		seleccion = seleccion.map((s) =>
			s.id === id ? { ...s, dias: Number.isFinite(n) && n >= 0 ? n : 0 } : s
		);
	}

	function fijarPropietario(id: string, valor: boolean) {
		seleccion = seleccion.map((s) => (s.id === id ? { ...s, esPropietario: valor } : s));
	}

	async function guardar() {
		if (guardando) return;
		guardando = true;
		errorGuardado = '';
		try {
			const r = await liquidacionesTercerosDescuentosAPI.sincronizarConductores(
				cierreId,
				seleccion.map((s) => ({
					conductor_id: s.id,
					dias: s.dias,
					es_propietario: s.esPropietario
				}))
			);
			await onGuardado({
				agregados: r.agregados?.length ?? 0,
				eliminados: r.eliminados?.length ?? 0
			});
		} catch (e: any) {
			errorGuardado =
				e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Error desconocido';
			guardando = false;
		}
	}

	onMount(async () => {
		try {
			catalogo = await liquidacionesTercerosDescuentosAPI.listarConductoresSelect();
		} catch (e: any) {
			errorCatalogo = e?.message || 'No se pudo cargar el listado de conductores';
		} finally {
			cargandoCatalogo = false;
		}
	});

	function alTeclado(e: KeyboardEvent) {
		if (e.key === 'Escape' && !guardando) onClose();
	}
</script>

<svelte:window onkeydown={alTeclado} />

<div class="ccm-backdrop">
	<div class="ccm" role="dialog" aria-modal="true" aria-labelledby="ccm-titulo">
		<div class="ccm-head">
			<div>
				<h2 id="ccm-titulo">Conductores de {placa}</h2>
				<p class="ccm-sub">
					{periodo} · define los recuadros de descuentos por la prestación del servicio
				</p>
			</div>
			<button class="ccm-x" onclick={onClose} disabled={guardando} aria-label="Cerrar">×</button>
		</div>

		<div class="ccm-body">
			<!-- ── Catálogo ─────────────────────────────────────────── -->
			<section class="ccm-pane">
				<label class="ccm-buscador">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="11" cy="11" r="7" />
						<path d="M21 21l-4.35-4.35" stroke-linecap="round" />
					</svg>
					<input
						type="search"
						bind:value={busqueda}
						placeholder="Buscar por nombre o cédula…"
						disabled={cargandoCatalogo || !!errorCatalogo}
					/>
				</label>

				{#if cargandoCatalogo}
					<p class="ccm-vacio">Cargando conductores…</p>
				{:else if errorCatalogo}
					<p class="ccm-vacio ccm-error">{errorCatalogo}</p>
				{:else if filtrados.length === 0}
					<p class="ccm-vacio">Ningún conductor coincide con «{busqueda}».</p>
				{:else}
					<ul class="ccm-lista">
						{#each filtrados as c (c.id)}
							{@const dentro = seleccionados.has(c.id)}
							<li>
								<button
									type="button"
									class="ccm-fila"
									class:ccm-fila-dentro={dentro}
									onclick={() => alternar(c)}
									disabled={guardando}
								>
									<span class="ccm-check" aria-hidden="true">{dentro ? '✓' : '+'}</span>
									<span class="ccm-nom">
										<strong>{c.nombre} {c.apellido}</strong>
										<small>{c.numero_identificacion || 'sin identificación'}</small>
									</span>
									{#if dentro}<span class="ccm-tag">en el cierre</span>{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- ── Seleccionados ────────────────────────────────────── -->
			<section class="ccm-pane ccm-pane-sel">
				<h3>En este cierre ({seleccion.length})</h3>

				{#if seleccion.length === 0}
					<p class="ccm-vacio">
						Sin conductores. La sección de descuentos por la prestación del servicio
						quedará vacía.
					</p>
				{:else}
					<ul class="ccm-sel">
						{#each seleccion as s (s.id)}
							<li class="ccm-sel-item">
								<div class="ccm-sel-head">
									<span class="ccm-nom">
										<strong>{s.nombre}</strong>
										<small>{s.identificacion || 'sin identificación'}</small>
									</span>
									<button
										type="button"
										class="ccm-quitar"
										onclick={() => quitar(s.id)}
										disabled={guardando}
										title={s.yaEstaba
											? 'Da de baja su recuadro completo del cierre'
											: 'Quitar de la selección'}
										aria-label="Quitar {s.nombre}"
									>×</button>
								</div>

								<div class="ccm-sel-campos">
									<label class="ccm-dias">
										<span>Días</span>
										<input
											type="number"
											min="0"
											max="31"
											step="1"
											value={s.dias}
											oninput={(e) => fijarDias(s.id, e.currentTarget.value)}
											disabled={guardando}
										/>
									</label>

									<label class="ccm-prop" class:ccm-prop-on={s.esPropietario}>
										<input
											type="checkbox"
											checked={s.esPropietario}
											onchange={(e) => fijarPropietario(s.id, e.currentTarget.checked)}
											disabled={guardando}
										/>
										<span>
											Propietario del vehículo
											<small>no causa dotación ni examen médico</small>
										</span>
									</label>
								</div>

								{#if !s.yaEstaba}
									<p class="ccm-nuevo">
										Se creará su recuadro: salario, auxilio de transporte,
										bonificación, bonificación por turno doble y recargos, más
										prestaciones sociales y seguridad social. Las filas llegan con
										su valor unitario y en <strong>cantidad cero</strong>: los
										días, bonos, turnos y horas se teclean en la hoja.
									</p>
								{:else if s.dias !== iniciales().find((i) => i.id === s.id)?.dias}
									<p class="ccm-aviso">
										Cambiar los días recalcula el salario, el auxilio de transporte y
										sus prestaciones.
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<div class="ccm-foot">
			<p class="ccm-base">
				Días que causan dotación y examen médico:
				<strong>{diasQueCausanGastos}</strong>
				{#if seleccion.some((s) => s.esPropietario)}
					<small>
						({seleccion.filter((s) => s.esPropietario).length} propietario(s) excluido(s))
					</small>
				{/if}
			</p>

			{#if errorGuardado}
				<p class="ccm-error">{errorGuardado}</p>
			{/if}

			<div class="ccm-acciones">
				<button class="ccm-btn-ghost" onclick={onClose} disabled={guardando}>Cancelar</button>
				<button
					class="ccm-btn-primary"
					onclick={guardar}
					disabled={guardando || !hayCambios}
					title={hayCambios ? '' : 'No hay cambios que guardar'}
				>
					{guardando ? 'Guardando…' : 'Guardar y recalcular'}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.ccm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 220;
		background: rgb(15 23 42 / 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.ccm {
		background: #fff;
		color: #0f172a;
		border-radius: 12px;
		width: 100%;
		max-width: 820px;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 50px rgb(0 0 0 / 0.3);
	}

	.ccm-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 20px 12px;
		border-bottom: 1px solid #e2e8f0;
	}
	.ccm-head h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
	}
	.ccm-sub {
		margin: 3px 0 0;
		font-size: 12px;
		color: #64748b;
	}
	.ccm-x {
		border: none;
		background: transparent;
		font-size: 22px;
		line-height: 1;
		cursor: pointer;
		color: #64748b;
		padding: 0 4px;
	}
	.ccm-x:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.ccm-body {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0;
		min-height: 0;
		flex: 1 1 auto;
	}
	.ccm-pane {
		display: flex;
		flex-direction: column;
		min-height: 0;
		padding: 14px 16px;
		overflow-y: auto;
	}
	.ccm-pane-sel {
		border-left: 1px solid #e2e8f0;
		background: #f8fafc;
	}
	.ccm-pane-sel h3 {
		margin: 0 0 10px;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #475569;
	}

	.ccm-buscador {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 7px 10px;
		margin-bottom: 10px;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		color: #64748b;
		flex: none;
	}
	.ccm-buscador input {
		border: none;
		outline: none;
		width: 100%;
		font-size: 13px;
		font-family: inherit;
		color: #0f172a;
		background: transparent;
	}

	.ccm-lista,
	.ccm-sel {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.ccm-fila {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 7px 9px;
		border: 1px solid transparent;
		border-radius: 7px;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}
	.ccm-fila:hover:not(:disabled) {
		background: #f1f5f9;
	}
	.ccm-fila-dentro {
		background: #ecfdf5;
		border-color: #a7f3d0;
	}
	.ccm-fila-dentro:hover:not(:disabled) {
		background: #d1fae5;
	}
	.ccm-fila:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.ccm-check {
		flex: none;
		width: 19px;
		height: 19px;
		border-radius: 5px;
		background: #e2e8f0;
		color: #475569;
		font-size: 12px;
		font-weight: 700;
		line-height: 19px;
		text-align: center;
	}
	.ccm-fila-dentro .ccm-check {
		background: #059669;
		color: #fff;
	}

	.ccm-nom {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.ccm-nom strong {
		font-size: 12.5px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ccm-nom small {
		font-size: 11px;
		color: #64748b;
	}

	.ccm-tag {
		flex: none;
		font-size: 9.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #047857;
	}

	.ccm-sel-item {
		border: 1px solid #e2e8f0;
		border-radius: 9px;
		background: #fff;
		padding: 9px 10px;
	}
	.ccm-sel-head {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.ccm-quitar {
		flex: none;
		border: none;
		background: transparent;
		color: #94a3b8;
		font-size: 17px;
		line-height: 1;
		cursor: pointer;
		padding: 0 2px;
	}
	.ccm-quitar:hover:not(:disabled) {
		color: #b91c1c;
	}

	.ccm-sel-campos {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-top: 8px;
	}
	.ccm-dias {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: none;
	}
	.ccm-dias span {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}
	.ccm-dias input {
		width: 62px;
		padding: 5px 7px;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		font-size: 13px;
		font-family: inherit;
	}

	.ccm-prop {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		flex: 1;
		padding: 6px 8px;
		border: 1px solid #e2e8f0;
		border-radius: 7px;
		cursor: pointer;
	}
	.ccm-prop-on {
		background: #fffbeb;
		border-color: #fcd34d;
	}
	.ccm-prop input {
		margin-top: 2px;
		flex: none;
	}
	.ccm-prop span {
		display: flex;
		flex-direction: column;
		font-size: 11.5px;
		font-weight: 600;
		line-height: 1.3;
	}
	.ccm-prop small {
		font-size: 10.5px;
		font-weight: 500;
		color: #92400e;
	}

	.ccm-aviso {
		margin: 7px 0 0;
		font-size: 11px;
		color: #b45309;
	}
	.ccm-nuevo {
		margin: 7px 0 0;
		font-size: 11px;
		line-height: 1.45;
		color: #047857;
	}

	.ccm-vacio {
		margin: 10px 2px;
		font-size: 12.5px;
		line-height: 1.5;
		color: #64748b;
	}
	.ccm-error {
		color: #b91c1c;
		font-weight: 600;
	}

	.ccm-foot {
		border-top: 1px solid #e2e8f0;
		padding: 12px 20px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ccm-base {
		margin: 0;
		font-size: 12px;
		color: #475569;
	}
	.ccm-base strong {
		font-size: 13px;
		color: #0f172a;
	}
	.ccm-base small {
		color: #92400e;
	}

	.ccm-acciones {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.ccm-btn-ghost,
	.ccm-btn-primary {
		border: none;
		border-radius: 7px;
		padding: 8px 14px;
		font-size: 12.5px;
		font-weight: 700;
		cursor: pointer;
		font-family: inherit;
	}
	.ccm-btn-ghost {
		background: #f1f5f9;
		color: #334155;
	}
	.ccm-btn-primary {
		background: #059669;
		color: #fff;
	}
	.ccm-btn-ghost:disabled,
	.ccm-btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 720px) {
		.ccm-body {
			grid-template-columns: 1fr;
		}
		.ccm-pane-sel {
			border-left: none;
			border-top: 1px solid #e2e8f0;
		}
	}
</style>
