from fastapi import APIRouter, Depends
from schemas import TTSRequest
from services import TTSService

router = APIRouter()

def get_tts_service():
    return TTSService()

@router.get("/")
def read_root():
    return {"status": "Server is running perfectly!"}

@router.get("/api/voices")
async def get_voices(service: TTSService = Depends(get_tts_service)):
    voices = await service.get_filtered_voices()
    return {"voices": voices}

@router.post("/api/tts")
async def generate_tts(request: TTSRequest, service: TTSService = Depends(get_tts_service)):
    result = await service.generate_audio_and_boundaries(request.text, request.voice, request.rate)
    return result