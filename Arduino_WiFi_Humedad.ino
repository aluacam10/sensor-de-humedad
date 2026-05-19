#include <WiFiS3.h>
#include <LiquidCrystal.h>

LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

int SensorPin = A0;
int Suelo = 0;

// 🔧 CALIBRACIÓN REAL
const uint16_t seco = 900;      // Valor en seco (aire)
const uint16_t mojado = 200;    // Valor en agua/muy húmedo

// WiFi + API remota (Vercel)
const char WIFI_SSID[] = "ERICKHUAWEI_6080";
const char WIFI_PASS[] = "123456789";
const char API_HOST[] = "sensor-de-humedad.vercel.app";  // URL de Vercel
const int API_PORT = 443;  // HTTPS
const char API_PATH[] = "/api/ingest";

WiFiSSLClient client;  // HTTPS
bool wifiConectado = false;
int humedad = 0;
unsigned long lastSendMs = 0;
const unsigned long SEND_INTERVAL_MS = 5000;

bool enviarNube(int humedadPercent, int rawValue) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi desconectado");
    return false;
  }

  Serial.print("[HTTP] Conectando a ");
  Serial.print(API_HOST);
  Serial.print(":");
  Serial.println(API_PORT);

  String body = "{";
  body += "\"device_id\":\"arduino-01\",";
  body += "\"humedad\":" + String(humedadPercent) + ",";
  body += "\"raw\":" + String(rawValue);
  body += "}";

  if (!client.connect(API_HOST, API_PORT)) {
    Serial.println("[HTTP] No se pudo conectar al host");
    return false;
  }

  Serial.println("[HTTP] Conectado, enviando...");
  client.print(String("POST ") + API_PATH + " HTTP/1.1\r\n");
  client.print(String("Host: ") + API_HOST + "\r\n");
  client.print("Content-Type: application/json\r\n");
  client.print(String("Content-Length: ") + body.length() + "\r\n");
  client.print("Connection: close\r\n\r\n");
  client.print(body);

  unsigned long t0 = millis();
  while (!client.available() && (millis() - t0 < 5000)) {
    delay(10);
  }

  String statusLine = "";
  if (client.available()) {
    statusLine = client.readStringUntil('\n');
    statusLine.trim();
  }

  while (client.available()) {
    client.read();
  }
  client.stop();

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
  pinMode(SensorPin, INPUT);      // 📌 Inicializar pin del sensor
  pinMode(7, OUTPUT);
  lcd.begin(16, 2);
  Serial.begin(9600);

  delay(1000);

  lcd.setCursor(0, 0);
  lcd.print("Sensor WiFi");
  lcd.setCursor(0, 1);
  lcd.print("Iniciando...");

  Serial.println("[BOOT] Iniciando en modo SENSOR REAL...");

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

  // 🔥 PROMEDIO PARA ESTABILIDAD - Sensor Real
  int suma = 0;
  for(int i = 0; i < 10; i++){
    suma += analogRead(SensorPin);
    delay(5);
  }
  int rawValue = suma / 10;

  // DEBUG: Mostrar valores individuales para diagnosticar
  Serial.print("[SENSOR] RAW=");
  Serial.print(rawValue);
  Serial.print(" (");
  Serial.print(analogRead(SensorPin));
  Serial.print(") -> ");

  // 🔧 CALIBRACIÓN - Valores medidos reales del sensor
  // Basado en prueba: RAW 0-5 en seco, RAW 400-529 en mojado
  int sensorMin = 0;    // Valor mínimo (completamente seco/aire)
  int sensorMax = 529;  // Valor máximo (completamente mojado/agua) - Calibrado
  
  Suelo = constrain(rawValue, sensorMin, sensorMax);
  Suelo = map(Suelo, sensorMin, sensorMax, 0, 100);

  Serial.print(Suelo);
  Serial.println("%");

  // Control relé
  if (Suelo >= 70) {
    digitalWrite(7, LOW);
  } else {
    digitalWrite(7, HIGH);
  }

  // LCD
  lcd.setCursor(0, 1);
  lcd.print("      ");
  lcd.setCursor(0, 1);
  lcd.print(Suelo);
  lcd.print("%");

  if (millis() - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = millis();
    bool ok = enviarNube(Suelo, rawValue);
    Serial.println(ok ? "[CLOUD] envio OK" : "[CLOUD] envio FAIL");
  }

  delay(1000);
}