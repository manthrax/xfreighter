import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

/**
 * StarMap: Renders a 3D navigational overlay of the discovered galaxy.
 */
export default class StarMap {
    constructor(renderer, universe) {
        this.renderer = renderer;
        this.universe = universe;
        this.visible = false;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);

        this.container = new THREE.Group();
        this.scene.add(this.container);

        this.lineMat = new THREE.LineBasicMaterial({ color: 0x224466, transparent: true, opacity: 0.5, toneMapped: false, blending: THREE.AdditiveBlending });
        this.pathMat = new THREE.LineBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 1.0, toneMapped: false, blending: THREE.AdditiveBlending });

        this.nodeGeo = new THREE.SphereGeometry(250, 12, 12); // Slightly larger for better clicking

        // Instanced Rendering for Performance
        this.maxNodes = 2000;
        this.instancedNodes = new THREE.InstancedMesh(
            this.nodeGeo,
            new THREE.MeshBasicMaterial({ toneMapped: false, blending: THREE.AdditiveBlending }),
            this.maxNodes
        );
        this.instancedNodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.instancedNodes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxNodes * 3), 3);
        this.container.add(this.instancedNodes);

        this.nodeSectors = []; // Map instance index back to sector data
        this.currentNodeIndex = -1;

        // NPC Tracking on Map (Dev Mode)
        this.npcDotGeo = new THREE.SphereGeometry(120, 8, 8);
        this.npcDots = new THREE.InstancedMesh(
            this.npcDotGeo,
            new THREE.MeshBasicMaterial({ color: 0xff3333, toneMapped: false, blending: THREE.AdditiveBlending }),
            100 // Max NPCs on map
        );
        this.npcDots.renderOrder = 2;
        this.container.add(this.npcDots);
        
        const urlParams = new URLSearchParams(window.location.search);
        this.devMode = urlParams.has('dev');
        this.npcDots.visible = this.devMode;

        // Interaction
        this.controls = new OrbitControls(this.camera, renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.enabled = false;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.selectedSector = null;
        this.plannedPath = [];
        this.onSectorSelected = null; // Callback for UI

        // Dimming Background
        const dimGeo = new THREE.PlaneGeometry(1000, 1000);
        const dimMat = new THREE.MeshBasicMaterial({
            color: 0x00050a,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            depthTest: false,
            toneMapped: false
        });
        this.dimmer = new THREE.Mesh(dimGeo, dimMat);
        this.dimmer.renderOrder = -1;
        this.dimmerScene = new THREE.Scene()
        this.dimmerScene.add(this.dimmer);

        this.container.renderOrder = 1;

        // Scratch objects for matrix updates
        this._dummy = new THREE.Object3D();
        this._color = new THREE.Color();

        window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    }

    onMouseDown(event) {
        if (!this.visible) return;

        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.instancedNodes);

        if (intersects.length > 0) {
            const instanceId = intersects[0].instanceId;
            const sector = this.nodeSectors[instanceId];
            if (sector) this.selectSector(sector);
        }
    }

    selectSector(sector) {
        this.selectedSector = sector;
        this.calculatePath();
        this.refresh(this.currentSectorOrigin);
        if (this.onSectorSelected) this.onSectorSelected(sector, this.plannedPath);
    }

    calculatePath() {
        if (!this.selectedSector || !this.currentSectorOrigin) {
            this.plannedPath = [];
            return;
        }

        // A* Pathfinding for more robust long-range navigation
        const start = this.currentSectorOrigin;
        const goal = this.selectedSector;
        
        const openSet = [start];
        const cameFrom = new Map();
        
        const gScore = new Map(); // Cost from start to current node
        gScore.set(start.id, 0);
        
        const fScore = new Map(); // Estimated total cost (gScore + heuristic)
        fScore.set(start.id, start.pos.distanceTo(goal.pos));

        let iterations = 0;
        const MAX_ITERATIONS = 5000;

        while (openSet.length > 0 && iterations < MAX_ITERATIONS) {
            iterations++;
            
            // Get node with lowest fScore
            openSet.sort((a, b) => fScore.get(a.id) - fScore.get(b.id));
            const current = openSet.shift();

            if (current.id === goal.id) {
                // Reconstruct path
                const path = [current];
                let temp = current;
                while (cameFrom.has(temp.id)) {
                    temp = cameFrom.get(temp.id);
                    path.unshift(temp);
                }
                this.plannedPath = path;
                return;
            }

            const neighbors = this.universe.getNeighbors(current);
            for (let neighbor of neighbors) {
                const tentativeGScore = gScore.get(current.id) + current.pos.distanceTo(neighbor.pos);
                
                if (!gScore.has(neighbor.id) || tentativeGScore < gScore.get(neighbor.id)) {
                    cameFrom.set(neighbor.id, current);
                    gScore.set(neighbor.id, tentativeGScore);
                    fScore.set(neighbor.id, tentativeGScore + neighbor.pos.distanceTo(goal.pos));
                    
                    if (!openSet.find(n => n.id === neighbor.id)) {
                        openSet.push(neighbor);
                    }
                }
            }
        }

        console.warn("A* Search failed to find path within limit or no path exists.");
        this.plannedPath = [];
    }

    show(currentSector) {
        this.currentSectorOrigin = currentSector;
        this.visible = true;
        this.controls.enabled = true;
        this.refresh(currentSector);

        // Focus on current sector
        this.camera.position.copy(currentSector.pos).add(new THREE.Vector3(0, 5000, 10000));
        this.controls.target.copy(currentSector.pos);
        this.controls.update();

        // Position dimmer
        this.dimmer.scale.set(100, 100, 1);
    }

    hide() {
        this.visible = false;
        this.controls.enabled = false;
        document.getElementById('map-sidebar').classList.add('hidden');
    }

    refresh(currentSector) {
        this.currentSectorOrigin = currentSector;

        // Clean up previous lines only (InstancedMesh stays)
        const toRemove = [];
        this.container.traverse(child => {
            if (child.isLineSegments) toRemove.push(child);
        });
        toRemove.forEach(child => {
            child.geometry.dispose();
            this.container.remove(child);
        });

        this.nodeSectors = [];
        this.currentNodeIndex = -1;

        const { ix, iy, iz } = currentSector.coords;
        const range = 5;
        let nodeCount = 0;

        const linePositions = [];
        const pathLinePositions = [];

        // Pre-fetch colors to avoid object creation in loop
        const colors = {
            node: new THREE.Color(0x224466),
            visited: new THREE.Color(0xffaa00),
            current: new THREE.Color(0xffffff),
            selected: new THREE.Color(0x00ffaa),
            market: {
                ORE: new THREE.Color(0x888888),
                FUEL: new THREE.Color(0xffaa00),
                FOOD: new THREE.Color(0x00ff00),
                TECH: new THREE.Color(0x00ffff),
                LUXURY: new THREE.Color(0xff00ff)
            }
        };

        for (let x = ix - range; x <= ix + range; x++) {
            for (let y = iy - range; y <= iy + range; y++) {
                for (let z = iz - range; z <= iz + range; z++) {
                    if (nodeCount >= this.maxNodes) break;

                    const s = this.universe.getSector(x, y, z);
                    this.universe.generateLinks(s);

                    // Determine node color
                    let col = colors.node;
                    const isPartOfPath = this.plannedPath.some(p => p.id === s.id);

                    if (s.id === currentSector.id) {
                        col = colors.current;
                        this.currentNodeIndex = nodeCount;
                    }
                    else if (isPartOfPath) col = colors.selected;
                    else if (this.universe.visitedSectors.has(s.id)) col = colors.visited;

                    // Update Instance
                    this._dummy.position.copy(s.pos);
                    const scale = 0.5 + (s.planetCount / 10.0); // Size represents planet count
                    this._dummy.scale.set(scale, scale, scale);
                    this._dummy.updateMatrix();
                    this.instancedNodes.setMatrixAt(nodeCount, this._dummy.matrix);

                    // Add market color hint if visited
                    if (this.universe.visitedSectors.has(s.id)) {
                        const exportType = s.market.exports[0];
                        const baseCol = colors.market[exportType] || colors.visited;
                        this.instancedNodes.setColorAt(nodeCount, baseCol);
                    } else {
                        this.instancedNodes.setColorAt(nodeCount, col);
                    }

                    this.nodeSectors[nodeCount] = s;
                    nodeCount++;

                    s.links.forEach(neighborId => {
                        const neighbor = this.universe.sectors.get(neighborId);
                        if (neighbor) {
                            let isPath = false;
                            for (let i = 0; i < this.plannedPath.length - 1; i++) {
                                if ((this.plannedPath[i].id === s.id && this.plannedPath[i + 1].id === neighbor.id) ||
                                    (this.plannedPath[i].id === neighbor.id && this.plannedPath[i + 1].id === s.id)) {
                                    isPath = true;
                                    break;
                                }
                            }

                            if (isPath) {
                                pathLinePositions.push(s.pos.x, s.pos.y, s.pos.z);
                                pathLinePositions.push(neighbor.pos.x, neighbor.pos.y, neighbor.pos.z);
                            } else {
                                linePositions.push(s.pos.x, s.pos.y, s.pos.z);
                                linePositions.push(neighbor.pos.x, neighbor.pos.y, neighbor.pos.z);
                            }
                        }
                    });
                }
            }
        }

        // Hide unused instances
        this._dummy.scale.set(0, 0, 0);
        this._dummy.updateMatrix();
        for (let i = nodeCount; i < this.maxNodes; i++) {
            this.instancedNodes.setMatrixAt(i, this._dummy.matrix);
        }

        this.instancedNodes.count = nodeCount;
        this.instancedNodes.instanceMatrix.needsUpdate = true;
        if (this.instancedNodes.instanceColor) this.instancedNodes.instanceColor.needsUpdate = true;

        if (linePositions.length > 0) {
            const lines = new THREE.LineSegments(
                new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3)),
                this.lineMat
            );
            this.container.add(lines);
        }

        if (pathLinePositions.length > 0) {
            const pathLines = new THREE.LineSegments(
                new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pathLinePositions, 3)),
                this.pathMat
            );
            this.container.add(pathLines);
        }
    }

    render(renderer) {
        if (!this.visible) return;
        renderer.clearDepth();
        renderer.render(this.dimmerScene, this.camera);
        renderer.render(this.scene, this.camera);
    }

    update(delta, npcManager) {
        if (!this.visible) return;
        if (this.controls.enabled) {
            this.controls.update();
        }

        // --- Update NPC Icons ---
        if (npcManager) {
            npcManager.npcs.forEach((npc, i) => {
                const startSector = this.universe.sectors.get(npc.currentSectorId);
                const endSector = npc.targetSectorId ? this.universe.sectors.get(npc.targetSectorId) : startSector;

                if (startSector && endSector) {
                    let pos = startSector.pos.clone();
                    if (npc.state === 'traveling') {
                        const alpha = (Date.now() - npc.lastActionTime) / npc.transitDuration;
                        pos.lerp(endSector.pos, THREE.MathUtils.clamp(alpha, 0, 1));
                    }
                    this._dummy.position.copy(pos);
                    this._dummy.scale.set(1, 1, 1);
                    this._dummy.updateMatrix();
                    this.npcDots.setMatrixAt(i, this._dummy.matrix);
                } else {
                    // Hide if not valid
                    this._dummy.scale.set(0, 0, 0);
                    this._dummy.updateMatrix();
                    this.npcDots.setMatrixAt(i, this._dummy.matrix);
                }
            });
            this.npcDots.instanceMatrix.needsUpdate = true;
        }

        // Pulse Current and Selected Nodes
        const pulse = 1.0 + Math.sin(performance.now() * 0.005) * 0.2;
        let matrixNeedsUpdate = false;

        if (this.currentNodeIndex !== -1) {
            const s = this.nodeSectors[this.currentNodeIndex];
            if (s) {
                this._dummy.position.copy(s.pos);
                const baseScale = 0.5 + (s.planetCount / 10.0);
                this._dummy.scale.set(baseScale * 1.5 * pulse, baseScale * 1.5 * pulse, baseScale * 1.5 * pulse);
                this._dummy.updateMatrix();
                this.instancedNodes.setMatrixAt(this.currentNodeIndex, this._dummy.matrix);
                matrixNeedsUpdate = true;
            }
        }

        if (this.selectedSector) {
            // Find instance index for selected sector
            const selectedIdx = this.nodeSectors.findIndex(s => s && s.id === this.selectedSector.id);
            if (selectedIdx !== -1 && selectedIdx !== this.currentNodeIndex) {
                const s = this.nodeSectors[selectedIdx];
                this._dummy.position.copy(s.pos);
                const baseScale = 0.5 + (s.planetCount / 10.0);
                this._dummy.scale.set(baseScale * 1.2 * pulse, baseScale * 1.2 * pulse, baseScale * 1.2 * pulse);
                this._dummy.updateMatrix();
                this.instancedNodes.setMatrixAt(selectedIdx, this._dummy.matrix);
                matrixNeedsUpdate = true;
            }
        }

        if (matrixNeedsUpdate) {
            this.instancedNodes.instanceMatrix.needsUpdate = true;
        }

        // Position dimmer
        this.dimmer.position.copy(this.camera.position).add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(100));
        this.dimmer.quaternion.copy(this.camera.quaternion);
    }
}
