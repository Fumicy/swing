export const VERSION = '0503-15';

// MediaPipe landmark indices
export const LM = {
  NOSE:0, L_EAR:7, R_EAR:8,
  L_SHOULDER:11, R_SHOULDER:12,
  L_ELBOW:13, R_ELBOW:14,
  L_WRIST:15, R_WRIST:16,
  L_INDEX:19, R_INDEX:20,
  L_HIP:23, R_HIP:24,
  L_KNEE:25, R_KNEE:26,
  L_ANKLE:27, R_ANKLE:28,
  L_HEEL:29, R_HEEL:30,
  L_FOOT:31, R_FOOT:32,
};

export const SKELETON = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [15,17],[15,19],[16,18],[16,20],
  [11,23],[12,24],[23,24],
  [23,25],[24,26],[25,27],[26,28],
  [27,29],[28,30],[29,31],[30,32],
];

export const KEY_LM = [11,12,13,14,15,16,23,24];

export const THRESH = {
  P1: { warnX:0.10, probX:0.18, warnY:0.08, probY:0.15, probTotal:0.20 },
  P2: { warn:0.10, prob:0.15 },
  P3: { warn:5, prob:10, hipFwd:0.03 },
  P4: { warnLow:12, probLow:5 },   // X-Factor (°): lower = worse
  P6: { warnLead:2, probLead:0 },  // kinematic lead (frames hips before shoulders): lower = worse
  P9: { weightOk:0.85, weightProb:0.70, heelLift:-0.02, rotOk:150, rotWarn:120, cogOk:0.001, cogWarn:0.003 },
  PHASE: { moveStart:0.005, stopThresh:0.003, finishRatio:0.25, moveFrames:3, refFrames:10 },
};

export const PHASE = {
  ADDRESS:'address', BACKSWING:'backswing',
  TOP:'top', DOWNSWING:'downswing',
  FOLLOW:'follow', COMPLETE:'complete',
};

export const STATUS = { OK:'ok', WARN:'warn', PROBLEM:'problem', UNKNOWN:'unknown' };

export const PHASE_LABELS = {
  address:'アドレス', backswing:'テイクバック',
  top:'トップ', downswing:'インパクト', follow:'フォロー',
};

export const ADVICE = {
  P1:{
    label:'頭部の安定',
    ok:'頭部は安定しています。',
    warn:'頭部がやや移動しています。',
    problem:'頭部がインパクト時に大きく移動しています。',
    hint:'右耳の位置をインパクトまでキープしましょう。ボールの音が聞こえるまで顔を上げないイメージが有効です。',
  },
  P2:{
    label:'ラテラルスウェイ',
    ok:'テイクバックで腰は安定しています。',
    warn:'テイクバックでやや腰が横に流れています。',
    problem:'テイクバックで腰が大きく横移動しています（ラテラルスウェイ）。',
    hint:'右ひざの角度を変えずに体を回転させましょう。右足の内側で地面を踏みとどまるイメージで。',
  },
  P3:{
    label:'脊柱角度',
    ok:'前傾角は維持できています。',
    warn:'ダウンスイングでやや体が起き上がっています。',
    problem:'ダウンスイングで体が起き上がっています（アーリーエクステンション）。',
    hint:'アドレスの前傾角を保ったまま振り抜きましょう。お尻の位置をアドレスのまま固定するイメージを持ってください。',
  },
  P4:{
    label:'X-ファクター',
    ok:'トップで十分な肩腰の捻転差があります。',
    warn:'トップで肩と腰の捻転差がやや不足しています。',
    problem:'トップで肩と腰の捻転差が不足しています（X-ファクター不足）。',
    hint:'「腰45°・肩90°」のイメージでテイクバックしましょう。左肩をアゴの下まで回しながら右ひざの角度を保って腰の回転を抑えるのがポイントです。',
  },
  P6:{
    label:'キネマティックシーケンス',
    ok:'ダウンスイングで腰→肩の正しい連鎖運動ができています。',
    warn:'ダウンスイングで腰と肩がほぼ同時に動いており、連鎖が不明瞭です。',
    problem:'ダウンスイングで肩が腰より先に動いています（アームドスイング）。',
    hint:'切り返し直後に左腰を目標方向へ先に動かし、その後に肩・腕が追いかけるイメージを持ちましょう。「腰から切る」意識がエネルギーの連鎖を生みます。',
  },
  P9:{
    label:'フォローバランス',
    ok:'フィニッシュのバランスは良好です。',
    warn:'フィニッシュで体重移動がやや不十分です。',
    problem:'フィニッシュで体重が左足に移りきっていません。',
    hint:'フィニッシュで右足のかかとを浮かせ、左足一本で3秒立てるバランスを目指しましょう。',
  },
};

export const TAG_PRIORITY = {
  general:  ['P3','P1','P2','P4','P6','P9'],
  slice:    ['P2','P1','P3','P9','P4','P6'],
  distance: ['P4','P6','P3','P2','P9','P1'],
  direction:['P1','P3','P6','P2','P9','P4'],
  topduff:  ['P3','P4','P6','P9','P1','P2'],
};

export const TAGS = [
  { id:'general',   label:'全般' },
  { id:'slice',     label:'スライス' },
  { id:'distance',  label:'飛距離' },
  { id:'direction', label:'方向性' },
  { id:'topduff',   label:'トップ/ダフリ' },
];
