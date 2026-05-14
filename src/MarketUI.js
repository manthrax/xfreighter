import * as THREE from 'three';
import PlanetGenerator from './PlanetGenerator.js';

export default class MarketUI {
    constructor(deps) {
        this.economy = deps.economy;
        this.hud = deps.hud;
        this.sectorManager = deps.sectorManager;
        
        this.previewRenderer = null;
        this.previewScene = null;
        this.previewCamera = null;
        this.previewPlanet = null;
        this.previewClouds = null;
        this.uiPlanetGen = null;
        
        this.flightController = null;
        this.currentSector = null;

        document.getElementById('closeMarket').addEventListener('click', () => this.close());
        window.marketAction = (action, itemId, price) => this.handleAction(action, itemId, price);
    }

    setupPreview() {
        const container = document.getElementById('planet-preview-container');
        if (!container || this.previewRenderer) return;

        this.previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.previewRenderer.setSize(200, 200);
        this.previewRenderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(this.previewRenderer.domElement);

        this.uiPlanetGen = new PlanetGenerator(this.previewRenderer);

        this.previewScene = new THREE.Scene();
        this.previewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        this.previewCamera.position.z = 2.5;

        const light = new THREE.DirectionalLight(0xffffff, 2.5);
        light.position.set(5, 3, 5);
        this.previewScene.add(light);
        this.previewScene.add(new THREE.AmbientLight(0xffffff, 0.6));

        const geo = new THREE.SphereGeometry(1.2, 64, 64);
        const mat = new THREE.MeshBasicMaterial();
        this.previewPlanet = new THREE.Mesh(geo, mat);
        this.previewScene.add(this.previewPlanet);

        const cloudGeo = new THREE.SphereGeometry(1.23, 64, 64);
        const cloudMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
        this.previewClouds = new THREE.Mesh(cloudGeo, cloudMat);
        this.previewScene.add(this.previewClouds);
    }

    open(flightController, currentSector) {
        if (flightController) this.flightController = flightController;
        if (currentSector) this.currentSector = currentSector;

        if (!this.currentSector) return; // Guard against opening without a sector context

        if (this.flightController && this.flightController.mouseLookEnabled) {
            this.flightController.mouseLookEnabled = false;
            if (document.pointerLockElement) document.exitPointerLock();
        }

        const ui = document.getElementById('market-ui');
        const list = document.getElementById('market-list');
        const creditDisplay = document.getElementById('market-credits');

        const prices = this.economy.getMarketPrices(this.currentSector.seed);
        creditDisplay.innerText = `${this.economy.credits.toLocaleString()} CR`;

        list.innerHTML = this.economy.commodities.map(item => {
            const p = prices[item.id];
            const invQty = this.economy.inventory.get(item.id) || 0;
            return `
                <div class="market-row">
                    <div>
                        <div style="color: #fff; font-size: 0.9rem;">${item.name}</div>
                        <div style="font-size: 0.7rem; opacity: 0.5;">IN CARGO: ${invQty}</div>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div style="text-align: right; min-width: 80px;">
                            <div style="color: #ffcc00; font-size: 0.8rem;">${p.buyPrice} CR</div>
                            <button class="market-btn" onclick="window.marketAction('buy', '${item.id}', ${p.buyPrice})">BUY</button>
                        </div>
                        <div style="text-align: right; min-width: 80px;">
                            <div style="color: #00ffaa; font-size: 0.8rem;">${p.sellPrice} CR</div>
                            <button class="market-btn" onclick="window.marketAction('sell', '${item.id}', ${p.sellPrice})" ${invQty === 0 ? 'disabled' : ''}>SELL</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        let nearestPlanet = null;
        let minDist = 1000000;
        this.sectorManager.planets.forEach(p => {
            const d = this.flightController.ship.position.distanceTo(p.position);
            if (d < minDist) {
                minDist = d;
                nearestPlanet = p;
            }
        });

        // if (!this.previewPlanet) this.setupPreview();

        /*
        if (nearestPlanet && this.previewPlanet && this.uiPlanetGen) {
            const uiTexture = this.uiPlanetGen.generate(nearestPlanet.userData.seed, { resolution: 1024 });
            this.previewPlanet.material.map = uiTexture;
            this.previewPlanet.material.needsUpdate = true;

            if (this.previewClouds) {
                const uiCloudTexture = this.uiPlanetGen.generate(nearestPlanet.userData.seed, { resolution: 512, mode: 'clouds', waterLevel: 0.2 });
                this.previewClouds.material.map = uiCloudTexture;
                this.previewClouds.material.needsUpdate = true;
            }
        }
        */

        ui.classList.add('active');
        if (document.pointerLockElement) document.exitPointerLock();
    }

    close() {
        document.getElementById('market-ui').classList.remove('active');
        if (this.flightController) this.flightController.mouse.isLocked = false;
    }

    handleAction(action, itemId, price) {
        if (action === 'buy') {
            if (this.economy.buy(itemId, 1, price)) {
                this.hud.addMessage(`PURCHASED 1 UNIT OF ${itemId.toUpperCase()}.`);
            } else {
                this.hud.addMessage(`INSUFFICIENT CREDITS.`);
            }
        } else {
            if (this.economy.sell(itemId, 1, price)) {
                this.hud.addMessage(`SOLD 1 UNIT OF ${itemId.toUpperCase()}.`);
            }
        }
        this.open();
    }

    update(delta) {
        const marketUI = document.getElementById('market-ui');
        if (marketUI && marketUI.classList.contains('active') && this.previewRenderer) {
            /*
            this.previewPlanet.rotation.y += delta * 0.1;
            if (this.previewClouds) this.previewClouds.rotation.y += delta * 0.15;
            this.previewRenderer.render(this.previewScene, this.previewCamera);
            */
        }
    }
}
