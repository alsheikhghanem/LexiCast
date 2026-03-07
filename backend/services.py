import edge_tts
import base64
from logger import logger


class TTSService:
    @staticmethod
    async def get_filtered_voices():
        logger.info("Fetching available voices from edge_tts...")
        try:
            voices = await edge_tts.list_voices()
            filtered_voices = [
                {"name": v["ShortName"], "gender": v["Gender"], "locale": v["Locale"]}
                for v in voices if v["Locale"].startswith("ar-") or v["Locale"].startswith("en-")
            ]
            logger.info(f"Successfully fetched {len(filtered_voices)} voices.")
            return filtered_voices
        except Exception as e:
            logger.error(f"Failed to fetch voices: {str(e)}")
            raise e

    @staticmethod
    async def generate_audio_and_boundaries(text: str, voice: str, rate: str):
        logger.info(f"Generating TTS | Voice: {voice} | Rate: {rate} | Length: {len(text)}")

        try:
            communicate = edge_tts.Communicate(text, voice, rate=rate)
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

            if not word_boundaries:
                logger.warning(f"No boundaries captured. Audio size: {len(audio_data)} bytes.")
            else:
                logger.info(f"Success. Boundaries: {len(word_boundaries)}")

            return {
                "audio": audio_base64,
                "boundaries": word_boundaries
            }

        except Exception as e:
            logger.error(f"Error: {str(e)}")
            raise e