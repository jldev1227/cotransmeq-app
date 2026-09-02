<!--
	Catálogo de OPERADORAS.

	Antes `operadora` era texto libre en la base —sin enum, sin default y sin una
	sola validación en ninguna capa—, así que añadir una operadora obligaba a
	tocar código en dos repos y a desplegar. Esto lo convierte en un catálogo.

	Vive en `components/` y no en `components/univer/` porque lo montan DOS
	sitios: el carril del canvas (solo Transmeralda, que es quien lo tiene) y la
	pestaña de Configuración del listado clásico, que es la única que existe en
	los dos frontends. Dejarlo bajo `univer/` lo habría dejado inalcanzable en
	Cotransmeq, que no tiene canvas.

	El guard (admin u operaciones) lo aplica quien lo monta; aquí no se
	re-verifica porque el backend es quien manda de verdad.

	Ojo con el borrado: el backend NO borra una operadora que tenga
	liquidaciones, la retira (`activo = false`). Vaciar ese campo en las
	liquidaciones históricas sería perder a quién se le atribuyó el servicio. La
	respuesta dice qué hizo, y esto lo cuenta tal cual en vez de decir siempre
	«eliminada».
-->
<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { operadorasAPI, type Operadora } from '$lib/api/liquidaciones-servicios';

	interface Props {
		open: boolean;
		onClose: () => void;
		/// Se avisa al cerrar si hubo cambios, para que quien tenga el editor
		/// abierto recargue su <select> en vez de quedarse con la lista vieja.
		onCambios?: () => void;
	}

	let { open, onClose, onCambios }: Props = $props();

	let operadoras = $state<Operadora[]>([]);
	let cargando = $state(false);
	let error = $state('');
	let huboCambios = false;
	/// Para no recargar en cada repintado del padre mientras está abierto.
	let cargadoParaSesion = $state(false);

	let nuevoCodigo = $state('');
	let nuevoNombre = $state('');
	let creando = $state(false);

	$effect(() => {
		if (open && !cargadoParaSesion) {
			cargadoParaSesion = true;
			void cargar();
		}
		if (!open && cargadoParaSesion) {
			cargadoParaSesion = false;
			huboCambios = false;
		}
	});

	async function cargar() {
		cargando = true;
		error = '';
		try {
			/// Con inactivas: se administran desde aquí, así que hay que verlas
			/// para poder reactivarlas.
			operadoras = await operadorasAPI.listar(true);
		} catch (e: any) {
			error = e?.message || 'No se pudo cargar el catálogo';
		} finally {
			cargando = false;
		}
	}

	function cerrar() {
		if (huboCambios) onCambios?.();
		onClose();
	}

	async function crear() {
		const codigo = nuevoCodigo.trim().toUpperCase();
		if (!codigo) {
			toast.error('El código es obligatorio');
			return;
		}
		creando = true;
		try {
			await operadorasAPI.crear({
				codigo,
				nombre: nuevoNombre.trim() || codigo,
				/// Al final de la lista, dejando hueco para intercalar después.
				orden: (operadoras.at(-1)?.orden ?? 0) + 10
			});
			nuevoCodigo = '';
			nuevoNombre = '';
			huboCambios = true;
			await cargar();
			toast.success(`Operadora ${codigo} creada`);
		} catch (e: any) {
			toast.error(e?.message || 'No se pudo crear');
		} finally {
			creando = false;
		}
	}

	async function renombrar(o: Operadora, nombre: string) {
		const limpio = nombre.trim();
		if (!limpio || limpio === o.nombre) return;
		try {
			await operadorasAPI.actualizar(o.id, { nombre: limpio });
			huboCambios = true;
			await cargar();
		} catch (e: any) {
			toast.error(e?.message || 'No se pudo renombrar');
			await cargar();
		}
	}

	async function alternarActiva(o: Operadora) {
		try {
			await operadorasAPI.actualizar(o.id, { activo: !o.activo });
			huboCambios = true;
			await cargar();
			toast.success(o.activo ? `${o.codigo} retirada` : `${o.codigo} reactivada`);
		} catch (e: any) {
			toast.error(e?.message || 'No se pudo cambiar el estado');
		}
	}

	async function eliminar(o: Operadora) {
		if (!confirm(`¿Eliminar la operadora ${o.codigo}?`)) return;
		try {
			const r = await operadorasAPI.eliminar(o.id);
			huboCambios = true;
			await cargar();
			toast.success(
				r.accion === 'eliminada'
					? `${o.codigo} eliminada`
					: `${o.codigo} se retiró en vez de borrarse`,
				r.accion === 'desactivada'
					? {
							description: `La usan ${r.liquidaciones} liquidación(es); borrarla habría vaciado ese dato en todas.`
						}
					: undefined
			);
		} catch (e: any) {
			toast.error(e?.message || 'No se pudo eliminar');
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') cerrar();
	}
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<!-- `role="presentation"`: el velo no es un control, solo capta el clic fuera.
	     Escape lo cierra desde `svelte:window`, así que no hace falta teclado aquí. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="mop-bg" role="presentation" onclick={(e) => e.target === e.currentTarget && cerrar()}>
		<div class="mop-box" role="dialog" aria-modal="true" aria-label="Catálogo de operadoras">
			<header class="mop-hd">
				<div>
					<h2>Operadoras</h2>
					<p>A quién se le atribuye cada liquidación de servicios.</p>
				</div>
				<button class="mop-x" onclick={cerrar} aria-label="Cerrar">✕</button>
			</header>

			{#if cargando}
				<p class="mop-aviso">Cargando el catálogo…</p>
			{:else if error}
				<p class="mop-aviso mop-error">{error}</p>
			{:else}
				<table class="mop-tabla">
					<thead>
						<tr>
							<th>Código</th>
							<th>Nombre</th>
							<th class="mop-th-acc">Acciones</th>
						</tr>
					</thead>
					<tbody>
						{#each operadoras as o (o.id)}
							<tr class:mop-inactiva={!o.activo}>
								<td class="mop-codigo">
									{o.codigo}
									{#if !o.activo}<span class="mop-tag">retirada</span>{/if}
								</td>
								<td>
									<!-- Se guarda al salir del campo, no en cada tecla: es un
									     catálogo de tres filas, no hace falta autoguardado. -->
									<input
										class="mop-input"
										value={o.nombre}
										onblur={(e) => renombrar(o, e.currentTarget.value)}
									/>
								</td>
								<td class="mop-acc">
									<button class="mop-btn" onclick={() => alternarActiva(o)}>
										{o.activo ? 'Retirar' : 'Reactivar'}
									</button>
									<button class="mop-btn mop-btn-peligro" onclick={() => eliminar(o)}>
										Eliminar
									</button>
								</td>
							</tr>
						{/each}
						{#if operadoras.length === 0}
							<tr><td colspan="3" class="mop-aviso">Todavía no hay operadoras.</td></tr>
						{/if}
					</tbody>
				</table>

				<div class="mop-nueva">
					<input class="mop-input" placeholder="CÓDIGO" bind:value={nuevoCodigo} />
					<input class="mop-input" placeholder="Nombre visible" bind:value={nuevoNombre} />
					<button class="mop-btn mop-btn-alta" onclick={crear} disabled={creando}>
						{creando ? 'Creando…' : 'Añadir'}
					</button>
				</div>
				<p class="mop-pie">
					El código se normaliza a mayúsculas y es lo que queda escrito en las liquidaciones. El
					nombre es solo la etiqueta que se ve.
				</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	.mop-bg {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(15, 23, 42, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}
	.mop-box {
		width: min(680px, 100%);
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 20px 60px rgba(2, 6, 23, 0.35);
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.mop-hd {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.mop-hd h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
		color: #0f172a;
	}
	.mop-hd p {
		margin: 2px 0 0;
		font-size: 12px;
		color: #64748b;
	}
	.mop-x {
		border: none;
		background: transparent;
		font-size: 14px;
		color: #64748b;
		cursor: pointer;
		padding: 4px;
	}
	.mop-aviso {
		margin: 0;
		padding: 18px 0;
		text-align: center;
		font-size: 13px;
		color: #64748b;
	}
	.mop-error {
		color: #b91c1c;
	}
	.mop-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.mop-tabla th {
		text-align: left;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
		border-bottom: 1px solid #e2e8f0;
		padding: 6px 8px;
	}
	.mop-th-acc {
		text-align: right;
	}
	.mop-tabla td {
		padding: 6px 8px;
		border-bottom: 1px solid #f1f5f9;
	}
	.mop-inactiva {
		opacity: 0.55;
	}
	.mop-codigo {
		font-weight: 700;
		color: #0f172a;
		white-space: nowrap;
	}
	.mop-tag {
		margin-left: 6px;
		font-size: 10px;
		font-weight: 600;
		color: #92400e;
		background: #fef3c7;
		border-radius: 999px;
		padding: 1px 6px;
	}
	.mop-input {
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 4px 8px;
		font-size: 13px;
	}
	.mop-acc {
		text-align: right;
		white-space: nowrap;
	}
	.mop-btn {
		border: 1px solid #cbd5e1;
		background: #fff;
		border-radius: 6px;
		padding: 3px 10px;
		font-size: 12px;
		cursor: pointer;
		margin-left: 6px;
	}
	.mop-btn:hover {
		background: #f8fafc;
	}
	.mop-btn-peligro {
		color: #b91c1c;
		border-color: #fecaca;
	}
	.mop-btn-alta {
		background: #0f4025;
		border-color: #0f4025;
		color: #fff;
		margin-left: 0;
	}
	.mop-nueva {
		display: grid;
		grid-template-columns: 140px 1fr auto;
		gap: 8px;
		align-items: center;
	}
	.mop-pie {
		margin: 0;
		font-size: 11px;
		color: #94a3b8;
	}
</style>
