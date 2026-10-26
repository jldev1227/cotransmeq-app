<script lang="ts">
  import Capacitaciones from '$lib/components/capacitaciones/Capacitaciones.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<Capacitaciones empresa="Cotransmeq" vistaInicial="gestion" cursoId={data.cursoId} avisoInicial={data.aviso} />
