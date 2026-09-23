# Cafe Launcher API

Cloudflare Worker（Hono + chanfana，运行在 workerd 上）为 Cafe Launcher 桌面端提供 GitHub Releases 代理，并把 Blue Archive 公告索引转换为启动器兼容的公告与 Banner 响应。

## 结构与契约

- `src/index.ts` 是唯一的路由注册处；新增或调整路由时同步更新 `README.md` 的接口表。
- 路由：`/api/launcher/releases`（旧版，读取 `bluearchive-cafe/Cafe.Launcher.Avalonia_Release`）、`/api/v2/launcher/releases`（当前启动器使用，读取 `bluearchive-cafe/Cafe.Launcher.Avalonia`，过滤草稿与未上传完成的资产）、`/api/launcher/operations/resource`；`/` 提供 OpenAPI 文档。
- 响应通过 Cloudflare Cache API 缓存 5 分钟，缓存键剔除查询字符串（`src/endpoints/launcherReleases.ts` 中的 `CACHE_MAX_AGE`）。发布列表按分页拉取 GitHub（每页 100 条）。
- `GITHUB_TOKEN` 是 Worker secret，生产环境用 `wrangler secret put GITHUB_TOKEN` 配置，本地放在 `.dev.vars`；任何情况下都不要提交真实值。

## 命令

| 命令 | 用途 |
|------|------|
| `npm ci` | 安装依赖 |
| `npm run typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm test` | 在 workerd 中运行 vitest 测试 |
| `npm run dev` | 本地启动 Worker |
| `npm run deploy` | 部署到 Cloudflare |
| `npm run cf-typegen` | 修改 `wrangler.jsonc` 绑定后重新生成 `worker-configuration.d.ts` |

## 部署

`.github/workflows/deploy.yml` 在 Pull Request 和推送到 `main` 时执行类型检查与测试，随后在推送到 `main` 或 `workflow_dispatch` 时部署。需要仓库 Secret：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。生产域名 `api-cafe-launcher.saibamidori.com` 由 `wrangler.jsonc` 的 custom domain 路由绑定。

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
