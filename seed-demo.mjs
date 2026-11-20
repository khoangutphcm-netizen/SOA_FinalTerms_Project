import { seed } from "./demo-accounts.mjs";
try {
  await seed();
} catch (error) {
  console.error(
    "Không thể tạo tài khoản demo" +
      (error.code ? " (" + error.code + ")" : "") +
      ".",
  );
  process.exitCode = 1;
}
