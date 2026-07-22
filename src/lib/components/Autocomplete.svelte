<script lang="ts" context="module">
  export type AutocompleteOption = { id: string; label: string; [key: string]: any };
</script>

<script lang="ts" generics="T">
  import { createEventDispatcher, tick, onMount, onDestroy } from 'svelte';

  export let value: string = '';
  export let options: AutocompleteOption[] = [];
  export let placeholder: string = '🔍 Buscar...';
  export let disabled: boolean = false;
  export let maxResults: number = 20;
  export let dropdownZIndex: number = 9999;

  // Estado interno (no se exporta)
  let query: string = '';
  let open: boolean = false;
  let highlighted: number = 0;
  let inputEl: HTMLInputElement;

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
  $: filtered = q
    ? options.filter(o => (o.label || '').toLowerCase().includes(q)).slice(0, maxResults)
    : options.slice(0, maxResults);

  $: if (filtered.length > 0 && highlighted >= filtered.length) {
    highlighted = filtered.length - 1;
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
    updateDropdownPosition();
    open = true;
    highlighted = 0;
  }

  // Posición calculada para position: fixed (escapa del overflow de los ancestros)
  let dropdownStyle: string = '';
  function updateDropdownPosition() {
    if (!inputEl) return;
    const r = inputEl.getBoundingClientRect();
    dropdownStyle = `top: ${r.bottom + 4}px; left: ${r.left}px; width: ${r.width}px;`;
  }

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
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
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
    <div class="autocomplete-dropdown" style={dropdownStyle} role="listbox">
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
        >{@html highlightMatch(opt.label)}</button>
      {/each}
    </div>
  {:else if open && q && filtered.length === 0}
    <div class="autocomplete-dropdown" style={dropdownStyle}>
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
  .autocomplete-empty {
    padding: 0.65rem 0.75rem;
    font-size: 0.82rem;
    color: var(--text3, #94a3b8);
    text-align: center;
    font-style: italic;
  }
</style>