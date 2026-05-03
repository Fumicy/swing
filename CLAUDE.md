# SWING.AI — Claude Code コンテキスト

## プロジェクト概要

打ちっぱなし専用のゴルフスイング診断アプリ。スマホのカメラだけで動作し、MediaPipe Poseによる骨格推定でスイングを解析する。サーバーレス・データ保存なし・GitHub Pagesで静的にホスト。

**解決する課題：**
1. 自己認知のズレ — 感覚と実際のフォームのギャップを数値で可視化する
2. レッスンキューの当たり外れ — 問題の根拠を力学原理ベースで示す

**設計4原則：**
- 1セッション1テーマ（改善点を1〜2個に絞る）
- 力学原理ベース評価（絶対値でなく相対変化・比率・順序で評価）
- ステートレス設計（データ保存なし・アカウント不要）
- スマホ完結（MediaPipeオンデバイス推論）

---

## 技術スタック

| 技術 | 用途 |
|---|---|
| HTML / CSS / JavaScript (ES Modules) | フロントエンド全般 |
| MediaPipe Pose v0.5.1675469404 | 骨格33点リアルタイム推定 |
| Canvas 2D API | スケルトン・マーカー描画 |
| getUserMedia API | カメラ映像取得（120fps目標） |
| YOLOv8 + onnxruntime-web | クラブ検出【Phase 2〜未実装】 |
| GitHub Pages | 静的ホスティング |

ビルドプロセスなし。ES modulesをそのままブラウザで実行。

---

## ファイル構成

```
swingai/
├── index.html          # メインHTML。4スクリーン構成。#cam-layerを共有レイヤーとして使用
├── css/
│   └── style.css       # 全スタイル。darkテーマ (#0d1117)。モバイルファースト
└── js/
    ├── config.js       # ★変更が必要な値はここだけ触る
    │                   # LMインデックス、閾値、アドバイステキスト、悩みタグ優先マップ
    ├── utils.js        # Smoother(5frame MA)、getLM、mid、angleDeg、shoulderWidth
    ├── phase.js        # PhaseDetectorクラス。手首速度ベースの状態機械
    ├── analyzer.js     # SwingAnalyzerクラス。P1/P2/P3/P9の計算
    ├── renderer.js     # Rendererクラス。Canvas描画（骨格・マーカー・HUD）
    └── app.js          # Appクラス。状態管理・MediaPipe統合・UI制御の統括
```

---

## アプリ画面フロー

```
SETUP → FRAMING → COUNTDOWN → RECORDING → (ANALYZING) → RESULTS
  ↑_____________________________もう1球_____________________________↑
  ↑_______________最初から__________________________________________↑
```

**各画面の責務：**
- **SETUP** — 悩みタグ（5択）・アングル（正面/側面）・待機時間（3/5/10秒）を選択
- **FRAMING** — カメラ起動。骨格検知でOK/近すぎ/遠すぎを判定。OKになるとボタン有効化
- **RECORDING** — カウントダウン後に自動録画開始。スイング自動検知→自動停止
- **RESULTS** — 5フェーズサムネイル＋スクラバー＋原理スコア＋改善アドバイス

---

## 解析の核心ロジック

### フェーズ自動検出（phase.js）

右利きゴルファー・正面カメラ前提。左手首（LM15）のx座標速度を5フレーム移動平均後に評価。

```
ADDRESS → BACKSWING : speed > 0.004
BACKSWING → TOP     : speed < 0.002
TOP → DOWNSWING     : smoothDx < -0.004 または 15フレーム超過
DOWNSWING → FOLLOW  : speed < peak * 0.30（peakがMOVE_THRESH*3超の場合）
FOLLOW → COMPLETE   : speed < 0.002
```

### SwingAnalyzer（analyzer.js）

**API：**
```javascript
analyzer.feedReference(lms)  // アドレス10フレームで基準値を収集
analyzer.update(lms, phase)   // 毎フレーム呼び出し → frameDataを返す
analyzer.getResults()          // スイング完了後に最終結果を返す
analyzer.reset()               // 次のショットに備えてリセット
```

**基準値（ref）：** アドレス最初の10フレームの平均値
- `ref.headX/Y` — 頭部中心位置
- `ref.hipX` — 腰中心x
- `ref.spine` — 脊柱角度
- `ref.shoulder` — 肩ライン角度
- `ref.sw` — 肩幅（正規化基準）

### P1 頭部安定
```
delta_x = (headCenter.x - ref.headX) / ref.sw
delta_y = (headCenter.y - ref.headY) / ref.sw
WARNING: |delta_x| > 0.10 または |delta_y| > 0.08
PROBLEM: |delta_x| > 0.18 または |delta_y| > 0.15
```

### P2 ラテラルスウェイ（テイクバックのみ）
```
sway = (hipCenter.x - ref.hipX) / ref.sw
WARNING: |sway| > 0.10
PROBLEM: |sway| > 0.15
```

### P3 脊柱角度（アーリーエクステンション）
```
angle_delta = |spine_angle - ref.spine|
shoulder_rise = ref.sMidY - current_sMidY
early_ext = (phase == DOWNSWING) AND (angle_delta > 5° OR shoulder_rise > 0.04)
WARNING: angle_delta > 5°
PROBLEM: angle_delta > 10° または early_ext
```

### P9 フォローバランス（フォロー/コンプリートのみ）
```
weight_ratio = (cogX - rAnkleX) / (lAnkleX - rAnkleX)  // 目標: > 0.85
heel_delta = (rHeel.y - rFoot.y) - ref.rHeelDiff        // 目標: < -0.02
rotation_completion = |finishShoulderAngle - ref.shoulder| // 目標: > 150°
```

---

## 悩みタグ → 原理優先マッピング（config.js）

```javascript
{
  general:  ['P3','P1','P2','P9'],
  slice:    ['P2','P1','P3','P9'],
  distance: ['P3','P2','P9','P1'],
  direction:['P1','P3','P2','P9'],
  topduff:  ['P3','P9','P1','P2'],
}
```

悩みタグを選んだとき、このリストの先頭から順に最も悪いスコアの原理を「主フィードバック」として表示する。

---

## 主要な設計上の決定事項

| 決定 | 内容 | 理由 |
|---|---|---|
| 正規化基準を肩幅に統一 | P1・P2ともに肩幅（LM11-LM12）で除算 | 体格差を吸収。腰幅は変動が大きく過大評価になるため |
| P3は正面カメラでもプロキシ計測 | 肩中点のy上昇をアーリーエクステンションの代理指標に使用 | 側面カメラがない場合でも有意なシグナルを返すため |
| P5・P7を120fps遡及区間に移動 | 30fps（33ms/frame）ではラグ角や一時的なX-factor増加を捉えられない | ダウンスイングは約0.2〜0.3秒（6〜9frames at 30fps）しかない |
| P8はYOLO待ち | スイングプレーン計算にクラブシャフト検出が必須 | MediaPipeはクラブを検出しない |
| ステートレス設計 | swingBufferはメモリのみ、ページリロードで消える | 摩擦最小化・プライバシー配慮 |

---

## ローカル開発環境

```bash
# カメラAPIにはHTTPSまたはlocalhostが必要
cd swingai
python -m http.server 8080
# → http://localhost:8080 で確認（Chrome推奨）

# iPhone Safari でも確認可能（iOS 15以降）
# → PCとiPhoneを同一Wi-Fiに接続し、PCのローカルIPでアクセス
```

---

## 現在の実装状況

**Phase 1 完了（実装済み）：**
- [x] セットアップ / フレーミング / 録画 / 結果の4画面
- [x] MediaPipe骨格検知（@mediapipe/pose v0.5.1675469404）
- [x] スイングフェーズ自動検出
- [x] P1 頭部安定
- [x] P2 ラテラルスウェイ
- [x] P3 脊柱角度（正面カメラ近似）
- [x] P9 フォローバランス
- [x] 悩みタグフィルター
- [x] フェーズサムネイル＋スクラバー

**Phase 2 未実装（優先度順）：**
- [ ] P4 X-ファクター（30fps、トップ検出ロジックが必要）
- [ ] P6 キネマティックシーケンス（30fps、体幹角速度追加）
- [ ] 120fps遡及バッファ（P5・P7・P8の前提）
- [ ] P5 X-ファクターストレッチ（120fps遡及）
- [ ] P7 キャスティング（120fps + YOLO）
- [ ] P8 スイングプレーン（YOLO必須）

**既知のバグ・要確認事項：**
- [ ] フェーズ検出の精度確認（実際のスイング動画でテスト要）
- [ ] P9のweight_ratio計算がresults画面で表示されない可能性あり（app.jsのrenderResults要確認）
- [ ] 左利きゴルファーは現状非対応（LM15とLM16が逆）
- [ ] 結果画面のスクラバーが空白フレームを返すケースの確認

---

## MediaPipe 使用上の注意

```javascript
// CDNから読み込み（script タグ、type="module"より前に配置すること）
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js"></script>

// 初期化
const pose = new Pose({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${f}`
});
pose.setOptions({ modelComplexity:1, smoothLandmarks:true, minDetectionConfidence:0.5 });
pose.onResults(callback);
await pose.initialize();  // WASMロードを待つ（約2〜5秒）

// 毎フレーム送信（video elementを直接渡す）
await pose.send({ image: videoElement });
```

`results.poseLandmarks` は33要素の配列。各要素は `{x, y, z, visibility}`（x,y,zは0〜1正規化）。

---

## Claude Codeへの引き継ぎメモ

この会話で行ったこと（Claude.aiでの設計フェーズ）：

1. アプリコンセプト・設計原則の確立
2. 4画面のUX設計とモックアップ（インタラクティブHTMLで確認済み）
3. スイング理論（9原理）の言語化とMediaPipe測定可否の評価
4. アーキテクチャ設計（MediaPipe + YOLO並列処理、2段階フレーム処理）
5. PoC検証（ブラウザでMediaPipe + Canvas動作確認済み、カメラ61fps/解析29fps確認）
6. 各原理の数式定義と言語定義の照合・修正（v0.2仕様書）
7. Phase 1（P1/P2/P3/P9）の実装

Claude Codeで最初にやること：
```
「Phase 1の実装を確認してほしい。index.htmlをローカルサーバーで動かして、
スイング検知が正しく機能するか、P1-P9のスコアが変化するかを確認してほしい。」
```
