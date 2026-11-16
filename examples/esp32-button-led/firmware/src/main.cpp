// The red LED lights while the button is pressed. The potentiometer sets
// the brightness of the green LED with PWM. Each change goes to the serial
// log.
#include <Arduino.h>

constexpr int kRedLedPin = 2;
constexpr int kButtonPin = 4;
constexpr int kGreenLedPin = 5;
// An ADC1 pin: ADC2 is not free while WiFi runs.
#if CONFIG_IDF_TARGET_ESP32
constexpr int kPotPin = 34;
#else
constexpr int kPotPin = 1;
#endif

bool was_pressed = false;
int last_pot = -1000;

void setup() {
  Serial.begin(115200);
  pinMode(kRedLedPin, OUTPUT);
  pinMode(kButtonPin, INPUT_PULLUP);
  Serial.println("ready");
}

void loop() {
  // The button connects the pin to ground.
  bool pressed = digitalRead(kButtonPin) == LOW;
  if (pressed != was_pressed) {
    was_pressed = pressed;
    digitalWrite(kRedLedPin, pressed);
    Serial.println(pressed ? "pressed" : "released");
  }
  int pot = analogRead(kPotPin);
  // Skip small changes, which are often ADC noise. Always take a new end
  // value, or the LED can stay a little on when the pot is at 0.
  bool at_end = pot == 0 || pot == 4095;
  if (abs(pot - last_pot) > 40 || (at_end && pot != last_pot)) {
    last_pot = pot;
    analogWrite(kGreenLedPin, pot / 16);
    Serial.printf("pot %d\n", pot);
  }
  delay(10);
}
