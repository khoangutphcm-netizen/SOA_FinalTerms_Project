export async function commerce(path, body) {
  let response;
  let data;
  try {
    response = await fetch(
      new URL(path, "http://127.0.0.1:" + (process.env.COMMERCE_PORT || 3101)),
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + process.env.PCK_INTERNAL_TOKEN,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
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
    const conflict = response.status === 409;
    throw Object.assign(
      new Error(conflict ? data.message : "Commerce tạm thời không khả dụng."),
      {
        status: conflict ? 409 : 503,
      },
    );
  }
  return data;
}
