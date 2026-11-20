import { readFile } from "node:fs/promises";
import { withDb } from "./demo-catalog.mjs";

try {
  const sql = await readFile(
    new URL("./migrations/06_content_post_management.sql", import.meta.url),
    "utf8",
  );
  await withDb("CONTENT", async (client) => {
    await client.query("SET lock_timeout = '5s'");
    await client.query(sql);
  });
  console.log("Content: quản lý bài đã sẵn sàng.");
} catch (error) {
  console.error(
    "Migration quản lý bài thất bại" +
      (error.code ? " (" + error.code + ")" : "") +
      ".",
  );
  process.exitCode = 1;
}
