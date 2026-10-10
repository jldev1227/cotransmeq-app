<script lang="ts">
	/**
	 * Importa un ZIP de certificados de un año y sincroniza el bucket.
	 *
	 * El resumen se queda en el modal (subidos, omitidos y los archivos que
	 * fallaron con su motivo): un toast con «38/40 subidos» no dice cuáles
	 * son los dos que hay que revisar.
	 */
	import { FileArchive, Upload } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import { certificadosAdminAPI, type ImportZipResumen } from '$lib/api/certificadosAdmin';
	import { aniosImportables, mensajeError } from './certificados';

	interface Props {
		open: boolean;
		oncerrar: () => void;
		onimportado: () => void;
	}

	let { open, oncerrar, onimportado }: Props = $props();

	const ANIOS = aniosImportables();
	/// En enero se suben los del año que acaba de cerrar.
	let anio = $state(new Date().getFullYear() - 1);
	let archivo = $state<File | null>(null);
	let arrastrando = $state(false);
	let importando = $state(false);
	let resumen = $state<ImportZipResumen | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (!open) return;
		archivo = null;
		resumen = null;
	});

	function elegir(f: File | null | undefined) {
		if (!f) return;
		if (!f.name.toLowerCase().endsWith('.zip')) {
			toast.error('Solo se aceptan archivos .zip');
			return;
		}
		archivo = f;
	}

	async function importar() {
		if (!archivo) return;
		importando = true;
		try {
			const res = await certificadosAdminAPI.importZip(archivo, anio);
			resumen = res.data.resumen;
			/// Vincula los recién subidos con su tercero por NIT.
			await certificadosAdminAPI.syncS3().catch(() => {});
			onimportado();
		} catch (err) {
			toast.error('No se pudo importar', { description: mensajeError(err, 'Error al importar') });
		} finally {
			importando = false;
		}
	}
</script>

<ModalBase
	{open}
	title="Importar certificados"
	eyebrow="ZIP por año"
	subtitle="Cada PDF se asigna al tercero por el NIT al final de su nombre."
	tamano="md"
	bloqueado={importando}
	cerrarAlFondo={!importando}
	{oncerrar}
>
	{#if resumen}
		<div class="iz-resultado">
			<div class="iz-cifra iz-cifra--ok"><strong>{resumen.exitosos}</strong><span>subidos</span></div>
			<div class="iz-cifra"><strong>{resumen.omitidos}</strong><span>omitidos</span></div>
			<div class="iz-cifra" class:iz-cifra--error={resumen.fallidos > 0}>
				<strong>{resumen.fallidos}</strong><span>con error</span>
			</div>
		</div>
		<p class="iz-nota">{resumen.total} archivos en el ZIP · año {resumen.anio}</p>
		{#if resumen.errores.length}
			<ul class="iz-errores">
				{#each resumen.errores as e, i (i)}
					<li><strong>{e.archivo}</strong><span>{e.motivo}</span></li>
				{/each}
			</ul>
		{/if}
	{:else}
		<div class="iz">
			<label class="iz-campo">
				<span>Año de los certificados</span>
				<select class="iz-input" bind:value={anio} disabled={importando}>
					{#each ANIOS as a (a)}<option value={a}>{a}</option>{/each}
				</select>
			</label>

			<button
				type="button"
				class="iz-zona"
				class:iz-zona--activa={arrastrando}
				class:iz-zona--lista={!!archivo}
				disabled={importando}
				onclick={() => input?.click()}
				ondragover={(e) => {
					e.preventDefault();
					arrastrando = true;
				}}
				ondragleave={() => (arrastrando = false)}
				ondrop={(e) => {
					e.preventDefault();
					arrastrando = false;
					elegir(e.dataTransfer?.files?.[0]);
				}}
			>
				<span class="iz-zona-icono"><FileArchive size={26} /></span>
				{#if archivo}
					<strong>{archivo.name}</strong>
					<small>{(archivo.size / 1024 / 1024).toFixed(1)} MB · clic para cambiarlo</small>
				{:else}
					<strong>Arrastra el ZIP aquí</strong>
					<small>o haz clic para elegirlo</small>
				{/if}
			</button>
			<input
				bind:this={input}
				type="file"
				accept=".zip"
				class="iz-oculto"
				onchange={(e) => elegir((e.currentTarget as HTMLInputElement).files?.[0])}
			/>
			<p class="iz-nota">
				Organiza el ZIP en carpetas por tipo y termina cada nombre con el NIT, por ejemplo
				<code>RETEFUENTE/Certificado 900123456.pdf</code>. Sin carpeta, el tipo se deduce del nombre.
				Los archivos sin NIT al final se omiten.
			</p>
		</div>
	{/if}

	{#snippet pie()}
		{#if resumen}
			<button type="button" class="btn-secondary" onclick={() => (resumen = null)}>Importar otro</button>
			<button type="button" class="btn-primary" onclick={oncerrar}>Listo</button>
		{:else}
			<button type="button" class="btn-secondary" onclick={oncerrar} disabled={importando}
				>Cancelar</button
			>
			<button type="button" class="btn-primary" onclick={importar} disabled={!archivo || importando}>
				<Upload size={15} />
				{importando ? 'Importando…' : `Importar a ${anio}`}
			</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.iz {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.iz-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 12rem;
	}
	.iz-campo span {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.iz-input {
		padding: 0.5rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
	}
	.iz-zona {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 2rem 1rem;
		border: 2px dashed var(--border-default);
		border-radius: 16px;
		background: var(--bg-surface);
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background 0.15s ease;
	}
	.iz-zona:hover,
	.iz-zona--activa {
		border-color: var(--emerald-500);
		background: color-mix(in srgb, var(--emerald-500) 6%, var(--bg-surface));
	}
	.iz-zona--lista {
		border-style: solid;
		border-color: var(--emerald-500);
	}
	.iz-zona strong {
		font-size: 0.92rem;
		color: var(--text-primary);
	}
	.iz-zona small {
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.iz-zona-icono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 52px;
		height: 52px;
		border-radius: 16px;
		background: var(--bg-base);
		color: var(--emerald-600);
	}
	.iz-oculto {
		display: none;
	}
	.iz-nota {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.iz-nota code {
		font-size: 0.78rem;
	}
	.iz-resultado {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		margin-bottom: 12px;
	}
	.iz-cifra {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 16px 8px;
		border-radius: 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.iz-cifra strong {
		font-family: var(--font-display);
		font-size: 1.8rem;
		font-weight: 800;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.iz-cifra span {
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.iz-cifra--ok strong {
		color: var(--emerald-600);
	}
	.iz-cifra--error strong {
		color: #b91c1c;
	}
	.iz-errores {
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 14rem;
		overflow-y: auto;
	}
	.iz-errores li {
		display: flex;
		flex-direction: column;
		padding: 8px 10px;
		border-radius: 10px;
		background: #fef2f2;
		font-size: 0.8rem;
	}
	.iz-errores strong {
		color: #991b1b;
	}
	.iz-errores span {
		color: #7f1d1d;
	}
</style>
