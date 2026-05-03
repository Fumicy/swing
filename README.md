# SWING.AI — Phase 1

ゴルフスイング解析アプリ。MediaPipe Poseを使用してブラウザ完結で動作します。

## 計測原理（Phase 1）

| 原理 | 内容 |
|---|---|
| P1 頭部の安定 | アドレス基準からの頭部移動量（肩幅比） |
| P2 ラテラルスウェイ | テイクバック中の腰の横移動（肩幅比） |
| P3 脊柱角度 | 前傾角の変化・アーリーエクステンション検知 |
| P9 フォローバランス | 体重移動・右かかと浮き・肩回転完了度 |

## GitHub Pages デプロイ手順

1. このフォルダの内容をGitHubリポジトリにプッシュする
   ```
   git init
   git add .
   git commit -m "initial"
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```

2. GitHubリポジトリの Settings → Pages → Source を `main` ブランチ / `/(root)` に設定

3. `https://<user>.github.io/<repo>/` でアクセス可能になる

## ローカル確認

HTTPSが必要（カメラAPIの制約）。以下のいずれかで確認可能：

```bash
# Python 3
python -m http.server 8080
# → http://localhost:8080（カメラ可）

# Node.js
npx serve .
```

ブラウザはChrome推奨。iPhoneの場合はSafari（iOS 15以降）。

## ファイル構成

```
swingai/
├── index.html          # メインHTML（4スクリーン）
├── css/
│   └── style.css       # スタイル
└── js/
    ├── config.js       # 閾値・定数・アドバイステキスト
    ├── utils.js        # 数学ヘルパー・Smoother
    ├── phase.js        # スイングフェーズ検出
    ├── analyzer.js     # P1/P2/P3/P9 計算
    ├── renderer.js     # Canvas描画
    └── app.js          # メインアプリ（状態管理）
```

## Phase 2 予定（未実装）

- P4 X-ファクター、P5 X-ファクターストレッチ（120fps遡及）
- P6 キネマティックシーケンス
- P7 キャスティング + YOLO連携
- P8 スイングプレーン（YOLO必須）
