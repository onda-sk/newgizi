let recognition;
let ws;
let isRecording = false;
let transcriptDiv = document.getElementById('transcript');
let statusDiv = document.getElementById('status');
let meetingId = window.meetingId || "";

function setStatus(msg) {
    statusDiv.textContent = msg;
}

function setButtons(start, pause, stop) {
    document.getElementById('start-btn').disabled = !start;
    document.getElementById('pause-btn').disabled = !pause;
    document.getElementById('stop-btn').disabled = !stop;
}

function startRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        setStatus("このブラウザは音声認識に対応していません");
        return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => setStatus("録音中...");
    recognition.onend = () => setStatus("一時停止中");
    recognition.onerror = (e) => setStatus("エラー: " + e.error);

    recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            let transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
                sendTranscript(transcript, true);
            } else {
                sendTranscript(transcript, false);
            }
        }
        transcriptDiv.textContent = finalTranscript;
    };

    recognition.start();
    isRecording = true;
    setButtons(false, true, true);
}

function pauseRecognition() {
    if (recognition && isRecording) {
        recognition.stop();
        setStatus("一時停止中");
        setButtons(true, false, true);
        isRecording = false;
    }
}

function stopRecognition() {
    if (recognition) {
        recognition.stop();
    }
    if (ws) {
        ws.close();
        ws = null;
    }
    setStatus("停止しました");
    setButtons(true, false, false);
    isRecording = false;
}

function sendTranscript(text, isFinal) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            meeting_id: meetingId,
            text: text,
            is_final: isFinal
        }));
    }
}

function startWebSocket() {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/rtmmg/socket");
    ws.onopen = () => setStatus("WebSocket接続中...");
    ws.onclose = () => setStatus("WebSocket切断");
    ws.onerror = (e) => setStatus("WebSocketエラー");
    ws.onmessage = (event) => {
        // サーバーからの応答があればここで処理
    };
}

document.getElementById('start-btn').onclick = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        startWebSocket();
        setTimeout(startRecognition, 500); // WebSocket接続後に録音開始
    } else {
        startRecognition();
    }
};
document.getElementById('pause-btn').onclick = pauseRecognition;
document.getElementById('stop-btn').onclick = stopRecognition;

setButtons(true, false, false);
