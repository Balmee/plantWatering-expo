#include <ESP8266WiFi.h>
#include <DHT.h>
#include <time.h>
#include <TZ.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <ESP8266HTTPClient.h>

// ---------- Wi‑Fi ----------
#define WIFI_SSID     "TNCAP831426"
#define WIFI_PASSWORD "Efrh3s3zCzbeNNTF"

// ---------- ThingSpeak -----
const char* TS_HOST    = "api.thingspeak.com";
const char* TS_API_KEY = "FN233C0UDKZWLUS9";

// ---------- MQTT -----------
const char* MQTT_HOST  = "a1eef8be216949238865abfec7ed13a2.s1.eu.hivemq.cloud";
const int   MQTT_PORT  = 8883;  // Secure
const char* MQTT_USER  = "Balmee";
const char* MQTT_PASS  = "WateringP1ant";
const char* TOPIC_DATA = "watering/data";
const char* TOPIC_MAN  = "watering/manual";

// ---------- Hardware --------
#define PUMPPIN   5     // D1
#define DHTPIN    4     // D2
#define DHTTYPE   DHT11
#define SOILPIN   A0
const int MOISTURE_THRESHOLD = 400;

// ---------- Objects ----------
DHT dht(DHTPIN, DHTTYPE);
WiFiClientSecure netSecure; // For MQTT secure connection
PubSubClient     mqtt(netSecure);
WiFiClient httpClient;     // For ThingSpeak HTTP

// ---------- Manual Mode ------
bool         manualActive      = false;
unsigned long manualStartMs    = 0;
uint32_t      manualDurationMs = 20000;

// ---------- Auto Mode --------
bool         autoActive        = false;
unsigned long autoStartMs      = 0;
const uint32_t autoDurationMs = 5000;  // 5 seconds watering automatically

// ---------- MQTT Callback ----
void mqttCallback(char* topic, byte* payload, unsigned int len) {
  Serial.printf("\n[MQTT RX] Topic: %s | ", topic);
  String msg;
  for (uint32_t i = 0; i < len; i++) {
    Serial.write(payload[i]);
    msg += (char)payload[i];
  }
  Serial.println();

  if (String(topic).equals(TOPIC_MAN)) {
    if (msg.startsWith("RUN")) {
      int colon = msg.indexOf(':');
      if (colon > 0) {
        manualDurationMs = msg.substring(colon + 1).toInt() * 1000UL;
      } else {
        manualDurationMs = 20000UL;
      }

      manualActive  = true;
      manualStartMs = millis();
      digitalWrite(PUMPPIN, HIGH);
      Serial.printf("[Manual] Pump ON for %lu ms\n", manualDurationMs);

      // Cancel any automatic watering if manual started
      autoActive = false;
    } else if (msg.equals("AUTO")) {
      manualActive = false;
      digitalWrite(PUMPPIN, LOW);
      Serial.println("[Manual] Cancelled → AUTO");
    }
  }
}

// ---------- MQTT Connect -----
void reconnectMQTT() {
  while (!mqtt.connected()) {
    String cid = "ESP8266-" + String(ESP.getChipId(), HEX) + "-" + String(random(0xFFFF), HEX);
    Serial.printf("→ MQTT connect as %s … ", cid.c_str());
    if (mqtt.connect(cid.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("OK");
      if (mqtt.subscribe(TOPIC_MAN))
        Serial.println("[MQTT] Subscribed to watering/manual ✓");
      else
        Serial.println("[MQTT] Subscribe failed ✗");
    } else {
      Serial.printf("fail rc=%d — retry in 4s\n", mqtt.state());
      delay(4000);
    }
  }
}

// ---------- Setup -------------
void setup() {
  Serial.begin(115200);
  pinMode(PUMPPIN, OUTPUT);
  digitalWrite(PUMPPIN, LOW);
  dht.begin();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Wi‑Fi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print('.');
    delay(500);
    yield();
  }
  Serial.println(" ✓");

  configTime(TZ_Europe_London, "pool.ntp.org", "time.nist.gov");

  netSecure.setInsecure(); // Accept any cert for testing
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(512);
  reconnectMQTT();

  Serial.println("Setup complete.\n");
}

// ---------- Publish Helper ----
void publishData(float t, float h, int m, const String& pump) {
  String pl = "{\"temp\":" + String(t, 1) +
              ",\"hum\":" + String(h, 1) +
              ",\"moist\":" + String(m) +
              ",\"pump\":\"" + pump + "\"}";

  bool ok = mqtt.publish(TOPIC_DATA, pl.c_str());
  Serial.printf("[Pub] %s  (%s)\n", pl.c_str(), ok ? "PUB‑OK" : "PUB‑FAIL");
}

// ---------- Main Loop ----------
void loop() {
  if (!mqtt.connected()) {
    reconnectMQTT();
  }
  mqtt.loop();

  unsigned long now = millis();

  // Handle manual pump timeout
  if (manualActive && (now - manualStartMs >= manualDurationMs)) {
    manualActive = false;
    digitalWrite(PUMPPIN, LOW);
    Serial.println("[Manual] Done → AUTO");
  }

  int moist = analogRead(SOILPIN);
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();

  if (isnan(temp) || isnan(hum)) {
    Serial.println("DHT read error");
    delay(5000);
    return;
  }

  String pumpState;

  // Manual mode has priority
  if (manualActive) {
    pumpState = "ON (Manual)";
    digitalWrite(PUMPPIN, HIGH);
    // Cancel any auto watering if manual active
    autoActive = false;

  } else {
    // Automatic mode
    if (autoActive) {
      // Pump is currently running automatically, check if time expired
      if (now - autoStartMs >= autoDurationMs) {
        autoActive = false;
        digitalWrite(PUMPPIN, LOW);
        Serial.println("[Auto] Done watering");
      } else {
        pumpState = "ON (Auto)";
        digitalWrite(PUMPPIN, HIGH);
      }
    } else {
      // Not currently watering, check moisture
      if (moist > MOISTURE_THRESHOLD) {
        autoActive = true;
        autoStartMs = now;
        pumpState = "ON (Auto)";
        digitalWrite(PUMPPIN, HIGH);
        Serial.println("[Auto] Starting watering");
      } else {
        pumpState = "OFF";
        digitalWrite(PUMPPIN, LOW);
      }
    }
  }

  // Upload to ThingSpeak (use plain WiFiClient for HTTP)
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = String("http://") + TS_HOST + "/update?api_key=" + TS_API_KEY +
                 "&field1=" + moist + "&field2=" + temp +
                 "&field3=" + hum + "&field4=" + (pumpState.startsWith("ON") ? "1" : "0");
    http.begin(httpClient, url);
    int code = http.GET();
    Serial.printf("[TS] %d  pump:%s\n", code, pumpState.c_str());
    http.end();
  }

  // MQTT Publish
  publishData(temp, hum, moist, pumpState);

  delay(10000);
}






