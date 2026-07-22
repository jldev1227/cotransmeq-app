<script lang="ts">
  import { fly, fade } from 'svelte/transition';

  export let count: number = 0;
  export let nonEmpty: number = 0;
  export let sum: number = 0;
  export let avg: number = 0;
  export let min: number = 0;
  export let max: number = 0;
  export let allNumeric: boolean = true;
  export let onClear: () => void = () => {};

  function fmtCOP(v: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v || 0);
  }
</script>

{#if count > 1}
  <div
    class="selection-stats-footer"
    in:fly={{ y: 40, duration: 250 }}
    out:fade={{ duration: 150 }}
    role="status"
    aria-live="polite"
  >
    <div class="stats-content">
      <div class="stats-header">
        <span class="stats-badge">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          {count} seleccionadas
        </span>
        <span class="stats-divider"></span>
        <span class="stats-secondary">
          <span class="stat-label">No vacías</span>
          <span class="stat-value">{nonEmpty}</span>
        </span>
      </div>

      {#if allNumeric && nonEmpty > 0}
        <span class="stats-divider vertical"></span>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Suma</span>
            <span class="stat-value stat-value-emerald">{fmtCOP(sum)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Promedio</span>
            <span class="stat-value">{fmtCOP(avg)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Mínimo</span>
            <span class="stat-value stat-value-blue">{fmtCOP(min)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Máximo</span>
            <span class="stat-value stat-value-blue">{fmtCOP(max)}</span>
          </div>
        </div>
      {:else if !allNumeric}
        <span class="stats-divider vertical"></span>
        <div class="stats-mixed">
          <span class="mixed-hint">Selección mixta — selecciona solo celdas numéricas para ver estadísticas</span>
        </div>
      {/if}

      <span class="stats-divider vertical"></span>
      <div class="stats-actions">
        <span class="stats-hint">
          <kbd>Click</kbd> + arrastrar · <kbd>Shift</kbd> + click
        </span>
        <button class="stats-clear-btn" on:click={onClear} title="Limpiar selección">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .selection-stats-footer {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    pointer-events: auto;
    max-width: calc(100vw - 32px);
  }

  .stats-content {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(15, 22, 26, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.25),
      0 4px 8px rgba(0, 0, 0, 0.15);
    color: #fff;
    font-size: 12px;
  }

  .stats-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .stats-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    background: rgba(249, 115, 22, 0.18);
    border: 1px solid rgba(249, 115, 22, 0.35);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    color: #6ee7b7;
    letter-spacing: 0.02em;
  }
  .stats-badge :global(svg) {
    color: #f97316;
  }

  .stats-secondary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .stats-secondary .stat-label {
    color: rgba(255, 255, 255, 0.55);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .stats-secondary .stat-value {
    color: #fff;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .stats-divider {
    width: 1px;
    height: 22px;
    background: rgba(255, 255, 255, 0.12);
  }

  .stats-grid {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 90px;
  }
  .stat-item .stat-label {
    font-size: 9px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.55);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .stat-item .stat-value {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .stat-value-emerald {
    color: #6ee7b7;
  }
  .stat-value-blue {
    color: #93c5fd;
  }

  .stats-mixed {
    display: flex;
    align-items: center;
  }
  .mixed-hint {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.65);
    font-style: italic;
  }

  .stats-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stats-hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.5);
  }
  .stats-hint kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    padding: 1px 5px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 9px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
  }

  .stats-clear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .stats-clear-btn:hover {
    background: rgba(239, 68, 68, 0.18);
    border-color: rgba(239, 68, 68, 0.35);
    color: #fca5a5;
  }

  @media (max-width: 720px) {
    .stats-grid {
      gap: 10px;
    }
    .stat-item {
      min-width: 70px;
    }
    .stats-hint {
      display: none;
    }
  }
</style>
