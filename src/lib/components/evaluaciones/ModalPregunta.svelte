<script lang="ts">
	/**
	 * Editor de una pregunta: enunciado, tipo, puntos y la clave de
	 * corrección que corresponda al tipo.
	 *
	 * Trabaja sobre una COPIA de la pregunta que recibe y la devuelve entera
	 * en `onGuardar`. Así la página conserva su validación (`guardarPregunta`)
	 * tal cual, y cancelar no deja la pregunta a medio editar. El modal se
	 * monta al abrirse y se destruye al cerrarse, por eso basta con copiar
	 * en el arranque.
	 *
	 * Estructura `.fixed.inset-0.flex.items-center.justify-center >
	 * [role=dialog]`: en móvil el CSS global la convierte en hoja inferior.
	 */
	import { fade, scale } from 'svelte/transition';
	import { TIPOS_PREGUNTA, type EntradaSopa, type TipoPregunta } from './tipos';

	interface OpcionForm {
		id?: string;
		texto: string;
		esCorrecta: boolean;
	}

	interface PreguntaForm {
		id?: string;
		texto: string;
		tipo: TipoPregunta;
		puntaje: number;
		opciones: OpcionForm[];
		relacionIzq: string[];
		relacionDer: string[];
		respuestaCorrecta?: number;
		/** Sopa de letras. Al editar puede traer además la cuadrícula ya generada. */
		configuracion?: (EntradaSopa & { cuadricula?: string[] }) | null;
	}

	interface Props {
		inicial: PreguntaForm;
		/** `true` si se edita una pregunta existente; cambia el título. */
		editando?: boolean;
		/** Posición 0-based de la pregunta, para el eyebrow. */
		numero: number;
		onGuardar: (pregunta: PreguntaForm) => void;
		onCancelar: () => void;
	}

	let { inicial, editando = false, numero, onGuardar, onCancelar }: Props = $props();

	let p = $state<PreguntaForm>(JSON.parse(JSON.stringify(inicial)));

	const conOpciones = $derived(p.tipo === 'OPCION_UNICA' || p.tipo === 'OPCION_MULTIPLE');

	function agregarOpcion() {
		p.opciones = [...p.opciones, { texto: '', esCorrecta: false }];
	}

	function eliminarOpcion(index: number) {
		p.opciones = p.opciones.filter((_, i) => i !== index);
	}

	function agregarParRelacion() {
		p.relacionIzq = [...p.relacionIzq, ''];
		p.relacionDer = [...p.relacionDer, ''];
	}

	function eliminarParRelacion(index: number) {
		p.relacionIzq = p.relacionIzq.filter((_, i) => i !== index);
		p.relacionDer = p.relacionDer.filter((_, i) => i !== index);
	}

	// ── Sopa de letras ──
	// Las palabras se escriben una por línea; se guardan como lista.
	let palabrasTexto = $state(
		Array.isArray(p.configuracion?.palabras)
			? p
					.configuracion!.palabras.map((x: any) => (typeof x === 'string' ? x : (x?.texto ?? '')))
					.join('\n')
			: ''
	);
	$effect(() => {
		if (p.tipo !== 'SOPA_LETRAS') return;
		const palabras = palabrasTexto
			.split(/\r?\n|,/)
			.map((x) => x.trim())
			.filter(Boolean);
		p.configuracion = {
			tamano: p.configuracion?.tamano ?? 12,
			diagonales: p.configuracion?.diagonales ?? false,
			cuadricula: p.configuracion?.cuadricula,
			palabras
		};
	});
	const palabrasSopa = $derived(p.tipo === 'SOPA_LETRAS' ? (p.configuracion?.palabras ?? []) : []);
	const palabraMasLarga = $derived(
		palabrasSopa.reduce((m, x) => Math.max(m, x.replace(/[^\p{L}]/gu, '').length), 0)
	);

	function teclado(e: KeyboardEvent) {
		if (e.key === 'Escape') onCancelar();
	}
</script>

<svelte:window onkeydown={teclado} />

<button
	type="button"
	class="mp-tapa fixed inset-0 z-[100]"
	aria-label="Cerrar"
	onclick={onCancelar}
	transition:fade={{ duration: 150 }}
></button>

<div class="pointer-events-none fixed inset-0 z-[101] flex items-center justify-center p-4">
	<div
		class="mp pointer-events-auto"
		role="dialog"
		aria-modal="true"
		aria-labelledby="mp-titulo"
		in:scale={{ duration: 220, start: 0.96 }}
	>
		<header class="mp-cab">
			<div class="mp-cab-texto">
				<span class="eyebrow">Pregunta {numero + 1}</span>
				<h3 id="mp-titulo" class="mp-titulo">
					{editando ? 'Editar pregunta' : 'Nueva pregunta'}
				</h3>
			</div>
			<button type="button" class="btn-icon" onclick={onCancelar} aria-label="Cerrar">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</header>

		<div class="mp-cuerpo">
			<div class="ev-campo">
				<label for="mp-texto">Enunciado</label>
				<textarea
					id="mp-texto"
					bind:value={p.texto}
					rows="3"
					placeholder="Escribe la pregunta tal y como la leerá el evaluado"
				></textarea>
			</div>

			<fieldset class="mp-tipos">
				<legend>Tipo de pregunta</legend>
				<div class="mp-tipos-lista" role="radiogroup" aria-label="Tipo de pregunta">
					{#each TIPOS_PREGUNTA as t (t.valor)}
						<button
							type="button"
							class="mp-tipo"
							class:mp-tipo--activo={p.tipo === t.valor}
							role="radio"
							aria-checked={p.tipo === t.valor}
							onclick={() => (p.tipo = t.valor)}
						>
							<span class="mp-tipo-nombre">{t.etiqueta}</span>
							<span class="mp-tipo-ayuda">{t.ayuda}</span>
						</button>
					{/each}
				</div>
			</fieldset>

			<div class="ev-campo mp-puntaje">
				<label for="mp-puntaje">Puntaje</label>
				<div class="mp-puntaje-control">
					<input id="mp-puntaje" type="number" min="0" bind:value={p.puntaje} />
					<span>puntos si acierta</span>
				</div>
			</div>

			{#if conOpciones}
				<div class="mp-seccion">
					<div class="mp-seccion-cab">
						<div>
							<h4>Opciones</h4>
							<p>
								{p.tipo === 'OPCION_UNICA'
									? 'Marca la única opción correcta.'
									: 'Marca todas las opciones correctas.'}
							</p>
						</div>
						<button type="button" class="btn-secondary mp-btn-chico" onclick={agregarOpcion}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
							</svg>
							Opción
						</button>
					</div>
					<div class="mp-lista">
						{#each p.opciones as opcion, i}
							<div class="mp-opcion" class:mp-opcion--correcta={opcion.esCorrecta}>
								<label class="mp-check" title="Marcar como correcta">
									<input
										type="checkbox"
										bind:checked={opcion.esCorrecta}
										aria-label="Opción {i + 1} correcta"
									/>
									<span class="mp-check-caja" aria-hidden="true">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
									</span>
								</label>
								<input
									type="text"
									class="mp-opcion-texto"
									bind:value={opcion.texto}
									placeholder="Texto de la opción {i + 1}"
									aria-label="Texto de la opción {i + 1}"
								/>
								<button
									type="button"
									class="mp-quitar"
									onclick={() => eliminarOpcion(i)}
									aria-label="Quitar opción {i + 1}"
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
						{/each}
						{#if p.opciones.length === 0}
							<p class="mp-vacio">Sin opciones. Agrega al menos una.</p>
						{/if}
					</div>
				</div>
			{/if}

			{#if p.tipo === 'NUMERICA'}
				<div class="ev-campo">
					<label for="mp-numerica">Respuesta correcta</label>
					<input
						id="mp-numerica"
						type="number"
						step="any"
						bind:value={p.respuestaCorrecta}
						placeholder="Ej. 42"
					/>
					<small>El evaluado tendrá que escribir este valor exacto.</small>
				</div>
			{/if}

			{#if p.tipo === 'VERDADERO_FALSO'}
				<div class="mp-seccion">
					<div class="mp-seccion-cab">
						<div>
							<h4>Respuesta correcta</h4>
							<p>¿La afirmación del enunciado es verdadera o falsa?</p>
						</div>
					</div>
					<div class="mp-vf" role="radiogroup" aria-label="Respuesta correcta">
						<button
							type="button"
							class="mp-vf-opcion"
							class:mp-vf-opcion--activa={p.respuestaCorrecta === 1}
							role="radio"
							aria-checked={p.respuestaCorrecta === 1}
							onclick={() => (p.respuestaCorrecta = 1)}
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							Verdadero
						</button>
						<button
							type="button"
							class="mp-vf-opcion mp-vf-opcion--falso"
							class:mp-vf-opcion--activa={p.respuestaCorrecta === 0}
							role="radio"
							aria-checked={p.respuestaCorrecta === 0}
							onclick={() => (p.respuestaCorrecta = 0)}
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							Falso
						</button>
					</div>
				</div>
			{/if}

			{#if p.tipo === 'SOPA_LETRAS'}
				<div class="mp-seccion">
					<div class="mp-seccion-cab">
						<div>
							<h4>Palabras escondidas</h4>
							<p>
								Una por línea. El backend arma la cuadrícula al guardar; cada palabra hallada suma
								la parte proporcional del puntaje.
							</p>
						</div>
					</div>
					<div class="ev-campo">
						<label for="mp-sopa-palabras">Palabras</label>
						<textarea
							id="mp-sopa-palabras"
							bind:value={palabrasTexto}
							rows="5"
							placeholder={'CASCO\nGUANTES\nEXTINTOR'}
						></textarea>
						<small>
							{palabrasSopa.length} palabra{palabrasSopa.length === 1 ? '' : 's'}
							{#if palabraMasLarga > 0}· la más larga tiene {palabraMasLarga} letras{/if}
						</small>
					</div>
					<div class="mp-sopa-ajustes">
						<div class="ev-campo">
							<label for="mp-sopa-tamano">Tamaño de la cuadrícula</label>
							<input
								id="mp-sopa-tamano"
								type="number"
								min="6"
								max="20"
								bind:value={p.configuracion!.tamano}
							/>
							<small>Entre 6 y 20; nunca menor que la palabra más larga.</small>
						</div>
						<label class="mp-sopa-check">
							<input type="checkbox" bind:checked={p.configuracion!.diagonales} />
							<span>
								<strong>Diagonales e inversas</strong>
								<small>Sin marcar, solo de izquierda a derecha y de arriba abajo.</small>
							</span>
						</label>
					</div>
				</div>
			{/if}

			{#if p.tipo === 'RELACION'}
				<div class="mp-seccion">
					<div class="mp-seccion-cab">
						<div>
							<h4>Pares de relación</h4>
							<p>Cada fila es un par correcto. Al diligenciar se muestran desordenados.</p>
						</div>
						<button type="button" class="btn-secondary mp-btn-chico" onclick={agregarParRelacion}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
							</svg>
							Par
						</button>
					</div>
					<div class="mp-lista">
						{#each p.relacionIzq as _, i}
							<div class="mp-par">
								<input
									type="text"
									bind:value={p.relacionIzq[i]}
									placeholder="Lado A"
									aria-label="Par {i + 1}, lado A"
								/>
								<svg
									class="mp-par-flecha"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M14 5l7 7m0 0l-7 7m7-7H3"
									/>
								</svg>
								<input
									type="text"
									bind:value={p.relacionDer[i]}
									placeholder="Lado B"
									aria-label="Par {i + 1}, lado B"
								/>
								<button
									type="button"
									class="mp-quitar"
									onclick={() => eliminarParRelacion(i)}
									aria-label="Quitar par {i + 1}"
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
						{/each}
						{#if p.relacionIzq.length === 0}
							<p class="mp-vacio">Sin pares. Agrega al menos uno.</p>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<footer class="mp-pie">
			<button type="button" class="btn-secondary" onclick={onCancelar}>Cancelar</button>
			<button type="button" class="btn-primary" onclick={() => onGuardar(p)}>
				{editando ? 'Guardar cambios' : 'Agregar pregunta'}
			</button>
		</footer>
	</div>
</div>

<style>
	.mp-tapa {
		border: 0;
		padding: 0;
		cursor: default;
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.4), rgba(20, 83, 45, 0.55));
		backdrop-filter: blur(8px) saturate(120%);
		-webkit-backdrop-filter: blur(8px) saturate(120%);
	}
	.mp {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 40rem;
		max-height: 90vh;
		background: #fff;
		border-radius: 22px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
		overflow: hidden;
	}
	.mp-cab {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem 0.9rem;
	}
	.mp-cab-texto {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
	}
	.mp-titulo {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: var(--au-text);
	}
	.mp-cuerpo {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		padding: 0.25rem 1.5rem 1.25rem;
		overflow-y: auto;
		min-height: 0;
	}
	.mp-pie {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.9rem 1.5rem;
		background: var(--bg-base, #fff7ed);
	}

	/* ── Tipo: seis tarjetas-radio ── */
	.mp-tipos {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
	}
	.mp-tipos legend {
		padding: 0;
		margin-bottom: 0.45rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--au-text);
	}
	.mp-tipos-lista {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
		gap: 0.45rem;
	}
	.mp-tipo {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		padding: 0.6rem 0.75rem;
		border: 1.5px solid var(--au-border);
		border-radius: 14px;
		background: #fff;
		text-align: left;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	.mp-tipo:hover {
		border-color: var(--au-primary);
	}
	.mp-tipo--activo {
		border-color: var(--au-primary);
		background: var(--au-tint);
	}
	.mp-tipo-nombre {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--au-text);
	}
	.mp-tipo--activo .mp-tipo-nombre {
		color: var(--au-dark);
	}
	.mp-tipo-ayuda {
		font-size: 0.68rem;
		line-height: 1.35;
		color: var(--au-muted);
	}

	.mp-puntaje-control {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.8rem;
		color: var(--au-muted);
	}
	.mp-puntaje-control input {
		width: 6rem;
	}

	/* ── Secciones por tipo ── */
	.mp-seccion {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.9rem 1rem 1rem;
		border-radius: 16px;
		background: var(--bg-base, #fff7ed);
	}
	.mp-seccion-cab {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.mp-seccion-cab h4 {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--au-text);
	}
	.mp-seccion-cab p {
		margin: 0.1rem 0 0;
		font-size: 0.74rem;
		color: var(--au-muted);
	}
	.mp-btn-chico {
		min-height: 34px;
		padding: 0.4rem 0.75rem;
		font-size: 0.78rem;
		flex-shrink: 0;
	}
	.mp-btn-chico svg {
		width: 14px;
		height: 14px;
	}
	.mp-lista {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.mp-vacio {
		margin: 0;
		padding: 0.5rem 0;
		font-size: 0.78rem;
		font-style: italic;
		color: var(--au-muted);
		text-align: center;
	}

	.mp-opcion {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.4rem 0.35rem 0.6rem;
		border-radius: 12px;
		background: #fff;
		box-shadow: 0 2px 6px rgba(20, 83, 45, 0.05);
	}
	.mp-opcion--correcta {
		box-shadow: inset 0 0 0 1.5px var(--au-primary);
	}
	.mp-check {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		cursor: pointer;
	}
	.mp-check input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.mp-check-caja {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 50%;
		border: 1.5px solid var(--au-border);
		background: #fff;
		color: #fff;
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.mp-check-caja svg {
		width: 0.75rem;
		height: 0.75rem;
	}
	.mp-check input:checked + .mp-check-caja {
		border-color: var(--au-primary);
		background: var(--au-primary);
	}
	.mp-check input:focus-visible + .mp-check-caja {
		outline: 2px solid var(--au-primary);
		outline-offset: 2px;
	}
	.mp-opcion-texto {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		padding: 0.45rem 0.25rem;
		font-family: inherit;
		font-size: 0.86rem;
		color: var(--au-text);
	}
	.mp-opcion-texto:focus {
		outline: none;
	}
	.mp-quitar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		flex-shrink: 0;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--au-muted);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.mp-quitar:hover {
		background: var(--au-danger-soft);
		color: var(--au-danger);
	}
	.mp-quitar svg {
		width: 0.9rem;
		height: 0.9rem;
	}

	.mp-vf {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.mp-vf-opcion {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.9rem 0.5rem;
		border: 1.5px solid var(--au-border);
		border-radius: 16px;
		background: #fff;
		font-family: inherit;
		font-size: 0.88rem;
		font-weight: 700;
		color: var(--au-text);
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.mp-vf-opcion svg {
		width: 1.6rem;
		height: 1.6rem;
		color: var(--au-muted);
	}
	.mp-vf-opcion:hover {
		border-color: var(--au-primary);
	}
	.mp-vf-opcion--activa {
		border-color: var(--au-primary);
		background: var(--au-tint);
		color: var(--au-dark);
	}
	.mp-vf-opcion--activa svg {
		color: var(--au-primary);
	}
	.mp-vf-opcion--falso:hover,
	.mp-vf-opcion--falso.mp-vf-opcion--activa {
		border-color: var(--au-danger);
	}
	.mp-vf-opcion--falso.mp-vf-opcion--activa {
		background: var(--au-danger-soft);
		color: var(--au-danger);
	}
	.mp-vf-opcion--falso.mp-vf-opcion--activa svg {
		color: var(--au-danger);
	}

	.mp-sopa-ajustes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.9rem;
		align-items: start;
	}
	.mp-sopa-check {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.6rem 0.75rem;
		border: 1.5px solid var(--au-border);
		border-radius: 14px;
		cursor: pointer;
		font-size: 0.84rem;
	}
	.mp-sopa-check input {
		margin-top: 0.2rem;
		accent-color: var(--au-primary);
	}
	.mp-sopa-check span {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.mp-sopa-check small {
		font-size: 0.74rem;
		color: var(--au-muted);
	}
	.mp-par {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.4rem;
		border-radius: 12px;
		background: #fff;
		box-shadow: 0 2px 6px rgba(20, 83, 45, 0.05);
	}
	.mp-par input {
		min-width: 0;
		border: 0;
		background: transparent;
		padding: 0.45rem 0.4rem;
		font-family: inherit;
		font-size: 0.86rem;
		color: var(--au-text);
	}
	.mp-par input:focus {
		outline: none;
		background: var(--bg-base, #fff7ed);
		border-radius: 8px;
	}
	.mp-par-flecha {
		width: 1rem;
		height: 1rem;
		color: var(--au-muted);
	}

	@media (max-width: 639.98px) {
		.mp-cab,
		.mp-cuerpo,
		.mp-pie {
			padding-left: 1.1rem;
			padding-right: 1.1rem;
		}
		.mp-pie {
			flex-direction: column-reverse;
		}
		.mp-pie :global(button) {
			width: 100%;
			justify-content: center;
		}
		.mp-tipos-lista {
			grid-template-columns: 1fr 1fr;
		}
		.mp-tipo-ayuda {
			display: none;
		}
	}
</style>
