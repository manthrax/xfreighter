/**
 * HUD: Manages the 'Nostromo-style' retro HUD.
 * Combines DOM elements for terminal readouts and Three.js objects for in-world targeting.
 */
import * as THREE from 'three';

export default class HUD {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        
        // --- HUD Containers (Inject into Master Layout) ---
        const colLeft = document.getElementById('col-left');
        const colRight = document.getElementById('col-right');
        
        const style = document.createElement('style');
        style.innerHTML = `
            .readout {
                padding: 12px;
                background: rgba(0, 20, 30, 0.4);
                border: 1px solid rgba(136, 204, 255, 0.1);
                backdrop-filter: blur(8px);
                pointer-events: auto;
                box-sizing: border-box;
                width: 100%;
                color: #88ccff;
                text-shadow: 0 0 5px rgba(136, 204, 255, 0.4);
            }
            .readout-left { border-left: 2px solid rgba(136, 204, 255, 0.5); }
            .readout-right { border-right: 2px solid rgba(136, 204, 255, 0.5); text-align: right; }
            .readout-header {
                font-family: 'Outfit', sans-serif;
                font-size: 0.6rem;
                letter-spacing: 3px;
                color: #88ccff;
                margin-bottom: 10px;
                text-transform: uppercase;
                opacity: 0.7;
                border-bottom: 1px solid rgba(136, 204, 255, 0.1);
                padding-bottom: 4px;
            }
            .stat-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
            .stat-label { opacity: 0.5; font-size: 0.7rem; font-weight: 300; }
            .stat-value { font-weight: 400; color: #fff; font-variant-numeric: tabular-nums; }
            .bar-container { width: 100%; height: 2px; background: rgba(136, 204, 255, 0.1); margin: 6px 0 10px 0; }
            .bar-fill { height: 100%; background: #88ccff; width: 0%; transition: width 0.3s ease; }
            #messages {
                height: 120px;
                font-size: 0.75rem;
                line-height: 1.5;
                display: flex;
                flex-direction: column-reverse;
                gap: 6px;
                overflow: hidden;
                mask-image: linear-gradient(to bottom, transparent 0%, black 20%);
            }
            .msg-entry { padding-left: 10px; animation: msgSlideIn 0.3s ease-out; transition: opacity 0.5s ease-out; }
            .msg-entry.fade-out { opacity: 0; }
            @keyframes msgSlideIn { from { transform: translateX(-10px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            .coord-grid { display: flex; gap: 4px; font-size: 0.85rem; justify-content: flex-end; }
            .coord-seg { width: 70px; text-align: right; color: #fff; white-space: nowrap; font-variant-numeric: tabular-nums; }
        `;
        document.head.appendChild(style);

        // 1. Propulsion Readout
        this.propulsion = document.createElement('div');
        this.propulsion.className = 'readout readout-left';
        this.propulsion.innerHTML = `
            <div class="readout-header">Ship Systems // Propulsion</div>
            <div class="stat-row"><span class="stat-label">THRUST</span><span class="stat-value"><span id="thrust-val">0</span>%</span></div>
            <div class="bar-container"><div id="thrust-bar" class="bar-fill"></div></div>
            <div class="stat-row"><span class="stat-label">CHARGE</span><span class="stat-value"><span id="charge-val">100</span>%</span></div>
            <div class="bar-container"><div id="charge-bar" class="bar-fill" style="background: #ffcc00;"></div></div>
            <div class="stat-row"><span class="stat-label">VELOCITY</span><span class="stat-value"><span id="speed-val">0.0</span> <span style="font-size: 0.6rem; opacity: 0.5;">m/s</span></span></div>
        `;
        colLeft.appendChild(this.propulsion);

        // 2. Message Log
        this.log = document.createElement('div');
        this.log.className = 'readout readout-left';
        this.log.style.marginTop = 'auto'; // Push to bottom
        this.log.innerHTML = `
            <div class="readout-header">Comm Link // Message Log</div>
            <div id="messages"></div>
        `;
        colLeft.appendChild(this.log);

        // 3. Navigation Data
        this.nav = document.createElement('div');
        this.nav.className = 'readout readout-right';
        this.nav.innerHTML = `
            <div class="readout-header">Navigation // Sector Data</div>
            <div id="sector-id" style="font-family: 'Outfit', sans-serif; font-size: 1.1rem; color: #fff;">UNKNOWN SECTOR</div>
            <div class="stat-row" style="margin-top: 8px;">
                <span class="stat-label">POS:</span>
                <div class="coord-grid">
                    <span class="coord-seg" id="pos-x">0</span>
                    <span class="coord-seg" id="pos-y">0</span>
                    <span class="coord-seg" id="pos-z">0</span>
                </div>
            </div>
        `;
        colRight.insertBefore(this.nav, document.getElementById('map-sidebar'));

        // 4. Economy / Wallet
        this.economy = document.createElement('div');
        this.economy.className = 'readout readout-right';
        this.economy.innerHTML = `
            <div class="readout-header">Wallet // Assets</div>
            <div class="stat-row"><span class="stat-label">CREDITS</span><span class="stat-value" id="credits-val" style="color: #ffcc00;">0</span></div>
            <div id="inventory-list" style="font-size: 0.7rem; margin-top: 6px; opacity: 0.8;">EMPTY</div>
        `;
        colRight.appendChild(this.economy);

        // 5. Tactical Scan
        this.scan = document.createElement('div');
        this.scan.className = 'readout readout-right';
        this.scan.style.marginTop = 'auto'; // Push to bottom
        this.scan.innerHTML = `
            <div class="readout-header">Tactical // Local Scan</div>
            <div style="position: relative;">
                <div id="target-info" style="position: absolute; left: 0; top: 0; bottom: 0; width: 80px; font-size: 0.65rem; color: #ffaa00; text-align: left; display: flex; flex-direction: column; justify-content: center; pointer-events: none; text-shadow: 0 0 4px #ffaa00; z-index: 10;">
                    <span style="opacity: 0.5;">TGT //</span>
                    <span id="target-name">NONE</span>
                    <span id="target-dist" style="color: #fff; margin-top: 4px;"></span>
                </div>
                <canvas id="tracker-canvas" width="268" height="120" style="display: block; margin-left: auto;"></canvas>
            </div>
        `;
        colRight.appendChild(this.scan);

        // Cache DOM references
        this.thrustVal = document.getElementById('thrust-val');
        this.thrustBar = document.getElementById('thrust-bar');
        this.speedVal = document.getElementById('speed-val');
        this.chargeVal = document.getElementById('charge-val');
        this.chargeBar = document.getElementById('charge-bar');
        this.sectorId = document.getElementById('sector-id');
        this.posX = document.getElementById('pos-x');
        this.posY = document.getElementById('pos-y');
        this.posZ = document.getElementById('pos-z');
        this.messages = document.getElementById('messages');
        this.creditsVal = document.getElementById('credits-val');
        this.inventoryList = document.getElementById('inventory-list');
        this.trackerCanvas = document.getElementById('tracker-canvas');
        this.trackerCtx = this.trackerCanvas.getContext('2d');
        this.targetName = document.getElementById('target-name');
        this.targetDist = document.getElementById('target-dist');
        
        this.container = { style: { display: 'block' } }; // Shim for visibility logic
        this.readouts = [this.propulsion, this.log, this.nav, this.economy, this.scan];
        
        // Auto-fade properties for ALL panels
        this.readouts.forEach(r => {
            r.style.transition = 'opacity 0.8s ease-out';
            r.style.opacity = '1';
        });

        this.timers = {
            log: Date.now(),
            economy: Date.now(),
            propulsion: Date.now(),
            nav: Date.now(),
            scan: Date.now()
        };

        this.lastStates = {
            economy: "",
            sector: "",
            pos: new THREE.Vector3(),
            target: null,
            targetCount: 0
        };

        this.updateTimer = 0;
        this.updateInterval = 0.1; // 100ms throttle for text
        
        // --- Three.js HUD elements ---
        this.pois = []; // { mesh, position, label }
        this.poiMaterial = new THREE.MeshBasicMaterial({ color: 0x88ccff, wireframe: true });

        this.hide(); // Hide by default
    }

    hide() {
        this.readouts.forEach(r => r.style.display = 'none');
        this.pois.forEach(p => p.group.visible = false);
    }

    show() {
        this.readouts.forEach(r => r.style.display = 'block');
        this.pois.forEach(p => p.group.visible = true);
    }

    update(delta, state) {
        const { thrust, speed, charge, seed, position, ship, targets } = state;
        
        // High-frequency visual updates (Bars) - Keep smooth at 60fps
        this.thrustBar.style.width = `${thrust * 100}%`;
        this.chargeBar.style.width = `${charge}%`;

        // Throttled Text Updates (Reduces jitter and blurriness)
        this.updateTimer += delta;
        if (this.updateTimer >= this.updateInterval) {
            this.updateTimer = 0;
            
            // 1. Propulsion Activity
            if (thrust > 0.01 || Math.abs(speed) > 0.1) {
                this.timers.propulsion = Date.now();
                this.propulsion.style.opacity = '1';
            }

            // 2. Navigation Activity
            const posDist = position ? position.distanceTo(this.lastStates.pos) : 0;
            if (seed !== this.lastStates.sector || posDist > 10) {
                this.timers.nav = Date.now();
                this.nav.style.opacity = '1';
                this.lastStates.sector = seed;
                if (position) this.lastStates.pos.copy(position);
            }

            this.thrustVal.innerText = Math.round(thrust * 100);
            this.speedVal.innerText = speed.toFixed(1);
            this.chargeVal.innerText = Math.round(charge);
            this.sectorId.innerText = seed.toUpperCase();
            
            if (position) {
                this.posX.innerText = Math.round(position.x);
                this.posY.innerText = Math.round(position.y);
                this.posZ.innerText = Math.round(position.z);
            }
            
            // 3. Economy Activity
            if (state.economy) {
                const currentEconString = state.economy.credits + "_" + JSON.stringify(state.economy.inventory);
                if (currentEconString !== this.lastStates.economy) {
                    this.lastStates.economy = currentEconString;
                    this.timers.economy = Date.now();
                    this.economy.style.opacity = '1';
                }

                this.creditsVal.innerText = state.economy.credits.toLocaleString();
                const inv = state.economy.inventory;
                if (inv.length === 0) {
                    this.inventoryList.innerText = "EMPTY";
                } else {
                    this.inventoryList.innerHTML = inv.map(([id, qty]) => `
                        <div style="display: flex; justify-content: space-between;">
                            <span>${id.toUpperCase()}</span>
                            <span>${qty}</span>
                        </div>
                    `).join('');
                }
            }

            // 4. Tactical Activity
            const targetCount = targets ? targets.length : 0;
            if (state.target !== this.lastStates.target || targetCount !== this.lastStates.targetCount) {
                this.timers.scan = Date.now();
                this.scan.style.opacity = '1';
                this.lastStates.target = state.target;
                this.lastStates.targetCount = targetCount;
            }

            if (state.target) {
                const dist = state.position.distanceTo(state.target.position);
                this.targetName.innerText = state.target.userData.name || state.target.userData.type || "UNKNOWN";
                this.targetDist.innerText = dist > 1000 ? (dist / 1000).toFixed(1) + "k" : Math.round(dist) + "m";
            } else {
                this.targetName.innerText = "NONE";
                this.targetDist.innerText = "";
            }

            // Unified Auto-fade logic
            const now = Date.now();
            const FADE_TIME = 2500;
            if (now - this.timers.log > FADE_TIME) this.log.style.opacity = '0';
            if (now - this.timers.economy > FADE_TIME) this.economy.style.opacity = '0';
            if (now - this.timers.propulsion > FADE_TIME) this.propulsion.style.opacity = '0';
            if (now - this.timers.nav > FADE_TIME) this.nav.style.opacity = '0';
            if (now - this.timers.scan > FADE_TIME) this.scan.style.opacity = '0';
        }
        
        // Draw Tracker (Always full FPS)
        this.drawTracker(delta, ship, targets, state.target);
    }

    drawTracker(delta, ship, targets = [], activeTarget = null) {
        const ctx = this.trackerCtx;
        const w = this.trackerCanvas.width;
        const h = this.trackerCanvas.height;
        
        ctx.clearRect(0, 0, w, h);
        
        // Center of tracker is ship
        const centerX = w / 2;
        const centerY = h / 2;
        const scale = 0.005;

        // Draw tactical rings
        ctx.strokeStyle = 'rgba(136, 204, 255, 0.15)';
        ctx.lineWidth = 1;
        [20, 40, 60].forEach(r => {
            ctx.beginPath();
            ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
            ctx.stroke();
        });

        // Draw crosshair
        ctx.beginPath();
        ctx.moveTo(centerX - 10, centerY); ctx.lineTo(centerX + 10, centerY);
        ctx.moveTo(centerX, centerY - 10); ctx.lineTo(centerX, centerY + 10);
        ctx.stroke();
        
        // Transform and Draw targets
        const shipPos = ship.position;
        const shipQuatInv = ship.quaternion.clone().invert();
        const relativePos = new THREE.Vector3();

        targets.forEach(target => {
            if (!target) return;
            relativePos.copy(target.position).sub(shipPos);
            relativePos.applyQuaternion(shipQuatInv);
            
            // X is side, Z is forward/back (-Z is forward in Three.js)
            let tx = centerX + relativePos.x * scale;
            let ty = centerY + relativePos.z * scale;
            
            const dist = relativePos.length();
            const isOutOfRange = (dist * scale > 60);
            
            if (isOutOfRange) {
                const dir = new THREE.Vector2(tx - centerX, ty - centerY).normalize();
                tx = centerX + dir.x * 62;
                ty = centerY + dir.y * 62;
            }

            const pulse = (Math.sin(Date.now() * 0.01) + 1) * 0.5;
            const isCourse = target.userData && target.userData.isCourseTarget;
            const isTargeted = target === activeTarget;
            const type = target.userData ? target.userData.type : 'unknown';

            ctx.fillStyle = isCourse ? '#00ffaa' : (isTargeted ? '#ffaa00' : (isOutOfRange ? '#ff4100' : '#88ccff'));
            
            let baseAlpha = isOutOfRange ? 0.4 : 0.8;
            if (relativePos.y > 100) {
                baseAlpha = Math.min(1.0, baseAlpha + 0.3);
                ctx.shadowBlur = 6;
                ctx.shadowColor = ctx.fillStyle;
            } else if (relativePos.y < -100) {
                baseAlpha = Math.max(0.2, baseAlpha - 0.4);
                ctx.shadowBlur = 0;
            } else {
                ctx.shadowBlur = 0;
            }
            ctx.globalAlpha = baseAlpha;

            if (isTargeted) {
                // Highlight targeted object with a glowing box
                ctx.save();
                ctx.strokeStyle = '#ffaa00';
                ctx.globalAlpha = 0.8 + pulse * 0.2;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.rect(tx - 6, ty - 6, 12, 12);
                ctx.stroke();
                
                // Reticle lines
                ctx.beginPath();
                ctx.moveTo(tx - 10, ty); ctx.lineTo(tx - 4, ty);
                ctx.moveTo(tx + 10, ty); ctx.lineTo(tx + 4, ty);
                ctx.moveTo(tx, ty - 10); ctx.lineTo(tx, ty - 4);
                ctx.moveTo(tx, ty + 10); ctx.lineTo(tx, ty + 4);
                ctx.stroke();
                ctx.restore();
            }

            // Draw glyph based on type
            ctx.beginPath();
            if (type === 'planet') {
                // Circle glyph for planets
                ctx.arc(tx, ty, isCourse ? 4 : 3, 0, Math.PI * 2);
                ctx.fill();
            } else if (type === 'warp') {
                // Diamond glyph for warp points
                ctx.save();
                ctx.translate(tx, ty);
                ctx.rotate(Math.PI / 4);
                const s = isCourse ? 5 : 3.5;
                ctx.rect(-s/2, -s/2, s, s);
                ctx.restore();
                ctx.fill();
            } else if (type === 'ship') {
                // Triangle glyph for other ships
                ctx.moveTo(tx, ty - 4);
                ctx.lineTo(tx - 3.5, ty + 3);
                ctx.lineTo(tx + 3.5, ty + 3);
                ctx.closePath();
                ctx.fill();
            } else {
                // Default dot
                ctx.arc(tx, ty, 2, 0, Math.PI * 2);
                ctx.fill();
            }

            // Altitude indicator line
            ctx.strokeStyle = ctx.fillStyle;
            ctx.globalAlpha = 0.2;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx, ty - relativePos.y * scale * 0.5);
            ctx.stroke();

            if (isCourse) {
                ctx.globalAlpha = pulse * 0.3;
                ctx.beginPath();
                ctx.arc(tx, ty, 8 + pulse * 4, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            // reset shadow
            ctx.shadowBlur = 0;
        });

        // Ship Icon (Modernized)
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - 4);
        ctx.lineTo(centerX - 3, centerY + 4);
        ctx.lineTo(centerX + 3, centerY + 4);
        ctx.fill();
    }

    addMessage(msg) {
        this.timers.log = Date.now();
        this.log.style.opacity = '1';

        const div = document.createElement('div');
        div.className = 'msg-entry';
        div.innerText = msg;
        this.messages.prepend(div);
        
        // Remove oldest if too many
        if (this.messages.children.length > 8) this.messages.lastChild.remove();
        
        // Auto fade out after 0.75 seconds (0.75s display + 0.5s fade)
        setTimeout(() => {
            div.classList.add('fade-out');
            setTimeout(() => {
                if (div.parentElement === this.messages) {
                    div.remove();
                }
            }, 500); // Wait for transition
        }, 750);

        // Add a flash effect to the log container
        this.messages.parentElement.classList.add('glitch-flash');
        setTimeout(() => this.messages.parentElement.classList.remove('glitch-flash'), 300);
    }

    /**
     * Add a POI marker in the 3D world
     */
    addTargetPOI(position, label = "UNKNOWN") {
        const group = new THREE.Group();
        
        // Retro diamond marker
        const geometry = new THREE.OctahedronGeometry(1, 0);
        const mesh = new THREE.Mesh(geometry, this.poiMaterial);
        group.add(mesh);
        
        group.position.copy(position);
        this.scene.add(group);
        
        this.pois.push({ group, position, label });
    }

    /**
     * Handle window resizing
     */
    resize(w, h) {
        // Tracker canvas doesn't necessarily need to change pixel size 
        // unless you want it to scale with the window. 
        // Let's keep it fixed at 300x120 for the layout, 
        // but ensuring the parent container is correct.
    }
}
