export class AudioEngine {
    constructor(audioPlayerElement, apiService) {
        this.player = audioPlayerElement;
        this.player.crossOrigin = "anonymous";
        this.api = apiService;
        this.queue = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.currentBoundaries = [];
        this.animationFrameId = null;
        this.currentActiveSpanId = null;
        this.voice = "";
        this.rate = "";
        this.targetSpanToSeek = null;
        this.onPlaybackStart = null;
        this.onPlaybackEnd = null;
        this.currentBlobUrl = null;
        this.isUserScrolling = false;
        this.scrollTimeout = null;

        this.db = null;
        this.initDB();

        this.canvas = null;
        this.canvasCtx = null;
        this.audioCtx = null;

        const handleUserScroll = () => {
            this.isUserScrolling = true;
            if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => {
                this.isUserScrolling = false;
            }, 3000);
        };

        window.addEventListener('wheel', handleUserScroll, {passive: true});
        window.addEventListener('touchmove', handleUserScroll, {passive: true});

        this.player.addEventListener('play', () => this.startHighlightEngine());
        this.player.addEventListener('pause', () => this.stopHighlightEngine());
        this.player.addEventListener('ended', async () => await this.playNextChunk());
    }

    setupVisualizer(canvasElement) {
        this.canvas = canvasElement;
        this.canvasCtx = this.canvas.getContext('2d');
    }

    startVisualizer() {
        if (!this.canvas) return;
        if (!this.audioCtx) {
            const AudioContextClass = window.AudioContext || window['webkitAudioContext'];
            this.audioCtx = new AudioContextClass();
            this.analyser = this.audioCtx.createAnalyser();
            this.source = this.audioCtx.createMediaElementSource(this.player);
            this.source.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);
            this.analyser.fftSize = 128;
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);
            this.drawVisualizer();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    drawVisualizer() {
        requestAnimationFrame(() => this.drawVisualizer());
        if (!this.isPlaying) return;

        this.analyser.getByteFrequencyData(this.dataArray);
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const barWidth = (this.canvas.width / this.bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < this.bufferLength; i++) {
            barHeight = this.dataArray[i] / 2;
            this.canvasCtx.fillStyle = `rgba(193, 95, 60, ${barHeight / 100})`;
            this.canvasCtx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }

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
        } catch (e) {
        }
    }

    async startQueue(chunks, voice, rate, startSpanId = null) {
        this.startVisualizer();
        this.hardReset();
        this.queue = JSON.parse(JSON.stringify(chunks)).map(c => ({
            ...c, cacheKey: null, apiBoundaries: null, isFetching: false, fetchPromise: null, audioReady: false
        }));

        this.voice = voice;
        this.rate = rate;
        this.isPlaying = true;

        let startChunkIndex = 0;
        if (startSpanId) {
            for (let i = 0; i < this.queue.length; i++) {
                if (this.queue[i].spanIds.includes(startSpanId)) {
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
        this.preloadBuffer().catch(() => {
        });
    }

    async jumpToSpan(spanId) {
        if (this.queue.length === 0) return;
        let targetIdx = this.queue.findIndex(q => q.spanIds.includes(spanId));
        if (targetIdx === -1) return;

        this.player.pause();
        this.resetHighlighting();

        this.currentIndex = targetIdx;
        this.targetSpanToSeek = spanId;
        this.isPlaying = true;

        if (this.onPlaybackStart) this.onPlaybackStart();
        await this.playNextChunk();
    }

    async seekToPercentage(percent) {
        if (this.queue.length === 0) return;
        const targetIndex = Math.floor(percent * this.queue.length);
        const chunkIndex = Math.min(targetIndex, this.queue.length - 1);

        this.player.pause();
        this.resetHighlighting();
        this.currentIndex = chunkIndex;
        this.targetSpanToSeek = null;
        this.isPlaying = true;

        if (this.onPlaybackStart) this.onPlaybackStart();
        await this.playNextChunk();
    }

    getGlobalProgress() {
        if (this.queue.length === 0) return 0;
        const chunkContribution = this.currentIndex / this.queue.length;
        let timeContribution = 0;
        if (this.player.duration && !isNaN(this.player.duration)) {
            timeContribution = (this.player.currentTime / this.player.duration) * (1 / this.queue.length);
        }
        return Math.min(1, chunkContribution + timeContribution);
    }

    async fetchChunk(index, retries = 3) {
        if (index >= this.queue.length) return;
        const chunk = this.queue[index];
        if (chunk.cacheKey && chunk.audioReady) return;
        if (chunk.fetchPromise) {
            await chunk.fetchPromise;
            return;
        }

        chunk.fetchPromise = (async () => {
            chunk.isFetching = true;
            for (let i = 1; i <= retries; i++) {
                let hasError = false;
                try {
                    if (!chunk.cacheKey) {
                        const data = await this.api.generateTTS({text: chunk.text, voice: this.voice, rate: this.rate});
                        chunk.cacheKey = data['cache_key'];
                        chunk.apiBoundaries = data['boundaries'];
                    }

                    if (!chunk.cacheKey || chunk.cacheKey === "ERROR") {
                        hasError = true;
                    } else {
                        let audioBlob = await this.getFromDB(chunk.cacheKey);

                        if (!audioBlob) {
                            const audioRes = await fetch(`${this.api.baseUrl}/audio/${chunk.cacheKey}`);
                            if (!audioRes.ok) {
                                hasError = true;
                            } else {
                                audioBlob = await audioRes.blob();
                                await this.saveToDB(chunk.cacheKey, audioBlob);
                            }
                        }
                    }
                } catch (e) {
                    hasError = true;
                }

                if (hasError) {
                    if (i === retries) {
                        chunk.cacheKey = "ERROR";
                        chunk.isFetching = false;
                    } else {
                        await new Promise(r => setTimeout(r, 1000 * i));
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

    async playNextChunk() {
        this.startVisualizer();
        if (this.currentIndex >= this.queue.length || !this.isPlaying) {
            const hasFinished = this.currentIndex >= this.queue.length;
            this.isPlaying = false;
            this.player.pause();
            this.resetHighlighting();
            if (this.onPlaybackEnd) this.onPlaybackEnd();
            if (hasFinished) {
                this.currentIndex = 0;
                this.player.removeAttribute('src');
                if (this.currentBlobUrl) {
                    URL.revokeObjectURL(this.currentBlobUrl);
                    this.currentBlobUrl = null;
                }
            }
            return;
        }

        const chunk = this.queue[this.currentIndex];
        if (!chunk.audioReady) {
            if (this.onPlaybackStart) this.onPlaybackStart();
            await this.fetchChunk(this.currentIndex);
        }

        if (chunk.cacheKey === "ERROR" || !chunk.cacheKey) {
            this.currentIndex++;
            setTimeout(() => this.playNextChunk(), 50);
            return;
        }

        try {
            const blob = await this.getFromDB(chunk.cacheKey);

            if (!(blob instanceof Blob)) {
                this.currentIndex++;
                setTimeout(() => this.playNextChunk(), 50);
                return;
            }

            if (this.currentBlobUrl) {
                URL.revokeObjectURL(this.currentBlobUrl);
            }
            this.currentBlobUrl = URL.createObjectURL(blob);

            this.player.src = this.currentBlobUrl;
            this.player.load();

            this.player.onloadedmetadata = () => {
                const duration = this.player.duration * 1000;
                this.currentBoundaries = (chunk.apiBoundaries && chunk.apiBoundaries.length > 0)
                    ? this.alignBoundariesToMemoryMap(chunk.apiBoundaries, chunk.words, chunk.spanIds)
                    : this.generateAutomatedWeightedBoundaries(duration, chunk.words, chunk.spanIds);

                if (this.targetSpanToSeek) {
                    const b = this.currentBoundaries.find(x => x.spanId === this.targetSpanToSeek);
                    this.player.currentTime = b ? b.startMs / 1000 : 0;
                    this.targetSpanToSeek = null;
                } else {
                    this.player.currentTime = 0;
                }

                const playPromise = this.player.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {
                    });
                }

                this.currentIndex++;
                this.preloadBuffer().catch(() => {
                });
            };
        } catch (e) {
            this.currentIndex++;
            setTimeout(() => this.playNextChunk(), 50);
        }
    }

    async preloadBuffer() {
        const fetchPromises = [];
        for (let i = this.currentIndex; i < Math.min(this.currentIndex + 3, this.queue.length); i++) {
            fetchPromises.push(this.fetchChunk(i));
        }
        await Promise.all(fetchPromises);
    }

    stop() {
        this.isPlaying = false;
        this.player.pause();
        this.resetHighlighting();
        if (this.onPlaybackEnd) this.onPlaybackEnd();
    }

    hardReset() {
        this.stop();
        this.player.removeAttribute('src');
        if (this.currentBlobUrl) {
            URL.revokeObjectURL(this.currentBlobUrl);
            this.currentBlobUrl = null;
        }
        this.queue = [];
        this.currentIndex = 0;
    }

    alignBoundariesToMemoryMap(apiB, words, spanIds) {
        const res = [];
        let sIdx = 0;
        const clean = (t) => t.replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '').toLowerCase();
        for (let b of apiB) {
            const apiT = clean(b['text'] || "");
            if (!apiT) continue;
            for (let i = sIdx; i < Math.min(sIdx + 15, words.length); i++) {
                if (clean(words[i]).includes(apiT) || apiT.includes(clean(words[i]))) {
                    res.push({
                        startMs: b['offset'] / 10000,
                        endMs: (b['offset'] + b['duration']) / 10000,
                        spanId: spanIds[i]
                    });
                    sIdx = i + 1;
                    break;
                }
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

    startHighlightEngine() {
        const sync = () => {
            if (this.player.paused || this.player.ended) return;
            const time = this.player.currentTime * 1000;
            const active = this.currentBoundaries.find(b => time >= b.startMs && time <= b.endMs);
            if (active && active.spanId !== this.currentActiveSpanId) {
                if (this.currentActiveSpanId) {
                    const old = document.getElementById(this.currentActiveSpanId);
                    if (old) old.className = old.getAttribute('data-original-class');
                }
                const el = document.getElementById(active.spanId);
                if (el) {
                    el.className = "word-glow transition-all duration-200 ease-out inline-block";
                    if (!this.isUserScrolling) {
                        const r = el.getBoundingClientRect();
                        if (r.top > window.innerHeight * 0.6 || r.bottom < window.innerHeight * 0.3) {
                            el.scrollIntoView({behavior: 'smooth', block: 'center'});
                        }
                    }
                }
                this.currentActiveSpanId = active.spanId;
            }
            this.animationFrameId = requestAnimationFrame(sync);
        };
        this.animationFrameId = requestAnimationFrame(sync);
    }

    stopHighlightEngine() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    }

    resetHighlighting() {
        this.stopHighlightEngine();
        if (this.currentActiveSpanId) {
            const el = document.getElementById(this.currentActiveSpanId);
            if (el) el.className = el.getAttribute('data-original-class');
        }
        this.currentActiveSpanId = null;
    }
}