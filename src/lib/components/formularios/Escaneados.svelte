<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth';
	import { socketUtils } from '$lib/socket';
	import SelectBuscable from '$lib/components/common/SelectBuscable.svelte';
	import {
		escaneadosAPI,
		type Escaneado,
		type NovedadEscaneado,
		type OpcionesEscaneados
	} from '$lib/api/formularios-escaneados';

	type DocumentoPendiente = {
		key: string;
		archivo: File;
		dateFrom: string;
		dateTo: string;
		novedades: Array<NovedadEscaneado & { key: string }>;
		pendingId: string | null;
		completado: boolean;
	};
	type NovedadEdicion = NovedadEscaneado & { key: string };

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
	let opciones = $state<OpcionesEscaneados>({ formatos: [], conductores: [], vehiculos: [] });
	let formularioSeleccionadoId = $state('');
	let conductorId = $state('');
	let vehicleId = $state('');
	let documentos = $state<DocumentoPendiente[]>([]);
	let explanation = $state('');
	let detalles = $state<Array<{ clave: string; valor: string }>>([]);
	let archivoInput: HTMLInputElement;
	let arrastrando = $state(false);
	let progreso = $state('');
	let registroEdicion = $state<Escaneado | null>(null);
	let fechaDesdeEdicion = $state('');
	let fechaHastaEdicion = $state('');
	let explicacionEdicion = $state('');
	let novedadesEdicion = $state<NovedadEdicion[]>([]);
	let detallesEdicion = $state<Array<{ clave: string; valor: string }>>([]);
	let guardandoEdicion = $state(false);
	let archivoReemplazo = $state<File | null>(null);
	let archivoReemplazoInput: HTMLInputElement;
	let arrastrandoReemplazo = $state(false);
	let reemplazandoArchivo = $state(false);
	let errorReemplazo = $state('');
	let eliminandoId = $state<string | null>(null);
	let errorEdicion = $state('');
	let timerLista: ReturnType<typeof setTimeout> | undefined;
	let timerEvento: ReturnType<typeof setTimeout> | undefined;
	const secuenciaOpciones = { formatos: 0, conductores: 0, vehiculos: 0 };
	const formatos = $derived(
		opciones.formatos.map((a) => ({
			value: a.id,
			label: `${a.code} · ${a.name}`,
			searchLabel: `${a.code} ${a.name}`
		}))
	);
	const esPreoperacional = $derived.by(() => {
		const formato = opciones.formatos.find((item) => item.id === formularioSeleccionadoId);
		return formato ? /pre[\s-]*operacional/i.test(`${formato.code} ${formato.name}`) : false;
	});
	const conductores = $derived(
		opciones.conductores.map((c) => ({
			value: c.id,
			label: `${c.nombre} ${c.apellido}`.trim(),
			labelSecundario: c.numero_identificacion ?? 'Sin documento'
		}))
	);
	const vehiculos = $derived(opciones.vehiculos.map((v) => ({ value: v.id, label: v.placa })));
	const cargaIniciada = $derived(documentos.some((documento) => documento.pendingId !== null));
	function diasCubiertos(documento: DocumentoPendiente) {
		return documento.dateFrom && documento.dateTo && documento.dateTo >= documento.dateFrom
			? Math.round((Date.parse(documento.dateTo) - Date.parse(documento.dateFrom)) / 86_400_000) + 1
			: 0;
	}
	function novedadesGuardadas(details: Escaneado['details']): NovedadEscaneado[] {
		const varias = details?.novedades;
		if (Array.isArray(varias)) return varias.filter((n) => n && typeof n.fecha === 'string' && typeof n.descripcion === 'string');
		const fecha = details?.fecha_novedad;
		const descripcion = details?.novedad;
		return typeof fecha === 'string' && typeof descripcion === 'string' && fecha && descripcion
			? [{ fecha, descripcion }]
			: [];
	}
	function detallesTexto(details: Escaneado['details']): string {
		return Object.entries(details ?? {})
			.filter(([key, value]) => typeof value === 'string' && key !== 'fecha_novedad' && key !== 'novedad')
			.map(([key, value]) => {
				const etiqueta = key === 'horas_fatiga_periodo'
					? 'Horas de fatiga en el período'
					: key === 'horas_sueno_periodo' ? 'Horas de sueño en el período' : key;
				return `${etiqueta}: ${value}`;
			})
			.join(' · ');
	}
	const puedeEditar = $derived(
		!!$authStore.user && authStore.getAccessLevel('formularios') === 'full'
	);
	const puedeGestionarEscaneados = $derived(
		!!$authStore.user &&
			(authStore.getAccessLevel('formularios') === 'full' ||
				authStore.getAccessLevel('mantenimiento') === 'full')
	);

	onMount(() => {
		const unlisten = socketUtils.on('forms:scanned-document.changed', () => {
			if (timerEvento) clearTimeout(timerEvento);
			timerEvento = setTimeout(() => void cargar(), 100);
		});
		const unirse = () => socketUtils.emit('forms:join-scanned-documents');
		const onConnect = socketUtils.on('connect', unirse);
		const onReconnect = socketUtils.onReconnect(() => void cargar());
		if (socketUtils.isConnected()) unirse();
		void cargar();
		return () => {
			unlisten();
			onConnect();
			onReconnect();
			if (timerLista) clearTimeout(timerLista);
			if (timerEvento) clearTimeout(timerEvento);
			if (socketUtils.isConnected()) socketUtils.emit('forms:leave-scanned-documents');
		};
	});

	async function cargar() {
		cargando = true;
		errorLista = '';
		try {
			const respuesta = await escaneadosAPI.listar(pagina, busqueda, diaCubierto);
			const ultimaPagina = Math.max(1, Math.ceil(respuesta.total / 25));
			if (pagina > ultimaPagina) {
				pagina = ultimaPagina;
				await cargar();
				return;
			}
			registros = respuesta.items;
			total = respuesta.total;
		} catch (e) {
			errorLista = e instanceof Error ? e.message : 'No se pudieron cargar los escaneos.';
		} finally {
			cargando = false;
		}
	}
	async function buscarOpciones(tipo: 'formatos' | 'conductores' | 'vehiculos', q: string) {
		const secuencia = ++secuenciaOpciones[tipo];
		try {
			const resultado = await escaneadosAPI.opciones(q, formId);
			if (secuencia !== secuenciaOpciones[tipo]) return;
			const seleccionado = opciones[tipo].find(
				(item) =>
					item.id ===
					(tipo === 'formatos' ? formularioSeleccionadoId : tipo === 'conductores' ? conductorId : vehicleId)
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
	function buscarFormatos(q: string) { void buscarOpciones('formatos', q); }
	function buscarConductores(q: string) { void buscarOpciones('conductores', q); }
	function buscarVehiculos(q: string) { void buscarOpciones('vehiculos', q); }
	async function abrir() {
		modal = true;
		error = '';
		formularioSeleccionadoId = '';
		conductorId = '';
		vehicleId = '';
		documentos = [];
		explanation = '';
		detalles = [];
		progreso = '';
		try {
			opciones = await escaneadosAPI.opciones('', formId);
			if (formId && opciones.formatos.length === 1) formularioSeleccionadoId = opciones.formatos[0].id;
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudieron cargar las opciones.';
		}
	}
	function seleccionarFormato(valor: string | null) {
		formularioSeleccionadoId = valor ?? '';
		for (const documento of documentos) {
			documento.novedades = [];
		}
	}
	function seleccionarArchivos(files: FileList | null) {
		const nuevos = Array.from(files ?? []);
		if (archivoInput) archivoInput.value = '';
		if (!nuevos.length) return;
		if (nuevos.some((file) => file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) {
			error = 'Todos los archivos deben ser PDF.';
			return;
		}
		if (nuevos.some((file) => file.size > 25 * 1024 * 1024)) {
			error = 'Cada PDF debe pesar máximo 25 MB.';
			return;
		}
		documentos = [
			...documentos,
			...nuevos.map((archivo) => ({
				key: crypto.randomUUID(),
				archivo,
				dateFrom: '',
				dateTo: '',
				novedades: [],
				pendingId: null,
				completado: false
			}))
		];
		error = '';
	}
	function soltarArchivo(event: DragEvent) {
		event.preventDefault();
		arrastrando = false;
		if (guardando) return;
		seleccionarArchivos(event.dataTransfer?.files ?? null);
	}
	function programarCarga() {
		if (timerLista) clearTimeout(timerLista);
		pagina = 1;
		timerLista = setTimeout(() => void cargar(), 300);
	}
	async function guardar() {
		if (!formularioSeleccionadoId || !conductorId || !vehicleId || !documentos.length) {
			error = 'Selecciona el formato, conductor, placa y al menos un PDF.';
			return;
		}
		for (const [indice, documento] of documentos.entries()) {
			if (documento.completado) continue;
			if (!documento.dateFrom || !documento.dateTo || documento.dateTo < documento.dateFrom) {
				error = `Indica un rango válido de fechas para el PDF ${indice + 1}.`;
				return;
			}
			for (const novedad of esPreoperacional ? documento.novedades : []) {
				if (!novedad.fecha && !novedad.descripcion.trim()) continue;
				if (!novedad.fecha || !novedad.descripcion.trim()) {
					error = `Completa la fecha y descripción de cada novedad del PDF ${indice + 1}, o quita la fila vacía.`;
					return;
				}
				if (novedad.fecha < documento.dateFrom || novedad.fecha > documento.dateTo) {
					error = `Las novedades del PDF ${indice + 1} deben estar dentro del período cubierto.`;
					return;
				}
			}
			if (documento.archivo.size > 25 * 1024 * 1024) {
				error = `El PDF ${indice + 1} supera el límite de 25 MB.`;
				return;
			}
			const firma = new Uint8Array(await documento.archivo.slice(0, 1024).arrayBuffer());
			if (!new TextDecoder().decode(firma).includes('%PDF-')) {
				error = `El archivo ${documento.archivo.name} no parece ser un PDF.`;
				return;
			}
		}
		const detallesBase: Record<string, string> = {};
		for (const item of detalles) {
			if (item.clave.trim() && item.valor.trim()) detallesBase[item.clave.trim()] = item.valor.trim();
		}
		if (Object.keys(detallesBase).length > 20) {
			error = 'El formato admite máximo 20 datos adicionales.';
			return;
		}
		guardando = true;
		error = '';
		try {
			for (const [indice, documento] of documentos.entries()) {
				if (documento.completado) continue;
				progreso = `Subiendo PDF ${indice + 1} de ${documentos.length}…`;
				if (!documento.pendingId) {
					const hash = await crypto.subtle.digest('SHA-256', await documento.archivo.arrayBuffer());
					const sha256 = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
					const details = { ...detallesBase };
					const novedades = esPreoperacional
						? documento.novedades.filter((n) => n.fecha && n.descripcion.trim()).map((n) => ({
								fecha: n.fecha,
								descripcion: n.descripcion.trim()
							}))
						: [];
					const { id } = await escaneadosAPI.iniciar({
						formId: formularioSeleccionadoId,
						conductorId,
						vehicleId,
						dateFrom: documento.dateFrom,
						dateTo: documento.dateTo,
						explanation: explanation.trim(),
						details,
						novedades,
						originalName: documento.archivo.name,
						byteSize: documento.archivo.size,
						sha256
					});
					documento.pendingId = id;
				}
				await escaneadosAPI.subir(documento.pendingId, documento.archivo, (porcentaje) => {
					progreso = `Subiendo PDF ${indice + 1} de ${documentos.length}… ${porcentaje}%`;
				});
				documento.completado = true;
			}
			modal = false;
			const totalSubidos = documentos.length;
			documentos = [];
			explanation = '';
			detalles = [];
			progreso = '';
			pagina = 1;
			await cargar();
			toast.success(`${totalSubidos} PDF${totalSubidos === 1 ? '' : 's'} escaneado${totalSubidos === 1 ? '' : 's'} guardado${totalSubidos === 1 ? '' : 's'}.`);
		} catch (e) {
			error = `La carga se detuvo. Los PDF marcados como guardados no se repetirán. ${e instanceof Error ? e.message : 'No se pudo guardar el PDF.'}`;
			await cargar();
		} finally {
			guardando = false;
			progreso = '';
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
	function editar(registro: Escaneado) {
		registroEdicion = registro;
		fechaDesdeEdicion = registro.dateFrom;
		fechaHastaEdicion = registro.dateTo;
		explicacionEdicion = registro.explanation ?? '';
		novedadesEdicion = novedadesGuardadas(registro.details).map((novedad) => ({
			...novedad,
			key: crypto.randomUUID()
		}));
		detallesEdicion = Object.entries(registro.details ?? {})
			.filter(([key, value]) =>
				typeof value === 'string' && !['fecha_novedad', 'novedad'].includes(key)
			)
			.map(([clave, valor]) => ({ clave, valor: String(valor) }));
		errorEdicion = '';
		archivoReemplazo = null;
		errorReemplazo = '';
	}
	function seleccionarArchivoReemplazo(archivo?: File) {
		if (!archivo) return;
		if (archivo.type !== 'application/pdf' && !archivo.name.toLowerCase().endsWith('.pdf')) {
			archivoReemplazo = null;
			errorReemplazo = 'Selecciona un archivo PDF.';
			return;
		}
		if (archivo.size === 0 || archivo.size > 25 * 1024 * 1024) {
			archivoReemplazo = null;
			errorReemplazo = archivo.size > 25 * 1024 * 1024
				? 'El PDF supera el límite de 25 MB.'
				: 'El archivo está vacío.';
			return;
		}
		archivoReemplazo = archivo;
		errorReemplazo = '';
	}
	function soltarReemplazo(event: DragEvent) {
		event.preventDefault();
		arrastrandoReemplazo = false;
		seleccionarArchivoReemplazo(event.dataTransfer?.files?.[0]);
	}
	async function guardarReemplazoArchivo() {
		if (!registroEdicion || !archivoReemplazo) return;
		reemplazandoArchivo = true;
		errorReemplazo = '';
		try {
			const prefijo = new Uint8Array(await archivoReemplazo.slice(0, 1024).arrayBuffer());
			if (!new TextDecoder().decode(prefijo).includes('%PDF-')) {
				errorReemplazo = 'El archivo no contiene una cabecera PDF válida.';
				return;
			}
			const archivo = archivoReemplazo;
			const resultado = await escaneadosAPI.reemplazarArchivo(registroEdicion.id, archivo);
			registroEdicion = {
				...registroEdicion,
				originalName: resultado.originalName,
				byteSize: resultado.byteSize,
				uploadedAt: resultado.uploadedAt
			};
			archivoReemplazo = null;
			if (archivoReemplazoInput) archivoReemplazoInput.value = '';
			await cargar();
			toast.success('PDF reemplazado.');
		} catch (e) {
			errorReemplazo = e instanceof Error ? e.message : 'No se pudo reemplazar el PDF.';
		} finally {
			reemplazandoArchivo = false;
		}
	}
	async function guardarEdicion() {
		if (!registroEdicion) return;
		if (!fechaDesdeEdicion || !fechaHastaEdicion || fechaHastaEdicion < fechaDesdeEdicion) {
			errorEdicion = 'Indica un rango válido de fechas.';
			return;
		}
		const novedades: NovedadEscaneado[] = [];
		for (const novedad of novedadesEdicion) {
			if (!novedad.fecha && !novedad.descripcion.trim()) continue;
			if (!novedad.fecha || !novedad.descripcion.trim()) {
				errorEdicion = 'Completa la fecha y descripción de cada novedad, o quita la fila vacía.';
				return;
			}
			if (novedad.fecha < fechaDesdeEdicion || novedad.fecha > fechaHastaEdicion) {
				errorEdicion = 'Cada novedad debe estar dentro del período cubierto.';
				return;
			}
			novedades.push({ fecha: novedad.fecha, descripcion: novedad.descripcion.trim() });
		}
		const details: Record<string, string> = {};
		for (const detalle of detallesEdicion) {
			if (detalle.clave.trim() && detalle.valor.trim()) details[detalle.clave.trim()] = detalle.valor.trim();
		}
		if (Object.keys(details).length > 20) {
			errorEdicion = 'El formato admite máximo 20 datos adicionales.';
			return;
		}
		guardandoEdicion = true;
		errorEdicion = '';
		try {
			await escaneadosAPI.actualizar(registroEdicion.id, {
				dateFrom: fechaDesdeEdicion,
				dateTo: fechaHastaEdicion,
				explanation: explicacionEdicion.trim(),
				details,
				novedades
			});
			registroEdicion = null;
			await cargar();
			toast.success('Datos del PDF escaneado actualizados.');
		} catch (e) {
			errorEdicion = e instanceof Error ? e.message : 'No se pudieron guardar los cambios.';
		} finally {
			guardandoEdicion = false;
		}
	}
	async function eliminar(registro: Escaneado) {
		if (!window.confirm(`¿Eliminar el PDF escaneado “${registro.originalName}”?`)) return;
		eliminandoId = registro.id;
		try {
			await escaneadosAPI.eliminar(registro.id);
			if (registros.length === 1 && pagina > 1) pagina--;
			await cargar();
			toast.success('PDF escaneado eliminado.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'No se pudo eliminar el PDF escaneado.');
		} finally {
			eliminandoId = null;
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
					: puedeEditar
						? 'Adjunta el primer PDF diligenciado en papel para conservarlo junto al formulario.'
						: 'No hay PDFs físicos cargados para esta búsqueda.'}
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
						<strong>{registro.formCode} · {registro.formName}</strong>
					</div>
					<div>
						<strong>{registro.conductor}</strong><small
							>{registro.document ?? 'Sin documento'} · {registro.placa}</small
						>
					</div>
					<div>
						<strong>{registro.dateFrom} a {registro.dateTo} · {registro.daysCovered} día{registro.daysCovered === 1 ? '' : 's'}</strong>
						{#if registro.explanation}<small>{registro.explanation}</small>{/if}
						{#if detallesTexto(registro.details)}<small>{detallesTexto(registro.details)}</small>{/if}
						{#each novedadesGuardadas(registro.details) as novedad}
							<small>Novedad del {novedad.fecha}: {novedad.descripcion}</small>
						{/each}
					</div>
					<button type="button" class="accion secundario" onclick={() => ver(registro.id)}
						>Ver PDF</button
					>
					{#if puedeGestionarEscaneados}
						<div class="acciones-registro">
							<button type="button" class="accion secundario" onclick={() => editar(registro)}>Editar</button>
							<button type="button" class="accion peligro" disabled={eliminandoId === registro.id}
								onclick={() => void eliminar(registro)}>{eliminandoId === registro.id ? 'Eliminando…' : 'Eliminar'}</button>
						</div>
					{/if}
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
					<p>Relaciona cada PDF con su formato, conductor, placa y fechas cubiertas.</p>
				</div>
				<button type="button" aria-label="Cerrar" class="cerrar" disabled={guardando} onclick={() => (modal = false)}
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
						<span>Formato</span>
						<SelectBuscable
							opciones={formatos}
							valor={formularioSeleccionadoId || null}
							placeholder="Buscar formato…"
							placeholderBusqueda="Nombre o código del formato"
							ariaLabel="Formato"
							deshabilitado={cargaIniciada}
							onSeleccionar={seleccionarFormato}
							onBuscar={buscarFormatos}
						/>
						{#if formId}<small class="ayuda">Formato del enlace seleccionado automáticamente.</small>{/if}
					</div>
					<div class="campo">
						<span>Conductor</span>
						<SelectBuscable
							opciones={conductores}
							valor={conductorId || null}
							placeholder="Buscar conductor…"
							placeholderBusqueda="Nombre o documento"
							ariaLabel="Conductor"
							deshabilitado={cargaIniciada}
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
							deshabilitado={cargaIniciada}
							onSeleccionar={(valor) => (vehicleId = valor ?? '')}
							onBuscar={buscarVehiculos}
						/>
					</div>
				</div>
				<div class="campo">
					<span>PDF escaneados</span>
					<input
						bind:this={archivoInput}
						type="file"
						accept="application/pdf,.pdf"
						multiple
						class="sr-only"
						onchange={(e) => seleccionarArchivos(e.currentTarget.files)}
					/>
					<button
						type="button"
						class="zona-archivo"
						class:arrastrando
						disabled={guardando}
						onclick={() => archivoInput?.click()}
						ondragover={(e) => {
							e.preventDefault();
							arrastrando = true;
						}}
						ondragleave={() => (arrastrando = false)}
						ondrop={soltarArchivo}
					>
						<span class="icono-archivo" aria-hidden="true">↑</span>
						<strong>{documentos.length ? 'Añadir más PDF' : 'Arrastra los PDF aquí o selecciónalos'}</strong>
						<small>Selecciona varios archivos · Máximo 25 MB por PDF</small>
					</button>
				</div>
				{#each documentos as documento, indice (documento.key)}
					<section class="documento-pendiente">
						<div class="documento-cabecera">
							<div>
								<strong>PDF {indice + 1} · {documento.archivo.name}</strong>
								<small>{(documento.archivo.size / 1024 / 1024).toFixed(1)} MB</small>
							</div>
							{#if documento.completado}
								<span class="documento-guardado">Guardado</span>
							{:else if !documento.pendingId}
								<button type="button" class="quitar-archivo" disabled={guardando}
									onclick={() => (documentos = documentos.filter((item) => item.key !== documento.key))}
									>Quitar</button>
							{:else}
								<span class="documento-pendiente-estado">Pendiente de subir</span>
							{/if}
						</div>
						<div class="fechas">
							<label>Desde<input required type="date" disabled={!!documento.pendingId}
								bind:value={documento.dateFrom} /></label>
							<label>Hasta<input required type="date" min={documento.dateFrom}
								disabled={!!documento.pendingId} bind:value={documento.dateTo} /></label>
						</div>
						{#if diasCubiertos(documento) > 0}
							<p class="cobertura">Este PDF cubre {diasCubiertos(documento)} día{diasCubiertos(documento) === 1 ? '' : 's'} (ambas fechas incluidas).</p>
						{/if}
					</section>
				{/each}
				<label
					>{documentos.length > 1
						? 'Qué contienen los PDF y por qué cubren sus fechas'
						: 'Qué contiene el PDF y por qué cubre estas fechas'} <small>(opcional; se guarda en cada PDF)</small><textarea
						maxlength="2000"
						disabled={cargaIniciada}
						bind:value={explanation}
						placeholder="Agrega una nota si necesitas dar contexto"
					></textarea></label
				>
				{#if esPreoperacional && documentos.length}
					<section class="novedades-preoperacional">
						<div class="novedades-encabezado">
							<strong>Novedades del preoperacional</strong>
							<small>Opcional · registra una fecha concreta y qué ocurrió</small>
						</div>
						{#each documentos as documento, indice (documento.key)}
							<div class="novedad-documento">
								<strong>PDF {indice + 1} · {documento.archivo.name}</strong>
								{#each documento.novedades as novedad (novedad.key)}
									<div class="novedad-fila">
										<div class="novedad-campos">
											<label>Fecha de la novedad
												<input type="date" min={documento.dateFrom || undefined}
													max={documento.dateTo || undefined} disabled={!!documento.pendingId}
													bind:value={novedad.fecha} />
											</label>
											<label>Descripción de la novedad
												<textarea maxlength="500" disabled={!!documento.pendingId}
													bind:value={novedad.descripcion}
													placeholder="Ej.: manifestó que tomaba un medicamento y por eso disminuyó su sueño"></textarea>
											</label>
										</div>
										{#if !documento.pendingId}<button type="button" class="quitar-archivo"
											onclick={() => (documento.novedades = documento.novedades.filter((item) => item.key !== novedad.key))}
											>Quitar novedad</button>{/if}
									</div>
								{/each}
								<button type="button" class="quitar-archivo" disabled={!!documento.pendingId || documento.novedades.length >= 50}
									onclick={() => (documento.novedades = [...documento.novedades, { key: crypto.randomUUID(), fecha: '', descripcion: '' }])}
									>+ Agregar novedad</button>
							</div>
						{/each}
					</section>
				{/if}
				<details class="detalles">
					<summary
						>Datos adicionales <small>Opcional, para actas y formatos especiales</small></summary
					>
					{#each detalles as detalle, i}<div class="detalle">
							<input
								aria-label="Nombre del dato"
								placeholder="Ej.: Entrega de"
								disabled={cargaIniciada}
								bind:value={detalle.clave}
								maxlength="80"
							/><input
								aria-label="Valor del dato"
								placeholder="Nombre o descripción"
								disabled={cargaIniciada}
								bind:value={detalle.valor}
								maxlength="500"
							/><button
								type="button"
									disabled={cargaIniciada}
									onclick={() => (detalles = detalles.filter((_, n) => n !== i))}>×</button
							>
						</div>{/each}
					<button
						type="button"
						disabled={cargaIniciada || detalles.length >= 20}
						onclick={() => (detalles = [...detalles, { clave: '', valor: '' }])}
						>Agregar dato</button
					>
				</details>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				{#if progreso}<p class="cobertura" role="status">{progreso}</p>{/if}
				<footer>
					<button type="button" disabled={guardando} onclick={() => (modal = false)}
						>Cancelar</button
					><button type="submit" class="accion" disabled={guardando}
						>{guardando ? 'Subiendo y verificando…' : `Guardar ${documentos.length} PDF${documentos.length === 1 ? '' : 's'}`}</button
					>
				</footer>
			</form>
		</dialog>
	</div>
{/if}

{#if registroEdicion}
	<div class="fondo" role="presentation">
		<dialog open aria-modal="true" aria-labelledby="titulo-edicion" class="modal">
			<header class="cabecera">
				<div>
					<span class="eyebrow">Formato físico escaneado</span>
					<h3 id="titulo-edicion">Editar datos del PDF</h3>
					<p>{registroEdicion.originalName} · {(registroEdicion.byteSize / 1024 / 1024).toFixed(1)} MB</p>
				</div>
				<button type="button" aria-label="Cerrar" class="cerrar" disabled={guardandoEdicion || reemplazandoArchivo}
					onclick={() => (registroEdicion = null)}>×</button>
			</header>
			<form onsubmit={(event) => { event.preventDefault(); void guardarEdicion(); }}>
				<section class="reemplazo-archivo">
					<div class="novedades-encabezado">
						<strong>Reemplazar PDF</strong><small>El nuevo archivo sustituirá al actual</small>
					</div>
					<input bind:this={archivoReemplazoInput} type="file" accept="application/pdf,.pdf" class="sr-only"
						disabled={reemplazandoArchivo} onchange={(event) => seleccionarArchivoReemplazo(event.currentTarget.files?.[0])} />
					<button type="button" class="zona-archivo" class:arrastrando={arrastrandoReemplazo}
						disabled={reemplazandoArchivo} onclick={() => archivoReemplazoInput?.click()}
						ondragover={(event) => { event.preventDefault(); arrastrandoReemplazo = true; }}
						ondragleave={() => (arrastrandoReemplazo = false)} ondrop={soltarReemplazo}>
						<span class="icono-archivo" aria-hidden="true">↑</span>
						<strong>{archivoReemplazo?.name ?? 'Arrastra un PDF aquí o selecciónalo'}</strong>
						<small>Un archivo · Máximo 25 MB</small>
					</button>
					{#if errorReemplazo}<p class="error" role="alert">{errorReemplazo}</p>{/if}
					<button type="button" class="accion" disabled={!archivoReemplazo || reemplazandoArchivo || guardandoEdicion}
						onclick={guardarReemplazoArchivo}>{reemplazandoArchivo ? 'Reemplazando…' : 'Reemplazar archivo actual'}</button>
				</section>
				<div class="fechas">
					<label>Desde<input required type="date" bind:value={fechaDesdeEdicion} /></label>
					<label>Hasta<input required type="date" min={fechaDesdeEdicion} bind:value={fechaHastaEdicion} /></label>
				</div>
				<label>Qué contiene el PDF y por qué cubre estas fechas (opcional)
					<textarea maxlength="2000" bind:value={explicacionEdicion} placeholder="Agrega una nota de contexto"></textarea>
				</label>
				<section class="novedades-preoperacional">
					<div class="novedades-encabezado">
						<strong>Novedades</strong><small>Opcional · fecha concreta y descripción</small>
					</div>
					{#each novedadesEdicion as novedad (novedad.key)}
						<div class="novedad-fila">
							<div class="novedad-campos">
								<label>Fecha de la novedad<input type="date" min={fechaDesdeEdicion || undefined}
									max={fechaHastaEdicion || undefined} bind:value={novedad.fecha} /></label>
								<label>Descripción<textarea maxlength="500" bind:value={novedad.descripcion}
									placeholder="Describe la novedad"></textarea></label>
							</div>
							<button type="button" class="quitar-archivo" onclick={() => (novedadesEdicion = novedadesEdicion.filter((item) => item.key !== novedad.key))}>Quitar novedad</button>
						</div>
					{/each}
					<button type="button" class="quitar-archivo" disabled={novedadesEdicion.length >= 50}
						onclick={() => (novedadesEdicion = [...novedadesEdicion, { key: crypto.randomUUID(), fecha: '', descripcion: '' }])}>+ Agregar novedad</button>
				</section>
				<details class="detalles">
					<summary>Datos adicionales <small>Opcional</small></summary>
					{#each detallesEdicion as detalle, indice (indice)}
						<div class="detalle">
							<input aria-label="Nombre del dato" placeholder="Nombre del dato" maxlength="80" bind:value={detalle.clave} />
							<input aria-label="Valor del dato" placeholder="Valor o descripción" maxlength="500" bind:value={detalle.valor} />
							<button type="button" aria-label="Quitar dato" onclick={() => (detallesEdicion = detallesEdicion.filter((_, i) => i !== indice))}>×</button>
						</div>
					{/each}
					<button type="button" disabled={detallesEdicion.length >= 20}
						onclick={() => (detallesEdicion = [...detallesEdicion, { clave: '', valor: '' }])}>Agregar dato</button>
				</details>
				{#if errorEdicion}<p class="error" role="alert">{errorEdicion}</p>{/if}
				<footer>
					<button type="button" disabled={guardandoEdicion || reemplazandoArchivo} onclick={() => (registroEdicion = null)}>Cancelar</button>
					<button type="submit" class="accion" disabled={guardandoEdicion || reemplazandoArchivo}>{guardandoEdicion ? 'Guardando…' : 'Guardar cambios'}</button>
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
		color: #065f46;
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
		background: #065f46;
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
		border-color: color-mix(in srgb, #065f46 25%, white);
		background: #ecfdf5;
		color: #065f46;
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
		border-color: #065f46;
		box-shadow: 0 0 0 3px color-mix(in srgb, #065f46 12%, transparent);
	}
	.contador {
		margin-left: auto;
		padding: 0.48rem 0.7rem;
		border-radius: 999px;
		background: #ecfdf5;
		color: #065f46;
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
		background: #ecfdf5;
		color: #065f46;
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
		grid-template-columns: 1.3fr 1fr 1.5fr auto auto;
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
	.acciones-registro {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.registro .acciones-registro {
		display: flex;
	}
	.peligro {
		border-color: #fecaca;
		background: #fff1f2;
		color: #b42318;
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
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
		gap: 0.85rem;
	}
	.identidad .campo {
		min-width: 0;
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
		background: #ecfdf5;
		color: #065f46;
		font-size: 0.74rem;
		font-weight: 650;
	}
	.detalles {
		padding: 0.75rem;
		border: 1px solid var(--border-default, #d9e3de);
		border-radius: 0.7rem;
	}
	.novedades-preoperacional {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 0.9rem;
		border: 1px solid var(--border-default, #d9e3de);
		border-radius: 0.85rem;
		background: var(--bg-base, #f8faf9);
	}
	.novedades-encabezado {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
	}
	.novedades-encabezado strong {
		color: var(--text-primary, #172320);
		font-size: 0.8rem;
		font-weight: 750;
	}
	.novedades-encabezado small {
		color: var(--text-muted, #66756e);
		font-size: 0.73rem;
		font-weight: 500;
	}
	.novedad-documento {
		display: grid;
		gap: 0.55rem;
		min-width: 0;
		padding-top: 0.65rem;
		border-top: 1px solid var(--border-default, #d9e3de);
	}
	.novedad-documento > strong {
		overflow-wrap: anywhere;
		font-size: 0.76rem;
	}
	.novedad-fila {
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}
	.novedad-fila + .novedad-fila {
		padding-top: 0.65rem;
		border-top: 1px dashed var(--border-default, #d9e3de);
	}
	.novedad-fila > button,
	.novedad-documento > button {
		justify-self: start;
	}
	.novedad-campos {
		display: grid;
		grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
		gap: 0.75rem;
	}
	.documento-pendiente {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 0.9rem;
		border: 1px solid var(--border-default, #d9e3de);
		border-radius: 0.85rem;
		background: var(--bg-base, #f8faf9);
	}
	.documento-cabecera {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.documento-cabecera > div {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}
	.documento-cabecera strong {
		overflow-wrap: anywhere;
		font-size: 0.82rem;
	}
	.documento-cabecera small,
	.documento-pendiente-estado {
		color: var(--text-muted, #66756e);
		font-size: 0.72rem;
	}
	.documento-guardado {
		color: #065f46;
		font-size: 0.72rem;
		font-weight: 750;
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
		border: 1.5px dashed color-mix(in srgb, #065f46 48%, white);
		border-radius: 0.85rem;
		padding: 0.85rem;
		background: #ecfdf5;
		color: #065f46;
		cursor: pointer;
		text-align: center;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.zona-archivo:hover,
	.zona-archivo.arrastrando {
		border-color: #065f46;
		background: color-mix(in srgb, #065f46 13%, white);
	}
	.zona-archivo:disabled {
		cursor: wait;
		opacity: 0.65;
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
		.novedad-campos,
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
