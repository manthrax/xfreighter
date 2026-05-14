import * as THREE from 'three';

const dummy = new THREE.Object3D();

export default class StationRenderer {
    constructor(scene, stationMap, stationLibrary) {
        this.scene = scene;
        this.stationMap = stationMap;
        this.stationLibrary = stationLibrary;

        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.instanceIds = new Map(); // component.id -> instanceId

        this.initBatchedMesh();
        this.renderMap();
    }

    initBatchedMesh() {
        // 1. Collect all unique materials
        this.uniqueMaterials = [];
        const materialToId = new Map();

        for (const [name, mesh] of Object.entries(this.stationLibrary)) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach(mat => {
                if (mat && !materialToId.has(mat)) {
                    materialToId.set(mat, this.uniqueMaterials.length);
                    this.uniqueMaterials.push(mat);
                }
            });
        }

        // 2. Create one BatchedMesh per material
        this.batchedMeshes = [];
        this.materialBatchedMeshMap = new Map();

        const maxInstances = 5000;
        let totalVertices = 0;
        let totalIndices = 0;
        for (const [name, mesh] of Object.entries(this.stationLibrary)) {
            totalVertices += mesh.geometry.attributes.position.count;
            totalIndices += mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count;
        }

        this.uniqueMaterials.forEach((mat, idx) => {
            const bm = new THREE.BatchedMesh(maxInstances, totalVertices, totalIndices, mat);
            bm.frustumCulled = false;
            this.group.add(bm);
            this.batchedMeshes.push(bm);
            this.materialBatchedMeshMap.set(idx, bm);
        });

        // 3. Register Geometries
        this.typeParts = new Map();

        for (const [name, mesh] of Object.entries(this.stationLibrary)) {
            const geo = mesh.geometry;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const parts = [];

            if (geo.groups && geo.groups.length > 0) {
                geo.groups.forEach((group, i) => {
                    const subGeo = new THREE.BufferGeometry();
                    subGeo.setAttribute('position', geo.getAttribute('position'));
                    if (geo.getAttribute('normal')) subGeo.setAttribute('normal', geo.getAttribute('normal'));
                    if (geo.getAttribute('uv')) subGeo.setAttribute('uv', geo.getAttribute('uv'));
                    if (geo.index) subGeo.setIndex(geo.index);
                    subGeo.setDrawRange(group.start, group.count);
                    subGeo.computeBoundingBox();
                    subGeo.computeBoundingSphere();

                    const mat = mats[i] || mats[0];
                    const matIdx = materialToId.get(mat);
                    const bm = this.materialBatchedMeshMap.get(matIdx);

                    const geoId = bm.addGeometry(subGeo);
                    parts.push({ batchedMesh: bm, geometryId: geoId });
                });
            } else {
                const subGeo = geo.clone();
                subGeo.computeBoundingBox();
                subGeo.computeBoundingSphere();
                const matIdx = materialToId.get(mats[0]);
                const bm = this.materialBatchedMeshMap.get(matIdx);
                const geoId = bm.addGeometry(subGeo);
                parts.push({ batchedMesh: bm, geometryId: geoId });
            }
            this.typeParts.set(name, parts);
        }

        // Lighting for 10x scale
        //const light = new THREE.PointLight(0xffaa00, 1, 0);
        //light.position.set(0, 100, 0);
        //this.group.add(light);
    }

    renderMap() {
        this.stationMap.components.forEach(comp => {
            this.addComponentInstance(comp);
        });
        this.batchedMeshes.forEach(bm => {
            bm.computeBoundingBox();
            bm.computeBoundingSphere();
        });
    }

    addComponentInstance(comp) {
        if (!this.typeParts.has(comp.type)) return;
        const parts = this.typeParts.get(comp.type);
        const instances = parts.map(part => {
            return { batchedMesh: part.batchedMesh, instanceId: part.batchedMesh.addInstance(part.geometryId) };
        });
        this.instanceIds.set(comp.id, instances);
        this.updateInstanceMatrix(comp);
    }

    removeComponentInstance(comp) {
        const instances = this.instanceIds.get(comp.id);
        if (instances) {
            instances.forEach(inst => {
                const mat = new THREE.Matrix4().makeScale(0, 0, 0);
                inst.batchedMesh.setMatrixAt(inst.instanceId, mat);
            });
            this.instanceIds.delete(comp.id);
        }
    }

    updateInstanceMatrix(comp) {
        const instances = this.instanceIds.get(comp.id);
        if (!instances) return;

        const scale = 10.0;
        dummy.position.set(comp.x * scale, comp.y * scale, comp.z * scale);
        dummy.rotation.set(0, comp.rotation, 0);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();

        instances.forEach(inst => {
            inst.batchedMesh.setMatrixAt(inst.instanceId, dummy.matrix);
        });
    }

    dispose() {
        this.scene.remove(this.group);
        this.batchedMeshes.forEach(bm => bm.dispose());
    }
}
