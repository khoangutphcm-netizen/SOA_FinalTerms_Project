import { createServer } from "node:http";
import { connect } from "./demo-accounts.mjs";
import { identity } from "./identity-handlers.mjs";
import { community } from "./community-handlers.mjs";

export { identity } from "./identity-handlers.mjs";

export function servicePort(service) {
  return Number(
    process.env[service + "_PORT"] ||
      { COMMERCE: 3101, CONTENT: 3102, IDENTITY: 3103, COMMUNITY: 3104 }[
        service
      ],
  );
}

export async function callService(
  service,
  operation,
  input = {},
  { timeoutMs = 25000 } = {},
) {
  let response;
  let data;
  try {
    response = await fetch(
      "http://127.0.0.1:" + servicePort(service) + "/" + operation,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.PCK_INTERNAL_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    data = await response.json();
  } catch {
    throw Object.assign(new Error(service + " đang không phản hồi."), {
      status: 503,
    });
  }
  if (!response.ok)
    throw Object.assign(new Error(data.message), { status: response.status });
  return data;
}

export function startDataService(service) {
  const handlers = {
    health: async (query) => {
      await query("SELECT 1");
      return { status: "ok", message: service + " đã kết nối PostgreSQL." };
    },
    ...{ IDENTITY: identity, COMMUNITY: community }[service],
  };
  const token = process.env.PCK_INTERNAL_TOKEN;
  if (!token) throw new Error("PCK_INTERNAL_TOKEN is required");
  createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization !== "Bearer " + token)
      return send(403, { message: "Yêu cầu nội bộ." });
    const operation = req.url.slice(1);
    if (req.method !== "POST" || !Object.hasOwn(handlers, operation))
      return send(404, { message: "Không tìm thấy API." });
    let client;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        if ((size += chunk.length) > 65536) {
          req.resume();
          return send(413, { message: "Yêu cầu quá lớn." });
        }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      client = connect(service);
      client.on("error", () => {});
      await client.connect();
      const query = async (sql, params) =>
        (await client.query(sql, params)).rows;
      send(200, await handlers[operation](query, input));
    } catch (error) {
      send(error.status || 503, {
        message: error.status
          ? error.message
          : "Không xử lý được yêu cầu tại " + service + ".",
      });
    } finally {
      await client?.end().catch(() => {});
    }
  }).listen(servicePort(service), "127.0.0.1", () =>
    console.log("PCK " + service + ": " + servicePort(service)),
  );
}
