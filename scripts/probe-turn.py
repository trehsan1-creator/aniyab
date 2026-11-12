#!/usr/bin/env python3
"""POST a turn to /api/chat and print the meta frame (Laya's decisions)."""
import json, sys, urllib.request

base = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"
text = sys.argv[1]
body = {
    "messages": [{"role": "user", "content": text}],
    "activeFlow": "general",
    "sessionId": "probe-session",
    "deviceId": "probe-device",
    "conversationId": "probe-conv",
    "xray": True,
}
req = urllib.request.Request(
    f"{base}/api/chat",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
)
frames = []
with urllib.request.urlopen(req, timeout=90) as res:
    for raw in res:
        line = raw.decode().strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        try:
            frames.append(json.loads(payload))
        except json.JSONDecodeError:
            pass

for f in frames:
    if f.get("type") == "meta":
        print("── meta ──")
        print(json.dumps({k: f[k] for k in f if k != "trace"}, ensure_ascii=False, indent=2))
        for step in f.get("trace", []):
            print(f"  {step['step']:<18} {step['ms']:>5}ms  {step.get('detail', '')}")
    elif f.get("type") == "tool":
        print(f"[tool] {f['name']} {f['status']} — {f.get('summaryFa','')}")
    elif f.get("type") == "token":
        print(f.get("text", ""), end="")
print()
