<!--
  Skeleton.svelte — A lightweight, reusable loading skeleton component.
  Inspired by react-loading-skeleton. Zero dependencies.

  Usage:
    <Skeleton />                              — single line (100% × 20px)
    <Skeleton width="200px" height="14px" />  — sized line
    <Skeleton circle size="48px" />           — avatar circle
    <Skeleton count={3} gap="8px" />          — multiple lines
    <Skeleton lines={[                        — varied lines (form-like)
      { width: '40%', height: '12px' },
      { width: '100%', height: '36px' },
    ]} />
-->
<script lang="ts">
  /** Width of each skeleton line (CSS value). Ignored if `lines` is provided. */
  export let width: string = '100%';
  /** Height of each skeleton line (CSS value). Ignored if `lines` is provided. */
  export let height: string = '20px';
  /** Border radius (CSS value). */
  export let borderRadius: string = '8px';
  /** Render as a circle. Uses `size` for width & height. */
  export let circle: boolean = false;
  /** Circle/square size (CSS value). Only used when `circle` is true. */
  export let size: string = '48px';
  /** Number of identical lines to render. Ignored if `lines` is provided. */
  export let count: number = 1;
  /** Gap between lines (CSS value). */
  export let gap: string = '8px';
  /** Base/background color. */
  export let baseColor: string = '#f1f5f9';
  /** Shimmer highlight color. */
  export let highlightColor: string = '#f8fafc';
  /** Animation duration in seconds. Set 0 to disable animation. */
  export let duration: number = 1.5;
  /** 
   * Varied lines: array of { width?, height?, borderRadius? } objects.
   * Overrides `width`, `height`, and `count`.
   */
  export let lines: Array<{ width?: string; height?: string; borderRadius?: string }> | null = null;

  $: items = lines
    ? lines.map(l => ({
        w: l.width ?? width,
        h: l.height ?? height,
        r: l.borderRadius ?? borderRadius,
      }))
    : Array.from({ length: count }, () => ({
        w: circle ? size : width,
        h: circle ? size : height,
        r: circle ? '50%' : borderRadius,
      }));
</script>

<div class="sk-container" style="gap:{gap}" role="status" aria-label="Cargando...">
  {#each items as item, i}
    <div
      class="sk-bone"
      style="
        width:{item.w};
        height:{item.h};
        border-radius:{item.r};
        --sk-base:{baseColor};
        --sk-highlight:{highlightColor};
        --sk-duration:{duration}s;
        animation-delay:{i * 0.05}s;
      "
    ></div>
  {/each}
</div>

<style>
  .sk-container {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .sk-bone {
    background: linear-gradient(
      90deg,
      var(--sk-base) 0%,
      var(--sk-base) 33%,
      var(--sk-highlight) 50%,
      var(--sk-base) 67%,
      var(--sk-base) 100%
    );
    background-size: 300% 100%;
    animation: sk-shimmer var(--sk-duration) ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes sk-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }
</style>
