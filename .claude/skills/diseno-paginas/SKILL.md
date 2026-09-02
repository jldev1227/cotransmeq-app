---
name: diseno-paginas
description: Reglas de diseño para páginas del dashboard, del portal del conductor y de las vistas públicas. Úsala SIEMPRE antes de crear o maquetar un `+page.svelte` / `+layout.svelte`, al mover una pantalla a otra ruta, o cuando el trabajo mencione ancho, `max-width`, `max-w-*`, `mx-auto`, contenedor, columnas, rejilla o "se ve angosto / hay franjas a los lados".
---

# Diseño de páginas

## 1. El contenedor de página no lleva `max-width`

Un `+page.svelte` ocupa **todo** el ancho que le dé el `main` de su layout. Nada
de topes ni de `margin: 0 auto` en el envoltorio de la página.

```css
/* ✗ mal */
.pagina { padding: 1.5rem 1.25rem 3rem; max-width: 1400px; margin: 0 auto; }

/* ✓ bien */
.pagina { padding: 1.5rem 1.25rem 3rem; }
```

```svelte
<!-- ✗ mal -->
<div class="mx-auto max-w-7xl px-4 py-4">

<!-- ✓ bien -->
<div class="px-4 py-4">
```

Aplica igual a las tres zonas, y a **todas** las piezas de la cáscara de la
página, no solo al cuerpo: `.page-header-inner`, `.page-main`, `.page-body`,
`.page-footer-inner` se tratan igual.

| Zona | Quién acota el ancho |
|---|---|
| `dashboard/**` | el `<main>` de `dashboard/+layout.svelte`, junto a la barra lateral |
| `public/portal/**` | `.content` de `public/portal/+layout.svelte`, junto a su barra lateral de escritorio |
| públicas sueltas (`asistencia/[token]`, `public/documento/[token]`, `public/certificados/**`, `public/dias-laborados`) | el viewport |

**Por qué.** El layout ya acotó el área útil. Acotar otra vez dentro deja franjas
muertas a los lados en pantallas anchas, que es donde se trabaja el dashboard. Y
el coste no es estético: en una tabla de envíos o en un checklist de 130 ítems,
el ancho desperdiciado se paga en scroll. Un preoperacional a tres columnas cabe
en media pantalla; a una columna son ocho.

## 2. Para llenar ese ancho, rejillas fluidas — no puntos de ruptura

```css
grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
columns: 3 20rem;   /* listas largas que fluyen, como un checklist */
```

Una rejilla fluida se adapta sola al ancho real del `main`, que cambia cuando la
barra lateral se colapsa. Una cascada de `@media` hay que mantenerla a mano y se
desincroniza del layout.

## 3. Lo que sí conserva `max-width`

Acota **por legibilidad tipográfica o porque el elemento es una ventana**; nunca
«por si acaso» en un contenedor de página.

- **Modales y diálogos** (`26rem`, `28rem`, `34rem`, `max-w-2xl`, `max-w-3xl`):
  son ventanas centradas, no páginas.
- **Tarjetas de autenticación** (`AuthShell`, `.login-card`, `.auth-shell`): la
  pantalla es la tarjeta; no hay contenido que ensanchar.
- **Párrafos de texto corrido** (`44rem`): pasado ese ancho el ojo pierde el
  renglón. Aplica a notas, avisos y estados vacíos — no a datos ni a tablas.
- **Documentos de tamaño fijo**: una hoja A4 en pantalla mantiene su tamaño; es
  el papel, no la página.
- **Controles y celdas concretos** (`12rem` en un input, `160px` en una columna
  con `text-overflow: ellipsis`): son medidas del propio control.

## 4. Antes de dar la página por hecha

```bash
# En el archivo que tocaste: ninguna coincidencia debe ser el envoltorio de página.
grep -n 'max-width\|max-w-\|mx-auto' src/routes/<tu-ruta>/+page.svelte
```

Cada coincidencia tiene que caer en una de las cuatro excepciones de arriba. Si
no cae en ninguna, sobra.

Y recuerda que **el cambio va en los dos repos** (`ingreso-svelte` y
`cotransmeq-app`) aplicando el mismo parche, no copiando el archivo. Ver
`AGENTS.md`.
