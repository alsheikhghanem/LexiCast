export class AudioEngine {
    constructor(audioPlayerElement) {
        this.player = audioPlayerElement;
        this.currentBoundaries = [];
        this.animationFrameId = null;
        this.currentActiveSpanId = null;

        this.player.addEventListener('play', () => this.startHighlightEngine());
        this.player.addEventListener('pause', () => this.stopHighlightEngine());
        this.player.addEventListener('ended', () => this.resetHighlighting());
    }

    alignBoundariesToMemoryMap(apiBoundaries, spokenWordsList, spokenToSpanMap) {
        const processedBoundaries = [];
        let spokenIndex = 0;
        const cleanRegex = /[^\u0600-\u06FFa-zA-Z0-9]/g;

        for (let b of apiBoundaries) {
            const cleanApiText = (b.text || "").replace(cleanRegex, '').toLowerCase();
            if (!cleanApiText) continue;

            let matchedSpanId = null;
            for (let i = spokenIndex; i < Math.min(spokenIndex + 15, spokenWordsList.length); i++) {
                const cleanExpected = spokenWordsList[i].replace(cleanRegex, '').toLowerCase();
                if (cleanExpected.includes(cleanApiText) || cleanApiText.includes(cleanExpected)) {
                    matchedSpanId = spokenToSpanMap[i];
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

    generateAutomatedWeightedBoundaries(totalDurationMs, spokenWordsList, spokenToSpanMap) {
        let totalWeight = 0;
        const weights = spokenWordsList.map(word => {
            let w = word.length * 10;
            if (/[.,!?؛،:]/.test(word)) w += 50;
            totalWeight += w;
            return w;
        });

        let currentMs = 0;
        return weights.map((w, i) => {
            const duration = (w / totalWeight) * totalDurationMs;
            const b = { startMs: currentMs, endMs: currentMs + duration, spanId: spokenToSpanMap[i] };
            currentMs += duration;
            return b;
        });
    }

    setAudioData(base64Audio, boundaries, spokenWordsList, spokenToSpanMap, rateValue) {
        this.player.src = "data:audio/mp3;base64," + base64Audio;
        this.player.onloadedmetadata = () => {
            const totalDurationMs = this.player.duration * 1000;
            if (boundaries && boundaries.length > 0) {
                this.currentBoundaries = this.alignBoundariesToMemoryMap(boundaries, spokenWordsList, spokenToSpanMap);
            } else {
                this.currentBoundaries = this.generateAutomatedWeightedBoundaries(totalDurationMs, spokenWordsList, spokenToSpanMap);
            }
            this.setPlaybackRate(rateValue);
            this.player.play();
        };
    }

    setPlaybackRate(rateValue) {
        const rateMap = { "-50%": 0.5, "-25%": 0.75, "+0%": 1.0, "+25%": 1.25, "+50%": 1.5, "+75%": 1.75, "+100%": 2.0 };
        this.player.playbackRate = rateMap[rateValue] || 1.0;
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