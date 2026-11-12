# Cafe Launcher Backend

Cafe Launcher 的 Cloudflare Worker 后端，部署名 `cafe-launcher-backend`。目前提供 GitHub Releases 代理与 Blue Archive 公告索引转换，供桌面启动器检查更新、读取更新说明和显示公告。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/launcher/releases` | 旧版接口，返回 `bluearchive-cafe/Cafe.Launcher.Avalonia_Release` 的全部发布版本、下载文件与 SHA-256 校验值 |
| `GET` | `/api/v2/launcher/releases` | 当前启动器使用的接口，返回 `bluearchive-cafe/Cafe.Launcher.Avalonia` 的发布版本、下载文件与 SHA-256 校验值，并过滤草稿和未上传完成的资产；每个文件附带 `mirrorUrl`（`DOWNLOAD_MIRROR_BASE_URL` 拼出的镜像地址），客户端仍以 `url` 作为回退 |
| `GET` | `/api/v2/launcher/releases/latest?channel=stable\|beta` | 官网等公开下载页使用：按 SemVer 返回该通道最新的已发布版本（`stable` 取最新非预发布，`beta` 取最新预发布，默认 `stable`）、发布日期与各平台文件的 `url`、`mirrorUrl` 和 `checksum`；草稿、未上传完成的资产与无可用文件的版本会被跳过，无匹配版本返回 404 |
| `GET` | `/api/v2/launcher/releases/{version}/notes` | 按裸版本号（不带 `v` 前缀）返回单个已发布版本的更新说明 Markdown（`releaseNotes`）；草稿与不存在的版本返回 404，让客户端避免匿名直连 GitHub 被限流 |
| `GET` | `/api/launcher/operations/resource` | 将 Blue Archive 公告索引转换为启动器兼容的公告与 Banner 响应 |
| `GET` | `/` | OpenAPI 文档 |

发布列表、最新版本、版本更新说明和公告资源在 Cloudflare Cache API 中缓存 5 分钟。最新版本按 `channel` 分别缓存，两个通道之外的其他查询字符串不会产生独立缓存项。

生产域名：`api.cafe-launcher.saibamidori.com`（旧域名 `api-cafe-launcher.saibamidori.com` 保留兼容）。两个域名都由 `wrangler.jsonc` 的 custom domain 路由绑定。

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

推送或提交针对 `main` 的 Pull Request 时，`.github/workflows/deploy.yml` 会运行类型检查和 Workers 集成测试；推送到 `main`（或手动触发 `workflow_dispatch`）且验证通过后，工作流执行 `npm run deploy`。

该工作流当前在 GitHub 仓库侧被手动禁用（`disabled_manually`），推送不会触发测试或部署。需要自动部署时先在 Actions 中恢复工作流，否则在本地运行 `npm run deploy`。

部署工作流需要配置以下 GitHub Actions 仓库 Secret：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

生产环境的 `GITHUB_TOKEN` 使用 `wrangler secret put GITHUB_TOKEN` 配置，不写入仓库。

## 源代码

本服务源代码已公开，并采用 [MIT License](./LICENSE)。桌面启动器源码位于 [bluearchive-cafe/Cafe.Launcher.Avalonia](https://github.com/bluearchive-cafe/Cafe.Launcher.Avalonia)。
