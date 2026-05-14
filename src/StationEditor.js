import * as THREE from 'three';

export default class StationEditor {
    constructor(scene, camera, domElement) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        
        this.active = false;
        this.station = null; // { map, renderer }
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Invisible plane for raycasting
        this.planeGeo = new THREE.PlaneGeometry(1000, 1000);
        this.planeGeo.rotateX(-Math.PI / 2);
        this.planeMat = new THREE.MeshBasicMaterial({ visible: false });
        this.plane = new THREE.Mesh(this.planeGeo, this.planeMat);
        this.scene.add(this.plane);
        
        // Preview mesh
        this.previewGeo = new THREE.BoxGeometry(1, 1, 1);
        this.previewMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true, transparent: true, opacity: 0.5 });
        this.previewMesh = new THREE.Mesh(this.previewGeo, this.previewMat);
        this.scene.add(this.previewMesh);
        this.previewMesh.visible = false;
        
        this.currentType = 'wall';
        this.currentRotation = 0;
        
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
    }

    activate(station) {
        if (this.active) return;
        this.active = true;
        this.station = station;
        
        this.domElement.addEventListener('pointermove', this.onPointerMove);
        this.domElement.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('keydown', this.onKeyDown);
        
        // Set camera to overhead - higher up for 10x scale
        this.camera.position.set(station.position.x, station.position.y + 150, station.position.z);
        this.camera.lookAt(station.position);
        
        this.plane.position.copy(station.position);
        this.previewMesh.visible = true;
        this.previewMesh.scale.set(10, 10, 10);
    }

    deactivate() {
        if (!this.active) return;
        this.active = false;
        this.station = null;
        
        this.domElement.removeEventListener('pointermove', this.onPointerMove);
        this.domElement.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('keydown', this.onKeyDown);
        
        this.previewMesh.visible = false;
    }

    update() {
        if (!this.active) return;
    }

    onPointerMove(event) {
        if (!this.active || !this.station) return;
        
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.plane);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;
            const localX = point.x - this.station.position.x;
            const localZ = point.z - this.station.position.z;
            
            const scale = 10.0;
            // Snap to 10 unit grid
            let snapX = Math.round(localX / scale) * scale;
            let snapZ = Math.round(localZ / scale) * scale;
            
            this.previewMesh.position.set(
                this.station.position.x + snapX,
                this.station.position.y,
                this.station.position.z + snapZ
            );
            this.previewMesh.rotation.y = this.currentRotation;
        }
    }

    onPointerDown(event) {
        if (!this.active || !this.station) return;
        
        const scale = 10.0;
        if (event.button === 0) { // Left click = place
            const localX = (this.previewMesh.position.x - this.station.position.x) / scale;
            const localZ = (this.previewMesh.position.z - this.station.position.z) / scale;
            
            const comp = this.station.map.addComponent(this.currentType, localX, 0, localZ, this.currentRotation);
            this.station.renderer.addComponentInstance(comp);
            
        } else if (event.button === 2) { // Right click = remove nearest
            const localX = (this.previewMesh.position.x - this.station.position.x) / scale;
            const localZ = (this.previewMesh.position.z - this.station.position.z) / scale;
            
            let nearest = null;
            let minDist = 1.0;
            
            this.station.map.components.forEach(c => {
                const dist = Math.hypot(c.x - localX, c.z - localZ);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = c;
                }
            });
            
            if (nearest) {
                this.station.renderer.removeComponentInstance(nearest);
                this.station.map.removeComponent(nearest.id);
            }
        }
    }

    onKeyDown(event) {
        if (!this.active) return;
        
        if (event.code === 'KeyR') {
            this.currentRotation += Math.PI / 2;
        }
        
        if (event.code === 'Digit1') this.currentType = 'floor';
        if (event.code === 'Digit2') this.currentType = 'wall';
        if (event.code === 'Digit3') this.currentType = 'door-double';
        if (event.code === 'Digit4') this.currentType = 'computer';
        if (event.code === 'Digit5') this.currentType = 'bed-double';
        
        // Basic camera pan
        const panSpeed = 20;
        if (event.code === 'ArrowUp') this.camera.position.z -= panSpeed;
        if (event.code === 'ArrowDown') this.camera.position.z += panSpeed;
        if (event.code === 'ArrowLeft') this.camera.position.x -= panSpeed;
        if (event.code === 'ArrowRight') this.camera.position.x += panSpeed;
    }
}
