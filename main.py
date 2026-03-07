from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import edge_tts
import base64

app = FastAPI(title="TTS Local Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Removed default values to ensure frontend sends them
class TTSRequest(BaseModel):
    text: str
    voice: str
    rate: str

@app.get("/")
def read_root():
    return {"status": "Server is running perfectly!"}

# NEW: Endpoint to fetch all Arabic and English voices dynamically
@app.get("/api/voices")
async def get_voices():
    voices = await edge_tts.list_voices()
    filtered_voices = [
        {"name": v["ShortName"], "gender": v["Gender"], "locale": v["Locale"]}
        for v in voices if v["Locale"].startswith("ar-") or v["Locale"].startswith("en-")
    ]
    return {"voices": filtered_voices}

@app.post("/api/tts")
async def generate_tts(request: TTSRequest):
    communicate = edge_tts.Communicate(request.text, request.voice, rate=request.rate)

    audio_data = bytearray()
    word_boundaries = []

    print(f"--- Starting stream for Voice: {request.voice} | Rate: {request.rate} ---")

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            word_boundaries.append({
                "text": chunk.get("text", ""),
                "offset": chunk.get("offset", 0),
                "duration": chunk.get("duration", 0)
            })

    print(f"--- Stream finished. Collected {len(word_boundaries)} word boundaries. ---")

    audio_base64 = base64.b64encode(audio_data).decode("utf-8")

    return {
        "audio": audio_base64,
        "boundaries": word_boundaries
    }
