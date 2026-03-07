export class ApiService {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async getVoices() {
        const response = await fetch(`${this.baseUrl}/voices`);
        if (!response.ok) throw new Error("Network error");
        return response.json();
    }

    async generateTTS(payload) {
        const response = await fetch(`${this.baseUrl}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error("Network error");
        return response.json();
    }
}