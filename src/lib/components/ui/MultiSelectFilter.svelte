<script lang="ts">
    export let selected: string[] = [];
    export let options: string[] = [];
    export let placeholder = 'Todos';
    export let labelFn: (v: string) => string = (v) => v;
    export let searchable = false;

    let open = false;
    let searchInput = '';

    function toggle(value: string) {
        if (selected.includes(value)) {
            selected = selected.filter((v) => v !== value);
        } else {
            selected = [...selected, value];
        }
    }

    function clearAll() {
        selected = [];
    }

    $: filteredOptions = searchable && searchInput
        ? options.filter((o) => labelFn(o).toLowerCase().includes(searchInput.toLowerCase()))
        : options;

    $: label = selected.length === 0
        ? placeholder
        : selected.length === 1
        ? labelFn(selected[0])
        : `${selected.length} selec.`;
</script>

<div class="relative">
    <button
        type="button"
        on:click|stopPropagation={() => { open = !open; searchInput = ''; }}
        class="flex w-full items-center justify-between gap-1 rounded border px-1 py-0.5 text-[11px] focus:outline-none
            {selected.length > 0 ? 'border-emerald-400 bg-emerald-50 text-emerald-700 font-semibold' : 'border-gray-300 bg-white text-gray-600'}"
    >
        <span class="truncate">{label}</span>
        <svg class="h-3 w-3 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
    </button>

    {#if open}
        <div class="fixed inset-0 z-40" on:click={() => (open = false)}></div>

        <div class="absolute left-0 top-full z-50 mt-0.5 min-w-[180px] rounded border border-gray-200 bg-white shadow-lg">

            {#if searchable}
                <div class="border-b border-gray-100 p-1.5">
                    <input
                        type="text"
                        bind:value={searchInput}
                        on:click|stopPropagation
                        placeholder="Buscar..."
                        class="w-full rounded border border-gray-300 px-2 py-0.5 text-[11px] focus:border-emerald-400 focus:outline-none"
                    />
                </div>
            {/if}

            <div class="max-h-48 overflow-y-auto">
                {#if selected.length > 0}
                    <button
                        type="button"
                        on:click|stopPropagation={clearAll}
                        class="w-full px-2 py-1 text-left text-[11px] font-semibold text-red-500 hover:bg-red-50"
                    >
                        ✕ Limpiar filtro
                    </button>
                    <hr class="border-gray-100" />
                {/if}

                {#each filteredOptions as option}
                    <label class="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-emerald-50" on:click|stopPropagation>
                        <input
                            type="checkbox"
                            checked={selected.includes(option)}
                            on:change={() => toggle(option)}
                            class="rounded border-gray-300 text-emerald-500"
                        />
                        <span class="text-[11px] text-gray-700">{labelFn(option)}</span>
                    </label>
                {/each}

                {#if filteredOptions.length === 0}
                    <p class="px-2 py-1 text-[11px] text-gray-400">Sin resultados</p>
                {/if}
            </div>
        </div>
    {/if}
</div>
