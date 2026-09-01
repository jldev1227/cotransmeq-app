<!--
	UniverActionOverlay — velo de "esto está trabajando" para las acciones del
	carril lateral (`UniverSideRail`).

	POR QUÉ EXISTE: el carril indicaba la espera con un spinner DENTRO del
	botón de 40×40. En una pantalla de hoja de cálculo, con la vista puesta en
	las celdas y el botón en el borde derecho, ese spinner no se ve: el usuario
	pulsa "Sincronizar con nómina", no percibe respuesta, y vuelve a pulsar o
	da por hecho que no pasó nada. Sincronizar tarda varios segundos —una
	consulta de nómina, el guardado de conceptos, el recálculo de impuestos y
	el remonte del libro—, así que el hueco es largo.

	El velo tapa el canvas Y el carril, que es justo lo que hay que impedir:
	las acciones del carril se pisan entre ellas (todas terminan releyendo y
	remontando el mismo cierre) y el canvas no debe editarse mientras el
	servidor está reescribiendo sus filas.

	NO sustituye al overlay de `UniverCanvasHost`: aquel cubre la CARGA del
	libro (no hay nada que enseñar todavía); este cubre una ACCIÓN sobre un
	libro que ya está montado y visible detrás.

	Uso:
	  <UniverActionOverlay accion={accionEnCurso} />
	  … donde `accionEnCurso` es `{ titulo, detalle? } | null`.
-->
<script lang="ts" module>
	export interface AccionEnCurso {
		/// Qué se está haciendo, en gerundio: "Sincronizando con nómina".
		titulo: string;
		/// Sobre qué, y cualquier aviso de duración. Opcional.
		detalle?: string;
	}
</script>

<script lang="ts">
	interface Props {
		accion: AccionEnCurso | null;
	}

	let { accion }: Props = $props();
</script>

{#if accion}
	<!-- `aria-live` y no `role="dialog"`: no hay nada que enfocar ni que
	     cerrar, solo un estado que anunciar a quien use lector de pantalla. -->
	<div class="uao" role="status" aria-live="polite">
		<div class="uao-card">
			<div class="uao-spinner"></div>
			<div class="uao-texto">
				<strong>{accion.titulo}</strong>
				{#if accion.detalle}
					<span>{accion.detalle}</span>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.uao {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		/* Por encima del carril (z-index 20) para que sus botones tampoco se
		   puedan pulsar mientras la acción corre. */
		z-index: 30;
		background: rgba(248, 250, 252, 0.72);
		backdrop-filter: blur(3px);
		/* Traga los clics: es la mitad del propósito del velo. */
		pointer-events: auto;
		cursor: progress;
	}

	.uao-card {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 18px 24px;
		border-radius: 12px;
		background: #1e2429;
		color: #fff;
		box-shadow: 0 18px 44px rgba(15, 23, 42, 0.32);
		max-width: min(460px, calc(100% - 48px));
	}

	.uao-texto {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.uao-texto strong {
		font-size: 13.5px;
		font-weight: 600;
		letter-spacing: 0.01em;
	}
	.uao-texto span {
		font-size: 12px;
		line-height: 1.45;
		color: rgba(255, 255, 255, 0.62);
	}

	.uao-spinner {
		flex: none;
		width: 26px;
		height: 26px;
		border: 3px solid rgba(255, 255, 255, 0.18);
		border-top-color: #10b981;
		border-radius: 50%;
		animation: uao-spin 0.7s linear infinite;
	}

	@keyframes uao-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Quien pida menos movimiento ve un pulso en lugar de un giro: el velo
	   sigue leyéndose como "espera" sin animación rotatoria. */
	@media (prefers-reduced-motion: reduce) {
		.uao-spinner {
			animation: uao-pulso 1.4s ease-in-out infinite;
			border-top-color: rgba(255, 255, 255, 0.18);
			background: #10b981;
		}
		@keyframes uao-pulso {
			0%,
			100% {
				opacity: 0.35;
			}
			50% {
				opacity: 1;
			}
		}
	}
</style>
