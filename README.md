# Pixelhue S16 Companion Module

A Companion module for controlling the Pixelhue S16 Live/Broadcast Production Switcher.

## Features (scaffolding)

- Connect to an S16 device over HTTP(S) + WebSocket
- CUT / AUTO / FTB
- Preset load (to Preview/Program)
- Program/Preview source switch (raw source id, until input list API is wired up)
- AUX source switch (raw)
- Stream / Record start/stop
- Manual "raw HTTP request" debug action

## Installation

1. Install dependencies:
   ```bash
   yarn install
   ```
2. Build the module:
   ```bash
   yarn build
   ```
3. Add the module folder to Companion's module dev path, or run `yarn package` to produce a
   installable `.tgz`.

## Next steps

See "Next Steps To Complete This Module" in the [Pixelhue HELP.md](./deploy/pixelhue/HELP.md).
