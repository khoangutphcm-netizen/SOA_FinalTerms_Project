import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { byteRange, rangeHeaders } from "./media-range.mjs";

const run = promisify(execFile);
const processError = (status, message) =>
  Object.assign(new Error(message), { status });

async function transform(bytes, video, { start, args, cwd, timeout, maxBuffer }) {
  // FFmpeg must be able to seek even if the MP4 index is at the end of the file.
  const path = "/" + randomUUID();
  const input = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== path) return res.writeHead(404).end();
    const range = byteRange(req.headers.range, bytes.length);
    res.writeHead(range?.status ?? 416, {
      "Accept-Ranges": "bytes", ...rangeHeaders(range, bytes.length),
    }).end(range ? bytes.subarray(range.first, range.first + range.length) : undefined);
  });
  input.listen(0, "127.0.0.1");
  try {
    await once(input, "listening");
    const { stdout } = await run(process.env.PCK_FFMPEG_PATH || "ffmpeg", [
      "-nostdin", "-v", "error", "-protocol_whitelist", "http,tcp",
      ...(start ? ["-ss", String(start)] : []),
      ...(video ? ["-f", "mov", "-enable_drefs", "0"] : ["-f", "image2pipe"]),
      "-i", `http://127.0.0.1:${input.address().port}${path}`,
      "-map", "0:v:0", "-an", "-map_metadata", "-1",
      ...args, "-abort_on", "empty_output_stream", "pipe:1",
    ], { cwd, encoding: "buffer", timeout, maxBuffer, windowsHide: true });
    if (!stdout.length) throw processError(422, "Tệp không có khung hình xem trước.");
    return stdout;
  } finally {
    input.close();
    input.closeAllConnections();
  }
}

const thumbnailJobs = new Map();
const thumbnailWorkers = [Promise.resolve(), Promise.resolve()];
let nextThumbnailWorker = 0;

export function makeThumbnail(key, load, video) {
  const pending = thumbnailJobs.get(key);
  if (pending) return pending;
  if (thumbnailJobs.size >= 24) throw processError(503, "Đang tạo ảnh thu nhỏ. Hãy thử lại.");
  const worker = nextThumbnailWorker;
  nextThumbnailWorker = (worker + 1) % thumbnailWorkers.length;
  const job = thumbnailWorkers[worker].then(async () => {
    const bytes = await load();
    return transform(bytes, video, {
      timeout: 10000, maxBuffer: 1024 * 1024,
      args: ["-frames:v", "1",
        "-vf", "scale='min(360,iw)':'min(240,ih)':force_original_aspect_ratio=decrease,setsar=1",
        "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe"],
    });
  }).finally(() => thumbnailJobs.delete(key));
  thumbnailJobs.set(key, job);
  thumbnailWorkers[worker] = job.catch(() => {});
  return job;
}

export async function makePreview(bytes, video, start) {
  const windows = process.platform === "win32";
  const cwd = process.env.PCK_PREVIEW_FONT_DIR ||
    (windows ? (process.env.SystemRoot || "C:\\Windows") + "\\Fonts" : "/usr/share/fonts/truetype/dejavu");
  const font = process.env.PCK_PREVIEW_FONT_FILE || (windows ? "arial.ttf" : "DejaVuSans.ttf");
  if (!/^[\w.-]+$/.test(font)) throw processError(503, "Tên phông chữ tạo bản xem trước không hợp lệ.");
  const size = video ? 480 : 640;
  const filter =
    `scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,` +
    `drawtext=fontfile=${font}:text='PCK PREVIEW':fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6:x=(w-tw)/2:y=(h-th)/2`;
  try {
    return await transform(bytes, video, {
      start, cwd, timeout: 20000, maxBuffer: 10 * 1024 * 1024,
      args: ["-vf", filter, ...(video
        ? ["-t", "10", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
          "-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"]
        : ["-frames:v", "1", "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe"])],
    });
  } catch (error) {
    if (error.code === "ENOENT" || /drawtext|libx264|font/i.test(error.stderr || ""))
      throw processError(503, "Service Content cần FFmpeg có drawtext và libx264, cùng phông chữ để tạo bản xem trước.");
    throw processError(422, video
      ? "Không tạo được video xem trước. Chọn giây bắt đầu nằm trong video và thử lại."
      : "Không tạo được ảnh xem trước từ tệp này.");
  }
}
