export class AudioEngine {
    constructor(audioPlayerElement, apiService) {
        this.player = audioPlayerElement;
        this.api = apiService;
        this.queue = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.currentBoundaries = [];
        this.animationFrameId = null;
        this.currentActiveSpanId = null;
        this.voice = "";
        this.rate = "";
        this.onPlaybackStart = null;
        this.onPlaybackEnd = null;

        this.player.playbackRate = 1.0;

        this.player.addEventListener('play', () => this.startHighlightEngine());
        this.player.addEventListener('pause', () => this.stopHighlightEngine());
        this.player.addEventListener('ended', async () => { await this.playNextChunk(); });
    }

    async startQueue(chunks, voice, rate) {
        this.resetHighlighting();
        this.queue = chunks.map(c => ({
            ...c,
            audioBase64: null,
            apiBoundaries: null,
            isFetching: false
        }));
        this.currentIndex = 0;
        this.voice = voice;
        this.rate = rate;
        this.isPlaying = true;

        await this.fetchChunk(0);

        if (this.onPlaybackStart) this.onPlaybackStart();

        const playPromise = this.playNextChunk();
        const preloadPromise = this.preloadBuffer();
        await Promise.all([playPromise, preloadPromise]);
    }

    async preloadBuffer() {
        for (let i = this.currentIndex + 1; i < Math.min(this.currentIndex + 4, this.queue.length); i++) {
            if (!this.queue[i].audioBase64 && !this.queue[i].isFetching) {
                await new Promise(r => setTimeout(r, 500));
                if (this.isPlaying) {
                    await this.fetchChunk(i);
                }
            }
        }
    }

    async fetchChunk(index, retries = 3) {
        if (index >= this.queue.length) return;
        const chunk = this.queue[index];
        if (chunk.audioBase64 || chunk.isFetching) return;

        chunk.isFetching = true;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const { audio, boundaries } = await this.api.generateTTS({
                    text: chunk.text,
                    voice: this.voice,
                    rate: this.rate
                });
                chunk.audioBase64 = audio;
                chunk.apiBoundaries = boundaries;
                chunk.isFetching = false;
                return;
            } catch (error) {
                if (attempt === retries) {
                    chunk.audioBase64 = "ERROR";
                    chunk.isFetching = false;
                    return;
                }
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }

    async playNextChunk() {
        if (this.currentIndex >= this.queue.length || !this.isPlaying) {
            this.isPlaying = false;
            this.resetHighlighting();
            if (this.onPlaybackEnd) this.onPlaybackEnd();
            return;
        }

        const chunk = this.queue[this.currentIndex];

        if (!chunk.audioBase64) {
            if (!chunk.isFetching) {
                await this.fetchChunk(this.currentIndex);
            } else {
                while (chunk.isFetching && this.isPlaying) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        }

        if (chunk.audioBase64 === "ERROR") {
            this.currentIndex++;
            await this.playNextChunk();
            return;
        }

        this.player.src = "data:audio/mp3;base64," + chunk.audioBase64;

        this.player.onloadedmetadata = () => {
            const totalDurationMs = this.player.duration * 1000;
            if (chunk.apiBoundaries && chunk.apiBoundaries.length > 0) {
                this.currentBoundaries = this.alignBoundariesToMemoryMap(chunk.apiBoundaries, chunk.words, chunk.spanIds);
            } else {
                this.currentBoundaries = this.generateAutomatedWeightedBoundaries(totalDurationMs, chunk.words, chunk.spanIds);
            }
            this.player.play();

            this.currentIndex++;
            this.preloadBuffer().catch(() => {});
        };
    }

    stop() {
        this.isPlaying = false;
        this.player.pause();
        this.resetHighlighting();
    }

    alignBoundariesToMemoryMap(apiBoundaries, words, spanIds) {
        const processedBoundaries = [];
        let spokenIndex = 0;
        const cleanRegex = /[^\u0600-\u06FFa-zA-Z0-9]/g;

        for (let b of apiBoundaries) {
            const cleanApiText = (b.text || "").replace(cleanRegex, '').toLowerCase();
            if (!cleanApiText) continue;

            let matchedSpanId = null;
            for (let i = spokenIndex; i < Math.min(spokenIndex + 15, words.length); i++) {
                const cleanExpected = words[i].replace(cleanRegex, '').toLowerCase();
                if (cleanExpected.includes(cleanApiText) || cleanApiText.includes(cleanExpected)) {
                    matchedSpanId = spanIds[i];
                    spokenIndex = i + 1;
                    break;
                }
            }

            if (matchedSpanId) {
                processedBoundaries.push({
                    startMs: b.offset / 10000,
                    endMs: (b.offset + b.duration) / 10000,
                    spanId: matchedSpanId
                });
            }
        }
        return processedBoundaries;
    }

    generateAutomatedWeightedBoundaries(totalDurationMs, words, spanIds) {
        let totalWeight = 0;
        const weights = words.map(word => {
            let w = word.length * 10;
            if (/[.,!?؛،:]/.test(word)) w += 50;
            totalWeight += w;
            return w;
        });

        let currentMs = 0;
        return weights.map((w, i) => {
            const duration = (w / totalWeight) * totalDurationMs;
            const b = { startMs: currentMs, endMs: currentMs + duration, spanId: spanIds[i] };
            currentMs += duration;
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
                    el.className = "bg-blue-600 text-white px-1 rounded inline-block scale-105 transition-all duration-75";
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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