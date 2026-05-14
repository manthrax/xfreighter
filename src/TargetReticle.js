import * as THREE from 'three';

/**
 * TargetReticle: A screen-space targeting cursor that renders in the 3D view.
 * Uses DifferenceBlending to adapt to the background color.
 */
export default class TargetReticle {
    constructor(camera) {
        this.camera = camera;
        this.group = new THREE.Group();

        this.size = 0.05;
        this.geometry = new THREE.PlaneGeometry(this.size, this.size);

        // Shader that draws a nice crosshair/box
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform float uTime;
                
                void main() {
                    vec2 uv = vUv * 2.0 - 1.0;
                    float dist = max(abs(uv.x), abs(uv.y));
                    
                    // Animated pulse
                    float pulse = 0.95 + 0.05 * sin(uTime * 5.0);
                    
                    // Outer box corners
                    float box = step(pulse - 0.05, dist) * step(dist, pulse);
                    
                    // Cut out the center of the edges to make it look like corners
                    float corners = box * step(0.7, abs(uv.x * uv.y) * 2.0);
                    
                    // Center crosshair
                    float crossX = step(abs(uv.x), 0.015) * step(abs(uv.y), 0.15);
                    float crossY = step(abs(uv.y), 0.015) * step(abs(uv.x), 0.15);
                    float crosshair = max(crossX, crossY);
                    
                    float alpha = max(corners, crosshair);
                    if (alpha < 0.1) discard;
                    
                    gl_FragColor = vec4(vec3(1.0), 1.0);
                }
            `,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            premultipliedAlpha: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.SubtractEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneFactor,
            side: THREE.DoubleSide
        });

        this.reticles = []; // Pool of reticle meshes
        this.activeTargets = [];
    }

    setTargets(targets) {
        this.activeTargets = Array.isArray(targets) ? targets : (targets ? [targets] : []);

        // Update pool
        while (this.reticles.length < this.activeTargets.length) {
            const mesh = new THREE.Mesh(this.geometry, this.material);
            mesh.renderOrder = 10000;
            this.group.add(mesh);
            this.reticles.push(mesh);
        }

        this.reticles.forEach((mesh, i) => {
            mesh.visible = i < this.activeTargets.length;
        });
    }

    setTarget(target) {
        this.setTargets(target);
    }

    update(time, delta) {
        this.material.uniforms.uTime.value = time;

        this.activeTargets.forEach((target, i) => {
            const mesh = this.reticles[i];
            if (!target) {
                mesh.visible = false;
                return;
            }

            // 1. Get target world position
            const worldPos = new THREE.Vector3();
            target.getWorldPosition(worldPos);

            // 2. Project to screen space
            const screenPos = worldPos.clone().project(this.camera);

            // 3. Check if target is behind camera or off-screen
            if (screenPos.z > 1 || Math.abs(screenPos.x) > 1.1 || Math.abs(screenPos.y) > 1.1) {
                mesh.visible = false;
                return;
            }

            mesh.visible = true;

            // 4. Unproject back to a fixed distance in front of camera
            const targetPoint = new THREE.Vector3(screenPos.x, screenPos.y, 0.5);
            targetPoint.unproject(this.camera);

            mesh.position.copy(targetPoint);
            mesh.quaternion.copy(this.camera.quaternion);

            // 5. Scale dynamically based on object radius and distance
            let radius = target.userData.radius;
            if (radius === undefined && target.geometry && target.geometry.parameters) {
                radius = target.geometry.parameters.radius;
            }
            if (radius === undefined) radius = 100; // Fallback

            const dist = worldPos.distanceTo(this.camera.position);
            // Apparent size is proportional to radius/dist. 
            // Multiplier tuned so objects are nicely framed by the reticle corners.
            let scale = (radius / dist) * 25.0;

            // Clamp so it doesn't get infinitely large or invisibly small
            scale = THREE.MathUtils.clamp(scale, 0.3, 12.0);

            mesh.scale.setScalar(scale);
        });
    }

    addToScene(scene) {
        scene.add(this.group);
    }
}
