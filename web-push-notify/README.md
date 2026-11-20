# 任务完成通知（Web Push）

DSH 任务结束时，通过 **Push API + Notifications API + Service Worker** 弹出系统通知。关闭标签页后仍然有效；页面在前台可见时保持安静。

## 使用

1. 刷新一次 Harness 页面。
2. 点击侧栏底部的 **任务通知**（铃铛）。
3. 点 **开启完成通知**，在浏览器权限提示中允许通知。
4. 可点 **发送测试通知** 验证推送链路（即使页面在前台也会显示）。

通知在会话的主回合（turn）结束时发送，标题取自会话标题；子智能体会话不会通知。

## 工作方式

- 宿主端生成并持久化一套 VAPID P-256 身份，浏览器用其公钥通过 `pushManager.subscribe()` 订阅。
- 主回合结束（`api-session/status` 由运行转为空闲）时，宿主按 RFC 8291（`aes128gcm`）加密负载，按 RFC 8292 签名并推送到浏览器推送服务（Chrome 为 FCM）。
- 根作用域 Service Worker（`/sw.js`）收到 `push` 后调用 `registration.showNotification()`；点击通知会聚焦已打开的 Harness 页面。
- 若浏览器无法取得推送订阅，页面会通过 `/api/web-push-notify/events`（SSE）接收同一事件，并在标签页不可见时让 Service Worker 显示通知。
- 只要存在推送订阅，就只走 Web Push；页面可见时由 Service Worker 抑制通知，避免重复打扰。

## 数据

- `$DSH_HOME/web-push-notify/vapid.json`：VAPID 私钥（0600），不要删除，否则已订阅设备会失效。
- `$DSH_HOME/web-push-notify/subscriptions.json`：各浏览器的推送端点（0600）。推送服务返回 404/410 时会自动清理。

可选配置：`subject` 必须是 `mailto:` 或 `https:` URI（VAPID 联系信息），默认 `mailto:dsh@localhost`。

## 文件

- `index.js`：宿主端（密钥、订阅、加密推送、SSE、事件监听）。
- `sw.js`：Service Worker（`push`、`notificationclick`、页面回退消息）。
- `client.js`：侧栏铃铛与权限/订阅/测试界面。