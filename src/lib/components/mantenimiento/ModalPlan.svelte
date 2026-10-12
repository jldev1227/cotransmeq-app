<script lang="ts">
	/**
	 * Alta y edición de un plan de mantenimiento preventivo.
	 *
	 * Al crear, el plan se aplica a uno o varios vehículos a la vez: cada uno
	 * con su propio último kilometraje (cada odómetro va por su lado), que
	 * arranca con el de la ficha, y una fecha del último mantenimiento común.
	 * Si a un vehículo ya se le había aplicado el mismo plan, el backend lo
	 * omite y aquí se avisa.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import SelectorMultiple from '$lib/components/listing/SelectorMultiple.svelte';
	import {
		mantenimientoAPI,
		fecha as fmtFecha,
		type OpcionesMantenimiento,
		type PlanDetalle
	} from '$lib/api/mantenimiento';

	interface Props {
		open: boolean;
		opciones: OpcionesMantenimiento;
		/** Con plan es edición; sin él, alta. */
		plan?: PlanDetalle | null;
		/** Vehículos marcados al abrir (desde la ficha de un vehículo). */
		vehiculosIniciales?: string[];
		oncerrar: () => void;
		onguardado: () => void;
	}
	let {
		open,
		opciones,
		plan = null,
		vehiculosIniciales = [],
		oncerrar,
		onguardado
	}: Props = $props();

	let categoria = $state('CAMBIO_ACEITE');
	let nombre = $state('');
	let cadaKm = $state('');
	let cadaMeses = $state('');
	let observaciones = $state('');
	let fechaUltima = $state('');
	let kmUltimo = $state('');
	let activo = $state(true);
	let seleccion = $state<string[]>([]);
	/// Último km por vehículo (texto del input), arranca con el de la ficha.
	let kmPorVehiculo = $state<Record<string, string>>({});
	let enviando = $state(false);

	const etiquetaDe = (clave: string) =>
		opciones.categorias.find((c) => c.clave === clave)?.etiqueta ?? '';

	$effect(() => {
		if (!open) return;
		untrack(() => {
			if (plan) {
				categoria = plan.categoria;
				nombre = plan.nombre;
				cadaKm = plan.periodicidad_km ? String(plan.periodicidad_km) : '';
				cadaMeses = plan.periodicidad_meses ? String(plan.periodicidad_meses) : '';
				observaciones = plan.observaciones ?? '';
				fechaUltima = plan.ultima_ejecucion_fecha ?? '';
				kmUltimo = plan.ultima_ejecucion_km != null ? String(plan.ultima_ejecucion_km) : '';
				activo = plan.activo;
			} else {
				aplicarCategoria('CAMBIO_ACEITE', true);
				observaciones = '';
				fechaUltima = opciones.hoy;
				activo = true;
				seleccion = [];
				kmPorVehiculo = {};
				cambiarSeleccion([...vehiculosIniciales]);
			}
		});
	});

	/// Elegir la categoría prellena nombre y periodicidad con lo habitual, pero
	/// no pisa un nombre que alguien ya escribió a mano.
	function aplicarCategoria(clave: string, forzar = false) {
		const anterior = etiquetaDe(categoria);
		const c = opciones.categorias.find((x) => x.clave === clave);
		categoria = clave;
		if (forzar || !nombre.trim() || nombre === anterior)
			nombre = c?.clave === 'OTRO' ? '' : (c?.etiqueta ?? '');
		if (forzar || !plan) {
			cadaKm = c?.sugerenciaKm ? String(c.sugerenciaKm) : '';
			cadaMeses = c?.sugerenciaMeses ? String(c.sugerenciaMeses) : '';
		}
	}

	function cambiarSeleccion(ids: string[]) {
		const siguiente: Record<string, string> = {};
		for (const id of ids) {
			const v = opciones.vehiculos.find((x) => x.id === id);
			siguiente[id] = kmPorVehiculo[id] ?? (v?.kilometraje ? String(v.kilometraje) : '');
		}
		kmPorVehiculo = siguiente;
		seleccion = ids;
	}

	const entero = (t: string) => {
		const n = Number(String(t).replace(/\./g, '').trim());
		return t.trim() !== '' && Number.isFinite(n) ? Math.round(n) : null;
	};

	/// Solo para la vista previa: el próximo de verdad lo calcula el backend.
	function sumarMeses(iso: string, meses: number) {
		const [y, m, d] = iso.split('-').map(Number);
		const total = y * 12 + (m - 1) + meses;
		const anio = Math.floor(total / 12);
		const mes = total - anio * 12;
		const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
		return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
	}
	const proximaFecha = $derived(
		fechaUltima && entero(cadaMeses) ? sumarMeses(fechaUltima, entero(cadaMeses)!) : null
	);
	const proximoKm = (base: string) => {
		const b = entero(base);
		const p = entero(cadaKm);
		return b != null && p ? b + p : null;
	};

	const opcionesVehiculos = $derived(
		opciones.vehiculos.map((v) => ({
			valor: v.id,
			etiqueta: v.placa,
			detalle: [
				[v.marca, v.linea].filter(Boolean).join(' '),
				v.kilometraje ? `${v.kilometraje.toLocaleString('es-CO')} km` : null
			]
				.filter(Boolean)
				.join(' · ')
		}))
	);

	const valido = $derived(
		nombre.trim().length >= 2 &&
			(entero(cadaKm) || entero(cadaMeses)) &&
			(plan || seleccion.length > 0)
	);

	async function guardar() {
		if (!valido || enviando) return;
		enviando = true;
		try {
			if (plan) {
				await mantenimientoAPI.actualizarPlan(plan.id, {
					categoria,
					nombre: nombre.trim(),
					periodicidad_km: entero(cadaKm),
					periodicidad_meses: entero(cadaMeses),
					observaciones: observaciones.trim() || null,
					ultima_ejecucion_km: entero(kmUltimo),
					ultima_ejecucion_fecha: fechaUltima || null,
					activo
				});
				toast.success('Plan guardado');
			} else {
				const r = await mantenimientoAPI.crearPlanes({
					categoria,
					nombre: nombre.trim(),
					periodicidad_km: entero(cadaKm),
					periodicidad_meses: entero(cadaMeses),
					observaciones: observaciones.trim() || null,
					vehiculos: seleccion.map((id) => ({
						vehiculo_id: id,
						ultima_ejecucion_km: entero(kmPorVehiculo[id] ?? ''),
						ultima_ejecucion_fecha: fechaUltima || null
					}))
				});
				if (r.creados)
					toast.success(r.creados === 1 ? 'Plan creado' : `Plan aplicado a ${r.creados} vehículos`);
				if (r.omitidos.length)
					toast.info(
						`${r.omitidos.map((o) => o.placa).join(', ')} ya ${r.omitidos.length === 1 ? 'tenía' : 'tenían'} este plan`
					);
			}
			onguardado();
			oncerrar();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo guardar el plan');
		} finally {
			enviando = false;
		}
	}
</script>

<ModalBase
	{open}
	title={plan ? `Plan · ${plan.vehiculo.placa}` : 'Nuevo plan de mantenimiento'}
	eyebrow="MANTENIMIENTO PREVENTIVO"
	subtitle={plan ? null : 'Aplícalo a uno o varios vehículos a la vez.'}
	tamano="lg"
	bloqueado={enviando}
	cerrarAlFondo={false}
	{oncerrar}
>
	<form
		class="mp"
		onsubmit={(e) => {
			e.preventDefault();
			void guardar();
		}}
	>
		<label class="mp-campo">
			<span>Tipo de mantenimiento</span>
			<select
				class="mp-input"
				value={categoria}
				onchange={(e) => aplicarCategoria((e.currentTarget as HTMLSelectElement).value)}
			>
				{#each opciones.categorias as c (c.clave)}<option value={c.clave}>{c.etiqueta}</option
					>{/each}
			</select>
		</label>
		<label class="mp-campo">
			<span>Nombre <b>*</b></span>
			<input
				class="mp-input"
				bind:value={nombre}
				maxlength="255"
				placeholder="Ej. Cambio de aceite 15W40"
			/>
		</label>

		<fieldset class="mp-ancho mp-grupo">
			<legend>Cada cuánto <small>lo que ocurra primero</small></legend>
			<label class="mp-campo">
				<span>Kilómetros</span>
				<input class="mp-input" inputmode="numeric" bind:value={cadaKm} placeholder="Ej. 5000" />
			</label>
			<label class="mp-campo">
				<span>Meses</span>
				<input class="mp-input" inputmode="numeric" bind:value={cadaMeses} placeholder="Ej. 3" />
			</label>
		</fieldset>

		{#if plan}
			<fieldset class="mp-ancho mp-grupo">
				<legend>Último mantenimiento</legend>
				<label class="mp-campo">
					<span>Fecha</span>
					<input class="mp-input" type="date" max={opciones.hoy} bind:value={fechaUltima} />
				</label>
				<label class="mp-campo">
					<span>Kilometraje</span>
					<input class="mp-input" inputmode="numeric" bind:value={kmUltimo} />
				</label>
				<p class="mp-nota mp-ancho">
					Próximo:
					<strong
						>{[
							proximoKm(kmUltimo) ? `${proximoKm(kmUltimo)!.toLocaleString('es-CO')} km` : null,
							proximaFecha ? fmtFecha(proximaFecha) : null
						]
							.filter(Boolean)
							.join(' o ') || '—'}</strong
					>. Lo normal es que lo muevan las órdenes al cerrarse; corrígelo aquí solo si quedó mal.
				</p>
			</fieldset>
			<label class="mp-check mp-ancho">
				<input type="checkbox" bind:checked={activo} />
				Activo (si lo pausas, no cuenta como vencido ni avisa)
			</label>
		{:else}
			<div class="mp-ancho">
				<SelectorMultiple
					etiqueta="Vehículos *"
					placeholder="Busca por placa o marca…"
					opciones={opcionesVehiculos}
					{seleccion}
					onCambiar={cambiarSeleccion}
					maxPastillas={10}
				/>
			</div>
			<label class="mp-campo">
				<span>Fecha del último mantenimiento</span>
				<input class="mp-input" type="date" max={opciones.hoy} bind:value={fechaUltima} />
			</label>
			<p class="mp-nota">
				{proximaFecha
					? `Por fecha, el próximo toca el ${fmtFecha(proximaFecha)}.`
					: 'Sin fecha no hay vencimiento por tiempo.'}
			</p>
			{#if seleccion.length}
				<div class="mp-ancho mp-tabla">
					<div class="mp-fila mp-fila--cab">
						<span>Vehículo</span><span>Último km</span><span>Próximo km</span>
					</div>
					{#each seleccion as id (id)}
						{@const v = opciones.vehiculos.find((x) => x.id === id)}
						<div class="mp-fila">
							<span class="mp-placa">{v?.placa ?? id}</span>
							<input
								class="mp-input"
								inputmode="numeric"
								value={kmPorVehiculo[id] ?? ''}
								oninput={(e) =>
									(kmPorVehiculo = {
										...kmPorVehiculo,
										[id]: (e.currentTarget as HTMLInputElement).value
									})}
								placeholder="Sin dato"
								aria-label={`Último kilometraje de ${v?.placa ?? ''}`}
							/>
							<span class="mp-proximo"
								>{proximoKm(kmPorVehiculo[id] ?? '')?.toLocaleString('es-CO') ?? '—'}</span
							>
						</div>
					{/each}
				</div>
			{/if}
		{/if}

		<label class="mp-campo mp-ancho">
			<span>Observaciones</span>
			<textarea class="mp-input" rows="2" bind:value={observaciones} maxlength="2000"></textarea>
		</label>
	</form>
	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={oncerrar} disabled={enviando}
			>Cancelar</button
		>
		<button type="button" class="btn-primary" onclick={guardar} disabled={!valido || enviando}>
			{enviando
				? 'Guardando…'
				: plan
					? 'Guardar'
					: seleccion.length > 1
						? `Crear para ${seleccion.length} vehículos`
						: 'Crear plan'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.mp {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.mp-ancho {
		grid-column: 1 / -1;
	}
	.mp-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.mp-campo > span,
	.mp-grupo legend {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.mp-grupo legend small {
		margin-left: 6px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.mp-campo b {
		color: #dc2626;
	}
	.mp-grupo {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin: 0;
		padding: 10px 12px 12px;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
	}
	.mp-input {
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
	}
	textarea.mp-input {
		resize: vertical;
	}
	.mp-input:focus {
		outline: none;
		border-color: var(--au-primary);
		box-shadow: 0 0 0 3px var(--au-tint);
	}
	.mp-nota {
		align-self: end;
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.mp-nota strong {
		color: var(--text-primary);
	}
	.mp-check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}
	.mp-check input {
		width: 16px;
		height: 16px;
		accent-color: var(--accion);
	}
	.mp-tabla {
		display: flex;
		flex-direction: column;
		max-height: 16rem;
		overflow-y: auto;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
	}
	.mp-fila {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 9rem 7rem;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
	}
	.mp-fila + .mp-fila {
		border-top: 1px solid var(--border-subtle);
	}
	.mp-fila--cab {
		position: sticky;
		top: 0;
		background: var(--bg-base);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.mp-placa {
		font-weight: 800;
		letter-spacing: 0.05em;
	}
	.mp-proximo {
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}
	@media (max-width: 560px) {
		.mp,
		.mp-grupo {
			grid-template-columns: 1fr;
		}
	}
</style>
