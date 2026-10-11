import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // The Next.js tsconfig sets `jsx: "preserve"`. The render regression suites
  // mount real components with react-dom/server, so JSX has to be transformed
  // here (esbuild's automatic runtime).
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    env: {
      JWT_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
