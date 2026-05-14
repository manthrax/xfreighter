import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import Nebularity from './Nebularity.js';
import FlightController from './FlightController.js';
import HUD from './HUD.js';
import PlanetGenerator from './PlanetGenerator.js';
import PersistenceManager from './PersistenceManager.js';
import NameGenerator from './NameGenerator.js';
import ShieldSystem from './ShieldSystem.js';
import Exporter from './Exporter.js';
import UniverseManager from './UniverseManager.js';
import StarMap from './StarMap.js';
import WarpPoint from './WarpPoint.js';
import SectorManager from './SectorManager.js';
import MarketUI from './MarketUI.js';
import CameraController from './CameraController.js';
import StationEditor from './StationEditor.js';
import { executeWarpSequence } from './WarpSequence.js';
import EconomyManager from './EconomyManager.js';
import Starfield from './Starfield.js';
import TargetReticle from './TargetReticle.js';
import ContextUI from './ContextUI.js';
import TTSManager from './TTSManager.js';

const tts = new TTSManager();
const contextUI = new ContextUI();

// Wrapper for TTS to show captions
const speak = (text, options) => {
    tts.speak(text, options);
    contextUI.showCaption(text);
};

// --- Setup ---
const urlParams = new URLSearchParams(window.location.search);
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    //logarithmicDepthBuffer: true 
    reverseDepthBuffer: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.2; // We'll pass this manually to the post shader
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

// --- Custom Render Pipeline Setup ---
window.useDistortionEffect = true;
const mainRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    samples: 4
});
mainRenderTarget.depthTexture = new THREE.DepthTexture(window.innerWidth, window.innerHeight);
mainRenderTarget.depthTexture.type = THREE.UnsignedIntType;

const motionRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
});
motionRenderTarget.depthTexture = mainRenderTarget.depthTexture;

const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postMaterial = new THREE.ShaderMaterial({
    uniforms: {
        tDiffuse: { value: mainRenderTarget.texture },
        tDistortion: { value: motionRenderTarget.texture },
        tDepth: { value: mainRenderTarget.depthTexture },
        uProjectionMatrixInverse: { value: new THREE.Matrix4() },
        uCameraMatrixWorld: { value: new THREE.Matrix4() },
        uExposure: { value: 1.2 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDistortion;
        uniform sampler2D tDepth;
        uniform mat4 uProjectionMatrixInverse;
        uniform mat4 uCameraMatrixWorld;
        uniform float uExposure;
        varying vec2 vUv;
        
        vec3 ACESFilmicToneMapping(vec3 color) {
            color *= uExposure;
            float a = 2.51;
            float b = 0.03;
            float c = 2.43;
            float d = 0.59;
            float e = 0.14;
            return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
        }

        void main() {
            vec4 distData = texture2D(tDistortion, vUv);
            vec2 offset = distData.xy * distData.a * 0.2; 
            vec4 texel = texture2D(tDiffuse, vUv + offset);
            
            // Reconstruct World Space from Depth
            float depth = texture2D(tDepth, vUv + offset).r;
            
            // In Three.js with reverseDepthBuffer and WebGL2 clipControl, NDC Z is [0, 1].
            // If clipControl is not supported, it emulates it. Let's use [0, 1] or [-1, 1].
            // A common robust way for reverse Z in Three.js WebGL2:
            vec4 clipSpace = vec4((vUv + offset) * 2.0 - 1.0, depth, 1.0);
            
            // Fallback for standard NDC [-1, 1] if the above is wrong:
            // vec4 clipSpace = vec4((vUv + offset) * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
            
            vec4 viewSpace = uProjectionMatrixInverse * clipSpace;
            viewSpace /= viewSpace.w;
            vec4 worldSpace = uCameraMatrixWorld * viewSpace;
            
            // Apply Tone Mapping in the resolve pass
            texel.rgb = ACESFilmicToneMapping(texel.rgb);
            
            // Worldspace Grid Overlay
            // Only draw grid where depth > 0.0 (in reverse Z, 0.0 is the clear value/far plane)
            /*if (depth > 0.0001) 
            {
                vec3 grid = fract(worldSpace.xyz / 100.0);
                // 1000 units per grid square, draw lines at edges
                if (grid.x < 0.05 || grid.y < 0.05|| grid.z < 0.05) {
                    texel.rgb = mix(texel.rgb, vec3(0.0, 1.0, 0.0), 0.5); // 50% opacity green grid
                }
            }
            */
            gl_FragColor = texel;
            
            // Ensure proper linear to sRGB color space conversion
            #include <colorspace_fragment>
        }
    `,
    depthWrite: false,
    depthTest: false,
    toneMapped: false // Explicitly prevent double tone mapping on the resolve pass
});
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial);
postScene.add(postQuad);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000000);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
sunLight.position.set(5, 3, 5);
scene.add(sunLight);

const timer = new THREE.Timer();
const thrusterMaterials = [];
const thrusterDistortionMaterials = [];
let flightController = null;
let isStarted = false;

// --- Universe & Map ---
const universe = new UniverseManager("nebula-voyager-v1");
const starMap = new StarMap(renderer, universe);
let currentLatticePos = { ix: 0, iy: 0, iz: 0 };
let currentSector = universe.getSector(0, 0, 0);
let currentTargetIndex = -1;

starMap.onSectorSelected = (sector, path) => {
    const sidebar = document.getElementById('map-sidebar');
    const name = nameGen.getName(sector.seed, 'sector');
    sidebar.innerHTML = `
        <div style="font-size: 1.2rem; border-bottom: 1px solid #00ffaa; margin-bottom: 10px; color: #00ffaa;">${name}</div>
        <div style="font-size: 0.8rem; opacity: 0.8; margin-bottom: 15px;">COORD: [${sector.coords.ix}, ${sector.coords.iy}, ${sector.coords.iz}]</div>
        
        <div class="map-detail-row">
            <span>PLANETS:</span>
            <span style="color: #fff;">${sector.planetCount}</span>
        </div>
        <div class="map-detail-row">
            <span>RESOURCES:</span>
            <span style="color: #fff;">${sector.attributes.resources}</span>
        </div>
        
        <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid rgba(0,255,170,0.2);">
            <div style="font-size: 0.7rem; color: #00ffaa; margin-bottom: 5px;">MARKET DATA</div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                <span style="color: #00ffaa;">EXPORTS:</span>
                <span style="color: #fff;">${sector.market.exports.join(', ')}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-top: 5px;">
                <span style="color: #ffaa00;">NEEDS:</span>
                <span style="color: #fff;">${sector.market.needs.join(', ')}</span>
            </div>
        </div>

        <div style="margin-top: 20px; font-size: 0.8rem;">
            <div style="color: #88ccff;">STATUS: ${universe.visitedSectors.has(sector.id) ? 'EXPLORED' : 'UNMAPPED'}</div>
            <div style="margin-top: 5px;">PATH STEPS: ${path.length > 0 ? path.length - 1 : 'N/A'}</div>
        </div>
        
        ${path.length > 0 ? '<div style="color: #00ffaa; margin-top: 15px; font-weight: bold;">> COURSE PLOTTED</div>' : ''}
    `;
    sidebar.classList.remove('hidden');
};

// --- HUD & Generators ---
const hud = new HUD(scene, camera);
const planetGen = new PlanetGenerator(renderer);
const persistence = new PersistenceManager();
const nameGen = new NameGenerator();
const economy = new EconomyManager();
let shieldSystem = null;
let lastSaveTime = 0;
let lastJumpTime = 0;

const sectorManager = new SectorManager({
    scene, universe, hud, planetGen, nameGen
});

const market = new MarketUI({ economy, hud, sectorManager });

const getInSectorTargets = () => {
    const targets = [];
    sectorManager.planets.forEach(p => targets.push(p));
    sectorManager.warpPoints.forEach(wp => targets.push(wp.mesh));
    if (sectorManager.stations) {
        sectorManager.stations.forEach(s => targets.push(s.renderer.group));
    }
    return targets;
};

// --- Cinematic Autopilot Camera ---
const cameraController = new CameraController(camera, renderer.domElement);
const stationEditor = new StationEditor(scene, camera, renderer.domElement);

const starfield = new Starfield(scene, 3000);
const targetReticle = new TargetReticle(camera);
targetReticle.addToScene(scene);

// --- Nebularity Background ---
const nebularity = new Nebularity({ THREE, renderer, scene });
let currentSeed = "game-init-seed";
nebularity.morph(currentSeed, { resolution: 1024 });

// --- Ship Loading ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);


let shipLibrary = {};
export let stationLibrary = {};

window.stationLibrary = stationLibrary;

const assetPath = (path) => {
    const base = import.meta.env.BASE_URL || './';
    return (base.endsWith('/') ? base : base + '/') + path;
};

Promise.all([
    new Promise((resolve, reject) => loader.load(assetPath('ship_stack.glb'), resolve, undefined, reject)),
    new Promise((resolve, reject) => loader.load(assetPath('station.glb'), resolve, undefined, reject))
]).then(async ([shipGltf, stationGltf]) => {
// console.log("Main: Assets loaded successfully");

    stationGltf.scene.traverse(child => {
        if (child.isMesh) {
            const oldMat = child.material;
            if (!(oldMat instanceof THREE.MeshStandardMaterial)) {
                child.material = new THREE.MeshStandardMaterial({
                    color: oldMat.color,
                    map: oldMat.map,
                    metalness: 0.8,
                    roughness: 0.2,
                    envMapIntensity: 1.0
                });
            }
            child.position.set(0, 0, 0);
            child.updateMatrixWorld(true);
            stationLibrary[child.name] = child;
        }
    });
// console.log(`Main: Station library populated with ${Object.keys(stationLibrary).length} meshes`);
    sectorManager.setStationLibrary(stationLibrary);

    const gltf = shipGltf;
    // Find all potential ships in the stack
    const shipCandidates = [];
    gltf.scene.traverse(child => {
        if (child.name.startsWith('ship_')) {
            shipCandidates.push(child);
            child.position.set(0, 0, 0)
            child.updateMatrixWorld(true);
            child.userData.worldBounds = new THREE.Box3().setFromObject(child);
            shipLibrary[child.name.slice(5)] = child;
        }
    });

    if (shipCandidates.length === 0) {
        console.error("ShipStack: No meshes starting with 'ship_' found in ship_stack.glb");
        return;
    }

    // Pick a ship (for now we pick the first, or could pick based on a preference)
    const selectedShip = shipLibrary.freighter.clone(true);

    // Create a clean container for the player ship
    const ship = new THREE.Group();
    ship.add(selectedShip);

    ship.scale.multiplyScalar(0.3);
    ship.updateMatrixWorld(true);

    ship.traverse((child) => {
        if (child.isMesh && !child.name.startsWith('thruster')) {
            // PBR Shiny Metal for ship hull
            child.material.metalness = 1.0;
            child.material.roughness = 0.1;
            child.material.envMapIntensity = 20.5;
        }

        if (child.name.startsWith("thruster")) {
            const strength = (child.userData.strength && child.userData.strength.value !== undefined)
                ? child.userData.strength.value
                : 1.0;

            child.material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uStrength: { value: strength },
                    uColor: { value: new THREE.Color(0x3366ff) }
                },
                vertexShader: `
                    uniform float uTime;
                    uniform float uStrength;
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        vec3 pos = position;
                        float noise = sin(uTime * 50.0 + vUv.x * 1230.0) * 0.1 * uStrength;
                        if (pos.y > 0.0) pos.y *= (uStrength + noise) * 20.;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                    }
                `,
                fragmentShader: `
                    varying vec2 vUv;
                    uniform vec3 uColor;
                    void main() {
                        float alpha = pow(1.0 - vUv.y, 2.0);
                        gl_FragColor = vec4(uColor * 5.0, alpha);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            thrusterMaterials.push(child.material);
            child.material.userData.baseStrength = strength;

            // Create Distortion Layer for Thruster
            const distMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uStrength: { value: strength }
                },
                vertexShader: `
                    uniform float uTime;
                    uniform float uStrength;
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        vec3 pos = position;
                        float noise = sin(uTime * 50.0 + vUv.x * 1230.0) * 0.1 * uStrength;
                        if (pos.y > 0.0) pos.y *= (uStrength + noise) * 20.0;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                    }
                `,
                fragmentShader: `
                    varying vec2 vUv;
                    uniform float uTime;
                    uniform float uStrength;
                    void main() {
                        // High frequency chaotic noise for thruster "heat"
                        float n1 = sin(vUv.x * 100.0 + uTime * 40.0) * cos(vUv.y * 50.0 + uTime * 30.0);
                        float n2 = cos(vUv.x * 70.0 - uTime * 35.0) * sin(vUv.y * 60.0 - uTime * 25.0);
                        
                        vec2 offset = vec2(n1, n2) * 0.5 * uStrength;
                        
                        // Falloff so it's strongest near the nozzle
                        float alpha = pow(1.0 - vUv.y, 1.2) * uStrength;
                        gl_FragColor = vec4(offset, 0.0, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide
            });

            const distMesh = new THREE.Mesh(child.geometry, distMaterial);
            distMesh.layers.set(1);
            child.add(distMesh);

            thrusterDistortionMaterials.push(distMaterial);
            distMaterial.userData.baseStrength = strength;
        }
    });

    // Initial position before controller takes over
    ship.position.set(0, 0, 0);
    scene.add(ship);
    flightController = new FlightController(ship, camera);
    sectorManager.setFlightController(flightController);
    shieldSystem = new ShieldSystem(ship, scene);

    // Start lifecycle
    if (typeof initGame === 'function') {
        await initGame();
    }
    animate();
});

// SectorManager handles planet and warp point spawning


// --- Game Lifecycle ---
async function initGame() {
    await tts.init(); // Initialize TTS model
    await persistence.init();
    const saved = await persistence.loadState();
    const resumeBtn = document.getElementById('resumeBtn');

    if (!saved) {
        resumeBtn.classList.add('disabled');
    }

    resumeBtn.addEventListener('click', async (e) => {
        e.target.blur();
        if (isStarted) {
            return;
        }
        const savedData = await persistence.loadState();
        if (savedData) {
            await restoreState(savedData);
            isStarted = true;
            document.getElementById('overlay').classList.add('hidden');
            hud.show();
            hud.addMessage("MISSION RESUMED.");
            speak("resumed.", { voice: 'af_river' });
        }
    });

    document.getElementById('startBtn').addEventListener('click', async (e) => {
        e.target.blur();
        const savedData = await persistence.loadState();
        if (savedData) {
            if (!confirm("Starting a new expedition will clear your existing save. Proceed?")) {
                return;
            }
            await persistence.clearState();
        }

        // Reset state for new game
        currentLatticePos = { ix: 0, iy: 0, iz: 0 };
        currentSector = universe.getSector(0, 0, 0);
        universe.visitedSectors.clear();
        universe.visitedSectors.add(currentSector.id);

        if (flightController) {
            flightController.ship.position.set(0, 0, 0);
            flightController.ship.quaternion.set(0, 0, 0, 1);
            flightController.velocity.set(0, 0, 0);
            flightController.charge = 100;
            flightController.autopilot = false;
            flightController.cameraLocked = false;
        }

        starMap.plannedPath = [];
        starMap.selectedSector = null;
        document.getElementById('map-sidebar').classList.add('hidden');

        await sectorManager.spawn(currentSector);
        nebularity.morph(currentSector.seed, { resolution: 1024 });

        isStarted = true;
        document.getElementById('overlay').classList.add('hidden');
        resumeBtn.classList.remove('disabled');
        hud.show();
        hud.addMessage("SYSTEMS ONLINE. NEW EXPEDITION INITIALIZED.");
        speak("<system boot>", { voice: 'af_river' });
        speak("Nebula Drift.", { voice: 'af_river' });
    });

    if (urlParams.get('dev') === '1') {
        const savedData = await persistence.loadState();
        if (savedData && savedData.latticePos) {
            await restoreState(savedData);
            isStarted = true;
            document.getElementById('overlay').classList.add('hidden');
            hud.show();
            hud.addMessage("DEV MODE: AUTO-RESUMING LAST SESSION...");
        } else {
            document.getElementById('startBtn').click();
        }
    }
}

async function restoreState(saved) {
    currentLatticePos = saved.latticePos || { ix: 0, iy: 0, iz: 0 };
    currentSector = universe.getSector(currentLatticePos.ix, currentLatticePos.iy, currentLatticePos.iz);

    if (saved.visitedSectors) {
        saved.visitedSectors.forEach(id => universe.visitedSectors.add(id));
    }
    universe.visitedSectors.add(currentSector.id);

    if (saved.position) flightController.ship.position.copy(saved.position);
    if (saved.quaternion) flightController.ship.quaternion.copy(saved.quaternion);
    if (saved.velocity) flightController.velocity.copy(saved.velocity);
    if (saved.rotationVelocity) flightController.rotationVelocity.copy(saved.rotationVelocity);
    if (saved.throttle) flightController.throttle.copy(saved.throttle);

    if (saved.plannedPath && saved.plannedPath.length > 0) {
        starMap.plannedPath = saved.plannedPath.map(coords => universe.getSector(coords.ix, coords.iy, coords.iz));
        if (saved.selectedSectorId) {
            starMap.selectedSector = universe.sectors.get(saved.selectedSectorId);
        }
        starMap.onSectorSelected(starMap.selectedSector, starMap.plannedPath);
    }

    if (saved.economy) economy.restoreState(saved.economy);

    nebularity.morph(currentSector.seed, { resolution: 1024 });
    await sectorManager.spawn(currentSector);

    if (saved.autopilot !== undefined) flightController.autopilot = saved.autopilot;
    if (saved.autopilotTarget) {
        flightController.autopilotTarget = new THREE.Vector3(saved.autopilotTarget.x, saved.autopilotTarget.y, saved.autopilotTarget.z);
    }
    if (saved.cameraLocked !== undefined) {
        flightController.cameraLocked = saved.cameraLocked;
        cameraController.enabled = flightController.cameraLocked;
        if (saved.orbitTarget) cameraController.setTarget(saved.orbitTarget.x, saved.orbitTarget.y, saved.orbitTarget.z);
        if (saved.cameraPosition) camera.position.set(saved.cameraPosition.x, saved.cameraPosition.y, saved.cameraPosition.z);
        cameraController.update();
    }
}



function animate(time) {
    requestAnimationFrame(animate);
    renderer.clear(); // Manual clear to support multi-pass rendering

    timer.update(time);
    let delta = timer.getDelta();
    if (delta > 0.1) delta = 0.1; // Cap delta to prevent skips after long async loads
    const elapsed = timer.getElapsed();

    nebularity.update(delta);
    market.update(delta);

    // Rotate world planets and clouds
    sectorManager.updateRotations(delta);



    // Background Sim (Attract Mode / Map Unpaused)
    if (flightController) {
        // Dim controls if menu is up
        const menuUp = !document.getElementById('overlay').classList.contains('hidden');
        if (menuUp) {
            // Reduce or disable input processing while in menu if desired
        }

        let nearestP = null;
        let minDist = 1000000;
        sectorManager.planets.forEach(p => {
            if (p.userData.type !== 'planet') return;
            const d = flightController.ship.position.distanceTo(p.position);
            if (d < minDist) {
                minDist = d;
                nearestP = p;
            }
        });

        flightController.update(delta, {
            nearestPlanetDist: minDist,
            nearestPlanetRadius: nearestP && nearestP.geometry && nearestP.geometry.parameters ? nearestP.geometry.parameters.radius : 0,
            nearestPlanetPos: nearestP ? nearestP.position : null,
            atmosphereThreshold: 3000,
            nearestPlanetDir: nearestP ? nearestP.position.clone().sub(flightController.ship.position).normalize() : null
        });

        // 2. Update Camera AFTER all physics are settled
        if (stationEditor.active) {
            // StationEditor controls camera
            stationEditor.update();
        } else {
            // Check for autopilot disengage (forced by proximity)
            if (flightController._wasAutopilot && !flightController.autopilot) {
                hud.addMessage("AUTOPILOT DISENGAGED: TARGET PROXIMITY.");
            }
            flightController._wasAutopilot = flightController.autopilot;

            cameraController.enabled = flightController.cameraLocked;
            if (flightController.cameraLocked) {
                cameraController.trackTarget(flightController.ship.position, flightController.ship.quaternion);
            } else {
                flightController.updateCameraPosition(delta);
            }
            flightController.updateCameraEffects(delta);
        }

        // Update Warp Points
        sectorManager.warpPoints.forEach(async wp => {
            wp.isCourseTarget = false;
            if (starMap.plannedPath.length > 1) {
                const nextSector = starMap.plannedPath[1];
                if (wp.targetLatticePos.ix === nextSector.coords.ix &&
                    wp.targetLatticePos.iy === nextSector.coords.iy &&
                    wp.targetLatticePos.iz === nextSector.coords.iz) {
                    wp.isCourseTarget = true;
                }
            }
            wp.mesh.userData.isCourseTarget = wp.isCourseTarget;
            if (wp.isCourseTarget && flightController.autopilot) {
                flightController.autopilotTarget = wp.position;
            }

            wp.update(elapsed, camera);

            // Only trigger jumps if game has started and not in cooldown
            const distToWP = flightController.ship.position.distanceTo(wp.position);
            const isLocked = sectorManager.lockedGateCoords &&
                wp.targetLatticePos.ix === sectorManager.lockedGateCoords.ix &&
                wp.targetLatticePos.iy === sectorManager.lockedGateCoords.iy &&
                wp.targetLatticePos.iz === sectorManager.lockedGateCoords.iz &&
                distToWP < sectorManager.GATE_LOCKOUT_DIST;

            // Autopilot safety: If autopilot is ON, ONLY trigger if this is the correct target
            const canTrigger = !flightController.autopilot || wp.isCourseTarget;

            // Clear lockout if we've moved away
            if (isLocked && distToWP > sectorManager.GATE_LOCKOUT_DIST + 100) {
                sectorManager.lockedGateCoords = null;
            }

            if (isStarted && (time - lastJumpTime > 3000) && distToWP < 400 && !isLocked && canTrigger) {
                lastJumpTime = time;

                const result = await executeWarpSequence({
                    wp,
                    currentLatticePos,
                    universe,
                    sectorManager,
                    starMap,
                    flightController,
                    hud,
                    nebularity,
                    tts,
                    nameGen,
                    scene
                });

                currentLatticePos = result.newLatticePos;
                currentSector = result.newSector;
            }
        });

        const targets = getInSectorTargets();

        const sectorName = nameGen.getName(currentSector.seed, 'sector');

        let target = null;
        if (currentTargetIndex >= 0 && currentTargetIndex < targets.length) {
            target = targets[currentTargetIndex];
        }

        hud.update(delta, {
            thrust: flightController.thrustInput,
            speed: flightController.velocity.length(),
            charge: flightController.charge,
            seed: sectorName,
            position: flightController.ship.position,
            ship: flightController.ship,
            targets: targets,
            target: target,
            economy: economy.getState()
        });

        targetReticle.setTarget(target);
        targetReticle.update(elapsed, delta);

        // --- Context Aware Prompts ---
        let promptKey = null;
        let promptText = null;

        let nearestPlanet = null;
        let planetDist = Infinity;
        let surfaceDist = Infinity;

        if (flightController && isStarted) {
            const shipPos = flightController.ship.position;

            // Check nearest planet
            sectorManager.planets.forEach(p => {
                const d = p.position.distanceTo(shipPos);
                if (d < planetDist) {
                    planetDist = d;
                    nearestPlanet = p;
                }
            });

            if (nearestPlanet) {
                const radius = nearestPlanet.geometry.parameters.radius;
                surfaceDist = planetDist - radius;
            }

            // Check nearest station
            let nearestStation = null;
            let stationDist = Infinity;
            sectorManager.stations.forEach(s => {
                const d = s.renderer.group.position.distanceTo(shipPos);
                if (d < stationDist) {
                    stationDist = d;
                    nearestStation = s;
                }
            });

            if (nearestStation && stationDist < 800) {
                promptKey = 'V';
                const name = nearestStation.id || "STATION";
                promptText = `INTERACT WITH ${name.toUpperCase()}`;
            } else if (nearestPlanet && surfaceDist < 400) {
                promptKey = 'B';
                const name = nearestPlanet.userData.name || "PLANET";
                promptText = `TRADE WITH ${name.toUpperCase()}`;
            }
        }
        contextUI.setPrompt(promptKey, promptText);

        if (starfield) {
            const warpFactor = flightController.warpTime > 0 ? Math.sin((flightController.warpTime / flightController.warpDuration) * Math.PI) : 0;

            let velocity = flightController.velocity;
            if (flightController.warpTime > 0) {
                velocity = new THREE.Vector3(0, 0, 100).applyQuaternion(flightController.ship.quaternion);
            }
            starfield.update(delta, camera.position, velocity, warpFactor);
        }

        if (shieldSystem) {
            shieldSystem.update(delta, elapsed, {
                thrust: flightController.thrustInput,
                speed: flightController.velocity.length(),
                nearestPlanetDist: surfaceDist,
                atmosphereThreshold: 30,
                nearestPlanetPos: nearestPlanet ? nearestPlanet.position : null,
                planetRadius: (nearestPlanet && nearestPlanet.geometry && nearestPlanet.geometry.parameters) ? nearestPlanet.geometry.parameters.radius : 0
            });
        }

        const thrustVal = flightController.thrustInput;
        thrusterMaterials.forEach(m => {
            m.uniforms.uTime.value = elapsed;
            m.uniforms.uStrength.value = m.userData.baseStrength * (0.01 + thrustVal * 0.8);
        });
        thrusterDistortionMaterials.forEach(m => {
            m.uniforms.uTime.value = elapsed;
            m.uniforms.uStrength.value = m.userData.baseStrength * (0.01 + thrustVal * 0.8);
        });

        if (isStarted && time - lastSaveTime > 2000) {
            lastSaveTime = time;
            persistence.saveState({
                latticePos: currentLatticePos,
                position: { x: flightController.ship.position.x, y: flightController.ship.position.y, z: flightController.ship.position.z },
                quaternion: { x: flightController.ship.quaternion.x, y: flightController.ship.quaternion.y, z: flightController.ship.quaternion.z, w: flightController.ship.quaternion.w },
                velocity: { x: flightController.velocity.x, y: flightController.velocity.y, z: flightController.velocity.z },
                rotationVelocity: { x: flightController.rotationVelocity.x, y: flightController.rotationVelocity.y, z: flightController.rotationVelocity.z },
                throttle: { x: flightController.throttle.x, y: flightController.throttle.y, z: flightController.throttle.z },
                plannedPath: starMap.plannedPath.map(s => s.coords),
                selectedSectorId: starMap.selectedSector ? starMap.selectedSector.id : null,
                visitedSectors: Array.from(universe.visitedSectors) || [],
                economy: economy.getState(),
                autopilot: flightController.autopilot,
                autopilotTarget: flightController.autopilotTarget ? { x: flightController.autopilotTarget.x, y: flightController.autopilotTarget.y, z: flightController.autopilotTarget.z } : null,
                cameraLocked: flightController.cameraLocked,
                cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                orbitTarget: { x: cameraController.target.x, y: cameraController.target.y, z: cameraController.target.z }
            });
        }
    }
    if (window.useDistortionEffect) {
        // 1. Render Main Scene
        camera.layers.disable(1);
        renderer.setRenderTarget(mainRenderTarget);
        renderer.clear();
        renderer.render(scene, camera);

        // 2. Render Distortion Layer
        camera.layers.enable(1);
        camera.layers.disable(0);
        const cachedBackground = scene.background;
        scene.background = null;

        renderer.setRenderTarget(motionRenderTarget);
        const oldClearAlpha = renderer.getClearAlpha();
        const oldClearColor = new THREE.Color();
        renderer.getClearColor(oldClearColor);

        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false); // Clear color, keep depth from main scene
        renderer.render(scene, camera);

        scene.background = cachedBackground;
        renderer.setClearColor(oldClearColor, oldClearAlpha);

        // 3. Resolve to Screen
        renderer.setRenderTarget(null);
        renderer.clear();
        postMaterial.uniforms.tDiffuse.value = mainRenderTarget.texture;
        postMaterial.uniforms.tDistortion.value = motionRenderTarget.texture;

        if (camera && camera.projectionMatrixInverse && camera.projectionMatrixInverse.elements) {
            postMaterial.uniforms.uProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
        }
        if (camera && camera.matrixWorld && camera.matrixWorld.elements) {
            postMaterial.uniforms.uCameraMatrixWorld.value.copy(camera.matrixWorld);
        }

        renderer.render(postScene, postCamera);

        // Restore layers
        camera.layers.enable(0);
    } else {
        // Standard Direct Rendering (Post-Processing Disabled)
        renderer.setRenderTarget(null);
        renderer.clear();
        camera.layers.enable(0);
        camera.layers.disable(1); // Hide distortion objects
        renderer.render(scene, camera);
        camera.layers.enable(0);
    }
    if (starMap.visible) {
        starMap.update(delta);
        starMap.render(renderer);
    }
}

window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (starMap && starMap.camera) {
        starMap.camera.aspect = w / h;
        starMap.camera.updateProjectionMatrix();
    }
    renderer.setSize(w, h);
    mainRenderTarget.setSize(w, h);
    motionRenderTarget.setSize(w, h);
    if (hud) hud.resize(w, h);
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyO') {
        window.useDistortionEffect = !window.useDistortionEffect;
        if (window.useDistortionEffect) {
            renderer.toneMapping = THREE.NoToneMapping;
            scene.traverse(child => { if (child.material) child.material.needsUpdate = true; });
            hud.addMessage("POST-PROCESSING: ENABLED");
        } else {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            scene.traverse(child => { if (child.material) child.material.needsUpdate = true; });
            hud.addMessage("POST-PROCESSING: DISABLED");
        }
    }

    if (e.code === 'Escape') {
        let handled = false;

        // Close Market if open
        const marketUI = document.getElementById('market-ui');
        if (marketUI && marketUI.classList.contains('active')) {
            market.close();
            handled = true;
        }

        // Close Star Map if open
        if (starMap && starMap.visible) {
            starMap.hide();
            handled = true;
        }

        // Only toggle main menu if nothing else was handled
        if (!handled) {
            document.getElementById('overlay').classList.toggle('hidden');
        }
        return;
    }

    if (!isStarted) return;

    if (e.code === 'KeyU') { // Universal Jump
        currentLatticePos = {
            ix: Math.floor((Math.random() - 0.5) * 100),
            iy: Math.floor((Math.random() - 0.5) * 100),
            iz: Math.floor((Math.random() - 0.5) * 100)
        };
        currentSector = universe.getSector(currentLatticePos.ix, currentLatticePos.iy, currentLatticePos.iz);
        universe.visitedSectors.add(currentSector.id);
        nebularity.morph(currentSector.seed, { duration: 2.0 });
        if (flightController) flightController.triggerWarp(2.0);
        hud.addMessage(`INITIATING BLIND JUMP...`);
        setTimeout(() => sectorManager.spawn(currentSector), 1000);
    }

    if (e.code === 'KeyM') {
        if (starMap.visible) {
            starMap.hide();
            window.isStarMapVisible = false;
        } else {
            starMap.show(currentSector);
            window.isStarMapVisible = true;
            // Disable mouse look when opening map
            if (flightController && flightController.mouseLookEnabled) {
                flightController.mouseLookEnabled = false;
                if (document.pointerLockElement) document.exitPointerLock();
            }
        }
    }

    if (e.code === 'KeyL') { // Mouse Look Toggle
        if (flightController) {
            flightController.mouseLookEnabled = !flightController.mouseLookEnabled;
            if (flightController.mouseLookEnabled) {
                document.body.requestPointerLock();
                hud.addMessage("MOUSE LOOK: ENABLED");
            } else {
                if (document.pointerLockElement) document.exitPointerLock();
                hud.addMessage("MOUSE LOOK: DISABLED");
            }
        }
    }

    if (e.code === 'KeyP') { // Autopilot Toggle
        if (flightController) {
            // Re-path if current position doesn't match path start
            if (starMap.selectedSector && (!starMap.plannedPath[0] || starMap.plannedPath[0].id !== currentSector.id)) {
                console.log("Autopilot: Re-pathing from current sector...");
                starMap.currentSectorOrigin = currentSector;
                starMap.calculatePath();
            }

            if (starMap.plannedPath.length <= 1) {
                const targets = getInSectorTargets();
                if (currentTargetIndex >= 0 && targets[currentTargetIndex]) {
                    const localTarget = targets[currentTargetIndex];
                    flightController.autopilot = !flightController.autopilot;
                    if (!flightController.autopilot) {
                        flightController._wasAutopilot = false;
                        flightController.throttle.set(0, 0, 0);
                    }
                    flightController.autopilotTarget = localTarget.position;
                    flightController.autopilotTargetObject = localTarget;

                    flightController.cameraLocked = flightController.autopilot;
                    cameraController.enabled = flightController.autopilot;
                    if (cameraController.enabled) {
                        cameraController.trackTarget(flightController.ship.position, flightController.ship.quaternion);
                        cameraController.update();
                    }

                    const name = localTarget.userData.name || localTarget.userData.type || "TARGET";
                    hud.addMessage(flightController.autopilot ? `AUTOPILOT ENGAGED: TARGETING ${name.toUpperCase()}` : "AUTOPILOT OFFLINE. MANUAL CONTROL.");
                } else {
                    hud.addMessage("AUTOPILOT ERROR: NO COURSE PLOTTED OR TARGET SELECTED.");
                }
            } else {
                const nextSector = starMap.plannedPath[1];
                const targetWP = sectorManager.warpPoints.find(wp =>
                    wp.targetLatticePos.ix === nextSector.coords.ix &&
                    wp.targetLatticePos.iy === nextSector.coords.iy &&
                    wp.targetLatticePos.iz === nextSector.coords.iz
                );

                if (targetWP) {
                    flightController.autopilot = !flightController.autopilot;
                    if (!flightController.autopilot) {
                        flightController._wasAutopilot = false;
                        flightController.throttle.set(0, 0, 0);
                    }
                    flightController.autopilotTarget = targetWP.position;
                    flightController.autopilotTargetObject = targetWP.mesh;

                    // Toggle Cinematic Camera
                    flightController.cameraLocked = flightController.autopilot;
                    cameraController.enabled = flightController.autopilot;
                    if (cameraController.enabled) {
                        cameraController.trackTarget(flightController.ship.position, flightController.ship.quaternion);
                        cameraController.update();
                    }

                    hud.addMessage(flightController.autopilot ? "AUTOPILOT ENGAGED. ENTERING EXTERNAL VIEW." : "AUTOPILOT OFFLINE. MANUAL CONTROL.");
                } else {
                    // Try to re-path automatically
                    const destination = starMap.plannedPath[starMap.plannedPath.length - 1];
                    hud.addMessage("OFF COURSE. ATTEMPTING TO RE-PLOT DESTINATION...");

                    starMap.currentSectorOrigin = currentSector;
                    starMap.selectedSector = destination;
                    starMap.calculatePath();

                    if (starMap.plannedPath.length > 1) {
                        const newNext = starMap.plannedPath[1];
                        // Ensure links exist for the new current sector
                        universe.generateLinks(currentSector);

                        const newTargetWP = sectorManager.warpPoints.find(wp =>
                            wp.targetLatticePos.ix === newNext.coords.ix &&
                            wp.targetLatticePos.iy === newNext.coords.iy &&
                            wp.targetLatticePos.iz === newNext.coords.iz
                        );

                        if (newTargetWP) {
                            flightController.autopilot = true;
                            flightController.autopilotTarget = newTargetWP.position;
                            flightController.cameraLocked = true;
                            cameraController.enabled = true;
                            cameraController.trackTarget(flightController.ship.position, flightController.ship.quaternion);
                            cameraController.update();
                            hud.addMessage("NEW COURSE PLOTTED. AUTOPILOT ENGAGED.");
                        } else {
                            hud.addMessage("AUTOPILOT ERROR: WARP POINT MISMATCH. MANUAL RECOVERY REQUIRED.");
                            flightController.autopilot = false;
                        }
                    } else {
                        hud.addMessage("AUTOPILOT ERROR: DESTINATION UNREACHABLE FROM CURRENT NODE.");
                        flightController.autopilot = false;
                    }
                }
            }
        }
    }

    if (e.code === 'KeyB') { // Docking / Market
        const shipPos = flightController.ship.position;
        let nearestP = null;
        let minDist = Infinity;
        sectorManager.planets.forEach(p => {
            const d = shipPos.distanceTo(p.position);
            if (d < minDist) {
                minDist = d;
                nearestP = p;
            }
        });
        const surfaceD = nearestP ? minDist - nearestP.geometry.parameters.radius : Infinity;

        if (surfaceD < 400) {
            market.open(flightController, currentSector);
        } else {
            hud.addMessage("DOCKING FAILED. TOO FAR FROM PLANET SURFACE.");
        }
    }


    if (e.code === 'KeyK' && urlParams.get('dev') === '1') { // Dev: Random Warp
        const neighbors = universe.getNeighbors(currentSector);
        //const randomNeighbor = neighbors[Math.floor(Math.random() * neighbors.length)];

        const sectors = Array.from(universe.sectors.values());
        const randomNeighbor = sectors[Math.floor(Math.random() * sectors.length)];


        currentLatticePos = randomNeighbor.coords;
        currentSector = randomNeighbor;
        universe.visitedSectors.add(currentSector.id);

        nebularity.morph(currentSector.seed, { duration: 1.0 });
        flightController.triggerWarp(1.0);
        sectorManager.spawn(currentSector, true);
        starMap.refresh(currentSector);
        hud.addMessage(`DEV: JUMPED TO ${currentSector.id}`);
    }

    if (e.code === 'Tab') { // Cycle Targets
        e.preventDefault();
        const targets = getInSectorTargets();
        if (targets.length > 0) {
            if (e.shiftKey) {
                currentTargetIndex = (currentTargetIndex <= 0) ? targets.length - 1 : currentTargetIndex - 1;
            } else {
                currentTargetIndex = (currentTargetIndex + 1) % targets.length;
            }
            const tgt = targets[currentTargetIndex];
            const name = tgt.userData.name || tgt.userData.type || "UNKNOWN";
            hud.addMessage(`TARGET ACQUIRED: ${name}`);
        } else {
            currentTargetIndex = -1;
            hud.addMessage(`NO TARGETS IN RANGE.`);
        }
    }

    if (e.code === 'KeyV') { // Station Editor Toggle
        if (stationEditor.active) {
            stationEditor.deactivate();
            hud.addMessage("STATION EDITOR: OFFLINE.");
            if (flightController) flightController.cameraLocked = false;
        } else {
            const shipPos = flightController.ship.position;
            let nearestStation = null;
            let minDist = Infinity;
            if (sectorManager.stations) {
                sectorManager.stations.forEach(s => {
                    const dist = shipPos.distanceTo(s.renderer.group.position);
                    if (dist < minDist) {
                        minDist = dist;
                        nearestStation = s;
                    }
                });
            }

            if (nearestStation && minDist < 800) {
                stationEditor.activate(nearestStation);
                hud.addMessage("STATION EDITOR: ONLINE.");
            } else {
                hud.addMessage("STATION EDITOR: NO STATION IN RANGE.");
            }
        }
    }
}); // End of keydown listener
