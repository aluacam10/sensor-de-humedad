#include <WiFiS3.h>
#include <LiquidCrystal.h>

LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

int SensorPin = A0;
int Suelo = 0;

// 🔧 CALIBRACIÓN REAL
int seco = 10;
int mojado = 720;

// WiFi + API remota
const char WIFI_SSID[] = "ERICKHUAWEI_6080";
const char WIFI_PASS[] = "123456789";
const char API_HOST[] = "sensor-de-humedad.vercel.app";
const int API_PORT = 443;
const char API_PATH[] = "/api/ingest";

WiFiSSLClient sslClient;
bool wifiConectado = false;
int humedad = 0;
unsigned long lastSendMs = 0;
const unsigned long SEND_INTERVAL_MS = 5000;

bool enviarNube(int humedadPercent, int rawValue) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi desconectado");
    return false;
  }

  String body = "{";
  body += "\"humedad\":" + String(humedadPercent) + ",";
  body += "\"raw\":" + String(rawValue);
  body += "}";

  if (!sslClient.connect(API_HOST, API_PORT)) {
    Serial.println("[HTTP] No se pudo conectar al host");
    return false;
  }

  sslClient.print(String("POST ") + API_PATH + " HTTP/1.1\r\n");
  sslClient.print(String("Host: ") + API_HOST + "\r\n");
  sslClient.print("Content-Type: application/json\r\n");
  sslClient.print(String("Content-Length: ") + body.length() + "\r\n");
  sslClient.print("Connection: close\r\n\r\n");
  sslClient.print(body);

  unsigned long t0 = millis();
  while (!sslClient.available() && (millis() - t0 < 5000)) {
    delay(10);
  }

  String statusLine = "";
  if (sslClient.available()) {
    statusLine = sslClient.readStringUntil('\n');
    statusLine.trim();
  }

  while (sslClient.available()) {
    sslClient.read();
  }
  sslClient.stop();

  Serial.print("[HTTP] ");
  Serial.println(statusLine);
  return statusLine.startsWith("HTTP/1.1 200") || statusLine.startsWith("HTTP/1.1 201");
}

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiConectado = true;
    return;
  }

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Conectando WiFi");

  Serial.print("[WiFi] Conectando a: ");
  Serial.println(WIFI_SSID);

  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 20) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    delay(1500);
    intentos++;
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiConectado = true;
    Serial.println("[WiFi] Conectado");
    Serial.print("[WiFi] IP: ");
    Serial.println(WiFi.localIP());
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi OK");
    delay(1000);
  } else {
    wifiConectado = false;
    Serial.println("[WiFi] Error de conexion");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi FAIL");
    delay(1000);
  }

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Humedad");
}

void setup() {
  pinMode(7, OUTPUT);
  lcd.begin(16, 2);
  Serial.begin(9600);

  delay(1000);

  lcd.setCursor(0, 0);
  lcd.print("Sensor WiFi");
  lcd.setCursor(0, 1);
  lcd.print("Iniciando...");

  // Iniciar calibración
  long suma = 0;
  for (int i = 0; i < 50; i++) {
    suma += analogRead(SensorPin);
    delay(20);
  }
  int base = suma / 50;
  Serial.print("[BOOT] Base: ");
  Serial.println(base);

  conectarWiFi();

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Humedad");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    wifiConectado = false;
    conectarWiFi();
  }

  // 🔥 PROMEDIO PARA ESTABILIDAD
  int suma = 0;
  for(int i = 0; i < 10; i++){
    suma += analogRead(SensorPin);
    delay(10);
  }
  humedad = suma / 10;

  Serial.println(humedad);

  // Control original (no se toca)
  if (humedad >= 870) {
    digitalWrite(7, LOW);
  } else {
    digitalWrite(7, HIGH);
  }

  // 🔧 CALIBRACIÓN CORRECTA
  humedad = constrain(humedad, seco, mojado);
  Suelo = map(humedad, seco, mojado, 0, 100);

  // LCD
  lcd.setCursor(0, 1);
  lcd.print("      ");
  lcd.setCursor(0, 1);
  lcd.print(Suelo);
  lcd.print("%");

  if (millis() - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = millis();
    bool ok = enviarNube(Suelo, humedad);
    Serial.println(ok ? "[CLOUD] envio OK" : "[CLOUD] envio FAIL");
  }

  delay(1000);
}