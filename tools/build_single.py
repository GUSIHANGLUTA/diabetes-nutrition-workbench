# -*- coding: utf-8 -*-
"""
把 app/ 下的多文件版本打包成一个自包含的 HTML 文件（可直接双击打开、可邮件发送）。

用法：python tools/build_single.py
输出：糖尿病配餐与血糖管理.html（项目根目录）
"""
import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP = os.path.join(ROOT, "app")
OUT = os.path.join(ROOT, "糖尿病配餐与血糖管理.html")


def read(name):
    with io.open(os.path.join(APP, name), encoding="utf-8") as fh:
        return fh.read()


def main():
    html = read("index.html")
    css = read("styles.css")
    js_files = ["data-foods.js", "engine-prescription.js", "engine-glucose.js", "app.js"]
    js = "\n".join("/* ==== %s ==== */\n%s" % (f, read(f)) for f in js_files)

    html = html.replace('<link rel="stylesheet" href="styles.css">',
                        "<style>\n" + css + "\n</style>")
    # 用内联脚本替换所有 <script src="..."> 引用（保留读取错误的监听脚本）
    def repl(m):
        return "" if m.group(1) in js_files else m.group(0)
    html = re.sub(r'<script src="([^"]+)"></script>', repl, html)
    html = html.replace("</body>", "<script>\n" + js + "\n</script>\n</body>")

    banner = ("<!--\n  糖尿病配餐与血糖管理工作台（单文件版）\n"
              "  由 tools/build_single.py 自动生成，请勿直接修改本文件；\n"
              "  如需修改请编辑 app/ 目录下的源文件后重新打包。\n"
              "  数据来源：《中国食物成分表（标准版 第6版）》整理数据 + 食物血糖生成指数（GI）附表。\n"
              "  本工具为营养师配餐与患者教育辅助工具，不构成诊疗意见。\n-->\n")
    with io.open(OUT, "w", encoding="utf-8") as fh:
        fh.write(banner + html)
    print("输出：%s（%.1f KB）" % (OUT, os.path.getsize(OUT) / 1024.0))
    print("脚本仍残留外部引用：" + ("无" if '<script src=' not in html else "有，请检查"))


if __name__ == "__main__":
    main()
