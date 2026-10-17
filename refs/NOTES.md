# 开源参考项目与数据来源清单

本项目**不是对某个开源项目的直接 fork**，而是先检索可复用的开源模板与数据，再按「营养师本地使用、免安装、不联网」
的目标重写为一个自包含的本地网页应用。下面记录检索到的项目、各自可用之处、以及为什么最终这样落地。

## 一、被实际采用的开源数据（已内置到程序中）

| 项目 | 采用内容 | 许可/说明 |
| --- | --- | --- |
| [Sanotsu/china-food-composition-data](https://github.com/Sanotsu/china-food-composition-data) | ①《中国食物成分表（标准版 第6版）》「能量和食物一般营养成分」整理数据（`food_composition_full.csv`，1677 条）→ 从中挑选 **137 条**糖尿病配餐常用食物；② 该仓库收录的《中国食物成分表》**食物血糖生成指数（GI）附表**（259 条）→ 全部内置为 GI 查询表，并为 95 条食物库条目赋予 GI 值 | 仓库为公开整理数据（含 OCR 校对流程），本工具在 `app/data-foods.js` 头部与界面表格中均标注来源 |
| [ZucchiniY/gi_gl](https://github.com/ZucchiniY/gi_gl) | 作为备选 GI 数据源（悉尼大学 GI 数据库爬取结果，`gi2.csv` 2731 条，含英文食物名与文献出处）。经比对，中文食物覆盖不足，最终 GI 值以第 6 版附表为准 | 保留在 `refs/gi_gl/` 供需要英文/国际食物 GI 时参考 |

## 二、检索到并借鉴设计思路的开源项目（未直接引用代码）

| 项目 | 借鉴点 |
| --- | --- |
| [flyhunterl/glucose-buddy（糖小助）](https://github.com/flyhunterl/glucose-buddy) | 把动态血糖数据与饮食影响、趋势预测结合的思路；本工具的 CGM 统计（TIR/TAR/TBR、GMI、CV、低血糖事件）与「血糖→进餐/运动再计算」的交互形式参考了这类工具的呈现方式 |
| [jcivitel/django_insumate](https://github.com/jcivitel/django_insumate) | 碳水计数与胰岛素剂量管理的数据模型（本工具只做配餐与教育，不做胰岛素剂量换算） |
| [AI-Institute-Food-Systems/Diet_Recommendation_System](https://github.com/AI-Institute-Food-Systems/Diet_Recommendation_System) | 「先算营养目标 → 再按约束挑食物 → 最后自检」的三段式流程，本工具的处方引擎按同样顺序实现（约束用食物交换份而不是机器学习） |
| [killAnEarthworm/HealthMate-AI-Powered-Diet-Planner-](https://github.com/killAnEarthworm/HealthMate-AI-Powered-Diet-Planner-) | 糖尿病饮食 + 运动计划的产品结构（本工具改为纯本地规则引擎，不依赖大模型接口） |
| [kkpan11/mealie](https://github.com/kkpan11/mealie)（Mealie 自托管食谱与配餐管理） | 配餐/食谱数据组织的做法。其依赖 Docker + 数据库 + Vue 前后端，与「营养师一台电脑双击即用」的目标不符，故未采用 |
| [Nightscout（cgm-remote-monitor）](https://github.com/nightscout/cgm-remote-monitor) | CGM 数据平台与 `entries.json` 数据形态。需要自建服务器与数据库，本工具改为支持「粘贴/导入 CGM 导出 CSV」，保持免安装 |
| [smartplate（PyPI 智能配餐助手）](https://pypi.org/project/smartplate/) | 中文配餐助手的功能清单参考；本工具未安装该包，避免引入运行时依赖 |

## 三、目录说明

```
refs/
├── china-food/
│   ├── food_composition_full.csv          # 第6版成分表整理数据（1677 条，本工具食物库的来源）
│   ├── glycemic_index_of_foods.json       # GI 附表（259 条，按食物类别分组）
│   ├── README.md / README_V3.md            # 上游仓库说明（字段与单位定义）
│   ├── _gi_all.tsv                        # 由脚本导出的 GI 全表（便于人工核对）
│   └── _tree.json                         # 上游仓库文件清单（下载时生成）
└── gi_gl/gi_gl-main/
    ├── gi2.csv                            # 悉尼大学 GI 数据库（备选数据源）
    ├── gi.db / get_datas.py / to_sqlite.py # 上游脚本与数据库
    └── readme.org
```

参考数据仅用于核对与再生成，**程序运行（含单文件版）不读取 `refs/`**。

## 四、重新拉取参考数据

```powershell
python tools/fetch_reference_data.py      # 走 ghproxy/api.github.com 镜像，raw.githubusercontent 直连在国内常不可用
python tools/build_food_db.py             # 由参考数据重新生成 app/data-foods.js
```

## 五、本工具的引用建议

在论文、处方模板或院内文档中引用本工具时，请同时标注：

1. 《中国食物成分表（标准版 第6版）》—— 能量与一般营养成分、血糖生成指数附表；
2. 数据整理来源：`Sanotsu/china-food-composition-data`（GitHub）；
3. 规则依据：中国糖尿病医学营养治疗相关指南（能量系数、供能比、膳食纤维 14 g/1000 kcal）、中国糖尿病运动治疗相关推荐（每周 ≥150 分钟中等强度有氧 + 每周 2～3 次抗阻、运动前后监测）、2023 年中国血脂管理指南（膳食胆固醇）。
