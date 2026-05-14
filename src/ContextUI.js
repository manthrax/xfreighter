/**
 * ContextUI: Manages context-aware prompts and TTS captions at the top of the screen.
 */
export default class ContextUI {
    constructor() {
        this.container = document.getElementById('top-panel');
        
        const style = document.createElement('style');
        style.innerHTML = `
            .context-prompt {
                background: rgba(0, 20, 30, 0.6);
                border: 1px solid #88ccff;
                border-top: 3px solid #88ccff;
                padding: 10px 30px;
                color: #fff;
                font-family: 'Outfit', sans-serif;
                font-size: 0.9rem;
                letter-spacing: 2px;
                text-transform: uppercase;
                backdrop-filter: blur(10px);
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                opacity: 0;
                transform: translateY(-20px);
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                pointer-events: none;
            }
            .context-prompt.active {
                opacity: 1;
                transform: translateY(0);
            }
            .caption-text {
                color: #ffaa00;
                font-family: 'Inter', sans-serif;
                font-size: 1.1rem;
                font-weight: 300;
                text-shadow: 0 0 8px rgba(255, 170, 0, 0.6);
                max-width: 600px;
                text-align: center;
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            .caption-text.active {
                opacity: 1;
            }
            .prompt-key {
                background: #88ccff;
                color: #000;
                padding: 2px 8px;
                border-radius: 2px;
                font-weight: 800;
                margin-right: 10px;
            }
        `;
        document.head.appendChild(style);

        // 1. Prompt element
        this.promptEl = document.createElement('div');
        this.promptEl.className = 'context-prompt';
        this.container.appendChild(this.promptEl);

        // 2. Caption element
        this.captionEl = document.createElement('div');
        this.captionEl.className = 'caption-text';
        this.container.appendChild(this.captionEl);

        this.currentPrompt = null;
        this.captionTimeout = null;
    }

    /**
     * Set a context prompt (e.g. "Press B to Trade")
     */
    setPrompt(key, text) {
        if (!key && !text) {
            this.promptEl.classList.remove('active');
            this.currentPrompt = null;
            return;
        }

        const newPrompt = `${key}:${text}`;
        if (this.currentPrompt === newPrompt) return;

        this.currentPrompt = newPrompt;
        this.promptEl.innerHTML = `<span class="prompt-key">${key}</span> ${text}`;
        this.promptEl.classList.add('active');
    }

    /**
     * Show a caption (e.g. for TTS)
     */
    showCaption(text, duration = 3000) {
        if (this.captionTimeout) clearTimeout(this.captionTimeout);

        this.captionEl.innerText = text;
        this.captionEl.classList.add('active');

        this.captionTimeout = setTimeout(() => {
            this.captionEl.classList.remove('active');
        }, duration);
    }
}
