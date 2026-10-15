# RELMA — Manual de uso

## 🎯 ¿Qué es?
Sistema web para gestionar fórmulas de color de pintura, igualar colores, convertir tamaños y llevar historial.

## 🚀 Cómo arrancar
1. Abrir terminal en la carpeta `relma`
2. Ejecutar: `node server.js`
3. Abrir navegador en: http://localhost:3000
4. Login: `admin` / `admin123`

## 📁 Archivos importantes

| Archivo | Para qué sirve |
|---|---|
| `server.js` | Servidor (backend) |
| `database.js` | Base de datos |
| `conversion.js` | Motor de conversión |
| `respaldos.js` | Sistema de respaldos automáticos |
| `public/index.html` | Página principal |
| `public/app.js` | Lógica del navegador |
| `public/styles.css` | Estilos |
| `relma.db` | ⚠️ TODOS tus datos aquí |

## 🎨 Pestañas del sistema

### 👥 Clientes
Lista de clientes. Clic para ver sus fórmulas. Botones ✏️ editar y 🗑 borrar en cada tarjeta.

### 🧪 Fórmulas
Todas las fórmulas guardadas. Se puede:
- Filtrar por cliente, producto, favoritos
- Duplicar (📋) para crear una variante
- Convertir a otro tamaño desde el modal de detalle
- Preparar → abre la pantalla grande para el taller

### 🧴 Igualar Color
Para cuando un cliente trae una pieza y hay que igualarla.
1. Nueva sesión → elegir cliente, producto, base, tamaño
2. Ir apuntando los ajustes de tinta
3. Al finalizar se puede guardar como fórmula permanente

### 🔁 Conversor
Convertir fórmulas entre tamaños (LT / GAL / CBT / custom).

### 📖 Historial
Registro de todas las preparaciones. Filtros por fecha, cliente, estado. Se exporta a Excel.

### 💾 Backup
- Descargar JSON (para restaurar después)
- Descargar Excel .xlsx con pestañas
- Descargar CSV
- Descargar .db completo
- Respaldos automáticos (cada X horas, local + Drive)

### ⚙️ Config (solo admin)
- Usuarios y roles
- Datos de empresa
- Preferencias
- Catálogos de tintas y productos
- Log de cambios
- Zona peligrosa

## 🛡️ Roles
| Rol | Permisos |
|---|---|
| admin | Todo |
| taller | Ver, preparar, mezclar, crear fórmulas |
| consulta | Solo ver |

## 💾 Respaldo y restauración

### Los datos viven en:
- `relma.db` (base de datos)
- `relma/respaldos/` (respaldos locales)
- `G:\Mi unidad\Respaldos RELMA` (si está configurado Drive)

### Si se rompe algo:
1. Ir a Backup → Respaldos guardados
2. Elegir el último bueno → Descargar
3. Detener servidor
4. Reemplazar `relma.db` con el descargado
5. Arrancar servidor

## 🔧 Comandos útiles

```powershell
node server.js              # Arrancar
Ctrl + C                    # Detener
node resetear-admin.js      # Resetear contraseña admin