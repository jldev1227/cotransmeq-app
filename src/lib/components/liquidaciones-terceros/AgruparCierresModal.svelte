<script lang="ts">
	import { Search } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import { liquidacionesTercerosDescuentosAPI } from '$lib/api/liquidaciones-terceros-descuentos';
	import type { CierreHoja } from '$lib/editor/builders/cierres-finales-identidad';
	import { claseBadgeEstado } from '$lib/editor/builders/cierres-finales-estado';
	import { confirmar } from '$lib/stores/confirm';

	interface Props {
		open: boolean;
		hojas: CierreHoja[];
		oncerrar: () => void;
		onagrupado: () => void;
	}

	let { open, hojas, oncerrar, onagrupado }: Props = $props();

	let busqueda = $state('');
	let seleccion = $state<Set<string>>(new Set());
	let guardando = $state(false);
	let error = $state('');

	function placasDe(hoja: CierreHoja): string[] {
		return hoja.placas?.length ? hoja.placas : [hoja.placa];
	}

	function etiquetaPlaca(hoja: CierreHoja): string {
		const placas = placasDe(hoja);
		return placas.length > 1 ? `VARIAS PLACAS (${placas.length})` : placas[0];
	}

	const elegibles = $derived(
		hojas.filter(
			(h) => h.estado === 'BORRADOR' && !!h.tercero_id && !h.es_multi_propietario
		)
	);

	const porId = $derived(new Map(elegibles.map((h) => [h.id, h])));
	const propietarioElegido = $derived(
		[...seleccion].map((id) => porId.get(id)?.tercero_id).find(Boolean) ?? null
	);

	const grupos = $derived.by(() => {
		const q = busqueda.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
		const mapa = new Map<string, { id: string; nombre: string; hojas: CierreHoja[] }>();
		for (const hoja of elegibles) {
			const id = hoja.tercero_id!;
			const grupo = mapa.get(id) ?? {
				id,
				nombre: hoja.tercero_nombre || 'Tercero sin nombre',
				hojas: []
			};
			grupo.hojas.push(hoja);
			mapa.set(id, grupo);
		}
		return [...mapa.values()]
			.map((grupo) => ({
				...grupo,
				hojas: grupo.hojas
					.filter((h) => {
						if (!q) return true;
						const texto = `${placasDe(h).join(' ')} ${h.consecutivo} ${h.tercero_nombre}`
							.normalize('NFD')
							.replace(/[\u0300-\u036f]/g, '')
							.toLowerCase();
						return texto.includes(q);
					})
					.sort((a, b) => a.placa.localeCompare(b.placa, 'es'))
			}))
			.filter((grupo) => grupo.hojas.length > 1)
			.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
	});

	function marcadasTexto(): string {
		return [
			...new Set(
				[...seleccion].flatMap((id) => {
					const hoja = porId.get(id);
					return hoja ? placasDe(hoja) : [];
				})
			)
		].join(', ');
	}

	$effect(() => {
		if (!open) return;
		busqueda = '';
		seleccion = new Set();
		error = '';
	});

	function alternar(hoja: CierreHoja) {
		const s = new Set(seleccion);
		if (s.has(hoja.id)) {
			s.delete(hoja.id);
		} else {
			/// Una hoja única requiere un mismo beneficiario; el servidor valida
			/// lo mismo para impedir combinar terceros por accidente.
			if (propietarioElegido && hoja.tercero_id !== propietarioElegido) {
				toast.warning('Agrupa un solo tercero a la vez', {
					description: 'Quita las hojas elegidas antes de marcar otro propietario.'
				});
				return;
			}
			s.add(hoja.id);
		}
		seleccion = s;
	}

	async function agrupar() {
		if (seleccion.size < 2 || guardando) return;
		const marcadas = [...seleccion]
			.map((id) => porId.get(id))
			.filter(Boolean) as CierreHoja[];
		const nombre = marcadas[0]?.tercero_nombre || 'el tercero seleccionado';
		const placas = [...new Set(marcadas.flatMap(placasDe))].join(', ');
		const ok = await confirmar({
			eyebrow: 'CIERRES FINALES',
			title: `¿Agrupar ${marcadas.length} borradores?`,
			message:
				`${placas} quedarán en una sola liquidación a nombre de ${nombre}. ` +
				'Se conservarán los items y descuentos de cada placa; los impuestos se recalcularán sobre el consolidado.',
			tone: 'warning',
			confirmText: 'Agrupar borradores',
			cancelText: 'Revisar selección'
		});
		if (!ok) return;

		guardando = true;
		error = '';
		try {
			const cierre = await liquidacionesTercerosDescuentosAPI.agruparBorradores([...seleccion]);
			toast.success('Borradores agrupados', {
				description: `${cierre.placas.join(', ')} ahora aparecen en una sola hoja para ${nombre}.`
			});
			onagrupado();
			oncerrar();
		} catch (e: any) {
			error = e?.response?.data?.error || e?.message || 'No se pudieron agrupar los borradores.';
		} finally {
			guardando = false;
		}
	}
</script>

<ModalBase
	{open}
	title="Agrupar borradores"
	eyebrow="Cierres finales"
	subtitle="Elige cierres del mismo tercero para reunirlos en una sola hoja del canvas."
	tamano="lg"
	bloqueado={guardando}
	cerrarAlFondo={!guardando}
	{oncerrar}
>
	<div class="ag-wrap">
		<label class="ag-buscar">
			<Search size={16} aria-hidden="true" />
			<input bind:value={busqueda} type="search" placeholder="Buscar placa, tercero o consecutivo" />
		</label>

		{#if elegibles.length < 2}
			<div class="ag-aviso">
				No hay dos borradores separados del mismo tercero en este periodo. Solo se pueden agrupar
				cierres en estado BORRADOR.
			</div>
		{:else if grupos.length === 0}
			<div class="ag-vacio">
				{#if busqueda.trim()}
					No hay borradores que coincidan con «{busqueda}».
				{:else}
					No hay dos borradores separados del mismo tercero. Cada grupo debe pertenecer a un solo
					propietario.
				{/if}
			</div>
		{:else}
			{#each grupos as grupo (grupo.id)}
				<section class="ag-grupo">
					<header>
						<strong>{grupo.nombre}</strong>
						<span>{grupo.hojas.length} borrador(es)</span>
					</header>
					<ul>
						{#each grupo.hojas as hoja (hoja.id)}
							<li>
								<label>
									<input
										type="checkbox"
										checked={seleccion.has(hoja.id)}
										disabled={
										guardando || (!!propietarioElegido && propietarioElegido !== hoja.tercero_id)
									}
										onchange={() => alternar(hoja)}
									/>
									<span class="ag-placa" title={placasDe(hoja).join(', ')}>
										{etiquetaPlaca(hoja)}
									</span>
									<span class="ag-consecutivo">{hoja.consecutivo}</span>
									<span class="ag-estado {claseBadgeEstado(hoja.estado)}">{hoja.estado}</span>
								</label>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		{/if}

		{#if seleccion.size > 0}
			<div class="ag-seleccion">
				<strong>{seleccion.size} hoja(s) seleccionada(s)</strong>
				<span>{marcadasTexto()}</span>
			</div>
		{/if}
		{#if error}<div class="ag-error" role="alert">{error}</div>{/if}
	</div>

	{#snippet pie()}
		<button class="btn-secondary" onclick={oncerrar} disabled={guardando}>Cancelar</button>
		<button class="btn-primary" onclick={agrupar} disabled={seleccion.size < 2 || guardando}>
			{guardando ? 'Agrupando…' : `Agrupar ${seleccion.size} borradores`}
		</button>
	{/snippet}
</ModalBase>

<style>
	.ag-wrap {
		display: grid;
		gap: 12px;
	}
	.ag-buscar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		color: var(--text-muted);
	}
	.ag-buscar input {
		width: 100%;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text-primary);
		font: inherit;
	}
	.ag-grupo {
		overflow: hidden;
		border: 1px solid var(--border-default);
		border-radius: 14px;
	}
	.ag-grupo header {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 14px;
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 13px;
	}
	.ag-grupo header span {
		color: var(--text-muted);
		font-size: 11px;
	}
	.ag-grupo ul {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		margin: 0;
		padding: 4px 12px;
		list-style: none;
	}
	.ag-grupo li {
		min-width: 0;
	}
	.ag-grupo li label {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		cursor: pointer;
	}
	.ag-grupo input {
		accent-color: var(--accion);
	}
	.ag-placa {
		min-width: 72px;
		color: var(--text-primary);
		font: 700 13px ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.ag-consecutivo {
		overflow: hidden;
		color: var(--text-muted);
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ag-estado {
		margin-left: auto;
		border-radius: 999px;
		padding: 3px 7px;
		font-size: 9px;
		font-weight: 700;
	}
	.ag-seleccion {
		display: grid;
		gap: 3px;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 12px;
	}
	.ag-seleccion span {
		color: var(--text-muted);
	}
	.ag-aviso,
	.ag-vacio,
	.ag-error {
		padding: 14px;
		border-radius: 12px;
		background: var(--bg-base);
		color: var(--text-secondary);
		font-size: 13px;
	}
	.ag-error {
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #991b1b;
	}
</style>
