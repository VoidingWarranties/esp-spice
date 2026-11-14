# ESP Spice

An ESP32 + Spice circuit sim toolkit built with [esp32sim] and [ngspice].

[esp32sim]: https://mikroverk.github.io/esp32sim/
[ngspice]: https://ngspice.sourceforge.io/

## Web demo

`web/` is a static page that runs ngspice in the browser, through the
[eecircuit-engine] WebAssembly build. It draws `web/diagram.json` with
`render/` and [wokwi-elements]. Turn the pot or push the button, and the page solves the
circuit again and sets the LED brightness from the current.

```sh
python3 -m http.server 8790
# Open http://127.0.0.1:8790/web/
```

The page loads its libraries from a CDN, so it needs a network connection.

[eecircuit-engine]: https://github.com/eelab-dev/EEcircuit-engine
[wokwi-elements]: https://github.com/wokwi/wokwi-elements
