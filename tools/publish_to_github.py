# -*- coding: utf-8 -*-
"""
通过 GitHub REST API（api.github.com）发布本仓库。

适用场景：网络只能访问 api.github.com、不能访问 github.com:443（无法 git push）时，
用 Git Data API 一次性把文件写成一次提交。

用法：
  $env:GITHUB_TOKEN = 'ghp_xxx'            # classic token 勾选 repo；或 fine-grained token 授予
                                            #   Administration: Read and write（建仓）
                                            #   Contents: Read and write（写文件）
  python tools/publish_to_github.py --repo diabetes-nutrition-workbench --public
  python tools/publish_to_github.py --repo diabetes-nutrition-workbench --dry-run   # 只检查，不写入

可选参数：
  --owner   GitHub 用户名（默认用 token 查询到的登录名）
  --branch  分支名，默认 main
  --message 提交信息
  --private 建私有仓库（默认公开）
  --update  仓库已存在时，在现有内容上追加一次提交（默认同样追加）
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.github.com"
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".vscode", ".idea"}
SKIP_EXT = {".pyc", ".log", ".tmp"}
MAX_BYTES = 20 * 1024 * 1024


def log(msg=""):
    print(msg, flush=True)


def api(method, path, token, payload=None, ok=(200, 201, 204)):
    url = API + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "dm-workbench-publisher")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return r.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(body).get("message", body)
        except Exception:
            msg = body
        return e.code, {"message": msg}


def collect_files():
    """收集要发布的文件（跳过 .gitignore 中的目录与过大文件）"""
    out = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fn in files:
            if os.path.splitext(fn)[1].lower() in SKIP_EXT:
                continue
            full = os.path.join(base, fn)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            if rel == "refs/NOTES.md" or not rel.startswith("refs/"):
                pass
            else:
                continue
            size = os.path.getsize(full)
            if size > MAX_BYTES:
                log("  跳过（>20MB）：%s" % rel)
                continue
            out.append((rel, full, size))
    return sorted(out)


def git(*args):
    try:
        return subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True, text=True,
                              encoding="utf-8", errors="replace").stdout.strip()
    except Exception:
        return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", default=os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"))
    ap.add_argument("--owner", default=None)
    ap.add_argument("--repo", default="diabetes-nutrition-workbench")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--message", default=None)
    ap.add_argument("--private", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = collect_files()
    total = sum(f[2] for f in files)
    log("待发布文件 %d 个，共 %.1f KB" % (len(files), total / 1024.0))
    for rel, _, size in files:
        log("  %8.1f KB  %s" % (size / 1024.0, rel))
    if args.dry_run:
        log("\n--dry-run：仅检查文件清单，不写入 GitHub（不需要 token）。")
        return 0

    if not args.token:
        log("缺少 token：请设置环境变量 GITHUB_TOKEN，或用 --token 传入。")
        log("生成地址：https://github.com/settings/tokens")
        return 2

    status, me = api("GET", "/user", args.token)
    if status != 200:
        log("token 校验失败（%s）：%s" % (status, me.get("message")))
        return 2
    owner = args.owner or me["login"]
    log("已认证：%s" % owner)

    # 1) 建仓（若已存在则沿用）
    status, repo = api("POST", "/user/repos", args.token, {
        "name": args.repo,
        "description": "糖尿病配餐与血糖管理工作台（本地网页版，供营养师使用）",
        "homepage": "",
        "private": bool(args.private),
        "has_issues": True,
        "has_wiki": False,
        "auto_init": False,
    })
    if status == 201:
        log("已创建仓库：%s" % repo["html_url"])
    elif status == 422:
        log("仓库已存在，将追加一次提交：%s" % args.repo)
        status, repo = api("GET", "/repos/%s/%s" % (owner, args.repo), args.token)
        if status != 200:
            log("读取仓库失败（%s）：%s" % (status, repo.get("message")))
            return 1
    else:
        log("创建仓库失败（%s）：%s" % (status, repo.get("message")))
        return 1

    # 2) 现有分支与 base_tree
    base_tree = None
    status, ref = api("GET", "/repos/%s/%s/git/ref/heads/%s" % (owner, args.repo, args.branch), args.token)
    if status == 200:
        base_tree = api("GET", "/repos/%s/%s/git/commits/%s" % (owner, args.repo, ref["object"]["sha"]),
                        args.token)[1].get("tree", {}).get("sha")
        log("已有分支 %s，将在其上追加（base_tree=%s）" % (args.branch, (base_tree or "")[:8]))

    # 3) 上传 blob
    tree = []
    for i, (rel, full, size) in enumerate(files, 1):
        with open(full, "rb") as fh:
            content = base64.b64encode(fh.read()).decode("ascii")
        status, blob = api("POST", "/repos/%s/%s/git/blobs" % (owner, args.repo), args.token,
                           {"content": content, "encoding": "base64"})
        if status != 201:
            log("上传失败 %s（%s）：%s" % (rel, status, blob.get("message")))
            return 1
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        if i % 10 == 0 or i == len(files):
            log("  已上传 %d/%d" % (i, len(files)))

    # 4) 生成 tree / commit / ref
    payload = {"tree": tree}
    if base_tree:
        payload["base_tree"] = base_tree
    status, new_tree = api("POST", "/repos/%s/%s/git/trees" % (owner, args.repo), args.token, payload)
    if status != 201:
        log("创建 tree 失败（%s）：%s" % (status, new_tree.get("message")))
        return 1

    message = args.message or ("发布糖尿病配餐与血糖管理工作台 %s" %
                               (git("describe", "--tags", "--always") or "v1.0.0"))
    commit_payload = {
        "message": message,
        "tree": new_tree["sha"],
        "author": {"name": git("config", "user.name") or "gluta",
                   "email": git("config", "user.email") or "noreply@users.noreply.github.com"},
    }
    if base_tree:
        commit_payload["parents"] = [ref["object"]["sha"]]
    status, commit = api("POST", "/repos/%s/%s/git/commits" % (owner, args.repo), args.token, commit_payload)
    if status != 201:
        log("创建 commit 失败（%s）：%s" % (status, commit.get("message")))
        return 1

    if base_tree:
        status, res = api("PATCH", "/repos/%s/%s/git/refs/heads/%s" % (owner, args.repo, args.branch),
                          args.token, {"sha": commit["sha"], "force": False})
    else:
        status, res = api("POST", "/repos/%s/%s/git/refs" % (owner, args.repo), args.token,
                          {"ref": "refs/heads/" + args.branch, "sha": commit["sha"]})
    if status not in (200, 201):
        log("更新分支失败（%s）：%s" % (status, res.get("message")))
        return 1

    # 5) 设置仓库信息与 topics
    api("PATCH", "/repos/%s/%s" % (owner, args.repo), args.token, {
        "description": "糖尿病配餐与血糖管理工作台：输入基础数据自动生成交换份食谱（含营养素与 GI/GL、食材平替）；输入血糖与运动情况自动重算进餐时间/量/种类与运动处方。纯本地单文件网页，供营养师使用。",
        "has_issues": True,
    })
    api("PUT", "/repos/%s/%s/topics" % (owner, args.repo), args.token, {
        "names": ["diabetes", "nutrition", "meal-plan", "glucose", "glycemic-index",
                  "food-exchange", "local-first", "healthcare", "chinese", "nutritionist"]
    })

    log("\n🎉 发布完成：%s" % repo["html_url"])
    log("   单文件版下载：%s/raw/%s/%s" % (repo["html_url"], args.branch,
                                        urllib.request.quote("糖尿病配餐与血糖管理.html")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
