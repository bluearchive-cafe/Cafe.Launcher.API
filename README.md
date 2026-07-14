# Cafe Launcher API

Cafe Launcher 的 Cloudflare Worker API。目前提供 GitHub Releases 代理，供桌面启动器检查自身更新。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/launcher/releases` | 返回 `bluearchive-cafe/Cafe.Launcher.Avalonia_Release` 的全部发布版本与下载文件 |
| `GET` | `/` | OpenAPI 文档 |

发布列表在 Cloudflare Cache API 中缓存 5 分钟。查询字符串不会产生独立缓存项。

生产域名：`api-cafe-launcher.saibamidori.com`

## 本地开发

需要 Node.js 22。复制 `.dev.vars.example` 为 `.dev.vars`，并为 `GITHUB_TOKEN` 填入可读取发布仓库的 GitHub Token。

```powershell
npm ci
npm run typecheck
npm test
npm run dev
```

修改 Wrangler 绑定后运行 `npm run cf-typegen`，同步更新 `worker-configuration.d.ts`。

## 部署

推送或提交针对 `main` 的 Pull Request 时，GitHub Actions 会运行类型检查和 Workers 集成测试。推送到 `main` 且验证通过后，工作流执行 `npm run deploy`。

部署工作流需要配置以下 GitHub Actions 仓库 Secret：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

生产环境的 `GITHUB_TOKEN` 使用 `wrangler secret put GITHUB_TOKEN` 配置，不写入仓库。

## 源代码

本服务为闭源内部项目，源代码不向公众发布。
