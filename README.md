# xFreighter

Welcome to **xFreighter**, an immersive procedural space trading and navigation simulator! Fly through vast, generated star systems, interact with procedural planetary bodies, and chart courses using an interactive 3D map.

## Features

*   **Procedural Universe Generation**: Uses a deterministic 3D lattice system (`UniverseManager`) to generate infinite, seamless sectors, complete with varied planets and interconnected warp gateways.
*   **High-Fidelity Planetary Rendering**: Advanced noise-based procedural textures with dynamic biomes, multi-layered atmospheres, Fresnel rim-lighting, and dynamic gas-giant banding (`PlanetGenerator`).
*   **Advanced Rendering Pipeline**: Custom Post-Processing pipeline featuring depth-aware distortion (used for engine trails, shield impacts, and warp gateways) and custom CRT/scanline visual overlays.
*   **Responsive Flight Controls**: Full 3D 6-DOF movement with momentum, mouselook integration, and HUD-based targeting. 
*   **Interactive Star Map**: 3D navigational node-map utilizing graph algorithms (A*) to chart paths between distant sectors.

## Tech Stack

*   **HTML5/CSS/JavaScript**: Vanilla web technologies, heavily leveraging ES6 modules.
*   **Three.js**: The core 3D rendering engine, using raw shaders (GLSL) for procedural planet generation and visual effects.
*   **Vite**: Fast, modern frontend build tool.

## Getting Started

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Start the development server:**
    ```bash
    npm run dev
    ```

3.  **Controls:**
    *   **W / S**: Pitch Up / Down
    *   **A / D**: Yaw Left / Right
    *   **Q / E**: Roll Left / Right
    *   **R / F**: Throttle Up / Down
    *   **X**: Zero Throttle
    *   **L**: Toggle Mouse Look
    *   **M**: Toggle Star Map
    *   **P**: Toggle Autopilot
    *   **O**: Toggle Post-Processing Effects
    *   **T**: Target Nearest Object
    *   **J**: Engage Warp Drive (when aligned)
    *   **Space**: Fire Blasters (if enabled)
    *   **Shift**: Raise Shields

## Development

The project is structured entirely within `/src`, with major components separated into managers:
-   `Main.js`: Orchestrates the rendering pipeline, input handling, and the game loop.
-   `SectorManager.js`: Handles instantiating planets, stations, and warp points for the active sector.
-   `PlanetGenerator.js`: Drives the heavy procedural texture generation onto WebGL Render Targets for dynamic planetary bodies.
-   `FlightController.js`: Manages ship physics, thrust, and orientation.

## Art Assets

*Note: The `art/` directory is excluded from version control to maintain a lightweight repository size.*
