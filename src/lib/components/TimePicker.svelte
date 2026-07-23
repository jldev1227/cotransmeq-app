<script lang="ts">
  export let value: string = '';
  export let dayOffset: boolean = false;
  export let disabled: boolean = false;
  export let placeholder: string = 'Seleccionar hora';

  const TIMES: string[] = (() => {
    const arr: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return arr;
  })();

  $: encodedValue = value ? `${value}|${dayOffset ? 1 : 0}` : '';
  $: hasValue = !!value;
  $: isNextDay = dayOffset === true;
  $: legacyValue = value && !TIMES.includes(value) ? value : null;

  function handleChange(e: Event) {
    const raw = (e.target as HTMLSelectElement).value;
    if (!raw) {
      value = '';
      dayOffset = false;
      return;
    }
    const sep = raw.lastIndexOf('|');
    if (sep < 0) {
      value = raw;
      dayOffset = false;
      return;
    }
    value = raw.slice(0, sep);
    dayOffset = raw.slice(sep + 1) === '1';
  }

  function clearValue(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    value = '';
    dayOffset = false;
  }
</script>

<div class="time-picker" class:disabled class:has-value={hasValue} class:next-day={isNextDay}>
  <svg class="time-picker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path stroke-linecap="round" d="M12 7v5l3 2" />
  </svg>

  {#if isNextDay}
    <span class="next-day-badge" title="Día siguiente">+1</span>
  {/if}

  <select
    class="time-picker-select"
    {disabled}
    value={encodedValue}
    on:change={handleChange}
    aria-label="Hora"
  >
    {#if !hasValue}
      <option value="" disabled hidden>{placeholder}</option>
    {/if}
    {#if legacyValue}
      <option value={legacyValue}>⚠ {legacyValue} (valor existente)</option>
    {/if}
    {#each TIMES as opt (opt)}
      <option value={`${opt}|0`}>{opt}</option>
    {/each}
    <optgroup label="─── Día siguiente (+1) ───">
      {#each TIMES as opt (`${opt}|1`)}
        <option value={`${opt}|1`}>{opt}</option>
      {/each}
    </optgroup>
  </select>

  {#if hasValue && !disabled}
    <button
      type="button"
      class="time-picker-clear"
      on:click={clearValue}
      aria-label="Limpiar hora"
      title="Limpiar"
    >✕</button>
  {:else}
    <svg class="time-picker-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  {/if}
</div>

<style>
  .time-picker {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
  }
  .time-picker-icon {
    position: absolute;
    left: 0.65rem;
    width: 1rem;
    height: 1rem;
    color: var(--text3, #94a3b8);
    pointer-events: none;
    z-index: 1;
  }
  .time-picker-select {
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 2.2rem 0.55rem 2.1rem;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 600;
    background: var(--surface, #fff);
    color: var(--text, #0f172a);
    outline: none;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    letter-spacing: 0.02em;
  }
  .time-picker-select:focus {
    border-color: #ea580c;
    box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.1);
  }
  .time-picker-select:disabled {
    background: #f8fafc;
    color: var(--text3, #94a3b8);
    cursor: not-allowed;
    opacity: 0.7;
  }
  .time-picker.has-value .time-picker-select {
    border-color: #ea580c;
    background: rgba(234, 88, 12, 0.04);
    color: #c2410c;
  }
  .time-picker.next-day.has-value .time-picker-select {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.06);
    color: #b45309;
  }
  .time-picker.next-day.has-value .time-picker-icon {
    color: #f59e0b;
  }
  .next-day-badge {
    position: absolute;
    left: 2.05rem;
    z-index: 2;
    font-size: 0.6rem;
    font-weight: 800;
    color: #fff;
    background: #f59e0b;
    padding: 1px 5px;
    border-radius: 6px;
    letter-spacing: 0.02em;
    line-height: 1.3;
    pointer-events: none;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .time-picker.next-day .time-picker-select {
    padding-left: 3.2rem;
  }
  .time-picker-chevron {
    position: absolute;
    right: 0.65rem;
    width: 0.9rem;
    height: 0.9rem;
    color: var(--text3, #94a3b8);
    pointer-events: none;
  }
  .time-picker-clear {
    position: absolute;
    right: 0.45rem;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(234, 88, 12, 0.1);
    border: none;
    border-radius: 50%;
    color: #c2410c;
    cursor: pointer;
    font-size: 0.7rem;
    line-height: 1;
    padding: 0;
    z-index: 2;
  }
  .time-picker.next-day .time-picker-clear {
    background: rgba(245, 158, 11, 0.12);
    color: #b45309;
  }
  .time-picker-clear:hover {
    background: rgba(234, 88, 12, 0.2);
  }
  .time-picker.next-day .time-picker-clear:hover {
    background: rgba(245, 158, 11, 0.22);
  }
  .time-picker.disabled { opacity: 0.85; }

  :global(.time-picker-select option) {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    color: #0f172a;
    background: #fff;
  }
  :global(.time-picker-select optgroup) {
    font-style: normal;
    font-weight: 700;
    font-size: 0.7rem;
    color: #f59e0b;
    background: #fff7ed;
  }
</style>
