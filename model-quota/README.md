# @local/model-quota

输入框下方（`conversation.composer.dock`）多一个胶囊，显示 **ChatGPT / Codex 订阅额度**：
`Codex 剩 88% · 周 95%`。

- 数据来源：Host 端用 `llm-pi-ai/openai-codex` 记录里的授权调
  `GET https://chatgpt.com/backend-api/codex/usage`（Codex 客户端同一个接口），
  只回百分比、重置时间、方案名，token 不出 Host。
- **授权自动续期**：access token 到期，或用量接口回 401/403 时，用记录里的
  refresh token 走 `auth.openai.com/oauth/token` 换一份新授权（与 pi-ai / Codex CLI
  相同流程），并在凭证锁内写回；只要 refresh token 还有效就不会再让你重新登录。
  只有续期本身被拒时才显示「重新登录」。
- 5 小时窗口在左、每周窗口在右；剩余 <20% 变黄，用尽变红。
- **点击**胶囊打开面板：每个窗口的剩余/已用百分比、进度条、**距重置的实时倒计时**
  （每秒走）和重置时刻、方案名、本次读取时间；面板里「立即刷新」强制重读。
  数据默认 60s 缓存（`config.cacheMs` 可调），面板开着时倒计时每秒更新。
- 没有公开额度接口的路由（阿里云 MaaS 等）不显示内容；未登录 Codex 时也不占位置。
- 续期逻辑由 `test/refresh.test.mjs` 覆盖（到期续期、401 重试、续期失败、并发写入、失败缓存）：
  `node --test test/refresh.test.mjs`。

## 安装

```bash
dsh plugin --profile web add \
  https://github.com/neilx2ye/my-dsh-plugins/releases/download/v0.20.0/local-model-quota-0.1.0.tgz
```

未登录 Codex 时胶囊不占位，所以可以和 `@local/codex-login` 一起装。
