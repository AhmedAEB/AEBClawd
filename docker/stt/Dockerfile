# faster-whisper STT service
# GPU: docker build --target gpu -t aebclawd-stt .
# CPU: docker build --target cpu -t aebclawd-stt-cpu .

# ── GPU build ────────────────────────────────────────────────────
FROM nvidia/cuda:12.3.2-cudnn9-runtime-ubuntu22.04 AS gpu

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
    faster-whisper==1.2.1 \
    fastapi==0.115.0 \
    uvicorn==0.30.0 \
    python-multipart==0.0.12

COPY server.py /app/server.py
WORKDIR /app

# Pre-download the model at build time
ARG WHISPER_MODEL=Systran/faster-distil-whisper-small.en
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"

ENV WHISPER_MODEL=${WHISPER_MODEL}
ENV WHISPER_DEVICE=cuda
ENV WHISPER_COMPUTE_TYPE=int8

EXPOSE 8001
CMD ["python3", "server.py"]

# ── CPU build ────────────────────────────────────────────────────
FROM python:3.11-slim AS cpu

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
    faster-whisper==1.2.1 \
    fastapi==0.115.0 \
    uvicorn==0.30.0 \
    python-multipart==0.0.12

COPY server.py /app/server.py
WORKDIR /app

ARG WHISPER_MODEL=Systran/faster-distil-whisper-small.en
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"

ENV WHISPER_MODEL=${WHISPER_MODEL}
ENV WHISPER_DEVICE=cpu
ENV WHISPER_COMPUTE_TYPE=int8

EXPOSE 8001
CMD ["python3", "server.py"]
