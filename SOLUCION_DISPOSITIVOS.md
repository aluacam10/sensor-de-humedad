# GUÍA DE SOLUCIÓN: Buscar dispositivos no funciona

## ❌ Problema
Al presionar "Buscar dispositivos" no detecta el sensor WiFi.

## ✅ Soluciones

### OPCIÓN 1: Desarrollo Local (Recomendado para pruebas)

**Si estás usando Python localmente:**

```bash
# 1. Instala dependencias
pip install -r requirements.txt

# 2. Ejecuta Flask localmente
cd backend
python -c "from app import app; app.run(debug=True)"

# 3. Abre en el navegador:
http://localhost:5000

# 4. El Arduino debe enviar datos a:
const char API_HOST[] = "localhost";
const int API_PORT = 80;  # (no 443 para local)
```

**Ventaja:** Funciona sin Redis, detecta dispositivos instantáneamente.

---

### OPCIÓN 2: Vercel + Upstash Redis (Para Producción)

**El sensor NO se detecta sin Redis en Vercel.**

#### Paso 1: Crear Upstash Redis
1. Ve a https://upstash.com
2. Crea cuenta gratis
3. Crea una nueva BD Redis
4. Copia tu URL y token

#### Paso 2: Agregar Variables a Vercel
En vercel.com → tu proyecto → Settings → Environment Variables:

```
UPSTASH_REDIS_REST_URL = https://...upstash.io
UPSTASH_REDIS_REST_TOKEN = Axxxxx...
```

#### Paso 3: Redeploy
```bash
git add .
git commit -m "Agregar variables Upstash"
git push origin main
```

Vercel redesplegará automáticamente.

#### Paso 4: Verificar
1. Abre tu app en Vercel
2. Presiona "Buscar dispositivos"
3. Espera a que el Arduino envíe datos (cada 5 segundos)

---

## 🔍 Por qué no funciona

| Ambiente | Con Redis | Sin Redis |
|----------|-----------|-----------|
| **Local (Flask)** | ✅ Funciona | ✅ Funciona |
| **Vercel** | ✅ Funciona | ❌ NO funciona |

**Motivo:** Vercel es "serverless" - la app se reinicia con cada solicitud, perdiendo datos en memoria.

---

## 🚀 Solución Inmediata

Usa **Vercel + Upstash FREE** (incluye 10,000 comandos gratis/día):

```
UPSTASH_REDIS_REST_URL = [Tu URL]
UPSTASH_REDIS_REST_TOKEN = [Tu Token]
```

Luego presiona "Buscar dispositivos" nuevamente.

¿Estás en **Vercel o local**? Dime qué ambiente usas y te ayudo.
