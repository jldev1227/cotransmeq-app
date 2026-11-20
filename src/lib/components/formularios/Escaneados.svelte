<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth';
	import SelectBuscable from '$lib/components/common/SelectBuscable.svelte';
	import {
		escaneadosAPI,
		type Escaneado,
		type OpcionesEscaneados
	} from '$lib/api/formularios-escaneados';

	let { formId = '' }: { formId?: string } = $props();

	let registros = $state<Escaneado[]>([]);
	let total = $state(0);
	let pagina = $state(1);
	let busqueda = $state('');
	let diaCubierto = $state('');
	let cargando = $state(false);
	let errorLista = $state('');
	let modal = $state(false);
	let guardando = $state(false);
	let error = $state('');
	let opciones = $state<OpcionesEscaneados>({ assignments: [], conductores: [], vehiculos: [] });
	let assignmentId = $state('');
	let conductorId = $state('');
	let vehicleId = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let explanation = $state('');
	let detalles = $state<Array<{ clave: string; valor: string }>>([]);
	let archivo = $state<File | null>(null);
	let archivoInput: HTMLInputElement;
	let arrastrando = $state(false);
	let timerLista: ReturnType<typeof setTimeout> | undefined;
	const secuenciaOpciones = { assignments: 0, conductores: 0, vehiculos: 0 };
	const asignaciones = $derived(
		opciones.assignments.map((a) => ({
			value: a.id,
			label: `${a.version.form.code} · ${a.version.form.name}`,
			labelSecundario: `v${a.version.version_number} · ${a.name}`,
			searchLabel: `${a.version.form.code} ${a.version.form.name} ${a.name} ${a.version.version_number}`
		}))
	);
	const conductores = $derived(
		opciones.conductores.map((c) => ({
			value: c.id,
			label: `${c.nombre} ${c.apellido}`.trim(),
			labelSecundario: c.numero_identificacion ?? 'Sin documento'
		}))
	);
	const vehiculos = $derived(opciones.vehiculos.map((v) => ({ value: v.id, label: v.placa })));
	const diasSeleccionados = $derived(
		dateFrom && dateTo && dateTo >= dateFrom
			? Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000) + 1
			: 0
	);
	const puedeEditar = $derived(
		!!$authStore.user && authStore.getAccessLevel('formularios') === 'full'
	);

	onMount(() => {
		void cargar();
	});

	async function cargar() {
		cargando = true;
		errorLista = '';
		try {
			const respuesta = await escaneadosAPI.listar(pagina, busqueda, diaCubierto);
			registros = respuesta.items;
			total = respuesta.total;
		} catch (e) {
			errorLista = e instanceof Error ? e.message : 'No se pudieron cargar los escaneos.';
		} finally {
			cargando = false;
		}
	}
	async function buscarOpciones(tipo: 'assignments' | 'conductores' | 'vehiculos', q: string) {
		const secuencia = ++secuenciaOpciones[tipo];
		try {
			const resultado = await escaneadosAPI.opciones(q, formId);
			if (secuencia !== secuenciaOpciones[tipo]) return;
			const seleccionado = opciones[tipo].find(
				(item) =>
					item.id ===
					(tipo === 'assignments' ? assignmentId : tipo === 'conductores' ? conductorId : vehicleId)
			);
			opciones = {
				...opciones,
				[tipo]:
					seleccionado && !resultado[tipo].some((item) => item.id === seleccionado.id)
						? [seleccionado, ...resultado[tipo]]
						: resultado[tipo]
			};
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudieron buscar opciones.';
		}
	}
	function buscarAsignaciones(q: string) { void buscarOpciones('assignments', q); }
	function buscarConductores(q: string) { void buscarOpciones('conductores', q); }
	function buscarVehiculos(q: string) { void buscarOpciones('vehiculos', q); }
	async function abrir() {
		modal = true;
		error = '';
		assignmentId = '';
		conductorId = '';
		vehicleId = '';
		dateFrom = '';
		dateTo = '';
		explanation = '';
		detalles = [];
		archivo = null;
		try {
			opciones = await escaneadosAPI.opciones('', formId);
			if (formId && opciones.assignments.length === 1) assignmentId = opciones.assignments[0].id;
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudieron cargar las opciones.';
		}
	}
	function seleccionarArchivo(file: File | null) {
		if (!file) return;
		if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
			error = 'Selecciona un archivo PDF.';
			return;
		}
		archivo = file;
		error = '';
	}
	function soltarArchivo(event: DragEvent) {
		event.preventDefault();
		arrastrando = false;
		seleccionarArchivo(event.dataTransfer?.files?.[0] ?? null);
	}
	function programarCarga() {
		if (timerLista) clearTimeout(timerLista);
		pagina = 1;
		timerLista = setTimeout(() => void cargar(), 300);
	}
	async function guardar() {
		if (
			!archivo ||
			!assignmentId ||
			!conductorId ||
			!vehicleId ||
			!dateFrom ||
			!dateTo ||
			!explanation.trim()
		) {
			error = 'Completa el formulario y selecciona un PDF.';
			return;
		}
		if (dateTo < dateFrom) {
			error = 'La fecha final debe ser igual o posterior a la inicial.';
			return;
		}
		if (archivo.size > 25 * 1024 * 1024) {
			error = 'El PDF supera el límite de 25 MB.';
			return;
		}
		const firma = new Uint8Array(await archivo.slice(0, 1024).arrayBuffer());
		if (!new TextDecoder().decode(firma).includes('%PDF-')) {
			error = 'El archivo seleccionado no parece ser un PDF.';
			return;
		}
		const details: Record<string, string> = {};
		for (const item of detalles) {
			if (item.clave.trim() && item.valor.trim()) details[item.clave.trim()] = item.valor.trim();
		}
		guardando = true;
		error = '';
		try {
			const hash = await crypto.subtle.digest('SHA-256', await archivo.arrayBuffer());
			const sha256 = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
			const { id } = await escaneadosAPI.iniciar({
				assignmentId,
				conductorId,
				vehicleId,
				dateFrom,
				dateTo,
				explanation: explanation.trim(),
				details,
				originalName: archivo.name,
				byteSize: archivo.size,
				sha256
			});
			await escaneadosAPI.subir(id, archivo);
			modal = false;
			archivo = null;
			explanation = '';
			detalles = [];
			pagina = 1;
			await cargar();
			toast.success('PDF escaneado guardado.');
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo guardar el PDF.';
		} finally {
			guardando = false;
		}
	}
	async function ver(id: string) {
		const ventana = window.open('', '_blank');
		if (ventana) ventana.opener = null;
		try {
			const { url } = await escaneadosAPI.url(id);
			if (ventana) ventana.location.href = url;
			else window.open(url, '_blank', 'noopener,noreferrer');
		} catch (e) {
			ventana?.close();
			toast.error(e instanceof Error ? e.message : 'No se pudo abrir el PDF.');
		}
	}
</script>

<section class="escaneados" aria-labelledby="titulo-escaneados">
	<header class="cabecera">
		<div>
			<span class="eyebrow">Archivo documental</span>
			<h3 id="titulo-escaneados">Formatos físicos escaneados</h3>
			<p>
				Documentos diligenciados en papel, asociados a un conductor, una placa y los días que
				cubren.
			</p>
		</div>
		{#if puedeEditar}<button type="button" class="accion" onclick={abrir}>+ Adjuntar PDF</button
			>{/if}
	</header>
	<div class="filtros">
		<input
			type="search"
			aria-label="Buscar escaneados"
			placeholder="Buscar por formulario, conductor o placa"
			bind:value={busqueda}
			oninput={programarCarga}
		/>
		<label class="filtro-fecha"
			>Día cubierto
			<input
				type="date"
				bind:value={diaCubierto}
				onchange={() => {
					pagina = 1;
					void cargar();
				}}
			/>
		</label>
		<span class="contador">{total} documento{total === 1 ? '' : 's'}</span>
	</div>
	{#if errorLista}<p class="error" role="alert">
			No se pudieron cargar los escaneos: {errorLista}
			<button type="button" onclick={cargar}>Reintentar</button>
		</p>{/if}
	{#if cargando}<p>Cargando escaneos…</p>
	{:else if errorLista}<p>Reintenta la consulta cuando vuelva la conexión.</p>
	{:else if registros.length === 0}<div class="vacio">
			<span class="vacio-icono" aria-hidden="true">▤</span>
			<strong>Sin formatos escaneados</strong>
			<p>
				{busqueda || diaCubierto
					? 'Prueba otra búsqueda o cambia el día cubierto.'
					: 'Adjunta el primer PDF diligenciado en papel para conservarlo junto al formulario.'}
			</p>
			{#if puedeEditar && !busqueda && !diaCubierto}<button
					type="button"
					class="accion secundario"
					onclick={abrir}>Adjuntar primer PDF</button
				>{/if}
		</div>
	{:else}
		<div class="lista">
			{#each registros as registro (registro.id)}
				<article class="registro">
					<div>
						<strong>{registro.formCode} · {registro.formName}</strong><small
							>v{registro.versionNumber} · {registro.assignmentName}</small
						>
					</div>
					<div>
						<strong>{registro.conductor}</strong><small
							>{registro.document ?? 'Sin documento'} · {registro.placa}</small
						>
					</div>
					<div>
						<strong
							>{registro.dateFrom} a {registro.dateTo} · {registro.daysCovered} día{registro.daysCovered ===
							1
								? ''
								: 's'}</strong
						><small>{registro.explanation}</small>
						{#if Object.keys(registro.details ?? {}).length}<small
								>{Object.entries(registro.details)
									.map(([k, v]) => `${k}: ${v}`)
									.join(' · ')}</small
							>{/if}
					</div>
					<button type="button" class="accion secundario" onclick={() => ver(registro.id)}
						>Ver PDF</button
					>
				</article>
			{/each}
		</div>
		<div class="paginacion">
			<button
				disabled={pagina <= 1}
				onclick={() => {
					pagina--;
					void cargar();
				}}>Anterior</button
			><span>Página {pagina}</span><button
				disabled={pagina * 25 >= total}
				onclick={() => {
					pagina++;
					void cargar();
				}}>Siguiente</button
			>
		</div>
	{/if}
</section>

{#if modal}
	<div class="fondo" role="presentation">
		<dialog open aria-modal="true" aria-labelledby="titulo-carga" class="modal">
			<header class="cabecera">
				<div>
					<span class="eyebrow">Nuevo documento</span>
					<h3 id="titulo-carga">Adjuntar formato físico</h3>
					<p>Relaciona el PDF con su formulario, conductor, placa y período.</p>
				</div>
				<button type="button" aria-label="Cerrar" class="cerrar" onclick={() => (modal = false)}
					>×</button
				>
			</header>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void guardar();
				}}
			>
				<div class="identidad">
					<div class="campo">
						<span>Formulario y versión</span>
						<SelectBuscable
							opciones={asignaciones}
							valor={assignmentId || null}
							placeholder="Buscar formulario o asignación…"
							placeholderBusqueda="Nombre, código o versión"
							ariaLabel="Formulario y versión"
							onSeleccionar={(valor) => (assignmentId = valor ?? '')}
							onBuscar={buscarAsignaciones}
						/>
						{#if formId}<small class="ayuda">Asignaciones del formulario del enlace.</small>{/if}
					</div>
					<div class="campo">
						<span>Conductor</span>
						<SelectBuscable
							opciones={conductores}
							valor={conductorId || null}
							placeholder="Buscar conductor…"
							placeholderBusqueda="Nombre o documento"
							ariaLabel="Conductor"
							onSeleccionar={(valor) => (conductorId = valor ?? '')}
							onBuscar={buscarConductores}
						/>
					</div>
					<div class="campo">
						<span>Placa</span>
						<SelectBuscable
							opciones={vehiculos}
							valor={vehicleId || null}
							placeholder="Buscar placa…"
							placeholderBusqueda="Placa del vehículo"
							ariaLabel="Placa"
							onSeleccionar={(valor) => (vehicleId = valor ?? '')}
							onBuscar={buscarVehiculos}
						/>
					</div>
				</div>
				<div class="fechas">
					<label>Desde<input required type="date" bind:value={dateFrom} /></label><label
						>Hasta<input required type="date" min={dateFrom} bind:value={dateTo} /></label
					>
				</div>
				{#if diasSeleccionados > 0}<p class="cobertura">
						Este PDF justificará {diasSeleccionados} día{diasSeleccionados === 1 ? '' : 's'} (ambas fechas
						incluidas).
					</p>{/if}
				<label
					>Qué contiene el PDF y por qué cubre estas fechas<textarea
						required
						minlength="5"
						maxlength="2000"
						bind:value={explanation}
						placeholder="Ej.: preoperacionales firmados del 22 al 27 de agosto"
					></textarea></label
				>
				<details class="detalles">
					<summary
						>Datos adicionales <small>Opcional, para actas y formatos especiales</small></summary
					>
					{#each detalles as detalle, i}<div class="detalle">
							<input
								aria-label="Nombre del dato"
								placeholder="Ej.: Entrega de"
								bind:value={detalle.clave}
								maxlength="80"
							/><input
								aria-label="Valor del dato"
								placeholder="Nombre o descripción"
								bind:value={detalle.valor}
								maxlength="500"
							/><button
								type="button"
								onclick={() => (detalles = detalles.filter((_, n) => n !== i))}>×</button
							>
						</div>{/each}
					<button
						type="button"
						disabled={detalles.length >= 20}
						onclick={() => (detalles = [...detalles, { clave: '', valor: '' }])}
						>Agregar dato</button
					>
				</details>
				<div class="campo">
					<span>PDF escaneado</span>
					<input
						bind:this={archivoInput}
						type="file"
						accept="application/pdf,.pdf"
						class="sr-only"
						onchange={(e) => seleccionarArchivo(e.currentTarget.files?.[0] ?? null)}
					/>
					<button
						type="button"
						class="zona-archivo"
						class:arrastrando
						onclick={() => archivoInput?.click()}
						ondragover={(e) => {
							e.preventDefault();
							arrastrando = true;
						}}
						ondragleave={() => (arrastrando = false)}
						ondrop={soltarArchivo}
					>
						<span class="icono-archivo" aria-hidden="true">↑</span>
						<strong>{archivo ? archivo.name : 'Arrastra un PDF aquí o selecciónalo'}</strong>
						<small
							>{archivo
								? `${(archivo.size / 1024 / 1024).toFixed(1)} MB · Un archivo seleccionado`
								: 'Un único archivo PDF · Máximo 25 MB'}</small
						>
					</button>
					{#if archivo}<button
							type="button"
							class="quitar-archivo"
							onclick={() => {
								archivo = null;
								archivoInput.value = '';
							}}>Quitar archivo</button
						>{/if}
				</div>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<footer>
					<button type="button" disabled={guardando} onclick={() => (modal = false)}
						>Cancelar</button
					><button type="submit" class="accion" disabled={guardando}
						>{guardando ? 'Subiendo y verificando…' : 'Guardar PDF'}</button
					>
				</footer>
			</form>
		</dialog>
	</div>
{/if}

<style>
	.escaneados {
		margin: 1.5rem 0;
		padding: clamp(1rem, 2vw, 1.5rem);
		border: 1px solid var(--border-default, #dce5e1);
		border-radius: 1.25rem;
		background: var(--bg-surface, #fff);
		box-shadow: 0 8px 30px rgba(15, 23, 42, 0.035);
	}
	.cabecera {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.eyebrow {
		display: block;
		margin-bottom: 0.35rem;
		color: #166534;
		font-size: 0.67rem;
		font-weight: 800;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}
	.cabecera h3 {
		margin: 0 0 0.3rem;
		color: var(--text-primary, #172320);
		font-size: clamp(1.15rem, 1.6vw, 1.4rem);
		font-weight: 750;
		letter-spacing: -0.035em;
	}
	.cabecera p {
		margin: 0;
		color: var(--text-muted, #66756e);
		font-size: 0.86rem;
		line-height: 1.5;
	}
	.accion {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: 0.7rem;
		padding: 0.67rem 0.95rem;
		background: #166534;
		color: white;
		font-size: 0.84rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
		transition:
			filter 0.15s,
			transform 0.15s;
	}
	.accion:hover {
		filter: brightness(1.08);
		transform: translateY(-1px);
	}
	.accion:disabled {
		cursor: wait;
		opacity: 0.65;
		transform: none;
	}
	.secundario {
		border-color: color-mix(in srgb, #166534 25%, white);
		background: #f0fdf4;
		color: #166534;
	}
	.filtros {
		display: flex;
		align-items: end;
		flex-wrap: wrap;
		gap: 0.7rem;
		margin: 1.25rem 0 0.85rem;
		padding: 0.8rem;
		border: 1px solid var(--border-default, #e2e9e6);
		border-radius: 0.9rem;
		background: var(--bg-base, #f8faf9);
	}
	.filtros > input {
		flex: 1 1 18rem;
		min-width: 12rem;
	}
	.filtro-fecha {
		display: grid;
		gap: 0.25rem;
		color: var(--text-muted, #576861);
		font-size: 0.72rem;
		font-weight: 700;
	}
	.filtro-fecha input {
		min-width: 10.5rem;
	}
	.filtros input,
	.modal input:not([type='file']),
	.modal textarea {
		min-width: 0;
		border: 1px solid var(--border-default, #d9e3de);
		border-radius: 0.7rem;
		padding: 0.63rem 0.75rem;
		background: white;
		color: var(--text-primary, #172320);
		font: inherit;
		font-size: 0.84rem;
		outline: none;
	}
	.filtros input:focus,
	.modal input:focus,
	.modal textarea:focus {
		border-color: #166534;
		box-shadow: 0 0 0 3px color-mix(in srgb, #166534 12%, transparent);
	}
	.contador {
		margin-left: auto;
		padding: 0.48rem 0.7rem;
		border-radius: 999px;
		background: #f0fdf4;
		color: #166534;
		font-size: 0.73rem;
		font-weight: 750;
		white-space: nowrap;
	}
	.vacio {
		display: grid;
		justify-items: center;
		gap: 0.42rem;
		padding: 2.6rem 1rem;
		border: 1px dashed var(--border-default, #d9e3de);
		border-radius: 0.95rem;
		background: var(--bg-base, #fafcfb);
		text-align: center;
	}
	.vacio-icono {
		display: grid;
		place-items: center;
		width: 2.7rem;
		height: 2.7rem;
		margin-bottom: 0.25rem;
		border-radius: 0.8rem;
		background: #f0fdf4;
		color: #166534;
		font-size: 1.5rem;
	}
	.vacio strong {
		color: var(--text-primary, #172320);
		font-size: 0.95rem;
	}
	.vacio p {
		max-width: 26rem;
		margin: 0 0 0.35rem;
		color: var(--text-muted, #66756e);
		font-size: 0.82rem;
	}
	.lista {
		display: grid;
		gap: 0.6rem;
	}
	.registro {
		display: grid;
		grid-template-columns: 1.3fr 1fr 1.5fr auto;
		align-items: center;
		gap: 1rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--border-default, #e0e9e4);
		border-radius: 0.8rem;
		background: white;
	}
	.registro div {
		display: grid;
		gap: 0.22rem;
		min-width: 0;
	}
	.registro strong {
		color: var(--text-primary, #172320);
		font-size: 0.82rem;
	}
	.registro small {
		color: var(--text-muted, #66756e);
		overflow-wrap: anywhere;
	}
	.paginacion {
		display: flex;
		justify-content: end;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
		font-size: 0.8rem;
	}
	.paginacion button,
	.modal footer button:not(.accion),
	.detalles button,
	.quitar-archivo {
		border: 1px solid var(--border-default, #d9e3de);
		border-radius: 0.65rem;
		padding: 0.5rem 0.75rem;
		background: white;
		color: var(--text-primary, #172320);
		cursor: pointer;
	}
	.paginacion button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.fondo {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(12, 29, 23, 0.6);
		backdrop-filter: blur(5px);
	}
	.modal {
		position: relative;
		width: min(100%, 42rem);
		max-height: min(90vh, 58rem);
		overflow: auto;
		border: 1px solid var(--border-default, #dce5e1);
		border-radius: 1.2rem;
		padding: clamp(1rem, 2.5vw, 1.6rem);
		background: var(--bg-surface, white);
		box-shadow: 0 25px 70px rgba(0, 0, 0, 0.25);
	}
	.modal .cabecera {
		align-items: start;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-default, #e2e9e6);
	}
	.modal form {
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
	}
	.modal label,
	.campo {
		display: grid;
		gap: 0.38rem;
		color: var(--text-primary, #172320);
		font-size: 0.79rem;
		font-weight: 700;
	}
	.identidad {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
	}
	.identidad .campo:first-child {
		grid-column: 1 / -1;
	}
	.ayuda {
		color: var(--text-muted, #66756e);
		font-size: 0.69rem;
		font-weight: 500;
	}
	.modal textarea {
		width: 100%;
		min-height: 4.3rem;
		resize: vertical;
	}
	.fechas {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}
	.cobertura {
		margin: -0.35rem 0 0;
		padding: 0.55rem 0.7rem;
		border-radius: 0.6rem;
		background: #f0fdf4;
		color: #166534;
		font-size: 0.74rem;
		font-weight: 650;
	}
	.detalles {
		padding: 0.75rem;
		border: 1px solid var(--border-default, #d9e3de);
		border-radius: 0.7rem;
	}
	.detalles summary {
		cursor: pointer;
		color: var(--text-primary, #172320);
		font-size: 0.8rem;
		font-weight: 700;
	}
	.detalles summary small {
		margin-left: 0.3rem;
		color: var(--text-muted, #66756e);
		font-size: 0.72rem;
		font-weight: 500;
	}
	.detalle {
		display: grid;
		grid-template-columns: 1fr 1.5fr auto;
		gap: 0.4rem;
		margin-top: 0.55rem;
	}
	.detalles > button {
		margin-top: 0.6rem;
		font-size: 0.75rem;
	}
	.zona-archivo {
		display: flex;
		width: 100%;
		min-height: 6.7rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		border: 1.5px dashed color-mix(in srgb, #166534 48%, white);
		border-radius: 0.85rem;
		padding: 0.85rem;
		background: #f0fdf4;
		color: #166534;
		cursor: pointer;
		text-align: center;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.zona-archivo:hover,
	.zona-archivo.arrastrando {
		border-color: #166534;
		background: color-mix(in srgb, #166534 13%, white);
	}
	.zona-archivo strong {
		max-width: 100%;
		overflow-wrap: anywhere;
		font-size: 0.82rem;
	}
	.zona-archivo small {
		color: var(--text-muted, #66756e);
		font-size: 0.72rem;
	}
	.icono-archivo {
		display: grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 0.5rem;
		background: white;
		font-size: 1.1rem;
	}
	.quitar-archivo {
		justify-self: start;
		padding: 0.28rem 0.45rem;
		font-size: 0.72rem;
	}
	.modal footer {
		display: flex;
		justify-content: end;
		gap: 0.6rem;
		margin-top: 0.2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-default, #e2e9e6);
	}
	.cerrar {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--border-default, #d9e3de);
		border-radius: 0.55rem;
		background: white;
		color: var(--text-muted, #66756e);
		font-size: 1.2rem;
		cursor: pointer;
	}
	.error {
		margin: 0;
		color: #b42318;
		font-size: 0.78rem;
	}
	@media (max-width: 800px) {
		.registro {
			grid-template-columns: 1fr 1fr;
		}
	}
	@media (max-width: 560px) {
		.cabecera {
			align-items: start;
			flex-wrap: wrap;
		}
		.identidad,
		.fechas,
		.detalle,
		.registro {
			grid-template-columns: 1fr;
		}
		.identidad .campo:first-child {
			grid-column: auto;
		}
		.contador {
			margin-left: 0;
		}
		.filtros {
			align-items: stretch;
		}
	}
</style>
