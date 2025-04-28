let ws = null;
let meetingId = "";
let minutesDiv = document.getElementById('minutes');
let timer = null;

let meetingIdErrorDiv = null;
if (!document.getElementById('meeting-id-error')) {
    meetingIdErrorDiv = document.createElement('div');
    meetingIdErrorDiv.id = 'meeting-id-error';
    meetingIdErrorDiv.style.color = 'red';
    document.getElementById('meeting-id-form').appendChild(meetingIdErrorDiv);
} else {
    meetingIdErrorDiv = document.getElementById('meeting-id-error');
}

// 会議IDフォーム送信でmeetingId登録APIを呼び出し、有効ならWebSocket接続＆議事録取得開始
document.getElementById('meeting-id-form').onsubmit = async function(e) {
    e.preventDefault();
    meetingIdErrorDiv.textContent = "";
    meetingId = document.getElementById('meeting-id-input').value.trim().toUpperCase();
    if (!meetingId) return;
    // meetingIdの有効性チェック
    const res = await fetch('/rtmmg/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({meeting_id: meetingId})
    });
    if (res.ok) {
        connectWebSocket();
        if (timer) clearInterval(timer);
        timer = setInterval(fetchMinutes, 10000); // 10秒ごとに取得
        fetchMinutes(); // 最初に即時取得
    } else {
        const data = await res.json();
        meetingIdErrorDiv.textContent = "登録失敗: " + (data.message || "無効な会議IDです");
    }
};

function connectWebSocket() {
    if (ws) ws.close();
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/rtmmg/socket");
    ws.onopen = () => {};
    ws.onclose = () => {};
    ws.onerror = () => {};
    ws.onmessage = (event) => {
        // サーバーからのpushがあればここでminutesDiv.innerHTML = event.data;
        try {
            const data = JSON.parse(event.data);
            if (data.type === "minutes" && data.minutes) {
                minutesDiv.innerText = data.minutes;
            }
        } catch (e) {
            // テキストメッセージやエラーはstatusに表示
            if (window.console) {
                console.log("WebSocket message:", event.data);
            }
        }
    };
}

// 議事録取得（サーバーにGETリクエスト、仮実装）
function fetchMinutes() {
    fetch(`/rtmmg/minutes?meeting_id=${encodeURIComponent(meetingId)}`)
        .then(res => res.ok ? res.text() : "取得失敗")
        .then(md => {
            minutesDiv.innerText = md;
            // デバッグ用: 取得内容をalertまたはconsoleに出力
            if (window.fetchMinutesDebug) {
                alert("minutes取得: " + md);
            }
            if (window.console) {
                console.log("minutes取得:", md);
            }
        });
}
