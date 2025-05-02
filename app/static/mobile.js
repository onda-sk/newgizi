let recognition;
let ws;
let isRecording = false;
let transcriptDiv = document.getElementById('transcript');
let statusDiv = document.getElementById('status');
let meetingId = window.meetingId || "";
let selectedMicId = null;
let allAudioBlobs = []; // 停止時にまとめる
let currentMediaStream = null;
let currentMediaRecorder = null;
let currentAudioBlobs = [];


// マイク一覧を取得して<select>に表示
async function populateMicList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    // サイトを開くたびに必ずマイク利用許可を取得
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        setStatus("マイク利用許可が必要です: " + e.message);
        return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const micSelect = document.getElementById('mic-select');
    micSelect.innerHTML = "";
    const audioInputs = devices.filter(d => d.kind === "audioinput");
    let builtinIndex = -1;
    // デバッグ用: audioInputsの内容をstatusに表示
    setStatus(
        "audioInputs: " +
        JSON.stringify(audioInputs.map(d => ({
            deviceId: d.deviceId,
            label: d.label
        })))
    );
    audioInputs.forEach((device, idx) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        // ラベルが空なら「デフォルトマイクn」と表示
        option.text = device.label && device.label.trim() !== "" ? device.label : `デフォルトマイク${idx + 1}`;
        micSelect.appendChild(option);
        // 内蔵マイクらしきものを優先
        if (
            device.label &&
            (
                device.label.toLowerCase().includes("built-in") ||
                device.label.includes("内蔵") ||
                device.label.toLowerCase().includes("iphone") ||
                device.label.toLowerCase().includes("ipad") ||
                device.label.toLowerCase().includes("mic") ||
                device.label.toLowerCase().includes("microphone")
            )
        ) {
            if (builtinIndex === -1) builtinIndex = idx;
        }
    });
    // デフォルトで内蔵マイク or 最初のマイクを選択
    if (audioInputs.length === 1) {
        micSelect.selectedIndex = 0;
        selectedMicId = audioInputs[0].deviceId;
    } else if (audioInputs.length > 1) {
        if (builtinIndex !== -1) {
            micSelect.selectedIndex = builtinIndex;
            selectedMicId = audioInputs[builtinIndex].deviceId;
        } else {
            micSelect.selectedIndex = 0;
            selectedMicId = audioInputs[0].deviceId;
        }
    } else {
        selectedMicId = null;
    }
    micSelect.onchange = () => {
        selectedMicId = micSelect.value;
        // 選択中のマイク名をstatusに表示
        const selectedOption = micSelect.options[micSelect.selectedIndex];
        setStatus("選択中のマイク: " + (selectedOption ? selectedOption.text : ""));
        // 録音中なら一度停止して再開
        if (isRecording) {
            pauseRecognition();
            setTimeout(() => { startRecognition(); }, 300);
        }
    };
}

// 録音開始前に選択マイクをアクティブに
async function activateSelectedMic() {
    if (!selectedMicId) return;
    try {
        if (selectedMicId) {
            await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedMicId } } });
        } else {
            await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    } catch (e) {
        setStatus("マイク取得エラー: " + e.message);
    }
}

function setStatus(msg) {
    statusDiv.textContent = msg;
}

function setButtons(start, pause, stop) {
    document.getElementById('start-btn').disabled = !start;
    document.getElementById('pause-btn').disabled = !pause;
    document.getElementById('stop-btn').disabled = !stop;
}

async function startRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        setStatus("このブラウザは音声認識に対応していません");
        return;
    }
    // 録音開始時にも毎回マイク利用許可を取得
    try {
        if (selectedMicId) {
            currentMediaStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedMicId } } });
        } else {
            currentMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    } catch (e) {
        setStatus("マイク利用許可が必要です: " + e.message);
        return;
    }
    // 選択マイクをアクティブに
    await activateSelectedMic();

    // MediaRecorderで音声データも取得
    if (currentMediaStream) {
        try {
            currentAudioBlobs = [];
            currentMediaRecorder = new MediaRecorder(currentMediaStream);
            currentMediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    currentAudioBlobs.push(event.data);
                }
            };
            currentMediaRecorder.start();
        } catch (e) {
            setStatus("MediaRecorderエラー: " + e.message);
        }
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => setStatus("録音中...(onstart発火)");
    recognition.onend = () => {
        setStatus("一時停止中(onend発火)");
        if (isRecording) {
            setTimeout(() => { startRecognition(); }, 300);
        }
    };
    recognition.onerror = (e) => setStatus("エラー(onerror): " + e.error);

    recognition.onresult = (event) => {
        setStatus("onresult発火: " + event.results.length + "件");
        let sentenceBuffer = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            let transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                sentenceBuffer += transcript;
                // 句点（。！？）で区切って文章単位で送信
                let sentences = sentenceBuffer.split(/(?<=[。！？\?！\!])/);
                for (let s of sentences) {
                    if (s.trim().length > 0) {
                        sendTranscript(s.trim(), true);
                    }
                }
                transcriptDiv.textContent = sentenceBuffer;
                sentenceBuffer = "";
            } else {
                setStatus("interim: " + transcript);
            }
        }
    };

    recognition.start();
    isRecording = true;
    setButtons(false, true, true);

    // 10秒ごとにバッファを送信
    if (window._sendInterval) clearInterval(window._sendInterval);
    window._sendInterval = setInterval(() => {
        if (!isRecording) { clearInterval(window._sendInterval); return; }
        if (transcriptDiv.textContent.trim() !== '') {
            sendTranscript(transcriptDiv.textContent.trim(), false);
        }
    }, 10000);
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
    // 録音停止時にfinalTranscriptが残っていれば必ず送信
    if (typeof recognition !== "undefined" && recognition) {
        let finalTranscript = transcriptDiv.textContent || "";
        if (finalTranscript && finalTranscript.trim() !== "") {
            sendTranscript(finalTranscript, true);
        }
        recognition.stop();
    }
    setStatus("停止しました");
    setButtons(true, false, false);
    isRecording = false;

    // MediaRecorder停止＆音声データまとめ
    if (currentMediaRecorder && currentMediaRecorder.state !== "inactive") {
        currentMediaRecorder.stop();
    }
    if (currentAudioBlobs && currentAudioBlobs.length > 0) {
        allAudioBlobs = allAudioBlobs.concat(currentAudioBlobs);
        currentAudioBlobs = [];
    }

    // 録音停止後に/finalize_minutesで最終議事録を即時生成＆共有UI表示
    if (window.meetingId) {
        fetch(`/rtmmg/finalize_minutes`, {
            method: "POST",
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({meeting_id: window.meetingId})
        })
        .then(res => res.ok ? res.text() : "取得失敗")
        .then(md => {
            showShareOptions(md);
        });
    }
}

// 議事録共有UI表示
function showShareOptions(minutesText) {
    let shareDiv = document.getElementById('share-div');
    if (!shareDiv) {
        shareDiv = document.createElement('div');
        shareDiv.id = 'share-div';
        shareDiv.style.margin = "2em 0";
        document.body.appendChild(shareDiv);
    }
    shareDiv.innerHTML = `
        <h2>議事録が完成しました</h2>
        <textarea style="width:100%;max-width:700px;height:40vh;min-height:300px;font-size:1.1em;padding:1em;box-sizing:border-box;resize:vertical;overflow-x:auto;">${minutesText}</textarea><br>
        <button id="copy-minutes-btn" style="font-size:1.1em;padding:0.7em 2em;margin:0.5em;">コピー</button>
        <a id="download-minutes-btn" href="#" download="minutes.txt" style="font-size:1.1em;padding:0.7em 2em;margin:0.5em;">ダウンロード</a>
        <a id="download-audio-btn" href="#" download="recording.mp3" style="font-size:1.1em;padding:0.7em 2em;margin:0.5em;">音声(mp3)ダウンロード</a>
    `;
    shareDiv.style.maxWidth = "700px";
    shareDiv.style.margin = "2em auto";
    shareDiv.style.padding = "1em";
    shareDiv.style.background = "#f8f9fa";
    shareDiv.style.borderRadius = "12px";
    shareDiv.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
    shareDiv.style.overflowX = "auto";
    document.getElementById('copy-minutes-btn').onclick = function() {
        navigator.clipboard.writeText(minutesText);
        alert("コピーしました");
    };
    document.getElementById('download-minutes-btn').onclick = function(e) {
        e.preventDefault();
        // BOM付きUTF-8で保存（Windowsメモ帳等で文字化け防止）
        const blob = new Blob(["\uFEFF" + minutesText], {type: "text/plain;charset=utf-8"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "minutes.txt";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    document.getElementById('download-audio-btn').onclick = async function(e) {
        e.preventDefault();
        // すべての録音データをwebmとしてサーバーにアップロードし、m4a変換URLを取得
        let blobs = [];
        if (allAudioBlobs && allAudioBlobs.length > 0) {
            blobs = blobs.concat(allAudioBlobs);
        }
        if (currentAudioBlobs && currentAudioBlobs.length > 0) {
            blobs = blobs.concat(currentAudioBlobs);
        }
        if (blobs.length > 0) {
            const combinedBlob = new Blob(blobs, { type: 'audio/webm' });
            const formData = new FormData();
            formData.append("meeting_id", window.meetingId || "");
            formData.append("file", combinedBlob, "recording.webm");
            setStatus("サーバーに音声ファイルをアップロード中...");
            try {
                const res = await fetch("/rtmmg/upload_audio", {
                    method: "POST",
                    body: formData
                });
                const data = await res.json();
                if (data.status === "ok" && data.download_url) {
                    setStatus("m4a変換完了。ダウンロードを開始します。");
                    window.location.href = data.download_url;
                } else {
                    alert("m4a変換エラー: " + (data.message || "不明なエラー"));
                }
            } catch (err) {
                alert("アップロードまたは変換エラー: " + err);
            }
        } else {
            alert("音声データがありません。");
        }
    };
}

function sendTranscript(text, isFinal) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            meeting_id: meetingId,
            text: text,
            is_final: isFinal,
            topic: window.meetingTopic || ""
        }));
    }
}

function startWebSocket() {
    // 明示的に末尾スラッシュなしで指定
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/rtmmg/socket");
    ws.onopen = () => setStatus("WebSocket接続中...");
    ws.onclose = () => setStatus("WebSocket切断");
    ws.onerror = (e) => setStatus("WebSocketエラー");
    ws.onmessage = (event) => {
        // サーバーからのminutes（要約）を受信して表示
        try {
            const data = JSON.parse(event.data);
            if (data.type === "minutes" && data.minutes) {
                transcriptDiv.textContent = data.minutes;
                setStatus("要約を受信しました");
                showShareOptions(data.minutes);
            }
        } catch (e) {
            // テキストメッセージやエラーはstatusに表示
            setStatus("サーバー応答: " + event.data);
        }
    };
}

document.getElementById('start-btn').onclick = () => {
    const topic = document.getElementById('mobile-topic') ? document.getElementById('mobile-topic').value.trim() : "";
    if (!topic) {
        alert("議題を入力してください");
        return;
    }
    window.meetingTopic = topic;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        startWebSocket();
        setTimeout(() => { startRecognition(); }, 500); // WebSocket接続後に録音開始
    } else {
        startRecognition();
    }
};
document.getElementById('pause-btn').onclick = pauseRecognition;
document.getElementById('stop-btn').onclick = stopRecognition;

setButtons(true, false, false);

// ページロード時にマイク一覧を取得
window.addEventListener('DOMContentLoaded', populateMicList);
