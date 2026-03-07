import logging
import sys

logger = logging.getLogger("TTS_API")
logger.setLevel(logging.INFO)

formatter = logging.Formatter(
    fmt="[%(asctime)s] %(levelname)s: %(name)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(formatter)

if not logger.handlers:
    logger.addHandler(console_handler)