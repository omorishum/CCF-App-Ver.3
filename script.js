
/**
 * CCF測定アプリ (CCF Measurement App)
 * * -----------------------------------------------------------------------------
 * 【著作権表示 / Copyright】
 * * Original Work:
 * Copyright (C) 2016 Takeshi KODAKA (kodaka@tokyo-med.ac.jp)
 * * Modified and Updated by:
 * Copyright (C) 2026 [Shumpei OMORI] ([shum12331@outlook.jp])
 * -----------------------------------------------------------------------------
 * * 【ライセンス / License】
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 * -----------------------------------------------------------------------------
 */

// =================================================================================
//  DOM要素の取得
// =================================================================================
const cprTimeDisplay = document.getElementById("time_cpr");
const ccTimeDisplay = document.getElementById("time_cc");
const rateDisplay = document.getElementById("rate");
const logDisplay = document.getElementById("log_interruption");
const customLogInput = document.getElementById("customLogInput");

const resetButton = document.getElementById("button-reset");
const cprButton = document.getElementById("button-cpr");
const ccButton = document.getElementById("button-cc");
const downloadCsvButton = document.getElementById("button-download-csv");
const downloadChartButton = document.getElementById("button-download-chart"); // 追加
const micButton = document.getElementById("btn-mic");
const customRecordButton = document.getElementById("btn-record-custom");

const dynamicButtonGrid = document.getElementById("dynamic-button-grid");
const btnOpenSettings = document.getElementById("btn-open-settings");
const modal = document.getElementById("settings-modal");
const settingsContainer = document.getElementById("settings-inputs-container");
const btnSaveSettings = document.getElementById("btn-save-settings");
const btnCancelSettings = document.getElementById("btn-cancel-settings");
const btnResetDefaults = document.getElementById("btn-reset-defaults");

// =================================================================================
//  グローバル変数・設定
// =================================================================================
let cprTime = 0, ccTime = 0, elapsedSeconds = 0, logText = "";
let isCprRunning = false, isCompressing = false;
let cprStartTime, ccStartTime;
let tickInterval;
let eventLog = [];
let interruptionStartTime = null; 

// デフォルトボタン定義
const DEFAULT_BUTTONS = [
  "SOL確認", "質の評価", "IC", 
  "指示要請", "IV確保", "アドレナリン投与",
  "気道確保", "隊員の交代", "自動心マ装着",
  "支援隊到着", "搬送準備", "搬出開始"
];

let currentButtons = JSON.parse(localStorage.getItem('cpr_app_buttons')) || [...DEFAULT_BUTTONS];

// =================================================================================
//  Chart.js 設定
// =================================================================================
const ccfData = {
  labels: [],
  datasets: [{
    label: 'CCF (%)', data: [], borderColor: 'rgba(75, 192, 192, 1)',
    backgroundColor: 'rgba(75, 192, 192, 0.2)', fill: true, tension: 0.1, pointRadius: 0
  }]
};

// Canvas要素の取得
const ctxChart = document.getElementById('ccfChart');

const ccfChart = new Chart(ctxChart, {
  type: 'line', data: ccfData,
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    layout: {
      padding: {
        top: 50 // ★重要: グラフの上に余白を作って、吹き出しが切れないようにする
      }
    },
    scales: {
      y: { min: 0, max: 105, title: { display: true, text: 'CCF (%)' }}, // MAXを少し広げる
      x: {
        type: 'linear', title: { display: true, text: '経過時間' },
        ticks: { callback: v => `${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}` }
      }
    },
    plugins: { annotation: { annotations: {} } }
  }
});

// =================================================================================
//  ボタン生成・設定管理
// =================================================================================
function renderButtons() {
  dynamicButtonGrid.innerHTML = ""; 
  currentButtons.forEach(text => {
    if(!text.trim()) return;
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.className = "event-btn";
    btn.dataset.event = text;
    // CSSでスタイル管理するためJSでのstyle指定は削除済み
    dynamicButtonGrid.appendChild(btn);
  });
}

function openSettings() {
  settingsContainer.innerHTML = "";
  currentButtons.forEach((text, index) => {
    const input = document.createElement("input");
    input.type = "text"; input.value = text; input.dataset.index = index;
    settingsContainer.appendChild(input);
  });
  modal.style.display = "block";
}

function saveSettings() {
  const inputs = settingsContainer.querySelectorAll("input");
  const newButtons = [];
  inputs.forEach(input => { if(input.value.trim() !== "") newButtons.push(input.value.trim()); });
  currentButtons = newButtons;
  localStorage.setItem('cpr_app_buttons', JSON.stringify(currentButtons));
  renderButtons();
  modal.style.display = "none";
}

function resetDefaults() {
  if(confirm("ボタン設定を初期状態に戻しますか？")) {
    currentButtons = [...DEFAULT_BUTTONS];
    localStorage.setItem('cpr_app_buttons', JSON.stringify(currentButtons));
    renderButtons();
    modal.style.display = "none";
  }
}

btnOpenSettings.addEventListener("click", openSettings);
btnSaveSettings.addEventListener("click", saveSettings);
btnCancelSettings.addEventListener("click", () => modal.style.display = "none");
btnResetDefaults.addEventListener("click", resetDefaults);

dynamicButtonGrid.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON') addLog(e.target.dataset.event);
});

// =================================================================================
//  コア機能
// =================================================================================
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  return `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
}
function formatLogTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function updateDisplay() {
  cprTimeDisplay.textContent = `CPR: ${formatTime(cprTime)}`;
  ccTimeDisplay.textContent = `圧迫: ${formatTime(ccTime)}`;
  const rate = cprTime > 0 ? Math.floor((ccTime / cprTime) * 100) : 0;
  rateDisplay.textContent = `CCF: ${rate}%`;
  rateDisplay.style.color = rate >= 80 ? "#2E7D32" : "#D32F2F";
}

function updateButtonStates() {
  cprButton.textContent = isCprRunning ? "現場離脱 / 終了" : "傷病者接触 / 開始";
  cprButton.style.backgroundColor = isCprRunning ? "#546E7A" : "#4CAF50";

  if (isCprRunning) {
    ccButton.disabled = false;
    if (isCompressing) {
      ccButton.textContent = "圧迫 停止";
      ccButton.style.backgroundColor = "#E53935"; 
      ccButton.style.border = "4px solid #B71C1C";
    } else {
      ccButton.textContent = "圧迫 開始";
      ccButton.style.backgroundColor = "#1E88E5";
      ccButton.style.border = "none";
    }
  } else {
    ccButton.disabled = true;
    ccButton.textContent = "胸骨圧迫";
    ccButton.style.backgroundColor = "#BDBDBD";
    ccButton.style.border = "none";
  }
}

function tick() {
  const now = Date.now();
  if (isCprRunning) {
    cprTime += now - cprStartTime;
    cprStartTime = now;
    if (isCompressing) {
      ccTime += now - ccStartTime;
      ccStartTime = now;
    }
    const totalElapsed = Math.floor(cprTime / 1000);
    if (totalElapsed > elapsedSeconds) {
      elapsedSeconds = totalElapsed;
      const currentRate = cprTime > 0 ? Math.floor((ccTime / cprTime) * 100) : 0;
      ccfData.labels.push(elapsedSeconds);
      ccfData.datasets[0].data.push(currentRate);
      ccfChart.update('none');
    }
  }
  updateDisplay();
}

// =================================================================================
//  ★★★ ログ追加機能（修正版） ★★★
// =================================================================================
function addLog(action) {
  if (!isCprRunning && action !== "現場離脱/測定終了" && action !== "傷病者接触") return;
  
  const timeStr = formatLogTime(elapsedSeconds);
  
  // その時点でのCCFを計算
  const currentCCF = cprTime > 0 ? Math.floor((ccTime / cprTime) * 100) : 0;
  
  // ログリストへの表示
  logText += `<div class="log-entry"><strong>[${timeStr}]</strong> ${action} (CCF:${currentCCF}%)</div>`;
  logDisplay.innerHTML = logText;
  logDisplay.scrollTop = logDisplay.scrollHeight;
  eventLog.push({ time: elapsedSeconds, event: action });

  // グラフへの注釈追加（圧迫開始/停止以外）
  if (!action.includes('圧迫')) {
    const id = `log-${Date.now()}`;
    
    // ★重要: ログの個数を数えて、高さを変えるロジック（ジグザグ配置）
    const logCount = Object.keys(ccfChart.options.plugins.annotation.annotations).length;
    
    // 3段階の高さ (-20, -55, -90) を順番にループさせる
    // これにより、隣り合うログが重なりにくくなる
    const heightLevels = [-20, -55, -90]; 
    const yAdjustment = heightLevels[logCount % 3];

    ccfChart.options.plugins.annotation.annotations[id] = {
      type: 'line', 
      xMin: elapsedSeconds, 
      xMax: elapsedSeconds, 
      borderColor: 'rgba(255, 99, 132, 0.4)', 
      borderWidth: 1,
      label: { 
        // ★文字にCCF値を含める
        content: `${action} [${currentCCF}%]`, 
        enabled: true, 
        position: 'start', 
        backgroundColor: 'rgba(0,0,0,0.8)', // 背景を少し濃くして読みやすく
        color: 'white', 
        // ★文字サイズを少し大きく (10 -> 12)
        font: { size: 12, weight: 'bold' },
        // ★ジグザグの高さを適用
        yAdjust: yAdjustment
      }
    };
    ccfChart.update('none');
  }
}

function addCustomLog() {
  const value = customLogInput.value.trim();
  if (value) {
    addLog(value);
    customLogInput.value = "";
  }
}
customRecordButton.addEventListener('click', addCustomLog);

// =================================================================================
//  メイン操作
// =================================================================================
cprButton.addEventListener("click", () => {
  isCprRunning = !isCprRunning;
  if (isCprRunning) {
    cprStartTime = Date.now();
    tickInterval = setInterval(tick, 100);
    addLog("傷病者接触");
  } else {
    clearInterval(tickInterval);
    if(isCompressing) addLog("圧迫停止(終了)");
    addLog("現場離脱/測定終了");
    isCompressing = false;
    interruptionStartTime = null;
  }
  updateButtonStates();
});

ccButton.addEventListener("click", () => {
  if (!isCprRunning) return;
  isCompressing = !isCompressing;
  if (isCompressing) {
    if (interruptionStartTime) {
      const diff = ((Date.now() - interruptionStartTime) / 1000).toFixed(1);
      addLog(`圧迫再開 (中断: ${diff}秒)`);
      interruptionStartTime = null;
    } else {
      addLog("圧迫開始");
    }
    ccStartTime = Date.now();
  } else {
    addLog("圧迫停止");
    interruptionStartTime = Date.now();
  }
  updateButtonStates();
});

resetButton.addEventListener("click", () => {
  if(confirm("データをリセットしますか？")) {
    clearInterval(tickInterval);
    cprTime = 0; ccTime = 0; elapsedSeconds = 0; logText = "";
    isCprRunning = false; isCompressing = false; eventLog = []; interruptionStartTime = null;
    logDisplay.innerHTML = "";
    updateDisplay();
    updateButtonStates();
    ccfData.labels = []; ccfData.datasets[0].data = []; ccfChart.options.plugins.annotation.annotations = {}; ccfChart.update();
  }
});

// 音声入力
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP'; recognition.continuous = false; 
  micButton.addEventListener('click', () => { try { recognition.start(); micButton.textContent = "👂"; micButton.style.backgroundColor = "#F44336"; } catch(e) { console.error(e); } });
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    addLog(transcript);
    customLogInput.value = ""; customLogInput.placeholder = `記録済み: ${transcript}`; customLogInput.style.backgroundColor = "#e8f5e9";
    setTimeout(() => { customLogInput.style.backgroundColor = "white"; customLogInput.placeholder = "自由記入 (音声可)"; }, 2000);
  };
  recognition.onend = () => { micButton.textContent = "🎤"; micButton.style.backgroundColor = "#ff9800"; };
} else { micButton.style.display = 'none'; customLogInput.placeholder = "音声非対応"; }

// CSVダウンロード
downloadCsvButton.addEventListener("click", () => {
  const header = 'Seconds,Time,CCF(%),Event\n'; let csvRows = [header];
  const logMap = new Map(); eventLog.forEach(log => { if (!logMap.has(log.time)) logMap.set(log.time, []); logMap.get(log.time).push(log.event); });
  for (let i = 0; i < ccfData.labels.length; i++) {
    const sec = ccfData.labels[i], ccf = ccfData.datasets[0].data[i], evts = logMap.has(sec) ? logMap.get(sec).join('; ') : '';
    csvRows.push(`${sec},${formatLogTime(sec)},${ccf},"${evts}"`);
  }
  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `CCF_Log_${new Date().getHours()}${new Date().getMinutes()}.csv`; link.click();
});

// =================================================================================
//  ★★★ グラフ画像保存（ワイド＆高画質版） ★★★
// =================================================================================
downloadChartButton.addEventListener("click", () => {
  // 1. 元のサイズを記憶
  const originalWidth = ccfChart.canvas.width;
  const originalHeight = ccfChart.canvas.height;

  // 2. グラフを「超ワイド(2400px)」かつ「高さも十分(1200px)」にリサイズ
  // 横に伸ばすことで文字の重なりを防ぎ、縦に伸ばすことで段違い表示のスペースを確保
  ccfChart.resize(2400, 1200); 
  
  // ★重要: ダウンロード時だけフォントサイズを巨大化させる
  // すべてのAnnotationのフォント設定を一時的に書き換える
  const annotations = ccfChart.options.plugins.annotation.annotations;
  Object.keys(annotations).forEach(key => {
    annotations[key].label.font = { size: 24, weight: 'bold' }; // 文字を大きく
  });

  ccfChart.update('none');

  // 3. 白背景の画像生成
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = ccfChart.canvas.width;
  tempCanvas.height = ccfChart.canvas.height;
  const ctx = tempCanvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  ctx.drawImage(ccfChart.canvas, 0, 0);

  // 4. ダウンロード
  const link = document.createElement('a');
  const now = new Date();
  link.href = tempCanvas.toDataURL('image/png');
  link.download = `CCF_Graph_${now.getHours()}${now.getMinutes()}.png`;
  link.click();

  // 5. 元に戻す（フォントサイズも戻す）
  Object.keys(annotations).forEach(key => {
    annotations[key].label.font = { size: 12, weight: 'bold' }; // 元のサイズ
  });
  ccfChart.resize(); 
  ccfChart.update('none');
});

// 初期化
renderButtons();
updateButtonStates();