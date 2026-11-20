<script lang="ts">
	import { onMount } from 'svelte';
	import { planTrabajoApi } from '$lib/api/plan-trabajo';

	let tareas = $state<any[]>([]);
	let cargando = $state(true);
	let ocupada = $state('');
	let error = $state('');

	async function cargar() {
		try { tareas = await planTrabajoApi.misActividades(); error = ''; }
		catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudieron cargar las tareas.'; }
		finally { cargando = false; }
	}

	async function adjuntar(id: string, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const archivo = input.files?.[0];
		if (!archivo) return;
		ocupada = id;
		try { await planTrabajoApi.subirEvidenciaPropia(id, archivo); await cargar(); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudo subir la evidencia.'; }
		finally { ocupada = ''; input.value = ''; }
	}

	async function completar(id: string) {
		ocupada = id;
		try { await planTrabajoApi.completarPropia(id); await cargar(); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudo completar la tarea.'; }
		finally { ocupada = ''; }
	}

	onMount(() => { void cargar(); });
</script>

<svelte:head><title>Mis actividades HSEQ/PESV</title></svelte:head>
<main>
	<header><div><p>HSEQ · PESV</p><h1>Mis actividades</h1></div><a href="/dashboard/plan-trabajo">Ver plan</a></header>
	{#if error}<p role="alert">{error}</p>{/if}
	{#if cargando}<p>Cargando actividades…</p>
	{:else if !tareas.length}<p>No tienes actividades asignadas.</p>
	{:else}
		<section class="lista">
			{#each tareas as tarea (tarea.id)}
				<article>
					<p>{tarea.ocurrencia.actividad.unidad_programa}</p>
					<h2>{tarea.ocurrencia.actividad.actividad}</h2>
					<p>Tu avance: <strong>{tarea.realizados}/{tarea.cuota}</strong> · Corte: {new Date(tarea.ocurrencia.fecha_vencimiento).toLocaleDateString('es-CO')}</p>
					{#if tarea.cortes.find((_: string, indice: number) => !tarea.ventanas.includes(indice))}
						<p>Próximo corte: {new Date(tarea.cortes.find((_: string, indice: number) => !tarea.ventanas.includes(indice))).toLocaleDateString('es-CO')}</p>
					{/if}
					{#if tarea.completada_at}<strong>Completada</strong>
					{:else}
						<div class="acciones">
							{#if tarea.form_assignment_id}
								<a href="/dashboard/mis-formularios/{tarea.form_assignment_id}">Diligenciar formulario</a>
							{:else if tarea.ocurrencia.actividad.requiere_evidencia || tarea.cuota > 1}
								<label>Adjuntar evidencia <input type="file" accept="image/*,application/pdf,.docx,.xlsx" disabled={ocupada === tarea.id} onchange={(event) => adjuntar(tarea.id, event)} /></label>
							{/if}
							<button disabled={ocupada === tarea.id || (tarea.cuota > 1 || tarea.form_assignment_id || tarea.ocurrencia.actividad.requiere_evidencia) && tarea.realizados < tarea.cuota} onclick={() => completar(tarea.id)}>Marcar completada</button>
						</div>
					{/if}
				</article>
			{/each}
		</section>
	{/if}
</main>
<style>
	main { padding: 1.25rem; display: grid; gap: 1rem; }
	header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	h1 { margin: 0; }
	.lista { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 1rem; }
	article { padding: 1.2rem; border: 1px solid #dce8df; border-radius: 1rem; background: white; }
	article h2 { font-size: 1.15rem; }
	.acciones { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
	button, .acciones a { padding: .7rem 1rem; border: 0; border-radius: .7rem; background: #059669; color: white; font-weight: 700; cursor: pointer; }
	button:disabled { opacity: .5; cursor: default; }
</style>
