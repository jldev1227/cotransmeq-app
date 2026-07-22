<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { certificadosAdminAPI } from '$lib/api/certificadosAdmin';
	import { certificadosTerceroAPI } from '$lib/api/certificadosTercero';

	let { embedded = false }: { embedded?: boolean } = $props();

	interface TerceroWithCerts {
		id: string;
		nombre_completo: string;
		identificacion: string | null;
		correo: string | null;
		telefono: string | null;
		tipo_persona: string;
		activo: boolean;
		certificados_archivo: Array<{
			id: string;
			nit: string;
			anio: number;
			tipo: string;
			filename: string;
			s3_key: string;
			url: string | null;
			tipo_certificado: { nombre: string; codigo: string } | null;
		}>;
		_count: { certificados_archivo: number };
	}

	let terceros: TerceroWithCerts[] = $state([]);
	let isLoading = $state(true);
	let searchInput = $state('');
	let currentPage = $state(1);
	const pageSize = 10;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	let selectedTercero: TerceroWithCerts | null = $state(null);
	let isLoadingCerts = $state(false);

	let showZipModal = $state(false);
	let showSyncModal = $state(false);
	let isSyncing = $state(false);
	let syncResult = $state<{ created: number; skipped: number; linked: number; errors: number } | null>(null);

	let showEmailModal = $state(false);
	let emailMode: 'single' | 'bulk' = 'single';
	let emailTo = $state('');
	let emailSubject = $state('Tus Certificados Tributarios — Cotransmeq');
	let emailMessage = $state('');
	let selectedCertIds: string[] = $state([]);
	let isSending = $state(false);

	let showAuditLog = $state(false);
	let auditEnvios: any[] = $state([]);
	let isLoadingAudit = $state(false);

	let isImporting = $state(false);
	let importAnio = $state(new Date().getFullYear());
	let dragOverZip = $state(false);
	let inputZip = $state<HTMLInputElement | null>(null);

	const ANIOS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

	async function cargarTerceros() {
		try {
			isLoading = true;
			const res = await certificadosTerceroAPI.getTercerosWithCertificados({
				search: searchInput || undefined,
				page: currentPage,
				limit: pageSize
			});
			terceros = res.data.terceros ?? [];
		} catch (err: any) {
			toast.error('Error al cargar', { description: err?.response?.data?.error ?? err?.message });
		} finally {
			isLoading = false;
		}
	}

	function onSearchInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			currentPage = 1;
			cargarTerceros();
		}, 300);
	}

	async function verCertificados(tercero: TerceroWithCerts) {
		selectedTercero = tercero;
		try {
			isLoadingCerts = true;
			const res = await certificadosTerceroAPI.getCertificadosByTercero(tercero.id);
			selectedTercero = { ...tercero, certificados_archivo: res.data.certificados ?? [] };
		} catch (err: any) {
			toast.error('Error al cargar certificados', { description: err?.response?.data?.error ?? err?.message });
		} finally {
			isLoadingCerts = false;
		}
	}

	function cerrarDetalle() {
		selectedTercero = null;
	}

	async function syncS3() {
		try {
			isSyncing = true;
			const res = await certificadosAdminAPI.syncS3();
			syncResult = res.data;
			toast.success('Sincronización completa', {
				description: `${res.data.created} creados, ${res.data.linked} vinculados`
			});
			await cargarTerceros();
		} catch (err: any) {
			toast.error('Error al sincronizar', { description: err?.response?.data?.error ?? err?.message });
		} finally {
			isSyncing = false;
		}
	}

	function onDropZip(e: DragEvent) {
		e.preventDefault();
		dragOverZip = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) importarZip(file);
	}

	async function importarZip(file: File) {
		if (!file.name.toLowerCase().endsWith('.zip')) {
			toast.error('Solo se permiten archivos .zip');
			return;
		}
		if (!importAnio) {
			toast.error('Selecciona un año');
			return;
		}
		try {
			isImporting = true;
			const res = await certificadosAdminAPI.importZip(file, importAnio);
			const r = res.data.resumen;
			toast.success(`Importación: ${r.exitosos}/${r.total} subidos`, {
				description: `Año ${r.anio} · ${r.omitidos} omitidos`
			});
			if (inputZip) inputZip.value = '';
			await syncS3();
		} catch (err: any) {
			toast.error('Error al importar ZIP', { description: err?.response?.data?.error ?? err?.message });
		} finally {
			isImporting = false;
		}
	}

	function formatTipo(codigo: string): string {
		const map: Record<string, string> = {
			RETEFUENTE: 'Retefuente',
			RETEICA: 'Reteica',
			RETEIVA: 'Reteiva',
			ICA: 'ICA',
			IVA: 'IVA',
			RETENCIONES: 'Retenciones',
			OTROS: 'Otros'
		};
		return map[codigo] || codigo;
	}

	function formatTipoPersona(tipo: string): string {
		const map: Record<string, string> = {
			PERSONA: 'Persona',
			EMPRESA: 'Empresa',
			PROPIETARIO_VEHICULO: 'Propietario',
			PROVEEDOR: 'Proveedor'
		};
		return map[tipo] || tipo;
	}

	function badgeColor(tipo: string): string {
		const colors: Record<string, string> = {
			PERSONA: 'bg-blue-50 text-blue-700 border-blue-200',
			EMPRESA: 'bg-purple-50 text-purple-700 border-purple-200',
			PROPIETARIO_VEHICULO: 'bg-amber-50 text-amber-700 border-amber-200',
			PROVEEDOR: 'bg-orange-50 text-orange-700 border-orange-200'
		};
		return colors[tipo] || 'bg-gray-50 text-gray-700 border-gray-200';
	}

	function openEmailModal(tercero?: TerceroWithCerts) {
		if (tercero) {
			emailMode = 'single';
			emailTo = tercero.correo || '';
			selectedTercero = tercero;
			selectedCertIds = tercero.certificados_archivo?.map(c => c.id) ?? [];
			emailMessage = '';
		} else {
			emailMode = 'bulk';
			emailTo = '';
			selectedCertIds = [];
			emailMessage = '';
		}
		showEmailModal = true;
	}

	async function enviarEmail() {
		if (!selectedTercero && emailMode === 'single') {
			toast.error('Selecciona un tercero');
			return;
		}
		if (emailMode === 'single' && !emailTo) {
			toast.error('Ingresa un correo destino');
			return;
		}
		if (selectedCertIds.length === 0) {
			toast.error('Selecciona al menos un certificado');
			return;
		}
		try {
			isSending = true;
			if (emailMode === 'single') {
				await certificadosTerceroAPI.enviarEmail({
					tercero_id: selectedTercero!.id,
					certificado_ids: selectedCertIds,
					email_destino: emailTo,
					mensaje_personalizado: emailMessage || undefined
				});
				toast.success('Correo enviado', { description: `Enviado a ${emailTo}` });
			} else {
				const ids = terceros.filter(t => t.correo).map(t => t.id);
				if (ids.length === 0) {
					toast.error('Ningún tercero tiene correo registrado');
					return;
				}
				const res = await certificadosTerceroAPI.enviarMasivo({
					tercero_ids: ids,
					mensaje_personalizado: emailMessage || undefined
				});
				const r = res.data.resultados ?? [];
				const exitosos = r.filter((x: any) => x.status === 'sent').length;
				const saltados = r.filter((x: any) => x.status === 'skipped').length;
				const errores = r.filter((x: any) => x.status === 'error').length;
				toast.success('Envío masivo completado', {
					description: `${exitosos} enviados · ${saltados} saltados · ${errores} errores`
				});
			}
			showEmailModal = false;
		} catch (err: any) {
			toast.error('Error al enviar', { description: err?.response?.data?.error ?? err?.message });
		} finally {
			isSending = false;
		}
	}

	async function cargarAuditLog() {
		try {
			isLoadingAudit = true;
			const res = await certificadosTerceroAPI.getEnvios({ page: 1, limit: 50 });
			auditEnvios = res.data.envios ?? [];
		} catch (err: any) {
			toast.error('Error al cargar audit log', { description: err?.message });
		} finally {
			isLoadingAudit = false;
		}
	}

	function formatFecha(dateStr: string): string {
		if (!dateStr) return 'N/A';
		return new Date(dateStr).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	onMount(cargarTerceros);
</script>

<div class="flex {embedded ? 'h-full' : 'h-full min-h-0'} flex-col gap-4 {embedded ? 'p-0' : 'p-6'}" in:fade={{ duration: 400 }}>
	{#if !embedded}
		<div class="glass soft-shadow flex flex-col gap-4 rounded-2xl border border-gray-200/50 p-5 lg:flex-row lg:items-center lg:justify-between">
			<div class="flex items-center gap-4">
				<div class="soft-shadow flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600">
					<svg class="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
					</svg>
				</div>
				<div>
					<div class="flex items-center gap-2">
						<h1 class="truncate text-xl font-bold text-gray-900">Certificados Tributarios</h1>
						<span class="inline-flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-500"></span>
							DB + S3
						</span>
					</div>
					<p class="mt-0.5 text-xs text-gray-500">Gestión de certificados con registro en base de datos y almacenamiento S3</p>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<div class="relative">
					<svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input type="text" placeholder="Buscar tercero, NIT o correo..." value={searchInput} oninput={(e) => { searchInput = (e.target as HTMLInputElement).value; onSearchInput(); }} class="input-glow apple-transition w-72 rounded-xl border border-gray-200 bg-white/80 py-2 pr-4 pl-9 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-400" />
				</div>
				<button onclick={() => openEmailModal()} class="apple-transition flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
					</svg>
					Enviar correos
				</button>
				<button onclick={() => { showAuditLog = true; cargarAuditLog(); }} class="apple-transition flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
					</svg>
					Audit Log
				</button>
				<button onclick={syncS3} disabled={isSyncing} class="apple-transition flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
					<svg class="h-4 w-4 {isSyncing ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
					{isSyncing ? 'Sincronizando...' : 'Sincronizar S3'}
				</button>
				<button onclick={() => showZipModal = true} class="apple-transition flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
					</svg>
					Importar ZIP
				</button>
			</div>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Módulo</p>
				<p class="text-sm font-bold text-gray-900">Certificados Tributarios</p>
			</div>
			<div class="flex items-center gap-2">
				<div class="relative">
					<svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input type="text" placeholder="Buscar tercero..." value={searchInput} oninput={(e) => { searchInput = (e.target as HTMLInputElement).value; onSearchInput(); }} class="input-glow apple-transition w-56 rounded-xl border border-gray-200 bg-white/80 py-2 pr-4 pl-9 text-sm text-gray-900 placeholder-gray-400 focus:border-orange-400" />
				</div>
				<button onclick={() => openEmailModal()} class="apple-transition flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
					</svg>
					Email
				</button>
				<button onclick={syncS3} disabled={isSyncing} class="apple-transition flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
					<svg class="h-4 w-4 {isSyncing ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
					Sync
				</button>
				<button onclick={() => showZipModal = true} class="apple-transition flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
					</svg>
					ZIP
				</button>
			</div>
		</div>
	{/if}

	<div class="flex flex-1 flex-col gap-4 overflow-hidden">
		{#if selectedTercero}
			<div class="glass soft-shadow flex flex-col overflow-hidden rounded-2xl border border-gray-200/50">
				<div class="flex items-center justify-between border-b border-gray-100 px-5 py-3">
					<div class="flex items-center gap-3">
						<button onclick={cerrarDetalle} class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
							</svg>
						</button>
						<div>
							<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Certificados de</p>
							<p class="text-base font-bold text-gray-900">{selectedTercero.nombre_completo}</p>
							<p class="text-xs text-gray-500">NIT: {selectedTercero.identificacion || 'N/A'} · {selectedTercero.correo || 'Sin correo'}</p>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if selectedTercero.correo}
							<button onclick={() => openEmailModal(selectedTercero)} class="rounded-md p-1.5 text-blue-600 hover:bg-blue-50" title="Enviar por correo">
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
								</svg>
							</button>
						{/if}
						<span class="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
							{selectedTercero.certificados_archivo?.length || 0} archivo{(selectedTercero.certificados_archivo?.length || 0) !== 1 ? 's' : ''}
						</span>
					</div>
				</div>

				<div class="flex-1 overflow-auto p-4">
					{#if isLoadingCerts}
						<div class="flex items-center justify-center py-12">
							<div class="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
						</div>
					{:else if !selectedTercero.certificados_archivo || selectedTercero.certificados_archivo.length === 0}
						<div class="flex flex-col items-center justify-center py-12 text-center">
							<p class="text-sm font-semibold text-gray-900">Sin certificados</p>
							<p class="text-xs text-gray-500">Este tercero no tiene certificados cargados</p>
						</div>
					{:else}
						<div class="space-y-2">
							{#each selectedTercero.certificados_archivo as cert (cert.id)}
								<div class="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
									<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600">
										<span class="text-xs font-bold text-white">{cert.anio}</span>
									</div>
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs font-semibold text-gray-900">{cert.filename}</p>
										<p class="text-[10px] text-gray-500">
											{formatTipo(cert.tipo_certificado?.codigo || cert.tipo)} · NIT {cert.nit}
										</p>
									</div>
									{#if cert.url}
										<a href={cert.url} target="_blank" rel="noopener noreferrer" class="rounded-md p-1.5 text-orange-600 hover:bg-orange-50" title="Descargar">
											<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
											</svg>
										</a>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<div class="glass soft-shadow flex flex-col overflow-hidden rounded-2xl border border-gray-200/50">
				<div class="flex items-center justify-between border-b border-gray-100 px-4 py-3">
					<div>
						<p class="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Terceros con certificados</p>
						<p class="text-base font-bold text-gray-900">{terceros.length} registrados</p>
					</div>
					<button onclick={cargarTerceros} class="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700" title="Refrescar">
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
					</button>
				</div>

				<div class="flex-1 overflow-auto">
					{#if isLoading}
						<div class="flex items-center justify-center py-12">
							<div class="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
						</div>
					{:else if terceros.length === 0}
						<div class="flex flex-col items-center justify-center py-12 text-center">
							<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100">
								<svg class="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
								</svg>
							</div>
							<p class="text-sm font-semibold text-gray-900">Sin terceros con certificados</p>
							<p class="text-xs text-gray-500">Sincroniza S3 para importar registros existentes</p>
						</div>
					{:else}
						<div>
							<table class="w-full text-left text-sm">
								<thead class="border-b border-gray-200 bg-gray-50/50">
									<tr>
										<th class="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tercero</th>
										<th class="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">NIT</th>
										<th class="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tipo</th>
										<th class="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Archivos</th>
										<th class="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Último envío</th>
										<th class="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 text-right">Acciones</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-100">
									{#each terceros as t (t.id)}
										<tr class="apple-transition hover:bg-orange-50/30">
											<td class="px-4 py-2.5">
												<p class="text-xs font-semibold text-gray-900">{t.nombre_completo}</p>
												<p class="text-[10px] text-gray-500">{t.correo || 'Sin correo'}</p>
											</td>
											<td class="px-4 py-2.5">
												<span class="font-mono text-xs text-gray-700">{t.identificacion || 'N/A'}</span>
											</td>
											<td class="px-4 py-2.5">
												<span class="rounded-md border px-1.5 py-0.5 text-[10px] font-medium {badgeColor(t.tipo_persona)}">
													{formatTipoPersona(t.tipo_persona)}
												</span>
											</td>
											<td class="px-4 py-2.5">
												<span class="text-xs font-semibold text-gray-900">{t._count.certificados_archivo}</span>
											</td>
											<td class="px-4 py-2.5">
												{#if t._count.certificados_archivo > 0}
													<span class="text-[10px] text-gray-400">—</span>
												{:else}
													<span class="text-[10px] text-gray-400">Sin certs</span>
												{/if}
											</td>
											<td class="px-4 py-2.5 text-right">
												<div class="flex items-center justify-end gap-1">
													<button onclick={() => openEmailModal(t)} class="rounded-md p-1.5 text-blue-600 hover:bg-blue-50" title="Enviar certificados por correo">
														<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
															<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
														</svg>
													</button>
													<button onclick={() => verCertificados(t)} class="rounded-md p-1.5 text-orange-600 hover:bg-orange-50" title="Ver certificados">
														<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
															<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
															<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
														</svg>
													</button>
												</div>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	{#if showZipModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onclick={() => showZipModal = false}>
			<div class="glass soft-shadow w-full max-w-lg rounded-2xl border border-gray-200/50 p-6" in:fade={{ duration: 200 }} onclick={(e) => e.stopPropagation()}>
				<div class="flex items-center justify-between mb-4">
					<h3 class="text-lg font-bold text-gray-900">Importar ZIP por año</h3>
					<button onclick={() => showZipModal = false} class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div class="mb-4">
					<label class="block">
						<span class="mb-1.5 block text-xs font-medium text-gray-700">Año del ZIP *</span>
						<select bind:value={importAnio} class="apple-transition w-full max-w-xs rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-orange-400 focus:outline-none">
							{#each ANIOS as a (a)}<option value={a}>{a}</option>{/each}
						</select>
					</label>
					<p class="mt-2 text-xs text-gray-500">Sube un ZIP con estructura <code class="rounded bg-gray-100 px-1">AÑO {importAnio}/TIPO/</code>. El NIT se extrae del nombre.</p>
				</div>

				<div role="button" tabindex="0" ondragover={(e) => { e.preventDefault(); dragOverZip = true; }} ondragleave={() => (dragOverZip = false)} ondrop={onDropZip} onclick={() => inputZip?.click()} onkeydown={(e) => e.key === 'Enter' && inputZip?.click()} class="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors {dragOverZip ? 'border-orange-500 bg-orange-50/50' : 'border-gray-200 bg-white hover:border-orange-300'}">
					<svg class="mb-3 h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
					</svg>
					<p class="text-sm font-semibold text-gray-900">{isImporting ? 'Importando...' : 'Arrastra el ZIP o haz click'}</p>
					<input bind:this={inputZip} type="file" accept=".zip" onchange={(e) => { const t = e.target as HTMLInputElement; if (t.files?.[0]) importarZip(t.files[0]); }} class="hidden" />
				</div>
			</div>
		</div>
	{/if}

	{#if showEmailModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onclick={() => showEmailModal = false}>
			<div class="glass soft-shadow w-full max-w-2xl rounded-2xl border border-gray-200/50 p-0" in:fade={{ duration: 200 }} onclick={(e) => e.stopPropagation()}>
				<div class="flex items-center justify-between border-b border-gray-100 px-6 py-4">
					<div class="flex items-center gap-3">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600">
							<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
						</div>
						<h3 class="text-lg font-bold text-gray-900">
							{emailMode === 'single' ? 'Enviar certificados' : 'Envío masivo'}
						</h3>
					</div>
					<button onclick={() => showEmailModal = false} class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<div class="p-6">
					{#if emailMode === 'single' && selectedTercero}
						<div class="mb-4 flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
							<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-xs font-bold text-white">
								{selectedTercero.nombre_completo.charAt(0).toUpperCase()}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold text-gray-900">{selectedTercero.nombre_completo}</p>
								<p class="text-xs text-gray-500">NIT: {selectedTercero.identificacion || 'N/A'}</p>
							</div>
						</div>
					{/if}

					<div class="mb-4">
						<label class="block">
							<span class="mb-1.5 block text-xs font-medium text-gray-700">
								{emailMode === 'single' ? 'Correo destino' : 'Destinatarios'}
							</span>
							{#if emailMode === 'single'}
								<input type="email" bind:value={emailTo} placeholder="correo@ejemplo.com" class="apple-transition w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-orange-400 focus:outline-none" />
							{:else}
								<div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
									{terceros.filter(t => t.correo).length} terceros con correo registrado
								</div>
							{/if}
						</label>
					</div>

					<div class="mb-4">
						<label class="block">
							<span class="mb-1.5 block text-xs font-medium text-gray-700">Asunto</span>
							<input type="text" bind:value={emailSubject} class="apple-transition w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-orange-400 focus:outline-none" />
						</label>
					</div>

					<div class="mb-4">
						<label class="block">
							<span class="mb-1.5 block text-xs font-medium text-gray-700">Mensaje personalizado <span class="text-gray-400">(opcional)</span></span>
							<textarea bind:value={emailMessage} rows="3" placeholder="Escribe un mensaje adicional para el tercero..." class="apple-transition w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-orange-400 focus:outline-none resize-none"></textarea>
						</label>
					</div>

					{#if emailMode === 'single' && selectedTercero}
						<div class="mb-4">
							<span class="mb-2 block text-xs font-medium text-gray-700">Certificados a enviar ({selectedCertIds.length})</span>
							<div class="max-h-40 space-y-1.5 overflow-auto rounded-xl border border-gray-200 bg-white p-3">
								{#each selectedTercero.certificados_archivo as cert (cert.id)}
									<label class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
										<input type="checkbox" checked={selectedCertIds.includes(cert.id)} onchange={(e) => {
											const checked = (e.target as HTMLInputElement).checked;
											if (checked) {
												if (!selectedCertIds.includes(cert.id)) selectedCertIds = [...selectedCertIds, cert.id];
											} else {
												selectedCertIds = selectedCertIds.filter(id => id !== cert.id);
											}
										}} class="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
										<span class="flex-1 truncate text-xs text-gray-700">{formatTipo(cert.tipo_certificado?.codigo || cert.tipo)} · {cert.anio}</span>
									</label>
								{/each}
							</div>
						</div>
					{/if}

					<div class="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
						<button onclick={() => showEmailModal = false} class="apple-transition rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
							Cancelar
						</button>
						<button onclick={enviarEmail} disabled={isSending || selectedCertIds.length === 0} class="apple-transition rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 hover:shadow-md">
							{#if isSending}
								<span class="inline-flex items-center gap-2">
									<span class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
									Enviando...
								</span>
							{:else}
								<span class="inline-flex items-center gap-2">
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
									</svg>
									{emailMode === 'single' ? 'Enviar' : 'Enviar a todos'}
								</span>
							{/if}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if showAuditLog}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onclick={() => showAuditLog = false}>
			<div class="glass soft-shadow w-full max-w-3xl rounded-2xl border border-gray-200/50 p-0" in:fade={{ duration: 200 }} onclick={(e) => e.stopPropagation()}>
				<div class="flex items-center justify-between border-b border-gray-100 px-6 py-4">
					<div class="flex items-center gap-3">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600">
							<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
							</svg>
						</div>
						<h3 class="text-lg font-bold text-gray-900">Audit Log de Envíos</h3>
					</div>
					<div class="flex items-center gap-2">
						<button onclick={cargarAuditLog} class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Refrescar">
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
						</button>
						<button onclick={() => showAuditLog = false} class="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				</div>

				<div class="max-h-96 overflow-auto p-4">
					{#if isLoadingAudit}
						<div class="flex items-center justify-center py-8">
							<div class="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent"></div>
						</div>
					{:else if auditEnvios.length === 0}
						<div class="flex flex-col items-center justify-center py-8 text-center">
							<p class="text-sm font-semibold text-gray-900">Sin envíos registrados</p>
							<p class="text-xs text-gray-500">Aún no se han enviado certificados por correo</p>
						</div>
					{:else}
						<table class="w-full text-left text-sm">
							<thead class="border-b border-gray-200 bg-gray-50/50">
								<tr>
									<th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tercero</th>
									<th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Certificado</th>
									<th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Destino</th>
									<th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tipo</th>
									<th class="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Fecha</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-100">
								{#each auditEnvios as envio (envio.id)}
									<tr class="hover:bg-gray-50/50">
										<td class="px-3 py-2.5">
											<p class="text-xs font-semibold text-gray-900">{envio.tercero?.nombre_completo || 'N/A'}</p>
											<p class="text-[10px] text-gray-500">{envio.tercero?.identificacion || ''}</p>
										</td>
										<td class="px-3 py-2.5">
											<p class="truncate text-xs text-gray-700" title={envio.certificado?.filename}>{envio.certificado?.filename || 'Todos'}</p>
										</td>
										<td class="px-3 py-2.5">
											<span class="text-xs text-gray-600">{envio.email_destino}</span>
										</td>
										<td class="px-3 py-2.5">
											<span class="rounded border px-1.5 py-0.5 text-[9px] font-medium {envio.tipo_envio === 'masivo' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}">
												{envio.tipo_envio}
											</span>
										</td>
										<td class="px-3 py-2.5">
											<span class="text-xs text-gray-500">{formatFecha(envio.emitido_at)}</span>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
