import * as THREE from 'three';

/**
 * FlightController: Handles Newtonian-lite physics and input for the player ship.
 */
export default class FlightController {
    constructor(ship, camera, options = {}) {
        this.ship = ship;
        this.camera = camera;

        // Configuration
        this.thrustForce = options.thrustForce || 60.0;
        this.turnSpeed = options.turnSpeed || 2.5;
        this.drag = options.drag || 0.985;
        this.angularDrag = options.angularDrag || 0.90;

        // State
        this.velocity = new THREE.Vector3();
        this.rotationVelocity = new THREE.Vector3(); // x: pitch, y: yaw, z: roll
        this.thrustInput = 0; // Current normalized thrust [0, 1]

        // Input tracking
        this.keys = {};
        this.mouse = { x: 0, y: 0, isLocked: false };
        this.mouseLookEnabled = false; // Optional mouse look

        window.addEventListener('keydown', (e) => this.keys[e.code] = true);
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);

        // Mouse Look
        window.addEventListener('mousemove', (e) => {
            if (this.mouse.isLocked) {
                this.mouse.x = e.movementX;
                this.mouse.y = e.movementY;
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.mouse.isLocked = document.pointerLockElement === document.body;
        });

        window.addEventListener('mousedown', (e) => {
            // Only engage pointer lock if we clicked the main canvas
            if (e.target.tagName !== 'CANVAS') return;

            // Do NOT engage if UI is active
            const overlay = document.getElementById('overlay');
            if (overlay && !overlay.classList.contains('hidden')) return;

            const market = document.getElementById('market-ui');
            if (market && market.classList.contains('active')) return;

            if (window.isStarMapVisible) return;

            if (this.mouseLookEnabled && !this.mouse.isLocked && !this.autopilot) {
                document.body.requestPointerLock();
            }
        });

        // Camera follow parameters
        this.cameraOffset = new THREE.Vector3(0, 4, 14);
        this.cameraLookOffset = new THREE.Vector3(0, 1.5, -30);
        this.currentCameraPos = new THREE.Vector3().copy(camera.position);

        // Effects
        this.warpTime = 0;
        this.warpDuration = 12.0;
        this.baseFov = camera.fov;

        this.cameraLocked = false;

        // Pre-allocated scratch vectors to avoid per-frame GC
        this._thrustScratch = new THREE.Vector3();
        this._rotScratch = new THREE.Vector3();
        this._quatScratch = new THREE.Quaternion();
        this._eulerScratch = new THREE.Euler();

        // Persistent engine state (Throttle)
        this.throttle = new THREE.Vector3(); // x: horizontal, y: vertical, z: forward

        // Power System
        this.maxCharge = 100;
        this.charge = 100;
        this.chargeRegen = 10.0;
        this.hyperThrustCost = 15.0;
        this.isHyperThrusting = false;
    }

    update(delta, state = {}) {
        if (delta > 0.1) delta = 0.1;

        // 0. Energy Regeneration
        this.charge = Math.min(this.maxCharge, this.charge + this.chargeRegen * delta);

        // Forward/Back Throttle (Digital Percentage Mapping)
        if (this.keys['Backquote']) this.throttle.z = 0;
        if (this.keys['Digit1']) this.throttle.z = -0.1;
        if (this.keys['Digit2']) this.throttle.z = -0.2;
        if (this.keys['Digit3']) this.throttle.z = -0.3;
        if (this.keys['Digit4']) this.throttle.z = -0.4;
        if (this.keys['Digit5']) this.throttle.z = -0.5;
        if (this.keys['Digit6']) this.throttle.z = -0.6;
        if (this.keys['Digit7']) this.throttle.z = -0.7;
        if (this.keys['Digit8']) this.throttle.z = -0.8;
        if (this.keys['Digit9']) this.throttle.z = -0.9;
        if (this.keys['Digit0']) this.throttle.z = -1.0;
        if (this.keys['Minus']) this.throttle.z = 1.0; // Reverse thrust

        // Braking (X - Utility)
        if (this.keys['KeyX']) {
            this.throttle.z = THREE.MathUtils.lerp(this.throttle.z, 0, delta * 5.0);
            this.velocity.multiplyScalar(Math.pow(0.9, delta * 60));
        }
        this.throttle.z = THREE.MathUtils.clamp(this.throttle.z, -1.0, 1.0);

        const rampSpeed = 2.0;

        // Vertical/Lateral Strafe (Arrow Keys)
        let targetY = 0;
        if (this.keys['ArrowUp']) targetY += 1;
        if (this.keys['ArrowDown']) targetY -= 1;
        this.throttle.y = THREE.MathUtils.lerp(this.throttle.y, targetY, delta * rampSpeed);

        let targetX = 0;
        if (this.keys['ArrowLeft']) targetX -= 1;
        if (this.keys['ArrowRight']) targetX += 1;
        this.throttle.x = THREE.MathUtils.lerp(this.throttle.x, targetX, delta * rampSpeed);

        // Hyperthrust (Space - Original control)
        const spaceHeld = this.keys['Space'] && this.charge > 5;
        if (spaceHeld) {
            if (!this._wasManualHyper) {
                this._preHyperThrottleZ = this.throttle.z;
                this._wasManualHyper = true;
            }
            this.isHyperThrusting = true;
            this.throttle.z = -1.0;
        } else if (this._wasManualHyper) {
            this.isHyperThrusting = false;
            this.throttle.z = this._preHyperThrottleZ;
            this._wasManualHyper = false;
        } else {
            // Autopilot or other sources might set isHyperThrusting
            // so we don't force it to false here if not manual
        }

        // --- Autopilot Logic ---
        this._rotScratch.set(0, 0, 0);
        if (this.autopilot && this.autopilotTarget) {
            const toTarget = this.autopilotTarget.clone().sub(this.ship.position);
            const dist = toTarget.length();
            
            // Proximity disengage for planets and warp points
            if (this.autopilotTargetObject) {
                const type = this.autopilotTargetObject.userData.type;
                if (type === 'planet' || type === 'warp') {
                    const radius = this.autopilotTargetObject.userData.radius || 
                                 (this.autopilotTargetObject.geometry && this.autopilotTargetObject.geometry.parameters ? this.autopilotTargetObject.geometry.parameters.radius : 0);
                    
                    if (radius > 0 && dist < radius * 1.2) {
                        this.autopilot = false;
                        this.cameraLocked = false;
                        this.throttle.set(0, 0, 0);
                        return; // Stop processing autopilot this frame
                    }
                }
            }

            const dir = toTarget.normalize();

            const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
            this.ship.quaternion.slerp(targetQuat, delta * 1.5);

            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
            const alignment = Math.max(0, forward.dot(dir)); // 0 to 1

            this.throttle.x = THREE.MathUtils.lerp(this.throttle.x, 0, delta * 2);
            this.throttle.y = THREE.MathUtils.lerp(this.throttle.y, 0, delta * 2);

            if (dist < 3000) {
                // Precision approach: Maintain speed but avoid orbiting
                this.throttle.z = -1.0 * alignment;

                // Keep hyperthrust active if well aligned for warp points
                if (alignment > 0.99 && this.charge > 10) {
                    this.isHyperThrusting = true;
                } else {
                    this.isHyperThrusting = false;
                }
            } else {
                // High speed cruise
                this.throttle.z = -1.0 * Math.pow(alignment, 2.0);
                if (this.charge > 20 && alignment > 0.98) {
                    this.isHyperThrusting = true;
                } else {
                    this.isHyperThrusting = false;
                }
            }

            // Manual Break
            if (this.keys['KeyW'] || this.keys['KeyS'] || this.keys['KeyA'] || this.keys['KeyD']) {
                this.autopilot = false;
                this.cameraLocked = false;
                this.throttle.set(0, 0, 0);
            }
        } else {
            // Manual Rotation Input (Keyboard Original)
            if (this.keys['KeyW']) this._rotScratch.x -= 1.5;
            if (this.keys['KeyS']) this._rotScratch.x += 1.5;
            if (this.keys['KeyA']) this._rotScratch.y += 1.5;
            if (this.keys['KeyD']) this._rotScratch.y -= 1.5;

            // Optional Mouse Look
            const mouseSensitivity = 0.002;
            if (this.mouseLookEnabled && this.mouse.isLocked) {
                this._rotScratch.x += -this.mouse.y * mouseSensitivity * 50;
                this._rotScratch.y += -this.mouse.x * mouseSensitivity * 50;
                this.mouse.x = 0;
                this.mouse.y = 0;
            }

            if (this.keys['KeyQ']) this._rotScratch.z += 1.5;
            if (this.keys['KeyE']) this._rotScratch.z -= 1.5;
        }

        if (this.isHyperThrusting) {
            this.charge -= this.hyperThrustCost * delta;
            if (this.charge <= 0) {
                this.charge = 0;
                this.isHyperThrusting = false;
            }
        }

        // 2. Finalize Input & Apply Forces
        this.thrustInput = Math.min(this.throttle.length(), 1.0);

        if (this.throttle.lengthSq() > 0.001) {
            const multiplier = this.isHyperThrusting ? 10.0 : 1.0;
            this._thrustScratch.copy(this.throttle).normalize();
            this._thrustScratch.applyQuaternion(this.ship.quaternion);
            this.velocity.addScaledVector(this._thrustScratch, this.thrustForce * delta * this.throttle.length() * multiplier);
        }

        // 3. Apply Torque (Manual + Atmospheric Drag)
        this.rotationVelocity.x += this._rotScratch.x * this.turnSpeed * delta;
        this.rotationVelocity.y += this._rotScratch.y * this.turnSpeed * delta;
        this.rotationVelocity.z += this._rotScratch.z * this.turnSpeed * delta;

        // Atmospheric Alignment Torque
        if (state.nearestPlanetDist < state.atmosphereThreshold && state.nearestPlanetDir) {
            const targetNormal = state.nearestPlanetDir.clone().negate().normalize();
            const shipUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.ship.quaternion);

            // Create a torque to align ship UP with planet normal (Torque is in World Space)
            const alignmentTorque = new THREE.Vector3().crossVectors(shipUp, targetNormal);
            
            // Convert World Space torque to Local Space because rotationVelocity is integrated locally
            alignmentTorque.applyQuaternion(this.ship.quaternion.clone().invert());
            
            const intensity = 1.0 - (state.nearestPlanetDist / state.atmosphereThreshold);
            this.rotationVelocity.addScaledVector(alignmentTorque, delta * 2.5 * intensity);
        }

        // 4. Update Position & Orientation
        this.ship.position.addScaledVector(this.velocity, delta);
        this._eulerScratch.set(
            this.rotationVelocity.x * delta,
            this.rotationVelocity.y * delta,
            this.rotationVelocity.z * delta
        );
        this._quatScratch.setFromEuler(this._eulerScratch);
        this.ship.quaternion.multiply(this._quatScratch);

        // 5. Planet Collision
        if (state.nearestPlanetRadius > 0 && state.nearestPlanetPos) {
            const padding = 20; // Ship radius/buffer
            const minAllowedDist = state.nearestPlanetRadius + padding;
            
            // Recalculate distance based on new position
            const currentDist = this.ship.position.distanceTo(state.nearestPlanetPos);
            
            if (currentDist < minAllowedDist) {
                // Normal is from planet center toward ship
                const normal = this.ship.position.clone().sub(state.nearestPlanetPos).normalize();
                const penetration = minAllowedDist - currentDist;
                
                // Resolve penetration
                this.ship.position.addScaledVector(normal, penetration);
                
                // Reflect velocity if moving toward surface
                const dot = this.velocity.dot(normal);
                if (dot < 0) {
                    // v = v - 2 * (v . n) * n
                    this.velocity.addScaledVector(normal, -1.5 * dot); // 1.5 = bounce factor
                    this.velocity.multiplyScalar(0.5); // Impact loss
                }
                
                // Jolt rotation
                this.rotationVelocity.x += (Math.random() - 0.5) * 2;
                this.rotationVelocity.y += (Math.random() - 0.5) * 2;
            }
        }

        // 6. Apply Drag
        const dragFactor = Math.pow(this.drag, delta * 60);
        const angularDragFactor = Math.pow(this.angularDrag, delta * 60);
        this.velocity.multiplyScalar(dragFactor);
        this.rotationVelocity.multiplyScalar(angularDragFactor);

    }

    updateCameraPosition(delta) {
        // 1. Camera Follow (Flight Mode)
        if (this.cameraLocked) return;
        const lerpFactor = 1.0 - Math.pow(0.001, delta); // Frame-rate independent lerp

        this._thrustScratch.copy(this.cameraOffset).applyQuaternion(this.ship.quaternion);
        this._rotScratch.copy(this.ship.position).add(this._thrustScratch);
        this.camera.position.lerp(this._rotScratch, lerpFactor);

        this._thrustScratch.copy(this.cameraLookOffset).applyQuaternion(this.ship.quaternion).add(this.ship.position);
        this._rotScratch.set(0, 1, 0).applyQuaternion(this.ship.quaternion);
        this.camera.up.copy(this._rotScratch);
        this.camera.lookAt(this._thrustScratch);
    }

    updateCameraEffects(delta) {
        // 2. FOV and Warp Effects
        const speedVal = this.velocity.length();
        const speedFovOffset = Math.min(speedVal * 0.01, 10);
        const targetFov = this.baseFov + speedFovOffset + (this.isHyperThrusting ? 5 : 0);

        if (this.warpTime > 0) {
            this.warpTime -= delta;
            const progress = this.warpTime / this.warpDuration;
            const effect = Math.sin(progress * Math.PI);
            this.camera.fov = this.baseFov + effect * 60;
            this.camera.updateProjectionMatrix();

            const shake = effect * 0.4;
            this.camera.position.x += (Math.random() - 0.5) * shake;
            this.camera.position.y += (Math.random() - 0.5) * shake;
            this.camera.position.z += (Math.random() - 0.5) * shake;
        } else {
            if (Math.abs(this.camera.fov - targetFov) > 0.1) {
                this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, delta * 3.0);
                this.camera.updateProjectionMatrix();
            }
        }
    }

    triggerWarp(duration = 12.0) {
        this.warpTime = duration;
        this.warpDuration = duration;
    }

    /**
     * Helper to get current speed for HUD
     */
    get speed() {
        return this.velocity.length();
    }
}
