{
  description = "ESP Spice: an ESP32 + Spice circuit sim toolkit";

  # The channel tarball supports locking, so flake.lock pins one release.
  inputs.nixpkgs.url = "https://channels.nixos.org/nixos-26.05/nixexprs.tar.xz";
  # nixpkgs' Rust has no wasm32 standard library, and the web demo needs one.
  inputs.rust-overlay = {
    url = "git+https://github.com/oxalica/rust-overlay";
    inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = {
    nixpkgs,
    rust-overlay,
    ...
  }: let
    systems = ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"];
    forAllSystems = f:
      nixpkgs.lib.genAttrs systems (system:
        f (import nixpkgs {
          inherit system;
          overlays = [rust-overlay.overlays.default];
        }));
    # One toolchain for the bridge and for the web demo's wasm.
    rustFor = pkgs:
      pkgs.rust-bin.stable.latest.default.override {
        targets = ["wasm32-unknown-unknown"];
      };
    ngspiceLibrary = pkgs: "${pkgs.libngspice}/lib/libngspice${pkgs.stdenv.hostPlatform.extensions.sharedLibrary}";
  in {
    packages = forAllSystems (pkgs: let
      inherit (pkgs) lib;
      rust = rustFor pkgs;
      rustPlatform = pkgs.makeRustPlatform {
        cargo = rust;
        rustc = rust;
      };
      # Only these files go into a build, so other changes do not rebuild it.
      source = files:
        lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions files;
        };
      cargoHashes = {
        "emu-core-0.3.0" = "sha256-kzrz8LPaV25mrgzZCNa4qw+Cu5W5SHKeqB3Otd3k1PM=";
      };
      nodeModules = npmRoot:
        pkgs.importNpmLock.buildNodeModules {
          inherit npmRoot;
          nodejs = pkgs.nodejs_22;
        };
      # The same ROMs as tools/fetch-esp32-rom.sh.
      roms =
        pkgs.runCommand "esp-rom-elfs" {
          src = pkgs.fetchurl {
            url = "https://github.com/espressif/esp-rom-elfs/releases/download/20260528/esp-rom-elfs-20260528.tar.gz";
            sha256 = "caa463d3cbef2430a5a35847c1d9f2f152403b17a802050927ff60c8da54fe46";
          };
        } ''
          mkdir $out
          tar -xzf $src -C $out esp32_rev300_rom.elf esp32s3_rev0_rom.elf \
            esp32c3_rev3_rom.elf esp32c6_rev0_rom.elf
        '';
      # LGPL-2.1 asks for the Arduino core source in the same place as
      # firmware.bin.
      arduinoCore = pkgs.fetchurl {
        url = "https://github.com/espressif/arduino-esp32/releases/download/3.3.8/esp32-core-3.3.8.tar.xz";
        sha256 = "f7f63825cfb98269514b977ea78c17ab292904e47e1ca47329fbe0ccccc5a83d";
      };
    in rec {
      # The ESP32 WebAssembly module for the web demo.
      web-esp32 = pkgs.stdenv.mkDerivation {
        name = "esp-spice-web-esp32";
        src = source [./bridge ./web/esp32];
        cargoDeps = rustPlatform.importCargoLock {
          lockFile = ./web/esp32/Cargo.lock;
          outputHashes = cargoHashes;
        };
        cargoRoot = "web/esp32";
        nativeBuildInputs = [rust rustPlatform.cargoSetupHook];
        buildPhase = ''
          cargo build --release --frozen --target wasm32-unknown-unknown \
            --manifest-path web/esp32/Cargo.toml
        '';
        installPhase = ''
          install -Dm444 -t $out \
            web/esp32/target/wasm32-unknown-unknown/release/esp_spice_web.wasm
        '';
      };

      # The GitHub Pages site: the repository, with web/dist filled in.
      site = pkgs.runCommand "esp-spice-site" {} ''
        cp -r ${./.} $out
        chmod -R u+w $out
        mkdir -p $out/web/dist
        cp ${web-esp32}/esp_spice_web.wasm ${roms}/*.elf $out/web/dist/
        cp ${arduinoCore} $out/web/dist/esp32-core-3.3.8.tar.xz
      '';

      # Each example, drawn in light and dark mode.
      captures =
        pkgs.runCommand "esp-spice-captures" {
          src = source [./examples ./render ./circuit ./tools/capture-examples.sh];
          nativeBuildInputs = [pkgs.nodejs_22];
          CHROMIUM_PATH = lib.getExe pkgs.chromium;
          # Fixed fonts, so the text in each capture is the same everywhere.
          FONTCONFIG_FILE = pkgs.makeFontsConf {fontDirectories = [pkgs.dejavu_fonts];};
        } ''
          cp -r $src source
          chmod -R u+w source
          ln -s ${nodeModules ./render}/node_modules source/render/node_modules
          export HOME=$TMPDIR
          bash source/tools/capture-examples.sh $out
        '';

      # Runs firmware against a circuit: nix run . -- DIAGRAM FIRMWARE.
      esp-spice-run = rustPlatform.buildRustPackage {
        pname = "esp-spice-run";
        version = "0.1.0";
        src = source [./bridge ./circuit ./package.json ./package-lock.json];
        cargoLock = {
          lockFile = ./bridge/Cargo.lock;
          outputHashes = cargoHashes;
        };
        cargoRoot = "bridge";
        buildAndTestSubdir = "bridge";
        # The tests read the examples and the ROMs, which this source lacks.
        doCheck = false;
        nativeBuildInputs = [pkgs.makeWrapper];
        postInstall = ''
          mkdir -p $out/share/esp-spice
          cp -r circuit package.json $out/share/esp-spice/
          ln -s ${nodeModules ./.}/node_modules $out/share/esp-spice/
          wrapProgram $out/bin/esp-spice-run \
            --add-flags "--server $out/share/esp-spice/circuit/server.js" \
            --prefix PATH : ${lib.makeBinPath [pkgs.nodejs_22]} \
            --set-default NGSPICE_LIBRARY ${ngspiceLibrary pkgs} \
            --set-default ESP32SIM_ROM_DIR ${roms}
        '';
        meta.mainProgram = "esp-spice-run";
      };

      default = esp-spice-run;
    });

    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell ({
          packages = with pkgs; [
            nodejs_22
            ffmpeg
            ngspice
            (rustFor pkgs)
            # For tools/fetch-esp32-rom.sh.
            curl
            # A static server for the web demo.
            python3
          ];
          # tools/fetch-esp32-rom.sh puts the ROM here by default.
          shellHook = ''
            export ESP32SIM_ROM_DIR="$PWD/roms"
          '';
          # circuit/ngspice.js loads the ngspice shared library from here.
          NGSPICE_LIBRARY = ngspiceLibrary pkgs;
        }
        # Browsers that Playwright downloads do not run on NixOS. The render
        # tests pass with this Chromium. On macOS, run
        # "npx playwright install chromium" instead.
        // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          CHROMIUM_PATH = "${pkgs.chromium}/bin/chromium";
        });
    });
  };
}
