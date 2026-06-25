(function () {
  var data = window.ADMISSION_DATA || null;
  var state = {
    activeBand: "all",
    allExpanded: false,
    expanded: {},
    results: { all: [], rush: [], steady: [], safe: [] },
    form: { region: "内蒙古", score: 520, rank: null, subject: "physics", targetRegion: "all", query: "" }
  };

  var BAND_LABEL = { rush: "冲", steady: "稳", safe: "保" };
  var BAND_CLASS = { rush: "rush", steady: "steady", safe: "safe" };
  var YEAR_WEIGHTS = { "2025": 0.45, "2024": 0.35, "2023": 0.20 };
  var DEVELOPED_REGION_IDS = ["beijing", "tianjin", "zhejiang", "shanghai", "xian", "guangzhou", "fujian", "jiangsu"];
  var TARGET_REGION_LABELS = {
    all: "全部地区",
    developed: "经济发达地区",
    beijing: "北京",
    tianjin: "天津",
    zhejiang: "浙江",
    shanghai: "上海",
    xian: "西安",
    guangzhou: "广州",
    fujian: "福建",
    jiangsu: "江苏",
    other: "其他地区"
  };
  var REGION_RULES = [
    { id: "beijing", label: "北京", patterns: [/北京/] },
    { id: "tianjin", label: "天津", patterns: [/天津/] },
    { id: "zhejiang", label: "浙江", patterns: [/浙江|杭州|宁波|温州|绍兴|嘉兴|湖州|金华|台州|舟山|丽水|衢州/] },
    { id: "shanghai", label: "上海", patterns: [/上海/] },
    { id: "xian", label: "西安", patterns: [/西安/] },
    { id: "guangzhou", label: "广州", patterns: [/广州|广东工业大学|华南理工大学|华南师范大学|中山大学|暨南大学|广东外语外贸大学|广州医科大学|广州中医药大学|南方医科大学|广东财经大学|广东药科大学|星海音乐学院|广州美术学院|仲恺农业工程学院/] },
    { id: "fujian", label: "福建", patterns: [/福建|厦门|福州|泉州|漳州|莆田|三明|龙岩|宁德|武夷/] },
    { id: "jiangsu", label: "江苏", patterns: [/江苏|南京|苏州|无锡|常州|镇江|扬州|南通|泰州|徐州|盐城|淮安|连云港|宿迁/] }
  ];

  var els = {};

  document.addEventListener("DOMContentLoaded", function () {
    cacheElements();
    bindEvents();
    renderSources();
    renderDataBadge();
    runRecommendation();
  });

  function cacheElements() {
    els.form = document.getElementById("plannerForm");
    els.score = document.getElementById("scoreInput");
    els.rank = document.getElementById("rankInput");
    els.region = document.getElementById("regionInput");
    els.targetRegion = document.getElementById("targetRegionInput");
    els.major = document.getElementById("majorInput");
    els.results = document.getElementById("results");
    els.summary = document.getElementById("summaryCards");
    els.quality = document.getElementById("qualityPanel");
    els.dataBadge = document.getElementById("dataBadge");
    els.sourceList = document.getElementById("sourceList");
    els.expandAll = document.getElementById("expandAllBtn");
    els.reset = document.getElementById("resetBtn");
    els.importInput = document.getElementById("importInput");
  }

  function bindEvents() {
    els.form.addEventListener("submit", function (event) {
      event.preventDefault();
      readForm();
      state.expanded = {};
      state.allExpanded = false;
      runRecommendation();
    });

    els.major.addEventListener("input", function () {
      state.form.query = els.major.value.trim();
      renderResults();
    });

    els.targetRegion.addEventListener("change", function () {
      readForm();
      state.expanded = {};
      state.allExpanded = false;
      runRecommendation();
    });

    els.reset.addEventListener("click", function () {
      els.score.value = 520;
      els.rank.value = "";
      els.major.value = "";
      els.targetRegion.value = "all";
      document.querySelector('input[name="subject"][value="physics"]').checked = true;
      readForm();
      state.expanded = {};
      state.allExpanded = false;
      runRecommendation();
    });

    document.querySelectorAll(".tab").forEach(function (button) {
      button.addEventListener("click", function () {
        state.activeBand = button.getAttribute("data-band");
        document.querySelectorAll(".tab").forEach(function (tab) {
          tab.classList.toggle("active", tab === button);
        });
        renderResults();
      });
    });

    els.results.addEventListener("click", function (event) {
      var button = event.target.closest("[data-toggle-school]");
      if (!button) { return; }
      var id = button.getAttribute("data-toggle-school");
      state.expanded[id] = !state.expanded[id];
      renderResults();
    });

    els.expandAll.addEventListener("click", function () {
      state.allExpanded = !state.allExpanded;
      state.expanded = {};
      currentResults().forEach(function (item) {
        state.expanded[item.school.id] = state.allExpanded;
      });
      els.expandAll.textContent = state.allExpanded ? "收起" : "展开";
      renderResults();
    });

    els.importInput.addEventListener("change", handleImport);
  }

  function readForm() {
    var subject = document.querySelector('input[name="subject"]:checked').value;
    state.form = {
      region: els.region.value,
      score: Number(els.score.value || 0),
      rank: els.rank.value ? Number(els.rank.value) : null,
      subject: subject,
      targetRegion: els.targetRegion.value,
      query: els.major.value.trim()
    };
  }

  function runRecommendation() {
    readForm();
    if (!data || !Array.isArray(data.schools) || !data.schools.length) {
      renderEmpty("还没有生成本地数据。请先运行 tools/build-data.ps1。");
      return;
    }

    var candidates = buildCandidates();
    state.results = splitRecommendations(candidates);
    renderSummary(candidates);
    renderQuality(candidates);
    renderResults();
  }

  function buildCandidates() {
    var score = state.form.score;
    var rank = state.form.rank || estimateRank(2025, state.form.subject, score);
    return data.schools
      .filter(function (school) { return school.subject === state.form.subject; })
      .map(function (school) {
        var regionCategory = classifySchoolRegion(school);
        var years = summarizeYears(school);
        var lineScore = weighted(years, "score");
        if (!isFinite(lineScore)) { return null; }

        var lineRank = weighted(years, "rank");
        var scoreGap = score - lineScore;
        var rankGap = isFinite(lineRank) && rank ? lineRank - rank : null;
        var completeness = years.filter(function (item) { return item && isFinite(item.score); }).length;
        var latest = years.find(function (item) { return item && item.year === 2025; }) || years[0] || null;

        return {
          school: school,
          years: years,
          latest: latest,
          lineScore: lineScore,
          lineRank: lineRank,
          scoreGap: scoreGap,
          rankGap: rankGap,
          completeness: completeness,
          regionCategory: regionCategory,
          regionMatched: matchesTargetRegion(regionCategory, state.form.targetRegion),
          closeness: Math.abs(scoreGap) + (rankGap === null ? 0 : Math.min(18, Math.abs(rankGap) / 1600))
        };
      })
      .filter(Boolean);
  }

  function classifySchoolRegion(school) {
    var programText = (school.programs || []).slice(0, 24).map(function (program) {
      return [program.place, program.note, program.major].join(" ");
    }).join(" ");
    var text = [school.name, school.rawName, school.location, programText].join(" ");

    for (var i = 0; i < REGION_RULES.length; i += 1) {
      var rule = REGION_RULES[i];
      for (var j = 0; j < rule.patterns.length; j += 1) {
        if (rule.patterns[j].test(text)) {
          return { id: rule.id, label: rule.label, developed: true };
        }
      }
    }

    return { id: "other", label: "其他地区", developed: false };
  }

  function matchesTargetRegion(category, targetRegion) {
    if (!targetRegion || targetRegion === "all") { return true; }
    if (targetRegion === "developed") { return !!category.developed; }
    if (targetRegion === "other") { return category.id === "other"; }
    return category.id === targetRegion;
  }

  function selectedRegionCount(candidates) {
    if (state.form.targetRegion === "all") { return candidates.length; }
    return candidates.filter(function (item) { return item.regionMatched; }).length;
  }

  function selectedRegionLabel() {
    return TARGET_REGION_LABELS[state.form.targetRegion] || TARGET_REGION_LABELS.all;
  }

  function summarizeYears(school) {
    var byYear = {};
    (school.history || []).forEach(function (item) {
      var year = String(item.year);
      var score = Number(item.score);
      if (!isFinite(score) || score <= 0) { return; }
      if (!byYear[year] || score < Number(byYear[year].score)) {
        byYear[year] = item;
      }
    });
    return [2025, 2024, 2023].map(function (year) {
      var item = byYear[String(year)];
      if (!item) { return null; }
      return {
        year: year,
        batch: item.batch,
        score: Number(item.score),
        rank: item.rank === null || item.rank === undefined ? null : Number(item.rank),
        count: item.count,
        countLabel: item.countLabel,
        source: item.source
      };
    }).filter(Boolean);
  }

  function weighted(years, field) {
    var numerator = 0;
    var denominator = 0;
    years.forEach(function (item) {
      var value = Number(item[field]);
      if (!isFinite(value) || value <= 0) { return; }
      var weight = YEAR_WEIGHTS[String(item.year)] || 0.1;
      numerator += value * weight;
      denominator += weight;
    });
    return denominator ? numerator / denominator : NaN;
  }

  function splitRecommendations(candidates) {
    var score = state.form.score;
    var chosen = {};
    var rush = [];
    var steady = [];
    var safe = [];
    var preferred = state.form.targetRegion === "all"
      ? candidates
      : candidates.filter(function (item) { return item.regionMatched; });
    var fallback = state.form.targetRegion === "all"
      ? []
      : candidates.filter(function (item) { return !item.regionMatched; });
    var pools = [preferred, fallback];

    function stage(target, limit, filterFn, sorter) {
      pools.forEach(function (pool) {
        if (target.length >= limit) { return; }
        pickInto(target, limit, pool.filter(filterFn), chosen, sorter);
      });
    }

    stage(rush, 10, function (item) {
      return item.lineScore > score && item.lineScore <= score + 38;
    }, function (a, b) {
      return (a.lineScore - score) - (b.lineScore - score) || b.completeness - a.completeness;
    });

    stage(rush, 10, function (item) {
      return item.lineScore > score;
    }, function (a, b) {
      return (a.lineScore - score) - (b.lineScore - score);
    });

    stage(rush, 10, function () {
      return true;
    }, function (a, b) {
      return Math.abs(a.lineScore - score - 4) - Math.abs(b.lineScore - score - 4);
    });

    stage(steady, 20, function (item) {
      return item.lineScore <= score + 6 && item.lineScore >= score - 28;
    }, function (a, b) {
      return a.closeness - b.closeness || b.completeness - a.completeness;
    });

    stage(steady, 20, function () {
      return true;
    }, function (a, b) {
      return Math.abs(a.lineScore - score) - Math.abs(b.lineScore - score);
    });

    stage(safe, 10, function (item) {
      return item.lineScore < score - 22;
    }, function (a, b) {
      return b.lineScore - a.lineScore || b.completeness - a.completeness;
    });

    stage(safe, 10, function () {
      return true;
    }, function (a, b) {
      return b.scoreGap - a.scoreGap;
    });

    rush.forEach(function (item) { item.band = "rush"; });
    steady.forEach(function (item) { item.band = "steady"; });
    safe.forEach(function (item) { item.band = "safe"; });

    var all = rush.concat(steady).concat(safe);
    return { all: all, rush: rush, steady: steady, safe: safe };
  }

  function pickInto(target, limit, pool, chosen, sorter) {
    if (target.length >= limit) { return; }
    pool
      .filter(function (item) { return !chosen[item.school.id]; })
      .sort(sorter)
      .slice(0, limit - target.length)
      .forEach(function (item) {
        chosen[item.school.id] = true;
        target.push(item);
      });
  }

  function renderSummary(candidates) {
    var scoreRank = estimateRank(2025, state.form.subject, state.form.score);
    var usedRank = state.form.rank || scoreRank;
    var rankStatus = "未填写";
    if (state.form.rank && scoreRank) {
      var drift = Math.abs(state.form.rank - scoreRank) / Math.max(scoreRank, 1);
      rankStatus = drift > 0.18 ? "需核对" : "一致";
    } else if (scoreRank) {
      rankStatus = "按分估算";
    }

    els.summary.innerHTML = [
      summaryCard("当前分数", formatScore(state.form.score)),
      summaryCard("参考位次", usedRank ? formatNumber(Math.round(usedRank)) : "缺数据"),
      summaryCard(state.form.targetRegion === "all" ? "候选院校" : "地区候选", formatNumber(selectedRegionCount(candidates))),
      summaryCard("位次校验", rankStatus)
    ].join("");
  }

  function summaryCard(label, value) {
    return '<div class="summary-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function renderQuality(candidates) {
    var subjectLabel = state.form.subject === "physics" ? "物理类 / 理科" : "历史类 / 文科";
    var scoreRank = estimateRank(2025, state.form.subject, state.form.score);
    var regionLine = state.form.targetRegion === "all"
      ? "全部地区参与排序。"
      : selectedRegionLabel() + "优先推荐；若不足 40 个，自动用其它地区补齐。当前匹配 " + formatNumber(selectedRegionCount(candidates)) + " 所。";
    var parts = [
      "<div><strong>地区</strong> " + escapeHtml(state.form.region) + " · " + subjectLabel + "</div>",
      "<div><strong>目标地区</strong> " + escapeHtml(regionLine) + "</div>",
      "<div><strong>算法</strong> 2025 投档分权重 45%，2024 权重 35%，2023 权重 20%；缺年自动归一化。</div>",
      "<div><strong>位次</strong> " + (scoreRank ? "按 2025 一分一段估算为 " + formatNumber(scoreRank) + "。" : "当前分数未匹配到一分一段。") + "</div>",
      "<div><strong>边界</strong> 住宿条件和设施未在投档统计中披露，页面保留章程核验字段，不填虚构描述。</div>"
    ];
    if (!candidates.length) {
      parts.push("<div><strong>提示</strong> 当前科类暂无候选数据。</div>");
    }
    els.quality.innerHTML = parts.join("");
  }

  function renderResults() {
    var list = currentResults();
    if (!list.length) {
      renderEmpty("没有匹配到推荐结果。");
      return;
    }

    var query = state.form.query.toLowerCase();
    els.results.innerHTML = list.map(function (item, index) {
      return renderSchool(item, index + 1, query);
    }).join("");
  }

  function currentResults() {
    return state.results[state.activeBand] || [];
  }

  function renderSchool(item, position, query) {
    var school = item.school;
    var expanded = !!state.expanded[school.id];
    var programs = filterPrograms(school.programs || [], query);
    var visiblePrograms = programs.slice(0, 80);
    var band = BAND_LABEL[item.band] || "";
    var bandClass = BAND_CLASS[item.band] || "";
    var tuition = school.tuitionRange ? school.tuitionRange + " 元/年" : "见专业表";
    var lineRank = isFinite(item.lineRank) ? Math.round(item.lineRank) : null;
    var rankGap = item.rankGap === null ? "缺位次" : (item.rankGap >= 0 ? "优 " : "差 ") + formatNumber(Math.abs(Math.round(item.rankGap)));
    var scoreGap = item.scoreGap >= 0 ? "+" + formatScore(item.scoreGap) : formatScore(item.scoreGap);
    var regionLabel = item.regionCategory ? item.regionCategory.label : "其他地区";

    return [
      '<article class="school-card ' + (expanded ? "expanded" : "") + '">',
      '<div class="school-main">',
      '<div class="school-head">',
      '<div class="school-title">',
      '<div class="rank-line">#' + position + ' · ' + escapeHtml(school.subject === "physics" ? "物理类" : "历史类") + '</div>',
      '<h3>' + escapeHtml(school.name) + '</h3>',
      '</div>',
      '<div class="school-actions">',
      '<span class="pill ' + bandClass + '">' + band + '</span>',
      '<span class="pill public">' + escapeHtml(school.ownership || "待核验") + '</span>',
      '<span class="pill region">' + escapeHtml(regionLabel) + '</span>',
      '<button class="icon-button" type="button" data-toggle-school="' + escapeHtml(school.id) + '">' + (expanded ? "收起专业" : "查看专业") + '</button>',
      '</div>',
      '</div>',
      '<div class="metric-strip">',
      metric("参考分", formatScore(item.lineScore)),
      metric("分差", scoreGap),
      metric("参考位次", lineRank ? formatNumber(lineRank) : "缺数据"),
      metric("位次差", rankGap),
      metric("地区分类", regionLabel),
      metric("学校位置", school.location || "见专业表"),
      metric("学费", tuition),
      metric("住宿条件", school.dormitory || "见章程"),
      metric("环境设施", school.facilities || "见章程"),
      '</div>',
      renderHistory(item.years),
      '<div class="source-row">招生章程：' + renderRegulation(school) + '</div>',
      '</div>',
      '<div class="program-panel">',
      '<div class="table-wrap">',
      '<table>',
      '<thead><tr><th>专业 / 专业组</th><th>年份</th><th>分数</th><th>位次</th><th>人数</th><th>学费</th><th>位置</th><th>备注</th></tr></thead>',
      '<tbody>',
      visiblePrograms.map(renderProgram).join("") || '<tr><td colspan="8" class="muted">暂无匹配专业</td></tr>',
      '</tbody>',
      '</table>',
      '</div>',
      programs.length > visiblePrograms.length ? '<p class="source-row">已显示前 80 条，另有 ' + formatNumber(programs.length - visiblePrograms.length) + ' 条可通过专业关键词筛选。</p>' : '',
      '</div>',
      '</article>'
    ].join("");
  }

  function metric(label, value) {
    return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong title="' + escapeHtml(value) + '">' + escapeHtml(value) + '</strong></div>';
  }

  function renderHistory(years) {
    var byYear = {};
    years.forEach(function (item) { byYear[item.year] = item; });
    return '<div class="history-grid">' + [2025, 2024, 2023].map(function (year) {
      var item = byYear[year];
      if (!item) {
        return '<div class="history-item"><span>' + year + '</span><strong>未收录</strong><span>分数 / 位次 / 人数</span></div>';
      }
      var rank = item.rank ? formatNumber(item.rank) : "缺位次";
      var count = item.count ? formatNumber(item.count) : "缺人数";
      return '<div class="history-item"><span>' + year + ' · ' + escapeHtml(item.batch || "") + '</span><strong>' + formatScore(item.score) + ' / ' + rank + ' / ' + count + '</strong><span>分数 / 位次 / ' + escapeHtml(item.countLabel || "人数") + '</span></div>';
    }).join("") + '</div>';
  }

  function renderProgram(program) {
    return [
      '<tr>',
      '<td><strong>' + escapeHtml(program.major || "未命名") + '</strong><div class="muted">' + escapeHtml(program.code || "") + '</div></td>',
      '<td>' + escapeHtml(program.year || "") + '</td>',
      '<td>' + (program.score ? formatScore(program.score) : "见章程") + '</td>',
      '<td>' + (program.rank ? formatNumber(program.rank) : "缺位次") + '</td>',
      '<td>' + (program.count ? formatNumber(program.count) : "缺人数") + '</td>',
      '<td>' + (program.fee ? escapeHtml(program.fee) + ' 元/年' : "见章程") + '</td>',
      '<td>' + escapeHtml(program.place || "见章程") + '</td>',
      '<td>' + escapeHtml(program.note || "") + '</td>',
      '</tr>'
    ].join("");
  }

  function filterPrograms(programs, query) {
    var sorted = programs.slice().sort(function (a, b) {
      return Number(b.year || 0) - Number(a.year || 0) || Number(b.score || 0) - Number(a.score || 0);
    });
    if (!query) { return sorted; }
    return sorted.filter(function (program) {
      var text = [program.major, program.note, program.place, program.batch].join(" ").toLowerCase();
      return text.indexOf(query) >= 0;
    });
  }

  function renderRegulation(school) {
    if (school.regulation) {
      return '<a href="' + escapeHtml(school.regulation) + '" target="_blank" rel="noreferrer">' + escapeHtml(school.regulation) + '</a>';
    }
    return '<a href="https://gaokao.chsi.com.cn/zsgs/zhangcheng/" target="_blank" rel="noreferrer">阳光高考招生章程检索</a>';
  }

  function renderSources() {
    if (!data || !Array.isArray(data.sources)) {
      els.sourceList.innerHTML = "";
      return;
    }
    els.sourceList.innerHTML = data.sources.map(function (source) {
      return '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(source.label) + '</a>';
    }).join("");
  }

  function renderDataBadge() {
    if (!data || !Array.isArray(data.schools)) {
      els.dataBadge.textContent = "未生成数据";
      return;
    }
    els.dataBadge.textContent = "数据 " + escapeHtml(data.generatedAt || "") + " · " + formatNumber(data.schools.length) + " 校";
  }

  function renderEmpty(message) {
    els.results.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
  }

  function estimateRank(year, subject, score) {
    if (!data || !data.rankMaps || !data.rankMaps[String(year)] || !data.rankMaps[String(year)][subject]) {
      return null;
    }
    var map = data.rankMaps[String(year)][subject];
    var target = Math.floor(Number(score));
    while (target >= 0) {
      if (Object.prototype.hasOwnProperty.call(map, String(target))) {
        return Number(map[String(target)]);
      }
      target -= 1;
    }
    return null;
  }

  function formatNumber(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) { return ""; }
    return Number(value).toLocaleString("zh-CN");
  }

  function formatScore(value) {
    var number = Number(value);
    if (!isFinite(number)) { return ""; }
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function handleImport(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var text = String(reader.result || "");
        var importedSchools = file.name.toLowerCase().endsWith(".json")
          ? parseJsonImport(text)
          : parseCsvImport(text);
        if (!importedSchools.length) {
          throw new Error("没有识别到院校记录");
        }
        data.schools = data.schools.concat(importedSchools);
        data.generatedAt = (data.generatedAt || "") + " + 导入";
        renderDataBadge();
        runRecommendation();
      } catch (error) {
        els.quality.innerHTML = '<div><strong>导入失败</strong> ' + escapeHtml(error.message) + '</div>';
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function parseJsonImport(text) {
    var json = JSON.parse(text);
    if (Array.isArray(json)) { return rowsToSchools(json); }
    if (json && Array.isArray(json.schools)) { return json.schools; }
    return [];
  }

  function parseCsvImport(text) {
    var lines = text.split(/\r?\n/).filter(function (line) { return line.trim(); });
    if (lines.length < 2) { return []; }
    var headers = parseCsvLine(lines[0]).map(function (item) { return item.trim(); });
    var rows = lines.slice(1).map(function (line) {
      var values = parseCsvLine(line);
      var row = {};
      headers.forEach(function (header, index) { row[header] = values[index] || ""; });
      return row;
    });
    return rowsToSchools(rows);
  }

  function parseCsvLine(line) {
    var result = [];
    var current = "";
    var quoted = false;
    for (var i = 0; i < line.length; i += 1) {
      var char = line[i];
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  function rowsToSchools(rows) {
    var map = {};
    rows.forEach(function (row) {
      var subject = normalizeSubject(first(row, ["subject", "科类", "类别"]));
      var schoolName = first(row, ["school", "学校", "院校", "院校名称"]);
      if (!subject || !schoolName) { return; }
      var key = subject + "|" + schoolName;
      if (!map[key]) {
        map[key] = {
          id: "import-" + key.replace(/[^\w\u4e00-\u9fa5]+/g, "-"),
          subject: subject,
          name: schoolName,
          rawName: schoolName,
          ownership: first(row, ["ownership", "办学性质", "公办民办"]) || "待核验",
          location: first(row, ["location", "位置", "学校位置"]) || "见专业办学地点",
          dormitory: first(row, ["dormitory", "住宿", "住宿条件"]) || "见章程",
          facilities: first(row, ["facilities", "设施", "环境设施"]) || "见章程",
          regulation: first(row, ["regulation", "章程", "招生章程链接"]) || "",
          tuitionRange: "",
          history: [],
          programs: []
        };
      }
      var school = map[key];
      var year = Number(first(row, ["year", "年份"]) || data.currentYear || 2025);
      var score = Number(first(row, ["score", "分数", "最低分"]) || 0);
      var rank = Number(first(row, ["rank", "位次"]) || 0);
      var count = Number(first(row, ["count", "录取数", "人数", "计划数"]) || 0);
      var batch = first(row, ["batch", "批次"]) || "导入数据";
      if (score > 0) {
        school.history.push({ year: year, batch: batch, score: score, rank: rank || null, count: count || null, countLabel: "导入人数", source: "" });
      }
      var major = first(row, ["major", "专业", "专业名称"]);
      if (major) {
        school.programs.push({
          year: year,
          batch: batch,
          code: first(row, ["code", "专业代码"]) || "",
          major: major,
          score: score || null,
          rank: rank || null,
          count: count || null,
          fee: first(row, ["fee", "学费"]) || "",
          place: first(row, ["place", "办学地点", "位置"]) || "",
          note: first(row, ["note", "备注"]) || "",
          source: ""
        });
      }
    });
    return Object.keys(map).map(function (key) { return map[key]; });
  }

  function first(row, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      if (row[keys[i]] !== undefined && row[keys[i]] !== "") { return String(row[keys[i]]).trim(); }
    }
    return "";
  }

  function normalizeSubject(value) {
    if (/物理|理科|physics/i.test(value)) { return "physics"; }
    if (/历史|文科|history/i.test(value)) { return "history"; }
    return "";
  }
})();
