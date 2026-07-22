<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { CAMPOS, SECCIONES, TABLAS, type CampoDefinicion } from '$lib/api/sarlaftFields';

	export let respuestas: Record<string, any> = {};
	export let tipoCliente: 'Persona Natural' | 'Persona Jurídica' | null = null;
	export let tipoFormulario: 'cliente_proveedor' | 'accionistas' | 'personal' = 'cliente_proveedor';

	// ───────── Formatters ─────────
	function formatMoneda(value: any): string {
		const num = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : 0;
		if (isNaN(num) || num === 0) return '—';
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(num);
	}

	function formatNumero(value: any): string {
		const num = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : 0;
		if (isNaN(num)) return '—';
		return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(num);
	}

	function formatPorcentaje(value: any): string {
		const num = typeof value === 'string' ? parseFloat(value) : typeof value === 'number' ? value : 0;
		if (isNaN(num)) return '—';
		return `${num}%`;
	}

	function formatFecha(value: any): string {
		if (!value || value === '—') return '—';
		if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
			const [y, m, d] = value.split('-');
			return `${d}/${m}/${y}`;
		}
		if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
		return value;
	}

	function formatSiNo(value: any): { texto: string; color: 'yes' | 'no' } {
		const v = String(value).trim().toLowerCase();
		if (v === 'sí' || v === 'si' || v === 's' || v === 'yes' || v === 'true' || v === '1') {
			return { texto: 'Sí', color: 'yes' };
		}
		if (v === 'no' || v === 'n' || v === 'false' || v === '0') {
			return { texto: 'No', color: 'no' };
		}
		return { texto: String(value), color: 'no' };
	}

	function formatOpcion(value: any, opciones?: string[]): string {
		if (!value) return '—';
		if (opciones?.includes(value)) return value;
		return String(value);
	}

	function esFirmaBase64(value: any): boolean {
		if (typeof value !== 'string') return false;
		return /^data:image\/(png|jpe?g|webp);base64,/i.test(value);
	}

	function formatValue(field: CampoDefinicion, value: any): { display: string; type: 'text' | 'money' | 'number' | 'date' | 'yesno' | 'firma' | 'option' } {
		if (field.tipo === 'firma') {
			if (value && esFirmaBase64(value)) {
				return { display: 'Firma capturada en formulario', type: 'firma' };
			}
			if (!value) return { display: '—', type: 'firma' };
			return { display: 'Firma capturada en formulario', type: 'firma' };
		}

		if (value === null || value === undefined || value === '') {
			return { display: '—', type: 'text' };
		}

		if (esFirmaBase64(value)) {
			return { display: 'Firma capturada en formulario', type: 'firma' };
		}

		switch (field.tipo) {
			case 'moneda':
				return { display: formatMoneda(value), type: 'money' };
			case 'numero':
				return { display: formatNumero(value), type: 'number' };
			case 'porcentaje':
				return { display: formatPorcentaje(value), type: 'number' };
			case 'fecha':
				return { display: formatFecha(value), type: 'date' };
			case 'si_no':
				return { display: formatSiNo(value).texto, type: 'yesno' };
			case 'opcion':
				return { display: formatOpcion(value, field.opciones), type: 'option' };
			default:
				return { display: String(value), type: 'text' };
		}
	}

	// ───────── Detección de secciones visibles ─────────
	function esSeccionVisible(seccion: typeof SECCIONES[number]): boolean {
		const id = seccion.id;
		if (id === 'persona-natural' && tipoCliente === 'Persona Jurídica') return false;
		if (id === 'persona-juridica' && tipoCliente === 'Persona Natural') return false;
		if (id === 'empresa' && tipoFormulario !== 'accionistas') return false;
		if (id === 'informacion-personal' && tipoFormulario !== 'personal') return false;
		if ((id === 'jurisdiccion' || id === 'domicilio') && tipoFormulario !== 'cliente_proveedor') return false;
		return true;
	}

	interface CampoRender {
		def: CampoDefinicion;
		value: any;
		formatted: ReturnType<typeof formatValue>;
	}

	interface SeccionRender {
		id: string;
		titulo: string;
		descripcion: string;
		campos: CampoRender[];
		tablas: Array<{ key: string; titulo: string; filas: any[]; campos: string[] }>;
	}

	function buildSecciones(): SeccionRender[] {
		const result: SeccionRender[] = [];

		for (const seccion of SECCIONES) {
			if (!esSeccionVisible(seccion)) continue;

			const campos: CampoRender[] = [];
			for (const campoId of seccion.campos) {
				const keys = [`CLI-${campoId}`, `PER-${campoId}`, `ACC-${campoId}`];
				let value: any = undefined;
				let defKey = '';
				for (const k of keys) {
					if (respuestas[k] !== undefined) {
						value = respuestas[k];
						defKey = campoId;
						break;
					}
				}
				if (value === undefined) continue;
				const def = CAMPOS[defKey];
				if (!def) continue;
				campos.push({ def, value, formatted: formatValue(def, value) });
			}

			const tablas: SeccionRender['tablas'] = [];
			for (const [tablaKey, tablaDef] of Object.entries(TABLAS)) {
				if (tablaDef.seccionId !== seccion.id) continue;
				const filas = respuestas[tablaKey];
				if (!Array.isArray(filas) || filas.length === 0) continue;
				tablas.push({ key: tablaKey, titulo: tablaDef.titulo, filas, campos: tablaDef.campos });
			}

			if (campos.length === 0 && tablas.length === 0) continue;

			result.push({
				id: seccion.id,
				titulo: seccion.titulo,
				descripcion: seccion.descripcion,
				campos,
				tablas
			});
		}

		return result;
	}

	$: seccionesRender = buildSecciones();

	function getColorYesNo(color: 'yes' | 'no') {
		return color === 'yes' ? 'pill-yes' : 'pill-no';
	}

	function textoRegistros(n: number): string {
		return n === 1 ? 'registro' : 'registros';
	}
</script>

<div class="respuestas">
	{#each seccionesRender as seccion, sIdx (seccion.id)}
		<section class="seccion" in:fade={{ duration: 200, delay: sIdx * 50 }}>
			<header class="seccion-head">
				<div class="seccion-head-text">
					<span class="seccion-eyebrow">Sección {String(sIdx + 1).padStart(2, '0')}</span>
					<h3>{seccion.titulo}</h3>
					{#if seccion.descripcion}
						<p>{seccion.descripcion}</p>
					{/if}
				</div>
			</header>

			<div class="seccion-body">
				{#if seccion.campos.length > 0}
					<dl class="campos-grid">
						{#each seccion.campos as campo (campo.def.id)}
							<div class="campo" class:campo--destacado={campo.def.destacado}>
								<dt>{campo.def.etiqueta}</dt>
								<dd>
									{#if campo.formatted.type === 'money'}
										<span class="valor-moneda">{campo.formatted.display}</span>
									{:else if campo.formatted.type === 'yesno'}
										{@const sn = formatSiNo(campo.value)}
										<span class="pill {getColorYesNo(sn.color)}">
											{#if sn.color === 'yes'}
												<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.4">
													<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
												</svg>
											{:else}
												<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.4">
													<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
												</svg>
											{/if}
											{sn.texto}
										</span>
									{:else if campo.formatted.type === 'date'}
										<span class="valor-fecha">{campo.formatted.display}</span>
									{:else if campo.formatted.type === 'firma'}
										<div class="firma-display">
											{#if esFirmaBase64(campo.value)}
												<div class="firma-imagen-wrap">
													<img
														src={campo.value}
														alt="Firma capturada en el formulario"
														class="firma-imagen"
													/>
												</div>
											{:else}
												<span class="firma-chip-empty">
													<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
														<path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
													</svg>
													Sin firma capturada
												</span>
											{/if}
											<div class="firma-acciones">
												{#if esFirmaBase64(campo.value)}
													<a
														href={campo.value}
														target="_blank"
														rel="noopener noreferrer"
														class="firma-link"
													>
														<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
															<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 21v-4.5m0 4.5h4.5m-4.5 0L9 15M21 9V4.5m0 0h-4.5m4.5 0L15 9m0 6v4.5m0-4.5h-4.5m4.5 0L15 15" />
														</svg>
														Ver tamaño completo
													</a>
												{/if}
												<span class="firma-meta">Firma digital capturada en el formulario</span>
											</div>
										</div>
									{:else if campo.formatted.type === 'number'}
										<span class="valor-numero">{campo.formatted.display}</span>
									{:else if campo.formatted.type === 'option'}
										<span class="valor-opcion">{campo.formatted.display}</span>
									{:else}
										<span class="valor-texto">{campo.formatted.display}</span>
									{/if}
								</dd>
							</div>
						{/each}
					</dl>
				{/if}

				{#each seccion.tablas as tabla, tIdx (tabla.key)}
					<div class="tabla-bloque" in:fly={{ y: 8, duration: 280, delay: 80 + tIdx * 40, easing: quintOut }}>
						<header class="tabla-head">
							<div class="tabla-head-left">
								<span class="tabla-icon" aria-hidden="true">
									<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
										<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
									</svg>
								</span>
								<div>
									<span class="tabla-eyebrow">Tabla repetible</span>
									<h4>{tabla.titulo}</h4>
								</div>
							</div>
							<span class="badge-count">
								{tabla.filas.length}
								{textoRegistros(tabla.filas.length)}
							</span>
						</header>

						<div class="tabla-scroll">
							<table>
								<thead>
									<tr>
										{#each tabla.campos as campoId}
											{@const def = CAMPOS[campoId]}
											{#if def}
												<th>{def.etiqueta}</th>
											{/if}
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each tabla.filas as fila, i}
										<tr>
											{#each tabla.campos as campoId}
												{@const def = CAMPOS[campoId]}
												{@const val = fila[campoId]}
												{#if def}
													<td>
														{#if def.tipo === 'moneda' && val}
															<span class="valor-moneda">{formatMoneda(val)}</span>
														{:else if def.tipo === 'porcentaje' && val}
															<span class="valor-numero">{formatPorcentaje(val)}</span>
														{:else if def.tipo === 'si_no' && val}
															{@const sn = formatSiNo(val)}
															<span class="pill {getColorYesNo(sn.color)}">
																{#if sn.color === 'yes'}
																	<svg class="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
																		<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
																	</svg>
																{:else}
																	<svg class="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
																		<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
																	</svg>
																{/if}
																{sn.texto}
															</span>
														{:else if def.tipo === 'firma' || esFirmaBase64(val)}
															<span class="firma-chip-sm">Firma</span>
														{:else}
															{val ?? '—'}
														{/if}
													</td>
												{/if}
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.respuestas {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   SECTION
	   ═══════════════════════════════════════════════════════════════ */
	.seccion {
		background: white;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 20px;
		overflow: hidden;
	}

	.seccion-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.1rem 1.25rem;
		background: linear-gradient(180deg, #faf7f2 0%, white 100%);
		border-bottom: 1px solid rgba(0, 0, 0, 0.05);
	}
	.seccion-head-text {
		flex: 1;
	}
	.seccion-eyebrow {
		display: inline-block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #f97316;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.18rem 0.55rem;
		border-radius: 4px;
		margin-bottom: 0.4rem;
	}
	.seccion-head h3 {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.2rem;
		font-weight: 500;
		color: #0f1f1a;
		margin: 0 0 0.2rem;
		letter-spacing: -0.01em;
		line-height: 1.25;
	}
	.seccion-head p {
		font-size: 0.8rem;
		color: #6b6b6b;
		margin: 0;
		line-height: 1.5;
	}

	.seccion-body {
		padding: 1.1rem 1.25rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ═══════════════════════════════════════════════════════════════
	   CAMPOS GRID
	   ═══════════════════════════════════════════════════════════════ */
	.campos-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.85rem;
		margin: 0;
	}
	@media (min-width: 640px) {
		.campos-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.campo {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.7rem 0.85rem;
		background: #faf7f2;
		border-radius: 10px;
		border-left: 2px solid transparent;
		transition: all 0.2s;
	}
	.campo:hover {
		background: white;
		border-color: rgba(0, 0, 0, 0.08);
	}
	.campo--destacado {
		background: rgba(249, 115, 22, 0.05);
		border-left-color: #f97316;
	}
	.campo--destacado:hover {
		background: rgba(249, 115, 22, 0.08);
		border-left-color: #f97316;
	}

	.campo dt {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.66rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #6b6b6b;
		margin: 0;
	}
	.campo dd {
		margin: 0;
		font-size: 0.92rem;
		color: #1a1a1a;
		line-height: 1.4;
	}

	/* Tipos de valor */
	.valor-texto {
		font-weight: 500;
		word-break: break-word;
		color: #0f1f1a;
	}
	.valor-opcion {
		display: inline-flex;
		font-family: 'Inter Tight', system-ui, sans-serif;
		font-size: 0.85rem;
		font-weight: 600;
		color: #0f1f1a;
	}
	.valor-moneda {
		font-weight: 700;
		color: #047857;
		font-variant-numeric: tabular-nums;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.9rem;
	}
	.valor-numero {
		font-weight: 600;
		color: #0f1f1a;
		font-variant-numeric: tabular-nums;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.88rem;
	}
	.valor-fecha {
		font-weight: 600;
		color: #0f1f1a;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.88rem;
	}

	/* Pill sí/no */
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.2rem 0.55rem;
		border-radius: 5px;
		border: 1px solid;
	}
	.pill-yes {
		color: #047857;
		background: rgba(249, 115, 22, 0.1);
		border-color: rgba(249, 115, 22, 0.25);
	}
	.pill-no {
		color: #4a4a4a;
		background: rgba(0, 0, 0, 0.04);
		border-color: rgba(0, 0, 0, 0.08);
	}

	/* ═══════════════════════════════════════════════════════════════
	   FIRMA
	   ═══════════════════════════════════════════════════════════════ */
	.firma-display {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		grid-column: 1 / -1;
	}
	.firma-imagen-wrap {
		background: #faf7f2;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-bottom: 2px solid #1a1a1a;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: inline-block;
		max-width: 360px;
		min-height: 90px;
	}
	.firma-imagen {
		display: block;
		max-width: 100%;
		max-height: 100px;
		width: auto;
		height: auto;
	}
	.firma-acciones {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.firma-link {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.55rem;
		background: white;
		color: #4338ca;
		border: 1px solid #c7d2fe;
		border-radius: 6px;
		font-size: 0.72rem;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.2s;
		font-family: 'Inter Tight', system-ui, sans-serif;
	}
	.firma-link:hover {
		background: #eef2ff;
		border-color: #818cf8;
	}
	.firma-link svg {
		width: 12px;
		height: 12px;
	}
	.firma-meta {
		color: #6366f1;
		font-size: 0.72rem;
	}
	.firma-chip-empty {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.65rem;
		background: #f3f4f6;
		color: #6b7280;
		border: 1px dashed #d1d5db;
		border-radius: 6px;
		font-size: 0.78rem;
	}
	.firma-chip-empty svg {
		width: 14px;
		height: 14px;
	}
	.firma-chip-sm {
		display: inline-flex;
		padding: 0.1rem 0.4rem;
		background: #eef2ff;
		color: #4338ca;
		border: 1px solid #c7d2fe;
		border-radius: 4px;
		font-size: 0.65rem;
		font-weight: 600;
		font-family: 'JetBrains Mono', monospace;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* ═══════════════════════════════════════════════════════════════
	   TABLAS REPETIBLES
	   ═══════════════════════════════════════════════════════════════ */
	.tabla-bloque {
		background: #faf7f2;
		border: 1px solid rgba(0, 0, 0, 0.06);
		border-radius: 14px;
		overflow: hidden;
	}
	.tabla-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.9rem 1.1rem;
		background: white;
		border-bottom: 1px solid rgba(0, 0, 0, 0.05);
	}
	.tabla-head-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.tabla-icon {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: rgba(249, 115, 22, 0.1);
		color: #f97316;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.tabla-icon svg {
		width: 16px;
		height: 16px;
	}
	.tabla-eyebrow {
		display: inline-block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #f97316;
		margin-bottom: 0.15rem;
	}
	.tabla-head h4 {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 0.95rem;
		font-weight: 500;
		color: #0f1f1a;
		margin: 0;
		line-height: 1.2;
	}
	.badge-count {
		display: inline-flex;
		align-items: center;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.68rem;
		font-weight: 700;
		color: #065f46;
		background: rgba(249, 115, 22, 0.1);
		padding: 0.25rem 0.55rem;
		border-radius: 5px;
	}

	.tabla-scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
		font-size: 0.78rem;
		border-collapse: collapse;
	}
	thead {
		background: rgba(0, 0, 0, 0.02);
	}
	th {
		text-align: left;
		padding: 0.55rem 0.85rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.64rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #6b6b6b;
		white-space: nowrap;
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	td {
		padding: 0.65rem 0.85rem;
		border-top: 1px solid rgba(0, 0, 0, 0.04);
		vertical-align: top;
		color: #1a1a1a;
	}
	tbody tr:hover {
		background: rgba(249, 115, 22, 0.03);
	}
</style>
