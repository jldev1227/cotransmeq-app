<!-- SortIcon.svelte -->
<script lang="ts">
	export let field: string;
	export let sortField: string;
	export let sortDir: 'asc' | 'desc';
</script>

<svg
	class="sort-icon"
	class:active={sortField === field}
	viewBox="0 0 10 14"
	fill="currentColor"
	aria-hidden="true"
>
	<path d="M5 0L9 5H1z" opacity={sortField === field && sortDir === 'asc'  ? 1 : 0.3} />
	<path d="M5 14L1 9H9z" opacity={sortField === field && sortDir === 'desc' ? 1 : 0.3} />
</svg>

<style>
	.sort-icon {
		width: 8px;
		height: 12px;
		flex-shrink: 0;
		transition: color 0.15s;
	}
</style>