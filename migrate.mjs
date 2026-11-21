import { readFile } from "node:fs/promises";
import { Client } from "pg";

const plans = [
  ["IDENTITY", "01_identity.sql"],
  ["CONTENT", "02_content.sql"],
  ["COMMERCE", "03_commerce.sql"],
  ["COMMUNITY", "04_community.sql"],
];
const apply = process.argv.includes("--apply");
const targets = new Set();
const clients = [];

async function inspect(client) {
  const { rows } = await client.query(`
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ORDER BY c.relname`);
  return rows.map((row) => row.name);
}

try {
  for (const [name, filename] of plans) {
    const connectionString = process.env[name + "_DATABASE_URL"];
    if (!connectionString) throw new Error(name + ": thiếu cấu hình.");
    const url = new URL(connectionString);
    const target =
      url.hostname.replace("-pooler.", ".") +
      ":" +
      (url.port || "5432") +
      decodeURIComponent(url.pathname);
    if (targets.has(target))
      throw new Error(name + ": dùng chung DB với service khác.");
    targets.add(target);

    const sql = await readFile(
      new URL("./migrations/" + filename, import.meta.url),
      "utf8",
    );
    const expected = [...sql.matchAll(/^CREATE\s+TABLE\s+(\w+)/gm)]
      .map((match) => match[1])
      .sort();
    if (!expected.length || !/^BEGIN;[\s\S]+COMMIT;\s*$/.test(sql.trim())) {
      throw new Error(name + ": file khởi tạo không đúng định dạng.");
    }
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 8000,
      statement_timeout: 20000,
    });
    client.on("error", () => {});
    clients.push({ name, client, sql, expected });
  }

  for (const job of clients) {
    await job.client.connect();
    job.actual = await inspect(job.client);
    job.matches = job.expected.every((table) => job.actual.includes(table));
    console.log(
      job.name +
        ": " +
        (job.matches
          ? "đủ bảng dự kiến (chưa kiểm tra ràng buộc)"
          : job.actual.length
            ? "schema đã có đối tượng, cần kiểm tra thủ công"
            : "DB trống"),
    );
  }

  if (clients.some((job) => job.actual.length && !job.matches)) {
    throw new Error(
      "Có DB không trống và chưa đủ bảng. Chưa áp dụng thay đổi.",
    );
  }

  if (apply) {
    for (const { name, client, sql, expected, matches } of clients) {
      if (matches) continue;
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL search_path TO public");
        await client.query("SELECT pg_advisory_xact_lock(246810, 1)");
        if ((await inspect(client)).length)
          throw new Error(name + ": DB không còn trống.");
        await client.query(sql.trim().replace(/^BEGIN;|COMMIT;$/g, ""));
        const actual = await inspect(client);
        if (!expected.every((table) => actual.includes(table)))
          throw new Error(name + ": chưa đủ bảng.");
        await client.query("COMMIT");
        console.log(name + ": đã tạo " + expected.length + " bảng.");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  }
} catch (error) {
  // Do not print connection URLs or raw driver errors.
  console.error(
    error.code
      ? "Kiểm tra PostgreSQL thất bại (" + error.code + ")."
      : error instanceof TypeError
        ? "Cấu hình kết nối không hợp lệ."
        : /^(IDENTITY|CONTENT|COMMERCE|COMMUNITY|Có DB)/.test(error.message)
          ? error.message
          : "Kiểm tra PostgreSQL thất bại.",
  );
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map(({ client }) => client.end().catch(() => {})));
}
