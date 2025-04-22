# RTMMG (Real-time Meeting Minutes Generator)

## セットアップ手順（Ubuntu Linux想定）

```bash
cd /opt/rtmmg/app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## サーバー起動例

```bash
uvicorn app.main:app --host 127.0.0.1 --port 14035
```

## OpenAI APIキーの設定

OpenAI APIキーは `.env` ファイルに記載してください。  
アプリケーション起動時に自動で読み込まれます（python-dotenv使用）。

### .envファイル例

```
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`.env` ファイルは `app` ディレクトリ直下（`newgizi/app/.env`）に配置してください。

- 旧方式（環境変数export）は不要です。
- サーバー起動は通常通りでOKです。

```bash
uvicorn app.main:app --host 127.0.0.1 --port 14035
```

- Apache HTTP Serverのリバースプロキシ設定で127.0.0.1:14035に転送してください。
- Entra ID認証はmod_auth_mellonで既に組み込まれている前提です。

## ディレクトリ構成

```
app/
  ├── __init__.py
  ├── main.py
  ├── requirements.txt
  ├── static/
  │     ├── mobile.js
  │     └── pc.js
  └── templates/
        ├── mobile.html
        └── pc.html
