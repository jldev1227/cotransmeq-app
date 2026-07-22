<script lang="ts">
	export let nivel: string;

	const colors: Record<string, string> = {
		ALTO: '#ef4444',
		MEDIO: '#f59e0b',
		BAJO: '#22c55e'
	};

	$: color = colors[nivel] ?? '#888';
</script>

<span
	class="risk-dot"
	style="background: {color}; box-shadow: 0 0 0 3px {color}22"
	title="Riesgo {nivel}"
	aria-label="Riesgo {nivel}"
></span>

<style>
	.risk-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
</style>
