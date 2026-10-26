<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { ArrowLeft, Clock3, KeyRound, Smartphone, UserRound } from 'lucide-svelte';
	import { usuariosAPI, type Usuario } from '$lib/api/usuarios';
	import { sesionesAPI, type ActividadMovil, type Sesion } from '$lib/api/sesiones';
	import { AREA_LABELS } from '$lib/config/permissions';
	import { etiquetaVinculacion } from '$lib/config/personal';

	interface Props { id: string }
	let { id }: Props = $props();
	let usuario = $state<Usuario | null>(null);
	let sesiones = $state<Sesion[]>([]);
	let movil = $state<ActividadMovil | null>(null);
	let cargando = $state(true);
	let error = $state('');
	let errorSesiones = $state(false);
	let errorMovil = $state(false);
	let numeroPeticion = 0;

	const permisosIndividuales = $derived(
		Object.entries(usuario?.permisos ?? {}).filter(([, permitido]) => permitido === true).map(([idPermiso]) => idPermiso)
	);
	const permisosRuta = $derived(Object.entries(usuario?.permisos_rutas ?? {}));
	const sesionesActivas = $derived(sesiones.filter((sesion) => sesion.is_active));
	const areas = $derived((usuario?.area ?? []).map((area) => AREA_LABELS[area as keyof typeof AREA_LABELS] ?? area));

	$effect(() => {
		const idActual = id;
		if (idActual) untrack(() => { void cargar(idActual); });
	});

	async function cargar(idUsuario = id) {
		const peticion = ++numeroPeticion;
		cargando = true;
		error = '';
		errorSesiones = false;
		errorMovil = false;
		const resultados = await Promise.allSettled([
			usuariosAPI.obtenerPorId(idUsuario),
			sesionesAPI.listar({ usuarioId: idUsuario, limit: 200 }),
			sesionesAPI.actividadMovil()
		]);
		if (peticion !== numeroPeticion) return;
		if (resultados[0].status === 'fulfilled') usuario = resultados[0].value;
		else error = 'No se pudo cargar la ficha administrativa.';
		if (resultados[1].status === 'fulfilled') sesiones = resultados[1].value;
		else { sesiones = []; errorSesiones = true; }
		if (resultados[2].status === 'fulfilled') movil = resultados[2].value.find((actividad) => actividad.kind === 'usuario' && actividad.id === idUsuario) ?? null;
		else { movil = null; errorMovil = true; }
		cargando = false;
	}

	function fecha(valor?: string | null) {
		if (!valor) return 'Sin registro';
		const date = new Date(valor);
		return Number.isNaN(date.getTime()) ? 'Sin registro' : new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}

	function nombreModulo(idModulo: string) {
		return idModulo.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letra) => letra.toUpperCase());
	}
</script>

<svelte:head>
	<title>{usuario?.nombre ? `${usuario.nombre} | Personal` : 'Ficha administrativa | Personal'}</title>
</svelte:head>

<section class="fa-page" aria-label="Ficha administrativa">
	<a class="fa-back" href="/dashboard/personal?tipo=administrativo" onclick={(event) => { event.preventDefault(); void goto('/dashboard/personal?tipo=administrativo'); }}><ArrowLeft size={16} /> Volver a Personal</a>
	{#if cargando}
		<div class="fa-state">Cargando ficha administrativa…</div>
	{:else if error || !usuario}
		<div class="fa-state fa-state--error">{error || 'No se encontró esta cuenta.'}<button type="button" onclick={() => void cargar()}>Reintentar</button></div>
	{:else}
		<header class="fa-hero">
			<div class="fa-avatar"><UserRound size={26} /></div>
			<div class="fa-hero__identity"><p>Personal administrativo</p><h1>{usuario.nombre}</h1><span>{usuario.cargo || 'Sin cargo asignado'} · {usuario.correo}</span></div>
			<span class:inactive={usuario.activo === false} class="fa-status">{usuario.activo === false ? 'Inactivo' : 'Activo'}</span>
		</header>

		<div class="fa-summary">
			<div><span>Vinculación</span><strong>{etiquetaVinculacion(usuario.tipo_vinculacion)}</strong></div>
			<div><span>Área</span><strong>{areas.join(' · ') || 'Sin área asignada'}</strong></div>
			<div><span>Sesiones activas</span><strong>{errorSesiones ? 'No disponible' : sesionesActivas.length}</strong></div>
			<div><span>Acceso móvil</span><strong>{errorMovil ? 'No disponible' : movil ? (movil.en_linea ? 'En línea' : 'Con historial') : 'Sin actividad'}</strong></div>
		</div>

		<div class="fa-grid">
			<section class="fa-card">
				<div class="fa-card__heading"><UserRound size={17} /><h2>Información personal</h2></div>
				<dl>
					<div><dt>Documento</dt><dd>{usuario.numero_documento || 'Sin documento registrado'}</dd></div>
					<div><dt>Correo</dt><dd>{usuario.correo}</dd></div>
					<div><dt>Teléfono</dt><dd>{usuario.telefono || 'Sin teléfono'}</dd></div>
					<div><dt>Fecha de ingreso</dt><dd>{fecha(usuario.fecha_ingreso)}</dd></div>
					<div><dt>Cargo</dt><dd>{usuario.cargo || 'Sin cargo'}</dd></div>
					<div><dt>Tipo de vinculación</dt><dd>{etiquetaVinculacion(usuario.tipo_vinculacion)}</dd></div>
					<div><dt>Rol de plataforma</dt><dd>{usuario.role || 'Usuario'}</dd></div>
					<div><dt>Áreas</dt><dd>{areas.join(', ') || 'Sin áreas'}</dd></div>
				</dl>
			</section>

			<section class="fa-card">
				<div class="fa-card__heading"><Clock3 size={17} /><h2>Cuenta y acceso</h2></div>
				<dl>
					<div><dt>Alta</dt><dd>{usuario.es_invitado ? 'Se unió por invitación' : 'Creado directamente'}</dd></div>
					<div><dt>Invitado / creado por</dt><dd>{usuario.actor_alta?.nombre || (usuario.es_invitado ? 'Invitador anterior no disponible' : usuario.creado_por_id ? 'Creador no disponible' : 'Registro histórico sin autor')}</dd></div>
					<div><dt>Fecha de creación</dt><dd>{fecha(usuario.created_at)}</dd></div>
					<div><dt>Último acceso</dt><dd>{fecha(usuario.ultimo_acceso)}</dd></div>
					<div><dt>Estado</dt><dd>{usuario.activo === false ? 'Cuenta desactivada' : 'Cuenta habilitada'}</dd></div>
				</dl>
			</section>

			<section class="fa-card">
				<div class="fa-card__heading"><Smartphone size={17} /><h2>Acceso a apps móviles</h2></div>
				{#if errorMovil}
					<p class="fa-empty">No se pudo consultar la actividad móvil. <button type="button" onclick={() => void cargar()}>Reintentar</button></p>
				{:else if movil}
					<dl>
						<div><dt>Dispositivo</dt><dd>{movil.platform || 'Plataforma no identificada'}</dd></div>
						<div><dt>Sesiones registradas</dt><dd>{movil.sessions_count}</dd></div>
						<div><dt>Primer acceso</dt><dd>{fecha(movil.first_seen_at)}</dd></div>
						<div><dt>Último acceso</dt><dd>{fecha(movil.last_seen_at)}</dd></div>
					</dl>
				{:else}<p class="fa-empty">Esta cuenta aún no registra actividad en las apps móviles.</p>{/if}
			</section>

			<section class="fa-card">
				<div class="fa-card__heading"><KeyRound size={17} /><h2>Roles y permisos</h2></div>
				<p class="fa-subtitle">Rol: <strong>{usuario.role || 'usuario'}</strong></p>
				{#if permisosRuta.length}
					<ul class="fa-permissions">{#each permisosRuta as [permiso, nivel] (permiso)}<li><span>{nombreModulo(permiso)}</span><b>{nivel}</b></li>{/each}</ul>
				{:else if permisosIndividuales.length}
					<div class="fa-chips">{#each permisosIndividuales as permiso (permiso)}<span>{nombreModulo(permiso)}</span>{/each}</div>
				{:else}<p class="fa-empty">Usa los permisos definidos por sus áreas.</p>{/if}
			</section>
		</div>

		<section class="fa-card fa-sessions">
			<div class="fa-card__heading"><Clock3 size={17} /><h2>Sesiones de plataforma</h2><span>{sesiones.length} registradas</span></div>
			{#if errorSesiones}
				<p class="fa-empty">No se pudieron cargar las sesiones. <button type="button" onclick={() => void cargar()}>Reintentar</button></p>
			{:else if sesiones.length}
				<div class="fa-session-list">
					{#each sesiones as sesion (sesion.id)}
						<article class="fa-session"><div><strong>{sesion.is_active ? 'Sesión activa' : 'Sesión cerrada'}</strong><span>{sesion.user_agent || 'Dispositivo sin identificar'}</span></div><div><span>IP</span><strong>{sesion.ip || 'No registrada'}</strong></div><div><span>Última actividad</span><strong>{fecha(sesion.last_activity)}</strong></div><div><span>Inicio</span><strong>{fecha(sesion.created_at)}</strong></div></article>
					{/each}
				</div>
			{:else}<p class="fa-empty">No hay sesiones registradas para esta cuenta.</p>{/if}
		</section>
	{/if}
</section>

<style>
	.fa-page{display:grid;gap:1rem;color:var(--text-primary)}
	.fa-back{display:inline-flex;align-items:center;gap:.45rem;width:max-content;color:var(--text-muted);font-size:.78rem;font-weight:700;text-decoration:none}
	.fa-back:hover{color:var(--au-primary-strong)}
	.fa-state{display:grid;justify-items:center;gap:.75rem;padding:3rem 1rem;border:1px solid var(--border-subtle);border-radius:16px;background:var(--bg-surface);color:var(--text-muted);font-size:.85rem}
	.fa-state button{border:0;background:none;color:var(--au-primary-strong);font:inherit;font-weight:750;cursor:pointer}.fa-state--error{color:#b42318}
	.fa-hero{display:flex;align-items:center;gap:1rem;padding:1.25rem;border:1px solid var(--border-subtle);border-radius:18px;background:var(--bg-surface)}
	.fa-avatar{display:grid;place-items:center;width:3.25rem;height:3.25rem;flex:none;border-radius:15px;background:var(--bg-base);color:var(--au-primary-strong)}
	.fa-hero__identity{display:grid;gap:.18rem;min-width:0;flex:1}.fa-hero__identity p{margin:0;color:var(--au-primary-strong);font-size:.62rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.fa-hero h1{margin:0;font-family:var(--font-display);font-size:1.25rem;font-weight:850}.fa-hero__identity span{overflow:hidden;color:var(--text-muted);font-size:.78rem;text-overflow:ellipsis;white-space:nowrap}
	.fa-status{padding:.38rem .65rem;border-radius:999px;background:#e8f7ef;color:#137a45;font-size:.68rem;font-weight:800}.fa-status.inactive{background:#f1f2f4;color:#667085}
	.fa-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.65rem}.fa-summary>div{display:grid;gap:.25rem;min-width:0;padding:.85rem .95rem;border:1px solid var(--border-subtle);border-radius:14px;background:var(--bg-surface)}.fa-summary span,.fa-card dt,.fa-session>div>span{color:var(--text-muted);font-size:.67rem}.fa-summary strong{overflow-wrap:anywhere;font-size:.83rem}
	.fa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.fa-card{min-width:0;padding:1rem 1.1rem;border:1px solid var(--border-subtle);border-radius:16px;background:var(--bg-surface)}.fa-card__heading{display:flex;align-items:center;gap:.5rem;margin-bottom:.9rem;color:var(--au-primary-strong)}.fa-card__heading h2{margin:0;color:var(--text-primary);font-size:.9rem;font-weight:800}.fa-card__heading>span{margin-left:auto;color:var(--text-muted);font-size:.68rem}
	.fa-card dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem 1rem;margin:0}.fa-card dl>div{display:grid;gap:.22rem;min-width:0}.fa-card dt{margin:0}.fa-card dd{margin:0;overflow-wrap:anywhere;font-size:.77rem;font-weight:650}.fa-empty{margin:0;color:var(--text-muted);font-size:.76rem}.fa-empty button{padding:0;border:0;background:none;color:var(--au-primary-strong);font:inherit;font-weight:750;cursor:pointer}.fa-subtitle{margin:-.3rem 0 .75rem;color:var(--text-muted);font-size:.73rem}.fa-subtitle strong{color:var(--text-primary)}
	.fa-chips{display:flex;flex-wrap:wrap;gap:.4rem}.fa-chips span{padding:.35rem .55rem;border:1px solid var(--border-subtle);border-radius:999px;color:var(--text-secondary);font-size:.67rem;font-weight:700}.fa-permissions{display:grid;gap:.4rem;margin:0;padding:0;list-style:none}.fa-permissions li{display:flex;justify-content:space-between;gap:1rem;padding:.45rem .55rem;border-radius:8px;background:var(--bg-base);font-size:.7rem}.fa-permissions b{color:var(--au-primary-strong);font-weight:800}
	.fa-session-list{display:grid;gap:.5rem}.fa-session{display:grid;grid-template-columns:minmax(0,2fr) minmax(6rem,.8fr) minmax(9rem,1fr) minmax(9rem,1fr);gap:.75rem;align-items:center;padding:.65rem .7rem;border-radius:10px;background:var(--bg-base)}.fa-session>div{display:grid;gap:.2rem;min-width:0}.fa-session strong,.fa-session span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fa-session strong{font-size:.7rem}.fa-session span{color:var(--text-muted);font-size:.63rem}
	@media(max-width:900px){.fa-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.fa-session{grid-template-columns:repeat(2,minmax(0,1fr))}}
	@media(max-width:650px){.fa-grid{grid-template-columns:1fr}.fa-hero{align-items:flex-start;flex-wrap:wrap}.fa-status{margin-left:auto}.fa-card dl{grid-template-columns:1fr 1fr}}
</style>
