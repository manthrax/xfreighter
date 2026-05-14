import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export default class ShieldSystem {
    constructor(ship, scene) {
        this.ship = ship;
        this.scene = scene;
        this.mesh = null;
        this.distortionMesh = null;
        this.init();
    }

    init() {
        const points = [];
        this.ship.traverse((child) => {
            if (child.isMesh) {
                const position = child.geometry.attributes.position;
                for (let i = 0; i < position.count; i++) {
                    const v = new THREE.Vector3().fromBufferAttribute(position, i);
                    v.applyMatrix4(child.matrixWorld);
                    this.ship.worldToLocal(v);
                    points.push(v);
                }
            }
        });

        if (points.length === 0) return;

        // 2. Generate and Smooth Convex Hull
        let geometry = new ConvexGeometry(points);
        // Weld vertices to allow for smooth normals
        geometry = BufferGeometryUtils.mergeVertices(geometry, 0.01);
        geometry.computeVertexNormals();
        
        // 3. Advanced Shield Material
        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
                uTime: { value: 0 },
                uShieldIntensity: { value: 0.0 }, 
                uEntryIntensity: { value: 0.0 },  
                uPlanetPos: { value: new THREE.Vector3(0, 0, 0) },
                uPlanetRadius: { value: 0.0 },
                uAtmosphereThreshold: { value: 0.0 },
                uHitPos: { value: new THREE.Vector3(0, 0, 0) },
                uHitTime: { value: -100.0 },
                uColorShield: { value: new THREE.Color(0x88ccff) },
                uColorEntry: { value: new THREE.Color(0xff4400) }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uShieldIntensity;
                uniform float uEntryIntensity;
                uniform vec3 uPlanetPos;
                uniform float uPlanetRadius;
                uniform float uAtmosphereThreshold;
                uniform vec3 uHitPos;
                uniform float uHitTime;
                uniform vec3 uColorShield;
                uniform vec3 uColorEntry;
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;

                void main() {
                    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                    float fresnel = 1.0 - abs(dot(vNormal, viewDir));
                    fresnel = pow(fresnel, 2.5);

                    // 1. World-space proximity to planet surface
                    float distToPlanetCenter = length(vWorldPosition - uPlanetPos);
                    float distToSurface = distToPlanetCenter - uPlanetRadius;
                    
                    // Heat factor increases as fragment gets closer to the 110% "hard floor"
                    // Threshold is 115% of radius, Floor is 110%
                    float hardFloor = uPlanetRadius * 0.1; 
                    float heatFactor = 1.0 - smoothstep(hardFloor, uAtmosphereThreshold, distToSurface);
                    heatFactor = pow(heatFactor, 2.0);

                    // 2. World-space noise for plasma
                    float plasmaNoise = sin(vWorldPosition.x * 0.2 + uTime * 3.0) * 
                                        sin(vWorldPosition.y * 0.2 + uTime * 2.5) * 
                                        sin(vWorldPosition.z * 0.2 + uTime * 3.5);
                    plasmaNoise = (plasmaNoise + 1.0) * 0.5;

                    // 3. Concentric Wave Effect (Shield Hits)
                    float distToHit = length(vWorldPosition - uHitPos);
                    float hitAge = uTime - uHitTime;
                    float wave = 0.0;
                    if (hitAge > 0.0 && hitAge < 2.0) {
                        float wavePos = hitAge * 15.0; 
                        wave = sin((distToHit - wavePos) * 5.0);
                        wave = smoothstep(0.0, 1.0, wave);
                        wave *= (1.0 - (hitAge / 2.0)); 
                        wave *= smoothstep(5.0, 0.0, distToHit - wavePos); 
                    }

                    // 4. Shield Hex/Grid pattern
                    float grid = sin(vPosition.x * 12.0 + uTime) * sin(vPosition.y * 12.0 + uTime) * sin(vPosition.z * 12.0 + uTime);
                    grid = smoothstep(0.85, 1.0, grid);

                    // 5. Compose Colors
                    vec3 shieldCol = uColorShield * (fresnel * 0.5 + grid * 0.3 + wave * 2.0) * (uShieldIntensity + wave);
                    
                    vec3 red = vec3(1.0, 0.05, 0.0);
                    vec3 yellow = vec3(1.0, 0.8, 0.0);
                    vec3 plasmaCol = mix(red, yellow, plasmaNoise * uEntryIntensity);
                    
                    vec3 entryCol = plasmaCol * (fresnel * 0.3 + heatFactor * (2.0 + plasmaNoise)) * uEntryIntensity;

                    float alpha = (fresnel * (uShieldIntensity + uEntryIntensity)) + 
                                  (grid * uShieldIntensity * 0.1) + 
                                  (wave * 0.8) +
                                  (heatFactor * uEntryIntensity * 0.8);
                    
                    gl_FragColor = vec4(shieldCol + entryCol, alpha);
                }
            `
        });
        
        // 4. Distortion Layer Material (Layer 1)
        this.distortionMaterial = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
                uTime: { value: 0 },
                uShieldIntensity: { value: 0.0 },
                uEntryIntensity: { value: 0.0 }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vWorldPosition;
                varying vec3 vViewDir;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vViewDir = normalize(cameraPosition - worldPos.xyz);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uShieldIntensity;
                uniform float uEntryIntensity;
                varying vec3 vNormal;
                varying vec3 vViewDir;

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
                    float n = noise(vNormal * 4.0 + uTime * 2.0);
                    float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 2.5);
                    
                    float intensity = uShieldIntensity + uEntryIntensity;
                    float alpha = fresnel * intensity * 0.8;
                    
                    if (alpha < 0.01) discard;

                    // Output screen space offset
                    vec2 offset = vNormal.xy * n * 0.05; 
                    gl_FragColor = vec4(offset, 0.0, alpha);
                }
            `
        });

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.scale.multiplyScalar(1.01);
        this.ship.add(this.mesh);

        this.distortionMesh = new THREE.Mesh(geometry, this.distortionMaterial);
        this.distortionMesh.scale.multiplyScalar(1.015);
        this.distortionMesh.layers.set(1); // Distortion layer
        this.ship.add(this.distortionMesh);
    }

    update(delta, time, state) {
        if (!this.mesh) return;
        this.material.uniforms.uTime.value = time;
        
        // 1. Damage Shield Decay
        this.material.uniforms.uShieldIntensity.value = THREE.MathUtils.lerp(
            this.material.uniforms.uShieldIntensity.value, 
            0.0, 
            delta * 1.5
        );

        // 2. Atmospheric Entry
        let entryHeat = 0;
        if (state.nearestPlanetPos) {
            this.material.uniforms.uPlanetPos.value.copy(state.nearestPlanetPos);
            this.material.uniforms.uPlanetRadius.value = state.planetRadius;
            this.material.uniforms.uAtmosphereThreshold.value = state.atmosphereThreshold;

            if (state.nearestPlanetDist < state.atmosphereThreshold) {
                entryHeat = 1.0 - (state.nearestPlanetDist / state.atmosphereThreshold);
                entryHeat = Math.pow(entryHeat, 0.6);
            }
        }
        
        this.material.uniforms.uEntryIntensity.value = THREE.MathUtils.lerp(
            this.material.uniforms.uEntryIntensity.value, 
            entryHeat, 
            delta * 4.0
        );

        // Update distortion uniforms
        this.distortionMaterial.uniforms.uTime.value = time;
        this.distortionMaterial.uniforms.uShieldIntensity.value = this.material.uniforms.uShieldIntensity.value;
        this.distortionMaterial.uniforms.uEntryIntensity.value = this.material.uniforms.uEntryIntensity.value;

        const isVisible = (this.material.uniforms.uShieldIntensity.value > 0.01 || 
                          this.material.uniforms.uEntryIntensity.value > 0.01 ||
                          (time - this.material.uniforms.uHitTime.value) < 2.0);
                          
        this.mesh.visible = isVisible;
        this.distortionMesh.visible = isVisible;
    }

    triggerHit(worldPos) {
        if (!this.material) return;
        this.material.uniforms.uHitPos.value.copy(worldPos);
        this.material.uniforms.uHitTime.value = this.material.uniforms.uTime.value;
        this.material.uniforms.uShieldIntensity.value = 0.5;
    }
}
