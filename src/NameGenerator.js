/**
 * NameGenerator: Procedurally generates space-themed names based on a seed.
 */
export default class NameGenerator {
    constructor() {
        this.prefixes = [
            "Acheron", "Boreas", "Calyx", "Echelon", "Flux", "Golgotha", "Hades",
            "Krios", "Lethe", "Mantle", "Node", "Obsidian", "Phyx",
            "Quasar", "Styx", "Tensor", "Umbra", "Warp", "Xeno"
        ];

        this.roots = [
            "Anomalon", "Bastion", "Crateris", "Desolation", "Endymion", "Foundry", "Gauntlet",
            "Helios", "Ironclad", "Kyber", "Labyrinth", "Monolith", "Nemesis",
            "Obelisk", "Pillar", "Ragnarok", "Shatter", "Terminal", "Underworld"
        ];

        this.suffixes = [
            "Apex", "Breach", "Cradle", "Descent", "Exclusion", "Falls", "Grave", "Hollow",
            "Irradiance", "Jaw", "Killzone", "Legacy", "Margin", "Null", "Orbit", "Pyre",
            "Quarry", "Ridge", "Silence", "Threshold", "Utmost", "Vantage", "Well"
        ];
    }

    _getRNG(seed) {
        let val = 0;
        if (typeof seed === 'string') {
            for (let i = 0; i < seed.length; i++) val = (val << 5) - val + seed.charCodeAt(i);
        } else {
            val = seed;
        }
        return () => {
            val = (val * 1664525 + 1013904223) % 4294967296;
            return Math.abs(val / 4294967296);
        };
    }

    generateSectorName(seed) {
        const rng = this._getRNG(seed);
        const p = this.prefixes[Math.floor(rng() * this.prefixes.length)];
        const r = this.roots[Math.floor(rng() * this.roots.length)];
        const num = Math.floor(rng() * 999);

        const patterns = [
            `${p}-${num} ${r}`,
            `${r} ${p}`,
            `${p} ${r} Cluster`,
            `Sector ${num}-${p}`
        ];

        return patterns[Math.floor(rng() * patterns.length)];
    }

    // Actually, let's make it more robust
    getName(seed, type = 'sector') {
        const rng = this._getRNG(seed);
        const p = this.prefixes[Math.floor(rng() * this.prefixes.length)];
        const r = this.roots[Math.floor(rng() * this.roots.length)];
        const s = this.suffixes[Math.floor(rng() * this.suffixes.length)];
        const num = Math.floor(rng() * 100);

        if (type === 'sector') {
            const patterns = [
                `${p}-${num} ${r}`,
                `${r} ${s}`,
                `${p} ${r} ${num}`,
                `SECTOR ${p}-${num}`,
                `${r} EXCLUSION ZONE`,
                `${p} ARRAY ${num}`,
                `${r} RELAY ${p}`
            ];
            return patterns[Math.floor(rng() * patterns.length)].toUpperCase();
        } else {
            const patterns = [
                `${r}-${num}`,
                `${r} ${s}`,
                `${p} ${r}`,
                `${r} ${num}${s.charAt(0)}`,
                `SITE ${num}-${r}`,
                `${p} ${r} ${s}`,
                `${r} ${s} IV`
            ];
            return patterns[Math.floor(rng() * patterns.length)].toUpperCase();
        }
    }
}
