// The red LED lights while the button is pressed. The potentiometer sets
// the brightness of the green LED with PWM. Each change goes to the serial
// log.
#include <Arduino.h>

constexpr int kRedLedPin = 2;
constexpr int kButtonPin = 4;
constexpr int kGreenLedPin = 5;
constexpr int kPotPin = 34;

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
  if (abs(pot - last_pot) > 40) {
    last_pot = pot;
    analogWrite(kGreenLedPin, pot / 16);
    Serial.printf("pot %d\n", pot);
  }
  delay(10);
}
