<script lang="ts">
	/**
	 * Certificados tributarios de un tercero, por NIT.
	 *
	 * Misma cáscara que el portal del conductor: barra con el logo, cabecera
	 * verde con la mascota (`PortalHeader`) y tarjetas blancas sobre el fondo
	 * de marca. Las carpetas (tipo + año) se reparten en una rejilla fluida
	 * para aprovechar el ancho del escritorio sin puntos de ruptura a mano.
	 *
	 * Los estados sin datos (validando, sin acceso, error) hablan con la
	 * mascota: el tono del error decide la reacción y los colores, no un
	 * hexadecimal por código.
	 *
	 * El layout público deja el `body` sin scroll (lo necesita el mapa), así
	 * que la página es su propio contenedor de scroll.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { certificadosPublicTerceroAPI } from '$lib/api/certificadosTercero';
	import PortalHeader from '$lib/components/portal/PortalHeader.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { mascota as mascotaDe, type MascotIntent } from '$lib/mascot';

	const EMPRESA = 'Cotransmeq S.A.S';
	const LOGO_SRC = '/assets/logo_nombre.webp';
	const STORAGE_KEY = 'certificados_access_token';

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
	type Tono = 'aviso' | 'peligro' | 'info';
	type ErrorData = { code: CodigoError; message: string; details?: string };
	type Documento = {
		id: string;
		nombre: string;
		url: string;
		fecha_creacion: string;
		carpeta: string;
		tipo?: string;
	};

	let estado = $state<EstadoVista>('cargando');
	let errorData = $state<ErrorData | null>(null);
	let documentos = $state<Documento[]>([]);
	let nit = $state('');
	let terceroNombre = $state('');
	let tokenExpiresAt = $state('');
	let storedToken = $state('');

	/** Qué decir y con qué cara ante cada código del servidor. */
	const ERRORES: Record<CodigoError, { titulo: string; descripcion: string; tono: Tono; mascota: MascotIntent }> = {
		invalid_nit: {
			titulo: 'NIT inválido',
			descripcion: 'El NIT debe contener solo números, entre 6 y 11 dígitos.',
			tono: 'aviso',
			mascota: 'advertencia'
		},
		not_found: {
			titulo: 'Sin documentos disponibles',
			descripcion: 'No se encontraron certificados para el NIT consultado.',
			tono: 'aviso',
			mascota: 'vacio'
		},
		unauthorized: {
			titulo: 'Acceso no autorizado',
			descripcion: 'Tu enlace de acceso no es válido o ya venció. Solicita uno nuevo.',
			tono: 'peligro',
			mascota: 'advertencia'
		},
		forbidden: {
			titulo: 'Acceso denegado',
			descripcion: 'Tu enlace no da acceso a los certificados de este NIT.',
			tono: 'peligro',
			mascota: 'advertencia'
		},
		rate_limited: {
			titulo: 'Demasiadas solicitudes',
			descripcion: 'El servicio de documentos está limitando las consultas. Intenta en unos minutos.',
			tono: 'info',
			mascota: 'espera'
		},
		service_unavailable: {
			titulo: 'Servicio no disponible',
			descripcion: 'No pudimos conectar con el repositorio de documentos en este momento.',
			tono: 'info',
			mascota: 'espera'
		},
		config_error: {
			titulo: 'Error de configuración',
			descripcion: 'Falta configuración del repositorio de documentos en el servidor.',
			tono: 'peligro',
			mascota: 'advertencia'
		},
		server_error: {
			titulo: 'Error del servidor',
			descripcion: 'Ocurrió un error inesperado. Intenta nuevamente.',
			tono: 'peligro',
			mascota: 'advertencia'
		},
		not_configured: {
			titulo: 'Servicio no configurado',
			descripcion: 'El servicio de certificados no está disponible en este momento.',
			tono: 'aviso',
			mascota: 'espera'
		}
	};

	const TIPOS: Record<string, string> = {
		RETEFUENTE: 'Retefuente',
		RETEICA: 'Reteica',
		RETEIVA: 'Reteiva',
		ICA: 'ICA',
		IVA: 'IVA',
		RETENCIONES: 'Retenciones',
		OTROS: 'Otros'
	};
	const formatearTipo = (codigo: string) => TIPOS[codigo] || codigo;

	/** La carpeta viene como «RETEFUENTE 2025»: se muestra con el tipo legible. */
	function formatearCarpeta(nombre: string) {
		const [codigo, ...resto] = nombre.split(' ');
		return [formatearTipo(codigo), ...resto].join(' ');
	}

	function formatearFecha(fecha?: string) {
		if (!fecha) return 'Fecha no disponible';
		try {
			return new Date(fecha).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
		} catch {
			return 'Fecha no disponible';
		}
	}

	const formatearNit = (n: string) => n.replace(/\D/g, '').slice(0, 11);
	/// Los certificados se guardan sin extensión en el nombre: son PDF.
	const extensionDe = (nombre: string) =>
		nombre.includes('.') ? nombre.split('.').pop()!.toUpperCase().slice(0, 4) : 'PDF';

	function agruparPorCarpeta(docs: Documento[]) {
		const grupos = new Map<string, Documento[]>();
		for (const d of docs) {
			const clave = d.carpeta || 'Sin carpeta';
			if (!grupos.has(clave)) grupos.set(clave, []);
			grupos.get(clave)!.push(d);
		}
		return Array.from(grupos.entries());
	}

	async function cargar(nitParam: string, token: string) {
		estado = 'cargando';
		errorData = null;
		try {
			const res = await certificadosPublicTerceroAPI.verificarToken(token);
			const terceroNit = res.data.tercero.identificacion?.replace(/\D/g, '') ?? '';
			if (terceroNit !== nitParam.replace(/\D/g, '')) {
				estado = 'auth_required';
				return;
			}

			nit = nitParam;
			terceroNombre = res.data.tercero.nombre_completo;
			tokenExpiresAt = res.data.expires_at;
			documentos = (res.data.certificados ?? []).map((c: any) => ({
				id: c.id,
				nombre: c.filename,
				url: c.url,
				fecha_creacion: c.created_at,
				carpeta: `${c.tipo_certificado?.codigo || c.tipo || 'Otros'} ${c.anio}`,
				tipo: c.tipo_certificado?.codigo || c.tipo
			}));
			estado = 'listo';
		} catch (err: any) {
			if (err?.response?.status === 401) {
				estado = 'auth_required';
				if (browser) localStorage.removeItem(STORAGE_KEY);
			} else {
				errorData = {
					code: (err?.response?.data?.code ?? 'server_error') as CodigoError,
					message: err?.response?.data?.error ?? 'Error al consultar los certificados.',
					details: err?.response?.data?.details
				};
				documentos = [];
				estado = 'error';
			}
		}
	}

	function reintentar() {
		if (nit && storedToken) cargar(nit, storedToken);
	}

	function cerrarSesion() {
		if (browser) localStorage.removeItem(STORAGE_KEY);
		storedToken = '';
		goto('/public/certificados');
	}

	const carpetas = $derived(agruparPorCarpeta(documentos));
	const totalDocumentos = $derived(documentos.length);
	const errorInfo = $derived(errorData ? (ERRORES[errorData.code] ?? ERRORES.server_error) : null);
	const mascotaEstado = $derived(
		estado === 'auth_required' ? mascotaDe('advertencia') : errorInfo ? mascotaDe(errorInfo.mascota) : null
	);

	onMount(async () => {
		const nitParam = $page.url.pathname.split('/').pop() ?? '';
		nit = nitParam;

		const token = $page.url.searchParams.get('token') || (browser ? localStorage.getItem(STORAGE_KEY) : null);
		if (!token) {
			estado = 'auth_required';
			return;
		}

		storedToken = token;
		estado = 'verificando';
		try {
			await cargar(nitParam, token);
		} catch {
			estado = 'auth_required';
		}

		/// El token sale de la URL en cuanto sirvió: así no viaja en el historial
		/// ni en un enlace que alguien copie de la barra.
		if (browser && (estado as EstadoVista) === 'listo') {
			localStorage.setItem(STORAGE_KEY, token);
			const url = new URL(window.location.href);
			url.searchParams.delete('token');
			window.history.replaceState({}, '', url.toString());
		}
	});
</script>

<svelte:head>
	<title>Certificados tributarios · NIT {formatearNit(nit)} · {EMPRESA}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="pagina" in:fade={{ duration: 250 }}>
	<header class="barra">
		<a class="barra-marca" href="/public/certificados" aria-label="Ir al portal de certificados">
			<img src={LOGO_SRC} alt={EMPRESA} class="barra-logo" width="132" height="45" />
			<span class="barra-tag">Certificados tributarios</span>
		</a>
		{#if estado === 'listo'}
			<button type="button" class="barra-salir" onclick={cerrarSesion}>
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
					/>
				</svg>
				<span>Cerrar sesión</span>
			</button>
		{:else}
			<a class="barra-salir" href="/public/certificados">
				<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
				</svg>
				<span>Portal</span>
			</a>
		{/if}
	</header>

	<main class="cuerpo">
		{#if estado === 'cargando' || estado === 'verificando'}
			<CargaMascota
				tamano="pantalla"
				texto={estado === 'verificando' ? 'Validando tu acceso…' : 'Cargando certificados…'}
			/>
		{:else if estado === 'auth_required'}
			<section class="estado estado--peligro" in:fly={{ y: 16, duration: 350, easing: quintOut }}>
				{#if mascotaEstado}
					<img class="estado-mascota" src={mascotaEstado.src} alt="" aria-hidden="true" width="160" height="160" />
				{/if}
				<span class="estado-badge">Acceso requerido</span>
				<h1 class="estado-titulo">Necesitas un enlace válido</h1>
				<p class="estado-texto">
					Solicita el acceso desde el portal con tu número de identificación y te enviamos el enlace por correo.
				</p>
				<div class="estado-acciones">
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
			</section>
		{:else if estado === 'error' && errorData && errorInfo}
			<section
				class="estado"
				class:estado--aviso={errorInfo.tono === 'aviso'}
				class:estado--peligro={errorInfo.tono === 'peligro'}
				in:fly={{ y: 16, duration: 350, easing: quintOut }}
			>
				{#if mascotaEstado}
					<img class="estado-mascota" src={mascotaEstado.src} alt="" aria-hidden="true" width="160" height="160" />
				{/if}
				<span class="estado-badge">No se pudo cargar</span>
				<h1 class="estado-titulo">{errorInfo.titulo}</h1>
				<p class="estado-texto">{errorInfo.descripcion}</p>
				{#if errorData.details}
					<p class="estado-detalle">{errorData.details}</p>
				{/if}
				<div class="estado-acciones">
					{#if errorData.code === 'invalid_nit' || errorData.code === 'not_found'}
						<a href="/public/certificados" class="btn-primary">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
							</svg>
							Consultar otro NIT
						</a>
					{:else}
						<button type="button" onclick={reintentar} class="btn-primary">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/>
							</svg>
							Reintentar
						</button>
						<a href="/public/certificados" class="btn-secondary">Ir al portal</a>
					{/if}
				</div>
			</section>
		{:else}
			<div class="contenido" in:fly={{ y: 12, duration: 350, easing: quintOut }}>
				<PortalHeader
					eyebrow="Certificados tributarios"
					titulo={terceroNombre}
					meta={`NIT ${formatearNit(nit)} · ${totalDocumentos} ${totalDocumentos === 1 ? 'documento' : 'documentos'} en ${carpetas.length} ${carpetas.length === 1 ? 'carpeta' : 'carpetas'}`}
					mascota={totalDocumentos > 0 ? 'exito' : 'vacio'}
				/>

				{#if totalDocumentos === 0}
					<section class="estado estado--aviso">
						<span class="estado-badge">Sin documentos</span>
						<h2 class="estado-titulo">Todavía no hay certificados</h2>
						<p class="estado-texto">
							No se encontraron certificados para el NIT <strong>{formatearNit(nit)}</strong>. Cuando
							contabilidad los publique, aparecerán aquí con este mismo enlace.
						</p>
						<div class="estado-acciones">
							<a href="/public/certificados" class="btn-secondary">
								<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
								</svg>
								Consultar otro NIT
							</a>
						</div>
					</section>
				{:else}
					<div class="carpetas">
						{#each carpetas as [nombreCarpeta, docs] (nombreCarpeta)}
							<section class="carpeta">
								<header class="carpeta-cabecera">
									<span class="carpeta-icono" aria-hidden="true">
										<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
											/>
										</svg>
									</span>
									<div class="carpeta-texto">
										<h2 class="carpeta-nombre">{formatearCarpeta(nombreCarpeta)}</h2>
										<p class="carpeta-conteo">{docs.length} {docs.length === 1 ? 'documento' : 'documentos'}</p>
									</div>
								</header>

								<ul class="docs">
									{#each docs as doc (doc.id)}
										<li class="doc">
											<span class="doc-ext" aria-hidden="true">{extensionDe(doc.nombre)}</span>
											<div class="doc-info">
												<p class="doc-nombre">{doc.nombre}</p>
												<p class="doc-meta">
													{formatearFecha(doc.fecha_creacion)}
													{#if doc.tipo}
														<span class="doc-sep">·</span>
														{formatearTipo(doc.tipo)}
													{/if}
												</p>
											</div>
											{#if doc.url}
												<a
													class="doc-abrir"
													href={doc.url}
													target="_blank"
													rel="noopener noreferrer"
													aria-label="Abrir {doc.nombre}"
													title="Abrir en una pestaña nueva"
												>
													<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
														/>
													</svg>
												</a>
											{/if}
										</li>
									{/each}
								</ul>
							</section>
						{/each}
					</div>

					<aside class="nota">
						<span class="nota-icono" aria-hidden="true">
							<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
								/>
							</svg>
						</span>
						<div>
							<p class="nota-titulo">Documentos verificados</p>
							<p class="nota-texto">
								Son los certificados oficiales emitidos por {EMPRESA}.
								{#if tokenExpiresAt}
									Tu enlace de acceso es válido hasta el <strong>{formatearFecha(tokenExpiresAt)}</strong>.
								{/if}
							</p>
						</div>
					</aside>
				{/if}
			</div>
		{/if}
	</main>

	<footer class="pie">
		<p>© {new Date().getFullYear()} {EMPRESA} · Yopal, Casanare · Colombia</p>
		<p class="pie-meta">
			<span class="pie-punto" aria-hidden="true"></span>
			Canal seguro · datos protegidos
		</p>
	</footer>
</div>

<style>
	/* ════════════════════════════════════════════════════════════
	   La paleta y las medidas son las de la app móvil (`--au-*`).
	   El body no hace scroll bajo /public: la página es su contenedor.
	   ════════════════════════════════════════════════════════════ */
	.pagina {
		--cert-aviso: #b45309;
		--cert-aviso-soft: #fff4e5;
		--cert-info: var(--au-dark);
		--cert-info-soft: var(--au-tint);

		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow-y: auto;
		overflow-x: hidden;
		background: var(--au-bg);
		color: var(--au-text);
		font-family: var(--font-sans);
		-webkit-font-smoothing: antialiased;
	}

	/* ═══ Barra superior ═══ */
	.barra {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: rgba(255, 255, 255, 0.86);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--au-border);
	}
	@media (min-width: 768px) {
		.barra {
			padding: 0.85rem 1.5rem;
		}
	}
	.barra-marca {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		text-decoration: none;
		color: inherit;
	}
	.barra-logo {
		height: 34px;
		width: auto;
		display: block;
	}
	.barra-tag {
		display: none;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		background: var(--au-tint);
		color: var(--au-primary-strong);
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		white-space: nowrap;
	}
	@media (min-width: 640px) {
		.barra-tag {
			display: inline-block;
		}
	}
	.barra-salir {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.5rem;
		padding: 0 0.9rem;
		border: 1.5px solid var(--au-border);
		border-radius: 999px;
		background: var(--au-surface);
		color: var(--au-dark);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 800;
		text-decoration: none;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			border-color 0.2s ease,
			background-color 0.2s ease;
	}
	.barra-salir:hover {
		border-color: var(--au-primary);
		background: var(--au-tint);
	}
	.barra-salir svg {
		width: 16px;
		height: 16px;
	}

	/* ═══ Cuerpo ═══ */
	.cuerpo {
		flex: 1;
		padding: 1rem 1rem 2rem;
	}
	@media (min-width: 768px) {
		.cuerpo {
			padding: 1.5rem 1.5rem 2.5rem;
		}
	}
	.contenido {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ═══ Carpetas: rejilla fluida, una tarjeta por tipo y año ═══ */
	.carpetas {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
		gap: 1rem;
	}
	.carpeta {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--au-surface);
		border: 1.5px solid var(--au-border);
		border-radius: 20px;
	}
	.carpeta-cabecera {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.carpeta-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: var(--au-tint);
		color: var(--au-primary-strong);
		flex-shrink: 0;
	}
	.carpeta-icono svg {
		width: 20px;
		height: 20px;
	}
	.carpeta-texto {
		min-width: 0;
	}
	.carpeta-nombre {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--au-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.carpeta-conteo {
		margin: 0.1rem 0 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--au-muted);
	}

	.docs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.doc {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.75rem;
		border-radius: 14px;
		background: var(--au-bg);
		border: 1.5px solid transparent;
		transition: border-color 0.2s ease;
	}
	.doc:hover {
		border-color: var(--au-primary);
	}
	.doc-ext {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.6rem;
		height: 2.6rem;
		padding: 0 0.4rem;
		border-radius: 10px;
		background: var(--au-dark);
		color: var(--au-eyebrow);
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 0.08em;
		flex-shrink: 0;
	}
	.doc-info {
		min-width: 0;
		flex: 1;
	}
	.doc-nombre {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: var(--au-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.doc-meta {
		margin: 0.15rem 0 0;
		font-size: 0.76rem;
		color: var(--au-muted);
	}
	.doc-sep {
		margin: 0 0.3rem;
		opacity: 0.6;
	}
	.doc-abrir {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 12px;
		background: var(--au-primary);
		color: #ffffff;
		box-shadow: var(--shadow-btn);
		flex-shrink: 0;
		transition:
			background-color 0.2s ease,
			transform 0.15s ease;
	}
	.doc-abrir:hover {
		background: var(--au-primary-strong);
	}
	.doc-abrir:active {
		transform: scale(0.96);
	}
	.doc-abrir svg {
		width: 18px;
		height: 18px;
	}

	/* ═══ Nota de verificación ═══ */
	.nota {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.9rem 1rem;
		border-radius: 16px;
		background: var(--au-tint);
		border: 1.5px solid rgba(var(--au-primary-rgb), 0.25);
		color: var(--au-dark);
	}
	.nota-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: var(--au-surface);
		color: var(--au-primary-strong);
		flex-shrink: 0;
	}
	.nota-icono svg {
		width: 18px;
		height: 18px;
	}
	.nota-titulo {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 800;
	}
	.nota-texto {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--au-primary-strong);
		max-width: 44rem;
	}
	.nota-texto strong {
		color: var(--au-dark);
		font-weight: 800;
	}

	/* ═══ Estados con mascota (sin acceso, error, vacío) ═══ */
	.estado {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 1.5rem 1.25rem;
		background: var(--au-surface);
		border: 1.5px solid var(--au-border);
		border-radius: 24px;
		overflow: hidden;
	}
	@media (min-width: 768px) {
		.estado {
			padding: 2rem 2rem 2rem;
			padding-right: 13rem;
		}
	}
	.estado-mascota {
		display: none;
		position: absolute;
		right: 0.5rem;
		bottom: -0.5rem;
		width: 10rem;
		height: 10rem;
		object-fit: contain;
		pointer-events: none;
	}
	@media (min-width: 768px) {
		.estado-mascota {
			display: block;
		}
	}
	.estado-badge {
		display: inline-block;
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--cert-info);
		background: var(--cert-info-soft);
	}
	.estado--peligro .estado-badge {
		color: var(--au-danger);
		background: var(--au-danger-soft);
	}
	.estado--aviso .estado-badge {
		color: var(--cert-aviso);
		background: var(--cert-aviso-soft);
	}
	.estado-titulo {
		margin: 0;
		font-size: clamp(1.3rem, 3vw, 1.7rem);
		font-weight: 800;
		letter-spacing: -0.025em;
		color: var(--au-text);
	}
	.estado-texto {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--au-muted);
		max-width: 44rem;
	}
	.estado-texto strong {
		color: var(--au-dark);
		font-weight: 800;
	}
	.estado-detalle {
		margin: 0;
		padding: 0.7rem 0.9rem;
		border-radius: 12px;
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--cert-info);
		background: var(--cert-info-soft);
		max-width: 44rem;
	}
	.estado--peligro .estado-detalle {
		color: var(--au-danger);
		background: var(--au-danger-soft);
	}
	.estado--aviso .estado-detalle {
		color: var(--cert-aviso);
		background: var(--cert-aviso-soft);
	}
	.estado-acciones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.5rem;
	}

	/* ═══ Pie ═══ */
	.pie {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding: 1rem 1rem 1.25rem;
		border-top: 1px solid var(--au-border);
		font-size: 0.75rem;
		color: var(--au-muted);
	}
	@media (min-width: 768px) {
		.pie {
			padding: 1rem 1.5rem 1.25rem;
		}
	}
	.pie p {
		margin: 0;
	}
	.pie-meta {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
	}
	.pie-punto {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--au-primary);
		box-shadow: 0 0 0 3px rgba(var(--au-primary-rgb), 0.15);
	}

	@media (prefers-reduced-motion: reduce) {
		.doc,
		.doc-abrir,
		.barra-salir {
			transition: none !important;
		}
	}
</style>
