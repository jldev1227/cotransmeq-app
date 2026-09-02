<script lang="ts">
	/**
	 * Envío por correo de las liquidaciones del periodo, desde el canvas de
	 * cierres.
	 *
	 * Cada hoja seleccionada produce UN correo a su tercero con el PDF de su
	 * liquidación adjunto (compuesto aquí con el MISMO `DocumentoHoja` del
	 * preview y renderizado por Chromium en el servidor), más los adjuntos
	 * extra que se suban en el modal. El envío corre en una cola del
	 * servidor con ritmo controlado —Resend limita a 2 req/s— y el progreso
	 * vuelve por socket.
	 *
	 * El estado "ENVIADO y cuándo" sale de la tabla `liquidacion_tercero_envio`
	 * (no del job en memoria): sobrevive a recargas y se difunde al room del
	 * periodo, así que si otro usuario envía, esta tabla se repinta sola.
	 */

	import { onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { CierreHoja } from '$lib/editor/builders/cierres-finales-identidad';
	import type { CierreFinalCompleto } from '$lib/editor/builders/cierres-finales.builder';
	import {
		documentoCierre,
		repartoDeCierre,
		type PropietarioReparto
	} from '$lib/components/liquidaciones-terceros/preview/datos/cierres.doc';
	import { documentoCss } from '$lib/components/liquidaciones-terceros/preview/documento.css';
	import { componerHojasHtml } from '$lib/components/liquidaciones-terceros/preview/componer-hojas';
	import { COP, fmtPlaca } from '$lib/components/liquidaciones-terceros/preview/formato';
	import ChipsCorreos from './ChipsCorreos.svelte';
	import {
		liquidacionesTercerosEnviosAPI,
		type EstadoEnvioCierre,
		type EnvioLoteItem
	} from '$lib/api/liquidaciones-terceros-envios';
	import { enviosLiqQueue, enviosLiqStore } from '$lib/stores/enviosLiquidaciones';
	import { tercerosAPI } from '$lib/api/terceros';
	import { getSocket } from '$lib/socketClient';

	interface Props {
		anio: number;
		mes: number;
		indice: CierreHoja[];
		detalles: Record<string, CierreFinalCompleto>;
		onClose: () => void;
	}

	let { anio, mes, indice, detalles, onClose }: Props = $props();

	const MESES = [
		'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
		'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
	];
	const periodo = `${MESES[mes - 1] ?? mes} ${anio}`;

	const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const esCorreo = (c: string) => EMAIL_RE.test(c.trim());

	/** Trocea una casilla en direcciones sueltas, sin validar. */
	function partirCorreos(v: string): string[] {
		return v.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
	}

	/**
	 * Destinatarios de una fila: uno, o varios. El primero va en "Para" y los
	 * demás en copia (CC), así el tercero sigue siendo el destinatario
	 * principal del correo que lleva SU liquidación.
	 *
	 * Devuelve [] si no hay ninguna o alguna es inválida — la fila queda
	 * marcada como "sin correo válido" y no se envía.
	 */
	function listaCorreos(partes: string[]): string[] {
		if (partes.length === 0 || !partes.every(esCorreo)) return [];
		const vistos = new Set<string>();
		return partes.filter((p) => {
			const k = p.toLowerCase();
			if (vistos.has(k)) return false;
			vistos.add(k);
			return true;
		});
	}
	/** Tope de los adjuntos extra, alineado con el backend. */
	const MAX_ADJUNTOS = 15_000_000;

	// ── Estado de envíos previos (la constancia, desde la BD) ──
	let estados = $state<Record<string, EstadoEnvioCierre>>({});
	let proveedor = $state<string | null>(null);
	let cargandoEstados = $state(true);
	/**
	 * Por qué falló la última consulta de estado, si falló.
	 *
	 * `proveedor === null` NO significa «el servidor no tiene correo»: es
	 * también el valor inicial y el que queda cuando la petición nunca llegó
	 * (backend caído, sesión vencida, 500). Sin distinguir los dos casos, el
	 * modal acusaba de «no hay proveedor configurado» un fallo que era de red.
	 */
	let errorConsulta = $state<string | null>(null);
	/** El servidor CONFIRMÓ que no puede enviar correo. */
	const sinProveedor = $derived(!cargandoEstados && errorConsulta === null && proveedor === null);

	// ── Filas ──
	/** Correos confirmados (chips) por fila; nacen del tercero y se corrigen aquí. */
	let correos = $state<Record<string, string>>({});
	/** Lo que se está escribiendo en cada casilla, aún sin volverse chip. */
	let borradores = $state<Record<string, string>>({});
	let seleccion = $state<Set<string>>(new Set());
	/** Actualizar el correo del TERCERO cuando se corrige en la tabla. */
	let persistirCorreos = $state(true);

	// ── Mensaje ──
	let asunto = $state('Liquidación {PLACA} — {PERIODO} · Cotransmeq');
	let mensaje = $state(
		'Reciba un cordial saludo.\n\n' +
			'Adjunto encontrará la liquidación de su vehículo correspondiente al periodo indicado, ' +
			'junto con los documentos de soporte.\n\n' +
			'Cualquier inquietud con gusto será atendida respondiendo a este correo.'
	);

	// ── Adjuntos extra ──
	let adjuntos = $state<Array<{ filename: string; contentType: string; base64: string; size: number }>>([]);
	const totalAdjuntos = $derived(adjuntos.reduce((s, a) => s + a.size, 0));

	// ── Modo prueba ──
	let esPrueba = $state(false);
	let destinoPrueba = $state('1227jldev@gmail.com');

	// ── Lanzamiento ──
	let componiendo = $state(false);
	let progresoComposicion = $state('');

	const job = $derived($enviosLiqStore);
	const enCurso = $derived(job != null && (job.status === 'queued' || job.status === 'running'));

	/**
	 * Un DESTINATARIO del lote. No es lo mismo que una hoja.
	 *
	 * Una placa de un solo propietario produce un destinatario —su tercero—,
	 * pero una placa con varios produce UNO POR COPROPIETARIO: cada uno cobra
	 * su parte y necesita un correo con SU valor a facturar. Cuando la hoja es
	 * multi, el correo único al tercero de la hoja NO se manda: sería un
	 * segundo correo de la misma placa a alguien que ya está en la lista.
	 *
	 * El adjunto es el mismo PDF de la placa para todos: el documento es de la
	 * placa, no de la persona, y recortarlo por propietario daría un papel que
	 * no cuadra con el que archiva contabilidad.
	 */
	interface Destino {
		/** `hojaId` o `hojaId::propietarioId`. Clave de correos y selección. */
		key: string;
		hoja: CierreHoja;
		propietarioId: string | null;
		nombre: string;
		/** Ficha del catálogo donde vive el correo por defecto. */
		terceroId: string | null;
		correoDefecto: string;
		/** Su parte del reparto. `null` en hojas de un solo propietario. */
		facturar: number | null;
		porcentaje: number | null;
		/** Pago interno por concepto (abono a crédito): no cobra nadie. */
		esConcepto: boolean;
		nota: string | null;
	}

	const claveDestino = (hojaId: string, propId: string | null) =>
		propId ? `${hojaId}::${propId}` : hojaId;

	/**
	 * Los destinatarios del periodo, en el orden de las pestañas del canvas y,
	 * dentro de cada placa, en el orden de la cascada.
	 *
	 * Una hoja multi cuyo detalle aún no ha llegado se queda como un solo
	 * destinatario provisional: no se puede saber cuántos propietarios tiene
	 * hasta cargarla, y esa fila ya sale marcada como «sin detalle».
	 */
	const destinos = $derived.by((): Destino[] => {
		const out: Destino[] = [];
		for (const h of indice) {
			const detalle = detalles[h.id];
			const reparto = detalle ? repartoDeCierre(detalle) : null;
			if (reparto?.esMulti) {
				for (const p of reparto.propietarios) {
					out.push({
						key: claveDestino(h.id, p.id),
						hoja: h,
						propietarioId: p.id,
						nombre: p.nombre || '— sin nombre —',
						terceroId: p.tercero_id,
						correoDefecto: p.correo ?? '',
						facturar: p.facturar,
						porcentaje: p.porcentaje,
						esConcepto: !p.aplica_retenciones,
						nota: p.nota
					});
				}
			} else {
				out.push({
					key: h.id,
					hoja: h,
					propietarioId: null,
					nombre: h.tercero_nombre || '— sin tercero —',
					terceroId: h.tercero_id,
					correoDefecto: h.tercero_correo ?? '',
					facturar: null,
					porcentaje: null,
					esConcepto: false,
					nota: null
				});
			}
		}
		return out;
	});

	/** Filas del modal: un destinatario más el estado de su casilla de correo. */
	const filas = $derived(
		destinos.map((d) => {
			// Lo escrito y sin confirmar cuenta como un destinatario más: nadie
			// debería tener que pulsar coma para que su correo entre en el envío.
			const pendiente = (borradores[d.key] ?? '').trim();
			const crudos = [...partirCorreos(correos[d.key] ?? ''), ...(pendiente ? [pendiente] : [])];
			const destinatarios = listaCorreos(crudos);
			return {
				destino: d,
				hoja: d.hoja,
				crudos,
				destinatarios,
				/** Los que van en copia (todos menos el primero). */
				copias: destinatarios.slice(1),
				correoValido: destinatarios.length > 0,
				tieneDetalle: !!detalles[d.hoja.id],
				estado: estados[d.hoja.id] ?? null,
				/**
				 * Cuándo se le envió A ESTA DIRECCIÓN, si se le envió.
				 *
				 * Se mira el destinatario y no la hoja porque una placa
				 * multi-propietario manda N correos: con el agregado de la hoja,
				 * enviarle a uno marcaba como enviados a todos. Y si el correo se
				 * corrige, la fila vuelve a «—»: a esa dirección nueva todavía no
				 * ha salido nada, que es la verdad.
				 */
				enviadoA:
					destinatarios.length > 0
						? ((estados[d.hoja.id]?.por_destinatario ?? {})[
								destinatarios[0].toLowerCase()
							] ?? null)
						: null
			};
		})
	);

	/** Cuántas placas del periodo se liquidan a varios propietarios. */
	const placasMulti = $derived(
		new Set(destinos.filter((d) => d.propietarioId).map((d) => d.hoja.id)).size
	);

	const seleccionadas = $derived(filas.filter((f) => seleccion.has(f.destino.key)));
	const sinCorreo = $derived(filas.filter((f) => !f.correoValido).length);
	const enviables = $derived(
		seleccionadas.filter((f) => f.tieneDetalle && (esPrueba ? true : f.correoValido))
	);
	const noEnviables = $derived(seleccionadas.length - enviables.length);

	/**
	 * Claves ya sembradas con su correo por defecto.
	 *
	 * No es `$state` a propósito: es memoria del efecto, no algo que se pinte.
	 * Sin ella, cada vez que llega el detalle de otra hoja el efecto volvería a
	 * escribir TODAS las casillas y pisaría lo que el usuario ya corrigió.
	 */
	let sembrados = new Set<string>();

	/**
	 * Siembra los destinatarios nuevos con el correo de su ficha.
	 *
	 * Va en un efecto y no en `onMount` porque los detalles llegan por lotes:
	 * una placa multi-propietario no se sabe que lo es hasta que su detalle
	 * carga, y hasta entonces figura como un solo destinatario. Cuando llega,
	 * se despliega en N y esos N hay que sembrarlos.
	 */
	$effect(() => {
		const nuevos = destinos.filter((d) => !sembrados.has(d.key));
		if (nuevos.length === 0) return;
		const c = { ...correos };
		const b = { ...borradores };
		const sel = new Set(seleccion);
		for (const d of nuevos) {
			sembrados.add(d.key);
			// Una sola dirección arranca como texto editable; varias, como chips.
			const partes = partirCorreos(d.correoDefecto);
			c[d.key] = partes.length > 1 ? partes.join(', ') : '';
			b[d.key] = partes.length > 1 ? '' : (partes[0] ?? '');
			// Preselección: destinatario cargado, con correo válido y que
			// efectivamente cobra. Un pago interno por concepto nace SIN marcar:
			// un abono a crédito no es alguien a quien se le escriba, aunque
			// pueda marcarse a mano si alguna vez hay que notificarlo.
			if (detalles[d.hoja.id] && listaCorreos(partes).length > 0 && !d.esConcepto) {
				sel.add(d.key);
			}
		}
		correos = c;
		borradores = b;
		seleccion = sel;
	});

	onMount(() => {
		void cargarEstados();

		// Cambios de estado difundidos al room del periodo (este mismo canvas
		// está unido a él por la sesión de hoja): repintan la columna ENVIADO
		// aunque el envío lo haya lanzado otro usuario.
		const socket = getSocket();
		socket?.on('envio-liquidacion:actualizado', onEnvioActualizado);
		return () => {
			socket?.off('envio-liquidacion:actualizado', onEnvioActualizado);
		};
	});

	function onEnvioActualizado(d: any) {
		if (!d?.cierre_id || d.anio !== anio || d.mes !== mes) return;
		// Releer el agregado sería otra petición por evento; con la forma del
		// payload basta para actualizar la fila.
		const previo = estados[d.cierre_id] ?? {
			cierre_id: d.cierre_id,
			ultimo_enviado: null,
			ultimo_error: null,
			enviados: 0,
			pruebas: 0,
			por_destinatario: {}
		};
		if (d.estado === 'ENVIADO') {
			estados = {
				...estados,
				[d.cierre_id]: d.es_prueba
					? { ...previo, pruebas: previo.pruebas + 1 }
					: {
							...previo,
							enviados: previo.enviados + 1,
							ultimo_enviado: { email_destino: d.email_destino, enviado_at: d.enviado_at },
							ultimo_error: null,
							// Sin esto la fila del copropietario al que se le acaba de
							// enviar seguiría en «—» hasta recargar el modal.
							por_destinatario: {
								...(previo.por_destinatario ?? {}),
								[String(d.email_destino ?? '').trim().toLowerCase()]: {
									enviado_at: d.enviado_at
								}
							}
						}
			};
		} else if (d.estado === 'ERROR' && !d.es_prueba) {
			estados = {
				...estados,
				[d.cierre_id]: previo.ultimo_enviado
					? previo
					: {
							...previo,
							ultimo_error: {
								email_destino: d.email_destino,
								error: d.error ?? null,
								created_at: new Date().toISOString()
							}
						}
			};
		}
	}

	async function cargarEstados() {
		cargandoEstados = true;
		try {
			const r = await liquidacionesTercerosEnviosAPI.estadoPeriodo(anio, mes);
			estados = r.estados;
			proveedor = r.proveedor;
			errorConsulta = null;
		} catch (e: any) {
			const detalle: string = e?.response?.data?.error || e?.message || 'error desconocido';
			errorConsulta = detalle;
			toast.error('No se pudo consultar el historial de envíos', {
				description: detalle
			});
		} finally {
			cargandoEstados = false;
		}
	}

	function alternar(key: string) {
		const s = new Set(seleccion);
		if (s.has(key)) s.delete(key);
		else s.add(key);
		seleccion = s;
	}

	/**
	 * «Seleccionar todos»: los que cobran.
	 *
	 * Deja fuera los pagos internos por concepto, igual que la siembra: si un
	 * abono a crédito entrara aquí, marcar todo mandaría un correo a un banco
	 * cada mes sin que nadie lo pidiera.
	 */
	function alternarTodas(marcar: boolean) {
		seleccion = marcar
			? new Set(
					filas.filter((f) => f.tieneDetalle && !f.destino.esConcepto).map((f) => f.destino.key)
				)
			: new Set();
	}

	/** Cuántos entrarían con «seleccionar todos», para el estado del checkbox. */
	const seleccionables = $derived(
		filas.filter((f) => f.tieneDetalle && !f.destino.esConcepto).length
	);

	async function agregarAdjuntos(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		for (const f of files) {
			if (totalAdjuntos + f.size > MAX_ADJUNTOS) {
				toast.error(`No cabe "${f.name}": los adjuntos extra no pueden superar 15 MB en total.`);
				continue;
			}
			const base64 = await new Promise<string>((resolve, reject) => {
				const lector = new FileReader();
				lector.onloadend = () => resolve(String(lector.result).split(',')[1] ?? '');
				lector.onerror = reject;
				lector.readAsDataURL(f);
			});
			adjuntos = [
				...adjuntos,
				{ filename: f.name, contentType: f.type || 'application/octet-stream', base64, size: f.size }
			];
		}
	}

	function quitarAdjunto(i: number) {
		adjuntos = adjuntos.filter((_, idx) => idx !== i);
	}

	function fmtBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
		return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	}

	function fmtFecha(iso: string): string {
		try {
			return new Date(iso).toLocaleString('es-CO', {
				day: '2-digit',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}

	/**
	 * Las líneas de la tarjeta del correo, bajo Vehículo y Periodo.
	 *
	 * En una placa de varios propietarios el destinatario abre el correo antes
	 * que el PDF, y lo que busca es cuánto le toca a ÉL —no el total de la
	 * placa, que es de todos—. Por eso va su valor a facturar y su
	 * participación, y va ya formateado: la cifra tiene que ser exactamente la
	 * de su card en el PDF adjunto, y recalcularla en el servidor sería una
	 * segunda aritmética que acabaría discrepando del papel.
	 *
	 * En una hoja de un solo propietario no hay reparto que contar y la
	 * tarjeta se queda como estaba.
	 */
	function resumenDe(d: Destino): Array<{ etiqueta: string; valor: string }> | undefined {
		if (d.facturar == null) return undefined;
		const lineas = [
			{
				// Un pago interno no se factura: se abona. Llamarlo «valor a
				// facturar» en el correo del banco sería decirle otra cosa.
				etiqueta: d.esConcepto ? 'Valor proporcional' : 'Valor a facturar',
				valor: COP(d.facturar)
			}
		];
		if (d.porcentaje != null) {
			lineas.push({ etiqueta: 'Participación', valor: `${d.porcentaje.toFixed(2)}%` });
		}
		return lineas;
	}

	async function enviar() {
		if (componiendo || enCurso) return;
		if (enviables.length === 0) {
			toast.error('No hay hojas enviables seleccionadas.');
			return;
		}
		if (esPrueba && !EMAIL_RE.test(destinoPrueba.trim())) {
			toast.error('El correo de prueba no es válido.');
			return;
		}

		componiendo = true;
		progresoComposicion = `Componiendo 0 de ${enviables.length} hojas…`;
		try {
			// El documento se compone del detalle EN MEMORIA: lo que se envía es
			// lo que hay en pantalla ahora mismo, igual que el export ZIP.
			//
			// Uno por PLACA, no por destinatario: los N correos de una placa
			// multi-propietario llevan el MISMO PDF, y componerlo una vez por
			// copropietario sería pasar la misma hoja por Chromium N veces.
			const hojasUnicas = [...new Map(enviables.map((f) => [f.hoja.id, f.hoja])).values()];
			const hojas = hojasUnicas.map((h) => ({
				nombreArchivo: `LIQUIDACION ${fmtPlaca(h.placa)} ${
					h.tercero_nombre || 'SIN TERCERO'
				} ${MESES[mes - 1]} ${anio}`,
				documento: documentoCierre({ cierre: detalles[h.id], mes, anio })
			}));
			const nombrePorHoja = new Map(hojasUnicas.map((h, i) => [h.id, hojas[i].nombreArchivo]));

			const { documentos, fallidas } = await componerHojasHtml('cierres', hojas, {
				onProgreso: (hechas, total) => {
					progresoComposicion = `Componiendo ${hechas} de ${total} hojas…`;
				}
			});
			if (fallidas.length > 0) {
				toast.warning(`${fallidas.length} hoja(s) no se pudieron componer y quedaron fuera.`);
			}
			if (documentos.length === 0) {
				toast.error('No se pudo componer ninguna hoja.');
				return;
			}

			const porNombre = new Map(documentos.map((d) => [d.filename, d.html]));
			const items: EnvioLoteItem[] = [];
			for (const f of enviables) {
				const filename = nombrePorHoja.get(f.hoja.id);
				const html = filename ? porNombre.get(filename) : undefined;
				if (!filename || !html) continue;
				const d = f.destino;
				items.push({
					cierre_id: f.hoja.id,
					// El tercero de la CONSTANCIA es el destinatario real: en una
					// placa multi hay una fila de envío por copropietario, y
					// registrarlas todas contra el tercero de la hoja borraría a
					// quién se le escribió de verdad.
					tercero_id: d.terceroId,
					placa: f.hoja.placa,
					// El saludo del correo: quien cobra, no el titular de la hoja.
					tercero_nombre: d.nombre || 'SIN TERCERO',
					// En modo prueba una fila puede ir sin correo válido: el destino
					// real lo pone el backend con `destino_prueba`.
					to: f.destinatarios[0] ?? f.crudos[0] ?? '',
					cc: f.copias.length > 0 ? f.copias : undefined,
					filename,
					html,
					resumen: resumenDe(d)
				});
			}

			const r = await enviosLiqQueue.start({
				anio,
				mes,
				css: documentoCss(1, true),
				asunto,
				mensaje,
				es_prueba: esPrueba,
				destino_prueba: esPrueba ? destinoPrueba.trim() : undefined,
				items,
				adjuntos_extra: adjuntos.map(({ filename, contentType, base64 }) => ({
					filename,
					contentType,
					base64
				}))
			});

			if (r.status === 'locked') {
				toast.warning(`${(r as any).locked_by?.userName ?? 'Otro usuario'} ya está enviando este periodo.`);
				return;
			}

			// Correos corregidos: se guardan en el tercero DESPUÉS de encolar,
			// para que un fallo aquí no impida el envío. Solo en envíos reales:
			// una prueba no debe tocar los datos maestros.
			if (persistirCorreos && !esPrueba) void guardarCorreosCorregidos();
		} catch (e: any) {
			toast.error('No se pudo lanzar el envío', { description: e?.message || '' });
		} finally {
			componiendo = false;
			progresoComposicion = '';
		}
	}

	async function guardarCorreosCorregidos() {
		// Solo direcciones sueltas: la ficha del tercero guarda UN correo (el
		// backend lo valida con `z.string().email()`), así que las filas con
		// copias se quedan con su lista solo para este envío.
		//
		// La ficha es la del DESTINATARIO —el copropietario en las placas
		// multi—, no la del tercero de la hoja: corregir el correo de María no
		// puede acabar escribiéndose en la ficha de Juan.
		const cambios = seleccionadas.filter(
			(f) =>
				f.destino.terceroId &&
				f.destinatarios.length === 1 &&
				f.destinatarios[0] !== f.destino.correoDefecto.trim()
		);
		// Un tercero puede aparecer en varias placas del lote: con una vez basta.
		const porTercero = new Map<string, string>();
		for (const f of cambios) porTercero.set(f.destino.terceroId!, f.destinatarios[0]);
		for (const [terceroId, correo] of porTercero) {
			try {
				await tercerosAPI.actualizar(terceroId, { correo } as any);
			} catch (e: any) {
				toast.warning(`No se pudo actualizar el correo del tercero`, {
					description: e?.message || ''
				});
			}
		}
		if (porTercero.size > 0) {
			toast.success(`${porTercero.size} correo(s) actualizados en la ficha del tercero.`);
		}
	}

	function cancelarJob() {
		if (job?.jobId) void enviosLiqQueue.cancel(job.jobId);
	}

	function cerrarResultado() {
		enviosLiqQueue.dismiss();
		void cargarEstados();
	}

	onDestroy(() => {
		/* El job sigue en el servidor: cerrar el modal no cancela nada. */
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && !enCurso && !componiendo) onClose();
	}}
/>

<div class="env-backdrop">
	<div class="env" role="dialog" aria-modal="true" aria-label="Enviar liquidaciones por correo" tabindex="-1">
		<header class="env-head">
			<div>
				<h2>Enviar liquidaciones por correo</h2>
				<p class="env-sub">
					{periodo} · cada destinatario recibe el PDF de la liquidación de su placa
					{#if placasMulti > 0}
						· <strong>{placasMulti}</strong> placa(s) con varios propietarios se despliegan en
						un correo por propietario, con su valor a facturar
					{/if}
				</p>
			</div>
			<button class="env-x" onclick={onClose} disabled={enCurso || componiendo} aria-label="Cerrar">×</button>
		</header>

		{#if job && (enCurso || job.status === 'complete' || job.status === 'cancelled' || job.status === 'error' || job.status === 'locked')}
			<!-- ── Progreso / resultado ── -->
			<section class="env-body">
				{#if job.status === 'locked'}
					<div class="env-aviso env-aviso-ambar">
						<strong>{job.lockedBy?.userName ?? 'Otro usuario'}</strong> ya está enviando este
						periodo. El bloqueo es por mes: cuando termine podrás lanzar el tuyo.
					</div>
				{:else}
					<p class="env-paso">{job.currentStep}</p>
					<div class="env-barra">
						<div class="env-barra-fill" style="width: {job.progress}%"></div>
					</div>
					<p class="env-pct">{job.processed} de {job.total} · {job.progress}%</p>

					{#if job.resultados.length > 0}
						<ul class="env-resultados">
							{#each job.resultados as r (r.cierre_id + r.to + (r.enviado_at ?? ''))}
								<li class={r.estado === 'ENVIADO' ? 'ok' : 'err'}>
									<span class="env-res-placa">{fmtPlaca(r.placa)}</span>
									<span class="env-res-to">{r.to}</span>
									{#if r.estado === 'ENVIADO'}
										<span class="env-chip env-chip-ok">Enviado</span>
									{:else}
										<span class="env-chip env-chip-err" title={r.error}>Error</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#if job.status === 'error'}
						<div class="env-aviso env-aviso-rojo">{job.error}</div>
					{/if}
					{#if job.status === 'cancelled'}
						<div class="env-aviso env-aviso-ambar">
							Cancelado. Los correos ya despachados no se pueden retirar; quedaron registrados.
						</div>
					{/if}
				{/if}
			</section>

			<footer class="env-foot">
				{#if enCurso}
					<span class="env-hint">Al cancelar se detiene tras el envío en curso.</span>
					<button class="env-btn-ghost" onclick={cancelarJob}>Cancelar envíos</button>
				{:else}
					<button class="env-btn-ghost" onclick={cerrarResultado}>Preparar otro envío</button>
					<button class="env-btn-primary" onclick={onClose}>Cerrar</button>
				{/if}
			</footer>
		{:else}
			<!-- ── Formulario ── -->
			<section class="env-body">
				{#if errorConsulta}
					<div class="env-aviso env-aviso-ambar">
						No se pudo consultar el estado del servicio de correo ({errorConsulta}). Puede ser
						que el servidor esté caído o la sesión haya vencido; el envío se puede intentar
						igual y el resultado quedará en la constancia.
						<button class="env-aviso-link" onclick={cargarEstados}>Reintentar</button>
					</div>
				{:else if sinProveedor}
					<div class="env-aviso env-aviso-rojo">
						No hay proveedor de correo configurado en el servidor. Configura
						CONTABILIDAD_SMTP_USER/PASSWORD o RESEND_API_KEY.
					</div>
				{:else if proveedor === 'resend' || proveedor === 'smtp'}
					<div class="env-aviso env-aviso-info">
						Los correos salen a nombre de <strong>Contabilidad Cotransmeq S.A.S.</strong> y las
						respuestas llegan a <strong>contabilidadtransmeraldasas@gmail.com</strong> (que además
						recibe copia de constancia de cada envío real).
					</div>
				{:else if proveedor === 'smtp-contabilidad'}
					<div class="env-aviso env-aviso-info">
						Enviando directamente desde <strong>contabilidadtransmeraldasas@gmail.com</strong>.
					</div>
				{/if}

				<h3 class="env-h3">1 · Destinatarios</h3>
				<div class="env-acciones-mini">
					<label class="env-check">
						<input
							type="checkbox"
							checked={seleccionables > 0 && seleccionadas.length >= seleccionables}
							onchange={(e) => alternarTodas(e.currentTarget.checked)}
						/>
						<span>Seleccionar todos los cargados</span>
					</label>
					<span class="env-nota">
						{seleccionadas.length} destinatario(s) · {new Set(
							seleccionadas.map((f) => f.hoja.id)
						).size} placa(s)
						{#if sinCorreo > 0}
							· <strong class="env-rojo">{sinCorreo} sin correo válido</strong>
						{/if}
					</span>
				</div>
				<div class="env-acciones-mini">
					<span class="env-nota">
						Para enviar <strong>con copia</strong>, separa los correos con coma: el primero va en
						«Para» y los demás en copia (CC). El correo por defecto es el de la ficha del
						tercero; corregirlo aquí lo actualiza en la ficha si marcas la casilla de abajo.
					</span>
				</div>

				<ul class="env-lista">
					{#each filas as f (f.destino.key)}
						<li
							class:sin-detalle={!f.tieneDetalle}
							class:es-copro={f.destino.propietarioId != null}
							class:es-concepto={f.destino.esConcepto}
						>
							<input
								type="checkbox"
								checked={seleccion.has(f.destino.key)}
								disabled={!f.tieneDetalle}
								title={f.tieneDetalle ? '' : 'La hoja todavía no está cargada en el canvas.'}
								onchange={() => alternar(f.destino.key)}
							/>
							<span class="env-placa">{fmtPlaca(f.hoja.placa)}</span>
							<span class="env-tercero" title={f.destino.nota || f.destino.nombre}>
								{f.destino.nombre}
								{#if f.destino.esConcepto}
									<span class="env-chip env-chip-concepto" title="Pago interno: no cobra una persona">
										concepto
									</span>
								{/if}
								{#if f.destino.terceroId == null && f.destino.propietarioId != null}
									<span class="env-chip env-chip-aviso" title="No está en el catálogo de terceros: no hay correo por defecto ni dónde guardar el que escribas">
										sin ficha
									</span>
								{/if}
							</span>
							<!-- El valor que va en SU correo. Es el preview: se ve antes de
							     enviar y sale de la misma cuenta que el PDF adjunto. -->
							<span class="env-facturar">
								{#if f.destino.facturar != null}
									<strong>{COP(f.destino.facturar)}</strong>
									{#if f.destino.porcentaje != null}
										<em>{f.destino.porcentaje.toFixed(2)}%</em>
									{/if}
								{/if}
							</span>
							<span class="env-correo-celda">
								<!-- Bindings con getter/setter: los registros los llena el
								     efecto de siembra, y `bind:` directo a una entrada aún
								     inexistente revienta con `props_invalid_value`. -->
								<ChipsCorreos
									bind:value={() => correos[f.destino.key] ?? '',
									(v) => (correos[f.destino.key] = v)}
									bind:borrador={() => borradores[f.destino.key] ?? '',
									(v) => (borradores[f.destino.key] = v)}
									esValido={esCorreo}
									invalido={f.crudos.length > 0 && !f.correoValido}
									placeholder="sin correo — escribe uno (coma para añadir copia)"
								/>
								{#if f.copias.length > 0}
									<span
										class="env-chip env-chip-cc"
										title={`Para: ${f.destinatarios[0]} · Copia: ${f.copias.join(', ')}`}
									>
										+{f.copias.length} CC
									</span>
								{/if}
							</span>
							{#if f.enviadoA}
								<span class="env-chip env-chip-ok" title={`Enviado a ${f.destinatarios[0]}`}>
									✓ {fmtFecha(f.enviadoA.enviado_at)}
								</span>
							{:else if f.estado?.ultimo_enviado && !f.estado.por_destinatario}
								<!-- Backend anterior a `por_destinatario`: solo hay el
								     agregado de la hoja, que es lo que se puede decir. -->
								<span
									class="env-chip env-chip-ok"
									title={`Enviado a ${f.estado.ultimo_enviado.email_destino}${f.estado.enviados > 1 ? ` · ${f.estado.enviados} envíos` : ''}`}
								>
									✓ {fmtFecha(f.estado.ultimo_enviado.enviado_at)}
								</span>
							{:else if f.estado?.ultimo_error}
								<span class="env-chip env-chip-err" title={f.estado.ultimo_error.error ?? ''}>
									Error
								</span>
							{:else if f.estado && f.estado.pruebas > 0}
								<span class="env-chip env-chip-neutro" title="Solo envíos de prueba">Prueba</span>
							{:else}
								<span class="env-chip env-chip-vacio">—</span>
							{/if}
						</li>
					{/each}
				</ul>

				<label class="env-check env-persistir">
					<input type="checkbox" bind:checked={persistirCorreos} />
					<span>
						Guardar los correos corregidos en la ficha del tercero (solo en envíos reales y
						cuando la fila lleva una sola dirección)
					</span>
				</label>

				<h3 class="env-h3">2 · Mensaje</h3>
				<label class="env-campo">
					<span>Asunto <em>(admite {'{PLACA}'}, {'{TERCERO}'} y {'{PERIODO}'})</em></span>
					<input type="text" bind:value={asunto} maxlength="300" />
				</label>
				<label class="env-campo">
					<span>Cuerpo del mensaje</span>
					<textarea rows="5" bind:value={mensaje} maxlength="5000"></textarea>
				</label>

				<h3 class="env-h3">3 · Adjuntos adicionales <em>(van en todos los correos del lote)</em></h3>
				<div class="env-adjuntos">
					<label class="env-btn-ghost env-btn-file">
						+ Añadir archivos
						<input type="file" multiple onchange={agregarAdjuntos} hidden />
					</label>
					{#if adjuntos.length > 0}
						<ul class="env-adj-lista">
							{#each adjuntos as a, i (a.filename + i)}
								<li>
									<span class="env-adj-nombre" title={a.filename}>📎 {a.filename}</span>
									<span class="env-adj-size">{fmtBytes(a.size)}</span>
									<button class="env-adj-x" onclick={() => quitarAdjunto(i)} aria-label="Quitar">×</button>
								</li>
							{/each}
						</ul>
						<p class="env-nota">{fmtBytes(totalAdjuntos)} de 15 MB</p>
					{:else}
						<p class="env-nota">Sin adjuntos extra. El PDF de la liquidación va siempre.</p>
					{/if}
				</div>

				<h3 class="env-h3">4 · Modo prueba</h3>
				<div class="env-prueba" class:activa={esPrueba}>
					<label class="env-check">
						<input type="checkbox" bind:checked={esPrueba} />
						<span>
							<strong>Enviar como prueba:</strong> todos los correos van a un único destino, con
							asunto [PRUEBA], sin copia a contabilidad y sin marcar las hojas como enviadas.
						</span>
					</label>
					{#if esPrueba}
						<input
							class="env-correo env-correo-prueba"
							type="email"
							placeholder="correo de prueba"
							bind:value={destinoPrueba}
						/>
					{/if}
				</div>
			</section>

			<footer class="env-foot">
				<span class="env-hint">
					{enviables.length} correo(s) listos
					{#if noEnviables > 0}
						· {noEnviables} seleccionada(s) sin correo válido quedarán fuera
					{/if}
				</span>
				<button
					class="env-btn-primary"
					disabled={componiendo || enviables.length === 0 || sinProveedor}
					onclick={enviar}
				>
					{componiendo ? progresoComposicion : esPrueba ? 'Enviar PRUEBA' : `Enviar ${enviables.length} correo(s)`}
				</button>
			</footer>
		{/if}
	</div>
</div>

<style>
	.env-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.55);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 24px;
	}
	.env {
		width: min(860px, 100%);
		max-height: 92vh;
		display: flex;
		flex-direction: column;
		background: #fff;
		border-radius: 14px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
		overflow: hidden;
	}
	.env-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 22px 14px;
		border-bottom: 1px solid #e2e8f0;
	}
	.env-head h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 800;
		color: #0f172a;
	}
	.env-sub {
		margin: 4px 0 0;
		font-size: 12.5px;
		color: #64748b;
	}
	.env-x {
		border: none;
		background: none;
		font-size: 22px;
		line-height: 1;
		color: #64748b;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: 6px;
	}
	.env-x:hover:not(:disabled) {
		background: #f1f5f9;
		color: #0f172a;
	}
	.env-body {
		padding: 16px 22px;
		overflow-y: auto;
		flex: 1 1 auto;
		min-height: 0;
	}
	.env-h3 {
		margin: 18px 0 8px;
		font-size: 13px;
		font-weight: 800;
		color: #334155;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.env-h3:first-of-type {
		margin-top: 4px;
	}
	.env-h3 em {
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: #94a3b8;
		font-style: normal;
	}
	.env-aviso {
		border-radius: 10px;
		padding: 10px 14px;
		font-size: 13px;
		line-height: 1.55;
		margin-bottom: 12px;
	}
	.env-aviso-info {
		background: #f0fdf4;
		color: #166534;
	}
	.env-aviso-ambar {
		background: #fefce8;
		color: #713f12;
	}
	.env-aviso-rojo {
		background: #fef2f2;
		color: #991b1b;
	}
	.env-aviso-link {
		background: none;
		border: none;
		padding: 0;
		margin-left: 6px;
		font: inherit;
		color: inherit;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
	}
	.env-acciones-mini {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 6px;
	}
	.env-check {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 13px;
		color: #334155;
		cursor: pointer;
	}
	.env-check input {
		margin-top: 2px;
	}
	.env-nota {
		font-size: 12px;
		color: #64748b;
	}
	.env-rojo {
		color: #b91c1c;
	}
	.env-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		max-height: 290px;
		overflow-y: auto;
	}
	.env-lista li {
		display: grid;
		/* La columna del valor a facturar va ANTES del correo: es lo que se
		   comprueba de un vistazo antes de mandar, y al final de la fila
		   quedaba fuera del campo visual con la casilla de correo abierta. */
		grid-template-columns: 20px 84px minmax(110px, 0.9fr) 118px minmax(220px, 1.6fr) auto;
		align-items: center;
		gap: 10px;
		padding: 7px 12px;
		border-bottom: 1px solid #f1f5f9;
		font-size: 13px;
	}
	/* Fila de copropietario: sangrada bajo su placa, para que se lea como
	   "esta placa se reparte entre estos" y no como placas distintas. */
	.env-lista li.es-copro .env-placa {
		font-weight: 500;
		color: #94a3b8;
		font-size: 12px;
	}
	.env-lista li.es-copro {
		background: #f8fafc;
	}
	.env-lista li.es-concepto {
		background: var(--tpdf-verde-claro-bg, #f0fdf4);
	}
	.env-facturar {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: #166534;
	}
	.env-facturar strong {
		font-weight: 700;
		font-size: 12.5px;
	}
	.env-facturar em {
		display: block;
		font-style: normal;
		font-size: 10.5px;
		color: #64748b;
	}
	.env-chip-concepto {
		background: #dcfce7;
		color: #15803d;
	}
	.env-chip-aviso {
		background: #ffedd5;
		color: #b45309;
	}
	.env-lista li:last-child {
		border-bottom: none;
	}
	.env-lista li.sin-detalle {
		opacity: 0.55;
	}
	.env-placa {
		font-weight: 800;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
	}
	.env-tercero {
		color: #475569;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.env-correo-celda {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.env-correo-celda > :global(.chips) {
		flex: 1;
		min-width: 0;
	}
	.env-chip-cc {
		background: #e0e7ff;
		color: #3730a3;
	}
	.env-correo {
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 5px 9px;
		font-size: 12.5px;
		color: #0f172a;
		width: 100%;
	}
	.env-correo:focus {
		outline: 2px solid #ea580c55;
		border-color: #ea580c;
	}
	.env-chip {
		font-size: 11px;
		font-weight: 700;
		border-radius: 999px;
		padding: 3px 9px;
		white-space: nowrap;
	}
	.env-chip-ok {
		background: #dcfce7;
		color: #166534;
	}
	.env-chip-err {
		background: #fee2e2;
		color: #991b1b;
	}
	.env-chip-neutro {
		background: #e0e7ff;
		color: #3730a3;
	}
	.env-chip-vacio {
		color: #cbd5e1;
	}
	.env-persistir {
		margin-top: 8px;
	}
	.env-campo {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 10px;
	}
	.env-campo span {
		font-size: 12.5px;
		color: #475569;
		font-weight: 600;
	}
	.env-campo em {
		font-weight: 400;
		color: #94a3b8;
		font-style: normal;
	}
	.env-campo input,
	.env-campo textarea {
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 13px;
		font-family: inherit;
		color: #0f172a;
		resize: vertical;
	}
	.env-campo input:focus,
	.env-campo textarea:focus {
		outline: 2px solid #ea580c55;
		border-color: #ea580c;
	}
	.env-adjuntos {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.env-btn-file {
		align-self: flex-start;
		cursor: pointer;
	}
	.env-adj-lista {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.env-adj-lista li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12.5px;
		background: #f8fafc;
		border-radius: 8px;
		padding: 5px 10px;
	}
	.env-adj-nombre {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #334155;
	}
	.env-adj-size {
		color: #94a3b8;
		font-variant-numeric: tabular-nums;
	}
	.env-adj-x {
		border: none;
		background: none;
		color: #94a3b8;
		font-size: 15px;
		cursor: pointer;
		border-radius: 4px;
		padding: 0 4px;
	}
	.env-adj-x:hover {
		color: #b91c1c;
		background: #fee2e2;
	}
	.env-prueba {
		border: 1px dashed #cbd5e1;
		border-radius: 10px;
		padding: 10px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.env-prueba.activa {
		border-color: #f59e0b;
		background: #fffbeb;
	}
	.env-correo-prueba {
		max-width: 320px;
	}
	.env-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		padding: 12px 22px;
		border-top: 1px solid #e2e8f0;
		background: #f8fafc;
	}
	.env-hint {
		margin-right: auto;
		font-size: 12px;
		color: #64748b;
	}
	.env-btn-primary {
		background: #ea580c;
		color: #fff;
		border: none;
		border-radius: 9px;
		padding: 9px 18px;
		font-size: 13.5px;
		font-weight: 700;
		cursor: pointer;
	}
	.env-btn-primary:hover:not(:disabled) {
		background: #c2410c;
	}
	.env-btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.env-btn-ghost {
		background: #fff;
		color: #334155;
		border: 1px solid #cbd5e1;
		border-radius: 9px;
		padding: 8px 14px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.env-btn-ghost:hover {
		background: #f1f5f9;
	}
	.env-paso {
		margin: 4px 0 10px;
		font-size: 14px;
		color: #0f172a;
		font-weight: 600;
	}
	.env-barra {
		height: 10px;
		border-radius: 999px;
		background: #e2e8f0;
		overflow: hidden;
	}
	.env-barra-fill {
		height: 100%;
		background: linear-gradient(90deg, #ea580c, #f97316);
		transition: width 0.4s ease;
	}
	.env-pct {
		margin: 6px 0 12px;
		font-size: 12px;
		color: #64748b;
	}
	.env-resultados {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		max-height: 260px;
		overflow-y: auto;
	}
	.env-resultados li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 12px;
		font-size: 12.5px;
		border-bottom: 1px solid #f1f5f9;
	}
	.env-resultados li:last-child {
		border-bottom: none;
	}
	.env-res-placa {
		font-weight: 800;
		color: #0f172a;
		min-width: 76px;
	}
	.env-res-to {
		flex: 1;
		color: #475569;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
