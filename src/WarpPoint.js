import * as THREE from 'three';

/**
 * WarpPoint: A gateway to another sector.
 * Features a procedural shader-based visual effect and a noise sphere.
 */
export default class WarpPoint {
    constructor(scene, position, originSeed, targetSeed, label, targetLatticePos) {
        this.position = position.clone();
        this.targetSeed = targetSeed;
        this.targetLatticePos = targetLatticePos;
        this.label = label;
        this.radius = 200; // Increased radius

        const colorA = this._seedToColor(originSeed);
        const colorB = this._seedToColor(targetSeed);
        const mixedColor = colorA.lerp(colorB, 0.5);

        this.group = new THREE.Group();
        this.group.position.copy(this.position);

        // This is used as the interaction object
        this.mesh = this.group;
        this.mesh.userData.type = 'warp';
        this.mesh.userData.name = label;
        this.mesh.userData.radius = this.radius;

        // 1. Core Swirl Plane
        const planeMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: mixedColor },
                uIsCourseTarget: { value: 0.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                uniform float uIsCourseTarget;
                varying vec2 vUv;
                void main() {
                    vec2 uv = vUv - 0.5;
                    float dist = length(uv);
                    if (dist > 0.5) discard;
                    
                    vec3 col = mix(uColor, vec3(0.1, 1.0, 0.5), uIsCourseTarget);

                    float ring = sin(dist * 30.0 - uTime * 8.0);
                    ring = smoothstep(0.4, 0.5, ring) * (0.5 - dist);
                    float swirl = atan(uv.y, uv.x) + dist * 15.0 - uTime * 4.0;
                    float spiral = sin(swirl * 4.0);
                    spiral = smoothstep(0.5, 1.0, spiral) * (0.5 - dist);
                    float core = smoothstep(0.1, 0.0, dist);
                    gl_FragColor = vec4(col * (ring * 2.0 + spiral + core), (ring + spiral + core) * 0.9);
                }
            `
        });

        this.plane = new THREE.Mesh(new THREE.PlaneGeometry(this.radius * 2, this.radius * 2), planeMat);
        this.group.add(this.plane);

        // 2. Whirling Noise Sphere
        const sphereMat = new THREE.ShaderMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: mixedColor }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vViewDir;
                varying vec3 vWorldPos;
                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPos.xyz;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vViewDir = normalize(-mvPosition.xyz);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                varying vec3 vNormal;
                varying vec3 vViewDir;
                varying vec3 vWorldPos;

                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                float noise(vec3 x) {
                    vec3 i = floor(x);
                    vec3 f = fract(x);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                void main() {
                    vec3 p = vWorldPos * 0.01; // Balanced spatial frequency
                    float n = noise(p + uTime * 0.2);
                    n += noise(p * 1.5 - uTime * 0.4) * 0.5;
                    n += noise(p * 2.5 + uTime * 0.6) * 0.25;
                    
                    float fresnel = pow(1.0 - dot(vNormal, vViewDir), 2.5);
                    float alpha = n * fresnel * 0.8;
                    
                    // Output distortion vectors for the motion target
                    // Scaled down by 0.25 to compensate for global pipeline distortion increase
                    vec2 offset = vec2(-vNormal.y, vNormal.x) * n * 0.25; 
                    gl_FragColor = vec4(offset, 0.0, alpha);
                }
            `
        });

        this.sphere = new THREE.Mesh(new THREE.SphereGeometry(this.radius * 1.5, 32, 32), sphereMat);
        this.sphere.layers.set(1); // Set to distortion layer
        this.group.add(this.sphere);

        this.isCourseTarget = false;
        scene.add(this.group);
    }

    _seedToColor(seed) {
        let hash = 0;
        for (let i = 0; i < seed.length; i++) hash = (hash << 5) - hash + seed.charCodeAt(i);
        const h = Math.abs(hash % 360) / 360;
        return new THREE.Color().setHSL(h, 0.7, 0.6);
    }

    update(time, camera) {
        if (!this.group) return;
        this.plane.material.uniforms.uTime.value = time;
        this.plane.material.uniforms.uIsCourseTarget.value = this.isCourseTarget ? 1.0 : 0.0;
        this.sphere.material.uniforms.uTime.value = time;

        // Billboarding for the inner swirl
        this.plane.lookAt(camera.position);
    }

    dispose(scene) {
        if (this.group) {
            scene.remove(this.group);
            this.group.traverse(child => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    child.material.dispose();
                }
            });
        }
    }
}
