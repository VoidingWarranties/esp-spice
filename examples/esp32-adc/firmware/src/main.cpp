// The bar graph shows the potentiometer voltage, one segment for each
// 0.3 V. Each change goes to the serial log.
#include <Arduino.h>

constexpr int kPotPin = 34;
constexpr int kBarPins[] = {22, 21, 19, 18, 5, 17, 16, 4, 2, 15};
constexpr int kStepMv = 300;

int last_level = -1;

void setup() {
  Serial.begin(115200);
  for (int pin : kBarPins) pinMode(pin, OUTPUT);
  Serial.println("ready");
}

void loop() {
  int pot_mv = analogReadMilliVolts(kPotPin);
  int level = min(pot_mv / kStepMv, 10);
  if (level != last_level) {
    last_level = level;
    for (int i = 0; i < 10; i++) digitalWrite(kBarPins[i], i < level);
    Serial.printf("pot %d mV, level %d\n", pot_mv, level);
  }
  delay(5);
}
