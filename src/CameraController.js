import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export default class CameraController {
    constructor(camera, domElement) {
        this.camera = camera;
        this.controls = new OrbitControls(camera, domElement);
        this.controls.enabled = false;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 8;
        this.controls.maxDistance = 100;
        this.controls.enablePan = false;
    }

    get enabled() { return this.controls.enabled; }
    set enabled(val) { this.controls.enabled = val; }

    get target() { return this.controls.target; }

    update() {
        this.controls.update();
    }

    trackTarget(pos, quaternion) {
        if (this.controls.enabled) {
            this.camera.position.sub(this.controls.target);
            this.controls.target.copy(pos);
            this.camera.position.add(this.controls.target);
            this.camera.up.set(0, 1, 0).applyQuaternion(quaternion);
            this.controls.update();
        }
    }

    setTarget(x, y, z) {
        this.controls.target.set(x, y, z);
    }
}
