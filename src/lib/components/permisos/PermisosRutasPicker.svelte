<!--
	PermisosRutasPicker — editor de `users.permisos_rutas`.

	El caso que lo justifica: «es de mantenimiento, pero solo entra a formularios,
	placas, conductores y servicios, y solo en consulta». Con reglas por área eso
	no se puede decir — habría que inventar un área por cada excepción. Aquí se
	dice módulo a módulo.

	Dos modos, y la diferencia importa:
	  · «Heredar del área» guarda `null`: el usuario sigue las reglas del área y
	    hereda automáticamente los módulos que se añadan en el futuro.
	  · «Personalizar rutas» guarda un objeto: cada ruta limita el nivel que el
	    área ya concede. No puede ampliar el acceso de un área.

	Al pasar a personalizar se precarga lo que las áreas ya conceden, porque el
	trabajo real es recortar (quitar módulos, bajar de nivel), no partir de cero.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		ROUTE_PERMISSIONS,
		OMAR_OPERACIONES_ID,
		PERMISOS_RUTA_ESPECIALES,
		getAccessibleModules,
		type AccessLevel,
		type Area
	} from '$lib/config/permissions';

	interface Props {
		/** Áreas seleccionadas en el formulario padre — alimentan la precarga. */
		areas: string[];
		/** Usuario editado: activa las excepciones individuales explícitas. */
		userId?: string;
		/** Valor inicial. `null` hereda del área; `{}` deja solo el perfil. */
		valor?: Record<string, AccessLevel> | null;
		/** Se llama con `null` (heredar) o con el mapa personalizado por ruta. */
		onchange: (valor: Record<string, AccessLevel> | null) => void;
		/** Prefijo para los `id`/`name` — hay dos pickers vivos en la misma app. */
		idPrefix?: string;
	}

	let { areas, userId = '', valor = null, onchange, idPrefix = 'pr' }: Props = $props();

	/// Etiqueta corta de cada módulo. Vive aquí y no en `config/permissions.ts`
	/// porque ese fichero es espejo exacto del backend: meterle texto de UI lo
	/// haría divergir en el primer retoque de copy.
	const MODULO_LABELS: Record<string, string> = {
		perfil: 'Mi perfil',
		flota: 'Flota (placas)',
		conductores: 'Conductores',
		servicios: 'Servicios',
		recargos: 'Recargos',
		clientes: 'Clientes',
		sarlaft: 'SARLAFT / PTEE',
		asistencias: 'Asistencias',
		'acciones-correctivas': 'Acciones correctivas',
		evaluaciones: 'Evaluaciones',
		'salidas-nc': 'Salidas no conformes',
		viaticos: 'Viáticos',
		formularios: 'Formularios',
		nomina: 'Nómina',
		extractos: 'Extractos',
		'liquidaciones-servicios': 'Liq. de servicios',
		'liquidaciones-servicios-seccion06': 'Liq. servicios — Sección 06',
		'liquidaciones-terceros': 'Liq. de terceros',
		'liquidaciones-terceros-adicionales': 'Liq. terceros — adicionales',
		certificados: 'Certificados tributarios',
		contabilidad: 'Contabilidad',
		terceros: 'Terceros',
		usuarios: 'Usuarios del sistema',
		sesiones: 'Sesiones',
		directorio: 'Equipo / directorio',
		recorridos: 'Recorridos y días laborados'
	};

	const NIVEL_LABELS: Record<AccessLevel, string> = {
		read: 'Consulta',
		limited: 'Limitado',
		full: 'Completo'
	};

	/// `perfil` se excluye de la lista editable: `checkAccess` lo concede siempre,
	/// incluso con una personalización vacía, así que ofrecer un interruptor sería mentir.
	const modulos = Object.entries(ROUTE_PERMISSIONS)
		.filter(([id]) => id !== 'perfil')
		.map(([id, permiso]) => ({
			id,
			label: MODULO_LABELS[id] ?? id,
			descripcion: permiso.description ?? '',
			// «Limitado» solo se ofrece donde hay un permiso parcial de área o una
			// capacidad puntual definida para la ruta.
			niveles: (permiso.allowLimited || permiso.limited?.length ? ['read', 'limited', 'full'] : ['read', 'full']) as AccessLevel[]
		}));

	/// `valor` se lee UNA vez, al montar, y a partir de ahí manda el estado
	/// interno: el padre recibe cada cambio por `onchange` y volver a leerlo
	/// pisaría lo que el usuario acaba de marcar. `untrack` lo hace explícito.
	let modo = $state<'area' | 'rutas'>(untrack(() => (valor !== null ? 'rutas' : 'area')));
	let seleccion = $state<Record<string, AccessLevel>>(untrack(() => ({ ...(valor ?? {}) })));
	let filtro = $state('');
	let personalizacionInicializada = $state(valor !== null && valor !== undefined);

	/** Lo que las áreas marcadas conceden hoy — base de la precarga y del resumen. */
	const heredado = $derived(getAccessibleModules(areas as Area[], null, userId));
	const jerarquia: AccessLevel[] = ['limited', 'read', 'full'];
	const permisoEspecial = $derived(PERMISOS_RUTA_ESPECIALES[userId] ?? {});
	const nivelEspecialRecorridos = $derived.by(() => {
		const nivel = modo === 'rutas' ? seleccion.recorridos : heredado.recorridos;
		return nivel ? limitarNivel(heredado.recorridos, nivel) : null;
	});
	const nivelEspecialSeccion06 = $derived.by(() => {
		const id = 'liquidaciones-servicios-seccion06';
		const nivel = modo === 'rutas' ? seleccion[id] : heredado[id];
		return nivel ? limitarNivel(heredado[id], nivel) : null;
	});

	function limitarNivel(base: AccessLevel | undefined, personalizado: AccessLevel): AccessLevel | null {
		if (!base) return null;
		return jerarquia[Math.min(jerarquia.indexOf(base), jerarquia.indexOf(personalizado))];
	}

	const modulosVisibles = $derived.by(() => {
		const t = filtro.trim().toLowerCase();
		if (!t) return modulos;
		return modulos.filter(
			(m) => m.label.toLowerCase().includes(t) || m.descripcion.toLowerCase().includes(t)
		);
	});

	const concedidos = $derived.by(() =>
		modulos.flatMap((modulo) => {
			const nivelArea = heredado[modulo.id];
			const nivel = modo === 'rutas'
				? seleccion[modulo.id]
					? limitarNivel(nivelArea, seleccion[modulo.id])
					: null
				: nivelArea;
			if (!nivel) return [];
			return [{ label: modulo.label, nivel }];
		})
	);

	/// `{}` es una personalización explícita sin rutas: solo queda el perfil.
	const listaVacia = $derived(modo === 'rutas' && Object.keys(seleccion).length === 0);

	function emitir() {
		onchange(modo === 'rutas' ? { ...seleccion } : null);
	}

	function cambiarModo(nuevo: 'area' | 'rutas') {
		if (modo === nuevo) return;
		modo = nuevo;
		// Precarga al entrar en «personalizar»: ajustar es quitar y bajar de
		// nivel, no reconstruir a mano lo que el área ya concedía.
		if (nuevo === 'rutas' && !personalizacionInicializada) {
			precargarDesdeAreas();
			personalizacionInicializada = true;
		}
		emitir();
	}

	function precargarDesdeAreas() {
		const base: Record<string, AccessLevel> = {};
		for (const m of modulos) {
			const nivel = heredado[m.id];
			if (nivel) base[m.id] = nivel;
		}
		seleccion = base;
	}

	function setNivel(moduloId: string, nivel: AccessLevel | null) {
		const copia = { ...seleccion };
		if (nivel === null) delete copia[moduloId];
		else copia[moduloId] = nivel;
		seleccion = copia;
		emitir();
	}

	function aplicarATodos(nivel: AccessLevel | null) {
		if (nivel === null) {
			seleccion = {};
		} else {
			const copia: Record<string, AccessLevel> = {};
			for (const m of modulos) {
				const nivelArea = heredado[m.id];
				if (!nivelArea) continue;
				const elegido = m.niveles.includes(nivel) ? nivel : 'read';
				copia[m.id] = limitarNivel(nivelArea, elegido) ?? nivelArea;
			}
			seleccion = copia;
		}
		emitir();
	}

	function restaurarDesdeAreas() {
		precargarDesdeAreas();
		emitir();
	}

	/// Cambiar de área puede dejar de permitir un nivel elegido antes; nunca se
	/// conserva en la base personalizada un nivel que la nueva área no concede.
	$effect(() => {
		if (modo !== 'rutas') return;
		const ajustada: Record<string, AccessLevel> = {};
		for (const [moduleId, nivel] of Object.entries(seleccion)) {
			const efectivo = limitarNivel(heredado[moduleId], nivel);
			if (efectivo) ajustada[moduleId] = efectivo;
		}
		if (JSON.stringify(ajustada) !== JSON.stringify(seleccion)) {
			seleccion = ajustada;
			onchange({ ...ajustada });
		}
	});
</script>

<div class="prp">
	<!-- ─── Selector de modo ─────────────────────────────────────────────── -->
	<div class="prp__modos" role="radiogroup" aria-label="Origen de los permisos">
		<button
			type="button"
			class="prp__modo"
			class:prp__modo--activo={modo === 'area'}
			role="radio"
			aria-checked={modo === 'area'}
			onclick={() => cambiarModo('area')}
		>
			<span class="prp__modo-titulo">Heredar del área</span>
			<span class="prp__modo-desc">
				Manda la configuración de las áreas marcadas. Si mañana se añade un módulo al área, lo
				recibe automáticamente.
			</span>
		</button>
		<button
			type="button"
			class="prp__modo"
			class:prp__modo--activo={modo === 'rutas'}
			role="radio"
			aria-checked={modo === 'rutas'}
			onclick={() => cambiarModo('rutas')}
		>
			<span class="prp__modo-titulo">Personalizar rutas</span>
			<span class="prp__modo-desc">
				Limita las rutas y niveles que las áreas ya permiten. No concede acceso a módulos fuera de
				ellas.
			</span>
		</button>
	</div>

	{#if userId === OMAR_OPERACIONES_ID && areas.includes('operaciones')}
		<div class="prp__aviso prp__aviso--info">
			<strong>Permisos individuales de Omar (Operaciones)</strong>
			<ul>
				{#if permisoEspecial.recorridos}
					<li>
						Recorridos y días laborados: {nivelEspecialRecorridos ? NIVEL_LABELS[nivelEspecialRecorridos] : 'Sin acceso'}.
						{#if nivelEspecialRecorridos === 'full'}Puede modificarlos.{:else}Solo puede consultarlos o no tiene acceso.{/if}
					</li>
				{/if}
				{#if permisoEspecial['liquidaciones-servicios-seccion06']}
					<li>
						Liquidaciones de servicios — SECCIÓN 06, Hoja 4:
						{nivelEspecialSeccion06 ? NIVEL_LABELS[nivelEspecialSeccion06] : 'Sin acceso'}.
						{#if nivelEspecialSeccion06 === 'full'}Puede actualizar los valores de terceros.{:else}No puede modificar los valores.{/if}
					</li>
				{/if}
			</ul>
			La personalización por ruta puede conservar, reducir o quitar estos accesos.
		</div>
	{/if}

	{#if modo === 'rutas'}
		<!-- ─── Acciones masivas + filtro ────────────────────────────────── -->
		<div class="prp__barra">
			<label class="prp__buscar">
				<span class="prp__sr">Filtrar módulos</span>
				<!-- El picker se monta dentro del <form> del modal de edición: sin
				     este corte, un Enter para «terminar de filtrar» guardaría el
				     usuario a medio configurar. -->
				<input
					type="search"
					bind:value={filtro}
					placeholder="Filtrar módulos…"
					id="{idPrefix}-filtro"
					onkeydown={(e) => e.key === 'Enter' && e.preventDefault()}
				/>
			</label>
			<div class="prp__acciones">
				<button type="button" class="prp__chip" onclick={restaurarDesdeAreas}>
					Volver a lo del área
				</button>
				<button type="button" class="prp__chip" onclick={() => aplicarATodos('read')}>
					Todo en consulta
				</button>
				<button type="button" class="prp__chip" onclick={() => aplicarATodos(null)}>
					Quitar todo
				</button>
			</div>
		</div>

		{#if listaVacia}
			<p class="prp__aviso prp__aviso--warn">
				No hay ninguna ruta marcada. Se guardará la personalización vacía y el usuario solo conservará
				acceso a su perfil.
			</p>
		{/if}

		<!-- ─── Lista de módulos ─────────────────────────────────────────── -->
		<div class="prp__lista">
			{#each modulosVisibles as modulo (modulo.id)}
				{@const actual = seleccion[modulo.id] ?? null}
				{@const nivelArea = heredado[modulo.id]}
				{@const efectivo = actual ? limitarNivel(nivelArea, actual) : null}
				<div class="prp__fila" class:prp__fila--activa={actual !== null}>
					<div class="prp__info">
						<span class="prp__label">{modulo.label}</span>
						<span class="prp__base">
							Área: {nivelArea ? NIVEL_LABELS[nivelArea] : 'Sin acceso'}
							{#if modo === 'rutas'} · efectivo: {efectivo ? NIVEL_LABELS[efectivo] : 'Sin acceso'}{/if}
						</span>
						{#if modulo.descripcion}
							<span class="prp__desc">{modulo.descripcion}</span>
						{/if}
					</div>
					<div class="prp__niveles" role="radiogroup" aria-label="Nivel de acceso a {modulo.label}">
						<button
							type="button"
							class="prp__nivel"
							class:prp__nivel--sel={actual === null}
							role="radio"
							aria-checked={actual === null}
							disabled={!nivelArea}
							onclick={() => setNivel(modulo.id, null)}
						>
							Sin acceso
						</button>
						{#each modulo.niveles as nivel}
							{@const permitido = limitarNivel(nivelArea, nivel) === nivel}
							<button
								type="button"
								class="prp__nivel prp__nivel--{nivel}"
								class:prp__nivel--sel={actual === nivel}
								role="radio"
								aria-checked={actual === nivel}
								disabled={!permitido}
								onclick={() => setNivel(modulo.id, nivel)}
							>
								{NIVEL_LABELS[nivel]}
							</button>
						{/each}
					</div>
				</div>
			{/each}
			{#if modulosVisibles.length === 0}
				<p class="prp__vacio">Ningún módulo coincide con «{filtro}».</p>
			{/if}
		</div>
	{/if}

	<!-- ─── Resumen legible ──────────────────────────────────────────────── -->
	<div class="prp__resumen">
				<span class="prp__resumen-titulo">
			{modo === 'rutas' ? 'Acceso efectivo después de limitarlo' : 'Con las áreas marcadas tendría acceso a'}
		</span>
		{#if areas.length === 0 && modo === 'area'}
			<p class="prp__vacio">Sin áreas seleccionadas todavía.</p>
		{:else}
			<ul class="prp__resumen-lista">
				<li class="prp__resumen-item">
					<span class="prp__resumen-modulo">Mi perfil</span>
					<span class="prp__pill prp__pill--full">Siempre</span>
				</li>
				{#each concedidos as item}
					<li class="prp__resumen-item">
						<span class="prp__resumen-modulo">{item.label}</span>
						<span class="prp__pill prp__pill--{item.nivel}">{NIVEL_LABELS[item.nivel]}</span>
					</li>
				{/each}
			</ul>
			{#if concedidos.length === 0}
				<p class="prp__vacio">Solo su perfil.</p>
			{/if}
		{/if}
	</div>
</div>

<style>
	.prp {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.prp__sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	/* ─── Modo ─────────────────────────────────────────────────────────── */
	.prp__modos {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.625rem;
	}

	.prp__modo {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.75rem 0.875rem;
		text-align: left;
		border: 1.5px solid var(--border-subtle, #e5e7eb);
		border-radius: 0.875rem;
		background: var(--bg-surface, #ffffff);
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}

	.prp__modo:hover {
		border-color: #bbf7d0;
	}

	.prp__modo--activo {
		border-color: #ea580c;
		background: #f0fdf4;
	}

	.prp__modo-titulo {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, #0f172a);
	}

	.prp__modo-desc {
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--text-muted, #6b7280);
	}

	/* ─── Avisos ───────────────────────────────────────────────────────── */
	.prp__aviso {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.75rem;
		line-height: 1.45;
	}

	.prp__aviso--info {
		background: #eff6ff;
		color: #1d4ed8;
	}

	.prp__aviso--warn {
		background: #fffbeb;
		color: #92400e;
	}

	/* ─── Barra de acciones ────────────────────────────────────────────── */
	.prp__barra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.prp__buscar input {
		width: 12rem;
		padding: 0.4rem 0.625rem;
		border: 1px solid var(--border-subtle, #e5e7eb);
		border-radius: 0.5rem;
		font-size: 0.75rem;
		outline: none;
	}

	.prp__buscar input:focus {
		border-color: #ea580c;
	}

	.prp__acciones {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.prp__chip {
		padding: 0.3rem 0.625rem;
		border: 1px solid var(--border-subtle, #e5e7eb);
		border-radius: 999px;
		background: var(--bg-surface, #ffffff);
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-secondary, #4b5563);
		cursor: pointer;
	}

	.prp__chip:hover {
		background: #f9fafb;
	}

	/* ─── Lista de módulos ─────────────────────────────────────────────── */
	.prp__lista {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 22rem;
		overflow-y: auto;
		padding-right: 0.25rem;
	}

	.prp__fila {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border: 1px solid transparent;
		border-radius: 0.75rem;
		background: var(--bg-base, #fafaf9);
	}

	.prp__fila--activa {
		border-color: #bbf7d0;
		background: #f0fdf4;
	}

	.prp__info {
		display: flex;
		min-width: 11rem;
		flex: 1 1 14rem;
		flex-direction: column;
	}

	.prp__label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, #0f172a);
	}

	.prp__base {
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-secondary, #4b5563);
	}

	.prp__desc {
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-muted, #6b7280);
	}

	.prp__niveles {
		display: inline-flex;
		flex-shrink: 0;
		gap: 2px;
		padding: 2px;
		border-radius: 999px;
		background: #ffffff;
		border: 1px solid var(--border-subtle, #e5e7eb);
	}

	.prp__nivel {
		padding: 0.25rem 0.625rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-muted, #6b7280);
		cursor: pointer;
		white-space: nowrap;
	}

	.prp__nivel:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.prp__nivel:hover {
		background: #f3f4f6;
	}

	.prp__nivel--sel {
		background: #e5e7eb;
		color: #111827;
	}

	.prp__nivel--read.prp__nivel--sel {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.prp__nivel--limited.prp__nivel--sel {
		background: #fef3c7;
		color: #92400e;
	}

	.prp__nivel--full.prp__nivel--sel {
		background: #166534;
		color: #ffffff;
	}

	/* ─── Resumen ──────────────────────────────────────────────────────── */
	.prp__resumen {
		padding: 0.75rem;
		border: 1px dashed var(--border-subtle, #e5e7eb);
		border-radius: 0.875rem;
		background: var(--bg-base, #fafaf9);
	}

	.prp__resumen-titulo {
		display: block;
		margin-bottom: 0.5rem;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted, #6b7280);
	}

	.prp__resumen-lista {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.prp__resumen-item {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.2rem 0.5rem 0.2rem 0.625rem;
		border-radius: 999px;
		background: #ffffff;
		border: 1px solid var(--border-subtle, #e5e7eb);
		font-size: 0.75rem;
	}

	.prp__resumen-modulo {
		color: var(--text-secondary, #4b5563);
	}

	.prp__pill {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.prp__pill--read {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.prp__pill--limited {
		background: #fef3c7;
		color: #92400e;
	}

	.prp__pill--full {
		background: #dcfce7;
		color: #166534;
	}

	.prp__vacio {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-very-muted, #9ca3af);
	}
</style>
