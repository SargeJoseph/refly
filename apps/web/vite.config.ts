import { defineConfig, searchForWorkspaceRoot, UserConfig } from "vite"
import { sentryVitePlugin } from "@sentry/vite-plugin"
import react from "@vitejs/plugin-react"
import path from "path"
import postcss from "./postcss.config"
import { vitePluginForArco } from "@refly/arco-vite-plugin-react"
import tsconfigPaths from "vite-tsconfig-paths"
import { codeInspectorPlugin } from "code-inspector-plugin"

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tsconfigPaths(),
      vitePluginForArco({
        theme: "@arco-themes/react-refly-ai",
        filePatterns: [
          "apps/web/src",
          "apps/extension-wxt/src",
          "packages/ai-workspace-common/src",
        ],
      }),
      codeInspectorPlugin({
        bundler: "vite",
        editor: "code",
      }),
      ...(process.env.SENTRY_AUTH_TOKEN
        ? [
            sentryVitePlugin({
              org: "refly-ai",
              project: "web",
              authToken: process.env.SENTRY_AUTH_TOKEN,
              errorHandler: err => console.warn(err),
            }),
          ]
        : []),
    ],
    css: {
      postcss,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@refly-packages/ai-workspace-common": path.resolve(
          __dirname,
          "../../packages/ai-workspace-common/src",
        ),
        "@refly/utils": path.resolve(__dirname, "../../packages/utils/src"),
      },
    },
    build: {
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      sourcemap: true,
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
    },
    // esbuild: {
    //   drop: ["console", "debugger"],
    // },
    server: {
      fs: {
        strict: false, // TODO：这里需要添加限制，allow 需要处理，目前先临时解决
        allow: [searchForWorkspaceRoot(process.cwd())],
      },
    },
  } as UserConfig
})
