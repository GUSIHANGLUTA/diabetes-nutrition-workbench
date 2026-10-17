# -*- coding: utf-8 -*-
"""
从《中国食物成分表（标准版 第6版）》公开整理数据生成 app/data-foods.js

数据来源
  1) refs/china-food/food_composition_full.csv
       Sanotsu/china-food-composition-data —— 第6版「能量和食物一般营养成分」表格整理数据
  2) refs/china-food/glycemic_index_of_foods.json
       同上仓库 —— 食物血糖生成指数（GI）附表，共 255 条

本脚本挑选糖尿病配餐常用食物，附加「交换份」换算（1 交换份 = 90 kcal）、
GI 值（取自 GI 附表，附表未收录者置空并标记，非淀粉类蔬菜按附表惯例取 15）、
家常计量单位、以及用于配餐算法的标签。
"""
import csv
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV = os.path.join(ROOT, "refs", "china-food", "food_composition_full.csv")
GI = os.path.join(ROOT, "refs", "china-food", "glycemic_index_of_foods.json")
OUT = os.path.join(ROOT, "app", "data-foods.js")

NONE = ("—", "Tr", "", None)
KCAL_PER_EXCH = 90.0

# ---------------------------------------------------------------- 食物清单
# (应用分类, 成分表名称, GI, GI是否估算, GI来源说明, 单位克重, 单位描述, 标签)
# 应用分类：grain 谷薯主食 / veg 蔬菜 / fruit 水果 / meat 肉蛋鱼虾
#           soy 豆类及制品 / dairy 乳类 / nut 坚果种子 / oil 油脂
F = [
    # ---------------- 谷薯类（主食） ----------------
    ("grain", "米饭（蒸，代表值）", 83, False, "GI 表：大米饭（粳米精米 90／籼米精米 82）取均值", 150, "1 小碗（150 g）", "refined,stapleMain"),
    ("grain", "粳米饭（蒸）", 90, False, "GI 表：大米饭（粳米，精米）90", 150, "1 小碗（150 g）", "refined,highGI"),
    ("grain", "籼米饭（蒸）", 82, False, "GI 表：大米饭（籼米，精米）82", 150, "1 小碗（150 g）", "refined,highGI"),
    ("grain", "粳米粥", 69, False, "GI 表：大米粥 69", 200, "1 碗（200 g）", "refined,highGI,porridge"),
    ("grain", "小米粥", 60, False, "GI 表：小米粥 60", 200, "1 碗（200 g）", "porridge"),
    ("grain", "馒头（代表值）", 85, False, "GI 表：馒头（精制小麦粉）85", 100, "1 个（100 g）", "refined,highGI"),
    ("grain", "花卷", 85, True, "按馒头（精制小麦粉）85 近似", 90, "1 个（90 g）", "refined,highGI"),
    ("grain", "烙饼（标准粉）", 80, False, "GI 表：烙饼 80", 100, "1 张（100 g）", "refined,highGI,fried"),
    ("grain", "挂面（代表值）", 55, False, "GI 表：挂面（精制小麦粉）55", 0, "", "refined,dry"),
    ("grain", "面条（富强粉，煮）", 41, False, "GI 表：面条（白细，煮）41", 250, "1 碗（250 g）", "cookedNoodle"),
    ("grain", "面条（生，代表值）", 55, False, "GI 表：面条（硬质小麦粉，细）55", 0, "", "refined"),
    ("grain", "荞麦面", 59, False, "GI 表：荞麦面条 59", 0, "", "wholeGrain,buckwheat"),
    ("grain", "玉米面（黄）", 68, False, "GI 表：玉米面（粗粉，煮）68", 0, "", "wholeGrain,coarse"),
    ("grain", "玉米（鲜）", 55, False, "GI 表：玉米（甜，煮）55", 200, "1 根（200 g）", "wholeGrain,coarse"),
    ("grain", "小米", 71, False, "GI 表：小米（煮）71", 0, "", "wholeGrain,coarse"),
    ("grain", "燕麦", 42, False, "GI 表：燕麦饭（整粒）42", 0, "", "wholeGrain,oat,lowGI"),
    ("grain", "藜麦（散装）", 53, True, "文献常用值约 53（GI 表未收录）", 0, "", "wholeGrain,lowGI"),
    ("grain", "糙米", 71, False, "GI 表：大米饭（籼米，糙米）71", 0, "", "wholeGrain,brownRice"),
    ("grain", "黑米", 55, False, "GI 表：黑米饭 55", 0, "", "wholeGrain,lowGI"),
    ("grain", "薏米［薏仁米，苡米］", None, False, "GI 表未收录", 0, "", "wholeGrain"),
    ("grain", "高粱米", None, False, "GI 表未收录", 0, "", "wholeGrain"),
    ("grain", "大麦［元麦］", 25, False, "GI 表：大麦（整粒，煮）25", 0, "", "wholeGrain,lowGI"),
    ("grain", "青稞", None, False, "GI 表未收录", 0, "", "wholeGrain"),
    ("grain", "玉米糁（黄）", 51, False, "GI 表：玉米糁粥 51", 0, "", "wholeGrain,coarse"),
    ("grain", "马铃薯（蒸）", 66, False, "GI 表：马铃薯（蒸）66", 150, "1 个（150 g）", "potato,stapleSwap"),
    ("grain", "甘薯（红心）［山芋、红薯］", 77, False, "GI 表：甘薯（红，煮）77", 150, "1 个（150 g）", "potato,stapleSwap,highGI"),
    ("grain", "山药（鲜）［薯蓣，大薯］", 51, False, "GI 表：山药（薯蓣）51", 0, "", "potato,stapleSwap,lowGI"),
    ("grain", "芋头［芋艿、毛芋］", 48, False, "GI 表：芋头（蒸芋艿／毛芋）48", 0, "", "potato,stapleSwap,lowGI"),
    ("grain", "藕［莲藕］", 38, True, "文献常用值约 38（GI 表未收录）", 0, "", "potato,stapleSwap,highCarbVeg"),
    ("grain", "荸荠（鲜）［马蹄，地栗］", 40, True, "文献常用值约 40（GI 表未收录）", 0, "", "potato,stapleSwap,highCarbVeg"),
    ("grain", "粉丝", 32, True, "GI 表：粉丝汤（豌豆）32（近似）", 0, "", "starch,pureCarb"),
    ("grain", "粉条", 13.6, False, "GI 表：马铃薯粉条 13.6", 0, "", "starch,pureCarb"),
    ("grain", "藕粉", 33, False, "GI 表：藕粉 33", 0, "", "starch,pureCarb"),
    ("grain", "米粉", 54, False, "GI 表：米粉 54", 0, "", "refined,riceNoodle"),
    ("grain", "河粉", None, False, "GI 表未收录", 0, "", "refined,riceNoodle"),
    ("grain", "通心面［通心粉］", 45, False, "GI 表：通心面（管状，粗）45", 0, "", "refined,lowGI,pasta"),

    # ---------------- 蔬菜类 ----------------
    ("veg", "大白菜（代表值）", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "darkVeg,leafy"),
    ("veg", "菠菜（鲜）［赤根菜］", 15, False, "GI 表：菠菜 15", 0, "", "darkVeg,leafy"),
    ("veg", "油菜", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "darkVeg,leafy"),
    ("veg", "芹菜茎", 15, False, "GI 表：芹菜 15", 0, "", "darkVeg,stem"),
    ("veg", "韭菜", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "darkVeg,leafy"),
    ("veg", "生菜［叶用莴苣］", 15, False, "GI 表：生菜 15", 0, "", "leafy"),
    ("veg", "西兰花［绿菜花］", 15, False, "GI 表：绿菜花 15", 0, "", "darkVeg,crucifer"),
    ("veg", "菜花（白色）［花椰菜］", 15, False, "GI 表：菜花 15", 0, "", "crucifer"),
    ("veg", "芦笋（绿）［石刁柏、龙须菜］", 15, False, "GI 表：芦笋 15", 0, "", "darkVeg"),
    ("veg", "茼蒿（鲜）［蓬蒿菜，艾菜］", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "darkVeg,leafy"),
    ("veg", "蕹菜［空心菜、藤藤菜］", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "darkVeg,leafy"),
    ("veg", "苋菜（绿，鲜）", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "darkVeg,leafy"),
    ("veg", "竹笋（鲜）", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "leafy"),
    ("veg", "黄瓜（鲜）［胡瓜］", 15, False, "GI 表：黄瓜 15", 0, "", "lowCal,melon"),
    ("veg", "番茄［西红柿］", 15, False, "GI 表：西红柿 15", 0, "", "darkVeg,solanum"),
    ("veg", "茄子（代表值）", 15, False, "GI 表：茄子 15", 0, "", "solanum"),
    ("veg", "苦瓜（鲜）［凉瓜，癞瓜］", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "darkVeg"),
    ("veg", "冬瓜", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "lowCal,melon"),
    ("veg", "南瓜（鲜）［倭瓜，番瓜］", 75, False, "GI 表：南瓜（倭瓜、番瓜）75", 0, "", "highGI,highCarbVeg,solanum"),
    ("veg", "甜椒［灯笼椒、柿子椒］", 15, False, "GI 表：青椒 15", 0, "", "darkVeg,solanum"),
    ("veg", "洋葱（鲜）［葱头］", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "allium"),
    ("veg", "胡萝卜", 71, False, "GI 表：胡萝卜（金笋）71", 0, "", "highGI,highCarbVeg,root"),
    ("veg", "绿豆芽", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "sprout"),
    ("veg", "黄豆芽", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "sprout"),
    ("veg", "豆角", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "bean,legumeVeg"),
    ("veg", "荷兰豆", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "bean,legumeVeg"),
    ("veg", "秋葵［黄秋葵、羊角豆］", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "darkVeg"),
    ("veg", "木耳（水发）［黑木耳，云耳］", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "fungus"),
    ("veg", "香菇（鲜）［香蕈，冬菇］", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "fungus,umami"),
    ("veg", "海带（浸）［江白菜，昆布］", 15, True, "非淀粉类蔬菜，按 GI 表惯例取 15", 0, "", "seaweed,iodine,ckdCaution"),
    ("veg", "紫菜（干）", None, False, "GI 表未收录", 0, "", "seaweed,iodine,ckdCaution"),

    # ---------------- 水果类 ----------------
    ("fruit", "苹果（代表值）", 36, False, "GI 表：苹果 36", 200, "1 个（200 g）", "lowGI"),
    ("fruit", "梨（代表值）", 36, False, "GI 表：梨 36", 200, "1 个（200 g）", "lowGI"),
    ("fruit", "桃（代表值）", None, False, "GI 表未收录", 150, "1 个（150 g）", "lowGI"),
    ("fruit", "葡萄（代表值）", 43, False, "GI 表：葡萄 43", 100, "约 10 粒（100 g）", "lowGI"),
    ("fruit", "中华猕猴桃［毛叶猕猴桃］", 52, False, "GI 表：猕猴桃 52", 100, "1 个（100 g）", "vitC"),
    ("fruit", "柚［文旦］", 25, False, "GI 表：柚 25", 0, "", "lowGI"),
    ("fruit", "橙", 43, True, "按 GI 表：柑（橘子）43 近似", 200, "1 个（200 g）", "lowGI"),
    ("fruit", "蜜橘", 43, False, "GI 表：柑（橘子）43", 100, "1 个（100 g）", "lowGI"),
    ("fruit", "草莓［洋莓，凤阳草莓］", 32, True, "文献常用值约 32（GI 表未收录）", 0, "", "lowGI"),
    ("fruit", "樱桃", 22, False, "GI 表：樱桃 22", 0, "", "lowGI"),
    ("fruit", "西瓜（代表值）", 72, False, "GI 表：西瓜 72", 0, "", "highGI,summer"),
    ("fruit", "哈密瓜", 70, False, "GI 表：哈密瓜 70", 0, "", "highGI,summer"),
    ("fruit", "香蕉［甘蕉］", 52, False, "GI 表：香蕉 52", 100, "1 根（100 g 可食部）", "potassium"),
    ("fruit", "芒果［抹猛果，望果］", 55, False, "GI 表：芒果 55", 0, "", "tropical"),
    ("fruit", "菠萝［凤梨，地菠萝］", 66, False, "GI 表：菠萝 66", 0, "", "highGI,tropical"),
    ("fruit", "火龙果［仙蜜果、红龙果］", None, False, "GI 表未收录", 0, "", "tropical"),

    # ---------------- 肉蛋鱼虾 ----------------
    ("meat", "猪肉（代表值，fat30g）", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "fatty,purineMod"),
    ("meat", "猪里脊（熏烤小里脊）", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "lean,processed,naHigh"),
    ("meat", "牛肉（代表值，fat9g）", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "purineMod"),
    ("meat", "牛肉（里脊肉）［牛柳］", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "lean"),
    ("meat", "牛肉（后腿）", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "lean"),
    ("meat", "羊肉（里脊）", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "lean"),
    ("meat", "鸡胸脯肉", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "lean,whiteMeat"),
    ("meat", "鸡腿", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "whiteMeat"),
    ("meat", "鸡翅", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "fatty,whiteMeat"),
    ("meat", "鸭（代表值）", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "fatty"),
    ("meat", "猪肝", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "organ,purineHigh,cholHigh"),
    ("meat", "鸡蛋（代表值）", None, False, "GI 表未收录（几乎不含碳水）", 50, "1 个（50 g）", "egg"),
    ("meat", "鸡蛋白", None, False, "GI 表未收录（几乎不含碳水）", 33, "1 个蛋白（33 g）", "egg,lean"),
    ("meat", "鸡蛋黄", None, False, "GI 表未收录（几乎不含碳水）", 17, "1 个蛋黄（17 g）", "egg,cholHigh"),
    ("meat", "草鱼", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "fish,lean"),
    ("meat", "鲫鱼［喜头鱼、海附鱼］", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "fish,lean"),
    ("meat", "带鱼［白带鱼、刀鱼］", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "fish"),
    ("meat", "鲈鱼［鲈花］", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "fish,lean"),
    ("meat", "鲑鱼［大马哈鱼、三文鱼］", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "fish,omega3"),
    ("meat", "鳕鱼［鳕狭、明太鱼］", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "fish,lean"),
    ("meat", "斑节对虾［草虾］", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "shrimp,lean"),
    ("meat", "长毛对虾［大虾、白露虾］", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "shrimp,lean"),
    ("meat", "海参（水浸）", None, False, "GI 表未收录（几乎不含碳水）", 0, "", "lean,naHigh"),

    # ---------------- 豆类及制品 ----------------
    ("soy", "黄豆［大豆］", 18, False, "GI 表：黄豆（浸泡）18", 0, "", "plantProtein,legume,purineMod"),
    ("soy", "豆浆", 19, False, "GI 表：豆奶 19（近似）", 250, "1 杯（250 ml）", "plantProtein,drink"),
    ("soy", "豆腐（代表值）", 32, False, "GI 表：豆腐（炖）32", 0, "", "plantProtein,ckdCaution"),
    ("soy", "豆腐（北豆腐）", 32, False, "GI 表：豆腐（炖）32", 0, "", "plantProtein,ckdCaution"),
    ("soy", "豆腐（南豆腐）", 32, False, "GI 表：豆腐（炖）32", 0, "", "plantProtein,ckdCaution"),
    ("soy", "豆腐（内酯）", 32, False, "GI 表：豆腐（炖）32", 0, "", "plantProtein,ckdCaution"),
    ("soy", "豆腐干（代表值）", 24, False, "GI 表：豆腐干 24", 0, "", "plantProtein,naHigh,ckdCaution"),
    ("soy", "千张［百页］", 24, False, "GI 表：豆腐干 24（近似）", 0, "", "plantProtein,ckdCaution"),
    ("soy", "腐竹", 24, False, "GI 表：豆腐干 24（近似）", 0, "", "plantProtein,dry,ckdCaution"),
    ("soy", "绿豆（干）", 27, False, "GI 表：绿豆 27", 0, "", "legume,wholeGrain,purineMod"),
    ("soy", "赤小豆（干）［小豆，红小豆］", None, False, "GI 表未收录", 0, "", "legume,wholeGrain"),
    ("soy", "豌豆（干）", 42, False, "GI 表：豌豆 42", 0, "", "legume,wholeGrain"),
    ("soy", "四季豆（菜豆）", 27, False, "GI 表：四季豆 27", 0, "", "legumeVeg"),
    ("soy", "鹰嘴豆［桃豆］", 33, False, "GI 表：鹰嘴豆 33", 0, "", "legume,wholeGrain,lowGI"),

    # ---------------- 乳类 ----------------
    ("dairy", "纯牛奶（代表值，全脂）", 27, False, "GI 表：全脂牛奶 27", 250, "1 盒（250 ml）", "dairy,calcium"),
    ("dairy", "纯牛奶（代表值，脱脂）", 32, False, "GI 表：脱脂牛奶 32", 250, "1 盒（250 ml）", "dairy,calcium,lowFat"),
    ("dairy", "酸奶", 36, True, "GI 表：酸乳酪（普通）36（近似，注意选无糖）", 100, "1 杯（100 g）", "dairy,probiotic,calcium"),
    ("dairy", "全脂奶粉（代表值）", 11.9, True, "GI 表：低脂奶粉 11.9（近似）", 25, "1 平勺（25 g）", "dairy,dry,calcium"),
    ("dairy", "奶酪［干酪］", None, False, "GI 表未收录", 0, "", "dairy,naHigh,calcium"),

    # ---------------- 坚果种子 ----------------
    ("nut", "花生仁（生）", 14, False, "GI 表：花生 14", 0, "", "nut,plantProtein"),
    ("nut", "核桃（干）［胡桃］", None, False, "GI 表未收录", 0, "", "nut,omega3"),
    ("nut", "杏仁（原味）", None, False, "GI 表未收录", 0, "", "nut"),
    ("nut", "腰果（熟）", 25, False, "GI 表：腰果 25", 0, "", "nut"),
    ("nut", "芝麻子（黑）", None, False, "GI 表未收录", 0, "", "nut,calcium"),
    ("nut", "南瓜子（炒）［白瓜子］", None, False, "GI 表未收录", 0, "", "nut"),
    ("nut", "西瓜子（炒）", None, False, "GI 表未收录", 0, "", "nut,naHigh"),

    # ---------------- 油脂 ----------------
    ("oil", "花生油", None, False, "不含碳水，不计 GL", 10, "1 瓷勺（10 g）", "oil"),
    ("oil", "橄榄油", None, False, "不含碳水，不计 GL", 10, "1 瓷勺（10 g）", "oil,monoUnsaturated"),
    ("oil", "玉米油", None, False, "不含碳水，不计 GL", 10, "1 瓷勺（10 g）", "oil"),
    ("oil", "芝麻油［香油］", None, False, "不含碳水，不计 GL", 10, "1 瓷勺（10 g）", "oil"),
    ("oil", "猪油（炼）", None, False, "不含碳水，不计 GL", 10, "1 瓷勺（10 g）", "oil,saturated"),
]

# 《中国食物成分表》第6版「能量和一般营养成分」表中部分食物未列膳食纤维（原表为 —）。
# 为避免把「缺失」误当成 0，这里对所选食物逐项给出估算值，生成结果中标记 fibEst=true。
# 取值优先来自同表同族条目，其次为《中国食物成分表》旧版常用值；纯油脂与乳类确实不含膳食纤维，取 0。
FIB_FIX = {
    "籼米饭（蒸）": 0.3, "小米粥": 0.7, "面条（富强粉，煮）": 0.4, "荞麦面": 2.5,
    "玉米面（黄）": 5.6, "玉米糁（黄）": 6.2, "甘薯（红心）［山芋、红薯］": 1.6,
    "米粉": 0.3, "河粉": 0.4,
    "油菜": 1.1, "韭菜": 1.4, "生菜［叶用莴苣］": 0.7, "西兰花［绿菜花］": 1.6,
    "芦笋（绿）［石刁柏、龙须菜］": 1.3, "蕹菜［空心菜、藤藤菜］": 1.4, "番茄［西红柿］": 0.5,
    "冬瓜": 0.7, "甜椒［灯笼椒、柿子椒］": 1.4, "胡萝卜": 1.1, "黄豆芽": 1.5,
    "豆浆": 0.2, "豆腐（代表值）": 0.4, "豆腐（北豆腐）": 0.4, "豆腐（南豆腐）": 0.4,
    "豆腐干（代表值）": 0.8, "腐竹": 1.0,
}
FIB_ZERO = ["酸奶", "全脂奶粉（代表值）", "奶酪［干酪］", "花生油", "橄榄油", "玉米油", "芝麻油［香油］"]

CAT_META = {
    "grain": {"label": "谷薯类（主食）", "role": "提供碳水与膳食纤维，优先全谷杂豆与低 GI 品种"},
    "veg": {"label": "蔬菜类", "role": "餐餐有蔬菜，深色蔬菜占一半以上，餐前先吃菜"},
    "fruit": {"label": "水果类", "role": "放在两餐之间或运动前后，血糖平稳时吃"},
    "meat": {"label": "肉蛋鱼虾类", "role": "优选鱼虾、禽肉、蛋，限制加工肉与肥肉"},
    "soy": {"label": "豆类及制品", "role": "优质植物蛋白，与动物蛋白搭配"},
    "dairy": {"label": "乳类", "role": "每日 300 ml 液态奶或等量乳制品"},
    "nut": {"label": "坚果种子", "role": "每日 10 g 左右，计入总能量与油脂"},
    "oil": {"label": "油脂类", "role": "每日烹调油 25～30 g，相当于 2～3 交换份"},
}


def num(v):
    if v is None:
        return None
    v = str(v).strip().replace("*", "")
    if v in NONE:
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return f


def js_num(v):
    if v is None:
        return "null"
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return ("%.2f" % v).rstrip("0").rstrip(".")


def main():
    rows = list(csv.DictReader(io.StringIO(open(CSV, "rb").read().decode("utf-8-sig"))))
    by_name = {}
    for r in rows:
        by_name.setdefault(r["foodName"], r)

    gi_ref = []
    for grp in json.load(open(GI, encoding="utf-8")):
        for it in grp["list"]:
            gi_ref.append({"g": grp["foodGroup"], "n": it["foodName"], "gi": it["GI"]})

    foods, missing = [], []
    for i, (cat, name, gi, gi_est, gi_src, unit_g, unit_name, tags) in enumerate(F, start=1):
        r = by_name.get(name)
        if r is None:
            missing.append(name)
            continue
        kcal = num(r["energyKCal"])
        if not kcal:
            missing.append(name + "（无能量数据）")
            continue
        cho = num(r["CHO"]) or 0.0
        fib = num(r["dietaryFiber"])
        fib_est = False
        if fib is None:
            if name in FIB_FIX:
                fib, fib_est = FIB_FIX[name], True
            elif name in FIB_ZERO:
                fib, fib_est = 0.0, False
            else:
                fib, fib_est = 0.0, True   # 兜底：缺失按 0 处理并标记
        foods.append({
            "id": "F%03d" % i,
            "name": name,
            "cat": cat,
            "srcCat": r["category"],
            "code": r["foodCode"],
            "kcal": kcal,
            "pro": num(r["protein"]) or 0.0,
            "fat": num(r["fat"]) or 0.0,
            "cho": cho,
            "fib": fib,
            "fibEst": fib_est,
            "na": num(r["Na"]),
            "chol": num(r["cholesterol"]),
            "k": num(r["K"]),
            "gi": gi,
            "giEst": bool(gi_est),
            "giSrc": gi_src,
            "unitG": unit_g or None,
            "unitName": unit_name or None,
            "tags": [t for t in tags.split(",") if t],
            # 每 100 g 可食部折合交换份（1 份 = 90 kcal）
            "exch100": round(kcal / KCAL_PER_EXCH, 4),
        })
    if missing:
        raise SystemExit("以下食物未在成分表中找到，请核对名称：\n  " + "\n  ".join(missing))

    with_gi = sum(1 for f in foods if f["gi"] is not None)
    out = []
    out.append("/* 自动生成，请勿手工编辑 —— 生成脚本 tools/build_food_db.py */")
    out.append("/*")
    out.append("  数据来源：")
    out.append("   1) 《中国食物成分表（标准版 第6版）》能量与一般营养成分（Sanotsu/china-food-composition-data 整理）")
    out.append("   2) 同上仓库食物血糖生成指数（GI）附表，共 %d 条" % len(gi_ref))
    out.append("  换算约定：1 交换份 = 90 kcal；exch100 = 每 100 g 可食部折合交换份数")
    out.append("  GI 标记：giEst=true 表示 GI 表未直接收录、按同类食物或文献常用值估算，请结合本机构资料核对")
    out.append("*/")
    out.append("window.FOOD_DB = [")
    for f in foods:
        out.append("  {" + ", ".join('%s: %s' % (
            k,
            json.dumps(v, ensure_ascii=False) if isinstance(v, str) else
            ("[" + ", ".join(json.dumps(x, ensure_ascii=False) for x in v) + "]" if isinstance(v, list) else
             ("true" if v is True else ("false" if v is False else js_num(v))))
        ) for k, v in f.items()) + "},")
    out.append("];")
    out.append("window.CAT_META = " + json.dumps(CAT_META, ensure_ascii=False, indent=1) + ";")
    out.append("window.GI_REFERENCE = [")
    for g in gi_ref:
        out.append("  {g: %s, n: %s, gi: %s}," % (
            json.dumps(g["g"], ensure_ascii=False), json.dumps(g["n"], ensure_ascii=False), js_num(g["gi"])))
    out.append("];")
    out.append("window.KCAL_PER_EXCH = 90;")
    out.append("window.DATA_VERSION = %s;" % json.dumps("中国食物成分表第6版整理数据 / GI 附表 %d 条" % len(gi_ref), ensure_ascii=False))

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")

    print("食物条目：%d（含 GI：%d）" % (len(foods), with_gi))
    from collections import Counter
    for k, v in sorted(Counter(f["cat"] for f in foods).items()):
        print("  %-6s %d" % (k, v))
    print("输出：", OUT, "%.1f KB" % (os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
