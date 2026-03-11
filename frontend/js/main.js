window.downloadReportTxt = () => {
};

import {ApiService} from './api.js';
import {TextProcessor} from './textProcessor.js';
import {AudioEngine} from './audioEngine.js';

const API_BASE_URL = 'http://127.0.0.1:8000/api';
const elements = {
    textInput: document.getElementById('text-input'),
    markdownDisplay: document.getElementById('markdown-display'),
    voiceSelect: document.getElementById('voice-select'),
    rateSelect: document.getElementById('rate-select'),
    btnToggleInput: document.getElementById('btn-toggle-input'),
    btnCloseInput: document.getElementById('btn-close-input'),
    panelInput: document.getElementById('panel-input'),
    btnToggleVoice: document.getElementById('btn-toggle-voice'),
    panelVoice: document.getElementById('panel-voice'),
    btnToggleSpeed: document.getElementById('btn-toggle-speed'),
    panelSpeed: document.getElementById('panel-speed'),
    speedLabel: document.getElementById('speed-label'),
    btnFocusMode: document.getElementById('btn-focus-mode'),
    previewBtn: document.getElementById('preview-btn'),
    bottomPlayer: document.getElementById('bottom-player'),
    btnMainPlay: document.getElementById('btn-main-play'),
    wrapperPlay: document.getElementById('wrapper-play'),
    wrapperPause: document.getElementById('wrapper-pause'),
    wrapperLoading: document.getElementById('wrapper-loading'),
    progressContainer: document.getElementById('progress-container'),
    progressBar: document.getElementById('progress-bar'),
    visualizerCanvas: document.getElementById('audio-visualizer')
};

const api = new ApiService(API_BASE_URL);
const textProcessor = new TextProcessor();
const audioEngine = new AudioEngine(api);
let currentChunks = [];
let progressTrackerId = null;

audioEngine.setupVisualizer(elements.visualizerCanvas);

function resizeCanvas() {
    elements.visualizerCanvas.width = elements.bottomPlayer.clientWidth;
    elements.visualizerCanvas.height = elements.bottomPlayer.clientHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const cursorDot = document.createElement('div');
const cursorTrail = document.createElement('div');
cursorDot.className = 'cursor-dot';
cursorTrail.className = 'cursor-trail';

if (window.matchMedia("(pointer: fine)").matches) {
    document.body.append(cursorDot, cursorTrail);
    let mX = 0, mY = 0, tX = 0, tY = 0;
    document.addEventListener('mousemove', e => {
        mX = e.clientX;
        mY = e.clientY;
        cursorDot.style.transform = `translate3d(${mX}px, ${mY}px, 0)`;
    });
    (function anim() {
        tX += (mX - tX) * 0.15;
        tY += (mY - tY) * 0.15;
        cursorTrail.style.transform = `translate3d(${tX}px, ${tY}px, 0)`;
        requestAnimationFrame(anim);
    })();
}

function updateCursorInteractions() {
    document.querySelectorAll('button, select, span[id^="md-word-"], textarea, #progress-container').forEach(el => {
        el.onmouseenter = () => document.body.classList.add('hover-active');
        el.onmouseleave = () => document.body.classList.remove('hover-active');
    });
}

function togglePanel(panel) {
    const isHidden = panel.classList.contains('hidden-panel');
    document.querySelectorAll('.floating-panel, aside').forEach(p => {
        if (p !== panel) {
            p.classList.add('hidden-panel');
            p.style.opacity = '0';
        }
    });
    if (isHidden) {
        panel.classList.remove('hidden-panel');
        setTimeout(() => {
            panel.style.opacity = '1';
            panel.style.transform = 'scale(1) translateY(0)';
        }, 10);
    } else {
        panel.style.opacity = '0';
        panel.style.transform = 'scale(0.8) translateY(20px)';
        setTimeout(() => panel.classList.add('hidden-panel'), 300);
    }
}

let _saveSessionTimer = null;
function saveSession() {
    if (_saveSessionTimer) clearTimeout(_saveSessionTimer);
    _saveSessionTimer = setTimeout(() => {
        const doSave = () => {
            try {
                localStorage.setItem('tts_text', elements.textInput.value);
                localStorage.setItem('tts_voice', elements.voiceSelect.value);
                localStorage.setItem('tts_rate', elements.rateSelect.value);
            } catch (e) { /* quota exceeded — best effort */ }
        };
        if ('requestIdleCallback' in window) {
            requestIdleCallback(doSave, {timeout: 1000});
        } else {
            doSave();
        }
    }, 300);
}

function loadSession() {
    const savedText = localStorage.getItem('tts_text');
    const savedVoice = localStorage.getItem('tts_voice');
    const savedRate = localStorage.getItem('tts_rate');

    if (savedText) elements.textInput.value = savedText;
    if (savedVoice && [...elements.voiceSelect.options].some(o => o.value === savedVoice)) {
        elements.voiceSelect.value = savedVoice;
    }
    if (savedRate && [...elements.rateSelect.options].some(o => o.value === savedRate)) {
        elements.rateSelect.value = savedRate;
        elements.speedLabel.textContent = elements.rateSelect.options[elements.rateSelect.selectedIndex].text.split(' ')[0];
    }
}

function trackProgress() {
    const percent = audioEngine.getGlobalProgress() * 100;
    elements.progressBar.style.width = `${percent}%`;
    if (audioEngine.isPlaying) {
        progressTrackerId = requestAnimationFrame(trackProgress);
    }
}

elements.progressContainer.onclick = async (e) => {
    if (currentChunks.length === 0) return;
    const rect = elements.progressContainer.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    await audioEngine.seekToPercentage(percent);
    trackProgress();
};

elements.btnToggleInput.onclick = () => togglePanel(elements.panelInput);
elements.btnCloseInput.onclick = () => togglePanel(elements.panelInput);
elements.btnToggleVoice.onclick = () => togglePanel(elements.panelVoice);
elements.btnToggleSpeed.onclick = () => togglePanel(elements.panelSpeed);

elements.btnFocusMode.onclick = () => {
    document.body.classList.toggle('focus-mode');
    if (document.body.classList.contains('focus-mode')) {
        elements.btnFocusMode.classList.add('text-[#c15f3c]');
        elements.panelInput.classList.add('hidden-panel');
    } else {
        elements.btnFocusMode.classList.remove('text-[#c15f3c]');
    }
};

audioEngine.onPlaybackStart = () => {
    elements.wrapperPlay.classList.add('hidden');
    elements.wrapperPause.classList.add('hidden');
    elements.wrapperLoading.classList.remove('hidden');
    elements.bottomPlayer.classList.add('playing-pulse');
    if (progressTrackerId) cancelAnimationFrame(progressTrackerId);
    trackProgress();
};

audioEngine.onPlaybackEnd = () => {
    elements.bottomPlayer.classList.remove('playing-pulse');
    elements.btnMainPlay.style.backgroundColor = '#c15f3c';
    elements.wrapperLoading.classList.add('hidden');
    elements.wrapperPause.classList.add('hidden');
    elements.wrapperPlay.classList.remove('hidden');
    elements.progressBar.style.width = `0%`;
    if (progressTrackerId) cancelAnimationFrame(progressTrackerId);
};

audioEngine.onPlay = () => {
    elements.wrapperLoading.classList.add('hidden');
    elements.wrapperPlay.classList.add('hidden');
    elements.wrapperPause.classList.remove('hidden');
    elements.btnMainPlay.style.backgroundColor = '#ef4444';
};

audioEngine.onPause = () => {
    elements.wrapperPause.classList.add('hidden');
    elements.wrapperLoading.classList.add('hidden');
    elements.wrapperPlay.classList.remove('hidden');
    elements.btnMainPlay.style.backgroundColor = '#c15f3c';
};

function checkInputState() {
    const ok = elements.textInput.value.trim().length > 0 && elements.voiceSelect.value;
    elements.btnMainPlay.disabled = !ok;
    elements.btnMainPlay.style.opacity = ok ? "1" : "0.4";
}

function updatePreviewAndChunks() {
    textProcessor.renderLivePreview(elements.textInput.value, elements.markdownDisplay);
    currentChunks = textProcessor.buildMemoryMapAndDOM(elements.markdownDisplay);
    updateCursorInteractions();
    saveSession();
}

async function processAndPlay(spanId = null) {
    if (currentChunks.length === 0) return;
    elements.wrapperPlay.classList.add('hidden');
    elements.wrapperLoading.classList.remove('hidden');
    await audioEngine.startQueue(currentChunks, elements.voiceSelect.value, elements.rateSelect.value, spanId);
}

document.addEventListener('DOMContentLoaded', async () => {
    if (window['lucide']) {
        window['lucide']['createIcons']();
    }
    try {
        const data = await api.getVoices();
        const voices = data['voices'] || [];
        elements.voiceSelect.innerHTML = voices.map(v => `<option value="${v['name']}">${v['name']} (${v['gender']})</option>`).join('');
        loadSession();
        updatePreviewAndChunks();
        checkInputState();
    } catch (e) {
        elements.voiceSelect.innerHTML = '<option>Error loading voices</option>';
    }
});

let _inputDebounce = null;
elements.textInput.oninput = () => {
    audioEngine.hardReset();
    checkInputState();
    if (_inputDebounce) clearTimeout(_inputDebounce);
    _inputDebounce = setTimeout(() => {
        updatePreviewAndChunks();
    }, 200);
};

elements.voiceSelect.onchange = async () => {
    saveSession();
    const sid = audioEngine.currentActiveSpanId;
    audioEngine.hardReset();
    if (sid) await processAndPlay(sid);
    setTimeout(() => togglePanel(elements.panelVoice), 300);
};

elements.rateSelect.onchange = async () => {
    saveSession();
    audioEngine.rate = elements.rateSelect.value;
    elements.speedLabel.textContent = elements.rateSelect.options[elements.rateSelect.selectedIndex].text.split(' ')[0];
    const sid = audioEngine.currentActiveSpanId;
    audioEngine.hardReset();
    if (sid) await processAndPlay(sid);
    setTimeout(() => togglePanel(elements.panelSpeed), 300);
};

elements.btnMainPlay.onclick = async () => {
    if (!elements.wrapperLoading.classList.contains('hidden')) return;

    if (audioEngine.queue.length > 0) {
        if (audioEngine.isPlaying) {
            audioEngine.pause();
        } else {
            audioEngine.resume();
            trackProgress();
        }
        return;
    }
    await processAndPlay();
};

elements.markdownDisplay.onclick = async (e) => {
    const span = e.target.closest('span[id^="md-word-"]');
    if (!span) return;
    if (audioEngine.queue.length === 0) await processAndPlay(span.id);
    else await audioEngine.jumpToSpan(span.id);
};

elements.previewBtn.onclick = async () => {
    audioEngine.hardReset();
    elements.textInput.value = elements.voiceSelect.value.includes('ar-')
        ? "# تجربة حية\nمرحباً بك في {{LexiCast::لِيكْسِي كَاسْت}} للذكاء الاصطناعي."
        : "# Live Preview\nWelcome to {{LexiCast::Lexi Cast}}.";
    updatePreviewAndChunks();
    checkInputState();
    await processAndPlay();
};