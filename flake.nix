{
  description = "ESP Spice development shell";

  # The channel tarball supports locking, so flake.lock pins one release.
  inputs.nixpkgs.url = "https://channels.nixos.org/nixos-26.05/nixexprs.tar.xz";

  outputs = {nixpkgs, ...}: let
    systems = ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"];
    forAllSystems = f:
      nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
  in {
    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell ({
          packages = with pkgs; [
            nodejs_22
            ffmpeg
            ngspice
          ];
          # circuit/ngspice.js loads the ngspice shared library from here.
          NGSPICE_LIBRARY = "${pkgs.libngspice}/lib/libngspice${pkgs.stdenv.hostPlatform.extensions.sharedLibrary}";
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
