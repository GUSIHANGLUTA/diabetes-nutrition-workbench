/* 打印一日食谱，便于人工核对：node tools/debug_plan.js [preset] [flavor] */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'app');
const sandbox = { console, Math, Date, JSON, isNaN, parseFloat, Object };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['data-foods.js', 'engine-prescription.js', 'engine-glucose.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const P = sandbox.PrescEngine;
const preset = process.argv[2] || 'three_snack';
const flavor = process.argv[3] || 'cn';
const profile = { age: 55, height: 170, weight: 75, activity: 'light', type: 't2', treat: 'oral_low', ckd: 'normal', goal: 'maintain', comorb: {} };
const rx = P.computePrescription(Object.assign({ choPct: 50 }, profile));
console.log(`能量目标 ${rx.energy} kcal｜碳水 ${rx.choG} g｜蛋白 ${rx.proG} g（${rx.proPct}%E）｜脂肪 ${rx.fatG} g｜纤维 ${rx.fiberG} g`);
const res = P.buildDay(rx, { preset, profile, flavor });
const plan = res.plan;
console.log('校准轮次：' + res.iterations);
console.log('分类份数：', JSON.stringify(plan.dailyByCat));
for (const m of plan.meals) {
  console.log(`\n== ${m.label} ${m.time}（${m.pctActual}% / ${Math.round(m.nutri.kcal)} kcal, GL ${P.r1(m.nutri.gl)}）`);
  for (const it of m.items) {
    console.log(`   ${it.food.name}${it.dry ? '（生重）' : ''}  ${it.exch} 份 / ${it.grams} g  [${it.food.cat}] kcal ${Math.round(it.food.kcal * it.grams / 100)}, 碳水 ${P.r1(it.food.cho * it.grams / 100)}, 纤维 ${P.r1(it.food.fib * it.grams / 100)}, GI ${it.food.gi}`);
  }
  console.log(`   小计：蛋白 ${P.r1(m.nutri.pro)} 脂肪 ${P.r1(m.nutri.fat)} 碳水 ${P.r1(m.nutri.cho)} 纤维 ${P.r1(m.nutri.fib)} 钠 ${Math.round(m.nutri.na)} 胆固醇 ${Math.round(m.nutri.chol)}`);
}
const day = P.sumMeals(plan.meals);
console.log(`\n全天：${Math.round(day.kcal)} kcal（目标 ${rx.energy}，偏差 ${P.r1((day.kcal - rx.energy) / rx.energy * 100)}%）`);
console.log(`  蛋白 ${Math.round(day.pro)} g (${P.r1(day.pro * 4 / day.kcal * 100)}%)｜脂肪 ${Math.round(day.fat)} g (${P.r1(day.fat * 9 / day.kcal * 100)}%)｜碳水 ${Math.round(day.cho)} g (${P.r1(day.cho * 4 / day.kcal * 100)}%)`);
console.log(`  纤维 ${P.r1(day.fib)} g｜钠 ${Math.round(day.na)} mg｜胆固醇 ${Math.round(day.chol)} mg｜GL ${P.r1(day.gl)}｜平均 GI ${P.r1(day.giAvg)}`);
P.runChecks(day, rx, profile, { meals: plan.meals, preset }).forEach(c => console.log(`  [${c.pass ? '√' : '×'}] ${c.name}：${c.actual}（目标 ${c.target}）`));
