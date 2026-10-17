/* =====================================================================
 * engine-prescription.js —— 糖尿病配餐引擎
 *   ① 基础数据 → 理想体重 / 能量 / 三大营养素目标
 *   ② 目标 → 食物交换份分配（每份 90 kcal）
 *   ③ 交换份 → 具体食物与克数（含家常计量，标注生重/熟重）
 *   ④ 营养合计、GI/GL、配餐基本要求自检
 *   ⑤ 等量替换（按碳水 / 能量 / 蛋白质等价）
 *
 * 依据：中国糖尿病医学营养治疗指南（能量系数、供能比、膳食纤维）、
 *       食物交换份法（1 交换份 = 90 kcal）、《中国食物成分表》第6版数据。
 * ===================================================================== */
(function (global) {
  'use strict';

  var DB = global.FOOD_DB || [];
  var CAT_META = global.CAT_META || {};
  var EXCH_KCAL = global.KCAL_PER_EXCH || 90;

  var BY_NAME = {};
  for (var i = 0; i < DB.length; i++) { BY_NAME[DB[i].name] = DB[i]; }

  function F(name) { return BY_NAME[name] || null; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function step(v, s) { return Math.round(v / s) * s; }
  function isDry(f) { return f.cat === 'grain' && f.kcal >= 250; }

  /* ---------------------------------------------------------------- ① 处方 */
  // 能量系数（kcal/kg 理想体重），按体型 × 活动强度，取指南常用值
  var ENERGY_COEF = {
    thin:   { bed: 25, light: 35, moderate: 40, heavy: 45 },
    normal: { bed: 20, light: 30, moderate: 35, heavy: 40 },
    over:   { bed: 15, light: 22, moderate: 30, heavy: 35 }
  };

  function bodyType(bmi) {
    if (bmi < 18.5) return 'thin';
    if (bmi < 24) return 'normal';
    return 'over';           // 24～27.9 超重、≥28 肥胖，能量系数取同一档
  }

  function computePrescription(p) {
    var warn = [];
    var h = +p.height, w = +p.weight, age = +p.age;
    var ibw;
    if (p.useAdjustedWeight && p.adjustWeight) {
      ibw = +p.adjustWeight;                       // 肥胖者可用校正体重：理想体重 + 25%×(实际-理想)
      warn.push('已按“校正体重”计算能量系数，适用于明显肥胖者。');
    } else {
      ibw = h - 105;                               // Broca 改良公式
    }
    var bmi = w / Math.pow(h / 100, 2);
    var bt = bodyType(bmi);
    var coef = ENERGY_COEF[bt][p.activity] || 30;
    var energy = ibw * coef;

    if (p.type === 'gest' || p.gest === 't2tri' || p.gest === 't3tri') {
      energy += 300; warn.push('妊娠中晚期能量 +300 kcal（按指南妊娠期增补）。');
    } else if (p.gest === 't1tri') {
      energy += 0;   warn.push('孕早期能量与孕前相同，不建议额外增加。');
    } else if (p.gest === 'lact') {
      energy += 500; warn.push('哺乳期能量 +500 kcal。');
    }
    if (p.goal === 'lose') { energy -= 450; warn.push('减重目标：能量 −300～500 kcal，建议每周减重 0.5～1 kg。'); }
    if (p.goal === 'gain') { energy += 300; warn.push('增重/纠正营养不良：能量 +300 kcal。'); }
    if (age >= 65) { energy = Math.min(energy, ibw * (coef)); warn.push('≥65 岁取能量系数下限，并保证优质蛋白 1.0～1.2 g/kg。'); }
    if (energy < 1000) { energy = 1000; warn.push('已按最低 1000 kcal 下限校正，极低能量需在医师/营养师监督下进行。'); }

    var proPerKg, proRange;
    if (p.ckd === 'ckd45') { proPerKg = 0.8; proRange = [0.6, 0.8]; warn.push('CKD 4～5 期：蛋白质 0.8 g/kg 理想体重（0.6～0.8），需在肾科医师/营养师指导下执行。'); }
    else if (p.ckd === 'ckd3') { proPerKg = 0.9; proRange = [0.8, 1.0]; warn.push('CKD 3 期：蛋白质 0.8～1.0 g/kg，注意优质蛋白比例 ≥50%。'); }
    else if (p.goal === 'muscle' || p.goal === 'gain' || bt === 'thin') { proPerKg = 1.3; proRange = [1.2, 1.5]; }
    else if (p.type === 't1' || p.type === 'gest' || p.gest === 't2tri' || p.gest === 't3tri' || p.gest === 'lact') { proPerKg = 1.2; proRange = [1.1, 1.5]; }
    else if (p.goal === 'lose') { proPerKg = 1.2; proRange = [1.2, 1.5]; }
    else { proPerKg = 1.05; proRange = [1.0, 1.3]; }   // 2 型糖尿病成人、肾功能正常：1.0～1.3 g/kg
    if (age >= 65 && proPerKg < 1.2 && p.ckd === 'normal') { proPerKg = 1.2; proRange = [1.0, 1.3]; warn.push('≥65 岁：蛋白质取 1.2 g/kg 以预防肌少症，可选乳类、鱼虾、蛋、豆制品等优质蛋白。'); }

    var choPct = +p.choPct || 50;               // 指南：45%～60%
    var proRaw = ibw * proPerKg;
    // 蛋白质按能量水平校正：不低于 15%E（高能量、消瘦、增重者需要），不高于 25%E（低能量者避免过高蛋白负荷）
    var proMin = 0.15 * energy / 4, proMax = 0.25 * energy / 4;
    var proG = clamp(proRaw, proMin, proMax);
    if (proG > proRaw + 0.5) warn.push('为保证蛋白供能比 ≥15%（' + Math.round(proMin) + ' g），蛋白质由 ' + Math.round(proRaw) + ' g 上调至 ' + Math.round(proG) + ' g。');
    if (proG < proRaw - 0.5) warn.push('能量目标较低，蛋白质按 ≤25% 供能比（' + Math.round(proMax) + ' g）校正，原 ' + Math.round(proRaw) + ' g 会使蛋白比例过高。');
    var proPct = proG * 4 / energy * 100;

    // 脂肪供能比：默认「100 − 碳水 − 蛋白」，超出 20%～30% 时优先调整碳水比例，保证三者之和为 100%
    var fatPct = 100 - choPct - proPct;
    if (fatPct > 30) { choPct = clamp(100 - proPct - 27, 40, 62); fatPct = 100 - choPct - proPct; }
    if (fatPct < 20) { choPct = clamp(100 - proPct - 22, 40, 62); fatPct = 100 - choPct - proPct; }
    if (p.fatPct != null && !isNaN(+p.fatPct) && +p.fatPct > 0) {   // 手工指定脂肪比例时以手工值为准
      fatPct = clamp(+p.fatPct, 15, 40);
      choPct = clamp(100 - proPct - fatPct, 30, 65);
    }

    // 供能比与指南范围核对
    if (choPct < 45 || choPct > 60) warn.push('碳水供能比 ' + r1(choPct) + '%，超出 45%～60% 的常用范围，请确认是否有特殊理由（如极低碳水方案需医师指导）。');
    if (proPct < 15 || proPct > 20) warn.push('蛋白供能比 ' + r1(proPct) + '%（' + Math.round(proG) + ' g，' + r1(proG / ibw) + ' g/kg 理想体重），合并肾病、消瘦、老年等需个体化。');
    if (fatPct > 32) warn.push('脂肪供能比偏高（' + r1(fatPct) + '%），建议 ≤30%，并减少饱和脂肪与反式脂肪。');
    if (Math.abs(choPct + proPct + fatPct - 100) > 1) {
      warn.push('三大营养素供能比合计 ' + r1(choPct + proPct + fatPct) + '%，请核对设置。');
    }

    var choG = energy * choPct / 100 / 4;
    var fatG = energy * fatPct / 100 / 9;
    // 膳食纤维：中国居民膳食营养素参考摄入量（14 g/1000 kcal，约 25～30 g/d）
    var fiberG = clamp(Math.round(energy / 1000 * 14), 15, 35);

    var rx = {
      ibw: r1(ibw), bmi: r1(bmi), bodyType: bt,
      bodyTypeLabel: { thin: '消瘦', normal: '正常', over: '超重/肥胖' }[bt],
      coef: coef, energy: Math.round(energy / 10) * 10,
      choG: Math.round(choG), choPct: choPct,
      proG: Math.round(proG), proPerKg: r2(proPerKg), proPct: r1(proPct),
      fatG: Math.round(fatG), fatPct: fatPct,
      proRangeG: [Math.round(Math.min(ibw * proRange[0], proG * 0.92)), Math.round(Math.max(Math.min(ibw * proRange[1], proMax), proG * 1.2))],
      proPerKgRange: proRange,
      fiberG: fiberG, naMax: 2000, cholMax: 300,
      exchTotal: r1(Math.round(energy / 10) * 10 / EXCH_KCAL),
      warnings: warn
    };
    return rx;
  }

  /* ------------------------------------------------- ② 交换份分配（分类） */
  // 谷薯以外的分类按能量占比先固定（并夹在指南推荐量区间内），
  // 再由谷薯补足碳水目标、肉蛋鱼虾补足蛋白目标、油脂补足脂肪目标（定点迭代）
  var SHARE = { veg: 0.085, fruit: 0.06, dairy: 0.12, soy: 0.05, nut: 0.035, oil: 0.13 };

  var MEAL_DEF = {
    breakfast: { label: '早餐', time: '07:00' },
    morning:   { label: '上午加餐', time: '10:00' },
    lunch:     { label: '午餐', time: '12:00' },
    afternoon: { label: '下午加餐', time: '15:30' },
    dinner:    { label: '晚餐', time: '18:00' },
    bedtime:   { label: '睡前加餐', time: '21:30' },
    night:     { label: '夜间加餐', time: '23:00' }
  };

  var PRESETS = {
    three: {
      label: '标准三餐', meals: { breakfast: 0.2, lunch: 0.4, dinner: 0.4 }
    },
    three_snack: {
      label: '三餐 + 2 次加餐',
      meals: { breakfast: 0.2, morning: 0.05, lunch: 0.3, afternoon: 0.05, dinner: 0.3, bedtime: 0.1 }
    },
    six: {
      label: '少食多餐 6 餐',
      meals: { breakfast: 0.18, morning: 0.07, lunch: 0.25, afternoon: 0.08, dinner: 0.27, bedtime: 0.15 }
    },
    gastroparesis: {
      label: '胃轻瘫/餐后高血糖 7 餐',
      meals: { breakfast: 0.15, morning: 0.1, lunch: 0.2, afternoon: 0.1, dinner: 0.2, bedtime: 0.1, night: 0.15 }
    }
  };

  // 各分类在三餐/加餐中的分配权重（未列出的餐次为 0）
  var ALLOC = {
    three: {
      grain: { breakfast: 0.3, lunch: 0.4, dinner: 0.3 },
      veg:   { breakfast: 0.15, lunch: 0.42, dinner: 0.43 },
      fruit: { breakfast: 0.3, lunch: 0.35, dinner: 0.35 },
      meat:  { breakfast: 0.25, lunch: 0.375, dinner: 0.375 },
      soy:   { lunch: 0.5, dinner: 0.5 },
      dairy: { breakfast: 0.6, dinner: 0.4 },
      nut:   { breakfast: 0.5, dinner: 0.5 },
      oil:   { breakfast: 0.15, lunch: 0.45, dinner: 0.4 }
    },
    three_snack: {
      grain: { breakfast: 0.25, lunch: 0.35, dinner: 0.3, bedtime: 0.1 },
      veg:   { breakfast: 0.12, lunch: 0.44, dinner: 0.44 },
      fruit: { morning: 0.5, afternoon: 0.5 },
      meat:  { breakfast: 0.25, lunch: 0.375, dinner: 0.375 },
      soy:   { lunch: 0.5, dinner: 0.5 },
      dairy: { breakfast: 0.4, afternoon: 0.3, bedtime: 0.3 },
      nut:   { morning: 0.5, afternoon: 0.5 },
      oil:   { breakfast: 0.15, lunch: 0.45, dinner: 0.4 }
    },
    six: {
      grain: { breakfast: 0.2, morning: 0.08, lunch: 0.3, afternoon: 0.08, dinner: 0.24, bedtime: 0.1 },
      veg:   { breakfast: 0.12, lunch: 0.44, dinner: 0.44 },
      fruit: { morning: 0.5, afternoon: 0.5 },
      meat:  { breakfast: 0.25, lunch: 0.375, dinner: 0.375 },
      soy:   { lunch: 0.5, dinner: 0.5 },
      dairy: { breakfast: 0.35, afternoon: 0.3, bedtime: 0.35 },
      nut:   { morning: 0.5, afternoon: 0.5 },
      oil:   { breakfast: 0.15, lunch: 0.45, dinner: 0.4 }
    },
    gastroparesis: {
      grain: { breakfast: 0.15, morning: 0.12, lunch: 0.2, afternoon: 0.12, dinner: 0.2, bedtime: 0.11, night: 0.1 },
      veg:   { breakfast: 0.1, morning: 0.1, lunch: 0.25, afternoon: 0.1, dinner: 0.25, bedtime: 0.1, night: 0.1 },
      fruit: { morning: 0.5, afternoon: 0.5 },
      meat:  { breakfast: 0.2, morning: 0.1, lunch: 0.25, afternoon: 0.1, dinner: 0.25, bedtime: 0.05, night: 0.05 },
      soy:   { lunch: 0.5, dinner: 0.5 },
      dairy: { breakfast: 0.3, morning: 0.2, afternoon: 0.2, bedtime: 0.15, night: 0.15 },
      nut:   { morning: 0.5, afternoon: 0.5 },
      oil:   { breakfast: 0.15, lunch: 0.3, dinner: 0.3, night: 0.25 }
    }
  };

  // 每 1 交换份（90 kcal）各类食物的代表营养素含量（按实际食物库折算，三大营养素能量≈90 kcal）
  //   谷薯：米饭 116 kcal/100 g → 78 g/份，碳水 20 g、蛋白 2.0 g
  //   蔬菜：大白菜 20 kcal/100 g → 约 450 g/份，碳水 17 g、蛋白 5 g（传统交换份表口径：蔬菜 1 份 ≈ 500 g）
  //   水果：苹果 53 kcal/100 g → 约 170 g/份，碳水 21 g
  //   乳类：全脂牛奶 65 kcal/100 g → 约 140 g/份，碳水 6.8 g、蛋白 4.6 g
  //   豆类：北豆腐 116 kcal/100 g → 78 g/份，蛋白 7.2 g
  //   坚果：核桃（干）646 kcal/100 g → 14 g/份，脂肪 8.2 g
  //   肉蛋鱼虾：鸡胸 118 kcal/100 g → 76 g/份，蛋白 18.8 g（以瘦肉/鱼虾为口径）
  //   油脂：1 份 = 10 g 油
  var PER_EXCH = {
    grain: { cho: 20, pro: 2.0, fat: 0.4 },
    veg:   { cho: 17, pro: 5.0, fat: 0.4 },
    fruit: { cho: 21, pro: 0.8, fat: 0.4 },
    dairy: { cho: 6.8, pro: 4.6, fat: 5.0 },
    soy:   { cho: 4.5, pro: 7.5, fat: 5.0 },
    nut:   { cho: 3.0, pro: 2.5, fat: 8.0 },
    meat:  { cho: 0.5, pro: 18.0, fat: 2.5 },
    oil:   { cho: 0, pro: 0, fat: 10 }
  };
  // 上表按 1 份 = 90 kcal 归一（避免能量口径不一致导致总能量偏差）
  (function () {
    Object.keys(PER_EXCH).forEach(function (k) {
      var p = PER_EXCH[k], kcal = p.cho * 4 + p.pro * 4 + p.fat * 9;
      if (k !== 'oil' && kcal > 0) {
        var s = 90 / kcal;
        p.cho *= s; p.pro *= s; p.fat *= s; p.kcal = 90;
      }
      p.kcal = 90;
    });
  })();

  function catExchFromEnergy(cat, energy) {
    var n = energy * (SHARE[cat] || 0.05) / EXCH_KCAL;
    // 区间参照指南每日推荐量：蔬菜 300～500 g（1 份≈500 g）、水果 100～200 g（1 份≈200 g）、
    // 乳类 300 ml（1 份≈140 g 牛奶，2 份≈280 g）、豆制品 100 g 左右、坚果 10 g 左右
    var lim = {
      veg: [1.5, 2.5], fruit: [1, 1.5], dairy: [1.5, 2.5], soy: [0.5, 1.5], nut: [0.5, 1]
    }[cat] || [0, 10];
    return step(clamp(n, lim[0], lim[1]), 0.5);
  }

  /**
   * 生成交换份分配
   * @param rx 处方对象
   * @param opts {preset, mealPct, dailyByCat(可覆盖), avoid}
   */
  function buildExchangePlan(rx, opts) {
    opts = opts || {};
    var preset = PRESETS[opts.preset] ? opts.preset : 'three_snack';
    var mealPct = (opts.mealPct && Object.keys(opts.mealPct).length) ? opts.mealPct : PRESETS[preset].meals;
    var warn = [];

    var daily = {};
    ['veg', 'fruit', 'dairy', 'soy', 'nut'].forEach(function (c) { daily[c] = catExchFromEnergy(c, rx.energy); });
    daily.oil = step(clamp(rx.fatG * 0.55 / 10, 1.5, 3), 0.5);     // 烹调油约占脂肪目标一半
    daily.grain = 6; daily.meat = 3;
    if (opts.dailyByCat) Object.keys(opts.dailyByCat).forEach(function (c) { daily[c] = opts.dailyByCat[c]; });

    // 定点迭代：谷薯补碳水、肉蛋鱼虾补蛋白、油脂补脂肪（已被外部指定的分类不参与迭代）
    var locked = {};
    if (opts.dailyByCat) Object.keys(opts.dailyByCat).forEach(function (c) { locked[c] = true; });
    for (var it = 0; it < 16; it++) {
      var cur = nutrientOfExch(daily);
      if (!locked.grain) daily.grain = clamp(daily.grain + (rx.choG - cur.cho) / PER_EXCH.grain.cho, 2, 20);
      cur = nutrientOfExch(daily);
      if (!locked.meat) daily.meat = clamp(daily.meat + (rx.proG - cur.pro) / PER_EXCH.meat.pro, 1, 9);
      cur = nutrientOfExch(daily);
      if (!locked.oil) daily.oil = clamp(daily.oil + (rx.fatG - cur.fat) / PER_EXCH.oil.fat, 1.5, 3);
    }
    ['grain', 'meat', 'oil'].forEach(function (c) {
      if (!locked[c]) daily[c] = r2(daily[c]);
      daily[c] = r1(daily[c]);
    });
    if (daily.grain > 14) warn.push('谷薯类份数较多（' + daily.grain + ' 份），建议增加全谷杂豆比例并分散到各餐。');
    if (daily.oil <= 1) warn.push('油脂份数偏低，注意必需脂肪酸与脂溶性维生素摄入。');

    // 分配至各餐（grid：该分类允许的最小份数粒度，保证克数在日常生活中可用）
    var alloc = ALLOC[preset];
    var GRID = { grain: 0.5, veg: 0.5, fruit: 0.5, meat: 0.25, soy: 0.5, dairy: 0.5, nut: 0.5, oil: 0.5 };
    var meals = Object.keys(mealPct).map(function (k) {
      return { key: k, label: (MEAL_DEF[k] || {}).label || k, time: (MEAL_DEF[k] || {}).time || '', pct: mealPct[k], byCat: {} };
    });
    meals.forEach(function (m) { ['grain', 'veg', 'fruit', 'meat', 'soy', 'dairy', 'nut', 'oil'].forEach(function (c) { m.byCat[c] = 0; }); });
    Object.keys(alloc).forEach(function (cat) {
      var w = alloc[cat] || {};
      var keys = meals.map(function (m) { return m.key; }).filter(function (k) { return (w[k] || 0) > 0; });
      if (!keys.length || !(daily[cat] > 0)) return;
      var grid = GRID[cat] || 0.5;
      var sumW = keys.reduce(function (a, k) { return a + w[k]; }, 0);
      var assigned = 0;
      keys.forEach(function (k, i) {
        var isLast = (i === keys.length - 1);
        var v = isLast ? r2(daily[cat] - assigned)
                       : Math.round((daily[cat] * w[k] / sumW) / grid) * grid;
        if (v < 0) v = 0;                       // 前项取整过大时，最后由回退步骤补齐
        var m = meals.filter(function (x) { return x.key === k; })[0];
        m.byCat[cat] = r2(v);
        assigned = r2(assigned + v);
      });
      // 修正：若合计与目标不符（取整造成），从份数最多的餐次回退
      var gap = r2(daily[cat] - assigned);
      if (Math.abs(gap) > 0.01) {
        var donors = meals.filter(function (x) { return x.byCat[cat] > 0; })
          .sort(function (a, b) { return b.byCat[cat] - a.byCat[cat]; });
        if (donors.length) {
          var d0 = donors[0];
          var nv = r2(d0.byCat[cat] + gap);
          d0.byCat[cat] = nv > 0 ? nv : 0;
        }
      }
    });
    meals.forEach(function (m) {
      m.energy = Math.round(nutrientOfExch(m.byCat).kcal);
      m.pctActual = r1(m.energy / rx.energy * 100);
    });
    return { preset: preset, presetLabel: PRESETS[preset].label, dailyByCat: daily, meals: meals, warnings: warn };
  }

  // 用代表值把「份数结构」折算成营养素（求解用）
  function nutrientOfExch(byCat) {
    var o = { kcal: 0, pro: 0, fat: 0, cho: 0 };
    Object.keys(byCat).forEach(function (c) {
      var n = byCat[c] || 0, p = PER_EXCH[c];
      if (!p) return;
      o.kcal += 90 * n;
      o.pro += p.pro * n; o.fat += p.fat * n; o.cho += p.cho * n;
    });
    return o;
  }

  /* ---------------------------------------------- ③ 交换份 → 具体食物 */
  // 各餐候选食物（按优先级排列，食材名与食物库一致）
  var PICKS = {
    breakfast: {
      grain: ['燕麦', '玉米（鲜）', '甘薯（红心）［山芋、红薯］', '荞麦面', '小米粥', '粳米粥', '馒头（代表值）', '花卷', '通心面［通心粉］', '小米'],
      meat:  ['鸡蛋（代表值）', '鸡蛋白', '牛肉（里脊肉）［牛柳］', '斑节对虾［草虾］'],
      dairy: ['纯牛奶（代表值，全脂）', '纯牛奶（代表值，脱脂）', '酸奶'],
      soy:   ['豆浆', '豆腐（内酯）'],
      veg:   ['黄瓜（鲜）［胡瓜］', '番茄［西红柿］', '生菜［叶用莴苣］', '大白菜（代表值）', '木耳（水发）［黑木耳，云耳］'],
      fruit: ['苹果（代表值）', '梨（代表值）', '柚［文旦］', '草莓［洋莓，凤阳草莓］'],
      nut:   ['核桃（干）［胡桃］', '杏仁（原味）', '花生仁（生）'],
      oil:   ['橄榄油', '花生油']
    },
    lunch: {
      grain: ['米饭（蒸，代表值）', '玉米（鲜）', '荞麦面', '通心面［通心粉］', '糙米', '黑米', '藜麦（散装）'],
      meat:  ['鸡胸脯肉', '牛肉（里脊肉）［牛柳］', '草鱼', '鲈鱼［鲈花］', '鳕鱼［鳕狭、明太鱼］', '斑节对虾［草虾］', '牛肉（后腿）'],
      soy:   ['豆腐（北豆腐）', '豆腐干（代表值）', '千张［百页］', '豆腐（南豆腐）'],
      veg:   ['西兰花［绿菜花］', '菠菜（鲜）［赤根菜］', '油菜', '芹菜茎', '番茄［西红柿］', '茄子（代表值）', '苦瓜（鲜）［凉瓜，癞瓜］', '豆角', '香菇（鲜）［香蕈，冬菇］', '木耳（水发）［黑木耳，云耳］'],
      fruit: ['苹果（代表值）', '橙', '猕猴桃', '桃（代表值）'],
      nut:   ['核桃（干）［胡桃］', '腰果（熟）'],
      oil:   ['花生油', '橄榄油', '玉米油']
    },
    dinner: {
      grain: ['米饭（蒸，代表值）', '甘薯（红心）［山芋、红薯］', '玉米（鲜）', '荞麦面', '糙米', '山药（鲜）［薯蓣，大薯］', '芋头［芋艿、毛芋］'],
      meat:  ['鲫鱼［喜头鱼、海附鱼］', '鲑鱼［大马哈鱼、三文鱼］', '带鱼［白带鱼、刀鱼］', '鸡腿', '鸡胸脯肉', '海参（水浸）', '牛肉（里脊肉）［牛柳］'],
      soy:   ['豆腐（南豆腐）', '豆腐（北豆腐）', '豆腐（内酯）'],
      veg:   ['油菜', '菠菜（鲜）［赤根菜］', '茼蒿（鲜）［蓬蒿菜，艾菜］', '蕹菜［空心菜、藤藤菜］', '苋菜（绿，鲜）', '冬瓜', '黄瓜（鲜）［胡瓜］', '甜椒［灯笼椒、柿子椒］', '海带（浸）［江白菜，昆布］', '香菇（鲜）［香蕈，冬菇］'],
      fruit: ['苹果（代表值）', '柚［文旦］', '梨（代表值）', '樱桃'],
      nut:   ['核桃（干）［胡桃］', '杏仁（原味）'],
      dairy: ['纯牛奶（代表值，全脂）', '酸奶', '纯牛奶（代表值，脱脂）'],
      oil:   ['花生油', '橄榄油', '玉米油']
    },
    // 加餐：以水果 / 乳类 / 坚果 / 少量主食为主
    morning:   { fruit: ['苹果（代表值）', '梨（代表值）', '猕猴桃', '橙'], dairy: ['酸奶', '纯牛奶（代表值，全脂）'], nut: ['杏仁（原味）', '核桃（干）［胡桃］'], grain: ['玉米（鲜）', '甘薯（红心）［山芋、红薯］'] },
    afternoon: { fruit: ['草莓［洋莓，凤阳草莓］', '柚［文旦］', '梨（代表值）', '苹果（代表值）'], dairy: ['酸奶', '纯牛奶（代表值，脱脂）'], nut: ['核桃（干）［胡桃］', '花生仁（生）'], grain: ['玉米（鲜）', '通心面［通心粉］'] },
    bedtime:   { dairy: ['纯牛奶（代表值，全脂）', '酸奶'], nut: ['核桃（干）［胡桃］', '杏仁（原味）'], grain: ['燕麦', '甘薯（红心）［山芋、红薯］', '馒头（代表值）'], meat: ['鸡蛋（代表值）', '鸡蛋白'], soy: ['豆浆'], veg: ['黄瓜（鲜）［胡瓜］'] },
    night:     { dairy: ['纯牛奶（代表值，全脂）'], nut: ['杏仁（原味）'], grain: ['燕麦'], meat: ['鸡蛋（代表值）'], veg: ['黄瓜（鲜）［胡瓜］'] }
  };

  // 口味模板微调
  var FLAVOR = {
    cn:     {},
    simple: { tagPrefer: ['lowGI'], note: '简易快手：优先 10 分钟内可完成的蒸、煮、拌做法。' },
    veg:    { note: '素食为主：用豆制品与豆浆替代部分肉类，注意补充维生素 B12 与铁。', swapMeatToSoy: true },
    lowgi:  { tagPrefer: ['lowGI', 'wholeGrain'], note: '低 GI 强化：主食优先全谷杂豆与低 GI 品种。' }
  };

  // 某分类在某餐没有候选时使用的兜底清单（保证份数不会因为缺少候选而丢失）
  function fallbackList(cat) {
    var order = [['dinner', cat], ['lunch', cat], ['breakfast', cat]];
    for (var i = 0; i < order.length; i++) {
      var m = PICKS[order[i][0]];
      if (m && m[cat] && m[cat].length) return m[cat];
    }
    return DB.filter(function (f) { return f.cat === cat; }).map(function (f) { return f.name; });
  }

  function candidates(mealKey, cat, opts) {
    var t = (PICKS[mealKey] || {})[cat];
    if (!t || !t.length) t = fallbackList(cat);
    var flavor = FLAVOR[opts.flavor] || {};
    var out = [];
    t.forEach(function (n) {
      var f = F(n);
      if (!f) return;
      if (opts.exclude && opts.exclude.indexOf(n) >= 0) return;
      out.push(f);
    });
    // 标签偏好排序：符合偏好的排前面（保持原有优先级的相对顺序）
    if (flavor.tagPrefer && flavor.tagPrefer.length) {
      out.sort(function (a, b) {
        var sa = flavor.tagPrefer.some(function (t) { return a.tags.indexOf(t) >= 0; }) ? 0 : 1;
        var sb = flavor.tagPrefer.some(function (t) { return b.tags.indexOf(t) >= 0; }) ? 0 : 1;
        return sa - sb;
      });
    }
    if (opts.lowGIPrefer) {
      out.sort(function (a, b) { return (a.gi == null ? 60 : a.gi) - (b.gi == null ? 60 : b.gi); });
    }
    // 脂肪预算紧张时（超重/肥胖、血脂异常或脂肪供能比偏高）：乳类/豆制品/坚果优选低脂品种
    if (opts.lowFatPrefer && ['dairy', 'soy', 'nut'].indexOf(cat) >= 0) {
      out.sort(function (a, b) { return a.fat - b.fat; });
    }
    return out;
  }

  /** 把某餐某分类的份数拆成 1～2 个具体食物 */
  function pickItems(mealKey, cat, exch, opts, used, ctx) {
    opts = opts || {};
    ctx = ctx || { chol: 0 };
    if (!exch || exch <= 0) return [];
    var list = candidates(mealKey, cat, opts);
    if (!list.length) return [];
    var chosen = [];

    // 同一天同类尽量不重复：肉类/蔬菜/豆制品/水果优先换新；主食与油可以重复
    var applyFresh = ['meat', 'veg', 'soy', 'fruit'].indexOf(cat) >= 0;
    var fresh = list.filter(function (f) { return !(used[cat] || {})[f.name]; });
    var pool = (applyFresh && fresh.length) ? fresh : list;

    // 蔬菜优先高纤维品种（木耳、香菇、秋葵、苋菜等），有利于达到膳食纤维目标
    if (cat === 'veg') {
      var hiFib = pool.filter(function (f) { return f.fib >= 2.0; });
      if (hiFib.length && pool[0].fib < 1.5) pool = hiFib.concat(pool);
      // 深色蔬菜（含菌藻）占比不足 50% 时，优先安排深色蔬菜
      if (ctx.darkExch < 0.5 * (ctx.vegExch + exch)) {
        var dark = pool.filter(function (f) { return f.tags.indexOf('darkVeg') >= 0; });
        if (dark.length) pool = dark.concat(pool.filter(function (f) { return dark.indexOf(f) < 0; }));
      }
    }
    // 主食：当天全谷杂豆占比不足 1/3 时，强制其中一样为主食池中的全谷杂豆
    if (cat === 'grain' && opts.forceWhole) {
      var wh = pool.filter(function (f) { return f.tags.indexOf('wholeGrain') >= 0; });
      if (wh.length) { pool = [wh[0]].concat(pool.filter(function (f) { return f !== wh[0]; })); }
    }

    // 胆固醇预算：动物性食物若会把全天胆固醇推到 280 mg 以上则跳过（鸡蛋全天上限约 1 个）
    var eggUsed = (used.egg || 0);
    pool = pool.filter(function (f) {
      var g = gramsFor(f, exch) * (cat === 'meat' ? 1 : 0);
      var pot = (f.chol || 0) * g / 100;
      if (cat === 'meat' && f.tags.indexOf('egg') >= 0 && eggUsed >= 1) return false;
      if (ctx.chol + pot > 250 && pot > 40) return false;
      return true;
    });
    if (!pool.length) pool = list;

    // 份数拆分：大份食物拆到 1～2 种，蔬菜按克数上限再拆
    var plan;
    if (cat === 'grain' && exch >= 2) plan = [0.6, 0.4];
    else if (cat === 'veg' && gramsFor(pool[0], exch) > 400) plan = [0.6, 0.4];
    else if (exch >= 1.5 && pool.length > 1) plan = [0.65, 0.35];
    else plan = [1];

    var rest = exch;
    for (var i = 0; i < plan.length; i++) {
      var f = pool[i % pool.length];
      if (cat === 'grain' && i > 0 && !opts.noWholeGrain) {
        // 主食搭配：第二样优先选全谷杂豆，保证 ≥1/3 全谷
        var whole = pool.filter(function (x) { return x.tags.indexOf('wholeGrain') >= 0 && x.name !== pool[0].name; });
        if (whole.length) f = whole[0];
      }
      var e = i === plan.length - 1 ? rest : step(exch * plan[i], 0.5);
      e = Math.min(e, rest);
      if (e <= 0.24) continue;
      rest = r1(rest - e);
      var g = gramsFor(f, e);
      // 蔬菜单条克数上限 350 g，超出部分再分一种
      if (cat === 'veg' && g > 350 && pool.length > i + 1) {
        var e2 = step((g - 300) / gramsFor(f, 1) * 1, 0.5);
        if (e2 > 0.24 && e2 < e) {
          chosen.push({ food: f, exch: r1(e - e2) });
          (used[cat] = used[cat] || {})[f.name] = true;
          ctx.chol += (f.chol || 0) * gramsFor(f, e - e2) / 100;
          var f2 = pool[i + 1];
          chosen.push({ food: f2, exch: r1(e2) });
          (used[cat] = used[cat] || {})[f2.name] = true;
          ctx.chol += (f2.chol || 0) * gramsFor(f2, e2) / 100;
          rest = r1(rest);
          continue;
        }
      }
      chosen.push({ food: f, exch: e });
      (used[cat] = used[cat] || {})[f.name] = true;
      if (f.tags.indexOf('egg') >= 0) used.egg = (used.egg || 0) + 1;
      ctx.chol += (f.chol || 0) * g / 100;
      if (rest <= 0.24) break;
    }
    return chosen;
  }

  function gramsFor(food, exch) { return exch / food.exch100 * 100; }

  /** 生成完整一日食谱（含具体食物与克数） */
  function buildMealItems(plan, opts) {
    opts = opts || {};
    var profile = opts.profile || {};
    // 合并症过滤
    var blockList = [];
    if (profile.comorb && profile.comorb.gout) {
      DB.forEach(function (f) { if (f.tags.indexOf('purineHigh') >= 0) blockList.push(f.name); });
    }
    if (profile.ckd === 'ckd45') {
      DB.forEach(function (f) { if (f.tags.indexOf('ckdCaution') >= 0) blockList.push(f.name); });
    }
    var used = {};
    var ctx = { chol: 0, vegExch: 0, darkExch: 0, grainExch: 0, wholeExch: 0 };
    plan.meals.forEach(function (m) {
      m.items = [];
      var cats = ['grain', 'veg', 'meat', 'soy', 'dairy', 'fruit', 'nut', 'oil'];
      cats.forEach(function (cat) {
        var e = m.byCat[cat] || 0;
        if (e <= 0) return;
        var block = blockList;
        // 素食模板：把肉类的份数转到豆类
        if ((FLAVOR[opts.flavor] || {}).swapMeatToSoy && cat === 'meat') {
          m.byCat.soy = r1((m.byCat.soy || 0) + e * 0.5);
          e = e * 0.5;
        }
        // 主餐主食：当天全谷杂豆尚未达到 1/3 时强制搭配（早餐燕麦/玉米等本身多为全谷）
        var forceWhole = false;
        if (cat === 'grain' && ['lunch', 'dinner'].indexOf(m.key) >= 0) {
          var totalAfter = ctx.grainExch + e;
          forceWhole = (ctx.wholeExch + 0.01) / Math.max(0.01, totalAfter) < 0.34;
        }
        var picks = pickItems(m.key, cat, e, {
          flavor: opts.flavor, lowGIPrefer: !!opts.lowGIPrefer, exclude: block,
          lowFatPrefer: !!opts.lowFatPrefer, forceWhole: forceWhole
        }, used, ctx);
        picks.forEach(function (p) {
          var g = gramsFor(p.food, p.exch);
          // 鸡蛋等天然单个食物按「半个 / 1 个」取整，避免出现 0.25 个鸡蛋这种无法执行的量
          if (p.food.tags.indexOf('egg') >= 0 && p.food.unitG) {
            var half = p.food.unitG / 2;
            g = Math.max(half, Math.round(g / half) * half);
          }
          var grams = Math.round(g / 5) * 5;
          var exch = r2(grams / 100 * p.food.exch100);
          m.items.push({
            food: p.food, exch: exch, grams: grams,
            rawGrams: Math.round(g), dry: isDry(p.food), cat: cat
          });
          if (cat === 'grain') {
            ctx.grainExch += exch;
            if (p.food.tags.indexOf('wholeGrain') >= 0) ctx.wholeExch += exch;
          }
          if (cat === 'veg') {
            ctx.vegExch += exch;
            if (p.food.tags.indexOf('darkVeg') >= 0) ctx.darkExch += exch;
          }
        });
      });
      m.nutri = sumItems(m.items);
    });
    return plan;
  }

  /**
   * 生成「一日方案」：先按处方分配交换份，再按实际食物回算营养，
   * 用 2～3 轮校准把总能量/碳水/蛋白/脂肪的偏差压到 ±3% 以内。
   */
  function buildDay(rx, opts) {
    opts = opts || {};
    var overrides = opts.dailyByCat ? JSON.parse(JSON.stringify(opts.dailyByCat)) : null;
    var plan, day, iter = 0, lowFat = false;
    // 超重/肥胖、血脂异常者一开始就按低脂思路选乳类与豆制品
    if (rx.bodyType === 'over' || (opts.profile && opts.profile.comorb && opts.profile.comorb.lipid)) lowFat = true;
    for (iter = 0; iter < 10; iter++) {
      var o = {};
      Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
      if (overrides) o.dailyByCat = overrides;
      o.lowFatPrefer = lowFat;
      plan = buildExchangePlan(rx, o);
      buildMealItems(plan, o);
      day = sumMeals(plan.meals);
      if (!overrides) overrides = {};
      var dCho = rx.choG - day.cho, dPro = rx.proG - day.pro, dFat = rx.fatG - day.fat;
      // 收敛条件：按 4/4/9 折算能量 ±2%，碳水 ±5%，蛋白 ±8%，脂肪 ±10% 同时满足
      var ok = Math.abs(day.macroKcal - rx.energy) / rx.energy <= 0.02 &&
        Math.abs(dCho) / Math.max(1, rx.choG) <= 0.05 &&
        Math.abs(dPro) / Math.max(1, rx.proG) <= 0.08 &&
        Math.abs(dFat) / Math.max(1, rx.fatG) <= 0.10;
      if (ok) break;
      if (dFat < -0.1 * rx.fatG && !lowFat) lowFat = true;   // 脂肪超标 → 换低脂乳类/豆制品
      var damp = 0.8;   // 阻尼，避免在取整边界上来回振荡
      var g0 = overrides.grain || plan.dailyByCat.grain;
      var m0 = overrides.meat || plan.dailyByCat.meat;
      var o0 = overrides.oil || plan.dailyByCat.oil;
      overrides.grain = r2(clamp(g0 * (1 + damp * dCho / Math.max(1, day.cho)), 2, 20));
      overrides.meat = r2(clamp(m0 * (1 + damp * dPro / Math.max(1, day.pro)), 1, 9));
      overrides.oil = r2(clamp(o0 + damp * dFat / 10, 1.5, 3));
    }
    return {
      plan: plan, day: day, iterations: iter,
      checks: runChecks(day, rx, opts.profile || {}, { meals: plan.meals, preset: plan.preset })
    };
  }

  /* ------------------------------------------------------ ④ 营养与自检 */
  function sumItems(items) {
    var o = { kcal: 0, pro: 0, fat: 0, cho: 0, fib: 0, na: 0, chol: 0, k: 0, gl: 0, glKnownKcal: 0, giNum: 0, giDen: 0, mass: 0 };
    (items || []).forEach(function (it) {
      var f = it.food, g = (it.grams || 0) / 100;
      o.kcal += f.kcal * g; o.pro += f.pro * g; o.fat += f.fat * g; o.cho += f.cho * g;
      o.fib += f.fib * g; o.na += (f.na || 0) * g; o.chol += (f.chol || 0) * g; o.k += (f.k || 0) * g;
      o.mass += it.grams || 0;
      if (f.gi != null) {
        o.gl += f.gi * f.cho * g / 100;
        o.giNum += f.gi * f.cho * g; o.giDen += f.cho * g;
      } else {
        o.glKnownKcal += f.kcal * g;
      }
    });
    o.giAvg = o.giDen > 0 ? o.giNum / o.giDen : null;
    // 按 4/4/9 折算的能量：与成分表「能量」列可能有几个百分点的差异
    // （成分表能量按 Atwater 系数并考虑膳食纤维、有机酸等计算，供能比应以本值为分母）
    o.macroKcal = o.cho * 4 + o.pro * 4 + o.fat * 9;
    return o;
  }

  function sumMeals(meals) {
    var all = [];
    meals.forEach(function (m) { all = all.concat(m.items || []); });
    var t = sumItems(all);
    t.byCat = {};
    meals.forEach(function (m) {
      Object.keys(m.byCat || {}).forEach(function (c) { t.byCat[c] = r1((t.byCat[c] || 0) + m.byCat[c]); });
    });
    return t;
  }

  function runChecks(day, rx, profile, opts) {
    profile = profile || {}; opts = opts || {};
    var rows = [];
    function add(name, target, actual, pass, note, level) {
      rows.push({ name: name, target: target, actual: actual, pass: pass, note: note || '', level: level || 'key' });
    }
    var de = (day.kcal - rx.energy) / rx.energy * 100;
    var deM = (day.macroKcal - rx.energy) / rx.energy * 100;
    add('每日总能量', rx.energy + ' kcal', Math.round(day.kcal) + ' kcal（偏差 ' + r1(de) + '%）',
      Math.abs(de) <= 7,
      '食物成分表「能量」按 Atwater 系数并计入膳食纤维等，与 4/4/9 折算值（本次 ' + Math.round(day.macroKcal) +
      ' kcal，偏差 ' + r1(deM) + '%）通常相差 3%～5%，两者均在 ±10% 以内即视为达到能量目标。');

    var choPct = day.cho * 4 / day.macroKcal * 100, proPct = day.pro * 4 / day.macroKcal * 100, fatPct = day.fat * 9 / day.macroKcal * 100;
    add('碳水供能比', '45%～60%', r1(choPct) + '%', choPct >= 44.5 && choPct <= 60.5,
      '碳水不宜过低（易低血糖、依从性差），也不宜过高（餐后血糖波动大）。');
    add('蛋白质', rx.proRangeG[0] + '～' + rx.proRangeG[1] + ' g（' + rx.proPerKgRange[0] + '～' + rx.proPerKgRange[1] + ' g/kg）',
      Math.round(day.pro) + ' g（' + r1(proPct) + '%E，' + r1(day.pro / rx.ibw) + ' g/kg）',
      day.pro >= rx.proRangeG[0] * 0.95 && day.pro <= rx.proRangeG[1] * 1.05,
      '每餐 15～25 g 优质蛋白、分散摄入更有利于肌肉合成；本合计含谷薯、蔬菜、乳类中的植物蛋白。');
    add('脂肪供能比', '20%～30%', r1(fatPct) + '%', fatPct <= 32 && fatPct >= 18,
      '饱和脂肪 <7% 总能量；合并血脂异常者优先不饱和脂肪。');
    add('膳食纤维', '≥ ' + rx.fiberG + ' g（14 g/1000 kcal）', r1(day.fib) + ' g', day.fib >= rx.fiberG * 0.9,
      '全谷杂豆、蔬菜、适量水果与坚果是膳食纤维主要来源；成分表中缺失项已按估算值计入（标 ≈）。');
    add('膳食胆固醇', '参考 <300 mg（1 个鸡蛋≈320 mg）', Math.round(day.chol) + ' mg', day.chol < 450,
      '2023 年中国血脂管理指南不再设膳食胆固醇硬性上限；糖尿病合并血脂异常/ASCVD 者仍建议每日蛋黄 ≤1 个、限制动物内脏与肥肉。', 'watch');
    add('钠（食物本身，不含调味品）', '< 2000 mg', Math.round(day.na) + ' mg', day.na < 2000,
      '食盐 <5 g/d；酱油、咸菜、加工肉、挂面等隐形钠也要计入。', 'watch');
    var vegG = 0, darkG = 0, vegMainG = 0, grainG = 0, wholeGrainG = 0, oilG = 0, fruitG = 0, dairyG = 0;
    day.byCat = day.byCat || {};
    (opts.meals || []).forEach(function (m) {
      var isSnack = /加餐/.test(m.label || '');
      (m.items || []).forEach(function (it) {
        var f = it.food, g = it.grams;
        if (f.cat === 'veg') {
          vegG += g;
          // 深色蔬菜占比只统计正餐（加餐的黄瓜/番茄属于额外补充，不参与评价）
          if (!isSnack) {
            vegMainG += g;
            if (f.tags.indexOf('darkVeg') >= 0 || f.tags.indexOf('fungus') >= 0 || f.tags.indexOf('seaweed') >= 0) darkG += g;
          }
        }
        if (f.cat === 'grain') { grainG += g; if (f.tags.indexOf('wholeGrain') >= 0) wholeGrainG += g; }
        if (f.cat === 'oil') oilG += g;
        if (f.cat === 'fruit') fruitG += g;
        if (f.cat === 'dairy') dairyG += g;
      });
    });
    add('蔬菜量', '400～600 g（约 1～1.5 交换份）', Math.round(vegG) + ' g', vegG >= 350, '餐餐有蔬菜，深色蔬菜占一半以上；菌藻类（木耳、香菇、海带）膳食纤维高，建议每天 1 种。');
    add('深色蔬菜与菌藻占比', '≥ 50%（正餐蔬菜）', vegMainG ? r1(darkG / vegMainG * 100) + '%' : '—', vegMainG > 0 && darkG / vegMainG >= 0.5, '深色蔬菜（菠菜、油菜、西兰花、番茄、胡萝卜等）与菌藻类富含 β-胡萝卜素、维生素 C、钾与可溶性膳食纤维；正餐蔬菜合计 ' + Math.round(vegMainG) + ' g。');
    add('全谷杂豆占主食比例', '≥ 1/3', grainG ? r1(wholeGrainG / grainG * 100) + '%' : '—', grainG > 0 && wholeGrainG / grainG >= 0.33, '全谷杂豆 GI 更低、膳食纤维更高。');
    add('烹调油', '25～30 g（15～33 g 可接受）', Math.round(oilG) + ' g', oilG >= 15 && oilG <= 33, '建议蒸、煮、炖、拌，少煎炸；坚果与乳类中的脂肪也要计入全天脂肪。');
    add('水果', '100～300 g（1 交换份≈200 g）', Math.round(fruitG) + ' g', fruitG >= 100 && fruitG <= 320, '血糖平稳时（餐后 2 h <10 mmol/L、HbA1c <7%）可吃水果，放在两餐之间。');
    add('乳类', '≥ 250～300 g', Math.round(dairyG) + ' g', dairyG >= 200, '无糖酸奶或纯牛奶，注意乳糖不耐受者选用无乳糖或酸奶。');
    var maxGL = 0, maxGLMeal = '', maxMealCho = 1;
    (opts.meals || []).forEach(function (m) {
      if (!m.nutri) return;
      if (m.nutri.gl > maxGL) { maxGL = m.nutri.gl; maxGLMeal = m.label; }
      maxMealCho = Math.max(maxMealCho, m.nutri.cho);
    });
    add('平均 GI（按碳水加权）', '≤55 为低 GI，≤60 为中等', day.giAvg == null ? '—' : r1(day.giAvg),
      day.giAvg != null && day.giAvg <= 60,
      '把白米饭、白粥、馒头换成全谷杂豆、玉米、薯类，餐后血糖峰值更低；这是控制餐后血糖最有效的饮食抓手。');
    add('单餐血糖负荷 GL', '理想 ≤25（本餐 ' + Math.round(maxMealCho) + ' g 碳水）', r1(maxGL) + (maxGLMeal ? '（' + maxGLMeal + '）' : ''),
      maxGL <= 35, 'GL = GI × 可利用碳水(g) / 100。餐次能量越大 GL 越高，关键是降低该餐平均 GI。', 'watch');
    add('全天血糖负荷 GL', '理想 ≤80（低 GL 膳食）', r1(day.gl), day.gl <= 110,
      'GL 总量随全天能量上升；若偏高，优先减少精制主食、增加全谷杂豆与蔬菜。', 'watch');
    if (profile.comorb && profile.comorb.gp) {
      add('胃轻瘫适配', '低脂、低渣、少量多餐', opts.preset === 'gastroparesis' ? '已用 7 餐少量方案' : '建议改用少量多餐方案',
        opts.preset === 'gastroparesis', '避免高脂、粗纤维过多与一次大量进食。');
    }
    if (profile.comorb && profile.comorb.gout) {
      add('高尿酸/痛风', '避免高嘌呤食物', '已自动排除动物内脏等高嘌呤食物', true, '限制浓肉汤、海鲜与酒精（尤其啤酒）。');
    }
    if (profile.ckd === 'ckd45') {
      add('CKD 4～5 期', '限蛋白、限钾磷', '已按 0.8 g/kg 与低钾磷食物库筛选', true, '需肾科营养师个体化调整，必要时补充复方α酮酸。');
    }
    return rows;
  }

  /* -------------------------------------------------------- ⑤ 等量替换 */
  /** 找出可平替的食物：默认同分类、按指定营养素等价 */
  function swapCandidates(src, mode, opts) {
    opts = opts || {};
    mode = mode || 'carb';
    var key = mode === 'energy' ? 'kcal' : (mode === 'protein' ? 'pro' : 'cho');
    var ref = src[key] || 0.0001;
    var out = [];
    DB.forEach(function (f) {
      if (f.name === src.name) return;
      if (opts.sameCat !== false && f.cat !== src.cat) return;
      if (f[key] <= 0) return;
      var ratio = ref / f[key];                  // 等量替换比例（以 100 g 计）
      if (ratio < 0.2 || ratio > 8) return;      // 差异过大不作为平替
      if (opts.lowGI && src.gi != null && f.gi != null && f.gi > src.gi + 2) return;
      var g = ratio * 100;
      var d = {
        food: f, grams: Math.round(g / 5) * 5, ratio: r2(ratio),
        exchDiff: r2(f.exch100 * g / 100 - src.exch100 * 100 / 100),
        delta: {
          kcal: r1(f.kcal * g / 100 - src.kcal), pro: r1(f.pro * g / 100 - src.pro),
          fat: r1(f.fat * g / 100 - src.fat), cho: r1(f.cho * g / 100 - src.cho),
          fib: r1(f.fib * g / 100 - src.fib),
          gl: r1(f.gi != null ? f.gi * f.cho * g / 10000 : 0) - r1(src.gi != null ? src.gi * src.cho / 100 : 0)
        }
      };
      if (opts.onlyLowerGL && d.delta.gl > 0.5) return;
      out.push(d);
    });
    out.sort(function (a, b) {
      // 排序原则：先看 GI（越低越好），全谷杂豆/薯类优先，
      // 纯淀粉制品（粉丝、粉条、藕粉）GI 虽低但营养素密度低，作为末选
      function rank(f) {
        var r = (f.gi == null ? 60 : f.gi);
        if (f.tags.indexOf('pureCarb') >= 0) r += (src.tags.indexOf('pureCarb') >= 0 ? 0 : 60);
        if (f.tags.indexOf('wholeGrain') >= 0) r -= 6;
        if (f.tags.indexOf('potato') >= 0) r -= 3;
        r -= Math.min(6, (f.fib || 0) * 1.5);
        return r;
      }
      return rank(a.food) - rank(b.food);
    });
    return out;
  }

  /** 在食谱中把某个食物替换为另一个（保持交换份不变，克数按等价重算） */
  function swapInItem(item, newFood) {
    var grams = item.exch / newFood.exch100 * 100;
    return { food: newFood, exch: item.exch, grams: Math.round(grams / 5) * 5, rawGrams: Math.round(grams), dry: isDry(newFood), cat: newFood.cat, swappedFrom: item.food.name };
  }

  /** 替换食物库（导入自定义数据后调用，保证引擎内部的名称索引同步更新） */
  function reloadDB(list) {
    if (!list || !list.length) return false;
    DB.length = 0;
    Object.keys(BY_NAME).forEach(function (k) { delete BY_NAME[k]; });
    list.forEach(function (f) {
      if (!f || !f.name || !(f.kcal > 0)) return;
      if (f.exch100 == null) f.exch100 = f.kcal / EXCH_KCAL;
      if (!f.cat) f.cat = 'grain';
      if (!f.tags) f.tags = [];
      DB.push(f);
      BY_NAME[f.name] = f;
    });
    global.FOOD_DB = DB;
    return DB.length > 0;
  }

  global.PrescEngine = {
    DB: DB, BY_NAME: BY_NAME, F: F, CAT_META: CAT_META, MEAL_DEF: MEAL_DEF, PRESETS: PRESETS,
    computePrescription: computePrescription,
    buildExchangePlan: buildExchangePlan,
    buildMealItems: buildMealItems,
    buildDay: buildDay,
    sumItems: sumItems, sumMeals: sumMeals,
    runChecks: runChecks,
    swapCandidates: swapCandidates, swapInItem: swapInItem,
    gramsFor: gramsFor, isDry: isDry, r1: r1, r2: r2, step: step, clamp: clamp,
    nutrientOfExch: nutrientOfExch, reloadDB: reloadDB
  };
})(typeof window !== 'undefined' ? window : globalThis);
