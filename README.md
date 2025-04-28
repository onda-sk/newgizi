# RTMMG（リアルタイム議事録）セットアップ・運用手順

## 概要
本アプリケーションは、Apache HTTP Server + mod_auth_mellon（Entra ID認証）環境下で、127.0.0.1:14035でFastAPIアプリとして動作し、/opt/rtmmg/配下に配置して運用します。

## ディレクトリ構成例
```
/opt/rtmmg/
├── app/
│   ├── main.py
│   ├── requirements.txt
│   ├── static/
│   └── templates/
├── .env
├── README.md
└── ...
```

## Python仮想環境の作成・モジュールインストール
```sh
cd /opt/rtmmg/
python3 -m venv .
source bin/activate
pip install --upgrade pip
pip install -r app/requirements.txt
```

## .envファイル
OpenAI APIキー等、必要な環境変数を`.env`に記載してください。
例：
```
OPENAI_API_KEY=sk-xxxxxxx
```

## アプリケーションの起動
```sh
cd /opt/rtmmg/
source bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 14035
```

## Apache HTTP Server（mod_auth_mellon/Entra ID認証）との連携例

### 1. Apache側のリバースプロキシ設定例
```apache
<VirtualHost *:443>
    ServerName your.domain.example

    # Entra ID認証（mod_auth_mellon）設定は既存のものを利用

    ProxyPass /rtmmg/ http://127.0.0.1:14035/rtmmg/
    ProxyPassReverse /rtmmg/ http://127.0.0.1:14035/rtmmg/
    ProxyPass /static/ http://127.0.0.1:14035/static/
    ProxyPassReverse /static/ http://127.0.0.1:14035/static/
</VirtualHost>
```
- `/rtmmg/`配下にアプリの全機能が集約されるようmain.pyを設計しています。
- 認証はApache側で完了している前提です。アプリ側での追加認証は不要です。

### 2. 静的ファイル・WebSocket
- 静的ファイル（/static/）もリバースプロキシ対象に含めてください。
- WebSocket（/rtmmg/socket）はmod_proxy_wstunnelが有効な場合、自動的にプロキシされます。

## 注意事項
- サーバー起動時は仮想環境を有効化してください。
- 必要に応じてsystemd等でサービス化してください。
- Python3.8以上を推奨します。

## 開発・運用に関する補足
- アプリ本体の機能・API仕様は`app/main.py`を参照してください。
- 企業認証はApache+mod_auth_mellonで完了しているため、アプリ側の認証画面はスキップ可能です（必要に応じてUIから除外してください）。
- セキュリティ要件に応じて、/rtmmg/配下へのアクセス制御をApache側で行ってください。

---
