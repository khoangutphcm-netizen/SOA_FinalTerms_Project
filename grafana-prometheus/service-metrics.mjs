import { createServer } from "node:http";

const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

function escapeLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function labels(values) {
  return "{" + Object.entries(values).map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",") + "}";
}

function routeFor(path) {
  if (path === "/") return "/";
  if (path.startsWith("/api/demo/")) return "/api/demo/*";
  if (path.startsWith("/api/check/")) return "/api/check/*";
  if (path.startsWith("/assets/")) return "/assets/*";
  if (path.startsWith("/demo-assets/")) return "/demo-assets/*";
  if (path.startsWith("/health")) return "/health";
  if (path.startsWith("/metrics")) return "/metrics";
  return "/other";
}

export function createServiceMetrics(service, port) {
  const requests = new Map();
  const durations = new Map();
  const keyFor = (labels) => JSON.stringify(labels);

  function recordRequest(req, res) {
    const started = process.hrtime.bigint();
    res.once("finish", () => {
      const sample = {
        service,
        method: req.method || "UNKNOWN",
        route: routeFor((req.url || "/").split("?")[0]),
        status_code: String(res.statusCode),
      };
      const key = keyFor(sample);
      requests.set(key, { labels: sample, value: (requests.get(key)?.value || 0) + 1 });
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const current = durations.get(key) || { labels: sample, count: 0, sum: 0, buckets: buckets.map(() => 0) };
      current.count++;
      current.sum += seconds;
      buckets.forEach((bound, index) => { if (seconds <= bound) current.buckets[index]++; });
      durations.set(key, current);
    });
  }

  function render() {
    const lines = [
      "# HELP http_server_requests_total Total HTTP requests handled.",
      "# TYPE http_server_requests_total counter",
    ];
    for (const { labels: sample, value } of requests.values())
      lines.push(`http_server_requests_total${labels(sample)} ${value}`);
    lines.push("# HELP http_server_request_duration_seconds HTTP request duration in seconds.", "# TYPE http_server_request_duration_seconds histogram");
    for (const metric of durations.values()) {
      buckets.forEach((bound, index) => lines.push(`http_server_request_duration_seconds_bucket${labels({ ...metric.labels, le: bound })} ${metric.buckets[index]}`));
      lines.push(`http_server_request_duration_seconds_bucket${labels({ ...metric.labels, le: "+Inf" })} ${metric.count}`);
      lines.push(`http_server_request_duration_seconds_sum${labels(metric.labels)} ${metric.sum}`);
      lines.push(`http_server_request_duration_seconds_count${labels(metric.labels)} ${metric.count}`);
    }
    const memory = process.memoryUsage();
    lines.push(
      "# HELP process_resident_memory_bytes Resident memory size in bytes.",
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes{service="${escapeLabel(service)}"} ${memory.rss}`,
      "# HELP nodejs_heap_size_used_bytes Process heap used in bytes.",
      "# TYPE nodejs_heap_size_used_bytes gauge",
      `nodejs_heap_size_used_bytes{service="${escapeLabel(service)}"} ${memory.heapUsed}`,
      "# HELP process_uptime_seconds Process uptime in seconds.",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds{service="${escapeLabel(service)}"} ${process.uptime()}`,
      "",
    );
    return lines.join("\n");
  }

  const server = createServer((_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(render());
  });
  server.listen(port, "0.0.0.0", () => console.log(`PCK metrics ${service}: ${port}`));
  return { recordRequest, server };
}
