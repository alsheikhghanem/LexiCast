import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from schemas import TTSRequest
from services import TTSService, CACHE_DIR

router = APIRouter()


def get_tts_service():
    return TTSService()


@router.get("/")
def read_root():
    return {"status": "Server is running perfectly!"}


@router.get("/api/voices")
async def get_voices(service: TTSService = Depends(get_tts_service)):
    try:
        voices = await service.get_filtered_voices()
        return {"voices": voices}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/tts")
async def generate_tts(request: TTSRequest, service: TTSService = Depends(get_tts_service)):
    try:
        result = await service.generate_audio_and_boundaries(request.text, request.voice, request.rate)
        return result
    except Exception:
        raise HTTPException(status_code=500, detail="Audio generation failed.")


@router.get("/api/audio/{cache_key}")
async def get_audio(cache_key: str):
    file_path = os.path.join(CACHE_DIR, f"{cache_key}.mp3")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(file_path, media_type="audio/mpeg")