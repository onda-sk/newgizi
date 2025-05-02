import logging
import os
from datetime import datetime
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Body, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import secrets
from dotenv import load_dotenv
load_dotenv("/opt/onda_work/RTMMG/myproject/.venv/newgizi/app/.env", override=True)

# ログ設定
log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
if not os.path.exists(log_dir):
    os.makedirs(log_dir)
log_filename = datetime.now().strftime("%Y-%m-%d") + ".log"
log_path = os.path.join(log_dir, log_filename)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(log_path, encoding="utf-8"),
        logging.StreamHandler()
    ]
)

app = FastAPI()

# 静的ファイル
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# テンプレート
templates = Jinja2Templates(directory="app/templates")

# 会議ID生成（英数字5文字）
def generate_meeting_id():
    return secrets.token_hex(3)[:5].upper()

# --- 企業認証API ---
issued_meeting_ids = set()

@app.post("/rtmmg/auth")
async def auth(data: dict = Body(...)):
    company_id = data.get("company_id")
    company_pass = data.get("company_pass")
    if company_id == "demo" and company_pass == "pass":
        meeting_id = generate_meeting_id()
        issued_meeting_ids.add(meeting_id)
        return JSONResponse({"status": "ok", "meeting_id": meeting_id})
    else:
        return JSONResponse({"status": "ng", "message": "認証情報が正しくありません"}, status_code=401)

@app.post("/rtmmg/register")
async def register(data: dict = Body(...)):
    meeting_id = data.get("meeting_id", "")
    if meeting_id in issued_meeting_ids:
        return JSONResponse({"status": "ok"})
    else:
        return JSONResponse({"status": "ng", "message": "無効な会議IDです"}, status_code=400)

@app.get("/rtmmg/mobile", response_class=HTMLResponse)
async def mobile(request: Request):
    meeting_id = generate_meeting_id()
    issued_meeting_ids.add(meeting_id)
    return templates.TemplateResponse("mobile.html", {"request": request, "meeting_id": meeting_id})

@app.get("/rtmmg/", response_class=HTMLResponse)
async def pc(request: Request):
    return templates.TemplateResponse("pc.html", {"request": request})

import asyncio
import json
import time

buffers = {}
last_update = {}
silence_generated = {}
all_texts = {}
topics = {}

@app.websocket("/rtmmg/socket")
async def websocket_endpoint(websocket: WebSocket):
    allowed_origins = [
        "http://localhost",
        "https://localhost",
        "http://127.0.0.1",
        "https://127.0.0.1",
        "https://queryaiservice.japaneast.cloudapp.azure.com",
    ]
    origin = websocket.headers.get("origin")
    print(f"[WebSocket接続] Origin: {origin}")
    if origin not in allowed_origins:
        print(f"[WebSocket拒否] 許可されていないOrigin: {origin}")
        await websocket.close(code=1008)
        return

    await websocket.accept()
    meeting_id = None
    monitor_task = None
    monitor_stop = False

    if not hasattr(websocket.app.state, "active_sockets"):
        websocket.app.state.active_sockets = {}

    async def silence_monitor():
        nonlocal monitor_stop, meeting_id
        while not monitor_stop:
            await asyncio.sleep(1)
            if meeting_id and last_update.get(meeting_id, 0) != 0:
                now = time.time()
                if now - last_update[meeting_id] > 3 and not silence_generated.get(meeting_id, False):
                    await generate_minutes(meeting_id)
                    last_update[meeting_id] = now
                    silence_generated[meeting_id] = True
                    minutes = minutes_store.get(meeting_id, "")
                    if minutes:
                        for ws in websocket.app.state.active_sockets.get(meeting_id, []):
                            try:
                                await ws.send_text(json.dumps({"type": "minutes", "minutes": minutes}))
                            except Exception:
                                continue

    try:
        monitor_task = asyncio.create_task(silence_monitor())
        while True:
            try:
                data = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            try:
                obj = json.loads(data)
                meeting_id = obj.get("meeting_id")
                text = obj.get("text", "")
                is_final = obj.get("is_final", False)
                if meeting_id:
                    if meeting_id not in websocket.app.state.active_sockets:
                        websocket.app.state.active_sockets[meeting_id] = []
                    if websocket not in websocket.app.state.active_sockets[meeting_id]:
                        websocket.app.state.active_sockets[meeting_id].append(websocket)

                    if meeting_id not in buffers:
                        buffers[meeting_id] = []
                        last_update[meeting_id] = 0
                    if meeting_id not in all_texts:
                        all_texts[meeting_id] = []
                    if meeting_id not in silence_generated:
                        silence_generated[meeting_id] = False
                    topic = obj.get("topic")
                    if topic is not None and topic != "":
                        topics[meeting_id] = topic

                    if text:
                        buffers[meeting_id].append(text)
                        all_texts[meeting_id].append(text)
                        await generate_minutes(meeting_id)
                        minutes = minutes_store.get(meeting_id, "")
                        if minutes:
                            for ws in websocket.app.state.active_sockets[meeting_id]:
                                try:
                                    await ws.send_text(json.dumps({"type": "minutes", "minutes": minutes}))
                                except Exception:
                                    continue

                    now = time.time()
                    last_update[meeting_id] = now
                    silence_generated[meeting_id] = False
            except Exception as e:
                try:
                    await websocket.send_text(f"Error: {e}")
                except Exception:
                    break
    except Exception:
        pass
    finally:
        monitor_stop = True
        if monitor_task:
            await monitor_task

@app.websocket("/rtmmg/socket/")
async def websocket_endpoint_slash(websocket: WebSocket):
    await websocket_endpoint(websocket)

import os
import openai

async def generate_minutes(meeting_id):
    texts = all_texts.get(meeting_id, [])
    if not texts:
        return
    options = options_store.get(meeting_id, {})
    title = topics.get(meeting_id) or options.get("title", "")
    members = options.get("members", "")
    import datetime
    date = options.get("date", "")
    if not date:
        now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
        date = now.strftime("%Y-%m-%d %H:%M")
    agenda = options.get("agenda", "")
    purpose = options.get("purpose", "")
    def info_or_guess(label, value):
        return f"{label}は「{value}」です。" if value else f"{label}は会話内容から推測して埋めてください。"

    prompt = options.get(
        "prompt",
        "この発言記録のみをもとに、会議全体の内容を忠実に要約し、事実のみを記載した議事録をMarkdown形式で作成してください。"
        "挨拶（例：おはようございます、こんにちは、よろしくお願いします、失礼します等）は議事録に含めないこと。"
        "雑談や世間話は議事録に含めてよい。"
        "会議内容を題目ごと（#見出しごと）に分け、各題目ごとに会話内容をできるだけ多く、詳細に、できる限り多くの発言ややりとりを議事録本文に盛り込んでください。"
        "要約は簡潔にせず、会話の流れややりとりを詳細に記載してください。"
        "発言者名や発言者ごとの発言内容は記載しないでください。"
        "AIが推測した内容や発言していない内容は絶対に議事録に含めないでください。"
        "決定事項、アクションアイテム、未解決事項があれば必ず明確に分けて記載してください。"
        "会議の流れややりとりを漏れなく記載し、曖昧な表現は避けてください。"
        f"Markdownの先頭の#見出しには必ずこの議題「{title}」を使ってください。"
        "議題に直接関係しない話題やテーマ外の話題が出た場合は、議事録の最後に『# テーマ外の話題』という見出しを作り、そこにまとめて記載してください。"
        "意味の通らない単語や内容を理解できなかった発言は『# 識別できなかった』という見出しを作り、そこにまとめて記載してください。"
        "テーマ外かどうかの判断は単語やフレーズ単位ではなく、必ず文章全体の意味や文脈を考慮して、その話題が議題に関係あるかどうかを判断してください。"
        "単語やキーワードの一致だけで関連性を判断せず、必ず文章全体の意味・文脈・意図を考慮して、その話題が議題に本当に関連しているかどうかを判断してください。"
        "断片的なフレーズや部分的な文ではなく、必ず一つの文章全体を取得し、その意味を理解したうえで議題との関連性を判断してください。"
        "テーマ外の話題は単語や断片的なフレーズではなく、必ず文章としてまとめて記載してください。"
        "ただし、テーマ外の話題には誤字や失言、フィラー（例：えー、あのー等）は記載しないでください。"
        "会議中に出た質問はすべて議事録の最後に『# 質問事項』という見出しを作り、そこにまとめて記載してください。質問とその回答をセットで記載してください。"
        "会議中に出たToDoややるべきことは『# ToDoリスト』という見出しを作り、箇条書きでまとめて記載してください。"
        "とにかく会話の内容をできるだけ多く、詳細に記録してください。"
        + info_or_guess("会議名", title)
        + info_or_guess("出席者", members)
        + info_or_guess("日時", date)
        + info_or_guess("アジェンダ", agenda)
        + info_or_guess("目的", purpose)
        + (f"プロンプトは「{options.get('prompt')}」です。" if options.get("prompt") else "プロンプトも会話内容から推測して埋めてください。")
    )

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        summary = "\n".join(texts) + "\n\n（APIキー未設定のため要約なし）"
    else:
        client = openai.AsyncOpenAI(api_key=api_key)
        user_content = f"""# 発言記録
{texts}

# 指示
{prompt}
"""
        try:
            response = await client.chat.completions.create(
                model="gpt-4.1-mini", 
                messages=[
                    {"role": "system", "content": "あなたは優秀な日本語の議事録作成AIです."},
                    {"role": "user", "content": user_content}
                ],
                max_tokens=2048,
                temperature=0.3,
            )
            summary = response.choices[0].message.content
        except Exception as e:
            summary = "\n".join(texts) + f"\n\n（要約エラー: {e}）"

    minutes_store[meeting_id] = summary
    print(f"[minutes生成] meeting_id={meeting_id}\n{summary}\n")
    buffers[meeting_id] = []

from fastapi import Query
from fastapi import Body
from fastapi.responses import PlainTextResponse
from typing import Dict

minutes_store: Dict[str, str] = {}
options_store: Dict[str, dict] = {}

@app.get("/rtmmg/minutes", response_class=PlainTextResponse)
async def get_minutes(meeting_id: str = Query(...)):
    return minutes_store.get(meeting_id, "まだ議事録はありません")

@app.post("/rtmmg/finalize_minutes", response_class=PlainTextResponse)
async def finalize_minutes(data: dict = Body(...)):
    meeting_id = data.get("meeting_id")
    if not meeting_id:
        return "meeting_idが指定されていません"
    await generate_minutes(meeting_id)
    return minutes_store.get(meeting_id, "まだ議事録はありません")

@app.post("/rtmmg/options")
async def set_options(data: dict = Body(...)):
    meeting_id = data.get("meeting_id")
    if meeting_id:
        options_store[meeting_id] = data
    return {"status": "ok"}

# --- 音声ファイルアップロード＆mp3変換API ---
import tempfile
import subprocess
from fastapi import UploadFile, File
from fastapi.responses import FileResponse

@app.post("/rtmmg/upload_audio")
async def upload_audio(meeting_id: str = Body(...), file: UploadFile = File(...)):
    # 一時ファイルに保存
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as temp_webm:
        content = await file.read()
        temp_webm.write(content)
        temp_webm.flush()
        webm_path = temp_webm.name

    m4a_path = webm_path.replace(".webm", ".m4a")
    # ffmpegでm4a(aac)変換
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-i", webm_path,
            "-vn",
            "-c:a", "aac",
            "-b:a", "128k",
            m4a_path
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except Exception as e:
        return JSONResponse({"status": "ng", "message": f"ffmpeg変換エラー: {e}"}, status_code=500)

    return JSONResponse({"status": "ok", "download_url": f"/rtmmg/download_audio?path={m4a_path}"})

@app.get("/rtmmg/download_audio")
async def download_audio(path: str):
    return FileResponse(path, media_type="audio/mp4", filename="recording.m4a")
