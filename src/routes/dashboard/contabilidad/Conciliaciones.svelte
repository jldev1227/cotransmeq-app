<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { procesarConciliacion, descargarExcelConciliacion } from '$lib/api/contabilidad';

	let contableFile: File | null = null;
	let liquidacionesFile: File | null = null;
	let processing = false;
	let downloading = false;
	let resultado: any = null;
	let error = '';

	let tabActiva: 'conciliadas' | 'soloContable' | 'soloHistorial' | 'anuladas' = 'conciliadas';

	let filtroCliente = '';
	let filtroTercero = '';
	let filtroMes = 0;
	let filtroAnio = 0;

	const TOLERANCIA_PESOS = 100;

	let dragOverContable = false;
	let dragOverLiquidaciones = false;

	let inputContable: HTMLInputElement;
	let inputLiquidaciones: HTMLInputElement;

	function handleContableSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			contableFile = target.files[0];
		}
	}

	function handleLiquidacionesSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			liquidacionesFile = target.files[0];
		}
	}

	function handleDrop(tipo: 'contable' | 'liquidaciones', e: DragEvent) {
		e.preventDefault();
		if (tipo === 'contable') dragOverContable = false;
		else dragOverLiquidaciones = false;

		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
			if (tipo === 'contable') contableFile = e.dataTransfer.files[0];
			else liquidacionesFile = e.dataTransfer.files[0];
		}
	}

	function handleDragOver(tipo: 'contable' | 'liquidaciones', e: DragEvent) {
		e.preventDefault();
		dragOverContable = true;
		dragOverLiquidaciones = true;
	}

	function handleDragLeave(tipo: 'contable' | 'liquidaciones') {
		if (tipo === 'contable') dragOverContable = false;
		else dragOverLiquidaciones = false;
	}

	function quitarArchivo(tipo: 'contable' | 'liquidaciones') {
		if (tipo === 'contable') {
			contableFile = null;
			if (inputContable) inputContable.value = '';
		} else {
			liquidacionesFile = null;
			if (inputLiquidaciones) inputLiquidaciones.value = '';
		}
	}

	async function procesar() {
		if (!contableFile || !liquidacionesFile) return;
		error = '';
		processing = true;
		resultado = null;

		try {
			resultado = await procesarConciliacion(contableFile, liquidacionesFile);
			tabActiva = 'conciliadas';
		} catch (err: any) {
			error = err?.response?.data?.error || err.message || 'Error procesando la conciliación';
		} finally {
			processing = false;
		}
	}

	async function descargarExcel() {
		if (!contableFile || !liquidacionesFile) return;
		downloading = true;
		try {
			const blob = await descargarExcelConciliacion(contableFile, liquidacionesFile);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			const now = new Date();
			a.download = `conciliacion_terceros_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (err: any) {
			error = err?.response?.data?.error || err.message || 'Error descargando Excel';
		} finally {
			downloading = false;
		}
	}

	function limpiarTodo() {
		contableFile = null;
		liquidacionesFile = null;
		resultado = null;
		error = '';
		if (inputContable) inputContable.value = '';
		if (inputLiquidaciones) inputLiquidaciones.value = '';
	}

	function formatMoney(val: number): string {
		return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val);
	}

	function getFileIcon(filename: string): string {
		if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) return '📊';
		if (filename.endsWith('.csv')) return '📄';
		return '📎';
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function unique(arr: string[]): string[] {
		return [...new Set(arr.filter(Boolean))];
	}

	function getTerceros(item: any): string {
		if (!item.liquidaciones) return '';
		return unique(item.liquidaciones.map((l: any) => l.nombreTercero || '')).join(', ');
	}

	function getPlacas(item: any): string {
		if (!item.liquidaciones) return '';
		return unique(item.liquidaciones.map((l: any) => l.placa || '')).join(', ');
	}

	function getLiquidaciones(item: any): string {
		if (!item.liquidaciones) return '';
		return unique(item.liquidaciones.map((l: any) => l.numLiquidacion || '')).join(', ');
	}

	function esDiferenciaOk(diferencia: number): boolean {
		return Math.abs(diferencia) <= TOLERANCIA_PESOS;
	}

	function parseFecha(fecha: string): { mes: number; anio: number } | null {
		if (!fecha) return null;
		const parts = fecha.split('/');
		if (parts.length >= 3) {
			return { mes: parseInt(parts[1], 10), anio: parseInt(parts[2], 10) };
		}
		return null;
	}

	$: clientesUnicos = resultado
		? unique([
				...(resultado.conciliadas || []).map((i: any) => i.cliente || ''),
				...(resultado.soloHistorial || []).map((i: any) => i.cliente || ''),
				...(resultado.anuladas || []).map((i: any) => i.cliente || '')
			]).sort()
		: [];

	$: tercerosUnicos = resultado
		? unique([
				...(resultado.conciliadas || []).flatMap((i: any) =>
					(i.liquidaciones || []).map((l: any) => l.nombreTercero || '')
				),
				...(resultado.soloContable || []).map((i: any) => i.terceroContable || ''),
				...(resultado.soloHistorial || []).flatMap((i: any) =>
					(i.liquidaciones || []).map((l: any) => l.nombreTercero || '')
				),
				...(resultado.anuladas || []).map((i: any) => i.nombreTercero || '')
			]).sort()
		: [];

	$: aniosUnicos = resultado
		? unique([
				...(resultado.conciliadas || []).map((i: any) => {
					const p = parseFecha(i.fechaElaboracion);
					return p ? String(p.anio) : '';
				}),
				...(resultado.soloContable || []).map((i: any) => {
					const p = parseFecha(i.fechaElaboracion);
					return p ? String(p.anio) : '';
				})
			]).sort()
		: [];

	const MESES_NOMBRES = [
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

	$: hayFiltroActivo = !!(filtroCliente || filtroTercero || filtroMes > 0 || filtroAnio > 0);

	function proyectarPorTercero(items: any[], campoTotal: string): any[] {
		if (!filtroTercero) return items;
		const proyectados: any[] = [];
		for (const item of items) {
			const liqsFiltradas = (item.liquidaciones || []).filter(
				(l: any) => (l.nombreTercero || '') === filtroTercero
			);
			if (liqsFiltradas.length === 0) continue;
			const nuevoTotal = liqsFiltradas.reduce(
				(s: number, l: any) => s + (l.valorLiquidar ?? l.total ?? 0),
				0
			);
			proyectados.push({
				...item,
				liquidaciones: liqsFiltradas,
				[campoTotal]: nuevoTotal
			});
		}
		return proyectados;
	}

	$: conciliadasFiltradas = (() => {
		if (!resultado) return [];
		let items = (resultado.conciliadas || []).filter((item: any) => {
			if (filtroCliente && item.cliente !== filtroCliente) return false;
			if (filtroTercero) {
				const terceros = (item.liquidaciones || []).map((l: any) => l.nombreTercero || '');
				if (!terceros.includes(filtroTercero)) return false;
			}
			if (filtroMes > 0 || filtroAnio > 0) {
				const p = parseFecha(item.fechaElaboracion);
				if (!p) return false;
				if (filtroMes > 0 && p.mes !== filtroMes) return false;
				if (filtroAnio > 0 && p.anio !== filtroAnio) return false;
			}
			return true;
		});
		return proyectarPorTercero(items, 'valorLiquidarTotal');
	})();

	$: soloContableFiltrado = resultado
		? (resultado.soloContable || []).filter((item: any) => {
				if (filtroTercero && item.terceroContable !== filtroTercero) return false;
				if (filtroMes > 0 || filtroAnio > 0) {
					const p = parseFecha(item.fechaElaboracion);
					if (!p) return false;
					if (filtroMes > 0 && p.mes !== filtroMes) return false;
					if (filtroAnio > 0 && p.anio !== filtroAnio) return false;
				}
				return true;
			})
		: [];

	$: soloHistorialFiltrado = (() => {
		if (!resultado) return [];
		let items = (resultado.soloHistorial || []).filter((item: any) => {
			if (filtroCliente && item.cliente !== filtroCliente) return false;
			if (filtroTercero) {
				const terceros = (item.liquidaciones || []).map((l: any) => l.nombreTercero || '');
				if (!terceros.includes(filtroTercero)) return false;
			}
			if (filtroMes > 0 || filtroAnio > 0) {
				const p = parseFecha(item.fechaElaboracion);
				if (!p) return false;
				if (filtroMes > 0 && p.mes !== filtroMes) return false;
				if (filtroAnio > 0 && p.anio !== filtroAnio) return false;
			}
			return true;
		});
		return proyectarPorTercero(items, 'totalHistorial');
	})();

	$: anuladasFiltradas = resultado
		? (resultado.anuladas || []).filter((item: any) => {
				if (filtroCliente && item.cliente !== filtroCliente) return false;
				if (filtroTercero && item.nombreTercero !== filtroTercero) return false;
				return true;
			})
		: [];

	$: filteredTotalCredito = (() => {
		let sum = 0;
		for (const it of conciliadasFiltradas) sum += it.creditoContable || 0;
		for (const it of soloContableFiltrado) sum += it.creditoContable || 0;
		return sum;
	})();

	$: filteredTotalHistorial = (() => {
		let sum = 0;
		for (const it of conciliadasFiltradas) sum += it.valorLiquidarTotal || 0;
		for (const it of soloHistorialFiltrado) sum += it.totalHistorial || 0;
		return sum;
	})();

	$: filteredDiferenciasDetectadas = conciliadasFiltradas.filter(
		(it: any) => !esDiferenciaOk(it.diferencia)
	).length;

	function limpiarFiltros() {
		filtroCliente = '';
		filtroTercero = '';
		filtroMes = 0;
		filtroAnio = 0;
	}
</script>

<div class="conc-page" in:fade={{ duration: 300 }}>
	<div class="conc-header">
		<div class="conc-header-left">
			<div class="conc-header-icon">🔍</div>
			<div>
				<h1 class="conc-title">Conciliación de Cuentas de Terceros</h1>
				<p class="conc-subtitle">Compara facturas del software contable con el historial de liquidaciones de servicios</p>
			</div>
		</div>
		{#if resultado}
			<div class="conc-header-actions">
				<button class="conc-btn conc-btn-outline" onclick={limpiarTodo}>🔄 Nueva conciliación</button>
				<button class="conc-btn conc-btn-success" onclick={descargarExcel} disabled={downloading}>
					{#if downloading}
						<span class="conc-spinner-sm"></span> Generando...
					{:else}
						📥 Descargar Excel
					{/if}
				</button>
			</div>
		{/if}
	</div>

	{#if !resultado}
		<div class="conc-upload-section" in:fly={{ y: 20, duration: 300, delay: 100 }}>
			<div class="conc-upload-grid">
				<div
					class="conc-upload-card {dragOverContable ? 'drag-over' : ''} {contableFile ? 'has-file' : ''}"
					ondrop={(e) => handleDrop('contable', e)}
					ondragover={(e) => handleDragOver('contable', e)}
					ondragleave={() => handleDragLeave('contable')}
					role="button"
					tabindex="0"
				>
					<div class="conc-upload-card-header">
						<span class="conc-upload-num">1</span>
						<h3>Movimiento Auxiliar Contable</h3>
					</div>
					<p class="conc-upload-desc">Archivo del software contable con códigos, comprobantes, terceros, débitos y créditos</p>

					{#if contableFile}
						<div class="conc-file-info" transition:slide={{ duration: 200 }}>
							<span class="conc-file-icon">{getFileIcon(contableFile.name)}</span>
							<div class="conc-file-details">
								<span class="conc-file-name">{contableFile.name}</span>
								<span class="conc-file-size">{formatFileSize(contableFile.size)}</span>
							</div>
							<button class="conc-file-remove" onclick={(e) => { e.stopPropagation(); quitarArchivo('contable'); }}>✕</button>
						</div>
					{:else}
						<div
							class="conc-dropzone"
							onclick={() => inputContable.click()}
							onkeydown={(e) => e.key === 'Enter' && inputContable.click()}
							role="button"
							tabindex="0"
						>
							<div class="conc-dropzone-icon">📊</div>
							<span>Arrastra el archivo aquí o <strong>haz clic</strong></span>
							<span class="conc-dropzone-hint">.xlsx, .xls, .csv</span>
						</div>
					{/if}
					<input
						type="file"
						accept=".xlsx,.xls,.csv"
						onchange={handleContableSelect}
						bind:this={inputContable}
						style="display:none"
					/>
				</div>

				<div class="conc-upload-arrows">
					<div class="conc-arrow-icon">⇄</div>
					<span class="conc-arrow-label">Conciliar</span>
				</div>

				<div
					class="conc-upload-card {dragOverLiquidaciones ? 'drag-over' : ''} {liquidacionesFile ? 'has-file' : ''}"
					ondrop={(e) => handleDrop('liquidaciones', e)}
					ondragover={(e) => handleDragOver('liquidaciones', e)}
					ondragleave={() => handleDragLeave('liquidaciones')}
					role="button"
					tabindex="0"
				>
					<div class="conc-upload-card-header">
						<span class="conc-upload-num">2</span>
						<h3>Historial de Liquidaciones</h3>
					</div>
					<p class="conc-upload-desc">Liquidaciones de servicios para terceros con clientes, placas, facturas e ingresos</p>

					{#if liquidacionesFile}
						<div class="conc-file-info" transition:slide={{ duration: 200 }}>
							<span class="conc-file-icon">{getFileIcon(liquidacionesFile.name)}</span>
							<div class="conc-file-details">
								<span class="conc-file-name">{liquidacionesFile.name}</span>
								<span class="conc-file-size">{formatFileSize(liquidacionesFile.size)}</span>
							</div>
							<button class="conc-file-remove" onclick={(e) => { e.stopPropagation(); quitarArchivo('liquidaciones'); }}>✕</button>
						</div>
					{:else}
						<div
							class="conc-dropzone"
							onclick={() => inputLiquidaciones.click()}
							onkeydown={(e) => e.key === 'Enter' && inputLiquidaciones.click()}
							role="button"
							tabindex="0"
						>
							<div class="conc-dropzone-icon">📋</div>
							<span>Arrastra el archivo aquí o <strong>haz clic</strong></span>
							<span class="conc-dropzone-hint">.xlsx, .xls, .csv</span>
						</div>
					{/if}
					<input
						type="file"
						accept=".xlsx,.xls,.csv"
						onchange={handleLiquidacionesSelect}
						bind:this={inputLiquidaciones}
						style="display:none"
					/>
				</div>
			</div>

			<div class="conc-process-bar">
				{#if error}
					<div class="conc-error" transition:slide={{ duration: 200 }}>⚠️ {error}</div>
				{/if}
				<button
					class="conc-btn conc-btn-primary conc-btn-lg"
					onclick={procesar}
					disabled={!contableFile || !liquidacionesFile || processing}
				>
					{#if processing}
						<span class="conc-spinner-sm"></span> Procesando conciliación...
					{:else}
						🔍 Procesar Conciliación
					{/if}
				</button>
			</div>
		</div>
	{/if}

	{#if resultado}
		<div class="conc-results" in:fly={{ y: 30, duration: 400 }}>
			<div class="conc-filters">
				<div class="conc-filter-item">
					<label for="f-cliente">Cliente</label>
					<select id="f-cliente" bind:value={filtroCliente}>
						<option value="">Todos</option>
						{#each clientesUnicos as c}<option value={c}>{c}</option>{/each}
					</select>
				</div>
				<div class="conc-filter-item">
					<label for="f-tercero">Tercero (Propietario)</label>
					<select id="f-tercero" bind:value={filtroTercero}>
						<option value="">Todos</option>
						{#each tercerosUnicos as t}<option value={t}>{t}</option>{/each}
					</select>
				</div>
				<div class="conc-filter-item">
					<label for="f-mes">Mes</label>
					<select id="f-mes" bind:value={filtroMes}>
						<option value={0}>Todos</option>
						{#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as m}<option value={m}>{MESES_NOMBRES[m]}</option>{/each}
					</select>
				</div>
				<div class="conc-filter-item">
					<label for="f-anio">Año</label>
					<select id="f-anio" bind:value={filtroAnio}>
						<option value={0}>Todos</option>
						{#each aniosUnicos as a}<option value={parseInt(a)}>{a}</option>{/each}
					</select>
				</div>
				{#if hayFiltroActivo}
					<button class="conc-btn-clear-filters" onclick={limpiarFiltros}>✕ Limpiar filtros</button>
				{/if}
			</div>

			<div class="conc-kpis">
				<div class="conc-kpi conc-kpi-blue">
					<span class="conc-kpi-icon">📄</span>
					<div>
						<span class="conc-kpi-value">{hayFiltroActivo ? conciliadasFiltradas.length + soloContableFiltrado.length : resultado.resumen.totalRegistrosContables}</span>
						<span class="conc-kpi-label">Reg. Contables</span>
					</div>
				</div>
				<div class="conc-kpi conc-kpi-indigo">
					<span class="conc-kpi-icon">📋</span>
					<div>
						<span class="conc-kpi-value">{hayFiltroActivo ? conciliadasFiltradas.length + soloHistorialFiltrado.length : resultado.resumen.totalLiquidaciones}</span>
						<span class="conc-kpi-label">Liquidaciones</span>
					</div>
				</div>
				<div class="conc-kpi conc-kpi-green">
					<span class="conc-kpi-icon">✅</span>
					<div>
						<span class="conc-kpi-value">{conciliadasFiltradas.length}</span>
						<span class="conc-kpi-label">Conciliadas</span>
					</div>
				</div>
				<div class="conc-kpi conc-kpi-orange">
					<span class="conc-kpi-icon">📊</span>
					<div>
						<span class="conc-kpi-value">{soloContableFiltrado.length}</span>
						<span class="conc-kpi-label">Solo Contable</span>
					</div>
				</div>
				<div class="conc-kpi conc-kpi-red">
					<span class="conc-kpi-icon">📋</span>
					<div>
						<span class="conc-kpi-value">{soloHistorialFiltrado.length}</span>
						<span class="conc-kpi-label">Solo Historial</span>
					</div>
				</div>
				<div class="conc-kpi conc-kpi-gray">
					<span class="conc-kpi-icon">🚫</span>
					<div>
						<span class="conc-kpi-value">{anuladasFiltradas.length}</span>
						<span class="conc-kpi-label">Anuladas</span>
					</div>
				</div>
				<div class="conc-kpi conc-kpi-yellow">
					<span class="conc-kpi-icon">⚠️</span>
					<div>
						<span class="conc-kpi-value">{filteredDiferenciasDetectadas}</span>
						<span class="conc-kpi-label">Diferencias</span>
					</div>
				</div>
			</div>

			<div class="conc-money-summary">
				<div class="conc-money-item">
					<span class="conc-money-label">Total Crédito Contable</span>
					<span class="conc-money-value">{formatMoney(filteredTotalCredito)}</span>
				</div>
				<div class="conc-money-divider">vs</div>
				<div class="conc-money-item">
					<span class="conc-money-label">Total V/Liquidar (Historial)</span>
					<span class="conc-money-value">{formatMoney(filteredTotalHistorial)}</span>
				</div>
				<div class="conc-money-divider">=</div>
				<div
					class="conc-money-item conc-money-diff"
					class:positive={filteredTotalCredito - filteredTotalHistorial >= 0}
					class:negative={filteredTotalCredito - filteredTotalHistorial < 0}
				>
					<span class="conc-money-label">Diferencia</span>
					<span class="conc-money-value">{formatMoney(Math.abs(filteredTotalCredito - filteredTotalHistorial))}</span>
				</div>
			</div>

			<div class="conc-tabs">
				<button
					class="conc-tab {tabActiva === 'conciliadas' ? 'active' : ''}"
					onclick={() => (tabActiva = 'conciliadas')}
				>
					✅ Conciliadas ({conciliadasFiltradas.length}{hayFiltroActivo &&
					conciliadasFiltradas.length !== resultado.conciliadas.length
						? ` / ${resultado.conciliadas.length}`
						: ''})
				</button>
				<button
					class="conc-tab {tabActiva === 'soloContable' ? 'active' : ''}"
					onclick={() => (tabActiva = 'soloContable')}
				>
					📊 Solo en Contable ({soloContableFiltrado.length}{hayFiltroActivo &&
					soloContableFiltrado.length !== resultado.soloContable.length
						? ` / ${resultado.soloContable.length}`
						: ''})
				</button>
				<button
					class="conc-tab {tabActiva === 'soloHistorial' ? 'active' : ''}"
					onclick={() => (tabActiva = 'soloHistorial')}
				>
					📋 Solo en Historial ({soloHistorialFiltrado.length}{hayFiltroActivo &&
					soloHistorialFiltrado.length !== resultado.soloHistorial.length
						? ` / ${resultado.soloHistorial.length}`
						: ''})
				</button>
				<button
					class="conc-tab {tabActiva === 'anuladas' ? 'active' : ''}"
					onclick={() => (tabActiva = 'anuladas')}
				>
					🚫 Anuladas ({anuladasFiltradas.length}{hayFiltroActivo &&
					anuladasFiltradas.length !== resultado.anuladas.length
						? ` / ${resultado.anuladas.length}`
						: ''})
				</button>
			</div>

			<div class="conc-table-container">
				{#if tabActiva === 'conciliadas'}
					{#if conciliadasFiltradas.length === 0}
						<div class="conc-empty">
							<span class="conc-empty-icon">📭</span>
							<p>{hayFiltroActivo
								? 'No hay resultados con los filtros seleccionados'
								: 'No hay facturas conciliadas'}</p>
						</div>
					{:else}
						<div class="conc-table-scroll">
							<table class="conc-table">
								<thead>
									<tr>
										<th># Factura</th>
										<th>Cliente</th>
										<th>Comprobante</th>
										<th>Fecha</th>
										<th>Tercero</th>
										<th class="text-right">Crédito Contable</th>
										<th class="text-right">V/Liquidar</th>
										<th class="text-right">Diferencia</th>
										<th>Estado</th>
										<th>Liquidaciones</th>
										<th>Placas</th>
									</tr>
								</thead>
								<tbody>
									{#each conciliadasFiltradas as item}
										<tr class={!esDiferenciaOk(item.diferencia) ? 'row-warning' : ''}>
											<td class="font-semibold">{item.numFactura}</td>
											<td>{item.cliente}</td>
											<td class="text-sm text-gray-500">{item.comprobante}</td>
											<td class="text-sm">{item.fechaElaboracion}</td>
											<td class="text-sm">{getTerceros(item)}</td>
											<td class="text-right font-mono">{formatMoney(item.creditoContable)}</td>
											<td class="text-right font-mono">{formatMoney(item.valorLiquidarTotal)}</td>
											<td class="text-right font-mono {!esDiferenciaOk(item.diferencia) ? 'text-red-600' : 'text-orange-600'}">{formatMoney(item.diferencia)}</td>
											<td>
												{#if esDiferenciaOk(item.diferencia)}
													<span class="conc-badge conc-badge-green">✓ OK</span>
												{:else}
													<span class="conc-badge conc-badge-yellow">⚠ Dif.</span>
												{/if}
											</td>
											<td class="text-xs text-gray-500">{getLiquidaciones(item)}</td>
											<td class="text-xs text-gray-500">{getPlacas(item)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{:else if tabActiva === 'soloContable'}
					{#if soloContableFiltrado.length === 0}
						<div class="conc-empty">
							<span class="conc-empty-icon">{hayFiltroActivo ? '📭' : '✅'}</span>
							<p>{hayFiltroActivo
								? 'No hay resultados con los filtros seleccionados'
								: 'Todas las facturas contables tienen correspondencia en el historial'}</p>
						</div>
					{:else}
						<div class="conc-table-scroll">
							<table class="conc-table">
								<thead>
									<tr>
										<th># Factura</th>
										<th>Comprobante</th>
										<th>Fecha</th>
										<th>NIT</th>
										<th>Tercero</th>
										<th class="text-right">Crédito</th>
										<th class="text-right">Débito</th>
										<th>Observación</th>
									</tr>
								</thead>
								<tbody>
									{#each soloContableFiltrado as item}
										<tr class="row-alert">
											<td class="font-semibold">{item.numFactura}</td>
											<td>{item.comprobante}</td>
											<td class="text-sm">{item.fechaElaboracion}</td>
											<td class="text-sm">{item.identificacion}</td>
											<td>{item.terceroContable}</td>
											<td class="text-right font-mono">{formatMoney(item.creditoContable)}</td>
											<td class="text-right font-mono">{formatMoney(item.debitoContable)}</td>
											<td class="text-xs text-orange-600">{item.observacion}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{:else if tabActiva === 'soloHistorial'}
					{#if soloHistorialFiltrado.length === 0}
						<div class="conc-empty">
							<span class="conc-empty-icon">{hayFiltroActivo ? '📭' : '✅'}</span>
							<p>{hayFiltroActivo
								? 'No hay resultados con los filtros seleccionados'
								: 'Todas las facturas del historial tienen correspondencia contable'}</p>
						</div>
					{:else}
						<div class="conc-table-scroll">
							<table class="conc-table">
								<thead>
									<tr>
										<th># Factura</th>
										<th>Cliente</th>
										<th>Liquidaciones</th>
										<th>Placas</th>
										<th>Terceros</th>
										<th class="text-right">Total Historial</th>
										<th>Observación</th>
									</tr>
								</thead>
								<tbody>
									{#each soloHistorialFiltrado as item}
										<tr class="row-alert-red">
											<td class="font-semibold">{item.numFactura}</td>
											<td>{item.cliente}</td>
											<td class="text-xs">{getLiquidaciones(item)}</td>
											<td class="text-xs">{getPlacas(item)}</td>
											<td class="text-xs">{getTerceros(item)}</td>
											<td class="text-right font-mono">{formatMoney(item.totalHistorial)}</td>
											<td class="text-xs text-red-600">{item.observacion}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{:else if tabActiva === 'anuladas'}
					{#if anuladasFiltradas.length === 0}
						<div class="conc-empty">
							<span class="conc-empty-icon">{hayFiltroActivo ? '📭' : '✅'}</span>
							<p>{hayFiltroActivo
								? 'No hay resultados con los filtros seleccionados'
								: 'No hay liquidaciones anuladas'}</p>
						</div>
					{:else}
						<div class="conc-table-scroll">
							<table class="conc-table">
								<thead>
									<tr>
										<th># Liquidación</th>
										<th>Cliente</th>
										<th>Placa</th>
										<th>Tercero</th>
										<th>Descripción</th>
										<th class="text-right">Total</th>
										<th># Factura</th>
										<th>Observación</th>
									</tr>
								</thead>
								<tbody>
									{#each anuladasFiltradas as item}
										<tr class="row-muted">
											<td class="font-semibold">{item.numLiquidacion}</td>
											<td>{item.cliente}</td>
											<td>{item.placa}</td>
											<td>{item.nombreTercero}</td>
											<td class="text-sm">{item.descripcion}</td>
											<td class="text-right font-mono">{formatMoney(item.total)}</td>
											<td class="text-sm text-gray-400">{item.numFactura}</td>
											<td class="text-xs text-gray-500">{item.observacion}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	{#if processing}
		<div class="conc-loading-overlay" transition:fade={{ duration: 200 }}>
			<div class="conc-loading-card">
				<div class="conc-spinner-lg"></div>
				<h3>Procesando conciliación...</h3>
				<p>Comparando registros contables con liquidaciones</p>
			</div>
		</div>
	{/if}
</div>

<style>
	.conc-page {
		padding: 1.5rem;
		max-width: 1400px;
		margin: 0 auto;
	}
	.conc-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.conc-header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.conc-header-icon {
		font-size: 2rem;
	}
	.conc-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #111;
		margin: 0;
	}
	.conc-subtitle {
		font-size: 0.85rem;
		color: #6b7280;
		margin: 0.125rem 0 0;
	}
	.conc-header-actions {
		display: flex;
		gap: 0.75rem;
	}
	.conc-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.25rem;
		border: none;
		border-radius: 0.75rem;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.conc-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.conc-btn-primary {
		background: #3b82f6;
		color: white;
	}
	.conc-btn-primary:hover:not(:disabled) {
		background: #2563eb;
	}
	.conc-btn-success {
		background: #f97316;
		color: white;
	}
	.conc-btn-success:hover:not(:disabled) {
		background: #ea580c;
	}
	.conc-btn-outline {
		background: white;
		color: #374151;
		border: 1px solid #e5e7eb;
	}
	.conc-btn-outline:hover {
		background: #f9fafb;
	}
	.conc-btn-lg {
		padding: 0.875rem 2rem;
		font-size: 1rem;
	}
	.conc-upload-section {
		margin-bottom: 1.5rem;
	}
	.conc-upload-grid {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 1.5rem;
		align-items: center;
		margin-bottom: 1.5rem;
	}
	.conc-upload-card {
		background: white;
		border: 2px dashed #e5e7eb;
		border-radius: 1rem;
		padding: 1.5rem;
		transition: all 0.3s;
	}
	.conc-upload-card.drag-over {
		border-color: #3b82f6;
		background: #eff6ff;
	}
	.conc-upload-card.has-file {
		border-color: #f97316;
		border-style: solid;
	}
	.conc-upload-card-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.conc-upload-num {
		width: 1.75rem;
		height: 1.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #3b82f6;
		color: white;
		border-radius: 50%;
		font-size: 0.8rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.conc-upload-card-header h3 {
		font-size: 1rem;
		font-weight: 600;
		color: #111;
		margin: 0;
	}
	.conc-upload-desc {
		font-size: 0.8rem;
		color: #6b7280;
		margin: 0 0 1rem;
	}
	.conc-dropzone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2rem;
		border-radius: 0.75rem;
		background: #f9fafb;
		cursor: pointer;
		transition: background 0.2s;
		text-align: center;
		font-size: 0.85rem;
		color: #6b7280;
	}
	.conc-dropzone:hover {
		background: #f3f4f6;
	}
	.conc-dropzone-icon {
		font-size: 2rem;
	}
	.conc-dropzone-hint {
		font-size: 0.7rem;
		color: #9ca3af;
	}
	.conc-file-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: #f0fdf4;
		border-radius: 0.75rem;
		border: 1px solid #bbf7d0;
	}
	.conc-file-icon {
		font-size: 1.5rem;
	}
	.conc-file-details {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.conc-file-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: #111;
		word-break: break-all;
	}
	.conc-file-size {
		font-size: 0.75rem;
		color: #6b7280;
	}
	.conc-file-remove {
		width: 1.5rem;
		height: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 50%;
		background: #fef2f2;
		color: #ef4444;
		cursor: pointer;
		font-size: 0.75rem;
		transition: background 0.2s;
	}
	.conc-file-remove:hover {
		background: #fee2e2;
	}
	.conc-upload-arrows {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}
	.conc-arrow-icon {
		font-size: 2rem;
		color: #9ca3af;
	}
	.conc-arrow-label {
		font-size: 0.75rem;
		color: #9ca3af;
		font-weight: 500;
	}
	.conc-process-bar {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}
	.conc-error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 0.75rem;
		padding: 0.75rem 1.25rem;
		color: #dc2626;
		font-size: 0.85rem;
		max-width: 600px;
		text-align: center;
	}
	.conc-kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.conc-kpi {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: white;
		border-radius: 1rem;
		border: 1px solid #e5e7eb;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
	}
	.conc-kpi-icon {
		font-size: 1.5rem;
	}
	.conc-kpi-value {
		font-size: 1.4rem;
		font-weight: 700;
		display: block;
	}
	.conc-kpi-label {
		font-size: 0.72rem;
		color: #6b7280;
	}
	.conc-kpi-blue .conc-kpi-value {
		color: #3b82f6;
	}
	.conc-kpi-indigo .conc-kpi-value {
		color: #6366f1;
	}
	.conc-kpi-green .conc-kpi-value {
		color: #f97316;
	}
	.conc-kpi-orange .conc-kpi-value {
		color: #f59e0b;
	}
	.conc-kpi-red .conc-kpi-value {
		color: #ef4444;
	}
	.conc-kpi-gray .conc-kpi-value {
		color: #6b7280;
	}
	.conc-kpi-yellow .conc-kpi-value {
		color: #eab308;
	}
	.conc-money-summary {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		padding: 1.25rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}
	.conc-money-item {
		text-align: center;
	}
	.conc-money-label {
		display: block;
		font-size: 0.75rem;
		color: #6b7280;
		margin-bottom: 0.25rem;
	}
	.conc-money-value {
		font-size: 1.1rem;
		font-weight: 700;
		color: #111;
		font-family: monospace;
	}
	.conc-money-divider {
		font-size: 1rem;
		color: #9ca3af;
		font-weight: 600;
	}
	.conc-money-diff.positive .conc-money-value {
		color: #f97316;
	}
	.conc-money-diff.negative .conc-money-value {
		color: #ef4444;
	}
	.conc-tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0;
		background: #f3f4f6;
		padding: 0.375rem;
		border-radius: 1rem 1rem 0 0;
		flex-wrap: wrap;
	}
	.conc-tab {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 0.625rem;
		background: transparent;
		color: #6b7280;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}
	.conc-tab:hover {
		background: white;
	}
	.conc-tab.active {
		background: white;
		color: #111;
		font-weight: 600;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}
	.conc-table-container {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 0 0 1rem 1rem;
		overflow: hidden;
	}
	.conc-table-scroll {
		overflow-x: auto;
	}
	.conc-table {
		width: 100%;
		border-collapse: collapse;
	}
	.conc-table thead {
		background: #f9fafb;
	}
	.conc-table th {
		padding: 0.75rem;
		text-align: left;
		font-size: 0.72rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid #e5e7eb;
		white-space: nowrap;
	}
	.conc-table td {
		padding: 0.625rem 0.75rem;
		font-size: 0.8rem;
		color: #374151;
		border-bottom: 1px solid #f3f4f6;
		white-space: nowrap;
	}
	.conc-table tr:hover {
		background: #f0f9ff;
	}
	.conc-table tr.row-warning {
		background: #fffbeb;
	}
	.conc-table tr.row-warning:hover {
		background: #fef3c7;
	}
	.conc-table tr.row-alert {
		background: #fff7ed;
	}
	.conc-table tr.row-alert:hover {
		background: #ffedd5;
	}
	.conc-table tr.row-alert-red {
		background: #fef2f2;
	}
	.conc-table tr.row-alert-red:hover {
		background: #fee2e2;
	}
	.conc-table tr.row-muted {
		background: #f9fafb;
		opacity: 0.75;
	}
	.text-right {
		text-align: right !important;
	}
	.text-sm {
		font-size: 0.8rem;
	}
	.text-xs {
		font-size: 0.72rem;
	}
	.font-semibold {
		font-weight: 600;
	}
	.font-mono {
		font-family: 'SF Mono', 'Fira Code', monospace;
	}
	.text-red-600 {
		color: #dc2626;
	}
	.text-orange-600 {
		color: #16a34a;
	}
	.text-orange-600 {
		color: #ea580c;
	}
	.text-gray-400 {
		color: #9ca3af;
	}
	.text-gray-500 {
		color: #6b7280;
	}
	.conc-badge {
		display: inline-flex;
		padding: 0.15rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.7rem;
		font-weight: 600;
	}
	.conc-badge-green {
		background: #dcfce7;
		color: #16a34a;
	}
	.conc-badge-yellow {
		background: #fef9c3;
		color: #ca8a04;
	}
	.conc-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 3rem;
		color: #6b7280;
		gap: 0.5rem;
	}
	.conc-empty-icon {
		font-size: 2.5rem;
	}
	.conc-loading-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.conc-loading-card {
		background: white;
		border-radius: 1.25rem;
		padding: 3rem;
		text-align: center;
		box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15);
	}
	.conc-loading-card h3 {
		margin: 1rem 0 0.25rem;
		font-size: 1.1rem;
		color: #111;
	}
	.conc-loading-card p {
		color: #6b7280;
		font-size: 0.85rem;
		margin: 0;
	}
	.conc-spinner-lg {
		width: 3rem;
		height: 3rem;
		margin: 0 auto;
		border: 4px solid #e5e7eb;
		border-top-color: #3b82f6;
		border-radius: 50%;
		animation: conc-spin 0.7s linear infinite;
	}
	.conc-spinner-sm {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: conc-spin 0.6s linear infinite;
	}
	@keyframes conc-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 768px) {
		.conc-page {
			padding: 1rem;
		}
		.conc-header {
			flex-direction: column;
			align-items: flex-start;
		}
		.conc-upload-grid {
			grid-template-columns: 1fr;
		}
		.conc-upload-arrows {
			flex-direction: row;
			padding: 0.5rem 0;
		}
		.conc-kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.conc-money-summary {
			flex-direction: column;
			gap: 0.75rem;
		}
		.conc-tabs {
			flex-wrap: wrap;
		}
		.conc-filters {
			flex-direction: column;
		}
	}
	.conc-filters {
		display: flex;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 1rem;
		margin-bottom: 1.25rem;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.conc-filter-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		flex: 1;
		max-width: 220px;
	}
	.conc-filter-item label {
		font-size: 0.7rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.conc-filter-item select {
		padding: 0.4rem 0.6rem;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		font-size: 0.8rem;
		color: #374151;
		background: white;
		cursor: pointer;
		appearance: auto;
	}
	.conc-filter-item select:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
	}
	.conc-btn-clear-filters {
		padding: 0.4rem 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		background: white;
		color: #6b7280;
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		align-self: flex-end;
	}
	.conc-btn-clear-filters:hover {
		background: #fef2f2;
		color: #ef4444;
		border-color: #fecaca;
	}
</style>
