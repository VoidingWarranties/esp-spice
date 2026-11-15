# Contributing

## Pictures in pull requests

Do not commit screenshots, GIFs or videos that only show a change in a pull
request. A squash merge puts them on `main`, and each clone then keeps them
forever. Commit a picture only when a page in the repository uses it, such as
a README.

Put pull request pictures on the `pr-assets` branch instead:

```sh
tools/capture-examples.sh            # Optional: draws each example into captures/
tools/upload-pr-assets.sh captures/esp32-pwm.png captures/esp32-pwm-dark.png
```

`upload-pr-assets.sh` commits the files to `pr-assets`, in a folder with the
name of your branch (`-d folder` sets a different one). It does not change
your checkout. It prints one Markdown line for each file, which embeds the
file by commit SHA. Paste the lines into the pull request description. A
link by SHA does not change when someone uploads a file with the same name
later.

Rules for `pr-assets`:

- It has no history in common with `main`. Do not merge it, and do not open
  a pull request from it or into it.
- Only add files. Do not delete files or rewrite history, because old pull
  requests link to them.

## Captures in CI

The Captures workflow runs on each pull request that changes `examples/`,
`render/` or `circuit/parts.js`. It draws each example in light and dark
mode with `nix build .#captures`, and attaches the PNG files to the run as
the `captures` artifact.
Reviewers can download it to see the change. An example with a `trace.json` shows the state at t = 0 of the
trace. Other examples show no sim state, so upload a picture of the web demo
when a change is about sim state.
