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
	import { confirmarEliminacion } from '$lib/stores/confirm';
	import { toast } from 'svelte-sonner';
	import { operadorasAPI, type Operadora } from '$lib/api/liquidaciones-servicios';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';

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
		if (
			!(await confirmarEliminacion({
				title: `¿Eliminar la operadora ${o.codigo}?`,
				message: 'Si alguna liquidación la usa, se retirará en lugar de borrarse.'
			}))
		)
			return;
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
</script>

<ModalBase
	{open}
	eyebrow="Catálogo"
	title="Operadoras"
	subtitle="A quién se le atribuye cada liquidación de servicios."
	tamano="md"
	oncerrar={cerrar}
>
	{#if cargando}
		<p class="mop-card mop-aviso">Cargando el catálogo…</p>
	{:else if error}
		<p class="mop-card mop-aviso mop-error">{error}</p>
	{:else}
		<div class="mop-contenido">
			<div class="mop-card">
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
			</div>

			<div class="mop-card mop-nueva">
				<input class="mop-input" placeholder="CÓDIGO" bind:value={nuevoCodigo} />
				<input class="mop-input" placeholder="Nombre visible" bind:value={nuevoNombre} />
				<button class="btn-primary" onclick={crear} disabled={creando}>
					{creando ? 'Creando…' : 'Añadir'}
				</button>
			</div>
			<p class="mop-pie">
				El código se normaliza a mayúsculas y es lo que queda escrito en las liquidaciones. El
				nombre es solo la etiqueta que se ve.
			</p>
		</div>
	{/if}
</ModalBase>

<style>
	.mop-contenido {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.mop-card {
		background: var(--bg-surface);
		border-radius: 16px;
		box-shadow: 0 3px 10px rgba(0, 29, 23, 0.05);
		overflow: hidden;
	}
	.mop-aviso {
		margin: 0;
		padding: 18px 0;
		text-align: center;
		font-size: 13px;
		color: var(--text-muted);
	}
	.mop-error {
		color: #b42318;
	}
	.mop-tabla {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
		color: var(--text-primary);
	}
	.mop-tabla th {
		text-align: left;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		border-bottom: 1px solid var(--border-default);
		padding: 10px 12px;
	}
	.mop-th-acc {
		text-align: right;
	}
	.mop-tabla td {
		padding: 8px 12px;
		border-bottom: 1px solid var(--border-subtle);
	}
	.mop-tabla tbody tr:last-child td {
		border-bottom: none;
	}
	.mop-inactiva {
		opacity: 0.55;
	}
	.mop-codigo {
		font-weight: 700;
		color: var(--text-primary);
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
		box-sizing: border-box;
		min-height: 42px;
		padding: 9px 12px;
		border-radius: 12px;
		border: 1px solid var(--border-default);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.mop-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.mop-input:disabled {
		background: var(--bg-base);
		color: var(--text-muted);
	}
	.mop-acc {
		text-align: right;
		white-space: nowrap;
	}
	/* Acciones de fila: compactas para no inflar la tabla, con el mismo
	   lenguaje que `btn-secondary` / `btn-danger`. */
	.mop-btn {
		min-height: 32px;
		padding: 0 12px;
		margin-left: 6px;
		border: 1.5px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		color: var(--bg-charcoal-deep);
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}
	.mop-btn:hover {
		background: var(--bg-base);
	}
	.mop-btn-peligro {
		color: #b42318;
		border-color: #fecaca;
	}
	.mop-btn-peligro:hover {
		background: #fef3f2;
	}
	.mop-nueva {
		display: grid;
		grid-template-columns: 140px 1fr auto;
		gap: 8px;
		align-items: center;
		padding: 12px;
	}
	.mop-pie {
		margin: 0;
		font-size: 12px;
		color: var(--text-muted);
	}
</style>
