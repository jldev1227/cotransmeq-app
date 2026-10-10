<script lang="ts">
	import { onMount } from 'svelte';
	import { recargosApi } from '$lib/api/recargos';
	import { apiClient } from '$lib/api/apiClient';
	import type { RecargoDetallado } from '$lib/types/recargos';
	import { getNombreMes } from '$lib/utils/recargosHelpers';
	import { CircleAlert, Eye, FileText, FileX, History, User } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import Dato from '$lib/components/directorio/Dato.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';

	export let isOpen = false;
	export let recargoId: string | null = null;

	let recargo: RecargoDetallado | null = null;
	let isLoadingData = false;
	let error: string | null = null;
	let mesAño: { mes: number; año: number } | null = null;
	let archivoExistente: string | null = null;
	let selectedTab = 'detalles';

	// ═══ Preview monetario (cálculo de "Valor a Pagar" por día y total) ═══
	// Replica la lógica de RecargosDesgloseModal.svelte: trae el detalle por
	// planilla/día desde /api/liquidaciones/preview-recargos para mostrar el
	// valor total a pagar del recargo y el desglose por día.
	type PreviewDiaModal = {
		dia: number;
		fecha: string;
		es_festivo: boolean;
		es_domingo: boolean;
		disponibilidad: boolean;
		total_horas: number;
		total_valor_dia: number;
	};
	type PreviewPlanillaModal = {
		planilla_id: string;
		total_valor: number;
		dias: PreviewDiaModal[];
	};
	let isLoadingPreview = false;
	let previewError: string | null = null;
	let previewPlanilla: PreviewPlanillaModal | null = null;

	// Info del servicio asociado
	let servicioInfo: {
		origen: {
			id: string;
			codigo_municipio: number;
			nombre_municipio: string;
			nombre_departamento: string;
		} | null;
		destino: {
			id: string;
			codigo_municipio: number;
			nombre_municipio: string;
			nombre_departamento: string;
		} | null;
		origen_especifico: string;
		destino_especifico: string;
		proposito_servicio: string;
		observaciones: string;
		fecha_solicitud: string;
	} | null = null;

	interface DiaLaboral {
		id: string;
		dia: number;
		hora_inicio: string;
		hora_fin: string;
		total_horas: number;
		es_especial: boolean;
		es_domingo: boolean;
		es_festivo: boolean;
		hed: number;
		hen: number;
		hefd: number;
		hefn: number;
		rndf: number;
		rn: number;
		rd: number;
	}

	// Helper para formatear horas
	function formatearHoras(horas: number | string | undefined): string {
		if (!horas) return '0.0';
		const num = typeof horas === 'string' ? parseFloat(horas) : horas;
		return isNaN(num) ? '0.0' : num.toFixed(2);
	}

	function fmtCOP(v: number | null | undefined): string {
		const n = Number(v) || 0;
		return new Intl.NumberFormat('es-CO', {
			style: 'currency',
			currency: 'COP',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(n);
	}

	// Carga el preview monetario del conductor en el período del recargo y
	// extrae la planilla que coincide con el recargo actual (por planilla_id === recargo.id).
	async function cargarPreviewValor(rec: RecargoDetallado) {
		try {
			isLoadingPreview = true;
			previewError = null;
			previewPlanilla = null;
			if (!rec?.conductor_id || !rec.mes || !rec.año) return;
			const data = await recargosApi.obtenerPreviewValorRecargo(
				rec.conductor_id,
				Number(rec.mes),
				Number((rec as any).a_o ?? rec.año)
			);
			const match = (data?.planillas || []).find((p) => p.planilla_id === rec.id);
			previewPlanilla = match
				? {
						planilla_id: match.planilla_id,
						total_valor: Number(match.total_valor) || 0,
						dias: (match.dias || []).map((d) => ({
							dia: Number(d.dia) || 0,
							fecha: d.fecha,
							es_festivo: !!d.es_festivo,
							es_domingo: !!d.es_domingo,
							disponibilidad: !!d.disponibilidad,
							total_horas: Number(d.total_horas) || 0,
							total_valor_dia: Number(d.total_valor_dia) || 0
						}))
					}
				: null;
			if (!match) {
				previewError = 'No se encontró el cálculo monetario para este recargo en el período.';
			}
		} catch (err) {
			console.warn('[ModalVisualizarRecargo] No se pudo cargar el preview:', err);
			previewError = 'No se pudo calcular el valor monetario del recargo.';
		} finally {
			isLoadingPreview = false;
		}
	}

	// Función para obtener URL firmada
	async function getPresignedUrl(s3Key: string): Promise<string | null> {
		try {
			const response = await apiClient.get<{
				success: boolean;
				data: { url: string };
			}>('/api/documentos/url-firma', {
				params: { key: s3Key }
			});
			return response.data.data.url;
		} catch (error) {
			console.error('Error obteniendo URL firmada:', error);
			return null;
		}
	}

	// Función para cargar datos del recargo
	async function cargarDatosRecargo(id: string) {
		try {
			isLoadingData = true;
			error = null;

			const recargoData = await recargosApi.obtenerPorId(id);

			if (recargoData) {
				// Mapear dias_laborales_planillas al formato esperado
				const diasMapeados = (recargoData.dias_laborales_planillas || []).map((dia: any) => {
					// Calcular totales de recargos por tipo
					const recargos = {
						hed: 0,
						hen: 0,
						hefd: 0,
						hefn: 0,
						rndf: 0,
						rn: 0,
						rd: 0
					};

					// Sumar horas de cada tipo de recargo
					(dia.detalles_recargos_dias || []).forEach((detalle: any) => {
						const codigo = detalle.tipos_recargos?.codigo?.toLowerCase();
						const horas = parseFloat(detalle.horas || '0');

						if (codigo && recargos.hasOwnProperty(codigo)) {
							recargos[codigo as keyof typeof recargos] += horas;
						}
					});

					return {
						id: dia.id,
						dia: dia.dia,
						hora_inicio: dia.hora_inicio,
						hora_fin: dia.hora_fin,
						total_horas: parseFloat(dia.total_horas || '0'),
						horas_ordinarias: parseFloat(dia.horas_ordinarias || '0'),
						es_festivo: dia.es_festivo,
						es_domingo: dia.es_domingo,
						kilometraje_inicial: dia.kilometraje_inicial,
						kilometraje_final: dia.kilometraje_final,
						// Recargos calculados
						hed: recargos.hed,
						hen: recargos.hen,
						hefd: recargos.hefd,
						hefn: recargos.hefn,
						rndf: recargos.rndf,
						rn: recargos.rn,
						rd: recargos.rd
					};
				});

				// Mapear los datos de la API al formato esperado por el modal
				recargo = {
					...recargoData,
					año: (recargoData as any).a_o || recargoData.año, // Mapear a_o -> año
					conductor: recargoData.conductor, // Ya tiene el nombre correcto
					vehiculo: recargoData.vehiculo, // Mapear vehiculo -> vehiculo
					empresa: (recargoData as any).clientes || (recargoData as any).cliente || {}, // Mapear clientes/cliente -> empresa
					dias_laborales: diasMapeados,
					total_horas: parseFloat(String(recargoData.total_horas_trabajadas || '0')),
					total_dias: (recargoData as any).total_dias_laborados || 0,
					// Mapear información de auditoría
					auditoria: {
						version: recargoData.version || 1,
						creado_por: (recargoData as any).users_recargos_planillas_creado_por_idTousers || {
							nombre: 'Sistema',
							apellido: '',
							email: 'sistema@cotransmeq.com'
						},
						actualizado_por:
							(recargoData as any).users_recargos_planillas_actualizado_por_idTousers || null,
						created_at: recargoData.created_at,
						updated_at: recargoData.updated_at
					},
					historial: [] // TODO: Obtener historial de cambios
				} as any;

				// Extraer info del servicio si existe
				if (recargoData.servicio_id && (recargoData as any).servicio) {
					const svc = (recargoData as any).servicio;
					servicioInfo = {
						origen: svc.municipios_servicio_origen_idTomunicipios || null,
						destino: svc.municipios_servicio_destino_idTomunicipios || null,
						origen_especifico: svc.origen_especifico || '',
						destino_especifico: svc.destino_especifico || '',
						proposito_servicio: svc.proposito_servicio || '',
						observaciones: svc.observaciones || '',
						fecha_solicitud: svc.fecha_solicitud || ''
					};
				} else {
					servicioInfo = null;
				}

				mesAño = { mes: recargoData.mes, año: (recargoData as any).a_o || recargoData.año };

				// Cargar archivo si existe
				if (recargoData.planilla_s3key) {
					const url = await getPresignedUrl(recargoData.planilla_s3key);
					archivoExistente = url;
				} else {
					archivoExistente = null;
				}

				// Cargar el preview monetario (total a pagar + desglose por día)
				if (recargo && recargo.conductor_id) {
					await cargarPreviewValor(recargo as RecargoDetallado);
				}
			} else {
				throw new Error('No se encontró información del recargo');
			}
		} catch (err) {
			error = 'No se pudo cargar la información del recargo';
			console.error('Error cargando recargo:', err);
		} finally {
			isLoadingData = false;
		}
	} // Función para descargar archivo
	async function descargarArchivoExistente() {
		if (!recargo?.planilla_s3key) {
			alert('No hay planilla asociada a este recargo');
			return;
		}

		const url = await getPresignedUrl(recargo.planilla_s3key);
		if (url) {
			window.open(url, '_blank');
		} else {
			alert('No se pudo obtener el enlace de descarga de la planilla');
		}
	}

	function handleClose() {
		recargo = null;
		error = null;
		mesAño = null;
		archivoExistente = null;
		servicioInfo = null;
		selectedTab = 'detalles';
		previewPlanilla = null;
		previewError = null;
		isLoadingPreview = false;
		isOpen = false;
	}

	// Función para visualizar el PDF o la imagen adjunta
	async function visualizarArchivo() {
		if (!recargo?.planilla_s3key) {
			alert('No hay planilla asociada a este recargo');
			return;
		}

		/// Con URL firmada y no con `/api/documentos/ver/<key>`: esa ruta ahora
		/// pide sesión y una pestaña nueva no lleva el token. La pestaña se abre
		/// antes del `await` para que el navegador no la trate como popup.
		const pestana = window.open('', '_blank');
		const url = await getPresignedUrl(recargo.planilla_s3key);
		if (!url) {
			pestana?.close();
			alert('No se pudo abrir la planilla. Intenta de nuevo.');
			return;
		}
		if (pestana) pestana.location.href = url;
		else window.open(url, '_blank');
	}

	// Computed values
	$: infoRecargo =
		recargo && mesAño
			? {
					conductor: recargo.conductor || {},
					vehiculo: recargo.vehiculo || {},
					empresa: recargo.empresa || {},
					planilla: recargo.numero_planilla || `Planilla ${getNombreMes(mesAño.mes)} ${mesAño.año}`,
					totalDias: recargo.total_dias || 0,
					mesAño: `${getNombreMes(mesAño.mes)} ${mesAño.año}`
				}
			: null;

	// Asegurar que dias_laborales siempre sea un array
	$: diasLaborales = recargo?.dias_laborales || [];

	// Asegurar que historial siempre sea un array
	$: historial = recargo?.historial || [];

	// Asegurar que auditoria tenga valores por defecto seguros
	$: auditoria = recargo?.auditoria || {
		version: 1,
		creado_por: { nombre: 'Sistema', apellido: '', email: 'sistema@cotransmeq.com' },
		created_at: null,
		actualizado_por: null,
		updated_at: null
	};

	$: totales =
		diasLaborales.length && recargo
			? {
					totalHoras: recargo.total_horas || 0,
					totalesRecargos: diasLaborales.reduce(
						(acc, dia) => ({
							HED: acc.HED + (dia.hed || 0),
							HEN: acc.HEN + (dia.hen || 0),
							HEFD: acc.HEFD + (dia.hefd || 0),
							HEFN: acc.HEFN + (dia.hefn || 0),
							RNDF: acc.RNDF + (dia.rndf || 0),
							RN: acc.RN + (dia.rn || 0),
							RD: acc.RD + (dia.rd || 0)
						}),
						{ HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RNDF: 0, RN: 0, RD: 0 }
					)
				}
			: {
					totalHoras: 0,
					totalesRecargos: { HED: 0, HEN: 0, HEFD: 0, HEFN: 0, RNDF: 0, RN: 0, RD: 0 }
				};

	// Cargar datos cuando se abre el modal
	$: if (isOpen && recargoId) {
		cargarDatosRecargo(recargoId);
	}

	function formatearFecha(fecha: string): string {
		return new Date(fecha).toLocaleString('es-CO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function traducirAccion(accion: string): string {
		const traducciones: Record<string, string> = {
			creacion: 'Creación',
			actualizacion: 'Actualización',
			eliminacion: 'Eliminación',
			restauracion: 'Restauración',
			aprobacion: 'Aprobación',
			rechazo: 'Rechazo'
		};
		return traducciones[accion] || accion;
	}

	function getColorAccion(accion: string): string {
		const colores: Record<string, string> = {
			creacion: 'bg-green-100 text-green-700',
			actualizacion: 'bg-blue-100 text-blue-700',
			eliminacion: 'bg-red-100 text-red-700',
			restauracion: 'bg-purple-100 text-purple-700',
			aprobacion: 'bg-orange-100 text-orange-700',
			rechazo: 'bg-orange-100 text-orange-700'
		};
		return colores[accion] || 'bg-gray-100 text-gray-700';
	}
</script>

<ModalBase
	open={isOpen}
	eyebrow="Recargos"
	title="Detalle de recargo"
	subtitle={infoRecargo?.mesAño ?? null}
	tamano="xl"
	oncerrar={handleClose}
>
	{#snippet accionesCabecera()}
		{#if recargo}
			{#if recargo.planilla_s3key}
				<span class="vr-chip-hero" title="Documento adjunto disponible">
					<FileText size={12} strokeWidth={2.5} />
					Documento
				</span>
			{:else}
				<span class="vr-chip-hero vr-chip-hero--apagado" title="Sin documento adjunto">
					<FileX size={12} strokeWidth={2.5} />
					Sin documento
				</span>
			{/if}
		{/if}
	{/snippet}

	{#snippet cabecera()}
		{#if !isLoadingData && !error && recargo && infoRecargo}
			<TabsVista
				variante="oscuro"
				etiqueta="Secciones del recargo"
				tabs={[
					{ id: 'detalles', label: 'Detalles' },
					{ id: 'auditoria', label: 'Auditoría' },
					{
						id: 'historial',
						label: 'Historial',
						cuenta: historial.length > 0 ? historial.length : null
					}
				]}
				bind:activa={selectedTab}
			/>
		{/if}
	{/snippet}

	{#if isLoadingData}
		<CargaMascota texto="Cargando información del recargo…" />
	{:else if error}
		<div class="vr-estado vr-estado--error" role="alert">
			<CircleAlert size={28} strokeWidth={2} />
			<p>{error}</p>
		</div>
	{:else if recargo && infoRecargo}
		{#if selectedTab === 'detalles'}
			<!-- Información principal -->
			<section class="vr-seccion">
				<h3 class="vr-titulo">Datos del recargo</h3>
				<div class="vr-grid">
					<Dato etiqueta="Conductor">
						{`${infoRecargo.conductor.apellido} ${infoRecargo.conductor.nombre}`}
						<span class="vr-sub">CC: {infoRecargo.conductor.numero_identificacion}</span>
					</Dato>
					<Dato etiqueta="Vehículo" valor={infoRecargo.vehiculo.placa} mono />
					<Dato etiqueta="Número de planilla" valor={infoRecargo.planilla} mono />
					<Dato etiqueta="Empresa">
						{infoRecargo.empresa.nombre}
						<span class="vr-sub">NIT: {infoRecargo.empresa.nit}</span>
					</Dato>
				</div>
			</section>

			<!-- Información del servicio asociado -->
			{#if servicioInfo}
				<section class="vr-seccion">
					<h3 class="vr-titulo">Servicio asociado</h3>
					<p class="vr-nota">Información del servicio vinculado</p>
					<div class="vr-grid">
						<Dato etiqueta="Origen">
							{#if servicioInfo.origen}
								{servicioInfo.origen.nombre_municipio}
								<span class="vr-sub">
									{servicioInfo.origen.nombre_departamento}
									<span class="vr-chip vr-chip--neutro vr-chip--num">
										DIVIPOLA: {servicioInfo.origen.codigo_municipio}
									</span>
								</span>
								{#if servicioInfo.origen_especifico}
									<span class="vr-sub">{servicioInfo.origen_especifico}</span>
								{/if}
							{:else}
								<span class="vr-nulo">No disponible</span>
							{/if}
						</Dato>
						<Dato etiqueta="Destino">
							{#if servicioInfo.destino}
								{servicioInfo.destino.nombre_municipio}
								<span class="vr-sub">
									{servicioInfo.destino.nombre_departamento}
									<span class="vr-chip vr-chip--neutro vr-chip--num">
										DIVIPOLA: {servicioInfo.destino.codigo_municipio}
									</span>
								</span>
								{#if servicioInfo.destino_especifico}
									<span class="vr-sub">{servicioInfo.destino_especifico}</span>
								{/if}
							{:else}
								<span class="vr-nulo">No disponible</span>
							{/if}
						</Dato>
						<Dato etiqueta="Tipo de servicio">
							<span
								class="vr-chip"
								class:vr-chip--neutro={servicioInfo.proposito_servicio !== 'personal' &&
									servicioInfo.proposito_servicio !== 'personal_y_herramienta'}
								class:vr-chip--info={servicioInfo.proposito_servicio === 'personal'}
								class:vr-chip--marca={servicioInfo.proposito_servicio === 'personal_y_herramienta'}
							>
								{servicioInfo.proposito_servicio === 'personal'
									? 'Personal'
									: servicioInfo.proposito_servicio === 'personal_y_herramienta'
										? 'Personal y Herramienta'
										: servicioInfo.proposito_servicio || 'No especificado'}
							</span>
						</Dato>
						{#if servicioInfo.observaciones}
							<Dato etiqueta="Observaciones" valor={servicioInfo.observaciones} completo />
						{/if}
					</div>
				</section>
			{/if}

			<!-- Resumen de totales -->
			<section class="vr-seccion">
				<h3 class="vr-titulo">Resumen de horas</h3>
				<div class="vr-card vr-resumen">
					<div class="vr-stat vr-stat--principal">
						<span class="vr-stat-valor">{formatearHoras(totales.totalHoras)}</span>
						<span class="vr-stat-label">Total</span>
					</div>
					<div class="vr-stat vr-stat--principal">
						<span class="vr-stat-valor">{infoRecargo.totalDias}</span>
						<span class="vr-stat-label">Días</span>
					</div>
					{#each [{ key: 'HED', value: totales.totalesRecargos.HED, label: 'HED', percent: '25%' }, { key: 'HEN', value: totales.totalesRecargos.HEN, label: 'HEN', percent: '75%' }, { key: 'HEFD', value: totales.totalesRecargos.HEFD, label: 'HEFD', percent: '100%' }, { key: 'HEFN', value: totales.totalesRecargos.HEFN, label: 'HEFN', percent: '150%' }, { key: 'RNDF', value: totales.totalesRecargos.RNDF, label: 'RNDF', percent: '115%' }, { key: 'RN', value: totales.totalesRecargos.RN, label: 'RN', percent: '35%' }, { key: 'RD', value: totales.totalesRecargos.RD, label: 'RD', percent: '75%' }] as { key, value, label, percent } (key)}
						<div class="vr-stat">
							<span class="vr-stat-valor">{formatearHoras(value)}</span>
							<span class="vr-stat-label">{label}</span>
							<span class="vr-stat-pct">{percent}</span>
						</div>
					{/each}
				</div>
			</section>

			<!-- ═══ Valor a Pagar (cálculo monetario del período) ═══ -->
			<!-- Replica la lógica de RecargosDesgloseModal: muestra el total a pagar
			     generado por los recargos del período y el desglose por día. -->
			<section class="vr-seccion">
				<div class="vr-titulo-fila">
					<div>
						<h3 class="vr-titulo">Valor a pagar · Recargos del período</h3>
						<p class="vr-nota">Cálculo automático con config salarial y % vigentes por día</p>
					</div>
					{#if isLoadingPreview}
						<span class="vr-calculando" aria-live="polite">
							<span class="vr-spinner vr-spinner--sm" aria-hidden="true"></span>
							Calculando…
						</span>
					{/if}
				</div>

				{#if previewError && !isLoadingPreview}
					<div class="vr-aviso">{previewError}</div>
				{:else if previewPlanilla}
					<div class="vr-card">
						<!-- Total a pagar destacado -->
						<div class="vr-total">
							<span class="vr-total-valor">{fmtCOP(previewPlanilla.total_valor)}</span>
							<span class="vr-total-label">Total del recargo</span>
						</div>

						<!-- Desglose por día -->
						{#if previewPlanilla.dias.length > 0}
							<div class="vr-tabla-wrap">
								<table class="vr-tabla">
									<thead>
										<tr>
											<th>Día</th>
											<th>Tipo</th>
											<th class="vr-der">Horas</th>
											<th class="vr-der">Valor del día</th>
										</tr>
									</thead>
									<tbody>
										{#each previewPlanilla.dias.slice().sort((a, b) => a.dia - b.dia) as d}
											<tr class:vr-fila-disponible={d.disponibilidad}>
												<td>
													<span
														class="vr-dia"
														class:vr-dia--festivo={d.es_festivo}
														class:vr-dia--domingo={!d.es_festivo && d.es_domingo}
													>
														{String(d.dia).padStart(2, '0')}
													</span>
												</td>
												<td>
													{#if d.disponibilidad}
														<span class="vr-tipo-texto vr-tipo-texto--apagado">Disponible</span>
													{:else if d.es_festivo}
														<span class="vr-chip vr-chip--festivo">Festivo</span>
													{:else if d.es_domingo}
														<span class="vr-chip vr-chip--domingo">Domingo</span>
													{:else}
														<span class="vr-tipo-texto">Normal</span>
													{/if}
												</td>
												<td class="vr-der vr-num">{formatearHoras(d.total_horas)}h</td>
												<td
													class="vr-der vr-num vr-valor-dia"
													class:vr-valor-dia--apagado={d.disponibilidad}
												>
													{d.disponibilidad ? '—' : fmtCOP(d.total_valor_dia)}
												</td>
											</tr>
										{/each}
									</tbody>
									<tfoot>
										<tr>
											<td colspan="3" class="vr-der">Total</td>
											<td class="vr-der vr-num">{fmtCOP(previewPlanilla.total_valor)}</td>
										</tr>
									</tfoot>
								</table>
							</div>
						{:else}
							<p class="vr-vacio-texto">
								Este recargo no tiene días con recargos monetizables dentro del período.
							</p>
						{/if}
					</div>
				{/if}
			</section>

			<!-- Días laborales -->
			<section class="vr-seccion">
				<div class="vr-titulo-fila">
					<h3 class="vr-titulo">Días laborales</h3>
					<span class="vr-nota">{diasLaborales.length} días registrados</span>
				</div>
				<div class="vr-dias">
					{#each diasLaborales as dia (dia.id)}
						{@const recargosDelDia = {
							HED: dia.hed || 0,
							HEN: dia.hen || 0,
							HEFD: dia.hefd || 0,
							HEFN: dia.hefn || 0,
							RNDF: dia.rndf || 0,
							RN: dia.rn || 0,
							RD: dia.rd || 0
						}}
						{@const tieneRecargos = Object.values(recargosDelDia).some((valor) => valor > 0)}

						<div class="vr-card vr-dia-card">
							<!-- Encabezado del día -->
							<div class="vr-dia-cabecera">
								<div class="vr-dia-id">
									<span class="vr-dia vr-dia--grande">{dia.dia}</span>
									{#if dia.es_especial}
										<span class="vr-chip vr-chip--peligro">
											{dia.es_domingo ? 'DOM' : 'FEST'}
										</span>
									{/if}
								</div>
								<span class="vr-dia-horas">{formatearHoras(dia.total_horas)}h</span>
							</div>

							<!-- Horario -->
							<p class="vr-dia-horario">{dia.hora_inicio}:00 - {dia.hora_fin}:00</p>

							<!-- Recargos -->
							{#if tieneRecargos}
								<div class="vr-dia-recargos">
									{#each [{ key: 'HED', color: 'bg-green-50 text-green-700', value: recargosDelDia.HED }, { key: 'HEN', color: 'bg-blue-50 text-blue-700', value: recargosDelDia.HEN }, { key: 'HEFD', color: 'bg-orange-50 text-orange-700', value: recargosDelDia.HEFD }, { key: 'HEFN', color: 'bg-purple-50 text-purple-700', value: recargosDelDia.HEFN }, { key: 'RNDF', color: 'bg-indigo-50 text-indigo-700', value: recargosDelDia.RNDF }, { key: 'RN', color: 'bg-teal-50 text-teal-700', value: recargosDelDia.RN }, { key: 'RD', color: 'bg-red-50 text-red-700', value: recargosDelDia.RD }] as { key, color, value } (key)}
										{#if value > 0}
											<div class="vr-recargo {color}">
												<span>{key}:</span>
												<span class="vr-num">{formatearHoras(value)}h</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>

			<!-- Información adicional -->
			<section class="vr-seccion">
				<h3 class="vr-titulo">Información del sistema</h3>
				<div class="vr-grid">
					<Dato etiqueta="ID" valor={recargo.id} mono completo />
				</div>
			</section>
		{:else if selectedTab === 'auditoria'}
			<!-- Información de creación -->
			<section class="vr-seccion">
				<h3 class="vr-titulo">Creación del recargo</h3>
				<p class="vr-nota">Versión {auditoria.version}</p>
				<div class="vr-grid">
					<Dato etiqueta="Creado por">
						{auditoria.creado_por.nombre}
						{auditoria.creado_por.apellido}
						<span class="vr-sub">{auditoria.creado_por.email}</span>
					</Dato>
					<Dato
						etiqueta="Fecha de creación"
						valor={auditoria.created_at ? formatearFecha(auditoria.created_at) : 'No disponible'}
					/>
				</div>
			</section>

			<!-- Información de última actualización -->
			{#if auditoria.actualizado_por}
				<section class="vr-seccion">
					<h3 class="vr-titulo">Última actualización</h3>
					<p class="vr-nota">Versión {auditoria.version}</p>
					<div class="vr-grid">
						<Dato etiqueta="Actualizado por">
							{auditoria.actualizado_por.nombre}
							{auditoria.actualizado_por.apellido}
							<span class="vr-sub">{auditoria.actualizado_por.email}</span>
						</Dato>
						<Dato
							etiqueta="Fecha de actualización"
							valor={auditoria.updated_at ? formatearFecha(auditoria.updated_at) : 'No disponible'}
						/>
					</div>
				</section>
			{/if}

			<!-- Información adicional -->
			<section class="vr-seccion">
				<h3 class="vr-titulo">Registro</h3>
				<div class="vr-grid vr-grid--3">
					<Dato etiqueta="Estado">
						<span class="vr-chip vr-chip--marca vr-chip--mayus">{recargo.estado}</span>
					</Dato>
					<Dato etiqueta="Versión" valor={`v${auditoria.version}`} />
					<Dato etiqueta="ID del sistema" valor={recargo.id} mono />
					{#if recargo.observaciones}
						<Dato etiqueta="Observaciones" valor={recargo.observaciones} completo />
					{/if}
				</div>
			</section>
		{:else if selectedTab === 'historial'}
			{#if !historial || historial.length === 0}
				<div class="vr-estado">
					<History size={28} strokeWidth={2} />
					<p>No hay cambios registrados en el historial</p>
				</div>
			{:else}
				<section class="vr-seccion">
					<h3 class="vr-titulo">Historial de cambios</h3>
					<div class="vr-historial">
						{#each historial
							.slice()
							.sort((a, b) => (b.version_nueva ?? 0) - (a.version_nueva ?? 0)) as item}
							<div class="vr-card">
								<div class="vr-historial-cabecera">
									<div class="vr-historial-accion">
										<span class="vr-chip {getColorAccion(item.accion)}">
											{traducirAccion(item.accion)}
										</span>
										<span class="vr-nota vr-num">
											v{item.version_anterior} → v{item.version_nueva}
										</span>
									</div>
									<span class="vr-nota">{formatearFecha(item.created_at)}</span>
								</div>

								<div class="vr-historial-usuario">
									<User size={14} strokeWidth={2} />
									{#if item.usuario}
										<strong>{item.usuario.nombre} {item.usuario.apellido}</strong>
										<span class="vr-nota">({item.usuario.email})</span>
									{:else}
										<span class="vr-nota">Usuario no disponible</span>
									{/if}
								</div>

								{#if item.campos_modificados && item.campos_modificados.length > 0}
									<div class="vr-historial-bloque">
										<span class="vr-etiqueta">Campos modificados:</span>
										<div class="vr-chips">
											{#each item.campos_modificados as campo}
												<span class="vr-chip vr-chip--neutro">{campo}</span>
											{/each}
										</div>
									</div>
								{/if}

								{#if item.motivo}
									<div class="vr-historial-bloque">
										<span class="vr-etiqueta">Motivo:</span>
										<p class="vr-texto">{item.motivo}</p>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/if}
	{/if}

	{#snippet pie()}
		<button type="button" onclick={handleClose} class="btn-secondary">Cerrar</button>
		{#if recargo?.planilla_s3key}
			<!-- Botón para PDF o imagen -->
			<button
				type="button"
				onclick={visualizarArchivo}
				class="btn-primary"
				title="Visualizar adjunto"
			>
				<Eye size={16} strokeWidth={2} />
				Ver archivo
			</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	/* Chip del encabezado oscuro: estado del documento adjunto. */
	.vr-chip-hero {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.14);
		color: #fff;
		font-size: 12px;
		font-weight: 800;
		white-space: nowrap;
	}
	.vr-chip-hero--apagado {
		background: rgba(255, 255, 255, 0.06);
		color: rgba(255, 255, 255, 0.62);
	}

	/* Estados del cuerpo: cargando, error, vacío. */
	.vr-estado {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		min-height: 220px;
		color: var(--text-muted);
		font-size: 14px;
		font-weight: 600;
		text-align: center;
	}
	.vr-estado p {
		margin: 0;
	}
	.vr-estado--error {
		color: #dc2626;
	}
	.vr-spinner {
		width: 28px;
		height: 28px;
		border-radius: 999px;
		border: 3px solid var(--border-default);
		border-top-color: var(--accion);
		animation: vr-giro 0.7s linear infinite;
	}
	.vr-spinner--sm {
		width: 14px;
		height: 14px;
		border-width: 2px;
	}
	@keyframes vr-giro {
		to {
			transform: rotate(360deg);
		}
	}

	/* Secciones: título en negrita sobre tarjetas blancas, como la app. */
	.vr-seccion + .vr-seccion {
		margin-top: 24px;
	}
	.vr-titulo {
		margin: 0 0 10px;
		color: var(--text-primary);
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.vr-titulo + .vr-nota {
		margin: -6px 0 10px;
	}
	.vr-titulo-fila {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 10px;
	}
	.vr-titulo-fila .vr-titulo {
		margin-bottom: 2px;
	}
	.vr-nota {
		margin: 0;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}
	.vr-etiqueta {
		display: block;
		margin-bottom: 6px;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 700;
	}
	.vr-texto {
		margin: 0;
		color: var(--text-secondary);
		font-size: 14px;
		font-weight: 600;
	}
	.vr-num {
		font-variant-numeric: tabular-nums;
	}
	.vr-der {
		text-align: right;
	}

	.vr-card {
		padding: 16px;
		border-radius: 18px;
		background: var(--bg-surface);
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}

	/* Rejilla de datos (tarjetas `Dato`). */
	.vr-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.vr-grid--3 {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.vr-sub {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
		color: var(--text-muted);
		font-size: 12.5px;
		font-weight: 600;
	}
	.vr-nulo {
		color: var(--text-very-muted);
		font-weight: 600;
		font-style: italic;
	}

	/* Chips suaves para estados y etiquetas. */
	.vr-chip {
		display: inline-flex;
		align-items: center;
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 700;
		white-space: nowrap;
	}
	/* Sin color propio: las clases de Tailwind (historial) ponen el suyo. */
	.vr-chip--neutro {
		background: var(--bg-base);
		color: var(--text-secondary);
	}
	.vr-chip--num {
		padding: 1px 8px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.vr-chip--marca {
		background: var(--color-emerald-100);
		color: var(--color-emerald-700);
	}
	.vr-chip--info {
		background: #dbeafe;
		color: #1d4ed8;
	}
	.vr-chip--festivo {
		background: rgba(245, 158, 11, 0.12);
		color: #92400e;
	}
	.vr-chip--domingo {
		background: rgba(168, 85, 247, 0.1);
		color: #6b21a8;
	}
	.vr-chip--peligro {
		background: #fef2f2;
		color: #dc2626;
	}
	.vr-chip--mayus {
		text-transform: uppercase;
	}
	.vr-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	/* Resumen de horas. */
	.vr-resumen {
		display: grid;
		grid-template-columns: repeat(9, minmax(0, 1fr));
		gap: 8px;
	}
	.vr-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 4px;
		border-radius: 14px;
		text-align: center;
	}
	.vr-stat--principal {
		background: var(--color-emerald-50);
	}
	.vr-stat-valor {
		color: var(--text-primary);
		font-size: 17px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.vr-stat--principal .vr-stat-valor {
		color: var(--color-emerald-700);
	}
	.vr-stat-label {
		color: var(--text-muted);
		font-size: 11px;
		font-weight: 700;
	}
	.vr-stat-pct {
		color: var(--text-very-muted);
		font-size: 11px;
		font-weight: 600;
	}

	/* Valor a pagar. */
	.vr-calculando {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}
	.vr-aviso {
		padding: 12px 14px;
		border-radius: 14px;
		background: #fff7ed;
		color: #c2410c;
		font-size: 13px;
		font-weight: 600;
	}
	.vr-total {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 10px;
		margin-bottom: 14px;
	}
	.vr-total-valor {
		color: var(--color-emerald-700);
		font-family: var(--font-display);
		font-size: 28px;
		font-weight: 900;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.vr-total-label {
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 700;
	}
	.vr-vacio-texto {
		margin: 0;
		color: var(--text-muted);
		font-size: 13px;
		font-style: italic;
	}
	.vr-tabla-wrap {
		overflow-x: auto;
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
	}
	.vr-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.vr-tabla th {
		padding: 9px 12px;
		background: var(--bg-base);
		color: var(--text-muted);
		font-size: 11px;
		font-weight: 800;
		text-align: left;
		white-space: nowrap;
	}
	.vr-tabla th.vr-der {
		text-align: right;
	}
	.vr-tabla td {
		padding: 8px 12px;
		border-top: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		font-weight: 600;
	}
	.vr-fila-disponible td {
		background: var(--bg-base);
	}
	.vr-tabla tfoot td {
		border-top: 2px solid var(--color-emerald-200);
		background: var(--color-emerald-50);
		color: var(--color-emerald-700);
		font-size: 13px;
		font-weight: 800;
	}
	.vr-tabla tfoot td:last-child {
		font-size: 14px;
		font-variant-numeric: tabular-nums;
	}
	.vr-tabla td.vr-valor-dia {
		color: var(--color-emerald-700);
		font-weight: 800;
	}
	.vr-tabla td.vr-valor-dia--apagado {
		color: var(--text-very-muted);
	}
	.vr-tipo-texto {
		color: var(--text-muted);
		font-size: 12px;
	}
	.vr-tipo-texto--apagado {
		color: var(--text-very-muted);
	}

	/* Insignia del número de día. */
	.vr-dia {
		display: inline-grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 9px;
		background: var(--color-emerald-50);
		color: var(--color-emerald-700);
		font-size: 11px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.vr-dia--festivo {
		background: rgba(245, 158, 11, 0.12);
		color: #92400e;
	}
	.vr-dia--domingo {
		background: rgba(168, 85, 247, 0.1);
		color: #6b21a8;
	}
	.vr-dia--grande {
		width: 34px;
		height: 34px;
		border-radius: 11px;
		background: var(--bg-base);
		color: var(--text-primary);
		font-size: 14px;
	}

	/* Días laborales. */
	.vr-dias {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}
	.vr-dia-card {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.vr-dia-cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.vr-dia-id {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.vr-dia-horas {
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.vr-dia-horario {
		margin: 0;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.vr-dia-recargos {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.vr-recargo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 10px;
		border-radius: 10px;
		font-size: 12px;
		font-weight: 700;
	}

	/* Historial. */
	.vr-historial {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.vr-historial-cabecera {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 10px;
	}
	.vr-historial-accion {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.vr-historial-usuario {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font-size: 14px;
	}
	.vr-historial-usuario strong {
		color: var(--text-primary);
		font-weight: 800;
	}
	.vr-historial-bloque {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--border-subtle);
	}

	@media (max-width: 1024px) {
		.vr-dias {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 860px) {
		.vr-resumen {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
		.vr-dias {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 640px) {
		.vr-grid,
		.vr-grid--3,
		.vr-dias {
			grid-template-columns: minmax(0, 1fr);
		}
		.vr-resumen {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
