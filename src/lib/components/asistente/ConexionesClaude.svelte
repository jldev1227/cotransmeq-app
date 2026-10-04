<script lang="ts">
	/**
	 * «Conectar con Claude»: tokens personales para que el Claude del usuario
	 * (claude.ai, Claude Desktop o Claude Code) consulte la app por MCP con sus
	 * mismos permisos. El token completo se muestra una única vez.
	 */
	import { onMount } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { Check, CheckCircle2, Copy, Info, Loader2, Plug, Plus, X } from 'lucide-svelte';
	import {
		NOMBRE_MCP,
		URL_MCP,
		crearConexion,
		listarConexiones,
		revocarConexion,
		type ConexionClaude,
		type ConexionCreada
	} from '$lib/api/api-tokens';
	import { toast } from '$lib/stores/toast';
	import { confirmar } from '$lib/stores/confirm';

	let conexiones = $state<ConexionClaude[]>([]);
	let cargando = $state(true);
	let nombre = $state('');
	let creando = $state(false);
	/** La recién creada: es la única vez que se puede ver el token. */
	let nueva = $state<ConexionCreada | null>(null);
	let copiado = $state<'web' | 'codigo' | null>(null);

	const urlWeb = $derived(nueva ? `${URL_MCP}/${nueva.token}` : '');
	const comandoCodigo = $derived(
		nueva
			? `claude mcp add --transport http ${NOMBRE_MCP} ${URL_MCP} --header "Authorization: Bearer ${nueva.token}"`
			: ''
	);

	onMount(cargar);

	async function cargar() {
		cargando = true;
		try {
			conexiones = await listarConexiones();
		} catch {
			toast.error('No se pudieron cargar tus conexiones');
		} finally {
			cargando = false;
		}
	}

	async function crear(e: SubmitEvent) {
		e.preventDefault();
		if (!nombre.trim() || creando) return;
		creando = true;
		try {
			nueva = await crearConexion(nombre.trim());
			nombre = '';
			await cargar();
		} catch (err: unknown) {
			const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
			toast.error(msg ?? 'No se pudo crear la conexión');
		} finally {
			creando = false;
		}
	}

	async function revocar(c: ConexionClaude) {
		const ok = await confirmar({
			title: 'Revocar conexión',
			message: `«${c.nombre}» dejará de funcionar de inmediato. Claude ya no podrá consultar la app con ella.`,
			confirmText: 'Revocar',
			tone: 'danger'
		});
		if (!ok) return;
		try {
			await revocarConexion(c.id);
			if (nueva?.id === c.id) nueva = null;
			conexiones = conexiones.filter((x) => x.id !== c.id);
			toast.success('Conexión revocada');
		} catch {
			toast.error('No se pudo revocar la conexión');
		}
	}

	async function copiar(texto: string, cual: 'web' | 'codigo') {
		try {
			await navigator.clipboard.writeText(texto);
			copiado = cual;
			setTimeout(() => (copiado = null), 2000);
		} catch {
			toast.error('No se pudo copiar; selecciona el texto y cópialo a mano');
		}
	}

	function fecha(iso: string | null): string {
		if (!iso) return 'nunca';
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="cc" in:fade>
	<p class="cc-intro">
		Conecta tu cuenta de Claude a la app para preguntarle por conductores, vehículos, servicios o
		clientes desde Claude. Claude consulta con <strong>tus mismos permisos</strong> y solo puede
		leer: no crea, edita, aprueba ni paga nada.
	</p>
	<p class="cc-nota">
		<Info size={13} aria-hidden="true" />
		Lo que Claude consulte se procesa en los servidores de Anthropic según las condiciones de tu cuenta
		de Claude.
	</p>

	{#if nueva}
		<div class="cc-nueva" transition:slide>
			<div class="cc-nueva-cabecera">
				<p class="cc-nueva-titulo">
					<CheckCircle2 size={15} aria-hidden="true" />
					Conexión «{nueva.nombre}» creada
				</p>
				<button type="button" class="cc-btn-icono" aria-label="Ocultar" onclick={() => (nueva = null)}>
					<X size={15} />
				</button>
			</div>
			<p class="cc-nueva-aviso">
				Copia el enlace ahora: por seguridad no se vuelve a mostrar. Quien lo tenga puede consultar la
				app como tú, así que no lo compartas.
			</p>

			<div class="cc-bloque">
				<p class="cc-bloque-titulo">Claude en la web o la app (claude.ai)</p>
				<ol class="cc-pasos">
					<li>En Claude ve a Configuración → Conectores → «Agregar conector personalizado».</li>
					<li>Ponle de nombre {NOMBRE_MCP} y pega este enlace como URL.</li>
				</ol>
				<div class="cc-copiar">
					<code>{urlWeb}</code>
					<button type="button" class="cc-btn cc-btn--oscuro" onclick={() => copiar(urlWeb, 'web')}>
						{#if copiado === 'web'}<Check size={14} />{:else}<Copy size={14} />{/if}
						{copiado === 'web' ? 'Copiado' : 'Copiar'}
					</button>
				</div>
			</div>

			<div class="cc-bloque">
				<p class="cc-bloque-titulo">Claude Code (terminal)</p>
				<div class="cc-copiar">
					<code>{comandoCodigo}</code>
					<button type="button" class="cc-btn" onclick={() => copiar(comandoCodigo, 'codigo')}>
						{#if copiado === 'codigo'}<Check size={14} />{:else}<Copy size={14} />{/if}
						{copiado === 'codigo' ? 'Copiado' : 'Copiar'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<form class="cc-form" onsubmit={crear}>
		<input
			bind:value={nombre}
			maxlength="60"
			placeholder="Nombre de la conexión (ej. Claude de mi portátil)"
			aria-label="Nombre de la conexión"
		/>
		<button type="submit" class="cc-btn cc-btn--primario" disabled={!nombre.trim() || creando}>
			{#if creando}<Loader2 size={15} class="cc-girar" />{:else}<Plus size={15} />{/if}
			Crear conexión
		</button>
	</form>

	<div>
		<p class="cc-seccion">Conexiones activas</p>
		{#if cargando}
			<p class="cc-vacio"><Loader2 size={15} class="cc-girar" /> Cargando…</p>
		{:else if conexiones.length === 0}
			<p class="cc-vacio">No tienes conexiones con Claude.</p>
		{:else}
			<ul class="cc-lista">
				{#each conexiones as c (c.id)}
					<li>
						<Plug size={18} class="cc-item-icono" aria-hidden="true" />
						<div class="cc-item-texto">
							<p class="cc-item-nombre">{c.nombre}</p>
							<p class="cc-item-meta">
								<span class="cc-mono">{c.prefijo}…</span> · creada {fecha(c.createdAt)} · último uso
								{fecha(c.lastUsedAt)}
							</p>
						</div>
						<button type="button" class="cc-revocar" onclick={() => revocar(c)}>Revocar</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.cc {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.cc-intro {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	.cc-nota {
		display: flex;
		align-items: flex-start;
		gap: 0.35rem;
		margin: -0.5rem 0 0;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.cc-nota :global(svg) {
		flex-shrink: 0;
		margin-top: 0.15rem;
	}

	.cc-nueva {
		padding: 1rem;
		border: 1px solid var(--emerald-500);
		border-radius: 14px;
		background: var(--au-tint, #ddf7ea);
	}
	.cc-nueva-cabecera {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.cc-nueva-titulo {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--emerald-800);
	}
	.cc-nueva-aviso {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: var(--emerald-800);
	}
	.cc-bloque {
		margin-top: 1rem;
	}
	.cc-bloque-titulo {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.cc-pasos {
		margin: 0.25rem 0 0;
		padding-left: 1.25rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
	.cc-copiar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.cc-copiar code {
		display: block;
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-size: 0.72rem;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cc-btn {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 0.5rem 0.85rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color 0.15s ease;
	}
	.cc-btn:hover {
		background: var(--bg-base);
	}
	.cc-btn--oscuro {
		border-color: transparent;
		background: var(--bg-charcoal, #1f2937);
		color: var(--text-on-dark, #fff);
	}
	.cc-btn--oscuro:hover {
		background: var(--bg-charcoal-deep, #111827);
	}
	.cc-btn--primario {
		border-color: transparent;
		background: var(--emerald-700);
		color: #fff;
		font-size: 0.85rem;
	}
	.cc-btn--primario:hover {
		background: var(--emerald-800);
	}
	.cc-btn--primario:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
	.cc-btn-icono {
		display: inline-flex;
		padding: 0.25rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--emerald-800);
		cursor: pointer;
	}

	.cc-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	@media (min-width: 640px) {
		.cc-form {
			flex-direction: row;
		}
	}
	.cc-form input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border-default);
		border-radius: 10px;
		background: var(--bg-surface);
		font-family: inherit;
		font-size: 0.875rem;
		color: var(--text-primary);
	}
	.cc-form input:focus {
		outline: none;
		border-color: var(--emerald-600);
		box-shadow: 0 0 0 1px var(--emerald-600);
	}

	.cc-seccion {
		margin: 0 0 0.5rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.cc-vacio {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin: 0;
		padding: 1.25rem 1rem;
		border-radius: 10px;
		background: var(--bg-base);
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.cc-lista {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		overflow: hidden;
	}
	.cc-lista li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
	}
	.cc-lista li + li {
		border-top: 1px solid var(--border-subtle);
	}
	.cc-lista :global(.cc-item-icono) {
		flex-shrink: 0;
		color: var(--emerald-700);
	}
	.cc-item-texto {
		flex: 1;
		min-width: 0;
	}
	.cc-item-nombre {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cc-item-meta {
		margin: 0;
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.cc-mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.cc-revocar {
		flex-shrink: 0;
		padding: 0.35rem 0.75rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		color: #dc2626;
		cursor: pointer;
	}
	.cc-revocar:hover {
		background: rgba(220, 38, 38, 0.08);
	}
	:global(.cc-girar) {
		animation: cc-giro 0.9s linear infinite;
	}
	@keyframes cc-giro {
		to {
			transform: rotate(360deg);
		}
	}
</style>
