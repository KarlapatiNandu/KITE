/**
 * FluidAI — Voice Assistant Fluid UI
 * ====================================
 * Modules:
 *  1. Config
 *  2. WaterSurface  — spring-mass physics
 *  3. FluidRenderer — Canvas 2D drawing
 *  4. AudioEngine   — Web Audio API (mic + assistant)
 *  5. VoiceUI       — State machine + animation loop
 */

// ============================================================
// 1. CONFIG
// ============================================================
const CFG = {
    NUM_POINTS: 180,    // spring-mass resolution

    // ── Phase 3.1: Spring-Mass Tuning ──────────────────────────
    // Lower dampening (was 0.982) → waves travel further before dying
    DAMPENING: 0.970,  // energy retention per tick — 20% less loss
    // Higher spread (was 0.23) → adjacent nodes couple 50% more strongly
    SPREAD: 0.2,  // neighbour force transfer coefficient --------------------
    SPREAD_ITERS: 6,      // more passes = wider wave propagation
    // Lower spring stiffness (was 0.038, set in update()) → taller peaks
    SPRING_K: 0.022,  // Hooke's law constant (overrides inline value)

    // ── Phase 3.2: Velocity / Height clamping ──────────────────
    MAX_VEL: 28,     // max velocity per node (prevents explosion)
    MAX_HEIGHT: 38,     // max height displacement in px

    // ── Phase 4.1: Edge reflection ──────────────────────────────
    REFLECT_COEFF: 0.52,   // fraction of wave energy reflected at edges

    IDLE_AMP: 2.8,    // idle sine wave amplitude (px)
    IDLE_SPEED: 0.28,   // idle sine wave speed (rad/s)
    IDLE_FREQ: 2.4,    // idle sine cycles across surface

    // ── Phase 1: Audio Sensitivity ──────────────────────────────
    SENSITIVITY_MULTIPLIER: 2.5,  // global gain multiplier (1.5 = +50%)
    // Dynamic noise gate — signals below this (post-gain) are ignored
    NOISE_GATE: 0.018,  // RMS threshold after sensitivity applied

    // Listening (mic) impulse scaling
    MIC_FORCE_SCALE: 28,     // max force injected from mic volume (was 18)
    MIC_SPLASH_WIDTH: 32,     // how many points are disturbed per impulse
    MIC_IMPULSE_RATE: 0.38,   // probability of injecting impulse per frame

    // ── Phase 2: Speaker-cone bass / treble mapping ─────────────
    // Bass (20–250 Hz): wide unified lift like a speaker cone push
    BASS_FORCE_SCALE: 25,   // force multiplier for bass cone-push event
    BASS_CONE_WIDTH: 60,   // how many center nodes the bass lifts (wide)
    BASS_THRESHOLD: 0.12, // normalised bass energy to trigger cone push
    // High-freq (3kHz+): narrow sharp spikes for sibilance
    HF_FORCE_SCALE: 22,   // force for high-frequency spike
    HF_SPLASH_WIDTH: 4,    // very narrow = sharp spiky peaks
    HF_THRESHOLD: 0.15, // normalised HF energy to trigger treble spike

    // Speaking (assistant) impulse scaling
    AST_FORCE_SCALE: 60,    // was 38
    AST_SPLASH_WIDTH: 28,
    AST_IMPULSE_RATE: 0.28,  // was 0.22

    // Audio smoothing
    LERP_ALPHA: 0.14,   // slightly snappier response
    VOL_THRESHOLD: 0.008,  // minimum raw RMS to count as active

    // Fluid visual constants
    FLUID_FILL_LOW: 0.52,
    FLUID_FILL_HIGH: 0.66,

    // FPS target
    TARGET_FPS: 60,
};

// ============================================================
// 2. WATER SURFACE — Spring-mass physics
// ============================================================
class WaterSurface {
    constructor(numPoints) {
        this.n = numPoints;
        this.h = new Float32Array(numPoints);  // heights (displacement from rest)
        this.vel = new Float32Array(numPoints);  // velocities
        this.lDeltas = new Float32Array(numPoints);
        this.rDeltas = new Float32Array(numPoints);
    }

    /**
     * Inject an impulse at position `idx` with a given `force`.
     * The force is distributed across a gaussian window of `width` points.
     */
    splash(idx, force, width = 14) {
        const half = width / 2;
        for (let i = Math.max(0, idx - half | 0); i < Math.min(this.n, idx + half | 0); i++) {
            const dist = Math.abs(i - idx);
            const gaussian = Math.exp(-(dist * dist) / (2 * (half * 0.45) ** 2));
            this.vel[i] += force * gaussian;
        }
    }

    /**
     * Apply a slow background sine wave (idle state).
     */
    applyIdleWave(t, amp = CFG.IDLE_AMP) {
        for (let i = 0; i < this.n; i++) {
            const phase = (i / this.n) * CFG.IDLE_FREQ * Math.PI * 2;
            const target = Math.sin(phase - t * CFG.IDLE_SPEED) * amp;
            // Gentle nudge towards the sine value rather than hard-setting
            this.vel[i] += (target - this.h[i]) * 0.004;
        }
    }

    /**
     * Apply uniform wide-radius upward force to center nodes (speaker cone push).
     * Simulates a plosive/bass frequency physically pushing air upward.
     * @param {number} force     - upward force magnitude (positive = up)
     * @param {number} halfWidth - how many points from center to affect
     */
    conePush(force, halfWidth) {
        const center = this.n / 2;
        const lo = Math.max(0, center - halfWidth | 0);
        const hi = Math.min(this.n, center + halfWidth | 0);
        for (let i = lo; i < hi; i++) {
            // Cosine envelope so the push is strongest at center, tapers at edges
            const norm = (i - lo) / (hi - lo);          // 0..1 across the cone
            const env = Math.cos((norm - 0.5) * Math.PI); // 0 at edges, 1 at center
            this.vel[i] += -force * env;                 // negative = upward
        }
    }

    /**
     * Run one physics tick (delta-time aware).
     */
    update() {
        const { n, h, vel, lDeltas, rDeltas } = this;

        // ── Neighbour spreading (Phase 3.1: increased SPREAD + SPREAD_ITERS) ──
        for (let pass = 0; pass < CFG.SPREAD_ITERS; pass++) {
            for (let i = 0; i < n; i++) {
                if (i > 0) {
                    lDeltas[i] = CFG.SPREAD * (h[i] - h[i - 1]);
                    vel[i - 1] += lDeltas[i];
                }
                if (i < n - 1) {
                    rDeltas[i] = CFG.SPREAD * (h[i] - h[i + 1]);
                    vel[i + 1] += rDeltas[i];
                }
            }
            for (let i = 0; i < n; i++) {
                if (i > 0) h[i - 1] += lDeltas[i];
                if (i < n - 1) h[i + 1] += rDeltas[i];
            }
        }

        // ── Phase 4.1: Edge reflection ──────────────────────────────────────────
        // When wave energy reaches node[0] or node[n-1] it bounces back inward.
        // This creates complex interference patterns like liquid on a vibrating plate.
        vel[1] -= CFG.REFLECT_COEFF * vel[0];       // left wall
        vel[n - 2] -= CFG.REFLECT_COEFF * vel[n - 1];   // right wall
        vel[0] = 0;
        vel[n - 1] = 0;

        // ── Integrate + Hooke's law + dampen + clamp (Phase 3.1 + 3.2) ─────────
        for (let i = 0; i < n; i++) {
            vel[i] += -h[i] * CFG.SPRING_K;  // lower stiffness → taller peaks
            vel[i] *= CFG.DAMPENING;         // reduced loss → longer travel
            // Phase 3.2: hard clamp velocity to prevent physics explosion
            vel[i] = Math.max(-CFG.MAX_VEL, Math.min(CFG.MAX_VEL, vel[i]));
            h[i] += vel[i];
            // Phase 3.2: hard clamp height so fluid never escapes the container
            h[i] = Math.max(-CFG.MAX_HEIGHT, Math.min(CFG.MAX_HEIGHT, h[i]));
        }
    }

    reset() {
        this.h.fill(0);
        this.vel.fill(0);
    }
}

// ============================================================
// 3. FLUID RENDERER — Canvas 2D
// ============================================================
class FluidRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = 0;
        this.height = 0;
        this.baseY = 0;       // fluid rest-line Y coordinate
        this.colorPhase = 0;   // for bass-pulse hue shift
        this.resize();
    }

    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = this.canvas.getBoundingClientRect();
        this.width = rect.width * dpr;
        this.height = rect.height * dpr;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx.scale(dpr, dpr);
        this.logW = rect.width;
        this.logH = rect.height;
        this.baseY = this.logH * CFG.FLUID_FILL_LOW;
    }

    /**
     * Draw one frame.
     * @param {Float32Array} heights - WaterSurface.h
     * @param {object} audioState   - { volume, pitch, bassEnergy, state }
     * @param {number} t            - elapsed time in seconds
     */
    draw(heights, audioState, t) {
        const { ctx, logW, logH } = this;
        const n = heights.length;
        const step = logW / (n - 1);

        // Update colour pulse from bass energy
        const bass = audioState.bassEnergy || 0;
        this.colorPhase += bass * 0.6;

        // Determine fluid surface level (rises with volume)
        const vol = audioState.volume || 0;
        const surfaceRise = vol * logH * 0.22;
        const restY = this.baseY - surfaceRise;

        // --- Clear ---
        ctx.clearRect(0, 0, logW, logH);

        // --- Scan-line glass texture overlay ---
        this.drawScanLines();

        // --- Build surface path ---
        ctx.beginPath();
        ctx.moveTo(0, restY + heights[0]);

        for (let i = 0; i < n - 1; i++) {
            const x0 = i * step;
            const y0 = restY + heights[i];
            const x1 = (i + 1) * step;
            const y1 = restY + heights[i + 1];
            const mx = (x0 + x1) / 2;
            const my = (y0 + y1) / 2;
            ctx.quadraticCurveTo(x0, y0, mx, my);
        }

        // Last point
        ctx.lineTo(logW, restY + heights[n - 1]);
        ctx.lineTo(logW, logH + 4);
        ctx.lineTo(0, logH + 4);
        ctx.closePath();

        // --- Fluid fill gradient (mercury/silver) ---
        // colorPhase still shifts but within a narrow gray luminance range
        const lumShift = Math.sin(this.colorPhase * 0.05) * 8;
        const topLum = Math.round(255 + lumShift);      // ~247-255
        const midLum = Math.round(161 + lumShift * 0.6);  // ~156-166  (#a1a1a1 base)
        const darkLum = Math.round(64 + lumShift * 0.3);  // ~61-66   (#404040 base)
        const grd = ctx.createLinearGradient(0, restY - 20, 0, logH);
        grd.addColorStop(0.00, `rgba(${topLum}, ${topLum}, ${topLum}, 0.55)`);   // white waterline
        grd.addColorStop(0.05, `rgba(${topLum}, ${topLum}, ${topLum}, 0.80)`);   // bright surface
        grd.addColorStop(0.30, `rgba(${midLum}, ${midLum}, ${midLum}, 0.90)`);   // mid silver
        grd.addColorStop(0.65, `rgba(${darkLum}, ${darkLum}, ${darkLum}, 0.97)`);// dark gray
        grd.addColorStop(1.00, `rgba(0, 0, 0, 1.00)`);                           // black depth

        ctx.fillStyle = grd;
        ctx.fill();

        // --- Waterline glow stroke ---
        ctx.save();

        // Glow layer 1: wide soft glow
        ctx.beginPath();
        ctx.moveTo(0, restY + heights[0]);
        for (let i = 0; i < n - 1; i++) {
            const x0 = i * step;
            const y0 = restY + heights[i];
            const x1 = (i + 1) * step;
            const y1 = restY + heights[i + 1];
            const mx = (x0 + x1) / 2;
            const my = (y0 + y1) / 2;
            ctx.quadraticCurveTo(x0, y0, mx, my);
        }
        ctx.lineTo(logW, restY + heights[n - 1]);
        ctx.strokeStyle = `rgba(255, 255, 255, 0.18)`;
        ctx.lineWidth = 10;
        ctx.shadowColor = `rgba(255, 255, 255, 0.6)`;
        ctx.shadowBlur = 18;
        ctx.stroke();

        // Glow layer 2: sharp bright line (white/silver)
        ctx.beginPath();
        ctx.moveTo(0, restY + heights[0]);
        for (let i = 0; i < n - 1; i++) {
            const x0 = i * step;
            const y0 = restY + heights[i];
            const x1 = (i + 1) * step;
            const y1 = restY + heights[i + 1];
            const mx = (x0 + x1) / 2;
            const my = (y0 + y1) / 2;
            ctx.quadraticCurveTo(x0, y0, mx, my);
        }
        ctx.lineTo(logW, restY + heights[n - 1]);
        ctx.strokeStyle = `rgba(255, 255, 255, 0.85)`;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 8;
        ctx.stroke();

        ctx.restore();

        // --- Chromatic aberration at edges ---
        this.drawChromaticEdges(heights, restY, step, n);

        // --- Sub-surface caustic shimmer ---
        this.drawCaustics(t, restY, logW, logH, vol);
    }

    drawScanLines() {
        const { ctx, logW, logH } = this;
        ctx.save();
        const lineSpacing = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.018)';
        ctx.lineWidth = 0.5;
        for (let y = 0; y < logH; y += lineSpacing) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(logW, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    drawChromaticEdges(heights, restY, step, n) {
        const { ctx, logW, logH } = this;
        const edgeW = 60;

        // LEFT edge — red channel offset
        ctx.save();
        const clipL = new Path2D();
        clipL.rect(0, 0, edgeW, logH);
        ctx.clip(clipL);

        const buildPath = (offset) => {
            ctx.beginPath();
            ctx.moveTo(0, restY + heights[0] + offset);
            for (let i = 0; i < n - 1; i++) {
                const x0 = i * step; const y0 = restY + heights[i] + offset;
                const x1 = (i + 1) * step; const y1 = restY + heights[i + 1] + offset;
                ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            }
            ctx.lineTo(logW, restY + heights[n - 1] + offset);
            ctx.lineTo(logW, logH + 4); ctx.lineTo(0, logH + 4); ctx.closePath();
        };

        buildPath(-2.5);
        ctx.fillStyle = 'rgba(200, 190, 180, 0.06)';  // subtle warm gray
        ctx.fill();

        buildPath(2.5);
        ctx.fillStyle = 'rgba(180, 190, 200, 0.06)';  // subtle cool gray
        ctx.fill();
        ctx.restore();

        // RIGHT edge
        ctx.save();
        const clipR = new Path2D();
        clipR.rect(logW - edgeW, 0, edgeW, logH);
        ctx.clip(clipR);

        buildPath(-2.5);
        ctx.fillStyle = 'rgba(180, 190, 200, 0.06)';  // subtle cool gray
        ctx.fill();
        buildPath(2.5);
        ctx.fillStyle = 'rgba(200, 190, 180, 0.06)';  // subtle warm gray
        ctx.fill();
        ctx.restore();
    }

    drawCaustics(t, restY, logW, logH, volume) {
        const { ctx } = this;
        if (volume < 0.015) return;  // only visible when there's audio activity

        ctx.save();
        const numCaustics = 6;
        const causticsY = restY + (logH - restY) * 0.35;
        const alpha = Math.min(volume * 2.5, 0.18);

        for (let i = 0; i < numCaustics; i++) {
            const x = (logW * (i + 0.5) / numCaustics) +
                Math.sin(t * 1.8 + i * 1.3) * 20;
            const y = causticsY + Math.cos(t * 2.2 + i * 0.9) * 14;
            const r = 18 + Math.sin(t * 3 + i) * 8;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, `rgba(200, 200, 200, ${alpha})`);
            g.addColorStop(1, 'rgba(200, 200, 200, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

// ============================================================
// 4. AUDIO ENGINE — Web Audio API
// ============================================================
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.micAnalyser = null;
        this.astAnalyser = null;
        this.micBuf = null;
        this.astBuf = null;
        this.micFreqBuf = null;
        this.astFreqBuf = null;
        this.micStream = null;

        // Smoothed values (Lerp targets)
        this.micVolume = 0;
        this.micPitch = 0;
        this.astVolume = 0;
        this.astPitch = 0;
        this.astBass = 0;

        this.ready = false;
        this.micActive = false;
        this.astActive = false;
    }

    async initContext() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') await this.ctx.resume();
    }

    async initMic() {
        await this.initContext();
        if (this.micActive) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.micStream = stream;
            const src = this.ctx.createMediaStreamSource(stream);

            this.micAnalyser = this.ctx.createAnalyser();
            this.micAnalyser.fftSize = 2048;
            this.micAnalyser.smoothingTimeConstant = 0.8;
            src.connect(this.micAnalyser);

            this.micBuf = new Float32Array(this.micAnalyser.fftSize);
            this.micFreqBuf = new Float32Array(this.micAnalyser.frequencyBinCount);
            this.micActive = true;
        } catch (err) {
            console.warn('Microphone access denied:', err.message);
            throw err;
        }
    }

    connectAssistantAudio(audioEl) {
        if (this.astActive || !this.ctx) return;
        try {
            const src = this.ctx.createMediaElementSource(audioEl);
            this.astAnalyser = this.ctx.createAnalyser();
            this.astAnalyser.fftSize = 2048;
            this.astAnalyser.smoothingTimeConstant = 0.75;
            src.connect(this.astAnalyser);
            this.astAnalyser.connect(this.ctx.destination);  // still play audio

            this.astBuf = new Float32Array(this.astAnalyser.fftSize);
            this.astFreqBuf = new Float32Array(this.astAnalyser.frequencyBinCount);
            this.astActive = true;
        } catch (e) {
            console.warn('Could not connect assistant audio:', e.message);
        }
    }

    stopMic() {
        if (this.micStream) {
            this.micStream.getTracks().forEach(t => t.stop());
            this.micStream = null;
        }
        this.micActive = false;
    }

    /**
     * Lerp-smooth a value towards a target.
     */
    lerp(current, target, alpha) {
        return current + (target - current) * alpha;
    }

    /**
     * Compute RMS volume from time-domain buffer.
     */
    getRMS(buf) {
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        return Math.sqrt(sum / buf.length);
    }

    /**
     * Find dominant frequency bin in FFT buffer.
     * Returns Hz value of the peak.
     */
    getDominantHz(freqBuf, analyser) {
        if (!analyser) return 0;
        let maxVal = -Infinity, maxIdx = 0;
        // Focus on 80 Hz – 4 kHz (voice range)
        const binHz = this.ctx.sampleRate / (analyser.fftSize);
        const minBin = Math.floor(80 / binHz);
        const maxBin = Math.ceil(4000 / binHz);
        for (let i = minBin; i <= Math.min(maxBin, freqBuf.length - 1); i++) {
            if (freqBuf[i] > maxVal) { maxVal = freqBuf[i]; maxIdx = i; }
        }
        return maxIdx * binHz;
    }

    /**
     * Compute bass energy (sum of 20–250 Hz bins).
     */
    getBassEnergy(freqBuf, analyser) {
        if (!analyser) return 0;
        const binHz = this.ctx.sampleRate / analyser.fftSize;
        const lo = Math.floor(20 / binHz);
        const hi = Math.ceil(250 / binHz);
        let sum = 0;
        for (let i = lo; i <= Math.min(hi, freqBuf.length - 1); i++) {
            const linear = Math.pow(10, freqBuf[i] / 20);  // dB → linear
            sum += linear;
        }
        return Math.min(sum / (hi - lo + 1) / 3, 1);
    }

    /**
     * Compute high-frequency energy (3kHz–10kHz) — sibilance / treble.
     * Used for Phase 2.2 sharp spike injection.
     */
    getHighFreqEnergy(freqBuf, analyser) {
        if (!analyser) return 0;
        const binHz = this.ctx.sampleRate / analyser.fftSize;
        const lo = Math.floor(3000 / binHz);
        const hi = Math.ceil(10000 / binHz);
        let sum = 0;
        for (let i = lo; i <= Math.min(hi, freqBuf.length - 1); i++) {
            const linear = Math.pow(10, freqBuf[i] / 20);
            sum += linear;
        }
        return Math.min(sum / (hi - lo + 1) / 2.5, 1);
    }

    /**
     * Read & smooth all audio data. Call once per frame.
     * Phase 1: SENSITIVITY_MULTIPLIER is applied to raw RMS before Lerp.
     * Phase 1: NOISE_GATE filters out background static after gain.
     */
    tick() {
        const a = CFG.LERP_ALPHA;
        const mul = CFG.SENSITIVITY_MULTIPLIER;

        // ---- Microphone ----
        if (this.micActive && this.micAnalyser) {
            this.micAnalyser.getFloatTimeDomainData(this.micBuf);
            this.micAnalyser.getFloatFrequencyData(this.micFreqBuf);

            // Phase 1.1: Apply global gain multiplier to RMS
            const amplifiedVol = this.getRMS(this.micBuf) * mul;
            // Phase 1.2: Noise gate — zero-out if below gate threshold
            const gatedVol = amplifiedVol > CFG.NOISE_GATE ? amplifiedVol : 0;
            const rawPitch = this.getDominantHz(this.micFreqBuf, this.micAnalyser);
            const rawBass = this.getBassEnergy(this.micFreqBuf, this.micAnalyser);
            const rawHF = this.getHighFreqEnergy(this.micFreqBuf, this.micAnalyser);

            this.micVolume = this.lerp(this.micVolume, gatedVol, a);
            this.micPitch = this.lerp(this.micPitch, rawPitch, a * 0.5);
            this.micBass = this.lerp(this.micBass || 0, rawBass, a * 0.7);
            this.micHF = this.lerp(this.micHF || 0, rawHF, a * 0.8);
        } else {
            this.micVolume = this.lerp(this.micVolume, 0, a);
            this.micPitch = this.lerp(this.micPitch, 0, a);
            this.micBass = this.lerp(this.micBass || 0, 0, a);
            this.micHF = this.lerp(this.micHF || 0, 0, a);
        }

        // ---- Assistant ----
        if (this.astActive && this.astAnalyser) {
            this.astAnalyser.getFloatTimeDomainData(this.astBuf);
            this.astAnalyser.getFloatFrequencyData(this.astFreqBuf);

            const amplifiedVol = this.getRMS(this.astBuf) * mul;
            const gatedVol = amplifiedVol > CFG.NOISE_GATE ? amplifiedVol : 0;
            const rawPitch = this.getDominantHz(this.astFreqBuf, this.astAnalyser);
            const rawBass = this.getBassEnergy(this.astFreqBuf, this.astAnalyser);
            const rawHF = this.getHighFreqEnergy(this.astFreqBuf, this.astAnalyser);

            this.astVolume = this.lerp(this.astVolume, gatedVol, a);
            this.astPitch = this.lerp(this.astPitch, rawPitch, a * 0.5);
            this.astBass = this.lerp(this.astBass, rawBass, a * 0.7);
            this.astHF = this.lerp(this.astHF || 0, rawHF, a * 0.8);
        } else {
            this.astVolume = this.lerp(this.astVolume, 0, a * 0.5);
            this.astBass = this.lerp(this.astBass, 0, a * 0.3);
            this.astHF = this.lerp(this.astHF || 0, 0, a * 0.4);
        }
    }
}

// ============================================================
// 5. VOICE UI — State machine + render loop
// ============================================================
const STATE = { IDLE: 'idle', LISTENING: 'listening', SPEAKING: 'speaking' };

class VoiceUI {
    constructor() {
        // DOM refs
        this.canvas = document.getElementById('fluid-canvas');
        this.micBtn = document.getElementById('mic-btn');
        this.micIcon = document.getElementById('mic-icon');
        this.micOffIcon = document.getElementById('mic-off-icon');
        this.statusLabel = document.getElementById('status-label');
        this.statusDot = document.getElementById('status-indicator');
        this.hintText = document.getElementById('hint-text');
        this.freqVal = document.getElementById('freq-val');
        this.volVal = document.getElementById('vol-val');
        this.readoutPanel = document.getElementById('readout-panel');
        this.assistantAudio = document.getElementById('assistant-audio');

        // Sub-systems
        this.surface = new WaterSurface(CFG.NUM_POINTS);
        this.renderer = new FluidRenderer(this.canvas);
        this.audio = new AudioEngine();

        // State
        this.state = STATE.IDLE;
        this.t = 0;
        this.lastTime = null;
        this.rafId = null;

        // Framerate throttle
        this.frameInterval = 1000 / CFG.TARGET_FPS;
        this.lastFrameTime = 0;

        this._bindEvents();
        this._setState(STATE.IDLE);
        this._startLoop();
    }

    // ---- Event bindings ----
    _bindEvents() {
        // Mic button toggle
        this.micBtn.addEventListener('click', async () => {
            if (this.state === STATE.IDLE) {
                await this._startListening();
            } else {
                this._stopListening();
            }
        });

        // Resize handler
        window.addEventListener('resize', () => {
            this.renderer.resize();
        });

        // Assistant audio events
        this.assistantAudio.addEventListener('play', () => {
            if (this.state === STATE.LISTENING) {
                this._setState(STATE.SPEAKING);
            }
        });
        this.assistantAudio.addEventListener('ended', () => {
            if (this.state === STATE.SPEAKING) {
                this._setState(STATE.LISTENING);
            }
        });
    }

    // ---- State transitions ----
    async _startListening() {
        try {
            await this.audio.initMic();
            // Connect assistant audio on first interaction
            if (!this.audio.astActive) {
                this.audio.connectAssistantAudio(this.assistantAudio);
            }
            this._setState(STATE.LISTENING);
        } catch (err) {
            this.hintText.textContent = 'Microphone access denied. Please allow mic in browser settings.';
            setTimeout(() => {
                this.hintText.textContent = 'Click the mic to start listening';
            }, 4000);
        }
    }

    _stopListening() {
        this.audio.stopMic();
        this._setState(STATE.IDLE);
    }

    _setState(newState) {
        this.state = newState;

        // Update CSS body class
        document.body.classList.remove('state-idle', 'state-listening', 'state-speaking');
        document.body.classList.add(`state-${newState}`);

        // Update indicator dot & label
        this.statusDot.className = `status-indicator ${newState}`;
        this.statusLabel.className = `status-label ${newState}`;
        this.statusLabel.textContent = newState.toUpperCase();

        // Mic button visual
        this.micBtn.className = `mic-btn ${newState}`;
        const isListeningOrSpeaking = newState !== STATE.IDLE;
        this.micIcon.style.display = isListeningOrSpeaking ? 'none' : 'block';
        this.micOffIcon.style.display = isListeningOrSpeaking ? 'none' : 'none';

        // Show muted icon only in idle if was previously active
        if (newState === STATE.IDLE) {
            this.micIcon.style.display = 'block';
            this.micOffIcon.style.display = 'none';
        }

        // Hint text
        const hints = {
            [STATE.IDLE]: 'Click the mic to start listening',
            [STATE.LISTENING]: 'Listening… speak naturally',
            [STATE.SPEAKING]: 'Assistant is responding…',
        };
        this.hintText.textContent = hints[newState];

        // GSAP transition on label (if GSAP is loaded)
        if (window.gsap) {
            gsap.fromTo(this.statusLabel,
                { opacity: 0, y: -6 },
                { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }
            );
            gsap.fromTo(this.hintText,
                { opacity: 0 },
                { opacity: 1, duration: 0.5, delay: 0.1, ease: 'power1.out' }
            );
        }

        // Readout panel
        if (newState === STATE.IDLE) {
            this.readoutPanel.classList.remove('active');
            this.freqVal.textContent = '—';
            this.volVal.textContent = '—';
        } else {
            this.readoutPanel.classList.add('active');
        }
    }

    // ---- Physics update ----
    _updatePhysics(dt) {
        const { surface, audio, state } = this;

        // Always run physics tick
        surface.update();

        switch (state) {
            case STATE.IDLE:
                surface.applyIdleWave(this.t);
                break;

            case STATE.LISTENING: {
                // Gentle idle base
                surface.applyIdleWave(this.t, CFG.IDLE_AMP * 0.5);

                const vol = audio.micVolume;
                const pitch = audio.micPitch;
                const bass = audio.micBass || 0;
                const hf = audio.micHF || 0;

                // Phase 1.2: Noise gate — only react if above threshold
                if (vol > CFG.NOISE_GATE) {

                    // ── Phase 2.1: Bass cone-push (plosive / subwoofer) ──────────────
                    // Wide unified upward lift from the center, like a speaker cone
                    if (bass > CFG.BASS_THRESHOLD) {
                        const bassForce = bass * CFG.BASS_FORCE_SCALE * vol;
                        surface.conePush(bassForce, CFG.BASS_CONE_WIDTH);
                    }

                    // ── Phase 2.2: High-frequency narrow spikes (sibilance) ──────────
                    if (hf > CFG.HF_THRESHOLD) {
                        const numSpikes = 1 + (Math.random() < hf * 0.8 ? 1 : 0);
                        for (let s = 0; s < numSpikes; s++) {
                            // Near-center with small random offset
                            const center = CFG.NUM_POINTS / 2;
                            const pos = (center + (Math.random() - 0.5) * CFG.NUM_POINTS * 0.4) | 0;
                            surface.splash(pos, -(hf * CFG.HF_FORCE_SCALE), CFG.HF_SPLASH_WIDTH);
                        }
                    }

                    // ── Standard mic impulse (mid-range speech body) ──────────────────
                    const prob = CFG.MIC_IMPULSE_RATE * (1 + vol * 8);
                    if (Math.random() < prob) {
                        const pos = Math.random() * CFG.NUM_POINTS | 0;
                        const force = vol * CFG.MIC_FORCE_SCALE * (0.5 + Math.random() * 0.5);
                        const pitchN = Math.min(pitch / 1200, 1);
                        const width = CFG.MIC_SPLASH_WIDTH * (1 - pitchN * 0.6);
                        surface.splash(pos, -force, width | 0);
                    }
                }
                break;
            }

            case STATE.SPEAKING: {
                // Stronger idle ripple during speech
                surface.applyIdleWave(this.t, CFG.IDLE_AMP * 1.4);

                const vol = audio.astVolume;
                const pitch = audio.astPitch;
                const bass = audio.astBass;
                const hf = audio.astHF || 0;

                // Phase 1.2: Noise gate
                if (vol > CFG.NOISE_GATE * 0.5) {

                    // ── Phase 2.1: Bass speaker-cone push (assistant) ────────────────
                    if (bass > CFG.BASS_THRESHOLD * 0.8) {
                        const bassForce = bass * CFG.BASS_FORCE_SCALE * 1.4 * vol;
                        surface.conePush(bassForce, CFG.BASS_CONE_WIDTH);
                    }

                    // ── Phase 2.2: Treble sibilance spikes (assistant) ───────────────
                    if (hf > CFG.HF_THRESHOLD) {
                        const numSpikes = 1 + (Math.random() < hf ? 1 : 0);
                        for (let s = 0; s < numSpikes; s++) {
                            const center = CFG.NUM_POINTS / 2;
                            const pos = (center + (Math.random() - 0.5) * CFG.NUM_POINTS * 0.35) | 0;
                            surface.splash(pos, -(hf * CFG.HF_FORCE_SCALE * 1.3), CFG.HF_SPLASH_WIDTH);
                        }
                    }

                    // ── Central diffusing waves (assistant general energy) ────────────
                    const prob = CFG.AST_IMPULSE_RATE * (1 + vol * 6) * (1 + bass * 2);
                    if (Math.random() < prob) {
                        const center = CFG.NUM_POINTS / 2;
                        const offset = (Math.random() - 0.5) * CFG.NUM_POINTS * 0.18;
                        const pos = (center + offset) | 0;
                        const force = vol * CFG.AST_FORCE_SCALE * (0.6 + Math.random() * 0.4);
                        const pitchN = Math.min(pitch / 1200, 1);
                        const width = CFG.AST_SPLASH_WIDTH * (1 - pitchN * 0.5);
                        surface.splash(pos, -force, width | 0);
                    }
                }
                break;
            }
        }
    }

    // ---- Audio readout update ----
    _updateReadout() {
        const { audio, state } = this;
        if (state === STATE.IDLE) return;

        const isListening = state === STATE.LISTENING;
        const vol = isListening ? audio.micVolume : audio.astVolume;
        const pitch = isListening ? audio.micPitch : audio.astPitch;

        const dB = vol > 0 ? Math.round(20 * Math.log10(vol)) : -80;
        this.volVal.textContent = dB > -80 ? `${dB}` : '—';
        this.freqVal.textContent = pitch > 50 ? `${Math.round(pitch)}` : '—';
    }

    // ---- Main render loop ----
    _startLoop() {
        const loop = (timestamp) => {
            this.rafId = requestAnimationFrame(loop);

            // Throttle
            const elapsed = timestamp - this.lastFrameTime;
            if (elapsed < this.frameInterval - 1) return;
            this.lastFrameTime = timestamp - (elapsed % this.frameInterval);

            // Delta time
            if (!this.lastTime) this.lastTime = timestamp;
            const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
            this.lastTime = timestamp;
            this.t += dt;

            // Audio engine tick (lerp smoothing)
            this.audio.tick();

            // Physics
            this._updatePhysics(dt);

            // Readout
            this._updateReadout();

            // Render
            const audioState = {
                volume: this.state === STATE.SPEAKING ? this.audio.astVolume : this.audio.micVolume,
                pitch: this.state === STATE.SPEAKING ? this.audio.astPitch : this.audio.micPitch,
                bassEnergy: this.audio.astBass,
                state: this.state,
            };
            this.renderer.draw(this.surface.h, audioState, this.t);
        };

        this.rafId = requestAnimationFrame(loop);
    }
}

// ============================================================
// ENTRY POINT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
    const ui = new VoiceUI();

    // Expose globally for DevTools debugging / assistant integration
    window.__fluidUI = ui;

    /**
     * Public API for assistant integration:
     *
     * Load a URL into the assistant audio element and it will
     * automatically enter Speaking state:
     *
     *   window.__fluidUI.playAssistant('path/to/response.mp3');
     *
     * Or trigger a splash manually:
     *   window.__fluidUI.surface.splash(90, -30, 20);
     */
    ui.playAssistant = (src) => {
        ui.assistantAudio.src = src;
        ui.assistantAudio.play().catch(console.warn);
    };
});
