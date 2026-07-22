<script lang="ts" generics="T extends { id?: string | number }">
	interface Column {
		key: string;
		label: string;
		sortable?: boolean;
		align?: 'left' | 'center' | 'right';
		render?: (row: T) => any;
	}

	let {
		data,
		columns,
		onRowClick,
		onAction,
		isLoading = false,
		totalRows = 0,
		currentPage = 1,
		pageSize = 10,
		onPageChange,
		onSortChange,
		emptyMessage = 'No se encontraron resultados',
		emptyActionLabel,
		onEmptyAction,
		selectable = false,
		selectedIds = new Set<string | number>(),
		onSelectionChange
	}: {
		data: T[];
		columns: Column[];
		onRowClick?: (row: T) => void;
		onAction?: (action: string, row: T) => void;
		isLoading?: boolean;
		totalRows?: number;
		currentPage?: number;
		pageSize?: number;
		onPageChange?: (page: number) => void;
		onSortChange?: (sortBy: string, sortOrder: 'asc' | 'desc') => void;
		emptyMessage?: string;
		emptyActionLabel?: string;
		onEmptyAction?: () => void;
		selectable?: boolean;
		selectedIds?: Set<string | number>;
		onSelectionChange?: (newSelected: Set<string | number>) => void;
	} = $props();

	let sortField = $state<string | null>(null);
	let sortDirection = $state<'asc' | 'desc'>('asc');

	function handleSort(key: string) {
		if (sortField === key) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortField = key;
			sortDirection = 'asc';
		}
		onSortChange?.(key, sortDirection);
	}

	let totalPages = $derived(Math.max(1, Math.ceil(totalRows / pageSize)));
	let startIndex = $derived((currentPage - 1) * pageSize + 1);
	let endIndex = $derived(Math.min(currentPage * pageSize, totalRows));

	let pageSelectedCount = $derived(
		data.filter((row) => row.id != null && selectedIds.has(row.id)).length
	);
	let allPageSelected = $derived(
		data.length > 0 && data.every((row) => row.id != null && selectedIds.has(row.id))
	);
	let somePageSelected = $derived(pageSelectedCount > 0 && !allPageSelected);

	function toggleRow(row: T) {
		if (!onSelectionChange || row.id == null) return;
		const next = new Set(selectedIds);
		if (next.has(row.id)) next.delete(row.id);
		else next.add(row.id);
		onSelectionChange(next);
	}

	function togglePage() {
		if (!onSelectionChange) return;
		const next = new Set(selectedIds);
		if (allPageSelected) {
			for (const row of data) {
				if (row.id != null) next.delete(row.id);
			}
		} else {
			for (const row of data) {
				if (row.id != null) next.add(row.id);
			}
		}
		onSelectionChange(next);
	}
</script>

<div class="table-card">
	{#if isLoading}
		<div class="empty" role="status">
			<div class="spinner"></div>
			<p>Cargando...</p>
		</div>
	{:else if data.length === 0}
		<div class="empty" role="status">
			<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
			</svg>
			<p>{emptyMessage}</p>
			{#if emptyActionLabel && onEmptyAction}
				<button class="btn-primary" onclick={onEmptyAction}>
					{emptyActionLabel}
				</button>
			{/if}
		</div>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						{#if selectable}
							<th class="th-select">
								<label class="checkbox-wrap">
									<input
										type="checkbox"
										checked={allPageSelected}
										indeterminate={somePageSelected}
										onchange={togglePage}
										aria-label="Seleccionar página"
									/>
									<span class="checkbox-box"></span>
								</label>
							</th>
						{/if}
						{#each columns as col (col.key)}
							<th class="align-{col.align || 'left'}">
								{#if col.sortable}
									<button class="th-btn" onclick={() => handleSort(col.key)}>
										<span>{col.label}</span>
										<span class="sort-indicator">
											{#if sortField === col.key}
												{#if sortDirection === 'asc'}
													<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
														<polyline points="18 15 12 9 6 15" />
													</svg>
												{:else}
													<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
														<polyline points="6 9 12 15 18 9" />
													</svg>
												{/if}
											{:else}
												<svg class="sort-icon-inactive" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
													<polyline points="7 13 12 18 17 13" />
													<polyline points="7 6 12 11 17 6" />
												</svg>
											{/if}
										</span>
									</button>
								{:else}
									{col.label}
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
			<tbody
				onclick={(e) => {
					const target = e.target as HTMLElement;
					const btn = target.closest('[data-action]') as HTMLElement | null;
					if (btn && onAction) {
						e.stopPropagation();
						const action = btn.getAttribute('data-action');
						const rowIndex = btn.closest('tr')?.getAttribute('data-row-index');
						if (action && rowIndex !== null && rowIndex !== undefined) {
							const idx = parseInt(rowIndex, 10);
							onAction(action, data[idx]);
						}
					}
				}}
			>
				{#each data as row, i (row.id ?? i)}
					<tr
						class:clickable={!!onRowClick}
						class:row-selected={selectable && row.id != null && selectedIds.has(row.id)}
						data-row-index={i}
						onclick={(e) => {
							const target = e.target as HTMLElement;
							if (target.closest('.th-select, [data-action], button, a, input, label')) return;
							onRowClick?.(row);
						}}
					>
						{#if selectable}
							<td class="td-select" onclick={(e) => e.stopPropagation()}>
								<label class="checkbox-wrap">
									<input
										type="checkbox"
										checked={row.id != null && selectedIds.has(row.id)}
										onchange={() => toggleRow(row)}
										aria-label="Seleccionar fila"
									/>
									<span class="checkbox-box"></span>
								</label>
							</td>
						{/if}
						{#each columns as col (col.key)}
							<td class="align-{col.align || 'left'}">
								{#if col.render}
									{@html col.render(row)}
								{:else}
									{row[col.key] ?? ''}
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
			</table>
		</div>

		{#if totalPages >= 1}
			<div class="pagination">
				<button
					class="page-btn"
					onclick={() => onPageChange?.(currentPage - 1)}
					disabled={currentPage <= 1}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="15 18 9 12 15 6" />
					</svg>
					Anterior
				</button>
				<span class="page-info">
					Página {currentPage} de {totalPages} · {startIndex}-{endIndex} de {totalRows}
				</span>
				<button
					class="page-btn"
					onclick={() => onPageChange?.(currentPage + 1)}
					disabled={currentPage >= totalPages}
				>
					Siguiente
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="9 18 15 12 9 6" />
					</svg>
				</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.table-card {
		background: var(--surface, #fff);
		border: 1px solid var(--border, #e5e7eb);
		border-radius: 12px;
		overflow: hidden;
	}

	.table-wrap {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	thead tr {
		background: #fafbfc;
		border-bottom: 1px solid var(--border, #e5e7eb);
	}

	th {
		padding: 12px 16px;
		text-align: left;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted, #6b7280);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	th.align-center { text-align: center; }
	th.align-right { text-align: right; }

	.th-select {
		width: 40px;
		padding-left: 16px;
		padding-right: 0;
	}

	.td-select {
		padding-left: 16px;
		padding-right: 0;
	}

	.th-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		cursor: pointer;
		transition: color 0.15s;
	}

	.th-btn:hover { color: var(--accent, #f97316); }

	.sort-indicator {
		display: inline-flex;
		align-items: center;
		color: var(--accent, #f97316);
	}

	.sort-icon-inactive {
		opacity: 0.3;
	}

	tbody tr {
		border-bottom: 1px solid #f3f4f6;
		transition: background 0.12s;
	}

	tbody tr:last-child {
		border-bottom: none;
	}

	tbody tr:hover {
		background: var(--surface-hover, #f9fafb);
	}

	tbody tr.row-selected {
		background: rgba(249, 115, 22, 0.06);
	}

	tbody tr.clickable {
		cursor: pointer;
	}

	td {
		padding: 12px 16px;
		color: var(--text-primary, #111827);
		vertical-align: middle;
	}

	td.align-center { text-align: center; }
	td.align-right { text-align: right; }

	/* Custom checkbox */
	.checkbox-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		cursor: pointer;
	}

	.checkbox-wrap input {
		position: absolute;
		opacity: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		cursor: pointer;
		z-index: 1;
	}

	.checkbox-box {
		position: absolute;
		inset: 0;
		border: 1.5px solid var(--border-hover, #d1d5db);
		border-radius: 4px;
		background: #fff;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.checkbox-wrap input:checked + .checkbox-box {
		background: var(--accent, #f97316);
		border-color: var(--accent, #f97316);
	}

	.checkbox-wrap input:checked + .checkbox-box::after {
		content: '';
		width: 4px;
		height: 8px;
		border: solid #fff;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg) translate(-1px, -1px);
	}

	.checkbox-wrap input:indeterminate + .checkbox-box {
		background: var(--accent, #f97316);
		border-color: var(--accent, #f97316);
	}

	.checkbox-wrap input:indeterminate + .checkbox-box::after {
		content: '';
		width: 8px;
		height: 2px;
		background: #fff;
	}

	.checkbox-wrap:hover .checkbox-box {
		border-color: var(--accent, #f97316);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 60px 20px;
		text-align: center;
		color: var(--text-muted, #6b7280);
	}

	.empty svg {
		color: #d1d5db;
	}

	.empty p {
		font-size: 13px;
		margin: 0;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #e5e7eb;
		border-top-color: var(--accent, #f97316);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		background: var(--accent, #f97316);
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		font-family: inherit;
	}

	.btn-primary:hover {
		background: var(--accent-hover, #ea580c);
		transform: translateY(-1px);
	}

	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-top: 1px solid var(--border, #e5e7eb);
		background: #fafbfc;
	}

	.page-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		background: #fff;
		border: 1px solid var(--border, #e5e7eb);
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary, #4b5563);
		cursor: pointer;
		transition: all 0.15s;
		font-family: inherit;
	}

	.page-btn:hover:not(:disabled) {
		background: #f3f4f6;
		border-color: var(--border-hover, #d1d5db);
	}

	.page-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.page-info {
		font-size: 12px;
		color: var(--text-muted, #6b7280);
		font-weight: 500;
	}
</style>
