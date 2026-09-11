export async function generateSpeech({ refAudio, refText, genText }) {
  const form = new FormData();
  form.append("refAudio", refAudio);
  form.append("refText", refText);
  form.append("genText", genText);

  const res = await fetch("/api/tts", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.detail || "Generation failed");
  }

  return res.json();
}
