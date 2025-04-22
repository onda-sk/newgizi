from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import secrets
from dotenv import load_dotenv
load_dotenv()

app = FastAPI()

# 静的ファイル
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# テンプレート
templates = Jinja2Templates(directory="app/templates")

# 会議ID生成（英数字5文字）
def generate_meeting_id():
    return secrets.token_hex(3)[:5].upper()

# スマホ用画面
@app.get("/rtmmg/mobile", response_class=HTMLResponse)
async def mobile(request: Request):
    meeting_id = generate_meeting_id()
    return templates.TemplateResponse("mobile.html", {"request": request, "meeting_id": meeting_id})

# PC用画面
@app.get("/rtmmg", response_class=HTMLResponse)
async def pc(request: Request):
    return templates.TemplateResponse("pc.html", {"request": request})

# WebSocketエンドポイント
import asyncio
import json
import time

# 会議ごとのバッファとタイマー
buffers = {}
last_update = {}

@app.websocket("/rtmmg/socket")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    meeting_id = None
    try:
        while True:
            data = await websocket.receive_text()
            try:
                obj = json.loads(data)
                meeting_id = obj.get("meeting_id")
                text = obj.get("text", "")
                is_final = obj.get("is_final", False)
                if meeting_id:
                    if meeting_id not in buffers:
                        buffers[meeting_id] = []
                        last_update[meeting_id] = 0
                    buffers[meeting_id].append(text)
                    now = time.time()
                    # 10秒ごとに議事録生成
                    if now - last_update[meeting_id] > 10:
                        await generate_minutes(meeting_id)
                        last_update[meeting_id] = now
            except Exception as e:
                await websocket.send_text(f"Error: {e}")
    except WebSocketDisconnect:
        pass

# 議事録生成（OpenAI GPT-4.1連携）
import os
import openai

async def generate_minutes(meeting_id):
    texts = buffers.get(meeting_id, [])
    if not texts:
        return
    # オプション取得
    options = options_store.get(meeting_id, {})
    prompt = options.get("prompt", "議事録をMarkdown形式で要約してください。")
    title = options.get("title", "")
    members = options.get("members", "")
    date = options.get("date", "")
    agenda = options.get("agenda", "")
    purpose = options.get("purpose", "")

    # OpenAI API呼び出し
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        summary = "\n".join(texts) + "\n\n（APIキー未設定のため要約なし）"
    else:
        client = openai.AsyncOpenAI(api_key=api_key)
        user_content = f"""# 会議情報
- 会議名: {title}
- 出席者: {members}
- 日時: {date}
- アジェンダ: {agenda}
- 目的: {purpose}

# 発言記録
{texts}

# 指示
{prompt}
"""
        try:
            response = await client.chat.completions.create(
                model="gpt-4-1106-preview",
                messages=[
                    {"role": "system", "content": "あなたは優秀な日本語の議事録作成AIです。"},
                    {"role": "user", "content": user_content}
                ],
                max_tokens=1024,
                temperature=0.3,
            )
            summary = response.choices[0].message.content
        except Exception as e:
            summary = "\n".join(texts) + f"\n\n（要約エラー: {e}）"

    minutes_store[meeting_id] = summary
    # バッファをクリア
    buffers[meeting_id] = []

# --- 以下、議事録・オプション管理API（仮実装） ---

from fastapi import Query
from fastapi import Body
from fastapi.responses import PlainTextResponse
from typing import Dict

minutes_store: Dict[str, str] = {}
options_store: Dict[str, dict] = {}

@app.get("/rtmmg/minutes", response_class=PlainTextResponse)
async def get_minutes(meeting_id: str = Query(...)):
    # 仮実装: メモリ上のminutes_storeから取得
    return minutes_store.get(meeting_id, "まだ議事録はありません")

@app.post("/rtmmg/options")
async def set_options(data: dict = Body(...)):
    meeting_id = data.get("meeting_id")
    if meeting_id:
        options_store[meeting_id] = data
    return {"status": "ok"}
