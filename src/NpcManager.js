import * as THREE from 'three';

/**
 * NpcManager: Handles AI-driven ships throughout the universe.
 * Manages both 'active' ships (rendered in current sector) and 'passive' ships (statistically simulated).
 */
export default class NpcManager {
    constructor(deps) {
        this.scene = deps.scene;
        this.universe = deps.universe;
        this.shipLibrary = deps.shipLibrary;
        this.hud = deps.hud;
        this.sectorManager = deps.sectorManager;

        this.npcs = []; // Array of NPC state objects
        this.activeNpcs = new Map(); // npcId -> mesh instance
        this.npcMeshes = new THREE.Group();
        this.scene.add(this.npcMeshes);

        this.initNpcs(30); // Start with 30 AI ships
    }

    initNpcs(count) {
        const sectorKeys = Array.from(this.universe.sectors.keys());
        const shipTypes = Object.keys(this.shipLibrary);

        for (let i = 0; i < count; i++) {
            const startSectorId = sectorKeys[Math.floor(Math.random() * sectorKeys.length)];
            const shipType = shipTypes[Math.floor(Math.random() * shipTypes.length)];
            
            const npc = {
                id: 'npc_' + i,
                type: shipType,
                currentSectorId: startSectorId,
                targetSectorId: null,
                path: [],
                pos: new THREE.Vector3(
                    (Math.random() - 0.5) * 6000,
                    (Math.random() - 0.5) * 1000,
                    (Math.random() - 0.5) * 6000
                ),
                velocity: new THREE.Vector3(),
                quaternion: new THREE.Quaternion(),
                state: 'idle', // idle, traveling, docking, docked
                lastActionTime: Date.now(),
                transitDuration: 20000, // 20 seconds fixed for map syncing
                speed: 150 + Math.random() * 150,
                dockedStationId: null
            };
            
            this.npcs.push(npc);
            this.planNextMove(npc);
        }
    }

    planNextMove(npc) {
        const currentSector = this.universe.sectors.get(npc.currentSectorId);
        if (!currentSector) return;

        // Choose a random destination some distance away
        const allSectors = Array.from(this.universe.sectors.values());
        let destination = allSectors[Math.floor(Math.random() * allSectors.length)];
        
        // Simple Breadth-First Pathfinding (placeholder for full A*)
        // Since the map is small or lattice-based, we'll just pick a neighbor for now
        // to simulate "traveling paths"
        const neighbors = this.universe.getNeighbors(currentSector);
        if (neighbors.length > 0) {
            const target = neighbors[Math.floor(Math.random() * neighbors.length)];
            npc.targetSectorId = target.id;
            npc.state = 'traveling';
            npc.lastActionTime = Date.now();
        }
    }

    update(delta, currentSectorId) {
        const now = Date.now();

        this.npcs.forEach(npc => {
            // --- Statistical Universal Simulation ---
            if (npc.state === 'traveling') {
                if (now - npc.lastActionTime > npc.transitDuration) {
                    npc.currentSectorId = npc.targetSectorId;
                    npc.state = 'idle';
                    npc.lastActionTime = now;
                    
                    // Reset position when entering a new sector
                    npc.pos.set(
                        (Math.random() - 0.5) * 10000,
                        (Math.random() - 0.5) * 2000,
                        (Math.random() - 0.5) * 10000
                    );
                }
            } else if (npc.state === 'docked') {
                if (now - npc.lastActionTime > 15000) { // Stay docked for 15s
                    npc.state = 'idle';
                    npc.lastActionTime = now;
                }
            } else if (npc.state === 'idle') {
                if (now - npc.lastActionTime > 5000) {
                    this.planNextMove(npc);
                }
            }

            // --- Local Sector Simulation ---
            if (npc.currentSectorId === currentSectorId) {
                this.updateLocalNpc(npc, delta, currentSectorId);
            }
        });

        this.syncMeshes(currentSectorId);
    }

    updateLocalNpc(npc, delta, currentSectorId) {
        if (npc.state === 'docked') return;

        // Target logic
        let targetPos = new THREE.Vector3(0, 0, 0);
        
        // If there's a station, head towards it to 'dock'
        if (this.sectorManager.stations && this.sectorManager.stations.length > 0) {
            const station = this.sectorManager.stations[0];
            targetPos.copy(station.position);
            
            const dist = npc.pos.distanceTo(targetPos);
            if (dist < 300) {
                npc.state = 'docked';
                npc.lastActionTime = Date.now();
                return;
            }
        } else {
            // Random patrol point
            const time = Date.now() * 0.001;
            targetPos.set(
                Math.sin(time * 0.1 + parseInt(npc.id.split('_')[1])) * 5000,
                0,
                Math.cos(time * 0.1 + parseInt(npc.id.split('_')[1])) * 5000
            );
        }

        // Steer towards target
        const desiredVelocity = targetPos.clone().sub(npc.pos).normalize().multiplyScalar(npc.speed);
        const steering = desiredVelocity.sub(npc.velocity).multiplyScalar(delta * 0.5);
        npc.velocity.add(steering);
        npc.pos.add(npc.velocity.clone().multiplyScalar(delta));

        // Update rotation to face velocity
        if (npc.velocity.lengthSq() > 0.1) {
            const lookMat = new THREE.Matrix4().lookAt(
                npc.pos,
                npc.pos.clone().add(npc.velocity),
                new THREE.Vector3(0, 1, 0)
            );
            npc.quaternion.setFromRotationMatrix(lookMat);
        }
    }

    syncMeshes(currentSectorId) {
        // 1. Remove meshes for NPCs no longer in sector or missing
        for (const [id, mesh] of this.activeNpcs.entries()) {
            const npc = this.npcs.find(n => n.id === id);
            if (!npc || npc.currentSectorId !== currentSectorId || npc.state === 'docked') {
                this.npcMeshes.remove(mesh);
                this.activeNpcs.delete(id);
            }
        }

        // 2. Add/Update meshes for NPCs in sector
        this.npcs.forEach(npc => {
            if (npc.currentSectorId === currentSectorId && npc.state !== 'docked') {
                let mesh = this.activeNpcs.get(npc.id);
                if (!mesh) {
                    mesh = this.createNpcMesh(npc);
                    this.activeNpcs.set(npc.id, mesh);
                    this.npcMeshes.add(mesh);
                }
                mesh.position.copy(npc.pos);
                mesh.quaternion.copy(npc.quaternion);
            }
        });
    }

    createNpcMesh(npc) {
        const proto = this.shipLibrary[npc.type] || this.shipLibrary.freighter;
        const mesh = proto.clone(true);
        mesh.scale.setScalar(0.25);
        
        // Add some metadata for HUD
        mesh.userData.type = 'npc';
        mesh.userData.name = `AIC ${npc.id.toUpperCase()}`;
        mesh.userData.npcId = npc.id;
        
        // Brighten up the NPC materials so they are distinct
        mesh.traverse(c => {
            if (c.isMesh && c.material) {
                c.material = c.material.clone();
                c.material.emissive = new THREE.Color(0x002244);
                c.material.emissiveIntensity = 0.5;
            }
        });
        
        return mesh;
    }
}
