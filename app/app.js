/* =====================================================================
 * app.js —— 界面逻辑（原生 JS，无框架、无外部依赖）
 *   ① 基础数据 → 处方    ② 配餐模板与营养    ③ 食材平替
 *   ④ 血糖 · 运动联动    ⑤ 数据与设置
 * ===================================================================== */
(function () {
  'use strict';

  var P = window.PrescEngine;
  var G = window.GlucoseEngine;
  var LS_KEY = 'dm_nutrition_workbench_v1';
  var LS_DB = 'dm_nutrition_fooddb_v1';
  var LS_RULES = 'dm_nutrition_rules_v1';

  var state = {
    patientId: '',
    profile: {
      name: '', sex: 'male', age: 55, height: 170, weight: 75, activity: 'light',
      type: 't2', treat: 'oral_low', gest: 'no', ckd: 'normal', goal: 'maintain',
      comorb: { htn: true, lipid: false, gout: false, gp: false }
    },
    opts: { preset: 'three_snack', flavor: 'cn', mealPct: null },
    rx: null, plan: null, day: null, checks: [], manual: {},
    rules: Object.assign({}, G.DEFAULT_RULES),
    swapFrom: null, pendingSwap: null, cgm: null, glucose: null
  };

  /* ----------------------------------------------------------- 工具函数 */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function n(v, d) { return (v == null || isNaN(v)) ? '—' : (+v).toFixed(d == null ? 0 : d); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function catLabel(c) { return (P.CAT_META[c] || {}).label || c; }
  function portionText(it) {
    var f = it.food, g = it.grams, out = [];
    var u = f.unitG ? g / f.unitG : 0;
    var unitShort = String(f.unitName || '').replace(/^1\s*/, '').replace(/（.*?）/, '').trim();
    if (u >= 0.85 && u <= 1.15) out.push('约 1 ' + unitShort);
    else if (u >= 1.85 && u <= 2.15) out.push('约 2 ' + unitShort);
    else if (u >= 2.85 && u <= 3.15) out.push('约 3 ' + unitShort);
    out.push('约 ' + r1(g / 50) + ' 两');
    if (it.dry) out.unshift('生重');
    return out.join('，');
  }
  function glText(f, grams) {
    if (f.gi == null) return '—';
    return n(f.gi * f.cho * grams / 10000, 1);
  }
  function giText(f) { return f.gi == null ? '未收录' : (n(f.gi, f.gi < 20 ? 1 : 0) + (f.giEst ? '≈' : '')); }
  function badge(text, cls) { return '<span class="badge ' + (cls || '') + '">' + esc(text) + '</span>'; }

  /* ------------------------------------------------------- ① 基础数据 */
  function readProfile() {
    var p = state.profile;
    p.name = $('pName').value.trim();
    p.sex = $('pSex').value;
    p.age = +$('pAge').value || 0;
    p.height = +$('pHeight').value || 0;
    p.weight = +$('pWeight').value || 0;
    p.activity = $('pActivity').value;
    p.type = $('pType').value;
    p.treat = $('pTreat').value;
    p.gest = $('pGest').value;
    p.ckd = $('pCkd').value;
    p.goal = $('pGoal').value;
    p.comorb = {
      htn: $('pComorbHtn').checked, lipid: $('pComorbLip').checked,
      gout: $('pComorbGout').checked, gp: $('pComorbGp').checked
    };
    state.patientId = $('ptId').value.trim();
    return p;
  }
  function fillProfileForm() {
    var p = state.profile;
    $('ptId').value = state.patientId || '';
    $('pName').value = p.name || '';
    $('pSex').value = p.sex; $('pAge').value = p.age; $('pHeight').value = p.height; $('pWeight').value = p.weight;
    $('pActivity').value = p.activity; $('pType').value = p.type; $('pTreat').value = p.treat;
    $('pGest').value = p.gest; $('pCkd').value = p.ckd; $('pGoal').value = p.goal;
    $('pComorbHtn').checked = !!p.comorb.htn; $('pComorbLip').checked = !!p.comorb.lipid;
    $('pComorbGout').checked = !!p.comorb.gout; $('pComorbGp').checked = !!p.comorb.gp;
  }

  function computeRx() {
    var p = readProfile();
    var rx = P.computePrescription({
      height: p.height, weight: p.weight, age: p.age, sex: p.sex, activity: p.activity,
      type: p.type, treat: p.treat, gest: p.gest, ckd: p.ckd, goal: p.goal,
      choPct: state.manual.choPct, fatPct: state.manual.fatPct
    });
    // 手工覆盖
    if (state.manual.energy) { rx.energy = Math.round(state.manual.energy); }
    if (state.manual.choPct) rx.choPct = +state.manual.choPct;
    if (state.manual.fatPct) rx.fatPct = +state.manual.fatPct;
    if (state.manual.proPerKg) { rx.proPerKg = +state.manual.proPerKg; }
    if (state.manual.fiber) rx.fiberG = +state.manual.fiber;
    rx.choG = Math.round(rx.energy * rx.choPct / 100 / 4);
    rx.proG = Math.round(rx.ibw * rx.proPerKg);
    rx.proPct = r1(rx.proG * 4 / rx.energy * 100);
    rx.fatPct = (state.manual.fatPct != null) ? +state.manual.fatPct : r1(100 - rx.choPct - rx.proPct);
    rx.fatG = Math.round(rx.energy * rx.fatPct / 100 / 9);
    state.rx = rx;
    return rx;
  }

  function renderProfile() {
    var rx = computeRx();
    var p = state.profile;
    $('calcBadge').textContent = rx.bodyTypeLabel + ' · ' + rx.coef + ' kcal/kg';
    $('calcBadge').className = 'badge ' + (rx.bodyType === 'normal' ? 'ok' : 'warn');
    $('profileOut').innerHTML = [
      ['理想体重', n(rx.ibw, 1) + ' kg', 'Broca 改良公式：身高(cm) − 105'],
      ['BMI', n(rx.bmi, 1) + ' kg/m²', '中国标准：<18.5 消瘦 / 18.5～23.9 正常 / 24～27.9 超重 / ≥28 肥胖'],
      ['每日能量', n(rx.energy) + ' kcal', rx.coef + ' kcal/kg 理想体重 × ' + rx.bodyTypeLabel],
      ['碳水化合物', n(rx.choG) + ' g', n(rx.choPct, 1) + '%E（指南 45%～60%）'],
      ['蛋白质', n(rx.proG) + ' g', rx.proKg !== undefined ? '' : rx.proPerKg + ' g/kg（可接受 ' + rx.proRangeG[0] + '～' + rx.proRangeG[1] + ' g）'],
      ['脂肪', n(rx.fatG) + ' g', n(rx.fatPct, 1) + '%E（建议 20%～30%）'],
      ['膳食纤维', n(rx.fiberG) + ' g', '按 14 g/1000 kcal 折算'],
      ['交换份总量', n(rx.exchTotal, 1) + ' 份', '1 交换份 = 90 kcal']
    ].map(function (row) {
      return '<div class="item"><span>' + esc(row[0]) + '</span><b>' + esc(row[1]) + '</b><span>' + esc(row[2] || '') + '</span></div>';
    }).join('');

    if (document.activeElement !== $('mEnergy')) $('mEnergy').value = rx.energy;
    if (document.activeElement !== $('mChoPct')) $('mChoPct').value = n(rx.choPct, 1);
    if (document.activeElement !== $('mProPerKg')) $('mProPerKg').value = rx.proPerKg;
    if (document.activeElement !== $('mFatPct')) $('mFatPct').value = rx.fatPct;
    if (document.activeElement !== $('mFiber')) $('mFiber').value = rx.fiberG;

    $('macroTbl').innerHTML = '<thead><tr><th>营养素</th><th class="num">目标量</th><th class="num">供能比</th><th>说明</th></tr></thead><tbody>' +
      [['能量', n(rx.energy) + ' kcal', '—', '按理想体重 × 活动系数'],
       ['碳水化合物', n(rx.choG) + ' g', n(rx.choPct, 1) + '%', '优选低 GI、全谷杂豆 ≥1/3'],
       ['蛋白质', n(rx.proG) + ' g', rx.proPct + '%', '优质蛋白 ≥50%，分散到各餐'],
       ['脂肪', n(rx.fatG) + ' g', n(rx.fatPct, 1) + '%', '饱和脂肪 <7%E，烹调油 25～30 g'],
       ['膳食纤维', n(rx.fiberG) + ' g', '—', '全谷、蔬菜、豆类、坚果']
      ].map(function (r) { return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td><td class="hint">' + r[3] + '</td></tr>'; }).join('') +
      '</tbody>';

    $('macroWarn').innerHTML = (rx.warnings || []).map(function (w) { return '· ' + esc(w); }).join('<br>');
  }

  /* ------------------------------------------------------- ② 配餐模板 */
  function readMealPct() {
    var preset = $('mealPreset').value;
    if (preset === 'custom') {
      var out = {};
      document.querySelectorAll('#mealPctBox input[data-meal]').forEach(function (inp) {
        out[inp.getAttribute('data-meal')] = (+inp.value || 0) / 100;
      });
      return Object.keys(out).length ? out : null;
    }
    return null;
  }

  function renderMealPctBox() {
    var preset = $('mealPreset').value;
    var meals = (P.PRESETS[preset] || P.PRESETS.three_snack).meals;
    if (state.opts.mealPct && preset === 'custom') meals = state.opts.mealPct;
    var box = $('mealPctBox');
    box.innerHTML = '<div class="row wrap" style="align-items:flex-end">' + Object.keys(meals).map(function (k) {
      var def = P.MEAL_DEF[k] || {};
      return '<label>' + esc(def.label || k) + '（' + esc(def.time || '') + '）%' +
        '<input type="number" min="0" max="60" step="1" data-meal="' + k + '" value="' + Math.round(meals[k] * 100) + '" ' +
        (preset === 'custom' ? '' : 'readonly') + '></label>';
    }).join('') + '</div>' +
      (preset === 'custom' ? '<p class="hint">自定义模式：可直接修改各餐百分比，合计应为 100%（程序会按比例归一）。</p>'
        : '<p class="hint">选择「自定义」后可修改各餐百分比。</p>');
  }

  function generatePlan(silent) {
    var rx = computeRx();
    var opts = {
      preset: $('mealPreset').value === 'custom' ? 'three_snack' : $('mealPreset').value,
      flavor: $('flavorPref').value,
      profile: state.profile,
      mealPct: readMealPct(),
      lowGIPrefer: $('flavorPref').value === 'lowgi'
    };
    // 主食分配策略微调
    var strat = $('carbStrategy').value;
    if (strat === 'front' || strat === 'back') {
      var base = Object.assign({}, (P.PRESETS[opts.preset] || P.PRESETS.three_snack).meals);
      var keys = Object.keys(base);
      if (keys.length) {
        var adj = strat === 'front' ? 0.03 : -0.03;
        base[keys[0]] = Math.max(0.05, base[keys[0]] + adj);
        var last = keys.filter(function (k) { return !/加餐/.test((P.MEAL_DEF[k] || {}).label || ''); }).pop() || keys[keys.length - 1];
        base[last] = Math.max(0.05, base[last] - adj);
        opts.mealPct = base;
      }
    }
    if (opts.preset === 'gastroparesis') opts.preset = 'gastroparesis';
    var res = P.buildDay(rx, opts);
    state.opts = { preset: opts.preset, flavor: opts.flavor, mealPct: opts.mealPct };
    state.plan = res.plan;
    state.day = res.day;
    state.checks = res.checks;
    state.iterations = res.iterations;
    state.rx = rx;
    renderPlan();
    if (!silent) renderAdjustedPlan();
  }

  function renderPlan() {
    var plan = state.plan, rx = state.rx, day = state.day;
    if (!plan) return;
    var html = '';
    plan.meals.forEach(function (m, mi) {
      var rows = m.items.map(function (it, ii) {
        var f = it.food;
        return '<tr>' +
          '<td>' + esc(f.name) + (it.dry ? ' <span class="badge warn">生重</span>' : '') + (it.swappedFrom ? ' <span class="badge info">已替换</span>' : '') + '</td>' +
          '<td>' + esc(catLabel(it.cat)) + '</td>' +
          '<td class="num">' + n(it.exch, 2) + '</td>' +
          '<td class="num">' + n(it.grams) + '</td>' +
          '<td class="hint">' + esc(portionText(it)) + '</td>' +
          '<td class="num">' + n(f.kcal * it.grams / 100) + '</td>' +
          '<td class="num">' + n(f.pro * it.grams / 100, 1) + '</td>' +
          '<td class="num">' + n(f.fat * it.grams / 100, 1) + '</td>' +
          '<td class="num">' + n(f.cho * it.grams / 100, 1) + '</td>' +
          '<td class="num">' + (f.fibEst ? '≈' : '') + n(f.fib * it.grams / 100, 1) + '</td>' +
          '<td class="num">' + giText(f) + '</td>' +
          '<td class="num">' + glText(f, it.grams) + '</td>' +
          '<td class="no-print"><button class="btn ghost mini" data-swap-meal="' + mi + '" data-swap-item="' + ii + '">替换</button></td>' +
          '</tr>';
      }).join('');
      var nut = m.nutri;
      html += '<div class="card" style="box-shadow:none">' +
        '<h3>' + esc(m.label) + ' <span class="badge">' + esc(m.time || '') + '</span> ' +
        badge(n(m.pctActual, 0) + '% 能量', 'info') + ' ' + badge(n(nut.kcal) + ' kcal', 'ok') +
        ' ' + badge('GL ' + n(nut.gl, 1), nut.gl > 25 ? 'warn' : 'ok') +
        ' ' + badge('蛋白 ' + n(nut.pro, 1) + ' g', '') + '</h3>' +
        '<div class="scroll-x"><table class="tbl compact"><thead><tr>' +
        '<th>食物（可食部）</th><th>分类</th><th class="num">交换份</th><th class="num">克数</th><th>家常计量</th>' +
        '<th class="num">能量</th><th class="num">蛋白</th><th class="num">脂肪</th><th class="num">碳水</th><th class="num">纤维</th><th class="num">GI</th><th class="num">GL</th><th class="no-print"></th>' +
        '</tr></thead><tbody>' + rows +
        '<tr class="total"><td colspan="5">本餐合计</td><td class="num">' + n(nut.kcal) + '</td><td class="num">' + n(nut.pro, 1) +
        '</td><td class="num">' + n(nut.fat, 1) + '</td><td class="num">' + n(nut.cho, 1) + '</td><td class="num">' + n(nut.fib, 1) +
        '</td><td class="num">' + (nut.giAvg == null ? '—' : n(nut.giAvg, 1)) + '</td><td class="num">' + n(nut.gl, 1) + '</td><td class="no-print"></td></tr>' +
        '</tbody></table></div></div>';
    });

    // 全天汇总行
    html += '<div class="card" style="box-shadow:none"><h3>全天合计</h3>' +
      '<table class="tbl compact"><thead><tr><th>项目</th><th class="num">食谱合计</th><th class="num">目标</th><th>评价</th></tr></thead><tbody>' +
      dayRow('能量（成分表）', n(day.kcal) + ' kcal', n(rx.energy) + ' kcal', Math.abs(day.kcal - rx.energy) / rx.energy <= 0.07) +
      dayRow('能量（按 4/4/9 折算）', n(day.macroKcal) + ' kcal', n(rx.energy) + ' kcal', Math.abs(day.macroKcal - rx.energy) / rx.energy <= 0.03) +
      dayRow('碳水化合物', n(day.cho) + ' g', n(rx.choG) + ' g', Math.abs(day.cho - rx.choG) / rx.choG <= 0.08) +
      dayRow('蛋白质', n(day.pro) + ' g', rx.proRangeG[0] + '～' + rx.proRangeG[1] + ' g', day.pro >= rx.proRangeG[0] * 0.95 && day.pro <= rx.proRangeG[1] * 1.05) +
      dayRow('脂肪', n(day.fat) + ' g', n(rx.fatG) + ' g', Math.abs(day.fat - rx.fatG) / rx.fatG <= 0.12) +
      dayRow('膳食纤维', n(day.fib, 1) + ' g', '≥ ' + n(rx.fiberG) + ' g', day.fib >= rx.fiberG * 0.9) +
      dayRow('钠（食物本身）', n(day.na) + ' mg', '< 2000 mg', day.na < 2000) +
      dayRow('胆固醇', n(day.chol) + ' mg', '参考 < 300 mg', day.chol < 450) +
      dayRow('血糖负荷 GL', n(day.gl, 1), '理想 ≤ 80', day.gl <= 110) +
      dayRow('平均 GI（按碳水）', day.giAvg == null ? '—' : n(day.giAvg, 1), '≤ 55 低 GI', day.giAvg != null && day.giAvg <= 60) +
      '</tbody></table>' +
      '<p class="hint">校准轮次 ' + (state.iterations || 1) + '；食物克数均为可食部重量，标「生重」者按干重（未蒸煮）计。' +
      '成分表「能量」与 4/4/9 折算值通常相差 3%～5%，属数据口径差异。</p></div>';

    $('planWrap').innerHTML = html;
    renderDayNutri();
    renderGlycemic();
    renderChecks();
    bindPlanSwapButtons();
  }

  function dayRow(name, actual, target, pass) {
    return '<tr><td>' + esc(name) + '</td><td class="num">' + esc(actual) + '</td><td class="num">' + esc(target) +
      '</td><td>' + (pass ? badge('达标', 'ok') : badge('需关注', 'warn')) + '</td></tr>';
  }

  function barLine(label, actual, target, unit, fmt) {
    var pct = target > 0 ? actual / target * 100 : 0;
    var cls = pct > 115 ? 'over' : (pct < 85 ? 'low' : '');
    return '<div class="nutri-line"><div class="lab"><span>' + esc(label) + '</span><span>' +
      n(actual, fmt == null ? 0 : fmt) + ' / ' + n(target, fmt == null ? 0 : fmt) + ' ' + esc(unit || '') +
      '（' + n(pct, 0) + '%）</span></div><div class="bar"><i class="' + cls + '" style="width:' + Math.min(100, pct) + '%"></i></div></div>';
  }

  function renderDayNutri() {
    var d = state.day, rx = state.rx;
    if (!d) return;
    var ratio = d.kcal > 0 ? d.macroKcal / d.kcal : 1;
    $('dayNutri').innerHTML =
      barLine('能量', d.kcal, rx.energy, 'kcal') +
      barLine('碳水化合物', d.cho, rx.choG, 'g', 0) +
      barLine('蛋白质', d.pro, rx.proG, 'g', 0) +
      barLine('脂肪', d.fat, rx.fatG, 'g', 0) +
      barLine('膳食纤维', d.fib, rx.fiberG, 'g', 1) +
      barLine('钠（食物本身）', d.na, 2000, 'mg', 0) +
      '<table class="tbl compact" style="margin-top:10px"><tbody>' +
      '<tr><td>供能比（碳水 / 蛋白 / 脂肪）</td><td class="num">' +
      n(d.cho * 4 / d.macroKcal * 100, 0) + '% / ' + n(d.pro * 4 / d.macroKcal * 100, 0) + '% / ' + n(d.fat * 9 / d.macroKcal * 100, 0) + '%</td></tr>' +
      '<tr><td>胆固醇 / 钾</td><td class="num">' + n(d.chol) + ' mg / ' + n(d.k) + ' mg</td></tr>' +
      '<tr><td>食物总重量（可食部）</td><td class="num">' + n(d.mass) + ' g</td></tr>' +
      '</tbody></table>';
  }

  function renderGlycemic() {
    var plan = state.plan, day = state.day;
    if (!plan) return;
    var high = [];
    plan.meals.forEach(function (m) {
      m.items.forEach(function (it) {
        if (it.food.gi != null && it.food.gi >= 70) high.push({ m: m.label, f: it.food, g: it.grams, it: it });
      });
    });
    $('glycemicBox').innerHTML =
      plan.meals.map(function (m) {
        var pct = Math.min(100, m.nutri.gl / 40 * 100);
        return '<div class="nutri-line"><div class="lab"><span>' + esc(m.label) + '（碳水 ' + n(m.nutri.cho, 0) + ' g，平均 GI ' +
          (m.nutri.giAvg == null ? '—' : n(m.nutri.giAvg, 0)) + '）</span><span>GL ' + n(m.nutri.gl, 1) + '</span></div>' +
          '<div class="bar"><i class="' + (m.nutri.gl > 25 ? 'over' : '') + '" style="width:' + pct + '%"></i></div></div>';
      }).join('') +
      '<p class="hint">单餐 GL ≤25 更有利于餐后血糖平稳；本方案全天 GL <b>' + n(day.gl, 1) + '</b>，平均 GI <b>' +
      (day.giAvg == null ? '—' : n(day.giAvg, 1)) + '</b>。</p>' +
      (high.length ? '<div class="note warn"><b>高 GI（≥70）食物提示：</b><ul>' + high.map(function (h) {
        return '<li>' + esc(h.m) + '：' + esc(h.f.name) + ' ' + n(h.g) + ' g（GI ' + n(h.f.gi) + '）→ 可在第③步按碳水等价替换为低 GI 品种</li>';
      }).join('') + '</ul></div>' : '<div class="note ok">本方案未使用 GI ≥70 的主食类食物。</div>');
  }

  function renderChecks() {
    var checks = state.checks || [];
    var key = checks.filter(function (c) { return c.level === 'key'; });
    var watch = checks.filter(function (c) { return c.level !== 'key'; });
    var passed = key.filter(function (c) { return c.pass; }).length;
    $('checkTbl').innerHTML =
      '<thead><tr><th>项目</th><th>目标</th><th>本次食谱</th><th>结果</th></tr></thead><tbody>' +
      '<tr class="sub"><td colspan="4">关键项目 ' + passed + ' / ' + key.length + ' 达标</td></tr>' +
      key.map(checkRow).join('') +
      '<tr class="sub"><td colspan="4">关注项目（参考值，需结合个体情况判断）</td></tr>' +
      watch.map(checkRow).join('') +
      '</tbody>';
  }
  function checkRow(c) {
    return '<tr><td>' + esc(c.name) + '</td><td class="hint">' + esc(c.target) + '</td><td>' + esc(c.actual) +
      '<div class="hint">' + esc(c.note) + '</div></td><td>' + (c.pass ? badge('达标', 'ok') : badge('需关注', 'warn')) + '</td></tr>';
  }

  /* ------------------------------------------- 食谱内逐项替换（平替） */
  function bindPlanSwapButtons() {
    document.querySelectorAll('#planWrap button[data-swap-meal]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mi = +btn.getAttribute('data-swap-meal'), ii = +btn.getAttribute('data-swap-item');
        openInlineSwap(mi, ii, btn);
      });
    });
  }

  function openInlineSwap(mi, ii, btn) {
    var m = state.plan.meals[mi], it = m.items[ii];
    var cands = P.swapCandidates(it.food, 'carb', { sameCat: true, lowGI: false })
      .filter(function (c) { return c.food.cat === it.food.cat; });
    var box = document.createElement('div');
    box.className = 'note';
    box.innerHTML = '<b>把「' + esc(it.food.name) + '（' + n(it.exch, 2) + ' 交换份）替换为：</b>' +
      '<div class="cand-list">' + cands.slice(0, 40).map(function (c, k) {
        var g = Math.round(it.exch / c.food.exch100 * 100 / 5) * 5;
        return '<div class="cand" data-k="' + k + '"><div><b>' + esc(c.food.name) + '</b> <span class="g">' +
          n(g) + ' g（' + esc(portionText({ food: c.food, grams: g, dry: P.isDry(c.food) })) + '）</span>' +
          '<div class="d">能量 ' + n(c.food.kcal * g / 100) + ' kcal · 碳水 ' + n(c.food.cho * g / 100, 1) +
          ' g · 纤维 ' + n(c.food.fib * g / 100, 1) + ' g · GI ' + giText(c.food) + '</div></div>' +
          '<button class="btn mini">替换</button></div>';
      }).join('') + '</div>';
    btn.parentNode.appendChild(box);
    box.querySelectorAll('.cand').forEach(function (el) {
      el.addEventListener('click', function () {
        var c = cands[+el.getAttribute('data-k')];
        var grams = Math.round(it.exch / c.food.exch100 * 100 / 5) * 5;
        m.items[ii] = {
          food: c.food, exch: it.exch, grams: grams, rawGrams: grams,
          dry: P.isDry(c.food), cat: c.food.cat, swappedFrom: it.food.name
        };
        m.nutri = P.sumItems(m.items);
        state.day = P.sumMeals(state.plan.meals);
        state.checks = P.runChecks(state.day, state.rx, state.profile, { meals: state.plan.meals, preset: state.plan.preset });
        renderPlan();
        renderAdjustedPlan();
      });
    });
  }

  /* ---------------------------------------------------------- ③ 平替 */
  function renderSwapFromOptions() {
    var groups = {};
    P.DB.forEach(function (f) { (groups[f.cat] = groups[f.cat] || []).push(f); });
    var html = Object.keys(groups).map(function (c) {
      return '<optgroup label="' + esc(catLabel(c)) + '">' + groups[c].map(function (f) {
        return '<option value="' + esc(f.name) + '">' + esc(f.name) + '（GI ' + giText(f) + '，' + n(f.kcal) + ' kcal/100g）</option>';
      }).join('') + '</optgroup>';
    }).join('');
    $('swapFrom').innerHTML = html;
    if (state.swapFrom) $('swapFrom').value = state.swapFrom;
  }

  function renderSwapCandidates() {
    var name = $('swapFrom').value;
    var src = P.F(name);
    if (!src) return;
    state.swapFrom = name;
    var mode = $('swapMode').value;
    var cands = P.swapCandidates(src, mode, {
      sameCat: $('swapSameCat').checked,
      lowGI: $('swapLowGI').checked
    });
    if (!cands.length) {
      $('swapCandidates').innerHTML = '<p class="hint">没有找到合适的等价替换项，可放宽筛选条件（如取消「仅显示 GI 不高于原食材」）。</p>';
      return;
    }
    $('swapCandidates').innerHTML = '<p class="hint">共 ' + cands.length + ' 个候选，按「GI → 全谷杂豆优先 → 膳食纤维」排序（已按' +
      ({ carb: '碳水', energy: '能量', protein: '蛋白质' }[mode]) + '等价计算克数）：</p>' +
      (cands.some(function (c) { return c.food.tags.indexOf('pureCarb') >= 0; }) ?
        '<div class="note warn">列表中的粉丝、粉条、藕粉等纯淀粉制品 GI 虽低，但几乎只提供淀粉（蛋白质、维生素、矿物质与膳食纤维极少），不建议作为主食主力，仅作偶尔替换。</div>' : '') +
      '<div class="cand-list">' + cands.slice(0, 80).map(function (c, k) {
        var f = c.food;
        return '<div class="cand" data-k="' + k + '"><div><b>' + esc(f.name) + '</b> <span class="g">' +
          n(c.grams) + ' g · ' + n(f.exch100 * c.grams / 100, 2) + ' 交换份</span>' +
          '<div class="d">能量 ' + n(f.kcal * c.grams / 100) + ' kcal（Δ ' + (c.delta.kcal > 0 ? '+' : '') + n(c.delta.kcal, 0) +
          '）· 碳水 ' + n(f.cho * c.grams / 100, 1) + ' g（Δ ' + (c.delta.cho > 0 ? '+' : '') + n(c.delta.cho, 1) +
          '）· 纤维 ' + n(f.fib * c.grams / 100, 1) + ' g · GI ' + giText(f) + '</div></div>' +
          '<button class="btn ghost mini">对比</button></div>';
      }).join('') + '</div>';
    $('swapCandidates').querySelectorAll('.cand').forEach(function (el) {
      el.addEventListener('click', function () { renderSwapCompare(src, cands[+el.getAttribute('data-k')], mode); });
    });
  }

  function renderSwapCompare(src, cand, mode) {
    var f = cand.food, g = cand.grams;
    function line(label, a, b, unit, d) {
      var delta = b - a;
      return '<tr><td>' + label + '</td><td class="num">' + n(a, d) + '</td><td class="num">' + n(b, d) +
        '</td><td class="num">' + (delta > 0 ? '+' : '') + n(delta, d) + ' ' + (unit || '') + '</td></tr>';
    }
    var aG = 100, bG = g;
    $('swapCompare').innerHTML =
      '<h3>等量替换（按' + ({ carb: '碳水', energy: '能量', protein: '蛋白质' }[mode]) + '等价）</h3>' +
      '<p><b>' + esc(src.name) + ' 100 g</b> ⇄ <b>' + esc(f.name) + ' ' + n(g) + ' g</b>（' +
      esc(portionText({ food: f, grams: g, dry: P.isDry(f) })) + '）</p>' +
      '<table class="tbl compact"><thead><tr><th>项目</th><th class="num">' + esc(src.name) + '</th><th class="num">' +
      esc(f.name) + '</th><th class="num">差值</th></tr></thead><tbody>' +
      line('能量 kcal', src.kcal, f.kcal * bG / 100, '', 0) +
      line('蛋白质 g', src.pro, f.pro * bG / 100, '', 1) +
      line('脂肪 g', src.fat, f.fat * bG / 100, '', 1) +
      line('碳水 g', src.cho, f.cho * bG / 100, '', 1) +
      line('膳食纤维 g', src.fib, f.fib * bG / 100, '', 1) +
      line('GI', src.gi == null ? 0 : src.gi, f.gi == null ? 0 : f.gi, '', 0) +
      line('GL', src.gi == null ? 0 : src.gi * src.cho / 100, f.gi == null ? 0 : f.gi * f.cho * bG / 10000, '', 1) +
      '</tbody></table>' +
      '<p class="hint">数据来源：' + esc(src.giSrc || '') + '<br>' + esc(f.giSrc || '') + '</p>' +
      '<div class="row"><button class="btn" id="btnApplySwap">应用到食谱中的同类食材</button></div>';
    $('btnApplySwap').addEventListener('click', function () { applySwapToPlan(src, f); });
  }

  function applySwapToPlan(src, newFood) {
    if (!state.plan) return alert('请先生成配餐模板。');
    var count = 0;
    state.plan.meals.forEach(function (m) {
      m.items.forEach(function (it, k) {
        if (it.food.name !== src.name) return;
        var grams = Math.round(it.exch / newFood.exch100 * 100 / 5) * 5;
        m.items[k] = { food: newFood, exch: it.exch, grams: grams, rawGrams: grams, dry: P.isDry(newFood), cat: newFood.cat, swappedFrom: src.name };
        count++;
      });
      m.nutri = P.sumItems(m.items);
    });
    if (!count) return alert('当前食谱中没有「' + src.name + '」，可在第②步的食谱表格中逐项替换。');
    state.day = P.sumMeals(state.plan.meals);
    state.checks = P.runChecks(state.day, state.rx, state.profile, { meals: state.plan.meals, preset: state.plan.preset });
    renderPlan();
    renderAdjustedPlan();
    alert('已替换 ' + count + ' 处。');
  }

  /* ---------------------------------------------------- 食物成分查询 */
  function renderFoodTable() {
    var kw = $('foodSearch').value.trim();
    var cat = $('foodCatFilter').value;
    var sort = $('foodSort').value;
    var list = P.DB.filter(function (f) {
      if (cat && f.cat !== cat) return false;
      if (kw && f.name.indexOf(kw) < 0 && (f.srcCat || '').indexOf(kw) < 0) return false;
      return true;
    });
    list.sort(function (a, b) {
      if (sort === 'gi') return (a.gi == null ? 999 : a.gi) - (b.gi == null ? 999 : b.gi);
      if (sort === 'gl') return (a.gi == null ? 999 : a.gi * a.cho) - (b.gi == null ? 999 : b.gi * b.cho);
      if (sort === 'kcal') return a.kcal - b.kcal;
      return a.name.localeCompare(b.name, 'zh');
    });
    $('foodTbl').innerHTML = '<thead><tr><th>食物（每 100 g 可食部）</th><th>分类</th><th class="num">能量</th>' +
      '<th class="num">蛋白</th><th class="num">脂肪</th><th class="num">碳水</th><th class="num">纤维</th>' +
      '<th class="num">GI</th><th class="num">GL</th><th class="num">交换份</th><th>家常计量 / 数据来源</th></tr></thead><tbody>' +
      list.map(function (f) {
        return '<tr><td>' + esc(f.name) + '</td><td>' + esc(catLabel(f.cat)) + '</td>' +
          '<td class="num">' + n(f.kcal) + '</td><td class="num">' + n(f.pro, 1) + '</td><td class="num">' + n(f.fat, 1) +
          '</td><td class="num">' + n(f.cho, 1) + '</td><td class="num">' + (f.fibEst ? '≈' : '') + n(f.fib, 1) +
          '</td><td class="num">' + giText(f) + '</td><td class="num">' + (f.gi == null ? '—' : n(f.gi * f.cho / 100, 1)) +
          '</td><td class="num">' + n(f.exch100, 2) + '</td><td class="hint">' + esc(f.unitName || '—') +
          '<br>' + esc((f.srcCat || '') + '　' + (f.giSrc || '')) + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function renderFoodStat() {
    var stat = {};
    P.DB.forEach(function (f) { stat[f.cat] = (stat[f.cat] || 0) + 1; });
    var withGI = P.DB.filter(function (f) { return f.gi != null; }).length;
    $('foodStatTbl').innerHTML = '<thead><tr><th>分类</th><th class="num">条目数</th><th>说明</th></tr></thead><tbody>' +
      Object.keys(stat).map(function (c) {
        return '<tr><td>' + esc(catLabel(c)) + '</td><td class="num">' + stat[c] + '</td><td class="hint">' +
          esc((P.CAT_META[c] || {}).role || '') + '</td></tr>';
      }).join('') +
      '<tr class="total"><td>合计</td><td class="num">' + P.DB.length + '</td><td class="hint">其中含 GI 值 ' + withGI +
      ' 条；' + esc(window.DATA_VERSION || '') + '</td></tr></tbody>';
  }

  /* -------------------------------------------------- ④ 血糖 · 运动 */
  function readGlucoseInput() {
    var now = $('gTime').value ? new Date($('gTime').value) : new Date();
    return {
      now: now,
      bg: +$('gValue').value,
      trend: $('gTrend').value,
      phase: $('gPhase').value,
      sinceMeal: +$('gSinceMeal').value || null,
      symptoms: $('gSymptoms').value,
      next: $('gNext').value,
      exIntensity: $('gExIntensity').value,
      exMin: +$('gExMin').value || 30,
      ketone: $('gKetone').value,
      profile: state.profile
    };
  }

  function runGlucose() {
    var inp = readGlucoseInput();
    if (!inp.bg || inp.bg <= 0) { alert('请输入当前血糖值（mmol/L）。'); return; }
    var res = G.assess(inp, state.rules);
    state.glucose = { input: inp, result: res };
    renderGlucose();
    renderTimeline();
    renderAdjustedPlan();
  }

  function renderGlucose() {
    if (!state.glucose) return;
    var res = state.glucose.result;
    var lv = res.level;
    var badgeEl = $('gLevelBadge');
    badgeEl.textContent = lv.label + ' · ' + res.bg + ' mmol/L';
    badgeEl.className = 'badge ' + lv.color;
    var ex = res.exercise;

    function list(arr) { return arr && arr.length ? '<ul>' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; }

    $('gOut').innerHTML =
      '<div class="note ' + (lv.color === 'danger' ? 'danger' : (lv.color === 'warn' ? 'warn' : 'ok')) + '">' +
      '<b>' + esc(lv.label) + '</b>：' + esc(res.summary) + '<br><span class="hint">本时段参考目标：' + esc(lv.target) + '</span></div>' +
      (res.actions.length ? '<h3>① 立即处理</h3>' + res.actions.map(function (a) {
        return '<div class="note danger"><b>' + esc(a.title) + '</b><br>' + esc(a.detail) + '</div>';
      }).join('') : '') +
      '<h3>② 进餐时间与顺序</h3>' +
      '<div class="note"><b>' + (res.meal.delayMin > 0 ? '建议推迟约 ' + res.meal.delayMin + ' 分钟进餐' : '按计划时间进餐') + '</b><br>' +
      esc(res.meal.reason) + '<br>' + esc(res.meal.order) + '</div>' +
      '<h3>③ 量与种类调整（下一餐）</h3>' +
      '<div class="note ' + (res.meal.carbFactor < 0.95 ? 'warn' : 'ok') + '"><b>主食系数 ×' + n(res.meal.carbFactor, 2) + '</b>（1.00 = 按原食谱）' +
      list(res.meal.notes) + '</div>' +
      '<div class="note"><b>加餐建议：</b>' + esc(res.meal.snackTip) + '</div>' +
      '<h3>④ 运动处方</h3>' +
      '<div class="note ' + (ex.allowed ? '' : 'danger') + '">' +
      '<b>' + (ex.allowed ? '可以运动' : '暂缓运动') + '</b>' +
      (ex.blockReasons.length ? list(ex.blockReasons) : '') +
      (ex.allowed ? '<ul>' +
        '<li>开始时间：<b>' + (ex.startAfterMealMin > 0 ? '餐后约 ' + ex.startAfterMealMin + ' 分钟' : '现在即可') + '</b>（自第一口饭算起，45～90 分钟为宜）</li>' +
        '<li>强度与形式：<b>' + esc(ex.intensityLabel) + '</b></li>' +
        '<li>时长：<b>' + ex.minutes + ' 分钟</b>' + (ex.preCarbG ? '；运动前先补充约 ' + ex.preCarbG + ' g 碳水' : '') + '</li>' +
        '<li>监测：' + ex.monitor.map(function (m) { return esc(m.label); }).join('；') + '</li>' +
        '<li>' + esc(ex.weekly) + '</li>' +
        (ex.reason ? '<li>调整说明：' + esc(ex.reason) + '</li>' : '') +
        '</ul>' : '') +
      (ex.cautions.length ? '<div class="hint" style="margin-top:6px">注意事项：' + ex.cautions.map(esc).join('；') + '</div>' : '') +
      '</div>' +
      '<h3>⑤ 复测计划</h3>' + (res.rechecks.length ?
        '<div class="note"><ul>' + res.rechecks.map(function (r) {
          return '<li>' + esc(r.label) + (r.afterMin > 0 ? '（约 ' + G.hhmm(G.addMin(new Date(), r.afterMin)) + '）' : '') + '</li>';
        }).join('') + '</ul></div>' : '<div class="hint">按常规监测频次执行（如每周 2～4 次配对血糖）。</div>') +
      (res.warnings.length ? '<h3>⑥ 就医预警</h3><div class="note danger">' + list(res.warnings) + '</div>' : '') +
      (state.rules ? '<p class="hint">判定阈值：低血糖 <' + state.rules.hypoLow + '，严重低血糖 <' + state.rules.hypoSerious +
        '，运动前上限 ' + state.rules.exerciseMaxBG + '，运动前下限 ' + state.rules.exerciseMinBG + ' mmol/L（可在第⑤步修改）。</p>' : '');
  }

  function renderTimeline() {
    if (!state.glucose || !state.plan) { $('timeline').innerHTML = '<p class="hint">生成配餐模板并录入血糖后，会显示当日的进餐、加餐、运动与监测时间轴。</p>'; return; }
    var ev = G.buildTimeline(state.glucose.input.now, state.plan.meals, state.glucose.result.exercise, state.glucose.result);
    var kindLabel = { meal: '正餐', snack: '加餐', exercise: '运动', monitor: '监测', carb: '处理' };
    $('timeline').innerHTML = '<div class="timeline">' + ev.map(function (e) {
      return '<div class="tl-row"><div class="tl-time">' + esc(G.hhmm(e.at)) + '</div>' +
        '<div class="tl-kind ' + e.kind + '">' + esc(kindLabel[e.kind] || e.kind) + '</div>' +
        '<div><b>' + esc(e.label) + '</b>' + (e.detail ? '<div class="tl-detail">' + esc(e.detail) + '</div>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  /** 按血糖建议调整当日配餐（改量 + 改种类） */
  function renderAdjustedPlan() {
    var plan = state.plan, res = state.glucose && state.glucose.result;
    if (!plan) { $('adjustedPlan').innerHTML = '<p class="hint">请先在①生成配餐模板。</p>'; return; }
    if (!res) { $('adjustedPlan').innerHTML = '<p class="hint">录入血糖并计算后，这里会显示按血糖调整过的量与种类。</p>'; return; }

    var factor = res.meal.carbFactor, needLow = res.meal.needLowGI;
    // 找出「下一餐」：当前时间之后最近的正餐；若已过晚餐时间，则按次日早餐计算
    var now = state.glucose.input.now;
    var target = null, nextDay = false, firstMain = null;
    state.plan.meals.forEach(function (m) {
      if (/加餐/.test(m.label)) return;
      var hm = /^(\d{1,2}):(\d{2})/.exec(m.time || '');
      if (!hm) return;
      var d = new Date(now); d.setHours(+hm[1], +hm[2], 0, 0);
      if (!firstMain) firstMain = { m: m, at: d };
      if (d >= now && (!target || d < target.at)) target = { m: m, at: d };
    });
    if (!target) { target = firstMain; nextDay = true; }
    target = target ? target.m : state.plan.meals[0];

    var adj = JSON.parse(JSON.stringify({ label: target.label, items: target.items.map(function (it) {
      return { cat: it.cat, exch: it.exch, grams: it.grams, dry: it.dry, food: it.food.name };
    }) }));

    var lowGIGrain = P.DB.filter(function (f) { return f.cat === 'grain' && f.gi != null && f.gi <= 55; })
      .sort(function (a, b) { return a.gi - b.gi; });
    var rows = adj.items.map(function (it) {
      var f = P.F(it.food);
      var grams = it.grams, note = [];
      if (it.cat === 'grain') {
        grams = Math.max(10, Math.round(it.grams * factor / 5) * 5);
        if (factor !== 1) note.push('量 ×' + n(factor, 2));
        if (needLow && f.gi != null && f.gi > 55 && lowGIGrain.length) {
          var rep = lowGIGrain[0];
          var g2 = Math.round(it.exch / rep.exch100 * 100 / 5) * 5;
          note.push('换成低 GI：' + rep.name);
          return { name: rep.name, grams: g2, note: note.join('，'), kcal: rep.kcal * g2 / 100, cho: rep.cho * g2 / 100 };
        }
      }
      return { name: f.name, grams: grams, note: note.join('，'), kcal: f.kcal * grams / 100, cho: f.cho * grams / 100 };
    });

    var carbAdj = rows.filter(function (r) { return true; }).reduce(function (a, r) { return a + r.cho; }, 0);
    var carbOri = adj.items.reduce(function (a, it) { return a + P.F(it.food).cho * it.grams / 100; }, 0);

    $('adjustedPlan').innerHTML =
      '<div class="note ' + (factor < 0.95 ? 'warn' : 'ok') + '"><b>' + esc(target.label) + '（' + esc(target.time) + '）调整：</b>' +
      '主食 ×' + n(factor, 2) + (needLow ? '，并把高 GI 主食替换为低 GI 品种' : '') +
      '；本餐可利用碳水由 <b>' + n(carbOri, 0) + ' g</b> 调整为 <b>' + n(carbAdj, 0) + ' g</b>。' +
      (res.meal.delayMin > 0 ? '　进餐时间推迟约 ' + res.meal.delayMin + ' 分钟。' : '') +
      (nextDay ? '　（当前已过晚餐时间，以下按次日' + esc(target.label) + '计算）' : '') + '</div>' +
      '<table class="tbl compact"><thead><tr><th>食物</th><th class="num">原克数</th><th class="num">调整后克数</th>' +
      '<th class="num">能量</th><th class="num">碳水</th><th>说明</th></tr></thead><tbody>' +
      rows.map(function (r, k) {
        return '<tr><td>' + esc(r.name) + '</td><td class="num">' + n(adj.items[k].grams) + '</td><td class="num">' + n(r.grams) +
          '</td><td class="num">' + n(r.kcal) + '</td><td class="num">' + n(r.cho, 1) + '</td><td class="hint">' + esc(r.note || '不变') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="hint">说明：调整仅针对下一餐的主食（碳水是餐后血糖的主要决定因素）；蔬菜与蛋白质按原量执行，必要时可增加非淀粉类蔬菜 100～200 g 增加饱腹感。' +
      '使用胰岛素或促泌剂者，主食量变化应在医生/营养师指导下与药量匹配，切勿自行增减药量。</p>' +
      '<div class="row no-print"><button class="btn ghost" id="btnApplyAdjust">把调整写入配餐模板</button></div>';

    $('btnApplyAdjust').addEventListener('click', function () {
      var byCat = {};
      rows.forEach(function (r, k) {
        var of = P.F(adj.items[k].food);
        if (of.cat !== 'grain') return;
        var nf = P.F(r.name);
        byCat[adj.items[k].exch] = { from: of.name, to: nf.name, grams: r.grams, exch: adj.items[k].exch };
      });
      target.items.forEach(function (it, k) {
        if (it.cat !== 'grain') return;
        var nf = P.F(rows[k] ? rows[k].name : it.food.name);
        if (!nf) return;
        var grams = rows[k] ? rows[k].grams : it.grams;
        target.items[k] = { food: nf, exch: it.exch, grams: grams, rawGrams: grams, dry: P.isDry(nf), cat: 'grain', swappedFrom: it.food.name };
      });
      target.nutri = P.sumItems(target.items);
      state.day = P.sumMeals(state.plan.meals);
      state.checks = P.runChecks(state.day, state.rx, state.profile, { meals: state.plan.meals, preset: state.plan.preset });
      renderPlan();
      renderAdjustedPlan();
    });
  }

  /* ------------------------------------------------------------ CGM */
  function runCGM(readings) {
    if (!readings || !readings.length) { alert('未解析到有效读数，请检查数据格式（时间,血糖）。'); return; }
    var res = G.analyzeCGM(readings, state.rules);
    state.cgm = { res: res, readings: readings };
    renderCGM();
  }

  function renderCGM() {
    if (!state.cgm) return;
    var r = state.cgm.res;
    $('cgmOut').innerHTML =
      '<table class="tbl compact" style="margin-top:10px"><tbody>' +
      '<tr><td>读数条数 / 时间范围</td><td class="num">' + r.n + ' 条，' + r.from.toLocaleString() + ' → ' + r.to.toLocaleString() + '</td></tr>' +
      '<tr><td>平均血糖</td><td class="num">' + n(r.mean, 1) + ' mmol/L（SD ' + n(r.sd, 1) + '，CV ' + n(r.cv, 0) + '%）</td></tr>' +
      '<tr><td>目标范围内时间 TIR（3.9～10.0）</td><td class="num">' + n(r.tir, 0) + '%（严格 3.9～7.8：' + n(r.tirTight, 0) + '%）</td></tr>' +
      '<tr><td>低于目标范围 TBR（<3.9 / <3.0）</td><td class="num">' + n(r.tbr, 0) + '% / ' + n(r.tbr2, 0) + '%</td></tr>' +
      '<tr><td>高于目标范围 TAR（>10.0 / >13.9）</td><td class="num">' + n(r.tar, 0) + '% / ' + n(r.tar2, 0) + '%</td></tr>' +
      '<tr><td>最高 / 最低</td><td class="num">' + n(r.max, 1) + ' / ' + n(r.min, 1) + ' mmol/L</td></tr>' +
      '<tr><td>估算 HbA1c（GMI）</td><td class="num">' + n(r.gmi, 1) + '%</td></tr>' +
      '<tr><td>低血糖事件（连续 ≥15 分钟 <3.9）</td><td class="num">' + r.hypoEvents.length + ' 次</td></tr>' +
      '</tbody></table>' +
      (r.flags.length ? r.flags.map(function (f) {
        return '<div class="note ' + (f.level === 'danger' ? 'danger' : 'warn') + '">' + esc(f.text) + '</div>';
      }).join('') : '<div class="note ok">各项指标均在常用目标范围，继续保持。</div>');
    drawCGMChart(r);
  }

  function drawCGMChart(r) {
    var cv = $('cgmChart');
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, padL = 42, padR = 10, padT = 12, padB = 22;
    var vals = r.readings.map(function (x) { return x.v; });
    var maxV = Math.max(15, Math.ceil(Math.max.apply(null, vals) + 1));
    var minV = Math.max(0, Math.floor(Math.min.apply(null, vals) - 1));
    function x(i) { return padL + (W - padL - padR) * (i / Math.max(1, r.readings.length - 1)); }
    function y(v) { return padT + (H - padT - padB) * (1 - (v - minV) / (maxV - minV)); }
    ctx.clearRect(0, 0, W, H);
    // TIR 区间
    ctx.fillStyle = 'rgba(34,197,94,.10)';
    ctx.fillRect(padL, y(10), W - padL - padR, y(3.9) - y(10));
    // 网格与刻度
    ctx.strokeStyle = '#e5e7eb'; ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif';
    for (var v = Math.ceil(minV / 5) * 5; v <= maxV; v += 5) {
      ctx.beginPath(); ctx.moveTo(padL, y(v)); ctx.lineTo(W - padR, y(v)); ctx.stroke();
      ctx.fillText(v + '', 8, y(v) + 3);
    }
    // 阈值线
    [[3.9, '#dc2626'], [10, '#f59e0b'], [13.9, '#b91c1c']].forEach(function (t) {
      if (t[0] < minV || t[0] > maxV) return;
      ctx.strokeStyle = t[1]; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(padL, y(t[0])); ctx.lineTo(W - padR, y(t[0])); ctx.stroke();
      ctx.setLineDash([]);
    });
    // 曲线
    ctx.strokeStyle = '#0f766e'; ctx.lineWidth = 1.6; ctx.beginPath();
    r.readings.forEach(function (p, i) { i ? ctx.lineTo(x(i), y(p.v)) : ctx.moveTo(x(i), y(p.v)); });
    ctx.stroke();
    // 低血糖点
    ctx.fillStyle = '#dc2626';
    r.readings.forEach(function (p, i) { if (p.v < 3.9) { ctx.beginPath(); ctx.arc(x(i), y(p.v), 2.2, 0, 6.29); ctx.fill(); } });
    // 时间轴标签
    ctx.fillStyle = '#6b7280';
    [0, Math.floor(r.readings.length / 2), r.readings.length - 1].forEach(function (i) {
      var d = r.readings[i].t, lab = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      ctx.fillText(lab, Math.min(W - 34, x(i) - 12), H - 6);
    });
  }

  /* ------------------------------------------------------- 存档 / 导入 */
  function exportData() {
    return {
      patientId: state.patientId, profile: state.profile, opts: state.opts,
      rx: state.rx, rules: state.rules,
      meals: state.plan ? state.plan.meals.map(function (m) {
        return {
          label: m.label, time: m.time, byCat: m.byCat,
          items: m.items.map(function (it) { return { name: it.food.name, exch: it.exch, grams: it.grams, cat: it.cat }; }),
          nutri: m.nutri
        };
      }) : null,
      day: state.day, glucose: state.glucose ? { input: { bg: state.glucose.input.bg, phase: state.glucose.input.phase, trend: state.glucose.input.trend }, level: state.glucose.result.level.label } : null,
      exportedAt: new Date().toISOString()
    };
  }

  function saveToLocal() {
    var all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    var id = state.patientId || ('未命名-' + new Date().toLocaleString());
    all[id] = exportData();
    localStorage.setItem(LS_KEY, JSON.stringify(all));
    renderStoreList();
    alert('已保存到本机浏览器：' + id);
  }

  function renderStoreList() {
    var all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    var keys = Object.keys(all);
    $('storeList').innerHTML = keys.length ? '<table class="tbl compact"><thead><tr><th>编号 / 名称</th><th>能量</th><th>保存时间</th><th></th></tr></thead><tbody>' +
      keys.map(function (k) {
        var d = all[k];
        return '<tr><td>' + esc(k) + '</td><td class="num">' + n(d.rx && d.rx.energy) + ' kcal</td><td class="hint">' +
          esc((d.exportedAt || '').replace('T', ' ').slice(0, 16)) + '</td>' +
          '<td><button class="btn ghost mini" data-load="' + esc(k) + '">读取</button> ' +
          '<button class="btn ghost mini" data-del="' + esc(k) + '">删除</button></td></tr>';
      }).join('') + '</tbody></table>' : '<p class="hint">本机暂无存档。</p>';
    $('storeList').querySelectorAll('button[data-load]').forEach(function (b) {
      b.addEventListener('click', function () { loadFrom(all[b.getAttribute('data-load')]); });
    });
    $('storeList').querySelectorAll('button[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        delete all[b.getAttribute('data-del')];
        localStorage.setItem(LS_KEY, JSON.stringify(all));
        renderStoreList();
      });
    });
  }

  function loadFrom(data, silent) {
    if (!data) return;
    state.patientId = data.patientId || '';
    state.profile = Object.assign(state.profile, data.profile || {});
    state.manual = {};
    fillProfileForm();
    renderProfile();
    if (data.opts) {
      $('mealPreset').value = data.opts.preset || 'three_snack';
      $('flavorPref').value = data.opts.flavor || 'cn';
      if (data.opts.mealPct) { state.opts.mealPct = data.opts.mealPct; $('mealPreset').value = 'custom'; }
      renderMealPctBox();
    }
    state.rules = Object.assign({}, G.DEFAULT_RULES, data.rules || {});
    renderRuleTable();
    generatePlan(true);
    if (data.meals) {
      // 恢复精确食谱
      state.plan.meals.forEach(function (m, i) {
        var sm = data.meals[i]; if (!sm) return;
        m.items = sm.items.map(function (it) {
          var f = P.F(it.name);
          return f ? { food: f, exch: it.exch, grams: it.grams, rawGrams: it.grams, dry: P.isDry(f), cat: f.cat } : null;
        }).filter(Boolean);
        m.nutri = P.sumItems(m.items);
      });
      state.day = P.sumMeals(state.plan.meals);
      state.checks = P.runChecks(state.day, state.rx, state.profile, { meals: state.plan.meals, preset: state.plan.preset });
      renderPlan();
    }
    renderFoodStat();
    if (!silent) alert('已读取存档。');
  }

  /* ------------------------------------------------ 自检（#selftest） */
  function saveToLocalSilent() {
    var all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    all[state.patientId || 'x'] = exportData();
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  }
  function applySwapToPlanSilent(src, nf) {
    state.plan.meals.forEach(function (m) {
      m.items.forEach(function (it, k) {
        if (it.food.name !== src.name) return;
        var grams = Math.round(it.exch / nf.exch100 * 100 / 5) * 5;
        m.items[k] = { food: nf, exch: it.exch, grams: grams, rawGrams: grams, dry: P.isDry(nf), cat: nf.cat, swappedFrom: src.name };
      });
      m.nutri = P.sumItems(m.items);
    });
    state.day = P.sumMeals(state.plan.meals);
  }

  function selfTest() {
    var box = $('selftest');
    if (!box) return;
    box.style.display = 'block';
    var lines = [], fails = 0;
    function ok(cond, msg, extra) {
      if (!cond) fails++;
      lines.push((cond ? '✓ ' : '✗ ') + msg + (extra !== undefined ? '　→ ' + extra : ''));
    }
    try {
      loadDemo();
      var rx = state.rx, day = state.day, plan = state.plan;
      ok(!!rx && rx.energy > 800, '能量处方计算', rx && rx.energy + ' kcal');
      ok(plan.meals.length >= 3, '配餐餐次数', plan.meals.length);
      ok(plan.meals.every(function (m) { return m.items.length > 0 && m.items.every(function (it) { return it.grams > 0; }); }), '每餐均有食物与克数');
      var dev = Math.abs(day.kcal - rx.energy) / rx.energy;
      ok(dev <= 0.1, '全天能量偏差 ≤10%', n(dev * 100, 1) + '%');
      ok(state.checks.length >= 14, '配餐要求自检条目数', state.checks.length);
      ok($('planWrap').innerHTML.length > 2000, '配餐表格已渲染', $('planWrap').innerHTML.length + ' 字符');
      ok($('dayNutri').innerHTML.indexOf('供能比') > 0, '营养对比已渲染');
      ok($('checkTbl').innerHTML.indexOf('关键项目') > 0, '配餐要求自检已渲染');
      ok($('foodTbl').innerHTML.indexOf('<tbody>') > 0, '食物库表格已渲染', P.DB.length + ' 条');
      ok($('swapCandidates').innerHTML.length > 100, '平替候选已渲染');
      var src = P.F('米饭（蒸，代表值）');
      var cands = P.swapCandidates(src, 'carb', { sameCat: true, lowGI: true });
      ok(cands.length > 0, '平替候选生成', cands.length + ' 项');
      var before = plan.meals.map(function (m) { return m.items.map(function (it) { return it.food.name; }).join(); }).join('|');
      applySwapToPlanSilent(src, cands[0].food);
      var after = state.plan.meals.map(function (m) { return m.items.map(function (it) { return it.food.name; }).join(); }).join('|');
      ok(before.indexOf(src.name) < 0 || before !== after, '食谱内替换生效', cands[0].food.name);
      ok(!!state.glucose && !!state.glucose.result.level, '血糖判读', state.glucose && state.glucose.result.level.label);
      var g = G.assess({ now: new Date(), bg: 3.2, trend: 'down2', phase: 'premeal', next: 'meal', profile: state.profile }, state.rules);
      ok(g.level.key === 'hypo' || g.level.key === 'severe_hypo', '低血糖识别', g.level.key);
      ok(g.actions.length > 0 && g.exercise.allowed === false, '低血糖处理动作与运动限制');
      var g2 = G.assess({ now: new Date(), bg: 14.5, trend: 'up2', phase: 'premeal', next: 'meal', ketone: 'pos', profile: state.profile }, state.rules);
      ok(g2.meal.carbFactor < 0.8 && g2.exercise.allowed === false, '高血糖减量与禁止运动', g2.meal.carbFactor);
      ok($('gOut').innerHTML.length > 500, '即时建议已渲染');
      ok($('timeline').innerHTML.indexOf('tl-row') > 0, '时间轴已渲染');
      ok($('adjustedPlan').innerHTML.indexOf('调整') > 0, '调整后配餐已渲染');
      ok(!!state.cgm && state.cgm.res.n > 10, 'CGM 统计', state.cgm && state.cgm.res.n + ' 条读数');
      ok($('cgmOut').innerHTML.indexOf('TIR') > 0, 'CGM 报告已渲染');
      var id = 'SELFTEST'; state.patientId = id; saveToLocalSilent();
      var all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      ok(!!all[id], '本机存档写入');
      loadFrom(all[id], true);
      ok(!!(state.rx && state.plan), '存档读取成功');
      document.querySelectorAll('.tab').forEach(function (t) { t.click(); });
      ok(document.querySelectorAll('.tabpane.active').length === 1, '选项卡切换正常');
    } catch (e) {
      fails++;
      lines.push('✗ 运行异常：' + e.message + '\n' + (e.stack || ''));
    }
    if (window.__errs && window.__errs.length) { fails++; lines.push('✗ 捕获到脚本错误：' + window.__errs.join(' / ')); }
    box.innerHTML = '<h2>自检结果 ' + (fails ? badge(fails + ' 项未通过', 'danger') : badge('全部通过', 'ok')) + '</h2>' +
      '<pre style="white-space:pre-wrap;font-size:12.5px;margin:0">' + esc(lines.join('\n')) + '</pre>';
    document.title = (fails ? 'FAIL:' + fails : 'SELFTEST-OK') + ' — 糖尿病配餐工作台';
    return { fails: fails, lines: lines };
  }

  /* -------------------------------------------------------- 规则设置 */
  function renderRuleTable() {
    var labels = {
      hypoSerious: '严重低血糖阈值（mmol/L）', hypoLow: '低血糖阈值（mmol/L）',
      preMealIdealLow: '空腹/餐前目标下限', preMealIdealHigh: '空腹/餐前目标上限',
      targetLow: 'CGM 目标范围下限', targetHigh: 'CGM 目标范围上限 / 餐后目标',
      veryHigh: '高血糖强化干预阈值', dkaWarn: '警惕 DKA/HHS 阈值',
      sleepTargetLow: '睡前目标下限（防夜间低血糖）', exerciseMinBG: '运动前最低血糖',
      exerciseMaxBG: '运动前最高血糖', preCarbG: '运动前加餐碳水（g）',
      hypoCarbG: '低血糖处理碳水（g）', postMealExerciseMin: '餐后开始运动时间（分钟）'
    };
    $('ruleTbl').innerHTML = '<thead><tr><th>规则</th><th class="num" style="width:120px">取值</th></tr></thead><tbody>' +
      Object.keys(state.rules).filter(function (k) { return labels[k]; }).map(function (k) {
        return '<tr><td>' + esc(labels[k]) + '<div class="hint">' + esc(k) + '</div></td>' +
          '<td class="num"><input type="number" step="0.1" data-rule="' + k + '" value="' + state.rules[k] + '"></td></tr>';
      }).join('') + '</tbody>';
    $('ruleTbl').querySelectorAll('input[data-rule]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        state.rules[inp.getAttribute('data-rule')] = +inp.value;
        localStorage.setItem(LS_RULES, JSON.stringify(state.rules));
      });
    });
  }

  /* ------------------------------------------------------------- 绑定 */
  function bind() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tabpane').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        $(t.getAttribute('data-tab')).classList.add('active');
        if (t.getAttribute('data-tab') === 'tab-data') { renderFoodStat(); renderStoreList(); }
      });
    });

    ['pName', 'pSex', 'pAge', 'pHeight', 'pWeight', 'pActivity', 'pType', 'pTreat', 'pGest', 'pCkd', 'pGoal']
      .forEach(function (id) { $(id).addEventListener('change', function () { renderProfile(); generatePlan(true); }); });
    ['pComorbHtn', 'pComorbLip', 'pComorbGout', 'pComorbGp'].forEach(function (id) {
      $(id).addEventListener('change', function () { renderProfile(); generatePlan(true); });
    });
    $('btnApplyMacro').addEventListener('click', function () {
      state.manual = {
        energy: +$('mEnergy').value, choPct: +$('mChoPct').value,
        proPerKg: +$('mProPerKg').value, fatPct: +$('mFatPct').value, fiber: +$('mFiber').value
      };
      renderProfile();
      generatePlan();
    });
    $('mealPreset').addEventListener('change', function () { renderMealPctBox(); generatePlan(); });
    $('flavorPref').addEventListener('change', function () { generatePlan(); });
    $('carbStrategy').addEventListener('change', function () { generatePlan(); });
    $('btnGenPlan').addEventListener('click', function () { generatePlan(); });
    $('mealPctBox').addEventListener('change', function (e) {
      if (e.target.getAttribute && e.target.getAttribute('data-meal')) {
        $('mealPreset').value = 'custom';
        state.opts.mealPct = readMealPct();
        generatePlan();
      }
    });

    $('swapFrom').addEventListener('change', renderSwapCandidates);
    $('swapMode').addEventListener('change', renderSwapCandidates);
    $('swapLowGI').addEventListener('change', renderSwapCandidates);
    $('swapSameCat').addEventListener('change', renderSwapCandidates);

    $('foodSearch').addEventListener('input', renderFoodTable);
    $('foodCatFilter').addEventListener('change', renderFoodTable);
    $('foodSort').addEventListener('change', renderFoodTable);

    $('btnGlucose').addEventListener('click', runGlucose);
    $('btnGlucoseDemo').addEventListener('click', function () {
      var d = new Date();
      $('gTime').value = d.toISOString().slice(0, 16);
      $('gValue').value = 12.4; $('gTrend').value = 'up2'; $('gPhase').value = 'premeal';
      $('gSinceMeal').value = 240; $('gNext').value = 'meal'; $('gExIntensity').value = 'mod'; $('gExMin').value = 30;
      $('gKetone').value = 'neg';
      runGlucose();
    });
    $('btnCgm').addEventListener('click', function () {
      var txt = $('cgmText').value;
      var parsed = G.parseReadings(txt);
      if (parsed.skipped) console.log('跳过行数：' + parsed.skipped);
      runCGM(parsed.readings);
    });
    $('btnCgmDemo').addEventListener('click', function () {
      var demo = demoCGM();
      $('cgmText').value = demo.map(function (r) { return r.t + ', ' + r.v; }).join('\n');
      runCGM(demo.map(function (r) { return { t: r.t, v: r.v }; }));
    });
    $('cgmFile').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        $('cgmText').value = String(fr.result).slice(0, 200000);
        runCGM(G.parseReadings(String(fr.result)).readings);
      };
      fr.readAsText(f, 'utf-8');
    });

    $('btnSave').addEventListener('click', saveToLocal);
    $('btnLoad').addEventListener('click', function () {
      var all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      var id = state.patientId;
      if (id && all[id]) return loadFrom(all[id]);
      document.querySelector('.tab[data-tab="tab-data"]').click();
      alert('请在「⑤ 数据与设置」中选择要读取的存档。');
    });
    $('btnDemo').addEventListener('click', loadDemo);
    $('btnPrint').addEventListener('click', function () { window.print(); });
    $('btnExport').addEventListener('click', function () {
      var txt = JSON.stringify(exportData(), null, 1);
      $('dataJson').value = txt;
      document.querySelector('.tab[data-tab="tab-data"]').click();
      try {
        var blob = new Blob([txt], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (state.patientId || '糖尿病配餐方案') + '.json';
        a.click();
      } catch (e) { }
    });
    $('btnImport').addEventListener('click', function () {
      try {
        var data = JSON.parse($('dataJson').value);
        loadFrom(data);
      } catch (e) { alert('JSON 解析失败：' + e.message); }
    });
    $('btnStoreRefresh').addEventListener('click', renderStoreList);

    $('btnFoodExport').addEventListener('click', function () {
      var txt = JSON.stringify(P.DB, null, 1);
      var blob = new Blob([txt], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '食物库.json';
      a.click();
    });
    $('foodImport').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var list = JSON.parse(String(fr.result));
          if (!Array.isArray(list)) throw new Error('应为数组');
          if (P.reloadDB(list)) {
            localStorage.setItem(LS_DB, JSON.stringify(list));
            renderSwapFromOptions(); renderFoodTable(); renderFoodStat(); generatePlan(true);
            alert('食物库已更新：' + P.DB.length + ' 条。');
          } else alert('没有可用条目。');
        } catch (err) { alert('导入失败：' + err.message); }
      };
      fr.readAsText(f, 'utf-8');
    });
    $('btnFoodReset').addEventListener('click', function () {
      localStorage.removeItem(LS_DB);
      location.reload();
    });
  }

  function demoCGM() {
    var out = [], base = new Date();
    base.setHours(0, 0, 0, 0);
    for (var i = 0; i < 96; i++) {
      var t = new Date(base.getTime() + i * 15 * 60000);
      var h = t.getHours() + t.getMinutes() / 60;
      var v = 6.4 + Math.sin((h - 6) / 24 * Math.PI * 2) * 2.0;
      if (h > 7.5 && h < 9.5) v += 1.6;          // 早餐后
      if (h > 12.5 && h < 14.5) v += 2.2;        // 午餐后
      if (h > 18.5 && h < 20.5) v += 1.4;        // 晚餐后
      if (h > 15.5 && h < 16.5) v -= 0.9;        // 运动后
      if (i === 22) v = 3.6;                     // 一次低血糖
      out.push({ t: ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2), v: Math.round(v * 10) / 10 });
    }
    return out;
  }

  function loadDemo() {
    state.profile = {
      name: '示例患者（陈某）', sex: 'male', age: 56, height: 172, weight: 78, activity: 'light',
      type: 't2', treat: 'oral_high', gest: 'no', ckd: 'normal', goal: 'maintain',
      comorb: { htn: true, lipid: true, gout: false, gp: false }
    };
    state.patientId = 'DEMO-001';
    state.manual = {};
    fillProfileForm(); renderProfile(); generatePlan();
    var d = new Date();
    $('gTime').value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('gValue').value = 11.6; $('gTrend').value = 'up1'; $('gPhase').value = 'premeal'; $('gSinceMeal').value = 300;
    $('gNext').value = 'meal'; $('gKetone').value = 'neg';
    runGlucose();
    $('btnCgmDemo').click();
    document.querySelector('.tab[data-tab="tab-plan"]').click();
  }

  /* ------------------------------------------------------------- 启动 */
  function init() {
    // 自定义食物库 / 规则
    try {
      var custom = JSON.parse(localStorage.getItem(LS_DB) || 'null');
      if (custom && custom.length) P.reloadDB(custom);
      var rules = JSON.parse(localStorage.getItem(LS_RULES) || 'null');
      if (rules) state.rules = Object.assign({}, G.DEFAULT_RULES, rules);
    } catch (e) { }
    $('verTag').textContent = '数据版本：' + (window.DATA_VERSION || '—') + '｜引擎：配餐 ' + P.DB.length + ' 条食物';
    $('foodCatFilter').innerHTML = '<option value="">全部分类</option>' + Object.keys(P.CAT_META).map(function (c) {
      return '<option value="' + c + '">' + esc(catLabel(c)) + '</option>';
    }).join('');
    fillProfileForm();
    renderMealPctBox();
    renderProfile();
    generatePlan();
    renderSwapFromOptions();
    renderSwapCandidates();
    renderFoodTable();
    renderFoodStat();
    renderStoreList();
    renderRuleTable();
    $('timeline').innerHTML = '<p class="hint">生成配餐模板并录入血糖后，会显示当日的进餐、加餐、运动与监测时间轴。</p>';
    bind();
    // 地址栏参数：#demo 载入示例、#tab-plan 等定位选项卡、#selftest 运行界面自检（可用逗号组合）
    var parts = (location.hash || '').replace('#', '').split(',');
    if (parts.indexOf('demo') >= 0) loadDemo();
    parts.forEach(function (h) {
      if (h.indexOf('tab-') === 0 && document.getElementById(h)) {
        var tb = document.querySelector('.tab[data-tab="' + h + '"]');
        if (tb) tb.click();
      }
    });
    if (parts.indexOf('selftest') >= 0) setTimeout(selfTest, 60);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
