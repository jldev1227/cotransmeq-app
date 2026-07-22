<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import type { ConceptoDescuento } from '$lib/api/liquidaciones-terceros-descuentos';
	import firmaCamiloUrl from '$lib/assets/Firma Camilo Cepeda.jpg';

	export let item: any;

	const BACK_URL = '/dashboard/liquidaciones-terceros';

	const MESES = [
		'ENERO',
		'FEBRERO',
		'MARZO',
		'ABRIL',
		'MAYO',
		'JUNIO',
		'JULIO',
		'AGOSTO',
		'SEPTIEMBRE',
		'OCTUBRE',
		'NOVIEMBRE',
		'DICIEMBRE'
	];

	const COP = (v: number | string) =>
		new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(parseFloat(String(v)) || 0);

	function fmtPlaca(p: string) {
		const s = (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		const m = s.match(/^([A-Z]+)(\d+)$/);
		return m ? `${m[1]}-${m[2]}` : s;
	}

	function fmtPct(v: number | null | undefined): string {
		if (v == null) return '';
		return v.toFixed(1) + '%';
	}

	function fmtFechaCO(v: any): string {
		if (!v) return '—';
		const s = String(v).trim();
		if (!s) return '—';
		const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (m) return `${m[3]}/${m[2]}/${m[1]}`;
		const d = new Date(s);
		if (isNaN(d.getTime())) return s;
		const dd = String(d.getUTCDate()).padStart(2, '0');
		const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
		const yy = d.getUTCFullYear();
		return `${dd}/${mm}/${yy}`;
	}
	function fmtDias(v: number | null | undefined): string {
		if (v == null || v === 0) return '';
		return String(v);
	}

	function getEstadoBadge(estado: string) {
		const map: Record<string, { bg: string; text: string; border: string; label: string }> = {
			BORRADOR: { bg: 'rgba(0,0,0,0.04)', text: '#4a4a4a', border: 'rgba(0,0,0,0.10)', label: 'Borrador' },
			LIQUIDADA: { bg: 'rgba(59,130,246,0.08)', text: '#1d4ed8', border: 'rgba(59,130,246,0.25)', label: 'Liquidada' },
			APROBADA: { bg: 'rgba(249, 115, 22, 0.10)', text: '#047857', border: 'rgba(249, 115, 22, 0.28)', label: 'Aprobada' },
			FACTURADA: { bg: 'rgba(139,92,246,0.10)', text: '#6d28d9', border: 'rgba(139,92,246,0.28)', label: 'Facturada' },
			ANULADA: { bg: 'rgba(220,38,38,0.06)', text: '#b91c1c', border: 'rgba(220,38,38,0.25)', label: 'Anulada' }
		};
		return map[estado] || map.BORRADOR;
	}

	function getNumeroFactura(liq: any): string {
		const items = liq?.factura_items || [];
		for (const fi of items) {
			if (fi?.factura?.numero_factura) return fi.factura.numero_factura;
		}
		return '';
	}

	function getLaborales(conceptos: ConceptoDescuento[]) {
		return conceptos.filter((c) => c.tipo === 'COSTO_LABORAL');
	}
	function getGastos(conceptos: ConceptoDescuento[]) {
		return conceptos.filter((c) => c.tipo === 'GASTO_OPERATIVO');
	}
	function getImpuestos(conceptos: ConceptoDescuento[]) {
		return conceptos.filter((c) => c.tipo === 'IMPUESTO');
	}
	function getAnticipos(conceptos: ConceptoDescuento[]) {
		return conceptos.filter((c) => c.tipo === 'ANTICIPO');
	}

	let pdfZoom = 0.6;
	let logoError = false;
	let viewportWidth = 0;
	let pageScaledHeight = 1200;
	let pageEl: HTMLElement | null = null;
	let pdfLoading = false;
	let pageObserver: ResizeObserver | null = null;

	function fmtPlanillas(v: any): string {
		if (v == null) return '';
		if (Array.isArray(v)) {
			return v
				.filter(Boolean)
				.map(String)
				.map((x) => x.replace(/^["']+|["']+$/g, ''))
				.filter(Boolean)
				.join(' / ');
		}
		const s = String(v)
			.trim()
			.replace(/^["']+|["']+$/g, '');
		if (!s) return '';
		if (s.includes(','))
			return s
				.split(',')
				.map((x) => x.trim().replace(/^["']+|["']+$/g, ''))
				.filter(Boolean)
				.join(' / ');
		if (s.includes('|'))
			return s
				.split('|')
				.map((x) => x.trim().replace(/^["']+|["']+$/g, ''))
				.filter(Boolean)
				.join(' / ');
		const tokens = s
			.split(/\s+/)
			.map((x) => x.replace(/^["']+|["']+$/g, ''))
			.filter(Boolean);
		if (tokens.length >= 2) {
			return tokens.join(' / ');
		}
		return s;
	}

	function updateViewport() {
		if (typeof window === 'undefined') return;
		viewportWidth = window.innerWidth;
	}

	function measurePage() {
		if (!pageEl) return;
		pageScaledHeight = pageEl.scrollHeight * pdfZoom;
	}

	const EXTENDED_WIDTH_PX = 2480;

	function fitToViewport() {
		if (typeof window === 'undefined' || viewportWidth <= 0) return;
		const padding = 80;
		const available = Math.max(280, viewportWidth - padding);
		const target = available * 0.96;
		pdfZoom = Math.max(0.3, Math.min(2.5, target / EXTENDED_WIDTH_PX));
	}

	$: if (pdfZoom != null && typeof window !== 'undefined') {
		requestAnimationFrame(measurePage);
	}

	function pageObserve(node: HTMLElement) {
		pageEl = node;
		pageObserver = new ResizeObserver(() => measurePage());
		pageObserver.observe(node);
		setTimeout(measurePage, 30);
		return {
			destroy() {
				if (pageObserver) {
					pageObserver.disconnect();
					pageObserver = null;
				}
			}
		};
	}

	async function getLogoBase64(): Promise<string> {
		try {
			const res = await fetch('/assets/logo_nombre.png');
			if (!res.ok) throw new Error('logo fetch failed');
			const blob = await res.blob();
			return await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result as string);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			});
		} catch (e) {
			console.warn('No se pudo cargar el logo, continuando sin él:', e);
			return '';
		}
	}

	async function getFirmaBase64(path: string): Promise<string> {
		try {
			const res = await fetch(path);
			if (!res.ok) throw new Error(`firma fetch failed: ${path}`);
			const blob = await res.blob();
			return await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result as string);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			});
		} catch (e) {
			console.warn(`No se pudo cargar la firma (${path}), continuando sin ella:`, e);
			return '';
		}
	}

	async function buildPrintableHtml(): Promise<string> {
		const pageEl = document.querySelector('.page') as HTMLElement | null;
		if (!pageEl) return '';

		const inlineStyles = Array.from(document.querySelectorAll('style'))
			.map((s) => s.textContent || '')
			.filter(Boolean)
			.join('\n');

		const linkHrefs: string[] = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
			.map((l) => (l as HTMLLinkElement).href)
			.filter((h): h is string => !!h && !h.startsWith('data:'));

		const fetchedStyles = await Promise.all(
			linkHrefs.map(async (href) => {
				try {
					const res = await fetch(href, { credentials: 'include' });
					if (!res.ok) return '';
					return await res.text();
				} catch (e) {
					console.warn('No se pudo cargar stylesheet:', href, e);
					return '';
				}
			})
		);

		const printStyles = [inlineStyles, ...fetchedStyles.filter(Boolean)]
			.map((css) => `<style>${css}</style>`)
			.join('\n');

		const item = (window as any).__pdfItem || {};
		const title = `Liquidacion ${item?.consecutivo || ''} ${item?.placa || ''}`.trim();

		const logoDataUrl = await getLogoBase64();
		const firmaCamiloDataUrl = await getFirmaBase64(firmaCamiloUrl);

		const clone = pageEl.cloneNode(true) as HTMLElement;
		clone.querySelectorAll('img[src*="/assets/logo_nombre.png"]').forEach((img) => {
			if (logoDataUrl) {
				(img as HTMLImageElement).src = logoDataUrl;
			}
		});
		clone.querySelectorAll('img[data-firma="camilo"]').forEach((img) => {
			if (firmaCamiloDataUrl) {
				(img as HTMLImageElement).src = firmaCamiloDataUrl;
			} else {
				// Si no se carga la firma, ocultamos la imagen para que no quede roto
				(img as HTMLImageElement).style.display = 'none';
			}
		});

		clone.querySelectorAll('table.terc-prev-tbl').forEach((tbl) => {
			const tfoot = tbl.querySelector('tfoot');
			if (tfoot && tfoot.parentElement) {
				const tbody = tbl.querySelector('tbody') || tfoot.parentElement;
				while (tfoot.firstChild) {
					if (tfoot.firstChild.nodeType === 1) {
						const tr = tfoot.firstChild as HTMLElement;
						tr.classList.add('totales-row');
						tr.setAttribute(
							'style',
							'font-weight:600 !important; font-size:8pt !important; padding:3px 6px !important; background:#e2e8f0 !important; white-space:nowrap !important;'
						);
						tr.querySelectorAll('td').forEach((td, i) => {
							const t = td as HTMLElement;
							const base =
								'font-size:8pt !important; font-weight:600 !important; padding:3px 6px !important; background:#e2e8f0 !important; white-space:nowrap !important;';
							let extra = '';
							if (i === 0) {
								extra = 'text-align:right !important; padding-right:6px !important;';
							} else if (i === 1) {
								extra = 'text-align:right !important;';
							} else if (i === 4) {
								extra = 'text-align:right !important; color:#b91c1c !important;';
							} else if (i === 5) {
								extra = 'text-align:right !important;';
							} else if (i === 6) {
								extra = 'text-align:right !important; color:#ea580c !important;';
							} else {
								extra = 'text-align:center !important;';
							}
							t.setAttribute('style', `${base} ${extra}`);
						});
					}
					tbody.appendChild(tfoot.firstChild);
				}
				tfoot.remove();
			}
		});

		return `
			<!DOCTYPE html>
				<html lang="es">
					<head>
						<meta charset="UTF-8">
						<title>${title}</title>
						${printStyles}
						<style>
							html, body { margin: 0; padding: 0; background: #fff; }
							body { padding: 0; }
							.pdf-wrap { position: static !important; background: #fff !important; inset: auto !important; height: auto !important; overflow: visible !important; }
							.pdf-body { padding: 0 !important; overflow: visible !important; height: auto !important; display: block !important; background: #fff !important; }
							.page-scale-wrap { width: auto !important; height: auto !important; position: static !important; overflow: visible !important; }
							.page { position: static !important; display: block !important; transform: none !important; box-shadow: none !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; }
							.no-print { display: none !important; }
							html, body { width: 100% !important; margin: 0 !important; padding: 0 !important; }
							.pdf-wrap, .pdf-body, .page-scale-wrap { width: 100% !important; max-width: none !important; display: block !important; }
							.page { width: 100% !important; max-width: none !important; padding: 0 14mm !important; box-sizing: border-box !important; }
							/* Compactar celdas de la tabla principal para que entre la fila TOTALES en página 1 */
							.terc-prev-tbl td { padding: 3px 4px !important; }
							.terc-prev-tbl th { padding: 3px 4px !important; }
							.terc-prev-tbl tbody td { font-size: 10pt !important; line-height: 1.2 !important; }
							.terc-prev-tbl th { font-size: 9pt !important; line-height: 1.2 !important; }
							/* Evitar que la fila TOTALES quede huérfana al final de la última página con items.
							   page-break-before: avoid la mantiene junto a la última fila de items. */
							.totales-row { page-break-before: avoid !important; break-before: avoid !important; page-break-after: avoid !important; }
							/* Títulos de gastos/anticipos/impuestos: sin fondo, solo border-left, padding y alto reducidos */
							.desc-block-title { background: transparent !important; padding: 2px 8px !important; margin: 0 0 4px !important; border-radius: 0 !important; font-size: 13px !important; line-height: 1.2 !important; }
							.desc-block-gastos .desc-block-title,
							.desc-block-anticipos .desc-block-title,
							.desc-block-impuestos .desc-block-title { background: transparent !important; }
							/* Firmas: ambos .sig mismo height, imagen absoluta centrada, placeholder ::before
							   para reservar el espacio de la imagen en ambos divs (alineados) */
							.sigs { display: grid !important; grid-template-columns: 1fr 1fr !important; align-items: stretch !important; }
							.sig { position: relative !important; margin-top: 5px; min-height: 150px !important; height: 150px !important; padding: 8px 12px 14px !important; align-items: center !important; justify-content: center !important; }
							.sig-img { position: absolute !important; top: -16px !important; left: 50% !important; transform: translateX(-50%) !important; max-height: 80px !important; max-width: 260px !important; padding: 0 !important; margin: 0 !important; }
							/* Placeholder invisible: reserva el mismo alto que la imagen en AMBOS .sig */
							.sig::before { content: "" !important; display: block !important; height: 80px !important; visibility: hidden !important; }
							.sig-lbl { margin-top: 2px !important; margin-bottom: 0 !important; align-self: center !important; text-align: center !important; order: 3 !important; font-size: 13px !important; }
							.sig-line { padding-top: 10px !important; text-align: center !important; }
							/* Resumen (TOTAL DESCUENTOS / TOTAL A PAGAR): texto plano inline, alineado a la derecha, 600px, sin estilos. */
							.desc-resumen { display: flex !important; flex-direction: row !important; justify-content: flex-end !important; gap: 30px !important; width: 600px !important; max-width: 600px !important; margin-top: 14px !important; margin-left: auto !important; margin-right: 0 !important; padding: 0 !important; background: transparent !important; border: none !important; border-radius: 0 !important; }
							.desc-resumen .resumen-line { display: flex !important; flex-direction: row !important; align-items: baseline !important; gap: 6px !important; padding: 0 !important; background: transparent !important; border: none !important; border-top: none !important; min-height: 0 !important; }
							.desc-resumen .resumen-line > span:first-child { font-weight: 800 !important; font-size: 13px !important; text-transform: uppercase !important; letter-spacing: 0.03em !important; background: transparent !important; border: none !important; padding: 0 !important; margin: 0 !important; }
							.desc-resumen .resumen-val { font-weight: 800 !important; font-size: 14px !important; font-family: 'Geist', sans-serif !important; background: transparent !important; border: none !important; padding: 0 !important; margin: 0 !important; }
							/* Diferenciar por color: TOTAL DESCUENTOS en rojo, TOTAL A PAGAR en verde */
							.desc-resumen .resumen-line:first-child > span:first-child { color: #991b1b !important; }
							.desc-resumen .resumen-line:first-child .resumen-val { color: #dc2626 !important; }
							.desc-resumen .resumen-line.resumen-pagar > span:first-child { color: #ea580c !important; }
							.desc-resumen .resumen-line.resumen-pagar .resumen-val { color: #ea580c !important; }
							/* Compactar conductores para que el bloque de gastos aproveche el espacio sobrante en pág 1.
							   Con auto-fit, 1 conductor = 1 col, 2 = 2 cols, 3 = 3 cols (sin columnas vacías). */
							.conductores-grid { display: grid !important; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)) !important; gap: 6px !important; margin-bottom: 4px !important; }
							.conductor-section { margin-bottom: 4px !important; }
							.conductor-name-row { padding: 3px 8px !important; font-size: 12px !important; }
							.conductor-name-val { font-size: 14px !important; }
							.conductor-id { font-size: 11px !important; padding: 1px 6px !important; }
							.desc-table { font-size: 12px !important; margin-top: 2px !important; }
							.desc-table th { padding: 4px 6px !important; font-size: 11px !important; }
							.desc-table td { padding: 3px 6px !important; }
							.concept-name { font-size: 12px !important; }
							.val-cell, .total-cell, .dias-static, .pct-cell { font-size: 12px !important; }
							.conductor-total-row { padding: 4px 8px !important; font-size: 13px !important; }
							.conductor-total-val { font-size: 13px !important; }
							/* Mantener el grid de conductores junto (no se rompe entre páginas) */
							.conductores-grid { page-break-inside: avoid !important; break-inside: avoid !important; }
							/* Reducir espacio entre celdas de headers de gastos/anticipos/impuestos */
							.desc-table th { padding: 3px 4px !important; font-size: 10.5px !important; letter-spacing: 0.02em !important; }
							.desc-table thead { margin-bottom: 0 !important; }
							.desc-table thead tr { line-height: 1.1 !important; }
							.desc-table { border-spacing: 0 !important; border-collapse: collapse !important; }
							/* Padding vertical de títulos reducido 25%: 2px → 1.5px */
							.desc-block-title { padding: 1px 8px !important; }
							/* Padding vertical de tfoot de gastos/anticipos/impuestos reducido 25%: 8px → 6px */
							.desc-table tfoot .desc-total-row td { padding: 6px 8px !important; }
							.resumen-line { display: flex !important; justify-content: space-between !important; align-items: center !important; padding: 3px 6px !important; font-size: 12px !important; font-weight: 800 !important; color: #0f172a !important; text-transform: uppercase !important; background: transparent !important; border-top: 1.5px solid #e2e8f0 !important; border-radius: 0 !important; letter-spacing: 0.03em !important; }
							.resumen-line:first-child { background: transparent !important; color: #991b1b !important; border-top: 1.5px solid #fca5a5 !important; border-radius: 0 !important; }
							.resumen-line:first-child .resumen-val { color: #dc2626 !important; }
							.resumen-line.resumen-pagar { background: transparent !important; color: #ea580c !important; border-top: 1.5px solid #14532d !important; border-radius: 0 !important; }
							.resumen-pagar .resumen-val, .resumen-pagar-val { color: #ea580c !important; }
							.resumen-val { font-size: 12px !important; font-weight: 800 !important; font-family: 'Geist', sans-serif !important; }
							.resumen-red { color: #dc2626 !important; }
							/* Evitar que el <thead> se repita en cada salto de página (CSS Paged Media).
							   Default es 'table-header-group' que repite el header; con 'table-row-group' no se repite.
							   Recupera ~1 fila de espacio en tablas multi-página. */
							.print-sheet table.terc-prev-tbl > thead,
							.print-sheet table.desc-table > thead { display: table-row-group !important; }
							/* Header meta (Codigo / Version / Fecha): ultra compacto */
							.dh-meta .mt td { font-size: 7.5pt !important; padding: 1px 6px !important; line-height: 1.1 !important; }
							.dh-meta .ml { font-size: 7pt !important; padding: 1px 6px !important; }
							.dh-meta .mv { font-size: 8pt !important; }
							.dh-co { font-size: 9.5pt !important; line-height: 1.05 !important; }
							.dh-doc { font-size: 8.5pt !important; margin-top: 0px !important; line-height: 1.05 !important; }
							.dh-title { padding: 3px 10px !important; }
							.dh-logo { padding: 3px 8px !important; }
							.dh-logo img { height: 43px !important; }
							.dh { margin-bottom: 0 !important; }
							.pb { font-size: 9pt !important; margin-bottom: 0 !important; }
							.pb .pc { padding: 2px 4px !important; }
							.pb .pclabel { font-size: 8pt !important; }
							.pb .pcval { font-size: 9.5pt !important; }
						</style>
					</head>
					<body>
						${clone.outerHTML}
					</body>
				</html>
		`;
	}

	async function executePrint() {
		if (pdfLoading) return;
		pdfLoading = true;
		try {
			const html = await buildPrintableHtml();
			if (!html) {
				window.print();
				return;
			}

			const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:4000';
			const token =
				localStorage.getItem('transmeralda_token') || localStorage.getItem('token') || '';

			const item = (window as any).__pdfItem || {};
			const filename = `liquidacion_${item?.consecutivo || item?.id || Date.now()}`;

			const res = await fetch(`${API_URL}/api/pdf/from-html`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {})
				},
				body: JSON.stringify({
					html,
					landscape: true,
					marginMm: 0,
					format: 'Letter',
					filename
				})
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: res.statusText }));
				throw new Error(err.error || 'Error generando PDF');
			}

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');

			setTimeout(() => URL.revokeObjectURL(url), 60000);
		} catch (err: any) {
			console.error('Error generando PDF:', err);
			alert(
				'Error generando PDF: ' +
					(err?.message || err) +
					'\nUsando print del navegador como fallback.'
			);
			window.print();
		} finally {
			pdfLoading = false;
		}
	}

	$: badge = getEstadoBadge(item.estado || 'BORRADOR');

	$: pdfTotales = (() => {
		const items = item.items || [];
		const adicionales = Array.isArray(item.items_adicionales) ? item.items_adicionales : [];
		// Bruto = Σ (valor_unitario × cantidad) de los adicionales.
		// Es el TOTAL facturado (antes de admon).
		const adicionalesBruto = adicionales.reduce(
			(s: number, a: any) => s + ((a.valor_unitario || 0) * (a.cantidad || 1)),
			0
		);
		// ADMON de los adicionales: se calcula igual que para los items reales
		// (porcentaje_admin × valor_liquidar bruto / 100). Si el backend ya
		// guardó `valor_admin` lo respetamos; si no, lo computamos en el cliente.
		const adicionalesAdmon = adicionales.reduce((s: number, a: any) => {
			const vLiqGross = (a.valor_unitario || 0) * (a.cantidad || 1);
			const pct = Number(a.porcentaje_admin) || 0;
			const vAdmin = a.valor_admin != null ? a.valor_admin : Math.round((vLiqGross * pct) / 100);
			return s + (Number(vAdmin) || 0);
		}, 0);
		// Neto = bruto − admon (lo que efectivamente se liquida al tercero).
		const adicionalesNeto = adicionalesBruto - adicionalesAdmon;
		return {
			totalVUnidad:
				items.reduce((s: number, it: any) => s + (it.liquidacion_tercero?.valor_unitario || 0), 0) +
				adicionales.reduce((s: number, a: any) => s + (a.valor_unitario || 0), 0),
			totalCantidad:
				items.reduce((s: number, it: any) => s + (it.liquidacion_tercero?.cantidad || 0), 0) +
				adicionales.reduce((s: number, a: any) => s + (a.cantidad || 0), 0),
			totalAdmon:
				items.reduce(
					(s: number, it: any) => s + (it.liquidacion_tercero?.valor_admin || 0),
					0
				) + adicionalesAdmon,
			totalFacturado:
				items.reduce(
					(s: number, it: any) => s + (it.liquidacion_tercero?.total_facturado || 0),
					0
				) + adicionalesBruto,
			totalLiquidar:
				items.reduce((s: number, it: any) => s + (it.liquidacion_tercero?.valor_liquidar || 0), 0) +
				adicionalesNeto,
			totalIngresoExtraGlobal: items.reduce(
				(s: number, it: any) => s + (it.liquidacion_tercero?.ingreso_extra_global || 0),
				0
			),
			totalIngresosExtraAval: items.reduce(
				(s: number, it: any) => s + (it.liquidacion_tercero?.ingresos_extra_aval || 0),
				0
			),
			// El ingreso_empresa se REDUCE en el NETO de los adicionales
			// (cada fila virtual descuenta el valor_liquidar a Cotransmeq).
			totalIngresoEmpresa:
				items.reduce(
					(s: number, it: any) => s + (it.liquidacion_tercero?.ingreso_empresa || 0),
					0
				) - adicionalesNeto,
			adicionalesSum: adicionalesNeto
		};
	})();

	$: terceroInfo = (() => {
		const items = item?.items || [];
		for (const it of items) {
			const t = it?.liquidacion_tercero?.tercero;
			if (t && (t.nombre_completo || t.identificacion)) return t;
		}
		return item?.tercero || {};
	})();

	$: terceroDocLabel = terceroInfo?.tipo_persona === 'EMPRESA' ? 'NIT' : 'CC';

	function handleWheel(e: WheelEvent) {
		if (!(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		const delta = e.deltaY < 0 ? 0.05 : -0.05;
		pdfZoom = Math.max(0.3, Math.min(2.5, pdfZoom + delta));
	}

	onMount(() => {
		(window as any).__pdfItem = item;
		updateViewport();
		window.addEventListener('resize', updateViewport);
		window.addEventListener('wheel', handleWheel, { passive: false });
		setTimeout(() => {
			fitToViewport();
			setTimeout(measurePage, 60);
		}, 50);
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			(window as any).__pdfItem = null;
			window.removeEventListener('resize', updateViewport);
			window.removeEventListener('wheel', handleWheel);
		}
		if (pageObserver) {
			pageObserver.disconnect();
			pageObserver = null;
		}
	});
</script>

<div class="pdf-wrap">
	<!-- ── TOOLBAR ── -->
	<div class="pdf-bar no-print">
		<div class="pdf-bar-l">
			<img
				src="/assets/logo_nombre.png"
				alt="Cotransmeq"
				class="pb-logo"
				onerror={(e: any) => {
					e.currentTarget.style.display = 'none';
				}}
			/>
			<div class="pdf-bar-text">
				<div class="pb-t" style="font-family:'Geist',sans-serif;font-weight:700">
					Liquidación de Ingresos para Terceros
				</div>
				<div class="pb-s">
					<span class="code-badge" style="margin-right:6px;vertical-align:1px">GAF-FR-11</span>
					{item.consecutivo || '—'}
					&nbsp;·&nbsp;
					{item.mes ? MESES[item.mes - 1] : ''} {item.anio || ''}
					&nbsp;·&nbsp;
					<span class="font-mono" style="letter-spacing:0.04em">{fmtPlaca(item.placa)}</span>
				</div>
			</div>
		</div>
		<div class="pdf-bar-actions">
			<div class="zoom-controls">
				<button
					class="zoom-btn"
					onclick={() => (pdfZoom = Math.max(0.3, pdfZoom - 0.05))}
					title="Reducir zoom">−</button
				>
				<span class="zoom-label">{Math.round(pdfZoom * 100)}%</span>
				<button
					class="zoom-btn"
					onclick={() => (pdfZoom = Math.min(2.5, pdfZoom + 0.05))}
					title="Aumentar zoom">+</button
				>
				<button class="zoom-btn zoom-reset" onclick={() => (pdfZoom = 1)} title="Restablecer zoom"
					>↺</button
				>
				<button
					class="zoom-btn zoom-fit"
					onclick={() => fitToViewport()}
					title="Ajustar al ancho de pantalla">⤢</button
				>
			</div>
			<button class="pbtn pbtn-back" onclick={() => goto(BACK_URL)}>
				<svg
					class="pbtn-icon-svg"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					stroke-width="2"
					><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg
				>
				Volver al Listado
			</button>
			<button class="pbtn pbtn-print" onclick={executePrint} disabled={pdfLoading}>
				{#if pdfLoading}
					<span class="pbtn-spinner" aria-hidden="true"></span>
					<span class="pbtn-label-full">Generando PDF…</span>
					<span class="pbtn-label-short">…</span>
				{:else}
					<svg
						class="pbtn-icon-svg"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						stroke-width="2"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
						/></svg
					>
					<span class="pbtn-label-full">Imprimir / PDF</span>
					<span class="pbtn-label-short">PDF</span>
				{/if}
			</button>
		</div>
	</div>

	<!-- ── ESTADO BAR — strip editorial con Fraunces ── -->
	<div class="estado-bar no-print">
		<span
			class="status-pill"
			style="background:{badge.bg};color:{badge.text};border:1px solid {badge.border};font-size:11px;padding:3px 10px"
			>{badge.label}</span
		>
		<div class="estado-info-stack">
			<span class="estado-info">
				<span class="estado-info-icon">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/></svg
					>
				</span>
				<span class="estado-info-full"
					><span class="filter-field-label" style="font-size:0.6rem">Placa</span>
					<strong class="font-mono" style="letter-spacing:0.04em">{fmtPlaca(item.placa)}</strong></span
				>
			</span>
			<span class="estado-info">
				<span class="estado-info-icon">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
						/></svg
					>
				</span>
				<span class="estado-info-full">{item.tercero?.nombre_completo || '—'}</span>
			</span>
			<span class="estado-info">
				<span class="estado-info-icon">
					<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/></svg
					>
				</span>
				<span class="estado-info-full"
					><span class="filter-field-label" style="font-size:0.6rem">V/Liquidar</span>
					<strong
						class="font-mono"
						style="color:#065f46;font-weight:700;letter-spacing:0.02em"
						>{COP(pdfTotales.totalLiquidar)}</strong
					></span
				>
			</span>
		</div>
	</div>

	<!-- ── EXTENDED PAGE (B4-like) for screen, A4 for print ── -->
	<div class="pdf-body print-sheet">
		<div
			class="page-scale-wrap"
			style="width: {EXTENDED_WIDTH_PX * pdfZoom}px; height: {pageScaledHeight}px;"
		>
			<div
				class="page"
				bind:this={pageEl}
				use:pageObserve
				style="transform: scale({pdfZoom}); transform-origin: top left;"
			>
				<!-- Header -->
				<div class="dh">
					<div class="dh-logo">
						{#if logoError}<div class="dh-logo-fallback">COTRANS<br />MEQ</div>{:else}<img
								src="/assets/logo_nombre.png"
								alt="Logo"
								onerror={() => (logoError = true)}
								style="height:58px;width:auto;object-fit:contain"
							/>{/if}
					</div>
					<div class="dh-title">
						<div class="dh-co">SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.</div>
						<div class="dh-doc">LIQUIDACION DE INGRESOS RECIBIDOS PARA TERCEROS</div>
					</div>
					<div class="dh-meta">
						<table class="">
							<tbody>
								<tr><td class="ml">Codigo:</td><td class="mv">GAF-FR-11</td></tr>
								<tr><td class="ml">Version:</td><td>2</td></tr>
								<tr><td class="ml">Fecha:</td><td>10/07/2026</td></tr>
							</tbody>
						</table>
					</div>
				</div>

				<!-- Period bar -->
				<div class="pb">
					<div class="pc">
						<span class="pclabel">MES:</span><span class="pcval"
							>{item.mes ? MESES[item.mes - 1] : ''}</span
						>
					</div>
					<div class="pc">
						<span class="pclabel">AÑO:</span><span class="pcval">{item.anio || ''}</span>
					</div>
					<div class="pc">
						<span class="pclabel">PLACA:</span><span class="pcval">{fmtPlaca(item.placa)}</span>
					</div>
					<div class="pc">
						<span class="pclabel">CONSECUTIVO:</span><span class="pcval"
							>{item.consecutivo || ''}</span
						>
					</div>
					<div class="pc pc-tercero">
						<span class="pclabel">TERCERO:</span>
						<span class="pcval pc-tercero-val">
							{terceroInfo?.nombre_completo || '—'}{#if terceroInfo?.identificacion}<span
									class="pc-id">· {terceroDocLabel} {terceroInfo.identificacion}</span
								>{/if}
						</span>
					</div>
				</div>

				<!-- LIQUIDACION DE TRANSPORTE table -->
				<table class="terc-prev-tbl">
					<colgroup>
						<col style="width:1%" />
						<col style="width:7%" />
						<col style="width:4%" />
						<col style="width:4%" />
						<col style="width:6%" />
						<col style="width:15%" />
						<col style="width:8%" />
						<col style="width:4%" />
						<col style="width:2%" />
						<col style="width:2%" />
						<col style="width:6.5%" />
						<col style="width:5.5%" />
						<col style="width:5%" />
						<col class="col-internal" style="width:4%" />
						<col class="col-internal" style="width:7%" />
						<col class="col-internal" style="width:7%" />
						<col class="col-internal" style="width:7%" />
						<col class="col-internal" style="width:3%" />
					</colgroup>
					<thead>
						<tr>
							<th>#</th>
							<th>CLIENTE</th>
							<th># LIQ</th>
							<th>PLACA</th>
							<th>NOMBRE 3°</th>
							<th>RECORRIDO</th>
							<th>FECHAS</th>
							<th>V/UNIDAD</th>
							<th>CANT</th>
							<th>ADMON%</th>
							<th>ADMON $</th>
							<th>TOTAL</th>
							<th>V/LIQUIDAR</th>
							<th class="col-internal"># PLANILLA</th>
							<th class="col-internal">ING. EXTRA GLOBAL</th>
							<th class="col-internal">ING. EXTRAS AVAL</th>
							<th class="col-internal">ING. COTRANSMEQ</th>
							<th class="col-internal"># FACTURA</th>
						</tr>
					</thead>
					<tbody>
						{#each (item.items || []).filter((it: any) => {
							const lt = it.liquidacion_tercero || {};
							const vAdmin = lt.valor_admin || 0;
							const total = lt.total_facturado || 0;
							const vLiq = lt.valor_liquidar || 0;
							return !(vAdmin === 0 && total === 0 && vLiq === 0);
						}) as it, idx (it.id ?? idx)}
							{@const lt = it.liquidacion_tercero || ({} as any)}
							{@const liq = lt.liquidacion || {}}
							{@const terc = lt.tercero || {}}
							{@const numFactura = getNumeroFactura(liq)}
							<tr>
								<td class="num-cell">{idx + 1}</td>
								<td>{liq.cliente?.nombre || ''}</td>
								<td class="tc">{liq.consecutivo || ''}</td>
								<td class="tc" style="font-weight:600">{fmtPlaca(lt.placa || item.placa)}</td>
								<td>{terc.nombre_completo || item.tercero?.nombre_completo || '—'}</td>
								<td>{lt.recorrido || lt.placa || item.placa}</td>
								<td class="tc">{lt.fechas || ''}</td>
								<td class="mc">{COP(lt.valor_unitario || 0)}</td>
								<td class="num-cell">{lt.cantidad || 1}</td>
								<td class="num-cell">{lt.porcentaje_admin || 0}%</td>
								<td class="mc" style="color:#b91c1c">{COP(lt.valor_admin || 0)}</td>
								<td class="mc" style="font-weight:700">{COP(lt.total_facturado || 0)}</td>
								<td class="mc" style="font-weight:700;color:#ea580c"
									>{COP(lt.valor_liquidar || 0)}</td
								>
								<td class="col-internal num-cell">{fmtPlanillas(lt.item?.numero_planilla)}</td>
								<td class="col-internal mc">{COP(lt.ingreso_extra_global || 0)}</td>
								<td class="col-internal mc">{COP(lt.ingresos_extra_aval || 0)}</td>
								<td class="col-internal mc" style="font-weight:700"
									>{COP(lt.ingreso_empresa || 0)}</td
								>
								<td class="col-internal num-cell">{numFactura}</td>
							</tr>
						{:else}
							{#if (item.items_adicionales || []).length === 0}
								<tr>
									<td class="num-cell">1</td>
									<td>{item.liquidacion?.cliente?.nombre || ''}</td>
									<td class="tc">{item.consecutivo || ''}</td>
									<td class="tc" style="font-weight:600">{fmtPlaca(item.placa)}</td>
									<td>{item.tercero?.nombre_completo || '—'}</td>
									<td>{item.placa}</td>
									<td class="tc">{item.fechas || ''}</td>
									<td class="mc">{COP(item.valor_unitario || item.valor_liquidar)}</td>
									<td class="num-cell">{item.cantidad || 1}</td>
									<td class="num-cell">{item.porcentaje_admin || 0}%</td>
									<td class="mc" style="color:#b91c1c">{COP(item.valor_admin || 0)}</td>
									<td class="mc" style="font-weight:700">{COP(item.total_facturado || 0)}</td>
									<td class="mc" style="font-weight:700;color:#ea580c"
										>{COP(item.valor_liquidar)}</td
									>
									<td class="col-internal tc"></td>
									<td class="col-internal mc">$ 0</td>
									<td class="col-internal mc">$ 0</td>
									<td class="col-internal mc" style="font-weight:700">$ 0</td>
									<td class="col-internal tc"></td>
								</tr>
							{/if}
						{/each}
						<!-- Filas virtuales adicionales (COTRANSMEQ) — siempre al final -->
						{#each item.items_adicionales || [] as adc, adcIdx ((adc.id || 'adc') + ':' + adcIdx)}
							{@const vLiqGross = (adc.valor_unitario || 0) * (adc.cantidad || 1)}
							{@const pctAdc = Number(adc.porcentaje_admin) || 0}
							{@const vAdminAdc = adc.valor_admin != null ? adc.valor_admin : Math.round((vLiqGross * pctAdc) / 100)}
							{@const vLiqNeto = vLiqGross - vAdminAdc}
							<tr style="background:#fff7ed">
								<td class="num-cell" style="color:#ea580c;font-weight:900">T</td>
								<td style="font-weight:800;color:#ea580c">{adc.cliente || 'COTRANSMEQ'}</td>
								<td class="tc" style="color:#94a3b8">—</td>
								<td class="tc" style="font-weight:600">{fmtPlaca(adc.placa || item.placa)}</td>
								<td style="font-weight:600"
									>{adc.tercero_nombre || item.tercero?.nombre_completo || '—'}</td
								>
								<td>{adc.recorrido || '—'}</td>
								<td class="tc">{adc.fechas || ''}</td>
								<td class="mc">{COP(adc.valor_unitario || 0)}</td>
								<td class="num-cell">{adc.cantidad || 1}</td>
								<td class="num-cell">{pctAdc ? pctAdc.toFixed(2) + '%' : '0%'}</td>
								<td class="mc" style="color:#b91c1c">{COP(vAdminAdc)}</td>
								<td class="mc" style="font-weight:700">{COP(vLiqGross)}</td>
								<td class="mc" style="font-weight:800;color:#ea580c">{COP(vLiqNeto)}</td>
								<td class="col-internal tc">—</td>
								<td class="col-internal mc">$ 0</td>
								<td class="col-internal mc">$ 0</td>
								<td class="col-internal mc" style="font-weight:800;color:#b91c1c">({COP(vLiqNeto)})</td>
								<td class="col-internal tc">—</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr style="font-weight:800;background:#e2e8f0">
							<td colspan="7" style="text-align:right;padding-right:6px">TOTALES</td>
							<td class="num-cell"></td>
							<td></td>
							<td></td>
							<td class="mc" style="color:#b91c1c">{COP(pdfTotales.totalAdmon)}</td>
							<td class="mc" style="font-weight:700">{COP(pdfTotales.totalFacturado)}</td>
							<td class="mc" style="color:#ea580c">{COP(pdfTotales.totalLiquidar)}</td>
							<td class="col-internal"></td>
							<td class="col-internal mc">{COP(pdfTotales.totalIngresoExtraGlobal)}</td>
							<td class="col-internal mc">{COP(pdfTotales.totalIngresosExtraAval)}</td>
							<td class="col-internal mc" style="font-weight:700"
								>{COP(pdfTotales.totalIngresoEmpresa)}</td
							>
							<td class="col-internal"></td>
						</tr>
					</tfoot>
				</table>

				<!-- DESCUENTOS POR LA PRESTACION DEL SERVICIO -->
				<div class="descuentos-wrap">
					<div class="desc-section-title">DESCUENTOS POR LA PRESTACION DEL SERVICIO</div>

					{#if item.conceptos && item.conceptos.length > 0}
						{@const laborales = getLaborales(item.conceptos)}

						<div class="conductores-grid">
							{#each [...new Set(laborales.map((c) => c.conductor_id || 'sin-conductor'))] as condKey}
								{@const condConceptos = laborales.filter(
									(c) => (c.conductor_id || 'sin-conductor') === condKey
								)}
								{@const condNombre = condConceptos[0]?.conductor
									? `${condConceptos[0].conductor.nombre} ${condConceptos[0].conductor.apellido}`
									: 'General / Consolidado'}
								{@const condId = condConceptos[0]?.conductor?.numero_identificacion || ''}
								{@const condTotal = condConceptos.reduce((s, c) => s + (c.valor_total || 0), 0)}
								{@const condSalarios = condConceptos.filter((c) =>
									[
										'SALARIO',
										'AUXILIO_TRANSPORTE',
										'BONIFICACION',
										'OTROS_AUXILIOS',
										'RECARGOS'
									].includes(c.concepto)
								)}
								{@const condPrestaciones = condConceptos.filter((c) =>
									['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA', 'VACACIONES'].includes(c.concepto)
								)}
								{@const condSeguridad = condConceptos.filter((c) =>
									['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'].includes(c.concepto)
								)}

								<div class="conductor-section">
									<div class="conductor-name-row">
										<span class="conductor-label">NOMBRE:</span>
										<span class="conductor-name-val">{condNombre}</span>
										{#if condId}<span class="conductor-id">· CC {condId}</span>{/if}
									</div>

									<table class="desc-table">
										<colgroup>
											<col style="width:36%" />
											<col style="width:14%" />
											<col style="width:5%" />
											<col style="width:20%" />
											<col style="width:25%" />
										</colgroup>
										<thead>
											<tr>
												<th class="col-concept">CONCEPTO</th>
												<th class="col-dias">DIAS / PORCENTAJE</th>
												<th></th>
												<th class="col-valor">VALOR</th>
												<th class="col-total">TOTAL</th>
											</tr>
										</thead>
										<tbody>
											{#each condSalarios as c}
												<tr>
													<td class="concept-name">{c.concepto.replace(/_/g, ' ')}</td>
													<td class="dias-static">{fmtDias(c.dias)}</td>
													<td></td>
													<td class="val-cell">{COP(c.valor_unitario || 0)}</td>
													<td class="total-cell">{COP(c.valor_total || 0)}</td>
												</tr>
											{/each}
											{#if condPrestaciones.length > 0}
												{@const pctPrest = condPrestaciones.reduce(
													(s, c) => s + (c.porcentaje || 0),
													0
												)}
												{@const totalPrest = condPrestaciones.reduce(
													(s, c) => s + (c.valor_total || 0),
													0
												)}
												<tr class="category-row">
													<td class="cat-name">PRESTACIONES SOCIALES</td>
													<td class="pct-cell">{fmtPct(pctPrest)}</td>
													<td></td>
													<td></td>
													<td class="total-cell">{COP(totalPrest)}</td>
												</tr>
												{#each condPrestaciones as c}
													<tr class="sub-row">
														<td class="sub-name">{c.concepto.replace(/_/g, ' ')}</td>
														<td class="pct-cell">{fmtPct(c.porcentaje)}</td>
														<td></td>
														<td></td>
														<td class="total-cell">{COP(c.valor_total || 0)}</td>
													</tr>
												{/each}
											{/if}
											{#if condSeguridad.length > 0}
												{@const pctSS = condSeguridad.reduce((s, c) => s + (c.porcentaje || 0), 0)}
												{@const totalSS = condSeguridad.reduce(
													(s, c) => s + (c.valor_total || 0),
													0
												)}
												<tr class="category-row">
													<td class="cat-name">SEGURIDAD SOCIAL</td>
													<td class="pct-cell">{fmtPct(pctSS)}</td>
													<td></td>
													<td></td>
													<td class="total-cell">{COP(totalSS)}</td>
												</tr>
												{#each condSeguridad as c}
													<tr class="sub-row">
														<td class="sub-name">{c.concepto.replace(/_/g, ' ')}</td>
														<td class="pct-cell">{fmtPct(c.porcentaje)}</td>
														<td></td>
														<td></td>
														<td class="total-cell">{COP(c.valor_total || 0)}</td>
													</tr>
												{/each}
											{/if}
										</tbody>
									</table>

									<div class="conductor-total-row">
										<span>VALOR TOTAL CONDUCTOR</span>
										<span class="conductor-total-val">{COP(condTotal)}</span>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="empty-desc">Sin conceptos registrados.</div>
					{/if}
				</div>

				<div class="desc-grid-split">
					<!-- GASTOS DE VEHICULO (left in print) -->
					<div class="desc-block desc-block-gastos">
						<h4 class="desc-block-title">
							GASTOS DE VEHICULO — COMBUSTIBLE, EXAMENES MEDICOS Y DOTACION
						</h4>
						<table class="desc-table">
							<colgroup>
								<col style="width:36%" />
								<col style="width:14%" />
								<col style="width:5%" />
								<col style="width:20%" />
								<col style="width:25%" />
							</colgroup>
							<thead>
								<tr>
									<th class="col-concept">CONCEPTO</th>
									<th class="col-dias">CANTIDAD</th>
									<th></th>
									<th class="col-valor">VALOR</th>
									<th class="col-total">TOTAL</th>
								</tr>
							</thead>
							<tbody>
								{#each getGastos(item.conceptos || []) as c}
									<tr>
										<td class="concept-name">{c.concepto.replace(/_/g, ' ')}</td>
										<td class="dias-static">{fmtDias(c.dias)}</td>
										<td></td>
										<td class="val-cell">{COP(c.valor_unitario || 0)}</td>
										<td class="total-cell">{COP(c.valor_total || 0)}</td>
									</tr>
								{/each}
								{#if getGastos(item.conceptos || []).length === 0}
									<tr><td colspan="5" class="empty-desc">Sin gastos registrados.</td></tr>
								{/if}
							</tbody>
							{#if getGastos(item.conceptos || []).length > 0}
								{@const totalGastos = getGastos(item.conceptos || []).reduce(
									(s, c) => s + (c.valor_total || 0),
									0
								)}
								<tfoot>
									<tr class="desc-total-row desc-total-row-amber">
										<td colspan="3" class="desc-total-label">TOTAL GASTOS DE VEHICULO</td>
										<td class="desc-total-divider"></td>
										<td class="desc-total-val">{COP(totalGastos)}</td>
									</tr>
								</tfoot>
							{/if}
						</table>
					</div>

					<!-- ANTICIPOS + IMPUESTOS stacked en column -->
					<div class="desc-grid-stack">
						<!-- ANTICIPOS DEL VEHICULO -->
						<div class="desc-block desc-block-anticipos">
							<h4 class="desc-block-title">ANTICIPOS DEL VEHICULO</h4>
							<table class="desc-table">
								<colgroup>
									<col style="width:60%" />
									<col style="width:5%" />
									<col style="width:0%" />
									<col style="width:19.5%" />
								</colgroup>
								<thead>
									<tr>
										<th class="col-concept">CONCEPTO</th>
										<th></th>
										<th class="col-fecha">FECHA</th>
										<th class="col-valor">VALOR</th>
									</tr>
								</thead>
								<tbody>
									{#each getAnticipos(item.conceptos || []) as c}
										<tr>
											<td class="concept-name">{(c.concepto || '').replace(/_/g, ' ')}</td>
											<td></td>
											<td class="dias-static">{fmtFechaCO(c.observaciones)}</td>
											<td class="val-cell">{COP(c.valor_unitario || 0)}</td>
										</tr>
									{/each}
									{#if getAnticipos(item.conceptos || []).length === 0}
										<tr><td colspan="3" class="empty-desc">Sin anticipos registrados.</td></tr>
									{/if}
								</tbody>
								{#if getAnticipos(item.conceptos || []).length > 0}
									{@const totalAnticipos = getAnticipos(item.conceptos || []).reduce(
										(s, c) => s + (c.valor_total || 0),
										0
									)}
									<tfoot>
										<tr class="desc-total-row desc-total-row-blue">
											<td colspan="3" class="desc-total-label">TOTAL ANTICIPOS DEL VEHICULO</td>
											<td class="desc-total-val">{COP(totalAnticipos)}</td>
										</tr>
									</tfoot>
								{/if}
							</table>
						</div>

						<!-- IMPUESTOS -->
						<div class="desc-block desc-block-impuestos">
							<h4 class="desc-block-title">IMPUESTOS</h4>
							<table class="desc-table">
								<colgroup>
									<col style="width:36%" />
									<col style="width:14%" />
									<col style="width:5%" />
									<col style="width:20%" />
									<col style="width:25%" />
								</colgroup>
								<thead>
									<tr>
										<th class="col-concept">CONCEPTO</th>
										<th class="col-dias">PORCENTAJE</th>
										<th></th>
										<th></th>
										<th class="col-total">VALOR</th>
									</tr>
								</thead>
								<tbody>
									{#each getImpuestos(item.conceptos || []) as c}
										<tr>
											<td class="concept-name">{c.concepto.replace(/_/g, ' ')}</td>
											<td class="pct-cell">{fmtPct(c.porcentaje)}</td>
											<td></td>
											<td></td>
											<td class="total-cell">{COP(c.valor_total || 0)}</td>
										</tr>
									{/each}
									{#if getImpuestos(item.conceptos || []).length === 0}
										<tr><td colspan="5" class="empty-desc">Sin impuestos registrados.</td></tr>
									{/if}
								</tbody>
								{#if getImpuestos(item.conceptos || []).length > 0}
									{@const totalImpuestos = getImpuestos(item.conceptos || []).reduce(
										(s, c) => s + (c.valor_total || 0),
										0
									)}
									<tfoot>
										<tr class="desc-total-row desc-total-row-red">
											<td colspan="3" class="desc-total-label">TOTAL IMPUESTOS Y RETENCIONES</td>
											<td class="desc-total-divider"></td>
											<td class="desc-total-val">{COP(totalImpuestos)}</td>
										</tr>
									</tfoot>
								{/if}
							</table>
						</div>
					</div>
				</div>

				<!-- RESUMEN -->
				<div
					style="
		display:flex;
		flex-direction:row;
		gap:5px;
		margin-left:auto;
		margin-top:5px;
		margin-bottom:5px;
		padding:2px;
		background:#f3f4f6;
		justify-content:flex-end;
		align-self:flex-end;
		align-items:center;
	"
				>
					<div
						style="
			display:inline-flex;
			flex-direction:row;
			gap:4px;
			align-items:center;
			font-size:14px;
			font-weight:700;
		"
					>
						<span>TOTAL DESCUENTOS:</span>
						<span style="color:#dc2626;">
							{COP(item.total_descuentos || 0)}
						</span>
					</div>

					<div
						style="
			display:inline-flex;
			flex-direction:row;
			gap:4px;
			align-items:center;
			font-size:14px;
			font-weight:700;
		"
					>
						<span>TOTAL A PAGAR:</span>
						<span style="color:#ea580c;">
							{COP((pdfTotales.totalLiquidar || 0) - (item.total_descuentos || 0))}
						</span>
					</div>
				</div>

				<!-- Firmas -->
				<div class="sigs">
					<div class="sig">
						<div class="sig-lbl">LIQUIDADO POR:</div>
						{#if item.estado && item.estado !== 'BORRADOR'}
							<img
								class="sig-img"
								data-firma="camilo"
								src={firmaCamiloUrl}
								alt="Firma Camilo Cepeda"
							/>
						{/if}
						<div class="sig-line">&nbsp;</div>
					</div>
					<div class="sig">
						<div class="sig-lbl">ACEPTADO POR:</div>
						<div class="sig-line">&nbsp;</div>
					</div>
				</div>

			<!-- Footer — strip editorial con metadata mono -->
			<div class="doc-ft no-print">
				<span class="code-badge">GAF-FR-11 · V1</span>
				<span
					>Generado el {new Date().toLocaleDateString('es-CO', {
						day: '2-digit',
						month: 'long',
						year: 'numeric'
					})}</span
				>
				<span
					style="font-family:'Geist',sans-serif;font-weight:700;color:#0f172a;letter-spacing:0.02em"
					>SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.</span
				>
			</div>
			</div>
		</div>
	</div>
</div>

<style>
	.pdf-wrap {
		position: fixed;
		inset: 0;
		background: #b8c0cc;
		background-image:
			radial-gradient(circle at 0% 0%, rgba(249, 115, 22, 0.05) 0%, transparent 50%),
			radial-gradient(circle at 100% 100%, rgba(22, 101, 52, 0.04) 0%, transparent 55%);
		z-index: 200;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-family: 'Geist', 'Inter', system-ui, -apple-system, sans-serif;
	}
	.pdf-bar {
		background: rgba(255, 255, 255, 0.82);
		backdrop-filter: blur(20px) saturate(180%);
		-webkit-backdrop-filter: blur(20px) saturate(180%);
		padding: 0.85rem 1.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-shrink: 0;
		gap: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.04);
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
	}
	.pdf-bar-l {
		display: flex;
		align-items: center;
		gap: 14px;
		min-width: 0;
	}
	.pdf-bar-text {
		min-width: 0;
		flex: 1;
	}
	.pb-t {
		color: #0f172a;
		font-weight: 700;
		font-size: 15px;
		letter-spacing: -0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
	}
	.pb-s {
		color: #64748b;
		font-size: 11px;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-top: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pdf-bar-actions {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-shrink: 0;
	}
	.pb-logo {
		height: 40px;
		width: auto;
		object-fit: contain;
		opacity: 1;
	}
	.pbtn {
		border: none;
		border-radius: 10px;
		padding: 9px 18px;
		font-weight: 600;
		font-size: 12.5px;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		letter-spacing: 0.01em;
	}
	.pbtn-icon-svg {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}
	.pbtn-label-full {
		display: inline;
	}
	.pbtn-label-short {
		display: none;
	}
	.pbtn-back {
		background: #ffffff;
		color: #0f172a;
		border: 1px solid rgba(15, 23, 42, 0.12);
	}
	.pbtn-back:hover {
		background: #f6f6f3;
		border-color: rgba(15, 23, 42, 0.20);
		transform: translateY(-1px);
	}
	.pbtn-print {
		background: linear-gradient(135deg, #f97316, #ea580c);
		color: #fff;
		box-shadow: 0 4px 16px rgba(249, 115, 22, 0.30);
	}
	.pbtn-print:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 20px rgba(249, 115, 22, 0.40);
	}
	.pbtn-print:disabled {
		cursor: wait;
		opacity: 0.85;
		box-shadow: none;
		transform: none;
	}
	.pbtn-spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		border-radius: 50%;
		animation: pbtn-spin 0.7s linear infinite;
		flex-shrink: 0;
	}
	@keyframes pbtn-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.zoom-controls {
		display: flex;
		align-items: center;
		gap: 3px;
		background: #ffffff;
		border-radius: 10px;
		padding: 3px;
		border: 1px solid rgba(15, 23, 42, 0.08);
	}
	.zoom-btn {
		border: none;
		background: transparent;
		color: #0f172a;
		width: 30px;
		height: 30px;
		border-radius: 7px;
		cursor: pointer;
		font-size: 16px;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		font-family: inherit;
	}
	.zoom-btn:hover {
		background: rgba(249, 115, 22, 0.08);
		color: #ea580c;
		transform: translateY(-1px);
	}
	.zoom-reset {
		font-size: 13px;
		width: 32px;
	}
	.zoom-fit {
		font-size: 14px;
		width: 32px;
	}
	.zoom-label {
		color: #0f172a;
		font-size: 11px;
		font-weight: 700;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-variant-numeric: tabular-nums;
		min-width: 42px;
		text-align: center;
		letter-spacing: 0.04em;
	}

	.pdf-body {
		flex: 1;
		overflow: auto;
		padding: 28px 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		gap: 20px;
		-webkit-overflow-scrolling: touch;
		scroll-behavior: smooth;
		touch-action: pan-x pan-y pinch-zoom;
		overscroll-behavior: contain;
	}

	.page-scale-wrap {
		position: relative;
		flex-shrink: 0;
	}

	.estado-bar {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
		background: #fcfcfb;
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
		padding: 10px 24px;
	}
	.estado-info-stack {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 22px;
		align-items: center;
		flex: 1;
		min-width: 0;
	}
	.estado-info {
		font-size: 12.5px;
		color: #64748b;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
	}
	.estado-info strong {
		color: #0f172a;
	}
	.estado-info-icon {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: #64748b;
	}
	.estado-info-icon svg {
		width: 14px;
		height: 14px;
	}
	.estado-info-full {
		display: inline-flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.page {
		background: #fff;
		width: 2480px;
		padding: 14mm 16mm 14mm;
		font-size: 8.8pt;
		line-height: 1.35;
		font-family: Arial, Helvetica, sans-serif;
		box-shadow: 0 8px 50px rgba(0, 0, 0, 0.3);
		border-radius: 2px;
		position: absolute;
		top: 0;
		left: 0;
	}
	.dh {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		border: 2.5px solid #000;
		margin-bottom: 3.5px;
	}
	.dh-logo {
		border-right: 2px solid #000;
		padding: 8px 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 100px;
	}
	.dh-logo-fallback {
		width: 88px;
		height: 58px;
		background: linear-gradient(135deg, #f97316, #ea580c);
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #fff;
		font-size: 7pt;
		font-weight: 900;
		text-align: center;
		line-height: 1.2;
		box-shadow: 0 4px 12px rgba(249, 115, 22, 0.25);
	}
	.dh-title {
		padding: 7px 14px;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.dh-co {
		font-size: 11pt;
		font-weight: 900;
		color: #ea580c;
		text-transform: uppercase;
		letter-spacing: -0.01em;
	}
	.dh-doc {
		font-size: 10pt;
		font-weight: 700;
		color: #333;
		margin-top: 3px;
	}
	.dh-meta {
		border-left: 2px solid #000;
	}
	.mt {
		width: 100%;
		border-collapse: collapse;
		height: 100%;
	}
	.mt td {
		padding: 4px 12px;
		font-size: 10pt;
		border-bottom: 1px solid #999;
	}
	.mt tr:last-child td {
		border-bottom: none;
	}
	.ml {
		font-weight: 700;
		background: #f5f5f5;
		border-right: 1px solid #bbb !important;
		color: #555;
		white-space: nowrap;
	}
	.mv {
		font-weight: 800;
		color: #ea580c;
	}

	.pb {
		border: 1.5px solid #000;
		margin-bottom: 3.5px;
		display: flex;
		flex-wrap: wrap;
		background: #fff7ed;
		font-size: 10.5pt;
	}
	.pc {
		padding: 6px 11px;
		border-right: 1px solid #999;
		display: flex;
		align-items: center;
		gap: 5px;
		white-space: nowrap;
	}
	.pc:last-child {
		border-right: none;
		flex: 1;
	}
	.pc.pc-tercero {
		flex: 1 1 240px;
		min-width: 200px;
		max-width: 100%;
		white-space: normal;
	}
	.pc.pc-tercero .pcval {
		white-space: normal;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.pc-id {
		color: #334155;
		font-weight: 700;
		font-size: 10.5pt;
		margin-left: 4px;
		font-family: 'Geist', sans-serif;
		letter-spacing: 0.01em;
		font-variant-numeric: tabular-nums;
	}
	.pclabel {
		color: #666;
		font-weight: 600;
		font-size: 9.5pt;
	}
	.pcval {
		color: #ea580c;
		font-weight: 900;
		font-size: 12.5pt;
	}

	.terc-prev-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 8.4pt;
		margin-top: 8px;
		table-layout: auto;
		page-break-inside: auto;
		break-inside: auto;
	}
	.terc-prev-tbl th,
	.terc-prev-tbl td,
	.terc-prev-tbl tfoot td {
		font-size: 8.4pt;
		font-family: Arial, Helvetica, sans-serif;
	}
	.terc-prev-tbl tbody td {
		font-size: 11pt;
	}
	.terc-prev-tbl th,
	.terc-prev-tbl td {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.terc-prev-tbl th {
		background: #ea580c;
		color: #fff;
		padding: 7px 5px;
		font-weight: 700;
		text-align: center;
		border: 1px solid #14532d;
		white-space: nowrap;
	}
	.terc-prev-tbl th.col-internal {
		background: #475569;
		color: #f1f5f9;
		border-color: #334155;
	}
	.terc-prev-tbl td {
		padding: 8px 6px;
		border: 1px solid #dde3eb;
		vertical-align: middle;
	}
	.terc-prev-tbl tbody tr:hover td {
		background: #fff7ed;
	}
	.mc {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-size: 11pt;
		font-weight: 700;
	}
	.terc-prev-tbl td.mc {
		font-size: 11pt;
		font-weight: 700;
	}
	.terc-prev-tbl tfoot td.mc {
		font-size: 12pt;
		font-weight: 800;
		text-align: right;
	}
	.terc-prev-tbl tfoot td[style*='#b91c1c'] {
		color: #b91c1c !important;
	}
	.terc-prev-tbl tfoot td[style*='#ea580c'] {
		color: #ea580c !important;
	}
	.tc {
		text-align: center;
	}
	.num-cell {
		text-align: center;
		font-family: 'Geist', sans-serif;
		font-size: 11pt;
		font-weight: 700;
	}
	.terc-prev-tbl td.num-cell {
		font-size: 11pt;
		font-weight: 700;
	}
	.terc-prev-tbl tfoot td.num-cell {
		font-size: 11pt;
		font-weight: 800;
	}
	.terc-prev-tbl td.col-internal.num-cell {
		font-weight: 400;
	}
	.terc-prev-tbl tfoot td {
		font-size: 13pt;
		font-weight: 800;
	}
	.tc {
		text-align: center;
	}
	.col-internal {
		background: #f8fafc;
	}

	.desc-section-title {
		font-size: 14pt;
		font-weight: 800;
		color: #ea580c;
		text-transform: uppercase;
		margin: 14px 0 10px;
		padding-bottom: 6px;
		border-bottom: 2px solid #fed7aa;
	}
	.descuentos-wrap {
		page-break-inside: auto;
		break-inside: auto;
	}
	.conductor-section {
		margin-bottom: 12px;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		overflow: hidden;
	}
	.conductores-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}
	.desc-grid-split {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-top: 6px;
	}
	.desc-grid-split > .desc-block {
		margin-bottom: 0;
	}
	.desc-grid-stack {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.desc-grid-stack > .desc-block {
		margin-bottom: 0;
	}
	.conductor-name-row {
		padding: 7px 12px;
		background: #f8fafc;
		display: flex;
		gap: 6px;
		align-items: center;
		flex-wrap: wrap;
	}
	.conductor-label {
		font-size: 15px;
		font-weight: 700;
		color: #64748b;
		text-transform: uppercase;
	}
	.conductor-name-val {
		font-size: 18px;
		font-weight: 800;
		color: #0f172a;
	}
	.conductor-id {
		font-family: 'Geist', sans-serif;
		font-size: 14px;
		font-weight: 700;
		color: #334155;
		background: #fff7ed;
		padding: 2px 8px;
		border-radius: 4px;
		letter-spacing: 0.01em;
		font-variant-numeric: tabular-nums;
	}
	.conductor-total-row {
		display: flex;
		justify-content: space-between;
		padding: 10px 14px;
		background: #fff7ed;
		border-top: 2px solid #fed7aa;
		font-weight: 800;
		font-size: 18px;
		color: #065f46;
	}
	.conductor-total-val {
		font-family: 'Geist', sans-serif;
		font-size: 19px;
		font-weight: 800;
	}
	.desc-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 15.6px;
		margin-top: 4px;
		table-layout: fixed;
	}
	.desc-table colgroup col:nth-child(1) {
		width: 22%;
	}
	.desc-table colgroup col:nth-child(2) {
		width: 33%;
	}
	.desc-table colgroup col:nth-child(3) {
		width: 4%;
	}
	.desc-table colgroup col:nth-child(4) {
		width: 15%;
	}
	.desc-table colgroup col:nth-child(5) {
		width: 26%;
	}
	.desc-table th {
		text-align: left;
		padding: 8px 10px;
		font-size: 14.6px;
		font-weight: 800;
		color: #475569;
		text-transform: uppercase;
		background: #fafafa;
		border-bottom: 1px solid #e2e8f0;
		letter-spacing: 0.04em;
	}
	.desc-table th.col-dias {
		width: 33%;
	}
	.desc-table th.col-concept {
		width: 22%;
	}
	.desc-table th.col-valor {
		width: 15%;
	}
	.desc-table th.col-total {
		width: 26%;
	}
	.desc-table th:nth-child(3) {
		width: 4%;
	}
	.desc-table th.col-dias {
		text-align: center;
	}
	.desc-table th.col-fecha {
		text-align: right;
		padding: 0;
	}
	.desc-table th.col-valor {
		text-align: right;
	}
	.desc-table th.col-total {
		text-align: right;
	}
	.desc-table th.col-concept {
		text-align: left;
	}
	.desc-table td {
		padding: 5px 10px;
		border-bottom: 1px solid #f1f5f9;
		vertical-align: middle;
	}
	.desc-table td:first-child {
		text-align: left;
	}
	.desc-table td:nth-child(2) {
		text-align: center;
	}
	.desc-table td:nth-child(4) {
		text-align: right;
	}
	.desc-table td:nth-child(5) {
		text-align: right;
	}
	.concept-name {
		font-weight: 600;
		color: #374151;
		font-size: 14.6px;
	}
	.dias-static {
		font-family: 'Geist', sans-serif;
		font-size: 14.6px;
		color: #475569;
	}
	.val-cell {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-size: 14.6px;
		color: #475569;
		font-weight: 600;
	}
	.total-cell {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-weight: 700;
		font-size: 14.6px;
		color: #0f172a;
	}
	.pct-cell {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-size: 14.6px;
		color: #64748b;
	}
	.category-row {
		background: #fff7ed !important;
	}
	.category-row td {
		font-weight: 700;
		color: #065f46;
	}
	.cat-name {
		font-weight: 800;
		color: #065f46;
		font-size: 15.6px;
	}
	.sub-row {
		background: #fafafa;
	}
	.sub-name {
		padding-left: 20px !important;
		color: #64748b;
		font-size: 14.6px;
		font-weight: 600;
	}
	.desc-block {
		margin-bottom: 16px;
	}
	.desc-block-title {
		font-size: 18px;
		font-weight: 800;
		color: #ea580c;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin: 0 0 10px;
		padding: 8px 12px;
		background: #fff7ed;
		border-radius: 6px;
	}
	.desc-block-gastos .desc-block-title {
		color: #b45309;
		background: #fffbeb;
		border-left: 4px solid #f59e0b;
	}
	.desc-block-anticipos .desc-block-title {
		color: #1e40af;
		background: #eff6ff;
		border-left: 4px solid #3b82f6;
	}
	.desc-block-impuestos .desc-block-title {
		color: #991b1b;
		background: #fef2f2;
		border-left: 4px solid #ef4444;
	}
	.desc-block-gastos .concept-name,
	.desc-block-gastos .dias-static,
	.desc-block-gastos .val-cell,
	.desc-block-gastos .total-cell {
		font-size: 16.5px;
	}
	.desc-block-gastos .desc-table th {
		font-size: 15.5px;
	}
	.desc-block-gastos tfoot .desc-total-label {
		font-size: 16px;
	}
	.desc-block-gastos tfoot .desc-total-val {
		font-size: 19px;
	}
	.desc-block-anticipos .concept-name,
	.desc-block-anticipos .dias-static,
	.desc-block-anticipos .val-cell {
		font-size: 16.5px;
	}
	.desc-block-anticipos .desc-table th {
		font-size: 15.5px;
	}
	.desc-block-anticipos tfoot .desc-total-label {
		font-size: 16px;
	}
	.desc-block-anticipos tfoot .desc-total-val {
		font-size: 19px;
	}
	.desc-block-impuestos .concept-name,
	.desc-block-impuestos .dias-static,
	.desc-block-impuestos .pct-cell,
	.desc-block-impuestos .total-cell {
		font-size: 16.5px;
	}
	.desc-block-impuestos .desc-table th {
		font-size: 15.5px;
	}
	.desc-block-impuestos tfoot .desc-total-label {
		font-size: 16px;
	}
	.desc-block-impuestos tfoot .desc-total-val {
		font-size: 19px;
	}
	.empty-desc {
		padding: 16px;
		text-align: center;
		color: #94a3b8;
		font-size: 16px;
		font-weight: 600;
	}
	.desc-resumen {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		margin-top: 14px;
	}
	.resumen-line {
		display: flex;
		justify-content: space-between;
		padding: 10px;
		font-size: 20px;
		color: #374151;
		font-weight: 700;
	}

	.resumen-val {
		font-family: 'Geist', sans-serif;
		font-weight: 800;
		font-size: 22px;
	}
	.resumen-red {
		color: #dc2626;
	}
	.resumen-pagar {
		background: #ea580c;
		color: #fff;
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
		font-weight: 800;
		font-size: 20px;
		letter-spacing: 0.03em;
	}
	.resumen-pagar-val {
		font-size: 24px;
	}
	.col-dias {
		text-align: center;
		font-family: 'Geist', sans-serif;
	}
	.col-valor {
		text-align: right;
		font-family: 'Geist', sans-serif;
	}
	.col-total {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-weight: 600;
	}

	.desc-table tfoot .desc-total-row td {
		padding: 8px 10px !important;
		border-top: 2px solid #e2e8f0;
		border-bottom: none;
	}
	.desc-table tfoot .desc-total-row.desc-total-row-amber td {
		background: #fffbeb;
		border-top-color: #fbbf24;
	}
	.desc-table tfoot .desc-total-row.desc-total-row-blue td {
		background: #eff6ff;
		border-top-color: #93c5fd;
	}
	.desc-table tfoot .desc-total-row.desc-total-row-red td {
		background: #fef2f2;
		border-top-color: #fca5a5;
	}
	.desc-table tfoot .desc-total-label {
		text-align: right !important;
		font-size: 14.4px;
		font-weight: 800;
		color: #0f172a;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding-right: 6px !important;
	}
	.desc-table tfoot .desc-total-row-amber .desc-total-label {
		color: #92400e;
	}
	.desc-table tfoot .desc-total-row-blue .desc-total-label {
		color: #1e40af;
	}
	.desc-table tfoot .desc-total-row-red .desc-total-label {
		color: #991b1b;
	}
	.desc-table tfoot .desc-total-divider {
		border-left: 1px solid #cbd5e1;
	}
	.desc-table tfoot .desc-total-val {
		text-align: right;
		font-family: 'Geist', sans-serif;
		font-size: 16.8px;
		font-weight: 800;
		color: #0f172a;
	}
	.desc-table tfoot .desc-total-row-amber .desc-total-val {
		color: #b45309;
	}
	.desc-table tfoot .desc-total-row-blue .desc-total-val {
		color: #1d4ed8;
	}
	.desc-table tfoot .desc-total-row-red .desc-total-val {
		color: #dc2626;
	}

	.sigs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
		border: none;
		margin-top: 16px;
		padding: 0 8px;
	}
	.sig {
		padding: 8px 12px 16px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-height: 90px;
		background: transparent;
		border: none;
	}
	.sig:first-child {
		border-right: none;
	}
	.sig-lbl {
		font-weight: 800;
		color: #ea580c;
		font-size: 13pt;
		margin-bottom: 30px;
		letter-spacing: 0.03em;
		text-align: left;
		align-self: flex-start;
	}
	.sig-line {
		border-top: 1px solid #000;
		padding-top: 15px;
		color: #555;
		font-size: 7pt;
		font-style: italic;
		margin-top: auto;
		text-align: left;
		align-self: stretch;
	}
	.sig-img {
		max-height: 85px;
		max-width: 300px;
		width: auto;
		height: auto;
		object-fit: contain;
		background: #fff;
		padding: 4px 8px;
		margin: 4px 0 0;
		align-self: flex-start;
		display: block;
	}
	.doc-ft {
		margin-top: 8px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 10.5px;
		color: #64748b;
		font-weight: 600;
		border-top: 1px solid rgba(15, 23, 42, 0.08);
		padding-top: 8px;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.code-badge {
		display: inline-block;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #ea580c;
		background: rgba(249, 115, 22, 0.08);
		padding: 0.2rem 0.55rem;
		border-radius: 5px;
	}
	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 3px 10px;
		border-radius: 9999px;
	}
	.filter-field-label {
		display: block;
		font-family: 'Geist', 'Inter', system-ui, sans-serif;
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #64748b;
	}

	@page {
		size: letter landscape;
		margin: 1mm;
	}
	@page :first {
		size: letter landscape;
		margin: 1mm;
	}
	@media print {
		@page {
			size: letter landscape !important;
			margin: 3mm !important;
		}

		:global(html),
		:global(body) {
			margin: 0 !important;
			padding: 0 !important;
			width: 11in !important;
			height: auto !important;
			min-height: 0 !important;
			overflow: visible !important;
			max-height: none !important;
		}

		.no-print {
			display: none !important;
		}
		.pdf-wrap {
			position: static !important;
			background: #fff !important;
			overflow: visible !important;
			height: auto !important;
			inset: auto !important;
		}
		.pdf-body {
			padding: 0 !important;
			overflow: visible !important;
			background: #fff !important;
			display: block !important;
			width: 100% !important;
			height: auto !important;
		}
		.page-scale-wrap {
			width: 11in !important;
			height: auto !important;
			overflow: visible !important;
			position: relative !important;
		}
		.page {
			box-shadow: none !important;
			margin: 0 !important;
			padding: 0 !important;
			width: 11in !important;
			max-width: 11in !important;
			min-width: 11in !important;
			position: static !important;
			display: block !important;
			transform: none !important;
			transform-origin: top left !important;
		}
		.terc-prev-tbl {
			width: 100% !important;
		}
		.descuentos-wrap {
		}
		.desc-grid-split {
			display: block !important;
			gap: 5px !important;
			page-break-before: always !important;
			break-before: page !important;
		}
		.desc-grid-split > .desc-block {
			margin-bottom: 5px !important;
		}
		.desc-grid-stack {
			display: block !important;
			gap: 5px !important;
		}
		.desc-grid-stack > .desc-block {
			margin-bottom: 5px !important;
		}
		.desc-block-gastos,
		.desc-block-anticipos,
		.desc-block-impuestos {
			width: 100% !important;
		}
		.desc-resumen {
			margin-top: 8px !important;
		}
		.col-internal {
			display: none !important;
			visibility: collapse !important;
		}
		.terc-prev-tbl col.col-internal {
			display: none !important;
		}
		.terc-prev-tbl {
			font-size: 7pt !important;
			table-layout: fixed !important;
			width: 100% !important;
		}
		.terc-prev-tbl col:nth-child(1) {
			width: 4mm !important;
		}
		.terc-prev-tbl col:nth-child(2) {
			width: 26mm !important;
		}
		.terc-prev-tbl col:nth-child(3) {
			width: 8mm !important;
		}
		.terc-prev-tbl col:nth-child(4) {
			width: 9mm !important;
		}
		.terc-prev-tbl col:nth-child(5) {
			width: 24mm !important;
		}
		.terc-prev-tbl col:nth-child(6) {
			width: 23mm !important;
		}
		.terc-prev-tbl col:nth-child(7) {
			width: 18mm !important;
		}
		.terc-prev-tbl col:nth-child(8) {
			width: 13mm !important;
		}
		.terc-prev-tbl col:nth-child(9) {
			width: 7mm !important;
		}
		.terc-prev-tbl col:nth-child(10) {
			width: 9mm !important;
		}
		.terc-prev-tbl col:nth-child(11) {
			width: 12mm !important;
		}
		.terc-prev-tbl col:nth-child(12) {
			width: 13mm !important;
		}
		.terc-prev-tbl col:nth-child(13) {
			width: 14mm !important;
		}
		.terc-prev-tbl th,
		.terc-prev-tbl td,
		.terc-prev-tbl tfoot td {
			font-size: 7pt !important;
			font-family: Arial, Helvetica, sans-serif !important;
		}
		.terc-prev-tbl tbody td:nth-child(8),
		.terc-prev-tbl tbody td:nth-child(9),
		.terc-prev-tbl tbody td:nth-child(10),
		.terc-prev-tbl tbody td:nth-child(11),
		.terc-prev-tbl tbody td:nth-child(12),
		.terc-prev-tbl tbody td:nth-child(13) {
			font-size: 8pt !important;
		}
		.terc-prev-tbl th {
			padding: 2px 2px !important;
			word-wrap: break-word;
			white-space: normal !important;
			overflow: visible !important;
			text-overflow: clip !important;
		}
		.terc-prev-tbl td {
			padding: 2px 2px !important;
			word-wrap: break-word;
			white-space: normal !important;
			overflow: visible !important;
			text-overflow: clip !important;
		}
		.terc-prev-tbl .totales-row td,
		.terc-prev-tbl tfoot td,
		.terc-prev-tbl tr.totales-row td {
			font-size: 10pt !important;
			font-weight: 800 !important;
			padding: 5px 4px !important;
			background: #e2e8f0 !important;
		}
		.terc-prev-tbl col.col-internal,
		.terc-prev-tbl th.col-internal,
		.terc-prev-tbl td.col-internal,
		.terc-prev-tbl tfoot td.col-internal {
			display: none !important;
			width: 0 !important;
			min-width: 0 !important;
			max-width: 0 !important;
			padding: 0 !important;
			margin: 0 !important;
			border: none !important;
			visibility: collapse !important;
		}
		.dh {
			font-size: 7.5pt !important;
		}
		.dh-logo img {
			height: 29px !important;
		}
		.dh-co {
			font-size: 9.5pt !important;
		}
		.dh-doc {
			font-size: 8pt !important;
		}
		.pb {
			font-size: 8.5pt !important;
		}
		.pclabel {
			font-size: 7pt !important;
		}
		.pcval {
			font-size: 8.5pt !important;
		}
		.pc.pc-tercero {
			flex: 1 1 auto !important;
			min-width: 0 !important;
			max-width: none !important;
			white-space: nowrap !important;
			border-right: 1px solid 999 !important;
			border-top: none !important;
			overflow: hidden !important;
			text-overflow: ellipsis !important;
		}
		.pc.pc-tercero .pcval {
			white-space: nowrap !important;
			font-size: 8.5pt !important;
			overflow: hidden !important;
			text-overflow: ellipsis !important;
		}
		.pc-id {
			font-size: 7.5pt !important;
		}
		.conductores-grid {
			display: grid !important;
			grid-template-columns: 1fr 1fr !important;
			gap: 4px !important;
			page-break-inside: avoid !important;
			break-inside: avoid !important;
		}
		.descuentos-wrap {
			page-break-before: always !important;
			break-before: page !important;
		}
		.conductor-name-row {
			padding: 3px 6px !important;
		}
		.conductor-label {
			font-size: 8.5pt !important;
		}
		.conductor-id {
			font-size: 8.5pt !important;
			padding: 0 3px !important;
		}
		.conductor-name-val {
			font-size: 9.5pt !important;
		}
		.conductor-total-row {
			padding: 3.5px 5px !important;
			font-size: 8pt !important;
		}
		.conductor-total-val {
			font-size: 9.5pt !important;
		}
		.desc-section-title {
			font-size: 10pt !important;
			margin: 6px 0 6px !important;
			padding-bottom: 3px !important;
		}
		.desc-block-title {
			font-size: 9pt !important;
			padding: 7.5px 11px !important;
			margin-bottom: 4px !important;
			letter-spacing: 0.03em !important;
		}
		.desc-block {
			margin-bottom: 4px !important;
		}
		.desc-table {
			font-size: 7.7pt !important;
		}
		.desc-table th {
			font-size: 7.7pt !important;
			padding: 5px 6px !important;
			letter-spacing: 0.02em !important;
		}
		.desc-table td {
			padding: 4px 6px !important;
		}
		.desc-table tfoot .desc-total-row td {
			padding: 6px 6px !important;
		}
		.desc-table tfoot .desc-total-label {
			font-size: 7.7pt !important;
		}
		.desc-table tfoot .desc-total-val {
			font-size: 7.7pt !important;
		}
		.desc-block-gastos .concept-name,
		.desc-block-gastos .dias-static,
		.desc-block-gastos .val-cell,
		.desc-block-gastos .total-cell {
			font-size: 7.7pt !important;
		}
		.desc-block-gastos .desc-table th {
			font-size: 7.7pt !important;
		}
		.desc-block-anticipos .concept-name,
		.desc-block-anticipos .dias-static,
		.desc-block-anticipos .val-cell {
			font-size: 7.7pt !important;
		}
		.desc-block-anticipos .desc-table th {
			font-size: 7.7pt !important;
		}
		.desc-block-impuestos .concept-name,
		.desc-block-impuestos .dias-static,
		.desc-block-impuestos .pct-cell,
		.desc-block-impuestos .total-cell {
			font-size: 7.7pt !important;
		}
		.desc-block-impuestos .desc-table th {
			font-size: 7.7pt !important;
		}
		.conductor-section .concept-name,
		.conductor-section .dias-static,
		.conductor-section .val-cell,
		.conductor-section .total-cell,
		.conductor-section .pct-cell,
		.conductor-section .cat-name,
		.conductor-section .sub-name,
		.conductor-section .category-row td {
			font-size: 7.3pt !important;
		}
		.conductor-section .desc-table th,
		.conductor-section .desc-table td {
			padding: 3.5px 5px !important;
		}
		.desc-resumen {
			padding: 10px 14px !important;
			margin-top: 10px !important;
			margin-bottom: 6px !important;
			background: #f8fafc !important;
			border: 1px solid #e2e8f0 !important;
			border-radius: 8px !important;
		}
		.resumen-line {
			font-size: 9pt !important;
			padding: 4px 0 !important;
		}
		.resumen-val {
			font-size: 9pt !important;
		}
		.resumen-pagar {
			font-size: 10pt !important;
			padding: 6px 10px !important;
			margin: 6px -14px -10px !important;
			background: #ea580c !important;
			color: #fff !important;
			border-radius: 0 !important;
			border-bottom-left-radius: 8px !important;
			border-bottom-right-radius: 8px !important;
		}
		.resumen-pagar-val {
			font-size: 11pt !important;
		}
		.sigs {
			margin-top: 16px !important;
			margin-bottom: 0 !important;
			border: none !important;
			padding: 0 !important;
			page-break-inside: avoid !important;
			break-inside: avoid !important;
		}
		.sig {
			padding: 10px 12px 18px !important;
			min-height: 60px !important;
			display: flex !important;
			flex-direction: column !important;
			align-items: flex-start !important;
		}
		.sig-lbl {
			font-size: 8pt !important;
			font-weight: 800 !important;
			color: #ea580c !important;
			margin-bottom: 25px !important;
			text-align: left !important;
		}
		.sig-line {
			font-size: 6pt !important;
			border-top: 1px solid #000 !important;
			padding-top: 13px !important;
			text-align: left !important;
			align-self: stretch !important;
		}
		.doc-ft {
			font-size: 4pt !important;
			margin-top: 3px !important;
			padding-top: 2px !important;
		}
		.mt td {
			padding: 3px 10px !important;
			font-size: 9pt !important;
		}
		.conductor-section {
			margin-bottom: 4px !important;
		}
	}
</style>
