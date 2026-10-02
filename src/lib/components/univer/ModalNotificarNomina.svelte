<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { nominaNotificacionesAPI } from '$lib/api/nomina-canvas';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

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

<ModalBase
	open={true}
	eyebrow="Notificación móvil"
	title="Avisar desprendible disponible"
	subtitle={`${etiquetaPeriodo} · Solo liquidaciones pagadas`}
	tamano="md"
	bloqueado={enviando}
	cerrarAlFondo={!enviando}
	oncerrar={onCerrar}
>
	{#if pagadas.length === 0}
		<div class="nin-empty">
			<strong>Aún no hay liquidaciones pagadas.</strong>
			<span>Marca las hojas como PAGADA antes de notificar al conductor.</span>
		</div>
	{:else}
		<div class="nin-contenido">
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
		</div>
	{/if}

	{#snippet pie()}
		<button class="btn-secondary" onclick={onCerrar} disabled={enviando}>Cancelar</button>
		<button class="btn-primary" onclick={enviar} disabled={enviando || marcados.size === 0}>
			{enviando ? 'Notificando…' : `Notificar a ${marcados.size}`}
		</button>
	{/snippet}
</ModalBase>

<style>
	.nin-contenido {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.nin-toolbar,
	li,
	label {
		display: flex;
		align-items: center;
	}
	.nin-toolbar,
	li {
		justify-content: space-between;
	}
	.nin-toolbar {
		font-size: 13px;
		font-weight: 700;
		color: var(--text-secondary);
	}
	.nin-toolbar div {
		display: flex;
		gap: 12px;
	}
	.nin-toolbar button {
		border: 0;
		padding: 0;
		background: transparent;
		color: var(--accion);
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
	}
	.nin-toolbar button:hover {
		color: var(--accion-hover);
		text-decoration: underline;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: var(--bg-surface);
		border-radius: 16px;
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
	}
	li {
		gap: 12px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border-subtle);
	}
	li:last-child {
		border-bottom: 0;
	}
	label {
		gap: 10px;
		min-width: 0;
		cursor: pointer;
	}
	label input {
		accent-color: var(--accion);
	}
	.nin-person {
		display: grid;
		gap: 3px;
		min-width: 0;
	}
	.nin-person strong {
		color: var(--text-primary);
		font-size: 13px;
	}
	.nin-person small {
		color: var(--text-muted);
		font-size: 11px;
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nin-ready {
		flex: none;
		padding: 3px 8px;
		border-radius: 999px;
		background: #dcfce7;
		color: #166534;
		font-size: 10px;
		font-weight: 800;
	}
	.nin-note,
	.nin-empty {
		margin: 0;
		padding: 14px 16px;
		border-radius: 16px;
		background: var(--bg-surface);
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
		color: var(--text-secondary);
		font-size: 12.5px;
		line-height: 1.45;
	}
	.nin-empty {
		display: grid;
		gap: 4px;
		text-align: center;
	}
	.nin-empty strong {
		color: var(--text-primary);
	}
</style>
