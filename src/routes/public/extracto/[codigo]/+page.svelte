<script lang="ts">
	/**
	 * Validación pública de un extracto de contrato: a donde lleva el QR
	 * impreso. Sin sesión. Muestra si el documento existe, si su firma cuadra
	 * con lo guardado y en qué estado está (vigente, vencido o anulado).
	 *
	 * Quien la abre casi siempre es un agente de tránsito en la vía, con el
	 * papel en una mano y el celular en la otra: el veredicto va primero y en
	 * grande, y justo debajo los cuatro datos que se cotejan contra el impreso
	 * (número, placa, vigencia y huella). El resto del detalle va después.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import {
		BadgeCheck,
		Building2,
		Bus,
		FileText,
		ShieldAlert,
		ShieldCheck,
		ShieldX,
		Users
	} from 'lucide-svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { mascota } from '$lib/mascot';
	import {
		ESTADO_LABELS,
		ErrorValidacionExtracto,
		conPuntos,
		fechaLarga,
		validarExtractoPublico,
		type ExtractoPublico
	} from '$lib/api/extractos';

	const LOGO = '/assets/logo_nombre.webp';
	const EMPRESA = 'Cotransmeq';
	const CORREO = 'operaciones.cotransmeq@hotmail.com';

	let estado = $state<'cargando' | 'ok' | 'no-encontrado' | 'sin-conexion'>('cargando');
	let datos = $state<ExtractoPublico | null>(null);
	let consultado = $state<Date | null>(null);

	const codigo = $derived(page.params.codigo ?? '');

	async function validar() {
		estado = 'cargando';
		try {
			datos = await validarExtractoPublico(codigo);
			estado = 'ok';
		} catch (e) {
			estado =
				e instanceof ErrorValidacionExtracto && e.noEncontrado ? 'no-encontrado' : 'sin-conexion';
		} finally {
			consultado = new Date();
		}
	}

	onMount(validar);

	/** Días que faltan para una fecha YYYY-MM-DD, contados en el día local. */
	function diasHasta(ymd: string | null | undefined): number | null {
		if (!ymd) return null;
		const [a, m, d] = ymd.slice(0, 10).split('-').map(Number);
		const hoy = new Date();
		const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
		return Math.round((new Date(a, m - 1, d).getTime() - inicioHoy.getTime()) / 86_400_000);
	}

	/// Los colores del veredicto son literales y no `emerald-*`: en Cotransmeq
	/// esa escala es naranja, y un «auténtico» naranja se confunde con el ámbar
	/// de «vencido».
	const TONOS = {
		verde: { color: '#15803d', suave: '#f0fdf4', borde: '#bbf7d0' },
		ambar: { color: '#b45309', suave: '#fffbeb', borde: '#fde68a' },
		rojo: { color: '#b91c1c', suave: '#fef2f2', borde: '#fecaca' }
	} as const;

	const veredicto = $derived.by(() => {
		if (!datos) return null;
		if (!datos.firma_valida)
			return {
				tono: 'rojo' as const,
				icono: ShieldX,
				sello: 'Firma no válida',
				titulo: 'No acepte este documento',
				texto:
					'El contenido guardado no coincide con su firma electrónica: el extracto pudo ser alterado.'
			};
		if (datos.anulado)
			return {
				tono: 'rojo' as const,
				icono: ShieldX,
				sello: 'Firma válida',
				titulo: 'Extracto anulado',
				texto: `Anulado el ${fechaLarga(datos.anulado.fecha)}${datos.anulado.motivo ? `: ${datos.anulado.motivo}` : ''}.${datos.reemplazado_por ? ` Lo reemplaza el No. ${datos.reemplazado_por}.` : ''}`
			};
		if (datos.estado === 'VENCIDO')
			return {
				tono: 'ambar' as const,
				icono: ShieldAlert,
				sello: 'Firma válida',
				titulo: 'Auténtico, pero vencido',
				texto: `El extracto lo emitió ${datos.empresa.razon_social}, pero su vigencia terminó el ${fechaLarga(datos.vigencia_hasta)}.`
			};
		return {
			tono: 'verde' as const,
			icono: ShieldCheck,
			sello: 'Firma válida',
			titulo: 'Extracto auténtico y vigente',
			texto: `Emitido por ${datos.empresa.razon_social}. Vigente hasta el ${fechaLarga(datos.vigencia_hasta)}.`
		};
	});

	const restantes = $derived.by(() => {
		if (!datos || datos.anulado || datos.estado === 'VENCIDO') return null;
		const dias = diasHasta(datos.vigencia_hasta);
		if (dias === null || dias < 0) return null;
		if (dias === 0) return 'vence hoy';
		return dias === 1 ? 'queda 1 día' : `quedan ${dias} días`;
	});

	/// 415464522 2026 0005 5216: prefijo, año, contrato y consecutivo. Separado
	/// se coteja de un vistazo contra el impreso; seguido son 21 dígitos.
	const numeroEnGrupos = $derived.by(() => {
		const n = datos?.numero ?? '';
		if (!/^\d{21}$/.test(n)) return [n];
		return [n.slice(0, 9), n.slice(9, 13), n.slice(13, 17), n.slice(17)];
	});

	const descripcionVehiculo = $derived(
		datos
			? [datos.vehiculo.marca, datos.vehiculo.modelo, datos.vehiculo.clase]
					.filter(Boolean)
					.join(' · ')
			: ''
	);

	function iniciales(nombre: string): string {
		return nombre
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p.charAt(0))
			.join('')
			.toUpperCase();
	}

	const fechaConsulta = $derived(
		consultado
			? consultado.toLocaleString('es-CO', {
					day: 'numeric',
					month: 'long',
					year: 'numeric',
					hour: 'numeric',
					minute: '2-digit'
				})
			: ''
	);
</script>

<svelte:head>
	<title>Validación de extracto · {EMPRESA}</title>
</svelte:head>

<div class="vx">
	<header class="vx-barra">
		<img class="vx-logo" src={LOGO} alt={EMPRESA} width="150" height="52" />
		<div class="vx-barra-texto">
			<span class="vx-eyebrow">Validación de extracto</span>
			<span class="vx-barra-sub">Formato único de extracto del contrato · FUEC</span>
		</div>
	</header>

	{#if estado === 'cargando'}
		<CargaMascota tamano="pantalla" texto="Validando el extracto…" />
	{:else if estado === 'sin-conexion'}
		{@const imagen = mascota('ayuda')}
		<section class="vx-vacio">
			<img src={imagen.src} alt={imagen.alt} width="418" height="418" />
			<h1>No pudimos consultar el extracto</h1>
			<p>
				No hubo respuesta del servidor; suele ser falta de señal. Esto no quiere decir que el
				documento sea falso: intente de nuevo en unos segundos.
			</p>
			<button type="button" class="btn-primary" onclick={validar}>Intentar de nuevo</button>
		</section>
	{:else if estado === 'no-encontrado' || !datos || !veredicto}
		{@const imagen = mascota('vacio')}
		<section class="vx-vacio">
			<img src={imagen.src} alt={imagen.alt} width="418" height="418" />
			<h1>No encontramos este extracto</h1>
			<p>
				El código no corresponde a ningún extracto emitido. Revise que el código del QR esté
				completo; si el documento no aparece aquí, no lo acepte como válido.
			</p>
			{#if codigo}<code class="vx-codigo">{codigo}</code>{/if}
		</section>
	{:else}
		{@const tono = TONOS[veredicto.tono]}
		{@const imagen = mascota(veredicto.tono === 'verde' ? 'exito' : 'advertencia')}
		{@const Icono = veredicto.icono}
		<section
			class="vx-veredicto"
			style="--tono:{tono.color};--tono-suave:{tono.suave};--tono-borde:{tono.borde}"
			aria-live="polite"
		>
			<div class="vx-veredicto-cabeza">
				<img
					class="vx-veredicto-mascota"
					src={imagen.src}
					alt={imagen.alt}
					width="418"
					height="418"
				/>
				<div class="vx-veredicto-texto">
					<span class="vx-sello"><Icono size={15} strokeWidth={2.4} /> {veredicto.sello}</span>
					<h1>{veredicto.titulo}</h1>
					<p>{veredicto.texto}</p>
				</div>
			</div>

			<dl class="vx-cotejo" aria-label="Datos para comparar con el documento impreso">
				<div class="vx-cotejo-ancho">
					<dt>No. del extracto</dt>
					<dd class="vx-numero">
						{#each numeroEnGrupos as grupo, i (i)}<span>{grupo}</span>{/each}
					</dd>
				</div>
				<div>
					<dt>Placa</dt>
					<dd><span class="vx-placa">{datos.vehiculo.placa ?? '—'}</span></dd>
				</div>
				<div>
					<dt>Huella de la firma</dt>
					<dd class="vx-mono">{datos.huella ?? '—'}</dd>
				</div>
				<div class="vx-cotejo-ancho">
					<dt>Vigencia</dt>
					<dd>
						{fechaLarga(datos.vigencia_desde)} → {fechaLarga(datos.vigencia_hasta)}
						{#if restantes}<small>{restantes}</small>{/if}
					</dd>
				</div>
			</dl>
		</section>

		<div class="vx-rejilla">
			<section class="vx-tarjeta">
				<h2><Bus size={16} /> Vehículo</h2>
				<dl class="vx-datos">
					<div class="vx-ancho">
						<dt>Placa y descripción</dt>
						<dd><strong>{datos.vehiculo.placa ?? '—'}</strong> · {descripcionVehiculo || '—'}</dd>
					</div>
					<div>
						<dt>No. interno</dt>
						<dd>{datos.vehiculo.numero_interno ?? '—'}</dd>
					</div>
					<div>
						<dt>Tarjeta de operación</dt>
						<dd>{datos.vehiculo.tarjeta_operacion ?? '—'}</dd>
					</div>
					<div class="vx-ancho">
						<dt>Convenio</dt>
						<dd>{datos.convenio ?? 'N/A'}</dd>
					</div>
				</dl>
			</section>

			<section class="vx-tarjeta">
				<h2><FileText size={16} /> Contrato</h2>
				<dl class="vx-datos">
					<div class="vx-ancho">
						<dt>Contratante</dt>
						<dd>{datos.contratante ?? '—'}</dd>
					</div>
					<div class="vx-ancho">
						<dt>Contrato No.</dt>
						<dd>{datos.contrato_numero}</dd>
					</div>
					<div class="vx-ancho">
						<dt>Objeto</dt>
						<dd>{datos.objeto_contrato ?? '—'}</dd>
					</div>
					<div class="vx-ancho">
						<dt>Origen - destino</dt>
						<dd>{datos.origen_destino ?? '—'}</dd>
					</div>
				</dl>
			</section>

			<section class="vx-tarjeta">
				<h2><Users size={16} /> Conductores</h2>
				{#if datos.conductores.length}
					<ul class="vx-conductores">
						{#each datos.conductores as c, i (i)}
							{@const dias = diasHasta(c.licencia_vigencia)}
							<li>
								<span class="vx-avatar" aria-hidden="true">{iniciales(c.nombre)}</span>
								<div>
									<strong>{c.nombre}</strong>
									<small>{c.cedula ? `C.C. ${c.cedula}` : 'Sin cédula registrada'}</small>
									{#if c.licencia_vigencia}
										<span
											class="vx-licencia"
											class:vx-licencia--vencida={dias !== null && dias < 0}
										>
											<span class="vx-punto" aria-hidden="true"></span>
											{dias !== null && dias < 0
												? 'Licencia vencida el'
												: 'Licencia vigente hasta el'}
											{fechaLarga(c.licencia_vigencia)}
										</span>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="vx-nulo">Sin conductores registrados.</p>
				{/if}
			</section>

			<section class="vx-tarjeta">
				<h2><Building2 size={16} /> Empresa y firma</h2>
				<dl class="vx-datos">
					<div class="vx-ancho">
						<dt>Empresa de transporte</dt>
						<dd>{datos.empresa.razon_social}</dd>
					</div>
					<div>
						<dt>NIT</dt>
						<dd>{conPuntos(datos.empresa.nit)}</dd>
					</div>
					<div>
						<dt>Estado</dt>
						<dd>{ESTADO_LABELS[datos.estado]}</dd>
					</div>
					<div>
						<dt>Emitido</dt>
						<dd>{datos.emitido_at ? fechaLarga(datos.emitido_at) : '—'}</dd>
					</div>
					<div>
						<dt>Código de verificación</dt>
						<dd class="vx-mono">{codigo}</dd>
					</div>
					<div class="vx-ancho">
						<dt>Firma electrónica</dt>
						<dd class="vx-firma">
							<BadgeCheck size={15} />
							HMAC-SHA512 · {datos.firma_valida ? 'coincide con el contenido' : 'no coincide'}
						</dd>
					</div>
				</dl>
			</section>
		</div>

		<footer class="vx-pie">
			<p>
				Compare el número, la placa y la huella con el documento impreso: deben ser idénticos. Las
				cédulas se muestran parcialmente por privacidad. Dudas sobre este extracto:
				<a href="mailto:{CORREO}">{CORREO}</a>.
			</p>
			{#if fechaConsulta}<p class="vx-consulta">Consultado el {fechaConsulta}</p>{/if}
		</footer>
	{/if}
</div>

<style>
	.vx {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: clamp(1rem, 3vw, 2rem);
		padding-bottom: 3rem;
		background: var(--bg-base);
		color: var(--text-primary);
	}

	/* ─── Barra ─── */
	.vx-barra {
		display: flex;
		align-items: center;
		gap: 0.9rem 1.25rem;
		flex-wrap: wrap;
		padding-bottom: 0.25rem;
	}
	.vx-logo {
		height: 44px;
		width: auto;
	}
	.vx-barra-texto {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding-left: 1.25rem;
		border-left: 1px solid var(--border-default);
	}
	.vx-eyebrow {
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--emerald-700);
	}
	.vx-barra-sub {
		font-size: 0.82rem;
		color: var(--text-muted);
	}
	@media (max-width: 480px) {
		.vx-barra-texto {
			padding-left: 0;
			border-left: 0;
		}
	}

	/* ─── Veredicto ─── */
	.vx-veredicto {
		background: var(--tono-suave);
		border: 1.5px solid var(--tono-borde);
		border-radius: var(--radius-2xl);
		overflow: hidden;
	}
	.vx-veredicto-cabeza {
		display: flex;
		align-items: center;
		gap: 1rem 1.5rem;
		padding: 1.25rem clamp(1rem, 3vw, 1.75rem);
	}
	.vx-veredicto-mascota {
		flex: none;
		width: clamp(5.5rem, 16vw, 8.5rem);
		height: auto;
	}
	.vx-veredicto-texto {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.45rem;
		min-width: 0;
	}
	.vx-sello {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.65rem 0.25rem 0.5rem;
		border-radius: 999px;
		background: var(--tono);
		color: #fff;
		font-size: 0.74rem;
		font-weight: 800;
		letter-spacing: 0.02em;
	}
	.vx-veredicto h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.35rem, 4vw, 1.9rem);
		font-weight: 800;
		letter-spacing: -0.025em;
		line-height: 1.15;
		color: var(--tono);
	}
	.vx-veredicto p {
		margin: 0;
		max-width: 44rem;
		font-size: 0.95rem;
		color: var(--text-secondary);
	}

	.vx-cotejo {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 1px;
		background: var(--tono-borde);
		border-top: 1px solid var(--tono-borde);
	}
	.vx-cotejo > div {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.85rem clamp(1rem, 3vw, 1.75rem);
		background: var(--bg-surface);
	}
	.vx-cotejo dt {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.vx-cotejo dd {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.vx-cotejo small {
		display: block;
		margin-top: 0.1rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-muted);
	}
	.vx-numero {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.45rem;
		font-family: var(--font-mono);
		font-size: 1.02rem !important;
		letter-spacing: 0.03em;
	}
	.vx-mono {
		font-family: var(--font-mono);
		letter-spacing: 0.03em;
		overflow-wrap: anywhere;
	}
	/* Placa de servicio público: fondo blanco, letras negras. */
	.vx-placa {
		display: inline-block;
		padding: 0.15rem 0.6rem;
		border: 2px solid #17201d;
		border-radius: 6px;
		background: #fff;
		font-family: var(--font-mono);
		font-size: 1.1rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		color: #17201d;
	}

	/* ─── Detalle ─── */
	.vx-rejilla {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
		gap: 1rem;
		align-items: start;
	}
	.vx-tarjeta {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1.1rem 1.25rem 1.25rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
	}
	.vx-tarjeta h2 {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.98rem;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.vx-tarjeta h2 :global(svg) {
		color: var(--emerald-600);
	}
	.vx-datos {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem 1rem;
	}
	.vx-ancho {
		grid-column: 1 / -1;
	}
	.vx-datos dt {
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.vx-datos dd {
		margin: 0.15rem 0 0;
		font-size: 0.9rem;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.vx-firma {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.vx-firma :global(svg) {
		flex: none;
		color: var(--emerald-600);
	}
	.vx-nulo {
		margin: 0;
		font-size: 0.88rem;
		font-style: italic;
		color: var(--text-very-muted);
	}

	.vx-conductores {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
	}
	.vx-conductores li {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.7rem 0;
		border-top: 1px solid var(--border-subtle);
	}
	.vx-conductores li:first-child {
		padding-top: 0;
		border-top: 0;
	}
	.vx-conductores li > div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		font-size: 0.9rem;
	}
	.vx-conductores small {
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.vx-avatar {
		flex: none;
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 50%;
		background: var(--color-emerald-50);
		color: var(--emerald-700);
		font-size: 0.78rem;
		font-weight: 800;
	}
	/* Texto además del color: al sol, un punto verde y uno rojo se confunden. */
	.vx-licencia {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.35rem;
		margin-top: 0.15rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: #15803d;
	}
	.vx-licencia--vencida {
		color: #b91c1c;
	}
	.vx-punto {
		flex: none;
		width: 0.45rem;
		height: 0.45rem;
		margin-top: 0.4em;
		border-radius: 50%;
		background: currentColor;
	}

	/* ─── No encontrado ─── */
	.vx-vacio {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 2rem 1rem;
		text-align: center;
	}
	.vx-vacio img {
		width: 10rem;
		height: auto;
	}
	.vx-vacio h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.vx-vacio p {
		margin: 0;
		max-width: 30rem;
		font-size: 0.9rem;
		color: var(--text-muted);
	}
	.vx-codigo {
		padding: 0.3rem 0.7rem;
		border-radius: 8px;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		font-family: var(--font-mono);
		font-size: 0.85rem;
		letter-spacing: 0.06em;
	}

	/* ─── Pie ─── */
	.vx-pie {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding-top: 0.25rem;
	}
	.vx-pie p {
		margin: 0;
		max-width: 44rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.vx-pie a {
		color: var(--emerald-700);
		font-weight: 600;
	}
	.vx-consulta {
		font-size: 0.74rem !important;
		color: var(--text-very-muted) !important;
	}

	/* En el celular el veredicto y los cuatro datos tienen que caber sin
	   desplazarse: mascota al lado del título y placa junto a la huella. */
	@media (max-width: 480px) {
		.vx-veredicto-cabeza {
			align-items: flex-start;
		}
		.vx-veredicto-mascota {
			width: 4.25rem;
		}
		.vx-cotejo {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.vx-cotejo-ancho {
			grid-column: 1 / -1;
		}
		.vx-cotejo .vx-mono {
			font-size: 0.86rem;
		}
	}
</style>
