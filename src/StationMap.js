export default class StationMap {
    constructor(seed, rng) {
        this.seed = seed;
        this.rng = rng;
        // Map of "x,y,z" to cell object
        this.cells = new Map();
        
        // List of all component instances: { id, type, x, y, z, rotation }
        this.components = [];
        this.nextComponentId = 1;

        this.generate();
    }

    addComponent(type, x, y, z, rotation) {
        const id = this.nextComponentId++;
        const comp = { id, type, x, y, z, rotation };
        this.components.push(comp);
        return comp;
    }

    removeComponent(id) {
        const index = this.components.findIndex(c => c.id === id);
        if (index !== -1) {
            this.components.splice(index, 1);
            return true;
        }
        return false;
    }

    generate() {
        const width = 10 + Math.floor(this.rng() * 20); // 10 to 30
        const height = 10 + Math.floor(this.rng() * 20); // 10 to 30

        const grid = [];
        for (let x = 0; x < width; x++) {
            grid[x] = [];
            for (let z = 0; z < height; z++) {
                grid[x][z] = 0; // 0 = empty, 1 = floor
            }
        }

        // Simple BSP or random walk? Let's do a few rectangular rooms and corridors
        const numRooms = 3 + Math.floor(this.rng() * 4);
        const rooms = [];

        for (let i = 0; i < numRooms; i++) {
            const rw = 3 + Math.floor(this.rng() * 5);
            const rh = 3 + Math.floor(this.rng() * 5);
            const rx = 1 + Math.floor(this.rng() * (width - rw - 2));
            const rz = 1 + Math.floor(this.rng() * (height - rh - 2));

            // check overlap (simple version, allow overlap)
            for (let x = rx; x < rx + rw; x++) {
                for (let z = rz; z < rz + rh; z++) {
                    grid[x][z] = 1;
                }
            }
            rooms.push({ x: rx, z: rz, w: rw, h: rh, cx: rx + Math.floor(rw / 2), cz: rz + Math.floor(rh / 2) });
        }

        // Connect rooms with corridors
        for (let i = 1; i < rooms.length; i++) {
            let cx1 = rooms[i - 1].cx;
            let cz1 = rooms[i - 1].cz;
            let cx2 = rooms[i].cx;
            let cz2 = rooms[i].cz;

            // L-shaped corridor
            if (this.rng() > 0.5) {
                for (let x = Math.min(cx1, cx2); x <= Math.max(cx1, cx2); x++) grid[x][cz1] = 1;
                for (let z = Math.min(cz1, cz2); z <= Math.max(cz1, cz2); z++) grid[cx2][z] = 1;
            } else {
                for (let z = Math.min(cz1, cz2); z <= Math.max(cz1, cz2); z++) grid[cx1][z] = 1;
                for (let x = Math.min(cx1, cx2); x <= Math.max(cx1, cx2); x++) grid[x][cz2] = 1;
            }
        }

        // Convert grid to components
        const offset_x = -width / 2;
        const offset_z = -height / 2;

        for (let x = 0; x < width; x++) {
            for (let z = 0; z < height; z++) {
                if (grid[x][z] === 1) {
                    const wx = x + offset_x;
                    const wz = z + offset_z;

                    // Floor
                    this.addComponent('floor', wx, 0, wz, 0);

                    // Check neighbors for walls
                    const nTop = z > 0 ? grid[x][z - 1] : 0;
                    const nBottom = z < height - 1 ? grid[x][z + 1] : 0;
                    const nLeft = x > 0 ? grid[x - 1][z] : 0;
                    const nRight = x < width - 1 ? grid[x + 1][z] : 0;

                    if (nTop === 0) this.addComponent('wall', wx, 0, wz - 0.5, 0);
                    if (nBottom === 0) this.addComponent('wall', wx, 0, wz + 0.5, Math.PI);
                    if (nLeft === 0) this.addComponent('wall', wx - 0.5, 0, wz, Math.PI / 2);
                    if (nRight === 0) this.addComponent('wall', wx + 0.5, 0, wz, -Math.PI / 2);
                }
            }
        }

        // Add some props
        rooms.forEach(room => {
            const propCount = 1 + Math.floor(this.rng() * 3);
            for (let i = 0; i < propCount; i++) {
                const px = room.x + 1 + Math.floor(this.rng() * (room.w - 2));
                const pz = room.z + 1 + Math.floor(this.rng() * (room.h - 2));
                
                const propTypes = ['computer', 'bed-single', 'table'];
                const prop = propTypes[Math.floor(this.rng() * propTypes.length)];
                
                const rotations = [0, Math.PI/2, Math.PI, -Math.PI/2];
                const rot = rotations[Math.floor(this.rng() * rotations.length)];
                
                this.addComponent(prop, px + offset_x, 0, pz + offset_z, rot);
            }
        });
    }
}
