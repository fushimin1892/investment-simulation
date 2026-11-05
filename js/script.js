"use strict";

/* ===================== 共通ユーティリティ ===================== */

function formatYen(value) {
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return n.toLocaleString("ja-JP") + "円";
}

function formatYearsMonths(totalMonths) {
  const m = Math.max(0, Math.round(totalMonths));
  const y = Math.floor(m / 12);
  const rem = m % 12;
  if (y <= 0) return `${rem}ヶ月`;
  if (rem === 0) return `${y}年`;
  return `${y}年${rem}ヶ月`;
}

/** カンマ区切り数値入力欄の値を数値としてパースする（カンマは無視） */
function parseNumberInput(str) {
  return parseFloat(String(str).replace(/,/g, ""));
}

function formatNumberInput(value) {
  const n = parseNumberInput(value);
  return Number.isFinite(n) ? n.toLocaleString("ja-JP") : "";
}

function getNum(id, fallback = 0) {
  const el = document.getElementById(id);
  const v = parseNumberInput(el.value);
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function bindPair(rangeId, numId, onChange) {
  const rangeEl = document.getElementById(rangeId);
  const numEl = document.getElementById(numId);

  numEl.value = formatNumberInput(numEl.value);

  rangeEl.addEventListener("input", () => {
    numEl.value = formatNumberInput(rangeEl.value);
    onChange();
  });

  numEl.addEventListener("input", () => {
    let v = parseNumberInput(numEl.value);
    if (!Number.isFinite(v)) v = 0;
    v = clamp(v, parseFloat(numEl.getAttribute("min")), parseFloat(numEl.getAttribute("max")));
    rangeEl.value = clamp(v, parseFloat(rangeEl.min), parseFloat(rangeEl.max));
    onChange();
  });

  numEl.addEventListener("blur", () => {
    numEl.value = formatNumberInput(numEl.value);
  });
}

/* ===================== 金融計算ロジック ===================== */
/* 積立は「毎月初に入金し、その月も運用される」年金前払い（アニュイティ・デュー）方式で統一する */

function monthlyRate(annualPercent) {
  return Math.max(0, annualPercent) / 100 / 12;
}

function compoundBalance(p0, pmt, r, months) {
  const n = Math.max(0, months);
  if (r === 0) return p0 + pmt * n;
  const growth = Math.pow(1 + r, n);
  return p0 * growth + pmt * (1 + r) * ((growth - 1) / r);
}

function requiredMonthlyPmt(target, p0, r, n) {
  if (n <= 0) return 0;
  if (r === 0) return Math.max(0, (target - p0) / n);
  const growth = Math.pow(1 + r, n);
  const annuityFactor = (1 + r) * ((growth - 1) / r);
  if (annuityFactor <= 0) return 0;
  return Math.max(0, (target - p0 * growth) / annuityFactor);
}

function requiredInitialP0(target, pmt, r, n) {
  if (r === 0) return Math.max(0, target - pmt * n);
  const growth = Math.pow(1 + r, n);
  const contributionsFv = pmt * (1 + r) * ((growth - 1) / r);
  return Math.max(0, (target - contributionsFv) / growth);
}

/** 目標達成に必要な月数。達成不可能な場合は null を返す。 */
function requiredMonths(target, p0, pmt, r) {
  if (p0 >= target) return 0;
  if (r === 0) {
    if (pmt <= 0) return null;
    return Math.ceil((target - p0) / pmt);
  }
  const k = (pmt * (1 + r)) / r;
  const denom = p0 + k;
  if (denom <= 0) return null;
  const x = (target + k) / denom;
  if (x <= 1) return 0;
  return Math.ceil(Math.log(x) / Math.log(1 + r));
}

/** 積立蓄積系タブ共通：0ヶ月から totalMonths までの元本・残高シリーズを生成する */
function buildAccumulationSeries(p0, pmt, annualPercent, totalMonths) {
  const r = monthlyRate(annualPercent);
  const months = Math.max(0, Math.round(totalMonths));
  const points = [];
  const wholeYears = Math.floor(months / 12);
  for (let y = 0; y <= wholeYears; y++) points.push(y * 12);
  if (months % 12 !== 0) points.push(months);

  const labels = [];
  const principal = [];
  const profit = [];
  points.forEach((m) => {
    const bal = compoundBalance(p0, pmt, r, m);
    const prin = p0 + pmt * m;
    labels.push(formatYearsMonths(m));
    principal.push(Math.round(prin));
    profit.push(Math.round(bal - prin));
  });
  return { labels, principal, profit };
}

/** 取り崩しシミュレーション：運用を継続しながら毎月定額を取り崩す */
function simulateWithdrawal({ balance, annualPercent, mode, monthlyWithdraw, years }) {
  const r = monthlyRate(annualPercent);
  const CAP_MONTHS = 1200; // 100年で打ち切り

  let pmt;
  let capMonths;
  if (mode === "amount") {
    const n = Math.max(1, Math.round(years * 12));
    pmt = r === 0 ? balance / n : (balance * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    capMonths = n;
  } else {
    pmt = Math.max(0, monthlyWithdraw);
    capMonths = CAP_MONTHS;
  }

  const balances = [balance];
  const withdrawnCum = [0];
  let b = balance;
  let cum = 0;
  let depletedAt = null;

  for (let m = 1; m <= capMonths; m++) {
    b = b * (1 + r) - pmt;
    cum += pmt;
    if (b <= 0) {
      b = 0;
      balances.push(b);
      withdrawnCum.push(cum);
      depletedAt = m;
      break;
    }
    balances.push(b);
    withdrawnCum.push(cum);
  }

  const perpetual = mode === "period" && depletedAt === null;
  return { pmt, balances, withdrawnCum, depletedAt, perpetual };
}

/* ===================== Chart.js セットアップ ===================== */

Chart.defaults.color = "#94a3b8";
Chart.defaults.borderColor = "rgba(148, 163, 184, 0.15)";
Chart.defaults.font.family = "'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif";

function yenTick(value) {
  return Number(value).toLocaleString("ja-JP");
}

function createAccumulationChart(canvasId) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "元本",
          data: [],
          borderColor: "#64748b",
          backgroundColor: "rgba(100, 116, 139, 0.35)",
          fill: "origin",
          stack: "total",
          tension: 0.25,
          pointRadius: 0,
        },
        {
          label: "運用益",
          data: [],
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.5)",
          fill: "-1",
          stack: "total",
          tension: 0.25,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ticks: { callback: yenTick } },
      },
      plugins: {
        legend: { labels: { color: "#cbd5e1" } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatYen(item.raw)}`,
          },
        },
      },
    },
  });
}

function createWithdrawChart(canvasId) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "資産残高",
          data: [],
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.4)",
          fill: "origin",
          tension: 0.25,
          pointRadius: 0,
        },
        {
          label: "累計取り崩し額",
          data: [],
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0)",
          borderDash: [6, 4],
          fill: false,
          tension: 0.25,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false } },
        y: { ticks: { callback: yenTick } },
      },
      plugins: {
        legend: { labels: { color: "#cbd5e1" } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatYen(item.raw)}`,
          },
        },
      },
    },
  });
}

function updateAccumulationChart(chart, series) {
  chart.data.labels = series.labels;
  chart.data.datasets[0].data = series.principal;
  chart.data.datasets[1].data = series.profit;
  chart.update();
}

function downsampleMonthly(balances, withdrawnCum) {
  const lastIndex = balances.length - 1;
  const labels = [];
  const balArr = [];
  const cumArr = [];
  for (let m = 0; m <= lastIndex; m += 12) {
    labels.push(formatYearsMonths(m));
    balArr.push(Math.round(balances[m]));
    cumArr.push(Math.round(withdrawnCum[m]));
  }
  if (lastIndex % 12 !== 0) {
    labels.push(formatYearsMonths(lastIndex));
    balArr.push(Math.round(balances[lastIndex]));
    cumArr.push(Math.round(withdrawnCum[lastIndex]));
  }
  return { labels, balArr, cumArr };
}

/* ===================== タブごとの再計算 ===================== */

const charts = {
  future: createAccumulationChart("chart-future"),
  monthly: createAccumulationChart("chart-monthly"),
  period: createAccumulationChart("chart-period"),
  initial: createAccumulationChart("chart-initial"),
  withdraw: createWithdrawChart("chart-withdraw"),
};

function recalcFuture() {
  const p0 = getNum("future-initial-num");
  const pmt = getNum("future-monthly-num");
  const ratePercent = getNum("future-rate-num");
  const years = Math.max(0, getNum("future-years-num"));
  const r = monthlyRate(ratePercent);
  const n = years * 12;

  const fv = compoundBalance(p0, pmt, r, n);
  const principal = p0 + pmt * n;
  const profit = fv - principal;

  document.getElementById("future-result-total").textContent = formatYen(fv);
  document.getElementById("future-result-principal").textContent = formatYen(principal);
  document.getElementById("future-result-profit").textContent = formatYen(profit);

  updateAccumulationChart(charts.future, buildAccumulationSeries(p0, pmt, ratePercent, n));
}

function recalcMonthly() {
  const target = getNum("monthly-target-num");
  const p0 = getNum("monthly-initial-num");
  const ratePercent = getNum("monthly-rate-num");
  const years = Math.max(1, getNum("monthly-years-num"));
  const r = monthlyRate(ratePercent);
  const n = years * 12;

  const pmt = requiredMonthlyPmt(target, p0, r, n);
  const fv = compoundBalance(p0, pmt, r, n);
  const principal = p0 + pmt * n;
  const profit = fv - principal;

  document.getElementById("monthly-result-pmt").textContent = formatYen(pmt);
  document.getElementById("monthly-result-principal").textContent = formatYen(principal);
  document.getElementById("monthly-result-profit").textContent = formatYen(profit);

  updateAccumulationChart(charts.monthly, buildAccumulationSeries(p0, pmt, ratePercent, n));
}

function recalcPeriod() {
  const target = getNum("period-target-num");
  const p0 = getNum("period-initial-num");
  const pmt = getNum("period-monthly-num");
  const ratePercent = getNum("period-rate-num");
  const r = monthlyRate(ratePercent);

  const n = requiredMonths(target, p0, pmt, r);
  const resultEl = document.getElementById("period-result-years");

  if (n === null) {
    resultEl.textContent = "達成不可能";
    document.getElementById("period-result-principal").textContent = "-";
    document.getElementById("period-result-profit").textContent = "-";
    return;
  }

  const fv = compoundBalance(p0, pmt, r, n);
  const principal = p0 + pmt * n;
  const profit = fv - principal;

  resultEl.textContent = formatYearsMonths(n);
  document.getElementById("period-result-principal").textContent = formatYen(principal);
  document.getElementById("period-result-profit").textContent = formatYen(profit);

  updateAccumulationChart(charts.period, buildAccumulationSeries(p0, pmt, ratePercent, n));
}

function recalcInitial() {
  const target = getNum("initial-target-num");
  const pmt = getNum("initial-monthly-num");
  const ratePercent = getNum("initial-rate-num");
  const years = Math.max(1, getNum("initial-years-num"));
  const r = monthlyRate(ratePercent);
  const n = years * 12;

  const p0 = requiredInitialP0(target, pmt, r, n);
  const fv = compoundBalance(p0, pmt, r, n);
  const principal = p0 + pmt * n;
  const profit = fv - principal;

  document.getElementById("initial-result-p0").textContent = formatYen(p0);
  document.getElementById("initial-result-principal").textContent = formatYen(principal);
  document.getElementById("initial-result-profit").textContent = formatYen(profit);

  updateAccumulationChart(charts.initial, buildAccumulationSeries(p0, pmt, ratePercent, n));
}

let withdrawMode = "period";

function recalcWithdraw() {
  const balance = getNum("withdraw-balance-num");
  const ratePercent = getNum("withdraw-rate-num");

  const result = simulateWithdrawal({
    balance,
    annualPercent: ratePercent,
    mode: withdrawMode,
    monthlyWithdraw: getNum("withdraw-monthly-num"),
    years: Math.max(1, getNum("withdraw-years-num")),
  });

  const totalWithdrawn = result.withdrawnCum[result.withdrawnCum.length - 1];

  if (withdrawMode === "period") {
    const periodEl = document.getElementById("withdraw-result-period");
    periodEl.textContent = result.perpetual
      ? "半永久的に取り崩し可能"
      : formatYearsMonths(result.depletedAt);
  } else {
    document.getElementById("withdraw-result-amount").textContent = formatYen(result.pmt);
  }
  document.getElementById("withdraw-result-total").textContent = formatYen(totalWithdrawn);

  const { labels, balArr, cumArr } = downsampleMonthly(result.balances, result.withdrawnCum);
  charts.withdraw.data.labels = labels;
  charts.withdraw.data.datasets[0].data = balArr;
  charts.withdraw.data.datasets[1].data = cumArr;
  charts.withdraw.update();
}

/* ===================== 入力バインド ===================== */

bindPair("future-initial-range", "future-initial-num", recalcFuture);
bindPair("future-monthly-range", "future-monthly-num", recalcFuture);
bindPair("future-rate-range", "future-rate-num", recalcFuture);
bindPair("future-years-range", "future-years-num", recalcFuture);

bindPair("monthly-target-range", "monthly-target-num", recalcMonthly);
bindPair("monthly-initial-range", "monthly-initial-num", recalcMonthly);
bindPair("monthly-rate-range", "monthly-rate-num", recalcMonthly);
bindPair("monthly-years-range", "monthly-years-num", recalcMonthly);

bindPair("period-target-range", "period-target-num", recalcPeriod);
bindPair("period-initial-range", "period-initial-num", recalcPeriod);
bindPair("period-monthly-range", "period-monthly-num", recalcPeriod);
bindPair("period-rate-range", "period-rate-num", recalcPeriod);

bindPair("initial-target-range", "initial-target-num", recalcInitial);
bindPair("initial-monthly-range", "initial-monthly-num", recalcInitial);
bindPair("initial-rate-range", "initial-rate-num", recalcInitial);
bindPair("initial-years-range", "initial-years-num", recalcInitial);

bindPair("withdraw-balance-range", "withdraw-balance-num", recalcWithdraw);
bindPair("withdraw-rate-range", "withdraw-rate-num", recalcWithdraw);
bindPair("withdraw-monthly-range", "withdraw-monthly-num", recalcWithdraw);
bindPair("withdraw-years-range", "withdraw-years-num", recalcWithdraw);

/* ===================== タブ / モード切替 ===================== */

function setActiveTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.id !== "panel-" + tab));
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

function setWithdrawMode(mode) {
  withdrawMode = mode;
  document.querySelectorAll("#withdraw-mode-toggle .mode-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode)
  );
  document.getElementById("withdraw-field-monthly").classList.toggle("hidden", mode !== "period");
  document.getElementById("withdraw-field-years").classList.toggle("hidden", mode !== "amount");
  document.getElementById("withdraw-result-row-period").classList.toggle("hidden", mode !== "period");
  document.getElementById("withdraw-result-row-amount").classList.toggle("hidden", mode !== "amount");
  recalcWithdraw();
}

document.querySelectorAll("#withdraw-mode-toggle .mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => setWithdrawMode(btn.dataset.mode));
});

/* ===================== PNG / PDF ダウンロード ===================== */

function downloadPng(target) {
  const canvasEl = document.getElementById("chart-" + target);
  const wrap = canvasEl.parentElement;
  html2canvas(wrap, { backgroundColor: "#0f172a", scale: 2 }).then((canvas) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${target}-graph.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}

function downloadPdf(target) {
  const panel = document.getElementById("panel-" + target);
  html2canvas(panel, { backgroundColor: "#0f172a", scale: 2 }).then((canvas) => {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/png");

    pdf.setFontSize(14);
    pdf.text(panel.dataset.reportTitle || "シミュレーション結果", margin, margin + 5);

    let heightLeft = imgHeight;
    let position = margin + 20;
    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - position;

    while (heightLeft > 0) {
      pdf.addPage();
      position = heightLeft - imgHeight;
      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(`${target}-report.pdf`);
  });
}

document.querySelectorAll(".btn-download").forEach((btn) => {
  btn.addEventListener("click", () => {
    const { action, target } = btn.dataset;
    if (action === "png") downloadPng(target);
    else downloadPdf(target);
  });
});

/* ===================== 初期化 ===================== */

setActiveTab("future");
setWithdrawMode("period");
recalcFuture();
recalcMonthly();
recalcPeriod();
recalcInitial();

/* ===================== PWA: Service Worker登録 ===================== */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
