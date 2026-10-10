<script lang="ts">
	/**
	 * Visor de los certificados de un tercero: índice por año a la izquierda y
	 * el documento a la derecha, en un modal casi a pantalla completa.
	 *
	 * Antes el detalle reemplazaba la tabla dentro de la misma página y el
	 * visor quedaba en el alto que le sobraba al layout. Como modal tiene el
	 * alto de la ventana y al cerrarlo el listado sigue donde estaba (filtros,
	 * página y scroll), que es lo que se necesita al revisar varios terceros
	 * seguidos.
	 */
	import { Download, ExternalLink, FileText, Mail } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { certificadosTerceroAPI, type TerceroWithCerts } from '$lib/api/certificadosTercero';
	import {
		agruparPorAnio,
		esImagen,
		etiquetaTipo,
		mensajeError,
		tipoDe,
		type Certificado
	} from './certificados';

	interface Props {
		open: boolean;
		tercero: TerceroWithCerts | null;
		oncerrar: () => void;
		onenviar: (tercero: TerceroWithCerts) => void;
	}

	let { open, tercero, oncerrar, onenviar }: Props = $props();

	let certs = $state<Certificado[]>([]);
	let cargando = $state(false);
	let error = $state<string | null>(null);
	/// Copia del elemento y no un índice: la lista se reemplaza al recargar y
	/// un índice apuntaría a otro documento sin que nada avisara.
	let actual = $state<Certificado | null>(null);

	/// Las URL las firma S3 por una hora: se piden al abrir, no se reciclan las
	/// del listado (que ni siquiera las trae).
	$effect(() => {
		const t = tercero;
		if (!open || !t) return;
		void cargar(t.id);
	});

	async function cargar(id: string) {
		cargando = true;
		error = null;
		actual = null;
		try {
			const res = await certificadosTerceroAPI.getCertificadosByTercero(id);
			certs = res.data.certificados ?? [];
			/// Se abre el más reciente: entrar y encontrar el panel vacío obliga a
			/// un clic que no aporta nada.
			actual = agruparPorAnio(certs)[0]?.[1][0] ?? null;
		} catch (err) {
			certs = [];
			error = mensajeError(err, 'No se pudieron cargar los certificados');
		} finally {
			cargando = false;
		}
	}

	const grupos = $derived(agruparPorAnio(certs));
</script>

<ModalBase
	{open}
	title={tercero?.nombre_completo ?? 'Certificados'}
	eyebrow="Certificados tributarios"
	subtitle={tercero
		? `NIT ${tercero.identificacion ?? '—'} · ${tercero.correo ?? 'sin correo registrado'}`
		: null}
	tamano="full"
	sinRelleno
	{oncerrar}
>
	{#snippet accionesCabecera()}
		{#if certs.length}
			<span class="vc-cuenta">{certs.length} {certs.length === 1 ? 'archivo' : 'archivos'}</span>
		{/if}
	{/snippet}

	{#if cargando}
		<div class="vc-centro"><CargaMascota texto="Cargando certificados…" /></div>
	{:else if error}
		<div class="vc-centro vc-mensaje">
			<p class="vc-mensaje-titulo">No se pudieron cargar</p>
			<p>{error}</p>
			{#if tercero}
				<button type="button" class="btn-secondary" onclick={() => tercero && cargar(tercero.id)}
					>Reintentar</button
				>
			{/if}
		</div>
	{:else if certs.length === 0}
		<div class="vc-centro vc-mensaje">
			<p class="vc-mensaje-titulo">Sin certificados</p>
			<p>Este tercero no tiene certificados cargados.</p>
		</div>
	{:else}
		<div class="vc">
			<nav class="vc-indice" aria-label="Certificados por año">
				{#each grupos as [anio, lista] (anio)}
					<section class="vc-grupo">
						<h3 class="vc-anio">{anio}</h3>
						{#each lista as c (c.id)}
							{@const activo = actual?.id === c.id}
							<button
								type="button"
								class="vc-item"
								class:vc-item--activo={activo}
								aria-current={activo ? 'true' : undefined}
								onclick={() => (actual = c)}
							>
								<span class="vc-item-icono" aria-hidden="true"><FileText size={15} /></span>
								<span class="vc-item-texto">
									<strong>{etiquetaTipo(tipoDe(c))}</strong>
									<small>{c.filename}</small>
								</span>
							</button>
						{/each}
					</section>
				{/each}
			</nav>

			<div class="vc-doc">
				{#if actual?.url}
					{#if esImagen(actual.filename)}
						<div class="vc-imagen">
							<img src={actual.url} alt={`Certificado ${actual.filename}`} />
						</div>
					{:else}
						<!-- `key` recrea el iframe: reutilizarlo dejaba el PDF anterior
						     a la vista mientras cargaba el siguiente. -->
						{#key actual.id}
							<iframe src={actual.url} title={`Certificado ${actual.filename}`}></iframe>
						{/key}
					{/if}
				{:else if actual}
					<div class="vc-centro vc-mensaje">
						<p class="vc-mensaje-titulo">No se pudo abrir el archivo</p>
						<p>El enlace firmado no está disponible. Cierra y vuelve a abrir para pedir uno nuevo.</p>
					</div>
				{:else}
					<div class="vc-centro vc-mensaje"><p>Elige un certificado para verlo aquí.</p></div>
				{/if}
			</div>
		</div>
	{/if}

	{#snippet pie()}
		{#if actual?.url}
			<a class="btn-secondary" href={actual.url} target="_blank" rel="noopener noreferrer">
				<ExternalLink size={15} /> Abrir en pestaña
			</a>
			<a class="btn-secondary" href={actual.url} download={actual.filename}>
				<Download size={15} /> Descargar
			</a>
		{/if}
		{#if tercero}
			<button
				type="button"
				class="btn-primary"
				onclick={() => tercero && onenviar(tercero)}
				disabled={!tercero.correo}
				title={tercero.correo ? undefined : 'El tercero no tiene correo registrado'}
			>
				<Mail size={15} /> Enviar por correo
			</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.vc {
		display: grid;
		grid-template-columns: 17rem minmax(0, 1fr);
		height: 100%;
		min-height: 0;
	}
	@media (max-width: 768px) {
		.vc {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(24rem, 1fr);
		}
	}
	.vc-indice {
		overflow-y: auto;
		padding: 14px 12px;
		border-right: 1px solid var(--border-subtle);
		background: var(--bg-surface);
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	@media (max-width: 768px) {
		.vc-indice {
			max-height: 14rem;
			border-right: 0;
			border-bottom: 1px solid var(--border-subtle);
		}
	}
	.vc-grupo {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.vc-anio {
		margin: 0 0 2px 6px;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}
	.vc-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border: 1px solid transparent;
		border-radius: 12px;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.vc-item:hover {
		background: var(--bg-base);
	}
	.vc-item--activo {
		background: color-mix(in srgb, var(--emerald-500) 9%, var(--bg-surface));
		border-color: color-mix(in srgb, var(--emerald-500) 35%, transparent);
	}
	.vc-item-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		border-radius: 9px;
		background: var(--bg-base);
		color: var(--text-secondary);
	}
	.vc-item--activo .vc-item-icono {
		background: var(--emerald-600);
		color: #fff;
	}
	.vc-item-texto {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.vc-item-texto strong {
		font-size: 0.85rem;
		color: var(--text-primary);
	}
	.vc-item-texto small {
		font-size: 0.72rem;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.vc-doc {
		display: flex;
		min-height: 0;
		background: var(--bg-base);
	}
	.vc-doc iframe {
		flex: 1;
		width: 100%;
		border: 0;
	}
	.vc-imagen {
		flex: 1;
		overflow: auto;
		padding: 16px;
	}
	.vc-imagen img {
		display: block;
		margin: 0 auto;
		max-width: 100%;
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
	}
	.vc-centro {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 2rem;
	}
	.vc-mensaje {
		gap: 6px;
		text-align: center;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.vc-mensaje p {
		margin: 0;
	}
	.vc-mensaje-titulo {
		font-weight: 800;
		color: var(--text-primary);
	}
	.vc-cuenta {
		padding: 4px 10px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.16);
		color: #fff;
		font-size: 0.75rem;
		font-weight: 700;
		white-space: nowrap;
	}
</style>
