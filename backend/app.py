import json
import os
import sqlite3
import threading
import time
from datetime import datetime
from urllib import parse as urlparse
from urllib import request as urlrequest

from flask import Flask, jsonify, render_template, request

try:
    import serial  # type: ignore[import-not-found]
    import serial.tools.list_ports  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - runtime dependency
    serial = None

APP_DIR = os.path.dirname(os.path.abspath(__file__))
IS_VERCEL = os.environ.get("VERCEL") == "1"
DB_PATH = os.path.join("/tmp", "database.db") if IS_VERCEL else os.path.join(APP_DIR, "database.db")

SERIAL_PORT = os.environ.get("SERIAL_PORT", "COM3")
SERIAL_BAUD = int(os.environ.get("SERIAL_BAUD", "9600"))
SERIAL_TIMEOUT = float(os.environ.get("SERIAL_TIMEOUT", "1"))
USE_WEB_SERIAL = os.environ.get("USE_WEB_SERIAL", "0") == "1"

READ_INTERVAL_SEC = float(os.environ.get("READ_INTERVAL_SEC", "0.2"))
SAVE_INTERVAL_SEC = float(os.environ.get("SAVE_INTERVAL_SEC", "60"))
MAX_HISTORY_RECORDS = int(os.environ.get("MAX_HISTORY_RECORDS", "200"))

UPSTASH_REDIS_REST_URL = (
    os.environ.get("UPSTASH_REDIS_REST_URL")
    or os.environ.get("KV_REST_API_URL")
    or os.environ.get("REDIS_REST_URL")
)
UPSTASH_REDIS_REST_TOKEN = (
    os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    or os.environ.get("KV_REST_API_TOKEN")
    or os.environ.get("REDIS_REST_API_TOKEN")
)
KV_LATEST_KEY = os.environ.get("KV_LATEST_KEY", "sensor:latest")
KV_HISTORY_KEY = os.environ.get("KV_HISTORY_KEY", "sensor:history")

state_lock = threading.Lock()
state = {
    "humidity": None,
    "raw": None,
    "updated_at": None,
    "connected": False,
    "error": None,
}

remote_lock = threading.Lock()
remote_state = {
    "device_id": None,
    "humidity": None,
    "raw": None,
    "updated_at": None,
    "online": False,
    "rssi": None,
    "error": None,
}

active_sessions = {}
sessions_lock = threading.Lock()
SESSION_TIMEOUT_SEC = 5

active_devices = {}
devices_lock = threading.Lock()
DEVICE_TIMEOUT_SEC = 120

serial_port_lock = threading.Lock()
selected_serial_port = SERIAL_PORT

force_connect_event = threading.Event()

last_saved_ts = 0.0
serial_thread = None
save_thread = None

app = Flask(__name__, static_folder="static", template_folder="templates")


def has_remote_store():
    return bool(UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN)


def remote_store_request(command_path, method="POST"):
    if not has_remote_store():
        return None

    base_url = UPSTASH_REDIS_REST_URL.rstrip("/")
    url = f"{base_url}/{command_path.lstrip('/')}"
    headers = {"Authorization": f"Bearer {UPSTASH_REDIS_REST_TOKEN}"}
    req = urlrequest.Request(url, headers=headers, method=method)

    with urlrequest.urlopen(req, timeout=5) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else None


def kv_command(command, *parts):
    encoded_parts = [urlparse.quote(str(part), safe="") for part in parts]
    command_path = "/".join([command, *encoded_parts])
    return remote_store_request(command_path)


def store_sensor_snapshot(payload):
    if not has_remote_store():
        return False

    serialized = json.dumps(payload, separators=(",", ":"))
    kv_command("set", KV_LATEST_KEY, serialized)
    kv_command("lpush", KV_HISTORY_KEY, serialized)
    kv_command("ltrim", KV_HISTORY_KEY, 0, MAX_HISTORY_RECORDS - 1)
    return True


def read_latest_snapshot():
    if has_remote_store():
        response = kv_command("get", KV_LATEST_KEY)
        if response and response.get("result"):
            try:
                payload = json.loads(response["result"])
                payload.setdefault("connected", True)
                payload.setdefault("error", None)
                return payload
            except (TypeError, ValueError):
                pass

    payload = get_latest_db_reading()
    if payload is not None:
        return payload
    return build_remote_payload()


def read_history_snapshots(limit=20):
    if has_remote_store():
        response = kv_command("lrange", KV_HISTORY_KEY, 0, max(limit - 1, 0))
        result = response.get("result") if response else None
        if isinstance(result, list):
            items = []
            for item in reversed(result):
                if not item:
                    continue
                try:
                    items.append(json.loads(item))
                except (TypeError, ValueError):
                    continue
            return items

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT humedad, fecha FROM datos ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        rows = cur.fetchall()
    data = [{"humedad": row["humedad"], "fecha": row["fecha"]} for row in rows]
    return list(reversed(data))


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS datos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                humedad INTEGER NOT NULL,
                fecha TEXT NOT NULL
            )
            """
        )
        conn.commit()


init_db()


def list_serial_ports():
    if serial is None:
        return []
    return [p.device for p in serial.tools.list_ports.comports()]


def find_arduino_port():
    """
    Busca automáticamente un puerto serial que corresponda a un Arduino.
    Retorna el dispositivo si lo encuentra, None en caso contrario.
    """
    if serial is None:
        return None
    
    # VID/PID comunes de Arduino
    ARDUINO_VID_PIDS = [
        (0x2341, 0x0043),  # Arduino Uno
        (0x2341, 0x0001),  # Arduino Uno (viejo bootloader)
        (0x2341, 0x0243),  # Arduino Uno
        (0x1A86, 0x7523),  # CH340/CH341 (clones chinos comunes)
    ]
    
    for port_info in serial.tools.list_ports.comports():
        if port_info.vid and port_info.pid:
            if (port_info.vid, port_info.pid) in ARDUINO_VID_PIDS:
                return port_info.device
    
    # Fallback: si no encuentra por VID/PID, retorna el primer puerto disponible
    ports = list_serial_ports()
    return ports[0] if ports else None


def get_selected_serial_port():
    with serial_port_lock:
        return selected_serial_port


def set_selected_serial_port(port_name):
    global selected_serial_port
    with serial_port_lock:
        selected_serial_port = port_name


def parse_humidity(value_str):
    value_str = value_str.strip()
    if not value_str:
        return None
    try:
        raw = int(value_str)
    except ValueError:
        return None
    if raw < 0 or raw > 1023:
        return None
    percent = int(round((raw / 1023.0) * 100))
    return raw, percent


def update_state(raw, percent, connected=True, error=None):
    now = time.time()
    with state_lock:
        state["raw"] = raw
        state["humidity"] = percent
        state["updated_at"] = now
        state["connected"] = connected
        state["error"] = error


def update_remote_state(device_id, humidity, raw=None, online=True, rssi=None, error=None):
    now = time.time()
    with remote_lock:
        remote_state["device_id"] = device_id
        remote_state["humidity"] = humidity
        remote_state["raw"] = raw
        remote_state["updated_at"] = now
        remote_state["online"] = online
        remote_state["rssi"] = rssi
        remote_state["error"] = error


def build_remote_payload():
    with remote_lock:
        payload = dict(remote_state)
    payload["connected"] = bool(payload.get("online"))
    return payload


def register_device(device_id, humidity, raw, rssi, online):
    """Registra un Arduino activo cada vez que envía datos."""
    now = time.time()
    with devices_lock:
        active_devices[device_id] = {
            "device_id": device_id,
            "humedad": humidity,
            "raw": raw,
            "rssi": rssi,
            "online": online,
            "updated_at": now,
        }


def get_active_devices():
    """Retorna lista de Arduinos activos (sin timeout)."""
    now = time.time()
    with devices_lock:
        expired_ids = [
            did for did, info in active_devices.items()
            if now - info.get("updated_at", 0) > DEVICE_TIMEOUT_SEC
        ]
        for did in expired_ids:
            del active_devices[did]
        return list(active_devices.values())


def get_latest_db_reading():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT humedad, fecha FROM datos ORDER BY id DESC LIMIT 1"
        )
        row = cur.fetchone()

    if not row:
        return None

    try:
        updated_at = datetime.fromisoformat(row["fecha"]).timestamp()
    except ValueError:
        updated_at = None

    return {
        "humedad": row["humedad"],
        "raw": None,
        "updated_at": updated_at,
        "connected": True,
        "error": None,
    }


def set_error(message, connected=False):
    with state_lock:
        state["connected"] = connected
        state["error"] = message


def read_serial_loop():
    # Persistent loop with auto-reconnect when the serial link drops.
    if serial is None:
        set_error("pyserial not installed", connected=False)
        return

    last_active_count = -1
    while True:
        try:
            if force_connect_event.is_set():
                force_connect_event.clear()

            # Check if there are active sessions; if not, skip reading
            with sessions_lock:
                active_count = len(active_sessions)

            if active_count == 0:
                if last_active_count != 0:
                    print(f"[serial] No active clients. Sleeping...")
                    with state_lock:
                        state["connected"] = False
                        state["error"] = None
                    last_active_count = 0
                time.sleep(2.0)
                continue

            if last_active_count != active_count:
                print(f"[serial] {active_count} active session(s). Resuming reads...")
                last_active_count = active_count

            port_list = list_serial_ports()
            current_port = get_selected_serial_port()
            selected_port = current_port if current_port in port_list else find_arduino_port()
            if not selected_port:
                set_error(
                    f"No Arduino detectado. Puerto solicitado: {current_port}",
                    connected=False,
                )
                time.sleep(2.0)
                continue

            if selected_port != current_port:
                print(f"[serial] Puerto {current_port} no encontrado, usando {selected_port}")

            print(f"[serial] Conectando a {selected_port} @ {SERIAL_BAUD}...")
            with serial.Serial(
                selected_port, SERIAL_BAUD, timeout=SERIAL_TIMEOUT
            ) as ser:
                update_state(state["raw"], state["humidity"], connected=True, error=None)
                print("[serial] Connected")
                while True:
                    if force_connect_event.is_set():
                        print("[serial] Reconnect requested")
                        break
                    line = ser.readline().decode("utf-8", errors="ignore")
                    result = parse_humidity(line)
                    if result is None:
                        if line.strip():
                            print(f"[serial] Invalid data: {line.strip()}")
                        time.sleep(READ_INTERVAL_SEC)
                        continue
                    raw, percent = result
                    update_state(raw, percent, connected=True, error=None)
                    print(f"[serial] raw={raw} humedad={percent}%")
                    time.sleep(READ_INTERVAL_SEC)
            if force_connect_event.is_set():
                force_connect_event.clear()
                continue
        except Exception as exc:
            set_error(f"Serial error: {exc}", connected=False)
            print(f"[serial] Error: {exc}")
            time.sleep(2.0)


def save_reading(humidity):
    timestamp = datetime.now().isoformat(timespec="seconds")
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO datos (humedad, fecha) VALUES (?, ?)",
            (humidity, timestamp),
        )
        # Delete old records, keep only latest MAX_HISTORY_RECORDS
        cur.execute(
            f"DELETE FROM datos WHERE id NOT IN (SELECT id FROM datos ORDER BY id DESC LIMIT ?)",
            (MAX_HISTORY_RECORDS,),
        )
        conn.commit()


def save_loop():
    # Periodic persistence to avoid hammering SQLite on every read.
    global last_saved_ts
    while True:
        now = time.time()
        with state_lock:
            humidity = state["humidity"]
            updated_at = state["updated_at"] or 0.0
        if humidity is not None and updated_at > last_saved_ts:
            if now - last_saved_ts >= SAVE_INTERVAL_SEC:
                save_reading(humidity)
                last_saved_ts = now
                print(f"[db] Saved humedad={humidity}%")
        time.sleep(1.0)


def cleanup_sessions():
    # Remove inactive sessions older than SESSION_TIMEOUT_SEC
    while True:
        time.sleep(5.0)
        now = time.time()
        with sessions_lock:
            expired = [sid for sid, ts in active_sessions.items() if now - ts > SESSION_TIMEOUT_SEC]
            for sid in expired:
                del active_sessions[sid]
            if expired:
                print(f"[sessions] Cleaned up {len(expired)} inactive sessions")


def ensure_backend_serial_started():
    global serial_thread, save_thread
    if serial is None:
        return False, "pyserial not installed"

    if serial_thread is None or not serial_thread.is_alive():
        serial_thread = threading.Thread(target=read_serial_loop, daemon=True)
        serial_thread.start()

    if save_thread is None or not save_thread.is_alive():
        save_thread = threading.Thread(target=save_loop, daemon=True)
        save_thread.start()

    return True, None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/humedad")
def humedad():
    with state_lock:
        payload = {
            "humedad": state["humidity"],
            "raw": state["raw"],
            "updated_at": state["updated_at"],
            "connected": state["connected"],
            "error": state["error"],
        }
    return jsonify(payload)


@app.route("/api/latest")
def api_latest():
    return jsonify(read_latest_snapshot())


@app.route("/config")
def config():
    return jsonify(
        {
            "use_web_serial": USE_WEB_SERIAL,
            "pyserial_available": serial is not None,
            "serial_port": SERIAL_PORT,
            "serial_baud": SERIAL_BAUD,
            "ports": list_serial_ports(),
        }
    )


@app.route("/ping", methods=["POST"])
def ping():
    session_id = request.form.get("session_id", "") or (request.get_json(silent=True) or {}).get("session_id", "")
    if not session_id:
        session_id = f"anon_{int(time.time() * 1000)}"
    with sessions_lock:
        active_sessions[session_id] = time.time()
    print(f"[ping] Session {session_id} active (total: {len(active_sessions)})")
    with state_lock:
        payload = {
            "humedad": state["humidity"],
            "raw": state["raw"],
            "updated_at": state["updated_at"],
            "connected": state["connected"],
            "error": state["error"],
            "session_id": session_id,
        }
    return jsonify(payload)


@app.route("/disconnect", methods=["POST"])
def disconnect():
    session_id = request.form.get("session_id", "") or (request.get_json(silent=True) or {}).get("session_id", "")
    if session_id:
        with sessions_lock:
            if session_id in active_sessions:
                del active_sessions[session_id]
                print(f"[disconnect] Session {session_id} removed (remaining: {len(active_sessions)})")
            else:
                print(f"[disconnect] Session {session_id} not found")
    return jsonify({"ok": True})


@app.route("/historial")
def historial():
    limit = int(request.args.get("limit", "20"))
    return jsonify(read_history_snapshots(limit))


@app.route("/devices")
def devices():
    """Retorna lista de Arduinos WiFi activos detectados."""
    active = get_active_devices()
    return jsonify({
        "devices": active,
        "count": len(active),
        "timestamp": time.time()
    })


@app.route("/api/ingest", methods=["POST"])
@app.route("/guardar", methods=["POST"])
def guardar():
    payload = request.get_json(silent=True) or {}
    device_id = payload.get("device_id") or "arduino-01"
    humidity = payload.get("humedad")
    raw = payload.get("raw")
    online = payload.get("online", True)
    rssi = payload.get("rssi")
    if humidity is None:
        with state_lock:
            humidity = state["humidity"]
            raw = state["raw"]
    try:
        humidity = int(humidity)
    except (TypeError, ValueError):
        return jsonify({"ok": False, "message": "Invalid humidity"}), 400
    if humidity < 0 or humidity > 100:
        return jsonify({"ok": False, "message": "Out of range"}), 400
    snapshot = {
        "device_id": device_id,
        "humedad": humidity,
        "raw": raw,
        "updated_at": time.time(),
        "connected": bool(online),
        "online": bool(online),
        "rssi": rssi,
        "error": None,
    }
    update_state(raw, humidity, connected=True, error=None)
    update_remote_state(device_id, humidity, raw=raw, online=bool(online), rssi=rssi, error=None)
    register_device(device_id, humidity, raw, rssi, bool(online))
    if has_remote_store():
        store_sensor_snapshot(snapshot)
    try:
        save_reading(humidity)
    except Exception as exc:
        # En serverless puede fallar el almacenamiento local; no bloquea la lectura actual.
        print(f"[db] Save skipped: {exc}")
    return jsonify({"ok": True, "device_id": device_id})


@app.route("/borrar_historial", methods=["POST"])
def borrar_historial():
    if has_remote_store():
        kv_command("del", KV_LATEST_KEY, KV_HISTORY_KEY)
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM datos")
        conn.commit()
    return jsonify({"ok": True})


@app.route("/conectar", methods=["POST"])
def conectar():
    ok_start, start_msg = ensure_backend_serial_started()
    if not ok_start:
        return jsonify({"ok": False, "message": start_msg}), 500
    payload = request.get_json(silent=True) or {}
    requested_port = (payload.get("port") or request.form.get("port", "") or "").strip()
    ports = list_serial_ports()
    
    # Prioridad: puerto solicitado > detectar Arduino automáticamente > puerto por defecto > primer puerto
    if requested_port:
        selected_port = requested_port
    else:
        arduino_port = find_arduino_port()
        selected_port = arduino_port or (SERIAL_PORT if SERIAL_PORT in ports else (ports[0] if ports else None))
    
    ok = selected_port is not None
    if not ok:
        set_error(
            f"No Arduino detectado. Puertos disponibles: {ports}",
            connected=False,
        )
        return jsonify({"ok": False, "message": "No Arduino detectado", "ports": ports})

    set_selected_serial_port(selected_port)
    force_connect_event.set()
    update_state(state["raw"], state["humidity"], connected=False, error=None)

    return jsonify(
        {
            "ok": True,
            "port": selected_port,
            "preferred_port": SERIAL_PORT,
            "ports": ports,
            "requested_port": requested_port or None,
        }
    )


if __name__ == "__main__":
    init_db()
    if not USE_WEB_SERIAL:
        ensure_backend_serial_started()
        threading.Thread(target=cleanup_sessions, daemon=True).start()
    app.run(host="0.0.0.0", port=5000, debug=True)
