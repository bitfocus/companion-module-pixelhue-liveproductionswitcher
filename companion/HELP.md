# Pixelhue Live Production Switcher Module

This module provides comprehensive control for the **Pixelhue S16** 4K Live Production Switcher from Companion/Stream Deck.

## Configuration

### Initial Setup

1. **IP Address**: Enter the IP address of your S16 on the network.
2. **Connection**: Save the configuration. The module discovers the device via ucenter, obtains a session token automatically (no password field), and opens HTTP + WebSocket connections.

Actions, feedbacks, variables, and presets are registered **only after a successful connection**. If the device is offline or login fails, those definitions are cleared.

### Troubleshooting

- Verify the S16 is powered on and reachable on the same network as Companion.
- Re-enter the IP address and save to force a reconnect.

## Available Actions

### Transition & Display

- **CUT**: Immediate cut transition (no fade).
- **AUTO**: Execute a program transition (TAKE/AUTO).
- **FTB (Fade to Black)**: Toggle fade-to-black on the selected screen(s).
- **MIX/WIPE/DVE/DIP**: Select the active TAKE transition effect.
- **Set Transition Effect**: Pick MIX, WIPE, DVE, or DIP from a dropdown.

### Background (BKGD) Sources

- **Set BKGD-PGM Source**: Route an input to the PGM background layer.
- **Set BKGD-PVW Source**: Route an input to the PVW background layer.

### KEY Edit

- **KEY Edit**: Select a KEY/DSK layer, toggle PGM on-air, PVW preview, or Next Transition follow.
- **Set Input on Layer**: Assign an input source to a layer (option to use the globally selected layer).

### Scenes (Presets)

- **Load Preset**: Load a scene to Preview (PVW) or Program (PGM).

### Output Routing

- **Select Output Connector**: Choose the active OUTPUT or AUX connector for routing actions.
- **Set Output Source**: Route a catalog source (input, internal, media, PGM/PVW, etc.) to the selected output.

### Stream & Record

- **Stream**: Start, stop, or toggle live streaming.
- **REC**: Start, stop, or toggle recording.

## Available Feedbacks

### Global State

- **FTB Active**: Fade-to-black is on.
- **Streaming Active**: Live stream is running.
- **Recording Active**: Recording is running.

### Transition Effects

- **Transition MIX/ WIPE/DVE/DIP Active**: Highlights the matching TAKE effect button.
- **Transition Effect Active**: Generic active-effect feedback with effect picker.

### Layers

- **Layer Selected**: Layer is selected in Layer Control.
- **Layer On Air (PGM)**: Layer is enabled on PGM.
- **Layer In Preview (PVW)**: Layer is enabled on PVW.
- **Layer Follows Next Transition**: Layer follows the next transition (PVW bus).
- **Layer Control Style**: Full button style for Layer Control presets.

### Inputs & BKGD

- **Input Signal Style**: Input has a live signal (text brightness).
- **Input Used By Layer**: Input is routed to a KEY layer.
- **Input On Program/Preview**: Input matches BKGD PGM or PVW source.
- **BKGD PGM/PVW Source Style**: Per-input style for BKGD source buttons.

### Scenes

- **Scene Name/Style/Loaded on Bus**: Scene label and PGM (red)/PVW (green) load state.
- **Scene Style: {name}**: Per-scene style feedback for preset buttons.

### Output

- **Output Connector Style**: Selected OUTPUT/AUX connector highlight.
- **Output Source Style**: Source is routed on an output connector.

## Available Variables

- Connection status, WebSocket connected, FTB/streaming/recording state.
- Layer, input, scene counts; current PGM/PVW scene IDs; active TAKE effect (MIX/WIPE/DVE/DIP).
- Per-layer: name, on-air, preview, selected, transition follow, source ID.
- Per-input: name, has signal.
- Per-scene: name, saved flag.

## Available Presets

Presets appear after the device connects. Categories are built from live device data:

### Display

- **CUT**, **AUTO**, **FTB**, **MIX**, **WIPE**, **DVE**, **DIP** — transition and display controls.

### Stream

- **Stream**, **REC** — streaming and recording toggles.

### Key

- KEY/DSK layer buttons with Layer Control highlighting.

### Source

- Input buttons that set the selected layer source.

### BKGD Source-PGM/BKGD Source-PVW

- Per-input buttons for PGM and PVW background routing.

### OUTPUT/OUTPUT Source

- Output connector selection and per-source routing buttons.

### Presets

- Scene load buttons (PVW) with PGM/PVW style feedback.

## Device Communication

This module uses both WebSocket and REST API communication for:

Real-time status updates via WebSocket connection
Command execution via HTTP REST API
Automatic reconnection handling
State synchronization between device and Companion

## Supported Device Models

S16

## Technical Requirements

- **Network**: Device must be accessible via IP on the same LAN as Companion.
- **Companion Version**: Companion v4.0+ with Node 22 module runtime.
