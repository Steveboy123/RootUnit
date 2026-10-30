// Optional separate ESP32 for parking sensor EVENT alerts.
// Arduino ESP32 core. Requires a protected car 5V supply and a private Wi-Fi network.
// Sends only impact/door/motion events to the head unit; cannot wake an unpowered Pi.
#include <WiFi.h>
#include <HTTPClient.h>
#define IMPACT_PIN 27  // e.g. SW-420 digital output; use an accelerometer for fewer false positives
#define DOOR_PIN 26    // normally-open reed switch to GND, INPUT_PULLUP
#define PIR_PIN 25     // HC-SR501 digital OUT at 3.3V-compatible level
const char *SSID = "YOUR_CAR_WIFI";
const char *PASS = "YOUR_WIFI_PASSWORD";
const char *HOST = "http://192.168.4.1:8787/api/security/event";
const char *TOKEN = "CHANGE_TO_LONG_RANDOM_SENSOR_TOKEN_FROM_HEADUNIT_ENV";
unsigned long lastEvents[3] = {0,0,0};
bool lastPins[3] = {false,false,false};
const int pins[3] = {IMPACT_PIN, DOOR_PIN, PIR_PIN};
const char *kinds[3] = {"impact", "door", "motion"};
void sendEvent(const char* kind) {
  if (WiFi.status()!=WL_CONNECTED) return;
  HTTPClient http;
  if (!http.begin(HOST)) return;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-headunit-sensor-token", TOKEN);
  int status=http.POST(String("{\"kind\":\"")+kind+"\"}");
  Serial.printf("event=%s status=%d\n", kind, status);
  http.end();
}
void setup() {
  Serial.begin(115200);
  pinMode(IMPACT_PIN, INPUT);pinMode(DOOR_PIN, INPUT_PULLUP);pinMode(PIR_PIN, INPUT);
  WiFi.mode(WIFI_STA);
  WiFi.begin(SSID, PASS);
}
void loop() {
  if (WiFi.status()!=WL_CONNECTED && millis()%5000<30) WiFi.reconnect();
  for(int i=0;i<3;i++) {
    bool active = i==1 ? digitalRead(pins[i])==LOW : digitalRead(pins[i])==HIGH;
    if(active && !lastPins[i] && (lastEvents[i]==0||millis()-lastEvents[i]>15000UL)) {
      lastEvents[i]=millis();sendEvent(kinds[i]);
    }
    lastPins[i]=active;
  }
  delay(80);
}
