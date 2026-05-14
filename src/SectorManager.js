import * as THREE from 'three';
import WarpPoint from './WarpPoint.js';
import StationMap from './StationMap.js';
import StationRenderer from './StationRenderer.js';

export default class SectorManager {
    constructor(deps) {
        this.scene = deps.scene;
        this.universe = deps.universe;
        this.hud = deps.hud;
        this.planetGen = deps.planetGen;
        this.nameGen = deps.nameGen;

        this.planets = [];
        this.warpPoints = [];
        this.lockedGateCoords = null;
        this.GATE_LOCKOUT_DIST = 300; // Smaller than spawn distance (500) to allow immediate return
        this.urlParams = new URLSearchParams(window.location.search);

        this.flightController = null; // Set later after ship is loaded
    }

    setFlightController(fc) {
        this.flightController = fc;
    }

    setStationLibrary(lib) {
        this.stationLibrary = lib;
    }

    async spawn(sector, fromWarp = false) {
        const seed = sector.seed;
        const rng = this.nameGen._getRNG(seed);

        // Clean up previous
        this.planets.forEach(p => {
            this.scene.remove(p);
            if (p.material.map) {
                if (p.material.map.userData.renderTarget) p.material.map.userData.renderTarget.dispose();
                p.material.map.dispose();
            }
            // Cleanup Clouds
            p.children.forEach(child => {
                if (child.material && child.material.map) {
                    if (child.material.map.userData.renderTarget) child.material.map.userData.renderTarget.dispose();
                    child.material.map.dispose();
                }
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            p.geometry.dispose();
            p.material.dispose();
        });
        this.planets = [];

        this.warpPoints.forEach(wp => wp.dispose(this.scene));
        this.warpPoints = [];
        this.hud.pois = [];

        if (this.stations) {
            this.stations.forEach(s => s.renderer.dispose());
        }
        this.stations = [];

        // 1. Generate Planets
        const isStartSystem = sector.coords.ix === 0 && sector.coords.iy === 0 && sector.coords.iz === 0;
        const planetCount = (isStartSystem && this.urlParams.get('dev') === '1') ? 10 : sector.planetCount;

        for (let i = 0; i < planetCount; i++) {
            const pSeed = seed + "-" + i;
            const res = 2048;

            // 1. Surface
            const { texture, biome } = await this.planetGen.generate(pSeed, { resolution: res });
            const radius = 500 + rng() * 1000;
            const geo = new THREE.SphereGeometry(radius, 64, 64);
            const mat = new THREE.MeshStandardMaterial({ /* map: texture, */ metalness: 0, roughness: 0.8 });
            const planet = new THREE.Mesh(geo, mat);

            // 2. Clouds
            const { texture: cloudTexture } = await this.planetGen.generate(pSeed, { resolution: res / 2, mode: 'clouds', waterLevel: 0.2 });
            const cloudGeo = new THREE.SphereGeometry(radius * 1.015, 64, 64);
            const cloudMat = new THREE.MeshStandardMaterial({
                map: cloudTexture,
                transparent: true,
                opacity: 0.9,
                depthWrite: false,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -1, // Subtle push
                polygonOffsetUnits: -1
            });
            const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
            cloudMesh.renderOrder = 2; // Ensure order
            planet.add(cloudMesh);

            // 3. Atmosphere Glow
            const atmosColor = new THREE.Color(biome.water).offsetHSL(0, 0.2, 0.2);
            const atmosGeo = new THREE.SphereGeometry(radius * 1.04, 64, 64);
            const atmosMat = new THREE.ShaderMaterial({
                transparent: true,
                side: THREE.BackSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                polygonOffset: false, // Remove from atmosphere to avoid clipping
                uniforms: {
                    uColor: { value: atmosColor }
                },
                vertexShader: `
                    varying vec3 vNormal;
                    varying vec3 vViewDir;
                    void main() {
                        vNormal = normalize(normalMatrix * normal);
                        vec4 worldPos = modelMatrix * vec4(position, 1.0);
                        vViewDir = normalize(cameraPosition - worldPos.xyz);
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    varying vec3 vNormal;
                    varying vec3 vViewDir;
                    uniform vec3 uColor;
                    void main() {
                        float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 6.0);
                        gl_FragColor = vec4(uColor, fresnel * 0.4);
                    }
                `
            });
            const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
            planet.add(atmosMesh);

            const dist = 5000 + rng() * 8000 + (i * 1000);
            const angle = rng() * Math.PI * 2;
            planet.position.set(Math.cos(angle) * dist, (rng() - 0.5) * 4000, Math.sin(angle) * dist);
            planet.userData.type = 'planet';
            planet.userData.radius = radius;
            planet.userData.name = this.nameGen.getName(pSeed, 'planet');

            this.scene.add(planet);
            this.planets.push(planet);
            const planetName = this.nameGen.getName(pSeed, 'planet');
            planet.userData.seed = pSeed;
            planet.userData.type = 'planet';
            planet.userData.name = planetName;

            this.hud.addTargetPOI(planet.position, planetName);
            if (i === 0 || planetCount < 5) {
                this.hud.addMessage(`SCANNER DETECTED: ${planetName}`);
            }
        }

        if (planetCount > 5) {
            this.hud.addMessage(`SCANNER DETECTED: ${planetCount} PLANETARY BODIES IN THIS CLUSTER.`);
        }

        // 2. Spawn Warp Points
        const neighbors = this.universe.getNeighbors(sector);
        const MIN_WP_DIST = 2000;
        const occupiedPositions = [];
        this.planets.forEach(p => occupiedPositions.push(p.position));

        neighbors.forEach((neighbor, i) => {
            let wpPos = new THREE.Vector3();
            let attempts = 0;
            let valid = false;

            while (attempts < 20 && !valid) {
                const dist = 4000 + rng() * 6000;
                const angle = (i / neighbors.length) * Math.PI * 2 + (rng() - 0.5) * 0.5;
                wpPos.set(Math.cos(angle) * dist, (rng() - 0.5) * 2000, Math.sin(angle) * dist);

                valid = true;
                for (const pos of occupiedPositions) {
                    if (wpPos.distanceTo(pos) < MIN_WP_DIST) {
                        valid = false;
                        break;
                    }
                }
                attempts++;
            }

            occupiedPositions.push(wpPos.clone());

            const wpName = `WARP NODE: ${this.nameGen.getName(neighbor.seed, 'sector')}`;
            const wp = new WarpPoint(this.scene, wpPos, seed, neighbor.seed, wpName, neighbor.coords);
            this.warpPoints.push(wp);
            this.hud.addTargetPOI(wpPos, wpName);

            // If emerging from this gate, position the ship here
            if (fromWarp && this.lockedGateCoords && this.flightController &&
                neighbor.coords.ix === this.lockedGateCoords.ix &&
                neighbor.coords.iy === this.lockedGateCoords.iy &&
                neighbor.coords.iz === this.lockedGateCoords.iz) {

                this.flightController.ship.position.copy(wpPos);
                // Point the ship away from the gate
                const dirAway = wpPos.clone().normalize().multiplyScalar(500);
                this.flightController.ship.position.add(dirAway);
                this.flightController.ship.lookAt(new THREE.Vector3(0, 0, 0));
                this.flightController.velocity.copy(dirAway.normalize().multiplyScalar(200));
            }
        });

        // 3. Spawn Procedural Space Stations
        if (this.stationLibrary) {
            const stationCount = 1 + Math.floor(rng() * 2);
            for (let i = 0; i < stationCount; i++) {
                const sSeed = seed + "-station-" + i;
                const stationMap = new StationMap(sSeed, rng);
                const stationRenderer = new StationRenderer(this.scene, stationMap, this.stationLibrary);

                const dist = 3000 + rng() * 4000;
                const angle = rng() * Math.PI * 2;

                stationRenderer.group.position.set(Math.cos(angle) * dist, (rng() - 0.5) * 2000, Math.sin(angle) * dist);
                const stationName = "STATION: " + this.nameGen.getName(sSeed, 'sector');
                stationRenderer.group.userData.type = 'station';
                stationRenderer.group.userData.name = stationName;

                this.stations.push({ map: stationMap, renderer: stationRenderer, position: stationRenderer.group.position });

                this.hud.addTargetPOI(stationRenderer.group.position, stationName);
            }
        }
    }

    updateRotations(delta) {
        this.planets.forEach(p => {
            if (p.userData.type !== 'planet') return;
            p.rotation.y += delta * 0.01; // Slower rotation
            p.children.forEach(child => {
                if (child.isMesh) child.rotation.y += delta * 0.005; // Slower cloud drift
            });
        });
    }
}
