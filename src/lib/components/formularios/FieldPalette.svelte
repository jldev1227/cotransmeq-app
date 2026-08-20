<!--
	Paleta de tipos de campo y biblioteca de plantillas.

	La paleta define TIPOS, no registros compartidos: cada inserción crea un
	`form_field` independiente. Es la diferencia con el motor legacy de
	evaluaciones y la razón de que editar una card jamás altere otro formulario.

	Las plantillas también se COPIAN al insertarse. Editar la plantilla
	`estado_c_nc_na` después no toca los formularios ya construidos con ella.
-->
<script lang="ts">
	import {
		FIELD_TYPE_META,
		FIELD_TYPES,
		PALETTE_CATEGORIES,
		isContainer,
		type FieldType,
		type FieldTemplateDto
	} from '$lib/formularios/types';

	interface Props {
		templates?: FieldTemplateDto[];
		/** `true` cuando el destino activo es un contenedor: no admite contenedores. */
		insideContainer?: boolean;
		disabled?: boolean;
		onpick: (type: FieldType) => void;
		ontemplate?: (template: FieldTemplateDto) => void;
	}

	let {
		templates = [],
		insideContainer = false,
		disabled = false,
		onpick,
		ontemplate
	}: Props = $props();

	let busqueda = $state('');
	let categoriaAbierta = $state<string | null>('Básicos');

	const filtrados = $derived.by(() => {
		const q = busqueda.trim().toLowerCase();
		return FIELD_TYPES.filter((type) => {
			/// Un contenedor dentro de otro contenedor no se puede almacenar: el
			/// esquema solo tiene una columna de ocurrencia. Se oculta en vez de
			/// dejar que el usuario lo intente y reciba un error.
			if (insideContainer && isContainer(type)) return false;
			if (!q) return true;
			const meta = FIELD_TYPE_META[type];
			return (
				meta.label.toLowerCase().includes(q) ||
				meta.hint.toLowerCase().includes(q) ||
				type.toLowerCase().includes(q)
			);
		});
	});

	const porCategoria = $derived.by(() => {
		const mapa = new Map<string, FieldType[]>();
		for (const type of filtrados) {
			const cat = FIELD_TYPE_META[type].category;
			mapa.set(cat, [...(mapa.get(cat) ?? []), type]);
		}
		return mapa;
	});

	const plantillasFiltradas = $derived.by(() => {
		const q = busqueda.trim().toLowerCase();
		return templates.filter((t) => {
			if (insideContainer && isContainer(t.fieldType)) return false;
			if (!q) return true;
			return t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
		});
	});

	/// Con búsqueda activa se abren todas las categorías: si no, el usuario
	/// escribiría "firma" y no vería el resultado por estar en una categoría
	/// colapsada.
	const buscando = $derived(busqueda.trim().length > 0);
</script>

<div class="paleta">
	<div class="paleta__buscar">
		<label class="sr-only" for="paleta-buscar">Buscar tipo de campo</label>
		<input
			id="paleta-buscar"
			class="paleta__input"
			type="search"
			placeholder="Buscar campo o plantilla…"
			bind:value={busqueda}
			{disabled}
		/>
	</div>

	<div class="paleta__scroll">
		{#each PALETTE_CATEGORIES as categoria (categoria)}
			{@const tipos = porCategoria.get(categoria) ?? []}
			{#if tipos.length}
				<section class="grupo">
					<button
						type="button"
						class="grupo__toggle"
						aria-expanded={buscando || categoriaAbierta === categoria}
						onclick={() => (categoriaAbierta = categoriaAbierta === categoria ? null : categoria)}
					>
						<span>{categoria}</span>
						<span class="grupo__conteo">{tipos.length}</span>
					</button>

					{#if buscando || categoriaAbierta === categoria}
						<ul class="grupo__lista">
							{#each tipos as type (type)}
								{@const meta = FIELD_TYPE_META[type]}
								<li>
									<button type="button" class="tipo" {disabled} onclick={() => onpick(type)}>
										<span class="tipo__label">{meta.label}</span>
										<span class="tipo__hint">{meta.hint}</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/each}

		{#if plantillasFiltradas.length}
			<section class="grupo">
				<button
					type="button"
					class="grupo__toggle"
					aria-expanded={buscando || categoriaAbierta === '__plantillas'}
					onclick={() =>
						(categoriaAbierta = categoriaAbierta === '__plantillas' ? null : '__plantillas')}
				>
					<span>Plantillas guardadas</span>
					<span class="grupo__conteo">{plantillasFiltradas.length}</span>
				</button>

				{#if buscando || categoriaAbierta === '__plantillas'}
					<ul class="grupo__lista">
						{#each plantillasFiltradas as plantilla (plantilla.id)}
							<li>
								<button
									type="button"
									class="tipo tipo--plantilla"
									{disabled}
									onclick={() => ontemplate?.(plantilla)}
								>
									<span class="tipo__label">{plantilla.name}</span>
									<span class="tipo__hint">
										{plantilla.category} · {FIELD_TYPE_META[plantilla.fieldType]?.label ??
											plantilla.fieldType}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		{#if filtrados.length === 0 && plantillasFiltradas.length === 0}
			<p class="paleta__vacio">Sin resultados para «{busqueda}».</p>
		{/if}
	</div>

	{#if insideContainer}
		<p class="paleta__nota">
			Estás agregando dentro de un grupo repetible: no se admiten grupos ni matrices anidados.
		</p>
	{/if}
</div>

<style>
	.paleta {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--bg-surface, #fff);
	}

	.paleta__buscar {
		padding: 0.75rem;
		border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
	}

	.paleta__input {
		width: 100%;
		min-height: 40px;
		padding: 0.375rem 0.625rem;
		font: inherit;
		font-size: 0.875rem;
		border: 1px solid var(--border-default, rgba(0, 0, 0, 0.12));
		border-radius: 10px;
	}

	.paleta__input:focus-visible {
		outline: none;
		border-color: var(--emerald-600, #059669);
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
	}

	.paleta__scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.5rem;
	}

	.grupo {
		margin-bottom: 0.25rem;
	}

	.grupo__toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 40px;
		padding: 0 0.5rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted, #6b6b6b);
		background: none;
		border: none;
		border-radius: 8px;
		cursor: pointer;
	}

	.grupo__toggle:hover {
		background: var(--gray-50, #f9fafb);
	}

	.grupo__conteo {
		font-family: var(--font-mono, monospace);
		font-size: 0.6875rem;
		color: var(--text-very-muted, #9a9a9a);
	}

	.grupo__lista {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		list-style: none;
		padding: 0.1875rem 0 0.375rem;
	}

	.tipo {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		width: 100%;
		min-height: 44px;
		padding: 0.4375rem 0.5rem;
		text-align: left;
		font: inherit;
		background: none;
		border: 1px solid transparent;
		border-radius: 8px;
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}

	.tipo:hover:not(:disabled) {
		background: #fff7ed;
		border-color: #fed7aa;
	}

	.tipo:focus-visible {
		outline: 2px solid var(--emerald-600, #059669);
		outline-offset: 1px;
	}

	.tipo:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.tipo--plantilla {
		border-left: 2px solid var(--emerald-500, #10b981);
		border-radius: 0 8px 8px 0;
	}

	.tipo__label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-primary, #1a1a1a);
	}

	.tipo__hint {
		font-size: 0.75rem;
		color: var(--text-very-muted, #9a9a9a);
		line-height: 1.3;
	}

	.paleta__vacio {
		padding: 1rem 0.5rem;
		font-size: 0.8125rem;
		font-style: italic;
		color: var(--text-very-muted, #9a9a9a);
	}

	.paleta__nota {
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: #92400e;
		background: #fffbeb;
		border-top: 1px solid #fde68a;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.tipo {
			transition: none;
		}
	}
</style>
