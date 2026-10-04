import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    env: {
      JWT_SECRET: "a".repeat(32),
      DATABASE_URL: "postgres://u:p@h:5432/d",
      DIRECT_URL: "postgres://u:p@h:5432/d",
      TELEGRAM_BOT_TOKEN: "123456:ABC-DEF",
      TELEGRAM_BOT_USERNAME: "BookoraBot",
      APP_URL: "https://example.com",
      BOT_USERNAME: "BookoraBot",
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
