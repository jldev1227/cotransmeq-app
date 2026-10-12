<script lang="ts">
	/**
	 * Alta y edición de una orden de trabajo.
	 *
	 * Preventiva: va ligada a un plan y hereda su vehículo; al cerrarla, el
	 * plan se mueve solo. Correctiva: va a un vehículo, por una falla.
	 *
	 * Una orden cerrada solo deja corregir lo que suele llegar después (factura,
	 * costos, taller): su fecha y su kilometraje ya movieron el plan.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Plus, Trash2 } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import SegmentosFiltro from '$lib/components/listing/SegmentosFiltro.svelte';
	import {
		mantenimientoAPI,
		moneda,
		type InicialOrden,
		type LineaRepuesto,
		type OpcionesMantenimiento,
		type OrdenDetalle,
		type Plan,
		type TipoOrden
	} from '$lib/api/mantenimiento';

	interface Props {
		open: boolean;
		opciones: OpcionesMantenimiento;
		/** Con orden es edición; sin ella, alta (con `inicial` para prellenar). */
		orden?: OrdenDetalle | null;
		inicial?: InicialOrden | null;
		oncerrar: () => void;
		onguardado: (o: OrdenDetalle) => void;
	}
	let { open, opciones, orden = null, inicial = null, oncerrar, onguardado }: Props = $props();

	type Linea = { descripcion: string; cantidad: string; valor_unitario: string };

	let tipo = $state<TipoOrden>('CORRECTIVO');
	let planId = $state('');
	let vehiculoId = $state('');
	let descripcion = $state('');
	let fecha = $state('');
	let kmTexto = $state('');
	let taller = $state('');
	let responsable = $state('');
	let factura = $state('');
	let manoObra = $state('');
	let observaciones = $state('');
	let lineas = $state<Linea[]>([]);
	let planes = $state<Plan[]>([]);
	let enviando = $state(false);

	const cerrada = $derived(orden?.estado === 'EJECUTADO');

	$effect(() => {
		if (!open) return;
		untrack(() => {
			const o = orden;
			tipo = o?.tipo ?? inicial?.tipo ?? 'CORRECTIVO';
			planId = o?.plan?.id ?? inicial?.plan_id ?? '';
			vehiculoId = o?.vehiculo.id ?? inicial?.vehiculo_id ?? '';
			descripcion = o?.descripcion ?? inicial?.descripcion ?? '';
			fecha = o?.fecha ?? opciones.hoy;
			kmTexto = o?.km != null ? String(o.km) : '';
			taller = o?.taller ?? '';
			responsable = o?.responsable ?? '';
			factura = o?.numero_factura ?? '';
			manoObra = o?.costo_mano_obra ? String(o.costo_mano_obra) : '';
			observaciones = o?.observaciones ?? '';
			lineas = (o?.repuestos ?? []).map((r) => ({
				descripcion: r.descripcion,
				cantidad: String(r.cantidad),
				valor_unitario: String(r.valor_unitario)
			}));
			if (!o) {
				if (!kmTexto) prellenarKm();
				void cargarPlanes();
			}
		});
	});

	/// Los planes se piden al abrir: la orden preventiva se elige por plan, y
	/// los que ya tienen una orden abierta no se ofrecen.
	async function cargarPlanes() {
		try {
			planes = (await mantenimientoAPI.planes({ limit: 500 })).items;
			if (planId) prellenarKm();
		} catch {
			planes = [];
		}
	}

	function vehiculoDeLaOrden() {
		if (tipo === 'PREVENTIVO')
			return planes.find((p) => p.id === planId)?.vehiculo.id ?? vehiculoId;
		return vehiculoId;
	}
	/// El km arranca con el de la ficha: es casi siempre el que trae el vehículo al taller.
	function prellenarKm() {
		const v = opciones.vehiculos.find((x) => x.id === vehiculoDeLaOrden());
		if (v?.kilometraje) kmTexto = String(v.kilometraje);
	}

	const planesElegibles = $derived(
		planes.filter((p) => p.activo && (!p.orden_abierta || p.id === planId))
	);

	const numero = (t: string) => {
		const n = Number(String(t).replace(/\s/g, '').replace(',', '.'));
		return t.trim() !== '' && Number.isFinite(n) ? n : null;
	};

	const repuestos = $derived<LineaRepuesto[]>(
		lineas
			.filter((l) => l.descripcion.trim())
			.map((l) => ({
				descripcion: l.descripcion.trim(),
				cantidad: numero(l.cantidad) ?? 1,
				valor_unitario: numero(l.valor_unitario) ?? 0
			}))
	);
	const totalRepuestos = $derived(repuestos.reduce((s, r) => s + r.cantidad * r.valor_unitario, 0));
	const total = $derived(totalRepuestos + (numero(manoObra) ?? 0));

	const valido = $derived(
		descripcion.trim().length >= 3 && (orden || (tipo === 'PREVENTIVO' ? !!planId : !!vehiculoId))
	);

	async function guardar() {
		if (!valido || enviando) return;
		enviando = true;
		try {
			const comunes = {
				taller: taller.trim() || null,
				responsable: responsable.trim() || null,
				numero_factura: factura.trim() || null,
				repuestos,
				costo_mano_obra: numero(manoObra),
				observaciones: observaciones.trim() || null
			};
			const r = orden
				? await mantenimientoAPI.actualizarOrden(orden.id, {
						...comunes,
						...(cerrada
							? {}
							: { descripcion: descripcion.trim(), fecha: fecha || null, km: numero(kmTexto) })
					})
				: await mantenimientoAPI.crearOrden({
						...comunes,
						tipo,
						plan_id: tipo === 'PREVENTIVO' ? planId : null,
						vehiculo_id: tipo === 'CORRECTIVO' ? vehiculoId : null,
						descripcion: descripcion.trim(),
						fecha: fecha || null,
						km: numero(kmTexto)
					});
			toast.success(orden ? 'Orden guardada' : `OT ${r.consecutivo} abierta`);
			onguardado(r);
			oncerrar();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo guardar la orden');
		} finally {
			enviando = false;
		}
	}
</script>

<ModalBase
	{open}
	title={orden ? `OT ${orden.consecutivo} · ${orden.vehiculo.placa}` : 'Nueva orden de trabajo'}
	eyebrow="MANTENIMIENTO"
	subtitle={cerrada ? 'Cerrada: solo se corrigen costos, factura y taller.' : null}
	tamano="lg"
	bloqueado={enviando}
	cerrarAlFondo={false}
	{oncerrar}
>
	<form
		class="mo"
		onsubmit={(e) => {
			e.preventDefault();
			void guardar();
		}}
	>
		{#if !orden}
			<div class="mo-ancho">
				<SegmentosFiltro
					etiqueta="Tipo"
					opciones={[
						{ valor: 'PREVENTIVO', etiqueta: 'Preventiva' },
						{ valor: 'CORRECTIVO', etiqueta: 'Correctiva' }
					]}
					valor={tipo}
					onCambiar={(v) => {
						tipo = v as TipoOrden;
						prellenarKm();
					}}
				/>
			</div>
			{#if tipo === 'PREVENTIVO'}
				<label class="mo-campo mo-ancho">
					<span>Plan <b>*</b></span>
					<select
						class="mo-input"
						bind:value={planId}
						onchange={() => {
							const p = planes.find((x) => x.id === planId);
							if (p && !descripcion.trim()) descripcion = p.nombre;
							prellenarKm();
						}}
					>
						<option value="">Elige el plan…</option>
						{#each planesElegibles as p (p.id)}
							<option value={p.id}>{p.vehiculo.placa} · {p.nombre}</option>
						{/each}
					</select>
					{#if planes.length && !planesElegibles.length}
						<small class="mo-ayuda">Todos los planes tienen ya una orden abierta.</small>
					{/if}
				</label>
			{:else}
				<label class="mo-campo mo-ancho">
					<span>Vehículo <b>*</b></span>
					<select class="mo-input" bind:value={vehiculoId} onchange={prellenarKm}>
						<option value="">Elige el vehículo…</option>
						{#each opciones.vehiculos as v (v.id)}
							<option value={v.id}
								>{v.placa}{v.marca
									? ` · ${[v.marca, v.linea].filter(Boolean).join(' ')}`
									: ''}</option
							>
						{/each}
					</select>
				</label>
			{/if}
		{/if}

		<label class="mo-campo mo-ancho">
			<span>Trabajo a realizar <b>*</b></span>
			<textarea
				class="mo-input"
				rows="2"
				bind:value={descripcion}
				maxlength="4000"
				disabled={cerrada}
				placeholder="Qué se hace o qué falla"
			></textarea>
		</label>
		<label class="mo-campo">
			<span>Fecha</span>
			<input class="mo-input" type="date" bind:value={fecha} disabled={cerrada} />
		</label>
		<label class="mo-campo">
			<span>Kilometraje</span>
			<input class="mo-input" inputmode="numeric" bind:value={kmTexto} disabled={cerrada} />
		</label>
		<label class="mo-campo">
			<span>Taller o proveedor</span>
			<input class="mo-input" bind:value={taller} maxlength="255" />
		</label>
		<label class="mo-campo">
			<span>Responsable</span>
			<input
				class="mo-input"
				bind:value={responsable}
				maxlength="255"
				placeholder="Mecánico o quien recibe"
			/>
		</label>

		<fieldset class="mo-ancho mo-repuestos">
			<legend>Repuestos</legend>
			{#each lineas as l, i (i)}
				<div class="mo-linea">
					<input
						class="mo-input"
						bind:value={l.descripcion}
						placeholder="Repuesto"
						maxlength="255"
						aria-label="Repuesto"
					/>
					<input
						class="mo-input mo-num"
						inputmode="decimal"
						bind:value={l.cantidad}
						placeholder="Cant."
						aria-label="Cantidad"
					/>
					<input
						class="mo-input mo-num"
						inputmode="numeric"
						bind:value={l.valor_unitario}
						placeholder="Valor unitario"
						aria-label="Valor unitario"
					/>
					<span class="mo-subtotal"
						>{moneda((numero(l.cantidad) ?? 1) * (numero(l.valor_unitario) ?? 0))}</span
					>
					<button
						type="button"
						class="mo-quitar"
						title="Quitar repuesto"
						onclick={() => (lineas = lineas.filter((_, j) => j !== i))}><Trash2 size={15} /></button
					>
				</div>
			{/each}
			<button
				type="button"
				class="mo-agregar"
				onclick={() =>
					(lineas = [...lineas, { descripcion: '', cantidad: '1', valor_unitario: '' }])}
			>
				<Plus size={14} /> Agregar repuesto
			</button>
		</fieldset>

		<label class="mo-campo">
			<span>Mano de obra</span>
			<input class="mo-input" inputmode="numeric" bind:value={manoObra} placeholder="0" />
		</label>
		<label class="mo-campo">
			<span>Número de factura</span>
			<input class="mo-input" bind:value={factura} maxlength="60" />
		</label>
		<div class="mo-ancho mo-total">
			<span>Repuestos {moneda(totalRepuestos)} + mano de obra {moneda(numero(manoObra) ?? 0)}</span>
			<strong>Total {moneda(total)}</strong>
		</div>
		<label class="mo-campo mo-ancho">
			<span>Observaciones</span>
			<textarea class="mo-input" rows="2" bind:value={observaciones} maxlength="4000"></textarea>
		</label>
	</form>
	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={oncerrar} disabled={enviando}
			>Cancelar</button
		>
		<button type="button" class="btn-primary" onclick={guardar} disabled={!valido || enviando}>
			{enviando ? 'Guardando…' : orden ? 'Guardar' : 'Abrir orden'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.mo {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.mo-ancho {
		grid-column: 1 / -1;
	}
	.mo-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.mo-campo > span,
	.mo-repuestos legend {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.mo-campo b {
		color: #dc2626;
	}
	.mo-ayuda {
		font-size: 0.74rem;
		color: var(--text-muted);
	}
	.mo-input {
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
	}
	.mo-input:disabled {
		opacity: 0.6;
	}
	textarea.mo-input {
		resize: vertical;
	}
	.mo-input:focus {
		outline: none;
		border-color: var(--au-primary);
		box-shadow: 0 0 0 3px var(--au-tint);
	}
	.mo-repuestos {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 10px 12px 12px;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
	}
	.mo-linea {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 4.5rem 8rem 7.5rem 32px;
		align-items: center;
		gap: 6px;
	}
	.mo-num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.mo-subtotal {
		text-align: right;
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}
	.mo-quitar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 32px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.mo-quitar:hover {
		background: #fef2f2;
		color: #b91c1c;
	}
	.mo-agregar {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		padding: 0.35rem 0.6rem;
		border: 1.5px dashed var(--border-default);
		border-radius: 10px;
		background: transparent;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.mo-agregar:hover {
		border-color: var(--accion);
		color: var(--accion);
	}
	.mo-total {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 6px;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--bg-base);
		font-size: 0.82rem;
		color: var(--text-secondary);
	}
	.mo-total strong {
		font-size: 0.95rem;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 640px) {
		.mo {
			grid-template-columns: 1fr;
		}
		/* En el teléfono el subtotal sobra: el total de abajo lo dice. */
		.mo-linea {
			grid-template-columns: minmax(0, 1fr) 3.5rem 6.5rem 32px;
		}
		.mo-subtotal {
			display: none;
		}
	}
</style>
