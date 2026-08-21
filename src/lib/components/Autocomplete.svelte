<script lang="ts" context="module">
  export type AutocompleteOption = { id: string; label: string; [key: string]: any };
</script>

<script lang="ts" generics="T">
  import { createEventDispatcher, tick, onMount, onDestroy } from 'svelte';

  export let value: string = '';
  export let options: AutocompleteOption[] = [];
  export let placeholder: string = '🔍 Buscar...';
  export let disabled: boolean = false;
  /**
   * Tope de opciones dibujadas. `0` = sin tope, que es el valor por defecto.
   *
   * Antes recortaba a 20 en las DOS ramas —con y sin búsqueda—, así que una
   * flota de cientos de placas se veía como una lista de 20 y nada avisaba del
   * resto: el buscador acertaba, pero abrir el desplegable mentía sobre el
   * tamaño del catálogo. El dropdown ya tiene alto máximo y scroll, así que
   * dibujar unos cientos de opciones no cuesta nada y no confunde.
   */
  export let maxResults: number = 0;
  export let dropdownZIndex: number = 9999;
  /**
   * Id y etiqueta accesible del input interno. Opcionales: quien monte el
   * componente dentro de un `<label>` no los necesita, pero quien lo use suelto
   * —el portal del conductor, donde la etiqueta va aparte— sí, o el campo queda
   * sin nombre para el lector de pantalla.
   */
  export let inputId: string = '';
  export let ariaLabel: string = '';

  /// A partir de aquí la lista ya no cabe en el alto del dropdown, así que hay
  /// scroll y conviene decir cuántas opciones hay en total.
  const VISIBLES_SIN_SCROLL = 6;

  // Estado interno (no se exporta)
  let query: string = '';
  let open: boolean = false;
  let highlighted: number = 0;
  let inputEl: HTMLInputElement;
  let dropdownEl: HTMLDivElement;

  // Clave: distingue "el usuario está escribiendo" de "el padre cambió `value`"
  let isTyping: boolean = false;
  let lastSyncedValue: string | undefined; // último `value` que ya reflejamos en `query`

  const dispatch = createEventDispatcher<{
    select: AutocompleteOption;
    change: string;
    clear: void;
  }>();

  // Filtro reactivo: siempre basado en `query` (lo que el usuario ve en el input)
  $: q = (query || '').toLowerCase().trim();
  // Todas las coincidencias, sin recortar: es lo que hay que contar para poder
  // decir la verdad sobre cuántas opciones existen.
  $: coincidencias = q
    ? options.filter(o => (o.label || '').toLowerCase().includes(q))
    : options;
  $: filtered = maxResults > 0 ? coincidencias.slice(0, maxResults) : coincidencias;
  $: ocultas = coincidencias.length - filtered.length;

  $: if (filtered.length > 0 && highlighted >= filtered.length) {
    highlighted = filtered.length - 1;
  }

  // Cuando cambia la lista filtrada, reseteamos el scroll interno del dropdown
  // para que las opciones más cercanas al search input queden siempre visibles.
  // - Placement "below": la primera opción está más cerca del input → scrollTop = 0
  // - Placement "above": la última opción está más cerca del input → scrollTop = max
  // Sin esto, el usuario queda "scrolleado más allá" del final de la lista
  // nueva y pierde la referencia visual del input.
  $: if (dropdownEl && filtered) {
    if (dropdownPlacement === 'above') {
      dropdownEl.scrollTop = dropdownEl.scrollHeight;
    } else {
      dropdownEl.scrollTop = 0;
    }
  }

  // Cuando se selecciona un item por código, sincronizar `value` y `query`
  export function setSelected(opt: AutocompleteOption | null) {
    isTyping = false;
    if (opt) {
      value = opt.id;
      query = opt.label;
      lastSyncedValue = opt.id;
      dispatch('select', opt);
    } else {
      value = '';
      query = '';
      lastSyncedValue = '';
      dispatch('clear');
    }
    open = false;
  }

  // Solo sincronizamos `query` desde `value` cuando el cambio viene DE AFUERA
  // (es decir, el usuario no está escribiendo y el valor es distinto al último que ya sincronizamos)
  $: if (!isTyping && value !== lastSyncedValue) {
    const match = options.find(o => o.id === value);
    query = match ? match.label : '';
    lastSyncedValue = value;
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    isTyping = true;
    query = target.value;
    open = true;
    highlighted = 0;
    scheduleUpdate();

    // Si escribe y no coincide con el id actual, limpiar selección
    if (value) {
      const match = options.find(o => o.id === value);
      if (!match || match.label !== query) {
        value = '';
        lastSyncedValue = '';
        dispatch('change', query);
      }
    } else {
      dispatch('change', query);
    }
  }

  function handleFocus() {
    scheduleUpdate();
    open = true;
    highlighted = 0;
  }

  // Posición calculada para position: fixed (escapa del overflow de los ancestros)
  // Usa el Visual Viewport API para evitar que el teclado del móvil tape el dropdown.
  // Si no hay espacio suficiente debajo del input, el dropdown se voltea ARRIBA.
  let dropdownStyle: string = '';
  let dropdownPlacement: 'above' | 'below' = 'below';

  function updateDropdownPosition() {
    if (!inputEl) return;
    const r = inputEl.getBoundingClientRect();
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const visualViewportHeight = vv ? vv.height : window.innerHeight;
    const layoutViewportHeight = window.innerHeight;
    const offsetTop = vv ? vv.offsetTop : 0;

    // El dropdown vive dentro del .modal-overlay que tiene `backdrop-filter`,
    // lo que crea un containing block para position:fixed. El modal-overlay
    // está anclado al LAYOUT viewport (con `position:fixed; inset:0`), por
    // lo que `top` y `bottom` se interpretan en coords del layout viewport,
    // no del visual viewport. Usar coords del visual viewport aquí causa un
    // error acumulado en cada focus (cada apertura de teclado el cálculo se
    // desfasa más).
    const inputTopVis = r.top - offsetTop;
    const inputBottomVis = r.bottom - offsetTop;

    // El espacio disponible para decidir el flip y limitar el alto debe
    // medirse en el VISUAL viewport (lo que el usuario realmente ve).
    const spaceBelow = visualViewportHeight - inputBottomVis;
    const spaceAbove = inputTopVis;

    const gap = 6;
    const preferredMaxHeight = 240;
    const minSpaceForBelow = 80;

    let top: number | null = null;
    let bottom: number | null = null;
    let maxHeight: number;

    if (spaceBelow >= minSpaceForBelow || spaceBelow >= spaceAbove) {
      // "below": top en coords del layout viewport (r.bottom ya está en layout)
      top = r.bottom + gap;
      maxHeight = Math.max(60, Math.min(preferredMaxHeight, spaceBelow - gap));
      dropdownPlacement = 'below';
    } else {
      // "above": bottom en coords del layout viewport.
      // bottom = distancia desde el bottom del layout viewport hasta el bottom
      // del dropdown. El bottom del dropdown debe estar en r.top - gap.
      // bottom = layoutViewportHeight - (r.top - gap) = layoutViewportHeight - r.top + gap
      maxHeight = Math.max(60, Math.min(preferredMaxHeight, spaceAbove - gap));
      bottom = layoutViewportHeight - r.top + gap;
      dropdownPlacement = 'above';
    }

    if (top !== null) {
      dropdownStyle = `top: ${top}px; left: ${r.left}px; width: ${r.width}px; max-height: ${maxHeight}px;`;
    } else {
      dropdownStyle = `bottom: ${bottom}px; left: ${r.left}px; width: ${r.width}px; max-height: ${maxHeight}px;`;
    }
  }

  function handleViewportChange() {
    scheduleUpdate();
  }

  // requestAnimationFrame: agrupa múltiples eventos (scroll, resize, input) en
  // un único recálculo por frame. Esto elimina el "salto" visible del dropdown
  // cuando el usuario hace scroll continuo con el teclado del móvil abierto.
  let rafId: number | null = null;
  function scheduleUpdate() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (open) updateDropdownPosition();
    });
  }

  onMount(() => {
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', handleViewportChange);
      vv.addEventListener('scroll', handleViewportChange);
    }
    window.addEventListener('resize', handleViewportChange);
    // Capturar scroll de cualquier ancestro (el modal tiene overflow-y:auto)
    document.addEventListener('scroll', handleViewportChange, { capture: true, passive: true });
  });

  onDestroy(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    const vv = window.visualViewport;
    if (vv) {
      vv.removeEventListener('resize', handleViewportChange);
      vv.removeEventListener('scroll', handleViewportChange);
    }
    window.removeEventListener('resize', handleViewportChange);
    document.removeEventListener('scroll', handleViewportChange, { capture: true } as EventListenerOptions);
  });

  function handleBlur() {
    // Delay para permitir click en opción
    setTimeout(() => {
      open = false;
      isTyping = false;
      // Si al perder foco hay un valor seleccionado, restaurar el label
      if (value) {
        const match = options.find(o => o.id === value);
        query = match ? match.label : '';
        lastSyncedValue = value;
      } else {
        // Si no hay selección, vaciar el input
        query = '';
        lastSyncedValue = '';
      }
    }, 180);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      open = true;
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = Math.min(highlighted + 1, filtered.length - 1);
      scrollHighlightedIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
      scrollHighlightedIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = filtered[highlighted];
      if (sel) setSelected(sel);
    } else if (e.key === 'Escape') {
      open = false;
    }
  }

  function pickOption(opt: AutocompleteOption) {
    setSelected(opt);
  }

  function scrollHighlightedIntoView() {
    if (!dropdownEl) return;
    const optionEl = dropdownEl.querySelector(`[data-idx="${highlighted}"]`) as HTMLElement | null;
    if (optionEl) optionEl.scrollIntoView({ block: 'nearest' });
  }

  function clearSelection() {
    isTyping = false;
    value = '';
    query = '';
    lastSyncedValue = '';
    open = false;
    dispatch('clear');
    tick().then(() => inputEl?.focus());
  }

  function highlightMatch(text: string): string {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) return text;
    return (
      text.slice(0, idx) +
      '<mark>' + text.slice(idx, idx + q.length) + '</mark>' +
      text.slice(idx + q.length)
    );
  }
</script>

<div class="autocomplete">
  <div class="autocomplete-input-wrap">
    <input
      bind:this={inputEl}
      type="text"
      id={inputId || undefined}
      aria-label={ariaLabel || undefined}
      {placeholder}
      {disabled}
      value={query}
      on:input={handleInput}
      on:focus={handleFocus}
      on:blur={handleBlur}
      on:keydown={handleKeydown}
      class="autocomplete-field"
      class:has-value={!!value}
      autocomplete="off"
      role="combobox"
      aria-expanded={open}
      aria-autocomplete="list"
    />
    {#if value}
      <button
        type="button"
        class="autocomplete-clear"
        on:mousedown|preventDefault={clearSelection}
        title="Limpiar"
      >✕</button>
    {/if}
  </div>

  {#if open && filtered.length > 0}
    <div
      bind:this={dropdownEl}
      class="autocomplete-dropdown placement-{dropdownPlacement}"
      style={dropdownStyle}
      role="listbox"
    >
      {#each filtered as opt, i (opt.id)}
        <button
          type="button"
          class="autocomplete-option"
          class:selected={value === opt.id}
          class:highlighted={i === highlighted}
          on:mousedown|preventDefault={() => pickOption(opt)}
          on:mouseenter={() => { highlighted = i; }}
          role="option"
          aria-selected={value === opt.id}
          data-idx={i}
        >{@html highlightMatch(opt.label)}</button>
      {/each}

      <!-- Pie fijo con el conteo. Con una lista larga, ver 15 opciones en
           pantalla sin saber si son todas o el principio de 300 es justo lo que
           desorienta; el número lo resuelve sin obligar a hacer scroll. -->
      {#if ocultas > 0}
        <div class="autocomplete-pie">
          Mostrando {filtered.length} de {coincidencias.length} · escribe para afinar
        </div>
      {:else if coincidencias.length > VISIBLES_SIN_SCROLL}
        <div class="autocomplete-pie">
          {coincidencias.length}
          {q ? 'coincidencias' : 'opciones'} · escribe para filtrar
        </div>
      {/if}
    </div>
  {:else if open && q && filtered.length === 0}
    <div
      bind:this={dropdownEl}
      class="autocomplete-dropdown placement-{dropdownPlacement}"
      style={dropdownStyle}
    >
      <div class="autocomplete-empty">Sin resultados para "{query}"</div>
    </div>
  {/if}
</div>

<style>
  .autocomplete {
    position: relative;
    width: 100%;
  }
  .autocomplete-input-wrap {
    position: relative;
  }
  .autocomplete-field {
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 2rem 0.55rem 0.7rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    font-size: 0.9rem;
    background: var(--surface, #fff);
    color: var(--text, #0f172a);
    outline: none;
    font-family: inherit;
  }
  .autocomplete-field:focus {
    border-color: #ea580c;
    box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.1);
  }
  .autocomplete-field.has-value {
    border-color: #ea580c;
    background: rgba(234, 88, 12, 0.04);
  }
  .autocomplete-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text3, #94a3b8);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .autocomplete-clear:hover { color: #dc2626; }
  .autocomplete-dropdown {
    position: fixed;
    z-index: 9999;
    background: var(--surface, #fff);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    max-height: 220px;
    overflow-y: auto;
  }
  .autocomplete-option {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.55rem 0.75rem;
    border: none;
    background: none;
    font-size: 0.85rem;
    color: var(--text, #0f172a);
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s;
  }
  .autocomplete-option:hover,
  .autocomplete-option.highlighted {
    background: rgba(234, 88, 12, 0.08);
  }
  .autocomplete-option.selected {
    background: rgba(234, 88, 12, 0.12);
    color: #047857;
    font-weight: 700;
  }
  .autocomplete-option :global(mark) {
    background: #fef08a;
    color: #0f172a;
    padding: 0 1px;
    border-radius: 2px;
  }
  .autocomplete-option:first-child { border-radius: 10px 10px 0 0; }
  .autocomplete-option:last-child { border-radius: 0 0 10px 0; }

  /* Cuando el dropdown se voltea ARRIBA del input (típico: teclado del móvil),
     invertimos el border-radius para que las opciones pegadas al input queden
     con la esquina inferior redondeada. */
  .autocomplete-dropdown.placement-above {
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.18);
  }
  .autocomplete-dropdown.placement-above .autocomplete-option:first-child { border-radius: 0 0 10px 10px; }
  .autocomplete-dropdown.placement-above .autocomplete-option:last-child { border-radius: 10px 10px 0 0; }
  .autocomplete-empty {
    padding: 0.65rem 0.75rem;
    font-size: 0.82rem;
    color: var(--text3, #94a3b8);
    text-align: center;
    font-style: italic;
  }
  /* Pegado al fondo del dropdown: si scrollease con la lista, el conteo
     desaparecería justo cuando la lista es larga, que es cuando sirve. */
  .autocomplete-pie {
    position: sticky;
    bottom: 0;
    padding: 0.4rem 0.75rem;
    font-size: 0.7rem;
    color: var(--text3, #94a3b8);
    text-align: center;
    background: var(--surface, #fff);
    border-top: 1px solid var(--border, #e2e8f0);
  }
</style>