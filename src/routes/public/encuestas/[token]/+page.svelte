<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { encuestasAPI, type EncuestaPublica, type PreguntaEncuesta } from '$lib/api/encuestas';
	import { getDeviceFingerprint } from '$lib/utils/fingerprint';

	const token = $derived(page.params.token ?? '');
	const COMPANY_LOGO = '/assets/logo_nombre_white.webp';
	const COMPANY_NAME = 'Cotransmeq';
	let encuesta = $state<EncuestaPublica | null>(null);
	let respuestas = $state<Record<string, any>>({});
	let nombre = $state('');
	let correo = $state('');
	let cargando = $state(true);
	let enviando = $state(false);
	let error = $state('');
	let terminado = $state(false);
	let mensajeFinal = $state('');
	let avisoActualizacion = $state<{ titulo: string; descripcion: string; preguntas: string[] } | null>(null);
	let preguntasPendientes = $state<Set<string>>(new Set());
	let cerrarEventos = () => {};
	let sincronizando = false;

	const contestadas = $derived(
		encuesta?.preguntas.filter((p) => {
			const v = respuestas[p.id];
			if (v && typeof v === 'object' && !Array.isArray(v)) {
				return (v.opcion_ids?.length ?? 0) > 0 || (v.otro_activo && !!v.otro_texto?.trim());
			}
			return v != null && v !== '' && (!Array.isArray(v) || v.length > 0);
		}).length ?? 0
	);
	const total = $derived(encuesta?.preguntas.length ?? 0);

	onMount(() => {
		let activa = true;
		void (async () => {
			try {
				encuesta = await encuestasAPI.publica(token);
			} catch (e: any) {
				error = e.message || 'No se pudo abrir la encuesta';
			} finally {
				cargando = false;
			}
			if (activa && encuesta) {
				cerrarEventos = encuestasAPI.suscribirActualizaciones(token, () => void sincronizarEncuesta());
			}
		})();
		const alVolver = () => {
			if (document.visibilityState === 'visible') void sincronizarEncuesta();
		};
		document.addEventListener('visibilitychange', alVolver);
		const respaldo = setInterval(alVolver, 15_000);
		return () => {
			activa = false;
			cerrarEventos();
			clearInterval(respaldo);
			document.removeEventListener('visibilitychange', alVolver);
		};
	});

	function preguntaRespondida(p: PreguntaEncuesta, valor: any): boolean {
		if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
			if (valor.otro_activo && !valor.otro_texto?.trim()) return false;
			return (valor.opcion_ids?.length ?? 0) > 0 || !!valor.otro_activo;
		}
		return valor != null && valor !== '' && (!Array.isArray(valor) || valor.length > 0);
	}

	function firmaPregunta(p: PreguntaEncuesta): string {
		return JSON.stringify({
			titulo: p.titulo, descripcion: p.descripcion, tipo: p.tipo, requerida: p.requerida,
			opciones: p.opciones, permite_otro: p.permite_otro ?? false,
			otro_etiqueta: p.otro_etiqueta ?? 'Otra (especificar)', minimo: p.minimo ?? null, maximo: p.maximo ?? null
		});
	}

	async function sincronizarEncuesta() {
		if (sincronizando || terminado || !encuesta) return;
		sincronizando = true;
		try {
			const anterior = encuesta;
			const nueva = await encuestasAPI.publica(token);
			if (nueva.actualizada_at === anterior.actualizada_at && nueva.abierta === anterior.abierta && nueva.estado === anterior.estado) return;
			const anteriores = new Map(anterior.preguntas.map((p) => [p.id, p]));
			const nuevas = new Map(nueva.preguntas.map((p) => [p.id, p]));
			const agregadas = nueva.preguntas.filter((p) => !anteriores.has(p.id));
			const modificadas = nueva.preguntas.filter((p) => {
				const previa = anteriores.get(p.id);
				return previa && firmaPregunta(previa) !== firmaPregunta(p);
			});
			const eliminadas = anterior.preguntas.filter((p) => !nuevas.has(p.id));
			const limpiadas = new Set([...agregadas, ...modificadas].map((p) => p.id));
			const siguientesRespuestas = { ...respuestas };
			for (const p of [...agregadas, ...modificadas, ...eliminadas]) delete siguientesRespuestas[p.id];
			respuestas = siguientesRespuestas;
			const pendientes = new Set([...preguntasPendientes].filter((id) => nuevas.has(id)));
			for (const id of limpiadas) pendientes.add(id);
			preguntasPendientes = pendientes;
			const cambioEstado = nueva.estado !== anterior.estado || nueva.abierta !== anterior.abierta;
			encuesta = nueva;
			const titulos = [
				...agregadas.map((p) => `Nueva: ${p.titulo}`),
				...modificadas.map((p) => `Actualizada: ${p.titulo}`),
				...eliminadas.map((p) => `Retirada: ${p.titulo}`)
			];
			const detalles: string[] = [];
			if (agregadas.length || modificadas.length) detalles.push(`${agregadas.length + modificadas.length} pregunta(s) nueva(s) o modificada(s) deben responderse de nuevo.`);
			if (eliminadas.length) detalles.push(`Se retiraron ${eliminadas.length} pregunta(s); sus respuestas en curso se descartaron.`);
			if (cambioEstado && !nueva.abierta) detalles.push('La recepción de respuestas está cerrada.');
			if (cambioEstado && nueva.abierta && !anterior.abierta) detalles.push('La recepción de respuestas está abierta nuevamente.');
			if (!detalles.length) detalles.push('Tus respuestas actuales se conservaron.');
			avisoActualizacion = {
				titulo: cambioEstado && !nueva.abierta ? 'La encuesta se cerró' : cambioEstado && nueva.abierta && !anterior.abierta ? 'La encuesta volvió a abrirse' : 'La encuesta se actualizó',
				descripcion: detalles.join(' '),
				preguntas: titulos
			};
			error = '';
		} catch (e: any) {
			if (/no encontrado|no disponible/i.test(e?.message ?? '')) {
				encuesta = { ...encuesta, abierta: false, estado: 'CERRADA' };
				avisoActualizacion = { titulo: 'La encuesta ya no está disponible', descripcion: 'El enlace dejó de aceptar respuestas.', preguntas: [] };
				cerrarEventos();
			} else if (document.visibilityState === 'visible') {
				console.warn('No se pudo sincronizar la encuesta en vivo', e);
			}
		} finally {
			sincronizando = false;
		}
	}

	function fijar(id: string, valor: unknown) {
		respuestas = { ...respuestas, [id]: valor };
		if (preguntasPendientes.has(id)) {
			const pregunta = encuesta?.preguntas.find((p) => p.id === id);
			if (pregunta && preguntaRespondida(pregunta, valor)) {
				const siguientes = new Set(preguntasPendientes);
				siguientes.delete(id);
				preguntasPendientes = siguientes;
			}
		}
	}

	function alternar(id: string, opcion: string, marcado: boolean) {
		const actuales = Array.isArray(respuestas[id]) ? (respuestas[id] as string[]) : [];
		fijar(id, marcado ? [...actuales, opcion] : actuales.filter((v) => v !== opcion));
	}

	function opcionesMarcadas(id: string): string[] {
		const valor = respuestas[id];
		if (Array.isArray(valor)) return valor;
		if (typeof valor === 'string') return [valor];
		return valor && typeof valor === 'object' ? valor.opcion_ids ?? [] : [];
	}

	function otraActiva(id: string): boolean {
		const valor = respuestas[id];
		return !!valor && typeof valor === 'object' && !Array.isArray(valor) && !!valor.otro_activo;
	}

	function textoOtra(id: string): string {
		const valor = respuestas[id];
		return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor.otro_texto ?? '' : '';
	}

	function cambiarOpcionesAbiertas(id: string, parcial: { opcion_ids?: string[]; otro_activo?: boolean; otro_texto?: string }) {
		fijar(id, {
			opcion_ids: parcial.opcion_ids ?? opcionesMarcadas(id),
			otro_activo: parcial.otro_activo ?? otraActiva(id),
			otro_texto: parcial.otro_texto ?? textoOtra(id)
		});
	}

	function alternarOpcionAbierta(id: string, opcion: string, marcado: boolean) {
		const actuales = opcionesMarcadas(id);
		cambiarOpcionesAbiertas(id, {
			opcion_ids: marcado ? [...actuales, opcion] : actuales.filter((v) => v !== opcion)
		});
	}

	function mostrarNumero(p: PreguntaEncuesta): number[] {
		const min = p.tipo === 'NPS' ? 0 : (p.minimo ?? 1);
		const max = p.tipo === 'NPS' ? 10 : (p.maximo ?? 5);
		return Array.from({ length: max - min + 1 }, (_, i) => min + i);
	}

	async function enviar(event: SubmitEvent) {
		event.preventDefault();
		if (!encuesta || enviando) return;
		if (preguntasPendientes.size) {
			const primera = preguntasPendientes.values().next().value;
			error = 'La encuesta cambió mientras respondías. Completa las preguntas marcadas para continuar.';
			if (primera) document.getElementById(`pregunta-${primera}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			return;
		}
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
			/// Si la encuesta cambió justo antes del envío, recarga el cuestionario y
			/// marca las preguntas nuevas para evitar que el usuario pierda el avance.
			await sincronizarEncuesta();
			error = preguntasPendientes.size
				? 'La encuesta cambió mientras enviabas. Revisa y responde de nuevo las preguntas marcadas.'
				: e.message || 'No se pudo guardar la respuesta';
		} finally {
			enviando = false;
		}
	}
</script>

<svelte:head>
	<title>{encuesta?.titulo ?? 'Encuesta'} · {COMPANY_NAME}</title>
	<meta name="description" content={encuesta?.descripcion ?? 'Participa en esta encuesta'} />
</svelte:head>
<div class="encuesta-publica">
	<header class="barra-marca"><div class="barra-marca__contenido"><img class="barra-marca__logo" src={COMPANY_LOGO} alt={COMPANY_NAME} /><span class="barra-marca__separador"></span><span class="barra-marca__tipo">Encuesta pública</span></div><span class="barra-marca__nota">Tu opinión nos ayuda a mejorar</span></header>
	<main class="encuesta-contenedor">
		<section class="encuesta-hero" aria-labelledby="titulo-encuesta">
			<div class="hero-orbe" aria-hidden="true"></div>
			<div class="hero-meta"><span class="hero-eyebrow">PARTICIPACIÓN · {COMPANY_NAME}</span>{#if !cargando && encuesta}<span class="estado" class:estado-cerrado={!encuesta.abierta}><span class="estado-punto"></span>{encuesta.abierta ? 'Abierta' : 'Cerrada'}</span>{/if}</div>
			{#if !cargando && encuesta}<h1 id="titulo-encuesta">{encuesta.titulo}</h1>{#if encuesta.descripcion}<p class="descripcion">{encuesta.descripcion}</p>{/if}{:else}<h1 id="titulo-encuesta">Queremos conocer tu opinión</h1><p class="descripcion">Tus respuestas nos ayudan a entender mejor cada experiencia.</p>{/if}
				{#if avisoActualizacion}<aside class="aviso-actualizacion" role="status"><strong>{avisoActualizacion.titulo}</strong><p>{avisoActualizacion.descripcion}</p>{#if avisoActualizacion.preguntas.length}<ul>{#each avisoActualizacion.preguntas as titulo}<li>{titulo}</li>{/each}</ul>{/if}</aside>{/if}
			{#if !cargando && encuesta?.abierta && !terminado}<div class="progreso"><div class="progreso-superior"><span>Tu progreso</span><strong>{contestadas} de {total} respondidas</strong></div><div class="progreso-pista" role="progressbar" aria-label="Preguntas respondidas" aria-valuemin="0" aria-valuemax={total} aria-valuenow={contestadas}><span style:width={total ? Math.round((contestadas / total) * 100) + '%' : '0%'}></span></div></div>{/if}
		</section>
		<section class="encuesta-contenido" aria-label="Formulario de encuesta">
			{#if cargando}<div class="tarjeta estado-tarjeta"><span class="cargando-punto"></span><p>Cargando encuesta…</p></div>
			{:else if terminado}<div class="tarjeta cierre" role="status"><div class="cierre-icono" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round" /></svg></div><span class="cierre-eyebrow">RESPUESTA REGISTRADA</span><h2>¡Gracias por participar!</h2><p>{mensajeFinal}</p></div>
			{:else if !encuesta || !encuesta.abierta}<div class="tarjeta estado-tarjeta" role="status"><div class="estado-tarjeta__icono">i</div><h2>{encuesta ? 'Esta encuesta está cerrada' : 'No encontramos este enlace'}</h2><p>{error || 'Ya no se reciben respuestas por este enlace.'}</p></div>
			{:else}
				<form class="encuesta-formulario" onsubmit={enviar}>
					{#if encuesta.nombre_modo !== 'NO' || encuesta.correo_modo !== 'NO'}<section class="tarjeta identidad"><div class="tarjeta-cabecera"><span class="seccion-numero">01</span><div><h2>Sobre ti</h2><p>Estos datos ayudan a contextualizar tu respuesta.</p></div></div>
						{#if encuesta.nombre_modo !== 'NO'}<label for="nombre">Nombre <span>{encuesta.nombre_modo === 'OBLIGATORIO' ? 'Obligatorio' : 'Opcional'}</span></label><input id="nombre" type="text" autocomplete="name" maxlength="160" bind:value={nombre} required={encuesta.nombre_modo === 'OBLIGATORIO'} placeholder="Escribe tu nombre" />{/if}
						{#if encuesta.correo_modo !== 'NO'}<label for="correo">Correo electrónico <span>{encuesta.correo_modo === 'OBLIGATORIO' ? 'Obligatorio' : 'Opcional'}</span></label><input id="correo" type="email" autocomplete="email" maxlength="254" bind:value={correo} required={encuesta.correo_modo === 'OBLIGATORIO'} placeholder="nombre@correo.com" />{/if}
					</section>{/if}
					{#each encuesta.preguntas as p, i (p.id)}
						<fieldset id={`pregunta-${p.id}`} class="tarjeta pregunta" class:pregunta-actualizada={preguntasPendientes.has(p.id)}><legend><span class="pregunta-numero">{String(i + 1).padStart(2, '0')}</span><span class="pregunta-titulo">{p.titulo}{#if p.requerida}<span class="obligatoria" aria-label="Obligatoria"> *</span>{/if}</span></legend>
						{#if preguntasPendientes.has(p.id)}<p class="pregunta-aviso">Actualizada mientras respondías. Diligénciala nuevamente para continuar.</p>{/if}
						{#if p.descripcion}<p class="ayuda">{p.descripcion}</p>{/if}
						{#if p.tipo === 'TEXTO_CORTO' || p.tipo === 'CORREO'}<input type={p.tipo === 'CORREO' ? 'email' : 'text'} value={respuestas[p.id] ?? ''} oninput={(e) => fijar(p.id, e.currentTarget.value)} required={p.requerida} maxlength="500" placeholder={p.tipo === 'CORREO' ? 'nombre@correo.com' : 'Escribe tu respuesta'} />
						{:else if p.tipo === 'TEXTO_LARGO'}<textarea rows="4" maxlength="4000" value={respuestas[p.id] ?? ''} oninput={(e) => fijar(p.id, e.currentTarget.value)} required={p.requerida} placeholder="Escribe aquí tu respuesta"></textarea>
						{:else if p.tipo === 'OPCION_UNICA'}<div class="opciones">{#each p.opciones as o (o.id)}<label class="opcion" class:seleccionada={p.permite_otro ? opcionesMarcadas(p.id).includes(o.id) : respuestas[p.id] === o.id}><input type="radio" name={p.id} value={o.id} checked={p.permite_otro ? opcionesMarcadas(p.id).includes(o.id) : respuestas[p.id] === o.id} onchange={() => p.permite_otro ? cambiarOpcionesAbiertas(p.id, { opcion_ids: [o.id], otro_activo: false, otro_texto: '' }) : fijar(p.id, o.id)} required={p.requerida} /><span>{o.texto}</span></label>{/each}
							{#if p.permite_otro}<label class="opcion" class:seleccionada={otraActiva(p.id)}><input type="radio" name={p.id} value="__otra__" checked={otraActiva(p.id)} onchange={() => cambiarOpcionesAbiertas(p.id, { opcion_ids: [], otro_activo: true })} required={p.requerida} /><span>{p.otro_etiqueta || 'Otra (especificar)'}</span></label>{#if otraActiva(p.id)}<input class="respuesta-otra" type="text" maxlength="500" value={textoOtra(p.id)} oninput={(e) => cambiarOpcionesAbiertas(p.id, { otro_texto: e.currentTarget.value })} placeholder="Escribe tu respuesta" aria-label={`Respuesta abierta: ${p.titulo}`} required />{/if}{/if}
						</div>
						{:else if p.tipo === 'OPCION_MULTIPLE'}<p class="micro">Puedes seleccionar todas las opciones que apliquen.</p><div class="opciones">{#each p.opciones as o (o.id)}<label class="opcion" class:seleccionada={p.permite_otro ? opcionesMarcadas(p.id).includes(o.id) : (respuestas[p.id] ?? []).includes(o.id)}><input type="checkbox" checked={p.permite_otro ? opcionesMarcadas(p.id).includes(o.id) : (respuestas[p.id] ?? []).includes(o.id)} onchange={(e) => p.permite_otro ? alternarOpcionAbierta(p.id, o.id, e.currentTarget.checked) : alternar(p.id, o.id, e.currentTarget.checked)} /><span>{o.texto}</span></label>{/each}
							{#if p.permite_otro}<label class="opcion" class:seleccionada={otraActiva(p.id)}><input type="checkbox" checked={otraActiva(p.id)} onchange={(e) => cambiarOpcionesAbiertas(p.id, { otro_activo: e.currentTarget.checked, otro_texto: e.currentTarget.checked ? textoOtra(p.id) : '' })} /><span>{p.otro_etiqueta || 'Otra (especificar)'}</span></label>{#if otraActiva(p.id)}<input class="respuesta-otra" type="text" maxlength="500" value={textoOtra(p.id)} oninput={(e) => cambiarOpcionesAbiertas(p.id, { otro_texto: e.currentTarget.value })} placeholder="Escribe tu respuesta" aria-label={`Respuesta abierta: ${p.titulo}`} required />{/if}{/if}
						</div>
						{:else if p.tipo === 'SI_NO'}<div class="opciones opciones-dos">{#each [{ valor: true, texto: 'Sí' }, { valor: false, texto: 'No' }] as o}<label class="opcion opcion-si-no" class:seleccionada={respuestas[p.id] === o.valor}><input type="radio" name={p.id} checked={respuestas[p.id] === o.valor} onchange={() => fijar(p.id, o.valor)} required={p.requerida} /><span>{o.texto}</span></label>{/each}</div>
						{:else if p.tipo === 'ESCALA' || p.tipo === 'NPS'}<div class="escala" role="group" aria-label={p.titulo}>{#each mostrarNumero(p) as n}<button type="button" class:seleccionada={respuestas[p.id] === n} aria-label={"Calificar con " + n} aria-pressed={respuestas[p.id] === n} onclick={() => fijar(p.id, n)}>{n}</button>{/each}</div><div class="extremos"><span>{p.tipo === 'NPS' ? 'Nada probable' : 'Mínimo'}</span><span>{p.tipo === 'NPS' ? 'Muy probable' : 'Máximo'}</span></div>
						{:else if p.tipo === 'NUMERO'}<input type="number" value={respuestas[p.id] ?? ''} required={p.requerida} oninput={(e) => fijar(p.id, e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))} placeholder="Ingresa un número" />
						{:else if p.tipo === 'FECHA'}<input type="date" value={respuestas[p.id] ?? ''} required={p.requerida} oninput={(e) => fijar(p.id, e.currentTarget.value)} />{/if}</fieldset>
					{/each}
					{#if encuesta.registrar_origen}<p class="privacidad">Las señales de origen se usan para revisar respuestas repetidas. No se guarda la IP ni la huella original.</p>{/if}
					{#if error}<p class="error" role="alert">{error}</p>{/if}
					<div class="formulario-final"><p>Tu respuesta se enviará al completar la encuesta.</p><button class="enviar" type="submit" disabled={enviando}>{#if enviando}<span class="spinner" aria-hidden="true"></span>{/if}{enviando ? 'Enviando respuesta…' : 'Enviar respuestas'}{#if !enviando}<span aria-hidden="true">→</span>{/if}</button></div>
				</form>
			{/if}
		</section>
		<footer class="pie-pagina"><span>{COMPANY_NAME}</span><span>Encuesta pública</span></footer>
	</main>
</div>

<style>
	.encuesta-publica { --encuesta-acento:var(--accion,#079665); --encuesta-acento-hover:var(--accion-hover,#087a57); --encuesta-tinta:var(--text-primary,#17201d); --encuesta-texto:var(--text-secondary,#33423d); --encuesta-muted:var(--text-muted,#66756f); --encuesta-borde:var(--border-default,#dee7e3); --encuesta-fondo:var(--bg-base,#f7faf8); --encuesta-superficie:var(--bg-surface,#fff); --encuesta-oscuro:var(--bg-charcoal-deep,#014339); min-height:100vh; background:var(--encuesta-fondo); color:var(--encuesta-tinta); font-family:var(--font-sans,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif); }
	.barra-marca { min-height:68px; display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.75rem max(1.25rem,calc((100vw - 1120px)/2)); background:var(--encuesta-oscuro); color:#fff; }
	.barra-marca__contenido { display:flex; align-items:center; gap:1rem; min-width:0; }
	.barra-marca__logo { display:block; width:auto; max-width:190px; max-height:34px; object-fit:contain; }
	.barra-marca__separador { width:1px; height:24px; background:rgba(255,255,255,.25); }
	.barra-marca__tipo { color:rgba(255,255,255,.88); font-size:.85rem; font-weight:650; }
	.barra-marca__nota { color:rgba(255,255,255,.7); font-size:.78rem; }
	.encuesta-contenedor { width:min(100% - 2rem,760px); margin:0 auto; padding:1.5rem 0 2rem; }
	.encuesta-hero { position:relative; isolation:isolate; overflow:hidden; margin-bottom:1rem; padding:clamp(1.35rem,4vw,2.1rem); border-radius:1.4rem; background:linear-gradient(145deg,var(--encuesta-oscuro),color-mix(in srgb,var(--encuesta-oscuro),#000 15%)); color:#fff; box-shadow:0 6px 20px rgba(1,45,35,.12); }
	.hero-orbe { position:absolute; z-index:-1; width:270px; height:270px; right:-94px; top:-160px; border-radius:50%; background:rgba(255,255,255,.055); }
	.hero-meta { display:flex; align-items:center; justify-content:space-between; gap:.75rem; margin-bottom:1.25rem; }
	.hero-eyebrow { font-size:.65rem; font-weight:800; letter-spacing:.12em; color:rgba(255,255,255,.68); }
	.estado { display:inline-flex; align-items:center; gap:.45rem; padding:.38rem .62rem; border:1px solid rgba(255,255,255,.18); border-radius:999px; background:rgba(255,255,255,.1); color:#fff; font-size:.72rem; font-weight:700; white-space:nowrap; }
	.estado-punto { width:.43rem; height:.43rem; border-radius:50%; background:#73e3a5; }
	.estado-cerrado .estado-punto { background:#ffb3a9; }
	.encuesta-hero h1 { max-width:24ch; margin:0; color:#fff; font-family:var(--font-display,var(--font-sans)); font-size:clamp(1.65rem,4vw,2.35rem); line-height:1.15; font-weight:850; letter-spacing:-.035em; overflow-wrap:anywhere; }
	.descripcion { max-width:66ch; margin:.7rem 0 0; color:rgba(255,255,255,.78); font-size:.94rem; line-height:1.6; white-space:pre-wrap; }
	.progreso { margin-top:1.45rem; padding-top:1rem; border-top:1px solid rgba(255,255,255,.16); }
	.progreso-superior { display:flex; justify-content:space-between; gap:1rem; margin-bottom:.55rem; color:rgba(255,255,255,.72); font-size:.75rem; }
	.progreso-superior strong { color:#fff; font-weight:700; }
	.progreso-pista { height:6px; overflow:hidden; border-radius:999px; background:rgba(255,255,255,.18); }
	.progreso-pista span { display:block; height:100%; border-radius:inherit; background:var(--encuesta-acento); transition:width .24s ease; }
	.encuesta-formulario { display:grid; gap:.8rem; }
	.aviso-actualizacion { margin:0 0 1rem; padding:1rem 1.15rem; border:1px solid color-mix(in srgb,var(--encuesta-acento) 32%,var(--encuesta-borde)); border-radius:.9rem; background:color-mix(in srgb,var(--encuesta-acento) 7%,var(--encuesta-superficie)); color:var(--encuesta-texto); font-size:.84rem; line-height:1.5; }
	.aviso-actualizacion strong { display:block; color:var(--encuesta-tinta); font-size:.92rem; }
	.aviso-actualizacion p { margin:.25rem 0 0; }
	.aviso-actualizacion ul { display:grid; gap:.2rem; margin:.5rem 0 0; padding-left:1.2rem; }
	.tarjeta { min-width:0; border:1px solid var(--encuesta-borde); border-radius:1.1rem; background:var(--encuesta-superficie); box-shadow:var(--shadow-card,0 4px 24px rgba(0,0,0,.04)); }
	.pregunta { margin:0; padding:1.25rem; }
	.pregunta-actualizada { border-color:color-mix(in srgb,var(--encuesta-acento) 55%,var(--encuesta-borde)); box-shadow:0 0 0 3px color-mix(in srgb,var(--encuesta-acento) 9%,transparent); }
	.pregunta-aviso { margin:.75rem 0 .8rem 2.8rem; color:var(--encuesta-acento); font-size:.78rem; font-weight:700; line-height:1.45; }
	.pregunta legend { display:flex; align-items:flex-start; gap:.8rem; width:100%; padding:0; color:var(--encuesta-tinta); }
	.pregunta-numero,.seccion-numero { flex:none; display:grid; place-items:center; width:2rem; height:2rem; border-radius:.65rem; background:color-mix(in srgb,var(--encuesta-acento) 10%,white); color:var(--encuesta-acento); font-size:.68rem; font-weight:850; }
	.pregunta-titulo { padding-top:.12rem; font-size:1rem; font-weight:750; line-height:1.45; }
	.obligatoria { color:#c5483f; }
	.ayuda,.micro { margin:.55rem 0 1rem 2.8rem; color:var(--encuesta-muted); font-size:.82rem; line-height:1.5; }
	.micro { margin-bottom:.7rem; }
	.encuesta-publica input:not([type=radio]):not([type=checkbox]),.encuesta-publica textarea { display:block; width:100%; min-height:48px; padding:.75rem .9rem; border:1px solid var(--encuesta-borde); border-radius:.75rem; background:var(--encuesta-fondo); color:var(--encuesta-tinta); font:inherit; font-size:.92rem; transition:border-color .16s ease,box-shadow .16s ease,background .16s ease; }
	.encuesta-publica input::placeholder,.encuesta-publica textarea::placeholder { color:var(--encuesta-muted); opacity:.75; }
	.encuesta-publica input:focus,.encuesta-publica textarea:focus { outline:none; border-color:var(--encuesta-acento); background:#fff; box-shadow:0 0 0 3px color-mix(in srgb,var(--encuesta-acento) 16%,transparent); }
	.encuesta-publica textarea { min-height:112px; resize:vertical; }
	.opciones { display:grid; gap:.5rem; }
	.opciones-dos { grid-template-columns:repeat(2,minmax(0,1fr)); }
	.opcion { display:flex; align-items:center; gap:.7rem; min-height:48px; padding:.65rem .8rem; border:1px solid var(--encuesta-borde); border-radius:.75rem; background:var(--encuesta-superficie); color:var(--encuesta-texto); font-size:.88rem; line-height:1.4; cursor:pointer; transition:border-color .16s ease,background .16s ease; }
	.opcion:hover,.opcion.seleccionada { border-color:color-mix(in srgb,var(--encuesta-acento) 55%,var(--encuesta-borde)); background:color-mix(in srgb,var(--encuesta-acento) 6%,white); }
	.opcion input { flex:none; width:1rem; height:1rem; margin:0; accent-color:var(--encuesta-acento); }
	.opcion span { min-width:0; }
	.respuesta-otra { margin-top:.5rem; }
	.escala { display:flex; flex-wrap:wrap; gap:.45rem; }
	.escala button { min-width:44px; height:44px; border:1px solid var(--encuesta-borde); border-radius:.7rem; background:var(--encuesta-fondo); color:var(--encuesta-texto); font:inherit; font-weight:750; cursor:pointer; transition:.16s ease; }
	.escala button:hover { border-color:var(--encuesta-acento); color:var(--encuesta-acento); }
	.escala button.seleccionada { border-color:var(--encuesta-acento); background:var(--encuesta-acento); color:#fff; box-shadow:var(--shadow-btn,0 2px 6px rgba(1,67,57,.12)); }
	.extremos { display:flex; justify-content:space-between; gap:1rem; margin-top:.5rem; color:var(--encuesta-muted); font-size:.72rem; }
	.identidad { padding:1.25rem; }
	.tarjeta-cabecera { display:flex; align-items:center; gap:.75rem; margin-bottom:1rem; }
	.tarjeta-cabecera h2 { margin:0; font-size:1rem; font-weight:800; }
	.tarjeta-cabecera p { margin:.15rem 0 0; color:var(--encuesta-muted); font-size:.8rem; }
	.identidad label { display:flex; justify-content:space-between; gap:.5rem; margin:.85rem 0 .4rem; color:var(--encuesta-texto); font-size:.8rem; font-weight:700; }
	.identidad label span { color:var(--encuesta-muted); font-size:.72rem; font-weight:500; }
	.privacidad { margin:0; padding:.2rem .25rem; color:var(--encuesta-muted); font-size:.76rem; line-height:1.5; }
	.error { margin:0; padding:.85rem 1rem; border:1px solid #f2c9c4; border-radius:.75rem; background:#fff1ef; color:#a4392f; font-size:.86rem; }
	.formulario-final { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem 0 .25rem; }
	.formulario-final p { margin:0; color:var(--encuesta-muted); font-size:.78rem; line-height:1.45; }
	.enviar { display:inline-flex; flex:none; align-items:center; justify-content:center; gap:.7rem; min-height:48px; padding:.7rem 1.2rem; border:0; border-radius:.75rem; background:var(--encuesta-acento); color:white; box-shadow:var(--shadow-btn,0 2px 6px rgba(1,67,57,.12)); font:inherit; font-size:.9rem; font-weight:750; cursor:pointer; transition:background .16s ease,transform .16s ease; }
	.enviar:hover:not(:disabled) { background:var(--encuesta-acento-hover); transform:translateY(-1px); }
	.enviar:disabled { opacity:.68; cursor:wait; }
	.spinner { width:1rem; height:1rem; border:2px solid rgba(255,255,255,.45); border-top-color:#fff; border-radius:50%; animation:encuesta-spin .7s linear infinite; }
	@keyframes encuesta-spin { to { transform:rotate(360deg); } }
	.cierre { display:grid; justify-items:center; padding:clamp(2rem,8vw,4rem) 1.5rem; text-align:center; }
	.cierre-icono,.estado-tarjeta__icono { display:grid; place-items:center; width:3.2rem; height:3.2rem; margin-bottom:.9rem; border-radius:1rem; background:color-mix(in srgb,var(--encuesta-acento) 11%,white); color:var(--encuesta-acento); }
	.cierre-icono svg { width:1.65rem; height:1.65rem; }
	.cierre-eyebrow { color:var(--encuesta-acento); font-size:.64rem; font-weight:850; letter-spacing:.12em; }
	.cierre h2,.estado-tarjeta h2 { margin:.45rem 0; color:var(--encuesta-tinta); font-size:1.4rem; letter-spacing:-.025em; }
	.cierre p,.estado-tarjeta p { max-width:50ch; margin:.3rem 0 0; color:var(--encuesta-muted); font-size:.9rem; line-height:1.6; }
	.estado-tarjeta { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:190px; padding:2rem; text-align:center; }
	.estado-tarjeta__icono { margin-bottom:.3rem; border-radius:50%; font-size:1.2rem; font-weight:800; }
	.cargando-punto { width:1.25rem; height:1.25rem; margin-bottom:.85rem; border:2px solid var(--encuesta-borde); border-top-color:var(--encuesta-acento); border-radius:50%; animation:encuesta-spin .7s linear infinite; }
	.estado-tarjeta p { margin:0; }
	.pie-pagina { display:flex; justify-content:space-between; gap:1rem; padding:1rem .2rem; color:var(--encuesta-muted); font-size:.72rem; }
	@media (max-width:600px) {
		.barra-marca { min-height:60px; padding-inline:1rem; }
		.barra-marca__logo { max-width:150px; max-height:30px; }
		.barra-marca__nota { display:none; }
		.encuesta-contenedor { width:min(100% - 1.25rem,760px); padding-top:.75rem; }
		.encuesta-hero { margin-bottom:.75rem; padding:1.25rem 1rem; border-radius:1.1rem; }
		.hero-meta { margin-bottom:1rem; }
		.encuesta-hero h1 { font-size:clamp(1.5rem,7vw,2rem); }
		.descripcion { font-size:.86rem; }
		.encuesta-formulario { gap:.65rem; }
		.pregunta,.identidad { padding:1rem; }
		.pregunta-aviso { margin-left:2.45rem; }
		.pregunta legend { gap:.65rem; }
		.pregunta-numero,.seccion-numero { width:1.8rem; height:1.8rem; border-radius:.55rem; }
		.pregunta-titulo { padding-top:.06rem; font-size:.94rem; }
		.ayuda,.micro { margin-left:2.45rem; font-size:.78rem; }
		.opciones-dos { gap:.5rem; }
		.opcion-si-no { justify-content:center; }
		.formulario-final { align-items:stretch; flex-direction:column; gap:.65rem; padding-top:.6rem; }
		.formulario-final p { font-size:.74rem; }
		.enviar { width:100%; }
		.pie-pagina { padding-bottom:1.5rem; }
	}
	@media (max-width:360px) { .barra-marca__tipo { font-size:.76rem; } .barra-marca__contenido { gap:.65rem; } .opciones-dos { grid-template-columns:1fr; } }
	@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation-duration:.01ms !important; transition-duration:.01ms !important; scroll-behavior:auto !important; } }
</style>
