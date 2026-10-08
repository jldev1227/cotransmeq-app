<script lang="ts">
	/**
	 * Registrar o editar un gasto directo (no es un anticipo): oficina, mantenimiento, dinero a un
	 * conductor, un cobro del banco u otro. Quién lo asume: la EMPRESA (sin placa) o el PROPIETARIO de
	 * la placa (pide la placa y el servidor relaciona su tercero). Los bancarios (4x1000, cuota de
	 * manejo) son siempre de la empresa, por débito automático. Si lo registra alguien de
	 * operaciones, sale del saldo del área (el servidor lo valida).
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { FileText, Loader2, Upload, X } from 'lucide-svelte';
	import ModalEntidad from '$lib/components/directorio/ModalEntidad.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import SelectBuscable from '$lib/components/common/SelectBuscable.svelte';
	import { conductoresOptions, recursos, vehiculosOptions } from '$lib/stores/recursos';
	import {
		CATEGORIA_LABELS,
		METODO_GASTO_LABELS,
		ASUME_LABELS,
		type AsumeGasto,
		comprimirImagen,
		viaticosAPI,
		viaticosEmpresaAPI,
		type CategoriaGasto,
		type GastoEmpresa,
		type MetodoGasto
	} from '$lib/api/viaticos';

	interface Props {
		open: boolean;
		gasto?: GastoEmpresa | null;
		oncerrar: () => void;
		onguardado: (g: GastoEmpresa) => void;
	}
	let { open, gasto = null, oncerrar, onguardado }: Props = $props();

	const TIPOS = 'image/jpeg,image/png,image/webp,application/pdf';
	const MAX_BYTES = 10 * 1024 * 1024;
	const AYUDA: Record<CategoriaGasto, string> = {
		OFICINA: 'Papelería, aseo, servicios, compras de la oficina.',
		MANTENIMIENTO: 'Arreglo o repuesto de un vehículo que paga la empresa, sin pasar por un conductor.',
		CONDUCTOR: 'Dinero a un conductor que no corresponde a una placa (alimentación, hospedaje…).',
		BANCARIO: 'Cobros del banco a la cuenta: 4x1000, cuota de manejo, comisiones. Siempre de la empresa.',
		OTRO: 'Cualquier otro gasto: peajes, combustible…'
	};

	interface Form {
		categoria: CategoriaGasto | '';
		asume: AsumeGasto;
		descripcion: string;
		beneficiario: string;
		valor: string;
		fecha: string;
		metodo: MetodoGasto;
		numero_comprobante: string;
		vehiculo_id: string;
		conductor_id: string;
	}
	/// Fecha local, no UTC: en la noche de Colombia `toISOString` ya es mañana.
	const hoy = () => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	const desde = (g: GastoEmpresa | null): Form => ({
		categoria: g?.categoria ?? '',
		asume: g?.asume ?? 'EMPRESA',
		descripcion: g?.descripcion ?? '',
		beneficiario: g?.beneficiario ?? '',
		valor: g ? String(Math.round(g.valor)) : '',
		fecha: g?.fecha ?? hoy(),
		metodo: g?.metodo ?? 'TRANSFERENCIA',
		numero_comprobante: g?.numero_comprobante ?? '',
		vehiculo_id: g?.vehiculo?.id ?? '',
		conductor_id: g?.conductor?.id ?? ''
	});

	let form = $state<Form>(desde(null));
	let inicial = $state('');
	let comprobante = $state<{ key: string; mime_type: string; nombre: string; nuevo: boolean } | null>(null);
	let errores = $state<Partial<Record<keyof Form | 'comprobante', string>>>({});
	let tab = $state('gasto');
	let guardando = $state(false);
	let subiendo = $state(false);

	$effect(() => {
		if (!open) return;
		const g = gasto;
		untrack(() => {
			form = desde(g);
			comprobante = g?.comprobante ? { key: g.comprobante.key, mime_type: g.comprobante.mime_type ?? '', nombre: g.comprobante.nombre ?? 'Comprobante', nuevo: false } : null;
			inicial = JSON.stringify(form);
			errores = {};
			tab = 'gasto';
			void recursos.cargarConductores();
			void recursos.cargarVehiculos();
		});
	});

	const sucio = $derived(JSON.stringify(form) !== inicial || !!comprobante?.nuevo);
	const bancario = $derived(form.categoria === 'BANCARIO');
	const valorNumero = $derived(Number(form.valor.replace(/\D/g, '')) || 0);
	const valorVisible = $derived(form.valor ? Number(form.valor).toLocaleString('es-CO') : '');

	async function elegirArchivo(archivo: File | undefined) {
		if (!archivo) return;
		if (!TIPOS.split(',').includes(archivo.type)) return void toast.error('El comprobante debe ser una imagen (JPG, PNG, WEBP) o un PDF.');
		if (archivo.size > MAX_BYTES) return void toast.error('El comprobante no puede pasar de 10 MB.');
		subiendo = true;
		try {
			comprobante = { ...(await viaticosAPI.subirComprobante(await comprimirImagen(archivo))), nuevo: true };
			errores = { ...errores, comprobante: undefined };
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo subir el comprobante');
		} finally {
			subiendo = false;
		}
	}

	function validar() {
		const e: typeof errores = {};
		if (!form.categoria) e.categoria = 'Elige la categoría';
		if (form.descripcion.trim().length < 3) e.descripcion = 'Describe el gasto';
		if (!valorNumero) e.valor = 'Escribe el valor';
		if (!form.fecha) e.fecha = 'Indica la fecha';
		if (form.asume === 'TERCERO' && !form.vehiculo_id) e.vehiculo_id = 'Indica la placa: el gasto lo asume su propietario';
		if (form.categoria === 'CONDUCTOR' && !form.conductor_id) e.conductor_id = 'Indica el conductor';
		errores = e;
		return Object.keys(e).length === 0;
	}

	async function guardar() {
		if (guardando || subiendo || !validar()) return;
		guardando = true;
		try {
			const input = {
				categoria: form.categoria as CategoriaGasto,
				asume: bancario ? 'EMPRESA' : form.asume,
				descripcion: form.descripcion.trim(),
				beneficiario: form.beneficiario.trim() || null,
				valor: valorNumero,
				fecha: form.fecha,
				metodo: form.metodo,
				numero_comprobante: form.numero_comprobante.trim() || null,
				comprobante: comprobante ? { key: comprobante.key, mime_type: comprobante.mime_type, nombre: comprobante.nombre } : null,
				vehiculo_id: form.vehiculo_id || null,
				conductor_id: form.conductor_id || null
			};
			const g = gasto ? await viaticosEmpresaAPI.actualizar(gasto.id, input) : await viaticosEmpresaAPI.crear(input);
			toast.success(gasto ? 'Gasto actualizado' : 'Gasto registrado');
			onguardado(g);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo guardar el gasto');
		} finally {
			guardando = false;
		}
	}
</script>

<ModalEntidad
	{open}
	eyebrow={gasto ? 'EDITAR GASTO' : 'NUEVO GASTO'}
	title={gasto ? 'Gasto de la empresa' : 'Registrar gasto de la empresa'}
	subtitle="Lo asume la empresa, no el tercero propietario. Los campos con * son obligatorios."
	tabs={[{ id: 'gasto', label: 'Gasto' }]}
	bind:tabActiva={tab}
	guardando={guardando || subiendo}
	{sucio}
	textoGuardar={gasto ? 'Guardar cambios' : 'Registrar gasto'}
	onguardar={guardar}
	{oncerrar}
>
	{#snippet children()}
		<div class="de-grid">
			<Campo id="ge-categoria" label="Categoría" requerido completo error={errores.categoria} ayuda={form.categoria ? AYUDA[form.categoria] : undefined}>
				<div class="ge-chips" role="radiogroup" aria-label="Categoría">
					{#each Object.entries(CATEGORIA_LABELS) as [valor, etiqueta] (valor)}
						<button
							type="button"
							role="radio"
							aria-checked={form.categoria === valor}
							class="ge-chip"
							class:activo={form.categoria === valor}
							onclick={() => {
								form.categoria = valor as CategoriaGasto;
								/// Los cobros del banco: de la empresa, por débito automático.
								if (valor === 'BANCARIO') {
									form.asume = 'EMPRESA';
									form.metodo = 'DEBITO_AUTOMATICO';
								}
								errores = { ...errores, categoria: undefined };
							}}>{etiqueta}</button
						>
					{/each}
				</div>
			</Campo>

			{#if !bancario}
				<Campo id="ge-asume" label="¿Quién lo asume?" requerido completo ayuda={form.asume === 'EMPRESA' ? 'Lo reconoce la empresa: no hace falta la placa.' : 'Se le carga al propietario (tercero) de la placa.'}>
					<div class="ge-chips" role="radiogroup" aria-label="Quién lo asume">
						{#each Object.entries(ASUME_LABELS) as [valor, etiqueta] (valor)}
							<button type="button" role="radio" aria-checked={form.asume === valor} class="ge-chip" class:activo={form.asume === valor} onclick={() => (form.asume = valor as AsumeGasto)}>{etiqueta}</button>
						{/each}
					</div>
				</Campo>
			{/if}

			<Campo id="ge-descripcion" label="Descripción" requerido completo error={errores.descripcion}>
				<textarea id="ge-descripcion" class="de-input" rows="2" placeholder="Ej. Cambio de aceite y filtros" bind:value={form.descripcion}></textarea>
			</Campo>

			<Campo id="ge-valor" label="Valor" requerido error={errores.valor}>
				<input
					id="ge-valor"
					class="de-input"
					inputmode="numeric"
					placeholder="$0"
					value={valorVisible}
					oninput={(e) => (form.valor = e.currentTarget.value.replace(/\D/g, ''))}
				/>
			</Campo>
			<Campo id="ge-fecha" label="Fecha" requerido error={errores.fecha}>
				<input id="ge-fecha" class="de-input" type="date" max={hoy()} bind:value={form.fecha} />
			</Campo>

			<Campo id="ge-beneficiario" label="Pagado a" ayuda="Proveedor, taller o persona (opcional)">
				<input id="ge-beneficiario" class="de-input" placeholder="Ej. Lubricentro El Llano" bind:value={form.beneficiario} />
			</Campo>
			<Campo id="ge-metodo" label="Cómo se pagó" requerido>
				<select id="ge-metodo" class="de-input" bind:value={form.metodo}>
					{#each Object.entries(METODO_GASTO_LABELS) as [valor, etiqueta] (valor)}<option value={valor}>{etiqueta}</option>{/each}
				</select>
			</Campo>

			<Campo id="ge-placa" label="Vehículo" requerido={form.asume === 'TERCERO' && !bancario} error={errores.vehiculo_id} ayuda={form.asume === 'TERCERO' && !bancario ? 'Su propietario asume el gasto' : 'Opcional, de referencia'}>
				<SelectBuscable
					opciones={$vehiculosOptions}
					valor={form.vehiculo_id || null}
					placeholder="Sin vehículo"
					placeholderBusqueda="Placa o marca…"
					onSeleccionar={(v) => (form.vehiculo_id = v ?? '')}
				/>
			</Campo>
			<Campo id="ge-conductor" label="Conductor" requerido={form.categoria === 'CONDUCTOR'} error={errores.conductor_id} ayuda="Opcional salvo en gastos a un conductor">
				<SelectBuscable
					opciones={$conductoresOptions}
					valor={form.conductor_id || null}
					placeholder="Sin conductor"
					placeholderBusqueda="Nombre o documento…"
					onSeleccionar={(v) => (form.conductor_id = v ?? '')}
				/>
			</Campo>

			<Campo id="ge-numero" label="Número de comprobante o factura">
				<input id="ge-numero" class="de-input" placeholder="Opcional" bind:value={form.numero_comprobante} />
			</Campo>
			<Campo id="ge-archivo" label="Soporte" ayuda="Foto o PDF de la factura (opcional)">
				{#if comprobante}
					<div class="ge-archivo">
						<FileText size={16} />
						<span>{comprobante.nombre}</span>
						<button type="button" aria-label="Quitar soporte" onclick={() => (comprobante = null)}><X size={14} /></button>
					</div>
				{:else}
					<label class="ge-subir">
						{#if subiendo}<Loader2 size={16} class="ge-gira" /> Subiendo…{:else}<Upload size={16} /> Elegir archivo{/if}
						<input type="file" accept={TIPOS} class="ge-oculto" onchange={(e) => elegirArchivo(e.currentTarget.files?.[0])} />
					</label>
				{/if}
			</Campo>
		</div>
	{/snippet}
</ModalEntidad>

<style>
	.ge-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}
	.ge-chip {
		padding: 0.45rem 0.85rem;
		border: 1.5px solid var(--border-subtle);
		border-radius: 10px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-secondary);
		background: var(--bg-surface);
	}
	.ge-chip.activo {
		border-color: var(--color-emerald-500);
		background: var(--color-emerald-50);
		color: var(--color-emerald-800);
	}
	.ge-archivo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 40px;
		padding: 0 0.7rem;
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		font-size: 13px;
		color: var(--text-primary);
	}
	.ge-archivo span {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ge-subir {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 40px;
		padding: 0 0.85rem;
		border: 1.5px dashed var(--border-subtle);
		border-radius: 10px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.ge-oculto {
		display: none;
	}
	:global(.ge-gira) {
		animation: ge-giro 0.9s linear infinite;
	}
	@keyframes ge-giro {
		to {
			transform: rotate(360deg);
		}
	}
</style>
