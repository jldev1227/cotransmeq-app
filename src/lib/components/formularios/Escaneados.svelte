<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth';
	import {
		escaneadosAPI,
		type Escaneado,
		type OpcionesEscaneados
	} from '$lib/api/formularios-escaneados';

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
	let buscarAsignacion = $state('');
	let buscarConductor = $state('');
	let buscarVehiculo = $state('');
	let assignmentId = $state('');
	let conductorId = $state('');
	let vehicleId = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let explanation = $state('');
	let detalles = $state<Array<{ clave: string; valor: string }>>([]);
	let archivo = $state<File | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
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
		try {
			const resultado = await escaneadosAPI.opciones(q);
			opciones = { ...opciones, [tipo]: resultado[tipo] };
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudieron buscar opciones.';
		}
	}
	function programarOpciones(tipo: 'assignments' | 'conductores' | 'vehiculos', q: string) {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			void buscarOpciones(tipo, q);
		}, 300);
	}
	async function abrir() {
		modal = true;
		error = '';
		try {
			opciones = await escaneadosAPI.opciones();
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudieron cargar las opciones.';
		}
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
			const { id, uploadUrl } = await escaneadosAPI.iniciar({
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
			const subida = await fetch(uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/pdf' },
				body: archivo
			});
			if (!subida.ok) throw new Error(`No se pudo subir el PDF (${subida.status}).`);
			await escaneadosAPI.completar(id);
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
			<h3 id="titulo-escaneados">Formatos físicos escaneados</h3>
			<p>
				Documentos diligenciados en papel, asociados a un conductor, una placa y los días que
				cubren.
			</p>
		</div>
		{#if puedeEditar}<button type="button" class="accion" onclick={abrir}
				>Adjuntar PDF escaneado</button
			>{/if}
	</header>
	<div class="filtros">
		<input
			type="search"
			aria-label="Buscar escaneados"
			placeholder="Buscar por formulario, conductor o placa"
			bind:value={busqueda}
			oninput={() => {
				pagina = 1;
				void cargar();
			}}
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
		<span>{total} documento{total === 1 ? '' : 's'}</span>
	</div>
	{#if errorLista}<p class="error" role="alert">No se pudieron cargar los escaneos: {errorLista} <button type="button" onclick={cargar}>Reintentar</button></p>{/if}
	{#if cargando}<p>Cargando escaneos…</p>
	{:else if errorLista}<p>Reintenta la consulta cuando vuelva la conexión.</p>
	{:else if registros.length === 0}<p>Sin PDF escaneados para esta búsqueda.</p>
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
				<h3 id="titulo-carga">Adjuntar formato físico</h3>
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
				<label
					>Buscar formulario o asignación<input
						type="search"
						bind:value={buscarAsignacion}
						oninput={() => programarOpciones('assignments', buscarAsignacion)}
					/></label
				>
				<label
					>Formulario y versión<select required bind:value={assignmentId}
						><option value="">Seleccionar…</option>{#each opciones.assignments as a (a.id)}<option
								value={a.id}
								>{a.version.form.code} · {a.version.form.name} · v{a.version.version_number} · {a.name}</option
							>{/each}</select
					></label
				>
				<label
					>Buscar conductor<input
						type="search"
						bind:value={buscarConductor}
						oninput={() => programarOpciones('conductores', buscarConductor)}
					/></label
				>
				<label
					>Conductor<select required bind:value={conductorId}
						><option value="">Seleccionar…</option>{#each opciones.conductores as c (c.id)}<option
								value={c.id}
								>{c.nombre} {c.apellido} · {c.numero_identificacion ?? 'Sin documento'}</option
							>{/each}</select
					></label
				>
				<label
					>Buscar placa<input
						type="search"
						bind:value={buscarVehiculo}
						oninput={() => programarOpciones('vehiculos', buscarVehiculo)}
					/></label
				>
				<label
					>Placa<select required bind:value={vehicleId}
						><option value="">Seleccionar…</option>{#each opciones.vehiculos as v (v.id)}<option
								value={v.id}>{v.placa}</option
							>{/each}</select
					></label
				>
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
				<div class="detalles">
					<strong>Datos adicionales</strong><small
						>Para actas u otros formatos, agrega “Entrega de”, “Recibe” u otros datos que ayuden a
						identificar el documento.</small
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
				</div>
				<label
					>PDF escaneado (máximo 25 MB)<input
						required
						type="file"
						accept="application/pdf,.pdf"
						onchange={(e) => (archivo = e.currentTarget.files?.[0] ?? null)}
					/></label
				>
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
		padding: 1.25rem;
		border: 1px solid #d7e2de;
		border-radius: 1rem;
		background: #fff;
	}
	.cabecera {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
	}
	.cabecera h3 {
		margin: 0 0 0.25rem;
		font-size: 1.1rem;
	}
	.cabecera p {
		margin: 0;
		color: #52635c;
		font-size: 0.9rem;
	}
	.accion {
		border: 0;
		border-radius: 0.5rem;
		padding: 0.65rem 0.9rem;
		background: #166534;
		color: white;
		cursor: pointer;
		white-space: nowrap;
	}
	.secundario {
		background: #f0fdf4;
		color: #166534;
	}
	.filtros {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 1rem 0;
	}
	.filtros input {
		max-width: 28rem;
		width: 100%;
	}
	.filtro-fecha {
		display: grid;
		gap: 0.2rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: #52635c;
	}
	.filtro-fecha input {
		width: 11rem;
	}
	.lista {
		display: grid;
		gap: 0.65rem;
	}
	.registro {
		display: grid;
		grid-template-columns: 1.3fr 1fr 1.6fr auto;
		align-items: center;
		gap: 1rem;
		padding: 0.8rem;
		border: 1px solid #e0e9e4;
		border-radius: 0.65rem;
	}
	.registro div {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	.registro small {
		color: #52635c;
		overflow-wrap: anywhere;
	}
	.paginacion {
		display: flex;
		justify-content: end;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	.fondo {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: #0008;
		display: grid;
		place-items: center;
		padding: 1rem;
	}
	.modal {
		position: relative;
		max-width: 42rem;
		width: 100%;
		max-height: 90vh;
		overflow: auto;
		border: 0;
		border-radius: 1rem;
		padding: 1.5rem;
		box-shadow: 0 20px 60px #0004;
	}
	.modal form {
		display: grid;
		gap: 0.8rem;
		margin-top: 1rem;
	}
	.modal label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.9rem;
		font-weight: 600;
	}
	.modal input,
	.modal select,
	.modal textarea,
	.filtros input {
		border: 1px solid #bfcfc5;
		border-radius: 0.45rem;
		padding: 0.55rem;
		font: inherit;
		min-width: 0;
	}
	.modal textarea {
		min-height: 5rem;
	}
	.fechas {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.detalles {
		display: grid;
		gap: 0.4rem;
	}
	.detalles small {
		color: #52635c;
	}
	.detalle {
		display: grid;
		grid-template-columns: 1fr 1.5fr auto;
		gap: 0.4rem;
	}
	.modal footer {
		display: flex;
		justify-content: end;
		gap: 0.6rem;
		margin-top: 0.5rem;
	}
	.cerrar {
		border: 0;
		background: transparent;
		font-size: 1.5rem;
		cursor: pointer;
	}
	.cobertura {
		margin: 0;
		color: #52635c;
		font-size: 0.85rem;
	}
	.error {
		color: #b42318;
		margin: 0;
	}
	@media (max-width: 850px) {
		.registro {
			grid-template-columns: 1fr;
		}
		.cabecera {
			flex-wrap: wrap;
		}
	}
	@media (max-width: 500px) {
		.fechas,
		.detalle {
			grid-template-columns: 1fr;
		}
	}
</style>
