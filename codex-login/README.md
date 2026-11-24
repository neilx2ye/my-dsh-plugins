# @local/codex-login

把「登录 ChatGPT」放进 **设置 → 模型**，给 pi-ai 的 `openai-codex` 路由用。

## 为什么需要它

`openai-codex` 路由是 OAuth 授权（ChatGPT Plus/Pro/Team 订阅额度），没有
API key 可填。DSH 的授权 seam 只在后端注册了 pi-ai 的登录流程，这一版 Web UI
没有对应的按钮，所以 `@local/dsh-llm-pi-ai` 的登录在界面上没有入口。这个 bundle
补的就是那个入口。

## 用法

1. 设置 → 模型 → 「OpenAI Codex (ChatGPT 订阅)」卡片里点 **登录 ChatGPT**。
2. 卡片里出现一次性代码和 `https://auth.openai.com/codex/device`，点「复制代码」
   或选中复制，在浏览器里登录并输入代码。
3. 授权写入后卡片自动变成「已登录 · 账号 … · 授权到期 …」；期间可点「取消」。
4. 之后在对话输入框的模型选择器里挑 `gpt-6.2-sol` 等模型即可消耗这份订阅额度。
5. 「退出登录」删除本地授权记录（不会通知 OpenAI 撤销）。

## 实现

| 文件 | 内容 |
|---|---|
| `index.js` | Host 半：`ctx.authorization.begin()` 跑一次尝试，把 notices / 当前提问存在内存里，用两条精确 Fetch 路由（`/api/codex-login/state`、`/api/codex-login/action`）给页面轮询和操作；退出登录走 `ctx.credentials.deleteRecord('llm-pi-ai/openai-codex')`。 |
| `client.js` | Browser 半：挂 `settings.models.provider-card`（key `llm-pi-ai`），只在 `provider.provider === 'openai-codex'` 时渲染；运行中 1.2s 轮询。 |
| `cordis.patch.yml` | bundle patch，插入一行 `codex-login`。 |

pi-ai 的 Codex 登录会先问「浏览器回调 / 设备码」；Host 直接选 `device_code`，
因为 Harness 页面不可能占住用户机器上的 1455 端口。token 不经过页面：写入由
授权 seam 自己完成，页面只看得到账号 id 和到期时间。

## 安装

从发布地址安装（插件页「添加插件」，或用 CLI）：

```bash
dsh plugin --profile web add \
  https://github.com/neilx2ye/my-dsh-plugins/releases/download/v0.15.0/local-codex-login-0.1.0.tgz
```

也可以把本目录作为本地 bundle 装进 profile（插件页「添加插件」选目录）。

## 已知限制

- 尝试只活在当前 Host 进程里：页面刷新会丢弃正在进行的登录，需要重新点一次。
- 同时只允许一次尝试（授权 seam 的约束），第二个标签页会看到「已经有一个登录在进行中」。
- 没有 revocation：退出登录只删本地记录。