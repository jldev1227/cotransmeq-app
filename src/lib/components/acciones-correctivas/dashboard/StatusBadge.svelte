<script lang="ts">
	export let estado: string;

	const config: Record<string, { cls: string; label: string }> = {
		'En Proceso': { cls: 'proceso', label: 'En proceso' },
		Cumplidas: { cls: 'cumplida', label: 'Cumplida' },
		Vencidas: { cls: 'vencida', label: 'Vencida' }
	};

	$: cfg = config[estado] ?? { cls: 'proceso', label: estado };
</script>

<span class="badge badge-{cfg.cls}">{cfg.label}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.badge-proceso { background: rgba(59, 130, 246, 0.08); color: #1e40af; border: 1px solid rgba(59, 130, 246, 0.18); }
	.badge-cumplida { background: rgba(34, 197, 94, 0.08); color: #15803d; border: 1px solid rgba(34, 197, 94, 0.18); }
	.badge-vencida { background: rgba(239, 68, 68, 0.06); color: #b91c1c; border: 1px solid rgba(239, 68, 68, 0.18); }
</style>
