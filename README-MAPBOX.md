# 🗺️ Sistema de Búsqueda de Ubicaciones con Mapbox

## 📋 Descripción General

Se ha implementado un sistema completo de búsqueda de ubicaciones utilizando **Mapbox Places API** para el registro de servicios. Este sistema es especialmente útil para ubicaciones remotas como **pozos petroleros**, **campamentos**, y **locaciones específicas** que no tienen direcciones tradicionales.

## ✨ Características Implementadas

### 1. **Componente MapboxSearch**

`src/lib/components/ui/MapboxSearch.svelte`

- ✅ Búsqueda en tiempo real de direcciones en Colombia
- ✅ Autocompletado con sugerencias mientras escribes
- ✅ Captura automática de coordenadas (latitud/longitud)
- ✅ Interfaz estilizada consistente con el diseño del sistema
- ✅ Soporte para POIs, direcciones, localidades, y vecindarios
- ✅ Validación de token de Mapbox con mensaje de error amigable

**Props del componente:**

```typescript
{
  value: string;                    // Valor actual del input
  label: string;                    // Etiqueta opcional
  placeholder: string;              // Placeholder personalizado
  required: boolean;                // Si es campo requerido
  disabled: boolean;                // Si está deshabilitado
  onSelect: (data) => void;         // Callback cuando se selecciona
}
```

**Datos retornados en `onSelect`:**

```typescript
{
	address: string; // Dirección legible
	coordinates: [lng, lat]; // Coordenadas [longitud, latitud]
	context: any; // Contexto (municipio, departamento, etc.)
	placeName: string; // Nombre completo del lugar
}
```

### 2. **Integración en ModalFormServicio**

`src/lib/components/servicios/ModalFormServicio.svelte`

#### Sistema de Tabs (Origen y Destino)

Cada ubicación específica (origen/destino) tiene dos opciones:

**🔍 Pestaña "Buscar Dirección" (Mapbox)**

- Búsqueda asistida con Mapbox Places
- Captura automática de coordenadas
- Ideal para direcciones conocidas y POIs

**📍 Pestaña "Coordenadas"**

- Input manual del nombre del lugar
- Input manual de latitud y longitud
- Ideal para ubicaciones remotas con coordenadas GPS conocidas

#### Flujo de Uso:

1. **Seleccionar municipio** (origen/destino) - Obligatorio
2. **Elegir pestaña** de búsqueda o coordenadas
3. **Buscar/Ingresar ubicación específica**
4. **Visualizar coordenadas** capturadas automáticamente

### 3. **Configuración de Variables de Entorno**

`ingreso-svelte/.env`

```bash
# Mapbox (PRINCIPAL - Implementado)
VITE_MAPBOX_ACCESS_TOKEN=pk.eyJ1IjoiMTIyN2psZGV2...

# Otras APIs disponibles para futuras implementaciones
VITE_GOOGLE_MAPS_API_KEY=AIzaSyDkGkAsTM0BUxG...
VITE_AWS_LOCATION_API_KEY=v1.public.eyJqdGkiOiJl...
VITE_WIALON_API_TOKEN=00d90c3f86ef574df0f12b5f...
```

**Tipos TypeScript:**
`src/env.d.ts` - Autocompletado y validación de tipos para env vars

### 4. **Store de Ubicaciones Frecuentes** (Preparatorio)

`src/lib/stores/ubicaciones-frecuentes.ts`

Store preparado para futura implementación de:

- Ubicaciones guardadas (pozos, campamentos)
- Ordenamiento por frecuencia de uso
- Filtros por tipo y cliente
- Integración con backend

**Tipos de ubicaciones:**

- `pozo` - Pozos petroleros
- `campamento` - Campamentos de trabajo
- `planta` - Plantas de procesamiento
- `oficina` - Oficinas
- `otro` - Otras ubicaciones

## 🎨 Diseño Visual

### Tabs de Búsqueda

- Fondo gris claro con pestañas blancas elevadas
- Transición suave entre pestañas
- Iconos descriptivos (lupa, coordenadas)
- Estado activo destacado en verde esmeralda

### Input de Mapbox

- Borde redondeado (rounded-xl)
- Transición al focus con anillo verde esmeralda
- Dropdown de sugerencias con hover effects
- Altura consistente con otros inputs del formulario

### Visualización de Coordenadas

- Texto pequeño en gris (`text-xs text-gray-500`)
- Emoji de pin 📍 para mejor UX
- Precisión de 6 decimales
- Aparece solo cuando hay coordenadas válidas

## 🚀 Uso Práctico

### Ejemplo: Registrar servicio a pozo petrolero

1. **Step 2: Trayecto**
2. Seleccionar municipio origen: `Barrancabermeja`
3. **Ubicación Específica de Origen:**
   - Tab "Buscar Dirección"
   - Escribir: `"Terminal de Ecopetrol"`
   - Seleccionar de sugerencias
   - ✅ Coordenadas capturadas automáticamente

4. Seleccionar municipio destino: `Puerto Wilches`
5. **Ubicación Específica de Destino:**
   - Tab "Coordenadas"
   - Nombre: `"Pozo San Rafael 24"`
   - Latitud: `7.234567`
   - Longitud: `-73.876543`
   - ✅ Ubicación registrada manualmente

## 📦 Dependencias Instaladas

```json
{
	"mapbox-gl": "^3.x.x",
	"@mapbox/mapbox-gl-geocoder": "^5.x.x"
}
```

## 🔒 Seguridad

- ✅ Tokens almacenados en `.env` (no versionados)
- ✅ Validación de token antes de inicializar
- ✅ Mensajes de error amigables si falta configuración
- ✅ Búsquedas limitadas a Colombia (`countries: 'co'`)

## 🛣️ Próximos Pasos (Roadmap)

### Fase 1: Backend (Pendiente)

- [ ] Crear tabla `ubicaciones_frecuentes` en base de datos
- [ ] Endpoints CRUD para ubicaciones
- [ ] Endpoint de búsqueda y filtros
- [ ] Endpoint para incrementar contador de uso

### Fase 2: UI Avanzada (Pendiente)

- [ ] Agregar pestaña "Frecuentes" en Step 2
- [ ] Modal para crear nueva ubicación frecuente
- [ ] Lista de ubicaciones más usadas
- [ ] Filtros por cliente y tipo

### Fase 3: Integración Completa (Pendiente)

- [ ] Conectar store con endpoints del backend
- [ ] Auto-sugerencias de ubicaciones frecuentes
- [ ] Historiales de ubicaciones por cliente
- [ ] Analytics de ubicaciones más visitadas

## 🧪 Testing

Para probar la funcionalidad:

1. **Iniciar servidor de desarrollo:**

   ```bash
   cd ingreso-svelte
   npm run dev
   ```

2. **Navegar a servicios** y crear nuevo servicio

3. **En Step 2:**
   - Probar búsqueda de Mapbox con direcciones conocidas
   - Probar ingreso manual de coordenadas
   - Verificar que se capturan correctamente
   - Avanzar al Step 4 y crear el servicio

4. **Verificar en base de datos:**
   - `origen_especifico` y `destino_especifico` deben tener los nombres
   - `origen_latitud`, `origen_longitud` deben tener coordenadas
   - `destino_latitud`, `destino_longitud` deben tener coordenadas

## 📝 Notas Técnicas

### Coordenadas en Mapbox vs Base de Datos

⚠️ **Importante:** Mapbox retorna coordenadas en formato `[longitud, latitud]`, pero el sistema usa `[latitud, longitud]`. El componente hace la conversión automáticamente:

```typescript
onSelect={(data) => {
  originCoords = {
    lat: data.coordinates[1],  // ← latitud (segundo valor)
    lng: data.coordinates[0]   // ← longitud (primer valor)
  };
}}
```

### Límite de Búsquedas

Mapbox tiene un límite de búsquedas gratuitas. Monitorear uso en:
https://account.mapbox.com/

### Alternativas Disponibles

Si se alcanza el límite de Mapbox, hay tokens configurados para:

- **Google Maps Places API** (requiere implementación)
- **AWS Location Service** (requiere implementación)

## 🤝 Contribuciones

Para agregar nuevas funcionalidades:

1. Revisar el store `ubicaciones-frecuentes.ts`
2. Los métodos con `// TODO:` están listos para conectar con backend
3. Seguir el patrón de diseño existente (tabs, modales)

## 📞 Soporte

Creado por: Julian Lopez
Fecha: 20 de Diciembre de 2025
Versión: 1.0.0

---

**¡El sistema está listo para usarse!** 🎉

La búsqueda de Mapbox funciona de inmediato. Las ubicaciones frecuentes son opcionales y se pueden implementar en el futuro según necesidad.
