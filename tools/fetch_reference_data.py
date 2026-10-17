# -*- coding: utf-8 -*-
"""
重新拉取开源参考数据（供核对与再生成 app/data-foods.js 使用）。

说明：raw.githubusercontent.com 在国内网络下常被重置，本脚本改用
  - ghproxy.net 反向代理读取单文件
  - api.github.com 读取文件清单
如需更换镜像，改 MIRROR 即可。

用法：python tools/fetch_reference_data.py [--gi-gl]
      加 --gi-gl 会额外下载 ZucchiniY/gi_gl（悉尼大学 GI 数据库，备选数据源）。
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REF = os.path.join(ROOT, "refs")
MIRROR = "https://ghproxy.net/https://raw.githubusercontent.com/"
CHINA_FOOD = "Sanotsu/china-food-composition-data/main/"

FILES = [
    "json_data_v3_20260825_qwen38max_kimi_k3_fixed_en/food_composition_full.csv",
    "json_gi_of_foods/glycemic_index_of_foods.json",
    "README.md",
    "docs/README_V3.md",
]


def get(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=timeout).read()


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    print("OK  %8d 字节  %s" % (len(data), os.path.relpath(path, ROOT)))


def fetch_china_food():
    for rel in FILES:
        dst = os.path.join(REF, "china-food", os.path.basename(rel))
        if os.path.exists(dst):
            print("SKIP 已存在    %s" % os.path.relpath(dst, ROOT))
            continue
        try:
            save(dst, get(MIRROR + urllib.parse.quote(CHINA_FOOD + rel)))
        except Exception as e:
            print("FAIL %s：%s" % (rel, e))
    # 文件清单（便于核对上游是否更新）
    try:
        tree = get("https://api.github.com/repos/Sanotsu/china-food-composition-data/git/trees/main?recursive=1")
        info = json.loads(tree)
        items = [[t["path"], t.get("size", 0)] for t in info["tree"] if t["type"] == "blob"]
        dst = os.path.join(REF, "china-food", "_tree.json")
        with io.open(dst, "w", encoding="utf-8") as fh:
            json.dump(items, fh, ensure_ascii=False, indent=1)
        print("OK  上游文件清单 %d 个 → %s" % (len(items), os.path.relpath(dst, ROOT)))
    except Exception as e:
        print("FAIL 读取上游文件清单：%s" % e)


def fetch_gi_gl():
    repo = "ZucchiniY/gi_gl"
    dst_dir = os.path.join(REF, "gi_gl")
    for br in ("main", "master"):
        url = "https://codeload.github.com/%s/zip/refs/heads/%s" % (repo, br)
        try:
            data = get(url, timeout=120)
        except Exception as e:
            print("  尝试 %s 失败：%s" % (br, e))
            continue
        import zipfile
        zf = zipfile.ZipFile(io.BytesIO(data))
        os.makedirs(dst_dir, exist_ok=True)
        zf.extractall(dst_dir)
        print("OK  %s（%s）%d 个文件" % (repo, br, len(zf.namelist())))
        return
    print("FAIL 无法下载 %s" % repo)


if __name__ == "__main__":
    fetch_china_food()
    if "--gi-gl" in sys.argv:
        fetch_gi_gl()
    print("\n完成。重新生成食物库请执行：python tools/build_food_db.py")
