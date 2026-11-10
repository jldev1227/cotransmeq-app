<script lang="ts">
	import { onMount } from 'svelte';
	import { Plus, Trash2 } from 'lucide-svelte';
	import {
		liquidacionesTercerosDescuentosAPI,
		type ConceptoDescuento,
		type NovedadConductor,
		type TipoNovedadConductor
	} from '$lib/api/liquidaciones-terceros-descuentos';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

	interface Props {
		cierreId: string;
		placa: string;
		periodo: string;
		conceptos: ConceptoDescuento[];
		novedadesIniciales: Record<string, NovedadConductor[]>;
		onClose: () => void;
		onGuardado: () => void | Promise<void>;
	}

	let { cierreId, placa, periodo, conceptos, novedadesIniciales, onClose, onGuardado }: Props =
		$props();

	const tipos: Array<{ value: TipoNovedadConductor; label: string }> = [
		{ value: 'VACACIONES', label: 'Vacaciones' },
		{ value: 'INCAPACIDAD', label: 'Incapacidad' },
		{ value: 'LICENCIA_MATERNIDAD', label: 'Licencia de maternidad' },
		{ value: 'LICENCIA_PATERNIDAD', label: 'Licencia de paternidad' }
	];

	let novedades = $state<Record<string, NovedadConductor[]>>({});
	let firmaInicial = $state('');
	let guardando = $state(false);
	let error = $state('');

	const conductores = $derived.by(() => {
		const porId = new Map<string, { id: string; nombre: string }>();
		for (const concepto of conceptos) {
			const id = concepto.conductor_id;
			if (concepto.tipo !== 'COSTO_LABORAL' || !id) continue;
			const ficha = concepto.conductor;
			const nombre = ficha ? `${ficha.nombre} ${ficha.apellido}`.trim() : 'Conductor';
			porId.set(id, { id, nombre });
		}
		return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
	});

	const firma = () => JSON.stringify(novedades);
	const hayCambios = $derived(firma() !== firmaInicial);

	onMount(() => {
		const conductoresActivos = new Set(conductores.map((conductor) => conductor.id));
		novedades = Object.fromEntries(
			Object.entries(novedadesIniciales ?? {})
				.filter(([id]) => conductoresActivos.has(id))
				.map(([id, filas]) => [id, Array.isArray(filas) ? filas.map((fila) => ({ ...fila })) : []])
		);
		firmaInicial = firma();
	});

	function nuevaNovedad(): NovedadConductor {
		return {
			id: crypto.randomUUID(),
			tipo: 'VACACIONES',
			fecha_inicio: null,
			fecha_fin: null,
			dias: 0,
			observaciones: null
		};
	}

	function agregar(conductorId: string) {
		novedades = {
			...novedades,
			[conductorId]: [...(novedades[conductorId] ?? []), nuevaNovedad()]
		};
	}

	function actualizar(conductorId: string, indice: number, cambios: Partial<NovedadConductor>) {
		const filas = [...(novedades[conductorId] ?? [])];
		filas[indice] = { ...filas[indice], ...cambios };
		novedades = { ...novedades, [conductorId]: filas };
	}

	function quitar(conductorId: string, indice: number) {
		const filas = [...(novedades[conductorId] ?? [])];
		filas.splice(indice, 1);
		novedades = { ...novedades, [conductorId]: filas };
	}

	function diasDelPeriodo(novedad: NovedadConductor): number | null {
		if (!novedad.fecha_inicio || !novedad.fecha_fin) return null;
		const inicio = Date.parse(`${novedad.fecha_inicio}T00:00:00.000Z`);
		const fin = Date.parse(`${novedad.fecha_fin}T00:00:00.000Z`);
		if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin < inicio) return null;
		return Math.floor((fin - inicio) / 86_400_000) + 1;
	}

	function esValida(novedad: NovedadConductor): boolean {
		const inicio = novedad.fecha_inicio;
		const fin = novedad.fecha_fin;
		if (inicio || fin) return Boolean(inicio && fin && diasDelPeriodo(novedad));
		return Number.isInteger(Number(novedad.dias)) && Number(novedad.dias) > 0;
	}

	const puedeGuardar = $derived(
		!guardando && hayCambios && novedades[Object.keys(novedades)[0]] !== undefined &&
		Object.values(novedades).every((filas) => filas.every(esValida))
	);

	async function guardar() {
		if (!puedeGuardar) return;
		guardando = true;
		error = '';
		try {
			const payload = Object.fromEntries(
				Object.entries(novedades).map(([conductorId, filas]) => [
					conductorId,
					filas.map((fila) => ({
						...fila,
						dias: diasDelPeriodo(fila) ?? Number(fila.dias),
						observaciones: fila.observaciones?.trim() || null
					}))
				])
			);
			await liquidacionesTercerosDescuentosAPI.guardarNovedadesConductores(cierreId, payload);
			await onGuardado();
		} catch (e: any) {
			error =
				e?.response?.data?.error || e?.message || 'No se pudieron guardar las novedades.';
		} finally {
			guardando = false;
		}
	}
</script>

<ModalBase
	open
	eyebrow="Cierre · conductores"
	title="Novedades de {placa}"
	subtitle="{periodo} · vacaciones, incapacidades y licencias de maternidad o paternidad"
	tamano="xl"
	cerrarAlFondo={false}
	bloqueado={guardando}
	oncerrar={onClose}
>
	<div class="ncc-body">
		<p class="ncc-ayuda">
			Registra cada novedad por separado. Puedes indicar los días o un periodo; al completar las
			fechas, los días calendario se calculan automáticamente, incluyendo ambos extremos.
		</p>
		{#if conductores.length === 0}
			<div class="ncc-vacio">Esta hoja todavía no tiene conductores de nómina.</div>
		{:else}
			<div class="ncc-lista">
				{#each conductores as conductor (conductor.id)}
					{@const filas = novedades[conductor.id] ?? []}
					<section class="ncc-conductor">
						<header class="ncc-conductor-header">
							<div>
								<h3>{conductor.nombre}</h3>
								<p>{filas.length ? `${filas.length} novedad(es)` : 'No presenta novedades'}</p>
							</div>
							<button class="ncc-agregar" type="button" onclick={() => agregar(conductor.id)} disabled={guardando}>
								<Plus size={15} /> Añadir novedad
							</button>
						</header>

						{#if filas.length === 0}
							<p class="ncc-sin-novedades">NO PRESENTA NOVEDADES</p>
						{:else}
						<div class="ncc-filas">
							{#each filas as novedad, indice (novedad.id)}
								<div class="ncc-fila">
									<label class="ncc-campo ncc-tipo">
										<span>Tipo</span>
										<select
											value={novedad.tipo}
											onchange={(e) => actualizar(conductor.id, indice, { tipo: e.currentTarget.value as TipoNovedadConductor })}
											disabled={guardando}
										>
											{#each tipos as tipo (tipo.value)}<option value={tipo.value}>{tipo.label}</option>{/each}
										</select>
									</label>
									<label class="ncc-campo">
										<span>Desde</span>
										<input type="date" value={novedad.fecha_inicio ?? ''} onchange={(e) => actualizar(conductor.id, indice, { fecha_inicio: e.currentTarget.value || null })} disabled={guardando} />
									</label>
									<label class="ncc-campo">
										<span>Hasta</span>
										<input type="date" value={novedad.fecha_fin ?? ''} onchange={(e) => actualizar(conductor.id, indice, { fecha_fin: e.currentTarget.value || null })} disabled={guardando} />
									</label>
									<label class="ncc-campo ncc-dias">
										<span>Días</span>
										<input
											type="number" min="1" step="1"
											value={diasDelPeriodo(novedad) ?? (novedad.dias || '')}
											onchange={(e) => actualizar(conductor.id, indice, { dias: Number(e.currentTarget.value) || 0 })}
											disabled={guardando || Boolean(diasDelPeriodo(novedad))}
										/>
									</label>
									<button class="ncc-quitar" type="button" aria-label="Quitar novedad" onclick={() => quitar(conductor.id, indice)} disabled={guardando}>
										<Trash2 size={16} />
									</button>
									<label class="ncc-campo ncc-nota">
										<span>Observación opcional</span>
										<input type="text" maxlength="500" value={novedad.observaciones ?? ''} oninput={(e) => actualizar(conductor.id, indice, { observaciones: e.currentTarget.value || null })} disabled={guardando} placeholder="Detalle breve" />
									</label>
									{#if !esValida(novedad)}
										<p class="ncc-validacion">Completa las dos fechas del periodo o indica una cantidad de días mayor que cero.</p>
									{/if}
								</div>
							{/each}
						</div>
						{/if}
					</section>
				{/each}
			</div>
		{/if}
		{#if error}<p class="ncc-error" role="alert">{error}</p>{/if}
	</div>

	{#snippet pie()}
		<button class="btn-secondary" type="button" onclick={onClose} disabled={guardando}>Cerrar</button>
		<button class="btn-primary" type="button" onclick={guardar} disabled={!puedeGuardar}>
			{guardando ? 'Guardando…' : 'Guardar novedades'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.ncc-body { display: grid; gap: 14px; padding: 18px; }
	.ncc-ayuda { margin: 0; color: #475569; font-size: 13px; line-height: 1.5; }
	.ncc-lista { display: grid; gap: 12px; max-height: min(58vh, 680px); overflow: auto; padding-right: 3px; }
	.ncc-conductor { border: 1px solid #dbe3ec; border-radius: 12px; background: #fff; overflow: hidden; }
	.ncc-conductor-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
	.ncc-conductor-header h3 { margin: 0; color: #0f172a; font-size: 14px; font-weight: 700; }
	.ncc-conductor-header p { margin: 3px 0 0; color: #64748b; font-size: 11px; }
	.ncc-agregar, .ncc-quitar { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #334155; cursor: pointer; }
	.ncc-agregar { padding: 7px 10px; font-size: 12px; font-weight: 600; }
	.ncc-agregar:hover:not(:disabled), .ncc-quitar:hover:not(:disabled) { background: #f1f5f9; }
	.ncc-filas { display: grid; gap: 10px; padding: 12px; }
	.ncc-fila { display: grid; grid-template-columns: minmax(175px, 1.4fr) repeat(2, minmax(145px, 1fr)) minmax(90px, .6fr) 34px; gap: 9px; align-items: end; padding: 10px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fcfdff; }
	.ncc-campo { display: grid; gap: 5px; min-width: 0; }
	.ncc-campo span { color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
	.ncc-campo input, .ncc-campo select { width: 100%; min-height: 38px; border: 1px solid #cbd5e1; border-radius: 7px; padding: 7px 9px; color: #0f172a; background: #fff; font: inherit; font-size: 13px; }
	.ncc-quitar { width: 34px; height: 38px; color: #b91c1c; }
	.ncc-nota { grid-column: 1 / -1; }
	.ncc-validacion { grid-column: 1 / -1; margin: 0; color: #b45309; font-size: 11px; }
	.ncc-sin-novedades { margin: 0; padding: 16px; color: #166534; font-size: 11px; font-weight: 800; letter-spacing: .04em; }
	.ncc-vacio { padding: 24px; border: 1px dashed #cbd5e1; border-radius: 10px; color: #64748b; text-align: center; }
	.ncc-error { margin: 0; color: #b91c1c; font-size: 13px; }
	button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .65; }
	@media (max-width: 760px) { .ncc-fila { grid-template-columns: 1fr 1fr; } .ncc-tipo, .ncc-nota { grid-column: 1 / -1; } .ncc-quitar { grid-column: 2; justify-self: end; } }
</style>
