# Sensor de Humedad WiFi

Sistema de monitoreo de humedad con Arduino WiFi S3, Flask y Vercel.

## Estructura del Proyecto

```
├── Arduino_WiFi_Humedad.ino      # Código Arduino para el sensor
├── api/
│   └── index.py                  # Punto de entrada de Vercel
├── backend/
│   ├── app.py                    # Aplicación Flask
│   ├── static/                   # Archivos estáticos (CSS, JS)
│   └── templates/                # Plantillas HTML
├── requirements.txt              # Dependencias Python
├── vercel.json                   # Configuración de Vercel
└── .env.example                  # Variables de entorno ejemplo
```

## Instalación Local

1. **Clone el repositorio**
```bash
git clone <repo-url>
cd "Sensor de Humedad"
```

2. **Cree un entorno virtual**
```bash
python -m venv venv
source venv/bin/activate  # En Windows: venv\Scripts\activate
```

3. **Instale las dependencias**
```bash
pip install -r requirements.txt
```

4. **Configure las variables de entorno**
```bash
cp .env.example .env
# Edite .env con sus datos
```

5. **Ejecute la aplicación**
```bash
python -m flask --app backend.app run
```

## Despliegue en Vercel

### Prerequisitos
- Cuenta en [Vercel](https://vercel.com)
- Repositorio en GitHub
- (Opcional) Cuenta en [Upstash](https://upstash.com) para Redis

### Pasos

1. **Push a GitHub**
```bash
git add .
git commit -m "Preparado para Vercel"
git push origin main
```

2. **Conecte a Vercel**
   - Ve a vercel.com
   - Click en "New Project"
   - Selecciona tu repositorio de GitHub
   - Click en "Import"

3. **Configure Variables de Entorno en Vercel**
   - En la interfaz de Vercel, ve a "Settings" → "Environment Variables"
   - Agrega estas variables:
     - `UPSTASH_REDIS_REST_URL`: Tu URL de Redis (Upstash)
     - `UPSTASH_REDIS_REST_TOKEN`: Tu token de Redis
     - `USE_WEB_SERIAL`: `1` (activar interfaz web)

4. **Deploy**
   - Click en "Deploy"

## Características

- ✅ Lectura de sensor de humedad en tiempo real
- ✅ Display LCD de 16x2
- ✅ Conexión WiFi con Arduino WiFi S3
- ✅ Almacenamiento en la nube (Upstash Redis)
- ✅ API REST para datos
- ✅ Dashboard web interactivo
- ✅ Historial de datos

## API Endpoints

- `GET /` - Dashboard principal
- `GET /api` - Datos del sensor (JSON)
- `POST /api/ingest` - Recibe datos del Arduino

## Variables de Entorno

Ver `.env.example` para la lista completa de configuraciones.

## Licencia

MIT
