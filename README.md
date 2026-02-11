# 影视资源转存助手（Cloudflare Worker）

一个部署在 Cloudflare Workers 的 Quark 网盘工具：

- 关键词搜索 Quark 分享资源（默认免 Cookie 搜索源）
- 支持多选、框选、批量转存
- 支持目录树选择保存目录
- 支持查看网盘目录树、批量删除
- 支持扫码登录（实验）和手动 Cookie

## 功能概览

1. 搜索资源
- 默认使用趣盘搜（funletu，免 Cookie）。
- 支持切换为你自己的统一搜索 API（可选）。

2. 批量转存
- 搜索结果可多选/框选。
- 点击“保存到网盘”后批量转存到指定目录。
- 自动识别 `?pwd=xxxx` 等提取码参数并提交。

3. 网盘目录管理
- 右侧显示目标目录文件树。
- 支持行点击勾选、框选多选、批量删除。
- 支持目录树下拉选择保存目录。

4. 登录方式
- 手动粘贴 Quark Cookie（稳定方案）。
- 扫码登录（实验方案，接口变动可能导致失效）。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入配置
npm run dev
```

## 环境变量

`.dev.vars` 或 Worker Secret 中使用以下变量：

- `QUARK_COOKIE`：Quark Cookie（页面不填时使用）
- `QUARK_TARGET_FOLDER_ID`：默认目标目录 fid（页面不填目录时使用）
- `QUARK_PR`：默认 `ucpro`
- `QUARK_FR`：默认 `pc`

可选搜索 API：

- `PANSEARCH_API_BASE_URL`：例如 `https://your-api.example.com`
- `PANSEARCH_API_TOKEN`：可选 Bearer Token

推荐把敏感信息放 Secret：

```bash
npx wrangler secret put QUARK_COOKIE
npx wrangler secret put QUARK_TARGET_FOLDER_ID
# 可选
npx wrangler secret put PANSEARCH_API_BASE_URL
npx wrangler secret put PANSEARCH_API_TOKEN
```

## 部署到 Cloudflare

### 方式 A：命令行部署

```bash
npx wrangler login
npx wrangler whoami
npm run deploy
```

### 方式 B：GitHub 一键部署（Deploy to Cloudflare）

先把项目推到 GitHub 仓库后，把下面按钮中的仓库地址替换成你的：

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/<你的用户名>/<你的仓库名>)
```

实际示例（请替换）：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/fyxsky/cf-quark-media-worker)

## API 列表

- `POST /api/search`
```json
{ "keyword": "钢铁侠" }
```

- `POST /api/quark/save-batch`
```json
{ "shareUrls": ["https://pan.quark.cn/s/xxx", "https://pan.quark.cn/s/yyy?pwd=1234"] }
```

- `GET /api/quark/files`
- `GET /api/quark/files?fid=<目录fid>`

- `POST /api/quark/delete`
```json
{ "fids": ["123", "456"] }
```

- `GET /api/health`

- `POST /api/quark/qr/start`
- `POST /api/quark/qr/poll`
```json
{ "token": "...", "sessionCookie": "...", "requestId": "..." }
```

## 注意事项

1. 扫码登录是实验能力
- 依赖非公开网页接口，可能随时变更。
- 建议保留手动 Cookie 作为兜底。

2. 目录参数
- 支持目录 fid 和目录路径（如 `/Videos`）。
- 中文目录已支持编码传输。

3. 合规与风控
- 仅处理你有权限的资源。
- 若触发 Quark 风控，可能需要更新 Cookie 或稍后重试。

## 项目结构

- `src/index.ts`：API 路由
- `src/source.ts`：搜索与详情提取
- `src/quark.ts`：Quark 读写、转存、扫码登录
- `public/index.html`：前端页面
- `wrangler.toml`：Worker 配置
