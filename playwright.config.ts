import { defineConfig } from "@playwright/test";

const oracleEnabled = process.env.RUN_4DEVS_ORACLE === "1";

export default defineConfig({
  testDir: ".",
  testMatch: oracleEnabled ? ["tests/oracle/**/*.spec.ts"] : [],
  timeout: 30_000,
  use: {
    baseURL: "https://www.4devs.com.br",
    trace: "retain-on-failure"
  }
});
