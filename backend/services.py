import edge_tts
import base64
import asyncio

class TTSService:
    @staticmethod
    async def get_filtered_voices():
        for attempt in range(3):
            try:
                voices = await edge_tts.list_voices()
                filtered_voices = [
                    {"name": v["ShortName"], "gender": v["Gender"], "locale": v["Locale"]}
                    for v in voices if v["Locale"].startswith("ar-") or v["Locale"].startswith("en-")
                ]
                return filtered_voices
            except Exception as e:
                if attempt == 2:
                    raise e
                await asyncio.sleep(2)
        return []

    @staticmethod
    async def generate_audio_and_boundaries(text: str, voice: str, rate: str):
        try:
            communicate = edge_tts.Communicate(text.strip(), voice, rate=rate)
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

            audio_base64 = base64.b64encode(audio_data).decode("utf-8")

            return {
                "audio": audio_base64,
                "boundaries": word_boundaries
            }

        except Exception as e:
            raise e