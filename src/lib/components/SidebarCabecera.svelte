<script lang="ts">
	/**
	 * Cabecera del menú lateral: la misma del menú de la app móvil.
	 *
	 * Saludo según la hora, primer nombre, fecha de hoy y las áreas del usuario
	 * sobre el verde de marca con dos círculos decorativos. Sirve para el
	 * escritorio y para el cajón móvil; con `compacta` (menú contraído) queda
	 * solo la inicial en un disco, con el nombre completo como tooltip.
	 */
	import { AREA_LABELS, type Area } from '$lib/config/permissions';

	export let usuario: { nombre?: string | null; area?: unknown } | null = null;
	export let compacta = false;
	/// En el cajón móvil la cabecera llega hasta arriba: respeta el notch.
	export let conSafeArea = false;

	function primerNombre(nombre: string | undefined | null): string {
		const primero = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
		return primero
			? primero.charAt(0).toLocaleUpperCase('es') + primero.slice(1).toLocaleLowerCase('es')
			: 'Equipo';
	}

	function saludo(hora: number): string {
		if (hora < 12) return 'Buenos días';
		if (hora < 19) return 'Buenas tardes';
		return 'Buenas noches';
	}

	function iniciales(nombre: string | undefined | null): string {
		const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
		return (partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '') || '?';
	}

	$: hoy = (() => {
		const t = new Date().toLocaleDateString('es-CO', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		});
		return t.charAt(0).toLocaleUpperCase('es') + t.slice(1);
	})();

	$: areas = (() => {
		const a = usuario?.area;
		const lista = Array.isArray(a) ? a : a ? [a] : [];
		return lista.map((x) => AREA_LABELS[x as Area] ?? String(x));
	})();
</script>

<div class="cabecera" class:cabecera--compacta={compacta} class:cabecera--safe={conSafeArea}>
	<span class="orbe orbe--grande" aria-hidden="true"></span>
	<span class="orbe orbe--chico" aria-hidden="true"></span>
	{#if compacta}
		<span class="inicial" title={usuario?.nombre ?? undefined}>{iniciales(usuario?.nombre).toUpperCase()}</span>
	{:else}
		<div class="copy">
			<span class="eyebrow">Sistema de gestión</span>
			<span class="saludo">{saludo(new Date().getHours())},</span>
			<span class="nombre">{primerNombre(usuario?.nombre)}</span>
			<span class="hoy">{hoy}</span>
			{#if areas.length}
				<span class="areas">
					{#each areas as area (area)}
						<span class="area">{area}</span>
					{/each}
				</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.cabecera {
		position: relative;
		overflow: hidden;
		flex-shrink: 0;
		padding: 1.35rem;
		background: linear-gradient(160deg, var(--au-dark-2) 0%, var(--au-dark) 100%);
	}
	.cabecera--safe {
		padding-top: calc(env(safe-area-inset-top, 0px) + 1.35rem);
	}
	.cabecera--compacta {
		display: flex;
		justify-content: center;
		padding: 1.1rem 0.75rem;
	}
	.orbe {
		position: absolute;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.07);
	}
	.orbe--grande {
		width: 150px;
		height: 150px;
		right: -40px;
		top: -60px;
	}
	.orbe--chico {
		width: 70px;
		height: 70px;
		left: -22px;
		bottom: -30px;
	}
	.cabecera--compacta .orbe--grande {
		width: 90px;
		height: 90px;
		right: -35px;
		top: -35px;
	}
	.copy {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.eyebrow {
		margin-bottom: 6px;
		font-size: 0.58rem;
		font-weight: 900;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--au-eyebrow);
	}
	.saludo {
		font-size: 0.82rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.8);
	}
	.nombre {
		font-size: 1.4rem;
		font-weight: 900;
		letter-spacing: -0.02em;
		line-height: 1.15;
		color: #fff;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hoy {
		margin-top: 6px;
		font-size: 0.75rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.75);
	}
	.areas {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 8px;
	}
	.area {
		padding: 3px 9px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		font-size: 0.68rem;
		font-weight: 700;
		color: #fff;
	}
	.inicial {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.14);
		border: 1.5px solid rgba(255, 255, 255, 0.25);
		font-size: 0.95rem;
		font-weight: 900;
		letter-spacing: 0.02em;
		color: #fff;
	}
</style>
