<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type {
		EnvioImportableDto,
		FiltrosImportacionFormularios,
		PreviewImportacionFormularios,
		ResultadoImportacionFormularios
	} from '$lib/api/formularios';

	type EmpresaOrigen = 'COTRANSMEQ' | 'TRANSMERALDA';
	type PayloadImportacion = {
		seleccion: Array<{ submissionId: string; huella: string }>;
		crearConductoresFaltantes: boolean;
		crearVehiculosFaltantes: boolean;
	};
	type Props = {
		empresaOrigen: EmpresaOrigen;
		onclose: () => void;
		onimported?: () => void;
		previsualizar: (
			params: FiltrosImportacionFormularios
		) => Promise<PreviewImportacionFormularios>;
		ejecutarImportacion: (payload: PayloadImportacion) => Promise<ResultadoImportacionFormularios>;
	};
	let { empresaOrigen, onclose, onimported, previsualizar, ejecutarImportacion }: Props = $props();

	function fechaLocal(fecha = new Date()) {
		return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
	}
	function formatearFechaNegocio(fecha: string | null | undefined) {
		if (!fecha) return '—';
		const fechaIso = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (fechaIso) return `${fechaIso[3]}/${fechaIso[2]}/${fechaIso[1]}`;
		const valor = new Date(fecha);
		return Number.isNaN(valor.getTime())
			? fecha
			: valor.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
	}
	function hace30Dias() {
		const fecha = new Date();
		fecha.setDate(fecha.getDate() - 29);
		return fechaLocal(fecha);
	}

	let desde = $state(hace30Dias());
	let hasta = $state(fechaLocal());
	let estado = $state<'SUBMITTED' | 'VOIDED'>('SUBMITTED');
	let codigo = $state('');
	let busqueda = $state('');
	let crearConductores = $state(false);
	let crearVehiculos = $state(false);
	let pagina = $state(1);
	let total = $state(0);
	let paginas = $state(1);
	let filas = $state<EnvioImportableDto[]>([]);
	let seleccion = $state<Record<string, string>>({});
	let cargando = $state(false);
	let importando = $state(false);
	let error = $state('');
	let resultado = $state<ResultadoImportacionFormularios | null>(null);
	let consultaTimer: ReturnType<typeof setTimeout> | undefined;
	let revisionConsulta = 0;
	const tituloOrigen = $derived(empresaOrigen === 'COTRANSMEQ' ? 'Cotransmeq' : 'Transmeralda');
	const cantidadSeleccionada = $derived(Object.keys(seleccion).length);
	const visiblesImportables = $derived(
		filas.filter((fila) => fila.importable && !fila.yaImportado)
	);
	const todasSeleccionadas = $derived(
		visiblesImportables.length > 0 && visiblesImportables.every((fila) => seleccion[fila.id])
	);

	onMount(() => {
		void consultar();
		return () => {
			if (consultaTimer) clearTimeout(consultaTimer);
			revisionConsulta += 1;
		};
	});

	function parametros(): FiltrosImportacionFormularios {
		return {
			fechaDesde: desde,
			fechaHasta: hasta,
			estado: estado,
			codigoFormulario: codigo.trim() || undefined,
			busqueda: busqueda.trim() || undefined,
			pagina,
			porPagina: 50,
			crearConductoresFaltantes: crearConductores,
			crearVehiculosFaltantes: crearVehiculos
		};
	}

	function programarConsulta(limpiarSeleccion = true) {
		pagina = 1;
		if (limpiarSeleccion) seleccion = {};
		if (consultaTimer) clearTimeout(consultaTimer);
		const revision = ++revisionConsulta;
		error = '';
		cargando = true;
		consultaTimer = setTimeout(() => {
			consultaTimer = undefined;
			void consultar(false, revision);
		}, 300);
	}

	async function consultar(preservarResultado = false, revision = ++revisionConsulta) {
		if (consultaTimer) {
			clearTimeout(consultaTimer);
			consultaTimer = undefined;
		}
		cargando = true;
		error = '';
		if (!preservarResultado) resultado = null;
		try {
			const data = await previsualizar(parametros());
			if (revision !== revisionConsulta) return;
			filas = data.items;
			total = data.total;
			paginas = Math.max(1, data.paginas);
			const visibles = new Set(data.items.map((item) => item.id));
			const siguiente: Record<string, string> = {};
			for (const [id, hash] of Object.entries(seleccion))
				if (!visibles.has(id)) siguiente[id] = hash;
			for (const item of data.items) {
				if (item.importable && !item.yaImportado && seleccion[item.id])
					siguiente[item.id] = item.huella;
			}
			seleccion = siguiente;
		} catch (err) {
			if (revision !== revisionConsulta) return;
			error = err instanceof Error ? err.message : `No se pudo consultar ${tituloOrigen}.`;
		} finally {
			if (revision === revisionConsulta) cargando = false;
		}
	}

	function cambiarPagina(siguiente: number) {
		pagina = Math.max(1, Math.min(paginas, siguiente));
		void consultar();
	}

	function alternar(fila: EnvioImportableDto) {
		if (!fila.importable || fila.yaImportado) return;
		const siguiente = { ...seleccion };
		if (siguiente[fila.id]) delete siguiente[fila.id];
		else if (Object.keys(siguiente).length >= 100) {
			toast.error('Puedes importar hasta 100 envíos por lote.');
			return;
		} else siguiente[fila.id] = fila.huella;
		seleccion = siguiente;
	}

	function alternarTodos() {
		const siguiente = { ...seleccion };
		if (todasSeleccionadas) for (const fila of visiblesImportables) delete siguiente[fila.id];
		else {
			for (const fila of visiblesImportables) {
				if (Object.keys(siguiente).length >= 100) break;
				siguiente[fila.id] = fila.huella;
			}
		}
		seleccion = siguiente;
	}

	async function importar() {
		const items = Object.entries(seleccion).map(([submissionId, huella]) => ({
			submissionId,
			huella
		}));
		if (!items.length || items.length > 100) return;
		importando = true;
		error = '';
		try {
			const payload: PayloadImportacion = {
				seleccion: items,
				crearConductoresFaltantes: crearConductores,
				crearVehiculosFaltantes: crearVehiculos
			};
			const respuesta = await ejecutarImportacion(payload);
			resultado = respuesta;
			seleccion = {};
			if (respuesta.imported)
				toast.success(`${respuesta.imported} envío(s) importados desde ${tituloOrigen}.`);
			if (respuesta.failed)
				toast.error(
					`${respuesta.failed} envío(s) requieren revisión. Consulta el detalle del lote.`
				);
			onimported?.();
			await consultar(true);
		} catch (err) {
			error = err instanceof Error ? err.message : 'No fue posible completar la importación.';
		} finally {
			importando = false;
		}
	}
</script>

<div class="sombra">
	<dialog open class="modal" aria-modal="true" aria-labelledby="titulo-importacion">
		<header class="cabecera">
			<div>
				<p class="eyebrow">Intercambio de formularios</p>
				<h2 id="titulo-importacion">Importar desde {tituloOrigen}</h2>
				<p class="intro">
					Consulta envíos entregados o anulados. Cada envío conserva su versión, respuestas,
					historial y evidencia.
				</p>
			</div>
			<button class="cerrar" type="button" aria-label="Cerrar" onclick={onclose}>×</button>
		</header>

		<div class="filtros">
			<label
				><span>Desde · fecha de negocio</span><input
					type="date"
					bind:value={desde}
					onchange={() => programarConsulta()}
				/></label
			>
			<label
				><span>Hasta · fecha de negocio</span><input
					type="date"
					bind:value={hasta}
					onchange={() => programarConsulta()}
				/></label
			>
			<label
				><span>Estado</span><select bind:value={estado} onchange={() => programarConsulta()}
					><option value="SUBMITTED">Entregados</option><option value="VOIDED">Anulados</option
					></select
				></label
			>
			<label
				><span>Código del formulario</span><input
					maxlength="50"
					bind:value={codigo}
					oninput={() => programarConsulta()}
					placeholder="HSEQ-FR-08"
				/></label
			>
			<label class="ancho"
				><span>Buscar</span><input
					maxlength="120"
					bind:value={busqueda}
					oninput={() => programarConsulta()}
					placeholder="Formulario, conductor, documento o placa"
				/></label
			>
			<button
				type="button"
				class="boton secundario consultar"
				disabled={cargando || importando}
				onclick={() => {
					pagina = 1;
					void consultar();
				}}>{cargando ? 'Consultando…' : 'Actualizar ahora'}</button
			>
			<p class="ayuda-filtros">
				Los resultados se actualizan automáticamente al cambiar los filtros.
			</p>
		</div>

		<div class="opciones">
			<label class="check"
				><input
					type="checkbox"
					bind:checked={crearConductores}
					onchange={() => programarConsulta(false)}
				/><span>Crear conductores faltantes como inactivos</span></label
			>
			<label class="check"
				><input
					type="checkbox"
					bind:checked={crearVehiculos}
					onchange={() => programarConsulta(false)}
				/><span>Crear placas faltantes como inactivas</span></label
			>
			<p>
				Las cuentas de usuario no se crean. Los registros nuevos quedan inactivos hasta que el
				equipo local los revise.
			</p>
		</div>

		{#if error}<div class="alerta error" role="alert">{error}</div>{/if}
		{#if resultado}
			<div
				class:alerta-ok={resultado.failed === 0}
				class:alerta-parcial={resultado.failed > 0}
				class="resumen-lote"
				role="status"
			>
				Lote {resultado.batchId.slice(0, 8)}: {resultado.imported} importados, {resultado.alreadyImported}
				ya existían y {resultado.failed} fallidos.
			</div>
			<details class="detalle-lote">
				<summary>Ver resultado de cada envío</summary>
				<div class="detalle-items">
					{#each resultado.results as item (item.submissionId)}
						<div class="detalle-item">
							<code>{item.submissionId.slice(0, 8)}</code>
							<span
								>{item.estado === 'IMPORTED'
									? 'Importado'
									: item.estado === 'ALREADY_IMPORTED'
										? 'Ya existía'
										: (item.mensaje ?? item.codigo ?? 'Falló')}</span
							>
							{#if item.advertencia}<small>{item.advertencia}</small>{/if}
						</div>
					{/each}
				</div>
			</details>
		{/if}

		<div class="barra-lista">
			<div>
				<strong>{total}</strong> envío(s) · <strong>{cantidadSeleccionada}</strong> seleccionado(s)
			</div>
			<button
				class="texto"
				type="button"
				disabled={!visiblesImportables.length || cargando}
				onclick={alternarTodos}
				>{todasSeleccionadas
					? 'Quitar selección visible'
					: 'Seleccionar importables visibles'}</button
			>
		</div>

		<div class="lista" aria-busy={cargando}>
			{#if cargando}
				<div class="vacio">Cargando vista previa…</div>
			{:else if !filas.length}
				<div class="vacio">No hay envíos para esos filtros.</div>
			{:else}
				{#each filas as fila (fila.id)}
					<article class="fila" class:bloqueada={!fila.importable}>
						<label class="selector"
							><input
								type="checkbox"
								checked={Boolean(seleccion[fila.id])}
								disabled={!fila.importable || fila.yaImportado || importando}
								onchange={() => alternar(fila)}
							/><span class="sr">Seleccionar {fila.formCode}</span></label
						>
						<div class="datos">
							<div class="titulo-fila">
								<strong>{fila.formCode}</strong><span
									>v{fila.formVersion} · {fila.formTitle || fila.formName}</span
								><span class="chip">{fila.status === 'VOIDED' ? 'Anulado' : 'Entregado'}</span>
							</div>
							<p>
								{fila.driver?.nombre ?? 'Autor sin identificar'}{fila.driver &&
								'numeroIdentificacion' in fila.driver &&
								fila.driver.numeroIdentificacion
									? ` · ${fila.driver.numeroIdentificacion}`
									: ''}{fila.vehicle ? ` · ${fila.vehicle.placa}` : ''} · {formatearFechaNegocio(fila.businessDate)}
							</p>
							<div class="meta">
								{fila.answers} respuestas · {fila.attachments} evidencias · versión destino: {fila.versionDestino.toLowerCase()}
							</div>
							{#if fila.accionesRequeridas.crearConductor || fila.accionesRequeridas.crearVehiculo}
								<div class="aviso">
									{#if fila.accionesRequeridas.crearConductor && crearConductores}Se creará el
										conductor inactivo.
									{/if}{#if fila.accionesRequeridas.crearVehiculo && crearVehiculos}Se creará la
										placa inactiva.{/if}
								</div>
							{/if}
							{#if fila.yaImportado}<div class="bloqueo">
									Este envío ya fue importado.
								</div>{:else if fila.bloqueos.length}<div class="bloqueo">
									{#each fila.bloqueos as bloqueo}<span>{bloqueo}</span>{/each}
								</div>{/if}
						</div>
					</article>
				{/each}
			{/if}
		</div>

		<footer class="pie">
			<div class="paginador">
				<button
					type="button"
					class="boton secundario"
					disabled={pagina <= 1 || cargando}
					onclick={() => cambiarPagina(pagina - 1)}>Anterior</button
				><span>Página {pagina} de {paginas}</span><button
					type="button"
					class="boton secundario"
					disabled={pagina >= paginas || cargando}
					onclick={() => cambiarPagina(pagina + 1)}>Siguiente</button
				>
			</div>
			<div class="acciones">
				<button class="boton secundario" type="button" disabled={importando} onclick={onclose}
					>Cerrar</button
				><button
					class="boton primario"
					type="button"
					disabled={importando || cargando || !cantidadSeleccionada}
					onclick={importar}
					>{importando ? 'Importando…' : `Importar ${cantidadSeleccionada} envío(s)`}</button
				>
			</div>
		</footer>
	</dialog>
</div>

<style>
	.sombra {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.55);
		backdrop-filter: blur(4px);
	}
	.modal {
		position: relative;
		margin: 0;
		padding: 0;
		color: inherit;
		display: flex;
		flex-direction: column;
		width: min(100%, 70rem);
		max-width: none;
		max-height: min(94vh, 58rem);
		overflow: hidden;
		background: var(--bg-surface, #fff);
		border: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.14));
		border-radius: 20px;
		box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
	}
	.cabecera {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.4rem;
		border-bottom: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.1));
	}
	.eyebrow {
		margin: 0 0 0.25rem;
		color: var(--emerald-700, #047857);
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	h2 {
		margin: 0;
		font-size: 1.4rem;
		color: var(--text-primary, #0f172a);
	}
	.intro {
		margin: 0.4rem 0 0;
		color: var(--text-muted, #64748b);
		font-size: 0.85rem;
		line-height: 1.45;
	}
	.cerrar {
		align-self: flex-start;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: 50%;
		background: var(--bg-base, #f1f5f9);
		font-size: 1.4rem;
		cursor: pointer;
	}
	.filtros {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.6rem;
		padding: 1rem 1.4rem 0.75rem;
	}
	.filtros label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.filtros label span {
		font-size: 0.67rem;
		font-weight: 800;
		color: var(--text-muted, #64748b);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	input:not([type='checkbox']),
	select {
		min-height: 38px;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--border-default, rgba(15, 23, 42, 0.15));
		border-radius: 8px;
		background: white;
		font: inherit;
		font-size: 0.82rem;
		color: var(--text-primary, #0f172a);
	}
	.ancho {
		grid-column: span 3;
	}
	.ayuda-filtros {
		grid-column: 1 / -1;
		margin: -0.25rem 0 0;
		color: var(--text-very-muted, #94a3b8);
		font-size: 0.72rem;
	}
	.consultar {
		align-self: end;
		min-height: 38px;
	}
	.opciones {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1.2rem;
		padding: 0.75rem 1.4rem;
		background: var(--bg-base, #f8fafc);
		border-block: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.08));
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.8rem;
		font-weight: 650;
	}
	.check input,
	.selector input {
		accent-color: #047857;
		width: 1rem;
		height: 1rem;
	}
	.opciones p {
		flex-basis: 100%;
		margin: 0;
		color: var(--text-muted, #64748b);
		font-size: 0.72rem;
	}
	.barra-lista {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.7rem;
		padding: 0.7rem 1.4rem;
		font-size: 0.78rem;
		color: var(--text-muted, #64748b);
	}
	.texto {
		border: 0;
		background: none;
		color: var(--emerald-700, #047857);
		font: inherit;
		font-weight: 750;
		cursor: pointer;
	}
	.texto:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.lista {
		overflow: auto;
		min-height: 11rem;
		padding: 0 1.4rem 1rem;
	}
	.fila {
		display: grid;
		grid-template-columns: 1.2rem minmax(0, 1fr);
		gap: 0.75rem;
		padding: 0.8rem 0;
		border-top: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.08));
	}
	.fila.bloqueada {
		opacity: 0.75;
	}
	.selector {
		padding-top: 0.2rem;
	}
	.datos p {
		margin: 0.25rem 0;
		color: var(--text-muted, #64748b);
		font-size: 0.8rem;
	}
	.titulo-fila {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.titulo-fila strong {
		font-family: var(--font-mono, monospace);
		font-size: 0.82rem;
	}
	.titulo-fila > span:nth-child(2) {
		font-size: 0.8rem;
		color: var(--text-primary, #334155);
	}
	.chip {
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		background: #ecfdf5;
		color: #047857;
		font-size: 0.62rem;
		font-weight: 800;
		text-transform: uppercase;
	}
	.meta {
		color: var(--text-very-muted, #94a3b8);
		font-size: 0.7rem;
	}
	.aviso,
	.bloqueo {
		margin-top: 0.35rem;
		font-size: 0.73rem;
	}
	.aviso {
		color: #92400e;
	}
	.bloqueo {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		color: #b91c1c;
	}
	.vacio {
		padding: 2.5rem 1rem;
		text-align: center;
		color: var(--text-muted, #64748b);
	}
	.alerta,
	.resumen-lote {
		margin: 0.6rem 1.4rem 0;
		padding: 0.65rem 0.8rem;
		border-radius: 9px;
		font-size: 0.8rem;
	}
	.error {
		background: #fef2f2;
		color: #991b1b;
	}
	.alerta-ok {
		background: #ecfdf5;
		color: #065f46;
	}
	.alerta-parcial {
		background: #fffbeb;
		color: #92400e;
	}
	.detalle-lote {
		margin: 0.35rem 1.4rem 0.4rem;
		font-size: 0.75rem;
		color: var(--text-muted, #64748b);
	}
	.detalle-lote summary {
		cursor: pointer;
		font-weight: 750;
	}
	.detalle-items {
		max-height: 8rem;
		overflow: auto;
		margin-top: 0.35rem;
		border: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.1));
		border-radius: 8px;
	}
	.detalle-item {
		display: grid;
		grid-template-columns: 5rem minmax(0, 1fr);
		gap: 0.3rem 0.6rem;
		padding: 0.4rem 0.55rem;
		border-bottom: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.08));
	}
	.detalle-item:last-child {
		border: 0;
	}
	.detalle-item code {
		font-size: 0.68rem;
	}
	.detalle-item small {
		grid-column: 2;
		color: #92400e;
	}
	.pie {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.85rem 1.4rem;
		border-top: 1px solid var(--border-subtle, rgba(15, 23, 42, 0.1));
		background: var(--bg-surface, #fff);
	}
	.paginador,
	.acciones {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.paginador {
		font-size: 0.75rem;
		color: var(--text-muted, #64748b);
	}
	.boton {
		min-height: 38px;
		padding: 0 0.8rem;
		border: 1px solid var(--border-default, rgba(15, 23, 42, 0.15));
		border-radius: 9px;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 750;
		cursor: pointer;
	}
	.boton:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.secundario {
		background: white;
		color: var(--text-primary, #334155);
	}
	.primario {
		border-color: #047857;
		background: #047857;
		color: white;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	@media (max-width: 760px) {
		.sombra {
			padding: 0.35rem;
		}
		.modal {
			max-height: 98vh;
			border-radius: 14px;
		}
		.filtros {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			padding: 0.8rem;
		}
		.ancho {
			grid-column: span 2;
		}
		.opciones,
		.barra-lista {
			padding-inline: 0.8rem;
		}
		.lista {
			padding-inline: 0.8rem;
		}
		.pie {
			align-items: stretch;
			flex-direction: column;
			padding: 0.75rem;
		}
		.paginador,
		.acciones {
			justify-content: space-between;
		}
		.cabecera {
			padding: 1rem;
		}
		.cabecera h2 {
			font-size: 1.15rem;
		}
	}
</style>
