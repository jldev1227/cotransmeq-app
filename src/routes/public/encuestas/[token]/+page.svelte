<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { encuestasAPI, type EncuestaPublica, type PreguntaEncuesta } from '$lib/api/encuestas';
	import { getDeviceFingerprint } from '$lib/utils/fingerprint';

	const token = $derived(page.params.token ?? '');
	let encuesta = $state<EncuestaPublica | null>(null);
	let respuestas = $state<Record<string, any>>({});
	let nombre = $state('');
	let correo = $state('');
	let cargando = $state(true);
	let enviando = $state(false);
	let error = $state('');
	let terminado = $state(false);
	let mensajeFinal = $state('');

	const contestadas = $derived(
		encuesta?.preguntas.filter((p) => {
			const v = respuestas[p.id];
			return v != null && v !== '' && (!Array.isArray(v) || v.length > 0);
		}).length ?? 0
	);
	const total = $derived(encuesta?.preguntas.length ?? 0);

	onMount(async () => {
		try {
			encuesta = await encuestasAPI.publica(token);
		} catch (e: any) {
			error = e.message || 'No se pudo abrir la encuesta';
		} finally {
			cargando = false;
		}
	});

	function fijar(id: string, valor: unknown) {
		respuestas = { ...respuestas, [id]: valor };
	}

	function alternar(id: string, opcion: string, marcado: boolean) {
		const actuales = Array.isArray(respuestas[id]) ? (respuestas[id] as string[]) : [];
		fijar(id, marcado ? [...actuales, opcion] : actuales.filter((v) => v !== opcion));
	}

	function mostrarNumero(p: PreguntaEncuesta): number[] {
		const min = p.tipo === 'NPS' ? 0 : (p.minimo ?? 1);
		const max = p.tipo === 'NPS' ? 10 : (p.maximo ?? 5);
		return Array.from({ length: max - min + 1 }, (_, i) => min + i);
	}

	async function enviar(event: SubmitEvent) {
		event.preventDefault();
		if (!encuesta || enviando) return;
		enviando = true;
		error = '';
		try {
			/// La captura ocurre solo si quien publicó la encuesta la activó.
			const dispositivo = encuesta.registrar_origen
				? await getDeviceFingerprint().catch(() => undefined)
				: undefined;
			const resultado = await encuestasAPI.responder(token, {
				nombre: nombre || undefined,
				correo: correo || undefined,
				dispositivo,
				respuestas
			});
			mensajeFinal = resultado.mensaje;
			terminado = true;
			window.scrollTo({ top: 0, behavior: 'smooth' });
		} catch (e: any) {
			error = e.message || 'No se pudo guardar la respuesta';
		} finally {
			enviando = false;
		}
	}
</script>

<svelte:head>
	<title>{encuesta?.titulo ?? 'Encuesta'}</title>
	<meta name="description" content={encuesta?.descripcion ?? 'Participa en esta encuesta'} />
</svelte:head>

<div class="encuesta-publica">
	<div class="ambiental ambiental-a"></div>
	<div class="ambiental ambiental-b"></div>
	<main class="marco">
		<aside class="intro">
			<div class="marca"><span class="marca-icono">✦</span> Encuesta</div>
			{#if !cargando && encuesta}
				<div class="estado"><span></span> {encuesta.abierta ? 'Disponible para responder' : 'Encuesta cerrada'}</div>
				<h1>{encuesta.titulo}</h1>
				{#if encuesta.descripcion}<p class="descripcion">{encuesta.descripcion}</p>{/if}
				{#if !terminado && encuesta.abierta}
					<div class="progreso">
						<div class="progreso-superior"><span>Tu progreso</span><strong>{contestadas} de {total}</strong></div>
						<div class="progreso-pista"><div style:width={total ? `${Math.round((contestadas / total) * 100)}%` : '0%'}></div></div>
					</div>
				{/if}
				<p class="nota">Tus respuestas se guardan al pulsar «Enviar respuestas».</p>
			{:else}
				<h1>Queremos conocer tu opinión.</h1>
				<p class="descripcion">Un momento para responder puede ayudarnos a tomar mejores decisiones.</p>
			{/if}
		</aside>

		<section class="contenido">
			{#if cargando}
				<div class="tarjeta estado-tarjeta">Cargando encuesta…</div>
			{:else if terminado}
				<div class="tarjeta cierre">
					<div class="check">✓</div>
					<h2>Respuesta enviada</h2>
					<p>{mensajeFinal}</p>
				</div>
			{:else if !encuesta || !encuesta.abierta}
				<div class="tarjeta estado-tarjeta">
					<h2>{encuesta ? 'Esta encuesta está cerrada' : 'Enlace no disponible'}</h2>
					<p>{error || 'Ya no se reciben respuestas por este enlace.'}</p>
				</div>
			{:else}
				<form onsubmit={enviar}>
					{#if encuesta.nombre_modo !== 'NO' || encuesta.correo_modo !== 'NO'}
						<div class="tarjeta identidad">
							<div class="etiqueta-seccion">Sobre ti</div>
							<h2>Antes de empezar</h2>
							<p>Estos datos ayudan a contextualizar tu respuesta.</p>
							{#if encuesta.nombre_modo !== 'NO'}
								<label for="nombre">Nombre</label>
								<input id="nombre" type="text" autocomplete="name" maxlength="160" bind:value={nombre}
									required={encuesta.nombre_modo === 'OBLIGATORIO'} placeholder="Tu nombre" />
								{#if encuesta.nombre_modo === 'OPCIONAL'}<small>Opcional</small>{/if}
							{/if}
							{#if encuesta.correo_modo !== 'NO'}
								<label for="correo">Correo electrónico</label>
								<input id="correo" type="email" autocomplete="email" maxlength="254" bind:value={correo}
									required={encuesta.correo_modo === 'OBLIGATORIO'} placeholder="tu@correo.com" />
								{#if encuesta.correo_modo === 'OPCIONAL'}<small>Opcional</small>{/if}
							{/if}
						</div>
					{/if}

					{#each encuesta.preguntas as p, i (p.id)}
						<fieldset class="tarjeta pregunta">
							<legend><span class="numero">{String(i + 1).padStart(2, '0')}</span>{p.titulo}{#if p.requerida}<span class="obligatoria" title="Obligatoria">*</span>{/if}</legend>
							{#if p.descripcion}<p class="ayuda">{p.descripcion}</p>{/if}

							{#if p.tipo === 'TEXTO_CORTO' || p.tipo === 'CORREO'}
								<input type={p.tipo === 'CORREO' ? 'email' : 'text'} value={respuestas[p.id] ?? ''}
									oninput={(e) => fijar(p.id, e.currentTarget.value)} required={p.requerida}
									maxlength={p.tipo === 'CORREO' ? 500 : 500} placeholder="Escribe tu respuesta" />
							{:else if p.tipo === 'TEXTO_LARGO'}
								<textarea rows="4" maxlength="4000" value={respuestas[p.id] ?? ''}
									oninput={(e) => fijar(p.id, e.currentTarget.value)} required={p.requerida}
									placeholder="Cuéntanos un poco más…"></textarea>
							{:else if p.tipo === 'OPCION_UNICA'}
								<div class="opciones">
									{#each p.opciones as o (o.id)}
										<label class:seleccionada={respuestas[p.id] === o.id}>
											<input type="radio" name={p.id} value={o.id} checked={respuestas[p.id] === o.id}
												onchange={() => fijar(p.id, o.id)} required={p.requerida} />
											<span class="indicador"></span>{o.texto}
										</label>
									{/each}
								</div>
							{:else if p.tipo === 'OPCION_MULTIPLE'}
								<p class="micro">Puedes elegir varias opciones.</p>
								<div class="opciones">
									{#each p.opciones as o (o.id)}
										<label class:seleccionada={(respuestas[p.id] ?? []).includes(o.id)}>
											<input type="checkbox" checked={(respuestas[p.id] ?? []).includes(o.id)}
												onchange={(e) => alternar(p.id, o.id, e.currentTarget.checked)} />
											<span class="indicador"></span>{o.texto}
										</label>
									{/each}
								</div>
							{:else if p.tipo === 'SI_NO'}
								<div class="opciones opciones-dos">
									{#each [{ valor: true, texto: 'Sí' }, { valor: false, texto: 'No' }] as o}
										<label class:seleccionada={respuestas[p.id] === o.valor}>
											<input type="radio" name={p.id} checked={respuestas[p.id] === o.valor}
												onchange={() => fijar(p.id, o.valor)} required={p.requerida} />
											<span class="indicador"></span>{o.texto}
										</label>
									{/each}
								</div>
							{:else if p.tipo === 'ESCALA' || p.tipo === 'NPS'}
								<div class="escala">
									{#each mostrarNumero(p) as n}
										<button type="button" class:seleccionada={respuestas[p.id] === n}
											aria-label={`Calificar con ${n}`} aria-pressed={respuestas[p.id] === n}
											onclick={() => fijar(p.id, n)}>{n}</button>
									{/each}
								</div>
								<div class="extremos"><span>{p.tipo === 'NPS' ? 'Nada probable' : 'Mínimo'}</span><span>{p.tipo === 'NPS' ? 'Muy probable' : 'Máximo'}</span></div>
							{:else if p.tipo === 'NUMERO'}
								<input type="number" value={respuestas[p.id] ?? ''} required={p.requerida}
									oninput={(e) => fijar(p.id, e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))}
									placeholder="Ingresa un número" />
							{:else if p.tipo === 'FECHA'}
								<input type="date" value={respuestas[p.id] ?? ''} required={p.requerida}
									oninput={(e) => fijar(p.id, e.currentTarget.value)} />
							{/if}
						</fieldset>
					{/each}
					{#if encuesta.registrar_origen}
						<p class="privacidad">Para revisar respuestas repetidas se compara una huella del navegador y de la conexión. No se guarda la IP ni la huella original.</p>
					{/if}
					{#if error}<p class="error" role="alert">{error}</p>{/if}
					<button class="enviar" type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar respuestas'} <span>↗</span></button>
				</form>
			{/if}
		</section>
	</main>
</div>

<style>
	:global(body) { margin: 0; }
	.encuesta-publica { min-height: 100vh; background: #f5f8f5; color: #17332a; font-family: Inter, system-ui, sans-serif; position: relative; overflow: hidden; }
	.ambiental { position: absolute; border-radius: 50%; filter: blur(4px); pointer-events: none; }
	.ambiental-a { width: 58rem; height: 58rem; background: radial-gradient(circle, #d4eadc 0, transparent 67%); top: -25rem; left: -25rem; }
	.ambiental-b { width: 50rem; height: 50rem; background: radial-gradient(circle, #e6f0cf 0, transparent 68%); bottom: -32rem; right: -25rem; }
	.marco { position: relative; display: grid; grid-template-columns: minmax(19rem, .75fr) minmax(0, 1.25fr); gap: clamp(2rem, 5vw, 6rem); padding: clamp(1.5rem, 5vw, 5rem); align-items: start; }
	.intro { position: sticky; top: 4rem; padding: 1rem 0; }
	.marca { display: inline-flex; align-items: center; gap: .6rem; text-transform: uppercase; letter-spacing: .18em; font-size: .72rem; font-weight: 800; color: #17674c; }
	.marca-icono { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: .7rem; color: white; background: #0d7353; font-size: 1rem; }
	.estado { display: inline-flex; align-items: center; gap: .5rem; padding: .45rem .7rem; margin: 4rem 0 1.3rem; background: #e8f3eb; border-radius: 2rem; font-size: .75rem; font-weight: 700; color: #226c4d; }
	.estado span { width: .5rem; height: .5rem; background: #28ad70; border-radius: 50%; }
	h1 { font-size: clamp(2.5rem, 4.3vw, 5.2rem); letter-spacing: -.055em; line-height: 1.02; margin: 0; max-width: 12ch; }
	.descripcion { font-size: 1.08rem; line-height: 1.7; color: #577267; max-width: 42rem; margin: 1.5rem 0; white-space: pre-wrap; }
	.nota { color: #7b8e83; font-size: .8rem; margin-top: 2rem; }
	.progreso { max-width: 22rem; margin-top: 4rem; }
	.progreso-superior { display: flex; justify-content: space-between; font-size: .8rem; margin-bottom: .7rem; color: #6b8175; }
	.progreso-superior strong { color: #17674c; }
	.progreso-pista { height: .42rem; background: #dce8dd; border-radius: 1rem; overflow: hidden; }
	.progreso-pista div { height: 100%; background: #139c6c; border-radius: inherit; transition: width .25s ease; }
	.contenido { min-width: 0; }
	form { display: grid; gap: 1rem; }
	.tarjeta { background: #fff; border: 1px solid #e2ebe3; border-radius: 1.4rem; box-shadow: 0 12px 32px rgba(17, 63, 45, .045); padding: clamp(1.3rem, 3vw, 2.2rem); }
	.pregunta { margin: 0; min-width: 0; }
	.pregunta legend { display: flex; align-items: center; gap: .8rem; padding: 0; font-size: 1.15rem; font-weight: 750; line-height: 1.45; }
	.numero { flex: none; display: grid; place-items: center; width: 2.1rem; height: 2.1rem; border-radius: .65rem; background: #eaf5ee; color: #167751; font-size: .75rem; letter-spacing: .06em; }
	.obligatoria { color: #e36e5a; }
	.ayuda, .identidad p, .micro { color: #71877b; font-size: .86rem; line-height: 1.55; margin: .35rem 0 1.2rem; }
	.micro { margin-top: -.2rem; }
	input:not([type='radio']):not([type='checkbox']), textarea { width: 100%; box-sizing: border-box; min-height: 3rem; border: 1px solid #d9e5dc; border-radius: .8rem; padding: .8rem 1rem; font: inherit; color: #17332a; background: #fbfdfb; }
	input:focus, textarea:focus, button:focus-visible { outline: 2px solid #1b9c69; outline-offset: 2px; }
	textarea { resize: vertical; }
	.opciones { display: grid; gap: .65rem; }
	.opciones-dos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.opciones label { display: flex; align-items: center; gap: .85rem; min-height: 3.2rem; padding: .7rem 1rem; border: 1px solid #e0e9e2; border-radius: .9rem; cursor: pointer; transition: border-color .18s, background .18s; }
	.opciones label:hover, .opciones label.seleccionada { border-color: #62bf91; background: #f0faf3; }
	.opciones input { position: absolute; opacity: 0; width: 1px; height: 1px; }
	.indicador { width: 1rem; height: 1rem; border: 2px solid #a8bbae; border-radius: 50%; flex: none; }
	.opciones input[type='checkbox'] + .indicador { border-radius: .28rem; }
	.seleccionada .indicador { background: #159b68; border-color: #159b68; box-shadow: inset 0 0 0 3px white; }
	.escala { display: flex; flex-wrap: wrap; gap: .5rem; }
	.escala button { border: 1px solid #dbe8df; background: #f8fbf8; border-radius: .7rem; min-width: 3rem; height: 3rem; font: inherit; font-weight: 750; color: #416153; cursor: pointer; }
	.escala button.seleccionada { color: white; background: #13895e; border-color: #13895e; }
	.extremos { display: flex; justify-content: space-between; color: #809286; font-size: .72rem; margin-top: .5rem; }
	.etiqueta-seccion { text-transform: uppercase; color: #129064; font-size: .7rem; font-weight: 800; letter-spacing: .15em; }
	h2 { margin: .5rem 0; letter-spacing: -.03em; }
	.identidad label { display: block; font-weight: 700; font-size: .82rem; margin: 1rem 0 .4rem; }
	.identidad small { color: #7b8e83; font-size: .73rem; }
	.privacidad { font-size: .75rem; line-height: 1.5; color: #72867a; padding: 0 .5rem; }
	.error { background: #fff1ef; color: #a4392f; padding: 1rem; border-radius: .8rem; }
	.enviar { width: 100%; min-height: 3.6rem; display: flex; align-items: center; justify-content: space-between; background: #086845; color: white; border: 0; border-radius: .9rem; padding: .8rem 1.2rem; font: inherit; font-weight: 750; cursor: pointer; }
	.enviar:hover { background: #07583b; }
	.enviar:disabled { opacity: .65; cursor: wait; }
	.cierre { text-align: center; padding: 5rem 2rem; }
	.check { margin: auto auto 1.2rem; display: grid; place-items: center; width: 4rem; height: 4rem; border-radius: 50%; background: #e4f5e9; color: #0d8d61; font-size: 2rem; }
	.cierre p, .estado-tarjeta p { color: #698273; }
	@media (max-width: 900px) { .marco { grid-template-columns: 1fr; } .intro { position: static; } .estado { margin-top: 2rem; } h1 { max-width: none; } .progreso { margin-top: 2rem; } }
	@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; scroll-behavior: auto !important; } }
</style>
