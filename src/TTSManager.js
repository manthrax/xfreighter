/**
 * TTSManager - A wrapper for the Kokoro TTS engine.
 * Handles model loading, worker communication, and audio playback.
 */
export default class TTSManager {
    constructor() {
        this.worker = null;
        this.currentAudio = null;
        this.isReady = false;
        this.isMuted = false;
        this.onProgress = null; // Callback for loading progress
        this.onReady = null;    // Callback for when model is ready
        this.onStart = null;    // Callback for when speech starts
        this.onEnd = null;      // Callback for when speech ends
        this.onSubtitles = null; // Callback for word timestamps

        this._speakResolve = null; // Promise resolver for current speech

        this.speechQueue = null; // Queue for speech if audio is blocked
        this._hasInteracted = false;
        this._setupGestureLock();

        this.voices = {
            "American English": [
                { id: "af_heart", name: "Heart" },
                { id: "af_alloy", name: "Alloy" },
                { id: "af_aoede", name: "Aoede" },
                { id: "af_bella", name: "Bella" },
                { id: "af_jessica", name: "Jessica" },
                { id: "af_kore", name: "Kore" },
                { id: "af_nicole", name: "Nicole" },
                { id: "af_nova", name: "Nova" },
                { id: "af_river", name: "River" },
                { id: "af_sarah", name: "Sarah" },
                { id: "af_sky", name: "Sky" },
                { id: "am_adam", name: "Adam" },
                { id: "am_echo", name: "Echo" },
                { id: "am_eric", name: "Eric" },
                { id: "am_fenrir", name: "Fenrir" },
                { id: "am_liam", name: "Liam" },
                { id: "am_michael", name: "Michael" },
                { id: "am_onyx", name: "Onyx" },
                { id: "am_puck", name: "Puck" },
                { id: "am_santa", name: "Santa" },
            ],
            "British English": [
                { id: "bf_alice", name: "Alice" },
                { id: "bf_emma", name: "Emma" },
                { id: "bf_isabella", name: "Isabella" },
                { id: "bf_lily", name: "Lily" },
                { id: "bm_daniel", name: "Daniel" },
                { id: "bm_fable", name: "Fable" },
                { id: "bm_george", name: "George" },
                { id: "bm_lewis", name: "Lewis" },
            ],
        };

        this._subtitleAnimationFrame = null;
        this._speechQueue = [];
        this._isProcessingQueue = false;
    }

    /**
     * Initializes the TTS engine.
     * @returns {Promise<void>} Resolves when the model is loaded and ready.
     */
    async init() {
        if (this.isReady) return;

        return new Promise((resolve, reject) => {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const modelUrl = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.min.js";
            //"/kokoro.web.min.js"; //
            // Inline worker code for portability, based on tts-demo.html
            const workerCode = `
                let tts=null;
                let filesProgress={};
                let lastWordTimestamps=null;

                function progress(ev){
                    if(ev.status==="progress"){
                        if(!filesProgress.hasOwnProperty(ev.file)){
                            filesProgress[ev.file]={ loaded:0, total:0 };
                        }
                        filesProgress[ev.file].loaded=ev.loaded;
                        filesProgress[ev.file].total=ev.total;
                        let loaded=0, total=0;
                        for(let key in filesProgress){
                            loaded+=filesProgress[key].loaded;
                            total+=filesProgress[key].total;
                        }
                        self.postMessage({
                            type:"progress",
                            loaded, total,
                            percent:total>0?(loaded/total)*100:0
                        });
                    }
                }

                function normalizeText(text){
                    // Simplified normalization for the API
                    return text.replace(/['']/g,"'").replace(/[""]/g,'"').trim();
                }

                self.onmessage=async(e)=>{
                    const { cmd, text, voice, speed }=e.data;

                    if(cmd==="init"){
                        try{
                            const { KokoroTTS }=await import("${modelUrl}");
                            try {
                                tts=await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX-timestamped", {
                                    dtype: "${isMobile ? "q4" : "fp32"}",
                                    device: "${isMobile ? "wasm" : "webgpu"}",
                                    progress_callback: progress
                                });
                            } catch(err) {
                                tts=await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX-timestamped", {
                                    dtype: "q4", device: "wasm", progress_callback: progress
                                });
                            }
                            
                            // Patch model to capture timestamps
                            const model = tts.model;
                            const originalCall = model._call.bind(model);
                            model._call = async function(...args) {
                                const output = await originalCall(...args);
                                if(output.durations) {
                                    const durations = Array.from(output.durations.data);
                                    const inputIds = args[0]?.input_ids ? Array.from(args[0].input_ids.data) : [];
                                    const sampleRate = 24000;
                                    const samplesPerUnit = output.waveform.data.length / durations.reduce((a,b)=>a+b,0);
                                    const durationsInSeconds = durations.map(d=>(d*samplesPerUnit)/sampleRate);
                                    const decodedTokens = inputIds.map(id => {
                                        try { return tts.tokenizer.decode([id], {skip_special_tokens:false}); } catch { return "["+id+"]"; }
                                    });
                                    
                                    let cumulative = 0;
                                    const phonemeTimestamps = durationsInSeconds.map((dur, i) => {
                                        const start = cumulative;
                                        cumulative += dur;
                                        return { index:i, token:decodedTokens[i], start, end:cumulative, duration:dur };
                                    });

                                    let wordTimestamps = [];
                                    let currentWord = { phonemes:[], start:null, end:null };
                                    for(const p of phonemeTimestamps) {
                                        if(p.token==="$" || p.token===" ") {
                                            if(currentWord.phonemes.length > 0) {
                                                currentWord.end = currentWord.phonemes[currentWord.phonemes.length-1].end;
                                                wordTimestamps.push(currentWord);
                                                currentWord = { phonemes:[], start:null, end:null };
                                            }
                                        } else {
                                            if(currentWord.start === null) currentWord.start = p.start;
                                            currentWord.phonemes.push(p);
                                        }
                                    }
                                    if(currentWord.phonemes.length > 0) {
                                        currentWord.end = currentWord.phonemes[currentWord.phonemes.length-1].end;
                                        wordTimestamps.push(currentWord);
                                    }
                                    lastWordTimestamps = wordTimestamps;
                                }
                                return output;
                            };

                            self.postMessage({ type:"ready" });
                        } catch(err) {
                            self.postMessage({ type:"error", error:err.message });
                        }
                        return;
                    }

                    if(cmd==="speak"){
                        if(!tts) return;
                        try {
                            lastWordTimestamps = null;
                            const result = await tts.generate(text, { voice: voice || "bm_lewis", speed: speed || 1 });
                            const pcm = result.audio;
                            const sampleRate = result.sampling_rate;
                            const displayWords = text.match(/\\b[\\w']+[.,!?;:…]*|\\S+/g)?.filter(Boolean) ?? [];
                            
                            let timestamps;
                            if(lastWordTimestamps && lastWordTimestamps.length > 0) {
                                const nw = lastWordTimestamps.length;
                                const dw = displayWords.length;
                                timestamps = displayWords.map((word, i) => ({
                                    word,
                                    start: lastWordTimestamps[Math.min(Math.floor((i*nw)/dw), nw-1)].start,
                                    end: lastWordTimestamps[Math.min(Math.floor((i*nw)/dw), nw-1)].end
                                }));
                            } else {
                                const total = pcm.length / sampleRate;
                                const avg = total / displayWords.length;
                                timestamps = displayWords.map((word, i) => ({ word, start: i*avg, end: (i+1)*avg }));
                            }

                            self.postMessage({ type:"audio", pcm, sampleRate, timestamps }, [pcm.buffer]);
                        } catch(err) {
                            self.postMessage({ type:"error", error:err.message });
                        }
                    }
                };
            `;

            const blob = new Blob([workerCode], { type: "application/javascript" });
            this.worker = new Worker(URL.createObjectURL(blob), { type: "module" });

            this.worker.onmessage = (e) => {
                const data = e.data;
                switch (data.type) {
                    case "progress":
                        if (this.onProgress) this.onProgress(data.percent);
                        break;
                    case "ready":
                        this.isReady = true;
                        if (this.onReady) this.onReady();
                        resolve();
                        break;
                    case "audio":
                        this._handleAudioData(data.pcm, data.sampleRate, data.timestamps);
                        break;
                    case "error":
                        console.error("TTS Worker Error:", data.error);
                        reject(new Error(data.error));
                        break;
                }
            };

            this.worker.postMessage({ cmd: "init" });
        });
    }

    /**
     * Generates and plays speech.
     * @param {string} text The text to speak.
     * @param {object} options { voice, speed }
     * @returns {Promise<void>} Resolves when speech is finished.
     */
    async speak(text, options = {}) {
        return new Promise((resolve) => {
            this._speechQueue.push({ text, options, resolve });
            this._processQueue();
        });
    }

    async _processQueue() {
        if (this._isProcessingQueue || this._speechQueue.length === 0) return;
        this._isProcessingQueue = true;

        const { text, options, resolve } = this._speechQueue.shift();

        if (!this.isReady || !this._hasInteracted) {
            console.warn("TTSManager: Not ready or no gesture. Queuing speech.");
            this.speechQueue = [{ text, options }]; // Keep the "auto-unlock" one for the first interaction
            this._isProcessingQueue = false;
            resolve();
            return;
        }

// console.log(`TTSManager: Processing speech: "${text}"`);

        // Return a promise for this specific speech task
        await new Promise((done) => {
            this._speakResolve = () => {
                done();
                resolve();
            };

            this.worker.postMessage({
                cmd: "speak",
                text,
                voice: options.voice || "bm_lewis",
                speed: options.speed || 1
            });
        });

        this._isProcessingQueue = false;
        this._processQueue();
    }

    _setupGestureLock() {
        const unlock = () => {
            if (this._hasInteracted) return;
            this._hasInteracted = true;
            console.log("TTSManager: User gesture detected, audio unlocked.");

            // Remove listeners
            window.removeEventListener('click', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);

            // Play queued speech if any
            if (this.speechQueue) {
                const { text, options } = this.speechQueue;
                this.speechQueue = null;
                this.speak(text, options);
            }
        };

        window.addEventListener('click', unlock);
        window.addEventListener('keydown', unlock);
        window.addEventListener('touchstart', unlock);
    }

    /**
     * Stops the current speech playback.
     */
    stop() {
        cancelAnimationFrame(this._subtitleAnimationFrame);
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        if (this.onEnd) this.onEnd();
        if (this._speakResolve) {
            const res = this._speakResolve;
            this._speakResolve = null;
            res();
        }
    }

    _handleAudioData(pcm, sampleRate, timestamps) {
        console.log("TTSManager: Audio data received, padding and playing...");

        // Add silence to prevent clipping on some hardware/browsers
        const silenceDuration = 0.25;
        const silenceSamples = Math.floor(sampleRate * silenceDuration);
        const paddedPcm = new Float32Array(pcm.length + silenceSamples);
        paddedPcm.set(pcm, silenceSamples);

        // Offset timestamps to match the padded audio
        const paddedTimestamps = timestamps.map(t => ({
            ...t,
            start: t.start + silenceDuration,
            end: t.end + silenceDuration
        }));

        const wav = this._floatToWav(paddedPcm, sampleRate);
        const blob = new Blob([wav], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);

        this.currentAudio = new Audio(url);
        this.currentAudio.volume = this.isMuted ? 0 : 1;

        this.currentAudio.onplay = () => {
            console.log("TTSManager: Playback started.");
            if (this.onStart) this.onStart();
            this._animateSubtitles(paddedTimestamps);
        };

        this.currentAudio.onended = () => {
            console.log("TTSManager: Playback ended.");
            this.stop();
            URL.revokeObjectURL(url);
        };

        this.currentAudio.play().catch(err => {
            console.error("TTS Audio Play Error (likely blocked by browser):", err);
        });
    }

    _animateSubtitles(timestamps) {
        const update = () => {
            if (!this.currentAudio) return;
            const currentTime = this.currentAudio.currentTime;

            if (this.onSubtitles) {
                const activeIndex = timestamps.findIndex(t => currentTime >= t.start && currentTime <= t.end);
                this.onSubtitles(timestamps, activeIndex);
            }

            if (!this.currentAudio.paused) {
                this._subtitleAnimationFrame = requestAnimationFrame(update);
            }
        };
        update();
    }

    _floatToWav(pcm, sampleRate) {
        const buffer = new ArrayBuffer(44 + pcm.length * 2);
        const view = new DataView(buffer);
        let offset = 0;

        const writeString = (str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset++, str.charCodeAt(i));
        };

        writeString("RIFF");
        view.setUint32(offset, 36 + pcm.length * 2, true); offset += 4;
        writeString("WAVE");
        writeString("fmt ");
        view.setUint32(offset, 16, true); offset += 4;
        view.setUint16(offset, 1, true); offset += 2;
        view.setUint16(offset, 1, true); offset += 2;
        view.setUint32(offset, sampleRate, true); offset += 4;
        view.setUint32(offset, sampleRate * 2, true); offset += 4;
        view.setUint16(offset, 2, true); offset += 2;
        view.setUint16(offset, 16, true); offset += 2;
        writeString("data");
        view.setUint32(offset, pcm.length * 2, true); offset += 4;

        for (let i = 0; i < pcm.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, pcm[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return buffer;
    }
}
