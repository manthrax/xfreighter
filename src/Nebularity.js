class MersenneTwister {
    constructor(seed = Date.now()) {
        this.MT = new Uint32Array(624);
        this.index = 0;
        this.MT[0] = seed >>> 0;
        for (let i = 1; i < 624; i++) {
            const s = this.MT[i - 1] ^ (this.MT[i - 1] >>> 30);
            this.MT[i] = (((((s & 0xffff0000) >>> 16) * 1812433253) << 16) + (s & 0x0000ffff) * 1812433253) + i;
            this.MT[i] >>>= 0;
        }
    }
    random() {
        if (this.index >= 624) this.twist();
        let y = this.MT[this.index++];
        y ^= (y >>> 11);
        y ^= (y << 7) & 0x9d2c5680;
        y ^= (y << 15) & 0xefc60000;
        y ^= (y >>> 18);
        return (y >>> 0) * (1.0 / 4294967296.0);
    }
    twist() {
        for (let i = 0; i < 624; i++) {
            const y = (this.MT[i] & 0x80000000) + (this.MT[(i + 1) % 624] & 0x7fffffff);
            this.MT[i] = this.MT[(i + 397) % 624] ^ (y >>> 1);
            if (y % 2 !== 0) this.MT[i] ^= 0x9908b0df;
        }
        this.index = 0;
    }
}

/**
 * Nebularity: High-fidelity procedural 3D nebula generator for Three.js
 */
export default class Nebularity {
    constructor(options = {}) {
        const { THREE, renderer, scene = null, noise = 'simplex' } = options;
        if (!THREE || !renderer) {
            throw new Error("Nebularity: 'THREE' and 'renderer' are required in the constructor options.");
        }
        this.THREE = THREE;
        this.renderer = renderer;
        this.scene = null;
        this.noiseType = noise;
        this.currentTarget = null;
        this.previousTarget = null;
        this.displayTarget = null;

        // Ping-Pong Buffers for zero-allocation rotation
        this.bufferA = null;
        this.bufferB = null;
        this._activeBuffer = 'A'; // Which one is the NEW generation going into

        this.transitionTime = 0;
        this.isTransitioning = false;

        this._tempVec = new this.THREE.Vector3();

        // Initialize scratch objects BEFORE initScene()
        this.scratchP1 = new this.THREE.Vector3();
        this.scratchQuat = new this.THREE.Quaternion();
        this.scratchV3 = new this.THREE.Vector3();
        this.scratchZ = new this.THREE.Vector3(0, 0, -1);
        this.initMaterials();
        this.initScene();
        this.initBlender();

        if (scene) this.setScene(scene);
    }

    /**
     * Sets the scene that this Nebularity instance will control.
     * Automatically updates scene.background and scene.environment.
     */
    setScene(scene) {
        this.scene = scene;
        if (this.scene && this.displayTarget) {
            this.scene.background = this.displayTarget.texture;
            this.scene.environment = this.displayTarget.texture;
        }
    }

    initBlender() {
        this.blendMaterial = new this.THREE.ShaderMaterial({
            uniforms: {
                tPrev: { value: null },
                tNext: { value: null },
                uMix: { value: 0.0 }
            },
            vertexShader: `
                varying vec3 vPos;
                void main() {
                    vPos = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform samplerCube tPrev;
                uniform samplerCube tNext;
                uniform float uMix;
                varying vec3 vPos;
                void main() {
                    vec4 col1 = textureCube(tPrev, normalize(vPos));
                    vec4 col2 = textureCube(tNext, normalize(vPos));
                    gl_FragColor = mix(col1, col2, uMix);
                }
            `,
            side: this.THREE.BackSide
        });

        this.blendScene = new this.THREE.Scene();
        this.blendMesh = new this.THREE.Mesh(new this.THREE.BoxGeometry(2, 2, 2), this.blendMaterial);
        this.blendScene.add(this.blendMesh);
    }

    getStarColor(rng) {
        const r = rng.random();
        // Highly saturated colors to survive ACES Filmic desaturation
        if (r < 0.05) return new this.THREE.Color(0.1, 0.4, 1.0).multiplyScalar(1.5);  // Deep Blue (O)
        if (r < 0.15) return new this.THREE.Color(0.3, 0.6, 1.0).multiplyScalar(1.2);  // Electric Blue (B)
        if (r < 0.25) return new this.THREE.Color(1.0, 1.0, 1.0);                      // Pure White (A/F)
        if (r < 0.55) return new this.THREE.Color(1.0, 0.9, 0.4).multiplyScalar(1.1);   // Golden (G)
        if (r < 0.85) return new this.THREE.Color(1.0, 0.5, 0.05).multiplyScalar(1.3);  // Vivid Orange (K)
        return new this.THREE.Color(1.0, 0.2, 0.05).multiplyScalar(1.5);               // Vivid Red (M)
    }

    initMaterials() {

        const Pnoise3D = `
        
vec3 mod289(vec3 x)
{
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x)
{
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x)
{
  return mod289(((x*34.0)+10.0)*x);
}

vec4 taylorInvSqrt(vec4 r)
{
  return 1.79284291400159 - 0.85373472095314 * r;
}

vec3 fade(vec3 t) {
  return t*t*t*(t*(t*6.0-15.0)+10.0);
}

// Classic Perlin noise
float cnoise(vec3 P)
{
  vec3 Pi0 = floor(P); // Integer part for indexing
  vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1
  Pi0 = mod289(Pi0);
  Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P); // Fractional part for interpolation
  vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);

  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));

  float n000 = norm0.x * dot(g000, Pf0);
  float n010 = norm0.y * dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n100 = norm0.z * dot(g100, vec3(Pf1.x, Pf0.yz));
  float n110 = norm0.w * dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = norm1.x * dot(g001, vec3(Pf0.xy, Pf1.z));
  float n011 = norm1.y * dot(g011, vec3(Pf0.x, Pf1.yz));
  float n101 = norm1.z * dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n111 = norm1.w * dot(g111, Pf1);

  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x); 
  return 2.2 * n_xyz;
}

// Classic Perlin noise, periodic variant
float pnoise(vec3 P, vec3 rep)
{
  vec3 Pi0 = mod(floor(P), rep); // Integer part, modulo period
  vec3 Pi1 = mod(Pi0 + vec3(1.0), rep); // Integer part + 1, mod period
  Pi0 = mod289(Pi0);
  Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P); // Fractional part for interpolation
  vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);

  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));

  float n000 = norm0.x * dot(g000, Pf0);
  float n010 = norm0.y * dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n100 = norm0.z * dot(g100, vec3(Pf1.x, Pf0.yz));
  float n110 = norm0.w * dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = norm1.x * dot(g001, vec3(Pf0.xy, Pf1.z));
  float n011 = norm1.y * dot(g011, vec3(Pf0.x, Pf1.yz));
  float n101 = norm1.z * dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n111 = norm1.w * dot(g111, Pf1);

  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x); 
  return 2.2 * n_xyz;
}
        `
        const Snoise3D = `
        
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
     return mod289(((x*34.0)+10.0)*x);
}

vec4 taylorInvSqrt(vec4 r)
{
  return 1.79284291400159 - 0.85373472095314 * r;
}

float cnoise(vec3 v)
  { 
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
v*=.5;
// First corner
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 =   v - i + dot(i, C.xxx) ;

// Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  //   x0 = x0 - 0.0 + 0.0 * C.xxx;
  //   x1 = x0 - i1  + 1.0 * C.xxx;
  //   x2 = x0 - i2  + 2.0 * C.xxx;
  //   x3 = x0 - 1.0 + 3.0 * C.xxx;
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

// Permutations
  i = mod289(i); 
  vec4 p = permute( permute( permute( 
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

// Gradients: 7x7 points over a square, mapped onto an octahedron.
// The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

//Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

// Mix final noise value
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                dot(p2,x2), dot(p3,x3) ) );
  }
        `
        const NOISEFN = this.noiseType === 'perlin' ? Pnoise3D : Snoise3D;
        this.nebulaMaterial = new this.THREE.ShaderMaterial({
            side: this.THREE.BackSide,
            transparent: true,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            uniforms: {
                uColor: { value: new this.THREE.Color(1, 1, 1) },
                uOffset: { value: new this.THREE.Vector3(0, 0, 0) },
                uScale: { value: 1.0 },
                uIntensity: { value: 1.0 },
                uFalloff: { value: 1.0 }
            },
            vertexShader: `
                varying vec3 vPos;
                void main() {
                    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform vec3 uColor;
                uniform vec3 uOffset;
                uniform float uScale;
                uniform float uIntensity;
                uniform float uFalloff;
                varying vec3 vPos;
                ${NOISEFN}
                float noise(vec3 p) { return 0.5 * cnoise(p) + 0.5; }
                float nebula(vec3 p) {
                    const int steps = 6;
                    float scale = pow(2.0, float(steps));
                    vec3 displace = vec3(0.0);
                    for (int i = 0; i < steps; i++) {
                        displace = vec3(
                            noise(p.xyz * scale + displace),
                            noise(p.yzx * scale + displace),
                            noise(p.zxy * scale + displace)
                        );
                        scale *= 0.5;
                    }
                    return noise(p * scale + displace);
                }
                float dither(vec2 uv) {
                    return (fract(sin(dot(uv, vec2(12.9898,78.233))) * 43758.5453) - 0.5) / 255.0;
                }
                void main() {
                    vec3 posn = normalize(vPos) * uScale;
                    float c = min(1.0, nebula(posn + uOffset) * uIntensity);
                    c = pow(c, uFalloff);
                    // Add subtle dithering to break up banding
                    //float d = dither(gl_FragCoord.xy);
                    //gl_FragColor = vec4(uColor + d, c + d);
                    gl_FragColor = vec4(uColor, c);
                }
            `
        });

        this.starMaterial = new this.THREE.ShaderMaterial({
            side: this.THREE.BackSide,
            transparent: true,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            uniforms: {
                uPosition: { value: new this.THREE.Vector3(0, 0, 0) },
                uColor: { value: new this.THREE.Color(1, 1, 1) },
                uSize: { value: 1.0 },
                uIntensity: { value: 1.0 },
                uFalloff: { value: 1.0 }
            },
            vertexShader: `
                varying vec3 vPos;
                void main() {
                    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform vec3 uPosition;
                uniform vec3 uColor;
                uniform float uSize;
                uniform float uIntensity;
                uniform float uFalloff;
                varying vec3 vPos;
                void main() {
                    vec3 posn = normalize(vPos);
                    float d = 1.0 - dot(posn, normalize(uPosition));
                    
                    float glow = exp(-d * uFalloff) * uIntensity;
                    float core = exp(-d * uFalloff * 10.0) * uIntensity * 15.0;
                    
                    vec3 col = mix(uColor, vec3(1.0), clamp(core * 0.1, 0.0, 0.5));
                    gl_FragColor = vec4(col * (glow + core), clamp(glow + core, 0.0, 1.0));
                }
            `
        });

        this.sunMaterial = new this.THREE.ShaderMaterial({
            side: this.THREE.BackSide,
            transparent: true,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            uniforms: {
                uPosition: { value: new this.THREE.Vector3(0, 0, 0) },
                uColor: { value: new this.THREE.Color(1, 1, 1) },
                uSize: { value: 1.0 },
                uIntensity: { value: 1.0 },
                uFalloff: { value: 1.0 }
            },
            vertexShader: `
                varying vec3 vPos;
                void main() {
                    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform vec3 uPosition;
                uniform vec3 uColor;
                uniform float uSize;
                uniform float uIntensity;
                uniform float uFalloff;
                varying vec3 vPos;
                void main() {
                    vec3 posn = normalize(vPos);
                    float d = clamp(dot(posn, normalize(uPosition)), 0.0, 1.0);
                    float c = smoothstep(1.0 - uSize * 32.0, 1.0 - uSize, d);
                    c += pow(d, uFalloff) * 0.5;
                    c *= uIntensity; // Factor in intensity
                    vec3 color = mix(uColor, vec3(1,1,1), c * 0.7); // Reduced white mixing
                    gl_FragColor = vec4(color * uIntensity, c);
                }
            `
        });

        this.pointStarsMaterial = new this.THREE.ShaderMaterial({
            transparent: true,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            vertexShader: `
                attribute vec3 color;
                varying vec3 vColor;
                void main() {
                    vColor = color;
                    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    gl_FragColor = vec4(vColor, 1.0);
                }
            `
        });
    }

    initScene() {
        this.internalScene = new this.THREE.Scene();
        this.boxMesh = new this.THREE.Mesh(new this.THREE.BoxGeometry(2, 2, 2, 64, 64, 64), this.nebulaMaterial);
        this.boxMesh.frustumCulled = false;
        this.internalScene.add(this.boxMesh);

        // Pre-generate point stars as a Mesh
        const count = 100000;
        const positions = new Float32Array(count * 18);
        const colors = new Float32Array(count * 18);
        const rngPointInit = new MersenneTwister(12345);

        const tempPos = new this.THREE.Vector3();
        for (let i = 0; i < count; i++) {
            tempPos.randomDirection();
            const starColor = this.getStarColor(rngPointInit);
            const brightness = Math.pow(rngPointInit.random(), 4.0);

            // Optimized: pass arrays and index directly
            this.buildStarGeometry(0.05, tempPos, 128.0, starColor, brightness, positions, colors, i);
        }

        const pointStarsGeometry = new this.THREE.BufferGeometry();
        pointStarsGeometry.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
        pointStarsGeometry.setAttribute('color', new this.THREE.BufferAttribute(colors, 3));
        this.pointStarsMesh = new this.THREE.Mesh(pointStarsGeometry, this.pointStarsMaterial);
        this.pointStarsMesh.frustumCulled = false;
        this.internalScene.add(this.pointStarsMesh);
    }

    generate(seed = "nebula", params = {}) {
        if (params.scene) this.setScene(params.scene);

        const {
            resolution = 1024,
            nebulae = true,
            stars = true,
            sun = true,
            pointStars = true
        } = params;

        const hash = this.hashCode(seed);

        // --- Optimized Buffer Rotation (Ping-Pong) ---
        // 1. Ensure all 3 targets exist and match resolution
        const targetOptions = {
            format: this.THREE.RGBAFormat,
            type: this.THREE.HalfFloatType,
            generateMipmaps: false,
            minFilter: this.THREE.LinearFilter,
            magFilter: this.THREE.LinearFilter
        };

        if (!this.bufferA || this.bufferA.width !== resolution) {
            if (this.bufferA) this.bufferA.dispose();
            if (this.bufferB) this.bufferB.dispose();
            if (this.displayTarget) this.displayTarget.dispose();

            this.bufferA = new this.THREE.WebGLCubeRenderTarget(resolution, targetOptions);
            this.bufferB = new this.THREE.WebGLCubeRenderTarget(resolution, targetOptions);
            this.displayTarget = new this.THREE.WebGLCubeRenderTarget(resolution, targetOptions);

            this.blendCubeCamera = new this.THREE.CubeCamera(0.1, 10, this.displayTarget);

            // Pre-allocate cameras for the ping-pong buffers
            this.cameraA = new this.THREE.CubeCamera(0.01, 2000, this.bufferA);
            this.cameraB = new this.THREE.CubeCamera(0.01, 2000, this.bufferB);
            this.internalScene.add(this.cameraA);
            this.internalScene.add(this.cameraB);
        }

        // 2. Rotate buffers
        this.previousTarget = this.currentTarget;
        if (this._activeBuffer === 'A') {
            this.currentTarget = this.bufferA;
            this._activeBuffer = 'B';
        } else {
            this.currentTarget = this.bufferB;
            this._activeBuffer = 'A';
        }

        const cubeCamera = (this._activeBuffer === 'B') ? this.cameraA : this.cameraB;
        const cubeRenderTarget = this.currentTarget;

        // --- Setup Parameters ---
        const rngPoint = new MersenneTwister(hash + 1000);
        const pStarRotations = [];
        if (pointStars) {
            while (true) {
                const rot = new this.THREE.Euler(
                    rngPoint.random() * Math.PI * 2,
                    rngPoint.random() * Math.PI * 2,
                    rngPoint.random() * Math.PI * 2
                );
                pStarRotations.push(rot);
                if (rngPoint.random() < 0.2) break;
            }
        }

        const rngStar = new MersenneTwister(hash + 3000);
        const starParams = [];
        if (stars) {
            while (true) {
                starParams.push({
                    pos: new this.THREE.Vector3(...this.randomVec3(rngStar)),
                    color: this.getStarColor(rngStar),
                    size: rngStar.random() * 0.5 + 0.1,
                    intensity: rngStar.random() * 2.9 + 0.1, // Much more brightness variation
                    falloff: rngStar.random() * 160000.0 + 40000.0 // 50% smaller (radius)
                });
                if (rngStar.random() < 0.01) break;
            }
        }

        const rngNebula = new MersenneTwister(hash + 2000);
        const nebulaParams = [];
        if (nebulae) {
            while (true) {
                nebulaParams.push({
                    scale: rngNebula.random() * 0.5 + 0.25,
                    color: new this.THREE.Color(rngNebula.random(), rngNebula.random(), rngNebula.random()),
                    intensity: rngNebula.random() * 0.2 + 0.9,
                    falloff: rngNebula.random() * 3.0 + 3.0,
                    offset: new this.THREE.Vector3(rngNebula.random() * 2000 - 1000, rngNebula.random() * 2000 - 1000, rngNebula.random() * 2000 - 1000)
                });
                if (rngNebula.random() < 0.5) break;
            }
        }

        const rngSun = new MersenneTwister(hash + 4000);
        const sunParams = [];
        if (sun) {
            sunParams.push({
                pos: new this.THREE.Vector3(...this.randomVec3(rngSun)),
                color: this.getStarColor(rngSun),
                size: rngSun.random() * 0.0001 + 0.000025, // 50% smaller overall
                intensity: rngSun.random() * 2.5 + 0.5,     // More brightness range
                falloff: rngSun.random() * 24.0 + 4.0       // More halo variety
            });
        }

        // --- Render Loop ---
        const oldSize = new this.THREE.Vector2();
        this.renderer.getSize(oldSize);
        this.renderer.setSize(resolution, resolution);

        const oldAutoClear = this.renderer.autoClear;
        const oldColorSpace = this.renderer.outputColorSpace;
        const oldToneMapping = this.renderer.toneMapping;

        this.renderer.autoClear = false;
        this.renderer.outputColorSpace = this.THREE.LinearSRGBColorSpace;
        this.renderer.toneMapping = this.THREE.NoToneMapping;

        // Hide everything first
        this.boxMesh.visible = false;
        this.pointStarsMesh.visible = false;

        // Clear target - Explicitly clear all 6 faces to ensure no stale data or face bias
        const oldTarget = this.renderer.getRenderTarget();
        this.renderer.setClearColor(0x000000, 1);
        for (let i = 0; i < 6; i++) {
            this.renderer.setRenderTarget(cubeRenderTarget, i);
            this.renderer.clear();
        }

        // 1. Point Stars
        if (pointStars) {
            this.pointStarsMesh.visible = true;
            for (const rot of pStarRotations) {
                this.pointStarsMesh.rotation.copy(rot);
                cubeCamera.update(this.renderer, this.internalScene);
            }
            this.pointStarsMesh.visible = false;
        }

        // 2. Bright Stars
        if (stars) {
            this.boxMesh.visible = true;
            this.boxMesh.material = this.starMaterial;
            for (const s of starParams) {
                this.starMaterial.uniforms.uPosition.value.copy(s.pos);
                this.starMaterial.uniforms.uColor.value.copy(s.color);
                this.starMaterial.uniforms.uSize.value = s.size;
                this.starMaterial.uniforms.uIntensity.value = s.intensity;
                this.starMaterial.uniforms.uFalloff.value = s.falloff;
                cubeCamera.update(this.renderer, this.internalScene);
            }
        }

        // 3. Nebulae
        if (nebulae) {
            this.boxMesh.visible = true;
            this.boxMesh.material = this.nebulaMaterial;
            for (const p of nebulaParams) {
                this.nebulaMaterial.uniforms.uScale.value = p.scale;
                this.nebulaMaterial.uniforms.uColor.value.copy(p.color);
                this.nebulaMaterial.uniforms.uIntensity.value = p.intensity;
                this.nebulaMaterial.uniforms.uFalloff.value = p.falloff;
                this.nebulaMaterial.uniforms.uOffset.value.copy(p.offset);
                cubeCamera.update(this.renderer, this.internalScene);
            }
        }

        // 4. Sun
        if (sun) {
            this.boxMesh.visible = true;
            this.boxMesh.material = this.sunMaterial;
            for (const s of sunParams) {
                this.sunMaterial.uniforms.uPosition.value.copy(s.pos);
                this.sunMaterial.uniforms.uColor.value.copy(s.color);
                this.sunMaterial.uniforms.uSize.value = s.size;
                this.sunMaterial.uniforms.uIntensity.value = s.intensity;
                this.sunMaterial.uniforms.uFalloff.value = s.falloff;
                cubeCamera.update(this.renderer, this.internalScene);
            }
        }

        // Restore renderer state
        this.renderer.autoClear = oldAutoClear;
        this.renderer.outputColorSpace = oldColorSpace;
        this.renderer.toneMapping = oldToneMapping;
        this.renderer.setRenderTarget(oldTarget);
        this.renderer.setSize(oldSize.x, oldSize.y);

        // (Removed duplicate scene removal since we use static cameras)

        // Start transition
        if (this.previousTarget) {
            this.isTransitioning = true;
            this.transitionTime = 0;
            this.blendMaterial.uniforms.tPrev.value = this.previousTarget.texture;
            this.blendMaterial.uniforms.tNext.value = this.currentTarget.texture;
            this.blendMaterial.uniforms.uMix.value = 0.0;
        } else {
            // First run, just copy immediately to displayTarget
            this.isTransitioning = true;
            this.transitionTime = 1.0; // Force immediate end
            this.blendMaterial.uniforms.tPrev.value = this.currentTarget.texture;
            this.blendMaterial.uniforms.tNext.value = this.currentTarget.texture;
            this.blendMaterial.uniforms.uMix.value = 1.0;
        }

        // Prime the display target immediately so it's not black on the first frame
        this.update(0);

        if (this.scene) {
            this.scene.background = this.displayTarget.texture;
            this.scene.environment = this.displayTarget.texture;
        }

        return this.displayTarget.texture;
    }

    /**
     * Returns the currently active texture (blended if transitioning).
     * Assign this once to scene.background or scene.environment.
     */
    get texture() {
        return this.displayTarget ? this.displayTarget.texture : null;
    }

    /**
     * Modern API: Morph smoothly to a new nebula state.
     */
    morph(seedOrParams, params = {}) {
        let seed = seedOrParams;
        let finalParams = params;

        if (typeof seedOrParams === 'object' && seedOrParams !== null) {
            seed = seedOrParams.seed || "nebula";
            finalParams = seedOrParams;
        }

        const duration = finalParams.duration || 1.0;
        this.generate(seed, finalParams);
        // Overwrite the default 1s if custom duration provided
        this._currentDuration = duration;
    }

    /**
     * Updates the crossfade transition. Should be called every frame.
     */
    update(deltaTime) {
        if (!this.isTransitioning) return;

        this.transitionTime += deltaTime;
        const duration = this._currentDuration || 1.0;
        const progress = Math.min(this.transitionTime / duration, 1.0);
        this.blendMaterial.uniforms.uMix.value = progress;

        // Render the blend to displayTarget
        this.blendCubeCamera.update(this.renderer, this.blendScene);

        if (progress >= 1.0) {
            this.isTransitioning = false;
            // No need to dispose! Buffers are reused in the next generate() call.
            this.previousTarget = null;
        }
    }

    /**
     * Legacy/Helper: Generates a nebula cubemap in a single call.
     */
    static create(THREE, renderer, seed = "cosmic", params = {}) {
        const gen = new Nebularity({ THREE, renderer, scene: params.scene });
        gen.generate(seed, params);
        // Force immediate update for first frame
        gen.update(1.0);
        return gen.texture;
    }

    // --- Helpers ---

    hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash += (i + 1) * str.charCodeAt(i);
        }
        return hash;
    }

    randomVec3(rng) {
        const y = rng.random() * 2 - 1;
        const r = Math.sqrt(1 - y * y);
        const phi = rng.random() * Math.PI * 2;
        return [r * Math.cos(phi), y, r * Math.sin(phi)];
    }

    buildStarGeometry(size, pos, dist, starColor, brightness, targetPos, targetCol, index) {
        const pIdx = index * 18;
        const cIdx = index * 18;

        // Face the point towards the center
        this.scratchQuat.setFromUnitVectors(this.scratchZ, pos);

        // Quad vertices (2 triangles)
        const v = [
            -size, -size, 0, size, -size, 0, size, size, 0,
            -size, -size, 0, size, size, 0, -size, size, 0
        ];

        for (let i = 0; i < 6; i++) {
            // Transform vertex
            this.scratchV3.set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]).applyQuaternion(this.scratchQuat);

            // Offset and write to buffer
            targetPos[pIdx + i * 3] = this.scratchV3.x + pos.x * dist;
            targetPos[pIdx + i * 3 + 1] = this.scratchV3.y + pos.y * dist;
            targetPos[pIdx + i * 3 + 2] = this.scratchV3.z + pos.z * dist;

            // Write color to buffer
            targetCol[cIdx + i * 3] = starColor.r * brightness;
            targetCol[cIdx + i * 3 + 1] = starColor.g * brightness;
            targetCol[cIdx + i * 3 + 2] = starColor.b * brightness;
        }
    }
}
