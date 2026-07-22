# Frontend - Acciones Correctivas y Preventivas ✅

## 📋 Resumen

Módulo completo de frontend para la gestión de **Acciones Correctivas y Preventivas** (HSEQ-MTR-07) en SvelteKit.

---

## 🗂️ Estructura de Archivos Creados

### 1. **API Client** (`src/lib/api/acciones-correctivas.ts`)

Cliente API para consumir los endpoints del backend.

**Características:**

- ✅ Interfaces TypeScript completas (28 campos)
- ✅ Tipos: `TipoHallazgo`, `ValoracionRiesgo`, `TipoAccion`, `EstadoAccion`, `EvaluacionCierre`
- ✅ Métodos CRUD completos: `crear`, `listar`, `obtenerPorId`, `obtenerPorNumero`, `actualizar`, `eliminar`
- ✅ Filtros avanzados: tipo, estado, riesgo, fechas, búsqueda general
- ✅ Paginación automática
- ✅ Obtención de estadísticas
- ✅ Exportación y descarga de PDF

**Métodos disponibles:**

```typescript
accionesCorrectivasAPI.crear(data);
accionesCorrectivasAPI.listar(filtros);
accionesCorrectivasAPI.obtenerPorId(id);
accionesCorrectivasAPI.obtenerPorNumero(accion_numero);
accionesCorrectivasAPI.actualizar(id, data);
accionesCorrectivasAPI.eliminar(id);
accionesCorrectivasAPI.obtenerEstadisticas();
accionesCorrectivasAPI.descargarPDF(id, accion_numero);
```

---

### 2. **Vista Principal** (`src/routes/acciones-correctivas/+page.svelte`)

Página principal con lista de acciones, filtros y estadísticas.

**Características:**

- ✅ **Dashboard de estadísticas** con 4 cards:
  - Total de acciones
  - Acciones en proceso
  - Próximas a vencer (30 días)
  - Acciones cumplidas
- ✅ **Filtros avanzados:**
  - Búsqueda general (número, descripción, lugar, responsable)
  - Filtro por tipo (CORRECTIVA/PREVENTIVA/MEJORA)
  - Filtro por estado (Cumplidas/En Proceso/Vencidas)
  - Filtro por riesgo (ALTO/MEDIO/BAJO)
  - Rango de fechas (desde/hasta)
- ✅ **Tabla responsive** con columnas:
  - Número de acción
  - Descripción y lugar
  - Tipo (badge colorizado)
  - Estado (badge colorizado)
  - Riesgo (badge colorizado)
  - Responsable
  - Fecha límite
  - Acciones (PDF, Editar, Eliminar)
- ✅ **Paginación completa:**
  - Navegación por páginas
  - Indicador de resultados
  - Botones anterior/siguiente
- ✅ **Acciones rápidas:**
  - Crear nueva acción
  - Editar acción existente
  - Eliminar acción (con confirmación)
  - Descargar PDF individual

**Estados de carga:**

- Skeleton loader mientras carga
- Estado vacío con CTA
- Animaciones de transición

---

### 3. **Modal de Formulario** (`src/lib/components/acciones-correctivas/ModalFormularioAccion.svelte`)

Modal completo para crear/editar acciones con navegación por secciones.

**Estructura:**
El formulario está organizado en **5 secciones** con navegación visual:

#### **Sección 1: Identificación del Hallazgo** (9 campos)

- ✅ Número de acción\* (único, requerido)
- ✅ Lugar/Sede
- ✅ Proceso origen del hallazgo
- ✅ Componente/Elemento de referencia
- ✅ Fuente que generó el hallazgo
- ✅ Marco legal/normativo
- ✅ Fecha de identificación
- ✅ Descripción del hallazgo\* (requerido)
- ✅ Tipo de hallazgo (select con 6 opciones)
- ✅ Variable/Categoría de análisis

#### **Sección 2: Corrección Inmediata** (4 campos)

- ✅ Corrección/Solución inmediata (textarea)
- ✅ Fecha de implementación
- ✅ Valoración del riesgo (ALTO/MEDIO/BAJO)
- ✅ ¿Requiere actualizar matriz? (checkbox)

#### **Sección 3: Análisis y Plan de Acción** (5 campos)

- ✅ Tipo de acción\* (CORRECTIVA/PREVENTIVA/MEJORA, requerido)
- ✅ Análisis de causas - 5 Por Qués (textarea grande)
- ✅ Descripción del plan de acción (textarea)
- ✅ Fecha límite de implementación
- ✅ Responsable de ejecución

#### **Sección 4: Seguimiento** (3 campos)

- ✅ Fecha de seguimiento
- ✅ Estado de la acción (Cumplidas/En Proceso/Vencidas)
- ✅ Descripción del estado/observaciones (textarea)

#### **Sección 5: Evaluación de Eficacia** (7 campos)

- ✅ Fecha de evaluación de eficacia
- ✅ Criterio de evaluación (textarea)
- ✅ Análisis de evidencias de cierre (textarea)
- ✅ Evaluación del cierre (EFICAZ/NO EFICAZ)
- ✅ Soporte del cierre eficaz
- ✅ Fecha de cierre definitivo
- ✅ Responsable del cierre

**Características del Modal:**

- ✅ Navegación entre secciones con pestañas
- ✅ Botones Anterior/Siguiente para navegación
- ✅ Validación de campos requeridos
- ✅ Modo creación y modo edición
- ✅ Estados de carga (spinner mientras guarda)
- ✅ Animaciones suaves (fade, fly)
- ✅ Diseño responsive
- ✅ Header con gradiente azul
- ✅ Auto-scroll al cambiar sección

---

## 🎨 Diseño y UX

### Colores de Badges

**Tipo de Acción:**

- 🔴 CORRECTIVA: `bg-red-100 text-red-800`
- 🔵 PREVENTIVA: `bg-blue-100 text-blue-800`
- 🟢 MEJORA: `bg-green-100 text-green-800`

**Estado:**

- 🟢 Cumplidas: `bg-green-100 text-green-800`
- 🟡 En Proceso: `bg-yellow-100 text-yellow-800`
- 🔴 Vencidas: `bg-red-100 text-red-800`

**Riesgo:**

- 🔴 ALTO: `bg-red-100 text-red-800`
- 🟡 MEDIO: `bg-yellow-100 text-yellow-800`
- 🟢 BAJO: `bg-green-100 text-green-800`

### Iconos SVG

- 📄 Documento (total acciones)
- ⏱️ Reloj (en proceso)
- ⚠️ Advertencia (próximas a vencer)
- ✅ Check (cumplidas)
- 📥 Descarga (exportar PDF)
- ✏️ Editar
- 🗑️ Eliminar

---

## 🚀 Cómo Usar

### 1. Acceder al Módulo

```
http://localhost:5173/acciones-correctivas
```

### 2. Crear Nueva Acción

1. Click en botón "Nueva Acción"
2. Completar **Sección 1** (Identificación):
   - Número de acción (ej: `A22_1`)
   - Descripción del hallazgo (requerido)
3. Navegar a **Sección 2** (Corrección Inmediata)
4. Continuar con **Sección 3** (Plan de Acción):
   - Tipo de acción (requerido)
5. Completar **Sección 4** (Seguimiento)
6. Finalizar en **Sección 5** (Evaluación)
7. Click en "Guardar"

### 3. Filtrar Acciones

**Búsqueda rápida:**

- Escribir en el campo de búsqueda
- Enter o click en "Aplicar Filtros"

**Filtros avanzados:**

- Seleccionar tipo, estado, riesgo
- Definir rango de fechas
- Click en "Aplicar Filtros"

**Limpiar filtros:**

- Click en "Limpiar"

### 4. Editar Acción

1. Click en icono ✏️ en la fila de la acción
2. Modal se abre con datos cargados
3. Modificar campos necesarios
4. Click en "Actualizar"

### 5. Exportar PDF

1. Click en icono 📥 en la fila de la acción
2. PDF se genera automáticamente
3. Archivo se descarga: `Accion_A22_1_2026-01-14.pdf`

### 6. Eliminar Acción

1. Click en icono 🗑️
2. Confirmar eliminación
3. Acción se elimina de la base de datos

---

## 📊 Estadísticas

El dashboard muestra:

- **Total Acciones**: Contador global
- **En Proceso**: Acciones con estado "En Proceso"
- **Próximas a Vencer**: Acciones con fecha límite dentro de 30 días y estado != "Cumplidas"
- **Cumplidas**: Acciones finalizadas exitosamente

Las estadísticas se actualizan automáticamente después de:

- Crear nueva acción
- Actualizar acción
- Eliminar acción

---

## 🔍 Validaciones

### Campos Requeridos:

1. ✅ **Número de acción** (único en la base de datos)
2. ✅ **Descripción del hallazgo**
3. ✅ **Tipo de acción** (CORRECTIVA/PREVENTIVA/MEJORA)

### Validaciones Automáticas:

- Número de acción único (backend verifica duplicados)
- Formato de fechas ISO (YYYY-MM-DD)
- Campos de texto limitados por textarea

---

## 🎯 Integraciones

### Con Backend:

- Base URL: `http://localhost:4000/api/acciones-correctivas`
- Autenticación: Bearer token desde `localStorage.getItem('transmeralda_token')`
- Headers: `Content-Type: application/json`, `Authorization: Bearer {token}`

### Con Componentes:

- `svelte-sonner` para notificaciones toast
- Transiciones de Svelte (`fade`, `fly`)
- Stores de Svelte para estado local

---

## 📝 Flujo de Trabajo Típico

### Ciclo Completo de una Acción:

1. **Identificación del Hallazgo** (Sección 1)
   - Auditor detecta no conformidad
   - Registra: A22_1, descripción, lugar, fecha

2. **Corrección Inmediata** (Sección 2)
   - Acción rápida para contener el problema
   - Valoración del riesgo: ALTO

3. **Plan de Acción** (Sección 3)
   - Tipo: CORRECTIVA
   - Análisis de causas con 5 por qués
   - Plan detallado con responsable y fecha límite

4. **Seguimiento** (Sección 4)
   - Estado: En Proceso
   - Verificaciones periódicas
   - Actualización de observaciones

5. **Evaluación de Eficacia** (Sección 5)
   - Verificar si la acción fue efectiva
   - Evaluación: EFICAZ
   - Cierre definitivo con evidencias

---

## 🛠️ Troubleshooting

### Error: "Número de acción ya existe"

- El campo `accion_numero` debe ser único
- Usar otro número (ej: A22_2, A22_3)

### Error: "Token inválido"

- Verificar que el usuario esté autenticado
- Token en localStorage: `transmeralda_token`

### PDF no descarga

- Verificar que el servidor backend esté corriendo
- Endpoint: `GET /api/acciones-correctivas/:id/exportar-pdf`
- Verificar logo en: `public/assets/cotransmeq-logo.webp`

### Filtros no funcionan

- Click en "Aplicar Filtros" después de seleccionar
- Limpiar filtros y volver a intentar

---

## ✅ Checklist Final

- ✅ API Client creado (`acciones-correctivas.ts`)
- ✅ Vista principal con tabla y filtros (`+page.svelte`)
- ✅ Modal de formulario con 5 secciones (`ModalFormularioAccion.svelte`)
- ✅ Estadísticas en tiempo real
- ✅ Exportación de PDF
- ✅ Paginación funcional
- ✅ Validaciones de formulario
- ✅ Mensajes de éxito/error (toast)
- ✅ Animaciones y transiciones
- ✅ Diseño responsive
- ✅ Badges colorizados
- ✅ Confirmación de eliminación
- ✅ Estado de carga
- ✅ Estado vacío

---

## 🚀 Próximos Pasos (Opcional)

Mejoras futuras sugeridas:

1. **Vista de Detalle Individual**
   - Ruta: `/acciones-correctivas/[id]`
   - Mostrar todos los campos en modo lectura
   - Historial de cambios

2. **Exportación Masiva**
   - Botón "Exportar Todo a Excel"
   - Reporte consolidado en PDF

3. **Notificaciones**
   - Email cuando una acción está por vencer
   - Recordatorio al responsable

4. **Búsqueda Avanzada**
   - Búsqueda por múltiples criterios simultáneos
   - Guardado de filtros favoritos

5. **Dashboard Analítico**
   - Gráficas de tendencias
   - Tiempo promedio de cierre
   - Eficacia por departamento

---

## 📞 Soporte

Para dudas o problemas:

- Backend: `/Users/julianlopez/Desktop/cotransmeq/backend-nest`
- Frontend: `/Users/julianlopez/Desktop/cotransmeq/ingreso-svelte`
- Documentación de pruebas: `TESTS_ACCIONES_CORRECTIVAS.md`

---

**¡Módulo completo y listo para usar! 🎉**
