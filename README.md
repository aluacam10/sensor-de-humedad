# 🌡️ Sensor de Humedad WiFi - Documentación Completa

**Sistema de monitoreo de humedad en tiempo real** con Arduino WiFi S3, Cloud Backend en Vercel, y Dashboard web interactivo.

**URL en Producción:** https://sensor-de-humedad.vercel.app

---

## 📋 Tabla de Contenidos

1. [Descripción General](#descripción-general)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [Hardware](#hardware)
4. [Software](#software)
5. [Estructura de Carpetas](#estructura-de-carpetas)
6. [Instalación y Configuración](#instalación-y-configuración)
7. [Despliegue en Vercel](#despliegue-en-vercel)
8. [API REST](#api-rest)
9. [Sistema de Binding de Dispositivos](#sistema-de-binding-de-dispositivos)
10. [Calibración del Sensor](#calibración-del-sensor)
11. [Troubleshooting](#troubleshooting)

---

## 🎯 Descripción General

### Propósito
Sistema IoT para monitoreo remoto de humedad de suelo/aire que registra datos en tiempo real, los almacena en la nube y proporciona un dashboard web para visualización.

### Características Principales
- ✅ Lectura de sensor capacitivo de humedad en tiempo real
- ✅ Display LCD 16x2 para visualización local
- ✅ Relay automático que se activa en ≥70% de humedad
- ✅ Conexión WiFi a través de red local (SSID: ERICKHUAWEI_6080)
- ✅ Envío de datos a API REST en la nube (Vercel)
- ✅ Almacenamiento persistente (Redis + SQLite)
- ✅ Dashboard web interactivo con gráficos
- ✅ Sistema de vinculación (binding) de dispositivos por sesión
- ✅ Protección: Datos solo accesibles tras vincular dispositivo
- ✅ Historial de datos con exportación

### Flujo de Datos
```
Arduino (Sensor) 
    ↓ WiFi HTTPS
Vercel API (/api/ingest)
    ↓ Almacena en Redis + SQLite
Dashboard Web ← Polling cada 3 segundos (cuando está vinculado)
```

---

## 🏗️ Arquitectura del Sistema

### Componentes Principales

#### 1. **Arduino WiFi S3** (Dispositivo)
- Controlador: Arduino WiFi S3
- Puerto Serial: USB (9600 baud)
- Sensor: Capacitivo de humedad en pin A0
- Display: LCD 16x2 (pins: RS=12, E=11, D4-D7=5,4,3,2)
- Relay: Pin digital 7 (activa en HIGH)
- Red WiFi: SSID "ERICKHUAWEI_6080", PSK "123456789"

#### 2. **Vercel Backend** (Cloud)
- Runtime: Python 3.11
- Framework: Flask
- URL Base: https://sensor-de-humedad.vercel.app
- Almacenamiento: Upstash Redis (KV) + SQLite (local/efímero)
- Timeout: 30 segundos por función

#### 3. **Dashboard Web** (Frontend)
- Interfaz: HTML5 + CSS3 + JavaScript
- Charting: Chart.js
- Modo Cloud: Polling cada 3 segundos via /api/latest
- Session: sessionStorage (por pestaña del navegador)

#### 4. **Sistema de Binding**
- Mecanismo: Session-scoped device binding
- Validación: En todos los endpoints que devuelven datos
- Timeout: 600 segundos de inactividad
- Scope: Cada pestaña/navegador obtiene sesión única

---

## ⚙️ Hardware

### Esquema de Conexión

```
Arduino WiFi S3
├── A0 ────────────→ Sensor Capacitivo de Humedad
├── GND ───────────→ GND Sensor
├── Pin 7 ─────────→ Relay (activa en LOW/HIGH según lógica)
├── Pin 12 ────────→ LCD RS
├── Pin 11 ────────→ LCD E
├── Pin 5 ─────────→ LCD D4
├── Pin 4 ─────────→ LCD D5
├── Pin 3 ─────────→ LCD D6
├── Pin 2 ─────────→ LCD D7
└── USB ───────────→ Alimentación + Serial
```

### Sensor Capacitivo
- **Rango RAW Seco (aire):** 0-5
- **Rango RAW Mojado (agua):** 400-529
- **Promedio:** 10 lecturas por ciclo (estabilidad)
- **Escala:** Mapea 0-529 → 0-100%

### Relay
- **Activación:** Cuando humedad ≥ 70%
- **Lógica:** `digitalWrite(7, LOW)` activa
- **Función:** Control de bomba/ventilador

### Display LCD
- **Tipo:** 16 caracteres × 2 líneas
- **Formato:** "Humedad" (línea 1) + "XX%" (línea 2)
- **Actualización:** Cada segundo

---

## 💻 Software

### Arduino (Arduino_WiFi_Humedad.ino)

#### Funcionalidades
1. **Lectura de Sensor**
   - Promedia 10 lecturas de A0 con delay 10ms cada una
   - Constrain entre sensorMin=0 y sensorMax=529
   - Mapea a escala 0-100%

2. **Conexión WiFi**
   - Conecta a ERICKHUAWEI_6080
   - Muestra "WiFi OK" en LCD al conectar
   - Reintentos: hasta 20 intentos con delay 1.5s

3. **Envío a Nube**
   - Endpoint: https://sensor-de-humedad.vercel.app/api/ingest
   - Método: POST HTTPS (puerto 443, WiFiSSLClient)
   - Intervalo: 5 segundos (SEND_INTERVAL_MS)
   - Payload JSON:
     ```json
     {
       "device_id": "arduino-01",
       "humedad": 45,
       "raw": 238
     }
     ```
   - Validación: Respuesta HTTP/1.1 200 OK o 201

4. **Control de Relay**
   - Activa `digitalWrite(7, LOW)` si humedad ≥ 70%
   - Desactiva `digitalWrite(7, HIGH)` si humedad < 70%

5. **Salida Serial**
   - `[SENSOR] RAW=X -> Y%` - Lectura procesada
   - `[HTTP] HTTP/1.1 200 OK` - Respuesta del servidor
   - `[CLOUD] envio OK/FAIL` - Resultado de POST

#### Calibración
```cpp
int sensorMin = 0;    // Valor RAW en seco (aire)
int sensorMax = 529;  // Valor RAW en mojado (agua)
```
Estos valores se actualizan según mediciones reales del sensor.

---

### Backend Flask (backend/app.py)

#### Características
1. **Endpoints Principales**

   | Endpoint | Método | Descripción |
   |----------|--------|-------------|
   | `/api/ingest` | POST | Recibe datos del Arduino, registra dispositivo |
   | `/api/latest` | GET | Última lectura del dispositivo vinculado |
   | `/ping` | POST | Heartbeat + datos (con validación binding) |
   | `/devices` | GET | Lista de dispositivos activos detectados |
   | `/api/bind` | POST | Vincula dispositivo a sesión |
   | `/api/unbind` | POST | Desvincula dispositivo |
   | `/historial` | GET | Historial de datos (últimas 200 registros) |
   | `/borrar_historial` | POST | Limpia historial |
   | `/config` | GET | Configuración del sistema |

2. **Almacenamiento de Datos**
   - **Redis (Upstash):** Almacenamiento persistente de últimos datos y dispositivos
   - **SQLite:** Base de datos local de historial (ephemeral en Vercel)
   - **Claves Redis:**
     - `sensor:latest:device_id` - Última lectura por dispositivo
     - `sensor:devices` - Conjunto (SET) de dispositivos activos
     - `sensor:history:device_id` - Lista (LIST) de historial

3. **Sistema de Binding**
   - **Almacenamiento:** Memory + Redis (threads_lock para sincronización)
   - **Estructura:**
     ```python
     bound_device_id = "arduino-01"
     bound_session_id = "session_xxx"
     binding_timestamp = time.time()
     ```
   - **Validaciones:**
     - Solo 1 sesión por dispositivo (exclusividad)
     - Timeout de 600 segundos sin actividad
     - Heartbeat mantiene viva la sesión

4. **Detección de Dispositivos**
   - Timeout: 120 segundos (dispositivo desaparece si no envía)
   - Actualización: En cada POST a `/api/ingest`
   - Información: device_id, última lectura, timestamp

#### Lógica de Binding (Seguridad)
```
1. Usuario abre navegador → Genera session_id único
2. Usuario selecciona dispositivo en dropdown
3. Frontend POST /api/bind {session_id, device_id}
4. Backend vincula: bound_device_id=device_id, bound_session_id=session_id
5. Polling por /api/latest:
   - Si is_bound_to_me: Devuelve datos
   - Si is_bound_to_other: Error 409 (ocupado)
   - Si no vinculado: Devuelve datos vacíos "--"
```

---

### Frontend (backend/static/app.js)

#### Componentes Principales

1. **Gestión de Sesión**
   - SessionID: Único por pestaña (sessionStorage)
   - Persist: Sobrevive recarga de página
   - Scope: No se comparte entre pestañas/navegadores

2. **Modos de Conexión**
   - **Mode "web"**: Web Serial API (navegadores de escritorio)
   - **Mode "backend"**: Servidor local (móviles)
   - **Mode "cloud"**: Polling a Vercel (producción)

3. **Device Binding UI**
   - Dropdown: Lista de dispositivos detectados
   - Auto-bind: Al seleccionar dispositivo, vincula automáticamente
   - Status: Muestra "Sensor vinculado" o "Sensor libre"
   - Unbind: Botón para desvincular

4. **Polling**
   - **Intervalo:** 3 segundos (cuando vinculado)
   - **Endpoint:** `/api/latest` (con validación binding)
   - **Guard:** Si no hay dispositivo vinculado, no muestra datos
   - **Inicio:** Al vincular dispositivo
   - **Fin:** Al desvincular

5. **Visualización**
   - Display: Valor en % con rango de colores
   - Estados: SECO (<30%), OPTIMO (30-70%), HUMEDO (>70%)
   - Animación: Relleno de agua tipo anillo
   - Historial: Gráfico Chart.js con datos de últimas 200 lecturas

#### Flujo de Usuario
```
1. Página carga → Muestra "--" (sin datos)
2. Usuario hace click "Buscar dispositivos"
3. Dropdown se llena con dispositivos detectados
4. Usuario selecciona dispositivo
5. Auto-vinculación → Comienza polling
6. Dashboard muestra datos en tiempo real
7. Si usuario cierra pestaña → Desvinculación automática
```

---

## 📁 Estructura de Carpetas

```
Sensor de Humedad/
│
├── 📄 Arduino_WiFi_Humedad.ino          [Firmware Arduino, 193 líneas]
│
├── 📁 api/
│   └── 📄 index.py                      [Punto entrada Vercel]
│
├── 📁 backend/
│   ├── 📄 app.py                        [Aplicación Flask principal, ~1000 líneas]
│   ├── 📁 static/
│   │   ├── 📄 app.js                    [Lógica frontend, ~900 líneas]
│   │   └── 📄 style.css                 [Estilos, temas de colores]
│   └── 📁 templates/
│       └── 📄 index.html                [Interfaz HTML]
│
├── 📄 requirements.txt                  [Dependencias Python]
├── 📄 vercel.json                       [Config Vercel (Python 3.11)]
├── 📄 README.md                         [Documentación (este archivo)]
├── 📄 SOLUCION_DISPOSITIVOS.md          [Notas de troubleshooting]
└── 📄 .env.example                      [Variables de entorno template]
```

---

## 🚀 Instalación y Configuración

### Prerequisitos
- Python 3.9+ instalado
- Git instalado
- Arduino IDE con board "Arduino WiFi S3" configurado
- Cuenta GitHub (para pushear cambios)

### Instalación Local (Desarrollo)

#### 1. Clonar Repositorio
```bash
git clone https://github.com/aluacam10/sensor-de-humedad.git
cd "Sensor de Humedad"
```

#### 2. Crear Entorno Virtual
```bash
# Windows
python -m venv venv
venv\Scripts\activate

# Linux/Mac
python3 -m venv venv
source venv/bin/activate
```

#### 3. Instalar Dependencias
```bash
pip install -r requirements.txt
```

#### 4. Configurar Variables de Entorno
```bash
cp .env.example .env
```
Editar `.env` con:
```
SERIAL_PORT=COM3              # o /dev/ttyUSB0 en Linux
SERIAL_BAUD=9600
USE_WEB_SERIAL=0              # 1 para Web Serial API
UPSTASH_REDIS_REST_URL=       # Dejar vacío para desarrollo local
UPSTASH_REDIS_REST_TOKEN=
```

#### 5. Ejecutar Localmente
```bash
python -m flask --app backend.app run
```
Acceder a: http://localhost:5000

### Configuración Arduino

#### 1. Abrir Arduino IDE
- Instalar board: "Arduino WiFi S3"
- Seleccionar: Boards → Arduino WiFi S3

#### 2. Actualizar Credenciales WiFi
En `Arduino_WiFi_Humedad.ino`, modificar:
```cpp
const char WIFI_SSID[] = "TU_SSID";
const char WIFI_PASS[] = "TU_PASSWORD";
```

#### 3. Cargar Firmware
- Conectar Arduino por USB
- Seleccionar puerto COM
- Subir código

#### 4. Validar en Serial Monitor
Debería ver:
```
[BOOT] Iniciando en modo SENSOR REAL...
[WiFi] Conectando a: ERICKHUAWEI_6080
[WiFi] Conectado
[WiFi] IP: 192.168.1.XX
[SENSOR] RAW=45 -> 8%
[HTTP] HTTP/1.1 200 OK
[CLOUD] envio OK
```

---

## 🌐 Despliegue en Vercel

### Paso 1: Preparar Repositorio GitHub

```bash
git add .
git commit -m "Preparado para Vercel - Sistema de monitoreo WiFi"
git push origin main
```

### Paso 2: Crear Proyecto en Vercel

1. Ir a https://vercel.com/dashboard
2. Click en "Add New..." → "Project"
3. Importar repositorio de GitHub
4. Click en "Import"

### Paso 3: Configurar Variables de Entorno

En Vercel Dashboard:
- Settings → Environment Variables
- Agregar:

| Variable | Valor |
|----------|-------|
| `UPSTASH_REDIS_REST_URL` | Tu URL de Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Tu token de Upstash |
| `USE_WEB_SERIAL` | 0 |

### Paso 4: Deploy

Click en "Deploy"

### Obtener Credenciales Upstash

1. Ir a https://console.upstash.com
2. Crear nueva base de datos Redis
3. Copiar:
   - REST API URL
   - REST API Token
4. Pegar en Vercel Environment Variables

### Verificar Deployment

- URL: https://sensor-de-humedad.vercel.app
- Arduino enviará datos a ese endpoint
- Dashboard accesible desde cualquier navegador

---

## 📡 API REST

### 1. Recibir Datos del Arduino

**Endpoint:** `POST /api/ingest`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "device_id": "arduino-01",
  "humedad": 45,
  "raw": 238
}
```

**Respuesta (200 OK):**
```json
{
  "ok": true,
  "device_id": "arduino-01",
  "mensaje": "Datos guardados"
}
```

**Funcionalidad:**
- Registra dispositivo si es nuevo
- Almacena datos en Redis + SQLite
- Actualiza timestamp de último contacto

---

### 2. Obtener Última Lectura

**Endpoint:** `GET /api/latest?session_id=session_xxx`

**Respuesta (si vinculado):**
```json
{
  "humedad": 45,
  "raw": 238,
  "updated_at": 1715943600,
  "connected": true,
  "error": null
}
```

**Respuesta (si NO vinculado):**
```json
{
  "humedad": null,
  "raw": null,
  "updated_at": null,
  "connected": false,
  "error": "Selecciona un sensor para ver datos"
}
```

---

### 3. Vincular Dispositivo

**Endpoint:** `POST /api/bind`

**Body:**
```json
{
  "session_id": "session_xxx",
  "device_id": "arduino-01"
}
```

**Respuesta (200 OK):**
```json
{
  "ok": true,
  "device_id": "arduino-01",
  "session_id": "session_xxx"
}
```

**Respuesta (409 Conflict):**
```json
{
  "ok": false,
  "message": "Sensor Vinculado con Otro Dispositivo"
}
```

---

### 4. Desvincular Dispositivo

**Endpoint:** `POST /api/unbind`

**Body:**
```json
{
  "session_id": "session_xxx"
}
```

**Respuesta:**
```json
{
  "ok": true
}
```

---

### 5. Listar Dispositivos Activos

**Endpoint:** `GET /devices?session_id=session_xxx`

**Respuesta:**
```json
{
  "devices": [
    {
      "device_id": "arduino-01",
      "humedad": 45,
      "rssi": -45,
      "timestamp": 1715943600,
      "available": true,
      "is_bound": false
    }
  ],
  "binding": {
    "bound_device_id": null,
    "bound_session_id": null,
    "is_bound_to_me": false,
    "is_bound_to_other": false,
    "is_free": true
  }
}
```

---

### 6. Obtener Historial

**Endpoint:** `GET /historial?session_id=session_xxx`

**Respuesta:**
```json
[
  {
    "fecha": "14:30:25",
    "humedad": 45,
    "raw": 238
  },
  {
    "fecha": "14:30:26",
    "humedad": 46,
    "raw": 243
  }
]
```

**Límite:** Últimas 200 registros (configurable)

---

### 7. Heartbeat

**Endpoint:** `POST /ping`

**Body:**
```json
{
  "session_id": "session_xxx"
}
```

**Respuesta:** Datos última lectura (con validación binding)

**Validaciones:**
- Si vinculado a otra sesión: Error 409
- Si no vinculado: Datos vacíos
- Si vinculado a esta sesión: Datos completos

---

## 🔗 Sistema de Binding de Dispositivos

### Propósito
Garantizar que **solo una sesión pueda ver datos** de un dispositivo simultáneamente. Esto previene acceso no autorizado.

### Flujo

```
1. Usuario abre navegador
   → Se genera session_id único (sessionStorage)

2. Usuario hace click "Buscar dispositivos"
   → GET /devices retorna lista de dispositivos detectados

3. Usuario selecciona dispositivo en dropdown
   → Frontend auto-vincula con POST /api/bind

4. Backend valida:
   ✓ Si dispositivo está libre → Vinculación exitosa
   ✗ Si dispositivo ya está vinculado → Error 409

5. Frontend comienza polling /api/latest cada 3 segundos
   → Validación en cada request:
      • ¿Está vinculado a MI sesión? → Devolver datos
      • ¿Está vinculado a OTRA sesión? → Error 409
      • ¿No está vinculado? → Datos vacíos

6. Timeout de 600 segundos sin actividad
   → Automáticamente desvincular
```

### Seguridad

**Niveles de Protección:**

1. **Session-scoped**: Cada pestaña/navegador tiene ID único
2. **Exclusividad**: Solo una sesión puede acceder por dispositivo
3. **Timeout**: Inactividad > 600s → Desvincculación automática
4. **Heartbeat**: Ping cada 30s mantiene viva la sesión
5. **Validación Backend**: Todo endpoint que devuelve datos valida binding

### Estados de Binding

```
is_free = true              → Dispositivo disponible
is_bound_to_me = true       → Vinculado a esta sesión
is_bound_to_other = true    → Vinculado a otra sesión
is_bound_to_other = false   → Disponible o vinculado a mi sesión
```

---

## 📊 Calibración del Sensor

### Calibración Actual
```
sensorMin = 0           # RAW en seco (aire)
sensorMax = 529         # RAW en mojado (agua)
Escala: 0-529 RAW → 0-100%
```

### Cómo Recalibrar

#### 1. Recopilar Datos de Calibración

En Serial Monitor, ver valores RAW:
```
[SENSOR] RAW=5 -> 0%       # Sensor en aire seco
[SENSOR] RAW=529 -> 100%   # Sensor en agua/mojado
```

#### 2. Actualizar Valores en Arduino

En `Arduino_WiFi_Humedad.ino`, línea ~150:
```cpp
int sensorMin = 0;    // Tu valor RAW en seco
int sensorMax = 529;  // Tu valor RAW en mojado
```

#### 3. Validar

- Toca el sensor → Debería aumentar %
- Moja el sensor → Debería llegar a ~100%
- Seca el sensor → Debería volver a 0%

#### 4. Subir a Git

```bash
git add Arduino_WiFi_Humedad.ino
git commit -m "Actualizar calibración sensor: sensorMin=X, sensorMax=Y"
git push
```

### Notas Importantes

- **Sensor capacitivo:** Mayor capacitancia = más humedad
- **Rango RAW:** 0-1023 (10-bit ADC)
- **Promedio:** Sistema promedia 10 lecturas para estabilidad
- **Sensibilidad:** Varia con material del sensor y circuitos adyacentes

---

## 🔧 Troubleshooting

### Arduino No Conecta a WiFi

**Síntoma:** `[WiFi] Error de conexion`

**Soluciones:**
1. Verificar SSID y contraseña en código
2. Validar que la red está activa
3. Comprobar que Arduino está en rango de WiFi
4. Reiniciar Arduino (presionar botón RESET)

### Arduino No Envía Datos a Vercel

**Síntoma:** `[CLOUD] envio FAIL`

**Causas Comunes:**
1. **Certificado SSL:** Red con AP Isolation bloqueando HTTPS
   - Solución: Usar servidor local como fallback (192.168.1.72:5000)
2. **DNS:** No resuelve sensor-de-humedad.vercel.app
   - Verificar: Ping al sitio desde otra máquina en red
3. **Firewall:** Red bloquea puerto 443
   - Verificar configuración del router/repetidor

**Debug:**
```cpp
// En Arduino, añadir:
Serial.println(WiFi.status());  // Debería ser 3 (WL_CONNECTED)
```

### Dashboard No Muestra Datos

**Síntoma:** Siempre muestra "--"

**Soluciones:**
1. ¿Has seleccionado dispositivo en dropdown? → Falta vinculación
2. ¿Aparece dispositivo en lista? → Verificar /devices endpoint
3. ¿Arduino está enviando datos? → Verificar Serial Monitor del Arduino
4. ¿Vercel recibió datos? → Ver logs de Vercel

**Validación:**
- Abrir DevTools (F12) → Console
- Buscar errores HTTP o de binding

### Sensor Siempre Muestra 0% o 100%

**Síntoma:** Lectura congelada en 0% o 100%

**Causas:**
1. Sensor dañado → Devuelve valores RAW constantes
2. Calibración incorrecta → sensorMax muy pequeño
3. Conexión suelta → Pin A0 flotante

**Validar:**
- Serial Monitor: Ver valores RAW reales
- Si RAW siempre 0-4: Sensor sin conexión
- Si RAW siempre 529+: Cortocircuito/calibración invertida

---

## 📝 Variables de Entorno (Vercel)

```bash
# Obligatorias para Vercel
UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=token_xxxxx

# Opcionales (con defaults)
USE_WEB_SERIAL=0
SERIAL_PORT=COM3
SERIAL_BAUD=9600
READ_INTERVAL_SEC=0.2
SAVE_INTERVAL_SEC=60
MAX_HISTORY_RECORDS=200
```

---

## 📚 Referencia de Archivos

| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| Arduino_WiFi_Humedad.ino | 193 | Firmware Arduino completo |
| backend/app.py | ~1000 | Backend Flask con todos los endpoints |
| backend/static/app.js | ~900 | Frontend logic (binding, polling, UI) |
| backend/static/style.css | ~300 | Estilos y animaciones |
| backend/templates/index.html | ~150 | Estructura HTML |
| api/index.py | 3 | Punto de entrada Vercel |
| vercel.json | ~20 | Configuración de deployment |
| requirements.txt | ~5 | Dependencias Python |

---

## 🎓 Lecciones Aprendidas

### Calibración de Sensores
- Sensores capacitivos varían según material y humedad ambiental
- Siempre medir valores min/max reales antes de mapear a %
- Promediar múltiples lecturas para estabilidad

### IoT + Cloud
- Validar binding en TODOS los endpoints que devuelven datos
- Session-scoped es más seguro que global
- Timeout de inactividad previene "zombies" de sesiones

### Vercel + Serverless
- Cada request es instancia nueva → Usar Redis para persistencia
- SQLite es local/efímero en Vercel
- Timeout máximo: 30 segundos (planificar de acuerdo)

---

## 📞 Soporte

**Para reportar problemas:**
1. Revisar Troubleshooting section
2. Revisar logs de Vercel (Vercel Dashboard)
3. Revisar Serial Monitor de Arduino
4. Revisar DevTools Console del navegador

**Información útil para debugging:**
- Valores RAW del sensor (Serial Monitor)
- URL actual del dashboard
- Mensaje de error exacto
- Pasos para reproducir

---

**Última actualización:** Mayo 2026  
**Versión:** 1.0 (Producción)  
**Estado:** ✅ Completamente Funcional

## Licencia

MIT
