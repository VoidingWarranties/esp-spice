{
  description = "ESP Spice development shell";

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
  in {
    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell ({
          packages = with pkgs; [
            nodejs_22
            ffmpeg
            # For tools/fetch-esp32-rom.sh.
            curl
            # One toolchain for the bridge and for the web demo's wasm.
            (rust-bin.stable.latest.default.override {
              targets = ["wasm32-unknown-unknown"];
            })
            # A static server for the web demo.
            python3
          ];
          # tools/fetch-esp32-rom.sh puts the ROM here by default.
          shellHook = ''
            export ESP32SIM_ROM_DIR="$PWD/roms"
          '';
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
