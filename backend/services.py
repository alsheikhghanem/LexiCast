import edge_tts
import asyncio
import hashlib
import os
import json

CACHE_DIR = "cache"
if not os.path.exists(CACHE_DIR):
    os.makedirs(CACHE_DIR)

tts_semaphore = asyncio.Semaphore(3)


class TTSService:
    @staticmethod
    async def get_filtered_voices():
        for attempt in range(3):
            try:
                voices = await asyncio.wait_for(edge_tts.list_voices(), timeout=10.0)
                filtered_voices = [
                    {"name": v["ShortName"], "gender": v["Gender"], "locale": v["Locale"]}
                    for v in voices if v["Locale"].startswith("ar-") or v["Locale"].startswith("en-")
                ]
                return filtered_voices
            except asyncio.TimeoutError:
                pass
            except Exception as e:
                if attempt == 2:
                    raise e
                await asyncio.sleep(2)
        return []

    @staticmethod
    async def generate_audio_and_boundaries(text: str, voice: str, rate: str):
        clean_text = text.strip()
        if not clean_text:
            return {"cache_key": "", "boundaries": []}

        hash_input = f"{clean_text}|{voice}|{rate}"
        cache_key = hashlib.md5(hash_input.encode('utf-8')).hexdigest()
        audio_path = os.path.join(CACHE_DIR, f"{cache_key}.mp3")
        boundaries_path = os.path.join(CACHE_DIR, f"{cache_key}.json")

        if os.path.exists(audio_path) and os.path.exists(boundaries_path):
            try:
                with open(boundaries_path, "r", encoding="utf-8") as f:
                    boundaries = json.load(f)
                return {"cache_key": cache_key, "boundaries": boundaries}
            except (OSError, json.JSONDecodeError):
                pass

        async with tts_semaphore:
            try:
                communicate = edge_tts.Communicate(clean_text, voice, rate=rate)
                audio_data = bytearray()
                word_boundaries = []

                async for chunk in communicate.stream():
                    chunk_type = chunk.get("type")
                    if chunk_type == "audio":
                        audio_data.extend(chunk.get("data"))
                    elif chunk_type == "WordBoundary":
                        word_boundaries.append({
                            "text": chunk.get("text"),
                            "offset": chunk.get("offset"),
                            "duration": chunk.get("duration")
                        })

                if not audio_data:
                    return {"cache_key": "", "boundaries": []}

                with open(audio_path, "wb") as f:
                    f.write(audio_data)
                with open(boundaries_path, "w", encoding="utf-8") as f:
                    json.dump(word_boundaries, f)

                return {"cache_key": cache_key, "boundaries": word_boundaries}

            except Exception as e:
                if "No audio was received" in str(e):
                    return {"cache_key": "", "boundaries": []}
                raise e