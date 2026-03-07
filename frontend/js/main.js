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
const audioEngine = new AudioEngine(elements.audioPlayer);

/**
 * @typedef {Object} Voice
 * @property {string} name
 * @property {string} gender
 * @property {string} locale
 */

/**
 * @typedef {Object} TTSResponse
 * @property {string} audio
 * @property {Array<{offset: number, duration: number, text: string}>} boundaries
 */

document.addEventListener('DOMContentLoaded', async () => {
    elements.generateBtn.disabled = true;
    elements.previewBtn.disabled = true;
    try {
        /** @type {{voices: Voice[]}} */
        const data = await api.getVoices();

        elements.voiceSelect.innerHTML = '';
        data.voices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.name;
            opt.textContent = `${v.name} (${v.gender} | ${v.locale})`;
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
    audioEngine.setPlaybackRate(elements.rateSelect.value);
});

async function processAndPlay(buttonElement) {
    const rawText = elements.textInput.value;
    if (!rawText.trim()) return;

    const originalText = buttonElement.innerText;
    buttonElement.innerText = "Processing...";
    buttonElement.disabled = true;

    audioEngine.resetHighlighting();

    try {
        textProcessor.renderLivePreview(rawText, elements.markdownDisplay);
        const finalSpokenText = textProcessor.buildMemoryMapAndDOM(elements.markdownDisplay);

        /** @type {TTSResponse} */
        const data = await api.generateTTS({
            text: finalSpokenText,
            voice: elements.voiceSelect.value,
            rate: elements.rateSelect.value
        });

        audioEngine.setAudioData(
            data.audio,
            data.boundaries,
            textProcessor.spokenWordsList,
            textProcessor.spokenToSpanMap,
            elements.rateSelect.value
        );

        elements.audioContainer.classList.remove('hidden');
    } catch (error) {
        console.error("Processing Error:", error);
    } finally {
        buttonElement.innerText = originalText;
        buttonElement.disabled = false;
    }
}

elements.generateBtn.addEventListener('click', async () => {
    await processAndPlay(elements.generateBtn);
});

elements.previewBtn.addEventListener('click', async () => {
    elements.textInput.value = elements.voiceSelect.value.includes('ar-')
        ? "مرحباً، هذا اختبار حي للتحقق من الـ {{Audio System::أُودْيُو سِيسْتِمْ}} والتأكد من تظليل الـ {{Words::وُورْدْز}} بنجاح."
        : "Hello, this is a live test to verify the audio system and check the highlighted words successfully.";

    elements.textInput.dispatchEvent(new Event('input'));
    await processAndPlay(elements.previewBtn);
});