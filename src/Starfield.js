import * as THREE from 'three';

/**
 * Starfield: A high-performance particle-based streak effect to visualize velocity.
 * Uses a custom shader to wrap particles around the camera and stretch them based on speed.
 */
export default class Starfield {
    constructor(scene, count = 2000) {
        this.count = count;
        this.boxSize = 4000;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3 * 2); // 2 vertices per streak
        const offsets = new Float32Array(count * 3 * 2);
        const vertexType = new Float32Array(count * 2); // 0 for start, 1 for end
        const colors = new Float32Array(count * 3 * 2);
        const brightness = new Float32Array(count * 2);

        const palette = [
            new THREE.Color(0x88ccff), // Blue-white
            new THREE.Color(0xffffff), // Pure white
            new THREE.Color(0xffffee), // Warm white
            new THREE.Color(0xffcc88), // Orange
            new THREE.Color(0xff5522), // Red giant
        ];

        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * this.boxSize;
            const y = (Math.random() - 0.5) * this.boxSize;
            const z = (Math.random() - 0.5) * this.boxSize;

            const color = palette[Math.floor(Math.random() * palette.length)];
            // Use a power function to create a more natural distribution (more dim stars, few bright ones)
            const bright = 0.05 + Math.pow(Math.random(), 2.5) * 0.95;

            const idx = i * 6;
            const cIdx = i * 6;

            // Start vertex
            positions[idx] = 0; positions[idx + 1] = 0; positions[idx + 2] = 0;
            offsets[idx] = x; offsets[idx + 1] = y; offsets[idx + 2] = z;
            vertexType[i * 2] = 0;
            colors[cIdx] = color.r; colors[cIdx + 1] = color.g; colors[cIdx + 2] = color.b;
            brightness[i * 2] = bright;

            // End vertex
            positions[idx + 3] = 0; positions[idx + 4] = 0; positions[idx + 5] = 0;
            offsets[idx + 3] = x; offsets[idx + 4] = y; offsets[idx + 5] = z;
            vertexType[i * 2 + 1] = 1;
            colors[cIdx + 3] = color.r; colors[cIdx + 4] = color.g; colors[cIdx + 5] = color.b;
            brightness[i * 2 + 1] = bright;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
        geometry.setAttribute('aType', new THREE.BufferAttribute(vertexType, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

        this.material = new THREE.ShaderMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            uniforms: {
                uTime: { value: 0 },
                uVelocity: { value: new THREE.Vector3(0, 0, 0) },
                uCameraPos: { value: new THREE.Vector3(0, 0, 0) },
                uBoxSize: { value: this.boxSize },
                uWarp: { value: 0.0 },
                uColor: { value: new THREE.Color(0x88ccff) }
            },
            vertexShader: `
                uniform vec3 uVelocity;
                uniform vec3 uCameraPos;
                uniform float uBoxSize;
                uniform float uWarp;
                
                attribute vec3 aOffset;
                attribute float aType;
                attribute vec3 aColor;
                attribute float aBrightness;
                
                varying float vAlpha;
                varying vec3 vColor;

                void main() {
                    // Calculate world position with wrapping
                    vec3 worldPos = mod(aOffset - uCameraPos + uBoxSize * 0.5, uBoxSize) - uBoxSize * 0.5 + uCameraPos;
                    
                    // Streak direction and length
                    float speed = length(uVelocity);
                    vec3 dir = (speed > 0.1) ? normalize(uVelocity) : vec3(0.0, 0.0, 1.0);
                    
                    // Basic length + Warp stretch
                    float streakLen = speed * 0.05 + uWarp * 500.0;
                    

                    vAlpha = clamp(speed * 0.005 + uWarp, 0.1, 0.8) * aBrightness;


                    // Move the 'end' vertex along the velocity vector
                    if (aType > 0.5) {
                        worldPos += dir * streakLen;
                        vAlpha = 0.0;
                    }

                    vColor = aColor;
                    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                varying float vAlpha;
                varying vec3 vColor;
                void main() {
                    gl_FragColor = vec4(vColor, vAlpha * .5);
                }
            `
        });

        this.mesh = new THREE.LineSegments(geometry, this.material);
        this.mesh.frustumCulled = false; // Always visible as it follows camera
        scene.add(this.mesh);
    }

    update(delta, cameraPos, velocity, warpFactor) {
        this.material.uniforms.uCameraPos.value.copy(cameraPos);
        this.material.uniforms.uVelocity.value.copy(velocity);
        this.material.uniforms.uWarp.value = warpFactor;
        this.material.uniforms.uTime.value += delta;
    }
}
