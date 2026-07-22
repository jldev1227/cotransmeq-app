<script lang="ts">
  import { tick } from 'svelte';

  export let value: string = '';
  export let placeholder: string = 'Seleccionar...';
  export let options: string[] = [];
  export let disabled: boolean = false;
  export let fullWidth: boolean = true;
  export let uppercase: boolean = true;
  export let onSelect: (value: string) => void = () => {};
  export let onChange: (value: string) => void = () => {};

  let inputEl: HTMLInputElement;
  let open = false;
  let activeIdx = -1;
  let filterText = '';
  let inputElWidth = 0;

  $: normalizedOptions = options.map((o) => (uppercase ? o.toUpperCase() : o));
  $: displayOptions = normalizedOptions.map((o) => ({
    raw: o,
    label: o.replace(/_/g, ' '),
  }));
  $: filtered = filterText
    ? displayOptions.filter((o) => o.label.toLowerCase().includes(filterText.toLowerCase()))
    : displayOptions;

  function onFocus() {
    if (disabled) return;
    filterText = '';
    activeIdx = -1;
    open = true;
    if (inputEl) inputElWidth = inputEl.getBoundingClientRect().width;
  }

  function onInput(e: Event) {
    const t = e.currentTarget as HTMLInputElement;
    filterText = t.value;
    open = true;
    activeIdx = filtered.length > 0 ? 0 : -1;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        open = true;
      }
      activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIdx >= 0 && filtered[activeIdx]) {
        selectOption(filtered[activeIdx].raw);
      } else if (filterText.trim()) {
        const normalized = uppercase
          ? filterText.trim().toUpperCase().replace(/\s+/g, '_')
          : filterText.trim();
        if (!normalized) return;
        if (!normalizedOptions.includes(normalized) && options.length > 0) {
          options = [...options, normalized];
        }
        selectOption(normalized);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      open = false;
      filterText = '';
      activeIdx = -1;
    } else if (e.key === 'Tab') {
      open = false;
    }
  }

  function selectOption(opt: string) {
    value = opt;
    open = false;
    filterText = '';
    activeIdx = -1;
    onSelect(opt);
    onChange(opt);
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousedown', handleClickOutside);
    }
    tick().then(() => {
      value = '';
      if (inputEl) {
        inputEl.value = '';
        inputEl.blur();
      }
    });
  }

  function handleClickOutside(e: MouseEvent) {
    if (!open) return;
    const target = e.target as HTMLElement;
    if (!target.closest('.cell-select-wrap')) {
      open = false;
      filterText = '';
      activeIdx = -1;
    }
  }

  $: if (typeof window !== 'undefined') {
    if (open) {
      window.addEventListener('mousedown', handleClickOutside);
    } else {
      window.removeEventListener('mousedown', handleClickOutside);
    }
  }

  $: showDropdown = open && filtered.length > 0;
</script>

<div class="cell-select-wrap" class:full-width={fullWidth}>
  <input
    bind:this={inputEl}
    type="text"
    class="cell-select-input"
    class:has-value={value}
    {placeholder}
    {disabled}
    autocomplete="off"
    value={open ? filterText : value ? value.replace(/_/g, ' ') : ''}
    on:focus={onFocus}
    on:input={onInput}
    on:keydown={onKeyDown}
  />

  <svg
    class="cell-select-chevron"
    class:open
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>

  {#if showDropdown}
    <div class="cell-select-dropdown" style="width: {inputElWidth}px;">
      <div class="cell-select-dropdown-header">
        {filtered.length} {filtered.length === 1 ? 'opción' : 'opciones'}
        {#if filterText}
          <span class="cell-select-filter-hint">· Enter para crear "{filterText}"</span>
        {/if}
      </div>
      <ul class="cell-select-list" role="listbox">
        {#each filtered as opt, i (opt.raw)}
          <li
            class="cell-select-option"
            class:active={i === activeIdx}
            role="option"
            aria-selected={i === activeIdx}
            on:mousedown|preventDefault={() => selectOption(opt.raw)}
            on:mouseenter={() => (activeIdx = i)}
          >
            <span class="cell-select-option-label">{opt.label}</span>
            {#if i === activeIdx}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .cell-select-wrap {
    position: relative;
    display: inline-block;
  }
  .cell-select-wrap.full-width {
    display: block;
    width: 100%;
  }

  .cell-select-input {
    width: 100%;
    padding: 5px 26px 5px 10px;
    border: 1px dashed #cbd5e1;
    border-radius: 4px;
    font-size: 11px;
    font-family: inherit;
    color: #64748b;
    background: transparent;
    outline: none;
    cursor: text;
    transition: all 0.15s ease;
  }
  .cell-select-input.has-value {
    color: #0f172a;
    font-weight: 600;
    border-style: solid;
    border-color: #f97316;
    background: #f0fdf4;
  }
  .cell-select-input::placeholder {
    color: #94a3b8;
    font-style: italic;
  }
  .cell-select-input:hover {
    border-color: #ea580c;
    color: #ea580c;
  }
  .cell-select-input:focus,
  .cell-select-input.has-value:focus {
    border-color: #ea580c;
    color: #0f172a;
    border-style: solid;
    background: #fff;
    box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.15);
  }
  .cell-select-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cell-select-chevron {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: #94a3b8;
    pointer-events: none;
    transition: transform 0.2s ease, color 0.15s ease;
  }
  .cell-select-chevron.open {
    transform: translateY(-50%) rotate(180deg);
    color: #ea580c;
  }
  .cell-select-input:focus ~ .cell-select-chevron {
    color: #ea580c;
  }

  .cell-select-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 50;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.04);
    overflow: hidden;
    animation: dropdownIn 0.15s ease-out;
  }
  @keyframes dropdownIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .cell-select-dropdown-header {
    padding: 6px 10px;
    font-size: 10px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }
  .cell-select-filter-hint {
    color: #ea580c;
    font-style: italic;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }

  .cell-select-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 240px;
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .cell-select-list::-webkit-scrollbar {
    width: 6px;
  }
  .cell-select-list::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 3px;
  }

  .cell-select-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    font-size: 12px;
    color: #0f172a;
    cursor: pointer;
    transition: background 0.1s ease;
    user-select: none;
  }
  .cell-select-option:hover,
  .cell-select-option.active {
    background: #ecfdf5;
    color: #047857;
  }
  .cell-select-option.active {
    font-weight: 600;
  }
  .cell-select-option-label {
    text-transform: capitalize;
  }
  .cell-select-option.active :global(svg) {
    color: #ea580c;
  }
</style>
