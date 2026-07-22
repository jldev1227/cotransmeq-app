<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { certificadosPublicTerceroAPI } from '$lib/api/certificadosTercero';

	type EstadoVista = 'cargando' | 'verificando' | 'auth_required' | 'listo' | 'error';
	type CodigoError =
		| 'invalid_nit'
		| 'not_found'
		| 'unauthorized'
		| 'forbidden'
		| 'rate_limited'
		| 'service_unavailable'
		| 'config_error'
		| 'server_error'
		| 'not_configured';

	let estado: EstadoVista = $state('cargando');
	type ErrorData = { code: CodigoError; message: string; details?: string };
	let errorData: ErrorData | null = $state<ErrorData | null>(null);
	type DocumentoTributario = {
		id: string;
		nombre: string;
		url: string;
		fecha_creacion: string;
		tamaño: number;
		carpeta: string;
		tipo?: string;
	};
	let documentos: DocumentoTributario[] = $state([]);
	let carpetas: { nombre: string; cantidad: number }[] = $state([]);
	let nit = $state('');
	let terceroNombre = $state('');
	let tokenExpiresAt = $state('');
	let storedToken = $state('');
	let mounted = $state(false);

	const STORAGE_KEY = 'certificados_access_token';

	function getErrorConfig(code: CodigoError) {
		const configs: Record<CodigoError, { titulo: string; descripcion: string; iconBg: string; iconColor: string; detailBg: string; detailBorder: string; detailText: string }> = {
			invalid_nit: {
				titulo: 'NIT inválido',
				descripcion: 'El NIT debe contener solo números, entre 6 y 11 dígitos.',
				iconBg: 'rgba(245, 158, 11, 0.08)',
				iconColor: '#d97706',
				detailBg: 'rgba(245, 158, 11, 0.06)',
				detailBorder: 'rgba(245, 158, 11, 0.25)',
				detailText: '#92400E'
			},
			not_found: {
				titulo: 'Sin documentos disponibles',
				descripcion: 'No se encontraron certificados para el NIT consultado.',
				iconBg: 'rgba(245, 158, 11, 0.08)',
				iconColor: '#d97706',
				detailBg: 'rgba(245, 158, 11, 0.06)',
				detailBorder: 'rgba(245, 158, 11, 0.25)',
				detailText: '#92400E'
			},
			unauthorized: {
				titulo: 'Acceso no autorizado',
				descripcion: 'Tu enlace de acceso es inválido o ha expirado. Solicita un nuevo acceso.',
				iconBg: 'rgba(220, 38, 38, 0.06)',
				iconColor: '#dc2626',
				detailBg: 'rgba(220, 38, 38, 0.06)',
				detailBorder: 'rgba(220, 38, 38, 0.25)',
				detailText: '#991b1b'
			},
			forbidden: {
				titulo: 'Acceso denegado',
				descripcion: 'No tienes permiso para ver los certificados de este NIT.',
				iconBg: 'rgba(220, 38, 38, 0.06)',
				iconColor: '#dc2626',
				detailBg: 'rgba(220, 38, 38, 0.06)',
				detailBorder: 'rgba(220, 38, 38, 0.25)',
				detailText: '#991b1b'
			},
			rate_limited: {
				titulo: 'Demasiadas solicitudes',
				descripcion: 'Microsoft Graph está limitando las solicitudes. Intenta en unos minutos.',
				iconBg: 'rgba(59, 130, 246, 0.08)',
				iconColor: '#2563eb',
				detailBg: 'rgba(59, 130, 246, 0.06)',
				detailBorder: 'rgba(59, 130, 246, 0.25)',
				detailText: '#1e40af'
			},
			service_unavailable: {
				titulo: 'Servicio no disponible',
				descripcion: 'No se pudo conectar con Microsoft Graph en este momento.',
				iconBg: 'rgba(59, 130, 246, 0.08)',
				iconColor: '#2563eb',
				detailBg: 'rgba(59, 130, 246, 0.06)',
				detailBorder: 'rgba(59, 130, 246, 0.25)',
				detailText: '#1e40af'
			},
			config_error: {
				titulo: 'Error de configuración',
				descripcion: 'Faltan variables de entorno de Microsoft Graph en el servidor.',
				iconBg: 'rgba(109, 40, 217, 0.08)',
				iconColor: '#7c3aed',
				detailBg: 'rgba(109, 40, 217, 0.06)',
				detailBorder: 'rgba(109, 40, 217, 0.25)',
				detailText: '#5b21b6'
			},
			server_error: {
				titulo: 'Error del servidor',
				descripcion: 'Ocurrió un error inesperado. Intenta nuevamente.',
				iconBg: 'rgba(220, 38, 38, 0.06)',
				iconColor: '#dc2626',
				detailBg: 'rgba(220, 38, 38, 0.06)',
				detailBorder: 'rgba(220, 38, 38, 0.25)',
				detailText: '#991b1b'
			},
			not_configured: {
				titulo: 'Servicio no configurado',
				descripcion: 'El servicio de certificados no está disponible en este momento.',
				iconBg: 'rgba(245, 158, 11, 0.08)',
				iconColor: '#d97706',
				detailBg: 'rgba(245, 158, 11, 0.06)',
				detailBorder: 'rgba(245, 158, 11, 0.25)',
				detailText: '#92400E'
			}
		};
		return configs[code] || configs.server_error;
	}

	function formatFileSize(size: number): string {
		if (!size || size <= 0) return 'Tamaño desconocido';
		const KB = 1024;
		const MB = KB * 1024;
		const GB = MB * 1024;
		if (size >= GB) return `${(size / GB).toFixed(2)} GB`;
		if (size >= MB) return `${(size / MB).toFixed(2)} MB`;
		if (size >= KB) return `${(size / KB).toFixed(2)} KB`;
		return `${size} Bytes`;
	}

	function formatDate(date?: string): string {
		if (!date) return 'Fecha no disponible';
		try {
			return new Date(date).toLocaleDateString('es-CO', {
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return 'Fecha no disponible';
		}
	}

	function getFileEmoji(filename: string): string {
		const ext = filename.split('.').pop()?.toLowerCase() ?? '';
		if (ext === 'pdf') return '📄';
		if (ext === 'doc' || ext === 'docx') return '📝';
		if (ext === 'xls' || ext === 'xlsx') return '📊';
		if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return '🖼️';
		return '📁';
	}

	function getFileColor(filename: string): string {
		const ext = filename.split('.').pop()?.toLowerCase() ?? '';
		if (ext === 'pdf') return 'from-red-400 to-red-600';
		if (ext === 'doc' || ext === 'docx') return 'from-blue-400 to-blue-600';
		if (ext === 'xls' || ext === 'xlsx') return 'from-orange-400 to-orange-600';
		if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 'from-purple-400 to-purple-600';
		return 'from-gray-400 to-gray-600';
	}

	function groupByCarpeta(
		docs: DocumentoTributario[],
		carps: { nombre: string; cantidad: number }[]
	): Map<string, DocumentoTributario[]> {
		const map = new Map<string, DocumentoTributario[]>();
		carps.forEach((c) => {
			if (!map.has(c.nombre)) map.set(c.nombre, []);
		});
		docs.forEach((d) => {
			const key = d.carpeta || 'Sin carpeta';
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(d);
		});
		return map;
	}

	async function cargar(nitParam: string, token: string) {
		estado = 'cargando';
		errorData = null;
		try {
			const res = await certificadosPublicTerceroAPI.verificarToken(token);
			const terceroNit = res.data.tercero.identificacion?.replace(/\D/g, '') ?? '';
			const cleanParam = nitParam.replace(/\D/g, '');

			if (terceroNit !== cleanParam) {
				estado = 'auth_required';
				return;
			}

			nit = nitParam;
			terceroNombre = res.data.tercero.nombre_completo;
			tokenExpiresAt = res.data.expires_at;

			const certs = res.data.certificados ?? [];
			documentos = certs.map((c: any) => ({
				id: c.id,
				nombre: c.filename,
				url: c.url,
				fecha_creacion: c.created_at,
				tamaño: 0,
				carpeta: `${c.tipo_certificado?.codigo || c.tipo || 'Otros'} ${c.anio}`,
				tipo: c.tipo_certificado?.codigo || c.tipo
			}));
			carpetas = [];

			const carpetaMap = new Map<string, number>();
			for (const doc of documentos) {
				const key = doc.carpeta || 'Sin carpeta';
				carpetaMap.set(key, (carpetaMap.get(key) || 0) + 1);
			}
			carpetas = Array.from(carpetaMap.entries()).map(([nombre, cantidad]) => ({ nombre, cantidad }));

			estado = 'listo';
		} catch (err: any) {
			if (err?.response?.status === 401) {
				estado = 'auth_required';
				if (browser) localStorage.removeItem(STORAGE_KEY);
			} else {
				const code: CodigoError = (err?.response?.data?.code ?? 'server_error') as CodigoError;
				errorData = {
					code,
					message: err?.response?.data?.error ?? 'Error al consultar los certificados.',
					details: err?.response?.data?.details
				};
				documentos = [];
				carpetas = [];
				estado = 'error';
			}
		}
	}

	function reintentar() {
		if (nit && storedToken) cargar(nit, storedToken);
	}

	function formatNit(n: string): string {
		return n.replace(/\D/g, '').slice(0, 11);
	}

	function cerrarSesion() {
		if (browser) localStorage.removeItem(STORAGE_KEY);
		storedToken = '';
		goto('/public/certificados');
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

	const carpetasAgrupadas = $derived(groupByCarpeta(documentos, carpetas));
	const totalDocumentos = $derived(documentos.length);
	const totalCarpetas = $derived(carpetas.length);
	const errorConfig = $derived(errorData ? getErrorConfig(errorData.code) : null);

	onMount(async () => {
		const nitParam = $page.url.pathname.split('/').pop() ?? '';
		nit = nitParam;

		const urlToken = $page.url.searchParams.get('token');
		const localToken = browser ? localStorage.getItem(STORAGE_KEY) : null;
		const token = urlToken || localToken;

		if (!token) {
			estado = 'auth_required';
			mounted = true;
			return;
		}

		storedToken = token;
		estado = 'verificando';

		const checkFinal = () => {
			if (browser && estado === 'listo') {
				localStorage.setItem(STORAGE_KEY, token);
				const url = new URL(window.location.href);
				url.searchParams.delete('token');
				window.history.replaceState({}, '', url.toString());
			}
		};

		try {
			await cargar(nitParam, token);
		} catch {
			estado = 'auth_required';
		}
		checkFinal();
		mounted = true;
	});
</script>

<svelte:head>
	<title>Certificados Tributarios — NIT {formatNit(nit)} · Cotransmeq</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="page" in:fade={{ duration: 300 }}>
	<!-- Sticky header -->
	<header class="page-header">
		<div class="page-header-inner">
			<div class="header-left">
				<a class="back-btn" href="/public/certificados" aria-label="Volver al inicio">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
					</svg>
					<span class="back-text">Inicio</span>
				</a>
				<div class="header-brand">
					<div class="header-icon">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
					</div>
					<div>
						<span class="eyebrow">Documentos oficiales</span>
						<h1 class="header-title">Certificados Tributarios</h1>
					</div>
				</div>
			</div>

			<div class="header-right">
				<span class="status-pill">
					<span class="status-dot"></span>
					Verificados
				</span>
				{#if estado === 'listo'}
					<button class="btn-icon" onclick={cerrarSesion} aria-label="Cerrar sesión" title="Cerrar sesión">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
							/>
						</svg>
					</button>
				{/if}
			</div>
		</div>
	</header>

	<main class="page-main">
		{#if estado === 'cargando' || estado === 'verificando'}
			<div class="state-block" in:fade={{ duration: 200 }}>
				<span class="spinner-lg"></span>
				<p class="state-text">
					{estado === 'verificando' ? 'Verificando acceso…' : 'Cargando certificados…'}
				</p>
			</div>

		{:else if estado === 'auth_required'}
			<div class="state-card state-card--auth" in:fly={{ y: 20, duration: 400, easing: quintOut }}>
				<div class="state-icon state-icon--danger">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
						/>
					</svg>
				</div>
				<span class="eyebrow eyebrow--danger">Acceso requerido</span>
				<h1 class="state-title">Necesitas un enlace válido</h1>
				<p class="state-sub">
					Solicita acceso desde el portal principal para recibir tu enlace por correo.
				</p>
				<div class="state-actions">
					<a href="/public/certificados" class="btn-primary">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
							/>
						</svg>
						Solicitar acceso
					</a>
				</div>
			</div>

		{:else if estado === 'error' && errorData && errorConfig}
			<div class="state-card state-card--error" in:fly={{ y: 20, duration: 400, easing: quintOut }}>
				<div class="state-icon" style="background: {errorConfig.iconBg}; color: {errorConfig.iconColor};">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
						/>
					</svg>
				</div>
				<span class="eyebrow">Error</span>
				<h1 class="state-title">{errorConfig.titulo}</h1>
				<p class="state-sub">{errorConfig.descripcion}</p>
				{#if errorData.details}
					<p
						class="detail-box"
						style="background: {errorConfig.detailBg}; border-color: {errorConfig.detailBorder}; color: {errorConfig.detailText};"
					>
						{errorData.details}
					</p>
				{/if}
				<div class="state-actions">
					{#if errorData.code === 'invalid_nit' || errorData.code === 'not_found'}
						<a href="/public/certificados" class="btn-primary">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
							</svg>
							Consultar otro NIT
						</a>
					{:else}
						<button onclick={reintentar} class="btn-primary">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/>
							</svg>
							Reintentar
						</button>
					{/if}
					<a href="/public/certificados" class="btn-secondary">
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
							/>
						</svg>
						Ir al inicio
					</a>
				</div>
			</div>

		{:else}
			<div class="content-grid">
				<div class="content-main">
					<!-- Tercero header -->
					<section class="tercero-card" in:fly={{ y: 16, duration: 400, easing: quintOut }}>
						<div class="tercero-icon">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
								/>
							</svg>
						</div>
						<div class="tercero-info">
							<span class="eyebrow">Certificados de</span>
							<h2 class="tercero-name">{terceroNombre}</h2>
							<p class="tercero-nit">
								NIT <span class="meta-mono">{formatNit(nit)}</span>
							</p>
						</div>
						{#if totalCarpetas > 0}
							<div class="carpetas-pill">
								<span class="meta-mono">{totalCarpetas}</span>
								<span>{totalCarpetas === 1 ? 'carpeta' : 'carpetas'}</span>
							</div>
						{/if}
					</section>

					<!-- Certificados -->
					<section class="docs-card" in:fly={{ y: 16, duration: 400, easing: quintOut, delay: 100 }}>
						<header class="docs-head">
							<div>
								<h3 class="docs-title">Certificados disponibles</h3>
								<p class="docs-sub">Documentos obtenidos desde OneDrive corporativo.</p>
							</div>
							{#if totalDocumentos > 0}
								<span class="docs-pill">
									<span class="meta-mono">{totalDocumentos}</span>
									<span>{totalDocumentos === 1 ? 'documento' : 'documentos'}</span>
								</span>
							{/if}
						</header>

						{#if totalDocumentos === 0 && totalCarpetas === 0}
							<div class="empty-state" in:fade={{ duration: 250 }}>
								<div class="empty-icon">
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
										/>
									</svg>
								</div>
								<h2 class="empty-title">No hay documentos</h2>
								<p class="empty-sub">
									No se encontraron certificados para el NIT
									<strong>{formatNit(nit)}</strong>.
								</p>
								<a href="/public/certificados" class="btn-secondary">
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
									</svg>
									Consultar otro NIT
								</a>
							</div>
						{:else}
							<div class="carpetas-stack">
								{#each Array.from(carpetasAgrupadas.entries()) as [nombreCarpeta, docs] (nombreCarpeta)}
									<section class="carpeta">
										<header class="carpeta-head">
											<div class="carpeta-icon">
												<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
													/>
												</svg>
											</div>
											<div class="carpeta-info">
												<h4 class="carpeta-name">
													{nombreCarpeta === 'Sin carpeta' ? 'Sin carpeta' : nombreCarpeta}
												</h4>
												<p class="carpeta-count">
													{docs.length} documento{docs.length !== 1 ? 's' : ''}
												</p>
											</div>
											<span class="carpeta-pill">
												<span class="meta-mono">{docs.length}</span>
											</span>
										</header>

										{#if docs.length > 0}
											<ul class="docs-list">
												{#each docs as doc (doc.id)}
													<li class="doc-item">
														<div class="doc-icon bg-gradient-to-br {getFileColor(doc.nombre)}">
															<span class="doc-emoji">{getFileEmoji(doc.nombre)}</span>
														</div>
														<div class="doc-info">
															<p class="doc-name">{doc.nombre}</p>
															<div class="doc-meta">
																<span class="doc-meta-item">
																	<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
																		<path
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
																		/>
																	</svg>
																	{formatDate(doc.fecha_creacion)}
																</span>
																{#if doc.tipo}
																	<span class="doc-meta-tag">
																		{formatTipo(doc.tipo)}
																	</span>
																{/if}
															</div>
														</div>
														{#if doc.url}
															<a
																href={doc.url}
																target="_blank"
																rel="noopener noreferrer"
																class="doc-open"
																title="Abrir en nueva pestaña"
																aria-label="Abrir documento {doc.nombre}"
															>
																<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
																	<path
																		stroke-linecap="round"
																		stroke-linejoin="round"
																		d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
																	/>
																</svg>
															</a>
														{/if}
													</li>
												{/each}
											</ul>
										{:else}
											<div class="carpeta-empty">Carpeta sin documentos.</div>
										{/if}
									</section>
								{/each}
							</div>
						{/if}
					</section>

					{#if totalDocumentos > 0}
						<aside class="info-banner" in:fly={{ y: 12, duration: 400, delay: 200 }}>
							<div class="info-icon">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
									/>
								</svg>
							</div>
							<div>
								<p class="info-title">Documentos verificados</p>
								<p class="info-text">
									Todos los certificados mostrados son documentos oficiales obtenidos
									desde OneDrive corporativo de Cotransmeq.
								</p>
							</div>
						</aside>
					{/if}
				</div>

				<aside class="content-aside">
					<div class="aside-card" in:fly={{ y: 16, duration: 400, easing: quintOut, delay: 150 }}>
						<img
							src="/assets/logo_transmeralda-264.webp"
							alt="Cotransmeq S.A.S"
							class="aside-logo"
						/>
						<h3 class="aside-title">
							{totalDocumentos > 0 ? 'Documentos listos' : 'Sin resultados'}
						</h3>
						<p class="aside-sub">
							{totalDocumentos > 0
								? 'Todos los certificados están disponibles para descarga.'
								: 'No se encontraron documentos para esta empresa.'}
						</p>
						{#if tokenExpiresAt}
							<p class="aside-exp">
								Enlace válido hasta
								<span class="meta-mono">{formatDate(tokenExpiresAt)}</span>
							</p>
						{/if}
					</div>
				</aside>
			</div>
		{/if}
	</main>

	<footer class="page-footer">
		<div class="page-footer-inner">
			<p>© {new Date().getFullYear()} Certificados Cotransmeq · Todos los derechos reservados.</p>
			<div class="footer-meta">
				<span>Soporte técnico</span>
				<span class="dot-sep">·</span>
				<span>Datos protegidos</span>
			</div>
		</div>
	</footer>
</div>

<style>
	/* ═══════════════════════════════════════════════════
	   TOKENS — landing-transmeralda editorial
	   ═══════════════════════════════════════════════════ */
	.page {
		--bg: #faf7f2;
		--surface: #ffffff;
		--surface-2: #f5f1e8;
		--border: rgba(0, 0, 0, 0.08);
		--border-default: rgba(0, 0, 0, 0.12);
		--border-hover: rgba(0, 0, 0, 0.2);
		--text-primary: #0f1f1a;
		--text-secondary: #4a4a4a;
		--text-muted: #6b6b6b;
		--text-very-muted: #9a9a9a;
		--accent: #f97316;
		--accent-hover: #ea580c;
		--accent-bg: rgba(249, 115, 22, 0.08);
		--shadow-soft: 0 4px 24px rgba(0, 0, 0, 0.04);
		--ease: cubic-bezier(0.25, 0.46, 0.45, 0.94);

		min-height: 100vh;
		min-height: 100dvh;
		background: var(--bg);
		font-family: 'Inter', 'Inter Tight', system-ui, sans-serif;
		color: var(--text-primary);
		display: flex;
		flex-direction: column;
		-webkit-font-smoothing: antialiased;
	}

	.meta-mono {
		font-family: 'JetBrains Mono', monospace;
		color: inherit;
		font-weight: 600;
	}

	.eyebrow {
		display: inline-block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent-hover);
		background: var(--accent-bg);
		padding: 0.2rem 0.6rem;
		border-radius: 5px;
		margin-bottom: 0.4rem;
	}
	.eyebrow--danger {
		color: #b91c1c;
		background: rgba(220, 38, 38, 0.06);
	}

	/* ═══ Sticky header ═══ */
	.page-header {
		position: sticky;
		top: 0;
		z-index: 30;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: saturate(180%) blur(20px);
		-webkit-backdrop-filter: saturate(180%) blur(20px);
		border-bottom: 1px solid var(--border);
	}
	.page-header-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1.5rem;
		max-width: 1200px;
		margin: 0 auto;
		flex-wrap: wrap;
	}
	.header-left {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-width: 0;
		flex: 1;
	}
	.back-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.4rem 0.4rem 0.5rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 8px;
		color: var(--text-secondary);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s var(--ease);
		flex-shrink: 0;
	}
	.back-btn:hover {
		background: var(--surface);
		color: var(--accent-hover);
		border-color: rgba(249, 115, 22, 0.3);
	}
	.back-btn svg {
		width: 14px;
		height: 14px;
	}
	.back-text {
		display: none;
	}
	@media (min-width: 480px) {
		.back-text {
			display: inline;
		}
	}

	.header-brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}
	.header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 10px;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #ffffff;
		flex-shrink: 0;
		box-shadow: 0 2px 8px rgba(249, 115, 22, 0.25);
	}
	.header-icon svg {
		width: 18px;
		height: 18px;
	}
	.header-title {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.05rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0;
		letter-spacing: -0.015em;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.6rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent-hover);
		background: var(--accent-bg);
		border: 1px solid rgba(249, 115, 22, 0.18);
		border-radius: 999px;
	}
	.status-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse 2.5s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.btn-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: var(--surface);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s var(--ease);
	}
	.btn-icon:hover {
		background: rgba(220, 38, 38, 0.04);
		border-color: rgba(220, 38, 38, 0.2);
		color: #b91c1c;
	}
	.btn-icon svg {
		width: 16px;
		height: 16px;
	}

	/* ═══ Main content ═══ */
	.page-main {
		flex: 1;
		max-width: 1200px;
		width: 100%;
		margin: 0 auto;
		padding: 1.5rem 1.5rem 2rem;
	}

	/* ═══ Loading state ═══ */
	.state-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		padding: 5rem 1rem;
		color: var(--text-muted);
	}
	.state-text {
		font-size: 0.9rem;
		margin: 0;
	}
	.spinner-lg {
		width: 36px;
		height: 36px;
		border: 3px solid rgba(249, 115, 22, 0.15);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* ═══ State cards (auth/error) ═══ */
	.state-card {
		max-width: 480px;
		margin: 2rem auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 24px;
		padding: 2rem 1.75rem;
		box-shadow: var(--shadow-soft);
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.state-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: var(--accent-bg);
		color: var(--accent);
		margin-bottom: 1rem;
	}
	.state-icon--danger {
		background: rgba(220, 38, 38, 0.06);
		color: #b91c1c;
	}
	.state-icon svg {
		width: 28px;
		height: 28px;
	}
	.state-title {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.4rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0 0 0.5rem;
	}
	.state-sub {
		font-size: 0.88rem;
		color: var(--text-secondary);
		margin: 0 0 1.25rem;
		max-width: 380px;
		line-height: 1.55;
	}
	.state-actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.detail-box {
		font-size: 0.78rem;
		font-weight: 500;
		padding: 0.6rem 0.85rem;
		border-radius: 8px;
		border: 1px solid;
		margin: 0 0 1.25rem;
		max-width: 420px;
		text-align: left;
		line-height: 1.5;
	}

	/* ═══ Buttons ═══ */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.55rem 1rem;
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		color: #ffffff;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		border: none;
		border-radius: 10px;
		cursor: pointer;
		text-decoration: none;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
		transition: all 0.2s var(--ease);
	}
	.btn-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.4);
	}
	.btn-primary svg {
		width: 14px;
		height: 14px;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.55rem 1rem;
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-primary);
		background: var(--surface);
		border: 1px solid var(--border-default);
		border-radius: 10px;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s var(--ease);
	}
	.btn-secondary:hover {
		background: var(--bg);
		border-color: var(--border-hover);
	}
	.btn-secondary svg {
		width: 14px;
		height: 14px;
	}

	/* ═══ Content grid (main + aside) ═══ */
	.content-grid {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	@media (min-width: 1024px) {
		.content-grid {
			display: grid;
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
			gap: 1.5rem;
			align-items: start;
		}
	}
	.content-main {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.content-aside {
		display: none;
	}
	@media (min-width: 1024px) {
		.content-aside {
			display: block;
		}
	}

	/* ═══ Tercero card ═══ */
	.tercero-card {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 1.1rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
		box-shadow: var(--shadow-soft);
	}
	.tercero-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #ffffff;
		flex-shrink: 0;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	}
	.tercero-icon svg {
		width: 22px;
		height: 22px;
	}
	.tercero-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.tercero-name {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.2rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0;
		letter-spacing: -0.015em;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tercero-nit {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin: 0;
	}
	.carpetas-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 999px;
		flex-shrink: 0;
	}

	/* ═══ Docs card ═══ */
	.docs-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
		box-shadow: var(--shadow-soft);
		padding: 1.25rem 1.4rem;
	}
	.docs-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.85rem;
		margin-bottom: 1.1rem;
		flex-wrap: wrap;
	}
	.docs-title {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0 0 0.2rem;
		letter-spacing: -0.015em;
	}
	.docs-sub {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin: 0;
	}
	.docs-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--accent-hover);
		background: var(--accent-bg);
		border: 1px solid rgba(249, 115, 22, 0.18);
		border-radius: 999px;
	}

	/* ═══ Carpetas stack ═══ */
	.carpetas-stack {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.carpeta {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		overflow: hidden;
	}
	.carpeta-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}
	.carpeta-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: linear-gradient(135deg, var(--accent), var(--accent-hover));
		color: #ffffff;
		flex-shrink: 0;
		box-shadow: 0 2px 8px rgba(249, 115, 22, 0.25);
	}
	.carpeta-icon svg {
		width: 18px;
		height: 18px;
	}
	.carpeta-info {
		flex: 1;
		min-width: 0;
	}
	.carpeta-name {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
		letter-spacing: -0.005em;
	}
	.carpeta-count {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0.1rem 0 0;
	}
	.carpeta-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 24px;
		height: 22px;
		padding: 0 0.5rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--accent-hover);
		background: var(--accent-bg);
		border-radius: 999px;
	}
	.carpeta-empty {
		padding: 1rem 1.25rem;
		font-size: 0.78rem;
		color: var(--text-muted);
		text-align: center;
	}

	/* ═══ Docs list ═══ */
	.docs-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.doc-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		border-top: 1px solid rgba(0, 0, 0, 0.04);
		transition: background-color 0.15s var(--ease);
	}
	.doc-item:first-child {
		border-top: none;
	}
	.doc-item:hover {
		background: var(--accent-bg);
	}
	.doc-icon {
		width: 38px;
		height: 38px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.doc-emoji {
		font-size: 1.1rem;
		line-height: 1;
	}
	.doc-info {
		flex: 1;
		min-width: 0;
	}
	.doc-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.doc-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.85rem;
		margin-top: 0.2rem;
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.doc-meta-item {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.doc-meta-item svg {
		width: 12px;
		height: 12px;
	}
	.doc-meta-tag {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem 0.45rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #5b21b6;
		background: rgba(109, 40, 217, 0.08);
		border: 1px solid rgba(109, 40, 217, 0.18);
		border-radius: 4px;
	}
	.doc-open {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--accent);
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s var(--ease);
		flex-shrink: 0;
	}
	.doc-open:hover {
		background: var(--accent-bg);
		border-color: rgba(249, 115, 22, 0.3);
	}
	.doc-open svg {
		width: 14px;
		height: 14px;
	}

	/* ═══ Info banner ═══ */
	.info-banner {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.9rem 1.1rem;
		background: linear-gradient(135deg, rgba(249, 115, 22, 0.04), rgba(249, 115, 22, 0.08));
		border: 1px solid rgba(249, 115, 22, 0.18);
		border-radius: 14px;
	}
	.info-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: var(--accent-bg);
		color: var(--accent);
		flex-shrink: 0;
	}
	.info-icon svg {
		width: 14px;
		height: 14px;
	}
	.info-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: #047857;
		margin: 0 0 0.15rem;
	}
	.info-text {
		font-size: 0.78rem;
		line-height: 1.5;
		color: #065f46;
		margin: 0;
	}

	/* ═══ Aside ═══ */
	.aside-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
		padding: 1.5rem 1.4rem;
		box-shadow: var(--shadow-soft);
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.aside-logo {
		height: 72px;
		width: auto;
		object-fit: contain;
		display: block;
		margin-bottom: 0.85rem;
	}
	.aside-title {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--accent-hover);
		margin: 0 0 0.4rem;
	}
	.aside-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		line-height: 1.5;
		margin: 0 0 0.6rem;
	}
	.aside-exp {
		font-size: 0.7rem;
		color: var(--text-very-muted);
		font-family: 'JetBrains Mono', monospace;
		letter-spacing: 0.02em;
		margin: 0;
		padding-top: 0.6rem;
		border-top: 1px solid var(--border);
		width: 100%;
	}

	/* ═══ Empty state ═══ */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 2.5rem 1.5rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 16px;
		text-align: center;
	}
	.empty-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--accent-bg);
		color: var(--accent);
		margin-bottom: 0.3rem;
	}
	.empty-icon svg {
		width: 22px;
		height: 22px;
	}
	.empty-title {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1rem;
		font-weight: 500;
		color: var(--text-primary);
		margin: 0;
	}
	.empty-sub {
		font-size: 0.82rem;
		color: var(--text-muted);
		margin: 0;
		max-width: 320px;
	}

	/* ═══ Footer ═══ */
	.page-footer {
		border-top: 1px solid var(--border);
		background: rgba(255, 255, 255, 0.6);
		padding: 1rem 1.5rem;
	}
	.page-footer-inner {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: center;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--text-muted);
		text-align: center;
	}
	@media (min-width: 640px) {
		.page-footer-inner {
			flex-direction: row;
			text-align: left;
		}
	}
	.page-footer p { margin: 0; }
	.footer-meta {
		display: flex;
		gap: 0.5rem;
		color: var(--text-very-muted);
	}
	.dot-sep {
		opacity: 0.4;
	}

	@media (prefers-reduced-motion: reduce) {
		*,
		*::before,
		*::after {
			transition: none !important;
			animation: none !important;
		}
	}
</style>
