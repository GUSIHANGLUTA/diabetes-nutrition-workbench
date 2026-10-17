/* 多方案健康度矩阵：node tools/matrix.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'app');
const sandbox = { console, Math, Date, JSON, isNaN, parseFloat, Object };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['data-foods.js', 'engine-prescription.js', 'engine-glucose.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const P = sandbox.PrescEngine;

const profiles = {
  '超重2型(170/75)': { age: 55, height: 170, weight: 75, sex: 'male', activity: 'light', type: 't2', treat: 'oral_low', ckd: 'normal', goal: 'maintain', comorb: {} },
  '正常体重老年(165/60)': { age: 72, height: 165, weight: 60, activity: 'light', type: 't2', treat: 'oral_high', ckd: 'normal', goal: 'maintain', comorb: {} },
  '肥胖减重(175/95)': { age: 48, height: 175, weight: 95, sex: 'male', activity: 'light', type: 't2', treat: 'oral_low', ckd: 'normal', goal: 'lose', comorb: { htn: true } },
  '消瘦增重(160/45)': { age: 60, height: 160, weight: 45, activity: 'light', type: 't2', treat: 'basal', ckd: 'normal', goal: 'gain', comorb: {} },
  '中体力男性(172/68)': { age: 40, height: 172, weight: 68, activity: 'moderate', type: 't1', treat: 'mdi', ckd: 'normal', goal: 'maintain', comorb: {} },
  'CKD4期(168/62)': { age: 66, height: 168, weight: 62, activity: 'light', type: 't2', treat: 'oral_low', ckd: 'ckd45', goal: 'maintain', comorb: {} },
  '痛风+高血压(170/80)': { age: 58, height: 170, weight: 80, activity: 'light', type: 't2', treat: 'oral_low', ckd: 'normal', goal: 'maintain', comorb: { gout: true, htn: true } },
  '妊娠糖尿病(163/70)': { age: 31, height: 163, weight: 70, sex: 'female', activity: 'light', type: 'gest', treat: 'mdi', gest: 't3tri', ckd: 'normal', goal: 'maintain', comorb: {} }
};
const flavors = ['cn', 'lowgi', 'veg'];
const presets = ['three', 'three_snack', 'six', 'gastroparesis'];
let rows = [];
for (const [pname, p] of Object.entries(profiles)) {
  for (const preset of presets) {
    for (const flavor of flavors) {
      const rx = P.computePrescription(Object.assign({ choPct: 50 }, p));
      const res = P.buildDay(rx, { preset, flavor, profile: p });
      const day = res.day;
      const key = res.checks.filter(c => c.level === 'key');
      const bad = key.filter(c => !c.pass).map(c => c.name);
      rows.push({ pname, preset, flavor, kcal: Math.round(day.kcal), target: rx.energy, pro: Math.round(day.pro), fatPct: Math.round(day.fat * 9 / day.kcal * 100), choPct: Math.round(day.cho * 4 / day.kcal * 100), fib: P.r1(day.fib), gl: Math.round(day.gl), bad, iter: res.iterations });
    }
  }
}
console.log('方案数：' + rows.length);
const worse = rows.filter(r => r.bad.length);
console.log('存在未达标关键项的组合：' + worse.length);
const counter = {};
worse.forEach(r => r.bad.forEach(b => counter[b] = (counter[b] || 0) + 1));
console.log('未达标项统计：', counter);
console.log('\n未达标组合明细：');
worse.forEach(r => console.log(`  ${r.pname} / ${r.preset} / ${r.flavor}：${r.kcal}/${r.target} kcal 纤维${r.fib}g → ×${r.bad.join('、')}`));
console.log('\n典型输出：');
rows.filter(r => r.flavor === 'cn' && r.preset === 'three_snack').forEach(r =>
  console.log(`  ${r.pname.padEnd(18)} ${r.kcal}/${r.target} kcal  蛋白${r.pro}g  脂${r.fatPct}%  碳${r.choPct}%  纤维${r.fib}g  GL${r.gl}  轮次${r.iter}  ${r.bad.length ? '×' + r.bad.join('、') : '全部达标'}`));
const devs = rows.map(r => Math.abs(r.kcal - r.target) / r.target * 100);
console.log(`\n能量偏差：max ${P.r1(Math.max(...devs))}%  avg ${P.r1(devs.reduce((a, b) => a + b, 0) / devs.length)}%`);
