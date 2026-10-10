<script lang="ts">
	/**
	 * Envío de certificados por correo, a un tercero o a todos los filtrados.
	 *
	 * Individual: se eligen los archivos (agrupados por año) y el destino, que
	 * arranca con el correo registrado pero se puede cambiar.
	 *
	 * Masivo: no recibe ids. Manda los filtros de la pantalla y el servidor
	 * resuelve a quién enviar, así llega a TODOS los que coinciden y no solo a
	 * la página visible —que era el fallo anterior: «enviar a todos» le llegaba
	 * a diez—. Tras enviar, el modal muestra cuántos salieron, cuántos se
	 * saltaron y por qué, en vez de un toast que desaparece.
	 */
	import { Mail, Send } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import {
		certificadosTerceroAPI,
		type FiltrosCertificados,
		type ResultadoEnvioMasivo,
		type TerceroWithCerts
	} from '$lib/api/certificadosTercero';
	import { agruparPorAnio, etiquetaTipo, mensajeError, tipoDe } from './certificados';

	type Modo =
		| { tipo: 'individual'; tercero: TerceroWithCerts }
		| { tipo: 'masivo'; filtros: FiltrosCertificados; destinatarios: number; descripcion: string };

	interface Props {
		open: boolean;
		modo: Modo | null;
		oncerrar: () => void;
		/** Tras un envío correcto, para refrescar «Último envío». */
		onenviado: () => void;
	}

	let { open, modo, oncerrar, onenviado }: Props = $props();

	let correo = $state('');
	let mensaje = $state('');
	let seleccion = $state<Set<string>>(new Set());
	let enviando = $state(false);
	let resultado = $state<{ enviados: number; saltados: number; errores: number; sinCorreo: number } | null>(
		null
	);

	/// Se reinicia cada vez que se abre: un mensaje escrito para un tercero no
	/// debe aparecer en el envío del siguiente.
	$effect(() => {
		if (!open || !modo) return;
		mensaje = '';
		resultado = null;
		if (modo.tipo === 'individual') {
			correo = modo.tercero.correo ?? '';
			seleccion = new Set(modo.tercero.certificados_archivo.map((c) => c.id));
		}
	});

	const grupos = $derived(
		modo?.tipo === 'individual' ? agruparPorAnio(modo.tercero.certificados_archivo) : []
	);
	const correoValido = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim()));
	const puedeEnviar = $derived(
		!enviando &&
			!!modo &&
			(modo.tipo === 'masivo'
				? modo.destinatarios > 0
				: correoValido && seleccion.size > 0)
	);

	function alternar(id: string) {
		const s = new Set(seleccion);
		s.has(id) ? s.delete(id) : s.add(id);
		seleccion = s;
	}
	function alternarAnio(ids: string[]) {
		const todos = ids.every((id) => seleccion.has(id));
		const s = new Set(seleccion);
		for (const id of ids) todos ? s.delete(id) : s.add(id);
		seleccion = s;
	}

	async function enviar() {
		if (!modo || !puedeEnviar) return;
		enviando = true;
		try {
			if (modo.tipo === 'individual') {
				await certificadosTerceroAPI.enviarEmail({
					tercero_id: modo.tercero.id,
					certificado_ids: [...seleccion],
					email_destino: correo.trim(),
					mensaje_personalizado: mensaje.trim() || undefined
				});
				toast.success('Correo enviado', { description: `A ${correo.trim()}` });
				onenviado();
				oncerrar();
			} else {
				const res = await certificadosTerceroAPI.enviarMasivo({
					filtros: modo.filtros,
					mensaje_personalizado: mensaje.trim() || undefined
				});
				const r: ResultadoEnvioMasivo[] = res.data.resultados ?? [];
				resultado = {
					enviados: r.filter((x) => x.status === 'sent').length,
					saltados: r.filter((x) => x.status === 'skipped').length,
					errores: r.filter((x) => x.status === 'error').length,
					sinCorreo: r.filter((x) => x.reason === 'Sin correo').length
				};
				onenviado();
			}
		} catch (err) {
			toast.error('No se pudo enviar', { description: mensajeError(err, 'Error al enviar') });
		} finally {
			enviando = false;
		}
	}
</script>

<ModalBase
	open={open && !!modo}
	title={modo?.tipo === 'individual' ? 'Enviar certificados' : 'Envío masivo'}
	eyebrow="Correo"
	subtitle={modo?.tipo === 'individual' ? modo.tercero.nombre_completo : (modo?.descripcion ?? null)}
	tamano="md"
	bloqueado={enviando}
	cerrarAlFondo={!enviando}
	{oncerrar}
>
	{#if modo?.tipo === 'masivo'}
		{#if resultado}
			<div class="ec-resultado">
				<div class="ec-cifra ec-cifra--ok">
					<strong>{resultado.enviados}</strong><span>enviados</span>
				</div>
				<div class="ec-cifra">
					<strong>{resultado.saltados}</strong><span>saltados</span>
				</div>
				<div class="ec-cifra" class:ec-cifra--error={resultado.errores > 0}>
					<strong>{resultado.errores}</strong><span>con error</span>
				</div>
			</div>
			{#if resultado.saltados > 0}
				<p class="ec-nota">
					Los saltados no tenían correo registrado o no tenían certificados que coincidieran con los
					filtros.
				</p>
			{/if}
		{:else}
			<div class="ec-aviso">
				<Mail size={18} />
				<p>
					Se enviará un correo con su enlace de acceso a <strong
						>{modo.destinatarios}
						{modo.destinatarios === 1 ? 'tercero' : 'terceros'}</strong
					>
					con correo registrado{modo.descripcion ? `, filtrados por ${modo.descripcion}` : ''}. Los
					que no tienen correo se omiten.
				</p>
			</div>
			<label class="ec-campo">
				<span>Mensaje adicional <small>(opcional)</small></span>
				<textarea
					class="ec-input"
					rows="4"
					bind:value={mensaje}
					placeholder="Se agrega al cuerpo del correo, después del saludo."
				></textarea>
			</label>
		{/if}
	{:else if modo?.tipo === 'individual'}
		<div class="ec">
			<label class="ec-campo">
				<span>Enviar a</span>
				<input
					class="ec-input"
					type="email"
					bind:value={correo}
					placeholder="correo@empresa.com"
					autocomplete="off"
				/>
				{#if correo && !correoValido}<small class="ec-error">Revisa el correo.</small>{/if}
			</label>

			<fieldset class="ec-certs">
				<legend>Certificados <small>{seleccion.size} de {modo.tercero.certificados_archivo.length}</small></legend>
				{#each grupos as [anio, lista] (anio)}
					{@const ids = lista.map((c) => c.id)}
					<div class="ec-grupo">
						<label class="ec-anio">
							<input
								type="checkbox"
								checked={ids.every((id) => seleccion.has(id))}
								indeterminate={ids.some((id) => seleccion.has(id)) &&
									!ids.every((id) => seleccion.has(id))}
								onchange={() => alternarAnio(ids)}
							/>
							{anio}
						</label>
						{#each lista as c (c.id)}
							<label class="ec-cert">
								<input type="checkbox" checked={seleccion.has(c.id)} onchange={() => alternar(c.id)} />
								<span>
									<strong>{etiquetaTipo(tipoDe(c))}</strong>
									<small>{c.filename}</small>
								</span>
							</label>
						{/each}
					</div>
				{/each}
			</fieldset>

			<label class="ec-campo">
				<span>Mensaje adicional <small>(opcional)</small></span>
				<textarea class="ec-input" rows="3" bind:value={mensaje}></textarea>
			</label>
		</div>
	{/if}

	{#snippet pie()}
		{#if resultado}
			<button type="button" class="btn-primary" onclick={oncerrar}>Listo</button>
		{:else}
			<button type="button" class="btn-secondary" onclick={oncerrar} disabled={enviando}
				>Cancelar</button
			>
			<button type="button" class="btn-primary" onclick={enviar} disabled={!puedeEnviar}>
				<Send size={15} />
				{#if enviando}
					Enviando…
				{:else if modo?.tipo === 'masivo'}
					Enviar a {modo.destinatarios}
				{:else}
					Enviar {seleccion.size} {seleccion.size === 1 ? 'certificado' : 'certificados'}
				{/if}
			</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.ec {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.ec-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.ec-campo > span,
	.ec-certs legend {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.ec-campo small,
	.ec-certs legend small {
		font-weight: 500;
		color: var(--text-muted);
	}
	.ec-input {
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		resize: vertical;
	}
	.ec-input:focus {
		outline: none;
		border-color: var(--emerald-500);
	}
	.ec-error {
		color: #b91c1c;
	}
	.ec-certs {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.ec-certs legend {
		margin-bottom: 6px;
	}
	.ec-grupo {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px;
		border-radius: 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.ec-anio,
	.ec-cert {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		border-radius: 8px;
		cursor: pointer;
	}
	.ec-anio {
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}
	.ec-cert:hover {
		background: var(--bg-base);
	}
	.ec-cert span {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.ec-cert strong {
		font-size: 0.85rem;
		color: var(--text-primary);
	}
	.ec-cert small {
		font-size: 0.72rem;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ec-anio input,
	.ec-cert input {
		width: 16px;
		height: 16px;
		accent-color: var(--emerald-500);
	}
	.ec-aviso {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px 14px;
		margin-bottom: 14px;
		border-radius: 12px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		font-size: 0.86rem;
	}
	.ec-aviso p {
		margin: 0;
	}
	.ec-aviso :global(svg) {
		flex-shrink: 0;
		color: var(--emerald-600);
		margin-top: 1px;
	}
	.ec-resultado {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}
	.ec-cifra {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 16px 8px;
		border-radius: 14px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
	}
	.ec-cifra strong {
		font-family: var(--font-display);
		font-size: 1.8rem;
		font-weight: 800;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.ec-cifra span {
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.ec-cifra--ok strong {
		color: var(--emerald-600);
	}
	.ec-cifra--error strong {
		color: #b91c1c;
	}
	.ec-nota {
		margin: 12px 0 0;
		font-size: 0.82rem;
		color: var(--text-muted);
	}
</style>
