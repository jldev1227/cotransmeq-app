<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { nominaNotificacionesAPI } from '$lib/api/nomina-canvas';

	interface Hoja {
		liquidacionId: string | null;
		nombre: string;
		estado: string;
	}

	interface Props {
		hojas: Hoja[];
		anio: number;
		mes: number;
		etiquetaPeriodo: string;
		onCerrar: () => void;
	}

	let { hojas, anio, mes, etiquetaPeriodo, onCerrar }: Props = $props();
	const pagadas = $derived(hojas.filter((h) => h.liquidacionId && h.estado === 'PAGADA'));
	let marcados = $state<Set<string>>(new Set());
	let enviando = $state(false);
	const MESES = [
		'enero',
		'febrero',
		'marzo',
		'abril',
		'mayo',
		'junio',
		'julio',
		'agosto',
		'septiembre',
		'octubre',
		'noviembre',
		'diciembre'
	];

	onMount(() => {
		marcados = new Set(pagadas.map((h) => h.liquidacionId!));
	});

	function alternar(id: string) {
		const siguiente = new Set(marcados);
		siguiente.has(id) ? siguiente.delete(id) : siguiente.add(id);
		marcados = siguiente;
	}

	function seleccionarTodo(valor: boolean) {
		marcados = valor ? new Set(pagadas.map((h) => h.liquidacionId!)) : new Set();
	}

	function primerNombre(nombre: string) {
		return nombre.trim().split(/\s+/)[0] || 'Conductor';
	}

	function vistaPrevia(hoja: Hoja) {
		return `Hola ${primerNombre(hoja.nombre)}, tu desprendible de nómina de ${MESES[mes - 1]} de ${anio} ya se encuentra disponible para firmar y consultar.`;
	}

	async function enviar() {
		if (!marcados.size) return;
		enviando = true;
		try {
			const resultado = await nominaNotificacionesAPI.enviar({
				anio,
				mes,
				liquidacionIds: [...marcados]
			});
			const errores = resultado.resultados.filter((item) => item.estado === 'ERROR');
			const omitidas = resultado.resultados.filter((item) => item.estado === 'OMITIDA');
			if (resultado.enviadas) {
				toast.success(`${resultado.enviadas} notificación(es) enviada(s).`, {
					description: errores.length
						? `${errores.length} envío(s) fallaron: ${errores[0].error ?? 'error del proveedor push'}`
						: resultado.sin_dispositivo
							? `${resultado.sin_dispositivo} conductor(es) todavía no registran un dispositivo.`
							: 'El aviso abrirá directamente el historial de nómina.'
				});
			} else if (errores.length) {
				toast.error('Expo no pudo entregar la notificación.', {
					description: errores[0].error ?? 'Revisa las credenciales APNs/FCM del proyecto.'
				});
			} else if (omitidas.length) {
				toast.warning('No se notificaron las liquidaciones seleccionadas.', {
					description: omitidas[0].error ?? 'La liquidación no cumple los requisitos del envío.'
				});
			} else {
				toast.warning('No había dispositivos habilitados para recibir el push.', {
					description: 'El aviso quedó guardado en el inbox del conductor.'
				});
			}
			onCerrar();
		} catch (error: any) {
			toast.error(error?.response?.data?.error || error?.message || 'No se pudo enviar el aviso.');
		} finally {
			enviando = false;
		}
	}
</script>

<div
	class="nin-bg"
	role="dialog"
	aria-modal="true"
	aria-labelledby="nin-title"
	tabindex="-1"
	onkeydown={(event) => event.key === 'Escape' && onCerrar()}
>
	<section class="nin-card">
		<header>
			<div>
				<p class="nin-kicker">NOTIFICACIÓN MÓVIL</p>
				<h2 id="nin-title">Avisar desprendible disponible</h2>
				<p>{etiquetaPeriodo} · Solo liquidaciones pagadas</p>
			</div>
			<button class="nin-close" onclick={onCerrar} aria-label="Cerrar">✕</button>
		</header>

		{#if pagadas.length === 0}
			<div class="nin-empty">
				<strong>Aún no hay liquidaciones pagadas.</strong>
				<span>Marca las hojas como PAGADA antes de notificar al conductor.</span>
			</div>
		{:else}
			<div class="nin-toolbar">
				<span>{marcados.size} de {pagadas.length} seleccionadas</span>
				<div>
					<button onclick={() => seleccionarTodo(true)}>Todas</button>
					<button onclick={() => seleccionarTodo(false)}>Ninguna</button>
				</div>
			</div>
			<ul>
				{#each pagadas as hoja (hoja.liquidacionId!)}
					<li>
						<label>
							<input
								type="checkbox"
								checked={marcados.has(hoja.liquidacionId!)}
								onchange={() => alternar(hoja.liquidacionId!)}
							/>
							<span class="nin-person">
								<strong>{hoja.nombre}</strong>
								<small>{vistaPrevia(hoja)}</small>
							</span>
						</label>
						<span class="nin-ready">PAGADA</span>
					</li>
				{/each}
			</ul>
			<p class="nin-note">
				Se enviará por la app móvil mediante Expo Push. Esta acción no envía correos.
			</p>
		{/if}

		<footer>
			<button class="nin-secondary" onclick={onCerrar} disabled={enviando}>Cancelar</button>
			<button
				class="nin-primary"
				onclick={enviar}
				disabled={enviando || marcados.size === 0}
			>
				{enviando ? 'Notificando…' : `Notificar a ${marcados.size}`}
			</button>
		</footer>
	</section>
</div>

<style>
	.nin-bg {
		position: fixed;
		inset: 0;
		z-index: 9980;
		display: grid;
		place-items: center;
		padding: 24px;
		background: rgba(15, 23, 42, 0.56);
	}
	.nin-card {
		display: flex;
		flex-direction: column;
		gap: 14px;
		width: min(720px, 100%);
		max-height: min(86vh, 760px);
		padding: 20px;
		border-radius: 16px;
		background: #fff;
		box-shadow: 0 24px 70px rgba(2, 6, 23, 0.36);
	}
	header,
	.nin-toolbar,
	footer,
	li,
	label {
		display: flex;
		align-items: center;
	}
	header,
	.nin-toolbar,
	footer,
	li {
		justify-content: space-between;
	}
	header { align-items: flex-start; gap: 16px; }
	h2 { margin: 2px 0 3px; font-size: 20px; color: #0f172a; }
	header p { margin: 0; color: #64748b; font-size: 12px; }
	.nin-kicker { color: #c2410c; font-weight: 800; letter-spacing: .1em; }
	.nin-close,
	.nin-toolbar button {
		border: 0;
		background: transparent;
		color: #64748b;
		font-weight: 700;
		cursor: pointer;
	}
	.nin-toolbar { font-size: 12px; font-weight: 700; color: #475569; }
	.nin-toolbar div { display: flex; gap: 10px; }
	.nin-toolbar button { color: #c2410c; text-decoration: underline; }
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
	}
	li { gap: 12px; padding: 12px 14px; border-bottom: 1px solid #f1f5f9; }
	li:last-child { border-bottom: 0; }
	label { gap: 10px; min-width: 0; cursor: pointer; }
	.nin-person { display: grid; gap: 3px; min-width: 0; }
	.nin-person strong { color: #0f172a; font-size: 13px; }
	.nin-person small {
		color: #64748b;
		font-size: 11px;
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nin-ready {
		flex: none;
		padding: 3px 7px;
		border-radius: 999px;
		background: #dcfce7;
		color: #166534;
		font-size: 10px;
		font-weight: 800;
	}
	.nin-note,
	.nin-empty {
		margin: 0;
		padding: 12px;
		border-radius: 10px;
		background: #fff7ed;
		color: #9a3412;
		font-size: 12px;
	}
	.nin-empty { display: grid; gap: 4px; text-align: center; }
	footer { justify-content: flex-end; gap: 8px; }
	footer button {
		min-height: 40px;
		padding: 0 15px;
		border-radius: 9px;
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}
	.nin-secondary { border: 1px solid #cbd5e1; background: #fff; color: #334155; }
	.nin-primary { border: 1px solid #ea580c; background: #ea580c; color: #fff; }
	footer button:disabled { opacity: .5; cursor: not-allowed; }
</style>
