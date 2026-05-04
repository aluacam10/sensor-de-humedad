const humidityValue = document.getElementById("humidity-value");
const humidityState = document.getElementById("humidity-state");
const waterFill = document.getElementById("water-fill");
const lastUpdated = document.getElementById("last-updated");
const statusPill = document.getElementById("status-pill");
const errorBox = document.getElementById("error-box");
const historyPanel = document.getElementById("history-panel");
const toggleHistoryBtn = document.getElementById("toggle-history");
const clearHistoryBtn = document.getElementById("clear-history");
const connectBtn = document.getElementById("connect-arduino");
const serialPortInput = document.getElementById("serial-port-input");
const serialPortList = document.getElementById("serial-port-list");
const refreshPortsBtn = document.getElementById("refresh-ports");
const deviceSelector = document.getElementById("device-selector");
const deviceSelectorSection = document.getElementById("device-selector-section");
const refreshDevicesBtn = document.getElementById("refresh-devices");
const bindDeviceBtn = document.getElementById("bind-device");
const unbindDeviceBtn = document.getElementById("unbind-device");
const bindingStatus = document.getElementById("binding-status");

let historyChart = null;
let historyVisible = false;
let port = null;
let reader = null;
let isReading = false;
let lastSaveAt = 0;
let mode = "web";
let backendPollingId = null;
let cloudPollingId = null;
let sessionId = null;
let pingIntervalId = null;
let cachedPorts = [];
let backendConnected = false;
let cloudMode = false;
let selectedDeviceId = null;
let bindingHeartbeatId = null;
let lastUserActivityAt = Date.now();
const SAVE_INTERVAL_MS = 10000;
const PING_INTERVAL_MS = 30000;
const BINDING_HEARTBEAT_MS = 30000;
const BINDING_INACTIVITY_MS = 600000;

function createSessionId() {
  try {
    if (window.crypto?.randomUUID) {
      return `session_${window.crypto.randomUUID()}`;
    }
  } catch (err) {
    console.warn("[session] crypto randomUUID unavailable", err);
  }
  return `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getOrCreateSessionId() {
  const storageKey = "sensor-humedad-session-id";
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }
  const generated = createSessionId();
  // Session-scoped ID: cada pestana/navegador obtiene una sesion independiente.
  window.sessionStorage.setItem(storageKey, generated);
  // Limpia cualquier ID persistido por versiones anteriores para evitar reuso entre aperturas.
  try {
    window.localStorage.removeItem(storageKey);
  } catch (err) {
    console.warn("[session] localStorage cleanup unavailable", err);
  }
  return generated;
}

sessionId = getOrCreateSessionId();

function formatTime(ts) {
  if (!ts) return "Sin datos";
  const date = new Date(ts * 1000);
  return `Ultima lectura: ${date.toLocaleTimeString()}`;
}

function classifyHumidity(value) {
  if (value === null || value === undefined) return { label: "--", color: "#90a4b7" };
  if (value < 30) return { label: "SECO", color: "#ff7043" };
  if (value <= 70) return { label: "OPTIMO", color: "#66bb6a" };
  return { label: "HUMEDO", color: "#42a5f5" };
}

function updateUI(data) {
  if (!data) return;
  const value = data.humedad;
  const status = classifyHumidity(value);

  humidityValue.textContent = value !== null ? value : "--";
  humidityState.textContent = status.label;
  humidityState.style.color = status.color;

  const fillValue = value !== null ? value : 0;
  waterFill.style.transform = `translate(0, ${100 - fillValue}%)`;
  const waterPalette = getWaterPalette(value);
  waterFill.style.background = waterPalette.front;
  const ring = document.getElementById("water-ring");
  if (ring) {
    ring.style.setProperty("--water-color", waterPalette.front);
    ring.style.setProperty("--water-back", waterPalette.back);
  }

  lastUpdated.textContent = formatTime(data.updated_at);

  if (data.connected) {
    statusPill.textContent = "Conectado";
    statusPill.style.color = "#4dd0e1";
  } else {
    statusPill.textContent = "Desconectado";
    statusPill.style.color = "#ffb74d";
  }

  if (data.error) {
    errorBox.textContent = data.error;
  } else {
    errorBox.textContent = "";
  }
}

function setConnected(connected) {
  if (connected) {
    statusPill.textContent = "Conectado";
    statusPill.style.color = "#4dd0e1";
    connectBtn.textContent = cloudMode ? "Actualizar lectura" : "Desconectar";
  } else {
    statusPill.textContent = cloudMode ? "Sin datos" : "Desconectado";
    statusPill.style.color = cloudMode ? "#4dd0e1" : "#ffb74d";
    connectBtn.textContent = cloudMode ? "Actualizar lectura" : "Conectar Sensor";
  }
}

function getWaterPalette(value) {
  if (value === null || value === undefined) {
    return { front: "#4dd0e1", back: "#c7eeff" };
  }
  if (value < 30) {
    return { front: "#ef4444", back: "#fecaca" };
  }
  if (value <= 70) {
    return { front: "#facc15", back: "#fef3c7" };
  }
  return { front: "#22c55e", back: "#bbf7d0" };
}

function renderSerialPorts(ports, preferredPort) {
  cachedPorts = Array.isArray(ports) ? ports : [];
  if (serialPortList) {
    serialPortList.innerHTML = "";
    cachedPorts.forEach((portName) => {
      const option = document.createElement("option");
      option.value = portName;
      serialPortList.appendChild(option);
    });
  }
  if (serialPortInput) {
    const preferred = cachedPorts.includes("COM12") ? "COM12" : preferredPort;
    if (!serialPortInput.value && preferred) {
      serialPortInput.value = preferred;
    }
    if (!serialPortInput.value && cachedPorts.length > 0) {
      serialPortInput.value = cachedPorts[0];
    }
  }
}

function getRequestedSerialPort() {
  const value = serialPortInput?.value?.trim();
  return value || null;
}

function shouldUseBackendMode() {
  return mode === "backend" || backendConnected;
}

async function fetchHistory() {
  try {
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
    const response = await fetch(`/historial${query}`);
    const data = await response.json();
    console.log("[historial]", data);
    updateChart(data);
  } catch (err) {
    console.error("[historial] error", err);
  }
}

async function clearHistory() {
  try {
    const response = await fetch("/borrar_historial", { method: "POST" });
    const data = await response.json();
    console.log("[borrar_historial]", data);
    if (data.ok) {
      updateChart([]);
    }
  } catch (err) {
    console.error("[borrar_historial] error", err);
  }
}

function lineBreakTransformer() {
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach((line) => controller.enqueue(line));
    },
    flush(controller) {
      if (buffer) controller.enqueue(buffer);
    },
  });
}

function parseReading(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
  const numbers = parts
    .map((part) => Number.parseFloat(part))
    .filter((value) => !Number.isNaN(value));

  if (numbers.length === 0) return null;

  if (numbers.length >= 2) {
    const raw = Math.round(numbers[0]);
    const percent = Math.round(numbers[1]);
    if (percent >= 0 && percent <= 100) {
      return { raw, percent };
    }
  }

  const value = Math.round(numbers[0]);
  if (value >= 0 && value <= 100) {
    return { raw: null, percent: value };
  }
  if (value >= 0 && value <= 1023) {
    return { raw: value, percent: Math.round((value / 1023) * 100) };
  }
  return null;
}

async function saveReading(humedad, raw) {
  const now = Date.now();
  if (now - lastSaveAt < SAVE_INTERVAL_MS) return;
  lastSaveAt = now;
  try {
    await fetch("/guardar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humedad, raw }),
    });
  } catch (err) {
    console.error("[guardar] error", err);
  }
}

async function startReading() {
  if (!port) return;
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  const stream = textDecoder.readable.pipeThrough(lineBreakTransformer());
  reader = stream.getReader();
  isReading = true;

  try {
    while (isReading) {
      const { value, done } = await reader.read();
      if (done) break;
      const reading = parseReading(value || "");
      if (!reading) continue;
      const humedad = reading.percent;
      const raw = reading.raw;
      const data = {
        humedad,
        raw,
        updated_at: Date.now() / 1000,
        connected: true,
        error: null,
      };
      updateUI(data);
      saveReading(humedad, raw);
    }
  } catch (err) {
    console.error("[serial] error", err);
    errorBox.textContent = "Error leyendo el puerto";
  } finally {
    reader?.releaseLock();
    await readableStreamClosed.catch(() => undefined);
  }
}

async function fetchCurrentReading() {
  try {
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
    const response = await fetch(`/api/latest${query}`);
    const data = await response.json();
    updateUI(data);
  } catch (err) {
    console.error("[api/latest] error", err);
  }
}

function setBindingMessage(message, isError = false) {
  if (!bindingStatus) return;
  bindingStatus.textContent = message || "";
  bindingStatus.dataset.state = isError ? "error" : "ok";
}

async function refreshBindingStatus() {
  try {
    const response = await fetch(`/api/binding/status${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`);
    const data = await response.json();
    if (data.bound_device_id) {
      selectedDeviceId = data.bound_device_id;
      if (deviceSelector) {
        deviceSelector.value = data.bound_device_id;
      }
      setBindingMessage(
        data.is_bound_to_me ? `Sensor vinculado a ${data.bound_device_id}` : "Sensor Vinculado con Otro Dispositivo",
        !data.is_bound_to_me,
      );
    } else {
      setBindingMessage("Sensor libre");
    }
    syncBindingButtons(data);
    return data;
  } catch (err) {
    console.error("[binding/status] error", err);
    return null;
  }
}

function syncBindingButtons(bindingData = {}) {
  const hasSelection = !!selectedDeviceId;
  const isMine = bindingData.is_bound_to_me || false;
  const isOther = bindingData.is_bound_to_other || false;
  const isFree = bindingData.is_free !== false;

  if (bindDeviceBtn) {
    bindDeviceBtn.style.display = hasSelection ? "inline-flex" : "none";
    bindDeviceBtn.disabled = !hasSelection || isOther || !isFree;
    bindDeviceBtn.textContent = "Vincular";
  }

  if (unbindDeviceBtn) {
    unbindDeviceBtn.style.display = isMine ? "inline-flex" : "none";
  }
}

function trackUserActivity() {
  lastUserActivityAt = Date.now();
}

function registerActivityListeners() {
  ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "input", "change"].forEach((eventName) => {
    document.addEventListener(eventName, trackUserActivity, { passive: true });
  });
}

function startBindingHeartbeat() {
  if (bindingHeartbeatId) return;
  bindingHeartbeatId = setInterval(async () => {
    if (!sessionId) return;
    if (Date.now() - lastUserActivityAt > BINDING_INACTIVITY_MS) {
      await unbindSelectedDevice(true);
      return;
    }
    try {
      await fetch("/api/binding/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch (err) {
      console.warn("[binding/heartbeat] error", err);
    }
  }, BINDING_HEARTBEAT_MS);
}

function stopBindingHeartbeat() {
  if (!bindingHeartbeatId) return;
  clearInterval(bindingHeartbeatId);
  bindingHeartbeatId = null;
}

async function bindSelectedDevice() {
  if (!sessionId || !selectedDeviceId) return;
  try {
    const response = await fetch("/api/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, device_id: selectedDeviceId }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setBindingMessage(data.message || "Sensor Vinculado con Otro Dispositivo", true);
      syncBindingButtons({ is_bound_to_me: false, is_bound_to_other: true });
      return;
    }
    setBindingMessage(`Sensor vinculado a ${selectedDeviceId}`);
    await refreshBindingStatus();
    await loadActiveDevices();
  } catch (err) {
    console.error("[bind] error", err);
    setBindingMessage("No se pudo vincular el sensor", true);
  }
}

async function unbindSelectedDevice(fromInactivity = false) {
  if (!sessionId) return;
  try {
    const response = await fetch("/api/unbind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      if (!fromInactivity) {
        setBindingMessage(data.message || "No se pudo desvincular", true);
      }
      return;
    }
    selectedDeviceId = null;
    if (deviceSelector) {
      deviceSelector.value = "";
    }
    setBindingMessage("Sensor desvinculado");
    await refreshBindingStatus();
    await loadActiveDevices();
  } catch (err) {
    console.error("[unbind] error", err);
    if (!fromInactivity) {
      setBindingMessage("No se pudo desvincular el sensor", true);
    }
  }
}

function startBackendPolling() {
  if (backendPollingId) return;
  fetchCurrentReading();
  backendPollingId = setInterval(fetchCurrentReading, 1000);
}

function stopBackendPolling() {
  if (!backendPollingId) return;
  clearInterval(backendPollingId);
  backendPollingId = null;
}

async function connectViaBackend() {
  if (backendConnected) {
    await disconnectArduino();
    return;
  }

  try {
    if (connectBtn) {
      connectBtn.disabled = true;
      connectBtn.textContent = "Conectando...";
    }
    const requestedPort = getRequestedSerialPort();
    errorBox.textContent = requestedPort
      ? `Conectando por servidor en ${requestedPort}...`
      : "Buscando Arduino automáticamente...";
    
    const payload = {};
    if (requestedPort) {
      payload.port = requestedPort;
    }
    
    const response = await fetch("/conectar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    console.log("[conectar] response:", data);
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "No se pudo conectar al Arduino");
    }
    renderSerialPorts(data.ports || cachedPorts, data.port || data.preferred_port || requestedPort);
    backendConnected = true;
    setConnected(true);
    errorBox.textContent = `Conectado en ${data.port}. Leyendo datos...`;
    startBackendPolling();
  } catch (err) {
    console.error("[backend-serial] connect", err);
    errorBox.textContent = err?.message || "No se pudo conectar al Arduino";
    backendConnected = false;
    setConnected(false);
    stopBackendPolling();
  } finally {
    if (connectBtn) connectBtn.disabled = false;
  }
}

async function loadActiveDevices() {
  try {
    const url = `/devices${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`;
    console.log(`[loadActiveDevices-DEBUG] Fetching ${url} with sessionId=${sessionId}`);
    const response = await fetch(url);
    const data = await response.json();
    console.log(`[loadActiveDevices-DEBUG] Response data:`, data);
    const devices = data.devices || [];
    const bindingData = data.binding || {};

    if (deviceSelector) {
      deviceSelector.innerHTML = "";

      if (devices.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "-- No hay dispositivos detectados --";
        deviceSelector.appendChild(option);
      } else {
        const autoOption = document.createElement("option");
        autoOption.value = "";
        autoOption.textContent = "-- Selecciona un sensor --";
        deviceSelector.appendChild(autoOption);

        devices.forEach((device) => {
          const option = document.createElement("option");
          option.value = device.device_id;
          const rssiStr = device.rssi ? ` (${device.rssi}dBm)` : "";
          const boundLabel = device.is_bound ? " [Vinculado]" : device.available ? " [Libre]" : " [Ocupado]";
          option.textContent = `${device.device_id}: ${device.humedad}%${rssiStr}${boundLabel}`;
          deviceSelector.appendChild(option);
        });
      }

      if (bindingData.is_bound_to_me && bindingData.bound_device_id) {
        deviceSelector.value = bindingData.bound_device_id;
        selectedDeviceId = bindingData.bound_device_id;
      } else {
        deviceSelector.value = "";
        if (!bindingData.is_bound_to_other) {
          selectedDeviceId = null;
        }
      }
    }

    if (errorBox && devices.length > 0) {
      errorBox.textContent = `${devices.length} dispositivo(s) detectado(s).`;
    }
    if (bindingData.bound_device_id) {
      setBindingMessage(
        bindingData.is_bound_to_me ? `Sensor vinculado a ${bindingData.bound_device_id}` : "Sensor Vinculado con Otro Dispositivo",
        !bindingData.is_bound_to_me,
      );
    } else {
      setBindingMessage("Sensor libre");
    }
    syncBindingButtons(bindingData);
  } catch (err) {
    console.error("[loadActiveDevices] error", err);
    if (errorBox) {
      errorBox.textContent = "Error cargando dispositivos.";
    }
  }
}

function onDeviceSelected(event) {
  selectedDeviceId = event.target.value || null;
  console.log("[device-selector] selected:", selectedDeviceId);
  if (selectedDeviceId && errorBox) {
    errorBox.textContent = `Dispositivo seleccionado: ${selectedDeviceId}`;
  }
  syncBindingButtons();
}

async function refreshDevices() {
  if (refreshDevicesBtn) {
    refreshDevicesBtn.disabled = true;
    refreshDevicesBtn.textContent = "Buscando...";
  }
  await loadActiveDevices();
  if (refreshDevicesBtn) {
    refreshDevicesBtn.disabled = false;
    refreshDevicesBtn.textContent = "Buscar dispositivos";
  }
}

function setCloudModeUI() {
  cloudMode = true;
  const portRow = document.getElementById("serial-controls") || serialPortInput?.closest(".port-row");
  if (portRow) {
    portRow.style.display = "none";
  }
  const selectorSection = document.getElementById("device-selector-section");
  if (selectorSection) {
    selectorSection.style.display = "grid";
  }
  if (bindDeviceBtn) {
    bindDeviceBtn.style.display = "inline-flex";
  }
  if (unbindDeviceBtn) {
    unbindDeviceBtn.style.display = "inline-flex";
  }
  if (connectBtn) {
    connectBtn.textContent = "Actualizar lectura";
  }
  if (errorBox) {
    errorBox.textContent = "Modo WiFi activo: buscando dispositivos...";
  }
}

function startCloudPolling() {
  if (cloudPollingId) return;
  fetchCurrentReading();
  cloudPollingId = setInterval(fetchCurrentReading, 3000);
}

function stopCloudPolling() {
  if (!cloudPollingId) return;
  clearInterval(cloudPollingId);
  cloudPollingId = null;
}

async function disconnectArduino() {
  if (cloudMode) {
    stopCloudPolling();
    stopBindingHeartbeat();
    return;
  }

  isReading = false;
  try {
    await reader?.cancel();
  } catch (err) {
    console.warn("[serial] cancel", err);
  }
  try {
    await port?.close();
  } catch (err) {
    console.warn("[serial] close", err);
  }
  port = null;

  // Notificar al backend que se desconecta esta sesión
  if (sessionId) {
    try {
      console.log("[disconnect] Notificando servidor, session:", sessionId);
      const response = await fetch("/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await response.json();
      console.log("[disconnect] respuesta:", data);
    } catch (err) {
      console.warn("[disconnect] error", err);
    }
  }

  backendConnected = false;
  stopBackendPolling();
  stopBindingHeartbeat();
  setConnected(false);
  errorBox.textContent = "Desconectado.";
  console.log("[disconnect] Completo");
}

async function connectArduino() {
  if (cloudMode) {
    await fetchCurrentReading();
    return;
  }

  if (backendConnected) {
    await disconnectArduino();
    return;
  }

  if (shouldUseBackendMode()) {
    mode = "backend";
    await connectViaBackend();
    return;
  }

  if (!navigator.serial) {
    mode = "backend";
    await connectViaBackend();
    return;
  }

  if (port) {
    await disconnectArduino();
    return;
  }

  // Feedback inmediato para móviles: deshabilitar el botón mientras se solicita el puerto
  try {
    if (connectBtn) {
      connectBtn.disabled = true;
      connectBtn.textContent = "Conectando...";
    }

    errorBox.textContent = "Selecciona el Sensor en el selector...";
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    setConnected(true);
    errorBox.textContent = "Conectado. Leyendo datos...";
    startReading();
  } catch (err) {
    console.error("[serial] connect", err);
    errorBox.textContent = "No se pudo abrir el puerto";
    await disconnectArduino();
  } finally {
    if (connectBtn) {
      connectBtn.disabled = false;
      // si quedó conectado, el texto lo ajusta setConnected(); si no, restauramos
      if (!port) connectBtn.textContent = "Conectar Sensor";
    }
  }
}

async function initMode() {
  try {
    const response = await fetch("/config");
    const data = await response.json();
    const webSerialAvailable = !!navigator.serial;
    renderSerialPorts(data.ports || [], data.serial_port);

    if (data && data.use_web_serial === false) {
      mode = "cloud";
      setCloudModeUI();
      startCloudPolling();
      startBindingHeartbeat();
      registerActivityListeners();
      await loadActiveDevices();
      return;
    }

    // Si no hay Web Serial en el navegador, usamos backend automáticamente.
    if (!webSerialAvailable) {
      mode = "backend";
      errorBox.textContent = "Tu navegador no soporta Web Serial. Se usara conexion por servidor.";
      startBindingHeartbeat();
      registerActivityListeners();
      await loadActiveDevices();
      return;
    }

    // Si el backend indica que no se debe usar Web Serial, respetamos ese modo.
    if (data && data.use_web_serial === false) {
      mode = "backend";
      errorBox.textContent = "Modo servidor activo.";
      startBindingHeartbeat();
      registerActivityListeners();
      await loadActiveDevices();
      return;
    }

    mode = "web";
    startBindingHeartbeat();
    registerActivityListeners();
    await loadActiveDevices();
  } catch (err) {
    console.warn("[config] error", err);
    // Si falla config, usamos deteccion basica de navegador.
    mode = navigator.serial ? "web" : "backend";
    startBindingHeartbeat();
    registerActivityListeners();
    await loadActiveDevices();
  }
}

function updateChart(points) {
  const labels = points.map((p) => p.fecha);
  const values = points.map((p) => p.humedad);

  if (!historyChart) {
    const ctx = document.getElementById("history-chart").getContext("2d");
    historyChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Humedad",
            data: values,
            borderColor: "#4dd0e1",
            backgroundColor: "rgba(77, 208, 225, 0.2)",
            tension: 0.35,
            fill: true,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: "#90a4b7" },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
          },
          y: {
            ticks: { color: "#90a4b7" },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
            min: 0,
            max: 100,
          },
        },
      },
    });
    return;
  }

  historyChart.data.labels = labels;
  historyChart.data.datasets[0].data = values;
  historyChart.update();
}

function toggleHistory() {
  historyVisible = !historyVisible;
  historyPanel.classList.toggle("show", historyVisible);
  toggleHistoryBtn.textContent = historyVisible ? "Ocultar historial" : "Mostrar historial";
  if (historyVisible) {
    fetchHistory();
  }
}

function startAutoRefresh() {
  fetchHistory();
  setInterval(() => {
    if (historyVisible) {
      fetchHistory();
    }
  }, 2000);
}

async function sendPing() {
  try {
    const response = await fetch("/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const data = await response.json();
    if (data.session_id && !sessionId) {
      sessionId = data.session_id;
      console.log("[ping] Session ID:", sessionId);
    }
    updateUI(data);
  } catch (err) {
    console.error("[ping] error", err);
  }
}

function startPingLoop() {
  if (pingIntervalId) return;
  sendPing();
  pingIntervalId = setInterval(sendPing, PING_INTERVAL_MS);
}

function stopPingLoop() {
  if (!pingIntervalId) return;
  clearInterval(pingIntervalId);
  pingIntervalId = null;
}

if (toggleHistoryBtn) toggleHistoryBtn.addEventListener("click", toggleHistory);
if (clearHistoryBtn) clearHistoryBtn.addEventListener("click", clearHistory);
if (refreshPortsBtn) {
  refreshPortsBtn.addEventListener("click", async () => {
    try {
      refreshPortsBtn.disabled = true;
      const response = await fetch("/config");
      const data = await response.json();
      renderSerialPorts(data.ports || [], data.serial_port);
      errorBox.textContent = cachedPorts.length > 0
        ? `Puertos detectados: ${cachedPorts.join(", ")}`
        : "No se detectaron puertos seriales.";
    } catch (err) {
      console.error("[ports] refresh error", err);
      errorBox.textContent = "No se pudo actualizar la lista de puertos";
    } finally {
      refreshPortsBtn.disabled = false;
    }
  });
}
if (connectBtn) {
  connectBtn.addEventListener("click", connectArduino);
  // Algunos navegadores móviles responden mejor a eventos táctiles explícitos
  connectBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    connectArduino();
  });
}

if (deviceSelector) {
  deviceSelector.addEventListener("change", onDeviceSelected);
}

if (refreshDevicesBtn) {
  refreshDevicesBtn.addEventListener("click", refreshDevices);
}

if (bindDeviceBtn) {
  bindDeviceBtn.addEventListener("click", bindSelectedDevice);
}

if (unbindDeviceBtn) {
  unbindDeviceBtn.addEventListener("click", () => unbindSelectedDevice(false));
}

// Detectar cuando el usuario cierra/oculta la pestaña y desconectar
async function handlePageLeave() {
  console.log("[app] Page leaving or hidden, disconnecting...");
  stopCloudPolling();
  stopPingLoop();
  await disconnectArduino();
  console.log("[app] Page leaving, disconnected");
}

document.addEventListener("visibilitychange", () => {
  console.log("[app] visibilitychange event:", document.hidden ? "HIDDEN" : "VISIBLE");
  if (document.hidden) {
    handlePageLeave();
  }
});

window.addEventListener("beforeunload", () => {
  console.log("[app] beforeunload event");
  handlePageLeave();
});

window.addEventListener("pagehide", () => {
  console.log("[app] pagehide event");
  handlePageLeave();
});

setConnected(false);
initMode();
startPingLoop();
startAutoRefresh();
