import { createServer } from "node:http";
import { handleDemo } from "./demo-upload.mjs";
import { query } from "./demo-catalog.mjs";
import { bindHost, servicePort } from "./service-network.mjs";

const token = process.env.PCK_INTERNAL_TOKEN;
if (!token) throw new Error("PCK_INTERNAL_TOKEN is required");

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + token)
    return send(res, 403, { message: "Yêu cầu nội bộ." });
  try {
    const path = req.url.split("?")[0];
    if (path === "/health" && req.method === "POST") {
      await query("CONTENT", "SELECT 1");
      return send(res, 200, {
        status: "ok",
        message: "Content đã kết nối PostgreSQL.",
      });
    }
    if (path.startsWith("/api/demo/"))
      return await handleDemo(req, res, path, send);
    send(res, 404, { message: "Không tìm thấy API." });
  } catch {
    if (res.headersSent) return res.destroy();
    send(res, 503, { message: "Content tạm thời không khả dụng." });
  }
}).listen(servicePort("CONTENT"), bindHost, () =>
  console.log("PCK Content: " + servicePort("CONTENT")),
);
