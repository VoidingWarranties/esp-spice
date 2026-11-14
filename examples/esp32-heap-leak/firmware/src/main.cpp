// Each button press is a request that leaks 1000 bytes. The bridge's free
// heap samples must match the values that the firmware prints.
#include <Arduino.h>

constexpr int kButtonPin = 4;
constexpr size_t kLeakBytes = 1000;

// Volatile, so that the compiler cannot remove the leaked malloc.
void* volatile leaked;
int requests = 0;
bool was_pressed = false;

void PrintHeap(const char* label) {
  Serial.printf("%s %d free %u min %u\n", label, requests,
                esp_get_free_heap_size(), esp_get_minimum_free_heap_size());
}

void setup() {
  Serial.begin(115200);
  pinMode(kButtonPin, INPUT_PULLUP);
  PrintHeap("ready");
}

void loop() {
  bool pressed = digitalRead(kButtonPin) == LOW;
  if (pressed && !was_pressed) {
    leaked = malloc(kLeakBytes);
    requests++;
    PrintHeap("request");
  }
  was_pressed = pressed;
  delay(10);
}
