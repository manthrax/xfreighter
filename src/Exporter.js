import * as THREE from 'three';
import { EXRExporter } from 'three/examples/jsm/exporters/EXRExporter.js';

export default class Exporter {
    constructor(renderer) {
        this.renderer = renderer;
        this.initEquirectShader();
    }

    initEquirectShader() {
        this.equirectMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tCube: { value: null },
                uFlipY: { value: 1.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform samplerCube tCube;
                uniform float uFlipY;
                varying vec2 vUv;
                const float PI = 3.14159265359;
                void main() {
                    float phi = vUv.x * 2.0 * PI;
                    float y = (uFlipY > 0.5) ? (1.0 - vUv.y) : vUv.y;
                    float theta = y * PI;
                    vec3 dir = vec3(
                        -sin(theta) * sin(phi),
                        cos(theta),
                        -sin(theta) * cos(phi)
                    );
                    gl_FragColor = textureCube(tCube, dir);
                }
            `,
            side: THREE.DoubleSide
        });

        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.equirectMaterial);
        this.scene.add(this.quad);
    }

    async exportEquirect(cubeTexture, resolution = 2048, format = 'jpg') {
        const width = resolution;
        const height = resolution / 2;

        const renderTarget = new THREE.WebGLRenderTarget(width, height, {
            format: THREE.RGBAFormat,
            type: format === 'exr' ? THREE.HalfFloatType : THREE.UnsignedByteType,
            colorSpace: THREE.LinearSRGBColorSpace
        });

        this.equirectMaterial.uniforms.tCube.value = cubeTexture;
        this.equirectMaterial.uniforms.uFlipY.value = (format === 'jpg') ? 0.0 : 1.0;
        
        const oldTarget = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(renderTarget);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(oldTarget);

        if (format === 'exr') {
            await this.downloadEXR(renderTarget, width, height);
        } else {
            this.downloadJPG(renderTarget, width, height);
        }

        renderTarget.dispose();
    }

    async downloadEXR(renderTarget, width, height) {
        const exporter = new EXRExporter();
        const result = await exporter.parse(this.renderer, renderTarget);
        this.saveBlob(new Blob([result], { type: 'image/x-exr' }), 'nebula_vista.exr');
    }

    downloadJPG(renderTarget, width, height) {
        const pixels = new Uint8Array(width * height * 4);
        this.renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        
        imageData.data.set(pixels);
        ctx.putImageData(imageData, 0, 0);
        
        canvas.toBlob((blob) => {
            this.saveBlob(blob, 'nebula_vista.jpg');
        }, 'image/jpeg', 0.95);
    }

    saveBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }
}
