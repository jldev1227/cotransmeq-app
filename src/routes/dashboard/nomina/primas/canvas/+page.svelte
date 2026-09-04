<script lang="ts">
	/**
	 * Canvas de PRIMAS de nómina.
	 *
	 * Era la segunda pestaña de `/dashboard/nomina`. A diferencia de Análisis,
	 * este SÍ escribe: crea, edita, borra, previsualiza envíos, los manda,
	 * alterna la visibilidad en el portal del conductor y consulta firmas.
	 *
	 * Por eso su `onSalir` pregunta antes de saltar a otro canvas: con un
	 * formulario abierto a medias, cambiar de canvas tira lo escrito sin aviso.
	 *
	 * No monta Univer. La cáscara (`UniverShell`, vía el `+layout@.svelte`) es
	 * solo layout de viewport completo más el toolbar con el «Ir a…».
	 */
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { texto, opcion, numero, firma, valoresPorDefecto } from '$lib/listing/filtros';
	import { crearEstadoUrl } from '$lib/listing/urlState';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';
	import {
		obtenerPrimas,
		crearPrima,
		editarPrima,
		eliminarPrima as eliminarPrimaApi,
		previewPrimas,
		enviarPrimas,
		togglePrimaPortalVisible,
		obtenerPrimaConFirma,
		obtenerFirmaPrima,
		obtenerPrimaFirmaEnriquecida
	} from '$lib/api/nomina';
	import type { Prima, CreatePrimaPayload, PrimasStats, PrimaEstado } from '$lib/types/nomina';
	import PrimaFormModal from '$lib/components/nomina/PrimaFormModal.svelte';
	import { generarPdfPrima } from '$lib/utils/pdfPrima';
	import UniverToolbar from '$lib/components/univer/UniverToolbar.svelte';
	import SelectorCanvasNomina from '$lib/components/univer/SelectorCanvasNomina.svelte';
	import {
		CheckCircle,
		Clock,
		AlertCircle,
		Download,
		Edit,
		Eye,
		EyeOff,
		Pencil,
		Plus,
		Send,
		Sparkles,
		Trash2,
		TrendingUp,
		X,
		XCircle
	} from 'lucide-svelte';

	type Direccion = 'asc' | 'desc';

	// =============================================
	// FILTROS EN LA URL
	// =============================================
	/**
	 * Los mismos nombres que tenían en la pestaña (`qPrimas`, `mesPrima`…)
	 * para que los enlaces ya repartidos sigan valiendo.
	 */
	const DEFS = {
		qPrimas: texto(),
		mesPrima: texto(),
		anioPrima: texto(),
		ordenPrima: texto(),
		dirPrima: opcion<Direccion>('desc'),
		paginaPrimas: numero(1)
	};
	const estadoUrl = crearEstadoUrl(DEFS);
	let filtros = $state(estadoUrl.leerInicial());

	$effect(() => {
		void firma(DEFS, filtros);
		if (!browser) return;
		estadoUrl.escribir(
			untrack(() => page.url),
			untrack(() => filtros)
		);
	});

	/// El periodo que viaja al siguiente canvas.
	const anioSalto = $derived(Number(filtros.anioPrima) || new Date().getFullYear());
	const mesSalto = $derived(Number(filtros.mesPrima) || new Date().getMonth() + 1);

	// =============================================
	// ESTADO — PRIMAS
	// =============================================
	let primas = $state<Prima[]>([]);
	let loadingPrimas = $state(true);
	let searchPrimasTimeout: ReturnType<typeof setTimeout>;
	let selectedPrimas = $state<Set<string>>(new Set());
	let showDeletePrimaModal = $state(false);
	let primaToDelete = $state<string | null>(null);
	let showPrimaFormModal = $state(false);
	let primaToEdit = $state<Prima | null>(null);
	let savingPrima = $state(false);
	let downloadingPrimaPdf = $state<string | null>(null);

	// Preview / envío de primas (separado del de liquidaciones)
	let showPreviewPrimasModal = $state(false);
	let previewPrimaItems = $state<
		Array<{
			primaId: string;
			conductor: string;
			email: string | null;
			mes: number;
			anio: number;
			prima: number;
			prima_pendiente: number | null;
			estado: string;
			canSend: boolean;
		}>
	>([]);
	let previewPrimasLoading = $state(false);
	let sendingPrimasEmails = $state(false);
	let sendPrimasResults = $state<
		Array<{
			primaId: string;
			conductor: string;
			email?: string;
			status: 'enviado' | 'error';
			message?: string;
			portalLink?: string;
		}>
	>([]);
	let sendPrimasComplete = $state(false);
	let paginationPrimas = $state({
		total: 0,
		page: 1,
		limit: 20,
		totalPages: 0,
		hasNext: false,
		hasPrev: false
	});
	let statsPrimas = $state<PrimasStats>({
		total: 0,
		totalPendientes: 0,
		totalPagados: 0,
		montoTotal: 0
	});

	function formatCurrency(n: number): string {
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(n);
	}

	async function cargarPrimas() {
		try {
			loadingPrimas = true;
			const params: any = { page: filtros.paginaPrimas, limit: paginationPrimas.limit };
			if (filtros.qPrimas.trim()) params.search = filtros.qPrimas.trim();
			if (filtros.mesPrima) params.mes = filtros.mesPrima;
			if (filtros.anioPrima) params.anio = filtros.anioPrima;
			if (filtros.ordenPrima) {
				params.sortBy = filtros.ordenPrima;
				params.sortOrder = filtros.dirPrima;
			}
			const t0 = performance.now();
			const r: any = await obtenerPrimas(params);
			const dt = Math.round(performance.now() - t0);
			primas = r.data?.primas || r.data || [];

			const totalFirmados = primas.filter((p: any) => {
				return (
					p.firmado === true ||
					p.firmado === 1 ||
					p.firmado === 'true' ||
					p.firmada === true ||
					p.firmada === 1 ||
					p.firmada === 'true' ||
					p.is_firmado === true ||
					(Array.isArray(p.firmas_primas) && p.firmas_primas.length > 0) ||
					p.fecha_firma != null
				);
			}).length;
			if (r.data?.pagination) paginationPrimas = { ...paginationPrimas, ...r.data.pagination };
			if (r.data?.stats) statsPrimas = r.data.stats;
			// Persistir en sessionStorage para que el mock de envío de emails
			// pueda resolver el email del conductor sin volver a la API.
			try {
				sessionStorage.setItem('primas_cache', JSON.stringify(primas));
			} catch {
				/* ignore */
			}
		} catch (e) {
			console.error('❌ [Primas] Error cargando primas:', e);
			toast.error('Error al cargar las primas');
		} finally {
			loadingPrimas = false;
		}
	}

	function clearPrimaFilters() {
		/// Sin lista de conservados: en este canvas los `DEFS` son solo los de
		/// primas, así que limpiar es limpiarlo todo.
		filtros = valoresPorDefecto(DEFS);
	}

	function togglePrimaSelection(id: string) {
		const siguiente = new Set(selectedPrimas);
		if (siguiente.has(id)) siguiente.delete(id);
		else siguiente.add(id);
		selectedPrimas = siguiente;
	}

	function abrirCrearPrima() {
		primaToEdit = null;
		showPrimaFormModal = true;
	}

	function abrirEditarPrima(p: Prima) {
		primaToEdit = p;
		showPrimaFormModal = true;
	}

	function confirmarEliminarPrima(id: string) {
		primaToDelete = id;
		showDeletePrimaModal = true;
	}

	async function eliminarPrima() {
		if (!primaToDelete) return;
		try {
			await eliminarPrimaApi(primaToDelete);
			toast.success('Prima eliminada correctamente');
			await cargarPrimas();
			showDeletePrimaModal = false;
			primaToDelete = null;
		} catch (e) {
			toast.error('Error al eliminar la prima');
		}
	}

	async function handleGuardarPrima(payload: CreatePrimaPayload) {
		try {
			savingPrima = true;
			if (primaToEdit) {
				await editarPrima(primaToEdit.id, payload);
				toast.success('Prima actualizada');
			} else {
				await crearPrima(payload);
				toast.success('Prima creada');
			}
			showPrimaFormModal = false;
			primaToEdit = null;
			await cargarPrimas();
		} catch (e: any) {
			console.error('Error guardando prima:', e);
			toast.error(e?.response?.data?.message || 'Error al guardar la prima');
		} finally {
			savingPrima = false;
		}
	}

	async function handleDescargarPdfPrima(p: Prima) {
		try {
			downloadingPrimaPdf = p.id;
			const firmas: any[] = [];
			let firmaOrigen: 'prima' | 'nomina' | null = null;

			try {
				// 1) PRIORIDAD: Firma propia de la prima (vía endpoint enriquecido del dashboard)
				//    Este endpoint usa auth de admin, por lo que funciona aunque no haya
				//    sesión de portal del conductor. El backend aplica fallback automático
				//    a firma de nómina del mismo conductor del mismo mes/año (±1 mes).
				try {
					const firmaEnriquecida: any = await obtenerPrimaFirmaEnriquecida(p.id);
					if (firmaEnriquecida?.presignedUrl) {
						firmas.push({
							presignedUrl: firmaEnriquecida.presignedUrl,
							fecha_firma: firmaEnriquecida.fecha_firma
						});
						firmaOrigen = firmaEnriquecida.origen || 'prima';
					}
				} catch (e) {
					console.warn(
						'[Prima PDF] No se pudo obtener firma de prima vía endpoint enriquecido (admin):',
						e
					);
				}
			} catch (e) {
				console.warn('No se pudo obtener firma para la prima:', e);
			}

			await generarPdfPrima(p, firmas);
			if (firmas.length) {
				const msg =
					firmaOrigen === 'prima'
						? 'PDF generado con firma de prima del conductor'
						: 'PDF generado con firma del desprendible (mismo periodo)';
				toast.success(msg);
			} else {
				toast('PDF generado sin firma', {
					description:
						'El conductor aún no ha firmado esta prima ni el desprendible del mismo periodo.',
					duration: 5000
				});
			}
		} catch (e) {
			console.error('Error generando PDF de prima:', e);
			toast.error('Error al generar el PDF de prima');
		} finally {
			downloadingPrimaPdf = null;
		}
	}

	function getPrimaMesLabel(mes: number): string {
		const nombres = [
			'',
			'Enero',
			'Febrero',
			'Marzo',
			'Abril',
			'Mayo',
			'Junio',
			'Julio',
			'Agosto',
			'Septiembre',
			'Octubre',
			'Noviembre',
			'Diciembre'
		];
		return nombres[mes] || 'N/A';
	}

	function getPrimaEstadoColor(e: PrimaEstado): string {
		return e === 'Pagado'
			? 'bg-[rgba(16,185,129,0.10)] text-[var(--emerald-700)]'
			: 'bg-[rgba(245,158,11,0.10)] text-[#92400E]';
	}

	function getPrimaFirmaInfo(p: Prima): { label: string; classes: string; icon: any } {
		const raw: any = p as any;
		const firmadoFlag =
			raw?.firmado === true ||
			raw?.firmado === 1 ||
			raw?.firmado === 'true' ||
			raw?.firmada === true ||
			raw?.firmada === 1 ||
			raw?.firmada === 'true' ||
			raw?.is_firmado === true ||
			(typeof raw?.firmas_primas_count === 'number' && raw.firmas_primas_count > 0) ||
			(Array.isArray(raw?.firmas_primas) && raw.firmas_primas.length > 0) ||
			raw?.fecha_firma != null;

		if (firmadoFlag) {
			return {
				label: 'Firmado',
				classes: 'bg-[rgba(16,185,129,0.10)] text-[var(--emerald-700)]',
				icon: CheckCircle
			};
		}
		return {
			label: 'Sin firmar',
			classes: 'bg-[var(--bg-base)] text-[var(--text-muted)]',
			icon: XCircle
		};
	}

	// ── Selección / Bulk actions / Preview / Envío (primas) ─────────
	function togglePrimaSelectAll() {
		selectedPrimas =
			selectedPrimas.size === primas.length ? new Set() : new Set(primas.map((p) => p.id));
	}

	async function handleBulkTogglePrimaVisible(visible: boolean) {
		if (selectedPrimas.size === 0) {
			toast.error('Selecciona al menos una prima');
			return;
		}
		try {
			const ids = Array.from(selectedPrimas);
			await togglePrimaPortalVisible(ids, visible);
			toast.success(
				`${ids.length} prima(s) ${visible ? 'visibles en portal' : 'ocultas del portal'}`
			);
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al cambiar visibilidad');
		}
	}

	async function handleTogglePrimaVisible(id: string) {
		try {
			await togglePrimaPortalVisible([id], true);
			toast.success('Prima visible en el portal del conductor');
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al cambiar visibilidad');
		}
	}

	async function abrirPreviewPrimas() {
		if (selectedPrimas.size === 0) {
			toast.error('Selecciona al menos una prima');
			return;
		}
		try {
			previewPrimasLoading = true;
			sendPrimasComplete = false;
			sendPrimasResults = [];
			showPreviewPrimasModal = true;
			const r = await previewPrimas(Array.from(selectedPrimas));
			previewPrimaItems = r.items ?? [];
		} catch (err: any) {
			toast.error('Error al cargar preview de primas');
			showPreviewPrimasModal = false;
		} finally {
			previewPrimasLoading = false;
		}
	}

	async function confirmarEnvioPrimas() {
		const idsToSend = previewPrimaItems.filter((p) => p.canSend).map((p) => p.primaId);
		if (idsToSend.length === 0) {
			toast.error('No hay conductores con email válido');
			return;
		}
		try {
			sendingPrimasEmails = true;
			const r = await enviarPrimas(idsToSend);
			sendPrimasResults = r.resultados ?? [];
			sendPrimasComplete = true;
			const ok = r.enviados ?? 0;
			const err = r.errores ?? 0;
			toast.success(`${ok} email(s) enviado(s)${err ? `, ${err} con error` : ''}`);
			selectedPrimas = new Set();
		} catch (err: any) {
			toast.error(err?.response?.data?.message || 'Error al enviar primas');
		} finally {
			sendingPrimasEmails = false;
		}
	}

	function cerrarPreviewPrimasModal() {
		showPreviewPrimasModal = false;
		previewPrimaItems = [];
		sendPrimasResults = [];
		sendPrimasComplete = false;
	}

	onMount(cargarPrimas);

	function volver() {
		goto('/dashboard/nomina/canvas');
	}

	/**
	 * Gancho del «Ir a…». Este canvas escribe, así que un formulario abierto o
	 * un envío en curso son trabajo que se perdería sin avisar.
	 */
	function antesDeSalir(): boolean {
		if (showPrimaFormModal || showPreviewPrimasModal) {
			return confirm('Hay una prima abierta sin guardar. ¿Salir del canvas igualmente?');
		}
		if (sendingPrimasEmails) {
			return confirm('Hay un envío de primas en curso. ¿Salir del canvas igualmente?');
		}
		return true;
	}
</script>

<svelte:head><title>Primas de Nómina · Cotransmeq</title></svelte:head>

<UniverToolbar
	title="PRIMAS"
	subtitle="{statsPrimas.total} prima(s)  ·  {statsPrimas.totalPendientes} pendiente(s)"
	onBack={volver}
	backLabel="Liquidaciones"
>
	{#snippet actions()}
		<SelectorCanvasNomina actual="primas" anio={anioSalto} mes={mesSalto} onSalir={antesDeSalir} />
	{/snippet}
</UniverToolbar>

<div class="primas-canvas">
	<!-- Estadísticas -->
	<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="stat-card">
			<div class="flex items-center justify-between">
				<div class="min-w-0">
					<p class="stat-label">Total Primas</p>
					<p class="stat-value">{statsPrimas.total}</p>
				</div>
				<div
					class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(16,185,129,0.10)]"
				>
					<Sparkles class="h-5 w-5 text-[var(--emerald-600)]" />
				</div>
			</div>
		</div>
		<div class="stat-card">
			<div class="flex items-center justify-between">
				<div class="min-w-0">
					<p class="stat-label">Pendientes</p>
					<p class="stat-value">{statsPrimas.totalPendientes}</p>
				</div>
				<div
					class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(234,179,8,0.12)]"
				>
					<Clock class="h-5 w-5 text-[#A16207]" />
				</div>
			</div>
		</div>
		<div class="stat-card">
			<div class="flex items-center justify-between">
				<div class="min-w-0">
					<p class="stat-label">Pagadas</p>
					<p class="stat-value">{statsPrimas.totalPagados}</p>
				</div>
				<div
					class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(34,197,94,0.12)]"
				>
					<CheckCircle class="h-5 w-5 text-[#16A34A]" />
				</div>
			</div>
		</div>
		<div class="stat-card">
			<div class="flex items-center justify-between">
				<div class="min-w-0">
					<p class="stat-label">Monto Total</p>
					<p class="stat-value">{formatCurrency(statsPrimas.montoTotal)}</p>
				</div>
				<div
					class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(245,158,11,0.12)]"
				>
					<TrendingUp class="h-5 w-5 text-[#D97706]" />
				</div>
			</div>
		</div>
	</div>

	<!-- Búsqueda y filtros -->
	<div class="page-card mb-4">
		<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div class="flex flex-1 flex-wrap items-center gap-3">
				<div class="min-w-0 flex-1">
					<BuscadorLista
						bind:valor={filtros.qPrimas}
						onBuscar={(termino) => {
							filtros.qPrimas = termino;
							filtros.paginaPrimas = 1;
						}}
						placeholder="Buscar por conductor o cédula..."
					/>
				</div>
				<select
					bind:value={filtros.mesPrima}
					class="input-glow rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
				>
					<option value="">Todos los meses</option>
					{#each Array.from({ length: 12 }, (_, i) => i + 1) as m}
						<option value={m}>{getPrimaMesLabel(m)}</option>
					{/each}
				</select>
				<input
					type="number"
					bind:value={filtros.anioPrima}
					placeholder="Año"
					min="2000"
					max="2100"
					class="input-glow w-24 rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm"
				/>
				{#if filtros.qPrimas || filtros.mesPrima || filtros.anioPrima}
					<button
						onclick={clearPrimaFilters}
						class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-base)]"
						>✕ Limpiar</button
					>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if selectedPrimas.size > 0}
					<span class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]"
						>{selectedPrimas.size} sel.</span
					>
					<button
						onclick={togglePrimaSelectAll}
						class="text-xs font-semibold text-[var(--emerald-600)] underline transition-colors hover:text-[var(--emerald-700)]"
					>
						{selectedPrimas.size === primas.length ? 'Deseleccionar' : 'Seleccionar todo'}
					</button>
					<div class="h-4 w-px bg-[var(--border-default)]"></div>
					<button
						onclick={() => handleBulkTogglePrimaVisible(true)}
						class="apple-transition flex items-center gap-1.5 rounded-lg border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[var(--emerald-700)] hover:bg-[rgba(16,185,129,0.14)]"
						title="Hacer visibles en el portal"
					>
						<Eye class="h-3.5 w-3.5" />Mostrar
					</button>
					<button
						onclick={() => handleBulkTogglePrimaVisible(false)}
						class="apple-transition flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
						title="Ocultar del portal"
					>
						<XCircle class="h-3.5 w-3.5" />Ocultar
					</button>
					<button
						onclick={abrirPreviewPrimas}
						class="apple-transition flex items-center gap-1.5 rounded-lg bg-[var(--bg-charcoal)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--bg-charcoal-deep)]"
					>
						<Send class="h-3.5 w-3.5" />Enviar ({selectedPrimas.size})
					</button>
				{:else}
					<button onclick={abrirCrearPrima} class="btn-primary apple-transition">
						<Plus class="h-4 w-4" /> Nueva Prima
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Tabla de primas -->
	<div class="table-card">
		{#if loadingPrimas}
			<div class="flex items-center justify-center py-16">
				<div class="text-center">
					<div class="spinner mx-auto mb-4"></div>
					<p class="text-[var(--text-muted)]">Cargando primas...</p>
				</div>
			</div>
		{:else if primas.length === 0}
			<div class="py-16 text-center">
				<div
					class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-base)]"
				>
					<Sparkles class="h-8 w-8 text-[var(--text-very-muted)]" />
				</div>
				<h3 class="mb-1 text-lg font-semibold text-[var(--text-primary)]">Sin primas</h3>
				<p class="mb-4 text-sm text-[var(--text-muted)]">
					{filtros.qPrimas || filtros.mesPrima || filtros.anioPrima
						? 'No hay resultados para los filtros aplicados.'
						: 'Aún no hay primas registradas.'}
				</p>
				{#if !filtros.qPrimas && !filtros.mesPrima && !filtros.anioPrima}
					<button onclick={abrirCrearPrima} class="btn-primary apple-transition">
						Crear primera prima
					</button>
				{/if}
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-xs">
					<thead class="table-header">
						<tr>
							<th class="w-10 text-left">
								<input
									type="checkbox"
									checked={primas.length > 0 && selectedPrimas.size === primas.length}
									onchange={togglePrimaSelectAll}
									class="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
								/>
							</th>
							<th class="text-left">Conductor</th>
							<th class="text-center">Periodo</th>
							<th class="text-center">Días</th>
							<th class="text-right">Prima</th>
							<th class="text-right">Prima Pendiente</th>
							<th class="text-center">Estado</th>
							<th class="text-center">Firmado</th>
							<th class="text-center">Acciones</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--border-subtle)]">
						{#each primas as p (p.id)}
							{@const firma = getPrimaFirmaInfo(p)}
							{@const IconoFirma = firma.icon}
							<tr
								class="table-row border-l-2 {selectedPrimas.has(p.id)
									? '!border-l-[var(--emerald-500)] !bg-[rgba(16,185,129,0.08)]'
									: 'border-l-transparent'}"
							>
								<td class="w-10 px-3 py-2.5">
									<input
										type="checkbox"
										checked={selectedPrimas.has(p.id)}
										onchange={() => togglePrimaSelection(p.id)}
										class="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-default)] accent-[var(--emerald-500)]"
									/>
								</td>
								<td class="px-3 py-2.5">
									<p class="text-xs font-semibold text-[var(--text-primary)]">
										{p.conductor?.nombre || 'N/A'}
										{p.conductor?.apellido || ''}
									</p>
									<p class="font-mono-meta text-[0.65rem] text-[var(--text-muted)]">
										CC: {(p.conductor as any)?.numero_identificacion || p.conductor?.cedula || '—'}
									</p>
								</td>
								<td class="px-3 py-2.5 text-center">
									<p class="font-mono-meta text-[0.7rem] text-[var(--emerald-700)]">
										{getPrimaMesLabel(p.mes)}
										{p.anio}
									</p>
								</td>
								<td class="px-3 py-2.5 text-center">
									<p class="text-sm font-semibold text-[var(--text-primary)]">
										{p.tiempo_trabajado_dias ?? 0}
									</p>
								</td>
								<td class="px-3 py-2.5 text-right">
									<p class="text-sm font-bold text-[var(--text-primary)]">
										{formatCurrency(p.prima)}
									</p>
								</td>
								<td class="px-3 py-2.5 text-right">
									{#if p.prima_pendiente && Number(p.prima_pendiente) > 0}
										<p class="text-sm font-semibold text-[var(--emerald-600)]">
											+{formatCurrency(p.prima_pendiente)}
										</p>
									{:else}
										<p class="text-[10px] text-[var(--text-very-muted)]">—</p>
									{/if}
								</td>
								<td class="px-3 py-2.5 text-center">
									<span class="status-pill {getPrimaEstadoColor(p.estado)}">
										{p.estado}
									</span>
								</td>
								<td class="px-3 py-2.5 text-center">
									<span
										class="status-pill {firma.classes}"
										title={p.firmado
											? 'Prima firmada por el conductor'
											: 'Pendiente de firma del conductor'}
									>
										<IconoFirma class="h-3 w-3" />
										{firma.label}
									</span>
								</td>
								<td class="px-3 py-2.5">
									<div class="flex items-center justify-center gap-1">
										<button
											onclick={() => handleTogglePrimaVisible(p.id)}
											class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(37,99,235,0.08)] hover:text-[#2563EB]"
											title="Hacer visible en portal del conductor"
										>
											<Eye class="h-3.5 w-3.5" />
										</button>
										<button
											onclick={() => handleDescargarPdfPrima(p)}
											disabled={downloadingPrimaPdf === p.id}
											class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(16,185,129,0.08)] hover:text-[var(--emerald-600)] disabled:opacity-50"
											title="Descargar PDF de Prima"
										>
											{#if downloadingPrimaPdf === p.id}
												<div
													class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--emerald-500)] border-t-transparent"
												></div>
											{:else}
												<Download class="h-3.5 w-3.5" />
											{/if}
										</button>
										<button
											onclick={() => abrirEditarPrima(p)}
											class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(37,99,235,0.08)] hover:text-[#2563EB]"
											title="Editar"
										>
											<Edit class="h-3.5 w-3.5" />
										</button>
										<button
											onclick={() => confirmarEliminarPrima(p.id)}
											class="apple-transition rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[rgba(220,38,38,0.08)] hover:text-[#DC2626]"
											title="Eliminar"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- La pestaña de primas tenía estado de paginación —el servidor
				     devuelve 20 por página— pero NINGÚN paginador en pantalla:
				     de la prima 21 en adelante no había forma de llegar. -->
			<PaginadorLista
				pagina={filtros.paginaPrimas}
				total={paginationPrimas.total}
				porPagina={paginationPrimas.limit}
				nombreItems="primas"
				cargando={loadingPrimas}
				onCambiar={(p) => (filtros.paginaPrimas = p)}
			/>
		{/if}
	</div>

	<!-- Modal Eliminar Prima -->
	{#if showDeletePrimaModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		>
			<div class="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
				<div class="mb-4 flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(220,38,38,0.10)]"
					>
						<AlertCircle class="h-5 w-5 text-[#DC2626]" />
					</div>
					<h3 class="text-lg font-semibold text-[var(--text-primary)]">Eliminar Prima</h3>
				</div>
				<p class="mb-6 text-sm text-[var(--text-muted)]">
					¿Está seguro que desea eliminar esta prima? Esta acción no se puede deshacer.
				</p>
				<div class="flex justify-end gap-2">
					<button
						onclick={() => {
							showDeletePrimaModal = false;
							primaToDelete = null;
						}}
						class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
						>Cancelar</button
					>
					<button
						onclick={eliminarPrima}
						class="apple-transition rounded-xl bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#B91C1C]"
						>Eliminar</button
					>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal Crear/Editar Prima -->
	<PrimaFormModal
		show={showPrimaFormModal}
		prima={primaToEdit}
		loading={savingPrima}
		onClose={() => {
			showPrimaFormModal = false;
			primaToEdit = null;
		}}
		onSubmit={handleGuardarPrima}
	/>
</div>

<!-- MODAL: PREVIEW / ENVÍO DE PRIMAS                         -->
<!-- ═══════════════════════════════════════════════════════ -->
{#if showPreviewPrimasModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
		onclick={cerrarPreviewPrimasModal}
		onkeydown={(e) => e.key === 'Escape' && cerrarPreviewPrimasModal()}
		role="button"
		tabindex="-1"
	>
		<div
			class="confirm-card relative mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden p-0"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
			role="dialog"
			tabindex="0"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-[var(--border-subtle)] bg-gradient-to-r from-[#F59E0B] to-[#D97706] px-6 py-4"
			>
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
						<Sparkles class="h-5 w-5 text-white" />
					</div>
					<div>
						<h2 class="text-lg font-semibold text-white">Enviar Primas</h2>
						<p class="text-sm text-white/80">Vista previa de liquidaciones de prima por email</p>
					</div>
				</div>
				<button
					onclick={cerrarPreviewPrimasModal}
					class="apple-transition rounded-full p-1.5 text-white/80 hover:bg-white/20 hover:text-white"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto bg-white p-6">
				{#if previewPrimasLoading}
					<div class="flex flex-col items-center justify-center py-12">
						<div
							class="spinner mb-4"
							style="border-top-color: #F59E0B; border-color: rgba(245,158,11,0.20);"
						></div>
						<p class="text-sm text-[var(--text-muted)]">Cargando datos de conductores...</p>
					</div>
				{:else if sendPrimasComplete}
					<div class="space-y-3">
						<div
							class="mb-4 flex items-center gap-3 rounded-xl border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] p-4"
						>
							<CheckCircle class="h-6 w-6 flex-shrink-0 text-[#D97706]" />
							<div>
								<p class="font-semibold text-[var(--text-primary)]">Envío de primas completado</p>
								<p class="text-sm text-[var(--text-secondary)]">
									{sendPrimasResults.filter((r) => r.status === 'enviado').length} enviado(s),
									{sendPrimasResults.filter((r) => r.status === 'error').length} error(es)
								</p>
							</div>
						</div>
						{#each sendPrimasResults as result}
							<div
								class="list-card flex items-center gap-3 p-3 {result.status === 'error'
									? '!border-[rgba(220,38,38,0.25)] !bg-[rgba(220,38,38,0.04)]'
									: ''}"
							>
								{#if result.status === 'enviado'}
									<CheckCircle class="h-5 w-5 flex-shrink-0 text-[#D97706]" />
								{:else}
									<XCircle class="h-5 w-5 flex-shrink-0 text-[#DC2626]" />
								{/if}
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-semibold text-[var(--text-primary)]">
										{result.conductor}
									</p>
									<p class="truncate text-xs text-[var(--text-muted)]">
										{result.email || 'Sin email'}
									</p>
								</div>
								{#if result.status === 'error'}
									<span class="status-pill !bg-[rgba(220,38,38,0.10)] !text-[#991B1B]"
										>{result.message}</span
									>
								{:else}
									<span class="status-pill !bg-[rgba(245,158,11,0.10)] !text-[#92400E]"
										>Enviado</span
									>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="mb-4 flex items-center gap-4">
						<div
							class="flex items-center gap-2 rounded-xl border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] px-3 py-2"
						>
							<CheckCircle class="h-4 w-4 text-[#D97706]" />
							<span class="text-sm font-semibold text-[#92400E]"
								>{previewPrimaItems.filter((p) => p.canSend).length} con email</span
							>
						</div>
						{#if previewPrimaItems.filter((p) => !p.canSend).length > 0}
							<div
								class="flex items-center gap-2 rounded-xl border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] px-3 py-2"
							>
								<AlertCircle class="h-4 w-4 text-[#D97706]" />
								<span class="text-sm font-semibold text-[#92400E]"
									>{previewPrimaItems.filter((p) => !p.canSend).length} sin email</span
								>
							</div>
						{/if}
					</div>

					<div class="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
						<table class="w-full text-sm">
							<thead class="table-header">
								<tr>
									<th class="text-left">Conductor</th>
									<th class="text-left">Email</th>
									<th class="text-center">Periodo</th>
									<th class="text-right">Monto</th>
									<th class="text-center">Estado</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-[var(--border-subtle)]">
								{#each previewPrimaItems as item}
									<tr class="table-row">
										<td class="px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
											{item.conductor}
										</td>
										<td class="px-4 py-3 text-sm text-[var(--text-secondary)]">
											{#if item.email}
												<span>{item.email}</span>
											{:else}
												<span class="text-xs text-[var(--text-very-muted)] italic">Sin email</span>
											{/if}
										</td>
										<td
											class="font-mono-meta px-4 py-3 text-center text-[0.7rem] text-[var(--emerald-700)]"
										>
											{getPrimaMesLabel(item.mes)}
											{item.anio}
										</td>
										<td class="px-4 py-3 text-right text-sm font-bold text-[var(--text-primary)]">
											{formatCurrency(item.prima + (item.prima_pendiente || 0))}
										</td>
										<td class="px-4 py-3 text-center">
											{#if item.canSend}
												<span class="status-pill !bg-[rgba(245,158,11,0.10)] !text-[#92400E]"
													>Listo</span
												>
											{:else}
												<span class="status-pill !bg-[rgba(0,0,0,0.04)] !text-[var(--text-muted)]"
													>Sin email</span
												>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div
				class="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-6 py-4"
			>
				{#if sendPrimasComplete}
					<div></div>
					<button onclick={cerrarPreviewPrimasModal} class="btn-secondary apple-transition">
						Cerrar
					</button>
				{:else}
					<p class="text-xs text-[var(--text-muted)]">
						Se enviará un email con link al Portal del Conductor
						<span class="text-[#D97706]">(highlight de prima)</span>
					</p>
					<div class="flex items-center gap-3">
						<button
							onclick={cerrarPreviewPrimasModal}
							disabled={sendingPrimasEmails}
							class="apple-transition rounded-xl border border-[var(--border-default)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-50"
						>
							Cancelar
						</button>
						<button
							onclick={confirmarEnvioPrimas}
							disabled={sendingPrimasEmails ||
								previewPrimaItems.filter((p) => p.canSend).length === 0}
							class="apple-transition flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
							style="background: linear-gradient(135deg, #F59E0B, #D97706);"
						>
							{#if sendingPrimasEmails}
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								></div>
								Enviando...
							{:else}
								<Send class="h-4 w-4" />
								Enviar {previewPrimaItems.filter((p) => p.canSend).length} Email(s)
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* El canvas se queda el alto restante del shell y hace su propio scroll:
	   sin esto las tablas largas empujarían el toolbar fuera del viewport. */
	.primas-canvas {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 1.25rem;
		background: var(--bg-base);
	}
</style>
