import { ApiService } from './api.js';
import { TextProcessor } from './textProcessor.js';
import { AudioEngine } from './audioEngine.js';

const API_BASE_URL = 'http://127.0.0.1:8000/api';

const elements = {
    textInput: document.getElementById('text-input'),
    markdownDisplay: document.getElementById('markdown-display'),
    voiceSelect: document.getElementById('voice-select'),
    rateSelect: document.getElementById('rate-select'),
    generateBtn: document.getElementById('generate-btn'),
    previewBtn: document.getElementById('preview-btn'),
    audioContainer: document.getElementById('audio-container'),
    audioPlayer: document.getElementById('audio-player')
};

const api = new ApiService(API_BASE_URL);
const textProcessor = new TextProcessor();
const audioEngine = new AudioEngine(elements.audioPlayer, api);

audioEngine.onPlaybackStart = () => {
    elements.generateBtn.innerText = "Stop Playback";
    elements.generateBtn.classList.replace('bg-green-600', 'bg-red-600');
    elements.generateBtn.classList.replace('hover:bg-green-700', 'hover:bg-red-700');
    elements.generateBtn.disabled = false;
    elements.audioContainer.classList.remove('hidden');
};

audioEngine.onPlaybackEnd = () => {
    elements.generateBtn.innerText = "Generate & Play";
    elements.generateBtn.classList.replace('bg-red-600', 'bg-green-600');
    elements.generateBtn.classList.replace('hover:bg-red-700', 'hover:bg-green-700');
    elements.generateBtn.disabled = false;
};

document.addEventListener('DOMContentLoaded', async () => {
    elements.generateBtn.disabled = true;
    elements.previewBtn.disabled = true;
    try {
        const responseData = await api.getVoices();
        const voicesArray = responseData['voices'] || [];

        elements.voiceSelect.innerHTML = '';
        voicesArray.forEach(voiceItem => {
            const voiceName = voiceItem['name'] || '';
            const voiceGender = voiceItem['gender'] || '';
            const voiceLocale = voiceItem['locale'] || '';

            const opt = document.createElement('option');
            opt.value = voiceName;
            opt.textContent = `${voiceName} (${voiceGender} | ${voiceLocale})`;
            elements.voiceSelect.appendChild(opt);
        });

        elements.generateBtn.disabled = false;
        elements.previewBtn.disabled = false;
    } catch (error) {
        elements.voiceSelect.innerHTML = '<option value="">Error loading voices.</option>';
    }
});

elements.textInput.addEventListener('input', () => {
    textProcessor.renderLivePreview(elements.textInput.value, elements.markdownDisplay);
});

elements.rateSelect.addEventListener('change', () => {
    audioEngine.rate = elements.rateSelect.value;
});

async function processAndPlay() {
    if (audioEngine.isPlaying) {
        audioEngine.stop();
        audioEngine.onPlaybackEnd();
        return;
    }

    const rawText = elements.textInput.value;
    if (!rawText.trim()) return;

    elements.generateBtn.innerText = "Initializing...";
    elements.generateBtn.disabled = true;

    textProcessor.renderLivePreview(rawText, elements.markdownDisplay);
    const chunks = textProcessor.buildMemoryMapAndDOM(elements.markdownDisplay);

    if (chunks.length === 0) {
        audioEngine.onPlaybackEnd();
        return;
    }

    await audioEngine.startQueue(chunks, elements.voiceSelect.value, elements.rateSelect.value);
}

elements.generateBtn.addEventListener('click', async () => {
    await processAndPlay();
});

elements.previewBtn.addEventListener('click', async () => {
    if (audioEngine.isPlaying) {
        audioEngine.stop();
        audioEngine.onPlaybackEnd();
    }

    elements.textInput.value = elements.voiceSelect.value.includes('ar-')
        ? "مرحباً، هذا اختبار حي للتحقق من الـ {{Audio System::أُودْيُو سِيسْتِمْ}} والتأكد من تظليل الـ {{Words::وُورْدْز}} بنجاح."
        : "Hello, this is a live test to verify the audio system and check the highlighted words successfully.";

    elements.textInput.dispatchEvent(new Event('input'));
    await processAndPlay();
});