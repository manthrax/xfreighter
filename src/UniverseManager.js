import * as THREE from 'three';

/**
 * UniverseManager: Handles the procedural generation of the galactic lattice.
 * Optimized for organic, non-grid layouts using Prim's-inspired connectivity.
 */
export default class UniverseManager {
    constructor(globalSeed = "nebula-drift-v2") {
        this.globalSeed = globalSeed;
        this.sectors = new Map();
        this.visitedSectors = new Set();
        this.spacing = 10000;
    }

    /**
     * Get or generate a sector at lattice coordinates (ix, iy, iz)
     */
    getSector(ix, iy, iz) {
        const key = `${ix},${iy},${iz}`;
        if (this.sectors.has(key)) return this.sectors.get(key);

        const seedStr = `${this.globalSeed}-${key}`;
        const rng = this._getRNG(seedStr);

        // Heavy perturbation for a more "randomized" look
        const perturbation = 0.9;
        const pos = new THREE.Vector3(
            (ix + (rng() - 0.5) * perturbation) * this.spacing,
            (iy + (rng() - 0.5) * perturbation) * this.spacing,
            (iz + (rng() - 0.5) * perturbation) * this.spacing
        );

        const lums = ["High", "Medium", "Low", "Faint"];
        const stabs = ["Stable", "Unstable", "Volatile", "Chaotic"];
        const res = ["Abundant", "Standard", "Scarce", "Depleted"];

        const sector = {
            id: key,
            coords: { ix, iy, iz },
            pos: pos,
            seed: Math.floor(rng() * 0xFFFFFF).toString(16),
            name: "UNEXPLORED",
            links: [],
            planetCount: Math.floor(rng() * 8) + 2, // 2-10 planets
            attributes: {
                luminosity: lums[Math.floor(rng() * lums.length)],
                stability: stabs[Math.floor(rng() * stabs.length)],
                resources: res[Math.floor(rng() * res.length)]
            },
            market: {
                needs: [],
                exports: []
            }
        };

        // Determine trade needs/exports based on seed
        const commodities = ["ORE", "FUEL", "FOOD", "TECH", "LUXURY"];
        const exportIdx = Math.floor(rng() * commodities.length);
        const needIdx = (exportIdx + 1 + Math.floor(rng() * (commodities.length - 1))) % commodities.length;
        sector.market.exports.push(commodities[exportIdx]);
        sector.market.needs.push(commodities[needIdx]);

        this.sectors.set(key, sector);
        return sector;
    }

    /**
     * Generate links using a localized Prim's / MST approach.
     * Guarantees global connectivity by ensuring a "backbone" link 
     * while maintaining an organic randomized layout.
     */
    generateLinks(sector) {
        if (sector.linksGenerated) return;
        sector.linksGenerated = true;

        const { ix, iy, iz } = sector.coords;
        const allCandidates = [];

        // Check a 3x3x3 neighborhood
        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                for (let z = -1; z <= 1; z++) {
                    if (x === 0 && y === 0 && z === 0) continue;
                    allCandidates.push(this.getSector(ix + x, iy + y, iz + z));
                }
            }
        }

        // Sort all candidates by distance
        allCandidates.sort((a, b) => sector.pos.distanceTo(a.pos) - sector.pos.distanceTo(b.pos));

        // 1. Primary Organic Links (Nearest neighbors)
        const rng = this._getRNG(`${this.globalSeed}-links-${sector.id}`);
        // Ensure every star at least tries to initiate 1-2 links of its own
        const primaryCount = rng() > 0.4 ? 2 : 1;

        for (let i = 0; i < primaryCount; i++) {
            this._addLink(sector, allCandidates[i]);
        }

        // 2. Connectivity Backbone
        // Every star ensures it has a link toward a "forward" cell.
        const backboneCandidates = allCandidates.filter(c =>
            (c.coords.ix > ix) ||
            (c.coords.ix === ix && c.coords.iy > iy) ||
            (c.coords.ix === ix && c.coords.iy === iy && c.coords.iz > iz)
        );

        if (backboneCandidates.length > 0) {
            this._addLink(sector, backboneCandidates[0]);
        }

        // 3. Optional "Flavor" loops for more paths
        if (rng() < 0.3) {
            this._addLink(sector, allCandidates[Math.min(3, allCandidates.length - 1)]);
        }

        // 4. Safety Backbone: Guarantee at least one link exists
        if (sector.links.length === 0 && allCandidates.length > 0) {
            this._addLink(sector, allCandidates[0]);
        }
    }

    _addLink(s1, s2) {
        if (!s1 || !s2) return;
        if (!s1.links.includes(s2.id)) s1.links.push(s2.id);
        if (!s2.links.includes(s1.id)) s2.links.push(s1.id);
    }

    getNeighbors(sector) {
        // Ensure this sector has its own links generated
        this.generateLinks(sector);
        
        // CRITICAL: Ensure all 26 adjacent sectors have also generated their links.
        // This prevents the "Warp Point Mismatch" error where the pathfinder discovers 
        // a link back to the current sector that wasn't there when the sector was spawned.
        const { ix, iy, iz } = sector.coords;
        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                for (let z = -1; z <= 1; z++) {
                    if (x === 0 && y === 0 && z === 0) continue;
                    const neighbor = this.getSector(ix + x, iy + y, iz + z);
                    this.generateLinks(neighbor);
                }
            }
        }

        return sector.links.map(id => this.sectors.get(id));
    }

    _getRNG(seedStr) {
        let hash = 0;
        for (let i = 0; i < seedStr.length; i++) hash = (hash << 5) - hash + seedStr.charCodeAt(i);
        return () => {
            hash = (hash * 1664525 + 1013904223) % 4294967296;
            return Math.abs(hash / 4294967296);
        };
    }
}
