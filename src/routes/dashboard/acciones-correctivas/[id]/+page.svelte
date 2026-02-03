<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import {
		accionesCorrectivasAPI,
		type AccionCorrectivaPreventiva,
		type TipoAccion,
		type EstadoAccion,
		type ValoracionRiesgo
	} from '$lib/api/acciones-correctivas';

	let accion: AccionCorrectivaPreventiva | null = null;
	let isLoading = true;
	let id = '';

	onMount(async () => {
		id = $page.params.id;
		await cargarAccion();
	});

	async function cargarAccion() {
		isLoading = true;
		try {
			accion = await accionesCorrectivasAPI.obtener(id);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al cargar la acción';
			toast.error(message);
			setTimeout(() => {
				goto('/dashboard/acciones-correctivas');
			}, 2000);
		} finally {
			isLoading = false;
		}
	}

	async function descargarPDF() {
		if (!accion) return;
		try {
			toast.loading('Generando PDF...');
			await accionesCorrectivasAPI.descargarPDF(accion.id, accion.accion_numero);
			toast.success('PDF descargado correctamente');
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Error al descargar el PDF';
			toast.error(message);
		}
	}

	function formatearFecha(fecha: string | undefined): string {
		if (!fecha) return 'N/A';
		const [year, month, day] = fecha.split('T')[0].split('-');
		const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
		return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	function formatearValor(valor: any): string {
		if (valor === null || valor === undefined) return 'N/A';
		if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
		if (typeof valor === 'string') {
			const lower = valor.toLowerCase();
			if (lower === 'true' || lower === 'yes' || lower === 'sí' || lower === 'si') return 'Sí';
			if (lower === 'false' || lower === 'no') return 'No';
		}
		return String(valor);
	}

	function getBadgeColorTipo(tipo: TipoAccion | undefined): string {
		switch (tipo) {
			case 'CORRECTIVA':
				return 'bg-red-100 text-red-700 border border-red-200';
			case 'PREVENTIVA':
				return 'bg-blue-100 text-blue-700 border border-blue-200';
			case 'MEJORA':
				return 'bg-orange-100 text-orange-700 border border-orange-200';
			default:
				return 'bg-gray-100 text-gray-700 border border-gray-200';
		}
	}

	function getBadgeColorEstado(estado: EstadoAccion | undefined): string {
		switch (estado) {
			case 'Cumplidas':
				return 'bg-orange-100 text-orange-700 border border-orange-200';
			case 'En Proceso':
				return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
			case 'Vencidas':
				return 'bg-red-100 text-red-700 border border-red-200';
			default:
				return 'bg-gray-100 text-gray-700 border border-gray-200';
		}
	}

	function getBadgeColorRiesgo(riesgo: ValoracionRiesgo | undefined): string {
		switch (riesgo) {
			case 'ALTO':
				return 'bg-red-100 text-red-700 border border-red-200';
			case 'MEDIO':
				return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
			case 'BAJO':
				return 'bg-orange-100 text-orange-700 border border-orange-200';
			default:
				return 'bg-gray-100 text-gray-700 border border-gray-200';
		}
	}
</script>

<div class="p-6">
	{#if isLoading}
		<div class="glass flex items-center justify-center rounded-xl border border-gray-200 p-12">
			<div class="h-12 w-12 animate-spin rounded-full border-b-2 border-orange-500"></div>
		</div>
	{:else if accion}
		<!-- Header -->
		<div class="mb-6 flex items-center justify-between" in:fade={{ duration: 400 }}>
			<div>
				<div class="mb-2 flex items-center gap-3">
					<a
						href="/dashboard/acciones-correctivas"
						class="apple-transition text-gray-600 hover:text-orange-600"
					>
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10 19l-7-7m0 0l7-7m-7 7h18"
							/>
						</svg>
					</a>
					<h1 class="text-2xl font-bold text-gray-900">
						Acción {accion.accion_numero}
					</h1>
				</div>
				<p class="text-gray-600">Detalle completo de la acción correctiva/preventiva</p>
			</div>
			<button
				on:click={descargarPDF}
				class="apple-transition flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3 text-white shadow-lg shadow-orange-500/30 hover:from-orange-600 hover:to-orange-700"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					/>
				</svg>
				Descargar PDF
			</button>
		</div>

		<!-- Badges principales -->
		<div class="mb-6 flex flex-wrap gap-3" in:fly={{ y: 20, delay: 100 }}>
			<span
				class="rounded-full border px-4 py-2 text-sm font-semibold {getBadgeColorTipo(
					accion.tipo_accion_ejecutar
				)}"
			>
				{accion.tipo_accion_ejecutar || 'N/A'}
			</span>
			<span
				class="rounded-full border px-4 py-2 text-sm font-semibold {getBadgeColorEstado(
					accion.estado_accion_planeada
				)}"
			>
				{accion.estado_accion_planeada || 'N/A'}
			</span>
			<span
				class="rounded-full border px-4 py-2 text-sm font-semibold {getBadgeColorRiesgo(
					accion.valoracion_riesgo
				)}"
			>
				Riesgo: {accion.valoracion_riesgo || 'N/A'}
			</span>
		</div>

		<!-- Sección 1: Identificación del Hallazgo -->
		<div class="glass mb-6 rounded-xl border border-gray-200 p-6" in:fly={{ y: 20, delay: 200 }}>
			<h2 class="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900">
				<span
					class="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700"
				>
					1
				</span>
				Identificación del Hallazgo
			</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600">Lugar / Sede</label>
					<p class="text-gray-900">{formatearValor(accion.lugar_sede)}</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600">Fecha de Identificación</label
					>
					<p class="text-gray-900">{formatearFecha(accion.fecha_identificacion_hallazgo)}</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600">Tipo de Hallazgo</label>
					<p class="text-gray-900">{formatearValor(accion.tipo_hallazgo_detectado)}</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Variable / Categoría para Análisis</label
					>
					<p class="text-gray-900">{formatearValor(accion.variable_categoria_analisis)}</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Proceso donde se origina el hallazgo</label
					>
					<p class="text-gray-900">{formatearValor(accion.proceso_origen_hallazgo)}</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Componente / Elemento / De entrada de referencia</label
					>
					<p class="text-gray-900">{formatearValor(accion.componente_elemento_referencia)}</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Fuente que generó o identificó el hallazgo</label
					>
					<p class="text-gray-900">{formatearValor(accion.fuente_genero_hallazgo)}</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Marco Legal / Normativo / Contractual</label
					>
					<p class="text-gray-900">{formatearValor(accion.marco_legal_normativo)}</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Descripción del hallazgo</label
					>
					<p class="whitespace-pre-wrap text-gray-900">
						{formatearValor(accion.descripcion_hallazgo)}
					</p>
				</div>
			</div>
		</div>

		<!-- Sección 2: Corrección Inmediata -->
		<div class="glass mb-6 rounded-xl border border-gray-200 p-6" in:fly={{ y: 20, delay: 300 }}>
			<h2 class="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900">
				<span
					class="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700"
				>
					2
				</span>
				Corrección Inmediata
			</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Corrección o solución inmediata</label
					>
					<p class="whitespace-pre-wrap text-gray-900">
						{formatearValor(accion.correccion_solucion_inmediata)}
					</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600">Fecha de Implementación</label
					>
					<p class="text-gray-900">{formatearFecha(accion.fecha_implementacion)}</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600">Valoración del Riesgo</label>
					<p class="text-gray-900">{formatearValor(accion.valoracion_riesgo)}</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>¿Requiere actualizar matriz?</label
					>
					<p class="text-gray-900">{formatearValor(accion.requiere_actualizar_matriz)}</p>
				</div>
			</div>
		</div>

		<!-- Sección 3: Análisis y Plan de Acción -->
		<div class="glass mb-6 rounded-xl border border-gray-200 p-6" in:fly={{ y: 20, delay: 400 }}>
			<h2 class="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900">
				<span
					class="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700"
				>
					3
				</span>
				Análisis y Plan de Acción
			</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Tipo de acción a ejecutar</label
					>
					<p class="text-gray-900">{formatearValor(accion.tipo_accion_ejecutar)}</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Fecha límite de implementación</label
					>
					<p class="text-gray-900">{formatearFecha(accion.fecha_limite_implementacion)}</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Análisis de causas (5 Por qué)</label
					>
					{#if accion.analisis_causas && Array.isArray(accion.analisis_causas) && accion.analisis_causas.length > 0}
						<ol class="list-inside space-y-2 text-gray-900">
							{#each accion.analisis_causas as why, index}
								{#if why && why.trim()}
									<li class="flex items-start gap-2">
										<span class="font-semibold text-orange-600">{index + 1}.</span>
										<span>{why}</span>
									</li>
								{/if}
							{/each}
						</ol>
					{:else}
						<p class="text-gray-900">N/A</p>
					{/if}
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Descripción de la acción / Plan de acción</label
					>
					<p class="whitespace-pre-wrap text-gray-900">
						{formatearValor(accion.descripcion_accion_plan)}
					</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Responsable de la ejecución</label
					>
					<p class="text-gray-900">{formatearValor(accion.responsable_ejecucion)}</p>
				</div>
			</div>
		</div>

		<!-- Sección 4: Seguimiento -->
		<div class="glass mb-6 rounded-xl border border-gray-200 p-6" in:fly={{ y: 20, delay: 500 }}>
			<h2 class="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900">
				<span
					class="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700"
				>
					4
				</span>
				Seguimiento
			</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600">Fecha del seguimiento</label>
					<p class="text-gray-900">{formatearFecha(accion.fecha_seguimiento)}</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Estado de la acción planeada</label
					>
					<p class="text-gray-900">{formatearValor(accion.estado_accion_planeada)}</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Descripción del estado / Observaciones</label
					>
					<p class="whitespace-pre-wrap text-gray-900">
						{formatearValor(accion.descripcion_estado_observaciones)}
					</p>
				</div>
			</div>
		</div>

		<!-- Sección 5: Evaluación de Eficacia -->
		<div class="glass mb-6 rounded-xl border border-gray-200 p-6" in:fly={{ y: 20, delay: 600 }}>
			<h2 class="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900">
				<span
					class="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700"
				>
					5
				</span>
				Evaluación de Eficacia
			</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Fecha de la evaluación de la eficacia</label
					>
					<p class="text-gray-900">{formatearFecha(accion.fecha_evaluacion_eficacia)}</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Evaluación del cierre eficaz</label
					>
					<p class="text-gray-900">{formatearValor(accion.evaluacion_cierre_eficaz)}</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Criterio de evaluación de la eficacia</label
					>
					<p class="whitespace-pre-wrap text-gray-900">
						{formatearValor(accion.criterio_evaluacion_eficacia)}
					</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Análisis o evidencias que soporten el cierre</label
					>
					<p class="whitespace-pre-wrap text-gray-900">
						{formatearValor(accion.analisis_evidencias_cierre)}
					</p>
				</div>
				<div class="md:col-span-2">
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Soporte del cierre eficaz</label
					>
					<p class="whitespace-pre-wrap text-gray-900">
						{formatearValor(accion.soporte_cierre_eficaz)}
					</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600"
						>Fecha de cierre definitivo</label
					>
					<p class="text-gray-900">{formatearFecha(accion.fecha_cierre_definitivo)}</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium text-gray-600">Responsable del cierre</label>
					<p class="text-gray-900">{formatearValor(accion.responsable_cierre)}</p>
				</div>
			</div>
		</div>

		<!-- Footer con acciones -->
		<div
			class="glass flex items-center justify-between rounded-xl border border-gray-200 p-6"
			in:fly={{ y: 20, delay: 700 }}
		>
			<a
				href="/dashboard/acciones-correctivas"
				class="apple-transition flex items-center gap-2 text-gray-600 hover:text-orange-600"
			>
				<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M10 19l-7-7m0 0l7-7m-7 7h18"
					/>
				</svg>
				Volver al listado
			</a>
			<div class="text-sm text-gray-500">
				ID: <span class="font-mono text-gray-700">{accion.id}</span>
			</div>
		</div>
	{/if}
</div>
