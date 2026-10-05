<!--
	Resumen de un formulario: metadatos, historial de versiones y asignaciones.

	Es el sitio donde se toman las decisiones de ciclo de vida, y por eso cada
	acción explica su consecuencia antes de ejecutarla:

	  - **Clonar** es la única forma de "editar" una publicada. Crea un borrador con
	    ids nuevos; la publicada sigue intacta y sus envíos siguen cuadrando.
	  - **Archivar una versión** impide asignaciones y envíos nuevos, pero conserva
	    la consulta histórica. Exige cerrar antes sus asignaciones.
	  - **Duplicar el formulario** arranca uno nuevo desde este snapshot (así se
	    saca el FR-09 del FR-08, que comparten casi todo).
-->
<script lang="ts">
	import { confirmar } from '$lib/stores/confirm';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { toast } from 'svelte-sonner';
	import {
		asignacionesFormularioAPI,
		enviosFormularioAPI,
		formulariosAPI,
		FormApiError
	} from '$lib/api/formularios';
	import {
		ASSIGNMENT_STATUS_LABELS,
		FREQUENCY_LABELS,
		LIMIT_POLICY_LABELS,
		SUBMISSION_STATUS_LABELS,
		type AssignmentDto,
		type FormDefinitionDto,
		type SubmissionSummaryDto,
		type VersionStatus
	} from '$lib/formularios/types';
	import AssignmentEditor from '$lib/components/formularios/AssignmentEditor.svelte';
	import ModalDuplicarFormulario from '$lib/components/formularios/ModalDuplicarFormulario.svelte';
	import TabsVista from '$lib/components/ui/TabsVista.svelte';
	import PaginadorLista from '$lib/components/listing/PaginadorLista.svelte';

	const formId = $derived($page.params.formId!);

	let form = $state<FormDefinitionDto | null>(null);
	let asignaciones = $state<AssignmentDto[]>([]);
	let cargando = $state(true);
	let trabajando = $state(false);
	let editorAsignacion = $state<{ versionId: string; existing?: AssignmentDto } | null>(null);
	let duplicando = $state(false);

	/**
	 * Los envíos de este formato, aquí mismo.
	 *
	 * Antes había un botón a una pantalla de envíos filtrada. Un salto de página
	 * para llegar a lo que uno viene a ver —quién diligenció y qué respondió— es
	 * un salto de más: los registros son la razón de existir del formato, no un
	 * apéndice suyo.
	 */
	let envios = $state<SubmissionSummaryDto[]>([]);
	let totalEnvios = $state(0);
	let cargandoEnvios = $state(true);
	let paginaEnvios = $state(1);
	const POR_PAGINA_ENVIOS = 25;

	/**
	 * Registros, versiones y asignaciones van en pestañas, no apilados.
	 *
	 * Apiladas, las tarjetas de versiones y asignaciones ocupaban media pantalla
	 * antes del primer registro, que es lo que casi siempre se viene a ver. La
	 * vista viaja en la URL (`?vista=`) para que un enlace abra en la misma.
	 */
	type Vista = 'registros' | 'versiones' | 'asignaciones';
	const VISTAS: Vista[] = ['registros', 'versiones', 'asignaciones'];
	const vistaUrl = $page.url.searchParams.get('vista') as Vista | null;
	let vista = $state<Vista>(vistaUrl && VISTAS.includes(vistaUrl) ? vistaUrl : 'registros');

	function cambiarVista(id: string) {
		const url = new URL($page.url);
		if (id === 'registros') url.searchParams.delete('vista');
		else url.searchParams.set('vista', id);
		history.replaceState(history.state, '', url);
	}

	function irPaginaEnvios(p: number) {
		paginaEnvios = p;
		void cargarEnvios();
	}

	/**
	 * La pestaña activa, siempre a la vista.
	 *
	 * En móvil las tres pestañas no caben y la barra se desplaza en horizontal:
	 * un enlace con `?vista=asignaciones` abría la pestaña correcta pero fuera de
	 * pantalla, y no se veía cuál estaba elegida.
	 */
	let zonaTabs = $state<HTMLElement | null>(null);
	$effect(() => {
		void vista;
		const lista = zonaTabs?.querySelector<HTMLElement>('[role="tablist"]');
		const activa = lista?.querySelector<HTMLElement>('[aria-selected="true"]');
		if (!lista || !activa) return;
		const izq = activa.offsetLeft;
		const der = izq + activa.offsetWidth;
		if (izq < lista.scrollLeft || der > lista.scrollLeft + lista.clientWidth) {
			lista.scrollTo({ left: Math.max(0, izq - 16) });
		}
	});

	async function cargar() {
		cargando = true;
		try {
			const [definicion, lista] = await Promise.all([
				formulariosAPI.obtener(formId),
				asignacionesFormularioAPI.listar({ formId, limit: 100 })
			]);
			form = definicion;
			asignaciones = lista.data;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo cargar el formulario.');
		} finally {
			cargando = false;
		}
	}

	/**
	 * Los envíos van en su propia petición, no en el `Promise.all` de arriba.
	 *
	 * La ficha del formato tiene que pintarse aunque el listado tarde o falle: son
	 * dos consultas de coste muy distinto —una lee metadatos, la otra recorre
	 * `form_submissions`— y encadenarlas dejaría la pantalla en blanco por culpa de
	 * la lenta.
	 */
	async function cargarEnvios() {
		cargandoEnvios = true;
		try {
			const { data, meta } = await enviosFormularioAPI.listar({
				formId,
				page: paginaEnvios,
				limit: POR_PAGINA_ENVIOS
			});
			envios = data;
			totalEnvios = meta?.total ?? data.length;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudieron cargar los envíos.');
		} finally {
			cargandoEnvios = false;
		}
	}

	/**
	 * Fechas como en la app: «01 oct 2026» y «12:27 p. m.».
	 *
	 * `toLocaleString` daba «01 de oct de 2026, 12:27 p. m.», que en una columna
	 * o una tarjeta estrecha partía en cuatro renglones. Los espacios internos
	 * pasan a no separables para que el día y la hora nunca se corten por dentro.
	 */
	const FMT_DIA = new Intl.DateTimeFormat('es-CO', {
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	});
	const FMT_HORA = new Intl.DateTimeFormat('es-CO', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});

	function dia(iso: string | null): string {
		if (!iso) return '—';
		const partes = FMT_DIA.formatToParts(new Date(iso));
		const de = (t: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === t)?.value ?? '';
		return `${de('day')}\u00a0${de('month').replace('.', '')}\u00a0${de('year')}`;
	}

	function hora(iso: string | null): string {
		if (!iso) return '';
		return FMT_HORA.format(new Date(iso)).replace(/\s/g, '\u00a0');
	}

	onMount(() => {
		void cargar();
		void cargarEnvios();
	});

	async function clonar(versionId: string, versionNumber: number) {
		const ok = await confirmar({
			title: `¿Clonar la v${versionNumber} en un borrador nuevo?`,
			message: 'La versión actual queda intacta y sus envíos no cambian.',
			tone: 'info',
			confirmText: 'Clonar'
		});
		if (!ok) return;
		trabajando = true;
		try {
			const nueva = await formulariosAPI.clonarVersion(formId, versionId);
			toast.success(`Se creó el borrador v${nueva.versionNumber}.`);
			await goto(`/dashboard/formularios/${formId}/editar/${nueva.id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo clonar.');
		} finally {
			trabajando = false;
		}
	}

	async function archivarVersion(versionId: string, versionNumber: number) {
		const ok = await confirmar({
			title: `¿Archivar la v${versionNumber}?`,
			message: 'Dejará de admitir asignaciones y envíos nuevos; el histórico se conserva.',
			tone: 'warning',
			confirmText: 'Archivar'
		});
		if (!ok) return;
		trabajando = true;
		try {
			await formulariosAPI.archivarVersion(formId, versionId);
			toast.success(`v${versionNumber} archivada.`);
			await cargar();
		} catch (err) {
			if (err instanceof FormApiError) toast.error(err.message);
			else toast.error('No se pudo archivar la versión.');
		} finally {
			trabajando = false;
		}
	}

	function duplicarFormulario() {
		duplicando = true;
	}

	/**
	 * Tras duplicar se abre el formulario nuevo.
	 *
	 * Es la misma ruta con otro `formId`, y SvelteKit reutiliza el componente:
	 * `onMount` no vuelve a correr, así que sin recargar a mano se vería el
	 * formulario de origen bajo la URL del nuevo.
	 */
	async function alDuplicar(nuevo: FormDefinitionDto) {
		toast.success(`${nuevo.code} creado desde este formulario.`);
		await goto(`/dashboard/formularios/${nuevo.id}`);
		duplicando = false;
		vista = 'registros';
		paginaEnvios = 1;
		void cargar();
		void cargarEnvios();
	}

	async function cambiarEstadoAsignacion(
		a: AssignmentDto,
		accion: 'pausar' | 'reactivar' | 'cerrar'
	) {
		if (
			accion === 'cerrar' &&
			!(await confirmar({
				title: '¿Cerrar la asignación?',
				message: 'Es definitivo: la asignación no se puede reabrir.',
				tone: 'warning',
				confirmText: 'Cerrar asignación'
			}))
		)
			return;
		trabajando = true;
		try {
			if (accion === 'pausar') await asignacionesFormularioAPI.pausar(a.id);
			else if (accion === 'reactivar') await asignacionesFormularioAPI.reactivar(a.id);
			else await asignacionesFormularioAPI.cerrar(a.id);
			toast.success('Asignación actualizada.');
			await cargar();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'No se pudo actualizar la asignación.');
		} finally {
			trabajando = false;
		}
	}

	function fecha(iso: string | null): string {
		if (!iso) return '—';
		return `${dia(iso)}, ${hora(iso)}`;
	}

	const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
		DRAFT: 'Borrador',
		PUBLISHED: 'Publicada',
		ARCHIVED: 'Archivada'
	};

	const plural = (n: number, uno: string, varios: string) =>
		`${n.toLocaleString('es-CO')} ${n === 1 ? uno : varios}`;

	const versiones = $derived(form?.versions ?? []);
	const publicadas = $derived(versiones.filter((v) => v.status === 'PUBLISHED'));
</script>

<svelte:head><title>{form ? `${form.code} · Formularios` : 'Formulario'}</title></svelte:head>

<div class="pagina">
	<nav class="migas" aria-label="Ruta">
		<a href="/dashboard/formularios">Formularios</a>
		<span aria-hidden="true">›</span>
		<span>{form?.code ?? '…'}</span>
	</nav>

	{#if cargando}
		<div class="estado" aria-busy="true">Cargando…</div>
	{:else if !form}
		<div class="estado estado--error">No se encontró el formulario.</div>
	{:else}
		<header class="head">
			<div class="head__texto">
				<span class="head__code">{form.code}</span>
				<h1 class="head__titulo">{form.name}</h1>
				{#if form.description}<p class="head__desc">{form.description}</p>{/if}
				<p class="head__meta">
					<span class="nw">Área {form.ownerArea}</span> · <span class="nw">slug {form.slug}</span> ·
					<span class="nw">actualizado {fecha(form.updatedAt)}</span>
				</p>
			</div>
			<div class="head__acciones">
				{#if form.draftVersion}
					<a
						class="btn-primary cab-accion"
						href={`/dashboard/formularios/${formId}/editar/${form.draftVersion.id}`}
					>
						Continuar borrador v{form.draftVersion.versionNumber}
					</a>
				{:else if form.activeVersion}
					<button
						type="button"
						class="btn-primary cab-accion"
						disabled={trabajando}
						onclick={() => clonar(form!.activeVersion!.id, form!.activeVersion!.versionNumber)}
					>
						Editar (clonar v{form!.activeVersion!.versionNumber})
					</button>
				{/if}
				<button
					type="button"
					class="btn-secondary cab-accion"
					disabled={trabajando}
					onclick={duplicarFormulario}
				>
					Duplicar formulario
				</button>
			</div>
		</header>

		<div class="tabs" bind:this={zonaTabs}>
			<TabsVista
				etiqueta="Vistas del formulario"
				tabs={[
					{ id: 'registros', label: 'Registros diligenciados', cuenta: totalEnvios },
					{ id: 'versiones', label: 'Versiones', cuenta: versiones.length },
					{ id: 'asignaciones', label: 'Asignaciones', cuenta: asignaciones.length }
				]}
				bind:activa={vista}
				onCambiar={cambiarVista}
			/>
		</div>

		{#if vista === 'registros'}
			<section class="bloque">
				<div class="intro">
					<p class="intro__texto">
						Quién diligenció este formato y cuándo. Abre un registro para ver sus respuestas.
					</p>
					{#if totalEnvios > 0}
						<a class="btn-secondary acc" href={`/dashboard/formularios/envios?formId=${formId}`}>
							Buscar y filtrar
						</a>
					{/if}
				</div>

				{#if cargandoEnvios}
					<p class="vacio" aria-busy="true">Cargando registros…</p>
				{:else if envios.length === 0}
					<p class="vacio">
						Todavía no hay envíos de este formato. Aparecerán aquí en cuanto un conductor entregue
						uno.
					</p>
				{:else}
					<!-- En escritorio, filas alineadas dentro de una tarjeta: son registros
					     que se comparan entre sí y la rejilla deja leer la fecha o la placa
					     en vertical. En una columna estrecha cada registro pasa a ser su
					     propia tarjeta. La fila entera es el enlace al envío. -->
					<div class="registros-zona">
						<ul class="registros">
							<li class="registros__cab" aria-hidden="true">
								<span>Fecha</span>
								<span>Diligenciado por</span>
								<span>Placa</span>
								<span>Versión</span>
								<span class="num">Respuestas</span>
								<span>Estado</span>
							</li>
							{#each envios as envio (envio.id)}
								{@const cuando = envio.submittedAt ?? envio.startedAt}
								<li>
									<a class="registro" href={`/dashboard/formularios/envios/${envio.id}`}>
										<span class="r-fecha">
											<span class="r-dia">{dia(cuando)}</span>
											{#if cuando}<span class="r-hora">{hora(cuando)}</span>{/if}
										</span>
										<span class="r-persona">
											<span class="r-nombre">
												{envio.actor?.nombre ?? envio.conductor?.nombre ?? '—'}
											</span>
											{#if envio.conductor?.numeroIdentificacion}
												<span class="r-doc">CC {envio.conductor.numeroIdentificacion}</span>
											{/if}
										</span>
										<span class="r-meta">
											<span class="r-placa" class:r-sin={!envio.vehiculo?.placa}>
												{envio.vehiculo?.placa ?? '—'}
											</span>
											<span class="r-version">v{envio.version?.versionNumber ?? '—'}</span>
											<span class="r-resp" class:r-sin={envio.answerCount == null}>
												{envio.answerCount ?? '—'}<span class="r-resp-txt">
													{envio.answerCount === 1 ? 'respuesta' : 'respuestas'}</span
												>
											</span>
										</span>
										<span class="r-estado">
											<span class="chip chip--{envio.status.toLowerCase()}">
												{SUBMISSION_STATUS_LABELS[envio.status]}
											</span>
											{#if envio.status === 'DRAFT' && envio.etapasCerradas?.length}
												<span class="chip chip--etapa" title="Etapas cerradas en el teléfono">
													{envio.etapasCerradas.length === 1
														? `Etapa ${envio.etapasCerradas[0]} cerrada`
														: `Etapas ${envio.etapasCerradas.join(', ')} cerradas`}
												</span>
											{/if}
										</span>
									</a>
								</li>
							{/each}
						</ul>
					</div>
					<PaginadorLista
						pagina={paginaEnvios}
						total={totalEnvios}
						porPagina={POR_PAGINA_ENVIOS}
						cargando={cargandoEnvios}
						nombreItems="registros"
						suelto
						onCambiar={irPaginaEnvios}
					/>
				{/if}
			</section>
		{:else if vista === 'versiones'}
			<section class="bloque">
				<div class="intro">
					<p class="intro__texto">
						Cada publicación es una versión fija: para cambiar una publicada se clona en un
						borrador.
					</p>
				</div>
				<ul class="tarjetas">
					{#each versiones as v (v.id)}
						{@const vigente = form.activeVersion?.id === v.id}
						<li class="tarjeta">
							<div class="tarjeta__cuerpo">
								<div class="tarjeta__chips">
									<span class="ver-num">v{v.versionNumber}</span>
									<span class="chip chip--{v.status.toLowerCase()}">
										{VERSION_STATUS_LABELS[v.status]}
									</span>
									{#if vigente}<span class="chip chip--neutro">Vigente</span>{/if}
								</div>
								<p class="tarjeta__titulo">{v.title}</p>
								<p class="tarjeta__meta">
									<span class="nw">Revisión {v.revision}</span> ·
									<span class="nw">creada {fecha(v.createdAt)}</span>
									{#if v.publishedAt}· <span class="nw">publicada {fecha(v.publishedAt)}</span>{/if}
									{#if v.archivedAt}· <span class="nw">archivada {fecha(v.archivedAt)}</span>{/if}
								</p>
							</div>
							<div class="acciones">
								{#if v.status === 'PUBLISHED'}
									<button
										type="button"
										class="acc"
										class:btn-primary={vigente}
										class:btn-secondary={!vigente}
										disabled={trabajando}
										onclick={() => (editorAsignacion = { versionId: v.id })}
									>
										Asignar
									</button>
								{/if}
								<a
									class="acc"
									class:btn-primary={v.status === 'DRAFT'}
									class:btn-secondary={v.status !== 'DRAFT'}
									href={`/dashboard/formularios/${formId}/editar/${v.id}`}
								>
									{v.status === 'DRAFT' ? 'Editar' : 'Ver estructura'}
								</a>
								<a
									class="btn-secondary acc"
									href={`/dashboard/formularios/${formId}/preview/${v.id}`}
								>
									Vista previa
								</a>
								{#if v.status === 'PUBLISHED'}
									<button
										type="button"
										class="btn-secondary acc"
										disabled={trabajando}
										onclick={() => clonar(v.id, v.versionNumber)}
									>
										Clonar
									</button>
									<button
										type="button"
										class="btn-secondary acc acc--peligro"
										disabled={trabajando}
										onclick={() => archivarVersion(v.id, v.versionNumber)}
									>
										Archivar
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
				{#if publicadas.length === 0}
					<p class="nota">
						Ninguna versión publicada todavía: los conductores no ven este formulario.
					</p>
				{/if}
			</section>
		{:else}
			<section class="bloque">
				<div class="intro">
					<p class="intro__texto">A quién le llega cada versión publicada y con qué frecuencia.</p>
					{#if form.activeVersion}
						<button
							type="button"
							class="btn-primary acc intro__accion"
							onclick={() => (editorAsignacion = { versionId: form!.activeVersion!.id })}
						>
							+ Nueva asignación
						</button>
					{/if}
				</div>

				{#if asignaciones.length === 0}
					<p class="nota">
						Sin asignaciones. Un formulario publicado sin asignar no le aparece a nadie.
					</p>
				{:else}
					<ul class="tarjetas">
						{#each asignaciones as a (a.id)}
							<li class="tarjeta">
								<div class="tarjeta__cuerpo">
									<div class="tarjeta__chips">
										<span class="chip chip--{a.status.toLowerCase()}">
											{ASSIGNMENT_STATUS_LABELS[a.status]}
										</span>
										<span class="chip chip--neutro">{FREQUENCY_LABELS[a.frequency]}</span>
									</div>
									<p class="tarjeta__titulo">{a.name}</p>
									<p class="tarjeta__meta">
										<span class="nw">Versión v{a.version?.versionNumber}</span> ·
										<span class="nw">{LIMIT_POLICY_LABELS[a.limitPolicy]}</span> ·
										<span class="nw">{plural(a.targets.length, 'target', 'targets')}</span>
										{#if a.submissionCount != null}
											· <span class="nw">{plural(a.submissionCount, 'envío', 'envíos')}</span>
										{/if}
									</p>
									<p class="tarjeta__meta">
										<span class="nw">
											{a.startsAt ? `Desde ${fecha(a.startsAt)}` : 'Sin fecha de inicio'}
										</span>
										·
										<span class="nw"
											>{a.endsAt ? `hasta ${fecha(a.endsAt)}` : 'sin fecha de fin'}</span
										>
									</p>
								</div>
								<div class="acciones">
									<button
										type="button"
										class="btn-secondary acc"
										disabled={trabajando || a.status === 'CLOSED'}
										onclick={() => (editorAsignacion = { versionId: a.versionId, existing: a })}
									>
										Editar
									</button>
									{#if a.status === 'ACTIVE'}
										<button
											type="button"
											class="btn-secondary acc"
											disabled={trabajando}
											onclick={() => cambiarEstadoAsignacion(a, 'pausar')}
										>
											Pausar
										</button>
									{:else if a.status === 'PAUSED'}
										<button
											type="button"
											class="btn-secondary acc"
											disabled={trabajando}
											onclick={() => cambiarEstadoAsignacion(a, 'reactivar')}
										>
											Reactivar
										</button>
									{/if}
									{#if a.status !== 'CLOSED'}
										<button
											type="button"
											class="btn-secondary acc acc--peligro"
											disabled={trabajando}
											onclick={() => cambiarEstadoAsignacion(a, 'cerrar')}
										>
											Cerrar
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{/if}
</div>

{#if editorAsignacion}
	<!-- `{#key}` fuerza el remount: el editor siembra sus campos UNA vez desde
	     `existing`, así que reusar la instancia al cambiar de asignación mostraría
	     los datos de la anterior. -->
	{#key editorAsignacion.existing?.id ?? editorAsignacion.versionId}
		<AssignmentEditor
			versionId={editorAsignacion.versionId}
			existing={editorAsignacion.existing}
			onclose={() => (editorAsignacion = null)}
			onsaved={async () => {
				editorAsignacion = null;
				await cargar();
			}}
		/>
	{/key}
{/if}

{#if form}
	<ModalDuplicarFormulario
		open={duplicando}
		{form}
		oncerrar={() => (duplicando = false)}
		onduplicado={alDuplicar}
	/>
{/if}

<style>
	/* Lenguaje de la app móvil: fondo claro de la marca, tarjetas blancas con
	   sombra suave, títulos oscuros y gruesos, metadatos grises y chips de
	   estado en tinte suave. Los colores de marca solo por variables del tema,
	   para que cada empresa pinte su paleta. */
	.pagina {
		display: flex;
		flex-direction: column;
		gap: 1.125rem;
		min-height: 100%;
		padding: 1.25rem 1.25rem 3rem;
		background: var(--bg-base);
		font-variant-numeric: tabular-nums;
	}

	.migas {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.migas a {
		font-weight: 700;
		color: var(--accion);
		text-decoration: none;
	}

	.migas a:hover {
		text-decoration: underline;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.875rem;
		margin-top: -0.5rem;
	}

	.head__texto {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		min-width: 0;
		max-width: 48rem;
	}

	.head__code {
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 800;
		color: var(--color-emerald-900);
		background: var(--color-emerald-100);
		border-radius: 999px;
	}

	.head__titulo {
		margin: 0;
		font-family: var(--font-display, inherit);
		font-size: 1.5rem;
		font-weight: 800;
		line-height: 1.2;
		color: var(--text-primary);
	}

	.head__desc {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-secondary);
	}

	.head__meta {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.head__acciones {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.nw {
		white-space: nowrap;
	}

	.tabs {
		min-width: 0;
	}

	.bloque {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		min-width: 0;
		margin-top: -0.25rem;
	}

	.intro {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.intro__texto {
		flex: 1 1 18rem;
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.vacio,
	.nota {
		margin: 0;
		padding: 1.25rem 1rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		text-align: center;
		color: var(--text-muted);
		background: var(--bg-surface);
		border-radius: 18px;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}

	/* ─── Botones compactos ───────────────────────────────────────────────── */
	.acc {
		min-height: 36px;
		padding: 0 0.875rem;
		border-radius: 12px;
		font-size: 0.8125rem;
		white-space: nowrap;
	}
	.btn-secondary.acc {
		border-width: 1px;
	}

	/* Destructiva pero secundaria: misma forma que sus vecinas, en rojo, para
	   que no se confunda con «Clonar» ni compita con la principal. */
	.acc--peligro {
		color: #b42318;
		border-color: #f4c7c3;
	}
	.acc--peligro:hover:not(:disabled) {
		color: #912018;
		background: #fef3f2;
		border-color: #eba59e;
	}

	.cab-accion {
		white-space: nowrap;
	}

	/* ─── Chips de estado ─────────────────────────────────────────────────── */
	.chip {
		display: inline-flex;
		align-items: center;
		padding: 0.1875rem 0.625rem;
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1.4;
		border-radius: 999px;
		white-space: nowrap;
	}

	.chip--published,
	.chip--active,
	.chip--submitted {
		background: var(--color-emerald-100);
		color: var(--color-emerald-900);
	}

	.chip--etapa {
		margin-left: 0.25rem;
		background: #eef6ff;
		color: #1e40af;
	}

	.chip--draft {
		background: #fef3c7;
		color: #92400e;
	}

	.chip--paused {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.chip--archived,
	.chip--closed {
		background: #f3f4f6;
		color: #374151;
	}

	.chip--voided {
		background: #fee2e2;
		color: #991b1b;
	}

	.chip--neutro {
		background: var(--bg-base);
		color: var(--text-secondary);
		box-shadow: inset 0 0 0 1px var(--border-default);
	}

	/* ─── Registros ───────────────────────────────────────────────────────────
	   Base: una tarjeta por registro (columna estrecha). Desde 46rem de
	   contenedor: filas de una sola tarjeta con cabecera, como una tabla. */
	.registros-zona {
		container-type: inline-size;
	}

	.registros {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.registros__cab {
		display: none;
	}

	.registro {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'persona estado'
			'fecha fecha'
			'meta meta';
		align-items: start;
		gap: 0.3125rem 0.75rem;
		padding: 0.875rem 1rem;
		color: inherit;
		text-decoration: none;
		background: var(--bg-surface);
		border-radius: 16px;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
		transition: background 0.15s;
	}

	.registro:hover {
		background: color-mix(in srgb, var(--color-emerald-50) 55%, var(--bg-surface));
	}

	.registro:focus-visible {
		outline: 2px solid var(--accion);
		outline-offset: 2px;
	}

	.r-persona {
		grid-area: persona;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.r-nombre {
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.9375rem;
		font-weight: 800;
		line-height: 1.3;
		color: var(--text-primary);
	}

	.r-doc {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.r-fecha {
		grid-area: fecha;
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.375rem;
		font-size: 0.8125rem;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.r-hora::before {
		content: '·';
		margin-right: 0.375rem;
	}

	.r-meta {
		grid-area: meta;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}

	.r-placa,
	.r-version,
	.r-resp {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-secondary);
		background: var(--bg-base);
		border-radius: 8px;
		white-space: nowrap;
	}

	.r-resp {
		font-weight: 600;
		color: var(--text-muted);
	}

	.r-sin {
		display: none;
	}

	.r-estado {
		grid-area: estado;
	}

	@container (min-width: 46rem) {
		.registros {
			--cols: 7.5rem minmax(12rem, 1fr) 6rem 4.5rem 6.5rem 7rem;
			gap: 0;
			overflow: hidden;
			background: var(--bg-surface);
			border-radius: 18px;
			box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
		}

		.registros__cab,
		.registro {
			display: grid;
			grid-template-columns: var(--cols);
			grid-template-areas: none;
			align-items: center;
			gap: 1rem;
			padding: 0.75rem 1.25rem;
		}

		.registros__cab {
			padding-block: 0.6875rem;
			font-size: 0.6875rem;
			font-weight: 700;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--text-muted);
			background: var(--bg-surface);
		}

		.registros li + li .registro {
			border-top: 1px solid var(--border-subtle);
		}

		.registro {
			border-radius: 0;
			box-shadow: none;
		}

		.registro:hover {
			background: var(--bg-base);
		}

		.registro:focus-visible {
			outline-offset: -2px;
		}

		.r-persona,
		.r-fecha,
		.r-estado {
			grid-area: auto;
		}

		.r-fecha {
			flex-direction: column;
			font-size: 0.8125rem;
			line-height: 1.35;
		}

		.r-dia {
			font-weight: 700;
			color: var(--text-primary);
		}

		.r-hora {
			font-size: 0.75rem;
		}

		.r-hora::before {
			content: none;
		}

		.r-nombre {
			font-size: 0.875rem;
			white-space: nowrap;
		}

		.r-meta {
			display: contents;
		}

		.r-placa,
		.r-resp {
			padding: 0;
			font-size: 0.8125rem;
			background: none;
		}

		.r-placa {
			color: var(--text-primary);
		}

		.r-sin {
			display: inline-flex;
			color: var(--text-very-muted);
		}

		.r-resp {
			justify-content: flex-end;
			color: var(--text-secondary);
		}

		.r-resp-txt {
			display: none;
		}

		.r-version {
			justify-self: start;
		}

		.num {
			text-align: right;
		}
	}

	/* ─── Tarjetas de versiones y asignaciones ────────────────────────────── */
	.tarjetas {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tarjeta {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.875rem;
		padding: 1rem;
		background: var(--bg-surface);
		border-radius: 18px;
		box-shadow: 0 6px 14px rgba(1, 67, 57, 0.065);
	}

	.tarjeta__cuerpo {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.tarjeta__chips {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-bottom: 0.25rem;
	}

	.ver-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.125rem;
		height: 1.625rem;
		padding: 0 0.5rem;
		font-size: 0.8125rem;
		font-weight: 800;
		color: #fff;
		background: var(--bg-charcoal-deep);
		border-radius: 8px;
	}

	.tarjeta__titulo {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 800;
		line-height: 1.35;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}

	.tarjeta__meta {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-muted);
	}

	/* Acciones en columna estrecha: rejilla de dos, todas del mismo ancho, y
	   la última sola ocupa la fila entera en vez de quedar huérfana. */
	.acciones {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		padding-top: 0.875rem;
		border-top: 1px solid var(--border-subtle);
	}

	.acciones > :last-child:nth-child(odd) {
		grid-column: 1 / -1;
	}

	@container (min-width: 46rem) {
		.tarjeta {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			gap: 1.25rem;
			padding: 1rem 1.25rem;
		}

		.acciones {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			max-width: 40rem;
			padding-top: 0;
			border-top: 0;
		}

		.acciones > :last-child:nth-child(odd) {
			grid-column: auto;
		}
	}

	/* ─── Estados de página y móvil ───────────────────────────────────────── */
	.estado {
		padding: 2.5rem 1rem;
		text-align: center;
		color: var(--text-muted);
	}

	.estado--error {
		color: #b42318;
	}

	@media (max-width: 640px) {
		.pagina {
			padding: 1rem 1rem 2.5rem;
		}

		.head__acciones {
			width: 100%;
		}

		.cab-accion {
			flex: 1 1 auto;
		}

		.intro__accion {
			flex: 1 1 100%;
		}
	}
</style>
