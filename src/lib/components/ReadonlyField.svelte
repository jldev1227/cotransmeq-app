<script lang="ts">
	export let value: string | number | null | undefined;
	export let emptyText: string = 'Sin registrar';
	export let mono: boolean = false;
	export let icon:
		'user' | 'mail' | 'phone' | 'id' | 'doc' | 'wallet' | 'shield' | 'star' | 'building' | null =
		null;

	$: hasValue =
		value !== null && value !== undefined && String(value).trim() !== '' ? String(value) : null;
</script>

<div
	class="readonly-field flex min-h-[42px] items-center gap-2.5 rounded-xl px-3 py-2"
	style="background: rgba(249, 115, 22, 0.04); border: 1px solid rgba(249, 115, 22, 0.14);"
>
	{#if icon}
		<svg
			class="h-3.5 w-3.5 flex-shrink-0"
			style="color: var(--orange-700); opacity: 0.7;"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			stroke-width="1.8"
			aria-hidden="true"
		>
			{#if icon === 'user'}
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
				/>
			{:else if icon === 'mail'}
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
				/>
			{:else if icon === 'phone'}
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21L6.374 11.5l8.25 8.25 2.113-3.85a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V20.72a2 2 0 01-2 2h-1.28C10.5 22.72 1.28 13.5 1.28 2.72V1.44a2 2 0 012-2H6.5z"
				/>
			{:else if icon === 'id'}
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"
				/>
			{:else if icon === 'doc'}
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
				/>
			{:else if icon === 'wallet'}
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
				/>
			{:else if icon === 'shield'}
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
				/>
			{:else if icon === 'star'}
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
				/>
			{:else if icon === 'building'}
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
				/>
			{/if}
		</svg>
	{/if}

	{#if hasValue}
		<span
			class="min-w-0 flex-1 truncate text-sm"
			class:font-mono-meta={mono}
			style={mono
				? 'color: var(--bg-charcoal); letter-spacing: 0.02em; font-size: 0.78rem;'
				: 'color: var(--bg-charcoal); font-weight: 500;'}
		>
			{hasValue}
		</span>
	{:else}
		<span class="text-sm italic" style="color: var(--text-very-muted);">{emptyText}</span>
	{/if}
</div>
