"""
Minimal faster-whisper STT server with OpenAI-compatible API.
Endpoint: POST /v1/audio/transcriptions
"""

import os
import tempfile
from fastapi import FastAPI, UploadFile, Form
from faster_whisper import WhisperModel
import uvicorn

MODEL_NAME = os.environ.get("WHISPER_MODEL", "Systran/faster-distil-whisper-small.en")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
PORT = int(os.environ.get("PORT", "8001"))

print(f"Loading model: {MODEL_NAME} (device={DEVICE}, compute_type={COMPUTE_TYPE})")
whisper_model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)
print("Model loaded.")

app = FastAPI(title="AEBClawd STT")


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile,
    model: str = Form(default="whisper-1"),
    language: str = Form(default="en"),
):
    with tempfile.NamedTemporaryFile(suffix=_get_suffix(file.filename)) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp.flush()

        segments, _ = whisper_model.transcribe(
            tmp.name,
            beam_size=5,
            language=language if language != "auto" else None,
        )
        text = " ".join(segment.text.strip() for segment in segments)

    return {"text": text.strip()}


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_NAME, "device": DEVICE}


def _get_suffix(filename: str | None) -> str:
    if filename:
        for ext in (".webm", ".wav", ".mp3", ".ogg", ".flac", ".m4a"):
            if filename.lower().endswith(ext):
                return ext
    return ".webm"


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
