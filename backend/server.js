import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("audio/")) {
      return cb(new Error("Only audio files are allowed"));
    }
    cb(null, true);
  },
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/tts", upload.single("refAudio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "refAudio file required" });
    const { refText, genText } = req.body;
    if (!refText || !genText) return res.status(400).json({ error: "refText and genText required" });

    import("node:http").then(async (http) => {
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const url = new URL(`${AI_SERVICE_URL}/generate`);

      const reqOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        timeout: 30 * 60 * 1000,
      };

      const aiReq = http.request(reqOptions, (aiRes) => {
        let responseData = "";
        aiRes.on("data", (chunk) => (responseData += chunk));
        aiRes.on("end", async () => {
          if (aiRes.statusCode < 200 || aiRes.statusCode >= 300) {
            let detail = responseData;
            try {
              const parsed = JSON.parse(responseData);
              detail = parsed.detail || parsed.error || responseData;
            } catch {
            }
            return res.status(aiRes.statusCode === 400 ? 400 : 502).json({
              error: detail,
            });
          }

          try {
            const { filename } = JSON.parse(responseData);
            const fileUrl = new URL(`${AI_SERVICE_URL}/audio/${filename}`);
            http.get(fileUrl, (fileRes) => {
              const fileChunks = [];
              fileRes.on("data", (c) => fileChunks.push(c));
              fileRes.on("end", () => {
                fs.writeFileSync(path.join(uploadDir, filename), Buffer.concat(fileChunks));
                res.json({ audioUrl: `/uploads/${filename}`, message: "done" });
              });
            }).on("error", (err) => res.status(500).json({ error: err.message }));
          } catch (e) {
            res.status(500).json({ error: "Failed to parse AI service response", detail: responseData });
          }
        });
      });

      aiReq.on("error", (err) => {
        console.error("AI service request error:", err);
        res.status(500).json({ error: err.message });
      });

      aiReq.setTimeout(30 * 60 * 1000);

      const CRLF = "\r\n";
      let bodyPrefix = "";
      bodyPrefix += `--${boundary}${CRLF}`;
      bodyPrefix += `Content-Disposition: form-data; name="refText"${CRLF}${CRLF}${refText}${CRLF}`;
      bodyPrefix += `--${boundary}${CRLF}`;
      bodyPrefix += `Content-Disposition: form-data; name="genText"${CRLF}${CRLF}${genText}${CRLF}`;
      bodyPrefix += `--${boundary}${CRLF}`;
      bodyPrefix += `Content-Disposition: form-data; name="refAudio"; filename="${req.file.originalname}"${CRLF}`;
      bodyPrefix += `Content-Type: ${req.file.mimetype || "audio/wav"}${CRLF}${CRLF}`;

      const bodySuffix = `${CRLF}--${boundary}--${CRLF}`;

      aiReq.write(Buffer.from(bodyPrefix, "utf8"));
      aiReq.write(req.file.buffer);
      aiReq.write(Buffer.from(bodySuffix, "utf8"));
      aiReq.end();
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
