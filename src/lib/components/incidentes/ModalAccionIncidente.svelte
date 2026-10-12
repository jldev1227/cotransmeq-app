<script lang="ts">
	/**
	 * Acción correctiva desde la investigación de un incidente: crear una nueva
	 * o vincular una que ya exista.
	 *
	 * La nueva nace en el módulo de acciones correctivas (con la fuente
	 * «Investigación de Incidente/Accidente», su número `AC-<año>-<n>` y el
	 * flujo de aprobación de siempre); aquí solo se piden los datos mínimos y
	 * el resto —seguimientos, eficacia, cierre— se gestiona allá.
	 */
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Link2 } from 'lucide-svelte';
	import ModalBase from '$lib/components/ui/ModalBase.svelte';
	import Campo from '$lib/components/directorio/Campo.svelte';
	import BuscadorLista from '$lib/components/listing/BuscadorLista.svelte';
	import CargaMascota from '$lib/components/ui/CargaMascota.svelte';
	import { TIPOS_HALLAZGO } from '$lib/acciones-correctivas/constants';
	import {
		incidentesAPI,
		mensajeError,
		TIPO_LABELS,
		fechaCorta,
		type AccionBuscada,
		type IncidenteDetalleApi,
		type NuevaAccion
	} from '$lib/api/incidentes';

	interface Props {
		open: boolean;
		incidente: IncidenteDetalleApi;
		oncerrar: () => void;
		onguardado: (detalle: IncidenteDetalleApi) => void;
	}
	let { open, incidente, oncerrar, onguardado }: Props = $props();

	let modo = $state<'crear' | 'vincular'>('crear');
	let guardando = $state(false);
	let error = $state<string | null>(null);
	let form = $state<Required<{ [K in keyof NuevaAccion]: string }>>({
		descripcion_hallazgo: '',
		tipo_accion_ejecutar: 'CORRECTIVA',
		accion_numero: '',
		tipo_hallazgo_detectado: '',
		valoracion_riesgo: '',
		plan_accion: '',
		responsable_ejecucion: '',
		fecha_limite_implementacion: ''
	});

	let busqueda = $state('');
	let resultados = $state<AccionBuscada[]>([]);
	let buscando = $state(false);

	/// Al abrir, el hallazgo se propone con el radicado, el evento y la causa
	/// raíz de la investigación: es lo que cualquiera escribiría a mano.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			const inc = incidente;
			const causa = inc.investigacion.causas_identificadas?.trim();
			form = {
				descripcion_hallazgo: `${inc.codigo} · ${TIPO_LABELS[inc.tipo].label} del ${fechaCorta(inc.fecha)}${inc.vehiculo ? ` (${inc.vehiculo.placa})` : ''}.${causa ? ` Causa raíz: ${causa}` : ''}`,
				tipo_accion_ejecutar: 'CORRECTIVA',
				accion_numero: '',
				tipo_hallazgo_detectado: '',
				valoracion_riesgo: '',
				plan_accion: '',
				responsable_ejecucion: '',
				fecha_limite_implementacion: ''
			};
			modo = 'crear';
			error = null;
			busqueda = '';
			void buscar('');
		});
	});

	async function buscar(q: string) {
		buscando = true;
		try {
			resultados = await incidentesAPI.buscarAcciones(incidente.id, q);
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudieron buscar acciones'));
		} finally {
			buscando = false;
		}
	}

	const nulo = (t: string) => (t.trim() ? t.trim() : null);

	async function crear() {
		if (guardando) return;
		error = null;
		guardando = true;
		try {
			const detalle = await incidentesAPI.crearAccion(incidente.id, {
				descripcion_hallazgo: form.descripcion_hallazgo.trim(),
				tipo_accion_ejecutar: form.tipo_accion_ejecutar as NuevaAccion['tipo_accion_ejecutar'],
				accion_numero: nulo(form.accion_numero),
				tipo_hallazgo_detectado: nulo(form.tipo_hallazgo_detectado),
				valoracion_riesgo:
					(nulo(form.valoracion_riesgo) as NuevaAccion['valoracion_riesgo']) ?? null,
				plan_accion: nulo(form.plan_accion),
				responsable_ejecucion: nulo(form.responsable_ejecucion),
				fecha_limite_implementacion: nulo(form.fecha_limite_implementacion)
			});
			const nueva = detalle.acciones_vinculadas.at(-1);
			toast.success(`Acción ${nueva?.numero ?? ''} creada y vinculada`);
			onguardado(detalle);
		} catch (err) {
			error = mensajeError(err, 'No se pudo crear la acción');
		} finally {
			guardando = false;
		}
	}

	async function vincular(a: AccionBuscada) {
		if (guardando) return;
		guardando = true;
		try {
			const detalle = await incidentesAPI.vincularAccion(incidente.id, a.id);
			toast.success(`Acción ${a.numero} vinculada`);
			onguardado(detalle);
		} catch (err) {
			toast.error(mensajeError(err, 'No se pudo vincular la acción'));
		} finally {
			guardando = false;
		}
	}
</script>

<ModalBase
	{open}
	tamano="md"
	eyebrow={`Investigación ${incidente.codigo}`}
	title="Acción correctiva"
	subtitle="Nace en el módulo de acciones correctivas con la fuente «Investigación de Incidente/Accidente»."
	cerrarAlFondo={!guardando}
	bloqueado={guardando}
	{oncerrar}
>
	{#snippet cabecera()}
		<div class="ma-pestanas" role="tablist">
			<button
				type="button"
				role="tab"
				aria-selected={modo === 'crear'}
				class:on={modo === 'crear'}
				onclick={() => (modo = 'crear')}
			>
				Crear nueva
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={modo === 'vincular'}
				class:on={modo === 'vincular'}
				onclick={() => (modo = 'vincular')}
			>
				Vincular existente
			</button>
		</div>
	{/snippet}

	{#snippet children()}
		{#if modo === 'crear'}
			<form
				id="form-accion-incidente"
				class="ma-grid"
				onsubmit={(e) => {
					e.preventDefault();
					void crear();
				}}
			>
				{#if error}<p class="ma-error de-full" role="alert">{error}</p>{/if}
				<Campo id="ma-hallazgo" label="Descripción del hallazgo" requerido completo>
					<textarea
						id="ma-hallazgo"
						class="ma-input"
						rows="3"
						maxlength="5000"
						bind:value={form.descripcion_hallazgo}
						required
					></textarea>
				</Campo>
				<Campo id="ma-tipo" label="Tipo de acción" requerido>
					<select id="ma-tipo" class="ma-input" bind:value={form.tipo_accion_ejecutar}>
						<option value="CORRECTIVA">Correctiva</option>
						<option value="PREVENTIVA">Preventiva</option>
						<option value="MEJORA">Mejora</option>
					</select>
				</Campo>
				<Campo id="ma-hallazgo-tipo" label="Tipo de hallazgo">
					<select id="ma-hallazgo-tipo" class="ma-input" bind:value={form.tipo_hallazgo_detectado}>
						<option value="">Sin clasificar</option>
						{#each TIPOS_HALLAZGO as t}<option value={t.value}>{t.label}</option>{/each}
					</select>
				</Campo>
				<Campo id="ma-riesgo" label="Valoración del riesgo">
					<select id="ma-riesgo" class="ma-input" bind:value={form.valoracion_riesgo}>
						<option value="">Sin valorar</option>
						<option value="ALTO">Alto</option>
						<option value="MEDIO">Medio</option>
						<option value="BAJO">Bajo</option>
					</select>
				</Campo>
				<Campo id="ma-numero" label="Número" ayuda="Vacío: se asigna AC-año-consecutivo">
					<input
						id="ma-numero"
						class="ma-input"
						type="text"
						maxlength="50"
						bind:value={form.accion_numero}
					/>
				</Campo>
				<Campo
					id="ma-plan"
					label="Plan de acción"
					completo
					ayuda="Queda como la primera causa de la acción, marcada como causa raíz"
				>
					<textarea
						id="ma-plan"
						class="ma-input"
						rows="3"
						maxlength="3000"
						placeholder="Qué se va a hacer para que no se repita"
						bind:value={form.plan_accion}
					></textarea>
				</Campo>
				<Campo id="ma-responsable" label="Responsable de ejecutarla">
					<input
						id="ma-responsable"
						class="ma-input"
						type="text"
						maxlength="255"
						bind:value={form.responsable_ejecucion}
					/>
				</Campo>
				<Campo id="ma-limite" label="Fecha límite">
					<input
						id="ma-limite"
						class="ma-input"
						type="date"
						bind:value={form.fecha_limite_implementacion}
					/>
				</Campo>
			</form>
		{:else}
			<div class="ma-vincular">
				<BuscadorLista
					valor={busqueda}
					onBuscar={(t) => {
						busqueda = t;
						void buscar(t);
					}}
					placeholder="Número o descripción de la acción…"
					etiqueta="Buscar acciones correctivas"
				/>
				{#if buscando && resultados.length === 0}
					<CargaMascota texto="Buscando acciones…" />
				{:else if resultados.length === 0}
					<p class="ma-nota">
						No hay acciones vigentes con ese texto (las ya vinculadas no aparecen).
					</p>
				{:else}
					<ul class="ma-lista">
						{#each resultados as a (a.id)}
							<li>
								<div>
									<strong>{a.numero}</strong>
									<span>{a.descripcion ?? 'Sin descripción'}</span>
									{#if a.fuente}<small>{a.fuente}</small>{/if}
								</div>
								<button
									type="button"
									class="btn-secondary ma-vincular-btn"
									disabled={guardando}
									onclick={() => vincular(a)}
								>
									<Link2 size={14} /> Vincular
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{/snippet}

	{#snippet pie()}
		<button type="button" class="btn-secondary" onclick={oncerrar} disabled={guardando}
			>Cerrar</button
		>
		{#if modo === 'crear'}
			<button type="submit" form="form-accion-incidente" class="btn-primary" disabled={guardando}>
				{guardando ? 'Creando…' : 'Crear y vincular'}
			</button>
		{/if}
	{/snippet}
</ModalBase>

<style>
	.ma-pestanas {
		display: inline-flex;
		gap: 4px;
		padding: 4px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.12);
	}
	.ma-pestanas button {
		padding: 6px 14px;
		border-radius: 9px;
		font-size: 13px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.8);
	}
	.ma-pestanas button.on {
		background: #fff;
		color: var(--emerald-800);
	}
	.ma-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 14px 16px;
	}
	.ma-grid :global(.de-full) {
		grid-column: 1 / -1;
	}
	.ma-input {
		width: 100%;
		min-height: 42px;
		padding: 9px 12px;
		border: 1px solid var(--border-default);
		border-radius: 12px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 14px;
	}
	textarea.ma-input {
		resize: vertical;
	}
	.ma-input:focus {
		outline: none;
		border-color: var(--accion);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accion) 18%, transparent);
	}
	.ma-error {
		margin: 0;
		padding: 10px 12px;
		border: 1px solid #fecaca;
		border-radius: 12px;
		background: #fef2f2;
		color: #991b1b;
		font-size: 13px;
	}
	.ma-vincular {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.ma-nota {
		margin: 0;
		font-size: 13px;
		color: var(--text-muted);
	}
	.ma-lista {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.ma-lista li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
	}
	.ma-lista li div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		font-size: 13px;
	}
	.ma-lista li span {
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.ma-lista li small {
		color: var(--text-muted);
	}
	.ma-vincular-btn {
		flex-shrink: 0;
		padding: 6px 12px;
		font-size: 13px;
	}
</style>
