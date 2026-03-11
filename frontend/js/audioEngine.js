export class AudioEngine {
    constructor(apiServiceOrElement, apiService) {
        // Support both: new AudioEngine(api) and new AudioEngine(element, api)
        if (apiService && typeof apiService === 'object' && typeof apiService.generateTTS === 'function') {
            this.api = apiService;
        } else {
            this.api = apiServiceOrElement;
        }

        // Queue state
        this.queue = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.voice = "";
        this.rate = "";
        this.targetSpanToSeek = null;
        this.currentBoundaries = [];
        this.currentActiveSpanId = null;

        // Callbacks
        this.onPlaybackStart = null;
        this.onPlaybackEnd = null;
        this.onPlay = null;
        this.onPause = null;

        // M-10: JIT chunk activation callbacks
        this.onChunkActivate = null;
        this.onChunkDeactivate = null;
        this._lastActivatedChunkIndex = -1;

        // Web Audio API graph
        this.audioCtx = null;
        this.masterGain = null;
        this.analyser = null;

        // Current playback source
        this.currentSource = null;
        this.currentGain = null;
        this.currentBuffer = null;

        // Time tracking (AudioBufferSourceNode has no .currentTime)
        this.playStartContextTime = 0;
        this.playStartOffset = 0;
        this.pausedAt = 0;
        this.chunkDuration = 0;
        this._playingChunkIndex = 0;

        // Duration-based progress
        this.chunkDurations = [];

        // Crossfade between chunks (5ms overlap)
        this.CROSSFADE_TIME = 0.005;
        this.CROSSFADE_LOOKAHEAD = 0.1; // Prepare crossfade 100ms before chunk ends
        this._crossfadeTimer = null;
        this._crossfadeHandled = false;

        // Visualizer
        this.canvas = null;
        this.canvasCtx = null;
        this.bufferLength = 0;
        this.dataArray = null;
        this.visualizerAnimId = null;

        // Highlight overlay (single floating div)
        this.highlightOverlay = null;
        this.highlightAnimId = null;

        // Spring physics scroll (Damped Harmonic Oscillator)
        // Tuned for smooth, slightly underdamped scrolling that settles quickly
        this.springAnimId = null;
        this.springCurrentY = window.scrollY;
        this.springVelocity = 0;
        this.springTargetY = window.scrollY;
        this.lastSpringTime = 0;
        this.SPRING_STIFFNESS = 120;  // Spring force — higher = snappier response
        this.SPRING_DAMPING = 20;     // Friction — higher = less oscillation
        this.SPRING_MASS = 1;         // Inertia — higher = more sluggish
        this.SPRING_EPSILON = 0.5;    // Stop threshold (px and px/s)

        // User scroll detection
        this.isUserScrolling = false;
        this.scrollTimeout = null;

        const handleUserScroll = () => {
            this.isUserScrolling = true;
            if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => {
                this.isUserScrolling = false;
                this.springCurrentY = window.scrollY;
                this.springVelocity = 0;
            }, 3000);
        };
        window.addEventListener('wheel', handleUserScroll, {passive: true});
        window.addEventListener('touchmove', handleUserScroll, {passive: true});

        // IndexedDB cache
        this.db = null;
        this.initDB();
    }

    // =========================================================================
    // Audio Context & Graph
    // =========================================================================

    _initAudioContext() {
        if (this.audioCtx) return;
        const Ctx = window.AudioContext || window['webkitAudioContext'];
        this.audioCtx = new Ctx();

        // AudioBufferSourceNode → GainNode (per-chunk) → masterGain → AnalyserNode → destination
        this.masterGain = this.audioCtx.createGain();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 128;
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);

        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
    }

    _ensureResumed() {
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    // =========================================================================
    // Time Tracking
    // =========================================================================

    _getCurrentTime() {
        if (!this.audioCtx || !this.isPlaying) return this.pausedAt;
        return this.audioCtx.currentTime - this.playStartContextTime + this.playStartOffset;
    }

    _getCurrentTimeMs() {
        return this._getCurrentTime() * 1000;
    }

    // =========================================================================
    // IndexedDB Cache
    // =========================================================================

    initDB() {
        const request = indexedDB.open("AudioCacheDB", 1);
        request.onupgradeneeded = (e) => {
            this.db = e.target.result;
            if (!this.db.objectStoreNames.contains("audio_blobs")) {
                this.db.createObjectStore("audio_blobs");
            }
        };
        request.onsuccess = (e) => {
            this.db = e.target.result;
        };
    }

    async getFromDB(key) {
        if (!this.db) return null;
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction("audio_blobs", "readonly");
                const store = tx.objectStore("audio_blobs");
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    }

    async saveToDB(key, blob) {
        if (!this.db) return;
        try {
            const tx = this.db.transaction("audio_blobs", "readwrite");
            const store = tx.objectStore("audio_blobs");
            store.put(blob, key);
        } catch (e) { /* best-effort cache */ }
    }

    // =========================================================================
    // Visualizer (AnalyserNode + Canvas) — stops rAF when not playing
    // =========================================================================

    setupVisualizer(canvasElement) {
        this.canvas = canvasElement;
        this.canvasCtx = this.canvas.getContext('2d');
    }

    _startVisualizer() {
        if (!this.canvas || this.visualizerAnimId) return;
        this._drawVisualizer();
    }

    _stopVisualizer() {
        if (this.visualizerAnimId) {
            cancelAnimationFrame(this.visualizerAnimId);
            this.visualizerAnimId = null;
        }
    }

    _drawVisualizer() {
        if (!this.isPlaying) {
            this.visualizerAnimId = null;
            return;
        }
        this.visualizerAnimId = requestAnimationFrame(() => this._drawVisualizer());
        if (!this.analyser || !this.dataArray) return;

        this.analyser.getByteFrequencyData(this.dataArray);
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const barWidth = (this.canvas.width / this.bufferLength) * 2.5;
        let x = 0;
        for (let i = 0; i < this.bufferLength; i++) {
            const barHeight = this.dataArray[i] / 2;
            this.canvasCtx.fillStyle = `rgba(193, 95, 60, ${barHeight / 100})`;
            this.canvasCtx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }

    // =========================================================================
    // Highlight Overlay — single floating <div> with GPU-accelerated transforms
    // =========================================================================

    setupHighlightOverlay(overlayElement) {
        this.highlightOverlay = overlayElement;
        this._applyOverlayStyles();
    }

    _createHighlightOverlay() {
        if (this.highlightOverlay) return;
        this.highlightOverlay = document.createElement('div');
        this.highlightOverlay.id = 'audio-highlight-overlay';
        document.body.appendChild(this.highlightOverlay);
        this._applyOverlayStyles();
    }

    _applyOverlayStyles() {
        if (!this.highlightOverlay) return;
        Object.assign(this.highlightOverlay.style, {
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: '5',
            borderRadius: '0.375rem',
            backgroundColor: 'rgba(193, 95, 60, 0.25)',
            boxShadow: '0 0 24px rgba(193, 95, 60, 0.5), 0 0 12px rgba(193, 95, 60, 0.35)',
            opacity: '0',
            willChange: 'transform, width, height, opacity',
            transition: 'opacity 0.15s ease-out',
            transform: 'translate3d(0, 0, 0)',
            top: '0',
            left: '0'
        });
    }

    _updateOverlayPosition(el) {
        if (!this.highlightOverlay || !el) return;
        const rect = el.getBoundingClientRect();
        const pad = 4;
        this.highlightOverlay.style.opacity = '1';
        this.highlightOverlay.style.width = `${rect.width + pad * 2}px`;
        this.highlightOverlay.style.height = `${rect.height + pad}px`;
        this.highlightOverlay.style.transform =
            `translate3d(${rect.left - pad}px, ${rect.top - pad / 2}px, 0)`;
    }

    _hideOverlay() {
        if (this.highlightOverlay) {
            this.highlightOverlay.style.opacity = '0';
        }
    }

    // =========================================================================
    // Highlight Engine — word sync via rAF, stopped immediately on pause
    // =========================================================================

    _startHighlightEngine() {
        this._createHighlightOverlay();
        if (this.highlightAnimId) return;

        const sync = () => {
            if (!this.isPlaying) {
                this.highlightAnimId = null;
                return;
            }

            const timeMs = this._getCurrentTimeMs();
            const active = this.currentBoundaries.find(
                b => timeMs >= b.startMs && timeMs <= b.endMs
            );

            if (active && active.spanId !== this.currentActiveSpanId) {
                // Clear previous span
                if (this.currentActiveSpanId) {
                    const old = document.getElementById(this.currentActiveSpanId);
                    if (old) old.className = old.getAttribute('data-original-class');
                }

                const el = document.getElementById(active.spanId);
                if (el) {
                    el.className = "word-glow transition-all duration-200 ease-out inline-block";
                    this._updateOverlayPosition(el);

                    // Update spring scroll target
                    if (!this.isUserScrolling) {
                        const rect = el.getBoundingClientRect();
                        this.springTargetY =
                            rect.top + window.scrollY - window.innerHeight / 2 + rect.height / 2;
                    }
                }
                this.currentActiveSpanId = active.spanId;
            } else if (active && this.currentActiveSpanId) {
                // Same word — keep overlay position in sync with scroll
                const el = document.getElementById(this.currentActiveSpanId);
                if (el) this._updateOverlayPosition(el);
            }

            this.highlightAnimId = requestAnimationFrame(sync);
        };
        this.highlightAnimId = requestAnimationFrame(sync);
    }

    _stopHighlightEngine() {
        if (this.highlightAnimId) {
            cancelAnimationFrame(this.highlightAnimId);
            this.highlightAnimId = null;
        }
    }

    _resetHighlighting() {
        this._stopHighlightEngine();
        if (this.currentActiveSpanId) {
            const el = document.getElementById(this.currentActiveSpanId);
            if (el) el.className = el.getAttribute('data-original-class');
        }
        this.currentActiveSpanId = null;
        this._hideOverlay();
    }

    // =========================================================================
    // Spring Physics Scroll — Damped Harmonic Oscillator
    // =========================================================================

    _startSpringScroll() {
        if (this.springAnimId) return;
        this.springCurrentY = window.scrollY;
        this.springVelocity = 0;
        this.lastSpringTime = performance.now();

        const tick = (now) => {
            if (!this.isPlaying) {
                this.springAnimId = null;
                return;
            }

            // Cap dt to prevent physics explosion when tab regains focus after background
            const dt = Math.min((now - this.lastSpringTime) / 1000, 0.05);
            this.lastSpringTime = now;

            if (!this.isUserScrolling) {
                const force = this.SPRING_STIFFNESS * (this.springTargetY - this.springCurrentY);
                const damping = -this.SPRING_DAMPING * this.springVelocity;
                const accel = (force + damping) / this.SPRING_MASS;
                this.springVelocity += accel * dt;
                this.springCurrentY += this.springVelocity * dt;

                if (Math.abs(this.springTargetY - this.springCurrentY) > this.SPRING_EPSILON ||
                    Math.abs(this.springVelocity) > this.SPRING_EPSILON) {
                    window.scrollTo(0, Math.max(0, this.springCurrentY));
                }
            } else {
                // User scrolling — track position without fighting
                this.springCurrentY = window.scrollY;
            }

            this.springAnimId = requestAnimationFrame(tick);
        };
        this.springAnimId = requestAnimationFrame(tick);
    }

    _stopSpringScroll() {
        if (this.springAnimId) {
            cancelAnimationFrame(this.springAnimId);
            this.springAnimId = null;
        }
    }

    // =========================================================================
    // Word Boundary Alignment
    // =========================================================================

    // M-08: DTW-based word boundary alignment (replaces linear search)
    alignBoundariesToMemoryMap(apiB, words, spanIds) {
        const clean = (t) => t.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '').toLowerCase();

        // Filter valid API boundaries
        const apiWords = [];
        for (const b of apiB) {
            const t = clean(b['text'] || "");
            if (t) apiWords.push({text: t, offset: b['offset'], duration: b['duration']});
        }

        const cleanDomWords = words.map(w => clean(w));
        const n = apiWords.length;
        const m = words.length;
        if (n === 0 || m === 0) return [];

        // Levenshtein distance (normalized 0-1)
        const levenshtein = (a, b) => {
            if (a === b) return 0;
            if (!a.length) return 1;
            if (!b.length) return 1;
            const matrix = [];
            for (let i = 0; i <= a.length; i++) matrix[i] = [i];
            for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
            for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j - 1] + cost
                    );
                }
            }
            return matrix[a.length][b.length] / Math.max(a.length, b.length);
        };

        // Substring containment bonus — handles TTS merging like "والكتاب"
        const matchCost = (apiText, domText) => {
            if (apiText === domText) return 0;
            if (apiText.includes(domText) || domText.includes(apiText)) return 0.1;
            return levenshtein(apiText, domText);
        };

        // DTW cost matrix
        // DTW cost matrix (bounded by chunk size — max ~80 words per chunk from M-09)
        const SKIP_COST = 0.6;
        const dtw = Array.from({length: n + 1}, () => new Float64Array(m + 1).fill(Infinity));
        const path = Array.from({length: n + 1}, () => new Int8Array(m + 1));
        dtw[0][0] = 0;

        // Allow skipping initial DOM words (API might not cover leading text)
        for (let j = 1; j <= m; j++) {
            dtw[0][j] = j * SKIP_COST;
            path[0][j] = 2; // skip DOM word
        }
        for (let i = 1; i <= n; i++) {
            dtw[i][0] = i * SKIP_COST;
            path[i][0] = 1; // skip API word
        }

        for (let i = 1; i <= n; i++) {
            for (let j = 1; j <= m; j++) {
                const cost = matchCost(apiWords[i - 1].text, cleanDomWords[j - 1]);
                const match = dtw[i - 1][j - 1] + cost;
                const skipApi = dtw[i - 1][j] + SKIP_COST;
                const skipDom = dtw[i][j - 1] + SKIP_COST;

                if (match <= skipApi && match <= skipDom) {
                    dtw[i][j] = match;
                    path[i][j] = 0; // match
                } else if (skipApi <= skipDom) {
                    dtw[i][j] = skipApi;
                    path[i][j] = 1; // skip API
                } else {
                    dtw[i][j] = skipDom;
                    path[i][j] = 2; // skip DOM
                }
            }
        }

        // Backtrack to find alignment
        const alignments = [];
        let i = n, j = m;
        while (i > 0 && j > 0) {
            if (path[i][j] === 0) {
                alignments.push({apiIdx: i - 1, domIdx: j - 1});
                i--;
                j--;
            } else if (path[i][j] === 1) {
                i--;
            } else {
                j--;
            }
        }
        alignments.reverse();

        // Build boundaries from alignments (threshold: reject very poor matches)
        const THRESHOLD = 0.7;
        const res = [];
        for (const {apiIdx, domIdx} of alignments) {
            const cost = matchCost(apiWords[apiIdx].text, cleanDomWords[domIdx]);
            if (cost < THRESHOLD && spanIds[domIdx]) {
                res.push({
                    startMs: apiWords[apiIdx].offset / 10000,
                    endMs: (apiWords[apiIdx].offset + apiWords[apiIdx].duration) / 10000,
                    spanId: spanIds[domIdx]
                });
            }
        }
        return res;
    }

    generateAutomatedWeightedBoundaries(dur, words, spanIds) {
        let tw = 0;
        const ws = words.map(w => {
            let x = w.length * 10;
            const vowels = w.match(/[aeiouyيوا]/ig);
            if (vowels) x += (vowels.length * 15);
            if (/[.,!?؛،:]/.test(w)) x += 80;
            tw += x;
            return x;
        });
        let cur = 0;
        return ws.map((w, i) => {
            const d = (w / tw) * dur;
            const b = {startMs: cur, endMs: cur + d, spanId: spanIds[i]};
            cur += d;
            return b;
        });
    }

    // =========================================================================
    // Fetch, Decode & Preload
    // =========================================================================

    async fetchChunk(index, retries = 3) {
        if (index >= this.queue.length) return;
        const chunk = this.queue[index];
        if (chunk.cacheKey && chunk.audioReady && chunk.audioBuffer) return;
        if (chunk.fetchPromise) {
            await chunk.fetchPromise;
            return;
        }

        chunk.fetchPromise = (async () => {
            chunk.isFetching = true;
            for (let attempt = 1; attempt <= retries; attempt++) {
                let hasError = false;
                try {
                    // 1. Get TTS metadata (cache key + word boundaries)
                    if (!chunk.cacheKey) {
                        const data = await this.api.generateTTS({
                            text: chunk.text, voice: this.voice, rate: this.rate
                        });
                        chunk.cacheKey = data['cache_key'];
                        chunk.apiBoundaries = data['boundaries'];
                    }

                    if (!chunk.cacheKey || chunk.cacheKey === "ERROR") {
                        hasError = true;
                    } else {
                        // 2. Get audio blob (IndexedDB cache or API)
                        let audioBlob = await this.getFromDB(chunk.cacheKey);
                        if (!audioBlob) {
                            const audioRes = await fetch(
                                `${this.api.baseUrl}/audio/${chunk.cacheKey}`
                            );
                            if (!audioRes.ok) {
                                hasError = true;
                            } else {
                                audioBlob = await audioRes.blob();
                                await this.saveToDB(chunk.cacheKey, audioBlob);
                            }
                        }

                        // 3. Decode Blob → AudioBuffer
                        if (!hasError && audioBlob && !chunk.audioBuffer) {
                            const arrayBuffer = await audioBlob.arrayBuffer();
                            chunk.audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
                        }
                    }
                } catch (e) {
                    hasError = true;
                }

                if (hasError) {
                    if (attempt === retries) {
                        chunk.cacheKey = "ERROR";
                        chunk.isFetching = false;
                    } else {
                        await new Promise(r => setTimeout(r, 1000 * attempt));
                    }
                } else {
                    chunk.audioReady = true;
                    chunk.isFetching = false;
                    break;
                }
            }
        })();
        await chunk.fetchPromise;
    }

    async preloadBuffer() {
        const promises = [];
        for (let i = this.currentIndex; i < Math.min(this.currentIndex + 3, this.queue.length); i++) {
            promises.push(this.fetchChunk(i));
        }
        await Promise.all(promises);
    }

    // =========================================================================
    // Crossfade Management
    // =========================================================================

    _clearCrossfadeTimer() {
        if (this._crossfadeTimer) {
            clearTimeout(this._crossfadeTimer);
            this._crossfadeTimer = null;
        }
    }

    _scheduleCrossfade(remainingSeconds) {
        this._clearCrossfadeTimer();
        this._crossfadeHandled = false;

        const delay = Math.max(0, (remainingSeconds - this.CROSSFADE_LOOKAHEAD) * 1000);
        this._crossfadeTimer = setTimeout(() => {
            if (!this.isPlaying) return;
            const nextIdx = this.currentIndex;
            if (nextIdx >= this.queue.length) return;

            const nextChunk = this.queue[nextIdx];
            if (!nextChunk.audioReady || !nextChunk.audioBuffer) return;

            this._crossfadeHandled = true;
            this.playNextChunk();
        }, delay);
    }

    _stopCurrentSource() {
        if (this.currentSource) {
            this.currentSource.onended = null;
            try { this.currentSource.stop(); } catch (e) { /* already stopped */ }
            this.currentSource.disconnect();
            this.currentSource = null;
        }
        if (this.currentGain) {
            this.currentGain.disconnect();
            this.currentGain = null;
        }
    }

    _endPlayback(finished) {
        this.isPlaying = false;
        this._clearCrossfadeTimer();
        this._stopCurrentSource();
        this._resetHighlighting();
        this._stopVisualizer();
        this._stopSpringScroll();
        if (this.onPlaybackEnd) this.onPlaybackEnd();
        if (finished) {
            this.currentIndex = 0;
            this.currentBuffer = null;
            this.pausedAt = 0;
        }
    }

    // =========================================================================
    // Core Playback — Web Audio API (AudioBufferSourceNode)
    // =========================================================================

    async startQueue(chunks, voice, rate, startSpanId = null) {
        this._initAudioContext();
        this._ensureResumed();
        this.hardReset();

        this.queue = JSON.parse(JSON.stringify(chunks)).map(c => ({
            ...c,
            cacheKey: null,
            apiBoundaries: null,
            isFetching: false,
            fetchPromise: null,
            audioReady: false,
            audioBuffer: null
        }));

        this.voice = voice;
        this.rate = rate;
        this.isPlaying = true;
        this.chunkDurations = new Array(this.queue.length).fill(0);

        let startChunkIndex = 0;
        if (startSpanId) {
            for (let i = 0; i < this.queue.length; i++) {
                // M-10: spanIds may be null arrays initially; also check wordEntries
                const chunk = this.queue[i];
                const hasSpan = chunk.spanIds && chunk.spanIds.includes(startSpanId);
                const hasEntry = chunk.wordEntries && chunk.wordEntries.some(
                    e => e.elementId === startSpanId
                );
                if (hasSpan || hasEntry) {
                    startChunkIndex = i;
                    this.targetSpanToSeek = startSpanId;
                    break;
                }
            }
        }

        this.currentIndex = startChunkIndex;
        if (this.onPlaybackStart) this.onPlaybackStart();

        await this.fetchChunk(startChunkIndex);
        await this.playNextChunk();
        this.preloadBuffer().catch(() => {});
    }

    async jumpToSpan(spanId) {
        if (this.queue.length === 0) return;
        // M-10: Search spanIds and also wordEntries for the target
        let targetIdx = this.queue.findIndex(q => q.spanIds && q.spanIds.includes(spanId));
        if (targetIdx === -1) {
            // Try matching by element ID in wordEntries (for dual-word spans that always exist)
            targetIdx = this.queue.findIndex(q =>
                q.wordEntries && q.wordEntries.some(e => e.elementId === spanId)
            );
        }
        if (targetIdx === -1) return;

        // Fade out over 200ms for smooth transition
        if (this.currentSource && this.currentGain && this.audioCtx) {
            const now = this.audioCtx.currentTime;
            this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, now);
            this.currentGain.gain.linearRampToValueAtTime(0, now + 0.2);
            await new Promise(r => setTimeout(r, 200));
        }

        this._clearCrossfadeTimer();
        this._stopCurrentSource();
        this._resetHighlighting();

        this.currentIndex = targetIdx;
        this.targetSpanToSeek = spanId;
        this.isPlaying = true;

        if (this.onPlaybackStart) this.onPlaybackStart();
        await this.playNextChunk(true);
    }

    async seekToPercentage(percent) {
        if (this.queue.length === 0) return;

        // Calculate target chunk using actual durations when available
        let targetIndex = 0;
        const knownDurations = this.chunkDurations.filter(d => d > 0);
        if (knownDurations.length > 0) {
            const avgDuration =
                knownDurations.reduce((a, b) => a + b, 0) / knownDurations.length;
            const estimatedTotal = avgDuration * this.queue.length;
            const targetTime = percent * estimatedTotal;
            let cumulative = 0;
            for (let i = 0; i < this.queue.length; i++) {
                cumulative += this.chunkDurations[i] || avgDuration;
                if (cumulative >= targetTime) {
                    targetIndex = i;
                    break;
                }
            }
        } else {
            targetIndex = Math.floor(percent * this.queue.length);
        }
        targetIndex = Math.min(targetIndex, this.queue.length - 1);

        this._clearCrossfadeTimer();
        this._stopCurrentSource();
        this._resetHighlighting();
        this.currentIndex = targetIndex;
        this.targetSpanToSeek = null;
        this.isPlaying = true;

        if (this.onPlaybackStart) this.onPlaybackStart();
        await this.playNextChunk();
    }

    getGlobalProgress() {
        if (this.queue.length === 0) return 0;

        // Use actual AudioBuffer durations for accurate progress
        const knownDurations = this.chunkDurations.filter(d => d > 0);
        if (knownDurations.length > 0) {
            const avgDuration =
                knownDurations.reduce((a, b) => a + b, 0) / knownDurations.length;
            const estimatedTotal = avgDuration * this.queue.length;

            let elapsed = 0;
            for (let i = 0; i < this._playingChunkIndex; i++) {
                elapsed += this.chunkDurations[i] || avgDuration;
            }
            elapsed += Math.max(0, this._getCurrentTime());

            return Math.min(1, Math.max(0, elapsed / estimatedTotal));
        }

        // Fallback: chunk-index based
        return Math.min(1, this._playingChunkIndex / Math.max(1, this.queue.length));
    }

    async playNextChunk(fadeIn = false) {
        this._clearCrossfadeTimer();
        this._initAudioContext();
        this._ensureResumed();

        const index = this.currentIndex;

        if (index >= this.queue.length || !this.isPlaying) {
            // M-10: Deactivate last chunk on playback end
            if (this._lastActivatedChunkIndex >= 0 && this.onChunkDeactivate) {
                this.onChunkDeactivate(this._lastActivatedChunkIndex);
                this._lastActivatedChunkIndex = -1;
            }
            this._endPlayback(index >= this.queue.length);
            return;
        }

        const chunk = this.queue[index];
        if (!chunk.audioReady || !chunk.audioBuffer) {
            if (this.onPlaybackStart) this.onPlaybackStart();
            await this.fetchChunk(index);
        }

        if (chunk.cacheKey === "ERROR" || !chunk.cacheKey || !chunk.audioBuffer) {
            this.currentIndex = index + 1;
            setTimeout(() => this.playNextChunk(), 50);
            return;
        }

        try {
            // M-10: JIT activation — activate this chunk, deactivate previous
            if (this.onChunkActivate) {
                if (this._lastActivatedChunkIndex >= 0 && this._lastActivatedChunkIndex !== index && this.onChunkDeactivate) {
                    this.onChunkDeactivate(this._lastActivatedChunkIndex);
                }
                const activatedSpanIds = this.onChunkActivate(index);
                if (activatedSpanIds) chunk.spanIds = activatedSpanIds;
                this._lastActivatedChunkIndex = index;
            }

            const buffer = chunk.audioBuffer;

            // Compute word boundaries before seeking
            const durationMs = buffer.duration * 1000;
            this.currentBoundaries = (chunk.apiBoundaries && chunk.apiBoundaries.length > 0)
                ? this.alignBoundariesToMemoryMap(chunk.apiBoundaries, chunk.words, chunk.spanIds)
                : this.generateAutomatedWeightedBoundaries(durationMs, chunk.words, chunk.spanIds);

            // Determine start offset (for word jump)
            let startOffset = 0;
            if (this.targetSpanToSeek) {
                const b = this.currentBoundaries.find(x => x.spanId === this.targetSpanToSeek);
                startOffset = b ? b.startMs / 1000 : 0;
                this.targetSpanToSeek = null;
            }

            // Create new AudioBufferSourceNode → GainNode
            const source = this.audioCtx.createBufferSource();
            source.buffer = buffer;
            const gainNode = this.audioCtx.createGain();
            source.connect(gainNode);
            gainNode.connect(this.masterGain);

            // Crossfade with previous source (5ms overlap)
            const now = this.audioCtx.currentTime;
            if (this.currentSource && this.currentGain) {
                this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, now);
                this.currentGain.gain.linearRampToValueAtTime(0, now + this.CROSSFADE_TIME);

                gainNode.gain.setValueAtTime(0, now);
                gainNode.gain.linearRampToValueAtTime(1, now + this.CROSSFADE_TIME);

                // Clean up old source after crossfade completes
                const oldSource = this.currentSource;
                const oldGain = this.currentGain;
                oldSource.onended = null;
                setTimeout(() => {
                    try { oldSource.stop(); } catch (e) { /* already stopped */ }
                    oldSource.disconnect();
                    oldGain.disconnect();
                }, this.CROSSFADE_TIME * 1000 + 100);
            } else if (fadeIn) {
                // Fade-in for word jump (200ms)
                gainNode.gain.setValueAtTime(0, now);
                gainNode.gain.linearRampToValueAtTime(1, now + 0.2);
            }

            // Update current playback references
            this.currentSource = source;
            this.currentGain = gainNode;
            this.currentBuffer = buffer;
            this.chunkDuration = buffer.duration;
            this._playingChunkIndex = index;

            // Track duration for progress calculation
            this.chunkDurations[index] = buffer.duration;

            // Time tracking
            this.playStartOffset = startOffset;
            this.playStartContextTime = this.audioCtx.currentTime;
            this.pausedAt = startOffset;

            // Advance index to point to next chunk
            this.currentIndex = index + 1;

            // Schedule crossfade to next chunk (if there is one and enough time)
            const remainingTime = buffer.duration - startOffset;
            if (this.currentIndex < this.queue.length &&
                remainingTime > this.CROSSFADE_LOOKAHEAD + this.CROSSFADE_TIME) {
                this._scheduleCrossfade(remainingTime);
            }

            // Fallback: onended fires when buffer finishes or source.stop() is called
            source.onended = () => {
                this._clearCrossfadeTimer();
                if (this.currentSource === source) {
                    this.currentSource = null;
                    this.currentGain = null;
                }
                if (!this.isPlaying) return;
                if (this._crossfadeHandled) {
                    this._crossfadeHandled = false;
                    return;
                }
                this.playNextChunk();
            };

            // Start playback
            source.start(0, startOffset);

            // Start all engines
            this._startHighlightEngine();
            this._startVisualizer();
            this._startSpringScroll();

            if (this.onPlay) this.onPlay();

            // Preload next chunks in background
            this.preloadBuffer().catch(() => {});

        } catch (e) {
            this.currentIndex = index + 1;
            setTimeout(() => this.playNextChunk(), 50);
        }
    }

    // =========================================================================
    // Playback Controls
    // =========================================================================

    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        this.pausedAt = this._getCurrentTime();
        this._clearCrossfadeTimer();
        this._stopCurrentSource();
        this._stopHighlightEngine();
        this._stopVisualizer();
        this._stopSpringScroll();
        if (this.onPause) this.onPause();
    }

    resume() {
        if (this.isPlaying) return;
        this._initAudioContext();
        this._ensureResumed();

        // No buffer to resume — start next chunk
        if (!this.currentBuffer) {
            this.isPlaying = true;
            if (this.onPlaybackStart) this.onPlaybackStart();
            this.playNextChunk();
            return;
        }

        this.isPlaying = true;

        // Recreate source from the same AudioBuffer at the paused position
        const source = this.audioCtx.createBufferSource();
        source.buffer = this.currentBuffer;
        const gainNode = this.audioCtx.createGain();
        gainNode.gain.setValueAtTime(1, this.audioCtx.currentTime);

        source.connect(gainNode);
        gainNode.connect(this.masterGain);

        this.currentSource = source;
        this.currentGain = gainNode;

        this.playStartOffset = this.pausedAt;
        this.playStartContextTime = this.audioCtx.currentTime;

        // Reschedule crossfade for remaining time
        const remaining = this.currentBuffer.duration - this.pausedAt;
        if (this.currentIndex < this.queue.length &&
            remaining > this.CROSSFADE_LOOKAHEAD + this.CROSSFADE_TIME) {
            this._scheduleCrossfade(remaining);
        }

        source.onended = () => {
            this._clearCrossfadeTimer();
            if (this.currentSource === source) {
                this.currentSource = null;
                this.currentGain = null;
            }
            if (!this.isPlaying) return;
            if (this._crossfadeHandled) {
                this._crossfadeHandled = false;
                return;
            }
            this.playNextChunk();
        };

        source.start(0, this.pausedAt);

        this._startHighlightEngine();
        this._startVisualizer();
        this._startSpringScroll();

        if (this.onPlay) this.onPlay();
    }

    stop() {
        this.isPlaying = false;
        this._clearCrossfadeTimer();
        this._stopCurrentSource();
        this._resetHighlighting();
        this._stopVisualizer();
        this._stopSpringScroll();
        if (this.onPlaybackEnd) this.onPlaybackEnd();
    }

    hardReset() {
        this.stop();
        // M-10: Deactivate last chunk on reset
        if (this._lastActivatedChunkIndex >= 0 && this.onChunkDeactivate) {
            this.onChunkDeactivate(this._lastActivatedChunkIndex);
        }
        this._lastActivatedChunkIndex = -1;
        this.currentBuffer = null;
        this.pausedAt = 0;
        this.queue = [];
        this.currentIndex = 0;
        this._playingChunkIndex = 0;
        this.chunkDurations = [];
    }
}