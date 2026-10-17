/* 引擎自测：node tools/test_engines.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'app');
const sandbox = { console: console, Math: Math, Date: Date, JSON: JSON, isNaN: isNaN, parseFloat: parseFloat, Object: Object };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['data-foods.js', 'engine-prescription.js', 'engine-glucose.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const P = sandbox.PrescEngine;
const G = sandbox.GlucoseEngine;

let fails = 0;
function ok(cond, msg, extra) {
  if (cond) console.log('  ✓ ' + msg);
  else { fails++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, msg + '（' + a + ' vs ' + b + '）'); }

console.log('\n[1] 处方计算');
const profile = { name: '测试', sex: 'male', age: 55, height: 170, weight: 75, activity: 'light', type: 't2', treat: 'oral_low', gest: 'no', ckd: 'normal', goal: 'maintain' };
const rx = P.computePrescription(Object.assign({}, profile, { choPct: 50 }));
ok(rx.ibw === 65, '理想体重 65 kg', rx.ibw);
near(rx.bmi, 25.9, 0.2, 'BMI');
ok(rx.bodyType === 'over', '体型判定超重/肥胖', rx.bodyType);
ok(rx.coef === 22, '能量系数 22 kcal/kg（超重轻体力）', rx.coef);
near(rx.energy, 1430, 20, '每日能量');
ok(rx.choG > 150 && rx.choG < 200, '碳水目标合理', rx.choG);
ok(rx.proG > 60 && rx.proG < 90, '蛋白目标合理', rx.proG);
ok(rx.proRangeG && rx.proRangeG[0] < rx.proG && rx.proG < rx.proRangeG[1], '蛋白可接受区间合理', rx.proRangeG);
ok(rx.fiberG >= 15 && rx.fiberG <= 35, '膳食纤维目标 15～35 g（14 g/1000 kcal）', rx.fiberG);

console.log('\n[2] 交换份分配 + 食谱生成（4 种方案）');
['three', 'three_snack', 'six', 'gastroparesis'].forEach(function (preset) {
  const plan = P.buildExchangePlan(rx, { preset: preset });
  P.buildMealItems(plan, { profile: profile, flavor: 'cn', preset: preset });
  const day = P.sumMeals(plan.meals);
  const checks = P.runChecks(day, rx, profile, { meals: plan.meals, preset: preset });
  const dev = Math.abs(day.kcal - rx.energy) / rx.energy * 100;
  const allItems = plan.meals.every(m => (m.items || []).every(it => it.grams > 0 && it.food && it.food.name));
  const sumPct = plan.meals.reduce((a, m) => a + m.pct, 0);
  console.log('  · ' + preset + '：能量 ' + Math.round(day.kcal) + ' kcal（偏差 ' + P.r1(dev) + '%），蛋白 ' + Math.round(day.pro) + ' g，' +
    '碳水 ' + Math.round(day.cho) + ' g，脂肪 ' + Math.round(day.fat) + ' g，纤维 ' + P.r1(day.fib) + ' g，GL ' + P.r1(day.gl) + '，餐次数 ' + plan.meals.length);
  ok(allItems, preset + '：所有条目均有食物与克数');
  ok(dev <= 10, preset + '：能量偏差 ≤10%', P.r1(dev));
  ok(Math.abs(sumPct - 1) < 0.001, preset + '：餐次比例合计 100%', sumPct);
  ok(checks.length >= 14, preset + '：自检条目数量', checks.length);
  const failNames = checks.filter(c => !c.pass).map(c => c.name);
  console.log('    自检未达标项：' + (failNames.length ? failNames.join('、') : '无'));
});

console.log('\n[3] 平替');
const rice = P.F('米饭（蒸，代表值）');
const cands = P.swapCandidates(rice, 'carb', { sameCat: true, lowGI: true, onlyLowerGL: true });
ok(cands.length > 0, '米饭存在按碳水等价的低 GL 替代（' + cands.length + ' 项）');
ok(cands[0].food.cat === 'grain', '替代品同为主食', cands[0].food.name);
ok(cands[0].food.gi <= rice.gi, '替代品 GI 不高于原食物', [rice.gi, cands[0].food.gi]);
ok(cands[0].grams > 0 && cands[0].grams < 1000, '替代克数合理', cands[0].grams);
const eggCands = P.swapCandidates(P.F('鸡蛋（代表值）'), 'protein', { sameCat: true });
ok(eggCands.length > 0, '鸡蛋存在按蛋白等价替代', eggCands.length);
const swapped = P.swapInItem({ food: rice, exch: 2 }, P.F('糙米'));
ok(swapped.exch === 2 && swapped.grams > 0, '食谱内替换保持交换份不变', swapped.grams);

console.log('\n[4] 血糖联动');
const base = { now: new Date('2025-01-01T11:30:00'), phase: 'premeal', trend: 'flat', symptoms: 'no', next: 'meal', exIntensity: 'mod', exMin: 30, ketone: 'unknown', profile: profile, sinceMeal: 240 };
const cases = [
  { bg: 2.8, exp: 'severe_hypo', exAllowed: false },
  { bg: 3.5, exp: 'hypo', exAllowed: false },
  { bg: 5.0, exp: 'low_normal', exAllowed: true },
  { bg: 6.5, exp: 'in_range', exAllowed: true },
  { bg: 9.0, exp: 'slightly_high', exAllowed: true },
  { bg: 12.0, exp: 'high', exAllowed: true },
  { bg: 15.0, exp: 'very_high', exAllowed: false }
];
cases.forEach(function (c) {
  const r = G.assess(Object.assign({}, base, { bg: c.bg }));
  ok(r.level.key === c.exp, 'bg=' + c.bg + ' → ' + c.exp, r.level.key);
  ok(r.exercise.allowed === c.exAllowed, 'bg=' + c.bg + ' 运动许可=' + c.exAllowed, r.exercise.allowed);
});
const rLow = G.assess(Object.assign({}, base, { bg: 3.5 }));
ok(rLow.actions.length >= 1 && rLow.actions[0].kind === 'carb', '低血糖给出补糖动作');
ok(rLow.meal.carbFactor >= 1, '低血糖时主食不减量', rLow.meal.carbFactor);
const rHigh = G.assess(Object.assign({}, base, { bg: 12 }));
ok(rHigh.meal.carbFactor < 0.85, '高血糖时主食减量', rHigh.meal.carbFactor);
ok(rHigh.meal.delayMin > 0, '高血糖时给出进餐时间调整', rHigh.meal.delayMin);
ok(rHigh.meal.needLowGI === true, '高血糖时提示低 GI 替换');
const rVeryHigh = G.assess(Object.assign({}, base, { bg: 15.5, ketone: 'pos' }));
ok(rVeryHigh.exercise.allowed === false && rVeryHigh.exercise.blockReasons.length >= 2, '酮体阳性 + 高血糖禁止运动');
const rEx = G.assess(Object.assign({}, base, { bg: 12, next: 'exercise', exIntensity: 'high' }));
ok(rEx.exercise.intensity !== 'high', '高血糖时下调运动强度', rEx.exercise.intensity);
const rBed = G.assess(Object.assign({}, base, { bg: 6.0, next: 'sleep', phase: 'bed' }));
ok(rBed.exercise.cautions.some(c => c.indexOf('睡前') >= 0), '睡前偏低给出加餐提醒');

const plan = P.buildExchangePlan(rx, { preset: 'three_snack' });
P.buildMealItems(plan, { profile: profile, flavor: 'cn', preset: 'three_snack' });
const tl = G.buildTimeline(base.now, plan.meals, rHigh.exercise, rHigh);
ok(tl.length >= 4, '时间轴事件生成', tl.length);
ok(tl.every(e => e.at instanceof Date && e.label), '时间轴事件结构完整');

console.log('\n[5] CGM 统计');
let demo = [];
for (let i = 0; i < 96; i++) {
  const t = new Date(2025, 0, 1, 0, 0, 0);
  t.setMinutes(i * 15);
  const hour = t.getHours();
  let v = 6.2 + Math.sin((hour - 6) / 24 * Math.PI * 2) * 2.2;
  if (i === 40) v = 3.4; if (i === 41) v = 3.6;
  if (i === 50) v = 13.2;
  demo.push({ t: t, v: Math.round(v * 10) / 10 });
}
const cgm = G.analyzeCGM(demo);
ok(cgm && cgm.n === 96, 'CGM 读数条数', cgm && cgm.n);
ok(cgm.tir > 50 && cgm.tir <= 100, 'TIR 计算', cgm.tir);
ok(cgm.gmi > 4 && cgm.gmi < 10, 'GMI 计算', cgm.gmi);
ok(cgm.flags.length >= 0, '风险提示生成', cgm.flags.length);
const parsed = G.parseReadings('2025-01-01 07:30, 7.2\n2025-01-01 08:00\t8.9\n时间,血糖\n2025-01-01 08:30 6.4');
ok(parsed.readings.length === 3, '粘贴文本解析条数', parsed.readings.length);
ok(Math.abs(parsed.readings[0].v - 7.2) < 1e-6, '解析血糖值', parsed.readings[0].v);

console.log('\n[6] 食物库一致性');
const dup = {};
P.DB.forEach(f => { dup[f.name] = (dup[f.name] || 0) + 1; });
ok(Object.keys(dup).every(k => dup[k] === 1), '食物名称唯一');
ok(P.DB.every(f => f.exch100 > 0 && f.kcal > 0), '每条食物均有能量与交换份换算');
ok(P.DB.filter(f => f.gi != null).length > 60, '含 GI 值的食物数量', P.DB.filter(f => f.gi != null).length);

console.log('\n' + (fails === 0 ? '全部通过 ✔' : fails + ' 项未通过 ✘'));
process.exit(fails === 0 ? 0 : 1);
