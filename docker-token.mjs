import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const path = "/run/pck/internal-token";
if (process.argv[2] === "--create") {
  try {
    writeFileSync(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o444 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
} else {
  process.env.PCK_INTERNAL_TOKEN = readFileSync(path, "utf8").trim();
}
