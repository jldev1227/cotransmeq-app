<script lang="ts">
  type Pregunta = { enunciado: string; opciones: string[]; respuestaIndice: number };
  type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
  let { cursoId, preguntas, request, onSaved }: {
    cursoId: string; preguntas: Pregunta[]; request: Api; onSaved: () => Promise<void>
  } = $props();
  let banco = $state<Pregunta[]>(preguntas.map((p) => ({
    enunciado: p.enunciado, opciones: [...p.opciones], respuestaIndice: p.respuestaIndice
  })));
  let vista = $state<'editar' | 'previa'>('editar');
  let guardando = $state(false);
  let error = $state('');
  let aviso = $state('');

  function agregar() {
    banco = [...banco, { enunciado: '', opciones: ['', ''], respuestaIndice: 0 }];
  }
  function borrar(i: number) { banco = banco.filter((_, j) => i !== j); }
  function validar(): string {
    if (banco.length > 100) return 'El banco admite hasta 100 preguntas.';
    for (const [i, p] of banco.entries()) {
      if (!p.enunciado.trim()) return 'La pregunta ' + (i + 1) + ' no tiene enunciado.';
      if (p.opciones.length < 2 || p.opciones.some((x) => !x.trim())) return 'Completa todas las opciones de la pregunta ' + (i + 1) + '.';
      if (p.respuestaIndice < 0 || p.respuestaIndice >= p.opciones.length) return 'Selecciona la respuesta correcta de la pregunta ' + (i + 1) + '.';
    }
    return '';
  }
  async function guardar() {
    const problema = validar();
    if (problema) { error = problema; return; }
    guardando = true; error = ''; aviso = '';
    try {
      await request('/gestion/cursos/' + cursoId + '/preguntas', 'PUT', {
        preguntas: banco.map((p) => ({
          enunciado: p.enunciado.trim(), opciones: p.opciones.map((x) => x.trim()),
          respuestaIndice: p.respuestaIndice
        }))
      });
      await onSaved(); aviso = 'Banco de preguntas guardado.';
    } catch (cause: any) {
      error = cause?.response?.data?.message ?? cause?.message ?? 'No se pudo guardar el banco.';
    } finally { guardando = false; }
  }
  async function importar(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!Array.isArray(raw)) throw new Error('El archivo debe contener un arreglo de preguntas.');
      banco = raw.map((p) => ({
        enunciado: String(p.enunciado ?? ''),
        opciones: Array.isArray(p.opciones) ? p.opciones.map(String) : ['', ''],
        respuestaIndice: Number(p.respuestaIndice ?? 0)
      }));
      const problema = validar();
      if (problema) throw new Error(problema);
      aviso = banco.length + ' preguntas importadas. Revisa la vista previa y guarda.';
      error = '';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Archivo inválido.'; }
    (event.currentTarget as HTMLInputElement).value = '';
  }
</script>

<section class="bank" aria-label="Banco de preguntas">
  <header><div><p class="eyebrow">Evaluación del curso</p><h3>Banco de preguntas</h3>
    <p>{banco.length} preguntas · {banco.length ? 'una respuesta correcta por pregunta' : 'agrega la primera pregunta'}</p></div>
    <div class="actions"><button class:active={vista === 'editar'} onclick={() => vista = 'editar'}>Editar</button>
      <button class:active={vista === 'previa'} onclick={() => vista = 'previa'}>Vista previa</button>
      <button class="primary" onclick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar banco'}</button></div>
  </header>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  {#if aviso}<p role="status" class="notice">{aviso}</p>{/if}
  {#if vista === 'editar'}
    <div class="tools"><button onclick={agregar}>+ Agregar pregunta</button>
      <label>Importar JSON <input type="file" accept=".json,application/json" onchange={(e) => void importar(e)} /></label></div>
    {#each banco as pregunta, i}
      <fieldset><legend>Pregunta {i + 1}</legend>
        <label>Enunciado <textarea rows="2" bind:value={pregunta.enunciado}></textarea></label>
        <p class="hint">Marca la respuesta correcta.</p>
        {#each pregunta.opciones as opcion, j}
          <div class="option"><input type="radio" name={'correcta-' + i} checked={pregunta.respuestaIndice === j}
            aria-label={'Opción ' + (j + 1) + ' correcta'} onchange={() => pregunta.respuestaIndice = j} />
            <input aria-label={'Texto de la opción ' + (j + 1)} bind:value={pregunta.opciones[j]} />
            {#if pregunta.opciones.length > 2}<button aria-label={'Eliminar opción ' + (j + 1)}
              onclick={() => { pregunta.opciones = pregunta.opciones.filter((_, k) => k !== j); if (pregunta.respuestaIndice >= pregunta.opciones.length) pregunta.respuestaIndice = 0; }}>×</button>{/if}
          </div>
        {/each}
        <div class="actions"><button disabled={pregunta.opciones.length >= 8} onclick={() => pregunta.opciones = [...pregunta.opciones, '']}>+ Opción</button>
          <button class="danger" onclick={() => borrar(i)}>Eliminar pregunta</button></div>
      </fieldset>
    {/each}
  {:else}
    {#if !banco.length}<p class="empty">Todavía no hay preguntas para previsualizar.</p>{/if}
    {#each banco as pregunta, i}
      <fieldset><legend>{i + 1}. {pregunta.enunciado || 'Pregunta sin enunciado'}</legend>
        {#each pregunta.opciones as opcion, j}<label class="answer">
          <input type="radio" name={'previa-' + i} disabled /> {opcion || 'Opción sin texto'}
          {#if j === pregunta.respuestaIndice}<small>Correcta</small>{/if}
        </label>{/each}
      </fieldset>
    {/each}
  {/if}
</section>

<style>
  .bank{min-width:0;border:1px solid var(--border-subtle);border-radius:20px;background:var(--bg-surface);padding:1.25rem 1.4rem;box-shadow:var(--shadow-card)}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--border-subtle);padding-bottom:1rem}header>div:first-child{display:grid;gap:.25rem;min-width:0}h3{margin:0;color:var(--text-primary);font-family:var(--font-display);font-size:1rem;font-weight:850;letter-spacing:-.015em}.bank header p:last-child{margin:0;color:var(--text-muted);font-size:.75rem;line-height:1.45}.eyebrow{margin:0;color:var(--au-primary-strong);font-size:.64rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}
  .actions,.tools{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem}.tools{justify-content:space-between;margin:1rem 0}.tools label{display:grid;gap:.35rem;margin:0;color:var(--text-secondary);font-size:.7rem;font-weight:750}.tools input[type=file]{max-width:100%;border:1px solid var(--border-default);border-radius:11px;background:var(--bg-base);padding:.45rem .6rem;color:var(--text-muted);font:inherit;font-size:.68rem}
  button{min-height:39px;border:1px solid var(--border-default);border-radius:11px;background:var(--bg-surface);padding:.55rem .75rem;color:var(--text-secondary);font:inherit;font-size:.72rem;font-weight:750;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,color .15s ease,box-shadow .15s ease}button:hover:not(:disabled){border-color:var(--border-emphasis);background:var(--bg-base)}button:focus-visible{outline:2px solid var(--au-primary);outline-offset:2px}.actions button.active{border-color:color-mix(in srgb,var(--au-primary-strong) 24%,var(--border-default));background:var(--au-tint);color:var(--au-primary-strong)}.primary{border-color:var(--au-primary);background:var(--au-primary);color:#fff}.primary:hover:not(:disabled){border-color:var(--au-primary-strong);background:var(--au-primary-strong)}.danger{border-color:#f2c9c5;background:var(--au-danger-soft);color:var(--au-danger)}.danger:hover:not(:disabled){border-color:var(--au-danger);background:#ffe4df}button:disabled{opacity:.5;cursor:not-allowed}
  fieldset{min-width:0;border:1px solid var(--border-subtle);border-radius:16px;margin:1rem 0 0;background:var(--bg-base);padding:1rem}legend{border:1px solid var(--border-subtle);border-radius:999px;background:var(--bg-surface);padding:.3rem .65rem;color:var(--text-primary);font-size:.72rem;font-weight:850}
  label{display:block;margin:.7rem 0;color:var(--text-secondary);font-size:.72rem;font-weight:750}textarea,.option input:not([type=radio]){display:block;width:100%;min-width:0;box-sizing:border-box;margin:.4rem 0 0;border:1px solid var(--border-default);border-radius:12px;background:var(--bg-surface);padding:.65rem .75rem;color:var(--text-primary);font:inherit;font-size:.76rem}textarea{min-height:82px;resize:vertical;line-height:1.5}textarea:focus-visible,.option input:not([type=radio]):focus-visible{outline:0;border-color:var(--au-primary);box-shadow:0 0 0 3px rgba(var(--au-primary-rgb),.13)}
  .option{display:flex;align-items:center;gap:.65rem;margin:.55rem 0}.option input[type=radio]{width:17px;height:17px;flex:none;margin:0;accent-color:var(--au-primary-strong)}.option button{flex:none;min-width:39px;font-size:1.1rem}.hint,.empty{color:var(--text-muted);font-size:.72rem;line-height:1.45}.hint{margin:.25rem 0}.empty{border:1px dashed var(--border-default);border-radius:14px;background:var(--bg-base);padding:1rem}.answer{display:flex;align-items:center;gap:.5rem;margin:.45rem 0;border:1px solid var(--border-subtle);border-radius:11px;background:var(--bg-surface);padding:.6rem .7rem;color:var(--text-secondary);font-weight:550}.answer input{width:16px;height:16px;margin:0;accent-color:var(--au-primary-strong)}.answer small{margin-left:auto;color:var(--au-primary-strong);font-size:.66rem;font-weight:800}
  .error,.notice{margin:.75rem 0;border-radius:12px;padding:.7rem .85rem;font-size:.74rem;line-height:1.45}.error{border:1px solid #f2c9c5;background:var(--au-danger-soft);color:var(--au-danger)}.notice{border:1px solid color-mix(in srgb,var(--au-primary-strong) 18%,var(--border-default));background:var(--au-tint);color:var(--au-primary-strong)}
  @media(max-width:700px){.bank{padding:1rem}header{display:flex;flex-direction:column}.actions{width:100%}.actions>*{flex:1}.tools{align-items:stretch;flex-direction:column}.tools label,.tools input[type=file]{width:100%;box-sizing:border-box}.option{align-items:flex-start}.option input:not([type=radio]){margin-top:0}}
</style>
