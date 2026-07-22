<script lang="ts">
	import { onMount } from 'svelte';

	// =============================================
	// TIPOS
	// =============================================
	type TipoLabor = 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO';

	interface RegistroDia {
		fecha: string;
		tipo: TipoLabor;
		horaInicio?: string;
		horaFin?: string;
		horasConducidas?: number;
		observaciones?: string;
	}

	interface SessionToken {
		cedula: string;
		createdAt: number;
		expiresAt: number;
	}

	// =============================================
	// CONSTANTES
	// =============================================
	const TOKEN_KEY    = 'cotransmeq_conductor_token';
	const REGISTROS_KEY = (c: string) => `cotransmeq_registros_${c}`;
	const THEME_KEY    = 'cotransmeq_theme';
	const TOKEN_DAYS   = 30;

	// ← REEMPLAZA ESTA RUTA CON LA DE TU LOGO
	const LOGO_SRC = '/assets/logo_nombre.png';

	const TIPOS: { value: TipoLabor; label: string; colorDark: string; colorLight: string; icon: string }[] = [
		{ value: 'LABORADO',      label: 'Día Laborado',  colorDark: '#ea580c', colorLight: '#047857', icon: '🚛' },
		{ value: 'DISPONIBLE',    label: 'Disponible',    colorDark: '#2563eb', colorLight: '#1d4ed8', icon: '✅' },
		{ value: 'DESCANSO',      label: 'Descanso',      colorDark: '#d97706', colorLight: '#b45309', icon: '🌙' },
		{ value: 'MANTENIMIENTO', label: 'Mantenimiento', colorDark: '#dc2626', colorLight: '#b91c1c', icon: '🔧' }
	];

	const DIAS_SEMANA = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
	const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
	               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

	// =============================================
	// TEMA
	// =============================================
	let dark = false;   // default: light mode

	function toggleTheme() {
		dark = !dark;
		localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
	}

	// =============================================
	// ESTADO AUTH
	// =============================================
	let session: SessionToken | null = null;
	let cedulaInput = '';
	let cedulaError = '';
	let loadingAuth = false;

	// =============================================
	// ESTADO CALENDARIO
	// =============================================
	const hoy = new Date();
	let mesActual  = hoy.getMonth();
	let anioActual = hoy.getFullYear();
	let registros: Record<string, RegistroDia> = {};

	// =============================================
	// ESTADO MODAL
	// =============================================
	let modalAbierto = false;
	let fechaSeleccionada = '';
	let form: Partial<RegistroDia> = {};
	let guardando  = false;
	let guardadoOk = false;
	let formError  = '';

	// =============================================
	// MOUNT
	// =============================================
	onMount(() => {
		// Restaurar tema
		const saved = localStorage.getItem(THEME_KEY);
		dark = saved === 'dark';   // light por defecto

		// Restaurar sesión
		const raw = localStorage.getItem(TOKEN_KEY);
		if (raw) {
			try {
				const tok: SessionToken = JSON.parse(raw);
				if (tok.expiresAt > Date.now()) { session = tok; cargarRegistros(); }
				else localStorage.removeItem(TOKEN_KEY);
			} catch { localStorage.removeItem(TOKEN_KEY); }
		}
	});

	// =============================================
	// AUTH
	// =============================================
	function validarCedula(v: string) {
		if (!v.trim()) return 'Ingresa tu número de cédula';
		if (!/^\d{5,12}$/.test(v.trim())) return 'La cédula debe tener entre 5 y 12 dígitos';
		return '';
	}

	async function iniciarSesion() {
		cedulaError = validarCedula(cedulaInput);
		if (cedulaError) return;
		loadingAuth = true;
		await new Promise(r => setTimeout(r, 500));
		const now = Date.now();
		const tok: SessionToken = {
			cedula: cedulaInput.trim(),
			createdAt: now,
			expiresAt: now + TOKEN_DAYS * 86400000
		};
		localStorage.setItem(TOKEN_KEY, JSON.stringify(tok));
		session = tok;
		cargarRegistros();
		loadingAuth = false;
	}

	function cerrarSesion() {
		localStorage.removeItem(TOKEN_KEY);
		session = null; cedulaInput = ''; registros = {};
	}

	// =============================================
	// REGISTROS
	// =============================================
	function cargarRegistros() {
		if (!session) return;
		try { registros = JSON.parse(localStorage.getItem(REGISTROS_KEY(session.cedula)) || '{}'); }
		catch { registros = {}; }
	}
	function guardarRegistros() {
		if (!session) return;
		localStorage.setItem(REGISTROS_KEY(session.cedula), JSON.stringify(registros));
	}

	// =============================================
	// CALENDARIO
	// =============================================
	$: diasDelMes = (() => {
		const primer = new Date(anioActual, mesActual, 1).getDay();
		const total  = new Date(anioActual, mesActual + 1, 0).getDate();
		const dias: (number | null)[] = Array(primer).fill(null);
		for (let i = 1; i <= total; i++) dias.push(i);
		while (dias.length % 7 !== 0) dias.push(null);
		return dias;
	})();

	function mesAnterior()  { if (mesActual === 0)  { mesActual = 11; anioActual--; } else mesActual--; }
	function mesSiguiente() { if (mesActual === 11) { mesActual = 0;  anioActual++; } else mesActual++; }

	function fechaStr(dia: number) {
		return `${anioActual}-${String(mesActual+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
	}
	function esFuturo(dia: number) {
		const f = new Date(anioActual, mesActual, dia); f.setHours(0,0,0,0);
		const h = new Date(); h.setHours(0,0,0,0);
		return f > h;
	}
	function esHoy(dia: number) {
		return fechaStr(dia) === `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
	}
	function getTipo(dia: number) {
		const r = registros[fechaStr(dia)];
		return r ? TIPOS.find(t => t.value === r.tipo) : null;
	}
	function tipoColor(t: typeof TIPOS[0]) { return dark ? t.colorDark : t.colorLight; }

	function abrirDia(dia: number) {
		if (esFuturo(dia)) return;
		fechaSeleccionada = fechaStr(dia);
		const reg = registros[fechaSeleccionada];
		form = reg ? { ...reg } : { fecha: fechaSeleccionada };
		guardadoOk = false; formError = ''; modalAbierto = true;
	}
	function cerrarModal() { modalAbierto = false; fechaSeleccionada = ''; form = {}; }

	// =============================================
	// FORMULARIO
	// =============================================
	$: horasCalculadas = (() => {
		if (!form.horaInicio || !form.horaFin) return null;
		const [h1,m1] = form.horaInicio.split(':').map(Number);
		const [h2,m2] = form.horaFin.split(':').map(Number);
		const mins = (h2*60+m2) - (h1*60+m1);
		return mins > 0 ? +(mins/60).toFixed(1) : null;
	})();

	async function guardarDia() {
		formError = '';
		if (!form.tipo) { formError = 'Selecciona el tipo de jornada'; return; }
		if (form.tipo === 'LABORADO') {
			if (!form.horaInicio)   { formError = 'Ingresa la hora de inicio'; return; }
			if (!form.horaFin)      { formError = 'Ingresa la hora de fin'; return; }
			if (!form.horasConducidas || Number(form.horasConducidas) <= 0) {
				formError = 'Ingresa las horas conducidas'; return;
			}
		}
		guardando = true;
		await new Promise(r => setTimeout(r, 350));
		registros[fechaSeleccionada] = {
			fecha: fechaSeleccionada, tipo: form.tipo!,
			...(form.tipo === 'LABORADO' ? {
				horaInicio: form.horaInicio, horaFin: form.horaFin,
				horasConducidas: Number(form.horasConducidas)
			} : {}),
			...(form.observaciones ? { observaciones: form.observaciones } : {})
		};
		registros = { ...registros };
		guardarRegistros();
		guardando = false; guardadoOk = true;
		await new Promise(r => setTimeout(r, 800));
		cerrarModal();
	}

	function eliminarRegistro() {
		delete registros[fechaSeleccionada];
		registros = { ...registros };
		guardarRegistros(); cerrarModal();
	}

	// =============================================
	// STATS
	// =============================================
	$: statsMes = (() => {
		const pre = `${anioActual}-${String(mesActual+1).padStart(2,'0')}`;
		const dm  = Object.values(registros).filter(r => r.fecha.startsWith(pre));
		return {
			laborados:    dm.filter(r => r.tipo === 'LABORADO').length,
			disponibles:  dm.filter(r => r.tipo === 'DISPONIBLE').length,
			descansos:    dm.filter(r => r.tipo === 'DESCANSO').length,
			mantenimiento:dm.filter(r => r.tipo === 'MANTENIMIENTO').length,
			horasTotales: dm.reduce((s,r) => s + (r.horasConducidas||0), 0)
		};
	})();

	$: fechaLegible = (() => {
		if (!fechaSeleccionada) return '';
		const [y,m,d] = fechaSeleccionada.split('-').map(Number);
		return new Date(y, m-1, d).toLocaleDateString('es-CO',
			{ weekday:'long', day:'numeric', month:'long', year:'numeric' });
	})();

	$: diasSesion = session ? Math.ceil((session.expiresAt - Date.now()) / 86400000) : 0;

	function handleKey(e: KeyboardEvent) { if (e.key === 'Enter') iniciarSesion(); }
</script>

<svelte:head>
	<title>Reporte Diario · Conductor</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
</svelte:head>

<div class="page" class:dark>

<!-- ════════════════════════════════════════ -->
<!-- AUTH                                     -->
<!-- ════════════════════════════════════════ -->
{#if !session}
<div class="auth-wrap">
	<!-- Theme toggle flotante -->
	<button class="theme-fab" on:click={toggleTheme} title="Cambiar tema" aria-label="Cambiar tema">
		{#if dark}☀️{:else}🌙{/if}
	</button>

	<div class="auth-card">
		<!-- Logo empresa -->
		<div class="auth-logo-wrap">
			<img src={LOGO_SRC} alt="Logo empresa" class="auth-logo-img"
				on:error={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
		</div>

		<h1 class="auth-title">Reporte<br/>Diario</h1>
		<p class="auth-sub">Ingresa tu número de cédula para registrar tu actividad diaria.</p>

		<label for="cedula" class="input-label">Número de cédula</label>
		<input
			id="cedula" type="tel" inputmode="numeric"
			class="cedula-input" class:input-error={cedulaError}
			bind:value={cedulaInput}
			on:keydown={handleKey}
			placeholder="· · · · · · · ·"
			maxlength="12" autocomplete="off"
		/>
		{#if cedulaError}
			<p class="error-msg">⚠ {cedulaError}</p>
		{/if}

		<button class="btn-primary" on:click={iniciarSesion} disabled={loadingAuth}>
			{#if loadingAuth}
				<span class="spinner"></span> Verificando...
			{:else}
				Ingresar al sistema →
			{/if}
		</button>

		<div class="auth-note">
			🔒 Sesión activa por <strong style="color:#ea580c">{TOKEN_DAYS} días</strong> en este dispositivo
		</div>
	</div>
</div>

<!-- ════════════════════════════════════════ -->
<!-- APP                                      -->
<!-- ════════════════════════════════════════ -->
{:else}
<div class="app">

	<!-- Topbar -->
	<header class="topbar">
		<!-- Logo -->
		<div class="topbar-logo-wrap">
			<img src={LOGO_SRC} alt="Logo empresa" class="topbar-logo"
				on:error={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
		</div>

		<!-- Conductor info + acciones -->
		<div class="topbar-right">
			<!-- Toggle tema -->
			<button
				class="theme-toggle"
				on:click={toggleTheme}
				aria-label="Cambiar tema"
				title={dark ? 'Modo claro' : 'Modo oscuro'}
			>
				<span class="toggle-track" class:on={dark}>
					<span class="toggle-thumb">
						<span class="toggle-icon">{dark ? '🌙' : '☀️'}</span>
					</span>
				</span>
				<span class="toggle-label">{dark ? 'Oscuro' : 'Claro'}</span>
			</button>

			<!-- Avatar + cédula -->
			<div class="conductor-chip">
				<div class="conductor-avatar">{session.cedula.slice(-2)}</div>
				<div class="conductor-info">
					<span class="conductor-cedula">{session.cedula}</span>
					<span class="conductor-sesion">{diasSesion}d restantes</span>
				</div>
			</div>

			<button class="btn-salir" on:click={cerrarSesion}>Salir</button>
		</div>
	</header>

	<!-- Stats -->
	<div class="stats-row">
		<div class="stat-card" style="--accent:#ea580c">
			<div class="stat-val">{statsMes.laborados}</div>
			<div class="stat-label">Laborados</div>
		</div>
		<div class="stat-card" style="--accent:#2563eb">
			<div class="stat-val">{statsMes.disponibles}</div>
			<div class="stat-label">Disponible</div>
		</div>
		<div class="stat-card" style="--accent:#d97706">
			<div class="stat-val">{statsMes.descansos}</div>
			<div class="stat-label">Descanso</div>
		</div>
		<div class="stat-card" style="--accent:#dc2626">
			<div class="stat-val">{statsMes.mantenimiento}</div>
			<div class="stat-label">Mant.</div>
		</div>
		<div class="stat-card" style="--accent:#f97316">
			<div class="stat-val">{statsMes.horasTotales}h</div>
			<div class="stat-label">Horas</div>
		</div>
	</div>

	<!-- Calendario -->
	<div class="cal-card">
		<div class="cal-header">
			<button class="btn-nav" on:click={mesAnterior}>‹</button>
			<div style="text-align:center">
				<div class="cal-mes">{MESES[mesActual]}</div>
				<div class="cal-anio">{anioActual}</div>
			</div>
			<button class="btn-nav" on:click={mesSiguiente}>›</button>
		</div>

		<div class="cal-dias-nombre">
			{#each DIAS_SEMANA as d}
				<div class="dia-nombre">{d}</div>
			{/each}
		</div>

		<div class="cal-grid">
			{#each diasDelMes as dia}
				{#if dia === null}
					<div class="dia-celda vacio"></div>
				{:else}
					{@const tipo = getTipo(dia)}
					{@const futuro = esFuturo(dia)}
					{@const hoyFlag = esHoy(dia)}
					<div
						class="dia-celda"
						class:registrado={!!tipo}
						class:futuro
						class:hoy-celda={hoyFlag}
						style={tipo ? `--tcolor:${tipoColor(tipo)};` : ''}
						on:click={() => abrirDia(dia)}
						on:keydown={(e) => e.key==='Enter' && abrirDia(dia)}
						role="button" tabindex={futuro ? -1 : 0}
						aria-label="Día {dia}"
					>
						<span class="dia-num">{dia}</span>
						{#if tipo}<span class="dia-icon">{tipo.icon}</span>{/if}
					</div>
				{/if}
			{/each}
		</div>

		<div class="leyenda">
			{#each TIPOS as t}
				<div class="ley-item">
					<div class="ley-dot" style="background:{tipoColor(t)}"></div>
					{t.icon} {t.label}
				</div>
			{/each}
		</div>
	</div>

	<div class="hint-bottom">📅 Toca cualquier día pasado para registrar tu actividad</div>
</div>

<!-- ════════════════════════════════════════ -->
<!-- MODAL                                    -->
<!-- ════════════════════════════════════════ -->
{#if modalAbierto}
<div
	class="modal-overlay"
	on:click|self={cerrarModal}
	on:keydown={(e) => e.key==='Escape' && cerrarModal()}
	role="dialog" aria-modal="true" tabindex="-1"
>
	<div class="modal">
		<!-- Header modal -->
		<div class="modal-header">
			<div>
				<div class="modal-fecha">{fechaLegible}</div>
				<div class="modal-fecha-sub">{fechaSeleccionada}</div>
			</div>
			<button class="btn-cerrar" on:click={cerrarModal}>✕</button>
		</div>

		<!-- Body -->
		<div class="modal-body">
			<p class="section-label">Tipo de jornada</p>
			<div class="tipo-grid">
				{#each TIPOS as t}
					<button
						class="tipo-btn"
						class:selected={form.tipo === t.value}
						style={form.tipo === t.value ? `--tcolor:${tipoColor(t)}` : ''}
						on:click={() => { form.tipo = t.value; formError = ''; }}
					>
						<span class="tipo-icon">{t.icon}</span>
						<span class="tipo-label">{t.label}</span>
					</button>
				{/each}
			</div>

			{#if form.tipo === 'LABORADO'}
				<div class="form-section">
					<div class="form-section-title">🕐 Horas del turno</div>
					<div class="field-row">
						<div class="field">
							<label class="field-label" for="h-inicio">Hora inicio</label>
							<input id="h-inicio" type="time" class="field-input" bind:value={form.horaInicio} />
						</div>
						<div class="field">
							<label class="field-label" for="h-fin">Hora fin</label>
							<input id="h-fin" type="time" class="field-input" bind:value={form.horaFin} />
						</div>
					</div>
					{#if horasCalculadas !== null}
						<p class="field-hint">⏱ Duración calculada: <strong>{horasCalculadas} h</strong></p>
					{/if}
					<div class="field" style="margin-top:.75rem">
						<label class="field-label" for="h-cond">Horas conducidas</label>
						<input id="h-cond" type="number" min="0" max="24" step="0.5"
							class="field-input" bind:value={form.horasConducidas} placeholder="Ej: 6.5" />
					</div>
				</div>
			{/if}

			{#if form.tipo}
				<div class="field" style="margin-top:.5rem">
					<label class="field-label" for="obs">
						Observaciones <span class="optional">(opcional)</span>
					</label>
					<textarea id="obs" class="field-input field-textarea"
						bind:value={form.observaciones}
						placeholder="Agrega notas si es necesario..."
						rows="2"
					></textarea>
				</div>
			{/if}

			{#if formError}
				<div class="form-error">⚠ {formError}</div>
			{/if}
		</div>

		<!-- Footer modal -->
		<div class="modal-actions">
			{#if registros[fechaSeleccionada]}
				<button class="btn-eliminar" on:click={eliminarRegistro} title="Eliminar registro">🗑</button>
			{/if}
			<button
				class="btn-guardar" class:ok={guardadoOk}
				on:click={guardarDia}
				disabled={guardando || !form.tipo}
			>
				{#if guardando}
					<span class="spinner spinner-dark"></span> Guardando...
				{:else if guardadoOk}
					✓ Guardado
				{:else}
					Guardar registro
				{/if}
			</button>
		</div>
	</div>
</div>
{/if}

{/if}
</div>

<style>
/* ─────────────────────────────────────────────
   CSS VARIABLES — light (default) & dark
───────────────────────────────────────────── */
.page {
	--bg:        #f1f5f9;
	--surface:   #ffffff;
	--surface2:  #f8fafc;
	--border:    #e2e8f0;
	--border2:   #cbd5e1;
	--text:      #0f172a;
	--text2:     #475569;
	--text3:     #94a3b8;
	--accent:    #099d73;
	--accent-s:  #047857;
	--input-bg:  #f8fafc;
	--shadow:    0 2px 12px #0000000d;
	--shadow-lg: 0 8px 32px #0000001a;

	font-family: 'Barlow', sans-serif;
	min-height: 100vh;
	background: var(--bg);
	color: var(--text);
	transition: background .25s, color .25s;
}
.page.dark {
	--bg:        #0f172a;
	--surface:   #1e293b;
	--surface2:  #0f172a;
	--border:    #334155;
	--border2:   #475569;
	--text:      #f1f5f9;
	--text2:     #94a3b8;
	--text3:     #64748b;
	--input-bg:  #0f172a;
	--shadow:    0 2px 12px #00000033;
	--shadow-lg: 0 8px 40px #00000055;
}

:global(body) { margin: 0; }
* { box-sizing: border-box; }

/* ─── AUTH ─────────────────────────────────── */
.auth-wrap {
	min-height: 100vh;
	display: flex; align-items: center; justify-content: center;
	padding: 2rem 1rem;
	position: relative;
	background:
		radial-gradient(ellipse 80% 50% at 50% -10%, #f9731618 0%, transparent 60%),
		var(--bg);
}
.theme-fab {
	position: absolute; top: 1.2rem; right: 1.2rem;
	width: 40px; height: 40px;
	background: var(--surface); border: 1px solid var(--border);
	border-radius: 50%; font-size: 1.1rem;
	cursor: pointer; display: flex; align-items: center; justify-content: center;
	box-shadow: var(--shadow);
	transition: transform .15s, box-shadow .2s;
}
.theme-fab:hover { transform: scale(1.1); box-shadow: var(--shadow-lg); }

.auth-card {
	width: 100%; max-width: 420px;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 20px;
	padding: 2.5rem 2rem;
	box-shadow: var(--shadow-lg), 0 0 0 1px #f9731610;
	animation: fadeUp .4s ease;
}

/* Logo en auth */
.auth-logo-wrap {
	display: flex; align-items: center; gap: .75rem;
	margin-bottom: 2rem; min-height: 44px;
}
.auth-logo-img {
	max-height: 44px; max-width: 160px;
	object-fit: contain; display: block;
    margin: auto;
}

.auth-title {
	font-family: 'Barlow Condensed', sans-serif;
	font-size: 2.5rem; font-weight: 800;
	line-height: 1.05; color: var(--text);
	margin: 0 0 .5rem; text-transform: uppercase;
    text-align: center;
}
.auth-sub {
	color: var(--text2); font-size: .9rem;
	margin: 0 0 2rem; line-height: 1.5;
}
.input-label {
	display: block; font-size: .72rem; font-weight: 700;
	letter-spacing: .08em; text-transform: uppercase;
	color: var(--text3); margin-bottom: .5rem;
}
.cedula-input {
	width: 100%;
	background: var(--input-bg);
	border: 1.5px solid var(--border2);
	border-radius: 12px; padding: .85rem 1rem;
	font-family: 'JetBrains Mono', monospace;
	font-size: 1.3rem; font-weight: 500;
	color: var(--text); letter-spacing: .12em;
	transition: border-color .2s, box-shadow .2s; outline: none;
}
.cedula-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px #ea580c44; }
.input-error { border-color: #047857 !important; }
.error-msg { color: #047857; font-size: .8rem; margin-top: .4rem; display: flex; align-items: center; gap: .3rem; }

.btn-primary {
	width: 100%; margin-top: 1.2rem; padding: .9rem;
	background: linear-gradient(135deg, #099d73, #047857);
	border: none; border-radius: 12px;
	font-family: 'Barlow Condensed', sans-serif;
	font-size: 1.1rem; font-weight: 700;
	letter-spacing: .06em; text-transform: uppercase; color: #fff;
	cursor: pointer; box-shadow: 0 4px 20px #ea580c30;
	transition: opacity .2s, transform .15s, box-shadow .2s;
	display: flex; align-items: center; justify-content: center; gap: .5rem;
}
.btn-primary:hover:not(:disabled) { opacity: .9; transform: translateY(-1px); box-shadow: 0 8px 28px #ea580c44; }
.btn-primary:disabled { opacity: .55; cursor: not-allowed; }

.auth-note {
	margin-top: 1.4rem; padding: .9rem;
	background: var(--surface2); border-radius: 10px;
	font-size: .78rem; color: var(--text3); line-height: 1.5; text-align: center;
	border: 1px solid var(--border);
}

/* ─── SPINNER ──────────────────────────────── */
.spinner {
	width: 17px; height: 17px;
	border: 2px solid #ffffff55; border-top-color: #fff;
	border-radius: 50%; animation: spin .6s linear infinite; flex-shrink: 0;
}
.spinner-dark { border-color: var(--border); border-top-color: var(--text); }

/* ─── APP ──────────────────────────────────── */
.app {
	max-width: 680px; margin: 0 auto; padding: 1rem; min-height: 100vh;
}

/* ─── TOPBAR ───────────────────────────────── */
.topbar {
	display: flex; align-items: center; justify-content: space-between;
	gap: .75rem;
	padding: .65rem 1rem;
	background: var(--surface); border: 1px solid var(--border);
	border-radius: 16px; margin-bottom: 1rem;
	box-shadow: var(--shadow);
}

/* Logo en topbar */
.topbar-logo-wrap {
	display: flex; align-items: center; gap: .5rem; flex-shrink: 0;
}
.topbar-logo {
	max-height: 36px; max-width: 120px;
	object-fit: contain; display: block;
}

.topbar-right {
	display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; justify-content: flex-end;
}

/* ─── THEME TOGGLE ─────────────────────────── */
.theme-toggle {
	display: flex; align-items: center; gap: .5rem;
	background: none; border: none; cursor: pointer; padding: 0;
}
.toggle-track {
	width: 44px; height: 24px;
	background: var(--border2);
	border-radius: 999px;
	position: relative; flex-shrink: 0;
	transition: background .25s;
	display: block;
}
.toggle-track.on { background: #1e40af; }
.toggle-thumb {
	position: absolute; top: 2px; left: 2px;
	width: 20px; height: 20px;
	background: #fff; border-radius: 50%;
	box-shadow: 0 1px 4px #0000002a;
	transition: transform .25s cubic-bezier(.4,0,.2,1);
	display: flex; align-items: center; justify-content: center;
}
.toggle-track.on .toggle-thumb { transform: translateX(20px); }
.toggle-icon { font-size: .7rem; line-height: 1; }
.toggle-label {
	font-size: .7rem; font-weight: 600;
	letter-spacing: .04em; text-transform: uppercase;
	color: var(--text3); white-space: nowrap;
}

/* ─── CONDUCTOR CHIP ───────────────────────── */
.conductor-chip {
	display: flex; align-items: center; gap: .5rem;
}
.conductor-avatar {
	width: 32px; height: 32px;
	background: linear-gradient(135deg, #047857, #047857);
	border-radius: 50%; display: flex; align-items: center; justify-content: center;
	font-family: 'JetBrains Mono', monospace;
	font-size: .78rem; font-weight: 700; color: #fff; flex-shrink: 0;
}
.conductor-info { line-height: 1.2; }
.conductor-cedula {
	font-family: 'JetBrains Mono', monospace;
	font-size: .78rem; font-weight: 500; color: var(--text); display: block;
}
.conductor-sesion { font-size: .65rem; color: var(--text3); display: block; }

.btn-salir {
	background: var(--surface2); border: 1px solid var(--border);
	border-radius: 8px; padding: .32rem .65rem;
	font-size: .68rem; font-family: 'Barlow', sans-serif;
	font-weight: 700; color: var(--text3); cursor: pointer;
	transition: all .15s; text-transform: uppercase; letter-spacing: .04em; flex-shrink: 0;
}
.btn-salir:hover { border-color: #047857; color: #047857; }

/* ─── STATS ────────────────────────────────── */
.stats-row {
	display: grid; grid-template-columns: repeat(5,1fr); gap: .5rem; margin-bottom: 1rem;
}
@media (max-width:500px) { .stats-row { grid-template-columns: repeat(3,1fr); } }
.stat-card {
	background: var(--surface); border: 1px solid var(--border);
	border-top: 3px solid var(--accent);
	border-radius: 12px; padding: .65rem .5rem; text-align: center;
	box-shadow: var(--shadow);
}
.stat-val {
	font-family: 'Barlow Condensed', sans-serif;
	font-size: 1.5rem; font-weight: 800; line-height: 1; color: var(--text);
}
.stat-label {
	font-size: .6rem; font-weight: 700;
	letter-spacing: .05em; text-transform: uppercase; color: var(--text3); margin-top: .2rem;
}

/* ─── CALENDARIO ───────────────────────────── */
.cal-card {
	background: var(--surface); border: 1px solid var(--border);
	border-radius: 16px; overflow: hidden; box-shadow: var(--shadow);
}
.cal-header {
	display: flex; align-items: center; justify-content: space-between;
	padding: 1rem 1.2rem; border-bottom: 1px solid var(--border);
}
.cal-mes {
	font-family: 'Barlow Condensed', sans-serif;
	font-size: 1.35rem; font-weight: 800; text-transform: uppercase;
	letter-spacing: .04em; color: var(--text);
}
.cal-anio {
	font-family: 'JetBrains Mono', monospace;
	font-size: .8rem; color: var(--accent); font-weight: 500;
}
.btn-nav {
	width: 34px; height: 34px;
	background: var(--surface2); border: 1px solid var(--border);
	border-radius: 8px; color: var(--text2); cursor: pointer;
	font-size: 1.1rem; display: flex; align-items: center; justify-content: center;
	transition: all .15s;
}
.btn-nav:hover { border-color: var(--accent); color: var(--accent); }

.cal-dias-nombre {
	display: grid; grid-template-columns: repeat(7,1fr);
	padding: .5rem .6rem 0;
}
.dia-nombre {
	text-align: center; font-size: .62rem; font-weight: 700;
	letter-spacing: .06em; text-transform: uppercase; color: var(--text3); padding: .3rem 0;
}
.cal-grid {
	display: grid; grid-template-columns: repeat(7,1fr);
	gap: 3px; padding: .5rem .6rem .8rem;
}

.dia-celda {
	aspect-ratio: 1; border-radius: 8px;
	display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
	cursor: pointer; position: relative;
	border: 1.5px solid transparent;
	transition: background .15s, transform .1s, border-color .15s;
}
.dia-celda:hover:not(.vacio):not(.futuro) {
	background: var(--surface2); transform: scale(1.07);
}
.dia-celda.vacio { cursor: default; pointer-events: none; }
.dia-celda.futuro { opacity: .3; cursor: not-allowed; }
.dia-celda.hoy-celda { border-color: var(--accent) !important; }
.dia-celda.registrado {
	background: color-mix(in srgb, var(--tcolor) 12%, var(--surface));
	border-color: color-mix(in srgb, var(--tcolor) 35%, transparent);
}
.page:not(.dark) .dia-celda.registrado {
	background: color-mix(in srgb, var(--tcolor) 10%, #fff);
	border-color: color-mix(in srgb, var(--tcolor) 30%, transparent);
}
.dia-num {
	font-family: 'Barlow', sans-serif;
	font-size: .75rem; font-weight: 600; color: var(--text2); line-height: 1;
}
.dia-celda.hoy-celda .dia-num { color: var(--accent); font-weight: 800; }
.dia-celda.registrado .dia-num { color: var(--text); }
.dia-icon { font-size: .65rem; line-height: 1; }

/* ─── LEYENDA ──────────────────────────────── */
.leyenda {
	display: flex; flex-wrap: wrap; gap: .4rem .8rem;
	padding: .6rem 1.2rem .8rem; border-top: 1px solid var(--border);
}
.ley-item {
	display: flex; align-items: center; gap: .35rem;
	font-size: .66rem; font-weight: 600;
	letter-spacing: .04em; text-transform: uppercase; color: var(--text3);
}
.ley-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

.hint-bottom {
	text-align: center; padding: .8rem;
	font-size: .72rem; color: var(--text3);
}

/* ─── MODAL ────────────────────────────────── */
.modal-overlay {
	position: fixed; inset: 0;
	background: linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(10, 20, 16, 0.6));
	backdrop-filter: blur(8px) saturate(120%);
	-webkit-backdrop-filter: blur(8px) saturate(120%);
	z-index: 200; display: flex; align-items: flex-end; justify-content: center;
	animation: fadeIn .2s ease;
}
@media (min-width:600px) { .modal-overlay { align-items: center; padding: 1rem; } }

.modal {
	width: 100%; max-width: 520px;
	background: var(--surface); border: 1px solid var(--border);
	border-radius: 24px 24px 0 0;
	max-height: 92vh; display: flex; flex-direction: column;
	box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
	animation: slideUp .4s cubic-bezier(.25,.46,.45,.94);
}
@media (min-width:600px) { .modal { border-radius: 24px; max-height: 88vh; animation: fadeUp .22s ease; } }

.modal-header {
	padding: 1.25rem 1.5rem 1.1rem; border-bottom: 1px solid var(--border);
	display: flex; align-items: flex-start; justify-content: space-between; flex-shrink: 0;
	background: linear-gradient(180deg, var(--surface) 0%, var(--surface2) 100%);
}
.modal-fecha {
	font-family: 'Geist', 'Inter', system-ui, sans-serif;
	font-size: 1.25rem; font-weight: 700; text-transform: uppercase;
	letter-spacing: -0.01em; color: var(--text); line-height: 1.1;
}
.modal-fecha-sub {
	font-size: .73rem; color: var(--text3); margin-top: .2rem;
	font-family: 'Geist', 'Inter', system-ui, sans-serif;
	font-weight: 600;
	letter-spacing: 0.1em;
}
.btn-cerrar {
	background: var(--surface2); border: 1px solid var(--border);
	border-radius: 10px; width: 32px; height: 32px; color: var(--text3);
	cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center;
	transition: all .2s var(--ease-apple, cubic-bezier(0.25, 0.46, 0.45, 0.94)); flex-shrink: 0;
}
.btn-cerrar:hover {
	background: rgba(249, 115, 22, 0.06);
	border-color: rgba(249, 115, 22, 0.3);
	color: #ea580c;
	transform: rotate(90deg);
}

.modal-body { padding: 1.25rem 1.5rem; overflow-y: auto; flex: 1; }

/* ─── TIPO SELECTOR ─────────────────────────── */
.section-label {
	font-size: .7rem; font-weight: 700;
	letter-spacing: .07em; text-transform: uppercase;
	color: var(--text3); margin: 0 0 .6rem;
}
.tipo-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: .6rem; margin-bottom: 1.2rem; }
.tipo-btn {
	background: var(--surface2); border: 2px solid var(--border);
	border-radius: 12px; padding: .8rem .6rem; cursor: pointer;
	text-align: center; transition: all .15s;
	display: flex; flex-direction: column; align-items: center; gap: .3rem;
}
.tipo-btn:hover { border-color: var(--border2); transform: translateY(-1px); }
.tipo-btn.selected {
	border-color: var(--tcolor) !important;
	background: color-mix(in srgb, var(--tcolor) 10%, var(--surface));
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--tcolor) 20%, transparent);
}
.tipo-icon { font-size: 1.4rem; line-height: 1; }
.tipo-label {
	font-size: .7rem; font-weight: 700;
	letter-spacing: .04em; text-transform: uppercase; color: var(--text2); line-height: 1.2;
}
.tipo-btn.selected .tipo-label { color: var(--text); }

/* ─── FORM FIELDS ───────────────────────────── */
.form-section {
	background: var(--surface2); border: 1px solid var(--border);
	border-radius: 12px; padding: 1rem; margin-bottom: 1rem; animation: fadeIn .2s ease;
}
.form-section-title {
	font-size: .7rem; font-weight: 700;
	letter-spacing: .07em; text-transform: uppercase; color: var(--accent); margin-bottom: .8rem;
}
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin-bottom: .75rem; }
.field { display: flex; flex-direction: column; gap: .35rem; }
.field-label {
	font-size: .68rem; font-weight: 700;
	letter-spacing: .06em; text-transform: uppercase; color: var(--text3);
}
.optional { text-transform: none; font-weight: 400; color: var(--text3); }
.field-input {
	background: var(--input-bg); border: 1.5px solid var(--border2);
	border-radius: 10px; padding: .62rem .75rem;
	font-family: 'JetBrains Mono', monospace; font-size: .88rem;
	color: var(--text); transition: border-color .2s, box-shadow .2s; outline: none; width: 100%;
}
.field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px #f9731618; }
.field-textarea { font-family: 'Barlow', sans-serif; font-size: .85rem; resize: vertical; min-height: 64px; }
.field-hint {
	font-size: .7rem; color: #2563eb; font-weight: 600; margin-top: .2rem;
}
.page.dark .field-hint { color: #60a5fa; }

.form-error {
	background: #fef2f2; border: 1px solid #fca5a5; border-radius: 10px;
	padding: .65rem .9rem; font-size: .8rem; color: #b91c1c;
	margin-bottom: 1rem; display: flex; align-items: center; gap: .5rem;
}
.page.dark .form-error {
	background: #450a0a; border-color: #047857; color: #fca5a5;
}

/* ─── MODAL FOOTER ──────────────────────────── */
.modal-actions {
	display: flex; gap: .6rem; padding: 1rem 1.5rem 1.4rem;
	flex-shrink: 0; border-top: 1px solid var(--border);
	background: var(--surface2);
}
.btn-guardar {
	flex: 1; padding: .85rem;
	background: linear-gradient(135deg, #f97316, #ea580c);
	border: none; border-radius: 12px;
	font-family: 'Geist', 'Inter', system-ui, sans-serif;
	font-size: .95rem; font-weight: 600; letter-spacing: .02em; text-transform: none; color: #fff;
	cursor: pointer; box-shadow: 0 4px 16px rgba(249, 115, 22, 0.3);
	transition: opacity .2s, transform .15s; display: flex; align-items: center; justify-content: center; gap: .5rem;
}
.btn-guardar:hover:not(:disabled) { opacity: .9; transform: translateY(-1px); }
.btn-guardar:disabled { opacity: .55; cursor: not-allowed; }
.btn-guardar.ok { background: linear-gradient(135deg, #ea580c, #047857); box-shadow: 0 4px 16px #ea580c30; }
.btn-eliminar {
	padding: .85rem 1rem; background: var(--surface2);
	border: 1px solid var(--border); border-radius: 12px;
	font-size: .85rem; color: var(--text3); cursor: pointer;
	transition: all .15s; display: flex; align-items: center; gap: .4rem;
}
.btn-eliminar:hover { border-color: #047857; color: #047857; }

/* ─── ANIMATIONS ─────────────────────────────── */
@keyframes fadeUp  { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
@keyframes slideUp { from { transform:translateY(100%); } to { transform:translateY(0); } }
@keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
@keyframes spin    { to { transform:rotate(360deg); } }
</style>