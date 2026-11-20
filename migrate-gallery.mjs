import { readFile } from "node:fs/promises";
import { withDb } from "./demo-catalog.mjs";

try {
  const sql = await readFile(
    new URL("./migrations/05_content_gallery.sql", import.meta.url),
    "utf8",
  );
  await withDb("CONTENT", async (client) => {
    await client.query("SET lock_timeout = '5s'");
    await client.query(sql);
  });
  console.log("Content: đã sẵn sàng cho gallery.");
} catch (error) {
  console.error(
    "Migration gallery thất bại" +
      (error.code ? " (" + error.code + ")" : "") +
      ".",
  );
  process.exitCode = 1;
}
