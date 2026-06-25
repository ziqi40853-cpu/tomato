const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const urlModule = require("url");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");

const rankSources = {
  "2025": {
    physics: { label: "2025 物理类一分一段", url: "https://www.nm.zsks.cn/fzlm/25gktj/202506/t20250624_45794.html" },
    history: { label: "2025 历史类一分一段", url: "https://www.nm.zsks.cn/fzlm/25gktj/202506/t20250624_45795.html" }
  },
  "2024": {
    physics: { label: "2024 理科一分一段", url: "https://www.nm.zsks.cn/fzlm/24gktj/202406/t20240623_44817.html" },
    history: { label: "2024 文科一分一段", url: "https://www.nm.zsks.cn/fzlm/24gktj/202406/t20240623_44816.html" }
  },
  "2023": {
    physics: { label: "2023 理科一分一段", url: "https://www.nm.zsks.cn/fzlm/23gktj/202306/t20230623_43897.html" },
    history: { label: "2023 文科一分一段", url: "https://www.nm.zsks.cn/fzlm/23gktj/202306/t20230623_43896.html" }
  }
};

const oldAdmissionSets = [
  { year: 2024, batch: "本科一批", root: "https://www.nm.zsks.cn/24gkwb/gktj_24_31_19" },
  { year: 2024, batch: "本科二批", root: "https://www.nm.zsks.cn/24gkwb/gktj_24_41_20" },
  { year: 2023, batch: "本科一批", root: "https://www.nm.zsks.cn/23gkwb/gktj_23_31_21" },
  { year: 2023, batch: "本科二批", root: "https://www.nm.zsks.cn/23gkwb/gktj_23_41_20" }
];

const subjectByOldCategory = { "理科": "physics", "文科": "history" };
const subjectByNewCategory = { "物理类": "physics", "历史类": "history" };

function requestText(url, redirectCount) {
  redirectCount = redirectCount || 0;
  return new Promise(function(resolve, reject) {
    const client = url.indexOf("https:") === 0 ? https : http;
    const options = urlModule.parse(url);
    options.headers = { "User-Agent": "Mozilla/5.0 volunteer-planner/1.0" };
    const req = client.get(options, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectCount < 5) {
        const nextUrl = urlModule.resolve(url, res.headers.location);
        res.resume();
        requestText(nextUrl, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("HTTP " + res.statusCode + " " + url));
        return;
      }

      const chunks = [];
      res.on("data", function(chunk) { chunks.push(chunk); });
      res.on("end", function() {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
    req.setTimeout(30000, function() {
      req.abort();
      reject(new Error("Timeout " + url));
    });
    req.on("error", reject);
  });
}

async function requestJson(url) {
  const text = await requestText(url);
  return JSON.parse(text);
}

function cleanHtmlText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function getRankMap(url) {
  const html = await requestText(url);
  const map = {};
  const rowMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  rowMatches.forEach(function(row) {
    const cellMatches = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    if (cellMatches.length < 2) return;
    const scoreText = cleanHtmlText(cellMatches[0]);
    const rankText = cleanHtmlText(cellMatches[1]);
    const scoreMatch = scoreText.match(/(\d+)/);
    const rankMatch = rankText.match(/(\d+)/);
    if (scoreMatch && rankMatch) {
      map[String(Number(scoreMatch[1]))] = Number(rankMatch[1]);
    }
  });
  return map;
}

function rankForScore(rankMap, score) {
  if (!rankMap || score === null || score === undefined) return null;
  let target = Math.floor(Number(score));
  while (target >= 0) {
    if (Object.prototype.hasOwnProperty.call(rankMap, String(target))) {
      return rankMap[String(target)];
    }
    target -= 1;
  }
  return null;
}

function normalizeSchoolName(name) {
  return String(name || "")
    .replace(/（民办）/g, "")
    .replace(/\(民办\)/g, "")
    .replace(/（独立学院）/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function ownership(name) {
  const raw = String(name || "");
  if (/民办|独立学院/.test(raw)) return "民办";
  if (/香港|澳门|诺丁汉|利物浦|比勒费尔德|中外合作|国际学院/.test(raw)) return "合作/境外";
  return "公办";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeId(text) {
  return String(text || "").replace(/[^\w\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
}

function createSchoolMap() {
  const map = {};
  return {
    values: function() {
      return Object.keys(map).map(function(key) { return map[key]; });
    },
    get: function(subject, rawName) {
      const name = normalizeSchoolName(rawName);
      const key = subject + "|" + name;
      if (!map[key]) {
        map[key] = {
          id: safeId(key),
          subject: subject,
          name: name,
          rawName: rawName,
          ownership: ownership(rawName),
          location: "见专业办学地点",
          dormitory: "招生统计未披露，请以章程/学校官网为准",
          facilities: "招生统计未披露，请以章程/学校官网为准",
          regulation: "",
          tuitionRange: "",
          history: [],
          programs: []
        };
      }
      return map[key];
    }
  };
}

function addHistory(school, year, batch, score, rank, count, countLabel, source) {
  school.history.push({
    year: year,
    batch: batch || "",
    score: Math.round(Number(score) * 10) / 10,
    rank: rank,
    count: numberOrNull(count),
    countLabel: countLabel,
    source: source
  });
}

function addProgram(school, program) {
  if (!program.major) return;
  school.programs.push(program);
}

async function build() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

  console.log("Fetching score segment tables...");
  const rankMaps = {};
  for (const year of Object.keys(rankSources)) {
    rankMaps[year] = {};
    for (const subject of Object.keys(rankSources[year])) {
      rankMaps[year][subject] = await getRankMap(rankSources[year][subject].url);
      console.log("  " + year + "/" + subject + ": " + Object.keys(rankMaps[year][subject]).length + " rows");
    }
  }

  const schoolMap = createSchoolMap();

  for (const set of oldAdmissionSets) {
    console.log("Fetching " + set.year + " " + set.batch + "...");
    const yxList = await requestJson(set.root + "/data/tjyx.json");
    const zyList = await requestJson(set.root + "/data/tjzy.json");
    const programsByPath = {};

    zyList.forEach(function(zy) {
      const key = String(zy.path || "");
      if (!programsByPath[key]) programsByPath[key] = [];
      programsByPath[key].push(zy);
    });

    yxList.forEach(function(yx) {
      const subject = subjectByOldCategory[String(yx.klmc || "")];
      if (!subject) return;

      let score = numberOrNull(yx.tdzdf1);
      if (!score || score <= 0) score = numberOrNull(yx.tdzdf);
      if (!score || score <= 0) score = numberOrNull(yx.lqzdf);
      if (!score || score <= 0) return;

      const school = schoolMap.get(subject, String(yx.yxmc || ""));
      if (!school.regulation && yx.zszc) school.regulation = String(yx.zszc);

      const rank = rankForScore(rankMaps[String(set.year)][subject], score);
      const pathKey = String(yx.path || "");
      const sourceUrl = set.root + "/tj/tjyx.html?path=" + encodeURIComponent(pathKey);
      addHistory(school, set.year, String(yx.pcmc || set.batch), score, rank, yx.jhs, "招生计划数", sourceUrl);

      (programsByPath[pathKey] || []).forEach(function(zy) {
        let pScore = numberOrNull(zy.lqzdf);
        if (!pScore || pScore <= 0) pScore = score;
        addProgram(school, {
          year: set.year,
          batch: String(zy.jhlbmc || ""),
          code: String(zy.zydh || ""),
          major: String(zy.zymc || ""),
          score: Math.round(Number(pScore) * 10) / 10,
          rank: rankForScore(rankMaps[String(set.year)][subject], pScore),
          count: numberOrNull(zy.jhs),
          fee: String(zy.xf || ""),
          place: String(zy.bxdd || ""),
          note: String(zy.bz || ""),
          source: set.root + "/tj/tjzy.html?path=" + encodeURIComponent(pathKey)
        });
      });
    });
  }

  console.log("Fetching 2025本科批投档数据...");
  const data2025Url = "https://www.nm.zsks.cn/25gktdlq/zdxtdzgdf-bk-wl-qcsj-1/data/td.json";
  const rows2025 = await requestJson(data2025Url);
  rows2025.forEach(function(row) {
    const subject = subjectByNewCategory[String(row.KLMC || "")];
    if (!subject) return;
    if (String(row.PCMC || "") !== "本科批") return;
    if (String(row.JHLBMC || "") !== "普通类") return;

    const score = numberOrNull(row.ZDF);
    if (!score || score <= 0) return;
    const school = schoolMap.get(subject, String(row.YXMC || ""));
    const rank = rankForScore(rankMaps["2025"][subject], score);
    addHistory(school, 2025, String(row.PCMC || "本科批"), score, rank, row.TDRS, "投档人数", data2025Url);
    addProgram(school, {
      year: 2025,
      batch: String(row.PCMC || "本科批"),
      code: String(row.ZYZDH || "").trim(),
      major: "专业组 " + String(row.ZYZDH || "").trim(),
      score: Math.round(Number(score) * 10) / 10,
      rank: rank,
      count: numberOrNull(row.TDRS),
      fee: "",
      place: "见招生章程",
      note: "首选/再选科目代码：" + row.SXKM + "/" + row.CXKM1 + "/" + row.CXKM2,
      source: data2025Url
    });
  });

  const schools = schoolMap.values();
  schools.forEach(function(school) {
    const placeCounts = {};
    const fees = [];
    school.programs.forEach(function(program) {
      if (program.place && program.place !== "见招生章程") {
        placeCounts[program.place] = (placeCounts[program.place] || 0) + 1;
      }
      const fee = numberOrNull(program.fee);
      if (fee && fee > 0) fees.push(Math.round(fee));
    });
    const places = Object.keys(placeCounts).sort(function(a, b) { return placeCounts[b] - placeCounts[a]; });
    if (places.length) school.location = places[0];
    if (fees.length) {
      const min = Math.min.apply(Math, fees);
      const max = Math.max.apply(Math, fees);
      school.tuitionRange = min === max ? String(min) : min + "-" + max;
    }
  });

  schools.sort(function(a, b) {
    if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  const payload = {
    generatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    region: "内蒙古",
    currentYear: 2025,
    subjects: [
      { id: "physics", label: "物理类", legacyLabel: "理科" },
      { id: "history", label: "历史类", legacyLabel: "文科" }
    ],
    sources: [
      { label: "2025内蒙古本科批第一次投档最高分最低分", url: "https://www.nm.zsks.cn/25gktdlq/zdxtdzgdf-bk-wl-qcsj-1/tj/tdzgzdf.html" },
      { label: "2024内蒙古本科一批第一次填报最终统计", url: "https://www.nm.zsks.cn/24gkwb/gktj_24_31_19/tj/tjkl.html" },
      { label: "2024内蒙古本科二批第一次填报最终统计", url: "https://www.nm.zsks.cn/24gkwb/gktj_24_41_20/tj/tjkl.html" },
      { label: "2023内蒙古本科一批第一次填报最终统计", url: "https://www.nm.zsks.cn/23gkwb/gktj_23_31_21/tj/tjkl.html" },
      { label: "2023内蒙古本科二批第一次填报最终统计", url: "https://www.nm.zsks.cn/23gkwb/gktj_23_41_20/tj/tjkl.html" },
      { label: "内蒙古2025/2024/2023一分一段表", url: "https://www.nm.zsks.cn/fzlm/gktj/" }
    ],
    rankSources: rankSources,
    rankMaps: rankMaps,
    schools: schools
  };

  const output = "window.ADMISSION_DATA = " + JSON.stringify(payload) + ";";
  const outFile = path.join(dataDir, "admissions.js");
  const publicOutFile = path.join(rootDir, "admissions.js");
  fs.writeFileSync(outFile, output, "utf8");
  fs.writeFileSync(publicOutFile, output, "utf8");

  const programCount = schools.reduce(function(sum, school) { return sum + school.programs.length; }, 0);
  console.log("Wrote " + outFile);
  console.log("Wrote " + publicOutFile);
  console.log("Schools: " + schools.length);
  console.log("Programs: " + programCount);
}

build().catch(function(error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
