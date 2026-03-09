export class ApiService {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        console.log(`[TRACE] ApiService initialized with baseUrl: ${baseUrl}`);
    }

    async getVoices() {
        console.log(`[TRACE] ApiService.getVoices() called`);

        const response = await fetch(`${this.baseUrl}/voices`).catch(error => {
            console.error(`[ERROR] ApiService.getVoices() network request failed`, error);
            throw error;
        });

        console.log(`[TRACE] ApiService.getVoices() response status: ${response.status}`);

        if (!response.ok) {
            const err = new Error(`Network error: ${response.status}`);
            console.error(`[ERROR] ApiService.getVoices() failed`, err);
            throw err;
        }

        const data = await response.json().catch(error => {
            console.error(`[ERROR] ApiService.getVoices() parsing failed`, error);
            throw error;
        });

        const voicesCount = data['voices'] ? data['voices'].length : 0;
        console.log(`[TRACE] ApiService.getVoices() successfully parsed ${voicesCount} voices`);

        return data;
    }

    async generateTTS(payload) {
        console.log(`[TRACE] ApiService.generateTTS() called. Text length: ${payload.text.length}`);
        const startTime = performance.now();

        const response = await fetch(`${this.baseUrl}/tts`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        }).catch(error => {
            console.error(`[ERROR] ApiService.generateTTS() network request failed`, error);
            throw error;
        });

        console.log(`[TRACE] ApiService.generateTTS() response status: ${response.status}`);

        if (!response.ok) {
            const err = new Error(`Network error: ${response.status}`);
            console.error(`[ERROR] ApiService.generateTTS() failed`, err);
            throw err;
        }

        const data = await response.json().catch(error => {
            console.error(`[ERROR] ApiService.generateTTS() parsing failed`, error);
            throw error;
        });

        const timeTaken = (performance.now() - startTime).toFixed(2);
        const cacheKey = data['cache_key'] || 'NONE';
        const boundariesCount = data['boundaries'] ? data['boundaries'].length : 0;

        console.log(`[TRACE] ApiService.generateTTS() completed in ${timeTaken}ms. Cache Key: ${cacheKey}, Boundaries count: ${boundariesCount}`);

        return data;
    }
}