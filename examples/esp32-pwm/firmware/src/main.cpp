// PWM outputs:
// - The RGB LED fades from red to green to blue.
// - The buzzer plays a 2 kHz tone while the button is pressed.
// - Pin 18 gives a steady 1 kHz square wave, for the diode rectifier.
#include <Arduino.h>

constexpr int kRedPin = 27;
constexpr int kGreenPin = 25;
constexpr int kBluePin = 32;
constexpr int kBuzzerPin = 23;
constexpr int kButtonPin = 4;
constexpr int kSquarePin = 18;
constexpr uint32_t kFadeStepMs = 2;

bool was_pressed = false;
int step = 0;
uint32_t last_step = 0;

void setup() {
  Serial.begin(115200);
  pinMode(kButtonPin, INPUT_PULLUP);
  ledcAttach(kSquarePin, 1000, 8);
  ledcWrite(kSquarePin, 128);
  Serial.println("ready");
}

void loop() {
  // 0..767: red to green, green to blue, then blue to red.
  if (millis() - last_step >= kFadeStepMs) {
    last_step = millis();
    step = (step + 8) % 768;
    int phase = step / 256;
    int up = step % 256;
    int down = 255 - up;
    analogWrite(kRedPin, phase == 0 ? down : phase == 2 ? up : 0);
    analogWrite(kGreenPin, phase == 0 ? up : phase == 1 ? down : 0);
    analogWrite(kBluePin, phase == 1 ? up : phase == 2 ? down : 0);
  }
  bool pressed = digitalRead(kButtonPin) == LOW;
  if (pressed != was_pressed) {
    was_pressed = pressed;
    if (pressed) {
      tone(kBuzzerPin, 2000);
    } else {
      noTone(kBuzzerPin);
    }
    Serial.println(pressed ? "tone on" : "tone off");
  }
  delay(1);
}
