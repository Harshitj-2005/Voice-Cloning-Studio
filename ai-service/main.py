"""
AI microservice: F5-TTS voice cloning inference.
Runs on port 8000. First request downloads model weights automatically.
Uses the high-level F5TTS API (f5-tts >= 1.0).
"""
import os
import re
import uuid
import shutil
import tempfile
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

import math
import numpy as np
import soundfile as sf
import torch
import torchaudio
from fastapi import FastAPI, UploadFile, Form, HTTPException
from fastapi.responses import FileResponse

# ── Patch torchaudio.load to use soundfile (avoids broken torchcodec / missing ffmpeg DLLs) ──
def _safe_torchaudio_load(filepath, *args, **kwargs):
    data, sr = sf.read(filepath, dtype="float32", always_2d=True)
    # soundfile returns (frames, channels), torchaudio expects (channels, frames)
    tensor = torch.from_numpy(data.T)
    return tensor, sr

torchaudio.load = _safe_torchaudio_load

# ── Model globals (loaded once at startup) ────────────────────────────────────
_f5tts = None

OUTPUT_DIR = Path(__file__).parent / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)
MIN_REFERENCE_SECONDS = 10.0
MAX_REFERENCE_SECONDS = 30.0


def _preserve_reference_audio(ref_file, ref_text, show_info=print):
    """Keep the user's complete reference instead of F5-TTS's 12-second clip."""
    show_info("Using complete reference audio...")
    ref_text = ref_text.strip()
    if ref_text and not ref_text.endswith((". ", ".", "。")):
        ref_text += ". "
    return ref_file, ref_text


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the F5-TTS model on startup, release on shutdown."""
    global _f5tts
    # Optimize CPU threads for PyTorch to maximize inference speed
    import multiprocessing
    cpu_cores = multiprocessing.cpu_count()
    torch.set_num_threads(max(1, cpu_cores - 1))
    print(f"[F5-TTS service] Configured PyTorch to use {torch.get_num_threads()} CPU threads")
    
    print("[F5-TTS service] Loading model… (first run downloads weights)")
    # pyrefly: ignore [missing-import]
    import f5_tts.api as f5_api
    from f5_tts.api import F5TTS  # import here so torch is fully initialised
    # The stock helper clips references to 12 seconds before inference.
    f5_api.preprocess_ref_audio_text = _preserve_reference_audio
    _f5tts = F5TTS(model="F5TTS_v1_Base")
    print(f"[F5-TTS service] Model ready – device: {_f5tts.device}")
    yield
    # nothing to clean up


app = FastAPI(title="F5-TTS Voice Clone Service", lifespan=lifespan)


def _estimate_fix_duration(ref_audio, gen_text, sample_rate=24000):
    """Estimate a natural total duration for long-form text such as poetry."""
    word_count = len(re.findall(r"\b[\w']+\b", gen_text))
    if word_count < 20:
        return None

    reference_seconds = len(ref_audio) / sample_rate
    punctuation_pauses = len(re.findall(r"[,;:!?]", gen_text)) * 0.12
    line_pauses = gen_text.count("\n") * 0.2
    speech_seconds = word_count / 2.45 + punctuation_pauses + line_pauses
    return round(reference_seconds + max(1.5, speech_seconds), 2)


def _text_overlap(ref_text, gen_text):
    """Return whether the generated request repeats a substantial reference phrase."""
    ref_words = re.findall(r"[\w']+", ref_text.lower())
    gen_words = re.findall(r"[\w']+", gen_text.lower())
    if len(ref_words) < 8 or len(gen_words) < 8:
        return False
    reference_phrase = " ".join(ref_words)
    generated_phrase = " ".join(gen_words)
    return reference_phrase in generated_phrase

@app.get("/health")
def health():
    ready = _f5tts is not None
    return {"ok": ready, "device": getattr(_f5tts, "device", "not loaded")}


@app.post("/generate")
async def generate(
    refAudio: UploadFile = Form(...),
    refText: str = Form(...),
    genText: str = Form(...),
):
    if _f5tts is None:
        raise HTTPException(503, "Model not ready yet – please retry")

    # ── Save raw upload ───────────────────────────────────────────────────────
    suffix = Path(refAudio.filename or "ref.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(refAudio.file, tmp)
        upload_path = tmp.name

    # ── Re-encode to 24 kHz mono WAV using soundfile (no ffmpeg/torchcodec) ──
    # torchaudio >= 2.x uses torchcodec which needs ffmpeg shared DLLs.
    # Pre-converting with libsndfile avoids that dependency entirely.
    ref_path = None
    out_path = OUTPUT_DIR / f"{uuid.uuid4().hex}.wav"
    try:
        audio_data, orig_sr = sf.read(upload_path, always_2d=True)
        # Mix down to mono while preserving the reference recording's dynamics.
        audio_data = audio_data.mean(axis=1) if audio_data.shape[1] > 1 else audio_data[:, 0]
        # Resample to 24 kHz if needed.
        target_sr = 24000
        if orig_sr != target_sr:
            new_len = int(math.ceil(len(audio_data) * target_sr / orig_sr))
            audio_data = np.interp(
                np.linspace(0, len(audio_data) - 1, new_len),
                np.arange(len(audio_data)),
                audio_data,
            )
        reference_seconds = len(audio_data) / target_sr
        if reference_seconds < MIN_REFERENCE_SECONDS or reference_seconds > MAX_REFERENCE_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Reference audio is {reference_seconds:.1f}s long. "
                    "Upload a clean 10-30 second clip and provide its exact transcript."
                ),
            )
        # Write a clean WAV that F5-TTS / torchaudio can load without torchcodec
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as ref_tmp:
            ref_path = ref_tmp.name
        sf.write(ref_path, audio_data.astype(np.float32), target_sr)
        fix_duration = _estimate_fix_duration(audio_data, genText, target_sr)

        print(f"[F5-TTS service] Starting inference (ref_text: {len(refText)} chars, gen_text: {len(genText)} chars)...")
        if _text_overlap(refText, genText):
            print("[F5-TTS service] Warning: gen_text contains ref_text; the reference may be spoken twice.")
        if fix_duration is not None:
            print(f"[F5-TTS service] Using estimated total duration: {fix_duration:.2f}s")
        import time
        t0 = time.time()
        with torch.inference_mode():
            # Use the higher step count for better synthesis quality.
            wav, sr, _spec = _f5tts.infer(
                ref_file=ref_path,
                ref_text=refText,
                gen_text=genText,
                nfe_step=16,
                fix_duration=fix_duration,
            )
        print(f"[F5-TTS service] Inference finished in {time.time() - t0:.2f}s")
        wav_np = np.array(wav)
        if wav_np.ndim > 1:
            wav_np = wav_np.squeeze()
        sf.write(str(out_path), wav_np.astype(np.float32), sr)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Inference failed: {e}")
    finally:
        os.unlink(upload_path)
        if ref_path and os.path.exists(ref_path):
            os.unlink(ref_path)

    return {"filename": out_path.name, "device": _f5tts.device}


@app.get("/audio/{filename}")
def get_audio(filename: str):
    path = OUTPUT_DIR / filename
    if not path.exists():
        raise HTTPException(404, "not found")
    return FileResponse(path, media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
