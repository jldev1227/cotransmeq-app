<script lang="ts">
	/**
	 * Primera celda de una fila de directorio: quién es el registro.
	 *
	 * Avatar (foto, iniciales o un código como la placa), título en negrita y
	 * una segunda línea gris. Es lo que sustituye a la tarjeta: la fila «es» la
	 * tarjeta, pero horizontal y sin caja propia.
	 */
	interface Props {
		titulo: string;
		subtitulo?: string;
		/** Foto del registro; si falla o no hay, se pintan las iniciales. */
		foto?: string | null;
		/** Iniciales para el avatar. Se derivan del título si no se pasan. */
		iniciales?: string;
		/** Código corto (placa, NIT) en lugar de iniciales: va en una caja ancha. */
		codigo?: string;
		/** Color del avatar; por defecto el tinte de la marca. */
		tono?: string;
		/** Se pinta en la esquina del avatar: un punto con el estado. */
		punto?: string;
	}

	let { titulo, subtitulo, foto = null, iniciales, codigo, tono, punto }: Props = $props();

	let fotoRota = $state(false);

	const letras = $derived(
		iniciales ??
			titulo
				.trim()
				.split(/\s+/)
				.slice(0, 2)
				.map((p) => p[0]?.toUpperCase() ?? '')
				.join('')
	);
</script>

<div class="identidad">
	<span
		class="avatar"
		class:avatar--codigo={!!codigo}
		style={tono ? `background:${tono}1a;color:${tono}` : undefined}
		aria-hidden="true"
	>
		{#if foto && !fotoRota}
			<img src={foto} alt="" loading="lazy" onerror={() => (fotoRota = true)} />
		{:else if codigo}
			{codigo}
		{:else}
			{letras}
		{/if}
		{#if punto}<span class="avatar-punto" style="background:{punto}"></span>{/if}
	</span>
	<span class="texto">
		<span class="titulo">{titulo}</span>
		{#if subtitulo}<span class="subtitulo">{subtitulo}</span>{/if}
	</span>
</div>

<style>
	.identidad {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}
	.avatar {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border-radius: 12px;
		overflow: hidden;
		background: var(--au-tint, #ddf7ea);
		color: var(--emerald-800);
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.02em;
	}
	.avatar--codigo {
		width: auto;
		min-width: 64px;
		padding: 0 0.6rem;
		font-size: 0.78rem;
		letter-spacing: 0.08em;
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.avatar-punto {
		position: absolute;
		right: 2px;
		bottom: 2px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		border: 2px solid #fff;
	}
	.texto {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.titulo {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.subtitulo {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin-top: 1px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
