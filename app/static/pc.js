let ws = null;
let meetingId = "";
let minutesDiv = document.getElementById('minutes');
let timer = null;

// オプションパネルの開閉
const optionsPanel = document.getElementById('options-panel');
const optionsToggle = document.getElementById('options-toggle');
const optionsClose = document.getElementById('options-close');
optionsToggle.onclick = () => optionsPanel.classList.add('open');
optionsClose.onclick = () => optionsPanel.classList.remove('open');

// 会議IDフォーム送信でWebSocket接続＆議事録取得開始
document.getElementById('meeting-id-form').onsubmit = function(e) {
    e.preventDefault();
    meetingId = document.getElementById('meeting-id-input').value.trim().toUpperCase();
    if (!meetingId) return;
    connectWebSocket();
    if (timer) clearInterval(timer);
    timer = setInterval(fetchMinutes, 10000); // 10秒ごとに取得
    fetchMinutes(); // 最初に即時取得
};

function connectWebSocket() {
    if (ws) ws.close();
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/rtmmg/socket");
    ws.onopen = () => {};
    ws.onclose = () => {};
    ws.onerror = () => {};
    ws.onmessage = (event) => {
        // サーバーからのpushがあればここでminutesDiv.innerHTML = event.data;
    };
}

// 議事録取得（サーバーにGETリクエスト、仮実装）
function fetchMinutes() {
    fetch(`/rtmmg/minutes?meeting_id=${encodeURIComponent(meetingId)}`)
        .then(res => res.ok ? res.text() : "取得失敗")
        .then(md => {
            minutesDiv.innerText = md;
        });
}

// オプション欄の値をサーバーに送信（プロンプト等、仮実装）
function sendOptions() {
    const data = {
        title: document.getElementById('opt-title').value,
        members: document.getElementById('opt-members').value,
        date: document.getElementById('opt-date').value,
        agenda: document.getElementById('opt-agenda').value,
        purpose: document.getElementById('opt-purpose').value,
        prompt: document.getElementById('opt-prompt').value,
        meeting_id: meetingId
    };
    fetch('/rtmmg/options', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
}

// オプション欄の各input/textareaで変更時に送信
['opt-title','opt-members','opt-date','opt-agenda','opt-purpose','opt-prompt'].forEach(id => {
    document.getElementById(id).onchange = sendOptions;
});
