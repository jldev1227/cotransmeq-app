<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { getApiBase } from '$lib/stores/portalStore';

  let certificado: any = $state(null);
  let error = $state('');
  let cargando = $state(true);
  onMount(async () => {
    try {
      const response = await fetch(getApiBase() + '/api/capacitaciones/certificados/verificar/' +
        encodeURIComponent(page.params.codigo ?? ''));
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Certificado no encontrado.');
      certificado = result.data;
    } catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudo verificar el certificado.'; }
    finally { cargando = false; }
  });
</script>

<svelte:head><title>Verificación de certificado | Cotransmeq</title></svelte:head>
<main>
  {#if cargando}<p role="status">Verificando certificado…</p>
  {:else if error}<p role="alert">{error}</p>
  {:else if certificado}
    <p class="eyebrow">Certificación de capacitación · Cotransmeq</p>
    <h1>Certificado {certificado.vigente ? 'válido' : 'vencido'}</h1>
    <p>Se certifica que <strong>{certificado.nombre}</strong> completó la capacitación
      <strong>{certificado.curso}</strong>.</p>
    <dl>
      <dt>Código</dt><dd>{certificado.codigo}</dd>
      <dt>Emisión</dt><dd>{new Date(certificado.emitidoAt).toLocaleDateString('es-CO')}</dd>
      {#if certificado.vigenteHasta}<dt>Vigencia hasta</dt>
        <dd>{new Date(certificado.vigenteHasta).toLocaleDateString('es-CO')}</dd>{/if}
    </dl>
    <button onclick={() => window.print()}>Imprimir certificado</button>
  {/if}
</main>
<style>
  main{max-width:760px;margin:5vh auto;padding:clamp(24px,6vw,70px);background:white;border:1px solid #d6e6de;border-radius:18px;color:#173b31;box-shadow:0 12px 50px #173b3112}
  .eyebrow{text-transform:uppercase;letter-spacing:.15em;font-size:12px;color:#52796b}
  h1{font-size:clamp(30px,5vw,52px)}p{line-height:1.7;font-size:18px}dl{display:grid;grid-template-columns:130px 1fr;gap:12px}dt{font-weight:700}
  button{background:#116b50;border:0;border-radius:8px;color:white;padding:12px 18px;cursor:pointer}
  @media print{main{box-shadow:none;border:0;margin:0}button{display:none}}
</style>
