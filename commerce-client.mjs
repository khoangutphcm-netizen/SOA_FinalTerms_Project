import { serviceHost, servicePort } from "./service-network.mjs";

export async function commerce(path, body, { timeoutMs = 12000 } = {}) {
  let response;
  let data;
  try {
    response = await fetch(
      new URL(path, `http://${serviceHost("COMMERCE")}:${servicePort("COMMERCE")}`),
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + process.env.PCK_INTERNAL_TOKEN,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    data = await response.json();
  } catch {
    throw Object.assign(
      new Error("Commerce đang không phản hồi. Hãy thử lại."),
      { status: 503 },
    );
  }
  if (!response.ok) {
    const clientError = response.status >= 400 && response.status < 500;
    throw Object.assign(
      new Error(clientError ? data.message : "Commerce tạm thời không khả dụng."),
      {
        status: clientError ? response.status : 503,
      },
    );
  }
  return data;
}
