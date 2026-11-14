// The slide switch turns blinking of the yellow LED on and off. The red LED
// lights while the button is pressed. Each change goes to the serial log.
#include <Arduino.h>

constexpr int kBlinkLedPin = 23;
constexpr int kButtonLedPin = 4;
constexpr int kButtonPin = 13;
constexpr int kSwitchPin = 14;
constexpr uint32_t kBlinkMs = 50;

int last_switch = -1;
int last_button = -1;
uint32_t last_toggle = 0;

void setup() {
  Serial.begin(115200);
  pinMode(kBlinkLedPin, OUTPUT);
  pinMode(kButtonLedPin, OUTPUT);
  // The button connects the pin to ground, and the switch connects it to
  // 3.3 V, so each needs a pull the other way.
  pinMode(kButtonPin, INPUT_PULLUP);
  pinMode(kSwitchPin, INPUT_PULLDOWN);
  Serial.println("ready");
}

void loop() {
  int on = digitalRead(kSwitchPin);
  if (on != last_switch) {
    last_switch = on;
    Serial.println(on ? "switch on" : "switch off");
    if (!on) digitalWrite(kBlinkLedPin, LOW);
  }
  if (on && millis() - last_toggle >= kBlinkMs) {
    last_toggle = millis();
    digitalWrite(kBlinkLedPin, !digitalRead(kBlinkLedPin));
  }
  int pressed = digitalRead(kButtonPin) == LOW;
  if (pressed != last_button) {
    last_button = pressed;
    digitalWrite(kButtonLedPin, pressed);
    Serial.println(pressed ? "pressed" : "released");
  }
  delay(1);
}
