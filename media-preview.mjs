import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";

const run = promisify(execFile);
const directory = new URL("./.pck-demo/uploads/", import.meta.url);
const processError = (status, message) =>
  Object.assign(new Error(message), { status });

const thumbnailJobs = new Map();
const thumbnailWorkers = [Promise.resolve(), Promise.resolve()];
let nextThumbnailWorker = 0;

// Called with a validated local filename after Content checks access.
export async function readThumbnail(name) {
  const output = new URL(name + ".thumb-v1.jpg", directory);
  try {
    return await readFile(output);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const pending = thumbnailJobs.get(name);
  if (pending) return pending;
  if (thumbnailJobs.size >= 24) throw processError(503, "Đang tạo ảnh thu nhỏ. Hãy thử lại.");

  const worker = nextThumbnailWorker;
  nextThumbnailWorker = (worker + 1) % thumbnailWorkers.length;
  const job = thumbnailWorkers[worker].then(async () => {
    const source = fileURLToPath(new URL(name, directory));
    const { stdout } = await run(process.env.PCK_FFMPEG_PATH || "ffmpeg", [
      "-nostdin", "-v", "error", "-threads", "1", "-filter_threads", "1",
      "-i", source, "-map", "0:v:0", "-frames:v", "1",
      "-vf", "scale='min(360,iw)':'min(240,ih)':force_original_aspect_ratio=decrease,setsar=1",
      "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", "pipe:1",
    ], { encoding: "buffer", timeout: 6000, maxBuffer: 1024 * 1024, windowsHide: true });
    if (!stdout.length) throw processError(422, "Tệp không có khung hình xem trước.");
    const temp = new URL(".thumbnail-" + randomUUID() + ".jpg", directory);
    try {
      await writeFile(temp, stdout, { flag: "wx" });
      await rename(temp, output);
    } finally {
      await unlink(temp).catch(() => {});
    }
    return stdout;
  }).finally(() => thumbnailJobs.delete(name));
  thumbnailJobs.set(name, job);
  thumbnailWorkers[worker] = job.catch(() => {});
  return job;
}

export async function makePreview(originalKey, video, start, written) {
  const match = /^local-demo\/([0-9a-f-]{36}\.(?:jpg|jpeg|png|mp4))$/i.exec(
    originalKey,
  );
  if (!match) throw processError(409, "Không tìm thấy tệp gốc để tạo preview.");
  const source = fileURLToPath(new URL(match[1], directory));
  const name = randomUUID() + (video ? ".mp4" : ".jpg");
  const output = new URL(name, directory);
  const windows = process.platform === "win32";
  const cwd =
    process.env.PCK_PREVIEW_FONT_DIR ||
    (windows
      ? (process.env.SystemRoot || "C:\\Windows") + "\\Fonts"
      : "/usr/share/fonts/truetype/dejavu");
  const font =
    process.env.PCK_PREVIEW_FONT_FILE ||
    (windows ? "arial.ttf" : "DejaVuSans.ttf");
  if (!/^[\w.-]+$/.test(font))
    throw processError(503, "Tên font tạo preview không hợp lệ.");
  const size = video ? 480 : 640;
  const filter =
    `scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,` +
    `drawtext=fontfile=${font}:text='PCK PREVIEW':fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6:x=(w-tw)/2:y=(h-th)/2`;
  try {
    await run(
      process.env.PCK_FFMPEG_PATH || "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        ...(video ? ["-ss", String(start)] : []),
        "-i",
        source,
        "-map",
        "0:v:0",
        "-an",
        "-map_metadata",
        "-1",
        "-vf",
        filter,
        ...(video
          ? [
              "-t",
              "10",
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-pix_fmt",
              "yuv420p",
              "-movflags",
              "+faststart",
            ]
          : ["-frames:v", "1", "-q:v", "5"]),
        "-abort_on",
        "empty_output_stream",
        fileURLToPath(output),
      ],
      { cwd, timeout: 20000, windowsHide: true },
    );
  } catch (error) {
    await unlink(output).catch(() => {});
    if (
      error.code === "ENOENT" ||
      /drawtext|libx264|font/i.test(error.stderr || "")
    ) {
      throw processError(
        503,
        "Máy chạy Content cần FFmpeg có drawtext và libx264, cùng font để tạo preview.",
      );
    }
    throw processError(
      422,
      video
        ? "Không tạo được video xem trước. Chọn giây bắt đầu nằm trong video và thử lại."
        : "Không tạo được ảnh xem trước từ tệp này.",
    );
  }
  written.push(output);
  return "local-demo/" + name;
}
