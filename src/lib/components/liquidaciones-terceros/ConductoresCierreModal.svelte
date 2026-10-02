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
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

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
</script>

<ModalBase
	open={true}
	eyebrow={`Cierre · ${periodo}`}
	title={`Conductores de ${placa}`}
	subtitle="Define los recuadros de descuentos por la prestación del servicio"
	tamano="lg"
	sinRelleno
	cerrarAlFondo={false}
	bloqueado={guardando}
	oncerrar={onClose}
>
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
										class="ccm-input"
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

	{#snippet pie()}
		<div class="ccm-resumen">
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
		</div>

		<button type="button" class="btn-secondary" onclick={onClose} disabled={guardando}>
			Cancelar
		</button>
		<button
			type="button"
			class="btn-primary"
			onclick={guardar}
			disabled={guardando || !hayCambios}
			title={hayCambios ? '' : 'No hay cambios que guardar'}
		>
			{guardando ? 'Guardando…' : 'Guardar y recalcular'}
		</button>
	{/snippet}
</ModalBase>

<style>
	/* Dos columnas que scrollean cada una por su lado: el cuerpo de
	   ModalBase va sin relleno y la rejilla ocupa todo su alto. */
	.ccm-body {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0;
		height: 100%;
		min-height: 0;
	}
	.ccm-pane {
		display: flex;
		flex-direction: column;
		min-height: 0;
		padding: 18px 20px;
		overflow-y: auto;
	}
	.ccm-pane-sel {
		border-left: 1px solid var(--border-subtle);
	}
	.ccm-pane-sel h3 {
		margin: 0 0 10px;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	/* Mismo aspecto que `.de-input` de ModalEntidad, con la lupa dentro. */
	.ccm-buscador {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 0 12px;
		margin-bottom: 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-muted);
		flex: none;
	}
	.ccm-buscador:focus-within {
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.ccm-buscador input {
		border: none;
		outline: none;
		width: 100%;
		padding: 9px 0;
		font-size: 14px;
		font-family: inherit;
		color: var(--text-primary);
		background: transparent;
	}
	.ccm-buscador input:disabled {
		color: var(--text-muted);
	}

	.ccm-lista,
	.ccm-sel {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.ccm-sel {
		gap: 10px;
	}

	.ccm-fila {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border: 1px solid transparent;
		border-radius: 12px;
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}
	.ccm-fila:hover:not(:disabled) {
		background: var(--bg-surface);
	}
	.ccm-fila-dentro {
		background: var(--bg-surface);
		border-color: color-mix(in srgb, var(--accion) 35%, transparent);
	}
	.ccm-fila-dentro:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accion) 6%, var(--bg-surface));
	}
	.ccm-fila:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.ccm-check {
		flex: none;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		background: var(--border-subtle);
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 700;
		line-height: 20px;
		text-align: center;
	}
	.ccm-fila-dentro .ccm-check {
		background: var(--accion);
		color: #fff;
	}

	.ccm-nom {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.ccm-nom strong {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ccm-nom small {
		font-size: 11.5px;
		color: var(--text-muted);
	}

	.ccm-tag {
		flex: none;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accion);
	}

	.ccm-sel-item {
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
		padding: 12px 14px;
	}
	.ccm-sel-head {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}
	.ccm-quitar {
		flex: none;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--text-muted);
		font-size: 17px;
		line-height: 1;
		cursor: pointer;
	}
	.ccm-quitar:hover:not(:disabled) {
		background: var(--bg-base);
		color: #b42318;
	}
	.ccm-quitar:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.ccm-sel-campos {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-top: 10px;
	}
	.ccm-dias {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: none;
	}
	.ccm-dias span {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.ccm-input {
		width: 76px;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font-size: 14px;
		font-family: inherit;
	}
	.ccm-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.ccm-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}

	.ccm-prop {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		flex: 1;
		margin-top: 20px;
		padding: 8px 10px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		cursor: pointer;
	}
	.ccm-prop-on {
		background: #fffbeb;
		border-color: #fcd34d;
	}
	.ccm-prop input {
		margin-top: 2px;
		flex: none;
		accent-color: var(--accion);
	}
	.ccm-prop span {
		display: flex;
		flex-direction: column;
		font-size: 12.5px;
		font-weight: 600;
		line-height: 1.3;
		color: var(--text-primary);
	}
	.ccm-prop small {
		font-size: 11px;
		font-weight: 500;
		color: #92400e;
	}

	.ccm-aviso {
		margin: 8px 0 0;
		font-size: 11.5px;
		color: #b45309;
	}
	.ccm-nuevo {
		margin: 8px 0 0;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--text-secondary);
	}

	.ccm-vacio {
		margin: 10px 2px;
		font-size: 13px;
		line-height: 1.5;
		color: var(--text-muted);
	}
	.ccm-error {
		color: #b42318;
		font-size: 12px;
		font-weight: 600;
	}

	.ccm-resumen {
		flex: 1 1 260px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-right: auto;
	}
	.ccm-resumen .ccm-error {
		margin: 0;
	}
	.ccm-base {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-secondary);
	}
	.ccm-base strong {
		font-size: 14px;
		color: var(--text-primary);
	}
	.ccm-base small {
		color: #92400e;
	}

	@media (max-width: 720px) {
		.ccm-body {
			grid-template-columns: 1fr;
			height: auto;
		}
		.ccm-pane-sel {
			border-left: none;
			border-top: 1px solid var(--border-subtle);
		}
	}
</style>
