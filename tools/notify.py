#!/usr/bin/env python3
"""把消息推送到微信（个人微信或企业微信）。

支持 5 种通道，任选其一，配置好即可用：

  wework       企业微信群机器人 webhook（最省事，需企业微信）
  wework-app   企业微信自建应用消息（可开"微信插件"直接在微信里收到）
  serverchan   Server酱 / 方糖（个人微信，关注公众号）
  pushplus     PushPlus（个人微信，关注公众号）
  wxpusher     WxPusher（个人微信，关注公众号）

用法：
  python3 tools/notify.py -t "标题" -c "正文"
  echo "正文" | python3 tools/notify.py -t "标题"
  python3 tools/notify.py -c "正文" --channel pushplus
  python3 tools/notify.py --check          # 检查当前配置

配置读取顺序（后者覆盖前者）：
  1. 本文件同目录的 notify.env
  2. ~/.config/dsh/notify.env
  3. 进程环境变量

配置项见 tools/notify.env.example
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_FILES = [
    os.path.join(HERE, "notify.env"),
    os.path.expanduser("~/.config/dsh/notify.env"),
]

TIMEOUT = 15


# ---------------------------------------------------------------- 配置

def load_config() -> dict:
    cfg = {}
    for path in ENV_FILES:
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                if key.startswith("export "):
                    key = key[len("export "):].strip()
                val = val.strip().strip('"').strip("'")
                cfg[key] = val
    cfg.update(os.environ)
    return cfg


def need(cfg: dict, *keys: str) -> list:
    missing = [k for k in keys if not cfg.get(k)]
    return missing


# ---------------------------------------------------------------- HTTP

def post(url: str, payload: dict, form: bool = False) -> tuple:
    if form:
        body = urllib.parse.urlencode(payload).encode()
        ctype = "application/x-www-form-urlencoded"
    else:
        body = json.dumps(payload).encode()
        ctype = "application/json"
    req = urllib.request.Request(
        url, data=body, method="POST", headers={"Content-Type": ctype}
    )
    return _send(req)


def get_json(url: str) -> tuple:
    req = urllib.request.Request(url, method="GET")
    return _send(req)


def _send(req) -> tuple:
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            text = resp.read().decode("utf-8", "replace")
            return resp.status, text
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except Exception as exc:  # 网络不可达 / 超时 / DNS
        return 0, f"{type(exc).__name__}: {exc}"


# ---------------------------------------------------------------- 各通道

def send_wework(cfg, title, content):
    url = cfg.get("WEWORK_WEBHOOK_URL")
    if not url:
        return False, "缺少 WEWORK_WEBHOOK_URL（群机器人 webhook 地址）"
    md = f"**{title}**\n\n{content}" if title else content
    status, text = post(url, {"msgtype": "markdown", "markdown": {"content": md}})
    ok = status == 200 and '"errcode":0' in text.replace(" ", "")
    return ok, f"HTTP {status} {text}"


def send_wework_app(cfg, title, content):
    missing = need(cfg, "WEWECOM_CORPID", "WEWECOM_CORPSECRET", "WEWECOM_AGENTID")
    if missing:
        return False, "缺少配置: " + ", ".join(missing)
    qs = urllib.parse.urlencode(
        {"corpid": cfg["WEWECOM_CORPID"], "corpsecret": cfg["WEWECOM_CORPSECRET"]}
    )
    status, text = get_json(f"https://qyapi.weixin.qq.com/cgi-bin/gettoken?{qs}")
    try:
        token = json.loads(text).get("access_token")
    except Exception:
        token = None
    if not token:
        return False, f"获取 access_token 失败: HTTP {status} {text}"

    msg = f"{title}\n{content}".strip()
    payload = {
        "touser": cfg.get("WEWECOM_TOUSER") or "@all",
        "msgtype": "text",
        "agentid": int(cfg["WEWECOM_AGENTID"]),
        "text": {"content": msg},
    }
    status, text = post(
        f"https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={token}",
        payload,
    )
    ok = status == 200 and '"errcode":0' in text.replace(" ", "")
    return ok, f"HTTP {status} {text}"


def send_serverchan(cfg, title, content):
    key = cfg.get("SERVERCHAN_SENDKEY")
    if not key:
        return False, "缺少 SERVERCHAN_SENDKEY"
    url = f"https://sctapi.ftqq.com/{key}.send"
    status, text = post(
        url,
        {"title": (title or "通知")[:32], "desp": content},
        form=True,
    )
    ok = status == 200 and '"code":0' in text.replace(" ", "")
    return ok, f"HTTP {status} {text}"


def send_pushplus(cfg, title, content):
    token = cfg.get("PUSHPLUS_TOKEN")
    if not token:
        return False, "缺少 PUSHPLUS_TOKEN"
    status, text = post(
        "https://www.pushplus.plus/send",
        {
            "token": token,
            "title": (title or "通知")[:100],
            "content": content,
            "template": "markdown",
        },
    )
    ok = status == 200 and '"code":200' in text.replace(" ", "")
    return ok, f"HTTP {status} {text}"


def send_wxpusher(cfg, title, content):
    missing = need(cfg, "WXPUSHER_APP_TOKEN")
    if missing:
        return False, "缺少配置: " + ", ".join(missing)
    uids = [u.strip() for u in cfg.get("WXPUSHER_UIDS", "").split(",") if u.strip()]
    payload = {
        "appToken": cfg["WXPUSHER_APP_TOKEN"],
        "content": content,
        "summary": (title or "通知")[:99],
        "contentType": 3,  # 3 = markdown
    }
    if uids:
        payload["uids"] = uids
    status, text = post("https://wxpusher.zjiecode.com/api/send/message", payload)
    ok = status == 200 and '"code":1000' in text.replace(" ", "")
    return ok, f"HTTP {status} {text}"


CHANNELS = {
    "wework": send_wework,
    "wework-app": send_wework_app,
    "serverchan": send_serverchan,
    "pushplus": send_pushplus,
    "wxpusher": send_wxpusher,
}


# ---------------------------------------------------------------- main

def describe(cfg) -> str:
    ch = cfg.get("NOTIFY_CHANNEL", "(未设置)")
    keys = {
        "wework": ["WEWORK_WEBHOOK_URL"],
        "wework-app": ["WEWECOM_CORPID", "WEWECOM_CORPSECRET", "WEWECOM_AGENTID"],
        "serverchan": ["SERVERCHAN_SENDKEY"],
        "pushplus": ["PUSHPLUS_TOKEN"],
        "wxpusher": ["WXPUSHER_APP_TOKEN", "WXPUSHER_UIDS"],
    }
    lines = [f"当前通道: {ch}"]
    if ch in keys:
        for k in keys[ch]:
            v = cfg.get(k, "")
            shown = (v[:6] + "…" + v[-4:]) if len(v) > 12 else (v or "(空)")
            lines.append(f"  {k} = {shown}")
    else:
        lines.append("  ⚠️ 请在 notify.env 里设置 NOTIFY_CHANNEL")
    lines.append("配置文件: " + ", ".join(p for p in ENV_FILES if os.path.isfile(p)) or "无")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="推送消息到微信")
    ap.add_argument("-t", "--title", default="", help="标题")
    ap.add_argument("-c", "--content", default=None, help="正文（省略则读 stdin）")
    ap.add_argument("--channel", default=None, help="临时指定通道")
    ap.add_argument("--check", action="store_true", help="只检查配置，不发送")
    args = ap.parse_args()

    cfg = load_config()

    if args.check:
        print(describe(cfg))
        return 0

    content = args.content
    if content is None:
        content = sys.stdin.read() if not sys.stdin.isatty() else ""
    content = content.strip()
    if not content and not args.title:
        ap.error("标题和正文不能都为空")

    channel = args.channel or cfg.get("NOTIFY_CHANNEL", "")
    if channel not in CHANNELS:
        print(
            f"未知通道 {channel!r}，可选: {', '.join(CHANNELS)}",
            file=sys.stderr,
        )
        print(describe(cfg), file=sys.stderr)
        return 2

    ok, detail = CHANNELS[channel](cfg, args.title, content)
    if ok:
        print(f"✅ 已通过 {channel} 发送")
        return 0
    print(f"❌ {channel} 发送失败: {detail}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())