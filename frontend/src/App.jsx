import { useEffect, useRef, useState } from "react";
import { generateSpeech } from "./api";
import logoSvg from "./echoform-icon-site-theme.svg";
import "./styles.css";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const SCRIPT_IDEAS = [
  "Hello world. In the beginning there was silence — and then, there was voice.",
  "Welcome back. Today we explore how a few seconds of audio become an entire performance.",
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.",
];

const STATUS_LINES = [
  "Extracting voice embeddings",
  "Modeling timbre and prosody",
  "Aligning phoneme boundaries",
  "Synthesizing the waveform",
  "Polishing and rendering audio",
];

const fmt = (s) => {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
};

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

function useObjectURL(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

/** Decode the audio file and extract bar peaks for the live waveform. */
function useWaveform(file) {
  const [bars, setBars] = useState(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) {
      setBars(null);
      setDuration(0);
      return;
    }
    let cancelled = false;
    setError("");
    (async () => {
      try {
        const buf = await file.arrayBuffer();
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        const audio = await ac.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const N = 72;
        const chunk = Math.max(1, Math.floor(data.length / N));
        const peaks = [];
        for (let i = 0; i < N; i++) {
          let max = 0;
          const start = i * chunk;
          const end = Math.min(data.length, start + chunk);
          for (let j = start; j < end; j += 60) {
            const v = Math.abs(data[j] || 0);
            if (v > max) max = v;
          }
          peaks.push(Math.min(1, max * 1.7));
        }
        if (!cancelled) {
          setBars(peaks);
          setDuration(audio.duration);
        }
        ac.close();
      } catch {
        if (!cancelled) setError("Could not decode that file — try an MP3, WAV or M4A.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);
  return { bars, duration, error };
}

/* ------------------------------------------------------------------ */
/* Ambient canvas — layered audio waves drifting behind everything     */
/* ------------------------------------------------------------------ */

function AmbientCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf;
    let t = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const WAVES = [
      { rgb: "186,252,89", amp: 0.08, len: 0.0016, sp: 0.85, y: 0.34, a: 0.12 },
      { rgb: "143,212,52", amp: 0.07, len: 0.0023, sp: 1.15, y: 0.46, a: 0.09 },
      { rgb: "79,126,44", amp: 0.055, len: 0.0032, sp: 1.45, y: 0.58, a: 0.08 },
    ];

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      t += 0.007;
      WAVES.forEach((wv, idx) => {
        ctx.beginPath();
        const baseY = h * wv.y;
        for (let x = 0; x <= w; x += 5 * dpr) {
          const y =
            baseY +
            Math.sin(x * wv.len + t * wv.sp + idx * 1.8) * h * wv.amp +
            Math.sin(x * wv.len * 2.3 + t * wv.sp * 1.6) * h * wv.amp * 0.45;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${wv.rgb},${wv.a})`;
        ctx.lineWidth = 1.4 * dpr;
        ctx.stroke();
        // soft fill under the first wave
        if (idx === 0) {
          ctx.lineTo(w, h);
          ctx.lineTo(0, h);
          ctx.closePath();
          const g = ctx.createLinearGradient(0, baseY - h * 0.1, 0, h);
          g.addColorStop(0, `rgba(${wv.rgb},0.05)`);
          g.addColorStop(1, "rgba(11,15,11,0)");
          ctx.fillStyle = g;
          ctx.fill();
        }
      });
      raf = requestAnimationFrame(draw);
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      draw();
      cancelAnimationFrame(raf);
    } else {
      draw();
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="ambient" aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/* Small bits                                                          */
/* ------------------------------------------------------------------ */

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
  </svg>
);

/* ------------------------------------------------------------------ */
/* Dropzone with live decoded waveform                                 */
/* ------------------------------------------------------------------ */

function Dropzone({ file, setFile, bars, duration, error, url }) {
  const [drag, setDrag] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const inputRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    return () => audioRef.current?.pause();
  }, [url]);

  const togglePreview = (e) => {
    e.stopPropagation();
    if (!url) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPreviewing(false);
      return;
    }
    const a = new Audio(url);
    audioRef.current = a;
    setPreviewing(true);
    a.onended = () => {
      audioRef.current = null;
      setPreviewing(false);
    };
    a.play().catch(() => setPreviewing(false));
  };

  const sweetSpot = duration >= 10 && duration <= 30;

  return (
    <div
      className={`dropzone ${drag ? "dragging" : ""} ${file ? "has-file" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) setFile(f);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile(f);
          e.target.value = "";
        }}
      />

      {file && bars ? (
        <div className="dz-result">
          <div className="dz-top">
            <button
              className={`mini-play ${previewing ? "live" : ""}`}
              onClick={togglePreview}
              aria-label="Preview sample"
            >
              {previewing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="dz-meta">
              <span className="dz-name">{file.name}</span>
              <span className={`dz-sub ${sweetSpot ? "" : "warn"}`}>
                {fmt(duration)} · {file.size > 1e6 ? `${(file.size / 1e6).toFixed(1)} MB` : `${Math.round(file.size / 1e3)} KB`}
                {" — "}
                {sweetSpot ? "great sample length" : "use 10–30 seconds"}
              </span>
            </div>
            <button
              className="dz-swap"
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
              }}
            >
              Replace
            </button>
          </div>
          <div className="wave" aria-hidden="true">
            {bars.map((v, i) => (
              <i key={i} style={{ height: `${Math.max(6, v * 100)}%`, "--i": i }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="dz-empty">
          <div className="dz-icon">
            <MicIcon />
          </div>
          <p className="dz-title">Drop a voice sample</p>
          <p className="dz-hint">
            10–30 seconds of clean speech · MP3, WAV or M4A
          </p>
          <span className="dz-browse">or browse files</span>
        </div>
      )}

      {error && <p className="dz-error">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Text field with counter + idea chips                                */
/* ------------------------------------------------------------------ */

function Field({ label, value, onChange, placeholder, ideas, minRows, hint }) {
  const count = value.trim().length;
  return (
    <div className="field">
      <div className="field-head">
        <label>{label}</label>
        <span className="counter">{count} chars</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={minRows}
        spellCheck="false"
      />
      {ideas && (
        <div className="chips">
          {ideas.map((s) => (
            <button key={s} className="chip" onClick={() => onChange(s)}>
              {s.length > 42 ? s.slice(0, 42) + "…" : s}
            </button>
          ))}
        </div>
      )}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Custom audio player for the result                                  */
/* ------------------------------------------------------------------ */

function Player({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    setT(0);
    setPlaying(false);
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().catch(() => { });
    } else {
      a.pause();
    }
  };

  const seek = (e) => {
    const a = audioRef.current;
    if (!a || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * dur;
    setT(ratio * dur);
  };

  const pct = dur ? (t / dur) * 100 : 0;

  return (
    <div className="player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDur(e.currentTarget.duration || 0)}
        onEnded={() => setPlaying(false)}
        onError={(e) => console.error("Audio playback error:", e)}
      />
      <button className="pp-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="p-body">
        <div className="p-track" onClick={seek}>
          <div className="p-fill" style={{ width: `${pct}%` }}>
            <span className="p-knob" />
          </div>
        </div>
        <div className="p-times">
          <span className={playing ? "p-eq on" : "p-eq"} aria-hidden="true">
            <i /><i /><i />
          </span>
          <span>
            {fmt(t)} / {fmt(dur)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [file, setFile] = useState(null);
  const [refText, setRefText] = useState("");
  const [genText, setGenText] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | generating | done
  const [statusLine, setStatusLine] = useState(0);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);

  const url = useObjectURL(file);
  const { bars, duration, error } = useWaveform(file);

  const sampleDone = !!(file && bars);
  const transcriptDone = refText.trim().length > 3;
  const scriptDone = genText.trim().length > 0;
  const sampleLengthOk = duration >= 10 && duration <= 30;
  const canGenerate = sampleDone && sampleLengthOk && transcriptDone && scriptDone && phase !== "generating";

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3600);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (phase !== "generating") return;
    const iv = setInterval(() => setStatusLine((i) => (i + 1) % STATUS_LINES.length), 950);
    return () => clearInterval(iv);
  }, [phase]);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setPhase("generating");
    setStatusLine(0);
    setResult(null);
    const started = Date.now();
    try {
      const data = await generateSpeech({
        refAudio: file,
        refText: refText.trim(),
        genText: genText.trim(),
      });
      const elapsed = Date.now() - started;
      if (elapsed < 2400) await new Promise((r) => setTimeout(r, 2400 - elapsed));
      setResult(data);
      setPhase("done");
    } catch (e) {
      setPhase("idle");
      setToast(e.message || "Generation failed — check the backend.");
    }
  };

  const reset = () => {
    setFile(null);
    setRefText("");
    setGenText("");
    setResult(null);
    setPhase("idle");
  };

  const steps = [
    { n: "01", title: "Voice sample", desc: "Clean speech, minimal noise", done: sampleDone },
    { n: "02", title: "Transcript", desc: "Exactly what the sample says", done: transcriptDone },
    { n: "03", title: "Script", desc: "What the clone should say", done: scriptDone },
  ];
  const activeIdx = steps.findIndex((s) => !s.done);

  return (
    <div className="app">
      <AmbientCanvas />
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      <div className="glow glow-c" />

      <header className="top">
        <div className="brand">
          <img src={logoSvg} alt="Echoform logo" className="brand-logo" />
          Echoform
        </div>
        <nav className="top-nav">
          <span className="chip-nav">Zero-shot cloning</span>
          <span className="chip-nav">Studio-grade TTS</span>
          <button className="chip-nav chip-btn" onClick={() => setShowPolicy(true)}>
            Privacy & Terms
          </button>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="badge">
            <span className="pulse" /> Voice Clone Studio
          </div>
          <h1>
            Give your words
            <br />
            <em>someone else&rsquo;s voice.</em>
          </h1>
          <p>
            Drop a short voice sample, paste its transcript, and type anything —
            Echoform speaks it back in that voice.
          </p>
        </section>

        <section className="studio">
          <aside className="rail">
            {steps.map((s, i) => (
              <div
                key={s.n}
                className={`step ${s.done ? "done" : ""} ${i === activeIdx ? "active" : ""}`}
              >
                <span className="step-dot">{s.done ? <CheckIcon /> : s.n}</span>
                <div>
                  <p className="step-title">{s.title}</p>
                  <p className="step-desc">{s.desc}</p>
                </div>
              </div>
            ))}
            <div className="rail-card">
              <p className="rail-card-title">Pro tips</p>
              <ul>
                <li>Record in a quiet room — background music confuses the model.</li>
                <li>The transcript must match the audio word for word.</li>
                <li>Punctuation steers pacing and intonation.</li>
              </ul>
            </div>
          </aside>

          <div className="panel">
            <Dropzone
              file={file}
              setFile={setFile}
              bars={bars}
              duration={duration}
              error={error}
              url={url}
            />

            <Field
              label="Transcript of the sample"
              value={refText}
              onChange={setRefText}
              placeholder="Type exactly what is said in the uploaded audio…"
              minRows={3}
              hint="Word-for-word accuracy matters — this anchors the voice."
            />

            <Field
              label="Text to generate"
              value={genText}
              onChange={setGenText}
              placeholder="Type anything and Echoform will speak it in the cloned voice…"
              minRows={4}
              ideas={SCRIPT_IDEAS}
            />

            <div className="actions">
              <button className="btn-primary" disabled={!canGenerate} onClick={handleGenerate}>
                <MicIcon />
                {phase === "generating" ? "Cloning…" : "Clone this voice"}
              </button>
              <button className="btn-ghost" onClick={reset}>
                Reset
              </button>
            </div>

            {phase === "generating" && (
              <div className="gen-overlay">
                <div className="gen-bars" aria-hidden="true">
                  {Array.from({ length: 48 }).map((_, i) => (
                    <i key={i} style={{ "--i": i }} />
                  ))}
                </div>
                <p className="gen-status">
                  {STATUS_LINES[statusLine]}
                  <span className="dots">
                    <i>.</i>
                    <i>.</i>
                    <i>.</i>
                  </span>
                </p>
              </div>
            )}
          </div>
        </section>

        {result && (
          <section className="result-wrap">
            <div className="result-card">
              <div className="result-head">
                <h2>Your clone is ready</h2>
                {result.message && <span className="result-msg">{result.message}</span>}
              </div>
              <Player src={result.audioUrl} />
              <div className="result-actions">
                <a className="btn-ghost" href={result.audioUrl} download>
                  Download
                </a>
                <button className="btn-ghost" onClick={reset}>
                  Clone another voice
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="foot">
        <p>Echoform · clone voices you have permission to use.</p>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
