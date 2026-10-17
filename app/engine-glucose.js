/* =====================================================================
 * engine-glucose.js —— 血糖 · 运动联动再计算引擎
 *
 *   输入：当前血糖、趋势箭头、测量时段、距上一餐时间、症状、酮体、
 *         下一步计划（进餐/运动/睡觉）、计划运动强度与时长、患者特征
 *   输出：① 血糖分级判读  ② 进餐时间调整  ③ 主食量与种类调整
 *         ④ 加餐/低血糖处理  ⑤ 运动处方（能否运动、何时、强度、时长、监测点）
 *         ⑥ 复测计划与就医预警  ⑦ 当日时间轴
 *   另含：连续血糖（CGM/血糖仪）数据统计（TIR/TAR/TBR、GMI、CV）
 *
 *   依据：中国糖尿病防治指南与医学营养/运动治疗相关推荐值，
 *         阈值集中在 RULES 中，可在界面「数据与设置」中调整。
 * ===================================================================== */
(function (global) {
  'use strict';

  var DEFAULT_RULES = {
    hypoSerious: 3.0,        // 严重低血糖
    hypoLow: 3.9,            // 低血糖阈值
    preMealIdealLow: 4.4,    // 空腹/餐前理想下限
    preMealIdealHigh: 7.0,   // 空腹/餐前理想上限
    targetLow: 3.9,          // CGM 目标范围下限
    targetHigh: 10.0,        // 餐后目标上限 / CGM 目标范围上限
    slightlyHigh: 10.0,
    veryHigh: 13.9,          // 运动禁忌与强化干预阈值
    dkaWarn: 16.7,           // 警惕 DKA/HHS
    sleepTargetLow: 6.7,     // 睡前目标下限（预防夜间低血糖）
    exerciseMinBG: 5.6,      // 运动前最低血糖（低于此需先加餐）
    exerciseMaxBG: 13.9,     // 运动前最高血糖（高于此暂缓运动）
    preCarbG: 20,            // 运动前加餐碳水（克）
    hypoCarbG: 15,           // 低血糖处理碳水（克）
    postMealExerciseMin: 60, // 建议餐后开始运动时间（分钟，自第一口饭算）
    postMealExerciseRange: [45, 90],
    monitorAfterExerciseMin: 30,
    nightCheckHour: 2
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function addMin(d, m) { return new Date(d.getTime() + m * 60000); }

  /* ------------------------------------------------------------ 血糖分级 */
  function classify(bg, phase, rules) {
    rules = rules || DEFAULT_RULES;
    var lvl;
    if (bg < rules.hypoSerious) lvl = { key: 'severe_hypo', label: '严重低血糖', color: 'danger' };
    else if (bg < rules.hypoLow) lvl = { key: 'hypo', label: '低血糖', color: 'danger' };
    else if (bg < rules.exerciseMinBG) lvl = { key: 'low_normal', label: '偏低（尚在目标内）', color: 'warn' };
    else if (bg <= rules.preMealIdealHigh + 0.8) lvl = { key: 'in_range', label: '目标范围内', color: 'ok' };
    else if (bg <= rules.slightlyHigh) lvl = { key: 'slightly_high', label: '略高于目标', color: 'warn' };
    else if (bg < rules.veryHigh) lvl = { key: 'high', label: '偏高', color: 'warn' };
    else lvl = { key: 'very_high', label: '很高（需立即处理）', color: 'danger' };

    var target = '空腹/餐前 4.4～7.0，餐后 2 h <10.0 mmol/L';
    if (phase === 'post1') target = '餐后 1 h 一般 <10.0～11.1 mmol/L';
    else if (phase === 'post2') target = '餐后 2 h <10.0 mmol/L';
    else if (phase === 'bed') target = '睡前 6.7～10.0 mmol/L（<6.7 需加餐预防夜间低血糖）';
    else if (phase === 'night') target = '夜间 4.4～7.8 mmol/L，<3.9 为夜间低血糖';
    else if (phase === 'fasting') target = '空腹 4.4～7.0 mmol/L';
    else if (phase === 'exercise_pre') target = '运动前 5.6～13.9 mmol/L';
    lvl.target = target;
    return lvl;
  }

  /* ------------------------------------------------------- 运动处方规则 */
  function exercisePlan(input, rules) {
    var bg = input.bg, ketone = input.ketone || 'unknown';
    var cor = input.profile && input.profile.comorb ? input.profile.comorb : {};
    var treat = (input.profile && input.profile.treat) || 'lifestyle';
    var hypoRisk = ['oral_high', 'basal', 'mdi', 'premix', 'pump'].indexOf(treat) >= 0;
    var cautions = [], blocked = [], allowed = true;

    if (ketone === 'pos') { allowed = false; blocked.push('酮体阳性：运动会使血糖与酮体进一步升高，存在酮症酸中毒风险，禁止运动，请立即联系医生。'); }
    if (bg < rules.hypoLow) { allowed = false; blocked.push('血糖 <3.9 mmol/L：先纠正低血糖，暂缓运动。'); }
    else if (bg < rules.exerciseMinBG) {
      blocked.push('血糖 3.9～5.6 mmol/L：运动前需先补充约 ' + rules.preCarbG + ' g 碳水（如 1 份水果 + 2～3 块苏打饼干或 200 ml 牛奶），15 分钟后复测 ≥5.6 再运动。');
    }
    if (bg > rules.dkaWarn) { allowed = false; blocked.push('血糖 >16.7 mmol/L：暂缓运动，检查酮体、补充水分并按医嘱调整用药。'); }
    else if (bg > rules.exerciseMaxBG) {
      if (ketone === 'neg') blocked.push('血糖 >13.9 mmol/L（酮体阴性）：暂缓中高强度运动，可先按医嘱纠正高血糖；确需活动时仅限 10～20 分钟低强度步行。');
      else blocked.push('血糖 >13.9 mmol/L 且酮体未测：暂缓运动，先测酮体。');
      allowed = false;
    }
    if (cor.gp) cautions.push('合并胃轻瘫：避免餐后立即弯腰、跳跃等动作，运动宜在餐后 60～90 分钟开始。');
    if (input.profile && input.profile.ckd === 'ckd45') cautions.push('CKD 4～5 期：从低强度、短时间开始，避免脱水与高钾风险。');

    var intensity = input.exIntensity || 'mod';
    var minutes = +input.exMin || 30;
    var reason = '';
    if (bg > rules.slightlyHigh && bg <= rules.exerciseMaxBG) {
      if (intensity === 'high' || intensity === 'hiit') {
        intensity = 'mod';
        reason = '血糖偏高（10.0～13.9 mmol/L）：高强度运动可能使血糖进一步升高，改为中等强度有氧。';
      }
      minutes = clamp(minutes, 20, 40);
    } else if (bg >= rules.exerciseMinBG && bg <= rules.slightlyHigh) {
      reason = '血糖在目标范围：可按计划进行中等强度有氧运动。';
      minutes = clamp(minutes, 25, 60);
    } else if (bg < rules.exerciseMinBG && bg >= rules.hypoLow) {
      intensity = intensity === 'hiit' ? 'low' : (intensity === 'high' ? 'mod' : intensity);
      reason = '血糖偏低：先加餐，再以低～中等强度开始，运动中每 30 分钟复测。';
      minutes = clamp(minutes, 20, 40);
    }

    var startDelay = rules.postMealExerciseMin;
    if (bg > rules.slightlyHigh) startDelay = 45;
    if (input.next === 'exercise') startDelay = 0;   // 本次就是运动前的评估

    var monitor = [
      { offset: 0, label: '运动前：即刻复测（' + (bg < rules.exerciseMinBG ? '加餐后 15 分钟' : '运动开始前') + '）' },
      { offset: minutes, label: '运动后即刻' },
      { offset: minutes + rules.monitorAfterExerciseMin, label: '运动后 30 分钟' },
      { offset: -1, label: '睡前（若运动在下午/傍晚）' }
    ];
    if (intensity === 'high' || intensity === 'hiit' || minutes >= 60) {
      monitor.push({ offset: -2, label: '运动后夜间 ' + pad(rules.nightCheckHour) + ':00～3:00 加测一次（延迟性低血糖风险）' });
      cautions.push('较长时间/较大强度运动后 12～24 小时仍可能发生延迟性低血糖' + (hypoRisk ? '（你正在使用可能引起低血糖的药物）' : '') + '，建议睡前血糖 <7.0 mmol/L 时加餐 15～20 g 慢吸收碳水。');
    }
    if (hypoRisk) cautions.push('使用胰岛素或促泌剂：运动前后务必监测血糖，随身携带糖果/葡萄糖片与身份卡；不要自行增减药量，按医嘱执行。');
    if (bg < rules.sleepTargetLow && (input.next === 'sleep' || input.phase === 'bed')) {
      cautions.push('睡前血糖 <6.7～7.0 mmol/L：建议加餐 15～20 g 慢吸收碳水（如 200 ml 牛奶 + 1 小把坚果），预防夜间低血糖。');
    }
    cautions.push('运动禁忌与暂停指征：血糖 >13.9 mmol/L 或酮体阳性、急性感染、严重心脑血管事件急性期、足部溃疡、增殖期视网膜病变（避免剧烈与抗阻运动）、运动中胸痛/头晕/气促立即停止。');

    return {
      allowed: allowed, reason: reason, blockReasons: blocked, cautions: cautions,
      startAfterMealMin: startDelay, intensity: intensity, minutes: minutes,
      intensityLabel: { low: '低强度（散步、家务、太极）', mod: '中等强度（快走 100 步/分、慢跑、骑车、游泳、广场舞）', high: '较大强度（跑步、球类、跳绳、抗阻训练）', hiit: '高强度间歇' }[intensity] || intensity,
      preCarbG: bg < rules.exerciseMinBG ? rules.preCarbG : 0,
      monitor: monitor,
      weekly: '每周累计 ≥150 分钟中等强度有氧运动，分 3～5 天完成；每周 2～3 次抗阻训练（隔天进行），可增加肌肉量与胰岛素敏感性。'
    };
  }

  /* --------------------------------------------------------- 主评估函数 */
  function assess(input, rules) {
    rules = Object.assign({}, DEFAULT_RULES, rules || {});
    var bg = +input.bg;
    var trend = input.trend || 'flat';
    var phase = input.phase || 'premeal';
    var now = input.now ? new Date(input.now) : new Date();
    var lvl = classify(bg, phase, rules);
    var treat = (input.profile && input.profile.treat) || 'lifestyle';
    var hypoRisk = ['oral_high', 'basal', 'mdi', 'premix', 'pump'].indexOf(treat) >= 0;
    var actions = [], mealNotes = [], warnings = [];

    /* ① 立即处理 */
    if (bg < rules.hypoSerious) {
      actions.push({ kind: 'carb', title: '立即处理严重低血糖（' + bg + ' mmol/L）', detail: '立即口服 15～20 g 快速吸收碳水（葡萄糖片 3～4 片 / 含糖饮料 150～200 ml / 蜂蜜 1 汤匙），15 分钟后复测；若仍 <3.9 重复一次。若出现意识模糊、抽搐、无法吞咽，禁止喂食，立即拨打急救电话并使用胰高血糖素（如有）。' });
      warnings.push('严重低血糖属于急症，处理后须联系医生查找原因并调整方案。');
    } else if (bg < rules.hypoLow) {
      actions.push({ kind: 'carb', title: '立即纠正低血糖（' + bg + ' mmol/L）', detail: '口服 ' + rules.hypoCarbG + ' g 快速碳水（葡萄糖片 3 片或果汁 150 ml 或方糖 3 块），静坐休息，15 分钟后复测；回升到 ≥3.9 mmol/L 再进正餐或运动。不要用巧克力、冰淇淋代替（脂肪延缓吸收）。' });
      if (hypoRisk) warnings.push('正在使用胰岛素或促泌剂：低血糖后 24 小时内易再次发生，建议与医生沟通是否需调整剂量。');
    } else if (bg < rules.exerciseMinBG && (input.next === 'exercise' || phase === 'exercise_pre')) {
      actions.push({ kind: 'carb', title: '运动前加餐', detail: '血糖 ' + bg + ' mmol/L 偏低，先补充约 ' + rules.preCarbG + ' g 碳水（1 份水果 + 200 ml 牛奶，或 2 片全麦面包），15 分钟后复测 ≥5.6 mmol/L 再开始运动。' });
    }

    /* ② 进餐时间 */
    var delayMin = 0, delayReason = '';
    if (bg < rules.hypoLow) { delayMin = 20; delayReason = '先补糖 15 g、15 分钟后复测，血糖回升到 3.9 mmol/L 以上再进餐（正餐可延后约 20 分钟）。'; }
    else if (bg < rules.exerciseMinBG && input.next === 'meal') { delayMin = 0; delayReason = '血糖偏低但可直接进餐，不要为“等血糖升上来”而推迟进餐；主食不必减少，建议先吃主食再吃菜。'; }
    else if (bg <= rules.slightlyHigh) { delayMin = 0; delayReason = '血糖在目标范围，按计划时间进餐即可。'; }
    else if (bg < rules.veryHigh) {
      delayMin = 15;
      delayReason = '血糖偏高：可先做 10～15 分钟低强度活动（如慢走），再进餐；同时把进餐顺序改为「蔬菜 → 蛋白质 → 主食」，可降低餐后血糖峰值。';
      if (hypoRisk) delayReason += ' 使用胰岛素者请按医嘱安排注射与进餐间隔（通常餐前 15～30 分钟注射速效胰岛素），不要为等血糖而降糖而延误进餐。';
    } else {
      delayMin = 0;
      delayReason = '血糖很高时不建议用“不吃饭”来降糖（尤其使用胰岛素者易发生低血糖与酮症）；应先补液、按医嘱处理高血糖，同时按下方调整进餐量与种类。';
    }

    /* ③ 主食量与种类 */
    var carbFactor = 1.0, factorNote = [];
    if (lvl.key === 'severe_hypo' || lvl.key === 'hypo') { carbFactor = 1.05; factorNote.push('低血糖处理后进餐：主食可略增（约 1 份，含 20 g 碳水），并在下一餐前复测。'); }
    else if (lvl.key === 'low_normal') { carbFactor = 1.0; factorNote.push('血糖偏低：主食不减量，可把水果/乳类加餐提前。'); }
    else if (lvl.key === 'in_range') { carbFactor = 1.0; }
    else if (lvl.key === 'slightly_high') { carbFactor = 0.9; factorNote.push('略高：下一餐主食减少约 10%（每 2 份主食减 0.2 份，即约 15 g 米饭）。'); }
    else if (lvl.key === 'high') { carbFactor = 0.75; factorNote.push('偏高：下一餐主食减少 20%～30%，同时增加非淀粉类蔬菜 100～200 g 与优质蛋白，保证饱腹感与营养。'); }
    else { carbFactor = 0.6; factorNote.push('很高：主食减少约 30%～40%，以蔬菜、菌藻、豆制品、鱼虾、蛋类补足能量；不要自行停用降糖药或胰岛素。'); }

    if ((trend === 'up3' || trend === 'up2') && bg > rules.slightlyHigh - 2) {
      carbFactor *= 0.9;
      factorNote.push('血糖正在上升（' + (trend === 'up3' ? '↑↑' : '↑') + '）：主食在上述基础上再减约 10%，优先选择 GI <55 的主食。');
    }
    if (trend === 'down2' || trend === 'down3') {
      carbFactor = Math.min(1.15, carbFactor * 1.15);
      factorNote.push('血糖正在下降（' + (trend === 'down3' ? '↓↓' : '↓') + '）：主食不再减量，并在 30～60 分钟后复测，警惕低血糖。');
    }
    var needLowGI = bg >= rules.slightlyHigh - 1 || trend === 'up2' || trend === 'up3';
    if (needLowGI) factorNote.push('种类调整：把白米饭、白粥、馒头、烙饼等换成杂粮饭（糙米/黑米/燕麦/荞麦/藜麦）、玉米、薯类等低 GI 主食；避免粥类与糊化主食。');

    /* ④ 加餐建议 */
    var snackTip = '';
    if (bg >= rules.veryHigh) snackTip = '暂不加餐（除低血糖处理外）；如需加餐只选黄瓜、番茄等低能量蔬菜。';
    else if (bg >= rules.slightlyHigh) snackTip = '加餐选低 GL 水果 100 g（苹果、梨、柚、草莓）或 200 ml 无糖牛奶，避免果汁、果干与甜点。';
    else if (bg < rules.exerciseMinBG) snackTip = '可加餐 1 份水果 + 200 ml 牛奶（约 20～25 g 碳水），并计入全天总能量。';
    else snackTip = '按计划加餐：水果 100～200 g 配少量坚果（10 g），或 200 ml 无糖酸奶，放在两餐之间。';

    /* ⑤ 运动处方 */
    var ex = exercisePlan({ bg: bg, ketone: input.ketone, exIntensity: input.exIntensity, exMin: input.exMin, next: input.next, phase: phase, profile: input.profile }, rules);

    /* ⑥ 复测与时间轴 */
    var rechecks = [];
    if (bg < rules.hypoLow) rechecks.push({ afterMin: 15, label: '低血糖处理后 15 分钟复测（未达标每 15 分钟重复）' });
    if (bg >= rules.veryHigh) {
      rechecks.push({ afterMin: 60, label: '1 小时后复测血糖与酮体（若酮体阳性立即就医）' });
      warnings.push('血糖 ≥13.9～16.7 mmol/L：请检查酮体、多饮水，并按医嘱处理；若出现恶心呕吐、腹痛、呼吸深快、意识改变，立即就医。');
    }
    if (input.next === 'meal') rechecks.push({ afterMin: delayMin + 120, label: '餐后 2 小时血糖（评估本餐碳水与用药匹配）' });
    if (input.next === 'exercise') {
      rechecks.push({ afterMin: ex.minutes, label: '运动后即刻血糖' });
      rechecks.push({ afterMin: ex.minutes + 30, label: '运动后 30 分钟血糖' });
    }
    if (input.next === 'sleep') rechecks.push({ afterMin: 0, label: '睡前血糖，必要时加餐后再睡' });

    var summary;
    if (lvl.key === 'severe_hypo' || lvl.key === 'hypo') summary = '当前血糖 ' + bg + ' mmol/L 属于低血糖，优先纠正低血糖，其次才是进餐与运动安排。';
    else if (lvl.key === 'low_normal') summary = '当前血糖 ' + bg + ' mmol/L 偏低但在目标内，重点是避免继续下降（先加餐/正常进餐，暂缓运动）。';
    else if (lvl.key === 'in_range') summary = '当前血糖 ' + bg + ' mmol/L 在目标范围，可按原计划进餐与运动，维持现有节奏。';
    else if (lvl.key === 'slightly_high') summary = '当前血糖 ' + bg + ' mmol/L 略高于目标，主食略减、优选低 GI，餐后 45～60 分钟开始运动。';
    else if (lvl.key === 'high') summary = '当前血糖 ' + bg + ' mmol/L 偏高，主食减少 20%～30%、增加蔬菜与蛋白，餐后 45 分钟开始中等强度运动，1～2 小时后复测。';
    else summary = '当前血糖 ' + bg + ' mmol/L 很高，暂缓运动、检查酮体、补液并按医嘱处理，同时显著减少主食并增加低 GL 食物。';

    return {
      time: hhmm(now), bg: bg, trend: trend, phase: phase, level: lvl,
      summary: summary, actions: actions, warnings: warnings,
      meal: { delayMin: delayMin, reason: delayReason, carbFactor: r1(carbFactor), notes: factorNote, needLowGI: needLowGI, snackTip: snackTip, order: '建议进餐顺序：先吃蔬菜（约 5 分钟）→ 再吃蛋白质（肉/蛋/豆）→ 最后吃主食，全程细嚼慢咽 20 分钟以上。' },
      exercise: ex,
      rechecks: rechecks,
      hypoRisk: hypoRisk,
      rules: rules
    };
  }

  /* ------------------------------------------------------------ 时间轴 */
  /** 生成时间轴事件（相对当前时间与各餐时间） */
  function buildTimeline(now, meals, ex, result) {
    var ev = [];
    var d0 = new Date(now);
    (meals || []).forEach(function (m) {
      var t = m.time || '';
      var hm = /^(\d{1,2}):(\d{2})$/.exec(t);
      if (!hm) return;
      var d = new Date(d0); d.setHours(+hm[1], +hm[2], 0, 0);
      var kind = /加餐/.test(m.label) ? 'snack' : 'meal';
      ev.push({ at: d, kind: kind, label: m.label + ' ' + t, detail: '交换份：' + Object.keys(m.byCat || {}).filter(function (c) { return m.byCat[c] > 0; }).map(function (c) { return (global.CAT_META && global.CAT_META[c] ? global.CAT_META[c].label : c) + ' ' + m.byCat[c] + ' 份'; }).join('、') });
    });
    if (ex && ex.allowed) {
      // 运动：安排在最近一餐之后
      var lastMeal = null;
      ev.forEach(function (e) { if (e.kind === 'meal' && e.at <= d0) lastMeal = e; });
      var base = lastMeal ? lastMeal.at : d0;
      var start = addMin(base, ex.startAfterMealMin);
      if (start < d0) start = addMin(d0, 10);
      ev.push({ at: start, kind: 'exercise', label: '运动建议开始 ' + hhmm(start), detail: ex.intensityLabel + '，' + ex.minutes + ' 分钟' + (ex.preCarbG ? '（运动前需加餐 ' + ex.preCarbG + ' g 碳水）' : '') });
      ev.push({ at: addMin(start, ex.minutes), kind: 'monitor', label: '运动后即刻测血糖', detail: '必要时 30 分钟后再测一次' });
    }
    (result && result.rechecks ? result.rechecks : []).forEach(function (r) {
      if (r.afterMin > 0) ev.push({ at: addMin(d0, r.afterMin), kind: 'monitor', label: r.label, detail: '' });
    });
    if (result && result.actions) {
      result.actions.forEach(function (a) {
        if (a.kind === 'carb') ev.push({ at: d0, kind: 'carb', label: '立即：' + a.title, detail: a.detail });
      });
    }
    ev.sort(function (a, b) { return a.at - b.at; });
    return ev;
  }

  /* -------------------------------------------------- CGM / 连续血糖统计 */
  /** readings: [{t: Date|string, v: number}] */
  function analyzeCGM(readings, rules) {
    rules = Object.assign({}, DEFAULT_RULES, rules || {});
    var rs = (readings || []).map(function (r) {
      var raw = r.t, d;
      if (raw instanceof Date) d = raw;
      else {
        var s = String(raw).trim();
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {          // 只有时间（如 07:30），补上今天日期
          d = new Date();
          var hm = s.split(':');
          d.setHours(+hm[0], +hm[1], 0, 0);
        } else {
          d = new Date(s.replace(/-/g, '/'));
        }
      }
      return { t: d, v: +r.v };
    }).filter(function (r) { return !isNaN(r.t.getTime()) && !isNaN(r.v) && r.v > 0; })
      .sort(function (a, b) { return a.t - b.t; });
    if (!rs.length) return null;

    var vals = rs.map(function (r) { return r.v; });
    var n = vals.length;
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / n;
    var sd = Math.sqrt(vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / Math.max(1, n - 1));
    var meanMgdl = mean * 18.0182;
    var gmi = 3.31 + 0.02392 * meanMgdl;

    function pct(f) { return r1(vals.filter(f).length / n * 100); }
    var tir = pct(function (v) { return v >= rules.targetLow && v <= rules.targetHigh; });
    var tbr = pct(function (v) { return v < rules.targetLow; });
    var tbr2 = pct(function (v) { return v < rules.hypoSerious; });
    var tar = pct(function (v) { return v > rules.targetHigh; });
    var tar2 = pct(function (v) { return v > rules.veryHigh; });
    var tirTight = pct(function (v) { return v >= 3.9 && v <= 7.8; });

    // 低血糖事件：连续 ≤3.9 且持续 ≥15 分钟
    var events = [], cur = null;
    rs.forEach(function (r) {
      if (r.v < rules.targetLow) {
        if (!cur) cur = { from: r.t, to: r.t, min: r.v };
        else { cur.to = r.t; cur.min = Math.min(cur.min, r.v); }
      } else if (cur) {
        if ((cur.to - cur.from) / 60000 >= 15) events.push(cur);
        cur = null;
      }
    });
    if (cur && (cur.to - cur.from) / 60000 >= 15) events.push(cur);

    var tirLowCount = 0;
    for (var i = 1; i < n; i++) if (vals[i] >= rules.targetLow && vals[i] <= rules.targetHigh && vals[i - 1] >= rules.targetLow && vals[i - 1] <= rules.targetHigh) tirLowCount++;

    var flags = [];
    if (tir < 70) flags.push({ level: 'warn', text: '目标范围内时间（TIR 3.9～10.0）为 ' + tir + '%，低于 70% 的常用目标，建议从餐后血糖与主食结构入手调整。' });
    if (tbr > 4) flags.push({ level: 'danger', text: '低于目标范围时间（TBR）为 ' + tbr + '%，超过 4%，提示低血糖风险较高，需优先调整降糖方案（联系医生）。' });
    if (tbr2 > 1) flags.push({ level: 'danger', text: '严重低血糖时间占比 ' + tbr2 + '%（>1%），属于高风险，请尽快联系医生。' });
    if (tar > 25) flags.push({ level: 'warn', text: '高于目标范围时间（TAR）为 ' + tar + '%，餐后血糖管理有较大改善空间。' });
    if (sd / mean > 0.36) flags.push({ level: 'warn', text: '血糖变异系数 CV 为 ' + r1(sd / mean * 100) + '%，高于 36%，血糖波动偏大，建议规律进餐时间与碳水分配。' });
    if (events.length) flags.push({ level: 'danger', text: '检测到 ' + events.length + ' 次持续 ≥15 分钟的低血糖事件，最低 ' + r1(Math.min.apply(null, events.map(function (e) { return e.min; }))) + ' mmol/L。' });

    return {
      n: n, from: rs[0].t, to: rs[n - 1].t,
      mean: r1(mean), sd: r1(sd), cv: r1(sd / mean * 100), gmi: r1(gmi),
      max: r1(Math.max.apply(null, vals)), min: r1(Math.min.apply(null, vals)),
      tir: tir, tirTight: tirTight, tbr: tbr, tbr2: tbr2, tar: tar, tar2: tar2,
      hypoEvents: events, flags: flags, readings: rs
    };
  }

  /** 解析粘贴的文本/CSV：返回 readings */
  function parseReadings(text) {
    var out = [], bad = 0;
    (text || '').split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var parts = line.split(/[,;\t ]+/).filter(function (s) { return s !== ''; });
      // 找到日期/时间列与数值列：取第一个形如时间的字段与第一个 0.5～40 的数值
      var tStr = null, v = null, dateStr = null;
      parts.forEach(function (p) {
        if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(p)) { dateStr = p; return; }
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(p)) { tStr = p; return; }
        var num = parseFloat(p.replace(/[^\d.\-]/g, ''));
        if (v == null && !isNaN(num) && num > 0.5 && num < 40) v = num;
      });
      if (v == null) { bad++; return; }
      var d;
      if (dateStr && tStr) d = new Date((dateStr + ' ' + tStr).replace(/-/g, '/'));
      else if (dateStr) d = new Date(dateStr.replace(/-/g, '/'));
      else if (tStr) { d = new Date(); var hm = tStr.split(':'); d.setHours(+hm[0], +hm[1], 0, 0); }
      else { d = new Date(); }
      if (isNaN(d.getTime())) { bad++; return; }
      out.push({ t: d, v: v });
    });
    return { readings: out, skipped: bad };
  }

  global.GlucoseEngine = {
    DEFAULT_RULES: DEFAULT_RULES,
    classify: classify,
    assess: assess,
    exercisePlan: exercisePlan,
    buildTimeline: buildTimeline,
    analyzeCGM: analyzeCGM,
    parseReadings: parseReadings,
    hhmm: hhmm, addMin: addMin, r1: r1
  };
})(typeof window !== 'undefined' ? window : globalThis);
