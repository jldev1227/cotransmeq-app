<script lang="ts">
	/**
	 * Pestaña «Tarifas» de la ficha del cliente: las tarifas pactadas por año
	 * (`tarifas_servicios`), una por año, con la operadora cuya tabla de
	 * precios aplica.
	 *
	 * El backend las tenía desde hace meses sin ninguna pantalla —y su creación
	 * ni siquiera guardaba el cliente—. Cada campo explica qué afecta al
	 * liquidar, porque no todos entran al cálculo automático: la vista previa
	 * de liquidación (`previewLiquidacion`) usa 24 h, 12 h y pernocte; la hora
	 * y el km adicionales quedan como referencia para los ítems que se digitan.
	 *
	 * Consultar pide `liquidaciones-servicios` (facturación incluida); crear,
	 * editar y desactivar piden `full`.
	 */
	import { onMount, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { ColumnDef } from '@tanstack/table-core';
	import { Pencil, Plus, Power, RotateCcw } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import TablaLista from '$lib/components/listing/TablaLista.svelte';
	import EstadoPunto from '$lib/components/listing/EstadoPunto.svelte';
	import AccionesFila from '$lib/components/listing/AccionesFila.svelte';
	import { authStore } from '$lib/stores/auth';
	import { confirmar } from '$lib/stores/confirm';
	import { mascota } from '$lib/mascot';
	import {
		tarifasAPI,
		type OperadoraTarifa,
		type TarifaCliente,
		type TarifaClienteInput
	} from '$lib/api/tarifas';

	interface Props {
		clienteId: string;
		clienteNombre: string;
	}
	let { clienteId, clienteNombre }: Props = $props();

	const puedeEditar = $derived(
		!!$authStore.user && authStore.getAccessLevel('liquidaciones-servicios') === 'full'
	);

	/// Qué hace cada valor al liquidar. Sale de `previewLiquidacion` en el
	/// backend: si allí cambia el cálculo, cambia aquí el texto.
	const AYUDA = {
		valor_24h:
			'Servicio de más de 12 horas: un día. Pasadas 24 horas, uno por cada 24 h o fracción.',
		valor_12h: 'Servicio de hasta 12 horas.',
		valor_pernocte: 'Se cobra por cada día de la planilla marcado con pernocte.',
		valor_hora: 'Referencia para los ítems de hora adicional; el cálculo automático no la aplica.',
		valor_km: 'Referencia para los ítems de km adicional; el cálculo automático no lo aplica.',
		km_dia: 'Kilómetros incluidos en el día antes de cobrar km adicional (referencia).'
	} as const;

	const cop = new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		maximumFractionDigits: 0
	});
	const moneda = (v: number) => cop.format(v);
	const anioActual = new Date().getFullYear();

	let tarifas = $state<TarifaCliente[]>([]);
	let cargando = $state(true);

	async function cargar() {
		cargando = true;
		try {
			tarifas = await tarifasAPI.listar(clienteId);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las tarifas');
		} finally {
			cargando = false;
		}
	}
	onMount(cargar);

	/// La que manda hoy: la activa del año en curso, o la más reciente activa.
	const vigente = $derived(
		tarifas.find((t) => t.activo && t.anio === anioActual) ??
			tarifas.filter((t) => t.activo).sort((a, b) => b.anio - a.anio)[0] ??
			null
	);

	const COLUMNAS: ColumnDef<TarifaCliente, any>[] = [
		{ id: 'anio', header: 'Año · Operadora', enableSorting: false, size: 150 },
		{ id: 'dia', header: '24 h', enableSorting: false, size: 130 },
		{ id: 'medio', header: '12 h', enableSorting: false, size: 130 },
		{ id: 'pernocte', header: 'Pernocte', enableSorting: false, size: 130 },
		{ id: 'hora', header: 'Hora adicional', enableSorting: false, size: 140 },
		{ id: 'km', header: 'Km adicional', enableSorting: false, size: 150 },
		{ id: 'estado', header: 'Estado', enableSorting: false, size: 120 },
		{ id: 'acciones', header: '', enableSorting: false, size: 100 }
	];

	// ── Formulario ───────────────────────────────────────────────────────
	interface Form {
		anio: string;
		operadora: OperadoraTarifa | '';
		valor_24h: string;
		valor_12h: string;
		valor_hora: string;
		valor_km: string;
		km_dia: string;
		valor_pernocte: string;
	}
	const CAMPOS_VALOR = [
		'valor_24h',
		'valor_12h',
		'valor_pernocte',
		'valor_hora',
		'valor_km'
	] as const;

	let abierto = $state(false);
	let enEdicion = $state<TarifaCliente | null>(null);
	let form = $state<Form>(vacio());
	let inicial = $state('');
	let errores = $state<Partial<Record<keyof Form, string>>>({});
	let guardando = $state(false);
	const idForm = `tarifa-${Math.random().toString(36).slice(2, 8)}`;

	function vacio(): Form {
		return {
			anio: '',
			operadora: '',
			valor_24h: '',
			valor_12h: '',
			valor_hora: '',
			valor_km: '',
			km_dia: '150',
			valor_pernocte: ''
		};
	}

	/// Una tarifa nueva parte del primer año libre desde el actual y copia los
	/// valores de la vigente: el reajuste anual suele tocar pocos números.
	function abrirNueva() {
		const ocupados = new Set(tarifas.filter((t) => t.activo).map((t) => t.anio));
		let anio = anioActual;
		while (ocupados.has(anio)) anio++;
		const base = vigente;
		enEdicion = null;
		form = base
			? {
					...desdeTarifa(base),
					anio: String(anio)
				}
			: { ...vacio(), anio: String(anio) };
		abrir();
	}

	function desdeTarifa(t: TarifaCliente): Form {
		return {
			anio: String(t.anio),
			operadora: t.operadora ?? '',
			valor_24h: String(Math.round(t.valor_24h)),
			valor_12h: String(Math.round(t.valor_12h)),
			valor_hora: String(Math.round(t.valor_hora)),
			valor_km: String(Math.round(t.valor_km)),
			km_dia: String(t.km_dia),
			valor_pernocte: String(Math.round(t.valor_pernocte))
		};
	}

	function abrirEdicion(t: TarifaCliente) {
		enEdicion = t;
		form = desdeTarifa(t);
		abrir();
	}

	function abrir() {
		inicial = JSON.stringify(form);
		errores = {};
		abierto = true;
	}

	const sucio = $derived(JSON.stringify(form) !== inicial);
	const miles = (v: string) => (v ? Number(v).toLocaleString('es-CO') : '');

	function validar(): TarifaClienteInput | null {
		const e: typeof errores = {};
		const anio = Number(form.anio);
		if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) e.anio = 'Año inválido';
		else if (tarifas.some((t) => t.activo && t.anio === anio && t.id !== enEdicion?.id))
			e.anio = `Ya hay una tarifa activa de ${anio}: edítala en vez de crear otra.`;
		if (!form.operadora) e.operadora = 'Elige la operadora';
		if (!(Number(form.valor_24h) > 0)) e.valor_24h = 'Escribe el valor de 24 h';
		if (!(Number(form.valor_12h) > 0)) e.valor_12h = 'Escribe el valor de 12 h';
		errores = e;
		if (Object.keys(e).length) return null;
		return {
			anio,
			operadora: form.operadora as OperadoraTarifa,
			valor_24h: Number(form.valor_24h),
			valor_12h: Number(form.valor_12h),
			valor_hora: Number(form.valor_hora) || 0,
			valor_km: Number(form.valor_km) || 0,
			km_dia: Number(form.km_dia) || 0,
			valor_pernocte: Number(form.valor_pernocte) || 0
		};
	}

	async function guardar(ev: SubmitEvent) {
		ev.preventDefault();
		if (guardando) return;
		const input = validar();
		if (!input) return;
		guardando = true;
		try {
			if (enEdicion) await tarifasAPI.actualizar(enEdicion.id, input);
			else await tarifasAPI.crear(clienteId, input);
			toast.success(enEdicion ? 'Tarifa actualizada' : `Tarifa ${input.anio} creada`);
			abierto = false;
			await cargar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo guardar la tarifa');
		} finally {
			guardando = false;
		}
	}

	async function cerrar() {
		if (guardando) return;
		if (
			sucio &&
			!(await confirmar({
				title: '¿Descartar los cambios?',
				message: 'Los valores que escribiste no se han guardado.',
				tone: 'warning',
				confirmText: 'Descartar',
				cancelText: 'Seguir editando'
			}))
		)
			return;
		abierto = false;
	}

	async function cambiarActivo(t: TarifaCliente) {
		if (t.activo) {
			const ok = await confirmar({
				title: `¿Desactivar la tarifa ${t.anio}?`,
				message:
					'Deja de ofrecerse al liquidar. Las liquidaciones ya registradas no cambian: guardan sus propios valores. Puedes reactivarla cuando quieras.',
				tone: 'danger',
				confirmText: 'Desactivar'
			});
			if (!ok) return;
		}
		try {
			if (t.activo) await tarifasAPI.desactivar(t.id);
			else await tarifasAPI.actualizar(t.id, { activo: true });
			toast.success(t.activo ? `Tarifa ${t.anio} desactivada` : `Tarifa ${t.anio} reactivada`);
			await cargar();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'No se pudo cambiar la tarifa');
		}
	}

	/// Al corregir el campo con error, el error se va.
	$effect(() => {
		void [form.anio, form.operadora, form.valor_24h, form.valor_12h];
		untrack(() => {
			if (Object.keys(errores).length) validar();
		});
	});
</script>

<section class="tc">
	<header class="tc-cabecera">
		<div>
			<h2 class="tc-titulo">Tarifas por año</h2>
			<p class="tc-desc">
				{#if vigente}
					Vigente: {vigente.anio}{vigente.operadora ? ` · tabla ${vigente.operadora}` : ''} —
					{moneda(vigente.valor_24h)} el día de 24 h.
				{:else}
					{clienteNombre} no tiene tarifa activa.
				{/if}
				Cambiar una tarifa no recalcula liquidaciones ya registradas: cada una guarda sus valores.
			</p>
		</div>
		{#if puedeEditar}
			<button type="button" class="btn-primary" onclick={abrirNueva}>
				<Plus size={16} strokeWidth={2.4} /> Nueva tarifa
			</button>
		{/if}
	</header>

	{#if cargando && tarifas.length === 0}
		<CargaMascota texto="Cargando tarifas…" />
	{:else}
		<TablaLista
			columnas={COLUMNAS}
			datos={tarifas}
			claveFila={(t) => t.id}
			{cargando}
			onFila={puedeEditar ? abrirEdicion : undefined}
			etiqueta={`Tarifas de ${clienteNombre}`}
		>
			{#snippet celda({ columnaId, fila: t })}
				{#if columnaId === 'anio'}
					<div class="dir-celda">
						<span class="tc-fuerte">{t.anio}</span>
						<small>{t.operadora ? `Tabla ${t.operadora}` : 'Sin operadora'}</small>
					</div>
				{:else if columnaId === 'dia'}
					<span class="tc-num tc-fuerte">{moneda(t.valor_24h)}</span>
				{:else if columnaId === 'medio'}
					<span class="tc-num">{moneda(t.valor_12h)}</span>
				{:else if columnaId === 'pernocte'}
					<span class="tc-num">{moneda(t.valor_pernocte)}</span>
				{:else if columnaId === 'hora'}
					<span class="tc-num">{moneda(t.valor_hora)}</span>
				{:else if columnaId === 'km'}
					<div class="dir-celda">
						<span class="tc-num">{moneda(t.valor_km)}</span>
						<small>{t.km_dia.toLocaleString('es-CO')} km incluidos/día</small>
					</div>
				{:else if columnaId === 'estado'}
					<EstadoPunto
						etiqueta={t.activo ? (t.id === vigente?.id ? 'Vigente' : 'Activa') : 'Inactiva'}
						color={t.activo ? '#16a34a' : '#9ca3af'}
						apagado={!t.activo}
					/>
				{:else if columnaId === 'acciones'}
					<AccionesFila
						acciones={[
							{
								id: 'editar',
								etiqueta: 'Editar',
								icono: Pencil,
								onClick: () => abrirEdicion(t),
								oculta: !puedeEditar
							},
							{
								id: 'activo',
								etiqueta: t.activo ? 'Desactivar' : 'Reactivar',
								icono: t.activo ? Power : RotateCcw,
								onClick: () => cambiarActivo(t),
								peligrosa: t.activo,
								oculta: !puedeEditar
							}
						]}
					/>
				{/if}
			{/snippet}

			{#snippet vacio()}
				{@const img = mascota('vacio')}
				<div class="dir-vacio">
					<img src={img.src} alt={img.alt} width="418" height="418" />
					<h3>Sin tarifas</h3>
					<p>
						Registra la tarifa pactada del año: el valor del día de 24 h, el de 12 h y el pernocte
						son los que valoran los servicios al liquidar.
					</p>
					{#if puedeEditar}
						<button type="button" class="btn-primary" onclick={abrirNueva}>
							<Plus size={16} strokeWidth={2.4} /> Nueva tarifa
						</button>
					{/if}
				</div>
			{/snippet}
		</TablaLista>
	{/if}

	<dl class="tc-guia" aria-label="Qué afecta cada valor">
		<div>
			<dt>24 h</dt>
			<dd>{AYUDA.valor_24h}</dd>
		</div>
		<div>
			<dt>12 h</dt>
			<dd>{AYUDA.valor_12h}</dd>
		</div>
		<div>
			<dt>Pernocte</dt>
			<dd>{AYUDA.valor_pernocte}</dd>
		</div>
		<div>
			<dt>Hora y km adicional</dt>
			<dd>
				Valores pactados de referencia para digitar esos ítems; el cálculo automático todavía no los
				aplica.
			</dd>
		</div>
		<div>
			<dt>Valor propio del servicio</dt>
			<dd>Si el servicio ya trae un valor pactado, ese valor manda sobre la tarifa.</dd>
		</div>
	</dl>
</section>

<ModalBase
	open={abierto}
	tamano="md"
	eyebrow={enEdicion ? 'Editar tarifa' : 'Nueva tarifa'}
	title={enEdicion ? `Tarifa ${enEdicion.anio}` : `Tarifa de ${clienteNombre}`}
	subtitle="Una tarifa por año. Los campos con * son obligatorios."
	bloqueado={guardando}
	cerrarAlFondo={false}
	oncerrar={cerrar}
>
	<form id={idForm} class="tc-grid" novalidate onsubmit={guardar}>
		<Campo id="tc-anio" label="Año" requerido error={errores.anio}>
			<input
				id="tc-anio"
				class="tc-input tc-num"
				inputmode="numeric"
				maxlength="4"
				value={form.anio}
				oninput={(e) => (form.anio = e.currentTarget.value.replace(/\D/g, ''))}
				aria-invalid={errores.anio ? 'true' : undefined}
			/>
		</Campo>
		<Campo
			id="tc-operadora"
			label="Operadora"
			requerido
			error={errores.operadora}
			ayuda="Tabla de precios del contrato que aplica."
		>
			<div class="tc-chips" role="radiogroup" aria-label="Operadora">
				{#each ['PAREX', 'GEOPARK'] as const as op (op)}
					<button
						type="button"
						role="radio"
						aria-checked={form.operadora === op}
						class="tc-chip"
						class:activo={form.operadora === op}
						onclick={() => (form.operadora = op)}>{op}</button
					>
				{/each}
			</div>
		</Campo>

		{#each CAMPOS_VALOR as campo (campo)}
			<Campo
				id="tc-{campo}"
				label={{
					valor_24h: 'Día de 24 h',
					valor_12h: 'Servicio de 12 h',
					valor_pernocte: 'Pernocte',
					valor_hora: 'Hora adicional',
					valor_km: 'Km adicional'
				}[campo]}
				requerido={campo === 'valor_24h' || campo === 'valor_12h'}
				error={errores[campo]}
				ayuda={AYUDA[campo]}
			>
				<input
					id="tc-{campo}"
					class="tc-input tc-num"
					inputmode="numeric"
					placeholder="$0"
					value={miles(form[campo])}
					oninput={(e) => (form[campo] = e.currentTarget.value.replace(/\D/g, ''))}
					aria-invalid={errores[campo] ? 'true' : undefined}
				/>
			</Campo>
		{/each}

		<Campo id="tc-km-dia" label="Km incluidos por día" ayuda={AYUDA.km_dia}>
			<input
				id="tc-km-dia"
				class="tc-input tc-num"
				inputmode="numeric"
				value={form.km_dia}
				oninput={(e) => (form.km_dia = e.currentTarget.value.replace(/\D/g, ''))}
			/>
		</Campo>
	</form>

	{#snippet pie()}
		<button type="button" class="btn-secondary" disabled={guardando} onclick={cerrar}>
			Cancelar
		</button>
		<button type="submit" form={idForm} class="btn-primary" disabled={guardando}>
			{guardando ? 'Guardando…' : enEdicion ? 'Guardar cambios' : 'Crear tarifa'}
		</button>
	{/snippet}
</ModalBase>

<style>
	.tc {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		background: var(--bg-surface);
	}
	.tc-cabecera {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem 1rem;
	}
	.tc-titulo {
		margin: 0;
		font-size: 1rem;
		font-weight: 800;
		color: var(--text-primary);
	}
	.tc-desc {
		margin: 0.25rem 0 0;
		max-width: 44rem;
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	.tc-num {
		font-variant-numeric: tabular-nums;
	}
	.tc-fuerte {
		font-weight: 700;
	}

	.tc-guia {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.6rem 1rem;
		margin: 0;
		padding: 0.85rem 1rem;
		border-radius: 12px;
		background: var(--bg-base);
		font-size: 0.78rem;
	}
	.tc-guia dt {
		font-weight: 700;
		color: var(--text-secondary);
	}
	.tc-guia dd {
		margin: 0.1rem 0 0;
		color: var(--text-muted);
	}

	.tc-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 16px 18px;
	}
	/* Mismo control que `.de-input` de los modales de directorio. */
	.tc-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
	}
	.tc-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.tc-input[aria-invalid='true'] {
		border-color: #dc2626;
		background: #fff8f7;
	}
	.tc-chips {
		display: flex;
		gap: 0.45rem;
	}
	.tc-chip {
		min-height: 42px;
		padding: 0.45rem 0.9rem;
		border: 1.5px solid var(--border-subtle);
		border-radius: 10px;
		font-size: 13px;
		font-weight: 700;
		color: var(--text-secondary);
		background: var(--bg-surface);
	}
	.tc-chip.activo {
		border-color: var(--color-emerald-500);
		background: var(--color-emerald-50);
		color: var(--color-emerald-800);
	}
</style>
