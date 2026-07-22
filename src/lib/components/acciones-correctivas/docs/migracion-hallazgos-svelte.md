Actúa como un desarrollador Senior Frontend especializado en Svelte + TypeScript.

Necesito migrar completamente la funcionalidad existente de un formulario HTML hacia una implementación Svelte ya existente.

Analiza el componente actual y aplica las siguientes modificaciones respetando la arquitectura, estilos y convenciones ya presentes en el proyecto.

# Objetivo

Completar las funcionalidades faltantes del HTML original dentro del formulario Svelte, manteniendo compatibilidad con la API actual y agregando los nuevos campos requeridos.

---

# Estado actual

El HTML original contiene 6 secciones.

Actualmente el componente Svelte solo cubre parcialmente algunas de ellas.

| Sección                              | Estado         |
| ------------------------------------ | -------------- |
| Identificación del Hallazgo          | ✅ Implementada |
| Valoración del Riesgo                | ❌ Faltante     |
| Corrección Inmediata                 | ⚠ Parcial      |
| Análisis de Causas y Plan de Acción  | ✅ Implementada |
| Análisis y Evaluación de la Eficacia | ⚠ Parcial      |
| Firma / Aprobación                   | ❌ Faltante     |

---

# 1. Implementar Sección: Valoración del Riesgo

Actualmente existe la propiedad:

```ts
valoracion_riesgo
```

pero se renderiza como un select.

Debe reemplazarse por cards visuales seleccionables:

* ALTO
* MEDIO
* BAJO

Al seleccionar una card se deben calcular automáticamente todos los plazos derivados usando la fecha de registro.

## Función base

```ts
function addDays(baseDate: string, days: number): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);

  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}
```

## Reglas de negocio

### Riesgo ALTO

Corrección: 5 días

Plan aprobado: 10 días

Implementación: 90 días

Ciclo 1: 30 días

Ciclo 2: 60 días

Ciclo 3: 90 días

Eficacia 1: 90 días

Eficacia 2: 150 días

### Riesgo MEDIO

Corrección: 10 días

Plan aprobado: 15 días

Implementación: 120 días

Ciclo 1: 40 días

Ciclo 2: 80 días

Ciclo 3: 120 días

Eficacia 1: 120 días

### Riesgo BAJO

Corrección: 15 días

Plan aprobado: 20 días

Implementación: 180 días

Ciclo 1: 60 días

Ciclo 2: 120 días

Ciclo 3: 180 días

Eficacia 1: 180 días

## Requerimientos

Mostrar un bloque reactivo con todos los plazos calculados.

Estos valores deben reutilizarse automáticamente para:

* fecha_limite_implementacion de cada causa
* fecha_limite_evaluacion_eficacia
* hints informativos en otras secciones

---

# 2. Completar Sección Corrección Inmediata

Actualmente existe:

* descripción
* fecha

Agregar:

## Toggle

¿Se formula corrección inmediata?

Opciones:

* Sí
* No se requiere

### Si NO se requiere

Ocultar bloque de corrección.

Mostrar:

```ts
justificacion_no_correccion
```

## Responsable

Agregar:

```ts
responsable_correccion: string
```

Formato:

Nombre + Cargo.

---

## Estado de seguimiento

Reemplazar el uso genérico de BloqueRegistrosSeguimiento por cards visuales.

Estados:

* ✅ Cumplida
* 🔄 En Proceso
* ⛔ Vencida
* 📅 Replanteada

### Si estado = Replanteada

Mostrar bloque adicional:

```ts
replanteo: {
  nueva_fecha_limite: string
  responsable: string
  justificacion: string
  cambios: string
}
```

---

## Nuevos campos API

```ts
aplica_correccion_inmediata: boolean

responsable_correccion: string

replanteo?: {
  nueva_fecha_limite: string
  responsable: string
  justificacion: string
  cambios: string
}
```

---

# 3. Mejoras en Sección Causas

La funcionalidad actual es correcta.

Agregar únicamente:

## Estado visual

Mostrar cards de estado dentro de cada causa:

* Cumplida
* En Proceso
* Vencida
* Replanteada

Si es Replanteada mostrar el mismo sub-bloque de replanteo.

## Hint de plazo

En fecha_limite_implementacion mostrar:

```txt
Plazo máximo: DD/MM/YYYY
```

usando la fecha calculada según el riesgo seleccionado.

---

# 4. Completar Sección Evaluación de Eficacia

Separar la lógica en tres bloques.

---

## A. Ciclos de Seguimiento

Mantener la lógica actual.

Cambiar el resultado por cards visuales:

* ✅ Avance Satisfactorio
* ⚠ Sin Avances Significativos
* 🚫 Impedimento Identificado

### Si Impedimento Identificado

Mostrar:

```ts
impedimento
responsable
nueva_fecha
```

---

## B. Evaluaciones de Eficacia

Crear bloque independiente dinámico.

Botón:

```txt
Agregar evaluación
```

Modelo:

```ts
type EvaluacionEficacia = {
  fecha_evaluacion: string
  evaluador: string
  analisis_evaluacion: string
}
```

Notas:

* Debe soportar múltiples registros.
* Es independiente de evidencias.
* No reutilizar componentes de seguimiento existentes.

---

## C. Resultado Final de Eficacia

Actualmente existe un select.

Reemplazar por cards visuales:

* ✅ EFICAZ
* ⚠ PARCIALMENTE EFICAZ
* 🔄 NO EFICAZ

### Si PARCIALMENTE EFICAZ

Mostrar mensaje indicando plazo adicional de 30 días.

### Si NO EFICAZ

Mostrar bloque de reapertura:

```ts
fecha_reapertura
razon_reapertura
```

fecha_reapertura debe generarse automáticamente con la fecha actual.

Agregar acción:

```txt
Generar Nueva Acción desde Reapertura
```

---

## Nuevos campos API

```ts
evaluaciones_eficacia?: EvaluacionEficacia[]

aplica_reapertura?: boolean

fecha_reapertura?: string

razon_reapertura?: string

accion_origen_reapertura?: string
```

---

# 5. Implementar Banner de Aprobación de Cierre

Agregar bloque informativo visual al final del formulario.

No requiere nuevos campos.

La lógica depende de:

```ts
tipo_hallazgo_detectado
```

## Reglas

### NC Mayor

Requiere:

* Coordinador HSEQ
* Aprobación de Gerencia

### NC Menor

Requiere:

* Coordinador HSEQ

### Observación

Requiere:

* Coordinador HSEQ

### Oportunidad de Mejora

Requiere:

* Coordinador HSEQ

Mostrar banner informativo reactivo con estas reglas.

---

# Prioridades de implementación

## Alta prioridad

1. Sección Valoración del Riesgo completa.
2. Cálculo automático de plazos.
3. Toggle de corrección inmediata.
4. Reapertura por resultado NO EFICAZ.

## Media prioridad

5. Estados visuales tipo card.
6. Evaluaciones de eficacia dinámicas.
7. Resultado de cierre mediante cards.

## Baja prioridad

8. Banner de aprobación de cierre.

---

# Restricciones

* Mantener Svelte + TypeScript.
* Reutilizar componentes existentes cuando sea posible.
* No romper compatibilidad con la API actual.
* Mantener validaciones existentes.
* Usar reactividad nativa de Svelte.
* Mantener coherencia visual con el diseño actual.
* Generar el código completo listo para integrar, incluyendo tipos TypeScript, estado reactivo, UI y lógica de negocio.
