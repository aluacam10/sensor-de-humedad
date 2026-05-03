#include <WiFi.h>
#include <WiFiServer.h>
#include <LiquidCrystal.h>
#include <WiFiManager.h>

LiquidCrystal lcd(12, 11, 5, 4, 3, 2);

int SensorPin = A0;
int Suelo = 0;

// 🔧 CALIBRACIÓN REAL
int seco = 10;
int mojado = 720;

// WiFi Server
WiFiServer server(8888);
WiFiClient client;

// Variables WiFi
IPAddress arduinoIP;
bool wifiConectado = false;

// 🔧 CALIBRACIÓN CORRECTA
int humedad = 0;

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

  // Configurar WiFi con portal cautivo
  WiFiManager wm;
  
  // Intentar conectar. Si no funciona, muestra portal cautivo
  bool res = wm.autoConnect("Sensor-Humedad-Setup", "12345678");
  
  if(!res) {
    Serial.println("[WiFi] Fallo en autoConnect");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Error");
    while(1);
  } 
  else {
    Serial.println("[WiFi] Conectado");
    wifiConectado = true;
    arduinoIP = WiFi.localIP();
    
    Serial.print("[WiFi] IP: ");
    Serial.println(arduinoIP);
    
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi OK");
    lcd.setCursor(0, 1);
    lcd.print(arduinoIP.toString().c_str());
    delay(3000);
  }

  // Iniciar servidor TCP
  server.begin();
  Serial.println("[Server] Servidor TCP iniciado en puerto 8888");

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Humedad");
}

void loop() {
  // Reconectar WiFi si se perdió
  if (WiFi.status() != WL_CONNECTED) {
    if(wifiConectado) {
      Serial.println("[WiFi] Conexión perdida, reintentando...");
      lcd.setCursor(0, 0);
      lcd.print("Reconectando...");
      wifiConectado = false;
    }
    WiFi.reconnect();
    delay(2000);
    return;
  }
  
  if(!wifiConectado) {
    Serial.println("[WiFi] Reconectado");
    wifiConectado = true;
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Humedad");
  }

  // 🔥 PROMEDIO PARA ESTABILIDAD
  int suma = 0;
  for(int i = 0; i < 10; i++){
    suma += analogRead(SensorPin);
    delay(10);
  }
  humedad = suma / 10;

  // Enviar por serial (para debug)
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

  // Manejar conexiones TCP
  handleTCPConnections();

  delay(1000);
}

void handleTCPConnections() {
  // Aceptar nuevas conexiones
  if (server.hasClient()) {
    WiFiClient newClient = server.available();
    
    if (newClient) {
      Serial.println("[TCP] Nuevo cliente conectado");
      client = newClient;
    }
  }

  // Enviar datos al cliente conectado
  if (client && client.connected()) {
    // Enviar humedad en formato: "humedad\n"
    client.println(Suelo);
  } else if (client) {
    // Cliente desconectado
    Serial.println("[TCP] Cliente desconectado");
    client.stop();
  }
}
