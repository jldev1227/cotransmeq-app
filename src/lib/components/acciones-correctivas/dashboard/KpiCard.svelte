<script lang="ts">
	export let label: string;
	export let value: number;
	export let sub: string;
	export let color: string;
</script>

<div class="kpi" style="--kpi-color: {color}">
	<span class="kpi-dot" aria-hidden="true"></span>
	<div class="kpi-info">
		<span class="kpi-label">{label}</span>
		<span class="kpi-value">{value}</span>
	</div>
	<span class="kpi-sub">{sub}</span>
</div>

<style>
	.kpi {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
	}
	.kpi:hover {
		border-color: rgba(0, 0, 0, 0.2);
		transform: translateY(-1px);
	}
	.kpi-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--kpi-color);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--kpi-color) 18%, transparent);
		flex-shrink: 0;
	}
	.kpi-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.kpi-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.kpi-value {
		font-family: 'Fraunces', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 500;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
		margin-top: 0.15rem;
	}
	.kpi-sub {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.7rem;
		font-weight: 600;
		margin-left: auto;
		white-space: nowrap;
		flex-shrink: 0;
		color: var(--kpi-color);
	}

	@media (max-width: 600px) {
		.kpi { padding: 0.7rem 0.85rem; gap: 0.6rem; }
		.kpi-value { font-size: 1.1rem; }
		.kpi-sub { font-size: 0.65rem; }
	}
</style>
